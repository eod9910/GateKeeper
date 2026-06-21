import {
  createOptionableRebuildJob,
  createRegimeClassificationJob,
  createUniverseBuildJob,
  createUniverseUpdateJob,
} from './universeJobFactory';
import {
  buildOptionableRebuildCommand,
  buildRegimeClassificationCommand,
  buildUniverseBuildCommand,
  buildUniverseUpdateCommand,
  UniverseJobCommand,
} from './universeJobCommands';
import { UniverseJob } from './universeJobProgress';
import { UniverseRouteConfig } from './universeRouteConfig';
import {
  OptionableRebuildRequestParams,
  RegimeClassificationRequestParams,
  UniverseBuildRequestParams,
  UniverseUpdateRequestParams,
} from './universeRequestParams';
import { UniverseProcessStartOptions } from './universeProcessStarter';
import { applyRegimeSnapshotSummaryMetrics } from './universeRegimeSnapshot';

export type UniverseJobPlanStartOptions = Omit<UniverseProcessStartOptions, 'command' | 'job'>;

export interface UniverseJobPlan {
  job: UniverseJob;
  command: UniverseJobCommand;
  startOptions: UniverseJobPlanStartOptions;
}

export function createUniverseBuildPlan(
  params: UniverseBuildRequestParams,
  routeConfig: UniverseRouteConfig,
  canReuseOptionable: boolean,
): UniverseJobPlan {
  return {
    job: createUniverseBuildJob({
      source: params.source,
      lookback: params.lookback,
      interval: params.interval,
      workers: params.workers,
      minVolume: params.minVolume,
    }),
    command: buildUniverseBuildCommand({
      servicesDir: routeConfig.servicesDir,
      source: params.source,
      lookback: params.lookback,
      interval: params.interval,
      minVolume: params.minVolumeArg,
      workers: params.workersArg,
      skipOptionsCheck: canReuseOptionable,
    }),
    startOptions: {
      successLabel: 'Build complete.',
    },
  };
}

export function createOptionableRebuildPlan(
  params: OptionableRebuildRequestParams,
  routeConfig: UniverseRouteConfig,
): UniverseJobPlan {
  return {
    job: createOptionableRebuildJob({
      source: params.source,
      workers: params.workers,
    }),
    command: buildOptionableRebuildCommand({
      servicesDir: routeConfig.servicesDir,
      source: params.source,
      workers: params.workersArg,
    }),
    startOptions: {
      successLabel: 'Optionable subset rebuild complete.',
    },
  };
}

export function createUniverseUpdatePlan(
  params: UniverseUpdateRequestParams,
  routeConfig: UniverseRouteConfig,
): UniverseJobPlan {
  return {
    job: createUniverseUpdateJob({
      interval: params.interval,
    }),
    command: buildUniverseUpdateCommand({
      servicesDir: routeConfig.servicesDir,
      interval: params.interval,
    }),
    startOptions: {
      successLabel: 'Update complete.',
    },
  };
}

export function createRegimeClassificationPlan(
  params: RegimeClassificationRequestParams,
  routeConfig: UniverseRouteConfig,
): UniverseJobPlan {
  return {
    job: createRegimeClassificationJob({
      interval: params.interval,
    }),
    command: buildRegimeClassificationCommand({
      scriptPath: routeConfig.regimeScriptPath,
      interval: params.interval,
    }),
    startOptions: {
      successLabel: 'Regime classification complete.',
      useRegimeStdout: true,
      afterSuccessfulClose: async (job) => {
        await applyRegimeSnapshotSummaryMetrics(job, routeConfig.regimeSnapshotPath);
      },
    },
  };
}
