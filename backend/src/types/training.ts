export type TrainingSide = 'long' | 'short';
export type TrainingDrawingType = 'box' | 'line' | 'point' | 'fib';
export type TrainingRuleSeverity = 'info' | 'warning' | 'block';
export type TrainingAttemptStatus = 'blocked' | 'entered' | 'resolved';
export type TrainingUiState =
  | 'IDLE'
  | 'SETUP_DEFINED'
  | 'ENTRY_BLOCKED'
  | 'ENTRY_READY'
  | 'ENTERED'
  | 'FORWARD_SIMULATING'
  | 'RESOLVED'
  | 'REVIEW'
  | 'COOLDOWN';
export type ForwardExitReason = 'tp_hit' | 'sl_hit' | 'time_stop' | 'no_fill';
export type ForwardTieBreakPolicy = 'stop_first' | 'target_first';

export interface TrainingBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TrainingDrawing {
  id: string;
  type: TrainingDrawingType;
  label?: string;
  startTime?: string;
  endTime?: string;
  price?: number;
  price2?: number;
  top?: number;
  bottom?: number;
}

export interface TrainingRuleDefinition {
  id: string;
  type:
    | 'required_drawing'
    | 'entry_above_drawing_top'
    | 'entry_below_drawing_bottom'
    | 'entry_near_fib_level'
    | 'stop_below_drawing_bottom'
    | 'stop_above_drawing_top'
    | 'min_reward_risk'
    | 'max_risk_pct'
    | 'entry_after_drawing_end'
    | 'take_profit_above_entry'
    | 'take_profit_below_entry'
    // Side-aware (adapt to draft.side automatically)
    | 'entry_breakout_from_drawing'
    | 'entry_fade_into_drawing'
    | 'stop_outside_drawing'
    | 'stop_beyond_fib_extreme'
    | 'take_profit_beyond_entry'
    | 'entry_near_fib_retracement'
    | 'entry_beyond_fib_level';
  description: string;
  severity?: TrainingRuleSeverity;
  drawingId?: string;
  min?: number;
  max?: number;
  level?: number;
  tolerancePct?: number;
  bufferPct?: number;
  enabled?: boolean;
}

export interface RequiredDrawing {
  id: string;
  label: string;
  type: TrainingDrawingType;
  required: boolean;
}

export interface CooldownPolicy {
  enabled?: boolean;
  triggerViolationCount: number;
  lookbackAttempts: number;
  cooldownMinutes: number;
}

export interface ScoreWeights {
  process: number;
  outcome: number;
}

export interface TrainingSimulationConfig {
  maxHoldBars?: number;
  tieBreakPolicy?: ForwardTieBreakPolicy;
}

export interface StrategyContract {
  id: string;
  name: string;
  version: string;
  active: boolean;
  symbolScope: string[];
  timeframeScope: string[];
  sideScope?: TrainingSide[];
  entryRules: TrainingRuleDefinition[];
  riskRules: TrainingRuleDefinition[];
  requiredDrawings: RequiredDrawing[];
  cooldownPolicy: CooldownPolicy;
  scoreWeights: ScoreWeights;
  simulation?: TrainingSimulationConfig;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleEvaluation {
  id: string;
  type: TrainingRuleDefinition['type'] | 'basic_ordering' | 'entry_bar_exists' | 'cooldown_lock';
  description: string;
  severity: TrainingRuleSeverity;
  passed: boolean;
  actual?: any;
  expected?: any;
  pointsDelta?: number;
}

export interface ForwardResolution {
  entryHit: boolean;
  entryBarIndex?: number;
  entryBarTime?: string;
  exitReason: ForwardExitReason;
  exitPrice: number;
  exitBarIndex: number;
  exitBarTime: string;
  barsHeld: number;
  rMultiple: number;
  pnlAbs: number;
  pnlPct: number;
  mae: number;
  mfe: number;
  resolverVersion: string;
}

export interface ScoreSnapshot {
  processScore: number;
  outcomeScore: number;
  compositeScore: number;
  disciplineScoreRolling: number;
  expectancyRolling: number;
  winRateRolling: number;
}

export interface TrainingAttempt {
  attemptId: string;
  sessionId: string;
  contractId: string;
  contractVersion: string;
  symbol: string;
  timeframe: string;
  side: TrainingSide;
  entry: number;
  stop: number;
  takeProfit: number;
  riskPct?: number;
  rewardRisk?: number;
  entryBarIndex: number;
  entryBarTime: string;
  drawings: TrainingDrawing[];
  ruleEvaluations: RuleEvaluation[];
  violations: string[];
  rewards: string[];
  status: TrainingAttemptStatus;
  uiState?: TrainingUiState;
  chartSnapshotRef?: string | null;
  bars?: TrainingBar[];
  resolution?: ForwardResolution;
  scoreSnapshot?: ScoreSnapshot;
  createdAt: string;
  resolvedAt?: string;
}

export interface TrainingSessionStats {
  attempts: number;
  resolvedAttempts: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;
  processAdherence: number;
  disciplineTrend: number;
  cooldownActive: boolean;
  cooldownUntil?: string | null;
}

export interface TrainingSession {
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  contractId: string;
  contractVersion: string;
  attemptIds: string[];
  stats: TrainingSessionStats;
  cooldownUntil?: string | null;
}

export interface TrainingEvent {
  id: string;
  type: 'session_started' | 'session_ended' | 'attempt_validated' | 'attempt_resolved' | 'cooldown_triggered';
  sessionId?: string;
  attemptId?: string;
  contractId?: string;
  timestamp: string;
  payload: Record<string, any>;
}

export interface AttemptDraft {
  sessionId: string;
  contractId: string;
  symbol: string;
  timeframe: string;
  side: TrainingSide;
  entry: number;
  stop: number;
  takeProfit: number;
  riskPct?: number;
  entryBarIndex: number;
  entryBarTime?: string;
  drawings?: TrainingDrawing[];
  bars: TrainingBar[];
  maxHoldBars?: number;
  tieBreakPolicy?: ForwardTieBreakPolicy;
}

export interface AttemptValidationResult {
  state: TrainingUiState;
  ready: boolean;
  evaluations: RuleEvaluation[];
  derived: {
    riskPerUnit: number;
    rewardPerUnit: number;
    rewardRisk: number;
    riskPct: number;
  };
  cooldownUntil?: string | null;
}

export interface TrainingStatsAggregate {
  contractId?: string;
  attempts: number;
  resolvedAttempts: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;
  processAdherence: number;
  compositeScoreAvg: number;
  sessions: number;
}
