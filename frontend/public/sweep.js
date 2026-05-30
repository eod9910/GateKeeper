/**
 * Parameter Sweep — Frontend Logic
 */

const API = '/api';
let selectedPreset = null;
let customValues = [];
let secondSlot = { active: false, paramPath: '', label: '', values: [] };
let activeSweepId = null;
let pollTimer = null;
const strategyCatalog = new Map();
const sweepReportCache = new Map();
let sweepSummaryCache = [];
// Maps sweep_id → session version number (V1, V2, ...) — populated by _loadRecentSweepsImpl
const sweepVersionMap = new Map();
const ACTIVE_SWEEP_STORAGE_KEY = 'activeSweepId';
const ACTIVE_STRATEGY_STORAGE_KEY = 'activeSweepStrategyId';
const SESSION_START_STORAGE_KEY = 'sweepSessionStartedAt';
let sessionStartedAt = null;
let selectedSweepReportId = null;
let selectedSweepVariantId = null;
const selectedComparisonVariantIds = new Set();
let activeSweepReferenceKey = null;
let activeSweepReferenceReportId = null;
let activeConfiguredStrategyVersionId = null;

// ─── Universal Dimensions state ───────────────────────────────────────────────
// Maps dim.key → Set of selected values
const universalDimSelections = new Map();
let universalDimsSpec = null; // loaded from API
const UNIVERSAL_SWEEP_FALLBACK_PATHS = [
  'validation_tier',
  'setup_config.market_cap_tier',
  'interval',
  'risk_config.take_profit_R',
  'risk_config.atr_multiplier',
  'risk_config.max_hold_bars',
  'fundamental_config.forward_bars',
  'execution_config.auto_breakeven_r',
  'risk_config.max_concurrent_positions',
];
const STRATEGY_PICKER_BASELINE_EXCLUDED_PATHS = [
  'setup_config.min_market_cap_billions',
  'setup_config.min_avg_volume_k',
  'setup_config.require_above_200ma',
];

async function loadUniversalDims() {
  if (universalDimsSpec) return universalDimsSpec;
  try {
    const res = await fetch(`${API}/sweep/universal-dims`);
    const json = await res.json();
    universalDimsSpec = json.success ? json.data : null;
  } catch { universalDimsSpec = null; }
  return universalDimsSpec;
}

function getStrategyPickerExcludedPaths() {
  const excluded = new Set([
    ...UNIVERSAL_SWEEP_FALLBACK_PATHS,
    ...STRATEGY_PICKER_BASELINE_EXCLUDED_PATHS,
  ]);
  (universalDimsSpec?.dims || []).forEach(dim => {
    const path = String(dim?.param_path || '').trim();
    if (path) excluded.add(path);
  });
  return excluded;
}

function shouldHideFromStrategyParameterPicker(definition) {
  const path = String(definition?.param_path || definition?.path || '').trim();
  return Boolean(path) && getStrategyPickerExcludedPaths().has(path);
}

function getActiveDimParams() {
  // Returns array of { label, param_path, values[] } for each dim that has ≥1 value selected
  if (!universalDimsSpec) return [];
  return universalDimsSpec.dims
    .map(dim => {
      const sel = universalDimSelections.get(dim.key);
      if (!sel || sel.size === 0) return null;
      return {
        label: dim.label,
        param_path: dim.param_path,
        identity_preserving: dim.identity_preserving || false,
        values: Array.from(sel),
      };
    })
    .filter(Boolean);
}

function renderUniversalDimCards(groupDims = []) {
  return groupDims.map(dim => {
    const sel = universalDimSelections.get(dim.key) || new Set();
    const hasAny = sel.size > 0;
    const allSelected = Array.isArray(dim.suggested_values)
      && dim.suggested_values.length > 0
      && dim.suggested_values.every(sv => [...sel].some(v => String(v) === String(sv.value)));
    return `
      <div class="udim-card${hasAny ? ' active' : ''}" id="udim-card-${dim.key}">
        <div class="udim-header">
          <div
            class="udim-toggle${allSelected ? ' checked' : ''}"
            id="udim-toggle-${dim.key}"
            onclick="toggleUniversalDimAll('${dim.key}')"
            title="${allSelected ? 'Clear all values' : 'Select all values'}"
          ></div>
          <div class="udim-name">${dim.label}</div>
          <div class="udim-count" id="udim-count-${dim.key}">${hasAny ? sel.size + ' selected' : ''}</div>
        </div>
        <div class="udim-values" id="udim-pills-${dim.key}">
          ${dim.suggested_values.map(sv => {
            const isSelected = [...sel].some(v => String(v) === String(sv.value));
            const encodedVal = encodeURIComponent(String(sv.value));
            return `<span class="udim-pill${isSelected ? ' selected' : ''}"
              onclick="toggleUniversalDimValue('${dim.key}', decodeURIComponent('${encodedVal}'))"
              title="${sv.label}">${sv.label}</span>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderUniversalDims() {
  const section = document.getElementById('universal-dims-section');
  const researchBody = document.getElementById('universal-dims-research-body');
  const riskBody = document.getElementById('universal-dims-risk-body');
  const researchSection = document.getElementById('universal-dims-research-section');
  const riskSection = document.getElementById('universal-dims-risk-section');
  if (!section || !researchBody || !riskBody || !researchSection || !riskSection || !universalDimsSpec) return;
  section.style.display = 'block';

  const dims = universalDimsSpec.dims;
  const researchDims = dims.filter(d => String(d.group || '').toLowerCase() === 'environment');
  const riskDims = dims.filter(d => String(d.group || '').toLowerCase() === 'risk');

  researchBody.innerHTML = researchDims.length
    ? `<div class="udim-group-label">${researchDims[0].group_label || 'Research'}</div>${renderUniversalDimCards(researchDims)}`
    : '<div class="udim-subsection-help">No research dimensions available.</div>';
  riskBody.innerHTML = riskDims.length
    ? `<div class="udim-group-label">${riskDims[0].group_label || 'Risk / Execution'}</div>${renderUniversalDimCards(riskDims)}`
    : '<div class="udim-subsection-help">No risk or execution dimensions available.</div>';

  researchSection.style.display = researchDims.length ? 'block' : 'none';
  riskSection.style.display = riskDims.length ? 'block' : 'none';
  updateUniversalDimsBadge();
}

function renderUniversalDimSelection(dim, sel) {
  if (!dim) return;
  const card = document.getElementById(`udim-card-${dim.key}`);
  const toggle = document.getElementById(`udim-toggle-${dim.key}`);
  const count = document.getElementById(`udim-count-${dim.key}`);
  const pillsEl = document.getElementById(`udim-pills-${dim.key}`);
  if (!card || !toggle || !count || !pillsEl) return;

  const hasAny = sel.size > 0;
  const allSelected = Array.isArray(dim.suggested_values)
    && dim.suggested_values.length > 0
    && dim.suggested_values.every(sv => [...sel].some(v => String(v) === String(sv.value)));
  card.className = 'udim-card' + (hasAny ? ' active' : '');
  toggle.className = 'udim-toggle' + (allSelected ? ' checked' : '');
  toggle.title = allSelected ? 'Clear all values' : 'Select all values';
  count.textContent = hasAny ? sel.size + ' selected' : '';
  pillsEl.innerHTML = dim.suggested_values.map(sv => {
    const isSelected = [...sel].some(v => String(v) === String(sv.value));
    const encodedVal = encodeURIComponent(String(sv.value));
    return `<span class="udim-pill${isSelected ? ' selected' : ''}"
      onclick="toggleUniversalDimValue('${dim.key}', decodeURIComponent('${encodedVal}'))"
      title="${sv.label}">${sv.label}</span>`;
  }).join('');
}

function coerceUniversalDimValue(dim, value) {
  const firstSuggested = dim?.suggested_values?.[0]?.value;
  return (typeof firstSuggested === 'number' && !isNaN(Number(value)))
    ? Number(value)
    : value;
}

function toggleUniversalDimValue(dimKey, value) {
  // Coerce to number if the dim's suggested values are numeric
  const dim = universalDimsSpec?.dims.find(d => d.key === dimKey);
  const coerced = coerceUniversalDimValue(dim, value);
  let sel = universalDimSelections.get(dimKey);
  if (!sel) { sel = new Set(); universalDimSelections.set(dimKey, sel); }
  if (sel.has(coerced)) sel.delete(coerced); else sel.add(coerced);
  // Re-render just this dim's pills and toggle
  if (!dim) return;
  renderUniversalDimSelection(dim, sel);
  updateUniversalDimsBadge();
  updateRunButton();
}

function toggleUniversalDimAll(dimKey) {
  const dim = universalDimsSpec?.dims.find(d => d.key === dimKey);
  if (!dim || !Array.isArray(dim.suggested_values)) return;
  let sel = universalDimSelections.get(dimKey);
  if (!sel) { sel = new Set(); universalDimSelections.set(dimKey, sel); }

  const values = dim.suggested_values.map(sv => coerceUniversalDimValue(dim, sv.value));
  const allSelected = values.length > 0 && values.every(value => sel.has(value));
  sel.clear();
  if (!allSelected) values.forEach(value => sel.add(value));

  renderUniversalDimSelection(dim, sel);
  updateUniversalDimsBadge();
  updateRunButton();
}

function updateUniversalDimsBadge() {
  const badge = document.getElementById('universal-dims-active-badge');
  if (!badge) return;
  const active = getActiveDimParams();
  if (active.length > 0) {
    const totalValues = active.reduce((acc, d) => acc + d.values.length, 0);
    badge.textContent = active.length + ' dim' + (active.length > 1 ? 's' : '') + ', ' + totalValues + ' values';
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

function renderUniversalDimsVariantCount() {
  // Show a count indicator below the universal dims section
  const section = document.getElementById('universal-dims-section');
  if (!section) return;
  const existing = document.getElementById('udim-variant-count');
  const active = getActiveDimParams();
  const primary = getPrimarySweepParamConfig();
  if (active.length === 0) {
    if (existing) existing.remove();
    return;
  }
  const primaryBaseCount = primary.values.length || 1;
  const primaryCount = secondSlot.active
    ? primaryBaseCount * (secondSlot.values.length || 1)
    : primaryBaseCount;
  const dimsProduct = active.reduce((acc, d) => acc * d.values.length, 1);
  const total = primaryCount * dimsProduct;
  const overCap = total > 20;
  const el = existing || (() => {
    const div = document.createElement('div');
    div.id = 'udim-variant-count';
    div.style.cssText = 'font-size:11px;font-family:var(--font-mono);padding:var(--space-6) var(--space-10);border-radius:var(--radius-sm);margin-top:var(--space-4);';
    section.after(div);
    return div;
  })();
  el.style.background = overCap
    ? 'color-mix(in srgb, var(--color-negative) 10%, transparent)'
    : 'color-mix(in srgb, var(--color-accent) 8%, transparent)';
  el.style.color = overCap ? 'var(--color-negative)' : 'var(--color-accent)';
  el.textContent = overCap
    ? `⚠ ${total} total variants — max is 20. Reduce selections.`
    : `${primaryCount} strategy × ${dimsProduct} universal dims = ${total} total variants`;
}

const ANATOMY_GROUPS = [
  { key: 'structure', label: 'Structure' },
  { key: 'location', label: 'Location' },
  { key: 'entry_timing', label: 'Entry Timing' },
  { key: 'pattern_gate', label: 'Regime Filter' },
  { key: 'valuation', label: 'Valuation' },
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
  dcf_valuation_hold_bars: {
    label: 'DCF Valuation Hold Bars',
    anatomy: 'valuation',
    param_path: 'fundamental_config.forward_bars',
    values: [13, 20, 26, 40, 52, 60, 75, 90, 104],
    isAvailable: strategy => (
      String(strategy?.setup_config?.pattern_type || '').trim() === 'valuation_state_primitive' ||
      hasNestedValue(strategy, 'fundamental_config.forward_bars')
    ),
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

async function switchToStrategy(strategyVersionId, options = {}) {
  const strategySelect = document.getElementById('sweep-strategy-select');
  if (!strategySelect) return;

  // Fetch full spec first so parameter_manifest is available for the picker
  await ensureStrategySpec(strategyVersionId);

  // Keep hidden select in sync
  if (!strategySelect.querySelector(`option[value="${CSS.escape(strategyVersionId)}"]`)) {
    const opt = document.createElement('option');
    opt.value = strategyVersionId;
    strategySelect.appendChild(opt);
  }
  strategySelect.value = strategyVersionId;
  activeConfiguredStrategyVersionId = strategyVersionId;
  persistActiveStrategyId(strategyVersionId);

  updateStrategyDisplay(strategyVersionId);
  renderStrategyAnatomy();
  configureSweepTierSelector();
  setupCustomParameterPicker();
  // Load and render universal dims whenever a strategy is selected
  loadUniversalDims().then(() => {
    renderUniversalDims();
    setupCustomParameterPicker();
  });
  // Allow caller to suppress the default loadRecentSweeps (e.g. after promotion,
  // so the caller can load sessions for the previous strategy instead)
  if (!options.skipLoadSweeps) await loadRecentSweeps();
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
    if (shouldHideFromStrategyParameterPicker(item)) return;
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
    .filter(([, preset]) => Boolean(preset) && !shouldHideFromStrategyParameterPicker(preset));
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

// ─── Smart Plan (sensitivity-driven sweep recommendation) ─────────────────────

let _smartPlan = null;

async function loadSmartPlan(strategyVersionId) {
  const banner = document.getElementById('smart-plan-banner');
  if (!banner) return;
  if (!strategyVersionId) { banner.innerHTML = ''; return; }

  banner.innerHTML = `<div style="color:var(--color-text-subtle);font-size:var(--text-caption);padding:var(--space-8);">Loading sensitivity-driven sweep plan…</div>`;

  try {
    const res = await fetch(`${API}/sweep/smart-plan/${encodeURIComponent(strategyVersionId)}`);
    const data = await res.json();
    if (!data.success || !data.data?.sweep_params?.length) {
      banner.innerHTML = `<div style="color:var(--color-text-subtle);font-size:var(--text-caption);padding:var(--space-8);">No smart plan available — run Tier 1S or Tier 2 validation first to generate sensitivity data.</div>`;
      _smartPlan = null;
      return;
    }
    _smartPlan = data.data;
    renderSmartPlan(_smartPlan, banner);
  } catch (e) {
    banner.innerHTML = `<div style="color:var(--color-text-subtle);font-size:var(--text-caption);padding:var(--space-8);">Could not load smart plan.</div>`;
    _smartPlan = null;
  }
}

function renderSmartPlan(plan, container) {
  if (!plan || !container) return;

  const rows = plan.sweep_params.map((p, i) => {
    // Extract raw impact from label e.g. "(impact: +15.0% / -2.7%)"
    const impactMatch = p.label.match(/impact:\s*([+\-\d.]+)%\s*\/\s*([+\-\d.]+)%/);
    const upImpact = impactMatch ? parseFloat(impactMatch[1]) : 0;
    const downImpact = impactMatch ? parseFloat(impactMatch[2]) : 0;
    const maxImpact = Math.max(Math.abs(upImpact), Math.abs(downImpact));
    const impactColor = maxImpact > 10 ? 'var(--color-positive)' : 'var(--color-text-muted)';

    // Clean label — remove the "(impact: ...)" suffix for display
    const cleanLabel = p.label.replace(/\s*\(impact:.*\)/, '').trim();
    const valuesStr = p.values.join(', ');

    return `
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:var(--space-8);align-items:center;padding:var(--space-6) var(--space-12);border-bottom:1px solid var(--color-border);">
        <div>
          <div style="font-size:var(--text-caption);color:var(--color-text);">${reportEscHtml(cleanLabel)}</div>
          <div style="font-size:10px;color:var(--color-text-subtle);font-family:var(--font-mono);margin-top:2px;">${reportEscHtml(p.param_path)}</div>
        </div>
        <div style="font-size:var(--text-caption);color:${impactColor};font-weight:600;white-space:nowrap;">${maxImpact > 0 ? (upImpact > 0 ? '+' : '') + upImpact.toFixed(1) + '%' : '—'}</div>
        <button
          class="btn btn-sm"
          style="font-size:var(--text-caption);padding:2px 10px;white-space:nowrap;"
          onclick="applySmartPlanParam(${i})"
        >Use</button>
      </div>
    `;
  }).join('');

  const excludedNote = plan.excluded_params?.length
    ? `<div style="padding:var(--space-6) var(--space-12);font-size:10px;color:var(--color-text-subtle);">Excluded (flat): ${plan.excluded_params.map(e => e.param).join(', ')}</div>`
    : '';

  container.innerHTML = `
    <div style="border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;margin-bottom:var(--space-12);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-8) var(--space-12);background:var(--color-surface);border-bottom:1px solid var(--color-border);">
        <div>
          <span style="font-size:var(--text-caption);font-weight:600;color:var(--color-text);">Sensitivity-Driven Sweep Plan</span>
          <span style="margin-left:var(--space-8);font-size:10px;color:var(--color-text-subtle);">Base: ${plan.base_expectancy > 0 ? '+' : ''}${plan.base_expectancy.toFixed(2)}R · Score: ${plan.sensitivity_score}/100</span>
        </div>
        <button class="btn btn-sm btn-primary" style="font-size:var(--text-caption);padding:3px 12px;" onclick="applyAllSmartPlanParams()">Run All</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:0;padding:var(--space-6) var(--space-12);border-bottom:1px solid var(--color-border);font-size:10px;color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:.05em;">
        <span>Parameter</span><span>Impact</span><span></span>
      </div>
      ${rows}
      ${excludedNote}
    </div>
  `;
}

function applySmartPlanParam(index) {
  if (!_smartPlan?.sweep_params?.[index]) return;
  const p = _smartPlan.sweep_params[index];
  const cleanLabel = p.label.replace(/\s*\(impact:.*\)/, '').trim();

  // Set the custom param path and values then trigger a run
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');
  if (pathInput) pathInput.value = p.param_path;
  if (labelInput) labelInput.value = cleanLabel;

  clearPresetSelection();
  customValues = [...p.values];
  renderValuePills();
  updateSelectedSummary();
  updateRunButton();

  // Scroll to run button
  document.getElementById('run-sweep-btn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyAllSmartPlanParams() {
  if (!_smartPlan?.sweep_params?.length) return;
  // Apply all smart plan params as multi-param sweep
  // For now, apply the highest-impact param and surface a message
  applySmartPlanParam(0);
}

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  sessionStartedAt = window.localStorage.getItem(SESSION_START_STORAGE_KEY) || null;
  restoreSweepConfigPanelState();
  initSweepResizeHandle();
  configureSweepTierSelector();
  await loadStrategyCatalog();
  await loadStrategies();
  setupPresetButtons();
  setupCustomParameterPicker();
  setupAddValueOnEnter();
  // Pre-load universal dims so the section is ready when a strategy is selected
  loadUniversalDims().then(() => {
    renderUniversalDims();
    setupCustomParameterPicker();
  });

  const requestedStrategy = getRequestedStrategyId();
  if (requestedStrategy) {
    const urlStrategy = new URLSearchParams(window.location.search).get('strategy_version_id');
    const persistedStrategy = String(window.localStorage.getItem(ACTIVE_STRATEGY_STORAGE_KEY) || '').trim();
    // Only start a fresh session on an explicit cross-page handoff. If we are
    // merely refreshing the same sweep page, keep the existing session and
    // active sweep instead of clearing the winner cards.
    if (urlStrategy && String(urlStrategy).trim() !== persistedStrategy) {
      sessionStartedAt = new Date().toISOString();
      window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
      persistActiveSweepId('');
    }
    await switchToStrategy(requestedStrategy.trim());
    if (urlStrategy) {
      const url = new URL(window.location.href);
      url.searchParams.delete('strategy_version_id');
      window.history.replaceState({}, '', url.toString());
    }
  } else {
    await loadRecentSweeps();
  }

  await restoreActiveSweepFromState();
});

function initSweepResizeHandle() {
  const handle = document.getElementById('sweep-resize-handle');
  const layout = document.querySelector('.sweep-layout');
  if (!handle || !layout) return;

  const STORAGE_KEY = 'sweep_config_panel_width';
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 600;

  // Restore saved width
  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
    layout.style.setProperty('--sweep-config-width', `${saved}px`);
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    const panel = document.getElementById('sweep-config-panel');
    if (!panel) return;
    dragging = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
    layout.style.setProperty('--sweep-config-width', `${newWidth}px`);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist width
    const panel = document.getElementById('sweep-config-panel');
    if (panel) {
      const w = Math.round(panel.getBoundingClientRect().width);
      localStorage.setItem(STORAGE_KEY, String(w));
    }
  });
}

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
  const handle = document.getElementById('sweep-resize-handle');
  if (handle) handle.style.pointerEvents = nextCollapsed ? 'none' : '';
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

function getRequestedStrategyId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = String(params.get('strategy_version_id') || '').trim();
    if (fromQuery) return fromQuery;
  } catch {}
  return String(window.localStorage.getItem(ACTIVE_STRATEGY_STORAGE_KEY) || '').trim();
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

function persistActiveStrategyId(strategyVersionId = '') {
  const value = String(strategyVersionId || '').trim();
  if (value) {
    window.localStorage.setItem(ACTIVE_STRATEGY_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(ACTIVE_STRATEGY_STORAGE_KEY);
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
    const tier1Stages = new Set(['tier1', 'tier1s', 'tier1b', 'tier1bs']);

    // Always show all tiers — default selection based on strategy stage
    const defaultTier = stage === 'tier3' ? 'tier3'
      : (stage === 'tier2' || stage === 'tier2r') ? 'tier2'
      : stage === 'tier1b' ? 'tier1b'
      : stage === 'tier1s' ? 'tier1s'
      : 'tier1';

    tierSelect.innerHTML = `
      <option value="tier1"${defaultTier === 'tier1' ? ' selected' : ''}>Tier 1 — Fast mixed-cap (52 stocks)</option>
      <option value="tier1b"${defaultTier === 'tier1b' ? ' selected' : ''}>Tier 1B — Mixed-cap expansion (100 stocks)</option>
      <option value="tier1s"${defaultTier === 'tier1s' ? ' selected' : ''}>Tier 1S — Tier 1 + Sensitivity</option>
      <option value="tier2"${defaultTier === 'tier2' ? ' selected' : ''}>Tier 2 — Core mixed-cap (200 stocks)</option>
      <option value="tier3"${defaultTier === 'tier3' ? ' selected' : ''}>Tier 3 — Mixed-cap holdout (180 stocks)</option>
      <option value="large_cap_known"${defaultTier === 'large_cap_known' ? ' selected' : ''}>Large Cap (Known) — 76 confirmed large caps</option>
      <option value="sp500"${defaultTier === 'sp500' ? ' selected' : ''}>S&P 500 — ~406 large cap stocks</option>
      <option value="sp400"${defaultTier === 'sp400' ? ' selected' : ''}>S&P 400 — ~341 mid cap stocks</option>
      <option value="sp600"${defaultTier === 'sp600' ? ' selected' : ''}>S&P 600 — ~474 small cap stocks</option>
      <optgroup label="DCF Valuation Regimes (run build_universe_valuation_snapshot.py first)">
        <option value="valuation_regime_undervalued_sample100"${defaultTier === 'valuation_regime_undervalued_sample100' ? ' selected' : ''}>DCF: Undervalued Sample 100 - faster regime test</option>
        <option value="valuation_regime_undervalued"${defaultTier === 'valuation_regime_undervalued' ? ' selected' : ''}>DCF: Undervalued — valuation longs/reversals</option>
        <option value="valuation_regime_fair_sample100"${defaultTier === 'valuation_regime_fair_sample100' ? ' selected' : ''}>DCF: Fair Value Sample 100 - faster continuation test</option>
        <option value="valuation_regime_fair"${defaultTier === 'valuation_regime_fair' ? ' selected' : ''}>DCF: Fair Value — continuation candidates</option>
        <option value="valuation_regime_overvalued_sample100"${defaultTier === 'valuation_regime_overvalued_sample100' ? ' selected' : ''}>DCF: Overvalued Sample 100 - faster short test</option>
        <option value="valuation_regime_overvalued"${defaultTier === 'valuation_regime_overvalued' ? ' selected' : ''}>DCF: Overvalued — short/topping candidates</option>
      </optgroup>
      <optgroup label="Regime Universes (run build_regime_universes.py first)">
        <option value="regime_expansion"${defaultTier === 'regime_expansion' ? ' selected' : ''}>Regime: Expansion — stocks above 200MA, momentum up</option>
        <option value="regime_distribution"${defaultTier === 'regime_distribution' ? ' selected' : ''}>Regime: Distribution — stocks above 200MA, fading</option>
        <option value="regime_accumulation"${defaultTier === 'regime_accumulation' ? ' selected' : ''}>Regime: Accumulation — stocks below 200MA, recovering</option>
        <option value="regime_markdown"${defaultTier === 'regime_markdown' ? ' selected' : ''}>Regime: Markdown — stocks below 200MA, declining</option>
      </optgroup>
    `;
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
function getStrategyDisplayName(strategyVersionId, rawNameOverride = '') {
  const spec = strategyCatalog.get(strategyVersionId) || {};
  const rawName = String(rawNameOverride || spec?.name || strategyVersionId || '').trim();
  return window.SweepNameUtils?.normalizeStrategyDisplayName({
    rawName,
    strategyVersionId,
    strategyId: spec?.strategy_id || strategyVersionId,
    version: spec?.version,
  }) || rawName;
}

function stripStrategyNameSuffixes(name) {
  return String(name || '')
    .replace(/\s*—.*$/, '')          // strip everything from first em-dash (param suffixes)
    .replace(/\s*\[v\d+\]/gi, '')    // strip [v1], [v2] etc
    .replace(/\s*\[Sweep Winner\]/gi, '')
    .replace(/\s+v\d+$/i, '')
    .trim();
}

function updateStrategyDisplay(strategyVersionId) {
  const display = document.getElementById('sweep-strategy-display');
  if (!display) return;
  const spec = strategyCatalog.get(strategyVersionId);
  if (!strategyVersionId || spec?._not_found) {
    display.innerHTML = `
      <div class="sweep-name" style="font-style:italic;color:var(--color-text-muted);">No strategy selected</div>
      <div class="sweep-meta">Go to Strategy list and use "Send to Sweep"</div>`;
    return;
  }
  const rawName = String(spec?.name || strategyVersionId);
  const displayName = getStrategyDisplayName(strategyVersionId, rawName) || rawName;
  const interval = spec?.interval || '';
  const stage = String(spec?.sweep_stage || '').toUpperCase();
  const stageMeta = [interval, stage].filter(Boolean).join(' · ');
  display.innerHTML = `
    <div class="sweep-name" title="${reportEscHtml(rawName)}">${reportEscHtml(displayName)}</div>
    ${stageMeta ? `<div class="sweep-meta">${reportEscHtml(stageMeta)}</div>` : ''}`;
}

async function loadStrategies() {
  try {
    const res = await fetch(`${API}/sweep/strategies/list`);
    const data = await res.json();
    const select = document.getElementById('sweep-strategy-select');

    // Populate the hidden select and catalog — no visible dropdown needed
    const items = data.data || [];
    select.innerHTML = '<option value=""></option>';
    items.forEach(s => {
      const existing = strategyCatalog.get(s.strategy_version_id) || {};
      strategyCatalog.set(s.strategy_version_id, { ...existing, ...s });
      const opt = document.createElement('option');
      opt.value = s.strategy_version_id;
      select.appendChild(opt);
    });
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
  // Already fetched full spec
  if (existing && (existing.structure_config || existing.setup_config || existing.risk_config || existing.entry_config || existing.exit_config)) {
    return existing;
  }
  // Previously returned 404 — don't retry
  if (existing?._not_found) return null;

  try {
    const res = await fetch(`${API}/validator/strategy/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      strategyCatalog.set(id, { _not_found: true });
      return null;
    }
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
  const group = document.getElementById('suggested-values-group');
  const help = document.getElementById('custom-param-help');
  if (!container) return;

  const preset = resolvePresetDef(presetKey);
  if (!preset) {
    if (group) group.style.display = 'none';
    if (help) help.style.display = 'none';
    return;
  }

  // Show path hint in the help element, but only as a small mono hint
  if (help) {
    help.textContent = preset.param_path;
    help.style.display = 'block';
  }

  if (group) group.style.display = preset.values.length > 0 ? 'flex' : 'none';

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
  if (!summary || !text) return;

  const primary = getPrimarySweepParamConfig();

  let line1 = '';
  if (primary.path && primary.values.length > 0) {
    line1 = `${primary.label}: ${primary.values.join(', ')}`;
  }

  let line2 = '';
  if (secondSlot.active && secondSlot.values.length > 0 && secondSlot.label) {
    line2 = `${secondSlot.label}: ${secondSlot.values.join(', ')}`;
  }

  if (line1) {
    text.textContent = line2 ? `${line1}  ×  ${line2}` : line1;
    summary.style.display = 'block';
  } else {
    summary.style.display = 'none';
  }
}

function updateRunButton() {
  const strategy = getConfiguredStrategyVersionId();
  const activeDims = getActiveDimParams();
  const primary = getPrimarySweepParamConfig();

  // A sweep is valid if:
  // (a) a strategy is selected AND
  // (b) EITHER a strategy-specific param has values OR at least one universal dim has values
  const hasStrategyParam = primary.values.length > 0 && primary.path;
  const hasUniversalDim = activeDims.length > 0;
  let disabled = !strategy || (!hasStrategyParam && !hasUniversalDim);

  if (secondSlot.active && hasStrategyParam) {
    const hasSecond = secondSlot.values.length > 0 && secondSlot.paramPath;
    const gridSize = primary.values.length * secondSlot.values.length;
    disabled = disabled || !hasSecond || gridSize > 20 || gridSize === 0;
  }

  // Check total variant count across all axes
  const primaryCount = hasStrategyParam
    ? (secondSlot.active
        ? primary.values.length * (secondSlot.values.length || 1)
        : primary.values.length)
    : 1; // no strategy param = 1 "variant" per dim combo
  const dimsProduct = activeDims.length > 0
    ? activeDims.reduce((acc, d) => acc * d.values.length, 1)
    : 1;
  const totalVariants = primaryCount * dimsProduct;

  if (totalVariants > 20) disabled = true;

  const btn = document.getElementById('btn-run-sweep');
  if (btn) {
    btn.disabled = disabled;
    btn.title = totalVariants > 20
      ? `${totalVariants} variants (max 20) — reduce selections`
      : totalVariants > 1 ? `${totalVariants} total variants` : '';
  }
  renderGridControls();
  renderUniversalDimsVariantCount();
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

function getPrimarySweepParamConfig() {
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');
  const manualPath = pathInput?.value?.trim() || '';
  const manualLabel = labelInput?.value?.trim() || manualPath;

  if (selectedPreset) {
    const preset = resolvePresetDef(selectedPreset);
    if (preset) {
      return {
        path: preset.param_path || manualPath,
        label: preset.label || manualLabel,
        values: Array.isArray(preset.values) ? [...preset.values] : [],
      };
    }
  }

  return {
    path: manualPath,
    label: manualLabel,
    values: Array.isArray(customValues) ? [...customValues] : [],
  };
}

// ─── Grid sweep: second parameter slot ─────────────────────────────────────────

function renderGridControls() {
  const container = document.getElementById('sweep-grid-controls');
  if (!container) return;
  const primary = getPrimarySweepParamConfig();

  if (!secondSlot.active) {
    const hasFirstParam = primary.values.length > 0 && primary.path;
    container.innerHTML = hasFirstParam
      ? `<button type="button" onclick="addSecondParamSlot()" class="strategy-grid-add-btn">
          <strong>Grid Sweep</strong>
          + Add 2nd Parameter
        </button>`
      : '';
    return;
  }

  const gridSize = primary.values.length * secondSlot.values.length;
  const overCap = gridSize > 20;
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-8) var(--space-10);background:${overCap ? 'color-mix(in srgb, var(--color-negative) 8%, transparent)' : 'color-mix(in srgb, var(--color-accent) 8%, transparent)'};border:1px solid ${overCap ? 'var(--color-negative)' : 'color-mix(in srgb, var(--color-accent) 30%, transparent)'};border-radius:var(--radius-sm);">
      <span style="font-size:var(--text-caption);font-family:var(--font-mono);color:${overCap ? 'var(--color-negative)' : 'var(--color-accent)'};">
        Grid: ${primary.values.length} × ${secondSlot.values.length} = <strong>${gridSize}</strong> variants${overCap ? ' (max 20)' : ''}
      </span>
    </div>`;
}

function addSecondParamSlot() {
  secondSlot.active = true;
  const slot = document.getElementById('sweep-param-slot-2');
  if (!slot) return;
  slot.style.display = 'block';

  const entries = getPresetEntries();
  const groupsHtml = ANATOMY_GROUPS.map(group => {
    const options = entries
      .filter(([, preset]) => preset.anatomy === group.key)
      .map(([key, preset]) => `<option value="${key}">${preset.label}</option>`)
      .join('');
    return options ? `<optgroup label="${group.label}">${options}</optgroup>` : '';
  }).join('');

  slot.innerHTML = `
    <div class="sweep-section" style="border-top:1px solid var(--color-border);padding-top:var(--space-12);">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="sweep-section-label" style="border:none;padding:0;">2nd Parameter</div>
        <button type="button" onclick="removeSecondParamSlot()" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:14px;padding:0 4px;" title="Remove 2nd parameter">×</button>
      </div>
      <div class="form-group">
        <select id="custom-param-select-2" class="form-select">
          <option value="">Choose a parameter...</option>
          ${groupsHtml}
        </select>
        <div id="custom-param-help-2" class="custom-param-help" style="display:none;"></div>
      </div>
      <div class="form-group" id="suggested-values-group-2" style="display:none;">
        <label class="form-label">Suggested Values</label>
        <div id="suggested-values-2" class="suggested-values"></div>
      </div>
      <details class="advanced-custom-details">
        <summary>Advanced Path</summary>
        <div class="advanced-custom-body">
          <div class="form-group">
            <label class="form-label">Parameter Path</label>
            <input id="custom-param-path-2" class="form-input" type="text" placeholder="e.g. setup_config.ote_zone_max" />
          </div>
          <div class="form-group">
            <label class="form-label">Label</label>
            <input id="custom-param-label-2" class="form-input" type="text" placeholder="e.g. OTE Zone Max" />
          </div>
        </div>
      </details>
      <div class="form-group">
        <label class="form-label">Values to Test</label>
        <div class="values-pills" id="values-pills-2"></div>
        <div class="add-value-row">
          <input id="add-value-input-2" type="text" placeholder="e.g. 0.79" />
          <button onclick="addSecondSlotValue()">+ Add</button>
        </div>
      </div>
    </div>`;

  const card = slot.firstElementChild;
  const cardHeader = card?.firstElementChild;
  const title = cardHeader?.querySelector('.sweep-section-label');
  const removeBtn = cardHeader?.querySelector('button');
  if (card) {
    card.classList.add('strategy-param-card');
    card.style.borderTop = 'none';
    card.style.paddingTop = '';
  }
  if (cardHeader) {
    cardHeader.classList.add('strategy-param-card-header');
    const helper = document.createElement('div');
    helper.className = 'strategy-param-subsection-help';
    helper.textContent = 'Add a second knob to run a grid sweep across both parameter sets.';
    if (title) {
      title.classList.add('strategy-param-subsection-title');
      title.after(helper);
    }
  }
  if (removeBtn) {
    removeBtn.className = 'strategy-param-subsection-remove';
    removeBtn.textContent = '×';
  }

  const select2 = document.getElementById('custom-param-select-2');
  if (select2) {
    select2.onchange = () => {
      const key = select2.value;
      if (!key) {
        renderSecondSlotSuggestedValues('');
        return;
      }
      applySecondSlotPreset(key);
    };
  }
  const input2 = document.getElementById('add-value-input-2');
  if (input2) {
    input2.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addSecondSlotValue(); }
    });
  }
  renderGridControls();
  updateRunButton();
}

function removeSecondParamSlot() {
  secondSlot = { active: false, paramPath: '', label: '', values: [] };
  const slot = document.getElementById('sweep-param-slot-2');
  if (slot) { slot.style.display = 'none'; slot.innerHTML = ''; }
  renderGridControls();
  updateSelectedSummary();
  updateRunButton();
}

function applySecondSlotPreset(presetKey) {
  const preset = resolvePresetDef(presetKey);
  if (!preset) return;
  const pathInput = document.getElementById('custom-param-path-2');
  const labelInput = document.getElementById('custom-param-label-2');
  if (pathInput) pathInput.value = preset.param_path;
  if (labelInput) labelInput.value = preset.label;
  secondSlot.paramPath = preset.param_path;
  secondSlot.label = preset.label;
  secondSlot.values = [...preset.values];
  renderSecondSlotPills();
  renderSecondSlotSuggestedValues(presetKey);
  renderGridControls();
  updateSelectedSummary();
  updateRunButton();
}

function renderSecondSlotSuggestedValues(presetKey = '') {
  const container = document.getElementById('suggested-values-2');
  const group = document.getElementById('suggested-values-group-2');
  const help = document.getElementById('custom-param-help-2');
  if (!container) return;
  const preset = resolvePresetDef(presetKey);
  if (!preset) {
    if (group) group.style.display = 'none';
    if (help) help.style.display = 'none';
    return;
  }
  if (help) { help.textContent = preset.param_path; help.style.display = 'block'; }
  if (group) group.style.display = preset.values.length > 0 ? 'flex' : 'none';
  container.innerHTML = preset.values.map(value => {
    const normalized = String(value);
    const active = secondSlot.values.some(item => String(item) === normalized);
    return `<button type="button" class="suggested-value-btn${active ? ' active' : ''}" onclick="toggleSecondSlotSuggestedValue('${reportEscHtml(normalized)}')">${reportEscHtml(normalized)}</button>`;
  }).join('');
}

function toggleSecondSlotSuggestedValue(rawValue) {
  const value = isNaN(Number(rawValue)) ? rawValue : Number(rawValue);
  const idx = secondSlot.values.findIndex(item => String(item) === String(value));
  if (idx >= 0) { secondSlot.values.splice(idx, 1); } else { secondSlot.values.push(value); }
  renderSecondSlotPills();
  renderSecondSlotSuggestedValues(document.getElementById('custom-param-select-2')?.value || '');
  renderGridControls();
  updateSelectedSummary();
  updateRunButton();
}

function addSecondSlotValue() {
  const input = document.getElementById('add-value-input-2');
  const raw = input?.value?.trim();
  if (!raw) return;
  const val = isNaN(Number(raw)) ? raw : Number(raw);
  if (!secondSlot.values.some(v => String(v) === String(val))) {
    secondSlot.values.push(val);
    const pathInput = document.getElementById('custom-param-path-2');
    const labelInput = document.getElementById('custom-param-label-2');
    if (pathInput) secondSlot.paramPath = pathInput.value.trim();
    if (labelInput) secondSlot.label = labelInput.value.trim();
    renderSecondSlotPills();
    renderGridControls();
    updateSelectedSummary();
    updateRunButton();
  }
  if (input) { input.value = ''; input.focus(); }
}

function removeSecondSlotValue(idx) {
  secondSlot.values.splice(idx, 1);
  renderSecondSlotPills();
  renderGridControls();
  updateSelectedSummary();
  updateRunButton();
}

function renderSecondSlotPills() {
  const container = document.getElementById('values-pills-2');
  if (!container) return;
  container.innerHTML = '';
  secondSlot.values.forEach((v, i) => {
    const pill = document.createElement('span');
    pill.className = 'value-pill';
    pill.innerHTML = `${v} <button onclick="removeSecondSlotValue(${i})" title="Remove">×</button>`;
    container.appendChild(pill);
  });
}

// ─── Misc helpers ──────────────────────────────────────────────────────────────

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
  if (normalized === 'tier1s') return 'Tier 1S';
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
  if (stage === 'tier1s') return 'T1S';
  if (stage === 'tier1b') return 'T1B';
  if (stage === 'tier1') return 'T1';
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

  const baseStrategyId = String(sweep?.base_strategy_version_id || '').trim();
  const baseName = getStrategyDisplayName(baseStrategyId, getStrategyName(baseStrategyId)) || getStrategyName(baseStrategyId);

  // Look up session version number from the module-level map populated by the session list
  const vNum = sweepVersionMap.get(sweep.sweep_id);
  const versionTag = vNum ? ` · V${vNum}` : '';

  resultsLoadedStrategy.textContent = baseName
    ? `Loaded: ${baseName}${versionTag}`
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
  // Use the promoted strategy if one exists (that's the winner from this sweep,
  // and clicking V3 means you want to sweep ON TOP of V3's result).
  // Fall back to the base strategy if nothing was promoted yet.
  const restoreStrategyVersionId = String(sweep?.promoted_strategy_version_id || sweep?.base_strategy_version_id || '').trim()
    || getSweepDisplayStrategyId(sweep);

  if (!strategySelect || !tierSelect || !param || !restoreStrategyVersionId) return;

  // Keep hidden select in sync
  if (!strategySelect.querySelector(`option[value="${CSS.escape(restoreStrategyVersionId)}"]`)) {
    const opt = document.createElement('option');
    opt.value = restoreStrategyVersionId;
    strategySelect.appendChild(opt);
  }
  strategySelect.value = restoreStrategyVersionId;

  activeConfiguredStrategyVersionId = restoreStrategyVersionId;
  persistActiveStrategyId(restoreStrategyVersionId);
  updateStrategyDisplay(restoreStrategyVersionId);
  renderStrategyAnatomy();
  configureSweepTierSelector();
  setupCustomParameterPicker();
  renderLoadedSweepBanner(sweep);

  if (tierSelect.querySelector(`option[value="${sweep.tier}"]`)) {
    tierSelect.value = sweep.tier;
  }

  // Always restore as explicit sweep_params (path + values) — never as a named
  // backend preset, since dropdown picker keys are frontend-only and unknown to the backend.
  const pickerKey = findPresetKeyForParam(param) || findPresetKeyByPath(param.param_path);
  clearPresetSelection();
  customValues = Array.isArray(param.values) ? [...param.values] : [];
  if (pathInput) pathInput.value = param.param_path || '';
  if (labelInput) labelInput.value = param.label || '';
  setCustomParameterPickerValue(pickerKey);

  if (valueInput) valueInput.value = '';
  renderValuePills();

  // Restore second param slot if this was a grid sweep
  const param2 = sweep?.sweep_params?.[1];
  if (param2) {
    addSecondParamSlot();
    secondSlot.paramPath = param2.param_path || '';
    secondSlot.label = param2.label || '';
    secondSlot.values = Array.isArray(param2.values) ? [...param2.values] : [];
    const pathInput2 = document.getElementById('custom-param-path-2');
    const labelInput2 = document.getElementById('custom-param-label-2');
    if (pathInput2) pathInput2.value = secondSlot.paramPath;
    if (labelInput2) labelInput2.value = secondSlot.label;
    const pickerKey2 = findPresetKeyForParam(param2) || findPresetKeyByPath(param2.param_path);
    const select2 = document.getElementById('custom-param-select-2');
    if (select2 && pickerKey2) select2.value = pickerKey2;
    renderSecondSlotPills();
    renderSecondSlotSuggestedValues(pickerKey2 || '');
  } else {
    removeSecondParamSlot();
  }

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

function reportFormatRawPct(value, digits = 2) {
  return `${reportNum(value).toFixed(digits)}%`;
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

  const copyId = `copy-sweep-criteria-btn-${Math.random().toString(36).slice(2, 8)}`;
  const displayVerdict = getDisplayVerdict(report).replace('_', ' ');
  const copyText = checks.map(c => `${c.label}\t${c.threshold}\t${c.actual}\t${c.ok ? 'pass' : 'fail'}`).join('\n') + `\nFinal verdict: ${displayVerdict}`;

  html += `
    <div style="margin-top:var(--space-10);display:flex;align-items:center;gap:var(--space-12);">
      <div style="font-size:var(--text-caption);color:var(--color-text-subtle);">
        Final verdict: <span class="verdict-badge ${getDisplayVerdict(report)}" style="margin-left:var(--space-6);">${displayVerdict}</span>
      </div>
      <button id="${copyId}" style="font-size:var(--text-caption);padding:var(--space-4) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);color:var(--color-text-subtle);cursor:pointer;">Copy</button>
    </div>
  `;
  html += `</div>`;

  setTimeout(() => {
    const btn = document.getElementById(copyId);
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });
  }, 0);

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
  const valuation = r.valuation_validation || {};
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

  if (valuation.enabled && valuation.status === 'completed') {
    const selected = valuation.selected || {};
    const excluded = valuation.excluded || {};
    const spread = valuation.spread || {};
    const observations = valuation.observations || {};
    const vcfg = valuation.config || {};
    const forwardBars = reportInt(vcfg.forward_bars);
    const holdLabel = forwardBars > 0 ? `${forwardBars} bars` : 'N/A';
    const spreadPct = spread.avg_spread_pct ?? spread.avg_return_spread_pct;
    const hitRatePct = spread.hit_rate_pct ?? (spread.hit_rate == null ? null : reportNum(spread.hit_rate) * 100);
    const rebalancePeriods = observations.rebalance_periods ?? spread.periods ?? selected.periods;
    const selectedObs = observations.selected_obs ?? observations.selected;
    const excludedObs = observations.excluded_obs ?? observations.excluded;

    html += `<div class="section-title">Valuation Basket Test</div>`;
    html += `<div class="metrics-grid cols-5" style="margin-bottom:var(--space-12);">`;
    html += reportMetricCard('Selected Avg', reportFormatRawPct(selected.avg_forward_return_pct), reportNum(selected.avg_forward_return_pct) > 0);
    html += reportMetricCard('Excluded Avg', reportFormatRawPct(excluded.avg_forward_return_pct));
    html += reportMetricCard('Spread', reportFormatRawPct(spreadPct), reportNum(spreadPct) > 0);
    html += reportMetricCard('Hit Rate', reportFormatRawPct(hitRatePct, 1), reportNum(hitRatePct) >= 50);
    html += reportMetricCard('T-Stat', reportNum(spread.t_stat).toFixed(2), reportNum(spread.t_stat) > 2);
    html += reportMetricCard('Rebalance Periods', reportInt(rebalancePeriods));
    html += reportMetricCard('Selected Obs.', reportInt(selectedObs));
    html += reportMetricCard('Excluded Obs.', reportInt(excludedObs));
    html += reportMetricCard('No Valuation', reportInt(observations.no_valuation));
    html += reportMetricCard('Valuation Hold', holdLabel);
    html += `</div>`;
    html += `
      <div class="metric-card" style="font-size:var(--text-caption);color:var(--color-text-muted);line-height:1.6;margin-bottom:var(--space-12);">
        Tests DCF as a permission-to-buy basket: rebalance ${reportEscHtml(String(vcfg.rebalance_frequency || 'monthly'))},
        hold ${reportEscHtml(holdLabel)}, select symbols where DCF state is ${reportEscHtml(String(vcfg.target_state || 'undervalued'))}
        at ${reportNum(vcfg.gap_threshold_pct).toFixed(1)}% threshold, compare against symbols with known non-selected valuation states.
      </div>
    `;
  } else if (valuation.enabled && valuation.status) {
    html += `<div class="section-title">Valuation Basket Test</div>`;
    html += `<div class="metric-card" style="font-size:var(--text-small);color:var(--color-text-muted);margin-bottom:var(--space-12);">
      ${reportEscHtml(valuation.reason || `Valuation basket status: ${valuation.status}`)}
    </div>`;
  }

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

async function deleteSweepVariant(sweepId, variantId) {
  if (!sweepId || !variantId) return;
  const ok = window.confirm('Delete this variant card from the sweep results?');
  if (!ok) return;

  try {
    const res = await fetch(`${API}/sweep/${encodeURIComponent(sweepId)}/variants/${encodeURIComponent(variantId)}/delete`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to delete variant');

    selectedComparisonVariantIds.delete(variantId);
    if (selectedSweepVariantId === variantId) {
      selectedSweepVariantId = null;
      selectedSweepReportId = null;
    }
    if (activeSweepId === sweepId) {
      await fetchAndRenderSweep(sweepId);
    }
    showToast('Variant deleted', 'success');
  } catch (e) {
    alert(`Failed to delete variant: ${e.message}`);
  }
}

async function deleteSweepHistoryItem(sweepId) {
  if (!sweepId) return;
  const ok = window.confirm('Delete this sweep step and all linked reports/trades?');
  if (!ok) return;

  try {
    const res = await fetch(`${API}/sweep/${encodeURIComponent(sweepId)}/delete`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to delete sweep');

    if (activeSweepId === sweepId) {
      activeSweepId = null;
      persistActiveSweepId('');
      selectedComparisonVariantIds.clear();
      selectedSweepVariantId = null;
      selectedSweepReportId = null;
      activeSweepReferenceKey = null;
      activeSweepReferenceReportId = null;
      renderLoadingState('');
      document.getElementById('results-body').innerHTML = '<div style="padding:var(--space-16);color:var(--color-text-subtle);">No sweep loaded.</div>';
    }

    await loadRecentSweeps();
    showToast('Sweep deleted', 'success');
  } catch (e) {
    alert(`Failed to delete sweep: ${e.message}`);
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
        <div style="display:flex;gap:var(--space-8);">
          <button class="sweep-inline-btn" id="copy-compare-table-btn">Copy Table</button>
          <button class="sweep-inline-btn" onclick="clearSweepComparison()">Clear Compare</button>
        </div>
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
    let label;
    if (entry.isReference) {
      label = 'Original Validator';
    } else if (Array.isArray(entry.variant?.param_values) && entry.variant.param_values.length > 1) {
      label = entry.variant.param_values.map(pv => `${reportEscHtml(String(pv.value))}`).join(' / ');
    } else {
      label = `Value ${reportEscHtml(String(entry.variant.param_value))}`;
    }
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

  // Build copy text for the comparison table
  const headerRow = ['Variant', ...criteria.map(c => c.key)].join('\t');
  const dataRows = rows.map(entry => {
    let copyLabel;
    if (entry.isReference) { copyLabel = 'Original Validator'; }
    else if (Array.isArray(entry.variant?.param_values) && entry.variant.param_values.length > 1) {
      copyLabel = entry.variant.param_values.map(pv => String(pv.value)).join(' / ');
    } else { copyLabel = `Value ${String(entry.variant.param_value)}`; }
    return [copyLabel, ...criteria.map(c => String(c.value(entry)))].join('\t');
  });
  const compareTableText = [headerRow, ...dataRows].join('\n');

  setTimeout(() => {
    const btn = document.getElementById('copy-compare-table-btn');
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(compareTableText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Table', 1500);
      });
    });
  }, 0);

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
    const primary = getPrimarySweepParamConfig();
    const path = primary.path;
    const label = primary.label;
    const values = primary.values;
    const activeDims = getActiveDimParams();

    if (!path && activeDims.length === 0) {
      throw new Error('Select at least one Universal Dimension or Strategy Parameter to sweep.');
    }
    if (path && values.length === 0 && activeDims.length === 0) {
      throw new Error('No values to test — select suggested values or add custom ones.');
    }

    // Build all axes as a flat sweep_params array.
    // Strategy-specific param comes first (if any); universal dims are sent separately
    // and merged by the backend into additional Cartesian axes.
    const sweepParams = [];
    if (path && values.length > 0) {
      sweepParams.push({ label, param_path: path, values });
      if (secondSlot.active && secondSlot.values.length > 0 && secondSlot.paramPath) {
        sweepParams.push({ label: secondSlot.label || secondSlot.paramPath, param_path: secondSlot.paramPath, values: secondSlot.values });
      }
    } else if (activeDims.length > 0) {
      // No strategy param — use first universal dim as the primary axis
      const first = activeDims[0];
      sweepParams.push({ label: first.label, param_path: first.param_path, values: first.values });
    }
    body.sweep_params = sweepParams;

    // Remaining universal dims (all of them if strategy param exists, or all-but-first if not)
    const dimsForBackend = (path && values.length > 0) ? activeDims : activeDims.slice(1);
    if (dimsForBackend.length > 0) {
      body.universal_dims = dimsForBackend;
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
  const isGrid = (sweep.sweep_params?.length || 0) > 1;
  const showValuationCols = (sweep.sweep_params || []).some(sp => String(sp?.param_path || '') === 'fundamental_config.forward_bars')
    || (sweep.variants || []).some(v => v?.metrics?.valuation?.enabled);
  const paramHeaders = isGrid
    ? sweep.sweep_params.map(sp => `<th>${reportEscHtml(sp.label || sp.param_path || 'Param')}</th>`).join('')
    : `<th>${reportEscHtml(sweep.sweep_params?.[0]?.label || 'Parameter')}</th>`;
  const valuationHeaders = showValuationCols
    ? `
            <th>Selected Avg</th>
            <th>Excluded Avg</th>
            <th>Spread</th>
            <th>Hit Rate</th>
            <th>T-Stat</th>
            <th>Val Obs.</th>`
    : '';
  html += `
    <div style="overflow-x:auto;">
      <table class="results-table">
        <thead>
          <tr>
            <th>Compare</th>
            ${paramHeaders}
            <th>Status</th>
            <th>Tier Result</th>
            <th>Trades</th>
            <th>Expectancy</th>
            <th>Win Rate</th>
            <th>Profit Factor</th>
            <th>Max DD</th>
            <th>Sharpe</th>
            <th>Fitness</th>
            ${valuationHeaders}
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
    const val = m?.valuation || null;
    const verdict = getDisplayVerdict(m || {});
    const actionHtml = v.status === 'completed'
      ? `<div class="sweep-action-group">
          <button class="sweep-inline-btn" onclick="viewSweepReport('${v.report_id || ''}','${v.variant_id}')">Report</button>
          <button class="sweep-inline-btn" onclick="promoteWinner('${sweep.sweep_id}','${v.variant_id}')">Promote</button>
          <button class="sweep-inline-btn" onclick="deleteSweepVariant('${sweep.sweep_id}','${v.variant_id}')">Delete</button>
        </div>`
      : (v.status === 'failed' || v.status === 'pending')
        ? `<div class="sweep-action-group">
            <button class="sweep-inline-btn" onclick="deleteSweepVariant('${sweep.sweep_id}','${v.variant_id}')">Delete</button>
          </div>`
        : 'N/A';
    const fmt = (n, digits = 2) => n != null ? Number(n).toFixed(digits) : '—';
    const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';
    const valuationCells = showValuationCols
      ? `
        <td>${val ? fmtPct(val.selected_avg_pct) : 'N/A'}</td>
        <td>${val ? fmtPct(val.excluded_avg_pct) : 'N/A'}</td>
        <td style="color:${val && Number(val.spread_pct) > 0 ? 'var(--color-positive)' : val && Number(val.spread_pct) < 0 ? 'var(--color-negative)' : 'inherit'}">${val ? fmtPct(val.spread_pct) : 'N/A'}</td>
        <td>${val ? fmtPct(val.hit_rate_pct) : 'N/A'}</td>
        <td style="color:${val && Math.abs(Number(val.t_stat || 0)) >= 2 ? 'var(--color-positive)' : 'inherit'}">${val ? fmt(val.t_stat) : 'N/A'}</td>
        <td>${val ? `${reportEscHtml(String(val.selected_obs ?? 'N/A'))} / ${reportEscHtml(String(val.excluded_obs ?? 'N/A'))}` : 'N/A'}</td>`
      : '';
    const compareHtml = v.status === 'completed' && v.report_id
      ? `<label class="sweep-compare-toggle"><input type="checkbox" ${selectedComparisonVariantIds.has(v.variant_id) ? 'checked' : ''} onchange="toggleSweepComparison('${v.variant_id}','${v.report_id || ''}')"><span>Compare</span></label>`
      : '<span class="text-muted">—</span>';

    const paramCells = isGrid && Array.isArray(v.param_values)
      ? v.param_values.map(pv => `<td style="font-weight:600;color:${isWinner ? 'var(--color-positive)' : 'var(--color-text)'}">${reportEscHtml(String(pv.value))}</td>`).join('')
      : `<td style="font-weight:600; color:${isWinner ? 'var(--color-positive)' : 'var(--color-text)'}">
          ${v.param_value}${typeof v.param_value === 'number' && v.param_value < 1 && v.param_path?.includes('stop_value') ? ' (' + (v.param_value * 100).toFixed(0) + '%)' : ''}
        </td>`;

    html += `
      <tr class="${rowClass}">
        <td>${compareHtml}</td>
        ${paramCells}
        <td>${statusBadge}</td>
        <td><span class="verdict-badge ${verdict}">${verdict.replace('_', ' ')}</span></td>
        <td>${m ? m.total_trades : '—'}</td>
        <td style="color:${m && m.expectancy_R > 0 ? 'var(--color-positive)' : m && m.expectancy_R < 0 ? 'var(--color-negative)' : 'inherit'}">${m ? fmt(m.expectancy_R) + 'R' : '—'}</td>
        <td>${m ? fmtPct(m.win_rate * 100) : '—'}</td>
        <td>${m ? fmt(m.profit_factor) : '—'}</td>
        <td style="color:${m && m.max_drawdown_pct > 30 ? 'var(--color-negative)' : 'inherit'}">${m ? fmtPct(m.max_drawdown_pct) : '—'}</td>
        <td>${m ? fmt(m.sharpe_ratio) : '—'}</td>
        <td style="font-weight:600; color:${m && m.fitness_score > 0.5 ? 'var(--color-positive)' : 'inherit'}">${m ? fmt(m.fitness_score, 3) : '—'}</td>
        ${valuationCells}
        <td>${actionHtml}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';

  // Build copy text
  const copyParamHeaders = isGrid
    ? sweep.sweep_params.map(sp => sp.label || sp.param_path || 'Param').join('\t')
    : (sweep.sweep_params?.[0]?.label || 'Parameter');
  const copyValuationHeader = showValuationCols ? '\tSelected Avg\tExcluded Avg\tSpread\tHit Rate\tT-Stat\tVal Obs.' : '';
  const copyHeader = `${copyParamHeaders}\tStatus\tTier Result\tTrades\tExpectancy\tWin Rate\tProfit Factor\tMax DD\tSharpe\tFitness${copyValuationHeader}`;
  const copyRows = sorted.map(v => {
    const m = v.metrics;
    const val = m?.valuation || null;
    const isWinner = sweep.winner?.variant_id === v.variant_id;
    const status = isWinner ? 'Winner' : v.status;
    const paramValStr = isGrid && Array.isArray(v.param_values)
      ? v.param_values.map(pv => String(pv.value)).join('\t')
      : String(v.param_value);
    const valCopy = showValuationCols
      ? `\t${val?.selected_avg_pct != null ? val.selected_avg_pct.toFixed(2) + '%' : 'n/a'}\t${val?.excluded_avg_pct != null ? val.excluded_avg_pct.toFixed(2) + '%' : 'n/a'}\t${val?.spread_pct != null ? val.spread_pct.toFixed(2) + '%' : 'n/a'}\t${val?.hit_rate_pct != null ? val.hit_rate_pct.toFixed(1) + '%' : 'n/a'}\t${val?.t_stat != null ? val.t_stat.toFixed(2) : 'n/a'}\t${val ? `${val.selected_obs ?? 'n/a'} / ${val.excluded_obs ?? 'n/a'}` : 'n/a'}`
      : '';
    if (!m) return `${paramValStr}\t${status}\tN/A\tN/A\tN/A\tN/A\tN/A\tN/A\tN/A${valCopy}`;
    return `${paramValStr}\t${status}\t${m.total_trades}\t${m.expectancy_R.toFixed(2)}R\t${(m.win_rate * 100).toFixed(1)}%\t${m.profit_factor.toFixed(2)}\t${m.max_drawdown_pct.toFixed(1)}%\t${m.sharpe_ratio.toFixed(2)}\t${m.fitness_score.toFixed(3)}${valCopy}`;
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
    const winnerLabel = isGrid && Array.isArray(w.param_values)
      ? w.param_values.map(pv => `${pv.label} = ${pv.value}`).join(', ')
      : `${sweep.sweep_params?.[0]?.label || 'Parameter'} = ${w.param_value}`;
    html += `
      <div class="winner-banner">
        <div class="winner-banner-text">
          ★ Winner: <strong>${reportEscHtml(winnerLabel)}</strong>
          &nbsp;·&nbsp; ${w.metrics.total_trades} trades
          &nbsp;·&nbsp; ${w.metrics.expectancy_R.toFixed(3)}R expectancy
          &nbsp;·&nbsp; fitness ${w.metrics.fitness_score.toFixed(3)}
        </div>
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
    const reportContext = {
      param_value: reportVariant.param_value,
      winner_value: sweep.winner?.param_value,
    };
    if (isGrid && Array.isArray(reportVariant.param_values) && reportVariant.param_values.length > 1) {
      reportContext.param_value = reportVariant.param_values.map(pv => `${pv.label}=${pv.value}`).join(', ');
    }
    if (isGrid && Array.isArray(sweep.winner?.param_values) && sweep.winner.param_values.length > 1) {
      reportContext.winner_value = sweep.winner.param_values.map(pv => `${pv.label}=${pv.value}`).join(', ');
    }
    html += renderSweepReportDetail(report, reportContext);
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
    const newId = data.data.strategy_version_id;
    showToast(`Promoted: ${newId}`, 'success');

    // Switch dropdown to promoted strategy but keep session cards from the previous strategy visible
    const previousStrategyId = getConfiguredStrategyVersionId();
    await loadStrategyCatalog();
    await switchToStrategy(newId, { skipLoadSweeps: true });
    await _loadRecentSweepsImpl(previousStrategyId);

    // Show banner with link to open in validator (no forced redirect)
    const bannerEl = document.getElementById('sweep-promote-banner');
    if (bannerEl) {
      bannerEl.innerHTML = `<span>Winner promoted as <strong>${reportEscHtml(newId)}</strong> — now selected as base strategy.</span>
        <a class="sweep-inline-btn" href="/validator.html?strategy_version_id=${encodeURIComponent(newId)}" target="_blank" style="margin-left:12px;">Open in Validator</a>`;
      bannerEl.style.display = 'flex';
    }
  } catch (e) {
    alert(`Failed to promote: ${e.message}`);
  }
}

// ─── Send to Validator ─────────────────────────────────────────────────────────

async function sendToValidator(strategyVersionId) {
  if (!strategyVersionId) return;
  try {
    // Flip status to "testing" so the validator can see it
    await fetch(`${API}/strategies/${encodeURIComponent(strategyVersionId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'testing' }),
    });
  } catch (e) {
    // Non-fatal — open anyway, validator may still find it
    console.warn('Could not update strategy status:', e);
  }
  window.open(`/validator.html?strategy_version_id=${encodeURIComponent(strategyVersionId)}`, '_blank');
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bg = type === 'success' ? 'var(--color-positive)' : type === 'error' ? 'var(--color-negative)' : 'var(--color-accent)';
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:6px;background:${bg};color:#fff;font-size:13px;font-family:var(--font-mono);box-shadow:0 4px 16px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.2s;max-width:420px;word-break:break-all;`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Recent sweeps ─────────────────────────────────────────────────────────────

async function loadRecentSweepsForStrategy(strategyId) {
  return _loadRecentSweepsImpl(strategyId);
}

async function loadRecentSweeps() {
  return _loadRecentSweepsImpl(getConfiguredStrategyVersionId());
}

async function _loadRecentSweepsImpl(strategyId) {
  try {
    const sweepsData = await fetchSweepSummaries(true);
    const list = document.getElementById('sweep-history-list');

    const currentStrategyId = strategyId;

    // Match sessions where this strategy was the base, OR where this strategy
    // was promoted as a winner (so promoted versions still show parent sessions).
    // If a session boundary is active, only show sweeps created after it.
    const sessionCutoff = sessionStartedAt ? new Date(sessionStartedAt).getTime() : 0;

    let sweeps = (sweepsData || [])
      .filter(s => {
        if (!currentStrategyId) return false;
        if (sessionCutoff && new Date(s.created_at || 0).getTime() < sessionCutoff) return false;
        const baseMatch = String(s?.base_strategy_version_id || '').trim() === currentStrategyId;
        const promotedMatch = String(s?.promoted_strategy_version_id || '').trim() === currentStrategyId;
        return baseMatch || promotedMatch;
      })
      .slice(0, 20);

    // If the session cutoff hides everything, fall back to this strategy's
    // recent sweeps so a refresh does not leave the UI looking empty.
    if (sweeps.length === 0 && currentStrategyId && sessionCutoff) {
      sweeps = (sweepsData || [])
        .filter(s => {
          const baseMatch = String(s?.base_strategy_version_id || '').trim() === currentStrategyId;
          const promotedMatch = String(s?.promoted_strategy_version_id || '').trim() === currentStrategyId;
          return baseMatch || promotedMatch;
        })
        .slice(0, 20);
    }

    // If still no matches, walk up one level — find any sweep that promoted into this strategy
    if (sweeps.length === 0) {
      sweeps = (sweepsData || [])
        .filter(s => {
          if (!currentStrategyId) return false;
          if (sessionCutoff && new Date(s.created_at || 0).getTime() < sessionCutoff) return false;
          return String(s?.promoted_strategy_version_id || '').trim() === currentStrategyId;
        })
        .slice(0, 20);
    }

    await Promise.all(sweeps.flatMap(s => ([
      ensureStrategySpec(s.promoted_strategy_version_id),
      ensureStrategySpec(s.base_strategy_version_id),
    ])));

    if (sweeps.length === 0) {
      list.innerHTML = `<div style="font-size:var(--text-caption);color:var(--color-text-muted);">${currentStrategyId ? 'No sweeps run for this strategy yet.' : 'No strategy selected.'}</div>`;
      return;
    }

    // Assign session version numbers (V1, V2...) in chronological order
    const chronological = [...sweeps].sort((a, b) =>
      new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const versionMap = new Map(chronological.map((s, i) => [s.sweep_id, i + 1]));

    // Keep module-level map in sync so the banner can show "V3" etc. after a card click
    versionMap.forEach((vNum, sweepId) => sweepVersionMap.set(sweepId, vNum));

    const displayOrderedSweeps = [...sweeps].sort((a, b) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    const groupedSweeps = [];
    const groupedSweepMap = new Map();
    for (const sweep of displayOrderedSweeps) {
      const displayStrategyId = getSweepDisplayStrategyId(sweep) || currentStrategyId || String(sweep?.base_strategy_version_id || '').trim();
      const rawGroupName = getStrategyName(displayStrategyId) || getStrategyName(sweep?.base_strategy_version_id) || displayStrategyId;
      const displayGroupName = getStrategyDisplayName(displayStrategyId, rawGroupName) || rawGroupName;
      const groupKey = window.SweepNameUtils?.getStrategyFamilyKey({
        strategyVersionId: displayStrategyId,
        strategyId: strategyCatalog.get(displayStrategyId)?.strategy_id || displayStrategyId,
      }) || displayGroupName;
      if (!groupedSweepMap.has(groupKey)) {
        const group = {
          key: groupKey,
          strategyId: displayStrategyId,
          name: displayGroupName,
          rawName: rawGroupName,
          sweeps: [],
        };
        groupedSweepMap.set(groupKey, group);
        groupedSweeps.push(group);
      }
      groupedSweepMap.get(groupKey).sweeps.push(sweep);
    }

    const buildParamPillsHtml = (sweep) => {
      const isCardGrid = (sweep.sweep_params?.length || 0) > 1;
      const winnerVal = sweep.winner?.param_value != null ? String(sweep.winner.param_value) : null;
      return (sweep.sweep_params || []).map(sp => {
        const allValues = sp.values || [];
        const spLabel = sp.label || sp.param_path || 'Param';
        const pills = allValues.map(v => {
          const vStr = String(v);
          let isWinnerVal = false;
          if (sweep.winner && Array.isArray(sweep.winner.param_values)) {
            isWinnerVal = sweep.winner.param_values.some(pv => pv.param_path === sp.param_path && String(pv.value) === vStr);
          } else {
            isWinnerVal = winnerVal !== null && vStr === winnerVal && sp.param_path === sweep.sweep_params?.[0]?.param_path;
          }
          return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-family:var(--font-mono);
            background:${isWinnerVal ? 'var(--color-positive)' : 'var(--color-border)'};
            color:${isWinnerVal ? '#fff' : 'var(--color-text-muted)'};
            font-weight:${isWinnerVal ? '700' : '400'};">${reportEscHtml(vStr)}${isWinnerVal ? ' ✓' : ''}</span>`;
        }).join(' ');
        return `
          <div style="margin-bottom:4px;">
            <div style="font-size:10px;color:var(--color-text-muted);margin-bottom:3px;font-family:var(--font-mono);">${reportEscHtml(spLabel)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;">${pills || '<span style="font-size:10px;color:var(--color-text-subtle);">no values</span>'}</div>
          </div>`;
      }).join('');
    };

    const buildSweepStepTitle = (sweep) => {
      const labels = (sweep.sweep_params || [])
        .map(sp => String(sp?.label || sp?.param_path || '').trim())
        .filter(Boolean);
      return labels.length ? labels.join(' × ') : 'Sweep';
    };

    const buildWinnerDisplay = (sweep) => {
      const isCardGrid = (sweep.sweep_params?.length || 0) > 1;
      if (!sweep.winner) return null;
      if (isCardGrid && Array.isArray(sweep.winner.param_values) && sweep.winner.param_values.length > 1) {
        return sweep.winner.param_values.map(pv => `${pv.label}=${pv.value}`).join(', ');
      }
      return sweep.winner.param_value != null ? String(sweep.winner.param_value) : null;
    };

    const buildSweepStepCard = (sweep) => {
      const variantCount = sweep.variants?.length || 0;
      const completedCount = sweep.variants?.filter(v => v.status === 'completed').length || 0;
      const statusColor = sweep.status === 'completed' ? 'var(--color-positive)' : sweep.status === 'running' ? 'var(--color-accent)' : 'var(--color-text-muted)';
      const vNum = versionMap.get(sweep.sweep_id) || '?';
      const sweepDate = sweep.created_at ? new Date(sweep.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const tierLabel_ = sweep.tier ? tierLabel(sweep.tier) : '—';
      const winnerDisplay = buildWinnerDisplay(sweep);
      const stepTitle = buildSweepStepTitle(sweep);
      const active = activeSweepId === sweep.sweep_id;
      return `
        <div
          class="sweep-history-item ${active ? 'active' : ''}"
          onclick="loadSweep('${sweep.sweep_id}')"
          style="margin-top:8px;padding:10px 12px;border-radius:var(--radius-sm);background:${active ? 'rgba(108,178,255,0.08)' : 'var(--color-void)'};border:1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'};"
        >
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-8);">
            <div style="font-size:12px;font-weight:700;color:var(--color-text);font-family:var(--font-mono);">${reportEscHtml(stepTitle)}</div>
            <div class="sweep-meta" style="flex-shrink:0;font-weight:700;color:var(--color-text);font-size:11px;">V${vNum}</div>
          </div>
          ${(sweepDate || tierLabel_) ? `<div class="sweep-meta" style="color:var(--color-text-subtle);margin-top:2px;">${reportEscHtml(sweepDate)}${sweepDate && tierLabel_ ? ' · ' : ''}${reportEscHtml(tierLabel_)}</div>` : ''}

          <div style="margin-top:6px;padding:6px 8px;background:rgba(255,255,255,0.02);border:1px solid var(--color-border);border-radius:var(--radius-sm);">
            ${buildParamPillsHtml(sweep)}
            <div style="margin-top:5px;display:flex;align-items:center;justify-content:space-between;gap:var(--space-8);">
              <span style="font-size:10px;color:${statusColor};font-family:var(--font-mono);">${sweep.status} · ${completedCount}/${variantCount}</span>
              ${winnerDisplay ? `<span style="font-size:10px;color:var(--color-positive);font-family:var(--font-mono);font-weight:600;">winner: ${reportEscHtml(winnerDisplay)}</span>` : ''}
            </div>
          </div>

          <div style="margin-top:6px;display:flex;gap:4px;">
            ${sweep.promoted_strategy_version_id ? `
            <button class="btn-send-to-validator"
              onclick="event.stopPropagation(); sendToValidator('${sweep.promoted_strategy_version_id}')"
              title="Open promoted winner in the Validator"
              style="flex:1;">
              Send Winner to Validator →
            </button>` : `
            <button class="btn-send-to-validator"
              onclick="event.stopPropagation(); sendToValidator('${sweep.base_strategy_version_id}')"
              title="Open base strategy in the Validator"
              style="flex:1;opacity:0.7;">
              Send to Validator →
            </button>`}
            <button class="sweep-inline-btn"
              onclick="event.stopPropagation(); deleteSweepHistoryItem('${sweep.sweep_id}')"
              title="Delete this sweep step and its linked report data">
              Delete
            </button>
          </div>
        </div>
      `;
    };

    list.innerHTML = groupedSweeps.map(group => {
      const orderedSteps = [...group.sweeps].sort((a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      const hasActiveStep = orderedSteps.some(sweep => activeSweepId === sweep.sweep_id);
      return `
        <div
          style="padding:12px;border:1px solid ${hasActiveStep ? 'var(--color-accent)' : 'var(--color-border)'};border-radius:var(--radius-md);background:var(--color-bg-subtle);margin-bottom:12px;"
        >
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-8);margin-bottom:4px;">
            <div class="sweep-name" style="flex:1;" title="${reportEscHtml(group.rawName)}">${reportEscHtml(group.name)}</div>
            <div class="sweep-meta" style="font-size:11px;font-family:var(--font-mono);">${orderedSteps.length} ${orderedSteps.length === 1 ? 'sweep' : 'sweeps'}</div>
          </div>
          <div class="sweep-meta" style="color:var(--color-text-subtle);margin-bottom:8px;">Optimization trail</div>
          ${orderedSteps.map(buildSweepStepCard).join('')}
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
      await ensureStrategySpec(data.data.promoted_strategy_version_id);
      await ensureStrategySpec(data.data.base_strategy_version_id);
      restoreSweepConfig(data.data);
      const sweepStrategyId = getSweepDisplayStrategyId(data.data) || getConfiguredStrategyVersionId();
      // Rebuild the session list for the strategy this sweep actually belongs to,
      // otherwise a refresh can leave the winner hidden behind the previously
      // restored strategy filter.
      await loadRecentSweepsForStrategy(sweepStrategyId);
      renderLoadedSweepBanner(data.data);
      startPolling(requestedId);
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

// ─── New Session ────────────────────────────────────────────────────────────────

function startNewSession() {
  const btn = document.getElementById('new-session-btn');
  if (btn && btn.dataset.confirming === 'true') {
    // Second click — confirmed
    btn.dataset.confirming = 'false';
    btn.textContent = 'New Session';
    btn.style.color = '';
    btn.style.borderColor = '';
    _doStartNewSession();
  } else {
    // First click — ask for confirmation
    if (btn) {
      btn.dataset.confirming = 'true';
      btn.textContent = 'Confirm?';
      btn.style.color = 'var(--color-warning, #f59e0b)';
      btn.style.borderColor = 'var(--color-warning, #f59e0b)';
      setTimeout(() => {
        if (btn.dataset.confirming === 'true') {
          btn.dataset.confirming = 'false';
          btn.textContent = 'New Session';
          btn.style.color = '';
          btn.style.borderColor = '';
        }
      }, 3000);
    }
  }
}

function _doStartNewSession() {
  // Set session boundary — only sweeps created after this point will appear
  sessionStartedAt = new Date().toISOString();
  window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);

  // Clear active sweep state
  activeSweepId = null;
  persistActiveSweepId('');
  clearInterval(pollTimer);
  pollTimer = null;

  // Reset strategy selection
  activeConfiguredStrategyVersionId = null;
  persistActiveStrategyId('');
  const select = document.getElementById('sweep-strategy-select');
  if (select) select.value = '';
  updateStrategyDisplay('');

  // Reset parameter config — clear all state AND visual state together
  selectedPreset = null;
  customValues = [];
  removeSecondParamSlot();
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  renderValuePills();
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');
  if (pathInput) pathInput.value = '';
  if (labelInput) labelInput.value = '';

  // Explicitly reset the dropdown and hide suggested value buttons so the
  // UI doesn't look pre-loaded when internal state is actually empty
  const customParamSelect = document.getElementById('custom-param-select');
  if (customParamSelect) customParamSelect.value = '';
  renderSuggestedValueButtons('');

  // Clear UI panels
  renderLoadedSweepBanner(null);
  renderStrategyAnatomy();
  setupCustomParameterPicker();
  updateSelectedSummary();
  updateRunButton();

  const smartPlan = document.getElementById('smart-plan-banner');
  if (smartPlan) smartPlan.innerHTML = '';

  const historyList = document.getElementById('sweep-history-list');
  if (historyList) historyList.innerHTML = '<div style="font-size:var(--text-caption);color:var(--color-text-muted);font-family:var(--font-mono);">Session cleared — select a strategy to begin.</div>';
  sweepVersionMap.clear();

  // Clear the results panel back to the empty state
  const resultsBody = document.getElementById('results-body');
  if (resultsBody) resultsBody.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">&#9889;</div>
      <div class="empty-state-title">No sweep running</div>
      <div class="empty-state-subtitle">Select a strategy, pick a preset or custom parameter, then click Run Sweep.</div>
    </div>`;

  const promoteBanner = document.getElementById('sweep-promote-banner');
  if (promoteBanner) { promoteBanner.style.display = 'none'; promoteBanner.innerHTML = ''; }

  document.getElementById('results-loaded-strategy').textContent = '';
  document.getElementById('results-sweep-id').textContent = '';

  // Remove strategy_version_id from URL without reloading
  const url = new URL(window.location.href);
  url.searchParams.delete('strategy_version_id');
  url.searchParams.delete('sweep');
  window.history.replaceState({}, '', url.toString());
}

// ─── Results / JSON tab switching ──────────────────────────────────────────────

function switchSweepTab(name) {
  document.querySelectorAll('.sweep-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sweep-tab-content').forEach(p => p.classList.remove('active'));
  const btn = document.getElementById(`tab-btn-${name}`);
  const pane = document.getElementById(`sweep-tab-${name}`);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');

  if (name === 'json') {
    jsonViewerLoad();
  }
}

// ─── JSON Viewer ───────────────────────────────────────────────────────────────

let _jsonViewerOriginal = null;   // last text fetched from server
let _jsonViewerStrategyId = null; // strategy_version_id currently shown

async function jsonViewerLoad() {
  const strategyId = getConfiguredStrategyVersionId();
  if (!strategyId) {
    _jsonViewerClearUI('No strategy loaded — select a strategy or load a sweep from the session list first.');
    return;
  }

  // Already showing this exact strategy with content — nothing to reload
  if (strategyId === _jsonViewerStrategyId && _jsonViewerOriginal !== null) return;

  // Different strategy — reset dirty state so we don't preserve stale edits
  if (strategyId !== _jsonViewerStrategyId) {
    _jsonViewerOriginal = null;
    _jsonViewerMarkClean();
  }

  _jsonViewerStrategyId = strategyId;

  const editor = document.getElementById('json-editor');
  const filename = document.getElementById('json-viewer-filename');
  const stratIdEl = document.getElementById('json-strategy-id');
  if (editor) editor.value = 'Loading…';
  if (filename) filename.textContent = strategyId;
  if (stratIdEl) stratIdEl.textContent = '';

  try {
    const res = await fetch(`${API}/validator/strategy/${encodeURIComponent(strategyId)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Not found');
    const pretty = JSON.stringify(data.data, null, 2);
    _jsonViewerOriginal = pretty;
    if (editor) editor.value = pretty;
    if (filename) filename.textContent = `${strategyId}.json`;
    if (stratIdEl) stratIdEl.textContent = data.data.name || strategyId;
    _jsonViewerMarkClean();
  } catch (err) {
    if (editor) editor.value = `// Error loading strategy: ${err.message}`;
    _jsonViewerOriginal = null;
  }
}

function _jsonViewerClearUI(msg = '') {
  const editor = document.getElementById('json-editor');
  const filename = document.getElementById('json-viewer-filename');
  const stratIdEl = document.getElementById('json-strategy-id');
  if (editor) editor.value = msg;
  if (filename) filename.textContent = msg ? 'No strategy loaded' : '';
  if (stratIdEl) stratIdEl.textContent = '';
  _jsonViewerOriginal = null;
  _jsonViewerStrategyId = null;
  _jsonViewerMarkClean();
}

function _jsonViewerMarkClean() {
  const bar = document.getElementById('json-changed-bar');
  const badge = document.getElementById('json-tab-badge');
  if (bar) bar.style.display = 'none';
  if (badge) badge.style.display = 'none';
}

function _jsonViewerMarkDirty() {
  const bar = document.getElementById('json-changed-bar');
  const badge = document.getElementById('json-tab-badge');
  if (bar) { bar.style.display = 'flex'; }
  if (badge) { badge.style.display = ''; }
}

function onJsonEditorInput() {
  const editor = document.getElementById('json-editor');
  if (!editor || _jsonViewerOriginal === null) return;
  if (editor.value !== _jsonViewerOriginal) {
    _jsonViewerMarkDirty();
  } else {
    _jsonViewerMarkClean();
  }
}

function jsonViewerReset() {
  const editor = document.getElementById('json-editor');
  if (!editor || _jsonViewerOriginal === null) return;
  editor.value = _jsonViewerOriginal;
  _jsonViewerMarkClean();
}

async function jsonViewerSave() {
  const editor = document.getElementById('json-editor');
  if (!editor || !_jsonViewerStrategyId) return;

  let parsed;
  try {
    parsed = JSON.parse(editor.value);
  } catch (err) {
    alert(`Invalid JSON — please fix the syntax error before saving.\n\n${err.message}`);
    return;
  }

  const saveBtn = document.getElementById('json-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const res = await fetch(`${API}/strategies/${encodeURIComponent(_jsonViewerStrategyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');

    const saved = data.data || parsed;
    const pretty = JSON.stringify(saved, null, 2);
    _jsonViewerOriginal = pretty;
    editor.value = pretty;
    _jsonViewerMarkClean();

    // Invalidate catalog so next load re-fetches the updated spec
    strategyCatalog.delete(_jsonViewerStrategyId);
    showToast('Strategy saved.', 'success');
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓ Save Changes'; }
  }
}
