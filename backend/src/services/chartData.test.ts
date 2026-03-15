import assert from 'assert';
import { detectIntradayBars, formatChartBars } from './chartData';

function testDetectIntradayBars(): void {
  assert.equal(detectIntradayBars([
    { timestamp: '2026-01-01 09:30:00', open: 1, high: 2, low: 1, close: 2 },
    { timestamp: '2026-01-01 10:30:00', open: 2, high: 3, low: 2, close: 3 },
  ]), true);

  assert.equal(detectIntradayBars([
    { timestamp: '2026-01-01', open: 1, high: 2, low: 1, close: 2 },
    { timestamp: '2026-01-02', open: 2, high: 3, low: 2, close: 3 },
  ]), false);
}

function testFormatChartBarsForDailyData(): void {
  const result = formatChartBars([
    { timestamp: '2026-01-01', open: 1, high: 2, low: 0.5, close: 1.5 },
    { timestamp: '2026-01-02', open: 1.5, high: 2.5, low: 1, close: 2 },
  ]);

  assert.deepEqual(result.map((bar) => bar.time), ['2026-01-01', '2026-01-02']);
  assert.equal(result[0].open, 1);
  assert.equal(result[1].close, 2);
}

function testFormatChartBarsForIntradayData(): void {
  const result = formatChartBars([
    { timestamp: '2026-01-01 09:30:00', open: 10, high: 11, low: 9.5, close: 10.5 },
    { timestamp: '2026-01-01 13:30:00', open: 10.5, high: 12, low: 10, close: 11.5 },
  ]);

  assert.equal(typeof result[0].time, 'number');
  assert.equal(typeof result[1].time, 'number');
  assert.ok((result[1].time as number) > (result[0].time as number));
}

function runTests(): void {
  testDetectIntradayBars();
  testFormatChartBarsForDailyData();
  testFormatChartBarsForIntradayData();
}

runTests();
console.log('chartData tests passed');
