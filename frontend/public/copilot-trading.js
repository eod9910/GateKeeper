// =========================================================================
// copilot-trading.js â€” Trade verdicts, save, chat, AI analysis, panel sync
// Split from copilot.js for maintainability. Load after copilot-chart.js.
// =========================================================================

    let scannerTradingDeskHandoff = null;
    let riskPlanStrategyCatalog = [];
    let riskPlanState = null;
    let lastCopilotResult = null;
    let activeCopilotAnalysisController = null;
    let activeCopilotAnalysisRequestSeq = 0;
    let pendingTradePlanBootstrap = null;
    let suppressTradePlanStoreSync = false;

    function riskPlanNumber(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }

    function riskPlanDirectionLabel() {
      if (tradeDirection === -1) return 'SHORT';
      if (tradeDirection === 1) return 'LONG';
      return null;
    }

    function riskPlanDirectionSign() {
      if (tradeDirection === -1) return -1;
      if (tradeDirection === 1) return 1;
      return 0;
    }

    function getRiskPlanSymbol() {
      return String(currentCandidate?.symbol || document.getElementById('copilot-symbol')?.value || '').trim().toUpperCase();
    }

    function getRiskPlanLevels() {
      return scannerTradingDeskHandoff?.scannerAIAnalysis?.levels
        || currentCandidate?.scanner_handoff?.scannerAIAnalysis?.levels
        || null;
    }

    function getRiskPlanDetector() {
      return currentCandidate?.detector || scannerTradingDeskHandoff?.candidate?.detector || null;
    }

    function getRiskPlanChartData() {
      if (Array.isArray(currentCandidate?.chart_data) && currentCandidate.chart_data.length) return currentCandidate.chart_data;
      if (Array.isArray(lastCopilotResult?.chart_data) && lastCopilotResult.chart_data.length) return lastCopilotResult.chart_data;
      return [];
    }

    function getRiskPlanPrecision() {
      const step = typeof getTickStep === 'function' ? Number(getTickStep()) : 0.01;
      if (!Number.isFinite(step) || step <= 0) return 2;
      const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
      return Math.max(2, Math.min(5, decimals));
    }

    function roundRiskPlanPrice(value) {
      const num = riskPlanNumber(value);
      if (num === null) return null;
      const step = typeof getTickStep === 'function' ? Number(getTickStep()) : 0.01;
      const precision = getRiskPlanPrecision();
      const rounded = Number.isFinite(step) && step > 0
        ? Math.round(num / step) * step
        : num;
      return Number(rounded.toFixed(precision));
    }

    function inferRiskPlanAtrFromChart(chartData) {
      if (!Array.isArray(chartData) || chartData.length < 2) return null;
      const trueRanges = [];
      for (let i = 1; i < chartData.length; i += 1) {
        const prevClose = riskPlanNumber(chartData[i - 1]?.Close ?? chartData[i - 1]?.close);
        const high = riskPlanNumber(chartData[i]?.High ?? chartData[i]?.high);
        const low = riskPlanNumber(chartData[i]?.Low ?? chartData[i]?.low);
        if (prevClose === null || high === null || low === null) continue;
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose),
        );
        if (Number.isFinite(tr) && tr > 0) {
          trueRanges.push(tr);
        }
      }
      if (!trueRanges.length) return null;
      const sample = trueRanges.slice(-14);
      return sample.reduce((sum, value) => sum + value, 0) / sample.length;
    }

    function inferRiskPlanAtr() {
      const detector = getRiskPlanDetector();
      const directAtr = riskPlanNumber(detector?.activeBaseAtr)
        || riskPlanNumber(currentCandidate?.atr)
        || riskPlanNumber(currentCandidate?.signal_data?.atr);
      if (directAtr && directAtr > 0) return directAtr;
      const inferred = inferRiskPlanAtrFromChart(getRiskPlanChartData());
      return inferred && inferred > 0 ? inferred : null;
    }

    function inferRiskPlanEntryValue() {
      const levels = getRiskPlanLevels();
      const chartData = getRiskPlanChartData();
      const lastBar = chartData.length ? chartData[chartData.length - 1] : null;
      return roundRiskPlanPrice(
        riskPlanNumber(entryPrice)
        || riskPlanNumber(document.getElementById('entry-price-input')?.value)
        || riskPlanNumber(levels?.suggestedEntry)
        || riskPlanNumber(currentCandidate?.anchors?.entry_price)
        || riskPlanNumber(currentCandidate?.anchors?.close_price)
        || riskPlanNumber(lastBar?.Close ?? lastBar?.close)
      );
    }

    function getExistingRiskPlanForSymbol(symbol) {
      const normalized = String(symbol || '').trim().toUpperCase();
      const candidatePlan = currentCandidate?.trade_risk_plan || null;
      if (candidatePlan && String(candidatePlan.symbol || '').trim().toUpperCase() === normalized) {
        return candidatePlan;
      }
      if (riskPlanState && String(riskPlanState.symbol || '').trim().toUpperCase() === normalized) {
        return riskPlanState;
      }
      return null;
    }

    function getDeskRiskPlanLevels() {
      return {
        symbol: getRiskPlanSymbol(),
        direction: riskPlanDirectionLabel(),
        entryPrice: roundRiskPlanPrice(entryPrice || document.getElementById('entry-price-input')?.value),
        stopPrice: roundRiskPlanPrice(stopLossPrice || document.getElementById('stop-loss-price-input')?.value),
        takeProfitPrice: roundRiskPlanPrice(takeProfitPrice || document.getElementById('take-profit-price-input')?.value),
      };
    }

    function inferTradeDirectionFromDeskLevels() {
      const levels = getDeskRiskPlanLevels();
      const entry = riskPlanNumber(levels.entryPrice);
      const stop = riskPlanNumber(levels.stopPrice);
      const target = riskPlanNumber(levels.takeProfitPrice);

      if (entry > 0) {
        if (stop > entry && target < entry) return 'SHORT';
        if (stop < entry && target > entry) return 'LONG';
        if (stop > entry) return 'SHORT';
        if (stop < entry) return 'LONG';
        if (target < entry) return 'SHORT';
        if (target > entry) return 'LONG';
      }

      if (stop > 0 && target > 0 && stop !== target) {
        return stop > target ? 'SHORT' : 'LONG';
      }

      return null;
    }

    function syncTradeDirectionFromDeskLevels() {
      const inferred = inferTradeDirectionFromDeskLevels();
      if (!inferred) return null;
      applyTradeDirectionWithoutAnalysis(inferred);
      return inferred;
    }
    window.syncTradeDirectionFromDeskLevels = syncTradeDirectionFromDeskLevels;

    function syncRiskPlanFromDeskLevels(options = {}) {
      const clearMissing = Boolean(options.clearMissing);
      const liveLevels = getDeskRiskPlanLevels();
      const symbol = liveLevels.symbol;
      if (!symbol) return null;

      const basePlan = getExistingRiskPlanForSymbol(symbol) || {};
      const merged = {
        ...basePlan,
        symbol,
        direction: liveLevels.direction || basePlan.direction || null,
        entryPrice: liveLevels.entryPrice > 0 ? liveLevels.entryPrice : (clearMissing ? null : (basePlan.entryPrice ?? null)),
        stopPrice: liveLevels.stopPrice > 0 ? liveLevels.stopPrice : (clearMissing ? null : (basePlan.stopPrice ?? null)),
        takeProfitPrice: liveLevels.takeProfitPrice > 0 ? liveLevels.takeProfitPrice : (clearMissing ? null : (basePlan.takeProfitPrice ?? null)),
        atr: inferRiskPlanAtr(),
        updatedAt: new Date().toISOString(),
      };

      const hasAnyLevel = [merged.entryPrice, merged.stopPrice, merged.takeProfitPrice].some((value) => value > 0);
      if (!hasAnyLevel && clearMissing) {
        if (currentCandidate?.trade_risk_plan && String(currentCandidate.trade_risk_plan.symbol || '').trim().toUpperCase() === symbol) {
          currentCandidate.trade_risk_plan = null;
        }
        if (riskPlanState && String(riskPlanState.symbol || '').trim().toUpperCase() === symbol) {
          riskPlanState = null;
        }
        return null;
      }

      if (currentCandidate && typeof currentCandidate === 'object') {
        currentCandidate.trade_risk_plan = {
          ...(currentCandidate.trade_risk_plan || {}),
          ...merged,
        };
      }
      riskPlanState = {
        ...(riskPlanState || {}),
        ...merged,
      };
      return riskPlanState;
    }
    window.syncRiskPlanFromDeskLevels = syncRiskPlanFromDeskLevels;

    // Trade-plan sync helpers moved to copilot-trade-plan-sync.js.

    function isDirectionalLevelValid(price, direction, entry, kind) {
      const level = riskPlanNumber(price);
      const ref = riskPlanNumber(entry);
      if (!(level > 0) || !(ref > 0)) return false;
      if (direction !== 'LONG' && direction !== 'SHORT') return false;
      if (direction === 'SHORT') {
        return kind === 'stop' ? level > ref : level < ref;
      }
      return kind === 'stop' ? level < ref : level > ref;
    }

    function inferStructuralStopFromCandidate(direction, entry) {
      const levels = getRiskPlanLevels();
      const detector = getRiskPlanDetector() || {};
      const base = currentCandidate?.base || {};
      const candidates = direction === 'SHORT'
        ? [levels?.suggestedStop, detector.activeBaseTop, base.high]
        : [levels?.suggestedStop, detector.activeBaseBottom, base.low];

      for (const value of candidates) {
        const level = roundRiskPlanPrice(value);
        if (isDirectionalLevelValid(level, direction, entry, 'stop')) return level;
      }
      return null;
    }

    function describeRiskPlanStop(riskConfig) {
      const stopType = String(riskConfig?.stop_type || 'manual').trim().toLowerCase();
      if (stopType === 'atr_multiple') {
        const atrMultiple = riskPlanNumber(riskConfig?.atr_multiplier ?? riskConfig?.stop_value);
        return atrMultiple ? `ATR x ${atrMultiple}` : 'ATR multiple';
      }
      if (stopType === 'fixed_pct') {
        const pct = riskPlanNumber(riskConfig?.stop_value ?? riskConfig?.fixed_stop_pct ?? riskConfig?.stop_buffer_pct);
        return pct ? `Fixed ${(pct * 100).toFixed(1)}%` : 'Fixed percent';
      }
      if (stopType === 'swing_low') return 'Swing low / high';
      if (stopType === 'structural') return 'Structural base';
      return stopType.replace(/[_-]+/g, ' ') || 'Manual';
    }

    function describeRiskPlanTarget(exitConfig, riskConfig) {
      const targetType = String(exitConfig?.target_type || '').trim().toLowerCase();
      const targetLevel = riskPlanNumber(exitConfig?.target_level);
      if (targetType === 'r_multiple' && targetLevel) return `${targetLevel}R target`;
      if (targetType === 'percentage' && targetLevel) return `${(targetLevel * 100).toFixed(1)}% target`;
      if (targetType === 'atr_multiple' && targetLevel) return `ATR x ${targetLevel} target`;
      const takeProfitR = riskPlanNumber(riskConfig?.take_profit_R ?? riskConfig?.take_profit_r);
      return takeProfitR ? `${takeProfitR}R target` : 'Manual target';
    }

    function resetTradingDeskRiskPlanState() {
      riskPlanState = null;
    }
    window.resetTradingDeskRiskPlanState = resetTradingDeskRiskPlanState;

    function buildTradingDeskScannerHandoffContext() {
      if (!scannerTradingDeskHandoff || !scannerTradingDeskHandoff.candidate) return null;
      return {
        source: scannerTradingDeskHandoff.source || 'scanner',
        createdAt: scannerTradingDeskHandoff.createdAt || null,
        symbol: scannerTradingDeskHandoff.symbol || scannerTradingDeskHandoff.candidate.symbol || null,
        interval: scannerTradingDeskHandoff.interval || scannerTradingDeskHandoff.candidate.interval || null,
        timeframe: scannerTradingDeskHandoff.timeframe || scannerTradingDeskHandoff.candidate.timeframe || null,
        candidate: scannerTradingDeskHandoff.candidate,
        fundamentals: scannerTradingDeskHandoff.fundamentals || null,
        scannerAIAnalysis: scannerTradingDeskHandoff.scannerAIAnalysis || null,
      };
    }

    function inferDirectionFromScannerLevels(levels) {
      const entry = Number(levels?.suggestedEntry);
      const stop = Number(levels?.suggestedStop);
      const target = Number(levels?.suggestedTarget);
      if (!Number.isFinite(entry)) return null;
      if (Number.isFinite(stop) && Number.isFinite(target)) {
        if (target < entry && stop > entry) return 'SHORT';
        if (target > entry && stop < entry) return 'LONG';
      }
      if (Number.isFinite(target)) {
        if (target < entry) return 'SHORT';
        if (target > entry) return 'LONG';
      }
      if (Number.isFinite(stop)) {
        if (stop > entry) return 'SHORT';
        if (stop < entry) return 'LONG';
      }
      return null;
    }

    function inferDirectionFromScannerPattern(pattern) {
      const normalized = String(pattern || '').trim().toLowerCase();
      if (!normalized) return null;
      const bearishPatterns = new Set([
        'head_and_shoulders',
        'quasimodo',
        'distribution',
        'broadening_top',
        'double_top',
        'triple_top',
        'rising_wedge_breakdown',
        'bear_flag',
        'descending_triangle',
        'channel_breakdown',
        'rounded_top',
        'trend_reversal',
      ]);
      const bullishPatterns = new Set([
        'base_accumulation',
        'range_reclaim',
        'inverse_head_and_shoulders',
        'double_bottom',
        'triple_bottom',
        'falling_wedge_breakout',
        'bull_flag',
        'ascending_triangle',
        'channel_breakout',
        'rounded_bottom',
      ]);
      if (bearishPatterns.has(normalized)) return 'SHORT';
      if (bullishPatterns.has(normalized)) return 'LONG';
      return null;
    }

    function inferScannerHandoffDirection(packet) {
      const analysis = packet?.scannerAIAnalysis || null;
      const review = analysis?.review || null;
      return inferDirectionFromScannerLevels(analysis?.levels)
        || inferDirectionFromScannerPattern(review?.primaryPattern)
        || inferDirectionFromScannerPattern(review?.alternativePattern)
        || null;
    }

    function applyTradeDirectionWithoutAnalysis(dir) {
      const normalized = dir === -1 || String(dir).toUpperCase() === 'SHORT'
        ? -1
        : dir === 1 || String(dir).toUpperCase() === 'LONG'
          ? 1
          : 0;
      tradeDirection = normalized;
      const longBtn = document.getElementById('btn-direction-long');
      const shortBtn = document.getElementById('btn-direction-short');
      if (longBtn) {
        longBtn.classList.toggle('direction-toggle-btn--active', normalized === 1);
        longBtn.classList.toggle('active', normalized === 1);
      }
      if (shortBtn) {
        shortBtn.classList.toggle('direction-toggle-btn--active', normalized === -1);
        shortBtn.classList.toggle('active', normalized === -1);
      }
      if (typeof updateLivePnL === 'function') updateLivePnL();
      if (typeof window.syncRiskPlanFromDeskLevels === 'function') window.syncRiskPlanFromDeskLevels();
      if (typeof window.renderExecutionRouteSummary === 'function') window.renderExecutionRouteSummary();
    }

    function formatScannerHandoffLabel(value) {
      return String(value ?? '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
    }

    function createScannerHandoffChip(label, value, tone) {
      const chip = document.createElement('span');
      chip.style.display = 'inline-flex';
      chip.style.alignItems = 'center';
      chip.style.gap = '6px';
      chip.style.padding = '6px 10px';
      chip.style.border = '1px solid var(--color-border)';
      chip.style.borderRadius = '999px';
      chip.style.background = 'var(--color-surface)';
      chip.style.fontSize = 'var(--text-caption)';

      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.color = 'var(--color-text-muted)';
      labelEl.style.textTransform = 'uppercase';
      labelEl.style.letterSpacing = '0.06em';

      const valueEl = document.createElement('span');
      valueEl.textContent = value;
      valueEl.style.color = tone || 'var(--color-text)';
      valueEl.style.fontWeight = '600';

      chip.appendChild(labelEl);
      chip.appendChild(valueEl);
      return chip;
    }

    function setScannerHandoffPanelVisible(visible) {
      const panel = document.getElementById('scanner-handoff-panel');
      if (panel) panel.classList.toggle('hidden', !visible);
    }

    function renderScannerTradingDeskHandoff(packet, deskAnalysis) {
      const panel = document.getElementById('scanner-handoff-panel');
      const summaryEl = document.getElementById('scanner-handoff-summary');
      const readEl = document.getElementById('scanner-handoff-read');
      const reasonsEl = document.getElementById('scanner-handoff-reasons');
      const risksEl = document.getElementById('scanner-handoff-risks');
      const statusEl = document.getElementById('scanner-handoff-status');

      if (!panel || !summaryEl || !readEl || !reasonsEl || !risksEl || !statusEl) return;

      if (!packet || !packet.candidate) {
        summaryEl.innerHTML = '';
        readEl.textContent = '';
        reasonsEl.innerHTML = '';
        risksEl.innerHTML = '';
        statusEl.textContent = 'No scanner handoff loaded';
        setScannerHandoffPanelVisible(false);
        return;
      }

      const candidate = packet.candidate || {};
      const analysis = packet.scannerAIAnalysis || null;
      const review = analysis?.review || null;
      const fundamentals = packet.fundamentals || null;
      const scannerDirection = inferScannerHandoffDirection(packet);
      const analysisMatchesPacket = deskAnalysis
        && String(deskAnalysis.symbol || '').trim().toUpperCase() === String(packet.symbol || candidate.symbol || '').trim().toUpperCase();
      const deskDirection = analysisMatchesPacket ? (deskAnalysis?.trade_direction || null) : null;
      const agreement = scannerDirection && deskDirection
        ? (scannerDirection === String(deskDirection).toUpperCase() ? 'Agrees' : 'Conflicts')
        : null;
      const directionTone = scannerDirection === 'SHORT'
        ? 'var(--color-negative, #ef4444)'
        : scannerDirection === 'LONG'
          ? 'var(--color-positive, #4ade80)'
          : 'var(--color-text)';
      const agreementTone = agreement === 'Agrees'
        ? 'var(--color-positive, #4ade80)'
        : agreement === 'Conflicts'
          ? 'var(--color-warning, #f59e0b)'
          : 'var(--color-text)';
      const chips = [
        ['Pattern', formatScannerHandoffLabel(review?.primaryPattern || candidate.pattern_type || 'Scanner')],
        review?.alternativePattern ? ['Alt', formatScannerHandoffLabel(review.alternativePattern)] : null,
        review?.stateAssessment ? ['State', formatScannerHandoffLabel(review.stateAssessment)] : null,
        review?.timingAssessment ? ['Timing', formatScannerHandoffLabel(review.timingAssessment)] : null,
        scannerDirection ? ['Scanner Thesis', scannerDirection, directionTone] : null,
        agreement ? ['Desk Check', `${deskDirection} ${agreement}`, agreementTone] : null,
        candidate.candidate_actionability_label ? ['Actionability', formatScannerHandoffLabel(candidate.candidate_actionability_label)] : null,
        Number.isFinite(analysis?.confidence) ? ['Confidence', `${Math.round(Number(analysis.confidence))}%`] : null,
        fundamentals?.quality ? ['Quality', formatScannerHandoffLabel(fundamentals.quality)] : null,
      ].filter(Boolean);

      summaryEl.innerHTML = '';
      chips.forEach(([label, value, tone]) => {
        summaryEl.appendChild(createScannerHandoffChip(label, value, tone));
      });

      readEl.textContent = analysis?.explanation
        || candidate.candidate_semantic_summary
        || `Scanner handoff loaded for ${packet.symbol || candidate.symbol || 'this symbol'}.`;

      const reasons = Array.isArray(review?.topReasons) ? review.topReasons : [];
      const risks = Array.isArray(review?.topRisks) ? review.topRisks : [];

      reasonsEl.innerHTML = '';
      (reasons.length ? reasons : ['No scanner reasons provided.']).forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        reasonsEl.appendChild(li);
      });

      risksEl.innerHTML = '';
      (risks.length ? risks : ['No scanner risks provided.']).forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        risksEl.appendChild(li);
      });

      const statusParts = [`${packet.symbol || candidate.symbol || 'Scanner'} ${packet.interval || candidate.interval || ''}`.trim()];
      if (scannerDirection) statusParts.push(`Scanner bias: ${scannerDirection}`);
      if (deskDirection) statusParts.push(`Desk: ${deskDirection}`);
      statusEl.textContent = statusParts.join(' Â· ');
      setScannerHandoffPanelVisible(true);
    }

    function buildTradingDeskCopilotAnalysisPayload(analysis) {
      if (!analysis) return null;

      const payload = {
        verdict: analysis.verdict,
        commentary: analysis.commentary,
        currentPrice: analysis.current_price,
        retracement: analysis.current_retracement_pct,
        primaryTrend: analysis.primary_trend,
        intermediateTrend: analysis.intermediate_trend,
        trendAlignment: analysis.trend_alignment,
        tradeDirection: analysis.trade_direction || riskPlanDirectionLabel() || null,
        nearestFib: analysis.nearest_level,
        energy: analysis.energy,
        sellingPressure: analysis.selling_pressure,
        pressureType: analysis.pressure_type || 'Selling',
        buyingPressure: analysis.buying_pressure,
        goReasons: analysis.go_reasons,
        nogoReasons: analysis.nogo_reasons,
        stopDistancePct: analysis.stop_distance_pct,
        range: analysis.range
      };

      const scannerContext = buildTradingDeskScannerHandoffContext();
      if (scannerContext) {
        payload.scannerHandoff = scannerContext;
      }

      return payload;
    }

    function mergeCopilotAnalysisIntoCurrentCandidate(analysis) {
      if (!analysis || typeof analysis !== 'object') return;

      const existing = currentCandidate && typeof currentCandidate === 'object' ? currentCandidate : {};
      currentCandidate = {
        ...existing,
        symbol: analysis.symbol || existing.symbol || document.getElementById('copilot-symbol')?.value?.trim().toUpperCase() || '',
        timeframe: analysis.timeframe || document.getElementById('copilot-interval')?.value || existing.timeframe || existing.interval || '1d',
        pattern_type: analysis.pattern_type || existing.pattern_type || 'manual',
        chart_data: analysis.chart_data || existing.chart_data || null,
        fib_levels: analysis.fib_levels || existing.fib_levels || null,
        range: analysis.range || existing.range || null,
        scanner_handoff: scannerTradingDeskHandoff || existing.scanner_handoff || null,
        fundamentals: scannerTradingDeskHandoff?.fundamentals || existing.fundamentals || null,
        detector: scannerTradingDeskHandoff?.candidate?.detector || existing.detector || null,
      };
    }

    function applyScannerTradingDeskHandoff(packet) {
      if (!packet || !packet.candidate) return false;

      resetTradingDeskRiskPlanState();
      scannerTradingDeskHandoff = packet;
      const existing = currentCandidate && typeof currentCandidate === 'object' ? currentCandidate : {};
      currentCandidate = {
        ...existing,
        ...packet.candidate,
        symbol: packet.symbol || packet.candidate.symbol || existing.symbol || '',
        timeframe: packet.candidate.timeframe || packet.timeframe || existing.timeframe || null,
        interval: packet.interval || packet.candidate.interval || existing.interval || null,
        pattern_type: packet.candidate.pattern_type || existing.pattern_type || 'scanner',
        scanner_handoff: packet,
        fundamentals: packet.fundamentals || existing.fundamentals || null,
        detector: packet.candidate.detector || existing.detector || null,
      };

      const symbolInput = document.getElementById('copilot-symbol');
      if (symbolInput && !symbolInput.value.trim()) {
        symbolInput.value = currentCandidate.symbol || '';
      }

      const intervalSelect = document.getElementById('copilot-interval');
      const handoffInterval = packet.interval || packet.candidate.interval || null;
      if (intervalSelect && handoffInterval) {
        const option = Array.from(intervalSelect.options).find((item) => item.value === handoffInterval);
        if (option) intervalSelect.value = handoffInterval;
      }

      const inferredDirection = inferScannerHandoffDirection(packet);
      if (inferredDirection === 'SHORT' || inferredDirection === 'LONG') {
        applyTradeDirectionWithoutAnalysis(inferredDirection);
      }

      renderScannerTradingDeskHandoff(packet, null);

      if (typeof addChatMessage === 'function') {
        const summary = window.ScannerTradingDeskHandoff?.describe
          ? window.ScannerTradingDeskHandoff.describe(packet)
          : `Loaded scanner setup for ${currentCandidate.symbol || 'unknown symbol'}.`;
        addChatMessage(summary, 'ai');
      }
      if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
      return true;
    }

    // Risk-plan modal helpers moved to copilot-risk-plan.js.

    // Execution route helpers moved to copilot-execution-route.js.

    // Trade actions and chat helpers moved to dedicated Trading Desk files.



    // Analysis lifecycle and panel rendering moved to copilot-analysis.js.
