// =========================================================================
// index.js — Orchestrator / shared globals / page routing / showCandidate
// =========================================================================

const API_URL = '';  // Same origin

let candidates = [];
let currentIndex = 0;

// Track whatever is currently displayed on chart (swing, fib-energy, or candidate)
let currentDisplayData = null;

// Swing review mode state
let swingReviewMode = false;
let swingReviewSymbols = [];
let swingReviewIndex = 0;
let swingReviewSettings = { period: 'max', interval: '1wk' };
let swingDisplayActive = false;  // Guard to prevent other functions from overwriting swing display
const fundamentalsCache = new Map();

function setCandidateInfoVisibility(isVisible) {
  const panelEl = document.getElementById('candidate-info-panel');
  const detailsEl = document.getElementById('candidate-details');
  const fundamentalsShellEl = document.getElementById('scanner-fundamentals-shell');

  if (panelEl) panelEl.classList.toggle('hidden', !isVisible);
  if (detailsEl) detailsEl.classList.toggle('hidden', !isVisible);
  if (fundamentalsShellEl && !isVisible) fundamentalsShellEl.classList.add('hidden');
}

// ── Load stats ───────────────────────────────────────────────────────────

// ── Load unlabeled candidates ────────────────────────────────────────────

async function loadCandidates(autoShow = true) {
  try {
    const res = await fetch(`${API_URL}/api/candidates/unlabeled`);
    const data = await res.json();

    if (data.success) {
      candidates = data.data;
      currentIndex = 0;
      candidates.forEach(c => saveCandidateToStorage(c));

      if (autoShow) {
        if (candidates.length > 0) { showCandidate(currentIndex); }
        else {
          setCandidateInfoVisibility(false);
        }
      }
      document.getElementById('total-count').textContent = candidates.length;
      updateCandidateNavButtons();
    }
  } catch (err) {
    console.error('Failed to load candidates:', err);
  }
}

function formatDate(isoDate) {
  if (!isoDate) return 'N/A';
  try { const d = new Date(isoDate); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return isoDate.substring(0, 10); }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCompactNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return Number(value).toFixed(2);
}

function formatPercentValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return Number(value).toFixed(1) + '%';
}

function formatSignedPercentValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  const num = Number(value);
  return (num > 0 ? '+' : '') + num.toFixed(1) + '%';
}

function formatMoneyValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  const abs = Math.abs(Number(value));
  if (abs >= 1000) return '$' + formatCompactNumber(value);
  return '$' + Number(value).toFixed(2);
}

function formatRatioValue(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return Number(value).toFixed(2) + suffix;
}

function formatRunwayValue(value, freeCashFlowTTM, operatingCashFlowTTM) {
  if (freeCashFlowTTM != null && freeCashFlowTTM > 0) return 'Self-funded';
  if (operatingCashFlowTTM != null && operatingCashFlowTTM > 0 && (value == null || value >= 99)) return 'OpCF positive';
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  if (value >= 99) return '12q+';
  return Number(value).toFixed(1) + 'q';
}

function formatDaysToEarnings(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return 'N/A';
  if (days < 0) return 'Passed';
  return Number(days).toFixed(0) + 'd';
}

function formatFlagLabel(flag) {
  if (!flag) return 'N/A';
  if (flag === 'earnings_soon') return 'Earnings soon';
  if (flag === 'just_reported') return 'Just reported';
  if (flag === 'no_near_catalyst') return 'No near catalyst';
  if (flag === 'accelerating') return 'Accelerating';
  if (flag === 'decelerating') return 'Decelerating';
  if (flag === 'steady') return 'Steady';
  return String(flag).replace(/_/g, ' ');
}

function formatScoreValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return Number(value).toFixed(0) + '/100';
}

function formatSignalLabel(value) {
  if (!value) return 'N/A';
  if (value === 'supportive') return 'Supportive';
  if (value === 'weak') return 'Weak';
  if (value === 'mixed') return 'Mixed';
  if (value === 'buying') return 'Buying';
  if (value === 'selling') return 'Selling';
  if (value === 'quiet') return 'Quiet';
  return String(value);
}

function semanticRoleStyle(role) {
  if (role === 'context_indicator') return { border: 'rgba(148,163,184,0.35)', color: '#cbd5e1', bg: 'rgba(148,163,184,0.08)' };
  if (role === 'pattern_detector') return { border: 'rgba(96,165,250,0.35)', color: '#93c5fd', bg: 'rgba(96,165,250,0.10)' };
  return { border: 'rgba(16,185,129,0.35)', color: '#6ee7b7', bg: 'rgba(16,185,129,0.12)' };
}

function semanticActionabilityStyle(actionability) {
  if (actionability === 'context_only') return { color: 'var(--color-text-muted)' };
  if (actionability === 'entry_ready') return { color: 'var(--color-positive, #4ade80)' };
  return { color: '#fcd34d' };
}

function tagToneStyle(tone) {
  if (tone === 'positive') return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', color: '#6ee7b7' };
  if (tone === 'warning') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', color: '#fcd34d' };
  if (tone === 'danger') return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', color: '#fca5a5' };
  if (tone === 'muted') return { bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.25)', color: '#94a3b8' };
  return { bg: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.28)', color: '#93c5fd' };
}

function summaryCard(label, value, sublabel) {
  return (
    '<div style="padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;background:rgba(255,255,255,0.02);">' +
      '<div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">' + escapeHtml(label) + '</div>' +
      '<div style="font-size:14px;font-weight:600;color:var(--color-text);">' + escapeHtml(value) + '</div>' +
      (sublabel ? '<div style="font-size:11px;color:var(--color-text-muted);margin-top:3px;">' + escapeHtml(sublabel) + '</div>' : '') +
    '</div>'
  );
}

function metricRow(label, value, tone) {
  let color = 'var(--color-text)';
  if (tone === 'positive') color = '#6ee7b7';
  else if (tone === 'warning') color = '#fcd34d';
  else if (tone === 'danger') color = '#fca5a5';

  return (
    '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.04);">' +
      '<span style="color:var(--color-text-muted);font-size:12px;">' + escapeHtml(label) + '</span>' +
      '<span style="color:' + color + ';font-size:12px;font-weight:600;text-align:right;">' + escapeHtml(value) + '</span>' +
    '</div>'
  );
}

function sectionCard(title, rows) {
  return (
    '<div style="border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;">' +
      '<div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;font-weight:600;">' + escapeHtml(title) + '</div>' +
      rows.map(row => metricRow(row[0], row[1], row[2])).join('') +
    '</div>'
  );
}

function collapsibleSectionCard(title, content, summaryText) {
  return (
    '<details style="border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;">' +
      '<summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">' +
        '<span>' + escapeHtml(title) + '</span>' +
        '<span style="font-size:10px;color:var(--color-text-subtle);">' + escapeHtml(summaryText || 'Research only') + '</span>' +
      '</summary>' +
      '<div style="margin-top:10px;">' + content + '</div>' +
    '</details>'
  );
}

function buildEarningsHistoryCard(earnings) {
  const cellStyle = 'padding:3px 6px;font-size:11px;font-family:var(--font-mono,monospace);white-space:nowrap;';
  const hdrStyle = cellStyle + 'color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--color-border);';
  let html = '<div style="border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;font-weight:600;">Earnings History</div>';
  html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">';
  html += '<tr><th style="' + hdrStyle + 'text-align:left;">QTR</th><th style="' + hdrStyle + 'text-align:right;">EPS</th><th style="' + hdrStyle + 'text-align:right;">EST</th><th style="' + hdrStyle + 'text-align:right;">BEAT</th><th style="' + hdrStyle + 'text-align:right;">SALES</th></tr>';
  earnings.forEach(function(e) {
    const beatPct = e.epsSurprisePct;
    const beatColor = beatPct != null ? (beatPct > 0 ? '#4a8a60' : (beatPct < 0 ? '#9a5050' : 'inherit')) : 'inherit';
    const beatStr = beatPct != null ? (beatPct > 0 ? '+' : '') + beatPct.toFixed(1) + '%' : '--';
    const salesStr = e.salesActual != null ? (e.salesActual >= 1e9 ? (e.salesActual / 1e9).toFixed(1) + 'B' : (e.salesActual / 1e6).toFixed(0) + 'M') : '--';
    html += '<tr>';
    html += '<td style="' + cellStyle + '">' + escapeHtml(e.period || '') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;">' + (e.epsActual != null ? e.epsActual.toFixed(2) : '--') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;color:var(--color-text-muted);">' + (e.epsEstimate != null ? e.epsEstimate.toFixed(2) : '--') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;color:' + beatColor + ';">' + beatStr + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;">' + salesStr + '</td>';
    html += '</tr>';
  });
  html += '</table></div></div>';
  return html;
}

function buildInsiderTradesCard(trades) {
  const cellStyle = 'padding:3px 6px;font-size:11px;font-family:var(--font-mono,monospace);white-space:nowrap;';
  const hdrStyle = cellStyle + 'color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--color-border);';
  let html = '<div style="border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;font-weight:600;">Insider Trades</div>';
  html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">';
  html += '<tr><th style="' + hdrStyle + 'text-align:left;">WHO</th><th style="' + hdrStyle + '">DATE</th><th style="' + hdrStyle + '">TYPE</th><th style="' + hdrStyle + 'text-align:right;">VALUE</th></tr>';
  trades.slice(0, 8).forEach(function(t) {
    const txColor = t.transaction && t.transaction.toLowerCase().indexOf('sale') >= 0 ? '#9a5050' : '#4a8a60';
    const nameShort = (t.insider || '').length > 18 ? (t.insider || '').substring(0, 16) + '..' : (t.insider || '');
    html += '<tr>';
    html += '<td style="' + cellStyle + '" title="' + escapeHtml(t.insider || '') + ' - ' + escapeHtml(t.relationship || '') + '">' + escapeHtml(nameShort) + '</td>';
    html += '<td style="' + cellStyle + 'text-align:center;color:var(--color-text-muted);">' + escapeHtml(t.date || '') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:center;color:' + txColor + ';">' + escapeHtml(t.transaction || '') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;">' + escapeHtml(t.value || '--') + '</td>';
    html += '</tr>';
  });
  html += '</table></div></div>';
  return html;
}

function buildInstitutionalHoldersCard(holders) {
  const cellStyle = 'padding:3px 6px;font-size:11px;font-family:var(--font-mono,monospace);white-space:nowrap;';
  const hdrStyle = cellStyle + 'color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--color-border);';
  let html = '<div style="border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);padding:10px 12px;">';
  html += '<div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;font-weight:600;">Top Institutional Holders</div>';
  html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">';
  html += '<tr><th style="' + hdrStyle + 'text-align:left;">HOLDER</th><th style="' + hdrStyle + 'text-align:right;">SHARES</th><th style="' + hdrStyle + 'text-align:right;">% OUT</th></tr>';
  holders.slice(0, 8).forEach(function(h) {
    const nameShort = (h.holder || '').length > 24 ? (h.holder || '').substring(0, 22) + '..' : (h.holder || '');
    html += '<tr>';
    html += '<td style="' + cellStyle + '" title="' + escapeHtml(h.holder || '') + '">' + escapeHtml(nameShort) + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;">' + escapeHtml(h.shares || '--') + '</td>';
    html += '<td style="' + cellStyle + 'text-align:right;">' + escapeHtml(h.pctOut || '--') + '</td>';
    html += '</tr>';
  });
  html += '</table></div></div>';
  return html;
}

function renderFundamentalsSnapshot(data) {
  const panel = document.getElementById('fundamentals-panel');
  const status = document.getElementById('fundamentals-status');
  const summary = document.getElementById('fundamentals-summary');
  const tags = document.getElementById('fundamentals-tags');
  const grid = document.getElementById('fundamentals-grid');
  const shell = document.getElementById('scanner-fundamentals-shell');
  if (!panel || !status || !summary || !tags || !grid) return;

  if (!data) {
    panel.style.display = 'none';
    if (shell) shell.classList.add('hidden');
    summary.innerHTML = '';
    tags.innerHTML = '';
    grid.innerHTML = '';
    status.textContent = 'Waiting for symbol...';
    return;
  }

  panel.style.display = 'block';
  if (shell) shell.classList.remove('hidden');
  status.textContent = data.statusNote || data.riskNote || 'Loaded';

  const catalystSummary = data.catalystFlag === 'earnings_soon'
    ? `Earnings in ${formatDaysToEarnings(data.daysUntilEarnings)}`
    : data.catalystFlag === 'just_reported'
      ? `Reported ${formatDate(data.lastEarningsDate)}`
      : 'No near catalyst';
  const execution = data.reportedExecution || null;
  const forward = data.forwardExpectations || null;
  const positioning = data.positioning || null;
  const marketContext = data.marketContext || null;
  const ownership = data.ownership || null;
  const sdx = data.stockdex || null;
  const earningsHistory = execution && Array.isArray(execution.history) && execution.history.length
    ? execution.history
    : (sdx && Array.isArray(sdx.earningsHistory) ? sdx.earningsHistory : []);
  const insiderTrades = positioning && Array.isArray(positioning.recentTrades) && positioning.recentTrades.length
    ? positioning.recentTrades
    : (sdx && Array.isArray(sdx.insiderTrades) ? sdx.insiderTrades : []);
  const institutionalHolders = ownership && Array.isArray(ownership.topInstitutionalHolders) && ownership.topInstitutionalHolders.length
    ? ownership.topInstitutionalHolders
    : (sdx && Array.isArray(sdx.topInstitutionalHolders) ? sdx.topInstitutionalHolders : []);

  summary.innerHTML = [
    summaryCard('Tactical', data.tacticalGrade || data.holdContext || 'N/A', data.quality || 'N/A'),
    summaryCard(
      'Runway',
      formatRunwayValue(data.cashRunwayQuarters, data.freeCashFlowTTM, data.operatingCashFlowTTM),
      'Survival ' + (data.survivabilityScore != null ? Number(data.survivabilityScore).toFixed(0) + '/100' : 'N/A')
    ),
    summaryCard('Execution', formatScoreValue(data.reportedExecutionScore), execution ? `${execution.epsBeatStreak || 0}Q beat streak` : 'Recent reported quality'),
    summaryCard('Forward', formatScoreValue(data.forwardExpectationsScore), forward ? formatSignalLabel(forward.signal) : 'Estimate trend'),
    summaryCard('Insiders', formatScoreValue(data.positioningScore), positioning ? formatSignalLabel(positioning.signal) : 'Positioning'),
    summaryCard(
      'Squeeze',
      formatScoreValue(data.squeezePressureScore),
      data.squeezePressureLabel || 'N/A'
    ),
    summaryCard('Catalyst', formatFlagLabel(data.catalystFlag), catalystSummary),
  ].join('');

  const tagList = Array.isArray(data.tags) ? data.tags : [];
  tags.innerHTML = tagList.map(tag => {
    const style = tagToneStyle(tag.tone);
    return (
      '<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;border:1px solid ' + style.border + ';background:' + style.bg + ';color:' + style.color + ';font-size:11px;font-weight:600;letter-spacing:0.02em;">' +
        escapeHtml(tag.label) +
      '</span>'
    );
  }).join('');

  const sections = [
    sectionCard('Survivability', [
      ['Cash', formatMoneyValue(data.totalCash)],
      ['OpCF TTM', formatMoneyValue(data.operatingCashFlowTTM), data.operatingCashFlowTTM != null && data.operatingCashFlowTTM > 0 ? 'positive' : (data.operatingCashFlowTTM != null && data.operatingCashFlowTTM < 0 ? 'danger' : null)],
      ['FCF TTM', formatMoneyValue(data.freeCashFlowTTM), data.freeCashFlowTTM != null && data.freeCashFlowTTM > 0 ? 'positive' : (data.freeCashFlowTTM != null && data.freeCashFlowTTM < 0 ? 'danger' : null)],
      ['Burn / Q', formatMoneyValue(data.quarterlyCashBurn), data.quarterlyCashBurn != null && data.quarterlyCashBurn > 0 ? 'warning' : null],
      ['Runway', formatRunwayValue(data.cashRunwayQuarters, data.freeCashFlowTTM, data.operatingCashFlowTTM), data.cashRunwayQuarters != null && data.cashRunwayQuarters >= 8 ? 'positive' : (data.cashRunwayQuarters != null && data.cashRunwayQuarters < 4 ? 'danger' : null)],
      ['Cash / MCap', formatPercentValue(data.cashPctMarketCap)],
      ['Current Ratio', formatRatioValue(data.currentRatio)],
      ['Quick Ratio', formatRatioValue(data.quickRatio)],
    ]),
    sectionCard('Reported Execution', [
      ['Rev YoY', formatPercentValue(data.revenueYoYGrowthPct), data.revenueYoYGrowthPct != null && data.revenueYoYGrowthPct > 0 ? 'positive' : (data.revenueYoYGrowthPct != null && data.revenueYoYGrowthPct < 0 ? 'danger' : null)],
      ['Rev Q/Q', formatPercentValue(data.revenueQoQGrowthPct), data.revenueQoQGrowthPct != null && data.revenueQoQGrowthPct > 0 ? 'positive' : (data.revenueQoQGrowthPct != null && data.revenueQoQGrowthPct < 0 ? 'danger' : null)],
      ['Trend Flag', formatFlagLabel(data.revenueTrendFlag), data.revenueTrendFlag === 'accelerating' ? 'positive' : (data.revenueTrendFlag === 'decelerating' ? 'warning' : null)],
      ['EPS YoY', formatPercentValue(data.epsYoYGrowthPct), data.epsYoYGrowthPct != null && data.epsYoYGrowthPct > 0 ? 'positive' : (data.epsYoYGrowthPct != null && data.epsYoYGrowthPct < 0 ? 'danger' : null)],
      ['EPS Q/Q', formatPercentValue(data.epsQoQGrowthPct), data.epsQoQGrowthPct != null && data.epsQoQGrowthPct > 0 ? 'positive' : (data.epsQoQGrowthPct != null && data.epsQoQGrowthPct < 0 ? 'danger' : null)],
      ['EPS Surprise', formatPercentValue(data.epsSurprisePct), data.epsSurprisePct != null && data.epsSurprisePct > 0 ? 'positive' : (data.epsSurprisePct != null && data.epsSurprisePct < 0 ? 'danger' : null)],
      ['Avg EPS Beat', formatPercentValue(execution ? execution.avgEpsSurprisePct : null), execution && execution.avgEpsSurprisePct != null && execution.avgEpsSurprisePct > 0 ? 'positive' : (execution && execution.avgEpsSurprisePct != null && execution.avgEpsSurprisePct < 0 ? 'danger' : null)],
      ['Avg Sales Beat', formatPercentValue(execution ? execution.avgSalesSurprisePct : null), execution && execution.avgSalesSurprisePct != null && execution.avgSalesSurprisePct > 0 ? 'positive' : (execution && execution.avgSalesSurprisePct != null && execution.avgSalesSurprisePct < 0 ? 'danger' : null)],
      ['Beat Streak', execution ? String(execution.epsBeatStreak || 0) + 'Q' : 'N/A', execution && execution.epsBeatStreak >= 2 ? 'positive' : null],
      ['Miss Streak', execution ? String(execution.epsMissStreak || 0) + 'Q' : 'N/A', execution && execution.epsMissStreak >= 2 ? 'danger' : null],
    ]),
    sectionCard('Forward Expectations', [
      ['Current Qtr', formatPercentValue(forward ? forward.currentQtrGrowthPct : null), forward && forward.currentQtrGrowthPct != null && forward.currentQtrGrowthPct > 0 ? 'positive' : (forward && forward.currentQtrGrowthPct != null && forward.currentQtrGrowthPct < 0 ? 'danger' : null)],
      ['Next Qtr', formatPercentValue(forward ? forward.nextQtrGrowthPct : null), forward && forward.nextQtrGrowthPct != null && forward.nextQtrGrowthPct > 0 ? 'positive' : (forward && forward.nextQtrGrowthPct != null && forward.nextQtrGrowthPct < 0 ? 'danger' : null)],
      ['Current Year', formatPercentValue(forward ? forward.currentYearGrowthPct : null), forward && forward.currentYearGrowthPct != null && forward.currentYearGrowthPct > 0 ? 'positive' : (forward && forward.currentYearGrowthPct != null && forward.currentYearGrowthPct < 0 ? 'danger' : null)],
      ['Next Year', formatPercentValue(forward ? forward.nextYearGrowthPct : null), forward && forward.nextYearGrowthPct != null && forward.nextYearGrowthPct > 0 ? 'positive' : (forward && forward.nextYearGrowthPct != null && forward.nextYearGrowthPct < 0 ? 'danger' : null)],
      ['Signal', formatSignalLabel(forward ? forward.signal : null), forward && forward.signal === 'supportive' ? 'positive' : (forward && forward.signal === 'weak' ? 'warning' : null)],
      ['Qtr Rev Growth', formatPercentValue(forward ? forward.quarterlyRevenueGrowthPct : null), forward && forward.quarterlyRevenueGrowthPct != null && forward.quarterlyRevenueGrowthPct > 0 ? 'positive' : (forward && forward.quarterlyRevenueGrowthPct != null && forward.quarterlyRevenueGrowthPct < 0 ? 'danger' : null)],
      ['Qtr Earnings Growth', formatPercentValue(forward ? forward.quarterlyEarningsGrowthPct : null), forward && forward.quarterlyEarningsGrowthPct != null && forward.quarterlyEarningsGrowthPct > 0 ? 'positive' : (forward && forward.quarterlyEarningsGrowthPct != null && forward.quarterlyEarningsGrowthPct < 0 ? 'danger' : null)],
      ['Forward Score', formatScoreValue(data.forwardExpectationsScore), data.forwardExpectationsScore != null && data.forwardExpectationsScore >= 65 ? 'positive' : (data.forwardExpectationsScore != null && data.forwardExpectationsScore <= 35 ? 'danger' : null)],
    ]),
    sectionCard('Positioning / Event Risk', [
      ['Insider Signal', formatSignalLabel(positioning ? positioning.signal : null), positioning && positioning.signal === 'buying' ? 'positive' : (positioning && positioning.signal === 'selling' ? 'warning' : null)],
      ['Recent Buys', positioning && positioning.recentBuyCount != null ? String(positioning.recentBuyCount) : 'N/A', positioning && positioning.recentBuyCount > 0 ? 'positive' : null],
      ['Recent Sales', positioning && positioning.recentSellCount != null ? String(positioning.recentSellCount) : 'N/A', positioning && positioning.recentSellCount > 0 ? 'warning' : null],
      ['Buy Value', formatMoneyValue(positioning ? positioning.recentBuyValue : null), positioning && positioning.recentBuyValue != null && positioning.recentBuyValue > 0 ? 'positive' : null],
      ['Sell Value', formatMoneyValue(positioning ? positioning.recentSellValue : null), positioning && positioning.recentSellValue != null && positioning.recentSellValue > 0 ? 'warning' : null],
      ['Next ER', formatDate(data.earningsDate)],
      ['Days to ER', formatDaysToEarnings(data.daysUntilEarnings), data.catalystFlag === 'earnings_soon' ? 'warning' : null],
      ['Catalyst', formatFlagLabel(data.catalystFlag), data.catalystFlag === 'just_reported' ? 'positive' : (data.catalystFlag === 'earnings_soon' ? 'warning' : null)],
    ]),
    sectionCard('Squeeze / Structure', [
      ['Float', formatCompactNumber(data.floatShares)],
      ['Avg Volume', formatCompactNumber(data.averageVolume)],
      ['Rel Volume', data.relativeVolume != null ? Number(data.relativeVolume).toFixed(2) + 'x' : 'N/A', data.relativeVolume != null && data.relativeVolume >= 1.5 ? 'positive' : null],
      ['Short Float', formatPercentValue(data.shortFloatPct), data.shortFloatPct != null && data.shortFloatPct >= 10 ? 'warning' : null],
      ['Days to Cover', formatRatioValue(data.shortRatio, 'd')],
      ['Shares YoY', formatPercentValue(data.sharesOutstandingYoYChangePct), data.sharesOutstandingYoYChangePct != null && data.sharesOutstandingYoYChangePct >= 5 ? 'danger' : (data.sharesOutstandingYoYChangePct != null && data.sharesOutstandingYoYChangePct < 0 ? 'positive' : null)],
      ['Financing', data.recentFinancingFlag ? 'Recent raise' : 'Quiet', data.recentFinancingFlag ? 'warning' : 'positive'],
      ['Squeeze Score', formatScoreValue(data.squeezePressureScore), data.squeezePressureScore != null && data.squeezePressureScore >= 70 ? 'positive' : null],
    ]),
    sectionCard('Market Context', [
      ['50-Day MA', formatMoneyValue(marketContext ? marketContext.fiftyDayMovingAverage : null)],
      ['200-Day MA', formatMoneyValue(marketContext ? marketContext.twoHundredDayMovingAverage : null)],
      ['Vs 50-Day', formatSignedPercentValue(marketContext ? marketContext.priceVs50DayPct : null), marketContext && marketContext.priceVs50DayPct != null && marketContext.priceVs50DayPct >= 0 ? 'positive' : (marketContext && marketContext.priceVs50DayPct != null ? 'warning' : null)],
      ['Vs 200-Day', formatSignedPercentValue(marketContext ? marketContext.priceVs200DayPct : null), marketContext && marketContext.priceVs200DayPct != null && marketContext.priceVs200DayPct >= 0 ? 'positive' : (marketContext && marketContext.priceVs200DayPct != null ? 'warning' : null)],
      ['52W Change', formatSignedPercentValue(marketContext ? marketContext.fiftyTwoWeekChangePct : null), marketContext && marketContext.fiftyTwoWeekChangePct != null && marketContext.fiftyTwoWeekChangePct >= 0 ? 'positive' : (marketContext && marketContext.fiftyTwoWeekChangePct != null ? 'warning' : null)],
      ['52W Range', formatPercentValue(marketContext ? marketContext.priceVs52WeekRangePct : null), marketContext && marketContext.priceVs52WeekRangePct != null && marketContext.priceVs52WeekRangePct >= 70 ? 'positive' : (marketContext && marketContext.priceVs52WeekRangePct != null && marketContext.priceVs52WeekRangePct <= 30 ? 'warning' : null)],
      ['Trend State', marketContext ? (marketContext.above200Day ? 'Above 200D' : (marketContext.above200Day === false ? 'Below 200D' : 'N/A')) : 'N/A', marketContext && marketContext.above200Day === true ? 'positive' : (marketContext && marketContext.above200Day === false ? 'warning' : null)],
      ['Market Score', formatScoreValue(data.marketContextScore), data.marketContextScore != null && data.marketContextScore >= 65 ? 'positive' : (data.marketContextScore != null && data.marketContextScore <= 35 ? 'warning' : null)],
    ]),
    sectionCard('Valuation', [
      ['Mkt Cap', formatCompactNumber(data.marketCap)],
      ['EV', formatCompactNumber(data.enterpriseValue)],
      ['EV / Sales', formatRatioValue(data.enterpriseToSales)],
      ['Cash - Debt', formatMoneyValue(data.netCash), data.netCash != null && data.netCash > 0 ? 'positive' : (data.netCash != null && data.netCash < 0 ? 'danger' : null)],
      ['Story Flag', data.lowEnterpriseValueFlag ? 'Cash-rich' : 'Normal', data.lowEnterpriseValueFlag ? 'positive' : null],
      ['Gross Margin', formatPercentValue(data.grossMarginPct)],
      ['Op Margin', formatPercentValue(data.operatingMarginPct)],
      ['Last ER', formatDate(data.lastEarningsDate)],
    ]),
  ];

  if (earningsHistory.length > 0) {
    sections.push(buildEarningsHistoryCard(earningsHistory.slice(0, 6)));
  }
  if (insiderTrades.length > 0) {
    sections.push(buildInsiderTradesCard(insiderTrades));
  }
  if (institutionalHolders.length > 0) {
    sections.push(
      collapsibleSectionCard(
        'Ownership Detail',
        buildInstitutionalHoldersCard(institutionalHolders),
        'Research only'
      )
    );
  }

  grid.innerHTML = sections.join('');
}

async function loadCandidateFundamentals(symbol) {
  const panel = document.getElementById('fundamentals-panel');
  const status = document.getElementById('fundamentals-status');
  const summary = document.getElementById('fundamentals-summary');
  const tags = document.getElementById('fundamentals-tags');
  const grid = document.getElementById('fundamentals-grid');
  const shell = document.getElementById('scanner-fundamentals-shell');
  if (!panel || !status || !summary || !tags || !grid || !symbol) return;

  panel.style.display = 'block';
  if (shell) shell.classList.remove('hidden');
  summary.innerHTML = '';
  tags.innerHTML = '';
  grid.innerHTML = '';
  status.textContent = 'Loading fundamentals...';

  if (fundamentalsCache.has(symbol)) {
    renderFundamentalsSnapshot(fundamentalsCache.get(symbol));
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/fundamentals/${encodeURIComponent(symbol)}`);
    const data = await res.json();
    if (!data.success || !data.data) {
      status.textContent = data.error || 'No fundamentals available';
      return;
    }
    fundamentalsCache.set(symbol, data.data);
    if (candidates[currentIndex]?.symbol === symbol) {
      renderFundamentalsSnapshot(data.data);
    }
  } catch (err) {
    status.textContent = 'Failed to load fundamentals';
    console.error('Failed to load fundamentals:', err);
  }
}

async function getFundamentalsForTradingDeskHandoff(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return null;

  if (fundamentalsCache.has(normalized)) {
    return fundamentalsCache.get(normalized);
  }

  try {
    const res = await fetch(`${API_URL}/api/fundamentals/${encodeURIComponent(normalized)}`);
    const data = await res.json();
    if (!data?.success || !data.data) return null;
    fundamentalsCache.set(normalized, data.data);
    return data.data;
  } catch (err) {
    console.warn('Failed to fetch fundamentals for Trading Desk handoff:', err);
    return null;
  }
}

// ── Show a candidate (main routing) ──────────────────────────────────────

function showCandidate(index) {
  if (index >= candidates.length) {
    setCandidateInfoVisibility(false);
    const gateEl = document.getElementById('entry-gate');
    if (gateEl) gateEl.classList.add('entry-gate--hidden');
    updateCandidateNavButtons();
    return;
  }

  if (swingDisplayActive) { console.log('showCandidate skipped - swing display is active'); return; }

  if (drawingCtx) { clearAllDrawings(); }

  if (aiPriceLines && aiPriceLines.length > 0) {
    aiPriceLines.forEach(line => { try { patternSeries.removePriceLine(line); } catch (e) {} });
    aiPriceLines = [];
  }

  const aiSuggestions = document.getElementById('ai-suggestions');
  if (aiSuggestions) aiSuggestions.classList.add('hidden');
  const mlScores = document.getElementById('ml-scores');
  if (mlScores) mlScores.classList.add('hidden');

  const candidate = candidates[index];
  const lastSymbol = document.getElementById('ai-panel')?.dataset?.loadedSymbol;
  if (candidate?.symbol && candidate.symbol !== lastSymbol) {
    clearScannerChatSession(candidate.symbol, candidate.timeframe || 'N/A');
  }

  setCandidateInfoVisibility(true);

  // Strategy badge + entry_ready + rule checklist
  var stratBar = document.getElementById('candidate-strategy-bar');
  var stratBadge = document.getElementById('info-strategy-badge');
  var candidateRole = document.getElementById('info-candidate-role');
  var entryReady = document.getElementById('info-entry-ready');
  var rulesSummary = document.getElementById('info-rules-summary');
  var rulePanel = document.getElementById('rule-checklist-panel');
  var ruleItems = document.getElementById('rule-checklist-items');

  if (candidate.strategy_version_id) {
    stratBar.style.display = 'flex';
    var svid = candidate.strategy_version_id || '';
    var statusColor = '#666';
    var stratStatus = candidate._strategy_status || 'approved';
    if (stratStatus === 'approved') statusColor = 'var(--color-positive, #4ade80)';
    else if (stratStatus === 'testing') statusColor = '#f59e0b';
    else if (stratStatus === 'draft') statusColor = '#6b7280';
    else if (stratStatus === 'rejected') statusColor = 'var(--color-negative, #ef4444)';
    stratBadge.textContent = svid;
    stratBadge.style.borderColor = statusColor;
    stratBadge.style.color = statusColor;
    stratBadge.style.background = 'rgba(255,255,255,0.02)';

    if (candidateRole) {
      const roleLabel = candidate.candidate_role_label || 'Pattern';
      const roleStyle = semanticRoleStyle(candidate.candidate_role);
      candidateRole.textContent = roleLabel;
      candidateRole.style.display = 'inline-flex';
      candidateRole.style.borderColor = roleStyle.border;
      candidateRole.style.color = roleStyle.color;
      candidateRole.style.background = roleStyle.bg;
    }

    if (candidate.entry_ready !== undefined) {
      const actionabilityLabel = candidate.candidate_actionability_label || (candidate.entry_ready ? 'Entry Ready' : 'Watch');
      const actionStyle = semanticActionabilityStyle(candidate.candidate_actionability);
      entryReady.textContent = `\u25CF ${String(actionabilityLabel).toUpperCase()}`;
      entryReady.style.color = actionStyle.color;
      entryReady.title = candidate.candidate_semantic_summary || '';
    } else { entryReady.textContent = ''; }

    if (candidate.rule_checklist && candidate.rule_checklist.length > 0) {
      var passed = candidate.rule_checklist.filter(function (r) { return r.passed; }).length;
      var total = candidate.rule_checklist.length;
      rulesSummary.textContent = passed + '/' + total + ' rules passed';
      rulePanel.style.display = 'block';
      ruleItems.innerHTML = candidate.rule_checklist.map(function (r) {
        var icon = r.passed ? '\u2713' : '\u2717';
        var color = r.passed ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #ef4444)';
        var val = r.value !== null && r.value !== undefined ? (typeof r.value === 'number' ? r.value.toFixed(3) : String(r.value)) : '\u2014';
        return '<span style="font-size:11px;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.04);color:' + color + ';" title="' + r.rule_name + ': value=' + val + ', threshold=' + JSON.stringify(r.threshold) + '">' + icon + ' ' + r.rule_name.replace(/_/g, ' ') + '</span>';
      }).join('');
    } else {
      rulesSummary.textContent = '';
      rulePanel.style.display = 'none';
      ruleItems.innerHTML = '';
    }
  } else {
    stratBar.style.display = 'none';
    rulePanel.style.display = 'none';
    ruleItems.innerHTML = '';
    if (candidateRole) candidateRole.style.display = 'none';
  }

  // Basic info
  document.getElementById('info-symbol').textContent = candidate.symbol;
  document.getElementById('info-score').textContent = candidate.score?.toFixed(2) || 'N/A';
  document.getElementById('info-retracement').parentElement.style.display = 'none';
  loadCandidateFundamentals(candidate.symbol);

  // Hide the Wyckoff phases grid — scanner only needs chart + annotations
  const phasesEl = document.getElementById('wyckoff-phases');
  if (phasesEl) phasesEl.style.display = 'none';

  document.getElementById('current-index').textContent = index + 1;
  document.getElementById('chart-symbol').textContent = candidate.symbol + ' (' + candidate.timeframe + ')';
  if (typeof setChartContext === 'function') {
    const intervalMap = { 'W': '1wk', 'D': '1d', '1h': '1h', '4h': '4h', 'M': '1mo' };
    const indicatorSelect = document.getElementById('scan-indicator-select');
    const activePluginId = indicatorSelect ? String(indicatorSelect.value || '').trim() : '';
    setChartContext(candidate.symbol, intervalMap[candidate.timeframe] || '1d', activePluginId || candidate.pattern_type || '');
  }
  updateEntryGate(candidate);
  drawPatternChart(candidate);
  updateCandidateNavButtons();
}

function updateCandidateNavButtons() {
  const prevBtn = document.getElementById('btn-prev-candidate');
  const nextBtn = document.getElementById('btn-next-candidate');
  const controls = document.getElementById('candidate-nav-controls');
  const symbolLabel = document.getElementById('nav-symbol-label');
  if (!prevBtn || !nextBtn) return;

  const hasCandidates = Array.isArray(candidates) && candidates.length > 0;
  prevBtn.disabled = !hasCandidates || currentIndex <= 0;
  nextBtn.disabled = !hasCandidates || currentIndex >= (candidates.length - 1);
  if (controls) controls.classList.toggle('hidden', !hasCandidates);
  if (symbolLabel && hasCandidates) {
    symbolLabel.textContent = candidates[currentIndex]?.symbol || '';
  }
}

function goToPreviousCandidate() {
  if (!Array.isArray(candidates) || candidates.length === 0 || currentIndex <= 0) return;
  currentIndex -= 1;
  if (typeof selectCandidate === 'function') selectCandidate(currentIndex);
  else showCandidate(currentIndex);
  if (typeof renderScanResults === 'function') renderScanResults(candidates);
}

function goToNextCandidateFromNav() {
  if (!Array.isArray(candidates) || candidates.length === 0 || currentIndex >= (candidates.length - 1)) return;
  currentIndex += 1;
  if (typeof selectCandidate === 'function') selectCandidate(currentIndex);
  else showCandidate(currentIndex);
  if (typeof renderScanResults === 'function') renderScanResults(candidates);
}

// ── Keyboard arrow navigation ─────────────────────────────────────────────
function isTypingTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

function handleCandidateArrowKey(e) {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    goToPreviousCandidate();
    return true;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    goToNextCandidateFromNav();
    return true;
  }
  return false;
}

document.addEventListener('keydown', function(e) {
  if (isTypingTarget(e.target)) return;
  handleCandidateArrowKey(e);
});

// ── Label / Skip / Review ────────────────────────────────────────────────

async function submitLabel(label) {
  if (currentIndex >= candidates.length) return;
  const candidate = candidates[currentIndex];
  try {
    const res = await fetch(`${API_URL}/api/labels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: candidate.id, label: label, userId: 'default' })
    });
    const data = await res.json();
    if (data.success) { currentIndex++; showCandidate(currentIndex); loadRecentLabels(); }
    else { alert('Failed to save label: ' + data.error); }
  } catch (err) { console.error('Failed to submit label:', err); alert('Failed to submit label'); }
}

function skipCandidate() {
  if (swingReviewMode && swingReviewSymbols.length > 0) {
    swingReviewIndex++;
    if (swingReviewIndex < swingReviewSymbols.length) {
      const nextSymbol = swingReviewSymbols[swingReviewIndex];
      if (swingReviewSettings.scanMode === 'fib-energy') { loadFibEnergyForSymbol(nextSymbol); }
      else { loadSwingForSymbol(nextSymbol); }
      document.getElementById('scan-status').textContent = `${nextSymbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length})`;
    } else {
      alert('Finished reviewing all symbols!');
      swingReviewMode = false; swingDisplayActive = false;
      document.getElementById('scan-status').textContent = 'Review complete';
    }
  } else if (swingDisplayActive) {
    document.getElementById('scan-status').textContent = 'Use Scan All to enable SKIP navigation';
  } else {
    currentIndex++; showCandidate(currentIndex);
  }
}

async function loadSwingForSymbol(symbol) {
  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = `Loading ${symbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length})...`;
  try {
    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, period: swingReviewSettings.period, interval: swingReviewSettings.interval, timeframe: swingReviewSettings.interval === '1wk' ? 'W' : 'D', scanMode: swingReviewSettings.scanMode || 'swing', swingEpsilon: getScannerSwingEpsilon() })
    });
    const data = await res.json();
    if (data.success && data.data) {
      const swingData = Array.isArray(data.data) ? data.data[0] : data.data;
      displaySwingStructure(swingData);
      if ((swingReviewSettings.scanMode || 'swing') === 'regime') {
        statusEl.textContent = `${symbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length}) - ${swingData?.regime_state || swingData?.status || 'UNKNOWN'} (${(swingData?.regime_windows || []).length} windows)`;
      } else {
        const modeTag = swingData?.mode === 'RELATIVE' ? '[REL]' : '[MAJ]';
        statusEl.textContent = `${symbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length}) - ${swingData?.swing_points?.length || 0} swing points ${modeTag}`;
      }
    }
  } catch (err) { console.error(`Failed to load ${symbol}:`, err); statusEl.textContent = `Error loading ${symbol}`; }
}

async function loadFibEnergyForSymbol(symbol) {
  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = `Loading Fib+Energy for ${symbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length})...`;
  try {
    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, period: swingReviewSettings.period, interval: swingReviewSettings.interval, timeframe: swingReviewSettings.interval === '1wk' ? 'W' : 'D', scanMode: 'fib-energy', swingEpsilon: getScannerSwingEpsilon() })
    });
    const data = await res.json();
    if (data.success && data.data) {
      const fibData = Array.isArray(data.data) ? data.data[0] : data.data;
      displayFibEnergyStructure(fibData);
      statusEl.textContent = `${symbol} (${swingReviewIndex + 1}/${swingReviewSymbols.length}) - ${fibData?.signal || 'N/A'} [${fibData?.energy?.character_state || 'N/A'}]`;
    }
  } catch (err) { console.error(`Failed to load Fib+Energy for ${symbol}:`, err); statusEl.textContent = `Error loading ${symbol}`; }
}

// ── goToNextCandidate (shared by correction mode and general use) ────────

function goToNextCandidate() {
  document.getElementById('correction-panel').classList.add('hidden');
  correctionMode = false;
  correctionStep = null;
  currentIndex++;
  showCandidate(currentIndex);
}

// ── Send current candidate to Trading Desk ────────────────────────────────

async function sendTradingDesk() {
  const candidate = candidates[currentIndex];
  if (!candidate?.symbol) return;

  const tradingDeskWindow = window.open('about:blank', '_blank');

  const handoffApi = window.ScannerTradingDeskHandoff || null;
  const intervalValue = handoffApi?.normalizeInterval
    ? handoffApi.normalizeInterval(candidate.timeframe || _chartCurrentInterval || '1wk')
    : (candidate.timeframe || _chartCurrentInterval || '1wk');
  const symbol = String(candidate.symbol).trim().toUpperCase();
  let handoff = null;

  if (handoffApi?.buildPacket && handoffApi?.write) {
    const fundamentals = await getFundamentalsForTradingDeskHandoff(symbol);
    const aiAnalysis = typeof lastAIAnalysis !== 'undefined' ? lastAIAnalysis : null;
    handoff = handoffApi.buildPacket({
      candidate,
      symbol,
      interval: intervalValue,
      timeframe: candidate.timeframe || null,
      fundamentals,
      aiAnalysis,
    });
    handoffApi.write(handoff);
  }

  const params = new URLSearchParams({
    symbol,
    interval: intervalValue,
  });
  if (handoff?.id) {
    params.set('scannerHandoffId', handoff.id);
  }

  const targetUrl = `copilot.html?${params.toString()}`;
  if (tradingDeskWindow) {
    tradingDeskWindow.location = targetUrl;
  } else {
    window.open(targetUrl, '_blank');
  }
}

// ── Swing Sensitivity Slider ─────────────────────────────────────────────

const scannerSwingSlider = document.getElementById('scanner-swing-sensitivity');
const scannerSwingLabel = document.getElementById('scanner-swing-label');
if (scannerSwingSlider && scannerSwingLabel) {
  scannerSwingSlider.addEventListener('input', () => { scannerSwingLabel.textContent = scannerSwingSlider.value; });
}

function getScannerSwingEpsilon() {
  const slider = parseInt(document.getElementById('scanner-swing-sensitivity')?.value) || 5;
  return parseFloat((0.20 * Math.pow(0.75, slider - 1)).toFixed(4));
}

// ── Symbol catalog (categories used by training page) ────────────────────

const FALLBACK_SYMBOL_LISTS = {
  commodities: ['SPY'], futures: [], indices: ['SPY', 'QQQ'], sectors: [],
  international: [], bonds: [], smallcaps: [], crypto: [], forex: [], optionable: [], all: ['SPY', 'QQQ'],
};
let symbolLists = { ...FALLBACK_SYMBOL_LISTS };

function normalizeSymbolLists(raw) {
  const keys = ['commodities', 'futures', 'indices', 'sectors', 'international', 'bonds', 'smallcaps', 'crypto', 'forex', 'optionable'];
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of keys) {
    const arr = Array.isArray(src[key]) ? src[key] : [];
    out[key] = Array.from(new Set(arr.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)));
  }
  const allSet = new Set(Array.isArray(src.all) ? src.all.map(s => String(s || '').trim().toUpperCase()).filter(Boolean) : []);
  for (const key of keys) out[key].forEach(sym => allSet.add(sym));
  out.all = Array.from(allSet);
  return out;
}

async function loadSymbolCatalog() {
  try {
    const res = await fetch(`${API_URL}/api/candidates/symbols`);
    const data = await res.json();
    if (!data || !data.success || !data.data) throw new Error(data?.error || 'Failed to load symbol catalog');
    symbolLists = normalizeSymbolLists(data.data);
  } catch (err) {
    console.warn('Failed to load symbol catalog, using fallback:', err.message || err);
    symbolLists = { ...FALLBACK_SYMBOL_LISTS };
  }
}

// ── Clear / Reset ────────────────────────────────────────────────────────

async function clearCandidates() {
  if (!confirm('Clear all candidates?\n\nLabels and corrections will be PRESERVED for learning.')) return;
  try {
    const res = await fetch(`${API_URL}/api/candidates`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { loadCandidates(); document.getElementById('scan-status').textContent = 'Candidates cleared (labels preserved)'; }
  } catch (err) { alert('Failed to clear candidates: ' + err.message); }
}

async function resetAllData() {
  if (!confirm('WARNING: RESET ALL DATA?\n\nThis will delete:\n- All candidates\n- All labels (Yes/No/Close)\n- All corrections\n- All localStorage data\n\nThis cannot be undone. Are you sure?')) return;
  try {
    await fetch(`${API_URL}/api/candidates`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/labels/all`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/corrections/all`, { method: 'DELETE' });
    localStorage.removeItem('trainingLabels'); localStorage.removeItem('trainingCorrections'); localStorage.removeItem('scannedCandidates');
    trainingLabels = []; trainingCorrections = []; scannedCandidates = [];
    candidates = []; currentIndex = 0;
    loadCandidates(); loadRecentLabels(); updateTrainingCounts();
    document.getElementById('scan-status').textContent = 'All data reset - fresh start';
    alert('All data cleared successfully!');
  } catch (err) { alert('Failed to reset data: ' + err.message); }
}

function clearLocalStorageOnly() {
  if (!confirm('Clear localStorage to fix quota error?\n\nThis will remove training labels and corrections from browser storage.\nBackend data will be preserved.')) return;
  localStorage.removeItem('trainingLabels'); localStorage.removeItem('trainingCorrections'); localStorage.removeItem('scannedCandidates');
  trainingLabels = []; trainingCorrections = []; scannedCandidates = [];
  updateTrainingCounts();
  alert('localStorage cleared! You can now save new labels.');
}

// ── Load recent labels ───────────────────────────────────────────────────

async function loadRecentLabels() {
  try {
    const container = document.getElementById('recent-labels');
    if (!container) return;
    const res = await fetch(`${API_URL}/api/labels`);
    const data = await res.json();
    if (data.success && data.data.length > 0) {
      container.innerHTML = data.data.slice(0, 10).map(label => `
        <div class="flex items-center justify-between bg-gray-700 rounded px-3 py-2">
          <span class="font-mono text-sm">${label.candidateId.substring(0, 20)}...</span>
          <span class="px-2 py-1 rounded text-xs font-bold ${label.label === 'yes' ? 'bg-green-600' : label.label === 'no' ? 'bg-red-600' : 'bg-yellow-600'}">${label.label.toUpperCase()}</span>
        </div>
      `).join('');
    }
  } catch (err) { /* Silently fail */ }
}

// ========== SIDEBAR FUNCTIONS ==========

window.addEventListener('sidebar-toggled', function () {
  setTimeout(function () {
    if (patternChart) { patternChart.applyOptions({ width: document.getElementById('pattern-chart').clientWidth }); }
  }, 350);
});

function toggleSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.toggle('collapsed');
  var key = 'section-collapsed';
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  stored[sectionId] = section.classList.contains('collapsed');
  localStorage.setItem(key, JSON.stringify(stored));
}

(function restoreSectionStates() {
  try {
    var stored = JSON.parse(localStorage.getItem('section-collapsed') || '{}');
    Object.keys(stored).forEach(function (id) {
      if (stored[id]) { var el = document.getElementById(id); if (el) el.classList.add('collapsed'); }
    });
  } catch (e) {}
})();

function showPage(page) {
  const targetPage = ['scanner', 'training', 'saved', 'settings'].includes(page) ? page : 'scanner';

  document.querySelectorAll('.sidebar-nav-item[id^="nav-"]').forEach(el => {
    if (['nav-training', 'nav-saved', 'nav-settings'].includes(el.id)) { el.classList.remove('active'); }
  });
  document.querySelectorAll('.scanner-page-tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); });

  if (targetPage !== 'scanner') { const navItem = document.getElementById('nav-' + targetPage); if (navItem) navItem.classList.add('active'); }
  const tabButton = document.getElementById('tab-' + targetPage);
  if (tabButton) { tabButton.classList.add('active'); tabButton.setAttribute('aria-selected', 'true'); }

  const titles = { 'scanner': 'Scanner', 'training': 'Training Data', 'saved': 'Saved Symbols', 'settings': 'Settings' };
  document.getElementById('page-title').textContent = titles[targetPage] || targetPage;
  const scannerStats = document.getElementById('scanner-stats');
  if (scannerStats) scannerStats.classList.toggle('hidden', targetPage !== 'scanner');
  const candidateNav = document.getElementById('candidate-nav-controls');
  if (candidateNav && targetPage !== 'scanner') candidateNav.classList.add('hidden');
  if (candidateNav && targetPage === 'scanner') updateCandidateNavButtons();

  document.getElementById('scanner-content').classList.add('hidden');
  document.getElementById('training-content').classList.add('hidden');
  document.getElementById('saved-content').classList.add('hidden');
  document.getElementById('settings-content').classList.add('hidden');

  if (targetPage === 'training') { document.getElementById('training-content').classList.remove('hidden'); renderSymbolsPage(); renderCandidatesPage(); renderLabelsPage(); renderCorrectionsPage(); }
  else if (targetPage === 'saved') { document.getElementById('saved-content').classList.remove('hidden'); updateSavedChartsList(); }
  else if (targetPage === 'settings') { document.getElementById('settings-content').classList.remove('hidden'); universeRefreshStatus(); _universeCheckWeeklyUpdate(); }
  else { document.getElementById('scanner-content').classList.remove('hidden'); }
}

// ── Training pages: Symbols, Candidates, Labels, Corrections ─────────────

function renderSymbolsPage(searchFilter) {
  const container = document.getElementById('symbols-list');
  const filter = (searchFilter || '').toUpperCase().trim();
  const allSymbols = new Set();
  Object.values(symbolLists).forEach(list => { list.forEach(s => allSymbols.add(s)); });
  scannedCandidates.forEach(c => allSymbols.add(c.symbol));
  const symbolsArray = Array.from(allSymbols).sort();
  const symbolsWithCandidates = new Set(scannedCandidates.map(c => c.symbol));

  const categories = {
    'Commodities': [...(symbolLists.commodities || [])].sort(),
    'Futures': [...(symbolLists.futures || [])].sort(),
    'Indices': [...(symbolLists.indices || [])].sort(),
    'Sectors': [...(symbolLists.sectors || [])].sort(),
    'Forex': [...(symbolLists.forex || [])].sort(),
    'International': [...(symbolLists.international || [])].sort(),
    'Bonds': [...(symbolLists.bonds || [])].sort(),
    'Small Caps': [...(symbolLists.smallcaps || [])].sort(),
    'Other': []
  };
  const predefinedSymbols = new Set();
  Object.values(symbolLists).forEach(list => list.forEach(s => predefinedSymbols.add(s)));
  symbolsArray.forEach(s => { if (!predefinedSymbols.has(s)) { categories['Other'].push(s); } });

  const filteredCategories = {};
  for (const [cat, syms] of Object.entries(categories)) {
    const filtered = filter ? syms.filter(s => s.toUpperCase().includes(filter)) : syms;
    if (filtered.length > 0) { filteredCategories[cat] = filtered; }
  }
  const totalFiltered = Object.values(filteredCategories).reduce((sum, arr) => sum + arr.length, 0);

  container.innerHTML = `
    <div style="margin-bottom:var(--space-24);padding:var(--space-16);background:var(--color-surface);border-radius:var(--radius);">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-16);text-align:center;">
        <div><div style="font-size:var(--text-h2);font-weight:700;">${symbolsArray.length}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Total Symbols</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-positive);">${symbolsWithCandidates.size}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">With Patterns</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-text-muted);">${symbolsArray.length - symbolsWithCandidates.size}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">No Pattern Found</div></div>
      </div>
    </div>
    <div style="margin-bottom:var(--space-24);">
      <input type="text" id="symbol-search-input" placeholder="Search symbols..." value="${filter}" oninput="renderSymbolsPage(this.value)" class="input" style="width:100%;">
      ${filter ? `<div style="font-size:var(--text-caption);color:var(--color-text-muted);margin-top:var(--space-4);">Showing ${totalFiltered} of ${symbolsArray.length} symbols</div>` : ''}
    </div>
    ${Object.entries(filteredCategories).map(([category, symbols]) => `
      <div style="margin-bottom:var(--space-24);">
        <h3 style="font-size:var(--text-small);font-weight:600;color:var(--color-text-muted);margin-bottom:var(--space-8);">${category} (${symbols.length})</h3>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-8);">
          ${symbols.map(symbol => {
            const hasCandidate = symbolsWithCandidates.has(symbol);
            const candidate = scannedCandidates.find(c => c.symbol === symbol);
            return `<div onclick="${hasCandidate ? `loadStoredCandidate('${candidate?.id}')` : `scanSingleSymbol('${symbol}')`}" class="btn btn-sm ${hasCandidate ? '' : 'btn-ghost'}" style="cursor:pointer;${hasCandidate ? 'background:var(--color-positive);color:var(--color-bg);' : ''}" title="${hasCandidate ? 'Click to view pattern' : 'Click to scan'}">${symbol}${hasCandidate ? '<span style="font-size:var(--text-caption);margin-left:2px;">\u2713</span>' : ''}</div>`;
          }).join('')}
        </div>
      </div>
    `).join('')}
    ${filter && totalFiltered === 0 ? `<div class="text-center py-8 text-gray-500"><div class="text-4xl mb-2">&#128269;</div><p>No symbols match "<strong>${filter}</strong>"</p></div>` : ''}
    <div class="mt-4 pt-4 border-t border-gray-600">
      <h3 class="text-sm font-semibold text-gray-400 mb-2">Add Custom Symbol</h3>
      <div class="flex gap-2">
        <input type="text" id="custom-symbol-input" placeholder="Enter symbol (e.g., TSLA)" class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2">
        <button onclick="addCustomSymbol()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">+ Add</button>
      </div>
    </div>
    <div class="mt-6 pt-4 border-t border-gray-600">
      <button onclick="resetAllTrainingData()" class="w-full bg-red-800 hover:bg-red-700 py-2 rounded text-sm">Reset All Training Data</button>
      <p class="text-xs text-gray-500 mt-1 text-center">Clears all candidates, labels, and corrections</p>
    </div>
  `;

  if (filter) {
    const searchInput = document.getElementById('symbol-search-input');
    if (searchInput) { searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); }
  }

  const customSymbolInput = document.getElementById('custom-symbol-input');
  if (customSymbolInput) {
    customSymbolInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomSymbol();
      }
    });
  }
  updateSymbolsCount();
}

function addCustomSymbol() {
  const input = document.getElementById('custom-symbol-input');
  const symbol = input.value.trim().toUpperCase();
  if (!symbol) return;
  input.value = '';
  scanSingleSymbol(symbol);
}

async function scanSingleSymbol(symbol) {
  showPage('scanner');
  const indicatorSelect = document.getElementById('scan-indicator-select');
  const pluginId = indicatorSelect ? String(indicatorSelect.value || '').trim() : '';
  if (!pluginId) { alert('Please select an indicator first.'); return; }

  const periodEl = document.getElementById('scan-period');
  const intervalEl = document.getElementById('scan-interval');
  const period = periodEl ? periodEl.value : 'max';
  const interval = intervalEl ? intervalEl.value : '1wk';
  const timeframe = getScanTimeframeFromInterval(interval);

  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = `Scanning ${symbol}...`;

  try {
    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, pluginId, interval, period, timeframe })
    });
    const data = await res.json();
    if (data?.success) {
      const found = Array.isArray(data?.data?.candidates) ? data.data.candidates : [];
      if (statusEl) statusEl.textContent = `${symbol}: ${found.length} candidate(s)`;
      if (found.length > 0) {
        candidates = found.map((c, i) => ({ ...c, symbol, id: c.id || c.candidate_id || i }));
        currentIndex = 0; showCandidate(0);
      }
    } else { if (statusEl) statusEl.textContent = `${symbol}: ${data?.error || 'No results'}`; }
  } catch (err) { if (statusEl) statusEl.textContent = `Scan failed: ${err.message}`; }
}

function updateSymbolsCount() {
  const allSymbols = new Set();
  Object.values(symbolLists).forEach(list => list.forEach(s => allSymbols.add(s)));
  scannedCandidates.forEach(c => allSymbols.add(c.symbol));
  const countEl = document.getElementById('nav-symbols-count');
  if (countEl) countEl.textContent = `(${allSymbols.size})`;
}

function renderCandidatesPage() {
  const container = document.getElementById('candidates-list-full');
  if (scannedCandidates.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:var(--space-64) 0;"><h3 style="font-size:var(--text-h2);font-weight:600;margin-bottom:var(--space-8);">No Scanned Candidates</h3><p class="text-muted">Scan patterns and they'll appear here.</p></div>`;
    return;
  }
  const analyzed = scannedCandidates.filter(c => c.aiAnalyzed).length;
  const labeled = scannedCandidates.filter(c => c.labeled).length;
  const corrected = scannedCandidates.filter(c => c.corrected).length;
  container.innerHTML = `
    <div style="margin-bottom:var(--space-24);padding:var(--space-16);background:var(--color-surface);border-radius:var(--radius);">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-16);text-align:center;">
        <div><div style="font-size:var(--text-h2);font-weight:700;">${scannedCandidates.length}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Total</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-accent);">${analyzed}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">AI Analyzed</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-accent);">${labeled}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Labeled</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-accent);">${corrected}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Corrected</div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-12);max-height:600px;overflow-y:auto;">
      ${scannedCandidates.map(cand => `
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-12);cursor:pointer;transition:border-color 0.2s;" onclick="loadStoredCandidate('${cand.id}')" onmouseover="this.style.borderColor='var(--color-accent)'" onmouseout="this.style.borderColor='var(--color-border)'">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <span class="text-mono" style="font-weight:700;font-size:var(--text-body);">${cand.symbol}</span>
              <span title="${escapeHtml(cand.candidate_semantic_summary || '')}" style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;margin-left:var(--space-4);border:1px solid ${semanticRoleStyle(cand.candidate_role).border};color:${semanticRoleStyle(cand.candidate_role).color};background:${semanticRoleStyle(cand.candidate_role).bg};">${escapeHtml(cand.candidate_role_label || cand.pattern_type || 'Pattern')}</span>
              ${cand.strategy_version_id ? '<span class="badge" style="margin-left:4px;border-color:var(--color-positive,#4ade80);color:var(--color-positive,#4ade80);font-size:10px;">' + cand.strategy_version_id + '</span>' : ''}
              <span title="${escapeHtml(cand.candidate_semantic_summary || '')}" style="margin-left:4px;color:${semanticActionabilityStyle(cand.candidate_actionability).color};font-size:10px;font-weight:600;">\u25CF ${escapeHtml((cand.candidate_actionability_label || (cand.entry_ready ? 'Entry Ready' : 'Watch')).toUpperCase())}</span>
              ${cand.aiAnalyzed ? '<span class="badge" style="margin-left:4px;">AI</span>' : ''}
              ${cand.labeled ? '<span class="badge" style="margin-left:4px;">Labeled</span>' : ''}
              ${cand.corrected ? '<span class="badge" style="margin-left:4px;">Corrected</span>' : ''}
              ${cand.savedAsChart ? '<span class="badge" style="margin-left:4px;">Saved</span>' : ''}
            </div>
            <button onclick="event.stopPropagation(); deleteStoredCandidate('${cand.id}')" style="color:var(--color-negative);background:transparent;border:none;cursor:pointer;font-size:var(--text-body);">\u00D7</button>
          </div>
          <p style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-4);">Scanned: ${cand.displayDate}</p>
        </div>
      `).join('')}
    </div>
    <button onclick="exportCandidates()" class="btn" style="margin-top:var(--space-16);width:100%;">Export All (JSON)</button>
  `;
}

async function loadStoredCandidate(id) {
  const cand = scannedCandidates.find(c => c.id === id);
  if (!cand) { alert('Candidate not found'); return; }
  swingReviewMode = false; swingReviewSymbols = []; swingReviewIndex = 0;
  showPage('scanner');
  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = `Loading ${cand.symbol}...`;
  try {
    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: cand.symbol, period: cand.period || 'max', interval: cand.interval || '1wk', timeframe: cand.timeframe || 'W', scanMode: cand.pattern_type === 'swing' ? 'swing' : 'wyckoff' })
    });
    const data = await res.json();
    if (data.success && data.data) {
      const scanMode = cand.pattern_type === 'swing' ? 'swing' : 'wyckoff';
      if (scanMode === 'swing') {
        const swingData = Array.isArray(data.data) ? data.data[0] : data.data;
        displaySwingStructure(swingData);
        const modeTag = swingData?.mode === 'RELATIVE' ? '[REL]' : '[MAJ]';
        statusEl.textContent = `${cand.symbol} - ${swingData?.swing_points?.length || 0} swing points ${modeTag}`;
      } else {
        const fullCandidate = { ...cand, ...data.data };
        const existsIdx = candidates.findIndex(c => c.id === cand.id);
        if (existsIdx < 0) { candidates.push(fullCandidate); currentIndex = candidates.length - 1; }
        else { candidates[existsIdx] = fullCandidate; currentIndex = existsIdx; }
        showCandidate(currentIndex);
        updateStats();
        document.getElementById('current-index').textContent = currentIndex + 1;
        document.getElementById('total-count').textContent = candidates.length;
        statusEl.textContent = `Loaded ${cand.symbol}`;
      }
    } else { statusEl.textContent = `Failed to load ${cand.symbol}`; }
  } catch (err) { console.error('Failed to load candidate:', err); statusEl.textContent = `Error loading ${cand.symbol}`; }
}

function deleteStoredCandidate(id) {
  if (!confirm('Remove this candidate from storage?')) return;
  scannedCandidates = scannedCandidates.filter(c => c.id !== id);
  localStorage.setItem('scannedCandidates', JSON.stringify(scannedCandidates));
  updateCandidatesCount(); renderCandidatesPage();
}

function clearAllCandidates() {
  if (!confirm('Clear ALL stored candidates? This cannot be undone.')) return;
  scannedCandidates = []; localStorage.setItem('scannedCandidates', JSON.stringify(scannedCandidates));
  updateCandidatesCount(); updateSymbolsCount(); renderCandidatesPage();
}

function clearAllLabels() {
  if (!confirm('Clear all training labels? This cannot be undone.')) return;
  trainingLabels = []; saveTrainingData(); renderLabelsPage();
}

function clearAllCorrections() {
  if (!confirm('Clear all corrections? This cannot be undone.')) return;
  trainingCorrections = []; saveTrainingData(); renderCorrectionsPage();
}

async function resetAllTrainingData() {
  if (!confirm('WARNING: RESET ALL TRAINING DATA?\n\nThis will clear:\n- All Candidates\n- All Labels\n- All Corrections\n\nThis cannot be undone!')) return;
  try {
    await fetch(`${API_URL}/api/candidates`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/candidates/discount`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/labels/all`, { method: 'DELETE' });
    await fetch(`${API_URL}/api/corrections/all`, { method: 'DELETE' });
    scannedCandidates = []; trainingLabels = []; trainingCorrections = [];
    candidates = []; currentIndex = 0;
    localStorage.removeItem('scannedCandidates'); localStorage.removeItem('trainingLabels'); localStorage.removeItem('trainingCorrections');
    clearChart();
    discountCandidates = []; displayDiscountResults([]);
    updateCandidatesCount(); updateSymbolsCount(); updateTrainingCounts(); updateSidebarStats();
    document.getElementById('current-index').textContent = '0';
    document.getElementById('total-count').textContent = '0';
    alert('All training data has been reset (candidates, labels, corrections, discount candidates).');
    showPage('scanner');
  } catch (err) { alert('Failed to reset training data: ' + err.message); }
}

function exportCandidates() {
  const blob = new Blob([JSON.stringify(scannedCandidates, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `scanned_candidates_${new Date().toISOString().split('T')[0]}.json`; a.click();
}

async function renderLabelsPage() {
  const container = document.getElementById('labels-list');
  let backendLabels = [];
  try { const res = await fetch(`${API_URL}/api/labels`); const data = await res.json(); if (data.success) backendLabels = data.data || []; } catch (err) { console.error('Failed to fetch labels:', err); }
  for (const label of backendLabels) {
    if (label.candidateId && !label.symbol) {
      try { const candRes = await fetch(`${API_URL}/api/candidates/${label.candidateId}`); const candData = await candRes.json(); if (candData.success && candData.data) { label.symbol = candData.data.symbol; label.timeframe = candData.data.timeframe; } } catch (e) {}
    }
  }
  const allLabels = [...backendLabels];
  if (allLabels.length === 0 && trainingLabels.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:var(--space-64) 0;"><h3 style="font-size:var(--text-h2);font-weight:600;margin-bottom:var(--space-8);">No Training Labels Yet</h3><p class="text-muted">Label patterns with YES/NO to build training data.</p></div>`;
    return;
  }
  const navCount = document.getElementById('nav-labels-count');
  if (navCount) navCount.textContent = `(${allLabels.length + trainingLabels.length})`;
  const yesCount = allLabels.filter(l => l.label === 'yes').length;
  const noCount = allLabels.filter(l => l.label === 'no').length;
  const closeCount = allLabels.filter(l => l.label === 'close').length;
  container.innerHTML = `
    <div style="margin-bottom:var(--space-24);padding:var(--space-16);background:var(--color-surface);border-radius:var(--radius);">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-16);text-align:center;">
        <div><div style="font-size:var(--text-h2);font-weight:700;">${allLabels.length}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Total</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-positive);">${yesCount}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">YES</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-negative);">${noCount}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">NO</div></div>
        <div><div style="font-size:var(--text-h2);font-weight:700;color:var(--color-accent);">${closeCount}</div><div style="font-size:var(--text-caption);color:var(--color-text-subtle);">CLOSE</div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--space-12);max-height:600px;overflow-y:auto;">
      ${allLabels.map(label => {
        const borderColor = label.label === 'yes' ? 'var(--color-positive)' : label.label === 'no' ? 'var(--color-negative)' : 'var(--color-accent)';
        const badgeColor = label.label === 'yes' ? 'var(--color-positive)' : label.label === 'no' ? 'var(--color-negative)' : 'var(--color-accent)';
        return `<div style="background:var(--color-surface);border:1px solid ${borderColor};border-radius:var(--radius);padding:var(--space-12);cursor:pointer;transition:opacity 0.2s;" onclick="loadLabelChart('${label.candidateId || ''}', '${label.symbol || ''}', '${label.timeframe || 'W'}')" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'"><div style="display:flex;justify-content:space-between;align-items:center;"><span class="text-mono" style="font-weight:700;">${label.symbol || label.candidateId?.substring(0, 8) || 'unknown'}</span><span class="badge" style="background:${badgeColor};color:var(--color-bg);">${(label.label || '').toUpperCase()}</span></div><p style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-4);">${label.createdAt ? new Date(label.createdAt).toLocaleString() : ''}</p></div>`;
      }).reverse().join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);margin-top:var(--space-16);">
      <button onclick="exportLabels()" class="btn">Export JSON</button>
      <button onclick="exportMLTrainingData()" class="btn">Export ML CSV</button>
    </div>
  `;
}

async function renderCorrectionsPage() {
  const container = document.getElementById('corrections-list');
  let backendCorrections = [];
  try { const res = await fetch(`${API_URL}/api/corrections`); const data = await res.json(); if (data.success) backendCorrections = data.data || []; } catch (err) { console.error('Failed to fetch corrections:', err); }
  const navCount = document.getElementById('nav-corrections-count');
  if (navCount) navCount.textContent = `(${backendCorrections.length})`;
  if (backendCorrections.length === 0) { container.innerHTML = `<div style="text-align:center;padding:var(--space-64) 0;"><h3 style="font-size:var(--text-h2);font-weight:600;margin-bottom:var(--space-8);">No Corrections Yet</h3><p class="text-muted">Use CORRECT IT to mark Wyckoff phases manually.</p></div>`; return; }
  container.innerHTML = `
    <div style="margin-bottom:var(--space-24);padding:var(--space-16);background:var(--color-surface);border-radius:var(--radius);text-align:center;">
      <div style="font-size:var(--text-h2);font-weight:700;">${backendCorrections.length}</div>
      <div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Phase Corrections</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--space-12);max-height:600px;overflow-y:auto;">
      ${backendCorrections.map(corr => `
        <div style="background:var(--color-surface);border:1px solid var(--color-accent);border-radius:var(--radius);padding:var(--space-12);cursor:pointer;transition:opacity 0.2s;" onclick="loadCorrectionChart('${corr.symbol || ''}', '${corr.timeframe || 'W'}', '${corr.candidateId || ''}')" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
          <div style="display:flex;justify-content:space-between;align-items:center;"><div><span class="text-mono" style="font-weight:700;">${corr.symbol || 'unknown'}</span><span style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-left:var(--space-4);">${corr.timeframe || ''}</span></div><span class="badge">Corrected</span></div>
          <p style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-4);">${corr.createdAt ? new Date(corr.createdAt).toLocaleString() : ''}</p>
          <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-8);">6 phases manually marked</div>
        </div>
      `).reverse().join('')}
    </div>
    <button onclick="exportCorrections()" class="btn" style="margin-top:var(--space-16);width:100%;">Export Corrections</button>
  `;
}

function deleteLabel(id) { if (!confirm('Delete this training label?')) return; trainingLabels = trainingLabels.filter(l => l.id !== id); saveTrainingData(); renderLabelsPage(); }
function deleteCorrection(id) { if (!confirm('Delete this correction?')) return; trainingCorrections = trainingCorrections.filter(c => c.id !== id); saveTrainingData(); renderCorrectionsPage(); }

function exportLabels() {
  const blob = new Blob([JSON.stringify(trainingLabels, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `training_labels_${new Date().toISOString().split('T')[0]}.json`; a.click();
}

function exportMLTrainingData() {
  if (trainingLabels.length === 0) { alert('No training data to export'); return; }
  const scannerFeatureNames = ['drawdown_pct', 'position_in_range', 'retracement', 'base_tightness', 'pattern_duration', 'volume_trend', 'momentum', 'volatility'];
  const aiScoreNames = ['ai_detector_agreement', 'ai_structure_quality', 'ai_pattern_clarity', 'ai_failure_risk', 'ai_timing_quality'];
  const header = ['symbol', 'timestamp', ...scannerFeatureNames, ...aiScoreNames, 'ai_valid', 'ai_confidence', 'user_correct', 'label'];
  const rows = trainingLabels.map(label => {
    const scannerFeatures = label.mlVector?.scannerFeatures || new Array(8).fill(0.5);
    const aiScores = label.mlVector?.aiScores || new Array(5).fill(0.5);
    const aiValid = label.aiAssessment?.isValidPattern ? 1 : 0;
    const aiConfidence = (label.aiAssessment?.confidence || 50) / 100;
    const userCorrect = label.userFeedback?.isCorrect ? 1 : 0;
    const finalLabel = label.mlVector?.label ?? (userCorrect ? 1 : 0);
    return [label.symbol, label.timestamp, ...scannerFeatures.map(v => v?.toFixed(4) || '0.5000'), ...aiScores.map(v => v?.toFixed(4) || '0.5000'), aiValid, aiConfidence.toFixed(4), userCorrect, finalLabel];
  });
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ml_training_data_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  alert(`Exported ${rows.length} training samples with ${header.length - 4} features each`);
}

function exportCorrections() {
  const blob = new Blob([JSON.stringify(trainingCorrections, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `training_corrections_${new Date().toISOString().split('T')[0]}.json`; a.click();
}

async function updateSidebarStats() {
  const candidatesCount = document.getElementById('nav-candidates-count');
  if (candidatesCount) candidatesCount.textContent = `(${candidates.length})`;
  try { const labelsRes = await fetch(`${API_URL}/api/labels`); const labelsData = await labelsRes.json(); if (labelsData.success) { const navLabels = document.getElementById('nav-labels-count'); if (navLabels) navLabels.textContent = `(${labelsData.data.length})`; } } catch (e) {}
  try { const corrRes = await fetch(`${API_URL}/api/corrections`); const corrData = await corrRes.json(); if (corrData.success) { const navCorr = document.getElementById('nav-corrections-count'); if (navCorr) navCorr.textContent = `(${corrData.data.length})`; } } catch (e) {}
}

function updateStats() {
  // Alias for consistency
  updateSidebarStats();
}

// ── Quick Symbol Load (chart only, no scan) ──────────────────────────────

async function quickLoadSymbol(symbol) {
  if (!symbol) return;
  symbol = symbol.trim().toUpperCase();
  if (!symbol) return;

  const intervalEl = document.getElementById('scan-interval');
  const interval = intervalEl ? intervalEl.value : '1d';
  const timeframeMap = { '1h': '1h', '4h': '4h', '1d': 'D', '1wk': 'W', '1mo': 'M' };
  const timeframe = timeframeMap[interval] || 'D';

  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = `Loading ${symbol}...`;

  try {
    const periodMap = { '1h': '730d', '4h': '730d', '1d': 'max', '1wk': 'max', '1mo': 'max' };
    const period = periodMap[interval] || '2y';
    const res = await fetch(`${API_URL}/api/chart/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${interval}&period=${period}`);
    const data = await res.json();
    if (!data?.success || !data?.chart_data?.length) {
      if (statusEl) statusEl.textContent = `${symbol}: no data`;
      return;
    }

    const candidate = {
      symbol,
      timeframe,
      pattern_type: 'chart_only',
      chart_data: data.chart_data,
      chart_base_start: -1,
      chart_base_end: -1,
    };

    candidates = [candidate];
    currentIndex = 0;

    swingDisplayActive = false;
    showCandidate(0);

    const totalCountEl = document.getElementById('total-count');
    if (totalCountEl) totalCountEl.textContent = '1';
    if (typeof renderScanResults === 'function') {
      renderScanResults(candidates);
    }

    if (statusEl) statusEl.textContent = `${symbol} (${timeframe}) — ${data.bars} bars`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `Failed to load ${symbol}: ${err.message}`;
  }
}

// ── DOMContentLoaded — Main initialization ───────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initPatternChart();
  await loadSymbolCatalog();
  await loadSymbolLibrary();
  loadRecentLabels();
  await loadIndicators();
  if (typeof resumeActiveScanIfNeeded === 'function') {
    await resumeActiveScanIfNeeded();
  }
  if (typeof updateSavedScanStatus === 'function') {
    updateSavedScanStatus();
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const persistedScanJob = typeof getPersistedActiveScanJob === 'function' ? getPersistedActiveScanJob() : null;
    if (!persistedScanJob && typeof restoreSavedScanResults === 'function') {
      await restoreSavedScanResults({ silent: true });
    }
  }

  updateTrainingCounts();
  updateCandidatesCount();
  updateSymbolsCount();
  checkAIStatus().then(() => { updateSidebarAIStatus(); });
  updateSavedChartsList();
  updateSidebarStats();

  // Quick symbol load on Enter key in the symbol input
  const symbolInput = document.getElementById('scan-single-symbol');
  if (symbolInput) {
    let lastTriggeredSymbol = '';
    let lastTriggeredAt = 0;
    const triggerQuickLoad = () => {
      const sym = symbolInput.value.trim().toUpperCase();
      if (!sym) return;
      const now = Date.now();
      if (sym === lastTriggeredSymbol && (now - lastTriggeredAt) < 500) return;
      lastTriggeredSymbol = sym;
      lastTriggeredAt = now;
      quickLoadSymbol(sym);
    };

    symbolInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerQuickLoad();
      }
    });

    // Selecting from datalist or clicking away after typing should auto-load.
    symbolInput.addEventListener('change', triggerQuickLoad);
  }

  // Chart-focused instrument navigation: click chart, then use ← / →.
  const chartContainerEl = document.getElementById('chart-container');
  if (chartContainerEl) {
    chartContainerEl.addEventListener('click', () => {
      try { chartContainerEl.focus(); } catch (err) {}
    });
    chartContainerEl.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      const handled = handleCandidateArrowKey(e);
      if (handled) e.stopPropagation();
    });
  }

  // Populate chart indicators select dropdown
  if (typeof refreshDynamicIndicators === 'function') {
    await refreshDynamicIndicators();
  }
  if (typeof _ciPopulateIndicatorSelect === 'function') {
    _ciPopulateIndicatorSelect();
  }
});
