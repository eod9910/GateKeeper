import fetch from 'node-fetch';
import * as storage from './storageService';
import * as scanner from './signalScanner';
import { normalizeChartOhlcvPayload } from './contractValidation';
import type { BridgeConfig } from './executionBridge';
import type { BridgeState } from './positionManager';
import type { BrokerConnectionStatus, BrokerPosition, BrokerProvider } from './brokerClient';

const PY_SERVICE_BASE_URL = (process.env.PY_PLUGIN_SERVICE_URL || 'http://127.0.0.1:8100').replace(/\/+$/, '');
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3002'}`).replace(/\/+$/, '');
const IMPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 60 * 1000;

type ManagedPositionSnapshot = {
  symbol?: string;
  strategy_version_id?: string;
  side?: 'long' | 'short';
  entry_price?: number;
  stop_price?: number;
};

export type ImportBrokerProvider = BrokerProvider | 'robinhood';
type ImportInstrumentType = 'stock' | 'forex' | 'futures' | 'crypto' | 'options';
type ImportableBrokerPosition = BrokerPosition & {
  instrument_type?: ImportInstrumentType;
  [key: string]: any;
};

export interface EnrichedBrokerPosition extends BrokerPosition {
  instrument_type?: ImportInstrumentType;
  strategy_version_id?: string;
  strategy_name?: string;
  suggested_stop_price?: number | null;
  suggested_take_profit_price?: number | null;
  suggested_stop_distance?: number | null;
  suggested_take_profit_r?: number | null;
  suggested_atr?: number | null;
  import_reason?: string;
  contract_multiplier?: number;
  option_type?: 'call' | 'put' | string;
  expiration_date?: string;
  strike_price?: number | null;
  external_position_id?: string;
  option_id?: string;
  display_symbol?: string;
}

export interface EnrichedBrokerConnectionStatus extends Omit<BrokerConnectionStatus, 'provider' | 'positions'> {
  provider: ImportBrokerProvider;
  positions: EnrichedBrokerPosition[];
}

type CacheEntry = {
  expiresAt: number;
  value: Partial<EnrichedBrokerPosition>;
};

const importCache = new Map<string, CacheEntry>();

function toNum(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferInstrumentType(provider: ImportBrokerProvider, symbol: string, explicitType?: unknown): ImportInstrumentType {
  const declared = String(explicitType || '').trim().toLowerCase();
  if (declared === 'option' || declared === 'options') return 'options';
  if (declared === 'forex') return 'forex';
  if (declared === 'futures') return 'futures';
  if (declared === 'crypto') return 'crypto';
  if (declared === 'stock') return 'stock';

  const normalized = String(symbol || '').trim().toUpperCase();
  if (provider === 'oanda' || normalized.endsWith('=X')) return 'forex';
  if (normalized.endsWith('=F')) return 'futures';
  if (normalized.endsWith('-USD')) return 'crypto';
  return 'stock';
}

function roundPriceForInstrument(value: number, instrumentType: string, symbol: string): number {
  if (!Number.isFinite(value)) return value;
  if (instrumentType === 'forex') {
    const digits = /JPY(?:=X)?$/i.test(symbol) ? 3 : 5;
    return Number(value.toFixed(digits));
  }
  if (instrumentType === 'crypto') {
    return Number(value.toFixed(value >= 100 ? 2 : 4));
  }
  return Number(value.toFixed(2));
}

function deriveDefaultImportStrategy(
  config: Pick<BridgeConfig, 'strategy_version_id'> | null,
  state: Pick<BridgeState, 'managed_positions'>,
): string | null {
  const fromConfig = String(config?.strategy_version_id || '').trim();
  if (fromConfig) return fromConfig;

  const strategyIds = new Set(
    (Array.isArray(state?.managed_positions) ? state.managed_positions : [])
      .map((pos: any) => String(pos?.strategy_version_id || '').trim())
      .filter(Boolean),
  );

  return strategyIds.size === 1 ? Array.from(strategyIds)[0] : null;
}

function deriveObservedRiskPct(
  managedPositions: ManagedPositionSnapshot[],
  strategyVersionId: string,
): number | null {
  const samples = (Array.isArray(managedPositions) ? managedPositions : [])
    .filter((pos) => String(pos?.strategy_version_id || '').trim() === strategyVersionId)
    .map((pos) => {
      const entry = toNum(pos?.entry_price, 0);
      const stop = toNum(pos?.stop_price, 0);
      if (entry <= 0 || stop <= 0) return 0;
      return Math.abs(entry - stop) / entry;
    })
    .filter((pct) => Number.isFinite(pct) && pct > 0);

  if (!samples.length) return null;
  const total = samples.reduce((sum, value) => sum + value, 0);
  return total / samples.length;
}

async function fetchChartData(symbol: string, interval: string, period = '6mo'): Promise<any[]> {
  try {
    const pyRes = await fetch(`${PY_SERVICE_BASE_URL}/chart/ohlcv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, interval, period }),
      timeout: 30000,
    } as any);

    if (pyRes.ok) {
      const payload = await pyRes.json();
      const normalized = normalizeChartOhlcvPayload(payload, symbol, interval);
      return Array.isArray(normalized.chart_data) ? normalized.chart_data : [];
    }
  } catch {
    // Fall through to the app route, which has its own spawn fallback.
  }

  const appRes = await fetch(`${APP_BASE_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`, {
    timeout: 30000,
  } as any);
  if (!appRes.ok) {
    throw new Error(`chart fetch failed: ${appRes.status}`);
  }
  const payload = await appRes.json();
  const normalized = normalizeChartOhlcvPayload(payload, symbol, interval);
  return Array.isArray(normalized.chart_data) ? normalized.chart_data : [];
}

async function enrichPositionWithStrategy(
  provider: ImportBrokerProvider,
  position: BrokerPosition,
  strategyVersionId: string,
  strategyName: string,
  interval: string,
  atrMultiplier: number,
  takeProfitR: number,
  observedRiskPct: number | null,
): Promise<Partial<EnrichedBrokerPosition>> {
  const symbol = String(position.symbol || '').trim().toUpperCase();
  const instrumentType = inferInstrumentType(provider, symbol, (position as any)?.instrument_type);
  const entry = toNum(position.avg_entry_price, 0);
  const side = position.side === 'short' ? 'short' : 'long';

  if (entry <= 0) {
    return {
      instrument_type: instrumentType,
      strategy_version_id: strategyVersionId,
      strategy_name: strategyName,
      import_reason: `Imported from ${provider.toUpperCase()} with ${strategyVersionId}; entry price unavailable for risk template.`,
    };
  }

  const cacheKey = `${provider}:${symbol}:${side}:${entry}:${strategyVersionId}`;
  const cached = importCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let atr: number | null = null;
  let stopDistance = 0;
  let importReason = `Imported from ${provider.toUpperCase()} using ${strategyVersionId} risk template.`;

  if (atrMultiplier > 0) {
    try {
      const bars = await fetchChartData(symbol, interval || '1d');
      const inferredAtr = scanner.inferAtr({ chart_data: bars }, 14);
      if (inferredAtr > 0) {
        atr = inferredAtr;
        stopDistance = inferredAtr * atrMultiplier;
        importReason = `Imported from ${provider.toUpperCase()} using ${strategyVersionId} ATR x ${atrMultiplier} risk template.`;
      }
    } catch {
      // Fall through to observed-risk fallback.
    }
  }

  if (stopDistance <= 0 && observedRiskPct && observedRiskPct > 0) {
    stopDistance = entry * observedRiskPct;
    importReason = `Imported from ${provider.toUpperCase()} using ${strategyVersionId} observed live risk template.`;
  }

  if (stopDistance <= 0) {
    const partial: Partial<EnrichedBrokerPosition> = {
      instrument_type: instrumentType,
      strategy_version_id: strategyVersionId,
      strategy_name: strategyName,
      suggested_take_profit_r: takeProfitR > 0 ? takeProfitR : null,
      import_reason: `${importReason} Stop distance could not be derived.`,
    };
    importCache.set(cacheKey, { expiresAt: Date.now() + FALLBACK_CACHE_TTL_MS, value: partial });
    return partial;
  }

  const rawStop = side === 'short' ? entry + stopDistance : entry - stopDistance;
  const rawTarget = takeProfitR > 0
    ? (side === 'short' ? entry - (stopDistance * takeProfitR) : entry + (stopDistance * takeProfitR))
    : NaN;

  const enriched: Partial<EnrichedBrokerPosition> = {
    instrument_type: instrumentType,
    strategy_version_id: strategyVersionId,
    strategy_name: strategyName,
    suggested_stop_price: roundPriceForInstrument(rawStop, instrumentType, symbol),
    suggested_take_profit_price: Number.isFinite(rawTarget)
      ? roundPriceForInstrument(rawTarget, instrumentType, symbol)
      : null,
    suggested_stop_distance: stopDistance,
    suggested_take_profit_r: takeProfitR > 0 ? takeProfitR : null,
    suggested_atr: atr,
    import_reason: importReason,
  };

  const cacheTtl = atr && atr > 0 ? IMPORT_CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS;
  importCache.set(cacheKey, { expiresAt: Date.now() + cacheTtl, value: enriched });
  return enriched;
}

export async function enrichConnectedBrokerStatuses(params: {
  executionBrokerProvider: BrokerProvider;
  config: Pick<BridgeConfig, 'strategy_version_id'> | null;
  state: Pick<BridgeState, 'managed_positions'>;
  connectedBrokers: Array<Omit<BrokerConnectionStatus, 'provider' | 'positions'> & {
    provider: ImportBrokerProvider;
    positions: ImportableBrokerPosition[];
  }>;
}): Promise<{
  connectedBrokers: EnrichedBrokerConnectionStatus[];
  defaultImportStrategyVersionId: string | null;
}> {
  const { executionBrokerProvider, config, state, connectedBrokers } = params;
  const defaultImportStrategyVersionId = deriveDefaultImportStrategy(config, state);

  if (!defaultImportStrategyVersionId) {
    return {
      defaultImportStrategyVersionId: null,
      connectedBrokers: connectedBrokers.map((entry) => ({
        ...entry,
        positions: (entry.positions || []).map((position) => ({
          ...position,
          instrument_type: inferInstrumentType(entry.provider, position.symbol, position.instrument_type),
        })),
      })),
    };
  }

  const spec = await storage.getStrategyOrComposite(defaultImportStrategyVersionId);
  if (!spec) {
    return {
      defaultImportStrategyVersionId,
      connectedBrokers: connectedBrokers.map((entry) => ({
        ...entry,
        positions: (entry.positions || []).map((position) => ({
          ...position,
          instrument_type: inferInstrumentType(entry.provider, position.symbol, position.instrument_type),
        })),
      })),
    };
  }

  const riskConfig = ((spec.risk_config || (spec as any).risk || {}) as Record<string, any>);
  const atrMultiplier = toNum(riskConfig.atr_multiplier ?? riskConfig.stop_value, 0);
  const takeProfitR = scanner.resolveTakeProfitR(spec);
  const observedRiskPct = deriveObservedRiskPct(state.managed_positions as ManagedPositionSnapshot[], defaultImportStrategyVersionId);
  const interval = String(spec.interval || '1d').trim() || '1d';
  const managedKeys = new Set(
    (Array.isArray(state?.managed_positions) ? state.managed_positions : []).map((pos: any) => {
      const symbol = String(pos?.symbol || '').trim().toUpperCase();
      const side = pos?.side === 'short' ? 'short' : 'long';
      return `${executionBrokerProvider}:${symbol}:${side}`;
    }),
  );

  const connected = await Promise.all(connectedBrokers.map(async (entry) => {
    const positions = await Promise.all((entry.positions || []).map(async (position) => {
      const instrumentType = inferInstrumentType(entry.provider, position.symbol, position.instrument_type);
      const base: EnrichedBrokerPosition = {
        ...position,
        instrument_type: instrumentType,
      };

      if (instrumentType === 'options') {
        return {
          ...base,
          import_reason: base.import_reason || `Imported from ${String(entry.label || entry.provider).toUpperCase()} as an options position.`,
        };
      }

      const key = `${entry.provider}:${String(position.symbol || '').trim().toUpperCase()}:${position.side === 'short' ? 'short' : 'long'}`;
      if (managedKeys.has(key)) {
        return base;
      }

      const template = await enrichPositionWithStrategy(
        entry.provider,
        position,
        defaultImportStrategyVersionId,
        String(spec.name || defaultImportStrategyVersionId),
        interval,
        atrMultiplier,
        takeProfitR,
        observedRiskPct,
      );

      return { ...base, ...template };
    }));

    return { ...entry, positions };
  }));

  return {
    connectedBrokers: connected,
    defaultImportStrategyVersionId,
  };
}
