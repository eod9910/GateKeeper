import {
  FundamentalsSnapshotV2,
  FundamentalsTone,
  FundamentalsEarningsHistoryRow,
  FundamentalsForwardExpectations,
  FundamentalsInsiderTrade,
  FundamentalsInstitutionalHolder,
  FundamentalsMarketContext,
  FundamentalsOwnership,
  FundamentalsPositioning,
  FundamentalsReportedExecution,
  StrategyCandidate,
} from '../types';
import { ChartBar, RawChartBar, formatChartBars } from './chartData';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : value == null ? null : String(value);
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : value == null ? null : null;
}

function asNullableNumber(value: unknown, digits?: number): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (typeof digits === 'number') {
    return Number(num.toFixed(digits));
  }
  return num;
}

function sanitizeTone(value: unknown): FundamentalsTone {
  return value === 'positive' || value === 'warning' || value === 'danger' || value === 'neutral' || value === 'muted'
    ? value
    : 'neutral';
}

function sanitizeTag(tag: unknown): { label: string; tone: FundamentalsTone } | null {
  const obj = asObject(tag);
  if (!obj) return null;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  const tone = sanitizeTone(typeof obj.tone === 'string' ? obj.tone.trim() : 'neutral');
  if (!label) return null;
  return { label, tone };
}

function sanitizeEarningsHistoryRow(row: unknown): FundamentalsEarningsHistoryRow | null {
  const obj = asObject(row);
  if (!obj) return null;
  return {
    period: asNullableString(obj.period),
    date: asNullableString(obj.date),
    epsActual: asNullableNumber(obj.epsActual),
    epsEstimate: asNullableNumber(obj.epsEstimate),
    epsSurprisePct: asNullableNumber(obj.epsSurprisePct),
    salesActual: asNullableNumber(obj.salesActual),
    salesEstimate: asNullableNumber(obj.salesEstimate),
    salesSurprisePct: asNullableNumber(obj.salesSurprisePct),
  };
}

function sanitizeInsiderTrade(row: unknown): FundamentalsInsiderTrade | null {
  const obj = asObject(row);
  if (!obj) return null;
  return {
    insider: asNullableString(obj.insider),
    relationship: asNullableString(obj.relationship),
    date: asNullableString(obj.date),
    transaction: asNullableString(obj.transaction),
    cost: asNullableString(obj.cost),
    shares: asNullableString(obj.shares),
    value: asNullableString(obj.value),
  };
}

function sanitizeInstitutionalHolder(row: unknown): FundamentalsInstitutionalHolder | null {
  const obj = asObject(row);
  if (!obj) return null;
  return {
    holder: asNullableString(obj.holder),
    shares: asNullableString(obj.shares),
    value: asNullableString(obj.value),
    pctOut: asNullableString(obj.pctOut),
  };
}

function sanitizeReportedExecution(value: unknown): FundamentalsReportedExecution | null {
  const obj = asObject(value);
  if (!obj) return null;
  return {
    score: asNullableNumber(obj.score),
    epsBeatStreak: asNullableNumber(obj.epsBeatStreak),
    epsMissStreak: asNullableNumber(obj.epsMissStreak),
    avgEpsSurprisePct: asNullableNumber(obj.avgEpsSurprisePct),
    avgSalesSurprisePct: asNullableNumber(obj.avgSalesSurprisePct),
    latestEpsSurprisePct: asNullableNumber(obj.latestEpsSurprisePct),
    latestPeriod: asNullableString(obj.latestPeriod),
    history: Array.isArray(obj.history)
      ? obj.history.map(sanitizeEarningsHistoryRow).filter((row): row is FundamentalsEarningsHistoryRow => Boolean(row))
      : [],
  };
}

function sanitizeForwardExpectations(value: unknown): FundamentalsForwardExpectations | null {
  const obj = asObject(value);
  if (!obj) return null;
  const signal = obj.signal === 'supportive' || obj.signal === 'weak' || obj.signal === 'mixed' ? obj.signal : null;
  return {
    score: asNullableNumber(obj.score),
    signal,
    currentQtrGrowthPct: asNullableNumber(obj.currentQtrGrowthPct),
    nextQtrGrowthPct: asNullableNumber(obj.nextQtrGrowthPct),
    currentYearGrowthPct: asNullableNumber(obj.currentYearGrowthPct),
    nextYearGrowthPct: asNullableNumber(obj.nextYearGrowthPct),
    quarterlyRevenueGrowthPct: asNullableNumber(obj.quarterlyRevenueGrowthPct),
    quarterlyEarningsGrowthPct: asNullableNumber(obj.quarterlyEarningsGrowthPct),
    raw: asObject(obj.raw),
  };
}

function sanitizePositioning(value: unknown): FundamentalsPositioning | null {
  const obj = asObject(value);
  if (!obj) return null;
  const signal = obj.signal === 'buying' || obj.signal === 'selling' || obj.signal === 'mixed' || obj.signal === 'quiet'
    ? obj.signal
    : null;
  return {
    score: asNullableNumber(obj.score),
    signal,
    recentBuyCount: asNullableNumber(obj.recentBuyCount),
    recentSellCount: asNullableNumber(obj.recentSellCount),
    recentBuyValue: asNullableNumber(obj.recentBuyValue),
    recentSellValue: asNullableNumber(obj.recentSellValue),
    recentTrades: Array.isArray(obj.recentTrades)
      ? obj.recentTrades.map(sanitizeInsiderTrade).filter((row): row is FundamentalsInsiderTrade => Boolean(row))
      : [],
  };
}

function sanitizeMarketContext(value: unknown): FundamentalsMarketContext | null {
  const obj = asObject(value);
  if (!obj) return null;
  return {
    score: asNullableNumber(obj.score),
    fiftyDayMovingAverage: asNullableNumber(obj.fiftyDayMovingAverage),
    twoHundredDayMovingAverage: asNullableNumber(obj.twoHundredDayMovingAverage),
    fiftyTwoWeekChangePct: asNullableNumber(obj.fiftyTwoWeekChangePct),
    priceVs50DayPct: asNullableNumber(obj.priceVs50DayPct),
    priceVs200DayPct: asNullableNumber(obj.priceVs200DayPct),
    priceVs52WeekRangePct: asNullableNumber(obj.priceVs52WeekRangePct),
    above50Day: asNullableBoolean(obj.above50Day),
    above200Day: asNullableBoolean(obj.above200Day),
    avgVolume3Month: asNullableNumber(obj.avgVolume3Month),
  };
}

function sanitizeOwnership(value: unknown): FundamentalsOwnership | null {
  const obj = asObject(value);
  if (!obj) return null;
  return {
    institutionalOwnershipPct: asNullableNumber(obj.institutionalOwnershipPct),
    insiderOwnershipPct: asNullableNumber(obj.insiderOwnershipPct),
    topInstitutionalHolders: Array.isArray(obj.topInstitutionalHolders)
      ? obj.topInstitutionalHolders
        .map(sanitizeInstitutionalHolder)
        .filter((row): row is FundamentalsInstitutionalHolder => Boolean(row))
      : [],
  };
}

function sanitizeChartBar(bar: unknown): ChartBar | null {
  const obj = asObject(bar);
  if (!obj) return null;
  const time = obj.time;
  const open = asNullableNumber(obj.open);
  const high = asNullableNumber(obj.high);
  const low = asNullableNumber(obj.low);
  const close = asNullableNumber(obj.close);
  if ((typeof time !== 'string' && typeof time !== 'number') || open == null || high == null || low == null || close == null) {
    return null;
  }
  return { time, open, high, low, close };
}

function sanitizeRawChartBar(bar: unknown): RawChartBar | null {
  const obj = asObject(bar);
  if (!obj) return null;
  const timestamp = asNullableString(obj.timestamp);
  const open = asNullableNumber(obj.open);
  const high = asNullableNumber(obj.high);
  const low = asNullableNumber(obj.low);
  const close = asNullableNumber(obj.close);
  if (!timestamp || open == null || high == null || low == null || close == null) {
    return null;
  }
  return { timestamp, open, high, low, close };
}

function sanitizeRuleChecklist(rows: unknown): Array<{ rule_name: string; passed: boolean; value: any; threshold: any }> {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const obj = asObject(row);
      if (!obj || typeof obj.rule_name !== 'string' || typeof obj.passed !== 'boolean') return null;
      return {
        rule_name: obj.rule_name,
        passed: obj.passed,
        value: obj.value,
        threshold: obj.threshold,
      };
    })
    .filter((row): row is { rule_name: string; passed: boolean; value: any; threshold: any } => Boolean(row));
}

function sanitizeVisual(value: unknown): Record<string, any> | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;

  const visual: Record<string, any> = {};
  if (Array.isArray(obj.markers)) visual.markers = obj.markers;
  if (Array.isArray(obj.overlay_series)) visual.overlay_series = obj.overlay_series;
  if (Array.isArray(obj.overlays)) visual.overlays = obj.overlays;
  if (Array.isArray(obj.lines)) visual.lines = obj.lines;
  if (Array.isArray(obj.hlevels)) visual.hlevels = obj.hlevels;

  return Object.keys(visual).length > 0 ? visual : undefined;
}

function sanitizeCandidate(candidate: unknown): StrategyCandidate | null {
  const obj = asObject(candidate);
  if (!obj) return null;

  const candidateId = typeof obj.candidate_id === 'string' && obj.candidate_id.trim()
    ? obj.candidate_id.trim()
    : (typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : '');
  const strategyVersionId = typeof obj.strategy_version_id === 'string' ? obj.strategy_version_id.trim() : '';
  const symbol = typeof obj.symbol === 'string' ? obj.symbol.trim().toUpperCase() : '';
  const timeframe = typeof obj.timeframe === 'string' ? obj.timeframe.trim() : '';
  const score = asNullableNumber(obj.score, 4);
  const entryReady = typeof obj.entry_ready === 'boolean' ? obj.entry_ready : null;
  const windowStart = asNullableNumber(obj.window_start);
  const windowEnd = asNullableNumber(obj.window_end);
  const createdAt = typeof obj.created_at === 'string' ? obj.created_at : '';
  const ruleChecklist = sanitizeRuleChecklist(obj.rule_checklist);

  if (!candidateId || !strategyVersionId || !symbol || !timeframe || score == null || entryReady == null || windowStart == null || windowEnd == null || !createdAt) {
    return null;
  }

  const chartData = Array.isArray(obj.chart_data)
    ? obj.chart_data.map(sanitizeChartBar).filter((bar): bar is ChartBar => Boolean(bar))
    : [];

  return {
    candidate_id: candidateId,
    id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : candidateId,
    strategy_version_id: strategyVersionId,
    spec_hash: typeof obj.spec_hash === 'string' ? obj.spec_hash : undefined,
    symbol,
    interval: typeof obj.interval === 'string' ? obj.interval : undefined,
    timeframe,
    score,
    entry_ready: entryReady,
    rule_checklist: ruleChecklist,
    anchors: asObject(obj.anchors) || {},
    window_start: windowStart,
    window_end: windowEnd,
    created_at: createdAt,
    model_version: typeof obj.model_version === 'string' ? obj.model_version : undefined,
    chart_data: chartData,
    visual: sanitizeVisual(obj.visual),
    overlays: Array.isArray(obj.overlays) ? obj.overlays : undefined,
    overlay_series: Array.isArray(obj.overlay_series) ? obj.overlay_series : undefined,
    candidate_role: obj.candidate_role === 'context_indicator' || obj.candidate_role === 'pattern_detector' || obj.candidate_role === 'entry_signal'
      ? obj.candidate_role
      : undefined,
    candidate_role_label: typeof obj.candidate_role_label === 'string' ? obj.candidate_role_label : undefined,
    candidate_actionability: obj.candidate_actionability === 'context_only' || obj.candidate_actionability === 'setup_watch' || obj.candidate_actionability === 'entry_ready'
      ? obj.candidate_actionability
      : undefined,
    candidate_actionability_label: typeof obj.candidate_actionability_label === 'string' ? obj.candidate_actionability_label : undefined,
    candidate_semantic_summary: typeof obj.candidate_semantic_summary === 'string' ? obj.candidate_semantic_summary : undefined,
    candidate_origin_role: typeof obj.candidate_origin_role === 'string' ? obj.candidate_origin_role : undefined,
    candidate_entry_type: typeof obj.candidate_entry_type === 'string' ? obj.candidate_entry_type : undefined,
    pattern_type: typeof obj.pattern_type === 'string' ? obj.pattern_type : undefined,
    prior_peak: obj.prior_peak,
    markdown: obj.markdown,
    base: obj.base,
    first_markup: obj.first_markup,
    pullback: obj.pullback,
    second_breakout: obj.second_breakout,
    retracement_pct: asNullableNumber(obj.retracement_pct) ?? undefined,
    small_peak: obj.small_peak,
    chart_prior_peak: asNullableNumber(obj.chart_prior_peak) ?? undefined,
    chart_markdown_low: asNullableNumber(obj.chart_markdown_low) ?? undefined,
    chart_base_start: asNullableNumber(obj.chart_base_start) ?? undefined,
    chart_base_end: asNullableNumber(obj.chart_base_end) ?? undefined,
    chart_first_markup: asNullableNumber(obj.chart_first_markup) ?? undefined,
    chart_markup_high: asNullableNumber(obj.chart_markup_high) ?? undefined,
    chart_pullback_low: asNullableNumber(obj.chart_pullback_low) ?? undefined,
    chart_second_breakout: asNullableNumber(obj.chart_second_breakout) ?? undefined,
    pattern_start_date: typeof obj.pattern_start_date === 'string' ? obj.pattern_start_date : undefined,
    pattern_end_date: typeof obj.pattern_end_date === 'string' ? obj.pattern_end_date : undefined,
  };
}

export function normalizeChartOhlcvPayload(payload: unknown, fallbackSymbol: string, fallbackInterval: string): {
  success: true;
  symbol: string;
  interval: string;
  bars: number;
  chart_data: ChartBar[];
} {
  const root = asObject(payload);
  const data = asObject(root?.data) || root || {};
  const symbol = typeof data.symbol === 'string' && data.symbol.trim() ? data.symbol.trim().toUpperCase() : fallbackSymbol;
  const interval = typeof data.interval === 'string' && data.interval.trim() ? data.interval.trim() : fallbackInterval;

  let chartData: ChartBar[] = [];
  if (Array.isArray(data.chart_data)) {
    chartData = data.chart_data.map(sanitizeChartBar).filter((bar): bar is ChartBar => Boolean(bar));
  } else if (Array.isArray(data.raw_bars)) {
    const rawBars = data.raw_bars.map(sanitizeRawChartBar).filter((bar): bar is RawChartBar => Boolean(bar));
    chartData = formatChartBars(rawBars);
  }

  return {
    success: true,
    symbol,
    interval,
    bars: chartData.length,
    chart_data: chartData,
  };
}

export function normalizeScannerRunResult(payload: unknown): {
  symbol: string;
  count: number;
  candidates: StrategyCandidate[];
  bars?: number;
  cache_hit?: boolean;
  error?: string;
} {
  const root = asObject(payload);
  const data = asObject(root?.data) || root || {};
  const candidates = Array.isArray(data.candidates)
    ? data.candidates.map(sanitizeCandidate).filter((row): row is StrategyCandidate => Boolean(row))
    : [];

  return {
    symbol: typeof data.symbol === 'string' ? data.symbol.trim().toUpperCase() : '',
    count: candidates.length,
    candidates,
    bars: asNullableNumber(data.bars) ?? undefined,
    cache_hit: typeof data.cache_hit === 'boolean' ? data.cache_hit : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export function normalizeScannerUniverseResult(payload: unknown): {
  total_symbols: number;
  total_candidates: number;
  results: Array<{
    symbol: string;
    count: number;
    candidates: StrategyCandidate[];
    bars?: number;
    cache_hit?: boolean;
    error?: string;
  }>;
} {
  const root = asObject(payload);
  const data = asObject(root?.data) || root || {};
  const results = Array.isArray(data.results)
    ? data.results.map(normalizeScannerRunResult)
    : [];
  return {
    total_symbols: asNullableNumber(data.total_symbols) ?? results.length,
    total_candidates: results.reduce((sum, row) => sum + row.candidates.length, 0),
    results,
  };
}

export function normalizeFundamentalsSnapshot(payload: unknown): FundamentalsSnapshotV2 {
  const obj = asObject(payload);
  if (!obj || typeof obj.symbol !== 'string' || !obj.symbol.trim()) {
    throw new Error('Invalid fundamentals payload: missing symbol');
  }

  const tags = Array.isArray(obj.tags)
    ? obj.tags.map(sanitizeTag).filter((tag): tag is { label: string; tone: FundamentalsTone } => Boolean(tag))
    : [];

  return {
    symbol: obj.symbol.trim().toUpperCase(),
    companyName: asNullableString(obj.companyName),
    sector: asNullableString(obj.sector),
    industry: asNullableString(obj.industry),
    country: asNullableString(obj.country),
    exchange: asNullableString(obj.exchange),
    currentPrice: asNullableNumber(obj.currentPrice),
    targetPrice: asNullableNumber(obj.targetPrice),
    marketCap: asNullableNumber(obj.marketCap),
    enterpriseValue: asNullableNumber(obj.enterpriseValue),
    enterpriseToSales: asNullableNumber(obj.enterpriseToSales),
    netCash: asNullableNumber(obj.netCash),
    cashPctMarketCap: asNullableNumber(obj.cashPctMarketCap),
    lowEnterpriseValueFlag: Boolean(obj.lowEnterpriseValueFlag),
    floatShares: asNullableNumber(obj.floatShares),
    floatSharesYoYChangePct: asNullableNumber(obj.floatSharesYoYChangePct),
    sharesOutstanding: asNullableNumber(obj.sharesOutstanding),
    sharesOutstandingYoYChangePct: asNullableNumber(obj.sharesOutstandingYoYChangePct),
    dilutionFlag: Boolean(obj.dilutionFlag),
    recentFinancingFlag: Boolean(obj.recentFinancingFlag),
    averageVolume: asNullableNumber(obj.averageVolume),
    volume: asNullableNumber(obj.volume),
    relativeVolume: asNullableNumber(obj.relativeVolume),
    shortFloatPct: asNullableNumber(obj.shortFloatPct),
    shortRatio: asNullableNumber(obj.shortRatio),
    institutionalOwnershipPct: asNullableNumber(obj.institutionalOwnershipPct),
    insiderOwnershipPct: asNullableNumber(obj.insiderOwnershipPct),
    revenueGrowthPct: asNullableNumber(obj.revenueGrowthPct),
    earningsGrowthPct: asNullableNumber(obj.earningsGrowthPct),
    revenueYoYGrowthPct: asNullableNumber(obj.revenueYoYGrowthPct),
    revenueQoQGrowthPct: asNullableNumber(obj.revenueQoQGrowthPct),
    revenueTrendFlag: obj.revenueTrendFlag === 'accelerating' || obj.revenueTrendFlag === 'decelerating' || obj.revenueTrendFlag === 'steady' ? obj.revenueTrendFlag : null,
    epsYoYGrowthPct: asNullableNumber(obj.epsYoYGrowthPct),
    epsQoQGrowthPct: asNullableNumber(obj.epsQoQGrowthPct),
    grossMarginPct: asNullableNumber(obj.grossMarginPct),
    operatingMarginPct: asNullableNumber(obj.operatingMarginPct),
    profitMarginPct: asNullableNumber(obj.profitMarginPct),
    returnOnEquityPct: asNullableNumber(obj.returnOnEquityPct),
    returnOnAssetsPct: asNullableNumber(obj.returnOnAssetsPct),
    salesSurprisePct: asNullableNumber(obj.salesSurprisePct),
    epsSurprisePct: asNullableNumber(obj.epsSurprisePct),
    totalCash: asNullableNumber(obj.totalCash),
    totalDebt: asNullableNumber(obj.totalDebt),
    operatingCashFlowTTM: asNullableNumber(obj.operatingCashFlowTTM),
    freeCashFlowTTM: asNullableNumber(obj.freeCashFlowTTM),
    quarterlyCashBurn: asNullableNumber(obj.quarterlyCashBurn),
    cashRunwayQuarters: asNullableNumber(obj.cashRunwayQuarters),
    debtToEquity: asNullableNumber(obj.debtToEquity),
    currentRatio: asNullableNumber(obj.currentRatio),
    quickRatio: asNullableNumber(obj.quickRatio),
    beta: asNullableNumber(obj.beta),
    atr14: asNullableNumber(obj.atr14),
    fiftyTwoWeekHigh: asNullableNumber(obj.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: asNullableNumber(obj.fiftyTwoWeekLow),
    earningsDate: asNullableString(obj.earningsDate),
    daysUntilEarnings: asNullableNumber(obj.daysUntilEarnings),
    lastEarningsDate: asNullableString(obj.lastEarningsDate),
    catalystFlag: obj.catalystFlag === 'earnings_soon' || obj.catalystFlag === 'just_reported' || obj.catalystFlag === 'no_near_catalyst' ? obj.catalystFlag : null,
    atmShelfFlag: asNullableBoolean(obj.atmShelfFlag),
    squeezePressureLabel: obj.squeezePressureLabel === 'High' || obj.squeezePressureLabel === 'Medium' || obj.squeezePressureLabel === 'Low' ? obj.squeezePressureLabel : 'N/A',
    survivabilityScore: asNullableNumber(obj.survivabilityScore),
    trendScore: asNullableNumber(obj.trendScore),
    reportedExecutionScore: asNullableNumber(obj.reportedExecutionScore),
    forwardExpectationsScore: asNullableNumber(obj.forwardExpectationsScore),
    positioningScore: asNullableNumber(obj.positioningScore),
    marketContextScore: asNullableNumber(obj.marketContextScore),
    squeezePressureScore: asNullableNumber(obj.squeezePressureScore),
    dilutionRiskScore: asNullableNumber(obj.dilutionRiskScore),
    catalystScore: asNullableNumber(obj.catalystScore),
    tacticalScore: asNullableNumber(obj.tacticalScore),
    quality: typeof obj.quality === 'string' ? obj.quality : 'N/A',
    holdContext: typeof obj.holdContext === 'string' ? obj.holdContext : 'N/A',
    tacticalGrade: typeof obj.tacticalGrade === 'string' ? obj.tacticalGrade : 'N/A',
    statusNote: typeof obj.statusNote === 'string' ? obj.statusNote : 'Loaded',
    riskNote: typeof obj.riskNote === 'string' ? obj.riskNote : 'Loaded',
    tags,
    reportedExecution: sanitizeReportedExecution(obj.reportedExecution),
    forwardExpectations: sanitizeForwardExpectations(obj.forwardExpectations),
    positioning: sanitizePositioning(obj.positioning),
    marketContext: sanitizeMarketContext(obj.marketContext),
    ownership: sanitizeOwnership(obj.ownership),
    stockdex: obj.stockdex && typeof obj.stockdex === 'object' ? (obj.stockdex as Record<string, unknown>) : null,
  };
}

export function isValidScannerRunResult(result: { symbol: string; candidates: StrategyCandidate[] }): boolean {
  return typeof result.symbol === 'string' && result.symbol.length > 0 && Array.isArray(result.candidates);
}

export function isValidScannerUniverseResult(result: { results: Array<{ symbol: string; candidates: StrategyCandidate[] }> }): boolean {
  return Array.isArray(result.results) && result.results.every((row) => isValidScannerRunResult(row));
}
