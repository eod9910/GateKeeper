# Execution Bridge - Step-by-Step Implementation Plan

> **Purpose**: This document is a Codex-ready implementation spec. Each step is self-contained with exact file paths, function signatures, data structures, and integration points. Execute steps in order - each builds on the previous.

## Architecture Overview

```
[Scheduler (cron/setInterval)]
    |
    v
[Signal Scanner Service]  -->  scans universe with composite strategy
    |
    v
[Position Manager]  -->  checks max concurrent, filters duplicates
    |
    v
[Order Executor]  -->  places bracket orders via Alpaca API
    |
    v
[Trade Logger]  -->  records every action to JSON audit trail
    |
    v
[Kill Switch]  -->  monitors account DD, halts system if breached
```

**Tech stack**: TypeScript (Express backend on port 3002), Alpaca REST API v2, file-based JSON storage (matching existing patterns).

**Broker**: Alpaca Markets (https://alpaca.markets). Free API. Supports paper and live trading with the same code - only the base URL changes.

---

## Prerequisites

Before starting, add the `@alpacahq/alpaca-trade-api` npm package:

```bash
cd backend
npm install @alpacahq/alpaca-trade-api
npm install --save-dev @types/node-cron
npm install node-cron
```

Create a `.env` entry (DO NOT commit this file):

```env
# Alpaca Paper Trading (default)
ALPACA_API_KEY=your_paper_key_here
ALPACA_SECRET_KEY=your_paper_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets

# Set to 'live' to use real money (requires ALPACA_BASE_URL change too)
ALPACA_MODE=paper

# Execution Bridge
EXECUTION_BRIDGE_ENABLED=false
EXECUTION_SCAN_CRON=0 21 * * 1-5
EXECUTION_MAX_CONCURRENT=3
EXECUTION_ACCOUNT_DD_KILL_PCT=15
```

---

## Step 1: Alpaca Client Wrapper

**File**: `backend/src/services/brokerClient.ts` (NEW)

**What it does**: Thin wrapper around Alpaca REST API. All broker communication goes through this file. No other file should import Alpaca directly.

```typescript
import Alpaca from '@alpacahq/alpaca-trade-api';

// -- Types --

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

// -- Client --

let _client: any = null;

function getClient(): any {
  if (!_client) {
    const key = process.env.ALPACA_API_KEY;
    const secret = process.env.ALPACA_SECRET_KEY;
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    if (!key || !secret) {
      throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env');
    }
    _client = new Alpaca({
      keyId: key,
      secretKey: secret,
      paper: baseUrl.includes('paper'),
      baseUrl,
    });
  }
  return _client;
}

export function isPaperMode(): boolean {
  return (process.env.ALPACA_MODE || 'paper') === 'paper';
}

// -- Account --

export async function getAccount(): Promise<BrokerAccount> {
  const acct = await getClient().getAccount();
  return {
    id: acct.id,
    cash: parseFloat(acct.cash),
    portfolio_value: parseFloat(acct.portfolio_value),
    buying_power: parseFloat(acct.buying_power),
    equity: parseFloat(acct.equity),
    last_equity: parseFloat(acct.last_equity),
    day_pnl: parseFloat(acct.equity) - parseFloat(acct.last_equity),
    day_pnl_pct: ((parseFloat(acct.equity) - parseFloat(acct.last_equity)) / parseFloat(acct.last_equity)) * 100,
  };
}

// -- Positions --

export async function getPositions(): Promise<BrokerPosition[]> {
  const positions = await getClient().getPositions();
  return positions.map((p: any) => ({
    symbol: p.symbol,
    qty: parseFloat(p.qty),
    side: parseFloat(p.qty) > 0 ? 'long' : 'short',
    avg_entry_price: parseFloat(p.avg_entry_price),
    current_price: parseFloat(p.current_price),
    market_value: parseFloat(p.market_value),
    unrealized_pnl: parseFloat(p.unrealized_pl),
    unrealized_pnl_pct: parseFloat(p.unrealized_plpc) * 100,
  }));
}

export async function getPosition(symbol: string): Promise<BrokerPosition | null> {
  try {
    const p = await getClient().getPosition(symbol);
    return {
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      side: parseFloat(p.qty) > 0 ? 'long' : 'short',
      avg_entry_price: parseFloat(p.avg_entry_price),
      current_price: parseFloat(p.current_price),
      market_value: parseFloat(p.market_value),
      unrealized_pnl: parseFloat(p.unrealized_pl),
      unrealized_pnl_pct: parseFloat(p.unrealized_plpc) * 100,
    };
  } catch {
    return null;
  }
}

export async function closePosition(symbol: string): Promise<BrokerOrder> {
  return await getClient().closePosition(symbol);
}

export async function closeAllPositions(): Promise<void> {
  await getClient().closeAllPositions();
}

// -- Orders --

export async function submitOrder(order: BracketOrderRequest): Promise<BrokerOrder> {
  const result = await getClient().createOrder({
    symbol: order.symbol,
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
  return _mapOrder(result);
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
  const result = await getClient().createOrder(params);
  return _mapOrder(result);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await getClient().cancelOrder(orderId);
}

export async function cancelAllOrders(): Promise<void> {
  await getClient().cancelAllOrders();
}

export async function getOpenOrders(): Promise<BrokerOrder[]> {
  const orders = await getClient().getOrders({ status: 'open' });
  return orders.map(_mapOrder);
}

export async function getOrder(orderId: string): Promise<BrokerOrder> {
  const order = await getClient().getOrder(orderId);
  return _mapOrder(order);
}

// -- Clock --

export async function isMarketOpen(): Promise<boolean> {
  const clock = await getClient().getClock();
  return clock.is_open;
}

export async function getNextMarketOpen(): Promise<string> {
  const clock = await getClient().getClock();
  return clock.next_open;
}

// -- Internal --

function _mapOrder(o: any): BrokerOrder {
  return {
    id: o.id,
    client_order_id: o.client_order_id,
    symbol: o.symbol,
    qty: parseFloat(o.qty),
    side: o.side,
    type: o.type,
    time_in_force: o.time_in_force,
    status: o.status,
    filled_avg_price: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
    filled_qty: parseFloat(o.filled_qty || '0'),
    submitted_at: o.submitted_at,
    filled_at: o.filled_at,
    limit_price: o.limit_price ? parseFloat(o.limit_price) : undefined,
    stop_price: o.stop_price ? parseFloat(o.stop_price) : undefined,
  };
}
```

**Validation**: After creating this file, test the connection by calling `getAccount()` from a temporary script or route. The response should return account details from Alpaca paper.

---

## Step 2: Trade Logger

**File**: `backend/src/services/executionLogger.ts` (NEW)

**What it does**: Append-only JSON log of every execution bridge action. One file per day. Stored in `backend/data/execution-log/`.

**Storage path**: `backend/data/execution-log/YYYY-MM-DD.json`

```typescript
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../../data/execution-log');

export type LogEventType =
  | 'scan_started'
  | 'scan_completed'
  | 'signal_detected'
  | 'signal_filtered'
  | 'order_submitted'
  | 'order_filled'
  | 'order_rejected'
  | 'order_cancelled'
  | 'stop_moved'
  | 'position_closed'
  | 'kill_switch_triggered'
  | 'bridge_started'
  | 'bridge_stopped'
  | 'error';

export interface LogEntry {
  timestamp: string;
  event: LogEventType;
  strategy_version_id?: string;
  symbol?: string;
  details: Record<string, any>;
}

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayFile(): string {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.json`);
}

export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  ensureDir();
  const full: LogEntry = { timestamp: new Date().toISOString(), ...entry };
  const filePath = todayFile();

  let existing: LogEntry[] = [];
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      existing = [];
    }
  }
  existing.push(full);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

  // Also print to stderr for terminal visibility
  const sym = full.symbol ? ` [${full.symbol}]` : '';
  console.error(`[ExecBridge] ${full.event}${sym}: ${JSON.stringify(full.details)}`);
}

export function getLogForDate(date: string): LogEntry[] {
  const filePath = path.join(LOG_DIR, `${date}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

export function getRecentLogs(days: number = 7): LogEntry[] {
  ensureDir();
  const all: LogEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    all.push(...getLogForDate(dateStr));
  }
  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
```

---

## Step 3: Position Manager

**File**: `backend/src/services/positionManager.ts` (NEW)

**What it does**: Tracks live positions, enforces max concurrent positions, prevents duplicate entries on the same symbol, calculates position size.

**State file**: `backend/data/execution-state.json` - persists the bridge state across restarts.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as broker from './brokerClient';
import * as logger from './executionLogger';

const STATE_FILE = path.join(__dirname, '../../data/execution-state.json');

// -- Types --

export interface ManagedPosition {
  symbol: string;
  strategy_version_id: string;
  side: 'long' | 'short';
  qty: number;
  entry_price: number;
  stop_price: number;
  take_profit_price: number;
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

// -- State persistence --

const DEFAULT_STATE: BridgeState = {
  enabled: false,
  mode: 'paper',
  kill_switch_active: false,
  managed_positions: [],
  last_scan_signals: 0,
  total_trades_placed: 0,
  total_trades_closed: 0,
};

export function loadState(): BridgeState {
  if (!fs.existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: BridgeState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// -- Position queries --

export function getOpenPositionCount(state: BridgeState): number {
  return state.managed_positions.length;
}

export function hasPositionForSymbol(state: BridgeState, symbol: string): boolean {
  return state.managed_positions.some(p => p.symbol === symbol);
}

export function canOpenNewPosition(state: BridgeState, maxConcurrent: number): boolean {
  if (state.kill_switch_active) return false;
  if (!state.enabled) return false;
  return state.managed_positions.length < maxConcurrent;
}

// -- Position sizing --
// Fixed fractional: risk 1% of equity per trade.
// Position size = (equity * risk_pct) / stop_distance_dollars

export async function calculatePositionSize(
  stopDistanceDollars: number,
  riskPct: number = 0.01,
): Promise<number> {
  const account = await broker.getAccount();
  const riskDollars = account.equity * riskPct;
  const shares = Math.floor(riskDollars / stopDistanceDollars);
  return Math.max(1, shares);
}

// -- Lifecycle --

export function addPosition(state: BridgeState, pos: ManagedPosition): BridgeState {
  state.managed_positions.push(pos);
  state.total_trades_placed++;
  saveState(state);
  return state;
}

export function removePosition(state: BridgeState, symbol: string): BridgeState {
  state.managed_positions = state.managed_positions.filter(p => p.symbol !== symbol);
  state.total_trades_closed++;
  saveState(state);
  return state;
}

// -- Sync with broker --
// Called periodically to detect fills, stops hit, etc.

export async function syncWithBroker(state: BridgeState): Promise<BridgeState> {
  const brokerPositions = await broker.getPositions();
  const brokerSymbols = new Set(brokerPositions.map(p => p.symbol));

  // Find managed positions that no longer exist at broker (closed by stop/TP)
  const closed: ManagedPosition[] = [];
  state.managed_positions = state.managed_positions.filter(mp => {
    if (!brokerSymbols.has(mp.symbol)) {
      closed.push(mp);
      return false;
    }
    return true;
  });

  for (const pos of closed) {
    state.total_trades_closed++;
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
```

---

## Step 4: Kill Switch

**File**: `backend/src/services/killSwitch.ts` (NEW)

**What it does**: Monitors account-level drawdown. If equity drops below threshold from session high-water mark, kills all positions and disables the bridge. Also provides a manual kill button.

```typescript
import * as broker from './brokerClient';
import * as logger from './executionLogger';
import { BridgeState, saveState } from './positionManager';

export interface KillSwitchConfig {
  max_account_dd_pct: number;       // e.g. 15 = 15% drawdown from session start equity
  max_daily_loss_pct: number;       // e.g. 3 = 3% loss in a single day
  session_start_equity: number;     // equity when bridge was enabled
}

export async function checkKillSwitch(
  state: BridgeState,
  config: KillSwitchConfig,
): Promise<{ triggered: boolean; reason?: string }> {
  if (state.kill_switch_active) {
    return { triggered: true, reason: state.kill_switch_reason };
  }

  const account = await broker.getAccount();

  // Check account-level drawdown from session start
  const ddPct = ((config.session_start_equity - account.equity) / config.session_start_equity) * 100;
  if (ddPct >= config.max_account_dd_pct) {
    return {
      triggered: true,
      reason: `Account DD ${ddPct.toFixed(1)}% >= ${config.max_account_dd_pct}% limit (equity: $${account.equity.toFixed(0)}, session start: $${config.session_start_equity.toFixed(0)})`,
    };
  }

  // Check daily loss
  if (account.day_pnl_pct <= -config.max_daily_loss_pct) {
    return {
      triggered: true,
      reason: `Daily loss ${account.day_pnl_pct.toFixed(1)}% >= ${config.max_daily_loss_pct}% limit`,
    };
  }

  return { triggered: false };
}

export async function executeKillSwitch(
  state: BridgeState,
  reason: string,
): Promise<BridgeState> {
  logger.log({
    event: 'kill_switch_triggered',
    details: { reason, positions_open: state.managed_positions.length },
  });

  // Cancel all open orders
  try {
    await broker.cancelAllOrders();
  } catch (err: any) {
    logger.log({ event: 'error', details: { action: 'cancel_all_orders', error: err.message } });
  }

  // Close all positions
  try {
    await broker.closeAllPositions();
  } catch (err: any) {
    logger.log({ event: 'error', details: { action: 'close_all_positions', error: err.message } });
  }

  state.kill_switch_active = true;
  state.kill_switch_reason = reason;
  state.enabled = false;
  state.managed_positions = [];
  saveState(state);

  return state;
}
```

---

## Step 5: Signal Scanner Service

**File**: `backend/src/services/signalScanner.ts` (NEW)

**What it does**: Runs the composite strategy scanner against the full universe, collects signals, filters them through the position manager, and returns actionable entry candidates.

**Key integration**: Uses the existing `pluginServiceClient.runScannerUniverseViaService()` to call the Python scanner. This is the same path the UI scanner uses.

```typescript
import { StrategySpec } from '../types';
import * as storage from './storageService';
import * as pluginClient from './pluginServiceClient';
import * as logger from './executionLogger';

export interface SignalCandidate {
  symbol: string;
  entry_price: number;           // current close (market-on-close entry)
  stop_price: number;            // from ATR calculation
  stop_distance: number;         // |entry - stop|
  take_profit_price: number;     // entry + (stop_distance * take_profit_R)
  atr: number;
  score: number;
  signal_bar_date: string;
  strategy_version_id: string;
  raw_candidate: any;            // full candidate object for audit
}

export async function scanForSignals(
  strategyVersionId: string,
): Promise<SignalCandidate[]> {
  // 1. Load the strategy spec
  const spec = await storage.getStrategy(strategyVersionId);
  if (!spec) {
    throw new Error(`Strategy ${strategyVersionId} not found`);
  }

  // 2. Load the universe (from symbols.json or spec.universe)
  const universe = spec.universe && spec.universe.length > 0
    ? spec.universe
    : await _loadDefaultUniverse();

  const interval = spec.interval || '1d';
  const period = '2y';

  logger.log({
    event: 'scan_started',
    strategy_version_id: strategyVersionId,
    details: { universe_size: universe.length, interval },
  });

  // 3. Run the scanner via the Python service
  const result = await pluginClient.runScannerUniverseViaService(
    spec,
    universe,
    interval,    // timeframe display
    period,
    interval,    // interval canonical
    'scan',
  );

  // 4. Extract actionable signals (entry_ready === true)
  const signals: SignalCandidate[] = [];
  for (const symbolResult of result.results) {
    if (symbolResult.error) continue;
    for (const candidate of symbolResult.candidates) {
      if (!candidate.entry_ready) continue;

      // Extract pricing from candidate anchors
      const entryPrice = candidate.anchors?.entry_price
        || candidate.anchors?.close_price
        || candidate.chart_data?.[candidate.window_end]?.Close;

      if (!entryPrice) continue;

      const riskConfig = spec.risk_config || (spec as any).risk || {};
      const atrMultiplier = riskConfig.atr_multiplier || riskConfig.stop_value || 2;
      const takeProfitR = riskConfig.take_profit_R || riskConfig.take_profit_R || 7;
      const atr = candidate.anchors?.atr || candidate.anchors?.atr_value || 0;

      if (atr <= 0) continue;

      const stopDistance = atr * atrMultiplier;
      const stopPrice = entryPrice - stopDistance;  // long only for now
      const takeProfitPrice = entryPrice + (stopDistance * takeProfitR);

      signals.push({
        symbol: symbolResult.symbol,
        entry_price: entryPrice,
        stop_price: stopPrice,
        stop_distance: stopDistance,
        take_profit_price: takeProfitPrice,
        atr,
        score: candidate.score || 0,
        signal_bar_date: candidate.anchors?.signal_date || new Date().toISOString(),
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
      symbols_with_signals: signals.map(s => s.symbol),
    },
  });

  return signals;
}

async function _loadDefaultUniverse(): Promise<string[]> {
  const fs = await import('fs');
  const path = await import('path');
  const symbolsPath = path.join(__dirname, '../../data/symbols.json');
  if (fs.existsSync(symbolsPath)) {
    const data = JSON.parse(fs.readFileSync(symbolsPath, 'utf8'));
    // symbols.json might be an array or { symbols: [...] }
    return Array.isArray(data) ? data : (data.symbols || []);
  }
  return [];
}
```

---

## Step 6: Order Executor

**File**: `backend/src/services/orderExecutor.ts` (NEW)

**What it does**: Takes filtered signal candidates, calculates position size, submits bracket orders (entry + stop + take profit) via the broker client, and updates the position manager state.

```typescript
import { v4 as uuid } from 'uuid';
import * as broker from './brokerClient';
import * as positionManager from './positionManager';
import * as logger from './executionLogger';
import { SignalCandidate } from './signalScanner';

export interface OrderResult {
  symbol: string;
  success: boolean;
  order_id?: string;
  qty?: number;
  error?: string;
}

export async function executeSignals(
  signals: SignalCandidate[],
  state: positionManager.BridgeState,
  maxConcurrent: number,
  riskPctPerTrade: number = 0.01,
): Promise<OrderResult[]> {
  const results: OrderResult[] = [];

  // Sort by score descending - best signals first
  const sorted = [...signals].sort((a, b) => b.score - a.score);

  for (const signal of sorted) {
    // Check if we can still open positions
    if (!positionManager.canOpenNewPosition(state, maxConcurrent)) {
      logger.log({
        event: 'signal_filtered',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: { reason: 'max_concurrent_reached', current: state.managed_positions.length, max: maxConcurrent },
      });
      continue;
    }

    // Skip if we already have a position in this symbol
    if (positionManager.hasPositionForSymbol(state, signal.symbol)) {
      logger.log({
        event: 'signal_filtered',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: { reason: 'duplicate_symbol' },
      });
      continue;
    }

    // Calculate position size
    let qty: number;
    try {
      qty = await positionManager.calculatePositionSize(
        signal.stop_distance,
        riskPctPerTrade,
      );
    } catch (err: any) {
      results.push({ symbol: signal.symbol, success: false, error: `Position size calc failed: ${err.message}` });
      continue;
    }

    if (qty <= 0) {
      results.push({ symbol: signal.symbol, success: false, error: 'Calculated qty is 0' });
      continue;
    }

    // Submit bracket order
    const clientOrderId = `pd_${signal.symbol}_${Date.now()}`;
    try {
      const order = await broker.submitOrder({
        symbol: signal.symbol,
        qty,
        side: 'buy',  // long only for now
        type: 'market',
        time_in_force: 'day',
        take_profit: { limit_price: Math.round(signal.take_profit_price * 100) / 100 },
        stop_loss: { stop_price: Math.round(signal.stop_price * 100) / 100 },
        client_order_id: clientOrderId,
      });

      logger.log({
        event: 'order_submitted',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: {
          order_id: order.id,
          qty,
          entry_price: signal.entry_price,
          stop_price: signal.stop_price,
          take_profit_price: signal.take_profit_price,
          stop_distance: signal.stop_distance,
          risk_pct: riskPctPerTrade,
          score: signal.score,
        },
      });

      // Add to managed positions
      state = positionManager.addPosition(state, {
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        side: 'long',
        qty,
        entry_price: signal.entry_price,
        stop_price: signal.stop_price,
        take_profit_price: signal.take_profit_price,
        entry_order_id: order.id,
        entry_time: new Date().toISOString(),
        signal_data: {
          score: signal.score,
          atr: signal.atr,
          signal_bar_date: signal.signal_bar_date,
        },
      });

      results.push({ symbol: signal.symbol, success: true, order_id: order.id, qty });
    } catch (err: any) {
      logger.log({
        event: 'order_rejected',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: { error: err.message, qty },
      });
      results.push({ symbol: signal.symbol, success: false, error: err.message });
    }
  }

  return results;
}
```

---

## Step 7: Bridge Orchestrator (Main Loop)

**File**: `backend/src/services/executionBridge.ts` (NEW)

**What it does**: Top-level orchestrator. Owns the cron schedule, coordinates scanner -> position manager -> order executor -> kill switch. Single entry point for starting/stopping the bridge.

```typescript
import * as cron from 'node-cron';
import * as scanner from './signalScanner';
import * as executor from './orderExecutor';
import * as positionManager from './positionManager';
import * as killSwitch from './killSwitch';
import * as broker from './brokerClient';
import * as logger from './executionLogger';

let _cronJob: cron.ScheduledTask | null = null;
let _monitorInterval: ReturnType<typeof setInterval> | null = null;

export interface BridgeConfig {
  strategy_version_id: string;
  scan_cron: string;              // e.g. "0 21 * * 1-5" (9PM ET Mon-Fri, after market close)
  max_concurrent: number;
  risk_pct_per_trade: number;     // e.g. 0.01 = 1%
  max_account_dd_pct: number;     // e.g. 15
  max_daily_loss_pct: number;     // e.g. 3
  monitor_interval_ms: number;    // e.g. 60000 (check kill switch every minute during market hours)
}

let _config: BridgeConfig | null = null;
let _sessionStartEquity: number = 0;

// -- Public API --

export async function startBridge(config: BridgeConfig): Promise<void> {
  _config = config;

  // Record session start equity for kill switch
  const account = await broker.getAccount();
  _sessionStartEquity = account.equity;

  // Load or initialize state
  const state = positionManager.loadState();
  state.enabled = true;
  state.mode = broker.isPaperMode() ? 'paper' : 'live';
  state.kill_switch_active = false;
  state.kill_switch_reason = undefined;
  state.session_start = new Date().toISOString();
  positionManager.saveState(state);

  logger.log({
    event: 'bridge_started',
    strategy_version_id: config.strategy_version_id,
    details: {
      mode: state.mode,
      max_concurrent: config.max_concurrent,
      risk_pct: config.risk_pct_per_trade,
      scan_cron: config.scan_cron,
      session_equity: _sessionStartEquity,
    },
  });

  // Start the cron scan job
  _cronJob = cron.schedule(config.scan_cron, () => {
    _runScanCycle().catch(err => {
      logger.log({ event: 'error', details: { action: 'scan_cycle', error: err.message } });
    });
  });

  // Start the kill switch monitor (checks every N ms during market hours)
  _monitorInterval = setInterval(() => {
    _runMonitorCycle().catch(err => {
      logger.log({ event: 'error', details: { action: 'monitor_cycle', error: err.message } });
    });
  }, config.monitor_interval_ms);
}

export async function stopBridge(): Promise<void> {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
  }

  const state = positionManager.loadState();
  state.enabled = false;
  positionManager.saveState(state);

  logger.log({
    event: 'bridge_stopped',
    details: { positions_open: state.managed_positions.length },
  });
}

export function getBridgeStatus(): {
  config: BridgeConfig | null;
  state: positionManager.BridgeState;
  session_start_equity: number;
} {
  return {
    config: _config,
    state: positionManager.loadState(),
    session_start_equity: _sessionStartEquity,
  };
}

export async function manualKill(reason: string): Promise<void> {
  const state = positionManager.loadState();
  await killSwitch.executeKillSwitch(state, `MANUAL: ${reason}`);
  await stopBridge();
}

export async function triggerManualScan(): Promise<void> {
  await _runScanCycle();
}

// -- Internal --

async function _runScanCycle(): Promise<void> {
  if (!_config) return;
  let state = positionManager.loadState();
  if (!state.enabled || state.kill_switch_active) return;

  // Sync positions with broker first (detect stops/TPs that filled)
  state = await positionManager.syncWithBroker(state);

  // Check kill switch before scanning
  const ks = await killSwitch.checkKillSwitch(state, {
    max_account_dd_pct: _config.max_account_dd_pct,
    max_daily_loss_pct: _config.max_daily_loss_pct,
    session_start_equity: _sessionStartEquity,
  });
  if (ks.triggered) {
    await killSwitch.executeKillSwitch(state, ks.reason!);
    await stopBridge();
    return;
  }

  // Can we even open new positions?
  if (!positionManager.canOpenNewPosition(state, _config.max_concurrent)) {
    logger.log({
      event: 'scan_completed',
      strategy_version_id: _config.strategy_version_id,
      details: { skipped: true, reason: 'max_concurrent_reached' },
    });
    return;
  }

  // Scan for signals
  const signals = await scanner.scanForSignals(_config.strategy_version_id);

  state.last_scan_time = new Date().toISOString();
  state.last_scan_signals = signals.length;
  positionManager.saveState(state);

  if (signals.length === 0) return;

  // Execute signals
  const results = await executor.executeSignals(
    signals,
    state,
    _config.max_concurrent,
    _config.risk_pct_per_trade,
  );

  const filled = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  if (filled > 0 || failed > 0) {
    logger.log({
      event: 'scan_completed',
      strategy_version_id: _config.strategy_version_id,
      details: { signals: signals.length, orders_placed: filled, orders_failed: failed },
    });
  }
}

async function _runMonitorCycle(): Promise<void> {
  if (!_config) return;
  let state = positionManager.loadState();
  if (!state.enabled || state.kill_switch_active) return;

  // Only check during market hours
  try {
    const open = await broker.isMarketOpen();
    if (!open) return;
  } catch {
    return;
  }

  // Sync positions
  state = await positionManager.syncWithBroker(state);

  // Check kill switch
  const ks = await killSwitch.checkKillSwitch(state, {
    max_account_dd_pct: _config.max_account_dd_pct,
    max_daily_loss_pct: _config.max_daily_loss_pct,
    session_start_equity: _sessionStartEquity,
  });
  if (ks.triggered) {
    await killSwitch.executeKillSwitch(state, ks.reason!);
    await stopBridge();
  }
}
```

---

## Step 8: API Routes

**File**: `backend/src/routes/execution.ts` (NEW)

**What it does**: REST API endpoints for the execution bridge. Allows the frontend (and future automation) to start/stop the bridge, check status, trigger manual scans, and activate the kill switch.

```typescript
import { Router, Request, Response } from 'express';
import * as bridge from '../services/executionBridge';
import * as broker from '../services/brokerClient';
import * as logger from '../services/executionLogger';

const router = Router();

// GET /api/execution/status - bridge state + account info
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = bridge.getBridgeStatus();
    let account = null;
    try {
      account = await broker.getAccount();
    } catch { /* broker not configured */ }
    let positions = null;
    try {
      positions = await broker.getPositions();
    } catch { /* broker not configured */ }
    res.json({
      success: true,
      data: { ...status, account, broker_positions: positions },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/execution/start - start the bridge
router.post('/start', async (req: Request, res: Response) => {
  try {
    const {
      strategy_version_id,
      scan_cron = '0 21 * * 1-5',
      max_concurrent = 3,
      risk_pct_per_trade = 0.01,
      max_account_dd_pct = 15,
      max_daily_loss_pct = 3,
      monitor_interval_ms = 60000,
    } = req.body;

    if (!strategy_version_id) {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' });
    }

    await bridge.startBridge({
      strategy_version_id,
      scan_cron,
      max_concurrent,
      risk_pct_per_trade,
      max_account_dd_pct,
      max_daily_loss_pct,
      monitor_interval_ms,
    });

    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/execution/stop - stop the bridge (keeps positions open)
router.post('/stop', async (req: Request, res: Response) => {
  try {
    await bridge.stopBridge();
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/execution/kill - emergency kill switch (closes everything)
router.post('/kill', async (req: Request, res: Response) => {
  try {
    const reason = req.body.reason || 'Manual kill switch activated via UI';
    await bridge.manualKill(reason);
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/execution/scan - trigger a manual scan cycle
router.post('/scan', async (req: Request, res: Response) => {
  try {
    await bridge.triggerManualScan();
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/execution/logs - get execution logs
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const logs = logger.getRecentLogs(days);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/execution/logs/:date - get logs for specific date
router.get('/logs/:date', async (req: Request, res: Response) => {
  try {
    const logs = logger.getLogForDate(req.params.date);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/execution/account - get broker account details
router.get('/account', async (req: Request, res: Response) => {
  try {
    const account = await broker.getAccount();
    res.json({ success: true, data: account });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/execution/positions - get broker positions
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const positions = await broker.getPositions();
    res.json({ success: true, data: positions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
```

---

## Step 9: Register Routes in Server

**File**: `backend/src/server.ts` (EDIT)

Add the execution route alongside the other route imports and registrations.

**Add import** (near the other route imports at the top):
```typescript
import executionRoutes from './routes/execution';
```

**Add route registration** (near the other `app.use` calls):
```typescript
app.use('/api/execution', executionRoutes);
```

**Add SPA route** (near the other SPA routes like `/validator`, `/sweep`):
```typescript
app.get('/execution', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/execution.html'));
});
```

---

## Step 10: Frontend - Execution Dashboard

**File**: `frontend/public/execution.html` (NEW)

**What it does**: Simple dashboard to control and monitor the execution bridge. Shows: bridge status, account info, open positions, recent signals, execution log, start/stop/kill buttons.

**Design guidance**:
- Match the existing UI style (dark theme, same CSS framework used by `sweep.html` and `validator.html`)
- Look at `frontend/public/sweep.html` for the exact CSS classes, layout patterns, and color scheme
- Use `fetch('/api/execution/...')` for all API calls
- Auto-refresh status every 10 seconds when bridge is running
- Red "KILL SWITCH" button always visible at top right, requires confirmation dialog

**Key sections**:

1. **Header**: "Execution Bridge" title + mode badge (PAPER/LIVE) + kill switch button
2. **Account Card**: Equity, cash, buying power, day P&L, day P&L %
3. **Bridge Controls Card**:
   - Strategy selector (dropdown from `/api/strategies`)
   - Max concurrent input (default 3)
   - Risk per trade % input (default 1%)
   - Account DD kill % input (default 15%)
   - Daily loss kill % input (default 3%)
   - Scan schedule display (cron expression)
   - Start / Stop / Manual Scan buttons
4. **Positions Card**: Table of managed positions with symbol, side, qty, entry price, current price, unrealized P&L, stop, take profit
5. **Signals Card**: Last scan results - which symbols had signals, which were filtered and why
6. **Log Card**: Scrollable table of recent log entries (event, symbol, timestamp, details)

**Add nav link**: Edit the navigation in `frontend/public/index.html` (or whichever file has the nav bar) to add an "Execution" link pointing to `/execution`.

---

## Step 11: Integration Verification Checklist

After all steps are complete, verify:

- [ ] `npm run build` compiles without errors in `backend/`
- [ ] Server starts without errors (`npm run dev` or `npx ts-node src/server.ts`)
- [ ] `GET /api/execution/status` returns `{ success: true, data: { state: { enabled: false, ... } } }`
- [ ] With valid Alpaca paper keys in `.env`:
  - [ ] `GET /api/execution/account` returns account details
  - [ ] `GET /api/execution/positions` returns `[]` (empty)
- [ ] `POST /api/execution/start` with `{ strategy_version_id: "pullback_uptrend_entry_composite_v1" }` starts the bridge
- [ ] `GET /api/execution/status` shows `enabled: true, mode: 'paper'`
- [ ] `POST /api/execution/stop` stops the bridge without closing positions
- [ ] `POST /api/execution/kill` closes all positions and disables bridge
- [ ] Execution logs appear in `backend/data/execution-log/YYYY-MM-DD.json`
- [ ] Frontend dashboard loads at `/execution` and displays all sections

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `backend/src/services/brokerClient.ts` | NEW | Alpaca API wrapper |
| `backend/src/services/executionLogger.ts` | NEW | Append-only trade audit log |
| `backend/src/services/positionManager.ts` | NEW | Position tracking + max concurrent enforcement |
| `backend/src/services/killSwitch.ts` | NEW | Account-level drawdown protection |
| `backend/src/services/signalScanner.ts` | NEW | Runs composite strategy on universe |
| `backend/src/services/orderExecutor.ts` | NEW | Submits bracket orders via broker |
| `backend/src/services/executionBridge.ts` | NEW | Main orchestrator with cron schedule |
| `backend/src/routes/execution.ts` | NEW | REST API endpoints |
| `backend/src/server.ts` | EDIT | Register new route + SPA page |
| `frontend/public/execution.html` | NEW | Dashboard UI |
| `backend/.env` | EDIT | Add Alpaca keys + bridge config |
| `backend/package.json` | EDIT | Add `@alpacahq/alpaca-trade-api`, `node-cron` deps |

---

## Important Notes for Codex

1. **DO NOT modify any existing files** except `server.ts` (route registration) and `package.json` (deps). All other work is new files.
2. **Follow existing patterns**: Look at `sweepEngine.ts` and `researchAgent.ts` for service patterns. Look at `sweep.ts` and `validator.ts` for route patterns. Look at `sweep.html` for UI patterns.
3. **File-based storage**: This project uses JSON files on disk, not a database. Follow the same pattern (see `storageService.ts`).
4. **Python integration**: The Python service runs on port 8100 via FastAPI. The scanner is already built - just call `pluginServiceClient.runScannerUniverseViaService()`.
5. **TypeScript strict**: The project uses TypeScript. All new code must be properly typed.
6. **Error handling**: Every async function should have try/catch. Log errors via `executionLogger.log()`.
7. **No secrets in code**: API keys come from `.env` only.
8. **The `executionEngine.ts` already exists** - it handles trade-level rule enforcement (breakeven, ladder, green-to-red). The execution bridge is the *outer loop* that orchestrates scanning, ordering, and position management. The execution engine is the *inner loop* that manages individual trade rules. They are complementary but separate concerns. Do not modify `executionEngine.ts`.

