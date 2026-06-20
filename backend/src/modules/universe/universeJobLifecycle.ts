import { UniverseJob } from './universeJobProgress';

export interface KillableUniverseProcess {
  kill(): unknown;
}

export function completeUniverseJobFromExitCode(
  job: UniverseJob,
  code: number | null,
  successLabel: string,
  completedAt = new Date().toISOString(),
): void {
  job.status = code === 0 ? 'completed' : 'failed';
  job.completed_at = completedAt;
  job.progress = code === 0 ? 100 : job.progress;
  job.progress_label = code === 0 ? successLabel : `Failed (exit code ${code})`;
  job.stage = code === 0 ? 'completed' : 'failed';
  if (code !== 0) {
    job.error = `Process exited with code ${code}`;
  }
}

export function cancelUniverseJob(
  job: UniverseJob,
  completedAt = new Date().toISOString(),
): void {
  job.status = 'failed';
  job.error = 'Cancelled by user';
  job.completed_at = completedAt;
  job.progress_label = 'Cancelled.';
  job.stage = 'failed';
}

export function cancelActiveUniverseJob(
  job: UniverseJob,
  activeProcess: KillableUniverseProcess | null,
  completedAt = new Date().toISOString(),
): null {
  if (activeProcess) {
    activeProcess.kill();
  }
  cancelUniverseJob(job, completedAt);
  return null;
}

export function applyRegimeProgressLine(job: UniverseJob, line: string): void {
  const progressMatch = line.match(/\[(\d+)\/(\d+)\]/);
  if (!progressMatch) return;
  const done = Number(progressMatch[1]);
  const total = Number(progressMatch[2]);
  job.progress = Math.round((done / total) * 90);
  job.progress_label = line.trim();
}
