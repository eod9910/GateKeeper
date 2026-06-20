import assert from 'assert';
import { EventEmitter } from 'events';
import { UniverseJob } from './universeJobProgress';
import { UniverseJobCommand } from './universeJobCommands';
import {
  SpawnUniverseProcess,
  UniverseProcessRunnerProcess,
  startUniverseProcessJob,
} from './universeProcessRunner';

class FakeStream extends EventEmitter {
  on(event: 'data', handler: (data: Buffer) => void): this {
    return super.on(event, handler);
  }
}

class FakeProcess extends EventEmitter implements UniverseProcessRunnerProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;

  on(event: 'close', handler: (code: number | null) => void | Promise<void>): this {
    return super.on(event, handler);
  }

  kill(): void {
    this.killed = true;
  }

  emitClose(code: number | null): void {
    this.emit('close', code);
  }
}

function createJob(type: UniverseJob['type'] = 'build'): UniverseJob {
  return {
    type,
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
    progress: 0,
    progress_label: 'Starting...',
  };
}

function createCommand(): UniverseJobCommand {
  return {
    command: 'py',
    args: ['-u', 'script.py'],
    cwd: 'C:\\repo\\backend\\services',
  };
}

function createFakeSpawner(fake: FakeProcess): SpawnUniverseProcess {
  return (command, args, options) => {
    assert.equal(command, 'py');
    assert.deepEqual(args, ['-u', 'script.py']);
    assert.deepEqual(options, { cwd: 'C:\\repo\\backend\\services' });
    return fake;
  };
}

async function waitForCloseHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testAttachesOutputAndCompletesSuccess(): Promise<void> {
  const fake = new FakeProcess();
  const job = createJob();
  let cleared = false;
  const process = startUniverseProcessJob({
    command: createCommand(),
    job,
    spawnProcess: createFakeSpawner(fake),
    successLabel: 'Build complete.',
    onProcessClosed: () => {
      cleared = true;
    },
  });

  assert.equal(process, fake);
  fake.stdout.emit('data', Buffer.from('hello\n'));
  fake.stderr.emit('data', Buffer.from('bad\n'));
  fake.emitClose(0);
  await waitForCloseHandlers();

  assert.deepEqual(job.log, ['hello', '[err] bad']);
  assert.equal(job.status, 'completed');
  assert.equal(job.progress, 100);
  assert.equal(job.progress_label, 'Build complete.');
  assert.equal(cleared, true);
}

async function testCompletesFailureWithoutSuccessHook(): Promise<void> {
  const fake = new FakeProcess();
  const job = createJob('update');
  let successHookCalled = false;
  let cleared = false;

  startUniverseProcessJob({
    command: createCommand(),
    job,
    spawnProcess: createFakeSpawner(fake),
    successLabel: 'Update complete.',
    afterSuccessfulClose: () => {
      successHookCalled = true;
    },
    onProcessClosed: () => {
      cleared = true;
    },
  });

  fake.emitClose(2);
  await waitForCloseHandlers();

  assert.equal(job.status, 'failed');
  assert.equal(job.progress_label, 'Failed (exit code 2)');
  assert.equal(job.error, 'Process exited with code 2');
  assert.equal(successHookCalled, false);
  assert.equal(cleared, true);
}

async function testRunsSuccessHookBeforeClearing(): Promise<void> {
  const fake = new FakeProcess();
  const job = createJob('classify_regimes');
  const events: string[] = [];

  startUniverseProcessJob({
    command: createCommand(),
    job,
    spawnProcess: createFakeSpawner(fake),
    successLabel: 'Regime classification complete.',
    useRegimeStdout: true,
    afterSuccessfulClose: async (closedJob) => {
      events.push(`hook:${closedJob.status}`);
      closedJob.metrics = { optionable_so_far: 3 };
    },
    onProcessClosed: () => {
      events.push(`clear:${job.metrics?.optionable_so_far}`);
    },
  });

  fake.stdout.emit('data', Buffer.from('[20/40] regimes so far: expansion=3\n'));
  fake.emitClose(0);
  await waitForCloseHandlers();

  assert.equal(job.status, 'completed');
  assert.equal(job.metrics?.optionable_so_far, 3);
  assert.deepEqual(events, ['hook:completed', 'clear:3']);
}

function testReturnedProcessStillSupportsKill(): void {
  const fake = new FakeProcess();
  const job = createJob();
  const process = startUniverseProcessJob({
    command: createCommand(),
    job,
    spawnProcess: createFakeSpawner(fake),
    successLabel: 'Build complete.',
  });

  process.kill?.();

  assert.equal(fake.killed, true);
}

async function runTests(): Promise<void> {
  await testAttachesOutputAndCompletesSuccess();
  await testCompletesFailureWithoutSuccessHook();
  await testRunsSuccessHookBeforeClearing();
  testReturnedProcessStillSupportsKill();
}

runTests()
  .then(() => console.log('universeProcessRunner tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
