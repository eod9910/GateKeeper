let blocklyWorkspace = null;
let blocklyPrimitiveRows = [];
let blocklyChatMessages = [];
let blocklyValidationPassed = false;
let blocklyValidationHash = '';
let isRestoringBlocklyWorkspace = false;
let blocklyFundamentalEditor = null;
let blocklyDraftSaveTimer = null;
let blocklyStateMachineState = {
  enabled: false,
  armPrimitive: '',
  watchPrimitive: '',
  invalidatePrimitive: '',
  watchBars: 5,
  emitOnArmed: true,
  emitOnWatching: true,
};
const BLOCKLY_COMPOSER_EXPORT_KEY = 'blockly-composer-export';
const BLOCKLY_COMPOSER_DRAFT_KEY = 'blockly-composer-draft-v1';
const FUNDAMENTAL_FILTER_PRIMITIVE_ID = 'fundamental_quality_filter_primitive';
const BLOCKLY_INSPECTOR_STORAGE_KEY = 'blockly-composer-inspector-v1';

function readBlocklyInspectorState() {
  try {
    const raw = JSON.parse(localStorage.getItem(BLOCKLY_INSPECTOR_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { open: false, active: 'state' };
    return {
      open: raw.open === true,
      active: raw.active === 'pit' ? 'pit' : 'state',
    };
  } catch {
    return { open: false, active: 'state' };
  }
}

function writeBlocklyInspectorState(nextState) {
  try {
    localStorage.setItem(BLOCKLY_INSPECTOR_STORAGE_KEY, JSON.stringify({
      open: nextState?.open === true,
      active: nextState?.active === 'pit' ? 'pit' : 'state',
    }));
  } catch {}
}

function getBlocklyInspectorElements() {
  return {
    shell: document.getElementById('blockly-inspector'),
    title: document.getElementById('blockly-inspector-title'),
    subtitle: document.getElementById('blockly-inspector-subtitle'),
    paneState: document.getElementById('blockly-inspector-pane-state'),
    panePit: document.getElementById('blockly-inspector-pane-pit'),
    tabState: document.getElementById('btn-blockly-inspector-tab-state'),
    tabPit: document.getElementById('btn-blockly-inspector-tab-pit'),
    triggerState: document.getElementById('btn-blockly-open-state'),
    triggerPit: document.getElementById('btn-blockly-open-pit'),
  };
}

function setBlocklyInspectorState(nextState) {
  const state = {
    open: nextState?.open === true,
    active: nextState?.active === 'pit' ? 'pit' : 'state',
  };
  const els = getBlocklyInspectorElements();
  if (!els.shell) return;
  els.shell.classList.toggle('is-open', state.open);
  if (els.paneState) els.paneState.classList.toggle('active', state.active === 'state');
  if (els.panePit) els.panePit.classList.toggle('active', state.active === 'pit');
  if (els.tabState) els.tabState.classList.toggle('active', state.active === 'state');
  if (els.tabPit) els.tabPit.classList.toggle('active', state.active === 'pit');
  if (els.triggerState) els.triggerState.classList.toggle('is-active', state.open && state.active === 'state');
  if (els.triggerPit) els.triggerPit.classList.toggle('is-active', state.open && state.active === 'pit');
  if (els.title) els.title.textContent = state.active === 'pit' ? 'PIT Layer' : 'State Logic';
  if (els.subtitle) {
    els.subtitle.textContent = state.active === 'pit'
      ? 'Point-in-time validation filters and rebalance settings'
      : 'Stateful trigger timing and watch-window behavior';
  }
  writeBlocklyInspectorState(state);
}

function openBlocklyInspector(active) {
  const current = readBlocklyInspectorState();
  setBlocklyInspectorState({ open: true, active: active || current.active || 'state' });
}

function closeBlocklyInspector() {
  const current = readBlocklyInspectorState();
  setBlocklyInspectorState({ open: false, active: current.active || 'state' });
}

function toggleBlocklyInspector(active) {
  const current = readBlocklyInspectorState();
  const nextActive = active || current.active || 'state';
  const shouldOpen = !(current.open && current.active === nextActive);
  setBlocklyInspectorState({ open: shouldOpen, active: nextActive });
}

function summarizeBlocklyPit() {
  const summaryEl = document.getElementById('blockly-pit-summary');
  const triggerEl = document.getElementById('btn-blockly-open-pit');
  if (!summaryEl || !triggerEl) return;
  const config = blocklyFundamentalEditor?.getValue?.() || null;
  const issues = blocklyFundamentalEditor?.getIssues?.() || [];
  let summary = 'inactive';
  if (config && Array.isArray(config.variables) && config.variables.length) {
    const cadence = config.rebalance_frequency === 'quarterly' ? 'quarterly' : 'monthly';
    summary = `${config.variables.length} vars, ${cadence}`;
  }
  summaryEl.textContent = summary;
  triggerEl.classList.toggle('is-warning', Array.isArray(issues) && issues.length > 0);
}

function summarizePrimitiveLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unset';
  const compact = raw.replace(/_primitive$/i, '').replace(/_composite$/i, '').replace(/_/g, ' ');
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
}

function summarizeBlocklyStateLogic() {
  const summaryEl = document.getElementById('blockly-state-summary');
  const triggerEl = document.getElementById('btn-blockly-open-state');
  if (!summaryEl || !triggerEl) return;
  syncBlocklyStateMachineFromDom();
  let summary = 'inactive';
  if (blocklyStateMachineState.enabled) {
    const arm = summarizePrimitiveLabel(blocklyStateMachineState.armPrimitive);
    summary = `${arm}, ${blocklyStateMachineState.watchBars} bars`;
  }
  const availablePrimitives = new Set(listBlocklyPrimitiveOptions().map((row) => row.pattern_id));
  const hasWarning = blocklyStateMachineState.enabled && (
    !blocklyStateMachineState.armPrimitive
    || !availablePrimitives.has(blocklyStateMachineState.armPrimitive)
    || (!blocklyStateMachineState.emitOnArmed && !blocklyStateMachineState.emitOnWatching)
  );
  summaryEl.textContent = summary;
  triggerEl.classList.toggle('is-warning', hasWarning);
}

function updateBlocklyInspectorSummaries() {
  summarizeBlocklyPit();
  summarizeBlocklyStateLogic();
}

function getBlocklyStateMachineCollapseKey() {
  const page = typeof window !== 'undefined' && window.location ? window.location.pathname : 'unknown';
  return `blockly-state-machine:${page}:open`;
}

function readBlocklyStateMachineCollapseState() {
  try {
    const raw = localStorage.getItem(getBlocklyStateMachineCollapseKey());
    if (raw == null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

function writeBlocklyStateMachineCollapseState(isOpen) {
  try {
    localStorage.setItem(getBlocklyStateMachineCollapseKey(), isOpen ? 'true' : 'false');
  } catch {}
}
const BLOCKLY_TYPE_MAP = {
  anchor_structure: 'STRUCTURE_RESULT',
  location: 'LOCATION_RESULT',
  location_filter: 'LOCATION_RESULT',
  timing_trigger: 'TRIGGER_RESULT',
  trigger: 'TRIGGER_RESULT',
  context: 'PATTERN_RESULT',
  state_filter: 'PATTERN_RESULT',
  regime_state: 'PATTERN_RESULT',
  pattern_gate: 'PATTERN_RESULT',
};
const BLOCKLY_COLOR_MAP = {
  STRUCTURE_RESULT: 210,
  LOCATION_RESULT: 120,
  TRIGGER_RESULT: 20,
  PATTERN_RESULT: 285,
};

document.addEventListener('DOMContentLoaded', async () => {
  bindMetaFields();
  registerComposeBlock();
  registerCheckVerdictBlock();
  registerComposeConditionalBlock();
  registerScoreThresholdBlock();
  registerTimeFilterBlock();
  registerCooldownGateBlock();
  registerComparePrimitivesBlock();
  registerSequenceBlock();
  registerRegimeGateBlock();
  registerLiquidityFilterBlock();
  registerStateMachineBlock();
  await Promise.all([loadPrimitiveLibrary(), loadKnownFamilies()]);
  initializeBlocklyWorkspace();
  wireActions();
  renderPrimitiveInventory();
  updateCompositionPreview();
  initializeBlocklyChat();
  initFamilyPickerModal();
  initFormulaPickerModal();
  loadSrFormulas(false);
  injectFamilyPickerButton();
  initializeBlocklyFundamentalEditor();
  renderBlocklyStateMachinePanel();
  setBlocklyInspectorState(readBlocklyInspectorState());
  updateBlocklyInspectorSummaries();
  await maybeLoadBlocklyDefinitionFromQuery();
  maybeRestoreBlocklyDraft();
  updateBlocklyInspectorSummaries();
});

function bindMetaFields() {
  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const categoryInput = document.getElementById('blockly-category');
  const intentSelect = document.getElementById('blockly-intent');

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      const currentId = String(idInput?.value || '').trim();
      if (!currentId || currentId === toPatternId(currentId)) {
        if (idInput) idInput.value = `${toPatternId(nameInput.value || 'new_composite')}_composite`;
      }
      updateCompositionPreview();
    });
  }
  if (idInput) idInput.addEventListener('input', updateCompositionPreview);
  if (categoryInput) categoryInput.addEventListener('input', updateCompositionPreview);
  if (intentSelect) intentSelect.addEventListener('change', updateCompositionPreview);
}

function setBlocklyStatus(text, isError = false) {
  const el = document.getElementById('blockly-composition-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#ef7f7f' : '';
}

function toPatternId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'new_composite';
}

function registerComposeBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.compose_indicator = {
    init() {
      this.appendDummyInput()
        .appendField('Compose Indicator')
        .appendField(new Blockly.FieldDropdown([['AND', 'AND'], ['OR', 'OR'], ['N-of-M', 'N_OF_M']]), 'REDUCER_OP')
        .appendField('N')
        .appendField(new Blockly.FieldNumber(2, 1, 10, 1), 'REDUCER_N');

      this.appendValueInput('STRUCTURE')
        .setCheck('STRUCTURE_RESULT')
        .appendField('Structure');
      this.appendValueInput('LOCATION')
        .setCheck('LOCATION_RESULT')
        .appendField('Location');
      this.appendValueInput('TIMING')
        .setCheck('TRIGGER_RESULT')
        .appendField('Timing Trigger');
      this.appendValueInput('PATTERN')
        .setCheck('PATTERN_RESULT')
        .appendField('Regime Filter (Optional)');
      this.appendValueInput('STATE_MACHINE')
        .setCheck('STATE_MACHINE_RESULT')
        .appendField('State Logic (Optional)');

      this.setColour(245);
      this.setTooltip('Compose one indicator from Structure + Location + Timing (+ optional Regime Filter).');
      this.setHelpUrl('');
    },
  };
}

// ---------------------------------------------------------------------------
// Check Verdict block — wraps any primitive, checks its verdict + confidence
// Output type: BOOLEAN (feeds into compose_conditional or logic_operation)
// ---------------------------------------------------------------------------
function registerCheckVerdictBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.check_verdict = {
    init() {
      this.appendDummyInput().appendField('CHECK VERDICT');
      this.appendValueInput('PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('IF');
      this.appendDummyInput()
        .appendField('verdict =')
        .appendField(new Blockly.FieldDropdown([
          ['ANY (fired)', 'ANY'],
          ['SWING_HIGH', 'SWING_HIGH'],
          ['SWING_LOW', 'SWING_LOW'],
          ['BULLISH', 'BULLISH'],
          ['BEARISH', 'BEARISH'],
          ['EXHAUSTED', 'EXHAUSTED'],
          ['WANING', 'WANING'],
          ['RECOVERING', 'RECOVERING'],
          ['STRONG', 'STRONG'],
          ['BUILDING', 'BUILDING'],
        ]), 'VERDICT')
        .appendField('  confidence ≥')
        .appendField(new Blockly.FieldNumber(70, 0, 100, 1), 'CONFIDENCE_MIN');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('Check if a primitive fired a specific verdict with minimum confidence. Returns true/false — wire into a Compose Conditional block.');
    },
  };
}

// ---------------------------------------------------------------------------
// Compose Conditional block — IF condition THEN primitive ELSE primitive
// Top-level block (like compose_indicator) for conditional compositions.
// ---------------------------------------------------------------------------
function registerComposeConditionalBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.compose_conditional = {
    init() {
      this.appendDummyInput().appendField('COMPOSE CONDITIONAL');
      this.appendValueInput('CONDITION')
        .setCheck('Boolean')
        .appendField('IF');
      this.appendValueInput('THEN_STAGE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('THEN run');
      this.appendValueInput('ELSE_STAGE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('ELSE run  (optional)');
      this.appendValueInput('STATE_MACHINE')
        .setCheck('STATE_MACHINE_RESULT')
        .appendField('State Logic (Optional)');
      this.setColour(245);
      this.setTooltip('If the condition is true, run the THEN primitive. Otherwise run the ELSE primitive (optional). Use Check Verdict blocks to build conditions.');
    },
  };
}

// ---------------------------------------------------------------------------
// Score Threshold — did this primitive score above X? → BOOLEAN
// ---------------------------------------------------------------------------
function registerScoreThresholdBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.score_threshold = {
    init() {
      this.appendDummyInput().appendField('SCORE THRESHOLD');
      this.appendValueInput('PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Score of');
      this.appendDummyInput()
        .appendField('≥')
        .appendField(new Blockly.FieldNumber(0.7, 0, 1, 0.05), 'THRESHOLD')
        .appendField('(0–1)');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('True if the primitive\'s confidence score meets or exceeds the threshold (0.0–1.0). Use instead of Check Verdict when you only care how confident the signal is, not what it said.');
    },
  };
}

// ---------------------------------------------------------------------------
// Time Filter — session / day-of-week gate → BOOLEAN
// ---------------------------------------------------------------------------
function registerTimeFilterBlock() {
  Blockly.Blocks.time_filter = {
    init() {
      this.appendDummyInput().appendField('TIME FILTER');
      this.appendDummyInput()
        .appendField('Time is')
        .appendField(new Blockly.FieldDropdown([
          ['Any time', 'ANY'],
          ['Market open  (9:30–11:00 ET)', 'OPEN'],
          ['Midday  (11:00–14:00 ET)', 'MIDDAY'],
          ['Power hour  (14:00–16:00 ET)', 'POWER'],
          ['Pre-market  (04:00–09:30 ET)', 'PREMARKET'],
          ['After-hours  (16:00–20:00 ET)', 'AFTERHOURS'],
          ['Monday', 'MON'],
          ['Tuesday', 'TUE'],
          ['Wednesday', 'WED'],
          ['Thursday', 'THU'],
          ['Friday', 'FRI'],
          ['Mon–Wed  (early week)', 'EARLYWEEK'],
          ['Thu–Fri  (late week)', 'LATEWEEK'],
        ]), 'SESSION');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('True only if the current bar falls within the selected trading session or day of the week. Useful for session-specific setups.');
    },
  };
}

// ---------------------------------------------------------------------------
// Cooldown Gate — suppress re-fire within N bars → BOOLEAN
// ---------------------------------------------------------------------------
function registerCooldownGateBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.cooldown_gate = {
    init() {
      this.appendDummyInput().appendField('COOLDOWN GATE');
      this.appendValueInput('PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Primitive');
      this.appendDummyInput()
        .appendField('has NOT fired in the last')
        .appendField(new Blockly.FieldNumber(5, 1, 500, 1), 'BARS')
        .appendField('bars');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('True only if this primitive has NOT produced a signal within the last N bars. Prevents stacking duplicate entries on the same move.');
    },
  };
}

// ---------------------------------------------------------------------------
// Compare Two Primitives — A score > B score → BOOLEAN
// ---------------------------------------------------------------------------
function registerComparePrimitivesBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.compare_primitives = {
    init() {
      this.appendDummyInput().appendField('COMPARE PRIMITIVES');
      this.appendValueInput('PRIMITIVE_A')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Score of');
      this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown([
          ['> (stronger than)', 'GT'],
          ['< (weaker than)', 'LT'],
          ['≥ (at least as strong as)', 'GTE'],
          ['≤ (at most as strong as)', 'LTE'],
        ]), 'OP');
      this.appendValueInput('PRIMITIVE_B')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('score of');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('Compares the confidence scores of two primitives. Use to pick the stronger signal when two indicators compete.');
    },
  };
}

// ---------------------------------------------------------------------------
// Sequence — A fired within N bars THEN B fires now → BOOLEAN
// ---------------------------------------------------------------------------
function registerSequenceBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.sequence_check = {
    init() {
      this.appendDummyInput().appendField('SEQUENCE');
      this.appendValueInput('FIRST')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('First:');
      this.appendDummyInput()
        .appendField('fired within')
        .appendField(new Blockly.FieldNumber(5, 1, 200, 1), 'LOOKBACK')
        .appendField('bars ago,  THEN now:');
      this.appendValueInput('SECOND')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Second:');
      this.appendDummyInput()
        .appendField('fires now');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('True only if the FIRST primitive fired within the lookback window AND the SECOND primitive fires on the current bar. Order matters — use for sequential setups like exhaustion then reversal confirmation.');
    },
  };
}

// ---------------------------------------------------------------------------
// Regime Gate — top-level wrapper: only fire in matching market regime
// ---------------------------------------------------------------------------
function registerRegimeGateBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.regime_gate = {
    init() {
      this.appendDummyInput().appendField('REGIME GATE');
      this.appendValueInput('REGIME')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Regime:');
      this.appendDummyInput()
        .appendField('must be')
        .appendField(new Blockly.FieldDropdown([
          ['ANY (pass through)', 'ANY'],
          ['TRENDING', 'TRENDING'],
          ['RANGING', 'RANGING'],
          ['VOLATILE', 'VOLATILE'],
          ['QUIET', 'QUIET'],
          ['BULLISH', 'BULLISH'],
          ['BEARISH', 'BEARISH'],
        ]), 'REGIME_STATE');
      this.appendValueInput('SIGNAL')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Signal:');
      this.setOutput(true, 'Boolean');
      this.setColour('#c87800');
      this.setTooltip('Runs the Signal primitive only if the Regime primitive reports the expected market state. Connect your Regime Filter primitive to REGIME, and your entry signal to SIGNAL.');
    },
  };
}

// ---------------------------------------------------------------------------
// Liquidity / Market Cap Regime Filter — inline block (no external primitive)
// ---------------------------------------------------------------------------
function registerLiquidityFilterBlock() {
  Blockly.Blocks.liquidity_filter = {
    init() {
      this.appendDummyInput().appendField('LIQUIDITY FILTER  (Regime)');
      this.appendDummyInput()
        .appendField('Min Market Cap')
        .appendField(new Blockly.FieldNumber(0, 0, 1000, 0.5), 'MIN_MARKET_CAP_B')
        .appendField('$B  (0 = disabled)');
      this.appendDummyInput()
        .appendField('Min Avg Volume')
        .appendField(new Blockly.FieldNumber(0, 0, 10000, 100), 'MIN_AVG_VOLUME_K')
        .appendField('K shares  (0 = disabled)');
      this.setOutput(true, 'PATTERN_RESULT');
      this.setColour('#8d67c7');
      this.setTooltip(
        'Regime gate: filters out thin-float and low-cap stocks that lack institutional follow-through. ' +
        'Set Min Market Cap to e.g. 2 ($2B+) to exclude micro/small caps. ' +
        'Connect to the Regime Filter slot of your indicator block.'
      );
    },
  };

  Blockly.JavaScript['liquidity_filter'] = function (block) {
    const minCap = block.getFieldValue('MIN_MARKET_CAP_B') || 0;
    const minVol = block.getFieldValue('MIN_AVG_VOLUME_K') || 0;
    const code = JSON.stringify({ type: 'liquidity_filter', min_market_cap_billions: minCap, min_avg_volume_k: minVol });
    return [code, Blockly.JavaScript.ORDER_ATOMIC];
  };
}

// ---------------------------------------------------------------------------
// State Machine — block-based stateful authoring for sequence-dependent setups
// ---------------------------------------------------------------------------
function registerStateMachineBlock() {
  const ANY_PRIMITIVE_TYPES = ['STRUCTURE_RESULT', 'LOCATION_RESULT', 'TRIGGER_RESULT', 'PATTERN_RESULT'];
  Blockly.Blocks.state_machine_flow = {
    init() {
      this.appendDummyInput().appendField('STATE MACHINE');
      this.appendValueInput('ARM_PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Arm on');
      this.appendValueInput('WATCH_PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Advance to watching on');
      this.appendValueInput('INVALIDATE_PRIMITIVE')
        .setCheck(ANY_PRIMITIVE_TYPES)
        .appendField('Invalidate on  (optional)');
      this.appendDummyInput()
        .appendField('Watch bars')
        .appendField(new Blockly.FieldNumber(5, 1, 100, 1), 'WATCH_BARS');
      this.appendDummyInput()
        .appendField('Emit while armed')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'EMIT_ARMED')
        .appendField('  Emit while watching')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'EMIT_WATCHING');
      this.setOutput(true, 'STATE_MACHINE_RESULT');
      this.setColour('#c87800');
      this.setTooltip('Block-based state machine for event-driven strategies. Arm on one primitive, optionally move into a watch window on another, invalidate on a third, and emit only during selected phases.');
    },
  };
}

function getSocketTypeForPrimitive(row) {
  const role = String(row?.canonical_role || row?.indicator_role || '').trim().toLowerCase();
  return BLOCKLY_TYPE_MAP[role] || 'PATTERN_RESULT';
}

function buildParamLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildBlocklyParamFields(row) {
  const tunableParams = row.tunable_params || [];
  if (!tunableParams.length) return [];

  const setupParams = row.default_setup_params || {};

  const fields = [];
  tunableParams.forEach((tp) => {
    const key = tp && tp.key;
    if (!key) return;

    const defaultVal = tp.default !== undefined
      ? tp.default
      : (setupParams[key] !== undefined ? setupParams[key] : undefined);
    if (defaultVal === undefined) return;

    const paramType = String(tp.type || 'float').toLowerCase();
    const label = String(tp.label || buildParamLabel(key));

    fields.push({
      key,
      label,
      paramType,
      defaultVal,
      min: tp.min,
      max: tp.max,
      options: Array.isArray(tp.options) ? tp.options : undefined,
      dynamicEndpoint: tp.dynamic_options_endpoint || undefined,
    });
  });

  return fields;
}

function registerPrimitiveBlock(row) {
  const patternId = String(row?.pattern_id || '').trim();
  if (!patternId) return null;

  const blockType = `primitive_${patternId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  if (Blockly.Blocks[blockType]) return blockType;

  const socketType = getSocketTypeForPrimitive(row);
  const color = BLOCKLY_COLOR_MAP[socketType] || 285;
  const paramFields = buildBlocklyParamFields(row);

  Blockly.Blocks[blockType] = {
    init() {
      const label = String(row.name || patternId);
      const inFlyout = this.isInFlyout;

      if (inFlyout && paramFields.length > 0) {
        this.appendDummyInput()
          .appendField(label)
          .appendField(`  (${paramFields.length} params)`);
      } else {
        this.appendDummyInput()
          .appendField(label);
      }

      this.setOutput(true, socketType);
      this.setColour(color);
      this.setTooltip(`${patternId} • role: ${String(row.canonical_role || row.indicator_role || 'unknown')}`);
      this.setHelpUrl('');

      if (!inFlyout) {
        for (const pf of paramFields) {
          const fieldName = `PARAM_${pf.key}`;
          const input = this.appendDummyInput(fieldName);

          if (pf.paramType === 'bool' || pf.paramType === 'boolean') {
            input
              .appendField(`  ${pf.label}`)
              .appendField(new Blockly.FieldDropdown([['Yes', 'true'], ['No', 'false']]), fieldName);
            if (pf.defaultVal === false || pf.defaultVal === 'false') {
              this.getField(fieldName)?.setValue('false');
            }
          } else if (pf.paramType === 'enum' && Array.isArray(pf.options) && pf.options.length) {
            const dropdownOpts = pf.options.map((opt) => [String(opt), String(opt)]);
            input
              .appendField(`  ${pf.label}`)
              .appendField(new Blockly.FieldDropdown(dropdownOpts), fieldName);
            this.getField(fieldName)?.setValue(String(pf.defaultVal || pf.options[0]));
          } else if (pf.paramType === 'string' && pf.dynamicEndpoint) {
            const strVal = String(pf.defaultVal || '');
            const hiddenField = new Blockly.FieldTextInput(strVal);
            hiddenField.setVisible(false);
            input.appendField(hiddenField, fieldName);
            const displayLabel = new Blockly.FieldLabel(strVal ? getFormulaDisplayLabel(strVal) : '(none — pick formula)');
            input.appendField(`  ${pf.label}`).appendField(displayLabel, `${fieldName}_DISPLAY`);
            const pickBtnField = new Blockly.FieldImage(
              'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="16" viewBox="0 0 20 16"><rect width="20" height="16" rx="3" fill="%234f46e5"/><text x="10" y="12" text-anchor="middle" fill="white" font-size="10" font-family="sans-serif">Pick</text></svg>'),
              20, 16, 'Pick formula',
            );
            input.appendField(pickBtnField);
            const blockRef = this;
            const displayRef = displayLabel;
            pickBtnField.setOnClickHandler(function () {
              var currentVal = blockRef.getField(fieldName)?.getValue() || '';
              loadSrFormulas(false);
              openFormulaPicker(currentVal, function (selectedId) {
                var field = blockRef.getField(fieldName);
                if (field) field.setValue(selectedId || '');
                displayRef.setValue(selectedId ? getFormulaDisplayLabel(selectedId) : '(none — pick formula)');
              });
            });
          } else if (pf.paramType === 'string') {
            const strVal = String(pf.defaultVal || '');
            const knownOptions = getKnownStringOptions(pf.key);
            if (knownOptions.length) {
              input
                .appendField(`  ${pf.label}`)
                .appendField(new Blockly.FieldDropdown(knownOptions), fieldName);
              this.getField(fieldName)?.setValue(strVal);
            } else {
              input
                .appendField(`  ${pf.label}`)
                .appendField(new Blockly.FieldTextInput(strVal), fieldName);
            }
          } else {
            const numVal = Number(pf.defaultVal) || 0;
            const minVal = pf.min !== undefined ? Number(pf.min) : -Infinity;
            const maxVal = pf.max !== undefined ? Number(pf.max) : Infinity;
            const precision = pf.paramType === 'int' || pf.paramType === 'number' && Number.isInteger(numVal) ? 1 : 0.01;
            input
              .appendField(`  ${pf.label}`)
              .appendField(new Blockly.FieldNumber(numVal, minVal, maxVal, precision), fieldName);
          }
        }
      }

      this.data = JSON.stringify({
        pattern_id: patternId,
        indicator_role: String(row.canonical_role || row.indicator_role || '').trim(),
        param_keys: paramFields.map((pf) => pf.key),
      });

    },
  };

  return blockType;
}

// Populated async from /api/research/families on load
let _knownFamilyRows = [];

async function loadKnownFamilies() {
  try {
    const res = await fetch('/api/research/families');
    const payload = await res.json();
    if (!res.ok || !payload?.success || !Array.isArray(payload?.data)) return;
    _knownFamilyRows = payload.data;
  } catch (_) {}
}

function getKnownStringOptions(key) {
  const optionMap = {
    ma_type: [['SMA', 'sma'], ['EMA', 'ema'], ['WMA', 'wma'], ['DEMA', 'dema'], ['TEMA', 'tema']],
    cross_direction: [['Bullish', 'bullish'], ['Bearish', 'bearish']],
    swing_method: [['RDP', 'rdp'], ['Major', 'major']],
  };
  return optionMap[key] || [];
}

// ── SR Formula picker modal ────────────────────────────────────────────────────
var _formulaPickerCache = null;
var _formulaPickerCallback = null;
var _formulaPickerSelected = '';
var _formulaPickerRankingJobId = null;

function loadSrFormulas(force) {
  if (_formulaPickerCache && !force) return Promise.resolve(_formulaPickerCache);
  return fetch('/api/research/sr-formulas')
    .then(function (res) { return res.json(); })
    .then(function (payload) {
      if (!payload || !payload.success || !Array.isArray(payload.data)) return [];
      _formulaPickerCache = payload.data;
      return payload.data;
    })
    .catch(function () { return []; });
}

function openFormulaPicker(currentValue, onConfirm) {
  _formulaPickerCallback = onConfirm;
  _formulaPickerSelected = currentValue || '';
  var overlay = document.getElementById('formulaPickerOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  loadSrFormulas(true).then(function (formulas) {
    renderFormulaPickerTable(formulas);
  });
}

function closeFormulaPicker() {
  var overlay = document.getElementById('formulaPickerOverlay');
  if (overlay) overlay.style.display = 'none';
  _formulaPickerCallback = null;
}

function renderFormulaPickerTable(formulas) {
  var body = document.getElementById('formulaPickerBody');
  if (!body) return;

  var sorted = formulas.slice().sort(function (a, b) {
    var aScore = a.backtest_ranking ? a.backtest_ranking.composite_score : -1;
    var bScore = b.backtest_ranking ? b.backtest_ranking.composite_score : -1;
    if (bScore !== aScore) return bScore - aScore;
    return (b.fitness || 0) - (a.fitness || 0);
  });

  if (!sorted.length) {
    body.innerHTML = '<tr><td colspan="9" style="padding:1.5rem;text-align:center;color:var(--color-text-muted,#888);">No SR formulas found. Run a Symbolic Regression session first.</td></tr>';
    return;
  }

  body.innerHTML = sorted.map(function (f, i) {
    var r = f.backtest_ranking;
    var rank = r ? r.rank : '—';
    var score = r ? r.composite_score.toFixed(3) : '—';
    var exp = r ? r.expectancy_R.toFixed(3) : '—';
    var wr = r ? (r.win_rate * 100).toFixed(1) + '%' : '—';
    var pf = r ? r.profit_factor.toFixed(2) : '—';
    var trades = r ? r.total_trades : '—';
    var passFail = r ? r.pass_fail : '—';
    var cx = f.complexity || '—';
    var readable = (f.formula_readable || f.formula_id || '').slice(0, 55);
    var isActive = f.formula_id === _formulaPickerSelected;
    var passBadge = passFail === 'PASS'
      ? '<span style="color:#22c55e;font-weight:700;">PASS</span>'
      : passFail === 'NEEDS_REVIEW'
        ? '<span style="color:#f59e0b;font-weight:600;">REVIEW</span>'
        : passFail === 'FAIL'
          ? '<span style="color:#ef4444;">FAIL</span>'
          : '<span style="color:var(--color-text-muted,#888);">—</span>';
    return '<tr data-fid="' + f.formula_id + '" style="cursor:pointer;border-bottom:1px solid var(--color-border,#222);'
      + (isActive ? 'background:rgba(79,70,229,.2);' : '') + '">'
      + '<td style="padding:.45rem .6rem;">' + rank + '</td>'
      + '<td style="padding:.45rem .6rem;font-weight:600;">' + score + '</td>'
      + '<td style="padding:.45rem .6rem;">' + exp + '</td>'
      + '<td style="padding:.45rem .6rem;">' + wr + '</td>'
      + '<td style="padding:.45rem .6rem;">' + pf + '</td>'
      + '<td style="padding:.45rem .6rem;">' + trades + '</td>'
      + '<td style="padding:.45rem .6rem;">' + cx + '</td>'
      + '<td style="padding:.45rem .6rem;">' + passBadge + '</td>'
      + '<td style="padding:.45rem .6rem;font-family:monospace;font-size:.72rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (f.formula_readable || '').replace(/"/g, '&quot;') + '">' + readable + '</td>'
      + '</tr>';
  }).join('');

  body.querySelectorAll('tr[data-fid]').forEach(function (row) {
    row.addEventListener('click', function () {
      body.querySelectorAll('tr[data-fid]').forEach(function (r) { r.style.background = ''; });
      row.style.background = 'rgba(79,70,229,.2)';
      _formulaPickerSelected = row.dataset.fid;
    });
  });
}

function triggerFormulaRanking() {
  var btn = document.getElementById('formulaPickerRankBtn');
  var progress = document.getElementById('formulaPickerProgress');
  var progressText = document.getElementById('formulaPickerProgressText');
  var progressBar = document.getElementById('formulaPickerProgressBar');
  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';
  if (progressText) progressText.textContent = 'Starting ranking...';
  if (progressBar) progressBar.style.width = '0%';

  fetch('/api/research/sr-formulas/rank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  })
    .then(function (res) { return res.json(); })
    .then(function (payload) {
      if (!payload || !payload.success || !payload.data?.job_id) {
        if (progressText) progressText.textContent = 'Failed to start ranking: ' + (payload?.error || 'unknown');
        if (btn) btn.disabled = false;
        return;
      }
      _formulaPickerRankingJobId = payload.data.job_id;
      pollFormulaRanking(payload.data.job_id);
    })
    .catch(function (err) {
      if (progressText) progressText.textContent = 'Error: ' + err.message;
      if (btn) btn.disabled = false;
    });
}

function pollFormulaRanking(jobId) {
  var progressText = document.getElementById('formulaPickerProgressText');
  var progressBar = document.getElementById('formulaPickerProgressBar');
  var btn = document.getElementById('formulaPickerRankBtn');

  fetch('/api/research/sr-formulas/rank/' + jobId)
    .then(function (res) { return res.json(); })
    .then(function (payload) {
      if (!payload || !payload.success) return;
      var job = payload.data;
      var pct = job.progress.total > 0 ? Math.round((job.progress.completed / job.progress.total) * 100) : 0;
      if (progressText) progressText.textContent = 'Ranking formula ' + job.progress.completed + '/' + job.progress.total + '...';
      if (progressBar) progressBar.style.width = pct + '%';

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        if (progressText) progressText.textContent = job.status === 'completed'
          ? 'Ranking complete!'
          : 'Ranking ' + job.status;
        if (progressBar) progressBar.style.width = '100%';
        if (btn) btn.disabled = false;
        _formulaPickerRankingJobId = null;
        loadSrFormulas(true).then(function (formulas) {
          renderFormulaPickerTable(formulas);
        });
        setTimeout(function () {
          var progress = document.getElementById('formulaPickerProgress');
          if (progress) progress.style.display = 'none';
        }, 3000);
        return;
      }

      setTimeout(function () { pollFormulaRanking(jobId); }, 5000);
    })
    .catch(function () {
      setTimeout(function () { pollFormulaRanking(jobId); }, 10000);
    });
}

function initFormulaPickerModal() {
  var overlay = document.getElementById('formulaPickerOverlay');
  var closeBtn = document.getElementById('formulaPickerClose');
  var clearBtn = document.getElementById('formulaPickerClear');
  var confirmBtn = document.getElementById('formulaPickerConfirm');
  var rankBtn = document.getElementById('formulaPickerRankBtn');
  if (!overlay) return;

  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFormulaPicker(); });
  if (closeBtn) closeBtn.addEventListener('click', closeFormulaPicker);
  if (clearBtn) clearBtn.addEventListener('click', function () {
    if (_formulaPickerCallback) _formulaPickerCallback('');
    closeFormulaPicker();
  });
  if (confirmBtn) confirmBtn.addEventListener('click', function () {
    if (_formulaPickerCallback) _formulaPickerCallback(_formulaPickerSelected || '');
    closeFormulaPicker();
  });
  if (rankBtn) rankBtn.addEventListener('click', triggerFormulaRanking);
}

function getFormulaDisplayLabel(formulaId) {
  if (!formulaId || !_formulaPickerCache) return '(none)';
  var f = _formulaPickerCache.find(function (x) { return x.formula_id === formulaId; });
  if (!f) return formulaId.slice(0, 16);
  var r = f.backtest_ranking;
  if (r) return '#' + r.rank + ' score=' + r.composite_score.toFixed(2);
  return 'fit=' + (f.fitness || 0).toFixed(2) + ' cx=' + (f.complexity || '?');
}

// ── Family picker modal ────────────────────────────────────────────────────────
let _familyPickerCallback = null;

function openFamilyPicker(currentValue, onConfirm) {
  _familyPickerCallback = onConfirm;
  const overlay = document.getElementById('familyPickerOverlay');
  const searchEl = document.getElementById('familyPickerSearch');
  if (!overlay) return;
  searchEl.value = '';
  renderFamilyPickerList('', currentValue);
  overlay.style.display = 'flex';
  setTimeout(() => searchEl.focus(), 80);
}

function renderFamilyPickerList(query, selectedSig) {
  const list = document.getElementById('familyPickerList');
  if (!list) return;
  const q = query.toLowerCase();
  const rows = _knownFamilyRows.filter((f) => !q || f.signature.toLowerCase().includes(q));
  if (!rows.length) {
    list.innerHTML = '<div style="padding:.75rem;color:var(--color-text-muted,#888);font-size:.85rem;">No families found.</div>';
    return;
  }
  list.innerHTML = rows.map((f) => {
    const t10 = f.crossSymbolMeanTScoreForward10 != null ? `t10=${Number(f.crossSymbolMeanTScoreForward10).toFixed(2)}` : '';
    const mean10 = f.crossSymbolMeanAvgForward10ReturnAtr != null ? `mean10=${Number(f.crossSymbolMeanAvgForward10ReturnAtr).toFixed(3)}` : '';
    const star = f.isCandidateFamily ? '<span style="color:#f59e0b;margin-left:.3rem;">★</span>' : '';
    const active = f.signature === selectedSig;
    return `<button
      data-sig="${f.signature}"
      style="text-align:left;background:${active ? 'rgba(79,70,229,.25)' : 'var(--color-bg-elevated,#1f1f35)'};border:1px solid ${active ? 'var(--color-accent,#4f46e5)' : 'var(--color-border,#333)'};border-radius:8px;padding:.6rem .85rem;cursor:pointer;color:inherit;font:inherit;width:100%;">
      <div style="font-size:.82rem;font-weight:600;font-family:monospace;">${f.signature}${star}</div>
      <div style="font-size:.75rem;color:var(--color-text-muted,#888);margin-top:.2rem;">${[t10, mean10, `${f.symbolCount} sym`, `${f.totalOccurrenceCount} occ`].filter(Boolean).join(' · ')}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('button[data-sig]').forEach((btn) => {
    btn.addEventListener('click', () => {
      list.querySelectorAll('button[data-sig]').forEach((b) => {
        b.style.background = 'var(--color-bg-elevated,#1f1f35)';
        b.style.borderColor = 'var(--color-border,#333)';
      });
      btn.style.background = 'rgba(79,70,229,.25)';
      btn.style.borderColor = 'var(--color-accent,#4f46e5)';
      btn.dataset.selected = 'true';
    });
  });
}

function closeFamilyPicker() {
  const overlay = document.getElementById('familyPickerOverlay');
  if (overlay) overlay.style.display = 'none';
  _familyPickerCallback = null;
}

function initFamilyPickerModal() {
  const overlay = document.getElementById('familyPickerOverlay');
  const searchEl = document.getElementById('familyPickerSearch');
  const closeBtn = document.getElementById('familyPickerClose');
  const clearBtn = document.getElementById('familyPickerClear');
  const confirmBtn = document.getElementById('familyPickerConfirm');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFamilyPicker(); });
  closeBtn?.addEventListener('click', closeFamilyPicker);
  searchEl?.addEventListener('input', () => {
    const selected = document.querySelector('#familyPickerList button[data-selected="true"]');
    renderFamilyPickerList(searchEl.value, selected?.dataset?.sig || '');
  });
  clearBtn?.addEventListener('click', () => {
    if (_familyPickerCallback) _familyPickerCallback('');
    closeFamilyPicker();
  });
  confirmBtn?.addEventListener('click', () => {
    const selected = document.querySelector('#familyPickerList button[data-selected="true"]');
    if (_familyPickerCallback) _familyPickerCallback(selected?.dataset?.sig || '');
    closeFamilyPicker();
  });
}

async function loadPrimitiveLibrary() {
  try {
    const res = await fetch('/api/plugins/primitives');
    const payload = await res.json();
    if (!res.ok || !payload?.success || !Array.isArray(payload?.data)) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    blocklyPrimitiveRows = payload.data
      .filter((row) => row && typeof row === 'object' && row.pattern_id)
      .map((row) => ({
        pattern_id: String(row.pattern_id || '').trim(),
        name: String(row.name || row.pattern_id || '').trim(),
        indicator_role: String(row.indicator_role || 'unknown').trim(),
        canonical_role: String(row.canonical_role || row.indicator_role || 'unknown').trim(),
        description: String(row.description || '').trim(),
        category: String(row.category || 'custom').trim(),
        library_tier: String(row.library_tier || '').trim(),
        autonomy_safe: row.autonomy_safe === true,
        state_compatible: row.state_compatible === true,
        cost_class: String(row.cost_class || '').trim(),
        tunable_params: Array.isArray(row.tunable_params) ? row.tunable_params : [],
        default_setup_params: row.default_setup_params && typeof row.default_setup_params === 'object' ? row.default_setup_params : {},
      }))
      .filter((row) => !!row.pattern_id)
      .sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
    setBlocklyStatus(`Loaded ${blocklyPrimitiveRows.length} primitives`);
  } catch (error) {
    blocklyPrimitiveRows = [];
    setBlocklyStatus(`Failed to load primitives: ${error.message || 'Unknown error'}`, true);
  }
}

const CATEGORY_LABELS = {
  chart_patterns: 'Chart Patterns',
  indicator_signals: 'Indicators',
  price_action: 'Price Action',
  custom: 'Custom',
  scan_pipelines: 'Pipelines',
};

function prettyCategoryName(cat) {
  return CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildToolboxDefinition() {
  const group = {
    STRUCTURE_RESULT: {},
    LOCATION_RESULT: {},
    TRIGGER_RESULT: {},
    PATTERN_RESULT: {},
  };

  blocklyPrimitiveRows.forEach((row) => {
    const blockType = registerPrimitiveBlock(row);
    if (!blockType) return;
    const socketType = getSocketTypeForPrimitive(row);
    const cat = String(
      row.pattern_id === FUNDAMENTAL_FILTER_PRIMITIVE_ID ? 'fundamentals' : (row.category || 'custom')
    ).trim().toLowerCase();
    if (!group[socketType]) group[socketType] = {};
    if (!group[socketType][cat]) group[socketType][cat] = [];
    group[socketType][cat].push({ kind: 'block', type: blockType });
  });

  function buildCategoryContents(socketGroup, colour) {
    const cats = Object.keys(socketGroup).sort();
    if (cats.length === 0) return [];
    if (cats.length === 1) return socketGroup[cats[0]];
    return cats.map((cat) => ({
      kind: 'category',
      name: prettyCategoryName(cat),
      colour,
      contents: socketGroup[cat],
    }));
  }

  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Composer',
        colour: '#7c91ff',
        contents: [
          { kind: 'block', type: 'compose_indicator' },
          { kind: 'block', type: 'compose_conditional' },
        ],
      },
      {
        kind: 'category',
        name: 'Logic',
        colour: '#c87800',
        contents: [
          { kind: 'sep' },
          { kind: 'label', text: '— Conditions —' },
          { kind: 'block', type: 'check_verdict' },
          { kind: 'block', type: 'score_threshold' },
          { kind: 'block', type: 'time_filter' },
          { kind: 'sep' },
          { kind: 'label', text: '— Boolean Operators —' },
          { kind: 'block', type: 'logic_operation', fields: { OP: 'AND' } },
          { kind: 'block', type: 'logic_operation', fields: { OP: 'OR' } },
          { kind: 'block', type: 'logic_negate' },
          { kind: 'sep' },
          { kind: 'label', text: '— Advanced —' },
          { kind: 'block', type: 'cooldown_gate' },
          { kind: 'block', type: 'compare_primitives' },
          { kind: 'block', type: 'sequence_check' },
          { kind: 'block', type: 'regime_gate' },
          { kind: 'block', type: 'state_machine_flow' },
        ],
      },
      {
        kind: 'category',
        name: 'Structure',
        colour: '#5a8bd8',
        contents: buildCategoryContents(group.STRUCTURE_RESULT, '#5a8bd8'),
      },
      {
        kind: 'category',
        name: 'Location',
        colour: '#4ba864',
        contents: buildCategoryContents(group.LOCATION_RESULT, '#4ba864'),
      },
      {
        kind: 'category',
        name: 'Timing Trigger',
        colour: '#d38e4c',
        contents: buildCategoryContents(group.TRIGGER_RESULT, '#d38e4c'),
      },
      {
        kind: 'category',
        name: 'Regime Filter',
        colour: '#8d67c7',
        contents: (() => {
          // Inject the built-in liquidity_filter into the 'fundamentals' sub-group
          // so it appears alongside Fundamental Quality Filter, not as a separate section.
          if (!group.PATTERN_RESULT['fundamentals']) group.PATTERN_RESULT['fundamentals'] = [];
          const alreadyAdded = group.PATTERN_RESULT['fundamentals'].some((b) => b.type === 'liquidity_filter');
          if (!alreadyAdded) {
            group.PATTERN_RESULT['fundamentals'].unshift({ kind: 'block', type: 'liquidity_filter' });
          }
          return buildCategoryContents(group.PATTERN_RESULT, '#8d67c7');
        })(),
      },
    ],
  };
}

function getBlocklyPrimitiveBlockType(patternId) {
  const safe = String(patternId || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return safe ? `primitive_${safe}` : '';
}

function addFundamentalFilterBlocklyBlock() {
  if (!blocklyWorkspace) return;
  const row = blocklyPrimitiveRows.find((item) => item.pattern_id === FUNDAMENTAL_FILTER_PRIMITIVE_ID);
  if (!row) {
    alert('Fundamental Quality Filter is not available in the primitive library.');
    return;
  }
  const blockType = getBlocklyPrimitiveBlockType(FUNDAMENTAL_FILTER_PRIMITIVE_ID);
  if (!Blockly.Blocks[blockType]) {
    registerPrimitiveBlock(row);
  }
  const block = blocklyWorkspace.newBlock(blockType);
  block.initSvg();
  block.render();

  let connected = false;
  const composeBlocks = findComposeBlocks();
  if (composeBlocks.length === 1 && composeBlocks[0].type === 'compose_indicator') {
    const compose = composeBlocks[0];
    const patternInput = compose.getInput('PATTERN');
    const targetConnection = patternInput?.connection;
    if (targetConnection && !targetConnection.targetBlock()) {
      const outputConnection = block.outputConnection;
      if (outputConnection) {
        targetConnection.connect(outputConnection);
        connected = true;
      }
    }
  }

  if (!connected) {
    block.moveBy(160, 140);
  }
  setBlocklyStatus(connected ? 'Added Fundamental Quality Filter to the regime/filter slot' : 'Added Fundamental Quality Filter block');
}

function injectBlocklyDarkStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Blockly toolbox dark theme overrides */
    .blocklyToolboxDiv {
      background: #2a2d38 !important;
      border-right: 1px solid #3a3d48 !important;
    }
    .blocklyTreeRow {
      padding: 8px 14px !important;
      margin-bottom: 1px !important;
    }
    .blocklyTreeLabel {
      color: #d8d8d4 !important;
      font-size: 13px !important;
      font-weight: 500 !important;
    }
    .blocklyTreeRow:hover {
      background: rgba(255, 255, 255, 0.08) !important;
    }
    .blocklyTreeSelected {
      background: rgba(255, 255, 255, 0.12) !important;
    }
    .blocklyTreeSelected .blocklyTreeLabel {
      color: #ffffff !important;
    }
    .blocklyFlyoutBackground {
      fill: #2a2d38 !important;
      fill-opacity: 0.95 !important;
    }
    .blocklyMainBackground {
      fill: #24262e !important;
    }
    .blocklyScrollbarBackground {
      fill: #2a2d38 !important;
    }
    .blocklyScrollbarHandle {
      fill: #4a4d58 !important;
    }
    .blocklyTrash {
      opacity: 0.6;
    }
    .blocklyZoom > image {
      opacity: 0.7;
    }
  `;
  document.head.appendChild(style);
}

function initializeBlocklyWorkspace() {
  const mount = document.getElementById('blockly-workspace');
  if (!mount) return;

  injectBlocklyDarkStyles();

  const darkTheme = Blockly.Theme.defineTheme('patternDetectorDark', {
    base: Blockly.Themes.Zelos,
    componentStyles: {
      workspaceBackgroundColour: '#24262e',
      toolboxBackgroundColour: '#2a2d38',
      toolboxForegroundColour: '#d8d8d4',
      flyoutBackgroundColour: '#2a2d38',
      flyoutForegroundColour: '#d8d8d4',
      flyoutOpacity: 0.95,
      scrollbarColour: '#4a4d58',
      scrollbarOpacity: 0.7,
      insertionMarkerColour: '#ffffff',
      insertionMarkerOpacity: 0.3,
      cursorColour: '#d0d0cc',
    },
    fontStyle: {
      family: "'Inter', 'JetBrains Mono', sans-serif",
      weight: '500',
      size: 12,
    },
  });

  const toolbox = buildToolboxDefinition();
  blocklyWorkspace = Blockly.inject('blockly-workspace', {
    toolbox,
    grid: { spacing: 20, length: 3, colour: '#3a3d48', snap: true },
    zoom: {
      controls: true,
      wheel: true,
      startScale: 0.9,
      maxScale: 1.6,
      minScale: 0.4,
      scaleSpeed: 1.1,
    },
    collapse: true,
    trashcan: true,
    theme: darkTheme,
  });

  const initialCompose = blocklyWorkspace.newBlock('compose_indicator');
  initialCompose.initSvg();
  initialCompose.render();
  initialCompose.moveBy(40, 40);

  blocklyWorkspace.addChangeListener((event) => {
    if (isRestoringBlocklyWorkspace) return;
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    hideBlocklyValidationFeedback();
    updateCompositionPreview();
    renderBlocklyStateMachinePanel();

    if (event.type === Blockly.Events.BLOCK_CREATE && event.blockId) {
      const block = blocklyWorkspace.getBlockById(event.blockId);
      if (block && block.type !== 'compose_indicator') {
        try {
          const meta = JSON.parse(String(block.data || '{}'));
          if (meta?.param_keys?.length > 0) {
            setTimeout(() => {
              try {
                block.setCollapsed(true);
                const parent = block.getParent();
                if (parent) parent.render();
                blocklyWorkspace.render();
              } catch {}
            }, 50);
          }
        } catch {}
      }
    }
  });
}

function listBlocklyPrimitiveOptions() {
  if (!blocklyWorkspace) return [];
  const seen = new Set();
  const rowsById = new Map(blocklyPrimitiveRows.map((row) => [String(row.pattern_id || '').trim(), row]));
  return blocklyWorkspace
    .getAllBlocks(false)
    .map((block) => parsePrimitiveMeta(block))
    .filter((meta) => meta?.pattern_id)
    .map((meta) => String(meta.pattern_id).trim())
    .filter((patternId) => {
      if (!patternId || seen.has(patternId)) return false;
      seen.add(patternId);
      return true;
    })
    .map((patternId) => {
      const row = rowsById.get(patternId);
      return {
        pattern_id: patternId,
        name: String(row?.name || patternId),
        indicator_role: String(row?.indicator_role || ''),
      };
    });
}

function normalizeBlocklyStateMachineState(nextState) {
  const base = nextState && typeof nextState === 'object' ? nextState : {};
  return {
    enabled: base.enabled === true,
    armPrimitive: String(base.armPrimitive || '').trim(),
    watchPrimitive: String(base.watchPrimitive || '').trim(),
    invalidatePrimitive: String(base.invalidatePrimitive || '').trim(),
    watchBars: Math.max(1, Math.floor(Number(base.watchBars) || 5)),
    emitOnArmed: base.emitOnArmed !== false,
    emitOnWatching: base.emitOnWatching !== false,
  };
}

function renderBlocklyStateMachinePanel() {
  const host = document.getElementById('blockly-state-machine-host');
  if (!host) return;
  const isOpen = readBlocklyStateMachineCollapseState();

  const primitiveOptions = listBlocklyPrimitiveOptions();
  const primitiveOptionsHtml = primitiveOptions
    .map((row) => `<option value="${escapeHtml(row.pattern_id)}"${row.pattern_id === blocklyStateMachineState.armPrimitive ? ' selected' : ''}>${escapeHtml(row.name)} (${escapeHtml(row.pattern_id)})</option>`)
    .join('');
  const watchOptionsHtml = primitiveOptions
    .map((row) => `<option value="${escapeHtml(row.pattern_id)}"${row.pattern_id === blocklyStateMachineState.watchPrimitive ? ' selected' : ''}>${escapeHtml(row.name)} (${escapeHtml(row.pattern_id)})</option>`)
    .join('');
  const invalidateOptionsHtml = primitiveOptions
    .map((row) => `<option value="${escapeHtml(row.pattern_id)}"${row.pattern_id === blocklyStateMachineState.invalidatePrimitive ? ' selected' : ''}>${escapeHtml(row.name)} (${escapeHtml(row.pattern_id)})</option>`)
    .join('');

  host.innerHTML = `
    <details class="panel" style="margin-top:12px;" ${isOpen ? 'open' : ''}>
      <summary class="panel-header" style="cursor:pointer;list-style:none;">
        <span class="panel-header-title">State Machine</span>
        <span class="text-muted text-mono" style="font-size:11px;">Writes \`setup_config.state_machine\`</span>
      </summary>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;">
        <label class="text-muted" style="display:flex;align-items:center;gap:8px;font-size:12px;">
          <input type="checkbox" id="blockly-state-machine-enabled" ${blocklyStateMachineState.enabled ? 'checked' : ''}>
          Enable stateful entry flow for this Blockly strategy
        </label>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;${blocklyStateMachineState.enabled ? '' : 'opacity:0.55;'}">
          <label class="workshop-meta-field" style="margin:0;">
            <span>Arm On Primitive</span>
            <select class="select" id="blockly-state-machine-arm" ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
              <option value="">Select primitive...</option>
              ${primitiveOptionsHtml}
            </select>
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Advance To Watching On</span>
            <select class="select" id="blockly-state-machine-watch" ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
              <option value="">Same primitive as arm</option>
              ${watchOptionsHtml}
            </select>
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Invalidate On</span>
            <select class="select" id="blockly-state-machine-invalidate" ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
              <option value="">None</option>
              ${invalidateOptionsHtml}
            </select>
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Watch Bars</span>
            <input type="number" id="blockly-state-machine-watch-bars" min="1" step="1" value="${escapeHtml(blocklyStateMachineState.watchBars)}" ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
          </label>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;${blocklyStateMachineState.enabled ? '' : 'opacity:0.55;'}">
          <label class="text-muted" style="display:flex;align-items:center;gap:8px;font-size:12px;">
            <input type="checkbox" id="blockly-state-machine-emit-armed" ${blocklyStateMachineState.emitOnArmed ? 'checked' : ''} ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
            Emit while armed
          </label>
          <label class="text-muted" style="display:flex;align-items:center;gap:8px;font-size:12px;">
            <input type="checkbox" id="blockly-state-machine-emit-watching" ${blocklyStateMachineState.emitOnWatching ? 'checked' : ''} ${blocklyStateMachineState.enabled ? '' : 'disabled'}>
            Emit while watching
          </label>
        </div>
        <div class="text-muted" style="font-size:12px;">
          Use this for strategies that must arm on one event and emit over a later watch window instead of firing statelessly on every bar.
        </div>
      </div>
    </details>
  `;

  const onInput = (domEvent) => {
    syncBlocklyStateMachineFromDom();
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    hideBlocklyValidationFeedback();
    updateCompositionPreview();
    if (domEvent?.target?.id === 'blockly-state-machine-enabled') {
      renderBlocklyStateMachinePanel();
    }
  };
  const detailsEl = host.querySelector('details.panel');
  if (detailsEl) {
    detailsEl.addEventListener('toggle', () => {
      writeBlocklyStateMachineCollapseState(detailsEl.open);
    });
  }
  host.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
  });
  updateBlocklyInspectorSummaries();
}

function syncBlocklyStateMachineFromDom() {
  const enabledEl = document.getElementById('blockly-state-machine-enabled');
  const armEl = document.getElementById('blockly-state-machine-arm');
  const watchEl = document.getElementById('blockly-state-machine-watch');
  const invalidateEl = document.getElementById('blockly-state-machine-invalidate');
  const watchBarsEl = document.getElementById('blockly-state-machine-watch-bars');
  const emitArmedEl = document.getElementById('blockly-state-machine-emit-armed');
  const emitWatchingEl = document.getElementById('blockly-state-machine-emit-watching');
  blocklyStateMachineState = normalizeBlocklyStateMachineState({
    enabled: enabledEl?.checked,
    armPrimitive: armEl?.value,
    watchPrimitive: watchEl?.value,
    invalidatePrimitive: invalidateEl?.value,
    watchBars: watchBarsEl?.value,
    emitOnArmed: emitArmedEl?.checked,
    emitOnWatching: emitWatchingEl?.checked,
  });
}

function applyBlocklyStateMachine(definition, errors) {
  syncBlocklyStateMachineFromDom();
  if (!blocklyStateMachineState.enabled) {
    if (definition?.default_setup_params && typeof definition.default_setup_params === 'object') {
      delete definition.default_setup_params.state_machine;
    }
    return;
  }

  const availablePrimitives = new Set(listBlocklyPrimitiveOptions().map((row) => row.pattern_id));
  if (!blocklyStateMachineState.armPrimitive) {
    errors.push('State machine is enabled but Arm On Primitive is not set.');
    return;
  }
  if (!availablePrimitives.has(blocklyStateMachineState.armPrimitive)) {
    errors.push(`State machine arm primitive "${blocklyStateMachineState.armPrimitive}" is not present in the workspace.`);
    return;
  }
  if (blocklyStateMachineState.invalidatePrimitive && !availablePrimitives.has(blocklyStateMachineState.invalidatePrimitive)) {
    errors.push(`State machine invalidate primitive "${blocklyStateMachineState.invalidatePrimitive}" is not present in the workspace.`);
    return;
  }
  const emitOn = [];
  if (blocklyStateMachineState.emitOnArmed) emitOn.push('armed');
  if (blocklyStateMachineState.emitOnWatching) emitOn.push('watching');
  if (!emitOn.length) {
    errors.push('State machine is enabled but no emit phase is selected.');
    return;
  }

  const watchPrimitive = blocklyStateMachineState.watchPrimitive || blocklyStateMachineState.armPrimitive;
  const actionFlag = `${blocklyStateMachineState.armPrimitive.replace(/[^a-z0-9_]+/gi, '_')}_confirmed`;
  definition.default_setup_params.state_machine = {
    initial_phase: 'idle',
    watch_bars: blocklyStateMachineState.watchBars,
    invalidate_on: blocklyStateMachineState.invalidatePrimitive || '',
    emit_on: emitOn,
    transitions: [
      {
        from: 'idle',
        on_primitive: blocklyStateMachineState.armPrimitive,
        to: 'armed',
        action: {
          set_watch_bars: blocklyStateMachineState.watchBars,
          set_flag: actionFlag,
        },
      },
      {
        from: 'armed',
        on_primitive: watchPrimitive,
        to: 'watching',
      },
    ],
  };
}

function applyBlocklyStateMachineFromDefinition(definition) {
  const sm = definition?.default_setup_params?.state_machine;
  if (!sm || typeof sm !== 'object') {
    blocklyStateMachineState = normalizeBlocklyStateMachineState({ enabled: false });
    renderBlocklyStateMachinePanel();
    updateBlocklyInspectorSummaries();
    return;
  }
  const transitions = Array.isArray(sm.transitions) ? sm.transitions : [];
  const armTransition = transitions.find((row) => String(row?.from || '') === 'idle') || transitions[0] || null;
  const watchTransition = transitions.find((row) => {
    const from = row?.from;
    return from === 'armed' || (Array.isArray(from) && from.includes('armed'));
  }) || null;
  const emitOn = Array.isArray(sm.emit_on) ? sm.emit_on.map((row) => String(row)) : [String(sm.emit_on || '')].filter(Boolean);
  blocklyStateMachineState = normalizeBlocklyStateMachineState({
    enabled: true,
    armPrimitive: String(armTransition?.on_primitive || ''),
    watchPrimitive: String(watchTransition?.on_primitive || ''),
    invalidatePrimitive: String(sm.invalidate_on || ''),
    watchBars: Number(sm.watch_bars || armTransition?.action?.set_watch_bars || 5),
    emitOnArmed: emitOn.includes('armed'),
    emitOnWatching: emitOn.includes('watching'),
  });
  renderBlocklyStateMachinePanel();
  updateBlocklyInspectorSummaries();
}

function buildStateMachineConfigFromBlock(stateBlock, errors) {
  if (!stateBlock) return null;
  if (stateBlock.type !== 'state_machine_flow') {
    errors.push('Unsupported state logic block. Use the STATE MACHINE block from the Logic category.');
    return null;
  }

  const armBlock = stateBlock.getInputTargetBlock('ARM_PRIMITIVE');
  const watchBlock = stateBlock.getInputTargetBlock('WATCH_PRIMITIVE');
  const invalidateBlock = stateBlock.getInputTargetBlock('INVALIDATE_PRIMITIVE');

  const armMeta = parsePrimitiveMeta(armBlock);
  const watchMeta = parsePrimitiveMeta(watchBlock);
  const invalidateMeta = parsePrimitiveMeta(invalidateBlock);

  if (!armMeta?.pattern_id) {
    errors.push('STATE MACHINE block: connect a primitive to Arm on.');
    return null;
  }

  const watchPrimitive = watchMeta?.pattern_id || armMeta.pattern_id;
  const watchBars = Math.max(1, Math.floor(Number(stateBlock.getFieldValue('WATCH_BARS') || 5) || 5));
  const emitOn = [];
  if (String(stateBlock.getFieldValue('EMIT_ARMED') || 'TRUE').toUpperCase() === 'TRUE') emitOn.push('armed');
  if (String(stateBlock.getFieldValue('EMIT_WATCHING') || 'TRUE').toUpperCase() === 'TRUE') emitOn.push('watching');
  if (!emitOn.length) {
    errors.push('STATE MACHINE block: select at least one emit phase.');
    return null;
  }

  const actionFlag = `${String(armMeta.pattern_id || '').replace(/[^a-z0-9_]+/gi, '_')}_confirmed`;
  return {
    initial_phase: 'idle',
    watch_bars: watchBars,
    invalidate_on: invalidateMeta?.pattern_id || '',
    emit_on: emitOn,
    transitions: [
      {
        from: 'idle',
        on_primitive: armMeta.pattern_id,
        to: 'armed',
        action: {
          set_watch_bars: watchBars,
          set_flag: actionFlag,
        },
      },
      {
        from: 'armed',
        on_primitive: watchPrimitive,
        to: 'watching',
      },
    ],
  };
}

function getBlocklyWorkspaceState() {
  if (!blocklyWorkspace) return null;
  try {
    return Blockly.serialization.workspaces.save(blocklyWorkspace);
  } catch {
    return null;
  }
}

function hasMeaningfulBlocklyWorkspace() {
  if (!blocklyWorkspace) return false;
  return blocklyWorkspace.getAllBlocks(false).length > 1;
}

function hasMeaningfulBlocklyDraftContent() {
  const nameValue = String(document.getElementById('blockly-pattern-name')?.value || '').trim();
  const idValue = String(document.getElementById('blockly-pattern-id')?.value || '').trim();
  const categoryValue = String(document.getElementById('blockly-category')?.value || '').trim();
  const intentValue = String(document.getElementById('blockly-intent')?.value || 'entry').trim();
  const hasFundamentalConfig = !!(blocklyFundamentalEditor?.getValue?.());
  syncBlocklyStateMachineFromDom();
  return hasMeaningfulBlocklyWorkspace()
    || !!nameValue
    || !!idValue
    || categoryValue !== 'indicator_signals'
    || intentValue !== 'entry'
    || hasFundamentalConfig
    || blocklyStateMachineState.enabled;
}

function clearBlocklyDraft() {
  try {
    localStorage.removeItem(BLOCKLY_COMPOSER_DRAFT_KEY);
  } catch {}
}

function buildBlocklyDraftPayload() {
  const workspaceState = getBlocklyWorkspaceState();
  if (!workspaceState) return null;
  syncBlocklyStateMachineFromDom();
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    meta: {
      name: String(document.getElementById('blockly-pattern-name')?.value || '').trim(),
      pattern_id: String(document.getElementById('blockly-pattern-id')?.value || '').trim(),
      category: String(document.getElementById('blockly-category')?.value || 'indicator_signals').trim() || 'indicator_signals',
      intent: String(document.getElementById('blockly-intent')?.value || 'entry').trim() || 'entry',
      status: String(document.getElementById('blockly-status')?.textContent || 'draft').trim() || 'draft',
      load_pattern_id: String(document.getElementById('blockly-load-pattern-id')?.value || '').trim(),
    },
    workspace_state: workspaceState,
    fundamental_config: blocklyFundamentalEditor?.getValue?.() || null,
    state_machine_state: normalizeBlocklyStateMachineState(blocklyStateMachineState),
  };
}

function persistBlocklyDraftImmediately() {
  if (blocklyDraftSaveTimer) {
    clearTimeout(blocklyDraftSaveTimer);
    blocklyDraftSaveTimer = null;
  }
  try {
    if (!hasMeaningfulBlocklyDraftContent()) {
      clearBlocklyDraft();
      return false;
    }
    const payload = buildBlocklyDraftPayload();
    if (!payload) return false;
    localStorage.setItem(BLOCKLY_COMPOSER_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn('Failed to persist Blockly draft:', error);
    return false;
  }
}

function scheduleBlocklyDraftSave() {
  if (isRestoringBlocklyWorkspace) return;
  if (blocklyDraftSaveTimer) clearTimeout(blocklyDraftSaveTimer);
  blocklyDraftSaveTimer = setTimeout(() => {
    blocklyDraftSaveTimer = null;
    persistBlocklyDraftImmediately();
  }, 300);
}

function maybeRestoreBlocklyDraft() {
  try {
    const url = new URL(window.location.href);
    if (String(url.searchParams.get('pattern_id') || '').trim()) return false;
  } catch {}

  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(BLOCKLY_COMPOSER_DRAFT_KEY) || 'null');
  } catch {
    clearBlocklyDraft();
    return false;
  }
  if (!payload || typeof payload !== 'object' || !payload.workspace_state) return false;

  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const categoryInput = document.getElementById('blockly-category');
  const intentSelect = document.getElementById('blockly-intent');
  const statusBadge = document.getElementById('blockly-status');
  const loadInput = document.getElementById('blockly-load-pattern-id');

  if (nameInput) nameInput.value = String(meta.name || '').trim();
  if (idInput) idInput.value = String(meta.pattern_id || '').trim();
  if (categoryInput) categoryInput.value = String(meta.category || 'indicator_signals').trim() || 'indicator_signals';
  if (intentSelect) intentSelect.value = String(meta.intent || 'entry').trim() || 'entry';
  if (statusBadge) statusBadge.textContent = 'draft';
  if (loadInput) loadInput.value = String(meta.load_pattern_id || '').trim();
  if (blocklyFundamentalEditor) {
    blocklyFundamentalEditor.setValue(payload.fundamental_config || null);
  }
  blocklyStateMachineState = normalizeBlocklyStateMachineState(payload.state_machine_state || {});
  renderBlocklyStateMachinePanel();

  const restored = restoreBlocklyWorkspaceState(payload.workspace_state);
  if (!restored) {
    clearBlocklyDraft();
    return false;
  }
  setBlocklyStatus(`Restored local draft${payload.saved_at ? ` from ${new Date(payload.saved_at).toLocaleString()}` : ''}`);
  return true;
}

function restoreBlocklyWorkspaceState(state) {
  if (!blocklyWorkspace || !state || typeof state !== 'object') return false;
  try {
    isRestoringBlocklyWorkspace = true;
    blocklyWorkspace.clear();
    Blockly.serialization.workspaces.load(state, blocklyWorkspace);
    return true;
  } catch (error) {
    console.error('Failed to restore Blockly workspace', error);
    return false;
  } finally {
    isRestoringBlocklyWorkspace = false;
    updateCompositionPreview();
  }
}

function initializeBlocklyFundamentalEditor() {
  if (typeof initFundamentalConfigEditor !== 'function') return;
  blocklyFundamentalEditor = initFundamentalConfigEditor({
    hostId: 'blockly-fundamental-config-host',
    prefix: 'blockly-fundamentals',
    onChange: () => {
      blocklyValidationPassed = false;
      blocklyValidationHash = '';
      updateBlocklyRegisterButton();
      hideBlocklyValidationFeedback();
      updateCompositionPreview();
      updateBlocklyInspectorSummaries();
    },
  });
  updateBlocklyInspectorSummaries();
}

function applyBlocklyFundamentalConfig(definition, errors) {
  if (!blocklyFundamentalEditor) return;
  const issues = blocklyFundamentalEditor.getIssues();
  if (Array.isArray(issues) && issues.length) {
    errors.push(...issues);
  }
  const config = blocklyFundamentalEditor.getValue();
  if (config) {
    definition.fundamental_config = config;
  } else {
    delete definition.fundamental_config;
  }
}

function applyBlocklyAuthoringMeta(authoring) {
  const blockly = authoring?.blockly || {};
  const meta = blockly.meta || {};
  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const categoryInput = document.getElementById('blockly-category');
  const intentSelect = document.getElementById('blockly-intent');
  const statusBadge = document.getElementById('blockly-status');
  if (nameInput && typeof meta.name === 'string') nameInput.value = meta.name;
  if (idInput && typeof meta.pattern_id === 'string') idInput.value = meta.pattern_id;
  if (categoryInput && typeof meta.category === 'string') categoryInput.value = meta.category;
  if (intentSelect && typeof meta.intent === 'string') intentSelect.value = meta.intent;
  if (statusBadge) statusBadge.textContent = 'loaded';
}

async function loadBlocklyPattern(patternId) {
  const normalizedId = String(patternId || '').trim();
  if (!normalizedId) {
    alert('Enter a pattern ID to open.');
    return false;
  }
  if (hasMeaningfulBlocklyWorkspace()) {
    const okToReplace = confirm(`Open "${normalizedId}" and replace the current Blockly workspace?`);
    if (!okToReplace) return false;
  }
  setBlocklyStatus(`Loading ${normalizedId}...`);
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(normalizedId)}`);
    const payload = await res.json();
    if (!res.ok || !payload?.success || !payload?.data) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    const definition = payload.data;
    const authoring = definition?.authoring;
    const workspaceState = authoring?.blockly?.workspace_state;
    if (!workspaceState) {
      throw new Error('This indicator does not have saved Blockly workspace data yet.');
    }
    applyBlocklyAuthoringMeta(authoring);
    if (blocklyFundamentalEditor) {
      blocklyFundamentalEditor.setValue(definition?.fundamental_config || null);
    }
    applyBlocklyStateMachineFromDefinition(definition);
    const restored = restoreBlocklyWorkspaceState(workspaceState);
    if (!restored) {
      throw new Error('Saved Blockly workspace data could not be restored.');
    }
    const loadInput = document.getElementById('blockly-load-pattern-id');
    if (loadInput) loadInput.value = normalizedId;
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    hideBlocklyValidationFeedback();
    setBlocklyStatus(`Loaded ${normalizedId}`);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('pattern_id', normalizedId);
      window.history.replaceState({}, '', url.toString());
    } catch {}
    return true;
  } catch (error) {
    setBlocklyStatus(`Load failed: ${error.message || 'Unknown error'}`, true);
    alert(`Could not open "${normalizedId}" in Blockly.\n\n${error.message || 'Unknown error'}`);
    return false;
  }
}

async function maybeLoadBlocklyDefinitionFromQuery() {
  try {
    const url = new URL(window.location.href);
    const patternId = String(url.searchParams.get('pattern_id') || '').trim();
    if (!patternId) return;
    await loadBlocklyPattern(patternId);
  } catch {}
}

function parsePrimitiveMeta(block) {
  if (!block) return null;
  try {
    const parsed = JSON.parse(String(block.data || '{}'));
    if (!parsed?.pattern_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function findComposeBlocks() {
  if (!blocklyWorkspace) return [];
  return blocklyWorkspace
    .getAllBlocks(false)
    .filter((block) => block.type === 'compose_indicator' || block.type === 'compose_conditional');
}

// ---------------------------------------------------------------------------
// Condition tree extraction — recursively reads check_verdict + logic blocks
// ---------------------------------------------------------------------------
function extractConditionTree(block) {
  if (!block) return null;

  if (block.type === 'check_verdict') {
    const primitiveBlock = block.getInputTargetBlock('PRIMITIVE');
    const meta = parsePrimitiveMeta(primitiveBlock);
    if (!meta?.pattern_id) return { error: 'Check Verdict block has no primitive connected. Drop a primitive into the IF slot.' };
    const params = readBlockParamOverrides(primitiveBlock, meta);
    return {
      type: 'check',
      primitive_id: meta.pattern_id,
      verdict: String(block.getFieldValue('VERDICT') || 'ANY'),
      confidence_min: Number(block.getFieldValue('CONFIDENCE_MIN') || 70),
      params: Object.keys(params).length ? params : undefined,
    };
  }

  if (block.type === 'logic_operation') {
    const op = String(block.getFieldValue('OP') || 'AND').toUpperCase();
    const leftBlock = block.getInputTargetBlock('A');
    const rightBlock = block.getInputTargetBlock('B');
    const left = extractConditionTree(leftBlock);
    const right = extractConditionTree(rightBlock);
    if (!left) return { error: `${op} block needs a condition on the left (A) side.` };
    if (!right) return { error: `${op} block needs a condition on the right (B) side.` };
    if (left.error) return left;
    if (right.error) return right;
    return { type: 'op', op, left, right };
  }

  if (block.type === 'logic_negate') {
    const innerBlock = block.getInputTargetBlock('BOOL');
    const inner = extractConditionTree(innerBlock);
    if (!inner) return { error: 'NOT block needs a condition connected.' };
    if (inner.error) return inner;
    return { type: 'op', op: 'NOT', condition: inner };
  }

  if (block.type === 'score_threshold') {
    const primitiveBlock = block.getInputTargetBlock('PRIMITIVE');
    const meta = parsePrimitiveMeta(primitiveBlock);
    if (!meta?.pattern_id) return { error: 'Score Threshold has no primitive connected.' };
    const params = readBlockParamOverrides(primitiveBlock, meta);
    return {
      type: 'score',
      primitive_id: meta.pattern_id,
      threshold: Number(block.getFieldValue('THRESHOLD') || 0.7),
      params: Object.keys(params).length ? params : undefined,
    };
  }

  if (block.type === 'time_filter') {
    return {
      type: 'time',
      session: String(block.getFieldValue('SESSION') || 'ANY'),
    };
  }

  if (block.type === 'cooldown_gate') {
    const primitiveBlock = block.getInputTargetBlock('PRIMITIVE');
    const meta = parsePrimitiveMeta(primitiveBlock);
    if (!meta?.pattern_id) return { error: 'Cooldown Gate has no primitive connected.' };
    const params = readBlockParamOverrides(primitiveBlock, meta);
    return {
      type: 'cooldown',
      primitive_id: meta.pattern_id,
      bars: Number(block.getFieldValue('BARS') || 5),
      params: Object.keys(params).length ? params : undefined,
    };
  }

  if (block.type === 'compare_primitives') {
    const blockA = block.getInputTargetBlock('PRIMITIVE_A');
    const blockB = block.getInputTargetBlock('PRIMITIVE_B');
    const metaA = parsePrimitiveMeta(blockA);
    const metaB = parsePrimitiveMeta(blockB);
    if (!metaA?.pattern_id) return { error: 'Compare Primitives: connect a primitive to the first slot.' };
    if (!metaB?.pattern_id) return { error: 'Compare Primitives: connect a primitive to the second slot.' };
    return {
      type: 'compare',
      primitive_a: metaA.pattern_id,
      primitive_b: metaB.pattern_id,
      op: String(block.getFieldValue('OP') || 'GT'),
      params_a: readBlockParamOverrides(blockA, metaA) || undefined,
      params_b: readBlockParamOverrides(blockB, metaB) || undefined,
    };
  }

  if (block.type === 'sequence_check') {
    const firstBlock = block.getInputTargetBlock('FIRST');
    const secondBlock = block.getInputTargetBlock('SECOND');
    const metaFirst = parsePrimitiveMeta(firstBlock);
    const metaSecond = parsePrimitiveMeta(secondBlock);
    if (!metaFirst?.pattern_id) return { error: 'Sequence: connect a primitive to the FIRST slot.' };
    if (!metaSecond?.pattern_id) return { error: 'Sequence: connect a primitive to the SECOND slot.' };
    return {
      type: 'sequence',
      first_id: metaFirst.pattern_id,
      second_id: metaSecond.pattern_id,
      lookback: Number(block.getFieldValue('LOOKBACK') || 5),
      params_first: readBlockParamOverrides(firstBlock, metaFirst) || undefined,
      params_second: readBlockParamOverrides(secondBlock, metaSecond) || undefined,
    };
  }

  if (block.type === 'regime_gate') {
    const regimeBlock = block.getInputTargetBlock('REGIME');
    const signalBlock = block.getInputTargetBlock('SIGNAL');
    const metaRegime = parsePrimitiveMeta(regimeBlock);
    const metaSignal = parsePrimitiveMeta(signalBlock);
    if (!metaRegime?.pattern_id) return { error: 'Regime Gate: connect a Regime primitive to the REGIME slot.' };
    if (!metaSignal?.pattern_id) return { error: 'Regime Gate: connect a Signal primitive to the SIGNAL slot.' };
    return {
      type: 'regime',
      regime_id: metaRegime.pattern_id,
      regime_state: String(block.getFieldValue('REGIME_STATE') || 'ANY'),
      signal_id: metaSignal.pattern_id,
      params_regime: readBlockParamOverrides(regimeBlock, metaRegime) || undefined,
      params_signal: readBlockParamOverrides(signalBlock, metaSignal) || undefined,
    };
  }

  return { error: `Unsupported condition block type: "${block.type}". Use a block from the Logic category.` };
}

// ---------------------------------------------------------------------------
// Build conditional composite from a compose_conditional block
// ---------------------------------------------------------------------------
function buildConditionalFromBlock(composeBlock, intent, patternId, patternName, category) {
  const conditionBlock = composeBlock.getInputTargetBlock('CONDITION');
  if (!conditionBlock) {
    return { errors: ['Compose Conditional needs a condition. Connect a Check Verdict block to the IF slot.'] };
  }

  const conditionTree = extractConditionTree(conditionBlock);
  if (!conditionTree) return { errors: ['Could not read condition. Make sure a Check Verdict block is connected.'] };
  if (conditionTree.error) return { errors: [conditionTree.error] };

  const thenBlock = composeBlock.getInputTargetBlock('THEN_STAGE');
  if (!thenBlock) return { errors: ['Compose Conditional needs a THEN primitive. Connect one to the THEN slot.'] };
  const thenMeta = parsePrimitiveMeta(thenBlock);
  if (!thenMeta?.pattern_id) return { errors: ['Invalid block in THEN slot.'] };
  const thenParams = readBlockParamOverrides(thenBlock, thenMeta);
  const thenStage = { pattern_id: thenMeta.pattern_id };
  if (Object.keys(thenParams).length) thenStage.params = thenParams;

  const elseBlock = composeBlock.getInputTargetBlock('ELSE_STAGE');
  let elseStage = null;
  if (elseBlock) {
    const elseMeta = parsePrimitiveMeta(elseBlock);
    if (elseMeta?.pattern_id) {
      const elseParams = readBlockParamOverrides(elseBlock, elseMeta);
      elseStage = { pattern_id: elseMeta.pattern_id };
      if (Object.keys(elseParams).length) elseStage.params = elseParams;
    }
  }

  const branch = { condition: conditionTree, then: thenStage };
  if (elseStage) branch.else = elseStage;
  const errors = [];
  const stateMachineBlock = composeBlock.getInputTargetBlock('STATE_MACHINE');
  const blockStateMachine = buildStateMachineConfigFromBlock(stateMachineBlock, errors);

  const definition = {
    pattern_id: patternId,
    name: patternName,
    category,
    status: 'experimental',
    description: 'Conditional composite indicator generated from Blockly composition.',
    author: 'user',
    version: '1.0.0',
    plugin_file: 'plugins/composite_runner.py',
    plugin_function: 'run_composite_plugin',
    pattern_type: patternId,
    artifact_type: 'indicator',
    composition: 'composite',
    indicator_role: intent === 'entry' ? 'entry_composite' : intent === 'exit' ? 'exit_composite' : intent === 'regime' ? 'regime_state' : 'analysis_payload',
    default_structure_config: { swing_method: 'rdp', swing_epsilon_pct: 0.05 },
    default_setup_params: {
      pattern_type: patternId,
      composite_spec: {
        type: 'conditional',
        intent,
        branches: [branch],
      },
    },
    default_entry: {
      entry_type: intent === 'entry' ? 'market_on_close' : intent === 'exit' ? 'exit_signal' : 'analysis_only',
    },
    tunable_params: [],
    suggested_timeframes: ['D', 'W'],
    min_data_bars: 220,
  };
  applyBlocklyFundamentalConfig(definition, errors);
  if (blockStateMachine) {
    definition.default_setup_params.state_machine = blockStateMachine;
  } else {
    applyBlocklyStateMachine(definition, errors);
  }
  if (errors.length) return { errors };
  definition.tunable_params = inferBlocklyTunableParams(definition);

  return { errors: [], definition };
}

function readBlockParamOverrides(block, meta) {
  const params = {};
  const paramKeys = Array.isArray(meta?.param_keys) ? meta.param_keys : [];
  if (!paramKeys.length || !block) return params;

  for (const key of paramKeys) {
    const fieldName = `PARAM_${key}`;
    const field = block.getField(fieldName);
    if (!field) continue;
    let val = field.getValue();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (typeof val === 'string' && val !== '' && !isNaN(Number(val))) val = Number(val);
    params[key] = val;
  }
  return params;
}

function findBlocklyPrimitiveRow(patternId) {
  return blocklyPrimitiveRows.find((row) => String(row?.pattern_id || '').trim() === String(patternId || '').trim()) || null;
}

function inferBlocklyAnatomy(stageLabel, patternId, row) {
  const text = `${stageLabel} ${patternId} ${row?.indicator_role || ''} ${row?.pattern_role || ''}`.toLowerCase();
  if (text.includes('regime') || text.includes('gate') || text.includes('filter') || text.includes('state')) return 'regime_filter';
  if (text.includes('location') || text.includes('fib')) return 'location';
  if (text.includes('timing') || text.includes('trigger') || text.includes('entry') || text.includes('signal') || text.includes('divergence') || text.includes('rsi') || text.includes('cross')) return 'entry_timing';
  return 'structure';
}

function buildBlocklyTunableParam(stageLabel, patternId, paramKey, path, value) {
  const row = findBlocklyPrimitiveRow(patternId);
  const tunable = Array.isArray(row?.tunable_params)
    ? row.tunable_params.find((item) => String(item?.key || '') === String(paramKey))
    : null;
  const safeStage = String(stageLabel || patternId || 'stage').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return {
    key: `${safeStage}_${paramKey}`,
    label: `${stageLabel}: ${String(tunable?.label || paramKey)}`,
    path,
    type: String(tunable?.type || (typeof value === 'number'
      ? (Number.isInteger(value) ? 'int' : 'float')
      : typeof value === 'boolean'
      ? 'bool'
      : 'enum')),
    min: typeof tunable?.min === 'number' ? tunable.min : undefined,
    max: typeof tunable?.max === 'number' ? tunable.max : undefined,
    step: typeof tunable?.step === 'number' ? tunable.step : undefined,
    default: tunable?.default ?? value,
    options: Array.isArray(tunable?.options) ? tunable.options : undefined,
    description: tunable?.description || undefined,
    anatomy: inferBlocklyAnatomy(stageLabel, patternId, row),
    identity_preserving: true,
    sweep_enabled: true,
    sensitivity_enabled: typeof value === 'number',
  };
}

function pushUniqueBlocklyTunableParam(target, param) {
  const key = `${String(param?.key || '').trim()}|${String(param?.path || '').trim()}`;
  if (!key || key === '|') return;
  if (target.some((item) => `${String(item?.key || '').trim()}|${String(item?.path || '').trim()}` === key)) return;
  target.push(param);
}

function collectBlocklyConditionTunables(condition, pathPrefix, target) {
  if (!condition || typeof condition !== 'object') return;

  const pushParams = (primitiveId, params, paramsPath, stageLabel) => {
    if (!primitiveId || !params || typeof params !== 'object' || Array.isArray(params)) return;
    Object.entries(params).forEach(([paramKey, value]) => {
      pushUniqueBlocklyTunableParam(
        target,
        buildBlocklyTunableParam(stageLabel, primitiveId, paramKey, `${paramsPath}.${paramKey}`, value),
      );
    });
  };

  if (condition.type === 'op') {
    collectBlocklyConditionTunables(condition.left, `${pathPrefix}.left`, target);
    collectBlocklyConditionTunables(condition.right, `${pathPrefix}.right`, target);
    collectBlocklyConditionTunables(condition.condition, `${pathPrefix}.condition`, target);
  }

  if (condition.type === 'check' || condition.type === 'score' || condition.type === 'cooldown') {
    pushParams(condition.primitive_id, condition.params, `${pathPrefix}.params`, condition.primitive_id);
  }
  if (condition.type === 'compare') {
    pushParams(condition.primitive_a, condition.params_a, `${pathPrefix}.params_a`, condition.primitive_a);
    pushParams(condition.primitive_b, condition.params_b, `${pathPrefix}.params_b`, condition.primitive_b);
  }
  if (condition.type === 'sequence') {
    pushParams(condition.first_id, condition.params_first, `${pathPrefix}.params_first`, condition.first_id);
    pushParams(condition.second_id, condition.params_second, `${pathPrefix}.params_second`, condition.second_id);
  }
  if (condition.type === 'regime') {
    pushParams(condition.regime_id, condition.params_regime, `${pathPrefix}.params_regime`, condition.regime_id);
    pushParams(condition.signal_id, condition.params_signal, `${pathPrefix}.params_signal`, condition.signal_id);
  }
}

function inferBlocklyTunableParams(definition) {
  const tunables = [];
  const spec = definition?.default_setup_params?.composite_spec;
  if (!spec || typeof spec !== 'object') return tunables;

  const stages = Array.isArray(spec.stages) ? spec.stages : [];
  stages.forEach((stage, idx) => {
    const params = stage?.params && typeof stage.params === 'object' && !Array.isArray(stage.params) ? stage.params : null;
    if (!params) return;
    const stageLabel = String(stage?.id || stage?.pattern_id || `stage_${idx}`);
    Object.entries(params).forEach(([paramKey, value]) => {
      pushUniqueBlocklyTunableParam(
        tunables,
        buildBlocklyTunableParam(stageLabel, stage?.pattern_id, paramKey, `setup_config.composite_spec.stages.${idx}.params.${paramKey}`, value),
      );
    });
  });

  const branches = Array.isArray(spec.branches) ? spec.branches : [];
  branches.forEach((branch, idx) => {
    if (branch?.condition) collectBlocklyConditionTunables(branch.condition, `setup_config.composite_spec.branches.${idx}.condition`, tunables);
    ['then', 'else'].forEach((side) => {
      const stage = branch?.[side];
      const params = stage?.params && typeof stage.params === 'object' && !Array.isArray(stage.params) ? stage.params : null;
      if (!stage?.pattern_id || !params) return;
      const stageLabel = `${side}_${stage.pattern_id}`;
      Object.entries(params).forEach(([paramKey, value]) => {
        pushUniqueBlocklyTunableParam(
          tunables,
          buildBlocklyTunableParam(stageLabel, stage.pattern_id, paramKey, `setup_config.composite_spec.branches.${idx}.${side}.params.${paramKey}`, value),
        );
      });
    });
  });

  const stateMachine = definition?.default_setup_params?.state_machine;
  if (stateMachine && typeof stateMachine === 'object' && Number.isFinite(Number(stateMachine.watch_bars))) {
    pushUniqueBlocklyTunableParam(tunables, {
      key: 'watch_bars',
      label: 'State Machine Watch Bars',
      path: 'setup_config.state_machine.watch_bars',
      type: 'int',
      min: 1,
      max: 30,
      step: 1,
      default: Math.floor(Number(stateMachine.watch_bars)),
      description: 'Bars to keep the state machine watch window open after arming.',
      anatomy: 'entry_timing',
      identity_preserving: true,
      sweep_enabled: true,
      sensitivity_enabled: true,
    });
  }

  return tunables;
}

function extractStage(composeBlock, inputName, stageId, required) {
  const connected = composeBlock.getInputTargetBlock(inputName);
  if (!connected) {
    return required ? { error: `Missing required stage: ${stageId}` } : null;
  }

  // Built-in inline blocks (e.g. liquidity_filter) don't use the primitive library
  // so they have no block.data / pattern_id — handle them specially.
  if (connected.type === 'liquidity_filter') {
    const minCap = Number(connected.getFieldValue('MIN_MARKET_CAP_B') || 0);
    const minVol = Number(connected.getFieldValue('MIN_AVG_VOLUME_K') || 0);
    const stage = {
      id: stageId,
      pattern_id: 'liquidity_filter',
      indicator_role: 'regime_state',
      params: { min_market_cap_billions: minCap, min_avg_volume_k: minVol },
    };
    return stage;
  }

  const meta = parsePrimitiveMeta(connected);
  if (!meta?.pattern_id) {
    return { error: `Invalid block connected at ${stageId}.` };
  }
  const params = readBlockParamOverrides(connected, meta);
  const stage = {
    id: stageId,
    pattern_id: String(meta.pattern_id),
    indicator_role: String(meta.indicator_role || '').trim(),
  };
  if (Object.keys(params).length) {
    stage.params = params;
  }
  return stage;
}

function buildCompositeFromWorkspace() {
  const composeBlocks = findComposeBlocks();
  if (!composeBlocks.length) return { errors: ['Add a Compose Indicator or Compose Conditional block.'] };
  if (composeBlocks.length > 1) return { errors: ['Use exactly one Compose block (either Compose Indicator or Compose Conditional).'] };

  const compose = composeBlocks[0];

  // Shared metadata resolution
  const intentEl = document.getElementById('blockly-intent');
  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const categoryInput = document.getElementById('blockly-category');
  const intent = String(intentEl?.value || 'entry').trim().toLowerCase();
  let patternName = String(nameInput?.value || '').trim() || 'New Composite Indicator';
  if (!/composite/i.test(patternName)) patternName += ' Composite';
  let patternId = String(idInput?.value || '').trim();
  if (!patternId) patternId = `${toPatternId(patternName)}_composite`;
  patternId = toPatternId(patternId);
  if (!patternId.endsWith('_composite')) patternId = `${patternId}_composite`;
  const category = String(categoryInput?.value || 'indicator_signals').trim().toLowerCase() || 'indicator_signals';
  if (idInput) idInput.value = patternId;

  // Route to conditional builder
  if (compose.type === 'compose_conditional') {
    return buildConditionalFromBlock(compose, intent, patternId, patternName, category);
  }

  const stages = [];
  const errors = [];

  const structure = extractStage(compose, 'STRUCTURE', 'structure', false);
  const location = extractStage(compose, 'LOCATION', 'location', false);
  const timing = extractStage(compose, 'TIMING', 'timing', false);
  const pattern = extractStage(compose, 'PATTERN', 'pattern_gate', false);
  const stateMachineBlock = compose.getInputTargetBlock('STATE_MACHINE');
  const blockStateMachine = buildStateMachineConfigFromBlock(stateMachineBlock, errors);

  [structure, location, timing, pattern].forEach((stage) => {
    if (!stage) return;
    if (stage.error) {
      errors.push(stage.error);
      return;
    }
    stages.push(stage);
  });

  if (!stages.length) errors.push('Connect at least one primitive block.');

  const reducerOp = String(compose.getFieldValue('REDUCER_OP') || 'AND').trim().toUpperCase();
  const reducerN = Number(compose.getFieldValue('REDUCER_N') || 2);
  const reducer = {
    op: reducerOp,
    inputs: stages.map((s) => s.id),
  };
  if (reducerOp === 'N_OF_M') {
    reducer.n = Math.max(1, Math.min(stages.length, Number.isFinite(reducerN) ? Math.floor(reducerN) : 1));
  }

  const definition = {
    pattern_id: patternId,
    name: patternName,
    category,
    description: 'Composite indicator generated from Blockly composition.',
    author: 'user',
    version: '1.0.0',
    plugin_file: 'plugins/composite_runner.py',
    plugin_function: 'run_composite_plugin',
    pattern_type: patternId,
    artifact_type: 'indicator',
    composition: 'composite',
    indicator_role: intent === 'entry' ? 'entry_composite' : intent === 'exit' ? 'exit_composite' : intent === 'regime' ? 'regime_state' : 'analysis_payload',
    default_structure_config: {
      swing_method: 'rdp',
      swing_epsilon_pct: 0.05,
    },
    default_setup_params: {
      pattern_type: patternId,
      composite_spec: {
        intent,
        stages: stages.map((stage) => {
          const entry = { id: stage.id, pattern_id: stage.pattern_id };
          if (stage.params && Object.keys(stage.params).length) {
            entry.params = stage.params;
          }
          return entry;
        }),
        reducer,
      },
    },
    default_entry: {
      entry_type: intent === 'entry' ? 'market_on_close' : intent === 'exit' ? 'exit_signal' : 'analysis_only',
    },
    tunable_params: [],
    suggested_timeframes: ['D', 'W'],
    min_data_bars: 220,
  };
  applyBlocklyFundamentalConfig(definition, errors);
  if (blockStateMachine) {
    definition.default_setup_params.state_machine = blockStateMachine;
  } else {
    applyBlocklyStateMachine(definition, errors);
  }
  if (errors.length) return { errors };
  definition.tunable_params = inferBlocklyTunableParams(definition);

  return { errors: [], definition };
}

function updateCompositionPreview() {
  const preview = document.getElementById('blockly-json-preview');
  if (!preview) return;
  const built = buildCompositeFromWorkspace();
  scheduleBlocklyDraftSave();
  if (built.errors?.length) {
    preview.textContent = `Validation errors:\n- ${built.errors.join('\n- ')}`;
    setBlocklyStatus('Composition incomplete', true);
    return;
  }
  preview.textContent = JSON.stringify(built.definition, null, 2);
  setBlocklyStatus('Composition valid');
}

function clearBlocklyWorkspace() {
  if (!blocklyWorkspace) return;
  const ok = confirm('Clear the workspace? This removes all blocks and resets the metadata fields.');
  if (!ok) return;

  blocklyWorkspace.clear();

  const initialCompose = blocklyWorkspace.newBlock('compose_indicator');
  initialCompose.initSvg();
  initialCompose.render();
  initialCompose.moveBy(40, 40);

  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const categoryInput = document.getElementById('blockly-category');
  const statusBadge = document.getElementById('blockly-status');
  if (nameInput) nameInput.value = '';
  if (idInput) idInput.value = '';
  if (categoryInput) categoryInput.value = 'indicator_signals';
  if (statusBadge) statusBadge.textContent = 'experimental';

  blocklyValidationPassed = false;
  blocklyValidationHash = '';
  hideBlocklyValidationFeedback();
  updateBlocklyRegisterButton();
  updateCompositionPreview();
  clearBlocklyDraft();
  setBlocklyStatus('Workspace cleared');
}

function injectFamilyPickerButton() {
  // Find the Blockly workspace container and prepend a banner button
  // that reads/writes the allowed_families field on any structural_family_signal block.
  const workspaceDiv = document.getElementById('blockly-workspace');
  if (!workspaceDiv) return;
  const workspaceEl = workspaceDiv.parentElement;
  if (!workspaceEl) return;

  const banner = document.createElement('div');
  banner.id = 'family-picker-banner';
  banner.style.cssText = 'display:none;padding:.4rem .75rem;background:rgba(79,70,229,.12);border:1px solid rgba(79,70,229,.35);border-radius:8px;margin-bottom:.5rem;align-items:center;gap:.75rem;font-size:.82rem;';
  banner.innerHTML = `
    <span style="flex:1;font-family:monospace;" id="family-picker-current-label">No family selected (all families)</span>
    <button id="family-picker-open-btn" style="background:var(--color-accent,#4f46e5);border:none;border-radius:6px;color:#fff;padding:.3rem .8rem;cursor:pointer;font-size:.8rem;font-weight:600;">Pick Family…</button>
  `;
  workspaceEl.insertBefore(banner, workspaceDiv);

  document.getElementById('family-picker-open-btn')?.addEventListener('click', () => {
    const currentVal = getFamilyFieldValue();
    openFamilyPicker(currentVal, (sig) => {
      setFamilyFieldValue(sig);
      updateFamilyPickerBanner();
    });
  });

  // Show banner whenever a structural_family_signal block is in the workspace
  if (blocklyWorkspace) {
    blocklyWorkspace.addChangeListener(() => updateFamilyPickerBanner());
  }
}

function getFamilyPickerBanner() { return document.getElementById('family-picker-banner'); }

function updateFamilyPickerBanner() {
  const banner = getFamilyPickerBanner();
  if (!banner) return;
  const block = findFamilySignalBlock();
  if (!block) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  const val = getFamilyFieldValue();
  const label = document.getElementById('family-picker-current-label');
  if (label) {
    label.textContent = val ? `Family: ${val}` : 'No family selected (all families)';
  }
}

function findFamilySignalBlock() {
  const ws = blocklyWorkspace;
  if (!ws) return null;
  return ws.getAllBlocks(false).find((b) => {
    try { return JSON.parse(b.data || '{}').pattern_id === 'structural_family_signal'; } catch { return false; }
  }) || null;
}

function getFamilyFieldValue() {
  const block = findFamilySignalBlock();
  if (!block) return '';
  const field = block.getField('PARAM_allowed_families');
  return field ? String(field.getValue() || '') : '';
}

function setFamilyFieldValue(sig) {
  const block = findFamilySignalBlock();
  if (!block) return;
  const field = block.getField('PARAM_allowed_families');
  if (field) field.setValue(sig || '');
}

function wireActions() {
  const addFundamentalFilterBtn = document.getElementById('btn-blockly-add-fundamental-filter');
  const clearBtn = document.getElementById('btn-blockly-clear');
  const validateBtn = document.getElementById('btn-blockly-validate');
  const copyBtn = document.getElementById('btn-blockly-copy-json');
  const sendBtn = document.getElementById('btn-blockly-send-builder');
  const registerBtn = document.getElementById('btn-blockly-register');
  const loadBtn = document.getElementById('btn-blockly-load-pattern');
  const loadInput = document.getElementById('blockly-load-pattern-id');
  const openPitBtn = document.getElementById('btn-blockly-open-pit');
  const openStateBtn = document.getElementById('btn-blockly-open-state');
  const closeInspectorBtn = document.getElementById('btn-blockly-close-inspector');
  const tabStateBtn = document.getElementById('btn-blockly-inspector-tab-state');
  const tabPitBtn = document.getElementById('btn-blockly-inspector-tab-pit');

  if (addFundamentalFilterBtn) {
    addFundamentalFilterBtn.addEventListener('click', () => {
      addFundamentalFilterBlocklyBlock();
      openBlocklyInspector('pit');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => clearBlocklyWorkspace());
  }

  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      const passed = await validateBlocklyComposition();
      if (passed) {
        setBlocklyStatus('Composition valid — ready to register');
      }
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener('click', () => registerBlocklyComposite());
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      await loadBlocklyPattern(loadInput?.value || '');
    });
  }
  if (loadInput) {
    loadInput.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      await loadBlocklyPattern(loadInput.value || '');
    });
  }

  if (openPitBtn) {
    openPitBtn.addEventListener('click', () => toggleBlocklyInspector('pit'));
  }
  if (openStateBtn) {
    openStateBtn.addEventListener('click', () => toggleBlocklyInspector('state'));
  }
  if (closeInspectorBtn) {
    closeInspectorBtn.addEventListener('click', () => closeBlocklyInspector());
  }
  if (tabStateBtn) {
    tabStateBtn.addEventListener('click', () => openBlocklyInspector('state'));
  }
  if (tabPitBtn) {
    tabPitBtn.addEventListener('click', () => openBlocklyInspector('pit'));
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const built = buildCompositeFromWorkspace();
      if (built.errors?.length) {
        alert(`Cannot copy JSON yet:\n\n- ${built.errors.join('\n- ')}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(JSON.stringify(built.definition, null, 2));
        setBlocklyStatus('Copied JSON to clipboard');
      } catch (error) {
        alert(`Copy failed: ${error.message || 'Unknown error'}`);
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const built = buildCompositeFromWorkspace();
      if (built.errors?.length) {
        alert(`Cannot send to Builder yet:\n\n- ${built.errors.join('\n- ')}`);
        return;
      }
      localStorage.setItem(
        BLOCKLY_COMPOSER_EXPORT_KEY,
        JSON.stringify({
          exported_at: new Date().toISOString(),
          definition: built.definition,
        }),
      );
      persistBlocklyDraftImmediately();
      window.location.href = 'workshop.html?tab=builder';
    });
  }

  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  if (nameInput) nameInput.addEventListener('input', () => { blocklyValidationPassed = false; updateBlocklyRegisterButton(); });
  if (idInput) idInput.addEventListener('input', () => { blocklyValidationPassed = false; updateBlocklyRegisterButton(); });
  window.addEventListener('beforeunload', persistBlocklyDraftImmediately);
  window.addEventListener('pagehide', persistBlocklyDraftImmediately);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistBlocklyDraftImmediately();
    }
  });
}

function renderPrimitiveInventory() {
  const host = document.getElementById('blockly-primitive-list');
  if (!host) return;
  if (!blocklyPrimitiveRows.length) {
    host.innerHTML = '<p class="workshop-test-placeholder">No primitives loaded.</p>';
    return;
  }
  host.innerHTML = blocklyPrimitiveRows
    .map((row) => {
      const socket = getSocketTypeForPrimitive(row).replace('_RESULT', '');
      return `
        <div class="blockly-primitive-item">
          <div class="text-mono">${escapeHtml(row.pattern_id)}</div>
          <div class="text-muted">${escapeHtml(row.name)} • ${escapeHtml(socket)} • ${escapeHtml(row.indicator_role || 'unknown')}</div>
        </div>
      `;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Registration & Validation
// ---------------------------------------------------------------------------

async function computeBlocklyDefinitionHash(definition) {
  const raw = JSON.stringify(definition || {});
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function updateBlocklyRegisterButton() {
  const btn = document.getElementById('btn-blockly-register');
  if (!btn) return;
  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const hasName = String(nameInput?.value || '').trim().length > 0;
  const hasId = String(idInput?.value || '').trim().length > 0;
  const enabled = blocklyValidationPassed && hasName && hasId;
  btn.disabled = !enabled;
  btn.title = !hasName ? 'Enter an indicator name first'
    : !hasId ? 'Indicator ID is missing'
    : !blocklyValidationPassed ? 'Validate your composition first'
    : 'Register this composite indicator';
}

function showBlocklyValidationFeedback(passed, errors) {
  const container = document.getElementById('blockly-validation-feedback');
  if (!container) return;
  container.style.display = 'block';
  if (passed) {
    container.innerHTML = '<span class="workshop-validation-badge workshop-validation-pass">Validation Passed</span>';
  } else {
    const errorList = (errors || []).map(e => `<li>${escapeHtml(typeof e === 'string' ? e : e.message || JSON.stringify(e))}</li>`).join('');
    container.innerHTML = `<span class="workshop-validation-badge workshop-validation-fail">Validation Failed</span><ul class="workshop-rule-list" style="margin-top:6px;">${errorList}</ul>`;
  }
}

function hideBlocklyValidationFeedback() {
  const container = document.getElementById('blockly-validation-feedback');
  if (container) container.style.display = 'none';
}

async function validateBlocklyComposition() {
  const built = buildCompositeFromWorkspace();
  if (built.errors?.length) {
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    showBlocklyValidationFeedback(false, built.errors);
    updateBlocklyRegisterButton();
    return false;
  }

  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  const hasName = String(nameInput?.value || '').trim().length > 0;
  const hasId = String(idInput?.value || '').trim().length > 0;
  if (!hasName || !hasId) {
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    const metaErrors = [];
    if (!hasName) metaErrors.push('Indicator Name is required. Ask the Blockly Assistant to name it, or type one in.');
    if (!hasId) metaErrors.push('Indicator ID is missing.');
    showBlocklyValidationFeedback(false, metaErrors);
    updateBlocklyRegisterButton();
    return false;
  }

  blocklyValidationPassed = true;
  blocklyValidationHash = await computeBlocklyDefinitionHash(built.definition);
  showBlocklyValidationFeedback(true, []);
  updateBlocklyRegisterButton();
  updateCompositionPreview();
  return true;
}

async function registerBlocklyComposite() {
  if (!blocklyValidationPassed) {
    alert('Please validate the composition first.');
    return;
  }

  const built = buildCompositeFromWorkspace();
  if (built.errors?.length) {
    blocklyValidationPassed = false;
    updateBlocklyRegisterButton();
    showBlocklyValidationFeedback(false, built.errors);
    return;
  }

  const currentHash = await computeBlocklyDefinitionHash(built.definition);
  if (currentHash !== blocklyValidationHash) {
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    showBlocklyValidationFeedback(false, ['Composition has changed since last validation. Please re-validate.']);
    return;
  }

  const definition = built.definition;
  const patternId = definition.pattern_id;
  const workspaceState = getBlocklyWorkspaceState();
  if (!workspaceState) {
    showBlocklyValidationFeedback(false, ['Unable to serialize Blockly workspace.']);
    setBlocklyStatus('Workspace serialization failed', true);
    return;
  }
  definition.authoring = {
    source: 'blockly',
    blockly: {
      workspace_state: workspaceState,
      meta: {
        name: definition.name,
        pattern_id: patternId,
        category: definition.category,
        intent: String(document.getElementById('blockly-intent')?.value || 'entry'),
      },
      saved_at: new Date().toISOString(),
    },
  };

  const ok = confirm(`Register composite indicator?\n\n${definition.name} (${patternId})\n\nThis will publish it to the indicator library.`);
  if (!ok) return;

  const statusEl = document.getElementById('blockly-composition-status');
  if (statusEl) {
    statusEl.textContent = 'Registering...';
    statusEl.style.color = '';
  }

  try {
    const thinCode = [
      `"""Composite wrapper for ${patternId} — uses composite_runner.py"""`,
      '',
      'from plugins.composite_runner import run_composite_plugin  # noqa: F401',
      '',
      '',
      `def run_${patternId}_plugin(config, structure, setup_params=None, data=None):`,
      '    """Delegates to the generic composite runner."""',
      '    return run_composite_plugin(config, structure, setup_params=setup_params, data=data)',
      '',
    ].join('\n');

    const res = await fetch('/api/plugins/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: thinCode,
        definition,
        pattern_id: patternId,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data?.success) {
      const validationErrors = Array.isArray(data?.data?.errors) ? data.data.errors : [];
      if (validationErrors.length) {
        showBlocklyValidationFeedback(false, validationErrors.map(e => e.message || JSON.stringify(e)));
      } else {
        showBlocklyValidationFeedback(false, [data?.error || `Registration failed (HTTP ${res.status})`]);
      }
      setBlocklyStatus('Registration failed', true);
      return;
    }

    const assignedId = String(data?.data?.pattern_id || patternId);
    setBlocklyStatus(`Registered: ${assignedId}`);
    showBlocklyValidationFeedback(true, []);

    const feedbackContainer = document.getElementById('blockly-validation-feedback');
    if (feedbackContainer) {
      feedbackContainer.innerHTML = `<span class="workshop-validation-badge workshop-validation-pass">Registered: ${escapeHtml(assignedId)}</span>`;
      feedbackContainer.style.display = 'block';
    }

    const statusBadge = document.getElementById('blockly-status');
    if (statusBadge) statusBadge.textContent = 'registered';
    const loadInput = document.getElementById('blockly-load-pattern-id');
    if (loadInput) loadInput.value = assignedId;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('pattern_id', assignedId);
      window.history.replaceState({}, '', url.toString());
    } catch {}

    blocklyChatMessages.push({
      sender: 'ai',
      text: `Composite indicator "${definition.name}" (${assignedId}) has been registered to the library.`,
    });
    renderBlocklyChat();

  } catch (error) {
    const msg = error?.message || 'Unknown error';
    showBlocklyValidationFeedback(false, [`Registration error: ${msg}`]);
    setBlocklyStatus('Registration error', true);
  }
}

// ---------------------------------------------------------------------------
// AI Metadata Extraction — parse [INDICATOR_NAME: ...] etc. from AI responses
// ---------------------------------------------------------------------------

function extractAndApplyMetadata(aiText) {
  if (!aiText) return;

  const nameMatch = aiText.match(/\[INDICATOR_NAME:\s*(.+?)\]/i);
  const idMatch = aiText.match(/\[INDICATOR_ID:\s*(.+?)\]/i);
  const categoryMatch = aiText.match(/\[CATEGORY:\s*(.+?)\]/i);

  let applied = false;

  if (nameMatch) {
    const nameInput = document.getElementById('blockly-pattern-name');
    if (nameInput) {
      let suggestedName = nameMatch[1].trim();
      if (!/composite/i.test(suggestedName)) suggestedName += ' Composite';
      nameInput.value = suggestedName;
      applied = true;
    }
  }

  if (idMatch) {
    const idInput = document.getElementById('blockly-pattern-id');
    if (idInput) {
      idInput.value = idMatch[1].trim();
      applied = true;
    }
  } else if (nameMatch) {
    const idInput = document.getElementById('blockly-pattern-id');
    if (idInput) {
      let autoId = toPatternId(nameMatch[1].trim());
      if (!autoId.endsWith('_composite')) autoId += '_composite';
      idInput.value = autoId;
      applied = true;
    }
  }

  if (categoryMatch) {
    const catInput = document.getElementById('blockly-category');
    if (catInput) {
      catInput.value = categoryMatch[1].trim();
      applied = true;
    }
  }

  if (applied) {
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    updateCompositionPreview();
  }
}

// ---------------------------------------------------------------------------
// Blockly Assistant Chat
// ---------------------------------------------------------------------------

function initializeBlocklyChat() {
  if (blocklyChatMessages.length === 0) {
    blocklyChatMessages.push({
      sender: 'ai',
      text: 'I am your Blockly Assistant. I can help you compose indicators by wiring primitives together.\n\nDrag primitives from the toolbox on the left and snap them into the Compose Indicator block sockets.',
    });
    blocklyChatMessages.push({
      sender: 'ai',
      text: 'Ask me what each socket type means, which primitives to use, or how the reducer works.',
    });
  }
  renderBlocklyChat();
}

function renderBlocklyChat() {
  const container = document.getElementById('blockly-chat-messages');
  if (!container) return;
  container.innerHTML = blocklyChatMessages
    .map((msg) => {
      const cls = msg.sender === 'ai' ? 'ai' : 'user';
      return `<div class="workshop-chat-bubble ${cls}">${escapeHtml(msg.text)}</div>`;
    })
    .join('');
  container.scrollTop = container.scrollHeight;
  if (typeof notifyPopout === 'function') notifyPopout('blockly-chat-panel');
}

function setBlocklyChatStatus(text) {
  const el = document.getElementById('blockly-chat-status');
  if (el) el.textContent = text;
  if (typeof notifyPopout === 'function') notifyPopout('blockly-chat-panel');
}

function buildBlocklyContext() {
  const chatHistory = blocklyChatMessages
    .slice(-12)
    .map((item) => ({
      sender: item.sender === 'ai' ? 'assistant' : 'user',
      text: String(item.text || '').slice(0, 1200),
    }));

  const built = buildCompositeFromWorkspace();
  const composition = built.errors?.length
    ? { status: 'invalid', errors: built.errors }
    : { status: 'valid', definition: built.definition };

  return {
    page: 'blockly_composer',
    metadata: {
      patternName: String(document.getElementById('blockly-pattern-name')?.value || '').trim(),
      patternId: String(document.getElementById('blockly-pattern-id')?.value || '').trim(),
      category: String(document.getElementById('blockly-category')?.value || '').trim(),
      intent: String(document.getElementById('blockly-intent')?.value || 'entry').trim(),
    },
    currentComposition: composition,
    fundamentalConfig: blocklyFundamentalEditor?.getValue() || null,
    stateMachineConfig: blocklyStateMachineState.enabled ? definitionStateMachinePreview() : null,
    availableFundamentalMetrics: typeof getFundamentalMetricOptions === 'function' ? getFundamentalMetricOptions() : [],
    availablePrimitives: blocklyPrimitiveRows.slice(0, 200),
    chatHistory,
  };
}

function definitionStateMachinePreview() {
  syncBlocklyStateMachineFromDom();
  if (!blocklyStateMachineState.enabled) return null;
  const emitOn = [];
  if (blocklyStateMachineState.emitOnArmed) emitOn.push('armed');
  if (blocklyStateMachineState.emitOnWatching) emitOn.push('watching');
  const watchPrimitive = blocklyStateMachineState.watchPrimitive || blocklyStateMachineState.armPrimitive;
  return {
    initial_phase: 'idle',
    watch_bars: blocklyStateMachineState.watchBars,
    invalidate_on: blocklyStateMachineState.invalidatePrimitive || '',
    emit_on: emitOn,
    transitions: [
      {
        from: 'idle',
        on_primitive: blocklyStateMachineState.armPrimitive,
        to: 'armed',
      },
      {
        from: 'armed',
        on_primitive: watchPrimitive,
        to: 'watching',
      },
    ],
  };
}

async function sendBlocklyChat(prefill) {
  const input = document.getElementById('blockly-chat-input');
  const rawMessage = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  const message = String(rawMessage || '').trim();
  if (!message) return;

  if (input && typeof prefill !== 'string') {
    input.value = '';
  }

  blocklyChatMessages.push({ sender: 'user', text: message });
  renderBlocklyChat();
  setBlocklyChatStatus('Thinking...');

  try {
    const context = buildBlocklyContext();
    const res = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context,
        role: 'blockly_composer',
      }),
    });

    const data = await res.json();
    const aiText = data?.data?.response || data?.response || data?.error || 'No response.';

    extractAndApplyMetadata(aiText);

    blocklyChatMessages.push({ sender: 'ai', text: aiText });
    renderBlocklyChat();
  } catch (error) {
    const msg = error && error.message ? error.message : 'Unknown chat error';
    blocklyChatMessages.push({ sender: 'ai', text: `Error: ${msg}` });
    renderBlocklyChat();
  } finally {
    setBlocklyChatStatus('Ready');
  }
}

function handleBlocklyChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendBlocklyChat();
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

