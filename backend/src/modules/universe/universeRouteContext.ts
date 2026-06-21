import {
  createUniversePriceSnapshotService,
} from './universePriceSnapshot';
import { SpawnUniverseProcess } from './universeProcessRunner';
import { createUniverseProcessStarter } from './universeProcessStarter';
import { UniverseActiveJobState } from './universeActiveJobState';
import {
  UniverseRouteConfig,
  createUniverseRouteConfig,
} from './universeRouteConfig';

export interface UniverseRouteContext {
  routeConfig: UniverseRouteConfig;
  activeState: UniverseActiveJobState;
  startUniverseRouteProcess: ReturnType<typeof createUniverseProcessStarter>;
  universePriceSnapshotService: ReturnType<typeof createUniversePriceSnapshotService>;
}

export function createUniverseRouteContext(
  baseDir: string,
  spawnProcess: SpawnUniverseProcess,
): UniverseRouteContext {
  const routeConfig = createUniverseRouteConfig(baseDir);
  const activeState = new UniverseActiveJobState();
  const startUniverseRouteProcess = createUniverseProcessStarter(spawnProcess, () => {
    activeState.clearProcess();
  });
  const universePriceSnapshotService = createUniversePriceSnapshotService({
    dataDir: routeConfig.dataDir,
    manifestPath: routeConfig.manifestPath,
    priceSnapshotCachePath: routeConfig.priceSnapshotCachePath,
    priceSnapshotTtlMs: routeConfig.priceSnapshotTtlMs,
  });

  return {
    routeConfig,
    activeState,
    startUniverseRouteProcess,
    universePriceSnapshotService,
  };
}
