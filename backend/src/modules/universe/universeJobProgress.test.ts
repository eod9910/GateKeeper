import assert from 'assert';
import type { UniverseJob } from './universeJobProgress';
import {
  appendUniverseJobLog,
  clampUniverseProgress,
  computeUniverseProgress,
  getUniverseSourceLabel,
  updateUniverseJobFromLine,
} from './universeJobProgress';

function createJob(): UniverseJob {
  return {
    type: 'build',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
  };
}

function testSourceLabels(): void {
  assert.equal(getUniverseSourceLabel('nasdaq-trader-us'), 'Nasdaq Trader US-listed underlyings');
  assert.equal(getUniverseSourceLabel('russell2000'), 'Russell 2000 optionable');
  assert.equal(getUniverseSourceLabel('custom_csv'), 'Custom ticker list');
  assert.equal(getUniverseSourceLabel(''), 'Optionable universe');
}

function testClampUniverseProgress(): void {
  assert.equal(clampUniverseProgress(-3), 0);
  assert.equal(clampUniverseProgress(12.4), 12);
  assert.equal(clampUniverseProgress(12.5), 13);
  assert.equal(clampUniverseProgress(120), 100);
}

function testBuildProgressParsing(): void {
  const job = createJob();

  updateUniverseJobFromLine(job, 'Checking options availability for 200 tickers (8 parallel workers)');
  assert.equal(job.stage, 'checking_optionability');
  assert.equal(job.metrics?.option_total, 200);
  assert.equal(job.workers, 8);
  assert.equal(job.progress, 5);

  updateUniverseJobFromLine(job, '[ 25%] 50/200 checked - 20 optionable so far');
  assert.equal(job.stage, 'checking_optionability');
  assert.equal(job.metrics?.option_checked, 50);
  assert.equal(job.metrics?.option_total, 200);
  assert.equal(job.metrics?.optionable_so_far, 20);
  assert.equal(job.progress, 25);
}

function testRetryProgressParsing(): void {
  const job = createJob();

  updateUniverseJobFromLine(job, 'Retrying unknown optionability results sequentially');
  assert.equal(job.stage, 'retrying_unknown');
  assert.equal(job.progress, 55);

  updateUniverseJobFromLine(job, '[retry 40%] 4/10 checked - recovered 2');
  assert.equal(job.stage, 'retrying_unknown');
  assert.equal(job.metrics?.retry_checked, 4);
  assert.equal(job.metrics?.retry_total, 10);
  assert.equal(job.metrics?.retry_recovered, 2);
  assert.equal(job.progress, 59);
}

function testDownloadAndCompletionProgress(): void {
  const job = createJob();

  updateUniverseJobFromLine(job, 'Downloading 1d history for 300 tickers');
  assert.equal(job.stage, 'downloading_history');
  assert.equal(job.metrics?.download_total, 300);
  assert.equal(job.progress, 70);

  updateUniverseJobFromLine(job, 'Batch 3/10 (50 symbols)...');
  assert.equal(job.stage, 'downloading_history');
  assert.equal(job.metrics?.download_batch, 3);
  assert.equal(job.metrics?.download_batches, 10);
  assert.equal(job.metrics?.download_batch_size, 50);
  assert.equal(job.progress, 76);

  updateUniverseJobFromLine(job, 'Manifest saved to backend/data/universe/manifest.json');
  assert.equal(job.stage, 'writing_manifest');
  assert.equal(job.progress, 99);

  updateUniverseJobFromLine(job, 'DONE in 42.0s');
  assert.equal(job.stage, 'completed');
  assert.equal(job.progress, 100);
}

function testAppendLogTrimsBlankLinesAndCapsHistory(): void {
  const job = createJob();

  appendUniverseJobLog(job, '   ');
  assert.equal(job.log.length, 0);

  for (let i = 0; i < 405; i += 1) {
    appendUniverseJobLog(job, `line ${i}`);
  }

  assert.equal(job.log.length, 400);
  assert.equal(job.log[0], 'line 5');
  assert.equal(job.log[399], 'line 404');
  assert.equal(job.progress_label, 'line 404');
  assert.equal(typeof job.last_log_at, 'string');
}

function testComputeUniverseProgressDoesNotMoveBackward(): void {
  const job = createJob();
  job.stage = 'checking_optionability';
  job.progress = 20;

  assert.equal(computeUniverseProgress(job), 20);
}

function runTests(): void {
  testSourceLabels();
  testClampUniverseProgress();
  testBuildProgressParsing();
  testRetryProgressParsing();
  testDownloadAndCompletionProgress();
  testAppendLogTrimsBlankLinesAndCapsHistory();
  testComputeUniverseProgressDoesNotMoveBackward();
}

runTests();
console.log('universeJobProgress tests passed');
