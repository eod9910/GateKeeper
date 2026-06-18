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
let activeValidatorJobIds = null;
// Maps sweep_id → session version number (V1, V2, ...) — populated by _loadRecentSweepsImpl
const sweepVersionMap = new Map();
const ACTIVE_SWEEP_STORAGE_KEY = 'activeSweepId';
const ACTIVE_STRATEGY_STORAGE_KEY = 'activeSweepStrategyId';
const ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY = 'activeFundamentalSweepId';
const ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY = 'activeSweepSessionId';
const ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY = 'activeSweepSessionNote';
const SESSION_START_STORAGE_KEY = 'sweepSessionStartedAt';
let sessionStartedAt = null;
let activeSweepSessionId = null;
let activeSweepSessionNote = '';
let selectedSweepReportId = null;
let selectedSweepVariantId = null;
const selectedComparisonVariantIds = new Set();
let activeSweepReferenceKey = null;
let activeSweepReferenceReportId = null;
let activeConfiguredStrategyVersionId = null;
let activeFundamentalSweepSessionId = null;
let activeFundamentalSweepSession = null;
const RETIRED_SWEEP_PARAM_PATHS = new Set([
  'fundamental_config.forward_bars',
]);

// ─── Universal Dimensions state ───────────────────────────────────────────────
// Maps dim.key → Set of selected values
const universalDimSelections = new Map();
let universalDimsSpec = null; // loaded from API
const UNIVERSAL_SWEEP_FALLBACK_PATHS = [
  'validation_tier',
  'setup_config.market_cap_tier',
  'interval',
  'risk_config.stop_type',
  'risk_config.stop_value',
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
    const canAddCustom = canAddUniversalDimCustomValue(dim);
    const singleChoice = isUniversalDimSingleChoice(dim);
    const allSelected = Array.isArray(dim.suggested_values)
      && dim.suggested_values.length > 0
      && dim.suggested_values.every(sv => [...sel].some(v => String(v) === String(sv.value)));
    return `
      <div class="udim-card${hasAny ? ' active' : ''}" id="udim-card-${dim.key}">
        <div class="udim-field-header">
          <label class="form-label">${dim.label}</label>
          ${singleChoice ? '' : `<button
            type="button"
            class="udim-select-all${allSelected ? ' active' : ''}"
            id="udim-toggle-${dim.key}"
            onclick="toggleUniversalDimAll('${dim.key}')"
            title="${allSelected ? 'Clear all values' : 'Select all values'}"
            aria-label="${allSelected ? 'Clear all values for ' + dim.label : 'Select all values for ' + dim.label}"
          ></button>`}
        </div>
        <details class="udim-value-dropdown">
          <summary id="udim-summary-${dim.key}">
            <span>${getUniversalDimSelectionSummary(dim, sel)}</span>
          </summary>
          <div class="udim-values-card">
            <div class="parameter-values-header">
              <div class="parameter-values-title">Values to Test</div>
              <div class="parameter-values-meta" id="udim-count-${dim.key}">${getUniversalDimSelectionMeta(dim, sel)}</div>
            </div>
            <div class="udim-values" id="udim-pills-${dim.key}">
              ${renderUniversalDimValueGroups(dim, sel)}
            </div>
            ${canAddCustom ? `<div class="add-value-row udim-add-value-row">
              <input
                id="udim-add-${dim.key}"
                type="text"
                placeholder="${getUniversalDimAddPlaceholder(dim)}"
                onkeydown="if (event.key === 'Enter') addUniversalDimCustomValue('${dim.key}')"
              />
              <button type="button" onclick="addUniversalDimCustomValue('${dim.key}')">+ Add</button>
            </div>` : ''}
          </div>
        </details>
      </div>`;
  }).join('');
}

function getUniversalDimSelectionSummary(dim, sel) {
  if (!sel || sel.size === 0) {
    return isUniversalDimSingleChoice(dim) ? `Choose ${String(dim?.label || 'value').toLowerCase()}...` : 'Choose values...';
  }
  const labelsByValue = new Map((dim?.suggested_values || []).map(sv => [String(sv.value), sv.label]));
  const labels = Array.from(sel).map(value => labelsByValue.get(String(value)) || String(value));
  if (labels.length <= 3) return labels.map(reportEscHtml).join(', ');
  return `${labels.length} selected`;
}

function isUniversalDimSingleChoice(dim) {
  return String(dim?.key || '') === 'stop_type';
}

function getUniversalDimSelectionMeta(dim, sel) {
  if (isUniversalDimSingleChoice(dim)) return sel?.size ? 'single choice' : 'choose one';
  return sel?.size ? `${sel.size} selected` : 'none selected';
}

function canAddUniversalDimCustomValue(dim) {
  return typeof dim?.suggested_values?.[0]?.value === 'number';
}

function getUniversalDimAddPlaceholder(dim) {
  const firstSuggested = dim?.suggested_values?.[0]?.value;
  return typeof firstSuggested === 'number' ? 'e.g. 0' : 'e.g. custom';
}

function groupUniversalDimValues(dim) {
  const values = Array.isArray(dim?.suggested_values) ? dim.suggested_values : [];
  return [{ label: '', values }];
}

function renderUniversalDimValueGroups(dim, sel) {
  const knownValues = new Set((dim?.suggested_values || []).map(sv => String(sv.value)));
  return groupUniversalDimValues(dim).map(group => {
    const pills = group.values.map(sv => {
      const isSelected = [...sel].some(v => String(v) === String(sv.value));
      const encodedVal = encodeURIComponent(String(sv.value));
      return `<span class="udim-pill${isSelected ? ' selected' : ''}"
        onclick="toggleUniversalDimValue('${dim.key}', decodeURIComponent('${encodedVal}'))"
        title="${reportEscHtml(sv.label)}">${reportEscHtml(sv.label)}</span>`;
    }).join('');
    const customPills = [...sel]
      .filter(value => !knownValues.has(String(value)))
      .map(value => {
        const encodedVal = encodeURIComponent(String(value));
        const label = reportEscHtml(String(value));
        return `<span class="udim-pill selected custom"
          onclick="toggleUniversalDimValue('${dim.key}', decodeURIComponent('${encodedVal}'))"
          title="Remove custom value">${label}<button type="button" aria-label="Remove ${label}">×</button></span>`;
      })
      .join('');
    const renderedPills = [pills, customPills].filter(Boolean).join('');

    if (!group.label) return renderedPills;
    return `
      <div class="udim-value-group">
        <div class="udim-value-group-label">${group.label}</div>
        <div class="udim-value-group-pills">${renderedPills}</div>
      </div>`;
  }).join('');
}

function renderUniversalDimCluster(title, help, dims) {
  if (!dims.length) return '';
  return `
    <div class="udim-cluster">
      <div class="udim-cluster-header">
        <div class="udim-cluster-title">${title}</div>
        <div class="udim-cluster-help">${help}</div>
      </div>
      ${renderUniversalDimCards(dims)}
    </div>`;
}

function renderUniversalDims() {
  const section = document.getElementById('sweep-dims-stack');
  const legacySection = document.getElementById('universal-dims-section');
  const panelDefs = [
    {
      id: 'market-cap',
      dims: dim => dim.key === 'market_cap_tier',
    },
    {
      id: 'timeframe',
      dims: dim => dim.key === 'timeframe',
    },
    {
      id: 'exit-rules',
      dims: dim => isExitRuleControlVisible(dim),
    },
    {
      id: 'max-hold',
      dims: dim => dim.key === 'max_hold_bars',
    },
    {
      id: 'max-concurrent',
      dims: dim => dim.key === 'max_concurrent_positions',
    },
  ];
  if (!section || !universalDimsSpec) return;
  if (legacySection) legacySection.style.display = 'none';
  section.style.display = 'flex';

  const dims = universalDimsSpec.dims;
  panelDefs.forEach(panel => {
    const panelSection = document.getElementById(`sweep-dims-${panel.id}-section`);
    const panelBody = document.getElementById(`sweep-dims-${panel.id}-body`);
    if (!panelSection || !panelBody) return;
    const panelDims = dims.filter(panel.dims);
    panelSection.style.display = panelDims.length ? 'flex' : 'none';
    panelBody.innerHTML = panelDims.length
      ? renderUniversalDimCards(panelDims)
      : '<div class="udim-subsection-help">No dimensions available.</div>';
  });
  updateUniversalDimsBadge();
}

function getSelectedUniversalDimValues(dimKey) {
  return Array.from(universalDimSelections.get(dimKey) || []);
}

function getSelectedStopType() {
  const values = getSelectedUniversalDimValues('stop_type');
  return String(values[0] || '').trim();
}

function isExitRuleControlVisible(dim) {
  if (!dim) return false;
  if (['stop_type', 'take_profit_r', 'auto_breakeven_r'].includes(dim.key)) return true;
  const stopType = getSelectedStopType();
  if (dim.key === 'stop_pct') return stopType === 'percentage';
  if (dim.key === 'atr_multiplier') return stopType === 'atr_multiple';
  return false;
}

function renderUniversalDimSelection(dim, sel) {
  if (!dim) return;
  const card = document.getElementById(`udim-card-${dim.key}`);
  const toggle = document.getElementById(`udim-toggle-${dim.key}`);
  const count = document.getElementById(`udim-count-${dim.key}`);
  const pillsEl = document.getElementById(`udim-pills-${dim.key}`);
  const summary = document.getElementById(`udim-summary-${dim.key}`);
  if (!card || !count || !pillsEl) return;

  const hasAny = sel.size > 0;
  const allSelected = Array.isArray(dim.suggested_values)
    && dim.suggested_values.length > 0
    && dim.suggested_values.every(sv => [...sel].some(v => String(v) === String(sv.value)));
  card.className = 'udim-card' + (hasAny ? ' active' : '');
  if (toggle) {
    toggle.className = 'udim-select-all' + (allSelected ? ' active' : '');
    toggle.textContent = '';
    toggle.title = allSelected ? 'Clear all values' : 'Select all values';
    toggle.setAttribute('aria-label', `${allSelected ? 'Clear all values for' : 'Select all values for'} ${dim.label}`);
  }
  count.textContent = getUniversalDimSelectionMeta(dim, sel);
  if (summary) summary.innerHTML = `<span>${getUniversalDimSelectionSummary(dim, sel)}</span>`;
  pillsEl.innerHTML = renderUniversalDimValueGroups(dim, sel);
}

function coerceUniversalDimValue(dim, value) {
  const firstSuggested = dim?.suggested_values?.[0]?.value;
  return (typeof firstSuggested === 'number' && !isNaN(Number(value)))
    ? Number(value)
    : value;
}

function addUniversalDimCustomValue(dimKey) {
  if (getConfiguredStrategyVersionId()) clearActiveFundamentalSweepSession();
  const dim = universalDimsSpec?.dims.find(d => d.key === dimKey);
  if (!dim || !canAddUniversalDimCustomValue(dim)) return;
  const input = document.getElementById(`udim-add-${dimKey}`);
  const raw = String(input?.value || '').trim();
  if (!raw) return;

  const coerced = coerceUniversalDimValue(dim, raw);
  let sel = universalDimSelections.get(dimKey);
  if (!sel) { sel = new Set(); universalDimSelections.set(dimKey, sel); }
  sel.add(coerced);

  if (input) {
    input.value = '';
    input.focus();
  }
  renderUniversalDimSelection(dim, sel);
  updateUniversalDimsBadge();
  updateRunButton();
}

function toggleUniversalDimValue(dimKey, value) {
  if (getConfiguredStrategyVersionId()) clearActiveFundamentalSweepSession();
  // Coerce to number if the dim's suggested values are numeric
  const dim = universalDimsSpec?.dims.find(d => d.key === dimKey);
  const coerced = coerceUniversalDimValue(dim, value);
  let sel = universalDimSelections.get(dimKey);
  if (!sel) { sel = new Set(); universalDimSelections.set(dimKey, sel); }
  if (dimKey === 'stop_type') {
    const wasSelected = sel.has(coerced);
    sel.clear();
    if (!wasSelected) sel.add(coerced);
    reconcileStopTypeDependentSelections(String(wasSelected ? '' : coerced));
  } else if (sel.has(coerced)) {
    sel.delete(coerced);
  } else {
    sel.add(coerced);
  }
  // Re-render just this dim's pills and toggle
  if (!dim) return;
  if (dimKey === 'stop_type') {
    renderUniversalDims();
  } else {
    renderUniversalDimSelection(dim, sel);
  }
  updateUniversalDimsBadge();
  updateRunButton();
}

function reconcileStopTypeDependentSelections(stopType) {
  if (stopType !== 'percentage') universalDimSelections.delete('stop_pct');
  if (stopType !== 'atr_multiple') universalDimSelections.delete('atr_multiplier');
}

function toggleUniversalDimAll(dimKey) {
  if (getConfiguredStrategyVersionId()) clearActiveFundamentalSweepSession();
  const dim = universalDimsSpec?.dims.find(d => d.key === dimKey);
  if (!dim || !Array.isArray(dim.suggested_values)) return;
  let sel = universalDimSelections.get(dimKey);
  if (!sel) { sel = new Set(); universalDimSelections.set(dimKey, sel); }

  const values = dim.suggested_values.map(sv => coerceUniversalDimValue(dim, sv.value));
  const allSelected = values.length > 0 && values.every(value => sel.has(value));
  sel.clear();
  if (!allSelected) {
    if (dimKey === 'stop_type') {
      const first = values[0];
      if (first != null) sel.add(first);
      reconcileStopTypeDependentSelections(String(first || ''));
    } else {
      values.forEach(value => sel.add(value));
    }
  } else if (dimKey === 'stop_type') {
    reconcileStopTypeDependentSelections('');
  }

  if (dimKey === 'stop_type') {
    renderUniversalDims();
  } else {
    renderUniversalDimSelection(dim, sel);
  }
  updateUniversalDimsBadge();
  updateRunButton();
}

function updateUniversalDimsBadge() {
  const badge = document.getElementById('sweep-dims-active-badge')
    || document.getElementById('universal-dims-active-badge');
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
  const section = document.getElementById('sweep-dims-stack')
    || document.getElementById('universal-dims-section');
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
    : `${primaryCount} entry × ${dimsProduct} universal dims = ${total} total variants`;
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
    values: ['percentage', 'atr_multiple'],
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

function clearActiveFundamentalSweepSession() {
  activeFundamentalSweepSessionId = null;
  activeFundamentalSweepSession = null;
  persistActiveFundamentalSweepId('');
}

function setRunSweepDisabledReason(reason = '') {
  const btn = document.getElementById('btn-run-sweep');
  if (!btn) return;
  let reasonEl = document.getElementById('run-sweep-disabled-reason');
  if (!reasonEl) {
    reasonEl = document.createElement('div');
    reasonEl.id = 'run-sweep-disabled-reason';
    reasonEl.style.marginTop = 'var(--space-6)';
    reasonEl.style.fontSize = 'var(--text-caption)';
    reasonEl.style.lineHeight = '1.5';
    reasonEl.style.color = 'var(--color-text-subtle)';
    btn.insertAdjacentElement('afterend', reasonEl);
  }
  reasonEl.textContent = reason;
  reasonEl.style.display = reason ? 'block' : 'none';
}

async function switchToStrategy(strategyVersionId, options = {}) {
  const strategySelect = document.getElementById('sweep-strategy-select');
  if (!strategySelect) return;
  clearActiveFundamentalSweepSession();

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
  activeSweepSessionId = window.localStorage.getItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY) || null;
  activeSweepSessionNote = window.localStorage.getItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY) || '';
  updateSessionNoteInput();
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

  let restoredFundamentalSweep = false;
  const requestedStrategy = getRequestedStrategyId();
  const requestedFundamentalSweep = getRequestedFundamentalSweepId({ ignorePersisted: Boolean(requestedStrategy) });
  if (requestedFundamentalSweep) {
    await loadFundamentalSweepSession(requestedFundamentalSweep);
    restoredFundamentalSweep = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('fundamental_sweep_id');
    window.history.replaceState({}, '', url.toString());
  } else if (requestedStrategy) {
    const urlStrategy = new URLSearchParams(window.location.search).get('strategy_version_id');
    const persistedStrategy = String(window.localStorage.getItem(ACTIVE_STRATEGY_STORAGE_KEY) || '').trim();
    // Only start a fresh session on an explicit cross-page handoff. If we are
    // merely refreshing the same sweep page, keep the existing session and
    // active sweep instead of clearing the winner cards.
    if (urlStrategy && String(urlStrategy).trim() !== persistedStrategy) {
      sessionStartedAt = new Date().toISOString();
      activeSweepSessionId = makeSweepSessionId(sessionStartedAt);
      activeSweepSessionNote = '';
      window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
      window.localStorage.setItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY, activeSweepSessionId);
      window.localStorage.setItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY, activeSweepSessionNote);
      updateSessionNoteInput();
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

  if (!restoredFundamentalSweep) {
    await restoreActiveSweepFromState();
  }
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
    window.localStorage.removeItem(ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY);
  } else {
    window.localStorage.removeItem(ACTIVE_SWEEP_STORAGE_KEY);
  }
}

function persistActiveFundamentalSweepId(sessionId = '') {
  const value = String(sessionId || '').trim();
  if (value) {
    window.localStorage.setItem(ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY);
  }
}

function persistActiveStrategyId(strategyVersionId = '') {
  const value = String(strategyVersionId || '').trim();
  if (value) {
    window.localStorage.setItem(ACTIVE_STRATEGY_STORAGE_KEY, value);
    window.localStorage.removeItem(ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY);
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
    tierSelect.innerHTML = `
      <option value="evidence_50">Evidence 50 trades - early signal</option>
      <option value="evidence_100" selected>Evidence 100 trades - useful sample</option>
      <option value="evidence_200">Evidence 200 trades - statistical read</option>
      <option value="evidence_500">Evidence 500 trades - strong sample</option>
      <option value="full_clean">Full clean universe - confirmation</option>
    `;
    return;
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
      <option value="clean"${defaultTier === 'clean' ? ' selected' : ''}>Clean Universe - rule-filtered broad evidence expansion</option>
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
  document.getElementById('add-value-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomValue();
  });
  document.getElementById('custom-param-path')?.addEventListener('input', e => {
    if (isRetiredSweepParamPath(e.target.value)) {
      e.target.value = '';
      const labelInput = document.getElementById('custom-param-label');
      if (labelInput) labelInput.value = '';
      customValues = [];
      renderValuePills();
    }
    setCustomParameterPickerValue(findPresetKeyByPath(e.target.value));
    updateSelectedSummary();
    updateRunButton();
  });
  document.getElementById('custom-param-label')?.addEventListener('input', () => {
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

function getRequestedFundamentalSweepId(options = {}) {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = String(params.get('fundamental_sweep_id') || '').trim();
    if (fromQuery) return fromQuery;
  } catch {}
  if (options.ignorePersisted) return '';
  return String(window.localStorage.getItem(ACTIVE_FUNDAMENTAL_SWEEP_STORAGE_KEY) || '').trim();
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

function isRetiredSweepParamPath(paramPath) {
  return RETIRED_SWEEP_PARAM_PATHS.has(String(paramPath || '').trim());
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
  const strategyParametersCard = document.getElementById('strategy-parameters-card');
  if (strategyParametersCard) {
    strategyParametersCard.style.display = entries.length ? 'flex' : 'none';
  }
  const groupsHtml = ANATOMY_GROUPS.map(group => {
    const options = entries
      .filter(([, preset]) => preset.anatomy === group.key)
      .map(([key, preset]) => `<option value="${key}">${preset.label}</option>`)
      .join('');
    return options ? `<optgroup label="${group.label}">${options}</optgroup>` : '';
  }).join('');

  select.innerHTML = [
    '<option value="">Choose an entry criterion...</option>',
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

  if (help) {
    help.textContent = preset.description || '';
    help.style.display = preset.description ? 'block' : 'none';
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

function clearPrimaryParameter() {
  selectedPreset = null;
  customValues = [];
  const select = document.getElementById('custom-param-select');
  const pathInput = document.getElementById('custom-param-path');
  const labelInput = document.getElementById('custom-param-label');
  const help = document.getElementById('custom-param-help');
  const suggestedGroup = document.getElementById('suggested-values-group');
  const suggested = document.getElementById('suggested-values');
  if (select) select.value = '';
  if (pathInput) pathInput.value = '';
  if (labelInput) labelInput.value = '';
  if (help) help.style.display = 'none';
  if (suggestedGroup) suggestedGroup.style.display = 'none';
  if (suggested) suggested.innerHTML = '';
  secondSlot = { active: false, paramPath: '', label: '', values: [] };
  const slot = document.getElementById('sweep-param-slot-2');
  if (slot) { slot.style.display = 'none'; slot.innerHTML = ''; }
  clearPresetSelection();
  renderValuePills();
  renderGridControls();
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
  const btn = document.getElementById('btn-run-sweep');
  const strategy = getConfiguredStrategyVersionId();
  const activeDims = getActiveDimParams();
  if (activeFundamentalSweepSessionId && activeFundamentalSweepSession && strategy) {
    clearActiveFundamentalSweepSession();
  }
  if (activeFundamentalSweepSessionId && activeFundamentalSweepSession) {
    const selectedParams = getSelectedFundamentalSweepParams();
    const gridSize = getFundamentalGridSize();
    const isRunning = String(activeFundamentalSweepSession.status || '').toLowerCase() === 'running';
    const reason = isRunning
      ? 'Fundamental sweep is already running.'
      : selectedParams.length === 0
        ? 'Highlight at least one fundamental entry or exclusion value to run this research sweep.'
        : gridSize > 20
          ? `Grid is ${gridSize} variants — max is 20. Deselect some values.`
          : '';
    if (btn) {
      btn.disabled = Boolean(reason);
      btn.textContent = isRunning
        ? 'Sweep Running...'
        : selectedParams.length ? `Run Sweep · ${gridSize} variant${gridSize === 1 ? '' : 's'}` : 'Run Sweep';
      btn.title = reason || `Run ${gridSize} variant${gridSize === 1 ? '' : 's'} across ${selectedParams.length} dimension${selectedParams.length === 1 ? '' : 's'}`;
    }
    setRunSweepDisabledReason(reason);
    renderUniversalDimsVariantCount();
    return;
  }

  const primary = getPrimarySweepParamConfig();

  // A sweep is valid if:
  // (a) a strategy is selected AND
  // (b) EITHER a strategy-specific param has values OR at least one universal dim has values
  const hasStrategyParam = primary.values.length > 0 && primary.path;
  const hasUniversalDim = activeDims.length > 0;
  let disabled = !strategy || (!hasStrategyParam && !hasUniversalDim);
  let reason = '';

  if (!strategy) {
    reason = 'No strategy package is loaded. Open or save a strategy package first.';
  } else if (!hasStrategyParam && !hasUniversalDim) {
    reason = 'Select or add at least one sweep value.';
  }

  if (secondSlot.active && hasStrategyParam) {
    const hasSecond = secondSlot.values.length > 0 && secondSlot.paramPath;
    const gridSize = primary.values.length * secondSlot.values.length;
    disabled = disabled || !hasSecond || gridSize > 20 || gridSize === 0;
    if (!reason && !hasSecond) {
      reason = 'Finish or remove the second grid axis.';
    } else if (!reason && (gridSize > 20 || gridSize === 0)) {
      reason = `${gridSize} grid variants selected; max is 20.`;
    }
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

  if (totalVariants > 20) {
    disabled = true;
    if (!reason) reason = `${totalVariants} variants selected; max is 20.`;
  }

  if (btn) {
    btn.disabled = disabled;
    btn.textContent = 'Run Sweep';
    btn.title = totalVariants > 20
      ? `${totalVariants} variants (max 20) — reduce selections`
      : totalVariants > 1 ? `${totalVariants} total variants` : '';
  }
  if (btn) btn.title = reason || (totalVariants > 1 ? `${totalVariants} total variants` : '');
  setRunSweepDisabledReason(disabled ? reason : '');
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
  if (isRetiredSweepParamPath(manualPath)) {
    return { path: '', label: '', values: [] };
  }

  if (selectedPreset) {
    const preset = resolvePresetDef(selectedPreset);
    if (preset) {
      if (isRetiredSweepParamPath(preset.param_path || manualPath)) {
        return { path: '', label: '', values: [] };
      }
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
  const addBtn = document.getElementById('strategy-param-add-btn');
  const hasFirstParam = primary.values.length > 0 && primary.path;
  document.querySelectorAll('.strategy-param-subsection > summary .strategy-param-subsection-remove').forEach(btn => {
    if (btn.dataset.stopToggleBound === '1') return;
    btn.dataset.stopToggleBound = '1';
    btn.addEventListener('click', (event) => event.stopPropagation());
  });
  if (addBtn) {
    addBtn.disabled = secondSlot.active || !hasFirstParam;
    addBtn.title = secondSlot.active
      ? 'Entry criterion 2 already added'
      : hasFirstParam ? 'Add entry criterion' : 'Choose entry criterion 1 and values first';
  }

  if (!secondSlot.active) {
    container.innerHTML = '';
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

function renderSecondParameterSlotMarkup(groupsHtml) {
  return `
    <details class="strategy-param-subsection" open>
      <summary>
        <div>
          <div class="strategy-param-subsection-title">Entry Criterion 2</div>
          <div class="strategy-param-subsection-help">Optional grid axis across both entry criteria.</div>
        </div>
        <button type="button" onclick="removeSecondParamSlot()" class="strategy-param-subsection-remove" title="Remove entry criterion 2">×</button>
      </summary>
      <div class="strategy-param-subsection-body">
        <div class="parameter-control-card">
          <div class="form-group">
            <label class="form-label">Entry Criterion</label>
            <select id="custom-param-select-2" class="form-select">
              <option value="">Choose an entry criterion...</option>
              ${groupsHtml}
            </select>
            <div id="custom-param-help-2" class="custom-param-help" style="display:none;"></div>
          </div>
          <div class="form-group" id="suggested-values-group-2" style="display:none;">
            <label class="form-label">Suggested Values</label>
            <div id="suggested-values-2" class="suggested-values"></div>
          </div>
          <input id="custom-param-path-2" type="hidden" />
          <input id="custom-param-label-2" type="hidden" />
        </div>
        <div class="parameter-values-card">
          <div class="parameter-values-header">
            <div class="parameter-values-title">Values to Test</div>
            <div class="parameter-values-meta">axis 2</div>
          </div>
          <div class="values-pills" id="values-pills-2"></div>
          <div class="add-value-row">
            <input id="add-value-input-2" type="text" placeholder="e.g. 0.79" />
            <button onclick="addSecondSlotValue()">+ Add</button>
          </div>
        </div>
      </div>
    </details>`;
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
        <div class="sweep-section-label" style="border:none;padding:0;">Entry Criterion 2</div>
        <button type="button" onclick="removeSecondParamSlot()" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:14px;padding:0 4px;" title="Remove entry criterion 2">×</button>
      </div>
      <div class="form-group">
        <select id="custom-param-select-2" class="form-select">
              <option value="">Choose an entry criterion...</option>
          ${groupsHtml}
        </select>
        <div id="custom-param-help-2" class="custom-param-help" style="display:none;"></div>
      </div>
      <div class="form-group" id="suggested-values-group-2" style="display:none;">
        <label class="form-label">Suggested Values</label>
        <div id="suggested-values-2" class="suggested-values"></div>
      </div>
      <input id="custom-param-path-2" type="hidden" />
      <input id="custom-param-label-2" type="hidden" />
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
    helper.textContent = 'Add a second entry criterion to run a grid sweep across both axes.';
    if (title) {
      title.classList.add('strategy-param-subsection-title');
      title.after(helper);
    }
  }
  if (removeBtn) {
    removeBtn.className = 'strategy-param-subsection-remove';
    removeBtn.textContent = '×';
  }

  slot.innerHTML = renderSecondParameterSlotMarkup(groupsHtml);
  const secondRemoveBtn = slot.querySelector('.strategy-param-subsection-remove');
  if (secondRemoveBtn) {
    secondRemoveBtn.addEventListener('click', (event) => event.stopPropagation());
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
  if (help) {
    help.textContent = preset.description || '';
    help.style.display = preset.description ? 'block' : 'none';
  }
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
  if (verdict === 'PROMISING_BUT_NOT_VALIDATED') return 'PROMISING_BUT_NOT_VALIDATED';
  if (verdict === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
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
  if (normalized === 'candidate') return 'Sweep Candidate';
  if (normalized === 'tier2') return 'Tier 2';
  if (normalized === 'tier2r') return 'T2R';
  if (normalized === 'tier3') return 'Tier 3';
  if (normalized === 'clean') return 'Clean Universe';
  if (normalized === 'tier1s') return 'Tier 1S';
  if (normalized === 'tier1bs') return 'Tier 1BS';
  if (normalized === 'tier1b') return 'Tier 1B';
  if (normalized === 'tier1') return 'Tier 1';
  return normalized ? normalized.toUpperCase() : 'Tier ?';
}

function evidenceModeLabel(mode, targetTrades = null) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === 'evidence_50') return 'Evidence 50 trades';
  if (normalized === 'evidence_100') return 'Evidence 100 trades';
  if (normalized === 'evidence_200') return 'Evidence 200 trades';
  if (normalized === 'evidence_500') return 'Evidence 500 trades';
  if (normalized === 'full_clean') return 'Full clean universe';
  if (targetTrades) return `Evidence ${targetTrades} trades`;
  return '';
}

function sweepScopeLabel(sweep) {
  return evidenceModeLabel(sweep?.evidence_mode, sweep?.evidence_target_trades) || tierLabel(sweep?.tier || '');
}

function getStrategyName(strategyVersionId) {
  return strategyCatalog.get(strategyVersionId)?.name || strategyVersionId;
}

function getStrategyStageLabel(strategyVersionId, fallbackTier) {
  const strategy = strategyCatalog.get(strategyVersionId);
  const stage = String(strategy?.sweep_stage || '').toLowerCase();
  if (stage === 'candidate') return 'Sweep Candidate';
  if (stage === 'tier2r') return 'T2R';
  if (stage === 'tier2') return 'Tier 2';
  if (stage === 'tier3') return 'Tier 3';
  if (stage === 'tier1s') return 'T1S';
  if (stage === 'tier1bs') return 'T1BS';
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
    ? `${sweep.sweep_id} · ${sweepScopeLabel(sweep)}`
    : '';
}

function restoreSweepConfig(sweep) {
  clearActiveFundamentalSweepSession();
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
  const isRetiredPrimaryParam = isRetiredSweepParamPath(param.param_path);
  const pickerKey = isRetiredPrimaryParam ? '' : (findPresetKeyForParam(param) || findPresetKeyByPath(param.param_path));
  clearPresetSelection();
  customValues = isRetiredPrimaryParam ? [] : (Array.isArray(param.values) ? [...param.values] : []);
  if (pathInput) pathInput.value = isRetiredPrimaryParam ? '' : (param.param_path || '');
  if (labelInput) labelInput.value = isRetiredPrimaryParam ? '' : (param.label || '');
  setCustomParameterPickerValue(pickerKey);

  if (valueInput) valueInput.value = '';
  renderValuePills();

  // Restore second param slot if this was a grid sweep
  const param2 = sweep?.sweep_params?.[1];
  if (param2 && !isRetiredSweepParamPath(param2.param_path)) {
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
        Final verdict: <span class="verdict-badge ${getDisplayVerdict(report)}" style="margin-left:var(--space-6);">${displayVerdict.replace(/_/g, ' ')}</span>
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
          <span class="verdict-badge ${verdict}">${verdict.replace(/_/g, ' ')}</span>
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

async function ensureSweepVariantReports(sweep) {
  const reportIds = Array.from(new Set((sweep?.variants || [])
    .filter(variant => variant?.status === 'completed' && variant?.report_id)
    .map(variant => String(variant.report_id))));
  if (!reportIds.length) return;
  await Promise.all(reportIds.map(reportId => fetchSweepReport(reportId).catch(() => null)));
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
          <div class="sweep-compare-subtitle">Reference is the original validator report for ${reportEscHtml(getStrategyName(sweep.base_strategy_version_id))} at ${reportEscHtml(sweepScopeLabel(sweep))}. Each selected sweep value appears as a row underneath. Hover the short headers for the full validation-criteria meaning.</div>
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

function fmtFundamentalMetric(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(1) + suffix;
}

function fundamentalValueLabel(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return 'none';
  return String(value);
}

function parseFundamentalSweepValue(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.toLowerCase() === 'none' || text.toLowerCase() === 'null') return null;
  if (text.includes(',')) {
    return text.split(',').map(part => Number(part.trim())).filter(value => Number.isFinite(value));
  }
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

function getFundamentalSelectedValuesForIdx(idx) {
  const selected = [];
  document.querySelectorAll(`.fundamental-sweep-pill.selected[data-param-idx="${idx}"]`).forEach((pill) => {
    selected.push(parseFundamentalSweepValue(pill.dataset.value || ''));
  });
  const seen = new Set();
  return selected.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Returns the sweep_params (with selected values) for every dimension that has
// at least one highlighted value.
function getSelectedFundamentalSweepParams() {
  const params = activeFundamentalSweepSession?.sweep_params || [];
  const out = [];
  params.forEach((param, idx) => {
    if (!isFundamentalEntrySweepParam(param)) return;
    const values = getFundamentalSelectedValuesForIdx(idx);
    if (values.length) out.push({ ...param, values });
  });
  return out;
}

function isFundamentalEntrySweepParam(param) {
  const path = String(param?.param_path || '');
  return path.startsWith('entry.metric:') || path.startsWith('exclusion.metric:');
}

function getFundamentalGridSize() {
  const selected = getSelectedFundamentalSweepParams();
  if (!selected.length) return 0;
  return selected.reduce((acc, param) => acc * param.values.length, 1);
}

function fundamentalSweepValueEncoded(value) {
  return encodeURIComponent(Array.isArray(value) ? value.join(',') : String(value === null || value === undefined ? 'none' : value));
}

function fundamentalSweepValuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, idx) => fundamentalSweepValuesEqual(value, b[idx]));
  }
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) {
    return Math.abs(an - bn) < 0.000001;
  }
  return String(a) === String(b);
}

function getFundamentalBaseConfigValue(session, paramValue) {
  const path = String(paramValue?.param_path || '');
  const base = session?.base_config || {};
  if (path.startsWith('entry.metric:')) {
    const metric = path.slice('entry.metric:'.length);
    const rules = Array.isArray(base.entry?.all) ? base.entry.all : [];
    return rules.find(rule => rule?.metric === metric)?.value;
  }
  if (path.startsWith('exclusion.metric:')) {
    const metric = path.slice('exclusion.metric:'.length);
    const rules = Array.isArray(base.exclusions) ? base.exclusions : [];
    return rules.find(rule => rule?.metric === metric)?.value;
  }
  if (path.startsWith('exit.')) {
    return path.slice('exit.'.length).split('.').reduce((value, key) => value?.[key], base.exit || {});
  }
  return path.split('.').reduce((value, key) => value?.[key], base);
}

function isFundamentalCurrentBaselineVariant(session, variant) {
  const values = Array.isArray(variant?.param_values) ? variant.param_values : [];
  if (!values.length) return false;
  return values.every(paramValue => fundamentalSweepValuesEqual(paramValue.value, getFundamentalBaseConfigValue(session, paramValue)));
}

function updateFundamentalSweepSelectedMeta() {
  document.querySelectorAll('.fundamental-dim-count').forEach((el) => {
    const idx = el.getAttribute('data-param-idx');
    const n = document.querySelectorAll(`.fundamental-sweep-pill.selected[data-param-idx="${idx}"]`).length;
    el.textContent = n ? `${n} selected` : 'none selected';
  });
  updateRunButton();
}

function toggleFundamentalSweepValue(el) {
  if (!el) return;
  el.classList.toggle('selected');
  updateFundamentalSweepSelectedMeta();
}

function addFundamentalSweepValue(idx = 0) {
  const input = document.querySelector(`.fundamental-dim-add[data-param-idx="${idx}"]`);
  const raw = String(input?.value || '').trim();
  if (!raw) return;
  const value = parseFundamentalSweepValue(raw);
  const encoded = fundamentalSweepValueEncoded(value);
  const existing = Array.from(document.querySelectorAll(`.fundamental-sweep-pill[data-param-idx="${idx}"]`))
    .find(pill => String(pill.dataset.value || '') === encoded);
  if (existing) {
    existing.classList.add('selected');
  } else {
    const wrap = document.querySelector(`.fundamental-dim-card[data-param-idx="${idx}"] .udim-values`);
    if (wrap) {
      const label = reportEscHtml(fundamentalValueLabel(value));
      wrap.insertAdjacentHTML('beforeend', `<span class="udim-pill selected custom fundamental-sweep-pill" data-param-idx="${idx}" data-value="${encoded}" onclick="toggleFundamentalSweepValue(this)">${label}<button type="button" aria-label="Remove ${label}">×</button></span>`);
    }
  }
  if (input) {
    input.value = '';
    input.focus();
  }
  updateFundamentalSweepSelectedMeta();
}

function renderFundamentalSweepSession(session) {
  activeFundamentalSweepSession = session;
  activeFundamentalSweepSessionId = String(session?.session_id || '');
  const promotedStrategyId = String(session?.promoted_strategy_version_id || '').trim();
  if (promotedStrategyId) {
    const strategySelect = document.getElementById('sweep-strategy-select');
    if (strategySelect && !strategySelect.querySelector(`option[value="${CSS.escape(promotedStrategyId)}"]`)) {
      const opt = document.createElement('option');
      opt.value = promotedStrategyId;
      strategySelect.appendChild(opt);
    }
    if (strategySelect) strategySelect.value = promotedStrategyId;
    activeConfiguredStrategyVersionId = promotedStrategyId;
    persistActiveStrategyId(promotedStrategyId);
    ensureStrategySpec(promotedStrategyId).then(() => {
      renderStrategyAnatomy();
      configureSweepTierSelector();
      setupCustomParameterPicker();
    });
  } else {
    activeConfiguredStrategyVersionId = null;
    persistActiveStrategyId('');
  }
  persistActiveSweepId('');
  if (!promotedStrategyId) persistActiveFundamentalSweepId(activeFundamentalSweepSessionId);

  const display = document.getElementById('sweep-strategy-display');
  if (display) {
    const source = session.source || {};
    const metrics = source.metrics || {};
    display.innerHTML = `
      <div class="sweep-name">${reportEscHtml(source.rule_name || 'Fundamental Research Candidate')}</div>
      <div class="sweep-meta">Fundamental Backtester · ${reportEscHtml(session.candidate_state || 'research_candidate')} · ${reportEscHtml(session.source_run_id || '')}</div>
      <div style="margin-top:var(--space-8);font-size:var(--text-caption);line-height:1.6;color:var(--color-text-subtle);">
        Score <strong style="color:var(--color-text);">${reportEscHtml(fmtFundamentalMetric(source.research_score))}</strong>
        · Trades <strong style="color:var(--color-text);">${reportEscHtml(String(metrics.trade_count ?? '-'))}</strong>
        · Win <strong style="color:var(--color-text);">${reportEscHtml(fmtFundamentalMetric(metrics.win_rate_pct, '%'))}</strong>
        · Avg <strong style="color:var(--color-text);">${reportEscHtml(fmtFundamentalMetric(metrics.average_return_pct, '%'))}</strong>
      </div>
    `;
  }

  const grid = document.getElementById('sweep-grid-controls');
  if (grid) {
    const params = Array.isArray(session.sweep_params)
      ? session.sweep_params.filter(isFundamentalEntrySweepParam)
      : [];
    grid.innerHTML = `
      <div class="sweep-section-label">Fundamental Entry Dimensions</div>
      <div style="font-size:var(--text-caption);color:var(--color-text-subtle);line-height:1.6;margin-bottom:var(--space-8);">
        Highlight the entry or exclusion thresholds you want to test. Leave a dimension empty to keep its baseline. Selecting values in more than one dimension builds a grid (max 20 variants).
      </div>
      <div id="fundamental-sweep-dims">
        ${params.map((param, idx) => {
          const values = Array.isArray(param.values) ? param.values : [];
          const label = reportEscHtml(param.label || param.param_path || `Dimension ${idx + 1}`);
          return `
            <div class="udim-values-card fundamental-dim-card" data-param-idx="${idx}" style="margin-bottom:var(--space-8);">
              <div class="parameter-values-header">
                <div class="parameter-values-title">${label}</div>
                <div class="parameter-values-meta fundamental-dim-count" data-param-idx="${idx}">none selected</div>
              </div>
              <div class="udim-values">
                ${values.map(value => {
                  const encoded = fundamentalSweepValueEncoded(value);
                  const vlabel = reportEscHtml(fundamentalValueLabel(value));
                  return `<span class="udim-pill fundamental-sweep-pill" data-param-idx="${idx}" data-value="${encoded}" onclick="toggleFundamentalSweepValue(this)">${vlabel}</span>`;
                }).join('')}
              </div>
              <div class="add-value-row udim-add-value-row">
                <input class="fundamental-dim-add" data-param-idx="${idx}" type="text" placeholder="e.g. 15" onkeydown="if (event.key === 'Enter') addFundamentalSweepValue(${idx})" />
                <button type="button" onclick="addFundamentalSweepValue(${idx})">+ Add</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    updateFundamentalSweepSelectedMeta();
  }

  updateRunButton();

  renderFundamentalSweepResults(session);
  if (String(session?.status || '').toLowerCase() === 'running' && !pollTimer) {
    startFundamentalSweepPolling(activeFundamentalSweepSessionId);
  }
}

function renderFundamentalSweepResults(session) {
  const panel = document.getElementById('results-body');
  const title = document.getElementById('results-sweep-id');
  if (title) title.textContent = session?.session_id ? ` · ${session.session_id}` : '';
  if (!panel) return;

  const source = session.source || {};
  const params = Array.isArray(session.sweep_params) ? session.sweep_params : [];
  const variants = Array.isArray(session.variants) ? session.variants : [];
  const rules = (source.tested_rules || []).map(rule => `<div>${reportEscHtml(rule)}</div>`).join('') || '<div>-</div>';
  const winnerId = session.winner?.variant_id || '';
  const canPromoteWinner = String(session.status || '').toLowerCase() === 'completed' && winnerId;
  const promotedStrategyId = String(session.promoted_strategy_version_id || '').trim();
  const canSaveStrategyPackage = !promotedStrategyId && (canPromoteWinner || session.source_run_id);

  const rows = variants.length ? variants.map((variant) => {
    const isCurrentBaseline = isFundamentalCurrentBaselineVariant(session, variant);
    const valueText = (variant.param_values || []).map(pv => `${pv.label}: ${fundamentalValueLabel(pv.value)}`).join('<br>');
    const values = `${isCurrentBaseline ? 'Current baseline: ' : ''}${valueText}`;
    const metrics = variant.metrics || {};
    const isWinner = winnerId && winnerId === variant.variant_id;
    const statusLabel = `${variant.status || '-'}${isCurrentBaseline ? ' / apples-to-apples' : ''}`;
    return `
      <tr class="${isWinner ? 'winner' : isCurrentBaseline ? 'baseline' : ''}">
        <td>${isWinner ? '★ ' : ''}${reportEscHtml(values || variant.variant_id)}</td>
        <td>${reportEscHtml(statusLabel)}</td>
        <td>${reportEscHtml(fmtFundamentalMetric(variant.research_score))}</td>
        <td>${reportEscHtml(String(metrics.trade_count ?? '-'))}</td>
        <td>${reportEscHtml(fmtFundamentalMetric(metrics.median_return_pct, '%'))}</td>
        <td>${reportEscHtml(fmtFundamentalMetric(metrics.average_return_pct, '%'))}</td>
        <td>${reportEscHtml(fmtFundamentalMetric(metrics.win_rate_pct, '%'))}</td>
        <td>${reportEscHtml(fmtFundamentalMetric(metrics.benchmark_beat_rate_pct, '%'))}</td>
      </tr>
    `;
  }).join('') : '';
  const baselineMetrics = source.metrics || {};
  const baselineRow = `
    <tr class="baseline">
      <td>Original saved run</td>
      <td>historical reference</td>
      <td>${reportEscHtml(fmtFundamentalMetric(source.research_score))}</td>
      <td>${reportEscHtml(String(baselineMetrics.trade_count ?? '-'))}</td>
      <td>${reportEscHtml(fmtFundamentalMetric(baselineMetrics.median_return_pct, '%'))}</td>
      <td>${reportEscHtml(fmtFundamentalMetric(baselineMetrics.average_return_pct, '%'))}</td>
      <td>${reportEscHtml(fmtFundamentalMetric(baselineMetrics.win_rate_pct, '%'))}</td>
      <td>${reportEscHtml(fmtFundamentalMetric(baselineMetrics.benchmark_beat_rate_pct, '%'))}</td>
    </tr>
  `;

  panel.innerHTML = `
    <div class="sweep-report-shell">
      <div class="sweep-report-header">
        <div class="sweep-report-header-main">
          <h2>Fundamental Research Candidate</h2>
          <div class="sweep-report-subtitle">${reportEscHtml(source.rule_name || '-')} · ${reportEscHtml(session.candidate_state || 'research_candidate')} · not validated</div>
        </div>
        <div class="sweep-report-header-actions">
          <button class="sweep-inline-btn" type="button" id="copy-fundamental-sweep-report-btn" onclick="copyFundamentalSweepReport()">Copy Report</button>
          ${promotedStrategyId ? `
            <a class="sweep-inline-btn" href="/validator.html?strategy_version_id=${encodeURIComponent(promotedStrategyId)}" target="_blank">Open In Validator</a>
          ` : canSaveStrategyPackage ? `
            <button class="sweep-inline-btn" type="button" onclick="promoteFundamentalSweepWinner()">Save Strategy Package</button>
          ` : ''}
        </div>
      </div>
      <div class="sweep-compare-grid">
        <div class="sweep-compare-card baseline">
          <div class="sweep-compare-card-title">Source Run</div>
          <div class="sweep-compare-row"><span class="sweep-compare-metric-label">Saved run</span><span>${reportEscHtml(session.source_run_id || '-')}</span></div>
          <div class="sweep-compare-row"><span class="sweep-compare-metric-label">Universe</span><span>${reportEscHtml(source.universe || '-')}</span></div>
          <div class="sweep-compare-row"><span class="sweep-compare-metric-label">Range</span><span>${reportEscHtml(source.date_range || '-')}</span></div>
          <div class="sweep-compare-row"><span class="sweep-compare-metric-label">Score</span><span>${reportEscHtml(fmtFundamentalMetric(source.research_score))}</span></div>
        </div>
        <div class="sweep-compare-card">
          <div class="sweep-compare-card-title">Original Rules</div>
          <div style="font-family:var(--font-mono);font-size:var(--text-caption);line-height:1.7;">${rules}</div>
        </div>
      </div>
      <div style="margin-top:var(--space-12);font-size:var(--text-caption);color:var(--color-text-subtle);">
        Generated dimensions: ${reportEscHtml(params.map(p => p.label).join(', ') || '-')}
        <br>
        Original saved run is historical. The variant marked apples-to-apples is rerun inside this sweep, so compare other variants to that row.
      </div>
      ${variants.length ? `
        <div class="sweep-compare-table-wrap" style="margin-top:var(--space-12);">
          <table class="sweep-compare-table">
            <thead><tr><th>Variant</th><th>Status</th><th>Score</th><th>Trades</th><th>Median</th><th>Avg</th><th>Win</th><th>Beat</th></tr></thead>
            <tbody>${baselineRow}${rows}</tbody>
          </table>
        </div>
      ` : `
        <div class="empty-state" style="margin-top:var(--space-16);">
          <div class="empty-state-title">Ready to sweep</div>
          <div class="empty-state-subtitle">Choose a generated fundamental dimension on the left, then run the first variant set.</div>
        </div>
      `}
    </div>
  `;
}

function buildFundamentalSweepReportText(session = activeFundamentalSweepSession) {
  const source = session?.source || {};
  const metrics = source.metrics || {};
  const params = Array.isArray(session?.sweep_params) ? session.sweep_params : [];
  const variants = Array.isArray(session?.variants) ? session.variants : [];
  const rules = Array.isArray(source.tested_rules) ? source.tested_rules : [];
  const exclusions = Array.isArray(source.exclusion_rules) ? source.exclusion_rules : [];
  const lines = [
    'Fundamental Sweep Report',
    `Session id: ${session?.session_id || '-'}`,
    `Status: ${session?.status || '-'}`,
    `Source run: ${session?.source_run_id || '-'}`,
    `Rule: ${source.rule_name || '-'}`,
    `Universe: ${source.universe || '-'}`,
    `Range: ${source.date_range || '-'}`,
    `Source score: ${fmtFundamentalMetric(source.research_score)}`,
    `Source trades: ${metrics.trade_count ?? '-'}`,
    `Source win: ${fmtFundamentalMetric(metrics.win_rate_pct, '%')}`,
    `Source avg: ${fmtFundamentalMetric(metrics.average_return_pct, '%')}`,
    '',
    'Original rules:',
    ...(rules.length ? rules.map(rule => `- ${rule}`) : ['-']),
  ];
  if (exclusions.length) {
    lines.push('', 'Exclusions:', ...exclusions.map(rule => `- ${rule}`));
  }
  lines.push(
    '',
    `Generated dimensions: ${params.map(param => param.label || param.param_path).join(', ') || '-'}`,
    'Baseline note: original saved run is historical; variants marked apples-to-apples were rerun inside this sweep.',
    '',
    'Variants:',
    ['Variant', 'Status', 'Score', 'Trades', 'Median', 'Avg', 'Win', 'Beat'].join('\t'),
  );
  lines.push([
    'Original saved run',
    'historical reference',
    fmtFundamentalMetric(source.research_score),
    metrics.trade_count ?? '-',
    fmtFundamentalMetric(metrics.median_return_pct, '%'),
    fmtFundamentalMetric(metrics.average_return_pct, '%'),
    fmtFundamentalMetric(metrics.win_rate_pct, '%'),
    fmtFundamentalMetric(metrics.benchmark_beat_rate_pct, '%'),
  ].join('\t'));
  if (!variants.length) {
    return lines.join('\n');
  }
  for (const variant of variants) {
    const isCurrentBaseline = isFundamentalCurrentBaselineVariant(session, variant);
    const values = (variant.param_values || [])
      .map(pv => `${pv.label}: ${fundamentalValueLabel(pv.value)}`)
      .join(', ') || variant.variant_id || '-';
    const m = variant.metrics || {};
    lines.push([
      `${isCurrentBaseline ? 'Current baseline: ' : ''}${values}`,
      `${variant.status || '-'}${isCurrentBaseline ? ' / apples-to-apples' : ''}`,
      fmtFundamentalMetric(variant.research_score),
      m.trade_count ?? '-',
      fmtFundamentalMetric(m.median_return_pct, '%'),
      fmtFundamentalMetric(m.average_return_pct, '%'),
      fmtFundamentalMetric(m.win_rate_pct, '%'),
      fmtFundamentalMetric(m.benchmark_beat_rate_pct, '%'),
    ].join('\t'));
  }
  return lines.join('\n');
}

function copyFundamentalSweepReport() {
  const text = buildFundamentalSweepReportText();
  const btn = document.getElementById('copy-fundamental-sweep-report-btn');
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy Report'; }, 1500);
  }).catch(() => {
    window.prompt('Copy report text:', text);
  });
}

async function loadFundamentalSweepSession(sessionId) {
  const res = await fetch(`${API}/research/fundamental-backtest/sweep-sessions/${encodeURIComponent(sessionId)}`);
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error || 'Failed to load fundamental sweep session');
  const session = payload.data;
  let strategyVersionId = String(session?.promoted_strategy_version_id || '').trim();
  if (!strategyVersionId) {
    const promoteRes = await fetch(`${API}/research/fundamental-backtest/sweep-sessions/${encodeURIComponent(sessionId)}/promote-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const promotedPayload = await promoteRes.json();
    if (!promotedPayload.success) throw new Error(promotedPayload.error || 'Failed to save fundamental strategy package');
    strategyVersionId = String(promotedPayload.data?.strategy_version_id || '').trim();
  }
  if (strategyVersionId) {
    await loadStrategyCatalog();
    await loadStrategies();
    await switchToStrategy(strategyVersionId);
    const url = new URL(window.location.href);
    url.searchParams.delete('fundamental_sweep_id');
    url.searchParams.set('strategy_version_id', strategyVersionId);
    window.history.replaceState({}, '', url.toString());
    return;
  }
  renderFundamentalSweepSession(session);
}

async function runFundamentalSweep() {
  if (!activeFundamentalSweepSessionId || !activeFundamentalSweepSession) return;
  const btn = document.getElementById('btn-run-sweep');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try {
    const sweepParams = getSelectedFundamentalSweepParams();
    if (!sweepParams.length) {
      throw new Error('Highlight at least one fundamental entry or exclusion value before running.');
    }
    const gridSize = sweepParams.reduce((acc, p) => acc * p.values.length, 1);
    if (gridSize > 20) {
      throw new Error(`Grid produces ${gridSize} variants — maximum is 20. Deselect some values.`);
    }
    const res = await fetch(`${API}/research/fundamental-backtest/sweep-sessions/${encodeURIComponent(activeFundamentalSweepSessionId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sweep_params: sweepParams }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed to start fundamental sweep');
    renderFundamentalSweepSession(payload.data);
    startFundamentalSweepPolling(activeFundamentalSweepSessionId);
  } catch (err) {
    alert(`Failed to start fundamental sweep: ${err.message || err}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Run Sweep'; }
  }
}

async function promoteFundamentalSweepWinner(variantId = '') {
  if (!activeFundamentalSweepSessionId) return;
  try {
    const res = await fetch(`${API}/research/fundamental-backtest/sweep-sessions/${encodeURIComponent(activeFundamentalSweepSessionId)}/promote-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant_id: variantId || undefined }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed to save strategy package');
    renderFundamentalSweepSession(payload.data.session);
    if (payload.data.strategy_version_id) {
      await loadStrategyCatalog();
      await loadStrategies();
      await switchToStrategy(payload.data.strategy_version_id, { skipLoadSweeps: true });
      updateRunButton();
    }
    if (payload.data.url) {
      window.open(payload.data.url, '_blank');
    }
  } catch (err) {
    alert(`Failed to save strategy package: ${err.message || err}`);
  }
}

function startFundamentalSweepPolling(sessionId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadFundamentalSweepSession(sessionId);
    const status = String(activeFundamentalSweepSession?.status || '').toLowerCase();
    if (status !== 'running') {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 5000);
}

async function runSweep() {
  if (activeFundamentalSweepSessionId && activeFundamentalSweepSession && !getConfiguredStrategyVersionId()) {
    return runFundamentalSweep();
  }

  const strategyVersionId = getConfiguredStrategyVersionId();
  if (!strategyVersionId) return;

  const btn = document.getElementById('btn-run-sweep');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const evidenceSelection = String(document.getElementById('sweep-tier-select')?.value || 'evidence_100').trim().toLowerCase();
    const evidenceTargets = { evidence_50: 50, evidence_100: 100, evidence_200: 200, evidence_500: 500 };
    const tier = ['evidence_50', 'evidence_100', 'evidence_200', 'evidence_500', 'full_clean'].includes(evidenceSelection)
      ? 'clean'
      : evidenceSelection;
    const body = {
      strategy_version_id: strategyVersionId,
      tier,
      evidence_mode: evidenceSelection,
      evidence_target_trades: evidenceTargets[evidenceSelection] || null,
      session_id: ensureActiveSweepSession(),
      session_started_at: sessionStartedAt,
      session_note: activeSweepSessionNote,
    };
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

function makeSweepSessionId(startedAt = new Date().toISOString()) {
  const stamp = String(startedAt || new Date().toISOString())
    .replace(/[^0-9]/g, '')
    .slice(0, 14) || String(Date.now());
  return `sws_${stamp}_${Math.random().toString(36).slice(2, 6)}`;
}

function ensureActiveSweepSession() {
  if (!sessionStartedAt) {
    sessionStartedAt = new Date().toISOString();
    window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
  }
  if (!activeSweepSessionId) {
    activeSweepSessionId = makeSweepSessionId(sessionStartedAt);
    window.localStorage.setItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY, activeSweepSessionId);
  }
  return activeSweepSessionId;
}

function updateSessionNoteInput() {
  const input = document.getElementById('sweep-session-note');
  if (input && input.value !== activeSweepSessionNote) input.value = activeSweepSessionNote;
}

function updateCurrentSweepSessionNote(value) {
  activeSweepSessionNote = String(value || '').slice(0, 240);
  window.localStorage.setItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY, activeSweepSessionNote);
}

async function refreshActiveValidatorJobIds() {
  try {
    const res = await fetch(`${API}/validator/runs/active`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.data)) return;
    activeValidatorJobIds = new Set(
      data.data
        .map(job => String(job?.job_id || '').trim())
        .filter(Boolean),
    );
  } catch {
    activeValidatorJobIds = null;
  }
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
    if (String(data.data?.status || '').toLowerCase() === 'running') {
      await refreshActiveValidatorJobIds();
    }
    await ensureSweepReferenceReport(data.data);
    await ensureSweepVariantReports(data.data);
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
  setSweepActivityIndicator({
    status: 'running',
    variants: [{ status: 'running', param_label: 'Starting', param_value: 'initializing' }],
    sweep_params: [],
  });
  document.getElementById('results-body').innerHTML = `
    <div class="sweep-progress">
      <div class="sweep-progress-bar-track"><div class="sweep-progress-bar-fill" style="width:5%"></div></div>
      <span class="sweep-progress-label">Starting sweep...</span>
    </div>
  `;
}

function sweepVariantLabel(sweep, variant) {
  if (!variant) return 'N/A';
  const isGrid = (sweep?.sweep_params?.length || 0) > 1;
  if (isGrid && Array.isArray(variant.param_values) && variant.param_values.length > 0) {
    return variant.param_values.map(pv => `${pv.label || pv.param_path || 'Param'}=${pv.value}`).join(', ');
  }
  const label = sweep?.sweep_params?.[0]?.label || variant.param_label || variant.param_path || 'Parameter';
  return `${label}=${variant.param_value}`;
}

function sweepReportDiagnostics(report) {
  const r = report || {};
  const ts = r.trades_summary || {};
  const rs = r.risk_summary || {};
  const rob = r.robustness || {};
  const oos = rob.out_of_sample || {};
  const wf = rob.walk_forward || {};
  const mc = rob.monte_carlo || {};
  const ps = rob.parameter_sensitivity || {};
  const cfg = r.config || {};
  const thr = cfg.validation_thresholds || {};
  return {
    report_id: r.report_id || '',
    verdict: getDisplayVerdict(r).replace(/_/g, ' '),
    trades: reportInt(ts.total_trades),
    winners: reportInt(ts.winners),
    losers: reportInt(ts.losers),
    win_rate_pct: reportNum(ts.win_rate) * 100,
    expectancy_R: reportNum(ts.expectancy_R),
    profit_factor: reportNum(ts.profit_factor),
    avg_win_R: reportNum(ts.avg_win_R),
    avg_loss_R: reportNum(ts.avg_loss_R),
    largest_win_R: reportNum(ts.largest_win_R),
    largest_loss_R: reportNum(ts.largest_loss_R),
    max_dd_pct: reportNum(rs.max_drawdown_pct),
    max_dd_R: reportNum(rs.max_drawdown_R),
    sharpe: reportNum(rs.sharpe_ratio),
    calmar: reportNum(rs.calmar_ratio),
    is_expectancy_R: reportNum(oos.is_expectancy),
    is_n: reportInt(oos.is_n),
    oos_expectancy_R: reportNum(oos.oos_expectancy),
    oos_n: reportInt(oos.oos_n),
    oos_degradation_pct: reportNum(oos.oos_degradation_pct),
    split_date: oos.split_date || '',
    wf_windows: Array.isArray(wf.windows) ? wf.windows.length : reportInt(wf.window_count || wf.windows),
    wf_avg_test_expectancy_R: reportNum(wf.avg_test_expectancy),
    wf_profitable_windows_pct: reportNum(wf.pct_profitable_windows) * 100,
    mc_simulations: reportInt(mc.simulations),
    mc_median_dd_pct: reportNum(mc.median_dd_pct),
    mc_p95_dd_pct: reportNum(mc.p95_dd_pct),
    mc_p99_dd_pct: reportNum(mc.p99_dd_pct),
    mc_median_final_R: reportNum(mc.median_final_R),
    sensitivity_score: reportNum(ps.sensitivity_score),
    base_expectancy_R: reportNum(ps.base_expectancy),
    min_trades_pass: reportInt(thr.min_trades_pass || 30),
    max_mc_p95_dd_pct: reportNum(thr.max_mc_p95_dd_pct || 30),
    max_mc_p99_dd_pct: reportNum(thr.max_mc_p99_dd_pct || 50),
    max_oos_degradation_pct: reportNum(thr.max_oos_degradation_pct || 50),
    min_wf_profitable_windows_pct: reportNum(thr.min_wf_profitable_windows || 0.6) * 100,
    pass_fail_reasons: Array.isArray(r.pass_fail_reasons) ? r.pass_fail_reasons : [],
    universe_count: Array.isArray(cfg.universe) ? cfg.universe.length : 0,
    universe: Array.isArray(cfg.universe) ? cfg.universe : [],
  };
}

function buildSweepFullCopyText(sweep, sortedVariants) {
  const lines = [];
  const strategyName = getStrategyName(sweep?.base_strategy_version_id) || sweep?.base_strategy_version_id || 'N/A';
  lines.push('Parameter Sweep Full Report');
  lines.push(`Sweep id: ${sweep?.sweep_id || 'N/A'}`);
  lines.push(`Session id: ${sweep?.session_id || 'legacy / ungrouped'}`);
  lines.push(`Session started: ${sweep?.session_started_at || 'N/A'}`);
  lines.push(`Session note: ${sweep?.session_note || 'No session note'}`);
  lines.push(`Status: ${sweep?.status || 'N/A'}`);
  lines.push(`Strategy: ${strategyName}`);
  lines.push(`Base strategy version: ${sweep?.base_strategy_version_id || 'N/A'}`);
  lines.push(`Evidence scope: ${sweepScopeLabel(sweep)}`);
  lines.push(`Backend universe: ${tierLabel(sweep?.tier || '')}`);
  lines.push(`Interval: ${sweep?.interval || 'N/A'}`);
  lines.push(`Created: ${sweep?.created_at || 'N/A'}`);
  lines.push(`Completed: ${sweep?.completed_at || 'N/A'}`);
  if (sweep?.winner) {
    lines.push(`Winner: ${sweepVariantLabel(sweep, sweep.winner)}`);
  }
  lines.push('');
  lines.push('Sweep axes:');
  for (const param of (sweep?.sweep_params || [])) {
    lines.push(`- ${param.label || param.param_path}: ${Array.isArray(param.values) ? param.values.join(', ') : ''} (${param.param_path || 'no path'})`);
  }

  const header = [
    'Variant',
    'Status',
    'Verdict',
    'Report ID',
    'Trades',
    'Winners',
    'Losers',
    'Win Rate %',
    'Expectancy R',
    'Profit Factor',
    'Avg Win R',
    'Avg Loss R',
    'Largest Win R',
    'Largest Loss R',
    'Max DD %',
    'Max DD R',
    'Sharpe',
    'Calmar',
    'IS Expectancy R',
    'IS n',
    'OOS Expectancy R',
    'OOS n',
    'OOS Degradation %',
    'Split Date',
    'WF Windows',
    'WF Avg Test Exp R',
    'WF Profitable Windows %',
    'MC Simulations',
    'MC Median DD %',
    'MC p95 DD %',
    'MC p99 DD %',
    'MC Median Final R',
    'Sensitivity Score',
    'Base Expectancy R',
    'Min Trades Pass',
    'MC p95 Threshold %',
    'MC p99 Threshold %',
    'OOS Degradation Threshold %',
    'WF Profitable Threshold %',
    'Universe Count',
    'Fail / Review Reasons',
  ];

  lines.push('');
  lines.push('Variant diagnostics:');
  lines.push(header.join('\t'));
  for (const variant of sortedVariants) {
    const report = variant?.report_id ? sweepReportCache.get(variant.report_id) : null;
    const d = report ? sweepReportDiagnostics(report) : null;
    const m = variant.metrics || {};
    const isWinner = sweep?.winner?.variant_id === variant.variant_id;
    if (!d) {
      const partial = Array(header.length).fill('');
      partial[0] = `${isWinner ? 'Winner: ' : ''}${sweepVariantLabel(sweep, variant)}`;
      partial[1] = variant.status || 'N/A';
      partial[2] = getDisplayVerdict(m || {}).replace(/_/g, ' ');
      partial[3] = variant.report_id || '';
      partial[4] = m.total_trades ?? '';
      partial[7] = m.win_rate != null ? (Number(m.win_rate) * 100).toFixed(1) : '';
      partial[8] = m.expectancy_R != null ? Number(m.expectancy_R).toFixed(3) : '';
      partial[9] = m.profit_factor != null ? Number(m.profit_factor).toFixed(2) : '';
      partial[14] = m.max_drawdown_pct != null ? Number(m.max_drawdown_pct).toFixed(1) : '';
      partial[16] = m.sharpe_ratio != null ? Number(m.sharpe_ratio).toFixed(2) : '';
      lines.push(partial.join('\t'));
      continue;
    }
    lines.push([
      `${isWinner ? 'Winner: ' : ''}${sweepVariantLabel(sweep, variant)}`,
      variant.status || 'N/A',
      d.verdict,
      d.report_id,
      d.trades,
      d.winners,
      d.losers,
      d.win_rate_pct.toFixed(1),
      d.expectancy_R.toFixed(3),
      d.profit_factor.toFixed(2),
      d.avg_win_R.toFixed(3),
      d.avg_loss_R.toFixed(3),
      d.largest_win_R.toFixed(3),
      d.largest_loss_R.toFixed(3),
      d.max_dd_pct.toFixed(1),
      d.max_dd_R.toFixed(2),
      d.sharpe.toFixed(2),
      d.calmar.toFixed(2),
      d.is_expectancy_R.toFixed(3),
      d.is_n,
      d.oos_expectancy_R.toFixed(3),
      d.oos_n,
      d.oos_degradation_pct.toFixed(1),
      d.split_date,
      d.wf_windows,
      d.wf_avg_test_expectancy_R.toFixed(3),
      d.wf_profitable_windows_pct.toFixed(1),
      d.mc_simulations,
      d.mc_median_dd_pct.toFixed(1),
      d.mc_p95_dd_pct.toFixed(1),
      d.mc_p99_dd_pct.toFixed(1),
      d.mc_median_final_R.toFixed(3),
      d.sensitivity_score.toFixed(1),
      d.base_expectancy_R.toFixed(3),
      d.min_trades_pass,
      d.max_mc_p95_dd_pct.toFixed(1),
      d.max_mc_p99_dd_pct.toFixed(1),
      d.max_oos_degradation_pct.toFixed(1),
      d.min_wf_profitable_windows_pct.toFixed(1),
      d.universe_count,
      d.pass_fail_reasons.join(' | '),
    ].join('\t'));
  }

  lines.push('');
  lines.push('Validation criteria by variant:');
  for (const variant of sortedVariants) {
    const report = variant?.report_id ? sweepReportCache.get(variant.report_id) : null;
    if (!report) continue;
    const d = sweepReportDiagnostics(report);
    lines.push(`${sweepVariantLabel(sweep, variant)}:`);
    lines.push(`- Expectancy R > 0: ${d.expectancy_R.toFixed(3)} (${d.expectancy_R > 0 ? 'pass' : 'fail'})`);
    lines.push(`- Total Trades >= ${d.min_trades_pass}: ${d.trades} (${d.trades >= d.min_trades_pass ? 'pass' : 'fail'})`);
    lines.push(`- OOS Expectancy > 0: ${d.oos_expectancy_R.toFixed(3)} (${d.oos_expectancy_R > 0 ? 'pass' : 'fail'})`);
    lines.push(`- OOS Degradation < ${d.max_oos_degradation_pct.toFixed(1)}%: ${d.oos_degradation_pct.toFixed(1)}% (${d.oos_degradation_pct < d.max_oos_degradation_pct ? 'pass' : 'fail'})`);
    lines.push(`- WF Profitable Windows >= ${d.min_wf_profitable_windows_pct.toFixed(1)}%: ${d.wf_profitable_windows_pct.toFixed(1)}% (${d.wf_profitable_windows_pct >= d.min_wf_profitable_windows_pct ? 'pass' : 'fail'})`);
    lines.push(`- Monte Carlo p95 DD < ${d.max_mc_p95_dd_pct.toFixed(1)}%: ${d.mc_p95_dd_pct.toFixed(1)}% (${d.mc_p95_dd_pct < d.max_mc_p95_dd_pct ? 'pass' : 'fail'})`);
    lines.push(`- Monte Carlo p99 DD <= ${d.max_mc_p99_dd_pct.toFixed(1)}%: ${d.mc_p99_dd_pct.toFixed(1)}% (${d.mc_p99_dd_pct <= d.max_mc_p99_dd_pct ? 'pass' : 'fail'})`);
    lines.push(`- Sensitivity Score < 40: ${d.sensitivity_score.toFixed(1)} (${d.sensitivity_score < 40 ? 'pass' : 'fail'})`);
    if (d.pass_fail_reasons.length) lines.push(`- Reasons: ${d.pass_fail_reasons.join(' | ')}`);
  }

  const firstReport = sortedVariants.map(v => v?.report_id ? sweepReportCache.get(v.report_id) : null).find(Boolean);
  const firstDiagnostics = firstReport ? sweepReportDiagnostics(firstReport) : null;
  if (firstDiagnostics?.universe?.length) {
    lines.push('');
    lines.push(`Symbols tested (${firstDiagnostics.universe_count}):`);
    lines.push(firstDiagnostics.universe.join(', '));
  }

  return lines.join('\n');
}

function setSweepActivityIndicator(sweep) {
  const chip = document.getElementById('sweep-activity-chip');
  const label = document.getElementById('sweep-activity-label');
  if (!chip || !label) return;

  chip.classList.remove('active', 'running', 'complete', 'stalled', 'cancelled');

  if (!sweep || !Array.isArray(sweep.variants) || sweep.variants.length === 0) {
    label.textContent = 'Idle';
    return;
  }

  const status = String(sweep.status || '').toLowerCase();
  const variants = sweep.variants || [];
  const total = variants.length;
  const completed = variants.filter(v => String(v?.status || '').toLowerCase() === 'completed').length;
  const failed = variants.filter(v => String(v?.status || '').toLowerCase() === 'failed').length;
  const running = variants.find(v => String(v?.status || '').toLowerCase() === 'running');
  const pending = variants.filter(v => String(v?.status || '').toLowerCase() === 'pending').length;

  chip.classList.add('active');

  if (status === 'running' && running) {
    const runningJobId = String(running?.job_id || '').trim();
    if (runningJobId && activeValidatorJobIds instanceof Set && !activeValidatorJobIds.has(runningJobId)) {
      chip.classList.add('stalled');
      label.textContent = `No active worker · ${completed}/${total} complete · ${failed} failed · ${pending} pending`;
      return;
    }
    const variantLabel = sweepVariantLabel(sweep, running);
    chip.classList.add('running');
    label.textContent = `Searching entries: ${variantLabel} · ${completed}/${total} complete`;
    return;
  }

  if (status === 'running') {
    chip.classList.add('stalled');
    label.textContent = `No active worker · ${completed}/${total} complete · ${failed} failed · ${pending} pending`;
    return;
  }

  if (status === 'completed') {
    chip.classList.add('complete');
    label.textContent = `Complete · ${completed}/${total} variants`;
    return;
  }

  if (status === 'cancelled') {
    chip.classList.add('cancelled');
    label.textContent = `Cancelled · ${completed}/${total} complete`;
    return;
  }

  label.textContent = `${status || 'Idle'} · ${completed}/${total} complete`;
}

function renderSweepResults(sweep) {
  const currentVariantIds = new Set((sweep.variants || []).map(variant => variant.variant_id));
  for (const variantId of [...selectedComparisonVariantIds]) {
    if (!currentVariantIds.has(variantId)) {
      selectedComparisonVariantIds.delete(variantId);
    }
  }

  document.getElementById('results-sweep-id').textContent = sweep.sweep_id;
  setSweepActivityIndicator(sweep);

  const completed = sweep.variants.filter(v => v.status === 'completed').length;
  const total = sweep.variants.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const progressLabel = sweep.status === 'completed'
    ? `All ${total} variants complete`
    : `${completed} / ${total} variants complete`;

  let html = '';
  window.__sweepCopyText = buildSweepFullCopyText(sweep, [...sweep.variants]);
  const copySweepButtonHtml = `
    <button id="copy-sweep-btn" style="font-size:var(--text-caption);padding:var(--space-6) var(--space-14);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);color:var(--color-text-subtle);cursor:pointer;font-weight:600;white-space:nowrap;">
      Copy Full Report
    </button>
  `;

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
        <div style="display:flex;align-items:center;gap:var(--space-8);">
          ${copySweepButtonHtml}
          <button id="cancel-sweep-btn" onclick="cancelSweep('${sweep.sweep_id}')"
            style="padding:var(--space-6) var(--space-14);border:1px solid var(--color-negative);border-radius:var(--radius-sm);background:transparent;color:var(--color-negative);cursor:pointer;font-size:var(--text-caption);font-weight:600;white-space:nowrap;">
            Cancel Sweep
          </button>
        </div>
      </div>
    `;
  } else if (sweep.status === 'cancelled') {
    html += `
      <div style="padding:var(--space-8);display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);">
        <span style="font-size:var(--text-caption);color:var(--color-text-subtle);">${progressLabel} — Cancelled</span>
        ${copySweepButtonHtml}
      </div>
    `;
  } else {
    html += `
      <div style="padding:var(--space-8);display:flex;align-items:center;justify-content:flex-end;">
        ${copySweepButtonHtml}
      </div>
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
            <th>OOS Exp</th>
            <th>WF %</th>
            <th>MC p95</th>
            <th>MC p99</th>
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
    const report = v.report_id ? sweepReportCache.get(v.report_id) : null;
    const reportDiag = report ? sweepReportDiagnostics(report) : null;
    const val = m?.valuation || null;
    const verdict = getDisplayVerdict(m || {});
    const actionHtml = v.status === 'completed'
      ? `<div class="sweep-action-group">
          <button class="sweep-inline-btn" onclick="viewSweepReport('${v.report_id || ''}','${v.variant_id}')">Report</button>
          <button class="sweep-inline-btn" onclick="promoteWinner('${sweep.sweep_id}','${v.variant_id}')">Promote Candidate</button>
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
        <td><span class="verdict-badge ${verdict}">${verdict.replace(/_/g, ' ')}</span></td>
        <td>${m ? m.total_trades : '—'}</td>
        <td style="color:${m && m.expectancy_R > 0 ? 'var(--color-positive)' : m && m.expectancy_R < 0 ? 'var(--color-negative)' : 'inherit'}">${m ? fmt(m.expectancy_R) + 'R' : '—'}</td>
        <td>${m ? fmtPct(m.win_rate * 100) : '—'}</td>
        <td>${m ? fmt(m.profit_factor) : '—'}</td>
        <td style="color:${m && m.max_drawdown_pct > 30 ? 'var(--color-negative)' : 'inherit'}">${m ? fmtPct(m.max_drawdown_pct) : '—'}</td>
        <td style="color:${reportDiag && reportDiag.oos_expectancy_R > 0 ? 'var(--color-positive)' : reportDiag ? 'var(--color-negative)' : 'inherit'}">${reportDiag ? fmt(reportDiag.oos_expectancy_R) + 'R' : '—'}</td>
        <td style="color:${reportDiag && reportDiag.wf_profitable_windows_pct >= reportDiag.min_wf_profitable_windows_pct ? 'var(--color-positive)' : reportDiag ? 'var(--color-negative)' : 'inherit'}">${reportDiag ? fmtPct(reportDiag.wf_profitable_windows_pct) : '—'}</td>
        <td style="color:${reportDiag && reportDiag.mc_p95_dd_pct < reportDiag.max_mc_p95_dd_pct ? 'var(--color-positive)' : reportDiag ? 'var(--color-negative)' : 'inherit'}">${reportDiag ? fmtPct(reportDiag.mc_p95_dd_pct) : '—'}</td>
        <td style="color:${reportDiag && reportDiag.mc_p99_dd_pct <= reportDiag.max_mc_p99_dd_pct ? 'var(--color-positive)' : reportDiag ? 'var(--color-negative)' : 'inherit'}">${reportDiag ? fmtPct(reportDiag.mc_p99_dd_pct) : '—'}</td>
        <td>${m ? fmt(m.sharpe_ratio) : '—'}</td>
        <td style="font-weight:600; color:${m && m.fitness_score > 0.5 ? 'var(--color-positive)' : 'inherit'}">${m ? fmt(m.fitness_score, 3) : '—'}</td>
        ${valuationCells}
        <td>${actionHtml}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';

  window.__sweepCopyText = buildSweepFullCopyText(sweep, sorted);

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
        setTimeout(() => btn.textContent = 'Copy Full Report', 1500);
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
    showToast(`Candidate promoted: ${newId}`, 'success');

    // Switch dropdown to promoted strategy but keep session cards from the previous strategy visible
    const previousStrategyId = getConfiguredStrategyVersionId();
    await loadStrategyCatalog();
    await switchToStrategy(newId, { skipLoadSweeps: true });
    await _loadRecentSweepsImpl(previousStrategyId);

    // Show banner with link to open in validator (no forced redirect)
    const bannerEl = document.getElementById('sweep-promote-banner');
    if (bannerEl) {
      bannerEl.innerHTML = `<span>Winner promoted as <strong>${reportEscHtml(newId)}</strong> - optimized candidate, not validated yet.</span>
        <a class="sweep-inline-btn" href="/validator.html?strategy_version_id=${encodeURIComponent(newId)}" target="_blank" style="margin-left:12px;">Validate Candidate</a>`;
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
        if (!currentStrategyId) return true;
        const baseMatch = String(s?.base_strategy_version_id || '').trim() === currentStrategyId;
        const promotedMatch = String(s?.promoted_strategy_version_id || '').trim() === currentStrategyId;
        return baseMatch || promotedMatch;
      })
      .slice(0, 50);

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
      const sessionKey = String(sweep?.session_id || '').trim()
        || `${displayStrategyId || 'legacy'}:${String(sweep?.created_at || '').slice(0, 10)}`;
      const groupKey = sessionKey;
      if (!groupedSweepMap.has(groupKey)) {
        const group = {
          key: groupKey,
          sessionId: String(sweep?.session_id || '').trim(),
          startedAt: sweep?.session_started_at || sweep?.created_at || '',
          note: String(sweep?.session_note || '').trim(),
          strategyId: displayStrategyId,
          name: displayGroupName,
          rawName: rawGroupName,
          sweeps: [],
        };
        groupedSweepMap.set(groupKey, group);
        groupedSweeps.push(group);
      }
      if (!groupedSweepMap.get(groupKey).note && sweep?.session_note) {
        groupedSweepMap.get(groupKey).note = String(sweep.session_note || '').trim();
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
      const tierLabel_ = sweepScopeLabel(sweep) || '—';
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
      const sessionDate = group.startedAt ? new Date(group.startedAt).toLocaleString() : '';
      const firstSweepId = orderedSteps[0]?.sweep_id || '';
      return `
        <div
          style="padding:12px;border:1px solid ${hasActiveStep ? 'var(--color-accent)' : 'var(--color-border)'};border-radius:var(--radius-md);background:var(--color-bg-subtle);margin-bottom:12px;"
        >
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-8);margin-bottom:4px;">
            <div class="sweep-name" style="flex:1;" title="${reportEscHtml(group.rawName)}">${reportEscHtml(group.name)}</div>
            <div class="sweep-meta" style="font-size:11px;font-family:var(--font-mono);">${orderedSteps.length} ${orderedSteps.length === 1 ? 'sweep' : 'sweeps'}</div>
          </div>
          <div class="sweep-meta" style="color:var(--color-text-subtle);margin-bottom:6px;">
            ${reportEscHtml(group.note || 'No session note')}${sessionDate ? ` · ${reportEscHtml(sessionDate)}` : ''}
          </div>
          ${firstSweepId ? `<button class="sweep-inline-btn" type="button" onclick="loadSweepSession('${firstSweepId}')" style="margin-bottom:8px;">Reload Session</button>` : ''}
          ${orderedSteps.map(buildSweepStepCard).join('')}
        </div>
      `;
    }).join('');
  } catch {}
}

async function loadSweep(sweepId) {
  return loadSweepInternal(sweepId, { persist: true });
}

async function loadSweepSession(firstSweepId) {
  const ok = await loadSweepInternal(firstSweepId, { persist: true });
  if (!ok) return false;
  const sweep = activeSweepId ? (await fetch(`${API}/sweep/${encodeURIComponent(activeSweepId)}`).then(r => r.json()).catch(() => null)) : null;
  const data = sweep?.success ? sweep.data : null;
  if (data?.session_id) {
    activeSweepSessionId = String(data.session_id || '').trim();
    sessionStartedAt = data.session_started_at || data.created_at || sessionStartedAt || new Date().toISOString();
    activeSweepSessionNote = String(data.session_note || '').trim();
    window.localStorage.setItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY, activeSweepSessionId);
    window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
    window.localStorage.setItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY, activeSweepSessionNote);
    updateSessionNoteInput();
  }
  return true;
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
      if (data.data?.session_id) {
        activeSweepSessionId = String(data.data.session_id || '').trim();
        sessionStartedAt = data.data.session_started_at || data.data.created_at || sessionStartedAt || new Date().toISOString();
        activeSweepSessionNote = String(data.data.session_note || '').trim();
        window.localStorage.setItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY, activeSweepSessionId);
        window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
        window.localStorage.setItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY, activeSweepSessionNote);
        updateSessionNoteInput();
      }
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
  activeSweepSessionId = makeSweepSessionId(sessionStartedAt);
  activeSweepSessionNote = (window.prompt('Brief description for this sweep session:', '') || '').trim().slice(0, 240);
  window.localStorage.setItem(SESSION_START_STORAGE_KEY, sessionStartedAt);
  window.localStorage.setItem(ACTIVE_SWEEP_SESSION_ID_STORAGE_KEY, activeSweepSessionId);
  window.localStorage.setItem(ACTIVE_SWEEP_SESSION_NOTE_STORAGE_KEY, activeSweepSessionNote);
  updateSessionNoteInput();

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
  fetchSweepSummaries(true)
    .then(() => loadRecentSweepsForStrategy(''))
    .catch(() => {});

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
  setSweepActivityIndicator(null);

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
