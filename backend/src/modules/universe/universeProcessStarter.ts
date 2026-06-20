import { UniverseJob } from './universeJobProgress';
import { UniverseJobCommand } from './universeJobCommands';
import {
  SpawnUniverseProcess,
  UniverseProcessRunnerProcess,
  startUniverseProcessJob,
} from './universeProcessRunner';

export interface UniverseProcessStartOptions {
  command: UniverseJobCommand;
  job: UniverseJob;
  successLabel: string;
  useRegimeStdout?: boolean;
  afterSuccessfulClose?: (job: UniverseJob) => void | Promise<void>;
}

export function createUniverseProcessStarter(
  spawnProcess: SpawnUniverseProcess,
  onProcessClosed: () => void,
) {
  return function startUniverseRouteProcess(options: UniverseProcessStartOptions): UniverseProcessRunnerProcess {
    return startUniverseProcessJob({
      ...options,
      spawnProcess,
      onProcessClosed,
    });
  };
}
