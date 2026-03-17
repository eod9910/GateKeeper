import * as broker from './brokerClient';
import * as logger from './executionLogger';
import { BridgeState, saveState } from './positionManager';

export interface KillSwitchConfig {
  max_account_dd_pct: number;
  max_daily_loss_pct: number;
  session_start_equity: number;
}

export async function checkKillSwitch(
  state: BridgeState,
  config: KillSwitchConfig,
): Promise<{ triggered: boolean; reason?: string }> {
  if (state.kill_switch_active) {
    return { triggered: true, reason: state.kill_switch_reason };
  }

  if (!Number.isFinite(config.session_start_equity) || config.session_start_equity <= 0) {
    return { triggered: true, reason: 'Invalid session_start_equity for kill switch' };
  }

  const account = await broker.getAccount();

  const ddPct = ((config.session_start_equity - account.equity) / config.session_start_equity) * 100;
  if (ddPct >= config.max_account_dd_pct) {
    return {
      triggered: true,
      reason: `Account DD ${ddPct.toFixed(2)}% >= ${config.max_account_dd_pct}% limit`,
    };
  }

  if (account.day_pnl_pct <= -config.max_daily_loss_pct) {
    return {
      triggered: true,
      reason: `Daily loss ${account.day_pnl_pct.toFixed(2)}% >= ${config.max_daily_loss_pct}% limit`,
    };
  }

  return { triggered: false };
}

export async function executeKillSwitch(state: BridgeState, reason: string): Promise<BridgeState> {
  logger.log({
    event: 'kill_switch_triggered',
    details: { reason, positions_open: state.managed_positions.length },
  });

  try {
    await broker.cancelAllOrders();
  } catch (err: any) {
    logger.log({
      event: 'error',
      details: { action: 'cancel_all_orders', error: err?.message || String(err) },
    });
  }

  try {
    await broker.closeAllPositions();
  } catch (err: any) {
    logger.log({
      event: 'error',
      details: { action: 'close_all_positions', error: err?.message || String(err) },
    });
  }

  state.kill_switch_active = true;
  state.kill_switch_reason = reason;
  state.enabled = false;
  state.managed_positions = [];
  saveState(state);
  return state;
}

