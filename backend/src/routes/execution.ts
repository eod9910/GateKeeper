import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as bridge from '../services/executionBridge';
import * as broker from '../services/brokerClient';
import * as logger from '../services/executionLogger';
import { enrichConnectedBrokerStatuses, type EnrichedBrokerConnectionStatus } from '../services/importedBrokerPositions';
import { clearRobinhoodConnectedStatusCache, getRobinhoodConnectedStatus } from '../services/robinhoodConnectedStatus';
import { probeRobinhoodPositions } from '../services/robinhoodProbe';
import {
  fetchRobinhoodPositions,
  getRobinhoodLoginStatus,
  startRobinhoodLogin,
  verifyRobinhoodLoginCode,
} from '../services/robinhoodAuthFlow';
import {
  createManualExternalPosition,
  deleteManualExternalPosition,
  getManualExternalPositionRecord,
  getManualExternalProviderCapabilities,
  groupManualExternalPositionsByProvider,
  mapManualExternalPositionRecord,
  providerSupportsManualExternal,
  updateManualExternalPosition,
} from '../services/manualExternalPositions';

const router = Router();

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'execution-settings.json');

interface ExecutionSettings {
  execution_broker_provider?: 'alpaca' | 'oanda';
  broker_provider?: 'alpaca' | 'oanda';
  alpaca_api_key?: string;
  alpaca_secret_key?: string;
  alpaca_base_url?: string;
  alpaca_mode?: 'paper' | 'live';
  oanda_api_token?: string;
  oanda_account_id?: string;
  oanda_environment?: 'practice' | 'live';
  oanda_base_url?: string;
  robinhood_username?: string;
  robinhood_password?: string;
  robinhood_totp_secret?: string;
  robinhood_session_path?: string;
}

function loadSettings(): ExecutionSettings | null {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function saveSettings(settings: ExecutionSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '****' : '';
  return '****' + key.slice(-4);
}

function normalizeProvider(input: any): 'alpaca' | 'oanda' {
  return String(input || '').trim().toLowerCase() === 'oanda' ? 'oanda' : 'alpaca';
}

function normalizeOandaEnvironment(input: any): 'practice' | 'live' {
  return String(input || '').trim().toLowerCase() === 'live' ? 'live' : 'practice';
}

function normalizeTestProvider(input: any): 'alpaca' | 'oanda' | 'robinhood' {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'oanda') return 'oanda';
  if (raw === 'robinhood') return 'robinhood';
  return 'alpaca';
}

function trimText(input: any): string | undefined {
  const text = String(input || '').trim();
  return text || undefined;
}

function getRobinhoodConfigFromRequest(req: Request, current: ExecutionSettings | null = loadSettings()) {
  return {
    username: trimText(req.body?.robinhood_username) || current?.robinhood_username,
    password: trimText(req.body?.robinhood_password) || current?.robinhood_password,
    totp_secret: trimText(req.body?.robinhood_totp_secret) || current?.robinhood_totp_secret,
    mfa_code: trimText(req.body?.robinhood_mfa_code),
    verification_code: trimText(req.body?.verification_code) || trimText(req.body?.robinhood_mfa_code),
    session_path: trimText(req.body?.robinhood_session_path) || current?.robinhood_session_path,
  };
}

export { loadSettings };

function toNum(input: any, fallback: number): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function getConfiguredFlagForProvider(settings: ExecutionSettings | null, provider: 'alpaca' | 'oanda' | 'robinhood'): boolean {
  if (provider === 'oanda') {
    return Boolean(settings?.oanda_api_token);
  }
  if (provider === 'robinhood') {
    return Boolean(settings?.robinhood_username && settings?.robinhood_password);
  }
  return Boolean(settings?.alpaca_api_key && settings?.alpaca_secret_key);
}

function getModeForProvider(settings: ExecutionSettings | null, provider: 'alpaca' | 'oanda' | 'robinhood'): 'paper' | 'live' {
  if (provider === 'alpaca') {
    return String(settings?.alpaca_mode || 'paper').trim().toLowerCase() === 'live' ? 'live' : 'paper';
  }
  if (provider === 'oanda') {
    return String(settings?.oanda_environment || 'practice').trim().toLowerCase() === 'live' ? 'live' : 'paper';
  }
  return 'live';
}

function getProviderLabel(provider: 'alpaca' | 'oanda' | 'robinhood'): string {
  if (provider === 'oanda') return 'OANDA';
  if (provider === 'robinhood') return 'Robinhood';
  return 'Alpaca';
}

function mergeManualExternalPositionsIntoConnectedBrokers(
  connectedBrokers: Array<any>,
  settings: ExecutionSettings | null,
): Array<any> {
  const grouped = groupManualExternalPositionsByProvider();
  if (!grouped.size) return connectedBrokers;

  const merged = connectedBrokers.map((entry) => {
    const manual = grouped.get(entry.provider) || [];
    if (!manual.length) return entry;
    grouped.delete(entry.provider);
    return {
      ...entry,
      positions: [...(Array.isArray(entry.positions) ? entry.positions : []), ...manual],
    };
  });

  for (const [provider, positions] of grouped.entries()) {
    if (!providerSupportsManualExternal(provider)) continue;
    merged.push({
      provider,
      label: getProviderLabel(provider),
      configured: getConfiguredFlagForProvider(settings, provider),
      mode: getModeForProvider(settings, provider),
      capabilities: getManualExternalProviderCapabilities(provider),
      account: null,
      positions,
    } as EnrichedBrokerConnectionStatus);
  }

  return merged;
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = bridge.getBridgeStatus();
    const executionBrokerProvider = broker.getExecutionBrokerProvider();
    const currentSettings = loadSettings();
    const connectedBrokerStatuses = await broker.getConnectedBrokerStatuses();
    const robinhoodStatus = await getRobinhoodConnectedStatus({
      username: currentSettings?.robinhood_username,
      password: currentSettings?.robinhood_password,
      totp_secret: currentSettings?.robinhood_totp_secret,
      session_path: currentSettings?.robinhood_session_path,
    });
    const baseConnectedBrokerStatuses = robinhoodStatus
      ? [...connectedBrokerStatuses, robinhoodStatus]
      : connectedBrokerStatuses;
    const allConnectedBrokerStatuses = mergeManualExternalPositionsIntoConnectedBrokers(baseConnectedBrokerStatuses, currentSettings);
    const enriched = await enrichConnectedBrokerStatuses({
      executionBrokerProvider,
      config: status.config,
      state: status.state,
      connectedBrokers: allConnectedBrokerStatuses,
    });
    const executionBroker = enriched.connectedBrokers.find((entry) => entry.provider === executionBrokerProvider) || null;
    res.json({
      success: true,
      data: {
        ...status,
        execution_broker_provider: executionBrokerProvider,
        broker_provider: executionBrokerProvider,
        broker_capabilities: broker.getBrokerCapabilities(executionBrokerProvider),
        connected_brokers: enriched.connectedBrokers,
        default_import_strategy_version_id: enriched.defaultImportStrategyVersionId,
        account: executionBroker?.account || null,
        broker_positions: executionBroker?.positions || [],
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/start', async (req: Request, res: Response) => {
  try {
    const executionBrokerProvider = broker.getExecutionBrokerProvider();
    if (!broker.supportsAutomatedExecution(executionBrokerProvider)) {
      return res.status(400).json({
        success: false,
        error: `${broker.getBrokerLabel(executionBrokerProvider)} is connected in monitoring mode. Automated execution currently supports Alpaca only.`,
      });
    }

    const strategyVersionId = String(req.body?.strategy_version_id || '').trim();
    if (!strategyVersionId) {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' });
    }

    const config = {
      strategy_version_id: strategyVersionId,
      scan_cron: String(req.body?.scan_cron || process.env.EXECUTION_SCAN_CRON || '0 21 * * 1-5'),
      timezone: String(req.body?.timezone || process.env.EXECUTION_SCAN_TZ || 'America/New_York'),
      max_concurrent: Math.max(1, toNum(req.body?.max_concurrent, toNum(process.env.EXECUTION_MAX_CONCURRENT, 3))),
      risk_pct_per_trade: Math.min(0.05, Math.max(0.001, toNum(req.body?.risk_pct_per_trade, 0.01))),
      max_account_dd_pct: Math.min(90, Math.max(1, toNum(req.body?.max_account_dd_pct, toNum(process.env.EXECUTION_ACCOUNT_DD_KILL_PCT, 15)))),
      max_daily_loss_pct: Math.min(50, Math.max(0.5, toNum(req.body?.max_daily_loss_pct, 3))),
      monitor_interval_ms: Math.max(5000, toNum(req.body?.monitor_interval_ms, 60000)),
    };

    await bridge.startBridge(config);
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/stop', async (_req: Request, res: Response) => {
  try {
    await bridge.stopBridge();
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/kill', async (req: Request, res: Response) => {
  try {
    const reason = String(req.body?.reason || 'Manual kill switch activated via API');
    await bridge.manualKill(reason);
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/scan', async (_req: Request, res: Response) => {
  try {
    await bridge.triggerManualScan();
    res.json({ success: true, data: bridge.getBridgeStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/repair-exits', async (req: Request, res: Response) => {
  try {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : undefined;
    const result = await bridge.repairManagedPositionExits(symbol || undefined);
    res.json({ success: true, data: { ...bridge.getBridgeStatus(), repair: result } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/positions/managed/update-exits', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const stopPrice = toNum(req.body?.stop_price, 0);
    const takeProfitPrice = toNum(req.body?.take_profit_price, 0);

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }
    if (stopPrice <= 0 || takeProfitPrice <= 0) {
      return res.status(400).json({ success: false, error: 'stop_price and take_profit_price are required' });
    }

    const result = await bridge.updateManagedPositionExits(symbol, stopPrice, takeProfitPrice);
    res.json({
      success: true,
      data: {
        ...result,
        status: bridge.getBridgeStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/positions/protect', async (req: Request, res: Response) => {
  try {
    const provider = normalizeProvider(req.body?.provider || broker.getExecutionBrokerProvider());
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const side = String(req.body?.side || '').trim().toLowerCase() === 'short' ? 'short' : 'long';
    const stopPrice = toNum(req.body?.stop_price, 0);
    const takeProfitPrice = toNum(req.body?.take_profit_price, 0);

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }
    if (stopPrice <= 0 || takeProfitPrice <= 0) {
      return res.status(400).json({ success: false, error: 'stop_price and take_profit_price are required' });
    }

    const result = await broker.applyPositionProtectionForProvider({
      provider,
      symbol,
      side,
      stop_price: stopPrice,
      take_profit_price: takeProfitPrice,
    });

    logger.log({
      event: 'order_submitted',
      symbol,
      details: {
        provider,
        side,
        stop_price: stopPrice,
        take_profit_price: takeProfitPrice,
        trades_updated: result.trades_updated,
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/positions/close', async (req: Request, res: Response) => {
  try {
    const provider = normalizeProvider(req.body?.provider || broker.getExecutionBrokerProvider());
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const side = String(req.body?.side || '').trim().toLowerCase() === 'short' ? 'short' : 'long';
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }

    const result = await broker.closePositionForProvider(provider, symbol, side);
    logger.log({
      event: 'position_closed',
      symbol,
      details: {
        provider,
        side,
        order_id: result.id,
      },
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/orders/manual', async (req: Request, res: Response) => {
  try {
    const provider = normalizeProvider(req.body?.provider || broker.getExecutionBrokerProvider());
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const qty = Math.abs(Math.round(toNum(req.body?.qty, 0)));
    const side = String(req.body?.side || '').trim().toLowerCase() === 'sell' ? 'sell' : 'buy';
    const stopPrice = toNum(req.body?.stop_price, 0);
    const takeProfitPrice = toNum(req.body?.take_profit_price, 0);
    const limitPrice = toNum(req.body?.limit_price, 0);
    const type = String(req.body?.type || 'market').trim().toLowerCase() === 'limit' ? 'limit' : 'market';
    const clientOrderId = String(req.body?.client_order_id || `pd_manual_${symbol}_${Date.now()}`).trim();

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }
    if (qty <= 0) {
      return res.status(400).json({ success: false, error: 'qty must be > 0' });
    }
    if (stopPrice <= 0 || takeProfitPrice <= 0) {
      return res.status(400).json({ success: false, error: 'stop_price and take_profit_price are required' });
    }

    const result = await broker.submitOrderForProvider(provider, {
      symbol,
      qty,
      side,
      type: type as any,
      time_in_force: type === 'limit' ? 'gtc' : 'day',
      limit_price: type === 'limit' && limitPrice > 0 ? limitPrice : undefined,
      take_profit: { limit_price: takeProfitPrice },
      stop_loss: { stop_price: stopPrice },
      client_order_id: clientOrderId,
    });

    logger.log({
      event: 'order_submitted',
      symbol,
      details: {
        provider,
        side,
        qty,
        type,
        stop_price: stopPrice,
        take_profit_price: takeProfitPrice,
        order_id: result.id,
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const days = Math.max(1, Math.min(30, toNum(req.query.days, 7)));
    const logs = logger.getRecentLogs(days);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/logs/:date', async (req: Request, res: Response) => {
  try {
    const logs = logger.getLogForDate(req.params.date);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/account', async (_req: Request, res: Response) => {
  try {
    const account = await broker.getAccount();
    res.json({ success: true, data: account });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/positions', async (_req: Request, res: Response) => {
  try {
    const positions = await broker.getPositions();
    res.json({ success: true, data: positions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/settings', (_req: Request, res: Response) => {
  try {
    const settings = loadSettings();
    const executionProvider = broker.getExecutionBrokerProvider();
    const envKey = process.env.ALPACA_API_KEY || '';
    const envSecret = process.env.ALPACA_SECRET_KEY || '';
    const envOandaToken = process.env.OANDA_API_TOKEN || '';
    const envOandaAccountId = process.env.OANDA_ACCOUNT_ID || '';
    const envOandaEnvironment = normalizeOandaEnvironment(process.env.OANDA_ENVIRONMENT);
    const envRobinhoodUsername = process.env.ROBINHOOD_USERNAME || '';
    const envRobinhoodPassword = process.env.ROBINHOOD_PASSWORD || '';
    const envRobinhoodTotpSecret = process.env.ROBINHOOD_TOTP_SECRET || '';
    const envRobinhoodSessionPath = process.env.ROBINHOOD_SESSION_PATH || '';
    const alpacaConfigured = Boolean(settings?.alpaca_api_key && settings?.alpaca_secret_key) || Boolean(envKey && envSecret);
    const oandaConfigured = Boolean(settings?.oanda_api_token) || Boolean(envOandaToken);
    const robinhoodConfigured = Boolean(
      (settings?.robinhood_username && settings?.robinhood_password)
      || (envRobinhoodUsername && envRobinhoodPassword),
    );
    const hasSavedConfig = Boolean(
      settings?.alpaca_api_key
      || settings?.oanda_api_token
      || settings?.robinhood_username
      || settings?.robinhood_password,
    );
    const hasEnvConfig = Boolean(
      envKey
      || envOandaToken
      || envRobinhoodUsername
      || envRobinhoodPassword,
    );

    res.json({
      success: true,
      data: {
        execution_broker_provider: executionProvider,
        alpaca_api_key: maskKey(settings?.alpaca_api_key || envKey),
        alpaca_secret_key: maskKey(settings?.alpaca_secret_key || envSecret),
        alpaca_base_url: settings?.alpaca_base_url || process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
        alpaca_mode: settings?.alpaca_mode || process.env.ALPACA_MODE || 'paper',
        alpaca_configured: alpacaConfigured,
        oanda_api_token: maskKey(settings?.oanda_api_token || envOandaToken),
        oanda_account_id: settings?.oanda_account_id || envOandaAccountId || '',
        oanda_environment: settings?.oanda_environment || envOandaEnvironment,
        oanda_base_url: settings?.oanda_base_url || process.env.OANDA_BASE_URL || '',
        oanda_configured: oandaConfigured,
        robinhood_username: maskKey(settings?.robinhood_username || envRobinhoodUsername),
        robinhood_password: maskKey(settings?.robinhood_password || envRobinhoodPassword),
        robinhood_totp_secret: maskKey(settings?.robinhood_totp_secret || envRobinhoodTotpSecret),
        robinhood_session_path: settings?.robinhood_session_path || envRobinhoodSessionPath || '',
        robinhood_configured: robinhoodConfigured,
        source: hasSavedConfig ? 'saved' : (hasEnvConfig ? 'env' : 'none'),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings', async (req: Request, res: Response) => {
  try {
    const current = loadSettings() || {};
    const {
      execution_broker_provider,
      alpaca_api_key,
      alpaca_secret_key,
      alpaca_base_url,
      alpaca_mode,
      oanda_api_token,
      oanda_account_id,
      oanda_environment,
      oanda_base_url,
      robinhood_username,
      robinhood_password,
      robinhood_totp_secret,
      robinhood_session_path,
    } = req.body || {};

    const provider = normalizeProvider(execution_broker_provider || current.execution_broker_provider || 'alpaca');
    const nextAlpacaKey = String(alpaca_api_key || '').trim() || current.alpaca_api_key || '';
    const nextAlpacaSecret = String(alpaca_secret_key || '').trim() || current.alpaca_secret_key || '';
    const nextOandaToken = String(oanda_api_token || '').trim() || current.oanda_api_token || '';
    const nextRobinhoodUsername = String(robinhood_username || '').trim() || current.robinhood_username || '';
    const nextRobinhoodPassword = String(robinhood_password || '').trim() || current.robinhood_password || '';
    const nextRobinhoodTotpSecret = String(robinhood_totp_secret || '').trim() || current.robinhood_totp_secret || '';

    if (provider === 'alpaca' && (!nextAlpacaKey || !nextAlpacaSecret)) {
      return res.status(400).json({ success: false, error: 'Alpaca API Key and Secret Key are required' });
    }
    if (provider === 'oanda' && !nextOandaToken) {
      return res.status(400).json({ success: false, error: 'OANDA API token is required' });
    }
    if ((nextRobinhoodUsername && !nextRobinhoodPassword) || (!nextRobinhoodUsername && nextRobinhoodPassword)) {
      return res.status(400).json({ success: false, error: 'Robinhood username and password must be saved together.' });
    }

    const settings: ExecutionSettings = {
      ...current,
      execution_broker_provider: provider,
      broker_provider: current.broker_provider,
      alpaca_api_key: nextAlpacaKey || undefined,
      alpaca_secret_key: nextAlpacaSecret || undefined,
      alpaca_base_url: String(alpaca_base_url || current.alpaca_base_url || 'https://paper-api.alpaca.markets').trim(),
      alpaca_mode: alpaca_mode === 'live' ? 'live' : (current.alpaca_mode || 'paper'),
      oanda_api_token: nextOandaToken || undefined,
      oanda_account_id: String(oanda_account_id || current.oanda_account_id || '').trim() || undefined,
      oanda_environment: normalizeOandaEnvironment(oanda_environment || current.oanda_environment),
      oanda_base_url: String(oanda_base_url || current.oanda_base_url || '').trim() || undefined,
      robinhood_username: nextRobinhoodUsername || undefined,
      robinhood_password: nextRobinhoodPassword || undefined,
      robinhood_totp_secret: nextRobinhoodTotpSecret || undefined,
      robinhood_session_path: String(robinhood_session_path || current.robinhood_session_path || '').trim() || undefined,
    };

    saveSettings(settings);
    clearRobinhoodConnectedStatusCache();
    broker.resetClient();
    if (provider !== 'alpaca') {
      await bridge.stopBridge().catch(() => {
        // ignore
      });
    }

    res.json({
      success: true,
      data: {
        execution_broker_provider: provider,
        alpaca_api_key: maskKey(settings.alpaca_api_key || ''),
        alpaca_secret_key: maskKey(settings.alpaca_secret_key || ''),
        alpaca_base_url: settings.alpaca_base_url,
        alpaca_mode: settings.alpaca_mode,
        alpaca_configured: Boolean(settings.alpaca_api_key && settings.alpaca_secret_key),
        oanda_api_token: maskKey(settings.oanda_api_token || ''),
        oanda_account_id: settings.oanda_account_id || '',
        oanda_environment: settings.oanda_environment || 'practice',
        oanda_base_url: settings.oanda_base_url || '',
        oanda_configured: Boolean(settings.oanda_api_token),
        robinhood_username: maskKey(settings.robinhood_username || ''),
        robinhood_password: maskKey(settings.robinhood_password || ''),
        robinhood_totp_secret: maskKey(settings.robinhood_totp_secret || ''),
        robinhood_session_path: settings.robinhood_session_path || '',
        robinhood_configured: Boolean(settings.robinhood_username && settings.robinhood_password),
        source: 'saved',
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings/test', async (req: Request, res: Response) => {
  try {
    const provider = normalizeTestProvider(req.body?.provider || broker.getExecutionBrokerProvider());
    const current = loadSettings() || {};

    if (provider === 'robinhood') {
      const snapshot = await probeRobinhoodPositions({
        username: req.body?.robinhood_username || current.robinhood_username,
        password: req.body?.robinhood_password || current.robinhood_password,
        totpSecret: req.body?.robinhood_totp_secret || current.robinhood_totp_secret,
        mfaCode: req.body?.robinhood_mfa_code,
        sessionPath: req.body?.robinhood_session_path || current.robinhood_session_path,
      });
      return res.json({
        success: true,
        data: {
          connected: true,
          broker_provider: 'robinhood',
          mode: 'read_only',
          stocks: snapshot.counts.stocks,
          options: snapshot.counts.options,
          total_positions: snapshot.counts.stocks + snapshot.counts.options,
        },
      });
    }

    const account = await broker.getAccount(provider);
    res.json({
      success: true,
      data: {
        connected: true,
        broker_provider: provider,
        account_id: account.id,
        equity: account.equity,
        mode: broker.isPaperMode(provider) ? 'paper' : 'live',
      },
    });
  } catch (err: any) {
    res.json({
      success: false,
      data: { connected: false },
      error: err?.message || String(err),
    });
  }
});

router.post('/robinhood/login/start', async (req: Request, res: Response) => {
  try {
    clearRobinhoodConnectedStatusCache();
    const data = await startRobinhoodLogin(getRobinhoodConfigFromRequest(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/robinhood/login/status', async (req: Request, res: Response) => {
  try {
    clearRobinhoodConnectedStatusCache();
    const data = await getRobinhoodLoginStatus(getRobinhoodConfigFromRequest(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/robinhood/login/verify', async (req: Request, res: Response) => {
  try {
    clearRobinhoodConnectedStatusCache();
    const data = await verifyRobinhoodLoginCode(getRobinhoodConfigFromRequest(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/robinhood/positions', async (req: Request, res: Response) => {
  try {
    clearRobinhoodConnectedStatusCache();
    const data = await fetchRobinhoodPositions(getRobinhoodConfigFromRequest(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/external-positions', async (req: Request, res: Response) => {
  try {
    const record = createManualExternalPosition({
      provider: req.body?.provider,
      symbol: req.body?.symbol,
      display_symbol: req.body?.display_symbol,
      instrument_type: req.body?.instrument_type,
      side: req.body?.side,
      qty: req.body?.qty,
      avg_entry_price: req.body?.avg_entry_price,
      current_price: req.body?.current_price,
      stop_price: req.body?.stop_price,
      take_profit_price: req.body?.take_profit_price,
      contract_multiplier: req.body?.contract_multiplier,
      option_type: req.body?.option_type,
      expiration_date: req.body?.expiration_date,
      strike_price: req.body?.strike_price,
      external_position_id: req.body?.external_position_id,
      strategy_version_id: req.body?.strategy_version_id,
      strategy_name: req.body?.strategy_name,
      import_reason: req.body?.import_reason,
    });
    logger.log({
      event: 'external_position_adopted',
      symbol: record.symbol,
      details: {
        provider: record.provider,
        instrument_type: record.instrument_type,
        qty: record.qty,
        side: record.side,
        manual_external_id: record.id,
      },
    });
    res.json({ success: true, data: mapManualExternalPositionRecord(record) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.patch('/external-positions/:id', async (req: Request, res: Response) => {
  try {
    const record = updateManualExternalPosition(req.params.id, {
      provider: req.body?.provider,
      symbol: req.body?.symbol,
      display_symbol: req.body?.display_symbol,
      instrument_type: req.body?.instrument_type,
      side: req.body?.side,
      qty: req.body?.qty,
      avg_entry_price: req.body?.avg_entry_price,
      current_price: req.body?.current_price,
      stop_price: req.body?.stop_price,
      take_profit_price: req.body?.take_profit_price,
      contract_multiplier: req.body?.contract_multiplier,
      option_type: req.body?.option_type,
      expiration_date: req.body?.expiration_date,
      strike_price: req.body?.strike_price,
      external_position_id: req.body?.external_position_id,
      strategy_version_id: req.body?.strategy_version_id,
      strategy_name: req.body?.strategy_name,
      import_reason: req.body?.import_reason,
    });
    logger.log({
      event: 'external_position_updated',
      symbol: record.symbol,
      details: {
        provider: record.provider,
        instrument_type: record.instrument_type,
        manual_external_id: record.id,
      },
    });
    res.json({ success: true, data: mapManualExternalPositionRecord(record) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.delete('/external-positions/:id', async (req: Request, res: Response) => {
  try {
    const existing = getManualExternalPositionRecord(req.params.id);
    const deleted = deleteManualExternalPosition(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'external position not found' });
    }
    logger.log({
      event: 'external_position_removed',
      symbol: existing?.symbol,
      details: {
        provider: existing?.provider,
        instrument_type: existing?.instrument_type,
        manual_external_id: req.params.id,
      },
    });
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
