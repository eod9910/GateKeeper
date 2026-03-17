// =========================================================================
// ai-chat.js — Scanner AI copilot chat, AI analysis, ML scores, drag mode
// =========================================================================

let aiAvailable = false;
let aiStatusProviderLabel = 'Ready';
const SCANNER_FUNDAMENTALS_TIMEOUT_MS = 10000;
const scannerChatAttachments = {
  'scanner-chat-input': null,
  'fundamentals-chat-input': null,
};

function getChatAttachmentContainerId(inputId) {
  return inputId === 'fundamentals-chat-input'
    ? 'fundamentals-chat-attachment'
    : 'scanner-chat-attachment';
}

function getChatAttachmentWrapperId(inputId) {
  return inputId === 'fundamentals-chat-input'
    ? 'fundamentals-chat-composer'
    : 'scanner-chat-input-row';
}

function getChatAttachment(inputId) {
  return scannerChatAttachments[inputId] || null;
}

function getChatAttachmentDefaultPrompt(inputId) {
  return inputId === 'fundamentals-chat-input'
    ? 'Use the attached chart image and the fundamentals together. What stands out?'
    : 'Use the attached chart image and my markings. What do you see?';
}

function renderChatAttachment(inputId) {
  const container = document.getElementById(getChatAttachmentContainerId(inputId));
  const wrapper = document.getElementById(getChatAttachmentWrapperId(inputId));
  if (!container) return;

  const attachment = getChatAttachment(inputId);
  container.innerHTML = '';
  if (!attachment?.dataUrl) {
    container.classList.add('hidden');
    if (wrapper) wrapper.classList.remove('has-attachment');
    return;
  }

  const chip = document.createElement('div');
  chip.className = 'chat-attachment-chip';

  const thumb = document.createElement('img');
  thumb.src = attachment.dataUrl;
  thumb.alt = 'Pasted image attachment preview';

  const body = document.createElement('div');
  body.className = 'chat-attachment-chip__body';

  const label = document.createElement('div');
  label.className = 'chat-attachment-chip__label';
  label.textContent = attachment.name || 'Pasted image';

  const meta = document.createElement('div');
  meta.className = 'chat-attachment-chip__meta';
  meta.textContent = 'Will be sent with the next message';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'chat-attachment-chip__remove';
  removeBtn.setAttribute('aria-label', 'Remove pasted image');
  removeBtn.textContent = 'x';
  removeBtn.onclick = () => clearChatAttachment(inputId);

  body.appendChild(label);
  body.appendChild(meta);
  chip.appendChild(thumb);
  chip.appendChild(body);
  chip.appendChild(removeBtn);
  container.appendChild(chip);
  container.classList.remove('hidden');
  if (wrapper) wrapper.classList.add('has-attachment');
}

function setChatAttachment(inputId, attachment) {
  scannerChatAttachments[inputId] = attachment || null;
  renderChatAttachment(inputId);
}

function clearChatAttachment(inputId) {
  scannerChatAttachments[inputId] = null;
  renderChatAttachment(inputId);
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read pasted image.'));
    reader.readAsDataURL(blob);
  });
}

async function handleChatImagePaste(event, inputId = 'scanner-chat-input') {
  const items = Array.from(event?.clipboardData?.items || []);
  const imageItem = items.find((item) => item && item.kind === 'file' && /^image\//i.test(item.type || ''));
  if (!imageItem) return;

  event.preventDefault();
  try {
    const file = imageItem.getAsFile();
    if (!file) throw new Error('Clipboard image was unavailable.');
    const dataUrl = await readBlobAsDataUrl(file);
    if (!dataUrl) throw new Error('Clipboard image was empty.');
    setChatAttachment(inputId, {
      dataUrl,
      name: file.name || 'Pasted image',
      mime: file.type || 'image/png',
    });
    setScannerChatStatus('Image attached', inputId === 'fundamentals-chat-input' ? 'fundamentals-chat-status' : 'ai-status');
  } catch (err) {
    appendScannerChatMessage(`Image paste failed: ${err.message}`, 'ai', inputId === 'fundamentals-chat-input' ? 'fundamentals-chat-messages' : 'scanner-chat-messages', { animate: false });
  }
}

function handleScannerChatPaste(event) {
  return handleChatImagePaste(event, 'scanner-chat-input');
}

function handleFundamentalsChatPaste(event) {
  return handleChatImagePaste(event, 'fundamentals-chat-input');
}

function formatScannerAnalysisLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return '-';
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function renderScannerAnalysisList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  const values = Array.isArray(items) ? items.filter((item) => String(item || '').trim()) : [];
  if (!values.length) {
    const empty = document.createElement('li');
    empty.className = 'is-empty';
    empty.textContent = '-';
    el.appendChild(empty);
    return;
  }
  values.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = String(item);
    el.appendChild(li);
  });
}

function mountScannerReviewWidgets() {
  const panel = document.getElementById('ai-review-panel');
  if (!panel || panel.dataset.mounted === 'true') return;

  const analysisSlot = document.getElementById('ai-review-analysis-slot');
  const mlSlot = document.getElementById('ai-review-ml-slot');
  const feedbackSlot = document.getElementById('ai-review-feedback-slot');
  const analysisEl = document.getElementById('ai-result');
  const mlEl = document.getElementById('ml-scores');
  const feedbackEl = document.getElementById('ai-feedback');

  if (analysisSlot && analysisEl) {
    analysisEl.classList.remove('scanner-chat-bubble', 'ai');
    analysisSlot.appendChild(analysisEl);
  }
  if (mlSlot && mlEl) {
    mlSlot.appendChild(mlEl);
  }
  if (feedbackSlot && feedbackEl) {
    const legacyControlBlock = feedbackEl.querySelector('.mt-3.pt-2.border-t.border-gray-600');
    if (legacyControlBlock) legacyControlBlock.remove();
    feedbackSlot.appendChild(feedbackEl);
  }

  panel.dataset.mounted = 'true';
}

function mountScannerFundamentalsPanel() {
  const shell = document.getElementById('scanner-fundamentals-shell');
  const host = document.getElementById('scanner-fundamentals-host');
  const panel = document.getElementById('fundamentals-panel');
  if (!shell || !host || !panel || panel.dataset.mountedScannerShell === 'true') return;

  host.appendChild(panel);
  panel.style.borderTop = 'none';
  panel.style.paddingTop = '0';
  panel.style.marginBottom = '0';
  panel.dataset.mountedScannerShell = 'true';
}

function applyScannerFullWidthLayout() {
  const grid = document.getElementById('scanner-main-grid');
  if (!grid || grid.dataset.fullWidthApplied === 'true') return;

  const leftCol = grid.children?.[0];
  const rightCol = grid.children?.[1];
  const chartPanel = document.getElementById('chart-container')?.closest('.panel');
  const aiPanel = document.getElementById('ai-panel');
  const chatShell = document.getElementById('scanner-chat-shell');
  const aiReviewPanel = document.getElementById('ai-review-panel');
  const correctionPanel = document.getElementById('correction-panel');
  const candidateInfoPanel = document.getElementById('candidate-info-panel');
  const labelPanel = rightCol?.children?.[1] || null;

  if (candidateInfoPanel) {
    candidateInfoPanel.style.display = 'none';
    candidateInfoPanel.classList.add('hidden');
  }

  grid.style.gridTemplateColumns = '1fr';
  grid.classList.remove('chat-collapsed');

  if (leftCol && chartPanel && chatShell) {
    leftCol.insertBefore(chatShell, aiReviewPanel || chartPanel.nextSibling);
  }
  if (leftCol && aiReviewPanel && correctionPanel && correctionPanel.parentElement !== leftCol) {
    leftCol.insertBefore(correctionPanel, aiReviewPanel.nextSibling);
  }
  if (leftCol && correctionPanel && labelPanel && labelPanel.parentElement !== leftCol) {
    leftCol.insertBefore(labelPanel, correctionPanel.nextSibling);
  }

  if (aiPanel) {
    aiPanel.classList.remove('collapsed');
  }
  if (rightCol) {
    rightCol.style.display = 'none';
  }

  grid.dataset.fullWidthApplied = 'true';
  window.dispatchEvent(new Event('resize'));
}

function formatScannerPriceRange(low, high) {
  const lowNum = Number(low);
  const highNum = Number(high);
  if (!Number.isFinite(lowNum) && !Number.isFinite(highNum)) return '-';
  if (!Number.isFinite(lowNum)) return `$${highNum.toFixed(2)}`;
  if (!Number.isFinite(highNum)) return `$${lowNum.toFixed(2)}`;
  return `$${Math.min(lowNum, highNum).toFixed(2)} - $${Math.max(lowNum, highNum).toFixed(2)}`;
}

function setAICorrectionStatus(message = '', tone = 'muted') {
  const el = document.getElementById('ai-correction-status');
  if (!el) return;
  const toneMap = {
    muted: 'var(--color-text-subtle)',
    success: 'var(--color-positive)',
    warning: 'var(--color-warning)',
    error: 'var(--color-negative)',
  };
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.style.color = toneMap[tone] || toneMap.muted;
  el.classList.remove('hidden');
}

function renderAIBaseReview(candidate) {
  if (!candidate && typeof candidates !== 'undefined' && typeof currentIndex !== 'undefined') {
    candidate = candidates?.[currentIndex];
  }
  const panel = document.getElementById('ai-base-review');
  const detectorEl = document.getElementById('ai-detector-base');
  const modelEl = document.getElementById('ai-model-base');
  const correctedEl = document.getElementById('ai-corrected-base');
  const noteEl = document.getElementById('ai-base-review-note');
  if (!panel || !detectorEl || !modelEl || !correctedEl || !noteEl) return;

  const detectorHigh = Number(candidate?.base?.high);
  const detectorLow = Number(candidate?.base?.low);
  const modelHigh = firstFiniteNumber(originalAILevels?.baseHigh, originalAILevels?.baseTop);
  const modelLow = firstFiniteNumber(originalAILevels?.baseLow, originalAILevels?.baseBottom);
  const correctedHigh = firstFiniteNumber(correctedAILevels?.baseHigh, correctedAILevels?.baseTop, modelHigh, detectorHigh);
  const correctedLow = firstFiniteNumber(correctedAILevels?.baseLow, correctedAILevels?.baseBottom, modelLow, detectorLow);

  const hasAnyBase = [detectorHigh, detectorLow, modelHigh, modelLow, correctedHigh, correctedLow].some((value) => Number.isFinite(Number(value)));
  panel.classList.toggle('hidden', !hasAnyBase);
  if (!hasAnyBase) {
    detectorEl.textContent = '-';
    modelEl.textContent = '-';
    correctedEl.textContent = '-';
    noteEl.textContent = 'This analysis did not return a usable base range to correct.';
    return;
  }

  detectorEl.textContent = formatScannerPriceRange(detectorLow, detectorHigh);
  modelEl.textContent = formatScannerPriceRange(modelLow, modelHigh);
  correctedEl.textContent = formatScannerPriceRange(correctedLow, correctedHigh);

  if (Number.isFinite(modelHigh) && Number.isFinite(modelLow)) {
    noteEl.textContent = 'Adjust the AI base lines on the chart, then save the corrected base range as durable training data.';
  } else if (Number.isFinite(detectorHigh) && Number.isFinite(detectorLow)) {
    noteEl.textContent = 'The AI did not emit separate base levels here. You can still review the detector base, but persistent correction training is base-focused.';
  } else {
    noteEl.textContent = 'No detector or AI base range is available on this setup yet.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyScannerFullWidthLayout();
  mountScannerReviewWidgets();
  mountScannerFundamentalsPanel();
});

function resetScannerChatVisualState() {
  mountScannerReviewWidgets();
  const reviewPanel = document.getElementById('ai-review-panel');
  const reviewStatus = document.getElementById('ai-review-status');
  const baseReview = document.getElementById('ai-base-review');
  const resultDiv = document.getElementById('ai-result');
  const errorDiv = document.getElementById('ai-error');
  const suggestions = document.getElementById('ai-suggestions');
  const mlScores = document.getElementById('ml-scores');
  const feedbackSaved = document.getElementById('ai-feedback-saved');
  const dragInstruction = document.getElementById('drag-instruction');
  const dragBtn = document.getElementById('btn-drag-levels');
  const correctionCount = document.getElementById('correction-count');
  const saveCorrections = document.getElementById('btn-save-corrections');
  const btnCorrect = document.getElementById('btn-ai-correct');
  const btnIncorrect = document.getElementById('btn-ai-incorrect');

  if (reviewPanel) reviewPanel.classList.add('hidden');
  if (reviewStatus) reviewStatus.textContent = 'Run Analyze Chart';
  if (baseReview) baseReview.classList.add('hidden');
  if (resultDiv) resultDiv.classList.add('hidden');
  if (errorDiv) {
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
  }
  ['ai-primary-pattern', 'ai-alternative-pattern', 'ai-state-assessment', 'ai-timing', 'ai-explanation', 'ai-confidence'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'ai-confidence' ? '' : '-';
  });
  renderScannerAnalysisList('ai-top-reasons', []);
  renderScannerAnalysisList('ai-top-risks', []);
  if (suggestions) {
    suggestions.classList.add('hidden');
    suggestions.innerHTML = '';
  }
  if (mlScores) mlScores.classList.add('hidden');
  if (feedbackSaved) feedbackSaved.classList.add('hidden');
  setAICorrectionStatus('');
  if (dragInstruction) dragInstruction.classList.add('hidden');
  if (correctionCount) {
    correctionCount.classList.add('hidden');
    correctionCount.textContent = '';
  }
  if (saveCorrections) saveCorrections.classList.add('hidden');
  if (dragBtn) {
    dragBtn.classList.add('hidden');
    dragBtn.textContent = 'Adjust On Chart';
    dragBtn.classList.remove('bg-yellow-600');
    dragBtn.classList.add('bg-purple-600');
  }
  if (btnCorrect) btnCorrect.disabled = true;
  if (btnIncorrect) btnIncorrect.disabled = true;
}

function inferAITradeDirection(levels) {
  const entry = Number(levels?.suggestedEntry);
  const stop = Number(levels?.suggestedStop);
  const target = Number(levels?.suggestedTarget);
  if (!Number.isFinite(entry)) return 'neutral';
  if (Number.isFinite(stop) && Number.isFinite(target)) {
    if (target < entry && stop > entry) return 'short';
    if (target > entry && stop < entry) return 'long';
  }
  if (Number.isFinite(target)) {
    if (target < entry) return 'short';
    if (target > entry) return 'long';
  }
  if (Number.isFinite(stop)) {
    if (stop > entry) return 'short';
    if (stop < entry) return 'long';
  }
  return 'neutral';
}

function clearScannerAILevels() {
  if (typeof aiPriceLines !== 'undefined' && Array.isArray(aiPriceLines) && typeof patternSeries !== 'undefined' && patternSeries) {
    aiPriceLines.forEach(item => { try { patternSeries.removePriceLine(item.line); } catch (e) {} });
  }
  if (typeof aiPriceLines !== 'undefined') aiPriceLines = [];
  if (typeof originalAILevels !== 'undefined') originalAILevels = null;
  if (typeof correctedAILevels !== 'undefined') correctedAILevels = {};
  if (typeof aiLevelsVisible !== 'undefined') aiLevelsVisible = true;
  if (typeof dragMode !== 'undefined') dragMode = false;
  if (typeof draggingLine !== 'undefined') draggingLine = null;
  if (typeof updateAILevelsToggleButton === 'function') updateAILevelsToggleButton();
}

function resetChatThread(containerId, welcomeText) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  appendScannerChatMessage(welcomeText, 'ai', containerId);
}

function clearScannerChatSession(symbol, timeframe) {
  const aiPanel = document.getElementById('ai-panel');
  const scannerInput = document.getElementById('scanner-chat-input');
  const fundamentalsInput = document.getElementById('fundamentals-chat-input');

  clearScannerAILevels();
  resetScannerChatVisualState();

  if (typeof lastAIAnalysis !== 'undefined') {
    lastAIAnalysis = null;
  }

  resetChatThread('scanner-chat-messages', 'Welcome. Ask about this setup, or run AI chart analysis.');
  resetChatThread('fundamentals-chat-messages', 'Ask how these fundamentals change the quality, risk, or timing of the current scanner setup.');
  if (symbol) {
    appendScannerChatMessage(`Loaded ${symbol}${timeframe ? ` (${timeframe})` : ''}. New session started.`, 'ai', 'scanner-chat-messages');
    appendScannerChatMessage(`Loaded ${symbol}${timeframe ? ` (${timeframe})` : ''}. Fundamentals context refreshed.`, 'ai', 'fundamentals-chat-messages');
  }

  if (scannerInput) {
    scannerInput.value = '';
    autoResizeScannerChatInput('scanner-chat-input');
  }
  if (fundamentalsInput) {
    fundamentalsInput.value = '';
    autoResizeScannerChatInput('fundamentals-chat-input');
  }
  clearChatAttachment('scanner-chat-input');
  clearChatAttachment('fundamentals-chat-input');

  if (aiPanel) {
    aiPanel.dataset.loadedSymbol = symbol || '';
  }

  setScannerChatStatus('Ready');
  setScannerChatStatus('Ready', 'fundamentals-chat-status');
}

function clearFundamentalsChatSession() {
  resetChatThread('fundamentals-chat-messages', 'Ask how these fundamentals change the quality, risk, or timing of the current scanner setup.');
  const input = document.getElementById('fundamentals-chat-input');
  if (input) {
    input.value = '';
    autoResizeScannerChatInput('fundamentals-chat-input');
  }
  clearChatAttachment('fundamentals-chat-input');
  setScannerChatStatus('Ready', 'fundamentals-chat-status');
}

function buildFundamentalsContext(snapshot) {
  if (!snapshot) return null;
  return {
    companyName: snapshot.companyName || null,
    sector: snapshot.sector || null,
    industry: snapshot.industry || null,
    marketCap: snapshot.marketCap ?? null,
    earningsDate: snapshot.earningsDate || null,
    shortFloatPct: snapshot.shortFloatPct ?? null,
    relativeVolume: snapshot.relativeVolume ?? null,
    revenueGrowthPct: snapshot.revenueGrowthPct ?? null,
    earningsGrowthPct: snapshot.earningsGrowthPct ?? null,
    grossMarginPct: snapshot.grossMarginPct ?? null,
    profitMarginPct: snapshot.profitMarginPct ?? null,
    debtToEquity: snapshot.debtToEquity ?? null,
    currentRatio: snapshot.currentRatio ?? null,
    operatingCashFlowTTM: snapshot.operatingCashFlowTTM ?? null,
    freeCashFlowTTM: snapshot.freeCashFlowTTM ?? null,
    quarterlyCashBurn: snapshot.quarterlyCashBurn ?? null,
    cashRunwayQuarters: snapshot.cashRunwayQuarters ?? null,
    cashPctMarketCap: snapshot.cashPctMarketCap ?? null,
    revenueYoYGrowthPct: snapshot.revenueYoYGrowthPct ?? null,
    revenueQoQGrowthPct: snapshot.revenueQoQGrowthPct ?? null,
    revenueTrendFlag: snapshot.revenueTrendFlag || null,
    epsYoYGrowthPct: snapshot.epsYoYGrowthPct ?? null,
    epsQoQGrowthPct: snapshot.epsQoQGrowthPct ?? null,
    epsSurprisePct: snapshot.epsSurprisePct ?? null,
    salesSurprisePct: snapshot.salesSurprisePct ?? null,
    sharesOutstandingYoYChangePct: snapshot.sharesOutstandingYoYChangePct ?? null,
    dilutionFlag: snapshot.dilutionFlag ?? null,
    recentFinancingFlag: snapshot.recentFinancingFlag ?? null,
    daysUntilEarnings: snapshot.daysUntilEarnings ?? null,
    lastEarningsDate: snapshot.lastEarningsDate || null,
    catalystFlag: snapshot.catalystFlag || null,
    squeezePressureScore: snapshot.squeezePressureScore ?? null,
    squeezePressureLabel: snapshot.squeezePressureLabel || null,
    enterpriseValue: snapshot.enterpriseValue ?? null,
    enterpriseToSales: snapshot.enterpriseToSales ?? null,
    netCash: snapshot.netCash ?? null,
    lowEnterpriseValueFlag: snapshot.lowEnterpriseValueFlag ?? null,
    quality: snapshot.quality || null,
    holdContext: snapshot.holdContext || null,
    tacticalGrade: snapshot.tacticalGrade || null,
    tacticalScore: snapshot.tacticalScore ?? null,
    reportedExecutionScore: snapshot.reportedExecutionScore ?? null,
    forwardExpectationsScore: snapshot.forwardExpectationsScore ?? null,
    positioningScore: snapshot.positioningScore ?? null,
    marketContextScore: snapshot.marketContextScore ?? null,
    riskNote: snapshot.riskNote || null,
    reportedExecution: snapshot.reportedExecution || null,
    forwardExpectations: snapshot.forwardExpectations || null,
    positioning: snapshot.positioning || null,
    marketContext: snapshot.marketContext || null,
    ownership: snapshot.ownership || null,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
  };
}

function asFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = asFiniteNumber(value);
    if (num !== null) return num;
  }
  return null;
}

function buildDetectorContext(candidate) {
  if (!candidate) return null;
  const anchors = candidate && typeof candidate.anchors === 'object' && candidate.anchors ? candidate.anchors : {};
  const base = candidate && typeof candidate.base === 'object' && candidate.base ? candidate.base : {};

  return {
    patternType: candidate.pattern_type || null,
    candidateRole: candidate.candidate_role || null,
    candidateActionability: candidate.candidate_actionability || null,
    semanticSummary: candidate.candidate_semantic_summary || null,
    activeBaseState: anchors.base_state || null,
    activeBaseTop: firstFiniteNumber(anchors.base_top, base.high),
    activeBaseBottom: firstFiniteNumber(anchors.base_bottom, base.low),
    activeBaseAtr: asFiniteNumber(anchors.active_base_atr),
    activeBaseExtensionAtr: asFiniteNumber(anchors.active_base_extension_atr),
    activeBaseDownsideAtr: asFiniteNumber(anchors.active_base_downside_atr),
    activeBaseBreakoutAgeBars: asFiniteNumber(anchors.active_base_breakout_age_bars),
    baseStartDate: base.start_date || null,
    baseEndDate: base.end_date || null,
    baseDurationBars: asFiniteNumber(base.duration),
    peakPrice: asFiniteNumber(anchors.peak_price),
    retracementPct: candidate.retracement_pct ?? null,
    rankScore: firstFiniteNumber(anchors.rank_score, candidate.score),
    structuralScore: asFiniteNumber(anchors.structural_score),
    scale: anchors.scale || null,
    recovered: typeof anchors.recovered === 'boolean' ? anchors.recovered : null,
  };
}

function buildDetectorMessageBlock(detector) {
  if (!detector) return '';
  return `\nDETECTOR_CONTEXT:\n- pattern_type: ${detector.patternType || 'N/A'}\n- active_base_state: ${detector.activeBaseState || 'N/A'}\n- active_base_top: ${detector.activeBaseTop ?? 'N/A'}\n- active_base_bottom: ${detector.activeBaseBottom ?? 'N/A'}\n- active_base_atr: ${detector.activeBaseAtr ?? 'N/A'}\n- active_base_extension_atr: ${detector.activeBaseExtensionAtr ?? 'N/A'}\n- active_base_breakout_age_bars: ${detector.activeBaseBreakoutAgeBars ?? 'N/A'}\n- structural_score: ${detector.structuralScore ?? 'N/A'}\n- rank_score: ${detector.rankScore ?? 'N/A'}\n- scale: ${detector.scale || 'N/A'}\n- recovered: ${detector.recovered ?? 'N/A'}\n`;
}

async function ensureScannerFundamentals(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return null;

  if (typeof fundamentalsCache !== 'undefined' && fundamentalsCache.has(normalized)) {
    return fundamentalsCache.get(normalized);
  }

  try {
    const apiBase = typeof API_URL === 'string' ? API_URL : '';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), SCANNER_FUNDAMENTALS_TIMEOUT_MS)
      : null;
    const res = await fetch(`${apiBase}/api/fundamentals/${encodeURIComponent(normalized)}`, controller
      ? { signal: controller.signal }
      : undefined);
    if (timeoutId) clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data) return null;
    if (typeof fundamentalsCache !== 'undefined') {
      fundamentalsCache.set(normalized, data.data);
    }
    return data.data;
  } catch (err) {
    console.warn('Failed to fetch fundamentals for AI context:', normalized, err);
    return null;
  }
}

function buildFundamentalsMessageBlock(snapshot) {
  if (!snapshot) return '';
  const lines = [
    `- quality: ${snapshot.quality || 'N/A'}`,
    `- hold_context: ${snapshot.holdContext || 'N/A'}`,
    `- risk_note: ${snapshot.riskNote || 'N/A'}`,
    `- sector: ${snapshot.sector || 'N/A'}`,
    `- industry: ${snapshot.industry || 'N/A'}`,
    `- market_cap: ${snapshot.marketCap ?? 'N/A'}`,
    `- revenue_growth_pct: ${snapshot.revenueGrowthPct ?? 'N/A'}`,
    `- earnings_growth_pct: ${snapshot.earningsGrowthPct ?? 'N/A'}`,
    `- gross_margin_pct: ${snapshot.grossMarginPct ?? 'N/A'}`,
    `- profit_margin_pct: ${snapshot.profitMarginPct ?? 'N/A'}`,
    `- debt_to_equity: ${snapshot.debtToEquity ?? 'N/A'}`,
    `- current_ratio: ${snapshot.currentRatio ?? 'N/A'}`,
    `- op_cf_ttm: ${snapshot.operatingCashFlowTTM ?? 'N/A'}`,
    `- fcf_ttm: ${snapshot.freeCashFlowTTM ?? 'N/A'}`,
    `- burn_per_quarter: ${snapshot.quarterlyCashBurn ?? 'N/A'}`,
    `- cash_runway_quarters: ${snapshot.cashRunwayQuarters ?? 'N/A'}`,
    `- cash_pct_market_cap: ${snapshot.cashPctMarketCap ?? 'N/A'}`,
    `- revenue_yoy_growth_pct: ${snapshot.revenueYoYGrowthPct ?? 'N/A'}`,
    `- revenue_qoq_growth_pct: ${snapshot.revenueQoQGrowthPct ?? 'N/A'}`,
    `- revenue_trend_flag: ${snapshot.revenueTrendFlag || 'N/A'}`,
    `- eps_yoy_growth_pct: ${snapshot.epsYoYGrowthPct ?? 'N/A'}`,
    `- eps_qoq_growth_pct: ${snapshot.epsQoQGrowthPct ?? 'N/A'}`,
    `- eps_surprise_pct: ${snapshot.epsSurprisePct ?? 'N/A'}`,
    `- sales_surprise_pct: ${snapshot.salesSurprisePct ?? 'N/A'}`,
    `- shares_yoy_change_pct: ${snapshot.sharesOutstandingYoYChangePct ?? 'N/A'}`,
    `- dilution_flag: ${snapshot.dilutionFlag ?? 'N/A'}`,
    `- recent_financing_flag: ${snapshot.recentFinancingFlag ?? 'N/A'}`,
    `- short_float_pct: ${snapshot.shortFloatPct ?? 'N/A'}`,
    `- short_ratio: ${snapshot.shortRatio ?? 'N/A'}`,
    `- relative_volume: ${snapshot.relativeVolume ?? 'N/A'}`,
    `- squeeze_pressure_score: ${snapshot.squeezePressureScore ?? 'N/A'}`,
    `- catalyst_flag: ${snapshot.catalystFlag || 'N/A'}`,
    `- earnings_date: ${snapshot.earningsDate || 'N/A'}`,
    `- days_until_earnings: ${snapshot.daysUntilEarnings ?? 'N/A'}`,
    `- last_earnings_date: ${snapshot.lastEarningsDate || 'N/A'}`,
    `- enterprise_value: ${snapshot.enterpriseValue ?? 'N/A'}`,
    `- enterprise_to_sales: ${snapshot.enterpriseToSales ?? 'N/A'}`,
    `- net_cash: ${snapshot.netCash ?? 'N/A'}`,
    `- low_enterprise_value_flag: ${snapshot.lowEnterpriseValueFlag ?? 'N/A'}`,
    `- tactical_grade: ${snapshot.tacticalGrade || 'N/A'}`,
    `- tactical_score: ${snapshot.tacticalScore ?? 'N/A'}`,
    `- reported_execution_score: ${snapshot.reportedExecutionScore ?? 'N/A'}`,
    `- forward_expectations_score: ${snapshot.forwardExpectationsScore ?? 'N/A'}`,
    `- positioning_score: ${snapshot.positioningScore ?? 'N/A'}`,
    `- market_context_score: ${snapshot.marketContextScore ?? 'N/A'}`,
    `- tags: ${Array.isArray(snapshot.tags) ? snapshot.tags.map(tag => tag.label).join(', ') : 'N/A'}`
  ];

  if (snapshot.reportedExecution) {
    const execution = snapshot.reportedExecution;
    lines.push(
      `\n[REPORTED_EXECUTION]`,
      `- beat_streak_q: ${execution.epsBeatStreak ?? 'N/A'}`,
      `- miss_streak_q: ${execution.epsMissStreak ?? 'N/A'}`,
      `- avg_eps_surprise_pct: ${execution.avgEpsSurprisePct ?? 'N/A'}`,
      `- avg_sales_surprise_pct: ${execution.avgSalesSurprisePct ?? 'N/A'}`,
    );
    if (Array.isArray(execution.history) && execution.history.length > 0) {
      const recent = execution.history.slice(0, 4);
      lines.push(`- recent_earnings: ${recent.map(e => `${e.period || '?'} eps=${e.epsActual ?? '?'} est=${e.epsEstimate ?? '?'} beat=${e.epsSurprisePct != null ? e.epsSurprisePct + '%' : '?'}`).join(' | ')}`);
    }
  }

  if (snapshot.forwardExpectations) {
    const forward = snapshot.forwardExpectations;
    lines.push(
      `\n[FORWARD_EXPECTATIONS]`,
      `- signal: ${forward.signal || 'N/A'}`,
      `- current_qtr_growth_pct: ${forward.currentQtrGrowthPct ?? 'N/A'}`,
      `- next_qtr_growth_pct: ${forward.nextQtrGrowthPct ?? 'N/A'}`,
      `- current_year_growth_pct: ${forward.currentYearGrowthPct ?? 'N/A'}`,
      `- next_year_growth_pct: ${forward.nextYearGrowthPct ?? 'N/A'}`,
    );
  }

  if (snapshot.positioning) {
    const positioning = snapshot.positioning;
    lines.push(
      `\n[POSITIONING]`,
      `- insider_signal: ${positioning.signal || 'N/A'}`,
      `- recent_buys: ${positioning.recentBuyCount ?? 'N/A'}`,
      `- recent_sales: ${positioning.recentSellCount ?? 'N/A'}`,
      `- recent_buy_value: ${positioning.recentBuyValue ?? 'N/A'}`,
      `- recent_sell_value: ${positioning.recentSellValue ?? 'N/A'}`,
    );
  }

  if (snapshot.marketContext) {
    const market = snapshot.marketContext;
    lines.push(
      `\n[MARKET_CONTEXT]`,
      `- above_50_day: ${market.above50Day ?? 'N/A'}`,
      `- above_200_day: ${market.above200Day ?? 'N/A'}`,
      `- price_vs_50_day_pct: ${market.priceVs50DayPct ?? 'N/A'}`,
      `- price_vs_200_day_pct: ${market.priceVs200DayPct ?? 'N/A'}`,
      `- price_vs_52_week_range_pct: ${market.priceVs52WeekRangePct ?? 'N/A'}`,
    );
  }

  if (snapshot.ownership && Array.isArray(snapshot.ownership.topInstitutionalHolders) && snapshot.ownership.topInstitutionalHolders.length > 0) {
    lines.push(`\n[OWNERSHIP]`, `- top_institutions: ${snapshot.ownership.topInstitutionalHolders.slice(0, 5).map(h => h.holder).join(', ')}`);
  }

  return `\nFUNDAMENTALS_SNAPSHOT:\n${lines.join('\n')}\n`;
}

function shouldAnimateScannerChatMessage(text, sender, options = {}) {
  if (options.animate === false) return false;
  if (options.animate === true) return true;
  if (sender !== 'ai') return false;
  const value = String(text || '');
  return value.length >= 140 && !/^Loaded\s|^Preview failed:|^Chat failed:|^Analysis failed:|^Analyzing\s/i.test(value);
}

function animateScannerChatBubble(bubble, container, text) {
  const content = String(text || '');
  const chunks = content.match(/(\S+\s*|\n+)/g) || [content];
  const totalChunks = chunks.length;
  const chunkSize = totalChunks > 120 ? 4 : totalChunks > 60 ? 3 : 2;
  const frameDelay = totalChunks > 120 ? 14 : 20;
  let index = 0;

  return new Promise((resolve) => {
    const tick = () => {
      const next = chunks.slice(index, index + chunkSize).join('');
      bubble.textContent += next;
      index += chunkSize;
      container.scrollTop = container.scrollHeight;
      if (index >= totalChunks) {
        resolve();
        return;
      }
      window.setTimeout(tick, frameDelay);
    };
    tick();
  });
}

function appendScannerChatMessage(text, sender = 'ai', containerId = 'scanner-chat-messages', options = {}) {
  const container = document.getElementById(containerId);
  if (!container || !text) return Promise.resolve();
  const bubble = document.createElement('div');
  bubble.className = `scanner-chat-bubble ${sender === 'user' ? 'user' : 'ai'}`;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  if (!shouldAnimateScannerChatMessage(text, sender, options)) {
    bubble.textContent = String(text);
    container.scrollTop = container.scrollHeight;
    return Promise.resolve();
  }
  bubble.textContent = '';
  return animateScannerChatBubble(bubble, container, text);
}

function setScannerChatStatus(text, statusId = 'ai-status') {
  const el = document.getElementById(statusId);
  if (!el) return;
  if (!text || text === 'Ready') {
    el.textContent = aiAvailable ? aiStatusProviderLabel : 'Ready';
    return;
  }
  el.textContent = text;
}

function autoResizeScannerChatInput(inputId = 'scanner-chat-input') {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.style.height = '82px';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function getStoredCopilotSettings() {
  try {
    return JSON.parse(localStorage.getItem('copilotSettings') || '{}');
  } catch (err) {
    return {};
  }
}

let lastScannerChartCaptureDataUrl = null;
let scannerChartCaptureCrop = null;
let scannerChartCaptureDrag = null;

function setScannerCapturePreviewStatus(text) {
  const el = document.getElementById('scanner-capture-preview-status');
  if (el) el.textContent = text;
}

function clearScannerChartCaptureCropState() {
  scannerChartCaptureCrop = null;
  scannerChartCaptureDrag = null;
}

function getScannerCapturePreviewMetrics() {
  const previewImage = document.getElementById('scanner-capture-preview-image');
  if (!previewImage || !previewImage.naturalWidth || !previewImage.naturalHeight) return null;
  const rect = previewImage.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    previewImage,
    rect,
    displayWidth: rect.width,
    displayHeight: rect.height,
    naturalWidth: previewImage.naturalWidth,
    naturalHeight: previewImage.naturalHeight,
  };
}

function clampScannerCaptureValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeScannerCaptureDisplayRect(startX, startY, endX, endY, maxWidth, maxHeight) {
  const left = clampScannerCaptureValue(Math.min(startX, endX), 0, maxWidth);
  const top = clampScannerCaptureValue(Math.min(startY, endY), 0, maxHeight);
  const right = clampScannerCaptureValue(Math.max(startX, endX), 0, maxWidth);
  const bottom = clampScannerCaptureValue(Math.max(startY, endY), 0, maxHeight);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function scannerCaptureDisplayRectToNatural(rect, metrics) {
  const scaleX = metrics.naturalWidth / metrics.displayWidth;
  const scaleY = metrics.naturalHeight / metrics.displayHeight;
  return {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY),
  };
}

function getScannerCapturePointFromEvent(event, metrics) {
  return {
    x: clampScannerCaptureValue(event.clientX - metrics.rect.left, 0, metrics.displayWidth),
    y: clampScannerCaptureValue(event.clientY - metrics.rect.top, 0, metrics.displayHeight),
  };
}

function renderScannerChartCaptureCrop() {
  const cropBox = document.getElementById('scanner-capture-preview-crop-box');
  if (!cropBox) return;

  const activeRect = scannerChartCaptureDrag?.displayRect || scannerChartCaptureCrop?.displayRect || null;
  if (!activeRect || !activeRect.width || !activeRect.height) {
    cropBox.classList.remove('is-visible');
    cropBox.style.left = '0px';
    cropBox.style.top = '0px';
    cropBox.style.width = '0px';
    cropBox.style.height = '0px';
    setScannerCapturePreviewStatus('Crop: full image');
    return;
  }

  cropBox.classList.add('is-visible');
  cropBox.style.left = `${activeRect.x}px`;
  cropBox.style.top = `${activeRect.y}px`;
  cropBox.style.width = `${activeRect.width}px`;
  cropBox.style.height = `${activeRect.height}px`;

  const naturalRect = scannerChartCaptureDrag?.naturalRect || scannerChartCaptureCrop?.naturalRect || null;
  if (naturalRect) {
    setScannerCapturePreviewStatus(
      `Crop: ${naturalRect.width.toLocaleString()}x${naturalRect.height.toLocaleString()} px @ (${naturalRect.x.toLocaleString()}, ${naturalRect.y.toLocaleString()})`
    );
  } else {
    setScannerCapturePreviewStatus('Crop: active');
  }
}

async function captureScannerChartDataUrl() {
  const chartElement = document.getElementById('chart-container') || document.getElementById('pattern-chart');
  if (!chartElement) {
    throw new Error('Current chart is not available to capture.');
  }
  const canvas = await html2canvas(chartElement, {
    backgroundColor: '#1e1e1e',
    scale: 2,
    logging: false,
    useCORS: true,
  });
  lastScannerChartCaptureDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  if (!scannerChartCaptureCrop) {
    renderScannerChartCaptureCrop();
  }
  return lastScannerChartCaptureDataUrl;
}

async function getActiveScannerChartCaptureDataUrl() {
  const baseDataUrl = lastScannerChartCaptureDataUrl || await captureScannerChartDataUrl();
  if (!scannerChartCaptureCrop?.naturalRect || !scannerChartCaptureCrop.naturalRect.width || !scannerChartCaptureCrop.naturalRect.height) {
    return baseDataUrl;
  }

  const image = new Image();
  image.decoding = 'async';
  image.src = baseDataUrl;
  await image.decode();

  const { x, y, width, height } = scannerChartCaptureCrop.naturalRect;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return baseDataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function captureScannerChartImage() {
  if (scannerChartCaptureCrop && lastScannerChartCaptureDataUrl) {
    return getActiveScannerChartCaptureDataUrl();
  }
  await captureScannerChartDataUrl();
  return getActiveScannerChartCaptureDataUrl();
}

async function previewScannerChartCapture() {
  try {
    const dataUrl = await captureScannerChartDataUrl();
    const previewShell = document.getElementById('scanner-capture-preview');
    const previewImage = document.getElementById('scanner-capture-preview-image');
    if (!previewShell || !previewImage) {
      throw new Error('Preview panel is unavailable on this page.');
    }
    previewImage.src = dataUrl;
    previewShell.classList.remove('hidden');
    previewShell.setAttribute('aria-hidden', 'false');
  } catch (err) {
    appendScannerChatMessage(`Preview failed: ${err.message}`, 'ai', 'scanner-chat-messages');
  }
}

function closeScannerChartCapturePreview() {
  const previewShell = document.getElementById('scanner-capture-preview');
  if (previewShell) {
    previewShell.classList.add('hidden');
    previewShell.setAttribute('aria-hidden', 'true');
  }
}

function clearScannerChartCaptureCrop() {
  clearScannerChartCaptureCropState();
  renderScannerChartCaptureCrop();
}

function handleScannerCapturePreviewLoad() {
  renderScannerChartCaptureCrop();
}

function startScannerChartCaptureCrop(event) {
  if (event.button !== 0) return;
  const metrics = getScannerCapturePreviewMetrics();
  if (!metrics) return;

  const target = event.target;
  if (!(target instanceof HTMLElement) || target.id !== 'scanner-capture-preview-image') return;

  event.preventDefault();
  const point = getScannerCapturePointFromEvent(event, metrics);
  const displayRect = { x: point.x, y: point.y, width: 0, height: 0 };
  const naturalRect = scannerCaptureDisplayRectToNatural(displayRect, metrics);
  scannerChartCaptureDrag = {
    startX: point.x,
    startY: point.y,
    displayRect,
    naturalRect,
  };
  renderScannerChartCaptureCrop();
}

function moveScannerChartCaptureCrop(event) {
  if (!scannerChartCaptureDrag) return;
  const metrics = getScannerCapturePreviewMetrics();
  if (!metrics) return;

  const point = getScannerCapturePointFromEvent(event, metrics);
  const displayRect = normalizeScannerCaptureDisplayRect(
    scannerChartCaptureDrag.startX,
    scannerChartCaptureDrag.startY,
    point.x,
    point.y,
    metrics.displayWidth,
    metrics.displayHeight
  );
  scannerChartCaptureDrag.displayRect = displayRect;
  scannerChartCaptureDrag.naturalRect = scannerCaptureDisplayRectToNatural(displayRect, metrics);
  renderScannerChartCaptureCrop();
}

function finishScannerChartCaptureCrop() {
  if (!scannerChartCaptureDrag) return;
  const displayRect = scannerChartCaptureDrag.displayRect;
  const naturalRect = scannerChartCaptureDrag.naturalRect;
  const isTooSmall = !displayRect || displayRect.width < 12 || displayRect.height < 12 || !naturalRect || naturalRect.width < 12 || naturalRect.height < 12;
  scannerChartCaptureCrop = isTooSmall ? null : {
    displayRect,
    naturalRect,
  };
  scannerChartCaptureDrag = null;
  renderScannerChartCaptureCrop();
}

function handleScannerChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendScannerChat();
  }
}

function handleFundamentalsChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendFundamentalsChat();
  }
}

function buildScannerChatContext(fundamentals = null) {
  const candidate = candidates[currentIndex] || null;
  const detector = buildDetectorContext(candidate);
  const visual = buildScannerVisualContext();
  return {
    symbol: candidate?.symbol || '',
    patternType: candidate?.pattern_type || candidate?.scan_mode || 'wyckoff',
    tradeDirection: 'LONG',
    copilotAnalysis: {
      scanner: true,
      candidate: candidate ? {
        symbol: candidate.symbol,
        retracement_pct: candidate.retracement_pct,
        score: candidate.score,
        pattern_type: candidate.pattern_type,
        timeframe: candidate.timeframe,
        strategy_version_id: candidate.strategy_version_id || null,
        entry_ready: candidate.entry_ready,
        candidate_role: candidate.candidate_role || null,
        candidate_role_label: candidate.candidate_role_label || null,
        candidate_actionability: candidate.candidate_actionability || null,
        candidate_actionability_label: candidate.candidate_actionability_label || null,
        candidate_semantic_summary: candidate.candidate_semantic_summary || null,
        candidate_origin_role: candidate.candidate_origin_role || null,
        candidate_entry_type: candidate.candidate_entry_type || null,
        rule_checklist: candidate.rule_checklist || [],
        detector,
      } : null,
      aiAnalysis: lastAIAnalysis || null,
      fundamentals: buildFundamentalsContext(fundamentals),
      detector,
      visual,
    }
  };
}

function formatScannerVisualPoint(point) {
  if (!point) return null;
  const time = point.time != null ? point.time : 'N/A';
  const price = Number(point.price);
  const type = point.type || point.position || '';
  const text = point.text || point.label || '';
  const priceText = Number.isFinite(price) ? price.toFixed(2) : 'N/A';
  return `${type || 'point'} @ ${time} / ${priceText}${text ? ` (${text})` : ''}`;
}

function summarizeScannerDrawings(drawings) {
  if (!Array.isArray(drawings) || !drawings.length) return [];
  return drawings.slice(-6).map((drawing) => {
    if (!drawing) return null;
    if (drawing.type === 'pattern-swing-path' && Array.isArray(drawing.points)) {
      const points = drawing.points
        .slice(0, 12)
        .map((point, index) => {
          const price = Number(point?.price);
          const priceText = Number.isFinite(price) ? price.toFixed(2) : 'N/A';
          return `${index + 1}:${point?.time ?? 'N/A'}@${priceText}`;
        })
        .join(' | ');
      return `swing_path points=${drawing.points.length}${points ? ` -> ${points}` : ''}`;
    }
    if (Array.isArray(drawing.points) && drawing.points.length) {
      return `${drawing.type} points=${drawing.points.length}`;
    }
    return drawing.type || 'drawing';
  }).filter(Boolean);
}

function buildScannerVisualContext() {
  const indicators = typeof _ciGetIndicators === 'function' ? _ciGetIndicators() : [];
  const activeIndicators = Array.isArray(indicators)
    ? indicators.map((indicator) => ({
        type: indicator?.type || null,
        name: indicator?.type || null,
        backendData: indicator?.backendData || null,
      }))
    : [];

  const rdpIndicator = activeIndicators.find((indicator) => indicator?.type === 'rdpSwing');
  const rdpCandidate = rdpIndicator?.backendData?.candidate || null;
  const rdpMarkers = Array.isArray(rdpIndicator?.backendData?.markers) ? rdpIndicator.backendData.markers : [];
  const rdpSwingPoints = Array.isArray(rdpCandidate?.swing_points)
    ? rdpCandidate.swing_points
    : Array.isArray(currentDisplayData?.swing_data?.swing_points)
    ? currentDisplayData.swing_data.swing_points
    : [];

  const drawings = (
    window._scannerDrawingTools
    && typeof window._scannerDrawingTools.getDrawings === 'function'
  )
    ? window._scannerDrawingTools.getDrawings()
    : [];

  return {
    activeIndicators: activeIndicators.map((indicator) => indicator.type).filter(Boolean),
    rdpSwingPoints: rdpSwingPoints.slice(-16).map((point) => ({
      time: point?.time ?? null,
      price: point?.price ?? null,
      type: point?.type ?? null,
      index: point?.index ?? null,
      label: point?.label ?? null,
    })),
    rdpMarkers: rdpMarkers.slice(-16).map((marker) => ({
      time: marker?.time ?? null,
      position: marker?.position ?? null,
      text: marker?.text ?? null,
    })),
    drawings: summarizeScannerDrawings(drawings),
  };
}

function buildScannerVisualMessageBlock() {
  const visual = buildScannerVisualContext();
  const lines = [];
  if (Array.isArray(visual.activeIndicators) && visual.activeIndicators.length) {
    lines.push(`- active_indicators: ${visual.activeIndicators.join(', ')}`);
  }
  if (Array.isArray(visual.rdpMarkers) && visual.rdpMarkers.length) {
    lines.push('- rdp_label_legend: labels like H53 or H $53 mean an RDP swing high near 53; L11 or L $11 mean an RDP swing low near 11');
    lines.push(`- rdp_markers_count: ${visual.rdpMarkers.length}`);
    visual.rdpMarkers.forEach((marker, index) => {
      const time = marker?.time ?? 'N/A';
      const position = marker?.position || 'N/A';
      const text = marker?.text || 'N/A';
      lines.push(`  - rdp_marker_${index + 1}: ${position} @ ${time} / ${text}`);
    });
  }
  if (Array.isArray(visual.rdpSwingPoints) && visual.rdpSwingPoints.length) {
    lines.push(`- rdp_swing_points_count: ${visual.rdpSwingPoints.length}`);
    visual.rdpSwingPoints.forEach((point, index) => {
      const formatted = formatScannerVisualPoint(point);
      if (formatted) lines.push(`  - rdp_${index + 1}: ${formatted}`);
    });
  }
  if (Array.isArray(visual.drawings) && visual.drawings.length) {
    lines.push(`- visible_drawings: ${visual.drawings.join(' || ')}`);
  }
  return lines.length ? `\nVISUAL_CONTEXT:\n${lines.join('\n')}` : '';
}

function buildScannerMessage(rawMessage, candidate, detector, fundamentals) {
  let message = rawMessage;
  if (candidate) {
    message = `${message}\n\nSCANNER_CANDIDATE:\n- symbol: ${candidate.symbol || 'N/A'}\n- timeframe: ${candidate.timeframe || 'N/A'}\n- retracement_pct: ${candidate.retracement_pct ?? 'N/A'}\n- score: ${candidate.score ?? 'N/A'}\n- pattern_type: ${candidate.pattern_type || 'N/A'}\n- candidate_role: ${candidate.candidate_role || 'N/A'}\n- candidate_role_label: ${candidate.candidate_role_label || 'N/A'}\n- candidate_actionability: ${candidate.candidate_actionability || 'N/A'}\n- candidate_actionability_label: ${candidate.candidate_actionability_label || 'N/A'}\n- candidate_semantic_summary: ${candidate.candidate_semantic_summary || 'N/A'}\n- candidate_origin_role: ${candidate.candidate_origin_role || 'N/A'}\n- candidate_entry_type: ${candidate.candidate_entry_type || 'N/A'}\n- strategy_version_id: ${candidate.strategy_version_id || 'N/A'}\n${buildDetectorMessageBlock(detector)}${buildFundamentalsMessageBlock(fundamentals)}${buildScannerVisualMessageBlock()}`;
  }
  if (/would you (buy|take|enter)|should i (buy|take|enter)|your opinion|would you trade this|is this buyable/i.test(rawMessage || '')) {
    message = `${message}\n\nDECISION_REQUEST:\n- The user wants your own trader call right now.\n- Start with exactly one of: My call: BUY, My call: WAIT, My call: PASS.\n- Then explain what you would do with real money, not just what the data says.`;
  }
  return message;
}

function shouldUseLiteralChartReader(rawMessage = '', hasImage = false) {
  if (!hasImage) return false;
  const text = String(rawMessage || '').trim();
  if (!text) return false;
  return /what does .* say|what do .* say|do you see|read (the )?(chart|labels?|annotations?)|list every visible|list visible|visible text|literal|rdp swing points|rdp labels?|what are the rdp|what does h\d+|what does l\d+|what is h\d+|what is l\d+/i.test(text);
}

function getScannerChatRole(rawMessage = '', hasImage = false) {
  if (shouldUseLiteralChartReader(rawMessage, hasImage)) {
    return 'literal_chart_reader';
  }
  return 'pattern_analyst';
}

async function sendScannerChatRequest(options = {}) {
  const {
    prefill,
    inputId = 'scanner-chat-input',
    messagesId = 'scanner-chat-messages',
    statusId = 'ai-status',
    includeChart = false,
  } = options;
  const input = document.getElementById(inputId);
  const raw = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  let message = (raw || '').trim();
  const attachment = getChatAttachment(inputId);
  const hasAttachedImage = Boolean(attachment?.dataUrl);
  if (!message && (includeChart || hasAttachedImage)) {
    message = hasAttachedImage
      ? getChatAttachmentDefaultPrompt(inputId)
      : messagesId === 'fundamentals-chat-messages'
      ? 'Use the current chart and the fundamentals together. What stands out?'
      : 'Use the current chart and my markings. What do you see?';
  }
  if (!message) return;

  if (input && typeof prefill !== 'string') {
    input.value = '';
    autoResizeScannerChatInput(inputId);
  }

  appendScannerChatMessage((includeChart || hasAttachedImage) ? `${message}\n[with image]` : message, 'user', messagesId, { animate: false });
  setScannerChatStatus('Thinking', statusId);

  try {
    const candidate = candidates[currentIndex] || null;
    const fundamentals = candidate ? await ensureScannerFundamentals(candidate.symbol) : null;
    if (messagesId === 'fundamentals-chat-messages' && candidate?.symbol && !fundamentals) {
      await appendScannerChatMessage(`Fundamentals snapshot was unavailable for ${candidate.symbol}. Continuing with scanner context only.`, 'ai', messagesId, { animate: false });
    }
    const detector = candidate ? buildDetectorContext(candidate) : null;
    message = buildScannerMessage(message, candidate, detector, fundamentals);
    const settings = getStoredCopilotSettings();
    const chartImage = hasAttachedImage
      ? attachment.dataUrl
      : includeChart
      ? await captureScannerChartImage()
      : null;
    const chatRole = getScannerChatRole(raw, Boolean(chartImage));
    const context = buildScannerChatContext(fundamentals);
    const fetchVisionChat = async (role, finalMessage, imagePayload = chartImage) => {
      const response = await fetch('/api/vision/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: finalMessage,
          context,
          role,
          aiModel: settings.aiModel,
          chartImage: imagePayload,
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return String(data.data?.response || 'No response.');
    };
    let responseText = await fetchVisionChat(chatRole, message);
    if (
      chartImage &&
      /can't actually see|cannot actually see|don't see any actual chart|do not see any actual chart|upload the image itself|can't confirm a literal/i.test(responseText)
    ) {
      const retryMessage = `${message}\n\nIMAGE_RETRY_INSTRUCTION:\n- The chart screenshot is attached to this request.\n- Do not say you cannot see the chart unless the attached screenshot is blank.\n- Use the attached image and the VISUAL_CONTEXT together.\n- Explicitly mention any visible swing points, labels, or drawn polylines if present.`;
      responseText = await fetchVisionChat(chatRole, retryMessage);
    }
    setScannerChatStatus('Typing', statusId);
    await appendScannerChatMessage(responseText, 'ai', messagesId, { animate: true });
    if (hasAttachedImage) clearChatAttachment(inputId);
    setScannerChatStatus('Ready', statusId);
  } catch (err) {
    await appendScannerChatMessage(`Chat failed: ${err.message}`, 'ai', messagesId, { animate: false });
    setScannerChatStatus('Error', statusId);
  }
}

async function sendScannerChat(prefill) {
  return sendScannerChatRequest({ prefill });
}

async function sendScannerChatWithChart(prefill) {
  return sendScannerChatRequest({ prefill, includeChart: true });
}

async function sendFundamentalsChat(prefill) {
  return sendScannerChatRequest({
    prefill,
    inputId: 'fundamentals-chat-input',
    messagesId: 'fundamentals-chat-messages',
    statusId: 'fundamentals-chat-status',
  });
}

async function sendFundamentalsChatWithChart(prefill) {
  return sendScannerChatRequest({
    prefill,
    inputId: 'fundamentals-chat-input',
    messagesId: 'fundamentals-chat-messages',
    statusId: 'fundamentals-chat-status',
    includeChart: true,
  });
}

function askScannerWhy() {
  const candidate = candidates[currentIndex];
  if (!candidate) { sendScannerChat('No candidate loaded yet. Tell me what I should scan first.'); return; }
  sendScannerChat('Explain this setup: why it might be valid or invalid, what phase is weakest, and what evidence I should verify manually.');
}

function askScannerEdits() {
  const candidate = candidates[currentIndex];
  if (!candidate) { sendScannerChat('No candidate loaded yet. Give me a checklist to improve scanner quality.'); return; }
  sendScannerChat('Suggest concrete scanner rule edits or thresholds to reduce false positives for this type of setup.');
}

function askFundamentalsQuality() {
  const candidate = candidates[currentIndex];
  if (!candidate) { sendFundamentalsChat('No candidate loaded yet. Tell me what symbol to analyze first.'); return; }
  sendFundamentalsChat('Explain the quality of this company and how those fundamentals support or weaken this scanner setup.');
}

function askFundamentalsRisk() {
  const candidate = candidates[currentIndex];
  if (!candidate) { sendFundamentalsChat('No candidate loaded yet. Tell me what symbol to analyze first.'); return; }
  sendFundamentalsChat('Explain the main fundamental risks here, especially balance sheet, dilution, cash runway, and earnings/catalyst risk, in context of this setup.');
}

function askFundamentalsCatalyst() {
  const candidate = candidates[currentIndex];
  if (!candidate) { sendFundamentalsChat('No candidate loaded yet. Tell me what symbol to analyze first.'); return; }
  sendFundamentalsChat('Explain the earnings and catalyst picture here and whether the fundamentals make this setup more actionable or more dangerous.');
}

async function checkAIStatus() {
  try {
    const res = await fetch('/api/vision/status');
    const data = await res.json();
    if (data.success && data.data.available && data.data.modelLoaded) {
      aiAvailable = true;
      let provider = '\u2705 Ollama';
      if (data.data.provider === 'openai') {
        let storedModel = 'gpt-5.4';
        try {
          const stored = JSON.parse(localStorage.getItem('copilotSettings') || '{}');
          storedModel = String(stored?.aiModel || 'gpt-5.4');
        } catch (e) {}
        provider = `\u2705 ${storedModel}`;
      }
      aiStatusProviderLabel = provider;
      document.getElementById('ai-status').textContent = provider;
      const fundamentalsStatus = document.getElementById('fundamentals-chat-status');
      if (fundamentalsStatus) fundamentalsStatus.textContent = provider;
      document.getElementById('btn-ask-ai').disabled = false;
    } else {
      aiAvailable = false;
      aiStatusProviderLabel = '\u274C ' + (data.data?.error || 'Not available');
      document.getElementById('ai-status').textContent = aiStatusProviderLabel;
      const fundamentalsStatus = document.getElementById('fundamentals-chat-status');
      if (fundamentalsStatus) fundamentalsStatus.textContent = aiStatusProviderLabel;
      document.getElementById('btn-ask-ai').disabled = true;
    }
  } catch (err) {
    aiAvailable = false;
    aiStatusProviderLabel = '\u274C Vision AI not running';
    document.getElementById('ai-status').textContent = aiStatusProviderLabel;
    const fundamentalsStatus = document.getElementById('fundamentals-chat-status');
    if (fundamentalsStatus) fundamentalsStatus.textContent = aiStatusProviderLabel;
    document.getElementById('btn-ask-ai').disabled = true;
  }
}

async function askAI() {
  const candidate = candidates[currentIndex];
  if (!candidate) return;

  mountScannerReviewWidgets();
  const btn = document.getElementById('btn-ask-ai');
  const reviewPanel = document.getElementById('ai-review-panel');
  const reviewStatus = document.getElementById('ai-review-status');
  const resultDiv = document.getElementById('ai-result');
  const errorDiv = document.getElementById('ai-error');
  const safeHide = (el) => { if (el) el.classList.add('hidden'); };
  const safeShow = (el) => { if (el) el.classList.remove('hidden'); };
  const setTextIfPresent = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
  }
  if (reviewPanel) reviewPanel.classList.remove('hidden');
  if (reviewStatus) reviewStatus.textContent = `Analyzing ${candidate.symbol}...`;
  setScannerChatStatus('Analyzing');
  appendScannerChatMessage(`Analyzing ${candidate.symbol} chart...`, 'ai');
  safeHide(resultDiv);
  safeHide(errorDiv);
  setAICorrectionStatus('');

  try {
    const fundamentals = await ensureScannerFundamentals(candidate.symbol);
    const detector = buildDetectorContext(candidate);
    const imageBase64 = await captureScannerChartImage();

    const patternInfo = {
      symbol: candidate.symbol,
      retracement: candidate.retracement_pct?.toFixed(1) || 'N/A',
      baseRange: candidate.base ? `${candidate.base.start_date} to ${candidate.base.end_date}` : 'N/A',
      candidateRole: candidate.candidate_role || null,
      candidateRoleLabel: candidate.candidate_role_label || null,
      candidateActionability: candidate.candidate_actionability || null,
      candidateActionabilityLabel: candidate.candidate_actionability_label || null,
      candidateSemanticSummary: candidate.candidate_semantic_summary || null,
      detector,
      fundamentals: buildFundamentalsContext(fundamentals)
    };

    const res = await fetch('/api/vision/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, patternInfo, analysisMode: 'pattern_discovery' })
    });

    const data = await res.json();

    if (data.success) {
      safeShow(resultDiv);
      if (reviewPanel) reviewPanel.classList.remove('hidden');
      if (reviewStatus) reviewStatus.textContent = `${candidate.symbol} analyzed`;

      const review = data.data.review || {};
      const setText = (id, value, className = 'text-gray-300') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = value || '-';
        el.className = className;
      };
      const tone = (value, positive = ['AGREE', 'CONFIRM', 'FORMING', 'TRIGGER', 'IN_PLAY', 'JUST_TRIGGERING'], warning = ['PARTIAL', 'RELABEL', 'UNCLEAR']) => {
        const upper = String(value || '').toUpperCase();
        if (positive.includes(upper)) return 'text-green-400';
        if (warning.includes(upper)) return 'text-yellow-400';
        if (upper === 'DISAGREE' || upper === 'REJECT' || upper === 'FAILED' || upper === 'TOO_LATE' || upper === 'BROKEN') return 'text-red-400';
        return 'text-gray-400';
      };
      setText('ai-primary-pattern', formatScannerAnalysisLabel(review.primaryPattern || 'unclear'), 'scanner-analysis-pattern');
      setText('ai-alternative-pattern', formatScannerAnalysisLabel(review.alternativePattern || '-'), `scanner-analysis-chip-value ${review.alternativePattern ? 'text-gray-300' : 'text-gray-500'}`);
      setText('ai-state-assessment', formatScannerAnalysisLabel(review.stateAssessment || '-'), `scanner-analysis-chip-value ${tone(review.stateAssessment)}`);
      const timingText = review.isTooLate ? `${review.timingAssessment || 'TOO_LATE'} / late` : (review.timingAssessment || '-');
      setText('ai-timing', formatScannerAnalysisLabel(timingText), `scanner-analysis-chip-value ${tone(review.timingAssessment)}`);
      renderScannerAnalysisList('ai-top-reasons', review.topReasons);
      renderScannerAnalysisList('ai-top-risks', review.topRisks);

      setTextIfPresent('ai-explanation', data.data.explanation || '-');

      if (data.data.levels) {
        drawAILevels(data.data.levels);
      } else {
        renderAIBaseReview(candidate);
      }

      lastAIAnalysis = {
        isValidPattern: data.data.isValidPattern, confidence: data.data.confidence,
        review: data.data.review, phases: data.data.phases, levels: data.data.levels, mlScores: data.data.mlScores,
        explanation: data.data.explanation, timestamp: new Date().toISOString()
      };

      if (data.data.mlScores) {
        displayMLScores(data.data.mlScores);
      }

      const cand = candidates[currentIndex];
      if (cand) { updateStoredCandidateStatus(cand.symbol, { aiAnalyzed: true }); }

      const correctBtn = document.getElementById('btn-ai-correct');
      const incorrectBtn = document.getElementById('btn-ai-incorrect');
      if (correctBtn) {
        correctBtn.disabled = false;
        correctBtn.classList.remove('opacity-50');
      }
      if (incorrectBtn) {
        incorrectBtn.disabled = false;
        incorrectBtn.classList.remove('opacity-50');
      }
      safeHide(document.getElementById('ai-feedback-saved'));

      const primaryPattern = review.primaryPattern || 'unclear';
      const stateAssessment = review.stateAssessment || 'UNCLEAR';
      const timingAssessment = review.timingAssessment || (review.isTooLate ? 'TOO_LATE' : 'IN_PLAY');
      setScannerChatStatus('Typing');
      await appendScannerChatMessage(`${candidate.symbol}: ${primaryPattern} (${data.data.confidence}%).\nState:${stateAssessment} Timing:${timingAssessment}\n${data.data.explanation || ''}`, 'ai', 'scanner-chat-messages', { animate: true });
      const chatContainer = document.getElementById('scanner-chat-messages');
      if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
      setScannerChatStatus('Ready');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    if (reviewStatus) reviewStatus.textContent = 'Analysis failed';
    if (errorDiv) {
      errorDiv.textContent = err.message;
      safeShow(errorDiv);
    }
    await appendScannerChatMessage(`Analysis failed: ${err.message}`, 'ai', 'scanner-chat-messages', { animate: false });
    setScannerChatStatus('Error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analyze Chart';
    }
  }
}

// Build feature vector from scanner data (normalized 0-1)
function buildScannerVector(candidate) {
  if (!candidate || !candidate.chart_data) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const data = candidate.chart_data;
  if (data.length < 10) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

  const prices = data.map(d => d.close || d.value);
  const highs = data.map(d => d.high || d.close || d.value);
  const lows = data.map(d => d.low || d.close || d.value);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const currentPrice = prices[prices.length - 1];
  const priceRange = maxPrice - minPrice || 1;

  const drawdownPct = (maxPrice - minPrice) / maxPrice;
  const positionInRange = (currentPrice - minPrice) / priceRange;
  const retracement = candidate.retracement ? candidate.retracement / 100 : 0.5;
  const baseHigh = candidate.base_high || maxPrice * 0.5;
  const baseLow = candidate.base_low || minPrice;
  const baseRangePct = (baseHigh - baseLow) / priceRange;
  const patternDuration = data.length / 200;
  const volumeTrend = 0.5;
  const recentPrices = prices.slice(-Math.max(10, Math.floor(prices.length * 0.1)));
  const momentum = recentPrices.length > 1 ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / (priceRange || 1) : 0;
  const momentumNorm = Math.max(0, Math.min(1, (momentum + 1) / 2));
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const volatility = Math.min(1, (stdDev / mean) * 5);

  return [
    Math.max(0, Math.min(1, drawdownPct)),
    Math.max(0, Math.min(1, positionInRange)),
    Math.max(0, Math.min(1, retracement)),
    Math.max(0, Math.min(1, 1 - baseRangePct)),
    Math.max(0, Math.min(1, patternDuration)),
    Math.max(0, Math.min(1, volumeTrend)),
    Math.max(0, Math.min(1, momentumNorm)),
    Math.max(0, Math.min(1, volatility))
  ];
}

function displayMLScores(scores) {
  const container = document.getElementById('ml-scores');
  if (!container || !scores) return;
  container.classList.remove('hidden');

  const colorScore = (value, invert = false) => { const v = invert ? 1 - value : value; if (v >= 0.7) return 'text-green-400'; if (v >= 0.4) return 'text-yellow-400'; return 'text-red-400'; };
  const detectorAgreement = scores.detectorAgreement ?? scores.patternLikeness ?? 0.5;
  const structureQuality = scores.structureQuality ?? scores.structuralClarity ?? 0.5;
  const patternClarity = scores.patternClarity ?? scores.phaseCompleteness ?? 0.5;
  const timingQuality = scores.timingQuality ?? scores.entryQuality ?? 0.5;
  const failureRisk = scores.failureRisk ?? 0.5;

  document.getElementById('ml-pattern').textContent = detectorAgreement?.toFixed(2) || '-';
  document.getElementById('ml-pattern').className = `text-lg font-bold ${colorScore(detectorAgreement || 0)}`;
  document.getElementById('ml-clarity').textContent = structureQuality?.toFixed(2) || '-';
  document.getElementById('ml-clarity').className = `text-lg font-bold ${colorScore(structureQuality || 0)}`;
  document.getElementById('ml-phases').textContent = patternClarity?.toFixed(2) || '-';
  document.getElementById('ml-phases').className = `text-lg font-bold ${colorScore(patternClarity || 0)}`;
  document.getElementById('ml-risk').textContent = failureRisk?.toFixed(2) || '-';
  document.getElementById('ml-risk').className = `text-lg font-bold ${colorScore(failureRisk || 0, true)}`;
  document.getElementById('ml-entry').textContent = timingQuality?.toFixed(2) || '-';
  document.getElementById('ml-entry').className = `text-lg font-bold ${colorScore(timingQuality || 0)}`;

  const vector = [detectorAgreement, structureQuality, patternClarity, failureRisk, timingQuality].map(v => v?.toFixed(2) || '0.50');
  document.getElementById('ml-vector-raw').textContent = `Vector: [${vector.join(', ')}]`;
}

// ── AI price lines and drag mode ─────────────────────────────────────────

let aiPriceLines = [];
let originalAILevels = null;
let correctedAILevels = {};
let aiLevelsVisible = true;
let dragMode = false;
let draggingLine = null;
let dragStartY = 0;

function removeAILevelLines() {
  aiPriceLines.forEach(item => { try { patternSeries.removePriceLine(item.line); } catch (e) {} });
  aiPriceLines = [];
}

function updateAILevelsToggleButton() {
  const btn = document.getElementById('btn-toggle-ai-levels');
  if (!btn) return;
  const hasLevels = Boolean(originalAILevels && Object.keys(originalAILevels).length);
  btn.style.display = hasLevels ? '' : 'none';
  if (!hasLevels) return;
  btn.textContent = aiLevelsVisible ? 'Hide AI Set' : 'Show AI Set';
}

function drawAILevels(levels, options = {}) {
  const { keepCorrections = false, correctedLevels = null } = options;
  removeAILevelLines();
  correctedAILevels = keepCorrections && correctedLevels ? { ...correctedLevels } : {};
  originalAILevels = { ...levels };
  updateAILevelsToggleButton();
  if (!aiLevelsVisible || !patternSeries) {
    updateAISuggestionsDisplay();
    const dragBtn = document.getElementById('btn-drag-levels');
    if (dragBtn) dragBtn.classList.remove('hidden');
    renderAIBaseReview();
    return;
  }
  const direction = inferAITradeDirection(levels);
  const tradePrefix = direction === 'short' ? 'AI Short' : direction === 'long' ? 'AI Long' : 'AI';

  const addLine = (key, price, title, color, style = 0) => {
    if (!price || isNaN(price)) return;
    const line = patternSeries.createPriceLine({ price, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title });
    aiPriceLines.push({ key, line, price, title, color, style });
    console.log('Added AI line:', key, 'at price', price);
  };

  if (levels.peakPrice) addLine('peakPrice', levels.peakPrice, '\u{1F53A} AI Peak', '#ff6b6b', 2);
  if (levels.markdownLow) addLine('markdownLow', levels.markdownLow, '\u{1F4C9} AI Low', '#868e96', 2);
  if (levels.baseHigh) addLine('baseHigh', levels.baseHigh, '\u{1F4CA} Base High', '#fab005', 2);
  if (levels.baseLow) addLine('baseLow', levels.baseLow, '\u{1F4CA} Base Low', '#fab005', 2);
  if (levels.markupHigh) addLine('markupHigh', levels.markupHigh, '\u{1F4C8} Markup', '#51cf66', 2);
  if (levels.pullbackLow) addLine('pullbackLow', levels.pullbackLow, '\u{1F504} Pullback', '#339af0', 2);
  if (levels.suggestedEntry) addLine('suggestedEntry', levels.suggestedEntry, `\u{1F3AF} ${tradePrefix} Entry`, '#00d9ff', 0);
  if (levels.suggestedStop) addLine('suggestedStop', levels.suggestedStop, `\u{1F6D1} ${tradePrefix} Stop`, '#ff4757', 0);
  if (levels.suggestedTarget) addLine('suggestedTarget', levels.suggestedTarget, `\u{1F4B0} ${tradePrefix} Target`, '#2ed573', 0);

  updateAISuggestionsDisplay();
  const dragBtn = document.getElementById('btn-drag-levels');
  if (dragBtn) dragBtn.classList.remove('hidden');
  renderAIBaseReview();
  console.log('AI Levels drawn:', aiPriceLines.length, 'lines. Keys:', aiPriceLines.map(l => l.key));
}

function toggleAILevelsVisibility() {
  if (!originalAILevels) return;
  aiLevelsVisible = !aiLevelsVisible;
  if (!aiLevelsVisible) {
    if (dragMode) toggleDragMode();
    removeAILevelLines();
    updateAILevelsToggleButton();
    return;
  }
  const mergedLevels = { ...(originalAILevels || {}), ...(correctedAILevels || {}) };
  drawAILevels(mergedLevels, { keepCorrections: true, correctedLevels: correctedAILevels });
}

function updateAISuggestionsDisplay() {
  const levels = { ...originalAILevels, ...correctedAILevels };
  const suggestionDiv = document.getElementById('ai-suggestions');
  if (suggestionDiv && (levels.suggestedEntry || levels.suggestedStop || levels.suggestedTarget)) {
    const hasCorrections = Object.keys(correctedAILevels).length > 0;
    const direction = inferAITradeDirection(levels);
    const directionLabel = direction === 'short' ? 'AI Short Setup' : direction === 'long' ? 'AI Long Setup' : 'AI Trade Suggestion';
    suggestionDiv.innerHTML = `
      <div class="mt-2 p-2 bg-gray-700 rounded text-xs">
        <strong>${directionLabel}${hasCorrections ? ' (Corrected)' : ''}:</strong><br>
        ${levels.suggestedEntry ? `Entry: $${levels.suggestedEntry.toFixed(2)}${correctedAILevels.suggestedEntry ? ' \u270F\uFE0F' : ''}<br>` : ''}
        ${levels.suggestedStop ? `Stop: $${levels.suggestedStop.toFixed(2)}${correctedAILevels.suggestedStop ? ' \u270F\uFE0F' : ''}<br>` : ''}
        ${levels.suggestedTarget ? `Target: $${levels.suggestedTarget.toFixed(2)}${correctedAILevels.suggestedTarget ? ' \u270F\uFE0F' : ''}` : ''}
      </div>
    `;
    suggestionDiv.classList.remove('hidden');
  } else if (suggestionDiv) {
    suggestionDiv.classList.add('hidden');
    suggestionDiv.innerHTML = '';
  }
  renderAIBaseReview();
}

function toggleDragMode() {
  if (!dragMode && aiPriceLines.length === 0) {
    alert('No AI levels to adjust. Click "Ask AI" first to analyze the chart.');
    return;
  }
  dragMode = !dragMode;
  const btn = document.getElementById('btn-drag-levels');
  const chartContainer = document.getElementById('pattern-chart');

  if (dragMode) {
    btn.textContent = '\u{1F513} Stop Adjusting';
    btn.classList.add('bg-yellow-600'); btn.classList.remove('bg-purple-600');
    chartContainer.style.cursor = 'ns-resize';
    chartContainer.addEventListener('mousedown', startDragLine);
    chartContainer.addEventListener('mousemove', dragLine);
    chartContainer.addEventListener('mouseup', endDragLine);
    chartContainer.addEventListener('mouseleave', endDragLine);
    document.getElementById('drag-instruction')?.classList.remove('hidden');
  } else {
    btn.textContent = 'Adjust On Chart';
    btn.classList.remove('bg-yellow-600'); btn.classList.add('bg-purple-600');
    chartContainer.style.cursor = 'default';
    chartContainer.removeEventListener('mousedown', startDragLine);
    chartContainer.removeEventListener('mousemove', dragLine);
    chartContainer.removeEventListener('mouseup', endDragLine);
    chartContainer.removeEventListener('mouseleave', endDragLine);
    document.getElementById('drag-instruction')?.classList.add('hidden');
  }
}

function startDragLine(e) {
  if (!dragMode || !patternSeries) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const clickPrice = patternSeries.coordinateToPrice(y);
  if (clickPrice === null || clickPrice === undefined) return;

  const candidate = candidates[currentIndex];
  if (!candidate || !candidate.chart_data || candidate.chart_data.length === 0) return;
  const prices = candidate.chart_data.map(d => [d.high, d.low]).flat();
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const tolerance = (maxPrice - minPrice) * 0.03;

  for (const item of aiPriceLines) {
    const currentPrice = correctedAILevels[item.key] || item.price;
    if (Math.abs(currentPrice - clickPrice) < tolerance) {
      draggingLine = item; dragStartY = y;
      e.preventDefault(); e.stopPropagation();
      return;
    }
  }
}

function dragLine(e) {
  if (!draggingLine || !dragMode || !patternSeries) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const newPrice = patternSeries.coordinateToPrice(y);
  if (newPrice === null) return;

  try { patternSeries.removePriceLine(draggingLine.line); } catch (e) {}
  const newLine = patternSeries.createPriceLine({
    price: newPrice, color: draggingLine.color, lineWidth: 3, lineStyle: 0,
    axisLabelVisible: true, title: draggingLine.title + ' \u270F\uFE0F'
  });
  draggingLine.line = newLine;
  correctedAILevels[draggingLine.key] = newPrice;
  updateAISuggestionsDisplay();
  updateCorrectionCount();
  renderAIBaseReview();
}

function endDragLine(e) {
  if (draggingLine && dragMode) {
    try { patternSeries.removePriceLine(draggingLine.line); } catch (e) {}
    const finalPrice = correctedAILevels[draggingLine.key] || draggingLine.price;
    const newLine = patternSeries.createPriceLine({
      price: finalPrice, color: '#ffd700', lineWidth: 2, lineStyle: 0,
      axisLabelVisible: true, title: draggingLine.title + ' \u270F\uFE0F'
    });
    draggingLine.line = newLine;
  }
  draggingLine = null;
}

function updateCorrectionCount() {
  const count = Object.keys(correctedAILevels).length;
  const badge = document.getElementById('correction-count');
  const saveBtn = document.getElementById('btn-save-corrections');
  if (badge) { badge.textContent = count > 0 ? `${count} level(s) adjusted` : ''; badge.classList.toggle('hidden', count === 0); }
  if (saveBtn) { saveBtn.classList.toggle('hidden', count === 0); }
}

async function saveLevelCorrections() {
  if (Object.keys(correctedAILevels).length === 0) { alert('No level adjustments to save. Drag the lines to adjust them first.'); return; }
  const candidate = candidates[currentIndex];
  if (!candidate) { alert('No candidate selected'); return; }

  const mergedLevels = { ...(originalAILevels || {}), ...(correctedAILevels || {}) };
  const detectorHigh = firstFiniteNumber(candidate?.base?.high, candidate?.base_high);
  const detectorLow = firstFiniteNumber(candidate?.base?.low, candidate?.base_low);
  const correctedBaseHigh = firstFiniteNumber(mergedLevels.baseHigh, mergedLevels.baseTop, detectorHigh);
  const correctedBaseLow = firstFiniteNumber(mergedLevels.baseLow, mergedLevels.baseBottom, detectorLow);

  const correction = {
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    patternType: `${candidate.pattern_type || 'pattern'}_ai_level_review`,
    originalLevels: originalAILevels,
    correctedLevels: correctedAILevels,
    deltas: {}
  };
  for (const key of Object.keys(correctedAILevels)) {
    if (originalAILevels?.[key] != null) { correction.deltas[key] = correctedAILevels[key] - originalAILevels[key]; }
  }

  try {
    setAICorrectionStatus('Saving correction...', 'muted');
    const res = await fetch('/api/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: candidate.id || candidate.candidate_id || candidate.symbol,
        userId: 'default',
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        patternType: correction.patternType,
        original: {
          detectedBaseTop: detectorHigh,
          detectedBaseBottom: detectorLow,
          ...originalAILevels,
        },
        corrected: {
          ...mergedLevels,
          baseTopPrice: correctedBaseHigh,
          baseBottomPrice: correctedBaseLow,
          correctionMode: 'scanner_ai_level_review',
          notes: 'Scanner AI review correction',
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    if (candidate.base && Number.isFinite(correctedBaseHigh) && Number.isFinite(correctedBaseLow)) {
      candidate.base.high = Math.max(correctedBaseHigh, correctedBaseLow);
      candidate.base.low = Math.min(correctedBaseHigh, correctedBaseLow);
    }
    if (typeof updateStoredCandidateStatus === 'function') {
      updateStoredCandidateStatus(candidate.symbol, { corrected: true, aiCorrected: true });
    }
    if (typeof updateSidebarStats === 'function') {
      updateSidebarStats();
    }
    if (typeof drawPatternChart === 'function') {
      await drawPatternChart(candidate);
      if (originalAILevels) {
        drawAILevels(mergedLevels, { keepCorrections: true, correctedLevels: correctedAILevels });
      }
    }

    setAICorrectionStatus(`Saved persistent correction for ${candidate.symbol}.`, 'success');
    console.log('Level correction saved:', correction, data?.data);

    correctedAILevels = {};
    updateCorrectionCount();
    renderAIBaseReview(candidate);
  } catch (err) {
    console.error('Failed to save AI correction:', err);
    setAICorrectionStatus(`Failed to save correction: ${err.message || 'Unknown error'}`, 'error');
    alert(`Failed to save correction: ${err.message || 'Unknown error'}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateAILevelsToggleButton();
  const previewImage = document.getElementById('scanner-capture-preview-image');
  if (previewImage) {
    previewImage.addEventListener('load', handleScannerCapturePreviewLoad);
    previewImage.addEventListener('mousedown', startScannerChartCaptureCrop);
  }
  window.addEventListener('mousemove', moveScannerChartCaptureCrop);
  window.addEventListener('mouseup', finishScannerChartCaptureCrop);
});
