import * as storage from './storageService';
import type { BrokerProvider } from './brokerClient';
import type { BridgeState } from './positionManager';
import type { EnrichedBrokerConnectionStatus, EnrichedBrokerPosition } from './importedBrokerPositions';
import {
  createManualExternalPosition,
  listManualExternalPositionRecords,
  updateManualExternalPosition,
  type ManualExternalInstrumentType,
  type ManualExternalPositionInput,
  type ManualExternalPositionRecord,
  type ManualExternalProvider,
} from './manualExternalPositions';

type SyncBridgeState = Pick<BridgeState, 'mode' | 'managed_positions'>;

function safeNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProvider(value: any): ManualExternalProvider {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'oanda' || provider === 'robinhood') return provider;
  return 'alpaca';
}

function normalizeInstrumentType(value: any, provider?: string, symbol?: string): ManualExternalInstrumentType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'forex') return 'forex';
  if (normalized === 'futures') return 'futures';
  if (normalized === 'crypto') return 'crypto';
  if (normalized === 'options' || normalized === 'option') return 'options';
  if (normalized === 'stock') return 'stock';
  const resolvedProvider = String(provider || '').trim().toLowerCase();
  const resolvedSymbol = String(symbol || '').trim().toUpperCase();
  if (resolvedProvider === 'oanda' || resolvedSymbol.endsWith('=X')) return 'forex';
  if (resolvedSymbol.endsWith('=F')) return 'futures';
  if (resolvedSymbol.endsWith('-USD')) return 'crypto';
  return 'stock';
}

function normalizeSide(value: any): 'long' | 'short' {
  return String(value || '').trim().toLowerCase() === 'short' ? 'short' : 'long';
}

function bridgeTradeId(seed: string): string {
  const input = String(seed || 'bridge-position');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return String(-(Math.abs(hash || 1)));
}

function externalBrokerPositionKey(provider: string, pos: any): string {
  const explicit = String((pos && (pos.external_position_id || pos.option_id || pos.position_id || pos.id)) || '').trim();
  if (explicit) return explicit;
  const instrumentType = normalizeInstrumentType(pos?.instrument_type, provider, pos?.symbol);
  const symbol = String(pos?.symbol || '').trim().toUpperCase();
  const side = normalizeSide(pos?.side);
  const strike = instrumentType === 'options' ? safeNumber(pos?.strike_price, 0) : 0;
  const expiry = instrumentType === 'options' ? String(pos?.expiration_date || '').trim() : '';
  const optionType = instrumentType === 'options' ? String(pos?.option_type || '').trim().toLowerCase() : '';
  return [provider, symbol, side, instrumentType, strike > 0 ? strike : '', expiry, optionType].filter(Boolean).join(':');
}

function normalizeImportedBrokerSize(pos: any, instrumentType: string): { size: number; lotSize?: string; brokerUnits: number } {
  const qty = Math.abs(safeNumber(pos?.qty, 0));
  if (instrumentType === 'forex') {
    return { size: qty / 1000, lotSize: 'micro', brokerUnits: qty };
  }
  return { size: qty, brokerUnits: qty };
}

function buildManagedBridgeTrade(pos: any, bridgeState: SyncBridgeState): any {
  const entry = safeNumber(pos?.entry_price, 0);
  const stop = safeNumber(pos?.stop_price, 0);
  const target = safeNumber(pos?.take_profit_price, 0);
  const qty = Math.abs(safeNumber(pos?.qty, 0));
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const strategyVersionId = String(pos?.strategy_version_id || '').trim();
  const mode = String(bridgeState?.mode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
  const entryTime = String(pos?.entry_time || new Date().toISOString());
  const instrumentType = normalizeInstrumentType(pos?.signal_data?.asset_class, undefined, pos?.symbol);
  const idSeed = `${pos?.entry_order_id || pos?.symbol}:${entryTime}:${strategyVersionId}`;

  return {
    id: bridgeTradeId(idSeed),
    symbol: String(pos?.symbol || '').trim().toUpperCase(),
    status: 'open',
    direction: normalizeSide(pos?.side) === 'short' ? -1 : 1,
    instrumentType,
    plannedEntry: entry,
    actualEntry: entry,
    plannedStop: stop,
    currentStop: stop,
    plannedTarget: target,
    plannedShares: qty,
    actualShares: qty,
    plannedRR: (risk > 0 && reward > 0) ? (reward / risk).toFixed(2) : '--',
    plannedRiskAmount: (risk * qty).toFixed(2),
    executionTime: entryTime,
    createdAt: entryTime,
    savedAt: entryTime,
    displayDate: new Date(entryTime).toLocaleDateString(),
    patternType: 'Execution Desk',
    strategy: 'execution',
    strategy_version_id: strategyVersionId || null,
    verdict: null,
    preTradePlan: `Managed by Execution Desk (${mode.toUpperCase()} mode). Position Book mirrors the position but does not control it.`,
    chartImage: null,
    broker_backed: true,
    _bridgeManaged: true,
    _bridgeMode: mode,
    _entryOrderId: pos?.entry_order_id || null,
    _signalData: pos?.signal_data || {},
    _syncSource: 'execution_status',
  };
}

function buildImportedBrokerTrade(pos: EnrichedBrokerPosition, providerEntry: EnrichedBrokerConnectionStatus): any {
  const posAny = pos as any;
  const provider = normalizeProvider(providerEntry?.provider);
  const providerLabel = String(providerEntry?.label || provider).trim() || provider.toUpperCase();
  const mode = String(providerEntry?.mode || 'live').trim().toLowerCase() === 'paper' ? 'paper' : 'live';
  const instrumentType = normalizeInstrumentType(pos?.instrument_type, provider, pos?.symbol);
  const sizeMeta = normalizeImportedBrokerSize(pos, instrumentType);
  const isOptions = instrumentType === 'options';
  const entry = safeNumber(pos?.avg_entry_price, 0);
  const current = safeNumber(pos?.current_price, 0);
  const stop = pos?.suggested_stop_price != null ? safeNumber(pos?.suggested_stop_price, 0) : null;
  const target = pos?.suggested_take_profit_price != null ? safeNumber(pos?.suggested_take_profit_price, 0) : null;
  const explicitStrategyVersionId = String(pos?.strategy_version_id || '').trim();
  const strategyName = String(pos?.strategy_name || explicitStrategyVersionId || 'Broker (unmanaged)').trim();
  const positionKey = externalBrokerPositionKey(provider, pos);
  const idSeed = positionKey || `${provider}:${pos?.symbol}:${entry}:${explicitStrategyVersionId || 'broker-unmanaged'}`;
  const risk = stop != null ? Math.abs(entry - stop) : null;
  const reward = target != null ? Math.abs(target - entry) : null;
  const importedAt = String(posAny?.opened_at || posAny?.created_at || posAny?.updated_at || posAny?.raw?.opened_at || posAny?.raw?.created_at || posAny?.raw?.updated_at || new Date().toISOString());
  const planSummary = String(pos?.import_reason || `${providerLabel} position imported into Position Book as ${strategyName}.`).trim();
  const optionStrike = safeNumber(pos?.strike_price, 0);
  const optionExpiry = String(pos?.expiration_date || '').trim();
  const optionType = String(pos?.option_type || 'call').trim().toLowerCase();
  const contractMultiplier = Math.max(1, safeNumber(pos?.contract_multiplier, 100));
  const futuresMultiplier = Math.max(1, safeNumber(pos?.contract_multiplier, 1));
  const optionPremiumRisk = entry > 0 && sizeMeta.brokerUnits > 0 ? entry * contractMultiplier * sizeMeta.brokerUnits : 0;
  const futuresRiskAmount = risk != null && risk > 0 && sizeMeta.brokerUnits > 0 ? risk * sizeMeta.brokerUnits * futuresMultiplier : 0;
  const plannedRiskAmount = isOptions
    ? String(optionPremiumRisk.toFixed(2))
    : (instrumentType === 'futures'
      ? String(futuresRiskAmount.toFixed(2))
      : ((risk != null && risk > 0 && sizeMeta.brokerUnits > 0) ? String((risk * sizeMeta.brokerUnits).toFixed(2)) : '0'));

  return {
    id: bridgeTradeId(idSeed),
    symbol: String(pos?.symbol || '').trim().toUpperCase(),
    status: 'open',
    direction: normalizeSide(pos?.side) === 'short' ? -1 : 1,
    instrumentType,
    plannedEntry: entry,
    actualEntry: entry,
    plannedStop: stop,
    currentStop: stop,
    plannedTarget: target,
    plannedShares: sizeMeta.size,
    actualShares: sizeMeta.size,
    lotSize: sizeMeta.lotSize || undefined,
    plannedRR: (risk != null && reward != null && risk > 0 && reward > 0) ? (reward / risk).toFixed(2) : '--',
    plannedRiskAmount,
    executionTime: importedAt,
    createdAt: importedAt,
    savedAt: importedAt,
    displayDate: new Date(importedAt).toLocaleDateString(),
    patternType: strategyName,
    strategy: 'broker_import',
    strategy_version_id: explicitStrategyVersionId || null,
    verdict: null,
    preTradePlan: `${planSummary} Manage execution at the broker / Execution Desk, not from Position Book.`,
    chartImage: null,
    optionPrice: isOptions ? entry : undefined,
    optionCurrentPremium: isOptions && current > 0 ? current : undefined,
    optionStrike: isOptions && optionStrike > 0 ? optionStrike : undefined,
    optionExpiry: isOptions && optionExpiry ? optionExpiry : undefined,
    optionType: isOptions ? optionType : undefined,
    contractMultiplier: (isOptions || instrumentType === 'futures')
      ? (instrumentType === 'futures' ? futuresMultiplier : contractMultiplier)
      : undefined,
    broker_backed: true,
    _bridgeManaged: true,
    _bridgeMode: mode,
    _bridgeLabel: `${providerLabel} ${mode.toUpperCase()}`,
    _externalProvider: provider,
    _externalPositionKey: positionKey,
    _externalBrokerPosition: true,
    _brokerUnits: sizeMeta.brokerUnits,
    _syncSource: 'broker_sync',
  };
}

function mergeMirrorTrade(existing: any | null, next: any): any {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    id: next.id,
    createdAt: existing.createdAt || next.createdAt,
    savedAt: existing.savedAt || next.savedAt,
    strategy_version_id: next.strategy_version_id || existing.strategy_version_id || null,
    patternType: next.patternType || existing.patternType || 'Broker (unmanaged)',
    tags: Array.isArray(existing.tags) ? existing.tags : (Array.isArray(next.tags) ? next.tags : []),
    drawings: Array.isArray(existing.drawings) ? existing.drawings : (Array.isArray(next.drawings) ? next.drawings : []),
    postTradeReview: existing.postTradeReview || next.postTradeReview || '',
    lessons: existing.lessons || next.lessons || '',
    updatedAt: new Date().toISOString(),
  };
}

function manualExternalIdentity(input: {
  provider: string;
  symbol: string;
  side: 'long' | 'short';
  instrument_type: string;
  external_position_id?: string | null;
  strike_price?: number | null;
  expiration_date?: string | null;
  option_type?: string | null;
}): string {
  const provider = normalizeProvider(input.provider);
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = normalizeSide(input.side);
  const instrumentType = normalizeInstrumentType(input.instrument_type, provider, symbol);
  const explicit = String(input.external_position_id || '').trim();
  if (explicit) return `id:${provider}:${explicit}`;
  const strike = instrumentType === 'options' ? safeNumber(input.strike_price, 0) : 0;
  const expiry = instrumentType === 'options' ? String(input.expiration_date || '').trim() : '';
  const optionType = instrumentType === 'options' ? String(input.option_type || '').trim().toLowerCase() : '';
  return `key:${[provider, symbol, side, instrumentType, strike > 0 ? strike : '', expiry, optionType].filter(Boolean).join(':')}`;
}

function manualExternalIdentityFromRecord(record: ManualExternalPositionRecord): string {
  return manualExternalIdentity({
    provider: record.provider,
    symbol: record.symbol,
    side: record.side,
    instrument_type: record.instrument_type,
    external_position_id: record.external_position_id || null,
    strike_price: record.strike_price,
    expiration_date: record.expiration_date,
    option_type: record.option_type,
  });
}

function toManualExternalInputFromTrade(trade: any, fallbackProvider: BrokerProvider): ManualExternalPositionInput | null {
  const explicitProvider = String(trade?._externalProvider || trade?.broker_provider || trade?.execution_provider || '').trim().toLowerCase();
  const isBrokerBacked = Boolean(trade?.broker_backed || trade?._externalBrokerPosition || explicitProvider);
  if (!isBrokerBacked) return null;
  const provider = normalizeProvider(explicitProvider || fallbackProvider);
  const symbol = String(trade?.symbol || '').trim().toUpperCase();
  const instrumentType = normalizeInstrumentType(trade?.instrumentType, provider, symbol);
  const side = normalizeSide(trade?.direction === -1 ? 'short' : (trade?.side || 'long'));
  const qty = Math.abs(safeNumber(trade?.actualShares ?? trade?.plannedShares, 0));
  const entry = safeNumber(trade?.actualEntry ?? trade?.plannedEntry, 0);
  const current = safeNumber(trade?.currentPrice ?? trade?.actualEntry ?? trade?.plannedEntry, entry);
  if (!symbol || !(qty > 0) || !(entry > 0)) return null;
  return {
    provider,
    symbol,
    instrument_type: instrumentType,
    side,
    qty,
    avg_entry_price: entry,
    current_price: current > 0 ? current : entry,
    stop_price: safeNumber(trade?.currentStop ?? trade?.plannedStop, 0) > 0 ? safeNumber(trade?.currentStop ?? trade?.plannedStop, 0) : undefined,
    take_profit_price: safeNumber(trade?.plannedTarget, 0) > 0 ? safeNumber(trade?.plannedTarget, 0) : undefined,
    contract_multiplier: safeNumber(trade?.contractMultiplier, 0) > 0 ? safeNumber(trade?.contractMultiplier, 0) : undefined,
    option_type: trade?.optionType || undefined,
    expiration_date: trade?.optionExpiry || undefined,
    strike_price: safeNumber(trade?.optionStrike, 0) > 0 ? safeNumber(trade?.optionStrike, 0) : undefined,
    external_position_id: String(trade?._externalPositionKey || trade?.external_position_id || '').trim() || undefined,
    strategy_version_id: String(trade?.strategy_version_id || '').trim() || undefined,
    strategy_name: String(trade?.patternType || '').trim() || undefined,
    import_reason: String(trade?.import_reason || trade?.preTradePlan || `Adopted from Position Book into Execution Desk as a broker-backed ${instrumentType} position.`).trim(),
  };
}

function collectLiveBrokerKeys(executionBrokerProvider: BrokerProvider, bridgeState: SyncBridgeState, connectedBrokers: EnrichedBrokerConnectionStatus[]): Set<string> {
  const keys = new Set<string>();
  for (const pos of Array.isArray(bridgeState?.managed_positions) ? bridgeState.managed_positions : []) {
    const provider = normalizeProvider(executionBrokerProvider);
    const symbol = String(pos?.symbol || '').trim().toUpperCase();
    const side = normalizeSide(pos?.side);
    if (symbol) keys.add(`managed:${provider}:${symbol}:${side}`);
  }
  for (const entry of Array.isArray(connectedBrokers) ? connectedBrokers : []) {
    const provider = normalizeProvider(entry.provider);
    for (const pos of Array.isArray(entry.positions) ? entry.positions : []) {
      const symbol = String(pos?.symbol || '').trim().toUpperCase();
      const side = normalizeSide(pos?.side);
      const instrumentType = normalizeInstrumentType(pos?.instrument_type, provider, symbol);
      const identity = manualExternalIdentity({
        provider,
        symbol,
        side,
        instrument_type: instrumentType,
        external_position_id: externalBrokerPositionKey(provider, pos),
        strike_price: safeNumber(pos?.strike_price, 0) || null,
        expiration_date: pos?.expiration_date || null,
        option_type: pos?.option_type || null,
      });
      if (symbol) {
        keys.add(`managed:${provider}:${symbol}:${side}`);
        keys.add(identity);
      }
    }
  }
  return keys;
}

export async function syncExecutionPositionsToPositionBook(params: {
  executionBrokerProvider: BrokerProvider;
  bridgeState: SyncBridgeState;
  connectedBrokers: EnrichedBrokerConnectionStatus[];
}): Promise<{ created: number; updated: number }> {
  const { executionBrokerProvider, bridgeState, connectedBrokers } = params;
  const existingTrades = await storage.getAllTrades();
  const existingById = new Map(existingTrades.map((trade) => [String(trade?.id || ''), trade]));
  const managedKeys = new Set(
    (Array.isArray(bridgeState?.managed_positions) ? bridgeState.managed_positions : []).map((pos: any) => {
      const symbol = String(pos?.symbol || '').trim().toUpperCase();
      const side = normalizeSide(pos?.side);
      return `${normalizeProvider(executionBrokerProvider)}:${symbol}:${side}`;
    }),
  );
  const snapshotTrades: any[] = [];

  for (const pos of Array.isArray(bridgeState?.managed_positions) ? bridgeState.managed_positions : []) {
    snapshotTrades.push(buildManagedBridgeTrade(pos, bridgeState));
  }

  for (const entry of Array.isArray(connectedBrokers) ? connectedBrokers : []) {
    const provider = normalizeProvider(entry.provider);
    for (const pos of Array.isArray(entry.positions) ? entry.positions : []) {
      const symbol = String(pos?.symbol || '').trim().toUpperCase();
      const side = normalizeSide(pos?.side);
      if (managedKeys.has(`${provider}:${symbol}:${side}`)) continue;
      snapshotTrades.push(buildImportedBrokerTrade(pos, entry));
    }
  }

  let created = 0;
  let updated = 0;
  for (const trade of snapshotTrades) {
    const id = String(trade.id || '').trim();
    if (!id) continue;
    const existing = existingById.get(id) || null;
    const merged = mergeMirrorTrade(existing, trade);
    if (existing) {
      await storage.updateTrade(id, merged);
      updated += 1;
    } else {
      await storage.saveTrade(merged);
      created += 1;
    }
  }
  return { created, updated };
}

export async function syncPositionBookToExecutionMirror(params: {
  executionBrokerProvider: BrokerProvider;
  bridgeState: SyncBridgeState;
  connectedBrokers: EnrichedBrokerConnectionStatus[];
}): Promise<{ created: number; updated: number }> {
  const { executionBrokerProvider, bridgeState, connectedBrokers } = params;
  const liveKeys = collectLiveBrokerKeys(executionBrokerProvider, bridgeState, connectedBrokers);
  const manualRecords = listManualExternalPositionRecords();
  const manualByIdentity = new Map(manualRecords.map((record) => [manualExternalIdentityFromRecord(record), record]));
  const trades = await storage.getAllTrades();
  let created = 0;
  let updated = 0;

  for (const trade of trades) {
    if (!trade || trade.status !== 'open') continue;
    if (trade._bridgeManaged) continue;
    const input = toManualExternalInputFromTrade(trade, executionBrokerProvider);
    if (!input) continue;
    const identity = manualExternalIdentity({
      provider: input.provider || executionBrokerProvider,
      symbol: input.symbol || '',
      side: input.side as 'long' | 'short',
      instrument_type: input.instrument_type || 'stock',
      external_position_id: input.external_position_id || null,
      strike_price: safeNumber(input.strike_price, 0) || null,
      expiration_date: input.expiration_date || null,
      option_type: input.option_type || null,
    });
    const managedKey = `managed:${normalizeProvider(input.provider || executionBrokerProvider)}:${String(input.symbol || '').trim().toUpperCase()}:${normalizeSide(input.side)}`;
    if (liveKeys.has(managedKey)) continue;
    if (liveKeys.has(identity)) continue;
    const existing = manualByIdentity.get(identity) || null;
    if (existing) {
      const next = updateManualExternalPosition(existing.id, input);
      manualByIdentity.set(identity, next);
      updated += 1;
      continue;
    }
    const next = createManualExternalPosition(input);
    manualByIdentity.set(identity, next);
    created += 1;
  }

  return { created, updated };
}
