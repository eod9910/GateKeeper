import assert from 'assert';
import { UniverseJob } from './universeJobProgress';
import {
  applyRegimeSnapshotSummaryMetrics,
  readUniverseRegimeSnapshot,
} from './universeRegimeSnapshot';

async function testReadsSnapshotShape(): Promise<void> {
  const snapshot = await readUniverseRegimeSnapshot('snapshot.json', async () => JSON.stringify({
    generated_at: '2026-06-20T00:00:00.000Z',
    interval: '1d',
    total: 42,
    summary: { expansion: 10, markdown: 2 },
    ignored: true,
  }));

  assert.deepEqual(snapshot, {
    generated_at: '2026-06-20T00:00:00.000Z',
    interval: '1d',
    total: 42,
    summary: { expansion: 10, markdown: 2 },
  });
}

async function testReturnsNullWhenMissing(): Promise<void> {
  const snapshot = await readUniverseRegimeSnapshot('missing.json', async () => {
    throw new Error('missing');
  });

  assert.equal(snapshot, null);
}

async function testReturnsNullForInvalidJson(): Promise<void> {
  const snapshot = await readUniverseRegimeSnapshot('bad.json', async () => '{bad json');

  assert.equal(snapshot, null);
}

async function testAppliesSummaryMetrics(): Promise<void> {
  const job: UniverseJob = {
    type: 'classify_regimes',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
  };

  await applyRegimeSnapshotSummaryMetrics(job, 'snapshot.json', async () => JSON.stringify({
    summary: { expansion: 10, markdown: 2 },
  }));

  assert.deepEqual(job.metrics, { expansion: 10, markdown: 2 });
}

async function testApplySummaryMetricsIgnoresMissingSnapshot(): Promise<void> {
  const job: UniverseJob = {
    type: 'classify_regimes',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
    metrics: { option_total: 4 },
  };

  await applyRegimeSnapshotSummaryMetrics(job, 'missing.json', async () => {
    throw new Error('missing');
  });

  assert.deepEqual(job.metrics, { option_total: 4 });
}

async function runTests(): Promise<void> {
  await testReadsSnapshotShape();
  await testReturnsNullWhenMissing();
  await testReturnsNullForInvalidJson();
  await testAppliesSummaryMetrics();
  await testApplySummaryMetricsIgnoresMissingSnapshot();
}

runTests()
  .then(() => console.log('universeRegimeSnapshot tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
