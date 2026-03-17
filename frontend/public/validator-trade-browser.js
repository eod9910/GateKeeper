// =========================================================================
// validator-trade-browser.js — Trade Browser for the Validator
//
// After a backtest runs you have a list of trades with entry_bar_index,
// exit_bar_index, symbol, timeframe, entry/stop/exit prices, R-multiple.
// This module lets you page through every trade visually:
//   - Chart shows the price action at the time of the signal
//   - Vertical lines mark entry bar and exit bar
//   - Horizontal price lines mark entry price, stop, and exit
//   - Prev/Next navigation + All/Wins/Losses filter
//   - Compact trade list on the left for quick jumping
// =========================================================================

// ── State ─────────────────────────────────────────────────────────────────

let _tbAllTrades   = [];   // full trade list from /api/validator/reports/:id/trades
let _tbFiltered    = [];   // current filtered subset
let _tbIndex       = 0;   // current position in _tbFiltered
let _tbFilter      = 'all'; // 'all' | 'wins' | 'losses'
let _tbChart       = null; // LightweightCharts instance
let _tbCandleSeries = null;
let _tbRdpDivLineSeries   = null; // divergence line on MACD pane (created lazily)
let _tbRdpZigzagSeries    = null;
let _tbRdpPriceMarkers    = null;
let _tbEntryLine   = null;
let _tbStopLine    = null;
let _tbExitLine    = null;
let _tbMarkersRef  = null;
let _tbOhlcvCache  = {};   // key: "SYMBOL_timeframe" → full bars array
let _tbCurrentWindowBars = [];
let _tbReportId    = null;
let _tbCiContextId = null; // Chart Indicators context bound to this chart

// Bars of context to show before entry and after exit
const TB_BARS_BEFORE = 80;
const TB_BARS_AFTER  = 30;
const TB_CAUSAL_WINDOW = 1200; // must match backtestEngine.py's default causal_window_bars

// ── Entry point: open trade browser for a report ─────────────────────────

async function openTradeBrowser(reportId) {
  _tbReportId = reportId;
  _tbOhlcvCache = {};
  _tbAllTrades = [];
  _tbFiltered = [];
  _tbIndex = 0;

  // Show trade browser, hide report content
  const reportContent = document.getElementById('report-content');
  const browser = document.getElementById('trade-browser');
  if (reportContent) reportContent.style.display = 'none';
  if (browser) browser.classList.add('active');

  // Initialize chart if not yet created
  _tbInitChart();

  // Show loading state
  _tbSetChartLoading('Loading trades...');

  try {
    const resp = await fetch(`/api/validator/report/${reportId}/trades`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    _tbAllTrades = Array.isArray(json?.data) ? json.data : [];
  } catch (e) {
    console.error('Trade browser: failed to load trades', e);
    _tbSetChartLoading('Failed to load trades. ' + (e.message || ''));
    return;
  }

  if (_tbAllTrades.length === 0) {
    _tbSetChartLoading('No trades found for this report.');
    return;
  }

  _tbApplyFilter();
  _tbRenderList();
  await _tbShowTrade(0);
}

// ── Close: go back to the report view ────────────────────────────────────

function tbClose() {
  if (_tbCiContextId && typeof ciSetActiveContext === 'function') {
    ciSetActiveContext(_tbCiContextId);
    if (typeof removeAllChartIndicators === 'function') removeAllChartIndicators();
  }
  const reportContent = document.getElementById('report-content');
  const browser = document.getElementById('trade-browser');
  if (reportContent) reportContent.style.display = '';
  if (browser) browser.classList.remove('active');
}

// ── Filter ────────────────────────────────────────────────────────────────

function tbSetFilter(filter) {
  _tbFilter = filter;
  document.querySelectorAll('.tb-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tbf-${filter}`);
  if (btn) btn.classList.add('active');
  _tbApplyFilter();
  _tbRenderList();
  if (_tbFiltered.length > 0) _tbShowTrade(0);
  else _tbSetChartLoading('No trades match this filter.');
}

function _tbApplyFilter() {
  if (_tbFilter === 'wins') {
    _tbFiltered = _tbAllTrades.filter(t => (t.R_multiple || 0) > 0);
  } else if (_tbFilter === 'losses') {
    _tbFiltered = _tbAllTrades.filter(t => (t.R_multiple || 0) <= 0);
  } else {
    _tbFiltered = [..._tbAllTrades];
  }
  _tbIndex = 0;
}

// ── Navigation ────────────────────────────────────────────────────────────

function tbPrev() {
  if (_tbIndex > 0) _tbShowTrade(_tbIndex - 1);
}

function tbNext() {
  if (_tbIndex < _tbFiltered.length - 1) _tbShowTrade(_tbIndex + 1);
}

// ── Trade list sidebar ────────────────────────────────────────────────────

function _tbRenderList() {
  const container = document.getElementById('tb-list-items');
  const countEl = document.getElementById('tb-list-count');
  if (!container) return;
  if (countEl) countEl.textContent = String(_tbFiltered.length || 0);

  if (_tbFiltered.length === 0) {
    container.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--color-text-subtle);white-space:nowrap;">No trades</div>';
    return;
  }

  container.innerHTML = _tbFiltered.map((t, i) => {
    const r = typeof t.R_multiple === 'number' ? t.R_multiple : 0;
    const cls = r > 0 ? 'win' : r < 0 ? 'loss' : 'be';
    const sign = r > 0 ? '+' : '';
    const entryDate = t.entry_time ? String(t.entry_time).slice(0, 10) : 'N/A';
    const exitReason = t.exit_reason || '—';
    const timeframe = (t.timeframe || '').toUpperCase() || 'N/A';
    return `<div class="tb-chip${i === _tbIndex ? ' active' : ''}" onclick="_tbShowTrade(${i})" title="${entryDate}">
      <div class="tb-chip-main">
        <span class="tb-chip-sym">${t.symbol || '?'}</span>
        <span class="tb-chip-sub">${timeframe} · ${exitReason}</span>
      </div>
      <div class="tb-chip-side">
        <span class="tb-chip-r ${cls}">${sign}${r.toFixed(2)}R</span>
        <span class="tb-chip-date">${entryDate}</span>
      </div>
    </div>`;
  }).join('');
}

function _tbScrollListTo(index) {
  const container = document.getElementById('tb-list-items');
  if (!container) return;
  const chips = container.querySelectorAll('.tb-chip');
  chips.forEach((el, i) => el.classList.toggle('active', i === index));
  if (chips[index]) chips[index].scrollIntoView({ block: 'nearest' });
}

// ── Show a specific trade ─────────────────────────────────────────────────

async function _tbShowTrade(index) {
  if (_tbFiltered.length === 0) return;
  _tbIndex = Math.max(0, Math.min(index, _tbFiltered.length - 1));
  const trade = _tbFiltered[_tbIndex];

  // Update navigation controls
  const counter = document.getElementById('tb-counter');
  if (counter) counter.textContent = `${_tbIndex + 1} / ${_tbFiltered.length}`;
  const prevBtn = document.getElementById('tb-prev');
  const nextBtn = document.getElementById('tb-next');
  if (prevBtn) prevBtn.disabled = _tbIndex === 0;
  if (nextBtn) nextBtn.disabled = _tbIndex === _tbFiltered.length - 1;

  // Update header badge
  const r = typeof trade.R_multiple === 'number' ? trade.R_multiple : 0;
  const rClass = r > 0 ? 'win' : r < 0 ? 'loss' : 'be';
  const sign = r > 0 ? '+' : '';
  const symEl = document.getElementById('tb-symbol');
  const rBadge = document.getElementById('tb-r-badge');
  const detailStrip = document.getElementById('tb-detail-strip');
  if (symEl) symEl.textContent = `${trade.symbol || '?'} · ${(trade.timeframe || '').toUpperCase()}`;
  if (rBadge) {
    rBadge.textContent = `${sign}${r.toFixed(2)}R`;
    rBadge.className = `tb-r-badge ${rClass}`;
  }
  if (detailStrip) {
    detailStrip.textContent = `${trade.direction || 'long'} · ${trade.exit_reason || ''}`;
  }

  // Update stats strip
  _tbSetStat('tb-stat-entry', `$${_fmt(trade.entry_price)}`, '');
  _tbSetStat('tb-stat-stop',  `$${_fmt(trade.stop_price)}`,  'loss');
  _tbSetStat('tb-stat-exit',  `$${_fmt(trade.exit_price)}`,  r >= 0 ? 'win' : 'loss');
  _tbSetStat('tb-stat-reason', trade.exit_reason || '—', '');
  _tbSetStat('tb-stat-r', `${sign}${r.toFixed(2)}R`, rClass);

  // Update list highlight
  _tbScrollListTo(_tbIndex);

  // Load and render chart
  _tbSetChartLoading('Loading chart data...');
  try {
    const bars = await _tbFetchOhlcv(trade.symbol, trade.timeframe);
    _tbRenderChart(trade, bars);
  } catch (e) {
    console.error('Trade browser: chart load failed', e);
    _tbSetChartLoading('Chart data unavailable: ' + (e.message || ''));
  }
}

function _tbSetStat(id, value, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = `tb-stat-value${cls ? ' ' + cls : ''}`;
}

function _fmt(v) {
  return typeof v === 'number' ? v.toFixed(2) : '—';
}

// ── OHLCV fetch with caching ──────────────────────────────────────────────

async function _tbFetchOhlcv(symbol, timeframe) {
  const cacheKey = `${symbol}_${timeframe}`;
  if (_tbOhlcvCache[cacheKey]) return _tbOhlcvCache[cacheKey];

  // Map timeframe to yfinance interval and period
  const intervalMap = { '1wk': '1wk', '1d': '1d', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m' };
  const periodMap   = { '1wk': 'max', '1d': '10y', '4h': '730d', '1h': '730d', '15m': '60d', '5m': '60d' };
  const interval = intervalMap[timeframe] || timeframe || '1d';
  const period   = periodMap[timeframe] || '10y';

  const url = `/api/chart/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`OHLCV fetch failed: ${resp.status}`);
  const json = await resp.json();
  // The chart endpoint returns { success, chart_data: [...] } or wraps in data
  const bars = json?.chart_data || json?.data?.chart_data || json?.data || [];
  if (!Array.isArray(bars) || bars.length === 0) throw new Error('No OHLCV data returned');

  _tbOhlcvCache[cacheKey] = bars;
  return bars;
}

// ── MACD calculation ──────────────────────────────────────────────────────

function _tbCalcEMA(values, period) {
  const ema = new Array(values.length).fill(NaN);
  if (values.length < period) return ema;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function _tbCalcMACD(bars, fast, slow, signal) {
  const closes = bars.map(b => b.close || b.value || 0);
  const emaFast = _tbCalcEMA(closes, fast);
  const emaSlow = _tbCalcEMA(closes, slow);

  const macdLine = closes.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]
  );

  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalEma = _tbCalcEMA(validMacd, signal);

  const signalLine = new Array(macdLine.length).fill(NaN);
  let vi = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (!isNaN(macdLine[i])) {
      signalLine[i] = signalEma[vi];
      vi++;
    }
  }

  return bars.map((bar, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    const h = (!isNaN(m) && !isNaN(s)) ? m - s : NaN;
    return { time: bar.time, macd: m, signal: s, histogram: h };
  });
}

// ── RDP swing detection (client-side) ─────────────────────────────────────

function _tbPerpendicularDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / Math.sqrt(lenSq);
}

function _tbRdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const s = points[0], e = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = _tbPerpendicularDist(points[i][0], points[i][1], s[0], s[1], e[0], e[1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = _tbRdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = _tbRdpSimplify(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [s, e];
}

function _tbDetectRdpSwings(bars, epsilonPct) {
  if (bars.length < 10) return [];
  const closes = bars.map(b => b.close || 0);
  const hi = Math.max(...closes), lo = Math.min(...closes);
  const range = hi - lo || 1;

  // Normalize: x = index (scaled 0-1), y = close (scaled 0-1)
  const pts = closes.map((c, i) => [i / (bars.length - 1), (c - lo) / range]);
  const epsilon = epsilonPct;

  // Auto-adapt: binary search for epsilon that gives 6-16 swings
  let bestEps = epsilon, bestSwings = [];
  for (let e = 0.15; e >= 0.001; e /= 2) {
    const simplified = _tbRdpSimplify(pts, e);
    const indices = simplified.map(p => Math.round(p[0] * (bars.length - 1)));
    const swings = [];
    for (let k = 1; k < indices.length - 1; k++) {
      const prev = closes[indices[k - 1]], curr = closes[indices[k]], next = closes[indices[k + 1]];
      if (curr > prev && curr > next) {
        const idx = indices[k];
        let bestIdx = idx, bestHi = bars[idx].high || curr;
        for (let j = Math.max(0, indices[k-1]); j <= Math.min(bars.length-1, indices[k+1]); j++) {
          if ((bars[j].high || closes[j]) > bestHi) { bestHi = bars[j].high || closes[j]; bestIdx = j; }
        }
        swings.push({ idx: bestIdx, type: 'HIGH', price: bestHi });
      } else if (curr < prev && curr < next) {
        const idx = indices[k];
        let bestIdx = idx, bestLo = bars[idx].low || curr;
        for (let j = Math.max(0, indices[k-1]); j <= Math.min(bars.length-1, indices[k+1]); j++) {
          if ((bars[j].low || closes[j]) < bestLo) { bestLo = bars[j].low || closes[j]; bestIdx = j; }
        }
        swings.push({ idx: bestIdx, type: 'LOW', price: bestLo });
      }
    }
    if (swings.length >= 6 && swings.length <= 16) { bestSwings = swings; break; }
    if (swings.length > 16) { bestSwings = swings; break; }
    if (swings.length > bestSwings.length) bestSwings = swings;
  }
  return bestSwings;
}

// ── Chart initialization ──────────────────────────────────────────────────

function _tbInitChart() {
  const container = document.getElementById('tb-chart-container');
  if (!container || _tbChart) return;

  _tbChart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: '#0d1117' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#1f2937' },
      horzLines: { color: '#1f2937' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#374151' },
    timeScale: { borderColor: '#374151', timeVisible: true },
    handleScale: true,
    handleScroll: true,
  });

  _tbCandleSeries = _tbChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor:   '#22c55e',
    downColor: '#ef4444',
    borderUpColor:   '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor:   '#22c55e',
    wickDownColor: '#ef4444',
  });

  // RDP zigzag overlay on price pane
  _tbRdpZigzagSeries = _tbChart.addSeries(LightweightCharts.LineSeries, {
    color: '#facc15',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    pointMarkersVisible: true,
    pointMarkersRadius: 4,
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (_tbChart) _tbChart.resize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);

  // Bind portable chart indicator system to this chart
  if (typeof ciBindToChart === 'function') {
    _tbCiContextId = ciBindToChart(_tbChart, _tbCandleSeries, {
      contextId: 'trade-browser',
      symbol: '',
      interval: '1d',
    });
    _ciPopulateIndicatorSelect();
  }

  // Attach universal drawing tools module
  if (typeof DrawingToolsManager !== 'undefined') {
    if (window._validatorDrawingTools) window._validatorDrawingTools.destroy();
    window._validatorDrawingTools = new DrawingToolsManager(_tbChart, _tbCandleSeries, container, {
      getBars: () => Array.isArray(_tbCurrentWindowBars) ? _tbCurrentWindowBars : [],
    });
    const tbEl = document.getElementById('validator-dt-toolbar');
    if (tbEl) {
      DrawingToolsManager.attachToolbar(tbEl, 'tb-chart-container', window._validatorDrawingTools);
    }
  }
}

// ── Chart rendering ───────────────────────────────────────────────────────

function _tbFindBarByTime(allBars, timeStr) {
  if (!timeStr || !allBars.length) return -1;
  const target = timeStr.slice(0, 10); // "YYYY-MM-DD"
  for (let i = 0; i < allBars.length; i++) {
    const bt = allBars[i].time;
    let barDate;
    if (typeof bt === 'object' && bt.year) {
      barDate = `${bt.year}-${String(bt.month).padStart(2, '0')}-${String(bt.day).padStart(2, '0')}`;
    } else if (typeof bt === 'string') {
      barDate = bt.slice(0, 10);
    } else {
      continue;
    }
    if (barDate === target) return i;
  }
  return -1;
}

function _tbRenderChart(trade, allBars) {
  if (!_tbChart || !_tbCandleSeries) return;

  // Resolve bar indices by matching trade timestamps to chart data.
  // trade.entry_bar_index is relative to the backtest snapshot which may
  // have a different date range than the live chart data.
  let entryIdx = _tbFindBarByTime(allBars, trade.entry_time);
  let exitIdx  = _tbFindBarByTime(allBars, trade.exit_time);
  if (entryIdx < 0) entryIdx = trade.entry_bar_index || 0;
  if (exitIdx  < 0) exitIdx  = trade.exit_bar_index  || entryIdx;

  // Show a window: TB_BARS_BEFORE before entry through TB_BARS_AFTER after exit
  const windowStart = Math.max(0, entryIdx - TB_BARS_BEFORE);
  const windowEnd   = Math.min(allBars.length - 1, exitIdx + TB_BARS_AFTER);
  const windowBars  = allBars.slice(windowStart, windowEnd + 1);
  _tbCurrentWindowBars = windowBars;

  // Remove old price lines
  if (_tbEntryLine && _tbCandleSeries) {
    try { _tbCandleSeries.removePriceLine(_tbEntryLine); } catch (e) {}
  }
  if (_tbStopLine && _tbCandleSeries) {
    try { _tbCandleSeries.removePriceLine(_tbStopLine); } catch (e) {}
  }
  if (_tbExitLine && _tbCandleSeries) {
    try { _tbCandleSeries.removePriceLine(_tbExitLine); } catch (e) {}
  }
  _tbEntryLine = _tbStopLine = _tbExitLine = null;

  // Remove old markers
  if (_tbMarkersRef) {
    try { _tbMarkersRef.detach ? _tbMarkersRef.detach() : null; } catch (e) {}
    _tbMarkersRef = null;
  }

  // Set candle data
  _tbCandleSeries.setData(windowBars);
  _tbSetChartLoading(null); // hide loading overlay

  // ── RDP swing detection on visible window ────────────────────────────
  const rdpSwings = _tbDetectRdpSwings(windowBars, 0.05);

  // Compute MACD on the visible window (with lookback for EMA warmup)
  const macdLookback = 60;
  const macdStart = Math.max(0, windowStart - macdLookback);
  const macdBars = allBars.slice(macdStart, windowEnd + 1);
  const macdData = _tbCalcMACD(macdBars, 12, 26, 9);
  const macdOffset = windowStart - macdStart;
  const macdSlice = macdData.slice(macdOffset);

  // ── Find the CI-system MACD line series (if user added MACD from dropdown) ──
  let ciMacdLineSeries = null;
  if (_tbCiContextId && typeof _ciEnsureContext === 'function') {
    const ctx = _ciEnsureContext('trade-browser');
    const macdInd = ctx.indicators.find(i => i.type === 'macd');
    if (macdInd && macdInd.seriesRefs && macdInd.seriesRefs.length > 0) {
      ciMacdLineSeries = macdInd.seriesRefs[0]; // first series = MACD line
    }
  }

  // ── Causal-window RDP for divergence diagnostic ──────────────────────
  // Reconstructs what the strategy saw — project divergence line onto MACD
  const causalStart = Math.max(0, entryIdx - TB_CAUSAL_WINDOW);
  const causalEnd   = entryIdx;
  const causalBars  = allBars.slice(causalStart, causalEnd + 1);
  const rdpCausal   = _tbDetectRdpSwings(causalBars, 0.05);

  const causalMacdLB    = 60;
  const causalMacdStart = Math.max(0, causalStart - causalMacdLB);
  const causalMacdBars  = allBars.slice(causalMacdStart, causalEnd + 1);
  const causalMacdAll   = _tbCalcMACD(causalMacdBars, 12, 26, 9);
  const causalMacdOff   = causalStart - causalMacdStart;
  const causalMacdSlice = causalMacdAll.slice(causalMacdOff);

  // Map causal swings into visible window
  const causalSwingsVisible = [];
  for (const sw of rdpCausal) {
    const absIdx = causalStart + sw.idx;
    const winIdx = absIdx - windowStart;
    if (winIdx >= 0 && winIdx < windowBars.length) {
      causalSwingsVisible.push({ ...sw, winIdx, causalIdx: sw.idx });
    }
  }

  // Divergence line — lazily create on the MACD pane if MACD is active
  if (ciMacdLineSeries) {
    // Find pane index of the CI MACD
    let macdPaneIdx = 1;
    if (_tbCiContextId && typeof _ciEnsureContext === 'function') {
      const ctx = _ciEnsureContext('trade-browser');
      const macdInd = ctx.indicators.find(i => i.type === 'macd');
      if (macdInd) macdPaneIdx = macdInd.paneIndex || 1;
    }

    // Create or reuse the divergence line series on the same pane
    if (!_tbRdpDivLineSeries) {
      _tbRdpDivLineSeries = _tbChart.addSeries(LightweightCharts.LineSeries, {
        priceScaleId: 'right',
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }, macdPaneIdx);
    }

    // Set divergence line data from causal-window swings
    const causalLows = causalSwingsVisible.filter(s => s.type === 'LOW');
    if (causalLows.length >= 2) {
      const divLineData = [];
      for (const sw of causalLows) {
        const md = causalMacdSlice[sw.causalIdx];
        if (md && !isNaN(md.macd)) {
          divLineData.push({ time: md.time, value: md.macd });
        }
      }
      _tbRdpDivLineSeries.setData(divLineData);
    } else {
      _tbRdpDivLineSeries.setData([]);
    }

    // H/L markers on the CI MACD line at visible-window swing points
    const macdMarkers = [];
    for (const sw of rdpSwings) {
      const md = macdSlice[sw.idx];
      if (!md || isNaN(md.macd)) continue;
      macdMarkers.push({
        time: md.time,
        position: sw.type === 'HIGH' ? 'aboveBar' : 'belowBar',
        color: sw.type === 'HIGH' ? '#ef4444' : '#22c55e',
        shape: 'circle',
        text: sw.type === 'HIGH' ? 'H' : 'L',
      });
    }
    if (macdMarkers.length > 0) {
      try { LightweightCharts.createSeriesMarkers(ciMacdLineSeries, macdMarkers); } catch (e) {}
    }
  } else {
    // No MACD from dropdown — clean up divergence line if it exists
    if (_tbRdpDivLineSeries) {
      try { _tbChart.removeSeries(_tbRdpDivLineSeries); } catch (e) {}
      _tbRdpDivLineSeries = null;
    }
  }

  // ── RDP zigzag + swing markers on price chart ────────────────────────
  if (_tbRdpZigzagSeries && rdpSwings.length >= 2) {
    const sorted = [...rdpSwings].sort((a, b) => a.idx - b.idx);
    _tbRdpZigzagSeries.setData(sorted.map(sw => ({
      time: windowBars[sw.idx].time,
      value: sw.price,
    })));
  } else if (_tbRdpZigzagSeries) {
    _tbRdpZigzagSeries.setData([]);
  }

  if (_tbRdpPriceMarkers) {
    try { _tbRdpPriceMarkers.detach ? _tbRdpPriceMarkers.detach() : null; } catch (e) {}
    _tbRdpPriceMarkers = null;
  }
  if (rdpSwings.length > 0 && _tbRdpZigzagSeries) {
    const sorted = [...rdpSwings].sort((a, b) => a.idx - b.idx);
    const priceMarkers = sorted.map(sw => ({
      time: windowBars[sw.idx].time,
      position: sw.type === 'HIGH' ? 'aboveBar' : 'belowBar',
      color: sw.type === 'HIGH' ? '#ef4444' : '#22c55e',
      shape: 'circle',
      text: sw.type === 'HIGH' ? 'SH' : 'SL',
    }));
    try {
      _tbRdpPriceMarkers = LightweightCharts.createSeriesMarkers(_tbRdpZigzagSeries, priceMarkers);
    } catch (e) {}
  }

  // Add entry price line
  if (typeof trade.entry_price === 'number') {
    _tbEntryLine = _tbCandleSeries.createPriceLine({
      price: trade.entry_price,
      color: '#22c55e',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Entry $${trade.entry_price.toFixed(2)}`,
    });
  }

  // Add stop price line
  if (typeof trade.stop_price === 'number') {
    _tbStopLine = _tbCandleSeries.createPriceLine({
      price: trade.stop_price,
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Stop $${trade.stop_price.toFixed(2)}`,
    });
  }

  // Add exit price line
  if (typeof trade.exit_price === 'number' && trade.exit_price !== trade.entry_price) {
    const r = typeof trade.R_multiple === 'number' ? trade.R_multiple : 0;
    _tbExitLine = _tbCandleSeries.createPriceLine({
      price: trade.exit_price,
      color: r >= 0 ? '#22c55e' : '#ef4444',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: true,
      title: `Exit $${trade.exit_price.toFixed(2)}`,
    });
  }

  // Add entry and exit markers
  const markers = [];
  const entryBar = allBars[entryIdx];
  const exitBar  = allBars[exitIdx];

  if (entryBar) {
    markers.push({
      time: entryBar.time,
      position: trade.direction === 'short' ? 'aboveBar' : 'belowBar',
      color: '#22c55e',
      shape: trade.direction === 'short' ? 'arrowDown' : 'arrowUp',
      text: 'Entry',
    });
  }

  if (exitBar) {
    const r = typeof trade.R_multiple === 'number' ? trade.R_multiple : 0;
    markers.push({
      time: exitBar.time,
      position: trade.direction === 'short' ? 'belowBar' : 'aboveBar',
      color: r >= 0 ? '#22c55e' : '#ef4444',
      shape: r >= 0 ? 'arrowUp' : 'arrowDown',
      text: `Exit ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`,
    });
  }

  if (markers.length > 0) {
    try {
      _tbMarkersRef = LightweightCharts.createSeriesMarkers(_tbCandleSeries, markers);
    } catch (e) {
      console.warn('Trade browser: marker error', e);
    }
  }

  // Update chart indicators context and recompute any active overlays
  if (_tbCiContextId && typeof ciSetActiveContext === 'function') {
    ciSetActiveContext(_tbCiContextId);
    ciUpdateContextMeta(trade.symbol, trade.timeframe);
    if (typeof recomputeAllIndicators === 'function') {
      recomputeAllIndicators(windowBars);
    }
  }

  // Fit the visible window snugly around the trade
  requestAnimationFrame(() => {
    if (!_tbChart) return;
    _tbChart.timeScale().fitContent();
    if (windowBars.length > 0) {
      try {
        _tbChart.timeScale().setVisibleRange({
          from: windowBars[0].time,
          to: windowBars[windowBars.length - 1].time,
        });
      } catch (e) {}
    }
    // Force the price scale to auto-fit to visible data
    try {
      _tbChart.priceScale('right').applyOptions({ autoScale: true });
    } catch (e) {}
  });
}

// ── Reset chart view ──────────────────────────────────────────────────────

function tbResetView() {
  if (!_tbChart || !_tbCandleSeries) return;
  _tbChart.timeScale().fitContent();
}

// ── Loading overlay ───────────────────────────────────────────────────────

function _tbSetChartLoading(message) {
  const el = document.getElementById('tb-chart-loading');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

// ── Keyboard navigation ───────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const browser = document.getElementById('trade-browser');
  if (!browser || !browser.classList.contains('active')) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); tbPrev(); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  { e.preventDefault(); tbNext(); }
  if (e.key === 'Escape') tbClose();
});

// ── Hook into validator.js: add "Browse Trades" button after report loads ─

function tbAddBrowseButton(reportId, tradeCount) {
  const btn = document.getElementById('btn-browse-trades');
  if (btn) {
    btn.disabled = !reportId || tradeCount === 0;
    btn.title = tradeCount > 0 ? `Browse ${tradeCount} trades` : 'No trades';
    btn.onclick = () => openTradeBrowser(reportId);
    return;
  }

  // If not yet in DOM, do nothing — button is injected by renderReportDetail patch
}
