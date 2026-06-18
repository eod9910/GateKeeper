import assert from 'assert';
import { resolveForward } from './forwardResolver';

function runTests(): void {
  const bars = [
    { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
    { time: '2025-01-02', open: 100, high: 105, low: 99, close: 104 },
    { time: '2025-01-03', open: 104, high: 106, low: 101, close: 105 },
    { time: '2025-01-04', open: 105, high: 106, low: 94, close: 95 },
  ];

  const longWin = resolveForward({
    bars,
    side: 'long',
    entry: 100,
    stop: 95,
    takeProfit: 105,
    startIndex: 0,
  });
  assert.equal(longWin.entryHit, true);
  assert.equal(longWin.entryBarIndex, 1);
  assert.equal(longWin.exitReason, 'tp_hit');
  assert.equal(longWin.exitPrice, 105);
  assert.equal(longWin.barsHeld, 0);
  assert.equal(longWin.rMultiple, 1);

  const sameBarTie = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 106, low: 94, close: 102 },
    ],
    side: 'long',
    entry: 100,
    stop: 95,
    takeProfit: 105,
    startIndex: 0,
  });
  assert.equal(sameBarTie.exitReason, 'sl_hit');
  assert.equal(sameBarTie.exitPrice, 95);

  const shortTimeStop = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 100.5, low: 98.8, close: 99.5 },
      { time: '2025-01-03', open: 99.5, high: 100.2, low: 98.9, close: 99.2 },
    ],
    side: 'short',
    entry: 100,
    stop: 103,
    takeProfit: 94,
    startIndex: 0,
    maxHoldBars: 2,
  });
  assert.equal(shortTimeStop.exitReason, 'time_stop');
  assert.equal(shortTimeStop.exitBarIndex, 2);
  assert.ok(shortTimeStop.rMultiple > 0);

  const noFill = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 101, high: 103, low: 100.5, close: 102.5 },
      { time: '2025-01-03', open: 102.5, high: 104, low: 102, close: 103.5 },
    ],
    side: 'long',
    entry: 98,
    stop: 94,
    takeProfit: 108,
    startIndex: 0,
  });
  assert.equal(noFill.entryHit, false);
  assert.equal(noFill.exitReason, 'no_fill');
  assert.equal(noFill.barsHeld, 0);

  const targetFirstTie = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 106, low: 94, close: 102 },
    ],
    side: 'long',
    entry: 100,
    stop: 95,
    takeProfit: 105,
    startIndex: 0,
    tieBreakPolicy: 'target_first',
  });
  assert.equal(targetFirstTie.exitReason, 'tp_hit');
  assert.equal(targetFirstTie.exitPrice, 105);

  const approx = (actual: number, expected: number, eps = 1e-6): boolean => Math.abs(actual - expected) <= eps;

  // ── 3-tranche scale-out with ratcheting stop ──────────────────────────
  // entry 100, stop 90 (risk 10R unit), TP1 110 (1R), TP2 120 (2R), TP3 130 (3R)
  // All three TPs hit on separate bars; the ratcheted stop never trips.
  const threeTpAllHit = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 110, low: 99, close: 109 }, // fill + TP1 → stop to 105
      { time: '2025-01-03', open: 110, high: 120, low: 106, close: 119 }, // TP2 → stop to 115
      { time: '2025-01-04', open: 120, high: 130, low: 116, close: 129 }, // TP3 → done
    ],
    side: 'long',
    entry: 100,
    stop: 90,
    takeProfit: 110,
    takeProfit2: 120,
    takeProfit3: 130,
    startIndex: 0,
  });
  assert.equal(threeTpAllHit.trancheCount, 3);
  assert.equal(threeTpAllHit.exitReason, 'tp_hit');
  assert.equal(threeTpAllHit.tp2?.hit, true);
  assert.equal(threeTpAllHit.tp3?.hit, true);
  assert.equal(threeTpAllHit.tranches?.length, 3);
  assert.ok(approx(threeTpAllHit.rMultiple, 2), `expected blended 2R, got ${threeTpAllHit.rMultiple}`); // (1+2+3)/3

  // After TP1 the stop ratchets to midpoint(entry, TP1)=105; a pullback to 105
  // closes the remaining two tranches there (a profitable trailing stop).
  const trailAfterTp1 = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 110, low: 99, close: 109 }, // fill + TP1 → stop to 105
      { time: '2025-01-03', open: 109, high: 106, low: 104, close: 105 }, // pull back through 105 → trail stop
    ],
    side: 'long',
    entry: 100,
    stop: 90,
    takeProfit: 110,
    takeProfit2: 120,
    takeProfit3: 130,
    startIndex: 0,
  });
  assert.equal(trailAfterTp1.exitReason, 'tp_hit'); // TP1 was reached
  assert.equal(trailAfterTp1.tp2?.hit, false);
  assert.equal(trailAfterTp1.tp3?.hit, false);
  assert.equal(trailAfterTp1.exitPrice, 105);
  // blended: TP1 (1R) on 1/3 + trail (0.5R) on 2/3 = 1/3 + 1/3 = 2/3
  assert.ok(approx(trailAfterTp1.rMultiple, 2 / 3), `expected 0.667R, got ${trailAfterTp1.rMultiple}`);

  // A single engulfing bar that blows through all three TPs counts them all.
  const engulfAllTp = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 135, low: 99, close: 134 },
    ],
    side: 'long',
    entry: 100,
    stop: 90,
    takeProfit: 110,
    takeProfit2: 120,
    takeProfit3: 130,
    startIndex: 0,
  });
  assert.equal(engulfAllTp.exitReason, 'tp_hit');
  assert.equal(engulfAllTp.tp2?.hit, true);
  assert.equal(engulfAllTp.tp3?.hit, true);
  assert.equal(engulfAllTp.barsHeld, 0);
  assert.ok(approx(engulfAllTp.rMultiple, 2), `expected blended 2R, got ${engulfAllTp.rMultiple}`);

  // Initial stop hit before TP1 closes the whole position (all tranches) at stop.
  const stopBeforeTp1 = resolveForward({
    bars: [
      { time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 },
      { time: '2025-01-02', open: 100, high: 101, low: 100, close: 100.5 }, // fill
      { time: '2025-01-03', open: 100, high: 101, low: 89, close: 90 }, // stop 90 hit
    ],
    side: 'long',
    entry: 100,
    stop: 90,
    takeProfit: 110,
    takeProfit2: 120,
    takeProfit3: 130,
    startIndex: 0,
  });
  assert.equal(stopBeforeTp1.exitReason, 'sl_hit');
  assert.equal(stopBeforeTp1.exitPrice, 90);
  assert.equal(stopBeforeTp1.tp2?.hit, false);
  assert.ok(approx(stopBeforeTp1.rMultiple, -1), `expected -1R, got ${stopBeforeTp1.rMultiple}`);

  assert.throws(() => resolveForward({
    bars,
    side: 'long',
    entry: 100,
    stop: 100,
    takeProfit: 105,
    startIndex: 0,
  }), /zero or negative risk/i);

  assert.throws(() => resolveForward({
    bars: [{ time: '2025-01-01', open: 100, high: 101, low: 99, close: 100 }],
    side: 'long',
    entry: 100,
    stop: 95,
    takeProfit: 105,
    startIndex: 0,
  }), /At least two bars/i);
}

runTests();
console.log('forwardResolver tests passed');
