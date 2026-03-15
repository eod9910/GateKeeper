import * as fs from 'fs/promises';
import * as path from 'path';
import { StrategySpec } from '../types';
import * as storage from './storageService';
import * as pluginClient from './pluginServiceClient';
import * as broker from './brokerClient';
import * as logger from './executionLogger';

export interface SignalCandidate {
  symbol: string;
  entry_price: number;
  stop_price: number;
  stop_distance: number;
  take_profit_price: number;
  atr: number;
  score: number;
  signal_bar_date: string;
  strategy_version_id: string;
  raw_candidate: any;
}

interface SymbolCatalog {
  symbols?: unknown;
  all?: unknown;
  crypto?: unknown;
  futures?: unknown;
  stocks?: unknown;
}

function toNum(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferEntryPrice(candidate: any): number {
  const fromAnchors = toNum(candidate?.anchors?.entry_price || candidate?.anchors?.close_price, 0);
  if (fromAnchors > 0) return fromAnchors;

  const chartData = Array.isArray(candidate?.chart_data) ? candidate.chart_data : [];
  const windowEnd = toNum(candidate?.window_end, chartData.length - 1);
  const bar = chartData[Math.max(0, Math.min(windowEnd, chartData.length - 1))];
  return toNum(bar?.Close || bar?.close, 0);
}

function getBarHigh(bar: any): number {
  return toNum(bar?.High ?? bar?.high, NaN);
}

function getBarLow(bar: any): number {
  return toNum(bar?.Low ?? bar?.low, NaN);
}

function getBarClose(bar: any): number {
  return toNum(bar?.Close ?? bar?.close, NaN);
}

export function inferAtr(candidate: any, period = 14): number {
  const fromAnchors = toNum(candidate?.anchors?.atr ?? candidate?.anchors?.atr_value, 0);
  if (fromAnchors > 0) return fromAnchors;

  const chartData = Array.isArray(candidate?.chart_data) ? candidate.chart_data : [];
  if (chartData.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < chartData.length; i += 1) {
    const prevClose = getBarClose(chartData[i - 1]);
    const high = getBarHigh(chartData[i]);
    const low = getBarLow(chartData[i]);
    if (!Number.isFinite(prevClose) || !Number.isFinite(high) || !Number.isFinite(low)) continue;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    if (Number.isFinite(tr) && tr > 0) {
      trueRanges.push(tr);
    }
  }

  if (trueRanges.length === 0) return 0;
  const sample = trueRanges.slice(-Math.max(1, period));
  const atr = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  return Number.isFinite(atr) ? atr : 0;
}

function getRiskConfig(spec: StrategySpec): Record<string, any> {
  return (spec.risk_config || (spec as any).risk || {}) as Record<string, any>;
}

export function resolveTakeProfitR(spec: StrategySpec): number {
  const exitConfig = (spec.exit_config || {}) as Record<string, any>;
  const targetType = String(exitConfig.target_type || '').trim().toLowerCase();
  const exitTarget = toNum(exitConfig.target_level, 0);
  if (targetType === 'r_multiple' && exitTarget > 0) {
    return exitTarget;
  }

  const riskConfig = getRiskConfig(spec);
  return toNum(riskConfig.take_profit_R ?? riskConfig.take_profit_r, 2);
}

export async function scanForSignals(strategyVersionId: string): Promise<SignalCandidate[]> {
  const spec = await storage.getStrategyOrComposite(strategyVersionId);
  if (!spec) {
    throw new Error(`Strategy ${strategyVersionId} not found`);
  }

  const baseUniverse = spec.universe && spec.universe.length > 0
    ? spec.universe
    : await loadDefaultUniverseForAssetClass(spec.asset_class);
  const universe = await filterUniverseForBroker(spec, baseUniverse);
  if (universe.length === 0) {
    logger.log({
      event: 'scan_completed',
      strategy_version_id: strategyVersionId,
      details: {
        universe_scanned: 0,
        total_candidates: 0,
        actionable_signals: 0,
        skipped: true,
        reason: 'empty_universe',
        asset_class: spec.asset_class || 'unknown',
      },
    });
    return [];
  }

  const interval = spec.interval || '1d';
  const period = '2y';

  logger.log({
    event: 'scan_started',
    strategy_version_id: strategyVersionId,
    details: {
      universe_size: universe.length,
      requested_universe_size: baseUniverse.length,
      broker_filtered_out: Math.max(0, baseUniverse.length - universe.length),
      interval,
      period,
    },
  });

  const result = await pluginClient.runScannerUniverseViaService(
    spec,
    universe,
    interval,
    period,
    interval,
    'scan',
  );

  const riskConfig = getRiskConfig(spec);
  const atrMultiplier = toNum(riskConfig.atr_multiplier ?? riskConfig.stop_value, 2);
  const takeProfitR = resolveTakeProfitR(spec);

  const signals: SignalCandidate[] = [];
  for (const symbolResult of result.results || []) {
    if (symbolResult.error || !Array.isArray(symbolResult.candidates)) continue;

    for (const candidate of symbolResult.candidates) {
      if (!candidate?.entry_ready) continue;

      const entryPrice = inferEntryPrice(candidate);
      if (entryPrice <= 0) continue;

      const atr = inferAtr(candidate);
      if (atr <= 0 || atrMultiplier <= 0 || takeProfitR <= 0) continue;

      const stopDistance = Math.abs(atr * atrMultiplier);
      if (stopDistance <= 0) continue;

      const stopPrice = entryPrice - stopDistance;
      const takeProfitPrice = entryPrice + (stopDistance * takeProfitR);
      const score = toNum(candidate?.score, 0);

      logger.log({
        event: 'signal_detected',
        strategy_version_id: strategyVersionId,
        symbol: symbolResult.symbol,
        details: {
          score,
          entry_price: entryPrice,
          stop_distance: stopDistance,
        },
      });

      signals.push({
        symbol: symbolResult.symbol,
        entry_price: entryPrice,
        stop_price: stopPrice,
        stop_distance: stopDistance,
        take_profit_price: takeProfitPrice,
        atr,
        score,
        signal_bar_date: candidate?.anchors?.signal_date || new Date().toISOString(),
        strategy_version_id: strategyVersionId,
        raw_candidate: candidate,
      });
    }
  }

  logger.log({
    event: 'scan_completed',
    strategy_version_id: strategyVersionId,
    details: {
      universe_scanned: result.total_symbols,
      total_candidates: result.total_candidates,
      actionable_signals: signals.length,
      symbols_with_signals: Array.from(new Set(signals.map((s) => s.symbol))),
    },
  });

  return signals;
}

async function filterUniverseForBroker(spec: StrategySpec, universe: string[]): Promise<string[]> {
  if (!Array.isArray(universe) || universe.length === 0) return [];

  try {
    const assetChecks = await Promise.all(
      universe.map(async (symbol) => {
        const asset = await broker.getAsset(symbol);
        return {
          symbol,
          tradable: Boolean(asset && asset.tradable && asset.status === 'active'),
        };
      }),
    );

    const filtered = assetChecks.filter((row) => row.tradable).map((row) => row.symbol);
    if (filtered.length > 0) return filtered;

    logger.log({
      event: 'error',
      strategy_version_id: spec.strategy_version_id,
      details: {
        action: 'broker_universe_filter',
        error: 'No broker-tradable symbols remain after filtering',
        asset_class: spec.asset_class || 'unknown',
      },
    });
    return [];
  } catch (err: any) {
    logger.log({
      event: 'error',
      strategy_version_id: spec.strategy_version_id,
      details: {
        action: 'broker_universe_filter',
        error: err?.message || String(err),
      },
    });
    return universe;
  }
}

function normalizeSymbols(symbols: unknown): string[] {
  if (!Array.isArray(symbols)) return [];
  return symbols.map((s: any) => String(s || '').trim().toUpperCase()).filter(Boolean);
}

export async function loadDefaultUniverseForAssetClass(assetClass?: string): Promise<string[]> {
  const symbolsPath = path.join(__dirname, '../../data/symbols.json');
  try {
    const raw = await fs.readFile(symbolsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeSymbols(parsed);
    }

    const catalog = (parsed || {}) as SymbolCatalog;
    const preferredBuckets =
      assetClass === 'crypto'
        ? [catalog.crypto, catalog.all, catalog.symbols]
        : assetClass === 'futures'
          ? [catalog.futures, catalog.all, catalog.symbols]
          : [catalog.all, catalog.symbols, catalog.crypto, catalog.futures, catalog.stocks];

    for (const bucket of preferredBuckets) {
      const symbols = normalizeSymbols(bucket);
      if (symbols.length > 0) return symbols;
    }

    for (const value of Object.values(catalog)) {
      const symbols = normalizeSymbols(value);
      if (symbols.length > 0) return Array.from(new Set(symbols));
    }

    return [];
  } catch {
    return [];
  }
}
