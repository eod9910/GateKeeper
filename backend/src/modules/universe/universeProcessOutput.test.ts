import assert from 'assert';
import { EventEmitter } from 'events';
import { UniverseJob } from './universeJobProgress';
import {
  appendRegimeStdoutChunk,
  appendUniverseStderrChunk,
  appendUniverseStdoutChunk,
  attachUniverseProcessOutputHandlers,
} from './universeProcessOutput';

function createJob(): UniverseJob {
  return {
    type: 'build',
    status: 'running',
    started_at: '2026-06-20T00:00:00.000Z',
    log: [],
  };
}

function testStdoutChunkAppendsLines(): void {
  const job = createJob();
  appendUniverseStdoutChunk(job, Buffer.from('line one\nline two\n'));

  assert.deepEqual(job.log, ['line one', 'line two']);
  assert.equal(job.progress_label, 'line two');
}

function testStdoutChunkIgnoresEmptySplitParts(): void {
  const job = createJob();
  appendUniverseStdoutChunk(job, Buffer.from('\n\nline one\n'));

  assert.deepEqual(job.log, ['line one']);
}

function testStderrChunkPrefixesLines(): void {
  const job = createJob();
  appendUniverseStderrChunk(job, Buffer.from('bad one\nbad two\n'));

  assert.deepEqual(job.log, ['[err] bad one', '[err] bad two']);
  assert.equal(job.progress_label, '[err] bad two');
}

function testRegimeStdoutAppliesProgressBeforeAppend(): void {
  const job = createJob();
  job.type = 'classify_regimes';
  appendRegimeStdoutChunk(job, Buffer.from('[20/40] regimes so far: expansion=3\n'));

  assert.deepEqual(job.log, ['[20/40] regimes so far: expansion=3']);
  assert.equal(job.progress, 45);
  assert.equal(job.progress_label, '[20/40] regimes so far: expansion=3');
}

function testRegimeStdoutStillAppendsPlainLines(): void {
  const job = createJob();
  job.type = 'classify_regimes';
  appendRegimeStdoutChunk(job, Buffer.from('plain line\n'));

  assert.deepEqual(job.log, ['plain line']);
  assert.equal(job.progress, undefined);
  assert.equal(job.progress_label, 'plain line');
}

function testAttachOutputHandlersAppendsStdoutAndStderr(): void {
  const job = createJob();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  attachUniverseProcessOutputHandlers({ stdout, stderr }, job);
  stdout.emit('data', Buffer.from('hello\n'));
  stderr.emit('data', Buffer.from('bad\n'));

  assert.deepEqual(job.log, ['hello', '[err] bad']);
}

function testAttachOutputHandlersCanUseRegimeStdout(): void {
  const job = createJob();
  job.type = 'classify_regimes';
  const stdout = new EventEmitter();

  attachUniverseProcessOutputHandlers({ stdout }, job, true);
  stdout.emit('data', Buffer.from('[20/40] regimes so far: expansion=3\n'));

  assert.equal(job.progress, 45);
  assert.deepEqual(job.log, ['[20/40] regimes so far: expansion=3']);
}

function runTests(): void {
  testStdoutChunkAppendsLines();
  testStdoutChunkIgnoresEmptySplitParts();
  testStderrChunkPrefixesLines();
  testRegimeStdoutAppliesProgressBeforeAppend();
  testRegimeStdoutStillAppendsPlainLines();
  testAttachOutputHandlersAppendsStdoutAndStderr();
  testAttachOutputHandlersCanUseRegimeStdout();
}

runTests();
console.log('universeProcessOutput tests passed');
