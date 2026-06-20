import assert from 'assert';
import { EventEmitter } from 'events';
import { createUniverseProcessStarter } from './universeProcessStarter';
import { UniverseJob } from './universeJobProgress';
import { SpawnUniverseProcess, UniverseProcessRunnerProcess } from './universeProcessRunner';

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

async function testStartsWithInjectedSpawnAndCleanup() {
  const job = createJob();
  const child = new FakeProcess();
  let cleared = false;
  let spawnCall: { command: string; args: string[]; cwd?: string } | null = null;
  const spawnProcess: SpawnUniverseProcess = (command, args, options) => {
    spawnCall = { command, args, cwd: options?.cwd };
    return child;
  };
  const startProcess = createUniverseProcessStarter(spawnProcess, () => {
    cleared = true;
  });

  const returned = startProcess({
    command: {
      command: 'py',
      args: ['-u', 'script.py'],
      cwd: 'services',
    },
    job,
    successLabel: 'Done.',
  });

  assert.strictEqual(returned, child);
  assert.deepStrictEqual(spawnCall, {
    command: 'py',
    args: ['-u', 'script.py'],
    cwd: 'services',
  });

  child.emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(cleared, true);
}

async function main() {
  await testStartsWithInjectedSpawnAndCleanup();
  console.log('universeProcessStarter tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
