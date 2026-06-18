import { FibAdverseExcursion, FibTradeExcursion, ForwardResolution, ForwardTieBreakPolicy, TpLevelResult, TrancheExit, TrainingBar, TrainingDrawing, TrainingSide } from '../../types';

export const FORWARD_RESOLVER_VERSION = 'v3-tranche-trail';

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
  fibDrawing?: TrainingDrawing;
}

function computeRisk(side: TrainingSide, entry: number, stop: number): number {
  return side === 'long' ? entry - stop : stop - entry;
}

function computeRMultiple(side: TrainingSide, entry: number, exitPrice: number, riskPerUnit: number): number {
  if (riskPerUnit <= 0) return 0;
  const pnlPerUnit = side === 'long' ? exitPrice - entry : entry - exitPrice;
  return pnlPerUnit / riskPerUnit;
}

function roundFib(value: number): number {
  return Math.round(value * 10) / 10;
}

function fibPctForPrice(price: number, price0: number, price100: number): number {
  const range = price100 - price0;
  if (!Number.isFinite(range) || range === 0) return NaN;
  return ((price - price0) / range) * 100;
}

function managePctForPrice(side: TrainingSide, price: number, entry: number, target: number): number {
  const targetDistance = Math.abs(target - entry);
  if (!Number.isFinite(targetDistance) || targetDistance === 0) return NaN;
  const signedMove = side === 'long' ? price - entry : entry - price;
  return (signedMove / targetDistance) * 100;
}

function computeFibTradeExcursion(params: {
  bars: TrainingBar[];
  side: TrainingSide;
  entry: number;
  entryFillIndex: number;
  finalExitIndex: number;
  fibDrawing?: TrainingDrawing;
}): FibTradeExcursion | undefined {
  const fib = params.fibDrawing;
  if (!fib || fib.type !== 'fib') return undefined;

  const raw0 = Number(fib.price);
  const raw100 = Number(fib.price2);
  const entry = Number(params.entry);
  if (!Number.isFinite(raw0) || !Number.isFinite(raw100) || raw0 === raw100 || !Number.isFinite(entry)) {
    return undefined;
  }

  const targetPrice = Number.isFinite(Number(fib.targetPrice))
    ? Number(fib.targetPrice)
    : (params.side === 'long' ? Math.max(raw0, raw100) : Math.min(raw0, raw100));
  const targetDistance = Math.abs(targetPrice - entry);
  if (!Number.isFinite(targetPrice) || targetDistance <= 0) return undefined;

  const structureStopPrice = params.side === 'long' ? Math.min(raw0, raw100) : Math.max(raw0, raw100);
  const structureStopPct = managePctForPrice(params.side, structureStopPrice, entry, targetPrice);

  let adversePrice = entry;
  let favorablePrice = entry;
  let adverseBarIndex = params.entryFillIndex;
  let favorableBarIndex = params.entryFillIndex;

  for (let index = params.entryFillIndex; index <= params.finalExitIndex; index += 1) {
    const bar = params.bars[index];
    if (!bar) continue;

    const adverseCandidate = params.side === 'long' ? Number(bar.low) : Number(bar.high);
    if (Number.isFinite(adverseCandidate) && (params.side === 'long' ? adverseCandidate < adversePrice : adverseCandidate > adversePrice)) {
      adversePrice = adverseCandidate;
      adverseBarIndex = index;
    }

    const favorableCandidate = params.side === 'long' ? Number(bar.high) : Number(bar.low);
    if (Number.isFinite(favorableCandidate) && (params.side === 'long' ? favorableCandidate > favorablePrice : favorableCandidate < favorablePrice)) {
      favorablePrice = favorableCandidate;
      favorableBarIndex = index;
    }
  }

  const maxAdversePct = managePctForPrice(params.side, adversePrice, entry, targetPrice);
  const maxFavorablePct = managePctForPrice(params.side, favorablePrice, entry, targetPrice);
  if (!Number.isFinite(maxAdversePct) || !Number.isFinite(maxFavorablePct)) return undefined;

  return {
    entryPrice: entry,
    targetPrice,
    targetDistance,
    structureStopPrice,
    structureStopPct: Number.isFinite(structureStopPct) ? roundFib(structureStopPct) : undefined,
    maxAdversePct: roundFib(Math.min(0, maxAdversePct)),
    maxFavorablePct: roundFib(Math.max(0, maxFavorablePct)),
    adversePrice,
    favorablePrice,
    adverseBarIndex,
    favorableBarIndex,
    adverseBarTime: params.bars[adverseBarIndex]?.time || '',
    favorableBarTime: params.bars[favorableBarIndex]?.time || '',
    reached25: maxFavorablePct >= 25,
    reached50: maxFavorablePct >= 50,
    reached75: maxFavorablePct >= 75,
    reached100: maxFavorablePct >= 100,
    brokeEntry: maxAdversePct < -0.05,
  };
}

function computeFibAdverseExcursion(params: {
  bars: TrainingBar[];
  side: TrainingSide;
  entry: number;
  entryFillIndex: number;
  finalExitIndex: number;
  fibDrawing?: TrainingDrawing;
}): FibAdverseExcursion | undefined {
  const fib = params.fibDrawing;
  if (!fib || fib.type !== 'fib') return undefined;

  const raw0 = Number(fib.price);
  const raw100 = Number(fib.price2);
  if (!Number.isFinite(raw0) || !Number.isFinite(raw100) || raw0 === raw100) return undefined;

  const price0 = params.side === 'long' ? Math.max(raw0, raw100) : Math.min(raw0, raw100);
  const price100 = params.side === 'long' ? Math.min(raw0, raw100) : Math.max(raw0, raw100);
  const entryFibPct = fibPctForPrice(params.entry, price0, price100);
  if (!Number.isFinite(entryFibPct)) return undefined;

  let adversePrice = params.entry;
  let adverseIndex = params.entryFillIndex;
  for (let index = params.entryFillIndex; index <= params.finalExitIndex; index += 1) {
    const bar = params.bars[index];
    if (!bar) continue;
    const candidate = params.side === 'long' ? Number(bar.low) : Number(bar.high);
    if (!Number.isFinite(candidate)) continue;
    if (params.side === 'long' ? candidate < adversePrice : candidate > adversePrice) {
      adversePrice = candidate;
      adverseIndex = index;
    }
  }

  const maxAdverseFibPct = fibPctForPrice(adversePrice, price0, price100);
  if (!Number.isFinite(maxAdverseFibPct)) return undefined;
  const adverseFromEntryPct = Math.max(0, maxAdverseFibPct - entryFibPct);
  const bucket: FibAdverseExcursion['bucket'] =
    adverseFromEntryPct <= 0.05 ? 'none'
      : maxAdverseFibPct > 100.05 ? 'beyond_100'
        : maxAdverseFibPct >= 88 ? 'to_100'
          : 'to_88';

  return {
    entryFibPct: roundFib(entryFibPct),
    maxAdverseFibPct: roundFib(maxAdverseFibPct),
    adverseFromEntryPct: roundFib(adverseFromEntryPct),
    price: adversePrice,
    barIndex: adverseIndex,
    barTime: params.bars[adverseIndex]?.time || '',
    bucket,
  };
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
    fibDrawing,
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

  const lastIndex = maxHoldBars != null
    ? Math.min(bars.length - 1, startIndex + Math.max(1, maxHoldBars))
    : bars.length - 1;

  // The position is divided into N equal tranches — one per defined take-profit
  // (1, 2, or 3). Each TP closes a single tranche; the shared stop ratchets up
  // after every TP fill. If the (ratcheted) stop is reached, all remaining open
  // tranches close there. The reported result is the size-weighted (blended) R.
  const hasTp2 = takeProfit2 != null && takeProfit2 > 0;
  const hasTp3 = takeProfit3 != null && takeProfit3 > 0;
  let tpLevels = [takeProfit, takeProfit2, takeProfit3]
    .filter((lvl): lvl is number => typeof lvl === 'number' && Number.isFinite(lvl) && lvl > 0);
  if (tpLevels.length === 0) tpLevels = [takeProfit];
  const trancheCount = tpLevels.length;
  const trancheFraction = 1 / trancheCount;
  const tpKeyFor = (idx: number): TrancheExit['exitReason'] => (idx === 0 ? 'tp1' : idx === 1 ? 'tp2' : 'tp3');

  // ── Entry-fill detection ──────────────────────────────────────────────
  // 'touch' — fill as soon as bar range includes entry price
  // 'first_reclaim' — bar must touch entry, then a subsequent bar must close
  //   back on the favorable side (above entry for long, below for short)
  // 'close_back_through' — bar must close beyond entry on the favorable side
  let entryHit = false;
  let entryFillIndex = -1;
  let entryFillTime = '';
  let entryTouchedOnce = false;
  let noFillBar: TrainingBar | null = null;
  let noFillIndex = -1;

  for (let index = startIndex + 1; index <= lastIndex; index += 1) {
    const bar = bars[index];
    const barTouchesEntry = side === 'long'
      ? bar.low <= entry && bar.high >= entry
      : bar.high >= entry && bar.low <= entry;

    let filled = false;
    if (entryModel === 'close_back_through') {
      filled = side === 'long'
        ? bar.close >= entry && bar.low <= entry
        : bar.close <= entry && bar.high >= entry;
    } else if (entryModel === 'first_reclaim') {
      if (!entryTouchedOnce) {
        entryTouchedOnce = barTouchesEntry;
      } else {
        filled = side === 'long' ? bar.close >= entry : bar.close <= entry;
      }
    } else {
      filled = barTouchesEntry;
    }

    if (filled) {
      entryHit = true;
      entryFillIndex = index;
      entryFillTime = bar.time;
      break;
    }

    // If price reaches TP1 before entry fills, the setup is invalidated.
    const tpReachedWithoutEntry = side === 'long' ? bar.high >= takeProfit : bar.low <= takeProfit;
    if (tpReachedWithoutEntry || index === lastIndex) {
      noFillBar = bar;
      noFillIndex = index;
      break;
    }
  }

  if (!entryHit) {
    const bar = noFillBar || bars[lastIndex];
    const idx = noFillIndex >= 0 ? noFillIndex : lastIndex;
    const rMultiple = computeRMultiple(side, entry, bar.close, riskPerUnit);
    const pnlAbs = side === 'long' ? bar.close - entry : entry - bar.close;
    return {
      entryHit: false,
      exitReason: 'no_fill',
      exitPrice: bar.close,
      exitBarIndex: idx,
      exitBarTime: bar.time,
      barsHeld: 0,
      rMultiple,
      pnlAbs,
      pnlPct: entry ? (pnlAbs / entry) * 100 : 0,
      mae: 0,
      mfe: 0,
      resolverVersion: FORWARD_RESOLVER_VERSION,
      trancheCount,
      blendedRMultiple: rMultiple,
      tranches: [],
      tp2: hasTp2 ? { hit: false } : undefined,
      tp3: hasTp3 ? { hit: false } : undefined,
    };
  }

  // ── Tranche ladder with ratcheting stop ───────────────────────────────
  let currentStop = stop;
  let prevLevelForStop = entry; // stop after tpLevels[k] = midpoint(prevLevelForStop, tpLevels[k])
  let nextTpIdx = 0;
  let openTranches = trancheCount;
  let tp1Reached = false;
  let stopOrTimeReason: 'sl_hit' | 'time_stop' = 'time_stop';
  const tranches: TrancheExit[] = [];

  let mfe = Number.NEGATIVE_INFINITY;
  let mae = Number.POSITIVE_INFINITY;
  let finalExitPrice = bars[lastIndex].close;
  let finalExitIndex = lastIndex;
  let finalExitTime = bars[lastIndex].time;

  for (let index = entryFillIndex; index <= lastIndex && openTranches > 0; index += 1) {
    const bar = bars[index];

    const barMfe = side === 'long' ? (bar.high - entry) / riskPerUnit : (entry - bar.low) / riskPerUnit;
    const barMae = side === 'long' ? (bar.low - entry) / riskPerUnit : (entry - bar.high) / riskPerUnit;
    mfe = Math.max(mfe, barMfe);
    mae = Math.min(mae, barMae);

    // Stop is evaluated against its level coming INTO this bar (a ratchet that
    // moved up because of a TP filled on this same bar only applies next bar).
    const stopTouched = side === 'long' ? bar.low <= currentStop : bar.high >= currentStop;
    const nextTp = nextTpIdx < trancheCount ? tpLevels[nextTpIdx] : null;
    const nextTpTouched = nextTp != null && (side === 'long' ? bar.high >= nextTp : bar.low <= nextTp);

    // Same-bar conflict: stop wins unless the policy prefers the target.
    const stopWinsThisBar = stopTouched && (!nextTpTouched || tieBreakPolicy !== 'target_first');
    if (stopWinsThisBar) {
      const r = computeRMultiple(side, entry, currentStop, riskPerUnit);
      tranches.push({
        fraction: trancheFraction * openTranches,
        exitReason: tp1Reached ? 'trail_stop' : 'stop',
        exitPrice: currentStop,
        rMultiple: r,
        barIndex: index,
        barTime: bar.time,
      });
      finalExitPrice = currentStop;
      finalExitIndex = index;
      finalExitTime = bar.time;
      stopOrTimeReason = 'sl_hit';
      openTranches = 0;
      break;
    }

    // Fill every take-profit reached on this bar, in order (handles a single
    // bar that engulfs multiple TP levels). The stop ratchets after each fill.
    while (nextTpIdx < trancheCount && openTranches > 0) {
      const lvl = tpLevels[nextTpIdx];
      const reached = side === 'long' ? bar.high >= lvl : bar.low <= lvl;
      if (!reached) break;
      const r = computeRMultiple(side, entry, lvl, riskPerUnit);
      tranches.push({
        fraction: trancheFraction,
        exitReason: tpKeyFor(nextTpIdx),
        exitPrice: lvl,
        rMultiple: r,
        barIndex: index,
        barTime: bar.time,
      });
      if (nextTpIdx === 0) tp1Reached = true;
      currentStop = (prevLevelForStop + lvl) / 2; // ratchet to midpoint of prior level and this TP
      prevLevelForStop = lvl;
      openTranches -= 1;
      finalExitPrice = lvl;
      finalExitIndex = index;
      finalExitTime = bar.time;
      nextTpIdx += 1;
    }

    if (index === lastIndex && openTranches > 0) {
      const r = computeRMultiple(side, entry, bar.close, riskPerUnit);
      tranches.push({
        fraction: trancheFraction * openTranches,
        exitReason: 'time',
        exitPrice: bar.close,
        rMultiple: r,
        barIndex: index,
        barTime: bar.time,
      });
      finalExitPrice = bar.close;
      finalExitIndex = index;
      finalExitTime = bar.time;
      stopOrTimeReason = 'time_stop';
      openTranches = 0;
    }
  }

  // Size-weighted (blended) result across all tranches; fractions sum to 1.
  const blendedRMultiple = tranches.reduce((sum, t) => sum + t.rMultiple * t.fraction, 0);
  const pnlAbs = tranches.reduce((sum, t) => {
    const perUnit = side === 'long' ? t.exitPrice - entry : entry - t.exitPrice;
    return sum + perUnit * t.fraction;
  }, 0);
  const pnlPct = entry ? (pnlAbs / entry) * 100 : 0;

  // Overall exit reason: once TP1 is reached the attempt counts as a TP hit
  // (TP1 hit-rate keys off this); otherwise it's the stop/time outcome.
  const exitReason: ForwardResolution['exitReason'] = tp1Reached ? 'tp_hit' : stopOrTimeReason;

  const tpResultFor = (key: TrancheExit['exitReason']): TpLevelResult => {
    const t = tranches.find((x) => x.exitReason === key);
    return t
      ? { hit: true, barIndex: t.barIndex, barTime: t.barTime, rMultiple: t.rMultiple }
      : { hit: false };
  };
  const fibAdverseExcursion = computeFibAdverseExcursion({
    bars,
    side,
    entry,
    entryFillIndex,
    finalExitIndex,
    fibDrawing,
  });
  const fibTradeExcursion = computeFibTradeExcursion({
    bars,
    side,
    entry,
    entryFillIndex,
    finalExitIndex,
    fibDrawing,
  });

  return {
    entryHit: true,
    entryBarIndex: entryFillIndex,
    entryBarTime: entryFillTime,
    exitReason,
    exitPrice: finalExitPrice,
    exitBarIndex: finalExitIndex,
    exitBarTime: finalExitTime,
    barsHeld: Math.max(0, finalExitIndex - entryFillIndex),
    rMultiple: blendedRMultiple,
    pnlAbs,
    pnlPct,
    mae: Number.isFinite(mae) ? mae : 0,
    mfe: Number.isFinite(mfe) ? mfe : 0,
    resolverVersion: FORWARD_RESOLVER_VERSION,
    fibAdverseExcursion,
    fibTradeExcursion,
    trancheCount,
    blendedRMultiple,
    tranches,
    tp2: hasTp2 ? tpResultFor('tp2') : undefined,
    tp3: hasTp3 ? tpResultFor('tp3') : undefined,
  };
}
