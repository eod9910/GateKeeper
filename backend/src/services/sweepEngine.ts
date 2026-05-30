/**
 * Parameter Sweep Engine
 *
 * Runs N backtests varying a single parameter and aggregates results into a
 * ranked comparison table. Sweep session state is persisted in SQLite, while
 * validator execution still runs through the existing API/Python path.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { deleteAppRecord, listAppRecords, writeAppRecord } from './appStateDb';
import { deleteStrategy, getAllStrategies, getStrategy, getStrategyOrComposite, saveStrategy, getValidationReport, saveValidationReport, getTradeInstances, saveTradeInstances, deleteValidationReport } from './storageService';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SWEEPS_DIR = path.join(DATA_DIR, 'sweep-results');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3002}/api`;
const SWEEPS_NAMESPACE = 'sweeps';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SweepParamDef {
  label: string;
  param_path: string;
  values: any[];
}

export interface SweepVariantParamValue {
  label: string;
  param_path: string;
  value: any;
}

export interface SweepValuationMetrics {
  enabled: boolean;
  status: string;
  forward_bars: number | null;
  selected_avg_pct: number | null;
  excluded_avg_pct: number | null;
  spread_pct: number | null;
  hit_rate_pct: number | null;
  t_stat: number | null;
  rebalance_periods: number | null;
  selected_obs: number | null;
  excluded_obs: number | null;
  no_valuation: number | null;
}

export interface SweepVariant {
  variant_id: string;
  strategy_version_id: string;
  param_label: string;
  param_path: string;
  param_value: any;
  param_values?: SweepVariantParamValue[];
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
    valuation?: SweepValuationMetrics;
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
  return Array.from(activeSweeps.values()).filter((sweep) => Array.isArray(sweep.variants) && sweep.variants.length > 0).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistSweep(sweep: SweepReport): Promise<void> {
  writeAppRecord(SWEEPS_NAMESPACE, sweep.sweep_id, sweep, {
    sortKey: String(sweep.created_at || ''),
  });
}

async function deletePersistedSweepFile(sweepId: string): Promise<void> {
  deleteAppRecord(SWEEPS_NAMESPACE, sweepId);
  try {
    await fs.unlink(path.join(SWEEPS_DIR, `${sweepId}.json`));
  } catch {}
}

let _legacySweepsMigrated = false;

async function migrateLegacySweepsIfNeeded(): Promise<void> {
  if (_legacySweepsMigrated) return;
  _legacySweepsMigrated = true;
  try {
    await fs.mkdir(SWEEPS_DIR, { recursive: true });
    const files = await fs.readdir(SWEEPS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(SWEEPS_DIR, file), 'utf-8');
        const sweep = JSON.parse(raw) as SweepReport;
        if (!sweep?.sweep_id) continue;
        writeAppRecord(SWEEPS_NAMESPACE, sweep.sweep_id, sweep, {
          sortKey: String(sweep.created_at || ''),
        });
      } catch {
        // Ignore malformed legacy sweep files.
      }
    }
  } catch {}
}

function metricsNeedBackfill(metrics: SweepVariant['metrics'] | null | undefined): boolean {
  return Boolean(metrics && (
    metrics.pass_fail === undefined ||
    metrics.oos_degradation_pct === undefined ||
    metrics.valuation === undefined
  ));
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
  await migrateLegacySweepsIfNeeded();
  try {
    const sweeps = listAppRecords<SweepReport>(SWEEPS_NAMESPACE);
    for (const sweep of sweeps) {
      try {
        if (!Array.isArray(sweep.variants) || sweep.variants.length === 0) {
          await deletePersistedSweepFile(sweep.sweep_id);
          continue;
        }
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

function toFiniteNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function syncRiskExitAliases(spec: any): any {
  const next = spec && typeof spec === 'object' ? spec : {};
  const risk = (next.risk_config && typeof next.risk_config === 'object') ? next.risk_config : {};
  const exit = (next.exit_config && typeof next.exit_config === 'object') ? next.exit_config : {};
  const targetType = String(exit.target_type || '').trim().toLowerCase();
  const takeProfitR = toFiniteNumber(risk.take_profit_R ?? risk.take_profit_r);
  const targetLevel = toFiniteNumber(exit.target_level);
  const maxHoldBars = toFiniteNumber(risk.max_hold_bars);
  const timeStopBars = toFiniteNumber(exit.time_stop_bars);

  if (targetType === 'r_multiple') {
    if (takeProfitR != null && takeProfitR > 0) {
      exit.target_level = takeProfitR;
    } else if (targetLevel != null && targetLevel > 0) {
      risk.take_profit_R = targetLevel;
    }
  }

  if (maxHoldBars != null && maxHoldBars > 0) {
    exit.time_stop_bars = Math.round(maxHoldBars);
  } else if (timeStopBars != null && timeStopBars > 0) {
    risk.max_hold_bars = Math.round(timeStopBars);
  }

  next.risk_config = risk;
  next.exit_config = exit;
  return next;
}

function upsertOperatingProfileNote(spec: any): any {
  const next = spec && typeof spec === 'object' ? spec : {};
  const interval = String(next.interval || '').trim();
  const marketCapTier = String(next.setup_config?.market_cap_tier || next.market_cap_tier || '').trim().toLowerCase();
  const parts: string[] = [];
  if (interval) parts.push(`interval=${interval}`);
  if (marketCapTier) parts.push(`market_cap_tier=${marketCapTier}`);
  if (!parts.length) return next;

  const cleaned = String(next.description || '')
    .replace(/\n*Operating profile:[^\n]*/gi, '')
    .trim();
  next.description = [cleaned, `Operating profile: ${parts.join('; ')}.`].filter(Boolean).join('\n\n');
  return next;
}

export function computeVariantCount(params: SweepParamDef[]): number {
  if (!params.length) return 0;
  return params.reduce((product, p) => product * (p.values?.length || 0), 1);
}

function cartesianProduct(sweepParams: SweepParamDef[]): SweepVariantParamValue[][] {
  if (sweepParams.length === 0) return [];
  if (sweepParams.length === 1) {
    return sweepParams[0].values.map(v => [{ label: sweepParams[0].label, param_path: sweepParams[0].param_path, value: v }]);
  }
  const [first, ...rest] = sweepParams;
  const restCombos = cartesianProduct(rest);
  const result: SweepVariantParamValue[][] = [];
  for (const val of first.values) {
    const entry: SweepVariantParamValue = { label: first.label, param_path: first.param_path, value: val };
    for (const combo of restCombos) {
      result.push([entry, ...combo]);
    }
  }
  return result;
}

function variantIdSuffix(paramValues: SweepVariantParamValue[]): string {
  return paramValues.map(pv => String(pv.value).replace(/[^a-zA-Z0-9]/g, '_')).join('_');
}

async function registerTempStrategy(spec: any, variantId: string): Promise<string> {
  await saveStrategy(spec, true);
  return variantId;
}

async function cleanupTempStrategy(variantId: string): Promise<void> {
  try {
    await deleteStrategy(variantId);
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
      valuation: undefined as SweepValuationMetrics | undefined,
    };
    const valuation = r.valuation_validation || {};
    if (valuation.enabled) {
      const selected = valuation.selected || {};
      const excluded = valuation.excluded || {};
      const spread = valuation.spread || {};
      const observations = valuation.observations || {};
      const cfg = valuation.config || {};
      summary.valuation = {
        enabled: Boolean(valuation.enabled),
        status: String(valuation.status || ''),
        forward_bars: cfg.forward_bars == null ? null : Number(cfg.forward_bars),
        selected_avg_pct: selected.avg_forward_return_pct == null ? null : Number(selected.avg_forward_return_pct),
        excluded_avg_pct: excluded.avg_forward_return_pct == null ? null : Number(excluded.avg_forward_return_pct),
        spread_pct: spread.avg_return_spread_pct == null ? null : Number(spread.avg_return_spread_pct),
        hit_rate_pct: spread.hit_rate == null ? null : Number(spread.hit_rate) * 100,
        t_stat: spread.t_stat == null ? null : Number(spread.t_stat),
        rebalance_periods: Number(spread.periods ?? selected.periods ?? 0),
        selected_obs: observations.selected == null ? null : Number(observations.selected),
        excluded_obs: observations.excluded == null ? null : Number(observations.excluded),
        no_valuation: observations.no_valuation == null ? null : Number(observations.no_valuation),
      };
    }
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

  const primaryParam = sweepParams[0];
  if (!primaryParam || primaryParam.values.length === 0) {
    throw new Error('At least one sweep parameter with values is required');
  }
  const totalVariants = computeVariantCount(sweepParams);
  if (totalVariants > 20) {
    throw new Error(`Grid produces ${totalVariants} variants — maximum is 20. Reduce the number of values.`);
  }

  const isGrid = sweepParams.length > 1;

  // Date-time based ID: sweep_YYYYMMDD_HHmmss_<4-char-uniquifier>
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const sweepId = `sweep_${datePart}_${timePart}_${uuidv4().slice(0, 4)}`;
  const effectiveInterval = interval || (baseStrategy as any).interval || '1wk';

  const combos = cartesianProduct(sweepParams);
  const variants: SweepVariant[] = combos.map((combo) => {
    const suffix = variantIdSuffix(combo);
    return {
      variant_id: `${sweepId}_${suffix}`,
      strategy_version_id: `${sweepId}_${suffix}`,
      param_label: isGrid ? combo.map(c => c.label).join(' × ') : primaryParam.label,
      param_path: isGrid ? combo.map(c => c.param_path).join(' × ') : primaryParam.param_path,
      param_value: isGrid ? combo.map(c => c.value).join(' × ') : combo[0].value,
      param_values: combo,
      job_id: null,
      status: 'pending' as const,
      report_id: null,
      metrics: null,
    };
  });

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
  setImmediate(() => executeSweep(sweep, baseStrategy, effectiveInterval, tier));

  return sweepId;
}

async function executeSweep(
  sweep: SweepReport,
  baseStrategy: any,
  interval: string,
  tier: string,
): Promise<void> {
  for (const variant of sweep.variants) {
    if (sweep.status !== 'running') break;

    // Build variant spec — apply all param_values from the Cartesian combo
    const pvs = variant.param_values || [];
    const isTimeframeSweep = pvs.some(pv => pv.param_path === 'interval');
    let variantInterval = interval;
    // validation_tier is identity-preserving: overrides which universe is tested
    let variantTier = tier;

    let variantSpec = JSON.parse(JSON.stringify(baseStrategy));
    for (const pv of pvs) {
      if (pv.param_path === 'interval') {
        variantSpec.interval = String(pv.value);
        variantInterval = String(pv.value);
      } else if (pv.param_path === 'validation_tier') {
        variantTier = String(pv.value);
      } else {
        variantSpec = setNestedValue(variantSpec, pv.param_path, pv.value);
      }
    }
    variantSpec = upsertOperatingProfileNote(syncRiskExitAliases(variantSpec));
    variantSpec.strategy_version_id = variant.variant_id;
    variantSpec.strategy_id = variant.variant_id;
    variantSpec.status = 'draft';
    const nameLabel = pvs.map(pv => `${pv.label}=${pv.value}`).join(', ');
    variantSpec.name = `${baseStrategy.name || baseStrategy.strategy_version_id} [${nameLabel}]`;

    // Register temp strategy
    await registerTempStrategy(variantSpec, variant.variant_id);

    variant.status = 'running';
    await persistSweep(sweep);

    try {
      // Start job — wait for queue slot (retry up to 3 times with backoff)
      let jobId: string | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          jobId = await startValidatorJob(variant.variant_id, variantTier, variantInterval);
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

    // Remove the temp strategy record — it was only needed during the validation run.
    // The promoted winner gets a permanent strategy version written by promoteWinner().
    await cleanupTempStrategy(variant.variant_id);

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

export async function deleteSweepVariant(sweepId: string, variantId: string): Promise<void> {
  const sweep = activeSweeps.get(sweepId);
  if (!sweep) throw new Error('Sweep not found');
  if (!variantId) throw new Error('Variant id is required');

  const variant = sweep.variants.find(v => v.variant_id === variantId);
  if (!variant) throw new Error('Variant not found');
  if (variant.status === 'running') {
    throw new Error('Cannot delete a running variant');
  }

  if (variant.report_id) {
    await deleteValidationReport(variant.report_id);
  }
  await cleanupTempStrategy(variant.variant_id);

  sweep.variants = sweep.variants.filter(v => v.variant_id !== variantId);

  if (sweep.winner?.variant_id === variantId) {
    sweep.winner = selectSweepWinner(sweep.variants);
  }
  if (sweep.promoted_variant_id === variantId) {
    sweep.promoted_variant_id = null;
    sweep.promoted_strategy_version_id = null;
    sweep.promoted_at = null;
  }

  if (sweep.variants.length === 0) {
    activeSweeps.delete(sweepId);
    await deletePersistedSweepFile(sweepId);
    return;
  }

  await persistSweep(sweep);
}

export async function deleteSweep(sweepId: string): Promise<void> {
  const sweep = activeSweeps.get(sweepId);
  if (!sweep) throw new Error('Sweep not found');
  if (sweep.status === 'running') throw new Error('Cannot delete a running sweep');

  for (const variant of sweep.variants) {
    if (variant.report_id) {
      await deleteValidationReport(variant.report_id);
    }
    await cleanupTempStrategy(variant.variant_id);
  }

  activeSweeps.delete(sweepId);
  await deletePersistedSweepFile(sweepId);
}

export async function pruneSweepVariantsByReportId(reportId: string): Promise<void> {
  if (!reportId) return;

  for (const [sweepId, sweep] of activeSweeps.entries()) {
    const matchingVariants = sweep.variants.filter(v => v.report_id === reportId);
    if (!matchingVariants.length) continue;

    for (const variant of matchingVariants) {
      await cleanupTempStrategy(variant.variant_id);
    }

    const deletedVariantIds = new Set(matchingVariants.map(v => v.variant_id));
    sweep.variants = sweep.variants.filter(v => !deletedVariantIds.has(v.variant_id));

    if (sweep.winner && deletedVariantIds.has(sweep.winner.variant_id)) {
      sweep.winner = selectSweepWinner(sweep.variants);
    }
    if (sweep.promoted_variant_id && deletedVariantIds.has(sweep.promoted_variant_id)) {
      sweep.promoted_variant_id = null;
      sweep.promoted_strategy_version_id = null;
      sweep.promoted_at = null;
    }

    if (sweep.variants.length === 0) {
      activeSweeps.delete(sweepId);
      await deletePersistedSweepFile(sweepId);
      continue;
    }

    await persistSweep(sweep);
  }
}

// ─── Copy report to promoted strategy ────────────────────────────────────────

async function copyReportToPromotedId(variantReportId: string, newStrategyVersionId: string): Promise<void> {
  try {
    const report = await getValidationReport(variantReportId);
    if (!report) return;
    const newReportId = `${newStrategyVersionId}_promoted`;
    const cloned = { ...report, report_id: newReportId, strategy_version_id: newStrategyVersionId };
    await saveValidationReport(cloned);
    const trades = await getTradeInstances(variantReportId);
    if (trades.length > 0) await saveTradeInstances(newReportId, trades);
  } catch {
    // Non-fatal — if the variant report was already cleaned up, skip silently
  }
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

  // Try to read the persisted temp variant first; if cleaned up already, reconstruct from base + params.
  let spec: any;
  const persistedVariant = await getStrategy(variant.variant_id);
  if (persistedVariant) {
    spec = syncRiskExitAliases(JSON.parse(JSON.stringify(persistedVariant)));
  } else {
    // Temp file was cleaned up after validation — reconstruct from the sweep's base strategy.
    const base = await getStrategyOrComposite(baseStrategyVersionId)
      || await getStrategyOrComposite(sweep.base_strategy_version_id);
    if (!base) throw new Error(`Cannot reconstruct variant spec: base strategy ${baseStrategyVersionId} not found`);
    spec = JSON.parse(JSON.stringify(base));
    // Apply all param values for this variant
    const pvs = variant.param_values || [];
    if (pvs.length > 0) {
      for (const pv of pvs) {
        if (pv.param_path === 'interval') {
          spec.interval = String(pv.value);
        } else if (pv.param_path === 'validation_tier') {
          // validation_tier is not a strategy field — skip writing it to spec
        } else {
          spec = setNestedValue(spec, pv.param_path, pv.value);
        }
      }
      spec = syncRiskExitAliases(spec);
    } else {
      // Legacy fallback for old single-param sweeps without param_values
      const primaryParam = sweep.sweep_params[0];
      if (primaryParam) {
        spec = setNestedValue(spec, primaryParam.param_path, variant.param_value);
      }
      spec = syncRiskExitAliases(spec);
    }
    spec.strategy_version_id = variant.variant_id;
    spec.strategy_id = variant.variant_id;
    spec.status = 'draft';
    const nameLabel = pvs.length > 0
      ? pvs.map(pv => `${pv.label}=${pv.value}`).join(', ')
      : `${sweep.sweep_params[0]?.label || 'param'}=${variant.param_value}`;
    spec.name = `${base.name || base.strategy_version_id} [${nameLabel}]`;
  }
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
    // Strip all accumulated decorators back to the bare strategy name:
    // [v\d+] version tags, [Sweep Winner], [param=value] blocks, and — suffix chains
    nextName = nextName.replace(/\s*\[v\d+\]/gi, '').trim();
    nextName = nextName.replace(/\s*\[Sweep Winner\]/gi, '').trim();
    nextName = nextName.replace(/\s*\[[^\]]+=[^\]]+\]/g, '').trim();
    nextName = nextName.replace(/\s*—.*$/, '').trim();
    // Name is now just the base strategy name — append version only
    return `${nextName} [v${nextVersion}]`;
  };

  spec.strategy_version_id = newId;
  spec.strategy_id = strategyId;
  spec.version = nextVersion;
  spec.status = 'rejected'; // Hidden until user explicitly clicks "Send to Validator"
  spec.name = rewritePromotedName(spec.name);
  spec.created_at = new Date().toISOString();
  spec.updated_at = new Date().toISOString();
  spec = upsertOperatingProfileNote(syncRiskExitAliases(spec));
  const pvs2 = variant.param_values || [];
  const promoLabel = pvs2.length > 0
    ? pvs2.map(pv => `${pv.label}=${pv.value}`).join(', ')
    : `${paramLabel || 'parameter'}=${valueLabel}`;
  spec.description = `${String(spec.description || '').trim()}\n\nPromoted from sweep ${sweepId} via ${promoLabel}.`.trim();

  // Preserve the base pattern id so downstream tools (smart plan, sweep engine) can always
  // resolve the pattern definition JSON for tunable params / suggested_values / manifest.
  if (!spec.base_pattern_id) {
    const basePatternId = (sweep.base_strategy_version_id || baseStrategyVersionId)
      .replace(/_v\d+$/, '')
      .replace(/^sweep_[a-f0-9]+-\d+_\d+_\d+_/, '');
    spec.base_pattern_id = basePatternId;
  }

  await saveStrategy(spec);
  // Copy the variant's validation report to the promoted ID so the tier gate
  // sees a Tier 1 PASS for the new strategy version without re-running.
  if (variant.report_id) {
    await copyReportToPromotedId(variant.report_id, newId);
  }
  sweep.promoted_strategy_version_id = newId;
  sweep.promoted_variant_id = variant.variant_id;
  sweep.promoted_at = new Date().toISOString();
  await persistSweep(sweep);

  return newId;
}
