import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { hasJsonDocument, readJsonDocument, writeJsonDocument } from './appStateDb';

export type EdgarFrequency = 'manual' | 'hourly' | '4h' | 'daily';

export interface EdgarFilingsScheduleConfig {
  enabled: boolean;
  frequency: EdgarFrequency;
  lookback_hours: number;
  timezone: string;
  time_of_day: string;
}

export interface EdgarFilingsRuntimeState {
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_exit_code?: number | null;
  last_source?: string | null;
  last_error?: string | null;
  last_message?: string | null;
}

const SCHEDULER_NAMESPACE = 'edgar_filings_scheduler';
const CONFIG_DOCUMENT_KEY = 'config';
const RUNTIME_DOCUMENT_KEY = 'collect_runtime';
const COLLECT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_edgar_filings.py');
const LOCAL_CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'preferences', 'edgar-filings-schedule.local.json');

let _cron: ScheduledTask | null = null;
let _config: EdgarFilingsScheduleConfig | null = null;
let _process: ChildProcess | null = null;
let _runtime: EdgarFilingsRuntimeState = loadRuntimeState() || { running: false };

if (_runtime.running) {
  _runtime = { ..._runtime, running: false, pid: null };
  saveRuntimeState(_runtime);
}

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : (process.env.PYTHON || 'python3');
}

function defaultConfig(): EdgarFilingsScheduleConfig {
  return {
    enabled: false,
    frequency: 'manual',
    lookback_hours: 48,
    timezone: 'America/New_York',
    time_of_day: '18:00',
  };
}

function sanitizeConfig(input: any): EdgarFilingsScheduleConfig {
  const base = defaultConfig();
  const frequency = ['manual', 'hourly', '4h', 'daily'].includes(String(input?.frequency || '').trim().toLowerCase())
    ? String(input.frequency).trim().toLowerCase() as EdgarFrequency
    : base.frequency;
  const timeOfDay = String(input?.time_of_day ?? base.time_of_day).trim();
  return {
    enabled: input?.enabled !== undefined ? Boolean(input.enabled) : base.enabled,
    frequency,
    lookback_hours: Math.max(1, Math.min(168, Number(input?.lookback_hours) || base.lookback_hours)),
    timezone: String(input?.timezone ?? base.timezone).trim() || base.timezone,
    time_of_day: /^\d{2}:\d{2}$/.test(timeOfDay) ? timeOfDay : base.time_of_day,
  };
}

function loadConfigFile(filePath: string): EdgarFilingsScheduleConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sanitizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

function loadRuntimeState(): EdgarFilingsRuntimeState | null {
  const persisted = readJsonDocument<EdgarFilingsRuntimeState>(SCHEDULER_NAMESPACE, RUNTIME_DOCUMENT_KEY);
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

function saveRuntimeState(state: EdgarFilingsRuntimeState): void {
  writeJsonDocument(SCHEDULER_NAMESPACE, RUNTIME_DOCUMENT_KEY, state);
}

function buildCronExpression(config: EdgarFilingsScheduleConfig): string | null {
  if (!config.enabled || config.frequency === 'manual') return null;
  if (config.frequency === 'hourly') return '0 * * * *';
  if (config.frequency === '4h') return '0 */4 * * *';
  if (config.frequency === 'daily') {
    const [hourText, minuteText] = String(config.time_of_day || '').split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return `${minute} ${hour} * * 1-5`;
  }
  return null;
}

function stopSchedule(): void {
  if (_cron) {
    _cron.stop();
    _cron = null;
  }
}

function ensureSchedule(config: EdgarFilingsScheduleConfig): void {
  stopSchedule();
  const expression = buildCronExpression(config);
  if (expression && cron.validate(expression)) {
    _cron = cron.schedule(expression, () => void runEdgarCollectionNow('scheduled'), {
      timezone: config.timezone || 'America/New_York',
    });
  }
}

function saveConfig(config: EdgarFilingsScheduleConfig): void {
  _config = { ...config };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8');
  writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, _config);
}

export function loadEdgarFilingsScheduleConfig(): EdgarFilingsScheduleConfig {
  if (_config) return { ..._config };
  const persisted = readJsonDocument<EdgarFilingsScheduleConfig>(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY);
  if (persisted && typeof persisted === 'object') {
    _config = sanitizeConfig(persisted);
    return { ..._config };
  }
  const legacy = loadConfigFile(LOCAL_CONFIG_FILE);
  _config = legacy || defaultConfig();
  return { ..._config };
}

export function saveEdgarFilingsScheduleConfig(input: Partial<EdgarFilingsScheduleConfig>): EdgarFilingsScheduleConfig {
  const next = sanitizeConfig({
    ...loadEdgarFilingsScheduleConfig(),
    ...(input || {}),
  });
  ensureSchedule(next);
  saveConfig(next);
  return { ...next };
}

function formatScheduleDescription(config: EdgarFilingsScheduleConfig | null): string {
  if (!config) return 'Not configured';
  if (!config.enabled || config.frequency === 'manual') return 'Manual only';
  if (config.frequency === 'hourly') return `Hourly (${config.timezone})`;
  if (config.frequency === '4h') return `Every 4 hours (${config.timezone})`;
  if (config.frequency === 'daily') return `Daily at ${config.time_of_day} (${config.timezone}), weekdays`;
  return config.frequency;
}

export function runEdgarCollectionNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  if (_process) {
    return { started: false, message: 'EDGAR collection already running.' };
  }
  if (!fs.existsSync(COLLECT_SCRIPT)) {
    throw new Error(`Script not available: ${COLLECT_SCRIPT}`);
  }

  const config = loadEdgarFilingsScheduleConfig();
  const args = [COLLECT_SCRIPT, '--lookback-hours', String(config.lookback_hours)];

  const child = spawn(getPythonLauncher(), args, {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _process = child;
  const startedAt = new Date().toISOString();
  _runtime = {
    ..._runtime,
    running: true,
    pid: child.pid ?? null,
    last_started_at: startedAt,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: '[EDGAR] Collecting SEC filings...',
  };
  saveRuntimeState(_runtime);

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    _runtime = { ..._runtime, last_message: text };
    saveRuntimeState(_runtime);
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    _runtime = { ..._runtime, last_error: text, last_message: text };
    saveRuntimeState(_runtime);
  });

  child.on('error', (err: any) => {
    _process = null;
    _runtime = {
      ..._runtime,
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_error: err?.message || String(err),
    };
    saveRuntimeState(_runtime);
  });

  child.on('exit', (code) => {
    _process = null;
    _runtime = {
      ..._runtime,
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: code ?? 0,
      last_error: (code ?? 0) === 0 ? null : (_runtime.last_error || `Process exited with code ${code}`),
    };
    saveRuntimeState(_runtime);
  });

  return { started: true, message: `[EDGAR] Collection started (lookback ${config.lookback_hours}h)` };
}

const COLLECT_13F_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_13f_holdings.py');
let _13fProcess: ChildProcess | null = null;
let _13fRuntime: { running: boolean; last_message?: string; last_error?: string; last_finished_at?: string } = { running: false };

export function run13fCollectionNow(): { started: boolean; message: string } {
  if (_13fProcess) {
    return { started: false, message: '13F collection already running.' };
  }
  if (!fs.existsSync(COLLECT_13F_SCRIPT)) {
    throw new Error(`Script not available: ${COLLECT_13F_SCRIPT}`);
  }

  const child = spawn(getPythonLauncher(), [COLLECT_13F_SCRIPT], {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _13fProcess = child;
  _13fRuntime = { running: true, last_message: '[13F] Collecting institutional holdings...' };

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) _13fRuntime = { ..._13fRuntime, last_message: text };
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) _13fRuntime = { ..._13fRuntime, last_error: text };
  });

  child.on('exit', () => {
    _13fProcess = null;
    _13fRuntime = { ..._13fRuntime, running: false, last_finished_at: new Date().toISOString() };
  });

  child.on('error', () => {
    _13fProcess = null;
    _13fRuntime = { ..._13fRuntime, running: false };
  });

  return { started: true, message: '[13F] Collection started for all notable funds' };
}

export function get13fCollectionStatus(): { running: boolean; last_message?: string; last_finished_at?: string } {
  return { ..._13fRuntime };
}

export function getEdgarFilingsScheduleStatus(): {
  config: EdgarFilingsScheduleConfig;
  collect_runtime: EdgarFilingsRuntimeState;
  schedule_description: string;
} {
  const config = loadEdgarFilingsScheduleConfig();
  return {
    config,
    collect_runtime: { ..._runtime },
    schedule_description: formatScheduleDescription(config),
  };
}

export function resumeEdgarFilingsSchedulerFromDisk(): boolean {
  const config = loadEdgarFilingsScheduleConfig();
  ensureSchedule(config);
  return config.enabled;
}

export function hasPersistedEdgarFilingsSchedulePreference(): boolean {
  return hasJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY) || fs.existsSync(LOCAL_CONFIG_FILE);
}
