// backend/src/services/training/coachEngine.ts
//
// "Coach" analytics for the Training module.
//
// Consumes recorded TrainingAttempts and produces:
//   1. baseline       — true expectancy, win rate, payoff ratio, TP-conditional probs
//   2. diagnostics    — MAE/MFE-based "your stops are too tight" / "TP1 too far" reads
//   3. slices         — per-side, per-symbol, per-timeframe, per-contract performance,
//                       ranked by |Δ vs pooled baseline| × √N so high-confidence
//                       outliers float to the top
//   4. observations   — short, actionable, ranked findings derived from (1)+(2)+(3),
//                       suitable for direct display in the training UI
//
// Design priorities:
//   - "Real" expectancy from recorded rMultiples — never a re-derivation that assumes
//     +1R/+2R/+3R levels, since the user's actual TPs sit at varied R-multiples.
//   - Every observation must cite N and a delta so the user can sanity-check it.
//   - Slices below MIN_SLICE_N are ignored entirely; we never recommend action on
//     fewer than ~10 resolved attempts.
//   - Observations are ranked by `expectedRImpact × confidence`, so the user reads
//     the highest-leverage finding first.

import type { TrainingAttempt, ForwardResolution, TrainingBar, TrainingDrawing } from '../../types';

const MIN_SLICE_N = 10;
const MIN_BASELINE_N = 20;
const EQUITY_SIM_STARTING_EQUITY = 5000;
const EQUITY_SIM_RISK_PCT = 3;
const STOP_THRESHOLDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const TP_REACH_THRESHOLDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const ENTRY_FIB_BUCKETS = [
  { id: '50', label: '~50%', value: 50 },
  { id: '61.8', label: '~61.8%', value: 61.8 },
  { id: '70', label: '~70%', value: 70 },
  { id: '78.6', label: '~78.6%', value: 78.6 },
  { id: '88.6', label: '~88.6%', value: 88.6 },
  { id: '100', label: '~100%', value: 100 },
  { id: '100+', label: '100%+', value: 110 },
];

const ADVERSE_BUCKETS = [
  { id: '0-10', label: '0-10%', min: 0, max: 10 },
  { id: '10-20', label: '10-20%', min: 10, max: 20 },
  { id: '20-30', label: '20-30%', min: 20, max: 30 },
  { id: '30-40', label: '30-40%', min: 30, max: 40 },
  { id: '40-50', label: '40-50%', min: 40, max: 50 },
  { id: '50-60', label: '50-60%', min: 50, max: 60 },
  { id: '60-75', label: '60-75%', min: 60, max: 75 },
  { id: '75-88', label: '75-88%', min: 75, max: 88 },
  { id: '88-100', label: '88-100%', min: 88, max: 100 },
  { id: '100+', label: '100%+', min: 100, max: Infinity },
];

export interface CoachBaselineStats {
  attemptsConsidered: number;
  filledCount: number;
  noFillCount: number;
  resolvedCount: number;
  expectancyPerFilled: number;
  totalR: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  payoffRatio: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  stopHitRate: number;
  conditional: {
    tp2GivenTp1: number | null;
    tp3GivenTp2: number | null;
  };
}

export interface CoachDiagnostics {
  avgMaeOnLosers: number;
  avgMfeOnLosers: number;
  avgMaeOnWinners: number;
  maxMaeOnWinners: number;
  losersN: number;
  winnersN: number;
  fibDrawdownN?: number;
  fibAvgMaxAdversePct?: number;
  fibMedianMaxAdversePct?: number;
  fibP75MaxAdversePct?: number;
  fibPctAtOrBeyond88?: number;
  fibPctBeyond100?: number;
  fibWinnersAvgMaxAdversePct?: number;
  fibLosersAvgMaxAdversePct?: number;
  fibAvgMaxFavorablePct?: number;
  fibMedianMaxFavorablePct?: number;
  fibPctReached75?: number;
  fibPctReached100?: number;
  fibWinnersAvgMaxFavorablePct?: number;
  fibLosersAvgMaxFavorablePct?: number;
}

export interface CoachSlice {
  id: string;
  dimension: 'side' | 'symbol' | 'timeframe' | 'contract';
  label: string;
  attempts: number;
  filled: number;
  expectancy: number;
  delta: number;
  significance: number;
  winRate: number;
  tp1Rate: number;
  tp3Rate: number;
}

export type CoachObservationSeverity = 'info' | 'warning' | 'critical' | 'opportunity';

export interface CoachObservation {
  id: string;
  severity: CoachObservationSeverity;
  headline: string;
  detail: string;
  recommendation: string;
  evidence: string;
  expectedRImpact?: number;
  rank: number;
}

export interface CoachStopThresholdSummary {
  thresholdPct: number;
  totalTrades: number;
  touchedCount: number;
  touchedPct: number;
  touchedFailedCount: number;
  touchedFailedPct: number;
  touchedRecoveredWinnerCount: number;
  touchedRecoveredWinnerPct: number;
  eventualWinners: number;
  winnersStoppedCount: number;
  winnersStoppedPct: number;
  simulatedWinRate: number;
  simulatedExpectancy: number;
  simulatedAvgWin: number;
  simulatedAvgLoss: number;
  simulatedTotalR: number;
  insufficientData: boolean;
}

export interface CoachStopBucketSummary {
  bucket: string;
  label: string;
  trades: number;
  winners: number;
  losers: number;
  winRate: number;
  avgFinalR: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  insufficientData: boolean;
}

export interface CoachActualStopPlacementSummary {
  bucket: string;
  label: string;
  trades: number;
  winners: number;
  losers: number;
  winRate: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  totalR: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  insufficientData: boolean;
}

export interface CoachEntryStopMatrixRow {
  entryBucket: string;
  entryLabel: string;
  entrySort: number;
  entryBucketTrades: number;
  stopBucketPct: number;
  stopLabel: string;
  trades: number;
  bucketSharePct: number;
  winners: number;
  losers: number;
  stopHits: number;
  stopHitRate: number;
  winRate: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  tp1HitRate: number;
  tp2HitRate: number;
  tp3HitRate: number;
  avgAdversePct: number;
  avgFavorablePct: number;
  insufficientData: boolean;
}

export interface CoachStopStudy {
  thresholds: number[];
  totalResolvedFilled: number;
  eligibleTrades: number;
  skippedTrades: number;
  actualStopPlacement: CoachActualStopPlacementSummary[];
  entryStopMatrix: CoachEntryStopMatrixRow[];
  thresholdSummary: CoachStopThresholdSummary[];
  bucketDistribution: CoachStopBucketSummary[];
  practicalRead: string[];
  note: string;
}

export interface CoachTpReachRate {
  threshold: number;
  tradesReached: number;
  reachRate: number;
}

export interface CoachTpReachStudy {
  thresholds: number[];
  totalResolvedFilled: number;
  eligibleTrades: number;
  skippedTrades: number;
  reachRates: CoachTpReachRate[];
  medianReachPct: number;
  p75ReachPct: number;
  p90ReachPct: number;
  avgReachPct: number;
  note: string;
}

export interface CoachEquityCurvePoint {
  tradeIndex: number;
  attemptId: string;
  symbol: string;
  side: string;
  timeframe: string;
  resolvedAt?: string;
  startingEquity: number;
  riskPct: number;
  riskDollars: number;
  entryPrice: number | null;
  stopPrice: number | null;
  perShareRisk: number | null;
  rawShares: number | null;
  roundedShares: number | null;
  actualRiskDollars: number | null;
  tradeR: number;
  tradePnL: number;
  endingEquity: number;
  drawdownPct: number;
}

export interface CoachEquityCurveSimulation {
  startingEquity: number;
  riskPct: number;
  resolvedFilledOnly: boolean;
  tradeCount: number;
  skippedTrades: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  longestDrawdownStreak: number;
  wins: number;
  losses: number;
  avgWinDollars: number;
  avgLossDollars: number;
  curve: CoachEquityCurvePoint[];
  note: string;
}

export interface CoachReport {
  generatedAt: string;
  scope: {
    contractId?: string;
    totalAttempts: number;
    resolvedFilled: number;
    enoughData: boolean;
  };
  baseline: CoachBaselineStats;
  diagnostics: CoachDiagnostics;
  stopStudy: CoachStopStudy;
  tpReachStudy: CoachTpReachStudy;
  equityCurveSimulation: CoachEquityCurveSimulation;
  slices: CoachSlice[];
  observations: CoachObservation[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — keep them small and pure. The observation library reads from the
// computed baseline/diagnostics/slices, so cleanliness here pays off later.
// ────────────────────────────────────────────────────────────────────────────

function rOf(attempt: TrainingAttempt): number {
  const res = attempt.resolution;
  if (!res) return NaN;
  // blendedRMultiple is the size-weighted result across tranches — always
  // prefer it; fall back to the legacy rMultiple field on older attempts.
  const blended = typeof res.blendedRMultiple === 'number' ? res.blendedRMultiple : res.rMultiple;
  return Number.isFinite(blended) ? blended : NaN;
}

function isFilled(attempt: TrainingAttempt): boolean {
  return !!attempt.resolution?.entryHit;
}

function isResolved(attempt: TrainingAttempt): boolean {
  return attempt.status === 'resolved' && !!attempt.resolution;
}

function tpHit(attempt: TrainingAttempt, level: 1 | 2 | 3): boolean {
  const res = attempt.resolution;
  if (!res || !res.entryHit) return false;
  if (level === 1) {
    // tp1 hit if any tranche labelled tp1 OR the legacy exitReason is tp_hit
    if (Array.isArray(res.tranches) && res.tranches.length > 0) {
      return res.tranches.some((t) => t.exitReason === 'tp1');
    }
    return res.exitReason === 'tp_hit';
  }
  if (level === 2) return Array.isArray(res.tranches) && res.tranches.some((t) => t.exitReason === 'tp2');
  return Array.isArray(res.tranches) && res.tranches.some((t) => t.exitReason === 'tp3');
}

function safeMean(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return 0;
  return finite.reduce((s, v) => s + v, 0) / finite.length;
}

function round(v: number, dp = 2): number {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

function pct(v: number): number {
  return round(v * 100, 1);
}

function percentile(values: number[], q: number): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fibPctForPrice(price: number, p0: number, p100: number): number | null {
  const span = p100 - p0;
  if (!Number.isFinite(price) || !Number.isFinite(p0) || !Number.isFinite(p100) || Math.abs(span) < 1e-9) {
    return null;
  }
  return ((price - p0) / span) * 100;
}

function findFibDrawing(attempt: TrainingAttempt): TrainingDrawing | null {
  return (attempt.drawings || []).find((d) => d.type === 'fib' && Number.isFinite(d.price) && Number.isFinite(d.price2)) || null;
}

function computeEntryFibPct(attempt: TrainingAttempt): number | null {
  const stored = attempt.resolution?.fibAdverseExcursion?.entryFibPct;
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;

  const fib = findFibDrawing(attempt);
  if (!fib) return null;

  const p0 = Number(fib.price);
  const p100 = Number(fib.price2);
  const price0 = attempt.side === 'long' ? Math.max(p0, p100) : Math.min(p0, p100);
  const price100 = attempt.side === 'long' ? Math.min(p0, p100) : Math.max(p0, p100);
  return fibPctForPrice(Number(attempt.entry), price0, price100);
}

function barAt(bars: TrainingBar[] | undefined, index: number | undefined): TrainingBar | null {
  if (!Array.isArray(bars) || typeof index !== 'number') return null;
  if (index < 0 || index >= bars.length) return null;
  return bars[index];
}

function computeFibAdversePct(attempt: TrainingAttempt): number | null {
  const stored = attempt.resolution?.fibAdverseExcursion?.maxAdverseFibPct;
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;

  const res = attempt.resolution;
  const fib = findFibDrawing(attempt);
  if (!res || !res.entryHit || !fib || !Array.isArray(attempt.bars)) return null;

  const p0 = Number(fib.price);
  const p100 = Number(fib.price2);
  const price0 = attempt.side === 'long' ? Math.max(p0, p100) : Math.min(p0, p100);
  const price100 = attempt.side === 'long' ? Math.min(p0, p100) : Math.max(p0, p100);
  const entryFib = fibPctForPrice(attempt.entry, price0, price100);
  if (entryFib == null) return null;

  const start = typeof res.entryBarIndex === 'number' ? res.entryBarIndex : attempt.entryBarIndex;
  const end = typeof res.exitBarIndex === 'number' ? res.exitBarIndex : start;
  const bars = attempt.bars;
  let adversePrice = attempt.entry;

  for (let i = Math.max(0, start); i <= Math.min(end, bars.length - 1); i += 1) {
    const b = barAt(bars, i);
    if (!b) continue;
    const candidate = attempt.side === 'short' ? b.high : b.low;
    if (!Number.isFinite(candidate)) continue;
    if (attempt.side === 'long' ? candidate < adversePrice : candidate > adversePrice) {
      adversePrice = candidate;
    }
  }

  return fibPctForPrice(adversePrice, price0, price100);
}

function managePctForPrice(side: string, price: number, entry: number, target: number): number | null {
  const targetDistance = Math.abs(target - entry);
  if (!Number.isFinite(price) || !Number.isFinite(entry) || !Number.isFinite(target) || targetDistance <= 0) return null;
  const signedMove = side === 'short' ? entry - price : price - entry;
  return (signedMove / targetDistance) * 100;
}

function computeFibTradeExcursionPct(attempt: TrainingAttempt): { adversePct: number; favorablePct: number; targetDistance?: number } | null {
  const stored = attempt.resolution?.fibTradeExcursion;
  if (
    stored &&
    typeof stored.maxAdversePct === 'number' &&
    typeof stored.maxFavorablePct === 'number' &&
    Number.isFinite(stored.maxAdversePct) &&
    Number.isFinite(stored.maxFavorablePct)
  ) {
    return {
      adversePct: Math.abs(stored.maxAdversePct),
      favorablePct: Math.max(0, stored.maxFavorablePct),
      targetDistance: Number.isFinite(Number(stored.targetDistance)) ? Math.abs(Number(stored.targetDistance)) : undefined,
    };
  }

  const res = attempt.resolution;
  const fib = findFibDrawing(attempt);
  if (!res || !res.entryHit || !fib || !Array.isArray(attempt.bars)) return null;

  const raw0 = Number(fib.price);
  const raw100 = Number(fib.price2);
  const entry = Number(attempt.entry);
  if (!Number.isFinite(raw0) || !Number.isFinite(raw100) || raw0 === raw100 || !Number.isFinite(entry)) return null;

  const side = attempt.side === 'short' ? 'short' : 'long';
  const target = Number.isFinite(Number(fib.targetPrice))
    ? Number(fib.targetPrice)
    : (side === 'long' ? Math.max(raw0, raw100) : Math.min(raw0, raw100));
  if (Math.abs(target - entry) <= 0) return null;

  const start = typeof res.entryBarIndex === 'number' ? res.entryBarIndex : attempt.entryBarIndex;
  const end = typeof res.exitBarIndex === 'number' ? res.exitBarIndex : start;
  const bars = attempt.bars;
  let adversePrice = entry;
  let favorablePrice = entry;

  for (let i = Math.max(0, start); i <= Math.min(end, bars.length - 1); i += 1) {
    const b = barAt(bars, i);
    if (!b) continue;
    const adverseCandidate = side === 'short' ? b.high : b.low;
    if (Number.isFinite(adverseCandidate) && (side === 'long' ? adverseCandidate < adversePrice : adverseCandidate > adversePrice)) {
      adversePrice = adverseCandidate;
    }
    const favorableCandidate = side === 'short' ? b.low : b.high;
    if (Number.isFinite(favorableCandidate) && (side === 'long' ? favorableCandidate > favorablePrice : favorableCandidate < favorablePrice)) {
      favorablePrice = favorableCandidate;
    }
  }

  const adversePct = managePctForPrice(side, adversePrice, entry, target);
  const favorablePct = managePctForPrice(side, favorablePrice, entry, target);
  if (adversePct == null || favorablePct == null) return null;
  return {
    adversePct: Math.abs(Math.min(0, adversePct)),
    favorablePct: Math.max(0, favorablePct),
    targetDistance: Math.abs(target - entry),
  };
}

interface StopStudyTrade {
  attemptId: string;
  maxAdversePct: number;
  maxFavorablePct: number;
  finalR: number;
  finalWinner: boolean;
  stopHit: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  targetDistance: number;
  riskDistance: number;
  actualStopPct: number;
  entryFibPct: number;
  entryBucket: string;
  entryLabel: string;
  entrySort: number;
  stopBucketPct: number;
  stopLabel: string;
}

function entryBucketForFibPct(value: number): typeof ENTRY_FIB_BUCKETS[number] | null {
  if (!Number.isFinite(value)) return null;
  if (value >= 104) return ENTRY_FIB_BUCKETS[ENTRY_FIB_BUCKETS.length - 1];
  return ENTRY_FIB_BUCKETS
    .slice(0, ENTRY_FIB_BUCKETS.length - 1)
    .reduce((best, bucket) => (Math.abs(bucket.value - value) < Math.abs(best.value - value) ? bucket : best));
}

function stopBucketForDepthPct(value: number): { pct: number; label: string } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const bucket = STOP_THRESHOLDS.find((threshold) => value <= threshold);
  if (bucket) return { pct: bucket, label: `${bucket}%` };
  return { pct: 101, label: '100%+' };
}

function stopDepthPctForAttempt(attempt: TrainingAttempt, riskDistance: number, fallbackDistance: number): number {
  const entry = Number(attempt.entry);
  const structureStopPrice = Number(attempt.resolution?.fibTradeExcursion?.structureStopPrice);
  const structureRiskDistance = Math.abs(entry - structureStopPrice);
  if (Number.isFinite(structureRiskDistance) && structureRiskDistance > 0) {
    return (riskDistance / structureRiskDistance) * 100;
  }
  return (riskDistance / fallbackDistance) * 100;
}

function stopStudyTrade(attempt: TrainingAttempt): StopStudyTrade | null {
  if (!isResolved(attempt) || !isFilled(attempt)) return null;
  const finalR = rOf(attempt);
  const excursion = computeFibTradeExcursionPct(attempt);
  const riskDistance = Math.abs(Number(attempt.entry) - Number(attempt.stop));
  const entryFibPct = computeEntryFibPct(attempt);
  if (!excursion || !Number.isFinite(finalR) || !(riskDistance > 0) || !(Number(excursion.targetDistance) > 0)) {
    return null;
  }
  const stopDepthPct = stopDepthPctForAttempt(attempt, riskDistance, Math.abs(Number(excursion.targetDistance)));
  const entryBucket = entryFibPct == null ? null : entryBucketForFibPct(entryFibPct);
  const stopBucket = stopBucketForDepthPct(stopDepthPct);
  return {
    attemptId: attempt.attemptId,
    maxAdversePct: Math.max(0, Number(excursion.adversePct) || 0),
    maxFavorablePct: Math.max(0, Number(excursion.favorablePct) || 0),
    finalR,
    finalWinner: finalR > 0,
    stopHit: attempt.resolution?.exitReason === 'sl_hit',
    tp1Hit: tpHit(attempt, 1),
    tp2Hit: tpHit(attempt, 2),
    tp3Hit: tpHit(attempt, 3),
    targetDistance: Math.abs(Number(excursion.targetDistance)),
    riskDistance,
    actualStopPct: (riskDistance / Math.abs(Number(excursion.targetDistance))) * 100,
    entryFibPct: Number(entryFibPct),
    entryBucket: entryBucket?.id || 'unknown',
    entryLabel: entryBucket?.label || 'Unknown',
    entrySort: entryBucket?.value || 999,
    stopBucketPct: stopBucket?.pct || 0,
    stopLabel: stopBucket?.label || 'Unknown',
  };
}

function simulatedRForThreshold(trade: StopStudyTrade, thresholdPct: number): number {
  if (trade.maxAdversePct < thresholdPct) return trade.finalR;
  const adverseDistance = trade.targetDistance * (thresholdPct / 100);
  return -(adverseDistance / trade.riskDistance);
}

function bucketForAdversePct(value: number): typeof ADVERSE_BUCKETS[number] {
  return ADVERSE_BUCKETS.find((bucket) => value >= bucket.min && value < bucket.max) || ADVERSE_BUCKETS[ADVERSE_BUCKETS.length - 1];
}

function bucketForActualStopPct(value: number): typeof ADVERSE_BUCKETS[number] {
  return ADVERSE_BUCKETS.find((bucket) => value > bucket.min && value <= bucket.max) || ADVERSE_BUCKETS[0];
}

function buildEntryStopMatrix(rows: StopStudyTrade[]): CoachEntryStopMatrixRow[] {
  const groups = new Map<string, StopStudyTrade[]>();
  const eligible = rows.filter((row) => row.entryBucket !== 'unknown' && row.stopBucketPct > 0);
  const entryTotals = new Map<string, number>();
  eligible.forEach((row) => {
    entryTotals.set(row.entryBucket, (entryTotals.get(row.entryBucket) || 0) + 1);
  });

  eligible
    .forEach((row) => {
      const key = `${row.entryBucket}|${row.stopBucketPct}`;
      groups.set(key, [...(groups.get(key) || []), row]);
    });

  return Array.from(groups.values())
    .map((group) => {
      const rValues = group.map((row) => row.finalR).filter((r) => Number.isFinite(r));
      const wins = rValues.filter((r) => r > 0);
      const losses = rValues.filter((r) => r <= 0);
      const totalR = rValues.reduce((sum, r) => sum + r, 0);
      const stopHits = group.filter((row) => row.stopHit).length;
      const first = group[0];
      const entryBucketTrades = entryTotals.get(first.entryBucket) || group.length;

      return {
        entryBucket: first.entryBucket,
        entryLabel: first.entryLabel,
        entrySort: first.entrySort,
        entryBucketTrades,
        stopBucketPct: first.stopBucketPct,
        stopLabel: first.stopLabel,
        trades: group.length,
        bucketSharePct: pct(entryBucketTrades ? group.length / entryBucketTrades : 0),
        winners: wins.length,
        losers: losses.length,
        stopHits,
        stopHitRate: pct(group.length ? stopHits / group.length : 0),
        winRate: pct(group.length ? wins.length / group.length : 0),
        expectancy: round(group.length ? totalR / group.length : 0, 3),
        avgWin: round(safeMean(wins), 2),
        avgLoss: round(safeMean(losses), 2),
        tp1HitRate: pct(group.length ? group.filter((row) => row.tp1Hit).length / group.length : 0),
        tp2HitRate: pct(group.length ? group.filter((row) => row.tp2Hit).length / group.length : 0),
        tp3HitRate: pct(group.length ? group.filter((row) => row.tp3Hit).length / group.length : 0),
        avgAdversePct: round(safeMean(group.map((row) => row.maxAdversePct)), 1),
        avgFavorablePct: round(safeMean(group.map((row) => row.maxFavorablePct)), 1),
        insufficientData: group.length > 0 && group.length < 5,
      };
    })
    .sort((a, b) => {
      if (a.entrySort !== b.entrySort) return a.entrySort - b.entrySort;
      return a.stopBucketPct - b.stopBucketPct;
    });
}

export function computeStopStudy(attempts: TrainingAttempt[]): CoachStopStudy {
  const resolvedFilled = attempts.filter(isResolved).filter(isFilled);
  const rows = resolvedFilled
    .map(stopStudyTrade)
    .filter((row): row is StopStudyTrade => !!row);
  const eventualWinners = rows.filter((row) => row.finalWinner).length;

  const thresholdSummary = STOP_THRESHOLDS.map((thresholdPct) => {
    const touched = rows.filter((row) => row.maxAdversePct >= thresholdPct);
    const touchedFailed = touched.filter((row) => !row.finalWinner).length;
    const touchedRecoveredWinners = touched.filter((row) => row.finalWinner).length;
    const simulated = rows.map((row) => simulatedRForThreshold(row, thresholdPct));
    const simulatedWins = simulated.filter((r) => r > 0);
    const simulatedLosses = simulated.filter((r) => r <= 0);
    const simulatedTotalR = simulated.reduce((sum, r) => sum + r, 0);

    return {
      thresholdPct,
      totalTrades: rows.length,
      touchedCount: touched.length,
      touchedPct: pct(rows.length ? touched.length / rows.length : 0),
      touchedFailedCount: touchedFailed,
      touchedFailedPct: pct(touched.length ? touchedFailed / touched.length : 0),
      touchedRecoveredWinnerCount: touchedRecoveredWinners,
      touchedRecoveredWinnerPct: pct(touched.length ? touchedRecoveredWinners / touched.length : 0),
      eventualWinners,
      winnersStoppedCount: touchedRecoveredWinners,
      winnersStoppedPct: pct(eventualWinners ? touchedRecoveredWinners / eventualWinners : 0),
      simulatedWinRate: pct(rows.length ? simulatedWins.length / rows.length : 0),
      simulatedExpectancy: round(rows.length ? simulatedTotalR / rows.length : 0, 3),
      simulatedAvgWin: round(safeMean(simulatedWins), 2),
      simulatedAvgLoss: round(safeMean(simulatedLosses), 2),
      simulatedTotalR: round(simulatedTotalR, 2),
      insufficientData: rows.length < MIN_BASELINE_N || touched.length < 5,
    };
  });

  const bucketDistribution = ADVERSE_BUCKETS.map((bucket) => {
    const group = rows.filter((row) => bucketForAdversePct(row.maxAdversePct).id === bucket.id);
    const winners = group.filter((row) => row.finalWinner);
    const losers = group.filter((row) => !row.finalWinner);
    return {
      bucket: bucket.id,
      label: bucket.label,
      trades: group.length,
      winners: winners.length,
      losers: losers.length,
      winRate: pct(group.length ? winners.length / group.length : 0),
      avgFinalR: round(safeMean(group.map((row) => row.finalR)), 3),
      tp1HitRate: pct(group.length ? group.filter((row) => row.tp1Hit).length / group.length : 0),
      tp2HitRate: pct(group.length ? group.filter((row) => row.tp2Hit).length / group.length : 0),
      tp3HitRate: pct(group.length ? group.filter((row) => row.tp3Hit).length / group.length : 0),
      insufficientData: group.length > 0 && group.length < 5,
    };
  });

  const actualStopPlacement = ADVERSE_BUCKETS.map((bucket) => {
    const group = rows.filter((row) => bucketForActualStopPct(row.actualStopPct).id === bucket.id);
    const rValues = group.map((row) => row.finalR).filter((r) => Number.isFinite(r));
    const wins = rValues.filter((r) => r > 0);
    const losses = rValues.filter((r) => r <= 0);
    const totalR = rValues.reduce((sum, r) => sum + r, 0);

    return {
      bucket: bucket.id,
      label: bucket.label,
      trades: group.length,
      winners: wins.length,
      losers: losses.length,
      winRate: pct(group.length ? wins.length / group.length : 0),
      expectancy: round(group.length ? totalR / group.length : 0, 3),
      avgWin: round(safeMean(wins), 2),
      avgLoss: round(safeMean(losses), 2),
      totalR: round(totalR, 2),
      tp1HitRate: pct(group.length ? group.filter((row) => row.tp1Hit).length / group.length : 0),
      tp2HitRate: pct(group.length ? group.filter((row) => row.tp2Hit).length / group.length : 0),
      tp3HitRate: pct(group.length ? group.filter((row) => row.tp3Hit).length / group.length : 0),
      insufficientData: group.length > 0 && group.length < 5,
    };
  });

  return {
    thresholds: STOP_THRESHOLDS.slice(),
    totalResolvedFilled: resolvedFilled.length,
    eligibleTrades: rows.length,
    skippedTrades: resolvedFilled.length - rows.length,
    actualStopPlacement,
    entryStopMatrix: buildEntryStopMatrix(rows),
    thresholdSummary,
    bucketDistribution,
    practicalRead: buildStopStudyRead(thresholdSummary, bucketDistribution, actualStopPlacement, rows.length),
    note: 'Supplemental study only. It does not alter official baseline metrics or create a live stop rule.',
  };
}

export function computeTpReachStudy(attempts: TrainingAttempt[]): CoachTpReachStudy {
  const resolvedFilled = attempts.filter(isResolved).filter(isFilled);
  const values = resolvedFilled
    .map((attempt) => computeFibTradeExcursionPct(attempt)?.favorablePct)
    .filter((value): value is number => Number.isFinite(value));

  const reachRates = TP_REACH_THRESHOLDS.map((threshold) => {
    const tradesReached = values.filter((value) => value >= threshold).length;
    return {
      threshold,
      tradesReached,
      reachRate: pct(values.length ? tradesReached / values.length : 0),
    };
  });

  return {
    thresholds: TP_REACH_THRESHOLDS.slice(),
    totalResolvedFilled: resolvedFilled.length,
    eligibleTrades: values.length,
    skippedTrades: resolvedFilled.length - values.length,
    reachRates,
    medianReachPct: round(percentile(values, 0.5), 1),
    p75ReachPct: round(percentile(values, 0.75), 1),
    p90ReachPct: round(percentile(values, 0.9), 1),
    avgReachPct: round(safeMean(values), 1),
    note: 'Cumulative reach distribution. A trade that reaches 80% also counts as reaching 10% through 80%.',
  };
}

function attemptSortTime(attempt: TrainingAttempt): number {
  const raw = attempt.resolvedAt || attempt.createdAt || attempt.entryBarTime || '';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

export function computeEquityCurveSimulation(
  attempts: TrainingAttempt[],
  startingEquity = EQUITY_SIM_STARTING_EQUITY,
  riskPct = EQUITY_SIM_RISK_PCT,
): CoachEquityCurveSimulation {
  const resolvedFilled = attempts
    .filter(isResolved)
    .filter(isFilled)
    .slice()
    .sort((a, b) => {
      const ta = attemptSortTime(a);
      const tb = attemptSortTime(b);
      if (ta !== tb) return ta - tb;
      return String(a.attemptId || '').localeCompare(String(b.attemptId || ''));
    });

  let equity = startingEquity;
  let peakEquity = startingEquity;
  let longestDrawdownStreak = 0;
  let currentDrawdownStreak = 0;
  let maxDrawdownPct = 0;
  let skippedTrades = 0;
  const curve: CoachEquityCurvePoint[] = [];

  resolvedFilled.forEach((attempt) => {
    const tradeR = rOf(attempt);
    if (!Number.isFinite(tradeR)) {
      skippedTrades += 1;
      return;
    }

    const starting = equity;
    const riskDollars = starting * (riskPct / 100);
    const tradePnL = riskDollars * tradeR;
    const ending = starting + tradePnL;
    const entry = Number(attempt.entry);
    const stop = Number(attempt.stop);
    const perShareRisk = Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) : NaN;
    const rawShares = perShareRisk > 0 ? riskDollars / perShareRisk : NaN;
    const roundedShares = Number.isFinite(rawShares) ? Math.floor(rawShares) : NaN;
    const actualRiskDollars = Number.isFinite(roundedShares) && perShareRisk > 0 ? roundedShares * perShareRisk : NaN;

    equity = ending;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
    if (equity < peakEquity) {
      currentDrawdownStreak += 1;
      longestDrawdownStreak = Math.max(longestDrawdownStreak, currentDrawdownStreak);
    } else {
      currentDrawdownStreak = 0;
    }

    curve.push({
      tradeIndex: curve.length + 1,
      attemptId: attempt.attemptId,
      symbol: attempt.symbol,
      side: attempt.side,
      timeframe: attempt.timeframe,
      resolvedAt: attempt.resolvedAt || attempt.createdAt,
      startingEquity: round(starting, 2),
      riskPct,
      riskDollars: round(riskDollars, 2),
      entryPrice: Number.isFinite(entry) ? round(entry, 4) : null,
      stopPrice: Number.isFinite(stop) ? round(stop, 4) : null,
      perShareRisk: Number.isFinite(perShareRisk) && perShareRisk > 0 ? round(perShareRisk, 4) : null,
      rawShares: Number.isFinite(rawShares) ? round(rawShares, 2) : null,
      roundedShares: Number.isFinite(roundedShares) ? roundedShares : null,
      actualRiskDollars: Number.isFinite(actualRiskDollars) ? round(actualRiskDollars, 2) : null,
      tradeR: round(tradeR, 3),
      tradePnL: round(tradePnL, 2),
      endingEquity: round(ending, 2),
      drawdownPct: round(drawdownPct, 2),
    });
  });

  const pnlValues = curve.map((row) => row.tradePnL).filter((v) => Number.isFinite(v));
  const wins = pnlValues.filter((v) => v > 0);
  const losses = pnlValues.filter((v) => v <= 0);

  return {
    startingEquity,
    riskPct,
    resolvedFilledOnly: true,
    tradeCount: curve.length,
    skippedTrades,
    finalEquity: round(equity, 2),
    totalReturnPct: round(startingEquity > 0 ? ((equity - startingEquity) / startingEquity) * 100 : 0, 2),
    maxDrawdownPct: round(Math.abs(maxDrawdownPct), 2),
    longestDrawdownStreak,
    wins: wins.length,
    losses: losses.length,
    avgWinDollars: round(safeMean(wins), 2),
    avgLossDollars: round(safeMean(losses), 2),
    curve,
    note: 'Hypothetical compounding simulation using actual resolved filled training attempts in recorded order. Not a live-performance guarantee.',
  };
}

function buildStopStudyRead(
  summaries: CoachStopThresholdSummary[],
  buckets: CoachStopBucketSummary[],
  actualStops: CoachActualStopPlacementSummary[],
  eligibleTrades: number,
): string[] {
  if (!eligibleTrades) {
    return ['No resolved filled attempts had enough fib/entry excursion data for a stop-threshold study yet.'];
  }

  const lines: string[] = [];
  const bestActual = actualStops
    .filter((row) => row.trades >= 5)
    .slice()
    .sort((a, b) => {
      if (b.expectancy !== a.expectancy) return b.expectancy - a.expectancy;
      return b.winRate - a.winRate;
    })[0];
  if (bestActual) {
    lines.push(`Actual stop placement: your best observed bucket is ${bestActual.label} with ${bestActual.winners}/${bestActual.trades} winners, ${bestActual.winRate}% win rate, and ${bestActual.expectancy}R expectancy.`);
  }

  const at30 = summaries.find((row) => row.thresholdPct === 30);
  if (at30) {
    lines.push(`At a 30% stop, ${at30.winnersStoppedCount} eventual winner${at30.winnersStoppedCount === 1 ? '' : 's'} would have been cut off (N=${at30.totalTrades}).`);
  }

  const at80 = summaries.find((row) => row.thresholdPct === 80);
  if (at80) {
    lines.push(`At an 80% stop, ${at80.touchedFailedPct}% of trades that reached that depth still failed, while ${at80.touchedRecoveredWinnerPct}% recovered into winners (touched N=${at80.touchedCount}).`);
  }

  const viable = summaries.filter((row) => row.totalTrades >= MIN_SLICE_N);
  const best = viable.length
    ? viable.slice().sort((a, b) => {
        if (b.simulatedExpectancy !== a.simulatedExpectancy) return b.simulatedExpectancy - a.simulatedExpectancy;
        return a.winnersStoppedPct - b.winnersStoppedPct;
      })[0]
    : null;
  if (best) {
    lines.push(`The best observed tradeoff appears to be ${best.thresholdPct}%: simulated expectancy ${best.simulatedExpectancy}R, simulated win rate ${best.simulatedWinRate}%, and ${best.winnersStoppedPct}% of eventual winners cut off.`);
  }

  const sparseBuckets = buckets.filter((bucket) => bucket.trades > 0 && bucket.trades < 5).map((bucket) => bucket.label);
  if (eligibleTrades < MIN_BASELINE_N || sparseBuckets.length) {
    lines.push(`Confidence is limited: eligible N=${eligibleTrades}${sparseBuckets.length ? `, sparse buckets: ${sparseBuckets.join(', ')}` : ''}.`);
  }

  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Baseline — real expectancy / win rate / payoff / TP-conditional probs
// ────────────────────────────────────────────────────────────────────────────

export function computeBaseline(attempts: TrainingAttempt[]): CoachBaselineStats {
  const resolved = attempts.filter(isResolved);
  const filled = resolved.filter(isFilled);
  const filledCount = filled.length;
  const rValues = filled.map(rOf).filter((v) => Number.isFinite(v));

  const wins = rValues.filter((r) => r > 0);
  const losses = rValues.filter((r) => r <= 0);
  const totalR = rValues.reduce((s, v) => s + v, 0);

  const tp1 = filled.filter((a) => tpHit(a, 1)).length;
  const tp2 = filled.filter((a) => tpHit(a, 2)).length;
  const tp3 = filled.filter((a) => tpHit(a, 3)).length;
  const stops = filled.filter((a) => a.resolution?.exitReason === 'sl_hit').length;

  return {
    attemptsConsidered: attempts.length,
    filledCount,
    noFillCount: resolved.length - filledCount,
    resolvedCount: resolved.length,
    expectancyPerFilled: round(filledCount ? totalR / filledCount : 0, 3),
    totalR: round(totalR, 2),
    winRate: pct(filledCount ? wins.length / filledCount : 0),
    avgWinR: round(safeMean(wins), 2),
    avgLossR: round(safeMean(losses), 2),
    payoffRatio: round(losses.length && safeMean(losses) !== 0 ? Math.abs(safeMean(wins) / safeMean(losses)) : 0, 2),
    tp1HitRate: pct(filledCount ? tp1 / filledCount : 0),
    tp2HitRate: pct(filledCount ? tp2 / filledCount : 0),
    tp3HitRate: pct(filledCount ? tp3 / filledCount : 0),
    stopHitRate: pct(filledCount ? stops / filledCount : 0),
    conditional: {
      tp2GivenTp1: tp1 ? round(tp2 / tp1, 3) : null,
      tp3GivenTp2: tp2 ? round(tp3 / tp2, 3) : null,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Diagnostics — MAE/MFE-derived "stop too tight" / "TP1 too far" reads
//
// All values reported in R-units (already normalized by riskPerUnit in the
// resolver). MAE is negative (drawdown), MFE is positive (favorable excursion).
// ────────────────────────────────────────────────────────────────────────────

export function computeDiagnostics(attempts: TrainingAttempt[]): CoachDiagnostics {
  const filled = attempts.filter(isResolved).filter(isFilled);
  const winners = filled.filter((a) => rOf(a) > 0);
  const losers = filled.filter((a) => rOf(a) <= 0);

  const maeOnWinners = winners.map((a) => Math.abs(a.resolution!.mae || 0));
  const maeOnLosers = losers.map((a) => Math.abs(a.resolution!.mae || 0));
  const mfeOnLosers = losers.map((a) => Math.abs(a.resolution!.mfe || 0));
  const fibRows = filled
    .map((attempt) => {
      const trade = computeFibTradeExcursionPct(attempt);
      if (trade) return { attempt, maxAdversePct: trade.adversePct, maxFavorablePct: trade.favorablePct };
      const legacy = computeFibAdversePct(attempt);
      return legacy == null ? null : { attempt, maxAdversePct: legacy, maxFavorablePct: 0 };
    })
    .filter((row): row is { attempt: TrainingAttempt; maxAdversePct: number; maxFavorablePct: number } => !!row);
  const fibValues = fibRows.map((row) => row.maxAdversePct);
  const fibFavorableValues = fibRows.map((row) => row.maxFavorablePct);
  const fibWinnerValues = fibRows.filter((row) => rOf(row.attempt) > 0).map((row) => row.maxAdversePct);
  const fibLoserValues = fibRows.filter((row) => rOf(row.attempt) <= 0).map((row) => row.maxAdversePct);
  const fibWinnerFavorableValues = fibRows.filter((row) => rOf(row.attempt) > 0).map((row) => row.maxFavorablePct);
  const fibLoserFavorableValues = fibRows.filter((row) => rOf(row.attempt) <= 0).map((row) => row.maxFavorablePct);

  return {
    avgMaeOnLosers: round(safeMean(maeOnLosers), 2),
    avgMfeOnLosers: round(safeMean(mfeOnLosers), 2),
    avgMaeOnWinners: round(safeMean(maeOnWinners), 2),
    maxMaeOnWinners: round(maeOnWinners.length ? Math.max(...maeOnWinners) : 0, 2),
    losersN: losers.length,
    winnersN: winners.length,
    fibDrawdownN: fibRows.length,
    fibAvgMaxAdversePct: round(safeMean(fibValues), 1),
    fibMedianMaxAdversePct: round(percentile(fibValues, 0.5), 1),
    fibP75MaxAdversePct: round(percentile(fibValues, 0.75), 1),
    fibPctAtOrBeyond88: pct(fibRows.length ? fibValues.filter((v) => v >= 88).length / fibRows.length : 0),
    fibPctBeyond100: pct(fibRows.length ? fibValues.filter((v) => v > 100).length / fibRows.length : 0),
    fibWinnersAvgMaxAdversePct: round(safeMean(fibWinnerValues), 1),
    fibLosersAvgMaxAdversePct: round(safeMean(fibLoserValues), 1),
    fibAvgMaxFavorablePct: round(safeMean(fibFavorableValues), 1),
    fibMedianMaxFavorablePct: round(percentile(fibFavorableValues, 0.5), 1),
    fibPctReached75: pct(fibRows.length ? fibFavorableValues.filter((v) => v >= 75).length / fibRows.length : 0),
    fibPctReached100: pct(fibRows.length ? fibFavorableValues.filter((v) => v >= 100).length / fibRows.length : 0),
    fibWinnersAvgMaxFavorablePct: round(safeMean(fibWinnerFavorableValues), 1),
    fibLosersAvgMaxFavorablePct: round(safeMean(fibLoserFavorableValues), 1),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Slicing — per-dimension performance vs pooled baseline. We bucket attempts
// across a fixed list of dimensions, drop slices below MIN_SLICE_N, and rank
// by |Δ expectancy| × √N so high-confidence outliers float to the top.
// ────────────────────────────────────────────────────────────────────────────

interface SliceBucket {
  key: string;
  label: string;
  attempts: TrainingAttempt[];
}

function bucketBy(
  attempts: TrainingAttempt[],
  dim: CoachSlice['dimension'],
  keyFn: (a: TrainingAttempt) => string | null | undefined,
  labelFn: (key: string) => string,
): SliceBucket[] {
  const map = new Map<string, TrainingAttempt[]>();
  for (const a of attempts) {
    const k = keyFn(a);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  return Array.from(map.entries())
    .map(([key, group]) => ({ key: `${dim}:${key}`, label: labelFn(key), attempts: group }));
}

function bucketToSlice(
  bucket: SliceBucket,
  dim: CoachSlice['dimension'],
  pooledExpectancy: number,
): CoachSlice | null {
  const filled = bucket.attempts.filter(isResolved).filter(isFilled);
  if (filled.length < MIN_SLICE_N) return null;

  const rs = filled.map(rOf).filter((v) => Number.isFinite(v));
  const expectancy = rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : 0;
  const delta = expectancy - pooledExpectancy;
  const wins = rs.filter((r) => r > 0).length;
  const tp1 = filled.filter((a) => tpHit(a, 1)).length;
  const tp3 = filled.filter((a) => tpHit(a, 3)).length;

  return {
    id: bucket.key,
    dimension: dim,
    label: bucket.label,
    attempts: bucket.attempts.length,
    filled: filled.length,
    expectancy: round(expectancy, 3),
    delta: round(delta, 3),
    significance: round(Math.abs(delta) * Math.sqrt(filled.length), 3),
    winRate: pct(wins / filled.length),
    tp1Rate: pct(tp1 / filled.length),
    tp3Rate: pct(tp3 / filled.length),
  };
}

export function computeSlices(attempts: TrainingAttempt[], baseline: CoachBaselineStats): CoachSlice[] {
  const E0 = baseline.expectancyPerFilled;

  const buckets: SliceBucket[] = [
    ...bucketBy(attempts, 'side', (a) => a.side, (k) => `${k.toUpperCase()} only`),
    ...bucketBy(attempts, 'symbol', (a) => a.symbol, (k) => k),
    ...bucketBy(attempts, 'timeframe', (a) => a.timeframe, (k) => k),
    ...bucketBy(attempts, 'contract', (a) => a.contractId, (k) => k),
  ];

  const slices: CoachSlice[] = [];
  for (const b of buckets) {
    const s = bucketToSlice(b, b.key.split(':')[0] as CoachSlice['dimension'], E0);
    if (s) slices.push(s);
  }
  // Order by significance descending so the strongest signals come first.
  slices.sort((a, b) => b.significance - a.significance);
  return slices;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Observation library — pattern matchers that translate the numeric report
// into 1-3 sentences of actionable language. Each observation has a `rank` so
// the UI can show the top 3-5 without us needing a separate sort step.
//
// Adding a new observation? Each function should:
//   - read only from the inputs (baseline, diagnostics, slices)
//   - return null if the condition doesn't fire
//   - estimate `expectedRImpact` (in R per trade) when possible — that's how
//     observations get ranked, so missing values land near the bottom.
// ────────────────────────────────────────────────────────────────────────────

type ObservationFn = (
  baseline: CoachBaselineStats,
  diagnostics: CoachDiagnostics,
  slices: CoachSlice[],
) => CoachObservation | null;

function obsSampleSize(b: CoachBaselineStats): CoachObservation | null {
  if (b.filledCount >= MIN_BASELINE_N) return null;
  return {
    id: 'sample_size_low',
    severity: 'info',
    headline: `Only ${b.filledCount} resolved trades — interpret the rest of this report cautiously.`,
    detail: `Coach observations stabilize around ${MIN_BASELINE_N}+ resolved attempts. With ${b.filledCount}, individual outliers can swing every metric you see below.`,
    recommendation: `Keep grinding scenarios. Re-check this panel after another ${Math.max(1, MIN_BASELINE_N - b.filledCount)} resolved trades.`,
    evidence: `N=${b.filledCount} resolved & filled`,
    rank: 0.1,
  };
}

function obsNegativeExpectancy(b: CoachBaselineStats): CoachObservation | null {
  if (b.filledCount < MIN_BASELINE_N) return null;
  if (b.expectancyPerFilled >= 0) return null;
  return {
    id: 'expectancy_negative',
    severity: 'critical',
    headline: `Expectancy is ${b.expectancyPerFilled}R — you're currently a net loser on this contract.`,
    detail: `Across ${b.filledCount} filled attempts, average outcome is ${b.expectancyPerFilled}R per trade with a ${b.winRate}% win rate and ${b.payoffRatio} payoff ratio.`,
    recommendation: `Stop trading this contract live. Diagnose with the slicing breakdown — there's almost always a sub-slice with positive edge that's being dragged under by bad ones.`,
    evidence: `N=${b.filledCount}, E[R]=${b.expectancyPerFilled}, win=${b.winRate}%`,
    expectedRImpact: Math.abs(b.expectancyPerFilled),
    rank: 100,
  };
}

function obsTp1TooFar(_b: CoachBaselineStats, d: CoachDiagnostics): CoachObservation | null {
  if (d.losersN < MIN_SLICE_N) return null;
  if (d.avgMfeOnLosers < 0.5) return null;
  // If losers ran +0.5R or more in your favor before reversing, TP1 is leaving
  // those would-be winners on the table. Estimated impact: bringing TP1 in to
  // ~0.7× the avg MFE captures roughly half those losers as small wins.
  const impact = round((d.avgMfeOnLosers - 0.3) * 0.4, 2);
  return {
    id: 'tp1_too_far',
    severity: 'warning',
    headline: `Your losers run +${d.avgMfeOnLosers}R in your favor before reversing — TP1 may be too far.`,
    detail: `On the ${d.losersN} trades that ended at the stop or break-even, average favorable excursion was ${d.avgMfeOnLosers}R. Those trades reached real profit and gave it back.`,
    recommendation: `Consider moving TP1 in to about ${round(d.avgMfeOnLosers * 0.7, 2)}R — most of those reversals would convert to small wins.`,
    evidence: `losers N=${d.losersN}, avg MFE on losers=${d.avgMfeOnLosers}R`,
    expectedRImpact: impact,
    rank: 60 + impact * 100,
  };
}

function obsStopTooTight(b: CoachBaselineStats, d: CoachDiagnostics): CoachObservation | null {
  if (d.winnersN < MIN_SLICE_N) return null;
  if (d.avgMaeOnWinners > 0.55) return null;
  if (b.winRate >= 60) return null;
  // Winners barely drew down (avgMAE on winners < 0.55R) AND your win rate is
  // mediocre — that's the fingerprint of a stop that's eating noise. Tightening
  // the stop reduces risk-per-trade without losing many winners.
  const impact = round((0.55 - d.avgMaeOnWinners) * 0.3, 2);
  return {
    id: 'stop_too_tight',
    severity: 'opportunity',
    headline: `Your winners barely draw down (avg MAE ${d.avgMaeOnWinners}R) — stops may be eating noise.`,
    detail: `Winners only drew down to -${d.avgMaeOnWinners}R on average (worst: -${d.maxMaeOnWinners}R). Combined with a ${b.winRate}% win rate, the data suggests your current stops are wider than they need to be — and that's where missed entries come from.`,
    recommendation: `Test tightening stops to ~1.2× max-MAE-on-winners (${round(d.maxMaeOnWinners * 1.2, 2)}R from entry). Lower risk per trade, smaller losers, similar winner count.`,
    evidence: `winners N=${d.winnersN}, avg MAE=${d.avgMaeOnWinners}R, max MAE=${d.maxMaeOnWinners}R`,
    expectedRImpact: impact,
    rank: 50 + impact * 100,
  };
}

function obsStopTooLoose(b: CoachBaselineStats, d: CoachDiagnostics): CoachObservation | null {
  if (b.filledCount < MIN_BASELINE_N) return null;
  if (b.avgLossR > -0.95) return null;
  if (d.avgMaeOnWinners < 0.6) return null;
  // Losers are paying full -1R AND winners are dipping deep before working —
  // suggests your stop is at "max pain" rather than "structural invalidation."
  return {
    id: 'stop_too_loose',
    severity: 'warning',
    headline: `Losers cost -${Math.abs(b.avgLossR)}R while winners dip to -${d.avgMaeOnWinners}R — review stop placement.`,
    detail: `You're paying close to full risk on every losing trade. If structural invalidation actually sits closer than your current stop, you're overpaying for losers without protecting winners.`,
    recommendation: `Audit a sample of losers: was the stop placed at structure (swing/ATR) or at the max you were willing to lose? Tighten to structure where possible.`,
    evidence: `avgLossR=${b.avgLossR}, avg MAE on winners=${d.avgMaeOnWinners}R`,
    expectedRImpact: round(0.15, 2),
    rank: 40,
  };
}

function obsTp3TooClose(b: CoachBaselineStats): CoachObservation | null {
  if (b.tp2HitRate < 5) return null;
  const c = b.conditional.tp3GivenTp2;
  if (c == null || c < 0.7) return null;
  // P(TP3 | TP2) > 0.7 means almost every TP2 hit becomes a TP3 hit — TP3 is
  // very likely set inside the move's natural extension. Pushing it captures
  // more R per fill at modest cost in fill rate.
  const impact = round((c - 0.5) * 0.5, 2);
  return {
    id: 'tp3_too_close',
    severity: 'opportunity',
    headline: `${pct(c)}% of TP2 hits also hit TP3 — TP3 is set too close.`,
    detail: `Once price reaches TP2, it almost always continues to TP3. That means TP3 sits well inside the move's natural extension and you're cutting the runner short.`,
    recommendation: `Push TP3 further (try 1.3-1.5× current distance from entry) or add a TP4 / runner tranche. Even a 30% drop in TP3 hit rate is more than offset by the larger R per fill.`,
    evidence: `P(TP3|TP2)=${pct(c)}%, TP3 rate=${b.tp3HitRate}%`,
    expectedRImpact: impact,
    rank: 55 + impact * 100,
  };
}

function obsBimodal(b: CoachBaselineStats): CoachObservation | null {
  if (b.tp1HitRate < 20 || b.tp3HitRate < 8) return null;
  const middlePath = Math.max(0, b.tp1HitRate - b.tp2HitRate);
  const tailPath = Math.max(0, b.tp2HitRate - b.tp3HitRate);
  const stopOrTp3 = b.stopHitRate + b.tp3HitRate;
  if (stopOrTp3 < 60) return null;
  if (tailPath > 5) return null;
  // The "TP2 then trail-stop" middle path is hollow — it's effectively a binary
  // outcome. A 2-tranche structure (TP1 + runner) often beats the 3-tranche
  // ladder when payoffs are bimodal.
  return {
    id: 'bimodal_payoff',
    severity: 'info',
    headline: `Outcomes are bimodal — trades either fail early or run all the way. The middle TP2 is hollow.`,
    detail: `${b.stopHitRate}% stop out before TP1 and ${b.tp3HitRate}% run all the way to TP3, but only ~${round(tailPath, 1)}% end in the "TP2 then trail-stop" middle path. The intermediate target isn't doing much work.`,
    recommendation: `Test a 2-tranche structure: half off at TP1, half as a runner toward TP3. Often outperforms the 3-TP ladder when payoffs are bimodal.`,
    evidence: `stop=${b.stopHitRate}%, TP1=${b.tp1HitRate}%, TP2=${b.tp2HitRate}%, TP3=${b.tp3HitRate}%`,
    expectedRImpact: 0.1,
    rank: 30,
  };
}

function obsLowTp1(b: CoachBaselineStats): CoachObservation | null {
  if (b.filledCount < MIN_BASELINE_N) return null;
  if (b.tp1HitRate >= 50) return null;
  return {
    id: 'tp1_rate_low',
    severity: 'warning',
    headline: `TP1 hit rate is only ${b.tp1HitRate}% — entry quality is the bottleneck.`,
    detail: `More than half of your filled attempts never reach TP1. The expectancy you have has to be rebuilt from runners, which is fragile.`,
    recommendation: `Tighten the entry filter (require an extra confirmation bar, a closer pullback level, or a stronger HTF trend alignment). Lifting TP1 rate from ${b.tp1HitRate}% to ${Math.min(60, b.tp1HitRate + 10)}% is the highest-leverage change available.`,
    evidence: `N=${b.filledCount}, TP1 rate=${b.tp1HitRate}%`,
    expectedRImpact: 0.2,
    rank: 70,
  };
}

function obsFibEntriesEarly(_b: CoachBaselineStats, d: CoachDiagnostics): CoachObservation | null {
  if (!d.fibDrawdownN || d.fibDrawdownN < MIN_SLICE_N) return null;
  const reached75 = d.fibPctReached75 || 0;
  const reached100 = d.fibPctReached100 || 0;
  const winnerAvg = d.fibWinnersAvgMaxAdversePct || 0;
  const loserAvg = d.fibLosersAvgMaxAdversePct || 0;
  const median = d.fibMedianMaxAdversePct || 0;
  const p75 = d.fibP75MaxAdversePct || 0;
  const winnerMfe = d.fibWinnersAvgMaxFavorablePct || 0;
  if (median < 10 && p75 < 20 && reached75 >= 50) return null;

  const gap = Math.max(0, loserAvg - winnerAvg);
  const impact = round(Math.min(0.45, Math.max(0.12, gap / 100)), 2);
  return {
    id: 'fib_entries_early',
    severity: p75 >= 30 ? 'warning' : 'opportunity',
    headline: `Your manage-fib MAE median is -${median}% and the 75th percentile is -${p75}%.`,
    detail: `Across ${d.fibDrawdownN} filled fib attempts, winners need about -${winnerAvg}% adverse room and then reach +${winnerMfe}% on average. Losers need -${loserAvg}% and fail to convert.`,
    recommendation: `Test stop candidates around the winner MAE and 75th percentile: -10%, -20%, structure, then compare expectancy. On exits, audit whether +50%, +75%, or +100% is the natural partial: ${reached75}% reached +75% and ${reached100}% reached the structure target.`,
    evidence: `fib N=${d.fibDrawdownN}, MAE median=-${median}%, p75=-${p75}%, +75=${reached75}%, +100=${reached100}%`,
    expectedRImpact: impact,
    rank: 72 + impact * 100,
  };
}

function obsBestSlice(_b: CoachBaselineStats, _d: CoachDiagnostics, slices: CoachSlice[]): CoachObservation | null {
  const top = slices.find((s) => s.delta > 0.2 && s.filled >= MIN_SLICE_N);
  if (!top) return null;
  return {
    id: `best_slice_${top.id}`,
    severity: 'opportunity',
    headline: `${top.label} (${top.dimension}): +${top.delta}R better than baseline. Lean into it.`,
    detail: `On ${top.filled} filled attempts in this slice, expectancy is ${top.expectancy}R vs ${round(top.expectancy - top.delta, 2)}R pooled. That's a ${top.delta}R per-trade premium hiding inside your data.`,
    recommendation: `Consider weighting this slice higher in your live trading — same setup, just filtered by ${top.dimension}=${top.label}. Don't change anything else first; verify the edge persists in the next 20 attempts.`,
    evidence: `dimension=${top.dimension}, slice=${top.label}, N=${top.filled}, Δ=${top.delta}R`,
    expectedRImpact: top.delta,
    rank: 80 + top.significance * 5,
  };
}

function obsWorstSlice(_b: CoachBaselineStats, _d: CoachDiagnostics, slices: CoachSlice[]): CoachObservation | null {
  const bot = slices.find((s) => s.delta < -0.2 && s.filled >= MIN_SLICE_N);
  if (!bot) return null;
  return {
    id: `worst_slice_${bot.id}`,
    severity: 'warning',
    headline: `${bot.label} (${bot.dimension}): ${bot.delta}R worse than baseline. Consider excluding it.`,
    detail: `On ${bot.filled} filled attempts, expectancy is ${bot.expectancy}R — dragging your pooled number down by ${Math.abs(bot.delta)}R per trade in this slice.`,
    recommendation: `Filter this slice out of your contract scope (e.g., add ${bot.dimension}=${bot.label} to the exclusion list) and recompute. Your remaining edge will be cleaner.`,
    evidence: `dimension=${bot.dimension}, slice=${bot.label}, N=${bot.filled}, Δ=${bot.delta}R`,
    expectedRImpact: Math.abs(bot.delta),
    rank: 65 + bot.significance * 5,
  };
}

function obsLongShortAsymmetry(_b: CoachBaselineStats, _d: CoachDiagnostics, slices: CoachSlice[]): CoachObservation | null {
  const longSlice = slices.find((s) => s.dimension === 'side' && s.label.includes('LONG'));
  const shortSlice = slices.find((s) => s.dimension === 'side' && s.label.includes('SHORT'));
  if (!longSlice || !shortSlice) return null;
  if (longSlice.filled < MIN_SLICE_N || shortSlice.filled < MIN_SLICE_N) return null;
  const gap = longSlice.expectancy - shortSlice.expectancy;
  if (Math.abs(gap) < 0.3) return null;
  const better = gap > 0 ? longSlice : shortSlice;
  const worse = gap > 0 ? shortSlice : longSlice;
  return {
    id: 'long_short_asymmetry',
    severity: 'opportunity',
    headline: `${better.label} outperforms ${worse.label} by ${round(Math.abs(gap), 2)}R per trade.`,
    detail: `${better.label}: ${better.expectancy}R on N=${better.filled}.  ${worse.label}: ${worse.expectancy}R on N=${worse.filled}. The same playbook works on one side and not the other.`,
    recommendation: `Either restrict the contract to ${better.label.toLowerCase()}, or audit your ${worse.label.toLowerCase()} attempts to find the missing filter (HTF trend, vol regime, fundamentals).`,
    evidence: `long=${longSlice.expectancy}R (N=${longSlice.filled}), short=${shortSlice.expectancy}R (N=${shortSlice.filled})`,
    expectedRImpact: round(Math.abs(gap) * 0.5, 2),
    rank: 75,
  };
}

const ALL_OBSERVATIONS: ObservationFn[] = [
  obsSampleSize,
  obsNegativeExpectancy,
  obsLowTp1,
  obsFibEntriesEarly,
  obsTp1TooFar,
  obsStopTooTight,
  obsStopTooLoose,
  obsTp3TooClose,
  obsBimodal,
  obsBestSlice,
  obsWorstSlice,
  obsLongShortAsymmetry,
];

export function generateObservations(
  baseline: CoachBaselineStats,
  diagnostics: CoachDiagnostics,
  slices: CoachSlice[],
): CoachObservation[] {
  const observations: CoachObservation[] = [];
  for (const fn of ALL_OBSERVATIONS) {
    const obs = fn(baseline, diagnostics, slices);
    if (obs) observations.push(obs);
  }
  observations.sort((a, b) => b.rank - a.rank);
  return observations;
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level entry point — used by the /api/training/coach route. Filters by
// contractId when provided, runs the full pipeline, returns one report.
// ────────────────────────────────────────────────────────────────────────────

export interface BuildCoachReportInput {
  attempts: TrainingAttempt[];
  contractId?: string;
}

export function buildCoachReport(input: BuildCoachReportInput): CoachReport {
  const scoped = input.contractId
    ? input.attempts.filter((a) => a.contractId === input.contractId)
    : input.attempts;

  const baseline = computeBaseline(scoped);
  const diagnostics = computeDiagnostics(scoped);
  const stopStudy = computeStopStudy(scoped);
  const tpReachStudy = computeTpReachStudy(scoped);
  const equityCurveSimulation = computeEquityCurveSimulation(scoped);
  const slices = computeSlices(scoped, baseline);
  const observations = generateObservations(baseline, diagnostics, slices);

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      contractId: input.contractId,
      totalAttempts: scoped.length,
      resolvedFilled: baseline.filledCount,
      enoughData: baseline.filledCount >= MIN_BASELINE_N,
    },
    baseline,
    diagnostics,
    stopStudy,
    tpReachStudy,
    equityCurveSimulation,
    slices,
    observations,
  };
}
