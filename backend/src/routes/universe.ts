/**
 * Universe Management API Routes
 * Handles build/update of the optionable scanning universe.
 */

import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

const router = Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'universe');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const OPTIONABLE_PATH = path.join(DATA_DIR, 'optionable.json');
const OPTIONABLE_PROGRESS_PATH = path.join(DATA_DIR, 'optionable-progress.json');
const SERVICES_DIR = path.join(__dirname, '..', '..', 'services');

// Track active job
interface UniverseJob {
  type: 'build' | 'update' | 'rebuild_optionable';
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  log: string[];
  error?: string;
  progress?: number;
  progress_label?: string;
  stage?: string;
  last_log_at?: string;
  source?: string;
  source_label?: string;
  lookback?: string;
  interval?: string;
  workers?: number;
  min_volume?: number;
  metrics?: {
    source_symbols?: number;
    option_checked?: number;
    option_total?: number;
    optionable_so_far?: number;
    retry_checked?: number;
    retry_total?: number;
    retry_recovered?: number;
    volume_checked?: number;
    volume_total?: number;
    download_batch?: number;
    download_batches?: number;
    download_batch_size?: number;
    download_total?: number;
  };
}

let activeJob: UniverseJob | null = null;
let activeProcess: ChildProcess | null = null;
const MAX_UNIVERSE_LOG_LINES = 400;
let priceSnapshotCache:
  | { cacheKey: string; data: Record<string, { last_close: number; end: string | null; source: string }> }
  | null = null;

function normalizeUniverseSymbols(values: any): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value: any) => String(value || '').trim().toUpperCase())
        .filter((value: string) => !!value)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function getOptionableCatalogMeta(opt: any): {
  optionableCount: number;
  sourceSymbolCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  complete: boolean;
} {
  const optionable = normalizeUniverseSymbols(opt?.optionable || opt?.symbols || []);
  const notOptionable = normalizeUniverseSymbols(opt?.not_optionable || []);
  const sourceSymbols = normalizeUniverseSymbols(opt?.source_symbols || []);
  const unknownSymbols = normalizeUniverseSymbols(
    Array.isArray(opt?.unknown_optionability)
      ? opt.unknown_optionability.map((item: any) => item?.symbol)
      : []
  );
  const classified = new Set([...optionable, ...notOptionable, ...unknownSymbols]);
  const sourceCount = Number(opt?.source_symbol_count || opt?.total_checked || sourceSymbols.length || 0);
  const classifiedCount = Number(opt?.classified_count || classified.size || 0);
  const unclassifiedCount = Number(
    opt?.unclassified_count ?? Math.max(0, sourceCount - classifiedCount)
  );
  const complete = Boolean(opt?.complete_optionability ?? (unclassifiedCount === 0 && sourceCount > 0));
  return {
    optionableCount: Number(opt?.optionable_count || optionable.length || 0),
    sourceSymbolCount: sourceCount,
    classifiedCount,
    unclassifiedCount,
    complete,
  };
}

function getUniverseSourceLabel(source: string): string {
  if (source === 'nasdaq-trader-us') return 'Nasdaq Trader US-listed underlyings';
  if (source === 'russell2000') return 'Russell 2000 optionable';
  if (source === 'custom_csv') return 'Custom ticker list';
  return source || 'Optionable universe';
}

function clampUniverseProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeUniverseProgress(job: UniverseJob): number | undefined {
  const metrics = job.metrics || {};
  switch (job.stage) {
    case 'loading_source':
      return Math.max(job.progress ?? 0, 2);
    case 'checking_optionability':
      if (metrics.option_checked && metrics.option_total) {
        return clampUniverseProgress(5 + (metrics.option_checked / metrics.option_total) * 50);
      }
      return Math.max(job.progress ?? 0, 5);
    case 'retrying_unknown':
      if (metrics.retry_checked && metrics.retry_total) {
        return clampUniverseProgress(55 + (metrics.retry_checked / metrics.retry_total) * 10);
      }
      return Math.max(job.progress ?? 0, 55);
    case 'volume_filter':
      if (metrics.volume_checked && metrics.volume_total) {
        return clampUniverseProgress(65 + (metrics.volume_checked / metrics.volume_total) * 5);
      }
      return Math.max(job.progress ?? 0, 65);
    case 'downloading_history':
      if (metrics.download_batch && metrics.download_batches) {
        return clampUniverseProgress(70 + ((metrics.download_batch - 1) / metrics.download_batches) * 28);
      }
      return Math.max(job.progress ?? 0, 70);
    case 'writing_manifest':
      return Math.max(job.progress ?? 0, 99);
    case 'completed':
      return 100;
    default:
      return job.progress;
  }
}

function updateUniverseJobFromLine(job: UniverseJob, rawLine: string): void {
  const line = rawLine.trim();
  if (!line) return;
  job.last_log_at = new Date().toISOString();
  job.progress_label = line;
  if (!job.metrics) job.metrics = {};

  let match = line.match(/Found (\d+) eligible US-listed/i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Found (\d+) Russell 2000/i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Loaded (\d+) tickers from /i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Checking options availability for (\d+) tickers \((\d+) parallel workers\)/i);
  if (match) {
    job.stage = 'checking_optionability';
    job.metrics.option_total = Number(match[1]);
    job.workers = Number(match[2]);
  }

  match = line.match(/\[\s*(\d+)%\]\s+(\d+)\/(\d+)\s+checked\s+-\s+(\d+)\s+optionable so far/i);
  if (match) {
    job.stage = 'checking_optionability';
    job.metrics.option_checked = Number(match[2]);
    job.metrics.option_total = Number(match[3]);
    job.metrics.optionable_so_far = Number(match[4]);
  }

  if (/Options filter results:/i.test(line)) {
    job.stage = 'options_filtered';
  }

  match = line.match(/Optionable:\s+(\d+)/i);
  if (match && job.stage === 'options_filtered') {
    job.metrics.optionable_so_far = Number(match[1]);
  }

  if (/Retrying unknown optionability results sequentially/i.test(line)) {
    job.stage = 'retrying_unknown';
  }

  match = line.match(/\[retry\s+(\d+)%\]\s+(\d+)\/(\d+)\s+checked\s+-\s+recovered\s+(\d+)/i);
  if (match) {
    job.stage = 'retrying_unknown';
    job.metrics.retry_checked = Number(match[2]);
    job.metrics.retry_total = Number(match[3]);
    job.metrics.retry_recovered = Number(match[4]);
  }

  match = line.match(/Checking 30-day average volume/i);
  if (match) {
    job.stage = 'volume_filter';
  }

  match = line.match(/\[\s*(\d+)%\]\s+(\d+)\/(\d+)\s+checked$/i);
  if (match && job.stage === 'volume_filter') {
    job.metrics.volume_checked = Number(match[2]);
    job.metrics.volume_total = Number(match[3]);
  }

  match = line.match(/Downloading\s+.+\s+history for (\d+) tickers/i);
  if (match) {
    job.stage = 'downloading_history';
    job.metrics.download_total = Number(match[1]);
  }

  match = line.match(/Batch (\d+)\/(\d+) \((\d+) symbols\)\.\.\./i);
  if (match) {
    job.stage = 'downloading_history';
    job.metrics.download_batch = Number(match[1]);
    job.metrics.download_batches = Number(match[2]);
    job.metrics.download_batch_size = Number(match[3]);
  }

  if (/Manifest saved to/i.test(line)) {
    job.stage = 'writing_manifest';
  }

  if (/DONE in /i.test(line)) {
    job.stage = 'completed';
  }

  const explicitPercent = line.match(/\[\s*(\d+)%\]/);
  if (explicitPercent) {
    job.progress = clampUniverseProgress(Number(explicitPercent[1]));
    return;
  }

  const computed = computeUniverseProgress(job);
  if (typeof computed === 'number') {
    job.progress = computed;
  }
}

function appendUniverseJobLog(job: UniverseJob, rawLine: string): void {
  const line = rawLine.trimEnd();
  if (!line.trim()) return;
  job.log.push(line);
  if (job.log.length > MAX_UNIVERSE_LOG_LINES) {
    job.log = job.log.slice(-MAX_UNIVERSE_LOG_LINES);
  }
  updateUniverseJobFromLine(job, line);
}

async function readLastCloseFromCsv(filePath: string): Promise<number | null> {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.size) return null;
      const bytesToRead = Math.min(4096, stat.size);
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, stat.size - bytesToRead);
      const lines = buffer
        .toString('utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (!lastLine) return null;
      const parts = lastLine.split(',');
      const close = Number(parts[4]);
      return Number.isFinite(close) ? close : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function buildUniversePriceSnapshot(): Promise<Record<string, { last_close: number; end: string | null; source: string }>> {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
  const manifest = JSON.parse(raw) || {};
  const symbols = manifest.symbols || {};
  const cacheKey = `${manifest.last_updated || manifest.generated_at || ''}:${Object.keys(symbols).length}`;
  if (priceSnapshotCache?.cacheKey === cacheKey) {
    return priceSnapshotCache.data;
  }

  const interval = String(manifest.interval || '1d');
  const snapshot: Record<string, { last_close: number; end: string | null; source: string }> = {};
  const missing: Array<[string, any]> = [];

  for (const [symbol, meta] of Object.entries(symbols) as Array<[string, any]>) {
    const lastClose = Number(meta?.last_close);
    if (Number.isFinite(lastClose)) {
      snapshot[symbol] = {
        last_close: lastClose,
        end: meta?.end || null,
        source: 'manifest',
      };
    } else {
      missing.push([symbol, meta || {}]);
    }
  }

  const batchSize = 50;
  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async ([symbol, meta]) => {
        const fileName = String(meta?.file || `${symbol}_${interval}.csv`);
        const filePath = path.join(DATA_DIR, fileName);
        const lastClose = await readLastCloseFromCsv(filePath);
        if (Number.isFinite(lastClose)) {
          snapshot[symbol] = {
            last_close: Number(lastClose),
            end: meta?.end || null,
            source: 'csv_tail',
          };
        }
      })
    );
  }

  priceSnapshotCache = { cacheKey, data: snapshot };
  return snapshot;
}

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
      symbolCount = manifest.total_symbols || Object.keys(manifest.symbols || {}).length;
      sourceSymbolCount = Number(manifest.source_symbol_count || 0);
      lastUpdated = manifest.last_updated || manifest.generated_at || null;
      source = manifest.source || null;
      sourceLabel = manifest.source_label || null;

      // Count stale symbols (last bar > 7 days ago)
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      for (const meta of Object.values(manifest.symbols || {}) as any[]) {
        if (meta.end) {
          const end = new Date(meta.end);
          if (end < cutoff) staleCount++;
        }
      }
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
    const prices = await buildUniversePriceSnapshot();
    res.json({
      success: true,
      data: {
        count: Object.keys(prices).length,
        prices,
      }
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

  activeJob = {
    type: 'build',
    status: 'running',
    started_at: new Date().toISOString(),
    log: [],
    progress: 0,
    progress_label: 'Starting build...',
    stage: 'starting',
    source: String(source),
    source_label: getUniverseSourceLabel(String(source)),
    lookback: String(lookback),
    interval: String(interval),
    workers: Number(workers),
    min_volume: Number(min_volume),
    metrics: {},
  };

  const scriptPath = path.join(SERVICES_DIR, 'build_universe.py');
  const args = [
    '-u',
    scriptPath,
    '--source', String(source),
    '--lookback', String(lookback),
    '--interval', String(interval),
    '--min-volume', String(min_volume),
    '--workers', String(workers),
  ];
  if (canReuseOptionable) {
    args.push('--skip-options-check');
  }

  activeProcess = spawn('py', args, { cwd: SERVICES_DIR });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, line);
    }
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, `[err] ${line}`);
    }
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      activeJob.status = code === 0 ? 'completed' : 'failed';
      activeJob.completed_at = new Date().toISOString();
      activeJob.progress = code === 0 ? 100 : activeJob.progress;
      activeJob.progress_label = code === 0 ? 'Build complete.' : `Failed (exit code ${code})`;
      activeJob.stage = code === 0 ? 'completed' : 'failed';
      if (code !== 0) {
        activeJob.error = `Process exited with code ${code}`;
      }
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

  activeJob = {
    type: 'rebuild_optionable',
    status: 'running',
    started_at: new Date().toISOString(),
    log: [],
    progress: 0,
    progress_label: 'Starting optionable subset rebuild...',
    stage: 'starting',
    source: String(source),
    source_label: getUniverseSourceLabel(String(source)),
    lookback: 'n/a',
    interval: '1d',
    workers: Number(workers),
    min_volume: 0,
    metrics: {},
  };

  const scriptPath = path.join(SERVICES_DIR, 'build_universe.py');
  const args = [
    '-u',
    scriptPath,
    '--source', String(source),
    '--interval', '1d',
    '--min-volume', '0',
    '--workers', String(workers),
    '--option-timeout', '8',
    '--options-only',
  ];

  activeProcess = spawn('py', args, { cwd: SERVICES_DIR });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, line);
    }
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, `[err] ${line}`);
    }
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      activeJob.status = code === 0 ? 'completed' : 'failed';
      activeJob.completed_at = new Date().toISOString();
      activeJob.progress = code === 0 ? 100 : activeJob.progress;
      activeJob.progress_label = code === 0 ? 'Optionable subset rebuild complete.' : `Failed (exit code ${code})`;
      activeJob.stage = code === 0 ? 'completed' : 'failed';
      if (code !== 0) {
        activeJob.error = `Process exited with code ${code}`;
      }
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

  activeJob = {
    type: 'update',
    status: 'running',
    started_at: new Date().toISOString(),
    log: [],
    progress: 0,
    progress_label: 'Starting update...',
    stage: 'starting',
    interval: String(interval),
    metrics: {},
  };

  const scriptPath = path.join(SERVICES_DIR, 'update_universe.py');
  const args = ['-u', scriptPath, '--interval', String(interval)];

  activeProcess = spawn('py', args, { cwd: SERVICES_DIR });

  activeProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, line);
    }
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      appendUniverseJobLog(activeJob!, `[err] ${line}`);
    }
  });

  activeProcess.on('close', (code: number | null) => {
    if (activeJob) {
      activeJob.status = code === 0 ? 'completed' : 'failed';
      activeJob.completed_at = new Date().toISOString();
      activeJob.progress = code === 0 ? 100 : activeJob.progress;
      activeJob.progress_label = code === 0 ? 'Update complete.' : `Failed (exit code ${code})`;
      activeJob.stage = code === 0 ? 'completed' : 'failed';
      if (code !== 0) {
        activeJob.error = `Process exited with code ${code}`;
      }
    }
    activeProcess = null;
  });

  res.json({ success: true, data: { message: 'Update started.', job: activeJob } });
});

// ─── DELETE /api/universe/cancel ─────────────────────────────────────────────
router.delete('/cancel', (req: Request, res: Response) => {
  if (!activeJob || activeJob.status !== 'running') {
    return res.status(400).json({ success: false, error: 'No active job to cancel.' });
  }
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
  }
  activeJob.status = 'failed';
  activeJob.error = 'Cancelled by user';
  activeJob.completed_at = new Date().toISOString();
  activeJob.progress_label = 'Cancelled.';
  activeJob.stage = 'failed';
  res.json({ success: true, data: { message: 'Job cancelled.' } });
});

export default router;
