import { UniverseJob } from './universeJobProgress';
import {
  UniverseJobConflict,
  cancelActiveUniverseJob,
  getRunningUniverseJobConflict,
} from './universeJobLifecycle';
import { UniverseProcessRunnerProcess } from './universeProcessRunner';
import { UniverseJobPlan } from './universeJobPlans';
import { UniverseProcessStartOptions } from './universeProcessStarter';

export type StartUniverseJobPlan = (options: UniverseProcessStartOptions) => UniverseProcessRunnerProcess;
export type StartUniverseJobPlanOptions = Omit<UniverseProcessStartOptions, 'command' | 'job'>;

export class UniverseActiveJobState {
  private activeJob: UniverseJob | null = null;
  private activeProcess: UniverseProcessRunnerProcess | null = null;

  getJob(): UniverseJob | null {
    return this.activeJob;
  }

  getConflict(includeWaitMessage = true): UniverseJobConflict | null {
    return getRunningUniverseJobConflict(this.activeJob, includeWaitMessage);
  }

  setJob(job: UniverseJob): void {
    this.activeJob = job;
  }

  setProcess(process: UniverseProcessRunnerProcess): void {
    this.activeProcess = process;
  }

  startPlan(
    plan: UniverseJobPlan,
    startProcess: StartUniverseJobPlan,
    options: StartUniverseJobPlanOptions,
  ): UniverseJob {
    this.setJob(plan.job);
    this.setProcess(startProcess({
      command: plan.command,
      job: plan.job,
      ...options,
    }));
    return plan.job;
  }

  clearProcess(): void {
    this.activeProcess = null;
  }

  cancel(): void {
    if (!this.activeJob) return;
    this.activeProcess = cancelActiveUniverseJob(this.activeJob, this.activeProcess);
  }
}
