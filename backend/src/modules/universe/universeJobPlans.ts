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

export interface UniverseJobPlan {
  job: UniverseJob;
  command: UniverseJobCommand;
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
  };
}
