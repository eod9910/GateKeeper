import { getOptionableCatalogMeta } from './universeCatalogMeta';
import { UniverseJob, clampUniverseProgress } from './universeJobProgress';

export interface UniverseManifestSummary {
  manifest: any;
  symbolCount: number;
  sourceSymbolCount: number;
  lastUpdated: string | null;
  staleCount: number;
  source: string | null;
  sourceLabel: string | null;
}

export interface UniverseOptionableStatus {
  optionableCount: number;
  optionableClassifiedCount: number;
  optionableUnclassifiedCount: number;
  optionableComplete: boolean;
  sourceSymbolCount: number;
}

export interface UniverseStatusDataOptions {
  symbolCount: number;
  sourceSymbolCount: number;
  optionableStatus: UniverseOptionableStatus;
  source: string | null;
  sourceLabel: string | null;
  lastUpdated: string | null;
  staleCount: number;
  manifestFreshness: unknown;
  priceSnapshotFreshness: unknown;
  activeJob: UniverseJob | null;
  now?: Date;
}

export function summarizeUniverseManifest(
  manifest: any,
  now: Date = new Date(),
): UniverseManifestSummary {
  const symbols = manifest?.symbols || {};
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);

  let staleCount = 0;
  for (const meta of Object.values(symbols) as any[]) {
    if (meta?.end) {
      const end = new Date(meta.end);
      if (end < cutoff) staleCount += 1;
    }
  }

  return {
    manifest,
    symbolCount: manifest?.total_symbols || Object.keys(symbols).length,
    sourceSymbolCount: Number(manifest?.source_symbol_count || 0),
    lastUpdated: manifest?.last_updated || manifest?.generated_at || null,
    staleCount,
    source: manifest?.source || null,
    sourceLabel: manifest?.source_label || null,
  };
}

export function createEmptyOptionableStatus(sourceSymbolCount = 0): UniverseOptionableStatus {
  return {
    optionableCount: 0,
    optionableClassifiedCount: 0,
    optionableUnclassifiedCount: 0,
    optionableComplete: true,
    sourceSymbolCount,
  };
}

function catalogSourceMatchesManifest(catalog: any, manifest: any): boolean {
  const optionableSource = String(catalog?.source || '').trim();
  const manifestSource = String(manifest?.source || '').trim();
  return !manifestSource || !optionableSource || optionableSource === manifestSource;
}

export function applyOptionableCatalogStatus(
  status: UniverseOptionableStatus,
  catalog: any,
  manifest: any,
): void {
  if (!catalogSourceMatchesManifest(catalog, manifest)) return;

  const meta = getOptionableCatalogMeta(catalog);
  status.optionableCount = meta.optionableCount;
  status.optionableClassifiedCount = meta.classifiedCount;
  status.optionableUnclassifiedCount = meta.unclassifiedCount;
  status.optionableComplete = meta.complete;
  status.sourceSymbolCount = Number(meta.sourceSymbolCount || status.sourceSymbolCount || 0);
}

export function applyOptionableProgressStatus(
  status: UniverseOptionableStatus,
  progressCatalog: any,
  manifest: any,
  activeJob: UniverseJob | null,
): void {
  if (!catalogSourceMatchesManifest(progressCatalog, manifest)) return;

  const meta = getOptionableCatalogMeta(progressCatalog);
  const shouldPreferProgress =
    activeJob?.type === 'rebuild_optionable' ||
    activeJob?.stage === 'checking_optionability' ||
    activeJob?.stage === 'retrying_unknown' ||
    meta.classifiedCount > status.optionableClassifiedCount;

  if (shouldPreferProgress) {
    status.optionableCount = meta.optionableCount;
    status.optionableClassifiedCount = meta.classifiedCount;
    status.optionableUnclassifiedCount = meta.unclassifiedCount;
    status.optionableComplete = meta.complete;
    status.sourceSymbolCount = Number(meta.sourceSymbolCount || status.sourceSymbolCount || 0);
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
    activeJob.last_log_at = progressCatalog?.generated_at || activeJob.last_log_at;
  }
}

export function projectUniverseActiveJob(job: UniverseJob | null, now: Date = new Date()) {
  if (!job) return null;
  const completedOrCurrent = job.completed_at ? new Date(job.completed_at) : now;
  return {
    type: job.type,
    status: job.status,
    started_at: job.started_at,
    completed_at: job.completed_at,
    elapsed_seconds: Math.max(
      0,
      Math.floor((completedOrCurrent.getTime() - new Date(job.started_at).getTime()) / 1000)
    ),
    progress: job.progress ?? null,
    progress_label: job.progress_label ?? null,
    stage: job.stage ?? null,
    source: job.source ?? null,
    source_label: job.source_label ?? null,
    interval: job.interval ?? null,
    lookback: job.lookback ?? null,
    workers: job.workers ?? null,
    min_volume: job.min_volume ?? null,
    metrics: job.metrics ?? null,
    last_log_at: job.last_log_at ?? null,
    log_tail: job.log.slice(-60),
    log_count: job.log.length,
    error: job.error,
  };
}

export function buildUniverseStatusData(options: UniverseStatusDataOptions) {
  const built = options.symbolCount > 0;
  return {
    built,
    source_symbol_count: options.sourceSymbolCount,
    symbol_count: options.symbolCount,
    downloaded_symbol_count: options.symbolCount,
    optionable_count: options.optionableStatus.optionableCount,
    optionable_classified_count: options.optionableStatus.optionableClassifiedCount,
    optionable_unclassified_count: options.optionableStatus.optionableUnclassifiedCount,
    optionable_complete: options.optionableStatus.optionableComplete,
    source: options.source,
    source_label: options.sourceLabel,
    last_updated: options.lastUpdated,
    stale_count: options.staleCount,
    needs_update: built && options.staleCount > 0,
    freshness: {
      manifest: options.manifestFreshness,
      prices: options.priceSnapshotFreshness,
    },
    active_job: projectUniverseActiveJob(options.activeJob, options.now),
  };
}
