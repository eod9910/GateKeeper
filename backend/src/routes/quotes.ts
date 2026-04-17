/**
 * Quote Routes
 * 
 * Fetches current market prices for symbols using yfinance.
 * Used by Trade History to display live unrealized P&L.
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';
import {
  CacheEnvelope,
  buildBatchFreshnessInfo,
  createCacheEnvelope,
  isFreshTimestamp,
} from '../services/cacheService';
import { readAppCacheEnvelope, writeAppCacheEnvelope } from '../services/appStateDb';

const router = Router();
const QUOTE_TTL_MS = 5 * 60 * 1000;
const OPTION_QUOTE_TTL_MS = 10 * 60 * 1000;
const OPTION_CHAIN_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_NAMESPACE = 'quotes';
const OPTION_QUOTE_CACHE_NAMESPACE = 'option_quotes';
const OPTION_CHAIN_CACHE_NAMESPACE = 'option_chains';

const quoteMemoryCache = new Map<string, CacheEnvelope<unknown>>();
const optionQuoteMemoryCache = new Map<string, CacheEnvelope<unknown>>();
const optionChainMemoryCache = new Map<string, CacheEnvelope<unknown>>();

async function loadQuoteEntry(key: string): Promise<{ entry: CacheEnvelope<unknown> | null; layer: 'memory' | 'disk' | null }> {
  const cached = quoteMemoryCache.get(key) || null;
  if (cached) return { entry: cached, layer: 'memory' };
  const persisted = readAppCacheEnvelope<unknown>(QUOTE_CACHE_NAMESPACE, key);
  if (persisted) quoteMemoryCache.set(key, persisted);
  return { entry: persisted, layer: persisted ? 'disk' : null };
}

async function saveQuoteEntry(key: string, data: unknown): Promise<void> {
  const entry = createCacheEnvelope(key, data, QUOTE_TTL_MS, 'quoteService');
  quoteMemoryCache.set(key, entry);
  writeAppCacheEnvelope(QUOTE_CACHE_NAMESPACE, entry);
}

async function loadOptionQuoteEntry(key: string): Promise<{ entry: CacheEnvelope<unknown> | null; layer: 'memory' | 'disk' | null }> {
  const cached = optionQuoteMemoryCache.get(key) || null;
  if (cached) return { entry: cached, layer: 'memory' };
  const persisted = readAppCacheEnvelope<unknown>(OPTION_QUOTE_CACHE_NAMESPACE, key);
  if (persisted) optionQuoteMemoryCache.set(key, persisted);
  return { entry: persisted, layer: persisted ? 'disk' : null };
}

async function saveOptionQuoteEntry(key: string, data: unknown): Promise<void> {
  const entry = createCacheEnvelope(key, data, OPTION_QUOTE_TTL_MS, 'quoteService');
  optionQuoteMemoryCache.set(key, entry);
  writeAppCacheEnvelope(OPTION_QUOTE_CACHE_NAMESPACE, entry);
}

async function loadOptionChainEntry(key: string): Promise<{ entry: CacheEnvelope<unknown> | null; layer: 'memory' | 'disk' | null }> {
  const cached = optionChainMemoryCache.get(key) || null;
  if (cached) return { entry: cached, layer: 'memory' };
  const persisted = readAppCacheEnvelope<unknown>(OPTION_CHAIN_CACHE_NAMESPACE, key);
  if (persisted) optionChainMemoryCache.set(key, persisted);
  return { entry: persisted, layer: persisted ? 'disk' : null };
}

async function saveOptionChainEntry(key: string, data: unknown): Promise<void> {
  const entry = createCacheEnvelope(key, data, OPTION_CHAIN_TTL_MS, 'quoteService');
  optionChainMemoryCache.set(key, entry);
  writeAppCacheEnvelope(OPTION_CHAIN_CACHE_NAMESPACE, entry);
}

function optionCacheKey(option: any): string {
  return [
    String(option?.symbol || '').trim().toUpperCase(),
    String(option?.expiry || '').trim(),
    String(option?.type || '').trim().toLowerCase(),
    String(option?.strike ?? ''),
  ].join('|');
}

function optionChainCacheKey(request: any): string {
  return [
    String(request?.symbol || '').trim().toUpperCase(),
    String(request?.expiry || '').trim(),
    String(request?.type || '').trim().toLowerCase(),
    String(request?.maxContracts || ''),
  ].join('|');
}

/**
 * POST /api/quotes - Get current prices for multiple symbols
 * Body: { symbols: ["AAPL", "MES=F", ...] }
 * Returns: { success: true, data: { "AAPL": { price, change, changePct }, ... } }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;
    const forceRefresh = req.body?.force_refresh === true;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ success: false, error: 'symbols array required' });
    }
    
    // Limit to 20 symbols per request
    const limitedSymbols = symbols.slice(0, 20).map((symbol: unknown) => String(symbol || '').trim().toUpperCase());
    const normalizedSymbols = limitedSymbols.map((symbol: string) => normalizeMarketDataSymbol(symbol));
    const freshQuotes = new Map<string, unknown>();
    const staleQuotes = new Map<string, unknown>();
    const missingNormalized = new Set<string>();
    let memoryHits = 0;
    let diskHits = 0;
    let refreshedCount = 0;

    if (!forceRefresh) {
      for (const normalized of normalizedSymbols) {
        const cached = await loadQuoteEntry(normalized);
        if (cached.entry?.data != null) {
          if (isFreshTimestamp(cached.entry.fetchedAt, cached.entry.ttlMs)) {
            freshQuotes.set(normalized, cached.entry.data);
            if (cached.layer === 'memory') memoryHits += 1;
            if (cached.layer === 'disk') diskHits += 1;
            continue;
          }
          staleQuotes.set(normalized, cached.entry.data);
        }
        missingNormalized.add(normalized);
      }
    } else {
      normalizedSymbols.forEach((normalized) => missingNormalized.add(normalized));
    }

    let fetchedQuotes: Record<string, unknown> = {};
    if (missingNormalized.size > 0) {
      const quotePath = path.join(__dirname, '..', '..', 'services', 'quoteService.py');
      const proc = spawn('py', [quotePath, ...Array.from(missingNormalized)]);
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      const quotes = await new Promise<Record<string, unknown>>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0) {
            console.error('[QuoteService] stderr:', stderr);
            reject(new Error(`Quote service exited with code ${code}`));
            return;
          }

          try {
            resolve(JSON.parse(stdout));
          } catch {
            console.error('[QuoteService] Failed to parse output:', stdout);
            reject(new Error('Failed to parse quote data'));
          }
        });

        setTimeout(() => {
          proc.kill();
          reject(new Error('Quote service timed out'));
        }, 15000);
      });

      fetchedQuotes = quotes;
      for (const normalized of missingNormalized) {
        const payload = quotes?.[normalized] ?? null;
        if (payload != null) {
          freshQuotes.set(normalized, payload);
          await saveQuoteEntry(normalized, payload);
          refreshedCount += 1;
        }
      }
    }

    const remappedQuotes: Record<string, unknown> = {};
    limitedSymbols.forEach((original: string, index: number) => {
      const normalized = normalizedSymbols[index];
      remappedQuotes[original] = freshQuotes.get(normalized) ?? staleQuotes.get(normalized) ?? fetchedQuotes?.[normalized] ?? null;
    });
    res.json({
      success: true,
      data: remappedQuotes,
      freshness: buildBatchFreshnessInfo({
        ttlMs: QUOTE_TTL_MS,
        memoryHits,
        diskHits,
        refreshedCount,
        totalCount: normalizedSymbols.length,
      }),
    });
    
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/quotes/options - Get current premiums for option contracts
 * Body: { options: [{ symbol, strike, expiry, type, id }, ...] }
 * Returns: { success: true, data: { "trade-id": { premium, bid, ask, mark, iv, ... }, ... } }
 */
router.post('/options', async (req: Request, res: Response) => {
  try {
    const { options } = req.body;
    const forceRefresh = req.body?.force_refresh === true;
    
    if (!options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ success: false, error: 'options array required' });
    }
    
    // Limit to 10 option lookups per request
    const limitedOptions = options.slice(0, 10);
    const freshQuotes: Record<string, unknown> = {};
    const staleQuotes: Record<string, unknown> = {};
    const missingOptions: any[] = [];
    let memoryHits = 0;
    let diskHits = 0;
    let refreshedCount = 0;

    if (!forceRefresh) {
      for (const option of limitedOptions) {
        const tradeId = String(option?.id || '');
        if (!tradeId) continue;
        const cacheKey = optionCacheKey(option);
        const cached = await loadOptionQuoteEntry(cacheKey);
        if (cached.entry?.data != null) {
          if (isFreshTimestamp(cached.entry.fetchedAt, cached.entry.ttlMs)) {
            freshQuotes[tradeId] = cached.entry.data;
            if (cached.layer === 'memory') memoryHits += 1;
            if (cached.layer === 'disk') diskHits += 1;
            continue;
          }
          staleQuotes[tradeId] = cached.entry.data;
        }
        missingOptions.push(option);
      }
    } else {
      missingOptions.push(...limitedOptions);
    }

    if (missingOptions.length > 0) {
      const optionsJson = JSON.stringify(missingOptions);
      const quotePath = path.join(__dirname, '..', '..', 'services', 'quoteService.py');
      const proc = spawn('py', [quotePath, '--options', optionsJson]);
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const quotes = await new Promise<Record<string, unknown>>((resolve, reject) => {
        proc.on('close', (code: number) => {
          if (code !== 0) {
            console.error('[QuoteService:Options] stderr:', stderr);
            reject(new Error(`Option quote service exited with code ${code}`));
            return;
          }

          try {
            resolve(JSON.parse(stdout));
          } catch {
            console.error('[QuoteService:Options] Failed to parse output:', stdout);
            reject(new Error('Failed to parse option quote data'));
          }
        });

        setTimeout(() => {
          proc.kill();
          reject(new Error('Option quote service timed out'));
        }, 20000);
      });

      for (const option of missingOptions) {
        const tradeId = String(option?.id || '');
        const payload = quotes?.[tradeId] ?? null;
        if (payload != null) {
          freshQuotes[tradeId] = payload;
          await saveOptionQuoteEntry(optionCacheKey(option), payload);
          refreshedCount += 1;
        }
      }
    }

    const mergedQuotes: Record<string, unknown> = {};
    for (const option of limitedOptions) {
      const tradeId = String(option?.id || '');
      if (!tradeId) continue;
      mergedQuotes[tradeId] = freshQuotes[tradeId] ?? staleQuotes[tradeId] ?? null;
    }

    res.json({
      success: true,
      data: mergedQuotes,
      freshness: buildBatchFreshnessInfo({
        ttlMs: OPTION_QUOTE_TTL_MS,
        memoryHits,
        diskHits,
        refreshedCount,
        totalCount: limitedOptions.length,
      }),
    });
    
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/quotes/options/chain - Get option chain for a symbol/expiry/type
 * Body: { symbol: "AAPL", expiry?: "2026-07-17", type?: "call", maxContracts?: 120 }
 */
router.post('/options/chain', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.body?.force_refresh === true;
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const expiry = String(req.body?.expiry || '').trim();
    const type = String(req.body?.type || 'call').trim().toLowerCase();
    const maxContracts = Math.max(10, Math.min(parseInt(String(req.body?.maxContracts || '120'), 10) || 120, 250));

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }

    const requestPayload = { symbol, expiry, type, maxContracts };
    const cacheKey = optionChainCacheKey(requestPayload);

    if (!forceRefresh) {
      const cached = await loadOptionChainEntry(cacheKey);
      if (cached.entry?.data != null && isFreshTimestamp(cached.entry.fetchedAt, cached.entry.ttlMs)) {
        return res.json({
          success: true,
          data: cached.entry.data,
          freshness: buildBatchFreshnessInfo({
            ttlMs: OPTION_CHAIN_TTL_MS,
            memoryHits: cached.layer === 'memory' ? 1 : 0,
            diskHits: cached.layer === 'disk' ? 1 : 0,
            refreshedCount: 0,
            totalCount: 1,
          }),
        });
      }
    }

    const quotePath = path.join(__dirname, '..', '..', 'services', 'quoteService.py');
    const proc = spawn('py', [quotePath, '--option-chain', JSON.stringify(requestPayload)]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const chainData = await new Promise<Record<string, unknown>>((resolve, reject) => {
      proc.on('close', (code: number) => {
        if (code !== 0) {
          console.error('[QuoteService:OptionChain] stderr:', stderr);
          reject(new Error(`Option chain service exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.error('[QuoteService:OptionChain] Failed to parse output:', stdout);
          reject(new Error('Failed to parse option chain data'));
        }
      });

      setTimeout(() => {
        proc.kill();
        reject(new Error('Option chain service timed out'));
      }, 20000);
    });

    await saveOptionChainEntry(cacheKey, chainData);
    return res.json({
      success: true,
      data: chainData,
      freshness: buildBatchFreshnessInfo({
        ttlMs: OPTION_CHAIN_TTL_MS,
        memoryHits: 0,
        diskHits: 0,
        refreshedCount: 1,
        totalCount: 1,
      }),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
