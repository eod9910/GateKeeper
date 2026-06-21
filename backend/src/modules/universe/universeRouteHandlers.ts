import { Request, RequestHandler, Response } from 'express';
import {
  canAccessUniverseFile,
  canReuseOptionableCatalog,
} from './universeJobCommands';
import {
  createOptionableRebuildPlan,
  createRegimeClassificationPlan,
  createUniverseBuildPlan,
  createUniverseUpdatePlan,
} from './universeJobPlans';
import {
  parseOptionableRebuildRequestParams,
  parseRegimeClassificationRequestParams,
  parseUniverseBuildRequestParams,
  parseUniverseForceRefreshQuery,
  parseUniverseUpdateRequestParams,
} from './universeRequestParams';
import {
  buildMissingUniverseApiResponse,
  buildNoActiveUniverseJobApiResponse,
  buildUniverseErrorApiBody,
  buildUniverseJobCancelledApiBody,
  buildUniverseJobStartedApiBody,
  buildUniversePricesApiResponse,
  buildUniverseStatusApiBody,
  buildUniverseSuccessApiBody,
} from './universeRouteResponses';
import { UniverseRouteContext } from './universeRouteContext';
import { readUniverseRegimeSnapshot } from './universeRegimeSnapshot';

export interface UniverseRouteHandlers {
  status: RequestHandler;
  prices: RequestHandler;
  build: RequestHandler;
  rebuildOptionable: RequestHandler;
  update: RequestHandler;
  classifyRegimes: RequestHandler;
  regimeSnapshot: RequestHandler;
  cancel: RequestHandler;
}

export function createUniverseRouteHandlers(context: UniverseRouteContext): UniverseRouteHandlers {
  const {
    routeConfig,
    activeState,
    startUniverseRouteProcess,
    universePriceSnapshotService,
  } = context;

  return {
    status: async (_req: Request, res: Response) => {
      try {
        res.json(
          await buildUniverseStatusApiBody({
            manifestPath: routeConfig.manifestPath,
            optionablePath: routeConfig.optionablePath,
            optionableProgressPath: routeConfig.optionableProgressPath,
            priceSnapshotCachePath: routeConfig.priceSnapshotCachePath,
            manifestTtlMs: routeConfig.manifestTtlMs,
            priceSnapshotTtlMs: routeConfig.priceSnapshotTtlMs,
            activeJob: activeState.getJob(),
          }),
        );
      } catch (err: unknown) {
        res.status(500).json(buildUniverseErrorApiBody(err));
      }
    },

    prices: async (req: Request, res: Response) => {
      try {
        const response = await buildUniversePricesApiResponse({
          manifestPath: routeConfig.manifestPath,
          priceSnapshotTtlMs: routeConfig.priceSnapshotTtlMs,
          forceRefresh: parseUniverseForceRefreshQuery(req.query),
          canAccessManifest: canAccessUniverseFile,
          buildPriceSnapshot: universePriceSnapshotService.buildUniversePriceSnapshot,
        });
        res.status(response.statusCode).json(response.body);
      } catch (err: unknown) {
        res.status(500).json(buildUniverseErrorApiBody(err));
      }
    },

    build: async (req: Request, res: Response) => {
      const conflict = activeState.getConflict();
      if (conflict) return res.status(409).json(conflict);

      const params = parseUniverseBuildRequestParams(req.body);
      const canReuseOptionable = await canReuseOptionableCatalog(routeConfig.optionablePath);
      const job = activeState.startPlan(createUniverseBuildPlan(params, routeConfig, canReuseOptionable), startUniverseRouteProcess);

      res.json(buildUniverseJobStartedApiBody('Build started.', job));
    },

    rebuildOptionable: async (req: Request, res: Response) => {
      const conflict = activeState.getConflict();
      if (conflict) return res.status(409).json(conflict);

      const params = parseOptionableRebuildRequestParams(req.body);
      const job = activeState.startPlan(createOptionableRebuildPlan(params, routeConfig), startUniverseRouteProcess);

      res.json(buildUniverseJobStartedApiBody('Optionable subset rebuild started.', job));
    },

    update: async (req: Request, res: Response) => {
      const conflict = activeState.getConflict(false);
      if (conflict) return res.status(409).json(conflict);

      if (!(await canAccessUniverseFile(routeConfig.manifestPath))) {
        const response = buildMissingUniverseApiResponse();
        return res.status(response.statusCode).json(response.body);
      }

      const params = parseUniverseUpdateRequestParams(req.body);
      const job = activeState.startPlan(createUniverseUpdatePlan(params, routeConfig), startUniverseRouteProcess);

      res.json(buildUniverseJobStartedApiBody('Update started.', job));
    },

    classifyRegimes: async (req: Request, res: Response) => {
      const conflict = activeState.getConflict();
      if (conflict) return res.status(409).json(conflict);

      const params = parseRegimeClassificationRequestParams(req.body);
      const job = activeState.startPlan(createRegimeClassificationPlan(params, routeConfig), startUniverseRouteProcess);

      res.json(buildUniverseJobStartedApiBody('Regime classification started.', job));
    },

    regimeSnapshot: async (_req: Request, res: Response) => {
      const snapshot = await readUniverseRegimeSnapshot(routeConfig.regimeSnapshotPath);
      res.json(buildUniverseSuccessApiBody(snapshot));
    },

    cancel: (_req: Request, res: Response) => {
      if (!activeState.canCancel()) {
        const response = buildNoActiveUniverseJobApiResponse();
        return res.status(response.statusCode).json(response.body);
      }
      activeState.cancel();
      res.json(buildUniverseJobCancelledApiBody());
    },
  };
}
