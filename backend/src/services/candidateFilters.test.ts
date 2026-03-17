import assert from 'assert';
import {
  parseStrictBaseRequest,
  parseOnePerSymbolRequest,
  reduceOnePerSymbolCandidates,
  filterStrictBaseCandidates,
  extractSuiteReportFromOutput,
} from './candidateFilters';

function testStrictBaseParsing(): void {
  assert.deepEqual(parseStrictBaseRequest({}), { strictBase: true, strictBaseMinScore: 0.5 });
  assert.deepEqual(parseStrictBaseRequest({ strictBase: false, strictBaseMinScore: 2 }), {
    strictBase: false,
    strictBaseMinScore: 1,
  });
  assert.equal(parseOnePerSymbolRequest({}), true);
  assert.equal(parseOnePerSymbolRequest({ onePerSymbol: false }), false);
}

function testReduceOnePerSymbolKeepsBestAndNewestTie(): void {
  const reduced = reduceOnePerSymbolCandidates([
    { symbol: 'AAPL', score: 0.7, created_at: '2026-01-01T00:00:00Z' } as any,
    { symbol: 'AAPL', score: 0.9, created_at: '2026-01-01T01:00:00Z' } as any,
    { symbol: 'MSFT', score: 0.8, created_at: '2026-01-01T00:00:00Z' } as any,
    { symbol: 'MSFT', score: 0.8, created_at: '2026-01-01T02:00:00Z' } as any,
  ], true);

  assert.equal(reduced.length, 2);
  assert.equal(reduced[0].symbol, 'AAPL');
  assert.equal((reduced[0] as any).score, 0.9);
  assert.equal(reduced[1].symbol, 'MSFT');
  assert.equal((reduced[1] as any).created_at, '2026-01-01T02:00:00Z');
}

function testFilterStrictBaseCandidates(): void {
  const filtered = filterStrictBaseCandidates([
    {
      symbol: 'AAA',
      pattern_type: 'density_base_detector_v2_pattern',
      rule_checklist: [{ rule_name: 'base_detected', passed: true }],
      score: 0.4,
    } as any,
    {
      symbol: 'BBB',
      pattern_type: 'density_base_detector_v2_pattern',
      rule_checklist: [{ rule_name: 'base_detected', passed: false }],
      score: 0.9,
    } as any,
    {
      symbol: 'CCC',
      pattern_type: 'momentum_breakout',
      score: 0.2,
    } as any,
    {
      symbol: 'DDD',
      pattern_type: 'unknown_base_plugin',
      entry_ready: false,
      score: 0.8,
    } as any,
  ], true, 0.5);

  assert.deepEqual(filtered.map((row) => row.symbol), ['AAA', 'CCC']);
}

function testExtractSuiteReportFromMixedOutput(): void {
  const report = {
    suite_id: 'suite_123',
    method_aggregate: [{ method: 'base', hits: 4 }],
  };
  const parsed = extractSuiteReportFromOutput(`log line before json\n${JSON.stringify(report)}`);
  assert.deepEqual(parsed, report);
  assert.equal(extractSuiteReportFromOutput('plain logs only'), null);
}

function runTests(): void {
  testStrictBaseParsing();
  testReduceOnePerSymbolKeepsBestAndNewestTie();
  testFilterStrictBaseCandidates();
  testExtractSuiteReportFromMixedOutput();
}

runTests();
console.log('candidateFilters tests passed');
