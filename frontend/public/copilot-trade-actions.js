// =========================================================================
// copilot-trade-actions.js - Trading Desk verdict, sizing, and save actions
// Load after copilot-trading.js.
// =========================================================================

async function requestTradeVerdict() {
  const settings = getSettings();

  const result = await runVerdictEngine();
  if (!result) return;

  const { approved, layers, sizing, autoSizing, rr } = result;
  const priceDiff = Math.abs(entryPrice - stopLossPrice);
  const positionLine = sizing._manualOverride
    ? `${sizing.units} ${sizing.unitLabel} (manual override; system max ${autoSizing?.units ?? 'n/a'})`
    : `${sizing.units} ${sizing.unitLabel}`;

  const verdictPrompt = `
I need a clear APPROVED or DENIED verdict for this trade:

TRADE DETAILS:
- Symbol: ${currentCandidate?.symbol || 'Unknown'}
- Instrument type: ${settings.instrumentType}
- Entry: $${entryPrice.toFixed(2)}
- Stop Loss: $${stopLossPrice.toFixed(2)}
- Take Profit: ${takeProfitPrice ? '$' + takeProfitPrice.toFixed(2) : 'Not set'}
- Risk/Reward: 1:${rr.toFixed(2)}
- Position Size: ${positionLine}
- Position Value: $${sizing.positionValue.toLocaleString()}
- Max Loss: $${sizing.maxLoss.toFixed(0)}

LOCAL VERDICT ENGINE RESULT: ${approved ? 'APPROVED' : 'DENIED'}
${layers.map(l => `${l.layer}: ${l.pass ? 'PASS' : 'FAIL'} Ã¢â‚¬â€ ${l.results.map(r => r.msg).join('; ')}`).join('\n')}

MY RULES:
- Minimum R:R required: 1:${settings.minRR}
- Max position size: ${settings.maxPosition}% of account
- Risk per trade: ${settings.riskPercent}%
- Account size: $${settings.accountSize}
- Daily loss limit: ${settings.dailyLossLimit}%
- Max daily trades: ${settings.maxDailyTrades}

Give me a clear verdict:
1. Start with "Ã¢Å“â€¦ APPROVED" or "Ã¢ÂÅ’ DENIED"
2. Explain WHY in 2-3 bullet points
3. If denied, what would need to change to approve it?
`;

  addChatMessage('Ã°Å¸â€Â Analyzing trade setup...', 'ai');

  try {
    const chartImage = await captureChart();
    const scannerHandoff = buildTradingDeskScannerHandoffContext();

    const response = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: verdictPrompt,
        context: {
          symbol: currentCandidate?.symbol,
          patternType: currentCandidate?.pattern_type || lastCopilotResult?.pattern_type || 'manual',
          entryPrice,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          accountSize: settings.accountSize,
          riskPercent: settings.riskPercent,
          scannerHandoff,
          copilotAnalysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult),
        },
        settings,
        chartImage,
        role: 'copilot'
      })
    });

    const messages = document.getElementById('chat-messages');
    if (messages.lastChild) messages.removeChild(messages.lastChild);

    if (response.ok) {
      const data = await response.json();
      const verdict = data.data?.response || data.response || 'Unable to get verdict.';
      addChatMessage(verdict, 'ai');
      window.lastVerdict = verdict;
      showSavePanel();
    } else {
      addChatMessage(formatVerdictMessage(result), 'ai');
      showSavePanel();
    }
  } catch (error) {
    addChatMessage(formatVerdictMessage(result), 'ai');
    showSavePanel();
  }
}

function formatVerdictMessage(result) {
  const { approved, layers, sizing, autoSizing, targetProfit } = result;
  const icon = approved ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’';
  let msg = `${icon} ${approved ? 'APPROVED' : 'DENIED'}\n\n`;

  for (const layer of layers) {
    const layerIcon = layer.advisory ? (layer.results.some(r => !r.pass) ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦')
                                     : (layer.pass ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’');
    msg += `${layerIcon} ${layer.layer}: ${layer.pass ? 'PASS' : (layer.advisory ? 'CAUTION' : 'FAIL')}\n`;
    for (const r of layer.results) {
      msg += `  ${r.pass ? 'Ã¢Å“â€œ' : 'Ã¢Å“â€”'} ${r.msg}\n`;
    }
    msg += '\n';
  }

  msg += `Position: ${sizing.units} ${sizing.unitLabel}\n`;
  if (sizing._manualOverride) {
    msg += `System max: ${autoSizing?.units ?? '--'} ${sizing.unitLabel}\n`;
  }
  msg += `Max Loss: $${sizing.maxLoss.toFixed(0)} | Target: $${targetProfit.toFixed(0)}\n`;

  return msg;
}

function showSavePanel() {
  const panel = document.getElementById('save-trade-panel');
  panel.classList.remove('hidden');
  const saveBtn = document.getElementById('btn-save-trade');
  saveBtn.disabled = false;
  saveBtn.classList.remove('is-saved');
  applyOrderTypeButtonState();
  if (orderType === 'market') {
    saveBtn.textContent = 'Save as Open Position';
  } else {
    saveBtn.textContent = 'Save as Limit Order (Planned)';
  }
}

function applyOrderTypeButtonState() {
  const marketBtn = document.getElementById('btn-order-market');
  const limitBtn = document.getElementById('btn-order-limit');
  if (marketBtn) {
    marketBtn.classList.toggle('is-active', orderType === 'market');
  }
  if (limitBtn) {
    limitBtn.classList.toggle('is-active', orderType === 'limit');
  }
}

function setOrderType(type) {
  orderType = type;
  const limitRow = document.getElementById('limit-price-row');
  const saveBtn = document.getElementById('btn-save-trade');

  if (type === 'market') {
    limitRow.classList.add('hidden');
    saveBtn.textContent = 'Save as Open Position';
  } else {
    limitRow.classList.remove('hidden');
    saveBtn.textContent = 'Save as Limit Order (Planned)';

    const limitInput = document.getElementById('limit-price');
    if (!limitInput.value && entryPrice) {
      limitInput.value = entryPrice.toFixed(2);
    }
  }
  applyOrderTypeButtonState();
  renderExecutionRouteSummary();
  syncTradePlanStoreFromDesk('order_type_changed');
}

async function saveTrade() {
  try {
    if (typeof syncTradeDirectionFromDeskLevels === 'function') {
      syncTradeDirectionFromDeskLevels();
    }
    const settings = getSettings();
    const isOptions = settings.instrumentType === 'options';
    const symbol = currentCandidate?.symbol || document.getElementById('copilot-symbol')?.value?.trim().toUpperCase();
    const direction = tradeDirection;
    if (direction !== 1 && direction !== -1) {
      alert('Choose Long or Short, or set entry, stop, and take profit so Trading Desk can infer the side before saving the trade.');
      return;
    }

    if (!symbol) {
      alert('No symbol loaded. Please analyze a symbol first.');
      return;
    }
    if (isOptions) {
      if (!entryPrice) {
        alert('Please set your Entry Premium before saving.');
        return;
      }
    } else if (!entryPrice || !stopLossPrice) {
      alert('Please set at least entry and stop loss before saving.');
      return;
    }

    const stopPx = isOptions ? 0 : (stopLossPrice || entryPrice);
    const sizingContext = typeof getPositionSizingContext === 'function'
      ? getPositionSizingContext(settings, entryPrice, stopPx)
      : { autoSizing: calculatePositionSize(settings, entryPrice, stopPx), effectiveSizing: calculatePositionSize(settings, entryPrice, stopPx), manualUnits: null };
    const sizing = sizingContext.effectiveSizing;
    const risk = isOptions ? (settings.optionPrice * settings.contractMultiplier) : Math.abs(entryPrice - stopPx);
    const reward = takeProfitPrice ? Math.abs(takeProfitPrice - entryPrice) : 0;
    const rr = reward > 0 && risk > 0 ? (reward / risk).toFixed(2) : '--';

    const actualUnits = sizing.units;
    const chartImage = await captureChart();
    const instrumentNames = { stock: 'Stock/ETF', futures: 'Futures', options: 'Options', forex: 'Forex', crypto: 'Crypto' };

    const trade = {
      id: Date.now(),
      symbol: symbol,
      patternType: currentCandidate?.pattern_type || lastCopilotResult?.pattern_type || 'manual',
      timeframe: currentCandidate?.timeframe || document.getElementById('copilot-interval')?.value || 'W',
      instrumentType: settings.instrumentType,
      direction,
      strategy_version_id: riskPlanState?.strategyVersionId || currentCandidate?.strategy_version_id || scannerTradingDeskHandoff?.candidate?.strategy_version_id || null,
      risk_template_id: riskPlanState?.strategyVersionId || currentCandidate?.risk_template_id || null,
      risk_template_name: riskPlanState?.strategyName || currentCandidate?.risk_template_name || null,
      plannedEntry: entryPrice,
      plannedStop: isOptions ? 0 : stopLossPrice,
      plannedTarget: takeProfitPrice,
      plannedRR: rr,
      plannedShares: actualUnits,
      calculatedShares: sizingContext.autoSizing?.units ?? sizing.units,
      plannedValue: sizing.positionValue?.toFixed(2) || '0',
      plannedRiskAmount: sizing.maxLoss?.toFixed(2) || '0',
      futuresMargin: settings.instrumentType === 'futures' ? settings.futuresMargin : null,
      futuresPointValue: settings.instrumentType === 'futures' ? settings.futuresPointValue : null,
      futuresTickSize: settings.instrumentType === 'futures' ? settings.futuresTickSize : null,
      contractMultiplier: settings.instrumentType === 'options' ? settings.contractMultiplier : null,
      optionPrice: settings.instrumentType === 'options' ? settings.optionPrice : null,
      optionType: settings.instrumentType === 'options' ? settings.optionType : null,
      optionStrike: settings.instrumentType === 'options' ? settings.optionStrike : null,
      optionExpiry: settings.instrumentType === 'options' ? settings.optionExpiry : null,
      optionCurrentPremium: settings.instrumentType === 'options' ? settings.optionCurrentPremium : null,
      underlyingEntry: isOptions ? (window._optionUnderlyingEntry || null) : null,
      underlyingStop: isOptions ? (window._optionUnderlyingStop || null) : null,
      lotSize: settings.instrumentType === 'forex' ? settings.lotSize : null,
      pipValue: settings.instrumentType === 'forex' ? settings.pipValue : null,
      leverage: settings.instrumentType === 'forex' ? settings.leverage : null,
      exchangeFee: settings.instrumentType === 'crypto' ? settings.exchangeFee : null,
      actualEntry: null,
      actualShares: null,
      executionTime: null,
      slippage: null,
      currentStop: stopLossPrice,
      stopAdjustments: [],
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      actualPnL: null,
      actualRMultiple: null,
      preTradePlan: '',
      postTradeReview: '',
      lessons: '',
      tags: [],
      accountSize: settings.accountSize,
      riskPercent: settings.riskPercent,
      verdict: window.lastVerdict || 'No verdict',
      scanner_handoff: buildTradingDeskScannerHandoffContext(),
      copilot_analysis: buildTradingDeskCopilotAnalysisPayload(lastCopilotResult),
      chartImage: chartImage,
      chartData: currentCandidate?.chart_data || lastCopilotResult?.chart_data || null,
      drawings: savedDrawings || [],
      createdAt: new Date().toISOString(),
      displayDate: new Date().toLocaleString(),
      status: orderType === 'limit' ? 'planned' : 'open',
      orderType: orderType,
      limitPrice: orderType === 'limit' ? (parseFloat(document.getElementById('limit-price').value) || entryPrice) : null,
      outcome: null
    };

    if (orderType === 'limit') {
      const limitPx = parseFloat(document.getElementById('limit-price').value);
      if (!limitPx) {
        alert('Please enter a limit price for your order.');
        return;
      }
      trade.limitPrice = limitPx;
      trade.plannedEntry = limitPx;
    }

    const response = await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trade)
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const instName = instrumentNames[trade.instrumentType] || trade.instrumentType;
    const statusLabel = orderType === 'limit' ? 'LIMIT ORDER (Planned)' : 'OPEN POSITION';
    const limitInfo = trade.limitPrice ? `\nLimit: $${trade.limitPrice.toFixed(2)}` : '';
    const manualNote = sizing._manualOverride ? `\n\uD83D\uDCCA System max: ${sizingContext.autoSizing?.units ?? '--'} ${sizing.unitLabel}` : '';
    addChatMessage(`\u2705 Trade saved as ${statusLabel}!\n\n\uD83D\uDCC8 ${trade.symbol} (${instName})\n\uD83D\uDCB0 Entry: $${trade.plannedEntry.toFixed(2)}${limitInfo}\n\uD83D\uDED1 Stop: $${trade.plannedStop.toFixed(2)}\n\uD83C\uDFAF Target: ${trade.plannedTarget ? '$' + trade.plannedTarget.toFixed(2) : '--'}\n\uD83D\uDCCA Size: ${sizing.units} ${sizing.unitLabel}${manualNote}\n\uD83D\uDCCA Risk: $${trade.plannedRiskAmount}\n\nUse Send To Execution Desk when you want to route the order.`, 'ai');
    syncTradePlanStoreFromDesk('trade_saved', {
      status: orderType === 'limit' ? 'saved_planned' : 'saved_open',
      savedTradeId: trade.id,
    });

    document.getElementById('btn-save-trade').textContent = '\u2713 Trade Saved';
    document.getElementById('btn-save-trade').disabled = true;
    document.getElementById('btn-save-trade').classList.add('is-saved');
  } catch (error) {
    console.error('Failed to save trade:', error);
    addChatMessage(`\u274C Failed to save trade: ${error.message}`, 'ai');
  }
}

async function calculateAndVerdict() {
  const result = await runVerdictEngine();
  if (!result) return;

  const { approved, layers, sizing, autoSizing, rr, targetProfit, settings } = result;
  const accountPercent = (sizing.positionValue / settings.accountSize) * 100;
  const instrumentNames = { stock: 'Stock/ETF', futures: 'Futures', options: 'Options', forex: 'Forex', crypto: 'Crypto' };

  document.getElementById('position-shares').textContent = sizing.units.toLocaleString();
  document.getElementById('position-value').textContent = '$' + sizing.positionValue.toLocaleString();
  document.getElementById('max-loss').textContent = '-$' + sizing.maxLoss.toFixed(0);
  document.getElementById('target-profit').textContent = '+$' + targetProfit.toFixed(0);
  document.getElementById('account-percent').textContent = accountPercent.toFixed(1) + '%';
  document.getElementById('position-unit-label').textContent = sizing.unitLabel;
  document.getElementById('position-sizing').classList.remove('hidden');

  if (settings.instrumentType === 'futures' || settings.instrumentType === 'forex') {
    document.getElementById('futures-margin-info').classList.remove('hidden');
    document.getElementById('futures-margin-detail').textContent = sizing.details;
    document.getElementById('position-value-label').textContent = 'Margin Required';
  } else {
    document.getElementById('futures-margin-info').classList.add('hidden');
    document.getElementById('position-value-label').textContent =
      settings.instrumentType === 'options' ? 'Premium Cost' : 'Position Value';
  }

  const verdict = approved ? 'APPROVED' : 'DENIED';
  const verdictEmoji = approved ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’';
  const failedLayers = layers.filter(l => !l.pass && !l.advisory);
  const cautionLayers = layers.filter(l => l.advisory && l.results.some(r => !r.pass));
  let verdictText = '';
  if (approved && cautionLayers.length > 0) {
    verdictText = `All checks passed. ${cautionLayers.length} advisory warning(s).`;
  } else if (approved) {
    verdictText = `All checks passed. ${sizing.units} ${sizing.unitLabel} within all limits.`;
  } else {
    verdictText = `Failed: ${failedLayers.map(l => l.layer).join(', ')}. See details below.`;
  }
  if (sizing._manualOverride) {
    verdictText += ` Manual size ${sizing.units} ${sizing.unitLabel}; system max ${autoSizing?.units ?? '--'}.`;
  }

  document.getElementById('verdict-title').textContent = verdict;
  document.getElementById('verdict-text').textContent = verdictText;
  document.getElementById('verdict-badge').textContent = verdictEmoji;
  document.getElementById('ai-verdict').classList.remove('hidden');

  const layersEl = document.getElementById('verdict-layers');
  layersEl.innerHTML = '';
  for (const layer of layers) {
    const cls = layer.advisory
      ? (layer.results.some(r => !r.pass) ? 'caution' : 'pass')
      : (layer.pass ? 'pass' : 'fail');
    const layerIcon = cls === 'pass' ? 'Ã¢Å“â€¦' : cls === 'fail' ? 'Ã¢ÂÅ’' : 'Ã¢Å¡Â Ã¯Â¸Â';
    const statusText = cls === 'pass' ? 'PASS' : cls === 'fail' ? 'FAIL' : 'CAUTION';
    const div = document.createElement('div');
    div.className = `verdict-layer ${cls}`;
    div.innerHTML = `
      <div class="flex items-center justify-between text-sm font-semibold">
        <span>${layerIcon} ${layer.layer}</span>
        <span class="text-xs ${cls === 'pass' ? 'text-green-400' : cls === 'fail' ? 'text-red-400' : 'text-yellow-400'}">${statusText}</span>
      </div>
      <div class="text-xs text-gray-400 mt-1">${layer.results.map(r => `${r.pass ? 'Ã¢Å“â€œ' : 'Ã¢Å“â€”'} ${r.msg}`).join('<br>')}</div>
    `;
    layersEl.appendChild(div);
  }

  const instName = instrumentNames[settings.instrumentType] || settings.instrumentType;
  let chatMsg = `**Position Analysis (${instName}):**\n`;
  chatMsg += `Ã¢â‚¬Â¢ ${sizing.units} ${sizing.unitLabel} @ $${entryPrice.toFixed(2)}\n`;
  chatMsg += `Ã¢â‚¬Â¢ Max loss: $${sizing.maxLoss.toFixed(0)} | Target: $${targetProfit.toFixed(0)}\n`;
  chatMsg += `Ã¢â‚¬Â¢ R:R: 1:${rr.toFixed(2)} | Account: ${accountPercent.toFixed(1)}%\n\n`;

  for (const layer of layers) {
    const icon = layer.advisory
      ? (layer.results.some(r => !r.pass) ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦')
      : (layer.pass ? 'Ã¢Å“â€¦' : 'Ã¢ÂÅ’');
    chatMsg += `**${icon} ${layer.layer}:** ${layer.pass ? 'PASS' : (layer.advisory ? 'CAUTION' : 'FAIL')}\n`;
    for (const r of layer.results) {
      chatMsg += `  ${r.pass ? 'Ã¢Å“â€œ' : 'Ã¢Å“â€”'} ${r.msg}\n`;
    }
    chatMsg += '\n';
  }

  chatMsg += `**Verdict: ${verdict}**\n${verdictText}`;
  addChatMessage(chatMsg, 'ai');

  window.lastVerdict = `${verdict}: ${verdictText}`;
  showSavePanel();
}
