// =========================================================================
// copilot-chat.js - Trading Desk chat and chart capture helpers
// Load after copilot-trading.js.
// =========================================================================

const DEFAULT_COPILOT_CHAT_HTML = `
  <div class="chat-message chat-ai" style="background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);font-size:var(--text-small);color:var(--color-text-subtle);">
    <p>Welcome! Enter a symbol above, set the timeframe on the chart header, and use Trade Actions for instrument setup and routing.</p>
    <p style="font-size:var(--text-caption);color:var(--color-text-muted);margin-top:var(--space-4);">I'll evaluate trend, Fibonacci levels, energy state, and selling pressure to give you a clear verdict.</p>
  </div>
`;

function resetCopilotChat(options = {}) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const symbol = String(options.symbol || '').trim().toUpperCase();
  const timeframe = String(options.timeframe || '').trim();
  const mode = String(options.mode || 'default').trim().toLowerCase();

  if (!symbol) {
    container.innerHTML = DEFAULT_COPILOT_CHAT_HTML;
    return;
  }

  const title = timeframe ? `${symbol} (${timeframe})` : symbol;
  let body = 'Chart context loaded. Previous analysis was cleared.';
  if (mode === 'loading') {
    body = 'Fetching a fresh AI analysis for this chart now.';
  } else if (mode === 'loaded') {
    body = 'Chart switched. Run Analyze Pattern or Calculate for a fresh AI read on this chart.';
  }

  container.innerHTML = `
    <div class="chat-message chat-ai" style="background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);font-size:var(--text-small);color:var(--color-text-subtle);">
      <p><strong>${title}</strong></p>
      <p style="margin-top:var(--space-4);">${body}</p>
    </div>
  `;
}

window.resetCopilotChat = resetCopilotChat;

function addChatMessage(text, sender) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message chat-${sender}`;
  div.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function quickChat(message) {
  const input = document.getElementById('chat-input');
  input.value = message;
  input.style.height = 'auto';
  sendChat();
}

async function captureChart() {
  const container = document.getElementById('chart-container');
  if (!container) {
    console.error('Chart container not found');
    return null;
  }

  try {
    console.log('Capturing chart...');
    const canvas = await html2canvas(container, {
      backgroundColor: '#1e1e1e',
      scale: 1,
      useCORS: true,
      logging: false,
    });
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    console.log('Chart captured, size:', base64.length, 'chars');
    return base64;
  } catch (error) {
    console.error('Failed to capture chart:', error);
    return null;
  }
}

async function sendChat(includeChart = false) {
  const input = document.getElementById('chat-input');
  let message = input.value.trim();

  if (!message && includeChart) {
    message = 'Analyze this chart';
  }

  if (!message) return;

  addChatMessage(message, 'user');
  input.value = '';
  input.style.height = 'auto';

  const settings = getSettings();
  const analysis = lastCopilotResult;
  const scannerHandoff = buildTradingDeskScannerHandoffContext();
  console.log('Chat context - lastCopilotResult:', analysis ? `${analysis.symbol} verdict=${analysis.verdict}` : 'null');
  const context = {
    symbol: analysis?.symbol || currentCandidate?.symbol || 'None selected',
    patternType: currentCandidate?.pattern_type || lastCopilotResult?.pattern_type || 'Unknown',
    entryPrice: entryPrice,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    accountSize: settings.accountSize,
    riskPercent: settings.riskPercent,
    instrumentType: settings.instrumentType,
    futuresMargin: settings.instrumentType === 'futures' ? settings.futuresMargin : undefined,
    futuresPointValue: settings.instrumentType === 'futures' ? settings.futuresPointValue : undefined,
    futuresTickSize: settings.instrumentType === 'futures' ? settings.futuresTickSize : undefined,
    optionStrike: settings.instrumentType === 'options' ? settings.optionStrike : undefined,
    optionExpiry: settings.instrumentType === 'options' ? settings.optionExpiry : undefined,
    optionEntryPremium: settings.instrumentType === 'options' ? settings.optionPrice : undefined,
    optionCurrentPremium: settings.instrumentType === 'options' ? settings.optionCurrentPremium : undefined,
    optionType: settings.instrumentType === 'options' ? settings.optionType : undefined,
    contractMultiplier: settings.instrumentType === 'options' ? settings.contractMultiplier : undefined,
    lotSize: settings.instrumentType === 'forex' ? settings.lotSize : undefined,
    pipValue: settings.instrumentType === 'forex' ? settings.pipValue : undefined,
    leverage: settings.instrumentType === 'forex' ? settings.leverage : undefined,
    exchangeFee: settings.instrumentType === 'crypto' ? settings.exchangeFee : undefined,
    minRR: settings.minRR,
    maxPosition: settings.maxPosition,
    aiModel: settings.aiModel,
    pluginEngineerModel: settings.pluginEngineerModel,
    aiTemperature: settings.aiTemperature,
    manualPositionSize: manualSizeOverride,
    calculatedPositionSize: livePnLSizing?.units || null,
    positionUnits: manualSizeOverride !== null ? manualSizeOverride : (livePnLSizing?.units || null),
    scannerHandoff,
    tradeDirection: riskPlanDirectionLabel() || null,
    copilotAnalysis: buildTradingDeskCopilotAnalysisPayload(analysis)
  };

  let chartImage = null;
  if (includeChart) {
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer && chartContainer.querySelector('canvas')) {
      addChatMessage('Ã°Å¸â€œÂ¸ Capturing chart for AI analysis...', 'ai');
      chartImage = await captureChart();
    } else {
      addChatMessage('Ã¢Å¡Â Ã¯Â¸Â No chart visible to capture. Run an analysis first.', 'ai');
    }
  }

  try {
    const response = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, settings, chartImage, role: 'copilot' })
    });

    if (response.ok) {
      const data = await response.json();
      const messages = document.getElementById('chat-messages');
      if (chartImage && messages.lastChild) {
        messages.removeChild(messages.lastChild);
      }
      addChatMessage(data.data?.response || data.response || 'No response from AI.', 'ai');
    } else {
      addChatMessage(generateLocalResponse(message, context), 'ai');
    }
  } catch (error) {
    addChatMessage(generateLocalResponse(message, context), 'ai');
  }
}

function generateLocalResponse(message, context) {
  const lower = message.toLowerCase();

  if (lower.includes('pattern') || lower.includes('think')) {
    return `Looking at ${context.symbol}, this appears to be a ${context.patternType} pattern. Set your stop loss and take profit levels, then click "Calculate" to see my full analysis.`;
  }
  if (lower.includes('entry') || lower.includes('good')) {
    if (!context.entryPrice) return 'Load a chart first so I can analyze the entry.';
    return `Current price is $${context.entryPrice.toFixed(2)}. Set your stop loss below the base/pullback low, and target at the prior high or 2-3x your risk distance.`;
  }
  if (lower.includes('stop') || lower.includes('loss')) {
    return 'For Wyckoff patterns, place your stop loss just below the base or the most recent pullback low. This protects you if the pattern fails.';
  }
  if (lower.includes('target') || lower.includes('profit')) {
    return 'Target the prior peak level, or use a 2:1 or 3:1 reward-to-risk ratio. The prior peak often acts as resistance on the first test.';
  }

  return 'I\'m here to help with your trade analysis. Set your levels on the chart and click "Calculate" for a full position sizing breakdown.';
}
