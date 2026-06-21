import assert from 'assert';
import {
  buildCandidateSnapshot,
  summarizeChartStats,
} from './candidateSnapshot';

function testSummarizeChartStats() {
  const stats = summarizeChartStats([
    { close: 10 },
    { close: 12 },
    { close: '14' },
    { close: 'bad' },
  ]);

  assert.deepStrictEqual(stats, {
    bars: 3,
    minClose: 10,
    maxClose: 14,
    latestClose: 14,
    meanClose: 12,
    stdClose: Math.sqrt(8 / 3),
  });
  assert.strictEqual(summarizeChartStats([]), undefined);
  assert.strictEqual(summarizeChartStats([{ close: 'bad' }]), undefined);
}

function testBuildCandidateSnapshot() {
  const snapshot = buildCandidateSnapshot({
    candidate_id: 'candidate-1',
    symbol: 'SPY',
    timeframe: 'D',
    pattern_type: 'base_breakout',
    score: '0.82',
    entry_ready: true,
    base: {
      low: '100',
      high: 120,
      startIndex: '2',
      endIndex: 'bad',
    },
    rule_checklist: [
      { passed: true },
      { passed: false },
      { passed: 1 },
    ],
    chart_data: [{ close: 100 }, { close: 110 }],
  });

  assert.strictEqual(snapshot.id, 'candidate-1');
  assert.strictEqual(snapshot.symbol, 'SPY');
  assert.strictEqual(snapshot.score, 0.82);
  assert.strictEqual(snapshot.entryReady, true);
  assert.deepStrictEqual(snapshot.base, {
    low: 100,
    high: 120,
    startIndex: 2,
    endIndex: undefined,
  });
  assert.strictEqual(snapshot.checklistPassed, 2);
  assert.strictEqual(snapshot.checklistTotal, 3);
  assert.strictEqual(snapshot.chartStats?.latestClose, 110);
}

function main() {
  testSummarizeChartStats();
  testBuildCandidateSnapshot();
  console.log('candidateSnapshot tests passed');
}

main();
