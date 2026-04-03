import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FundamentalsSnapshotV2, LedgerCoverageInfo } from '../types';
import { normalizeFundamentalsSnapshot } from '../services/contractValidation';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';
import {
  CacheEnvelope,
  FreshnessInfo,
  buildBatchFreshnessInfo,
  buildFreshnessInfo,
  createCacheEnvelope,
  isFreshTimestamp,
  readCacheEnvelope,
  writeCacheEnvelope,
} from '../services/cacheService';

const router = Router();

const FUNDAMENTALS_SERVICE_PATH = path.join(__dirname, '..', '..', 'services', 'fundamentalsService.py');
const FUNDAMENTALS_TIMEOUT_MS = 30000;
const LEDGER_COVERAGE_TIMEOUT_MS = 15000;
const LEDGER_CONTEXT_TIMEOUT_MS = 120000;
const FUNDAMENTALS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_COVERAGE_CACHE_TTL_MS = 15 * 60 * 1000;
const LEDGER_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const FUNDAMENTALS_SCREEN_MAX_SYMBOLS = 50;
const FUNDAMENTALS_SCREEN_CONCURRENCY = 2;
const FUNDAMENTALS_CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'fundamentals-cache');
const LEDGER_COVERAGE_SERVICE_PATH = path.join(__dirname, '..', '..', 'services', 'ledgerCoverage.py');
const LEDGER_CONTEXT_SERVICE_PATH = path.join(__dirname, '..', '..', 'services', 'ledgerContext.py');

type LedgerStatementFactValue = {
  value_numeric: number | null;
  value_text: string | null;
  value_type: string | null;
  fact_origin: string | null;
  unit: string | null;
  scale: string | null;
  currency: string | null;
  source_type: string | null;
  source_document: string | null;
  evidence_ref: string | null;
  confidence: number | null;
};

type LedgerStatementPeriod = {
  period_type: 'quarterly' | 'annual';
  period_end: string;
  filing_date: string | null;
  available_at: string | null;
  fiscal_year: number | null;
  fiscal_quarter: number | null;
  source_documents: string[];
  metrics: Record<string, LedgerStatementFactValue>;
};

type LedgerRetrievalResult = {
  chunk_id: string | null;
  symbol: string | null;
  company: string | null;
  form: string | null;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string | null;
  section_heading: string | null;
  source_markdown_file: string | null;
  semantic_score: number | null;
  keyword_score: number | null;
  hybrid_score: number | null;
  text_excerpt: string | null;
  text_length: number | null;
};

type LedgerContextPayload = {
  symbol: string;
  statement_backbone: {
    fact_keys: string[];
    quarterly: LedgerStatementPeriod[];
    annual: LedgerStatementPeriod[];
  };
  recent_documents: Array<Record<string, unknown>>;
  retrieval: {
    available: boolean;
    query: string;
    top_k: number;
    results: LedgerRetrievalResult[];
    meta?: Record<string, unknown>;
    error?: string;
  };
};

type CachedFundamentalsEntry = CacheEnvelope<FundamentalsSnapshotV2>;
type LoadedFundamentalsSnapshot = {
  snapshot: FundamentalsSnapshotV2;
  freshness: FreshnessInfo;
};

type InsiderScreenRow = {
  symbol: string;
  company_name: string | null;
  insider_buy_score: number;
  insider_buy_signal: 'buying' | 'selling' | 'mixed' | 'quiet';
  recent_buy_count: number;
  recent_sell_count: number;
  recent_buy_value: number | null;
  recent_sell_value: number | null;
  has_recent_insider_buying: boolean;
  is_net_insider_buying: boolean;
  tactical_score: number | null;
  positioning_score: number | null;
};

const fundamentalsCache = new Map<string, CachedFundamentalsEntry>();
const ledgerCoverageCache = new Map<string, { data: LedgerCoverageInfo; fetchedAt: number }>();
const ledgerContextCache = new Map<string, { data: LedgerContextPayload; fetchedAt: number }>();

function getFundamentalsCachePath(symbol: string): string {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9._=-]/g, '_');
  return path.join(FUNDAMENTALS_CACHE_DIR, `${safe}.json`);
}

async function loadFundamentalsSnapshot(symbol: string, forceRefresh = false): Promise<LoadedFundamentalsSnapshot> {
  const normalized = normalizeMarketDataSymbol(symbol);
  if (!normalized) {
    throw new Error('symbol required');
  }
  const cacheKey = normalized.toUpperCase();
  let staleFallback: { entry: CachedFundamentalsEntry; layer: 'stale-memory' | 'stale-disk' } | null = null;

  if (!forceRefresh) {
    const cached = fundamentalsCache.get(cacheKey) || null;
    if (cached) {
      if (isFreshTimestamp(cached.fetchedAt, cached.ttlMs)) {
        return {
          snapshot: cached.data,
          freshness: buildFreshnessInfo({
            fetchedAt: cached.fetchedAt,
            ttlMs: cached.ttlMs,
            cacheLayer: 'memory',
            cacheKey,
            version: cached.version,
          }),
        };
      }
      staleFallback = { entry: cached, layer: 'stale-memory' };
    }

    const persisted = await readCacheEnvelope<FundamentalsSnapshotV2>(
      getFundamentalsCachePath(cacheKey),
      normalizeFundamentalsSnapshot,
    );
    if (persisted?.key === cacheKey) {
      fundamentalsCache.set(cacheKey, persisted);
      if (isFreshTimestamp(persisted.fetchedAt, persisted.ttlMs)) {
        return {
          snapshot: persisted.data,
          freshness: buildFreshnessInfo({
            fetchedAt: persisted.fetchedAt,
            ttlMs: persisted.ttlMs,
            cacheLayer: 'disk',
            cacheKey,
            version: persisted.version,
          }),
        };
      }
      if (!staleFallback) {
        staleFallback = { entry: persisted, layer: 'stale-disk' };
      }
    }
  }

  try {
    const snapshot = await new Promise<FundamentalsSnapshotV2>((resolve, reject) => {
      const proc = spawn('py', [FUNDAMENTALS_SERVICE_PATH, normalized]);
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (err: Error | null, result?: FundamentalsSnapshotV2) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (err) {
          reject(err);
        } else if (result) {
          resolve(result);
        } else {
          reject(new Error('Unknown fundamentals error'));
        }
      };

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error: Error) => {
        finish(error);
      });

      proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code !== 0) {
          const reason = signal
            ? `Fundamentals service exited via signal ${signal}`
            : `Fundamentals service exited with code ${code}`;
          finish(new Error(stderr || reason));
          return;
        }

        try {
          const payload = JSON.parse(stdout) as FundamentalsSnapshotV2 & { error?: string };
          if (payload?.error) {
            finish(new Error(payload.error));
            return;
          }
          finish(null, normalizeFundamentalsSnapshot(payload));
        } catch (err: any) {
          finish(new Error(`Failed to parse fundamentals data: ${err.message}`));
        }
      });

      const timeoutId = setTimeout(() => {
        proc.kill();
        finish(new Error('Fundamentals service timed out'));
      }, FUNDAMENTALS_TIMEOUT_MS);
    });

    const entry = createCacheEnvelope(
      cacheKey,
      snapshot,
      FUNDAMENTALS_CACHE_TTL_MS,
      'fundamentalsService',
    );
    fundamentalsCache.set(cacheKey, entry);
    await writeCacheEnvelope(getFundamentalsCachePath(cacheKey), entry);
    return {
      snapshot,
      freshness: buildFreshnessInfo({
        fetchedAt: entry.fetchedAt,
        ttlMs: entry.ttlMs,
        cacheLayer: 'refresh',
        cacheKey,
        version: entry.version,
      }),
    };
  } catch (error) {
    if (staleFallback) {
      return {
        snapshot: staleFallback.entry.data,
        freshness: buildFreshnessInfo({
          fetchedAt: staleFallback.entry.fetchedAt,
          ttlMs: staleFallback.entry.ttlMs,
          cacheLayer: staleFallback.layer,
          cacheKey,
          version: staleFallback.entry.version,
          sourceStatus: 'stale-fallback',
        }),
      };
    }
    throw error;
  }
}

async function loadLedgerCoverage(symbol: string, forceRefresh = false): Promise<LedgerCoverageInfo> {
  const normalized = normalizeMarketDataSymbol(symbol);
  if (!normalized) {
    throw new Error('symbol required');
  }
  const cacheKey = normalized.toUpperCase();
  const cached = ledgerCoverageCache.get(cacheKey) || null;
  if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) <= LEDGER_COVERAGE_CACHE_TTL_MS) {
    return cached.data;
  }

  const coverage = await new Promise<LedgerCoverageInfo>((resolve, reject) => {
    const proc = spawn('py', [LEDGER_COVERAGE_SERVICE_PATH, normalized]);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, result?: LedgerCoverageInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error('Unknown ledger coverage error'));
      }
    };

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error: Error) => {
      finish(error);
    });

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0) {
        const reason = signal
          ? `Ledger coverage service exited via signal ${signal}`
          : `Ledger coverage service exited with code ${code}`;
        finish(new Error(stderr || reason));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as LedgerCoverageInfo & { error?: string };
        if (payload?.error) {
          finish(new Error(payload.error));
          return;
        }
        finish(null, payload);
      } catch (err: any) {
        finish(new Error(`Failed to parse ledger coverage data: ${err.message}`));
      }
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      finish(new Error('Ledger coverage service timed out'));
    }, LEDGER_COVERAGE_TIMEOUT_MS);
  });

  ledgerCoverageCache.set(cacheKey, { data: coverage, fetchedAt: Date.now() });
  return coverage;
}

async function loadLedgerContext(
  symbol: string,
  query: string,
  topK: number,
  forceRefresh = false,
): Promise<LedgerContextPayload> {
  const normalized = normalizeMarketDataSymbol(symbol);
  if (!normalized) {
    throw new Error('symbol required');
  }
  const trimmedQuery = String(query || '').trim();
  const safeTopK = Number.isFinite(topK) ? Math.max(1, Math.min(20, Math.trunc(topK))) : 8;
  const cacheKey = `${normalized.toUpperCase()}::${trimmedQuery || '__default__'}::${safeTopK}`;
  const cached = ledgerContextCache.get(cacheKey) || null;
  if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) <= LEDGER_CONTEXT_CACHE_TTL_MS) {
    return cached.data;
  }

  const payload = await new Promise<LedgerContextPayload>((resolve, reject) => {
    const proc = spawn('py', [
      LEDGER_CONTEXT_SERVICE_PATH,
      normalized,
      trimmedQuery,
      String(safeTopK),
    ]);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, result?: LedgerContextPayload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error('Unknown ledger context error'));
      }
    };

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error: Error) => {
      finish(error);
    });

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0) {
        const reason = signal
          ? `Ledger context service exited via signal ${signal}`
          : `Ledger context service exited with code ${code}`;
        finish(new Error(stderr || reason));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as LedgerContextPayload & { error?: string };
        if (parsed?.error) {
          finish(new Error(parsed.error));
          return;
        }
        finish(null, parsed);
      } catch (err: any) {
        finish(new Error(`Failed to parse ledger context data: ${err.message}`));
      }
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      finish(new Error('Ledger context service timed out'));
    }, LEDGER_CONTEXT_TIMEOUT_MS);
  });

  ledgerContextCache.set(cacheKey, { data: payload, fetchedAt: Date.now() });
  return payload;
}

function buildInsiderScreenRow(snapshot: FundamentalsSnapshotV2): InsiderScreenRow {
  const positioning = snapshot.positioning || null;
  const recentBuyCount = Number(positioning?.recentBuyCount || 0);
  const recentSellCount = Number(positioning?.recentSellCount || 0);
  const recentBuyValue = positioning?.recentBuyValue ?? null;
  const recentSellValue = positioning?.recentSellValue ?? null;
  const signal = positioning?.signal === 'buying'
    || positioning?.signal === 'selling'
    || positioning?.signal === 'mixed'
    || positioning?.signal === 'quiet'
    ? positioning.signal
    : 'quiet';
  const score = Number(snapshot.positioningScore ?? positioning?.score ?? 0);
  const hasRecentInsiderBuying = recentBuyCount > 0 || (recentBuyValue != null && recentBuyValue > 0);
  const isNetInsiderBuying = (
    recentBuyCount > recentSellCount
    || (
      recentBuyValue != null
      && (recentSellValue == null || recentBuyValue > recentSellValue)
    )
  );

  return {
    symbol: snapshot.symbol,
    company_name: snapshot.companyName || null,
    insider_buy_score: Number.isFinite(score) ? score : 0,
    insider_buy_signal: signal,
    recent_buy_count: recentBuyCount,
    recent_sell_count: recentSellCount,
    recent_buy_value: recentBuyValue,
    recent_sell_value: recentSellValue,
    has_recent_insider_buying: hasRecentInsiderBuying,
    is_net_insider_buying: hasRecentInsiderBuying && isNetInsiderBuying,
    tactical_score: snapshot.tacticalScore ?? null,
    positioning_score: snapshot.positioningScore ?? null,
  };
}

function compareInsiderRows(a: InsiderScreenRow, b: InsiderScreenRow): number {
  const buyingRank = (row: InsiderScreenRow) => {
    if (row.is_net_insider_buying) return 2;
    if (row.has_recent_insider_buying) return 1;
    return 0;
  };

  const rankDiff = buyingRank(b) - buyingRank(a);
  if (rankDiff !== 0) return rankDiff;

  const scoreDiff = (Number(b.insider_buy_score) || 0) - (Number(a.insider_buy_score) || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const buyValueDiff = (Number(b.recent_buy_value) || 0) - (Number(a.recent_buy_value) || 0);
  if (buyValueDiff !== 0) return buyValueDiff;

  const buyCountDiff = (Number(b.recent_buy_count) || 0) - (Number(a.recent_buy_count) || 0);
  if (buyCountDiff !== 0) return buyCountDiff;

  return a.symbol.localeCompare(b.symbol);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

router.post('/screen', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.body?.force_refresh === true;
    const rawSymbols: unknown[] = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const symbols = rawSymbols
      .map((value) => normalizeMarketDataSymbol(String(value || '')))
      .filter((value): value is string => Boolean(value));
    const uniqueSymbols = Array.from(new Set(symbols));

    if (!uniqueSymbols.length) {
      return res.status(400).json({ success: false, error: 'symbols array is required' });
    }
    if (uniqueSymbols.length > FUNDAMENTALS_SCREEN_MAX_SYMBOLS) {
      return res.status(400).json({
        success: false,
        error: `Insider screen is limited to ${FUNDAMENTALS_SCREEN_MAX_SYMBOLS} symbols per request. Reduce Limit Symbols first.`,
      });
    }

    let memoryHits = 0;
    let diskHits = 0;
    let refreshedCount = 0;
    let staleFallbackCount = 0;
    const rows = await mapWithConcurrency<string, InsiderScreenRow>(uniqueSymbols, async (symbol) => {
      try {
        const loaded = await loadFundamentalsSnapshot(symbol, forceRefresh);
        if (loaded.freshness.cache_layer === 'memory') memoryHits += 1;
        if (loaded.freshness.cache_layer === 'disk') diskHits += 1;
        if (loaded.freshness.cache_layer === 'refresh') refreshedCount += 1;
        if (loaded.freshness.source_status === 'stale-fallback') staleFallbackCount += 1;
        return buildInsiderScreenRow(loaded.snapshot);
      } catch {
        return {
          symbol,
          company_name: null,
          insider_buy_score: 0,
          insider_buy_signal: 'quiet' as const,
          recent_buy_count: 0,
          recent_sell_count: 0,
          recent_buy_value: null,
          recent_sell_value: null,
          has_recent_insider_buying: false,
          is_net_insider_buying: false,
          tactical_score: null,
          positioning_score: null,
        };
      }
    }, FUNDAMENTALS_SCREEN_CONCURRENCY);

    rows.sort(compareInsiderRows);
    return res.status(200).json({
      success: true,
      data: {
        rows,
        max_symbols: FUNDAMENTALS_SCREEN_MAX_SYMBOLS,
      },
      freshness: buildBatchFreshnessInfo({
        ttlMs: FUNDAMENTALS_CACHE_TTL_MS,
        memoryHits,
        diskHits,
        refreshedCount,
        staleFallbackCount,
        totalCount: uniqueSymbols.length,
      }),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Social Buzz (StockTwits) ─────────────────────────────────────────────────

const BUZZ_CACHE = new Map<string, { data: any; fetchedAt: number }>();
const BUZZ_TTL_MS = 5 * 60 * 1000; // 5 minutes

router.get('/:symbol/buzz', async (req: Request, res: Response) => {
  try {
    const symbol = normalizeMarketDataSymbol(String(req.params.symbol || ''));
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }

    const cached = BUZZ_CACHE.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < BUZZ_TTL_MS) {
      return res.status(200).json({ success: true, data: cached.data, cache: 'hit' });
    }

    const data = await new Promise<any>((resolve, reject) => {
      const proc = spawn('py', [FUNDAMENTALS_SERVICE_PATH, '--buzz', symbol]);
      let stdout = '';
      let settled = false;

      const finish = (err: Error | null, result?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(tid);
        err ? reject(err) : resolve(result);
      };

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('error', (e: Error) => finish(e));
      proc.on('close', (code: number | null) => {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error && !parsed.available) {
            finish(new Error(parsed.error));
          } else {
            finish(null, parsed);
          }
        } catch {
          finish(new Error(`StockTwits fetch failed (exit ${code})`));
        }
      });

      const tid = setTimeout(() => {
        proc.kill();
        finish(new Error('StockTwits request timed out'));
      }, 15000);
    });

    BUZZ_CACHE.set(symbol, { data, fetchedAt: Date.now() });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(200).json({
      success: true,
      data: { symbol: req.params.symbol, available: false, error: error.message },
    });
  }
});

router.get('/:symbol/coverage', async (req: Request, res: Response) => {
  try {
    const forceRefresh = String(req.query.force_refresh || '').trim().toLowerCase() === 'true';
    const coverage = await loadLedgerCoverage(String(req.params.symbol || ''), forceRefresh);
    return res.status(200).json({ success: true, data: coverage });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:symbol/ledger-context', async (req: Request, res: Response) => {
  try {
    const forceRefresh = String(req.query.force_refresh || '').trim().toLowerCase() === 'true';
    const query = String(req.query.query || '').trim();
    const topK = Number(req.query.top_k || req.query.topK || 8);
    const [loaded, coverage, context] = await Promise.all([
      loadFundamentalsSnapshot(String(req.params.symbol || ''), forceRefresh),
      loadLedgerCoverage(String(req.params.symbol || ''), forceRefresh),
      loadLedgerContext(String(req.params.symbol || ''), query, topK, forceRefresh),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        symbol: loaded.snapshot.symbol,
        snapshot: loaded.snapshot,
        coverage,
        statement_backbone: context.statement_backbone,
        recent_documents: context.recent_documents,
        retrieval: context.retrieval,
      },
      freshness: loaded.freshness,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const forceRefresh = String(req.query.force_refresh || '').trim().toLowerCase() === 'true';
    const loaded = await loadFundamentalsSnapshot(String(req.params.symbol || ''), forceRefresh);
    const coverage = await loadLedgerCoverage(String(req.params.symbol || ''), forceRefresh);
    return res.status(200).json({ success: true, data: loaded.snapshot, freshness: loaded.freshness, coverage });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
