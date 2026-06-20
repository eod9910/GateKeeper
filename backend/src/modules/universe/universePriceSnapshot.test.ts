import assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  buildUniverseFreshness,
  createUniversePriceSnapshotService,
  parseIsoTimestamp,
  readLastCloseFromCsv,
  readUniversePriceSnapshotFreshness,
} from './universePriceSnapshot';

async function createTempUniverseDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pattern-detector-universe-'));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function testParseIsoTimestamp(): void {
  assert.equal(parseIsoTimestamp(null), null);
  assert.equal(parseIsoTimestamp('not-a-date'), null);
  assert.equal(parseIsoTimestamp('2026-06-20T00:00:00.000Z'), Date.parse('2026-06-20T00:00:00.000Z'));
}

function testBuildUniverseFreshness(): void {
  const freshness = buildUniverseFreshness(new Date().toISOString(), 60_000);
  assert.equal(freshness.cache_layer, 'disk');
  assert.equal(freshness.source_status, 'ok');
  assert.equal(freshness.stale, false);
}

async function testReadUniversePriceSnapshotFreshnessFromCache(): Promise<void> {
  const freshness = await readUniversePriceSnapshotFreshness(
    'prices-cache.json',
    60_000,
    async <T>() => ({
      key: 'cache-key',
      version: 3,
      fetchedAt: Date.now(),
      ttlMs: 60_000,
      createdAt: new Date().toISOString(),
      source: 'universePriceSnapshot',
      data: {} as T,
    }),
  );

  assert.equal(freshness.cache_layer, 'disk');
  assert.equal(freshness.cache_key, 'cache-key');
  assert.equal(freshness.version, 3);
  assert.equal(freshness.source_status, 'ok');
}

async function testReadUniversePriceSnapshotFreshnessMissingOnNullOrError(): Promise<void> {
  const missing = await readUniversePriceSnapshotFreshness('prices-cache.json', 60_000, async () => null);
  assert.equal(missing.cache_layer, 'missing');
  assert.equal(missing.source_status, 'missing');

  const errored = await readUniversePriceSnapshotFreshness('prices-cache.json', 60_000, async () => {
    throw new Error('read failed');
  });
  assert.equal(errored.cache_layer, 'missing');
  assert.equal(errored.source_status, 'missing');
}

async function testReadLastCloseFromCsv(): Promise<void> {
  const tempDir = await createTempUniverseDir();
  const csvPath = path.join(tempDir, 'AAPL_1d.csv');
  await fs.writeFile(
    csvPath,
    'date,open,high,low,close,volume\n2026-06-19,10,12,9,11.5,1000\n2026-06-20,11,13,10,12.75,1200\n',
    'utf-8'
  );

  assert.equal(await readLastCloseFromCsv(csvPath), 12.75);
  assert.equal(await readLastCloseFromCsv(path.join(tempDir, 'missing.csv')), null);
}

async function testBuildUniversePriceSnapshotUsesManifestAndCsvTail(): Promise<void> {
  const tempDir = await createTempUniverseDir();
  const manifestPath = path.join(tempDir, 'manifest.json');
  const cachePath = path.join(tempDir, 'prices-cache.json');
  await writeJson(manifestPath, {
    last_updated: '2026-06-20T00:00:00.000Z',
    interval: '1d',
    symbols: {
      AAPL: { last_close: 123.45, end: '2026-06-19' },
      MSFT: { file: 'MSFT_1d.csv', end: '2026-06-19' },
    },
  });
  await fs.writeFile(
    path.join(tempDir, 'MSFT_1d.csv'),
    'date,open,high,low,close,volume\n2026-06-19,1,2,0.5,222.25,1000\n',
    'utf-8'
  );

  const service = createUniversePriceSnapshotService({
    dataDir: tempDir,
    manifestPath,
    priceSnapshotCachePath: cachePath,
    priceSnapshotTtlMs: 60_000,
  });

  const first = await service.buildUniversePriceSnapshot();
  assert.equal(first.cacheKey, '2026-06-20T00:00:00.000Z:2');
  assert.equal(first.cacheLayer, 'refresh');
  assert.equal(first.data.AAPL.last_close, 123.45);
  assert.equal(first.data.AAPL.source, 'manifest');
  assert.equal(first.data.MSFT.last_close, 222.25);
  assert.equal(first.data.MSFT.source, 'csv_tail');

  const second = await service.buildUniversePriceSnapshot();
  assert.equal(second.cacheLayer, 'memory');
  assert.deepEqual(second.data, first.data);

  const diskService = createUniversePriceSnapshotService({
    dataDir: tempDir,
    manifestPath,
    priceSnapshotCachePath: cachePath,
    priceSnapshotTtlMs: 60_000,
  });
  const fromDisk = await diskService.buildUniversePriceSnapshot();
  assert.equal(fromDisk.cacheLayer, 'disk');
  assert.deepEqual(fromDisk.data, first.data);
}

async function runTests(): Promise<void> {
  testParseIsoTimestamp();
  testBuildUniverseFreshness();
  await testReadUniversePriceSnapshotFreshnessFromCache();
  await testReadUniversePriceSnapshotFreshnessMissingOnNullOrError();
  await testReadLastCloseFromCsv();
  await testBuildUniversePriceSnapshotUsesManifestAndCsvTail();
}

runTests().then(() => {
  console.log('universePriceSnapshot tests passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
