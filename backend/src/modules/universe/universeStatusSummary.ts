export interface UniverseManifestSummary {
  manifest: any;
  symbolCount: number;
  sourceSymbolCount: number;
  lastUpdated: string | null;
  staleCount: number;
  source: string | null;
  sourceLabel: string | null;
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
