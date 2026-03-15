/**
 * Execution Engine — Pure function enforcement logic
 * 
 * Used in TWO places:
 *   1. Validator backtest simulation (to prove the rules are profitable)
 *   2. Position Book live enforcement (so the trader cannot override while exposed)
 * 
 * Every function here is PURE: input → output, no side effects, no storage calls.
 * The caller (backtest loop or live monitor) is responsible for saving state.
 */

import {
  ExecutionConfig,
  LadderRung,
  RuleEvent,
  RuleEventType,
} from '../types/strategy';

// ---------------------------------------------------------------------------
// Trade state that the engine reads
// ---------------------------------------------------------------------------

export interface TradeState {
  trade_id: string;
  strategy_version_id: string;
  direction: 'long' | 'short';
  entry_price: number;
  current_price: number;
  stop_price: number;
  stop_distance: number;       // |entry - stop| = 1R
  peak_price: number;          // highest (long) or lowest (short) price since entry
  peak_r: number;              // max R reached during this trade
  current_r: number;           // current R right now
  position_size: number;       // contracts/shares remaining
  original_size: number;       // contracts/shares at entry
  entry_time: string;          // ISO datetime
  current_time: string;        // ISO datetime
  instrument_type: 'futures' | 'options' | 'stock' | 'forex' | 'crypto';
  daily_realized_pnl_usd: number;  // today's closed P&L so far
}

// ---------------------------------------------------------------------------
// Actions the engine returns (caller executes them)
// ---------------------------------------------------------------------------

export type ActionType =
  | 'move_stop'
  | 'close_partial'
  | 'close_full'
  | 'pause_trading';

export interface EngineAction {
  action: ActionType;
  rule_type: RuleEventType;
  new_stop?: number;
  close_pct?: number;          // fraction to close (0.5 = 50%)
  reason: string;
  details: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Core: evaluate all execution rules against current trade state
// ---------------------------------------------------------------------------

/**
 * Given a trade's current state and the execution config, return all actions
 * that should fire RIGHT NOW. Can return 0..N actions.
 * 
 * Rules are evaluated in priority order:
 *   1. Daily cap (trumps everything — close all and pause)
 *   2. Time stop (kill switch)
 *   3. Green-to-red protection (emergency floor)
 *   4. Profit retrace exit (giveback limit)
 *   5. Scale-out rules (partial close at milestones)
 *   6. Winner-never-to-red lock
 *   7. Profit-lock ladder (progressive stop tightening)
 *   8. Auto breakeven (first stop move)
 */
export function evaluateExecutionRules(
  trade: TradeState,
  config: ExecutionConfig
): EngineAction[] {
  const actions: EngineAction[] = [];

  // --- 1. DAILY PROFIT CAP ---
  if (config.daily_profit_cap_usd != null && config.daily_profit_cap_action === 'close_all_and_pause') {
    if (trade.daily_realized_pnl_usd >= config.daily_profit_cap_usd) {
      actions.push({
        action: 'close_full',
        rule_type: 'daily_cap_reached',
        reason: `Daily P&L $${trade.daily_realized_pnl_usd.toFixed(0)} >= cap $${config.daily_profit_cap_usd}`,
        details: { daily_pnl: trade.daily_realized_pnl_usd, cap: config.daily_profit_cap_usd }
      });
      actions.push({
        action: 'pause_trading',
        rule_type: 'daily_cap_reached',
        reason: `Daily cap reached — trading paused until next session`,
        details: { daily_pnl: trade.daily_realized_pnl_usd, cap: config.daily_profit_cap_usd }
      });
      return actions; // trumps everything else
    }
  }

  // --- 2. TIME STOP ---
  if (config.time_stop) {
    const daysInTrade = daysBetween(trade.entry_time, trade.current_time);
    if (daysInTrade >= config.time_stop.max_days_in_trade) {
      const currentPnlPct = ((trade.current_price - trade.entry_price) / trade.entry_price) * 100 *
        (trade.direction === 'long' ? 1 : -1);
      if (currentPnlPct <= config.time_stop.max_loss_pct) {
        actions.push({
          action: 'close_full',
          rule_type: 'time_stop_triggered',
          reason: `${daysInTrade} days in trade, P&L ${currentPnlPct.toFixed(1)}% <= ${config.time_stop.max_loss_pct}%`,
          details: { days: daysInTrade, pnl_pct: currentPnlPct, threshold: config.time_stop.max_loss_pct }
        });
        return actions; // kill switch — nothing else matters
      }
    }
  }

  // --- 3. GREEN-TO-RED PROTECTION ---
  if (config.green_to_red_protection) {
    const gtr = config.green_to_red_protection;
    // Only active if trade HAS reached the trigger level at some point
    if (trade.peak_r >= gtr.trigger_r && trade.current_r <= gtr.floor_r) {
      if (gtr.action === 'close_market') {
        actions.push({
          action: 'close_full',
          rule_type: 'green_to_red_exit',
          reason: `Peak was ${trade.peak_r.toFixed(2)}R (>= ${gtr.trigger_r}R trigger), dropped to ${trade.current_r.toFixed(2)}R (<= ${gtr.floor_r}R floor)`,
          details: { peak_r: trade.peak_r, current_r: trade.current_r, trigger_r: gtr.trigger_r, floor_r: gtr.floor_r }
        });
        return actions;
      } else {
        // move_stop — set stop to entry (breakeven)
        const beStop = trade.entry_price;
        if (isBetterStop(beStop, trade.stop_price, trade.direction)) {
          actions.push({
            action: 'move_stop',
            rule_type: 'green_to_red_exit',
            new_stop: beStop,
            reason: `Green-to-red protection: moving stop to entry`,
            details: { peak_r: trade.peak_r, current_r: trade.current_r, old_stop: trade.stop_price, new_stop: beStop }
          });
        }
      }
    }
  }

  // --- 4. PROFIT RETRACE EXIT ---
  if (config.profit_retrace_exit) {
    const pre = config.profit_retrace_exit;
    if (trade.peak_r >= pre.peak_r) {
      const givebackR = trade.peak_r - trade.current_r;
      if (givebackR >= pre.giveback_r) {
        actions.push({
          action: 'close_full',
          rule_type: 'profit_retrace_exit',
          reason: `Peak ${trade.peak_r.toFixed(2)}R, current ${trade.current_r.toFixed(2)}R, giveback ${givebackR.toFixed(2)}R >= ${pre.giveback_r}R limit`,
          details: { peak_r: trade.peak_r, current_r: trade.current_r, giveback_r: givebackR, limit_r: pre.giveback_r }
        });
        return actions;
      }
    }
  }

  // --- 5. SCALE-OUT RULES (options / multi-contract) ---
  if (config.scale_out_rules && config.scale_out_rules.length > 0 && trade.original_size > 1) {
    // Current multiple = current_price / entry_price for options value
    const currentMultiple = trade.current_price / trade.entry_price;
    // Sort descending so we check highest milestone first
    const sortedRules = [...config.scale_out_rules].sort((a, b) => b.at_multiple - a.at_multiple);
    for (const rule of sortedRules) {
      if (currentMultiple >= rule.at_multiple && trade.position_size > 1) {
        // Check if this level's scale-out has already been partially fulfilled
        // (caller tracks this — engine just says "you should close X% now")
        actions.push({
          action: 'close_partial',
          rule_type: 'scale_out_triggered',
          close_pct: rule.pct_close,
          reason: `Position at ${currentMultiple.toFixed(1)}x >= ${rule.at_multiple}x milestone — close ${(rule.pct_close * 100).toFixed(0)}%`,
          details: { current_multiple: currentMultiple, milestone: rule.at_multiple, pct: rule.pct_close }
        });
        break; // only trigger the highest applicable milestone per evaluation
      }
    }
  }

  // --- 6. WINNER-NEVER-TO-RED LOCK ---
  if (config.winner_never_to_red_r != null) {
    if (trade.peak_r >= config.winner_never_to_red_r) {
      // Stop must be >= entry
      const entryStop = trade.entry_price;
      if (isBetterStop(entryStop, trade.stop_price, trade.direction)) {
        actions.push({
          action: 'move_stop',
          rule_type: 'winner_lock_triggered',
          new_stop: entryStop,
          reason: `Peak ${trade.peak_r.toFixed(2)}R >= ${config.winner_never_to_red_r}R — stop locked at entry minimum`,
          details: { peak_r: trade.peak_r, threshold_r: config.winner_never_to_red_r, old_stop: trade.stop_price, new_stop: entryStop }
        });
      }
    }
  }

  // --- 7. PROFIT-LOCK LADDER (with dynamic extension) ---
  if (config.lock_in_r_ladder && config.lock_in_r_ladder.length > 0) {
    // Build the full ladder: defined rungs + auto-extended rungs
    const definedLadder = [...config.lock_in_r_ladder];
    const highestDefined = definedLadder.reduce((max, r) => r.at_r > max.at_r ? r : max, definedLadder[0]);
    const ladderGap = highestDefined.at_r - highestDefined.lock_r; // e.g. at:4, lock:3 → gap=1

    // Auto-extend: for every whole R above the highest defined rung, add a new rung
    const maxRung = Math.floor(trade.current_r);
    for (let at = highestDefined.at_r + 1; at <= maxRung; at++) {
      definedLadder.push({ at_r: at, lock_r: at - ladderGap });
    }

    // Sort descending by at_r so we find the highest applicable rung
    const sortedLadder = definedLadder.sort((a, b) => b.at_r - a.at_r);
    for (const rung of sortedLadder) {
      if (trade.current_r >= rung.at_r) {
        const lockPrice = rToPrice(rung.lock_r, trade.entry_price, trade.stop_distance, trade.direction);
        if (isBetterStop(lockPrice, trade.stop_price, trade.direction)) {
          actions.push({
            action: 'move_stop',
            rule_type: 'ladder_lock_triggered',
            new_stop: lockPrice,
            reason: `At ${trade.current_r.toFixed(2)}R >= ${rung.at_r}R — locking ${rung.lock_r}R profit`,
            details: { current_r: trade.current_r, rung_at: rung.at_r, rung_lock: rung.lock_r, old_stop: trade.stop_price, new_stop: lockPrice }
          });
        }
        break; // only the highest applicable rung
      }
    }
  }

  // --- 8. AUTO BREAKEVEN ---
  if (config.auto_breakeven_r != null) {
    if (trade.current_r >= config.auto_breakeven_r) {
      const beStop = trade.entry_price;
      if (isBetterStop(beStop, trade.stop_price, trade.direction)) {
        actions.push({
          action: 'move_stop',
          rule_type: 'breakeven_triggered',
          new_stop: beStop,
          reason: `At ${trade.current_r.toFixed(2)}R >= ${config.auto_breakeven_r}R — moving stop to breakeven`,
          details: { current_r: trade.current_r, trigger_r: config.auto_breakeven_r, old_stop: trade.stop_price, new_stop: beStop }
        });
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Helpers for the next-trigger display on trade cards
// ---------------------------------------------------------------------------

export interface NextTrigger {
  rule_type: RuleEventType;
  trigger_r: number;       // R level that triggers this rule
  description: string;     // human-readable, e.g. "BE at +1R"
  is_active: boolean;      // has the condition already been met?
}

/**
 * Given a trade's current state and execution config, return the list of
 * upcoming rule triggers sorted by closest to current R.
 */
export function getNextTriggers(
  trade: TradeState,
  config: ExecutionConfig
): NextTrigger[] {
  const triggers: NextTrigger[] = [];

  // Auto breakeven
  if (config.auto_breakeven_r != null) {
    triggers.push({
      rule_type: 'breakeven_triggered',
      trigger_r: config.auto_breakeven_r,
      description: `BE at +${config.auto_breakeven_r}R`,
      is_active: trade.current_r >= config.auto_breakeven_r
    });
  }

  // Ladder rungs
  if (config.lock_in_r_ladder) {
    for (const rung of config.lock_in_r_ladder) {
      triggers.push({
        rule_type: 'ladder_lock_triggered',
        trigger_r: rung.at_r,
        description: `Lock +${rung.lock_r}R at +${rung.at_r}R`,
        is_active: trade.current_r >= rung.at_r
      });
    }
  }

  // Green-to-red
  if (config.green_to_red_protection) {
    const gtr = config.green_to_red_protection;
    triggers.push({
      rule_type: 'green_to_red_exit',
      trigger_r: gtr.trigger_r,
      description: `G2R: arm at +${gtr.trigger_r}R, floor +${gtr.floor_r}R`,
      is_active: trade.peak_r >= gtr.trigger_r
    });
  }

  // Profit retrace
  if (config.profit_retrace_exit) {
    const pre = config.profit_retrace_exit;
    triggers.push({
      rule_type: 'profit_retrace_exit',
      trigger_r: pre.peak_r,
      description: `Retrace exit: arm at +${pre.peak_r}R, max giveback ${pre.giveback_r}R`,
      is_active: trade.peak_r >= pre.peak_r
    });
  }

  // Winner never to red
  if (config.winner_never_to_red_r != null) {
    triggers.push({
      rule_type: 'winner_lock_triggered',
      trigger_r: config.winner_never_to_red_r,
      description: `Lock entry at +${config.winner_never_to_red_r}R`,
      is_active: trade.peak_r >= config.winner_never_to_red_r
    });
  }

  // Sort: active rules first, then by trigger_r ascending
  triggers.sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.trigger_r - b.trigger_r;
  });

  return triggers;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Convert an R value to a price level */
function rToPrice(r: number, entryPrice: number, stopDistance: number, direction: 'long' | 'short'): number {
  if (direction === 'long') {
    return entryPrice + (r * stopDistance);
  } else {
    return entryPrice - (r * stopDistance);
  }
}

/** Check if a proposed stop is "better" (tighter / more protective) than the current stop */
function isBetterStop(proposed: number, current: number, direction: 'long' | 'short'): boolean {
  if (direction === 'long') {
    return proposed > current;   // higher stop = more protective for longs
  } else {
    return proposed < current;   // lower stop = more protective for shorts
  }
}

/** Calculate R-multiple for a given price */
export function calculateR(
  currentPrice: number,
  entryPrice: number,
  stopDistance: number,
  direction: 'long' | 'short'
): number {
  if (stopDistance === 0) return 0;
  if (direction === 'long') {
    return (currentPrice - entryPrice) / stopDistance;
  } else {
    return (entryPrice - currentPrice) / stopDistance;
  }
}

/** Days between two ISO datetime strings */
function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// V1 Default Rule Sets
// ---------------------------------------------------------------------------

/** Default futures execution rules (1 contract, $500/day target) */
export const FUTURES_V1_EXECUTION: ExecutionConfig = {
  auto_breakeven_r: 1.0,
  lock_in_r_ladder: [
    { at_r: 2, lock_r: 1 },
    { at_r: 3, lock_r: 2 },
    { at_r: 4, lock_r: 3 },
  ],
  green_to_red_protection: {
    trigger_r: 1.5,
    floor_r: 0.25,
    action: 'close_market',
  },
  daily_profit_cap_usd: 500,
  daily_profit_cap_action: 'close_all_and_pause',
  production_lock: true,
};

/** Default options execution rules (multi-contract, scale-out) */
export const OPTIONS_V1_EXECUTION: ExecutionConfig = {
  scale_out_rules: [
    { at_multiple: 2.0, pct_close: 0.50 },
    { at_multiple: 3.0, pct_close: 0.25 },
  ],
  winner_never_to_red_r: 3.0,
  time_stop: {
    max_days_in_trade: 10,
    max_loss_pct: -40,
    action: 'close_market',
  },
  profit_retrace_exit: {
    peak_r: 2.0,
    giveback_r: 1.0,
    action: 'close_market',
  },
  production_lock: true,
};
