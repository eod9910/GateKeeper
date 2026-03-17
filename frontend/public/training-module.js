(function () {
  const state = {
    contracts: [],
    contractMap: new Map(),
    sessions: [],
    activeSession: null,
    attempts: [],
    fullBars: [],
    visibleBars: [],
    latestAttempt: null,
    chart: null,
    candleSeries: null,
    overlaySeries: [],
    markersPrimitive: null,
    drawingTools: null,
    indicatorContextId: null,
    markerMode: null,
    startIndex: 0,
    cutoffIndex: -1,
    lastValidationReady: false,
    lastValidationMessage: '',
    validationDirty: true,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, tone) {
    const el = $('training-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = tone === 'bad'
      ? 'var(--color-negative)'
      : tone === 'good'
        ? 'var(--color-positive)'
        : 'var(--color-text-muted)';
  }

  async function api(path, options) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok || body.success === false) {
      throw new Error(body && body.error ? body.error : 'HTTP ' + response.status);
    }
    return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  }

  function fmtNumber(value, digits) {
    if (value == null || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(digits == null ? 2 : digits);
  }

  function fmtPct(value) {
    if (value == null || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(2) + '%';
  }

  function parseOptionalNumber(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmtDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function toDateOnly(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function activeContract() {
    const contractId = $('training-contract') ? $('training-contract').value : '';
    return state.contractMap.get(contractId) || null;
  }

  function primaryRequiredDrawing() {
    const contract = activeContract();
    if (!contract || !Array.isArray(contract.requiredDrawings)) return null;
    return contract.requiredDrawings.find(function (drawing) { return drawing && drawing.required; }) || null;
  }

  function contractRequiresDrawingType(type) {
    const required = primaryRequiredDrawing();
    return !!required && required.type === type;
  }

  function currentSide() {
    return $('btn-training-short').classList.contains('direction-toggle-btn--active') ? 'short' : 'long';
  }

  function setDirection(side) {
    const isShort = side === 'short';
    $('btn-training-long').classList.toggle('direction-toggle-btn--active', !isShort);
    $('btn-training-short').classList.toggle('direction-toggle-btn--active', isShort);
    markValidationDirty();
    updateChartMeta();
    renderChart();
  }

  function updateMarkerButtons() {
    [
      ['btn-marker-entry', 'entry'],
      ['btn-marker-stop', 'stop'],
      ['btn-marker-tp', 'takeProfit'],
    ].forEach(function (item) {
      const el = $(item[0]);
      if (!el) return;
      el.classList.toggle('active', state.markerMode === item[1]);
    });
  }

  function setMarkerMode(mode) {
    state.markerMode = state.markerMode === mode ? null : mode;
    updateMarkerButtons();
    setStatus(state.markerMode ? ('Click the chart to set ' + state.markerMode + '.') : 'Marker mode cleared.', state.markerMode ? null : 'good');
  }

  function updateChartMeta() {
    $('chart-symbol').textContent = $('training-symbol').value.trim().toUpperCase() || '--';
    $('chart-interval-display').textContent = $('training-timeframe').value.toUpperCase();
    $('kl-entry').textContent = $('entry-price').value || '--';
    $('kl-stop').textContent = $('stop-price').value || '--';
    $('kl-tp').textContent = $('tp-price').value || '--';
    const entry = parseOptionalNumber($('entry-price').value);
    const stop = parseOptionalNumber($('stop-price').value);
    const tp = parseOptionalNumber($('tp-price').value);
    const rr = Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(tp) && Math.abs(entry - stop) > 0
      ? Math.abs((currentSide() === 'long' ? tp - entry : entry - tp) / (entry - stop))
      : null;
    const riskPct = Number.isFinite(entry) && Number.isFinite(stop) && entry !== 0
      ? (Math.abs(entry - stop) / entry) * 100
      : null;
    $('kl-rr').textContent = rr == null || !Number.isFinite(rr) ? '--' : fmtNumber(Math.abs(rr), 2);
    $('kl-risk').textContent = riskPct == null || !Number.isFinite(riskPct) ? '--' : fmtPct(riskPct);
    const cutoffBar = state.fullBars[state.cutoffIndex];
    $('kl-entry-bar').textContent = cutoffBar ? String(cutoffBar.time) : '--';
  }

  function currentDisplayBars() {
    const start = Math.max(0, Number(state.startIndex) || 0);
    if (state.latestAttempt && state.latestAttempt.resolution && state.fullBars.length) {
      const revealEnd = Math.min(state.fullBars.length - 1, Number(state.latestAttempt.resolution.exitBarIndex || 0));
      if (revealEnd < start) return [];
      return state.fullBars.slice(start, revealEnd + 1);
    }
    return state.visibleBars;
  }

  function currentChartBars() {
    return currentDisplayBars();
  }

  function blockingEvaluations(validation) {
    if (!validation || !Array.isArray(validation.evaluations)) return [];
    return validation.evaluations.filter(function (evaluation) {
      return evaluation && evaluation.passed === false && evaluation.severity === 'block';
    });
  }

  function sideAwareDescription(desc) {
    var side = currentSide();
    var m = desc.match(/^Long:\s*(.+?)\.\s*Short:\s*(.+?)\.?$/i);
    if (m) return side === 'long' ? m[1] + '.' : m[2] + '.';
    return desc;
  }

  function validationMessage(validation) {
    const blockers = blockingEvaluations(validation);
    if (!blockers.length) return '';
    return blockers
      .slice(0, 2)
      .map(function (evaluation) { return sideAwareDescription(evaluation.description); })
      .join(' ');
  }

  function nearestBarIndexForDate(dateValue) {
    if (!state.fullBars.length) return -1;
    const target = Date.parse(dateValue || '');
    if (!Number.isFinite(target)) return state.fullBars.length - 1;
    let idx = state.fullBars.findIndex(function (bar) {
      const ms = Date.parse(bar.time);
      return Number.isFinite(ms) && ms >= target;
    });
    if (idx < 0) idx = state.fullBars.length - 1;
    return idx;
  }

  function contextStartIndexForCutoff(cutoffIndex, preset) {
    if (!state.fullBars.length || cutoffIndex < 0) return 0;
    if (preset === 'all') return 0;
    const cutoffTime = Date.parse(state.fullBars[Math.min(cutoffIndex, state.fullBars.length - 1)].time);
    if (!Number.isFinite(cutoffTime)) return Math.max(0, cutoffIndex);
    const offsets = { '6m': 183, '1y': 365, '3y': 1095, '5y': 1825 };
    const days = offsets[preset] || 365;
    const target = cutoffTime - days * 24 * 60 * 60 * 1000;
    let bestIndex = 0;
    for (let i = 0; i <= cutoffIndex; i += 1) {
      const ms = Date.parse(state.fullBars[i].time);
      if (!Number.isFinite(ms)) continue;
      if (ms <= target) bestIndex = i;
      if (ms > target) break;
    }
    return Math.max(0, Math.min(bestIndex, cutoffIndex));
  }

  function markValidationDirty() {
    state.validationDirty = true;
    state.lastValidationReady = false;
    state.lastValidationMessage = '';
    updateForwardGate();
  }

  function updateForwardGate() {
    const runButton = $('btn-run-attempt');
    const status = $('forward-lock-status');
    const required = primaryRequiredDrawing();
    const hasSession = !!state.activeSession;
    const hasBars = currentDisplayBars().length > 0;
    const hasDrawing = currentDrawing().length > 0;
    const entry = parseOptionalNumber($('entry-price').value);
    const stop = parseOptionalNumber($('stop-price').value);
    const takeProfit = parseOptionalNumber($('tp-price').value);
    const hasOrderLevels = Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(takeProfit);
    const ready = hasSession && hasBars && hasDrawing && hasOrderLevels && (state.validationDirty || state.lastValidationReady);

    if (runButton) {
      runButton.disabled = !ready;
      runButton.classList.toggle('opacity-50', !ready);
    }

    if (!status) return;
    if (!hasSession) {
      status.textContent = 'Start a session first.';
    } else if (!hasBars) {
      status.textContent = 'Load a historical scenario.';
    } else if (!hasDrawing) {
      status.textContent = 'Draw the required ' + ((required && required.label) || 'setup') + ' first.';
    } else if (!hasOrderLevels) {
      status.textContent = 'Set entry, stop, and take profit to unlock forward testing.';
    } else if (!state.validationDirty && !state.lastValidationReady) {
      status.textContent = state.lastValidationMessage || 'Validation failed. Fix the setup before moving forward.';
    } else if (state.validationDirty) {
      status.textContent = 'Ready to run. The trade will be validated automatically.';
    } else {
      status.textContent = 'Ready to run. Forward test will wait for entry, then exit on stop or take profit.';
    }
  }

  function ensureChart() {
    const container = $('training-chart');
    if (!container || !window.LightweightCharts) return;
    if (state.chart) return;

    state.chart = window.LightweightCharts.createChart(container, {
      width: container.clientWidth || 900,
      height: 440,
      layout: {
        background: { color: '#111216' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: 'rgba(55, 65, 81, 0.35)' },
        horzLines: { color: 'rgba(55, 65, 81, 0.35)' },
      },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(75, 85, 99, 0.45)' },
      timeScale: { borderColor: 'rgba(75, 85, 99, 0.45)' },
    });
    state.candleSeries = state.chart.addSeries(window.LightweightCharts.CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    state.chart.subscribeClick(function (param) {
      if (!state.markerMode || !state.candleSeries || !param || !param.point) return;
      if (state.drawingTools && state.drawingTools.getActiveTool && state.drawingTools.getActiveTool()) return;
      const price = state.candleSeries.coordinateToPrice(param.point.y);
      if (price == null || !Number.isFinite(price)) return;
      if (state.markerMode === 'entry') {
        $('entry-price').value = fmtNumber(price, 2);
      }
      if (state.markerMode === 'stop') $('stop-price').value = fmtNumber(price, 2);
      if (state.markerMode === 'takeProfit') $('tp-price').value = fmtNumber(price, 2);
      state.markerMode = null;
      updateMarkerButtons();
      markValidationDirty();
      updateChartMeta();
      renderChart();
    });

    if (typeof window.DrawingToolsManager !== 'undefined') {
      const chartArea = $('training-chart');
      state.drawingTools = new window.DrawingToolsManager(state.chart, state.candleSeries, chartArea, {
        getBars: function () { return Array.isArray(currentDisplayBars()) ? currentDisplayBars() : []; },
        onChange: function () {
          syncBoxFromDrawingTools();
          markValidationDirty();
          renderChart();
        },
      });
      const toolbarHost = $('training-dt-toolbar');
      if (toolbarHost) {
        window.DrawingToolsManager.attachToolbar(toolbarHost, 'training-chart', state.drawingTools);
      }
    }

    if (typeof window.ciBindToChart === 'function') {
      state.indicatorContextId = window.ciBindToChart(state.chart, state.candleSeries, {
        contextId: 'training',
        symbol: $('training-symbol').value.trim().toUpperCase(),
        interval: $('training-timeframe').value,
      });
      if (typeof window._ciPopulateIndicatorSelect === 'function') {
        window._ciPopulateIndicatorSelect();
      }
    }

    window.addEventListener('resize', function () {
      if (!state.chart || !container) return;
      state.chart.applyOptions({ width: container.clientWidth || 900 });
    });
    window.addEventListener('sidebar-toggled', function () {
      setTimeout(function () {
        if (!state.chart || !container) return;
        state.chart.applyOptions({ width: container.clientWidth || 900 });
      }, 220);
    });
  }

  function clearOverlays() {
    if (!state.chart) return;
    while (state.overlaySeries.length) {
      state.chart.removeSeries(state.overlaySeries.pop());
    }
    if (state.markersPrimitive) {
      state.markersPrimitive.setMarkers([]);
      state.markersPrimitive = null;
    }
  }

  function normalizedRectDrawing() {
    if (!state.drawingTools || typeof state.drawingTools.getDrawings !== 'function') return null;
    const drawings = state.drawingTools.getDrawings();
    const rects = drawings.filter(function (drawing) { return drawing.type === 'rect'; });
    if (!rects.length) return null;
    const rect = rects[rects.length - 1];
    const t1 = String(rect.time1 || '');
    const t2 = String(rect.time2 || '');
    const startTime = Date.parse(t1) <= Date.parse(t2) ? t1 : t2;
    const endTime = Date.parse(t1) <= Date.parse(t2) ? t2 : t1;
    const top = Math.max(Number(rect.price1), Number(rect.price2));
    const bottom = Math.min(Number(rect.price1), Number(rect.price2));
    if (!startTime || !endTime || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    return {
      id: 'base_box',
      type: 'box',
      label: 'Base Box',
      startTime: startTime,
      endTime: endTime,
      top: top,
      bottom: bottom,
    };
  }

  function normalizedFibDrawing() {
    if (!state.drawingTools || typeof state.drawingTools.getDrawings !== 'function') return null;
    const drawings = state.drawingTools.getDrawings();
    const fibs = drawings.filter(function (drawing) { return drawing.type === 'fib'; });
    if (!fibs.length) return null;
    const fib = fibs[fibs.length - 1];
    const time1 = String(fib.time1 || '');
    const time2 = String(fib.time2 || '');
    const price1 = Number(fib.price1);
    const price2 = Number(fib.price2);
    if (!time1 || !time2 || !Number.isFinite(price1) || !Number.isFinite(price2)) return null;
    return {
      id: 'pullback_fib',
      type: 'fib',
      label: 'Pullback Fib',
      startTime: time1,
      endTime: time2,
      price: price1,
      price2: price2,
      top: Math.max(price1, price2),
      bottom: Math.min(price1, price2),
    };
  }

  function syncBoxFromDrawingTools() {
    const box = normalizedRectDrawing();
    if (!box) return;
    $('box-start').value = toDateOnly(box.startTime);
    $('box-end').value = toDateOnly(box.endTime);
    $('box-top').value = fmtNumber(box.top, 2);
    $('box-bottom').value = fmtNumber(box.bottom, 2);
    updateChartMeta();
  }

  function sliceBarsForBox(startTime, endTime) {
    const startMs = Date.parse(startTime || '');
    const endMs = Date.parse(endTime || '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    return currentChartBars().filter(function (bar) {
      const timeMs = Date.parse(bar.time);
      return Number.isFinite(timeMs) && timeMs >= startMs && timeMs <= endMs;
    });
  }

  function resolveBoxRangeTimes() {
    const bars = currentChartBars();
    if (!bars.length) return { startTime: '', endTime: '' };

    const startValue = $('box-start').value;
    const endValue = $('box-end').value;
    const startMs = Date.parse(startValue);
    const endMs = Date.parse(endValue);

    let startBar = null;
    let endBar = null;

    for (let i = 0; i < bars.length; i += 1) {
      const barTime = Date.parse(bars[i].time);
      if (!Number.isFinite(barTime)) continue;
      if (startBar == null && (!Number.isFinite(startMs) || barTime >= startMs)) {
        startBar = bars[i];
      }
      if (!Number.isFinite(endMs) || barTime <= endMs + 24 * 60 * 60 * 1000 - 1) {
        endBar = bars[i];
      }
    }

    if (!startBar) startBar = bars[0];
    if (!endBar) endBar = bars[bars.length - 1];

    if (Date.parse(startBar.time) > Date.parse(endBar.time)) {
      return { startTime: endBar.time, endTime: startBar.time };
    }
    return { startTime: startBar.time, endTime: endBar.time };
  }

  function currentDrawing() {
    const fib = normalizedFibDrawing();
    const box = normalizedRectDrawing();
    if (contractRequiresDrawingType('fib')) {
      return fib ? [fib] : [];
    }
    if (contractRequiresDrawingType('box')) {
      if (box) return [box];
    } else if (box) {
      return [box];
    }
    const top = Number($('box-top').value);
    const bottom = Number($('box-bottom').value);
    const resolved = resolveBoxRangeTimes();
    const startTime = resolved.startTime;
    const endTime = resolved.endTime;
    if (!startTime || !endTime || !Number.isFinite(top) || !Number.isFinite(bottom)) return [];
    return [{
      id: 'base_box',
      type: 'box',
      label: 'Base Box',
      startTime: startTime,
      endTime: endTime,
      top: top,
      bottom: bottom,
    }];
  }

  function renderChart() {
    ensureChart();
    if (!state.chart || !state.candleSeries) return;
    clearOverlays();

    const displayBars = currentChartBars();
    state.candleSeries.setData(displayBars);
    if (!displayBars.length) return;
    updateChartMeta();

    const drawings = currentDrawing();
    const entry = parseOptionalNumber($('entry-price').value);
    const stop = parseOptionalNumber($('stop-price').value);
    const takeProfit = parseOptionalNumber($('tp-price').value);
    const firstBarTime = displayBars[0].time;

    if (drawings.length && drawings[0].type === 'box') {
      const box = drawings[0];
      const topLine = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#f59e0b',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      topLine.setData([{ time: box.startTime, value: box.top }, { time: box.endTime, value: box.top }]);
      state.overlaySeries.push(topLine);

      const bottomLine = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#22c55e',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      bottomLine.setData([{ time: box.startTime, value: box.bottom }, { time: box.endTime, value: box.bottom }]);
      state.overlaySeries.push(bottomLine);
    }

    const lastBarTime = displayBars[displayBars.length - 1].time;
    const markerData = [];
    if (Number.isFinite(entry)) {
      const entryLine = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#38bdf8',
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Solid,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      entryLine.setData([{ time: firstBarTime, value: entry }, { time: lastBarTime, value: entry }]);
      state.overlaySeries.push(entryLine);
    }
    if (Number.isFinite(stop)) {
      const stopLine = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dotted,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      stopLine.setData([{ time: firstBarTime, value: stop }, { time: lastBarTime, value: stop }]);
      state.overlaySeries.push(stopLine);
    }
    if (Number.isFinite(takeProfit)) {
      const tpLine = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#a855f7',
        lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      tpLine.setData([{ time: firstBarTime, value: takeProfit }, { time: lastBarTime, value: takeProfit }]);
      state.overlaySeries.push(tpLine);
    }

    if (state.latestAttempt && state.latestAttempt.resolution) {
      markerData.push({
        time: state.latestAttempt.resolution.exitBarTime,
        position: 'aboveBar',
        color: state.latestAttempt.resolution.exitReason === 'tp_hit' ? '#22c55e' : '#ef4444',
        shape: 'arrowDown',
        text: state.latestAttempt.resolution.exitReason.toUpperCase(),
      });
    }

    if (markerData.length) {
      state.markersPrimitive = window.LightweightCharts.createSeriesMarkers(state.candleSeries, markerData);
    }
  }

  function focusChartOnBaseRange() {
    if (!state.chart) return;
    const bars = currentChartBars();
    if (!bars.length) return;

    const resolved = resolveBoxRangeTimes();
    if (!resolved.startTime || !resolved.endTime) {
      state.chart.timeScale().fitContent();
      return;
    }

    const startIndex = bars.findIndex(function (bar) { return bar.time === resolved.startTime; });
    const endIndex = bars.findIndex(function (bar) { return bar.time === resolved.endTime; });
    if (startIndex < 0 || endIndex < 0) {
      state.chart.timeScale().fitContent();
      return;
    }

    const padding = Math.max(5, Math.round((endIndex - startIndex + 1) * 0.15));
    state.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, startIndex - padding),
      to: Math.min(bars.length - 1, endIndex + padding),
    });
  }

  function focusChartOnRevealedBars() {
    if (!state.chart) return;
    const bars = currentDisplayBars();
    if (!bars.length) return;
    state.chart.timeScale().fitContent();
  }

  function renderContractMeta() {
    const contract = activeContract();
    if (!contract) return;
    $('contract-notes').textContent = contract.notes || 'No notes.';
    $('training-flow-note').innerHTML = contract.id === 'fib_pullback_long_v1'
      ? 'Pick a historical replay date, draw a <code>Fib</code> from swing high down to swing low, then place <code>Entry</code>, <code>Stop</code>, and <code>Set Take Profit</code>. The entry should sit near the 78.6% retracement. When all three are set, run forward.'
      : 'Pick a historical replay date on the right, draw the base box on the chart, then use the toolbar to place <code>Entry</code>, <code>Stop</code>, and <code>Set Take Profit</code>. When all three are set, run forward. The replay will wait for entry to be touched, then it will continue until stop or take profit is hit.';
    $('btn-seed-levels').textContent = contract.id === 'fib_pullback_long_v1' ? 'Auto Fill From Fib' : 'Auto Fill From Box';
    const sides = contract.sideScope && contract.sideScope.length ? contract.sideScope : ['long', 'short'];
    if (sides.length === 1) {
      setDirection(sides[0]);
    }
    renderAggregateStats();
    updateForwardGate();
  }

  function renderContracts() {
    const select = $('training-contract');
    const priorValue = select.value;
    select.innerHTML = state.contracts.map(function (contract) {
      return '<option value="' + contract.id + '">' + contract.name + ' [' + contract.version + ']</option>';
    }).join('');
    const preferredId = priorValue || (state.contractMap.has('fib_pullback_long_v1') ? 'fib_pullback_long_v1' : (state.contracts[0] && state.contracts[0].id));
    if (preferredId) {
      select.value = preferredId;
    }
    renderContractMeta();
  }

  function renderRecentSessions() {
    const container = $('recent-sessions');
    if (!state.sessions.length) {
      container.innerHTML = '<div class="contract-note">No training sessions yet.</div>';
      return;
    }
    container.innerHTML = state.sessions.slice(0, 8).map(function (session) {
      const active = state.activeSession && session.sessionId === state.activeSession.sessionId;
      return (
        '<div class="session-item">' +
          '<div>' +
            '<div class="mono">' + session.contractId + '</div>' +
            '<div class="contract-note">' + fmtDate(session.startedAt) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<span class="tag ' + (active ? 'good' : '') + '">' + (session.stats && session.stats.cooldownActive ? 'Cooldown' : 'Ready') + '</span>' +
            '<button class="btn btn-ghost btn-sm" data-session-id="' + session.sessionId + '">Open</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    container.querySelectorAll('button[data-session-id]').forEach(function (button) {
      button.addEventListener('click', function () {
        loadSession(button.getAttribute('data-session-id'));
      });
    });
  }

  function renderSessionStats() {
    const stats = state.activeSession && state.activeSession.stats ? state.activeSession.stats : null;
    $('kpi-attempts').textContent = stats ? String(stats.attempts) : '0';
    $('kpi-resolved').textContent = stats ? String(stats.resolvedAttempts) : '0';
    $('kpi-win-rate').textContent = stats ? fmtPct(stats.winRate) : '0%';
    $('kpi-avg-r').textContent = stats ? fmtNumber(stats.avgR, 2) : '0.00';
    $('kpi-expectancy').textContent = stats ? fmtNumber(stats.expectancy, 2) : '0.00';
    $('kpi-process').textContent = stats ? fmtNumber(stats.processAdherence, 1) : '0.0';

    var resolved = stats ? (stats.resolvedAttempts || 0) : 0;
    var confEl = $('kpi-confidence');
    if (confEl) {
      if (resolved >= 200) {
        confEl.textContent = 'HIGH — statistically meaningful';
        confEl.style.color = '#22c55e';
      } else if (resolved >= 50) {
        confEl.textContent = 'MEDIUM — emerging pattern (' + resolved + '/200)';
        confEl.style.color = '#f59e0b';
      } else {
        confEl.textContent = 'LOW — not yet meaningful (' + resolved + '/50)';
        confEl.style.color = '#ef4444';
      }
    }

    const badge = $('cooldown-badge');
    if (!stats) {
      badge.className = 'tag';
      badge.textContent = 'Idle';
    } else if (stats.cooldownActive) {
      badge.className = 'tag bad';
      badge.textContent = 'Cooldown until ' + fmtDate(stats.cooldownUntil);
    } else {
      badge.className = 'tag good';
      badge.textContent = 'Ready';
    }
    $('session-status').textContent = state.activeSession
      ? 'Session ' + state.activeSession.sessionId.slice(0, 8) + ' on ' + state.activeSession.contractId
      : 'No active session.';
  }

  function renderChecklist(validation) {
    const container = $('rule-checklist');
    const evaluations = validation && validation.evaluations ? validation.evaluations : [];
    if (!evaluations.length) {
      container.innerHTML = '<div class="contract-note">Validate an attempt to see the contract gate list.</div>';
      return;
    }
    container.innerHTML = evaluations.map(function (evaluation) {
      const tone = evaluation.passed ? 'good' : (evaluation.severity === 'warning' ? 'warn' : 'bad');
      return (
        '<div class="rule-item">' +
          '<div>' +
            '<div class="mono">' + sideAwareDescription(evaluation.description) + '</div>' +
            '<div class="contract-note">Expected: ' + JSON.stringify(evaluation.expected == null ? '' : evaluation.expected) + '</div>' +
          '</div>' +
          '<span class="tag ' + tone + '">' + (evaluation.passed ? 'PASS' : evaluation.severity.toUpperCase()) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderAttempts() {
    const tbody = $('attempts-table-body');
    if (!state.attempts.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="contract-note">No attempts yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.attempts
      .slice()
      .sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); })
      .map(function (attempt) {
        return (
          '<tr>' +
            '<td>' + fmtDate(attempt.createdAt) + '</td>' +
            '<td>' + attempt.symbol + '</td>' +
            '<td>' + attempt.side.toUpperCase() + '</td>' +
            '<td>' + attempt.status.toUpperCase() + '</td>' +
            '<td>' + (attempt.resolution ? attempt.resolution.exitReason : '--') + '</td>' +
            '<td>' + (attempt.resolution ? fmtNumber(attempt.resolution.rMultiple, 2) : '--') + '</td>' +
            '<td>' + (attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.processScore, 1) : '--') + '</td>' +
            '<td>' + (attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.compositeScore, 1) : '--') + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderLatestAttempt() {
    const attempt = state.latestAttempt;
    $('result-status').textContent = attempt ? attempt.status.toUpperCase() : '--';
    $('result-exit').textContent = attempt && attempt.resolution ? attempt.resolution.exitReason : '--';
    $('result-bars-held').textContent = attempt && attempt.resolution ? String(attempt.resolution.barsHeld) : '--';
    $('result-r').textContent = attempt && attempt.resolution ? fmtNumber(attempt.resolution.rMultiple, 2) : '--';
    $('result-process').textContent = attempt && attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.processScore, 1) : '--';
    $('result-composite').textContent = attempt && attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.compositeScore, 1) : '--';
    updateChartMeta();
  }

  async function renderAggregateStats() {
    const contract = activeContract();
    if (!contract) return;
    try {
      const stats = await api('/api/training/stats?contractId=' + encodeURIComponent(contract.id));
      $('aggregate-stats').textContent = 'Contract stats: ' +
        stats.attempts + ' attempts, ' +
        fmtPct(stats.winRate) + ' win rate, ' +
        fmtNumber(stats.avgR, 2) + ' avg R, ' +
        fmtNumber(stats.compositeScoreAvg, 1) + ' composite avg';
    } catch (error) {
      $('aggregate-stats').textContent = error.message;
    }
  }

  function populateBarSelectors() {
    const entryBarSelect = $('entry-bar');
    const priorEntryBar = entryBarSelect.value;
    const priorBoxStart = $('box-start').value;
    const priorBoxEnd = $('box-end').value;
    const visibleBars = state.visibleBars;
    const bars = currentChartBars();
    const options = bars.map(function (bar, index) {
      return '<option value="' + bar.time + '" data-index="' + index + '">' + bar.time + '</option>';
    }).join('');

    entryBarSelect.innerHTML = '<option value="">-- Select Entry Bar --</option>' + options;

    if (visibleBars.length) {
      const minDate = toDateOnly(visibleBars[0].time);
      const maxDate = toDateOnly(visibleBars[visibleBars.length - 1].time);
      const defaultStart = minDate;
      const defaultEnd = maxDate;
      $('box-start').min = minDate;
      $('box-start').max = maxDate;
      $('box-end').min = minDate;
      $('box-end').max = maxDate;
      $('box-start').value = priorBoxStart && priorBoxStart >= minDate && priorBoxStart <= maxDate ? priorBoxStart : defaultStart;
      $('box-end').value = priorBoxEnd && priorBoxEnd >= minDate && priorBoxEnd <= maxDate ? priorBoxEnd : defaultEnd;
      if (priorEntryBar && bars.some(function (bar) { return bar.time === priorEntryBar; })) {
        entryBarSelect.value = priorEntryBar;
      }
    }
  }

  function populateCutoffSelector(selectedTime) {
    const input = $('training-cutoff');
    if (!input || !state.fullBars.length) return;
    input.min = toDateOnly(state.fullBars[0].time);
    input.max = toDateOnly(state.fullBars[state.fullBars.length - 1].time);
    input.value = selectedTime ? toDateOnly(selectedTime) : input.max;
  }

  function applyCutoff(time) {
    if (!state.fullBars.length) return;
    state.cutoffIndex = nearestBarIndexForDate(time);
    state.startIndex = contextStartIndexForCutoff(state.cutoffIndex, $('training-scenario-offset').value);
    state.visibleBars = state.fullBars.slice(state.startIndex, state.cutoffIndex + 1);
    if (state.drawingTools && typeof state.drawingTools.clear === 'function') {
      state.drawingTools.clear();
    }
    state.latestAttempt = null;
    populateBarSelectors();
    updateIndicatorContext();
    renderLatestAttempt();
    renderChart();
    focusChartOnBaseRange();
    markValidationDirty();
  }

  function cutoffIndexFromPreset(preset) {
    if (!state.fullBars.length) return -1;
    if (preset === 'all') return state.fullBars.length - 1;
    const lastTime = Date.parse(state.fullBars[state.fullBars.length - 1].time);
    if (!Number.isFinite(lastTime)) return state.fullBars.length - 1;
    const offsets = { '6m': 183, '1y': 365, '3y': 1095, '5y': 1825 };
    const days = offsets[preset] || 365;
    const target = lastTime - days * 24 * 60 * 60 * 1000;
    let bestIndex = 0;
    for (let i = 0; i < state.fullBars.length; i += 1) {
      const ms = Date.parse(state.fullBars[i].time);
      if (!Number.isFinite(ms)) continue;
      if (ms <= target) bestIndex = i;
      if (ms > target) break;
    }
    return Math.max(0, Math.min(bestIndex, state.fullBars.length - 1));
  }

  function captureBoxRange() {
    const bars = sliceBarsForBox($('box-start').value, $('box-end').value);
    if (!bars.length) {
      setStatus('Choose a valid base start/end range before capturing the box.', 'bad');
      return;
    }
    const high = Math.max.apply(null, bars.map(function (bar) { return Number(bar.high); }));
    const low = Math.min.apply(null, bars.map(function (bar) { return Number(bar.low); }));
    $('box-top').value = fmtNumber(high, 2);
    $('box-bottom').value = fmtNumber(low, 2);
    updateChartMeta();
    renderChart();
    focusChartOnBaseRange();
  }

  function seedLevelsFromBox() {
    const contract = activeContract();
    const side = currentSide();
    const top = Number($('box-top').value);
    const bottom = Number($('box-bottom').value);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;

    let entry;
    let stop;
    let takeProfit;
    if (side === 'long') {
      entry = top;
      stop = bottom;
      takeProfit = entry + (entry - stop) * 2;
    } else {
      entry = bottom;
      stop = top;
      takeProfit = entry - (stop - entry) * 2;
    }
    $('entry-price').value = fmtNumber(entry, 2);
    $('stop-price').value = fmtNumber(stop, 2);
    $('tp-price').value = fmtNumber(takeProfit, 2);
    if (contract && contract.simulation && contract.simulation.maxHoldBars != null) {
      $('max-hold').value = String(contract.simulation.maxHoldBars);
    }
    updateChartMeta();
    renderChart();
    updateForwardGate();
  }

  function seedLevelsFromFib() {
    const contract = activeContract();
    const side = currentSide();
    const drawing = normalizedFibDrawing();
    if (!drawing) return;

    const price1 = Number(drawing.price);
    const price2 = Number(drawing.price2);
    const fibEntry = price1 + (price2 - price1) * 0.786;
    const top = Math.max(price1, price2);
    const bottom = Math.min(price1, price2);
    let entry = fibEntry;
    let stop = bottom;
    let takeProfit = top;
    if (side === 'short') {
      entry = fibEntry;
      stop = top;
      takeProfit = Math.min(bottom, entry - (stop - entry) * 2);
    } else {
      takeProfit = Math.max(top, entry + (entry - stop) * 2);
    }

    $('entry-price').value = fmtNumber(entry, 2);
    $('stop-price').value = fmtNumber(stop, 2);
    $('tp-price').value = fmtNumber(takeProfit, 2);
    if (contract && contract.simulation && contract.simulation.maxHoldBars != null) {
      $('max-hold').value = String(contract.simulation.maxHoldBars);
    }
    updateChartMeta();
    renderChart();
    updateForwardGate();
  }

  function buildAttemptPayload() {
    if (!state.activeSession) throw new Error('Start a session first.');
    const contract = activeContract();
    if (!contract) throw new Error('Select a contract first.');
    const entry = parseOptionalNumber($('entry-price').value);
    const stop = parseOptionalNumber($('stop-price').value);
    const takeProfit = parseOptionalNumber($('tp-price').value);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(takeProfit)) {
      throw new Error('Set entry, stop, and take profit before running the trade.');
    }
    const startIndex = state.cutoffIndex;
    const cutoffBarPayload = state.fullBars[startIndex];
    return {
      sessionId: state.activeSession.sessionId,
      contractId: contract.id,
      symbol: $('training-symbol').value.trim().toUpperCase(),
      timeframe: $('training-timeframe').value,
      side: currentSide(),
      entry: entry,
      stop: stop,
      takeProfit: takeProfit,
      riskPct: Number($('risk-pct').value),
      entryBarIndex: startIndex,
      entryBarTime: cutoffBarPayload ? String(cutoffBarPayload.time) : '',
      drawings: currentDrawing(),
      bars: state.fullBars,
      maxHoldBars: Math.max(1, state.fullBars.length - startIndex - 1),
      tieBreakPolicy: $('tie-break').value,
    };
  }

  async function loadContracts() {
    const contracts = await api('/api/training/contracts');
    state.contracts = contracts;
    state.contractMap = new Map(contracts.map(function (contract) { return [contract.id, contract]; }));
    renderContracts();
  }

  async function loadSessions() {
    state.sessions = await api('/api/training/sessions');
    renderRecentSessions();
  }

  async function loadSession(sessionId) {
    const payload = await api('/api/training/sessions/' + encodeURIComponent(sessionId));
    state.activeSession = payload.session;
    state.attempts = payload.attempts || [];
    state.latestAttempt = state.attempts.length ? state.attempts[state.attempts.length - 1] : null;
    renderSessionStats();
    renderAttempts();
    renderLatestAttempt();
    renderRecentSessions();
    renderChart();
    if (state.latestAttempt && state.latestAttempt.resolution) {
      focusChartOnRevealedBars();
    }
    updateForwardGate();
  }

  async function startSession() {
    const contract = activeContract();
    if (!contract) throw new Error('Select a contract first.');
    const session = await api('/api/training/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ contractId: contract.id }),
    });
    state.activeSession = session;
    state.attempts = [];
    state.latestAttempt = null;
    state.validationDirty = true;
    state.lastValidationReady = false;
    renderSessionStats();
    renderAttempts();
    renderLatestAttempt();
    await loadSessions();
    setStatus('Training session started for ' + contract.name + '.', 'good');
  }

  async function endSession() {
    if (!state.activeSession) throw new Error('No active session to end.');
    await api('/api/training/sessions/' + encodeURIComponent(state.activeSession.sessionId) + '/end', {
      method: 'POST',
    });
    setStatus('Training session ended.', 'good');
    await loadSessions();
    await loadSession(state.activeSession.sessionId);
  }

  async function loadBars() {
    const symbol = $('training-symbol').value.trim().toUpperCase();
    if (!symbol) throw new Error('Enter a symbol first.');
    setStatus('Loading bars for ' + symbol + '...', null);
    const data = await api('/api/chart/ohlcv?symbol=' + encodeURIComponent(symbol) + '&interval=' + encodeURIComponent($('training-timeframe').value) + '&period=' + encodeURIComponent($('training-period').value));
    state.fullBars = Array.isArray(data.chart_data) ? data.chart_data : [];
    const cutoffIdx = cutoffIndexFromPreset($('training-scenario-offset').value);
    const cutoffTime = cutoffIdx >= 0 && state.fullBars[cutoffIdx] ? state.fullBars[cutoffIdx].time : '';
    populateCutoffSelector(cutoffTime);
    applyCutoff($('training-cutoff').value);
    setStatus('Loaded ' + state.fullBars.length + ' bars for ' + symbol + '. Future bars are hidden until validation passes.', 'good');
  }

  async function fetchSymbolPool() {
    try {
      var data = await api('/api/candidates/symbols');
      var all = Array.isArray(data.all) ? data.all : [];
      if (all.length) return all;
      var pool = [];
      var keys = ['commodities', 'futures', 'indices', 'sectors', 'international', 'bonds', 'smallcaps', 'crypto'];
      keys.forEach(function (k) { if (Array.isArray(data[k])) pool = pool.concat(data[k]); });
      return pool.length ? pool : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'SPY', 'QQQ', 'IWM'];
    } catch (e) {
      return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'SPY', 'QQQ', 'IWM'];
    }
  }

  async function loadRandomScenario() {
    setStatus('Picking a random scenario...', null);
    var pool = await fetchSymbolPool();
    var symbol = pool[Math.floor(Math.random() * pool.length)];
    $('training-symbol').value = symbol;
    await loadBars();
    if (!state.fullBars.length || state.fullBars.length < 60) {
      setStatus('Not enough data for ' + symbol + '. Trying another...', null);
      return loadRandomScenario();
    }
    var minIdx = Math.max(60, Math.floor(state.fullBars.length * 0.15));
    var maxIdx = Math.floor(state.fullBars.length * 0.85);
    var randomIdx = minIdx + Math.floor(Math.random() * (maxIdx - minIdx));
    var randomTime = state.fullBars[randomIdx].time;
    populateCutoffSelector(randomTime);
    $('training-cutoff').value = toDateOnly(randomTime);
    applyCutoff($('training-cutoff').value);
    setStatus('Random scenario: ' + symbol + ' at ' + toDateOnly(randomTime) + '.', 'good');
  }

  function updateIndicatorContext() {
    if (typeof window.ciSetActiveContext === 'function' && state.indicatorContextId) {
      window.ciSetActiveContext(state.indicatorContextId);
    }
    if (typeof window.ciUpdateContextMeta === 'function') {
      window.ciUpdateContextMeta($('training-symbol').value.trim().toUpperCase(), $('training-timeframe').value);
    }
    const displayBars = currentChartBars();
    if (typeof window._ciSetData === 'function') {
      window._ciSetData(displayBars);
    }
    if (typeof window.recomputeAllIndicators === 'function') {
      window.recomputeAllIndicators(displayBars);
    }
    if (typeof window._ciPopulateIndicatorSelect === 'function') {
      window._ciPopulateIndicatorSelect();
    }
  }

  function fitChartToContent() {
    focusChartOnBaseRange();
  }

  function clearTrainingChart() {
    if (state.drawingTools && typeof state.drawingTools.clear === 'function') {
      state.drawingTools.clear();
    }
    if (typeof window.removeAllChartIndicators === 'function') {
      window.removeAllChartIndicators();
    }
    $('box-top').value = '';
    $('box-bottom').value = '';
    $('entry-bar').value = '';
    $('entry-price').value = '';
    $('stop-price').value = '';
    $('tp-price').value = '';
    state.latestAttempt = null;
    markValidationDirty();
    updateChartMeta();
    renderLatestAttempt();
    renderChart();
  }

  async function validateAttempt() {
    const payload = buildAttemptPayload();
    const validation = await api('/api/training/attempts/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderChecklist(validation);
    state.validationDirty = false;
    state.lastValidationReady = !!validation.ready;
    state.lastValidationMessage = validation.ready
      ? 'Contract validation passed.'
      : ('Validation blocked: ' + (validationMessage(validation) || 'Fix the setup and try again.'));
    updateForwardGate();
    setStatus(state.lastValidationMessage, validation.ready ? 'good' : 'bad');
    return validation;
  }

  async function runAttempt() {
    const validation = state.validationDirty ? await validateAttempt() : { ready: state.lastValidationReady };
    if (!validation.ready) {
      throw new Error(state.lastValidationMessage || 'The setup failed validation. Fix the trade levels and try again.');
    }
    const payload = buildAttemptPayload();
    const result = await api('/api/training/attempts/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderChecklist(result.validation);
    state.latestAttempt = result.attempt;
    state.validationDirty = true;
    state.lastValidationReady = false;
    await loadSession(result.session.sessionId);
    renderLatestAttempt();
    renderChart();
    focusChartOnRevealedBars();
    setStatus('Attempt saved with status ' + result.attempt.status + '.', result.attempt.status === 'resolved' ? 'good' : 'bad');

    $('entry-price').value = '';
    $('stop-price').value = '';
    $('tp-price').value = '';
    $('box-start').value = '';
    $('box-end').value = '';
    $('box-top').value = '';
    $('box-bottom').value = '';
    if (state.drawingTools && typeof state.drawingTools.clear === 'function') {
      state.drawingTools.clear();
    }
    updateChartMeta();
  }

  function bindEvents() {
    $('training-contract').addEventListener('change', function () {
      renderContractMeta();
      renderChecklist(null);
      markValidationDirty();
    });
    $('btn-training-long').addEventListener('click', function () { setDirection('long'); });
    $('btn-training-short').addEventListener('click', function () { setDirection('short'); });
    $('btn-start-session').addEventListener('click', function () {
      startSession().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('btn-end-session').addEventListener('click', function () {
      endSession().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('btn-load-bars').addEventListener('click', function () {
      loadBars().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('training-period').addEventListener('change', function () {
      loadBars().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('training-timeframe').addEventListener('change', function () {
      loadBars().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('training-scenario-offset').addEventListener('change', function () {
      if (!state.fullBars.length) return;
      applyCutoff($('training-cutoff').value);
      setStatus('Context window set to ' + $('training-scenario-offset').selectedOptions[0].text + '.', 'good');
    });
    $('training-cutoff').addEventListener('change', function () {
      applyCutoff($('training-cutoff').value);
      setStatus('Replay date set to ' + $('training-cutoff').value + '.', 'good');
    });
    $('btn-fit-chart').addEventListener('click', fitChartToContent);
    $('btn-clear-training').addEventListener('click', clearTrainingChart);
    $('btn-marker-entry').addEventListener('click', function () { setMarkerMode('entry'); });
    $('btn-marker-stop').addEventListener('click', function () { setMarkerMode('stop'); });
    $('btn-marker-tp').addEventListener('click', function () { setMarkerMode('takeProfit'); });
    $('btn-seed-levels').addEventListener('click', function () {
      if (contractRequiresDrawingType('fib')) {
        seedLevelsFromFib();
        setStatus('Entry, stop, and target seeded from the Fib drawing.', 'good');
      } else {
        seedLevelsFromBox();
        setStatus('Entry, stop, and target seeded from the box.', 'good');
      }
    });
    $('btn-validate').addEventListener('click', function () {
      validateAttempt().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('btn-run-attempt').addEventListener('click', function () {
      runAttempt().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    ['box-start', 'box-end', 'box-top', 'box-bottom', 'entry-price', 'stop-price', 'tp-price'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (id === 'box-start' || id === 'box-end') {
          populateBarSelectors();
          updateIndicatorContext();
        }
        updateChartMeta();
        markValidationDirty();
        renderChart();
        updateForwardGate();
        if (id === 'box-start' || id === 'box-end') {
          focusChartOnBaseRange();
        }
      });
    });
    $('training-symbol').addEventListener('keypress', function (event) {
      if (event.key === 'Enter') {
        loadBars().catch(function (error) { setStatus(error.message, 'bad'); });
      }
    });
    $('btn-randomize').addEventListener('click', function () {
      loadRandomScenario().catch(function (error) { setStatus(error.message, 'bad'); });
    });
  }

  async function init() {
    if (!$('training-chart')) return;
    try {
      ensureChart();
      bindEvents();
      await loadContracts();
      await loadSessions();
      await loadRandomScenario();
      renderSessionStats();
      renderAttempts();
      renderLatestAttempt();
      updateMarkerButtons();
      updateForwardGate();
      setStatus('Training module ready.', 'good');
    } catch (error) {
      setStatus(error.message || String(error), 'bad');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
