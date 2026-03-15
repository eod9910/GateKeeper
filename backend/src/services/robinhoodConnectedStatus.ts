import type { BrokerAccount, BrokerCapabilities } from './brokerClient';
import type { EnrichedBrokerConnectionStatus, EnrichedBrokerPosition } from './importedBrokerPositions';
import type { RobinhoodFlowConfig } from './robinhoodAuthFlow';
import { fetchRobinhoodPositions } from './robinhoodAuthFlow';

const CACHE_TTL_MS = 20_000;

type RobinhoodSnapshot = {
  source?: string;
  account?: {
    id?: string;
    cash?: number;
    buying_power?: number;
    portfolio_value?: number;
    equity?: number;
    last_equity?: number;
    day_pnl?: number;
    day_pnl_pct?: number;
  } | null;
  stocks?: any[];
  options?: any[];
  counts?: {
    stocks?: number;
    options?: number;
  };
};

type CacheEntry = {
  expiresAt: number;
  value: EnrichedBrokerConnectionStatus;
};

let statusCache: CacheEntry | null = null;

function trim(value: unknown): string {
  return String(value || '').trim();
}

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPct(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function baseCapabilities(): BrokerCapabilities {
  return {
    account_read: true,
    positions_read: true,
    automated_execution: false,
  };
}

function mapAccount(snapshot: RobinhoodSnapshot | null | undefined): BrokerAccount | null {
  const raw = snapshot?.account;
  if (!raw || typeof raw !== 'object') return null;

  const equity = toNum(raw.equity, 0);
  const lastEquity = toNum(raw.last_equity, equity);
  const dayPnl = raw.day_pnl != null ? toNum(raw.day_pnl, 0) : (equity - lastEquity);
  const dayPnlPct = raw.day_pnl_pct != null
    ? toNum(raw.day_pnl_pct, 0)
    : (lastEquity ? (dayPnl / lastEquity) * 100 : 0);

  return {
    id: trim(raw.id) || 'robinhood',
    cash: toNum(raw.cash, 0),
    portfolio_value: toNum(raw.portfolio_value, equity),
    buying_power: toNum(raw.buying_power, 0),
    equity,
    last_equity: lastEquity,
    day_pnl: dayPnl,
    day_pnl_pct: dayPnlPct,
  };
}

function normalizeOptionEntryPremium(rawAveragePrice: unknown, markPrice: unknown, contractMultiplier: number): number {
  const average = toNum(rawAveragePrice, 0);
  const mark = toNum(markPrice, 0);
  if (average <= 0) return 0;
  if (contractMultiplier > 1 && mark > 0 && average > (mark * 5)) {
    return average / contractMultiplier;
  }
  return average;
}

function buildStockPosition(item: any): EnrichedBrokerPosition | null {
  const symbol = trim(item?.symbol).toUpperCase();
  const qty = Math.abs(toNum(item?.quantity, 0));
  if (!symbol || qty <= 0) return null;

  const entry = toNum(item?.average_buy_price, 0);
  const current = toNum(item?.current_price, entry);
  const marketValue = toNum(item?.equity, current * qty);
  const costBasis = entry * qty;

  return {
    symbol,
    qty,
    side: 'long',
    avg_entry_price: entry,
    current_price: current,
    market_value: marketValue,
    unrealized_pnl: marketValue - costBasis,
    unrealized_pnl_pct: toPct(item?.percent_change),
    instrument_type: 'stock',
    import_reason: 'Imported from Robinhood into the Execution mirror.',
    external_position_id: trim(item?.raw?.id) || undefined,
    display_symbol: symbol,
  };
}

function buildOptionPosition(item: any): EnrichedBrokerPosition | null {
  const symbol = trim(item?.symbol).toUpperCase();
  const qty = Math.abs(toNum(item?.quantity, 0));
  if (!symbol || qty <= 0) return null;

  const contractMultiplier = Math.max(1, Math.round(toNum(item?.raw?.trade_value_multiplier, item?.contract_multiplier || 100)));
  const currentPremium = toNum(item?.mark_price, 0);
  const entryPremium = normalizeOptionEntryPremium(item?.average_price, currentPremium, contractMultiplier);
  const marketValue = currentPremium > 0 ? qty * currentPremium * contractMultiplier : 0;
  const costBasis = entryPremium > 0 ? qty * entryPremium * contractMultiplier : 0;
  const strike = toNum(item?.strike_price, 0);
  const optionType = trim(item?.option_type).toLowerCase() || 'call';
  const expiration = trim(item?.expiration_date);
  const displayParts = [symbol, expiration, strike > 0 ? String(strike) : '', optionType.toUpperCase()].filter(Boolean);

  return {
    symbol,
    qty,
    side: 'long',
    avg_entry_price: entryPremium,
    current_price: currentPremium,
    market_value: marketValue,
    unrealized_pnl: marketValue - costBasis,
    unrealized_pnl_pct: entryPremium > 0 ? (((currentPremium - entryPremium) / entryPremium) * 100) : 0,
    instrument_type: 'options',
    contract_multiplier: contractMultiplier,
    option_type: optionType,
    expiration_date: expiration || undefined,
    strike_price: strike > 0 ? strike : null,
    option_id: trim(item?.option_id) || undefined,
    external_position_id: trim(item?.raw?.id) || trim(item?.option_id) || undefined,
    display_symbol: displayParts.join(' '),
    import_reason: 'Imported from Robinhood into the Execution mirror as an options position.',
  };
}

function mapSnapshot(snapshot: RobinhoodSnapshot | null | undefined): EnrichedBrokerPosition[] {
  if (!snapshot) return [];

  const mapped: EnrichedBrokerPosition[] = [];

  for (const item of Array.isArray(snapshot.stocks) ? snapshot.stocks : []) {
    const position = buildStockPosition(item);
    if (position) mapped.push(position);
  }

  for (const item of Array.isArray(snapshot.options) ? snapshot.options : []) {
    const position = buildOptionPosition(item);
    if (position) mapped.push(position);
  }

  return mapped;
}

function buildStatus(params: {
  configured: boolean;
  account?: BrokerAccount | null;
  positions?: EnrichedBrokerPosition[];
  error?: string;
}): EnrichedBrokerConnectionStatus {
  return {
    provider: 'robinhood',
    label: 'Robinhood',
    configured: params.configured,
    mode: 'live',
    capabilities: baseCapabilities(),
    account: params.account || null,
    positions: params.positions || [],
    error: params.error,
  };
}

export function clearRobinhoodConnectedStatusCache(): void {
  statusCache = null;
}

export async function getRobinhoodConnectedStatus(config: RobinhoodFlowConfig = {}): Promise<EnrichedBrokerConnectionStatus | null> {
  const username = trim(config.username);
  const password = trim(config.password);
  if (!username || !password) {
    clearRobinhoodConnectedStatusCache();
    return null;
  }

  if (statusCache && statusCache.expiresAt > Date.now()) {
    return statusCache.value;
  }

  try {
    const data = await fetchRobinhoodPositions(config);
    const snapshot = (data && data.snapshot) as RobinhoodSnapshot;
    const positions = mapSnapshot(snapshot);
    const account = mapAccount(snapshot);
    const status = buildStatus({ configured: true, account, positions });
    statusCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: status,
    };
    return status;
  } catch (err: any) {
    const status = buildStatus({
      configured: true,
      positions: [],
      error: err?.message || String(err),
    });
    statusCache = {
      expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 5_000),
      value: status,
    };
    return status;
  }
}
