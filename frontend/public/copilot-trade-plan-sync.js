// =========================================================================
// copilot-trade-plan-sync.js - Shared Trading Desk plan bootstrap and sync
// Load after copilot-trading.js.
// =========================================================================

function getTradePlanStore() {
  return window.TradePlanStore || null;
}

function queueTradePlanBootstrap(plan) {
  if (!plan || typeof plan !== 'object' || !String(plan.symbol || '').trim()) return false;
  pendingTradePlanBootstrap = plan;
  return true;
}
window.queueTradePlanBootstrap = queueTradePlanBootstrap;

function buildTradingDeskSettingsSnapshot() {
  const settings = typeof getSettings === 'function' ? getSettings() : {};
  return {
    ...settings,
    manualPositionSize: document.getElementById('manual-position-size')?.value || '',
  };
}

function buildTradePlanDraft(reason = 'desk_sync') {
  const symbol = getRiskPlanSymbol();
  if (!symbol) return null;

  const store = getTradePlanStore();
  const activePlan = store?.getActivePlan ? store.getActivePlan() : null;
  const settings = typeof getSettings === 'function' ? getSettings() : { instrumentType: 'stock' };
  const summary = typeof getExecutionTradeSummaryState === 'function'
    ? getExecutionTradeSummaryState()
    : {
        broker: normalizeExecutionBrokerRoute(document.getElementById('execution-broker-route')?.value, settings.instrumentType),
        direction: riskPlanDirectionLabel() || inferTradeDirectionFromDeskLevels(),
        orderType,
        plannedEntry: inferRiskPlanEntryValue(),
        stop: roundRiskPlanPrice(stopLossPrice || document.getElementById('stop-loss-price-input')?.value),
        target: roundRiskPlanPrice(takeProfitPrice || document.getElementById('take-profit-price-input')?.value),
        units: Number(document.getElementById('manual-position-size')?.value || 0),
        limitPrice: orderType === 'limit' ? riskPlanNumber(document.getElementById('limit-price')?.value) : null,
      };
  const currentRiskPlan = syncRiskPlanFromDeskLevels() || getExistingRiskPlanForSymbol(symbol) || activePlan || {};
  const strategyVersionId = currentRiskPlan?.strategyVersionId
    || currentCandidate?.strategy_version_id
    || scannerTradingDeskHandoff?.candidate?.strategy_version_id
    || activePlan?.strategyVersionId
    || null;
  const riskTemplateId = currentRiskPlan?.strategyVersionId
    || currentCandidate?.risk_template_id
    || activePlan?.riskTemplateId
    || null;
  const riskTemplateName = currentRiskPlan?.strategyName
    || currentCandidate?.risk_template_name
    || activePlan?.riskTemplateName
    || null;

  return {
    id: activePlan?.id || null,
    source: activePlan?.source || (scannerTradingDeskHandoff ? 'scanner' : 'trading_desk'),
    status: activePlan?.status === 'execution_staged' ? 'execution_staged' : 'desk_draft',
    symbol,
    interval: document.getElementById('copilot-interval')?.value || currentCandidate?.interval || currentCandidate?.timeframe || activePlan?.interval || null,
    timeframe: currentCandidate?.timeframe || activePlan?.timeframe || null,
    instrumentType: settings.instrumentType || activePlan?.instrumentType || 'stock',
    side: summary.direction || currentRiskPlan?.direction || activePlan?.side || null,
    brokerProvider: summary.broker || activePlan?.brokerProvider || null,
    orderType: summary.orderType || activePlan?.orderType || 'market',
    limitPrice: summary.limitPrice,
    entryPrice: summary.plannedEntry,
    stopPrice: summary.stop,
    takeProfitPrice: summary.target,
    units: summary.units,
    strategyVersionId,
    riskTemplateId,
    riskTemplateName,
    scannerPacketId: scannerTradingDeskHandoff?.id || activePlan?.scannerPacketId || null,
    scannerHandoff: buildTradingDeskScannerHandoffContext() || activePlan?.scannerHandoff || null,
    scannerCandidate: scannerTradingDeskHandoff?.candidate || activePlan?.scannerCandidate || null,
    fundamentals: scannerTradingDeskHandoff?.fundamentals || activePlan?.fundamentals || null,
    scannerAIAnalysis: scannerTradingDeskHandoff?.scannerAIAnalysis || activePlan?.scannerAIAnalysis || null,
    copilotAnalysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult) || activePlan?.copilotAnalysis || null,
    settingsSnapshot: buildTradingDeskSettingsSnapshot(),
    tradeDraft: {
      ...(activePlan?.tradeDraft || {}),
      symbol,
      instrumentType: settings.instrumentType,
      broker_provider: summary.broker || activePlan?.brokerProvider || null,
      direction: tradeDirection,
      orderType: summary.orderType || orderType,
      limitPrice: summary.limitPrice,
      trade_plan_id: activePlan?.id || null,
      plannedEntry: summary.plannedEntry,
      plannedStop: summary.stop,
      currentStop: summary.stop,
      plannedTarget: summary.target,
      plannedShares: summary.units,
      actualShares: summary.units,
      strategy_version_id: strategyVersionId,
      risk_template_id: riskTemplateId,
      risk_template_name: riskTemplateName,
      scanner_handoff: buildTradingDeskScannerHandoffContext() || activePlan?.scannerHandoff || null,
      copilot_analysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult) || activePlan?.copilotAnalysis || null,
    },
    lastUpdatedBy: reason,
  };
}

function syncTradePlanStoreFromDesk(reason = 'desk_sync', overrides = null) {
  if (suppressTradePlanStoreSync) return null;
  const store = getTradePlanStore();
  if (!store?.upsertActivePlan) return null;
  const draft = buildTradePlanDraft(reason);
  if (!draft) return null;
  return store.upsertActivePlan({
    ...draft,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  }, {
    reason,
  });
}
window.syncTradePlanStoreFromDesk = syncTradePlanStoreFromDesk;

function applyTradePlanToDesk(plan) {
  if (!plan || typeof plan !== 'object' || !String(plan.symbol || '').trim()) return false;

  suppressTradePlanStoreSync = true;
  try {
    if (plan.scannerHandoff?.candidate) {
      scannerTradingDeskHandoff = plan.scannerHandoff;
    }
    if (plan.settingsSnapshot && typeof window.applyTradingDeskSettingsSnapshot === 'function') {
      window.applyTradingDeskSettingsSnapshot(plan.settingsSnapshot);
    }

    const instrumentSelect = document.getElementById('instrument-type');
    if (instrumentSelect && plan.instrumentType) {
      const normalizedInstrument = String(plan.instrumentType).trim().toLowerCase();
      const option = Array.from(instrumentSelect.options).find((item) => item.value === normalizedInstrument);
      if (option) instrumentSelect.value = normalizedInstrument;
      if (typeof toggleInstrumentSettings === 'function') toggleInstrumentSettings();
    }

    applyTradeDirectionWithoutAnalysis(plan.side || 0);
    setOrderType(plan.orderType || 'market');

    const routeSelect = document.getElementById('execution-broker-route');
    if (routeSelect && plan.brokerProvider) {
      routeSelect.value = normalizeExecutionBrokerRoute(plan.brokerProvider, plan.instrumentType || getSettings().instrumentType);
      routeSelect.dataset.userSelected = 'true';
    }

    const limitInput = document.getElementById('limit-price');
    if (limitInput) {
      limitInput.value = plan.limitPrice > 0 ? String(plan.limitPrice) : '';
    }

    if (plan.entryPrice > 0 && typeof setEntry === 'function') setEntry(plan.entryPrice);
    if (plan.stopPrice > 0 && typeof setStopLoss === 'function') setStopLoss(plan.stopPrice);
    if (plan.takeProfitPrice > 0 && typeof setTakeProfit === 'function') setTakeProfit(plan.takeProfitPrice);

    const manualInput = document.getElementById('manual-position-size');
    if (manualInput) {
      manualInput.value = plan.units > 0 ? String(Math.round(plan.units)) : '';
      if (typeof onManualSizeChange === 'function') onManualSizeChange();
    }

    riskPlanState = {
      ...(riskPlanState || {}),
      symbol: plan.symbol,
      direction: plan.side || null,
      strategyVersionId: plan.strategyVersionId || null,
      strategyName: plan.riskTemplateName || null,
      entryPrice: plan.entryPrice || null,
      stopPrice: plan.stopPrice || null,
      takeProfitPrice: plan.takeProfitPrice || null,
      atr: inferRiskPlanAtr(),
      savedAt: plan.updatedAt || new Date().toISOString(),
    };

    if (currentCandidate && typeof currentCandidate === 'object') {
      currentCandidate.scanner_handoff = scannerTradingDeskHandoff || currentCandidate.scanner_handoff || null;
      currentCandidate.fundamentals = plan.fundamentals || currentCandidate.fundamentals || null;
      currentCandidate.detector = plan.scannerCandidate?.detector || currentCandidate.detector || null;
      currentCandidate.strategy_version_id = plan.strategyVersionId || currentCandidate.strategy_version_id || null;
      currentCandidate.risk_template_id = plan.riskTemplateId || currentCandidate.risk_template_id || null;
      currentCandidate.risk_template_name = plan.riskTemplateName || currentCandidate.risk_template_name || null;
      currentCandidate.trade_risk_plan = { ...(currentCandidate.trade_risk_plan || {}), ...riskPlanState };
    }

    if (scannerTradingDeskHandoff && typeof renderScannerTradingDeskHandoff === 'function') {
      renderScannerTradingDeskHandoff(scannerTradingDeskHandoff, lastCopilotResult);
    }
    if (typeof syncRiskPlanFromDeskLevels === 'function') syncRiskPlanFromDeskLevels();
    if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();
    if (typeof renderExecutionRouteSummary === 'function') renderExecutionRouteSummary();
  } finally {
    suppressTradePlanStoreSync = false;
  }
  return true;
}

function maybeApplyQueuedTradePlanBootstrap(contextSymbol) {
  if (!pendingTradePlanBootstrap) return false;
  const pendingSymbol = String(pendingTradePlanBootstrap.symbol || '').trim().toUpperCase();
  const currentSymbol = String(contextSymbol || '').trim().toUpperCase();
  if (pendingSymbol && currentSymbol && pendingSymbol !== currentSymbol) {
    return false;
  }
  const plan = pendingTradePlanBootstrap;
  pendingTradePlanBootstrap = null;
  return applyTradePlanToDesk(plan);
}
