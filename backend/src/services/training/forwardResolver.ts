import { ForwardResolution, ForwardTieBreakPolicy, TrainingBar, TrainingSide } from '../../types';

export const FORWARD_RESOLVER_VERSION = 'v1-stop-first';

export interface ForwardResolverInput {
  bars: TrainingBar[];
  side: TrainingSide;
  entry: number;
  stop: number;
  takeProfit: number;
  startIndex: number;
  maxHoldBars?: number;
  tieBreakPolicy?: ForwardTieBreakPolicy;
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
    startIndex,
    maxHoldBars,
    tieBreakPolicy = 'stop_first',
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

  for (let index = startIndex + 1; index <= lastIndex; index += 1) {
    const bar = bars[index];
    if (!entryHit) {
      const entryTouched = side === 'long'
        ? bar.low <= entry && bar.high >= entry
        : bar.high >= entry && bar.low <= entry;
      if (!entryTouched) {
        if (index === lastIndex) {
          exitReason = 'no_fill';
          exitPrice = bar.close;
          exitBarIndex = index;
          exitBarTime = bar.time;
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
  };
}
