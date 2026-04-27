import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { hasJsonDocument, readJsonDocument, writeJsonDocument } from './appStateDb';

export type SocialIntradayFrequency = 'manual' | '15min' | '30min' | 'hourly';

export interface SocialIntelligenceScheduleConfig {
  enabled: boolean;
  intraday_frequency: SocialIntradayFrequency;
  intraday_timezone: string;
  intraday_limit: number;
  intraday_sleep_ms: number;
  finalize_enabled: boolean;
  finalize_time_of_day: string;
  finalize_timezone: string;
}

export interface SocialIntelligenceRuntimeState {
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_exit_code?: number | null;
  last_source?: string | null;
  last_error?: string | null;
  last_message?: string | null;
}

const LOCAL_CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'preferences', 'social-intelligence-schedule.local.json');
const SCHEDULER_NAMESPACE = 'social_intelligence_scheduler';
const CONFIG_DOCUMENT_KEY = 'config';
const COLLECT_RUNTIME_DOCUMENT_KEY = 'collect_runtime';
const FINALIZE_RUNTIME_DOCUMENT_KEY = 'finalize_runtime';
const COLLECT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_social_intraday.py');
const FINALIZE_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'build_social_daily_snapshot.py');

let _collectCron: ScheduledTask | null = null;
let _finalizeCron: ScheduledTask | null = null;
let _config: SocialIntelligenceScheduleConfig | null = null;
let _collectProcess: ChildProcess | null = null;
let _finalizeProcess: ChildProcess | null = null;
let _collectRuntime: SocialIntelligenceRuntimeState = loadRuntimeState(COLLECT_RUNTIME_DOCUMENT_KEY) || { running: false };
let _finalizeRuntime: SocialIntelligenceRuntimeState = loadRuntimeState(FINALIZE_RUNTIME_DOCUMENT_KEY) || { running: false };

if (_collectRuntime.running) {
  _collectRuntime = { ..._collectRuntime, running: false, pid: null };
  saveRuntimeState(COLLECT_RUNTIME_DOCUMENT_KEY, _collectRuntime);
}
if (_finalizeRuntime.running) {
  _finalizeRuntime = { ..._finalizeRuntime, running: false, pid: null };
  saveRuntimeState(FINALIZE_RUNTIME_DOCUMENT_KEY, _finalizeRuntime);
}

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : (process.env.PYTHON || 'python3');
}

function defaultConfig(): SocialIntelligenceScheduleConfig {
  return {
    enabled: false,
    intraday_frequency: 'manual',
    intraday_timezone: 'America/Los_Angeles',
    intraday_limit: 0,
    intraday_sleep_ms: 350,
    finalize_enabled: true,
    finalize_time_of_day: '16:30',
    finalize_timezone: 'America/Los_Angeles',
  };
}

function sanitizeConfig(input: any): SocialIntelligenceScheduleConfig {
  const base = defaultConfig();
  const intradayFrequency = ['manual', '15min', '30min', 'hourly'].includes(String(input?.intraday_frequency || '').trim().toLowerCase())
    ? String(input.intraday_frequency).trim().toLowerCase() as SocialIntradayFrequency
    : base.intraday_frequency;
  const finalizeTime = String(input?.finalize_time_of_day ?? base.finalize_time_of_day).trim();
  return {
    enabled: input?.enabled !== undefined ? Boolean(input.enabled) : base.enabled,
    intraday_frequency: intradayFrequency,
    intraday_timezone: String(input?.intraday_timezone ?? base.intraday_timezone).trim() || base.intraday_timezone,
    intraday_limit: Math.max(0, Number(input?.intraday_limit) || 0),
    intraday_sleep_ms: Math.max(0, Number(input?.intraday_sleep_ms) || base.intraday_sleep_ms),
    finalize_enabled: input?.finalize_enabled !== undefined ? Boolean(input.finalize_enabled) : base.finalize_enabled,
    finalize_time_of_day: /^\d{2}:\d{2}$/.test(finalizeTime) ? finalizeTime : base.finalize_time_of_day,
    finalize_timezone: String(input?.finalize_timezone ?? base.finalize_timezone).trim() || base.finalize_timezone,
  };
}

function loadConfigFile(filePath: string): SocialIntelligenceScheduleConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sanitizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

function loadRuntimeState(key: string): SocialIntelligenceRuntimeState | null {
  const persisted = readJsonDocument<SocialIntelligenceRuntimeState>(SCHEDULER_NAMESPACE, key);
  if (persisted && typeof persisted === 'object') {
    return {
      running: Boolean(persisted.running),
      pid: persisted.pid ?? null,
      last_started_at: persisted.last_started_at ?? null,
      last_finished_at: persisted.last_finished_at ?? null,
      last_exit_code: persisted.last_exit_code ?? null,
      last_source: persisted.last_source ?? null,
      last_error: persisted.last_error ?? null,
      last_message: persisted.last_message ?? null,
    };
  }
  return null;
}

function saveRuntimeState(key: string, state: SocialIntelligenceRuntimeState): void {
  writeJsonDocument(SCHEDULER_NAMESPACE, key, state);
}

function buildIntradayCronExpression(config: SocialIntelligenceScheduleConfig): string | null {
  if (!config.enabled || config.intraday_frequency === 'manual') return null;
  if (config.intraday_frequency === '15min') return '*/15 * * * *';
  if (config.intraday_frequency === '30min') return '*/30 * * * *';
  if (config.intraday_frequency === 'hourly') return '0 * * * *';
  return null;
}

function buildDailyCronExpression(config: SocialIntelligenceScheduleConfig): string | null {
  if (!config.enabled || !config.finalize_enabled) return null;
  const [hourText, minuteText] = String(config.finalize_time_of_day || '').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${minute} ${hour} * * *`;
}

function stopSchedules(): void {
  if (_collectCron) {
    _collectCron.stop();
    _collectCron = null;
  }
  if (_finalizeCron) {
    _finalizeCron.stop();
    _finalizeCron = null;
  }
}

function ensureSchedules(config: SocialIntelligenceScheduleConfig): void {
  stopSchedules();
  const intradayExpression = buildIntradayCronExpression(config);
  if (intradayExpression && cron.validate(intradayExpression)) {
    _collectCron = cron.schedule(intradayExpression, () => void runSocialIntelligenceCollectionNow('scheduled'), {
      timezone: config.intraday_timezone || 'America/Los_Angeles',
    });
  }
  const finalizeExpression = buildDailyCronExpression(config);
  if (finalizeExpression && cron.validate(finalizeExpression)) {
    _finalizeCron = cron.schedule(finalizeExpression, () => void runSocialIntelligenceFinalizeNow('scheduled'), {
      timezone: config.finalize_timezone || 'America/Los_Angeles',
    });
  }
}

function saveConfig(config: SocialIntelligenceScheduleConfig): void {
  _config = { ...config };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8');
  writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, _config);
}

export function loadSocialIntelligenceScheduleConfig(): SocialIntelligenceScheduleConfig {
  if (_config) return { ..._config };
  const persisted = readJsonDocument<SocialIntelligenceScheduleConfig>(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY);
  if (persisted && typeof persisted === 'object') {
    _config = sanitizeConfig(persisted);
    return { ..._config };
  }
  const legacy = loadConfigFile(LOCAL_CONFIG_FILE);
  _config = legacy || defaultConfig();
  return { ..._config };
}

export function saveSocialIntelligenceScheduleConfig(input: Partial<SocialIntelligenceScheduleConfig>): SocialIntelligenceScheduleConfig {
  const next = sanitizeConfig({
    ...loadSocialIntelligenceScheduleConfig(),
    ...(input || {}),
  });
  ensureSchedules(next);
  saveConfig(next);
  return { ...next };
}

function formatScheduleDescription(config: SocialIntelligenceScheduleConfig | null): string {
  if (!config) return 'Not configured';
  const intraday = !config.enabled || config.intraday_frequency === 'manual'
    ? 'Intraday manual only'
    : `Intraday ${config.intraday_frequency} (${config.intraday_timezone})`;
  const finalize = !config.enabled || !config.finalize_enabled
    ? 'Daily finalize disabled'
    : `Daily finalize ${config.finalize_time_of_day} (${config.finalize_timezone})`;
  return `${intraday}; ${finalize}`;
}

function startProcess(
  scriptPath: string,
  args: string[],
  runtimeKey: typeof COLLECT_RUNTIME_DOCUMENT_KEY | typeof FINALIZE_RUNTIME_DOCUMENT_KEY,
  currentRuntime: SocialIntelligenceRuntimeState,
  setRuntime: (state: SocialIntelligenceRuntimeState) => void,
  assignProcess: (proc: ChildProcess | null) => void,
  source: 'manual' | 'scheduled',
  startMessage: string,
): { started: boolean; message: string } {
  const active = runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectProcess : _finalizeProcess;
  if (active) {
    return { started: false, message: 'Job already running.' };
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not available: ${scriptPath}`);
  }
  const child = spawn(getPythonLauncher(), [scriptPath, ...args], {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assignProcess(child);
  const startedAt = new Date().toISOString();
  setRuntime({
    ...currentRuntime,
    running: true,
    pid: child.pid ?? null,
    last_started_at: startedAt,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: startMessage,
  });
  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    setRuntime({
      ...(runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectRuntime : _finalizeRuntime),
      last_message: text,
    });
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    setRuntime({
      ...(runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectRuntime : _finalizeRuntime),
      last_error: text,
      last_message: text,
    });
  });
  child.on('error', (err: any) => {
    assignProcess(null);
    setRuntime({
      ...(runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectRuntime : _finalizeRuntime),
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_error: err?.message || String(err),
    });
  });
  child.on('exit', (code) => {
    assignProcess(null);
    setRuntime({
      ...(runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectRuntime : _finalizeRuntime),
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: code ?? 0,
      last_error: (code ?? 0) === 0 ? null : ((runtimeKey === COLLECT_RUNTIME_DOCUMENT_KEY ? _collectRuntime : _finalizeRuntime).last_error || `Process exited with code ${code}`),
    });
  });
  return { started: true, message: startMessage };
}

function setCollectRuntime(state: SocialIntelligenceRuntimeState): void {
  _collectRuntime = { ...state };
  saveRuntimeState(COLLECT_RUNTIME_DOCUMENT_KEY, _collectRuntime);
}

function setFinalizeRuntime(state: SocialIntelligenceRuntimeState): void {
  _finalizeRuntime = { ...state };
  saveRuntimeState(FINALIZE_RUNTIME_DOCUMENT_KEY, _finalizeRuntime);
}

export function runSocialIntelligenceCollectionNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  const config = loadSocialIntelligenceScheduleConfig();
  const args: string[] = [];
  if (config.intraday_limit > 0) {
    args.push('--limit', String(config.intraday_limit));
  }
  if (config.intraday_sleep_ms >= 0) {
    args.push('--sleep-ms', String(config.intraday_sleep_ms));
  }
  return startProcess(
    COLLECT_SCRIPT,
    args,
    COLLECT_RUNTIME_DOCUMENT_KEY,
    _collectRuntime,
    setCollectRuntime,
    (proc) => { _collectProcess = proc; },
    source,
    '[SocialCollect] Collecting current social posts...',
  );
}

export function runSocialIntelligenceFinalizeNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  return startProcess(
    FINALIZE_SCRIPT,
    [],
    FINALIZE_RUNTIME_DOCUMENT_KEY,
    _finalizeRuntime,
    setFinalizeRuntime,
    (proc) => { _finalizeProcess = proc; },
    source,
    '[SocialDaily] Building daily social snapshot...',
  );
}

export function getSocialIntelligenceScheduleStatus(): {
  config: SocialIntelligenceScheduleConfig;
  collect_runtime: SocialIntelligenceRuntimeState;
  finalize_runtime: SocialIntelligenceRuntimeState;
  schedule_description: string;
} {
  const config = loadSocialIntelligenceScheduleConfig();
  return {
    config,
    collect_runtime: { ..._collectRuntime },
    finalize_runtime: { ..._finalizeRuntime },
    schedule_description: formatScheduleDescription(config),
  };
}

export function resumeSocialIntelligenceSchedulerFromDisk(): boolean {
  const config = loadSocialIntelligenceScheduleConfig();
  ensureSchedules(config);
  return config.enabled;
}

export function hasPersistedSocialIntelligenceSchedulePreference(): boolean {
  return hasJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY) || fs.existsSync(LOCAL_CONFIG_FILE);
}
