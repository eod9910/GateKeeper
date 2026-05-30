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

export interface SemanticVocabulary {
  setupFamilies?: string[];
  setupTags?: string[];
  contextTags?: string[];
  managementTags?: string[];
  confidenceBuckets?: string[];
}

export interface SemanticFamilyRule {
  setupFamily: string;
  requiredDrawings?: TrainingDrawingType[];
  requiredSetupTags?: string[];
  requiredContextTags?: string[];
  requireManagementPlan?: boolean;
}

export interface SemanticRequirements {
  requireSetupFamily?: boolean;
  requireThesis?: boolean;
  requireInvalidation?: boolean;
  requireConfidence?: boolean;
  requireManagementPlan?: boolean;
  minSetupTags?: number;
  minContextTags?: number;
  familyRules?: SemanticFamilyRule[];
}

export interface SemanticDeclaration {
  schemaVersion: string;
  declaredAt?: string;
  setupFamily?: string;
  thesis?: string;
  notes?: string;
  invalidation?: string;
  side: TrainingSide;
  confidence?: string;
  managementPlan?: string;
  setupTags?: string[];
  contextTags?: string[];
  managementTags?: string[];
  chartSnapshotRef?: string | null;
}

export interface SemanticReview {
  reviewedAt: string;
  notes?: string;
  mistakes?: string[];
  hindsightTags?: string[];
  followThroughGrade?: string;
}

export interface ContractSnapshot {
  id: string;
  name: string;
  version: string;
  semanticVocabulary?: SemanticVocabulary;
  semanticRequirements?: SemanticRequirements;
}

export type TrainingStopModel = 'atr_multiple';
export type TrainingTargetModel = 'r_multiple';

export interface TrainingSessionStrategyTemplate {
  family: string;
  strategyVariant?: string;
  indicatorSet?: string[];
  entryModel?: string;
  retracementPct?: number;
  stopModel?: TrainingStopModel;
  stopAtrMultiple?: number;
  targetModel?: TrainingTargetModel;
  targetRMultiple?: number;
  confidence?: string;
  requiredAnchorType?: TrainingDrawingType;
  notes?: string;
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
  semanticVocabulary?: SemanticVocabulary;
  semanticRequirements?: SemanticRequirements;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleEvaluation {
  id: string;
  type: TrainingRuleDefinition['type'] | 'basic_ordering' | 'entry_bar_exists' | 'cooldown_lock' | 'semantic_declaration';
  description: string;
  severity: TrainingRuleSeverity;
  passed: boolean;
  actual?: any;
  expected?: any;
  pointsDelta?: number;
}

export interface TpLevelResult {
  hit: boolean;
  barIndex?: number;
  barTime?: string;
  rMultiple?: number;
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
  tp2?: TpLevelResult;
  tp3?: TpLevelResult;
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
  takeProfit2?: number;
  takeProfit3?: number;
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
  semanticDeclaration?: SemanticDeclaration;
  semanticReview?: SemanticReview;
  contractSnapshot?: ContractSnapshot;
  strategyTemplateSnapshot?: TrainingSessionStrategyTemplate;
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
  tp1HitRate?: number;
  tp2HitRate?: number;
  tp3HitRate?: number;
}

export interface TrainingSession {
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  contractId: string;
  contractVersion: string;
  strategyTemplate?: TrainingSessionStrategyTemplate;
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
  takeProfit2?: number;
  takeProfit3?: number;
  riskPct?: number;
  entryBarIndex: number;
  entryBarTime?: string;
  drawings?: TrainingDrawing[];
  semanticDeclaration?: SemanticDeclaration;
  bars: TrainingBar[];
  maxHoldBars?: number;
  tieBreakPolicy?: ForwardTieBreakPolicy;
  entryModel?: 'touch' | 'first_reclaim' | 'close_back_through';
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

export type TrainingBacktestReportMode = 'all' | 'contract' | 'session';
export type TrainingBacktestConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TrainingBacktestBreakdownItem {
  key: string;
  count: number;
  pct: number;
}

export interface TrainingBacktestScope {
  mode: TrainingBacktestReportMode;
  contractId?: string;
  sessionId?: string;
  sessions: number;
  attempts: number;
  qualifiedAttempts: number;
  blockedAttempts: number;
  resolvedAttempts: number;
  filledTrades: number;
  noFillTrades: number;
  generatedAt: string;
}

export interface TrainingBacktestTradesSummary {
  total_trades: number;
  winners: number;
  losers: number;
  scratches: number;
  no_fill_trades: number;
  win_rate: number;
  avg_win_R: number;
  avg_loss_R: number;
  expectancy_R: number;
  payoff_ratio: number;
  profit_factor: number;
  largest_win_R: number;
  largest_loss_R: number;
  avg_hold_bars: number;
  median_hold_bars: number;
}

export interface TrainingBacktestRiskSummary {
  max_drawdown_R: number;
  max_drawdown_pct: number;
  longest_losing_streak: number;
  avg_losing_streak: number;
  longest_winning_streak: number;
  time_under_water_trades: number;
  expected_recovery_trades: number;
}

export interface TrainingBacktestDisciplineSummary {
  process_adherence: number;
  discipline_trend: number;
  composite_score_avg: number;
  contract_pass_rate: number;
  blocked_attempt_rate: number;
  avg_risk_pct: number;
  avg_reward_risk: number;
}

export interface TrainingBacktestConfidenceSummary {
  label: TrainingBacktestConfidence;
  resolved_trades: number;
  message: string;
}

export interface TrainingBacktestBreakdownItem {
  key: string;
  count: number;
  pct: number;
}

export interface TrainingBacktestReport {
  scope: TrainingBacktestScope;
  trades_summary: TrainingBacktestTradesSummary;
  risk_summary: TrainingBacktestRiskSummary;
  discipline_summary: TrainingBacktestDisciplineSummary;
  breakdowns: {
    exit_reasons: TrainingBacktestBreakdownItem[];
    by_symbol: TrainingBacktestBreakdownItem[];
    by_timeframe: TrainingBacktestBreakdownItem[];
    by_side: TrainingBacktestBreakdownItem[];
  };
  confidence: TrainingBacktestConfidenceSummary;
}
