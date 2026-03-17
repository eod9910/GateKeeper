import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import * as scanner from './signalScanner';
import * as executor from './orderExecutor';
import * as positionManager from './positionManager';
import * as killSwitch from './killSwitch';
import * as broker from './brokerClient';
import * as logger from './executionLogger';
import * as storage from './storageService';

const CONFIG_FILE = path.join(__dirname, '../../data/execution-bridge-config.json');

let _cronJob: ScheduledTask | null = null;
let _monitorInterval: ReturnType<typeof setInterval> | null = null;
let _config: BridgeConfig | null = null;
let _sessionStartEquity = 0;
let _scanInProgress = false;
let _monitorInProgress = false;

export interface BridgeConfig {
  strategy_version_id: string;
  scan_cron: string;
  timezone?: string;
  max_concurrent: number;
  risk_pct_per_trade: number;
  max_account_dd_pct: number;
  max_daily_loss_pct: number;
  monitor_interval_ms: number;
}

async function assertExecutionEligibility(strategyVersionId: string): Promise<void> {
  const strategy = await storage.getStrategyOrComposite(strategyVersionId);
  if (!strategy) {
    throw new Error(`Strategy not found: ${strategyVersionId}`);
  }

  if (String(strategy.status || '').toLowerCase() !== 'approved') {
    throw new Error(`Execution Desk only accepts approved strategies. ${strategyVersionId} is currently ${strategy.status || 'unapproved'}.`);
  }

  const reports = await storage.getAllValidationReports(strategyVersionId);
  const hasTier3Pass = reports.some((report) =>
    String(report?.pass_fail || '').toUpperCase() === 'PASS'
    && String(report?.config?.validation_tier || '').trim().toLowerCase() === 'tier3'
  );
  if (!hasTier3Pass) {
    throw new Error(`Execution Desk requires a Tier 3 PASS before trading ${strategyVersionId}.`);
  }
}

function saveBridgeConfig(config: BridgeConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function loadBridgeConfig(): BridgeConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      strategy_version_id: String(parsed.strategy_version_id || '').trim(),
      scan_cron: String(parsed.scan_cron || '').trim(),
      timezone: String(parsed.timezone || 'America/New_York').trim(),
      max_concurrent: Math.max(1, Number(parsed.max_concurrent) || 1),
      risk_pct_per_trade: Math.min(0.05, Math.max(0.001, Number(parsed.risk_pct_per_trade) || 0.01)),
      max_account_dd_pct: Math.min(90, Math.max(1, Number(parsed.max_account_dd_pct) || 15)),
      max_daily_loss_pct: Math.min(50, Math.max(0.5, Number(parsed.max_daily_loss_pct) || 3)),
      monitor_interval_ms: Math.max(5000, Number(parsed.monitor_interval_ms) || 60000),
    };
  } catch {
    return null;
  }
}

function clearBridgeConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

async function shutdownBridge(clearPersistedConfig: boolean): Promise<void> {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
  }
  _config = null;

  const state = positionManager.loadState();
  state.enabled = false;
  positionManager.saveState(state);

  if (clearPersistedConfig) {
    clearBridgeConfig();
  }
}

export async function startBridge(config: BridgeConfig): Promise<void> {
  if (!broker.supportsAutomatedExecution()) {
    throw new Error(`${broker.getBrokerLabel()} is connected in monitoring mode. Automated execution currently supports Alpaca only.`);
  }

  if (!cron.validate(config.scan_cron)) {
    throw new Error(`Invalid cron expression: ${config.scan_cron}`);
  }

  await assertExecutionEligibility(config.strategy_version_id);

  if (_cronJob || _monitorInterval) {
    await shutdownBridge(false);
  }

  const account = await broker.getAccount();
  _sessionStartEquity = account.equity;
  _config = config;
  saveBridgeConfig(config);

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
      timezone: config.timezone || 'America/New_York',
      session_equity: _sessionStartEquity,
    },
  });

  _cronJob = cron.schedule(
    config.scan_cron,
    () => {
      void _runScanCycle();
    },
    { timezone: config.timezone || 'America/New_York' },
  );

  _monitorInterval = setInterval(() => {
    void _runMonitorCycle();
  }, Math.max(5000, config.monitor_interval_ms));
}

export async function stopBridge(): Promise<void> {
  await shutdownBridge(true);

  logger.log({
    event: 'bridge_stopped',
    details: { positions_open: positionManager.loadState().managed_positions.length },
  });
}

export async function resumeBridgeFromDisk(): Promise<boolean> {
  if (_config || _cronJob || _monitorInterval) return true;

  const config = loadBridgeConfig();
  if (!config || !config.strategy_version_id || !config.scan_cron) {
    return false;
  }

  try {
    await startBridge(config);
    return true;
  } catch (err: any) {
    logger.log({
      event: 'error',
      strategy_version_id: config.strategy_version_id,
      details: {
        action: 'resume_bridge_from_disk',
        error: err?.message || String(err),
      },
    });
    return false;
  }
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

function roundBrokerPrice(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

function resolveDesiredManagedExits(
  pos: positionManager.ManagedPosition,
  liveEntryPrice: number,
): { desiredEntry: number; desiredStop: number; desiredTakeProfit: number; manualOverride: boolean } | null {
  const desiredEntry = liveEntryPrice > 0 ? liveEntryPrice : Number(pos.entry_price);
  const manualStop = Number(pos.manual_stop_price);
  const manualTakeProfit = Number(pos.manual_take_profit_price);
  const manualOverride = Boolean(
    pos.manual_exit_override
    && Number.isFinite(manualStop) && manualStop > 0
    && Number.isFinite(manualTakeProfit) && manualTakeProfit > 0
  );

  if (manualOverride) {
    return {
      desiredEntry,
      desiredStop: manualStop,
      desiredTakeProfit: manualTakeProfit,
      manualOverride: true,
    };
  }

  return {
    desiredEntry,
    desiredStop: Number(pos.stop_price),
    desiredTakeProfit: Number(pos.take_profit_price),
    manualOverride: false,
  };
}

export async function updateManagedPositionExits(
  symbol: string,
  stopPrice: number,
  takeProfitPrice: number,
): Promise<{
  position: positionManager.ManagedPosition;
  repair: { repaired: number; repriced: number; skipped: number };
}> {
  const needle = String(symbol || '').trim().toUpperCase();
  if (!needle) {
    throw new Error('symbol is required');
  }
  if (!(stopPrice > 0) || !(takeProfitPrice > 0)) {
    throw new Error('stop_price and take_profit_price must be > 0');
  }

  const state = positionManager.loadState();
  const pos = state.managed_positions.find((entry) => String(entry.symbol || '').trim().toUpperCase() === needle);
  if (!pos) {
    throw new Error(`Managed position not found for ${needle}.`);
  }
  if (String(pos.side || 'long').toLowerCase() !== 'long') {
    throw new Error(`Manual managed exit adjustment is currently supported for long positions only (${needle}).`);
  }

  pos.manual_exit_override = true;
  pos.manual_stop_price = roundBrokerPrice(stopPrice);
  pos.manual_take_profit_price = roundBrokerPrice(takeProfitPrice);
  pos.stop_price = pos.manual_stop_price;
  pos.take_profit_price = pos.manual_take_profit_price;
  positionManager.saveState(state);

  logger.log({
    event: 'managed_position_exits_updated',
    strategy_version_id: pos.strategy_version_id,
    symbol: pos.symbol,
    details: {
      stop_price: pos.stop_price,
      take_profit_price: pos.take_profit_price,
      manual_exit_override: true,
    },
  });

  const repair = await repairManagedPositionExits(needle);
  const refreshed = positionManager.loadState();
  const updated = refreshed.managed_positions.find((entry) => String(entry.symbol || '').trim().toUpperCase() === needle);
  if (!updated) {
    throw new Error(`Managed position disappeared while updating exits for ${needle}.`);
  }

  return { position: updated, repair };
}

export async function repairManagedPositionExits(symbol?: string): Promise<{
  repaired: number;
  repriced: number;
  skipped: number;
}> {
  let state = positionManager.loadState();
  if (state.managed_positions.length === 0) {
    return { repaired: 0, repriced: 0, skipped: 0 };
  }

  const brokerPositions = await broker.getPositions();
  const brokerBySymbol = new Map(brokerPositions.map((p) => [p.symbol, p]));
  const openOrders = await broker.getOpenOrders();
  const sellOrdersBySymbol = new Map<string, broker.BrokerOrder[]>();
  for (const order of openOrders) {
    if (order.side !== 'sell') continue;
    const arr = sellOrdersBySymbol.get(order.symbol) || [];
    arr.push(order);
    sellOrdersBySymbol.set(order.symbol, arr);
  }

  let repaired = 0;
  let repriced = 0;
  let skipped = 0;
  let stateChanged = false;

  for (const pos of state.managed_positions) {
    if (symbol && pos.symbol !== symbol) continue;

    const livePos = brokerBySymbol.get(pos.symbol);
    if (!livePos || livePos.side !== 'long' || livePos.qty <= 0) {
      skipped += 1;
      continue;
    }

    let resolved = resolveDesiredManagedExits(pos, livePos.avg_entry_price);

    if (!resolved?.manualOverride) {
      const spec = await storage.getStrategyOrComposite(pos.strategy_version_id);
      if (!spec) {
        skipped += 1;
        continue;
      }

      const riskConfig = (spec.risk_config || (spec as any).risk || {}) as Record<string, any>;
      const atrMultiplier = Number(riskConfig.atr_multiplier ?? riskConfig.stop_value ?? 0);
      const takeProfitR = scanner.resolveTakeProfitR(spec);
      const atr = Number(pos.signal_data?.atr || 0);

      let stopDistance = Math.abs(Number(pos.entry_price) - Number(pos.stop_price));
      if (atr > 0 && atrMultiplier > 0) {
        stopDistance = atr * atrMultiplier;
      }
      if (!(stopDistance > 0) || !(takeProfitR > 0)) {
        skipped += 1;
        continue;
      }

      const desiredEntry = livePos.avg_entry_price > 0 ? livePos.avg_entry_price : pos.entry_price;
      resolved = {
        desiredEntry,
        desiredStop: desiredEntry - stopDistance,
        desiredTakeProfit: desiredEntry + (stopDistance * takeProfitR),
        manualOverride: false,
      };
    }

    if (!resolved || !(resolved.desiredStop > 0) || !(resolved.desiredTakeProfit > 0)) {
      skipped += 1;
      continue;
    }

    const desiredEntry = resolved.desiredEntry;
    const desiredStop = resolved.desiredStop;
    const desiredTakeProfit = resolved.desiredTakeProfit;
    const existingSellOrders = sellOrdersBySymbol.get(pos.symbol) || [];

    const needsReprice =
      Math.abs(Number(pos.entry_price) - desiredEntry) > 0.01 ||
      Math.abs(Number(pos.stop_price) - desiredStop) > 0.01 ||
      Math.abs(Number(pos.take_profit_price) - desiredTakeProfit) > 0.01;

    if (needsReprice) {
      pos.entry_price = desiredEntry;
      pos.stop_price = desiredStop;
      pos.take_profit_price = desiredTakeProfit;
      repriced += 1;
      stateChanged = true;
    }

    const hasMatchingExitOrder = existingSellOrders.some((order) =>
      (order.limit_price != null && Math.abs(order.limit_price - desiredTakeProfit) <= 0.01)
      || (order.stop_price != null && Math.abs(order.stop_price - desiredStop) <= 0.01)
    );

    if (!existingSellOrders.length || !hasMatchingExitOrder) {
      for (const order of existingSellOrders) {
        await broker.cancelOrder(order.id);
      }

      const qty = Math.max(0, Math.floor(livePos.qty));
      if (qty <= 0) {
        skipped += 1;
        continue;
      }

      const exitOrder = await broker.submitExitOrder({
        symbol: pos.symbol,
        qty,
        time_in_force: 'day',
        take_profit: { limit_price: roundBrokerPrice(desiredTakeProfit) },
        stop_loss: { stop_price: roundBrokerPrice(desiredStop) },
        client_order_id: `pd_exit_${pos.symbol}_${Date.now()}`,
      });

      logger.log({
        event: 'exit_orders_repaired',
        strategy_version_id: pos.strategy_version_id,
        symbol: pos.symbol,
        details: {
          order_id: exitOrder.id,
          qty,
          entry_price: pos.entry_price,
          stop_price: pos.stop_price,
          take_profit_price: pos.take_profit_price,
          cancelled_orders: existingSellOrders.map((order) => order.id),
        },
      });
      repaired += 1;
    }
  }

  if (stateChanged) {
    positionManager.saveState(state);
  }

  return { repaired, repriced, skipped };
}

async function _runScanCycle(): Promise<void> {
  if (!_config) return;
  if (_scanInProgress) {
    logger.log({
      event: 'scan_completed',
      strategy_version_id: _config.strategy_version_id,
      details: { skipped: true, reason: 'scan_already_running' },
    });
    return;
  }

  _scanInProgress = true;
  try {
    let state = positionManager.loadState();
    if (!state.enabled || state.kill_switch_active) return;

    state = await positionManager.syncWithBroker(state);
    await repairManagedPositionExits();

    const ks = await killSwitch.checkKillSwitch(state, {
      max_account_dd_pct: _config.max_account_dd_pct,
      max_daily_loss_pct: _config.max_daily_loss_pct,
      session_start_equity: _sessionStartEquity,
    });
    if (ks.triggered) {
      await killSwitch.executeKillSwitch(state, ks.reason || 'kill_switch_triggered');
      await stopBridge();
      return;
    }

    if (!positionManager.canOpenNewPosition(state, _config.max_concurrent)) {
      logger.log({
        event: 'scan_completed',
        strategy_version_id: _config.strategy_version_id,
        details: { skipped: true, reason: 'max_concurrent_reached' },
      });
      return;
    }

    const signals = await scanner.scanForSignals(_config.strategy_version_id);
    state.last_scan_time = new Date().toISOString();
    state.last_scan_signals = signals.length;
    positionManager.saveState(state);

    if (signals.length === 0) return;

    const results = await executor.executeSignals(
      signals,
      state,
      _config.max_concurrent,
      _config.risk_pct_per_trade,
    );

    const filled = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.log({
      event: 'scan_completed',
      strategy_version_id: _config.strategy_version_id,
      details: { signals: signals.length, orders_placed: filled, orders_failed: failed },
    });
  } catch (err: any) {
    logger.log({
      event: 'error',
      details: { action: 'scan_cycle', error: err?.message || String(err) },
    });
  } finally {
    _scanInProgress = false;
  }
}

async function _runMonitorCycle(): Promise<void> {
  if (!_config || _monitorInProgress) return;
  _monitorInProgress = true;
  try {
    let state = positionManager.loadState();
    if (!state.enabled || state.kill_switch_active) return;

    try {
      const open = await broker.isMarketOpen();
      if (!open) return;
    } catch {
      return;
    }

    state = await positionManager.syncWithBroker(state);
    await repairManagedPositionExits();

    const ks = await killSwitch.checkKillSwitch(state, {
      max_account_dd_pct: _config.max_account_dd_pct,
      max_daily_loss_pct: _config.max_daily_loss_pct,
      session_start_equity: _sessionStartEquity,
    });
    if (ks.triggered) {
      await killSwitch.executeKillSwitch(state, ks.reason || 'kill_switch_triggered');
      await stopBridge();
    }
  } catch (err: any) {
    logger.log({
      event: 'error',
      details: { action: 'monitor_cycle', error: err?.message || String(err) },
    });
  } finally {
    _monitorInProgress = false;
  }
}
