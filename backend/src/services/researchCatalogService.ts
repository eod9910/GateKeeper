import { getAllStrategies, getAllValidationReports } from './storageService';
import { listAppRecords } from './appStateDb';

type NullableNumber = number | null;
const SWEEPS_NAMESPACE = 'sweeps';

export interface ResearchCatalogStrategyRow {
  strategy_version_id: string;
  strategy_id: string;
  name: string;
  status: string;
  asset_class: string;
  interval: string;
  version: number | string | null;
  updated_at: string | null;
  sweep_count: number;
  validation_report_count: number;
  latest_report_at: string | null;
  latest_validation_tier: string | null;
  latest_pass_fail: string | null;
  best_fitness_score: NullableNumber;
  best_expectancy_R: NullableNumber;
  best_win_rate: NullableNumber;
  best_profit_factor: NullableNumber;
  best_total_trades: NullableNumber;
}

export interface ResearchCatalogSweepRow {
  sweep_id: string;
  base_strategy_version_id: string;
  base_strategy_name: string;
  status: string;
  tier: string;
  interval: string;
  created_at: string | null;
  completed_at: string | null;
  variant_count: number;
  completed_variants: number;
  failed_variants: number;
  winner_variant_id: string | null;
  winner_fitness_score: NullableNumber;
}

export interface ResearchCatalogSummary {
  generated_at: string;
  strategy_count: number;
  sweep_count: number;
  validation_report_count: number;
  passing_report_count: number;
  approved_strategy_count: number;
}

export interface ResearchCatalogSnapshot {
  summary: ResearchCatalogSummary;
  strategies: ResearchCatalogStrategyRow[];
  sweeps: ResearchCatalogSweepRow[];
}

function toFiniteNumber(value: any): NullableNumber {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function reportCreatedMs(report: any): number {
  const ms = Date.parse(String(report?.created_at || ''));
  return Number.isFinite(ms) ? ms : 0;
}

export async function buildResearchCatalogSnapshot(): Promise<ResearchCatalogSnapshot> {
  const [strategies, reports] = await Promise.all([
    getAllStrategies(),
    getAllValidationReports(),
  ]);
  const sweeps = listAppRecords<any>(SWEEPS_NAMESPACE).filter((sweep) => sweep && typeof sweep === 'object');

  const reportsByStrategy = new Map<string, any[]>();
  for (const report of reports) {
    const strategyVersionId = String(report?.strategy_version_id || '').trim();
    if (!strategyVersionId) continue;
    if (!reportsByStrategy.has(strategyVersionId)) {
      reportsByStrategy.set(strategyVersionId, []);
    }
    reportsByStrategy.get(strategyVersionId)!.push(report);
  }

  const sweepsByBaseStrategy = new Map<string, any[]>();
  for (const sweep of sweeps) {
    const strategyVersionId = String(sweep?.base_strategy_version_id || '').trim();
    if (!strategyVersionId) continue;
    if (!sweepsByBaseStrategy.has(strategyVersionId)) {
      sweepsByBaseStrategy.set(strategyVersionId, []);
    }
    sweepsByBaseStrategy.get(strategyVersionId)!.push(sweep);
  }

  const strategyRows: ResearchCatalogStrategyRow[] = strategies.map((strategy) => {
    const strategyVersionId = String(strategy?.strategy_version_id || '').trim();
    const strategyReports = (reportsByStrategy.get(strategyVersionId) || [])
      .slice()
      .sort((a, b) => reportCreatedMs(b) - reportCreatedMs(a));
    const strategySweeps = sweepsByBaseStrategy.get(strategyVersionId) || [];
    const latestReport = strategyReports[0] || null;

    let bestFitnessScore: NullableNumber = null;
    let bestExpectancyR: NullableNumber = null;
    let bestWinRate: NullableNumber = null;
    let bestProfitFactor: NullableNumber = null;
    let bestTotalTrades: NullableNumber = null;

    for (const report of strategyReports) {
      const fitnessScore = toFiniteNumber(
        report?.robustness?.fitness_score
        ?? report?.fitness_score
        ?? report?.summary?.fitness_score,
      );
      if (fitnessScore != null && (bestFitnessScore == null || fitnessScore > bestFitnessScore)) {
        bestFitnessScore = fitnessScore;
        bestExpectancyR = toFiniteNumber(report?.trades_summary?.expectancy_R);
        bestWinRate = toFiniteNumber(report?.trades_summary?.win_rate);
        bestProfitFactor = toFiniteNumber(report?.trades_summary?.profit_factor);
        bestTotalTrades = toFiniteNumber(report?.trades_summary?.total_trades);
      }
    }

    return {
      strategy_version_id: strategyVersionId,
      strategy_id: String(strategy?.strategy_id || '').trim(),
      name: String(strategy?.name || '').trim() || strategyVersionId,
      status: String(strategy?.status || '').trim() || 'unknown',
      asset_class: String(strategy?.asset_class || '').trim() || 'unknown',
      interval: String(strategy?.interval || '').trim() || 'unknown',
      version: strategy?.version ?? null,
      updated_at: strategy?.updated_at || null,
      sweep_count: strategySweeps.length,
      validation_report_count: strategyReports.length,
      latest_report_at: latestReport?.created_at || null,
      latest_validation_tier: String(latestReport?.config?.validation_tier || '').trim() || null,
      latest_pass_fail: String(latestReport?.pass_fail || '').trim() || null,
      best_fitness_score: bestFitnessScore,
      best_expectancy_R: bestExpectancyR,
      best_win_rate: bestWinRate,
      best_profit_factor: bestProfitFactor,
      best_total_trades: bestTotalTrades,
    };
  }).sort((a, b) => {
    const reportDelta = Date.parse(String(b.latest_report_at || 0)) - Date.parse(String(a.latest_report_at || 0));
    if (Number.isFinite(reportDelta) && reportDelta !== 0) return reportDelta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const strategyNameById = new Map(strategyRows.map((row) => [row.strategy_version_id, row.name]));
  const sweepRows: ResearchCatalogSweepRow[] = sweeps
    .map((sweep) => {
      const variants = Array.isArray(sweep?.variants) ? sweep.variants : [];
      return {
        sweep_id: String(sweep?.sweep_id || '').trim(),
        base_strategy_version_id: String(sweep?.base_strategy_version_id || '').trim(),
        base_strategy_name: strategyNameById.get(String(sweep?.base_strategy_version_id || '').trim()) || String(sweep?.base_strategy_version_id || '').trim(),
        status: String(sweep?.status || '').trim() || 'unknown',
        tier: String(sweep?.tier || '').trim() || 'unknown',
        interval: String(sweep?.interval || '').trim() || 'unknown',
        created_at: sweep?.created_at || null,
        completed_at: sweep?.completed_at || null,
        variant_count: variants.length,
        completed_variants: variants.filter((variant: any) => variant?.status === 'completed').length,
        failed_variants: variants.filter((variant: any) => variant?.status === 'failed').length,
        winner_variant_id: String(sweep?.winner?.variant_id || '').trim() || null,
        winner_fitness_score: toFiniteNumber(sweep?.winner?.metrics?.fitness_score),
      };
    })
    .sort((a, b) => Date.parse(String(b.created_at || 0)) - Date.parse(String(a.created_at || 0)));

  const passingReportCount = reports.filter((report) => String(report?.pass_fail || '').trim().toUpperCase() === 'PASS').length;
  const approvedStrategyCount = strategies.filter((strategy) => String(strategy?.status || '').trim().toLowerCase() === 'approved').length;

  return {
    summary: {
      generated_at: new Date().toISOString(),
      strategy_count: strategyRows.length,
      sweep_count: sweepRows.length,
      validation_report_count: reports.length,
      passing_report_count: passingReportCount,
      approved_strategy_count: approvedStrategyCount,
    },
    strategies: strategyRows,
    sweeps: sweepRows,
  };
}
