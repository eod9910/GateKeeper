/**
 * Strategy Spec & Candidate Types
 * 
 * Defines the StrategySpec schema (versioned hypothesis object)
 * and the standardized Candidate output format with rule checklists.
 * 
 * This is the canonical definition — replaces the prior flat-params version.
 */

// ---------------------------------------------------------------------------
// Strategy Status
// ---------------------------------------------------------------------------
export type StrategyStatus = 'draft' | 'testing' | 'approved' | 'rejected';
export type StrategyAssetClass = 'futures' | 'stocks' | 'options' | 'forex' | 'crypto';

// ---------------------------------------------------------------------------
// Interval / Timeframe Convention
// ---------------------------------------------------------------------------
//
// CANONICAL KEY: "interval" — always yfinance-style: "1wk", "1d", "4h", "1h", "15m", "5m", "1m"
// DISPLAY KEY:   "timeframe" — UI-only labels: "W", "D", "4H", "1H", "15m", "5m", "1m"
//
// Rule: all internal logic, storage, candidate IDs, and spec definitions use `interval`.
//       `timeframe` is kept only for backward compat / display purposes.
//
export const INTERVAL_TO_DISPLAY: Record<string, string> = {
  '1mo': 'M', '1wk': 'W', '1d': 'D', '4h': '4H', '1h': '1H',
  '15m': '15m', '5m': '5m', '1m': '1m',
};
export const DISPLAY_TO_INTERVAL: Record<string, string> = {
  'M': '1mo', 'W': '1wk', 'D': '1d', '4H': '4h', '1H': '1h',
  '15m': '15m', '5m': '5m', '1m': '1m',
};

// ---------------------------------------------------------------------------
// Config sub-schemas
// ---------------------------------------------------------------------------

/** Shared structure extraction knobs (swing detection, base detection) */
export interface StructureConfig {
  swing_method: 'major' | 'rdp' | 'relative' | 'energy';
  swing_epsilon_pct: number;            // RDP epsilon as % of price range
  swing_left_bars: number;              // local-pivot window
  swing_right_bars: number;
  swing_first_peak_decline: number;     // MAJOR mode: first peak confirmation (e.g. 0.50)
  swing_subsequent_decline: number;     // MAJOR mode: subsequent reversal (e.g. 0.25)
  base_min_duration: number;            // min bars for a base (CANONICAL location for this param)
  base_max_duration: number;            // max bars for a base
  base_max_range_pct: number;           // max range as % of midpoint
  base_volatility_threshold: number;    // max avg bar range / close

  // Lookahead bias control
  // When true, structure extraction uses only bars <= t (walk-forward safe).
  // MUST be true for backtest mode. Scan mode may use false for speed.
  causal?: boolean;
}

/** Pattern-specific setup knobs (extensible per pattern type) */
export interface SetupConfig {
  pattern_type: string;                 // "wyckoff_accumulation", "quasimodo", etc.
  // Wyckoff-specific:
  min_prominence?: number;              // find_major_peaks prominence
  peak_lookback?: number;               // find_major_peaks lookback
  min_markdown_pct?: number;            // min decline from peak
  markdown_lookback?: number;           // bars to look for markdown low
  // NOTE: base_min_duration lives in structure_config (canonical location).
  //       Do NOT duplicate it here. The Wyckoff plugin reads from structure_config.
  base_resistance_closes?: number;      // closes above resistance to end base
  markup_lookforward?: number;          // bars to look for first markup
  markup_min_breakout_bars?: number;    // min bars above base
  pullback_lookforward?: number;        // bars to look for pullback
  pullback_retracement_min?: number;    // min retracement (0.30 = 30%)
  pullback_retracement_max?: number;    // max retracement (1.20 = 120%)
  double_bottom_tolerance?: number;     // pullback_low <= base_low * this (1.05 = 5% tolerance)
  breakout_multiplier?: number;         // close above resistance * this (1.02 = 2% above)
  score_min?: number;                   // minimum score to keep
  [key: string]: any;                   // future pattern knobs
}

/** Entry trigger definition */
export interface EntryConfig {
  trigger: string;                      // "second_breakout", "base_breakout", etc.
  breakout_pct_above?: number;          // % above resistance for trigger
  confirmation_bars?: number;           // bars that must hold
  max_entry_distance_pct?: number;
  [key: string]: any;
}

/** Risk / stop definition */
export interface RiskConfig {
  stop_type: string;                    // "structural", "atr_multiple", "fixed_pct", "swing_low"
  stop_level?: string;                  // "base_low", "pullback_low", etc.
  stop_value?: number;                  // for fixed_pct or atr_multiple
  stop_buffer_pct?: number;             // buffer below stop level
  take_profit_R?: number;
  trailing_stop_R?: number;
  max_hold_bars?: number;
  [key: string]: any;
}

/** Exit / target definition */
export interface ExitConfig {
  target_type: string;                  // "fibonacci", "atr_multiple", "percentage", "R_multiple"
  target_level?: number | null;         // fib level (0.25) or ATR multiple, etc.
  time_stop_bars?: number | null;       // max bars to hold
  trailing?: any | null;                // trailing stop config
  [key: string]: any;
}

/** Cost assumptions for backtesting */
export interface CostConfig {
  commission_per_trade: number;
  spread_pct?: number;
  slippage_pct: number;
}

// ---------------------------------------------------------------------------
// Execution Policy — harvest + behavioral lock layer
// ---------------------------------------------------------------------------
// This is NOT optional philosophy. It is machine-enforced in BOTH:
//   1. Validator backtest (to prove the rules are profitable)
//   2. Position Book live enforcement (so the trader cannot override while exposed)
// If you only put it in validator, you blow up live.
// If you only put it live, you don't know if it's profitable.
// You need both.
// ---------------------------------------------------------------------------

/** A single rung in the profit-lock ladder */
export interface LadderRung {
  at_r: number;     // when current R reaches this level...
  lock_r: number;   // ...move stop to lock in this many R
}

/** Scale-out rule for multi-contract / options positions */
export interface ScaleOutRule {
  at_multiple: number;   // when position value reaches this multiple (2.0 = +100%)
  pct_close: number;     // close this fraction of remaining position (0.50 = 50%)
}

/** Green-to-red protection — once a trade has been profitable, it cannot end negative */
export interface GreenToRedProtection {
  trigger_r: number;     // activates once trade reaches this R (e.g. 1.5)
  floor_r: number;       // if it drops back to this R, close (e.g. 0.25)
  action: 'close_market' | 'move_stop';
}

/** Time + loss kill switch */
export interface TimeStop {
  max_days_in_trade: number;
  max_loss_pct: number;  // if after max_days, P&L <= this %, close (e.g. -40 = -40%)
  action: 'close_market';
}

/** Profit giveback exit — caps how much unrealized profit you can lose */
export interface ProfitRetraceExit {
  peak_r: number;        // only activates once trade has reached this R (e.g. 2.0)
  giveback_r: number;    // if it drops this many R from peak, close (e.g. 1.0)
  action: 'close_market';
}

/**
 * ExecutionConfig — the harvest + behavioral lock layer.
 * Applied in BOTH backtest simulation AND live enforcement.
 * These rules are NOT suggestions. They are machine-enforced.
 */
export interface ExecutionConfig {
  // === Futures / single-contract instruments ===

  /** Move stop to breakeven when trade reaches this R */
  auto_breakeven_r?: number;                  // e.g. 1.0

  /** Progressive profit-lock ladder */
  lock_in_r_ladder?: LadderRung[];            // e.g. [{at_r:2, lock_r:1}, {at_r:3, lock_r:2}]

  /** Once profitable, can't end negative */
  green_to_red_protection?: GreenToRedProtection;

  /** Daily realized P&L cap — close all + pause when hit */
  daily_profit_cap_usd?: number;              // e.g. 500
  daily_profit_cap_action?: 'close_all_and_pause';

  // === Options / multi-contract instruments ===

  /** Mandatory scale-out at profit milestones */
  scale_out_rules?: ScaleOutRule[];           // e.g. [{at_multiple:2.0, pct_close:0.50}]

  /** Once position hits this R, stop must be >= entry (never go back to red) */
  winner_never_to_red_r?: number;             // e.g. 3.0

  /** Time + loss kill switch */
  time_stop?: TimeStop;

  /** Exit if profit retraces too far from peak */
  profit_retrace_exit?: ProfitRetraceExit;

  // === Production mode enforcement ===

  /** If true, manual stop/target editing is DISABLED for this strategy's trades */
  production_lock?: boolean;
}

// ---------------------------------------------------------------------------
// Rule Event — audit log entry when an execution rule fires
// ---------------------------------------------------------------------------

export type RuleEventType =
  | 'breakeven_triggered'
  | 'ladder_lock_triggered'
  | 'green_to_red_exit'
  | 'daily_cap_reached'
  | 'scale_out_triggered'
  | 'winner_lock_triggered'
  | 'time_stop_triggered'
  | 'profit_retrace_exit'
  | 'production_lock_engaged';

export interface RuleEvent {
  event_id: string;
  trade_id: string;
  strategy_version_id: string;
  rule_type: RuleEventType;
  timestamp: string;           // ISO datetime
  details: {
    current_r?: number;
    trigger_r?: number;
    new_stop?: number;
    old_stop?: number;
    pct_closed?: number;
    pnl_at_trigger?: number;
    [key: string]: any;
  };
}

// ---------------------------------------------------------------------------
// Parameter Manifest
// ---------------------------------------------------------------------------

export type StrategyParameterAnatomy =
  | 'structure'
  | 'location'
  | 'entry_timing'
  | 'pattern_gate'
  | 'regime_filter'
  | 'stop_loss'
  | 'take_profit'
  | 'risk_controls';

export type StrategyParameterValueType = 'int' | 'float' | 'enum' | 'bool' | 'string';

export interface StrategyParameterManifestItem {
  key: string;
  label: string;
  path: string;
  anatomy: StrategyParameterAnatomy;
  type: StrategyParameterValueType;
  description?: string;
  identity_preserving: boolean;
  sweep_enabled: boolean;
  sensitivity_enabled: boolean;
  suggested_values?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
  priority?: number;
  failure_modes_targeted?: string[];
}

// ---------------------------------------------------------------------------
// StrategySpec — the versioned hypothesis object
// ---------------------------------------------------------------------------
export interface StrategySpec {
  strategy_id: string;                  // e.g. "wyckoff_accumulation"
  version: number | string;             // auto-incremented or string
  strategy_version_id: string;          // "{strategy_id}_v{version}" — unique key
  status: StrategyStatus;
  asset_class?: StrategyAssetClass;     // validation universe class
  name: string;
  description: string;

  // Integrity — computed from config-relevant fields, NOT metadata
  // Hash covers: strategy_id, version, structure_config, setup_config,
  //   entry_config, risk_config, exit_config, cost_config
  spec_hash?: string;                   // SHA-256 of config payload

  // What to scan
  scan_mode?: string;                   // legacy compat: 'wyckoff' | 'swing' | etc.
  trade_direction?: string;             // 'long' | 'short' | 'both'
  interval?: string;                    // canonical timeframe key ("1wk", "1d", "4h")
  timeframe?: string;                   // DEPRECATED — use interval. Kept for backward compat.
  timeframes?: string[];                // legacy compat: list of timeframes
  universe: string[];                   // symbol list or empty for "any"

  // Detailed config (new schema)
  structure_config?: StructureConfig;
  setup_config?: SetupConfig;
  entry_config?: EntryConfig;
  risk_config?: RiskConfig;
  exit_config?: ExitConfig;
  cost_config?: CostConfig;
  execution_config?: ExecutionConfig;       // harvest + behavioral lock layer
  parameter_manifest?: StrategyParameterManifestItem[];

  // Legacy flat configs (backward compat with validator mock data)
  params?: { [key: string]: any };
  entry?: { trigger: string; confirmation_bars?: number; max_entry_distance_pct?: number; [key: string]: any };
  risk?: { stop_type: string; stop_value?: number; take_profit_R?: number; trailing_stop_R?: number; max_hold_bars?: number; [key: string]: any };
  costs?: { commission_per_trade: number; slippage_pct: number };

  // Metadata
  created_at: string;
  updated_at: string;
  created_by?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Candidate output — standardized across all plugins
// ---------------------------------------------------------------------------

/** Single rule evaluation in the checklist */
export interface RuleCheckItem {
  rule_name: string;
  passed: boolean;
  value: any;
  threshold: any;
}

/** An anchor point on the chart (index + price + optional date) */
export interface AnchorPoint {
  index: number;
  price: number;
  date?: string;
}

/** Named anchors map — varies by pattern type */
export interface CandidateAnchors {
  [key: string]: AnchorPoint | number | undefined;
}

/** Standardized candidate returned by run_strategy */
export interface StrategyCandidate {
  candidate_id: string;
  strategy_version_id: string;
  spec_hash?: string;                   // SHA-256 of the spec that produced this candidate
  symbol: string;
  interval?: string;                    // canonical timeframe key ("1wk", "1d", "4h")
  timeframe: string;                    // display label (kept for legacy compat)
  score: number;
  entry_ready: boolean;
  rule_checklist: RuleCheckItem[];
  anchors: CandidateAnchors;
  window_start: number;
  window_end: number;
  created_at: string;
  model_version?: string;
  chart_data?: any[];
  visual?: any;
  overlays?: any[];
  overlay_series?: any[];
  candidate_role?: 'context_indicator' | 'pattern_detector' | 'entry_signal';
  candidate_role_label?: string;
  candidate_actionability?: 'context_only' | 'setup_watch' | 'entry_ready';
  candidate_actionability_label?: string;
  candidate_semantic_summary?: string;
  candidate_origin_role?: string | null;
  candidate_entry_type?: string | null;

  // Legacy compatibility fields (populated for backward compat with existing UI)
  id?: string;                          // alias for candidate_id
  pattern_type?: string;
  prior_peak?: any;
  markdown?: any;
  base?: any;
  first_markup?: any;
  pullback?: any;
  second_breakout?: any;
  retracement_pct?: number;
  small_peak?: any;
  // Chart index helpers
  chart_prior_peak?: number;
  chart_markdown_low?: number;
  chart_base_start?: number;
  chart_base_end?: number;
  chart_first_markup?: number;
  chart_markup_high?: number;
  chart_pullback_low?: number;
  chart_second_breakout?: number;
  pattern_start_date?: string;
  pattern_end_date?: string;
}
