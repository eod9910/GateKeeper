import assert from 'assert';
import { UniverseJob } from './universeJobProgress';
import {
  applyRegimeProgressLine,
  cancelActiveUniverseJob,
  cancelUniverseJob,
  completeUniverseJobFromExitCode,
} from './universeJobLifecycle';

function createJob(): UniverseJob {
  return {
    type: 'build',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
    progress: 42,
    progress_label: 'Working...',
    stage: 'running',
  };
}

function testCompleteJobSuccess(): void {
  const job = createJob();
  completeUniverseJobFromExitCode(job, 0, 'Build complete.', '2026-06-20T00:01:00.000Z');

  assert.equal(job.status, 'completed');
  assert.equal(job.completed_at, '2026-06-20T00:01:00.000Z');
  assert.equal(job.progress, 100);
  assert.equal(job.progress_label, 'Build complete.');
  assert.equal(job.stage, 'completed');
  assert.equal(job.error, undefined);
}

function testCompleteJobFailure(): void {
  const job = createJob();
  completeUniverseJobFromExitCode(job, 2, 'Build complete.', '2026-06-20T00:02:00.000Z');

  assert.equal(job.status, 'failed');
  assert.equal(job.completed_at, '2026-06-20T00:02:00.000Z');
  assert.equal(job.progress, 42);
  assert.equal(job.progress_label, 'Failed (exit code 2)');
  assert.equal(job.stage, 'failed');
  assert.equal(job.error, 'Process exited with code 2');
}

function testCompleteJobNullFailure(): void {
  const job = createJob();
  completeUniverseJobFromExitCode(job, null, 'Update complete.', '2026-06-20T00:03:00.000Z');

  assert.equal(job.status, 'failed');
  assert.equal(job.progress_label, 'Failed (exit code null)');
  assert.equal(job.error, 'Process exited with code null');
}

function testCancelJob(): void {
  const job = createJob();
  cancelUniverseJob(job, '2026-06-20T00:04:00.000Z');

  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'Cancelled by user');
  assert.equal(job.completed_at, '2026-06-20T00:04:00.000Z');
  assert.equal(job.progress_label, 'Cancelled.');
  assert.equal(job.stage, 'failed');
}

function testCancelActiveJobKillsProcessAndReturnsNull(): void {
  const job = createJob();
  let killed = false;
  const nextProcess = cancelActiveUniverseJob(
    job,
    {
      kill: () => {
        killed = true;
      },
    },
    '2026-06-20T00:05:00.000Z',
  );

  assert.equal(killed, true);
  assert.equal(nextProcess, null);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'Cancelled by user');
  assert.equal(job.completed_at, '2026-06-20T00:05:00.000Z');
  assert.equal(job.progress_label, 'Cancelled.');
  assert.equal(job.stage, 'failed');
}

function testCancelActiveJobAllowsMissingProcess(): void {
  const job = createJob();
  const nextProcess = cancelActiveUniverseJob(job, null, '2026-06-20T00:06:00.000Z');

  assert.equal(nextProcess, null);
  assert.equal(job.status, 'failed');
  assert.equal(job.completed_at, '2026-06-20T00:06:00.000Z');
}

function testRegimeProgressLine(): void {
  const job = createJob();
  applyRegimeProgressLine(job, '[2000/4000] regimes so far: expansion=10');

  assert.equal(job.progress, 45);
  assert.equal(job.progress_label, '[2000/4000] regimes so far: expansion=10');
}

function testRegimeProgressIgnoresUnmatchedLine(): void {
  const job = createJob();
  applyRegimeProgressLine(job, 'plain log line');

  assert.equal(job.progress, 42);
  assert.equal(job.progress_label, 'Working...');
}

function runTests(): void {
  testCompleteJobSuccess();
  testCompleteJobFailure();
  testCompleteJobNullFailure();
  testCancelJob();
  testCancelActiveJobKillsProcessAndReturnsNull();
  testCancelActiveJobAllowsMissingProcess();
  testRegimeProgressLine();
  testRegimeProgressIgnoresUnmatchedLine();
}

runTests();
console.log('universeJobLifecycle tests passed');
