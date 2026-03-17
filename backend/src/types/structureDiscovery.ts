export type PivotType = 'HIGH' | 'LOW';
export type PivotLabel = 'HH' | 'LH' | 'HL' | 'LL' | 'EH' | 'EL';
export type LegDirection = 'UP' | 'DOWN';
export type RegimeType = 'UPTREND' | 'DOWNTREND' | 'RANGE';
export type VolatilityRegime = 'LOW_VOL' | 'MID_VOL' | 'HIGH_VOL';

export interface BarRecord {
  symbol: string;
  timeframe: string;
  timestamp: string;
  barIndex: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr14: number;
  barRange: number;
  bodySize: number;
  rangeAtrNorm: number;
  bodyAtrNorm: number;
}

export interface PivotRecord {
  pivotId: string;
  symbol: string;
  timeframe: string;
  barIndex: number;
  timestamp: string;
  price: number;
  pivotType: PivotType;
  candidateBarIndex: number;
  confirmationBarIndex: number;
  confirmationDelayBars: number;
  atrAtConfirmation: number;
  distanceFromPrevPivotAtr: number | null;
  barsFromPrevPivot: number | null;
}

export interface LegRecord {
  legId: string;
  symbol: string;
  timeframe: string;
  startPivotId: string;
  endPivotId: string;
  direction: LegDirection;
  startPrice: number;
  endPrice: number;
  priceDistance: number;
  distanceAtrNorm: number;
  barCount: number;
  slopePerBar: number;
  velocityAtrPerBar: number;
  volumeSum: number;
  avgBarRangeAtrNorm: number;
  maxInternalPullbackAtr: number;
  legStrengthScore: number;
}

export interface PivotLabelRecord {
  pivotId: string;
  majorLabel: PivotLabel;
  comparisonPivotId: string | null;
  priceDelta: number | null;
  priceDeltaAtrNorm: number | null;
  equalBandFlag: boolean;
}

export interface MotifInstanceRecord {
  motifInstanceId: string;
  symbol: string;
  timeframe: string;
  startBarIndex: number;
  endBarIndex: number;
  pivotIds: string[];
  legIds: string[];
  pivotTypeSeq: PivotType[];
  pivotLabelSeq: PivotLabel[];
  legDirectionSeq: LegDirection[];
  featureVector: Record<string, number | string | boolean | null>;
  qualityScore: number;
  regimeTag: string | null;
  familySignature: string | null;
  familyId: string | null;
}

export interface OutcomeRecord {
  motifInstanceId: string;
  entryBarIndex: number;
  entryTimestamp: string;
  entryClose: number;
  entryAtr: number;
  forward5ReturnAtr: number | null;
  forward10ReturnAtr: number | null;
  mfe10Atr: number | null;
  mae10Atr: number | null;
  hitPlus1AtrFirst: boolean | null;
  hitMinus1AtrFirst: boolean | null;
  nextBreakUp: boolean | null;
  nextBreakDown: boolean | null;
}

export interface FamilyStatsRecord {
  groupingVersion: string;
  familyId: string;
  familySignature: string;
  occurrenceCount: number;
  valid5BarCount: number;
  valid10BarCount: number;
  discoveryCount: number;
  validationCount: number;
  holdoutCount: number;
  avgForward5ReturnAtr: number | null;
  medianForward5ReturnAtr: number | null;
  avgForward10ReturnAtr: number | null;
  medianForward10ReturnAtr: number | null;
  forward10StdDevAtr: number | null;
  forward10StdErrorAtr: number | null;
  tScoreForward10: number | null;
  sharpeLikeForward10: number | null;
  discoveryAvgForward10ReturnAtr: number | null;
  validationAvgForward10ReturnAtr: number | null;
  holdoutAvgForward10ReturnAtr: number | null;
  avgMfe10Atr: number | null;
  medianMfe10Atr: number | null;
  avgMae10Atr: number | null;
  medianMae10Atr: number | null;
  hitPlus1AtrFirstRate: number | null;
  hitMinus1AtrFirstRate: number | null;
  nextBreakUpRate: number | null;
  nextBreakDownRate: number | null;
  discoveryHitPlus1AtrFirstRate: number | null;
  validationHitPlus1AtrFirstRate: number | null;
  holdoutHitPlus1AtrFirstRate: number | null;
  avgQualityScore: number | null;
  regimeDistribution: Record<string, number>;
  exactSignatureCount: number;
  exactSignatureExamples: string[];
  signConsistentAcrossSplits: boolean;
  validationDegradationPct: number | null;
  holdoutDegradationPct: number | null;
  passesMinCount: boolean;
  passesOutcomeCoverage: boolean;
  isCandidateFamily: boolean;
}
