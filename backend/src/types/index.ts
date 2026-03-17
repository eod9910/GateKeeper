/**
 * Type definitions for Pattern Detector
 */

// Re-export strategy types
export * from './strategy';
export * from './fundamentals';
export * from './training';
export * from './structureDiscovery';

// Base structure (accumulation zone)
export interface Base {
  startIndex: number;
  endIndex: number;
  low: number;
  high: number;
  height: number;
  duration: number; // bars
}

// Markup breakout
export interface Markup {
  breakoutIndex: number;
  high: number;
}

// Second pullback (entry zone)
export interface Pullback {
  startIndex: number;
  lowIndex: number;
  low: number;
  duration: number; // bars
  retracement: number; // 0.70 - 0.88
}

// Pattern candidate (proposed by scanner)
export interface PatternCandidate {
  id: string;
  symbol: string;
  timeframe: string;
  base: Base;
  markup: Markup;
  pullback: Pullback;
  score: number;
  createdAt: string;
  windowStart: number;
  windowEnd: number;
  // For display
  startDate?: string;
  endDate?: string;
}

// User label (Yes/No/Close)
export type LabelType = 'yes' | 'no' | 'close';

export interface PatternLabel {
  id: string;
  candidateId: string;
  userId: string;
  label: LabelType;
  notes: string;
  timestamp: string;
  symbol?: string;
  timeframe?: string;
  source?: 'human' | 'ai';
  confidence?: number;
  modelVersion?: string;
  runId?: string;
  reasoning?: string;
}

// Drawing annotation types for visual pattern markup
export interface DrawingAnnotation {
  type: 'point' | 'box' | 'lineUp' | 'lineDown' | 'hline';
  // For point type
  time?: string;
  price?: number;
  // For box and line types
  time1?: string;
  price1?: number;
  time2?: string;
  price2?: number;
}

export interface DrawingAnnotations {
  peak?: DrawingAnnotation | null;
  markdown?: DrawingAnnotation | null;
  base?: DrawingAnnotation | null;
  markup?: DrawingAnnotation | null;
  pullback?: DrawingAnnotation | null;
  breakout?: DrawingAnnotation | null;
}

// Pattern correction (original → corrected, like handwriting)
// OR drawing annotations for visual markup
export interface PatternCorrection {
  id: string;
  candidateId: string;
  userId: string;
  symbol: string;
  timeframe: string;
  patternType?: string;  // 'wyckoff', 'wyckoff_drawing', etc.
  source?: 'human' | 'ai';
  confidence?: number;
  modelVersion?: string;
  runId?: string;
  reasoning?: string;
  
  // Original detection (what the scanner thought) - optional for drawings
  original?: {
    baseStartIndex?: number;
    baseEndIndex?: number;
    markupHighIndex?: number;
    pullbackLowIndex?: number;
    priorPeakIndex?: number;
    markdownLowIndex?: number;
    secondBreakoutIndex?: number;
    detectedBaseTop?: number;
    detectedBaseBottom?: number;
    [key: string]: any;
  } | null;
  
  // Corrected positions (what user says is right) - optional for drawings
  corrected?: {
    baseStartIndex?: number;
    baseEndIndex?: number;
    markupHighIndex?: number;
    pullbackLowIndex?: number;
    priorPeakIndex?: number;
    markdownLowIndex?: number;
    secondBreakoutIndex?: number;
    baseTopPrice?: number;
    baseBottomPrice?: number;
    correctionMode?: string;
    notes?: string;
    [key: string]: any;
  } | null;
  
  // Drawing annotations (new visual markup system)
  drawings?: DrawingAnnotations;
  canvasSize?: { width: number; height: number };
  chartTimeRange?: { start: string; end: string };
  chartPriceRange?: { low: number; high: number };
  
  timestamp: string;
}

// Labeling statistics
export interface LabelingStats {
  totalCandidates: number;
  totalLabels: number;
  yesCount: number;
  noCount: number;
  closeCount: number;
  correctedCount?: number;
  correctedCandidates?: number;
  reviewedCandidates?: number;
  unlabeled: number;
}

// Scan request
export interface ScanRequest {
  symbol: string;
  timeframe?: string;
  period?: string;
  interval?: string;
  minRetracement?: number;
  maxRetracement?: number;
  scanMode?: 'wyckoff' | 'swing' | 'fib-energy' | 'copilot' | 'discount' | 'discount-only' | 'regime' | 'strategy';  // Scan mode selection
  swingPct?: number;  // Min swing percentage (0.15 = 15%)
  fibProximity?: number;  // Fib level proximity threshold (3 = 3%)
  swingEpsilon?: number;  // RDP swing sensitivity as % of price range (0.05 = 5%)
  minMarkdown?: number;  // Min markdown % for Wyckoff (0.70 = strict, 0.50 = relaxed for discount chain)
  skipSave?: boolean;  // Don't save to storage (for chained scans like discount→wyckoff)
  tradeDirection?: 'long' | 'short';  // User's chosen trade direction (overrides auto-detection)
  // Strategy-driven scanning
  strategyVersionId?: string;  // Run a specific strategy version (e.g. "wyckoff_accumulation_v1")
  strategyId?: string;         // Run latest approved version of a strategy
  pluginId?: string;           // Run a scan directly from an indicator definition
  scanScope?: 'production' | 'research';  // production = approved only, research = allow drafts/testing
}

// API responses
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// =====================
// VALIDATOR SYSTEM
// =====================

// StrategySpec is now defined in ./strategy.ts and re-exported above.
// It includes both the new detailed config schema (structure_config, setup_config, etc.)
// and backward-compatible fields (params, entry, risk, costs) for the validator mock data.

/**
 * ValidationReport — output of a complete backtest + robustness run.
 */
export interface ValidationReport {
  report_id: string;
  strategy_version_id: string;

  // Run configuration
  config: {
    date_start: string;
    date_end: string;
    universe: string[];
    timeframes: string[];
    validation_tier?: 'tier1' | 'tier1b' | 'tier2' | 'tier3';
    asset_class?: 'futures' | 'stocks' | 'options' | 'forex' | 'crypto';
    costs: {
      commission_per_trade: number;
      slippage_pct: number;
    };
    validation_thresholds?: {
      min_trades_pass: number;
      min_trades_fail: number;
      max_oos_degradation_pct: number;
      min_wf_profitable_windows: number;
      max_mc_p95_dd_pct: number;
      max_mc_p99_dd_pct: number;
      max_sensitivity_score: number;
      r_to_pct: number;
    };
  };

  // Core backtest results
  trades_summary: {
    total_trades: number;
    winners: number;
    losers: number;
    win_rate: number;
    avg_win_R: number;
    avg_loss_R: number;
    expectancy_R: number;
    profit_factor: number;
    largest_win_R: number;
    largest_loss_R: number;
  };

  // Risk metrics
  risk_summary: {
    max_drawdown_pct: number;
    max_drawdown_R: number;
    longest_losing_streak: number;
    avg_losing_streak: number;          // mean consecutive-loss run length
    longest_winning_streak: number;
    time_under_water_bars: number;      // max bars from equity peak to recovery
    expected_recovery_time_bars: number; // mean bars from equity peak to recovery
    sharpe_ratio?: number;
    calmar_ratio?: number;
  };

  // Robustness tests
  robustness: {
    out_of_sample: {
      is_expectancy: number;
      is_n: number;
      oos_expectancy: number;
      oos_n: number;
      split_date: string;
      oos_degradation_pct: number;
    };
    walk_forward: {
      windows: Array<{
        train_start: string;
        train_end: string;
        test_start: string;
        test_end: string;
        train_expectancy: number;
        test_expectancy: number;
        test_n: number;
      }>;
      avg_test_expectancy: number;
      pct_profitable_windows: number;
    };
    monte_carlo: {
      simulations: number;
      median_dd_pct: number;
      p95_dd_pct: number;
      p99_dd_pct: number;
      median_final_R: number;
      p5_final_R: number;
    };
    parameter_sensitivity: {
      params_tested: string[];
      base_expectancy: number;
      nudged_results: Array<{
        param: string;
        direction: '+10%' | '-10%';
        expectancy: number;
        change_pct: number;
      }>;
      sensitivity_score: number;
    };
  };

  // Execution rule impact (how harvest/lock rules affected results)
  execution_stats?: {
    rules_active: boolean;                  // were execution rules applied in this backtest?
    breakeven_triggers: number;             // times auto-BE fired
    ladder_lock_triggers: number;           // times a ladder rung moved the stop
    green_to_red_exits: number;             // times green-to-red protection closed a trade
    scale_out_triggers: number;             // times a scale-out milestone was hit
    time_stop_exits: number;                // times time+loss kill switch fired
    profit_retrace_exits: number;           // times profit giveback rule closed a trade
    daily_cap_triggers: number;             // times daily cap paused trading
    avg_giveback_from_peak_R: number;       // mean R lost from peak before exit
    pct_trades_hitting_breakeven: number;   // 0.0-1.0
    pct_trades_hitting_scale_out: number;   // 0.0-1.0
    expectancy_without_rules_R?: number;    // expectancy if rules were NOT applied (comparison)
    expectancy_with_rules_R?: number;       // expectancy WITH rules (should match trades_summary)
  };

  // Overall verdict
  pass_fail: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  pass_fail_reasons: string[];

  // Human decision
  decision_log: {
    decision: 'approved' | 'rejected' | 'pending';
    decided_by: string;
    decided_at: string | null;
    notes: string;
  };

  created_at: string;
}

/**
 * TradeInstance — a single trade from a backtest run (for audit trail).
 */
export interface TradeInstance {
  trade_id: string;
  report_id: string;
  strategy_version_id: string;

  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';

  // Entry
  entry_time: string;
  entry_price: number;
  entry_bar_index: number;

  // Stop
  stop_price: number;
  stop_distance: number;

  // Exit
  exit_time: string;
  exit_price: number;
  exit_bar_index: number;
  exit_reason: 'target' | 'stop' | 'trailing' | 'time' | 'end_of_data';

  // Result
  R_multiple: number;
  pnl_gross: number;
  pnl_net: number;
  fees_applied: number;
  slippage_applied: number;

  // Audit trail
  setup_type: string;
  anchors_snapshot: {
    swing_points?: any[];
    fib_levels?: any[];
    energy_state?: any;
  };
}

export interface ValidatorTradeBucketStats {
  trade_count: number;
  winners: number;
  losers: number;
  win_rate: number;
  expectancy_R: number;
  profit_factor: number;
  avg_win_R: number;
  avg_loss_R: number;
  total_R: number;
  avg_hold_bars: number;
  median_hold_bars: number;
  median_R: number;
}

export interface ValidatorExitReasonDelta {
  reason: string;
  current_count: number;
  previous_count: number;
  delta_count: number;
  current_pct: number;
  previous_pct: number;
}

export interface ValidatorRDistributionDelta {
  bucket: string;
  current_count: number;
  previous_count: number;
  delta_count: number;
  current_pct: number;
  previous_pct: number;
}

export interface ValidatorSymbolImpact {
  symbol: string;
  trade_count: number;
  total_R: number;
  expectancy_R: number;
  win_rate: number;
  avg_win_R: number;
  avg_loss_R: number;
  avg_hold_bars: number;
}

export interface ValidatorSharedSymbolChange {
  symbol: string;
  current_trade_count: number;
  previous_trade_count: number;
  current_total_R: number;
  previous_total_R: number;
  delta_total_R: number;
  current_expectancy_R: number;
  previous_expectancy_R: number;
  delta_expectancy_R: number;
}

export interface ValidatorComparisonDiagnostics {
  current_report_id: string;
  previous_report_id: string;
  strategy_version_id: string;
  universe_summary: {
    current_universe_size: number;
    previous_universe_size: number;
    shared_universe_size: number;
    added_universe_size: number;
    removed_universe_size: number;
  };
  cohort_stats: {
    current_all: ValidatorTradeBucketStats;
    previous_all: ValidatorTradeBucketStats;
    current_shared_symbol_trades: ValidatorTradeBucketStats;
    previous_shared_symbol_trades: ValidatorTradeBucketStats;
    current_added_symbol_trades: ValidatorTradeBucketStats;
    previous_removed_symbol_trades: ValidatorTradeBucketStats;
  };
  exit_reason_breakdown: ValidatorExitReasonDelta[];
  r_distribution_breakdown: ValidatorRDistributionDelta[];
  top_added_symbols: ValidatorSymbolImpact[];
  top_negative_symbols_current: ValidatorSymbolImpact[];
  shared_symbol_changes: ValidatorSharedSymbolChange[];
  key_takeaways: string[];
}

export type ValidatorRunJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ValidatorRunJob {
  job_id: string;
  status: ValidatorRunJobStatus;
  strategy_version_id: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  progress: number;
  report_id?: string;
  error?: string;
}
