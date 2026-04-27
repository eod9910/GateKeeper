/**
 * Market Intelligence scheduler.
 *
 * Mirrors the operational pattern of `socialIntelligenceScheduler.ts`, but
 * generalised to a multi-job registry so each collector / engine / rollup can
 * have its own cadence (PRD §Operational Architecture).
 *
 * v1 registers a single job:
 *   - hackernews_collector (every 30 min, disabled by default)
 *
 * Adding more jobs is a matter of appending to JOB_REGISTRY below.
 *
 * Persistence
 *   - Config             json_documents [namespace=market_intelligence_scheduler, key=config]
 *                        + mirrored to backend/data/preferences/market-intelligence-schedule.local.json
 *   - Per-job runtime    json_documents [namespace=market_intelligence_scheduler, key=runtime:<job_name>]
 *
 * Notes
 *   - This service intentionally does NOT call into the synchronous
 *     `POST /collectors/:source_type/run` path (that endpoint stays for ad-hoc
 *     dev triggering). The scheduler spawns its own child processes
 *     fire-and-forget so cron tick handlers return immediately.
 *   - On server start, `resumeMarketIntelligenceSchedulerFromDisk()` rehydrates
 *     config and re-arms cron handlers. Any runtime row that was left in
 *     `running: true` (i.e. a previous server died mid-collection) is reset.
 */

import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  hasJsonDocument,
  readJsonDocument,
  writeJsonDocument,
} from './appStateDb';

// ----------------------------------------------------------------------------
// Constants + paths
// ----------------------------------------------------------------------------

const SCHEDULER_NAMESPACE = 'market_intelligence_scheduler';
const CONFIG_DOCUMENT_KEY = 'config';
const RUNTIME_DOCUMENT_KEY_PREFIX = 'runtime:';

const LOCAL_CONFIG_FILE = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'preferences',
  'market-intelligence-schedule.local.json',
);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const COLLECTOR_SCRIPTS_DIR = path.join(
  PROJECT_ROOT,
  'backend',
  'scripts',
);

function getPythonLauncher(): string {
  return (
    process.env.MI_PYTHON_BIN ||
    (process.platform === 'win32' ? 'py' : process.env.PYTHON || 'python3')
  );
}

// ----------------------------------------------------------------------------
// Job registry — append-only as new collectors / engines / rollups land
// ----------------------------------------------------------------------------

export type JobKind = 'collector' | 'engine' | 'rollup';

export interface JobDefinition {
  /** Stable internal name. Used as the runtime document key suffix. */
  name: string;
  kind: JobKind;
  /** Absolute path to the Python script the job spawns. */
  scriptPath: string;
  /** Default cron expression (overridable in config). */
  defaultCronExpression: string;
  /** Default IANA timezone (overridable in config). */
  defaultTimezone: string;
  /** Human-readable description for the operator UI. */
  description: string;
  /** Default CLI arguments passed to the Python script. */
  defaultArgs: string[];
}

const JOB_REGISTRY: readonly JobDefinition[] = [
  {
    name: 'hackernews_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_hackernews_intraday.py',
    ),
    defaultCronExpression: '*/30 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect Hacker News stories + comments for tracked concepts (PRD D29).',
    defaultArgs: ['--since-hours', '6', '--max-pages', '5'],
  },
  {
    name: 'fourchan_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_fourchan_intraday.py',
    ),
    // Stagger 5 minutes off HN so we don't pound both APIs at the same
    // wall-clock minute. /biz/ + /g/ catalogs roll fast enough that
    // every 30 min is plenty of resolution.
    defaultCronExpression: '5,35 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect 4chan /biz/ + /g/ catalog OPs and last_replies for tracked concepts. ' +
      'Provides cross-platform corroboration alongside the HN collector (PRD D29).',
    defaultArgs: ['--since-hours', '6', '--boards', 'biz,g'],
  },
  {
    name: 'zscore_engine',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'run_zscore_engine.py'),
    defaultCronExpression: '*/15 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Z-score anomaly detection over concept_daily_counts; emits emerging_topics rows (PRD D17).',
    defaultArgs: ['--score-only'],
  },
  {
    name: 'baseline_rebuild',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'run_zscore_engine.py'),
    defaultCronExpression: '30 1 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Nightly rebuild of topic_baselines from concept_daily_counts (PRD §Operational Architecture).',
    defaultArgs: ['--rebuild-baselines'],
  },
  {
    name: 'topic_promotion',
    kind: 'rollup',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'promote_emerging_topics.py'),
    defaultCronExpression: '*/15 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Promote emerging_topics into market_situations rows (PRD: bridge from statistical layer to scenario stream).',
    defaultArgs: [],
  },
] as const;

const JOB_DEFINITIONS_BY_NAME: Record<string, JobDefinition> = JOB_REGISTRY
  .reduce((acc, j) => {
    acc[j.name] = j;
    return acc;
  }, {} as Record<string, JobDefinition>);

// ----------------------------------------------------------------------------
// Config + runtime types
// ----------------------------------------------------------------------------

export interface JobConfig {
  enabled: boolean;
  /** null = use the job's defaultCronExpression. */
  cron_expression: string | null;
  /** null = use the job's defaultTimezone. */
  timezone: string | null;
}

export interface MarketIntelligenceScheduleConfig {
  /** Master switch. When false, no cron handlers are armed regardless of per-job state. */
  enabled: boolean;
  /** Per-job overrides keyed by job name. */
  jobs: Record<string, JobConfig>;
}

export interface JobRuntimeState {
  job_name: string;
  running: boolean;
  pid: number | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_source: 'manual' | 'scheduled' | null;
  last_error: string | null;
  last_message: string | null;
}

// ----------------------------------------------------------------------------
// Module state
// ----------------------------------------------------------------------------

const _cronTasks: Record<string, ScheduledTask | null> = {};
const _runningProcesses: Record<string, ChildProcess | null> = {};
const _runtimes: Record<string, JobRuntimeState> = {};
let _config: MarketIntelligenceScheduleConfig | null = null;

// Initialise per-job runtime state from disk; reset stuck `running: true` rows.
for (const def of JOB_REGISTRY) {
  const persisted = loadRuntimeState(def.name) || initialRuntimeState(def.name);
  const cleaned = persisted.running
    ? { ...persisted, running: false, pid: null }
    : persisted;
  _runtimes[def.name] = cleaned;
  if (persisted.running) {
    saveRuntimeState(cleaned);
  }
  _cronTasks[def.name] = null;
  _runningProcesses[def.name] = null;
}

// ----------------------------------------------------------------------------
// Config IO
// ----------------------------------------------------------------------------

function defaultJobConfig(): JobConfig {
  return { enabled: false, cron_expression: null, timezone: null };
}

function defaultConfig(): MarketIntelligenceScheduleConfig {
  const jobs: Record<string, JobConfig> = {};
  for (const def of JOB_REGISTRY) {
    jobs[def.name] = defaultJobConfig();
  }
  return { enabled: false, jobs };
}

function sanitizeJobConfig(input: unknown): JobConfig {
  const base = defaultJobConfig();
  if (!input || typeof input !== 'object') return base;
  const obj = input as Record<string, unknown>;
  const cronStr = typeof obj.cron_expression === 'string'
    ? obj.cron_expression.trim()
    : '';
  const tzStr = typeof obj.timezone === 'string' ? obj.timezone.trim() : '';
  return {
    enabled: obj.enabled !== undefined ? Boolean(obj.enabled) : base.enabled,
    cron_expression: cronStr.length > 0 ? cronStr : null,
    timezone: tzStr.length > 0 ? tzStr : null,
  };
}

function sanitizeConfig(input: unknown): MarketIntelligenceScheduleConfig {
  const base = defaultConfig();
  if (!input || typeof input !== 'object') return base;
  const obj = input as Record<string, unknown>;
  const enabled = obj.enabled !== undefined ? Boolean(obj.enabled) : base.enabled;
  const jobsInput = (obj.jobs && typeof obj.jobs === 'object')
    ? obj.jobs as Record<string, unknown>
    : {};
  const jobs: Record<string, JobConfig> = {};
  for (const def of JOB_REGISTRY) {
    jobs[def.name] = sanitizeJobConfig(jobsInput[def.name]);
  }
  return { enabled, jobs };
}

function loadConfigFile(filePath: string): MarketIntelligenceScheduleConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sanitizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

function persistConfig(config: MarketIntelligenceScheduleConfig): void {
  _config = { ...config, jobs: { ...config.jobs } };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(
    LOCAL_CONFIG_FILE,
    JSON.stringify(_config, null, 2),
    'utf-8',
  );
  writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, _config);
}

export function loadMarketIntelligenceScheduleConfig(): MarketIntelligenceScheduleConfig {
  if (_config) return cloneConfig(_config);
  const persisted = readJsonDocument<MarketIntelligenceScheduleConfig>(
    SCHEDULER_NAMESPACE,
    CONFIG_DOCUMENT_KEY,
  );
  if (persisted && typeof persisted === 'object') {
    _config = sanitizeConfig(persisted);
    return cloneConfig(_config);
  }
  const legacy = loadConfigFile(LOCAL_CONFIG_FILE);
  _config = legacy || defaultConfig();
  return cloneConfig(_config);
}

function cloneConfig(c: MarketIntelligenceScheduleConfig): MarketIntelligenceScheduleConfig {
  return { enabled: c.enabled, jobs: { ...c.jobs } };
}

// ----------------------------------------------------------------------------
// Runtime IO
// ----------------------------------------------------------------------------

function initialRuntimeState(jobName: string): JobRuntimeState {
  return {
    job_name: jobName,
    running: false,
    pid: null,
    last_started_at: null,
    last_finished_at: null,
    last_exit_code: null,
    last_source: null,
    last_error: null,
    last_message: null,
  };
}

function loadRuntimeState(jobName: string): JobRuntimeState | null {
  const persisted = readJsonDocument<JobRuntimeState>(
    SCHEDULER_NAMESPACE,
    RUNTIME_DOCUMENT_KEY_PREFIX + jobName,
  );
  if (!persisted || typeof persisted !== 'object') return null;
  return {
    job_name: jobName,
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

function saveRuntimeState(state: JobRuntimeState): void {
  _runtimes[state.job_name] = { ...state };
  writeJsonDocument(
    SCHEDULER_NAMESPACE,
    RUNTIME_DOCUMENT_KEY_PREFIX + state.job_name,
    state,
  );
}

// ----------------------------------------------------------------------------
// Cron arming
// ----------------------------------------------------------------------------

function effectiveCronExpression(def: JobDefinition, jc: JobConfig): string {
  return jc.cron_expression && jc.cron_expression.trim().length > 0
    ? jc.cron_expression
    : def.defaultCronExpression;
}

function effectiveTimezone(def: JobDefinition, jc: JobConfig): string {
  return jc.timezone && jc.timezone.trim().length > 0
    ? jc.timezone
    : def.defaultTimezone;
}

function stopJobCron(jobName: string): void {
  const existing = _cronTasks[jobName];
  if (existing) {
    existing.stop();
    _cronTasks[jobName] = null;
  }
}

function stopAllCrons(): void {
  for (const def of JOB_REGISTRY) {
    stopJobCron(def.name);
  }
}

function ensureSchedules(config: MarketIntelligenceScheduleConfig): void {
  stopAllCrons();
  if (!config.enabled) return;
  for (const def of JOB_REGISTRY) {
    const jc = config.jobs[def.name] || defaultJobConfig();
    if (!jc.enabled) continue;
    const expr = effectiveCronExpression(def, jc);
    if (!cron.validate(expr)) {
      console.warn(
        `[marketIntelligenceScheduler] invalid cron expression for ${def.name}: '${expr}' — skipping`,
      );
      continue;
    }
    const tz = effectiveTimezone(def, jc);
    _cronTasks[def.name] = cron.schedule(
      expr,
      () => {
        void runMarketIntelligenceJobNow(def.name, 'scheduled');
      },
      { timezone: tz },
    );
  }
}

// ----------------------------------------------------------------------------
// Process spawning (fire-and-forget)
// ----------------------------------------------------------------------------

function spawnJobProcess(
  def: JobDefinition,
  args: string[],
  source: 'manual' | 'scheduled',
): { started: boolean; message: string } {
  if (_runningProcesses[def.name]) {
    return {
      started: false,
      message: `Job '${def.name}' is already running.`,
    };
  }
  if (!fs.existsSync(def.scriptPath)) {
    const msg = `Script not available: ${def.scriptPath}`;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_source: source,
      last_error: msg,
    });
    return { started: false, message: msg };
  }

  const startedAt = new Date().toISOString();
  const child = spawn(getPythonLauncher(), [def.scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  _runningProcesses[def.name] = child;

  saveRuntimeState({
    job_name: def.name,
    running: true,
    pid: child.pid ?? null,
    last_started_at: startedAt,
    last_finished_at: _runtimes[def.name].last_finished_at,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: `[${def.name}] starting (pid ${child.pid})`,
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveRuntimeState({
      ..._runtimes[def.name],
      last_message: text.length > 1000 ? text.slice(-1000) : text,
    });
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveRuntimeState({
      ..._runtimes[def.name],
      last_error: text.length > 1000 ? text.slice(-1000) : text,
      last_message: text.length > 1000 ? text.slice(-1000) : text,
    });
  });
  child.on('error', (err: Error) => {
    _runningProcesses[def.name] = null;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_error: err.message || String(err),
    });
  });
  child.on('exit', (code) => {
    _runningProcesses[def.name] = null;
    const exitCode = code ?? 0;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: exitCode,
      last_error:
        exitCode === 0
          ? null
          : (_runtimes[def.name].last_error || `Process exited with code ${exitCode}`),
    });
  });

  return {
    started: true,
    message: `[${def.name}] started (pid ${child.pid}) source=${source}`,
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function listMarketIntelligenceJobs(): readonly JobDefinition[] {
  return JOB_REGISTRY;
}

export function getMarketIntelligenceJobDefinition(
  jobName: string,
): JobDefinition | null {
  return JOB_DEFINITIONS_BY_NAME[jobName] || null;
}

export interface UpdateScheduleConfigInput {
  enabled?: boolean;
  jobs?: Record<string, Partial<JobConfig>>;
}

export function saveMarketIntelligenceScheduleConfig(
  input: UpdateScheduleConfigInput,
): MarketIntelligenceScheduleConfig {
  const current = loadMarketIntelligenceScheduleConfig();
  const mergedJobs: Record<string, JobConfig> = { ...current.jobs };
  if (input.jobs && typeof input.jobs === 'object') {
    for (const [name, override] of Object.entries(input.jobs)) {
      if (!JOB_DEFINITIONS_BY_NAME[name]) continue;
      mergedJobs[name] = sanitizeJobConfig({
        ...current.jobs[name],
        ...override,
      });
    }
  }
  const next = sanitizeConfig({
    enabled: input.enabled !== undefined ? input.enabled : current.enabled,
    jobs: mergedJobs,
  });
  ensureSchedules(next);
  persistConfig(next);
  return cloneConfig(next);
}

export function setMarketIntelligenceJobEnabled(
  jobName: string,
  enabled: boolean,
): MarketIntelligenceScheduleConfig {
  if (!JOB_DEFINITIONS_BY_NAME[jobName]) {
    throw new Error(`Unknown job: ${jobName}`);
  }
  return saveMarketIntelligenceScheduleConfig({
    jobs: { [jobName]: { enabled } },
  });
}

export function runMarketIntelligenceJobNow(
  jobName: string,
  source: 'manual' | 'scheduled' = 'manual',
): { started: boolean; message: string } {
  const def = JOB_DEFINITIONS_BY_NAME[jobName];
  if (!def) {
    return { started: false, message: `Unknown job: ${jobName}` };
  }
  return spawnJobProcess(def, def.defaultArgs, source);
}

export interface MarketIntelligenceScheduleStatus {
  config: MarketIntelligenceScheduleConfig;
  jobs: Array<{
    definition: JobDefinition;
    config: JobConfig;
    runtime: JobRuntimeState;
    cron_active: boolean;
    effective_cron_expression: string;
    effective_timezone: string;
  }>;
}

export function getMarketIntelligenceScheduleStatus(): MarketIntelligenceScheduleStatus {
  const config = loadMarketIntelligenceScheduleConfig();
  const jobs = JOB_REGISTRY.map((def) => {
    const jc = config.jobs[def.name] || defaultJobConfig();
    return {
      definition: def,
      config: jc,
      runtime: { ..._runtimes[def.name] },
      cron_active: Boolean(_cronTasks[def.name]),
      effective_cron_expression: effectiveCronExpression(def, jc),
      effective_timezone: effectiveTimezone(def, jc),
    };
  });
  return { config, jobs };
}

export function resumeMarketIntelligenceSchedulerFromDisk(): boolean {
  const config = loadMarketIntelligenceScheduleConfig();
  ensureSchedules(config);
  return config.enabled;
}

export function hasPersistedMarketIntelligenceSchedulePreference(): boolean {
  return (
    hasJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY) ||
    fs.existsSync(LOCAL_CONFIG_FILE)
  );
}
