import * as path from 'path';
import * as fs from 'fs/promises';
import {
  CacheEnvelope,
  buildFreshnessInfo,
  createCacheEnvelope,
  isFreshTimestamp,
  readCacheEnvelope,
  writeCacheEnvelope,
} from '../../services/cacheService';

export type UniversePriceSnapshot = Record<string, { last_close: number; end: string | null; source: string }>;

export interface UniversePriceSnapshotServiceConfig {
  dataDir: string;
  manifestPath: string;
  priceSnapshotCachePath: string;
  priceSnapshotTtlMs: number;
}

export interface UniversePriceSnapshotResult {
  data: UniversePriceSnapshot;
  fetchedAt: number;
  cacheKey: string;
  cacheLayer: 'memory' | 'disk' | 'refresh';
}

export function buildUniversePriceSnapshotResponse(
  snapshot: UniversePriceSnapshotResult,
  priceSnapshotTtlMs: number,
) {
  const freshness = buildFreshnessInfo({
    fetchedAt: snapshot.fetchedAt,
    ttlMs: priceSnapshotTtlMs,
    cacheLayer: snapshot.cacheLayer,
    cacheKey: snapshot.cacheKey,
    version: 1,
  });

  return {
    data: {
      count: Object.keys(snapshot.data).length,
      prices: snapshot.data,
      freshness,
    },
    freshness,
  };
}

export type ReadUniversePriceSnapshotEnvelope = <T>(filePath: string) => Promise<CacheEnvelope<T> | null>;

export function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function buildUniverseFreshness(value: string | null | undefined, ttlMs: number) {
  return buildFreshnessInfo({
    fetchedAt: parseIsoTimestamp(value),
    ttlMs,
    cacheLayer: 'disk',
  });
}

export async function readUniversePriceSnapshotFreshness(
  priceSnapshotCachePath: string,
  priceSnapshotTtlMs: number,
  readEnvelope: ReadUniversePriceSnapshotEnvelope = readCacheEnvelope,
) {
  const missingFreshness = buildFreshnessInfo({
    ttlMs: priceSnapshotTtlMs,
    cacheLayer: 'missing',
    sourceStatus: 'missing',
  });

  try {
    const cacheEntry = await readEnvelope<UniversePriceSnapshot>(priceSnapshotCachePath);
    if (!cacheEntry) return missingFreshness;
    return buildFreshnessInfo({
      fetchedAt: cacheEntry.fetchedAt,
      ttlMs: cacheEntry.ttlMs,
      cacheLayer: 'disk',
      cacheKey: cacheEntry.key,
      version: cacheEntry.version,
    });
  } catch {
    return missingFreshness;
  }
}

export async function readLastCloseFromCsv(filePath: string): Promise<number | null> {
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

export function createUniversePriceSnapshotService(config: UniversePriceSnapshotServiceConfig) {
  let priceSnapshotCache: CacheEnvelope<UniversePriceSnapshot> | null = null;

  async function readPersistedPriceSnapshot(cacheKey: string): Promise<CacheEnvelope<UniversePriceSnapshot> | null> {
    const parsed = await readCacheEnvelope<UniversePriceSnapshot>(config.priceSnapshotCachePath);
    if (!parsed || parsed.key !== cacheKey) return null;
    if (!isFreshTimestamp(parsed.fetchedAt, parsed.ttlMs)) return null;
    return parsed;
  }

  async function persistPriceSnapshot(cacheKey: string, data: UniversePriceSnapshot): Promise<CacheEnvelope<UniversePriceSnapshot>> {
    const payload = createCacheEnvelope(cacheKey, data, config.priceSnapshotTtlMs, 'universePriceSnapshot');
    await writeCacheEnvelope(config.priceSnapshotCachePath, payload);
    return payload;
  }

  async function buildUniversePriceSnapshot(forceRefresh = false): Promise<UniversePriceSnapshotResult> {
    const raw = await fs.readFile(config.manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) || {};
    const symbols = manifest.symbols || {};
    const cacheKey = `${manifest.last_updated || manifest.generated_at || ''}:${Object.keys(symbols).length}`;
    if (!forceRefresh && priceSnapshotCache?.key === cacheKey && isFreshTimestamp(priceSnapshotCache.fetchedAt, priceSnapshotCache.ttlMs)) {
      return {
        data: priceSnapshotCache.data,
        fetchedAt: priceSnapshotCache.fetchedAt,
        cacheKey,
        cacheLayer: 'memory',
      };
    }

    if (!forceRefresh) {
      const persisted = await readPersistedPriceSnapshot(cacheKey);
      if (persisted) {
        priceSnapshotCache = persisted;
        return {
          data: persisted.data,
          fetchedAt: persisted.fetchedAt,
          cacheKey,
          cacheLayer: 'disk',
        };
      }
    }

    const interval = String(manifest.interval || '1d');
    const snapshot: UniversePriceSnapshot = {};
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
          const filePath = path.join(config.dataDir, fileName);
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

    const persisted = await persistPriceSnapshot(cacheKey, snapshot);
    priceSnapshotCache = persisted;
    return { data: snapshot, fetchedAt: persisted.fetchedAt, cacheKey, cacheLayer: 'refresh' };
  }

  return {
    buildUniversePriceSnapshot,
  };
}
