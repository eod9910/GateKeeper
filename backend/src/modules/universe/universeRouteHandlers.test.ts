import assert from 'assert';
import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { createUniverseRouteHandlers } from './universeRouteHandlers';
import { UniverseActiveJobState } from './universeActiveJobState';
import { createUniverseRouteConfig } from './universeRouteConfig';
import { UniverseRouteContext } from './universeRouteContext';
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

class FakeResponse {
  statusCode = 200;
  body: unknown;

  status(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    return this;
  }
}

function createRequest(body: unknown = {}, query: unknown = {}) {
  return { body, query } as Request;
}

function createResponse() {
  return new FakeResponse() as unknown as Response & FakeResponse;
}

function createContext() {
  const processes: FakeProcess[] = [];
  const context: UniverseRouteContext = {
    routeConfig: createUniverseRouteConfig('repo/backend'),
    activeState: new UniverseActiveJobState(),
    startUniverseRouteProcess: () => {
      const process = new FakeProcess();
      processes.push(process);
      return process;
    },
    universePriceSnapshotService: {
      buildUniversePriceSnapshot: async () => {
        throw new Error('buildUniversePriceSnapshot should not run in these tests');
      },
    },
  };

  return { context, processes };
}

async function testBuildStartsJob() {
  const { context, processes } = createContext();
  const handlers = createUniverseRouteHandlers(context);
  const res = createResponse();

  await handlers.build(createRequest({
    source: 'custom',
    lookback: '1y',
    interval: '1d',
    minVolume: 100000,
    workers: 2,
  }), res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(processes.length, 1);
  assert.strictEqual(context.activeState.getJob()?.type, 'build');
  assert.deepStrictEqual(res.body, {
    success: true,
    data: {
      message: 'Build started.',
      job: context.activeState.getJob(),
    },
  });
}

async function testRejectsBuildWhenJobActive() {
  const { context, processes } = createContext();
  const handlers = createUniverseRouteHandlers(context);
  const startRes = createResponse();
  const conflictRes = createResponse();

  await handlers.rebuildOptionable(createRequest({ source: 'custom', workers: 1 }), startRes, () => {});
  await handlers.build(createRequest(), conflictRes, () => {});

  assert.strictEqual(processes.length, 1);
  assert.strictEqual(conflictRes.statusCode, 409);
  assert.deepStrictEqual(conflictRes.body, {
    success: false,
    error: 'A rebuild_optionable job is already running. Wait for it to complete.',
  });
}

function testCancelWithoutActiveJob() {
  const { context } = createContext();
  const handlers = createUniverseRouteHandlers(context);
  const res = createResponse();

  handlers.cancel(createRequest(), res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, {
    success: false,
    error: 'No active job to cancel.',
  });
}

async function testCancelActiveJob() {
  const { context, processes } = createContext();
  const handlers = createUniverseRouteHandlers(context);
  const startRes = createResponse();
  const cancelRes = createResponse();

  await handlers.classifyRegimes(createRequest({ interval: '1h' }), startRes, () => {});
  handlers.cancel(createRequest(), cancelRes, () => {});

  assert.strictEqual(processes.length, 1);
  assert.strictEqual(processes[0].killed, true);
  assert.strictEqual(context.activeState.getJob()?.status, 'failed');
  assert.deepStrictEqual(cancelRes.body, {
    success: true,
    data: { message: 'Job cancelled.' },
  });
}

async function main() {
  await testBuildStartsJob();
  await testRejectsBuildWhenJobActive();
  testCancelWithoutActiveJob();
  await testCancelActiveJob();
  console.log('universeRouteHandlers tests passed');
}

main();
