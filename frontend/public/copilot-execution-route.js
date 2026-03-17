// =========================================================================
// copilot-execution-route.js - Trading Desk execution route summary and handoff
// Load after copilot-trading.js.
// =========================================================================

function getDefaultExecutionBrokerForInstrument(instrumentType) {
  const kind = String(instrumentType || '').trim().toLowerCase();
  if (kind === 'forex') return 'oanda';
  if (kind === 'stock' || kind === 'options' || kind === 'futures' || kind === 'crypto') return 'robinhood';
  return 'alpaca';
}

function normalizeExecutionBrokerRoute(value, instrumentType) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'alpaca' || raw === 'oanda' || raw === 'robinhood') return raw;
  return getDefaultExecutionBrokerForInstrument(instrumentType);
}

function formatExecutionSummaryPrice(value) {
  const num = riskPlanNumber(value);
  if (!(num > 0)) return 'Not set';
  return `$${num.toFixed(getRiskPlanPrecision())}`;
}

function formatExecutionSummaryUnits(units, unitLabel) {
  const normalized = Number(units);
  if (!(normalized > 0)) return 'Not sized yet';
  if (!unitLabel) return `${normalized}`;
  return `${normalized} ${unitLabel}`;
}

function getExecutionTradeSummaryState() {
  const settings = getSettings();
  const select = document.getElementById('execution-broker-route');
  const broker = normalizeExecutionBrokerRoute(select?.value, settings.instrumentType);
  const direction = riskPlanDirectionLabel() || inferTradeDirectionFromDeskLevels();
  const symbol = getRiskPlanSymbol();
  const plannedEntry = orderType === 'limit'
    ? (riskPlanNumber(document.getElementById('limit-price')?.value) || inferRiskPlanEntryValue())
    : inferRiskPlanEntryValue();
  const stop = roundRiskPlanPrice(stopLossPrice || document.getElementById('stop-loss-price-input')?.value);
  const target = roundRiskPlanPrice(takeProfitPrice || document.getElementById('take-profit-price-input')?.value);
  const sizingEntry = plannedEntry > 0
    ? plannedEntry
    : (settings.instrumentType === 'options' ? (settings.optionPrice || 0) : 0);
  const sizingStop = settings.instrumentType === 'options'
    ? 0
    : (stop || sizingEntry);
  const sizingContext = sizingEntry > 0 && (settings.instrumentType === 'options' || sizingStop > 0)
    ? getPositionSizingContext(settings, sizingEntry, sizingStop)
    : null;
  const fallbackUnits = getManualPositionSizeValue();
  const effectiveSizing = sizingContext?.effectiveSizing || null;
  const units = Number(effectiveSizing?.units || fallbackUnits || 0);
  const unitLabel = effectiveSizing?.unitLabel
    || ({
      stock: 'shares',
      futures: 'contracts',
      options: 'contracts',
      forex: 'lots',
      crypto: 'units',
    }[settings.instrumentType] || 'units');
  return {
    broker,
    direction,
    symbol,
    instrumentType: settings.instrumentType || 'stock',
    orderType,
    plannedEntry,
    stop,
    target,
    units,
    unitLabel,
    limitPrice: orderType === 'limit' ? riskPlanNumber(document.getElementById('limit-price')?.value) || plannedEntry : null,
  };
}

function renderExecutionRouteSummary() {
  const summaryEl = document.getElementById('execution-route-summary');
  const tradeSummaryEl = document.getElementById('execution-trade-summary');
  const select = document.getElementById('execution-broker-route');
  if (!summaryEl || !select) return;

  const state = getExecutionTradeSummaryState();
  const orderLabel = orderType === 'limit' ? 'limit order ticket' : 'market order ticket';
  const notes = {
    alpaca: 'Execution Desk can submit this route directly through Alpaca.',
    oanda: 'Execution Desk can submit this route directly through OANDA.',
    robinhood: 'Execution Desk receives this Robinhood ticket, but Robinhood order submission is not wired yet.',
  };
  summaryEl.textContent = `${String(state.instrumentType || 'stock').toUpperCase()} will route to ${state.broker.toUpperCase()} as a ${orderLabel}. ${notes[state.broker]}`;
  if (!tradeSummaryEl) return;

  const sideText = state.direction ? state.direction.toLowerCase() : null;
  const entryLabel = state.orderType === 'limit' ? 'Limit Entry' : 'Entry';
  const stopText = state.instrumentType === 'options'
    ? 'Premium at risk'
    : formatExecutionSummaryPrice(state.stop);
  const targetLabel = state.instrumentType === 'options' ? 'Price Target' : 'Take Profit';
  const headline = state.direction
    ? `You are entering a ${sideText} ${state.instrumentType} position${state.symbol ? ` in ${state.symbol}` : ''} through ${state.broker.toUpperCase()} as a ${state.orderType.toUpperCase()} ticket.`
    : 'Trade side is not set yet.';
  const detail = state.direction
    ? `Position size: ${formatExecutionSummaryUnits(state.units, state.unitLabel)}. ${entryLabel}: ${formatExecutionSummaryPrice(state.plannedEntry)}. Stop: ${stopText}. ${targetLabel}: ${formatExecutionSummaryPrice(state.target)}.`
    : `Choose Long or Short, or set entry, stop, and take profit so Trading Desk can infer the side before sending to Execution Desk. Current setup: Position size ${formatExecutionSummaryUnits(state.units, state.unitLabel)}. ${entryLabel}: ${formatExecutionSummaryPrice(state.plannedEntry)}. Stop: ${stopText}. ${targetLabel}: ${formatExecutionSummaryPrice(state.target)}.`;

  tradeSummaryEl.innerHTML = '';
  const headlineEl = document.createElement('div');
  headlineEl.textContent = headline;
  headlineEl.style.color = state.direction === 'SHORT'
    ? 'var(--color-negative, #ef4444)'
    : state.direction === 'LONG'
      ? 'var(--color-positive, #4ade80)'
      : 'var(--color-text)';
  headlineEl.style.fontWeight = '600';
  const detailEl = document.createElement('div');
  detailEl.textContent = detail;
  detailEl.style.color = 'var(--color-text-muted)';
  tradeSummaryEl.appendChild(headlineEl);
  tradeSummaryEl.appendChild(detailEl);
}
window.renderExecutionRouteSummary = renderExecutionRouteSummary;

function syncExecutionRouteSelection(forceDefault) {
  const select = document.getElementById('execution-broker-route');
  if (!select) return null;

  const settings = getSettings();
  const preferred = getDefaultExecutionBrokerForInstrument(settings.instrumentType);
  const current = normalizeExecutionBrokerRoute(select.value, settings.instrumentType);
  if (forceDefault || !current || select.dataset.userSelected !== 'true') {
    select.value = preferred;
    select.dataset.userSelected = 'false';
  } else {
    select.value = current;
  }
  select.dataset.defaultRoute = preferred;
  renderExecutionRouteSummary();
  syncTradePlanStoreFromDesk(forceDefault ? 'route_defaulted' : 'route_synced');
  return select.value;
}
window.syncExecutionRouteSelection = syncExecutionRouteSelection;

function markExecutionRouteSelection() {
  const select = document.getElementById('execution-broker-route');
  if (!select) return;
  select.dataset.userSelected = 'true';
  renderExecutionRouteSummary();
  syncTradePlanStoreFromDesk('route_changed');
}

function initExecutionRouteControls() {
  const select = document.getElementById('execution-broker-route');
  const instrumentType = document.getElementById('instrument-type');
  const limitInput = document.getElementById('limit-price');
  if (select && !select.dataset.bound) {
    select.addEventListener('change', markExecutionRouteSelection);
    select.dataset.bound = 'true';
  }
  if (instrumentType && !instrumentType.dataset.executionRouteBound) {
    instrumentType.addEventListener('change', () => syncExecutionRouteSelection(true));
    instrumentType.dataset.executionRouteBound = 'true';
  }
  if (limitInput && !limitInput.dataset.tradePlanBound) {
    limitInput.addEventListener('input', () => {
      renderExecutionRouteSummary();
      syncTradePlanStoreFromDesk('limit_price_changed');
    });
    limitInput.dataset.tradePlanBound = 'true';
  }
  syncExecutionRouteSelection(true);
  applyOrderTypeButtonState();
  renderExecutionRouteSummary();
}

function sendTradeToExecution() {
  if (!window.TradingDeskExecutionIntent?.write) {
    alert('Execution Desk handoff is unavailable on this page.');
    return;
  }

  if (typeof syncTradeDirectionFromDeskLevels === 'function') {
    syncTradeDirectionFromDeskLevels();
  }

  const settings = getSettings();
  const symbol = getRiskPlanSymbol();
  const direction = riskPlanDirectionLabel();
  const plannedEntry = orderType === 'limit'
    ? (riskPlanNumber(document.getElementById('limit-price')?.value) || inferRiskPlanEntryValue())
    : inferRiskPlanEntryValue();
  const stop = roundRiskPlanPrice(stopLossPrice || document.getElementById('stop-loss-price-input')?.value);
  const target = roundRiskPlanPrice(takeProfitPrice || document.getElementById('take-profit-price-input')?.value);
  const stopPx = settings.instrumentType === 'options' ? 0 : (stop || plannedEntry);

  if (!direction) {
    alert('Choose Long or Short, or set entry, stop, and take profit so Trading Desk can infer the side before sending to Execution Desk.');
    return;
  }

  if (!symbol || !(plannedEntry > 0) || !(stop > 0) || !(target > 0)) {
    alert('Set the initial stop-loss and take-profit in Trading Desk before handing the trade to Execution Desk.');
    return;
  }

  const sizingContext = typeof getPositionSizingContext === 'function'
    ? getPositionSizingContext(settings, plannedEntry, stopPx)
    : { autoSizing: calculatePositionSize(settings, plannedEntry, stopPx), effectiveSizing: calculatePositionSize(settings, plannedEntry, stopPx), manualUnits: null };
  const sizing = sizingContext.effectiveSizing;
  const units = Number(sizing?.units || 0);
  if (!(units > 0)) {
    alert('Position size is zero. Adjust the stop or risk settings first.');
    return;
  }

  const executionProvider = normalizeExecutionBrokerRoute(
    document.getElementById('execution-broker-route')?.value,
    settings.instrumentType,
  );
  const sharedPlan = syncTradePlanStoreFromDesk('execution_prepare');

  const intent = window.TradingDeskExecutionIntent.write({
    tradePlanId: sharedPlan?.id || null,
    source: 'trading_desk',
    symbol,
    instrumentType: settings.instrumentType,
    brokerProvider: executionProvider,
    direction,
    orderType,
    limitPrice: orderType === 'limit' ? plannedEntry : null,
    entryPrice: plannedEntry,
    stopPrice: stop,
    takeProfitPrice: target,
    units,
    strategyVersionId: riskPlanState?.strategyVersionId || currentCandidate?.strategy_version_id || scannerTradingDeskHandoff?.candidate?.strategy_version_id || null,
    riskTemplateId: riskPlanState?.strategyVersionId || currentCandidate?.risk_template_id || null,
    riskTemplateName: riskPlanState?.strategyName || currentCandidate?.risk_template_name || null,
    scannerHandoff: buildTradingDeskScannerHandoffContext(),
    copilotAnalysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult),
    tradeDraft: {
      symbol,
      instrumentType: settings.instrumentType,
      broker_provider: executionProvider,
      direction: tradeDirection,
      orderType,
      limitPrice: orderType === 'limit' ? plannedEntry : null,
      plannedEntry,
      plannedStop: stop,
      currentStop: stop,
      plannedTarget: target,
      plannedShares: units,
      actualShares: units,
      strategy_version_id: riskPlanState?.strategyVersionId || currentCandidate?.strategy_version_id || scannerTradingDeskHandoff?.candidate?.strategy_version_id || null,
      risk_template_id: riskPlanState?.strategyVersionId || currentCandidate?.risk_template_id || null,
      risk_template_name: riskPlanState?.strategyName || currentCandidate?.risk_template_name || null,
      scanner_handoff: buildTradingDeskScannerHandoffContext(),
      copilot_analysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult),
    },
  });

  if (!intent) {
    alert('Failed to prepare the Execution Desk handoff.');
    return;
  }

  syncTradePlanStoreFromDesk('execution_staged', {
    id: intent.tradePlanId || sharedPlan?.id || null,
    status: 'execution_staged',
    executionIntentId: intent.id,
  });
  window.location.href = 'execution.html';
}

initExecutionRouteControls();
