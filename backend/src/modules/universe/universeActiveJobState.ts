import { UniverseJob } from './universeJobProgress';
import { cancelActiveUniverseJob } from './universeJobLifecycle';
import { UniverseProcessRunnerProcess } from './universeProcessRunner';

export class UniverseActiveJobState {
  private activeJob: UniverseJob | null = null;
  private activeProcess: UniverseProcessRunnerProcess | null = null;

  getJob(): UniverseJob | null {
    return this.activeJob;
  }

  setJob(job: UniverseJob): void {
    this.activeJob = job;
  }

  setProcess(process: UniverseProcessRunnerProcess): void {
    this.activeProcess = process;
  }

  clearProcess(): void {
    this.activeProcess = null;
  }

  cancel(): void {
    if (!this.activeJob) return;
    this.activeProcess = cancelActiveUniverseJob(this.activeJob, this.activeProcess);
  }
}
