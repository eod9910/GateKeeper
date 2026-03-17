(function initExecutionDeskCore(global) {
  function providerLabel(provider) {
    const normalized = String(provider || 'alpaca').toLowerCase();
    if (normalized === 'oanda') return 'OANDA';
    if (normalized === 'robinhood') return 'Robinhood';
    return 'Alpaca';
  }

  function normalizeBrokerProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    if (normalized === 'oanda' || normalized === 'robinhood') return normalized;
    return 'alpaca';
  }

  function brokerSupportsExecution(provider) {
    const normalized = normalizeBrokerProvider(provider);
    return normalized === 'alpaca' || normalized === 'oanda';
  }

  function getConfiguredFlag(settings, provider) {
    const normalized = normalizeBrokerProvider(provider);
    if (normalized === 'oanda') return !!settings?.oanda_configured;
    if (normalized === 'robinhood') return !!settings?.robinhood_configured;
    return !!settings?.alpaca_configured;
  }

  function getBrokerSavedMode(provider, settings) {
    const normalized = normalizeBrokerProvider(provider);
    if (normalized === 'oanda') {
      return String(settings?.oanda_environment || 'practice').toLowerCase() === 'live' ? 'live' : 'paper';
    }
    if (normalized === 'robinhood') return 'read_only';
    return String(settings?.alpaca_mode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
  }

  function getExecutionProvider(state) {
    return normalizeBrokerProvider(state?.settings?.execution_broker_provider || state?.status?.execution_broker_provider || 'alpaca');
  }

  function readSharedCopilotSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem('copilotSettings') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function getExecutionRulesFromSharedSettings(state) {
    const settings = readSharedCopilotSettings();
    if (state && typeof state === 'object') {
      state.sharedSettings = settings;
    }
    const maxConcurrent = Math.max(1, Number(settings.executionMaxConcurrent || settings.maxOpenPositions || 3) || 3);
    const riskPercent = Math.max(0.1, Number(settings.riskPercent || 1) || 1);
    const maxDrawdown = Math.max(1, Number(settings.maxDrawdown || 10) || 10);
    const dailyLoss = Math.max(0.5, Number(settings.dailyLossLimit || 5) || 5);
    return {
      maxConcurrent,
      riskPercent,
      maxDrawdown,
      dailyLoss,
    };
  }

  function renderBridgeRulesSummary(activeConfig, state) {
    const settingsRules = getExecutionRulesFromSharedSettings(state);
    const displayRules = activeConfig && typeof activeConfig === 'object'
      ? {
          maxConcurrent: Number(activeConfig.max_concurrent || settingsRules.maxConcurrent),
          riskPercent: Number(activeConfig.risk_pct_per_trade || (settingsRules.riskPercent / 100)) * 100,
          maxDrawdown: Number(activeConfig.max_account_dd_pct || settingsRules.maxDrawdown),
          dailyLoss: Number(activeConfig.max_daily_loss_pct || settingsRules.dailyLoss),
        }
      : settingsRules;
    document.getElementById('bridge-rule-max-concurrent').textContent = String(displayRules.maxConcurrent);
    document.getElementById('bridge-rule-risk').textContent = `${Number(displayRules.riskPercent).toFixed(2)}%`;
    document.getElementById('bridge-rule-dd').textContent = `${Number(displayRules.maxDrawdown).toFixed(2)}%`;
    document.getElementById('bridge-rule-daily').textContent = `${Number(displayRules.dailyLoss).toFixed(2)}%`;
    document.getElementById('bridge-rule-source').textContent = activeConfig ? 'Active bridge / Settings' : 'Settings';
  }

  function normalizeIntentBrokerProvider(value, instrumentType) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'alpaca' || raw === 'oanda' || raw === 'robinhood') return raw;
    if (String(instrumentType || '').trim().toLowerCase() === 'forex') return 'oanda';
    return 'robinhood';
  }

  function normalizeExecutionIntent(rawIntent) {
    if (!rawIntent || typeof rawIntent !== 'object') return null;
    if (!rawIntent.symbol) return null;
    return {
      ...rawIntent,
      brokerProvider: normalizeIntentBrokerProvider(rawIntent.brokerProvider, rawIntent.instrumentType),
    };
  }

  function fmtMoney(v) {
    if (v == null || Number.isNaN(Number(v))) return '--';
    return '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtPct(v) {
    if (v == null || Number.isNaN(Number(v))) return '--';
    return Number(v).toFixed(2) + '%';
  }

  function fmtIntentPrice(value, intent) {
    if (value == null || Number.isNaN(Number(value))) return '--';
    const instrumentType = String(intent?.instrumentType || '').trim().toLowerCase();
    const symbol = String(intent?.symbol || '').trim().toUpperCase();
    let precision = 2;
    if (instrumentType === 'forex') {
      precision = /JPY(?:=X)?$/i.test(symbol) ? 3 : 5;
    } else if (instrumentType === 'crypto') {
      precision = Number(value) >= 100 ? 2 : 4;
    }
    return '$' + Number(value).toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  function roundPriceInput(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100000) / 100000 : NaN;
  }

  function asIso(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
      const msg = body && body.error ? body.error : ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return body.data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.ExecutionDeskCore = {
    api,
    asIso,
    brokerSupportsExecution,
    escapeHtml,
    fmtIntentPrice,
    fmtMoney,
    fmtPct,
    getBrokerSavedMode,
    getConfiguredFlag,
    getExecutionProvider,
    getExecutionRulesFromSharedSettings,
    normalizeBrokerProvider,
    normalizeExecutionIntent,
    normalizeIntentBrokerProvider,
    providerLabel,
    readSharedCopilotSettings,
    renderBridgeRulesSummary,
    roundPriceInput,
  };
})(window);
