import * as fs from 'fs/promises';
import * as path from 'path';

export type CacheEnvelope<T> = {
  key: string;
  fetchedAt: number;
  ttlMs: number;
  source: string;
  version: number;
  data: T;
};

export type CacheLayer =
  | 'memory'
  | 'disk'
  | 'refresh'
  | 'stale-memory'
  | 'stale-disk'
  | 'missing';

export type FreshnessInfo = {
  fetched_at: string | null;
  ttl_ms: number | null;
  stale: boolean;
  age_ms: number | null;
  source_status: 'ok' | 'stale-fallback' | 'missing';
  cache_layer: CacheLayer;
  cache_key: string | null;
  version: number | null;
};

export function isFreshTimestamp(value: number | null | undefined, ttlMs: number): boolean {
  return Number.isFinite(value) && value != null && (Date.now() - Number(value)) <= ttlMs;
}

export function toIsoTimestamp(value: number | null | undefined): string | null {
  if (!Number.isFinite(value) || Number(value) <= 0) return null;
  return new Date(Number(value)).toISOString();
}

export function createCacheEnvelope<T>(
  key: string,
  data: T,
  ttlMs: number,
  source: string,
  version = 1,
  fetchedAt = Date.now(),
): CacheEnvelope<T> {
  return {
    key,
    fetchedAt,
    ttlMs,
    source,
    version,
    data,
  };
}

export async function readCacheEnvelope<T>(
  filePath: string,
  normalizeData?: (value: unknown) => T,
): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(parsed.fetchedAt)) return null;
    if (!Number.isFinite(parsed.ttlMs)) return null;
    const data = normalizeData ? normalizeData(parsed.data) : (parsed.data as T);
    return {
      key: String(parsed.key || ''),
      fetchedAt: Number(parsed.fetchedAt),
      ttlMs: Number(parsed.ttlMs),
      source: String(parsed.source || ''),
      version: Number.isFinite(parsed.version) ? Number(parsed.version) : 1,
      data,
    };
  } catch {
    return null;
  }
}

export async function writeCacheEnvelope<T>(filePath: string, entry: CacheEnvelope<T>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

export function buildFreshnessInfo(options: {
  fetchedAt?: number | null;
  ttlMs?: number | null;
  cacheLayer?: CacheLayer;
  cacheKey?: string | null;
  version?: number | null;
  sourceStatus?: 'ok' | 'stale-fallback' | 'missing';
}): FreshnessInfo {
  const fetchedAt = options.fetchedAt ?? null;
  const ttlMs = options.ttlMs ?? null;
  return {
    fetched_at: toIsoTimestamp(fetchedAt),
    ttl_ms: ttlMs,
    stale: ttlMs == null || !isFreshTimestamp(fetchedAt, ttlMs),
    age_ms: Number.isFinite(fetchedAt) && fetchedAt != null ? Math.max(0, Date.now() - Number(fetchedAt)) : null,
    source_status: options.sourceStatus || 'ok',
    cache_layer: options.cacheLayer || 'missing',
    cache_key: options.cacheKey ?? null,
    version: options.version ?? null,
  };
}

export function buildBatchFreshnessInfo(options: {
  ttlMs: number;
  memoryHits: number;
  diskHits: number;
  refreshedCount: number;
  staleFallbackCount?: number;
  totalCount: number;
  fetchedAt?: number | null;
}): FreshnessInfo & {
  counts: {
    total: number;
    memory_hits: number;
    disk_hits: number;
    refreshed: number;
    stale_fallbacks: number;
  };
} {
  const staleFallbackCount = options.staleFallbackCount || 0;
  const status = staleFallbackCount > 0 ? 'stale-fallback' : 'ok';
  const layer: CacheLayer = options.refreshedCount > 0
    ? 'refresh'
    : options.diskHits > 0
      ? 'disk'
      : options.memoryHits > 0
        ? 'memory'
        : 'missing';
  return {
    ...buildFreshnessInfo({
      fetchedAt: options.fetchedAt ?? Date.now(),
      ttlMs: options.ttlMs,
      cacheLayer: layer,
      sourceStatus: status,
    }),
    counts: {
      total: options.totalCount,
      memory_hits: options.memoryHits,
      disk_hits: options.diskHits,
      refreshed: options.refreshedCount,
      stale_fallbacks: staleFallbackCount,
    },
  };
}
