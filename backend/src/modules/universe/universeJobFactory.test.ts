import assert from 'assert';
import {
  createOptionableRebuildJob,
  createRegimeClassificationJob,
  createUniverseBuildJob,
  createUniverseUpdateJob,
} from './universeJobFactory';

function testBuildJobShape(): void {
  const job = createUniverseBuildJob({
    source: 'nasdaq-trader-us',
    lookback: '5y',
    interval: '1d',
    workers: 10,
    minVolume: 100000,
    startedAt: '2026-06-20T00:00:00.000Z',
  });

  assert.equal(job.type, 'build');
  assert.equal(job.status, 'running');
  assert.equal(job.started_at, '2026-06-20T00:00:00.000Z');
  assert.equal(job.progress_label, 'Starting build...');
  assert.equal(job.source_label, 'Nasdaq Trader US-listed underlyings');
  assert.equal(job.min_volume, 100000);
  assert.deepEqual(job.metrics, {});
}

function testOptionableRebuildJobShape(): void {
  const job = createOptionableRebuildJob({
    source: 'custom_csv',
    workers: 5,
    startedAt: '2026-06-20T00:01:00.000Z',
  });

  assert.equal(job.type, 'rebuild_optionable');
  assert.equal(job.progress_label, 'Starting optionable subset rebuild...');
  assert.equal(job.source_label, 'Custom ticker list');
  assert.equal(job.lookback, 'n/a');
  assert.equal(job.interval, '1d');
  assert.equal(job.workers, 5);
  assert.equal(job.min_volume, 0);
}

function testUpdateJobShape(): void {
  const job = createUniverseUpdateJob({
    interval: '1h',
    startedAt: '2026-06-20T00:02:00.000Z',
  });

  assert.equal(job.type, 'update');
  assert.equal(job.progress_label, 'Starting update...');
  assert.equal(job.interval, '1h');
  assert.equal(job.stage, 'starting');
}

function testRegimeClassificationJobShape(): void {
  const job = createRegimeClassificationJob({
    interval: '1d',
    startedAt: '2026-06-20T00:03:00.000Z',
  });

  assert.equal(job.type, 'classify_regimes');
  assert.equal(job.progress_label, 'Starting regime classification...');
  assert.equal(job.stage, 'classifying');
  assert.equal(job.source, 'local_csv');
  assert.equal(job.source_label, 'Local CSV cache');
  assert.equal(job.lookback, '1d');
  assert.equal(job.workers, 1);
}

function runTests(): void {
  testBuildJobShape();
  testOptionableRebuildJobShape();
  testUpdateJobShape();
  testRegimeClassificationJobShape();
}

runTests();
console.log('universeJobFactory tests passed');
