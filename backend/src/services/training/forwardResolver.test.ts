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
