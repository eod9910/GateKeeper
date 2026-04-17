import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { readJsonDocument, writeJsonDocument } from './appStateDb';

export interface ValuationSignalStrategyConfig {
  frequency: 'monthly' | 'quarterly';
  horizon: number;
  gap_threshold_pct: number;
  cap_tier?: 'micro' | 'small' | 'mid' | 'large' | null;
  limit?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  take_profit_pct?: number | null;
  stop_loss_pct?: number | null;
}

export interface ValuationSignalStrategyRuntimeState {
  running: boolean;
  pid: number | null;
  job_id: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  last_message: string | null;
  last_source: 'manual' | 'scheduled' | null;
  last_config: ValuationSignalStrategyConfig;
}

interface ValuationSignalStrategySnapshot {
  runtime: ValuationSignalStrategyRuntimeState;
  summary: any | null;
  files: {
    summary_json: string;
  };
}

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const RESEARCH_DIR = path.join(ROOT_DIR, 'backend', 'data', 'research');
const STRATEGY_SCRIPT = path.join(ROOT_DIR, 'backend', 'scripts', 'run_valuation_signal_strategy.py');
const SUMMARY_OUTPUT_PATH = path.join(RESEARCH_DIR, 'valuation_signal_strategy_summary_app.json');
const RUNTIME_NAMESPACE = 'research_tools';
const RUNTIME_DOCUMENT_KEY = 'valuation_signal_strategy_runtime';
const SNAPSHOT_DOCUMENT_KEY = 'valuation_signal_strategy_snapshot';

let _activeProcess: ChildProcess | null = null;

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : 'python3';
}

function normalizeConfig(input?: Partial<ValuationSignalStrategyConfig> | null): ValuationSignalStrategyConfig {
  const frequency = input?.frequency === 'quarterly' ? 'quarterly' : 'monthly';
  const horizon = Number.isFinite(Number(input?.horizon))
    ? Math.max(21, Math.min(Number(input?.horizon), 756))
    : 252;
  const gapThreshold = Number.isFinite(Number(input?.gap_threshold_pct))
    ? Math.max(1, Math.min(Number(input?.gap_threshold_pct), 200))
    : 20;
  const capTier = input?.cap_tier && ['micro', 'small', 'mid', 'large'].includes(String(input.cap_tier))
    ? (String(input.cap_tier) as ValuationSignalStrategyConfig['cap_tier'])
    : null;
  const limit = Number.isFinite(Number(input?.limit)) && Number(input?.limit) > 0
    ? Number(input?.limit)
    : null;
  const takeProfit = Number.isFinite(Number(input?.take_profit_pct)) && Number(input?.take_profit_pct) > 0
    ? Math.max(0.1, Math.min(Number(input?.take_profit_pct), 500))
    : null;
  const stopLoss = Number.isFinite(Number(input?.stop_loss_pct)) && Number(input?.stop_loss_pct) > 0
    ? Math.max(0.1, Math.min(Number(input?.stop_loss_pct), 500))
    : null;
  return {
    frequency,
    horizon,
    gap_threshold_pct: gapThreshold,
    cap_tier: capTier,
    limit,
    start_date: String(input?.start_date || '').trim() || null,
    end_date: String(input?.end_date || '').trim() || null,
    take_profit_pct: takeProfit,
    stop_loss_pct: stopLoss,
  };
}

function defaultRuntimeState(): ValuationSignalStrategyRuntimeState {
  return {
    running: false,
    pid: null,
    job_id: null,
    last_started_at: null,
    last_finished_at: null,
    last_exit_code: null,
    last_error: null,
    last_message: null,
    last_source: null,
    last_config: normalizeConfig(),
  };
}

function loadJsonIfExists<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

let _runtimeState: ValuationSignalStrategyRuntimeState =
  readJsonDocument<ValuationSignalStrategyRuntimeState>(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY) || defaultRuntimeState();

function saveRuntimeState(next: ValuationSignalStrategyRuntimeState): void {
  _runtimeState = {
    ...defaultRuntimeState(),
    ...next,
    last_config: normalizeConfig(next.last_config),
  };
  writeJsonDocument(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY, _runtimeState);
}

function writeSnapshotDocument(): void {
  const snapshot: ValuationSignalStrategySnapshot = {
    runtime: _runtimeState,
    summary: loadJsonIfExists<any>(SUMMARY_OUTPUT_PATH),
    files: {
      summary_json: SUMMARY_OUTPUT_PATH,
    },
  };
  writeJsonDocument(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY, snapshot);
}

function updateRuntime(partial: Partial<ValuationSignalStrategyRuntimeState>): void {
  saveRuntimeState({
    ..._runtimeState,
    ...partial,
    last_config: partial.last_config ? normalizeConfig(partial.last_config) : _runtimeState.last_config,
  });
  writeSnapshotDocument();
}

export function getValuationSignalStrategyStatus(): ValuationSignalStrategySnapshot {
  writeSnapshotDocument();
  return (
    readJsonDocument<ValuationSignalStrategySnapshot>(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY) || {
      runtime: _runtimeState,
      summary: loadJsonIfExists<any>(SUMMARY_OUTPUT_PATH),
      files: { summary_json: SUMMARY_OUTPUT_PATH },
    }
  );
}

export function runValuationSignalStrategy(configInput?: Partial<ValuationSignalStrategyConfig> | null): ValuationSignalStrategySnapshot {
  if (_activeProcess) return getValuationSignalStrategyStatus();
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  const config = normalizeConfig(configInput);
  const jobId = `valuation_signal_strategy_${Date.now()}`;
  const args = [
    STRATEGY_SCRIPT,
    '--frequency',
    config.frequency,
    '--horizon',
    String(config.horizon),
    '--gap-threshold-pct',
    String(config.gap_threshold_pct),
    '--output-json',
    SUMMARY_OUTPUT_PATH,
  ];
  if (config.cap_tier) args.push('--cap-tier', String(config.cap_tier));
  if (config.limit) args.push('--limit', String(config.limit));
  if (config.start_date) args.push('--start-date', config.start_date);
  if (config.end_date) args.push('--end-date', config.end_date);
  if (config.take_profit_pct) args.push('--take-profit-pct', String(config.take_profit_pct));
  if (config.stop_loss_pct) args.push('--stop-loss-pct', String(config.stop_loss_pct));

  const child = spawn(getPythonLauncher(), args, {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _activeProcess = child;
  updateRuntime({
    running: true,
    pid: child.pid ?? null,
    job_id: jobId,
    last_started_at: new Date().toISOString(),
    last_exit_code: null,
    last_error: null,
    last_source: 'manual',
    last_message: '[ValuationSignalStrategy] Running long undervalued / short overvalued study...',
    last_config: config,
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    const lastLine = text.split(/\r?\n/).filter(Boolean).pop() || text;
    updateRuntime({ last_message: lastLine });
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    updateRuntime({
      last_error: text,
      last_message: text,
    });
  });

  child.on('error', (err: any) => {
    _activeProcess = null;
    updateRuntime({
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_error: err?.message || String(err),
      last_message: err?.message || String(err),
    });
  });

  child.on('exit', (code) => {
    _activeProcess = null;
    updateRuntime({
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: code ?? 1,
      last_error: (code ?? 0) === 0 ? null : _runtimeState.last_error || `Process exited with code ${code ?? 1}`,
      last_message: (code ?? 0) === 0 ? '[ValuationSignalStrategy] Strategy study complete.' : _runtimeState.last_error || `Process exited with code ${code ?? 1}`,
    });
  });

  return getValuationSignalStrategyStatus();
}
