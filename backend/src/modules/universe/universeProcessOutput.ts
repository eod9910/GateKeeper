import { UniverseJob, appendUniverseJobLog } from './universeJobProgress';
import { applyRegimeProgressLine } from './universeJobLifecycle';

export interface UniverseProcessOutputStream {
  on(event: 'data', handler: (data: Buffer) => void): unknown;
}

export interface UniverseProcessWithOutput {
  stdout?: UniverseProcessOutputStream | null;
  stderr?: UniverseProcessOutputStream | null;
}

function splitProcessLines(data: Buffer): string[] {
  return data.toString().split('\n').filter(Boolean);
}

export function appendUniverseStdoutChunk(job: UniverseJob, data: Buffer): void {
  const lines = splitProcessLines(data);
  for (const line of lines) {
    appendUniverseJobLog(job, line);
  }
}

export function appendUniverseStderrChunk(job: UniverseJob, data: Buffer): void {
  const lines = splitProcessLines(data);
  for (const line of lines) {
    appendUniverseJobLog(job, `[err] ${line}`);
  }
}

export function appendRegimeStdoutChunk(job: UniverseJob, data: Buffer): void {
  const lines = splitProcessLines(data);
  for (const line of lines) {
    applyRegimeProgressLine(job, line);
    appendUniverseJobLog(job, line);
  }
}

export function attachUniverseProcessOutputHandlers(
  process: UniverseProcessWithOutput,
  job: UniverseJob,
  useRegimeStdout = false,
): void {
  process.stdout?.on('data', (data: Buffer) => {
    if (useRegimeStdout) {
      appendRegimeStdoutChunk(job, data);
    } else {
      appendUniverseStdoutChunk(job, data);
    }
  });

  process.stderr?.on('data', (data: Buffer) => {
    appendUniverseStderrChunk(job, data);
  });
}
