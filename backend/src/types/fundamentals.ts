export type FundamentalsTone = 'positive' | 'warning' | 'danger' | 'neutral' | 'muted';
export type LedgerCoverageTier =
  | 'full_filing_supported'
  | 'vendor_pit_only'
  | 'foreign_reporting'
  | 'insufficient_data';

export interface LedgerCoverageInfo {
  symbol: string;
  coverage_tier: LedgerCoverageTier;
  in_clean_stocks: boolean;
  in_ledger_filing_eligible: boolean;
  vendor_pit_available: boolean;
  filing_pit_available: boolean;
  document_count: number;
  statement_fact_count: number;
  eligibility_status: string | null;
  coverage_notes: string[];
}

export interface FundamentalsTag {
  label: string;
  tone: FundamentalsTone;
}

export interface FundamentalsEarningsHistoryRow {
  period: string | null;
  date: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  salesActual: number | null;
  salesEstimate: number | null;
  salesSurprisePct: number | null;
}

export interface FundamentalsInsiderTrade {
  insider: string | null;
  relationship: string | null;
  date: string | null;
  transaction: string | null;
  cost: string | null;
  shares: string | null;
  value: string | null;
}

export interface FundamentalsInstitutionalHolder {
  holder: string | null;
  shares: string | null;
  value: string | null;
  pctOut: string | null;
}

export interface FundamentalsReportedExecution {
  score: number | null;
  epsBeatStreak: number | null;
  epsMissStreak: number | null;
  avgEpsSurprisePct: number | null;
  avgSalesSurprisePct: number | null;
  latestEpsSurprisePct: number | null;
  latestPeriod: string | null;
  history: FundamentalsEarningsHistoryRow[];
}

export interface FundamentalsForwardExpectations {
  score: number | null;
  signal: 'supportive' | 'weak' | 'mixed' | null;
  currentQtrGrowthPct: number | null;
  nextQtrGrowthPct: number | null;
  currentYearGrowthPct: number | null;
  nextYearGrowthPct: number | null;
  quarterlyRevenueGrowthPct: number | null;
  quarterlyEarningsGrowthPct: number | null;
  raw?: Record<string, unknown> | null;
}

export interface FundamentalsPositioning {
  score: number | null;
  signal: 'buying' | 'selling' | 'mixed' | 'quiet' | null;
  recentBuyCount: number | null;
  recentSellCount: number | null;
  recentBuyValue: number | null;
  recentSellValue: number | null;
  recentTrades: FundamentalsInsiderTrade[];
}

export interface FundamentalsMarketContext {
  score: number | null;
  fiftyDayMovingAverage: number | null;
  twoHundredDayMovingAverage: number | null;
  fiftyTwoWeekChangePct: number | null;
  priceVs50DayPct: number | null;
  priceVs200DayPct: number | null;
  priceVs52WeekRangePct: number | null;
  above50Day: boolean | null;
  above200Day: boolean | null;
  avgVolume3Month: number | null;
}

export interface FundamentalsOwnership {
  institutionalOwnershipPct: number | null;
  insiderOwnershipPct: number | null;
  topInstitutionalHolders: FundamentalsInstitutionalHolder[];
}

export interface FundamentalsValuationSnapshot {
  valuationState: 'undervalued' | 'overvalued' | 'roughly_fair' | 'fair' | null;
  qualityGrade: string | null;
  qualityScore: number | null;
  coverageMode: string | null;
  price: number | null;
  fairValueLow: number | null;
  fairValueMid: number | null;
  fairValueHigh: number | null;
  valuationGapPct: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  enterpriseToSales: number | null;
  revenue: number | null;
  freeCashFlow: number | null;
  sharesOutstanding: number | null;
  revenueGrowthPct: number | null;
  operatingMarginPct: number | null;
  freeCashFlowMarginPct: number | null;
  currentRatio: number | null;
  asOfDate: string | null;
}

export interface FundamentalsHistoricalStatementRow {
  period: string | null;
  periodEnd: string | null;
  availableAt: string | null;
  availabilityBasis?: string | null;
  metrics: Record<string, number | null>;
}

export interface FundamentalsHistoricalStatements {
  quarterly: FundamentalsHistoricalStatementRow[];
}

export interface FundamentalsSpecialSituation {
  code: string | null;
  status: string | null;
  label: string | null;
  severity: 'high' | 'critical' | null;
  analysisModeOverride: string | null;
  summary: string | null;
  confidence: string | null;
  dealPricePerShare: number | null;
  contingentValueRightMaxPerShare: number | null;
  expectedClose: string | null;
  currentPrice: number | null;
  currentToDealSpreadPct: number | null;
}

export interface FundamentalsScores {
  survivabilityScore: number | null;
  trendScore: number | null;
  reportedExecutionScore: number | null;
  forwardExpectationsScore: number | null;
  positioningScore: number | null;
  marketContextScore: number | null;
  squeezePressureScore: number | null;
  dilutionRiskScore: number | null;
  catalystScore: number | null;
  tacticalScore: number | null;
}

export interface FundamentalsSnapshotV2 extends FundamentalsScores {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  exchange: string | null;
  currentPrice: number | null;
  targetPrice: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  enterpriseToSales: number | null;
  annualRevenue: number | null;
  netCash: number | null;
  cashPctMarketCap: number | null;
  lowEnterpriseValueFlag: boolean;
  floatShares: number | null;
  floatSharesYoYChangePct: number | null;
  sharesOutstanding: number | null;
  sharesOutstandingYoYChangePct: number | null;
  dilutionFlag: boolean;
  recentFinancingFlag: boolean;
  averageVolume: number | null;
  volume: number | null;
  relativeVolume: number | null;
  shortFloatPct: number | null;
  shortRatio: number | null;
  institutionalOwnershipPct: number | null;
  insiderOwnershipPct: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
  revenueYoYGrowthPct: number | null;
  revenueQoQGrowthPct: number | null;
  revenueTrendFlag: 'accelerating' | 'decelerating' | 'steady' | null;
  epsYoYGrowthPct: number | null;
  epsQoQGrowthPct: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  returnOnEquityPct: number | null;
  returnOnAssetsPct: number | null;
  salesSurprisePct: number | null;
  epsSurprisePct: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  operatingCashFlowTTM: number | null;
  freeCashFlowTTM: number | null;
  quarterlyCashBurn: number | null;
  cashRunwayQuarters: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  beta: number | null;
  atr14: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  earningsDate: string | null;
  daysUntilEarnings: number | null;
  lastEarningsDate: string | null;
  catalystFlag: 'earnings_soon' | 'just_reported' | 'no_near_catalyst' | null;
  atmShelfFlag: boolean | null;
  squeezePressureLabel: 'High' | 'Medium' | 'Low' | 'N/A';
  quality: string;
  holdContext: string;
  tacticalGrade: string;
  statusNote: string;
  riskNote: string;
  tags: FundamentalsTag[];
  specialSituation?: FundamentalsSpecialSituation | null;
  reportedExecution?: FundamentalsReportedExecution | null;
  forwardExpectations?: FundamentalsForwardExpectations | null;
  positioning?: FundamentalsPositioning | null;
  marketContext?: FundamentalsMarketContext | null;
  ownership?: FundamentalsOwnership | null;
  valuationSnapshot?: FundamentalsValuationSnapshot | null;
  historicalStatements?: FundamentalsHistoricalStatements | null;
  stockdex?: Record<string, unknown> | null;
}
