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

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function executeSignals(
  signals: SignalCandidate[],
  state: positionManager.BridgeState,
  maxConcurrent: number,
  riskPctPerTrade = 0.01,
): Promise<OrderResult[]> {
  const results: OrderResult[] = [];
  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);

  for (const signal of sortedSignals) {
    if (!positionManager.canOpenNewPosition(state, maxConcurrent)) {
      logger.log({
        event: 'signal_filtered',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: {
          reason: 'max_concurrent_reached',
          current: state.managed_positions.length,
          max: maxConcurrent,
        },
      });
      continue;
    }

    if (positionManager.hasPositionForSymbol(state, signal.symbol)) {
      logger.log({
        event: 'signal_filtered',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: { reason: 'duplicate_symbol' },
      });
      continue;
    }

    let qty = 0;
    try {
      qty = await positionManager.calculatePositionSize(
        signal.stop_distance,
        signal.entry_price,
        riskPctPerTrade,
      );
    } catch (err: any) {
      results.push({
        symbol: signal.symbol,
        success: false,
        error: `Position size calc failed: ${err?.message || String(err)}`,
      });
      continue;
    }

    if (qty <= 0) {
      logger.log({
        event: 'signal_filtered',
        symbol: signal.symbol,
        strategy_version_id: signal.strategy_version_id,
        details: { reason: 'insufficient_buying_power_or_risk_budget' },
      });
      results.push({
        symbol: signal.symbol,
        success: false,
        error: 'Calculated qty is 0',
      });
      continue;
    }

    const clientOrderId = `pd_${signal.symbol}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    try {
      const order = await broker.submitOrder({
        symbol: signal.symbol,
        qty,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        take_profit: { limit_price: roundPrice(signal.take_profit_price) },
        stop_loss: { stop_price: roundPrice(signal.stop_price) },
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
        details: {
          error: err?.message || String(err),
          qty,
        },
      });
      results.push({
        symbol: signal.symbol,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return results;
}

