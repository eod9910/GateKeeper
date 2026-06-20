/**
 * Universe Management API Routes
 * Handles build/update of the optionable scanning universe.
 */

import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  CacheEnvelope,
  buildFreshnessInfo,
  readCacheEnvelope,
} from '../services/cacheService';
import {
  UniverseJob,
  clampUniverseProgress,
} from '../modules/universe/universeJobProgress';
import {
  createOptionableRebuildJob,
  createRegimeClassificationJob,
  createUniverseBuildJob,
  createUniverseUpdateJob,
} from '../modules/universe/universeJobFactory';
import { getOptionableCatalogMeta } from '../modules/universe/universeCatalogMeta';
import {
  UniversePriceSnapshot,
  buildUniverseFreshness,
  createUniversePriceSnapshotService,
} from '../modules/universe/universePriceSnapshot';
import { summarizeUniverseManifest } from '../modules/universe/universeStatusSummary';
import {
  buildOptionableRebuildCommand,
  buildRegimeClassificationCommand,
  buildUniverseBuildCommand,
  buildUniverseUpdateCommand,
} from '../modules/universe/universeJobCommands';
import {
  cancelActiveUniverseJob,
  completeUniverseJobFromExitCode,
} from '../modules/universe/universeJobLifecycle';
import {
  appendRegimeStdoutChunk,
  appendUniverseStderrChunk,
  appendUniverseStdoutChunk,
} from '../modules/universe/universeProcessOutput';
import { readUniverseRegimeSnapshot } from '../modules/universe/universeRegimeSnapshot';

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
let activeProcess: ChildProcess | null = null;
const universePriceSnapshotService = createUniversePriceSnapshotService({
  dataDir: DATA_DIR,
  manifestPath: MANIFEST_PATH,
  priceSnapshotCachePath: PRICE_SNAPSHOT_CACHE_PATH,
  priceSnapshotTtlMs: UNIVERSE_PRICE_SNAPSHOT_TTL_MS,
});

// ─── GET /api/universe/status ─────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response) => {
  try {
    let manifest: any = null;
    let optionableCount = 0;
    let optionableClassifiedCount = 0;
    let optionableUnclassifiedCount = 0;
    let optionableComplete = true;
    let sourceSymbolCount = 0;
    let lastUpdated: string | null = null;
    let symbolCount = 0;
    let staleCount = 0;
    let source: string | null = null;
    let sourceLabel: string | null = null;

    try {
      const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
      manifest = JSON.parse(raw);
      const summary = summarizeUniverseManifest(manifest);
      symbolCount = summary.symbolCount;
      sourceSymbolCount = summary.sourceSymbolCount;
      lastUpdated = summary.lastUpdated;
      source = summary.source;
      sourceLabel = summary.sourceLabel;
      staleCount = summary.staleCount;
    } catch {
      // manifest doesn't exist yet
    }

    try {
      const raw = await fs.readFile(OPTIONABLE_PATH, 'utf-8');
      const opt = JSON.parse(raw);
      const optionableSource = String(opt?.source || '').trim();
      const manifestSource = String(manifest?.source || '').trim();
      const sourceMatchesManifest = !manifestSource || !optionableSource || optionableSource === manifestSource;
      if (sourceMatchesManifest) {
        const meta = getOptionableCatalogMeta(opt);
        optionableCount = meta.optionableCount;
        optionableClassifiedCount = meta.classifiedCount;
        optionableUnclassifiedCount = meta.unclassifiedCount;
        optionableComplete = meta.complete;
        sourceSymbolCount = Number(meta.sourceSymbolCount || sourceSymbolCount || 0);
      }
    } catch {
      // optionable list doesn't exist yet
    }

    try {
      const raw = await fs.readFile(OPTIONABLE_PROGRESS_PATH, 'utf-8');
      const progressOpt = JSON.parse(raw);
      const optionableSource = String(progressOpt?.source || '').trim();
      const manifestSource = String(manifest?.source || '').trim();
      const sourceMatchesManifest = !manifestSource || !optionableSource || optionableSource === manifestSource;
      if (sourceMatchesManifest) {
        const meta = getOptionableCatalogMeta(progressOpt);
        const shouldPreferProgress =
          activeJob?.type === 'rebuild_optionable' ||
          activeJob?.stage === 'checking_optionability' ||
          activeJob?.stage === 'retrying_unknown' ||
          meta.classifiedCount > optionableClassifiedCount;
        if (shouldPreferProgress) {
          optionableCount = meta.optionableCount;
          optionableClassifiedCount = meta.classifiedCount;
          optionableUnclassifiedCount = meta.unclassifiedCount;
          optionableComplete = meta.complete;
          sourceSymbolCount = Number(meta.sourceSymbolCount || sourceSymbolCount || 0);
        }
        if (activeJob && activeJob.status === 'running' && activeJob.type === 'rebuild_optionable') {
          if (!activeJob.metrics) activeJob.metrics = {};
          activeJob.stage = meta.complete ? 'completed' : 'checking_optionability';
          activeJob.metrics.option_total = meta.sourceSymbolCount;
          activeJob.metrics.option_checked = meta.classifiedCount;
          activeJob.metrics.optionable_so_far = meta.optionableCount;
          activeJob.progress = clampUniverseProgress(
            meta.sourceSymbolCount > 0 ? 5 + (meta.classifiedCount / meta.sourceSymbolCount) * 50 : (activeJob.progress ?? 5)
          );
          activeJob.progress_label = meta.complete
            ? `Optionable subset rebuilt: ${meta.optionableCount} optionable`
            : `Option chains checked for ${meta.classifiedCount.toLocaleString()} / ${meta.sourceSymbolCount.toLocaleString()} symbols`;
          activeJob.last_log_at = progressOpt?.generated_at || activeJob.last_log_at;
        }
      }
    } catch {
      // progress file doesn't exist yet
    }

    const built = symbolCount > 0;
    const needsUpdate = built && staleCount > 0;
    const manifestFreshness = buildUniverseFreshness(lastUpdated, UNIVERSE_MANIFEST_TTL_MS);
    let priceSnapshotFreshness = buildFreshnessInfo({
      ttlMs: UNIVERSE_PRICE_SNAPSHOT_TTL_MS,
      cacheLayer: 'missing',
      sourceStatus: 'missing',
    });
    try {
      const cacheEntry = await readCacheEnvelope<UniversePriceSnapshot>(PRICE_SNAPSHOT_CACHE_PATH);
      if (cacheEntry) {
        priceSnapshotFreshness = buildFreshnessInfo({
          fetchedAt: cacheEntry.fetchedAt,
          ttlMs: cacheEntry.ttlMs,
          cacheLayer: 'disk',
          cacheKey: cacheEntry.key,
          version: cacheEntry.version,
        });
      }
    } catch {
      // no persisted price snapshot yet
    }

    res.json({
      success: true,
      data: {
        built,
        source_symbol_count: sourceSymbolCount,
        symbol_count: symbolCount,
        downloaded_symbol_count: symbolCount,
        optionable_count: optionableCount,
        optionable_classified_count: optionableClassifiedCount,
        optionable_unclassified_count: optionableUnclassifiedCount,
        optionable_complete: optionableComplete,
        source,
        source_label: sourceLabel,
        last_updated: lastUpdated,
        stale_count: staleCount,
        needs_update: needsUpdate,
        freshness: {
          manifest: manifestFreshness,
          prices: priceSnapshotFreshness,
        },
        active_job: activeJob ? {
          type: activeJob.type,
          status: activeJob.status,
          started_at: activeJob.started_at,
          completed_at: activeJob.completed_at,
          elapsed_seconds: Math.max(
            0,
            Math.floor(
              ((activeJob.completed_at ? new Date(activeJob.completed_at) : new Date()).getTime() - new Date(activeJob.started_at).getTime()) /
              1000
            )
          ),
          progress: activeJob.progress ?? null,
          progress_label: activeJob.progress_label ?? null,
          stage: activeJob.stage ?? null,
          source: activeJob.source ?? null,
          source_label: activeJob.source_label ?? null,
          interval: activeJob.interval ?? null,
          lookback: activeJob.lookback ?? null,
          workers: activeJob.workers ?? null,
          min_volume: activeJob.min_volume ?? null,
          metrics: activeJob.metrics ?? null,
          last_log_at: activeJob.last_log_at ?? null,
          log_tail: activeJob.log.slice(-60),
          log_count: activeJob.log.length,
          error: activeJob.error,
        } : null,
      }
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
    const freshness = buildFreshnessInfo({
      fetchedAt: snapshot.fetchedAt,
      ttlMs: UNIVERSE_PRICE_SNAPSHOT_TTL_MS,
      cacheLayer: snapshot.cacheLayer,
      cacheKey: snapshot.cacheKey,
      version: 1,
    });
    res.json({
      success: true,
      data: {
        count: Object.keys(snapshot.data).length,
        prices: snapshot.data,
        freshness,
      },
      freshness,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/universe/build ─────────────────────────────────────────────────
router.post('/build', async (req: Request, res: Response) => {
  if (activeJob && activeJob.status === 'running') {
    return res.status(409).json({
      success: false,
      error: `A ${activeJob.type} job is already running. Wait for it to complete.`
    });
  }

  const {
    lookback = '5y',
    interval = '1d',
    min_volume = 0,
    workers = 10,
    source = 'nasdaq-trader-us',
  } = req.body;

  let canReuseOptionable = false;
  try {
    await fs.access(OPTIONABLE_PATH);
    canReuseOptionable = true;
  } catch {
    canReuseOptionable = false;
  }

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

  activeProcess = spawn(command.command, command.args, { cwd: command.cwd });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    appendUniverseStdoutChunk(activeJob!, data);
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    appendUniverseStderrChunk(activeJob!, data);
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      completeUniverseJobFromExitCode(activeJob, code, 'Build complete.');
    }
    activeProcess = null;
  });

  res.json({ success: true, data: { message: 'Build started.', job: activeJob } });
});

// ─── POST /api/universe/update ────────────────────────────────────────────────
router.post('/rebuild-optionable', async (req: Request, res: Response) => {
  if (activeJob && activeJob.status === 'running') {
    return res.status(409).json({
      success: false,
      error: `A ${activeJob.type} job is already running. Wait for it to complete.`
    });
  }

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

  activeProcess = spawn(command.command, command.args, { cwd: command.cwd });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    appendUniverseStdoutChunk(activeJob!, data);
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    appendUniverseStderrChunk(activeJob!, data);
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      completeUniverseJobFromExitCode(activeJob, code, 'Optionable subset rebuild complete.');
    }
    activeProcess = null;
  });

  res.json({ success: true, data: { message: 'Optionable subset rebuild started.', job: activeJob } });
});

router.post('/update', async (req: Request, res: Response) => {
  if (activeJob && activeJob.status === 'running') {
    return res.status(409).json({
      success: false,
      error: `A ${activeJob.type} job is already running.`
    });
  }

  // Check manifest exists
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
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

  activeProcess = spawn(command.command, command.args, { cwd: command.cwd });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    appendUniverseStdoutChunk(activeJob!, data);
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    appendUniverseStderrChunk(activeJob!, data);
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      completeUniverseJobFromExitCode(activeJob, code, 'Update complete.');
    }
    activeProcess = null;
  });

  res.json({ success: true, data: { message: 'Update started.', job: activeJob } });
});

// ─── POST /api/universe/classify-regimes ─────────────────────────────────────
// Runs build_regime_universes.py to classify all universe stocks by market phase
// (expansion / distribution / accumulation / markdown) and save the JSON files.
router.post('/classify-regimes', async (req: Request, res: Response) => {
  if (activeJob && activeJob.status === 'running') {
    return res.status(409).json({
      success: false,
      error: `A ${activeJob.type} job is already running. Wait for it to complete.`
    });
  }

  const { interval = '1d' } = req.body || {};

  activeJob = createRegimeClassificationJob({
    interval: String(interval),
  });

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'build_regime_universes.py');
  const command = buildRegimeClassificationCommand({
    scriptPath,
    interval: String(interval),
  });

  activeProcess = spawn(command.command, command.args);

  activeProcess.stdout?.on('data', (data: Buffer) => {
    appendRegimeStdoutChunk(activeJob!, data);
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    appendUniverseStderrChunk(activeJob!, data);
  });

  activeProcess.on('close', async (code: number | null) => {
    if (activeJob) {
      completeUniverseJobFromExitCode(activeJob, code, 'Regime classification complete.');

      // Parse final summary counts from the snapshot file
      if (code === 0) {
        try {
          const snapshotPath = path.join(__dirname, '..', '..', 'data', 'regime_snapshot.json');
          const raw = await fs.readFile(snapshotPath, 'utf-8');
          const snap = JSON.parse(raw);
          activeJob.metrics = snap.summary || {};
        } catch {
          // Non-fatal
        }
      }
    }
    activeProcess = null;
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
