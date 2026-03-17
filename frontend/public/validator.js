/**
 * Validator Page Logic
 * 
 * Manages strategy list, validation reports, and approve/reject workflow.
 */

const API_BASE = '/api/validator';

// =====================
// STATE
// =====================

let strategies = [];
let selectedStrategy = null;
let reports = [];
let selectedReport = null;
let strategyValidationIndex = {};
let strategyTierProgressIndex = {};
let activeRunJobId = null;
let runPollTimer = null;
let strategyEditorMode = 'new';
let validatorChatMessages = [];
const DEFAULT_VALIDATION_TIER = 'tier1';
let activeTierConfig = null;
const VALIDATION_TIER_LABELS = {
  tier1: 'Tier 1 - Kill Test',
  tier1b: 'Tier 1B - Evidence Expansion',
  tier2: 'Tier 2 - Core Validation',
  tier3: 'Tier 3 - Robustness',
};
const VALIDATION_TIER_DESCRIPTIONS = {
  tier1: 'Fast kill test on a fixed Tier 1 universe. Target evidence: 200-300 trades.',
  tier1b: 'Evidence expansion on a broad optionable universe slice. Use this when Tier 1 quality looks good but sample size is thin.',
  tier2: 'Core validation on a fixed Tier 2 universe. Target evidence: 500-1500 trades. Requires Tier 1 or Tier 1B PASS.',
  tier3: 'Robustness validation on a fixed Tier 3 universe. Stress tests for survivors. Requires Tier 2 PASS.',
};
const FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS = {
  futures: {
    tier1: ['ES=F', 'NQ=F', 'CL=F'],
    tier1b: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier2: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier3: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F', 'SI=F', 'NG=F', 'HG=F', '6E=F'],
  },
  stocks: {
    tier1: ['SPY', 'QQQ', 'IWM'],
    tier1b: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'XLK', 'XLF', 'XLE', 'XLI', 'XLV'],
    tier2: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN'],
    tier3: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'XLK', 'XLF', 'XLE', 'XLI', 'XLV'],
  },
  options: {
    tier1: ['SPY', 'QQQ'],
    tier1b: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier2: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier3: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'IWM', 'TLT'],
  },
  forex: {
    tier1: ['EURUSD=X', 'GBPUSD=X'],
    tier1b: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier2: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier3: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
  },
  crypto: {
    tier1: ['BTC-USD', 'ETH-USD'],
    tier1b: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier2: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier3: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD'],
  },
};

// =====================
// INIT
// =====================

document.addEventListener('DOMContentLoaded', async () => {
  await loadStrategies();
  await loadReports();
  updateStrategyInfo();
  renderReportContent();
  const params = new URLSearchParams(window.location.search);
  const initialReportId = params.get('report_id');
  const initialStrategy = params.get('strategy_version_id');
  const initialJobId = params.get('job_id');
  if (initialReportId) {
    try {
      const report = await apiGet(`/report/${encodeURIComponent(initialReportId)}`);
      if (report?.strategy_version_id) {
        await selectStrategy(report.strategy_version_id);
        selectedReport = reports.find(r => r.report_id === initialReportId) || report;
        renderReportContent();
      }
    } catch (err) {
      console.error('Failed to load initial report:', err);
    }
  } else if (initialStrategy) {
    await selectStrategy(initialStrategy);
  }
  updateRunTierDescription();
  initValidatorChat();
  await reconnectActiveRun(initialJobId, initialStrategy);
});

// =====================
// API CALLS
// =====================

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}

async function apiGetAbsolute(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}

async function apiPostAbsolute(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}

async function apiPatchAbsolute(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'API error');
  return data.data;
}


// =====================
// STRATEGIES
// =====================

async function loadStrategies() {
  try {
    const [loadedStrategies, allReports] = await Promise.all([
      apiGet('/strategies'),
      apiGet('/reports').catch(() => []),
    ]);
    strategies = (Array.isArray(loadedStrategies) ? loadedStrategies : [])
      .filter((strategy) => String(strategy?.status || '').toLowerCase() !== 'draft');
    if (selectedStrategy?.strategy_version_id) {
      selectedStrategy = strategies.find((s) => s.strategy_version_id === selectedStrategy.strategy_version_id) || null;
      if (!selectedStrategy) {
        selectedReport = null;
        reports = [];
        activeTierConfig = null;
      }
    }
    strategyValidationIndex = buildStrategyValidationIndex(allReports);
    strategyTierProgressIndex = buildStrategyTierProgressIndex(allReports);
    renderStrategyList();
  } catch (err) {
    console.error('Failed to load strategies:', err);
  }
}

function buildStrategyValidationIndex(allReports) {
  const index = {};
  const normalized = Array.isArray(allReports) ? allReports.slice() : [];
  normalized.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
  for (const report of normalized) {
    const strategyVersionId = String(report?.strategy_version_id || '').trim();
    if (!strategyVersionId || index[strategyVersionId]) continue;
    index[strategyVersionId] = {
      pass_fail: report?.pass_fail || null,
      validation_tier: report?.config?.validation_tier || null,
      report_id: report?.report_id || null,
      created_at: report?.created_at || null,
    };
  }
  return index;
}

function buildStrategyTierProgressIndex(allReports) {
  const index = {};
  const normalized = Array.isArray(allReports) ? allReports.slice() : [];
  normalized.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
  for (const report of normalized) {
    const strategyVersionId = String(report?.strategy_version_id || '').trim();
    const validationTier = String(report?.config?.validation_tier || '').trim().toLowerCase();
    if (!strategyVersionId || !validationTier) continue;
    if (!index[strategyVersionId]) index[strategyVersionId] = {};
    if (index[strategyVersionId][validationTier]) continue;
    index[strategyVersionId][validationTier] = {
      pass_fail: report?.pass_fail || null,
      report_id: report?.report_id || null,
      created_at: report?.created_at || null,
    };
  }
  return index;
}

function isTooFewTradesOnlyFail(report) {
  if (!report || report?.pass_fail !== 'FAIL') return false;
  const reasons = Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [];
  return reasons.length > 0 && reasons.every((reason) => /too few trades/i.test(String(reason || '')));
}

function getDisplayVerdict(report) {
  const verdict = String(report?.pass_fail || '').toUpperCase();
  if (verdict !== 'FAIL') return verdict || 'N/A';
  return isTooFewTradesOnlyFail(report) ? 'FAIL' : 'HARD_FAIL';
}

function syncStrategyValidationFromReports(strategyVersionId, strategyReports) {
  if (!strategyVersionId) return;
  const latest = Array.isArray(strategyReports) && strategyReports.length > 0 ? strategyReports[0] : null;
  if (!latest) {
    delete strategyValidationIndex[strategyVersionId];
    delete strategyTierProgressIndex[strategyVersionId];
    return;
  }
  strategyValidationIndex[strategyVersionId] = {
    pass_fail: latest?.pass_fail || null,
    validation_tier: latest?.config?.validation_tier || null,
    report_id: latest?.report_id || null,
    created_at: latest?.created_at || null,
  };
  strategyTierProgressIndex[strategyVersionId] = buildStrategyTierProgressIndex(strategyReports)[strategyVersionId] || {};
}

function getStrategyValidationBadge(strategy) {
  const summary = strategyValidationIndex?.[strategy?.strategy_version_id] || null;
  if (!summary || !summary.pass_fail) {
    return { key: 'untested', label: 'Untested', title: 'No validation reports yet' };
  }
  const displayVerdict = getDisplayVerdict(summary);
  if (displayVerdict === 'PASS') {
    return {
      key: 'pass',
      label: 'Pass',
      title: `Latest validation passed${summary.validation_tier ? ` (${summary.validation_tier})` : ''}`,
    };
  }
  if (displayVerdict === 'HARD_FAIL') {
    return {
      key: 'hard-fail',
      label: 'Hard Fail',
      title: `Latest validation hard failed${summary.validation_tier ? ` (${summary.validation_tier})` : ''}`,
    };
  }
  if (displayVerdict === 'FAIL') {
    return {
      key: 'fail',
      label: 'Fail',
      title: `Latest validation failed${summary.validation_tier ? ` (${summary.validation_tier})` : ''}`,
    };
  }
  return {
    key: 'review',
    label: 'Review',
    title: `Latest validation needs review${summary.validation_tier ? ` (${summary.validation_tier})` : ''}`,
  };
}

function getStrategyTierBadges(strategy) {
  const strategyVersionId = String(strategy?.strategy_version_id || '').trim();
  const progress = strategyTierProgressIndex?.[strategyVersionId] || {};
  const passedTiers = new Set(Array.isArray(strategy?.passed_tiers) ? strategy.passed_tiers : []);
  return ['tier1', 'tier1b', 'tier2', 'tier3'].flatMap((tier) => {
    const latestTierResult = progress?.[tier]?.pass_fail || null;
    if (tier === 'tier2' && latestTierResult === 'NEEDS_REVIEW') {
      return [{
        key: 'tier2-review',
        label: 'T2R',
        title: 'Tier 2 needs review',
      }];
    }
    if (!passedTiers.has(tier)) return [];
    const label = tier === 'tier1b' ? 'T1B' : tier.toUpperCase().replace('TIER', 'T');
    return [{
      key: tier,
      label,
      title: `Passed ${tier.toUpperCase()}`,
    }];
  });
}

function renderStrategyList() {
  const container = document.getElementById('strategy-list');
  const countEl = document.getElementById('strategy-count');
  
  countEl.textContent = strategies.length;
  
  if (strategies.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-32) var(--space-16);">
        <div class="empty-state-icon">&#9881;</div>
        <div>No strategies yet</div>
      </div>
    `;
    return;
  }
  
  // Split by source: registry/composite vs research
  const registryStrategies = strategies.filter(s => s.source !== 'research');
  const researchStrategies = strategies.filter(s => s.source === 'research');

  const statusLabels = {
    approved: 'Approved',
    testing: 'Testing',
    draft: 'Draft',
    experimental: 'Experimental',
    rejected: 'Rejected',
  };

  function renderGroup(items) {
    const groups = {};
    for (const s of items) {
      const key = s.status || 'draft';
      (groups[key] = groups[key] || []).push(s);
    }

    let html = '';
    for (const [status, list] of Object.entries(groups)) {
      html += `<div class="strategy-group-label">${statusLabels[status] || status} (${list.length})</div>`;
      for (const s of list) {
        const isActive = selectedStrategy && selectedStrategy.strategy_version_id === s.strategy_version_id;
        const validationBadge = getStrategyValidationBadge(s);
        const tierBadges = getStrategyTierBadges(s);
        html += `
          <div class="strategy-item ${isActive ? 'active' : ''}" 
               onclick="selectStrategy('${s.strategy_version_id}')">
            <div class="strategy-item-head">
              <div style="min-width:0;display:flex;align-items:center;gap:var(--space-6);flex-wrap:wrap;">
                <div class="strategy-item-name">${escHtml(s.name)}</div>
                ${tierBadges.map((badge) => `<span class="tier-badge" title="${escHtml(badge.title)}">${escHtml(badge.label)}</span>`).join('')}
              </div>
              <span class="validation-badge ${validationBadge.key}" title="${escHtml(validationBadge.title)}">${escHtml(validationBadge.label)}</span>
            </div>
            <div class="strategy-item-meta">
              <span class="status-badge ${s.status}">${s.status}</span>
              <span style="margin-left:var(--space-4);">${s.asset_class || 'N/A'} &middot; ${s.scan_mode || s.composition || '—'} &middot; v${s.version || 1}</span>
            </div>
          </div>
        `;
      }
    }
    return html;
  }

  let html = '';
  if (registryStrategies.length > 0) {
    html += `<div style="padding:var(--space-8) var(--space-12);font-weight:700;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-subtle);border-bottom:1px solid var(--color-border);margin-top:var(--space-4);">Strategies</div>`;
    html += renderGroup(registryStrategies);
  }
  if (researchStrategies.length > 0) {
    html += `<div style="padding:var(--space-8) var(--space-12);font-weight:700;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-subtle);border-bottom:1px solid var(--color-border);margin-top:var(--space-12);">Research Candidates</div>`;
    html += renderGroup(researchStrategies);
  }

  container.innerHTML = html;
}

function showReportView() {
  const reportContent = document.getElementById('report-content');
  const browser = document.getElementById('trade-browser');
  if (reportContent) reportContent.style.display = '';
  if (browser) browser.classList.remove('active');
}

async function selectStrategy(versionId) {
  selectedStrategy = strategies.find(s => s.strategy_version_id === versionId) || null;
  selectedReport = null;
  showReportView();

  renderStrategyList();
  updateStrategyInfo();
  
  // Load reports for this strategy
  if (selectedStrategy) {
    try {
      reports = await apiGet(`/reports?strategy_version_id=${versionId}`);
    } catch (err) {
      reports = [];
      console.error('Failed to load reports:', err);
    }
    await loadTierConfigForSelectedStrategy();
  } else {
    reports = [];
    activeTierConfig = null;
  }
  
  // Auto-select latest report
  if (reports.length > 0) {
    selectedReport = reports[0];
  }
  syncStrategyValidationFromReports(versionId, reports);
  
  renderReportContent();
  renderStrategyList();
  updateRunTierDescription();
}

function updateStrategyInfo() {
  const el = document.getElementById('selected-strategy-info');
  const btnRun = document.getElementById('btn-run');
  const btnClear = document.getElementById('btn-clear-reports');
  const btnEdit = document.getElementById('btn-edit-strategy');
  
  if (!selectedStrategy) {
    el.innerHTML = `<span style="color:var(--color-text-subtle);font-size:var(--text-small);">Select a strategy to view reports</span>`;
    if (btnRun) btnRun.disabled = true;
    if (btnClear) btnClear.disabled = true;
    if (btnEdit) btnEdit.disabled = true;
    return;
  }
  
  el.innerHTML = `
    <span style="font-weight:600;font-size:var(--text-body);">${escHtml(selectedStrategy.name)}</span>
    <span class="status-badge ${selectedStrategy.status}">${selectedStrategy.status}</span>
  `;
  if (btnRun) btnRun.disabled = false;
  if (btnClear) btnClear.disabled = false;
  if (btnEdit) btnEdit.disabled = false;
}

function normalizeAssetClassKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'futures' || raw === 'stocks' || raw === 'options' || raw === 'forex' || raw === 'crypto') {
    return raw;
  }
  return 'stocks';
}

function buildFallbackTierConfig(assetClass) {
  const key = normalizeAssetClassKey(assetClass);
  const byClass = FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS[key] || FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS.stocks;
  return {
    asset_class: key,
    tiers: {
      tier1: { key: 'tier1', label: VALIDATION_TIER_LABELS.tier1, description: VALIDATION_TIER_DESCRIPTIONS.tier1, symbols: byClass.tier1.slice() },
      tier1b: { key: 'tier1b', label: VALIDATION_TIER_LABELS.tier1b, description: VALIDATION_TIER_DESCRIPTIONS.tier1b, symbols: byClass.tier1b.slice() },
      tier2: { key: 'tier2', label: VALIDATION_TIER_LABELS.tier2, description: VALIDATION_TIER_DESCRIPTIONS.tier2, symbols: byClass.tier2.slice() },
      tier3: { key: 'tier3', label: VALIDATION_TIER_LABELS.tier3, description: VALIDATION_TIER_DESCRIPTIONS.tier3, symbols: byClass.tier3.slice() },
    },
  };
}

async function loadTierConfigForSelectedStrategy() {
  if (!selectedStrategy?.strategy_version_id) {
    activeTierConfig = null;
    return;
  }
  const fallback = buildFallbackTierConfig(selectedStrategy.asset_class);
  try {
    const data = await apiGet(`/tier-config?strategy_version_id=${encodeURIComponent(selectedStrategy.strategy_version_id)}`);
    if (!data || typeof data !== 'object' || !data.tiers) {
      activeTierConfig = fallback;
      return;
    }
    activeTierConfig = data;
  } catch (err) {
    console.warn('Tier config fetch failed, using fallback:', err);
    activeTierConfig = fallback;
  }
}

function onRunAssetClassChange() {
  const acEl = document.getElementById('run-validation-asset-class');
  if (!acEl) return;
  const ac = acEl.value || 'stocks';
  activeTierConfig = buildFallbackTierConfig(ac);
  if (selectedStrategy?.strategy_version_id) {
    apiGet(`/tier-config?strategy_version_id=${encodeURIComponent(selectedStrategy.strategy_version_id)}&asset_class=${encodeURIComponent(ac)}`)
      .then(data => {
        if (data && typeof data === 'object' && data.tiers) {
          activeTierConfig = data;
        }
        updateRunTierDescription();
      })
      .catch(() => updateRunTierDescription());
  }
  updateRunTierDescription();
}

function getRunTierKey() {
  const select = document.getElementById('run-validation-tier');
  const key = select?.value || DEFAULT_VALIDATION_TIER;
  return VALIDATION_TIER_LABELS[key] ? key : DEFAULT_VALIDATION_TIER;
}

function getTierContext(tierKey) {
  const key = String(tierKey || '').trim().toLowerCase();
  const config = activeTierConfig || buildFallbackTierConfig(selectedStrategy?.asset_class);
  const tier = config?.tiers?.[key];
  if (!tier) return null;
  return {
    tierKey: key,
    tierLabel: tier.label || VALIDATION_TIER_LABELS[key] || key,
    description: tier.description || VALIDATION_TIER_DESCRIPTIONS[key] || '',
    symbols: Array.isArray(tier.symbols) ? tier.symbols.slice() : [],
    assetClass: normalizeAssetClassKey(config.asset_class || selectedStrategy?.asset_class),
  };
}

function renderRunTierLibrary(selectedTierKey) {
  const container = document.getElementById('run-tier-library');
  if (!container) return;
  const config = activeTierConfig || buildFallbackTierConfig(selectedStrategy?.asset_class);
  const assetClass = normalizeAssetClassKey(config?.asset_class || selectedStrategy?.asset_class);
  const selectedKey = String(selectedTierKey || '').trim().toLowerCase();
  const keys = ['tier1', 'tier1b', 'tier2', 'tier3'];

  let html = `
    <div class="run-tier-library-header">Symbol Library (${escHtml(assetClass)})</div>
  `;
  for (const key of keys) {
    const tier = config?.tiers?.[key];
    const label = tier?.label || VALIDATION_TIER_LABELS[key] || key;
    const symbols = Array.isArray(tier?.symbols) ? tier.symbols : [];
    html += `
      <div class="run-tier-library-row ${selectedKey === key ? 'active' : ''}">
        <div class="run-tier-library-label">${escHtml(label)} (${symbols.length})</div>
        <div class="run-tier-library-symbols">${escHtml(symbols.join(', ') || 'No symbols configured')}</div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function strategyHasTierPass(tierKey) {
  if (!Array.isArray(reports) || reports.length === 0) return false;
  return reports.some((r) => r?.pass_fail === 'PASS' && r?.config?.validation_tier === tierKey);
}

function getLatestTierReport(tierKey) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  const matches = reports
    .filter((r) => r?.config?.validation_tier === tierKey)
    .slice()
    .sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
  return matches[0] || null;
}

function isTier1BEligibleReport(report) {
  if (!report) return false;
  if (report.pass_fail === 'NEEDS_REVIEW') return true;
  if (report.pass_fail !== 'FAIL') return false;
  const reasons = Array.isArray(report.pass_fail_reasons) ? report.pass_fail_reasons : [];
  return reasons.length > 0 && reasons.every((reason) => /too few trades/i.test(String(reason || '')));
}

function updateTierOptionLocks() {
  const select = document.getElementById('run-validation-tier');
  if (!select) return;
  const hasTier1Pass = strategyHasTierPass('tier1');
  const hasTier1BPass = strategyHasTierPass('tier1b');
  const hasTier2Pass = strategyHasTierPass('tier2');
  const latestTier1 = getLatestTierReport('tier1');
  const tier1bEligible = isTier1BEligibleReport(latestTier1);
  for (const opt of Array.from(select.options)) {
    if (opt.value === 'tier1b') {
      opt.disabled = !tier1bEligible;
    } else if (opt.value === 'tier2') {
      opt.disabled = !(hasTier1Pass || hasTier1BPass);
    } else if (opt.value === 'tier3') {
      opt.disabled = !hasTier2Pass;
    } else {
      opt.disabled = false;
    }
  }
  if (select.selectedOptions[0]?.disabled) {
    select.value = DEFAULT_VALIDATION_TIER;
  }
}

function updateRunTierDescription() {
  updateTierOptionLocks();
  const detailsEl = document.getElementById('run-tier-description');
  const tierKey = getRunTierKey();
  const context = getTierContext(tierKey);
  renderRunTierLibrary(tierKey);
  if (!detailsEl) return;
  if (!context) {
    detailsEl.innerHTML = `<div>No tier configuration available.</div>`;
    return;
  }
  const requirements = [];
  if (context.tierKey === 'tier1b' && !isTier1BEligibleReport(getLatestTierReport('tier1'))) {
    requirements.push('Tier 1B locked: requires a Tier 1 result that looks viable but lacks enough trades.');
  }
  if (context.tierKey === 'tier2' && !(strategyHasTierPass('tier1') || strategyHasTierPass('tier1b'))) {
    requirements.push('Tier 2 locked: requires a PASS on Tier 1 or Tier 1B.');
  }
  if (context.tierKey === 'tier3' && !strategyHasTierPass('tier2')) {
    requirements.push('Tier 3 locked: requires a PASS on Tier 2.');
  }
  detailsEl.innerHTML = `
    <div>${escHtml(context.tierLabel)}.</div>
    <div style="margin-top:var(--space-6);">${escHtml(context.description)}</div>
    <div class="run-tier-symbols">Asset class: ${escHtml(context.assetClass || 'stocks')}</div>
    <div class="run-tier-symbols">${context.symbols.length} symbols: ${escHtml(context.symbols.join(', '))}</div>
    ${requirements.length ? `<div class="run-tier-symbols" style="color:var(--color-negative);">${escHtml(requirements.join(' '))}</div>` : ''}
  `;
}

// =====================
// REPORTS
// =====================

async function loadReports() {
  try {
    // Load all reports (no filter) on initial page load
    const allReports = await apiGet('/reports');
    // Don't render -- wait for strategy selection
  } catch (err) {
    console.error('Failed to load reports:', err);
  }
}

function renderReportContent() {
  const container = document.getElementById('report-content');
  showReportView();

  if (!selectedStrategy) {
    container.innerHTML = renderReportTemplate({
      strategy: null,
      message: 'Select a strategy on the left to load report data into this template.'
    });
    return;
  }

  if (reports.length === 0) {
    container.innerHTML = renderReportTemplate({
      strategy: selectedStrategy,
      message: 'No validation report yet for this strategy. Click "Run Validation" to generate one.'
    });
    return;
  }
  
  // If we have reports, show report list + detail
  let html = '';
  
  // Report selector (if multiple)
  if (reports.length > 1) {
    html += `<div style="margin-bottom:var(--space-16);">`;
    for (const r of reports) {
      const isActive = selectedReport && selectedReport.report_id === r.report_id;
      const dateStr = new Date(r.created_at).toLocaleDateString();
      const cfg = r.config || {};
      const tierKey = String(cfg.validation_tier || '').trim().toLowerCase();
      const tierLabel = tierKey === 'tier1b' ? 'T1B' : (tierKey ? tierKey.toUpperCase().replace('TIER', 'T') : 'T?');
      const decision = r.decision_log?.decision || 'pending';
      const displayVerdict = getDisplayVerdict(r);
      html += `
        <div class="report-list-item ${isActive ? 'active' : ''}" 
             onclick="selectReport('${r.report_id}')">
          <div>
            <span class="text-mono" style="font-size:var(--text-caption);color:var(--color-text-subtle);">${r.report_id}</span>
            <span style="font-size:var(--text-caption);margin-left:var(--space-8);">${dateStr}</span>
            <span class="tier-badge" style="margin-left:var(--space-8);" title="${escHtml(cfg.validation_tier || 'Unknown tier')}">${escHtml(tierLabel)}</span>
            <span style="font-size:var(--text-caption);margin-left:var(--space-8);color:var(--color-text-subtle);">
              ${escHtml(cfg.date_start || 'N/A')} &rarr; ${escHtml(cfg.date_end || 'N/A')}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-8);">
            <span class="verdict-badge ${displayVerdict}">${displayVerdict.replace('_', ' ')}</span>
            ${decision !== 'pending' ? 
              `<span class="status-badge ${decision}">${decision}</span>` : ''}
          </div>
        </div>
      `;
    }
    html += `</div>`;
  }
  
  // Report detail
  if (selectedReport) {
    try {
      html += renderReportDetail(selectedReport);
    } catch (err) {
      console.error('Failed to render selected report:', err);
      html += renderReportTemplate({
        strategy: selectedStrategy,
        message: `Failed to render report ${selectedReport?.report_id || ''}. Check console for details.`
      });
    }
  } else {
    html += renderReportTemplate({
      strategy: selectedStrategy,
      message: 'Reports were found for this strategy, but none is currently selected.'
    });
  }
  
  container.innerHTML = html;
}

function selectReport(reportId) {
  selectedReport = reports.find(r => r.report_id === reportId) || null;
  showReportView();
  renderReportContent();
}

function renderReportDetail(report) {
  const r = report || {};
  const ts = r.trades_summary || {};
  const rs = r.risk_summary || {};
  const rob = r.robustness || {};
  const cfg = r.config || {};
  const oos = rob.out_of_sample || {};
  const wf = rob.walk_forward || {};
  const mc = rob.monte_carlo || {};
  const ps = rob.parameter_sensitivity || {};
  const universe = Array.isArray(cfg.universe) ? cfg.universe : [];
  const timeframes = Array.isArray(cfg.timeframes) ? cfg.timeframes : [];
  const costs = cfg.costs || {};
  const validationTier = cfg.validation_tier || 'N/A';
  const assetClass = cfg.asset_class || 'N/A';
  const strategyAlreadyRejected = String(selectedStrategy?.status || '').toLowerCase() === 'rejected';
  const thr = cfg.validation_thresholds || {};
  const maxOosDeg = num(thr.max_oos_degradation_pct || 50);
  const minWfProf = num(thr.min_wf_profitable_windows || 0.6);
  const maxMcP95 = num(thr.max_mc_p95_dd_pct || 30);
  const maxMcP99 = num(thr.max_mc_p99_dd_pct || 50);
  const maxSens = num(thr.max_sensitivity_score || 40);
  const displayVerdict = getDisplayVerdict(r);
  
  let html = '';
  
  // --- VERDICT ---
  const totalTrades = num(ts.total_trades);
  html += `
    <div style="display:flex;align-items:center;gap:var(--space-16);margin-bottom:var(--space-16);flex-wrap:wrap;">
      <span class="verdict-badge ${displayVerdict}" style="font-size:var(--text-h3);padding:var(--space-8) var(--space-24);">${displayVerdict.replace('_', ' ')}</span>
      <div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);">
          ${escHtml(cfg.date_start || 'N/A')} &rarr; ${escHtml(cfg.date_end || 'N/A')} &middot;
          ${escHtml(timeframes.join(', ') || 'N/A')} &middot; ${escHtml(String(universe.length))} symbols
        </div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:2px;">
          Tier: ${escHtml(String(validationTier))} &middot; Asset Class: ${escHtml(String(assetClass))}
        </div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:2px;">
          Costs: $${num(costs.commission_per_trade).toFixed(2)}/trade + ${num(costs.slippage_pct).toFixed(3)}% slippage
        </div>
      </div>
      <div style="margin-left:auto;display:flex;gap:var(--space-8);align-items:center;flex-shrink:0;">
        <button
          class="btn btn-ghost btn-sm"
          style="color:var(--color-warning, #d2a95d);"
          onclick="tombstoneSelectedStrategy()"
          title="${strategyAlreadyRejected ? 'This strategy is already tombstoned' : 'Mark this strategy rejected and send it to the tombstones page'}"
          ${selectedStrategy ? '' : 'disabled'}
          ${strategyAlreadyRejected ? 'disabled' : ''}
        >${strategyAlreadyRejected ? 'Strategy Tombstoned' : 'Tombstone Strategy'}</button>
        <button
          class="btn btn-ghost btn-sm"
          style="color:var(--color-negative);"
          onclick="deleteReport('${escHtml(r.report_id || '')}')"
          title="Delete this report"
        >Delete Report</button>
        <button
          id="btn-browse-trades"
          class="btn btn-ghost btn-sm"
          style="white-space:nowrap;"
          onclick="openTradeBrowser('${escHtml(r.report_id || '')}')"
          ${totalTrades > 0 ? '' : 'disabled'}
          title="${totalTrades > 0 ? `Browse all ${totalTrades} trades` : 'No trades were taken — strategy found no qualifying signals'}"
        >${totalTrades > 0 ? `Browse ${totalTrades} Trades &#8594;` : 'No Trades Taken'}</button>
      </div>
    </div>
  `;
  
  // --- TRADE SUMMARY ---
  html += `<div class="section-title">Trade Summary</div>`;
  html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Total Trades', intNum(ts.total_trades));
  html += metricCard('Win Rate', formatPct(ts.win_rate));
  html += metricCard('Expectancy', formatR(ts.expectancy_R), ts.expectancy_R >= 0);
  html += metricCard('Profit Factor', num(ts.profit_factor).toFixed(2), num(ts.profit_factor) >= 1);
  html += metricCard('W / L', `${intNum(ts.winners)} / ${intNum(ts.losers)}`);
  html += `</div>`;
  html += `<div class="metrics-grid cols-4">`;
  html += metricCard('Avg Win', formatR(ts.avg_win_R), true);
  html += metricCard('Avg Loss', formatR(ts.avg_loss_R), false);
  html += metricCard('Best Trade', formatR(ts.largest_win_R), true);
  html += metricCard('Worst Trade', formatR(ts.largest_loss_R), false);
  html += `</div>`;
  
  // --- RISK SUMMARY ---
  html += `<div class="section-title">Risk Summary</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Max DD %', num(rs.max_drawdown_pct).toFixed(1) + '%', false);
  html += metricCard('Max DD (R)', formatR(-num(rs.max_drawdown_R)), false);
  html += metricCard('Longest Losing', intNum(rs.longest_losing_streak) + ' trades');
  html += metricCard('Avg Losing Streak', (rs.avg_losing_streak != null ? num(rs.avg_losing_streak).toFixed(1) : 'N/A') + ' trades');
  html += `</div>`;
  html += `<div class="metrics-grid cols-4">`;
  html += metricCard('Max Time Under Water', intNum(rs.time_under_water_bars) + ' bars');
  html += metricCard('Exp. Recovery Time', (rs.expected_recovery_time_bars != null ? intNum(rs.expected_recovery_time_bars) : 'N/A') + ' bars');
  html += metricCard('Sharpe', rs.sharpe_ratio != null ? num(rs.sharpe_ratio).toFixed(2) : 'N/A', num(rs.sharpe_ratio) >= 1);
  html += metricCard('Calmar', rs.calmar_ratio != null ? num(rs.calmar_ratio).toFixed(2) : 'N/A', num(rs.calmar_ratio) >= 0.5);
  html += `</div>`;
  
  // --- ROBUSTNESS: OUT-OF-SAMPLE ---
  html += `<div class="section-title">Out-of-Sample</div>`;
  html += `<div class="metrics-grid cols-4">`;
  html += metricCard('IS Expectancy', formatR(oos.is_expectancy) + ` (n=${intNum(oos.is_n)})`, true);
  html += metricCard('OOS Expectancy', formatR(oos.oos_expectancy) + ` (n=${intNum(oos.oos_n)})`, oos.oos_expectancy > 0);
  html += metricCard('Degradation', num(oos.oos_degradation_pct).toFixed(1) + '%', num(oos.oos_degradation_pct) < maxOosDeg);
  html += metricCard('Split Date', oos.split_date);
  html += `</div>`;
  
  // --- ROBUSTNESS: WALK-FORWARD ---
  html += `<div class="section-title">Walk-Forward Analysis</div>`;
  html += `<div class="metrics-grid cols-3" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Windows', (wf.windows || []).length);
  html += metricCard('Avg Test Expectancy', formatR(wf.avg_test_expectancy), wf.avg_test_expectancy > 0);
  html += metricCard('% Profitable Windows', formatPct(wf.pct_profitable_windows), num(wf.pct_profitable_windows) >= minWfProf);
  html += `</div>`;
  
  // Walk-forward table
  html += `
    <div class="metric-card" style="overflow-x:auto;">
      <table class="wf-table">
        <thead>
          <tr>
            <th>Train Period</th>
            <th>Test Period</th>
            <th>Train Exp.</th>
            <th>Test Exp.</th>
            <th>Test N</th>
          </tr>
        </thead>
        <tbody>
  `;
  for (const w of (wf.windows || [])) {
    const testColor = w.test_expectancy > 0 ? 'var(--color-positive)' : 'var(--color-negative)';
    html += `
      <tr>
        <td>${w.train_start} &rarr; ${w.train_end}</td>
        <td>${w.test_start} &rarr; ${w.test_end}</td>
        <td>${formatR(w.train_expectancy)}</td>
        <td style="color:${testColor};font-weight:600;">${formatR(w.test_expectancy)}</td>
        <td>${w.test_n}</td>
      </tr>
    `;
  }
  html += `</tbody></table></div>`;
  
  // --- ROBUSTNESS: MONTE CARLO ---
  html += `<div class="section-title">Monte Carlo Simulation</div>`;
  html += `<div class="metrics-grid cols-5">`;
  html += metricCard('Simulations', intNum(mc.simulations).toLocaleString());
  html += metricCard('Median DD', num(mc.median_dd_pct).toFixed(1) + '%', false);
  html += metricCard('p95 DD', num(mc.p95_dd_pct).toFixed(1) + '%', num(mc.p95_dd_pct) < maxMcP95);
  html += metricCard('p99 DD', num(mc.p99_dd_pct).toFixed(1) + '%', num(mc.p99_dd_pct) <= maxMcP99);
  html += metricCard('Median Final R', formatR(mc.median_final_R), true);
  html += `</div>`;
  
  // --- ROBUSTNESS: PARAMETER SENSITIVITY ---
  html += `<div class="section-title">Parameter Sensitivity</div>`;
  html += `<div class="metrics-grid cols-2" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Sensitivity Score', num(ps.sensitivity_score).toFixed(1) + '/100', num(ps.sensitivity_score) < maxSens);
  html += metricCard('Base Expectancy', formatR(ps.base_expectancy), true);
  html += `</div>`;
  
  // Sensitivity rows
  html += `<div class="metric-card">`;
  for (const n of (ps.nudged_results || [])) {
    const changePct = num(n.change_pct);
    const pctColor = Math.abs(changePct) > 15 ? 'var(--color-negative)' : 'var(--color-text-muted)';
    const barWidth = Math.min(Math.abs(changePct), 50);
    const barColor = changePct < 0 ? 'var(--color-negative)' : 'var(--color-positive)';
    const barDir = changePct < 0 ? `right:50%;width:${barWidth}%;` : `left:50%;width:${barWidth}%;`;
    
    html += `
      <div class="sensitivity-row">
        <span style="color:var(--color-text-muted);">${n.param} ${n.direction}</span>
        <span style="text-align:right;">${formatR(n.expectancy)}</span>
        <div class="sensitivity-bar-track">
          <div class="sensitivity-bar-fill" style="${barDir}background:${barColor};"></div>
        </div>
        <span style="color:${pctColor};text-align:right;">${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%</span>
      </div>
    `;
  }
  html += `</div>`;
  
  // --- EXECUTION RULE IMPACT ---
  if (r.execution_stats && r.execution_stats.rules_active) {
    const es = r.execution_stats;
    html += `<div class="section-title">Execution Rule Impact</div>`;
    html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
    html += metricCard('BE Triggers', es.breakeven_triggers);
    html += metricCard('Ladder Locks', es.ladder_lock_triggers);
    html += metricCard('G2R Exits', es.green_to_red_exits);
    html += metricCard('Retrace Exits', es.profit_retrace_exits);
    html += `</div>`;
    html += `<div class="metrics-grid cols-4">`;
    html += metricCard('% Hit BE', formatPct(es.pct_trades_hitting_breakeven), es.pct_trades_hitting_breakeven > 0.5);
    html += metricCard('Avg Giveback', formatR(es.avg_giveback_from_peak_R), es.avg_giveback_from_peak_R < 1.0);
    html += metricCard('Exp. Without Rules', es.expectancy_without_rules_R != null ? formatR(es.expectancy_without_rules_R) : 'N/A', true);
    html += metricCard('Exp. With Rules', es.expectancy_with_rules_R != null ? formatR(es.expectancy_with_rules_R) : 'N/A', true);
    html += `</div>`;

    // Show rule cost/benefit
    if (es.expectancy_without_rules_R != null && es.expectancy_with_rules_R != null) {
      const diff = es.expectancy_with_rules_R - es.expectancy_without_rules_R;
      const pctDiff = ((diff / es.expectancy_without_rules_R) * 100).toFixed(1);
      const costColor = diff < 0 ? 'var(--color-negative)' : 'var(--color-positive)';
      html += `<div style="margin-top:var(--space-8);padding:var(--space-8) var(--space-12);background:var(--color-void);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-caption);color:var(--color-text-muted);">
        Rules ${diff < 0 ? 'cost' : 'add'} <span style="color:${costColor};font-weight:600;font-family:var(--font-mono);">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}R</span> (${pctDiff}%) expectancy -- 
        ${diff < 0 ? 'but reduce drawdown and protect against behavioral risk' : 'and improve risk-adjusted returns'}
      </div>`;
    }
  }

  // --- PASS/FAIL REASONS ---
  html += `<div class="section-title">Validation Criteria</div>`;
  html += renderValidationCriteria(r);

  // --- PASS/FAIL REASONS ---
  html += `<div class="section-title">Pass/Fail Reasons</div>`;
  html += `<ul class="reasons-list">`;
  for (const reason of (r.pass_fail_reasons || [])) {
    html += `<li>${escHtml(reason)}</li>`;
  }
  html += `</ul>`;
  
  // --- SYMBOL LIST (bottom) ---
  if (universe.length > 0) {
    html += `<div class="section-title" style="margin-top:var(--space-16);">Symbols Tested (${universe.length})</div>`;
    html += `<div style="font-size:var(--text-caption);color:var(--color-text-subtle);line-height:1.7;padding:var(--space-8) 0;border-top:1px solid var(--color-border);">`;
    html += escHtml(universe.join(', '));
    html += `</div>`;
  }

  return html;
}

function renderValidationCriteria(report) {
  const ts = report.trades_summary || {};
  const oos = report.robustness?.out_of_sample || {};
  const wf = report.robustness?.walk_forward || {};
  const mc = report.robustness?.monte_carlo || {};
  const ps = report.robustness?.parameter_sensitivity || {};
  const thr = report.config?.validation_thresholds || {};
  const displayVerdict = getDisplayVerdict(report);
  const minTradesPass = intNum(thr.min_trades_pass || 30);
  const maxOosDeg = num(thr.max_oos_degradation_pct || 50);
  const minWfProf = num(thr.min_wf_profitable_windows || 0.6);
  const maxMcP95 = num(thr.max_mc_p95_dd_pct || 30);
  const maxMcP99 = num(thr.max_mc_p99_dd_pct || 50);
  const maxSens = num(thr.max_sensitivity_score || 40);

  const checks = [
    { label: 'Expectancy R', threshold: '> 0', actual: num(ts.expectancy_R), ok: num(ts.expectancy_R) > 0 },
    { label: 'Total Trades', threshold: `>= ${minTradesPass}`, actual: intNum(ts.total_trades), ok: intNum(ts.total_trades) >= minTradesPass },
    { label: 'OOS Expectancy', threshold: '> 0', actual: num(oos.oos_expectancy), ok: num(oos.oos_expectancy) > 0 },
    { label: 'OOS Degradation %', threshold: `< ${maxOosDeg}%`, actual: pctNum(oos.oos_degradation_pct), ok: num(oos.oos_degradation_pct) < maxOosDeg },
    { label: 'WF Profitable Windows %', threshold: `>= ${(minWfProf * 100).toFixed(1)}%`, actual: ratioPct(wf.pct_profitable_windows), ok: num(wf.pct_profitable_windows) >= minWfProf },
    { label: 'Monte Carlo p95 DD %', threshold: `< ${maxMcP95}%`, actual: pctNum(mc.p95_dd_pct), ok: num(mc.p95_dd_pct) < maxMcP95 },
    { label: 'Monte Carlo p99 DD %', threshold: `<= ${maxMcP99}% (hard fail if >${maxMcP99}%)`, actual: pctNum(mc.p99_dd_pct), ok: num(mc.p99_dd_pct) <= maxMcP99 },
    { label: 'Sensitivity Score', threshold: `< ${maxSens}`, actual: num(ps.sensitivity_score), ok: num(ps.sensitivity_score) < maxSens },
  ];

  let html = `<div class="metric-card">`;
  html += `
    <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr .8fr;gap:var(--space-8);font-size:var(--text-caption);color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:.05em;padding-bottom:var(--space-8);border-bottom:1px solid var(--color-border);">
      <div>Criterion</div>
      <div>Threshold</div>
      <div>Actual</div>
      <div>Status</div>
    </div>
  `;

  for (const c of checks) {
    html += `
      <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr .8fr;gap:var(--space-8);font-size:var(--text-small);padding:var(--space-8) 0;border-bottom:1px solid var(--color-border-subtle);">
        <div>${escHtml(c.label)}</div>
        <div class="text-mono">${escHtml(String(c.threshold))}</div>
        <div class="text-mono">${escHtml(String(c.actual))}</div>
        <div><span class="status-badge ${c.ok ? 'approved' : 'rejected'}">${c.ok ? 'pass' : 'fail'}</span></div>
      </div>
    `;
  }

  window.__validationCopyText = checks.map(c => `${c.label}\t${c.threshold}\t${c.actual}\t${c.ok ? 'pass' : 'fail'}`).join('\n') + `\nFinal verdict: ${displayVerdict.replace('_', ' ')}`;

  html += `
    <div style="margin-top:var(--space-10);display:flex;align-items:center;gap:var(--space-12);">
      <div style="font-size:var(--text-caption);color:var(--color-text-subtle);">
        Final verdict: <span class="verdict-badge ${displayVerdict}" style="margin-left:var(--space-6);">${displayVerdict.replace('_', ' ')}</span>
      </div>
      <button id="copy-validation-btn" style="font-size:var(--text-caption);padding:var(--space-4) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);color:var(--color-text-subtle);cursor:pointer;">Copy Report</button>
    </div>
  `;
  html += `</div>`;

  setTimeout(() => {
    const btn = document.getElementById('copy-validation-btn');
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.__validationCopyText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Report', 1500);
      });
    });
  }, 0);

  return html;
}

// =====================
// ACTIONS
// =====================

function runValidation() {
  if (!selectedStrategy) return;
  
  // Populate modal
  document.getElementById('run-strategy-name').textContent = selectedStrategy.name;
  document.getElementById('run-date-start').value = '2020-01-01';
  document.getElementById('run-date-end').value = '2025-12-31';
  const tierEl = document.getElementById('run-validation-tier');
  if (tierEl) {
    tierEl.value = DEFAULT_VALIDATION_TIER;
  }
  const intervalEl = document.getElementById('run-validation-interval');
  if (intervalEl && selectedStrategy?.interval) {
    intervalEl.value = selectedStrategy.interval;
  }
  const acEl = document.getElementById('run-validation-asset-class');
  if (acEl) {
    acEl.value = selectedStrategy?.asset_class || 'stocks';
  }
  updateRunTierDescription();
  
  openModal('run-modal');
}

function renderReportTemplate({ strategy, message }) {
  const name = strategy?.name || 'No strategy selected';
  const strategyVersionId = strategy?.strategy_version_id || 'N/A';
  const interval = strategy?.interval || 'N/A';
  const assetClass = strategy?.asset_class || 'N/A';
  const universe = Array.isArray(strategy?.universe) && strategy.universe.length > 0
    ? strategy.universe.join(', ')
    : 'N/A';

  let html = '';

  html += `
    <div class="metric-card" style="margin-bottom:var(--space-12);padding:var(--space-12) var(--space-14);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);">
        <div>
          <div class="metric-label" style="margin-bottom:var(--space-6);">Validation Report Template</div>
          <div style="font-size:var(--text-small);color:var(--color-text-muted);">${escHtml(message || '')}</div>
        </div>
        <span class="status-badge draft">Template</span>
      </div>
    </div>
  `;

  // Verdict + header metadata block
  html += `
    <div style="display:flex;align-items:center;gap:var(--space-16);margin-bottom:var(--space-16);">
      <span class="verdict-badge NEEDS_REVIEW" style="font-size:var(--text-h3);padding:var(--space-8) var(--space-24);">--</span>
      <div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);">
          Strategy: ${escHtml(name)} &middot; Version: <span class="text-mono">${escHtml(strategyVersionId)}</span>
        </div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:2px;">
          Asset Class: ${escHtml(String(assetClass))} &middot; Interval: ${escHtml(String(interval))}
        </div>
        <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:2px;">
          Universe: ${escHtml(universe)}
        </div>
      </div>
    </div>
  `;

  html += `<div class="section-title">Trade Summary</div>`;
  html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Total Trades', '--');
  html += metricCard('Win Rate', '--');
  html += metricCard('Expectancy', '--');
  html += metricCard('Profit Factor', '--');
  html += metricCard('W / L', '--');
  html += `</div>`;

  html += `<div class="section-title">Risk Summary</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Max DD %', '--');
  html += metricCard('Max DD (R)', '--');
  html += metricCard('Longest Losing', '--');
  html += metricCard('Avg Losing Streak', '--');
  html += `</div>`;

  html += `<div class="section-title">Out-of-Sample</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += metricCard('IS Expectancy', '--');
  html += metricCard('OOS Expectancy', '--');
  html += metricCard('Degradation', '--');
  html += metricCard('Split Date', '--');
  html += `</div>`;

  html += `<div class="section-title">Walk-Forward Analysis</div>`;
  html += `<div class="metrics-grid cols-3" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Windows', '--');
  html += metricCard('Avg Test Expectancy', '--');
  html += metricCard('% Profitable Windows', '--');
  html += `</div>`;

  html += `<div class="section-title">Monte Carlo Simulation</div>`;
  html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Simulations', '--');
  html += metricCard('Median DD', '--');
  html += metricCard('p95 DD', '--');
  html += metricCard('p99 DD', '--');
  html += metricCard('Median Final R', '--');
  html += `</div>`;

  html += `<div class="section-title">Parameter Sensitivity</div>`;
  html += `<div class="metrics-grid cols-2" style="margin-bottom:var(--space-12);">`;
  html += metricCard('Sensitivity Score', '--');
  html += metricCard('Base Expectancy', '--');
  html += `</div>`;

  html += `<div class="section-title">Execution Rule Impact</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += metricCard('BE Triggers', '--');
  html += metricCard('Ladder Locks', '--');
  html += metricCard('G2R Exits', '--');
  html += metricCard('Retrace Exits', '--');
  html += `</div>`;

  html += `<div class="section-title">Validation Criteria</div>`;
  html += `
    <div class="metric-card">
      <div style="font-size:var(--text-small);color:var(--color-text-muted);line-height:var(--leading-body);">
        Criteria table will populate here after a run (expectancy, trade count, OOS, walk-forward, Monte Carlo, sensitivity).
      </div>
    </div>
  `;

  html += `<div class="section-title">Pass/Fail Reasons</div>`;
  html += `
    <div class="metric-card">
      <div style="font-size:var(--text-small);color:var(--color-text-subtle);">No reasons yet.</div>
    </div>
  `;

  html += `<div class="section-title">Decision</div>`;
  html += `
    <div class="decision-panel">
      <span style="color:var(--color-text-subtle);font-size:var(--text-small);">
        Awaiting report generation.
      </span>
    </div>
  `;

  return html;
}

async function submitRunValidation() {
  const dateStart = document.getElementById('run-date-start').value;
  const dateEnd = document.getElementById('run-date-end').value;
  const tierKey = getRunTierKey();
  const context = getTierContext(tierKey);
  if (!context) return;
  if (tierKey === 'tier1b' && !isTier1BEligibleReport(getLatestTierReport('tier1'))) {
    alert('Tier 1B requires a Tier 1 result that looks viable but lacks enough trades.');
    return;
  }
  if (tierKey === 'tier2' && !(strategyHasTierPass('tier1') || strategyHasTierPass('tier1b'))) {
    alert('Tier 2 requires a PASS on Tier 1 or Tier 1B first.');
    return;
  }
  if (tierKey === 'tier3' && !strategyHasTierPass('tier2')) {
    alert('Tier 3 requires a PASS on Tier 2 first.');
    return;
  }
  
  closeModal('run-modal');
  
  try {
    const result = await apiPost('/run', {
      strategy_version_id: selectedStrategy.strategy_version_id,
      date_start: dateStart,
      date_end: dateEnd,
      tier: tierKey,
      interval: document.getElementById('run-validation-interval')?.value || undefined,
      asset_class: document.getElementById('run-validation-asset-class')?.value || undefined,
    });

    activeRunJobId = result.job_id;
    const runAssetClass = normalizeAssetClassKey(result.asset_class || context.assetClass);
    const runSymbolCount = Number(result.symbol_count || context.symbols.length || 0);
    setRunStatus(`Running ${context.tierLabel} (${runAssetClass}, ${runSymbolCount} symbols) (${activeRunJobId})...`, '', 8);
    await pollRunJob(activeRunJobId);
  } catch (err) {
    setRunStatus('');
    alert('Validation failed: ' + err.message);
  }
}

async function cancelValidationRun() {
  if (!activeRunJobId) return;
  const jobId = activeRunJobId;
  try {
    await apiPostAbsolute(`/api/validator/run/${jobId}/cancel`, {});
  } catch (err) {
    console.warn('Cancel request failed:', err);
  }
  // The poll loop will pick up the 'failed' status with 'Cancelled by user' and clean up.
  // But let's also immediately update the UI for responsiveness.
  if (runPollTimer) {
    clearInterval(runPollTimer);
    runPollTimer = null;
  }
  activeRunJobId = null;
  setRunStatus('');
}

async function reconnectActiveRun(targetJobId = null, targetStrategyVersionId = null) {
  try {
    const activeJobs = await apiGetAbsolute('/api/validator/runs/active');
    if (!Array.isArray(activeJobs) || activeJobs.length === 0) return;
    const requestedJobId = String(targetJobId || '').trim();
    const requestedStrategyVersionId = String(targetStrategyVersionId || '').trim();
    let job =
      (requestedJobId ? activeJobs.find((candidate) => candidate?.job_id === requestedJobId) : null) ||
      (requestedStrategyVersionId
        ? activeJobs.find((candidate) => candidate?.strategy_version_id === requestedStrategyVersionId)
        : null) ||
      activeJobs[0];
    if (!job) return;
    if (requestedStrategyVersionId && job.strategy_version_id && selectedStrategy?.strategy_version_id !== job.strategy_version_id) {
      await selectStrategy(job.strategy_version_id);
    }
    activeRunJobId = job.job_id;
    const pct = Math.round((Number(job.progress || 0)) * 100);
    const stage = job.stage ? job.stage.replaceAll('_', ' ') : '';
    const detail = job.detail || '';
    const timing = formatRunTiming(job);
    let statusParts = ['Reconnected'];
    if (stage) statusParts.push(stage);
    if (detail) statusParts.push(detail);
    if (timing) statusParts.push(timing.trim());
    setRunStatus(statusParts.join(' -- '), job.warning || '', pct);
    // Resume polling -- wrap in a no-op promise since pollRunJob expects to resolve/reject
    pollRunJob(job.job_id).then(() => {
      // completed -- reports will refresh
    }).catch((err) => {
      console.warn('Reconnected run failed:', err);
    });
  } catch (err) {
    // No active runs or endpoint not available -- that's fine
  }
}

function initValidatorChat() {
  if (validatorChatMessages.length === 0) {
    validatorChatMessages.push({
      sender: 'ai',
      text: 'Welcome. Select a strategy and report, then ask why it failed or what to change.\nI will use the validator metrics and pass/fail reasons to give concrete edits.'
    });
  }
  renderValidatorChat();
}

function renderValidatorChat() {
  const container = document.getElementById('validator-chat-messages');
  if (!container) return;
  container.innerHTML = validatorChatMessages.map((m) => {
    if (m.type === 'thought') {
      return `<div class="validator-chat-thought">${escHtml(m.text)}</div>`;
    }
    if (m.type === 'activity') {
      const cards = (m.cards || []).map((c) => `
        <div class="validator-activity-item">
          <div class="validator-activity-title">${escHtml(c.title || '')}</div>
          <div class="validator-activity-sub">${escHtml(c.sub || '')}</div>
        </div>
      `).join('');
      return `<div class="validator-chat-activity">${cards}</div>`;
    }
    return `<div class="validator-chat-bubble ${m.sender}">${escHtml(m.text)}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function summarizeValidatorReport(report) {
  if (!report || typeof report !== 'object') return null;
  const cfg = report.config || {};
  const ts = report.trades_summary || {};
  const rs = report.risk_summary || {};
  const rob = report.robustness || {};
  const oos = rob.out_of_sample || {};
  const wf = rob.walk_forward || {};
  const mc = rob.monte_carlo || {};
  const ps = rob.parameter_sensitivity || {};
  const universe = Array.isArray(cfg.universe) ? cfg.universe : [];
  return {
    report_id: report.report_id || null,
    created_at: report.created_at || null,
    pass_fail: report.pass_fail || null,
    validation_tier: cfg.validation_tier || null,
    asset_class: cfg.asset_class || null,
    interval: Array.isArray(cfg.timeframes) ? (cfg.timeframes[0] || null) : null,
    date_start: cfg.date_start || null,
    date_end: cfg.date_end || null,
    universe_size: universe.length,
    costs: cfg.costs || null,
    pass_fail_reasons: Array.isArray(report.pass_fail_reasons) ? report.pass_fail_reasons.slice() : [],
    trades_summary: {
      total_trades: ts.total_trades ?? null,
      expectancy_R: ts.expectancy_R ?? null,
      profit_factor: ts.profit_factor ?? null,
      win_rate: ts.win_rate ?? null,
      avg_win_R: ts.avg_win_R ?? null,
      avg_loss_R: ts.avg_loss_R ?? null,
      winners: ts.winners ?? null,
      losers: ts.losers ?? null,
    },
    risk_summary: {
      max_drawdown_pct: rs.max_drawdown_pct ?? null,
      max_drawdown_R: rs.max_drawdown_R ?? null,
      sharpe_ratio: rs.sharpe_ratio ?? null,
      calmar_ratio: rs.calmar_ratio ?? null,
      longest_losing_streak: rs.longest_losing_streak ?? null,
    },
    robustness: {
      out_of_sample: {
        is_expectancy: oos.is_expectancy ?? null,
        oos_expectancy: oos.oos_expectancy ?? null,
        oos_degradation_pct: oos.oos_degradation_pct ?? null,
        split_date: oos.split_date ?? null,
      },
      walk_forward: {
        pct_profitable_windows: wf.pct_profitable_windows ?? null,
        avg_test_expectancy: wf.avg_test_expectancy ?? null,
        windows: Array.isArray(wf.windows) ? wf.windows.length : 0,
      },
      monte_carlo: {
        p95_dd_pct: mc.p95_dd_pct ?? null,
        p99_dd_pct: mc.p99_dd_pct ?? null,
        median_final_R: mc.median_final_R ?? null,
      },
      parameter_sensitivity: {
        sensitivity_score: ps.sensitivity_score ?? null,
        base_expectancy: ps.base_expectancy ?? null,
      }
    },
    execution_stats: report.execution_stats || null,
  };
}

function buildValidatorReportHistory(selected, allReports) {
  const normalized = Array.isArray(allReports)
    ? allReports.map((r) => summarizeValidatorReport(r)).filter(Boolean)
    : [];
  if (!normalized.length) {
    return { selected: null, previous: null, recent: [], comparison_pairs: [] };
  }

  normalized.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const selectedId = selected?.report_id || null;
  const selectedSummary = normalized.find((r) => r.report_id === selectedId) || normalized[0];
  const selectedIndex = normalized.findIndex((r) => r.report_id === selectedSummary?.report_id);
  const previous = selectedIndex >= 0 ? (normalized[selectedIndex + 1] || null) : null;
  const recent = normalized.slice(0, 6);
  const comparisonPairs = [];

  if (selectedSummary && previous) {
    comparisonPairs.push({
      kind: 'selected_vs_previous',
      current_report_id: selectedSummary.report_id,
      previous_report_id: previous.report_id,
      deltas: {
        expectancy_R: (
          selectedSummary.trades_summary.expectancy_R != null &&
          previous.trades_summary.expectancy_R != null
        ) ? (selectedSummary.trades_summary.expectancy_R - previous.trades_summary.expectancy_R) : null,
        total_trades: (
          selectedSummary.trades_summary.total_trades != null &&
          previous.trades_summary.total_trades != null
        ) ? (selectedSummary.trades_summary.total_trades - previous.trades_summary.total_trades) : null,
        profit_factor: (
          selectedSummary.trades_summary.profit_factor != null &&
          previous.trades_summary.profit_factor != null
        ) ? (selectedSummary.trades_summary.profit_factor - previous.trades_summary.profit_factor) : null,
        win_rate: (
          selectedSummary.trades_summary.win_rate != null &&
          previous.trades_summary.win_rate != null
        ) ? (selectedSummary.trades_summary.win_rate - previous.trades_summary.win_rate) : null,
        max_drawdown_pct: (
          selectedSummary.risk_summary.max_drawdown_pct != null &&
          previous.risk_summary.max_drawdown_pct != null
        ) ? (selectedSummary.risk_summary.max_drawdown_pct - previous.risk_summary.max_drawdown_pct) : null,
        avg_win_R: (
          selectedSummary.trades_summary.avg_win_R != null &&
          previous.trades_summary.avg_win_R != null
        ) ? (selectedSummary.trades_summary.avg_win_R - previous.trades_summary.avg_win_R) : null,
        avg_loss_R: (
          selectedSummary.trades_summary.avg_loss_R != null &&
          previous.trades_summary.avg_loss_R != null
        ) ? (selectedSummary.trades_summary.avg_loss_R - previous.trades_summary.avg_loss_R) : null,
      }
    });
  }

  return {
    selected: selectedSummary || null,
    previous,
    recent,
    comparison_pairs: comparisonPairs,
  };
}

function buildValidatorChatContext(comparisonDiagnostics = null) {
  const report = selectedReport || null;
  const strategy = selectedStrategy || null;
  const reportHistory = buildValidatorReportHistory(report, reports);
  const verdictMap = {
    PASS: 'GO',
    FAIL: 'NO_GO',
    NEEDS_REVIEW: 'WAIT'
  };

  const summaryLines = [];
  if (report) {
    const ts = report.trades_summary || {};
    const rs = report.risk_summary || {};
    const oos = report.robustness?.out_of_sample || {};
    const wf = report.robustness?.walk_forward || {};
    const mc = report.robustness?.monte_carlo || {};
    summaryLines.push(`Validator verdict: ${report.pass_fail}`);
    summaryLines.push(`Reasons: ${(report.pass_fail_reasons || []).join(' | ') || 'N/A'}`);
    summaryLines.push(`Expectancy_R=${ts.expectancy_R ?? 'N/A'}, total_trades=${ts.total_trades ?? 'N/A'}, win_rate=${ts.win_rate ?? 'N/A'}`);
    summaryLines.push(`MaxDD%=${rs.max_drawdown_pct ?? 'N/A'}, MaxDD_R=${rs.max_drawdown_R ?? 'N/A'}`);
    summaryLines.push(`OOS expectancy=${oos.oos_expectancy ?? 'N/A'}, degradation%=${oos.oos_degradation_pct ?? 'N/A'}`);
    summaryLines.push(`WF profitable windows%=${wf.pct_profitable_windows ?? 'N/A'}, avg_test_expectancy=${wf.avg_test_expectancy ?? 'N/A'}`);
    summaryLines.push(`MC p95DD%=${mc.p95_dd_pct ?? 'N/A'}, p99DD%=${mc.p99_dd_pct ?? 'N/A'}`);
  }

  return {
    symbol: report?.config?.universe?.[0] || strategy?.universe?.[0] || '',
    patternType: strategy?.setup_config?.pattern_type || strategy?.scan_mode || 'strategy',
    tradeDirection: (strategy?.trade_direction || 'LONG').toUpperCase(),
    copilotAnalysis: {
      validator: true,
      verdict: report ? (verdictMap[report.pass_fail] || 'WAIT') : 'WAIT',
      pass_fail: report?.pass_fail || null,
      commentary: summaryLines.join('\n'),
      goReasons: report?.pass_fail_reasons || [],
      nogoReasons: report?.pass_fail_reasons || [],
      strategy: strategy ? {
        strategy_id: strategy.strategy_id,
        strategy_version_id: strategy.strategy_version_id,
        status: strategy.status,
        asset_class: strategy.asset_class || null,
        interval: strategy.interval,
        risk_config: strategy.risk_config || null,
        setup_config: strategy.setup_config || null
      } : null,
      report: report ? {
        report_id: report.report_id,
        pass_fail: report.pass_fail,
        validation_tier: report.config?.validation_tier || null,
        pass_fail_reasons: report.pass_fail_reasons || [],
        trades_summary: report.trades_summary,
        risk_summary: report.risk_summary,
        robustness: report.robustness,
        robustness_summary: report.robustness || null,
        execution_stats: report.execution_stats || null
      } : null,
      report_history: reportHistory,
      report_comparison_diagnostics: comparisonDiagnostics,
    }
  };
}

async function fetchValidatorComparisonDiagnostics(currentReportId, previousReportId) {
  if (!currentReportId || !previousReportId) return null;
  try {
    return await apiGetAbsolute(`/api/validator/report/${encodeURIComponent(currentReportId)}/compare/${encodeURIComponent(previousReportId)}/diagnostics`);
  } catch (err) {
    console.warn('Failed to load validator comparison diagnostics:', err);
    return null;
  }
}

async function sendValidatorChat(prefill) {
  const input = document.getElementById('validator-chat-input');
  const raw = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  let message = (raw || '').trim();
  if (!message) return;

  if (input && typeof prefill !== 'string') {
    input.value = '';
    autoResizeValidatorChatInput();
  }

  validatorChatMessages.push({ sender: 'user', text: message });
  const startedAt = Date.now();
  setValidatorChatStatus('Thinking');
  validatorChatMessages.push({
    type: 'activity',
    cards: [
      {
        title: 'Explore validator report + criteria',
        sub: `Reading verdict/reasons for ${selectedReport?.report_id || 'selected context'}`
      },
      {
        title: 'Explore strategy config',
        sub: `Inspecting ${selectedStrategy?.strategy_version_id || 'strategy'} risk/setup parameters`
      },
      {
        title: 'Generate recommendations',
        sub: 'Mapping failing criteria to concrete edits'
      }
    ]
  });
  renderValidatorChat();

  try {
    if (selectedReport) {
      const ts = selectedReport.trades_summary || {};
      const rs = selectedReport.risk_summary || {};
      const oos = selectedReport.robustness?.out_of_sample || {};
      const wf = selectedReport.robustness?.walk_forward || {};
      const mc = selectedReport.robustness?.monte_carlo || {};
      const reasons = (selectedReport.pass_fail_reasons || []).join(' | ') || 'N/A';
      message = `${message}

VALIDATOR_FACTS:
- report_id: ${selectedReport.report_id}
- pass_fail: ${selectedReport.pass_fail}
- reasons: ${reasons}
- expectancy_R: ${ts.expectancy_R ?? 'N/A'}
- total_trades: ${ts.total_trades ?? 'N/A'}
- win_rate: ${ts.win_rate ?? 'N/A'}
- max_drawdown_pct: ${rs.max_drawdown_pct ?? 'N/A'}
- max_drawdown_R: ${rs.max_drawdown_R ?? 'N/A'}
- oos_expectancy: ${oos.oos_expectancy ?? 'N/A'}
- oos_degradation_pct: ${oos.oos_degradation_pct ?? 'N/A'}
- wf_pct_profitable_windows: ${wf.pct_profitable_windows ?? 'N/A'}
- wf_avg_test_expectancy: ${wf.avg_test_expectancy ?? 'N/A'}
- mc_p95_dd_pct: ${mc.p95_dd_pct ?? 'N/A'}
- mc_p99_dd_pct: ${mc.p99_dd_pct ?? 'N/A'}
`;
    }

    const reportHistory = buildValidatorReportHistory(selectedReport, reports);
    if (reportHistory?.selected) {
      const selectedSummary = reportHistory.selected;
      const previousSummary = reportHistory.previous;
      message = `${message}

REPORT_HISTORY:
- loaded_reports: ${Array.isArray(reportHistory.recent) ? reportHistory.recent.length : 0}
- selected_report_id: ${selectedSummary.report_id || 'N/A'}
- selected_expectancy_R: ${selectedSummary.trades_summary?.expectancy_R ?? 'N/A'}
- selected_total_trades: ${selectedSummary.trades_summary?.total_trades ?? 'N/A'}
- selected_profit_factor: ${selectedSummary.trades_summary?.profit_factor ?? 'N/A'}
- selected_win_rate: ${selectedSummary.trades_summary?.win_rate ?? 'N/A'}
- selected_avg_win_R: ${selectedSummary.trades_summary?.avg_win_R ?? 'N/A'}
- selected_avg_loss_R: ${selectedSummary.trades_summary?.avg_loss_R ?? 'N/A'}
- selected_universe_size: ${selectedSummary.universe_size ?? 'N/A'}
- selected_tier: ${selectedSummary.validation_tier || 'N/A'}
- selected_date_range: ${selectedSummary.date_start || 'N/A'} -> ${selectedSummary.date_end || 'N/A'}
${previousSummary ? `- previous_report_id: ${previousSummary.report_id || 'N/A'}
- previous_expectancy_R: ${previousSummary.trades_summary?.expectancy_R ?? 'N/A'}
- previous_total_trades: ${previousSummary.trades_summary?.total_trades ?? 'N/A'}
- previous_profit_factor: ${previousSummary.trades_summary?.profit_factor ?? 'N/A'}
- previous_win_rate: ${previousSummary.trades_summary?.win_rate ?? 'N/A'}
- previous_avg_win_R: ${previousSummary.trades_summary?.avg_win_R ?? 'N/A'}
- previous_avg_loss_R: ${previousSummary.trades_summary?.avg_loss_R ?? 'N/A'}
- previous_universe_size: ${previousSummary.universe_size ?? 'N/A'}
- previous_tier: ${previousSummary.validation_tier || 'N/A'}
- previous_date_range: ${previousSummary.date_start || 'N/A'} -> ${previousSummary.date_end || 'N/A'}` : '- previous_report_id: N/A'}
${Array.isArray(reportHistory.comparison_pairs) && reportHistory.comparison_pairs[0] ? `- delta_expectancy_R: ${reportHistory.comparison_pairs[0].deltas.expectancy_R ?? 'N/A'}
- delta_total_trades: ${reportHistory.comparison_pairs[0].deltas.total_trades ?? 'N/A'}
- delta_profit_factor: ${reportHistory.comparison_pairs[0].deltas.profit_factor ?? 'N/A'}
- delta_win_rate: ${reportHistory.comparison_pairs[0].deltas.win_rate ?? 'N/A'}
- delta_avg_win_R: ${reportHistory.comparison_pairs[0].deltas.avg_win_R ?? 'N/A'}
- delta_avg_loss_R: ${reportHistory.comparison_pairs[0].deltas.avg_loss_R ?? 'N/A'}
- delta_max_drawdown_pct: ${reportHistory.comparison_pairs[0].deltas.max_drawdown_pct ?? 'N/A'}` : ''}
`;
    }

    let comparisonDiagnostics = null;
    if (reportHistory?.selected?.report_id && reportHistory?.previous?.report_id) {
      comparisonDiagnostics = await fetchValidatorComparisonDiagnostics(reportHistory.selected.report_id, reportHistory.previous.report_id);
      if (comparisonDiagnostics) {
        const currentShared = comparisonDiagnostics.cohort_stats?.current_shared_symbol_trades || {};
        const previousShared = comparisonDiagnostics.cohort_stats?.previous_shared_symbol_trades || {};
        const currentAdded = comparisonDiagnostics.cohort_stats?.current_added_symbol_trades || {};
        const takeaways = Array.isArray(comparisonDiagnostics.key_takeaways) ? comparisonDiagnostics.key_takeaways : [];
        message = `${message}

COMPARISON_DIAGNOSTICS:
- current_universe_size: ${comparisonDiagnostics.universe_summary?.current_universe_size ?? 'N/A'}
- previous_universe_size: ${comparisonDiagnostics.universe_summary?.previous_universe_size ?? 'N/A'}
- shared_universe_size: ${comparisonDiagnostics.universe_summary?.shared_universe_size ?? 'N/A'}
- added_universe_size: ${comparisonDiagnostics.universe_summary?.added_universe_size ?? 'N/A'}
- current_shared_trade_count: ${currentShared.trade_count ?? 'N/A'}
- current_shared_expectancy_R: ${currentShared.expectancy_R ?? 'N/A'}
- previous_shared_trade_count: ${previousShared.trade_count ?? 'N/A'}
- previous_shared_expectancy_R: ${previousShared.expectancy_R ?? 'N/A'}
- current_added_trade_count: ${currentAdded.trade_count ?? 'N/A'}
- current_added_expectancy_R: ${currentAdded.expectancy_R ?? 'N/A'}
${takeaways.length ? `- key_takeaways: ${takeaways.join(' | ')}` : ''}`;
      }
    }

    let _settings = {};
    try { _settings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}
    const res = await apiPostAbsolute('/api/vision/chat', {
      message,
      context: buildValidatorChatContext(comparisonDiagnostics),
      role: 'statistical_interpreter',
      aiModel: _settings.validatorAnalystModel || undefined,
    });
    validatorChatMessages.pop(); // remove activity block
    const sec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    validatorChatMessages.push({ type: 'thought', text: `Thought for ${sec}s` });
    validatorChatMessages.push({ sender: 'ai', text: res.response || 'No response.' });
    setValidatorChatStatus('Ready');
  } catch (err) {
    validatorChatMessages.pop(); // remove activity block
    validatorChatMessages.push({ sender: 'ai', text: `Chat failed: ${err.message}` });
    setValidatorChatStatus('Error');
  }
  renderValidatorChat();
}

function setValidatorChatStatus(text) {
  const el = document.getElementById('validator-chat-status');
  if (!el) return;
  el.textContent = text || 'Ready';
}

function autoResizeValidatorChatInput() {
  const input = document.getElementById('validator-chat-input');
  if (!input) return;
  input.style.height = '82px';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function handleValidatorChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendValidatorChat();
  }
}

function askWhyFailed() {
  if (!selectedReport) {
    sendValidatorChat('No report selected yet. Tell me what data I need to run first and why.');
    return;
  }
  sendValidatorChat('Explain exactly why this validator report failed. Prioritize the top 3 root causes and cite the specific metrics/reasons from this report.');
}

function askHowToImprove() {
  if (!selectedStrategy) {
    sendValidatorChat('No strategy selected. Tell me how to structure a strong first draft strategy for this system.');
    return;
  }
  sendValidatorChat('Given this strategy and latest report, propose a concrete improvement plan with changes to setup/risk/execution and expected trade-offs.');
}

function askParamChanges() {
  sendValidatorChat('Recommend parameter changes with specific numeric values I should test next, and explain why each change should improve robustness or pass/fail outcomes.');
}

function setRunStatus(message, warning = '', progressPct = null) {
  const btnRun = document.getElementById('btn-run');
  const info = document.getElementById('selected-strategy-info');
  const progressWrap = document.getElementById('validator-run-progress');
  const progressFill = document.getElementById('validator-run-progress-fill');
  const progressText = document.getElementById('validator-run-progress-pct');
  const progressStage = document.getElementById('validator-run-progress-stage');
  const warningEl = document.getElementById('validator-run-warning');
  const btnCancel = document.getElementById('btn-cancel-run');

  if (btnRun) {
    btnRun.disabled = !!message || !selectedStrategy;
    btnRun.textContent = message ? 'Running...' : 'Run Validation';
  }

  if (btnCancel) {
    btnCancel.style.display = message ? 'inline-block' : 'none';
  }

  if (progressWrap && progressFill && progressText && progressStage && warningEl) {
    if (message) {
      const pct = Math.max(0, Math.min(100, Number(progressPct ?? 10)));
      progressWrap.classList.add('active');
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${Math.round(pct)}%`;
      progressStage.textContent = message;
      warningEl.textContent = warning || '';
    } else {
      progressWrap.classList.remove('active');
      progressFill.style.width = '0%';
      progressText.textContent = '0%';
      progressStage.textContent = 'Waiting';
      warningEl.textContent = '';
    }
  }

  if (info && selectedStrategy) {
    const tierBadges = getStrategyTierBadges(selectedStrategy);
    // Keep strategy header clean; run state is shown in the dedicated progress block.
    info.innerHTML = `
      <span style="font-weight:600;font-size:var(--text-body);">${escHtml(selectedStrategy.name)}</span>
      <span class="status-badge ${selectedStrategy.status}">${selectedStrategy.status}</span>
      ${tierBadges.map((badge) => `<span class="tier-badge" title="${escHtml(badge.title)}">${escHtml(badge.label)}</span>`).join('')}
    `;
  } else if (!message) {
    updateStrategyInfo();
  }
}

function formatRunTiming(job) {
  const elapsed = Number(job?.elapsed_sec || 0);
  const etaDisplay = job?.eta_display || '';
  if (etaDisplay) {
    return ` (${formatElapsed(elapsed)} elapsed -- ${etaDisplay})`;
  }
  const etaSec = Number(job?.eta_seconds || 0);
  if (etaSec > 0) {
    return ` (${formatElapsed(elapsed)} elapsed -- ~${formatElapsed(etaSec)} remaining)`;
  }
  return elapsed > 0 ? ` (${formatElapsed(elapsed)} elapsed)` : '';
}

function formatElapsed(totalSec) {
  const sec = Math.round(totalSec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

async function pollRunJob(jobId) {
  if (runPollTimer) {
    clearInterval(runPollTimer);
    runPollTimer = null;
  }

  let consecutiveErrors = 0;
  let lastKnownPct = 10;
  let pollInterval = 2000;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/run/${encodeURIComponent(jobId)}`);
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          const error = payload?.error || `HTTP ${res.status}`;
          if (res.status === 404) {
            clearInterval(runPollTimer);
            runPollTimer = null;
            activeRunJobId = null;
            setRunStatus('');
            reject(new Error(`Validation run ${jobId} no longer exists on the backend. If the server was restarted, rerun validation.`));
            return;
          }
          throw new Error(error);
        }
        const job = payload.data;
        consecutiveErrors = 0;
        // Recover to normal poll speed after errors
        if (pollInterval !== 2000) {
          pollInterval = 2000;
          clearInterval(runPollTimer);
          runPollTimer = setInterval(tick, pollInterval);
        }

        if (job.status === 'queued') {
          lastKnownPct = Math.round((Number(job.progress || 0)) * 100);
          setRunStatus(`Queued (${job.job_id})${formatRunTiming(job)}`, job.warning || '', lastKnownPct);
          return;
        }
        if (job.status === 'running') {
          lastKnownPct = Math.round((Number(job.progress || 0)) * 100);
          const stage = job.stage ? job.stage.replaceAll('_', ' ') : '';
          const detail = job.detail || '';
          const timing = formatRunTiming(job);
          let statusParts = ['Running'];
          if (stage) statusParts.push(stage);
          if (detail) statusParts.push(detail);
          if (timing) statusParts.push(timing.trim());
          setRunStatus(statusParts.join(' -- '), job.warning || '', lastKnownPct);
          return;
        }
        if (job.status === 'failed') {
          clearInterval(runPollTimer);
          runPollTimer = null;
          activeRunJobId = null;
          setRunStatus('');
          reject(new Error(job.error || 'Validation job failed'));
          return;
        }
        if (job.status === 'completed') {
          clearInterval(runPollTimer);
          runPollTimer = null;

          await loadStrategies();
          reports = await apiGet(`/reports?strategy_version_id=${selectedStrategy.strategy_version_id}`);
          selectedReport = reports.find(r => r.report_id === job.report_id) || reports[0] || null;
          syncStrategyValidationFromReports(selectedStrategy?.strategy_version_id, reports);

          setRunStatus('');
          renderReportContent();
          updateStrategyInfo();
          renderStrategyList();
          resolve(job);
        }
      } catch (err) {
        consecutiveErrors++;
        let runStillActive = true;
        try {
          const activeJobs = await apiGetAbsolute('/api/validator/runs/active');
          if (Array.isArray(activeJobs)) {
            runStillActive = activeJobs.some((job) => job?.job_id === jobId);
          }
        } catch {
          // Ignore fallback probe failures and keep the current retry path.
        }
        if (!runStillActive) {
          clearInterval(runPollTimer);
          runPollTimer = null;
          activeRunJobId = null;
          setRunStatus('');
          reject(new Error(`Validation run ${jobId} is no longer active on the backend. If the server was restarted, rerun validation.`));
          return;
        }
        // Never stop polling — just slow down and keep the bar visible.
        // The job is still running on the backend; this is a transient network issue.
        const backoffSecs = Math.min(30, 2 * consecutiveErrors);
        const newInterval = backoffSecs * 1000;
        if (newInterval !== pollInterval) {
          pollInterval = newInterval;
          clearInterval(runPollTimer);
          runPollTimer = setInterval(tick, pollInterval);
        }
        setRunStatus(
          `Connection interrupted — retrying in ${backoffSecs}s (attempt ${consecutiveErrors})...`,
          'Job is still running on the server.',
          lastKnownPct  // keep last known progress visible
        );
      }
    };

    runPollTimer = setInterval(tick, pollInterval);
  });
}
async function clearReports() {
  if (!selectedStrategy) return;

  const ok = window.confirm(`Delete all validation reports for ${selectedStrategy.name}? This cannot be undone.`);
  if (!ok) return;

  try {
    await apiPost('/reports/clear', { strategy_version_id: selectedStrategy.strategy_version_id });
    reports = [];
    selectedReport = null;
    syncStrategyValidationFromReports(selectedStrategy.strategy_version_id, reports);
    renderReportContent();
    updateStrategyInfo();
    renderStrategyList();
    alert('Reports cleared. Run validation again to generate fresh real data.');
  } catch (err) {
    alert('Failed to clear reports: ' + err.message);
  }
}

async function deleteReport(reportId) {
  if (!reportId) return;
  const ok = window.confirm('Delete this report? This cannot be undone.');
  if (!ok) return;

  try {
    const resp = await fetch(`/api/validator/report/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Delete failed');
    reports = reports.filter(r => r.report_id !== reportId);
    selectedReport = reports[0] || null;
    syncStrategyValidationFromReports(selectedStrategy?.strategy_version_id, reports);
    renderReportContent();
    updateStrategyInfo();
    renderStrategyList();
  } catch (err) {
    alert('Failed to delete report: ' + err.message);
  }
}

async function tombstoneSelectedStrategy() {
  if (!selectedStrategy?.strategy_version_id) return;
  if (String(selectedStrategy.status || '').toLowerCase() === 'rejected') {
    alert('This strategy is already tombstoned.');
    return;
  }

  const strategyVersionId = selectedStrategy.strategy_version_id;
  const strategyName = selectedStrategy.name || strategyVersionId;
  const ok = window.confirm(`Tombstone ${strategyName}? This will mark the strategy as rejected and move it to the tombstones page.`);
  if (!ok) return;

  try {
    await apiPatchAbsolute(`/api/strategies/${encodeURIComponent(strategyVersionId)}/status`, { status: 'rejected' });
    await loadStrategies();
    selectedStrategy = strategies.find((s) => s.strategy_version_id === strategyVersionId) || null;
    if (selectedStrategy?.strategy_version_id) {
      reports = await apiGet(`/reports?strategy_version_id=${selectedStrategy.strategy_version_id}`);
      selectedReport = reports.find((r) => r.report_id === selectedReport?.report_id) || reports[0] || null;
      syncStrategyValidationFromReports(selectedStrategy.strategy_version_id, reports);
    } else {
      reports = [];
      selectedReport = null;
      activeTierConfig = null;
    }
    renderStrategyList();
    updateStrategyInfo();
    renderReportContent();
    alert(`Tombstoned ${strategyName}.`);
  } catch (err) {
    alert('Failed to tombstone strategy: ' + err.message);
  }
}

function openStrategyPage() {
  if (selectedStrategy?.strategy_version_id) {
    const id = encodeURIComponent(selectedStrategy.strategy_version_id);
    window.location.href = `strategy.html?strategy_version_id=${id}`;
    return;
  }
  window.location.href = 'strategy.html';
}

function openSymbolLibraryPage() {
  const assetClass = normalizeAssetClassKey(activeTierConfig?.asset_class || selectedStrategy?.asset_class || 'stocks');
  window.location.href = `validator-symbol-library.html?asset_class=${encodeURIComponent(assetClass)}`;
}

function defaultStrategyDraft() {
  const now = new Date().toISOString();
  return {
    strategy_id: 'new_strategy',
    version: 1,
    strategy_version_id: '',
    status: 'draft',
    asset_class: 'stocks',
    name: 'New Strategy',
    description: '',
    scan_mode: 'wyckoff',
    trade_direction: 'long',
    interval: '1wk',
    universe: ['SPY', 'QQQ', 'IWM'],
    structure_config: {
      swing_method: 'major',
      swing_epsilon_pct: 0.05,
      swing_left_bars: 5,
      swing_right_bars: 5,
      swing_first_peak_decline: 0.5,
      swing_subsequent_decline: 0.25,
      base_min_duration: 8,
      base_max_duration: 80,
      base_max_range_pct: 0.3,
      base_volatility_threshold: 0.08,
      causal: false
    },
    setup_config: {
      pattern_type: 'wyckoff_accumulation',
      min_markdown_pct: 0.5,
      pullback_retracement_min: 0.5,
      pullback_retracement_max: 0.88
    },
    entry_config: { trigger: 'second_breakout', confirmation_bars: 1, enter_next_open: true },
    risk_config: { stop_type: 'fixed_pct', stop_value: 0.08, take_profit_R: 2.0, max_hold_bars: 30 },
    exit_config: { target_type: 'R_multiple', target_level: 2.0, time_stop_bars: 30, trailing: null },
    cost_config: { commission_per_trade: 1.0, slippage_pct: 0.05 },
    execution_config: { production_lock: true },
    created_at: now,
    updated_at: now
  };
}

function openStrategyEditor(mode = 'new') {
  strategyEditorMode = mode;
  const title = document.getElementById('strategy-modal-title');
  const applyStatusBtn = document.getElementById('sb-apply-status-btn');
  title.textContent = mode === 'edit' ? 'Edit Strategy (Save as New Version)' : 'New Strategy Builder';
  if (applyStatusBtn) {
    applyStatusBtn.style.display = mode === 'edit' && selectedStrategy ? 'inline-flex' : 'none';
  }

  const strategy = mode === 'edit' && selectedStrategy
    ? JSON.parse(JSON.stringify(selectedStrategy))
    : defaultStrategyDraft();

  document.getElementById('sb-prompt').value = '';
  document.getElementById('sb-name').value = strategy.name || '';
  document.getElementById('sb-strategy-id').value = strategy.strategy_id || '';
  document.getElementById('sb-status').value = strategy.status || 'draft';
  document.getElementById('sb-asset-class').value = String(strategy.asset_class || 'stocks').toLowerCase();
  document.getElementById('sb-interval').value = strategy.interval || '1wk';
  document.getElementById('sb-description').value = strategy.description || '';
  document.getElementById('sb-stop-value').value = strategy.risk_config?.stop_value ?? 0.08;
  document.getElementById('sb-tp-r').value = strategy.risk_config?.take_profit_R ?? 2;
  document.getElementById('sb-max-hold').value = strategy.risk_config?.max_hold_bars ?? 30;
  document.getElementById('sb-universe').value = (strategy.universe || []).join(', ');
  document.getElementById('sb-json').value = JSON.stringify(strategy, null, 2);
  setStrategyEditorStatus('Ready. Edit fields or JSON, then save as new version.');

  openModal('strategy-modal');
}

async function generateDraftFromPrompt() {
  const prompt = document.getElementById('sb-prompt').value.trim();
  if (!prompt) {
    alert('Enter a prompt first.');
    return;
  }
  try {
    const draft = await apiPostAbsolute('/api/strategies/generate-draft', { prompt });
    document.getElementById('sb-json').value = JSON.stringify(draft, null, 2);
    syncFromJsonToForm();
    setStrategyEditorStatus('Draft generated from prompt. Review and save as new version.', false);
  } catch (err) {
    setStrategyEditorStatus(`Draft generation failed: ${err.message}`, true);
    alert('Draft generation failed: ' + err.message);
  }
}

function syncFromFormToJson() {
  let base = {};
  try {
    base = JSON.parse(document.getElementById('sb-json').value || '{}');
  } catch {}

  const universe = document.getElementById('sb-universe').value
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const merged = {
    ...base,
    name: document.getElementById('sb-name').value.trim(),
    strategy_id: document.getElementById('sb-strategy-id').value.trim(),
    status: document.getElementById('sb-status').value,
    asset_class: String(document.getElementById('sb-asset-class').value || '').trim().toLowerCase() || undefined,
    interval: document.getElementById('sb-interval').value.trim() || '1wk',
    description: document.getElementById('sb-description').value.trim(),
    universe,
    risk_config: {
      ...(base.risk_config || {}),
      stop_type: (base.risk_config && base.risk_config.stop_type) || 'fixed_pct',
      stop_value: Number(document.getElementById('sb-stop-value').value || 0.08),
      take_profit_R: Number(document.getElementById('sb-tp-r').value || 2.0),
      max_hold_bars: Number(document.getElementById('sb-max-hold').value || 30)
    }
  };

  document.getElementById('sb-json').value = JSON.stringify(merged, null, 2);
  setStrategyEditorStatus('JSON updated from form. Changes are local until you click Save as New Version.');
}

function syncFromJsonToForm() {
  try {
    const s = JSON.parse(document.getElementById('sb-json').value || '{}');
    document.getElementById('sb-name').value = s.name || '';
    document.getElementById('sb-strategy-id').value = s.strategy_id || '';
    document.getElementById('sb-status').value = s.status || 'draft';
    document.getElementById('sb-asset-class').value = String(s.asset_class || 'stocks').toLowerCase();
    document.getElementById('sb-interval').value = s.interval || '1wk';
    document.getElementById('sb-description').value = s.description || '';
    document.getElementById('sb-stop-value').value = s.risk_config?.stop_value ?? 0.08;
    document.getElementById('sb-tp-r').value = s.risk_config?.take_profit_R ?? 2;
    document.getElementById('sb-max-hold').value = s.risk_config?.max_hold_bars ?? 30;
    document.getElementById('sb-universe').value = (s.universe || []).join(', ');
    setStrategyEditorStatus('Form updated from JSON. Changes are local until you click Save as New Version.');
  } catch (err) {
    setStrategyEditorStatus(`Invalid JSON: ${err.message}`, true);
    alert('Invalid JSON: ' + err.message);
  }
}

async function saveStrategyDraft() {
  syncFromFormToJson();

  let payload;
  try {
    payload = JSON.parse(document.getElementById('sb-json').value || '{}');
  } catch (err) {
    alert('Invalid JSON: ' + err.message);
    return;
  }

  if (!payload.strategy_id || !payload.name) {
    alert('strategy_id and name are required.');
    return;
  }
  if (payload.asset_class != null) {
    const rawClass = String(payload.asset_class).trim().toLowerCase();
    payload.asset_class = rawClass || undefined;
  }

  // Force version creation path with auto-increment endpoint.
  delete payload.strategy_version_id;
  delete payload.version;

  try {
    const created = await apiPostAbsolute('/api/strategies', payload);
    closeModal('strategy-modal');
    await loadStrategies();
    selectedStrategy = strategies.find(s => s.strategy_version_id === created.strategy_version_id) || selectedStrategy;
    if (selectedStrategy) {
      await selectStrategy(selectedStrategy.strategy_version_id);
    } else {
      renderReportContent();
      updateStrategyInfo();
    }
    setStrategyEditorStatus(`Saved as ${created.strategy_version_id}`, false);
    alert(`Saved as ${created.strategy_version_id}`);
  } catch (err) {
    setStrategyEditorStatus(`Save failed: ${err.message}`, true);
    alert('Save failed: ' + err.message);
  }
}

function setStrategyEditorStatus(message, isError = false) {
  const el = document.getElementById('sb-status-msg');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--color-negative)' : 'var(--color-text-subtle)';
}

async function applyStrategyStatus() {
  if (!selectedStrategy) {
    setStrategyEditorStatus('No selected strategy to update.', true);
    return;
  }
  const newStatus = document.getElementById('sb-status').value;
  if (!newStatus) {
    setStrategyEditorStatus('Choose a status first.', true);
    return;
  }
  try {
    await apiPatchAbsolute(`/api/strategies/${encodeURIComponent(selectedStrategy.strategy_version_id)}/status`, {
      status: newStatus
    });
    await loadStrategies();
    selectedStrategy = strategies.find(s => s.strategy_version_id === selectedStrategy.strategy_version_id) || selectedStrategy;
    if (selectedStrategy) {
      await selectStrategy(selectedStrategy.strategy_version_id);
    }
    setStrategyEditorStatus(`Status updated to ${newStatus} on ${selectedStrategy.strategy_version_id}.`);
  } catch (err) {
    setStrategyEditorStatus(`Status update failed: ${err.message}`, true);
    alert('Status update failed: ' + err.message);
  }
}

function approveReport() {
  if (!selectedReport) return;
  
  document.getElementById('notes-modal-title').textContent = 'Approve Report';
  document.getElementById('decision-notes').value = '';
  document.getElementById('notes-modal-submit').textContent = 'Approve';
  document.getElementById('notes-modal-submit').className = 'btn btn-primary';
  document.getElementById('notes-modal-submit').style.background = 'var(--color-positive)';
  document.getElementById('notes-modal-submit').onclick = async () => {
    const notes = document.getElementById('decision-notes').value;
    closeModal('notes-modal');
    
    try {
      await apiPost('/approve', { report_id: selectedReport.report_id, notes });
      
      // Reload everything
      await loadStrategies();
      reports = await apiGet(`/reports?strategy_version_id=${selectedStrategy.strategy_version_id}`);
      selectedReport = reports.find(r => r.report_id === selectedReport.report_id) || reports[0];
      selectedStrategy = strategies.find(s => s.strategy_version_id === selectedStrategy.strategy_version_id);
      
      renderStrategyList();
      updateStrategyInfo();
      renderReportContent();
    } catch (err) {
      alert('Approve failed: ' + err.message);
    }
  };
  
  openModal('notes-modal');
}

function rejectReport() {
  if (!selectedReport) return;
  
  document.getElementById('notes-modal-title').textContent = 'Reject Report';
  document.getElementById('decision-notes').value = '';
  document.getElementById('notes-modal-submit').textContent = 'Reject';
  document.getElementById('notes-modal-submit').className = 'btn btn-primary';
  document.getElementById('notes-modal-submit').style.background = 'var(--color-negative)';
  document.getElementById('notes-modal-submit').onclick = async () => {
    const notes = document.getElementById('decision-notes').value;
    closeModal('notes-modal');
    
    try {
      await apiPost('/reject', { report_id: selectedReport.report_id, notes });
      
      // Reload everything
      await loadStrategies();
      reports = await apiGet(`/reports?strategy_version_id=${selectedStrategy.strategy_version_id}`);
      selectedReport = reports.find(r => r.report_id === selectedReport.report_id) || reports[0];
      selectedStrategy = strategies.find(s => s.strategy_version_id === selectedStrategy.strategy_version_id);
      
      renderStrategyList();
      updateStrategyInfo();
      renderReportContent();
    } catch (err) {
      alert('Reject failed: ' + err.message);
    }
  };
  
  openModal('notes-modal');
}

// =====================
// MODAL HELPERS
// =====================

function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id, event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById(id).style.display = 'none';
}

// =====================
// FORMATTING HELPERS
// =====================

function formatR(value) {
  if (value === undefined || value === null) return 'N/A';
  const prefix = value >= 0 ? '+' : '';
  return prefix + value.toFixed(2) + 'R';
}

function formatPct(value) {
  if (value === undefined || value === null) return 'N/A';
  return (value * 100).toFixed(1) + '%';
}

function metricCard(label, value, isPositive) {
  let colorClass = '';
  if (isPositive === true) colorClass = ' positive';
  else if (isPositive === false) colorClass = ' negative';
  
  return `
    <div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value${colorClass}">${value}</div>
    </div>
  `;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function intNum(v) {
  return Math.trunc(num(v));
}

function pctNum(v) {
  const n = num(v);
  return `${n.toFixed(1)}%`;
}

function ratioPct(v) {
  const n = num(v);
  return `${(n * 100).toFixed(1)}%`;
}

function jsonPretty(obj) {
  if (obj == null) return 'null';
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

// Expose modal functions globally (needed for onclick attributes)
window.runValidation = runValidation;
window.submitRunValidation = submitRunValidation;
window.cancelValidationRun = cancelValidationRun;
window.approveReport = approveReport;
window.rejectReport = rejectReport;
window.clearReports = clearReports;
window.openStrategyEditor = openStrategyEditor;
window.generateDraftFromPrompt = generateDraftFromPrompt;
window.syncFromFormToJson = syncFromFormToJson;
window.syncFromJsonToForm = syncFromJsonToForm;
window.saveStrategyDraft = saveStrategyDraft;
window.applyStrategyStatus = applyStrategyStatus;
window.sendValidatorChat = sendValidatorChat;
window.askWhyFailed = askWhyFailed;
window.askHowToImprove = askHowToImprove;
window.askParamChanges = askParamChanges;
window.autoResizeValidatorChatInput = autoResizeValidatorChatInput;
window.handleValidatorChatKeydown = handleValidatorChatKeydown;
window.updateRunTierDescription = updateRunTierDescription;
window.onRunAssetClassChange = onRunAssetClassChange;
window.openStrategyPage = openStrategyPage;
window.openSymbolLibraryPage = openSymbolLibraryPage;
window.selectStrategy = selectStrategy;
window.selectReport = selectReport;
window.closeModal = closeModal;
window.toggleStrategyPanel = toggleStrategyPanel;
window.toggleChatPanel = toggleChatPanel;
window.deleteReport = deleteReport;
window.tombstoneSelectedStrategy = tombstoneSelectedStrategy;

function toggleStrategyPanel() {
  const panel  = document.getElementById('strategy-panel');
  const layout = document.querySelector('.validator-layout');
  const btn    = document.getElementById('strategy-toggle-btn');
  if (!panel || !layout) return;
  const collapsed = panel.classList.toggle('collapsed');
  layout.classList.toggle('strategy-collapsed', collapsed);
  if (btn) btn.textContent = collapsed ? '›' : '‹';
  if (btn) btn.title = collapsed ? 'Expand strategies panel' : 'Collapse strategies panel';
}

function toggleChatPanel() {
  const panel = document.getElementById('chat-panel');
  const body  = document.querySelector('.report-body');
  const btn   = document.getElementById('chat-toggle-btn');
  if (!panel || !body) return;
  const collapsed = panel.classList.toggle('collapsed');
  body.classList.toggle('chat-collapsed', collapsed);
  if (btn) btn.textContent = collapsed ? '‹' : '›';
  if (btn) btn.title = collapsed ? 'Expand analysis panel' : 'Collapse analysis panel';
}
