    // ========== CO-PILOT ANALYSIS ==========
    
    function cancelPendingCopilotAnalysis() {
      if (activeCopilotAnalysisController) {
        try { activeCopilotAnalysisController.abort(); } catch (_) {}
        activeCopilotAnalysisController = null;
      }
    }

    window.cancelPendingCopilotAnalysis = cancelPendingCopilotAnalysis;

    function clearCopilotAnalysisState() {
      lastCopilotResult = null;
      window.lastVerdict = null;
    }

    window.clearCopilotAnalysisState = clearCopilotAnalysisState;

    function resetCopilotAnalysisPanel(options = {}) {
      const keepVisible = options.keepVisible === true;
      const symbol = String(options.symbol || '').trim().toUpperCase();
      const timeframe = String(options.timeframe || '').trim();
      const loading = options.loading === true;

      const panel = document.getElementById('copilot-analysis');
      if (panel) panel.classList.toggle('hidden', !keepVisible);

      const verdictHeader = document.getElementById('copilot-verdict-header');
      if (verdictHeader) verdictHeader.className = '';

      const symbolLabel = symbol ? `${symbol}${timeframe ? ` (${timeframe})` : ''}` : '--';
      const verdictSymbolEl = document.getElementById('copilot-verdict-symbol');
      if (verdictSymbolEl) verdictSymbolEl.textContent = symbolLabel;

      const verdictLabelEl = document.getElementById('copilot-verdict-label');
      if (verdictLabelEl) verdictLabelEl.textContent = loading ? 'Analyzing...' : '--';

      const verdictSubtitleEl = document.getElementById('copilot-verdict-subtitle');
      if (verdictSubtitleEl) verdictSubtitleEl.textContent = loading ? 'Fetching a fresh AI analysis for this chart.' : '';

      ['cp-price','cp-retracement','cp-nearest-fib','cp-stop-dist','cp-primary-trend','cp-intermediate-trend','cp-alignment',
        'cp-energy-state','cp-energy-direction','cp-velocity','cp-acceleration','cp-pressure-value']
        .forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.textContent = '--';
        });

      const pressureLabelEl = document.getElementById('cp-pressure-label');
      if (pressureLabelEl) pressureLabelEl.textContent = 'Pressure';

      const pressureTrendEl = document.getElementById('cp-pressure-trend');
      if (pressureTrendEl) pressureTrendEl.textContent = '--';

      const pressureBarsEl = document.getElementById('cp-pressure-bars');
      if (pressureBarsEl) pressureBarsEl.innerHTML = '';

      const fibTableEl = document.getElementById('cp-fib-table');
      if (fibTableEl) fibTableEl.innerHTML = '';

      const goReasonsEl = document.getElementById('cp-go-reasons');
      if (goReasonsEl) goReasonsEl.innerHTML = '<div class="text-gray-500 text-xs">--</div>';

      const nogoReasonsEl = document.getElementById('cp-nogo-reasons');
      if (nogoReasonsEl) nogoReasonsEl.innerHTML = '<div class="text-gray-500 text-xs">--</div>';

      const watchSectionEl = document.getElementById('cp-watch-section');
      if (watchSectionEl) watchSectionEl.classList.add('hidden');

      const watchItemsEl = document.getElementById('cp-watch-items');
      if (watchItemsEl) watchItemsEl.innerHTML = '';

      const commentaryEl = document.getElementById('cp-commentary');
      if (commentaryEl) commentaryEl.textContent = '';
    }

    window.resetCopilotAnalysisPanel = resetCopilotAnalysisPanel;

    async function runCopilotAnalysis() {
      const symbolInput = document.getElementById('copilot-symbol');
      const symbol = (typeof window.normalizeTradingDeskSymbol === 'function'
        ? window.normalizeTradingDeskSymbol(symbolInput.value)
        : symbolInput.value.trim().toUpperCase());
      if (!symbol) {
        symbolInput.focus();
        return;
      }
      symbolInput.value = symbol;
      
      // Auto-detect instrument type and populate settings before analysis
      autoPopulateInstrumentSettings(symbol);
      
      const interval = document.getElementById('copilot-interval').value;
      const statusEl = document.getElementById('copilot-status');
      const requestSeq = activeCopilotAnalysisRequestSeq + 1;
      activeCopilotAnalysisRequestSeq = requestSeq;

      cancelPendingCopilotAnalysis();
      const controller = new AbortController();
      activeCopilotAnalysisController = controller;
      clearCopilotAnalysisState();
      resetCopilotAnalysisPanel({ keepVisible: true, symbol, timeframe: interval, loading: true });
      resetCopilotChat({ symbol, timeframe: interval, mode: 'loading' });
      
      statusEl.textContent = `Analyzing ${symbol}...`;
      statusEl.className = 'text-yellow-400 text-sm animate-pulse';
      
      try {
        const response = await fetch('/api/candidates/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            symbol: symbol,
            interval: interval,
            scanMode: 'copilot',
            swingEpsilon: (() => {
              // Slider 1-15 maps to epsilon_pct: 1=0.15 (fewer swings), 5=0.05 (default), 15=0.005 (more swings)
              const slider = parseInt(document.getElementById('swing-sensitivity').value) || 5;
              // Exponential mapping: higher slider = lower epsilon = more detail
              return parseFloat((0.20 * Math.pow(0.75, slider - 1)).toFixed(4));
            })()
          })
        });
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        if (requestSeq !== activeCopilotAnalysisRequestSeq) return;
        const results = data.data || data.results || data;
        
        let analysis = null;
        if (Array.isArray(results) && results.length > 0) {
          analysis = results[0];
        } else if (results && results.verdict) {
          analysis = results;
        }
        
        if (!analysis) {
          addChatMessage(`No analysis data returned for ${symbol}. You can still enter a trade manually.`, 'ai');
          showSavePanel();
          statusEl.textContent = 'No analysis data';
          statusEl.className = 'text-yellow-400 text-sm';
          return;
        }
        
        lastCopilotResult = analysis;
        mergeCopilotAnalysisIntoCurrentCandidate(analysis);
        if (analysis.trade_direction === 'SHORT' || analysis.trade_direction === 'LONG') {
          applyTradeDirectionWithoutAnalysis(analysis.trade_direction);
        }
        
        // Display chart
        displayCopilotChart(analysis);
        
        // Display analysis panel
        if (analysis.verdict) {
          displayCopilotAnalysis(analysis);
        }
        
        // Show save panel after analysis
        showSavePanel();
        
        // For options mode: save the underlying chart price before overriding with premium
        const settings = getSettings();
        if (settings.instrumentType === 'options') {
          window._optionUnderlyingEntry = entryPrice;
          window._optionUnderlyingStop = stopLossPrice;
          applyOptionsMode(true);
          if (settings.optionPrice > 0) {
            entryPrice = settings.optionPrice;
            stopLossPrice = 0;
            updateLivePnL();
          }
        }
        
        // Add to chat
        addChatMessage(analysis.commentary || 'Analysis complete.', 'ai');
        maybeApplyQueuedTradePlanBootstrap(symbol);
        syncTradePlanStoreFromDesk('analysis_loaded');
        
        statusEl.textContent = 'Analysis complete';
        statusEl.className = 'text-green-400 text-sm';
        
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.error('Copilot analysis error:', error);
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.className = 'text-red-400 text-sm';
        addChatMessage(`Failed to analyze ${symbol}: ${error.message}`, 'ai');
        showSavePanel();
      } finally {
        if (activeCopilotAnalysisController === controller) {
          activeCopilotAnalysisController = null;
        }
      }
    }

    function sanitizeChartData(data) {
      if (!data || !Array.isArray(data)) return [];
      
      // Detect intraday: multiple bars sharing the same YYYY-MM-DD date
      let isIntraday = false;
      const dateCounts = {};
      for (const bar of data) {
        if (!bar || bar.time == null) continue;
        const ts = String(bar.time);
        if (ts.length >= 10 && /^\d{4}-/.test(ts)) {
          const dateKey = ts.substring(0, 10);
          dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
          if (dateCounts[dateKey] > 1) { isIntraday = true; break; }
        }
      }
      
      const seen = new Set();
      return data.filter(bar => {
        if (!bar || bar.time == null || bar.time === '') return false;
        const o = bar.open, h = bar.high, l = bar.low, c = bar.close;
        if (o == null || h == null || l == null || c == null || Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(c)) return false;
        
        // Normalize time format for Lightweight Charts
        let time = bar.time;
        if (typeof time === 'string') {
          if (isIntraday && time.length > 10) {
            // Intraday: convert "YYYY-MM-DD HH:MM:SS" to Unix timestamp
            const dt = new Date(time.replace(' ', 'T'));
            time = isNaN(dt.getTime()) ? time.substring(0, 10) : Math.floor(dt.getTime() / 1000);
          } else {
            // Daily/weekly: ensure "YYYY-MM-DD" only
            time = time.substring(0, 10);
          }
          bar.time = time;
        }
        
        if (seen.has(time)) return false;
        seen.add(time);
        return true;
      });
    }

    function formatFibMoney(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '--';
      return '$' + amount.toFixed(2);
    }

    function formatFibDate(dateValue) {
      if (!dateValue) return '--';
      const parsed = new Date(`${dateValue}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return dateValue;
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(parsed);
    }

    function syncFibAnchorPanel(analysis) {
      const legRangeEl = document.getElementById('fib-leg-range');
      const legNoteEl = document.getElementById('fib-leg-note');
      const nearestSummaryEl = document.getElementById('fib-nearest-summary');
      const nearestNoteEl = document.getElementById('fib-nearest-note');
      const currentSummaryEl = document.getElementById('fib-current-summary');
      const currentNoteEl = document.getElementById('fib-current-note');

      if (!legRangeEl || !legNoteEl || !nearestSummaryEl || !nearestNoteEl || !currentSummaryEl || !currentNoteEl) {
        return;
      }

      const range = analysis?.range;
      const nearest = analysis?.nearest_level;
      const retracement = Number(analysis?.current_retracement_pct);

      if (!range || !Number.isFinite(Number(range.low)) || !Number.isFinite(Number(range.high))) {
        legRangeEl.textContent = '--';
        legNoteEl.textContent = '--';
        nearestSummaryEl.textContent = '--';
        nearestNoteEl.textContent = '--';
        currentSummaryEl.textContent = '--';
        currentNoteEl.textContent = '--';
        return;
      }

      const lowPrice = Number(range.low);
      const highPrice = Number(range.high);
      const rangeDirection = range.direction || (analysis?.trade_direction === 'SHORT' ? 'bearish' : 'bullish');
      const retracementFromEntrySide = Number.isFinite(retracement)
        ? retracement
        : null;

      if (rangeDirection === 'bearish') {
        legRangeEl.textContent = `${formatFibMoney(highPrice)} high -> ${formatFibMoney(lowPrice)} low`;
        legNoteEl.textContent = `Anchored from ${formatFibDate(range.high_date)} to ${formatFibDate(range.low_date)}.`;
      } else {
        legRangeEl.textContent = `${formatFibMoney(lowPrice)} low -> ${formatFibMoney(highPrice)} high`;
        legNoteEl.textContent = `Anchored from ${formatFibDate(range.low_date)} to ${formatFibDate(range.high_date)}.`;
      }

      if (nearest && nearest.level && Number.isFinite(Number(nearest.price))) {
        nearestSummaryEl.textContent = `${nearest.level} retracement at ${formatFibMoney(nearest.price)}`;
        nearestNoteEl.textContent = rangeDirection === 'bearish'
          ? `${nearest.level} means ${nearest.level} back up from the ${formatFibMoney(lowPrice)} low anchor toward the ${formatFibMoney(highPrice)} high anchor${Number.isFinite(Number(nearest.distance_pct)) ? ` (${Number(nearest.distance_pct).toFixed(1)}% from current price)` : ''}.`
          : `${nearest.level} means ${nearest.level} back down from the ${formatFibMoney(highPrice)} high anchor toward the ${formatFibMoney(lowPrice)} low anchor${Number.isFinite(Number(nearest.distance_pct)) ? ` (${Number(nearest.distance_pct).toFixed(1)}% from current price)` : ''}.`;
      } else {
        nearestSummaryEl.textContent = 'No nearby fib';
        nearestNoteEl.textContent = 'No retracement level is currently close to price.';
      }

      if (retracementFromEntrySide != null) {
        currentSummaryEl.textContent = `${retracementFromEntrySide.toFixed(1)}% retraced`;
        currentNoteEl.textContent = rangeDirection === 'bearish'
          ? `Current price is ${retracementFromEntrySide.toFixed(1)}% back up from the ${formatFibMoney(lowPrice)} low anchor of the same leg.`
          : `Current price is ${retracementFromEntrySide.toFixed(1)}% back down from the ${formatFibMoney(highPrice)} high anchor of the same leg.`;
      } else {
        currentSummaryEl.textContent = '--';
        currentNoteEl.textContent = 'Current leg position unavailable.';
      }
    }

    function displayCopilotChart(analysis) {
      if (!analysis.chart_data || analysis.chart_data.length === 0) return;
      const chartData = sanitizeChartData(analysis.chart_data);
      if (chartData.length === 0) return;
      
      // Update time scale for intraday intervals (show HH:MM on x-axis)
      const currentInterval = document.getElementById('copilot-interval').value;
      const isIntraday = ['4h', '1h', '15m', '5m', '1m'].includes(currentInterval);
      chart.applyOptions({
        timeScale: {
          timeVisible: isIntraday,
          secondsVisible: currentInterval === '1m',
        }
      });
      
      // Clear user drawings when switching symbols/timeframes
      userDrawings = [];
      
      // Update header
      document.getElementById('chart-symbol').textContent = analysis.symbol;
      document.getElementById('chart-pattern').textContent = '';
      
      // Set chart data
      try { candleSeries.setData(chartData); } catch(e) { console.warn('Chart setData error:', e.message); return; }
      
      if (typeof clearAutomaticChartDecorations === 'function') {
        clearAutomaticChartDecorations();
      } else {
        drawingLines.forEach(line => {
          try { candleSeries.removePriceLine(line); } catch(e) {}
        });
        drawingLines = [];
        if (copilotMarkersPrimitive) {
          try { copilotMarkersPrimitive.setMarkers([]); } catch(e) {}
        }
      }
      
      const showAutomaticChartOverlays = false;
      if (showAutomaticChartOverlays && analysis.fib_levels) {
        const fibColors = {
          '25%': '#3b82f680',
          '38.2%': '#8b5cf680',
          '50%': '#f59e0b80',
          '61.8%': '#f97316b0',
          '70%': '#ef4444b0',
          '79%': '#dc2626cc',
          '88%': '#b91c1ccc'
        };
        
        for (const level of analysis.fib_levels) {
          const color = fibColors[level.level] || '#9ca3af80';
          const lineWidth = level.is_near ? 2 : 1;
          const lineStyle = level.is_near 
            ? LightweightCharts.LineStyle.Solid 
            : LightweightCharts.LineStyle.Dotted;
          
          const line = candleSeries.createPriceLine({
            price: level.price,
            color: color,
            lineWidth: lineWidth,
            lineStyle: lineStyle,
            axisLabelVisible: level.is_near,
            title: level.is_near ? `${level.level} Ã¢Ëœâ€¦` : level.level,
          });
          drawingLines.push(line);
        }
      }
      
      // Add range lines (structural low and running high)
      if (showAutomaticChartOverlays && analysis.range) {
        const lowLine = candleSeries.createPriceLine({
          price: analysis.range.low,
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: `Fib Low Anchor ${analysis.range.low_date}`,
        });
        const highLine = candleSeries.createPriceLine({
          price: analysis.range.high,
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: `Fib High Anchor ${analysis.range.high_date}`,
        });
        drawingLines.push(lowLine, highLine);
      }
      
      // Add swing point markers
      if (showAutomaticChartOverlays && analysis.swing_points && chartData.length > 0) {
        const markers = [];
        const timeSet = new Set(chartData.map(b => b.time));
        for (const sp of analysis.swing_points) {
          if (sp.date && timeSet.has(sp.date)) {
            markers.push({
              time: sp.date,
              position: sp.type === 'HIGH' ? 'aboveBar' : 'belowBar',
              color: sp.type === 'HIGH' ? '#ef4444' : '#22c55e',
              shape: sp.type === 'HIGH' ? 'arrowDown' : 'arrowUp',
              text: sp.type === 'HIGH' ? 'H' : 'L'
            });
          }
        }
        markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        if (markers.length > 0) {
          try {
            if (copilotMarkersPrimitive) { copilotMarkersPrimitive.setMarkers(markers); }
            else { copilotMarkersPrimitive = LightweightCharts.createSeriesMarkers(candleSeries, markers); }
          } catch(e) { console.warn('setMarkers error:', e.message); }
        }
      }
      
      const chartContainer = document.getElementById('chart-container');
      const resizeChartToContainer = () => {
        if (!chart || !chartContainer) return;
        chart.applyOptions({
          width: chartContainer.clientWidth,
          height: chartContainer.clientHeight || 500,
        });
        if (typeof resizeDrawingCanvas === 'function') {
          resizeDrawingCanvas();
        }
        chart.timeScale().fitContent();
      };

      resizeChartToContainer();
      requestAnimationFrame(resizeChartToContainer);
      if (chartContainer) chartContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function displayCopilotAnalysis(analysis) {
      resetCopilotAnalysisPanel({
        keepVisible: true,
        symbol: analysis?.symbol,
        timeframe: analysis?.timeframe,
      });

      const panel = document.getElementById('copilot-analysis');
      panel.classList.remove('hidden');
      
      // Verdict header
      const verdictHeader = document.getElementById('copilot-verdict-header');
      const verdictColors = {
        'GO': 'bg-green-900/40 border border-green-500',
        'CONDITIONAL_GO': 'bg-yellow-900/40 border border-yellow-500',
        'WAIT': 'bg-orange-900/40 border border-orange-500',
        'NO_GO': 'bg-red-900/40 border border-red-500',
        'INSUFFICIENT_DATA': 'bg-gray-700'
      };
      const verdictLabels = {
        'GO': 'Ã¢Å“â€¦ GO',
        'CONDITIONAL_GO': 'ÃƒÂ¢Ã…Â¡Ã‚Â Ã¯Â¸Â CONDITIONAL GO',
        'WAIT': 'Ã°Å¸â€Â¶ WAIT',
        'NO_GO': 'Ã¢ÂÅ’ NO-GO',
        'INSUFFICIENT_DATA': 'Ã¢Ââ€œ INSUFFICIENT DATA'
      };
      const tradeDir = analysis.trade_direction || riskPlanDirectionLabel() || 'the planned';
      const verdictSubtitles = {
        'GO': `Conditions favor ${tradeDir} entry`,
        'CONDITIONAL_GO': `Mostly favorable for ${tradeDir} with caveats`,
        'WAIT': `Conditions not yet ready for ${tradeDir}`,
        'NO_GO': `Conditions unfavorable for ${tradeDir}`,
        'INSUFFICIENT_DATA': 'Not enough data'
      };
      
      verdictHeader.className = `flex items-center justify-between p-4 rounded-lg mb-4 ${verdictColors[analysis.verdict] || 'bg-gray-700'}`;
      document.getElementById('copilot-verdict-symbol').textContent = `${analysis.symbol} (${analysis.timeframe})`;
      document.getElementById('copilot-verdict-label').textContent = verdictLabels[analysis.verdict] || analysis.verdict;
      document.getElementById('copilot-verdict-subtitle').textContent = verdictSubtitles[analysis.verdict] || '';
      
      // Price context
      document.getElementById('cp-price').textContent = `$${analysis.current_price?.toFixed(2) || '--'}`;
      
      const retPct = analysis.current_retracement_pct;
      const retEl = document.getElementById('cp-retracement');
      retEl.textContent = retPct != null ? `${retPct.toFixed(1)}%` : '--';
      retEl.className = 'text-lg font-bold mt-1 ' + (retPct > 70 ? 'text-red-400' : retPct > 50 ? 'text-orange-400' : retPct > 38 ? 'text-yellow-400' : 'text-green-400');
      
      const nearFib = analysis.nearest_level;
      document.getElementById('cp-nearest-fib').textContent = nearFib 
        ? `${nearFib.level} of ${formatFibMoney(analysis.range?.low)} -> ${formatFibMoney(analysis.range?.high)} leg (${formatFibMoney(nearFib.price)})`
        : 'None nearby';
      
      const stopDist = analysis.stop_distance_pct;
      const stopEl = document.getElementById('cp-stop-dist');
      stopEl.textContent = stopDist != null ? `${stopDist}%` : '--';
      stopEl.className = 'text-lg font-bold mt-1 ' + (stopDist > 40 ? 'text-red-400' : stopDist > 25 ? 'text-yellow-400' : 'text-green-400');
      
      // Trends
      const trendColor = (t) => t === 'UPTREND' ? 'text-green-400' : t === 'DOWNTREND' ? 'text-red-400' : 'text-yellow-400';
      const ptEl = document.getElementById('cp-primary-trend');
      ptEl.textContent = analysis.primary_trend || '--';
      ptEl.className = 'text-sm font-bold mt-1 ' + trendColor(analysis.primary_trend);
      
      const itEl = document.getElementById('cp-intermediate-trend');
      itEl.textContent = analysis.intermediate_trend || '--';
      itEl.className = 'text-sm font-bold mt-1 ' + trendColor(analysis.intermediate_trend);
      
      const alEl = document.getElementById('cp-alignment');
      alEl.textContent = analysis.trend_alignment || '--';
      alEl.className = 'text-sm font-bold mt-1 ' + (analysis.trend_alignment === 'ALIGNED' ? 'text-green-400' : 'text-red-400');
      
      // Energy
      if (analysis.energy) {
        const e = analysis.energy;
        const stateColor = {
          'STRONG': 'text-blue-400',
          'WANING': 'text-yellow-400',
          'EXHAUSTED': 'text-green-400',
          'RECOVERING': 'text-purple-400'
        };
        const esEl = document.getElementById('cp-energy-state');
        esEl.textContent = e.character_state;
        esEl.className = 'text-lg font-bold ' + (stateColor[e.character_state] || 'text-gray-300');
        
        document.getElementById('cp-energy-direction').textContent = `Direction: ${e.direction}`;
        document.getElementById('cp-velocity').textContent = `${e.velocity?.toFixed(2)}%`;
        document.getElementById('cp-acceleration').textContent = e.acceleration?.toFixed(2) || '--';
      }
      
      // Pressure (direction-aware: buying in uptrend, selling in downtrend)
      if (analysis.selling_pressure) {
        const sp = analysis.selling_pressure;
        const pressureType = analysis.pressure_type || 'Selling';
        
        // Update the label
        const labelEl = document.getElementById('cp-pressure-label');
        if (labelEl) labelEl.textContent = `${pressureType} Pressure`;
        
        const pressEl = document.getElementById('cp-pressure-value');
        pressEl.textContent = `${sp.current?.toFixed(0)}`;
        // Color interpretation: LOW pressure = green (favorable for counter-trend entry)
        const pressColor = sp.current > 70 ? 'text-red-400' : sp.current > 30 ? 'text-yellow-400' : 'text-green-400';
        pressEl.className = 'text-3xl font-black ' + pressColor;
        
        const trendEl = document.getElementById('cp-pressure-trend');
        const trendBadge = sp.trend === 'INCREASING' 
          ? `<span class="bg-red-600/30 text-red-300 px-2 py-0.5 rounded text-xs font-bold">\u25B2 INCREASING</span>`
          : sp.trend === 'DECREASING'
          ? `<span class="bg-green-600/30 text-green-300 px-2 py-0.5 rounded text-xs font-bold">\u25BC DECREASING</span>`
          : `<span class="bg-gray-600/30 text-gray-300 px-2 py-0.5 rounded text-xs font-bold">= STABLE</span>`;
        trendEl.innerHTML = trendBadge;
        
        // Mini bar chart
        const barsEl = document.getElementById('cp-pressure-bars');
        if (sp.history && sp.history.length > 0) {
          const recent = sp.history.slice(-15);
          const maxVal = Math.max(...recent, 1);
          barsEl.innerHTML = recent.map(v => {
            const h = Math.max(2, (v / maxVal) * 40);
            const c = v > 70 ? 'bg-red-400' : v > 30 ? 'bg-yellow-400' : 'bg-green-400';
            return `<div class="${c} rounded-sm" style="width: 4px; height: ${h}px;"></div>`;
          }).join('');
        }
      }
      
      // Fibonacci Table
      if (analysis.fib_levels) {
        const tableEl = document.getElementById('cp-fib-table');
        tableEl.innerHTML = analysis.fib_levels.map(l => {
          const nearBadge = l.is_near ? '<span class="bg-blue-600/50 text-blue-200 px-1.5 py-0.5 rounded text-xs ml-2">NEAR</span>' : '';
          const rowClass = l.is_near ? 'bg-blue-900/20 border border-blue-800' : '';
          return `<div class="flex items-center justify-between py-1.5 px-3 rounded ${rowClass}">
            <span class="font-mono text-sm">${l.level}</span>
            <span class="font-mono text-sm">$${l.price.toFixed(2)}</span>
            <span class="text-xs text-gray-400">${l.distance_pct.toFixed(1)}% away</span>
            ${nearBadge}
          </div>`;
        }).join('');
      }
      
      // Go / No-Go Reasons
      const goReasonsEl = document.getElementById('cp-go-reasons');
      goReasonsEl.innerHTML = (analysis.go_reasons || []).map(r =>
        `<div class="flex items-start gap-2"><span class="text-green-400 mt-0.5">Ã¢Å“â€œ</span><span class="text-green-200">${r}</span></div>`
      ).join('') || '<div class="text-gray-500 text-xs">No favorable signals</div>';
      
      const nogoReasonsEl = document.getElementById('cp-nogo-reasons');
      nogoReasonsEl.innerHTML = (analysis.nogo_reasons || []).map(r =>
        `<div class="flex items-start gap-2"><span class="text-red-400 mt-0.5">Ã¢Å“â€”</span><span class="text-red-200">${r}</span></div>`
      ).join('') || '<div class="text-gray-500 text-xs">No unfavorable signals</div>';
      
      // What to Watch - extract from commentary
      const watchEl = document.getElementById('cp-watch-items');
      const watchSectionEl = document.getElementById('cp-watch-section');
      const commentary = analysis.commentary || '';
      const watchMatch = commentary.match(/WHAT TO WATCH:\n([\s\S]*?)(?=\n\nRISK:|$)/);
      if (watchMatch) {
        if (watchSectionEl) watchSectionEl.classList.remove('hidden');
        const watchLines = watchMatch[1].split('\n').filter(l => l.trim().startsWith('Ã¢â€ â€™'));
        watchEl.innerHTML = watchLines.map(l =>
          `<div class="flex items-start gap-2"><span class="text-yellow-400">Ã¢â€ â€™</span><span>${l.replace(/^\s*Ã¢â€ â€™\s*/, '')}</span></div>`
        ).join('');
      } else {
        if (watchSectionEl) watchSectionEl.classList.add('hidden');
      }
      
      // Full commentary
      document.getElementById('cp-commentary').textContent = commentary;
      syncFibAnchorPanel(analysis);
    }


    
    // Check for trade loaded from Position Book
    async function checkForTradeLoad() {
      const tradeDataStr = localStorage.getItem('copilotLoadTrade');
      if (!tradeDataStr) return false;
      
      try {
        const tradeData = JSON.parse(tradeDataStr);
        localStorage.removeItem('copilotLoadTrade');
        
        const symbolInput = document.getElementById('copilot-symbol');
        const intervalSelect = document.getElementById('copilot-interval');
        if (symbolInput) symbolInput.value = tradeData.symbol || '';
        if (intervalSelect) {
          const requestedInterval = tradeData.interval || '1d';
          const option = Array.from(intervalSelect.options).find((item) => item.value === requestedInterval);
          if (option) intervalSelect.value = requestedInterval;
        }

        if (typeof setTradeDirection === 'function') {
          setTradeDirection(tradeData.direction === -1 ? -1 : 1);
        }

        currentCandidate = {
          ...(currentCandidate && typeof currentCandidate === 'object' ? currentCandidate : {}),
          symbol: tradeData.symbol || '',
          timeframe: tradeData.interval || currentCandidate?.timeframe || '1d',
          pattern_type: tradeData.patternType || currentCandidate?.pattern_type || 'manual',
        };

        if (typeof runCopilotAnalysis === 'function') {
          await runCopilotAnalysis();
        }
        
        if (tradeData.verdict) {
          const aiPanelContent = document.getElementById('cp-commentary');
          if (aiPanelContent) {
            aiPanelContent.textContent = 'ORIGINAL TRADE ANALYSIS:\n\n' + tradeData.verdict;
          }
        }
        
        console.log('Loaded trade ' + tradeData.tradeId + ' for ' + tradeData.symbol);
        return true;
        
      } catch (error) {
        console.error('Failed to load trade from Position Book:', error);
        localStorage.removeItem('copilotLoadTrade');
        return false;
      }
    }

    // ===== NEW PANEL SYNC FUNCTIONS =====

    // Update the visible Key Levels panel from hidden trade-level inputs
    function syncKeyLevelsPanel() {
      const entry = document.getElementById('entry-price-input');
      const stop = document.getElementById('stop-loss-price-input');
      const tp = document.getElementById('take-profit-price-input');
      const rr = document.getElementById('risk-reward');
      const settings = typeof getSettings === 'function' ? getSettings() : { instrumentType: 'stock' };
      const isOptions = settings.instrumentType === 'options';
      
      const fmt = (el) => {
        if (!el || !el.value || el.value === '') return '--';
        return '$' + parseFloat(el.value).toFixed(2);
      };
      const moneyFormatter = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const fmtMoney = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return `${num >= 0 ? '+' : '-'}$${moneyFormatter.format(Math.abs(num))}`;
      };
      
      const klEntryLabel = document.getElementById('kl-entry-label');
      const klStopLabel = document.getElementById('kl-stop-label');
      const klT1Label = document.getElementById('kl-t1-label');
      const klT2Label = document.getElementById('kl-t2-label');
      const klRRLabel = document.getElementById('kl-rr-label');
      const klEntry = document.getElementById('kl-entry');
      const klStop = document.getElementById('kl-stop');
      const klT1 = document.getElementById('kl-t1');
      const klT2 = document.getElementById('kl-t2');
      const klRR = document.getElementById('kl-rr');

      if (klEntryLabel) {
        klEntryLabel.textContent = isOptions ? 'Stock Entry' : 'Entry';
        klEntryLabel.title = isOptions ? 'Underlying stock entry reference for the option trade.' : '';
      }
      if (klStopLabel) {
        klStopLabel.textContent = isOptions ? 'Stock Stop' : 'Stop';
        klStopLabel.title = isOptions ? 'Underlying stock stop reference for the option trade.' : '';
      }
      if (klT1Label) {
        klT1Label.textContent = isOptions ? 'Stock Target' : 'T1';
        klT1Label.title = isOptions ? 'Underlying stock target taken from the chart setup.' : '';
      }
      if (klT2Label) {
        klT2Label.textContent = isOptions ? 'Payoff @ Target' : 'Target $';
        klT2Label.title = isOptions ? 'Estimated option profit/loss if the stock reaches the target price.' : '';
      }
      if (klRRLabel) {
        klRRLabel.textContent = isOptions ? 'Return @ Target' : 'R/R';
        klRRLabel.title = isOptions ? 'Estimated percent return on premium paid if the stock reaches the target price.' : '';
      }
      
      if (klEntry) klEntry.textContent = fmt(entry);
      if (klStop) klStop.textContent = fmt(stop);
      if (klT1) klT1.textContent = fmt(tp);
      if (klT2) {
        klT2.textContent = '--';
        klT2.style.color = 'var(--color-text)';
      }
      if (klRR) {
        klRR.textContent = isOptions ? '--' : (rr ? rr.textContent : '--');
        klRR.style.color = 'var(--color-text)';
      }

      const entryPx = parseFloat(entry?.value);
      const stopPx = parseFloat(stop?.value);
      const tpPx = parseFloat(tp?.value);
      if (klT2 && Number.isFinite(tpPx) && tpPx > 0) {
        if (isOptions) {
          const sizingContext = typeof getPositionSizingContext === 'function'
            ? getPositionSizingContext(settings, settings.optionPrice || entryPrice || entryPx || 0, 0)
            : null;
          const contracts = sizingContext?.effectiveSizing?.units || 0;
          if (contracts > 0) {
            let targetPnl = null;
            const entryPremium = settings.optionPrice || 0;
            const multiplier = settings.contractMultiplier || 100;
            if (settings.optionStrike > 0) {
              const intrinsic = settings.optionType === 'call'
                ? Math.max(0, tpPx - settings.optionStrike)
                : Math.max(0, settings.optionStrike - tpPx);
              targetPnl = (intrinsic - entryPremium) * multiplier * contracts;
            } else {
              targetPnl = (tpPx - entryPremium) * multiplier * contracts;
            }
            klT2.textContent = fmtMoney(targetPnl);
            klT2.style.color = Number(targetPnl) >= 0 ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #ef4444)';
            if (klRR) {
              const totalCost = entryPremium * multiplier * contracts;
              if (totalCost > 0) {
                const targetPct = (targetPnl / totalCost) * 100;
                klRR.textContent = `${targetPct >= 0 ? '+' : ''}${targetPct.toFixed(1)}%`;
                klRR.style.color = targetPct >= 0 ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #ef4444)';
              }
            }
          }
        } else if (Number.isFinite(entryPx) && Number.isFinite(stopPx) && typeof getPositionSizingContext === 'function' && typeof calculatePnL === 'function') {
          const sizingContext = getPositionSizingContext(settings, entryPx, stopPx);
          const targetPnl = calculatePnL(entryPx, tpPx, settings, sizingContext.effectiveSizing, tradeDirection);
          if (targetPnl !== null) {
            klT2.textContent = fmtMoney(targetPnl);
            klT2.style.color = Number(targetPnl) >= 0 ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #ef4444)';
          }
        }
      }

      // Auto position size â€” recalculate whenever entry or stop changes
      if (typeof calcAutoPositionSize === 'function') {
        calcAutoPositionSize(entry?.value, stop?.value);
      }
      renderExecutionRouteSummary();
    }

    // Update the visible Verdict panel from analysis data
    function syncVerdictPanel(analysis) {
      if (!analysis) return;
      
      const labelEl = document.getElementById('verdict-display-label');
      const confEl = document.getElementById('verdict-display-confidence');
      const forEl = document.getElementById('verdict-display-for');
      const againstEl = document.getElementById('verdict-display-against');
      
      if (!labelEl) return;
      
      const verdictMap = {
        'GO': 'Valid',
        'CONDITIONAL_GO': 'Conditional',
        'WAIT': 'Wait',
        'NO_GO': 'Invalid',
        'INSUFFICIENT_DATA': 'No Data'
      };
      const colorMap = {
        'GO': '#22c55e',
        'CONDITIONAL_GO': '#f59e0b',
        'WAIT': '#f97316',
        'NO_GO': '#ef4444',
        'INSUFFICIENT_DATA': '#94a3b8'
      };
      
      labelEl.textContent = verdictMap[analysis.verdict] || analysis.verdict || '--';
      labelEl.style.color = colorMap[analysis.verdict] || 'var(--color-text)';
      
      // Confidence from go/nogo ratio
      const goCount = (analysis.go_reasons || []).length;
      const nogoCount = (analysis.nogo_reasons || []).length;
      const total = goCount + nogoCount;
      const confidence = total > 0 ? Math.round((goCount / total) * 100) : 0;
      confEl.textContent = total > 0 ? confidence + '%' : '--';
      
      // For reasons
      if (forEl) {
        forEl.innerHTML = (analysis.go_reasons || []).map(r =>
          `<div style="display:flex;gap:4px;align-items:flex-start;"><span style="color:#22c55e;flex-shrink:0;">Ã¢Å“â€œ</span><span>${r}</span></div>`
        ).join('') || '<div style="opacity:0.4;">--</div>';
      }
      
      // Against reasons
      if (againstEl) {
        againstEl.innerHTML = (analysis.nogo_reasons || []).map(r =>
          `<div style="display:flex;gap:4px;align-items:flex-start;"><span style="color:#ef4444;flex-shrink:0;">Ã¢Å“â€”</span><span>${r}</span></div>`
        ).join('') || '<div style="opacity:0.4;">--</div>';
      }
    }

    // Update the Phase Progress bar
    function syncPhaseProgress(analysis) {
      if (!analysis) return;
      
      const peakEl = document.getElementById('phase-peak');
      const distEl = document.getElementById('phase-dist');
      const baseEl = document.getElementById('phase-base');
      const markupEl = document.getElementById('phase-markup');
      const pullEl = document.getElementById('phase-pull');
      const breakEl = document.getElementById('phase-break');
      
      // Extract phase data from analysis
      const high = analysis.running_high || analysis.structural_high;
      const low = analysis.structural_low;
      const price = analysis.current_price;
      const retPct = analysis.current_retracement_pct;
      const status = analysis.structure_status;
      
      if (peakEl && high) peakEl.textContent = '$' + high.toFixed(2);
      if (distEl && retPct != null) distEl.textContent = '-' + retPct.toFixed(0) + '%';
      if (baseEl && low) baseEl.textContent = '$' + low.toFixed(2);
      
      // Markup = fib 50% level (discount boundary)
      if (markupEl && high && low) {
        const mid = (high + low) / 2;
        markupEl.textContent = '$' + mid.toFixed(2);
      }
      
      // Pull = current price
      if (pullEl && price) pullEl.textContent = '$' + price.toFixed(2);
      
      // Break = pending or achieved
      if (breakEl) {
        breakEl.textContent = status === 'EXTENSION' ? 'Active' : 'Pending';
      }
    }

    // Update breadcrumb in page header
    function legacyUpdateBreadcrumbUnused() {
      const symbol = document.getElementById('copilot-symbol')?.value?.toUpperCase() || '';
      const interval = document.getElementById('copilot-interval');
      const intervalLabel = interval ? interval.options[interval.selectedIndex]?.text : '';
      
      const breadcrumb = document.getElementById('copilot-breadcrumb');
      if (breadcrumb) {
        if (symbol) {
          breadcrumb.textContent = [symbol, intervalLabel, strategyLabel].filter(Boolean).join(' Ã‚Â· ');
        } else {
          breadcrumb.textContent = 'Enter a symbol to begin';
        }
      }
      
      // Also update chart interval badge
      const intervalDisplay = document.getElementById('chart-interval-display');
      if (intervalDisplay && interval) {
        const shortLabels = {'1mo':'M','1wk':'W','1d':'D','4h':'4H','1h':'1H','15m':'15m','5m':'5m','1m':'1m'};
        intervalDisplay.textContent = shortLabels[interval.value] || interval.value;
      }
    }

    // New Analysis - clear everything
    function newAnalysis() {
      if (typeof cancelPendingCopilotAnalysis === 'function') cancelPendingCopilotAnalysis();
      clearCopilotAnalysisState();
      resetTradingDeskRiskPlanState();
      scannerTradingDeskHandoff = null;
      renderScannerTradingDeskHandoff(null);
      syncFibAnchorPanel(null);
      resetCopilotAnalysisPanel();
      resetCopilotChat();
      document.getElementById('copilot-symbol').value = '';
      document.getElementById('chart-symbol').textContent = 'Enter a symbol';
      document.getElementById('chart-pattern').textContent = '';
      updateBreadcrumb();
      
      // Reset Key Levels
      ['kl-entry','kl-stop','kl-t1','kl-t2','kl-rr','kl-size'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
      });
      const klHint = document.getElementById('kl-size-hint');
      if (klHint) klHint.textContent = '';
      const sbSize = document.getElementById('sidebar-pos-size');
      if (sbSize) sbSize.textContent = '--';
      const sbHint = document.getElementById('position-size-calc');
      if (sbHint) sbHint.textContent = 'Set entry & stop on chart';
      
      // Reset Verdict
      ['verdict-display-label','verdict-display-confidence'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = '--'; el.style.color = ''; }
      });
      ['verdict-display-for','verdict-display-against'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div style="opacity:0.4;">--</div>';
      });
      
      // Reset Phase Progress
      ['phase-peak','phase-dist','phase-base','phase-markup','phase-pull','phase-break'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
      });
    }

    // Export Analysis - placeholder
    function exportAnalysis() {
      const symbol = document.getElementById('copilot-symbol')?.value || 'analysis';
      const commentary = document.getElementById('cp-commentary')?.textContent || '';
      if (!commentary) { alert('No analysis to export. Run an analysis first.'); return; }
      
      const blob = new Blob([commentary], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = symbol.toUpperCase() + '_analysis.txt';
      a.click();
      URL.revokeObjectURL(url);
    }

    // Periodic sync for Key Levels (picks up changes from chart interactions)
    setInterval(syncKeyLevelsPanel, 500);

    // Hook: extend displayCopilotAnalysis to also update new panels
    const _originalDisplayCopilotAnalysis = displayCopilotAnalysis;
    displayCopilotAnalysis = function(analysis) {
      _originalDisplayCopilotAnalysis(analysis);
      if (scannerTradingDeskHandoff) {
        renderScannerTradingDeskHandoff(scannerTradingDeskHandoff, analysis);
      }
      syncVerdictPanel(analysis);
      syncPhaseProgress(analysis);
      updateBreadcrumb();
    };

    function updateBreadcrumb() {
      const symbol = document.getElementById('copilot-symbol')?.value?.toUpperCase() || '';
      const interval = document.getElementById('copilot-interval');
      const intervalLabel = interval ? interval.options[interval.selectedIndex]?.text : '';

      const breadcrumb = document.getElementById('copilot-breadcrumb');
      if (breadcrumb) {
        if (symbol) {
          breadcrumb.textContent = [symbol, intervalLabel].filter(Boolean).join(' Â· ');
        } else {
          breadcrumb.textContent = 'Enter a symbol to begin';
        }
      }

      const intervalDisplay = document.getElementById('chart-interval-display');
      if (intervalDisplay && interval) {
        const shortLabels = {'1mo':'M','1wk':'W','1d':'D','4h':'4H','1h':'1H','15m':'15m','5m':'5m','1m':'1m'};
        intervalDisplay.textContent = shortLabels[interval.value] || interval.value;
      }
    }

    // Hook: update breadcrumb when interval changes
    const intervalEl = document.getElementById('copilot-interval');
    if (intervalEl) intervalEl.addEventListener('change', updateBreadcrumb);
