/**
 * Parameter Sweep Engine
 *
 * Runs N backtests varying a single parameter and aggregates results into a
 * ranked comparison table. Pure JSON manipulation — no Python changes needed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getAllStrategies, getStrategyOrComposite, saveStrategy } from './storageService';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SWEEPS_DIR = path.join(DATA_DIR, 'sweep-results');
const STRATEGIES_DIR = path.join(DATA_DIR, 'strategies');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3002}/api`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SweepParamDef {
  label: string;
  param_path: string;
  values: any[];
}

export interface SweepVariant {
  variant_id: string;
  strategy_version_id: string;
  param_label: string;
  param_path: string;
  param_value: any;
  job_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  report_id: string | null;
  metrics: {
    total_trades: number;
    expectancy_R: number;
    win_rate: number;
    profit_factor: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    oos_degradation_pct: number;
    pass_fail: string;
    fitness_score: number;
  } | null;
  error?: string;
}

export interface SweepReport {
  sweep_id: string;
  base_strategy_version_id: string;
  sweep_params: SweepParamDef[];
  tier: string;
  interval: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  variants: SweepVariant[];
  winner: SweepVariant | null;
  promoted_strategy_version_id?: string | null;
  promoted_variant_id?: string | null;
  promoted_at?: string | null;
  created_at: string;
  completed_at: string | null;
}

// ─── In-memory registry ───────────────────────────────────────────────────────

const activeSweeps = new Map<string, SweepReport>();

export function getSweep(sweepId: string): SweepReport | undefined {
  return activeSweeps.get(sweepId);
}

export function listSweeps(): SweepReport[] {
  return Array.from(activeSweeps.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistSweep(sweep: SweepReport): Promise<void> {
  await fs.mkdir(SWEEPS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SWEEPS_DIR, `${sweep.sweep_id}.json`),
    JSON.stringify(sweep, null, 2),
    'utf-8',
  );
}

function metricsNeedBackfill(metrics: SweepVariant['metrics'] | null | undefined): boolean {
  return Boolean(metrics && (metrics.pass_fail === undefined || metrics.oos_degradation_pct === undefined));
}

async function backfillSweepMetrics(sweep: SweepReport): Promise<boolean> {
  let changed = false;

  for (const variant of sweep.variants) {
    if (!variant.report_id || !metricsNeedBackfill(variant.metrics)) continue;
    const repaired = await fetchReportMetrics(variant.report_id);
    if (!repaired) continue;
    variant.metrics = repaired;
    changed = true;
  }

  if (sweep.winner?.report_id && metricsNeedBackfill(sweep.winner.metrics)) {
    const repairedWinner = await fetchReportMetrics(sweep.winner.report_id);
    if (repairedWinner) {
      sweep.winner.metrics = repairedWinner;
      changed = true;
    }
  }

  return changed;
}

export async function loadAllSweeps(): Promise<void> {
  try {
    await fs.mkdir(SWEEPS_DIR, { recursive: true });
    const files = await fs.readdir(SWEEPS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(SWEEPS_DIR, f), 'utf-8');
        const sweep = JSON.parse(raw) as SweepReport;
        if (await backfillSweepMetrics(sweep)) {
          await persistSweep(sweep);
        }
        activeSweeps.set(sweep.sweep_id, sweep);
      } catch {}
    }
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setNestedValue(obj: any, dotPath: string, value: any): any {
  const clone = JSON.parse(JSON.stringify(obj));
  const parts = dotPath.split('.');
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] === undefined || cur[key] === null) cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

async function registerTempStrategy(spec: any, variantId: string): Promise<string> {
  await fs.mkdir(STRATEGIES_DIR, { recursive: true });
  const filePath = path.join(STRATEGIES_DIR, `${variantId}.json`);
  await fs.writeFile(filePath, JSON.stringify(spec, null, 2), 'utf-8');
  return filePath;
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

function computeSweepFitnessScore(report: any, summary: {
  total_trades: number;
  expectancy_R: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  oos_degradation_pct: number;
  pass_fail: string;
}): number {
  const minTradesPass = Number(report?.config?.validation_thresholds?.min_trades_pass ?? 200);
  if (summary.total_trades < minTradesPass) return 0;

  const ddPenalty = summary.max_drawdown_pct <= 30
    ? 1
    : Math.max(0, 1 - (summary.max_drawdown_pct - 30) / 70);
  const verdictMultiplier = summary.pass_fail === 'PASS'
    ? 1
    : summary.pass_fail === 'NEEDS_REVIEW'
      ? 0.85
      : 0;

  const expectancyComponent = Math.max(0, Math.min(summary.expectancy_R, 2)) * 0.4;
  const winRateComponent = Math.max(0, Math.min(summary.win_rate, 1)) * 0.2;
  const sharpeComponent = Math.max(0, Math.min(summary.sharpe_ratio / 3.0, 1)) * 0.2;
  const robustnessComponent = Math.max(0, 1 - summary.oos_degradation_pct / 100) * 0.2;
  const raw = expectancyComponent + winRateComponent + sharpeComponent + robustnessComponent;

  return Math.round((raw * ddPenalty * verdictMultiplier) * 1000) / 1000;
}

function variantVerdictRank(variant: SweepVariant): number {
  const verdict = String(variant.metrics?.pass_fail || '').toUpperCase();
  if (verdict === 'PASS') return 2;
  if (verdict === 'NEEDS_REVIEW') return 1;
  if (verdict === 'FAIL') return 0;
  return -1;
}

function selectSweepWinner(variants: SweepVariant[]): SweepVariant | null {
  const completed = variants.filter(v => v.status === 'completed' && v.metrics);
  if (completed.length === 0) return null;
  const sorted = completed.slice().sort((a, b) => {
    const verdictDelta = variantVerdictRank(b) - variantVerdictRank(a);
    if (verdictDelta !== 0) return verdictDelta;
    const fitnessDelta = (b.metrics?.fitness_score ?? -1) - (a.metrics?.fitness_score ?? -1);
    if (fitnessDelta !== 0) return fitnessDelta;
    const expectancyDelta = (b.metrics?.expectancy_R ?? -999) - (a.metrics?.expectancy_R ?? -999);
    if (expectancyDelta !== 0) return expectancyDelta;
    const profitFactorDelta = (b.metrics?.profit_factor ?? -999) - (a.metrics?.profit_factor ?? -999);
    if (profitFactorDelta !== 0) return profitFactorDelta;
    return (b.metrics?.total_trades ?? -999) - (a.metrics?.total_trades ?? -999);
  });
  return sorted[0] || null;
}

async function fetchReportMetrics(reportId: string): Promise<SweepVariant['metrics'] | null> {
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
      fitness_score: 0,
    };
    summary.fitness_score = computeSweepFitnessScore(r, summary);
    return summary;
  } catch {
    return null;
  }
}

// ─── Main sweep runner ────────────────────────────────────────────────────────

export async function runSweep(
  baseStrategyVersionId: string,
  sweepParams: SweepParamDef[],
  tier: string = 'tier1',
  interval?: string,
): Promise<string> {
  const baseStrategy = await getStrategyOrComposite(baseStrategyVersionId);
  if (!baseStrategy) throw new Error(`Strategy not found: ${baseStrategyVersionId}`);

  // Use first sweep param for label; future: support cartesian product
  const primaryParam = sweepParams[0];
  if (!primaryParam || primaryParam.values.length === 0) {
    throw new Error('At least one sweep parameter with values is required');
  }
  if (primaryParam.values.length > 20) {
    throw new Error('Maximum 20 variants per sweep');
  }

  const sweepId = `sweep_${uuidv4().slice(0, 10)}`;
  const effectiveInterval = interval || (baseStrategy as any).interval || '1wk';

  const variants: SweepVariant[] = primaryParam.values.map((value) => ({
    variant_id: `${sweepId}_${String(value).replace(/[^a-zA-Z0-9]/g, '_')}`,
    strategy_version_id: `${sweepId}_${String(value).replace(/[^a-zA-Z0-9]/g, '_')}`,
    param_label: primaryParam.label,
    param_path: primaryParam.param_path,
    param_value: value,
    job_id: null,
    status: 'pending',
    report_id: null,
    metrics: null,
  }));

  const sweep: SweepReport = {
    sweep_id: sweepId,
    base_strategy_version_id: baseStrategyVersionId,
    sweep_params: sweepParams,
    tier,
    interval: effectiveInterval,
    status: 'running',
    variants,
    winner: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };

  activeSweeps.set(sweepId, sweep);
  await persistSweep(sweep);

  // Run variants sequentially in background
  setImmediate(() => executeSweep(sweep, baseStrategy, primaryParam, effectiveInterval, tier));

  return sweepId;
}

async function executeSweep(
  sweep: SweepReport,
  baseStrategy: any,
  param: SweepParamDef,
  interval: string,
  tier: string,
): Promise<void> {
  for (const variant of sweep.variants) {
    if (sweep.status !== 'running') break;

    // Determine per-variant interval: if sweeping 'interval', use the variant value
    const isTimeframeSweep = param.param_path === 'interval';
    const variantInterval = isTimeframeSweep ? String(variant.param_value) : interval;

    // Build variant spec — apply primary param, then any linked secondary params
    let variantSpec = isTimeframeSweep
      ? JSON.parse(JSON.stringify(baseStrategy))
      : setNestedValue(baseStrategy, param.param_path, variant.param_value);
    if (isTimeframeSweep) {
      variantSpec.interval = variantInterval;
    }
    const valueIndex = param.values.indexOf(variant.param_value);
    for (let pi = 1; pi < sweep.sweep_params.length; pi++) {
      const sp = sweep.sweep_params[pi];
      const spValue = valueIndex >= 0 && valueIndex < sp.values.length
        ? sp.values[valueIndex]
        : variant.param_value;
      variantSpec = setNestedValue(variantSpec, sp.param_path, spValue);
    }
    variantSpec.strategy_version_id = variant.variant_id;
    variantSpec.strategy_id = variant.variant_id;
    variantSpec.status = 'draft';
    variantSpec.name = `${baseStrategy.name || baseStrategy.strategy_version_id} [${param.label}=${variant.param_value}]`;

    // Register temp strategy
    await registerTempStrategy(variantSpec, variant.variant_id);

    variant.status = 'running';
    await persistSweep(sweep);

    try {
      // Start job — wait for queue slot (retry up to 3 times with backoff)
      let jobId: string | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          jobId = await startValidatorJob(variant.variant_id, tier, variantInterval);
          break;
        } catch (err: any) {
          if (err.message?.includes('429') || err.message?.includes('Too many')) {
            await new Promise(r => setTimeout(r, 30_000)); // wait 30s for slot
          } else {
            throw err;
          }
        }
      }
      if (!jobId) throw new Error('Could not acquire validator slot after retries');

      variant.job_id = jobId;
      await persistSweep(sweep);

      // Poll to completion
      const result = await pollJob(jobId);
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

    await persistSweep(sweep);
    // Brief pause between variants
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Find winner — highest fitness among completed variants
  sweep.winner = selectSweepWinner(sweep.variants);

  if (sweep.status === 'running') {
    sweep.status = 'completed';
  }
  sweep.completed_at = new Date().toISOString();
  await persistSweep(sweep);
}

// ─── Cancel sweep ─────────────────────────────────────────────────────────────

const API_CANCEL = `http://127.0.0.1:${process.env.PORT || 3002}/api`;

export async function cancelSweep(sweepId: string): Promise<void> {
  const sweep = activeSweeps.get(sweepId);
  if (!sweep) throw new Error('Sweep not found');
  if (sweep.status !== 'running') throw new Error(`Sweep is already ${sweep.status}`);

  sweep.status = 'cancelled';

  // Cancel the currently-running validator job if any
  const runningVariant = sweep.variants.find(v => v.status === 'running' && v.job_id);
  if (runningVariant?.job_id) {
    try {
      await fetch(`${API_CANCEL}/validator/run/${runningVariant.job_id}/cancel`, { method: 'POST' });
    } catch {}
    runningVariant.status = 'failed';
    runningVariant.error = 'Cancelled by user';
  }

  // Mark remaining pending variants as failed
  for (const v of sweep.variants) {
    if (v.status === 'pending') {
      v.status = 'failed';
      v.error = 'Cancelled by user';
    }
  }

  // Pick winner from whatever completed before cancellation
  sweep.winner = selectSweepWinner(sweep.variants);

  sweep.completed_at = new Date().toISOString();
  await persistSweep(sweep);
}

// ─── Promote winner ───────────────────────────────────────────────────────────

export async function promoteWinner(sweepId: string, baseStrategyVersionId: string, variantId?: string): Promise<string> {
  const sweep = activeSweeps.get(sweepId);
  if (!sweep) throw new Error('Sweep not found');

  const variant = variantId
    ? sweep.variants.find(v => v.variant_id === variantId)
    : sweep.winner;
  if (!variant) throw new Error('No sweep variant selected to promote');
  if (variant.status !== 'completed') throw new Error('Only completed variants can be promoted');

  const winnerFile = path.join(STRATEGIES_DIR, `${variant.variant_id}.json`);
  const raw = await fs.readFile(winnerFile, 'utf-8');
  const spec = JSON.parse(raw);
  const allStrategies = await getAllStrategies();
  const strategyId = String(spec.strategy_id || baseStrategyVersionId.replace(/_v\d+$/, '')).trim();
  const siblings = allStrategies.filter(s => String(s.strategy_id || '').trim() === strategyId);
  const nextVersion = siblings.reduce((max, s) => Math.max(max, Number(s.version) || 0), 0) + 1;
  const newId = `${strategyId}_v${nextVersion}`;

  const paramLabel = String(variant.param_label || '').trim();
  const paramValue = variant.param_value;
  const formatValue = (value: any): string => {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    }
    return String(value);
  };
  const valueLabel = formatValue(paramValue);
  const rewritePromotedName = (currentName: string): string => {
    let nextName = String(currentName || '').trim() || newId;
    if (paramLabel === 'Take Profit R') {
      if (/\b\d+(\.\d+)?R TP\b/i.test(nextName)) {
        nextName = nextName.replace(/\b\d+(\.\d+)?R TP\b/i, `${valueLabel}R TP`);
      } else {
        nextName = `${nextName} — ${valueLabel}R TP`;
      }
    } else if (paramLabel === 'ATR Multiplier') {
      if (/\bATR\s+\d+(\.\d+)?x\b/i.test(nextName)) {
        nextName = nextName.replace(/\bATR\s+\d+(\.\d+)?x\b/i, `ATR ${valueLabel}x`);
      } else {
        nextName = `${nextName} — ATR ${valueLabel}x`;
      }
    } else {
      nextName = `${nextName} [${paramLabel}=${valueLabel}]`;
    }
    nextName = nextName.replace(/\s+\[Sweep Winner\]$/i, '').trim();
    return `${nextName} [v${nextVersion}]`;
  };

  spec.strategy_version_id = newId;
  spec.strategy_id = strategyId;
  spec.version = nextVersion;
  spec.status = 'draft';
  spec.name = rewritePromotedName(spec.name);
  spec.created_at = new Date().toISOString();
  spec.updated_at = new Date().toISOString();
  spec.description = `${String(spec.description || '').trim()}\n\nPromoted from sweep ${sweepId} via ${paramLabel || 'parameter'}=${valueLabel}.`.trim();

  await saveStrategy(spec);
  sweep.promoted_strategy_version_id = newId;
  sweep.promoted_variant_id = variant.variant_id;
  sweep.promoted_at = new Date().toISOString();
  await persistSweep(sweep);

  return newId;
}
