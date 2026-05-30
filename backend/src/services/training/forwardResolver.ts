import { ForwardResolution, ForwardTieBreakPolicy, TpLevelResult, TrainingBar, TrainingSide } from '../../types';

export const FORWARD_RESOLVER_VERSION = 'v2-multi-tp';

export type EntryModel = 'touch' | 'first_reclaim' | 'close_back_through';

export interface ForwardResolverInput {
  bars: TrainingBar[];
  side: TrainingSide;
  entry: number;
  stop: number;
  takeProfit: number;
  takeProfit2?: number;
  takeProfit3?: number;
  startIndex: number;
  maxHoldBars?: number;
  tieBreakPolicy?: ForwardTieBreakPolicy;
  entryModel?: EntryModel;
}

function computeRisk(side: TrainingSide, entry: number, stop: number): number {
  return side === 'long' ? entry - stop : stop - entry;
}

function computeRMultiple(side: TrainingSide, entry: number, exitPrice: number, riskPerUnit: number): number {
  if (riskPerUnit <= 0) return 0;
  const pnlPerUnit = side === 'long' ? exitPrice - entry : entry - exitPrice;
  return pnlPerUnit / riskPerUnit;
}

export function resolveForward(input: ForwardResolverInput): ForwardResolution {
  const {
    bars,
    side,
    entry,
    stop,
    takeProfit,
    takeProfit2,
    takeProfit3,
    startIndex,
    maxHoldBars,
    tieBreakPolicy = 'stop_first',
    entryModel = 'touch',
  } = input;

  if (!Array.isArray(bars) || bars.length < 2) {
    throw new Error('At least two bars are required for forward resolution.');
  }
  if (startIndex < 0 || startIndex >= bars.length - 1) {
    throw new Error('startIndex must point to a bar with future data available.');
  }

  const riskPerUnit = computeRisk(side, entry, stop);
  if (!(riskPerUnit > 0)) {
    throw new Error('Entry and stop define zero or negative risk.');
  }

  let exitReason: ForwardResolution['exitReason'] = 'time_stop';
  let exitPrice = bars[bars.length - 1].close;
  let exitBarIndex = bars.length - 1;
  let exitBarTime = bars[bars.length - 1].time;
  let entryHit = false;
  let entryFillIndex = -1;
  let entryFillTime = '';
  let mfe = Number.NEGATIVE_INFINITY;
  let mae = Number.POSITIVE_INFINITY;
  const lastIndex = maxHoldBars != null
    ? Math.min(bars.length - 1, startIndex + Math.max(1, maxHoldBars))
    : bars.length - 1;

  // Entry model state tracking:
  // 'touch' — fill as soon as bar range includes entry price
  // 'first_reclaim' — bar must touch entry, then a subsequent bar must close
  //   back on the favorable side (above entry for long, below for short)
  // 'close_back_through' — bar must close beyond entry on the favorable side
  let entryTouchedOnce = false;

  for (let index = startIndex + 1; index <= lastIndex; index += 1) {
    const bar = bars[index];
    if (!entryHit) {
      const barTouchesEntry = side === 'long'
        ? bar.low <= entry && bar.high >= entry
        : bar.high >= entry && bar.low <= entry;

      let filled = false;

      if (entryModel === 'touch') {
        filled = barTouchesEntry;
      } else if (entryModel === 'close_back_through') {
        // Bar must close on the favorable side of the entry level
        filled = side === 'long'
          ? bar.close >= entry && bar.low <= entry
          : bar.close <= entry && bar.high >= entry;
      } else if (entryModel === 'first_reclaim') {
        if (!entryTouchedOnce) {
          // Phase 1: price must first touch or cross through the entry level
          entryTouchedOnce = barTouchesEntry;
        } else {
          // Phase 2: after the initial touch, a subsequent bar must close
          // back on the favorable side, confirming the level held
          filled = side === 'long' ? bar.close >= entry : bar.close <= entry;
        }
      } else {
        filled = barTouchesEntry;
      }

      if (!filled) {
        // If price reaches TP before entry fills, the setup is invalidated
        const tpReachedWithoutEntry = side === 'long'
          ? bar.high >= takeProfit
          : bar.low <= takeProfit;
        if (tpReachedWithoutEntry || index === lastIndex) {
          exitReason = 'no_fill';
          exitPrice = bar.close;
          exitBarIndex = index;
          exitBarTime = bar.time;
          break;
        }
        continue;
      }
      entryHit = true;
      entryFillIndex = index;
      entryFillTime = bar.time;
    }

    const barMfe = side === 'long' ? (bar.high - entry) / riskPerUnit : (entry - bar.low) / riskPerUnit;
    const barMae = side === 'long' ? (bar.low - entry) / riskPerUnit : (entry - bar.high) / riskPerUnit;
    mfe = Math.max(mfe, barMfe);
    mae = Math.min(mae, barMae);

    const stopTouched = side === 'long' ? bar.low <= stop : bar.high >= stop;
    const targetTouched = side === 'long' ? bar.high >= takeProfit : bar.low <= takeProfit;

    if (stopTouched && targetTouched) {
      exitReason = tieBreakPolicy === 'target_first' ? 'tp_hit' : 'sl_hit';
      exitPrice = exitReason === 'tp_hit' ? takeProfit : stop;
      exitBarIndex = index;
      exitBarTime = bar.time;
      break;
    }

    if (stopTouched) {
      exitReason = 'sl_hit';
      exitPrice = stop;
      exitBarIndex = index;
      exitBarTime = bar.time;
      break;
    }

    if (targetTouched) {
      exitReason = 'tp_hit';
      exitPrice = takeProfit;
      exitBarIndex = index;
      exitBarTime = bar.time;
      break;
    }

    if (index === lastIndex) {
      exitReason = 'time_stop';
      exitPrice = bar.close;
      exitBarIndex = index;
      exitBarTime = bar.time;
    }
  }

  const rMultiple = computeRMultiple(side, entry, exitPrice, riskPerUnit);
  const pnlAbs = side === 'long' ? exitPrice - entry : entry - exitPrice;
  const pnlPct = entry ? (pnlAbs / entry) * 100 : 0;

  // ── Multi-TP tracking ─────────────────────────────────────────────────
  // After TP1 fills, remaining partials move stop to breakeven (entry).
  // Continue scanning bars to see if TP2/TP3 are reached before price
  // returns to entry (breakeven stop-out).
  let tp2Result: TpLevelResult | undefined;
  let tp3Result: TpLevelResult | undefined;

  if (entryHit && exitReason === 'tp_hit') {
    const tp1ExitBar = exitBarIndex;
    const hasTp2 = takeProfit2 != null && takeProfit2 > 0;
    const hasTp3 = takeProfit3 != null && takeProfit3 > 0;

    if (hasTp2 || hasTp3) {
      let tp2Hit = false;
      let tp3Hit = false;
      const scanEnd = maxHoldBars != null
        ? Math.min(bars.length - 1, startIndex + Math.max(1, maxHoldBars))
        : bars.length - 1;

      for (let i = tp1ExitBar + 1; i <= scanEnd; i++) {
        const bar = bars[i];

        // Breakeven stop: if price returns to entry, remaining partials close
        const beStopHit = side === 'long' ? bar.low <= entry : bar.high >= entry;
        if (beStopHit) break;

        if (hasTp2 && !tp2Hit) {
          const hit = side === 'long' ? bar.high >= takeProfit2! : bar.low <= takeProfit2!;
          if (hit) {
            tp2Hit = true;
            const r2 = computeRMultiple(side, entry, takeProfit2!, riskPerUnit);
            tp2Result = { hit: true, barIndex: i, barTime: bar.time, rMultiple: r2 };
          }
        }
        if (hasTp3 && !tp3Hit) {
          const hit = side === 'long' ? bar.high >= takeProfit3! : bar.low <= takeProfit3!;
          if (hit) {
            tp3Hit = true;
            const r3 = computeRMultiple(side, entry, takeProfit3!, riskPerUnit);
            tp3Result = { hit: true, barIndex: i, barTime: bar.time, rMultiple: r3 };
          }
        }
        if ((!hasTp2 || tp2Hit) && (!hasTp3 || tp3Hit)) break;
      }

      if (hasTp2 && !tp2Result) tp2Result = { hit: false };
      if (hasTp3 && !tp3Result) tp3Result = { hit: false };
    }
  } else {
    // TP1 wasn't hit — TP2/TP3 are automatically not hit
    if (takeProfit2 != null && takeProfit2 > 0) tp2Result = { hit: false };
    if (takeProfit3 != null && takeProfit3 > 0) tp3Result = { hit: false };
  }

  return {
    entryHit,
    entryBarIndex: entryHit ? entryFillIndex : undefined,
    entryBarTime: entryHit ? entryFillTime : undefined,
    exitReason,
    exitPrice,
    exitBarIndex,
    exitBarTime,
    barsHeld: entryHit ? Math.max(0, exitBarIndex - entryFillIndex) : 0,
    rMultiple,
    pnlAbs,
    pnlPct,
    mae: Number.isFinite(mae) ? mae : 0,
    mfe: Number.isFinite(mfe) ? mfe : 0,
    resolverVersion: FORWARD_RESOLVER_VERSION,
    tp2: tp2Result,
    tp3: tp3Result,
  };
}
