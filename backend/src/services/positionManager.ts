import * as fs from 'fs';
import * as path from 'path';
import * as broker from './brokerClient';
import * as logger from './executionLogger';
import { readJsonDocument, writeJsonDocument } from './appStateDb';

const LEGACY_STATE_FILE = path.join(__dirname, '../../data/execution-state.json');
const EXECUTION_STATE_NAMESPACE = 'execution_bridge_state';
const EXECUTION_STATE_KEY = 'default';

export interface ManagedPosition {
  symbol: string;
  strategy_version_id: string;
  side: 'long' | 'short';
  qty: number;
  entry_price: number;
  stop_price: number;
  take_profit_price: number;
  manual_exit_override?: boolean;
  manual_stop_price?: number;
  manual_take_profit_price?: number;
  entry_order_id: string;
  entry_time: string;
  signal_data: Record<string, any>;
}

export interface LastSignalEntry {
  symbol: string;
  entry_price: number;
  stop_price: number;
  take_profit_price: number;
  score: number;
  signal_bar_date: string;
}

export interface BridgeState {
  enabled: boolean;
  mode: 'paper' | 'live';
  kill_switch_active: boolean;
  kill_switch_reason?: string;
  managed_positions: ManagedPosition[];
  last_scan_time?: string;
  last_scan_signals: number;
  last_scan_signal_list: LastSignalEntry[];
  total_trades_placed: number;
  total_trades_closed: number;
  session_start?: string;
}

const DEFAULT_STATE: BridgeState = {
  enabled: false,
  mode: 'paper',
  kill_switch_active: false,
  managed_positions: [],
  last_scan_signals: 0,
  last_scan_signal_list: [],
  total_trades_placed: 0,
  total_trades_closed: 0,
};

function normalizeState(raw: any): BridgeState {
  const base = { ...DEFAULT_STATE };
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    mode: raw.mode === 'live' ? 'live' : 'paper',
    kill_switch_active: Boolean(raw.kill_switch_active),
    kill_switch_reason: typeof raw.kill_switch_reason === 'string' ? raw.kill_switch_reason : undefined,
    managed_positions: Array.isArray(raw.managed_positions) ? raw.managed_positions : [],
    last_scan_time: typeof raw.last_scan_time === 'string' ? raw.last_scan_time : undefined,
    last_scan_signals: Number.isFinite(Number(raw.last_scan_signals)) ? Number(raw.last_scan_signals) : 0,
    last_scan_signal_list: Array.isArray(raw.last_scan_signal_list) ? raw.last_scan_signal_list : [],
    total_trades_placed: Number.isFinite(Number(raw.total_trades_placed)) ? Number(raw.total_trades_placed) : 0,
    total_trades_closed: Number.isFinite(Number(raw.total_trades_closed)) ? Number(raw.total_trades_closed) : 0,
    session_start: typeof raw.session_start === 'string' ? raw.session_start : undefined,
  };
}

export function loadState(): BridgeState {
  const dbState = readJsonDocument<BridgeState>(
    EXECUTION_STATE_NAMESPACE,
    EXECUTION_STATE_KEY,
    normalizeState,
  );
  if (dbState) return dbState;

  if (!fs.existsSync(LEGACY_STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    const parsed = normalizeState(JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8')));
    writeJsonDocument(EXECUTION_STATE_NAMESPACE, EXECUTION_STATE_KEY, parsed);
    return parsed;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: BridgeState): void {
  writeJsonDocument(EXECUTION_STATE_NAMESPACE, EXECUTION_STATE_KEY, normalizeState(state));
}

export function getOpenPositionCount(state: BridgeState): number {
  return state.managed_positions.length;
}

export function hasPositionForSymbol(state: BridgeState, symbol: string): boolean {
  const needle = symbol.trim().toUpperCase();
  return state.managed_positions.some((p) => p.symbol.trim().toUpperCase() === needle);
}

/**
 * Computes the current portfolio heat as a fraction (0–1) of account equity.
 * Heat = sum of (entry_price - stop_price) × qty for all managed long positions.
 * If equity is unknown or zero, returns 0.
 */
export function computePortfolioHeat(state: BridgeState, accountEquity: number): number {
  if (!Number.isFinite(accountEquity) || accountEquity <= 0) return 0;
  let totalRiskDollars = 0;
  for (const pos of state.managed_positions) {
    const stopPrice = pos.manual_exit_override && pos.manual_stop_price != null
      ? pos.manual_stop_price
      : pos.stop_price;
    const riskPerShare = Math.max(0, Number(pos.entry_price) - Number(stopPrice));
    totalRiskDollars += riskPerShare * Math.max(0, Number(pos.qty));
  }
  return totalRiskDollars / accountEquity;
}

/**
 * Returns true if a new position can be opened without breaching the max portfolio heat.
 * newPositionRiskPct is the per-trade risk fraction (e.g. 0.05 = 5%).
 */
export function canOpenNewPosition(
  state: BridgeState,
  maxPortfolioHeatPct: number,
  newPositionRiskPct: number,
  accountEquity: number,
): boolean {
  if (state.kill_switch_active) return false;
  if (!state.enabled) return false;
  const currentHeat = computePortfolioHeat(state, accountEquity);
  return (currentHeat + newPositionRiskPct) <= maxPortfolioHeatPct;
}

export async function calculatePositionSize(
  stopDistanceDollars: number,
  entryPrice: number,
  riskPct = 0.01,
): Promise<number> {
  if (!Number.isFinite(stopDistanceDollars) || stopDistanceDollars <= 0) {
    throw new Error(`Invalid stop distance: ${stopDistanceDollars}`);
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`Invalid entry price: ${entryPrice}`);
  }
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 1) {
    throw new Error(`Invalid risk percent: ${riskPct}`);
  }

  const account = await broker.getAccount();
  const riskDollars = Math.max(0, account.equity * riskPct);
  const sharesByRisk = Math.floor(riskDollars / stopDistanceDollars);
  const sharesByBuyingPower = Math.floor(Math.max(0, account.buying_power) / entryPrice);
  const shares = Math.min(sharesByRisk, sharesByBuyingPower);
  return Math.max(0, shares);
}

export function addPosition(state: BridgeState, pos: ManagedPosition): BridgeState {
  state.managed_positions.push(pos);
  state.total_trades_placed += 1;
  saveState(state);
  return state;
}

export function removePosition(state: BridgeState, symbol: string): BridgeState {
  const before = state.managed_positions.length;
  state.managed_positions = state.managed_positions.filter((p) => p.symbol !== symbol);
  if (state.managed_positions.length < before) {
    state.total_trades_closed += 1;
  }
  saveState(state);
  return state;
}

export async function syncWithBroker(state: BridgeState): Promise<BridgeState> {
  const brokerPositions = await broker.getPositions();
  const brokerSymbols = new Set(brokerPositions.map((p) => p.symbol));

  const closed: ManagedPosition[] = [];
  state.managed_positions = state.managed_positions.filter((mp) => {
    if (!brokerSymbols.has(mp.symbol)) {
      closed.push(mp);
      return false;
    }
    return true;
  });

  for (const pos of closed) {
    state.total_trades_closed += 1;
    logger.log({
      event: 'position_closed',
      strategy_version_id: pos.strategy_version_id,
      symbol: pos.symbol,
      details: {
        entry_price: pos.entry_price,
        stop_price: pos.stop_price,
        take_profit_price: pos.take_profit_price,
        reason: 'detected_closed_at_broker',
      },
    });
  }

  if (closed.length > 0) {
    saveState(state);
  }

  return state;
}
