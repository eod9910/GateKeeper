import assert from 'assert';
import { summarizeUniverseManifest } from './universeStatusSummary';

function testSummarizesManifestFields(): void {
  const summary = summarizeUniverseManifest(
    {
      total_symbols: 12,
      source_symbol_count: 15,
      last_updated: '2026-06-20T00:00:00.000Z',
      generated_at: '2026-06-19T00:00:00.000Z',
      source: 'nasdaq-trader-us',
      source_label: 'Nasdaq Trader US-listed underlyings',
      symbols: {
        AAPL: { end: '2026-06-19' },
        MSFT: { end: '2026-06-01' },
      },
    },
    new Date('2026-06-20T12:00:00.000Z'),
  );

  assert.equal(summary.symbolCount, 12);
  assert.equal(summary.sourceSymbolCount, 15);
  assert.equal(summary.lastUpdated, '2026-06-20T00:00:00.000Z');
  assert.equal(summary.source, 'nasdaq-trader-us');
  assert.equal(summary.sourceLabel, 'Nasdaq Trader US-listed underlyings');
  assert.equal(summary.staleCount, 1);
}

function testFallsBackToSymbolObjectCountAndGeneratedAt(): void {
  const summary = summarizeUniverseManifest(
    {
      generated_at: '2026-06-18T00:00:00.000Z',
      symbols: {
        AAPL: {},
        MSFT: {},
      },
    },
    new Date('2026-06-20T12:00:00.000Z'),
  );

  assert.equal(summary.symbolCount, 2);
  assert.equal(summary.sourceSymbolCount, 0);
  assert.equal(summary.lastUpdated, '2026-06-18T00:00:00.000Z');
  assert.equal(summary.source, null);
  assert.equal(summary.sourceLabel, null);
  assert.equal(summary.staleCount, 0);
}

function testHandlesMissingManifestShape(): void {
  const summary = summarizeUniverseManifest(null, new Date('2026-06-20T12:00:00.000Z'));

  assert.equal(summary.symbolCount, 0);
  assert.equal(summary.sourceSymbolCount, 0);
  assert.equal(summary.lastUpdated, null);
  assert.equal(summary.staleCount, 0);
}

function runTests(): void {
  testSummarizesManifestFields();
  testFallsBackToSymbolObjectCountAndGeneratedAt();
  testHandlesMissingManifestShape();
}

runTests();
console.log('universeStatusSummary tests passed');
