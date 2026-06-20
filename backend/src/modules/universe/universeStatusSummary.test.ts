import assert from 'assert';
import type { UniverseJob } from './universeJobProgress';
import {
  applyOptionableCatalogStatus,
  applyOptionableProgressStatus,
  buildUniverseStatusSnapshot,
  buildUniverseStatusData,
  createEmptyOptionableStatus,
  projectUniverseActiveJob,
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

function testProjectsActiveJobShape(): void {
  const job: UniverseJob = {
    type: 'build',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: Array.from({ length: 65 }, (_, index) => `line ${index}`),
    progress: 42,
    progress_label: 'Working',
    stage: 'downloading_history',
    source: 'nasdaq-trader-us',
    source_label: 'Nasdaq Trader US-listed underlyings',
    interval: '1d',
    lookback: '5y',
    workers: 10,
    min_volume: 100000,
    metrics: { download_batch: 2 },
    last_log_at: '2026-06-20T00:02:00.000Z',
  };

  const projected = projectUniverseActiveJob(job, new Date('2026-06-20T00:03:05.000Z'));

  assert.equal(projected?.elapsed_seconds, 185);
  assert.equal(projected?.progress, 42);
  assert.equal(projected?.metrics?.download_batch, 2);
  assert.equal(projected?.log_tail.length, 60);
  assert.equal(projected?.log_tail[0], 'line 5');
  assert.equal(projected?.log_count, 65);
}

function testBuildsStatusDataShape(): void {
  const optionableStatus = createEmptyOptionableStatus(10);
  optionableStatus.optionableCount = 4;
  optionableStatus.optionableClassifiedCount = 8;
  optionableStatus.optionableUnclassifiedCount = 2;
  optionableStatus.optionableComplete = false;
  const data = buildUniverseStatusData({
    symbolCount: 12,
    sourceSymbolCount: 10,
    optionableStatus,
    source: 'nasdaq-trader-us',
    sourceLabel: 'Nasdaq Trader US-listed underlyings',
    lastUpdated: '2026-06-20T00:00:00.000Z',
    staleCount: 1,
    manifestFreshness: { cacheLayer: 'disk' },
    priceSnapshotFreshness: { sourceStatus: 'missing' },
    activeJob: null,
  });

  assert.equal(data.built, true);
  assert.equal(data.source_symbol_count, 10);
  assert.equal(data.symbol_count, 12);
  assert.equal(data.downloaded_symbol_count, 12);
  assert.equal(data.optionable_count, 4);
  assert.equal(data.optionable_classified_count, 8);
  assert.equal(data.optionable_unclassified_count, 2);
  assert.equal(data.optionable_complete, false);
  assert.equal(data.needs_update, true);
  assert.deepEqual(data.freshness.manifest, { cacheLayer: 'disk' });
  assert.deepEqual(data.freshness.prices, { sourceStatus: 'missing' });
  assert.equal(data.active_job, null);
}

async function testBuildStatusSnapshotHandlesMissingFiles(): Promise<void> {
  const data = await buildUniverseStatusSnapshot({
    manifestPath: 'manifest.json',
    optionablePath: 'optionable.json',
    optionableProgressPath: 'optionable-progress.json',
    priceSnapshotCachePath: 'prices-cache.json',
    manifestTtlMs: 60_000,
    priceSnapshotTtlMs: 60_000,
    activeJob: null,
    readJson: async () => {
      throw new Error('missing');
    },
    readPriceEnvelope: async () => null,
    now: new Date('2026-06-20T00:00:00.000Z'),
  });

  assert.equal(data.built, false);
  assert.equal(data.symbol_count, 0);
  assert.equal(data.source_symbol_count, 0);
  assert.equal(data.optionable_complete, true);
  assert.equal(data.needs_update, false);
  assert.equal(data.active_job, null);
  assert.equal((data.freshness as any).prices.cache_layer, 'missing');
}

async function testBuildStatusSnapshotAppliesProgressPrecedence(): Promise<void> {
  const files: Record<string, any> = {
    'manifest.json': {
      total_symbols: 6,
      source_symbol_count: 6,
      last_updated: '2026-06-20T00:00:00.000Z',
      source: 'nasdaq-trader-us',
      source_label: 'Nasdaq Trader US-listed underlyings',
      symbols: {
        AAPL: { end: '2026-06-19' },
        MSFT: { end: '2026-06-01' },
      },
    },
    'optionable.json': {
      source: 'nasdaq-trader-us',
      optionable: ['AAPL'],
      not_optionable: ['IBM'],
      source_symbol_count: 6,
    },
    'optionable-progress.json': {
      source: 'nasdaq-trader-us',
      optionable: ['AAPL', 'MSFT', 'NVDA'],
      not_optionable: ['IBM'],
      source_symbol_count: 6,
      generated_at: '2026-06-20T00:01:00.000Z',
    },
  };
  const activeJob: UniverseJob = {
    type: 'rebuild_optionable',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: ['started'],
    progress: 5,
    stage: 'starting',
  };

  const data = await buildUniverseStatusSnapshot({
    manifestPath: 'manifest.json',
    optionablePath: 'optionable.json',
    optionableProgressPath: 'optionable-progress.json',
    priceSnapshotCachePath: 'prices-cache.json',
    manifestTtlMs: 60_000,
    priceSnapshotTtlMs: 60_000,
    activeJob,
    readJson: async (filePath) => files[filePath],
    readPriceEnvelope: async <T>() => ({
      key: 'cache-key',
      version: 1,
      fetchedAt: Date.parse('2026-06-20T00:00:00.000Z'),
      ttlMs: 60_000,
      createdAt: '2026-06-20T00:00:00.000Z',
      source: 'universePriceSnapshot',
      data: {} as T,
    }),
    now: new Date('2026-06-20T00:03:00.000Z'),
  });

  assert.equal(data.built, true);
  assert.equal(data.symbol_count, 6);
  assert.equal(data.source_symbol_count, 6);
  assert.equal(data.optionable_count, 3);
  assert.equal(data.optionable_classified_count, 4);
  assert.equal(data.stale_count, 1);
  assert.equal(data.needs_update, true);
  assert.equal(data.active_job?.progress, 38);
  assert.equal(data.active_job?.progress_label, 'Option chains checked for 4 / 6 symbols');
  assert.equal((data.freshness as any).prices.cache_layer, 'disk');
}

async function runTests(): Promise<void> {
  testSummarizesManifestFields();
  testFallsBackToSymbolObjectCountAndGeneratedAt();
  testHandlesMissingManifestShape();
  testAppliesMatchingOptionableCatalog();
  testIgnoresMismatchedOptionableCatalog();
  testProgressCatalogWinsWhenMoreClassified();
  testProgressCatalogUpdatesActiveRebuildJob();
  testProjectsActiveJobShape();
  testBuildsStatusDataShape();
  await testBuildStatusSnapshotHandlesMissingFiles();
  await testBuildStatusSnapshotAppliesProgressPrecedence();
}

runTests()
  .then(() => console.log('universeStatusSummary tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
