import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { readJsonDocument, writeJsonDocument } from './appStateDb';

export interface ValuationBacktestConfig {
  frequency: 'monthly' | 'quarterly';
  horizons: number[];
  gap_threshold_pct: number;
  cap_tier?: 'micro' | 'small' | 'mid' | 'large' | null;
  limit?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface ValuationBacktestRuntimeState {
  running: boolean;
  pid: number | null;
  job_id: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  last_message: string | null;
  last_source: 'manual' | 'scheduled' | null;
  last_config: ValuationBacktestConfig;
}

interface GroupedBucketStateSummary {
  observations: number;
  usable_returns: number;
  avg_forward_return_pct: number | null;
  median_forward_return_pct: number | null;
  directional_accuracy: number | null;
  hit_fair_value_rate: number | null;
}

interface GroupedBreakoutSummary {
  observations: number;
  symbols: number;
  horizons: Record<string, { by_state: Record<string, GroupedBucketStateSummary> }>;
}

interface GroupedValuationSummary {
  source_observations_csv: string;
  cap_tier_source: string;
  observation_count: number;
  symbol_count: number;
  horizons: number[];
  cap_tier_breakout: Record<string, GroupedBreakoutSummary>;
  quality_breakout: Record<string, GroupedBreakoutSummary>;
  consumer_cycle_note: string;
}

interface ValuationBacktestSnapshot {
  runtime: ValuationBacktestRuntimeState;
  summary: any | null;
  grouped_summary: GroupedValuationSummary | null;
  files: {
    summary_json: string;
    observations_csv: string;
    grouped_json: string;
    grouped_md: string;
  };
}

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'backend', 'data');
const RESEARCH_DIR = path.join(DATA_DIR, 'research');
const ACCURACY_SCRIPT = path.join(ROOT_DIR, 'backend', 'scripts', 'run_valuation_gap_accuracy_study.py');
const VALUATION_SNAPSHOT_PATH = path.join(RESEARCH_DIR, 'valuation_universe_snapshot.json');
const SUMMARY_OUTPUT_PATH = path.join(RESEARCH_DIR, 'valuation_gap_accuracy_summary_app.json');
const OBSERVATIONS_OUTPUT_PATH = path.join(RESEARCH_DIR, 'valuation_gap_accuracy_observations_app.csv');
const GROUPED_OUTPUT_PATH = path.join(RESEARCH_DIR, 'valuation_gap_grouped_summary_app.json');
const GROUPED_MD_OUTPUT_PATH = path.join(RESEARCH_DIR, 'valuation_gap_grouped_summary_app.md');
const RUNTIME_NAMESPACE = 'research_tools';
const RUNTIME_DOCUMENT_KEY = 'valuation_backtest_runtime';
const SNAPSHOT_DOCUMENT_KEY = 'valuation_backtest_snapshot';

let _activeProcess: ChildProcess | null = null;

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : 'python3';
}

function normalizeConfig(input?: Partial<ValuationBacktestConfig> | null): ValuationBacktestConfig {
  const normalizedFrequency = input?.frequency === 'quarterly' ? 'quarterly' : 'monthly';
  const horizons = Array.isArray(input?.horizons)
    ? input!.horizons
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [63, 126, 252];

  const capTier = input?.cap_tier && ['micro', 'small', 'mid', 'large'].includes(String(input.cap_tier))
    ? (String(input.cap_tier) as ValuationBacktestConfig['cap_tier'])
    : null;

  const limit = Number.isFinite(Number(input?.limit)) && Number(input?.limit) > 0
    ? Number(input!.limit)
    : null;

  const gapThreshold = Number.isFinite(Number(input?.gap_threshold_pct))
    ? Math.max(1, Math.min(Number(input!.gap_threshold_pct), 200))
    : 20;

  const startDate = String(input?.start_date || '').trim() || null;
  const endDate = String(input?.end_date || '').trim() || null;

  return {
    frequency: normalizedFrequency,
    horizons: horizons.length ? horizons : [63, 126, 252],
    gap_threshold_pct: gapThreshold,
    cap_tier: capTier,
    limit,
    start_date: startDate,
    end_date: endDate,
  };
}

function defaultRuntimeState(): ValuationBacktestRuntimeState {
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

let _runtimeState: ValuationBacktestRuntimeState =
  readJsonDocument<ValuationBacktestRuntimeState>(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY) || defaultRuntimeState();

function saveRuntimeState(next: ValuationBacktestRuntimeState): void {
  _runtimeState = {
    ...defaultRuntimeState(),
    ...next,
    last_config: normalizeConfig(next.last_config),
  };
  writeJsonDocument(RUNTIME_NAMESPACE, RUNTIME_DOCUMENT_KEY, _runtimeState);
}

function loadJsonIfExists<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function round4(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10000) / 10000;
}

function parseCsv(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function parseCapTierMap(): Map<string, string> {
  const map = new Map<string, string>();
  const snapshot = loadJsonIfExists<any>(VALUATION_SNAPSHOT_PATH);
  const rows = Array.isArray(snapshot)
    ? snapshot
    : Array.isArray(snapshot?.rows)
      ? snapshot.rows
      : [];
  for (const row of rows) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    const capTier = String(row?.market_cap_bucket || '').trim().toLowerCase();
    if (symbol && capTier) map.set(symbol, capTier);
  }
  return map;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeGroupedRows(rows: Record<string, string>[], horizon: number): { by_state: Record<string, GroupedBucketStateSummary> } {
  const states = ['undervalued', 'overvalued', 'roughly_fair'];
  const by_state: Record<string, GroupedBucketStateSummary> = {};
  for (const state of states) {
    const stateRows = rows.filter((row) => row.valuation_state === state);
    const forwardKey = `forward_return_${horizon}d_pct`;
    const targetKey = `hit_fair_value_${horizon}d`;
    const returns = stateRows
      .map((row) => Number(row[forwardKey]))
      .filter((value) => Number.isFinite(value));
    const hitFlags = stateRows
      .map((row) => row[targetKey])
      .filter((value) => value === 'True' || value === 'False')
      .map((value) => value === 'True');
    const directional =
      state === 'undervalued'
        ? returns.map((value) => value > 0)
        : state === 'overvalued'
          ? returns.map((value) => value < 0)
          : [];

    by_state[state] = {
      observations: stateRows.length,
      usable_returns: returns.length,
      avg_forward_return_pct: returns.length ? round4(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
      median_forward_return_pct: round4(median(returns)),
      directional_accuracy: directional.length ? round4(directional.filter(Boolean).length / directional.length) : null,
      hit_fair_value_rate: hitFlags.length ? round4(hitFlags.filter(Boolean).length / hitFlags.length) : null,
    };
  }
  return { by_state };
}

function buildGroupedSummary(observationsCsvPath: string): GroupedValuationSummary {
  const rows = parseCsv(observationsCsvPath);
  const capTierMap = parseCapTierMap();
  const normalizedRows = rows.map((row) => ({
    ...row,
    symbol: String(row.symbol || '').trim().toUpperCase(),
    quality_grade: String(row.quality_grade || '').trim().toLowerCase(),
    cap_tier: capTierMap.get(String(row.symbol || '').trim().toUpperCase()) || 'unknown',
  }));

  const horizons = [63, 126, 252];
  const buildGroup = (key: string, values: string[]): Record<string, GroupedBreakoutSummary> => {
    const out: Record<string, GroupedBreakoutSummary> = {};
    for (const value of values) {
      const groupRows = normalizedRows.filter((row) => String(row[key] || '') === value);
      out[value] = {
        observations: groupRows.length,
        symbols: new Set(groupRows.map((row) => row.symbol)).size,
        horizons: Object.fromEntries(
          horizons.map((horizon) => [String(horizon), summarizeGroupedRows(groupRows, horizon)]),
        ),
      };
    }
    return out;
  };

  return {
    source_observations_csv: observationsCsvPath,
    cap_tier_source: VALUATION_SNAPSHOT_PATH,
    observation_count: normalizedRows.length,
    symbol_count: new Set(normalizedRows.map((row) => row.symbol)).size,
    horizons,
    cap_tier_breakout: buildGroup('cap_tier', ['micro', 'small', 'mid', 'large', 'unknown']),
    quality_breakout: buildGroup('quality_grade', ['high', 'good', 'mixed', 'weak']),
    consumer_cycle_note: 'Consumer-cycle breakout is not included yet because symbol-catalog consumer classifications are only partially backfilled.',
  };
}

function writeGroupedMarkdown(summary: GroupedValuationSummary): void {
  const lines: string[] = [];
  lines.push('# Valuation Gap Grouped Summary');
  lines.push('');
  lines.push(`- Observations: ${summary.observation_count}`);
  lines.push(`- Symbols: ${summary.symbol_count}`);
  lines.push(`- Source observations: \`${summary.source_observations_csv}\``);
  lines.push(`- Cap tier source: \`${summary.cap_tier_source}\``);
  lines.push('');
  lines.push('## Cap Tier');
  for (const key of ['micro', 'small', 'mid', 'large', 'unknown']) {
    const group = summary.cap_tier_breakout[key];
    lines.push(`### ${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    lines.push(`- Symbols: ${group?.symbols || 0}`);
    lines.push(`- Observations: ${group?.observations || 0}`);
    for (const horizon of summary.horizons) {
      const under = group?.horizons?.[String(horizon)]?.by_state?.undervalued;
      const over = group?.horizons?.[String(horizon)]?.by_state?.overvalued;
      lines.push(`- ${horizon}d undervalued: avg ${under?.avg_forward_return_pct ?? 'n/a'}% | dir acc ${under?.directional_accuracy ?? 'n/a'}`);
      lines.push(`- ${horizon}d overvalued: avg ${over?.avg_forward_return_pct ?? 'n/a'}% | dir acc ${over?.directional_accuracy ?? 'n/a'}`);
    }
    lines.push('');
  }
  lines.push('## Quality Grade');
  for (const key of ['high', 'good', 'mixed', 'weak']) {
    const group = summary.quality_breakout[key];
    lines.push(`### ${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    lines.push(`- Symbols: ${group?.symbols || 0}`);
    lines.push(`- Observations: ${group?.observations || 0}`);
    for (const horizon of summary.horizons) {
      const under = group?.horizons?.[String(horizon)]?.by_state?.undervalued;
      const over = group?.horizons?.[String(horizon)]?.by_state?.overvalued;
      lines.push(`- ${horizon}d undervalued: avg ${under?.avg_forward_return_pct ?? 'n/a'}% | dir acc ${under?.directional_accuracy ?? 'n/a'}`);
      lines.push(`- ${horizon}d overvalued: avg ${over?.avg_forward_return_pct ?? 'n/a'}% | dir acc ${over?.directional_accuracy ?? 'n/a'}`);
    }
    lines.push('');
  }
  lines.push('## Consumer Cycle');
  lines.push(`- ${summary.consumer_cycle_note}`);
  fs.writeFileSync(GROUPED_MD_OUTPUT_PATH, lines.join('\n'), 'utf-8');
}

function writeSnapshotDocument(): void {
  const summary = loadJsonIfExists<any>(SUMMARY_OUTPUT_PATH);
  const grouped = loadJsonIfExists<GroupedValuationSummary>(GROUPED_OUTPUT_PATH);
  const snapshot: ValuationBacktestSnapshot = {
    runtime: _runtimeState,
    summary,
    grouped_summary: grouped,
    files: {
      summary_json: SUMMARY_OUTPUT_PATH,
      observations_csv: OBSERVATIONS_OUTPUT_PATH,
      grouped_json: GROUPED_OUTPUT_PATH,
      grouped_md: GROUPED_MD_OUTPUT_PATH,
    },
  };
  writeJsonDocument(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY, snapshot);
}

function updateRuntime(partial: Partial<ValuationBacktestRuntimeState>): void {
  saveRuntimeState({
    ..._runtimeState,
    ...partial,
    last_config: partial.last_config ? normalizeConfig(partial.last_config) : _runtimeState.last_config,
  });
  writeSnapshotDocument();
}

export function getValuationBacktestStatus(): ValuationBacktestSnapshot {
  writeSnapshotDocument();
  return (
    readJsonDocument<ValuationBacktestSnapshot>(RUNTIME_NAMESPACE, SNAPSHOT_DOCUMENT_KEY) || {
      runtime: _runtimeState,
      summary: loadJsonIfExists<any>(SUMMARY_OUTPUT_PATH),
      grouped_summary: loadJsonIfExists<GroupedValuationSummary>(GROUPED_OUTPUT_PATH),
      files: {
        summary_json: SUMMARY_OUTPUT_PATH,
        observations_csv: OBSERVATIONS_OUTPUT_PATH,
        grouped_json: GROUPED_OUTPUT_PATH,
        grouped_md: GROUPED_MD_OUTPUT_PATH,
      },
    }
  );
}

export function runValuationBacktest(configInput?: Partial<ValuationBacktestConfig> | null): ValuationBacktestSnapshot {
  if (_activeProcess) {
    return getValuationBacktestStatus();
  }
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  const config = normalizeConfig(configInput);
  const jobId = `valuation_gap_${Date.now()}`;
  const args = [
    ACCURACY_SCRIPT,
    '--frequency',
    config.frequency,
    '--horizons',
    config.horizons.join(','),
    '--gap-threshold-pct',
    String(config.gap_threshold_pct),
    '--output-json',
    SUMMARY_OUTPUT_PATH,
    '--output-csv',
    OBSERVATIONS_OUTPUT_PATH,
  ];
  if (config.cap_tier) {
    args.push('--cap-tier', String(config.cap_tier));
  }
  if (config.limit) {
    args.push('--limit', String(config.limit));
  }
  if (config.start_date) {
    args.push('--start-date', config.start_date);
  }
  if (config.end_date) {
    args.push('--end-date', config.end_date);
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
    last_message: '[ValuationBacktest] Running PIT valuation-gap study...',
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
    if ((code ?? 0) === 0) {
      try {
        const grouped = buildGroupedSummary(OBSERVATIONS_OUTPUT_PATH);
        fs.writeFileSync(GROUPED_OUTPUT_PATH, JSON.stringify(grouped, null, 2), 'utf-8');
        writeGroupedMarkdown(grouped);
        updateRuntime({
          running: false,
          pid: null,
          last_finished_at: new Date().toISOString(),
          last_exit_code: 0,
          last_error: null,
          last_message: '[ValuationBacktest] Study complete.',
        });
        return;
      } catch (error: any) {
        updateRuntime({
          running: false,
          pid: null,
          last_finished_at: new Date().toISOString(),
          last_exit_code: 1,
          last_error: error?.message || String(error),
          last_message: error?.message || String(error),
        });
        return;
      }
    }

    updateRuntime({
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: code ?? 1,
      last_error: _runtimeState.last_error || `Process exited with code ${code ?? 1}`,
      last_message: _runtimeState.last_error || `Process exited with code ${code ?? 1}`,
    });
  });

  return getValuationBacktestStatus();
}

