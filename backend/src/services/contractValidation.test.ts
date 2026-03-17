import assert from 'assert';
import {
  isValidScannerRunResult,
  isValidScannerUniverseResult,
  normalizeChartOhlcvPayload,
  normalizeFundamentalsSnapshot,
  normalizeScannerRunResult,
  normalizeScannerUniverseResult,
} from './contractValidation';

function testNormalizeChartPayloadFromRawBars(): void {
  const result = normalizeChartOhlcvPayload({
    success: true,
    raw_bars: [
      { timestamp: '2026-01-01 09:30:00', open: 1, high: 2, low: 0.5, close: 1.5 },
      { timestamp: '2026-01-01 13:30:00', open: 1.5, high: 2.5, low: 1.2, close: 2.2 },
    ],
  }, 'AAPL', '1h');

  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.interval, '1h');
  assert.equal(result.bars, 2);
  assert.equal(typeof result.chart_data[0].time, 'number');
}

function testNormalizeChartPayloadFromChartData(): void {
  const result = normalizeChartOhlcvPayload({
    data: {
      symbol: 'msft',
      interval: '1d',
      chart_data: [
        { time: '2026-01-01', open: 10, high: 12, low: 9, close: 11 },
        { time: '2026-01-02', open: 11, high: 13, low: 10, close: 12 },
        { time: 'bad', open: 'x', high: 13, low: 10, close: 12 },
      ],
    },
  }, 'AAPL', '1d');

  assert.equal(result.symbol, 'MSFT');
  assert.equal(result.bars, 2);
}

function testNormalizeScannerRunResultDropsInvalidCandidates(): void {
  const result = normalizeScannerRunResult({
    symbol: 'achr',
    count: 99,
    candidates: [
      {
        candidate_id: 'ok_1',
        strategy_version_id: 'strat_v1',
        symbol: 'achr',
        timeframe: 'W',
        score: 0.81,
        entry_ready: true,
        rule_checklist: [{ rule_name: 'base_detected', passed: true }],
        anchors: {},
        window_start: 10,
        window_end: 20,
        created_at: '2026-01-01T00:00:00Z',
        chart_data: [{ time: '2026-01-01', open: 1, high: 2, low: 1, close: 2 }],
        visual: {
          markers: [{ time: '2026-01-01', text: 'BASE' }],
          overlay_series: [{ type: 'line', data: [{ time: '2026-01-01', value: 1.5 }] }],
        },
      },
      {
        candidate_id: '',
        strategy_version_id: 'broken',
        symbol: 'ACHR',
      },
    ],
  });

  assert.equal(result.symbol, 'ACHR');
  assert.equal(result.count, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidate_id, 'ok_1');
  assert.equal(Array.isArray(result.candidates[0].visual?.markers), true);
  assert.equal(Array.isArray(result.candidates[0].visual?.overlay_series), true);
  assert.equal(isValidScannerRunResult(result), true);
}

function testNormalizeScannerUniverseResultRecomputesTotals(): void {
  const result = normalizeScannerUniverseResult({
    total_symbols: 4,
    total_candidates: 999,
    results: [
      {
        symbol: 'AAA',
        candidates: [
          {
            candidate_id: 'a1',
            strategy_version_id: 's1',
            symbol: 'AAA',
            timeframe: 'D',
            score: 0.7,
            entry_ready: true,
            rule_checklist: [{ rule_name: 'x', passed: true }],
            anchors: {},
            window_start: 1,
            window_end: 2,
            created_at: '2026-01-01T00:00:00Z',
            chart_data: [],
          },
        ],
      },
      {
        symbol: 'BBB',
        candidates: [],
      },
    ],
  });

  assert.equal(result.total_symbols, 4);
  assert.equal(result.total_candidates, 1);
  assert.equal(result.results[0].symbol, 'AAA');
  assert.equal(isValidScannerUniverseResult(result), true);
}

function testNormalizeFundamentalsSnapshot(): void {
  const result = normalizeFundamentalsSnapshot({
    symbol: 'bfly',
    companyName: 'Butterfly Network',
    marketCap: '950000000',
    tacticalScore: '67.3',
    quality: 'Improving',
    holdContext: 'Can hold pullbacks',
    tacticalGrade: 'Tactical Pop',
    reportedExecutionScore: '71',
    forwardExpectationsScore: '66',
    positioningScore: '58',
    marketContextScore: '62',
    statusNote: 'Strong runway | Earnings soon',
    riskNote: 'Strong runway | Earnings soon',
    lowEnterpriseValueFlag: 1,
    dilutionFlag: 0,
    recentFinancingFlag: false,
    squeezePressureLabel: 'High',
    atmShelfFlag: null,
    reportedExecution: {
      score: '71',
      epsBeatStreak: '3',
      epsMissStreak: '0',
      avgEpsSurprisePct: '8.2',
      history: [
        { period: 'Q4 2025', epsActual: '0.15', epsEstimate: '0.11', epsSurprisePct: '36.4' },
      ],
    },
    forwardExpectations: {
      score: '66',
      signal: 'supportive',
      currentQtrGrowthPct: '14.5',
    },
    positioning: {
      score: '58',
      signal: 'buying',
      recentBuyCount: '2',
      recentTrades: [
        { insider: 'CEO', transaction: 'Purchase', value: '$120000' },
      ],
    },
    marketContext: {
      score: '62',
      above50Day: true,
      above200Day: false,
      priceVs50DayPct: '4.5',
    },
    ownership: {
      institutionalOwnershipPct: '44.2',
      insiderOwnershipPct: '5.1',
      topInstitutionalHolders: [
        { holder: 'Vanguard', shares: '1000000', pctOut: '3.2%' },
      ],
    },
    tags: [
      { label: 'Strong runway', tone: 'positive' },
      { label: '', tone: 'danger' },
    ],
  });

  assert.equal(result.symbol, 'BFLY');
  assert.equal(result.marketCap, 950000000);
  assert.equal(result.tacticalScore, 67.3);
  assert.equal(result.reportedExecutionScore, 71);
  assert.equal(result.forwardExpectationsScore, 66);
  assert.equal(result.positioningScore, 58);
  assert.equal(result.marketContextScore, 62);
  assert.equal(result.lowEnterpriseValueFlag, true);
  assert.equal(result.dilutionFlag, false);
  assert.equal(result.reportedExecution?.epsBeatStreak, 3);
  assert.equal(result.forwardExpectations?.signal, 'supportive');
  assert.equal(result.positioning?.recentTrades.length, 1);
  assert.equal(result.marketContext?.above200Day, false);
  assert.equal(result.ownership?.topInstitutionalHolders.length, 1);
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].label, 'Strong runway');
}

function runTests(): void {
  testNormalizeChartPayloadFromRawBars();
  testNormalizeChartPayloadFromChartData();
  testNormalizeScannerRunResultDropsInvalidCandidates();
  testNormalizeScannerUniverseResultRecomputesTotals();
  testNormalizeFundamentalsSnapshot();
}

runTests();
console.log('contractValidation tests passed');
