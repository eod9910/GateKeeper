// =========================================================================
// copilot-chart.js — Verdict engine, chart init, trade levels, drawing tools
// Split from copilot.js for maintainability. Load after copilot-core.js.
// =========================================================================

    // ========== 4-LAYER VERDICT ENGINE ==========

    function checkAccountConstraints(settings, sizing) {
      const results = [];
      const riskBudget = settings.accountSize * (settings.riskPercent / 100);
      
      // Buying power check
      if (sizing.requiredCapital > settings.availableBalance) {
        results.push({ pass: false, msg: `Insufficient funds: need $${sizing.requiredCapital.toLocaleString()}, have $${settings.availableBalance.toLocaleString()}` });
      } else {
        results.push({ pass: true, msg: `Capital: $${sizing.requiredCapital.toLocaleString()} within $${settings.availableBalance.toLocaleString()} available` });
      }
      
      // Risk budget check
      // For futures/options at minimum 1 contract, warn instead of hard-deny
      const isMinUnit = (settings.instrumentType === 'futures' || settings.instrumentType === 'options') && sizing.units === 1;
      if (sizing.maxLoss > riskBudget * 1.1) {
        const actualRiskPct = (sizing.maxLoss / settings.accountSize * 100).toFixed(1);
        if (isMinUnit) {
          // At minimum 1 contract â€” warn but allow
          results.push({ pass: true, msg: `âš ï¸ Risk $${sizing.maxLoss.toFixed(0)} exceeds ${settings.riskPercent}% budget ($${riskBudget.toFixed(0)}) â€” actual risk: ${actualRiskPct}% (minimum 1 contract)` });
        } else {
          results.push({ pass: false, msg: `Max loss $${sizing.maxLoss.toFixed(0)} exceeds risk budget $${riskBudget.toFixed(0)}` });
        }
      } else {
        results.push({ pass: true, msg: `Risk: $${sizing.maxLoss.toFixed(0)} within $${riskBudget.toFixed(0)} budget` });
      }
      
      // Daily loss limit
      const dailyLossMax = settings.accountSize * (settings.dailyLossLimit / 100);
      if (tradeStats.dailyLoss + sizing.maxLoss > dailyLossMax) {
        if (isMinUnit && tradeStats.dailyLoss === 0) {
          // First trade of day at minimum 1 contract â€” warn but allow
          results.push({ pass: true, msg: `âš ï¸ Trade risk $${sizing.maxLoss.toFixed(0)} exceeds daily limit $${dailyLossMax.toFixed(0)} (minimum 1 contract)` });
        } else {
          results.push({ pass: false, msg: `Daily loss limit: $${tradeStats.dailyLoss.toFixed(0)} already lost + $${sizing.maxLoss.toFixed(0)} this trade > $${dailyLossMax.toFixed(0)} limit` });
        }
      } else {
        results.push({ pass: true, msg: `Daily loss: $${tradeStats.dailyLoss.toFixed(0)} + $${sizing.maxLoss.toFixed(0)} within $${dailyLossMax.toFixed(0)} limit` });
      }
      
      // Max open positions
      if (tradeStats.openPositions >= settings.maxOpenPositions) {
        results.push({ pass: false, msg: `Max positions: ${tradeStats.openPositions} open (limit: ${settings.maxOpenPositions})` });
      } else {
        results.push({ pass: true, msg: `Positions: ${tradeStats.openPositions} of ${settings.maxOpenPositions} max` });
      }
      
      return { layer: 'Account', results, pass: results.every(r => r.pass) };
    }

    function checkInstrumentRules(settings, sizing) {
      const results = [];
      
      if (sizing.units <= 0) {
        results.push({ pass: false, msg: `Cannot size position: risk too small or margin too high for minimum unit` });
      } else {
        results.push({ pass: true, msg: `Position: ${sizing.units} ${sizing.unitLabel}` });
      }
      
      // Instrument-specific checks
      if (settings.instrumentType === 'futures') {
        const totalMargin = sizing.units * settings.futuresMargin;
        const marginPct = (totalMargin / settings.accountSize * 100).toFixed(1);
        if (totalMargin > settings.availableBalance) {
          results.push({ pass: false, msg: `Margin $${totalMargin.toLocaleString()} exceeds available balance` });
        } else {
          results.push({ pass: true, msg: `Margin: $${totalMargin.toLocaleString()} (${marginPct}% of account)` });
        }
      }
      
      if (settings.instrumentType === 'options') {
        const strike = settings.optionStrike > 0 ? ` $${settings.optionStrike} strike` : '';
        const expiry = settings.optionExpiry ? ` exp ${settings.optionExpiry}` : '';
        results.push({ pass: true, msg: `${settings.optionType.toUpperCase()}${strike}${expiry} | Entry premium: $${settings.optionPrice.toFixed(2)} | Max loss = $${sizing.maxLoss.toLocaleString()}` });
      }
      
      if (settings.instrumentType === 'forex') {
        const marginPct = (sizing.requiredCapital / settings.accountSize * 100).toFixed(1);
        results.push({ pass: true, msg: `Leverage: ${settings.leverage}:1 | Margin: $${sizing.requiredCapital.toLocaleString()} (${marginPct}%)` });
      }
      
      if (settings.instrumentType === 'crypto') {
        const feeNote = `Est. round-trip fees: $${(sizing.positionValue * settings.exchangeFee / 100 * 2).toFixed(2)}`;
        results.push({ pass: true, msg: feeNote });
      }
      
      return { layer: 'Instrument', results, pass: results.every(r => r.pass) };
    }

    function checkRiskManagement(settings, sizing, rr) {
      const results = [];
      const positionPct = (sizing.positionValue / settings.accountSize) * 100;
      
      // R:R ratio
      if (rr < settings.minRR) {
        results.push({ pass: false, msg: `R:R 1:${rr.toFixed(2)} below minimum 1:${settings.minRR}` });
      } else {
        results.push({ pass: true, msg: `R:R 1:${rr.toFixed(2)} meets minimum 1:${settings.minRR}` });
      }
      
      // Max position size
      if (positionPct > settings.maxPosition) {
        results.push({ pass: false, msg: `Position ${positionPct.toFixed(1)}% exceeds max ${settings.maxPosition}%` });
      } else {
        results.push({ pass: true, msg: `Position ${positionPct.toFixed(1)}% within max ${settings.maxPosition}%` });
      }
      
      // Max daily trades
      if (tradeStats.tradesToday >= settings.maxDailyTrades) {
        results.push({ pass: false, msg: `Daily trades: ${tradeStats.tradesToday} reached limit of ${settings.maxDailyTrades}` });
      } else {
        results.push({ pass: true, msg: `Daily trades: ${tradeStats.tradesToday} of ${settings.maxDailyTrades} max` });
      }
      
      // Consecutive losses
      if (tradeStats.consecutiveLosses >= settings.maxConsecutiveLosses) {
        results.push({ pass: false, msg: `${tradeStats.consecutiveLosses} consecutive losses â€” circuit breaker (limit: ${settings.maxConsecutiveLosses})` });
      } else if (tradeStats.consecutiveLosses > 0) {
        results.push({ pass: true, msg: `Consecutive losses: ${tradeStats.consecutiveLosses} of ${settings.maxConsecutiveLosses} limit` });
      } else {
        results.push({ pass: true, msg: `No consecutive losses` });
      }
      
      // Max drawdown: compare peak balance to current balance (account + realized P&L)
      const currentBalance = tradeStats.currentBalance || settings.accountSize;
      const currentDrawdown = tradeStats.peakBalance > 0
        ? Math.max(0, ((tradeStats.peakBalance - currentBalance) / tradeStats.peakBalance) * 100)
        : 0;
      if (currentDrawdown > settings.maxDrawdown) {
        results.push({ pass: false, msg: `Drawdown ${currentDrawdown.toFixed(1)}% exceeds ${settings.maxDrawdown}% circuit breaker` });
      } else {
        results.push({ pass: true, msg: `Drawdown: ${currentDrawdown.toFixed(1)}% within ${settings.maxDrawdown}% limit` });
      }
      
      return { layer: 'Risk', results, pass: results.every(r => r.pass) };
    }

    function checkSetupQuality(candidate) {
      const results = [];
      if (!candidate || !candidate.copilotData) {
        results.push({ pass: true, msg: 'No scanner data available â€” skipping setup checks' });
        return { layer: 'Setup', results, pass: true, advisory: true };
      }
      
      const data = candidate.copilotData;
      
      // Trend alignment
      if (data.trend_alignment) {
        const aligned = data.trend_alignment === 'ALIGNED';
        results.push({ 
          pass: aligned, 
          msg: `Trend: ${data.primary_trend || '?'} / ${data.intermediate_trend || '?'} â€” ${data.trend_alignment}` 
        });
      }
      
      // Energy state
      if (data.energy) {
        const compressed = data.energy.state === 'COMPRESSED' || data.energy.state === 'COMPRESSING';
        results.push({ 
          pass: compressed, 
          msg: `Energy: ${data.energy.state || '?'} | Direction: ${data.energy.direction || '?'}` 
        });
      }
      
      // Pressure (direction-aware: buying pressure in uptrend, selling pressure in downtrend)
      if (data.selling_pressure !== undefined) {
        const pressureType = data.pressure_type || 'Selling';
        const low = data.selling_pressure < 40;
        results.push({ 
          pass: low, 
          msg: `${pressureType} pressure: ${data.selling_pressure}${data.selling_pressure >= 40 ? ' (elevated â€” still active)' : ' (low â€” fading)'}` 
        });
      }
      
      // Retracement quality
      if (data.retracement_pct !== undefined) {
        const inZone = data.retracement_pct >= 50 && data.retracement_pct <= 88;
        results.push({ 
          pass: inZone, 
          msg: `Retracement: ${data.retracement_pct.toFixed(1)}%${inZone ? ' (in buy zone)' : ''}` 
        });
      }
      
      return { layer: 'Setup', results, pass: true, advisory: true }; // Advisory only â€” never hard deny
    }

    async function runVerdictEngine() {
      if (!entryPrice || !stopLossPrice) {
        addChatMessage('Set both entry and stop loss levels first.', 'ai');
        return null;
      }
      
      const settings = getSettings();
      await loadTradeStats();
      
      const sizingContext = typeof getPositionSizingContext === 'function'
        ? getPositionSizingContext(settings, entryPrice, stopLossPrice)
        : { autoSizing: calculatePositionSize(settings, entryPrice, stopLossPrice), effectiveSizing: calculatePositionSize(settings, entryPrice, stopLossPrice), manualUnits: null };
      const sizing = sizingContext.effectiveSizing;
      const reward = takeProfitPrice ? Math.abs(takeProfitPrice - entryPrice) : 0;
      const risk = Math.abs(entryPrice - stopLossPrice);
      const rr = reward > 0 ? reward / risk : 0;
      let targetProfit = 0;
      if (takeProfitPrice) {
        switch (settings.instrumentType) {
          case 'futures':
            targetProfit = sizing.units * reward * settings.futuresPointValue;
            break;
          case 'options':
            // For options, target profit is estimated from delta exposure (simplified)
            targetProfit = sizing.units * reward * settings.contractMultiplier;
            break;
          case 'forex': {
            const lotUnits = { standard: 100000, mini: 10000, micro: 1000 };
            const pipScale = (lotUnits[settings.lotSize] || 100000) / 100000;
            targetProfit = sizing.units * reward * settings.pipValue * pipScale;
            break;
          }
          default: // stock, crypto
            targetProfit = sizing.units * reward;
            break;
        }
      }
      
      // Run all 4 layers
      const layer1 = checkAccountConstraints(settings, sizing);
      const layer2 = checkInstrumentRules(settings, sizing);
      const layer3 = checkRiskManagement(settings, sizing, rr);
      const layer4 = checkSetupQuality(currentCandidate);
      
      const allLayers = [layer1, layer2, layer3, layer4];
      const approved = layer1.pass && layer2.pass && layer3.pass; // Layer 4 is advisory
      
      window.lastVerdict = approved ? 'APPROVED' : 'DENIED';
      
      return { approved, layers: allLayers, sizing, autoSizing: sizingContext.autoSizing, rr, targetProfit, settings };
    }

    // Load saved candidates from backend
    let savedChartsList = [];
    
    async function loadSavedCandidates() {
      const container = document.getElementById('candidates-list');
      
      try {
        const res = await fetch('/api/saved-charts?metadata=true');
        const data = await res.json();
        savedChartsList = data.success && data.data ? data.data : [];
      } catch (e) {
        console.error('Failed to load saved charts:', e);
        savedChartsList = [];
      }
      
      if (savedChartsList.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-xs px-2">No saved charts yet.<br><a href="index.html" class="text-blue-400 hover:underline">Go to Pattern Detector</a> and save some charts.</p>';
        return;
      }

      container.innerHTML = savedChartsList.map((item, idx) => `
        <div class="saved-item" onclick="loadCandidate('${item.id}')" id="candidate-${idx}">
          <span class="saved-item-symbol">${item.symbol || item.name}</span>
          <button onclick="event.stopPropagation(); deleteSavedChart('${item.id}')" 
                  class="saved-item-delete" title="Remove">&times;</button>
        </div>
      `).join('');
    }
    
    // Delete a saved chart
    async function deleteSavedChart(chartId) {
      if (!confirm('Delete this saved chart?')) return;
      
      try {
        await fetch(`/api/saved-charts/${chartId}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Failed to delete chart:', e);
      }
      
      // Clear current candidate if it was the deleted one
      if (currentCandidate && currentCandidate.id == chartId) {
        currentCandidate = null;
        candleSeries.setData([]);
        document.getElementById('chart-symbol').textContent = 'Select a chart';
        document.getElementById('chart-pattern').textContent = '--';
      }
      
      // Refresh the list
      loadSavedCandidates();
    }

    // Initialize empty chart
    // Canvas for drawing annotations
    let drawingCanvas = null;
    let drawingCtx = null;
    
    // Drawing colors
    const drawingColors = {
      peak: '#ef4444',
      markdown: '#f97316',
      base: '#22c55e',
      markup: '#3b82f6',
      pullback: '#eab308',
      breakout: '#a855f7'
    };
    
    function initChart() {
      const container = document.getElementById('chart-container');
      const chartArea = document.getElementById('chart-area');
      
      chart = LightweightCharts.createChart(chartArea, {
        width: container.clientWidth,
        height: container.clientHeight || 500,
        layout: {
          background: { type: 'solid', color: '#1e1e1e' },
          textColor: '#9ca3af',
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
        },
        rightPriceScale: {
          borderColor: '#374151',
        },
      });

      candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      // Click handler for setting levels AND drawing tools
      chart.subscribeClick((param) => {
        // Don't handle clicks if we're dragging
        if (isDragging) return;
        if (!param.point) return;
        
        const price = candleSeries.coordinateToPrice(param.point.y);
        const time = chart.timeScale().coordinateToTime(param.point.x);
        if (price === null) return;

        // Drawing tool takes priority (legacy inline tools)
        if (activeDrawingTool) {
          handleDrawingClick(price, time, param.point);
          return;
        }

        // Universal drawing tools module takes priority
        if (window._copilotDrawingTools && window._copilotDrawingTools.getActiveTool()) return;
        
        // Otherwise handle entry/stop/target marker mode
        if (!markerMode) return;
        
        if (markerMode === 'entry') {
          setEntry(price);
        } else if (markerMode === 'stopLoss') {
          setStopLoss(price);
        } else if (markerMode === 'takeProfit') {
          setTakeProfit(price);
        }
        
        // Clear mode after setting
        setMarkerMode(null);
        updateCalculations();
      });
      
      // Crosshair move handler for drawing tool live preview + live P&L
      chart.subscribeCrosshairMove((param) => {
        // Update live P&L with the price under the crosshair (or last bar close)
        if (param.point && entryPrice) {
          const hoverPrice = candleSeries.coordinateToPrice(param.point.y);
          if (hoverPrice !== null) updateLivePnL(hoverPrice);
        } else if (param.seriesData && param.seriesData.size > 0) {
          // Use last bar close when crosshair leaves chart
          const barData = param.seriesData.get(candleSeries);
          if (barData && barData.close) updateLivePnL(barData.close);
        }

        if (!activeDrawingTool || !drawingState.placing || !param.point) return;
        const price = candleSeries.coordinateToPrice(param.point.y);
        const time = chart.timeScale().coordinateToTime(param.point.x);
        if (price === null) return;
        drawingState.previewPrice = price;
        drawingState.previewTime = time;
        drawingState.previewPoint = param.point;
        renderDrawingPreview();
      });
      
      // Escape key cancels drawing
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeDrawingTool) {
          cancelDrawing();
        }
      });
      
      // Setup drag handlers for moving lines
      setupDragHandlers();
      
      // Setup editable price inputs for entry/stop/TP
      setupPriceInputs();
      
      // Initialize drawing canvas
      initDrawingCanvas();
      
      // Start continuous update loop for drawings
      startDrawingUpdateLoop();

      // Resize handler â€” keep chart filling its container
      window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight || 500 });
        resizeDrawingCanvas();
      });

      // Attach universal drawing tools module
      if (typeof DrawingToolsManager !== 'undefined') {
        if (window._copilotDrawingTools) window._copilotDrawingTools.destroy();
        const chartArea = document.getElementById('chart-area');
        window._copilotDrawingTools = new DrawingToolsManager(chart, candleSeries, chartArea, {
          getBars: () => {
            const bars = currentCandidate?.chart_data || lastCopilotResult?.chart_data || [];
            return Array.isArray(bars) ? bars : [];
          },
        });

        const tbEl = document.getElementById('copilot-dt-toolbar');
        if (tbEl) {
          DrawingToolsManager.attachToolbar(tbEl, 'chart-area', window._copilotDrawingTools);
        }
      }
    }

    function fitChartToContent() {
      if (!chart || !candleSeries) return;
      try {
        chart.timeScale().fitContent();
        const container = document.getElementById('chart-container');
        if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        console.warn('fitChartToContent:', e);
      }
    }

    // Load a saved candidate
    async function loadCandidate(chartId) {
      // Fetch full chart data from backend
      let candidate = null;
      try {
        const res = await fetch(`/api/saved-charts/${chartId}`);
        const data = await res.json();
        if (data.success && data.data) {
          candidate = data.data;
        }
      } catch (e) {
        console.error('Failed to load chart:', e);
      }
      if (!candidate) return alert('Chart not found');

      if (typeof resetTradingDeskRiskPlanState === 'function') {
        resetTradingDeskRiskPlanState();
      }
      currentCandidate = candidate;
      if (typeof window.cancelPendingCopilotAnalysis === 'function') window.cancelPendingCopilotAnalysis();
      if (typeof window.clearCopilotAnalysisState === 'function') window.clearCopilotAnalysisState();
      if (typeof window.resetCopilotAnalysisPanel === 'function') window.resetCopilotAnalysisPanel();
      if (typeof window.resetCopilotChat === 'function') {
        window.resetCopilotChat({
          symbol: candidate.symbol,
          timeframe: candidate.timeframe || document.getElementById('copilot-interval')?.value || '',
          mode: 'loaded',
        });
      }
      
      // Reset trade levels and verdict for new chart
      clearLevels();
      
      // Reset save panel state
      document.getElementById('save-trade-panel').classList.add('hidden');
      orderType = 'market';
      const saveBtn = document.getElementById('btn-save-trade');
      saveBtn.disabled = false;
      
      // Highlight selected candidate in sidebar
      document.querySelectorAll('#candidates-list .sidebar-item').forEach((el) => {
        const isMatch = el.getAttribute('onclick')?.includes(chartId);
        el.classList.toggle('active', !!isMatch);
      });
      
      // Update UI
      document.getElementById('chart-symbol').textContent = candidate.symbol;
      document.getElementById('chart-pattern').textContent = candidate.pattern_type || 'Wyckoff';

      // Load chart data
      if (candidate.chart_data && candidate.chart_data.length > 0) {
        const safeData = sanitizeChartData(candidate.chart_data);
        if (safeData.length > 0) {
          try { candleSeries.setData(safeData); } catch(e) { console.warn('Chart setData error:', e.message); }
          chart.timeScale().fitContent();
        }
        const lastBar = candidate.chart_data[candidate.chart_data.length - 1];
        // Price inputs are already blank (placeholder shows --)
      } else {
        // No chart data - show message
        addChatMessage(`Ã¢Å¡Â ï¸ This chart was saved without price data. Please re-save it from the Pattern Detector to include the chart data.`, 'ai');
      }

      clearAutomaticChartDecorations();

      // Check if user annotations exist
      const userDrawingCount = candidate.drawings ? Object.values(candidate.drawings).filter(d => d !== null).length : 0;
      
      // Load saved user drawings/annotations
      if (candidate.drawings && userDrawingCount > 0) {
        savedDrawings = candidate.drawings;
        // Draw on canvas
        setTimeout(() => redrawUserDrawings(), 100);
      }
      
      // Report what was loaded
      if (userDrawingCount > 0) {
        let msg = 'ðŸ“ Loaded: ';
        msg += `${userDrawingCount} user annotations`;
        addChatMessage(msg, 'ai');
      }

      // Clear any existing levels
      clearLevels();

      // Add AI message
      addChatMessage(`Loaded ${candidate.symbol}. I see this is flagged as a ${candidate.pattern_type || 'Wyckoff'} pattern. Click the symbol header or use Plan Exits to set the initial stop-loss and take-profit before sending it to Execution Desk.`, 'ai');
    }

    // Set marker mode
    function setMarkerMode(mode) {
      markerMode = mode;
      
      // Update button active states
      var btnEntry = document.getElementById('btn-entry');
      var btnStop = document.getElementById('btn-stop-loss');
      var btnTP = document.getElementById('btn-take-profit');
      
      [btnEntry, btnStop, btnTP].forEach(function(btn) {
        if (btn) btn.classList.remove('active');
      });
      
      if (mode === 'entry' && btnEntry) btnEntry.classList.add('active');
      if (mode === 'stopLoss' && btnStop) btnStop.classList.add('active');
      if (mode === 'takeProfit' && btnTP) btnTP.classList.add('active');

      if (mode) {
        // Only show the chat hint if this level hasn't been set yet
        var alreadySet = (mode === 'entry' && entryPrice) ||
                         (mode === 'stopLoss' && stopLossPrice) ||
                         (mode === 'takeProfit' && takeProfitPrice);
        if (!alreadySet) {
          const modeNames = { entry: 'entry', stopLoss: 'stop loss', takeProfit: 'take profit' };
          addChatMessage(`Click on the chart to set your ${modeNames[mode]} level.`, 'ai');
        }
      }
    }

    // Drag state
    let isDragging = false;
    let dragLineType = null;
    const DRAG_THRESHOLD = 12; // pixels - how close to line to enable drag

    // Get the tick step for the current instrument (for input stepping)
    function getTickStep() {
      const sym = document.getElementById('copilot-symbol')?.value;
      const spec = getContractSpec(sym);
      return spec ? spec.tickSize : 0.01;
    }

    // Update the step attribute on all price inputs to match instrument tick size
    function updatePriceInputSteps() {
      const step = getTickStep();
      const inputs = ['entry-price-input', 'stop-loss-price-input', 'take-profit-price-input'];
      inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.step = step;
      });
    }

    // Set entry level
    function setEntry(price) {
      entryPrice = price;
      const inputEl = document.getElementById('entry-price-input');
      if (inputEl) inputEl.value = price.toFixed(2);
      
      // Remove old line and add new
      if (entryLine) {
        candleSeries.removePriceLine(entryLine);
      }
      entryLine = candleSeries.createPriceLine({
        price: price,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: 'ENTRY',
      });
      updateLivePnL();
      if (typeof window.syncTradeDirectionFromDeskLevels === 'function') window.syncTradeDirectionFromDeskLevels();
      if (typeof window.syncRiskPlanFromDeskLevels === 'function') window.syncRiskPlanFromDeskLevels();
      if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();
      if (typeof window.syncTradePlanStoreFromDesk === 'function') window.syncTradePlanStoreFromDesk('entry_set');
    }

    // Set stop loss level
    function setStopLoss(price) {
      stopLossPrice = price;
      const inputEl = document.getElementById('stop-loss-price-input');
      if (inputEl) inputEl.value = price.toFixed(2);
      
      // Remove old line and add new
      if (stopLossLine) {
        candleSeries.removePriceLine(stopLossLine);
      }
      stopLossLine = candleSeries.createPriceLine({
        price: price,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'STOP',
      });
      updateLivePnL();
      if (typeof window.syncTradeDirectionFromDeskLevels === 'function') window.syncTradeDirectionFromDeskLevels();
      if (typeof window.syncRiskPlanFromDeskLevels === 'function') window.syncRiskPlanFromDeskLevels();
      if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();
      if (typeof window.syncTradePlanStoreFromDesk === 'function') window.syncTradePlanStoreFromDesk('stop_set');
    }

    // Set take profit level
    function setTakeProfit(price) {
      takeProfitPrice = price;
      const inputEl = document.getElementById('take-profit-price-input');
      if (inputEl) inputEl.value = price.toFixed(2);
      
      // Remove old line and add new
      if (takeProfitLine) {
        candleSeries.removePriceLine(takeProfitLine);
      }
      takeProfitLine = candleSeries.createPriceLine({
        price: price,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TARGET',
      });
      updateLivePnL();
      if (typeof window.syncTradeDirectionFromDeskLevels === 'function') window.syncTradeDirectionFromDeskLevels();
      if (typeof window.syncRiskPlanFromDeskLevels === 'function') window.syncRiskPlanFromDeskLevels();
      if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();
      if (typeof window.syncTradePlanStoreFromDesk === 'function') window.syncTradePlanStoreFromDesk('target_set');
    }
    
    // Check if mouse Y is near a price line
    function getLineNearY(yCoord) {
      const lines = [
        { line: entryLine, type: 'entry', price: entryPrice },
        { line: stopLossLine, type: 'stopLoss', price: stopLossPrice },
        { line: takeProfitLine, type: 'takeProfit', price: takeProfitPrice },
      ];
      
      for (const item of lines) {
        if (item.line && item.price !== null) {
          const lineY = candleSeries.priceToCoordinate(item.price);
          if (lineY !== null && Math.abs(yCoord - lineY) < DRAG_THRESHOLD) {
            return item.type;
          }
        }
      }
      return null;
    }
    
    // Setup drag handlers on chart container
    function setupDragHandlers() {
      const container = document.getElementById('chart-container');
      
      // Use capture phase to intercept events before Lightweight Charts
      container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        
        if (isDragging && dragLineType) {
          const newPrice = candleSeries.coordinateToPrice(y);
          
          if (newPrice !== null) {
            updateDraggedLine(dragLineType, newPrice);
          }
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }
        
        // Check if hovering near a line - update cursor
        const nearLine = getLineNearY(y);
        container.style.cursor = nearLine ? 'ns-resize' : '';
      }, true); // Capture phase
      
      container.addEventListener('mousedown', (e) => {
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const nearLine = getLineNearY(y);
        
        if (nearLine) {
          isDragging = true;
          dragLineType = nearLine;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }, true); // Capture phase
      
      // Use document-level listeners for mouseup to catch releases outside container
      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          dragLineType = null;
          updateCalculations();
        }
      });
      
      container.addEventListener('mouseleave', () => {
        // Don't stop drag on mouseleave - let document mouseup handle it
        // This allows dragging outside the container briefly
      });
    }
    
    // Setup editable price inputs for entry, stop loss, take profit
    function setupPriceInputs() {
      const entryInput = document.getElementById('entry-price-input');
      const stopInput = document.getElementById('stop-loss-price-input');
      const tpInput = document.getElementById('take-profit-price-input');

      // Update step sizes based on instrument
      updatePriceInputSteps();

      // Helper: debounce rapid input (e.g., typing digits) to avoid thrashing chart lines
      function onPriceInputChange(inputEl, setFn) {
        let debounceTimer = null;
        const handler = () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const val = parseFloat(inputEl.value);
            if (!isNaN(val) && val > 0) {
              setFn(val);
              updateCalculations();
            }
          }, 150);
        };
        inputEl.addEventListener('input', handler);
        // Also update immediately on Enter key
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            clearTimeout(debounceTimer);
            const val = parseFloat(inputEl.value);
            if (!isNaN(val) && val > 0) {
              setFn(val);
              updateCalculations();
            }
            inputEl.blur();
          }
        });
      }

      if (entryInput) onPriceInputChange(entryInput, setEntry);
      if (stopInput) onPriceInputChange(stopInput, setStopLoss);
      if (tpInput) onPriceInputChange(tpInput, setTakeProfit);

      // Mouse wheel on focused input adjusts by tick step
      [entryInput, stopInput, tpInput].forEach(el => {
        if (!el) return;
        el.addEventListener('wheel', (e) => {
          if (document.activeElement !== el) return; // only when focused
          e.preventDefault();
          const step = getTickStep();
          const current = parseFloat(el.value) || 0;
          const newVal = e.deltaY < 0 ? current + step : current - step;
          if (newVal > 0) {
            el.value = newVal.toFixed(2);
            el.dispatchEvent(new Event('input'));
          }
        });
      });
    }

    // Update line position during drag
    function updateDraggedLine(type, newPrice) {
      if (type === 'entry') {
        setEntry(newPrice);
      } else if (type === 'stopLoss') {
        setStopLoss(newPrice);
      } else if (type === 'takeProfit') {
        setTakeProfit(newPrice);
      }
      updateCalculations();
    }
    
    // Initialize drawing canvas
    function initDrawingCanvas() {
      const container = document.getElementById('chart-container');
      drawingCanvas = document.getElementById('drawing-canvas');
      drawingCanvas.width = container.clientWidth;
      drawingCanvas.height = container.clientHeight;
      drawingCtx = drawingCanvas.getContext('2d');
    }
    
    function resizeDrawingCanvas() {
      const container = document.getElementById('chart-container');
      if (!drawingCanvas || !container) return;
      drawingCanvas.width = container.clientWidth;
      drawingCanvas.height = container.clientHeight;
      redrawUserDrawings();
    }
    
    // Continuous update loop for drawings
    let drawingUpdateId = null;
    let lastPriceAtY100 = null;
    let lastTimeAtX100 = null;
    let frameCount = 0;
    
    function startDrawingUpdateLoop() {
      if (drawingUpdateId) cancelAnimationFrame(drawingUpdateId);
      
      function update() {
        frameCount++;
        if (frameCount % 3 === 0 && candleSeries && chart) {
          try {
            const priceAtY100 = candleSeries.coordinateToPrice(100);
            const timeAtX100 = chart.timeScale().coordinateToTime(100);
            const priceStr = priceAtY100 ? priceAtY100.toFixed(2) : null;
            const timeStr = timeAtX100 || null;
            
            if (priceStr !== lastPriceAtY100 || timeStr !== lastTimeAtX100) {
              lastPriceAtY100 = priceStr;
              lastTimeAtX100 = timeStr;
              redrawUserDrawings();
            }
          } catch(e) {}
        }
        drawingUpdateId = requestAnimationFrame(update);
      }
      update();
    }
    
    // Convert chart coordinates to pixel coordinates
    function chartToPixelCoords(time, price) {
      if (!chart || !candleSeries) return null;
      const x = chart.timeScale().timeToCoordinate(time);
      const y = candleSeries.priceToCoordinate(price);
      if (x === null || y === null) return null;
      return { x, y };
    }
    
    // Draw arrow head helper
    function drawArrowHead(ctx, fromX, fromY, toX, toY, color) {
      const headLen = 10;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
    
    // Redraw user drawings on canvas
    function redrawUserDrawings() {
      if (!drawingCtx || !savedDrawings) return;
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      
      for (const [label, drawing] of Object.entries(savedDrawings)) {
        if (!drawing) continue;
        const color = drawingColors[label] || '#9ca3af';
        
        drawingCtx.save();
        drawingCtx.strokeStyle = color;
        drawingCtx.fillStyle = color + '40';
        drawingCtx.lineWidth = 2;
        
        if (drawing.type === 'point' && drawing.time && drawing.price) {
          const pixel = chartToPixelCoords(drawing.time, drawing.price);
          if (!pixel) { drawingCtx.restore(); continue; }
          
          drawingCtx.fillStyle = color;
          drawingCtx.beginPath();
          drawingCtx.arc(pixel.x, pixel.y, 10, 0, Math.PI * 2);
          drawingCtx.stroke();
          drawingCtx.beginPath();
          drawingCtx.arc(pixel.x, pixel.y, 5, 0, Math.PI * 2);
          drawingCtx.fill();
          drawingCtx.font = 'bold 12px sans-serif';
          drawingCtx.fillText(label.toUpperCase(), pixel.x - 15, pixel.y - 15);
          
        } else if (drawing.type === 'box' && drawing.time1 && drawing.price1 && drawing.time2 && drawing.price2) {
          const p1 = chartToPixelCoords(drawing.time1, drawing.price1);
          const p2 = chartToPixelCoords(drawing.time2, drawing.price2);
          if (!p1 || !p2) { drawingCtx.restore(); continue; }
          
          const x1 = Math.min(p1.x, p2.x);
          const y1 = Math.min(p1.y, p2.y);
          const width = Math.abs(p2.x - p1.x);
          const height = Math.abs(p2.y - p1.y);
          
          drawingCtx.fillRect(x1, y1, width, height);
          drawingCtx.strokeRect(x1, y1, width, height);
          drawingCtx.font = 'bold 14px sans-serif';
          drawingCtx.fillStyle = color;
          drawingCtx.fillText(label.toUpperCase(), x1 + 5, y1 + 18);
          
        } else if ((drawing.type === 'lineDown' || drawing.type === 'lineUp') && drawing.time1 && drawing.price1 && drawing.time2 && drawing.price2) {
          const p1 = chartToPixelCoords(drawing.time1, drawing.price1);
          const p2 = chartToPixelCoords(drawing.time2, drawing.price2);
          if (!p1 || !p2) { drawingCtx.restore(); continue; }
          
          drawingCtx.beginPath();
          drawingCtx.moveTo(p1.x, p1.y);
          drawingCtx.lineTo(p2.x, p2.y);
          drawingCtx.stroke();
          drawArrowHead(drawingCtx, p1.x, p1.y, p2.x, p2.y, color);
          
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          drawingCtx.font = 'bold 12px sans-serif';
          drawingCtx.fillStyle = color;
          drawingCtx.fillText(label.toUpperCase(), midX + 5, midY);
          
        } else if (drawing.type === 'hline' && drawing.price) {
          const y = candleSeries.priceToCoordinate(drawing.price);
          if (y === null) { drawingCtx.restore(); continue; }
          
          drawingCtx.beginPath();
          drawingCtx.moveTo(0, y);
          drawingCtx.lineTo(drawingCanvas.width, y);
          drawingCtx.stroke();
          drawingCtx.font = 'bold 12px sans-serif';
          drawingCtx.fillStyle = color;
          drawingCtx.fillText(label.toUpperCase(), 10, y - 5);
        }
        
        drawingCtx.restore();
      }
    }

    // ========== INTERACTIVE DRAWING TOOLS ==========
    
    let userDrawings = [];
    let activeDrawingTool = null; // 'fib' | 'trendline' | 'hline' | 'rect' | null
    let drawingState = {}; // temp state during placement
    let editingFibIndex = -1; // which fib drawing is being edited
    
    // Default Fibonacci levels (loaded from localStorage if customized)
    const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
    
    function getCustomFibLevels() {
      try {
        const stored = localStorage.getItem('copilot-fib-levels');
        if (stored) return JSON.parse(stored);
      } catch(e) {}
      return [...DEFAULT_FIB_LEVELS];
    }
    
    // Drawing tool colors
    const toolColors = {
      fib: '#d97706',
      trendline: '#06b6d4',
      hline: '#d1d5db',
      rect: '#3b82f6'
    };
    
    function setDrawingTool(tool) {
      // Toggle off if same tool clicked again
      if (activeDrawingTool === tool) {
        cancelDrawing();
        return;
      }
      
      // Cancel any in-progress drawing
      cancelDrawing();
      
      // Clear marker mode (entry/stop/target)
      if (markerMode) setMarkerMode(null);
      
      activeDrawingTool = tool;
      drawingState = { placing: false, clickCount: 0 };
      
      // Update button styles
      document.querySelectorAll('.drawing-tool-btn').forEach(btn => btn.classList.remove('active'));
      const btn = document.getElementById('tool-' + tool);
      if (btn) btn.classList.add('active');
      
      // Change cursor
      document.getElementById('chart-container').classList.add('drawing-active');
      
      const clicks = tool === 'hline' ? '1 click' : '2 clicks';
      document.getElementById('drawing-status').textContent = `${clicks} Â· Esc cancel`;
    }
    
    function cancelDrawing() {
      activeDrawingTool = null;
      drawingState = {};
      
      document.querySelectorAll('.drawing-tool-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('chart-container').classList.remove('drawing-active');
      document.getElementById('drawing-status').textContent = '';
      
      // Clear preview
      renderAllDrawings();
    }
    
    function clearUserDrawings() {
      userDrawings = [];
      renderAllDrawings();
    }
    
    function handleDrawingClick(price, time, point) {
      if (!activeDrawingTool) return;
      
      const tool = activeDrawingTool;
      
      // H-Line: single click
      if (tool === 'hline') {
        userDrawings.push({
          type: 'hline',
          price: price,
          color: toolColors.hline
        });
        cancelDrawing();
        renderAllDrawings();
        return;
      }
      
      // Two-click tools: fib, trendline, rect
      if (!drawingState.placing) {
        // First click
        drawingState.placing = true;
        drawingState.clickCount = 1;
        drawingState.price1 = price;
        drawingState.time1 = time;
        drawingState.point1 = point;
        
        const toolNames = { fib: 'Fibonacci', trendline: 'Trendline', rect: 'Rectangle' };
        document.getElementById('drawing-status').textContent = `${toolNames[tool]}: click second point. Esc to cancel.`;
      } else {
        // Second click â€” complete the drawing
        const drawing = {
          type: tool,
          price1: drawingState.price1,
          time1: drawingState.time1,
          price2: price,
          time2: time,
          color: toolColors[tool]
        };
        
        if (tool === 'fib') {
          drawing.levels = getCustomFibLevels();
        }
        
        userDrawings.push(drawing);
        cancelDrawing();
        renderAllDrawings();
      }
    }
    
    // Live preview while placing second point
    function renderDrawingPreview() {
      if (!activeDrawingTool || !drawingState.placing || !drawingState.previewPrice) return;
      
      // Redraw all existing drawings first
      renderAllDrawings();
      
      // Then draw the preview on top
      if (!drawingCtx) return;
      
      const tool = activeDrawingTool;
      const p1 = chartToPixelCoords(drawingState.time1, drawingState.price1);
      const p2 = drawingState.previewPoint;
      if (!p1 || !p2) return;
      
      drawingCtx.save();
      drawingCtx.globalAlpha = 0.5;
      drawingCtx.setLineDash([5, 5]);
      
      if (tool === 'trendline') {
        drawingCtx.strokeStyle = toolColors.trendline;
        drawingCtx.lineWidth = 2;
        drawingCtx.beginPath();
        drawingCtx.moveTo(p1.x, p1.y);
        drawingCtx.lineTo(p2.x, p2.y);
        drawingCtx.stroke();
      } else if (tool === 'rect') {
        drawingCtx.strokeStyle = toolColors.rect;
        drawingCtx.fillStyle = toolColors.rect + '20';
        drawingCtx.lineWidth = 1;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);
        drawingCtx.fillRect(x, y, w, h);
        drawingCtx.strokeRect(x, y, w, h);
      } else if (tool === 'fib') {
        renderFibPreview(drawingState.price1, drawingState.previewPrice, p1, p2);
      }
      
      drawingCtx.restore();
    }
    
    function renderFibPreview(price1, price2, p1, p2) {
      const levels = getCustomFibLevels();
      const range = price2 - price1;
      
      drawingCtx.globalAlpha = 0.4;
      drawingCtx.setLineDash([3, 3]);
      
      for (const level of levels) {
        const price = price1 + range * level;
        const y = candleSeries.priceToCoordinate(price);
        if (y === null) continue;
        
        drawingCtx.strokeStyle = toolColors.fib;
        drawingCtx.lineWidth = 1;
        drawingCtx.beginPath();
        drawingCtx.moveTo(0, y);
        drawingCtx.lineTo(drawingCanvas.width, y);
        drawingCtx.stroke();
        
        drawingCtx.font = '10px sans-serif';
        drawingCtx.fillStyle = toolColors.fib;
        drawingCtx.fillText(`${(level * 100).toFixed(1)}% - $${price.toFixed(2)}`, 5, y - 3);
      }
    }
    
    // Render all user drawings (called on chart pan/zoom and after changes)
    function renderAllDrawings() {
      if (!drawingCtx) return;
      
      // First render scanner-generated drawings
      redrawUserDrawings();
      
      // Then render interactive user drawings on top
      for (let i = 0; i < userDrawings.length; i++) {
        const d = userDrawings[i];
        drawingCtx.save();
        
        if (d.type === 'hline') {
          renderHLine(d);
        } else if (d.type === 'trendline') {
          renderTrendline(d);
        } else if (d.type === 'rect') {
          renderRect(d);
        } else if (d.type === 'fib') {
          renderFib(d, i);
        }
        
        drawingCtx.restore();
      }
    }
    
    function renderHLine(d) {
      const y = candleSeries.priceToCoordinate(d.price);
      if (y === null) return;
      
      drawingCtx.strokeStyle = d.color || toolColors.hline;
      drawingCtx.lineWidth = 1;
      drawingCtx.setLineDash([8, 4]);
      drawingCtx.beginPath();
      drawingCtx.moveTo(0, y);
      drawingCtx.lineTo(drawingCanvas.width, y);
      drawingCtx.stroke();
      
      // Price label on right edge
      drawingCtx.setLineDash([]);
      drawingCtx.font = 'bold 11px sans-serif';
      drawingCtx.fillStyle = d.color || toolColors.hline;
      const label = `$${d.price.toFixed(2)}`;
      const textWidth = drawingCtx.measureText(label).width;
      drawingCtx.fillRect(drawingCanvas.width - textWidth - 10, y - 8, textWidth + 8, 16);
      drawingCtx.fillStyle = '#111827';
      drawingCtx.fillText(label, drawingCanvas.width - textWidth - 6, y + 4);
    }
    
    function renderTrendline(d) {
      const p1 = chartToPixelCoords(d.time1, d.price1);
      const p2 = chartToPixelCoords(d.time2, d.price2);
      if (!p1 || !p2) return;
      
      drawingCtx.strokeStyle = d.color || toolColors.trendline;
      drawingCtx.lineWidth = 2;
      drawingCtx.beginPath();
      
      // Extend line slightly beyond endpoints
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const ext = 0.15; // 15% extension
      drawingCtx.moveTo(p1.x - dx * ext, p1.y - dy * ext);
      drawingCtx.lineTo(p2.x + dx * ext, p2.y + dy * ext);
      drawingCtx.stroke();
      
      // Anchor dots
      drawingCtx.fillStyle = d.color || toolColors.trendline;
      drawingCtx.beginPath();
      drawingCtx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
      drawingCtx.fill();
      drawingCtx.beginPath();
      drawingCtx.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
      drawingCtx.fill();
    }
    
    function renderRect(d) {
      const p1 = chartToPixelCoords(d.time1, d.price1);
      const p2 = chartToPixelCoords(d.time2, d.price2);
      if (!p1 || !p2) return;
      
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      
      drawingCtx.fillStyle = (d.color || toolColors.rect) + '20';
      drawingCtx.fillRect(x, y, w, h);
      
      drawingCtx.strokeStyle = d.color || toolColors.rect;
      drawingCtx.lineWidth = 1.5;
      drawingCtx.strokeRect(x, y, w, h);
    }
    
    function renderFib(d, index) {
      const levels = d.levels || DEFAULT_FIB_LEVELS;
      const range = d.price2 - d.price1;
      
      // Fib level colors (gradient from green to red)
      const fibLevelColors = {
        0: '#22c55e',
        0.236: '#3b82f6',
        0.382: '#8b5cf6',
        0.5: '#f59e0b',
        0.618: '#f97316',
        0.786: '#ef4444',
        1.0: '#dc2626'
      };
      
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        const price = d.price1 + range * level;
        const y = candleSeries.priceToCoordinate(price);
        if (y === null) continue;
        
        const color = fibLevelColors[level] || toolColors.fib;
        
        // Shaded zone to next level
        if (i < levels.length - 1) {
          const nextPrice = d.price1 + range * levels[i + 1];
          const nextY = candleSeries.priceToCoordinate(nextPrice);
          if (nextY !== null) {
            drawingCtx.fillStyle = color + '10';
            drawingCtx.fillRect(0, Math.min(y, nextY), drawingCanvas.width, Math.abs(nextY - y));
          }
        }
        
        // Horizontal line
        drawingCtx.strokeStyle = color;
        drawingCtx.lineWidth = level === 0.5 || level === 0.618 ? 2 : 1;
        drawingCtx.setLineDash(level === 0 || level === 1 ? [] : [6, 3]);
        drawingCtx.beginPath();
        drawingCtx.moveTo(0, y);
        drawingCtx.lineTo(drawingCanvas.width, y);
        drawingCtx.stroke();
        drawingCtx.setLineDash([]);
        
        // Label
        drawingCtx.font = 'bold 11px sans-serif';
        drawingCtx.fillStyle = color;
        drawingCtx.fillText(`${(level * 100).toFixed(1)}%  $${price.toFixed(2)}`, 5, y - 4);
      }
      
      // Small "edit" indicator at top-right of fib area
      const topPrice = d.price1 + range * Math.max(...levels);
      const topY = candleSeries.priceToCoordinate(topPrice);
      if (topY !== null) {
        drawingCtx.font = '10px sans-serif';
        drawingCtx.fillStyle = '#9ca3af';
        drawingCtx.fillText('[dbl-click to edit levels]', drawingCanvas.width - 160, topY + 14);
      }
    }
    
    // Hook into the existing drawing update loop to also render user drawings
    const originalRedrawUserDrawings = redrawUserDrawings;
    redrawUserDrawings = function() {
      originalRedrawUserDrawings();
      // Re-render interactive drawings on each frame update
      for (let i = 0; i < userDrawings.length; i++) {
        const d = userDrawings[i];
        drawingCtx.save();
        if (d.type === 'hline') renderHLine(d);
        else if (d.type === 'trendline') renderTrendline(d);
        else if (d.type === 'rect') renderRect(d);
        else if (d.type === 'fib') renderFib(d, i);
        drawingCtx.restore();
      }
    };
    
    // ========== FIB LEVEL EDITOR ==========
    
    // Double-click on chart to edit fib levels
    document.addEventListener('dblclick', (e) => {
      // Check if click is inside chart container
      const container = document.getElementById('chart-container');
      if (!container || !container.contains(e.target)) return;
      if (userDrawings.length === 0) return;
      
      // Find if we double-clicked near a fib drawing
      const clickY = e.clientY - container.getBoundingClientRect().top;
      
      for (let i = userDrawings.length - 1; i >= 0; i--) {
        if (userDrawings[i].type !== 'fib') continue;
        const d = userDrawings[i];
        const levels = d.levels || DEFAULT_FIB_LEVELS;
        const range = d.price2 - d.price1;
        
        // Check if click is within the fib range
        const topY = candleSeries.priceToCoordinate(d.price1 + range * Math.max(...levels));
        const botY = candleSeries.priceToCoordinate(d.price1 + range * Math.min(...levels));
        if (topY !== null && botY !== null) {
          const minY = Math.min(topY, botY);
          const maxY = Math.max(topY, botY);
          if (clickY >= minY - 10 && clickY <= maxY + 10) {
            openFibEditor(i);
            return;
          }
        }
      }
    });
    
    function openFibEditor(index) {
      editingFibIndex = index;
      const d = userDrawings[index];
      const levels = d.levels || [...DEFAULT_FIB_LEVELS];
      
      const list = document.getElementById('fib-levels-list');
      list.innerHTML = '';
      
      for (const level of levels) {
        addFibLevelRow(list, level);
      }
      
      document.getElementById('fib-editor').classList.remove('hidden');
    }
    
    function addFibLevelRow(list, value) {
      const row = document.createElement('div');
      row.className = 'fib-level-row';
      row.innerHTML = `
        <input type="number" step="0.001" value="${value}" min="0" max="5" class="fib-level-input">
        <span class="text-xs text-gray-400">(${(value * 100).toFixed(1)}%)</span>
        <button onclick="this.parentElement.remove()" title="Remove">x</button>
      `;
      list.appendChild(row);
    }
    
    function addFibLevel() {
      const input = document.getElementById('fib-new-level');
      const val = parseFloat(input.value);
      if (isNaN(val)) return;
      
      const list = document.getElementById('fib-levels-list');
      addFibLevelRow(list, val);
      input.value = '';
    }
    
    function resetFibLevels() {
      const list = document.getElementById('fib-levels-list');
      list.innerHTML = '';
      for (const level of DEFAULT_FIB_LEVELS) {
        addFibLevelRow(list, level);
      }
    }
    
    function saveFibLevels() {
      const inputs = document.querySelectorAll('#fib-levels-list .fib-level-input');
      const levels = [];
      inputs.forEach(input => {
        const val = parseFloat(input.value);
        if (!isNaN(val)) levels.push(val);
      });
      
      levels.sort((a, b) => a - b);
      
      // Save to localStorage for future fibs
      localStorage.setItem('copilot-fib-levels', JSON.stringify(levels));
      
      // Apply to the drawing being edited
      if (editingFibIndex >= 0 && editingFibIndex < userDrawings.length) {
        userDrawings[editingFibIndex].levels = levels;
      }
      
      document.getElementById('fib-editor').classList.add('hidden');
      editingFibIndex = -1;
      renderAllDrawings();
    }
    
    // Close fib editor on backdrop click
    document.getElementById('fib-editor')?.addEventListener('click', (e) => {
      if (e.target.id === 'fib-editor') {
        document.getElementById('fib-editor').classList.add('hidden');
        editingFibIndex = -1;
      }
    });

    // Render pattern markers from scan detection
    function renderPatternMarkers(candidate) {
      if (!candidate.pattern_markers || !candidate.chart_data) return;
      
      const pm = candidate.pattern_markers;
      const chartData = candidate.chart_data;
      const markers = [];
      
      // 1. Prior Peak (red)
      if (pm.chart_prior_peak >= 0 && pm.chart_prior_peak < chartData.length) {
        markers.push({
          time: chartData[pm.chart_prior_peak].time,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: '1.PEAK'
        });
      }
      
      // 2. Markdown Low (orange)
      if (pm.chart_markdown_low >= 0 && pm.chart_markdown_low < chartData.length) {
        markers.push({
          time: chartData[pm.chart_markdown_low].time,
          position: 'belowBar',
          color: '#f97316',
          shape: 'arrowUp',
          text: '2.LOW'
        });
      }
      
      // 3. Base Start (green)
      if (pm.chart_base_start >= 0 && pm.chart_base_start < chartData.length) {
        markers.push({
          time: chartData[pm.chart_base_start].time,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: '3.BASE'
        });
      }
      
      // 4. Markup/Breakout (blue)
      const markupIdx = pm.chart_markup_high ?? pm.chart_first_markup;
      if (markupIdx >= 0 && markupIdx < chartData.length) {
        markers.push({
          time: chartData[markupIdx].time,
          position: 'aboveBar',
          color: '#3b82f6',
          shape: 'arrowDown',
          text: '4.MARKUP'
        });
      }
      
      // 5. Pullback Low (yellow)
      if (pm.chart_pullback_low >= 0 && pm.chart_pullback_low < chartData.length) {
        markers.push({
          time: chartData[pm.chart_pullback_low].time,
          position: 'belowBar',
          color: '#eab308',
          shape: 'arrowUp',
          text: '5.RETEST'
        });
      }
      
      // 6. Second Breakout (purple)
      if (pm.chart_second_breakout >= 0 && pm.chart_second_breakout < chartData.length) {
        markers.push({
          time: chartData[pm.chart_second_breakout].time,
          position: 'aboveBar',
          color: '#a855f7',
          shape: 'arrowDown',
          text: '6.ENTRY!'
        });
      }
      
      // Sort by time and set markers
      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      if (markers.length > 0) {
        try {
          if (copilotMarkersPrimitive) { copilotMarkersPrimitive.setMarkers(markers); }
          else { copilotMarkersPrimitive = LightweightCharts.createSeriesMarkers(candleSeries, markers); }
        } catch(e) { console.warn('setMarkers error:', e.message); }
      }
      
      // Add base box as price lines
      if (pm.base_high && pm.base_low) {
        const baseTopLine = candleSeries.createPriceLine({
          price: pm.base_high,
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: false,
        });
        const baseBottomLine = candleSeries.createPriceLine({
          price: pm.base_low,
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'BASE',
        });
        drawingLines.push(baseTopLine, baseBottomLine);
      }
      
      return markers.length;
    }

    function clearAutomaticChartDecorations() {
      drawingLines.forEach(line => {
        try { candleSeries.removePriceLine(line); } catch(e) {}
      });
      drawingLines = [];

      if (copilotMarkersPrimitive) {
        try { copilotMarkersPrimitive.setMarkers([]); } catch(e) {}
      }
    }
    
    // Render saved drawings/annotations from Pattern Detector (user-drawn)
    // Now uses canvas-based drawing via redrawUserDrawings()
    function renderSavedDrawings() {
      // Clear any existing price lines
      drawingLines.forEach(line => {
        try { candleSeries.removePriceLine(line); } catch(e) {}
      });
      drawingLines = [];
      
      // Use canvas drawing for boxes and lines
      redrawUserDrawings();
    }

    // Clear levels
    function clearLevels() {
      entryPrice = null;
      stopLossPrice = null;
      takeProfitPrice = null;
      isDragging = false;
      dragLineType = null;
      verdictRequested = false;
      window.lastVerdict = null;
      
      const entryInput = document.getElementById('entry-price-input');
      const stopInput = document.getElementById('stop-loss-price-input');
      const tpInput = document.getElementById('take-profit-price-input');
      if (entryInput) entryInput.value = '';
      if (stopInput) stopInput.value = '';
      if (tpInput) tpInput.value = '';
      document.getElementById('risk-reward').textContent = '--';
      
      if (entryLine) {
        candleSeries.removePriceLine(entryLine);
        entryLine = null;
      }
      if (stopLossLine) {
        candleSeries.removePriceLine(stopLossLine);
        stopLossLine = null;
      }
      if (takeProfitLine) {
        candleSeries.removePriceLine(takeProfitLine);
        takeProfitLine = null;
      }
      
      document.getElementById('position-sizing').classList.add('hidden');
      document.getElementById('ai-verdict').classList.add('hidden');
      document.getElementById('save-trade-panel').classList.add('hidden');
      hideLivePnL();
      livePnLSizing = null;
      manualSizeOverride = null;
      if (typeof setTradeDirection === 'function') setTradeDirection(0);
      if (typeof window.syncRiskPlanFromDeskLevels === 'function') window.syncRiskPlanFromDeskLevels({ clearMissing: true });
      if (typeof syncKeyLevelsPanel === 'function') syncKeyLevelsPanel();
    }

    // Clear everything â€” full reset to default state
    function clearChart() {
      if (typeof window.cancelPendingCopilotAnalysis === 'function') window.cancelPendingCopilotAnalysis();
      if (typeof window.clearCopilotAnalysisState === 'function') window.clearCopilotAnalysisState();
      if (typeof window.resetCopilotAnalysisPanel === 'function') window.resetCopilotAnalysisPanel();
      if (typeof window.resetCopilotChat === 'function') window.resetCopilotChat();
      // Clear entry/stop/target levels
      clearLevels();
      
      // Clear user drawings (fib, trendline, hline, rect)
      clearUserDrawings();
      
      // Cancel any active drawing tool
      cancelDrawing();
      
      // Clear marker mode (entry/stop/target button highlight)
      if (markerMode) setMarkerMode(null);
      
      // Clear analysis overlay lines (fib levels, range lines, base lines)
      drawingLines.forEach(function(line) {
        try { candleSeries.removePriceLine(line); } catch(e) {}
      });
      drawingLines = [];
      
      // Clear the chart data
      if (candleSeries) {
        candleSeries.setData([]);
      }
      
      // Reset header
      document.getElementById('chart-symbol').textContent = 'Enter a symbol';
      document.getElementById('chart-pattern').textContent = '';
      
      // Reset symbol input
      document.getElementById('copilot-symbol').value = '';
      
      // Reset breadcrumb
      if (typeof updateBreadcrumb === 'function') updateBreadcrumb();
      
      // Reset Key Levels panel
      ['kl-entry','kl-stop','kl-t1','kl-t2','kl-rr'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.textContent = '--';
      });
      
      // Reset Verdict panel
      ['verdict-display-label','verdict-display-confidence'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.textContent = '--'; el.style.color = ''; }
      });
      ['verdict-display-for','verdict-display-against'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '<div style="opacity:0.4;">--</div>';
      });
      
      // Reset Phase Progress
      ['phase-peak','phase-dist','phase-base','phase-markup','phase-pull','phase-break'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.textContent = '--';
      });
      
      // Reset current candidate
      currentCandidate = null;
    }

    // Update calculations when levels change
    let verdictRequested = false;
    
    function updateCalculations() {
      const settings = getSettings();
      const isOptions = settings.instrumentType === 'options';
      
      // For options: stop loss is always 0 (max loss = premium), so only need entry + TP
      if (isOptions) {
        if (!entryPrice || !takeProfitPrice) return;
        
        // R:R for options: potential profit / premium risked
        const optResult = calcOptionsPremiumPnL(settings, manualSizeOverride || parseInt(document.getElementById('manual-position-size').value) || 1);
        if (optResult && settings.optionStrike > 0) {
          const intrinsic = settings.optionType === 'call'
            ? Math.max(0, takeProfitPrice - settings.optionStrike)
            : Math.max(0, settings.optionStrike - takeProfitPrice);
          const potentialReturn = ((intrinsic - settings.optionPrice) / settings.optionPrice * 100).toFixed(0);
          document.getElementById('risk-reward').textContent = `${potentialReturn}% return`;
          document.getElementById('risk-reward').classList.toggle('text-green-400', parseInt(potentialReturn) >= 100);
          document.getElementById('risk-reward').classList.toggle('text-yellow-400', parseInt(potentialReturn) >= 0 && parseInt(potentialReturn) < 100);
          document.getElementById('risk-reward').classList.toggle('text-red-400', parseInt(potentialReturn) < 0);
        } else {
          document.getElementById('risk-reward').textContent = '--';
        }
        
        // Auto-request verdict when entry + TP set
        if (!verdictRequested && entryPrice && takeProfitPrice) {
          verdictRequested = true;
          requestTradeVerdict();
        }
        return;
      }
      
      // Normal mode: need all three levels
      if (!entryPrice || !stopLossPrice || !takeProfitPrice) return;

      const risk = Math.abs(entryPrice - stopLossPrice);
      const reward = Math.abs(takeProfitPrice - entryPrice);
      const rr = (reward / risk).toFixed(2);
      
      document.getElementById('risk-reward').textContent = `1:${rr}`;
      document.getElementById('risk-reward').classList.toggle('text-green-400', parseFloat(rr) >= 2);
      document.getElementById('risk-reward').classList.toggle('text-yellow-400', parseFloat(rr) >= 1 && parseFloat(rr) < 2);
      document.getElementById('risk-reward').classList.toggle('text-red-400', parseFloat(rr) < 1);
      
      // Auto-request verdict when all three levels are set for the first time
      if (!verdictRequested && entryPrice && stopLossPrice && takeProfitPrice) {
        verdictRequested = true;
        requestTradeVerdict();
      }
    }
