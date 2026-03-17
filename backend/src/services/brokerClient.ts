import Alpaca from '@alpacahq/alpaca-trade-api';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'execution-settings.json');
const OANDA_PRACTICE_BASE_URL = 'https://api-fxpractice.oanda.com';
const OANDA_LIVE_BASE_URL = 'https://api-fxtrade.oanda.com';

export type BrokerProvider = 'alpaca' | 'oanda';
type AlpacaMode = 'paper' | 'live';
type OandaEnvironment = 'practice' | 'live';

interface SavedExecutionSettings {
  execution_broker_provider?: BrokerProvider;
  broker_provider?: BrokerProvider;
  alpaca_api_key?: string;
  alpaca_secret_key?: string;
  alpaca_base_url?: string;
  alpaca_mode?: AlpacaMode;
  oanda_api_token?: string;
  oanda_account_id?: string;
  oanda_environment?: OandaEnvironment;
  oanda_base_url?: string;
}

interface AlpacaConfig {
  key: string;
  secret: string;
  baseUrl: string;
  mode: AlpacaMode;
}

interface OandaConfig {
  token: string;
  accountId?: string;
  environment: OandaEnvironment;
  baseUrl: string;
}

interface OandaTradeSummary {
  id: string;
  instrument: string;
  currentUnits: number;
  price: number;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
}

export interface BrokerAccount {
  id: string;
  cash: number;
  portfolio_value: number;
  buying_power: number;
  equity: number;
  last_equity: number;
  day_pnl: number;
  day_pnl_pct: number;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  stop_price?: number | null;
  take_profit_price?: number | null;
}

interface BrokerAsset {
  symbol: string;
  status: string;
  tradable: boolean;
  class?: string;
  exchange?: string;
}

export interface BrokerOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc';
  status: string;
  filled_avg_price: number | null;
  filled_qty: number;
  submitted_at: string;
  filled_at: string | null;
  limit_price?: number;
  stop_price?: number;
}

export interface BrokerCapabilities {
  account_read: boolean;
  positions_read: boolean;
  automated_execution: boolean;
}

export interface BrokerConnectionStatus {
  provider: BrokerProvider;
  label: string;
  configured: boolean;
  mode: 'paper' | 'live';
  capabilities: BrokerCapabilities;
  account: BrokerAccount | null;
  positions: BrokerPosition[];
  error?: string;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export interface BracketOrderRequest {
  symbol: string;
  qty: number;
  side: OrderSide;
  type: OrderType;
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
  take_profit: { limit_price: number };
  stop_loss: { stop_price: number };
  client_order_id?: string;
}

export interface ExitOrderRequest {
  symbol: string;
  qty: number;
  time_in_force: 'day' | 'gtc';
  take_profit: { limit_price: number };
  stop_loss: { stop_price: number };
  client_order_id?: string;
}

let _alpacaClient: any = null;
const _assetCache = new Map<string, BrokerAsset | null>();
let _resolvedOandaAccountId: string | null = null;

function readSavedSettings(): SavedExecutionSettings | null {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeProvider(raw: string | undefined | null): BrokerProvider | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'alpaca' || normalized === 'oanda') {
    return normalized;
  }
  return null;
}

function normalizeOandaEnvironment(raw: string | undefined | null): OandaEnvironment {
  return String(raw || '').trim().toLowerCase() === 'live' ? 'live' : 'practice';
}

function resolveOandaBaseUrl(environment: OandaEnvironment, override?: string): string {
  const candidate = String(override || '').trim();
  if (candidate) return candidate;
  return environment === 'live' ? OANDA_LIVE_BASE_URL : OANDA_PRACTICE_BASE_URL;
}

function readAlpacaConfig(): AlpacaConfig | null {
  let key = process.env.ALPACA_API_KEY || '';
  let secret = process.env.ALPACA_SECRET_KEY || '';
  let baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  let mode: AlpacaMode = process.env.ALPACA_MODE === 'live' ? 'live' : 'paper';

  if (!key || !secret) {
    const saved = readSavedSettings();
    if (saved?.alpaca_api_key && saved?.alpaca_secret_key) {
      key = saved.alpaca_api_key;
      secret = saved.alpaca_secret_key;
      baseUrl = saved.alpaca_base_url || baseUrl;
      mode = saved.alpaca_mode === 'live' ? 'live' : 'paper';
    }
  }

  if (!key || !secret) return null;
  return { key, secret, baseUrl, mode };
}

function readOandaConfig(): OandaConfig | null {
  let token = process.env.OANDA_API_TOKEN || '';
  let accountId = process.env.OANDA_ACCOUNT_ID || '';
  let environment = normalizeOandaEnvironment(process.env.OANDA_ENVIRONMENT);
  let baseUrl = resolveOandaBaseUrl(environment, process.env.OANDA_BASE_URL);

  if (!token) {
    const saved = readSavedSettings();
    if (saved?.oanda_api_token) {
      token = saved.oanda_api_token;
      accountId = saved.oanda_account_id || accountId;
      environment = normalizeOandaEnvironment(saved.oanda_environment);
      baseUrl = resolveOandaBaseUrl(environment, saved.oanda_base_url);
    }
  }

  if (!token) return null;
  return {
    token,
    accountId: accountId || undefined,
    environment,
    baseUrl,
  };
}

function getAlpacaClient(): any {
  if (_alpacaClient) return _alpacaClient;

  const config = readAlpacaConfig();
  if (!config) {
    throw new Error('Alpaca API keys not configured. Go to Execution -> Settings to enter your keys.');
  }

  _alpacaClient = new Alpaca({
    keyId: config.key,
    secretKey: config.secret,
    paper: config.baseUrl.includes('paper'),
    baseUrl: config.baseUrl,
  } as any);
  return _alpacaClient;
}

function toNum(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resetClient(): void {
  _alpacaClient = null;
  _assetCache.clear();
  _resolvedOandaAccountId = null;
}

export function getExecutionBrokerProvider(): BrokerProvider {
  const saved = readSavedSettings();
  const explicit = normalizeProvider(process.env.EXECUTION_BROKER_PROVIDER)
    || normalizeProvider(saved?.execution_broker_provider);
  if (explicit) return explicit;
  if (readAlpacaConfig()) return 'alpaca';
  const legacy = normalizeProvider(saved?.broker_provider);
  if (legacy) return legacy;
  if (readOandaConfig()) return 'oanda';
  return 'alpaca';
}

export function getBrokerProvider(): BrokerProvider {
  return getExecutionBrokerProvider();
}

export function getBrokerLabel(provider: BrokerProvider = getExecutionBrokerProvider()): string {
  return provider === 'oanda' ? 'OANDA' : 'Alpaca';
}

export function getBrokerCapabilities(provider: BrokerProvider = getExecutionBrokerProvider()): BrokerCapabilities {
  return {
    account_read: true,
    positions_read: true,
    automated_execution: provider === 'alpaca',
  };
}

export function supportsAutomatedExecution(provider: BrokerProvider = getExecutionBrokerProvider()): boolean {
  return getBrokerCapabilities(provider).automated_execution;
}

export function isProviderConfigured(provider: BrokerProvider): boolean {
  return provider === 'alpaca' ? Boolean(readAlpacaConfig()) : Boolean(readOandaConfig());
}

export function getConnectedProviders(): BrokerProvider[] {
  const providers: BrokerProvider[] = [];
  if (readAlpacaConfig()) providers.push('alpaca');
  if (readOandaConfig()) providers.push('oanda');
  return providers;
}

function ensureAutomatedExecutionSupported(action: string): void {
  const provider = getExecutionBrokerProvider();
  if (!supportsAutomatedExecution(provider)) {
    throw new Error(`${getBrokerLabel(provider)} is currently connected in read-only mode. ${action} is only implemented for Alpaca.`);
  }
}

export function toBrokerSymbol(symbol: string): string {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (/-USD$/.test(normalized)) {
    return normalized.replace('-', '');
  }
  return normalized;
}

export function fromBrokerSymbol(symbol: string): string {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized.includes('-') && /^[A-Z0-9]+USD$/.test(normalized) && normalized.length > 5) {
    return `${normalized.slice(0, -3)}-USD`;
  }
  return normalized;
}

export function toOandaInstrument(symbol: string): string {
  const normalized = String(symbol || '').trim().toUpperCase();
  const compact = normalized.replace(/=X$/i, '').replace(/[^A-Z]/g, '');
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact.slice(0, 3)}_${compact.slice(3)}`;
  }
  throw new Error(`Cannot map symbol to OANDA instrument: ${symbol}`);
}

export function fromOandaInstrument(symbol: string): string {
  const normalized = String(symbol || '').trim().toUpperCase();
  const compact = normalized.replace(/[^A-Z]/g, '');
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact}=X`;
  }
  return normalized;
}

export function isPaperMode(provider: BrokerProvider = getExecutionBrokerProvider()): boolean {
  if (provider === 'oanda') {
    return readOandaConfig()?.environment !== 'live';
  }
  return readAlpacaConfig()?.mode !== 'live';
}

async function oandaRequest<T>(
  pathname: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const config = readOandaConfig();
  if (!config) {
    throw new Error('OANDA API token not configured. Go to Execution -> Settings to enter your token.');
  }

  const url = new URL(`/v3/${pathname.replace(/^\/+/, '')}`, config.baseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const errorMessage = body?.errorMessage || body?.message || `HTTP ${response.status}`;
    throw new Error(`OANDA request failed: ${errorMessage}`);
  }
  return body as T;
}

async function oandaRequestWithBody<T>(
  method: 'POST' | 'PUT',
  pathname: string,
  body?: Record<string, any>,
): Promise<T> {
  const config = readOandaConfig();
  if (!config) {
    throw new Error('OANDA API token not configured. Go to Execution -> Settings to enter your token.');
  }

  const url = new URL(`/v3/${pathname.replace(/^\/+/, '')}`, config.baseUrl);
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const errorMessage = parsed?.errorMessage || parsed?.message || `HTTP ${response.status}`;
    throw new Error(`OANDA request failed: ${errorMessage}`);
  }
  return parsed as T;
}

async function resolveOandaAccountId(): Promise<string> {
  if (_resolvedOandaAccountId) return _resolvedOandaAccountId;

  const config = readOandaConfig();
  if (!config) {
    throw new Error('OANDA API token not configured. Go to Execution -> Settings to enter your token.');
  }

  if (config.accountId) {
    _resolvedOandaAccountId = config.accountId;
    return config.accountId;
  }

  const body = await oandaRequest<{ accounts?: Array<{ id?: string }> }>('accounts');
  const accountId = body.accounts?.find((account) => account?.id)?.id;
  if (!accountId) {
    throw new Error('No OANDA account ID returned by the API.');
  }
  _resolvedOandaAccountId = accountId;
  return accountId;
}

function extractOandaPrice(price: any): number {
  const closeoutBid = toNum(price?.closeoutBid);
  const closeoutAsk = toNum(price?.closeoutAsk);
  if (closeoutBid > 0 && closeoutAsk > 0) {
    return (closeoutBid + closeoutAsk) / 2;
  }
  const bid = toNum(price?.bids?.[0]?.price);
  const ask = toNum(price?.asks?.[0]?.price);
  if (bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return closeoutBid || closeoutAsk || bid || ask || 0;
}

function formatOandaPrice(instrument: string, price: number): string {
  const digits = /_JPY$/i.test(String(instrument || '').trim().toUpperCase()) ? 3 : 5;
  return toNum(price).toFixed(digits);
}

function formatOandaUnits(units: number): string {
  const rounded = Math.round(toNum(units, 0));
  return String(rounded);
}

function mapOandaOrderTransaction(transaction: any): BrokerOrder {
  const units = Math.abs(toNum(transaction?.units));
  const symbol = fromOandaInstrument(String(transaction?.instrument || ''));
  const type = String(transaction?.type || 'MARKET').trim().toUpperCase();
  const side = toNum(transaction?.units) >= 0 ? 'buy' : 'sell';

  return {
    id: String(transaction?.id || ''),
    client_order_id: String(transaction?.clientExtensions?.id || transaction?.clientOrderID || ''),
    symbol,
    qty: units,
    side: side as BrokerOrder['side'],
    type: type === 'LIMIT'
      ? 'limit'
      : type === 'STOP'
      ? 'stop'
      : type === 'STOP_LIMIT'
      ? 'stop_limit'
      : 'market',
    time_in_force: String(transaction?.timeInForce || 'GTC').trim().toLowerCase() === 'day' ? 'day' : 'gtc',
    status: String(transaction?.reason || transaction?.type || 'FILLED'),
    filled_avg_price: transaction?.price != null ? toNum(transaction.price) : null,
    filled_qty: units,
    submitted_at: String(transaction?.time || new Date().toISOString()),
    filled_at: transaction?.price != null ? String(transaction?.time || new Date().toISOString()) : null,
    limit_price: transaction?.priceBound != null ? toNum(transaction.priceBound) : undefined,
    stop_price: undefined,
  };
}

async function getOandaOpenTrades(): Promise<OandaTradeSummary[]> {
  const accountId = await resolveOandaAccountId();
  const body = await oandaRequest<{ trades?: any[] }>(`accounts/${accountId}/openTrades`);
  const trades = Array.isArray(body.trades) ? body.trades : [];
  return trades.map((trade) => ({
    id: String(trade?.id || ''),
    instrument: String(trade?.instrument || '').trim().toUpperCase(),
    currentUnits: toNum(trade?.currentUnits),
    price: toNum(trade?.price),
    stopLossPrice: trade?.stopLossOrder?.price != null ? toNum(trade.stopLossOrder.price) : null,
    takeProfitPrice: trade?.takeProfitOrder?.price != null ? toNum(trade.takeProfitOrder.price) : null,
  })).filter((trade) => trade.id && trade.instrument);
}

function resolveSharedTradePrice(
  trades: OandaTradeSummary[],
  selector: (trade: OandaTradeSummary) => number | null | undefined,
): number | null {
  const values = trades
    .map((trade) => selector(trade))
    .filter((value): value is number => Number.isFinite(value as number));

  if (!values.length) return null;

  const first = values[0];
  const allMatch = values.every((value) => Math.abs(value - first) < 1e-8);
  return allMatch ? first : null;
}

function resolveOandaTradeProtection(
  trades: OandaTradeSummary[],
  instrument: string,
  side: 'long' | 'short',
): { stopPrice: number | null; takeProfitPrice: number | null } {
  const matchingTrades = trades.filter((trade) => {
    if (trade.instrument !== instrument) return false;
    return side === 'short' ? trade.currentUnits < 0 : trade.currentUnits > 0;
  });

  if (!matchingTrades.length) {
    return { stopPrice: null, takeProfitPrice: null };
  }

  return {
    stopPrice: resolveSharedTradePrice(matchingTrades, (trade) => trade.stopLossPrice),
    takeProfitPrice: resolveSharedTradePrice(matchingTrades, (trade) => trade.takeProfitPrice),
  };
}

async function getAlpacaAccount(): Promise<BrokerAccount> {
  const acct = await getAlpacaClient().getAccount();
  const equity = toNum(acct.equity);
  const lastEquity = toNum(acct.last_equity);
  const dayPnl = equity - lastEquity;
  const dayPnlPct = lastEquity !== 0 ? (dayPnl / lastEquity) * 100 : 0;

  return {
    id: String(acct.id || ''),
    cash: toNum(acct.cash),
    portfolio_value: toNum(acct.portfolio_value),
    buying_power: toNum(acct.buying_power),
    equity,
    last_equity: lastEquity,
    day_pnl: dayPnl,
    day_pnl_pct: dayPnlPct,
  };
}

async function getOandaAccount(): Promise<BrokerAccount> {
  const accountId = await resolveOandaAccountId();
  const body = await oandaRequest<{ account?: any }>(`accounts/${accountId}/summary`);
  const account = body.account || {};
  const equity = toNum(account.NAV);
  const dayPnl = toNum(account.resettablePL);
  const lastEquity = equity - dayPnl;

  return {
    id: String(account.id || accountId),
    cash: toNum(account.balance),
    portfolio_value: equity,
    buying_power: toNum(account.marginAvailable),
    equity,
    last_equity: lastEquity > 0 ? lastEquity : equity,
    day_pnl: dayPnl,
    day_pnl_pct: lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0,
  };
}

function mapAlpacaPosition(position: any): BrokerPosition {
  const qty = toNum(position.qty);
  return {
    symbol: fromBrokerSymbol(String(position.symbol || '')),
    qty,
    side: qty >= 0 ? 'long' : 'short',
    avg_entry_price: toNum(position.avg_entry_price),
    current_price: toNum(position.current_price),
    market_value: toNum(position.market_value),
    unrealized_pnl: toNum(position.unrealized_pl),
    unrealized_pnl_pct: toNum(position.unrealized_plpc) * 100,
  };
}

async function getAlpacaPositions(): Promise<BrokerPosition[]> {
  const positions = await getAlpacaClient().getPositions();
  return (positions || []).map((position: any) => mapAlpacaPosition(position));
}

async function getOandaPositions(): Promise<BrokerPosition[]> {
  const accountId = await resolveOandaAccountId();
  const body = await oandaRequest<{ positions?: any[] }>(`accounts/${accountId}/openPositions`);
  const positions = Array.isArray(body.positions) ? body.positions : [];
  if (!positions.length) return [];

  const instruments = positions
    .map((position) => String(position?.instrument || '').trim())
    .filter(Boolean)
    .join(',');
  const pricingBody = instruments
    ? await oandaRequest<{ prices?: any[] }>(`accounts/${accountId}/pricing`, { instruments })
    : { prices: [] };
  const priceByInstrument = new Map<string, number>();
  for (const price of pricingBody.prices || []) {
    const instrument = String(price?.instrument || '').trim();
    if (!instrument) continue;
    priceByInstrument.set(instrument, extractOandaPrice(price));
  }

  const trades = await getOandaOpenTrades();

  const mapped: BrokerPosition[] = [];
  for (const position of positions) {
    const instrument = String(position?.instrument || '').trim();
    if (!instrument) continue;
    const symbol = fromOandaInstrument(instrument);
    const currentPrice = priceByInstrument.get(instrument) || 0;
    const longUnits = Math.abs(toNum(position?.long?.units));
    const shortUnits = Math.abs(toNum(position?.short?.units));

    if (longUnits > 0) {
      const avgEntry = toNum(position?.long?.averagePrice);
      const protection = resolveOandaTradeProtection(trades, instrument, 'long');
      mapped.push({
        symbol,
        qty: longUnits,
        side: 'long',
        avg_entry_price: avgEntry,
        current_price: currentPrice || avgEntry,
        market_value: longUnits * (currentPrice || avgEntry),
        unrealized_pnl: toNum(position?.long?.unrealizedPL),
        unrealized_pnl_pct: avgEntry > 0 ? (((currentPrice || avgEntry) - avgEntry) / avgEntry) * 100 : 0,
        stop_price: protection.stopPrice,
        take_profit_price: protection.takeProfitPrice,
      });
    }

    if (shortUnits > 0) {
      const avgEntry = toNum(position?.short?.averagePrice);
      const protection = resolveOandaTradeProtection(trades, instrument, 'short');
      mapped.push({
        symbol,
        qty: shortUnits,
        side: 'short',
        avg_entry_price: avgEntry,
        current_price: currentPrice || avgEntry,
        market_value: shortUnits * (currentPrice || avgEntry),
        unrealized_pnl: toNum(position?.short?.unrealizedPL),
        unrealized_pnl_pct: avgEntry > 0 ? ((avgEntry - (currentPrice || avgEntry)) / avgEntry) * 100 : 0,
        stop_price: protection.stopPrice,
        take_profit_price: protection.takeProfitPrice,
      });
    }
  }

  return mapped;
}

export async function getProviderStatus(provider: BrokerProvider): Promise<BrokerConnectionStatus> {
  const configured = isProviderConfigured(provider);
  const status: BrokerConnectionStatus = {
    provider,
    label: getBrokerLabel(provider),
    configured,
    mode: isPaperMode(provider) ? 'paper' : 'live',
    capabilities: getBrokerCapabilities(provider),
    account: null,
    positions: [],
  };

  if (!configured) {
    return status;
  }

  try {
    if (provider === 'oanda') {
      status.account = await getOandaAccount();
      status.positions = await getOandaPositions();
    } else {
      status.account = await getAlpacaAccount();
      status.positions = await getAlpacaPositions();
    }
  } catch (err: any) {
    status.error = err?.message || String(err);
  }

  return status;
}

export async function getConnectedBrokerStatuses(): Promise<BrokerConnectionStatus[]> {
  const providers = getConnectedProviders();
  return Promise.all(providers.map((provider) => getProviderStatus(provider)));
}

export async function getAccount(provider: BrokerProvider = getExecutionBrokerProvider()): Promise<BrokerAccount> {
  if (provider === 'oanda') return getOandaAccount();
  return getAlpacaAccount();
}

export async function getPositions(provider: BrokerProvider = getExecutionBrokerProvider()): Promise<BrokerPosition[]> {
  if (provider === 'oanda') return getOandaPositions();
  return getAlpacaPositions();
}

export async function getPosition(symbol: string, provider: BrokerProvider = getExecutionBrokerProvider()): Promise<BrokerPosition | null> {
  if (provider === 'oanda') {
    const needle = fromOandaInstrument(toOandaInstrument(symbol));
    const positions = await getOandaPositions();
    return positions.find((position) => position.symbol === needle) || null;
  }

  try {
    const position = await getAlpacaClient().getPosition(toBrokerSymbol(symbol));
    return mapAlpacaPosition(position);
  } catch {
    return null;
  }
}

async function applyOandaProtection(params: {
  symbol: string;
  side?: 'long' | 'short';
  stop_price: number;
  take_profit_price: number;
}): Promise<{ provider: 'oanda'; symbol: string; side: 'long' | 'short'; trades_updated: number; trade_ids: string[] }> {
  const instrument = toOandaInstrument(params.symbol);
  const accountId = await resolveOandaAccountId();
  const trades = await getOandaOpenTrades();
  const targetSide = params.side === 'short' ? 'short' : params.side === 'long' ? 'long' : null;
  const matchingTrades = trades.filter((trade) => {
    if (trade.instrument !== instrument) return false;
    if (!targetSide) return true;
    return targetSide === 'short' ? trade.currentUnits < 0 : trade.currentUnits > 0;
  });

  if (!matchingTrades.length) {
    throw new Error(`No open OANDA trades found for ${params.symbol}${targetSide ? ` (${targetSide})` : ''}.`);
  }

  const stopPrice = formatOandaPrice(instrument, params.stop_price);
  const takeProfitPrice = formatOandaPrice(instrument, params.take_profit_price);

  for (const trade of matchingTrades) {
    await oandaRequestWithBody(
      'PUT',
      `accounts/${accountId}/trades/${trade.id}/orders`,
      {
        stopLoss: {
          timeInForce: 'GTC',
          price: stopPrice,
        },
        takeProfit: {
          timeInForce: 'GTC',
          price: takeProfitPrice,
        },
      },
    );
  }

  return {
    provider: 'oanda',
    symbol: fromOandaInstrument(instrument),
    side: targetSide || (matchingTrades[0].currentUnits < 0 ? 'short' : 'long'),
    trades_updated: matchingTrades.length,
    trade_ids: matchingTrades.map((trade) => trade.id),
  };
}

async function closeOandaPosition(symbol: string, side?: 'long' | 'short'): Promise<BrokerOrder> {
  const instrument = toOandaInstrument(symbol);
  const accountId = await resolveOandaAccountId();
  const position = await getPosition(symbol, 'oanda');
  if (!position) {
    throw new Error(`No open OANDA position found for ${symbol}.`);
  }

  const body: Record<string, string> = {};
  if (side === 'short') {
    body.shortUnits = 'ALL';
  } else if (side === 'long') {
    body.longUnits = 'ALL';
  } else if (position.side === 'short') {
    body.shortUnits = 'ALL';
  } else {
    body.longUnits = 'ALL';
  }

  const response = await oandaRequestWithBody<any>(
    'PUT',
    `accounts/${accountId}/positions/${instrument}/close`,
    body,
  );

  const fillTransaction =
    response?.longOrderFillTransaction
    || response?.shortOrderFillTransaction
    || response?.orderFillTransaction
    || response?.longOrderCreateTransaction
    || response?.shortOrderCreateTransaction;

  if (!fillTransaction) {
    throw new Error(`OANDA close position did not return a fill for ${symbol}.`);
  }

  return mapOandaOrderTransaction(fillTransaction);
}

async function closeAllOandaPositions(): Promise<void> {
  const positions = await getOandaPositions();
  for (const position of positions) {
    await closeOandaPosition(position.symbol, position.side);
  }
}

async function submitOandaOrder(order: BracketOrderRequest): Promise<BrokerOrder> {
  const instrument = toOandaInstrument(order.symbol);
  const accountId = await resolveOandaAccountId();
  const qty = Math.abs(Math.round(toNum(order.qty, 0)));
  if (qty <= 0) {
    throw new Error(`Invalid OANDA order units: ${order.qty}`);
  }

  const signedUnits = order.side === 'sell' ? -qty : qty;
  const normalizedType = String(order.type || 'market').trim().toLowerCase();
  const oandaType = normalizedType === 'limit' ? 'LIMIT' : 'MARKET';
  const payload: any = {
    order: {
      type: oandaType,
      instrument,
      units: formatOandaUnits(signedUnits),
      positionFill: 'DEFAULT',
      clientExtensions: order.client_order_id ? { id: order.client_order_id } : undefined,
      stopLossOnFill: {
        timeInForce: 'GTC',
        price: formatOandaPrice(instrument, order.stop_loss.stop_price),
      },
      takeProfitOnFill: {
        timeInForce: 'GTC',
        price: formatOandaPrice(instrument, order.take_profit.limit_price),
      },
    },
  };

  if (oandaType === 'LIMIT') {
    payload.order.price = formatOandaPrice(instrument, toNum(order.limit_price));
    payload.order.timeInForce = order.time_in_force === 'day' ? 'GFD' : 'GTC';
  } else {
    payload.order.timeInForce = 'FOK';
  }

  const response = await oandaRequestWithBody<any>(
    'POST',
    `accounts/${accountId}/orders`,
    payload,
  );

  const transaction =
    response?.orderFillTransaction
    || response?.orderCreateTransaction
    || response?.relatedTransactionIDs?.[0];

  if (typeof transaction === 'string') {
    return {
      id: transaction,
      client_order_id: order.client_order_id || '',
      symbol: fromOandaInstrument(instrument),
      qty,
      side: order.side,
      type: normalizedType === 'limit' ? 'limit' : 'market',
      time_in_force: order.time_in_force,
      status: 'submitted',
      filled_avg_price: null,
      filled_qty: 0,
      submitted_at: new Date().toISOString(),
      filled_at: null,
      limit_price: order.limit_price,
      stop_price: order.stop_loss.stop_price,
    };
  }

  return mapOandaOrderTransaction(transaction);
}

export async function closePosition(symbol: string): Promise<BrokerOrder> {
  ensureAutomatedExecutionSupported('closePosition');
  const result = await getAlpacaClient().closePosition(toBrokerSymbol(symbol));
  return mapOrder(result);
}

export async function closeAllPositions(): Promise<void> {
  ensureAutomatedExecutionSupported('closeAllPositions');
  await getAlpacaClient().closeAllPositions();
}

export async function closePositionForProvider(
  provider: BrokerProvider,
  symbol: string,
  side?: 'long' | 'short',
): Promise<BrokerOrder> {
  if (provider === 'oanda') {
    return closeOandaPosition(symbol, side);
  }
  const result = await getAlpacaClient().closePosition(toBrokerSymbol(symbol));
  return mapOrder(result);
}

export async function closeAllPositionsForProvider(provider: BrokerProvider): Promise<void> {
  if (provider === 'oanda') {
    await closeAllOandaPositions();
    return;
  }
  await getAlpacaClient().closeAllPositions();
}

export async function applyPositionProtectionForProvider(params: {
  provider: BrokerProvider;
  symbol: string;
  side?: 'long' | 'short';
  stop_price: number;
  take_profit_price: number;
}): Promise<{ provider: BrokerProvider; symbol: string; side: 'long' | 'short'; trades_updated: number; trade_ids: string[] }> {
  if (params.provider !== 'oanda') {
    throw new Error('Applying protection to an existing open position is currently implemented for OANDA only.');
  }
  return applyOandaProtection(params);
}

export async function submitOrder(order: BracketOrderRequest): Promise<BrokerOrder> {
  ensureAutomatedExecutionSupported('submitOrder');
  const brokerSymbol = toBrokerSymbol(order.symbol);
  const asset = await getAsset(brokerSymbol);
  if (!asset) {
    throw new Error(`Broker asset not found: ${brokerSymbol}`);
  }
  if (asset.tradable === false || asset.status !== 'active') {
    throw new Error(`Broker asset not tradable: ${brokerSymbol} (status: ${asset.status || 'unknown'})`);
  }

  const result = await getAlpacaClient().createOrder({
    symbol: brokerSymbol,
    qty: order.qty,
    side: order.side,
    type: order.type,
    time_in_force: order.time_in_force,
    limit_price: order.limit_price,
    order_class: 'bracket',
    take_profit: order.take_profit,
    stop_loss: order.stop_loss,
    client_order_id: order.client_order_id,
  });
  return mapOrder(result);
}

export async function submitOrderForProvider(provider: BrokerProvider, order: BracketOrderRequest): Promise<BrokerOrder> {
  if (provider === 'oanda') {
    return submitOandaOrder(order);
  }

  const brokerSymbol = toBrokerSymbol(order.symbol);
  const asset = await getAsset(brokerSymbol);
  if (!asset) {
    throw new Error(`Broker asset not found: ${brokerSymbol}`);
  }
  if (asset.tradable === false || asset.status !== 'active') {
    throw new Error(`Broker asset not tradable: ${brokerSymbol} (status: ${asset.status || 'unknown'})`);
  }

  const result = await getAlpacaClient().createOrder({
    symbol: brokerSymbol,
    qty: order.qty,
    side: order.side,
    type: order.type,
    time_in_force: order.time_in_force,
    limit_price: order.limit_price,
    order_class: 'bracket',
    take_profit: order.take_profit,
    stop_loss: order.stop_loss,
    client_order_id: order.client_order_id,
  });
  return mapOrder(result);
}

export async function submitExitOrder(order: ExitOrderRequest): Promise<BrokerOrder> {
  ensureAutomatedExecutionSupported('submitExitOrder');
  const brokerSymbol = toBrokerSymbol(order.symbol);
  const asset = await getAsset(brokerSymbol);
  if (!asset) {
    throw new Error(`Broker asset not found: ${brokerSymbol}`);
  }
  if (asset.tradable === false || asset.status !== 'active') {
    throw new Error(`Broker asset not tradable: ${brokerSymbol} (status: ${asset.status || 'unknown'})`);
  }

  const result = await getAlpacaClient().createOrder({
    symbol: brokerSymbol,
    qty: order.qty,
    side: 'sell',
    type: 'limit',
    time_in_force: order.time_in_force,
    order_class: 'oco',
    take_profit: order.take_profit,
    stop_loss: order.stop_loss,
    client_order_id: order.client_order_id,
  });
  return mapOrder(result);
}

export async function submitSimpleOrder(params: {
  symbol: string;
  qty: number;
  side: OrderSide;
  type: OrderType;
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
  stop_price?: number;
}): Promise<BrokerOrder> {
  ensureAutomatedExecutionSupported('submitSimpleOrder');
  const brokerSymbol = toBrokerSymbol(params.symbol);
  const asset = await getAsset(brokerSymbol);
  if (!asset) {
    throw new Error(`Broker asset not found: ${brokerSymbol}`);
  }
  if (asset.tradable === false || asset.status !== 'active') {
    throw new Error(`Broker asset not tradable: ${brokerSymbol} (status: ${asset.status || 'unknown'})`);
  }

  const result = await getAlpacaClient().createOrder({
    ...params,
    symbol: brokerSymbol,
  });
  return mapOrder(result);
}

export async function cancelOrder(orderId: string): Promise<void> {
  ensureAutomatedExecutionSupported('cancelOrder');
  await getAlpacaClient().cancelOrder(orderId);
}

export async function cancelAllOrders(): Promise<void> {
  ensureAutomatedExecutionSupported('cancelAllOrders');
  await getAlpacaClient().cancelAllOrders();
}

export async function getOpenOrders(): Promise<BrokerOrder[]> {
  ensureAutomatedExecutionSupported('getOpenOrders');
  const orders = await getAlpacaClient().getOrders({ status: 'open' });
  return (orders || []).map((order: any) => mapOrder(order));
}

export async function getOrder(orderId: string): Promise<BrokerOrder> {
  ensureAutomatedExecutionSupported('getOrder');
  const order = await getAlpacaClient().getOrder(orderId);
  return mapOrder(order);
}

export async function getAsset(symbol: string): Promise<BrokerAsset | null> {
  const provider = getExecutionBrokerProvider();
  if (provider !== 'alpaca') {
    return null;
  }

  const brokerSymbol = toBrokerSymbol(symbol);
  if (_assetCache.has(brokerSymbol)) {
    return _assetCache.get(brokerSymbol) || null;
  }

  try {
    const asset = await getAlpacaClient().getAsset(brokerSymbol);
    const mapped: BrokerAsset = {
      symbol: String(asset.symbol || brokerSymbol),
      status: String(asset.status || ''),
      tradable: Boolean(asset.tradable),
      class: asset.class ? String(asset.class) : undefined,
      exchange: asset.exchange ? String(asset.exchange) : undefined,
    };
    _assetCache.set(brokerSymbol, mapped);
    return mapped;
  } catch {
    _assetCache.set(brokerSymbol, null);
    return null;
  }
}

export async function isMarketOpen(): Promise<boolean> {
  ensureAutomatedExecutionSupported('isMarketOpen');
  const clock = await getAlpacaClient().getClock();
  return Boolean(clock?.is_open);
}

export async function getNextMarketOpen(): Promise<string> {
  ensureAutomatedExecutionSupported('getNextMarketOpen');
  const clock = await getAlpacaClient().getClock();
  return String(clock?.next_open || '');
}

function mapOrder(order: any): BrokerOrder {
  return {
    id: String(order.id || ''),
    client_order_id: String(order.client_order_id || ''),
    symbol: fromBrokerSymbol(String(order.symbol || '')),
    qty: toNum(order.qty),
    side: order.side as BrokerOrder['side'],
    type: order.type as BrokerOrder['type'],
    time_in_force: order.time_in_force as BrokerOrder['time_in_force'],
    status: String(order.status || ''),
    filled_avg_price: order.filled_avg_price != null ? toNum(order.filled_avg_price) : null,
    filled_qty: toNum(order.filled_qty),
    submitted_at: String(order.submitted_at || ''),
    filled_at: order.filled_at || null,
    limit_price: order.limit_price != null ? toNum(order.limit_price) : undefined,
    stop_price: order.stop_price != null ? toNum(order.stop_price) : undefined,
  };
}
