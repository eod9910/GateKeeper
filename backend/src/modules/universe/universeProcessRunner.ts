import { UniverseJob } from './universeJobProgress';
import { UniverseJobCommand } from './universeJobCommands';
import { completeUniverseJobFromExitCode } from './universeJobLifecycle';
import {
  UniverseProcessWithOutput,
  attachUniverseProcessOutputHandlers,
} from './universeProcessOutput';

export interface UniverseProcessRunnerProcess extends UniverseProcessWithOutput {
  on(event: 'close', handler: (code: number | null) => void | Promise<void>): unknown;
  kill?(): unknown;
}

export type SpawnUniverseProcess = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => UniverseProcessRunnerProcess;

export interface StartUniverseProcessJobOptions {
  command: UniverseJobCommand;
  job: UniverseJob;
  spawnProcess: SpawnUniverseProcess;
  successLabel: string;
  useRegimeStdout?: boolean;
  afterSuccessfulClose?: (job: UniverseJob) => void | Promise<void>;
  onProcessClosed?: () => void;
}

export function startUniverseProcessJob(options: StartUniverseProcessJobOptions): UniverseProcessRunnerProcess {
  const child = options.spawnProcess(
    options.command.command,
    options.command.args,
    options.command.cwd ? { cwd: options.command.cwd } : undefined,
  );

  attachUniverseProcessOutputHandlers(child, options.job, options.useRegimeStdout);

  child.on('close', async (code: number | null) => {
    completeUniverseJobFromExitCode(options.job, code, options.successLabel);
    if (code === 0 && options.afterSuccessfulClose) {
      await options.afterSuccessfulClose(options.job);
    }
    options.onProcessClosed?.();
  });

  return child;
}
