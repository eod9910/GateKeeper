import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import {
  buildMissingUniverseApiResponse,
  buildNoActiveUniverseJobApiResponse,
  buildUniverseErrorApiBody,
  buildUniverseJobCancelledApiBody,
  buildUniverseJobStartedApiBody,
  buildUniversePricesApiResponse,
  buildUniverseStatusApiBody,
  buildUniverseSuccessApiBody,
} from '../modules/universe/universeRouteResponses';
import {
  parseOptionableRebuildRequestParams,
  parseRegimeClassificationRequestParams,
  parseUniverseBuildRequestParams,
  parseUniverseForceRefreshQuery,
  parseUniverseUpdateRequestParams,
} from '../modules/universe/universeRequestParams';
import {
  canAccessUniverseFile,
  canReuseOptionableCatalog,
} from '../modules/universe/universeJobCommands';
import {
  createOptionableRebuildPlan,
  createRegimeClassificationPlan,
  createUniverseBuildPlan,
  createUniverseUpdatePlan,
} from '../modules/universe/universeJobPlans';
import {
  createUniverseRouteContext,
  UniverseRouteContext,
} from '../modules/universe/universeRouteContext';
import {
  readUniverseRegimeSnapshot,
} from '../modules/universe/universeRegimeSnapshot';

export function createUniverseRouter(context: UniverseRouteContext): Router {
  const router = Router();
  const {
    routeConfig,
    activeState,
    startUniverseRouteProcess,
    universePriceSnapshotService,
  } = context;

  router.get('/status', async (_req: Request, res: Response) => {
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
  });

  router.get('/prices', async (req: Request, res: Response) => {
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
  });

  router.post('/build', async (req: Request, res: Response) => {
    const conflict = activeState.getConflict();
    if (conflict) return res.status(409).json(conflict);

    const params = parseUniverseBuildRequestParams(req.body);
    const canReuseOptionable = await canReuseOptionableCatalog(routeConfig.optionablePath);
    const job = activeState.startPlan(createUniverseBuildPlan(params, routeConfig, canReuseOptionable), startUniverseRouteProcess);

    res.json(buildUniverseJobStartedApiBody('Build started.', job));
  });

  router.post('/rebuild-optionable', async (req: Request, res: Response) => {
    const conflict = activeState.getConflict();
    if (conflict) return res.status(409).json(conflict);

    const params = parseOptionableRebuildRequestParams(req.body);
    const job = activeState.startPlan(createOptionableRebuildPlan(params, routeConfig), startUniverseRouteProcess);

    res.json(buildUniverseJobStartedApiBody('Optionable subset rebuild started.', job));
  });

  router.post('/update', async (req: Request, res: Response) => {
    const conflict = activeState.getConflict(false);
    if (conflict) return res.status(409).json(conflict);

    if (!(await canAccessUniverseFile(routeConfig.manifestPath))) {
      const response = buildMissingUniverseApiResponse();
      return res.status(response.statusCode).json(response.body);
    }

    const params = parseUniverseUpdateRequestParams(req.body);
    const job = activeState.startPlan(createUniverseUpdatePlan(params, routeConfig), startUniverseRouteProcess);

    res.json(buildUniverseJobStartedApiBody('Update started.', job));
  });

  router.post('/classify-regimes', async (req: Request, res: Response) => {
    const conflict = activeState.getConflict();
    if (conflict) return res.status(409).json(conflict);

    const params = parseRegimeClassificationRequestParams(req.body);
    const job = activeState.startPlan(createRegimeClassificationPlan(params, routeConfig), startUniverseRouteProcess);

    res.json(buildUniverseJobStartedApiBody('Regime classification started.', job));
  });

  router.get('/regime-snapshot', async (_req: Request, res: Response) => {
    const snapshot = await readUniverseRegimeSnapshot(routeConfig.regimeSnapshotPath);
    res.json(buildUniverseSuccessApiBody(snapshot));
  });

  router.delete('/cancel', (_req: Request, res: Response) => {
    if (!activeState.canCancel()) {
      const response = buildNoActiveUniverseJobApiResponse();
      return res.status(response.statusCode).json(response.body);
    }
    activeState.cancel();
    res.json(buildUniverseJobCancelledApiBody());
  });

  return router;
}

const defaultContext = createUniverseRouteContext(path.join(__dirname, '..', '..'), spawn);

export default createUniverseRouter(defaultContext);
