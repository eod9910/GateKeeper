/**
 * Universe Management API Routes
 * Handles build/update of the optionable scanning universe.
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import {
  createUniversePriceSnapshotService,
} from '../modules/universe/universePriceSnapshot';
import {
  buildMissingUniverseApiResponse,
  buildUniversePricesApiResponse,
  buildUniverseStatusApiData,
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
import { UniverseActiveJobState } from '../modules/universe/universeActiveJobState';
import { createUniverseProcessStarter } from '../modules/universe/universeProcessStarter';
import { createUniverseRouteConfig } from '../modules/universe/universeRouteConfig';
import {
  applyRegimeSnapshotSummaryMetrics,
  readUniverseRegimeSnapshot,
} from '../modules/universe/universeRegimeSnapshot';

const router = Router();

const routeConfig = createUniverseRouteConfig(path.join(__dirname, '..', '..'));

const activeState = new UniverseActiveJobState();
const startUniverseRouteProcess = createUniverseProcessStarter(spawn, () => {
  activeState.clearProcess();
});
const universePriceSnapshotService = createUniversePriceSnapshotService({
  dataDir: routeConfig.dataDir,
  manifestPath: routeConfig.manifestPath,
  priceSnapshotCachePath: routeConfig.priceSnapshotCachePath,
  priceSnapshotTtlMs: routeConfig.priceSnapshotTtlMs,
});

// ─── GET /api/universe/status ─────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await buildUniverseStatusApiData({
        manifestPath: routeConfig.manifestPath,
        optionablePath: routeConfig.optionablePath,
        optionableProgressPath: routeConfig.optionableProgressPath,
        priceSnapshotCachePath: routeConfig.priceSnapshotCachePath,
        manifestTtlMs: routeConfig.manifestTtlMs,
        priceSnapshotTtlMs: routeConfig.priceSnapshotTtlMs,
        activeJob: activeState.getJob(),
      })
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
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
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/universe/build ─────────────────────────────────────────────────
router.post('/build', async (req: Request, res: Response) => {
  const conflict = activeState.getConflict();
  if (conflict) return res.status(409).json(conflict);

  const params = parseUniverseBuildRequestParams(req.body);

  const canReuseOptionable = await canReuseOptionableCatalog(routeConfig.optionablePath);

  const job = activeState.startPlan(createUniverseBuildPlan(params, routeConfig, canReuseOptionable), startUniverseRouteProcess, {
    successLabel: 'Build complete.',
  });

  res.json({ success: true, data: { message: 'Build started.', job } });
});

// ─── POST /api/universe/update ────────────────────────────────────────────────
router.post('/rebuild-optionable', async (req: Request, res: Response) => {
  const conflict = activeState.getConflict();
  if (conflict) return res.status(409).json(conflict);

  const params = parseOptionableRebuildRequestParams(req.body);

  const job = activeState.startPlan(createOptionableRebuildPlan(params, routeConfig), startUniverseRouteProcess, {
    successLabel: 'Optionable subset rebuild complete.',
  });

  res.json({ success: true, data: { message: 'Optionable subset rebuild started.', job } });
});

router.post('/update', async (req: Request, res: Response) => {
  const conflict = activeState.getConflict(false);
  if (conflict) return res.status(409).json(conflict);

  if (!(await canAccessUniverseFile(routeConfig.manifestPath))) {
    const response = buildMissingUniverseApiResponse();
    return res.status(response.statusCode).json(response.body);
  }

  const params = parseUniverseUpdateRequestParams(req.body);

  const job = activeState.startPlan(createUniverseUpdatePlan(params, routeConfig), startUniverseRouteProcess, {
    successLabel: 'Update complete.',
  });

  res.json({ success: true, data: { message: 'Update started.', job } });
});

// ─── POST /api/universe/classify-regimes ─────────────────────────────────────
// Runs build_regime_universes.py to classify all universe stocks by market phase
// (expansion / distribution / accumulation / markdown) and save the JSON files.
router.post('/classify-regimes', async (req: Request, res: Response) => {
  const conflict = activeState.getConflict();
  if (conflict) return res.status(409).json(conflict);

  const params = parseRegimeClassificationRequestParams(req.body);

  const job = activeState.startPlan(createRegimeClassificationPlan(params, routeConfig), startUniverseRouteProcess, {
    successLabel: 'Regime classification complete.',
    useRegimeStdout: true,
    afterSuccessfulClose: async (job) => {
      await applyRegimeSnapshotSummaryMetrics(job, routeConfig.regimeSnapshotPath);
    },
  });

  res.json({ success: true, data: { message: 'Regime classification started.', job } });
});

// ─── GET /api/universe/regime-snapshot ───────────────────────────────────────
// Returns the latest regime snapshot metadata (counts + generated_at timestamp).
router.get('/regime-snapshot', async (req: Request, res: Response) => {
  const snapshot = await readUniverseRegimeSnapshot(routeConfig.regimeSnapshotPath);
  res.json(buildUniverseSuccessApiBody(snapshot));
});

// ─── DELETE /api/universe/cancel ─────────────────────────────────────────────
router.delete('/cancel', (req: Request, res: Response) => {
  const job = activeState.getJob();
  if (!job || job.status !== 'running') {
    return res.status(400).json({ success: false, error: 'No active job to cancel.' });
  }
  activeState.cancel();
  res.json({ success: true, data: { message: 'Job cancelled.' } });
});

export default router;
