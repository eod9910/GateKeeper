/**
 * Parameter Sweep — Frontend Logic
 */

const API = '/api';
let selectedPreset = null;
let customValues = [];
let activeSweepId = null;
let pollTimer = null;
const strategyCatalog = new Map();
const sweepReportCache = new Map();
let sweepSummaryCache = [];
const ACTIVE_SWEEP_STORAGE_KEY = 'activeSweepId';
let selectedSweepReportId = null;
let selectedSweepVariantId = null;
const selectedComparisonVariantIds = new Set();
let activeSweepReferenceKey = null;
let activeSweepReferenceReportId = null;
let activeConfiguredStrategyVersionId = null;

const ANATOMY_GROUPS = [
  { key: 'structure', label: 'Structure' },
  { key: 'location', label: 'Location' },
  { key: 'entry_timing', label: 'Entry Timing' },
  { key: 'pattern_gate', label: 'Regime Filter' },
  { key: 'stop_loss', label: 'Stop Loss' },
  { key: 'take_profit', label: 'Take Profit' },
  { key: 'risk_controls', label: 'Risk Controls' },
];

const PRESET_DEFS = {
  stop_type: {
    label: 'Stop Type',
    anatomy: 'stop_loss',
    param_path: 'risk_config.stop_type',
    values: ['percentage', 'atr_multiple', 'atr', 'swing_low'],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.stop_type'),
  },
  atr_multiplier: {
    label: 'ATR Multiplier',
    anatomy: 'stop_loss',
    param_path: 'risk_config.atr_multiplier',
    values: [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.atr_multiplier'),
  },
  stop_pct: {
    label: 'Stop %',
    anatomy: 'stop_loss',
    param_path: 'risk_config.stop_value',
    values: [0.03, 0.05, 0.08, 0.10, 0.12, 0.15],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.stop_value'),
  },
  take_profit_r: {
    label: 'Take Profit R',
    anatomy: 'take_profit',
    param_path: 'risk_config.take_profit_R',
    values: [1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 8.0, 10.0, 14.0],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.take_profit_R'),
  },
  max_hold_bars: {
    label: 'Max Hold Bars',
    anatomy: 'take_profit',
    param_path: 'risk_config.max_hold_bars',
    values: [13, 26, 39, 52, 60, 75, 90],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.max_hold_bars'),
  },
  entry_confirmation_bars: {
    label: 'Confirmation Bars',
    anatomy: 'entry_timing',
    param_path: 'entry_config.confirmation_bars',
    values: [1, 2, 3, 4, 5],
    isAvailable: strategy => hasNestedValue(strategy, 'entry_config.confirmation_bars'),
  },
  entry_breakout_pct: {
    label: 'Breakout % Above',
    anatomy: 'entry_timing',
    param_path: 'entry_config.breakout_pct_above',
    values: [0.0, 0.0025, 0.005, 0.0075, 0.01, 0.015],
    isAvailable: strategy => hasNestedValue(strategy, 'entry_config.breakout_pct_above'),
  },
  rsi_oversold: {
    label: 'RSI Oversold Level',
    anatomy: 'entry_timing',
    resolve: strategy => {
      const path = findCompositeStageParamPath(strategy, stage =>
        String(stage?.id || '').toLowerCase().includes('timing') &&
        hasNestedValue(stage, 'params.oversold_level')
      , 'oversold_level');
      return path ? { param_path: path, values: [20, 25, 30, 35, 40] } : null;
    },
  },
  rdp_epsilon: {
    label: 'RDP Epsilon %',
    anatomy: 'structure',
    param_path: 'structure_config.swing_epsilon_pct',
    values: [0.01, 0.02, 0.03, 0.05, 0.07, 0.10, 0.15],
    isAvailable: strategy => hasNestedValue(strategy, 'structure_config.swing_epsilon_pct'),
  },
  location_retracement_min: {
    label: 'Min Retracement',
    anatomy: 'location',
    param_path: 'setup_config.pullback_retracement_min',
    values: [0.2, 0.25, 0.3, 0.35, 0.4],
    isAvailable: strategy => hasNestedValue(strategy, 'setup_config.pullback_retracement_min'),
  },
  location_retracement_max: {
    label: 'Max Retracement',
    anatomy: 'location',
    param_path: 'setup_config.pullback_retracement_max',
    values: [0.8, 1.0, 1.2, 1.4],
    isAvailable: strategy => hasNestedValue(strategy, 'setup_config.pullback_retracement_max'),
  },
  pattern_gate_required_regime: {
    label: 'Required Regime',
    anatomy: 'pattern_gate',
    resolve: strategy => {
      const path = findCompositeStageParamPath(strategy, stage => {
        const id = String(stage?.id || '').toLowerCase();
        const patternId = String(stage?.pattern_id || '').toLowerCase();
        return (id.includes('regime') || id.includes('gate') || patternId.includes('regime') || patternId.includes('filter'))
          && hasNestedValue(stage, 'params.required_regime');
      }, 'required_regime');
      return path ? { param_path: path, values: ['expansion', 'neutral', 'contraction'] } : null;
    },
  },
  max_concurrent: {
    label: 'Max Concurrent Positions',
    anatomy: 'risk_controls',
    param_path: 'risk_config.max_concurrent_positions',
    values: [1, 2, 3, 5, 8, 10, 15, 20],
    isAvailable: strategy => hasNestedValue(strategy, 'risk_config.max_concurrent_positions'),
  },
};

const STRATEGY_NATIVE_PRESET_BUILDERS = {
  density_base_detector: strategy => {
    const patternType = String(strategy?.setup_config?.pattern_type || '').toLowerCase();
    if (!patternType.startsWith('density_base_detector_')) return {};
    return {
      density_swing_lookback: {
        label: 'Swing Lookback',
        anatomy: 'structure',
        param_path: 'setup_config.swing_lookback',
        values: [5, 8, 10, 12, 15],
        isAvailable: s => hasNestedValue(s, 'setup_config.swing_lookback'),
      },
      density_swing_lookahead: {
        label: 'Swing Lookahead',
        anatomy: 'structure',
        param_path: 'setup_config.swing_lookahead',
        values: [5, 8, 10, 12, 15],
        isAvailable: s => hasNestedValue(s, 'setup_config.swing_lookahead'),
      },
      density_min_drop_pct: {
        label: 'Min Drop %',
        anatomy: 'structure',
        param_path: 'setup_config.min_drop_pct',
        values: [0.05, 0.06, 0.07, 0.08, 0.10],
        isAvailable: s => hasNestedValue(s, 'setup_config.min_drop_pct'),
      },
      density_min_void_bars: {
        label: 'Min Void Bars',
        anatomy: 'structure',
        param_path: 'setup_config.min_void_bars',
        values: [4, 6, 8, 10, 12],
        isAvailable: s => hasNestedValue(s, 'setup_config.min_void_bars'),
      },
      density_min_base_bars: {
        label: 'Min Base Bars',
        anatomy: 'structure',
        param_path: 'setup_config.min_base_bars',
        values: [3, 4, 5, 6, 7],
        isAvailable: s => hasNestedValue(s, 'setup_config.min_base_bars'),
      },
      density_min_score: {
        label: 'Min Score',
        anatomy: 'structure',
        param_path: 'setup_config.min_score',
        values: [0.15, 0.20, 0.25, 0.30, 0.35],
        isAvailable: s => hasNestedValue(s, 'setup_config.min_score'),
      },
    };
  },
};

function hasNestedValue(target, path) {
  if (!target || !path) return false;
  const segments = String(path).split('.');
  let current = target;
  for (const segment of segments) {
    if (current == null) return false;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return current !== undefined;
}

function getCompositeStages(strategy) {
  return Array.isArray(strategy?.setup_config?.composite_spec?.stages)
    ? strategy.setup_config.composite_spec.stages
    : [];
}

function findCompositeStageParamPath(strategy, predicate, paramName) {
  const stages = getCompositeStages(strategy);
  const idx = stages.findIndex(stage => predicate(stage));
  if (idx < 0) return '';
  return `setup_config.composite_spec.stages.${idx}.params.${paramName}`;
}

function getConfiguredStrategyVersionId() {
  return String(activeConfiguredStrategyVersionId || document.getElementById('sweep-strategy-select')?.value || '').trim();
}

function getSelectedStrategySpec() {
  const strategyVersionId = getConfiguredStrategyVersionId();
  return strategyCatalog.get(strategyVersionId) || null;
}

function normalizeAnatomyKey(anatomy) {
  const key = String(anatomy || '').trim().toLowerCase();
  if (!key) return 'risk_controls';
  if (key === 'regime_filter') return 'pattern_gate';
  return key;
}

function getManifestPresetDefs(strategy = getSelectedStrategySpec()) {
  const defs = {};
  const manifest = Array.isArray(strategy?.parameter_manifest) ? strategy.parameter_manifest : [];
  manifest.forEach(item => {
    if (!item?.key || !item?.path || item?.sweep_enabled !== true) return;
    defs[item.key] = {
      label: item.label || item.key,
      anatomy: normalizeAnatomyKey(item.anatomy),
      param_path: item.path,
      values: Array.isArray(item.suggested_values) ? item.suggested_values : [],
      isAvailable: s => hasNestedValue(s, item.path),
      description: item.description || '',
      manifest_item: item,
    };
  });
  return defs;
}

function getStrategyNativePresetDefs(strategy = getSelectedStrategySpec()) {
  const defs = { ...getManifestPresetDefs(strategy) };
  Object.values(STRATEGY_NATIVE_PRESET_BUILDERS).forEach(build => {
    Object.entries(build(strategy) || {}).forEach(([key, value]) => {
      if (!defs[key]) defs[key] = value;
    });
  });
  return defs;
}

function resolvePresetDef(presetKey, strategy = getSelectedStrategySpec()) {
  const preset = getStrategyNativePresetDefs(strategy)[presetKey] || PRESET_DEFS[presetKey];
  if (!preset) return null;

  let resolved = null;
  if (typeof preset.resolve === 'function') {
    resolved = preset.resolve(strategy);
  } else if (!preset.isAvailable || preset.isAvailable(strategy)) {
    resolved = { param_path: preset.param_path, values: preset.values };
  }

  if (!resolved || !resolved.param_path) return null;
  return {
    ...preset,
    ...resolved,
    anatomy: normalizeAnatomyKey(preset.anatomy || 'risk_controls'),
  };
}

function getPresetEntries(strategy = getSelectedStrategySpec()) {
  const allPresetDefs = { ...PRESET_DEFS, ...getStrategyNativePresetDefs(strategy) };
  return Object.keys(allPresetDefs)
    .map(key => [key, resolvePresetDef(key, strategy)])
    .filter(([, preset]) => Boolean(preset));
}

function getAnatomyDefinitionSummary(strategy = getSelectedStrategySpec()) {
  const stages = getCompositeStages(strategy);
  const hasLocationStage = stages.some(stage => {
    const id = String(stage?.id || '').toLowerCase();
    const patternId = String(stage?.pattern_id || '').toLowerCase();
    return id.includes('location') || patternId.includes('location') || patternId.includes('fib_location');
  });
  const hasPatternGateStage = stages.some(stage => {
    const id = String(stage?.id || '').toLowerCase();
    const patternId = String(stage?.pattern_id || '').toLowerCase();
    return id.includes('regime') || id.includes('gate') || patternId.includes('regime') || patternId.includes('filter') || patternId.includes('state');
  });
  const hasTimingStage = stages.some(stage => {
    const id = String(stage?.id || '').toLowerCase();
    const patternId = String(stage?.pattern_id || '').toLowerCase();
    return id.includes('timing') || patternId.includes('trigger') || patternId.includes('divergence');
  });

  return [
    { key: 'structure', label: 'Structure', present: Boolean(strategy?.structure_config), optional: false },
    { key: 'location', label: 'Location', present: hasLocationStage || hasNestedValue(strategy, 'setup_config.pullback_retracement_min') || hasNestedValue(strategy, 'setup_config.pullback_retracement_max'), optional: false },
    { key: 'entry_timing', label: 'Entry Timing', present: hasTimingStage || Boolean(strategy?.entry_config), optional: false },
    { key: 'pattern_gate', label: 'Regime Filter', present: hasPatternGateStage, optional: true },
    { key: 'stop_loss', label: 'Stop Loss', present: Boolean(strategy?.risk_config?.stop_type), optional: false },
    { key: 'take_profit', label: 'Take Profit', present: hasNestedValue(strategy, 'risk_config.take_profit_R') || Boolean(strategy?.exit_config), optional: false },
  ];
}

function renderStrategyAnatomy() {
  const container = document.getElementById('strategy-anatomy');
  if (!container) return;
  const strategy = getSelectedStrategySpec();
  if (!strategy) {
    container.innerHTML = '<div class="text-muted">Choose a strategy to see its anatomy: structure, location, entry timing, stop loss, take profit, and optional regime filter.</div>';
    return;
  }

  const availableCounts = new Map();
  for (const [, preset] of getPresetEntries(strategy)) {
    const key = preset.anatomy || 'risk_controls';
    availableCounts.set(key, (availableCounts.get(key) || 0) + 1);
  }

  const cards = getAnatomyDefinitionSummary(strategy).map(item => {
    const count = availableCounts.get(item.key) || 0;
    const classes = ['anatomy-chip'];
    if (item.present) classes.push('present');
    if (item.optional) classes.push('optional');
    const detail = item.present
      ? `${count} sweep knob${count === 1 ? '' : 's'}`
      : (item.optional ? 'optional / not used' : 'not explicit in this spec');
    return `
      <div class="${classes.join(' ')}">
        <div class="anatomy-chip-label">${reportEscHtml(item.label)}</div>
        <div class="anatomy-chip-meta">${reportEscHtml(detail)}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="anatomy-summary-label">Strategy Anatomy</div>
    <div class="anatomy-chip-grid">${cards}</div>
  `;
}

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  restoreSweepConfigPanelState();
  configureSweepTierSelector();
  await loadStrategyCatalog();
  await loadStrategies();
  await loadRecentSweeps();
  setupPresetButtons();
  setupCustomParameterPicker();
  setupAddValueOnEnter();
  await restoreActiveSweepFromState();
});

function toggleSweepConfigPanel(forceCollapsed = null) {
  const layout = document.querySelector('.sweep-layout');
  const panel = document.getElementById('sweep-config-panel');
  const label = document.getElementById('sweep-config-label');
  const toggle = document.getElementById('sweep-config-toggle');
  if (!layout || !panel || !toggle) return;

  const nextCollapsed = forceCollapsed == null
    ? !layout.classList.contains('config-collapsed')
    : Boolean(forceCollapsed);

  layout.classList.toggle('config-collapsed', nextCollapsed);
  panel.classList.toggle('collapsed', nextCollapsed);
  if (label) label.style.display = nextCollapsed ? 'none' : '';
  toggle.textContent = nextCollapsed ? '»' : '«';
  toggle.title = nextCollapsed ? 'Expand configuration' : 'Collapse configuration';
  window.localStorage.setItem('sweepConfigCollapsed', nextCollapsed ? '1' : '0');
}

function restoreSweepConfigPanelState() {
  const stored = window.localStorage.getItem('sweepConfigCollapsed');
  if (stored === '1') {
    toggleSweepConfigPanel(true);
  }
}

function getRequestedSweepId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = String(params.get('sweep') || '').trim();
    if (fromQuery) return fromQuery;
  } catch {}
  return String(window.localStorage.getItem(ACTIVE_SWEEP_STORAGE_KEY) || '').trim();
}

function getLatestRunningSweepId(sweeps = []) {
  const running = (Array.isArray(sweeps) ? sweeps : [])
    .filter(sweep => String(sweep?.status || '').toLowerCase() === 'running');
  if (!running.length) return '';
  running.sort((a, b) => {
    const aTime = new Date(a?.started_at || a?.created_at || a?.updated_at || 0).getTime();
    const bTime = new Date(b?.started_at || b?.created_at || b?.updated_at || 0).getTime();
    return bTime - aTime;
  });
  return String(running[0]?.sweep_id || '').trim();
}

function persistActiveSweepId(sweepId = '') {
  const value = String(sweepId || '').trim();
  if (value) {
    window.localStorage.setItem(ACTIVE_SWEEP_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(ACTIVE_SWEEP_STORAGE_KEY);
  }
}

async function restoreActiveSweepFromState() {
  const requestedSweepId = getRequestedSweepId();
  const sweeps = await fetchSweepSummaries(true).catch(() => []);
  const fallbackRunningSweepId = getLatestRunningSweepId(sweeps);

  if (requestedSweepId) {
    const restored = await loadSweepInternal(requestedSweepId, { persist: false });
    if (restored) return;
  }

  if (fallbackRunningSweepId && fallbackRunningSweepId !== requestedSweepId) {
    await loadSweepInternal(fallbackRunningSweepId, { persist: true });
  }
}

function configureSweepTierSelector() {
  const tierSelect = document.getElementById('sweep-tier-select');
  if (tierSelect) {
    const strategy = getSelectedStrategySpec();
    const stage = String(strategy?.sweep_stage || '').toLowerCase();
    if (stage === 'tier3') {
      tierSelect.innerHTML = `
        <option value="tier3" selected>Tier 3 - Holdout robustness check</option>
      `;
    } else {
      tierSelect.innerHTML = `
        <option value="tier2" selected>Tier 2 - Sweep on core validation universe</option>
      `;
    }
  }

  const strategySelect = document.getElementById('sweep-strategy-select');
  if (strategySelect && strategySelect.parentElement && !document.getElementById('sweep-strategy-note')) {
    const note = document.createElement('div');
    note.id = 'sweep-strategy-note';
    note.className = 'text-muted';
    note.style.marginTop = 'var(--space-8)';
    note.style.fontSize = 'var(--text-caption)';
    note.textContent = 'Sweep shows only T2, T2R, and separate T3 baselines.';
    strategySelect.parentElement.appendChild(note);
  }
}

function setupAddValueOnEnter() {
  document.getElementById('add-value-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomValue();
  });
  document.getElementById('custom-param-path').addEventListener('input', e => {
    setCustomParameterPickerValue(findPresetKeyByPath(e.target.value));
    updateSelectedSummary();
    updateRunButton();
  });
  document.getElementById('custom-param-label').addEventListener('input', () => {
    updateSelectedSummary();
    updateRunButton();
  });
}

// ─── Strategy loading ──────────────────────────────────────────────────────────

async function loadStrategies() {
  try {
    const res = await fetch(`${API}/sweep/strategies/list`);
    const data = await res.json();
    const select = document.getElementById('sweep-strategy-select');
    const currentValue = select.value;
    select.innerHTML = '<option value="">— Select a strategy —</option>';

    const items = data.data || [];
    const groups = {
      candidates: items.filter(s => s.sweep_stage === 'tier2' || s.sweep_stage === 'tier2r'),
      baselines: items.filter(s => s.sweep_stage === 'tier3'),
    };

    const addGroup = (label, strategies) => {
      if (strategies.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = label;
      strategies.forEach(s => {
        const existing = strategyCatalog.get(s.strategy_version_id) || {};
        strategyCatalog.set(s.strategy_version_id, { ...existing, ...s });
        const opt = document.createElement('option');
        opt.value = s.strategy_version_id;
        const badge = String(s.sweep_stage || '').toUpperCase();
        opt.textContent = `${s.name} (${s.interval || '?'}) [${badge}]`;
        opt.title = s.sweep_stage_title || '';
        group.appendChild(opt);
      });
      select.appendChild(group);
    };

    addGroup('Tier 2 Sweep Candidates', groups.candidates);
    addGroup('Tier 3 Baselines', groups.baselines);

    if (items.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No T2, T2R, or T3 strategies available';
      opt.disabled = true;
      select.appendChild(opt);
    }

    if (currentValue) {
      select.value = currentValue;
    }

    select.onchange = () => {
      activeConfiguredStrategyVersionId = null;
      configureSweepTierSelector();
      if (selectedPreset && !resolvePresetDef(selectedPreset, getSelectedStrategySpec())) {
        clearPresetSelection();
        customValues = [];
        renderValuePills();
        const pathInput = document.getElementById('custom-param-path');
        const labelInput = document.getElementById('custom-param-label');
        if (pathInput) pathInput.value = '';
        if (labelInput) labelInput.value = '';
      }
      renderStrategyAnatomy();
      setupCustomParameterPicker();
      updateSelectedSummary();
      updateRunButton();
    };
    renderStrategyAnatomy();
    setupCustomParameterPicker();
  } catch (e) {
    console.error('Failed to load strategies', e);
  }
}

// ─── Presets ───────────────────────────────────────────────────────────────────

async function loadStrategyCatalog() {
  try {
    const res = await fetch(`${API}/validator/strategies`);
    const data = await res.json();
    (data.data || []).forEach(strategy => {
      if (strategy?.strategy_version_id) {
        strategyCatalog.set(strategy.strategy_version_id, strategy);
      }
    });
  } catch (e) {
    console.error('Failed to load strategy catalog', e);
  }
}

async function ensureStrategySpec(strategyVersionId) {
  const id = String(strategyVersionId || '').trim();
  if (!id) return null;

  const existing = strategyCatalog.get(id);
  if (existing && (existing.structure_config || existing.setup_config || existing.risk_config || existing.entry_config || existing.exit_config)) {
    return existing;
  }

  try {
    const res = await fetch(`${API}/strategies/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (data?.success && data?.data?.strategy_version_id) {
      const merged = { ...(existing || {}), ...data.data };
      strategyCatalog.set(id, merged);
      return merged;
    }
  } catch (e) {
    console.error('Failed to load strategy spec', id, e);
  }

  return existing || null;
}

function setupPresetButtons() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (selectedPreset === preset) {
        selectedPreset = null;
        btn.classList.remove('active');
        setCustomParameterPickerValue('');
      } else {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        selectedPreset = preset;
        btn.classList.add('active');
        // Clear custom values since preset is selected
        customValues = [];
        renderValuePills();
        setCustomParameterPickerValue(preset);
      }
      updateSelectedSummary();
      updateRunButton();
    });
  });
}

function getCustomParameterSelect() {
  return document.getElementById('custom-param-select');
}

function findPresetKeyByPath(paramPath) {
  const path = String(paramPath || '').trim();
  if (!path) return '';
  return getPresetEntries().find(([, preset]) => preset.param_path === path)?.[0] || '';
}

function setCustomParameterPickerValue(presetKey = '') {
  const select = getCustomParameterSelect();
  if (!select) return;
  select.value = presetKey || '';
  renderSuggestedValueButtons(presetKey || '');
}

function setupCustomParameterPicker() {
  const select = getCustomParameterSelect();
  if (!select) return;

  const entries = getPresetEntries();
  const groupsHtml = ANATOMY_GROUPS.map(group => {
    const options = entries
      .filter(([, preset]) => preset.anatomy === group.key)
      .map(([key, preset]) => `<option value="${key}">${preset.label}</option>`)
      .join('');
    return options ? `<optgroup label="${group.label}">${options}</optgroup>` : '';
  }).join('');

  select.innerHTML = [
    '<option value="">Choose a parameter...</option>',
    groupsHtml,
  ].join('');

  select.onchange = () => {
    const presetKey = select.value;
    if (!presetKey) {
      renderSuggestedValueButtons('');
      return;
    }
    applyCustomParameterPreset(presetKey);
  };

  renderSuggestedValueButtons(select.value || '');
}

function applyCustomParameterPreset(presetKey, options = {}) {
  const preset = resolvePresetDef(presetKey);
  if (!preset) return;

  const { replaceValues = true, keepQuickPreset = false } = options;
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');

  if (!keepQuickPreset) {
    clearPresetSelection();
  }
  if (pathInput) pathInput.value = preset.param_path;
  if (labelInput) labelInput.value = preset.label;
  if (replaceValues) {
    customValues = [...preset.values];
    renderValuePills();
  }
  setCustomParameterPickerValue(presetKey);
  updateSelectedSummary();
  updateRunButton();
}

function renderSuggestedValueButtons(presetKey = '') {
  const container = document.getElementById('suggested-values');
  const help = document.getElementById('custom-param-help');
  if (!container) return;

  const preset = resolvePresetDef(presetKey);
  if (!preset) {
    container.innerHTML = '<span class="text-muted">Pick a parameter to prefill path, label, and suggested values.</span>';
    if (help) help.textContent = 'Advanced mode still accepts any raw JSON path below.';
    return;
  }

  if (help) {
    const anatomyLabel = ANATOMY_GROUPS.find(group => group.key === preset.anatomy)?.label || 'Parameter';
    help.textContent = `${anatomyLabel} • Path: ${preset.param_path}`;
  }

  container.innerHTML = preset.values.map(value => {
    const normalized = String(value);
    const active = customValues.some(item => String(item) === normalized);
    return `<button type="button" class="suggested-value-btn${active ? ' active' : ''}" onclick="toggleSuggestedCustomValue('${reportEscHtml(normalized)}')">${reportEscHtml(normalized)}</button>`;
  }).join('');
}

function toggleSuggestedCustomValue(rawValue) {
  const value = isNaN(Number(rawValue)) ? rawValue : Number(rawValue);
  const existingIndex = customValues.findIndex(item => String(item) === String(value));
  if (existingIndex >= 0) {
    customValues.splice(existingIndex, 1);
  } else {
    customValues.push(value);
  }
  renderValuePills();
  renderSuggestedValueButtons(getCustomParameterSelect()?.value || '');
  updateSelectedSummary();
  updateRunButton();
}

// ─── Custom values ─────────────────────────────────────────────────────────────

function addCustomValue() {
  const input = document.getElementById('add-value-input');
  const raw = input.value.trim();
  if (!raw) return;

  // Try to parse as number, fallback to string
  const val = isNaN(Number(raw)) ? raw : Number(raw);
  if (!customValues.includes(val)) {
    customValues.push(val);
    // Selecting a custom value clears preset
    selectedPreset = null;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    renderValuePills();
    updateSelectedSummary();
    updateRunButton();
  }
  input.value = '';
  input.focus();
}

function removeCustomValue(idx) {
  customValues.splice(idx, 1);
  renderValuePills();
  updateSelectedSummary();
  updateRunButton();
}

function renderValuePills() {
  const container = document.getElementById('values-pills');
  container.innerHTML = '';
  customValues.forEach((v, i) => {
    const pill = document.createElement('span');
    pill.className = 'value-pill';
    pill.innerHTML = `${v} <button onclick="removeCustomValue(${i})" title="Remove">×</button>`;
    container.appendChild(pill);
  });
}

// ─── UI state ──────────────────────────────────────────────────────────────────

function updateSelectedSummary() {
  const summary = document.getElementById('selected-config-summary');
  const text = document.getElementById('selected-config-text');

  if (selectedPreset) {
    const preset = resolvePresetDef(selectedPreset);
    text.textContent = preset ? `${preset.label}: ${preset.values.join(', ')}` : selectedPreset;
    summary.style.display = 'block';
  } else if (customValues.length > 0) {
    const path = document.getElementById('custom-param-path').value.trim();
    const label = document.getElementById('custom-param-label').value.trim() || path;
    text.textContent = `${label}: ${customValues.join(', ')}`;
    summary.style.display = 'block';
  } else {
    summary.style.display = 'none';
  }
}

function updateRunButton() {
  const strategy = getConfiguredStrategyVersionId();
  const hasParam = selectedPreset || (
    customValues.length > 0 &&
    document.getElementById('custom-param-path').value.trim()
  );
  document.getElementById('btn-run-sweep').disabled = !strategy || !hasParam;
}

function clearPresetSelection() {
  selectedPreset = null;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

function setPresetSelection(presetKey) {
  clearPresetSelection();
  selectedPreset = presetKey;
  document.querySelectorAll('.preset-btn').forEach(btn => {
    if (btn.dataset.preset === presetKey) {
      btn.classList.add('active');
    }
  });
}

function valuesMatch(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => String(value) === String(right[index]));
}

function isTooFewTradesOnlyFail(report) {
  if (!report || String(report?.pass_fail || '').toUpperCase() !== 'FAIL') return false;
  const reasons = Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [];
  return reasons.length > 0 && reasons.every((reason) => /too few trades/i.test(String(reason || '')));
}

function getDisplayVerdict(report) {
  const verdict = String(report?.pass_fail || '').toUpperCase();
  if (verdict !== 'FAIL') return verdict || 'N/A';
  return isTooFewTradesOnlyFail(report) ? 'FAIL' : 'HARD_FAIL';
}

function findPresetKeyForParam(param) {
  if (!param?.param_path) return null;
  return getPresetEntries().find(([, preset]) =>
    preset.param_path === param.param_path &&
    valuesMatch(preset.values || [], param.values || [])
  )?.[0] || null;
}

function formatSweepValueSummary(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 'no values saved';
  const shown = values.slice(0, 5).map(value => String(value));
  const suffix = values.length > shown.length ? ` +${values.length - shown.length} more` : '';
  return shown.join(', ') + suffix;
}

function tierLabel(tier) {
  const normalized = String(tier || '').toLowerCase();
  if (normalized === 'tier2') return 'Tier 2';
  if (normalized === 'tier2r') return 'T2R';
  if (normalized === 'tier3') return 'Tier 3';
  if (normalized === 'tier1b') return 'Tier 1B';
  if (normalized === 'tier1') return 'Tier 1';
  return normalized ? normalized.toUpperCase() : 'Tier ?';
}

function getStrategyName(strategyVersionId) {
  return strategyCatalog.get(strategyVersionId)?.name || strategyVersionId;
}

function getStrategyStageLabel(strategyVersionId, fallbackTier) {
  const strategy = strategyCatalog.get(strategyVersionId);
  const stage = String(strategy?.sweep_stage || '').toLowerCase();
  if (stage === 'tier2r') return 'T2R';
  if (stage === 'tier2') return 'Tier 2';
  if (stage === 'tier3') return 'Tier 3';
  return tierLabel(fallbackTier);
}

function getSweepDisplayStrategyId(sweep) {
  return String(sweep?.promoted_strategy_version_id || sweep?.base_strategy_version_id || '').trim();
}

function renderLoadedSweepBanner(sweep = null) {
  const resultsLoadedStrategy = document.getElementById('results-loaded-strategy');
  const resultsSweepId = document.getElementById('results-sweep-id');
  if (!resultsLoadedStrategy || !resultsSweepId) return;
  if (!sweep) {
    resultsLoadedStrategy.textContent = '';
    resultsSweepId.textContent = '';
    return;
  }

  const displayStrategyId = getSweepDisplayStrategyId(sweep);
  const displayStrategyName = getStrategyName(displayStrategyId);
  resultsLoadedStrategy.textContent = displayStrategyName
    ? `Loaded Strategy: ${displayStrategyName}`
    : '';
  resultsSweepId.textContent = sweep.sweep_id
    ? `${sweep.sweep_id} · ${tierLabel(sweep.tier)}`
    : '';
}

function restoreSweepConfig(sweep) {
  const strategySelect = document.getElementById('sweep-strategy-select');
  const tierSelect = document.getElementById('sweep-tier-select');
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');
  const valueInput = document.getElementById('add-value-input');
  const param = sweep?.sweep_params?.[0];
  const restoreStrategyVersionId = getSweepDisplayStrategyId(sweep);

  if (!strategySelect || !tierSelect || !param || !restoreStrategyVersionId) return;

  activeConfiguredStrategyVersionId = restoreStrategyVersionId;
  renderStrategyAnatomy();
  configureSweepTierSelector();
  setupCustomParameterPicker();
  renderLoadedSweepBanner(sweep);

  if (tierSelect.querySelector(`option[value="${sweep.tier}"]`)) {
    tierSelect.value = sweep.tier;
  }

  const presetKey = findPresetKeyForParam(param);
  const pickerKey = presetKey || findPresetKeyByPath(param.param_path);
  if (presetKey) {
    setPresetSelection(presetKey);
    customValues = [];
    if (pathInput) pathInput.value = '';
    if (labelInput) labelInput.value = '';
  } else {
    clearPresetSelection();
    customValues = Array.isArray(param.values) ? [...param.values] : [];
    if (pathInput) pathInput.value = param.param_path || '';
    if (labelInput) labelInput.value = param.label || '';
  }
  setCustomParameterPickerValue(pickerKey);

  if (valueInput) valueInput.value = '';
  renderValuePills();
  updateSelectedSummary();
  updateRunButton();
}

function reportEscHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function reportNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function reportInt(v) {
  return Math.round(reportNum(v));
}

function reportFormatR(value) {
  const n = reportNum(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;
}

function reportFormatPct(value) {
  return `${(reportNum(value) * 100).toFixed(1)}%`;
}

function reportMetricCard(label, value, isPositive) {
  const color = isPositive == null
    ? 'var(--color-text)'
    : isPositive
      ? 'var(--color-positive)'
      : 'var(--color-negative)';
  return `
    <div class="metric-card">
      <div class="metric-label">${reportEscHtml(label)}</div>
      <div class="metric-value" style="color:${color};">${reportEscHtml(String(value ?? 'N/A'))}</div>
    </div>
  `;
}

function renderSweepValidationCriteria(report) {
  const ts = report.trades_summary || {};
  const oos = report.robustness?.out_of_sample || {};
  const wf = report.robustness?.walk_forward || {};
  const mc = report.robustness?.monte_carlo || {};
  const ps = report.robustness?.parameter_sensitivity || {};
  const thr = report.config?.validation_thresholds || {};
  const minTradesPass = reportInt(thr.min_trades_pass || 30);
  const maxOosDeg = reportNum(thr.max_oos_degradation_pct || 50);
  const minWfProf = reportNum(thr.min_wf_profitable_windows || 0.6);
  const maxMcP95 = reportNum(thr.max_mc_p95_dd_pct || 30);
  const maxMcP99 = reportNum(thr.max_mc_p99_dd_pct || 50);
  const maxSens = reportNum(thr.max_sensitivity_score || 40);

  const checks = [
    { label: 'Expectancy R', threshold: '> 0', actual: reportNum(ts.expectancy_R).toFixed(3), ok: reportNum(ts.expectancy_R) > 0 },
    { label: 'Total Trades', threshold: `>= ${minTradesPass}`, actual: reportInt(ts.total_trades), ok: reportInt(ts.total_trades) >= minTradesPass },
    { label: 'OOS Expectancy', threshold: '> 0', actual: reportNum(oos.oos_expectancy).toFixed(3), ok: reportNum(oos.oos_expectancy) > 0 },
    { label: 'OOS Degradation %', threshold: `< ${maxOosDeg}%`, actual: `${reportNum(oos.oos_degradation_pct).toFixed(1)}%`, ok: reportNum(oos.oos_degradation_pct) < maxOosDeg },
    { label: 'WF Profitable Windows %', threshold: `>= ${(minWfProf * 100).toFixed(1)}%`, actual: `${(reportNum(wf.pct_profitable_windows) * 100).toFixed(1)}%`, ok: reportNum(wf.pct_profitable_windows) >= minWfProf },
    { label: 'Monte Carlo p95 DD %', threshold: `< ${maxMcP95}%`, actual: `${reportNum(mc.p95_dd_pct).toFixed(1)}%`, ok: reportNum(mc.p95_dd_pct) < maxMcP95 },
    { label: 'Monte Carlo p99 DD %', threshold: `<= ${maxMcP99}%`, actual: `${reportNum(mc.p99_dd_pct).toFixed(1)}%`, ok: reportNum(mc.p99_dd_pct) <= maxMcP99 },
    { label: 'Sensitivity Score', threshold: `< ${maxSens}`, actual: reportNum(ps.sensitivity_score).toFixed(1), ok: reportNum(ps.sensitivity_score) < maxSens },
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
        <div>${reportEscHtml(c.label)}</div>
        <div class="text-mono">${reportEscHtml(String(c.threshold))}</div>
        <div class="text-mono">${reportEscHtml(String(c.actual))}</div>
        <div><span class="status-badge ${c.ok ? 'approved' : 'rejected'}">${c.ok ? 'pass' : 'fail'}</span></div>
      </div>
    `;
  }

  html += `</div>`;
  return html;
}

function renderSweepReportDetail(report, context = {}) {
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
  const verdict = getDisplayVerdict(r);
  const selectedValue = context.param_value;
  const winnerValue = context.winner_value;

  let html = `
    <div class="sweep-report-shell">
      <div class="sweep-report-header">
        <div class="sweep-report-header-main">
          <div class="section-title" style="margin:0;">Validation Report</div>
          <span class="text-mono" style="font-size:var(--text-caption);color:var(--color-text-subtle);">${reportEscHtml(r.report_id || 'N/A')}</span>
          ${selectedValue != null ? `<span class="tier-badge">Value ${reportEscHtml(String(selectedValue))}</span>` : ''}
          <span class="verdict-badge ${verdict}">${verdict.replace('_', ' ')}</span>
        </div>
        <div class="sweep-report-actions">
          <button class="sweep-inline-btn" onclick="openSweepReportInValidator('${reportEscHtml(r.report_id || '')}')" ${r.report_id ? '' : 'disabled'}>Open In Validator</button>
        </div>
      </div>
  `;

  if (selectedValue != null && winnerValue != null && String(selectedValue) !== String(winnerValue)) {
    html += `
      <div class="sweep-report-subtitle">
        Comparing sweep value <strong>${reportEscHtml(String(selectedValue))}</strong> against winner <strong>${reportEscHtml(String(winnerValue))}</strong>.
      </div>
    `;
  }

  html += `
      <div class="sweep-report-subtitle">
        ${reportEscHtml(cfg.date_start || 'N/A')} &rarr; ${reportEscHtml(cfg.date_end || 'N/A')} &middot;
        ${reportEscHtml(timeframes.join(', ') || cfg.interval || 'N/A')} &middot;
        Tier ${reportEscHtml(String(cfg.validation_tier || 'N/A'))} &middot;
        ${reportEscHtml(String(universe.length))} symbols &middot;
        Costs: $${reportNum(costs.commission_per_trade).toFixed(2)}/trade + ${reportNum(costs.slippage_pct).toFixed(3)}% slippage
      </div>
  `;

  html += `<div class="section-title">Trade Summary</div>`;
  html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('Total Trades', reportInt(ts.total_trades));
  html += reportMetricCard('Win Rate', reportFormatPct(ts.win_rate));
  html += reportMetricCard('Expectancy', reportFormatR(ts.expectancy_R), reportNum(ts.expectancy_R) >= 0);
  html += reportMetricCard('Profit Factor', reportNum(ts.profit_factor).toFixed(2), reportNum(ts.profit_factor) >= 1);
  html += reportMetricCard('W / L', `${reportInt(ts.winners)} / ${reportInt(ts.losers)}`);
  html += `</div>`;

  html += `<div class="section-title">Risk Summary</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('Max DD %', `${reportNum(rs.max_drawdown_pct).toFixed(1)}%`, false);
  html += reportMetricCard('Max DD (R)', reportFormatR(-reportNum(rs.max_drawdown_R)), false);
  html += reportMetricCard('Sharpe', reportNum(rs.sharpe_ratio).toFixed(2), reportNum(rs.sharpe_ratio) >= 1);
  html += reportMetricCard('Calmar', rs.calmar_ratio != null ? reportNum(rs.calmar_ratio).toFixed(2) : 'N/A', reportNum(rs.calmar_ratio) >= 0.5);
  html += `</div>`;

  html += `<div class="section-title">Out-of-Sample</div>`;
  html += `<div class="metrics-grid cols-4" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('IS Expectancy', `${reportFormatR(oos.is_expectancy)} (n=${reportInt(oos.is_n)})`, true);
  html += reportMetricCard('OOS Expectancy', `${reportFormatR(oos.oos_expectancy)} (n=${reportInt(oos.oos_n)})`, reportNum(oos.oos_expectancy) > 0);
  html += reportMetricCard('Degradation', `${reportNum(oos.oos_degradation_pct).toFixed(1)}%`, reportNum(oos.oos_degradation_pct) < reportNum(cfg.validation_thresholds?.max_oos_degradation_pct || 50));
  html += reportMetricCard('Split Date', oos.split_date || 'N/A');
  html += `</div>`;

  html += `<div class="section-title">Walk-Forward Analysis</div>`;
  html += `<div class="metrics-grid cols-3" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('Windows', (wf.windows || []).length);
  html += reportMetricCard('Avg Test Expectancy', reportFormatR(wf.avg_test_expectancy), reportNum(wf.avg_test_expectancy) > 0);
  html += reportMetricCard('% Profitable Windows', `${(reportNum(wf.pct_profitable_windows) * 100).toFixed(1)}%`, reportNum(wf.pct_profitable_windows) >= reportNum(cfg.validation_thresholds?.min_wf_profitable_windows || 0.6));
  html += `</div>`;

  html += `<div class="section-title">Monte Carlo Simulation</div>`;
  html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('Simulations', reportInt(mc.simulations).toLocaleString());
  html += reportMetricCard('Median DD', `${reportNum(mc.median_dd_pct).toFixed(1)}%`, false);
  html += reportMetricCard('p95 DD', `${reportNum(mc.p95_dd_pct).toFixed(1)}%`, reportNum(mc.p95_dd_pct) < reportNum(cfg.validation_thresholds?.max_mc_p95_dd_pct || 30));
  html += reportMetricCard('p99 DD', `${reportNum(mc.p99_dd_pct).toFixed(1)}%`, reportNum(mc.p99_dd_pct) <= reportNum(cfg.validation_thresholds?.max_mc_p99_dd_pct || 50));
  html += reportMetricCard('Median Final R', reportFormatR(mc.median_final_R), true);
  html += `</div>`;

  html += `<div class="section-title">Parameter Sensitivity</div>`;
  html += `<div class="metrics-grid cols-2" style="margin-bottom:var(--space-12);">`;
  html += reportMetricCard('Sensitivity Score', `${reportNum(ps.sensitivity_score).toFixed(1)}/100`, reportNum(ps.sensitivity_score) < reportNum(cfg.validation_thresholds?.max_sensitivity_score || 40));
  html += reportMetricCard('Base Expectancy', reportFormatR(ps.base_expectancy), true);
  html += `</div>`;

  html += `<div class="section-title">Validation Criteria</div>`;
  html += renderSweepValidationCriteria(r);

  html += `<div class="section-title">Pass/Fail Reasons</div>`;
  html += `<ul class="reasons-list">`;
  for (const reason of (r.pass_fail_reasons || [])) {
    html += `<li>${reportEscHtml(reason)}</li>`;
  }
  html += `</ul>`;

  if (universe.length > 0) {
    html += `<div class="section-title">Symbols Tested (${universe.length})</div>`;
    html += `<div style="font-size:var(--text-caption);color:var(--color-text-subtle);line-height:1.7;padding:var(--space-8) 0;border-top:1px solid var(--color-border);">${reportEscHtml(universe.join(', '))}</div>`;
  }

  html += `</div>`;
  return html;
}

async function fetchSweepReport(reportId) {
  if (!reportId) return null;
  if (sweepReportCache.has(reportId)) return sweepReportCache.get(reportId);
  const res = await fetch(`${API}/validator/report/${encodeURIComponent(reportId)}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load report');
  sweepReportCache.set(reportId, data.data);
  return data.data;
}

async function fetchStrategyValidationReports(strategyVersionId) {
  if (!strategyVersionId) return [];
  const res = await fetch(`${API}/validator/reports?strategy_version_id=${encodeURIComponent(strategyVersionId)}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load validator reports');
  const reports = Array.isArray(data.data) ? data.data : [];
  reports.forEach(report => {
    if (report?.report_id) {
      sweepReportCache.set(report.report_id, report);
    }
  });
  return reports;
}

async function fetchSweepSummaries(force = false) {
  if (!force && Array.isArray(sweepSummaryCache) && sweepSummaryCache.length > 0) {
    return sweepSummaryCache;
  }
  const res = await fetch(`${API}/sweep/`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load sweeps');
  sweepSummaryCache = Array.isArray(data.data) ? data.data : [];
  return sweepSummaryCache;
}

async function resolvePromotedBranchReferenceReportId(strategyVersionId) {
  const promotedStrategyVersionId = String(strategyVersionId || '').trim();
  if (!promotedStrategyVersionId) return null;

  const sweeps = await fetchSweepSummaries();
  const parentSweep = sweeps.find(sweep => String(sweep?.promoted_strategy_version_id || '').trim() === promotedStrategyVersionId);
  if (!parentSweep) return null;

  const promotedVariantId = String(parentSweep?.promoted_variant_id || '').trim();
  const promotedVariant = (parentSweep?.variants || []).find(variant => String(variant?.variant_id || '').trim() === promotedVariantId);
  const reportId = String(promotedVariant?.report_id || parentSweep?.winner?.report_id || '').trim();
  if (!reportId) return null;

  await fetchSweepReport(reportId);
  return reportId;
}

function normalizeValidationTier(value) {
  return String(value || '').trim().toLowerCase();
}

async function ensureSweepReferenceReport(sweep) {
  const strategyVersionId = String(sweep?.base_strategy_version_id || '').trim();
  const tier = normalizeValidationTier(sweep?.tier);
  const cacheKey = `${strategyVersionId}:${tier}`;
  if (!strategyVersionId) {
    activeSweepReferenceKey = null;
    activeSweepReferenceReportId = null;
    return null;
  }
  if (activeSweepReferenceKey === cacheKey && activeSweepReferenceReportId) {
    return sweepReportCache.get(activeSweepReferenceReportId) || null;
  }

  const reports = await fetchStrategyValidationReports(strategyVersionId);
  const tierMatched = reports.filter(report => normalizeValidationTier(report?.config?.validation_tier) === tier);
  const candidates = tierMatched.length ? tierMatched : reports;
  candidates.sort((a, b) => {
    const aTime = new Date(a?.completed_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.completed_at || b?.created_at || 0).getTime();
    return bTime - aTime;
  });
  const reference = candidates[0] || null;
  activeSweepReferenceKey = cacheKey;
  activeSweepReferenceReportId = reference?.report_id || null;
  if (reference) return reference;

  const promotedReferenceReportId = await resolvePromotedBranchReferenceReportId(strategyVersionId);
  if (promotedReferenceReportId) {
    activeSweepReferenceReportId = promotedReferenceReportId;
    return sweepReportCache.get(promotedReferenceReportId) || null;
  }

  return null;
}

async function viewSweepReport(reportId, variantId = '') {
  if (!reportId) return;
  selectedSweepReportId = reportId;
  selectedSweepVariantId = variantId || null;
  const panel = document.getElementById('sweep-report-detail');
  if (panel) {
    panel.innerHTML = `<div class="metric-card" style="margin-top:var(--space-16);">Loading report...</div>`;
  }
  try {
    await fetchSweepReport(reportId);
    if (activeSweepId) {
      await fetchAndRenderSweep(activeSweepId);
    }
  } catch (e) {
    if (panel) {
      panel.innerHTML = `<div class="metric-card" style="margin-top:var(--space-16);color:var(--color-negative);">Failed to load report: ${reportEscHtml(e.message || 'Unknown error')}</div>`;
    }
  }
}

function openSweepReportInValidator(reportId) {
  if (!reportId) return;
  window.open(`/validator.html?report_id=${encodeURIComponent(reportId)}`, '_blank');
}

function findSweepVariant(sweep, variantId) {
  return (sweep?.variants || []).find(variant => variant.variant_id === variantId) || null;
}

async function toggleSweepComparison(variantId, reportId = '') {
  if (!variantId) return;
  if (selectedComparisonVariantIds.has(variantId)) {
    selectedComparisonVariantIds.delete(variantId);
  } else {
    if (reportId) {
      await fetchSweepReport(reportId);
    }
    selectedComparisonVariantIds.add(variantId);
  }
  if (activeSweepId) {
    await fetchAndRenderSweep(activeSweepId);
  }
}

async function clearSweepComparison() {
  selectedComparisonVariantIds.clear();
  if (activeSweepId) {
    await fetchAndRenderSweep(activeSweepId);
  }
}

function compareMetricDelta(current, baseline, higherIsBetter = true, isPct = false) {
  const a = Number(current);
  const b = Number(baseline);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { text: 'N/A', color: 'var(--color-text-subtle)' };
  }
  const delta = a - b;
  if (Math.abs(delta) < 0.0001) {
    return { text: 'same', color: 'var(--color-text-subtle)' };
  }
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return {
    text: `${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(isPct ? 1 : 2)}${isPct ? '%' : ''}`,
    color: improved ? 'var(--color-positive)' : 'var(--color-negative)',
  };
}

function renderSweepComparisonPanel(sweep, variants) {
  if (!Array.isArray(variants) || variants.length < 1) return '';

  const referenceReport = activeSweepReferenceReportId ? sweepReportCache.get(activeSweepReferenceReportId) : null;
  const selectedEntries = variants
    .map(variant => ({
      variant,
      report: variant.report_id ? sweepReportCache.get(variant.report_id) : null,
    }))
    .filter(entry => entry.report);

  if (!referenceReport || selectedEntries.length < 1) {
    return `
      <div class="sweep-compare-shell">
        <div class="section-title" style="margin-top:0;">Variant Comparison</div>
        <div class="metric-card">Load completed variant reports and the matching base validator report to compare them side by side.</div>
      </div>
    `;
  }

  const referenceEntry = {
    variant: {
      param_value: 'Original',
      variant_id: 'reference',
      report_id: activeSweepReferenceReportId,
    },
    report: referenceReport,
    isReference: true,
  };

  const rows = [referenceEntry, ...selectedEntries.map(entry => ({ ...entry, isReference: false }))];

  const criteria = [
    {
      key: 'VER',
      title: 'Validator verdict',
      value: entry => getDisplayVerdict(entry.report).replace('_', ' '),
      pass: entry => getDisplayVerdict(entry.report) === 'PASS',
    },
    {
      key: 'EXP',
      title: 'Expectancy R must be > 0',
      value: entry => `${reportNum(entry.report?.trades_summary?.expectancy_R).toFixed(2)}R`,
      pass: entry => reportNum(entry.report?.trades_summary?.expectancy_R) > 0,
    },
    {
      key: 'TT',
      title: 'Total trades must meet threshold',
      value: entry => String(reportInt(entry.report?.trades_summary?.total_trades)),
      pass: entry => {
        const totalTrades = reportInt(entry.report?.trades_summary?.total_trades);
        const threshold = reportInt(entry.report?.config?.validation_thresholds?.min_trades_pass || 30);
        return totalTrades >= threshold;
      },
    },
    {
      key: 'OOSX',
      title: 'Out-of-sample expectancy must be > 0',
      value: entry => `${reportNum(entry.report?.robustness?.out_of_sample?.oos_expectancy).toFixed(2)}R`,
      pass: entry => reportNum(entry.report?.robustness?.out_of_sample?.oos_expectancy) > 0,
    },
    {
      key: 'OOSD',
      title: 'Out-of-sample degradation must stay below threshold',
      value: entry => `${reportNum(entry.report?.robustness?.out_of_sample?.oos_degradation_pct).toFixed(1)}%`,
      pass: entry => {
        const actual = reportNum(entry.report?.robustness?.out_of_sample?.oos_degradation_pct);
        const threshold = reportNum(entry.report?.config?.validation_thresholds?.max_oos_degradation_pct || 50);
        return actual < threshold;
      },
    },
    {
      key: 'WFPW',
      title: 'Walk-forward profitable windows % must meet threshold',
      value: entry => `${(reportNum(entry.report?.robustness?.walk_forward?.pct_profitable_windows) * 100).toFixed(1)}%`,
      pass: entry => {
        const actual = reportNum(entry.report?.robustness?.walk_forward?.pct_profitable_windows);
        const threshold = reportNum(entry.report?.config?.validation_thresholds?.min_wf_profitable_windows || 0.6);
        return actual >= threshold;
      },
    },
    {
      key: 'MC95',
      title: 'Monte Carlo p95 drawdown % must stay below threshold',
      value: entry => `${reportNum(entry.report?.robustness?.monte_carlo?.p95_dd_pct).toFixed(1)}%`,
      pass: entry => {
        const actual = reportNum(entry.report?.robustness?.monte_carlo?.p95_dd_pct);
        const threshold = reportNum(entry.report?.config?.validation_thresholds?.max_mc_p95_dd_pct || 30);
        return actual < threshold;
      },
    },
    {
      key: 'MC99',
      title: 'Monte Carlo p99 drawdown % must stay below hard threshold',
      value: entry => `${reportNum(entry.report?.robustness?.monte_carlo?.p99_dd_pct).toFixed(1)}%`,
      pass: entry => {
        const actual = reportNum(entry.report?.robustness?.monte_carlo?.p99_dd_pct);
        const threshold = reportNum(entry.report?.config?.validation_thresholds?.max_mc_p99_dd_pct || 50);
        return actual <= threshold;
      },
    },
    {
      key: 'SENS',
      title: 'Sensitivity score must stay below threshold',
      value: entry => reportNum(entry.report?.robustness?.parameter_sensitivity?.sensitivity_score).toFixed(1),
      pass: entry => {
        const actual = reportNum(entry.report?.robustness?.parameter_sensitivity?.sensitivity_score);
        const threshold = reportNum(entry.report?.config?.validation_thresholds?.max_sensitivity_score || 40);
        return actual < threshold;
      },
    },
  ];

  let html = `
    <div class="sweep-compare-shell">
      <div class="sweep-compare-header">
        <div>
          <div class="section-title" style="margin:0 0 var(--space-8) 0;">Variant Comparison</div>
          <div class="sweep-compare-subtitle">Reference is the original validator report for ${reportEscHtml(getStrategyName(sweep.base_strategy_version_id))} at ${reportEscHtml(tierLabel(sweep.tier))}. Each selected sweep value appears as a row underneath. Hover the short headers for the full validation-criteria meaning.</div>
        </div>
        <button class="sweep-inline-btn" onclick="clearSweepComparison()">Clear Compare</button>
      </div>
      <div class="sweep-compare-table-wrap">
        <table class="sweep-compare-table">
          <thead>
            <tr>
              <th title="Variant label">Variant</th>
              ${criteria.map(criterion => `<th title="${reportEscHtml(criterion.title)}">${reportEscHtml(criterion.key)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
  `;

  for (const entry of rows) {
    const label = entry.isReference
      ? 'Original Validator'
      : `Value ${reportEscHtml(String(entry.variant.param_value))}`;
    html += `
      <tr class="${entry.isReference ? 'reference-row' : ''}">
        <td class="variant-cell">
          <div class="variant-name">${label}</div>
          <div class="variant-meta">${entry.isReference ? 'Reference' : getDisplayVerdict(entry.report).replace('_', ' ')}</div>
        </td>
        ${criteria.map(criterion => {
          const ok = criterion.pass(entry);
          return `<td class="${ok ? 'pass-cell' : 'fail-cell'}" title="${reportEscHtml(criterion.title)}">${reportEscHtml(criterion.value(entry))}</td>`;
        }).join('')}
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  return html;
}

// ─── Run sweep ─────────────────────────────────────────────────────────────────

async function runSweep() {
  const strategyVersionId = getConfiguredStrategyVersionId();
  if (!strategyVersionId) return;

  const btn = document.getElementById('btn-run-sweep');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const tier = document.getElementById('sweep-tier-select')?.value || 'tier1';
    const body = { strategy_version_id: strategyVersionId, tier };

    if (selectedPreset) {
      body.preset = selectedPreset;
    } else {
      const path = document.getElementById('custom-param-path').value.trim();
      const label = document.getElementById('custom-param-label').value.trim() || path;
      body.sweep_params = [{ label, param_path: path, values: customValues }];
    }

    const res = await fetch(`${API}/sweep/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to start sweep');

  activeSweepId = data.data.sweep_id;
  persistActiveSweepId(activeSweepId);
  selectedComparisonVariantIds.clear();
  selectedSweepReportId = null;
  selectedSweepVariantId = null;
  activeSweepReferenceKey = null;
  activeSweepReferenceReportId = null;
  startPolling(activeSweepId);
  loadRecentSweeps();
  } catch (e) {
    alert(`Failed to start sweep: ${e.message}`);
  } finally {
    btn.textContent = 'Run Sweep';
    updateRunButton();
  }
}

// ─── Cancel sweep ───────────────────────────────────────────────────────────────

async function cancelSweep(sweepId) {
  const btn = document.getElementById('cancel-sweep-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling...'; }
  try {
    const res = await fetch(`${API}/sweep/${sweepId}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    fetchAndRenderSweep(sweepId);
  } catch (e) {
    alert(`Failed to cancel: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel Sweep'; }
  }
}

// ─── Polling ───────────────────────────────────────────────────────────────────

function startPolling(sweepId) {
  if (pollTimer) clearInterval(pollTimer);
  persistActiveSweepId(sweepId);
  renderLoadingState(sweepId);
  pollTimer = setInterval(() => fetchAndRenderSweep(sweepId), 5000);
  fetchAndRenderSweep(sweepId);
}

async function fetchAndRenderSweep(sweepId) {
  try {
    const res = await fetch(`${API}/sweep/${sweepId}`);
    const data = await res.json();
    if (!data.success) {
      if (activeSweepId === sweepId) {
        persistActiveSweepId('');
      }
      return;
    }
    persistActiveSweepId(sweepId);
    renderLoadedSweepBanner(data.data);
    await ensureSweepReferenceReport(data.data);
    renderSweepResults(data.data);
    if (data.data.status === 'completed' || data.data.status === 'failed' || data.data.status === 'cancelled') {
      clearInterval(pollTimer);
      pollTimer = null;
      loadRecentSweeps();
    }
  } catch {}
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function renderLoadingState(sweepId) {
  const resultsLoadedStrategy = document.getElementById('results-loaded-strategy');
  if (resultsLoadedStrategy) {
    const strategyName = getStrategyName(getConfiguredStrategyVersionId());
    resultsLoadedStrategy.textContent = strategyName ? `Loaded Strategy: ${strategyName}` : '';
  }
  document.getElementById('results-sweep-id').textContent = sweepId;
  document.getElementById('results-body').innerHTML = `
    <div class="sweep-progress">
      <div class="sweep-progress-bar-track"><div class="sweep-progress-bar-fill" style="width:5%"></div></div>
      <span class="sweep-progress-label">Starting sweep...</span>
    </div>
  `;
}

function renderSweepResults(sweep) {
  const currentVariantIds = new Set((sweep.variants || []).map(variant => variant.variant_id));
  for (const variantId of [...selectedComparisonVariantIds]) {
    if (!currentVariantIds.has(variantId)) {
      selectedComparisonVariantIds.delete(variantId);
    }
  }

  document.getElementById('results-sweep-id').textContent = sweep.sweep_id;

  const completed = sweep.variants.filter(v => v.status === 'completed').length;
  const total = sweep.variants.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const progressLabel = sweep.status === 'completed'
    ? `All ${total} variants complete`
    : `${completed} / ${total} variants complete`;

  let html = '';

  // Progress bar + cancel button (while running)
  if (sweep.status === 'running') {
    html += `
      <div class="sweep-progress" style="display:flex;align-items:center;gap:var(--space-12);">
        <div style="flex:1;">
          <div class="sweep-progress-bar-track">
            <div class="sweep-progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="sweep-progress-label">${progressLabel}</span>
        </div>
        <button id="cancel-sweep-btn" onclick="cancelSweep('${sweep.sweep_id}')"
          style="padding:var(--space-6) var(--space-14);border:1px solid var(--color-negative);border-radius:var(--radius-sm);background:transparent;color:var(--color-negative);cursor:pointer;font-size:var(--text-caption);font-weight:600;white-space:nowrap;">
          Cancel Sweep
        </button>
      </div>
    `;
  } else if (sweep.status === 'cancelled') {
    html += `
      <div style="padding:var(--space-8);font-size:var(--text-caption);color:var(--color-text-subtle);">${progressLabel} — Cancelled</div>
    `;
  }

  const verdictCounts = { PASS: 0, NEEDS_REVIEW: 0, FAIL: 0, HARD_FAIL: 0, UNKNOWN: 0 };
  sweep.variants.forEach(variant => {
    const verdict = getDisplayVerdict(variant?.metrics || {});
    if (verdict === 'PASS') verdictCounts.PASS += 1;
    else if (verdict === 'NEEDS_REVIEW') verdictCounts.NEEDS_REVIEW += 1;
    else if (verdict === 'FAIL') verdictCounts.FAIL += 1;
    else if (verdict === 'HARD_FAIL') verdictCounts.HARD_FAIL += 1;
    else verdictCounts.UNKNOWN += 1;
  });

  html += `
    <div style="display:flex;gap:var(--space-8);flex-wrap:wrap;margin:var(--space-10) 0 var(--space-12) 0;">
      <div style="padding:var(--space-6) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);font-size:var(--text-caption);">
        <strong>Tier Gate</strong>
      </div>
      <div style="padding:var(--space-6) var(--space-10);border:1px solid rgba(0,255,136,0.25);border-radius:var(--radius-sm);font-size:var(--text-caption);color:var(--color-positive);">
        PASS ${verdictCounts.PASS}
      </div>
      <div style="padding:var(--space-6) var(--space-10);border:1px solid rgba(245,166,35,0.25);border-radius:var(--radius-sm);font-size:var(--text-caption);color:#f5a623;">
        REVIEW ${verdictCounts.NEEDS_REVIEW}
      </div>
      <div style="padding:var(--space-6) var(--space-10);border:1px solid rgba(255,80,80,0.25);border-radius:var(--radius-sm);font-size:var(--text-caption);color:var(--color-negative);">
        FAIL ${verdictCounts.FAIL}
      </div>
      <div style="padding:var(--space-6) var(--space-10);border:1px solid rgba(255,80,80,0.35);border-radius:var(--radius-sm);font-size:var(--text-caption);color:#ffb0b0;">
        HARD FAIL ${verdictCounts.HARD_FAIL}
      </div>
      <div style="padding:var(--space-6) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:var(--text-caption);color:var(--color-text-subtle);">
        UNKNOWN ${verdictCounts.UNKNOWN}
      </div>
    </div>
  `;

  // Results table
  const paramLabel = sweep.sweep_params?.[0]?.label || 'Parameter';
  html += `
    <div style="overflow-x:auto;">
      <table class="results-table">
        <thead>
          <tr>
            <th>Compare</th>
            <th>${paramLabel}</th>
            <th>Status</th>
            <th>Tier Result</th>
            <th>Trades</th>
            <th>Expectancy</th>
            <th>Win Rate</th>
            <th>Profit Factor</th>
            <th>Max DD</th>
            <th>Sharpe</th>
            <th>Fitness</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Sort: completed (best verdict/fitness first), then running, then pending, then failed
  const sorted = [...sweep.variants].sort((a, b) => {
    const order = { completed: 0, running: 1, pending: 2, failed: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    const verdictRank = (variant) => {
      const verdict = getDisplayVerdict(variant?.metrics || {});
      if (verdict === 'PASS') return 2;
      if (verdict === 'NEEDS_REVIEW') return 1;
      if (verdict === 'FAIL') return 0;
      if (verdict === 'HARD_FAIL') return -1;
      return -1;
    };
    const verdictDelta = verdictRank(b) - verdictRank(a);
    if (verdictDelta !== 0) return verdictDelta;
    const fa = a.metrics?.fitness_score ?? -1;
    const fb = b.metrics?.fitness_score ?? -1;
    if (fb !== fa) return fb - fa;
    return (b.metrics?.expectancy_R ?? -999) - (a.metrics?.expectancy_R ?? -999);
  });

  sorted.forEach(v => {
    const isWinner = sweep.winner?.variant_id === v.variant_id;
    const rowClass = isWinner ? 'winner-row' : v.status === 'running' ? 'running-row' : v.status === 'failed' ? 'failed-row' : '';
    const statusBadge = isWinner
      ? '<span class="badge-status badge-winner">★ Winner</span>'
      : `<span class="badge-status badge-${v.status}">${v.status}</span>`;

    const m = v.metrics;
    const verdict = getDisplayVerdict(m || {});
    const actionHtml = v.status === 'completed'
      ? `<div class="sweep-action-group">
          <button class="sweep-inline-btn" onclick="viewSweepReport('${v.report_id || ''}','${v.variant_id}')">Report</button>
          <button class="sweep-inline-btn" onclick="promoteWinner('${sweep.sweep_id}','${v.variant_id}')">Promote</button>
        </div>`
      : 'N/A';
    const fmt = (n, digits = 2) => n != null ? Number(n).toFixed(digits) : '—';
    const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';
    const compareHtml = v.status === 'completed' && v.report_id
      ? `<label class="sweep-compare-toggle"><input type="checkbox" ${selectedComparisonVariantIds.has(v.variant_id) ? 'checked' : ''} onchange="toggleSweepComparison('${v.variant_id}','${v.report_id || ''}')"><span>Compare</span></label>`
      : '<span class="text-muted">—</span>';

    html += `
      <tr class="${rowClass}">
        <td>${compareHtml}</td>
        <td style="font-weight:600; color:${isWinner ? 'var(--color-positive)' : 'var(--color-text)'}">
          ${v.param_value}${typeof v.param_value === 'number' && v.param_value < 1 && v.param_path?.includes('stop_value') ? ' (' + (v.param_value * 100).toFixed(0) + '%)' : ''}
        </td>
        <td>${statusBadge}</td>
        <td><span class="verdict-badge ${verdict}">${verdict.replace('_', ' ')}</span></td>
        <td>${m ? m.total_trades : '—'}</td>
        <td style="color:${m && m.expectancy_R > 0 ? 'var(--color-positive)' : m && m.expectancy_R < 0 ? 'var(--color-negative)' : 'inherit'}">${m ? fmt(m.expectancy_R) + 'R' : '—'}</td>
        <td>${m ? fmtPct(m.win_rate * 100) : '—'}</td>
        <td>${m ? fmt(m.profit_factor) : '—'}</td>
        <td style="color:${m && m.max_drawdown_pct > 30 ? 'var(--color-negative)' : 'inherit'}">${m ? fmtPct(m.max_drawdown_pct) : '—'}</td>
        <td>${m ? fmt(m.sharpe_ratio) : '—'}</td>
        <td style="font-weight:600; color:${m && m.fitness_score > 0.5 ? 'var(--color-positive)' : 'inherit'}">${m ? fmt(m.fitness_score, 3) : '—'}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';

  // Build copy text
  const copyHeader = `${paramLabel}\tStatus\tTier Result\tTrades\tExpectancy\tWin Rate\tProfit Factor\tMax DD\tSharpe\tFitness`;
  const copyRows = sorted.map(v => {
    const m = v.metrics;
    const isWinner = sweep.winner?.variant_id === v.variant_id;
    const status = isWinner ? 'Winner' : v.status;
    if (!m) return `${v.param_value}\t${status}\t—\t—\t—\t—\t—\t—\t—`;
    return `${v.param_value}\t${status}\t${m.total_trades}\t${m.expectancy_R.toFixed(2)}R\t${(m.win_rate * 100).toFixed(1)}%\t${m.profit_factor.toFixed(2)}\t${m.max_drawdown_pct.toFixed(1)}%\t${m.sharpe_ratio.toFixed(2)}\t${m.fitness_score.toFixed(3)}`;
  }).join('\n');
  window.__sweepCopyText = `${copyHeader}\n${copyRows}`;

  html += `
    <div style="margin-top:var(--space-8);display:flex;justify-content:flex-end;">
      <button id="copy-sweep-btn" style="font-size:var(--text-caption);padding:var(--space-4) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);color:var(--color-text-subtle);cursor:pointer;">
        Copy Results
      </button>
    </div>
  `;

  // Winner banner
  if (sweep.status === 'completed' && sweep.winner?.metrics) {
    const w = sweep.winner;
    html += `
      <div class="winner-banner">
        <div class="winner-banner-text">
          ★ Winner: <strong>${paramLabel} = ${w.param_value}</strong>
          &nbsp;·&nbsp; ${w.metrics.total_trades} trades
          &nbsp;·&nbsp; ${w.metrics.expectancy_R.toFixed(3)}R expectancy
          &nbsp;·&nbsp; fitness ${w.metrics.fitness_score.toFixed(3)}
        </div>
        <button class="btn-promote" onclick="promoteWinner('${sweep.sweep_id}','${w.variant_id}')">
          Promote Winner →
        </button>
      </div>
    `;
  }

  const comparisonVariants = sorted.filter(v => selectedComparisonVariantIds.has(v.variant_id));
  if (comparisonVariants.length >= 1) {
    html += renderSweepComparisonPanel(sweep, comparisonVariants);
  }

  const reportVariant = sorted.find(v => v.variant_id === selectedSweepVariantId && v.report_id)
    || (sweep.winner?.report_id ? sweep.winner : null)
    || sorted.find(v => v.status === 'completed' && v.report_id)
    || null;
  const report = reportVariant?.report_id ? sweepReportCache.get(reportVariant.report_id) : null;
  html += `<div id="sweep-report-detail">`;
  if (report && reportVariant) {
    html += renderSweepReportDetail(report, {
      param_value: reportVariant.param_value,
      winner_value: sweep.winner?.param_value,
    });
  } else if (reportVariant?.report_id) {
    html += `<div class="metric-card" style="margin-top:var(--space-16);">Click <strong>Report</strong> to load the full validator report for this sweep variant.</div>`;
  } else {
    html += `<div class="metric-card" style="margin-top:var(--space-16);">No completed report selected yet.</div>`;
  }
  html += `</div>`;

  document.getElementById('results-body').innerHTML = html;

  if (!selectedSweepReportId && reportVariant?.report_id) {
    setTimeout(() => viewSweepReport(reportVariant.report_id, reportVariant.variant_id), 0);
  }

  setTimeout(() => {
    const btn = document.getElementById('copy-sweep-btn');
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.__sweepCopyText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Results', 1500);
      });
    });
  }, 0);
}

// ─── Promote winner ────────────────────────────────────────────────────────────

async function promoteWinner(sweepId, variantId = '') {
  try {
    const res = await fetch(`${API}/sweep/${sweepId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(variantId ? { variant_id: variantId } : {}),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    await loadStrategyCatalog();
    await loadRecentSweeps();
    if (activeSweepId === sweepId) {
      await fetchAndRenderSweep(sweepId);
    }
    alert(`Variant promoted as new strategy version:\n${data.data.strategy_version_id}\n\nYou can now run validation on it in the Validator.`);
  } catch (e) {
    alert(`Failed to promote: ${e.message}`);
  }
}

// ─── Recent sweeps ─────────────────────────────────────────────────────────────

async function loadRecentSweeps() {
  try {
    const sweepsData = await fetchSweepSummaries(true);
    const list = document.getElementById('sweep-history-list');
    const sweeps = (sweepsData || [])
      .filter(s => String(s?.promoted_strategy_version_id || '').trim())
      .slice(0, 10);

    await Promise.all(sweeps.flatMap(s => ([
      ensureStrategySpec(s.promoted_strategy_version_id),
      ensureStrategySpec(s.base_strategy_version_id),
    ])));

    if (sweeps.length === 0) {
      list.innerHTML = '<div style="font-size:var(--text-caption); color:var(--color-text-muted);">No promoted sweeps yet.</div>';
      return;
    }

    list.innerHTML = sweeps.map(s => {
      const displayStrategyId = s.promoted_strategy_version_id || s.base_strategy_version_id;
      const strategyName = getStrategyName(displayStrategyId);
      const baseStrategyName = getStrategyName(s.base_strategy_version_id);
      const param = s.sweep_params?.[0] || {};
      const paramLabel = param.label || 'Parameter';
      const valuesSummary = formatSweepValueSummary(param.values || []);
      const variantCount = s.variants?.length || 0;
      const completedCount = s.variants?.filter(v => v.status === 'completed').length || 0;
      const statusColor = s.status === 'completed' ? 'var(--color-positive)' : s.status === 'running' ? 'var(--color-accent)' : 'var(--color-text-muted)';
      return `
        <div class="sweep-history-item ${activeSweepId === s.sweep_id ? 'active' : ''}" onclick="loadSweep('${s.sweep_id}')">
          <div class="sweep-name">${strategyName}</div>
          <div class="sweep-meta">${getStrategyStageLabel(s.base_strategy_version_id, s.tier)} • ${paramLabel}</div>
          <div class="sweep-meta">Values: ${valuesSummary}</div>
          <div class="sweep-meta">Promoted from: ${baseStrategyName}</div>
          <div class="sweep-meta">
            <span style="color:${statusColor}">${s.status}</span>
            · ${completedCount}/${variantCount} variants
            ${s.winner ? `· winner: ${s.winner.param_value}` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch {}
}

async function loadSweep(sweepId) {
  return loadSweepInternal(sweepId, { persist: true });
}

async function loadSweepInternal(sweepId, options = {}) {
  const { persist = true } = options;
  const requestedId = String(sweepId || '').trim();
  if (!requestedId) return false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  activeSweepId = requestedId;
  if (persist) persistActiveSweepId(requestedId);
  selectedComparisonVariantIds.clear();
  selectedSweepReportId = null;
  selectedSweepVariantId = null;
  activeSweepReferenceKey = null;
  activeSweepReferenceReportId = null;
  try {
    const res = await fetch(`${API}/sweep/${requestedId}`);
    const data = await res.json();
    if (data.success) {
      await ensureStrategySpec(getSweepDisplayStrategyId(data.data));
      await ensureStrategySpec(data.data.base_strategy_version_id);
      restoreSweepConfig(data.data);
      startPolling(requestedId);
      loadRecentSweeps();
      return true;
    } else {
      activeSweepId = null;
      if (persist) persistActiveSweepId('');
      renderLoadedSweepBanner(null);
    }
  } catch {
    activeSweepId = null;
    if (persist) persistActiveSweepId('');
    renderLoadedSweepBanner(null);
  }
  return false;
}
