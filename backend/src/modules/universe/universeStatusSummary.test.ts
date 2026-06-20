import assert from 'assert';
import type { UniverseJob } from './universeJobProgress';
import {
  applyOptionableCatalogStatus,
  applyOptionableProgressStatus,
  createEmptyOptionableStatus,
  summarizeUniverseManifest,
} from './universeStatusSummary';

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

function testAppliesMatchingOptionableCatalog(): void {
  const status = createEmptyOptionableStatus(50);
  applyOptionableCatalogStatus(
    status,
    {
      source: 'nasdaq-trader-us',
      optionable: ['AAPL', 'MSFT'],
      not_optionable: ['IBM'],
      source_symbol_count: 5,
      unclassified_count: 2,
    },
    { source: 'nasdaq-trader-us' },
  );

  assert.equal(status.optionableCount, 2);
  assert.equal(status.optionableClassifiedCount, 3);
  assert.equal(status.optionableUnclassifiedCount, 2);
  assert.equal(status.optionableComplete, false);
  assert.equal(status.sourceSymbolCount, 5);
}

function testIgnoresMismatchedOptionableCatalog(): void {
  const status = createEmptyOptionableStatus(50);
  applyOptionableCatalogStatus(
    status,
    {
      source: 'custom_csv',
      optionable: ['AAPL'],
      source_symbol_count: 1,
    },
    { source: 'nasdaq-trader-us' },
  );

  assert.deepEqual(status, createEmptyOptionableStatus(50));
}

function testProgressCatalogWinsWhenMoreClassified(): void {
  const status = createEmptyOptionableStatus(10);
  status.optionableClassifiedCount = 2;

  applyOptionableProgressStatus(
    status,
    {
      source: 'nasdaq-trader-us',
      optionable: ['AAPL', 'MSFT', 'NVDA'],
      not_optionable: ['IBM'],
      source_symbol_count: 5,
      generated_at: '2026-06-20T00:00:00.000Z',
    },
    { source: 'nasdaq-trader-us' },
    null,
  );

  assert.equal(status.optionableCount, 3);
  assert.equal(status.optionableClassifiedCount, 4);
  assert.equal(status.sourceSymbolCount, 5);
}

function testProgressCatalogUpdatesActiveRebuildJob(): void {
  const status = createEmptyOptionableStatus(10);
  const activeJob: UniverseJob = {
    type: 'rebuild_optionable',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
    progress: 5,
    stage: 'starting',
  };

  applyOptionableProgressStatus(
    status,
    {
      source: 'nasdaq-trader-us',
      optionable: ['AAPL', 'MSFT'],
      not_optionable: ['IBM'],
      source_symbol_count: 6,
      generated_at: '2026-06-20T00:01:00.000Z',
    },
    { source: 'nasdaq-trader-us' },
    activeJob,
  );

  assert.equal(activeJob.stage, 'checking_optionability');
  assert.equal(activeJob.metrics?.option_total, 6);
  assert.equal(activeJob.metrics?.option_checked, 3);
  assert.equal(activeJob.metrics?.optionable_so_far, 2);
  assert.equal(activeJob.progress, 30);
  assert.equal(activeJob.progress_label, 'Option chains checked for 3 / 6 symbols');
  assert.equal(activeJob.last_log_at, '2026-06-20T00:01:00.000Z');
}

function runTests(): void {
  testSummarizesManifestFields();
  testFallsBackToSymbolObjectCountAndGeneratedAt();
  testHandlesMissingManifestShape();
  testAppliesMatchingOptionableCatalog();
  testIgnoresMismatchedOptionableCatalog();
  testProgressCatalogWinsWhenMoreClassified();
  testProgressCatalogUpdatesActiveRebuildJob();
}

runTests();
console.log('universeStatusSummary tests passed');
