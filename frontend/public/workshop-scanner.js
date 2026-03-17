// =========================================================================
// workshop-scanner.js - Pattern scanner, utilities, window exports
// Split from workshop.js for maintainability. Load after workshop-builder.js.
// =========================================================================
const WORKSHOP_SCANNER_SESSION_KEY = 'workshop-scanner-session-v1';
const WORKSHOP_BASE_METHOD_IDS = [
  'rdp_wiggle_base',
  'wiggle_base_box_v2_pattern',
  'rdp_regression_flat_base',
  'rdp_base_75',
  'base_box_detector_v1_primitive',
  'base_box_detector_rdp_hybrid_v1_pattern',
  'regime_filter',
];

const WORKSHOP_BASE_TEST_40 = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'NFLX',
  'AVGO', 'AMD', 'MU', 'INTC', 'SMCI', 'QCOM', 'ADBE', 'CRM',
  'XOM', 'CVX', 'COP', 'SLB', 'CAT', 'DE', 'BA', 'GE',
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'UNH', 'LLY',
  'COST', 'WMT', 'HD', 'LOW', 'PFE', 'MRK', 'KO', 'PEP',
];

async function initializeWorkshopScanner() {
  if (!workshopScannerState.initialized) {
    bindWorkshopIndicatorPicker();
    await loadWorkshopScannerOptions();
    await loadWorkshopScannerSymbolCatalog();
    await loadWorkshopScannerSavedFeedback();
    initializeWorkshopScannerChat();
    initWorkshopScannerChart();
    bindWorkshopCorrectionInputs();
    bindWorkshopScannerPreferenceInputs();
    await restoreWorkshopScannerSession();
    await refreshWorkshopScannerMetrics();
    workshopScannerState.initialized = true;
  }
}

function initializeWorkshopScannerChat() {
  if (!workshopScannerState.chat.length) {
    workshopScannerState.chat.push({
      sender: 'ai',
      text: 'I am the Pattern Analyst. Scan a pattern, then ask me to explain why a candidate is valid or weak.'
    });
  }
  renderWorkshopScannerChat();
}

function workshopScannerPrettyLabel(raw) {
  const label = String(raw || '').toLowerCase();
  if (label === 'yes') return 'YES';
  if (label === 'no') return 'NO';
  if (label === 'close') return 'SKIP';
  return label.toUpperCase();
}

function workshopScannerFormatSavedTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function workshopScannerNormalizeDateString(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 9_999_999_999 ? raw : raw * 1000;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }
  if (typeof raw === 'object') {
    const y = Number(raw.year);
    const m = Number(raw.month);
    const d = Number(raw.day);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const mm = String(Math.max(1, Math.min(12, Math.trunc(m)))).padStart(2, '0');
      const dd = String(Math.max(1, Math.min(31, Math.trunc(d)))).padStart(2, '0');
      return `${Math.trunc(y)}-${mm}-${dd}`;
    }
  }
  return '';
}

function workshopScannerCompareDate(a, b) {
  const x = workshopScannerNormalizeDateString(a);
  const y = workshopScannerNormalizeDateString(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function workshopScannerFormatDateLabel(value) {
  const normalized = workshopScannerNormalizeDateString(value);
  if (!normalized) return '';
  const d = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return normalized;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function workshopScannerCandidateTimeAtIndex(candidate, index) {
  const bars = Array.isArray(candidate?.chart_data) ? candidate.chart_data : [];
  const idx = Number(index);
  if (!Number.isFinite(idx)) return '';
  const item = bars[Math.trunc(idx)];
  return workshopScannerNormalizeDateString(item?.time);
}

function workshopScannerGetSavedState(candidateId) {
  const cid = String(candidateId || '');
  if (!cid) return { labelRecord: null, correctionRecord: null };
  return {
    labelRecord: workshopScannerState.labelsByCandidateId?.[cid] || null,
    correctionRecord: workshopScannerState.correctionsByCandidateId?.[cid] || null,
  };
}

function workshopScannerIsReviewed(row) {
  if (!row) return false;
  const { labelRecord, correctionRecord } = workshopScannerGetSavedState(row.id);
  return !!labelRecord || !!correctionRecord;
}

function workshopScannerReviewStatusText(row) {
  if (!row) return '';
  const { labelRecord, correctionRecord } = workshopScannerGetSavedState(row.id);
  const prettyLabel = labelRecord?.label ? workshopScannerPrettyLabel(labelRecord.label) : '';
  if (correctionRecord && prettyLabel) return `${prettyLabel} (corrected)`;
  if (correctionRecord) return 'CORRECTED';
  return prettyLabel;
}

function workshopScannerShouldSkipReviewed() {
  const el = document.getElementById('workshop-scanner-skip-reviewed');
  return !!(el && el.checked);
}

function workshopScannerFindNextIndex(startIndex, direction) {
  const rows = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates : [];
  const len = rows.length;
  if (!len) return -1;

  const step = direction >= 0 ? 1 : -1;
  let idx = (startIndex + step + len) % len;
  if (!workshopScannerShouldSkipReviewed()) return idx;

  for (let i = 0; i < len; i += 1) {
    if (!workshopScannerIsReviewed(rows[idx])) return idx;
    idx = (idx + step + len) % len;
  }

  return (startIndex + step + len) % len;
}

function workshopScannerFindPreferredIndex(preferredIndex = 0) {
  const rows = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates : [];
  const len = rows.length;
  if (!len) return -1;

  const raw = Number(preferredIndex);
  const clamped = Number.isFinite(raw)
    ? Math.min(Math.max(0, Math.floor(raw)), len - 1)
    : 0;

  if (!workshopScannerShouldSkipReviewed()) return clamped;
  if (!workshopScannerIsReviewed(rows[clamped])) return clamped;

  for (let offset = 1; offset < len; offset += 1) {
    const idx = (clamped + offset) % len;
    if (!workshopScannerIsReviewed(rows[idx])) return idx;
  }

  return clamped;
}

function workshopScannerAdvanceToNextUnreviewed(direction = 1) {
  if (!workshopScannerShouldSkipReviewed()) return false;
  const rows = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates : [];
  if (!rows.length) return false;

  const current = Number(workshopScannerState.currentIndex || 0);
  const next = workshopScannerFindNextIndex(current, direction);
  if (next < 0 || next === current) return false;
  if (workshopScannerIsReviewed(rows[next])) return false;
  showWorkshopScannerCandidate(next);
  return true;
}

function workshopScannerGetSavedSummary(row) {
  if (!row || !row.id) return 'Saved: none';
  const { labelRecord, correctionRecord } = workshopScannerGetSavedState(row.id);
  const parts = [];
  if (labelRecord?.label) {
    const t = workshopScannerFormatSavedTime(labelRecord.timestamp);
    parts.push(`Label ${workshopScannerPrettyLabel(labelRecord.label)}${t ? ` @ ${t}` : ''}`);
  }
  if (correctionRecord) {
    const t = workshopScannerFormatSavedTime(correctionRecord.timestamp || correctionRecord.updatedAt);
    parts.push(`Correction${t ? ` @ ${t}` : ''}`);
  }
  return parts.length ? `Saved: ${parts.join(' | ')}` : 'Saved: none';
}

function workshopScannerGetReviewBucket(row) {
  if (!row) return 'all';
  const { labelRecord, correctionRecord } = workshopScannerGetSavedState(row.id);
  const label = String(labelRecord?.label || '').toLowerCase();
  if (label === 'yes') return 'accepted';
  if (label === 'no') return 'rejected';
  if (label === 'close') return 'skipped';
  if (correctionRecord) return 'corrected';
  return 'unreviewed';
}

function workshopScannerGetScanOutcome(row) {
  return row?.no_candidate ? 'no-candidate' : 'scanner-hit';
}

function workshopScannerBuildScanRows(candidates, scanResults, meta = {}) {
  const hitRows = Array.isArray(candidates) ? candidates.slice() : [];
  const outcomeRows = Array.isArray(scanResults) ? scanResults : [];
  const timeframe = String(meta.timeframe || '').trim() || 'W';
  const patternId = String(meta.patternId || '').trim();
  const hitSymbols = new Set(
    hitRows
      .map((row) => String(row?.symbol || '').trim().toUpperCase())
      .filter((symbol) => !!symbol)
  );

  const missRows = outcomeRows
    .filter((row) => Number(row?.count || 0) <= 0)
    .map((row) => {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      return {
        id: `scan_miss_${patternId}_${timeframe}_${symbol}`,
        candidate_id: `scan_miss_${patternId}_${timeframe}_${symbol}`,
        symbol,
        timeframe,
        pattern_type: patternId,
        strategy_version_id: `scan_${patternId}_no_candidate`,
        score: null,
        no_candidate: true,
        scan_result: 'no_candidate',
        scan_error: row?.error ? String(row.error) : '',
        chart_data: [],
        visual: { markers: [], overlay_series: [] },
      };
    })
    .filter((row) => !!row.symbol && !hitSymbols.has(row.symbol));

  return hitRows
    .map((row) => ({ ...row, no_candidate: false, scan_result: 'scanner_hit' }))
    .concat(missRows);
}

function workshopScannerFilterCandidatesByMode(rows, mode) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  switch (String(mode || 'all')) {
    case 'scanner-hit':
      return list.filter((row) => workshopScannerGetScanOutcome(row) === 'scanner-hit');
    case 'no-candidate':
      return list.filter((row) => workshopScannerGetScanOutcome(row) === 'no-candidate');
    case 'accepted':
      return list.filter((row) => workshopScannerGetReviewBucket(row) === 'accepted');
    case 'rejected':
      return list.filter((row) => workshopScannerGetReviewBucket(row) === 'rejected');
    case 'skipped':
      return list.filter((row) => workshopScannerGetReviewBucket(row) === 'skipped');
    case 'corrected':
      return list.filter((row) => workshopScannerGetReviewBucket(row) === 'corrected');
    case 'unreviewed':
      return list.filter((row) => workshopScannerGetReviewBucket(row) === 'unreviewed');
    case 'reviewed':
      return list.filter((row) => workshopScannerGetReviewBucket(row) !== 'unreviewed');
    default:
      return list;
  }
}

function workshopScannerRebuildCandidateView(preferredCandidateId = null) {
  const sortEl = document.getElementById('workshop-scanner-sort');
  const mode = String(sortEl?.value || 'all');
  const sourceRows = Array.isArray(workshopScannerState.allCandidates) ? workshopScannerState.allCandidates.slice() : [];
  let rows = workshopScannerFilterCandidatesByMode(sourceRows, mode);

  if (mode === 'score-desc') {
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  } else if (mode === 'score-asc') {
    rows.sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0));
  } else if (mode === 'accepted') {
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  } else if (mode === 'rejected') {
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  } else if (mode === 'reviewed') {
    rows.sort((a, b) => {
      const la = workshopScannerGetReviewBucket(a);
      const lb = workshopScannerGetReviewBucket(b);
      if (la !== lb) return la.localeCompare(lb);
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    });
  } else if (mode === 'unreviewed') {
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  }

  workshopScannerState.candidates = rows;

  if (!rows.length) {
    workshopScannerState.currentIndex = 0;
    renderWorkshopScannerCandidateList();
    workshopScannerRenderChartSymbol(null);
    workshopScannerRenderSavedIndicator(null);
    workshopScannerRenderAISuggestion(null);
    clearWorkshopScannerChartOverlays();
    if (workshopScannerState.series) {
      try {
        workshopScannerState.series.setData([]);
      } catch {}
    }
    persistWorkshopScannerSession();
    return;
  }

  let nextIndex = 0;
  const targetId = String(
    preferredCandidateId
    || rows[workshopScannerState.currentIndex]?.id
    || ''
  );
  if (targetId) {
    const byId = rows.findIndex((row) => String(row?.id || '') === targetId);
    if (byId >= 0) nextIndex = byId;
  } else {
    nextIndex = workshopScannerFindPreferredIndex(workshopScannerState.currentIndex);
    if (nextIndex < 0) nextIndex = 0;
  }

  workshopScannerState.currentIndex = nextIndex;
  renderWorkshopScannerCandidateList();
  showWorkshopScannerCandidate(workshopScannerState.currentIndex);
  persistWorkshopScannerSession();
}

function workshopScannerRenderSavedIndicator(row) {
  const el = document.getElementById('workshop-scanner-save-indicator');
  if (!el) return;
  const summary = workshopScannerGetSavedSummary(row);
  el.textContent = summary;
  el.style.color = summary === 'Saved: none' ? '' : '#22c55e';
}

function workshopScannerGetChartIntervalForRow(row) {
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const selected = String(intervalEl?.value || '').trim();
  if (selected) return selected;
  const timeframe = String(row?.timeframe || '').trim().toUpperCase();
  if (timeframe === 'W') return '1wk';
  if (timeframe === 'M') return '1mo';
  return '1d';
}

function workshopScannerChartPeriodForInterval(interval) {
  const i = String(interval || '').trim().toLowerCase();
  if (i === '1mo' || i === '1wk') return 'max';
  if (i === '1d') return '10y';
  if (i.endsWith('h')) return '730d';
  if (i.endsWith('m')) return '60d';
  return 'max';
}

function workshopScannerChartIntervalFallbacks(row) {
  const preferred = workshopScannerGetChartIntervalForRow(row);
  const tf = String(row?.timeframe || '').trim().toUpperCase();
  const out = [];
  const push = (v) => {
    const k = String(v || '').trim();
    if (!k) return;
    if (!out.includes(k)) out.push(k);
  };
  push(preferred);
  if (tf === 'W') push('1wk');
  if (tf === 'M') push('1mo');
  push('1d');
  push('1wk');
  return out;
}

async function workshopScannerEnsureChartData(row) {
  if (!row || !row.symbol) return row;
  if (Array.isArray(row.chart_data) && row.chart_data.length) return row;

  const statusEl = document.getElementById('workshop-scanner-status');
  const attempts = workshopScannerChartIntervalFallbacks(row);
  let lastError = '';
  for (let i = 0; i < attempts.length; i += 1) {
    const interval = attempts[i];
    const period = workshopScannerChartPeriodForInterval(interval);
    try {
      if (statusEl) statusEl.textContent = `Loading chart for ${row.symbol} (${interval})...`;
      const res = await fetch(`/api/chart/ohlcv?symbol=${encodeURIComponent(String(row.symbol))}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`);
      const data = await res.json();
      const bars = Array.isArray(data?.chart_data)
        ? data.chart_data
        : (Array.isArray(data?.data?.chart_data) ? data.data.chart_data : []);
      if (!res.ok || !bars.length) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      row.chart_data = bars;
      row.chart_interval = interval;
      row.chart_period = period;
      row.chart_load_error = '';
      return row;
    } catch (error) {
      lastError = error?.message || String(error || 'unknown error');
    }
  }
  row.chart_load_error = lastError || 'Failed to load chart data';
  console.warn('[workshop-scanner] failed to fetch chart data:', row?.symbol, row.chart_load_error);
  return row;
}

function workshopScannerRenderChartSymbol(row) {
  const el = document.getElementById('workshop-scanner-chart-symbol');
  if (!el) return;
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const timeframe = String(row?.timeframe || '').trim().toUpperCase();
  if (!symbol) {
    el.textContent = '--';
    return;
  }
  el.textContent = timeframe ? `${symbol} (${timeframe})` : symbol;
}

function workshopScannerSetScanSummary(scannedSymbols, producedCandidates, strictBase, methodLabel = '', patternId = '') {
  const el = document.getElementById('workshop-scanner-scan-summary');
  if (!el) return;
  const scanned = Number(scannedSymbols);
  const produced = Number(producedCandidates);
  if (!Number.isFinite(scanned) || !Number.isFinite(produced)) {
    el.textContent = 'Last scan: --';
    return;
  }
  const noCandidate = Math.max(0, scanned - produced);
  const strictText = strictBase === false ? 'off' : 'on';
  const label = String(methodLabel || '').trim();
  const pid = String(patternId || '').trim();
  const methodText = label
    ? ` | Method: ${label}${pid && pid !== label ? ` [${pid}]` : ''}`
    : (pid ? ` | Method: ${pid}` : '');
  el.textContent = `Last scan (strict base ${strictText}): ${scanned} symbols scanned; ${produced} produced candidates; ${noCandidate} with no candidate.${methodText}`;
}

function workshopScannerSetCompareSummary(text) {
  const el = document.getElementById('workshop-scanner-compare-summary');
  if (!el) return;
  el.textContent = String(text || 'Method compare: --');
}

function workshopScannerSafeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(String(text || ''));
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function workshopScannerStrictBaseEnabled() {
  const strictEl = document.getElementById('workshop-scanner-strict-base');
  if (!strictEl) return true;
  return !!strictEl.checked;
}

function workshopScannerOnePerSymbolEnabled() {
  const el = document.getElementById('workshop-scanner-one-per-symbol');
  if (!el) return true;
  return !!el.checked;
}

function workshopScannerRowScore(row) {
  const n = Number(row?.score);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function workshopScannerDeduplicateRowsBySymbol(rows, onePerSymbol) {
  const source = Array.isArray(rows) ? rows : [];
  if (!onePerSymbol) return source.slice();
  const bySymbol = new Map();
  source.forEach((row) => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) return;
    const existing = bySymbol.get(symbol);
    if (!existing || workshopScannerRowScore(row) > workshopScannerRowScore(existing)) {
      bySymbol.set(symbol, row);
    }
  });
  return Array.from(bySymbol.values()).sort((a, b) => workshopScannerRowScore(b) - workshopScannerRowScore(a));
}

function workshopScannerStoreMethodBucket(patternId, rows, meta = {}) {
  const pid = String(patternId || '').trim();
  if (!pid) return;
  workshopScannerState.methodBuckets = workshopScannerState.methodBuckets || {};
  workshopScannerState.methodBuckets[pid] = {
    patternId: pid,
    rows: Array.isArray(rows) ? rows.slice() : [],
    savedAt: new Date().toISOString(),
    strictBase: meta.strictBase !== false,
    onePerSymbol: meta.onePerSymbol !== false,
    universe: String(meta.universe || ''),
    interval: String(meta.interval || ''),
  };
}

function workshopScannerGetMethodBucket(patternId) {
  const pid = String(patternId || '').trim();
  if (!pid) return null;
  const buckets = workshopScannerState.methodBuckets || {};
  return buckets[pid] || null;
}

function workshopScannerRenderMethodCompare(report, meta = {}) {
  const resultsEl = document.getElementById('workshop-scanner-compare-results');
  if (!resultsEl) return;

  const aggregate = Array.isArray(report?.method_aggregate) ? report.method_aggregate : [];
  const usedSymbols = Number(meta.usedSymbols || report?.run_config?.symbols_count || 0);
  const elapsed = Number(report?.elapsed_ms || 0);
  const strictBase = report?.run_config?.strict_base !== false;
  workshopScannerSetCompareSummary(
    `Method compare: ${aggregate.length} methods on ${usedSymbols} symbols (${elapsed} ms, strict base ${strictBase ? 'on' : 'off'}).`
  );

  if (!aggregate.length) {
    resultsEl.innerHTML = '<div class="text-muted">No method comparison results.</div>';
    return;
  }

  const legend = `
    <div style="font-size:11px;color:var(--color-text-muted);padding:2px 2px 6px 2px;">
      <strong>Legend</strong>: <code>cov</code> = filtered candidates, <code>raw</code> = raw candidates before strict-base filter, <code>mark</code> = symbols where the method emitted a price box, <code>full</code> = symbols where it emitted price box + time window, <code>ann</code> = average base-annotation score, <code>score</code> = average filtered top score. Strict base is ${strictBase ? 'ON' : 'OFF'}.
    </div>
  `;

  resultsEl.innerHTML = legend + aggregate.map((row, idx) => {
    const rank = idx + 1;
    const pidRaw = String(row?.pattern_id || '');
    const pid = workshopScannerSafeHtml(pidRaw);
    const pidJs = pidRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const coverage = `${Number(row?.symbols_with_candidates || 0)}/${usedSymbols}`;
    const rawCoverage = `${Number(row?.symbols_with_raw_candidates || 0)}/${usedSymbols}`;
    const markCoverage = `${Number(row?.symbols_with_explicit_base_mark || 0)}/${usedSymbols}`;
    const fullCoverage = `${Number(row?.symbols_with_complete_base_mark || 0)}/${usedSymbols}`;
    const avgAnnotation = row?.avg_annotation_score == null ? '--' : Number(row.avg_annotation_score).toFixed(2);
    const avgScore = row?.avg_top_score == null ? '--' : Number(row.avg_top_score).toFixed(4);
    const avgCandidates = row?.avg_candidates_per_symbol == null ? '--' : Number(row.avg_candidates_per_symbol).toFixed(2);
    return `
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--color-border);border-radius:6px;padding:6px 8px;background:var(--color-surface);">
        <div style="font-family:var(--font-mono);font-size:11px;min-width:26px;color:var(--color-text-muted);">#${rank}</div>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);">${pid}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">cov ${coverage}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">raw ${rawCoverage}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">mark ${markCoverage}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">full ${fullCoverage}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">ann ${avgAnnotation}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">score ${avgScore}</div>
        <div style="font-size:11px;color:var(--color-text-muted);">cand ${avgCandidates}</div>
        <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;" onclick="runWorkshopSingleMethodScan('${pidJs}')">Run</button>
      </div>
    `;
  }).join('');
}

async function loadWorkshopScannerSavedFeedback() {
  workshopScannerState.labelsByCandidateId = workshopScannerState.labelsByCandidateId || {};
  workshopScannerState.correctionsByCandidateId = workshopScannerState.correctionsByCandidateId || {};
  workshopScannerState.labelsByCandidateId = {};
  workshopScannerState.correctionsByCandidateId = {};
}

async function refreshWorkshopScannerMetrics() {
  const metricsEl = document.getElementById('workshop-scanner-metrics');
  if (!metricsEl) return;

  try {
    const statsRes = await fetch('/api/labels/stats?userId=default');
    const statsData = await statsRes.json();

    if (!statsRes.ok || !statsData?.success || !statsData?.data) {
      throw new Error(statsData?.error || `Labels stats HTTP ${statsRes.status}`);
    }

    const stats = statsData.data || {};
    const total = Number(stats.totalCandidates || 0);
    const saved = Number(stats.reviewedCandidates ?? (Number(stats.totalCandidates || 0) - Number(stats.unlabeled || 0)));
    const yes = Number(stats.yesCount || 0);
    const no = Number(stats.noCount || 0);
    const skip = Number(stats.closeCount || 0);
    const unlabeled = Number(stats.unlabeled || 0);
    const corrected = Number(stats.correctedCount || 0);
    const visible = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates.length : 0;
    const queue = Array.isArray(workshopScannerState.allCandidates) ? workshopScannerState.allCandidates.length : visible;

    metricsEl.textContent = `Total: ${total} | Saved: ${saved} | YES: ${yes} | NO: ${no} | SKIP: ${skip} | Corrected: ${corrected} | Unlabeled: ${unlabeled} | Queue: ${visible}/${queue}`;
  } catch (error) {
    const visible = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates.length : '--';
    const queue = Array.isArray(workshopScannerState.allCandidates) ? workshopScannerState.allCandidates.length : visible;
    metricsEl.textContent = `Total: -- | Saved: -- | YES: -- | NO: -- | SKIP: -- | Corrected: -- | Unlabeled: -- | Queue: ${visible}/${queue}`;
  }
}

function normalizeWorkshopScannerCandidate(candidate, fallbackTimeframe = 'W') {
  if (!candidate || typeof candidate !== 'object') return null;
  return {
    ...candidate,
    id: candidate.id || candidate.candidate_id || undefined,
    symbol: candidate.symbol || 'N/A',
    timeframe: candidate.timeframe || fallbackTimeframe,
  };
}

function workshopScannerGetCurrentFilters() {
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  const universeEl = document.getElementById('workshop-scanner-universe');
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const patternId = String(indicatorEl?.value || '').trim();
  const universe = String(universeEl?.value || 'all').trim();
  const timeframe = workshopScannerIntervalToTimeframe(intervalEl?.value || '1wk');
  const symbols = Array.isArray(workshopScannerState.symbolBuckets?.[universe])
    ? workshopScannerState.symbolBuckets[universe]
    : [];
  const symbolSet = new Set(symbols.map((s) => String(s || '').trim().toUpperCase()));
  return { patternId, universe, timeframe, symbolSet };
}

function workshopScannerCandidateMatchesFilters(row, filters) {
  if (!row) return false;
  const symbol = String(row.symbol || '').trim().toUpperCase();
  const timeframe = String(row.timeframe || '').trim().toUpperCase();
  const patternType = String(row.pattern_type || '').trim();
  const strategyVersionId = String(row.strategy_version_id || '').trim();

  if (filters?.symbolSet instanceof Set && filters.symbolSet.size > 0 && !filters.symbolSet.has(symbol)) {
    return false;
  }
  if (filters?.timeframe && timeframe && timeframe !== String(filters.timeframe).toUpperCase()) {
    return false;
  }
  if (filters?.patternId) {
    const pid = String(filters.patternId);
    if (patternType && patternType !== pid) {
      // Some rows only carry strategy_version_id (e.g. scan_<pattern>_v1).
      if (!strategyVersionId.includes(pid)) return false;
    }
  }
  return true;
}

async function loadWorkshopScannerCandidatesFromQueue(preferredCandidateId = null) {
  const res = await fetch('/api/candidates');
  const data = await res.json();
  if (!res.ok || !data?.success || !Array.isArray(data.data)) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  await workshopScannerSetQueueFromRows(data.data, preferredCandidateId);
}

async function workshopScannerSetQueueFromRows(rawRows, preferredCandidateId = null) {
  const statusEl = document.getElementById('workshop-scanner-status');
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const fallbackTf = intervalEl?.value === '1wk' ? 'W' : 'D';
  const filters = workshopScannerGetCurrentFilters();
  const normalizedRows = (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => normalizeWorkshopScannerCandidate(row, fallbackTf))
    .filter((row) => !!row?.id)
    .filter((row) => workshopScannerCandidateMatchesFilters(row, filters));
  const onePerSymbol = workshopScannerOnePerSymbolEnabled();
  const rows = workshopScannerDeduplicateRowsBySymbol(normalizedRows, onePerSymbol);
  const dedupedOut = Math.max(0, normalizedRows.length - rows.length);

  // A freshly loaded queue should always start as an unlabeled review inbox.
  workshopScannerState.labelsByCandidateId = {};
  workshopScannerState.correctionsByCandidateId = {};
  workshopScannerState.allCandidates = rows;
  workshopScannerState.candidates = [];

  if (!rows.length) {
    workshopScannerState.currentIndex = 0;
    renderWorkshopScannerCandidateList();
    workshopScannerRenderChartSymbol(null);
    workshopScannerRenderSavedIndicator(null);
    if (statusEl) statusEl.textContent = 'No candidates in queue for current filters.';
    await refreshWorkshopScannerMetrics();
    persistWorkshopScannerSession();
    return;
  }

  let idx = workshopScannerFindPreferredIndex(0);
  if (preferredCandidateId) {
    const byId = rows.findIndex((r) => String(r?.id || '') === String(preferredCandidateId));
    if (byId >= 0) idx = workshopScannerFindPreferredIndex(byId);
  }
  workshopScannerState.currentIndex = idx >= 0 ? idx : 0;
  workshopScannerRebuildCandidateView(preferredCandidateId);

  const unlabeled = rows.filter((r) => !workshopScannerIsReviewed(r)).length;
  if (statusEl) {
    statusEl.textContent = onePerSymbol
      ? `Queue loaded: ${rows.length} symbols (${unlabeled} unlabeled, ${dedupedOut} deduped).`
      : `Queue loaded: ${rows.length} candidates (${unlabeled} unlabeled).`;
  }
  await refreshWorkshopScannerMetrics();
}

function workshopScannerClearActiveQueue(statusText = '') {
  workshopScannerState.allCandidates = [];
  workshopScannerState.candidates = [];
  workshopScannerState.currentIndex = 0;
  workshopScannerState.currentSafeBars = [];
  workshopScannerState.correctionMode = null;
  workshopScannerState.correctionDraft = null;
  renderWorkshopScannerCandidateList();
  workshopScannerRenderChartSymbol(null);
  workshopScannerRenderSavedIndicator(null);
  workshopScannerRenderAISuggestion(null);
  clearWorkshopScannerChartOverlays();
  if (workshopScannerState.series) {
    try {
      workshopScannerState.series.setData([]);
    } catch {}
  }
  if (workshopScannerState.chart) {
    try {
      workshopScannerState.chart.timeScale().fitContent();
    } catch {}
  }
  const statusEl = document.getElementById('workshop-scanner-status');
  if (statusEl && statusText) statusEl.textContent = statusText;
  persistWorkshopScannerSession();
  refreshWorkshopScannerMetrics().catch(() => {});
}

function workshopScannerRemoveCandidateFromActiveQueue(candidateId) {
  const cid = String(candidateId || '').trim();
  if (!cid) return false;

  if (!Array.isArray(workshopScannerState.allCandidates) || !workshopScannerState.allCandidates.length) {
    persistWorkshopScannerSession();
    return false;
  }

  workshopScannerRebuildCandidateView(cid);
  return true;
}

function workshopScannerSafeSetSelectValue(selectEl, value) {
  if (!selectEl || value == null) return;
  const target = String(value || '');
  const found = Array.from(selectEl.options || []).some((opt) => String(opt.value || '') === target);
  if (found) {
    selectEl.value = target;
    workshopScannerState.selectedPatternId = target;
    workshopScannerSetIndicatorTriggerLabel();
  }
}

function workshopScannerGetIndicatorTriggerLabel() {
  const triggerLabelEl = document.getElementById('workshop-scanner-indicator-trigger-label');
  return triggerLabelEl;
}

function workshopScannerSetIndicatorTriggerLabel() {
  const triggerLabelEl = workshopScannerGetIndicatorTriggerLabel();
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  if (!triggerLabelEl || !indicatorEl) return;
  const selectedOption = Array.from(indicatorEl.options || []).find((opt) => opt.value === indicatorEl.value);
  if (!selectedOption) {
    triggerLabelEl.textContent = 'Select a pattern';
    triggerLabelEl.classList.add('workshop-method-picker__label-muted');
    return;
  }
  triggerLabelEl.textContent = selectedOption.textContent || selectedOption.value;
  triggerLabelEl.classList.remove('workshop-method-picker__label-muted');
}

function workshopScannerOpenIndicatorMenu() {
  const menuEl = document.getElementById('workshop-scanner-indicator-menu');
  const triggerEl = document.getElementById('workshop-scanner-indicator-trigger');
  if (!menuEl || !triggerEl) return;
  menuEl.classList.remove('hidden');
  triggerEl.setAttribute('aria-expanded', 'true');
}

function workshopScannerCloseIndicatorMenu() {
  const menuEl = document.getElementById('workshop-scanner-indicator-menu');
  const triggerEl = document.getElementById('workshop-scanner-indicator-trigger');
  if (!menuEl || !triggerEl) return;
  menuEl.classList.add('hidden');
  triggerEl.setAttribute('aria-expanded', 'false');
}

function workshopScannerToggleIndicatorMenu() {
  const menuEl = document.getElementById('workshop-scanner-indicator-menu');
  if (!menuEl) return;
  if (menuEl.classList.contains('hidden')) {
    workshopScannerOpenIndicatorMenu();
  } else {
    workshopScannerCloseIndicatorMenu();
  }
}

function workshopScannerSyncIndicatorSelect(patternId) {
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  if (!indicatorEl) return false;
  const pid = String(patternId || '').trim();
  const found = Array.from(indicatorEl.options || []).some((opt) => String(opt.value || '') === pid);
  if (!found) return false;
  indicatorEl.value = pid;
  workshopScannerSetIndicatorTriggerLabel();
  return true;
}

async function workshopScannerSelectPattern(patternId) {
  const synced = workshopScannerSyncIndicatorSelect(patternId);
  workshopScannerCloseIndicatorMenu();
  if (!synced) return;
  await workshopScannerHandlePatternChange();
}

async function workshopScannerLoadTombstonedPatterns() {
  try {
    const res = await fetch('/api/plugins/scanner/tombstones');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data?.entries)) {
      workshopScannerState.tombstonedPatternIds = new Set();
      return;
    }
    workshopScannerState.tombstonedPatternIds = new Set(
      data.data.entries
        .map((entry) => String(entry?.pattern_id || '').trim())
        .filter((id) => !!id),
    );
  } catch {
    workshopScannerState.tombstonedPatternIds = new Set();
  }
}

function workshopScannerRenderIndicatorPicker() {
  const menuEl = document.getElementById('workshop-scanner-indicator-menu');
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  if (!menuEl || !indicatorEl) return;

  const tombstoned = workshopScannerState.tombstonedPatternIds instanceof Set
    ? workshopScannerState.tombstonedPatternIds
    : new Set();
  const options = Array.isArray(workshopScannerState.options)
    ? workshopScannerState.options.filter((opt) => !tombstoned.has(String(opt?.pattern_id || '').trim()))
    : [];

  indicatorEl.innerHTML = '';
  options.forEach((o) => {
    const option = document.createElement('option');
    option.value = o.pattern_id;
    option.textContent = `${o.name} (${String(o?.artifact_type || 'indicator').toLowerCase()})`;
    indicatorEl.appendChild(option);
  });

  const currentValue = String(workshopScannerState.selectedPatternId || indicatorEl.value || '');
  const hasCurrent = options.some((opt) => String(opt.pattern_id || '') === currentValue);
  if (hasCurrent) {
    indicatorEl.value = currentValue;
  } else if (options.length) {
    indicatorEl.value = String(options[0].pattern_id || '');
  } else {
    indicatorEl.value = '';
  }
  workshopScannerState.selectedPatternId = indicatorEl.value || '';

  if (!options.length) {
    menuEl.innerHTML = '<div class="workshop-method-picker__empty">No active pattern scanner methods.</div>';
    workshopScannerSetIndicatorTriggerLabel();
    return;
  }

  menuEl.innerHTML = options.map((option) => {
    const pid = workshopScannerSafeHtml(option.pattern_id);
    const pidJs = String(option.pattern_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const selectedClass = String(option.pattern_id || '') === String(indicatorEl.value || '') ? ' is-selected' : '';
    const meta = `${workshopScannerSafeHtml(String(option.artifact_type || 'indicator').toLowerCase())} | ${workshopScannerSafeHtml(option.category || 'custom')}`;
    return `
      <div class="workshop-method-picker__row${selectedClass}">
        <button type="button" class="workshop-method-picker__option" role="option" aria-selected="${selectedClass ? 'true' : 'false'}" onclick="workshopScannerSelectPattern('${pidJs}')">
          <span class="workshop-method-picker__option-name">${workshopScannerSafeHtml(option.name || option.pattern_id)}</span>
          <span class="workshop-method-picker__option-meta">${meta}</span>
        </button>
        <button type="button" class="workshop-method-picker__tombstone" title="Tombstone ${workshopScannerSafeHtml(option.name || option.pattern_id)}" aria-label="Tombstone ${workshopScannerSafeHtml(option.name || option.pattern_id)}" onclick="workshopScannerTombstonePattern('${pidJs}')">X</button>
      </div>
    `;
  }).join('');

  workshopScannerSetIndicatorTriggerLabel();
}

function bindWorkshopIndicatorPicker() {
  if (workshopScannerState.indicatorPickerBound) return;
  workshopScannerState.indicatorPickerBound = true;

  document.addEventListener('click', (event) => {
    const picker = document.getElementById('workshop-scanner-indicator-picker');
    if (!picker) return;
    if (picker.contains(event.target)) return;
    workshopScannerCloseIndicatorMenu();
  });
}

async function workshopScannerTombstonePattern(patternId) {
  const pid = String(patternId || '').trim();
  if (!pid) return;
  const option = Array.isArray(workshopScannerState.options)
    ? workshopScannerState.options.find((row) => String(row?.pattern_id || '') === pid)
    : null;
  const displayName = String(option?.name || pid);
  const confirmed = confirm(`Tombstone "${displayName}"?\n\nThis removes it from the active pattern scanner list without deleting the underlying pattern.`);
  if (!confirmed) return;

  const statusEl = document.getElementById('workshop-scanner-status');
  try {
    const res = await fetch('/api/plugins/scanner/tombstones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patternId: pid,
        source: 'workshop_dropdown_x',
        reason: 'User tombstoned from workshop pattern picker',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    workshopScannerState.tombstonedPatternIds = workshopScannerState.tombstonedPatternIds instanceof Set
      ? workshopScannerState.tombstonedPatternIds
      : new Set();
    workshopScannerState.tombstonedPatternIds.add(pid);
    if (workshopScannerState.methodBuckets) {
      delete workshopScannerState.methodBuckets[pid];
    }

    const currentPatternId = String(document.getElementById('workshop-scanner-indicator')?.value || '');
    workshopScannerState.selectedPatternId = currentPatternId === pid ? '' : currentPatternId;
    workshopScannerRenderIndicatorPicker();
    workshopScannerCloseIndicatorMenu();

    const nextPatternId = String(document.getElementById('workshop-scanner-indicator')?.value || '');
    if (nextPatternId && nextPatternId !== pid) {
      workshopScannerState.selectedPatternId = nextPatternId;
      await workshopScannerHandlePatternChange();
    }
    if (statusEl) statusEl.textContent = `Tombstoned method: ${displayName}`;
  } catch (error) {
    if (statusEl) statusEl.textContent = `Failed to tombstone ${displayName}: ${error.message || 'Unknown error'}`;
  }
}

function persistWorkshopScannerSession() {
  try {
    const indicatorEl = document.getElementById('workshop-scanner-indicator');
    const universeEl = document.getElementById('workshop-scanner-universe');
    const intervalEl = document.getElementById('workshop-scanner-interval');
    const strictBaseEl = document.getElementById('workshop-scanner-strict-base');
    const onePerSymbolEl = document.getElementById('workshop-scanner-one-per-symbol');
    const rows = Array.isArray(workshopScannerState.allCandidates) ? workshopScannerState.allCandidates : [];
    const candidateIds = rows
      .map((row) => String(row?.id || row?.candidate_id || ''))
      .filter((id) => !!id);

    const payload = {
      patternId: String(indicatorEl?.value || ''),
      universe: String(universeEl?.value || 'all'),
      interval: String(intervalEl?.value || '1wk'),
      strictBase: !!(strictBaseEl ? strictBaseEl.checked : true),
      onePerSymbol: !!(onePerSymbolEl ? onePerSymbolEl.checked : true),
      candidateIds,
      currentIndex: Number(workshopScannerState.currentIndex || 0),
      currentCandidateId: String(workshopScannerState.candidates?.[workshopScannerState.currentIndex]?.id || ''),
      skipReviewed: workshopScannerShouldSkipReviewed(),
      sortMode: String(document.getElementById('workshop-scanner-sort')?.value || 'all'),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(WORKSHOP_SCANNER_SESSION_KEY, JSON.stringify(payload));
  } catch {}
}

async function restoreWorkshopScannerSession() {
  const statusEl = document.getElementById('workshop-scanner-status');
  try {
    const raw = localStorage.getItem(WORKSHOP_SCANNER_SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;

    const indicatorEl = document.getElementById('workshop-scanner-indicator');
    const universeEl = document.getElementById('workshop-scanner-universe');
    const intervalEl = document.getElementById('workshop-scanner-interval');
    const strictBaseEl = document.getElementById('workshop-scanner-strict-base');
    const onePerSymbolEl = document.getElementById('workshop-scanner-one-per-symbol');
    const skipReviewedEl = document.getElementById('workshop-scanner-skip-reviewed');
    const sortEl = document.getElementById('workshop-scanner-sort');
    workshopScannerSafeSetSelectValue(indicatorEl, saved.patternId);
    workshopScannerSafeSetSelectValue(universeEl, saved.universe);
    workshopScannerSafeSetSelectValue(intervalEl, saved.interval);
    if (strictBaseEl && typeof saved.strictBase === 'boolean') {
      strictBaseEl.checked = saved.strictBase;
    }
    if (onePerSymbolEl && typeof saved.onePerSymbol === 'boolean') {
      onePerSymbolEl.checked = saved.onePerSymbol;
    }
    if (skipReviewedEl && typeof saved.skipReviewed === 'boolean') {
      skipReviewedEl.checked = saved.skipReviewed;
    }
    if (sortEl && saved.sortMode) {
      sortEl.value = String(saved.sortMode);
    }
    workshopScannerApplyUniverseFilter();

    const candidateIds = Array.isArray(saved.candidateIds)
      ? saved.candidateIds.map((id) => String(id || '')).filter((id) => !!id)
      : [];
    const idxRaw = Number(saved.currentIndex || 0);
    const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.floor(idxRaw)) : 0;
    const preferredId = String(saved.currentCandidateId || candidateIds[idx] || '').trim() || null;

    if (statusEl) statusEl.textContent = 'Restoring scanner queue...';
    await loadWorkshopScannerCandidatesFromQueue(preferredId);
    return true;
  } catch (error) {
    if (statusEl) statusEl.textContent = `Session restore failed: ${error.message || 'Unknown error'}`;
    return false;
  }
}

async function loadWorkshopScannerOptions() {
  const select = document.getElementById('workshop-scanner-indicator');
  if (!select) return;
  try {
    await workshopScannerLoadTombstonedPatterns();
    const res = await fetch('/api/plugins/scanner/options');
    const data = await res.json();
    const allOptions = res.ok && data?.success && Array.isArray(data.data) ? data.data : [];
    const baseSet = new Set(WORKSHOP_BASE_METHOD_IDS);
    const options = allOptions.filter((o) => {
      const artifactType = String(o?.artifact_type || '').toLowerCase();
      const patternId = String(o?.pattern_id || '').trim();
      const patternType = String(o?.pattern_type || '').trim();
      if (artifactType === 'pattern') return true;
      if (baseSet.has(patternId) || baseSet.has(patternType)) return true;
      return false;
    });
    workshopScannerState.options = options;
    workshopScannerState.byPatternId = {};
    // Base methods first, then alphabetical.
    options.sort((a, b) => {
      const aBase = WORKSHOP_BASE_METHOD_IDS.includes(String(a?.pattern_id || '')) ? 0 : 1;
      const bBase = WORKSHOP_BASE_METHOD_IDS.includes(String(b?.pattern_id || '')) ? 0 : 1;
      if (aBase !== bBase) return aBase - bBase;
      return String(a?.name || a?.pattern_id || '').localeCompare(String(b?.name || b?.pattern_id || ''));
    });
    options.forEach((o) => {
      workshopScannerState.byPatternId[o.pattern_id] = o;
    });
    workshopScannerRenderIndicatorPicker();
  } catch (error) {
    select.innerHTML = '';
    workshopScannerState.options = [];
    workshopScannerRenderIndicatorPicker();
  }
}

async function loadWorkshopScannerSymbolCatalog() {
  try {
    const res = await fetch('/api/candidates/symbols');
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data || typeof data.data !== 'object') {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const raw = data.data;
    const bucketKeys = ['all', 'futures', 'commodities', 'crypto', 'indices', 'sectors', 'international', 'bonds', 'smallcaps', 'optionable'];
    const bucketMap = {};
    bucketKeys.forEach((key) => {
      const arr = Array.isArray(raw[key]) ? raw[key] : [];
      const cleaned = arr
        .map((sym) => String(sym || '').trim().toUpperCase())
        .filter((sym) => !!sym);
      bucketMap[key] = Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b));
    });

    const allSet = new Set(Array.isArray(bucketMap.all) ? bucketMap.all : []);
    let baseTest40 = WORKSHOP_BASE_TEST_40.filter((sym) => allSet.has(sym));
    if (baseTest40.length < 40 && Array.isArray(bucketMap.optionable)) {
      for (const sym of bucketMap.optionable) {
        if (baseTest40.length >= 40) break;
        if (!allSet.has(sym)) continue;
        if (baseTest40.includes(sym)) continue;
        baseTest40.push(sym);
      }
    }
    bucketMap.base_test_40 = baseTest40;

    workshopScannerState.symbolBuckets = bucketMap;
    workshopScannerState.symbolCatalog = bucketMap.all || [];
  } catch {
    workshopScannerState.symbolBuckets = {
      base_test_40: WORKSHOP_BASE_TEST_40.slice(0, 40),
      all: ['DIA', 'IWM', 'QQQ', 'SPY', 'VTI'],
      futures: [],
      commodities: [],
      crypto: [],
      indices: ['DIA', 'IWM', 'QQQ', 'SPY', 'VTI'],
      sectors: [],
      international: [],
      bonds: [],
      smallcaps: [],
      optionable: [],
    };
    workshopScannerState.symbolCatalog = workshopScannerState.symbolBuckets.all;
  }
  workshopScannerApplyUniverseFilter();
}

function workshopScannerApplyUniverseFilter() {
  const universeEl = document.getElementById('workshop-scanner-universe');
  const countEl = document.getElementById('workshop-scanner-universe-count');
  if (!universeEl) return;

  const bucket = String(universeEl.value || 'all');
  const symbols = Array.isArray(workshopScannerState.symbolBuckets?.[bucket])
    ? workshopScannerState.symbolBuckets[bucket]
    : (workshopScannerState.symbolCatalog || []);
  workshopScannerState.activeUniverseSymbols = symbols;
  if (countEl) {
    countEl.textContent = `Universe: ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}`;
  }
}

function normalizeWorkshopScannerSymbol(raw) {
  const input = String(raw || '').trim().toUpperCase();
  if (!input) return '';

  // Human-friendly aliases
  const normalizedKey = input.replace(/\s+/g, ' ').trim();
  const aliasMap = {
    'S&P500': 'SPY',
    'S&P 500': 'SPY',
    'SP500': 'SPY',
    'S AND P 500': 'SPY',
    'SNP500': 'SPY',
    '^GSPC': 'SPY',
  };

  if (aliasMap[normalizedKey]) return aliasMap[normalizedKey];
  return input;
}

function initWorkshopScannerChart() {
  if (workshopScannerState.chart) return;
  const container = document.getElementById('workshop-scanner-chart');
  if (!container || !window.LightweightCharts) return;
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Pattern scanner chart');

  workshopScannerState.chart = window.LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 420,
    layout: {
      background: { color: '#1e1e1e' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#374151' },
      horzLines: { color: '#374151' },
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#4b5563',
      // Keep the visible scale anchored at/above zero for price charts.
      scaleMargins: { top: 0.1, bottom: 0 },
    },
    timeScale: { borderColor: '#4b5563', timeVisible: true },
  });

  workshopScannerState.series = workshopScannerState.chart.addSeries(window.LightweightCharts.CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    // Defensive floor: never allow autoscale to propose negative prices.
    autoscaleInfoProvider: (baseImplementation) => {
      const info = typeof baseImplementation === 'function' ? baseImplementation() : null;
      if (!info || !info.priceRange) return info;
      if (Number.isFinite(info.priceRange.minValue) && info.priceRange.minValue < 0) {
        info.priceRange.minValue = 0;
      }
      if (Number.isFinite(info.priceRange.maxValue) && info.priceRange.maxValue < 0) {
        info.priceRange.maxValue = 0;
      }
      return info;
    },
  });

  workshopScannerState.overlaySeries = [];
  workshopScannerState.overlayPriceLines = [];
  workshopScannerState.markersPrimitive = null;
  workshopScannerState.currentSafeBars = [];
  workshopScannerState.correctionMode = null;
  workshopScannerState.correctionDraft = null;
  workshopScannerState.correctionsByCandidateId = workshopScannerState.correctionsByCandidateId || {};

  container.addEventListener('mousedown', () => {
    // Give keyboard focus to the chart so arrow navigation is immediate.
    try { container.focus({ preventScroll: true }); } catch { container.focus(); }
  });

  new ResizeObserver(() => {
    if (!workshopScannerState.chart) return;
    workshopScannerState.chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight || 420,
    });
  }).observe(container);

  if (!workshopScannerState.keyHandlerBound) {
    workshopScannerState.keyHandlerBound = true;
    document.addEventListener('keydown', handleWorkshopScannerArrowNavigation);
  }

  workshopScannerState.chart.subscribeClick((param) => {
    handleWorkshopScannerChartClick(param);
  });

  // Attach universal drawing tools module
  if (typeof DrawingToolsManager !== 'undefined') {
    if (window._workshopDrawingTools) window._workshopDrawingTools.destroy();
    window._workshopDrawingTools = new DrawingToolsManager(
      workshopScannerState.chart, workshopScannerState.series, container,
      {
        getBars: () => Array.isArray(workshopScannerState.currentSafeBars) ? workshopScannerState.currentSafeBars : [],
      }
    );
    const tbEl = document.getElementById('workshop-dt-toolbar');
    if (tbEl) {
      DrawingToolsManager.attachToolbar(tbEl, 'workshop-scanner-chart', window._workshopDrawingTools);
    }
  }
}

function shouldHandleWorkshopScannerArrowKey(event) {
  if (currentWorkshopTab !== 'scanner') return false;
  if (!event || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false;

  const activeEl = document.activeElement;
  const chartEl = document.getElementById('workshop-scanner-chart');
  const isTypingTarget = !!activeEl && (
    activeEl.tagName === 'INPUT' ||
    activeEl.tagName === 'TEXTAREA' ||
    activeEl.tagName === 'SELECT' ||
    activeEl.isContentEditable
  );

  // Allow chart-focused navigation even when the focused element is technically focusable.
  if (isTypingTarget && activeEl !== chartEl) return false;
  return true;
}

function handleWorkshopScannerArrowNavigation(event) {
  if (!shouldHandleWorkshopScannerArrowKey(event)) return;
  const rows = Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates : [];
  if (!rows.length) return;

  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  const nextIndex = workshopScannerFindNextIndex(workshopScannerState.currentIndex, direction);
  if (nextIndex < 0) return;
  showWorkshopScannerCandidate(nextIndex);
}

function bindWorkshopCorrectionInputs() {
  if (workshopScannerState.correctionInputsBound) return;
  workshopScannerState.correctionInputsBound = true;

  const topInput = document.getElementById('workshop-scanner-correction-top');
  const bottomInput = document.getElementById('workshop-scanner-correction-bottom');
  const applyFn = () => {
    const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
    if (!row) return;
    workshopScannerEnsureCorrectionDraft(row);
    if (topInput) {
      const top = Number(topInput.value);
      if (Number.isFinite(top)) workshopScannerState.correctionDraft.baseTop = top;
    }
    if (bottomInput) {
      const bottom = Number(bottomInput.value);
      if (Number.isFinite(bottom)) workshopScannerState.correctionDraft.baseBottom = bottom;
    }
    drawWorkshopScannerChart(row);
  };

  if (topInput) topInput.addEventListener('input', applyFn);
  if (bottomInput) bottomInput.addEventListener('input', applyFn);
}

function bindWorkshopScannerPreferenceInputs() {
  if (workshopScannerState.preferenceInputsBound) return;
  workshopScannerState.preferenceInputsBound = true;

  const skipReviewedEl = document.getElementById('workshop-scanner-skip-reviewed');
  if (skipReviewedEl) {
    skipReviewedEl.addEventListener('change', () => {
      persistWorkshopScannerSession();
      if (skipReviewedEl.checked && workshopScannerState.candidates.length) {
        const next = workshopScannerFindPreferredIndex(workshopScannerState.currentIndex);
        if (next >= 0 && next !== workshopScannerState.currentIndex) {
          showWorkshopScannerCandidate(next);
          return;
        }
      }
      renderWorkshopScannerCandidateList();
    });
  }
}

function clearWorkshopScannerChartOverlays() {
  if (!workshopScannerState.chart) return;

  const overlays = Array.isArray(workshopScannerState.overlaySeries) ? workshopScannerState.overlaySeries : [];
  overlays.forEach((series) => {
    try { workshopScannerState.chart.removeSeries(series); } catch {}
  });
  workshopScannerState.overlaySeries = [];

  const priceLines = Array.isArray(workshopScannerState.overlayPriceLines) ? workshopScannerState.overlayPriceLines : [];
  priceLines.forEach((line) => {
    try { workshopScannerState.series.removePriceLine(line); } catch {}
  });
  workshopScannerState.overlayPriceLines = [];

  if (workshopScannerState.markersPrimitive) {
    try { workshopScannerState.markersPrimitive.setMarkers([]); } catch {}
    try { workshopScannerState.series.detachPrimitive(workshopScannerState.markersPrimitive); } catch {}
    workshopScannerState.markersPrimitive = null;
  }
}

function toWorkshopChartTime(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.slice(0, 10);
  return raw;
}

function workshopLineStyleToNumber(style) {
  if (typeof style === 'number') return style;
  const s = String(style || '').toLowerCase();
  if (s === 'dashed' || s === 'dash') return 2;
  if (s === 'dotted' || s === 'dot') return 1;
  return 0;
}

function workshopScannerFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function workshopScannerTimeFromBarIndex(safeBars, idx) {
  const i = Number(idx);
  if (!Array.isArray(safeBars) || !Number.isFinite(i)) return null;
  const clamped = Math.max(0, Math.min(safeBars.length - 1, Math.floor(i)));
  const bar = safeBars[clamped];
  return bar ? toWorkshopChartTime(bar.time) : null;
}

function workshopScannerFindRangeHigh(safeBars, startIdx, endIdx) {
  if (!Array.isArray(safeBars) || !safeBars.length) return null;
  const start = Math.max(0, Math.min(safeBars.length - 1, Math.floor(Number(startIdx) || 0)));
  const end = Math.max(start, Math.min(safeBars.length - 1, Math.floor(Number(endIdx) || start)));
  let bestIdx = null;
  let bestHigh = null;
  for (let i = start; i <= end; i += 1) {
    const high = workshopScannerFiniteNumber(safeBars[i]?.high);
    if (high == null) continue;
    if (bestHigh == null || high > bestHigh) {
      bestHigh = high;
      bestIdx = i;
    }
  }
  return bestIdx == null || bestHigh == null ? null : { idx: bestIdx, price: bestHigh };
}

function workshopScannerCreateMarker(time, position, color, shape, text) {
  if (time == null) return null;
  return { time, position, color, shape, text };
}

function workshopScannerStandardizeMarkerText(rawText, fallbackPrefix) {
  const text = String(rawText || '').trim();
  if (!text) return '';
  const priceMatch = text.match(/\$?\s*(-?\d+(?:\.\d+)?)/);
  const priceText = priceMatch ? ` ${Number(priceMatch[1]).toFixed(2)}` : '';
  return `${fallbackPrefix}${priceText}`.trim();
}

function workshopScannerExtractReviewBaseBox(candidate, safeBars) {
  const ports = candidate?.output_ports && typeof candidate.output_ports === 'object'
    ? candidate.output_ports
    : {};

  const boxBest = ports?.base_boxes?.best && typeof ports.base_boxes.best === 'object'
    ? ports.base_boxes.best
    : null;
  if (boxBest) {
    const top = workshopScannerFiniteNumber(boxBest.ceiling);
    const bottom = workshopScannerFiniteNumber(boxBest.floor);
    const startIdx = workshopScannerFiniteNumber(boxBest.base_start_idx);
    const endIdx = workshopScannerFiniteNumber(boxBest.base_end_idx);
    return {
      top,
      bottom,
      leftTime: workshopScannerTimeFromBarIndex(safeBars, startIdx),
      rightTime: workshopScannerTimeFromBarIndex(safeBars, endIdx),
      startIdx,
      endIdx,
      source: 'base_boxes.best',
    };
  }

  const wiggleEvents = Array.isArray(ports?.rdp_wiggle_base?.events) ? ports.rdp_wiggle_base.events : [];
  if (wiggleEvents.length) {
    const best = wiggleEvents
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => {
        const aq = Number(a.qualify_idx != null);
        const bq = Number(b.qualify_idx != null);
        if (aq !== bq) return bq - aq;
        const aa = Number(!!a.active);
        const ba = Number(!!b.active);
        if (aa !== ba) return ba - aa;
        return 0;
      })[0];
    if (best) {
      const startIdx = workshopScannerFiniteNumber(best.anchor_idx);
      const endIdx =
        workshopScannerFiniteNumber(best.base_end_idx) ??
        workshopScannerFiniteNumber(best.escape_idx) ??
        (Array.isArray(safeBars) && safeBars.length ? safeBars.length - 1 : null);
      return {
        top: workshopScannerFiniteNumber(best.cap_price),
        bottom: workshopScannerFiniteNumber(best.base_floor ?? best.anchor_price),
        leftTime: workshopScannerTimeFromBarIndex(safeBars, startIdx),
        rightTime: workshopScannerTimeFromBarIndex(safeBars, endIdx),
        startIdx,
        endIdx,
        source: 'rdp_wiggle_base.events',
      };
    }
  }

  const flatEvents = Array.isArray(ports?.rdp_flat_base?.events) ? ports.rdp_flat_base.events : [];
  if (flatEvents.length) {
    const best = flatEvents
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => Number(!!b.active) - Number(!!a.active))[0];
    if (best) {
      const startIdx = workshopScannerFiniteNumber(best.base_start_idx ?? best.anchor_idx);
      const endIdx =
        workshopScannerFiniteNumber(best.invalidate_idx) ??
        workshopScannerFiniteNumber(best.base_end_idx ?? best.flatten_idx) ??
        (Array.isArray(safeBars) && safeBars.length ? safeBars.length - 1 : null);
      return {
        top: workshopScannerFiniteNumber(best.base_ceiling),
        bottom: workshopScannerFiniteNumber(best.base_floor),
        leftTime: workshopScannerTimeFromBarIndex(safeBars, startIdx),
        rightTime: workshopScannerTimeFromBarIndex(safeBars, endIdx),
        startIdx,
        endIdx,
        source: 'rdp_flat_base.events',
      };
    }
  }

  const base75Rows = Array.isArray(ports?.rdp_base_75?.bases) ? ports.rdp_base_75.bases : [];
  if (base75Rows.length) {
    const best = base75Rows
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => Number(!!b.broken_out) - Number(!!a.broken_out))[0];
    if (best) {
      const startIdx = workshopScannerFiniteNumber(best.low_idx);
      const endIdx = Array.isArray(safeBars) && safeBars.length ? safeBars.length - 1 : null;
      return {
        top: workshopScannerFiniteNumber(best.base_ceiling),
        bottom: workshopScannerFiniteNumber(best.base_floor),
        leftTime: workshopScannerTimeFromBarIndex(safeBars, startIdx),
        rightTime: workshopScannerTimeFromBarIndex(safeBars, endIdx),
        startIdx,
        endIdx,
        source: 'rdp_base_75.bases',
      };
    }
  }

  const base = candidate?.base && typeof candidate.base === 'object' ? candidate.base : null;
  if (base) {
    const top = workshopScannerFiniteNumber(base.high);
    const bottom = workshopScannerFiniteNumber(base.low);
    const startIdx = workshopScannerFiniteNumber(candidate?.chart_base_start);
    const endIdx = workshopScannerFiniteNumber(candidate?.chart_base_end);
    return {
      top,
      bottom,
      leftTime: workshopScannerTimeFromBarIndex(safeBars, startIdx),
      rightTime: workshopScannerTimeFromBarIndex(safeBars, endIdx),
      startIdx,
      endIdx,
      source: 'candidate.base',
    };
  }

  return null;
}

function workshopScannerExtractReviewMarkers(candidate, safeBars, baseBox) {
  const markers = [];
  const ports = candidate?.output_ports && typeof candidate.output_ports === 'object'
    ? candidate.output_ports
    : {};

  const base75Rows = Array.isArray(ports?.rdp_base_75?.bases) ? ports.rdp_base_75.bases : [];
  if (base75Rows.length) {
    const best = base75Rows
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => Number(!!b.broken_out) - Number(!!a.broken_out))[0];
    if (best) {
      const highTime = workshopScannerTimeFromBarIndex(safeBars, best.high_idx);
      const lowTime = workshopScannerTimeFromBarIndex(safeBars, best.low_idx);
      const highPrice = workshopScannerFiniteNumber(best.high_price);
      const lowPrice = workshopScannerFiniteNumber(best.low_price);
      if (highTime && highPrice != null) markers.push(workshopScannerCreateMarker(highTime, 'aboveBar', '#f59e0b', 'arrowDown', `H ${highPrice.toFixed(2)}`));
      if (lowTime && lowPrice != null) markers.push(workshopScannerCreateMarker(lowTime, 'belowBar', '#22c55e', 'arrowUp', `L ${lowPrice.toFixed(2)}`));
      return markers.filter(Boolean);
    }
  }

  const wiggleEvents = Array.isArray(ports?.rdp_wiggle_base?.events) ? ports.rdp_wiggle_base.events : [];
  if (wiggleEvents.length) {
    const best = wiggleEvents
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => Number(!!b.active) - Number(!!a.active))[0];
    if (best) {
      const highTime = workshopScannerTimeFromBarIndex(safeBars, best.prior_high_idx);
      const lowTime = workshopScannerTimeFromBarIndex(safeBars, best.anchor_idx);
      const highPrice = workshopScannerFiniteNumber(best.prior_high_price ?? best.cap_price);
      const lowPrice = workshopScannerFiniteNumber(best.anchor_price ?? best.base_floor);
      if (highTime && highPrice != null) markers.push(workshopScannerCreateMarker(highTime, 'aboveBar', '#f59e0b', 'arrowDown', `H ${highPrice.toFixed(2)}`));
      if (lowTime && lowPrice != null) markers.push(workshopScannerCreateMarker(lowTime, 'belowBar', '#22c55e', 'arrowUp', `L ${lowPrice.toFixed(2)}`));
      return markers.filter(Boolean);
    }
  }

  const flatEvents = Array.isArray(ports?.rdp_flat_base?.events) ? ports.rdp_flat_base.events : [];
  if (flatEvents.length) {
    const best = flatEvents
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => Number(!!b.active) - Number(!!a.active))[0];
    if (best) {
      const lowTime = workshopScannerTimeFromBarIndex(safeBars, best.anchor_idx);
      const lowPrice = workshopScannerFiniteNumber(best.anchor_price ?? best.base_floor);
      if (lowTime && lowPrice != null) markers.push(workshopScannerCreateMarker(lowTime, 'belowBar', '#22c55e', 'arrowUp', `L ${lowPrice.toFixed(2)}`));

      const highRange = workshopScannerFindRangeHigh(
        safeBars,
        best.base_start_idx ?? best.anchor_idx,
        best.base_end_idx ?? best.flatten_idx ?? baseBox?.endIdx,
      );
      if (highRange?.idx != null && highRange?.price != null) {
        const highTime = workshopScannerTimeFromBarIndex(safeBars, highRange.idx);
        if (highTime) markers.push(workshopScannerCreateMarker(highTime, 'aboveBar', '#f59e0b', 'arrowDown', `H ${highRange.price.toFixed(2)}`));
      }
      return markers.filter(Boolean);
    }
  }

  const rawMarkers = Array.isArray(candidate?.visual?.markers) ? candidate.visual.markers : [];
  rawMarkers.forEach((m) => {
    const time = toWorkshopChartTime(m?.time);
    const text = String(m?.text || '').trim();
    if (!time || !text) return;
    const position = typeof m?.position === 'string' && m.position ? m.position : (/^L\b/i.test(text) || /FLOOR/i.test(text) ? 'belowBar' : 'aboveBar');
    const color = typeof m?.color === 'string' && m.color ? m.color : (position === 'belowBar' ? '#22c55e' : '#f59e0b');
    const shape = typeof m?.shape === 'string' && m.shape ? m.shape : (position === 'belowBar' ? 'arrowUp' : 'arrowDown');
    markers.push(workshopScannerCreateMarker(time, position, color, shape, text));
  });

  const seen = new Set();
  return markers.filter((m) => {
    if (!m) return false;
    const key = `${m.time}|${m.text}|${m.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workshopScannerFindBarIndexByTime(safeBars, rawTime) {
  const target = workshopScannerNormalizeDateString(rawTime);
  if (!target || !Array.isArray(safeBars) || !safeBars.length) return null;
  const idx = safeBars.findIndex((bar) => workshopScannerNormalizeDateString(bar?.time) === target);
  return idx >= 0 ? idx : null;
}

function workshopScannerResolveVisibleRange(candidate, safeBars) {
  if (!Array.isArray(safeBars) || !safeBars.length) return null;

  const candidateId = String(candidate?.id || candidate?.candidate_id || '');
  const savedCorrection = workshopScannerState.correctionsByCandidateId?.[candidateId];
  const draft = workshopScannerState.correctionDraft;
  const activeDraft = draft && String(draft.candidateId || '') === candidateId ? draft : null;

  const correctedStart = workshopScannerNormalizeDateString(activeDraft?.baseStartTime ?? savedCorrection?.baseStartTime);
  const correctedEnd = workshopScannerNormalizeDateString(activeDraft?.baseEndTime ?? savedCorrection?.baseEndTime);
  let startIdx = workshopScannerFindBarIndexByTime(safeBars, correctedStart);
  let endIdx = workshopScannerFindBarIndexByTime(safeBars, correctedEnd);

  if (startIdx == null || endIdx == null) {
    const reviewBox = workshopScannerExtractReviewBaseBox(candidate, safeBars);
    startIdx = workshopScannerFiniteNumber(reviewBox?.startIdx);
    endIdx = workshopScannerFiniteNumber(reviewBox?.endIdx);
  }

  if (startIdx == null || endIdx == null) {
    startIdx = workshopScannerFiniteNumber(candidate?.chart_base_start ?? candidate?.window_start);
    endIdx = workshopScannerFiniteNumber(candidate?.chart_base_end ?? candidate?.window_end);
  }

  if (startIdx == null || endIdx == null) return null;

  const start = Math.max(0, Math.min(Number(startIdx), Number(endIdx)));
  const end = Math.min(safeBars.length - 1, Math.max(Number(startIdx), Number(endIdx)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const span = Math.max(1, end - start);
  const padding = Math.max(12, Math.round(span * 0.45));
  return {
    from: Math.max(0, start - padding),
    to: Math.min(safeBars.length - 1, end + padding),
  };
}

function renderWorkshopScannerChartOverlays(candidate, safeBars) {
  if (!workshopScannerState.chart || !workshopScannerState.series) return;
  clearWorkshopScannerChartOverlays();

  const candidateId = String(candidate?.id || candidate?.candidate_id || '');
  const savedCorrection = workshopScannerState.correctionsByCandidateId?.[candidateId];
  const hasSavedCorrection =
    Number.isFinite(Number(savedCorrection?.baseTop)) ||
    Number.isFinite(Number(savedCorrection?.baseBottom));

  if (!hasSavedCorrection) {
    const reviewBox = workshopScannerExtractReviewBaseBox(candidate, safeBars);
    const markers = workshopScannerExtractReviewMarkers(candidate, safeBars, reviewBox);
    if (markers.length) {
      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      workshopScannerState.markersPrimitive = window.LightweightCharts.createSeriesMarkers(workshopScannerState.series, markers);
    }

    const top = workshopScannerFiniteNumber(reviewBox?.top);
    const bottom = workshopScannerFiniteNumber(reviewBox?.bottom);
    const leftTime = reviewBox?.leftTime || (Array.isArray(safeBars) && safeBars.length ? toWorkshopChartTime(safeBars[0].time) : null);
    const rightTime = reviewBox?.rightTime || (Array.isArray(safeBars) && safeBars.length ? toWorkshopChartTime(safeBars[safeBars.length - 1].time) : null);

    if (top != null && bottom != null && leftTime && rightTime) {
      const ceiling = Math.max(top, bottom);
      const floor = Math.min(top, bottom);
      [
        {
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: 0,
          label: `Base Top ${ceiling.toFixed(2)}`,
          points: [{ time: leftTime, value: ceiling }, { time: rightTime, value: ceiling }],
        },
        {
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: 0,
          label: `Base Bottom ${floor.toFixed(2)}`,
          points: [{ time: leftTime, value: floor }, { time: rightTime, value: floor }],
        },
        {
          color: '#6b7280',
          lineWidth: 1,
          lineStyle: 2,
          label: '',
          points: [{ time: leftTime, value: floor }, { time: leftTime, value: ceiling }],
        },
        {
          color: '#6b7280',
          lineWidth: 1,
          lineStyle: 2,
          label: '',
          points: [{ time: rightTime, value: floor }, { time: rightTime, value: ceiling }],
        },
      ].forEach((overlay) => {
        const lineSeries = workshopScannerState.chart.addSeries(window.LightweightCharts.LineSeries, {
          color: overlay.color,
          lineWidth: overlay.lineWidth,
          lineStyle: overlay.lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: overlay.label,
        });
        lineSeries.setData(overlay.points);
        workshopScannerState.overlaySeries.push(lineSeries);
      });
    }
  }

  // User-corrected base levels should remain visible for immediate feedback.
  const draft = workshopScannerState.correctionDraft;
  const activeDraft = draft && String(draft.candidateId || '') === candidateId
    ? draft
    : null;
  const correctedTop = Number(activeDraft?.baseTop ?? savedCorrection?.baseTop);
  const correctedBottom = Number(activeDraft?.baseBottom ?? savedCorrection?.baseBottom);
  const correctedStartRaw = activeDraft?.baseStartTime ?? savedCorrection?.baseStartTime;
  const correctedEndRaw = activeDraft?.baseEndTime ?? savedCorrection?.baseEndTime;
  const correctedStartTime = workshopScannerNormalizeDateString(correctedStartRaw);
  const correctedEndTime = workshopScannerNormalizeDateString(correctedEndRaw);
  const hasBoxBounds = correctedStartTime && correctedEndTime;
  let leftTime = correctedStartTime;
  let rightTime = correctedEndTime;
  if (hasBoxBounds && workshopScannerCompareDate(leftTime, rightTime) > 0) {
    leftTime = correctedEndTime;
    rightTime = correctedStartTime;
  }

  if (
    Number.isFinite(correctedTop) &&
    Number.isFinite(correctedBottom) &&
    correctedTop >= 0 &&
    correctedBottom >= 0 &&
    hasBoxBounds
  ) {
    const top = Math.max(correctedTop, correctedBottom);
    const bottom = Math.min(correctedTop, correctedBottom);
    const boxLines = [
      {
        color: '#38bdf8',
        lineWidth: 2,
        lineStyle: 0,
        label: `Corrected Top ${top.toFixed(2)}`,
        points: [{ time: leftTime, value: top }, { time: rightTime, value: top }],
      },
      {
        color: '#14b8a6',
        lineWidth: 2,
        lineStyle: 0,
        label: `Corrected Bottom ${bottom.toFixed(2)}`,
        points: [{ time: leftTime, value: bottom }, { time: rightTime, value: bottom }],
      },
      {
        color: '#0ea5e9',
        lineWidth: 1,
        lineStyle: 2,
        label: '',
        points: [{ time: leftTime, value: bottom }, { time: leftTime, value: top }],
      },
      {
        color: '#0ea5e9',
        lineWidth: 1,
        lineStyle: 2,
        label: '',
        points: [{ time: rightTime, value: bottom }, { time: rightTime, value: top }],
      },
    ];

    boxLines.forEach((overlay) => {
      const lineSeries = workshopScannerState.chart.addSeries(window.LightweightCharts.LineSeries, {
        color: overlay.color,
        lineWidth: overlay.lineWidth,
        lineStyle: overlay.lineStyle,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: overlay.label,
      });
      lineSeries.setData(overlay.points);
      workshopScannerState.overlaySeries.push(lineSeries);
    });

    return;
  }

  if (Number.isFinite(correctedTop) && correctedTop >= 0) {
    const topLine = workshopScannerState.series.createPriceLine({
      price: correctedTop,
      color: '#38bdf8',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `Corrected Top ${correctedTop.toFixed(2)}`,
    });
    workshopScannerState.overlayPriceLines.push(topLine);
  }
  if (Number.isFinite(correctedBottom) && correctedBottom >= 0) {
    const bottomLine = workshopScannerState.series.createPriceLine({
      price: correctedBottom,
      color: '#14b8a6',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `Corrected Bottom ${correctedBottom.toFixed(2)}`,
    });
    workshopScannerState.overlayPriceLines.push(bottomLine);
  }
}

async function runWorkshopPatternScan() {
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  const universeEl = document.getElementById('workshop-scanner-universe');
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const statusEl = document.getElementById('workshop-scanner-status');
  const patternId = String(indicatorEl?.value || '').trim();
  const selectedOption = Array.from(indicatorEl?.options || []).find((opt) => String(opt.value || '') === patternId);
  const patternLabel = String(selectedOption?.textContent || patternId).trim();
  const interval = String(intervalEl?.value || '1wk');
  const period = 'max';
  const universe = String(universeEl?.value || 'all');
  const strictBase = workshopScannerStrictBaseEnabled();
  const onePerSymbol = workshopScannerOnePerSymbolEnabled();
  const symbols = Array.isArray(workshopScannerState.symbolBuckets?.[universe])
    ? workshopScannerState.symbolBuckets[universe]
    : [];

  if (!patternId) {
    if (statusEl) statusEl.textContent = 'Pick a pattern first.';
    return;
  }
  if (!symbols.length) {
    if (statusEl) statusEl.textContent = 'Selected universe has no symbols.';
    return;
  }

  if (workshopScannerState.methodBuckets) {
    delete workshopScannerState.methodBuckets[patternId];
  }
  workshopScannerClearActiveQueue(`Queueing ${symbols.length} symbols...`);
  try {
    const timeframe = interval.includes('wk') ? 'W' : interval.includes('mo') ? 'M' : 'D';
    const startRes = await fetch('/api/candidates/scan-batch/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols,
        interval,
        period,
        timeframe,
        scanScope: 'research',
        pluginId: patternId,
        strictBase,
        onePerSymbol,
      }),
    });

    const startData = await startRes.json();
    if (!startRes.ok || !startData?.success || !startData?.data?.job_id) {
      throw new Error(startData?.error || `HTTP ${startRes.status}`);
    }

    const jobId = String(startData.data.job_id);
    let payload = null;
    while (true) {
      const pollRes = await fetch(`/api/candidates/scan-batch/job/${encodeURIComponent(jobId)}`);
      const pollData = await pollRes.json();
      if (!pollRes.ok || !pollData?.success || !pollData?.data) {
        throw new Error(pollData?.error || `Failed polling job ${jobId}`);
      }
      const job = pollData.data;
      const completed = Number(job.completed_symbols || 0);
      const total = Number(job.total_symbols || symbols.length);
      const found = Number(job.total_candidates || 0);
      if (statusEl) statusEl.textContent = `Scanning ${completed}/${total} symbols... ${found} candidates`;

      if (job.status === 'completed') {
        payload = job.result || null;
        break;
      }
      if (job.status === 'cancelled') {
        payload = job.result || null;
        break;
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'Batch scan failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    const candidateRows = Array.isArray(payload?.candidates) ? payload.candidates : [];
    const allRows = workshopScannerBuildScanRows(candidateRows, payload?.results, {
      patternId,
      timeframe,
    });
    workshopScannerStoreMethodBucket(patternId, allRows, {
      strictBase,
      onePerSymbol,
      universe,
      interval,
    });
    const preferredId = candidateRows.length ? String(candidateRows[0]?.id || candidateRows[0]?.candidate_id || '') : null;
    await workshopScannerSetQueueFromRows(allRows, preferredId);
    workshopScannerSetScanSummary(symbols.length, candidateRows.length, strictBase, patternLabel, patternId);
    if (statusEl) {
      statusEl.textContent = `Scan complete: ${symbols.length} symbols scanned; ${candidateRows.length} produced candidates (strict base ${strictBase ? 'on' : 'off'}, 1/symbol ${onePerSymbol ? 'on' : 'off'}).`;
    }
    await refreshWorkshopScannerMetrics();
  } catch (error) {
    if (statusEl) statusEl.textContent = `Scan failed: ${error.message || 'Unknown error'}`;
  }
}

async function workshopScannerHandlePatternChange() {
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  const statusEl = document.getElementById('workshop-scanner-status');
  const patternId = String(indicatorEl?.value || '').trim();
  if (!patternId) return;
  workshopScannerState.selectedPatternId = patternId;
  workshopScannerSetIndicatorTriggerLabel();

  const bucket = workshopScannerGetMethodBucket(patternId);
  if (bucket && Array.isArray(bucket.rows)) {
    try {
      await workshopScannerSetQueueFromRows(bucket.rows, null);
      if (statusEl) {
        statusEl.textContent = `Loaded method bucket: ${patternId} (${bucket.rows.length} rows, strict base ${bucket.strictBase ? 'on' : 'off'}, 1/symbol ${bucket.onePerSymbol ? 'on' : 'off'}).`;
      }
      return;
    } catch (error) {
      if (statusEl) statusEl.textContent = `Bucket load failed for ${patternId}: ${error.message || 'Unknown error'}`;
      return;
    }
  }

  try {
    await loadWorkshopScannerCandidatesFromQueue(null);
  } catch (error) {
    if (statusEl) statusEl.textContent = `Queue load failed for ${patternId}: ${error.message || 'Unknown error'}`;
  }
}

function workshopScannerIntervalToTimeframe(interval) {
  const raw = String(interval || '').toLowerCase();
  if (raw.includes('wk')) return 'W';
  if (raw.includes('mo')) return 'M';
  return 'D';
}

function workshopScannerGetCompareSettings() {
  const modeEl = document.getElementById('workshop-scanner-compare-mode');
  const limitEl = document.getElementById('workshop-scanner-compare-limit');
  const strictBase = workshopScannerStrictBaseEnabled();
  const modeRaw = String(modeEl?.value || 'backtest').toLowerCase();
  const mode = modeRaw === 'scan' ? 'scan' : 'backtest';
  const limitRaw = Number(limitEl?.value);
  const maxSymbols = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, Math.floor(limitRaw)))
    : 40;
  return { mode, maxSymbols, strictBase };
}

async function runWorkshopMethodCompare() {
  const universeEl = document.getElementById('workshop-scanner-universe');
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const statusEl = document.getElementById('workshop-scanner-status');
  const universe = String(universeEl?.value || 'all');
  const interval = String(intervalEl?.value || '1wk');
  const period = 'max';
  const symbols = Array.isArray(workshopScannerState.symbolBuckets?.[universe])
    ? workshopScannerState.symbolBuckets[universe]
    : [];

  if (!symbols.length) {
    if (statusEl) statusEl.textContent = 'Selected universe has no symbols.';
    return;
  }

  const settings = workshopScannerGetCompareSettings();
  const selected = symbols.slice(0, settings.maxSymbols);
  workshopScannerSetCompareSummary(
    `Method compare: running ${settings.mode} on ${selected.length} symbols (strict base ${settings.strictBase ? 'on' : 'off'})...`
  );
  if (statusEl) {
    statusEl.textContent = `Comparing methods (${settings.mode}) on ${selected.length} symbols (strict base ${settings.strictBase ? 'on' : 'off'})...`;
  }

  try {
    const res = await fetch('/api/candidates/base-methods/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: selected,
        interval,
        period,
        mode: settings.mode,
        maxSymbols: settings.maxSymbols,
        strictBase: settings.strictBase,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data?.report) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const report = data.data.report;
    workshopScannerRenderMethodCompare(report, {
      usedSymbols: Number(data?.data?.used_symbols || selected.length),
    });
    if (statusEl) {
      statusEl.textContent = `Method compare complete: ${Number(data?.data?.used_symbols || selected.length)} symbols (strict base ${settings.strictBase ? 'on' : 'off'}).`;
    }
  } catch (error) {
    workshopScannerSetCompareSummary(`Method compare failed: ${error.message || 'Unknown error'}`);
    if (statusEl) statusEl.textContent = `Method compare failed: ${error.message || 'Unknown error'}`;
  }
}

async function runWorkshopSingleMethodScan(patternId) {
  const statusEl = document.getElementById('workshop-scanner-status');
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  const pid = String(patternId || '').trim();
  if (!pid) return;
  if (!indicatorEl) return;

  const hasOption = Array.from(indicatorEl.options || []).some((opt) => String(opt.value || '') === pid);
  if (!hasOption) {
    if (statusEl) statusEl.textContent = `Method not available in dropdown: ${pid}`;
    return;
  }

  indicatorEl.value = pid;
  if (statusEl) statusEl.textContent = `Running method: ${pid} ...`;
  await runWorkshopPatternScan();
}

async function workshopScannerLoadAIDecisions(jobId) {
  if (!jobId) return;
  try {
    const res = await fetch(`/api/auto-label/job/${encodeURIComponent(jobId)}/decisions`);
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data?.decisions)) return;
    const map = {};
    for (const d of data.data.decisions) {
      const cid = String(d.candidateId || '');
      if (cid) map[cid] = d;
    }
    workshopScannerState.aiDecisionsByCandidateId = map;
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) {
      statusEl.textContent = `AI decisions loaded: ${data.data.decisions.length} candidates. Review with arrow keys.`;
    }
  } catch (e) {
    console.warn('[workshop-scanner] failed to load AI decisions:', e?.message);
  }
}

function workshopScannerGetAIDecision(row) {
  if (!row) return null;
  const cid = String(row.id || row.candidate_id || '');
  return workshopScannerState.aiDecisionsByCandidateId?.[cid] || null;
}

function workshopScannerRenderAISuggestion(row) {
  const el = document.getElementById('workshop-scanner-ai-suggestion');
  if (!el) return;
  const decision = workshopScannerGetAIDecision(row);
  if (!decision) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const label = String(decision.label || '').toUpperCase();
  const conf = Number.isFinite(decision.labelConfidence) ? (decision.labelConfidence * 100).toFixed(0) : '?';
  const corrConf = Number.isFinite(decision.correctionConfidence) ? (decision.correctionConfidence * 100).toFixed(0) : '?';
  const reason = String(decision.reason || decision.reasoning || '').slice(0, 200);
  const top = Number.isFinite(Number(decision.baseTop)) ? Number(decision.baseTop).toFixed(2) : '--';
  const bottom = Number.isFinite(Number(decision.baseBottom)) ? Number(decision.baseBottom).toFixed(2) : '--';
  const needsCorr = decision.needsCorrection ? 'Yes' : 'No';

  const labelColor = label === 'YES' ? '#22c55e' : label === 'NO' ? '#ef4444' : '#f59e0b';

  el.style.display = 'flex';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);">AI Suggestion</span>
      <span style="font-size:12px;font-weight:600;color:${labelColor};">${escapeHtml(label)} (${conf}%)</span>
    </div>
    <div style="font-size:11px;color:var(--color-text-muted);">
      Base: ${bottom} &ndash; ${top} &middot; Corr conf: ${corrConf}% &middot; Needs corr: ${needsCorr}
    </div>
    <div style="font-size:11px;color:var(--color-text-muted);font-style:italic;">${escapeHtml(reason)}</div>
    ${decision.needsCorrection && Number.isFinite(Number(decision.baseTop)) ? `<button class="btn btn-ghost btn-sm" onclick="workshopScannerApplyAISuggestion()" style="align-self:flex-start;font-size:11px;">Apply AI Correction</button>` : ''}
  `;
}

function workshopScannerApplyAISuggestion() {
  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (!row) return;
  const decision = workshopScannerGetAIDecision(row);
  if (!decision) return;

  const top = Number(decision.baseTop);
  const bottom = Number(decision.baseBottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;

  const panel = document.getElementById('workshop-scanner-correction');
  if (panel && panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
  }

  workshopScannerState.correctionDraft = {
    candidateId: row.id,
    baseTop: Math.max(top, bottom),
    baseBottom: Math.min(top, bottom),
    baseStartTime: null,
    baseEndTime: null,
  };
  workshopScannerSyncCorrectionInputs();
  renderWorkshopScannerChartOverlays(row, workshopScannerState.currentSafeBars);

  const statusEl = document.getElementById('workshop-scanner-status');
  if (statusEl) statusEl.textContent = `AI suggestion applied: ${Math.min(top, bottom).toFixed(2)} - ${Math.max(top, bottom).toFixed(2)}. Adjust or save.`;
}

function workshopScannerRenderAIOverlay(row) {
  if (!workshopScannerState.series) return;
  const decision = workshopScannerGetAIDecision(row);
  if (!decision) return;

  const top = Number(decision.baseTop);
  const bottom = Number(decision.baseBottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;

  const baseTop = Math.max(top, bottom);
  const baseBottom = Math.min(top, bottom);
  const label = String(decision.label || '').toUpperCase();
  const conf = Number.isFinite(decision.labelConfidence) ? (decision.labelConfidence * 100).toFixed(0) : '?';
  const lineColor = label === 'YES' ? 'rgba(34, 197, 94, 0.7)' : label === 'NO' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(96, 165, 250, 0.6)';

  const topLine = workshopScannerState.series.createPriceLine({
    price: baseTop,
    color: lineColor,
    lineWidth: 2,
    lineStyle: 2,
    axisLabelVisible: true,
    title: `AI Top $${baseTop.toFixed(2)} [${label} ${conf}%]`,
  });
  const bottomLine = workshopScannerState.series.createPriceLine({
    price: baseBottom,
    color: lineColor,
    lineWidth: 2,
    lineStyle: 2,
    axisLabelVisible: true,
    title: `AI Bot $${baseBottom.toFixed(2)}`,
  });
  workshopScannerState.overlayPriceLines.push(topLine, bottomLine);
}

async function workshopScannerLoadLatestAIResults() {
  const statusEl = document.getElementById('workshop-scanner-status');
  try {
    if (statusEl) statusEl.textContent = 'Loading AI results...';
    const res = await fetch('/api/auto-label/jobs');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(data?.error || 'Failed to fetch jobs');
    }
    const completed = data.data.filter(j => j.status === 'completed').sort((a, b) =>
      String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt))
    );
    if (!completed.length) {
      if (statusEl) statusEl.textContent = 'No completed auto-label jobs found.';
      return;
    }
    const latest = completed[0];
    await workshopScannerLoadAIDecisions(latest.jobId);
    renderWorkshopScannerCandidateList();
    const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
    if (row) {
      workshopScannerRenderAISuggestion(row);
      workshopScannerRenderAIOverlay(row);
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Load AI failed: ${e.message || 'Unknown error'}`;
  }
}

function workshopScannerApplySort() {
  const currentId = workshopScannerState.candidates?.[workshopScannerState.currentIndex]?.id || null;
  workshopScannerRebuildCandidateView(currentId);
}

function workshopScannerGetAutoLabelSettings() {
  const dryRunEl = document.getElementById('workshop-auto-label-dry-run');
  const labelThresholdEl = document.getElementById('workshop-auto-label-threshold');
  const correctionThresholdEl = document.getElementById('workshop-auto-correction-threshold');
  const intervalEl = document.getElementById('workshop-scanner-interval');

  const labelThreshold = Number(labelThresholdEl?.value);
  const correctionThreshold = Number(correctionThresholdEl?.value);

  return {
    dryRun: !!(dryRunEl && dryRunEl.checked),
    labelThreshold: Number.isFinite(labelThreshold) ? labelThreshold : 0.9,
    correctionThreshold: Number.isFinite(correctionThreshold) ? correctionThreshold : 0.92,
    timeframe: workshopScannerIntervalToTimeframe(intervalEl?.value || '1wk'),
  };
}

function workshopScannerStopAutoLabelPolling() {
  if (workshopScannerState.autoLabelPollTimer) {
    clearInterval(workshopScannerState.autoLabelPollTimer);
    workshopScannerState.autoLabelPollTimer = null;
  }
}

async function workshopScannerPollAutoLabelJob(jobId) {
  const statusEl = document.getElementById('workshop-scanner-status');
  if (!jobId) return;

  try {
    const res = await fetch(`/api/auto-label/job/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const job = data.data;
    const counters = job.counters || {};
    if (statusEl) {
      statusEl.textContent = `AutoLabel ${job.status}: ${Number(counters.processed || 0)}/${Number(counters.total || 0)} | A:${Number(counters.autoLabeled || 0)} C:${Number(counters.autoCorrected || 0)} R:${Number(counters.reviewRequired || 0)} E:${Number(counters.errors || 0)}`;
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      workshopScannerStopAutoLabelPolling();
      workshopScannerState.lastAutoLabelJobId = workshopScannerState.autoLabelJobId;
      workshopScannerState.autoLabelJobId = null;
      await loadWorkshopScannerSavedFeedback();
      if (job.status === 'completed' && workshopScannerState.lastAutoLabelJobId) {
        await workshopScannerLoadAIDecisions(workshopScannerState.lastAutoLabelJobId);
      }
      renderWorkshopScannerCandidateList();
      const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
      if (row) {
        workshopScannerRenderSavedIndicator(row);
        workshopScannerRenderAISuggestion(row);
        workshopScannerRenderAIOverlay(row);
      }
      await refreshWorkshopScannerMetrics();
    }
  } catch (error) {
    workshopScannerStopAutoLabelPolling();
    workshopScannerState.autoLabelJobId = null;
    if (statusEl) statusEl.textContent = `Auto Label poll failed: ${error.message || 'Unknown error'}`;
  }
}

async function startWorkshopAutoLabel() {
  const indicatorEl = document.getElementById('workshop-scanner-indicator');
  const intervalEl = document.getElementById('workshop-scanner-interval');
  const statusEl = document.getElementById('workshop-scanner-status');

  const patternId = String(indicatorEl?.value || '').trim();
  if (!patternId) {
    if (statusEl) statusEl.textContent = 'Pick a pattern first.';
    return;
  }

  const settings = workshopScannerGetAutoLabelSettings();
  const candidateIds = (Array.isArray(workshopScannerState.candidates) ? workshopScannerState.candidates : [])
    .map((row) => String(row?.id || row?.candidate_id || ''))
    .filter((id) => !!id);

  try {
    if (statusEl) statusEl.textContent = 'Starting auto-label job...';
    const res = await fetch('/api/auto-label/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patternId,
        timeframe: settings.timeframe,
        candidateIds: candidateIds.length ? candidateIds : undefined,
        maxItems: candidateIds.length || 200,
        dryRun: settings.dryRun,
        labelThreshold: settings.labelThreshold,
        correctionThreshold: settings.correctionThreshold,
        saveCorrections: true,
        unreviewedOnly: true,
        userId: 'ai',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data?.jobId) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const jobId = String(data.data.jobId);
    workshopScannerState.autoLabelJobId = jobId;
    workshopScannerStopAutoLabelPolling();
    if (statusEl) {
      statusEl.textContent = `Auto-label started (${jobId}) ${settings.dryRun ? '[dry-run]' : ''}`;
    }
    await workshopScannerPollAutoLabelJob(jobId);
    workshopScannerState.autoLabelPollTimer = setInterval(() => {
      workshopScannerPollAutoLabelJob(jobId);
    }, 1500);
  } catch (error) {
    if (statusEl) statusEl.textContent = `Auto Label failed: ${error.message || 'Unknown error'}`;
  }
}

function renderWorkshopScannerCandidateList() {
  const list = document.getElementById('workshop-scanner-list');
  const titleEl = document.getElementById('workshop-scanner-candidates-title');
  if (!list) return;
  const rows = workshopScannerState.candidates || [];
  const totalRows = Array.isArray(workshopScannerState.allCandidates) ? workshopScannerState.allCandidates.length : rows.length;
  if (titleEl) titleEl.textContent = `Candidates (${rows.length} shown${totalRows !== rows.length ? ` of ${totalRows}` : ''})`;
  if (!rows.length) {
    list.innerHTML = '<p class="workshop-test-placeholder">No candidates yet.</p>';
    return;
  }

  list.innerHTML = rows.map((c, i) => {
    const isActive = i === workshopScannerState.currentIndex;
    const style = [
      'display:flex',
      'justify-content:space-between',
      'align-items:center',
      'gap:8px',
      isActive ? 'border-color:var(--color-accent)' : '',
    ].filter(Boolean).join(';');
    const score = c?.no_candidate ? '--' : (Number.isFinite(Number(c.score)) ? Number(c.score).toFixed(3) : '0.000');
    const statusText = c?.no_candidate
      ? (c?.scan_error ? `NO CANDIDATE (${String(c.scan_error).slice(0, 24)})` : 'NO CANDIDATE')
      : (workshopScannerReviewStatusText(c) || 'UNLABELED');
    const isReviewed = workshopScannerIsReviewed(c);
    const statusColor = c?.no_candidate ? '#f59e0b' : (isReviewed ? '#22c55e' : '#6b7280');
    const aiDecision = workshopScannerGetAIDecision(c);
    const aiTag = aiDecision ? ` <span style="font-size:10px;color:rgba(96,165,250,0.7);">[AI:${String(aiDecision.label||'').toUpperCase()} ${((aiDecision.labelConfidence||0)*100).toFixed(0)}%]</span>` : '';
    return `
      <button type="button" class="btn btn-ghost" style="${style}" onclick="showWorkshopScannerCandidate(${i})">
        <span>#${i + 1} ${escapeHtml(c.symbol || 'N/A')} &middot; ${score}${aiTag}</span>
        <span style="min-width:76px;text-align:right;font-size:11px;color:${statusColor};">${escapeHtml(statusText)}</span>
      </button>
    `;
  }).join('');
}

async function showWorkshopScannerCandidate(index) {
  const row = workshopScannerState.candidates[index];
  if (!row) return;
  workshopScannerState.currentIndex = index;
  persistWorkshopScannerSession();
  renderWorkshopScannerCandidateList();
  workshopScannerRenderChartSymbol(row);
  await workshopScannerEnsureChartData(row);
  const activeRow = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (!activeRow || String(activeRow.id || '') !== String(row.id || '')) return;
  drawWorkshopScannerChart(row);
  const panel = document.getElementById('workshop-scanner-correction');
  if (panel && !panel.classList.contains('hidden')) {
    workshopScannerEnsureCorrectionDraft(row);
    workshopScannerSyncCorrectionInputs();
  }
  workshopScannerRenderSavedIndicator(row);
  workshopScannerRenderAISuggestion(row);
  workshopScannerRenderAIOverlay(row);
}

function drawWorkshopScannerChart(candidate) {
  if (!workshopScannerState.series) return;
  const bars = Array.isArray(candidate?.chart_data) ? candidate.chart_data : [];
  const mapped = bars
    .filter((bar) => bar && bar.time != null && bar.open != null && bar.high != null && bar.low != null && bar.close != null)
    .map((bar) => ({
      time: typeof bar.time === 'string' ? bar.time.slice(0, 10) : bar.time,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
    }))
    .filter((bar) => (
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      bar.open >= 0 &&
      bar.high >= 0 &&
      bar.low >= 0 &&
      bar.close >= 0 &&
      bar.high >= bar.low
    ));

  const byTime = new Map();
  mapped.forEach((bar) => byTime.set(bar.time, bar));
  const safeBars = Array.from(byTime.values()).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  workshopScannerState.currentSafeBars = safeBars;
  const statusEl = document.getElementById('workshop-scanner-status');

  if (!safeBars.length) {
    try {
      workshopScannerState.series.setData([]);
    } catch {}
    clearWorkshopScannerChartOverlays();
    if (statusEl) {
      const err = String(candidate?.chart_load_error || '').trim();
      statusEl.textContent = err
        ? `Chart unavailable for ${candidate?.symbol || 'symbol'}: ${err}`
        : `Chart unavailable for ${candidate?.symbol || 'symbol'} (no bars returned).`;
    }
    return;
  }

  try {
    workshopScannerState.series.setData(safeBars);
  } catch (e) {
    console.warn('[workshop-scanner] setData failed:', e?.message, '— bars:', safeBars.length);
  }
  try {
    renderWorkshopScannerChartOverlays(candidate, safeBars);
  } catch (e) {
    console.warn('[workshop-scanner] overlay render failed:', e?.message);
  }
  if (workshopScannerState.chart) {
    const visibleRange = workshopScannerResolveVisibleRange(candidate, safeBars);
    if (visibleRange) {
      try {
        workshopScannerState.chart.timeScale().setVisibleLogicalRange(visibleRange);
      } catch {
        workshopScannerState.chart.timeScale().fitContent();
      }
    } else {
      workshopScannerState.chart.timeScale().fitContent();
    }
  }
}

async function workshopScannerLabel(label) {
  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (!row || !row.id) return;
  if (row.no_candidate) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = `No-candidate row for ${row.symbol}. This is a scan miss, not a saved candidate.`;
    return;
  }
  try {
    const res = await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: row.id,
        label,
        userId: 'default',
        notes: 'Labeled in Indicator Studio Pattern Scanner',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
    workshopScannerState.labelsByCandidateId = workshopScannerState.labelsByCandidateId || {};
    workshopScannerState.labelsByCandidateId[row.id] = {
      id: String(data?.data?.id || ''),
      label,
      notes: 'Labeled in Indicator Studio Pattern Scanner',
      timestamp: new Date().toISOString(),
    };
    const refreshed = workshopScannerRemoveCandidateFromActiveQueue(row.id);
    if (!refreshed) persistWorkshopScannerSession();
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = workshopScannerState.candidates.length
      ? `Saved ${workshopScannerPrettyLabel(label)} for ${row.symbol}. Candidate list refreshed.`
      : `Saved ${workshopScannerPrettyLabel(label)} for ${row.symbol}. No rows match the current filter.`;
    await refreshWorkshopScannerMetrics();
  } catch (error) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = `Label failed: ${error.message || 'Unknown error'}`;
  }
}

function toggleWorkshopCorrection() {
  const panel = document.getElementById('workshop-scanner-correction');
  if (!panel) return;
  const isOpening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');

  if (isOpening) {
    const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
    if (row) {
      workshopScannerEnsureCorrectionDraft(row);
      workshopScannerSyncCorrectionInputs();
      const statusEl = document.getElementById('workshop-scanner-status');
      if (statusEl) statusEl.textContent = 'Correction mode: draw base box (2 clicks) or fine-tune top/bottom, then save.';
      drawWorkshopScannerChart(row);
    }
  } else {
    workshopScannerState.correctionMode = null;
    if (workshopScannerState.correctionDraft) {
      workshopScannerState.correctionDraft.boxAnchor = null;
    }
  }
}

async function workshopScannerSaveCorrection() {
  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  const topInput = document.getElementById('workshop-scanner-correction-top');
  const bottomInput = document.getElementById('workshop-scanner-correction-bottom');
  if (!row || !row.id || !topInput || !bottomInput) return;
  if (row.no_candidate) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = `No-candidate row for ${row.symbol}. There is no detected box to correct.`;
    return;
  }

  const notes = String(workshopScannerState.correctionDraft?.notes || '').trim();
  let baseTop = Number(topInput.value);
  let baseBottom = Number(bottomInput.value);

  if (!Number.isFinite(baseTop) || !Number.isFinite(baseBottom)) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = 'Set both top and bottom before saving.';
    return;
  }
  if (baseTop < 0 || baseBottom < 0) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = 'Base levels cannot be negative.';
    return;
  }
  if (baseBottom > baseTop) {
    const tmp = baseTop;
    baseTop = baseBottom;
    baseBottom = tmp;
  }
  const baseStartTime = workshopScannerNormalizeDateString(workshopScannerState.correctionDraft?.baseStartTime);
  const baseEndTime = workshopScannerNormalizeDateString(workshopScannerState.correctionDraft?.baseEndTime);
  let startTime = baseStartTime;
  let endTime = baseEndTime;
  if (startTime && endTime && workshopScannerCompareDate(startTime, endTime) > 0) {
    startTime = baseEndTime;
    endTime = baseStartTime;
  }

  workshopScannerState.correctionDraft = {
    ...(workshopScannerState.correctionDraft || {}),
    candidateId: row.id,
    baseTop,
    baseBottom,
    baseStartTime: startTime || '',
    baseEndTime: endTime || '',
    boxAnchor: null,
    notes,
  };

  try {
    const res = await fetch('/api/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: row.id,
        userId: 'default',
        symbol: row.symbol,
        timeframe: row.timeframe,
        patternType: row.pattern_type || 'pattern_correction',
        original: {
          auto: true,
          detectedBaseTop: Number(row?.base?.high),
          detectedBaseBottom: Number(row?.base?.low),
        },
        corrected: {
          notes,
          baseTopPrice: baseTop,
          baseBottomPrice: baseBottom,
          ...(startTime ? { baseStartTime: startTime } : {}),
          ...(endTime ? { baseEndTime: endTime } : {}),
          correctionMode: startTime && endTime ? 'manual_base_box' : 'manual_base_levels',
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);

    // Persist correction in-memory so it stays visible while reviewing candidates.
    workshopScannerState.correctionsByCandidateId = workshopScannerState.correctionsByCandidateId || {};
    workshopScannerState.correctionsByCandidateId[row.id] = {
      id: String(data?.data?.id || ''),
      baseTop,
      baseBottom,
      baseStartTime: startTime || null,
      baseEndTime: endTime || null,
      notes,
      timestamp: new Date().toISOString(),
    };

    // Update candidate base so existing base overlays mirror corrected values.
    row.base = row.base || {};
    row.base.high = baseTop;
    row.base.low = baseBottom;

    topInput.value = String(baseTop.toFixed(2));
    bottomInput.value = String(baseBottom.toFixed(2));
    workshopScannerState.correctionMode = null;
    const refreshed = workshopScannerRemoveCandidateFromActiveQueue(row.id);
    if (!refreshed) {
      drawWorkshopScannerChart(row);
      persistWorkshopScannerSession();
    }

    const statusEl = document.getElementById('workshop-scanner-status');
    const datePart = startTime && endTime
      ? ` (${workshopScannerFormatDateLabel(startTime)} to ${workshopScannerFormatDateLabel(endTime)})`
      : '';
    if (statusEl) statusEl.textContent = workshopScannerState.candidates.length
      ? `Correction saved: ${baseBottom.toFixed(2)} - ${baseTop.toFixed(2)}${datePart}. Candidate list refreshed.`
      : `Correction saved: ${baseBottom.toFixed(2)} - ${baseTop.toFixed(2)}${datePart}. No rows match the current filter.`;
    await refreshWorkshopScannerMetrics();
  } catch (error) {
    const statusEl = document.getElementById('workshop-scanner-status');
    if (statusEl) statusEl.textContent = `Correction failed: ${error.message || 'Unknown error'}`;
  }
}

function workshopScannerEnsureCorrectionDraft(row) {
  if (!row) return;
  const existing = workshopScannerState.correctionDraft;
  if (existing && String(existing.candidateId || '') === String(row.id || '')) {
    return;
  }
  const saved = workshopScannerState.correctionsByCandidateId?.[row.id];
  workshopScannerState.correctionDraft = {
    candidateId: row.id,
    baseTop: Number.isFinite(Number(saved?.baseTop)) ? Number(saved.baseTop) : Number(row?.base?.high),
    baseBottom: Number.isFinite(Number(saved?.baseBottom)) ? Number(saved.baseBottom) : Number(row?.base?.low),
    baseStartTime: workshopScannerNormalizeDateString(
      saved?.baseStartTime
      || workshopScannerCandidateTimeAtIndex(row, row?.chart_base_start),
    ),
    baseEndTime: workshopScannerNormalizeDateString(
      saved?.baseEndTime
      || workshopScannerCandidateTimeAtIndex(row, row?.chart_base_end),
    ),
    boxAnchor: null,
    notes: saved?.notes || '',
  };
  workshopScannerState.correctionMode = null;
}

function workshopScannerSyncCorrectionInputs() {
  const draft = workshopScannerState.correctionDraft || {};
  const topInput = document.getElementById('workshop-scanner-correction-top');
  const bottomInput = document.getElementById('workshop-scanner-correction-bottom');
  const startInput = document.getElementById('workshop-scanner-correction-start');
  const endInput = document.getElementById('workshop-scanner-correction-end');
  if (topInput) topInput.value = Number.isFinite(Number(draft.baseTop)) ? Number(draft.baseTop).toFixed(2) : '';
  if (bottomInput) bottomInput.value = Number.isFinite(Number(draft.baseBottom)) ? Number(draft.baseBottom).toFixed(2) : '';
  if (startInput) startInput.value = workshopScannerFormatDateLabel(draft.baseStartTime) || '';
  if (endInput) endInput.value = workshopScannerFormatDateLabel(draft.baseEndTime) || '';
}

function workshopScannerStartSetLevel(which) {
  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (!row) return;
  if (which !== 'top' && which !== 'bottom' && which !== 'box') return;
  workshopScannerEnsureCorrectionDraft(row);
  workshopScannerSyncCorrectionInputs();
  workshopScannerState.correctionMode = which;
  if (which === 'box' && workshopScannerState.correctionDraft) {
    workshopScannerState.correctionDraft.boxAnchor = null;
  }
  const statusEl = document.getElementById('workshop-scanner-status');
  if (statusEl) {
    if (which === 'top') {
      statusEl.textContent = 'Click on the chart to set top.';
    } else if (which === 'bottom') {
      statusEl.textContent = 'Click on the chart to set bottom.';
    } else {
      statusEl.textContent = 'Draw Base Box: click first corner, then opposite corner.';
    }
  }
}

function workshopScannerCancelCorrection() {
  const panel = document.getElementById('workshop-scanner-correction');
  if (panel) panel.classList.add('hidden');
  workshopScannerState.correctionMode = null;
  if (workshopScannerState.correctionDraft) {
    workshopScannerState.correctionDraft.boxAnchor = null;
  }
  workshopScannerState.correctionDraft = null;
  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (row) drawWorkshopScannerChart(row);
  const statusEl = document.getElementById('workshop-scanner-status');
  if (statusEl) statusEl.textContent = 'Correction cancelled.';
}

function workshopScannerExtractClickPrice(param) {
  try {
    if (param?.point && workshopScannerState.series?.coordinateToPrice) {
      const p = Number(workshopScannerState.series.coordinateToPrice(param.point.y));
      if (Number.isFinite(p)) return p;
    }
  } catch {}

  try {
    const bar = param?.seriesData?.get?.(workshopScannerState.series);
    const p = Number(bar?.close ?? bar?.value);
    if (Number.isFinite(p)) return p;
  } catch {}
  return null;
}

function workshopScannerExtractClickTime(param) {
  const direct = workshopScannerNormalizeDateString(param?.time);
  if (direct) return direct;

  try {
    const bar = param?.seriesData?.get?.(workshopScannerState.series);
    const fromBar = workshopScannerNormalizeDateString(bar?.time);
    if (fromBar) return fromBar;
  } catch {}

  const bars = Array.isArray(workshopScannerState.currentSafeBars) ? workshopScannerState.currentSafeBars : [];
  if (!bars.length) return '';
  if (!param?.point || !workshopScannerState.chart?.timeScale?.coordinateToLogical) {
    return bars[bars.length - 1].time || '';
  }

  try {
    const logical = Number(workshopScannerState.chart.timeScale().coordinateToLogical(param.point.x));
    if (!Number.isFinite(logical)) return bars[bars.length - 1].time || '';
    const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
    return workshopScannerNormalizeDateString(bars[idx]?.time);
  } catch {
    return bars[bars.length - 1].time || '';
  }
}

function handleWorkshopScannerChartClick(param) {
  if (currentWorkshopTab !== 'scanner') return;
  if (window._workshopDrawingTools && window._workshopDrawingTools.getActiveTool()) return;
  const panel = document.getElementById('workshop-scanner-correction');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!workshopScannerState.correctionMode) return;

  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  if (!row) return;

  const price = workshopScannerExtractClickPrice(param);
  if (!Number.isFinite(price)) return;
  const nonNegativePrice = Math.max(0, price);
  const clickedTime = workshopScannerExtractClickTime(param);

  workshopScannerEnsureCorrectionDraft(row);
  if (workshopScannerState.correctionMode === 'top') {
    workshopScannerState.correctionDraft.baseTop = nonNegativePrice;
  } else if (workshopScannerState.correctionMode === 'bottom') {
    workshopScannerState.correctionDraft.baseBottom = nonNegativePrice;
  } else if (workshopScannerState.correctionMode === 'box') {
    if (!clickedTime) return;
    const anchor = workshopScannerState.correctionDraft.boxAnchor;
    if (!anchor || !anchor.time || !Number.isFinite(Number(anchor.price))) {
      workshopScannerState.correctionDraft.boxAnchor = { time: clickedTime, price: nonNegativePrice };
      const statusEl = document.getElementById('workshop-scanner-status');
      if (statusEl) statusEl.textContent = 'Base box anchor set. Click opposite corner.';
      return;
    }

    const topFromBox = Math.max(nonNegativePrice, Number(anchor.price));
    const bottomFromBox = Math.min(nonNegativePrice, Number(anchor.price));
    const startTime = workshopScannerCompareDate(anchor.time, clickedTime) <= 0 ? anchor.time : clickedTime;
    const endTime = workshopScannerCompareDate(anchor.time, clickedTime) <= 0 ? clickedTime : anchor.time;
    workshopScannerState.correctionDraft.baseTop = topFromBox;
    workshopScannerState.correctionDraft.baseBottom = bottomFromBox;
    workshopScannerState.correctionDraft.baseStartTime = startTime;
    workshopScannerState.correctionDraft.baseEndTime = endTime;
    workshopScannerState.correctionDraft.boxAnchor = null;
  }

  // Keep levels ordered to avoid user confusion.
  const top = Number(workshopScannerState.correctionDraft.baseTop);
  const bottom = Number(workshopScannerState.correctionDraft.baseBottom);
  if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top) {
    workshopScannerState.correctionDraft.baseTop = bottom;
    workshopScannerState.correctionDraft.baseBottom = top;
  }

  const modeDone = workshopScannerState.correctionMode;
  workshopScannerState.correctionMode = null;
  workshopScannerSyncCorrectionInputs();
  drawWorkshopScannerChart(row);

  const statusEl = document.getElementById('workshop-scanner-status');
  if (statusEl) {
    if (modeDone === 'top') {
      statusEl.textContent = `Top set to ${Number(workshopScannerState.correctionDraft.baseTop).toFixed(2)}`;
    } else if (modeDone === 'bottom') {
      statusEl.textContent = `Bottom set to ${Number(workshopScannerState.correctionDraft.baseBottom).toFixed(2)}`;
    } else {
      const startLabel = workshopScannerFormatDateLabel(workshopScannerState.correctionDraft.baseStartTime);
      const endLabel = workshopScannerFormatDateLabel(workshopScannerState.correctionDraft.baseEndTime);
      statusEl.textContent = `Base box set: ${startLabel} to ${endLabel}, ${Number(workshopScannerState.correctionDraft.baseBottom).toFixed(2)} - ${Number(workshopScannerState.correctionDraft.baseTop).toFixed(2)}.`;
    }
  }
}

function renderWorkshopScannerChat() {
  const container = document.getElementById('workshop-scanner-ai-messages');
  if (!container) return;
  container.innerHTML = workshopScannerState.chat.map((msg) => {
    return `<div class="scanner-chat-bubble ${msg.sender === 'user' ? 'user' : 'ai'}">${escapeHtml(msg.text || '')}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendWorkshopScannerChat(prefill) {
  const input = document.getElementById('workshop-scanner-ai-input');
  const status = document.getElementById('workshop-scanner-chat-status');
  let message = typeof prefill === 'string' ? prefill : String(input?.value || '').trim();
  if (!message) return;
  if (input && typeof prefill !== 'string') input.value = '';
  workshopScannerState.chat.push({ sender: 'user', text: message });
  renderWorkshopScannerChat();
  if (status) status.textContent = 'Thinking';

  const row = workshopScannerState.candidates[workshopScannerState.currentIndex];
  const context = {
    page: 'pattern_scanner',
    symbol: row?.symbol,
    patternType: row?.pattern_type,
    copilotAnalysis: row || null,
  };

  try {
    const res = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context,
        role: 'pattern_analyst',
      }),
    });
    const data = await res.json();
    const text = data?.data?.response || data?.error || 'No response.';
    workshopScannerState.chat.push({ sender: 'ai', text: text });
  } catch (error) {
    workshopScannerState.chat.push({ sender: 'ai', text: `Chat failed: ${error.message || 'Unknown error'}` });
  } finally {
    renderWorkshopScannerChat();
    if (status) status.textContent = 'Ready';
  }
}

function handleWorkshopScannerChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendWorkshopScannerChat();
  }
}

function toPatternId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'new_plugin';
}

function normalizePatternIdForDefinition(patternId, definition) {
  let normalized = toPatternId(patternId || '');
  if (!normalized) normalized = 'new_plugin';

  const composition = String(definition?.composition || '').trim().toLowerCase();
  if (composition === 'primitive' && !normalized.endsWith('_primitive')) {
    normalized = `${normalized}_primitive`;
  } else if (composition === 'composite' && !normalized.endsWith('_composite')) {
    normalized = `${normalized}_composite`;
  }
  return normalized;
}

function tryParseJson(raw) {
  if (!raw || !String(raw).trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getEditorValue(editor) {
  if (!editor || typeof editor.getValue !== 'function') return '';
  return String(editor.getValue() || '');
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getTextContent(id) {
  const el = document.getElementById(id);
  return el ? String(el.textContent || '').trim() : '';
}

function setTextContent(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function clearWorkshopValidationErrors() {
  Object.values(WORKSHOP_VALIDATION_FIELDS).forEach(({ inputId, errorId }) => {
    const inputEl = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (inputEl) inputEl.classList.remove('workshop-field-invalid');
    if (errorEl) errorEl.textContent = '';
  });
}

function scheduleWorkshopLiveValidation(delayMs = 220) {
  if (workshopLiveValidationTimer) {
    clearTimeout(workshopLiveValidationTimer);
  }
  workshopLiveValidationTimer = setTimeout(() => {
    workshopLiveValidationTimer = null;
    runWorkshopLiveValidation();
  }, delayMs);
}

function hasWorkshopBuilderInput() {
  const hasCode = !!getEditorValue(pluginEditor).trim();
  const hasJson = !!getEditorValue(jsonEditor).trim();
  const hasName = !!getFieldValue('workshop-pattern-name');
  const hasCategory = !!getFieldValue('workshop-category');
  return hasCode || hasJson || hasName || hasCategory;
}

function buildCurrentArtifactForPreflight() {
  const rawDefinition = getEditorValue(jsonEditor).trim();
  if (!rawDefinition) {
    return {
      errors: [createPreflightIssue('definition', 'Pattern definition JSON is empty.')],
      artifacts: [],
    };
  }

  let definition;
  try {
    definition = JSON.parse(rawDefinition);
  } catch (error) {
    return {
      errors: [createPreflightIssue('definition', `Pattern definition JSON is invalid: ${error.message || 'Parse error'}`)],
      artifacts: [],
    };
  }

  const requestedPatternId = getFieldValue('workshop-pattern-id') || definition.pattern_id || definition.name || 'new_plugin';
  const patternId = normalizePatternIdForDefinition(requestedPatternId, definition);
  const patternName = getFieldValue('workshop-pattern-name') || String(definition.name || '').trim() || patternId;
  const category = getFieldValue('workshop-category') || String(definition.category || '').trim() || 'custom';
  const composition = String(definition?.composition || 'primitive').toLowerCase();
  const artifactType = String(definition?.artifact_type || 'indicator').toLowerCase();

  const normalizedDefinition = {
    ...definition,
    pattern_id: patternId,
    name: patternName,
    category,
    pattern_type: patternId,
    plugin_file: `plugins/${patternId}.py`,
    plugin_function: `run_${patternId}_plugin`,
  };

  return {
    errors: [],
    artifacts: [
      {
        pattern_id: patternId,
        definition: normalizedDefinition,
        code: getEditorValue(pluginEditor).trim(),
        composition,
        artifact_type: artifactType,
      },
    ],
  };
}

function runWorkshopLiveValidation() {
  if (!hasWorkshopBuilderInput()) {
    clearWorkshopValidationErrors();
    return;
  }

  // Don't validate the blank default state — only run when the user has actually started building
  const hasCode = !!getEditorValue(pluginEditor).trim();
  const hasName = !!getFieldValue('workshop-pattern-name').trim();
  const hasCategory = !!getFieldValue('workshop-category').trim();
  const rawJson = getEditorValue(jsonEditor).trim();
  const isDefaultJson = rawJson === JSON.stringify(DEFAULT_DEFINITION, null, 2);
  if (!hasCode && !hasName && !hasCategory && isDefaultJson) {
    clearWorkshopValidationErrors();
    return;
  }

  const snapshot = buildCurrentArtifactForPreflight();
  if (snapshot.errors.length) {
    renderWorkshopValidationErrors(snapshot.errors, '', { suppressOutput: true });
    return;
  }

  const issues = validateArtifactsPreflight(snapshot.artifacts, { requireCode: false });
  if (!issues.length) {
    clearWorkshopValidationErrors();
    return;
  }
  renderWorkshopValidationErrors(issues, '', { suppressOutput: true });
}

function mapValidationField(rawField) {
  const field = String(rawField || '').trim();
  if (!field) return '';
  if (field === 'name') return 'name';
  if (field === 'pattern_id' || field === 'definition.pattern_id' || field === 'pattern_type') return 'pattern_id';
  if (field === 'category') return 'category';
  if (field === 'code') return 'code';
  if (field === 'plugin_file' || field === 'plugin_function' || field === 'composition' || field === 'artifact_type' || field === 'indicator_role' || field === 'pattern_role') {
    return 'json';
  }
  if (
    field === 'definition' ||
    field.startsWith('default_setup_params.') ||
    field.startsWith('definition.')
  ) {
    return 'json';
  }
  return '';
}

function buildValidationMessage(issue) {
  if (!issue || typeof issue !== 'object') return '';
  const message = String(issue.message || '').trim();
  const expected = String(issue.expected || '').trim();
  const example = String(issue.example || '').trim();
  const suffix = [expected ? `Expected: ${expected}.` : '', example ? `Example: ${example}` : '']
    .filter(Boolean)
    .join(' ');
  return `${message}${suffix ? ` ${suffix}` : ''}`.trim();
}

function renderWorkshopValidationErrors(issues, fallbackMessage = '', options = {}) {
  const suppressOutput = options && options.suppressOutput === true;
  clearWorkshopValidationErrors();
  const list = Array.isArray(issues) ? issues : [];
  if (!list.length) {
    if (fallbackMessage && !suppressOutput) {
      renderTestOutput(`<p class="workshop-test-error">${escapeHtml(fallbackMessage)}</p>`);
    }
    return;
  }

  const leftover = [];
  list.forEach((issue) => {
    const key = mapValidationField(issue?.field);
    const msg = buildValidationMessage(issue);
    if (!key || !WORKSHOP_VALIDATION_FIELDS[key] || !msg) {
      leftover.push(msg || 'Validation error');
      return;
    }

    const { inputId, errorId } = WORKSHOP_VALIDATION_FIELDS[key];
    const inputEl = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (inputEl) inputEl.classList.add('workshop-field-invalid');
    if (errorEl && !errorEl.textContent) {
      errorEl.textContent = msg;
    }
  });

  if (leftover.length && !suppressOutput) {
    const rows = leftover.map((msg) => `<li>${escapeHtml(msg)}</li>`).join('');
    renderTestOutput(`<p class="workshop-test-error">Validation failed.</p><ul class="workshop-rule-list">${rows}</ul>`);
  }
}

// ---------------------------------------------------------------------------
// Validation gate helpers
// ---------------------------------------------------------------------------

async function computeCodeDefinitionHash() {
  const code = pluginEditor ? pluginEditor.getValue() : '';
  const def = jsonEditor ? jsonEditor.getValue() : '';
  const payload = code + '||' + def;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function updateRegisterButtonState() {
  const btn = document.getElementById('btn-register');
  if (!btn) return;

  if (workshopTestValidationPassed) {
    btn.disabled = false;
    btn.title = 'Register this plugin';
    btn.classList.remove('btn-disabled');
  } else {
    btn.disabled = true;
    btn.title = 'Run a successful test first &mdash; plugin must pass validation before registration';
    btn.classList.add('btn-disabled');
  }
}

function renderValidationResults(validationPassed, validationErrors) {
  const container = document.getElementById('workshop-test-output');
  if (!container) return;

  if (validationPassed) {
    const badge = document.createElement('div');
    badge.className = 'workshop-validation-badge workshop-validation-pass';
    badge.innerHTML = '<strong>VALIDATED</strong> &mdash; Plugin output structure is correct. Ready to register.';
    container.appendChild(badge);
  } else if (validationErrors && validationErrors.length) {
    const badge = document.createElement('div');
    badge.className = 'workshop-validation-badge workshop-validation-fail';
    badge.innerHTML =
      '<strong>VALIDATION FAILED</strong> &mdash; Fix these issues before registering:' +
      '<ul class="workshop-rule-list">' +
      validationErrors.map((e) => `<li class="rule-fail">${escapeHtml(e)}</li>`).join('') +
      '</ul>';
    container.appendChild(badge);
  }
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLen) {
  const text = String(value || '');
  if (!Number.isFinite(maxLen) || maxLen <= 0) return text;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n...[truncated]`;
}

window.sendWorkshopChat = sendWorkshopChat;
window.testPlugin = testPlugin;
window.saveDraft = saveDraft;
window.startBlankBuilder = startBlankBuilder;
window.registerPlugin = registerPlugin;
window.handlePatternNameInput = handlePatternNameInput;
window.handleWorkshopChatKeydown = handleWorkshopChatKeydown;
window.syncDefinitionMetaFields = syncDefinitionMetaFields;
window.setWorkshopTab = setWorkshopTab;
window.handleLibraryFilterChange = handleLibraryFilterChange;
window.runWorkshopPatternScan = runWorkshopPatternScan;
window.startWorkshopAutoLabel = startWorkshopAutoLabel;
window.showWorkshopScannerCandidate = showWorkshopScannerCandidate;
window.workshopScannerLabel = workshopScannerLabel;
window.toggleWorkshopCorrection = toggleWorkshopCorrection;
window.workshopScannerStartSetLevel = workshopScannerStartSetLevel;
window.workshopScannerCancelCorrection = workshopScannerCancelCorrection;
window.workshopScannerSaveCorrection = workshopScannerSaveCorrection;
window.sendWorkshopScannerChat = sendWorkshopScannerChat;
window.handleWorkshopScannerChatKeydown = handleWorkshopScannerChatKeydown;
window.workshopScannerApplyUniverseFilter = workshopScannerApplyUniverseFilter;
window.workshopScannerApplyAISuggestion = workshopScannerApplyAISuggestion;
window.workshopScannerLoadAIDecisions = workshopScannerLoadAIDecisions;
window.workshopScannerApplySort = workshopScannerApplySort;
window.workshopScannerLoadLatestAIResults = workshopScannerLoadLatestAIResults;
window.runWorkshopMethodCompare = runWorkshopMethodCompare;
window.runWorkshopSingleMethodScan = runWorkshopSingleMethodScan;
window.workshopScannerHandlePatternChange = workshopScannerHandlePatternChange;
