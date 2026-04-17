import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FundamentalsSnapshotV2, LedgerCoverageInfo } from '../types';
import { normalizeFundamentalsSnapshot } from '../services/contractValidation';
import { detectCorporateAction } from '../services/ledgerEngines';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';
import { getSymbolValuationSnapshot, upsertSymbolMetrics } from '../services/symbolCatalog';
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
const LEDGER_FINANCIAL_OVERLAY_QUERY = 'revenue operating income net income operating cash flow capital expenditures free cash flow current assets current liabilities';

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

async function persistFundamentalsSnapshot(
  symbol: string,
  snapshot: FundamentalsSnapshotV2,
): Promise<void> {
  const normalized = normalizeMarketDataSymbol(symbol);
  if (!normalized) return;
  const cacheKey = normalized.toUpperCase();
  const entry = createCacheEnvelope(
    cacheKey,
    normalizeFundamentalsSnapshot(snapshot),
    FUNDAMENTALS_CACHE_TTL_MS,
    'fundamentalsService+ledgerOverlay',
  );
  fundamentalsCache.set(cacheKey, entry);
  await writeCacheEnvelope(getFundamentalsCachePath(cacheKey), entry);
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

function attachCatalogValuationSnapshot(snapshot: FundamentalsSnapshotV2): FundamentalsSnapshotV2 {
  const valuationSnapshot = getSymbolValuationSnapshot(snapshot.symbol);
  if (!valuationSnapshot) {
    return snapshot;
  }
  return {
    ...snapshot,
    valuationSnapshot,
  };
}

function metricNumeric(metric?: LedgerStatementFactValue | null): number | null {
  const value = metric?.value_numeric;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ratioPercent(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const ratio = (numerator / denominator) * 100;
  if (!Number.isFinite(ratio) || ratio < -100 || ratio > 100) return null;
  return Math.round(ratio * 10) / 10;
}

async function attachLedgerStatementOverlay(
  snapshot: FundamentalsSnapshotV2,
  coverage: LedgerCoverageInfo,
  forceRefresh = false,
  preloadedContext?: LedgerContextPayload | null,
): Promise<FundamentalsSnapshotV2> {
  if (!snapshot?.symbol || coverage.coverage_tier !== 'full_filing_supported') {
    return snapshot;
  }

  try {
    const context = preloadedContext || await loadLedgerContext(
      snapshot.symbol,
      LEDGER_FINANCIAL_OVERLAY_QUERY,
      1,
      forceRefresh,
    );
    const latestAnnual = context?.statement_backbone?.annual?.[0];
    const metrics = latestAnnual?.metrics || {};
    if (!latestAnnual || !metrics) {
      return snapshot;
    }

    const revenue = metricNumeric(metrics.revenue);
    const operatingIncome = metricNumeric(metrics.operating_income);
    const netIncome = metricNumeric(metrics.net_income);
    const operatingCashFlow = metricNumeric(metrics.operating_cash_flow);
    const capitalExpenditures = metricNumeric(metrics.capital_expenditures);
    const freeCashFlow = metricNumeric(metrics.free_cash_flow)
      ?? (
        operatingCashFlow != null && capitalExpenditures != null
          ? operatingCashFlow - capitalExpenditures
          : null
      );
    const currentAssets = metricNumeric(metrics.current_assets);
    const currentLiabilities = metricNumeric(metrics.current_liabilities);
    const currentRatio = currentAssets != null && currentLiabilities != null && currentLiabilities !== 0
      ? Math.round((currentAssets / currentLiabilities) * 100) / 100
      : null;
    const operatingMarginPct = ratioPercent(operatingIncome, revenue);
    const profitMarginPct = ratioPercent(netIncome, revenue);

    return {
      ...snapshot,
      annualRevenue: revenue ?? snapshot.annualRevenue,
      operatingCashFlowTTM: operatingCashFlow ?? snapshot.operatingCashFlowTTM,
      freeCashFlowTTM: freeCashFlow ?? snapshot.freeCashFlowTTM,
      currentRatio: currentRatio ?? snapshot.currentRatio,
      operatingMarginPct: operatingMarginPct ?? snapshot.operatingMarginPct,
      profitMarginPct: profitMarginPct ?? snapshot.profitMarginPct,
    };
  } catch {
    return snapshot;
  }
}

async function attachSpecialSituation(
  snapshot: FundamentalsSnapshotV2,
  coverage: LedgerCoverageInfo,
  forceRefresh = false,
  preloadedContext?: LedgerContextPayload | null,
): Promise<FundamentalsSnapshotV2> {
  if (!snapshot?.symbol || coverage.coverage_tier !== 'full_filing_supported') {
    return snapshot;
  }

  try {
    const context = preloadedContext || await loadLedgerContext(
      snapshot.symbol,
      'merger acquisition going private take-private definitive agreement merger agreement stockholders to receive expected to close acquired by',
      8,
      forceRefresh,
    );

    const corporateAction = detectCorporateAction({
      symbol: snapshot.symbol,
      current_snapshot: snapshot,
      evidence_context: {
        recent_documents: context.recent_documents,
        retrieval: context.retrieval,
      },
    } as any);

    if (!corporateAction) {
      return snapshot;
    }

    const tags = Array.isArray(snapshot.tags) ? snapshot.tags.slice() : [];
    if (!tags.some((tag) => String(tag?.label || '').toLowerCase().includes('pending acquisition'))) {
      tags.unshift({ label: 'Pending acquisition', tone: 'danger' });
    }

    return {
      ...snapshot,
      statusNote: corporateAction.label || snapshot.statusNote,
      riskNote: corporateAction.summary || snapshot.riskNote,
      tags,
      specialSituation: {
        code: corporateAction.code || null,
        status: corporateAction.status || null,
        label: corporateAction.label || null,
        severity: corporateAction.severity === 'high' || corporateAction.severity === 'critical' ? corporateAction.severity : null,
        analysisModeOverride: corporateAction.analysis_mode_override || null,
        summary: corporateAction.summary || null,
        confidence: corporateAction.confidence || null,
        dealPricePerShare: corporateAction.deal_price_per_share ?? null,
        contingentValueRightMaxPerShare: corporateAction.contingent_value_right_max_per_share ?? null,
        expectedClose: corporateAction.expected_close || null,
        currentPrice: corporateAction.current_price ?? null,
        currentToDealSpreadPct: corporateAction.current_to_deal_spread_pct ?? null,
      },
    };
  } catch {
    return snapshot;
  }
}

function shouldPersistOverlay(
  baseSnapshot: FundamentalsSnapshotV2,
  overlaidSnapshot: FundamentalsSnapshotV2,
): boolean {
  const keys: Array<keyof FundamentalsSnapshotV2> = [
    'annualRevenue',
    'operatingCashFlowTTM',
    'freeCashFlowTTM',
    'currentRatio',
    'operatingMarginPct',
    'profitMarginPct',
  ];
  return keys.some((key) => baseSnapshot[key] !== overlaidSnapshot[key]);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toBuzzFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function summarizeSentimentLabel(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 45) return 'very_bullish';
  if (score >= 15) return 'bullish';
  if (score <= -45) return 'very_bearish';
  if (score <= -15) return 'bearish';
  return 'neutral';
}

function buildSocialSentimentMetrics(symbol: string, buzz: any): { enrichedBuzz: any; asOf: string } {
  const asOf = new Date().toISOString();
  const bullishPct = toBuzzFiniteNumber(buzz?.bullish_pct);
  const bearishPct = toBuzzFiniteNumber(buzz?.bearish_pct);
  const taggedMessageCount = toBuzzFiniteNumber(buzz?.tagged_message_count) ?? 0;
  const sampledMessageCount = toBuzzFiniteNumber(buzz?.sampled_message_count)
    ?? toBuzzFiniteNumber(buzz?.message_count)
    ?? 0;
  const watchlistCount = toBuzzFiniteNumber(buzz?.watchlist_count) ?? 0;
  const yahooMessageCount = toBuzzFiniteNumber(buzz?.yahoo_message_count) ?? 0;
  const stocktwitsMessageCount = toBuzzFiniteNumber(buzz?.stocktwits_message_count) ?? 0;
  const sourceCount = Array.isArray(buzz?.sources) ? buzz.sources.length : 0;

  const baseTilt = bullishPct != null && bearishPct != null
    ? clamp(bullishPct - bearishPct, -100, 100)
    : 0;
  const taggingCoverage = sampledMessageCount > 0
    ? clamp(taggedMessageCount / sampledMessageCount, 0, 1)
    : 0;
  const volumeFactor = clamp(Math.log10(sampledMessageCount + 1) / Math.log10(91), 0, 1);
  const watcherFactor = clamp(Math.log10(watchlistCount + 1) / Math.log10(100001), 0, 1);
  const sourceFactor = clamp(sourceCount / 2, 0, 1);
  const reliability = clamp(
    (taggingCoverage * 0.45) + (volumeFactor * 0.25) + (watcherFactor * 0.15) + (sourceFactor * 0.15),
    0,
    1,
  );
  const sentimentScore = Math.round(clamp(baseTilt * Math.max(0.25, reliability), -100, 100) * 10) / 10;
  const sentimentIntensity = Math.round(baseTilt * 10) / 10;
  const sentimentConfidence = Math.round(reliability * 1000) / 10;
  const sentimentLabel = summarizeSentimentLabel(sentimentScore);

  upsertSymbolMetrics(symbol, [
    {
      metricName: 'social_sentiment_score',
      metricValueNum: sentimentScore,
      metricValueText: sentimentLabel,
      source: 'social_buzz_aggregate',
      asOf,
      payload: { symbol, source_label: buzz?.source_label ?? null },
    },
    {
      metricName: 'social_sentiment_confidence',
      metricValueNum: sentimentConfidence,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_sentiment_intensity',
      metricValueNum: sentimentIntensity,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_watchers',
      metricValueNum: watchlistCount || 0,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_message_count',
      metricValueNum: sampledMessageCount || 0,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_stocktwits_message_count',
      metricValueNum: stocktwitsMessageCount || 0,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_yahoo_message_count',
      metricValueNum: yahooMessageCount || 0,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_bullish_pct',
      metricValueNum: bullishPct,
      source: 'social_buzz_aggregate',
      asOf,
    },
    {
      metricName: 'social_bearish_pct',
      metricValueNum: bearishPct,
      source: 'social_buzz_aggregate',
      asOf,
    },
  ]);

  return {
    asOf,
    enrichedBuzz: {
      ...buzz,
      sentiment_score: sentimentScore,
      sentiment_confidence: sentimentConfidence,
      sentiment_intensity: sentimentIntensity,
      sentiment_label: sentimentLabel,
      sentiment_as_of: asOf,
    },
  };
}

router.get('/:symbol/buzz', async (req: Request, res: Response) => {
  try {
    const symbol = normalizeMarketDataSymbol(String(req.params.symbol || ''));
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }

    const cached = BUZZ_CACHE.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < BUZZ_TTL_MS) {
      const { enrichedBuzz } = buildSocialSentimentMetrics(symbol, cached.data);
      return res.status(200).json({ success: true, data: enrichedBuzz, cache: 'hit' });
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
      }, 20000);
    });

    const { enrichedBuzz } = buildSocialSentimentMetrics(symbol, data);
    BUZZ_CACHE.set(symbol, { data: enrichedBuzz, fetchedAt: Date.now() });
    return res.status(200).json({ success: true, data: enrichedBuzz });
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
    const withValuation = attachCatalogValuationSnapshot(loaded.snapshot);
    const withLedgerOverlay = await attachLedgerStatementOverlay(
      withValuation,
      coverage,
      forceRefresh,
      context,
    );
    if (shouldPersistOverlay(withValuation, withLedgerOverlay)) {
      await persistFundamentalsSnapshot(loaded.snapshot.symbol, withLedgerOverlay);
    }
    const enrichedSnapshot = await attachSpecialSituation(
      withLedgerOverlay,
      coverage,
      forceRefresh,
      context,
    );
    return res.status(200).json({
      success: true,
      data: {
        symbol: loaded.snapshot.symbol,
        snapshot: enrichedSnapshot,
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
    const withValuation = attachCatalogValuationSnapshot(loaded.snapshot);
    const withLedgerOverlay = await attachLedgerStatementOverlay(
      withValuation,
      coverage,
      forceRefresh,
    );
    if (shouldPersistOverlay(withValuation, withLedgerOverlay)) {
      await persistFundamentalsSnapshot(loaded.snapshot.symbol, withLedgerOverlay);
    }
    const enrichedSnapshot = await attachSpecialSituation(
      withLedgerOverlay,
      coverage,
      forceRefresh,
    );
    return res.status(200).json({
      success: true,
      data: enrichedSnapshot,
      freshness: loaded.freshness,
      coverage,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
