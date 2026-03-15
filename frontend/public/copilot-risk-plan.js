// =========================================================================
// copilot-risk-plan.js - Trading Desk risk-plan templates and modal workflow
// Load after copilot-trading.js.
// =========================================================================

async function loadRiskPlanStrategyCatalog() {
  if (riskPlanStrategyCatalog.length) return riskPlanStrategyCatalog;
  const response = await fetch('/api/strategies');
  const payload = await response.json();
  if (!payload?.success || !Array.isArray(payload.data)) {
    throw new Error(payload?.error || 'Unable to load strategy templates.');
  }
  riskPlanStrategyCatalog = payload.data.filter((item) => item && item.status !== 'rejected');
  return riskPlanStrategyCatalog;
}

function getRiskPlanStrategyOptions() {
  const patternType = String(currentCandidate?.pattern_type || scannerTradingDeskHandoff?.candidate?.pattern_type || '').trim().toLowerCase();
  const settings = typeof getSettings === 'function' ? getSettings() : { instrumentType: 'stock' };
  const assetClass = settings.instrumentType === 'stock' ? 'stocks' : settings.instrumentType;

  return [...riskPlanStrategyCatalog].sort((a, b) => {
    const aPattern = String(a?.setup_config?.pattern_type || a?.strategy_id || '').trim().toLowerCase() === patternType ? 1 : 0;
    const bPattern = String(b?.setup_config?.pattern_type || b?.strategy_id || '').trim().toLowerCase() === patternType ? 1 : 0;
    if (aPattern !== bPattern) return bPattern - aPattern;

    const aAsset = String(a?.asset_class || '').trim().toLowerCase() === assetClass ? 1 : 0;
    const bAsset = String(b?.asset_class || '').trim().toLowerCase() === assetClass ? 1 : 0;
    if (aAsset !== bAsset) return bAsset - aAsset;

    return String(b?.updated_at || '').localeCompare(String(a?.updated_at || ''));
  }).slice(0, 80);
}

function getDefaultRiskPlanStrategyId(options) {
  const currentId = String(
    riskPlanState?.strategyVersionId
    || currentCandidate?.trade_risk_plan?.strategyVersionId
    || currentCandidate?.strategy_version_id
    || scannerTradingDeskHandoff?.candidate?.strategy_version_id
    || ''
  ).trim();
  if (currentId && options.some((item) => item.strategy_version_id === currentId)) {
    return currentId;
  }
  return options[0]?.strategy_version_id || '';
}

function findRiskPlanStrategy(strategyVersionId) {
  const id = String(strategyVersionId || '').trim();
  return riskPlanStrategyCatalog.find((item) => item.strategy_version_id === id) || null;
}

function populateRiskPlanStrategySelect(selectedId) {
  const select = document.getElementById('risk-plan-strategy');
  if (!select) return [];
  const options = getRiskPlanStrategyOptions();
  select.innerHTML = options.length
    ? options.map((item) => `<option value="${item.strategy_version_id}">${item.name || item.strategy_version_id}</option>`).join('')
    : '<option value="">No templates available</option>';
  if (selectedId && options.some((item) => item.strategy_version_id === selectedId)) {
    select.value = selectedId;
  } else if (options.length) {
    select.value = getDefaultRiskPlanStrategyId(options);
  }
  return options;
}

function updateRiskPlanStrategySummary() {
  const select = document.getElementById('risk-plan-strategy');
  const summaryEl = document.getElementById('risk-plan-template-summary');
  const atrInput = document.getElementById('risk-plan-atr');
  if (!summaryEl || !select) return;

  const spec = findRiskPlanStrategy(select.value);
  const atr = inferRiskPlanAtr();
  if (atrInput) atrInput.value = atr ? roundRiskPlanPrice(atr) : '';

  if (!spec) {
    summaryEl.textContent = 'Select a strategy template or enter the stop-loss and take-profit manually.';
    return;
  }

  const riskConfig = spec.risk_config || {};
  const exitConfig = spec.exit_config || {};
  const lines = [
    spec.name || spec.strategy_version_id,
    `Stop model: ${describeRiskPlanStop(riskConfig)}`,
    `Target model: ${describeRiskPlanTarget(exitConfig, riskConfig)}`,
    atr ? `ATR reference: ${roundRiskPlanPrice(atr)}` : 'ATR reference unavailable on this chart',
    `Direction: ${riskPlanDirectionLabel() || 'Choose Long or Short in Route'}`,
  ];
  summaryEl.textContent = lines.join('\n');
}

function applyRiskPlanTemplate() {
  const select = document.getElementById('risk-plan-strategy');
  const spec = findRiskPlanStrategy(select?.value);
  if (!spec) {
    alert('Select a strategy template first.');
    return;
  }

  const direction = riskPlanDirectionLabel();
  const sign = riskPlanDirectionSign();
  if (!direction || !sign) {
    alert('Choose Long or Short in Route, or set entry, stop, and take profit so Trading Desk can infer the side first.');
    return;
  }
  const entry = roundRiskPlanPrice(
    riskPlanNumber(document.getElementById('risk-plan-entry')?.value)
    || inferRiskPlanEntryValue()
  );
  if (!(entry > 0)) {
    alert('A valid entry price is required before applying a strategy template.');
    return;
  }

  const riskConfig = spec.risk_config || {};
  const exitConfig = spec.exit_config || {};
  const stopType = String(riskConfig.stop_type || 'atr_multiple').trim().toLowerCase();
  const atr = inferRiskPlanAtr();
  let stop = null;
  let stopDistance = 0;

  if (stopType === 'atr_multiple') {
    const atrMultiple = riskPlanNumber(riskConfig.atr_multiplier ?? riskConfig.stop_value);
    if (atr && atrMultiple && atrMultiple > 0) {
      stopDistance = atr * atrMultiple;
      stop = entry - (stopDistance * sign);
    }
  } else if (stopType === 'fixed_pct') {
    const pct = riskPlanNumber(riskConfig.stop_value ?? riskConfig.fixed_stop_pct ?? riskConfig.stop_buffer_pct);
    if (pct && pct > 0) {
      stopDistance = entry * pct;
      stop = entry - (stopDistance * sign);
    }
  } else {
    stop = inferStructuralStopFromCandidate(direction, entry);
  }

  stop = roundRiskPlanPrice(stop);
  if (!isDirectionalLevelValid(stop, direction, entry, 'stop')) {
    stop = inferStructuralStopFromCandidate(direction, entry);
  }
  if (!isDirectionalLevelValid(stop, direction, entry, 'stop')) {
    alert(`The selected template could not derive a valid ${direction.toLowerCase()} stop from this symbol.`);
    return;
  }

  stopDistance = Math.abs(entry - stop);
  let target = null;
  const targetType = String(exitConfig.target_type || '').trim().toLowerCase();
  const targetLevel = riskPlanNumber(exitConfig.target_level);

  if (targetType === 'percentage' && targetLevel && targetLevel > 0) {
    target = entry + (entry * targetLevel * sign);
  } else if (targetType === 'atr_multiple' && targetLevel && targetLevel > 0 && atr && atr > 0) {
    target = entry + (atr * targetLevel * sign);
  } else {
    const rMultiple = targetType === 'r_multiple' && targetLevel && targetLevel > 0
      ? targetLevel
      : riskPlanNumber(riskConfig.take_profit_R ?? riskConfig.take_profit_r);
    if (stopDistance > 0 && rMultiple && rMultiple > 0) {
      target = entry + (stopDistance * rMultiple * sign);
    }
  }

  if (!isDirectionalLevelValid(target, direction, entry, 'target')) {
    const suggestedTarget = roundRiskPlanPrice(getRiskPlanLevels()?.suggestedTarget);
    if (isDirectionalLevelValid(suggestedTarget, direction, entry, 'target')) {
      target = suggestedTarget;
    }
  }
  if (!isDirectionalLevelValid(target, direction, entry, 'target')) {
    alert(`The selected template could not derive a valid ${direction.toLowerCase()} target from this symbol.`);
    return;
  }

  document.getElementById('risk-plan-entry').value = entry;
  document.getElementById('risk-plan-stop').value = roundRiskPlanPrice(stop);
  document.getElementById('risk-plan-target').value = roundRiskPlanPrice(target);
  updateRiskPlanStrategySummary();
}

function closeRiskPlanModal(event) {
  if (event && event.target && event.target.id !== 'risk-plan-modal') return;
  const modal = document.getElementById('risk-plan-modal');
  if (modal) modal.classList.remove('active');
}

async function openRiskPlanModal() {
  const symbol = getRiskPlanSymbol();
  if (!symbol) {
    alert('Load a symbol in Trading Desk first.');
    return;
  }

  if (typeof syncTradeDirectionFromDeskLevels === 'function') {
    syncTradeDirectionFromDeskLevels();
  }

  await loadRiskPlanStrategyCatalog();
  const options = populateRiskPlanStrategySelect();
  const selectedId = getDefaultRiskPlanStrategyId(options);
  const liveLevels = getDeskRiskPlanLevels();
  const currentPlan = syncRiskPlanFromDeskLevels() || getExistingRiskPlanForSymbol(symbol) || null;

  if (selectedId) {
    document.getElementById('risk-plan-strategy').value = selectedId;
  }

  const entry = roundRiskPlanPrice(liveLevels.entryPrice || currentPlan?.entryPrice || inferRiskPlanEntryValue());
  const stop = roundRiskPlanPrice(liveLevels.stopPrice || currentPlan?.stopPrice || stopLossPrice || getRiskPlanLevels()?.suggestedStop);
  const target = roundRiskPlanPrice(liveLevels.takeProfitPrice || currentPlan?.takeProfitPrice || takeProfitPrice || getRiskPlanLevels()?.suggestedTarget);
  const atr = inferRiskPlanAtr();
  const direction = riskPlanDirectionLabel();

  document.getElementById('risk-plan-summary').textContent = direction
    ? `${symbol} ${direction} - Set the initial stop-loss and take-profit here before sending the trade to Execution Desk.`
    : `${symbol} - Choose Long or Short in Route, or set entry, stop, and take profit so Trading Desk can infer the side before sending to Execution Desk.`;
  document.getElementById('risk-plan-entry').value = entry || '';
  document.getElementById('risk-plan-stop').value = stop || '';
  document.getElementById('risk-plan-target').value = target || '';
  document.getElementById('risk-plan-atr').value = atr ? roundRiskPlanPrice(atr) : '';
  updateRiskPlanStrategySummary();

  if (direction && (!(stop > 0) || !(target > 0))) {
    applyRiskPlanTemplate();
  }

  document.getElementById('risk-plan-modal').classList.add('active');
}

function saveRiskPlanFromModal() {
  const symbol = getRiskPlanSymbol();
  const direction = riskPlanDirectionLabel();
  const entry = roundRiskPlanPrice(document.getElementById('risk-plan-entry')?.value);
  const stop = roundRiskPlanPrice(document.getElementById('risk-plan-stop')?.value);
  const target = roundRiskPlanPrice(document.getElementById('risk-plan-target')?.value);
  const spec = findRiskPlanStrategy(document.getElementById('risk-plan-strategy')?.value);

  if (!direction) {
    alert('Choose Long or Short in Route before saving the risk plan.');
    return;
  }
  if (!symbol || !(entry > 0) || !(stop > 0) || !(target > 0)) {
    alert('Entry, stop-loss, and take-profit are required.');
    return;
  }
  if (!isDirectionalLevelValid(stop, direction, entry, 'stop')) {
    alert(`For ${direction}, the stop-loss must be on the opposite side of entry.`);
    return;
  }
  if (!isDirectionalLevelValid(target, direction, entry, 'target')) {
    alert(`For ${direction}, the take-profit must be on the profit side of entry.`);
    return;
  }

  if (typeof setEntry === 'function') setEntry(entry);
  if (typeof setStopLoss === 'function') setStopLoss(stop);
  if (typeof setTakeProfit === 'function') setTakeProfit(target);
  if (typeof updateCalculations === 'function') updateCalculations();
  if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();

  riskPlanState = {
    symbol,
    direction,
    strategyVersionId: spec?.strategy_version_id || null,
    strategyName: spec?.name || null,
    entryPrice: entry,
    stopPrice: stop,
    takeProfitPrice: target,
    atr: inferRiskPlanAtr(),
    savedAt: new Date().toISOString(),
  };

  if (currentCandidate && typeof currentCandidate === 'object') {
    currentCandidate.strategy_version_id = riskPlanState.strategyVersionId || currentCandidate.strategy_version_id || null;
    currentCandidate.trade_risk_plan = { ...riskPlanState };
    currentCandidate.risk_template_id = riskPlanState.strategyVersionId || null;
    currentCandidate.risk_template_name = riskPlanState.strategyName || null;
  }
  if (scannerTradingDeskHandoff?.candidate) {
    scannerTradingDeskHandoff.candidate.strategy_version_id = riskPlanState.strategyVersionId || scannerTradingDeskHandoff.candidate.strategy_version_id || null;
  }

  syncTradePlanStoreFromDesk('risk_plan_saved');
  closeRiskPlanModal();
  if (typeof addChatMessage === 'function') {
    addChatMessage(
      `Risk plan set for ${symbol}: entry $${entry.toFixed(getRiskPlanPrecision())}, stop $${stop.toFixed(getRiskPlanPrecision())}, target $${target.toFixed(getRiskPlanPrecision())}.`,
      'ai'
    );
  }
}
