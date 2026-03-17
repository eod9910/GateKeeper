let blocklyWorkspace = null;
let blocklyPrimitiveRows = [];
let blocklyChatMessages = [];
let blocklyValidationPassed = false;
let blocklyValidationHash = '';
const BLOCKLY_COMPOSER_EXPORT_KEY = 'blockly-composer-export';
const BLOCKLY_TYPE_MAP = {
  anchor_structure: 'STRUCTURE_RESULT',
  location: 'LOCATION_RESULT',
  location_filter: 'LOCATION_RESULT',
  timing_trigger: 'TRIGGER_RESULT',
  trigger: 'TRIGGER_RESULT',
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
  await loadPrimitiveLibrary();
  initializeBlocklyWorkspace();
  wireActions();
  renderPrimitiveInventory();
  updateCompositionPreview();
  initializeBlocklyChat();
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

function getSocketTypeForPrimitive(row) {
  const role = String(row?.indicator_role || '').trim().toLowerCase();
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
      this.setTooltip(`${patternId} • role: ${String(row.indicator_role || 'unknown')}`);
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
        indicator_role: String(row.indicator_role || '').trim(),
        param_keys: paramFields.map((pf) => pf.key),
      });

    },
  };

  return blockType;
}

function getKnownStringOptions(key) {
  const optionMap = {
    ma_type: [['SMA', 'sma'], ['EMA', 'ema'], ['WMA', 'wma'], ['DEMA', 'dema'], ['TEMA', 'tema']],
    cross_direction: [['Bullish', 'bullish'], ['Bearish', 'bearish']],
    swing_method: [['RDP', 'rdp'], ['Major', 'major']],
  };
  return optionMap[key] || [];
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
        description: String(row.description || '').trim(),
        category: String(row.category || 'custom').trim(),
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
    const cat = String(row.category || 'custom').trim().toLowerCase();
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
        contents: buildCategoryContents(group.PATTERN_RESULT, '#8d67c7'),
      },
    ],
  };
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
    blocklyValidationPassed = false;
    blocklyValidationHash = '';
    updateBlocklyRegisterButton();
    hideBlocklyValidationFeedback();
    updateCompositionPreview();

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

  return tunables;
}

function extractStage(composeBlock, inputName, stageId, required) {
  const connected = composeBlock.getInputTargetBlock(inputName);
  if (!connected) {
    return required ? { error: `Missing required stage: ${stageId}` } : null;
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

  const requireAll = intent === 'entry' || intent === 'exit';
  const structure = extractStage(compose, 'STRUCTURE', 'structure', requireAll);
  const location = extractStage(compose, 'LOCATION', 'location', requireAll);
  const timing = extractStage(compose, 'TIMING', 'timing', requireAll);
  const pattern = extractStage(compose, 'PATTERN', 'pattern_gate', false);

  [structure, location, timing, pattern].forEach((stage) => {
    if (!stage) return;
    if (stage.error) {
      errors.push(stage.error);
      return;
    }
    stages.push(stage);
  });

  if (!stages.length) errors.push('Connect at least one primitive block.');
  if (errors.length) return { errors };

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
  definition.tunable_params = inferBlocklyTunableParams(definition);

  return { errors: [], definition };
}

function updateCompositionPreview() {
  const preview = document.getElementById('blockly-json-preview');
  if (!preview) return;
  const built = buildCompositeFromWorkspace();
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
  setBlocklyStatus('Workspace cleared');
}

function wireActions() {
  const clearBtn = document.getElementById('btn-blockly-clear');
  const validateBtn = document.getElementById('btn-blockly-validate');
  const copyBtn = document.getElementById('btn-blockly-copy-json');
  const sendBtn = document.getElementById('btn-blockly-send-builder');
  const registerBtn = document.getElementById('btn-blockly-register');

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
      window.location.href = 'workshop.html?tab=builder';
    });
  }

  const nameInput = document.getElementById('blockly-pattern-name');
  const idInput = document.getElementById('blockly-pattern-id');
  if (nameInput) nameInput.addEventListener('input', () => { blocklyValidationPassed = false; updateBlocklyRegisterButton(); });
  if (idInput) idInput.addEventListener('input', () => { blocklyValidationPassed = false; updateBlocklyRegisterButton(); });
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
}

function setBlocklyChatStatus(text) {
  const el = document.getElementById('blockly-chat-status');
  if (el) el.textContent = text;
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
    availablePrimitives: blocklyPrimitiveRows.slice(0, 200),
    chatHistory,
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
