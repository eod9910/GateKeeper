/**
 * Universe Management API Routes
 * Handles build/update of the optionable scanning universe.
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { UniverseJob } from '../modules/universe/universeJobProgress';
import {
  createOptionableRebuildJob,
  createRegimeClassificationJob,
  createUniverseBuildJob,
  createUniverseUpdateJob,
} from '../modules/universe/universeJobFactory';
import {
  buildUniversePriceSnapshotResponse,
  createUniversePriceSnapshotService,
} from '../modules/universe/universePriceSnapshot';
import {
  buildUniverseStatusSnapshot,
} from '../modules/universe/universeStatusSummary';
import {
  buildOptionableRebuildCommand,
  buildRegimeClassificationCommand,
  buildUniverseBuildCommand,
  buildUniverseUpdateCommand,
  canAccessUniverseFile,
  canReuseOptionableCatalog,
} from '../modules/universe/universeJobCommands';
import {
  cancelActiveUniverseJob,
  getRunningUniverseJobConflict,
} from '../modules/universe/universeJobLifecycle';
import {
  UniverseProcessRunnerProcess,
  startUniverseProcessJob,
} from '../modules/universe/universeProcessRunner';
import {
  applyRegimeSnapshotSummaryMetrics,
  readUniverseRegimeSnapshot,
} from '../modules/universe/universeRegimeSnapshot';

const router = Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'universe');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const OPTIONABLE_PATH = path.join(DATA_DIR, 'optionable.json');
const OPTIONABLE_PROGRESS_PATH = path.join(DATA_DIR, 'optionable-progress.json');
const PRICE_SNAPSHOT_CACHE_PATH = path.join(DATA_DIR, 'prices-cache.json');
const SERVICES_DIR = path.join(__dirname, '..', '..', 'services');
const UNIVERSE_MANIFEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNIVERSE_PRICE_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

let activeJob: UniverseJob | null = null;
let activeProcess: UniverseProcessRunnerProcess | null = null;
const universePriceSnapshotService = createUniversePriceSnapshotService({
  dataDir: DATA_DIR,
  manifestPath: MANIFEST_PATH,
  priceSnapshotCachePath: PRICE_SNAPSHOT_CACHE_PATH,
  priceSnapshotTtlMs: UNIVERSE_PRICE_SNAPSHOT_TTL_MS,
});

// ─── GET /api/universe/status ─────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await buildUniverseStatusSnapshot({
        manifestPath: MANIFEST_PATH,
        optionablePath: OPTIONABLE_PATH,
        optionableProgressPath: OPTIONABLE_PROGRESS_PATH,
        priceSnapshotCachePath: PRICE_SNAPSHOT_CACHE_PATH,
        manifestTtlMs: UNIVERSE_MANIFEST_TTL_MS,
        priceSnapshotTtlMs: UNIVERSE_PRICE_SNAPSHOT_TTL_MS,
        activeJob,
      })
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/prices', async (req: Request, res: Response) => {
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Universe not built yet. Run Build Universe first.'
    });
  }

  try {
    const forceRefresh = String(req.query.force_refresh || '').trim().toLowerCase() === 'true';
    const snapshot = await universePriceSnapshotService.buildUniversePriceSnapshot(forceRefresh);
    const priceResponse = buildUniversePriceSnapshotResponse(snapshot, UNIVERSE_PRICE_SNAPSHOT_TTL_MS);
    res.json({
      success: true,
      ...priceResponse,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/universe/build ─────────────────────────────────────────────────
router.post('/build', async (req: Request, res: Response) => {
  const conflict = getRunningUniverseJobConflict(activeJob);
  if (conflict) return res.status(409).json(conflict);

  const {
    lookback = '5y',
    interval = '1d',
    min_volume = 0,
    workers = 10,
    source = 'nasdaq-trader-us',
  } = req.body;

  const canReuseOptionable = await canReuseOptionableCatalog(OPTIONABLE_PATH);

  activeJob = createUniverseBuildJob({
    source: String(source),
    lookback: String(lookback),
    interval: String(interval),
    workers: Number(workers),
    minVolume: Number(min_volume),
  });

  const command = buildUniverseBuildCommand({
    servicesDir: SERVICES_DIR,
    source: String(source),
    lookback: String(lookback),
    interval: String(interval),
    minVolume: String(min_volume),
    workers: String(workers),
    skipOptionsCheck: canReuseOptionable,
  });

  activeProcess = startUniverseProcessJob({
    command,
    job: activeJob,
    spawnProcess: spawn,
    successLabel: 'Build complete.',
    onProcessClosed: () => {
      activeProcess = null;
    },
  });

  res.json({ success: true, data: { message: 'Build started.', job: activeJob } });
});

// ─── POST /api/universe/update ────────────────────────────────────────────────
router.post('/rebuild-optionable', async (req: Request, res: Response) => {
  const conflict = getRunningUniverseJobConflict(activeJob);
  if (conflict) return res.status(409).json(conflict);

  const {
    workers = 5,
    source = 'nasdaq-trader-us',
  } = req.body || {};

  activeJob = createOptionableRebuildJob({
    source: String(source),
    workers: Number(workers),
  });

  const command = buildOptionableRebuildCommand({
    servicesDir: SERVICES_DIR,
    source: String(source),
    workers: String(workers),
  });

  activeProcess = startUniverseProcessJob({
    command,
    job: activeJob,
    spawnProcess: spawn,
    successLabel: 'Optionable subset rebuild complete.',
    onProcessClosed: () => {
      activeProcess = null;
    },
  });

  res.json({ success: true, data: { message: 'Optionable subset rebuild started.', job: activeJob } });
});

router.post('/update', async (req: Request, res: Response) => {
  const conflict = getRunningUniverseJobConflict(activeJob, false);
  if (conflict) return res.status(409).json(conflict);

  if (!(await canAccessUniverseFile(MANIFEST_PATH))) {
    return res.status(400).json({
      success: false,
      error: 'Universe not built yet. Run Build Universe first.'
    });
  }

  const { interval = '1d' } = req.body;

  activeJob = createUniverseUpdateJob({
    interval: String(interval),
  });

  const command = buildUniverseUpdateCommand({
    servicesDir: SERVICES_DIR,
    interval: String(interval),
  });

  activeProcess = startUniverseProcessJob({
    command,
    job: activeJob,
    spawnProcess: spawn,
    successLabel: 'Update complete.',
    onProcessClosed: () => {
      activeProcess = null;
    },
  });

  res.json({ success: true, data: { message: 'Update started.', job: activeJob } });
});

// ─── POST /api/universe/classify-regimes ─────────────────────────────────────
// Runs build_regime_universes.py to classify all universe stocks by market phase
// (expansion / distribution / accumulation / markdown) and save the JSON files.
router.post('/classify-regimes', async (req: Request, res: Response) => {
  const conflict = getRunningUniverseJobConflict(activeJob);
  if (conflict) return res.status(409).json(conflict);

  const { interval = '1d' } = req.body || {};

  activeJob = createRegimeClassificationJob({
    interval: String(interval),
  });

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'build_regime_universes.py');
  const command = buildRegimeClassificationCommand({
    scriptPath,
    interval: String(interval),
  });

  activeProcess = startUniverseProcessJob({
    command,
    job: activeJob,
    spawnProcess: spawn,
    successLabel: 'Regime classification complete.',
    useRegimeStdout: true,
    afterSuccessfulClose: async (job) => {
      const snapshotPath = path.join(__dirname, '..', '..', 'data', 'regime_snapshot.json');
      await applyRegimeSnapshotSummaryMetrics(job, snapshotPath);
    },
    onProcessClosed: () => {
      activeProcess = null;
    },
  });

  res.json({ success: true, data: { message: 'Regime classification started.', job: activeJob } });
});

// ─── GET /api/universe/regime-snapshot ───────────────────────────────────────
// Returns the latest regime snapshot metadata (counts + generated_at timestamp).
router.get('/regime-snapshot', async (req: Request, res: Response) => {
  const snapshotPath = path.join(__dirname, '..', '..', 'data', 'regime_snapshot.json');
  const snapshot = await readUniverseRegimeSnapshot(snapshotPath);
  res.json({ success: true, data: snapshot });
});

// ─── DELETE /api/universe/cancel ─────────────────────────────────────────────
router.delete('/cancel', (req: Request, res: Response) => {
  if (!activeJob || activeJob.status !== 'running') {
    return res.status(400).json({ success: false, error: 'No active job to cancel.' });
  }
  activeProcess = cancelActiveUniverseJob(activeJob, activeProcess);
  res.json({ success: true, data: { message: 'Job cancelled.' } });
});

export default router;
