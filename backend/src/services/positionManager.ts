import * as fs from 'fs';
import * as path from 'path';
import * as broker from './brokerClient';
import * as logger from './executionLogger';

const STATE_FILE = path.join(__dirname, '../../data/execution-state.json');

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

export interface BridgeState {
  enabled: boolean;
  mode: 'paper' | 'live';
  kill_switch_active: boolean;
  kill_switch_reason?: string;
  managed_positions: ManagedPosition[];
  last_scan_time?: string;
  last_scan_signals: number;
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
    total_trades_placed: Number.isFinite(Number(raw.total_trades_placed)) ? Number(raw.total_trades_placed) : 0,
    total_trades_closed: Number.isFinite(Number(raw.total_trades_closed)) ? Number(raw.total_trades_closed) : 0,
    session_start: typeof raw.session_start === 'string' ? raw.session_start : undefined,
  };
}

export function loadState(): BridgeState {
  if (!fs.existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: BridgeState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function getOpenPositionCount(state: BridgeState): number {
  return state.managed_positions.length;
}

export function hasPositionForSymbol(state: BridgeState, symbol: string): boolean {
  const needle = symbol.trim().toUpperCase();
  return state.managed_positions.some((p) => p.symbol.trim().toUpperCase() === needle);
}

export function canOpenNewPosition(state: BridgeState, maxConcurrent: number): boolean {
  if (state.kill_switch_active) return false;
  if (!state.enabled) return false;
  return state.managed_positions.length < maxConcurrent;
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
