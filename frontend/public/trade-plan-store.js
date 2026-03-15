(function () {
  var STORAGE_KEY = 'tradePlanStoreV1';
  var CHANNEL_NAME = 'tradePlanStoreChannelV1';
  var TAB_ID = 'trade-plan-tab-' + Math.random().toString(36).slice(2, 10);
  var listeners = [];
  var channel = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function cloneValue(value) {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  function asFiniteNumber(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function normalizeSymbol(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizeInterval(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    var upper = raw.toUpperCase();
    if (upper === 'W' || upper === '1W' || upper === '1WK') return '1wk';
    if (upper === 'D' || upper === '1D') return '1d';
    if (upper === 'M' || upper === '1M' || upper === '1MO') return '1mo';
    if (upper === '4H') return '4h';
    if (upper === '1H' || upper === 'H') return '1h';
    if (upper === '15M' || upper === '15MIN') return '15m';
    if (upper === '5M' || upper === '5MIN') return '5m';
    if (upper === '1MIN' || upper === '1M') return '1m';
    return raw;
  }

  function normalizeInstrumentType(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'futures' || normalized === 'options' || normalized === 'forex' || normalized === 'crypto') {
      return normalized;
    }
    return 'stock';
  }

  function normalizeSide(value) {
    var raw = String(value || '').trim().toUpperCase();
    if (raw === 'SHORT' || Number(value) === -1) return 'SHORT';
    if (raw === 'LONG' || Number(value) === 1) return 'LONG';
    return null;
  }

  function normalizeBrokerProvider(value, instrumentType) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'alpaca' || raw === 'oanda' || raw === 'robinhood') return raw;
    var kind = normalizeInstrumentType(instrumentType);
    if (kind === 'forex') return 'oanda';
    if (kind === 'futures' || kind === 'options' || kind === 'crypto' || kind === 'stock') return 'robinhood';
    return 'alpaca';
  }

  function normalizeOrderType(value) {
    return String(value || '').trim().toLowerCase() === 'limit' ? 'limit' : 'market';
  }

  function normalizeStatus(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'draft';
    return raw;
  }

  function generatePlanId() {
    return 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function normalizePlan(input, existing) {
    var source = input && typeof input === 'object' ? input : {};
    var prev = existing && typeof existing === 'object' ? existing : {};
    var instrumentType = normalizeInstrumentType(source.instrumentType != null ? source.instrumentType : prev.instrumentType);
    var planId = String(source.id || prev.id || generatePlanId());
    var symbol = normalizeSymbol(source.symbol || prev.symbol || '');
    return {
      id: planId,
      version: 1,
      createdAt: prev.createdAt || source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso(),
      source: String(source.source || prev.source || 'trading_desk'),
      status: normalizeStatus(source.status != null ? source.status : prev.status),
      symbol: symbol,
      interval: normalizeInterval(source.interval != null ? source.interval : prev.interval),
      timeframe: source.timeframe != null ? source.timeframe : (prev.timeframe != null ? prev.timeframe : null),
      instrumentType: instrumentType,
      side: normalizeSide(source.side != null ? source.side : prev.side),
      brokerProvider: normalizeBrokerProvider(
        source.brokerProvider != null ? source.brokerProvider : prev.brokerProvider,
        instrumentType
      ),
      orderType: normalizeOrderType(source.orderType != null ? source.orderType : prev.orderType),
      limitPrice: asFiniteNumber(source.limitPrice != null ? source.limitPrice : prev.limitPrice),
      entryPrice: asFiniteNumber(source.entryPrice != null ? source.entryPrice : prev.entryPrice),
      stopPrice: asFiniteNumber(source.stopPrice != null ? source.stopPrice : prev.stopPrice),
      takeProfitPrice: asFiniteNumber(source.takeProfitPrice != null ? source.takeProfitPrice : prev.takeProfitPrice),
      units: asFiniteNumber(source.units != null ? source.units : prev.units),
      strategyVersionId: source.strategyVersionId != null ? String(source.strategyVersionId || '').trim() || null : (prev.strategyVersionId || null),
      riskTemplateId: source.riskTemplateId != null ? String(source.riskTemplateId || '').trim() || null : (prev.riskTemplateId || null),
      riskTemplateName: source.riskTemplateName != null ? String(source.riskTemplateName || '').trim() || null : (prev.riskTemplateName || null),
      scannerPacketId: source.scannerPacketId != null ? String(source.scannerPacketId || '').trim() || null : (prev.scannerPacketId || null),
      executionIntentId: source.executionIntentId != null ? String(source.executionIntentId || '').trim() || null : (prev.executionIntentId || null),
      scannerHandoff: source.scannerHandoff !== undefined ? cloneValue(source.scannerHandoff) : cloneValue(prev.scannerHandoff),
      scannerCandidate: source.scannerCandidate !== undefined ? cloneValue(source.scannerCandidate) : cloneValue(prev.scannerCandidate),
      fundamentals: source.fundamentals !== undefined ? cloneValue(source.fundamentals) : cloneValue(prev.fundamentals),
      scannerAIAnalysis: source.scannerAIAnalysis !== undefined ? cloneValue(source.scannerAIAnalysis) : cloneValue(prev.scannerAIAnalysis),
      copilotAnalysis: source.copilotAnalysis !== undefined ? cloneValue(source.copilotAnalysis) : cloneValue(prev.copilotAnalysis),
      tradeDraft: source.tradeDraft !== undefined ? cloneValue(source.tradeDraft) : cloneValue(prev.tradeDraft),
      executionIntent: source.executionIntent !== undefined ? cloneValue(source.executionIntent) : cloneValue(prev.executionIntent),
      settingsSnapshot: source.settingsSnapshot !== undefined ? cloneValue(source.settingsSnapshot) : cloneValue(prev.settingsSnapshot),
      savedTradeId: source.savedTradeId !== undefined ? source.savedTradeId : (prev.savedTradeId !== undefined ? prev.savedTradeId : null),
      lastUpdatedBy: source.lastUpdatedBy != null ? String(source.lastUpdatedBy || '').trim() || null : (prev.lastUpdatedBy || null),
    };
  }

  function sanitizeState(input) {
    var raw = input && typeof input === 'object' ? input : {};
    var plansById = {};
    var sourcePlans = raw.plansById && typeof raw.plansById === 'object' ? raw.plansById : {};
    Object.keys(sourcePlans).forEach(function (key) {
      var plan = normalizePlan(sourcePlans[key], sourcePlans[key]);
      if (plan.symbol) {
        plansById[plan.id] = plan;
      }
    });

    var activePlanId = raw.activePlanId && plansById[raw.activePlanId] ? raw.activePlanId : null;
    if (!activePlanId) {
      var ids = Object.keys(plansById);
      if (ids.length) activePlanId = ids[ids.length - 1];
    }

    return {
      version: 1,
      activePlanId: activePlanId,
      plansById: plansById,
    };
  }

  function readStateFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return sanitizeState(null);
      return sanitizeState(JSON.parse(raw));
    } catch (_error) {
      return sanitizeState(null);
    }
  }

  var state = readStateFromStorage();

  function broadcastState(meta) {
    if (!channel) return;
    try {
      channel.postMessage({
        type: 'trade-plan-state',
        origin: TAB_ID,
        state: state,
        meta: meta || null,
      });
    } catch (_error) {}
  }

  function emitChange(meta) {
    var activePlan = getActivePlan();
    listeners.slice().forEach(function (listener) {
      try {
        listener(activePlan, state, meta || null);
      } catch (error) {
        console.warn('TradePlanStore listener failed:', error);
      }
    });
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('tradeplan:change', {
        detail: {
          activePlan: activePlan,
          state: state,
          meta: meta || null,
        },
      }));
    }
  }

  function writeState(nextState, meta) {
    state = sanitizeState(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    emitChange(meta);
    broadcastState(meta);
    return state;
  }

  function getState() {
    return sanitizeState(state);
  }

  function getPlan(planId) {
    if (!planId) return null;
    return state.plansById[String(planId)] || null;
  }

  function getActivePlan() {
    return state.activePlanId ? (state.plansById[state.activePlanId] || null) : null;
  }

  function setActivePlan(planId, meta) {
    var normalizedId = String(planId || '').trim();
    if (!normalizedId || !state.plansById[normalizedId]) return null;
    writeState({
      version: 1,
      activePlanId: normalizedId,
      plansById: state.plansById,
    }, {
      type: 'set-active-plan',
      planId: normalizedId,
      reason: meta && meta.reason ? meta.reason : null,
    });
    return getActivePlan();
  }

  function upsertPlan(planInput, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var incoming = planInput && typeof planInput === 'object' ? planInput : {};
    var planId = String(incoming.id || (opts.activate ? (state.activePlanId || generatePlanId()) : generatePlanId()));
    var existing = state.plansById[planId] || null;
    var normalized = normalizePlan({ ...incoming, id: planId }, existing);
    if (!normalized.symbol) return null;
    var plansById = { ...state.plansById, [planId]: normalized };
    writeState({
      version: 1,
      activePlanId: opts.activate === false ? state.activePlanId : planId,
      plansById: plansById,
    }, {
      type: existing ? 'update-plan' : 'create-plan',
      planId: planId,
      reason: opts.reason || null,
    });
    return normalized;
  }

  function upsertActivePlan(planInput, options) {
    var active = getActivePlan();
    var incoming = planInput && typeof planInput === 'object' ? planInput : {};
    return upsertPlan({
      ...(active || {}),
      ...incoming,
      id: incoming.id || (active && active.id) || null,
    }, {
      ...(options || {}),
      activate: true,
    });
  }

  function patchActivePlan(patch, options) {
    var active = getActivePlan();
    if (!active && !(patch && patch.symbol)) return null;
    return upsertActivePlan({
      ...(active || {}),
      ...(patch || {}),
    }, options);
  }

  function clearActivePlan(meta) {
    var active = getActivePlan();
    if (!active) return null;
    var plansById = { ...state.plansById };
    delete plansById[active.id];
    writeState({
      version: 1,
      activePlanId: null,
      plansById: plansById,
    }, {
      type: 'clear-active-plan',
      planId: active.id,
      reason: meta && meta.reason ? meta.reason : null,
    });
    return active;
  }

  function clearExecutionIntent(intentId) {
    var active = getActivePlan();
    if (!active) return null;
    if (intentId && active.executionIntentId && String(active.executionIntentId) !== String(intentId)) {
      return active;
    }
    return patchActivePlan({
      status: active.entryPrice || active.stopPrice || active.takeProfitPrice ? 'desk_draft' : active.status,
      executionIntentId: null,
      executionIntent: null,
    }, {
      reason: 'execution-intent-cleared',
    });
  }

  function subscribe(listener, options) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    var opts = options && typeof options === 'object' ? options : {};
    if (opts.immediate !== false) {
      listener(getActivePlan(), state, { type: 'subscribe' });
    }
    return function unsubscribe() {
      listeners = listeners.filter(function (entry) { return entry !== listener; });
    };
  }

  function fromScannerPacket(packet) {
    if (!packet || typeof packet !== 'object') return null;
    var candidate = packet.candidate && typeof packet.candidate === 'object' ? packet.candidate : {};
    var analysis = packet.scannerAIAnalysis && typeof packet.scannerAIAnalysis === 'object' ? packet.scannerAIAnalysis : {};
    var levels = analysis.levels && typeof analysis.levels === 'object' ? analysis.levels : {};
    var symbol = normalizeSymbol(packet.symbol || candidate.symbol || '');
    if (!symbol) return null;
    return {
      source: 'scanner',
      status: 'scanner_handoff',
      symbol: symbol,
      interval: packet.interval || candidate.interval || candidate.timeframe || null,
      timeframe: packet.timeframe || candidate.timeframe || null,
      strategyVersionId: candidate.strategy_version_id || null,
      entryPrice: asFiniteNumber(levels.suggestedEntry),
      stopPrice: asFiniteNumber(levels.suggestedStop),
      takeProfitPrice: asFiniteNumber(levels.suggestedTarget),
      scannerPacketId: packet.id || null,
      scannerHandoff: packet,
      scannerCandidate: candidate,
      fundamentals: packet.fundamentals || null,
      scannerAIAnalysis: packet.scannerAIAnalysis || null,
      lastUpdatedBy: 'scanner',
    };
  }

  function fromExecutionIntent(intent) {
    if (!intent || typeof intent !== 'object') return null;
    var active = getActivePlan();
    var tradeDraft = intent.tradeDraft && typeof intent.tradeDraft === 'object' ? intent.tradeDraft : {};
    var instrumentType = intent.instrumentType || tradeDraft.instrumentType || active && active.instrumentType || 'stock';
    var symbol = normalizeSymbol(intent.symbol || tradeDraft.symbol || active && active.symbol || '');
    if (!symbol) return null;
    return {
      id: intent.tradePlanId || (active && active.id) || null,
      source: String(intent.source || (active && active.source) || 'trading_desk'),
      status: 'execution_staged',
      symbol: symbol,
      interval: active && active.interval || null,
      timeframe: active && active.timeframe || null,
      instrumentType: instrumentType,
      side: normalizeSide(intent.direction || tradeDraft.direction || active && active.side),
      brokerProvider: normalizeBrokerProvider(intent.brokerProvider || tradeDraft.broker_provider || active && active.brokerProvider, instrumentType),
      orderType: normalizeOrderType(intent.orderType || tradeDraft.orderType || active && active.orderType),
      limitPrice: asFiniteNumber(intent.limitPrice != null ? intent.limitPrice : tradeDraft.limitPrice),
      entryPrice: asFiniteNumber(intent.entryPrice != null ? intent.entryPrice : tradeDraft.plannedEntry),
      stopPrice: asFiniteNumber(intent.stopPrice != null ? intent.stopPrice : (tradeDraft.currentStop != null ? tradeDraft.currentStop : tradeDraft.plannedStop)),
      takeProfitPrice: asFiniteNumber(intent.takeProfitPrice != null ? intent.takeProfitPrice : tradeDraft.plannedTarget),
      units: asFiniteNumber(intent.units != null ? intent.units : (tradeDraft.actualShares != null ? tradeDraft.actualShares : tradeDraft.plannedShares)),
      strategyVersionId: intent.strategyVersionId || tradeDraft.strategy_version_id || active && active.strategyVersionId || null,
      riskTemplateId: intent.riskTemplateId || tradeDraft.risk_template_id || active && active.riskTemplateId || null,
      riskTemplateName: intent.riskTemplateName || tradeDraft.risk_template_name || active && active.riskTemplateName || null,
      scannerHandoff: intent.scannerHandoff !== undefined ? intent.scannerHandoff : (active && active.scannerHandoff) || null,
      fundamentals: active && active.fundamentals || intent.scannerHandoff && intent.scannerHandoff.fundamentals || null,
      scannerAIAnalysis: active && active.scannerAIAnalysis || intent.scannerHandoff && intent.scannerHandoff.scannerAIAnalysis || null,
      copilotAnalysis: intent.copilotAnalysis !== undefined ? intent.copilotAnalysis : (active && active.copilotAnalysis) || null,
      tradeDraft: tradeDraft || null,
      executionIntentId: intent.id || null,
      executionIntent: intent,
      lastUpdatedBy: 'execution-intent',
    };
  }

  function toExecutionIntent(plan) {
    var input = plan && typeof plan === 'object' ? plan : null;
    if (!input || !input.symbol) return null;
    if (!input.executionIntent && !input.executionIntentId && String(input.status || '').trim().toLowerCase() !== 'execution_staged') {
      return null;
    }
    var draft = input.tradeDraft && typeof input.tradeDraft === 'object' ? cloneValue(input.tradeDraft) : {};
    return {
      id: input.executionIntentId || draft.execution_intent_id || ('intent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
      tradePlanId: input.id || null,
      version: 1,
      source: input.source || 'trading_desk',
      createdAt: input.updatedAt || input.createdAt || nowIso(),
      symbol: input.symbol,
      instrumentType: input.instrumentType || draft.instrumentType || 'stock',
      brokerProvider: normalizeBrokerProvider(input.brokerProvider || draft.broker_provider, input.instrumentType || draft.instrumentType),
      direction: normalizeSide(input.side || draft.direction) || 'LONG',
      orderType: normalizeOrderType(input.orderType || draft.orderType),
      limitPrice: asFiniteNumber(input.limitPrice != null ? input.limitPrice : draft.limitPrice),
      entryPrice: asFiniteNumber(input.entryPrice != null ? input.entryPrice : draft.plannedEntry),
      stopPrice: asFiniteNumber(input.stopPrice != null ? input.stopPrice : draft.currentStop),
      takeProfitPrice: asFiniteNumber(input.takeProfitPrice != null ? input.takeProfitPrice : draft.plannedTarget),
      units: asFiniteNumber(input.units != null ? input.units : (draft.actualShares != null ? draft.actualShares : draft.plannedShares)),
      strategyVersionId: input.strategyVersionId || draft.strategy_version_id || null,
      riskTemplateId: input.riskTemplateId || draft.risk_template_id || null,
      riskTemplateName: input.riskTemplateName || draft.risk_template_name || null,
      scannerHandoff: cloneValue(input.scannerHandoff),
      copilotAnalysis: cloneValue(input.copilotAnalysis),
      tradeDraft: draft,
    };
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        state = sanitizeState(JSON.parse(event.newValue));
        emitChange({ type: 'storage-sync' });
      } catch (_error) {}
    });
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', function (event) {
        var data = event && event.data ? event.data : null;
        if (!data || data.type !== 'trade-plan-state' || data.origin === TAB_ID) return;
        state = sanitizeState(data.state);
        emitChange({ type: 'broadcast-sync', meta: data.meta || null });
      });
    } catch (_error) {
      channel = null;
    }
  }

  window.TradePlanStore = {
    STORAGE_KEY: STORAGE_KEY,
    getState: getState,
    getPlan: getPlan,
    getActivePlan: getActivePlan,
    setActivePlan: setActivePlan,
    upsertPlan: upsertPlan,
    upsertActivePlan: upsertActivePlan,
    patchActivePlan: patchActivePlan,
    clearActivePlan: clearActivePlan,
    clearExecutionIntent: clearExecutionIntent,
    subscribe: subscribe,
    fromScannerPacket: fromScannerPacket,
    fromExecutionIntent: fromExecutionIntent,
    toExecutionIntent: toExecutionIntent,
  };
})();
