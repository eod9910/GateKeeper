export interface OptionableCatalogMeta {
  optionableCount: number;
  sourceSymbolCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  complete: boolean;
}

export function normalizeUniverseSymbols(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value) => !!value)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function getOptionableCatalogMeta(opt: any): OptionableCatalogMeta {
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
