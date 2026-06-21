import assert from 'assert';
import { EventEmitter } from 'events';
import * as path from 'path';
import { createUniverseRouteContext } from './universeRouteContext';
import { UniverseProcessRunnerProcess } from './universeProcessRunner';

class FakeStream extends EventEmitter {
  setEncoding(_encoding: string) {}
}

class FakeProcess extends EventEmitter implements UniverseProcessRunnerProcess {
  stdout = new FakeStream();
  stderr = new FakeStream();
  kill() {
    return true;
  }
}

function main() {
  const baseDir = path.join('repo', 'backend');
  const child = new FakeProcess();
  const context = createUniverseRouteContext(baseDir, () => child);

  assert.strictEqual(context.routeConfig.dataDir, path.join(baseDir, 'data', 'universe'));
  assert.strictEqual(context.activeState.getJob(), null);
  assert.strictEqual(typeof context.startUniverseRouteProcess, 'function');
  assert.strictEqual(typeof context.universePriceSnapshotService.buildUniversePriceSnapshot, 'function');
  console.log('universeRouteContext tests passed');
}

main();
