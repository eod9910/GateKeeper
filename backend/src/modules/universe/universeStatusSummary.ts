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
