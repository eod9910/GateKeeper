(function () {
  var STORAGE_KEY = 'tradingDeskExecutionIntentV1';
  var MAX_AGE_MS = 12 * 60 * 60 * 1000;

  function asFiniteNumber(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function normalizeOrderType(value) {
    return String(value || '').trim().toLowerCase() === 'limit' ? 'limit' : 'market';
  }

  function normalizeDirection(value) {
    return String(value || '').trim().toUpperCase() === 'SHORT' || Number(value) === -1 ? 'SHORT' : 'LONG';
  }

  function normalizeBrokerProvider(value, instrumentType) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'oanda' || raw === 'robinhood' || raw === 'alpaca') return raw;

    var kind = String(instrumentType || '').trim().toLowerCase();
    if (kind === 'forex') return 'oanda';
    if (kind === 'stock' || kind === 'options' || kind === 'futures' || kind === 'crypto') return 'robinhood';
    return 'alpaca';
  }

  function normalizeIntent(input) {
    if (!input || typeof input !== 'object') return null;
    var tradeDraft = input.tradeDraft && typeof input.tradeDraft === 'object' ? input.tradeDraft : null;
    var symbol = String(input.symbol || tradeDraft && tradeDraft.symbol || '').trim().toUpperCase();
    if (!symbol) return null;

    var instrumentType = String(input.instrumentType || tradeDraft && tradeDraft.instrumentType || 'stock').trim().toLowerCase();

    return {
      id: String(input.id || ('intent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))),
      tradePlanId: String(input.tradePlanId || tradeDraft && tradeDraft.trade_plan_id || '').trim() || null,
      version: 1,
      source: String(input.source || 'trading_desk'),
      createdAt: input.createdAt || new Date().toISOString(),
      symbol: symbol,
      instrumentType: instrumentType,
      brokerProvider: normalizeBrokerProvider(input.brokerProvider || tradeDraft && tradeDraft.broker_provider, instrumentType),
      direction: normalizeDirection(input.direction || tradeDraft && tradeDraft.direction),
      orderType: normalizeOrderType(input.orderType || tradeDraft && tradeDraft.orderType),
      limitPrice: asFiniteNumber(input.limitPrice != null ? input.limitPrice : tradeDraft && tradeDraft.limitPrice),
      entryPrice: asFiniteNumber(input.entryPrice != null ? input.entryPrice : tradeDraft && tradeDraft.plannedEntry),
      stopPrice: asFiniteNumber(input.stopPrice != null ? input.stopPrice : tradeDraft && (tradeDraft.currentStop || tradeDraft.plannedStop)),
      takeProfitPrice: asFiniteNumber(input.takeProfitPrice != null ? input.takeProfitPrice : tradeDraft && tradeDraft.plannedTarget),
      units: asFiniteNumber(input.units != null ? input.units : tradeDraft && (tradeDraft.actualShares || tradeDraft.plannedShares)),
      strategyVersionId: String(input.strategyVersionId || tradeDraft && tradeDraft.strategy_version_id || '').trim() || null,
      riskTemplateId: String(input.riskTemplateId || tradeDraft && tradeDraft.risk_template_id || '').trim() || null,
      riskTemplateName: String(input.riskTemplateName || tradeDraft && tradeDraft.risk_template_name || '').trim() || null,
      scannerHandoff: input.scannerHandoff || tradeDraft && tradeDraft.scanner_handoff || null,
      copilotAnalysis: input.copilotAnalysis || tradeDraft && tradeDraft.copilot_analysis || null,
      tradeDraft: tradeDraft ? { ...tradeDraft } : null,
    };
  }

  function readIntent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var activePlan = window.TradePlanStore?.getActivePlan ? window.TradePlanStore.getActivePlan() : null;
        return window.TradePlanStore?.toExecutionIntent ? window.TradePlanStore.toExecutionIntent(activePlan) : null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : NaN;
      if (Number.isFinite(createdAt) && (Date.now() - createdAt) > MAX_AGE_MS) {
        localStorage.removeItem(STORAGE_KEY);
        var fallbackPlan = window.TradePlanStore?.getActivePlan ? window.TradePlanStore.getActivePlan() : null;
        return window.TradePlanStore?.toExecutionIntent ? window.TradePlanStore.toExecutionIntent(fallbackPlan) : null;
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to read execution intent:', error);
      return null;
    }
  }

  function writeIntent(input) {
    var intent = normalizeIntent(input);
    if (!intent) return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    if (window.TradePlanStore?.fromExecutionIntent && window.TradePlanStore?.upsertActivePlan) {
      var plan = window.TradePlanStore.fromExecutionIntent(intent);
      if (plan) {
        window.TradePlanStore.upsertActivePlan(plan, { reason: 'execution-intent-write' });
      }
    }
    return intent;
  }

  function clearIntent() {
    localStorage.removeItem(STORAGE_KEY);
    if (window.TradePlanStore?.clearExecutionIntent) {
      window.TradePlanStore.clearExecutionIntent();
    }
  }

  function describeIntent(intent) {
    if (!intent) return 'No pending trade intent.';
    var parts = [intent.symbol];
    if (intent.brokerProvider) parts.push(String(intent.brokerProvider).toUpperCase());
    if (intent.direction) parts.push(intent.direction);
    if (intent.riskTemplateName) parts.push(intent.riskTemplateName);
    if (intent.entryPrice != null) parts.push('Entry ' + intent.entryPrice.toFixed(2));
    return parts.join(' · ');
  }

  window.TradingDeskExecutionIntent = {
    STORAGE_KEY: STORAGE_KEY,
    read: readIntent,
    write: writeIntent,
    clear: clearIntent,
    normalize: normalizeIntent,
    describe: describeIntent,
  };
})();
