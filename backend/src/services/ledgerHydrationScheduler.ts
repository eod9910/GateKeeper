import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { hasJsonDocument, readJsonDocument, readLatestHydrationJob, writeJsonDocument } from './appStateDb';

export type LedgerHydrationFrequency = 'manual' | 'daily' | 'weekly';

export interface LedgerHydrationScheduleConfig {
  enabled: boolean;
  frequency: LedgerHydrationFrequency;
  day_of_week: string;
  time_of_day: string;
  timezone: string;
  workers: number;
  annual_count: number;
  quarterly_count: number;
  current_count: number;
  limit: number;
  write_report: boolean;
  refresh_valuations: boolean;
  refresh_reit_supplementals: boolean;
  refresh_yahoo_identity_metadata: boolean;
  refresh_consumer_cycle_classifications: boolean;
  refresh_social_intelligence: boolean;
}

export interface LedgerHydrationRuntimeState {
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_exit_code?: number | null;
  last_source?: string | null;
  last_error?: string | null;
  last_message?: string | null;
  last_report_path?: string | null;
}

export interface ConsumerCycleClassificationRuntimeState {
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_exit_code?: number | null;
  last_source?: string | null;
  last_error?: string | null;
  last_message?: string | null;
}

export interface LedgerHydrationJobProgress {
  job_id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  candidate_count?: number | null;
  completed_count?: number | null;
  remaining_count?: number | null;
  failed_count?: number | null;
  workers?: number | null;
  progress_pct?: number | null;
  elapsed_seconds?: number | null;
  avg_seconds_per_symbol?: number | null;
  symbols_per_hour?: number | null;
  eta_seconds?: number | null;
  eta_display?: string | null;
  last_message?: string | null;
  report_path?: string | null;
}

const LEGACY_CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'ledger-hydration-schedule.json');
const LOCAL_CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'preferences', 'ledger-hydration-schedule.local.json');
const RUNTIME_STATE_FILE = path.join(__dirname, '..', '..', 'data', 'preferences', 'ledger-hydration-runtime.local.json');
const RESEARCH_DIR = path.join(__dirname, '..', '..', 'data', 'research');
const SYNC_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'sync_ledger_coverage_from_canonical.py');
const REIT_SUPPLEMENTAL_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_reit_supplementals.py');
const VALUATION_SNAPSHOT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'build_universe_valuation_snapshot.py');
const VALUATION_REGIME_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'build_valuation_regime_universes.py');
const YAHOO_IDENTITY_ENRICHMENT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'enrich_symbol_catalog_from_yahoo.py');
const CONSUMER_CYCLE_CLASSIFICATION_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'backfill_symbol_classifications.py');
const SOCIAL_COLLECT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_social_intraday.py');
const SOCIAL_FINALIZE_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'build_social_daily_snapshot.py');
const SCHEDULER_NAMESPACE = 'ledger_hydration_scheduler';
const CONFIG_DOCUMENT_KEY = 'config';
const RUNTIME_DOCUMENT_KEY = 'runtime';
const CONSUMER_CYCLE_RUNTIME_DOCUMENT_KEY = 'consumer_cycle_classification_runtime';
const DEFAULT_REIT_SUPPLEMENTAL_DOWNLOAD_LIMIT = 1200;
const DEFAULT_REIT_SUPPLEMENTAL_SYMBOL_LIMIT = 0;
const DEFAULT_REIT_SUPPLEMENTAL_MAX_SEC_FILINGS = 40;

let _cronJob: ScheduledTask | null = null;
let _config: LedgerHydrationScheduleConfig | null = null;
let _activeProcess: ChildProcess | null = null;
let _consumerCycleProcess: ChildProcess | null = null;
let _runtimeState: LedgerHydrationRuntimeState = loadRuntimeState() || { running: false };
if (_runtimeState.running) {
  _runtimeState = {
    ..._runtimeState,
    running: false,
    pid: null,
  };
  saveRuntimeState(_runtimeState);
}
let _consumerCycleRuntimeState: ConsumerCycleClassificationRuntimeState = loadConsumerCycleRuntimeState() || { running: false };
if (_consumerCycleRuntimeState.running) {
  _consumerCycleRuntimeState = {
    ..._consumerCycleRuntimeState,
    running: false,
    pid: null,
  };
  saveConsumerCycleRuntimeState(_consumerCycleRuntimeState);
}

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : (process.env.PYTHON || 'python3');
}

function defaultConfig(): LedgerHydrationScheduleConfig {
  return {
    enabled: false,
    frequency: 'manual',
    day_of_week: '0',
    time_of_day: '02:00',
    timezone: 'America/Los_Angeles',
    workers: 3,
    annual_count: 1,
    quarterly_count: 2,
    current_count: 6,
    limit: 0,
    write_report: true,
    refresh_valuations: true,
    refresh_reit_supplementals: true,
    refresh_yahoo_identity_metadata: true,
    refresh_consumer_cycle_classifications: true,
    refresh_social_intelligence: true,
  };
}

function readConfigFile(filePath: string): LedgerHydrationScheduleConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return sanitizeConfig(parsed);
  } catch {
    return null;
  }
}

function sanitizeConfig(input: any): LedgerHydrationScheduleConfig {
  const base = defaultConfig();
  const frequency = ['manual', 'daily', 'weekly'].includes(String(input?.frequency || '').trim().toLowerCase())
    ? String(input.frequency).trim().toLowerCase() as LedgerHydrationFrequency
    : base.frequency;
  const day = String(input?.day_of_week ?? base.day_of_week).trim();
  const timeOfDay = String(input?.time_of_day ?? base.time_of_day).trim();
  const timezone = String(input?.timezone ?? base.timezone).trim() || base.timezone;
  return {
    enabled: Boolean(input?.enabled),
    frequency,
    day_of_week: /^[0-6]$/.test(day) ? day : base.day_of_week,
    time_of_day: /^\d{2}:\d{2}$/.test(timeOfDay) ? timeOfDay : base.time_of_day,
    timezone,
    workers: Math.max(1, Math.min(8, Number(input?.workers) || base.workers)),
    annual_count: Math.max(0, Number(input?.annual_count) || base.annual_count),
    quarterly_count: Math.max(0, Number(input?.quarterly_count) || base.quarterly_count),
    current_count: Math.max(0, Number(input?.current_count) || base.current_count),
    limit: Math.max(0, Number(input?.limit) || 0),
    write_report: input?.write_report !== undefined ? Boolean(input.write_report) : base.write_report,
    refresh_valuations: input?.refresh_valuations !== undefined ? Boolean(input.refresh_valuations) : base.refresh_valuations,
    refresh_reit_supplementals:
      input?.refresh_reit_supplementals !== undefined
        ? Boolean(input.refresh_reit_supplementals)
        : base.refresh_reit_supplementals,
    refresh_yahoo_identity_metadata:
      input?.refresh_yahoo_identity_metadata !== undefined
        ? Boolean(input.refresh_yahoo_identity_metadata)
        : base.refresh_yahoo_identity_metadata,
    refresh_consumer_cycle_classifications:
      input?.refresh_consumer_cycle_classifications !== undefined
        ? Boolean(input.refresh_consumer_cycle_classifications)
        : base.refresh_consumer_cycle_classifications,
    refresh_social_intelligence:
      input?.refresh_social_intelligence !== undefined
        ? Boolean(input.refresh_social_intelligence)
        : base.refresh_social_intelligence,
  };
}

function buildCronExpression(config: LedgerHydrationScheduleConfig): string | null {
  const [hourText, minuteText] = String(config.time_of_day || '').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  if (config.frequency === 'daily') {
    return `${minute} ${hour} * * *`;
  }
  if (config.frequency === 'weekly') {
    return `${minute} ${hour} * * ${config.day_of_week}`;
  }
  return null;
}

function formatDurationShort(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function parseIsoMs(value?: string | null): number | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function parseReportStartedAtFromPath(reportPath?: string | null): string | null {
  const text = String(reportPath || '').trim();
  if (!text) return null;
  const match = text.match(/ledger_canonical_sync_(\d{8})T(\d{6})Z\.json$/i);
  if (!match) return null;
  const [, ymd, hms] = match;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
}

function detectExternalHydrationActivity(): { running: boolean; workerCount: number } {
  try {
    if (process.platform === 'win32') {
      const script = [
        '$procs = Get-CimInstance Win32_Process | Where-Object {',
        "  ($_.CommandLine -match 'sync_ledger_coverage_from_canonical\\.py') -or",
        "  ($_.CommandLine -match 'hydrate_ledger_company\\.py')",
        '} | Select-Object ProcessId, Name, CommandLine',
        "$sync = @($procs | Where-Object { $_.CommandLine -match 'sync_ledger_coverage_from_canonical\\.py' }).Count",
        "$workers = @($procs | Where-Object { $_.CommandLine -match 'hydrate_ledger_company\\.py' }).Count",
        'Write-Output (@{ running = (($sync -gt 0) -or ($workers -gt 0)); workerCount = $workers } | ConvertTo-Json -Compress)',
      ].join('; ');
      const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      if (result.status === 0 && result.stdout) {
        const parsed = JSON.parse(String(result.stdout).trim());
        return {
          running: Boolean(parsed?.running),
          workerCount: Number(parsed?.workerCount || 0),
        };
      }
    } else {
      const result = spawnSync('sh', ['-lc', "ps -axo command | egrep 'sync_ledger_coverage_from_canonical.py|hydrate_ledger_company.py' | grep -v egrep"], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const lines = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const workerCount = lines.filter((line) => /hydrate_ledger_company\.py/.test(line)).length;
      return {
        running: lines.length > 0,
        workerCount,
      };
    }
  } catch {
    // fall through
  }
  return { running: false, workerCount: 0 };
}

function readLatestHydrationReportProgress(): LedgerHydrationJobProgress | null {
  try {
    if (!fs.existsSync(RESEARCH_DIR)) return null;
    const files = fs.readdirSync(RESEARCH_DIR)
      .filter((name) => /^ledger_canonical_sync_\d{8}T\d{6}Z\.json$/i.test(name))
      .map((name) => {
        const fullPath = path.join(RESEARCH_DIR, name);
        const stat = fs.statSync(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = files[0];
    if (!latest) return null;
    const raw = JSON.parse(fs.readFileSync(latest.fullPath, 'utf-8'));
    const summary = raw?.summary && typeof raw.summary === 'object' ? raw.summary : {};
    const candidateCount = Number(summary?.candidate_count ?? 0) || null;
    const completedCount = Number(summary?.completed_count ?? 0) || 0;
    const failedCount = Number(summary?.failed_count ?? 0) || 0;
    const workers = Number(summary?.workers ?? 0) || null;
    const startedAt = parseReportStartedAtFromPath(latest.fullPath);
    const nowMs = Date.now();
    const startedMs = parseIsoMs(startedAt);
    const updatedAt = new Date(latest.mtimeMs).toISOString();
    const elapsedSeconds = startedMs != null ? Math.max(0, Math.round((nowMs - startedMs) / 1000)) : null;
    const remainingCount = candidateCount != null ? Math.max(0, candidateCount - completedCount) : null;
    const progressPct = candidateCount && candidateCount > 0
      ? Number(((completedCount / candidateCount) * 100).toFixed(1))
      : null;
    const avgSecondsPerSymbol = elapsedSeconds && completedCount > 0
      ? Number((elapsedSeconds / completedCount).toFixed(2))
      : null;
    const symbolsPerHour = elapsedSeconds && completedCount > 0
      ? Number(((completedCount / elapsedSeconds) * 3600).toFixed(1))
      : null;
    const etaSeconds = avgSecondsPerSymbol != null && remainingCount != null && remainingCount > 0
      ? Math.round(avgSecondsPerSymbol * remainingCount)
      : null;
    const lastRow = Array.isArray(raw?.rows) && raw.rows.length ? raw.rows[raw.rows.length - 1] : null;
    const lastMessage = lastRow?.symbol
      ? `[LedgerSync] [${completedCount}/${candidateCount || '?'}] ${lastRow.symbol}: status=${lastRow.status || 'unknown'}`
      : null;
    return {
      job_id: path.basename(latest.fullPath, '.json'),
      status: 'running',
      started_at: startedAt,
      completed_at: null,
      updated_at: updatedAt,
      candidate_count: candidateCount,
      completed_count: completedCount,
      remaining_count: remainingCount,
      failed_count: failedCount,
      workers,
      progress_pct: progressPct,
      elapsed_seconds: elapsedSeconds,
      avg_seconds_per_symbol: avgSecondsPerSymbol,
      symbols_per_hour: symbolsPerHour,
      eta_seconds: etaSeconds,
      eta_display: etaSeconds != null ? formatDurationShort(etaSeconds) : null,
      last_message: lastMessage,
      report_path: latest.fullPath,
    };
  } catch {
    return null;
  }
}

function formatScheduleDescription(config: LedgerHydrationScheduleConfig | null): string {
  if (!config) return 'Not configured';
  if (!config.enabled || config.frequency === 'manual') return 'Manual only';
  const freq = config.frequency === 'weekly' ? `Weekly on ${weekdayLabel(config.day_of_week)}` : 'Daily';
  return `${freq} at ${config.time_of_day} (${config.timezone})`;
}

function weekdayLabel(value: string): string {
  return ({
    '0': 'Sunday',
    '1': 'Monday',
    '2': 'Tuesday',
    '3': 'Wednesday',
    '4': 'Thursday',
    '5': 'Friday',
    '6': 'Saturday',
  } as Record<string, string>)[value] || 'Sunday';
}

function loadRuntimeState(): LedgerHydrationRuntimeState | null {
  const persisted = readJsonDocument<LedgerHydrationRuntimeState>(
    SCHEDULER_NAMESPACE,
    RUNTIME_DOCUMENT_KEY,
  );
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
      last_report_path: persisted.last_report_path ?? null,
    };
  }
  try {
    if (!fs.existsSync(RUNTIME_STATE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(RUNTIME_STATE_FILE, 'utf-8'));
    const normalized = parsed && typeof parsed === 'object'
      ? ({
          running: Boolean(parsed.running),
          pid: parsed.pid ?? null,
          last_started_at: parsed.last_started_at ?? null,
          last_finished_at: parsed.last_finished_at ?? null,
          last_exit_code: parsed.last_exit_code ?? null,
          last_source: parsed.last_source ?? null,
          last_error: parsed.last_error ?? null,
          last_message: parsed.last_message ?? null,
          last_report_path: parsed.last_report_path ?? null,
        } satisfies LedgerHydrationRuntimeState)
      : null;
    if (normalized) {
      writeJsonDocument(SCHEDULER_NAMESPACE, RUNTIME_DOCUMENT_KEY, normalized);
    }
    return normalized;
  } catch {
    return null;
  }
}

function saveRuntimeState(state: LedgerHydrationRuntimeState): void {
  _runtimeState = { ...state };
  writeJsonDocument(SCHEDULER_NAMESPACE, RUNTIME_DOCUMENT_KEY, _runtimeState);
}

function loadConsumerCycleRuntimeState(): ConsumerCycleClassificationRuntimeState | null {
  const persisted = readJsonDocument<ConsumerCycleClassificationRuntimeState>(
    SCHEDULER_NAMESPACE,
    CONSUMER_CYCLE_RUNTIME_DOCUMENT_KEY,
  );
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

function saveConsumerCycleRuntimeState(state: ConsumerCycleClassificationRuntimeState): void {
  _consumerCycleRuntimeState = { ...state };
  writeJsonDocument(SCHEDULER_NAMESPACE, CONSUMER_CYCLE_RUNTIME_DOCUMENT_KEY, _consumerCycleRuntimeState);
}

function stopScheduledTask(): void {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
}

function ensureSchedule(config: LedgerHydrationScheduleConfig): void {
  stopScheduledTask();
  if (!config.enabled || config.frequency === 'manual') return;
  const expression = buildCronExpression(config);
  if (!expression || !cron.validate(expression)) {
    throw new Error(`Invalid hydration schedule: ${config.frequency} ${config.time_of_day}`);
  }
  _cronJob = cron.schedule(
    expression,
    () => {
      void runLedgerHydrationNow('scheduled');
    },
    { timezone: config.timezone || 'America/Los_Angeles' },
  );
}

function buildProcessArgs(config: LedgerHydrationScheduleConfig): string[] {
  const args = [
    SYNC_SCRIPT,
    '--annual-count', String(config.annual_count),
    '--quarterly-count', String(config.quarterly_count),
    '--current-count', String(config.current_count),
    '--workers', String(config.workers),
  ];
  if (config.limit > 0) {
    args.push('--limit', String(config.limit));
  }
  if (config.write_report) {
    args.push('--write-report');
  }
  return args;
}

function updateRuntimeMessage(text: string): void {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  const nextState: LedgerHydrationRuntimeState = {
    ..._runtimeState,
    last_message: trimmed,
  };
  const reportMatch = trimmed.match(/\[LedgerSync\] Report written to (.+)$/);
  if (reportMatch?.[1]) {
    nextState.last_report_path = reportMatch[1].trim();
  }
  saveRuntimeState(nextState);
}

function finishRun(exitCode: number | null | undefined, errorText?: string | null): void {
  _activeProcess = null;
  saveRuntimeState({
    ..._runtimeState,
    running: false,
    pid: null,
    last_finished_at: new Date().toISOString(),
    last_exit_code: exitCode ?? 0,
    last_error: errorText || ((exitCode && exitCode !== 0) ? (_runtimeState.last_error || `Process exited with code ${exitCode}`) : null),
  });
}

function finishConsumerCycleRun(exitCode: number | null | undefined, errorText?: string | null): void {
  _consumerCycleProcess = null;
  saveConsumerCycleRuntimeState({
    ..._consumerCycleRuntimeState,
    running: false,
    pid: null,
    last_finished_at: new Date().toISOString(),
    last_exit_code: exitCode ?? 0,
    last_error: errorText || ((exitCode && exitCode !== 0) ? (_consumerCycleRuntimeState.last_error || `Process exited with code ${exitCode}`) : null),
  });
}

function startPythonProcess(
  args: string[],
  {
    source,
    startMessage,
    successMessage,
    preserveStartedAt,
    onSuccess,
  }: {
    source: 'manual' | 'scheduled';
    startMessage: string;
    successMessage?: string;
    preserveStartedAt?: boolean;
    onSuccess?: () => void;
  },
): void {
  const child = spawn(getPythonLauncher(), args, {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _activeProcess = child;
  saveRuntimeState({
    ..._runtimeState,
    running: true,
    pid: child.pid ?? null,
    last_started_at: preserveStartedAt ? (_runtimeState.last_started_at || new Date().toISOString()) : new Date().toISOString(),
    last_finished_at: _runtimeState.last_finished_at ?? null,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: startMessage,
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) updateRuntimeMessage(text);
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveRuntimeState({
      ..._runtimeState,
      last_error: text,
      last_message: text,
    });
  });

  child.on('error', (err: any) => {
    finishRun(-1, err?.message || String(err));
  });

  child.on('exit', (code) => {
    _activeProcess = null;
    if ((code ?? 0) === 0 && onSuccess) {
      if (successMessage) updateRuntimeMessage(successMessage);
      onSuccess();
      return;
    }
    finishRun(code ?? 0);
  });
}

function startValuationRefreshSequence(config: LedgerHydrationScheduleConfig, source: 'manual' | 'scheduled'): void {
  if (!fs.existsSync(VALUATION_SNAPSHOT_SCRIPT)) {
    finishRun(-1, 'Valuation snapshot script is not available.');
    return;
  }
  if (!fs.existsSync(VALUATION_REGIME_SCRIPT)) {
    finishRun(-1, 'Valuation regime universe script is not available.');
    return;
  }

  const startSnapshotRefresh = () => {
    startPythonProcess(
      [VALUATION_SNAPSHOT_SCRIPT],
      {
        source,
        startMessage: '[ValuationRefresh] Rebuilding universe valuation snapshot...',
        successMessage: '[ValuationRefresh] Universe valuation snapshot rebuilt.',
        preserveStartedAt: true,
        onSuccess: () => {
              startPythonProcess(
            [VALUATION_REGIME_SCRIPT],
            {
              source,
              startMessage: '[ValuationRefresh] Rebuilding valuation regime universes...',
              successMessage: '[ValuationRefresh] Valuation regime universes rebuilt.',
              preserveStartedAt: true,
              onSuccess: () => {
                startPostHydrationMetadataRefreshSequence(config, source);
              },
            },
          );
        },
      },
    );
  };

  if (config.refresh_reit_supplementals) {
    if (!fs.existsSync(REIT_SUPPLEMENTAL_SCRIPT)) {
      finishRun(-1, 'REIT supplemental collection script is not available.');
      return;
    }
    startPythonProcess(
      [
        REIT_SUPPLEMENTAL_SCRIPT,
        '--init-source-map',
        '--discover',
        '--download',
        '--docling',
        '--extract-docling',
        '--promote-docling',
        '--limit',
        String(Number(process.env.REIT_SUPPLEMENTAL_DOWNLOAD_LIMIT || DEFAULT_REIT_SUPPLEMENTAL_DOWNLOAD_LIMIT) || DEFAULT_REIT_SUPPLEMENTAL_DOWNLOAD_LIMIT),
        '--max-symbols',
        String(Number(process.env.REIT_SUPPLEMENTAL_SYMBOL_LIMIT || DEFAULT_REIT_SUPPLEMENTAL_SYMBOL_LIMIT) || DEFAULT_REIT_SUPPLEMENTAL_SYMBOL_LIMIT),
        '--max-sec-filings',
        String(Number(process.env.REIT_SUPPLEMENTAL_MAX_SEC_FILINGS || DEFAULT_REIT_SUPPLEMENTAL_MAX_SEC_FILINGS) || DEFAULT_REIT_SUPPLEMENTAL_MAX_SEC_FILINGS),
      ],
      {
        source,
        startMessage: '[REITSupplementals] Refreshing REIT supplemental documents and normalized facts...',
        successMessage: '[REITSupplementals] REIT supplemental facts refreshed. Starting valuation refresh...',
        preserveStartedAt: true,
        onSuccess: startSnapshotRefresh,
      },
    );
    return;
  }

  startSnapshotRefresh();
}

function startYahooIdentityRefreshSequence(
  config: LedgerHydrationScheduleConfig,
  source: 'manual' | 'scheduled',
): void {
  if (!fs.existsSync(YAHOO_IDENTITY_ENRICHMENT_SCRIPT)) {
    finishRun(-1, 'Yahoo identity enrichment script is not available.');
    return;
  }

  startPythonProcess(
    [
      YAHOO_IDENTITY_ENRICHMENT_SCRIPT,
      '--max-attempts',
      '6',
      '--base-delay-seconds',
      '3',
      '--sleep-between-symbols-ms',
      '250',
    ],
    {
      source,
      startMessage: '[YahooIdentity] Refreshing clean-universe symbol identity metadata...',
      successMessage: '[YahooIdentity] Clean-universe symbol identity metadata refreshed.',
      preserveStartedAt: true,
      onSuccess: () => {
        if (config.refresh_consumer_cycle_classifications) {
          startConsumerCycleClassificationProcess(source, () => {
            startPostHydrationSocialRefreshSequence(config, source);
          });
          return;
        }
        startPostHydrationSocialRefreshSequence(config, source);
      },
    },
  );
}

function startPostHydrationSocialRefreshSequence(
  config: LedgerHydrationScheduleConfig,
  source: 'manual' | 'scheduled',
): void {
  if (config.refresh_social_intelligence) {
    startSocialIntelligenceRefreshSequence(source);
    return;
  }
  finishRun(0, null);
}

function startPostHydrationMetadataRefreshSequence(
  config: LedgerHydrationScheduleConfig,
  source: 'manual' | 'scheduled',
): void {
  if (config.refresh_yahoo_identity_metadata) {
    startYahooIdentityRefreshSequence(config, source);
    return;
  }
  if (config.refresh_consumer_cycle_classifications) {
    startConsumerCycleClassificationProcess(source, () => {
      startPostHydrationSocialRefreshSequence(config, source);
    });
    return;
  }
  startPostHydrationSocialRefreshSequence(config, source);
}

function startSocialIntelligenceRefreshSequence(source: 'manual' | 'scheduled'): void {
  if (!fs.existsSync(SOCIAL_COLLECT_SCRIPT)) {
    finishRun(-1, 'Social intelligence collection script is not available.');
    return;
  }
  if (!fs.existsSync(SOCIAL_FINALIZE_SCRIPT)) {
    finishRun(-1, 'Social intelligence finalizer script is not available.');
    return;
  }

  startPythonProcess(
    [
      SOCIAL_COLLECT_SCRIPT,
      '--sleep-ms',
      '250',
    ],
    {
      source,
      startMessage: '[SocialIntel] Collecting full clean-universe social data...',
      successMessage: '[SocialIntel] Social collection complete. Building daily buzz snapshot...',
      preserveStartedAt: true,
      onSuccess: () => {
        startPythonProcess(
          [SOCIAL_FINALIZE_SCRIPT],
          {
            source,
            startMessage: '[SocialIntel] Finalizing daily social snapshot...',
            successMessage: '[SocialIntel] Social intelligence refresh complete.',
            preserveStartedAt: true,
            onSuccess: () => finishRun(0, null),
          },
        );
      },
    },
  );
}

function startConsumerCycleClassificationProcess(source: 'manual' | 'scheduled', onSuccess?: () => void): void {
  if (!fs.existsSync(CONSUMER_CYCLE_CLASSIFICATION_SCRIPT)) {
    finishConsumerCycleRun(-1, 'Consumer-cycle classification script is not available.');
    return;
  }
  const child = spawn(getPythonLauncher(), [CONSUMER_CYCLE_CLASSIFICATION_SCRIPT, '--force'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _consumerCycleProcess = child;
  saveConsumerCycleRuntimeState({
    ..._consumerCycleRuntimeState,
    running: true,
    pid: child.pid ?? null,
    last_started_at: new Date().toISOString(),
    last_finished_at: _consumerCycleRuntimeState.last_finished_at ?? null,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: '[ConsumerCycle] Refreshing consumer-cycle classifications...',
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveConsumerCycleRuntimeState({
      ..._consumerCycleRuntimeState,
      last_message: text,
    });
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveConsumerCycleRuntimeState({
      ..._consumerCycleRuntimeState,
      last_error: text,
      last_message: text,
    });
  });

  child.on('error', (err: any) => {
    finishConsumerCycleRun(-1, err?.message || String(err));
  });

  child.on('exit', (code) => {
    _consumerCycleProcess = null;
    if ((code ?? 0) === 0) {
      saveConsumerCycleRuntimeState({
        ..._consumerCycleRuntimeState,
        last_message: '[ConsumerCycle] Classification refresh complete.',
      });
      finishConsumerCycleRun(0, null);
      if (onSuccess) onSuccess();
      return;
    }
    finishConsumerCycleRun(code ?? 0);
  });
}

export function loadLedgerHydrationScheduleConfig(): LedgerHydrationScheduleConfig {
  const persisted = readJsonDocument<LedgerHydrationScheduleConfig>(
    SCHEDULER_NAMESPACE,
    CONFIG_DOCUMENT_KEY,
  );
  if (persisted && typeof persisted === 'object') {
    return sanitizeConfig(persisted);
  }
  const legacy = readConfigFile(LOCAL_CONFIG_FILE) || readConfigFile(LEGACY_CONFIG_FILE);
  if (legacy) {
    writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, legacy);
    return legacy;
  }
  return defaultConfig();
}

export function saveLedgerHydrationScheduleConfig(input: LedgerHydrationScheduleConfig): LedgerHydrationScheduleConfig {
  const config = sanitizeConfig(input);
  writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, config);
  _config = config;
  ensureSchedule(config);
  return config;
}

export function hasEnabledLedgerHydrationSchedule(): boolean {
  const config = loadLedgerHydrationScheduleConfig();
  return Boolean(config.enabled && config.frequency !== 'manual');
}

export function hasPersistedLedgerHydrationSchedulePreference(): boolean {
  return hasJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY)
    || fs.existsSync(LOCAL_CONFIG_FILE)
    || fs.existsSync(LEGACY_CONFIG_FILE);
}

export function getLedgerHydrationScheduleStatus(): {
  config: LedgerHydrationScheduleConfig;
  runtime: LedgerHydrationRuntimeState;
  consumer_cycle_runtime: ConsumerCycleClassificationRuntimeState;
  latest_job: LedgerHydrationJobProgress | null;
  scheduled: boolean;
  schedule_description: string;
} {
  const config = _config || loadLedgerHydrationScheduleConfig();
  _config = config;
  const latestJobRecord = readLatestHydrationJob<{
    job?: {
      job_id?: string;
      status?: string;
      started_at?: string | null;
      completed_at?: string | null;
      candidate_count?: number;
      completed_count?: number;
      remaining_count?: number;
      failed_count?: number;
      workers?: number;
      progress_pct?: number;
      elapsed_seconds?: number;
      avg_seconds_per_symbol?: number | null;
      symbols_per_hour?: number | null;
      eta_seconds?: number | null;
      eta_display?: string | null;
      last_message?: string | null;
      report_path?: string | null;
    };
  }>('ledger_sync');
  const latestJobFromDb = latestJobRecord?.payload?.job
    ? {
        job_id: latestJobRecord.payload.job.job_id || latestJobRecord.job_id,
        status: latestJobRecord.payload.job.status || latestJobRecord.status,
        started_at: latestJobRecord.payload.job.started_at ?? latestJobRecord.started_at ?? null,
        completed_at: latestJobRecord.payload.job.completed_at ?? latestJobRecord.completed_at ?? null,
        updated_at: latestJobRecord.updated_at,
        candidate_count: latestJobRecord.payload.job.candidate_count ?? null,
        completed_count: latestJobRecord.payload.job.completed_count ?? null,
        remaining_count: latestJobRecord.payload.job.remaining_count ?? null,
        failed_count: latestJobRecord.payload.job.failed_count ?? null,
        workers: latestJobRecord.payload.job.workers ?? null,
        progress_pct: latestJobRecord.payload.job.progress_pct ?? null,
        elapsed_seconds: latestJobRecord.payload.job.elapsed_seconds ?? null,
        avg_seconds_per_symbol: latestJobRecord.payload.job.avg_seconds_per_symbol ?? null,
        symbols_per_hour: latestJobRecord.payload.job.symbols_per_hour ?? null,
        eta_seconds: latestJobRecord.payload.job.eta_seconds ?? null,
        eta_display: latestJobRecord.payload.job.eta_display ?? null,
        last_message: latestJobRecord.payload.job.last_message ?? null,
        report_path: latestJobRecord.payload.job.report_path ?? null,
      } satisfies LedgerHydrationJobProgress
    : null;
  const liveReportJob = readLatestHydrationReportProgress();
  const externalActivity = detectExternalHydrationActivity();
  const latestJob = (() => {
    if (!liveReportJob) return latestJobFromDb;
    const dbUpdatedMs = parseIsoMs(latestJobFromDb?.updated_at);
    const reportUpdatedMs = parseIsoMs(liveReportJob.updated_at);
    if (reportUpdatedMs != null && (dbUpdatedMs == null || reportUpdatedMs > dbUpdatedMs)) {
      return {
        ...(latestJobFromDb || {}),
        ...liveReportJob,
        status: externalActivity.running ? 'running' : (liveReportJob.status || latestJobFromDb?.status || 'running'),
      } satisfies LedgerHydrationJobProgress;
    }
    return latestJobFromDb;
  })();
  const isRunning =
    Boolean(_activeProcess && !_activeProcess.killed) ||
    Boolean(externalActivity.running) ||
    latestJob?.status === 'running';
  return {
    config,
    runtime: {
      ..._runtimeState,
      running: isRunning,
      last_started_at: latestJob?.started_at || _runtimeState.last_started_at || null,
      last_message: (isRunning ? latestJob?.last_message : null) || _runtimeState.last_message || null,
      last_report_path: (isRunning ? latestJob?.report_path : null) || _runtimeState.last_report_path || null,
    },
    consumer_cycle_runtime: {
      ..._consumerCycleRuntimeState,
      running: Boolean(_consumerCycleProcess && !_consumerCycleProcess.killed) || Boolean(_consumerCycleRuntimeState.running),
    },
    latest_job: latestJob,
    scheduled: Boolean(_cronJob && config.enabled && config.frequency !== 'manual'),
    schedule_description: formatScheduleDescription(config),
  };
}

export function runLedgerHydrationNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  const config = _config || loadLedgerHydrationScheduleConfig();
  _config = config;
  if (!fs.existsSync(SYNC_SCRIPT)) {
    throw new Error('Ledger hydration sync script is not available.');
  }
  if (_activeProcess && !_activeProcess.killed) {
    return { started: false, message: 'A Ledger hydration job is already running.' };
  }

  startPythonProcess(
    buildProcessArgs(config),
    {
      source,
      startMessage: `[LedgerSync] Started ${source} run`,
      successMessage: config.refresh_valuations
        ? config.refresh_reit_supplementals
          ? '[LedgerSync] Hydration complete. Starting REIT supplemental refresh and valuation refresh...'
          : '[LedgerSync] Hydration complete. Starting valuation refresh...'
      : config.refresh_yahoo_identity_metadata
          ? '[LedgerSync] Hydration complete. Starting Yahoo identity refresh...'
        : config.refresh_consumer_cycle_classifications
          ? '[LedgerSync] Hydration complete. Starting consumer-cycle classification refresh...'
        : config.refresh_social_intelligence
          ? '[LedgerSync] Hydration complete. Starting social intelligence refresh...'
          : '[LedgerSync] Hydration complete.',
      onSuccess: config.refresh_valuations
        ? () => startValuationRefreshSequence(config, source)
        : config.refresh_yahoo_identity_metadata
          ? () => startYahooIdentityRefreshSequence(config, source)
        : config.refresh_consumer_cycle_classifications
          ? () => startConsumerCycleClassificationProcess(source, () => {
              startPostHydrationSocialRefreshSequence(config, source);
            })
        : config.refresh_social_intelligence
          ? () => startSocialIntelligenceRefreshSequence(source)
          : () => finishRun(0, null),
    },
  );
  return {
    started: true,
    message: config.refresh_valuations
      ? config.refresh_reit_supplementals
        ? 'Ledger hydration job started. REIT supplementals and valuation refresh will run automatically after hydration.'
        : 'Ledger hydration job started. Valuation refresh will run automatically after hydration.'
      : config.refresh_yahoo_identity_metadata
        ? 'Ledger hydration job started. Yahoo identity refresh will run automatically after hydration.'
      : config.refresh_consumer_cycle_classifications
        ? 'Ledger hydration job started. Consumer-cycle classification refresh will run automatically after hydration.'
      : config.refresh_social_intelligence
        ? 'Ledger hydration job started. Social intelligence refresh will run automatically after hydration.'
      : 'Ledger hydration job started.',
  };
}

export function runConsumerCycleClassificationNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  if (_activeProcess && !_activeProcess.killed) {
    return { started: false, message: 'A Ledger hydration or valuation job is already running.' };
  }
  if (_consumerCycleProcess && !_consumerCycleProcess.killed) {
    return { started: false, message: 'A consumer-cycle classification refresh is already running.' };
  }
  startConsumerCycleClassificationProcess(source);
  return {
    started: true,
    message: 'Consumer-cycle classification refresh started.',
  };
}

export function runValuationRefreshNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  if (_activeProcess && !_activeProcess.killed) {
    return { started: false, message: 'A Ledger hydration or valuation job is already running.' };
  }
  const baseConfig = _config || loadLedgerHydrationScheduleConfig();
  const standaloneConfig: LedgerHydrationScheduleConfig = {
    ...baseConfig,
    refresh_valuations: false,
    refresh_reit_supplementals: baseConfig.refresh_reit_supplementals,
    refresh_yahoo_identity_metadata: false,
    refresh_consumer_cycle_classifications: false,
    refresh_social_intelligence: false,
  };
  startValuationRefreshSequence(standaloneConfig, source);
  return {
    started: true,
    message: 'Valuation refresh started.',
  };
}

export function runYahooIdentityRefreshNow(source: 'manual' | 'scheduled' = 'manual'): { started: boolean; message: string } {
  if (_activeProcess && !_activeProcess.killed) {
    return { started: false, message: 'A Ledger hydration or valuation job is already running.' };
  }
  const baseConfig = _config || loadLedgerHydrationScheduleConfig();
  const standaloneConfig: LedgerHydrationScheduleConfig = {
    ...baseConfig,
    refresh_valuations: false,
    refresh_reit_supplementals: false,
    refresh_yahoo_identity_metadata: false,
    refresh_consumer_cycle_classifications: false,
    refresh_social_intelligence: false,
  };
  startYahooIdentityRefreshSequence(standaloneConfig, source);
  return {
    started: true,
    message: 'Yahoo identity refresh started.',
  };
}

export function resumeLedgerHydrationSchedulerFromDisk(): boolean {
  const config = loadLedgerHydrationScheduleConfig();
  _config = config;
  if (!config.enabled || config.frequency === 'manual') {
    stopScheduledTask();
    return false;
  }
  ensureSchedule(config);
  return true;
}
