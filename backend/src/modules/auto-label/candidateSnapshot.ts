import { toFinite } from './modelOutputParsing';

export type CandidateSnapshot = {
  id: string;
  symbol: string;
  timeframe: string;
  patternType: string;
  score: number;
  entryReady: boolean;
  base?: {
    low?: number;
    high?: number;
    startIndex?: number;
    endIndex?: number;
  };
  checklistPassed?: number;
  checklistTotal?: number;
  chartStats?: {
    bars: number;
    minClose: number;
    maxClose: number;
    latestClose: number;
    meanClose: number;
    stdClose: number;
  };
};

export function summarizeChartStats(chartData: any): CandidateSnapshot['chartStats'] {
  if (!Array.isArray(chartData) || !chartData.length) return undefined;
  const closes = chartData
    .map((bar) => Number(bar?.close))
    .filter((n) => Number.isFinite(n));

  if (!closes.length) return undefined;
  const bars = closes.length;
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const latestClose = closes[bars - 1];
  const meanClose = closes.reduce((acc, v) => acc + v, 0) / bars;
  const variance = closes.reduce((acc, v) => acc + ((v - meanClose) ** 2), 0) / bars;
  const stdClose = Math.sqrt(variance);

  return { bars, minClose, maxClose, latestClose, meanClose, stdClose };
}

export function buildCandidateSnapshot(candidate: any): CandidateSnapshot {
  const rules = Array.isArray(candidate?.rule_checklist) ? candidate.rule_checklist : [];
  const passed = rules.filter((rule: any) => !!rule?.passed).length;
  const chartStats = summarizeChartStats(candidate?.chart_data);

  return {
    id: String(candidate?.id || candidate?.candidate_id || ''),
    symbol: String(candidate?.symbol || ''),
    timeframe: String(candidate?.timeframe || ''),
    patternType: String(candidate?.pattern_type || 'unknown'),
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    entryReady: !!candidate?.entry_ready,
    base: {
      low: toFinite(candidate?.base?.low),
      high: toFinite(candidate?.base?.high),
      startIndex: toFinite(candidate?.base?.startIndex),
      endIndex: toFinite(candidate?.base?.endIndex),
    },
    checklistPassed: rules.length ? passed : undefined,
    checklistTotal: rules.length || undefined,
    chartStats,
  };
}
