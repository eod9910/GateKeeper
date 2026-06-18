import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { listAppRecords, readAppRecord, readJsonDocument, writeAppRecord, writeJsonDocument } from './appStateDb';
import { saveStrategy } from './storageService';
import { FundamentalOperator, StrategyParameterManifestItem, StrategySpec } from '../types';

export interface FundamentalBacktestConfig {
  name?: string;
  universe?: string;
  as_of_start?: string | null;
  as_of_end?: string | null;
  rebalance_frequency?: 'monthly' | 'quarterly' | 'yearly';
  entry?: { all?: Array<Record<string, any>> };
  exclusions?: Array<Record<string, any>>;
  exit?: {
    max_hold_days?: number | null;
    stop_loss_pct?: number | null;
    take_profit_ladder_pct?: number[];
    trailing_stop_pct?: number | null;
  };
  benchmark?: string;
  result_mode?: string;
  top_n_per_date?: number;
  max_symbols?: number;
}

export interface FundamentalBacktestRuntimeState {
  running: boolean;
  pid: number | null;
  job_id: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  last_message: string | null;
  last_source: 'manual' | 'scheduled' | null;
  last_config: FundamentalBacktestConfig;
}

interface FundamentalBacktestSnapshot {
  runtime: FundamentalBacktestRuntimeState;
  summary: any | null;
  saved_run: FundamentalBacktestRunRecord | null;
  files: {
    summary_json: string;
    observations_csv: string;
    config_json: string;
  };
}

export interface FundamentalBacktestRunRecord {
  id: string;
  created_at: string;
  rule_name: string;
  universe: string;
  as_of_start: string | null;
  as_of_end: string | null;
  rebalance_frequency: string;
  benchmark: string;
  max_symbols: number;
  tested_rules: string[];
  exclusion_rules: string[];
  research_score: number;
  score_components: Record<string, number | null>;
  metrics: {
    data_source: string | null;
    snapshot_start: string | null;
    snapshot_end: string | null;
    universe_symbols: number | null;
    pit_snapshots: number | null;
    candidates: number | null;
    trade_count: number | null;
    win_rate_pct: number | null;
    average_return_pct: number | null;
    median_return_pct: number | null;
    average_benchmark_return_pct: number | null;
    benchmark_beat_rate_pct: number | null;
    outlier_dependency_pct: number | null;
  };
  config: FundamentalBacktestConfig;
  result: any;
}

export interface FundamentalSweepParamDef {
  id: string;
  label: string;
  param_path: string;
  values: any[];
}

export interface FundamentalSweepVariant {
  variant_id: string;
  param_values: Array<{ label: string; param_path: string; value: any }>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  metrics: FundamentalBacktestRunRecord['metrics'] | null;
  research_score: number | null;
  result: any | null;
  error?: string;
}

export interface FundamentalSweepSession {
  session_id: string;
  source_type: 'fundamental_backtest_run';
  source_run_id: string;
  candidate_state: 'research_candidate';
  status: 'ready' | 'running' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  source: {
    rule_name: string;
    universe: string;
    date_range: string;
    rebalance_frequency: string;
    benchmark: string;
    max_symbols: number;
    tested_rules: string[];
    exclusion_rules: string[];
    research_score: number;
    metrics: FundamentalBacktestRunRecord['metrics'];
  };
  base_config: FundamentalBacktestConfig;
  sweep_params: FundamentalSweepParamDef[];
  variants: FundamentalSweepVariant[];
  winner: FundamentalSweepVariant | null;
  promoted_strategy_version_id?: string | null;
  promoted_variant_id?: string | null;
  promoted_at?: string | null;
  destination_url: string;
}

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const RESEARCH_DIR = path.join(ROOT_DIR, 'backend', 'data', 'research');
const BACKTEST_SCRIPT = path.join(ROOT_DIR, 'backend', 'scripts', 'run_fundamental_backtester.py');
const CONFIG_INPUT_PATH = path.join(RESEARCH_DIR, 'fundamental_backtest_config_app.json');
const SUMMARY_OUTPUT_PATH = path.join(RESEARCH_DIR, 'fundamental_backtest_summary_app.json');
const OBSERVATIONS_OUTPUT_PATH = path.join(RESEARCH_DIR, 'fundamental_backtest_observations_app.csv');
const RUNTIME_NAMESPACE = 'research_tools';
const RUNTIME_DOCUMENT_KEY = 'fundamental_backtest_runtime';
const SNAPSHOT_DOCUMENT_KEY = 'fundamental_backtest_snapshot';
const RUN_RECORD_NAMESPACE = 'fundamental_backtest_runs';
const SWEEP_SESSION_NAMESPACE = 'fundamental_sweep_sessions';
const FUNDAMENTAL_SWEEP_DIR = path.join(RESEARCH_DIR, 'fundamental-sweeps');

let _activeProcess: ChildProcess | null = null;
const _activeFundamentalSweeps = new Set<string>();

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : 'python3';
}

function numericOrNull(value: any, min?: number, max?: number): number | null {
  if (!Number.isFinite(Number(value))) return null;
  let next = Number(value);
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}

function cleanRules(value: any): Array<Record<string, any>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => ({
      metric: String(rule.metric || '').trim(),
      op: String(rule.op || '').trim(),
      value: rule.value,
    }))
    .filter((rule) => rule.metric && rule.op);
}

function toFiniteNumber(value: any): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pctFractionToPercent(value: any): number | null {
  const num = toFiniteNumber(value);
  return num == null ? null : Math.round(num * 1000) / 10;
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ruleValueLabel(value: any): string {
  if (Array.isArray(value)) return value.join(' to ');
  if (value === null || typeof value === 'undefined' || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ruleLabel(rule: any): string {
  if (!rule || typeof rule !== 'object') return '-';
  if (rule.op === 'is_true') return `${rule.metric} is true`;
  if (rule.op === 'is_false') return `${rule.metric} is false`;
  return `${rule.metric || '-'} ${rule.op || '-'} ${ruleValueLabel(rule.value)}`;
}

function scoreTradeCount(tradeCount: number | null): number {
  if (!tradeCount || tradeCount <= 0) return -35;
  if (tradeCount < 10) return -22;
  if (tradeCount < 25) return -12;
  if (tradeCount < 50) return -4;
  return bounded(Math.log10(tradeCount / 50) * 6, 0, 10);
}

function roundComponent(value: number): number {
  return Math.round(value * 10) / 10;
}

function calculateResearchScore(summary: any): { score: number; components: Record<string, number | null> } {
  const stats = summary?.summary || {};
  const tradeCount = toFiniteNumber(stats.trade_count);
  const medianReturn = toFiniteNumber(stats.median_return_pct);
  const averageReturn = toFiniteNumber(stats.avg_return_pct);
  const averageBenchmarkReturn = toFiniteNumber(stats.avg_benchmark_return_pct);
  const winRate = pctFractionToPercent(stats.win_rate);
  const benchmarkBeatRate = pctFractionToPercent(stats.beat_benchmark_rate);
  const outlierDependency = pctFractionToPercent(stats.outlier_dependency);
  const averageExcessReturn =
    averageReturn != null && averageBenchmarkReturn != null
      ? averageReturn - averageBenchmarkReturn
      : null;

  if (!tradeCount || tradeCount <= 0) {
    return {
      score: 0,
      components: {
        median_return: 0,
        average_return: 0,
        average_excess_return: null,
        win_rate: 0,
        benchmark_beat_rate: 0,
        trade_count_confidence: -35,
        outlier_penalty: 0,
      },
    };
  }

  const medianComponent = bounded((medianReturn || 0) * 0.22, -14, 16);
  const averageComponent = bounded((averageReturn || 0) * 0.10, -8, 8);
  const excessComponent =
    averageExcessReturn == null
      ? -10
      : bounded(averageExcessReturn * 0.75, -24, 24);
  const winComponent = bounded(((winRate || 0) - 50) * 0.20, -8, 8);
  const benchmarkComponent =
    benchmarkBeatRate == null
      ? -12
      : bounded((benchmarkBeatRate - 50) * 0.55, -22, 22);
  const tradeCountComponent = scoreTradeCount(tradeCount);
  const outlierPenalty = outlierDependency == null ? -4 : -bounded(outlierDependency * 0.45, 0, 28);
  const score = bounded(
    50 +
      medianComponent +
      averageComponent +
      excessComponent +
      winComponent +
      benchmarkComponent +
      tradeCountComponent +
      outlierPenalty,
    0,
    100,
  );

  return {
    score: roundComponent(score),
    components: {
      median_return: roundComponent(medianComponent),
      average_return: roundComponent(averageComponent),
      average_excess_return: roundComponent(excessComponent),
      win_rate: roundComponent(winComponent),
      benchmark_beat_rate: roundComponent(benchmarkComponent),
      trade_count_confidence: roundComponent(tradeCountComponent),
      outlier_penalty: roundComponent(outlierPenalty),
    },
  };
}

function refreshRunScore(record: FundamentalBacktestRunRecord): FundamentalBacktestRunRecord {
  if (!record?.result) return record;
  const score = calculateResearchScore(record.result);
  return {
    ...record,
    research_score: score.score,
    score_components: score.components,
  };
}

function buildRunRecord(summary: any, runtime: FundamentalBacktestRuntimeState): FundamentalBacktestRunRecord | null {
  if (!summary || typeof summary !== 'object') return null;
  const config = normalizeConfig(summary.config || runtime.last_config);
  const stats = summary.summary || {};
  const availableRange = summary.available_snapshot_range || {};
  const createdAt = String(summary.generated_at || runtime.last_finished_at || new Date().toISOString());
  const score = calculateResearchScore(summary);
  const id = [
    'fbr',
    createdAt.replace(/[^0-9]/g, '').slice(0, 14) || Date.now(),
    String(config.name || 'run').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'run',
  ].join('_');

  return {
    id,
    created_at: createdAt,
    rule_name: String(config.name || 'untitled_fundamental_rule'),
    universe: String(config.universe || 'clean'),
    as_of_start: config.as_of_start || null,
    as_of_end: config.as_of_end || null,
    rebalance_frequency: String(config.rebalance_frequency || 'monthly'),
    benchmark: String(config.benchmark || stats.benchmark || 'SPY'),
    max_symbols: Number(config.max_symbols || 0),
    tested_rules: cleanRules(config.entry?.all).map(ruleLabel),
    exclusion_rules: cleanRules(config.exclusions).map(ruleLabel),
    research_score: score.score,
    score_components: score.components,
    metrics: {
      data_source: summary.data_source || null,
      snapshot_start: availableRange.start || null,
      snapshot_end: availableRange.end || null,
      universe_symbols: toFiniteNumber(summary.universe_symbol_count),
      pit_snapshots: toFiniteNumber(summary.snapshot_count),
      candidates: toFiniteNumber(summary.candidate_count),
      trade_count: toFiniteNumber(stats.trade_count),
      win_rate_pct: pctFractionToPercent(stats.win_rate),
      average_return_pct: toFiniteNumber(stats.avg_return_pct),
      median_return_pct: toFiniteNumber(stats.median_return_pct),
      average_benchmark_return_pct: toFiniteNumber(stats.avg_benchmark_return_pct),
      benchmark_beat_rate_pct: pctFractionToPercent(stats.beat_benchmark_rate),
      outlier_dependency_pct: pctFractionToPercent(stats.outlier_dependency),
    },
    config,
    result: summary,
  };
}

function saveRunRecord(record: FundamentalBacktestRunRecord): void {
  writeAppRecord(RUN_RECORD_NAMESPACE, record.id, record, {
    userKey: record.rule_name,
    sortKey: String(record.research_score).padStart(6, '0') + '|' + record.created_at,
  });
}

function saveCompletedRunIfPossible(): FundamentalBacktestRunRecord | null {
  if (_runtimeState.running || _runtimeState.last_exit_code !== 0) return null;
  const summary = loadCurrentSummaryForRuntime(_runtimeState);
  const record = buildRunRecord(summary, _runtimeState);
  if (!record) return null;
  saveRunRecord(record);
  return record;
}

function normalizeConfig(input?: Partial<FundamentalBacktestConfig> | null): FundamentalBacktestConfig {
  const frequency = ['monthly', 'quarterly', 'yearly'].includes(String(input?.rebalance_frequency || ''))
    ? input!.rebalance_frequency
    : 'monthly';
  const maxHold = numericOrNull(input?.exit?.max_hold_days, 1, 756);
  const stopLoss = numericOrNull(input?.exit?.stop_loss_pct, -99, 0);
  const trailingStop = numericOrNull(input?.exit?.trailing_stop_pct, 1, 99);
  const takeProfit = Array.isArray(input?.exit?.take_profit_ladder_pct)
    ? input!.exit!.take_profit_ladder_pct
        .map((value) => numericOrNull(value, 1, 1000))
        .filter((value): value is number => value !== null)
    : [];

  return {
    name: String(input?.name || 'fundamental_backtest_v1').trim(),
    universe: String(input?.universe || 'clean').trim() || 'clean',
    as_of_start: String(input?.as_of_start || '').trim() || null,
    as_of_end: String(input?.as_of_end || '').trim() || null,
    rebalance_frequency: frequency,
    entry: { all: cleanRules(input?.entry?.all) },
    exclusions: cleanRules(input?.exclusions),
    exit: {
      max_hold_days: maxHold ?? 180,
      stop_loss_pct: stopLoss,
      take_profit_ladder_pct: takeProfit,
      trailing_stop_pct: trailingStop,
    },
    benchmark: String(input?.benchmark || 'SPY').trim().toUpperCase() || 'SPY',
    result_mode: String(input?.result_mode || 'equal_weight').trim(),
    top_n_per_date: numericOrNull(input?.top_n_per_date, 0, 500) ?? 0,
    max_symbols: numericOrNull(input?.max_symbols, 0, 10000) ?? 500,
  };
}

function defaultRuntimeState(): FundamentalBacktestRuntimeState {
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

function isSummaryFromCurrentRun(summary: any, runtime: FundamentalBacktestRuntimeState): boolean {
  if (!summary || typeof summary !== 'object') return false;
  if (!runtime.last_started_at) return true;
  const generatedAt = Date.parse(String(summary.generated_at || ''));
  const startedAt = Date.parse(String(runtime.last_started_at || ''));
  if (!Number.isFinite(generatedAt) || !Number.isFinite(startedAt)) return !runtime.running;
  return generatedAt >= startedAt;
}

function loadCurrentSummaryForRuntime(runtime: FundamentalBacktestRuntimeState): any | null {
  const summary = loadJsonIfExists<any>(SUMMARY_OUTPUT_PATH);
  return isSummaryFromCurrentRun(summary, runtime) ? summary : null;
}

let _runtimeState: FundamentalBacktestRuntimeState =
  readJsonDocument<FundamentalBacktestRuntimeState>(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY) || defaultRuntimeState();

function saveRuntimeState(next: FundamentalBacktestRuntimeState): void {
  _runtimeState = {
    ...defaultRuntimeState(),
    ...next,
    last_config: normalizeConfig(next.last_config),
  };
  writeJsonDocument(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY, _runtimeState);
}

function writeSnapshotDocument(): void {
  const summary = loadCurrentSummaryForRuntime(_runtimeState);
  const snapshot: FundamentalBacktestSnapshot = {
    runtime: _runtimeState,
    summary,
    saved_run: buildRunRecord(summary, _runtimeState),
    files: {
      summary_json: SUMMARY_OUTPUT_PATH,
      observations_csv: OBSERVATIONS_OUTPUT_PATH,
      config_json: CONFIG_INPUT_PATH,
    },
  };
  writeJsonDocument(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY, snapshot);
}

function updateRuntime(partial: Partial<FundamentalBacktestRuntimeState>): void {
  saveRuntimeState({
    ..._runtimeState,
    ...partial,
    last_config: partial.last_config ? normalizeConfig(partial.last_config) : _runtimeState.last_config,
  });
  writeSnapshotDocument();
}

export function getFundamentalBacktestStatus(): FundamentalBacktestSnapshot {
  saveCompletedRunIfPossible();
  writeSnapshotDocument();
  const summary = loadCurrentSummaryForRuntime(_runtimeState);
  return (
    readJsonDocument<FundamentalBacktestSnapshot>(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY) || {
      runtime: _runtimeState,
      summary,
      saved_run: buildRunRecord(summary, _runtimeState),
      files: {
        summary_json: SUMMARY_OUTPUT_PATH,
        observations_csv: OBSERVATIONS_OUTPUT_PATH,
        config_json: CONFIG_INPUT_PATH,
      },
    }
  );
}

export function runFundamentalBacktest(configInput?: Partial<FundamentalBacktestConfig> | null): FundamentalBacktestSnapshot {
  if (_activeProcess) return getFundamentalBacktestStatus();
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  const config = normalizeConfig(configInput);
  fs.writeFileSync(CONFIG_INPUT_PATH, JSON.stringify(config, null, 2), 'utf-8');

  const jobId = `fundamental_backtest_${Date.now()}`;
  const args = [
    BACKTEST_SCRIPT,
    '--config',
    CONFIG_INPUT_PATH,
    '--output-json',
    SUMMARY_OUTPUT_PATH,
    '--output-csv',
    OBSERVATIONS_OUTPUT_PATH,
  ];
  if (config.max_symbols && config.max_symbols > 0) {
    args.push('--limit', String(config.max_symbols));
  }

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
    last_message: '[FundamentalBacktester] Running PIT fundamental backtest...',
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
    updateRuntime({ last_error: text, last_message: text });
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
      last_message: (code ?? 0) === 0 ? '[FundamentalBacktester] Backtest complete.' : _runtimeState.last_error || `Process exited with code ${code ?? 1}`,
    });
    if ((code ?? 0) === 0) {
      saveCompletedRunIfPossible();
      writeSnapshotDocument();
    }
  });

  return getFundamentalBacktestStatus();
}

export function listFundamentalBacktestRuns(limit = 50): FundamentalBacktestRunRecord[] {
  const rows = listAppRecords<FundamentalBacktestRunRecord>(RUN_RECORD_NAMESPACE)
    .filter((row) => row && typeof row === 'object')
    .map((row) => refreshRunScore(row))
    .sort((a, b) => {
      const scoreDiff = Number(b.research_score || 0) - Number(a.research_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
}

export function getFundamentalBacktestRun(runId: string): FundamentalBacktestRunRecord | null {
  const record = readAppRecord<FundamentalBacktestRunRecord>(RUN_RECORD_NAMESPACE, String(runId || ''));
  return record ? refreshRunScore(record) : null;
}

export function compareFundamentalBacktestRuns(runIds: string[]): FundamentalBacktestRunRecord[] {
  return Array.from(new Set((runIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
    .map((id) => getFundamentalBacktestRun(id))
    .filter((row): row is FundamentalBacktestRunRecord => Boolean(row));
}

function currentIso(): string {
  return new Date().toISOString();
}

function makeFundamentalSweepId(runId: string): string {
  const stamp = currentIso().replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  const cleanRun = String(runId || 'run').replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 20);
  return `fbs_${stamp}_${cleanRun}_${suffix}`;
}

function saveFundamentalSweepSession(session: FundamentalSweepSession): void {
  writeAppRecord(SWEEP_SESSION_NAMESPACE, session.session_id, session, {
    userKey: session.source_run_id,
    sortKey: String(session.updated_at || session.created_at || ''),
  });
}

export function getFundamentalSweepSession(sessionId: string): FundamentalSweepSession | null {
  const session = readAppRecord<FundamentalSweepSession>(SWEEP_SESSION_NAMESPACE, String(sessionId || ''));
  if (!session) return null;
  const refreshedParams = mergeFundamentalSweepParams(
    session.sweep_params,
    buildDefaultFundamentalSweepParamsFromConfig(session.base_config),
  );
  if (refreshedParams.length !== (session.sweep_params || []).length) {
    session.sweep_params = refreshedParams;
    session.updated_at = currentIso();
    saveFundamentalSweepSession(session);
  }
  return session;
}

function hasRule(config: FundamentalBacktestConfig, metric: string): boolean {
  return cleanRules(config.entry?.all).concat(cleanRules(config.exclusions)).some((rule) => rule.metric === metric);
}

function metricSweepLabel(metric: string): string {
  const known: Record<string, string> = {
    price_drawdown_6m_pct: '6M drawdown %',
    revenue_acceleration_qoq_pct: 'Revenue acceleration QoQ %',
    revenue_growth_yoy_pct: 'Revenue growth YoY %',
    eps_surprise_pct: 'EPS surprise %',
    sales_surprise_pct: 'Sales surprise %',
    dcf_gap_pct: 'DCF gap %',
    dollar_volume_20d: '20D dollar volume',
  };
  return known[metric] || metricTitle(metric);
}

function defaultEntrySweepValues(metric: string, currentValue: any): any[] {
  const current = toFiniteNumber(currentValue);
  if (metric === 'price_drawdown_6m_pct') return [-20, -35, -50, -65, -80];
  if (metric === 'revenue_acceleration_qoq_pct') return [-10, 0, 5, 10, 25];
  if (metric === 'revenue_growth_yoy_pct') return [-10, 0, 10, 25, 50];
  if (metric === 'eps_surprise_pct') return [0, 5, 10, 25, 50];
  if (metric === 'sales_surprise_pct') return [0, 5, 10, 25, 50];
  if (metric === 'dcf_gap_pct') return [0, 5, 10, 25, 50];
  if (metric === 'dollar_volume_20d') return [250000, 1000000, 5000000];
  if (current != null) {
    const step = Math.max(1, Math.abs(current) * 0.5);
    return Array.from(new Set([
      Math.round((current - step) * 10) / 10,
      current,
      Math.round((current + step) * 10) / 10,
    ]));
  }
  return [0, 5, 10, 25, 50];
}

function mergeFundamentalSweepParams(
  existing: FundamentalSweepParamDef[] | undefined,
  generated: FundamentalSweepParamDef[],
): FundamentalSweepParamDef[] {
  const out: FundamentalSweepParamDef[] = [];
  const seen = new Set<string>();
  for (const param of [...(existing || []), ...generated]) {
    const key = String(param?.param_path || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(param);
  }
  return out;
}

function buildDefaultFundamentalSweepParamsFromConfig(configInput: FundamentalBacktestConfig): FundamentalSweepParamDef[] {
  const config = normalizeConfig(configInput);
  const params: FundamentalSweepParamDef[] = cleanRules(config.entry?.all)
    .filter((rule) => toFiniteNumber(rule.value) !== null)
    .map((rule) => ({
      id: rule.metric,
      label: metricSweepLabel(rule.metric),
      param_path: `entry.metric:${rule.metric}`,
      values: defaultEntrySweepValues(rule.metric, rule.value),
    }));

  if (hasRule(config, 'reverse_split_within_days')) {
    params.push({ id: 'reverse_split_within_days', label: 'Reverse split exclusion', param_path: 'exclusion.metric:reverse_split_within_days', values: [null, 365] });
  }

  return params;
}

function isFundamentalSweepParam(param: FundamentalSweepParamDef): boolean {
  const path = String(param?.param_path || '');
  return path.startsWith('entry.metric:') || path.startsWith('exclusion.metric:');
}

function buildDefaultFundamentalSweepParams(run: FundamentalBacktestRunRecord): FundamentalSweepParamDef[] {
  return buildDefaultFundamentalSweepParamsFromConfig(run.config);
}

export function promoteFundamentalRunToSweep(runId: string): FundamentalSweepSession {
  const run = getFundamentalBacktestRun(runId);
  if (!run) throw new Error('Saved fundamental run not found');
  if (!run.config || !Array.isArray(run.config.entry?.all)) {
    throw new Error('Saved run does not have a usable Fundamental Backtester config');
  }

  const sessionId = makeFundamentalSweepId(run.id);
  const session: FundamentalSweepSession = {
    session_id: sessionId,
    source_type: 'fundamental_backtest_run',
    source_run_id: run.id,
    candidate_state: 'research_candidate',
    status: 'ready',
    created_at: currentIso(),
    updated_at: currentIso(),
    source: {
      rule_name: run.rule_name,
      universe: run.universe,
      date_range: `${run.as_of_start || '-'} to ${run.as_of_end || '-'}`,
      rebalance_frequency: run.rebalance_frequency,
      benchmark: run.benchmark,
      max_symbols: run.max_symbols,
      tested_rules: run.tested_rules,
      exclusion_rules: run.exclusion_rules,
      research_score: run.research_score,
      metrics: run.metrics,
    },
    base_config: normalizeConfig(run.config),
    sweep_params: buildDefaultFundamentalSweepParams(run),
    variants: [],
    winner: null,
    destination_url: `/parameter-sweep?fundamental_sweep_id=${encodeURIComponent(sessionId)}`,
  };
  saveFundamentalSweepSession(session);
  return session;
}

function cartesianProduct(params: FundamentalSweepParamDef[]): Array<Array<{ label: string; param_path: string; value: any }>> {
  return params.reduce<Array<Array<{ label: string; param_path: string; value: any }>>>((acc, param) => {
    const values = Array.isArray(param.values) ? param.values : [];
    if (!values.length) return acc;
    const next: Array<Array<{ label: string; param_path: string; value: any }>> = [];
    for (const combo of acc) {
      for (const value of values) {
        next.push([...combo, { label: param.label, param_path: param.param_path, value }]);
      }
    }
    return next;
  }, [[]]);
}

function variantValueSlug(value: any): string {
  if (Array.isArray(value)) return value.join('_');
  if (value === null || typeof value === 'undefined') return 'none';
  return String(value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
}

function setRuleValue(rules: Array<Record<string, any>>, metric: string, value: any, defaultOp: string): Array<Record<string, any>> {
  const next = cleanRules(rules);
  const existing = next.find((rule) => rule.metric === metric);
  if (value === null || typeof value === 'undefined') {
    return next.filter((rule) => rule.metric !== metric);
  }
  if (existing) {
    existing.value = value;
    if (!existing.op) existing.op = defaultOp;
    return next;
  }
  return [...next, { metric, op: defaultOp, value }];
}

function applyFundamentalSweepParam(config: FundamentalBacktestConfig, paramPath: string, value: any): FundamentalBacktestConfig {
  const next = normalizeConfig(JSON.parse(JSON.stringify(config)));
  if (paramPath.startsWith('entry.metric:')) {
    const metric = paramPath.split(':')[1];
    const op = metric === 'price_drawdown_6m_pct' ? '<=' : metric === 'dollar_volume_20d' ? '>=' : '>=';
    next.entry = { all: setRuleValue(next.entry?.all || [], metric, value, op) };
  } else if (paramPath.startsWith('exclusion.metric:')) {
    const metric = paramPath.split(':')[1];
    next.exclusions = setRuleValue(next.exclusions || [], metric, value, '<=');
  } else if (paramPath === 'exit.max_hold_days') {
    next.exit = { ...(next.exit || {}), max_hold_days: numericOrNull(value, 1, 756) ?? 180 };
  } else if (paramPath === 'exit.stop_loss_pct') {
    next.exit = { ...(next.exit || {}), stop_loss_pct: value === null ? null : numericOrNull(value, -99, 0) };
  } else if (paramPath === 'exit.trailing_stop_pct') {
    next.exit = { ...(next.exit || {}), trailing_stop_pct: value === null ? null : numericOrNull(value, 1, 99) };
  } else if (paramPath === 'exit.take_profit_ladder_pct') {
    next.exit = {
      ...(next.exit || {}),
      take_profit_ladder_pct: Array.isArray(value)
        ? value.map((item) => numericOrNull(item, 1, 1000)).filter((item): item is number => item !== null)
        : [],
    };
  }
  return normalizeConfig(next);
}

function buildVariantMetrics(summary: any, config: FundamentalBacktestConfig): Pick<FundamentalSweepVariant, 'metrics' | 'research_score'> {
  const runtime = { ...defaultRuntimeState(), last_config: config, last_finished_at: currentIso(), last_exit_code: 0 };
  const record = buildRunRecord(summary, runtime);
  return {
    metrics: record?.metrics || null,
    research_score: record?.research_score ?? null,
  };
}

function runBacktestConfigOnce(config: FundamentalBacktestConfig, outDir: string, variantId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const safeStem = String(variantId || `variant_${Date.now()}`)
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .slice(-48);
    const configPath = path.join(outDir, `${safeStem}_config.json`);
    const outputJson = path.join(outDir, `${safeStem}_summary.json`);
    const outputCsv = path.join(outDir, `${safeStem}_observations.csv`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const args = [BACKTEST_SCRIPT, '--config', configPath, '--output-json', outputJson, '--output-csv', outputCsv];
    if (config.max_symbols && config.max_symbols > 0) args.push('--limit', String(config.max_symbols));

    const child = spawn(getPythonLauncher(), args, { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if ((code ?? 0) !== 0) {
        reject(new Error(stderr.trim() || `Fundamental sweep variant exited with code ${code ?? 1}`));
        return;
      }
      const summary = loadJsonIfExists<any>(outputJson);
      if (!summary) {
        reject(new Error('Fundamental sweep variant did not produce a summary JSON'));
        return;
      }
      resolve(summary);
    });
  });
}

function selectFundamentalSweepWinner(variants: FundamentalSweepVariant[]): FundamentalSweepVariant | null {
  const completed = variants.filter((variant) => variant.status === 'completed' && Number.isFinite(Number(variant.research_score)));
  completed.sort((a, b) => {
    const scoreDiff = Number(b.research_score || 0) - Number(a.research_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b.metrics?.trade_count || 0) - Number(a.metrics?.trade_count || 0);
  });
  return completed[0] || null;
}

function slugifyId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'fundamental_strategy';
}

function normalizeFundamentalOperator(op: string): FundamentalOperator {
  return ['>=', '<=', '>', '<', '==', '!='].includes(op) ? op as FundamentalOperator : '>=';
}

function metricTitle(metric: string): string {
  return String(metric || '')
    .replace(/_/g, ' ')
    .replace(/\bpct\b/gi, '%')
    .replace(/\bqoq\b/gi, 'QoQ')
    .replace(/\byoy\b/gi, 'YoY')
    .replace(/\bdcf\b/gi, 'DCF')
    .replace(/\beps\b/gi, 'EPS')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function sweepValuesForManifest(values: any[]): Array<string | number | boolean> | undefined {
  const cleaned = (Array.isArray(values) ? values : [])
    .filter((value) => value !== null && typeof value !== 'undefined')
    .map((value) => Array.isArray(value) ? value.join(',') : value)
    .filter((value): value is string | number | boolean =>
      ['string', 'number', 'boolean'].includes(typeof value)
    );
  return cleaned.length ? cleaned : undefined;
}

function anatomyForFundamentalParam(paramPath: string): StrategyParameterManifestItem['anatomy'] {
  if (paramPath.startsWith('entry.metric:')) return 'valuation';
  if (paramPath.startsWith('exclusion.metric:')) return 'risk_controls';
  if (paramPath.includes('stop_loss') || paramPath.includes('trailing_stop')) return 'stop_loss';
  if (paramPath.includes('take_profit')) return 'take_profit';
  return 'risk_controls';
}

function typeForSweepValues(values: any[]): StrategyParameterManifestItem['type'] {
  const first = (Array.isArray(values) ? values : []).find((value) => value !== null && typeof value !== 'undefined');
  if (typeof first === 'boolean') return 'bool';
  if (typeof first === 'number') return Number.isInteger(first) ? 'int' : 'float';
  return 'enum';
}

function strategyManifestPath(paramPath: string, config: FundamentalBacktestConfig): string {
  if (paramPath.startsWith('entry.metric:')) {
    const metric = paramPath.split(':')[1];
    const idx = cleanRules(config.entry?.all).findIndex((rule) => rule.metric === metric);
    return idx >= 0 ? `fundamental_config.variables.${idx}.threshold` : `entry_config.rules.${cleanRules(config.entry?.all).length}.value`;
  }
  if (paramPath.startsWith('exclusion.metric:')) {
    const metric = paramPath.split(':')[1];
    const idx = cleanRules(config.exclusions).findIndex((rule) => rule.metric === metric);
    return idx >= 0 ? `entry_config.exclusions.${idx}.value` : `entry_config.exclusions.${cleanRules(config.exclusions).length}.value`;
  }
  if (paramPath === 'exit.max_hold_days') return 'risk_config.max_hold_bars';
  if (paramPath === 'exit.stop_loss_pct') return 'risk_config.stop_value';
  if (paramPath === 'exit.trailing_stop_pct') return 'exit_config.trailing.percent';
  if (paramPath === 'exit.take_profit_ladder_pct') return 'exit_config.take_profit_ladder_pct';
  return `backtest_config.${paramPath}`;
}

function buildFundamentalStrategyManifest(
  config: FundamentalBacktestConfig,
  params: FundamentalSweepParamDef[],
): StrategyParameterManifestItem[] {
  return params.map((param, index) => ({
    key: slugifyId(param.id || param.param_path || `fundamental_param_${index + 1}`),
    label: param.label || param.param_path,
    path: strategyManifestPath(param.param_path, config),
    anatomy: anatomyForFundamentalParam(param.param_path),
    type: typeForSweepValues(param.values),
    description: `Generated from Fundamental Backtester sweep dimension ${param.param_path}.`,
    identity_preserving: true,
    sweep_enabled: true,
    sensitivity_enabled: true,
    suggested_values: sweepValuesForManifest(param.values),
    priority: index + 1,
  }));
}

function buildStrategyConfigFromFundamentalConfig(configInput: FundamentalBacktestConfig) {
  const config = normalizeConfig(configInput);
  const entryRules = cleanRules(config.entry?.all);
  const fundamentalVariables = entryRules
    .map((rule) => ({
      metric: rule.metric,
      label: metricTitle(rule.metric),
      operator: normalizeFundamentalOperator(rule.op),
      threshold: Number(rule.value),
      missing_policy: 'fail' as const,
      sensitivity_enabled: true,
    }))
    .filter((variable) => Number.isFinite(variable.threshold));
  const stopPct = toFiniteNumber(config.exit?.stop_loss_pct);
  const trailingPct = toFiniteNumber(config.exit?.trailing_stop_pct);
  const takeProfitLadder = Array.isArray(config.exit?.take_profit_ladder_pct)
    ? config.exit.take_profit_ladder_pct
      .map((value) => toFiniteNumber(value))
      .filter((value): value is number => value != null && value > 0)
    : [];
  const firstTakeProfitPct = takeProfitLadder.length ? Math.min(...takeProfitLadder) : null;
  const takeProfitR = firstTakeProfitPct != null && stopPct != null && Math.abs(stopPct) > 0
    ? Number((firstTakeProfitPct / Math.abs(stopPct)).toFixed(6))
    : null;

  return {
    fundamental_config: {
      enabled: true,
      comparison_mode: 'selected_vs_excluded' as const,
      rebalance_frequency: config.rebalance_frequency === 'quarterly' ? 'quarterly' as const : 'monthly' as const,
      forward_bars: Number(config.exit?.max_hold_days || 180),
      min_selected_count: 5,
      min_excluded_count: 25,
      variables: fundamentalVariables,
    },
    entry_config: {
      trigger: 'fundamental_rebalance_signal',
      rebalance_frequency: config.rebalance_frequency,
      rules: entryRules,
      exclusions: cleanRules(config.exclusions),
      top_n_per_date: config.top_n_per_date || 0,
    },
    risk_config: {
      stop_type: stopPct == null ? 'none' : 'fixed_pct',
      stop_value: stopPct == null ? undefined : Math.abs(stopPct) / 100,
      max_hold_bars: Number(config.exit?.max_hold_days || 180),
      take_profit_R: takeProfitR == null ? undefined : takeProfitR,
      trailing_stop_pct: trailingPct,
    },
    exit_config: {
      target_type: takeProfitR == null ? 'time_or_stop' : 'R_multiple',
      target_level: takeProfitR == null ? undefined : takeProfitR,
      time_stop_bars: Number(config.exit?.max_hold_days || 180),
      trailing: trailingPct == null ? null : { type: 'percent', percent: trailingPct },
    },
  };
}

function buildFundamentalStrategySpec(
  session: FundamentalSweepSession,
  variant: FundamentalSweepVariant,
  config: FundamentalBacktestConfig,
): StrategySpec & Record<string, any> {
  const strategyId = slugifyId(`fundamental_${session.source.rule_name || session.source_run_id}`);
  const version = slugifyId(variant.variant_id.slice(-24));
  const variantLabel = (variant.param_values || [])
    .map((param) => `${param.label}=${ruleValueLabel(param.value)}`)
    .join(', ');
  const packageConfig = buildStrategyConfigFromFundamentalConfig(config);
  const now = currentIso();

  return {
    strategy_id: strategyId,
    version,
    strategy_version_id: `${strategyId}_v${version}`,
    status: 'testing',
    asset_class: 'stocks',
    name: `${session.source.rule_name || 'Fundamental Strategy'} [Sweep Candidate]`,
    description: [
      'Promoted from Fundamental Backtester sweep.',
      `Source run: ${session.source_run_id}.`,
      variantLabel ? `Variant: ${variantLabel}.` : '',
      'Lifecycle state: strategy candidate, not validated.',
    ].filter(Boolean).join('\n'),
    base_pattern_id: 'fundamental_backtest_strategy',
    scan_mode: 'strategy',
    version_mode: 'backtest',
    strategy_tag: 'backtest_strategy',
    strategy_tags: ['fundamental', 'research_candidate', 'sweep_candidate'],
    lifecycle_state: 'sweep_candidate',
    validation_status: 'not_validated',
    trade_direction: 'long',
    interval: '1d',
    timeframe: '1d',
    universe: [],
    setup_config: {
      pattern_type: 'fundamental_backtest_strategy',
      source_type: session.source_type,
      source_run_id: session.source_run_id,
      source_sweep_session_id: session.session_id,
      source_variant_id: variant.variant_id,
      rule_name: session.source.rule_name,
    },
    entry_config: packageConfig.entry_config,
    risk_config: packageConfig.risk_config,
    exit_config: packageConfig.exit_config,
    cost_config: {
      commission_per_trade: 0,
      slippage_pct: 0.001,
      spread_pct: 0.001,
    },
    execution_config: {
      production_lock: false,
    },
    parameter_manifest: buildFundamentalStrategyManifest(config, session.sweep_params),
    fundamental_config: packageConfig.fundamental_config,
    backtest_config: {
      fundamental_backtester: true,
      contract_version: 'canonical_strategy_v1',
      source_config_provenance: config,
      source_metrics: session.source.metrics,
      variant_metrics: variant.metrics,
      research_score: variant.research_score,
      rebalance_frequency: config.rebalance_frequency,
      benchmark: config.benchmark,
      result_mode: config.result_mode,
    },
    sweep_evidence: {
      sweep_id: session.session_id,
      variant_id: variant.variant_id,
      source_run_id: session.source_run_id,
      source_type: session.source_type,
      metrics: variant.metrics,
      research_score: variant.research_score,
      note: 'Sweep evidence only. Validation tier status must be earned by running Validator on this promoted strategy.',
    },
    created_at: now,
    updated_at: now,
    created_by: 'fundamental_backtester',
    notes: 'Generated package so Parameter Sweep, Validator, and review tooling can see the strategy knobs.',
  };
}

export async function promoteFundamentalSweepWinnerToStrategy(sessionId: string, variantId?: string): Promise<{ session: FundamentalSweepSession; strategy_version_id: string }> {
  const session = getFundamentalSweepSession(sessionId);
  if (!session) throw new Error('Fundamental sweep session not found');
  const selectedVariant = variantId
    ? session.variants.find((row) => row.variant_id === variantId)
    : session.winner;
  const variant: FundamentalSweepVariant | null = selectedVariant || (!variantId ? {
    variant_id: `${session.session_id}_baseline`,
    param_values: [],
    status: 'completed',
    metrics: session.source.metrics,
    research_score: session.source.research_score,
    result: null,
  } : null);
  if (!variant) throw new Error('No fundamental sweep variant selected to promote');
  if (variant.status !== 'completed') throw new Error('Only completed fundamental sweep variants can be promoted');

  let config = normalizeConfig(session.base_config);
  for (const param of variant.param_values || []) {
    config = applyFundamentalSweepParam(config, param.param_path, param.value);
  }

  const spec = buildFundamentalStrategySpec(session, variant, config);
  const strategyVersionId = await saveStrategy(spec);
  session.promoted_strategy_version_id = strategyVersionId;
  session.promoted_variant_id = variant.variant_id;
  session.promoted_at = currentIso();
  session.updated_at = currentIso();
  saveFundamentalSweepSession(session);
  return { session, strategy_version_id: strategyVersionId };
}

async function executeFundamentalSweep(session: FundamentalSweepSession): Promise<void> {
  const outDir = path.join(FUNDAMENTAL_SWEEP_DIR, session.session_id);
  for (const variant of session.variants) {
    if (session.status !== 'running') break;
    variant.status = 'running';
    session.updated_at = currentIso();
    saveFundamentalSweepSession(session);

    try {
      let config = normalizeConfig(session.base_config);
      for (const param of variant.param_values) {
        config = applyFundamentalSweepParam(config, param.param_path, param.value);
      }
      const summary = await runBacktestConfigOnce(config, outDir, variant.variant_id);
      const metrics = buildVariantMetrics(summary, config);
      variant.status = 'completed';
      variant.result = summary;
      variant.metrics = metrics.metrics;
      variant.research_score = metrics.research_score;
    } catch (err: any) {
      variant.status = 'failed';
      variant.error = err?.message || String(err);
    }
    session.updated_at = currentIso();
    saveFundamentalSweepSession(session);
  }

  session.winner = selectFundamentalSweepWinner(session.variants);
  session.status = session.variants.some((variant) => variant.status === 'completed') ? 'completed' : 'failed';
  session.updated_at = currentIso();
  _activeFundamentalSweeps.delete(session.session_id);
  saveFundamentalSweepSession(session);
}

export function runFundamentalSweepSession(sessionId: string, paramsInput?: any[]): FundamentalSweepSession {
  const session = getFundamentalSweepSession(sessionId);
  if (!session) throw new Error('Fundamental sweep session not found');
  if (_activeFundamentalSweeps.has(session.session_id)) return session;

  const params = Array.isArray(paramsInput) && paramsInput.length
    ? paramsInput.map((param) => ({
        id: String(param.id || param.param_path || '').trim(),
        label: String(param.label || param.param_path || '').trim(),
        param_path: String(param.param_path || '').trim(),
        values: Array.isArray(param.values) ? param.values : [],
      })).filter((param) => param.param_path && param.values.length && isFundamentalSweepParam(param))
    : session.sweep_params.filter(isFundamentalSweepParam).slice(0, 1);

  const combos = cartesianProduct(params);
  if (!combos.length) throw new Error('At least one fundamental sweep value is required');
  if (combos.length > 20) throw new Error(`Grid produces ${combos.length} variants - maximum is 20. Reduce the number of values.`);

  session.variants = combos.map((combo, index) => ({
    variant_id: `${session.session_id}_v${index + 1}_${combo.map((item) => variantValueSlug(item.value)).join('_')}`,
    param_values: combo,
    status: 'pending' as const,
    metrics: null,
    research_score: null,
    result: null,
  }));
  session.status = 'running';
  session.updated_at = currentIso();
  session.winner = null;
  _activeFundamentalSweeps.add(session.session_id);
  saveFundamentalSweepSession(session);
  setImmediate(() => void executeFundamentalSweep(session));
  return session;
}
