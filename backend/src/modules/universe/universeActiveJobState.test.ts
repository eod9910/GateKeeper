import assert from 'assert';
import { EventEmitter } from 'events';
import { UniverseActiveJobState } from './universeActiveJobState';
import { UniverseJob } from './universeJobProgress';
import { UniverseProcessRunnerProcess } from './universeProcessRunner';

class FakeStream extends EventEmitter {
  setEncoding(_encoding: string) {}
}

class FakeProcess extends EventEmitter implements UniverseProcessRunnerProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

function createJob(): UniverseJob {
  return {
    type: 'update',
    status: 'running',
    started_at: new Date().toISOString(),
    progress: 0,
    log: [],
  };
}

function testStoresJobAndClearsProcess() {
  const state = new UniverseActiveJobState();
  const job = createJob();
  const process = new FakeProcess();

  state.setJob(job);
  state.setProcess(process);
  assert.strictEqual(state.getJob(), job);

  state.clearProcess();
  state.cancel();

  assert.strictEqual(process.killed, false);
}

function testCancelsActiveJobAndProcess() {
  const state = new UniverseActiveJobState();
  const job = createJob();
  const process = new FakeProcess();

  state.setJob(job);
  state.setProcess(process);
  state.cancel();

  assert.strictEqual(process.killed, true);
  assert.strictEqual(job.status, 'failed');
  assert.strictEqual(job.error, 'Cancelled by user');
  assert.strictEqual(job.progress_label, 'Cancelled.');
}

function main() {
  testStoresJobAndClearsProcess();
  testCancelsActiveJobAndProcess();
  console.log('universeActiveJobState tests passed');
}

main();
