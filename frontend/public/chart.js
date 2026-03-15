// =========================================================================
// chart.js â€” Chart rendering, initialization, and overlay system
// =========================================================================

// Chart globals (shared with other modules)
let patternChart = null;
let patternSeries = null;
let patternMarkersPrimitive = null; // v5 markers primitive
let baseBoxSeries = null;  // Track base box for updates in correction mode
let overlaySeriesList = []; // Track overlay series for cleanup
let subPanelSeriesList = []; // Track sub-panel (indicator) series for cleanup

// Clear the chart completely (no data, no annotations)
function clearChart() {
  initPatternChart();

  // Reset drawing annotations (defined in drawing.js)
  if (typeof clearAllDrawings === 'function') clearAllDrawings();
  // Reset AI price lines (defined in ai-chat.js)
  if (typeof aiPriceLines !== 'undefined') {
    aiPriceLines = [];
  }

  const canvas = document.getElementById('drawing-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const chartSymbol = document.getElementById('chart-symbol');
  if (chartSymbol) chartSymbol.textContent = '';

  const panelEl = document.getElementById('candidate-info-panel');
  const candDetails = document.getElementById('candidate-details');
  if (panelEl) panelEl.classList.add('hidden');
  if (candDetails) candDetails.classList.add('hidden');

  const gateEl = document.getElementById('entry-gate');
  if (gateEl) gateEl.classList.add('entry-gate--hidden');
}

function sanitizeChartData(data) {
  if (!data || !Array.isArray(data)) return [];

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
  const sanitized = data.filter(bar => {
    if (!bar || bar.time == null || bar.time === '') return false;
    const o = bar.open, h = bar.high, l = bar.low, c = bar.close;
    if (o == null || h == null || l == null || c == null || Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(c)) return false;

    let time = bar.time;
    if (typeof time === 'string') {
      if (isIntraday && time.length > 10) {
        const dt = new Date(time.replace(' ', 'T'));
        time = isNaN(dt.getTime()) ? time.substring(0, 10) : Math.floor(dt.getTime() / 1000);
      } else {
        time = time.substring(0, 10);
      }
      bar.time = time;
    }

    if (seen.has(time)) return false;
    seen.add(time);
    return true;
  });

  sanitized.sort((a, b) => {
    const av = a.time;
    const bv = b.time;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  });

  return sanitized;
}

function initPatternChart() {
  const container = document.getElementById('pattern-chart');
  container.innerHTML = '';
  baseBoxSeries = null;
  patternMarkersPrimitive = null;

  // Clear overlay + sub-panel series
  overlaySeriesList = [];
  subPanelSeriesList = [];

  const parentEl = container.parentElement;
  const chartWidth = container.clientWidth || parentEl?.clientWidth || 600;
  const chartHeight = container.clientHeight || parentEl?.clientHeight || 480;

  patternChart = LightweightCharts.createChart(container, {
    width: chartWidth,
    height: chartHeight,
    layout: {
      background: { color: '#1e1e1e' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#374151' },
      horzLines: { color: '#374151' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#4b5563',
    },
    timeScale: {
      borderColor: '#4b5563',
      timeVisible: true,
    },
  });

  patternSeries = patternChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
  });

  window.addEventListener('resize', () => {
    if (patternChart) {
      patternChart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
    }
  });

  patternChart.subscribeClick(handleChartClick);

  requestAnimationFrame(() => {
    if (patternChart && container.clientWidth > 0 && container.clientHeight > 0) {
      patternChart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    } else if (patternChart && parentEl) {
      patternChart.applyOptions({ width: parentEl.clientWidth || chartWidth, height: parentEl.clientHeight || chartHeight });
    }
  });

  patternChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    redrawAllDrawings();
  });

  startDrawingUpdateLoop();
  initDrawingCanvas();

  // Attach universal drawing tools module
  if (typeof DrawingToolsManager !== 'undefined') {
    if (window._scannerDrawingTools) window._scannerDrawingTools.destroy();
    const chartContainer = document.getElementById('pattern-chart');
    window._scannerDrawingTools = new DrawingToolsManager(patternChart, patternSeries, chartContainer, {
      getBars: () => Array.isArray(currentDisplayData?.chart_data) ? currentDisplayData.chart_data : [],
    });

    const tbEl = document.getElementById('scanner-dt-toolbar');
    if (tbEl) {
      DrawingToolsManager.attachToolbar(tbEl, 'pattern-chart', window._scannerDrawingTools);
    }
  }
}

// Convert pixel coordinates to chart coordinates (time/price)
function pixelToChartCoords(x, y) {
  if (!patternChart || !patternSeries) return null;
  const time = patternChart.timeScale().coordinateToTime(x);
  const price = patternSeries.coordinateToPrice(y);
  return { time, price };
}

// Convert chart coordinates to pixel coordinates
function chartToPixelCoords(time, price) {
  if (!patternChart || !patternSeries) return null;
  const x = patternChart.timeScale().timeToCoordinate(time);
  const y = patternSeries.priceToCoordinate(price);
  if (x === null || y === null) return null;
  return { x, y };
}

// â”€â”€ Overlay rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reads candidate.overlays[] and creates LightweightCharts series for each

function renderOverlays(candidate) {
  // Clear previous overlays (handles both line series and price lines)
  clearOverlays();

  if (!candidate || !candidate.overlays || !Array.isArray(candidate.overlays)) return;

  for (const overlay of candidate.overlays) {
    if (overlay.type === 'line' && overlay.data && overlay.data.length > 0) {
      const series = patternChart.addSeries(LightweightCharts.LineSeries, {
        color: overlay.color || '#2962FF',
        lineWidth: overlay.lineWidth || 2,
        lineStyle: overlay.lineStyle || 0,
        title: overlay.label || '',
        priceLineVisible: false,
        lastValueVisible: overlay.showLastValue === true,
      });
      series.setData(overlay.data);
      overlaySeriesList.push(series);
    } else if (overlay.type === 'horizontal' && overlay.price != null) {
      // Horizontal levels use createPriceLine on the main series
      const line = patternSeries.createPriceLine({
        price: overlay.price,
        color: overlay.color || '#6b7280',
        lineWidth: overlay.lineWidth || 1,
        lineStyle: overlay.lineStyle != null ? overlay.lineStyle : 2,
        axisLabelVisible: overlay.axisLabelVisible !== false,
        title: overlay.label || '',
      });
      // Store reference for cleanup (price lines don't need removeSeries)
      overlaySeriesList.push({ _isPriceLine: true, _line: line });
    }
  }
}

// ── Sub-panel rendering (indicators like RSI, MACD) ────────────────────
// Reads candidate.overlay_series[] and creates LightweightCharts series in new panes

function renderSubPanels(candidate) {
  clearSubPanels();
  if (!candidate || !patternChart) return;

  // Collect overlay_series from candidate.visual.overlay_series or candidate.overlay_series
  let overlaySeriesData = [];
  const visual = candidate?.visual && typeof candidate.visual === 'object' ? candidate.visual : null;
  if (Array.isArray(visual?.overlay_series)) overlaySeriesData.push(...visual.overlay_series);
  if (Array.isArray(candidate?.overlay_series)) overlaySeriesData.push(...candidate.overlay_series);

  if (overlaySeriesData.length === 0) return;

  let nextPane = 1; // pane 0 is the main price chart
  for (const panel of overlaySeriesData) {
    if (!panel || !Array.isArray(panel.series) || panel.series.length === 0) continue;

    const paneIndex = nextPane++;
    const panelInfo = { paneIndex, series: [], hlines: [] };

    // Add each line series to this pane
    for (const line of panel.series) {
      if (!Array.isArray(line.data) || line.data.length === 0) continue;
      const s = patternChart.addSeries(LightweightCharts.LineSeries, {
        color: line.color || '#2962FF',
        lineWidth: line.lineWidth || 2,
        lineStyle: line.lineStyle || 0,
        title: line.label || '',
        priceLineVisible: false,
        lastValueVisible: true,
        priceScaleId: 'right',
      }, paneIndex);
      s.setData(line.data);
      panelInfo.series.push(s);

      // Add horizontal reference lines (e.g. RSI 30/70) as price lines on first series
      if (Array.isArray(panel.hlines)) {
        for (const hl of panel.hlines) {
          const priceLine = s.createPriceLine({
            price: hl.value,
            color: hl.color || '#6b7280',
            lineWidth: hl.lineWidth || 1,
            lineStyle: hl.lineStyle != null ? hl.lineStyle : 2,
            axisLabelVisible: hl.axisLabel !== false,
            title: hl.label || '',
          });
          panelInfo.hlines.push(priceLine);
        }
        panel.hlines = []; // only add once per pane
      }
    }

    // Set pane height if specified
    if (panel.height && patternChart.panes) {
      try {
        const panes = patternChart.panes();
        if (panes[paneIndex]) panes[paneIndex].setHeight(panel.height);
      } catch (e) { /* pane may not exist yet */ }
    }

    subPanelSeriesList.push(panelInfo);
  }
}

function clearSubPanels() {
  for (const panelInfo of subPanelSeriesList) {
    for (const s of panelInfo.series) {
      try { patternChart.removeSeries(s); } catch (e) {}
    }
  }
  subPanelSeriesList = [];
}

// Clean up price-line overlays (called before re-rendering)
function clearOverlays() {
  overlaySeriesList.forEach(s => {
    if (s._isPriceLine && s._line) {
      try { patternSeries.removePriceLine(s._line); } catch (e) {}
    } else {
      try { patternChart.removeSeries(s); } catch (e) {}
    }
  });
  overlaySeriesList = [];
}
function toDayKey(timeValue) {
  if (timeValue == null) return '';
  // BusinessDay object: {year, month, day}
  if (typeof timeValue === 'object' && typeof timeValue.year === 'number') {
    const m = String(timeValue.month).padStart(2, '0');
    const d = String(timeValue.day).padStart(2, '0');
    return `${timeValue.year}-${m}-${d}`;
  }
  if (typeof timeValue === 'number' && Number.isFinite(timeValue)) {
    try { return new Date(timeValue * 1000).toISOString().slice(0, 10); } catch { return ''; }
  }
  const s = String(timeValue).trim();
  if (!s) return '';
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function normalizeMarkerTime(rawTime, dayKeyToTime) {
  if (rawTime == null) return null;
  const key = toDayKey(rawTime);
  if (key && dayKeyToTime.has(key)) return dayKeyToTime.get(key);
  return rawTime;
}

function buildSwingMarkersFromPoints(swingPoints, safeData) {
  if (!Array.isArray(swingPoints) || !swingPoints.length) return [];
  const dayKeyToTime = new Map();
  safeData.forEach((bar) => {
    const key = toDayKey(bar.time);
    if (key) dayKeyToTime.set(key, bar.time);
  });

  const markers = [];
  for (const point of swingPoints) {
    const pType = String(point?.type || point?.point_type || '').toUpperCase();
    const isHigh = pType === 'HIGH';
    const isLow = pType === 'LOW';
    if (!isHigh && !isLow) continue;
    const normalizedTime = normalizeMarkerTime(point?.date || point?.time, dayKeyToTime);
    if (normalizedTime == null) continue;
    const rawPrice = Number(point?.price);
    const priceText = Number.isFinite(rawPrice) ? rawPrice.toFixed(2) : '';
    markers.push({
      time: normalizedTime,
      position: isHigh ? 'aboveBar' : 'belowBar',
      color: isHigh ? '#ef4444' : '#22c55e',
      shape: isHigh ? 'arrowDown' : 'arrowUp',
      text: isHigh ? `▼${priceText}` : `▲${priceText}`,
    });
  }
  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return markers;
}

function buildLegacyPatternMarkers(candidate) {
  const markers = [];
  const chartData = Array.isArray(candidate?.chart_data) ? candidate.chart_data : [];
  const isWyckoff = candidate?.pattern_type === 'wyckoff';

  if (isWyckoff && candidate.chart_prior_peak >= 0 && candidate.chart_prior_peak < chartData.length) {
    markers.push({ time: chartData[candidate.chart_prior_peak].time, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: '1.PEAK' });
  }
  if (isWyckoff && candidate.chart_markdown_low >= 0 && candidate.chart_markdown_low < chartData.length) {
    markers.push({ time: chartData[candidate.chart_markdown_low].time, position: 'belowBar', color: '#f97316', shape: 'arrowUp', text: '2.MARKDOWN' });
  }
  if (candidate.chart_base_start >= 0 && candidate.chart_base_start < chartData.length) {
    markers.push({ time: chartData[candidate.chart_base_start].time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: isWyckoff ? '3.BASE' : 'BASE' });
  }
  const markupIdx = candidate.chart_markup_high ?? candidate.chart_first_markup;
  if (markupIdx >= 0 && markupIdx < chartData.length) {
    markers.push({ time: chartData[markupIdx].time, position: 'aboveBar', color: '#3b82f6', shape: 'arrowDown', text: isWyckoff ? '4.SMALL PEAK' : 'MARKUP' });
  }
  if (candidate.chart_pullback_low >= 0 && candidate.chart_pullback_low < chartData.length) {
    markers.push({ time: chartData[candidate.chart_pullback_low].time, position: 'belowBar', color: '#eab308', shape: 'circle', text: isWyckoff ? '5.PULLBACK' : 'PULLBACK' });
  }
  if (isWyckoff && candidate.chart_second_breakout >= 0 && candidate.chart_second_breakout < chartData.length) {
    markers.push({ time: chartData[candidate.chart_second_breakout].time, position: 'aboveBar', color: '#a855f7', shape: 'arrowDown', text: '6.BREAKOUT ★' });
  }

  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return markers;
}

function getActiveChartIndicators() {
  if (typeof _ciGetIndicators === 'function') {
    try {
      const indicators = _ciGetIndicators();
      if (Array.isArray(indicators)) return indicators;
    } catch (e) {}
  }
  if (typeof _activeIndicators !== 'undefined' && Array.isArray(_activeIndicators)) {
    return _activeIndicators;
  }
  return [];
}

function isChartIndicatorActive(indicatorType) {
  return getActiveChartIndicators().some((indicator) => indicator?.type === indicatorType);
}

function shouldSuppressCandidateMarkers(candidate, visual) {
  if (!Array.isArray(visual?.markers) || visual.markers.length === 0) return false;
  if (!isChartIndicatorActive('rdpSwing')) return false;

  const patternType = String(candidate?.pattern_type || '').trim().toLowerCase();
  if (patternType.includes('three_drives')) {
    return true;
  }

  const texts = visual.markers
    .map((marker) => String(marker?.text || '').trim())
    .filter(Boolean);
  if (!texts.length) return false;

  return texts.every((text) => /^(?:D\d|C\d|H\s*\$|L\s*\$|[▲▼])/.test(text));
}

function buildCandidateMarkers(candidate, safeData) {
  const visual = candidate?.visual && typeof candidate.visual === 'object' ? candidate.visual : null;

  if (Array.isArray(visual?.markers) && visual.markers.length) {
    if (shouldSuppressCandidateMarkers(candidate, visual)) {
      return [];
    }
    const dayKeyToTime = new Map();
    safeData.forEach((bar) => {
      const key = toDayKey(bar.time);
      if (key) dayKeyToTime.set(key, bar.time);
    });
    const markers = visual.markers
      .filter((m) => m && m.time != null)
      .map((m) => ({
        time: normalizeMarkerTime(m.time, dayKeyToTime),
        position: m.position || 'aboveBar',
        color: m.color || '#9ca3af',
        shape: m.shape || 'circle',
        text: m.text || '',
      }))
      .filter((m) => m.time != null);
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return markers;
  }

  const swingPoints = candidate?.swing_structure?.swing_points || candidate?.rdp_pivots?.swing_points || null;
  if (Array.isArray(swingPoints) && swingPoints.length) {
    return buildSwingMarkersFromPoints(swingPoints, safeData);
  }

  return buildLegacyPatternMarkers(candidate);
}

// Helper to set markers on patternSeries using v5 createSeriesMarkers API
function setPatternMarkers(markers) {
  if (!patternSeries) return;
  if (patternMarkersPrimitive) {
    patternMarkersPrimitive.setMarkers(markers);
  } else if (markers.length > 0) {
    patternMarkersPrimitive = LightweightCharts.createSeriesMarkers(patternSeries, markers);
  }
}

function buildCandidateOverlays(candidate) {
  const overlays = [];
  const visual = candidate?.visual && typeof candidate.visual === 'object' ? candidate.visual : null;

  if (Array.isArray(candidate?.overlays)) overlays.push(...candidate.overlays);
  if (Array.isArray(visual?.overlays)) overlays.push(...visual.overlays);

  const lineSources = [
    ...(Array.isArray(visual?.lines) ? visual.lines : []),
    ...(Array.isArray(visual?.overlay_series) ? visual.overlay_series.filter(s => s?.type === 'line') : []),
  ];
  lineSources.forEach((line) => {
    if (!line || !Array.isArray(line.data) || !line.data.length) return;
    overlays.push({
      type: 'line',
      data: line.data,
      color: line.color,
      lineWidth: line.lineWidth,
      lineStyle: line.lineStyle,
      label: line.label,
      showLastValue: line.showLastValue === true,
    });
  });
  if (Array.isArray(visual?.hlevels)) {
    visual.hlevels.forEach((level) => {
      if (!level || level.price == null) return;
      overlays.push({
        type: 'horizontal',
        price: level.price,
        color: level.color,
        lineWidth: level.lineWidth,
        lineStyle: level.lineStyle,
        label: level.label,
        axisLabelVisible: level.axisLabelVisible !== false,
      });
    });
  }

  if (Array.isArray(candidate?.fib_levels) && candidate.fib_levels.length) {
    const colors = {
      '0%': '#ef4444',   // Red - Range High (anchor top)
      '23%': '#3b82f6',  // Blue
      '38%': '#8b5cf6',  // Purple
      '50%': '#f59e0b',  // Amber
      '61%': '#ec4899',  // Pink
      '70%': '#22c55e',  // Green - Key level
      '78%': '#14b8a6',  // Teal
      '100%': '#22c55e', // Green - Range Low (anchor bottom)
    };
    const keyLevels = ['0%', '50%', '70%', '100%'];
    candidate.fib_levels.forEach((level) => {
      const isKey = keyLevels.includes(level.level);
      overlays.push({
        type: 'horizontal',
        price: level.price,
        color: colors[level.level] || '#9ca3af',
        lineWidth: isKey || level.is_near ? 2 : 1,
        lineStyle: (level.level === '0%' || level.level === '100%') ? 0 : (level.is_near ? 0 : 2),
        label: `Fib ${level.level} · $${level.price.toFixed(2)}${level.is_near ? ' ◉' : ''}`,
      });
    });
  }

  // Always annotate detected base boundaries so scanner output is visually auditable.
  const baseHigh = Number(candidate?.base?.high);
  const baseLow = Number(candidate?.base?.low);
  const hasCustomBaseLevels = Array.isArray(visual?.hlevels) && visual.hlevels.length > 0;
  if (!hasCustomBaseLevels && Number.isFinite(baseHigh) && Number.isFinite(baseLow) && baseHigh >= baseLow) {
    overlays.push({
      type: 'horizontal',
      price: baseHigh,
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: 0,
      label: `Base Top $${baseHigh.toFixed(2)}`,
    });
    overlays.push({
      type: 'horizontal',
      price: baseLow,
      color: '#22c55e',
      lineWidth: 2,
      lineStyle: 0,
      label: `Base Bottom $${baseLow.toFixed(2)}`,
    });
  }

  return overlays;
}

// â”€â”€ Draw pattern chart with Wyckoff / generic markers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function drawPatternChart(candidate) {
  if (swingDisplayActive) {
    console.log('drawPatternChart skipped - swing display is active');
    return;
  }

  const preservedDrawings = (
    window._scannerDrawingTools
    && typeof window._scannerDrawingTools.getDrawings === 'function'
  )
    ? window._scannerDrawingTools.getDrawings()
    : [];

  const hasMarkers = Array.isArray(candidate?.visual?.markers) && candidate.visual.markers.length > 0;

  if (!candidate.chart_data || candidate.chart_data.length === 0) {
    if (!hasMarkers) {
      document.getElementById('pattern-chart').innerHTML =
        '<div class="flex items-center justify-center h-full text-gray-500 text-sm">Re-scan to get pattern view</div>';
      return;
    }
    // Marker-only candidate: fetch OHLCV then re-render
    const tfMap = { W: '1wk', D: '1d', '4h': '4h', '1h': '1h', M: '1mo' };
    const interval = tfMap[candidate.timeframe] || '1wk';
    const period = (interval === '1h' || interval === '4h') ? '730d' : 'max';
    const chartEl = document.getElementById('pattern-chart');
    if (chartEl) chartEl.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-sm">Loading chart…</div>';
    try {
      const API_URL = window.API_URL || '';
      const res = await fetch(`${API_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(candidate.symbol)}&interval=${interval}&period=${period}`);
      const json = await res.json();
      const bars = Array.isArray(json?.chart_data) ? json.chart_data : [];
      if (bars.length) {
        candidate = { ...candidate, chart_data: bars };
      } else {
        if (chartEl) chartEl.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-sm">No chart data available</div>';
        return;
      }
    } catch (e) {
      console.warn('drawPatternChart: failed to fetch OHLCV for marker chart:', e);
      if (chartEl) chartEl.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500 text-sm">Chart load failed</div>';
      return;
    }
  }

  // Some plugin scans return narrowed chart windows. For 4h, prefer full OHLCV
  // history when available so the chart does not appear clipped.
  if (Array.isArray(candidate.chart_data) && candidate.chart_data.length > 0 && String(candidate.timeframe || '').toLowerCase() === '4h') {
    const minExpectedBars = 900;
    if (candidate.chart_data.length < minExpectedBars) {
      try {
        const API_URL = window.API_URL || '';
        const res = await fetch(`${API_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(candidate.symbol)}&interval=4h&period=730d`);
        const json = await res.json();
        const bars = Array.isArray(json?.chart_data) ? json.chart_data : [];
        if (bars.length > candidate.chart_data.length) {
          candidate = { ...candidate, chart_data: bars };
        }
      } catch (e) {
        console.warn('drawPatternChart: 4h full-history hydration failed:', e);
      }
    }
  }

  initPatternChart();

  const safeData = sanitizeChartData(candidate.chart_data);
  if (safeData.length === 0) return;
  currentDisplayData = {
    ...(currentDisplayData && typeof currentDisplayData === 'object' ? currentDisplayData : {}),
    ...candidate,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe || currentDisplayData?.timeframe || 'D',
    pattern_type: candidate.pattern_type || currentDisplayData?.pattern_type || 'candidate',
    chart_data: safeData,
  };
  try { patternSeries.setData(safeData); } catch (e) { console.warn('Chart setData error:', e.message); return; }

  const markers = buildCandidateMarkers(candidate, safeData);
  try { setPatternMarkers(markers); } catch (e) { console.warn('setMarkers error:', e.message); }

  // Base box
  if (candidate.base && candidate.chart_base_start >= 0 && candidate.chart_base_end >= 0 &&
      candidate.chart_base_start < candidate.chart_data.length &&
      candidate.chart_base_end < candidate.chart_data.length) {
    baseBoxSeries = patternChart.addSeries(LightweightCharts.BaselineSeries, {
      baseValue: { type: 'price', price: candidate.base.low },
      topLineColor: 'rgba(34, 197, 94, 0.8)', topFillColor1: 'rgba(34, 197, 94, 0.4)', topFillColor2: 'rgba(34, 197, 94, 0.2)',
      bottomLineColor: 'rgba(34, 197, 94, 0.8)', bottomFillColor1: 'rgba(34, 197, 94, 0.2)', bottomFillColor2: 'rgba(34, 197, 94, 0.4)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
    const baseData = [];
    for (let i = candidate.chart_base_start; i <= candidate.chart_base_end && i < candidate.chart_data.length; i++) {
      baseData.push({ time: candidate.chart_data[i].time, value: candidate.base.high });
    }
    baseBoxSeries.setData(baseData);
  }

  // Render overlays from unified visual contract + legacy fallback fields.
  renderOverlays({ overlays: buildCandidateOverlays(candidate) });

  // Render sub-panel indicators from scan primitives (RSI, MACD returned by backend)
  renderSubPanels(candidate);

  // Auto-enable relevant chart indicators based on scan result pattern type
  if (typeof _ciAutoEnableFromScan === 'function') {
    _ciAutoEnableFromScan(candidate);
  }

  // Re-apply active chart indicators (technical, structure, visual composites)
  if (typeof recomputeAllIndicators === 'function') {
    await recomputeAllIndicators(safeData);
  }

  if (
    window._scannerDrawingTools
    && preservedDrawings.length > 0
    && typeof window._scannerDrawingTools.loadDrawings === 'function'
  ) {
    window._scannerDrawingTools.loadDrawings(preservedDrawings);
  }

  patternChart.timeScale().fitContent();
  resizeDrawingCanvas();
}

// â”€â”€ Display swing structure analysis on chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function displaySwingStructure(swingData) {
  console.log('displaySwingStructure called with:', swingData?.symbol, 'chart_data length:', swingData?.chart_data?.length);

  if (!swingData || !swingData.chart_data || swingData.chart_data.length === 0) {
    console.error('No chart data in swingData:', swingData);
    document.getElementById('pattern-chart').innerHTML =
      '<div class="flex items-center justify-center h-full text-gray-500 text-sm">No chart data available</div>';
    return;
  }

  currentDisplayData = {
    symbol: swingData.symbol,
    timeframe: swingData.timeframe || 'W',
    pattern_type: 'swing',
    chart_data: swingData.chart_data,
    swing_data: swingData
  };

  const renderCandidate = {
    symbol: swingData.symbol,
    timeframe: swingData.timeframe || 'W',
    pattern_type: 'swing_structure',
    chart_data: Array.isArray(swingData.chart_data) ? swingData.chart_data : [],
    swing_structure: {
      swing_points: Array.isArray(swingData.swing_points) ? swingData.swing_points : [],
    },
    visual: swingData.visual || null,
  };
  swingDisplayActive = false;
  drawPatternChart(renderCandidate);
  swingDisplayActive = true;

  const modeLabel = swingData.mode === 'RELATIVE' ? ' (Relative)' : ' (Major)';
  document.getElementById('chart-symbol').textContent = `${swingData.symbol} (${swingData.timeframe})`;
  document.getElementById('chart-title').textContent = 'Swing Structure' + modeLabel;

  const modeBadge = swingData.mode === 'RELATIVE'
    ? '<span class="ml-2 px-2 py-0.5 bg-yellow-600 text-yellow-100 text-xs rounded">RELATIVE</span>'
    : '<span class="ml-2 px-2 py-0.5 bg-blue-600 text-blue-100 text-xs rounded">MAJOR</span>';
  const modeNote = swingData.mode === 'RELATIVE'
    ? '<div class="text-xs text-yellow-400 mt-2">Using relative mode (20% moves) - no major structure breaks found</div>'
    : '';

  const infoHtml = `
    <div class="bg-gray-700 rounded-lg p-4">
      <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
        <span class="text-2xl">${swingData.status === 'EXTENSION' ? '\u{1F4C8}' : '\u{1F4C9}'}</span>
        ${swingData.symbol} - ${swingData.status}
        ${modeBadge}
      </h3>
      ${modeNote}
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div><span class="text-gray-400">Current Price:</span> <span class="font-mono text-white">$${swingData.current_price?.toFixed(2) || 'N/A'}</span></div>
        <div><span class="text-gray-400">Current Date:</span> <span class="font-mono text-white">${swingData.current_date || 'N/A'}</span></div>
        ${swingData.current_peak ? `<div><span class="text-gray-400">Current Peak:</span> <span class="font-mono text-red-400">$${swingData.current_peak.price?.toFixed(2)} (${swingData.current_peak.date})</span></div>` : ''}
        ${swingData.current_low ? `<div><span class="text-gray-400">Prior Low:</span> <span class="font-mono text-green-400">$${swingData.current_low.price?.toFixed(2)} (${swingData.current_low.date})</span></div>` : ''}
        ${swingData.retracement_70 ? `<div><span class="text-gray-400">70% Level:</span> <span class="font-mono text-green-400">$${swingData.retracement_70?.toFixed(2)}</span></div>` : ''}
        ${swingData.retracement_79 ? `<div><span class="text-gray-400">79% Level:</span> <span class="font-mono text-orange-400">$${swingData.retracement_79?.toFixed(2)}</span></div>` : ''}
      </div>
      ${swingData.in_buy_zone ? `<div class="mt-4 p-3 bg-green-900/50 border border-green-600 rounded-lg"><span class="text-green-400 font-semibold">\u2705 IN BUY ZONE!</span> <span class="text-gray-300 ml-2">Price is in the 70-79% retracement zone</span></div>` : ''}
      <div class="mt-4 pt-3 border-t border-gray-600">
        <div class="text-xs text-gray-400">
          Found <span class="text-white font-semibold">${swingData.swing_points?.length || 0}</span> confirmed swing points
          (${swingData.swing_points?.filter(p => p.type === 'HIGH').length || 0} peaks,
           ${swingData.swing_points?.filter(p => p.type === 'LOW').length || 0} lows)
        </div>
      </div>
    </div>
  `;

  const candidateInfoPanel = document.getElementById('candidate-info-panel');
  const candidateDetails = document.getElementById('candidate-details');
  if (candidateInfoPanel) candidateInfoPanel.classList.remove('hidden');
  if (candidateDetails) {
    candidateDetails.classList.remove('hidden');
    candidateDetails.innerHTML = infoHtml;
  }
}

// â”€â”€ Display Fibonacci + Energy analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function displayFibEnergyStructure(fibData) {
  console.log('displayFibEnergyStructure called with:', fibData?.symbol);

  if (!fibData) {
    console.error('No fib data:', fibData);
    document.getElementById('pattern-chart').innerHTML =
      '<div class="flex items-center justify-center h-full text-gray-500 text-sm">No data available</div>';
    return;
  }

  currentDisplayData = {
    symbol: fibData.symbol,
    timeframe: fibData.timeframe || 'W',
    pattern_type: 'fib-energy',
    chart_data: fibData.chart_data,
    fib_data: fibData
  };

  const renderCandidate = {
    symbol: fibData.symbol,
    timeframe: fibData.timeframe || 'W',
    pattern_type: 'fib_energy',
    chart_data: Array.isArray(fibData.chart_data) ? fibData.chart_data : [],
    fib_levels: Array.isArray(fibData.fib_levels) ? fibData.fib_levels : [],
    range: fibData.range || null,
    overlays: Array.isArray(fibData.overlays) ? fibData.overlays : [],
    visual: fibData.visual || null,
  };
  swingDisplayActive = false;
  drawPatternChart(renderCandidate);
  swingDisplayActive = true;

  document.getElementById('chart-symbol').textContent = `${fibData.symbol} (${fibData.timeframe})`;
  document.getElementById('chart-title').textContent = 'Fib + Energy Analysis';

  const signalColors = { 'WAIT': 'bg-gray-600 text-gray-100', 'APPROACHING': 'bg-yellow-600 text-yellow-100', 'POTENTIAL_ENTRY': 'bg-orange-600 text-orange-100', 'CONFIRMED_ENTRY': 'bg-green-600 text-green-100', 'CAUTION': 'bg-red-600 text-red-100' };
  const energyColors = { 'STRONG': 'text-red-400', 'WANING': 'text-yellow-400', 'EXHAUSTED': 'text-green-400', 'RECOVERING': 'text-blue-400', 'NEUTRAL': 'text-gray-400', 'UNKNOWN': 'text-gray-500' };
  const signalBadgeClass = signalColors[fibData.signal] || 'bg-gray-600 text-gray-100';
  const energyColorClass = energyColors[fibData.energy?.character_state] || 'text-gray-400';

  const infoHtml = `
    <div class="bg-gray-700 rounded-lg p-4">
      <h3 class="text-lg font-semibold mb-3 flex items-center gap-2">
        <span class="text-2xl">\u{1F4CA}</span> ${fibData.symbol} - Fib + Energy
        <span class="ml-2 px-2 py-0.5 ${signalBadgeClass} text-xs rounded">${fibData.signal}</span>
      </h3>
      <div class="p-3 mb-4 bg-gray-800 rounded-lg border-l-4 ${fibData.signal === 'CONFIRMED_ENTRY' ? 'border-green-500' : fibData.signal === 'POTENTIAL_ENTRY' ? 'border-orange-500' : fibData.signal === 'CAUTION' ? 'border-red-500' : 'border-gray-500'}">
        <div class="text-sm text-gray-300">${fibData.signal_reason || 'Analyzing...'}</div>
      </div>
      <div class="grid grid-cols-2 gap-4 text-sm mb-4">
        <div><span class="text-gray-400">Current Price:</span> <span class="font-mono text-white">$${fibData.current_price?.toFixed(2) || 'N/A'}</span></div>
        <div><span class="text-gray-400">Retracement:</span> <span class="font-mono text-white">${fibData.current_retracement_pct?.toFixed(1) || 0}%</span></div>
        <div><span class="text-gray-400">Range High:</span> <span class="font-mono text-red-400">$${fibData.range?.high?.toFixed(2) || 'N/A'}</span></div>
        <div><span class="text-gray-400">Range Low:</span> <span class="font-mono text-green-400">$${fibData.range?.low?.toFixed(2) || 'N/A'}</span></div>
      </div>
      <div class="border-t border-gray-600 pt-4 mb-4">
        <h4 class="text-sm font-semibold text-gray-300 mb-2">\u{1F4C9} Selling Pressure</h4>
        ${fibData.selling_pressure ? `
        <div class="mb-3">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-2xl font-bold ${fibData.selling_pressure.current < 20 ? 'text-green-400' : fibData.selling_pressure.current < 40 ? 'text-yellow-400' : fibData.selling_pressure.current < 60 ? 'text-orange-400' : 'text-red-400'}">${fibData.selling_pressure.current?.toFixed(0) || 0}</span>
            <span class="text-gray-400 text-sm">/100</span>
            <span class="text-xs px-2 py-0.5 rounded ${fibData.selling_pressure.trend === 'DECREASING' ? 'bg-green-600 text-green-100' : fibData.selling_pressure.trend === 'INCREASING' ? 'bg-red-600 text-red-100' : 'bg-gray-600 text-gray-100'}">${fibData.selling_pressure.trend || 'UNKNOWN'}</span>
          </div>
          <div class="text-xs text-gray-400">Peak: ${fibData.selling_pressure.peak?.toFixed(0) || 0} (${fibData.selling_pressure.bars_since_peak || 0} bars ago) | Change: ${fibData.selling_pressure.change > 0 ? '+' : ''}${fibData.selling_pressure.change?.toFixed(0) || 0}</div>
          ${fibData.selling_pressure.history && fibData.selling_pressure.history.length > 0 ? `<div class="mt-2 flex items-end gap-0.5 h-8">${fibData.selling_pressure.history.map(p => `<div class="flex-1 ${p < 20 ? 'bg-green-500' : p < 40 ? 'bg-yellow-500' : p < 60 ? 'bg-orange-500' : 'bg-red-500'}" style="height: ${Math.max(2, p * 0.3)}px"></div>`).join('')}</div><div class="text-xs text-gray-500 mt-1">Last ${fibData.selling_pressure.history.length} readings</div>` : ''}
        </div>
        ` : '<div class="text-gray-500 text-sm">No selling pressure data</div>'}
      </div>
      <div class="border-t border-gray-600 pt-4 mb-4">
        <h4 class="text-sm font-semibold text-gray-300 mb-2">\u26A1 Energy State</h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div><span class="text-gray-400">Character:</span> <span class="font-semibold ${energyColorClass}">${fibData.energy?.character_state || 'UNKNOWN'}</span></div>
          <div><span class="text-gray-400">Direction:</span> <span class="font-mono ${fibData.energy?.direction === 'UP' ? 'text-green-400' : 'text-red-400'}">${fibData.energy?.direction === 'UP' ? '\u2191' : '\u2193'} ${fibData.energy?.direction || 'N/A'}</span></div>
          <div><span class="text-gray-400">Velocity:</span> <span class="font-mono text-white">${fibData.energy?.velocity?.toFixed(2) || 0}%</span></div>
          <div><span class="text-gray-400">Acceleration:</span> <span class="font-mono text-white">${fibData.energy?.acceleration?.toFixed(3) || 0}</span></div>
          <div><span class="text-gray-400">Energy Score:</span> <span class="font-mono text-white">${fibData.energy?.energy_score?.toFixed(1) || 0}/100</span></div>
          <div><span class="text-gray-400">Range Compression:</span> <span class="font-mono text-white">${((fibData.energy?.range_compression || 0) * 100).toFixed(0)}%</span></div>
        </div>
      </div>
      <div class="border-t border-gray-600 pt-4">
        <h4 class="text-sm font-semibold text-gray-300 mb-2">\u{1F4D0} Fibonacci Levels</h4>
        <div class="grid grid-cols-2 gap-1 text-xs">
          ${(fibData.fib_levels || []).map(level => `<div class="flex justify-between ${level.is_near ? 'bg-yellow-900/30 rounded px-1' : ''}"><span class="text-gray-400">${level.level}:</span> <span class="font-mono text-white">$${level.price?.toFixed(2)} ${level.is_near ? '\u25C9' : ''}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `;

  const candidateInfoPanel = document.getElementById('candidate-info-panel');
  const candidateDetails = document.getElementById('candidate-details');
  if (candidateInfoPanel) candidateInfoPanel.classList.remove('hidden');
  if (candidateDetails) {
    candidateDetails.classList.remove('hidden');
    candidateDetails.innerHTML = infoHtml;
  }
}


// ── Chart Timeframe Switcher ──
let _chartCurrentSymbol = '';
let _chartCurrentInterval = '';
let _chartCurrentPluginId = '';

function _updateTfButtonStyles(activeInterval) {
  document.querySelectorAll('.chart-tf-btn').forEach(btn => {
    const tf = btn.getAttribute('data-tf');
    if (tf === activeInterval) {
      btn.style.background = '#6366f1';
      btn.style.color = '#fff';
      btn.style.borderColor = '#818cf8';
    } else {
      btn.style.background = '#374151';
      btn.style.color = '#9ca3af';
      btn.style.borderColor = '#4b5563';
    }
  });
}

function setChartContext(symbol, interval, pluginId) {
  _chartCurrentSymbol = symbol;
  _chartCurrentInterval = interval;
  _chartCurrentPluginId = pluginId || '';
  if (typeof ciUpdateContextMeta === 'function') {
    try { ciUpdateContextMeta(symbol, interval); } catch (e) {}
  }
  _updateTfButtonStyles(interval);
}

function buildChartOnlyCandidate(symbol, timeframe, chartData) {
  return {
    symbol,
    timeframe,
    pattern_type: 'chart_only',
    chart_data: Array.isArray(chartData) ? chartData : [],
    chart_base_start: -1,
    chart_base_end: -1,
  };
}

async function switchChartTimeframe(newInterval) {
  if (!_chartCurrentSymbol) return;
  if (newInterval === _chartCurrentInterval) return;

  const timeframeMap = { '1h': '1h', '4h': '4h', '1d': 'D', '1wk': 'W', '1mo': 'M' };
  const timeframe = timeframeMap[newInterval] || 'D';
  const pluginId = _chartCurrentPluginId || (document.getElementById('scan-indicator-select')?.value || '');

  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = `Loading ${_chartCurrentSymbol} ${timeframe}...`;

  _chartCurrentInterval = newInterval;
  if (typeof ciUpdateContextMeta === 'function') {
    try { ciUpdateContextMeta(_chartCurrentSymbol, newInterval); } catch (e) {}
  }
  _updateTfButtonStyles(newInterval);

  try {
    const API_URL = window.API_URL || '';
    const periodMap = { '1h': '730d', '4h': '730d', '1d': 'max', '1wk': 'max', '1mo': 'max' };
    const chartPeriod = periodMap[newInterval] || '2y';
    let fullChartBars = [];
    const preserveSwingDisplay = swingDisplayActive;

    async function redrawWithCurrentMode(candidate) {
      swingDisplayActive = false;
      try {
        await drawPatternChart(candidate);
      } finally {
        swingDisplayActive = preserveSwingDisplay;
      }
    }

    // If no scan indicator is selected, use quick OHLCV load instead
    if (!pluginId) {
      const res = await fetch(`${API_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(_chartCurrentSymbol)}&interval=${newInterval}&period=${chartPeriod}`);
      const data = await res.json();
      if (data?.success && data?.chart_data?.length) {
        const candidate = buildChartOnlyCandidate(_chartCurrentSymbol, timeframe, data.chart_data);
        document.getElementById('chart-symbol').textContent = _chartCurrentSymbol + ' (' + timeframe + ')';
        await redrawWithCurrentMode(candidate);
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}) — ${data.bars} bars`;
      } else if (fullChartBars.length > 0) {
        const candidate = buildChartOnlyCandidate(_chartCurrentSymbol, timeframe, fullChartBars);
        document.getElementById('chart-symbol').textContent = _chartCurrentSymbol + ' (' + timeframe + ')';
        await redrawWithCurrentMode(candidate);
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}) - raw chart only (no pattern match)`;
      } else {
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}): no data`;
      }
      return;
    }

    // Always fetch full OHLCV for the selected timeframe so plugin candidates
    // cannot clip the visible chart window by returning a narrowed chart_data slice.
    try {
      const baseRes = await fetch(`${API_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(_chartCurrentSymbol)}&interval=${newInterval}&period=${chartPeriod}`);
      const baseData = await baseRes.json();
      if (baseData?.success && Array.isArray(baseData?.chart_data)) {
        fullChartBars = baseData.chart_data;
      }
    } catch (e) {
      console.warn('Timeframe switch: base OHLCV fetch failed, falling back to plugin chart_data', e);
    }

    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: _chartCurrentSymbol,
        pluginId,
        interval: newInterval,
        period: chartPeriod,
        timeframe,
      }),
    });
    const data = await res.json();
    if (data?.success) {
      const found = Array.isArray(data?.data?.candidates) ? data.data.candidates : [];
      if (found.length > 0) {
        const candidate = {
          ...found[0],
          symbol: _chartCurrentSymbol,
          id: found[0].id || found[0].candidate_id || 0,
          chart_data: fullChartBars.length > 0 ? fullChartBars : found[0].chart_data,
        };
        document.getElementById('chart-symbol').textContent = _chartCurrentSymbol + ' (' + timeframe + ')';
        await redrawWithCurrentMode(candidate);
        const bars = Array.isArray(candidate.chart_data) ? candidate.chart_data.length : 0;
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}) — ${bars} bars`;
      } else {
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}): no data`;
      }
      if (found.length === 0 && fullChartBars.length > 0) {
        const candidate = buildChartOnlyCandidate(_chartCurrentSymbol, timeframe, fullChartBars);
        document.getElementById('chart-symbol').textContent = _chartCurrentSymbol + ' (' + timeframe + ')';
        await redrawWithCurrentMode(candidate);
        if (statusEl) statusEl.textContent = `${_chartCurrentSymbol} (${timeframe}) - raw chart only (no pattern match)`;
      }
    }
  } catch (err) {
    console.error('Timeframe switch failed:', err);
    if (statusEl) statusEl.textContent = `Failed to load ${timeframe}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.chart-tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tf = btn.getAttribute('data-tf');
      switchChartTimeframe(tf);
    });
  });
});
