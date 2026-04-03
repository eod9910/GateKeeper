export type PrimitiveCanonicalRole =
  | 'anchor_structure'
  | 'location'
  | 'timing_trigger'
  | 'regime_state'
  | 'state_filter'
  | 'context'
  | 'structure_filter';

export type PrimitiveLibraryTier =
  | 'core_stable'
  | 'advanced_experimental'
  | 'research_only';

export type PrimitiveCostClass = 'cheap' | 'moderate' | 'expensive';

type PrimitiveMetaLike = {
  pattern_id?: string;
  name?: string;
  category?: string;
  status?: string;
  artifact_type?: string;
  composition?: string;
  indicator_role?: string;
  pattern_role?: string;
  library_tier?: string;
  autonomy_safe?: boolean;
  state_compatible?: boolean;
  cost_class?: string;
  search_tags?: unknown;
  source_kind?: string;
};

export interface NormalizedPrimitiveCatalogMetadata {
  canonical_role: PrimitiveCanonicalRole | null;
  library_tier: PrimitiveLibraryTier;
  autonomy_safe: boolean;
  state_compatible: boolean;
  cost_class: PrimitiveCostClass;
  search_tags: string[];
  source_kind: 'native' | 'imported' | 'custom';
}

const CANONICAL_ROLES = new Set<PrimitiveCanonicalRole>([
  'anchor_structure',
  'location',
  'timing_trigger',
  'regime_state',
  'state_filter',
  'context',
  'structure_filter',
]);

const CORE_STABLE_PATTERN_IDS = new Set([
  'rsi_primitive',
  'macd_primitive',
  'macd_histogram',
  'ma_crossover',
]);

function normalizedText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizedBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = normalizedText(value);
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function normalizeCanonicalRole(value: unknown): PrimitiveCanonicalRole | null {
  const raw = normalizedText(value);
  if (!raw) return null;
  if (CANONICAL_ROLES.has(raw as PrimitiveCanonicalRole)) {
    return raw as PrimitiveCanonicalRole;
  }
  if (raw === 'regime_filter') return 'regime_state';
  return null;
}

function normalizeLibraryTier(value: unknown): PrimitiveLibraryTier | null {
  const raw = normalizedText(value);
  if (raw === 'core_stable' || raw === 'advanced_experimental' || raw === 'research_only') {
    return raw;
  }
  return null;
}

function normalizeCostClass(value: unknown): PrimitiveCostClass | null {
  const raw = normalizedText(value);
  if (raw === 'cheap' || raw === 'moderate' || raw === 'expensive') {
    return raw;
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizedText(item))
    .filter(Boolean);
}

function inferLibraryTier(meta: PrimitiveMetaLike, canonicalRole: PrimitiveCanonicalRole | null): PrimitiveLibraryTier {
  const patternId = normalizedText(meta.pattern_id);
  const artifactType = normalizedText(meta.artifact_type || 'indicator');
  const composition = normalizedText(meta.composition || 'composite');
  const status = normalizedText(meta.status || 'unknown');
  const category = normalizedText(meta.category || 'custom');

  if (artifactType !== 'indicator') return 'research_only';
  if (composition !== 'primitive') return 'research_only';
  if (CORE_STABLE_PATTERN_IDS.has(patternId) && status === 'stable') return 'core_stable';
  if (category === 'indicator_signals' && canonicalRole) return 'advanced_experimental';
  return 'research_only';
}

function inferStateCompatible(meta: PrimitiveMetaLike, canonicalRole: PrimitiveCanonicalRole | null): boolean {
  const artifactType = normalizedText(meta.artifact_type || 'indicator');
  const composition = normalizedText(meta.composition || 'composite');
  if (artifactType !== 'indicator' || composition !== 'primitive') return false;
  return canonicalRole !== null;
}

function inferCostClass(meta: PrimitiveMetaLike): PrimitiveCostClass {
  const text = [
    normalizedText(meta.pattern_id),
    normalizedText(meta.name),
    normalizedText(meta.category),
    normalizedText(meta.indicator_role),
    normalizedText(meta.pattern_role),
  ].join(' ');

  if (
    text.includes('family') ||
    text.includes('wyckoff') ||
    text.includes('density') ||
    text.includes('wiggle') ||
    text.includes('accumulation')
  ) {
    return 'expensive';
  }
  if (
    text.includes('regression') ||
    text.includes('order block') ||
    text.includes('order_blocks') ||
    text.includes('fvg') ||
    text.includes('base') ||
    text.includes('swing')
  ) {
    return 'moderate';
  }
  return 'cheap';
}

function inferSourceKind(meta: PrimitiveMetaLike): 'native' | 'imported' | 'custom' {
  const raw = normalizedText(meta.source_kind);
  if (raw === 'native' || raw === 'imported' || raw === 'custom') {
    return raw;
  }
  const category = normalizedText(meta.category || 'custom');
  return category === 'custom' ? 'custom' : 'native';
}

function inferSearchTags(meta: PrimitiveMetaLike, canonicalRole: PrimitiveCanonicalRole | null): string[] {
  const rawTags = normalizeStringArray(meta.search_tags);
  const derived = [
    normalizedText(meta.pattern_id),
    normalizedText(meta.category),
    normalizedText(meta.status),
    normalizedText(meta.artifact_type),
    normalizedText(meta.composition),
    normalizedText(meta.indicator_role),
    normalizedText(meta.pattern_role),
    normalizedText(canonicalRole),
  ];

  const nameTokens = normalizedText(meta.name)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);

  return Array.from(new Set([...rawTags, ...derived, ...nameTokens])).filter(Boolean);
}

export function normalizePrimitiveCatalogMetadata(
  registryEntry: PrimitiveMetaLike,
  definition: PrimitiveMetaLike = {},
): NormalizedPrimitiveCatalogMetadata {
  const merged: PrimitiveMetaLike = {
    ...registryEntry,
    ...definition,
    pattern_id: registryEntry.pattern_id || definition.pattern_id,
    category: definition.category || registryEntry.category,
    status: definition.status || registryEntry.status,
    artifact_type: definition.artifact_type || registryEntry.artifact_type,
    composition: definition.composition || registryEntry.composition,
    indicator_role: definition.indicator_role || registryEntry.indicator_role,
    pattern_role: definition.pattern_role || registryEntry.pattern_role,
    name: definition.name || registryEntry.name,
    library_tier: definition.library_tier || registryEntry.library_tier,
    autonomy_safe: definition.autonomy_safe ?? registryEntry.autonomy_safe,
    state_compatible: definition.state_compatible ?? registryEntry.state_compatible,
    cost_class: definition.cost_class || registryEntry.cost_class,
    search_tags: Array.isArray(definition.search_tags) ? definition.search_tags : registryEntry.search_tags,
    source_kind: definition.source_kind || registryEntry.source_kind,
  };

  const canonicalRole = normalizeCanonicalRole(merged.indicator_role);
  const libraryTier = normalizeLibraryTier(merged.library_tier) || inferLibraryTier(merged, canonicalRole);
  const autonomySafe = normalizedBool(merged.autonomy_safe) ?? (libraryTier !== 'research_only');
  const stateCompatible = normalizedBool(merged.state_compatible) ?? inferStateCompatible(merged, canonicalRole);
  const costClass = normalizeCostClass(merged.cost_class) || inferCostClass(merged);
  const sourceKind = inferSourceKind(merged);
  const searchTags = inferSearchTags(merged, canonicalRole);

  return {
    canonical_role: canonicalRole,
    library_tier: libraryTier,
    autonomy_safe: autonomySafe,
    state_compatible: stateCompatible,
    cost_class: costClass,
    search_tags: searchTags,
    source_kind: sourceKind,
  };
}
