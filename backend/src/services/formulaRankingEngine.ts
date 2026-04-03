/**
 * Formula Ranking Engine
 *
 * Ranks SR formulas by backtesting each through an identical baseline strategy
 * via the validator pipeline. Reuses sweep engine patterns for job management,
 * metric collection, and fitness scoring.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FORMULAS_PATH = path.join(DATA_DIR, 'sr_formulas.json');
const STRATEGIES_DIR = path.join(DATA_DIR, 'strategies');
const RANKING_RESULTS_DIR = path.join(DATA_DIR, 'formula-ranking-results');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3002}/api`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormulaRankingConfig {
  baseline_strategy_version_id?: string;
  symbol?: string;
  interval?: string;
  tier?: string;
  force?: boolean;
}

export interface FormulaRankingMetrics {
  total_trades: number;
  expectancy_R: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  oos_degradation_pct: number;
  pass_fail: string;
  composite_score: number;
}

export interface FormulaVariant {
  formula_id: string;
  formula_readable: string;
  variant_id: string;
  strategy_version_id: string;
  job_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  report_id: string | null;
  metrics: FormulaRankingMetrics | null;
  error?: string;
}

export interface FormulaRankingJob {
  job_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  baseline_description: string;
  symbol: string;
  interval: string;
  tier: string;
  variants: FormulaVariant[];
  progress: { completed: number; total: number };
  created_at: string;
  completed_at: string | null;
}

type RankingListener = (event: string, data: unknown) => void;

// ─── In-memory state ──────────────────────────────────────────────────────────

const activeJobs = new Map<string, FormulaRankingJob>();
const jobListeners = new Map<string, Set<RankingListener>>();

export function getRankingJob(jobId: string): FormulaRankingJob | undefined {
  return activeJobs.get(jobId);
}

export function listRankingJobs(): FormulaRankingJob[] {
  return Array.from(activeJobs.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function emitRanking(jobId: string, event: string, data: unknown): void {
  const listeners = jobListeners.get(jobId);
  if (listeners) {
    for (const fn of listeners) {
      try { fn(event, data); } catch {}
    }
  }
}

export function subscribeToRanking(jobId: string, listener: RankingListener): () => void {
  if (!jobListeners.has(jobId)) jobListeners.set(jobId, new Set());
  jobListeners.get(jobId)!.add(listener);
  return () => jobListeners.get(jobId)?.delete(listener);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistRankingJob(job: FormulaRankingJob): Promise<void> {
  await fs.mkdir(RANKING_RESULTS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RANKING_RESULTS_DIR, `${job.job_id}.json`),
    JSON.stringify(job, null, 2),
    'utf-8',
  );
}

function loadFormulaRegistry(): Record<string, any> {
  try {
    if (!fsSync.existsSync(FORMULAS_PATH)) return {};
    const raw = fsSync.readFileSync(FORMULAS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveFormulaRegistry(registry: Record<string, any>): void {
  fsSync.writeFileSync(FORMULAS_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

// ─── Helpers (mirrored from sweepEngine) ──────────────────────────────────────

async function registerTempStrategy(spec: any, variantId: string): Promise<void> {
  await fs.mkdir(STRATEGIES_DIR, { recursive: true });
  await fs.writeFile(
    path.join(STRATEGIES_DIR, `${variantId}.json`),
    JSON.stringify(spec, null, 2),
    'utf-8',
  );
}

async function cleanupTempStrategy(variantId: string): Promise<void> {
  try {
    await fs.unlink(path.join(STRATEGIES_DIR, `${variantId}.json`));
  } catch {}
}

async function startValidatorJob(strategyVersionId: string, tier: string, interval: string): Promise<string> {
  const res = await fetch(`${API_BASE}/validator/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy_version_id: strategyVersionId, tier, interval, skip_tier_gate: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Validator run failed: ${err}`);
  }
  const payload = await res.json() as any;
  return payload?.data?.job_id as string;
}

async function pollJob(jobId: string): Promise<{ status: string; report_id?: string; error?: string }> {
  const maxWaitMs = 90 * 60 * 1000;
  const pollInterval = 8_000;
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    elapsed += pollInterval;
    try {
      const res = await fetch(`${API_BASE}/validator/run/${jobId}`);
      if (!res.ok) continue;
      const payload = await res.json() as any;
      const job = payload?.data;
      if (!job) continue;
      if (job.status === 'completed') return { status: 'completed', report_id: job.report_id };
      if (job.status === 'failed') return { status: 'failed', error: job.error };
    } catch {}
  }
  return { status: 'failed', error: 'Timed out waiting for job' };
}

function computeRankingFitnessScore(report: any, summary: {
  total_trades: number;
  expectancy_R: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  oos_degradation_pct: number;
  pass_fail: string;
}): number {
  const minTradesPass = Number(report?.config?.validation_thresholds?.min_trades_pass ?? 50);
  if (summary.total_trades < Math.min(minTradesPass, 20)) return 0;

  const ddPenalty = summary.max_drawdown_pct <= 30
    ? 1
    : Math.max(0, 1 - (summary.max_drawdown_pct - 30) / 70);
  const verdictMultiplier = summary.pass_fail === 'PASS'
    ? 1
    : summary.pass_fail === 'NEEDS_REVIEW'
      ? 0.85
      : 0.5;

  const expectancyComponent = Math.max(0, Math.min(summary.expectancy_R, 2)) * 0.4;
  const winRateComponent = Math.max(0, Math.min(summary.win_rate, 1)) * 0.2;
  const sharpeComponent = Math.max(0, Math.min(summary.sharpe_ratio / 3.0, 1)) * 0.2;
  const robustnessComponent = Math.max(0, 1 - summary.oos_degradation_pct / 100) * 0.2;
  const raw = expectancyComponent + winRateComponent + sharpeComponent + robustnessComponent;

  return Math.round((raw * ddPenalty * verdictMultiplier) * 1000) / 1000;
}

async function fetchReportMetrics(reportId: string): Promise<FormulaRankingMetrics | null> {
  try {
    const res = await fetch(`${API_BASE}/validator/report/${reportId}`);
    if (!res.ok) return null;
    const payload = await res.json() as any;
    const r = payload?.data;
    if (!r) return null;
    const summary = {
      total_trades: r.trades_summary?.total_trades ?? 0,
      expectancy_R: r.trades_summary?.expectancy_R ?? 0,
      win_rate: r.trades_summary?.win_rate ?? 0,
      profit_factor: r.trades_summary?.profit_factor ?? 0,
      max_drawdown_pct: r.risk_summary?.max_drawdown_pct ?? 100,
      sharpe_ratio: r.risk_summary?.sharpe_ratio ?? 0,
      oos_degradation_pct: r.robustness?.out_of_sample?.oos_degradation_pct ?? 0,
      pass_fail: r.pass_fail ?? 'FAIL',
      composite_score: 0,
    };
    summary.composite_score = computeRankingFitnessScore(r, summary);
    return summary;
  } catch {
    return null;
  }
}

// ─── Baseline strategy builder ────────────────────────────────────────────────

function buildDefaultBaseline(symbol: string, interval: string): any {
  const strategyId = 'sr_ranking_baseline';
  return {
    strategy_id: strategyId,
    version: 1,
    strategy_version_id: `${strategyId}_v1`,
    status: 'draft',
    asset_class: 'stocks',
    name: 'SR Formula Ranking Baseline',
    description: 'Fixed baseline strategy for comparing SR formula performance. Long-only, ATR 2x stop, 2R target, 30-bar max hold.',
    interval,
    timeframe: interval,
    scan_mode: 'strategy',
    trade_direction: 'long',
    universe: [symbol],
    setup_config: {
      pattern_type: 'sr_score',
      formula_id: '',
      score_threshold: 0.0,
    },
    structure_config: {
      swing_method: 'rdp',
      swing_epsilon_pct: 0.05,
      swing_left_bars: 5,
      swing_right_bars: 5,
      swing_first_peak_decline: 0.50,
      swing_subsequent_decline: 0.25,
      base_min_duration: 5,
      base_max_duration: 50,
      base_max_range_pct: 0.15,
      base_volatility_threshold: 0.03,
      causal: true,
    },
    risk_config: {
      stop_type: 'atr_multiple',
      atr_multiplier: 2.0,
      take_profit_R: 2.0,
      max_hold_bars: 30,
    },
    cost_config: {
      commission_per_trade: 1,
      slippage_pct: 0.05,
    },
    parameter_manifest: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ─── Main ranking runner ──────────────────────────────────────────────────────

export async function runFormulaRanking(config: FormulaRankingConfig = {}): Promise<string> {
  const registry = loadFormulaRegistry();
  const formulaIds = Object.keys(registry);
  if (formulaIds.length === 0) {
    throw new Error('No SR formulas found in registry');
  }

  const symbol = config.symbol || 'SPY';
  const interval = config.interval || '1d';
  const tier = config.tier || 'tier1';
  const force = config.force === true;

  const baselineSpec = buildDefaultBaseline(symbol, interval);
  const baselineDescription = `Default SR Baseline (${symbol} ${interval})`;

  const now = new Date().toISOString();
  const staleCutoffMs = 24 * 60 * 60 * 1000; // 24 hours

  const variants: FormulaVariant[] = formulaIds.map((fid) => {
    const entry = registry[fid];
    const existingRanking = entry?.backtest_ranking;
    const isStale = !existingRanking?.ranked_at
      || (Date.now() - new Date(existingRanking.ranked_at).getTime()) > staleCutoffMs;
    const shouldSkip = !force && existingRanking && !isStale;

    return {
      formula_id: fid,
      formula_readable: entry?.formula_readable || entry?.formula || fid,
      variant_id: `rank_${fid}_${uuidv4().slice(0, 6)}`,
      strategy_version_id: `rank_${fid}_${uuidv4().slice(0, 6)}`,
      job_id: null,
      status: shouldSkip ? 'skipped' as const : 'pending' as const,
      report_id: null,
      metrics: shouldSkip && existingRanking ? {
        total_trades: existingRanking.total_trades ?? 0,
        expectancy_R: existingRanking.expectancy_R ?? 0,
        win_rate: existingRanking.win_rate ?? 0,
        profit_factor: existingRanking.profit_factor ?? 0,
        max_drawdown_pct: existingRanking.max_drawdown_pct ?? 100,
        sharpe_ratio: existingRanking.sharpe_ratio ?? 0,
        oos_degradation_pct: existingRanking.oos_degradation_pct ?? 0,
        pass_fail: existingRanking.pass_fail ?? 'FAIL',
        composite_score: existingRanking.composite_score ?? 0,
      } : null,
    };
  });

  const pendingCount = variants.filter(v => v.status === 'pending').length;
  const jobId = `frank_${uuidv4().slice(0, 10)}`;

  const job: FormulaRankingJob = {
    job_id: jobId,
    status: 'running',
    baseline_description: baselineDescription,
    symbol,
    interval,
    tier,
    variants,
    progress: { completed: variants.length - pendingCount, total: variants.length },
    created_at: now,
    completed_at: null,
  };

  activeJobs.set(jobId, job);
  await persistRankingJob(job);

  if (pendingCount === 0) {
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    await persistRankingJob(job);
    return jobId;
  }

  setImmediate(() => executeRanking(job, baselineSpec, tier));
  return jobId;
}

async function executeRanking(
  job: FormulaRankingJob,
  baselineSpec: any,
  tier: string,
): Promise<void> {
  const pendingVariants = job.variants.filter(v => v.status === 'pending');

  for (const variant of pendingVariants) {
    if (job.status !== 'running') break;

    const variantSpec = JSON.parse(JSON.stringify(baselineSpec));
    variantSpec.setup_config.formula_id = variant.formula_id;
    variantSpec.strategy_version_id = variant.strategy_version_id;
    variantSpec.strategy_id = variant.strategy_version_id;
    variantSpec.name = `SR Ranking: ${variant.formula_readable.slice(0, 60)}`;

    await registerTempStrategy(variantSpec, variant.strategy_version_id);

    variant.status = 'running';
    emitRanking(job.job_id, 'variant_start', {
      formula_id: variant.formula_id,
      progress: job.progress,
    });
    await persistRankingJob(job);

    try {
      let validatorJobId: string | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          validatorJobId = await startValidatorJob(variant.strategy_version_id, tier, job.interval);
          break;
        } catch (err: any) {
          if (err.message?.includes('429') || err.message?.includes('Too many')) {
            await new Promise(r => setTimeout(r, 30_000));
          } else {
            throw err;
          }
        }
      }
      if (!validatorJobId) throw new Error('Could not acquire validator slot after retries');

      variant.job_id = validatorJobId;
      await persistRankingJob(job);

      const result = await pollJob(validatorJobId);
      if (result.status === 'completed' && result.report_id) {
        variant.status = 'completed';
        variant.report_id = result.report_id;
        variant.metrics = await fetchReportMetrics(result.report_id);
      } else {
        variant.status = 'failed';
        variant.error = result.error || 'Job failed';
      }
    } catch (err: any) {
      variant.status = 'failed';
      variant.error = err.message;
    }

    await cleanupTempStrategy(variant.strategy_version_id);

    job.progress.completed++;
    emitRanking(job.job_id, 'variant_complete', {
      formula_id: variant.formula_id,
      status: variant.status,
      metrics: variant.metrics,
      progress: job.progress,
    });
    await persistRankingJob(job);

    await new Promise(r => setTimeout(r, 2_000));
  }

  // Write rankings back to sr_formulas.json
  writeRankingsToRegistry(job);

  if (job.status === 'running') {
    job.status = 'completed';
  }
  job.completed_at = new Date().toISOString();
  await persistRankingJob(job);
  emitRanking(job.job_id, 'ranking_complete', {
    status: job.status,
    variants: job.variants.map(v => ({
      formula_id: v.formula_id,
      status: v.status,
      metrics: v.metrics,
    })),
  });
}

function writeRankingsToRegistry(job: FormulaRankingJob): void {
  const registry = loadFormulaRegistry();

  const ranked = job.variants
    .filter(v => (v.status === 'completed' || v.status === 'skipped') && v.metrics)
    .sort((a, b) => (b.metrics?.composite_score ?? 0) - (a.metrics?.composite_score ?? 0));

  for (let i = 0; i < ranked.length; i++) {
    const v = ranked[i];
    if (!registry[v.formula_id]) continue;
    registry[v.formula_id].backtest_ranking = {
      rank: i + 1,
      composite_score: v.metrics!.composite_score,
      expectancy_R: v.metrics!.expectancy_R,
      win_rate: v.metrics!.win_rate,
      profit_factor: v.metrics!.profit_factor,
      sharpe_ratio: v.metrics!.sharpe_ratio,
      max_drawdown_pct: v.metrics!.max_drawdown_pct,
      total_trades: v.metrics!.total_trades,
      oos_degradation_pct: v.metrics!.oos_degradation_pct,
      pass_fail: v.metrics!.pass_fail,
      baseline_strategy: job.baseline_description,
      symbol: job.symbol,
      interval: job.interval,
      ranked_at: new Date().toISOString(),
    };
  }

  // Mark failed formulas with null ranking
  for (const v of job.variants) {
    if (v.status === 'failed' && registry[v.formula_id]) {
      registry[v.formula_id].backtest_ranking = null;
    }
  }

  saveFormulaRegistry(registry);
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelRanking(jobId: string): Promise<void> {
  const job = activeJobs.get(jobId);
  if (!job) throw new Error('Ranking job not found');
  if (job.status !== 'running') throw new Error(`Job is already ${job.status}`);

  job.status = 'cancelled';

  const runningVariant = job.variants.find(v => v.status === 'running' && v.job_id);
  if (runningVariant?.job_id) {
    try {
      await fetch(`${API_BASE}/validator/run/${runningVariant.job_id}/cancel`, { method: 'POST' });
    } catch {}
    runningVariant.status = 'failed';
    runningVariant.error = 'Cancelled by user';
  }

  for (const v of job.variants) {
    if (v.status === 'pending') {
      v.status = 'failed';
      v.error = 'Cancelled by user';
    }
  }

  writeRankingsToRegistry(job);
  job.completed_at = new Date().toISOString();
  await persistRankingJob(job);
}
