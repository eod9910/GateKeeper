// =========================================================================
// correction.js — Correction mode (drawing annotations for Wyckoff phases)
// =========================================================================

// Correction mode state
let correctionMode = false;
let correctionStep = null;  // 'priorPeak', 'markdown', 'base', 'markup', 'pullback', 'breakout'
let correctedPositions = {
  priorPeakIndex: null,
  markdownIndex: null,
  baseIndex: null,
  markupIndex: null,
  pullbackIndex: null,
  breakoutIndex: null
};

function enterCorrectionMode() {
  if (currentIndex >= candidates.length) return;

  correctionMode = true;
  correctionStep = 'priorPeak';
  correctedPositions = {
    priorPeakIndex: null, markdownIndex: null, baseIndex: null,
    markupIndex: null, pullbackIndex: null, breakoutIndex: null
  };

  clearAllDrawings();

  if (patternSeries) {
    setPatternMarkers([]);
  }
  if (baseBoxSeries && patternChart) {
    patternChart.removeSeries(baseBoxSeries);
    baseBoxSeries = null;
  }

  document.getElementById('correction-panel').innerHTML = `
    <h4 class="font-semibold text-yellow-400 mb-2">\u270F\uFE0F Draw Pattern Annotations</h4>
    <p class="text-xs text-gray-300 mb-3">Draw on chart to mark Wyckoff phases:</p>
    <div class="space-y-2 text-sm mb-4">
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('point', 'peak')" id="btn-draw-peak" class="px-2 py-1 rounded text-xs bg-red-700 hover:bg-red-600 flex items-center gap-1"><span>\u25CF</span> 1. PEAK (Click)</button>
        <span id="drawing-peak-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('peak')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('lineDown', 'markdown')" id="btn-draw-markdown" class="px-2 py-1 rounded text-xs bg-orange-700 hover:bg-orange-600 flex items-center gap-1"><span>\u2198</span> 2. MARKDOWN (Line\u2193)</button>
        <span id="drawing-markdown-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('markdown')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('box', 'base')" id="btn-draw-base" class="px-2 py-1 rounded text-xs bg-green-700 hover:bg-green-600 flex items-center gap-1"><span>\u25A2</span> 3. BASE (Box)</button>
        <span id="drawing-base-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('base')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('lineUp', 'markup')" id="btn-draw-markup" class="px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 flex items-center gap-1"><span>\u2197</span> 4. MARKUP (Line\u2191)</button>
        <span id="drawing-markup-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('markup')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('lineDown', 'pullback')" id="btn-draw-pullback" class="px-2 py-1 rounded text-xs bg-yellow-700 hover:bg-yellow-600 flex items-center gap-1"><span>\u2198</span> 5. PULLBACK (Line\u2193)</button>
        <span id="drawing-pullback-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('pullback')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="enterDrawingMode('hline', 'breakout')" id="btn-draw-breakout" class="px-2 py-1 rounded text-xs bg-purple-700 hover:bg-purple-600 flex items-center gap-1"><span>\u2014</span> 6. BREAKOUT (H-Line)</button>
        <span id="drawing-breakout-status" class="text-gray-400 text-xs">Not set</span>
        <button onclick="clearDrawing('breakout')" class="text-red-400 text-xs hover:text-red-300">\u2715</button>
      </div>
    </div>
    <div class="border-t border-gray-600 pt-3 mb-3">
      <button onclick="clearAllDrawings()" class="text-xs text-gray-400 hover:text-white">\u{1F5D1}\uFE0F Clear All Drawings</button>
    </div>
    <div class="flex gap-2">
      <button onclick="saveDrawingCorrection()" id="btn-save-drawing" class="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">\u{1F4BE} Save Annotations</button>
      <button onclick="exitCorrectionMode()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded">Cancel</button>
    </div>
    <p class="text-xs text-gray-500 mt-2 italic">Tip: Click & drag on chart to draw. Drawings are labeled automatically.</p>
  `;

  document.getElementById('correction-panel').classList.remove('hidden');
}

function exitCorrectionMode() {
  correctionMode = false;
  correctionStep = null;
  exitDrawingMode();
  clearAllDrawings();
  document.getElementById('correction-panel').classList.add('hidden');

  if (currentIndex < candidates.length) {
    drawPatternChart(candidates[currentIndex]);
  }
}

async function saveDrawingCorrection() {
  if (currentIndex >= candidates.length) return;

  const candidate = candidates[currentIndex];
  const hasDrawings = Object.values(drawings).some(d => d !== null);
  if (!hasDrawings) {
    alert('Please draw at least one annotation before saving.');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: candidate.id,
        userId: 'default',
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        patternType: 'wyckoff_drawing',
        drawings: drawings,
        canvasSize: { width: drawingCanvas.width, height: drawingCanvas.height },
        chartTimeRange: { start: candidate.chart_data[0]?.time, end: candidate.chart_data[candidate.chart_data.length - 1]?.time },
        chartPriceRange: { low: Math.min(...candidate.chart_data.map(d => d.low)), high: Math.max(...candidate.chart_data.map(d => d.high)) }
      })
    });

    const data = await res.json();
    if (data.success) {
      document.getElementById('correction-panel').innerHTML = `
        <div class="text-center py-4">
          <div class="text-green-400 text-2xl mb-2">\u2705</div>
          <div class="text-green-400 font-semibold mb-2">Annotations Saved!</div>
          <p class="text-gray-400 text-xs mb-4">Your drawings will help train the AI.</p>
          <div class="flex gap-2">
            <button onclick="goToNextCandidate()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Next Candidate \u2192</button>
            <button onclick="exitCorrectionMode()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded">Done</button>
          </div>
        </div>
      `;
    } else {
      alert('Failed to save annotations: ' + data.error);
    }
  } catch (err) {
    console.error('Failed to save annotations:', err);
    alert('Failed to save annotations');
  }
}

function setCorrectionStep(step) {
  correctionStep = step;
  updateCorrectionButtons();
  const statusMap = {
    'priorPeak': 'correction-priorPeak-status',
    'markdown': 'correction-markdown-status',
    'base': 'correction-base-status',
    'markup': 'correction-markup-status',
    'pullback': 'correction-pullback-status',
    'breakout': 'correction-breakout-status'
  };
  document.getElementById(statusMap[step]).textContent = 'Click on chart...';
}

function updateCorrectionButtons() {
  const buttons = ['priorPeak', 'markdown', 'base', 'markup', 'pullback', 'breakout'];
  for (const step of buttons) {
    const btn = document.getElementById(`btn-set-${step}`);
    if (btn) btn.classList.toggle('ring-2', correctionStep === step);
  }
}

function handleChartClick(param) {
  if (drawingMode || !correctionMode || !correctionStep || !param.time) return;
  if (window._scannerDrawingTools && window._scannerDrawingTools.getActiveTool()) return;

  const candidate = candidates[currentIndex];
  if (!candidate || !candidate.chart_data) return;

  const clickedTime = param.time;
  const chartData = candidate.chart_data;
  let clickedIndex = chartData.findIndex(bar => bar.time === clickedTime);
  if (clickedIndex === -1) return;

  const actualIndex = clickedIndex;

  const stepConfig = {
    'priorPeak': { key: 'priorPeakIndex', status: 'correction-priorPeak-status', next: 'markdown' },
    'markdown': { key: 'markdownIndex', status: 'correction-markdown-status', next: 'base' },
    'base': { key: 'baseIndex', status: 'correction-base-status', next: 'markup' },
    'markup': { key: 'markupIndex', status: 'correction-markup-status', next: 'pullback' },
    'pullback': { key: 'pullbackIndex', status: 'correction-pullback-status', next: 'breakout' },
    'breakout': { key: 'breakoutIndex', status: 'correction-breakout-status', next: null }
  };

  const config = stepConfig[correctionStep];
  if (config) {
    correctedPositions[config.key] = actualIndex;
    const statusEl = document.getElementById(config.status);
    if (statusEl) statusEl.textContent = `Set: ${clickedTime}`;
    correctionStep = config.next;
  }

  updateCorrectionButtons();
  updateCorrectionMarkers(candidate);
}

function updateCorrectionMarkers(candidate) {
  if (!patternSeries || !candidate.chart_data) return;

  const markers = [];
  const chartData = candidate.chart_data;

  const markerConfig = [
    { key: 'priorPeakIndex', color: '#ef4444', position: 'aboveBar', shape: 'arrowDown', text: '\u2713 1.PEAK' },
    { key: 'markdownIndex', color: '#f97316', position: 'belowBar', shape: 'arrowUp', text: '\u2713 2.MARKDOWN' },
    { key: 'baseIndex', color: '#22c55e', position: 'belowBar', shape: 'arrowUp', text: '\u2713 3.BASE' },
    { key: 'markupIndex', color: '#3b82f6', position: 'aboveBar', shape: 'arrowDown', text: '\u2713 4.MARKUP' },
    { key: 'pullbackIndex', color: '#eab308', position: 'belowBar', shape: 'circle', text: '\u2713 5.PULLBACK' },
    { key: 'breakoutIndex', color: '#a855f7', position: 'aboveBar', shape: 'arrowDown', text: '\u2713 6.BREAKOUT' }
  ];

  for (const config of markerConfig) {
    const chartIdx = correctedPositions[config.key];
    if (chartIdx !== null && chartIdx >= 0 && chartIdx < chartData.length) {
      markers.push({
        time: chartData[chartIdx].time, position: config.position,
        color: config.color, shape: config.shape, text: config.text
      });
    }
  }

  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  try { setPatternMarkers(markers); } catch (e) { console.warn('setMarkers error:', e.message); }

  if (baseBoxSeries) {
    patternChart.removeSeries(baseBoxSeries);
    baseBoxSeries = null;
  }

  const baseIdx = correctedPositions.baseIndex;
  const markupIdx = correctedPositions.markupIndex;

  if (baseIdx !== null && markupIdx !== null && baseIdx >= 0 && markupIdx >= 0 &&
      baseIdx < chartData.length && markupIdx < chartData.length) {
    let baseHigh = -Infinity;
    let baseLow = Infinity;
    const startIdx = Math.min(baseIdx, markupIdx);
    const endIdx = Math.max(baseIdx, markupIdx);

    for (let i = startIdx; i <= endIdx && i < chartData.length; i++) {
      const bar = chartData[i];
      if (bar.high > baseHigh) baseHigh = bar.high;
      if (bar.low < baseLow) baseLow = bar.low;
    }

    baseBoxSeries = patternChart.addSeries(LightweightCharts.BaselineSeries, {
      baseValue: { type: 'price', price: baseLow },
      topLineColor: 'rgba(34, 197, 94, 0.8)', topFillColor1: 'rgba(34, 197, 94, 0.4)', topFillColor2: 'rgba(34, 197, 94, 0.2)',
      bottomLineColor: 'rgba(34, 197, 94, 0.8)', bottomFillColor1: 'rgba(34, 197, 94, 0.2)', bottomFillColor2: 'rgba(34, 197, 94, 0.4)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
    const baseData = [];
    for (let i = startIdx; i <= endIdx && i < chartData.length; i++) {
      baseData.push({ time: chartData[i].time, value: baseHigh });
    }
    baseBoxSeries.setData(baseData);
  }
}

async function saveCorrection() {
  if (currentIndex >= candidates.length) return;

  const candidate = candidates[currentIndex];
  const requiredPhases = ['priorPeakIndex', 'markdownIndex', 'baseIndex', 'markupIndex', 'pullbackIndex', 'breakoutIndex'];
  const missingPhases = requiredPhases.filter(key => correctedPositions[key] === null);

  if (missingPhases.length > 0) {
    alert(`Please set all 6 Wyckoff phases. Missing: ${missingPhases.map(k => k.replace('Index', '')).join(', ')}`);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: candidate.id,
        userId: 'default',
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        patternType: 'wyckoff',
        original: {
          priorPeakIndex: candidate.chart_prior_peak,
          markdownLowIndex: candidate.chart_markdown_low,
          baseStartIndex: candidate.chart_base_start,
          markupHighIndex: candidate.chart_markup_high || candidate.chart_first_markup,
          pullbackLowIndex: candidate.chart_pullback_low,
          secondBreakoutIndex: candidate.chart_second_breakout
        },
        corrected: {
          priorPeakIndex: correctedPositions.priorPeakIndex,
          markdownLowIndex: correctedPositions.markdownIndex,
          baseStartIndex: correctedPositions.baseIndex,
          markupHighIndex: correctedPositions.markupIndex,
          pullbackLowIndex: correctedPositions.pullbackIndex,
          secondBreakoutIndex: correctedPositions.breakoutIndex
        }
      })
    });

    const data = await res.json();
    if (data.success) {
      correctionMode = false;
      correctionStep = null;
      document.getElementById('correction-panel').innerHTML = `
        <div class="text-center py-4">
          <div class="text-2xl text-green-400 mb-2">\u2713 Correction Saved!</div>
          <p class="text-gray-400 text-sm mb-3">Your marked positions have been saved for training.</p>
          <button onclick="goToNextCandidate()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded">Next Candidate \u2192</button>
        </div>
      `;
      loadStats();
      loadRecentLabels();
    } else {
      alert('Failed to save correction: ' + data.error);
    }
  } catch (err) {
    console.error('Failed to save correction:', err);
    alert('Failed to save correction');
  }
}
