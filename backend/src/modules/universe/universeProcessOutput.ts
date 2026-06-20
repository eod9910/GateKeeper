import { UniverseJob, appendUniverseJobLog } from './universeJobProgress';
import { applyRegimeProgressLine } from './universeJobLifecycle';

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
