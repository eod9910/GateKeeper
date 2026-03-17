import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { BrokerProvider } from './brokerClient';
import type { EnrichedBrokerPosition, ImportBrokerProvider } from './importedBrokerPositions';

const STORE_PATH = path.join(__dirname, '..', '..', 'data', 'manual-external-positions.json');

export type ManualExternalInstrumentType = 'stock' | 'forex' | 'futures' | 'crypto' | 'options';
export type ManualExternalProvider = ImportBrokerProvider;

export interface ManualExternalPositionRecord {
  id: string;
  provider: ManualExternalProvider;
  symbol: string;
  display_symbol?: string;
  instrument_type: ManualExternalInstrumentType;
  side: 'long' | 'short';
  qty: number;
  avg_entry_price: number;
  current_price: number;
  stop_price?: number | null;
  take_profit_price?: number | null;
  contract_multiplier?: number | null;
  option_type?: string;
  expiration_date?: string;
  strike_price?: number | null;
  external_position_id?: string;
  strategy_version_id?: string;
  strategy_name?: string;
  import_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ManualExternalPositionInput {
  provider?: string;
  symbol?: string;
  display_symbol?: string;
  instrument_type?: string;
  side?: string;
  qty?: number;
  avg_entry_price?: number;
  current_price?: number;
  stop_price?: number | null;
  take_profit_price?: number | null;
  contract_multiplier?: number | null;
  option_type?: string;
  expiration_date?: string;
  strike_price?: number | null;
  external_position_id?: string;
  strategy_version_id?: string;
  strategy_name?: string;
  import_reason?: string;
}

function toNum(value: any): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeProvider(value: any): ManualExternalProvider {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'oanda' || provider === 'robinhood') return provider;
  return 'alpaca';
}

function normalizeInstrumentType(value: any): ManualExternalInstrumentType {
  const instrumentType = String(value || '').trim().toLowerCase();
  if (instrumentType === 'forex') return 'forex';
  if (instrumentType === 'futures') return 'futures';
  if (instrumentType === 'crypto') return 'crypto';
  if (instrumentType === 'options' || instrumentType === 'option') return 'options';
  return 'stock';
}

function normalizeSide(value: any): 'long' | 'short' {
  return String(value || '').trim().toLowerCase() === 'short' ? 'short' : 'long';
}

function normalizeNullablePositive(value: any): number | null {
  const num = toNum(value);
  return num != null && num > 0 ? num : null;
}

function isDirectionalLevelValid(level: number | null, entry: number, side: 'long' | 'short', kind: 'stop' | 'target'): boolean {
  if (!(level != null && level > 0 && entry > 0)) return false;
  if (side === 'short') {
    return kind === 'stop' ? level > entry : level < entry;
  }
  return kind === 'stop' ? level < entry : level > entry;
}

function readStore(): ManualExternalPositionRecord[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(records: ManualExternalPositionRecord[]): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2), 'utf-8');
}

function validateRecord(input: ManualExternalPositionInput, current?: ManualExternalPositionRecord): ManualExternalPositionRecord {
  const now = new Date().toISOString();
  const provider = normalizeProvider(input.provider ?? current?.provider);
  const symbol = String(input.symbol ?? current?.symbol ?? '').trim().toUpperCase();
  const displaySymbol = String(input.display_symbol ?? current?.display_symbol ?? '').trim() || undefined;
  const instrumentType = normalizeInstrumentType(input.instrument_type ?? current?.instrument_type);
  const side = normalizeSide(input.side ?? current?.side);
  const qty = Math.abs(toNum(input.qty ?? current?.qty) || 0);
  const avgEntryPrice = toNum(input.avg_entry_price ?? current?.avg_entry_price) || 0;
  const currentPrice = toNum(input.current_price ?? current?.current_price) || avgEntryPrice;
  const stopPrice = normalizeNullablePositive(input.stop_price ?? current?.stop_price);
  const takeProfitPrice = normalizeNullablePositive(input.take_profit_price ?? current?.take_profit_price);
  const contractMultiplier = normalizeNullablePositive(input.contract_multiplier ?? current?.contract_multiplier);
  const optionType = String(input.option_type ?? current?.option_type ?? '').trim().toLowerCase() || undefined;
  const expirationDate = String(input.expiration_date ?? current?.expiration_date ?? '').trim() || undefined;
  const strikePrice = normalizeNullablePositive(input.strike_price ?? current?.strike_price);
  const externalPositionId = String(input.external_position_id ?? current?.external_position_id ?? '').trim() || undefined;
  const strategyVersionId = String(input.strategy_version_id ?? current?.strategy_version_id ?? '').trim() || undefined;
  const strategyName = String(input.strategy_name ?? current?.strategy_name ?? '').trim() || undefined;
  const importReason = String(input.import_reason ?? current?.import_reason ?? '').trim() || undefined;

  if (!symbol) {
    throw new Error('symbol is required');
  }
  if (!(qty > 0)) {
    throw new Error('qty must be greater than 0');
  }
  if (!(avgEntryPrice > 0)) {
    throw new Error('avg_entry_price must be greater than 0');
  }
  if (!(currentPrice > 0)) {
    throw new Error('current_price must be greater than 0');
  }
  if (stopPrice != null && !isDirectionalLevelValid(stopPrice, avgEntryPrice, side, 'stop')) {
    throw new Error('stop_price must sit on the stop side of entry for this position');
  }
  if (takeProfitPrice != null && !isDirectionalLevelValid(takeProfitPrice, avgEntryPrice, side, 'target')) {
    throw new Error('take_profit_price must sit on the profit side of entry for this position');
  }

  return {
    id: current?.id || crypto.randomUUID(),
    provider,
    symbol,
    display_symbol: displaySymbol,
    instrument_type: instrumentType,
    side,
    qty,
    avg_entry_price: avgEntryPrice,
    current_price: currentPrice,
    stop_price: stopPrice,
    take_profit_price: takeProfitPrice,
    contract_multiplier: contractMultiplier,
    option_type: optionType,
    expiration_date: expirationDate,
    strike_price: strikePrice,
    external_position_id: externalPositionId,
    strategy_version_id: strategyVersionId,
    strategy_name: strategyName,
    import_reason: importReason,
    created_at: current?.created_at || now,
    updated_at: now,
  };
}

function getPriceMultiplier(record: ManualExternalPositionRecord): number {
  if (record.instrument_type === 'options') {
    return Math.max(1, toNum(record.contract_multiplier) || 100);
  }
  if (record.instrument_type === 'futures') {
    return Math.max(1, toNum(record.contract_multiplier) || 1);
  }
  return 1;
}

function providerLabel(provider: ManualExternalProvider): string {
  if (provider === 'oanda') return 'OANDA';
  if (provider === 'robinhood') return 'Robinhood';
  return 'Alpaca';
}

function buildDisplaySymbol(record: ManualExternalPositionRecord): string {
  if (record.display_symbol) return record.display_symbol;
  if (record.instrument_type !== 'options') return record.symbol;
  const parts = [
    record.symbol,
    record.expiration_date || '',
    record.strike_price != null ? String(record.strike_price) : '',
    record.option_type ? String(record.option_type).toUpperCase() : '',
  ].filter(Boolean);
  return parts.join(' ') || record.symbol;
}

export function listManualExternalPositionRecords(): ManualExternalPositionRecord[] {
  return readStore().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function getManualExternalPositionRecord(id: string): ManualExternalPositionRecord | null {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  return listManualExternalPositionRecords().find((record) => record.id === normalizedId) || null;
}

export function createManualExternalPosition(input: ManualExternalPositionInput): ManualExternalPositionRecord {
  const records = readStore();
  const record = validateRecord(input);
  records.push(record);
  writeStore(records);
  return record;
}

export function updateManualExternalPosition(id: string, input: ManualExternalPositionInput): ManualExternalPositionRecord {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    throw new Error('id is required');
  }
  const records = readStore();
  const index = records.findIndex((record) => record.id === normalizedId);
  if (index < 0) {
    throw new Error('external position not found');
  }
  const next = validateRecord(input, records[index]);
  records[index] = next;
  writeStore(records);
  return next;
}

export function deleteManualExternalPosition(id: string): boolean {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;
  const records = readStore();
  const next = records.filter((record) => record.id !== normalizedId);
  if (next.length === records.length) return false;
  writeStore(next);
  return true;
}

export function mapManualExternalPositionRecord(record: ManualExternalPositionRecord): EnrichedBrokerPosition {
  const sideMultiplier = record.side === 'short' ? -1 : 1;
  const qty = Math.abs(toNum(record.qty) || 0);
  const entry = toNum(record.avg_entry_price) || 0;
  const current = toNum(record.current_price) || entry;
  const multiplier = getPriceMultiplier(record);
  const entryValue = entry * qty * multiplier;
  const unrealizedPnl = (current - entry) * qty * multiplier * sideMultiplier;
  const unrealizedPct = entryValue > 0 ? (unrealizedPnl / entryValue) * 100 : 0;
  const marketValue = Math.abs(current * qty * multiplier);
  const defaultReason = `Manually adopted from ${providerLabel(record.provider)} into Execution as an external ${record.instrument_type} position.`;

  return {
    symbol: record.symbol,
    qty,
    side: record.side,
    avg_entry_price: entry,
    current_price: current,
    market_value: marketValue,
    unrealized_pnl: unrealizedPnl,
    unrealized_pnl_pct: unrealizedPct,
    stop_price: record.stop_price ?? null,
    take_profit_price: record.take_profit_price ?? null,
    instrument_type: record.instrument_type,
    display_symbol: buildDisplaySymbol(record),
    contract_multiplier: record.contract_multiplier ?? undefined,
    option_type: record.option_type ?? undefined,
    expiration_date: record.expiration_date ?? undefined,
    strike_price: record.strike_price ?? undefined,
    external_position_id: record.external_position_id || `manual-external:${record.id}`,
    strategy_version_id: record.strategy_version_id,
    strategy_name: record.strategy_name,
    import_reason: record.import_reason || defaultReason,
    manual_external_id: record.id,
    manual_external: true,
    created_at: record.created_at,
    updated_at: record.updated_at,
    opened_at: record.created_at,
  } as EnrichedBrokerPosition;
}

export function listManualExternalPositions(): EnrichedBrokerPosition[] {
  return listManualExternalPositionRecords().map(mapManualExternalPositionRecord);
}

export function groupManualExternalPositionsByProvider(): Map<ManualExternalProvider, EnrichedBrokerPosition[]> {
  const grouped = new Map<ManualExternalProvider, EnrichedBrokerPosition[]>();
  for (const record of listManualExternalPositionRecords()) {
    const mapped = mapManualExternalPositionRecord(record);
    const list = grouped.get(record.provider) || [];
    list.push(mapped);
    grouped.set(record.provider, list);
  }
  return grouped;
}

export function providerSupportsManualExternal(provider: string): provider is ManualExternalProvider {
  const normalized = normalizeProvider(provider);
  return normalized === 'alpaca' || normalized === 'oanda' || normalized === 'robinhood';
}

export function getManualExternalProviderCapabilities(provider: ManualExternalProvider): {
  account_read: boolean;
  positions_read: boolean;
  automated_execution: boolean;
} {
  if (provider === 'robinhood') {
    return {
      account_read: true,
      positions_read: true,
      automated_execution: false,
    };
  }
  const normalized = provider as BrokerProvider;
  return normalized === 'oanda'
    ? { account_read: true, positions_read: true, automated_execution: false }
    : { account_read: true, positions_read: true, automated_execution: true };
}
