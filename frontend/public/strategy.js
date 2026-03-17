const API_BASE = '/api/validator';

let strategies = [];
let selectedStrategy = null;
let strategyChatMessages = [];
let strategyEditorMode = 'new';
let strategyValidationIndex = {};
let strategyTierProgressIndex = {};
const STRATEGY_ASSET_CLASSES = ['futures', 'stocks', 'options', 'forex', 'crypto'];
const VALIDATION_INTERVAL_OPTIONS = ['1h', '4h', '1d', '1wk', '1mo'];
const RUN_TIER_HINTS = {
  tier1: 'Fast kill test on the fixed Tier 1 universe. Target evidence: 200-300 trades.',
  tier1b: 'Evidence expansion on a broad optionable universe slice. Use this when Tier 1 quality looks good but sample size is thin.',
  tier2: 'Core validation on fixed Tier 2 universe. Target evidence: 500-1500 trades. Requires prior Tier 1 or Tier 1B PASS.',
  tier3: 'Robustness validation on fixed Tier 3 universe. Stress tests for survivors. Requires prior Tier 2 PASS.',
};
let runTierConfig = null;
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

function normalizeAssetClass(value, fallback = 'stocks') {
  const key = String(value || '').trim().toLowerCase();
  return STRATEGY_ASSET_CLASSES.includes(key) ? key : fallback;
}

function normalizeValidationInterval(value, fallback = '1wk') {
  const key = String(value || '').trim().toLowerCase();
  return VALIDATION_INTERVAL_OPTIONS.includes(key) ? key : fallback;
}

function runSettingsStorageKey(strategyVersionId) {
  return `strategy-run-settings:${String(strategyVersionId || 'default')}`;
}

function loadRunSettings(strategyVersionId) {
  try {
    const raw = localStorage.getItem(runSettingsStorageKey(strategyVersionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRunSettings(strategyVersionId, settings) {
  try {
    localStorage.setItem(runSettingsStorageKey(strategyVersionId), JSON.stringify(settings || {}));
  } catch {
    // Best effort only.
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initStrategyChat();
  await loadStrategies();
  updateStrategyTopActions();
  const params = new URLSearchParams(window.location.search);
  const id = params.get('strategy_version_id');
  if (id) {
    selectStrategy(id);
  }

  // Pre-fill chat if seed parameter is present
  const seed = params.get('seed');
  if (seed) {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = seed;
    }
  }
});

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
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function apiPostAbsolute(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function apiPatchAbsolute(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function apiDeleteAbsolute(path) {
  const res = await fetch(path, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function loadStrategies() {
  try {
    const [loadedStrategies, allReports] = await Promise.all([
      apiGet('/strategies'),
      apiGet('/reports').catch(() => []),
    ]);
    strategies = Array.isArray(loadedStrategies) ? loadedStrategies : [];
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
      pass_fail_reasons: Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [],
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
      pass_fail_reasons: Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [],
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
    return [{
      key: tier,
      label: tier === 'tier1b' ? 'T1B' : tier.toUpperCase().replace('TIER', 'T'),
      title: `Passed ${tier.toUpperCase()}`,
    }];
  });
}

function renderStrategyList() {
  const list = document.getElementById('strategy-list');
  const count = document.getElementById('strategy-count');
  count.textContent = strategies.length;

  const registryStrategies = strategies.filter(s => s.source !== 'research');
  const researchStrategies = strategies.filter(s => s.source === 'research');

  const labels = { approved: 'Approved', testing: 'Testing', draft: 'Draft', experimental: 'Experimental', rejected: 'Rejected' };

  function renderGroup(items) {
    const groups = {};
    for (const s of items) {
      const key = s.status || 'draft';
      (groups[key] = groups[key] || []).push(s);
    }
    let html = '';
    for (const [status, list] of Object.entries(groups)) {
      html += `<div class="group">${labels[status] || status} (${list.length})</div>`;
      for (const s of list) {
        const active = selectedStrategy && selectedStrategy.strategy_version_id === s.strategy_version_id;
        const tierBadges = getStrategyTierBadges(s);
        const validationBadge = getStrategyValidationBadge(s);
        html += `
          <div class="item ${active ? 'active' : ''}" onclick="selectStrategy('${s.strategy_version_id}')">
            <div style="font-size:var(--text-body);font-weight:600;display:flex;align-items:center;gap:var(--space-6);flex-wrap:wrap;">${esc(s.name)}${tierBadges.map((badge) => ` <span class="tier-badge" title="${esc(badge.title)}">${esc(badge.label)}</span>`).join('')}</div>
            <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:2px;">
              <span class="validation-badge ${validationBadge.key}" title="${esc(validationBadge.title)}">${esc(validationBadge.label)}</span>
              <span class="status-badge ${s.status}">${s.status}</span>
              <span style="margin-left:var(--space-6);">${esc(s.asset_class || 'N/A')} · ${esc(s.composition || s.scan_mode || '—')} · v${esc(String(s.version || 1))}</span>
            </div>
          </div>
        `;
      }
    }
    return html;
  }

  let html = '';
  if (registryStrategies.length > 0) {
    html += `<div class="group" style="font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-subtle);border-bottom:1px solid var(--color-border);">Strategies</div>`;
    html += renderGroup(registryStrategies);
  }
  if (researchStrategies.length > 0) {
    html += `<div class="group" style="font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-subtle);border-bottom:1px solid var(--color-border);margin-top:var(--space-12);">Research Candidates</div>`;
    html += renderGroup(researchStrategies);
  }

  list.innerHTML = html;
}

function selectStrategy(versionId) {
  selectedStrategy = strategies.find(s => s.strategy_version_id === versionId) || null;

  if (selectedStrategy) {
    assembleStrategyFromDefaults(selectedStrategy);
  }

  renderStrategyList();
  renderStrategyDetails();
  updateStrategyTopActions();

  if (selectedStrategy) {
    const manifestCount = Array.isArray(selectedStrategy.parameter_manifest) ? selectedStrategy.parameter_manifest.length : 0;
    strategyChatMessages.push({
      sender: 'ai',
      text: `Loaded ${selectedStrategy.name} (${selectedStrategy.strategy_version_id}). Risk/exit config auto-populated from Settings defaults.${manifestCount ? ` Parameter manifest loaded with ${manifestCount} declared knobs.` : ''} Click **Analyze** or ask me to review for gaps.`
    });
    renderStrategyChat();
  }
}

function assembleStrategyFromDefaults(strategy) {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch {}

  const stopType = settings.defaultStopType || 'atr_multiple';
  const stopValue = parseFloat(settings.defaultStopValue) || 2.0;
  const stopBuffer = parseFloat(settings.defaultStopBuffer) || 2.0;

  if (!strategy.risk_config || Object.keys(strategy.risk_config).length <= 1) {
    strategy.risk_config = {
      stop_type: stopType,
      ...(stopType === 'atr_multiple' ? { atr_multiplier: stopValue } : {}),
      ...(stopType === 'fixed_pct' ? { stop_value: stopValue / 100 } : {}),
      ...((stopType === 'structural' || stopType === 'swing_low') ? { stop_level: stopType === 'structural' ? 'base_low' : 'swing_low', stop_buffer_pct: stopBuffer / 100 } : {}),
      take_profit_R: parseFloat(settings.defaultTakeProfitR) || 2.0,
      max_hold_bars: parseInt(settings.defaultMaxHold) || 30,
    };
  }

  if (!strategy.exit_config || Object.keys(strategy.exit_config).length === 0) {
    const trailType = settings.defaultTrailingType || 'none';
    const trailValue = parseFloat(settings.defaultTrailingValue) || 2.0;
    strategy.exit_config = {
      target_type: 'R_multiple',
      target_level: parseFloat(settings.defaultTakeProfitR) || 2.0,
      time_stop_bars: parseInt(settings.defaultMaxHold) || 30,
      trailing: trailType === 'none' ? null : { type: trailType, value: trailValue },
    };
  }

  if (!strategy.execution_config || Object.keys(strategy.execution_config).length === 0) {
    const breakevenR = parseFloat(settings.defaultBreakevenR);
    strategy.execution_config = {
      ...(breakevenR ? { auto_breakeven_r: breakevenR } : {}),
      production_lock: true,
    };
  }

  if (!strategy.cost_config || Object.keys(strategy.cost_config).length === 0) {
    strategy.cost_config = {
      commission_per_trade: 0,
      slippage_pct: 0.001,
    };
  }
}

function updateStrategyTopActions() {
  const btnStrategy = document.getElementById('btn-top-strategy');
  if (btnStrategy) btnStrategy.disabled = !selectedStrategy;
}

async function apiGetAbsolute(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

function getFallbackTierConfig(assetClass) {
  const ac = normalizeAssetClass(assetClass, 'stocks');
  const tiers = FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS[ac] || FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS.stocks;
  return {
    asset_class: ac,
    tiers: {
      tier1: { label: 'Tier 1 - Kill Test', description: RUN_TIER_HINTS.tier1, symbols: tiers.tier1.slice() },
      tier1b: { label: 'Tier 1B - Evidence Expansion', description: RUN_TIER_HINTS.tier1b, symbols: tiers.tier1b.slice() },
      tier2: { label: 'Tier 2 - Core Validation', description: RUN_TIER_HINTS.tier2, symbols: tiers.tier2.slice() },
      tier3: { label: 'Tier 3 - Robustness', description: RUN_TIER_HINTS.tier3, symbols: tiers.tier3.slice() },
    }
  };
}

async function loadRunTierConfig(assetClass) {
  const ac = normalizeAssetClass(assetClass || selectedStrategy?.asset_class, 'stocks');
  const fallback = getFallbackTierConfig(ac);
  try {
    const qp = selectedStrategy?.strategy_version_id
      ? `strategy_version_id=${encodeURIComponent(selectedStrategy.strategy_version_id)}`
      : `asset_class=${encodeURIComponent(ac)}`;
    const data = await apiGetAbsolute(`/api/validator/tier-config?${qp}`);
    if (!data || typeof data !== 'object' || !data.tiers) {
      runTierConfig = fallback;
      return runTierConfig;
    }
    if (selectedStrategy?.strategy_version_id && assetClass && normalizeAssetClass(data.asset_class, ac) !== ac) {
      const override = await apiGetAbsolute(`/api/validator/tier-config?asset_class=${encodeURIComponent(ac)}`);
      runTierConfig = override && override.tiers ? override : fallback;
      return runTierConfig;
    }
    runTierConfig = data;
    return runTierConfig;
  } catch {
    runTierConfig = fallback;
    return runTierConfig;
  }
}

function openRunValidationFromEditor() {
  if (!selectedStrategy) return;
  void runValidationFromEditor();
}

function getEditorRunContext() {
  const tier = String(document.getElementById('sb-run-tier')?.value || 'tier1').toLowerCase();
  const assetClass = normalizeAssetClass(document.getElementById('sb-asset-class')?.value || selectedStrategy?.asset_class, 'stocks');
  const interval = normalizeValidationInterval(
    document.getElementById('sb-run-interval')?.value || document.getElementById('sb-interval')?.value || selectedStrategy?.interval,
    '1wk',
  );
  const dateStart = String(document.getElementById('sb-run-date-start')?.value || '').trim();
  const dateEnd = String(document.getElementById('sb-run-date-end')?.value || '').trim();
  const cfg = runTierConfig || getFallbackTierConfig(assetClass);
  const tierCfg = cfg?.tiers?.[tier];
  return {
    tier,
    assetClass,
    interval,
    dateStart,
    dateEnd,
    symbols: Array.isArray(tierCfg?.symbols) ? tierCfg.symbols : [],
    description: String(tierCfg?.description || RUN_TIER_HINTS[tier] || ''),
  };
}

function updateEditorRunValidationNote() {
  const noteEl = document.getElementById('sb-run-note');
  if (!noteEl) return;
  const ctx = getEditorRunContext();
  noteEl.textContent = `${ctx.description} Asset class: ${ctx.assetClass}. Interval: ${ctx.interval}. Date range: ${ctx.dateStart || 'N/A'} to ${ctx.dateEnd || 'N/A'}. Symbols (${ctx.symbols.length}): ${ctx.symbols.join(', ')}`;
}

function openValidatorSymbolLibraryPage() {
  const currentAssetClass = normalizeAssetClass(
    document.getElementById('sb-asset-class')?.value || selectedStrategy?.asset_class,
    'stocks',
  );
  window.location.href = `validator-symbol-library.html?asset_class=${encodeURIComponent(currentAssetClass)}`;
}

async function handleEditorRunAssetClassChange() {
  const assetClass = normalizeAssetClass(document.getElementById('sb-asset-class')?.value || selectedStrategy?.asset_class, 'stocks');
  await loadRunTierConfig(assetClass);
  updateEditorRunValidationNote();
}

async function runValidationFromEditor() {
  if (!selectedStrategy) return;
  const runBtn = document.getElementById('sb-run-btn');
  const dateStart = String(document.getElementById('sb-run-date-start')?.value || '').trim();
  const dateEnd = String(document.getElementById('sb-run-date-end')?.value || '').trim();
  const tier = String(document.getElementById('sb-run-tier')?.value || 'tier1').toLowerCase();
  const interval = normalizeValidationInterval(
    document.getElementById('sb-run-interval')?.value || document.getElementById('sb-interval')?.value || selectedStrategy.interval,
    '1wk',
  );
  const assetClass = normalizeAssetClass(document.getElementById('sb-asset-class')?.value || selectedStrategy.asset_class, 'stocks');

  if (!dateStart || !dateEnd) {
    setStrategyEditorStatus('Start date and end date are required for validation.', true);
    return;
  }
  if (dateStart >= dateEnd) {
    setStrategyEditorStatus('Start date must be before end date.', true);
    return;
  }

  await loadRunTierConfig(assetClass);
  const ctx = getEditorRunContext();
  saveRunSettings(selectedStrategy?.strategy_version_id, {
    tier,
    interval,
    date_start: dateStart,
    date_end: dateEnd,
    asset_class: assetClass,
  });

  if (runBtn) runBtn.disabled = true;
  setStrategyEditorStatus('Queuing validation run...');
  try {
    const result = await apiPost('/run', {
      strategy_version_id: selectedStrategy.strategy_version_id,
      date_start: dateStart,
      date_end: dateEnd,
      tier,
      asset_class: assetClass,
      interval,
    });
    const symbolCount = Number(result.symbol_count || ctx.symbols.length || 0);
    setStrategyEditorStatus(`Validation queued: ${result.job_id} (${assetClass}, ${interval}, ${dateStart}..${dateEnd}, ${tier}, ${symbolCount} symbols).`);
    const goToValidator = window.confirm(`Validation queued (${result.job_id}). Open Validator page to monitor progress?`);
    if (goToValidator) {
      window.location.href = `validator.html?strategy_version_id=${encodeURIComponent(selectedStrategy.strategy_version_id)}&job_id=${encodeURIComponent(result.job_id)}`;
    }
  } catch (err) {
    setStrategyEditorStatus(`Validation failed: ${err.message}`, true);
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

function renderStrategyDetails() {
  const container = document.getElementById('strategy-details');
  if (!selectedStrategy) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#9881;</div><div>Select a strategy to inspect details</div></div>`;
    return;
  }

  const s = selectedStrategy;
  const canDeleteStrategy = s.source !== 'registry';
  const tierBadges = getStrategyTierBadges(s);
  const validationBadge = getStrategyValidationBadge(s);
  const parameterManifest = Array.isArray(s.parameter_manifest) ? s.parameter_manifest : [];
  const anatomyOrder = ['structure', 'location', 'entry_timing', 'regime_filter', 'stop_loss', 'take_profit', 'risk_controls'];
  const anatomyLabels = {
    structure: 'Structure',
    location: 'Location',
    entry_timing: 'Entry Timing',
    regime_filter: 'Regime Filter',
    stop_loss: 'Stop Loss',
    take_profit: 'Take Profit',
    risk_controls: 'Risk Controls',
  };
  const anatomyCards = anatomyOrder.map((key) => {
    const items = parameterManifest.filter(item => item?.anatomy === key);
    const sweepEnabled = items.filter(item => item?.sweep_enabled).length;
    const sensitivityEnabled = items.filter(item => item?.sensitivity_enabled).length;
    return `
      <div class="card" style="padding:var(--space-10) var(--space-12);">
        <div style="font-size:var(--text-caption);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.08em;font-family:var(--font-mono);">${esc(anatomyLabels[key] || key)}</div>
        <div style="margin-top:var(--space-6);font-size:var(--text-small);font-weight:600;">${items.length} manifest knob${items.length === 1 ? '' : 's'}</div>
        <div style="margin-top:var(--space-4);font-size:var(--text-caption);color:var(--color-text-subtle);font-family:var(--font-mono);">Sweep ${sweepEnabled} · Sensitivity ${sensitivityEnabled}</div>
      </div>
    `;
  }).join('');
  const manifestRows = parameterManifest.length
    ? parameterManifest
        .slice()
        .sort((a, b) => {
          const pa = Number(a?.priority || 0);
          const pb = Number(b?.priority || 0);
          if (pb !== pa) return pb - pa;
          return String(a?.label || '').localeCompare(String(b?.label || ''));
        })
        .map((item) => {
          const suggestions = Array.isArray(item?.suggested_values) && item.suggested_values.length
            ? item.suggested_values.map(value => esc(String(value))).join(', ')
            : '—';
          return `
            <tr>
              <td class="text-mono">${esc(item.label || item.key || '—')}</td>
              <td>${esc(anatomyLabels[item.anatomy] || item.anatomy || '—')}</td>
              <td class="text-mono">${esc(item.path || '—')}</td>
              <td class="text-mono">${item.sweep_enabled ? 'yes' : 'no'}</td>
              <td class="text-mono">${item.sensitivity_enabled ? 'yes' : 'no'}</td>
              <td class="text-mono">${esc(suggestions)}</td>
            </tr>
          `;
        }).join('')
    : `<tr><td colspan="6" class="text-muted">No parameter manifest available yet.</td></tr>`;
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);margin-bottom:var(--space-8);">
      <div style="display:flex;align-items:center;gap:var(--space-10);">
        <h2 style="margin:0;font-size:var(--text-h2);">${esc(s.name)}</h2>
        <span class="validation-badge ${validationBadge.key}" title="${esc(validationBadge.title)}">${esc(validationBadge.label)}</span>
        <span class="status-badge ${s.status}">${s.status}</span>
        ${tierBadges.map((badge) => `<span class="tier-badge" title="${esc(badge.title)}">${esc(badge.label)}</span>`).join('')}
      </div>
      <div style="display:flex;gap:var(--space-8);">
        <button
          class="btn btn-ghost"
          style="color:var(--color-negative);"
          onclick="deleteSelectedStrategy()"
          ${canDeleteStrategy ? '' : 'disabled'}
          title="${canDeleteStrategy ? 'Delete this saved strategy and its validator artifacts' : 'Registry-backed strategies and primitives cannot be deleted'}"
        >Delete Strategy</button>
        <button class="btn btn-primary" onclick="openStrategyEditor('edit')">Run Validation</button>
      </div>
    </div>

    <div class="section-title">Metadata</div>
    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-8) var(--space-16);font-size:var(--text-small);">
        <div><span class="text-muted">ID:</span> <span class="text-mono">${esc(s.strategy_id || 'N/A')}</span></div>
        <div><span class="text-muted">Version:</span> <span class="text-mono">v${esc(String(s.version || 'N/A'))}</span></div>
        <div><span class="text-muted">Version ID:</span> <span class="text-mono">${esc(s.strategy_version_id || 'N/A')}</span></div>
        <div><span class="text-muted">Asset Class:</span> <span class="text-mono">${esc(s.asset_class || 'N/A')}</span></div>
        <div><span class="text-muted">Interval:</span> <span class="text-mono">${esc(s.interval || 'N/A')}</span></div>
        <div style="grid-column:1 / -1;"><span class="text-muted">Description:</span> ${esc(s.description || 'N/A')}</div>
      </div>
    </div>

    <div class="section-title">Parameter Manifest</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-10);margin-bottom:var(--space-12);">
      ${anatomyCards}
    </div>
    <div class="card">
      <div style="font-size:var(--text-caption);color:var(--color-text-muted);margin-bottom:var(--space-10);">
        Canonical sweep and sensitivity knobs for this strategy. These are the identity-preserving parameters the app should use across Strategy, Validator, Sweep, and AI reviewer flows.
      </div>
      <div style="overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:var(--text-small);">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--color-border);">
              <th style="padding:0 0 var(--space-8);">Label</th>
              <th style="padding:0 0 var(--space-8);">Anatomy</th>
              <th style="padding:0 0 var(--space-8);">Path</th>
              <th style="padding:0 0 var(--space-8);">Sweep</th>
              <th style="padding:0 0 var(--space-8);">Sensitivity</th>
              <th style="padding:0 0 var(--space-8);">Suggested Values</th>
            </tr>
          </thead>
          <tbody>
            ${manifestRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-title">Structure Config</div>
    <div class="card"><pre>${esc(json(s.structure_config))}</pre></div>

    <div class="section-title">Setup Config</div>
    <div class="card"><pre>${esc(json(s.setup_config))}</pre></div>

    <div class="section-title">Entry + Risk + Exit</div>
    <div class="card"><pre>${esc(json({ entry_config: s.entry_config || null, risk_config: s.risk_config || null, exit_config: s.exit_config || null }))}</pre></div>

    <div class="section-title">Costs + Execution + Universe</div>
    <div class="card"><pre>${esc(json({ cost_config: s.cost_config || null, execution_config: s.execution_config || null, universe: s.universe || [] }))}</pre></div>
  `;
}

function initStrategyChat() {
  if (strategyChatMessages.length === 0) {
    strategyChatMessages.push({
      sender: 'ai',
      text: 'I\'m the Strategy Reviewer. Load a composite or strategy and I\'ll analyze it for:\n\n' +
        '1. Risk gaps and parameter mismatches\n' +
        '2. Universe/regime compatibility issues\n' +
        '3. Readiness assessment and test plan\n\n' +
        'Risk and exit rules are auto-populated from your Settings defaults.'
    });
  }
  renderStrategyChat();
}

async function deleteSelectedStrategy() {
  if (!selectedStrategy?.strategy_version_id) return;
  if (selectedStrategy.source === 'registry') {
    alert('Registry-backed strategies and primitives cannot be deleted. Tombstone the strategy instead.');
    return;
  }

  const strategyVersionId = selectedStrategy.strategy_version_id;
  const strategyName = selectedStrategy.name || strategyVersionId;
  const ok = window.confirm(`Delete ${strategyName}? This will remove the saved strategy and its validator reports/trade data. This cannot be undone.`);
  if (!ok) return;

  try {
    const result = await apiDeleteAbsolute(`/api/strategies/${encodeURIComponent(strategyVersionId)}`);
    selectedStrategy = null;
    await loadStrategies();
    renderStrategyDetails();
    updateStrategyTopActions();
    alert(`Deleted ${strategyName}.${result?.deleted_reports ? ` Removed ${result.deleted_reports} report(s).` : ''}`);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
function renderStrategyChat() {
  const container = document.getElementById('strategy-chat-messages');
  if (!container) return;
  container.innerHTML = strategyChatMessages.map((m, idx) => {
    if (m.type === 'thought') {
      return `<div class="validator-chat-thought">${esc(m.text)}</div>`;
    }

    // Detect ===STRATEGY_JSON=== markers in AI responses
    if (m.sender === 'ai' && m.text && m.text.includes('===STRATEGY_JSON===')) {
      const jsonMatch = m.text.match(/===STRATEGY_JSON===\s*([\s\S]*?)\s*===END_STRATEGY_JSON===/);
      if (jsonMatch) {
        const beforeJson = m.text.substring(0, m.text.indexOf('===STRATEGY_JSON===')).trim();
        const afterJson = m.text.substring(m.text.indexOf('===END_STRATEGY_JSON===') + '===END_STRATEGY_JSON==='.length).trim();
        const jsonStr = jsonMatch[1].trim();

        // Validate that it's parseable
        let isValid = false;
        let specName = '';
        try {
          const parsed = JSON.parse(jsonStr);
          isValid = true;
          specName = parsed.name || parsed.strategy_id || 'Draft';
        } catch {}

        let html = '';
        if (beforeJson) html += `<div style="margin-bottom:8px">${esc(beforeJson)}</div>`;
        if (isValid) {
          html += `<div style="background:var(--bg-tertiary);border:1px solid var(--accent-primary);border-radius:6px;padding:10px;margin:8px 0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span style="font-weight:600;color:var(--accent-primary);">Strategy: ${esc(specName)}</span>
              <button class="btn btn-primary btn-sm" onclick="loadStrategyJsonFromChat(${idx})" style="font-size:11px;padding:4px 10px;">Load into Editor</button>
            </div>
            <pre style="font-size:10px;max-height:200px;overflow:auto;margin:0;white-space:pre-wrap;color:var(--text-secondary);">${esc(jsonStr.substring(0, 500))}${jsonStr.length > 500 ? '\n...' : ''}</pre>
          </div>`;
        } else {
          html += `<div style="color:var(--text-warning);margin:8px 0;">Generated JSON was invalid. Try again with a more specific prompt.</div>`;
        }
        if (afterJson) html += `<div style="margin-top:8px">${esc(afterJson)}</div>`;

        return `<div class="validator-chat-bubble ai">${html}</div>`;
      }
    }

    return `<div class="validator-chat-bubble ${m.sender}">${esc(m.text)}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

/** Load strategy JSON from a chat message into the editor form */
function loadStrategyJsonFromChat(messageIndex) {
  const m = strategyChatMessages[messageIndex];
  if (!m || !m.text) return;

  const jsonMatch = m.text.match(/===STRATEGY_JSON===\s*([\s\S]*?)\s*===END_STRATEGY_JSON===/);
  if (!jsonMatch) return;

  let spec;
  try {
    spec = JSON.parse(jsonMatch[1].trim());
  } catch (err) {
    alert('Invalid JSON in chat message: ' + err.message);
    return;
  }

  // Open the editor if not already open
  if (typeof openStrategyEditor === 'function') {
    openStrategyEditor('new');
  }

  // Small delay to let editor DOM render
  setTimeout(() => {
    const sbJson = document.getElementById('sb-json');
    if (sbJson) {
      sbJson.value = JSON.stringify(spec, null, 2);
      syncFromJsonToForm();
      setStrategyEditorStatus('Strategy loaded from co-pilot chat. Review all sections, then save.');

      // Notify the chat that the strategy is now in the editor
      strategyChatMessages.push({
        sender: 'ai',
        text: `Strategy "${spec.name || spec.strategy_id || 'Draft'}" is now loaded in the editor. ` +
          `All form fields are populated. I can see the full spec â€” ask me about risk gaps, parameter tuning, or test plans.`
      });
      renderStrategyChat();
    }
  }, 100);
}
window.loadStrategyJsonFromChat = loadStrategyJsonFromChat;

function setStrategyChatStatus(text) {
  const el = document.getElementById('strategy-chat-status');
  if (!el) return;
  el.textContent = text || 'Ready';
}

function autoResizeStrategyChatInput() {
  const input = document.getElementById('strategy-chat-input');
  if (!input) return;
  input.style.height = '82px';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function handleStrategyChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendStrategyChat();
  }
}

function buildStrategyChatContext() {
  // Try to read from the editor first (it has the latest state, including AI-generated drafts)
  let editorSpec = null;
  const sbJson = document.getElementById('sb-json');
  if (sbJson && sbJson.value && sbJson.value.trim().length > 5) {
    try {
      editorSpec = JSON.parse(sbJson.value);
    } catch {}
  }

  // Use editor spec if available, otherwise fall back to selected strategy in the list
  const s = editorSpec || selectedStrategy || null;

  // Read account + risk rules from Settings (localStorage)
  let accountSettings = null;
  let riskDefaults = null;
  try {
    const raw = localStorage.getItem('copilotSettings');
    if (raw) {
      const p = JSON.parse(raw);
      accountSettings = {
        accountSize: p.accountSize || null,
        availableBalance: p.availableBalance || null,
        dailyLossLimit: p.dailyLossLimit || null,
        maxOpenPositions: p.maxOpenPositions || null,
        maxDailyTrades: p.maxDailyTrades || null,
        maxConsecutiveLosses: p.maxConsecutiveLosses || null,
        maxDrawdown: p.maxDrawdown || null,
      };
      riskDefaults = {
        riskPercent: p.riskPercent || null,
        maxPosition: p.maxPosition || null,
        defaultStopType: p.defaultStopType || null,
        defaultStopValue: p.defaultStopValue || null,
        defaultStopBuffer: p.defaultStopBuffer || null,
        minRR: p.minRR || null,
        defaultTakeProfitR: p.defaultTakeProfitR || null,
        defaultMaxHold: p.defaultMaxHold || null,
        defaultBreakevenR: p.defaultBreakevenR || null,
        defaultTrailingType: p.defaultTrailingType || null,
        defaultTrailingValue: p.defaultTrailingValue || null,
      };
    }
  } catch {}

  return {
    symbol: s?.universe?.[0] || '',
    patternType: s?.setup_config?.pattern_type || s?.scan_mode || 'strategy',
    tradeDirection: (s?.trade_direction || 'LONG').toUpperCase(),
    copilotAnalysis: {
      strategyDetails: true,
      editorActive: !!editorSpec,
      accountSettings,
      riskDefaults,
      strategy: s ? {
        strategy_id: s.strategy_id,
        strategy_version_id: s.strategy_version_id,
        name: s.name,
        status: s.status,
        asset_class: s.asset_class || null,
        interval: s.interval,
        description: s.description || null,
        parameter_manifest: Array.isArray(s.parameter_manifest) ? s.parameter_manifest : [],
        structure_config: s.structure_config || null,
        setup_config: s.setup_config || null,
        entry_config: s.entry_config || null,
        risk_config: s.risk_config || null,
        exit_config: s.exit_config || null,
        execution_config: s.execution_config || null,
        cost_config: s.cost_config || null,
        universe: s.universe || []
      } : null
    }
  };
}

async function sendStrategyChat(prefill) {
  const input = document.getElementById('strategy-chat-input');
  const raw = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  let message = (raw || '').trim();
  if (!message) return;

  if (input && typeof prefill !== 'string') {
    input.value = '';
    autoResizeStrategyChatInput();
  }

  strategyChatMessages.push({ sender: 'user', text: message });
  const startedAt = Date.now();
  setStrategyChatStatus('Thinking');
  renderStrategyChat();

  try {
    const s = selectedStrategy;
    if (s) {
      message = `${message}

STRATEGY_FACTS:
- strategy_version_id: ${s.strategy_version_id}
- status: ${s.status}
- interval: ${s.interval || 'N/A'}
- scan_mode: ${s.scan_mode || 'N/A'}
- universe_size: ${Array.isArray(s.universe) ? s.universe.length : 0}
`;
    }

    const res = await apiPostAbsolute('/api/vision/chat', {
      message,
      context: buildStrategyChatContext(),
      role: 'hypothesis_author'
    });
    const sec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    strategyChatMessages.push({ type: 'thought', text: `Thought for ${sec}s` });
    strategyChatMessages.push({ sender: 'ai', text: res.response || 'No response.' });
    setStrategyChatStatus('Ready');
  } catch (err) {
    strategyChatMessages.push({ sender: 'ai', text: `Chat failed: ${err.message}` });
    setStrategyChatStatus('Error');
  }
  renderStrategyChat();
}

function hasStrategyContext() {
  if (selectedStrategy) return true;
  const sbJson = document.getElementById('sb-json');
  if (sbJson && sbJson.value && sbJson.value.trim().length > 5) {
    try { JSON.parse(sbJson.value); return true; } catch { return false; }
  }
  return false;
}

function askStrategySummary() {
  if (!hasStrategyContext()) {
    sendStrategyChat('No strategy loaded. Load a composite from the Indicator Studio first.');
    return;
  }
  sendStrategyChat('Analyze this assembled strategy. Give me your quick assessment: is it ready to validate? Summarize the composite pipeline, declared parameter manifest, risk config, exit rules, and flag any obvious issues.');
}

function askStrategyRisks() {
  if (!hasStrategyContext()) {
    sendStrategyChat('No strategy loaded. Load a composite from the Indicator Studio first.');
    return;
  }
  sendStrategyChat('Review this strategy for risk gaps. Check: is the stop appropriate for this universe? Are min_data_bars sufficient for the indicator lookback? Any regime/universe mismatches? Are the declared manifest knobs the right identity-preserving ones? Propose specific numeric fixes.');
}

function askStrategyTests() {
  if (!hasStrategyContext()) {
    sendStrategyChat('No strategy loaded. Load a composite from the Indicator Studio first.');
    return;
  }
  sendStrategyChat('Create a validation test plan for this strategy: which tier to run first, what pass/fail thresholds to set, what to watch for in results, which manifest knobs are legitimate repair levers, and what would make you reject it.');
}

function defaultStrategyDraft() {
  const now = new Date().toISOString();
  return {
    strategy_id: '',
    version: 1,
    strategy_version_id: '',
    status: 'draft',
    asset_class: 'stocks',
    name: '',
    description: '',
    scan_mode: 'wyckoff',
    trade_direction: 'long',
    interval: '1wk',
    universe: [],
    structure_config: {},
    setup_config: {},
    entry_config: {},
    risk_config: {},
    exit_config: {},
    cost_config: {},
    execution_config: {},
    created_at: now,
    updated_at: now
  };
}

function normalizeEditableStrategyStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (raw === 'draft' || raw === 'testing' || raw === 'approved' || raw === 'rejected') {
    return raw;
  }
  if (raw === 'stable' || raw === 'active') {
    return 'testing';
  }
  if (raw === 'experimental') {
    return 'draft';
  }
  return 'draft';
}

function openStrategyEditor(mode = 'new') {
  strategyEditorMode = mode;
  if (mode === 'edit' && !selectedStrategy) {
    alert('Select a strategy first.');
    return;
  }

  const strategy = mode === 'edit' && selectedStrategy
    ? JSON.parse(JSON.stringify(selectedStrategy))
    : defaultStrategyDraft();
  renderInlineStrategyEditor(strategy, mode);
}

function renderInlineStrategyEditor(strategy, mode) {
  const container = document.getElementById('strategy-details');
  if (!container) return;

  const isEdit = mode === 'edit';
  const title = isEdit ? 'Edit Strategy' : 'New Strategy';
  const saveLabel = 'Save as New Version';
  const applyStyle = isEdit ? '' : 'display:none;';

  container.innerHTML = `
    <div class="strategy-editor-header">
      <div class="strategy-editor-title">
        <h2 style="margin:0;font-size:var(--text-h2);">${esc(title)}</h2>
        ${isEdit && strategy?.status ? `<span class="status-badge ${esc(strategy.status)}">${esc(strategy.status)}</span>` : ''}
      </div>
      <div class="strategy-editor-actions" style="margin-top:0;">
        <button class="btn btn-ghost" onclick="cancelStrategyEditor()">Cancel</button>
        <button id="sb-run-btn" class="btn btn-ghost" onclick="runValidationFromEditor()" ${isEdit ? '' : 'disabled'}>Run Validation</button>
        <button id="sb-save-btn" class="btn btn-primary" onclick="saveStrategyDraft()">${esc(saveLabel)}</button>
      </div>
    </div>

    <div class="section-title">Metadata</div>
    <div class="card">
      <div class="strategy-editor-grid">
        <div>
          <label class="strategy-editor-label" for="sb-name">Name</label>
          <input type="text" id="sb-name" class="strategy-editor-input" placeholder="New Strategy">
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-strategy-id">Strategy ID</label>
          <input type="text" id="sb-strategy-id" class="strategy-editor-input" placeholder="e.g. wyckoff_accumulation">
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-status">Status</label>
          <select id="sb-status" class="strategy-editor-select">
            <option value="draft">draft</option>
            <option value="testing">testing</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-asset-class">Asset Class</label>
          <select id="sb-asset-class" class="strategy-editor-select" onchange="handleEditorRunAssetClassChange()">
            <option value="stocks">stocks</option>
            <option value="futures">futures</option>
            <option value="options">options</option>
            <option value="forex">forex</option>
            <option value="crypto">crypto</option>
          </select>
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-interval">Interval</label>
          <input type="text" id="sb-interval" class="strategy-editor-input" placeholder="1wk">
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-run-tier">Validation Tier (Run)</label>
          <select id="sb-run-tier" class="strategy-editor-select" onchange="updateEditorRunValidationNote()">
            <option value="tier1">Tier 1 - Kill Test</option>
            <option value="tier1b">Tier 1B - Evidence Expansion</option>
            <option value="tier2">Tier 2 - Core Validation</option>
            <option value="tier3">Tier 3 - Robustness</option>
          </select>
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-run-interval">Validation Interval (Run)</label>
          <select id="sb-run-interval" class="strategy-editor-select" onchange="updateEditorRunValidationNote()">
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
            <option value="1wk">1wk</option>
            <option value="1mo">1mo</option>
          </select>
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-run-date-start">Validation Start Date</label>
          <input type="date" id="sb-run-date-start" class="strategy-editor-input" value="2020-01-01">
        </div>
        <div>
          <label class="strategy-editor-label" for="sb-run-date-end">Validation End Date</label>
          <input type="date" id="sb-run-date-end" class="strategy-editor-input">
        </div>
        <div class="strategy-editor-span-full">
          <div id="sb-run-note" class="strategy-editor-status" style="margin-top:0;"></div>
        </div>
        <div class="strategy-editor-span-full">
          <label class="strategy-editor-label" for="sb-description">Description</label>
          <textarea id="sb-description" class="strategy-editor-textarea" placeholder="Describe strategy thesis and intent"></textarea>
        </div>
      </div>
    </div>

    <div class="section-title">Strategy Copilot Draft</div>
    <div class="card">
      <label class="strategy-editor-label" for="sb-prompt">AI Prompt</label>
      <div style="display:flex;gap:var(--space-8);align-items:center;">
        <input type="text" id="sb-prompt" class="strategy-editor-input" placeholder="Describe your idea. Example: Wyckoff RDP, conservative risk, options scale-out.">
        <button class="btn btn-ghost" onclick="generateDraftFromPrompt()">Generate Draft</button>
      </div>
    </div>

    <div class="section-title">Structure Config</div>
    <div class="card"><textarea id="sb-structure-json" class="strategy-editor-json"></textarea></div>

    <div class="section-title">Setup Config</div>
    <div class="card"><textarea id="sb-setup-json" class="strategy-editor-json"></textarea></div>

    <div class="section-title">Entry + Risk + Exit</div>
    <div class="card"><textarea id="sb-entry-risk-exit-json" class="strategy-editor-json"></textarea></div>

    <div class="section-title">Costs + Execution + Universe</div>
    <div class="card"><textarea id="sb-cost-exec-universe-json" class="strategy-editor-json"></textarea></div>

    <div class="strategy-editor-actions">
      <button id="sb-apply-status-btn" class="btn btn-ghost" onclick="applyStrategyStatus()" style="${applyStyle}">Apply Status to Current Version</button>
      <button class="btn btn-ghost" onclick="syncFromFormToJson()">Update JSON</button>
      <button class="btn btn-ghost" onclick="syncFromJsonToForm()">Load JSON to Form</button>
    </div>
    <div id="sb-status-msg" class="strategy-editor-status"></div>
    <textarea id="sb-json" class="strategy-editor-hidden"></textarea>
  `;

  document.getElementById('sb-prompt').value = '';
  document.getElementById('sb-name').value = strategy.name || '';
  document.getElementById('sb-strategy-id').value = strategy.strategy_id || '';
  document.getElementById('sb-status').value = normalizeEditableStrategyStatus(strategy.status);
  document.getElementById('sb-asset-class').value = normalizeAssetClass(strategy.asset_class, 'stocks');
  document.getElementById('sb-interval').value = strategy.interval || '1wk';
  const savedRunSettings = loadRunSettings(strategy?.strategy_version_id);
  const defaultRunInterval = normalizeValidationInterval(strategy.interval || '1wk', '1wk');
  document.getElementById('sb-run-tier').value = String(savedRunSettings?.tier || 'tier1');
  document.getElementById('sb-run-interval').value = normalizeValidationInterval(savedRunSettings?.interval || defaultRunInterval, defaultRunInterval);
  document.getElementById('sb-run-date-start').value = String(savedRunSettings?.date_start || '2020-01-01');
  document.getElementById('sb-run-date-end').value = String(savedRunSettings?.date_end || new Date().toISOString().slice(0, 10));
  document.getElementById('sb-description').value = strategy.description || '';
  document.getElementById('sb-structure-json').value = json(strategy.structure_config || {});
  document.getElementById('sb-setup-json').value = json(strategy.setup_config || {});
  document.getElementById('sb-entry-risk-exit-json').value = json({
    entry_config: strategy.entry_config || {},
    risk_config: strategy.risk_config || {},
    exit_config: strategy.exit_config || {},
  });
  document.getElementById('sb-cost-exec-universe-json').value = json({
    cost_config: strategy.cost_config || {},
    execution_config: strategy.execution_config || {},
    universe: strategy.universe || [],
  });
  document.getElementById('sb-json').value = JSON.stringify(strategy, null, 2);
  void loadRunTierConfig(document.getElementById('sb-asset-class').value).then(() => {
    updateEditorRunValidationNote();
  });
  setStrategyEditorStatus('Ready. Edit metadata and config JSON, then save.');
}

function cancelStrategyEditor() {
  if (selectedStrategy) {
    renderStrategyDetails();
    return;
  }
  const container = document.getElementById('strategy-details');
  if (container) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#9881;</div><div>Select a strategy to inspect details</div></div>`;
  }
}

async function generateDraftFromPrompt() {
  const prompt = document.getElementById('sb-prompt').value.trim();
  if (!prompt) {
    alert('Enter a prompt first.');
    return;
  }

  // Show loading state
  const btn = document.querySelector('[onclick="generateDraftFromPrompt()"]');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Generating...';
    btn.disabled = true;
  }
  setStrategyEditorStatus('AI is generating your strategy draft...', false);

  try {
    const draft = await apiPostAbsolute('/api/strategies/generate-draft', { prompt });
    document.getElementById('sb-json').value = JSON.stringify(draft, null, 2);
    syncFromJsonToForm();
    setStrategyEditorStatus('Draft generated by AI. Review all sections, then save as new version.', false);

    // Also add a message to the co-pilot chat about what was generated
    if (typeof strategyChatMessages !== 'undefined' && Array.isArray(strategyChatMessages)) {
      strategyChatMessages.push({
        sender: 'ai',
        text: `**Draft generated from your prompt:**\n\n"${prompt}"\n\n` +
          `- **Name**: ${draft.name || 'Unnamed'}\n` +
          `- **Pattern**: ${draft.setup_config?.pattern_type || 'N/A'}\n` +
          `- **Interval**: ${draft.interval || 'N/A'}\n` +
          `- **Direction**: ${draft.trade_direction || 'long'}\n` +
          `- **Stop**: ${draft.risk_config?.stop_type || 'N/A'} at ${draft.risk_config?.stop_level || 'N/A'}\n\n` +
          `Review each section carefully. Ask me about risk gaps or test plans when ready.`
      });
      if (typeof renderStrategyChat === 'function') renderStrategyChat();
    }
  } catch (err) {
    setStrategyEditorStatus(`Draft generation failed: ${err.message}`, true);
    alert('Draft generation failed: ' + err.message);
  } finally {
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

function syncFromFormToJson() {
  let base = {};
  try {
    base = JSON.parse(document.getElementById('sb-json').value || '{}');
  } catch {}

  try {
    const structureConfig = parseEditorJson('sb-structure-json', 'Structure Config');
    const setupConfig = parseEditorJson('sb-setup-json', 'Setup Config');
    const entryRiskExitConfig = parseEditorJson('sb-entry-risk-exit-json', 'Entry + Risk + Exit');
    const costExecUniverseConfig = parseEditorJson('sb-cost-exec-universe-json', 'Costs + Execution + Universe');

    const merged = {
      ...base,
      name: document.getElementById('sb-name').value.trim(),
      strategy_id: document.getElementById('sb-strategy-id').value.trim(),
      status: normalizeEditableStrategyStatus(document.getElementById('sb-status').value),
      asset_class: normalizeAssetClass(document.getElementById('sb-asset-class').value, 'stocks'),
      interval: document.getElementById('sb-interval').value.trim() || '1wk',
      description: document.getElementById('sb-description').value.trim(),
      structure_config: structureConfig,
      setup_config: setupConfig,
      entry_config: entryRiskExitConfig.entry_config || {},
      risk_config: entryRiskExitConfig.risk_config || {},
      exit_config: entryRiskExitConfig.exit_config || {},
      cost_config: costExecUniverseConfig.cost_config || {},
      execution_config: costExecUniverseConfig.execution_config || {},
      universe: normalizeUniverse(costExecUniverseConfig.universe),
    };

    document.getElementById('sb-json').value = JSON.stringify(merged, null, 2);
    setStrategyEditorStatus('JSON updated from editor fields. Changes are local until you click save.');
    return true;
  } catch (err) {
    setStrategyEditorStatus(err.message || 'Could not update JSON.', true);
    alert(err.message || 'Could not update JSON.');
    return false;
  }
}

function syncFromJsonToForm() {
  try {
    const s = JSON.parse(document.getElementById('sb-json').value || '{}');
    document.getElementById('sb-name').value = s.name || '';
    document.getElementById('sb-strategy-id').value = s.strategy_id || '';
    document.getElementById('sb-status').value = s.status || 'draft';
    document.getElementById('sb-asset-class').value = normalizeAssetClass(s.asset_class, 'stocks');
    document.getElementById('sb-interval').value = s.interval || '1wk';
    document.getElementById('sb-description').value = s.description || '';
    document.getElementById('sb-structure-json').value = json(s.structure_config || {});
    document.getElementById('sb-setup-json').value = json(s.setup_config || {});
    document.getElementById('sb-entry-risk-exit-json').value = json({
      entry_config: s.entry_config || {},
      risk_config: s.risk_config || {},
      exit_config: s.exit_config || {},
    });
    document.getElementById('sb-cost-exec-universe-json').value = json({
      cost_config: s.cost_config || {},
      execution_config: s.execution_config || {},
      universe: s.universe || [],
    });
    setStrategyEditorStatus('Editor fields refreshed from raw JSON.');
  } catch (err) {
    setStrategyEditorStatus(`Invalid JSON: ${err.message}`, true);
    alert('Invalid JSON: ' + err.message);
  }
}

async function saveStrategyDraft() {
  if (!syncFromFormToJson()) return;

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
  payload.status = normalizeEditableStrategyStatus(payload.status);
  payload.asset_class = normalizeAssetClass(payload.asset_class, '');
  if (!payload.asset_class) {
    delete payload.asset_class;
  }

  try {
    // Always create a new version to preserve the original.
    delete payload.strategy_version_id;
    delete payload.version;
    const created = await apiPostAbsolute('/api/strategies', payload);
    await loadStrategies();
    selectedStrategy = strategies.find(s => s.strategy_version_id === created.strategy_version_id) || selectedStrategy;
    if (selectedStrategy) {
      selectStrategy(selectedStrategy.strategy_version_id);
    } else {
      renderStrategyList();
      renderStrategyDetails();
    }
    setStrategyEditorStatus(`Saved as ${created.strategy_version_id}`, false);
    alert(`Saved as new version: ${created.strategy_version_id}`);
  } catch (err) {
    setStrategyEditorStatus(`Save failed: ${err.message}`, true);
    alert('Save failed: ' + err.message);
  }
}

function normalizeUniverse(input) {
  if (Array.isArray(input)) {
    return input.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return [];
}

function parseEditorJson(fieldId, label) {
  const el = document.getElementById(fieldId);
  const raw = (el?.value || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (err) {
    throw new Error(`${label} has invalid JSON: ${err.message}`);
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
    if (selectedStrategy) selectStrategy(selectedStrategy.strategy_version_id);
    setStrategyEditorStatus(`Status updated to ${newStatus} on ${selectedStrategy.strategy_version_id}.`);
  } catch (err) {
    setStrategyEditorStatus(`Status update failed: ${err.message}`, true);
    alert('Status update failed: ' + err.message);
  }
}

function json(v) {
  try { return JSON.stringify(v == null ? null : v, null, 2); } catch { return String(v); }
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.selectStrategy = selectStrategy;
window.openStrategyEditor = openStrategyEditor;
window.cancelStrategyEditor = cancelStrategyEditor;
window.generateDraftFromPrompt = generateDraftFromPrompt;
window.syncFromFormToJson = syncFromFormToJson;
window.syncFromJsonToForm = syncFromJsonToForm;
window.saveStrategyDraft = saveStrategyDraft;
window.applyStrategyStatus = applyStrategyStatus;
window.sendStrategyChat = sendStrategyChat;
window.autoResizeStrategyChatInput = autoResizeStrategyChatInput;
window.handleStrategyChatKeydown = handleStrategyChatKeydown;
window.askStrategySummary = askStrategySummary;
window.askStrategyRisks = askStrategyRisks;
window.askStrategyTests = askStrategyTests;
window.openRunValidationFromEditor = openRunValidationFromEditor;
window.runValidationFromEditor = runValidationFromEditor;
window.updateEditorRunValidationNote = updateEditorRunValidationNote;
window.handleEditorRunAssetClassChange = handleEditorRunAssetClassChange;
window.openValidatorSymbolLibraryPage = openValidatorSymbolLibraryPage;
window.toggleStrategyList = toggleStrategyList;

function toggleStrategyList() {
  const panel  = document.getElementById('strategy-left-panel');
  const layout = document.getElementById('strategy-layout');
  const btn    = document.getElementById('strategy-left-toggle-btn');
  if (!panel || !layout) return;
  const collapsed = panel.classList.toggle('collapsed');
  layout.classList.toggle('list-collapsed', collapsed);
  if (btn) {
    btn.textContent = collapsed ? '›' : '‹';
    btn.title = collapsed ? 'Expand strategies panel' : 'Collapse strategies panel';
  }
}
