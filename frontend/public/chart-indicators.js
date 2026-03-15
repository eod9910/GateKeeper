// ── Chart Indicators Module ──────────────────────────────────────────────
// Portable indicator system that can attach to ANY LightweightCharts instance.
// Requires: LightweightCharts (global)
//
// Usage:
//   ciBindToChart(myChart, myCandleSeries, { symbol: 'AAPL', interval: '1d' });
//   addChartIndicator('sma', { period: 20 });

// ── Chart context — allows binding to any chart instance ────────────────

let _ciContexts = new Map();  // contextId → { chart, series, symbol, interval, indicators, data, cachedSwing }
let _ciActiveContextId = 'default';

function _ciEnsureContext(id) {
  if (!_ciContexts.has(id)) {
    _ciContexts.set(id, {
      chart: null, series: null, symbol: '', interval: '1wk',
      indicators: [], data: [], cachedSwing: null,
      basePaneIndex: 0,
    });
  }
  return _ciContexts.get(id);
}

function _ciCtx() { return _ciEnsureContext(_ciActiveContextId); }

function ciBindToChart(chart, series, opts) {
  const id = (opts && opts.contextId) || 'ctx_' + Date.now();
  const ctx = _ciEnsureContext(id);
  ctx.chart = chart;
  ctx.series = series;
  ctx.symbol = (opts && opts.symbol) || '';
  ctx.interval = (opts && opts.interval) || '1d';
  _ciActiveContextId = id;
  return id;
}

function ciSetActiveContext(id) {
  _ciActiveContextId = id;
}

function ciUpdateContextMeta(symbol, interval) {
  const ctx = _ciCtx();
  if (symbol != null) ctx.symbol = symbol;
  if (interval != null) ctx.interval = interval;
}

// Backward-compatible getters — fall back to scanner globals if no context bound
function _ciGetChart() {
  const ctx = _ciCtx();
  if (ctx.chart) return ctx.chart;
  return (typeof patternChart !== 'undefined') ? patternChart : null;
}

function _ciGetSeries() {
  const ctx = _ciCtx();
  if (ctx.series) return ctx.series;
  return (typeof patternSeries !== 'undefined') ? patternSeries : null;
}

function _ciGetSymbol() {
  const ctx = _ciCtx();
  if (ctx.symbol) return ctx.symbol;
  if (typeof _chartCurrentSymbol !== 'undefined' && _chartCurrentSymbol) return _chartCurrentSymbol;
  const header = document.getElementById('chart-symbol');
  const txt = header ? String(header.textContent || '').trim() : '';
  if (txt) {
    const m = txt.match(/^([A-Z0-9._\-=^]+)/);
    if (m && m[1]) return m[1];
  }
  return '';
}

function _ciGetInterval() {
  const ctx = _ciCtx();
  // Scanner chart often runs without an explicit ciBindToChart context.
  // In that mode, always prefer the live chart interval global.
  if (!ctx.chart && typeof _chartCurrentInterval !== 'undefined' && _chartCurrentInterval) {
    return _chartCurrentInterval;
  }
  if (ctx.interval) return ctx.interval;
  if (typeof _chartCurrentInterval !== 'undefined' && _chartCurrentInterval) return _chartCurrentInterval;
  const intervalSel = document.getElementById('scan-interval');
  if (intervalSel && intervalSel.value) return intervalSel.value;
  return '1wk';
}

// ── Active indicator state (per-context) ────────────────────────────────

function _ciGetIndicators() { return _ciCtx().indicators; }
function _ciGetData() { return _ciCtx().data; }
function _ciSetData(d) { _ciCtx().data = d; }
function _ciGetCachedSwing() { return _ciCtx().cachedSwing; }
function _ciSetCachedSwing(d) { _ciCtx().cachedSwing = d; }

// Legacy aliases for backward compat with scanner page
let _activeIndicators = [];
let _chartIndicatorData = [];
let _ciCachedSwingData = null;
let _dynamicIndicators = {};

// Sync legacy globals ↔ context on access
function _ciSyncLegacyToCtx() {
  const ctx = _ciEnsureContext('default');
  if (!ctx.chart && typeof patternChart !== 'undefined') ctx.chart = patternChart;
  if (!ctx.series && typeof patternSeries !== 'undefined') ctx.series = patternSeries;
  ctx.indicators = _activeIndicators;
  ctx.data = _chartIndicatorData;
  ctx.cachedSwing = _ciCachedSwingData;
}
function _ciSyncCtxToLegacy() {
  const ctx = _ciEnsureContext('default');
  _activeIndicators = ctx.indicators;
  _chartIndicatorData = ctx.data;
  _ciCachedSwingData = ctx.cachedSwing;
}

// ── Indicator computation functions (pure: OHLCV in → data points out) ──

function _ciExtractCloses(chartData) {
  return chartData.map(b => b.close);
}

function computeSMA(chartData, period) {
  const closes = _ciExtractCloses(chartData);
  if (closes.length < period) return [];
  const result = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) {
      result.push({ time: chartData[i].time, value: sum / period });
    }
  }
  return result;
}

function computeEMA(chartData, period) {
  const closes = _ciExtractCloses(chartData);
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  const result = [{ time: chartData[period - 1].time, value: ema }];
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push({ time: chartData[i].time, value: ema });
  }
  return result;
}

function computeRSI(chartData, period) {
  const closes = _ciExtractCloses(chartData);
  if (closes.length < period + 1) return [];
  const result = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  const rs0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result.push({ time: chartData[period].time, value: rs0 });
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: chartData[i].time, value: Math.round(rsi * 100) / 100 });
  }
  return result;
}

function computeMACD(chartData, fast, slow, signal) {
  const emaFast = computeEMA(chartData, fast);
  const emaSlow = computeEMA(chartData, slow);
  if (emaFast.length === 0 || emaSlow.length === 0) return { macd: [], signal: [], histogram: [] };

  const slowStart = slow - fast;
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    const fastVal = emaFast[i + slowStart];
    if (!fastVal) continue;
    macdLine.push({ time: emaSlow[i].time, value: fastVal.value - emaSlow[i].value });
  }
  if (macdLine.length < signal) return { macd: macdLine, signal: [], histogram: [] };

  const k = 2 / (signal + 1);
  let sigEma = 0;
  for (let i = 0; i < signal; i++) sigEma += macdLine[i].value;
  sigEma /= signal;
  const sigLine = [{ time: macdLine[signal - 1].time, value: sigEma }];
  for (let i = signal; i < macdLine.length; i++) {
    sigEma = macdLine[i].value * k + sigEma * (1 - k);
    sigLine.push({ time: macdLine[i].time, value: sigEma });
  }

  const histogram = [];
  const offset = macdLine.length - sigLine.length;
  for (let i = 0; i < sigLine.length; i++) {
    histogram.push({ time: sigLine[i].time, value: macdLine[i + offset].value - sigLine[i].value });
  }
  return { macd: macdLine, signal: sigLine, histogram };
}

function computeBollinger(chartData, period, stdDev) {
  const closes = _ciExtractCloses(chartData);
  if (closes.length < period) return { upper: [], middle: [], lower: [] };
  const upper = [], middle = [], lower = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(sqSum / period) * stdDev;
    const t = chartData[i].time;
    upper.push({ time: t, value: mean + sd });
    middle.push({ time: t, value: mean });
    lower.push({ time: t, value: mean - sd });
  }
  return { upper, middle, lower };
}

// ── JS-computed structure indicators ────────────────────────────────────

function computeOrderBlocks(chartData, swingPoints) {
  if (!swingPoints || swingPoints.length < 2) return [];
  const timeIndex = new Map(chartData.map((b, i) => [JSON.stringify(b.time), i]));
  const blocks = [];

  for (let s = 1; s < swingPoints.length; s++) {
    const prev = swingPoints[s - 1];
    const curr = swingPoints[s];
    const prevIdx = timeIndex.get(JSON.stringify(prev.time));
    const currIdx = timeIndex.get(JSON.stringify(curr.time));
    if (prevIdx == null || currIdx == null || Math.abs(currIdx - prevIdx) < 2) continue;

    const isBullishLeg = (curr.position === 'aboveBar');
    const legStart = Math.min(prevIdx, currIdx);
    const legEnd = Math.max(prevIdx, currIdx);

    let obIdx = -1;
    if (isBullishLeg) {
      for (let j = legStart; j < legEnd; j++) {
        if (chartData[j].close < chartData[j].open) { obIdx = j; break; }
      }
    } else {
      for (let j = legStart; j < legEnd; j++) {
        if (chartData[j].close > chartData[j].open) { obIdx = j; break; }
      }
    }
    if (obIdx >= 0) {
      blocks.push({
        time: chartData[obIdx].time,
        high: chartData[obIdx].high,
        low: chartData[obIdx].low,
        bullish: isBullishLeg,
        position: isBullishLeg ? 'belowBar' : 'aboveBar',
      });
    }
  }
  return blocks;
}

function computeFVGs(chartData) {
  if (!chartData || chartData.length < 3) return [];
  const gaps = [];
  for (let i = 2; i < chartData.length; i++) {
    const prev = chartData[i - 2];
    const curr = chartData[i];
    if (curr.low > prev.high) {
      gaps.push({ time: chartData[i - 1].time, top: curr.low, bottom: prev.high, bullish: true });
    } else if (curr.high < prev.low) {
      gaps.push({ time: chartData[i - 1].time, top: prev.low, bottom: curr.high, bullish: false });
    }
  }
  return gaps;
}

function computeEnergy(chartData, lookbackParam) {
  const n = chartData.length;
  const lookback = lookbackParam > 0 ? lookbackParam : 14;
  const rangeLookback = lookback * 2;
  const minBars = lookback + rangeLookback + 5;
  if (n < minBars) return [];

  const closes = chartData.map(b => b.close);
  const highs = chartData.map(b => b.high);
  const lows = chartData.map(b => b.low);

  const result = [];
  for (let i = minBars; i < n; i++) {
    const velocityRaw = ((closes[i] - closes[i - lookback]) / closes[i - lookback]) * 100;

    let atrSum = 0;
    const atrLen = lookback * 2;
    const atrStart = Math.max(1, i - atrLen + 1);
    let atrCount = 0;
    for (let j = atrStart; j <= i; j++) {
      const tr = Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
      atrSum += tr;
      atrCount++;
    }
    const atr = atrCount > 0 ? atrSum / atrCount : 1;
    const velocityInAtrs = atr > 0 ? (velocityRaw / 100) * closes[i] / atr : 0;

    const prevVelocity = i >= lookback + 1
      ? ((closes[i - 1] - closes[i - 1 - lookback]) / closes[i - 1 - lookback]) * 100
      : velocityRaw;
    const accel = velocityRaw - prevVelocity;

    let currentRange = 0, peakRange = 0;
    for (let j = i - lookback + 1; j <= i; j++) currentRange += (highs[j] - lows[j]);
    currentRange /= lookback;
    for (let j = Math.max(0, i - rangeLookback + 1); j <= i; j++) {
      const r = highs[j] - lows[j];
      if (r > peakRange) peakRange = r;
    }
    const rangeCompression = peakRange > 0 ? 1 - (currentRange / peakRange) : 0;

    const absVelNorm = Math.abs(velocityInAtrs);
    const velScore = Math.min(absVelNorm / 2.0, 1.0) * 50;
    const compScore = (1 - rangeCompression) * 30;
    const accelScore = accel > 0 ? Math.min(Math.abs(accel) / 2, 1) * 20 : 0;
    const energyScore = Math.min(100, Math.max(0, velScore + compScore + accelScore));

    result.push({ time: chartData[i].time, value: Math.round(energyScore * 10) / 10 });
  }
  return result;
}

function computeEnergyMomentum(chartData, lookbackParam) {
  const energyData = computeEnergy(chartData, lookbackParam);
  if (energyData.length < 6) return { line: [], histogram: [] };

  const smoothLen = 5;
  const smoothed = [];
  for (let i = 0; i < energyData.length; i++) {
    if (i < smoothLen - 1) {
      smoothed.push(energyData[i].value);
    } else {
      let sum = 0;
      for (let j = i - smoothLen + 1; j <= i; j++) sum += energyData[j].value;
      smoothed.push(sum / smoothLen);
    }
  }

  const rocLen = 3;
  const line = [];
  const histogram = [];
  for (let i = rocLen; i < smoothed.length; i++) {
    const momentum = smoothed[i] - smoothed[i - rocLen];
    const val = Math.round(momentum * 10) / 10;
    line.push({ time: energyData[i].time, value: val });
    histogram.push({ time: energyData[i].time, value: val });
  }
  return { line, histogram };
}

// ── Indicator registry ──────────────────────────────────────────────────

const CHART_INDICATORS = {
  // ── Technical Indicators (JS-computed) ──
  sma: {
    name: 'SMA',
    category: 'technical',
    panel: 'overlay',
    defaults: { period: 20 },
    params: [{ key: 'period', label: 'Period', type: 'int', min: 2, max: 500, default: 20 }],
    colors: ['#2962FF'],
  },
  ema: {
    name: 'EMA',
    category: 'technical',
    panel: 'overlay',
    defaults: { period: 20 },
    params: [{ key: 'period', label: 'Period', type: 'int', min: 2, max: 500, default: 20 }],
    colors: ['#ff6d00'],
  },
  rsi: {
    name: 'RSI',
    category: 'technical',
    panel: 'sub',
    defaults: { period: 14 },
    params: [{ key: 'period', label: 'Period', type: 'int', min: 2, max: 100, default: 14 }],
    colors: ['#ab47bc'],
    hlines: [
      { value: 70, color: '#ef4444', lineWidth: 1, lineStyle: 2, label: 'Overbought' },
      { value: 30, color: '#22c55e', lineWidth: 1, lineStyle: 2, label: 'Oversold' },
      { value: 50, color: '#6b7280', lineWidth: 1, lineStyle: 2, label: '', axisLabel: false },
    ],
    paneHeight: 150,
  },
  macd: {
    name: 'MACD',
    category: 'technical',
    panel: 'sub',
    defaults: { fast: 12, slow: 26, signal: 9 },
    params: [
      { key: 'fast', label: 'Fast', type: 'int', min: 2, max: 100, default: 12 },
      { key: 'slow', label: 'Slow', type: 'int', min: 2, max: 200, default: 26 },
      { key: 'signal', label: 'Signal', type: 'int', min: 2, max: 100, default: 9 },
    ],
    colors: ['#2962FF', '#ff6d00'],
    paneHeight: 150,
  },
  bollinger: {
    name: 'Bollinger Bands',
    category: 'technical',
    panel: 'overlay',
    defaults: { period: 20, stdDev: 2 },
    params: [
      { key: 'period', label: 'Period', type: 'int', min: 2, max: 200, default: 20 },
      { key: 'stdDev', label: 'Std Dev', type: 'float', min: 0.5, max: 5, default: 2 },
    ],
    colors: ['#2962FF', '#2962FF', '#2962FF'],
  },

  // ── Structure Indicators (backend-computed) ──
  swing: {
    name: 'Swing Structure (Unified)',
    category: 'structure',
    panel: 'markers',
    backend: true,
    pluginId: 'unified_swing',
    defaults: {},
    params: [],
    colors: ['#f59e0b'],
  },
  rdpSwing: {
    name: 'RDP Swing Points',
    category: 'structure',
    panel: 'markers',
    backend: true,
    needsSwing: true,
    pluginId: 'rdp_energy_swing_detector_v1_primitive',
    // For chart diagnostics we want epsilon to behave deterministically:
    // - use_exact_epsilon=true so slider changes map directly to structure granularity
    // - require_energy=false so points are not hidden by energy-state filtering
    defaults: { epsilon_pct: 0.05, use_exact_epsilon: true, require_energy: false },
    params: [
      { key: 'epsilon_pct', label: 'Epsilon %', type: 'float', min: 0.005, max: 0.2, step: 0.005, default: 0.05 },
      { key: 'use_exact_epsilon', label: 'Use Exact Epsilon', type: 'bool', default: true },
      { key: 'require_energy', label: 'Require Energy Filter', type: 'bool', default: false },
    ],
    colors: ['#10b981'],
  },
  regressionChannel: {
    name: 'Regression Channel',
    category: 'structure',
    panel: 'markers',
    backend: true,
    pluginId: 'regression_channel_primitive',
    defaults: {},
    params: [],
    colors: ['#f59e0b'],
  },
  energy: {
    name: 'Energy State',
    category: 'structure',
    panel: 'sub',
    defaults: { lookback: 0 },
    params: [],
    colors: ['#f59e0b'],
    hlines: [
      { value: 70, color: '#22c55e', lineWidth: 1, lineStyle: 2, label: 'Strong' },
      { value: 30, color: '#ef4444', lineWidth: 1, lineStyle: 2, label: 'Exhausted' },
      { value: 50, color: '#6b7280', lineWidth: 1, lineStyle: 2, label: '', axisLabel: false },
    ],
    paneHeight: 150,
  },
  energyMomentum: {
    name: 'Energy Momentum',
    category: 'structure',
    panel: 'sub',
    defaults: { lookback: 0 },
    params: [],
    colors: ['#8b5cf6'],
    hlines: [
      { value: 0, color: '#6b7280', lineWidth: 1, lineStyle: 2, label: 'Zero' },
    ],
    paneHeight: 150,
  },

  regime: {
    name: 'Regime Filter (Trend)',
    category: 'structure',
    panel: 'markers',
    backend: true,
    pluginId: 'regime_filter',
    defaults: { epsilon_pct: 0.03, majority_pct: 0.6 },
    params: [
      { key: 'epsilon_pct', label: 'Epsilon %', type: 'float', min: 0.005, max: 0.15, step: 0.005, default: 0.03 },
      { key: 'majority_pct', label: 'Majority %', type: 'float', min: 0.5, max: 0.9, step: 0.05, default: 0.6 },
    ],
    colors: ['#22c55e', '#ef4444'],
  },
  macdHistogram: {
    name: 'MACD Histogram',
    category: 'structure',
    panel: 'sub',
    backend: true,
    pluginId: 'macd_histogram',
    defaults: {},
    params: [],
    colors: ['#26a69a', '#ef5350'],
    paneHeight: 150,
  },

  // ── Visual Composites (structure + derived, backend-computed) ──
  compositeFib: {
    name: 'Composite Fib',
    category: 'visual_composite',
    panel: 'markers',
    backend: true,
    needsSwing: true,
    pluginId: 'fib_location_primitive',
    defaults: {},
    params: [],
    colors: ['#f59e0b'],
  },
  orderBlocks: {
    name: 'Order Blocks',
    category: 'visual_composite',
    panel: 'markers',
    needsSwing: true,
    defaults: {},
    params: [],
    colors: ['#10b981'],
  },
  fvg: {
    name: 'Fair Value Gaps',
    category: 'visual_composite',
    panel: 'markers',
    defaults: {},
    params: [],
    colors: ['#a855f7'],
  },
};

// ── Merged registry lookup ──────────────────────────────────────────────

function _ciGetDef(type) {
  return CHART_INDICATORS[type] || _dynamicIndicators[type] || null;
}

function _ciAllIndicators() {
  return { ...CHART_INDICATORS, ..._dynamicIndicators };
}

async function refreshDynamicIndicators() {
  try {
    const resp = await fetch('/api/plugins/chart-indicators');
    if (!resp.ok) return;
    const json = await resp.json();
    if (!json?.success || !Array.isArray(json.data)) return;
    const incoming = {};
    for (const item of json.data) {
      if (CHART_INDICATORS[item.id]) continue;
      incoming[item.id] = {
        name: item.name,
        category: item.category || 'user_composite',
        panel: 'markers',
        backend: true,
        pluginId: item.pluginId || item.id,
        defaults: {},
        params: [],
        colors: item.colors || ['#6366f1'],
      };
    }
    _dynamicIndicators = incoming;
    _ciPopulateIndicatorSelect();
  } catch (e) {
    console.warn('Failed to fetch dynamic indicators:', e);
  }
}

// ── Rendering ───────────────────────────────────────────────────────────

function _ciNextPaneIndex() {
  const ctx = _ciCtx();
  let maxPane = ctx.basePaneIndex || 0;
  for (const ind of ctx.indicators) {
    if (ind.paneIndex > maxPane) maxPane = ind.paneIndex;
  }
  if (typeof subPanelSeriesList !== 'undefined' && subPanelSeriesList.length > 0) {
    maxPane = Math.max(maxPane, subPanelSeriesList.length);
  }
  return maxPane + 1;
}

function _ciRenderTechnicalIndicator(ind, chartData) {
  if (!_ciGetChart()) return;
  const def = _ciGetDef(ind.type);
  if (!def) return;

  let computed;
  switch (ind.type) {
    case 'sma':
      computed = { lines: [computeSMA(chartData, ind.params.period)] };
      break;
    case 'ema':
      computed = { lines: [computeEMA(chartData, ind.params.period)] };
      break;
    case 'rsi':
      computed = { lines: [computeRSI(chartData, ind.params.period)] };
      break;
    case 'macd': {
      const m = computeMACD(chartData, ind.params.fast, ind.params.slow, ind.params.signal);
      computed = { lines: [m.macd, m.signal], histogram: m.histogram };
      break;
    }
    case 'bollinger': {
      const b = computeBollinger(chartData, ind.params.period, ind.params.stdDev);
      computed = { lines: [b.upper, b.middle, b.lower] };
      break;
    }
    case 'energy': {
      const energyData = computeEnergy(chartData, ind.params.lookback || 0);
      computed = { lines: [energyData] };
      break;
    }
    case 'energyMomentum': {
      const em = computeEnergyMomentum(chartData, ind.params.lookback || 0);
      computed = { lines: [em.line], histogram: em.histogram };
      break;
    }
    default:
      return;
  }

  const paneIndex = def.panel === 'sub' ? ind.paneIndex : 0;
  const seriesRefs = [];
  const colors = def.colors || ['#2962FF'];
  const labels = ind.type === 'macd' ? ['MACD', 'Signal'] :
                 ind.type === 'bollinger' ? ['Upper', 'SMA', 'Lower'] :
                 [`${def.name}(${ind.params.period || ''})`];

  for (let i = 0; i < computed.lines.length; i++) {
    const lineData = computed.lines[i];
    if (!lineData || lineData.length === 0) continue;

    const opts = {
      color: colors[i % colors.length],
      lineWidth: (ind.type === 'bollinger' && i !== 1) ? 1 : 2,
      lineStyle: (ind.type === 'bollinger' && i !== 1) ? 2 : 0,
      title: labels[i] || '',
      priceLineVisible: false,
      lastValueVisible: i === 0,
      priceScaleId: paneIndex > 0 ? 'right' : undefined,
    };

    try {
      const s = paneIndex > 0
        ? _ciGetChart().addSeries(LightweightCharts.LineSeries, opts, paneIndex)
        : _ciGetChart().addSeries(LightweightCharts.LineSeries, opts);
      s.setData(lineData);
      seriesRefs.push(s);
    } catch (e) {
      console.error('[CI] addSeries FAILED for', ind.type, ':', e);
    }
  }

  if (computed.histogram && computed.histogram.length > 0) {
    const histData = computed.histogram.map(d => ({
      time: d.time,
      value: d.value,
      color: d.value >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)',
    }));
    const hs = _ciGetChart().addSeries(LightweightCharts.HistogramSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
    }, paneIndex);
    hs.setData(histData);
    seriesRefs.push(hs);
  }

  if (def.hlines && seriesRefs.length > 0 && paneIndex > 0) {
    for (const hl of def.hlines) {
      seriesRefs[0].createPriceLine({
        price: hl.value,
        color: hl.color || '#6b7280',
        lineWidth: hl.lineWidth || 1,
        lineStyle: hl.lineStyle != null ? hl.lineStyle : 2,
        axisLabelVisible: hl.axisLabel !== false,
        title: hl.label || '',
      });
    }
  }

  if (paneIndex > 0 && def.paneHeight && _ciGetChart().panes) {
    try {
      const panes = _ciGetChart().panes();
      if (panes[paneIndex]) panes[paneIndex].setHeight(def.paneHeight);
    } catch (e) {}
  }

  ind.seriesRefs = seriesRefs;
}

// ── Backend indicator fetch ─────────────────────────────────────────────

async function _ciFetchBackendIndicator(pluginId, symbol, interval, pluginParams) {
  try {
    const periodMap = { '1mo': 'max', '1wk': 'max', '1d': 'max', '4h': '730d', '1h': '730d', '15m': '60d', '5m': '60d', '1m': '7d' };
    const period = periodMap[interval] || 'max';
    const timeframeMap = { '1mo': 'M', '1wk': 'W', '1d': 'D', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m', '1m': '1m' };
    const timeframe = timeframeMap[interval] || 'D';
    const body = { symbol, pluginId, interval: interval || '1wk', period, timeframe };
    if (pluginParams && Object.keys(pluginParams).length > 0) {
      body.pluginParams = pluginParams;
    }
    const visibleData = _ciGetData();
    if (visibleData && visibleData.length > 0) {
      const first = visibleData[0].time;
      const last = visibleData[visibleData.length - 1].time;
      if (first != null) body.start_date = typeof first === 'number' ? first : String(first);
      if (last != null) body.end_date = typeof last === 'number' ? last : String(last);
    }
    const resp = await fetch('/api/candidates/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Scan failed: ${resp.status}`);
    const data = await resp.json();
    if (data?.success && data?.data?.candidates?.length > 0) {
      return data.data.candidates[0];
    }
    return null;
  } catch (e) {
    console.error('Backend indicator fetch failed:', e);
    return null;
  }
}

// ── Clip markers/overlays to visible data range ─────────────────────────

function _ciMarkerTimeMs(t) {
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (typeof t === 'object' && t && t.year != null) return new Date(t.year, (t.month || 1) - 1, t.day || 1).getTime();
  const ms = Date.parse(String(t));
  return Number.isFinite(ms) ? ms : NaN;
}

function _ciClipToVisibleRange(items) {
  const data = _ciGetData();
  if (!data || data.length === 0) return items;
  const first = _ciMarkerTimeMs(data[0].time);
  const last = _ciMarkerTimeMs(data[data.length - 1].time);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return items;
  return items.filter(m => {
    const t = _ciMarkerTimeMs(m.time);
    return Number.isFinite(t) && t >= first && t <= last;
  });
}

// ── Render swing structure markers on the chart ─────────────────────────

function _ciRenderSwingMarkers(ind, candidate) {
  if (!_ciGetChart() || !_ciGetSeries()) return;
  const markers = candidate?.visual?.markers || candidate?.markers || [];
  if (ind.markersPrimitive) {
    try { ind.markersPrimitive.setMarkers([]); } catch (e) {}
    try { _ciGetSeries().detachPrimitive(ind.markersPrimitive); } catch (e) {}
    ind.markersPrimitive = null;
  }
  if (markers.length === 0) return;

  const clipped = _ciClipToVisibleRange(markers);
  const sorted = [...clipped].sort((a, b) => {
    const ta = typeof a.time === 'object' ? new Date(a.time.year, a.time.month - 1, a.time.day).getTime() : a.time;
    const tb = typeof b.time === 'object' ? new Date(b.time.year, b.time.month - 1, b.time.day).getTime() : b.time;
    return ta - tb;
  });

  ind.markersPrimitive = LightweightCharts.createSeriesMarkers(_ciGetSeries(), sorted);
  ind.backendData = { markers: sorted, candidate };
  _ciUpdateBadges();
}

// ── Render Composite Fib (Swing + Fib levels) ──────────────────────────

async function _ciRenderCompositeFib(ind, chartData) {
  if (!_ciGetChart() || !_ciGetSeries()) return;
  const symbol = _ciGetSymbol();
  const interval = _ciGetInterval();
  if (!symbol) return;

  const ctx = _ciCtx();
  if (!ctx.cachedSwing) {
    ctx.cachedSwing = await _ciFetchBackendIndicator('unified_swing', symbol, interval);
  }

  const swingMarkers = ctx.cachedSwing?.visual?.markers || ctx.cachedSwing?.markers || [];
  if (swingMarkers.length > 0) {
    if (ind.markersPrimitive) {
      try { _ciGetSeries().detachPrimitive(ind.markersPrimitive); } catch (e) {}
    }
    const clippedSwing = _ciClipToVisibleRange(swingMarkers);
    const sorted = [...clippedSwing].sort((a, b) => {
      const ta = typeof a.time === 'object' ? new Date(a.time.year, a.time.month - 1, a.time.day).getTime() : a.time;
      const tb = typeof b.time === 'object' ? new Date(b.time.year, b.time.month - 1, b.time.day).getTime() : b.time;
      return ta - tb;
    });
    ind.markersPrimitive = LightweightCharts.createSeriesMarkers(_ciGetSeries(), sorted);
  }

  const fibCandidate = await _ciFetchBackendIndicator('fib_location_primitive', symbol, interval);
  const seriesRefs = [];

  if (fibCandidate) {
    const fibArray = fibCandidate?.fib_levels || fibCandidate?.visual?.fib_levels;
    if (Array.isArray(fibArray)) {
      _ciDrawFibLevelsFromArray(fibArray, chartData, seriesRefs);
    }

    const overlays = fibCandidate?.visual?.overlay_series || fibCandidate?.visual?.lines;
    if (Array.isArray(overlays)) {
      for (const line of overlays) {
        if (!line.data || line.data.length === 0) continue;
        const clippedLine = _ciClipToVisibleRange(line.data);
        if (clippedLine.length === 0) continue;
        try {
          const s = _ciGetChart().addSeries(LightweightCharts.LineSeries, {
            color: line.color || '#6366f1',
            lineWidth: line.lineWidth || 1,
            lineStyle: line.lineStyle || 2,
            title: line.title || '',
            priceLineVisible: false,
            lastValueVisible: false,
          });
          s.setData(clippedLine);
          seriesRefs.push(s);
        } catch (e) {}
      }
    }
  }

  ind.seriesRefs = seriesRefs;
  ind.backendData = { swingMarkers, fibCandidate };
}

function _ciDrawFibLevelsFromArray(fibArray, chartData, seriesRefs) {
  if (!_ciGetChart() || !chartData.length) return;
  const keyLevels = ['0%', '50%', '70%', '100%'];
  const startTime = chartData[0].time;
  const endTime = chartData[chartData.length - 1].time;

  for (const fib of fibArray) {
    const label = fib.label || fib.level || '';
    const price = fib.price || fib.value;
    if (price == null) continue;
    const isKey = keyLevels.some(k => label.includes(k));
    const numLevel = parseFloat(label) / 100;
    const color = fibLevelColor(numLevel);

    try {
      const s = _ciGetChart().addSeries(LightweightCharts.LineSeries, {
        color,
        lineWidth: isKey ? 2 : 1,
        lineStyle: isKey ? 0 : 2,
        title: label,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData([{ time: startTime, value: price }, { time: endTime, value: price }]);
      seriesRefs.push(s);
    } catch (e) {}
  }
}

function fibLevelColor(level) {
  if (isNaN(level)) return '#6b7280';
  if (level <= 0) return '#22c55e';
  if (level <= 0.382) return '#10b981';
  if (level <= 0.5) return '#f59e0b';
  if (level <= 0.618) return '#ef4444';
  if (level <= 0.786) return '#3b82f6';
  if (level >= 1.0) return '#6b7280';
  return '#a855f7';
}

// ── Render Order Blocks from swing data ─────────────────────────────────

function _ciRenderOrderBlocks(ind, chartData, swingMarkers) {
  if (!_ciGetChart() || !_ciGetSeries()) return;
  const blocks = computeOrderBlocks(chartData, swingMarkers);
  if (blocks.length === 0) return;

  const seriesRefs = [];
  const obMarkers = blocks.map(ob => ({
    time: ob.time,
    position: ob.position,
    shape: 'square',
    color: ob.bullish ? '#10b981' : '#ef4444',
    text: ob.bullish ? 'Bull OB' : 'Bear OB',
  }));

  const sorted = obMarkers.sort((a, b) => {
    const ta = typeof a.time === 'object' ? new Date(a.time.year, a.time.month - 1, a.time.day).getTime() : a.time;
    const tb = typeof b.time === 'object' ? new Date(b.time.year, b.time.month - 1, b.time.day).getTime() : b.time;
    return ta - tb;
  });

  ind.markersPrimitive = LightweightCharts.createSeriesMarkers(_ciGetSeries(), sorted);
  ind.seriesRefs = seriesRefs;
  ind.backendData = { blocks };
}

// ── Render Fair Value Gaps ──────────────────────────────────────────────

function _ciRenderFVGs(ind, chartData) {
  if (!_ciGetChart() || !_ciGetSeries()) return;
  const gaps = computeFVGs(chartData);
  if (gaps.length === 0) return;

  const markers = gaps.map(g => ({
    time: g.time,
    position: g.bullish ? 'belowBar' : 'aboveBar',
    shape: 'square',
    color: g.bullish ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)',
    text: g.bullish ? 'FVG↑' : 'FVG↓',
  }));

  const sorted = markers.sort((a, b) => {
    const ta = typeof a.time === 'object' ? new Date(a.time.year, a.time.month - 1, a.time.day).getTime() : a.time;
    const tb = typeof b.time === 'object' ? new Date(b.time.year, b.time.month - 1, b.time.day).getTime() : b.time;
    return ta - tb;
  });

  ind.markersPrimitive = LightweightCharts.createSeriesMarkers(_ciGetSeries(), sorted);
  ind.seriesRefs = [];
}

// ── Generic backend indicator render ────────────────────────────────────

async function _ciRenderGenericBackend(ind, def, symbol, interval, chartData) {
  const candidate = await _ciFetchBackendIndicator(def.pluginId, symbol, interval, ind.params);
  if (!candidate) return;

  const markers = candidate?.visual?.markers || candidate?.markers || [];
  if (markers.length > 0) {
    const clipped = _ciClipToVisibleRange(markers);
    const sorted = [...clipped].sort((a, b) => {
      const ta = typeof a.time === 'object' ? new Date(a.time.year, a.time.month - 1, a.time.day).getTime() : a.time;
      const tb = typeof b.time === 'object' ? new Date(b.time.year, b.time.month - 1, b.time.day).getTime() : b.time;
      return ta - tb;
    });
    ind.markersPrimitive = LightweightCharts.createSeriesMarkers(_ciGetSeries(), sorted);
  }

  const chart = _ciGetChart();
  const seriesRefs = [];
  const overlays = candidate?.visual?.overlay_series || candidate?.visual?.lines || [];
  if (Array.isArray(overlays)) {
    for (const panel of overlays) {
      if (Array.isArray(panel.lines)) {
        const paneIndex = panel.pane === 'sub' ? _ciNextPaneIndex() : 0;
        for (const line of panel.lines) {
          if (!line.data || line.data.length === 0) continue;
          line.data = _ciClipToVisibleRange(line.data);
          const isHist = line.seriesType === 'histogram';
          const SeriesType = isHist ? LightweightCharts.HistogramSeries : LightweightCharts.LineSeries;
          const opts = isHist
            ? { color: line.color || '#6b7280', title: line.title || '', priceLineVisible: false, lastValueVisible: false }
            : { color: line.color || def.colors?.[0] || '#6366f1', lineWidth: line.lineWidth || 2, title: line.title || '', priceLineVisible: false, lastValueVisible: true };
          try {
            const s = paneIndex > 0
              ? chart.addSeries(SeriesType, opts, paneIndex)
              : chart.addSeries(SeriesType, opts);
            s.setData(line.data);
            seriesRefs.push(s);
          } catch (e) {}
        }
        continue;
      }

      if (!panel.data || panel.data.length === 0) continue;
      const clippedPanelData = _ciClipToVisibleRange(panel.data);
      if (clippedPanelData.length === 0) continue;
      const paneIndex = panel.pane === 'sub' ? _ciNextPaneIndex() : 0;
      try {
        const s = paneIndex > 0
          ? chart.addSeries(LightweightCharts.LineSeries, {
              color: panel.color || def.colors?.[0] || '#6366f1',
              lineWidth: panel.lineWidth || 2,
              title: panel.title || '',
              priceLineVisible: false,
              lastValueVisible: true,
            }, paneIndex)
          : chart.addSeries(LightweightCharts.LineSeries, {
              color: panel.color || def.colors?.[0] || '#6366f1',
              lineWidth: panel.lineWidth || 2,
              title: panel.title || '',
              priceLineVisible: false,
              lastValueVisible: true,
            });
        s.setData(clippedPanelData);
        seriesRefs.push(s);
      } catch (e) {}
    }
  }

  ind.seriesRefs = seriesRefs;
  ind.backendData = candidate;
  _ciUpdateBadges();
}

// ── Unified render dispatch ─────────────────────────────────────────────

async function _ciRenderIndicator(ind, chartData) {
  if (!_ciGetChart()) return;
  ind._removed = false;
  ind._renderToken = (ind._renderToken || 0) + 1;
  const renderToken = ind._renderToken;
  const def = _ciGetDef(ind.type);
  if (!def) return;
  // Ensure new defaults are backfilled for already-active indicators.
  ind.params = { ...(def.defaults || {}), ...(ind.params || {}) };

  if (def.category === 'technical' || (!def.backend && !def.needsSwing && def.category !== 'visual_composite')) {
    _ciRenderTechnicalIndicator(ind, chartData);
    return;
  }

  if (ind.type === 'fvg') {
    _ciRenderFVGs(ind, chartData);
    return;
  }

  const symbol = _ciGetSymbol();
  const interval = _ciGetInterval();
  if (!symbol) {
    console.warn('Cannot render backend indicator without a symbol');
    return;
  }

  const ctx = _ciCtx();
  if (ind.type === 'swing' || ind.type === 'rdpSwing') {
    const candidate = await _ciFetchBackendIndicator(def.pluginId, symbol, interval, ind.params);
    if (renderToken !== ind._renderToken || ind._removed || !ctx.indicators.includes(ind)) return;
    if (candidate) {
      _ciRenderSwingMarkers(ind, candidate);
      if (ind.type === 'swing') ctx.cachedSwing = candidate;
    }
    return;
  }

  if (ind.type === 'compositeFib') {
    await _ciRenderCompositeFib(ind, chartData);
    return;
  }

  if (ind.type === 'orderBlocks') {
    let swingMarkers = ctx.cachedSwing?.visual?.markers || ctx.cachedSwing?.markers;
    if (!swingMarkers) {
      const swingCandidate = await _ciFetchBackendIndicator('unified_swing', symbol, interval);
      if (swingCandidate) {
        ctx.cachedSwing = swingCandidate;
        swingMarkers = swingCandidate?.visual?.markers || swingCandidate?.markers;
      }
    }
    if (swingMarkers) {
      _ciRenderOrderBlocks(ind, chartData, swingMarkers);
    }
    return;
  }

  if (def.backend && def.pluginId) {
    await _ciRenderGenericBackend(ind, def, symbol, interval, chartData);
    return;
  }
}

// ── Remove indicator series from chart ──────────────────────────────────

function _ciRemoveIndicatorSeries(ind) {
  const chart = _ciGetChart();
  const series = _ciGetSeries();
  if (ind.seriesRefs && ind.seriesRefs.length > 0) {
    for (const s of ind.seriesRefs) {
      try { if (chart) chart.removeSeries(s); } catch (e) {}
    }
    ind.seriesRefs = [];
  }
  if (ind.markersPrimitive && series) {
    try { ind.markersPrimitive.setMarkers([]); } catch (e) {}
    try { series.detachPrimitive(ind.markersPrimitive); } catch (e) {}
    ind.markersPrimitive = null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

const _ciTimeframeEpsilon = {
  '1mo': 0.10,
  '1wk': 0.08,
  '1d':  0.05,
  '4h':  0.03,
  '1h':  0.02,
  '15m': 0.015,
  '5m':  0.01,
  '1m':  0.008,
};

function addChartIndicator(type, params) {
  const def = _ciGetDef(type);
  if (!def) { console.warn('Unknown indicator type:', type); return null; }

  const merged = { ...def.defaults, ...(params || {}) };
  if (merged.epsilon_pct != null && !params?.epsilon_pct) {
    const interval = _ciGetInterval();
    const autoEps = _ciTimeframeEpsilon[interval];
    if (autoEps != null) merged.epsilon_pct = autoEps;
  }
  const id = `${type}_${Date.now()}`;
  const paneIndex = def.panel === 'sub' ? _ciNextPaneIndex() : 0;

  const ctx = _ciCtx();
  const ind = { id, type, params: merged, seriesRefs: [], markersPrimitive: null, paneIndex, backendData: null, _removed: false, _renderToken: 0 };
  ctx.indicators.push(ind);

  _ciUpdateBadges();
  _ciPopulateIndicatorSelect();

  if (ctx.data.length > 0) {
    _ciRenderIndicator(ind, ctx.data);
  } else {
    const series = _ciGetSeries();
    if (series) {
      try {
        const extracted = series.data ? series.data() : [];
        if (extracted && extracted.length > 0) {
          ctx.data = extracted;
          _ciRenderIndicator(ind, ctx.data);
        }
      } catch (e) {
        console.warn('[CI] Failed to extract data from series:', e);
      }
    }
  }

  setTimeout(() => _ciUpdatePaneLabels(), 100);
  return id;
}

function removeChartIndicator(id) {
  const ctx = _ciCtx();
  const idx = ctx.indicators.findIndex(ind => ind.id === id);
  if (idx === -1) return;
  const ind = ctx.indicators[idx];
  ind._removed = true;
  ind._renderToken = (ind._renderToken || 0) + 1;
  _ciRemoveIndicatorSeries(ind);
  ctx.indicators.splice(idx, 1);
  if (ctx.indicators.findIndex(i => i.type === 'swing') === -1) {
    ctx.cachedSwing = null;
  }
  _ciUpdateBadges();
  _ciPopulateIndicatorSelect();
  setTimeout(() => _ciUpdatePaneLabels(), 100);
}

function removeAllChartIndicators() {
  const ctx = _ciCtx();
  for (const ind of ctx.indicators) {
    ind._removed = true;
    ind._renderToken = (ind._renderToken || 0) + 1;
    _ciRemoveIndicatorSeries(ind);
  }
  ctx.indicators = [];
  ctx.cachedSwing = null;
  _ciStopLabelTracking();
  document.querySelectorAll('.ci-pane-label').forEach(el => el.remove());
  _ciUpdateBadges();
  _ciPopulateIndicatorSelect();
}

function getActiveIndicators() {
  return _ciCtx().indicators.map(ind => ({
    id: ind.id,
    type: ind.type,
    name: _ciGetDef(ind.type)?.name || ind.type,
    params: { ...ind.params },
  }));
}

async function recomputeAllIndicators(chartData) {
  if (!chartData || chartData.length === 0) return;
  const ctx = _ciCtx();
  ctx.data = chartData;
  ctx.cachedSwing = null;

  const interval = _ciGetInterval();
  const autoEps = _ciTimeframeEpsilon[interval];
  for (const ind of ctx.indicators) {
    if (autoEps != null && ind.params?.epsilon_pct != null) {
      ind.params.epsilon_pct = autoEps;
    }
    _ciRemoveIndicatorSeries(ind);
  }

  let nextPane = 1;
  for (const ind of ctx.indicators) {
    const def = _ciGetDef(ind.type);
    if (def && def.panel === 'sub') {
      ind.paneIndex = nextPane++;
    }
  }

  for (const ind of ctx.indicators) {
    await _ciRenderIndicator(ind, chartData);
  }
}

// ── Indicator badges (active indicator labels on chart) ─────────────────

function _ciUpdateBadges() {
  const container = document.getElementById('chart-indicator-badges');
  if (!container) return;
  const indicators = _ciCtx().indicators;

  if (indicators.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = indicators.map(ind => {
    const def = _ciGetDef(ind.type);
    const hasParams = def?.params && def.params.length > 0;
    const paramStr = Object.keys(ind.params).length > 0 ? `(${Object.values(ind.params).join(',')})` : '';
    const swingCount = ind?.backendData?.candidate?.node_result?.features?.swing_count;
    const swingCountStr = Number.isFinite(swingCount) ? ` [${swingCount}]` : '';
    const label = `${def?.name || ind.type}${paramStr}${swingCountStr}`;
    const clickable = hasParams ? `onclick="_ciOpenSettings('${ind.id}')" style="cursor:pointer;color:${def?.colors?.[0] || '#fff'}"` : `style="color:${def?.colors?.[0] || '#fff'}"`;
    return `<span class="chart-indicator-badge" data-id="${ind.id}">
      <span ${clickable}>${label}</span>
      <span class="chart-indicator-badge-x" onclick="event.stopPropagation();removeChartIndicator('${ind.id}')">\u00d7</span>
    </span>`;
  }).join('');
}

// ── Indicator settings dialog ───────────────────────────────────────────

function _ciOpenSettings(indId) {
  const ctx = _ciCtx();
  const ind = ctx.indicators.find(i => i.id === indId);
  if (!ind) return;
  const def = _ciGetDef(ind.type);
  if (!def || !def.params || def.params.length === 0) return;

  let existing = document.getElementById('ci-settings-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'ci-settings-dialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  let fieldsHtml = '';
  for (const p of def.params) {
    const val = ind.params[p.key] != null ? ind.params[p.key] : p.default;
    if (p.type === 'float' || p.type === 'int') {
      const step = p.step || (p.type === 'int' ? 1 : 0.01);
      fieldsHtml += `
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:3px;">${p.label}</label>
          <input type="number" id="ci-set-${p.key}" value="${val}" min="${p.min || ''}" max="${p.max || ''}" step="${step}"
            style="width:100%;padding:6px 8px;background:#374151;border:1px solid #4b5563;border-radius:4px;color:#e5e7eb;font-size:13px;" />
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">${p.description || ''}</div>
        </div>`;
    } else if (p.type === 'select' || p.type === 'enum') {
      const opts = (p.options || []).map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
      fieldsHtml += `
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:3px;">${p.label}</label>
          <select id="ci-set-${p.key}" style="width:100%;padding:6px 8px;background:#374151;border:1px solid #4b5563;border-radius:4px;color:#e5e7eb;font-size:13px;">${opts}</select>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">${p.description || ''}</div>
        </div>`;
    } else if (p.type === 'bool') {
      fieldsHtml += `
        <div style="margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#9ca3af;">
            <input type="checkbox" id="ci-set-${p.key}" ${val ? 'checked' : ''} />
            ${p.label}
          </label>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">${p.description || ''}</div>
        </div>`;
    }
  }

  dialog.innerHTML = `
    <div style="background:#1f2937;border:1px solid #4b5563;border-radius:8px;padding:16px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:600;color:#e5e7eb;">${def.name} Settings</span>
        <span id="ci-settings-close" style="cursor:pointer;color:#9ca3af;font-size:18px;line-height:1;">\u00d7</span>
      </div>
      ${fieldsHtml}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="ci-settings-reset" style="padding:6px 14px;font-size:12px;background:#374151;border:1px solid #4b5563;border-radius:4px;color:#9ca3af;cursor:pointer;">Reset</button>
        <button id="ci-settings-apply" style="padding:6px 14px;font-size:12px;background:#2563eb;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:600;">Apply</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);

  dialog.querySelector('#ci-settings-close').onclick = () => dialog.remove();
  dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); };

  dialog.querySelector('#ci-settings-reset').onclick = () => {
    for (const p of def.params) {
      const el = document.getElementById(`ci-set-${p.key}`);
      if (!el) continue;
      if (p.type === 'bool') el.checked = !!p.default;
      else el.value = p.default;
    }
  };

  dialog.querySelector('#ci-settings-apply').onclick = () => {
    const newParams = {};
    for (const p of def.params) {
      const el = document.getElementById(`ci-set-${p.key}`);
      if (!el) continue;
      if (p.type === 'float') newParams[p.key] = parseFloat(el.value);
      else if (p.type === 'int') newParams[p.key] = parseInt(el.value, 10);
      else if (p.type === 'bool') newParams[p.key] = el.checked;
      else newParams[p.key] = el.value;
    }

    _ciRemoveIndicatorSeries(ind);
    ind.params = { ...ind.params, ...newParams };

    const chartData = ctx.data.length > 0 ? ctx.data : (() => {
      try { const s = _ciGetSeries(); return s?.data ? s.data() : []; } catch(e) { return []; }
    })();
    _ciRenderIndicator(ind, chartData);
    _ciUpdateBadges();
    setTimeout(() => _ciUpdatePaneLabels(), 100);

    dialog.remove();
  };
}


// ── Sub-panel pane labels (TradingView-style, top-left of each pane) ────

function _ciGetPanePositions() {
  const chartEl = _ciFindChartDomEl();
  if (!chartEl) return [];
  const overlay = document.getElementById('ci-pane-labels-overlay');
  if (!overlay) return [];
  const overlayRect = overlay.getBoundingClientRect();

  // Scan ALL canvases regardless of height so collapsed panes keep their index
  const canvases = Array.from(chartEl.querySelectorAll('canvas'));
  if (canvases.length === 0) return [];

  const measured = canvases
    .map(c => {
      const r = c.getBoundingClientRect();
      return { top: r.top - overlayRect.top, height: r.height };
    })
    .filter(c => c.height > 10);
  measured.sort((a, b) => a.top - b.top);

  // Group canvases at the same Y position (each pane has multiple canvases)
  const groups = [];
  for (const m of measured) {
    const existing = groups.find(g => Math.abs(g.top - m.top) < 10);
    if (existing) {
      existing.height = Math.max(existing.height, m.height);
    } else {
      groups.push({ top: m.top, height: m.height });
    }
  }
  return groups;
}

function _ciUpdatePaneLabels() {
  document.querySelectorAll('.ci-pane-label').forEach(el => el.remove());

  if (!_ciGetChart()) return;

  const subInds = _ciCtx().indicators
    .filter(ind => {
      const def = _ciGetDef(ind.type);
      return def && def.panel === 'sub' && ind.paneIndex > 0;
    })
    .sort((a, b) => a.paneIndex - b.paneIndex);
  if (subInds.length === 0) return;

  const overlay = document.getElementById('ci-pane-labels-overlay');
  if (!overlay) return;

  const panePositions = _ciGetPanePositions();
  const subPanePositions = panePositions.slice(1);

  for (let idx = 0; idx < subInds.length; idx++) {
    const ind = subInds[idx];
    const def = _ciGetDef(ind.type);
    if (!def) continue;

    const panePos = subPanePositions[idx];
    if (!panePos) continue;

    const label = document.createElement('div');
    label.className = 'ci-pane-label';
    label.style.cssText = `
      position:absolute; top:${panePos.top + 2}px; left:8px; z-index:100;
      display:flex; align-items:center; gap:6px; pointer-events:auto;
    `;

    label.innerHTML = `
      <span style="color:${def.colors?.[0] || '#fff'}; font-size:12px; font-weight:600;
        text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.9);">${def.name}</span>
    `;

    overlay.appendChild(label);
  }

  _ciStartLabelTracking();
}

// ── Live label repositioning (follows pane drag/resize) ─────────────────

let _ciLabelObserver = null;
let _ciLabelReposPending = false;

function _ciFindChartDomEl() {
  const chart = _ciGetChart();
  if (chart) {
    try { const el = chart.chartElement ? chart.chartElement() : null; if (el) return el; } catch (e) {}
  }
  return document.getElementById('pattern-chart') || document.getElementById('tb-chart-container');
}

function _ciStartLabelTracking() {
  if (_ciLabelObserver) return;
  const chartEl = _ciFindChartDomEl();
  if (!chartEl) return;

  _ciLabelObserver = new MutationObserver(() => {
    if (_ciLabelReposPending) return;
    const labels = document.querySelectorAll('.ci-pane-label');
    if (labels.length === 0) return;
    _ciLabelReposPending = true;
    requestAnimationFrame(() => {
      _ciRepositionLabels();
      _ciLabelReposPending = false;
    });
  });
  _ciLabelObserver.observe(chartEl, { attributes: true, childList: true, subtree: true });

  chartEl._ciPointerMove = () => {
    if (_ciLabelReposPending) return;
    _ciLabelReposPending = true;
    requestAnimationFrame(() => {
      _ciRepositionLabels();
      _ciLabelReposPending = false;
    });
  };
  chartEl.addEventListener('pointermove', chartEl._ciPointerMove);
}

function _ciStopLabelTracking() {
  if (_ciLabelObserver) {
    _ciLabelObserver.disconnect();
    _ciLabelObserver = null;
  }
  const chartEl = _ciFindChartDomEl();
  if (chartEl && chartEl._ciPointerMove) {
    chartEl.removeEventListener('pointermove', chartEl._ciPointerMove);
    delete chartEl._ciPointerMove;
  }
}

function _ciRepositionLabels() {
  const labels = document.querySelectorAll('.ci-pane-label');
  if (labels.length === 0) return;

  const subInds = _ciCtx().indicators
    .filter(ind => {
      const def = _ciGetDef(ind.type);
      return def && def.panel === 'sub' && ind.paneIndex > 0;
    })
    .sort((a, b) => a.paneIndex - b.paneIndex);

  const panePositions = _ciGetPanePositions();
  const subPanePositions = panePositions.slice(1);

  for (let idx = 0; idx < subInds.length; idx++) {
    const label = labels[idx];
    const panePos = subPanePositions[idx];
    if (label && panePos) {
      label.style.top = `${panePos.top + 2}px`;
    }
  }
}

// ── Indicator panel toggle UI ───────────────────────────────────────────

async function toggleIndicatorPanel() {
  const panel = document.getElementById('chart-indicator-panel');
  if (!panel) return;
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (wasHidden) {
    await refreshDynamicIndicators();
    _ciRenderIndicatorPanel();
  }
}

function _ciRenderIndicatorPanel() {
  const panel = document.getElementById('chart-indicator-panel');
  if (!panel) return;

  const allDefs = _ciAllIndicators();
  const activeTypes = new Set(_ciCtx().indicators.map(ind => ind.type));

  const categories = [
    { key: 'technical', label: 'Technical Indicators' },
    { key: 'structure', label: 'Structure Indicators' },
    { key: 'visual_composite', label: 'Visual Composites' },
    { key: 'user_composite', label: 'My Composites' },
  ];

  let html = '<div style="padding:8px 12px;border-bottom:1px solid #374151;font-weight:600;font-size:13px;color:#e5e7eb;">Chart Indicators</div>';

  for (const cat of categories) {
    const items = Object.entries(allDefs).filter(([, def]) => {
      if (cat.key === 'technical') return !def.category || def.category === 'technical';
      return def.category === cat.key;
    });
    if (items.length === 0) continue;

    html += `<div style="padding:6px 12px 2px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">${cat.label}</div>`;

    for (const [type, def] of items) {
      const isActive = activeTypes.has(type);
      const color = def.colors?.[0] || '#2962FF';

      html += `<div class="ci-panel-row" data-type="${type}">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
          <span style="font-size:13px;">${def.name}</span>
          ${def.backend ? '<span style="font-size:9px;color:#6b7280;margin-left:4px;">API</span>' : ''}
        </div>
        <button class="ci-toggle-btn ${isActive ? 'ci-active' : ''}" onclick="_ciToggleIndicator('${type}')" ${isActive ? 'data-loading="false"' : ''}>
          ${isActive ? 'ON' : 'OFF'}
        </button>
      </div>`;
    }
  }

  panel.innerHTML = html;
}

function _ciToggleIndicator(type) {
  const existing = _ciCtx().indicators.find(ind => ind.type === type);
  if (existing) {
    removeChartIndicator(existing.id);
  } else {
    addChartIndicator(type);
  }
  _ciRenderIndicatorPanel();
  _ciPopulateIndicatorSelect();
}

function _ciPopulateIndicatorSelect() {
  const sel = document.getElementById('chart-indicator-select');
  if (!sel) return;

  const allDefs = _ciAllIndicators();
  const activeTypes = new Set(_ciCtx().indicators.map(ind => ind.type));

  const categories = [
    { key: 'structure', label: 'Structure' },
    { key: 'technical', label: 'Technical' },
    { key: 'visual_composite', label: 'Visual Composites' },
    { key: 'user_composite', label: 'My Composites' },
  ];

  let html = '<option value="">-- Add / Remove --</option>';
  for (const cat of categories) {
    const items = Object.entries(allDefs).filter(([, def]) => {
      if (cat.key === 'technical') return !def.category || def.category === 'technical';
      return def.category === cat.key;
    });
    if (items.length === 0) continue;

    html += `<optgroup label="${cat.label}">`;
    for (const [type, def] of items) {
      const isActive = activeTypes.has(type);
      const prefix = isActive ? '\u2713 ' : '';
      html += `<option value="${type}">${prefix}${def.name}</option>`;
    }
    html += '</optgroup>';
  }
  sel.innerHTML = html;
}

// ── Phase D: Auto-enable chart indicators from scan results ─────────────

const _ciScanToIndicatorMap = {
  unified_swing: 'swing',
  fib_location_primitive: 'compositeFib',
  order_blocks: 'orderBlocks',
  fvg: 'fvg',
  order_blocks_primitive: 'orderBlocks',
  fvg_primitive: 'fvg',
};

function autoEnableIndicatorsFromScan(pluginId) {
  const type = _ciScanToIndicatorMap[pluginId];
  if (type && !_ciCtx().indicators.find(i => i.type === type)) {
    addChartIndicator(type);
  }
}
