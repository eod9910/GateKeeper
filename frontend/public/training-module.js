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
    sessionTemplateDraft: null,
    semanticDraft: {
      setupFamily: '',
      thesis: '',
      notes: '',
      invalidation: '',
      confidence: '',
      managementPlan: '',
      setupTags: [],
      contextTags: [],
      managementTags: [],
      chartSnapshotRef: null,
    },
  };

  const FAMILY_TO_CONTRACT = {
    pullback: 'pullback_v1',
    breakout: 'breakout_v1',
    reversal: 'fade_v1',
    range: 'breakout_v1',
    continuation: 'breakout_v1',
  };

  const SESSION_FAMILY_PRESETS = {
    pullback: {
      variants: ['fib_discount_pullback', 'fib_lvn_pullback', 'fib_reclaim_pullback'],
      entryModels: ['touch', 'first_reclaim', 'close_back_through'],
      indicators: ['Fib', 'Volume Profile', 'Structure', 'EMA'],
      requiredAnchorType: 'fib',
      retracementOptions: [61.8, 78.6],
    },
    breakout: {
      variants: ['bos_breakout', 'range_breakout', 'breakout_retest'],
      entryModels: ['touch', 'close_through', 'first_retest'],
      indicators: ['Structure', 'Volume Profile', 'VWAP', 'EMA'],
      requiredAnchorType: 'line',
    },
    reversal: {
      variants: ['sweep_reversal', 'fade_reversal'],
      entryModels: ['touch', 'close_back_inside', 'reclaim'],
      indicators: ['Structure', 'Volume Profile', 'VWAP'],
      requiredAnchorType: 'line',
    },
    range: {
      variants: ['range_fade', 'range_reclaim'],
      entryModels: ['touch', 'close_back_inside'],
      indicators: ['Structure', 'Volume Profile'],
      requiredAnchorType: 'box',
    },
    continuation: {
      variants: ['flag_continuation', 'base_break_continuation'],
      entryModels: ['touch', 'close_through', 'first_retest'],
      indicators: ['Structure', 'EMA', 'VWAP'],
      requiredAnchorType: 'line',
    },
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
        : tone === 'warn'
          ? 'var(--color-warning, #f59e0b)'
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

  function toUnixMillis(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1e12 ? value : value * 1000;
    }
    const trimmed = String(value).trim();
    if (!trimmed) return NaN;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = Date.parse(normalized.length === 19 ? (normalized + 'Z') : normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function fmtDate(value) {
    if (!value) return '--';
    const date = new Date(toUnixMillis(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function toDateOnly(value) {
    const date = new Date(toUnixMillis(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function barTimeMs(barOrTime) {
    if (barOrTime && typeof barOrTime === 'object' && Object.prototype.hasOwnProperty.call(barOrTime, 'time')) {
      return toUnixMillis(barOrTime.time);
    }
    return toUnixMillis(barOrTime);
  }

  function formatBarTimeForDisplay(barOrTime) {
    const asDateOnly = toDateOnly(barOrTime);
    return asDateOnly || String((barOrTime && typeof barOrTime === 'object' && Object.prototype.hasOwnProperty.call(barOrTime, 'time')) ? barOrTime.time : barOrTime || '--');
  }

  function activeContract() {
    const contractId = $('training-contract') ? $('training-contract').value : '';
    return state.contractMap.get(contractId) || null;
  }

  function familyPreset(family) {
    const key = String(family || '').trim().toLowerCase();
    return SESSION_FAMILY_PRESETS[key] || null;
  }

  function defaultSessionTemplateForContract(contract) {
    const required = contract && Array.isArray(contract.requiredDrawings)
      ? contract.requiredDrawings.find(function (drawing) { return drawing && drawing.required; })
      : null;
    const family = required && required.type === 'fib'
      ? 'pullback'
      : required && required.type === 'box'
        ? 'range'
        : 'breakout';
    const preset = familyPreset(family) || {};
    const confidenceBuckets = semanticVocabulary(contract).confidenceBuckets;
    return {
      family: family,
      strategyVariant: preset.variants && preset.variants.length ? preset.variants[0] : family,
      indicatorSet: preset.indicators ? preset.indicators.slice(0, Math.min(2, preset.indicators.length)) : [],
      entryModel: preset.entryModels && preset.entryModels.length ? preset.entryModels[0] : 'touch',
      retracementPct: family === 'pullback' ? 78.6 : null,
      stopModel: 'atr_multiple',
      stopAtrMultiple: 2,
      targetModel: 'r_multiple',
      targetRMultiple: 2,
      confidence: confidenceBuckets.length ? confidenceBuckets[0] : 'A',
      requiredAnchorType: required ? required.type : (preset.requiredAnchorType || 'line'),
      notes: '',
    };
  }

  function activeSessionTemplate() {
    if (state.activeSession && state.activeSession.strategyTemplate) return state.activeSession.strategyTemplate;
    return state.sessionTemplateDraft || defaultSessionTemplateForContract(activeContract());
  }

  function sessionTemplateLocked() {
    return !!state.activeSession;
  }

  function normalizedTemplateSignature(template) {
    if (!template) return '';
    return JSON.stringify({
      family: template.family || '',
      strategyVariant: template.strategyVariant || '',
      entryModel: template.entryModel || '',
      retracementPct: Number(template.retracementPct || 0),
      stopAtrMultiple: Number(template.stopAtrMultiple || 0),
      targetRMultiple: Number(template.targetRMultiple || 0),
      confidence: template.confidence || '',
      requiredAnchorType: template.requiredAnchorType || '',
      indicatorSet: Array.isArray(template.indicatorSet) ? template.indicatorSet.slice().sort() : [],
    });
  }

  function sanitizeSessionTemplateForContract(contract) {
    const base = defaultSessionTemplateForContract(contract);
    const current = state.sessionTemplateDraft ? { ...base, ...state.sessionTemplateDraft } : base;
    const allowedFamilies = semanticVocabulary(contract).setupFamilies;
    if (allowedFamilies.length && allowedFamilies.indexOf(current.family) === -1) {
      current.family = allowedFamilies[0];
    }
    const preset = familyPreset(current.family) || {};
    if (preset.variants && preset.variants.length && preset.variants.indexOf(current.strategyVariant) === -1) {
      current.strategyVariant = preset.variants[0];
    }
    if (preset.entryModels && preset.entryModels.length && preset.entryModels.indexOf(current.entryModel) === -1) {
      current.entryModel = preset.entryModels[0];
    }
    current.indicatorSet = Array.isArray(current.indicatorSet)
      ? current.indicatorSet.filter(function (item) { return !preset.indicators || preset.indicators.indexOf(item) !== -1; })
      : [];
    if (!current.indicatorSet.length && preset.indicators && preset.indicators.length) {
      current.indicatorSet = preset.indicators.slice(0, Math.min(2, preset.indicators.length));
    }
    current.stopAtrMultiple = Number(current.stopAtrMultiple || base.stopAtrMultiple || 2);
    current.targetRMultiple = Number(current.targetRMultiple || base.targetRMultiple || 2);
    current.retracementPct = current.family === 'pullback'
      ? Number(current.retracementPct || base.retracementPct || 78.6)
      : null;
    current.requiredAnchorType = current.requiredAnchorType || base.requiredAnchorType;
    state.sessionTemplateDraft = current;
    return current;
  }

  function emptySemanticDraft() {
    return {
      setupFamily: '',
      thesis: '',
      notes: '',
      invalidation: '',
      confidence: '',
      managementPlan: '',
      setupTags: [],
      contextTags: [],
      managementTags: [],
      chartSnapshotRef: null,
    };
  }

  function semanticVocabulary(contract) {
    const vocabulary = contract && contract.semanticVocabulary ? contract.semanticVocabulary : {};
    return {
      setupFamilies: Array.isArray(vocabulary.setupFamilies) ? vocabulary.setupFamilies : [],
      setupTags: Array.isArray(vocabulary.setupTags) ? vocabulary.setupTags : [],
      contextTags: Array.isArray(vocabulary.contextTags) ? vocabulary.contextTags : [],
      managementTags: Array.isArray(vocabulary.managementTags) ? vocabulary.managementTags : [],
      confidenceBuckets: Array.isArray(vocabulary.confidenceBuckets) ? vocabulary.confidenceBuckets : [],
    };
  }

  function sanitizeSemanticDraftForContract(contract) {
    const vocabulary = semanticVocabulary(contract);
    const next = {
      ...emptySemanticDraft(),
      ...state.semanticDraft,
    };
    if (vocabulary.setupFamilies.length && vocabulary.setupFamilies.indexOf(next.setupFamily) === -1) {
      next.setupFamily = '';
    }
    if (vocabulary.confidenceBuckets.length && vocabulary.confidenceBuckets.indexOf(next.confidence) === -1) {
      next.confidence = '';
    }
    next.setupTags = next.setupTags.filter(function (tag) { return vocabulary.setupTags.indexOf(tag) !== -1; });
    next.contextTags = next.contextTags.filter(function (tag) { return vocabulary.contextTags.indexOf(tag) !== -1; });
    next.managementTags = next.managementTags.filter(function (tag) { return vocabulary.managementTags.indexOf(tag) !== -1; });
    state.semanticDraft = next;
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
    if ($('btn-chart-long')) $('btn-chart-long').classList.toggle('direction-toggle-btn--active', !isShort);
    if ($('btn-chart-short')) $('btn-chart-short').classList.toggle('direction-toggle-btn--active', isShort);
    markValidationDirty();
    updateChartMeta();
    renderChart();
  }

  function updateMarkerButtons() {
    [
      ['btn-marker-entry', 'entry'],
      ['btn-marker-stop', 'stop'],
      ['btn-marker-tp', 'takeProfit'],
      ['btn-marker-tp2', 'takeProfit2'],
      ['btn-marker-tp3', 'takeProfit3'],
    ].forEach(function (item) {
      const el = $(item[0]);
      if (!el) return;
      el.classList.toggle('active', state.markerMode === item[1]);
    });
  }

  function setMarkerMode(mode) {
    state.markerMode = state.markerMode === mode ? null : mode;
    updateMarkerButtons();
    var names = { entry: 'entry', stop: 'stop', takeProfit: 'TP1', takeProfit2: 'TP2', takeProfit3: 'TP3' };
    setStatus(state.markerMode ? ('Click the chart to set ' + (names[state.markerMode] || state.markerMode) + '.') : 'Marker mode cleared.', state.markerMode ? null : 'good');
  }

  function updateChartMeta() {
    $('chart-symbol').textContent = $('training-symbol').value.trim().toUpperCase() || '--';
    $('chart-interval-display').textContent = $('training-timeframe').value.toUpperCase();
    $('kl-entry').textContent = $('entry-price').value || '--';
    $('kl-stop').textContent = $('stop-price').value || '--';
    $('kl-tp').textContent = $('tp-price').value || '--';
    var tp2Val = $('tp2-price').value;
    var tp3Val = $('tp3-price').value;
    var tp2Col = $('kl-tp2-col');
    var tp3Col = $('kl-tp3-col');
    if (tp2Col) { tp2Col.style.display = tp2Val ? '' : 'none'; }
    if (tp3Col) { tp3Col.style.display = tp3Val ? '' : 'none'; }
    if ($('kl-tp2')) $('kl-tp2').textContent = tp2Val || '--';
    if ($('kl-tp3')) $('kl-tp3').textContent = tp3Val || '--';
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
    $('kl-entry-bar').textContent = cutoffBar ? formatBarTimeForDisplay(cutoffBar) : '--';
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

  // Compute a robust price range from the visible bars and stash it on
  // state.robustPriceRange so the candle series' autoscaleInfoProvider can
  // clip outliers. Without this, a single corrupted Yahoo bar (e.g. NZDCAD
  // 2004-10-04 with low=0.26 vs the real ~0.85 range) drags the whole
  // price scale down to zero and squashes every legitimate candle into a
  // wick-only sliver. The 1st/99th percentile clip survives ordinary
  // gaps and flash-crash bars while ignoring obvious data corruption.
  function updateRobustPriceRange(bars) {
    if (!Array.isArray(bars) || bars.length === 0) {
      state.robustPriceRange = null;
      return;
    }
    var values = [];
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (!b) continue;
      if (Number.isFinite(b.low)) values.push(b.low);
      if (Number.isFinite(b.high)) values.push(b.high);
      if (Number.isFinite(b.open)) values.push(b.open);
      if (Number.isFinite(b.close)) values.push(b.close);
    }
    if (values.length < 4) {
      state.robustPriceRange = null;
      return;
    }
    values.sort(function (a, b) { return a - b; });
    var n = values.length;
    // 1st/99th percentile clip — small enough to retain real wicks but
    // aggressive enough to ignore single-bar data corruption.
    var loIdx = Math.floor(n * 0.01);
    var hiIdx = Math.min(n - 1, Math.ceil(n * 0.99));
    var lo = values[loIdx];
    var hi = values[hiIdx];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      state.robustPriceRange = null;
      return;
    }
    // Pad ~3% on each end so candles at the extremes aren't flush with the
    // chart edges (matches the default lightweight-charts feel).
    var pad = (hi - lo) * 0.03;
    state.robustPriceRange = { min: lo - pad, max: hi + pad };
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
    const target = toUnixMillis(dateValue || '');
    if (!Number.isFinite(target)) return state.fullBars.length - 1;
    let idx = state.fullBars.findIndex(function (bar) {
      const ms = barTimeMs(bar);
      return Number.isFinite(ms) && ms >= target;
    });
    if (idx < 0) idx = state.fullBars.length - 1;
    return idx;
  }

  function contextStartIndexForCutoff(cutoffIndex, preset) {
    if (!state.fullBars.length || cutoffIndex < 0) return 0;
    if (preset === 'all') return 0;
    const cutoffTime = barTimeMs(state.fullBars[Math.min(cutoffIndex, state.fullBars.length - 1)]);
    if (!Number.isFinite(cutoffTime)) return Math.max(0, cutoffIndex);
    const offsets = { '6m': 183, '1y': 365, '3y': 1095, '5y': 1825 };
    const days = offsets[preset] || 365;
    const target = cutoffTime - days * 24 * 60 * 60 * 1000;
    let bestIndex = 0;
    for (let i = 0; i <= cutoffIndex; i += 1) {
      const ms = barTimeMs(state.fullBars[i]);
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
    const ready = hasSession && hasBars && hasOrderLevels && (state.validationDirty || state.lastValidationReady);

    if (runButton) {
      runButton.disabled = !ready;
      runButton.classList.toggle('opacity-50', !ready);
    }

    if (!status) return;
    if (!hasSession) {
      status.textContent = 'Start a session first.';
    } else if (!hasBars) {
      status.textContent = 'Load a historical scenario.';
    } else if (!hasOrderLevels && !hasDrawing) {
      status.textContent = 'Draw the anchor or set entry, stop, and take profit manually.';
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
    var candleOptions = window.SharedChartUtils && typeof window.SharedChartUtils.getCandlestickSeriesOptions === 'function'
      ? window.SharedChartUtils.getCandlestickSeriesOptions()
      : {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        };
    state.candleSeries = state.chart.addSeries(window.LightweightCharts.CandlestickSeries, candleOptions);

    state.chart.subscribeClick(function (param) {
      if (!state.markerMode || !state.candleSeries || !param || !param.point) return;
      if (state.drawingTools && state.drawingTools.getActiveTool && state.drawingTools.getActiveTool()) return;
      const price = state.candleSeries.coordinateToPrice(param.point.y);
      if (price == null || !Number.isFinite(price)) return;
      if (state.markerMode === 'entry') {
        $('entry-price').value = fmtNumber(price, 2);
      } else if (state.markerMode === 'stop') {
        $('stop-price').value = fmtNumber(price, 2);
      } else if (state.markerMode === 'takeProfit') {
        $('tp-price').value = fmtNumber(price, 2);
      } else if (state.markerMode === 'takeProfit2') {
        $('tp2-price').value = fmtNumber(price, 2);
      } else if (state.markerMode === 'takeProfit3') {
        $('tp3-price').value = fmtNumber(price, 2);
      }
      // Auto-advance: TP1 → TP2 → TP3 → done
      if (state.markerMode === 'takeProfit') {
        state.markerMode = 'takeProfit2';
      } else if (state.markerMode === 'takeProfit2') {
        state.markerMode = 'takeProfit3';
      } else {
        state.markerMode = null;
      }
      updateMarkerButtons();
      markValidationDirty();
      updateChartMeta();
      renderChart();
    });

    // Shared by both the DrawingToolsManager and ciBindToChart blocks below —
    // hoisted out of the DrawingToolsManager `if` so it stays in scope when only
    // ciBindToChart is loaded (otherwise referencing it on line 354 throws
    // "chartArea is not defined" and aborts ensureChart()).
    const chartArea = $('training-chart');

    if (typeof window.DrawingToolsManager !== 'undefined') {
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
        containerEl: chartArea,
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
    const startTime = barTimeMs(t1) <= barTimeMs(t2) ? t1 : t2;
    const endTime = barTimeMs(t1) <= barTimeMs(t2) ? t2 : t1;
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
    const startMs = toUnixMillis(startTime || '');
    const endMs = toUnixMillis(endTime || '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    return currentChartBars().filter(function (bar) {
      const timeMs = barTimeMs(bar);
      return Number.isFinite(timeMs) && timeMs >= startMs && timeMs <= endMs;
    });
  }

  function resolveBoxRangeTimes() {
    const bars = currentChartBars();
    if (!bars.length) return { startTime: '', endTime: '' };

    const startValue = $('box-start').value;
    const endValue = $('box-end').value;
    const startMs = toUnixMillis(startValue);
    const endMs = toUnixMillis(endValue);

    let startBar = null;
    let endBar = null;

    for (let i = 0; i < bars.length; i += 1) {
      const barTime = barTimeMs(bars[i]);
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

    if (barTimeMs(startBar) > barTimeMs(endBar)) {
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
    const topRaw = $('box-top').value;
    const bottomRaw = $('box-bottom').value;
    const top = parseOptionalNumber(topRaw);
    const bottom = parseOptionalNumber(bottomRaw);
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
    var tp2 = parseOptionalNumber($('tp2-price').value);
    if (Number.isFinite(tp2)) {
      var tp2Line = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#c084fc', lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dashed,
        crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      });
      tp2Line.setData([{ time: firstBarTime, value: tp2 }, { time: lastBarTime, value: tp2 }]);
      state.overlaySeries.push(tp2Line);
    }
    var tp3 = parseOptionalNumber($('tp3-price').value);
    if (Number.isFinite(tp3)) {
      var tp3Line = state.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: '#d8b4fe', lineWidth: 1,
        lineStyle: window.LightweightCharts.LineStyle.Dotted,
        crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      });
      tp3Line.setData([{ time: firstBarTime, value: tp3 }, { time: lastBarTime, value: tp3 }]);
      state.overlaySeries.push(tp3Line);
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

  // Zoom to roughly the last REPLAY_FOCUS_WINDOW visible bars and pad the
  // right edge with empty space so the user can SEE that the chart is paused
  // mid-history (future bars are hidden but the cutoff edge sits in view with
  // breathing room to the right). Falls back to fitContent() for tiny series.
  const REPLAY_FOCUS_WINDOW = 120;
  const REPLAY_RIGHT_PAD = 30;
  function focusChartOnRevealedBars() {
    if (!state.chart) return;
    const bars = currentDisplayBars();
    if (!bars.length) return;
    if (bars.length <= REPLAY_FOCUS_WINDOW + REPLAY_RIGHT_PAD) {
      state.chart.timeScale().fitContent();
      return;
    }
    try {
      state.chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, bars.length - REPLAY_FOCUS_WINDOW),
        to: bars.length - 1 + REPLAY_RIGHT_PAD,
      });
    } catch (_) {
      state.chart.timeScale().fitContent();
    }
  }

  function renderSemanticChipGroup(containerId, values, selectedValues, fieldKey) {
    const container = $(containerId);
    if (!container) return;
    if (!values.length) {
      container.innerHTML = '<div class="contract-note">No controlled vocabulary configured.</div>';
      return;
    }
    container.innerHTML = values.map(function (value) {
      const active = selectedValues.indexOf(value) !== -1;
      return '<button type="button" class="declaration-chip ' + (active ? 'is-active' : '') + '" data-semantic-field="' + fieldKey + '" data-semantic-value="' + value + '">' + value + '</button>';
    }).join('');
    container.querySelectorAll('button[data-semantic-field]').forEach(function (button) {
      button.addEventListener('click', function () {
        const field = button.getAttribute('data-semantic-field');
        const value = button.getAttribute('data-semantic-value');
        const current = Array.isArray(state.semanticDraft[field]) ? state.semanticDraft[field].slice() : [];
        const idx = current.indexOf(value);
        if (idx === -1) current.push(value);
        else current.splice(idx, 1);
        state.semanticDraft[field] = current;
        markValidationDirty();
        renderTradeDeclaration();
      });
    });
  }

  function renderSessionIndicatorChips(containerId, values, selectedValues) {
    const container = $(containerId);
    if (!container) return;
    if (!values.length) {
      container.innerHTML = '<div class="contract-note">No indicator presets for this family.</div>';
      return;
    }
    container.innerHTML = values.map(function (value) {
      const active = selectedValues.indexOf(value) !== -1;
      return '<button type="button" class="declaration-chip ' + (active ? 'is-active' : '') + '" data-session-indicator="' + value + '">' + value + '</button>';
    }).join('');
    container.querySelectorAll('button[data-session-indicator]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (sessionTemplateLocked()) return;
        const value = button.getAttribute('data-session-indicator');
        const current = Array.isArray(state.sessionTemplateDraft && state.sessionTemplateDraft.indicatorSet)
          ? state.sessionTemplateDraft.indicatorSet.slice()
          : [];
        const idx = current.indexOf(value);
        if (idx === -1) current.push(value);
        else current.splice(idx, 1);
        state.sessionTemplateDraft.indicatorSet = current;
        renderSessionTemplate();
      });
    });
  }

  function sessionTemplateSummary(template) {
    if (!template) return 'No session template locked yet.';
    var isPullback = template.family === 'pullback';
    const parts = [
      template.family || 'family?',
      template.strategyVariant || 'variant?',
      template.entryModel || 'entry?',
      isPullback && Number.isFinite(Number(template.retracementPct))
        ? ('Entry @ ' + fmtNumber(template.retracementPct, 1) + '% Fib')
        : null,
      isPullback ? 'Stop: 1 ATR past 100%' : ('ATR x' + fmtNumber(template.stopAtrMultiple || 2, 1)),
      isPullback ? 'TP: Fib 0%' : (fmtNumber(template.targetRMultiple || 2, 1) + 'R target'),
    ].filter(Boolean);
    if (template.indicatorSet && template.indicatorSet.length) {
      parts.push('Indicators: ' + template.indicatorSet.join(', '));
    }
    return parts.join(' · ');
  }

  function renderSessionTemplate() {
    const contract = activeContract();
    if (!contract) return;
    const template = sanitizeSessionTemplateForContract(contract);
    const preset = familyPreset(template.family) || {};
    const locked = sessionTemplateLocked();
    const familySelect = $('session-family');
    const variantSelect = $('session-variant');
    const entryModelSelect = $('session-entry-model');
    const retraceSelect = $('session-retracement');
    const stopAtrSelect = $('session-stop-atr');
    const targetRSelect = $('session-target-r');
    const confidenceSelect = $('session-confidence');
    const note = $('session-template-note');
    const retraceField = $('session-retracement-field');
    const anchorHint = $('session-anchor-hint');
    const confidenceBuckets = semanticVocabulary(contract).confidenceBuckets;
    const familyOptions = Object.keys(SESSION_FAMILY_PRESETS);

    if (familySelect) {
      familySelect.innerHTML = familyOptions.map(function (value) {
        return '<option value="' + value + '">' + value + '</option>';
      }).join('');
      familySelect.value = template.family || familyOptions[0] || '';
      familySelect.disabled = locked;
    }
    if (variantSelect) {
      const variants = preset.variants || [template.strategyVariant || template.family];
      variantSelect.innerHTML = variants.map(function (value) {
        return '<option value="' + value + '">' + value + '</option>';
      }).join('');
      variantSelect.value = template.strategyVariant || variants[0] || '';
      variantSelect.disabled = locked;
    }
    if (entryModelSelect) {
      const entryModels = preset.entryModels || ['touch'];
      entryModelSelect.innerHTML = entryModels.map(function (value) {
        return '<option value="' + value + '">' + value + '</option>';
      }).join('');
      entryModelSelect.value = template.entryModel || entryModels[0] || '';
      entryModelSelect.disabled = locked;
    }
    if (retraceField) {
      retraceField.style.display = template.family === 'pullback' ? '' : 'none';
    }
    if (retraceSelect) {
      const retraceValues = preset.retracementOptions || [61.8, 78.6];
      retraceSelect.innerHTML = retraceValues.map(function (value) {
        return '<option value="' + value + '">' + value + '%</option>';
      }).join('');
      retraceSelect.value = String(template.retracementPct || retraceValues[0] || 78.6);
      retraceSelect.disabled = locked || template.family !== 'pullback';
    }
    var isPullback = template.family === 'pullback';
    if (stopAtrSelect) {
      if (isPullback) {
        stopAtrSelect.innerHTML = '<option value="1">1 ATR past Fib 100%</option>';
        stopAtrSelect.value = '1';
      } else {
        stopAtrSelect.innerHTML = '<option value="1">ATR x1</option><option value="1.5">ATR x1.5</option><option value="2">ATR x2</option><option value="3">ATR x3</option>';
        stopAtrSelect.value = String(template.stopAtrMultiple || 2);
      }
      stopAtrSelect.disabled = locked;
    }
    if (targetRSelect) {
      if (isPullback) {
        targetRSelect.innerHTML = '<option value="0">Fib 0% level</option>';
        targetRSelect.value = '0';
      } else {
        targetRSelect.innerHTML = '<option value="1">1R</option><option value="2">2R</option><option value="3">3R</option><option value="4">4R</option><option value="5">5R</option>';
        targetRSelect.value = String(template.targetRMultiple || 2);
      }
      targetRSelect.disabled = locked;
    }
    if (confidenceSelect) {
      confidenceSelect.innerHTML = '<option value="">-- Select --</option>' + confidenceBuckets.map(function (value) {
        return '<option value="' + value + '">' + value + '</option>';
      }).join('');
      confidenceSelect.value = template.confidence || '';
      confidenceSelect.disabled = locked;
    }
    renderSessionIndicatorChips('session-indicators', preset.indicators || [], template.indicatorSet || []);
    if (note) {
      note.textContent = locked
        ? ('Locked for this session: ' + sessionTemplateSummary(activeSessionTemplate()) + '.')
        : 'Lock the strategy variant once, then each attempt only needs the chart anchors.';
    }
    if (anchorHint) {
      anchorHint.textContent = 'Required anchor proof: ' + (template.requiredAnchorType || preset.requiredAnchorType || 'line') + '.';
    }
  }

  function renderTradeDeclaration() {
    const contract = activeContract();
    const vocabulary = semanticVocabulary(contract);
    sanitizeSemanticDraftForContract(contract);
    const template = activeSessionTemplate();

    const setupFamilySelect = $('semantic-setup-family');
    const confidenceSelect = $('semantic-confidence');
    if (setupFamilySelect) {
      setupFamilySelect.innerHTML = '<option value="">-- Select --</option>' + vocabulary.setupFamilies.map(function (item) {
        return '<option value="' + item + '">' + item + '</option>';
      }).join('');
      setupFamilySelect.value = (template && template.family) || state.semanticDraft.setupFamily || '';
      setupFamilySelect.disabled = !!template && sessionTemplateLocked();
    }
    if (confidenceSelect) {
      confidenceSelect.innerHTML = '<option value="">-- Select --</option>' + vocabulary.confidenceBuckets.map(function (item) {
        return '<option value="' + item + '">' + item + '</option>';
      }).join('');
      confidenceSelect.value = (template && template.confidence) || state.semanticDraft.confidence || '';
      confidenceSelect.disabled = !!template && sessionTemplateLocked();
    }
    if ($('semantic-thesis')) $('semantic-thesis').value = state.semanticDraft.thesis || '';
    if ($('semantic-invalidation')) $('semantic-invalidation').value = state.semanticDraft.invalidation || '';
    if ($('semantic-management-plan')) $('semantic-management-plan').value = state.semanticDraft.managementPlan || '';

    renderSemanticChipGroup('semantic-setup-tags', vocabulary.setupTags, state.semanticDraft.setupTags || [], 'setupTags');
    renderSemanticChipGroup('semantic-context-tags', vocabulary.contextTags, state.semanticDraft.contextTags || [], 'contextTags');
    const managementGroup = $('semantic-management-tags-group');
    if (managementGroup) {
      managementGroup.style.display = vocabulary.managementTags.length ? '' : 'none';
    }
    renderSemanticChipGroup('semantic-management-tags', vocabulary.managementTags, state.semanticDraft.managementTags || [], 'managementTags');

    const note = $('semantic-declaration-note');
    if (note) {
      const familyRules = contract && contract.semanticRequirements && Array.isArray(contract.semanticRequirements.familyRules)
        ? contract.semanticRequirements.familyRules
        : [];
      const selectedFamilyRule = familyRules.find(function (rule) { return rule && rule.setupFamily === ((template && template.family) || state.semanticDraft.setupFamily); });
      if (selectedFamilyRule && Array.isArray(selectedFamilyRule.requiredDrawings) && selectedFamilyRule.requiredDrawings.length) {
        note.textContent = sessionTemplateLocked()
          ? ('Session defaults are locked. Define the required anchors and hit Go. Drawing proof: ' + selectedFamilyRule.requiredDrawings.join(', ') + '.')
          : ('The selected setup family requires drawing proof: ' + selectedFamilyRule.requiredDrawings.join(', ') + '.');
      } else {
        note.textContent = sessionTemplateLocked()
          ? 'Session defaults are locked. Define the anchors, optionally add notes, then hit Go.'
          : 'Declare the setup thesis before running the trade. These fields become part of the attempt evidence record.';
      }
    }
  }

  function renderContractMeta() {
    const contract = activeContract();
    if (!contract) return;
    sanitizeSessionTemplateForContract(contract);
    sanitizeSemanticDraftForContract(contract);
    const required = primaryRequiredDrawing();
    const requiresFib = !!required && required.type === 'fib';
    $('contract-notes').textContent = contract.notes || 'No notes.';
    $('training-flow-note').innerHTML = requiresFib
      ? 'Pick a replay date, draw the swing <code>Fib</code>, and let the session template derive entry/stop/target from that anchor. Once the anchors are marked, hit <code>Go</code>.'
      : 'Pick a replay date, draw the breakout/range anchor, and let the session template derive entry/stop/target. Once the anchors are marked, hit <code>Go</code>.';
    $('btn-seed-levels').textContent = requiresFib ? 'Derive Trade From Fib' : 'Derive Trade From Anchors';
    const sides = contract.sideScope && contract.sideScope.length ? contract.sideScope : ['long', 'short'];
    if (sides.length === 1) {
      setDirection(sides[0]);
    }
    renderSessionTemplate();
    renderTradeDeclaration();
    renderBacktestReport();
    updateForwardGate();
  }

  function renderContracts() {
    const select = $('training-contract');
    const priorValue = select.value;
    select.innerHTML = state.contracts.map(function (contract) {
      return '<option value="' + contract.id + '">' + contract.name + ' [' + contract.version + ']</option>';
    }).join('');
    const preferredId = priorValue || (state.contractMap.has('pullback_v1') ? 'pullback_v1' : (state.contracts[0] && state.contracts[0].id));
    if (preferredId) {
      select.value = preferredId;
    }
    renderContractMeta();
  }

  function renderRecentSessions() {
    const container = $('recent-sessions');
    const countBadge = $('session-count-badge');
    if (countBadge) countBadge.textContent = '(' + state.sessions.length + ')';
    if (!state.sessions.length) {
      container.innerHTML = '<div class="contract-note">No training sessions yet.</div>';
      return;
    }
    container.innerHTML = state.sessions.map(function (session) {
      const active = state.activeSession && session.sessionId === state.activeSession.sessionId;
      const s = session.stats || {};
      const resolved = Number(s.resolvedAttempts) || 0;
      const expectancy = Number.isFinite(s.expectancy) ? s.expectancy : 0;
      const winRate = Number.isFinite(s.winRate) ? s.winRate : 0;
      const isEnded = !!session.endedAt;
      const statusLabel = active ? 'Active' : (isEnded ? 'Ended' : 'Open');
      const statusClass = active ? 'good' : (isEnded ? '' : '');

      var templateParts = [];
      if (session.strategyTemplate) {
        if (session.strategyTemplate.family) templateParts.push(session.strategyTemplate.family);
        if (session.strategyTemplate.stopAtrMultiple) templateParts.push('ATR×' + session.strategyTemplate.stopAtrMultiple);
        if (session.strategyTemplate.targetRMultiple) templateParts.push(session.strategyTemplate.targetRMultiple + 'R');
      }
      var templateStr = templateParts.length ? templateParts.join(' · ') : '';

      var expClass = expectancy > 0 ? 'stat-positive' : (expectancy < 0 ? 'stat-negative' : 'stat-neutral');
      var wrClass = winRate >= 50 ? 'stat-positive' : (winRate > 0 ? 'stat-neutral' : 'stat-neutral');

      return (
        '<div class="session-item' + (active ? ' session-active' : '') + '">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span class="mono" style="font-size:12px;">' + session.contractId + '</span>' +
              '<span class="tag ' + statusClass + '">' + statusLabel + '</span>' +
            '</div>' +
            (templateStr ? '<div class="contract-note" style="margin-top:2px;font-size:11px;">' + templateStr + '</div>' : '') +
            '<div class="contract-note" style="margin-top:2px;">' + fmtDate(session.startedAt) + (isEnded ? ' — ' + fmtDate(session.endedAt) : '') + '</div>' +
            (resolved > 0
              ? '<div class="session-stats">' +
                  '<span>' + resolved + ' trades</span>' +
                  '<span class="' + wrClass + '">' + fmtNumber(winRate, 0) + '% win</span>' +
                  '<span class="' + expClass + '">' + (expectancy >= 0 ? '+' : '') + fmtNumber(expectancy, 2) + 'R exp</span>' +
                '</div>'
              : '<div class="session-stats"><span>No trades yet</span></div>'
            ) +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0;">' +
            '<button class="btn btn-ghost btn-sm" data-session-id="' + session.sessionId + '">' + (active ? 'Loaded' : 'Open') + '</button>' +
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
    const attempts = Array.isArray(state.attempts) ? state.attempts : [];
    const resolved = attempts.filter(function (a) { return a.status === 'resolved' && a.resolution; });
    const wins = resolved.filter(function (a) { return (a.resolution.rMultiple || 0) > 0; });
    const losses = resolved.filter(function (a) { return (a.resolution.rMultiple || 0) <= 0; });

    $('kpi-attempts').textContent = stats ? String(stats.attempts) : '0';
    $('kpi-resolved').textContent = String(resolved.length);
    $('kpi-wins').textContent = String(wins.length);
    $('kpi-losses').textContent = String(losses.length);
    $('kpi-win-rate').textContent = stats ? fmtPct(stats.winRate) : '0%';
    $('kpi-expectancy').textContent = stats ? fmtNumber(stats.expectancy, 2) : '0.00';
    $('kpi-process').textContent = stats ? fmtNumber(stats.processAdherence, 1) : '0.0';

    if ($('kpi-tp1-rate')) $('kpi-tp1-rate').textContent = stats && stats.tp1HitRate != null ? fmtPct(stats.tp1HitRate) : '--';
    if ($('kpi-tp2-rate')) $('kpi-tp2-rate').textContent = stats && stats.tp2HitRate != null ? fmtPct(stats.tp2HitRate) : '--';
    if ($('kpi-tp3-rate')) $('kpi-tp3-rate').textContent = stats && stats.tp3HitRate != null ? fmtPct(stats.tp3HitRate) : '--';

    var totalR = resolved.reduce(function (sum, a) { return sum + (a.resolution.rMultiple || 0); }, 0);
    var totalREl = $('kpi-total-r');
    if (totalREl) {
      totalREl.textContent = fmtNumber(totalR, 2);
      totalREl.style.color = totalR > 0 ? '#22c55e' : (totalR < 0 ? '#ef4444' : '');
    }

    var rValues = resolved.map(function (a) { return a.resolution.rMultiple || 0; });
    var bestREl = $('kpi-best-r');
    var worstREl = $('kpi-worst-r');
    if (bestREl) {
      if (rValues.length) {
        var best = Math.max.apply(null, rValues);
        bestREl.textContent = '+' + fmtNumber(best, 2) + 'R';
        bestREl.style.color = '#22c55e';
      } else {
        bestREl.textContent = '--';
        bestREl.style.color = '';
      }
    }
    if (worstREl) {
      if (rValues.length) {
        var worst = Math.min.apply(null, rValues);
        worstREl.textContent = fmtNumber(worst, 2) + 'R';
        worstREl.style.color = '#ef4444';
      } else {
        worstREl.textContent = '--';
        worstREl.style.color = '';
      }
    }

    var avgBarsWinEl = $('kpi-avg-bars-win');
    var avgBarsLoseEl = $('kpi-avg-bars-lose');
    if (avgBarsWinEl) {
      if (wins.length) {
        var winBarsTotal = wins.reduce(function (s, a) { return s + (a.resolution.barsHeld || 0); }, 0);
        avgBarsWinEl.textContent = fmtNumber(winBarsTotal / wins.length, 1);
      } else {
        avgBarsWinEl.textContent = '--';
      }
    }
    if (avgBarsLoseEl) {
      if (losses.length) {
        var lossBarsTotal = losses.reduce(function (s, a) { return s + (a.resolution.barsHeld || 0); }, 0);
        avgBarsLoseEl.textContent = fmtNumber(lossBarsTotal / losses.length, 1);
      } else {
        avgBarsLoseEl.textContent = '--';
      }
    }

    var winStreakEl = $('kpi-win-streak');
    var lossStreakEl = $('kpi-loss-streak');
    if (winStreakEl || lossStreakEl) {
      var maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
      resolved.forEach(function (a) {
        if ((a.resolution.rMultiple || 0) > 0) {
          curWin++; curLoss = 0;
          if (curWin > maxWinStreak) maxWinStreak = curWin;
        } else {
          curLoss++; curWin = 0;
          if (curLoss > maxLossStreak) maxLossStreak = curLoss;
        }
      });
      if (winStreakEl) winStreakEl.textContent = resolved.length ? String(maxWinStreak) : '--';
      if (lossStreakEl) lossStreakEl.textContent = resolved.length ? String(maxLossStreak) : '--';
    }

    var resolvedCount = stats ? (stats.resolvedAttempts || 0) : 0;
    var confEl = $('kpi-confidence');
    if (confEl) {
      if (resolvedCount >= 200) {
        confEl.textContent = 'HIGH — statistically meaningful';
        confEl.style.color = '#22c55e';
      } else if (resolvedCount >= 50) {
        confEl.textContent = 'MEDIUM — emerging pattern (' + resolvedCount + '/200)';
        confEl.style.color = '#f59e0b';
      } else {
        confEl.textContent = 'LOW — not yet meaningful (' + resolvedCount + '/50)';
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

    var titleEl = $('session-scoreboard-title');
    var subtitleEl = $('session-scoreboard-subtitle');
    if (state.activeSession) {
      var isEnded = !!state.activeSession.endedAt;
      if (titleEl) titleEl.textContent = isEnded ? 'Session Review' : 'Active Session';
      if (subtitleEl) subtitleEl.textContent =
        state.activeSession.contractId + ' · ' +
        sessionTemplateSummary(activeSessionTemplate()) +
        ' · ' + fmtDate(state.activeSession.startedAt) +
        (isEnded ? ' — ' + fmtDate(state.activeSession.endedAt) : '');
    } else {
      if (titleEl) titleEl.textContent = 'Session Scoreboard';
      if (subtitleEl) subtitleEl.textContent = 'No session loaded.';
    }

    $('session-status').textContent = state.activeSession
      ? ('Session ' + state.activeSession.sessionId.slice(0, 8) + ' on ' + state.activeSession.contractId + ' · ' + sessionTemplateSummary(activeSessionTemplate()))
      : 'No active session.';
  }

  function renderChecklist(validation) {
    const container = $('rule-checklist');
    const evaluations = validation && validation.evaluations ? validation.evaluations : [];
    if (!evaluations.length) {
      container.innerHTML = '<div class="contract-note">Validate an attempt to see the contract gate list.</div>';
      return;
    }
    function formatChecklistValue(value) {
      if (value == null || value === '') return '--';
      if (typeof value === 'number') return Number.isFinite(value) ? fmtNumber(value, 2) : '--';
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.length ? value.join(', ') : '--';
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch (_error) {
          return String(value);
        }
      }
      return String(value);
    }
    container.innerHTML = evaluations.map(function (evaluation) {
      const tone = evaluation.passed ? 'good' : (evaluation.severity === 'warning' ? 'warn' : 'bad');
      return (
        '<div class="rule-item">' +
          '<div>' +
            '<div class="mono">' + sideAwareDescription(evaluation.description) + '</div>' +
            '<div class="contract-note">Actual: ' + formatChecklistValue(evaluation.actual) + '</div>' +
            '<div class="contract-note">Expected: ' + formatChecklistValue(evaluation.expected) + '</div>' +
          '</div>' +
          '<span class="tag ' + tone + '">' + (evaluation.passed ? 'PASS' : evaluation.severity.toUpperCase()) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderAttempts() {
    const tbody = $('attempts-table-body');
    if (!state.attempts.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="contract-note">No attempts yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.attempts
      .slice()
      .sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); })
      .map(function (attempt) {
        var resultLabel = '--';
        var resultStyle = 'color:var(--color-text-muted);';
        if (attempt && attempt.resolution) {
          var rMultiple = Number(attempt.resolution.rMultiple);
          if (attempt.resolution.exitReason === 'no_fill') {
            resultLabel = 'NO FILL';
            resultStyle = 'color:#94a3b8;font-weight:700;';
          } else if (Number.isFinite(rMultiple) && rMultiple > 0) {
            resultLabel = 'WIN';
            resultStyle = 'color:#22c55e;font-weight:700;';
          } else if (Number.isFinite(rMultiple) && rMultiple < 0) {
            resultLabel = 'LOSS';
            resultStyle = 'color:#ef4444;font-weight:700;';
          } else {
            resultLabel = 'FLAT';
            resultStyle = 'color:#f59e0b;font-weight:700;';
          }
        } else if (attempt && attempt.status === 'blocked') {
          resultLabel = 'BLOCKED';
          resultStyle = 'color:#ef4444;font-weight:700;';
        } else if (attempt && attempt.status === 'entered') {
          resultLabel = 'OPEN';
          resultStyle = 'color:#38bdf8;font-weight:700;';
        }
        return (
          '<tr>' +
            '<td>' + fmtDate(attempt.createdAt) + '</td>' +
            '<td>' + attempt.symbol + '</td>' +
            '<td>' + attempt.side.toUpperCase() + '</td>' +
            '<td>' + attempt.status.toUpperCase() + '</td>' +
            '<td><span style="' + resultStyle + '">' + resultLabel + '</span></td>' +
            '<td>' + (attempt.resolution ? attempt.resolution.exitReason : '--') + '</td>' +
            '<td>' + (attempt.resolution ? fmtNumber(attempt.resolution.rMultiple, 2) : '--') + '</td>' +
            '<td>' + (attempt.resolution && attempt.resolution.tp2 ? (attempt.resolution.tp2.hit ? '<span style="color:#22c55e;">✓</span>' : '<span style="color:#ef4444;">✗</span>') : '--') + '</td>' +
            '<td>' + (attempt.resolution && attempt.resolution.tp3 ? (attempt.resolution.tp3.hit ? '<span style="color:#22c55e;">✓</span>' : '<span style="color:#ef4444;">✗</span>') : '--') + '</td>' +
            '<td>' + (attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.processScore, 1) : '--') + '</td>' +
            '<td>' + (attempt.scoreSnapshot ? fmtNumber(attempt.scoreSnapshot.compositeScore, 1) : '--') + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderLatestAttempt() {
    const attempt = state.latestAttempt;
    const exitEl = $('result-exit');
    const barsEl = $('result-bars-held');
    const rEl = $('result-r');
    if (exitEl) exitEl.textContent = attempt && attempt.resolution ? attempt.resolution.exitReason : '--';
    if (barsEl) barsEl.textContent = attempt && attempt.resolution ? String(attempt.resolution.barsHeld) : '--';
    if (rEl) rEl.textContent = attempt && attempt.resolution ? fmtNumber(attempt.resolution.rMultiple, 2) : '--';
    updateChartMeta();
  }

  // ── Outcome banner ──────────────────────────────────────────────────────────
  function showOutcomeBanner(exitReason, rMultiple, barsHeld, resolution) {
    const banner = $('outcome-banner');
    const textEl = $('outcome-banner-text');
    const detailEl = $('outcome-banner-detail');
    if (!banner || !textEl) return;

    let label = '';
    let bg = '';
    let fg = '#fff';
    if (exitReason === 'tp_hit') {
      label = 'TP1 HIT';
      bg = '#16a34a';
    } else if (exitReason === 'sl_hit') {
      label = 'STOP LOSS HIT';
      bg = '#dc2626';
    } else if (exitReason === 'time_stop') {
      label = 'TIME STOP';
      bg = '#d97706';
    } else if (exitReason === 'no_fill') {
      label = 'ENTRY NEVER FILLED';
      bg = '#6b7280';
    } else {
      label = String(exitReason || 'RESOLVED').toUpperCase();
      bg = '#6b7280';
    }

    textEl.textContent = label;
    if (detailEl) {
      const parts = [];
      if (Number.isFinite(rMultiple)) parts.push((rMultiple >= 0 ? '+' : '') + fmtNumber(rMultiple, 2) + 'R');
      if (Number.isFinite(barsHeld) && barsHeld > 0) parts.push(barsHeld + ' bars');
      if (resolution) {
        if (resolution.tp2 && resolution.tp2.hit) parts.push('TP2 ✓');
        else if (resolution.tp2) parts.push('TP2 ✗');
        if (resolution.tp3 && resolution.tp3.hit) parts.push('TP3 ✓');
        else if (resolution.tp3) parts.push('TP3 ✗');
      }
      detailEl.textContent = parts.join(' · ');
    }
    banner.style.background = bg;
    banner.style.color = fg;
    banner.style.display = 'block';
    banner.style.opacity = '1';
  }

  function hideOutcomeBanner() {
    const banner = $('outcome-banner');
    if (banner) banner.style.display = 'none';
  }

  // ── Animated walk to resolution ─────────────────────────────────────────────
  state.resolutionAnimTimerId = null;

  function stopResolutionAnim() {
    if (state.resolutionAnimTimerId != null) {
      clearInterval(state.resolutionAnimTimerId);
      state.resolutionAnimTimerId = null;
    }
  }

  function isAnimatingResolution() {
    return state.resolutionAnimTimerId != null;
  }

  function animateToResolution(serverResult, onComplete) {
    stopPlay();
    stopResolutionAnim();
    hideOutcomeBanner();

    const attempt = serverResult.attempt;
    const resolution = attempt && attempt.resolution;
    if (!resolution) {
      if (onComplete) onComplete();
      return;
    }

    const targetIndex = Math.min(
      Number(resolution.exitBarIndex) || state.cutoffIndex,
      state.fullBars.length - 1
    );
    const entryFillIndex = resolution.entryHit ? Number(resolution.entryBarIndex) : -1;
    const totalSteps = targetIndex - state.cutoffIndex;

    if (totalSteps <= 0) {
      state.latestAttempt = attempt;
      renderLatestAttempt();
      renderChart();
      focusChartOnRevealedBars();
      showOutcomeBanner(resolution.exitReason, resolution.rMultiple, resolution.barsHeld, resolution);
      if (onComplete) onComplete();
      return;
    }

    const speed = selectedPlaySpeed();
    const baseInterval = intervalForSpeed(speed);
    const interval = totalSteps > 60 ? Math.min(baseInterval, 80) : baseInterval;

    const runBtn = $('btn-run-attempt');
    if (runBtn) {
      runBtn.textContent = 'Stop';
      runBtn.disabled = false;
      runBtn.classList.remove('opacity-50');
    }

    let entryAnnounced = false;

    state.resolutionAnimTimerId = setInterval(function () {
      if (state.cutoffIndex >= targetIndex) {
        stopResolutionAnim();
        state.latestAttempt = attempt;
        renderLatestAttempt();
        renderChart();
        focusChartOnRevealedBars();
        showOutcomeBanner(resolution.exitReason, resolution.rMultiple, resolution.barsHeld, resolution);

        if (runBtn) {
          runBtn.textContent = 'Run Trade';
          runBtn.disabled = true;
          runBtn.classList.add('opacity-50');
        }
        var tpParts = [];
        if (resolution.tp2) tpParts.push('TP2:' + (resolution.tp2.hit ? '✓' : '✗'));
        if (resolution.tp3) tpParts.push('TP3:' + (resolution.tp3.hit ? '✓' : '✗'));
        var tpSuffix = tpParts.length ? ' | ' + tpParts.join(' ') : '';
        setStatus(
          'Attempt saved — ' + resolution.exitReason.replace(/_/g, ' ').toUpperCase() +
          ' at ' + fmtNumber(resolution.exitPrice, 2) +
          ' (' + (resolution.rMultiple >= 0 ? '+' : '') + fmtNumber(resolution.rMultiple, 2) + 'R, ' +
          resolution.barsHeld + ' bars).' + tpSuffix,
          resolution.exitReason === 'tp_hit' ? 'good' : 'bad'
        );

        if (onComplete) onComplete();
        return;
      }

      const nextIndex = Math.min(state.cutoffIndex + 1, targetIndex);
      setCutoffIndex(nextIndex, { preserveDrawings: true, preserveAttempt: true, focusMode: 'none' });

      if (!entryAnnounced && entryFillIndex >= 0 && state.cutoffIndex >= entryFillIndex) {
        entryAnnounced = true;
        setStatus('Entry filled at ' + fmtNumber(attempt.entry, 2) + '. Walking forward...', 'good');
      }
    }, interval);
  }

  async function renderAggregateStats() {
    const contract = activeContract();
    if (!contract) return;
    try {
      const stats = await api('/api/training/stats?contractId=' + encodeURIComponent(contract.id));
      const resolved = stats && Number.isFinite(Number(stats.resolvedAttempts)) ? Number(stats.resolvedAttempts) : 0;
      $('aggregate-stats').textContent = 'Contract stats: ' +
        stats.attempts + ' attempts, ' +
        fmtPct(stats.winRate) + ' win rate, ' +
        fmtNumber(stats.avgR, 2) + ' avg R, ' +
        fmtNumber(stats.compositeScoreAvg, 1) + ' composite avg';

      $('contract-kpi-attempts').textContent = String(stats.attempts || 0);
      $('contract-kpi-resolved').textContent = String(stats.resolvedAttempts || 0);
      $('contract-kpi-wins').textContent = String(stats.wins || 0);
      $('contract-kpi-losses').textContent = String(stats.losses || 0);
      $('contract-kpi-win-rate').textContent = fmtPct(stats.winRate || 0);
      $('contract-kpi-avg-r').textContent = fmtNumber(stats.avgR || 0, 2);
      $('contract-kpi-expectancy').textContent = fmtNumber(stats.expectancy || 0, 2);
      $('contract-kpi-process').textContent = fmtNumber(stats.processAdherence || 0, 1);
      $('contract-kpi-sessions').textContent = String(stats.sessions || 0);
      $('contract-kpi-composite').textContent = fmtNumber(stats.compositeScoreAvg || 0, 1);
      $('contract-stats-badge').textContent = (contract.name || contract.id) + ' · All Sessions';

      const contractConfidenceEl = $('contract-kpi-confidence');
      if (contractConfidenceEl) {
        if (resolved >= 200) {
          contractConfidenceEl.textContent = 'HIGH — statistically meaningful';
          contractConfidenceEl.style.color = '#22c55e';
        } else if (resolved >= 50) {
          contractConfidenceEl.textContent = 'MEDIUM — emerging pattern (' + resolved + '/200)';
          contractConfidenceEl.style.color = '#f59e0b';
        } else if (resolved > 0) {
          contractConfidenceEl.textContent = 'LOW — not yet meaningful (' + resolved + '/50)';
          contractConfidenceEl.style.color = '#ef4444';
        } else {
          contractConfidenceEl.textContent = 'LOW — no resolved trades yet';
          contractConfidenceEl.style.color = '#ef4444';
        }
      }
    } catch (error) {
      $('aggregate-stats').textContent = error.message;
      [
        'contract-kpi-attempts',
        'contract-kpi-resolved',
        'contract-kpi-wins',
        'contract-kpi-losses',
        'contract-kpi-win-rate',
        'contract-kpi-avg-r',
        'contract-kpi-expectancy',
        'contract-kpi-process',
        'contract-kpi-sessions',
        'contract-kpi-composite',
        'contract-kpi-confidence',
      ].forEach(function (id) {
        const el = $(id);
        if (el) el.textContent = '--';
      });
    }
  }

  async function renderBacktestReport() {
    const contract = activeContract();
    if (!contract) return;
    try {
      const report = await api('/api/training/report?contractId=' + encodeURIComponent(contract.id));
      const scope = report && report.scope ? report.scope : {};
      const trades = report && report.trades_summary ? report.trades_summary : {};
      const risk = report && report.risk_summary ? report.risk_summary : {};
      const discipline = report && report.discipline_summary ? report.discipline_summary : {};
      const confidence = report && report.confidence ? report.confidence : {};
      const breakdowns = report && report.breakdowns ? report.breakdowns : {};
      const topExit = Array.isArray(breakdowns.exit_reasons) && breakdowns.exit_reasons.length ? breakdowns.exit_reasons[0] : null;
      const confidenceTone = confidence.label === 'HIGH'
        ? '#22c55e'
        : confidence.label === 'MEDIUM'
          ? '#f59e0b'
          : '#ef4444';

      $('aggregate-stats').textContent = 'Contract backtest: ' +
        String(scope.attempts || 0) + ' attempts, ' +
        String(scope.filledTrades || 0) + ' filled, ' +
        fmtNumber(trades.expectancy_R || 0, 2) + 'R expectancy, ' +
        fmtNumber(trades.profit_factor || 0, 2) + ' PF, ' +
        fmtNumber(risk.max_drawdown_R || 0, 2) + 'R max DD';

      $('backtest-report-summary').textContent =
        (contract.name || contract.id) + ' · ' +
        String(scope.filledTrades || 0) + ' filled trades · ' +
        fmtNumber(trades.expectancy_R || 0, 2) + 'R expectancy · ' +
        fmtNumber(trades.profit_factor || 0, 2) + ' PF';

      $('backtest-report-note').textContent = topExit
        ? 'Most common exit path: ' + topExit.key + ' (' + fmtPct((topExit.pct || 0) * 100) + '). ' + (confidence.message || '')
        : (confidence.message || 'Record more attempts to build a discretionary edge report.');

      $('report-scope').textContent = String(scope.sessions || 0) + ' sessions / ' + String(scope.attempts || 0) + ' attempts';
      $('report-qualified').textContent = String(scope.qualifiedAttempts || 0);
      $('report-filled').textContent = String(scope.filledTrades || 0);
      $('report-no-fill').textContent = String(scope.noFillTrades || 0);
      $('report-pass-rate').textContent = fmtPct((discipline.contract_pass_rate || 0) * 100);
      $('report-win-rate').textContent = fmtPct((trades.win_rate || 0) * 100);
      $('report-expectancy').textContent = fmtNumber(trades.expectancy_R || 0, 2) + 'R';
      $('report-profit-factor').textContent = fmtNumber(trades.profit_factor || 0, 2);
      $('report-payoff').textContent = fmtNumber(trades.payoff_ratio || 0, 2);
      $('report-max-dd-r').textContent = fmtNumber(risk.max_drawdown_R || 0, 2) + 'R';
      $('report-max-dd-pct').textContent = fmtPct(risk.max_drawdown_pct || 0);
      $('report-loss-streak').textContent = String(risk.longest_losing_streak || 0);
      $('report-avg-hold').textContent = fmtNumber(trades.avg_hold_bars || 0, 1) + ' bars';
      $('report-process').textContent = fmtNumber(discipline.process_adherence || 0, 1);
      $('report-reward-risk').textContent = fmtNumber(discipline.avg_reward_risk || 0, 2);
      $('report-risk-pct').textContent = fmtPct(discipline.avg_risk_pct || 0);

      $('contract-kpi-attempts').textContent = String(scope.attempts || 0);
      $('contract-kpi-resolved').textContent = String(scope.resolvedAttempts || 0);
      $('contract-kpi-wins').textContent = String(trades.winners || 0);
      $('contract-kpi-losses').textContent = String(trades.losers || 0);
      $('contract-kpi-win-rate').textContent = fmtPct((trades.win_rate || 0) * 100);
      $('contract-kpi-avg-r').textContent = fmtNumber(trades.expectancy_R || 0, 2);
      $('contract-kpi-expectancy').textContent = fmtNumber(trades.expectancy_R || 0, 2);
      $('contract-kpi-process').textContent = fmtNumber(discipline.process_adherence || 0, 1);
      $('contract-kpi-sessions').textContent = String(scope.sessions || 0);
      $('contract-kpi-composite').textContent = fmtNumber(discipline.composite_score_avg || 0, 1);
      $('contract-stats-badge').textContent = (contract.name || contract.id) + ' · Semantic Backtest';

      const contractConfidenceEl = $('contract-kpi-confidence');
      if (contractConfidenceEl) {
        contractConfidenceEl.textContent = (confidence.label || 'LOW') + ' · ' + (confidence.message || 'No resolved trades yet.');
        contractConfidenceEl.style.color = confidenceTone;
      }
    } catch (error) {
      $('aggregate-stats').textContent = error.message;
      [
        'contract-kpi-attempts',
        'contract-kpi-resolved',
        'contract-kpi-wins',
        'contract-kpi-losses',
        'contract-kpi-win-rate',
        'contract-kpi-avg-r',
        'contract-kpi-expectancy',
        'contract-kpi-process',
        'contract-kpi-sessions',
        'contract-kpi-composite',
        'contract-kpi-confidence',
        'report-scope',
        'report-qualified',
        'report-filled',
        'report-no-fill',
        'report-pass-rate',
        'report-win-rate',
        'report-expectancy',
        'report-profit-factor',
        'report-payoff',
        'report-max-dd-r',
        'report-max-dd-pct',
        'report-loss-streak',
        'report-avg-hold',
        'report-process',
        'report-reward-risk',
        'report-risk-pct',
      ].forEach(function (id) {
        const el = $(id);
        if (el) el.textContent = '--';
      });
      $('backtest-report-summary').textContent = error.message;
      $('backtest-report-note').textContent = 'Could not load the contract backtest report.';
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

  function updateReplayProgress() {
    const el = $('replay-progress');
    const backButton = $('btn-step-back');
    const forwardButton = $('btn-step-forward');
    const forwardFiveButton = $('btn-step-forward-5');
    const triggerButton = $('btn-step-to-trigger');
    const endButton = $('btn-step-to-end');
    const hasBars = !!state.fullBars.length && state.cutoffIndex >= 0;

    if (backButton) backButton.disabled = !hasBars || state.cutoffIndex <= 0;
    if (forwardButton) forwardButton.disabled = !hasBars || state.cutoffIndex >= state.fullBars.length - 1;
    if (forwardFiveButton) forwardFiveButton.disabled = !hasBars || state.cutoffIndex >= state.fullBars.length - 1;
    if (triggerButton) triggerButton.disabled = !hasBars;
    if (endButton) endButton.disabled = !hasBars || state.cutoffIndex >= state.fullBars.length - 1;
    if (typeof refreshPlayButtonStates === 'function') refreshPlayButtonStates();

    if (!el) return;
    if (!hasBars) {
      el.textContent = 'Load a scenario to begin replay.';
      return;
    }

    const currentBar = state.fullBars[state.cutoffIndex];
    const visibleCount = Math.max(0, state.cutoffIndex - state.startIndex + 1);
    const hiddenCount = Math.max(0, state.fullBars.length - state.cutoffIndex - 1);
    const completionPct = state.fullBars.length > 1
      ? ((state.cutoffIndex + 1) / state.fullBars.length) * 100
      : 100;

    el.textContent =
      'Showing through ' + toDateOnly(currentBar && currentBar.time) +
      ' · ' + visibleCount + ' visible bars' +
      ' · ' + hiddenCount + ' hidden bars remaining' +
      ' · ' + fmtNumber(completionPct, 1) + '% through history';
  }

  function setCutoffIndex(nextIndex, options) {
    if (!state.fullBars.length) return;
    const opts = options || {};
    const clampedIndex = Math.max(0, Math.min(Number(nextIndex) || 0, state.fullBars.length - 1));
    state.cutoffIndex = clampedIndex;
    state.startIndex = contextStartIndexForCutoff(state.cutoffIndex, $('training-scenario-offset').value);
    state.visibleBars = state.fullBars.slice(state.startIndex, state.cutoffIndex + 1);
    populateCutoffSelector(state.fullBars[state.cutoffIndex].time);
    if ($('training-cutoff')) {
      $('training-cutoff').value = toDateOnly(state.fullBars[state.cutoffIndex].time);
    }
    if (!opts.preserveDrawings && state.drawingTools && typeof state.drawingTools.clear === 'function') {
      state.drawingTools.clear();
    }
    if (!opts.preserveAttempt) {
      state.latestAttempt = null;
    }
    populateBarSelectors();
    updateIndicatorContext();
    if (!opts.preserveAttempt) renderLatestAttempt();
    renderChart();
    if (opts.focusMode === 'revealed') {
      focusChartOnRevealedBars();
    } else if (opts.focusMode !== 'none') {
      focusChartOnBaseRange();
    }
    if (!opts.preserveAttempt) markValidationDirty();
    updateReplayProgress();
  }

  function applyCutoff(time) {
    if (!state.fullBars.length) return;
    // Keep the replay edge in view when the user jumps to a date; fitting the
    // entire history makes dense forex series look like collapsed OHLC bars.
    setCutoffIndex(nearestBarIndexForDate(time), { focusMode: 'revealed' });
  }

  function stepReplay(delta) {
    if (!state.fullBars.length || state.cutoffIndex < 0) return;
    const nextIndex = Math.max(0, Math.min(state.fullBars.length - 1, state.cutoffIndex + delta));
    if (nextIndex === state.cutoffIndex) {
      updateReplayProgress();
      return false;
    }
    setCutoffIndex(nextIndex, { preserveDrawings: true, focusMode: 'none' });
    return true;
  }

  function jumpReplayToEnd() {
    if (!state.fullBars.length) return;
    if (state.cutoffIndex >= state.fullBars.length - 1) {
      updateReplayProgress();
      return false;
    }
    setCutoffIndex(state.fullBars.length - 1, { preserveDrawings: true, focusMode: 'revealed' });
    return true;
  }

  // ── Auto-play (market-replay) ─────────────────────────────────────────────
  // Walks the cutoff one bar at a time at a configurable rate so the user can
  // watch the chart "play forward" like a live tape. 1×/5×/10× control the
  // bars-per-second rate. Direction is +1 (forward) or −1 (rewind). Always
  // single-tracked: starting one direction stops the other.
  state.playTimerId = null;
  state.playDirection = 0;
  const PLAY_INTERVALS_MS = { 1: 1500, 5: 400, 10: 150 };

  function selectedPlaySpeed() {
    var sel = $('replay-speed');
    var raw = sel ? Number(sel.value) : 1;
    return PLAY_INTERVALS_MS[raw] ? raw : 1;
  }

  function intervalForSpeed(speed) {
    return PLAY_INTERVALS_MS[speed] || PLAY_INTERVALS_MS[1];
  }

  function isPlaying() { return state.playTimerId != null; }

  function stopPlay(reason) {
    if (state.playTimerId != null) {
      clearInterval(state.playTimerId);
      state.playTimerId = null;
    }
    state.playDirection = 0;
    refreshPlayButtonStates();
    if (reason) setStatus(reason, 'good');
  }

  function startPlay(direction) {
    if (!state.fullBars.length || state.cutoffIndex < 0) {
      setStatus('Load a scenario before pressing Play.', 'bad');
      return;
    }
    if (direction > 0 && state.cutoffIndex >= state.fullBars.length - 1) {
      setStatus('Already at the end of the replay.', 'bad');
      return;
    }
    if (direction < 0 && state.cutoffIndex <= 0) {
      setStatus('Already at the first available bar.', 'bad');
      return;
    }
    if (state.playTimerId != null) clearInterval(state.playTimerId);
    state.playDirection = direction > 0 ? 1 : -1;
    var speed = selectedPlaySpeed();
    state.playTimerId = setInterval(function () {
      var ok = stepReplay(state.playDirection);
      if (!ok) {
        stopPlay(state.playDirection > 0 ? 'Reached the end of the replay.' : 'Reached the first available bar.');
      }
    }, intervalForSpeed(speed));
    refreshPlayButtonStates();
    setStatus((state.playDirection > 0 ? 'Playing forward' : 'Rewinding') + ' at ' + speed + '× speed.', 'good');
  }

  function togglePlayForward() {
    if (state.playDirection > 0) { stopPlay('Paused.'); return; }
    startPlay(1);
  }

  function togglePlayBackward() {
    if (state.playDirection < 0) { stopPlay('Paused.'); return; }
    startPlay(-1);
  }

  function refreshPlayButtonStates() {
    var fwd = $('btn-play-forward');
    var rev = $('btn-play-backward');
    var hasBars = !!state.fullBars.length && state.cutoffIndex >= 0;
    if (fwd) {
      fwd.textContent = state.playDirection > 0 ? '⏸' : '▶';
      fwd.disabled = !hasBars || state.cutoffIndex >= state.fullBars.length - 1;
      fwd.title = state.playDirection > 0 ? 'Pause' : 'Play forward at the selected speed';
    }
    if (rev) {
      rev.textContent = state.playDirection < 0 ? '⏸' : '◀';
      rev.disabled = !hasBars || state.cutoffIndex <= 0;
      rev.title = state.playDirection < 0 ? 'Pause' : 'Play backward (rewind) at the selected speed';
    }
  }

  function activeReplayTriggerConfig() {
    const entryPrice = parseOptionalNumber($('entry-price').value);
    if (Number.isFinite(entryPrice)) {
      return {
        kind: 'entry',
        triggerPrice: entryPrice,
        side: currentSide(),
      };
    }

    const contract = activeContract();
    const fib = normalizedFibDrawing();
    if (!contract || !fib) return null;
    const entryRules = Array.isArray(contract.entryRules) ? contract.entryRules : [];
    const triggerRule = entryRules.find(function (rule) {
      return rule
        && (rule.type === 'entry_beyond_fib_level' || rule.type === 'entry_near_fib_level' || rule.type === 'entry_near_fib_retracement');
    });
    if (!triggerRule) return null;
    const level = Number(triggerRule.level != null ? triggerRule.level : 0.5);
    const triggerPrice = fibLevelPrice(fib, level);
    if (!Number.isFinite(triggerPrice)) return null;
    return {
      kind: 'fib',
      fib: fib,
      level: level,
      triggerPrice: triggerPrice,
      side: currentSide(),
    };
  }

  function findNextReplayTriggerIndex() {
    const trigger = activeReplayTriggerConfig();
    if (!trigger || !state.fullBars.length) return -1;
    for (let i = Math.max(0, state.cutoffIndex + 1); i < state.fullBars.length; i += 1) {
      const bar = state.fullBars[i];
      const high = Number(bar.high);
      const low = Number(bar.low);
      if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
      const touched = trigger.side === 'long'
        ? low <= trigger.triggerPrice
        : high >= trigger.triggerPrice;
      if (touched) return i;
    }
    return -1;
  }

  function stepReplayToFibTrigger() {
    if (!state.fullBars.length || state.cutoffIndex < 0) return { ok: false, message: 'Load a scenario first.' };
    const trigger = activeReplayTriggerConfig();
    if (!trigger) {
      return { ok: false, message: 'Set an entry price or draw a Fib first.' };
    }
    const nextIndex = findNextReplayTriggerIndex();
    if (nextIndex < 0) {
      const triggerLabel = trigger.kind === 'entry'
        ? 'entry price'
        : (fmtNumber(trigger.level * 100, 1) + '% Fib level');
      return {
        ok: false,
        message: 'No future bar reaches the ' + triggerLabel + ' in the remaining replay.',
      };
    }
    setCutoffIndex(nextIndex, { preserveDrawings: true, focusMode: 'revealed' });
    const triggerLabel = trigger.kind === 'entry'
      ? ('entry price ' + fmtNumber(trigger.triggerPrice, 2))
      : (fmtNumber(trigger.level * 100, 1) + '% Fib level');
    return {
      ok: true,
      message: 'Walked forward to the first touch of ' + triggerLabel + ' on ' + formatBarTimeForDisplay(state.fullBars[nextIndex]) + '.',
    };
  }

  function cutoffIndexFromPreset(preset) {
    if (!state.fullBars.length) return -1;
    if (preset === 'all') return state.fullBars.length - 1;
    const lastTime = barTimeMs(state.fullBars[state.fullBars.length - 1]);
    if (!Number.isFinite(lastTime)) return state.fullBars.length - 1;
    const offsets = { '6m': 183, '1y': 365, '3y': 1095, '5y': 1825 };
    const days = offsets[preset] || 365;
    const target = lastTime - days * 24 * 60 * 60 * 1000;
    let bestIndex = 0;
    for (let i = 0; i < state.fullBars.length; i += 1) {
      const ms = barTimeMs(state.fullBars[i]);
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

  function computeAtrAtCutoff(length) {
    const bars = Array.isArray(state.fullBars) ? state.fullBars : [];
    const endIndex = Number(state.cutoffIndex);
    const lookback = Math.max(2, Number(length) || 14);
    if (!bars.length || endIndex <= 0) return null;
    const start = Math.max(1, endIndex - lookback + 1);
    let trSum = 0;
    let count = 0;
    for (let i = start; i <= endIndex; i += 1) {
      const bar = bars[i];
      const prev = bars[i - 1];
      if (!bar || !prev) continue;
      const high = Number(bar.high);
      const low = Number(bar.low);
      const prevClose = Number(prev.close);
      if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      if (!Number.isFinite(tr)) continue;
      trSum += tr;
      count += 1;
    }
    return count ? trSum / count : null;
  }

  function currentRiskTemplate() {
    const template = activeSessionTemplate() || {};
    return {
      retracementPct: Number(template.retracementPct || 78.6),
      stopAtrMultiple: Number(template.stopAtrMultiple || 2),
      targetRMultiple: Number(template.targetRMultiple || 2),
    };
  }

  function seedLevelsFromBox() {
    const side = currentSide();
    const top = Number($('box-top').value);
    const bottom = Number($('box-bottom').value);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
    const contract = activeContract();
    const template = currentRiskTemplate();
    const atr = computeAtrAtCutoff(14);

    let entry;
    let stop;
    let takeProfit;
    if (side === 'long') {
      entry = top;
      stop = Number.isFinite(atr) ? entry - (atr * template.stopAtrMultiple) : bottom;
      takeProfit = entry + Math.abs(entry - stop) * template.targetRMultiple;
    } else {
      entry = bottom;
      stop = Number.isFinite(atr) ? entry + (atr * template.stopAtrMultiple) : top;
      takeProfit = entry - Math.abs(stop - entry) * template.targetRMultiple;
    }
    $('entry-price').value = fmtNumber(entry, 2);
    $('stop-price').value = fmtNumber(stop, 2);
    $('tp-price').value = fmtNumber(takeProfit, 2);
    if (contract && contract.simulation && contract.simulation.maxHoldBars != null) {
      $('max-hold').value = String(contract.simulation.maxHoldBars);
    }
    markValidationDirty();
    updateChartMeta();
    renderChart();
    updateForwardGate();
  }

  function seedLevelsFromFib() {
    const contract = activeContract();
    const drawing = normalizedFibDrawing();
    if (!drawing) return;
    const template = activeSessionTemplate() || {};
    const atr = computeAtrAtCutoff(14);

    // Fib coordinates: price1 = 0% level, price2 = 100% level.
    // For a long pullback the user draws from prior HIGH (0%) down to pullback LOW (100%).
    // For a short pullback the user draws from prior LOW (0%) up to pullback HIGH (100%).
    const price0 = Number(drawing.price);
    const price100 = Number(drawing.price2);
    const range = Math.abs(price100 - price0);
    if (range === 0) return;

    // Determine trade side. Respect the user's manual toggle if set;
    // otherwise infer from Fib direction (high→low = long pullback, low→high = short).
    var userSide = currentSide();
    var inferredSide = price0 > price100 ? 'long' : 'short';

    // If the user's toggle disagrees with the Fib direction, swap the Fib
    // interpretation so price0/price100 semantics stay consistent.
    var effectivePrice0 = price0;
    var effectivePrice100 = price100;
    if (userSide !== inferredSide) {
      effectivePrice0 = price100;
      effectivePrice100 = price0;
    }
    setDirection(userSide);

    // Entry at the selected Fib level (61.8% or 78.6%)
    const entryLevel = Math.max(0.01, Math.min(0.99, Number(template.retracementPct || 78.6) / 100));
    const entry = effectivePrice0 + (effectivePrice100 - effectivePrice0) * entryLevel;

    // Take profit at the 0% level (the prior structural high/low)
    const takeProfit = effectivePrice0;

    // Stop: 1 ATR beyond the 100% level (away from 0%)
    var stop;
    if (Number.isFinite(atr)) {
      var dir = Math.sign(effectivePrice100 - effectivePrice0);
      stop = effectivePrice100 + dir * atr;
    } else {
      stop = effectivePrice100 + (effectivePrice100 - effectivePrice0) * 0.05;
    }

    var riskAmt = Math.abs(entry - stop);
    var rewardAmt = Math.abs(takeProfit - entry);
    var impliedR = riskAmt > 0 ? (rewardAmt / riskAmt) : 0;

    $('entry-price').value = fmtNumber(entry, 2);
    $('stop-price').value = fmtNumber(stop, 2);
    $('tp-price').value = fmtNumber(takeProfit, 2);
    if (contract && contract.simulation && contract.simulation.maxHoldBars != null) {
      $('max-hold').value = String(contract.simulation.maxHoldBars);
    }
    setStatus(
      'Fib seeded — entry at ' + fmtNumber(entryLevel * 100, 1) + '%, '
      + 'stop 1 ATR past 100%, TP at 0%. Implied R:R = 1:' + fmtNumber(impliedR, 1),
      'good'
    );
    markValidationDirty();
    updateChartMeta();
    renderChart();
    updateForwardGate();
  }

  function buildAttemptPayload() {
    if (!state.activeSession) throw new Error('Start a session first.');
    const contract = activeContract();
    if (!contract) throw new Error('Select a contract first.');
    const sessionTemplate = activeSessionTemplate() || {};
    const entry = parseOptionalNumber($('entry-price').value);
    const stop = parseOptionalNumber($('stop-price').value);
    const takeProfit = parseOptionalNumber($('tp-price').value);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(takeProfit)) {
      throw new Error('Set entry, stop, and take profit before running the trade.');
    }
    const startIndex = state.cutoffIndex;
    const cutoffBarPayload = state.fullBars[startIndex];
    const generatedThesis = [
      sessionTemplate.family || state.semanticDraft.setupFamily || '',
      sessionTemplate.strategyVariant || '',
      sessionTemplate.entryModel || '',
      sessionTemplate.family === 'pullback' && Number.isFinite(Number(sessionTemplate.retracementPct))
        ? ('Entry @ ' + fmtNumber(sessionTemplate.retracementPct, 1) + '% Fib')
        : '',
      sessionTemplate.indicatorSet && sessionTemplate.indicatorSet.length
        ? ('Indicators: ' + sessionTemplate.indicatorSet.join(', '))
        : '',
    ].filter(Boolean).join(' | ');
    const generatedInvalidation = Number.isFinite(stop)
      ? ('Trade invalid if price hits the ' + fmtNumber(Number(sessionTemplate.stopAtrMultiple || 2), 1) + ' ATR stop at ' + fmtNumber(stop, 5) + '.')
      : '';
    const generatedManagementPlan = [
      'System-managed attempt.',
      'Initial stop: ATR x' + fmtNumber(Number(sessionTemplate.stopAtrMultiple || 2), 1) + '.',
      'Target: ' + fmtNumber(Number(sessionTemplate.targetRMultiple || 2), 1) + 'R.',
    ].join(' ');
    const semanticDeclaration = {
      schemaVersion: 'v1',
      setupFamily: sessionTemplate.family || state.semanticDraft.setupFamily || '',
      thesis: state.semanticDraft.thesis || generatedThesis,
      notes: state.semanticDraft.notes || '',
      invalidation: state.semanticDraft.invalidation || generatedInvalidation,
      side: currentSide(),
      confidence: sessionTemplate.confidence || state.semanticDraft.confidence || '',
      managementPlan: state.semanticDraft.managementPlan || generatedManagementPlan,
      setupTags: Array.isArray(state.semanticDraft.setupTags) ? state.semanticDraft.setupTags.slice() : [],
      contextTags: Array.isArray(state.semanticDraft.contextTags) ? state.semanticDraft.contextTags.slice() : [],
      managementTags: Array.isArray(state.semanticDraft.managementTags) ? state.semanticDraft.managementTags.slice() : [],
      chartSnapshotRef: null,
    };
    return {
      sessionId: state.activeSession.sessionId,
      contractId: contract.id,
      symbol: $('training-symbol').value.trim().toUpperCase(),
      timeframe: $('training-timeframe').value,
      side: currentSide(),
      entry: entry,
      stop: stop,
      takeProfit: takeProfit,
      takeProfit2: parseOptionalNumber($('tp2-price').value) || undefined,
      takeProfit3: parseOptionalNumber($('tp3-price').value) || undefined,
      riskPct: Number($('risk-pct').value),
      entryBarIndex: startIndex,
      entryBarTime: cutoffBarPayload ? String(cutoffBarPayload.time) : '',
      drawings: currentDrawing(),
      semanticDeclaration: semanticDeclaration,
      bars: state.fullBars,
      maxHoldBars: Math.max(1, state.fullBars.length - startIndex - 1),
      tieBreakPolicy: $('tie-break').value,
      entryModel: (activeSessionTemplate() || {}).entryModel || 'touch',
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

  function latestOpenSessionForContract(contractId, strategyTemplate) {
    if (!contractId || !Array.isArray(state.sessions)) return null;
    const targetSignature = normalizedTemplateSignature(strategyTemplate);
    return state.sessions.find(function (session) {
      return session
        && session.contractId === contractId
        && !session.endedAt
        && (!targetSignature || normalizedTemplateSignature(session.strategyTemplate) === targetSignature);
    }) || null;
  }

  async function loadSession(sessionId) {
    const payload = await api('/api/training/sessions/' + encodeURIComponent(sessionId));
    const sessionContract = payload.session && payload.session.contractId
      ? state.contractMap.get(payload.session.contractId)
      : null;
    state.activeSession = payload.session;
    state.sessionTemplateDraft = payload.session && payload.session.strategyTemplate
      ? { ...payload.session.strategyTemplate }
      : defaultSessionTemplateForContract(sessionContract || activeContract());
    state.attempts = payload.attempts || [];
    state.latestAttempt = state.attempts.length ? state.attempts[state.attempts.length - 1] : null;
    const contractSelect = $('training-contract');
    if (contractSelect && payload.session && payload.session.contractId && state.contractMap.has(payload.session.contractId)) {
      contractSelect.value = payload.session.contractId;
      renderContractMeta();
    } else {
      renderAggregateStats();
    }
    renderSessionStats();
    renderAttempts();
    renderLatestAttempt();
    renderRecentSessions();
    renderSessionTemplate();
    renderTradeDeclaration();
    renderChart();
    if (state.latestAttempt && state.latestAttempt.resolution) {
      focusChartOnRevealedBars();
    }
    updateForwardGate();
  }

  async function startSession() {
    const contract = activeContract();
    if (!contract) throw new Error('Select a contract first.');
    const strategyTemplate = sanitizeSessionTemplateForContract(contract);
    const existingOpenSession = latestOpenSessionForContract(contract.id, strategyTemplate);
    if (existingOpenSession) {
      await loadSession(existingOpenSession.sessionId);
      setStatus('Resumed active session for ' + contract.name + '.', 'good');
      return;
    }
    const session = await api('/api/training/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ contractId: contract.id, strategyTemplate: strategyTemplate }),
    });
    state.activeSession = session;
    state.sessionTemplateDraft = session.strategyTemplate ? { ...session.strategyTemplate } : strategyTemplate;
    state.attempts = [];
    state.latestAttempt = null;
    state.validationDirty = true;
    state.lastValidationReady = false;
    state.semanticDraft = emptySemanticDraft();
    renderSessionStats();
    renderAttempts();
    renderLatestAttempt();
    renderSessionTemplate();
    renderTradeDeclaration();
    await loadSessions();
    setStatus('Training session started for ' + contract.name + '. ' + sessionTemplateSummary(strategyTemplate), 'good');
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

  async function loadBars(options) {
    if (typeof stopPlay === 'function') stopPlay();
    stopResolutionAnim();
    hideOutcomeBanner();
    const opts = options || {};
    const symbol = $('training-symbol').value.trim().toUpperCase();
    if (!symbol) throw new Error('Enter a symbol first.');
    const preservedReplayDate = opts.preserveReplayDate === false ? '' : (($('training-cutoff') && $('training-cutoff').value) || '');
    const preservedReplayMs = preservedReplayDate ? toUnixMillis(preservedReplayDate) : NaN;
    setStatus('Loading bars for ' + symbol + '...', null);
    const data = await api('/api/chart/ohlcv?symbol=' + encodeURIComponent(symbol) + '&interval=' + encodeURIComponent($('training-timeframe').value) + '&period=' + encodeURIComponent($('training-period').value));
    const nextBarsRaw = Array.isArray(data.chart_data) ? data.chart_data : [];
    const nextBars = window.SharedChartUtils && typeof window.SharedChartUtils.sanitizeChartData === 'function'
      ? window.SharedChartUtils.sanitizeChartData(nextBarsRaw)
      : nextBarsRaw;
    const earliestBarMs = nextBars.length ? barTimeMs(nextBars[0]) : NaN;
    const latestBarMs = nextBars.length ? barTimeMs(nextBars[nextBars.length - 1]) : NaN;
    const replayOutOfRange = Number.isFinite(preservedReplayMs)
      && Number.isFinite(earliestBarMs)
      && Number.isFinite(latestBarMs)
      && (preservedReplayMs < earliestBarMs || preservedReplayMs > latestBarMs);

    // requireReplayCoverage used to throw here, which blocked the user from
    // switching timeframe whenever the new timeframe's history didn't reach
    // back to their saved replay date (intraday timeframes like 4h/1h have far
    // less history than daily). We now clamp instead: nearestBarIndexForDate
    // returns the earliest/latest valid bar when the saved date falls outside
    // the new range, and we surface a non-fatal warning so the user knows the
    // replay anchor moved.
    let clampedReplayMessage = '';
    if (opts.requireReplayCoverage && replayOutOfRange && nextBars.length) {
      const clampedTo = preservedReplayMs < earliestBarMs
        ? toDateOnly(nextBars[0].time)
        : toDateOnly(nextBars[nextBars.length - 1].time);
      clampedReplayMessage =
        $('training-timeframe').value + ' history only covers ' +
        toDateOnly(nextBars[0].time) + ' to ' + toDateOnly(nextBars[nextBars.length - 1].time) +
        '. Replay anchor moved from ' + preservedReplayDate + ' to ' + clampedTo + '.';
    }

    state.fullBars = nextBars;

    const desiredCutoffIdx = preservedReplayDate
      ? nearestBarIndexForDate(preservedReplayDate)
      : cutoffIndexFromPreset($('training-scenario-offset').value);
    const cutoffTime = desiredCutoffIdx >= 0 && state.fullBars[desiredCutoffIdx] ? state.fullBars[desiredCutoffIdx].time : '';
    populateCutoffSelector(cutoffTime);
    setCutoffIndex(
      desiredCutoffIdx >= 0 ? desiredCutoffIdx : nearestBarIndexForDate(cutoffTime),
      {
        preserveDrawings: !!opts.preserveDrawings,
        focusMode: opts.focusMode || 'base',
      }
    );
    if (clampedReplayMessage) {
      setStatus(clampedReplayMessage, 'warn');
    } else {
      setStatus('Loaded ' + state.fullBars.length + ' bars for ' + symbol + '. Future bars are hidden until validation passes.', 'good');
    }
  }

  // Read the asset class chosen in the Browse dropdown (if any). When set to
  // anything other than "all", the random scenario picker is restricted to
  // that class so e.g. picking "Forex" + clicking Random gives you a random
  // forex pair instead of a random stock.
  function selectedBrowseAssetClass() {
    var sel = $('tm-browse-asset-class');
    if (!sel) return '';
    var v = String(sel.value || '').trim().toLowerCase();
    return (v === '' || v === 'all') ? '' : v;
  }

  function browseAssetClassLabel() {
    var sel = $('tm-browse-asset-class');
    if (!sel) return '';
    var opt = sel.options[sel.selectedIndex];
    return opt ? String(opt.text || '').replace(/\s*\(\d+\)$/, '') : '';
  }

  async function fetchSymbolPool(assetClass) {
    var key = String(assetClass || '').trim().toLowerCase();
    try {
      var data = await api('/api/candidates/symbols');
      // Caller-requested class wins.
      if (key && key !== 'all') {
        var classed = Array.isArray(data[key]) ? data[key] : [];
        if (classed.length) return classed;
        // Caller asked for a specific class but the library returned nothing —
        // fall back to "all" so Random still works rather than infinite-looping.
      }
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

  // Tracks recursion depth across retries so we don't loop forever when the
  // chosen asset class only has thinly-traded symbols.
  async function loadRandomScenario(options) {
    var opts = options || {};
    var attempts = Number.isFinite(opts._attempts) ? opts._attempts : 0;
    var MAX_ATTEMPTS = 8;
    var assetClass = selectedBrowseAssetClass();
    var classLabel = assetClass ? browseAssetClassLabel() : '';
    var classNote = classLabel ? ' (' + classLabel + ')' : '';

    setStatus('Picking a random' + classNote + ' scenario...', null);
    var pool = await fetchSymbolPool(assetClass);
    if (!pool.length) {
      setStatus('No symbols available' + classNote + '.', 'bad');
      return;
    }
    // Avoid retrying the same symbol back-to-back when the class is small.
    var symbol;
    var triedSet = opts._tried instanceof Set ? opts._tried : new Set();
    if (triedSet.size >= pool.length) {
      setStatus('No usable history found in any ' + (classLabel || 'pool') + ' symbol after ' + triedSet.size + ' tries.', 'bad');
      return;
    }
    do {
      symbol = pool[Math.floor(Math.random() * pool.length)];
    } while (triedSet.has(symbol) && triedSet.size < pool.length);
    triedSet.add(symbol);
    $('training-symbol').value = symbol;
    await loadBars({ preserveReplayDate: false });
    if (!state.fullBars.length || state.fullBars.length < 60) {
      if (attempts + 1 >= MAX_ATTEMPTS) {
        setStatus('Could not find enough history in ' + (classLabel || 'the pool') + ' after ' + (attempts + 1) + ' tries.', 'bad');
        return;
      }
      setStatus('Not enough data for ' + symbol + '. Trying another' + classNote + '...', null);
      return loadRandomScenario({ _attempts: attempts + 1, _tried: triedSet });
    }
    var minIdx = Math.max(60, Math.floor(state.fullBars.length * 0.15));
    var maxIdx = Math.floor(state.fullBars.length * 0.85);
    var randomIdx = minIdx + Math.floor(Math.random() * (maxIdx - minIdx));
    var randomTime = state.fullBars[randomIdx].time;
    // focusMode 'revealed' zooms the chart to the last ~120 bars and pads the
    // right with empty space, so the cutoff edge is visually obvious — i.e.
    // you can SEE that the future is hidden and you have to play/walk forward.
    setCutoffIndex(randomIdx, { focusMode: 'revealed' });
    setStatus('Random' + classNote + ' scenario: ' + symbol + ' at ' + toDateOnly(randomTime) + '. Press Play or step forward to advance.', 'good');
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
    stopResolutionAnim();
    hideOutcomeBanner();
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
    $('tp2-price').value = '';
    $('tp3-price').value = '';
    state.semanticDraft = emptySemanticDraft();
    state.latestAttempt = null;
    markValidationDirty();
    updateChartMeta();
    renderLatestAttempt();
    renderTradeDeclaration();
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
    if (isAnimatingResolution()) {
      stopResolutionAnim();
      const runBtn = $('btn-run-attempt');
      if (runBtn) { runBtn.textContent = 'Run Trade'; runBtn.disabled = true; runBtn.classList.add('opacity-50'); }
      setStatus('Resolution animation stopped.', 'good');
      return;
    }

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
    setStatus('Walking forward to resolution...', 'good');

    animateToResolution(result, function () {
      state.validationDirty = true;
      state.lastValidationReady = false;
      loadSession(result.session.sessionId).then(function () {
        renderLatestAttempt();
        renderAggregateStats();
      });

      $('entry-price').value = '';
      $('stop-price').value = '';
      $('tp-price').value = '';
      $('tp2-price').value = '';
      $('tp3-price').value = '';
      $('box-start').value = '';
      $('box-end').value = '';
      $('box-top').value = '';
      $('box-bottom').value = '';
      state.semanticDraft = emptySemanticDraft();
      if (state.drawingTools && typeof state.drawingTools.clear === 'function') {
        state.drawingTools.clear();
      }
      renderTradeDeclaration();
      updateChartMeta();
    });
  }

  function bindEvents() {
    const timeframeSelect = $('training-timeframe');
    const periodSelect = $('training-period');

    if (timeframeSelect) timeframeSelect.dataset.previous = timeframeSelect.value;
    if (periodSelect) periodSelect.dataset.previous = periodSelect.value;

    $('training-contract').addEventListener('change', function () {
      renderContractMeta();
      renderChecklist(null);
      markValidationDirty();
    });
    $('btn-training-long').addEventListener('click', function () { setDirection('long'); });
    $('btn-training-short').addEventListener('click', function () { setDirection('short'); });
    if ($('btn-chart-long')) $('btn-chart-long').addEventListener('click', function () { setDirection('long'); });
    if ($('btn-chart-short')) $('btn-chart-short').addEventListener('click', function () { setDirection('short'); });
    $('btn-start-session').addEventListener('click', function () {
      startSession().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('btn-end-session').addEventListener('click', function () {
      endSession().catch(function (error) { setStatus(error.message, 'bad'); });
    });
    $('btn-load-bars').addEventListener('click', function () {
      loadBars({ focusMode: 'revealed' }).catch(function (error) { setStatus(error.message, 'bad'); });
    });
    // Period/timeframe changes ask loadBars to keep the existing replay anchor
    // (requireReplayCoverage: true). loadBars now clamps the anchor to the new
    // range with a warning instead of rejecting, so we no longer revert the
    // selector on error — only true load failures will surface as bad status.
    $('training-period').addEventListener('change', function () {
      loadBars({ preserveDrawings: true, focusMode: 'revealed', requireReplayCoverage: true })
        .then(() => { this.dataset.previous = this.value; })
        .catch((error) => { setStatus(error.message, 'bad'); });
    });
    $('training-timeframe').addEventListener('change', function () {
      loadBars({ preserveDrawings: true, focusMode: 'revealed', requireReplayCoverage: true })
        .then(() => { this.dataset.previous = this.value; })
        .catch((error) => { setStatus(error.message, 'bad'); });
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
    $('btn-step-back').addEventListener('click', function () {
      stopPlay(); stopResolutionAnim(); hideOutcomeBanner();
      setStatus(stepReplay(-1) ? 'Stepped back one bar.' : 'Already at the first available bar.', 'good');
    });
    $('btn-step-forward').addEventListener('click', function () {
      stopPlay(); stopResolutionAnim(); hideOutcomeBanner();
      setStatus(stepReplay(1) ? 'Stepped forward one bar.' : 'Already at the latest hidden edge.', 'good');
    });
    $('btn-step-forward-5').addEventListener('click', function () {
      stopPlay(); stopResolutionAnim(); hideOutcomeBanner();
      setStatus(stepReplay(5) ? 'Stepped forward five bars.' : 'Already at the latest hidden edge.', 'good');
    });
    $('btn-step-to-trigger').addEventListener('click', function () {
      stopPlay(); stopResolutionAnim(); hideOutcomeBanner();
      const result = stepReplayToFibTrigger();
      setStatus(result.message, result.ok ? 'good' : 'bad');
    });
    $('btn-step-to-end').addEventListener('click', function () {
      stopPlay(); stopResolutionAnim(); hideOutcomeBanner();
      setStatus(jumpReplayToEnd() ? 'Jumped to the end of the replay.' : 'Already at the end of the replay.', 'good');
    });
    var playFwdBtn = $('btn-play-forward');
    if (playFwdBtn) playFwdBtn.addEventListener('click', togglePlayForward);
    var playRevBtn = $('btn-play-backward');
    if (playRevBtn) playRevBtn.addEventListener('click', togglePlayBackward);
    var speedSel = $('replay-speed');
    if (speedSel) speedSel.addEventListener('change', function () {
      // If we're playing, restart the timer at the new cadence so the change
      // takes effect immediately rather than after the next tick.
      if (isPlaying()) {
        var dir = state.playDirection;
        stopPlay();
        startPlay(dir);
      }
    });
    $('btn-fit-chart').addEventListener('click', fitChartToContent);
    $('btn-clear-training').addEventListener('click', clearTrainingChart);
    $('btn-marker-entry').addEventListener('click', function () { setMarkerMode('entry'); });
    $('btn-marker-stop').addEventListener('click', function () { setMarkerMode('stop'); });
    $('btn-marker-tp').addEventListener('click', function () { setMarkerMode('takeProfit'); });
    if ($('btn-marker-tp2')) $('btn-marker-tp2').addEventListener('click', function () { setMarkerMode('takeProfit2'); });
    if ($('btn-marker-tp3')) $('btn-marker-tp3').addEventListener('click', function () { setMarkerMode('takeProfit3'); });
    $('btn-seed-levels').addEventListener('click', function () {
      if (contractRequiresDrawingType('fib')) {
        seedLevelsFromFib();
        validateAttempt().then(function (validation) {
          if (validation.ready) {
            return runAttempt();
          }
        }).catch(function (error) { setStatus(error.message, 'bad'); });
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
    [
      ['session-family', 'family'],
      ['session-variant', 'strategyVariant'],
      ['session-entry-model', 'entryModel'],
      ['session-confidence', 'confidence'],
      ['semantic-setup-family', 'setupFamily'],
      ['semantic-confidence', 'confidence'],
      ['semantic-thesis', 'thesis'],
      ['semantic-invalidation', 'invalidation'],
      ['semantic-management-plan', 'managementPlan'],
    ].forEach(function (item) {
      var el = $(item[0]);
      if (!el) return;
      el.addEventListener('change', function () {
        if (item[0].indexOf('session-') === 0) {
          if (sessionTemplateLocked()) return;
          state.sessionTemplateDraft = state.sessionTemplateDraft || defaultSessionTemplateForContract(activeContract());
          state.sessionTemplateDraft[item[1]] = String(el.value || '').trim();
          if (item[1] === 'family') {
            var targetContractId = FAMILY_TO_CONTRACT[el.value];
            if (targetContractId && state.contractMap && state.contractMap.has(targetContractId)) {
              var contractSelect = $('training-contract');
              if (contractSelect && contractSelect.value !== targetContractId) {
                contractSelect.value = targetContractId;
              }
            }
            sanitizeSessionTemplateForContract(activeContract());
          }
          renderSessionTemplate();
          renderTradeDeclaration();
          return;
        }
        state.semanticDraft[item[1]] = String(el.value || '').trim();
        markValidationDirty();
      });
      if (el.tagName === 'TEXTAREA') {
        el.addEventListener('input', function () {
          state.semanticDraft[item[1]] = String(el.value || '').trim();
          markValidationDirty();
        });
      }
    });
    ['session-retracement', 'session-stop-atr', 'session-target-r'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (sessionTemplateLocked()) return;
        state.sessionTemplateDraft = state.sessionTemplateDraft || defaultSessionTemplateForContract(activeContract());
        if (id === 'session-retracement') state.sessionTemplateDraft.retracementPct = Number(el.value || 78.6);
        if (id === 'session-stop-atr') state.sessionTemplateDraft.stopAtrMultiple = Number(el.value || 2);
        if (id === 'session-target-r') state.sessionTemplateDraft.targetRMultiple = Number(el.value || 2);
        renderSessionTemplate();
      });
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
        loadBars({ focusMode: 'revealed' }).catch(function (error) { setStatus(error.message, 'bad'); });
      }
    });
    $('btn-randomize').addEventListener('click', function () {
      loadRandomScenario().catch(function (error) { setStatus(error.message, 'bad'); });
    });
  }

  // Keep the Random button's tooltip in sync with the Browse asset-class
  // dropdown so it's obvious that picking e.g. "Forex" narrows the random
  // scenario to that class. Also nudges the status line when the dropdown
  // changes so the user gets immediate feedback that the filter took effect.
  function refreshRandomButtonHint(silent) {
    var btn = $('btn-randomize');
    var sel = $('tm-browse-asset-class');
    if (!btn || !sel) return;
    var cls = selectedBrowseAssetClass();
    var label = cls ? browseAssetClassLabel() : '';
    if (cls) {
      btn.title = 'Random ' + label + ' symbol & random date (filtered by Browse class)';
      if (!silent) setStatus('Random will now pick from ' + label + '.', null);
    } else {
      btn.title = 'Random symbol & random date';
      if (!silent) setStatus('Random will pick from all stocks.', null);
    }
  }

  async function init() {
    if (!$('training-chart')) return;
    try {
      ensureChart();
      bindEvents();
      var browseSel = $('tm-browse-asset-class');
      if (browseSel) {
        browseSel.addEventListener('change', function () { refreshRandomButtonHint(false); });
      }
      refreshRandomButtonHint(true);
      await loadContracts();
      await loadSessions();
      await loadRandomScenario();
      renderSessionStats();
      renderAttempts();
      renderLatestAttempt();
      updateMarkerButtons();
      updateForwardGate();
      updateReplayProgress();
      setStatus('Training module ready. Configure your session template and click Start Session.', 'good');
    } catch (error) {
      setStatus(error.message || String(error), 'bad');
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Browse-without-analysis hook: lets the Browse asset-class controller load
  // any symbol into the training chart without triggering a new session. We
  // mirror the same flow the manual "Go" button uses (loadBars + the timeframe
  // override) so indicator overlays and replay state stay consistent.
  window.tmLoadSymbol = async function tmLoadSymbol(symbol, options) {
    const opts = options || {};
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    const symbolEl = $('training-symbol');
    if (symbolEl) symbolEl.value = sym;
    if (opts.interval) {
      const tfEl = $('training-timeframe');
      if (tfEl && tfEl.value !== opts.interval) {
        tfEl.value = opts.interval;
        tfEl.dataset.previous = opts.interval;
      }
    }
    await loadBars({ preserveReplayDate: false, focusMode: 'revealed' });
  };
})();
