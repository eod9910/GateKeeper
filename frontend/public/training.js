// =========================================================================
// training.js — Training data storage, labels, corrections, saved charts
// =========================================================================

// Saved charts (server-side storage)
let savedCharts = [];

// Training data (localStorage-backed)
let trainingLabels = JSON.parse(localStorage.getItem('trainingLabels') || '[]');
let trainingCorrections = JSON.parse(localStorage.getItem('trainingCorrections') || '[]');
let scannedCandidates = JSON.parse(localStorage.getItem('scannedCandidates') || '[]');
let lastAIAnalysis = null;

function saveCandidateToStorage(candidate) {
  const existingIdx = scannedCandidates.findIndex(c =>
    c.symbol === candidate.symbol && c.pattern_type === candidate.pattern_type
  );

  const storedCandidate = {
    id: candidate.id || Date.now(),
    symbol: candidate.symbol,
    pattern_type: candidate.pattern_type || 'wyckoff',
    timeframe: candidate.timeframe,
    interval: candidate.interval || '1wk',
    period: candidate.period || 'max',
    scannedAt: new Date().toISOString(),
    displayDate: new Date().toLocaleString(),
    chart_prior_peak: candidate.chart_prior_peak,
    chart_base_start: candidate.chart_base_start,
    chart_base_end: candidate.chart_base_end,
    chart_markup_high: candidate.chart_markup_high,
    chart_pullback_low: candidate.chart_pullback_low,
    base_high: candidate.base_high,
    base_low: candidate.base_low,
    aiAnalyzed: existingIdx >= 0 ? scannedCandidates[existingIdx].aiAnalyzed : false,
    labeled: existingIdx >= 0 ? scannedCandidates[existingIdx].labeled : false,
    corrected: existingIdx >= 0 ? scannedCandidates[existingIdx].corrected : false,
    savedAsChart: existingIdx >= 0 ? scannedCandidates[existingIdx].savedAsChart : false
  };

  if (existingIdx >= 0) {
    scannedCandidates[existingIdx] = storedCandidate;
  } else {
    scannedCandidates.unshift(storedCandidate);
  }

  try {
    localStorage.setItem('scannedCandidates', JSON.stringify(scannedCandidates));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('Storage quota exceeded, clearing old candidates...');
      if (scannedCandidates.length > 20) { scannedCandidates = scannedCandidates.slice(0, 20); }
      try { localStorage.setItem('scannedCandidates', JSON.stringify(scannedCandidates)); }
      catch (e2) { console.warn('Still failing, clearing all candidates from storage'); localStorage.removeItem('scannedCandidates'); }
    }
  }
  updateCandidatesCount();
  return storedCandidate;
}

function updateCandidatesCount() {
  const countEl = document.getElementById('nav-candidates-count');
  if (countEl) countEl.textContent = `(${scannedCandidates.length})`;
}

function saveTrainingData() {
  localStorage.setItem('trainingLabels', JSON.stringify(trainingLabels));
  localStorage.setItem('trainingCorrections', JSON.stringify(trainingCorrections));
  updateTrainingCounts();
}

function updateTrainingCounts() {
  const labelsCount = document.getElementById('nav-labels-count');
  const correctionsCount = document.getElementById('nav-corrections-count');
  if (labelsCount) labelsCount.textContent = `(${trainingLabels.length})`;
  if (correctionsCount) correctionsCount.textContent = `(${trainingCorrections.length})`;
}

function submitAIFeedback(isCorrect) {
  try {
    const candidate = candidates[currentIndex];
    console.log('submitAIFeedback called:', { isCorrect, candidate, lastAIAnalysis, currentIndex });

    if (!candidate) { alert('No candidate loaded. Please scan a symbol first.'); return; }
    if (!lastAIAnalysis) { alert('No AI analysis to provide feedback on. Click "Ask AI" first.'); return; }

    const scannerVector = buildScannerVector(candidate);
    const aiVector = lastAIAnalysis.mlScores ? [
      lastAIAnalysis.mlScores.detectorAgreement ?? lastAIAnalysis.mlScores.patternLikeness,
      lastAIAnalysis.mlScores.structureQuality ?? lastAIAnalysis.mlScores.structuralClarity,
      lastAIAnalysis.mlScores.patternClarity ?? lastAIAnalysis.mlScores.phaseCompleteness,
      lastAIAnalysis.mlScores.failureRisk,
      lastAIAnalysis.mlScores.timingQuality ?? lastAIAnalysis.mlScores.entryQuality
    ] : [0.5, 0.5, 0.5, 0.5, 0.5];

    const label = {
      id: Date.now(), symbol: candidate.symbol, timestamp: new Date().toISOString(),
      displayDate: new Date().toLocaleString(),
      aiAssessment: {
        isValidPattern: lastAIAnalysis.isValidPattern, confidence: lastAIAnalysis.confidence,
        review: lastAIAnalysis.review, phases: lastAIAnalysis.phases, levels: lastAIAnalysis.levels,
        mlScores: lastAIAnalysis.mlScores, explanation: lastAIAnalysis.explanation
      },
      userFeedback: { isCorrect: isCorrect, feedbackTime: new Date().toISOString() },
      mlVector: {
        scannerFeatures: scannerVector, aiScores: aiVector,
        combinedVector: [...scannerVector, ...aiVector], label: isCorrect ? 1 : 0
      },
      patternType: candidate.pattern_type || 'wyckoff',
      timeframe: candidate.timeframe,
      priceAtLabel: candidate.chart_data?.length > 0 ? candidate.chart_data[candidate.chart_data.length - 1]?.close : null
    };

    trainingLabels.push(label);
    saveTrainingData();
    updateStoredCandidateStatus(candidate.symbol, { labeled: true });

    document.getElementById('btn-ai-correct').disabled = true;
    document.getElementById('btn-ai-incorrect').disabled = true;
    document.getElementById('btn-ai-correct').classList.add('opacity-50');
    document.getElementById('btn-ai-incorrect').classList.add('opacity-50');
    document.getElementById('ai-feedback-saved').classList.remove('hidden');

    updateTrainingCounts();

    const feedbackText = isCorrect ? '\u2713 Marked as CORRECT' : '\u2717 Marked as INCORRECT';
    const savedEl = document.getElementById('ai-feedback-saved');
    savedEl.textContent = `${feedbackText} - Label #${trainingLabels.length} saved!`;
    savedEl.classList.remove('hidden');

    console.log('Training label saved:', label);
  } catch (err) {
    console.error('Error saving feedback:', err);
    if (err.message && err.message.includes('quota')) {
      alert('Storage full! Click "Reset All Data" in Settings to clear old data, then try again.');
    } else {
      alert('Error saving feedback: ' + err.message);
    }
  }
}

function updateStoredCandidateStatus(symbol, updates) {
  const idx = scannedCandidates.findIndex(c => c.symbol === symbol);
  if (idx >= 0) {
    scannedCandidates[idx] = { ...scannedCandidates[idx], ...updates };
    localStorage.setItem('scannedCandidates', JSON.stringify(scannedCandidates));
  }
}

// Save user corrections (different annotations than AI)
function saveTrainingCorrection(candidate, userDrawings, aiLevels) {
  const correction = {
    id: Date.now(), symbol: candidate.symbol, timestamp: new Date().toISOString(),
    displayDate: new Date().toLocaleString(),
    aiLevels: aiLevels, userDrawings: userDrawings,
    chartData: candidate.chart_data,
    patternType: candidate.pattern_type || 'wyckoff', timeframe: candidate.timeframe
  };
  trainingCorrections.push(correction);
  saveTrainingData();
  updateStoredCandidateStatus(candidate.symbol, { corrected: true });
  console.log('Training correction saved:', correction);
  return correction;
}

// Initialize training counts on load
document.addEventListener('DOMContentLoaded', () => {
  updateTrainingCounts();
  updateCandidatesCount();
  updateSymbolsCount();
});

// ── Saved Charts ─────────────────────────────────────────────────────────

async function saveCurrentChart() {
  const candidate = candidates[currentIndex];
  if (!candidate && !currentDisplayData) return alert('No chart to save');

  const source = candidate || currentDisplayData;
  const chartName = prompt('Name this chart:', source.symbol + ' - ' + new Date().toLocaleDateString());
  if (!chartName) return;

  let savedChart;
  const chartData = candidate?.chart_data || currentDisplayData?.chart_data || [];

  if (candidate) {
    savedChart = {
      id: Date.now(), name: chartName, candidateId: candidate.id, symbol: candidate.symbol,
      pattern_type: candidate.pattern_type || 'wyckoff', timeframe: candidate.timeframe,
      chart_data: chartData, drawings: JSON.parse(JSON.stringify(drawings)),
      pattern_markers: {
        chart_prior_peak: candidate.chart_prior_peak, chart_markdown_low: candidate.chart_markdown_low,
        chart_base_start: candidate.chart_base_start, chart_base_end: candidate.chart_base_end,
        chart_markup_high: candidate.chart_markup_high, chart_first_markup: candidate.chart_first_markup,
        chart_pullback_low: candidate.chart_pullback_low, chart_second_breakout: candidate.chart_second_breakout,
        base_high: candidate.base_high, base_low: candidate.base_low,
      },
      timestamp: new Date().toLocaleString()
    };
  } else {
    savedChart = {
      id: Date.now(), name: chartName, symbol: currentDisplayData.symbol,
      pattern_type: currentDisplayData.pattern_type || 'swing', timeframe: currentDisplayData.timeframe,
      chart_data: chartData, drawings: JSON.parse(JSON.stringify(drawings)),
      timestamp: new Date().toLocaleString()
    };
  }

  console.log('Saving chart to backend:', savedChart.symbol, 'chart_data bars:', savedChart.chart_data?.length || 0);
  try {
    const bodyStr = JSON.stringify(savedChart);
    console.log('Request body size:', (bodyStr.length / 1024).toFixed(1), 'KB');

    const response = await fetch(`${API_URL}/api/saved-charts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyStr
    });

    console.log('Save response status:', response.status);
    if (!response.ok) { const errText = await response.text(); throw new Error(`Server error ${response.status}: ${errText}`); }

    const result = await response.json();
    console.log('Save result:', result);
    savedChart.id = result.data?.id || savedChart.id;
    savedCharts.push(savedChart);
    updateSavedChartsList();

    if (candidate) { updateStoredCandidateStatus(candidate.symbol, { savedAsChart: true }); }

    const hasUserDrawings = drawings && Object.values(drawings).some(d => d !== null);
    if (candidate && hasUserDrawings && lastAIAnalysis && lastAIAnalysis.levels) {
      saveTrainingCorrection(candidate, drawings, lastAIAnalysis.levels);
      alert('Chart saved! Your corrections have been saved as training data.');
    } else {
      alert('Chart saved to sidebar! Also available in Trading Desk.');
    }
  } catch (error) {
    console.error('Failed to save chart:', error);
    alert('Failed to save chart: ' + error.message);
  }
}

async function loadSavedChart(chartId) {
  let saved = savedCharts.find(c => c.id == chartId);
  if (!saved) {
    try {
      const res = await fetch(`${API_URL}/api/saved-charts/${chartId}`);
      const data = await res.json();
      if (data.success && data.data) { saved = data.data; }
    } catch (e) { console.error('Failed to load chart from backend:', e); }
  }
  if (!saved) return alert('Chart not found');

  const idx = candidates.findIndex(c => c.id === saved.candidateId);
  if (idx >= 0) {
    currentIndex = idx;
    showCandidate(currentIndex);
  } else if (saved.chart_data && saved.chart_data.length > 0) {
    const tempCandidate = {
      id: saved.candidateId || saved.id, symbol: saved.symbol,
      pattern_type: saved.pattern_type || 'wyckoff', timeframe: saved.timeframe,
      chart_data: saved.chart_data, fromSaved: true
    };
    candidates.push(tempCandidate);
    currentIndex = candidates.length - 1;
    showCandidate(currentIndex);
    updateStats();
  } else {
    alert('Chart data not available. Please re-save this chart from a new scan.');
    return;
  }

  if (saved.drawings) {
    drawings = JSON.parse(JSON.stringify(saved.drawings));
    redrawAllDrawings();
  }
}

async function deleteSavedChart(chartId) {
  if (!confirm('Delete this saved chart?')) return;
  try {
    await fetch(`${API_URL}/api/saved-charts/${chartId}`, { method: 'DELETE' });
    savedCharts = savedCharts.filter(c => c.id !== chartId);
    updateSavedChartsList();
  } catch (error) { console.error('Failed to delete chart:', error); }
}

async function updateSavedChartsList() {
  const list = document.getElementById('saved-charts-list');
  if (!list) return;

  try {
    const res = await fetch(`${API_URL}/api/saved-charts?metadata=true`);
    const data = await res.json();
    if (data.success && data.data) { savedCharts = data.data; }
  } catch (e) { console.error('Failed to load saved charts:', e); }

  if (savedCharts.length === 0) { list.innerHTML = '<p class="text-muted">No saved symbols yet.</p>'; return; }

  list.innerHTML = savedCharts.map(chart => `
    <div class="saved-item" onclick="loadSavedChart('${chart.id}')">
      <span class="saved-item-symbol">${chart.name || chart.symbol}</span>
      <button onclick="event.stopPropagation(); deleteSavedChart('${chart.id}')" class="saved-item-delete" title="Delete">x</button>
    </div>
  `).join('');
}

function updateSidebarAIStatus() {
  const sidebarStatus = document.getElementById('sidebar-ai-status');
  const mainStatus = document.getElementById('ai-status');
  if (sidebarStatus && mainStatus) { sidebarStatus.textContent = mainStatus.textContent; }
}
