/* Pipeline Composer — LiteGraph.js node-graph editor for DAG composites */

let pipelineGraph = null;
let pipelineCanvas = null;
let pipelinePrimitiveRows = [];
let pipelinePatternRows = [];
let pipelineChatMessages = [];
let pipelineValidationPassed = false;
let pipelineValidationHash = '';

const PORT_TYPE_COLORS = {
  PriceData: '#ffffff',
  SwingStructure: '#5a8bd8',
  ActiveLeg: '#5a8bd8',
  FibLevels: '#4ba864',
  Signal: '#d38e4c',
  EnergyState: '#8d67c7',
  PatternResult: '#8d67c7',
};

const PORT_TYPE_IDS = {};
let nextTypeId = 1;
function getPortTypeId(typeName) {
  if (!PORT_TYPE_IDS[typeName]) {
    PORT_TYPE_IDS[typeName] = nextTypeId++;
  }
  return PORT_TYPE_IDS[typeName];
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  clearDefaultLiteGraphNodes();
  bindPipelineMetaFields();
  await loadPipelinePrimitives();
  await loadPipelinePatterns();
  registerSpecialNodes();
  registerPrimitiveNodes();
  registerPatternNodes();
  initializePipelineGraph();
  wirePipelineActions();
  initializePipelineChat();
});

function clearDefaultLiteGraphNodes() {
  if (typeof LiteGraph === 'undefined') return;
  LiteGraph.registered_node_types = {};
  LiteGraph.searchbox_extras = {};
}

function toPatternId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'new_composite';
}

function findPipelineRow(patternId) {
  return pipelinePrimitiveRows.find((row) => String(row?.pattern_id || '').trim() === String(patternId || '').trim())
    || pipelinePatternRows.find((row) => String(row?.pattern_id || '').trim() === String(patternId || '').trim())
    || null;
}

function inferPipelineAnatomy(stageLabel, patternId, row) {
  const text = `${stageLabel} ${patternId} ${row?.indicator_role || ''} ${row?.pattern_role || ''}`.toLowerCase();
  if (text.includes('regime') || text.includes('gate') || text.includes('filter') || text.includes('state')) return 'regime_filter';
  if (text.includes('location') || text.includes('fib')) return 'location';
  if (text.includes('timing') || text.includes('trigger') || text.includes('entry') || text.includes('signal') || text.includes('divergence') || text.includes('rsi') || text.includes('cross')) return 'entry_timing';
  return 'structure';
}

function inferPipelineTunableParams(nodes) {
  const tunables = [];
  const fingerprints = new Set();
  (Array.isArray(nodes) ? nodes : []).forEach((stage, idx) => {
    const params = stage?.params && typeof stage.params === 'object' && !Array.isArray(stage.params) ? stage.params : null;
    if (!stage?.pattern_id || !params) return;
    const row = findPipelineRow(stage.pattern_id);
    const stageLabel = String(stage?.id || stage?.pattern_id || `node_${idx}`);
    Object.entries(params).forEach(([paramKey, value]) => {
      const tunable = Array.isArray(row?.tunable_params)
        ? row.tunable_params.find((item) => String(item?.key || '') === String(paramKey))
        : null;
      const safeStage = stageLabel.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
      const path = `setup_config.composite_spec.stages.${idx}.params.${paramKey}`;
      const param = {
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
        anatomy: inferPipelineAnatomy(stageLabel, stage.pattern_id, row),
        identity_preserving: true,
        sweep_enabled: true,
        sensitivity_enabled: typeof value === 'number',
      };
      const fingerprint = `${param.key}|${path}`;
      if (!fingerprints.has(fingerprint)) {
        fingerprints.add(fingerprint);
        tunables.push(param);
      }
    });
  });
  return tunables;
}

function bindPipelineMetaFields() {
  const nameInput = document.getElementById('pipeline-pattern-name');
  const idInput = document.getElementById('pipeline-pattern-id');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (idInput) {
        let id = toPatternId(nameInput.value || 'new_composite');
        if (!id.endsWith('_composite')) id += '_composite';
        idInput.value = id;
      }
      pipelineValidationPassed = false;
      updatePipelinePreview();
    });
  }
}

function setPipelineStatus(text, isError) {
  const el = document.getElementById('pipeline-composition-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#ef7f7f' : '';
}

// ---------------------------------------------------------------------------
// Load primitives from API
// ---------------------------------------------------------------------------

async function loadPipelinePrimitives() {
  try {
    const res = await fetch('/api/plugins/primitives');
    const payload = await res.json();
    if (!res.ok || !payload?.success || !Array.isArray(payload?.data)) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    pipelinePrimitiveRows = payload.data
      .filter((r) => r && r.pattern_id)
      .map((r) => ({
        pattern_id: String(r.pattern_id).trim(),
        name: String(r.name || r.pattern_id).trim(),
        indicator_role: String(r.indicator_role || 'unknown').trim(),
        description: String(r.description || '').trim(),
        category: String(r.category || 'custom').trim(),
        tunable_params: Array.isArray(r.tunable_params) ? r.tunable_params : [],
        default_setup_params: r.default_setup_params || {},
        port_inputs: r.port_inputs || { data: 'PriceData' },
        port_outputs: r.port_outputs || { signal: 'Signal' },
      }))
      .sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
    setPipelineStatus(`Loaded ${pipelinePrimitiveRows.length} primitives`);
  } catch (err) {
    pipelinePrimitiveRows = [];
    setPipelineStatus(`Failed to load: ${err.message}`, true);
  }
}

async function loadPipelinePatterns() {
  try {
    const res = await fetch('/api/plugins/patterns');
    const payload = await res.json();
    if (!res.ok || !payload?.success || !Array.isArray(payload?.data)) return;
    pipelinePatternRows = payload.data
      .filter((r) => r && r.pattern_id)
      .map((r) => ({
        pattern_id: String(r.pattern_id).trim(),
        name: String(r.name || r.pattern_id).trim(),
        description: String(r.description || '').trim(),
        category: String(r.category || 'custom').trim(),
        artifact_type: String(r.artifact_type || 'pattern').trim(),
        indicator_role: String(r.indicator_role || '').trim(),
        pattern_role: String(r.pattern_role || '').trim(),
        port_inputs: r.port_inputs || { data: 'PriceData' },
        port_outputs: r.port_outputs || { signal: 'Signal', pattern_result: 'PatternResult' },
      }))
      .sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
  } catch {
    pipelinePatternRows = [];
  }
}

// ---------------------------------------------------------------------------
// Register LiteGraph node types
// ---------------------------------------------------------------------------

function registerSpecialNodes() {
  // Price Input node — root data source
  function PriceInputNode() {
    this.addOutput('ohlcv', getPortTypeId('PriceData'));
    this.title = 'Price Data';
    this.color = '#333';
    this.bgcolor = '#1a1a2e';
    this.size = [180, 50];
  }
  PriceInputNode.title = 'Price Data';
  PriceInputNode.prototype.onExecute = function () {};
  LiteGraph.registerNodeType('special/PriceData', PriceInputNode);

  // Decision node — ALL must pass / ANY can pass / AT LEAST N
  function ReducerNode() {
    this.addInput('signal_1', getPortTypeId('Signal'));
    this.addInput('signal_2', getPortTypeId('Signal'));
    this.addInput('signal_3', getPortTypeId('Signal'));
    this.addInput('signal_4', getPortTypeId('Signal'));
    this.addOutput('verdict', getPortTypeId('Signal'));
    this.addProperty('op', 'AND');
    this.addProperty('n', 2);
    this.addWidget('combo', 'Decision', 'ALL must pass', function (v) {}, { values: ['ALL must pass', 'ANY can pass', 'AT LEAST N must pass'] });
    this.addWidget('number', 'N (for AT LEAST N)', 2, function (v) {}, { min: 1, max: 10, step: 1 });
    this.title = 'Decision';
    this.color = '#444';
    this.bgcolor = '#2a1a2e';
    this.size = [220, 160];
  }
  ReducerNode.title = 'Decision';
  ReducerNode.prototype.onExecute = function () {};
  LiteGraph.registerNodeType('special/Reducer', ReducerNode);

  // Reroute node — tiny pass-through dot for redirecting wires
  function RerouteNode() {
    this.addInput('', -1);
    this.addOutput('', -1);
    this.size = [30, 14];
    this.color = '#555';
    this.bgcolor = '#333';
    this.flags = { collapse_on_title: true };
    this.properties = {};
  }
  RerouteNode.title = '';
  RerouteNode.collapsable = false;

  RerouteNode.prototype.onExecute = function () {
    this.setOutputData(0, this.getInputData(0));
  };

  RerouteNode.prototype.onConnectInput = function (inputIndex, outputType, outputSlot, outputNode, outputIndex) {
    if (this.inputs[0]) this.inputs[0].type = outputType;
    if (this.outputs[0]) this.outputs[0].type = outputType;
    return true;
  };

  RerouteNode.prototype.onConnectionsChange = function () {
    if (!this.inputs[0] || !this.inputs[0].link) {
      if (this.inputs[0]) this.inputs[0].type = -1;
      if (this.outputs[0]) this.outputs[0].type = -1;
    }
  };

  RerouteNode.prototype.onDrawForeground = function (ctx) {
    ctx.fillStyle = '#aaa';
    ctx.beginPath();
    ctx.arc(this.size[0] * 0.5, this.size[1] * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();
  };

  LiteGraph.registerNodeType('special/Reroute', RerouteNode);
}

function registerPrimitiveNodes() {
  pipelinePrimitiveRows.forEach((row) => {
    const patternId = row.pattern_id;
    const nodeTypeName = `primitives/${patternId}`;

    function PrimitiveNode() {
      const inputs = row.port_inputs || {};
      const outputs = row.port_outputs || {};

      for (const [portName, portType] of Object.entries(inputs)) {
        this.addInput(portName, getPortTypeId(portType));
      }
      for (const [portName, portType] of Object.entries(outputs)) {
        this.addOutput(portName, getPortTypeId(portType));
      }

      const params = row.tunable_params || [];
      for (const p of params) {
        const key = p.key || '';
        const label = p.label || key;
        const type = String(p.type || 'float').toLowerCase();
        const defaultVal = p.default !== undefined ? p.default : (row.default_setup_params || {})[key];

        if (type === 'bool' || type === 'boolean') {
          this.addWidget('toggle', label, defaultVal === true, function () {});
        } else if (type === 'enum' && Array.isArray(p.options) && p.options.length) {
          this.addWidget('combo', label, String(defaultVal || p.options[0]), function () {}, { values: p.options });
        } else if (type === 'int' || type === 'float' || type === 'number') {
          const opts = {};
          if (p.min !== undefined) opts.min = p.min;
          if (p.max !== undefined) opts.max = p.max;
          opts.step = type === 'int' ? 1 : 0.01;
          this.addWidget('number', label, Number(defaultVal) || 0, function () {}, opts);
        } else {
          this.addWidget('text', label, String(defaultVal || ''), function () {});
        }
      }

      this.title = row.name || patternId;
      this.color = '#333';

      const role = row.indicator_role || '';
      if (role.includes('structure') || role.includes('anchor')) {
        this.bgcolor = '#1a2a3e';
      } else if (role.includes('location')) {
        this.bgcolor = '#1a3e2a';
      } else if (role.includes('trigger') || role.includes('timing')) {
        this.bgcolor = '#3e2a1a';
      } else {
        this.bgcolor = '#2a1a3e';
      }

      this.size = [220, Math.max(80, 40 + Object.keys(inputs).length * 20 + Object.keys(outputs).length * 20 + params.length * 26)];

      this.properties = {
        pattern_id: patternId,
        indicator_role: row.indicator_role,
      };
    }

    PrimitiveNode.title = row.name || patternId;
    PrimitiveNode.desc = row.description || '';
    PrimitiveNode.prototype.onExecute = function () {};

    LiteGraph.registerNodeType(nodeTypeName, PrimitiveNode);
  });
}

function registerPatternNodes() {
  pipelinePatternRows.forEach((row) => {
    const patternId = row.pattern_id;
    const nodeTypeName = 'patterns/' + patternId;

    const inputs = row.port_inputs || { data: 'PriceData' };
    const outputs = row.port_outputs || { signal: 'Signal', pattern_result: 'PatternResult' };

    function PatternNode() {
      for (const [portName, portType] of Object.entries(inputs)) {
        this.addInput(portName, getPortTypeId(portType));
      }
      for (const [portName, portType] of Object.entries(outputs)) {
        this.addOutput(portName, getPortTypeId(portType));
      }

      this.title = row.name || patternId;
      this.color = '#444';

      const role = row.pattern_role || row.indicator_role || '';
      if (role.includes('pipeline')) {
        this.bgcolor = '#2e3a1a';
      } else if (role.includes('phase') || role.includes('structure')) {
        this.bgcolor = '#3a1a2e';
      } else {
        this.bgcolor = '#1a2e3a';
      }

      this.size = [220, Math.max(80, 40 + Object.keys(inputs).length * 20 + Object.keys(outputs).length * 20)];

      this.properties = {
        pattern_id: patternId,
        artifact_type: row.artifact_type,
        composition: row.composition || 'composite',
        pattern_role: row.pattern_role,
        indicator_role: row.indicator_role,
      };
    }

    PatternNode.title = row.name || patternId;
    PatternNode.desc = row.description || '';
    PatternNode.prototype.onExecute = function () {};

    LiteGraph.registerNodeType(nodeTypeName, PatternNode);
  });
}

// ---------------------------------------------------------------------------
// Initialize the LiteGraph canvas
// ---------------------------------------------------------------------------

function initializePipelineGraph() {
  const canvasEl = document.getElementById('pipeline-canvas');
  if (!canvasEl) return;

  const container = canvasEl.parentElement;
  canvasEl.width = container.clientWidth || 900;
  canvasEl.height = 600;

  pipelineGraph = new LGraph();
  pipelineCanvas = new LGraphCanvas('#pipeline-canvas', pipelineGraph);

  pipelineCanvas.background_image = null;
  pipelineCanvas.clear_background_color = '#24262e';
  pipelineCanvas.render_connections_border = false;
  pipelineCanvas.default_link_color = '#888';

  // Register port type colors
  for (const [typeName, color] of Object.entries(PORT_TYPE_COLORS)) {
    const typeId = getPortTypeId(typeName);
    LiteGraph.registered_slot_out_types[typeName] = { color };
    LiteGraph.registered_slot_in_types[typeName] = { color };
  }

  // Add default Price Data node
  const priceNode = LiteGraph.createNode('special/PriceData');
  priceNode.pos = [50, 200];
  pipelineGraph.add(priceNode);

  // Add default Reducer node
  const reducerNode = LiteGraph.createNode('special/Reducer');
  reducerNode.pos = [700, 200];
  pipelineGraph.add(reducerNode);

  pipelineGraph.onAfterChange = function () {
    pipelineValidationPassed = false;
    pipelineValidationHash = '';
    updatePipelineRegisterButton();
    updatePipelinePreview();
  };

  pipelineGraph.start();

  window.addEventListener('resize', () => {
    if (canvasEl && container) {
      canvasEl.width = container.clientWidth || 900;
      canvasEl.height = 600;
      if (pipelineCanvas) pipelineCanvas.resize();
    }
  });

  setPipelineStatus('Ready — right-click to add nodes');
}

// ---------------------------------------------------------------------------
// Auto-build graph from AI-generated spec
// ---------------------------------------------------------------------------

function buildGraphFromSpec(spec) {
  if (!pipelineGraph || !spec) return { ok: false, error: 'No graph or spec.' };

  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const reducer = spec.reducer || { op: 'AND' };
  const metadata = spec.metadata || {};

  if (!nodes.length) return { ok: false, error: 'Spec has no nodes.' };

  pipelineGraph.clear();

  const LAYOUT_X_START = 50;
  const LAYOUT_Y_START = 80;
  const COL_WIDTH = 280;
  const ROW_HEIGHT = 160;

  const priceNode = LiteGraph.createNode('special/PriceData');
  priceNode.pos = [LAYOUT_X_START, LAYOUT_Y_START + 100];
  pipelineGraph.add(priceNode);

  const createdNodes = {};
  const nodeOrder = [];

  const depthMap = {};
  const childMap = {};
  nodes.forEach((n) => { depthMap[n.id] = 0; childMap[n.id] = []; });
  edges.forEach((e) => {
    if (childMap[e.from]) childMap[e.from].push(e.to);
  });

  function calcDepth(id, visited) {
    if (visited.has(id)) return depthMap[id] || 0;
    visited.add(id);
    const children = childMap[id] || [];
    for (const c of children) {
      depthMap[c] = Math.max(depthMap[c] || 0, (depthMap[id] || 0) + 1);
      calcDepth(c, visited);
    }
    return depthMap[id];
  }
  nodes.forEach((n) => calcDepth(n.id, new Set()));

  const depthGroups = {};
  nodes.forEach((n) => {
    const d = depthMap[n.id] || 0;
    if (!depthGroups[d]) depthGroups[d] = [];
    depthGroups[d].push(n);
  });

  const sortedDepths = Object.keys(depthGroups).map(Number).sort((a, b) => a - b);

  sortedDepths.forEach((depth) => {
    const group = depthGroups[depth];
    const col = depth + 1;
    group.forEach((nodeDef, rowIdx) => {
      const patternId = nodeDef.pattern_id;

      let nodeTypeName = `primitives/${patternId}`;
      if (!LiteGraph.registered_node_types[nodeTypeName]) {
        nodeTypeName = `patterns/${patternId}`;
      }
      if (!LiteGraph.registered_node_types[nodeTypeName]) {
        console.warn(`[buildGraphFromSpec] No registered node type for: ${patternId}`);
        return;
      }

      const lgNode = LiteGraph.createNode(nodeTypeName);
      if (!lgNode) return;

      const yOffset = group.length > 1 ? (rowIdx - (group.length - 1) / 2) * ROW_HEIGHT : 0;
      lgNode.pos = [
        LAYOUT_X_START + col * COL_WIDTH,
        LAYOUT_Y_START + 100 + yOffset,
      ];

      const params = nodeDef.params || {};
      const row = pipelinePrimitiveRows.find((r) => r.pattern_id === patternId)
        || pipelinePatternRows.find((r) => r.pattern_id === patternId);

      if (row && row.tunable_params && lgNode.widgets) {
        row.tunable_params.forEach((tp, widgetIdx) => {
          if (params[tp.key] !== undefined && widgetIdx < lgNode.widgets.length) {
            const widget = lgNode.widgets[widgetIdx];
            let val = params[tp.key];
            const pType = String(tp.type || '').toLowerCase();
            if (pType === 'int' || pType === 'float' || pType === 'number') {
              val = Number(val);
            } else if (pType === 'bool' || pType === 'boolean') {
              val = val === true || val === 'true';
            } else {
              val = String(val);
            }
            widget.value = val;
          }
        });
      }

      pipelineGraph.add(lgNode);
      createdNodes[nodeDef.id] = lgNode;
      nodeOrder.push(nodeDef.id);
    });
  });

  const maxDepth = sortedDepths.length ? sortedDepths[sortedDepths.length - 1] : 0;
  const reducerNode = LiteGraph.createNode('special/Reducer');
  reducerNode.pos = [
    LAYOUT_X_START + (maxDepth + 2) * COL_WIDTH,
    LAYOUT_Y_START + 100,
  ];

  if (reducerNode.widgets && reducerNode.widgets.length >= 1) {
    const opLabel = { AND: 'ALL must pass', OR: 'ANY can pass', N_OF_M: 'AT LEAST N must pass' };
    reducerNode.widgets[0].value = opLabel[String(reducer.op || 'AND').toUpperCase()] || 'ALL must pass';
  }
  if (reducer.op === 'N_OF_M' && reducerNode.widgets && reducerNode.widgets.length >= 2) {
    reducerNode.widgets[1].value = Number(reducer.n || 2);
  }
  pipelineGraph.add(reducerNode);

  // Auto-wire Price Data to every primitive that has a "data" input port
  for (const nodeId of nodeOrder) {
    const lgNode = createdNodes[nodeId];
    if (!lgNode || !lgNode.inputs) continue;
    for (let i = 0; i < lgNode.inputs.length; i++) {
      if (lgNode.inputs[i].name === 'data') {
        priceNode.connect(0, lgNode, i);
        break;
      }
    }
  }

  // Wire explicit edges (WIRES from spec)
  for (const edge of edges) {
    const srcNode = createdNodes[edge.from];
    const dstNode = createdNodes[edge.to];
    if (!srcNode || !dstNode) continue;

    let srcSlot = -1;
    if (srcNode.outputs) {
      for (let i = 0; i < srcNode.outputs.length; i++) {
        if (srcNode.outputs[i].name === edge.from_port) { srcSlot = i; break; }
      }
    }
    let dstSlot = -1;
    if (dstNode.inputs) {
      for (let i = 0; i < dstNode.inputs.length; i++) {
        if (dstNode.inputs[i].name === edge.to_port) { dstSlot = i; break; }
      }
    }

    if (srcSlot >= 0 && dstSlot >= 0) {
      srcNode.connect(srcSlot, dstNode, dstSlot);
    }
  }

  // Auto-wire all signal outputs to the Decision node
  const signalNodes = [];
  for (const nodeId of nodeOrder) {
    const lgNode = createdNodes[nodeId];
    if (!lgNode || !lgNode.outputs) continue;
    for (let i = 0; i < lgNode.outputs.length; i++) {
      if (lgNode.outputs[i].name === 'signal') {
        signalNodes.push({ node: lgNode, slot: i });
        break;
      }
    }
  }

  let reducerSlot = 0;
  for (const sn of signalNodes) {
    if (reducerSlot < 4) {
      sn.node.connect(sn.slot, reducerNode, reducerSlot);
      reducerSlot++;
    }
  }

  if (metadata.name) {
    const nameEl = document.getElementById('pipeline-pattern-name');
    if (nameEl) {
      let name = metadata.name;
      if (!/composite/i.test(name)) name += ' Composite';
      nameEl.value = name;
    }
  }
  if (metadata.id || metadata.name) {
    const idEl = document.getElementById('pipeline-pattern-id');
    if (idEl) {
      let id = toPatternId(metadata.id || metadata.name);
      if (!id.endsWith('_composite')) id += '_composite';
      idEl.value = id;
    }
  }
  if (metadata.category) {
    const catEl = document.getElementById('pipeline-category');
    if (catEl) catEl.value = metadata.category;
  }
  if (metadata.intent) {
    const intentEl = document.getElementById('pipeline-intent');
    if (intentEl) intentEl.value = metadata.intent;
  }

  updatePipelinePreview();
  setPipelineStatus(`Auto-built pipeline: ${nodes.length} nodes, ${edges.length} edges`);
  pipelineCanvas?.setDirty(true, true);

  return { ok: true, nodeCount: nodes.length, edgeCount: edges.length };
}

function extractAndBuildPipeline(aiText) {
  if (!aiText) return false;

  const specMatch = aiText.match(/\[PIPELINE_SPEC:\s*([\s\S]*?)\]/);
  if (!specMatch) return false;

  try {
    const spec = JSON.parse(specMatch[1].trim());
    const result = buildGraphFromSpec(spec);
    if (result.ok) {
      pipelineChatMessages.push({
        sender: 'ai',
        text: `Pipeline auto-built on canvas: ${result.nodeCount} nodes, ${result.edgeCount} edges wired. Review the graph and adjust parameters as needed.`,
      });
      renderPipelineChat();
      return true;
    } else {
      pipelineChatMessages.push({
        sender: 'ai',
        text: `Could not auto-build: ${result.error}`,
      });
      renderPipelineChat();
      return false;
    }
  } catch (err) {
    console.warn('[extractAndBuildPipeline] Failed to parse spec:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Export graph to pipeline spec
// ---------------------------------------------------------------------------

function buildPipelineSpec() {
  if (!pipelineGraph) return { errors: ['Graph not initialized.'] };

  const allNodes = pipelineGraph.serialize().nodes || [];
  const allLinks = pipelineGraph.serialize().links || [];
  const errors = [];

  const workNodes = [];
  let reducerNode = null;
  let priceNode = null;

  for (const n of allNodes) {
    if (n.type === 'special/PriceData') {
      priceNode = n;
    } else if (n.type === 'special/Reducer') {
      reducerNode = n;
    } else if (n.type.startsWith('primitives/') || n.type.startsWith('patterns/')) {
      workNodes.push(n);
    }
  }

  if (!priceNode) errors.push('Add a Price Data node (right-click → special → PriceData).');
  if (!reducerNode) errors.push('Add a Decision node (right-click → special → Decision).');
  if (!workNodes.length) errors.push('Add at least one primitive or pattern node.');

  if (errors.length) return { errors };

  const nodeIdToStageId = {};
  const nodes = [];

  workNodes.forEach((n, idx) => {
    const patternId = (n.properties || {}).pattern_id ||
      n.type.replace('primitives/', '').replace('patterns/', '');
    const stageId = `node_${idx}`;
    nodeIdToStageId[n.id] = stageId;

    const params = {};
    if (n.widgets_values && Array.isArray(n.widgets_values)) {
      const row = pipelinePrimitiveRows.find((r) => r.pattern_id === patternId);
      if (row && row.tunable_params) {
        row.tunable_params.forEach((tp, wi) => {
          if (wi < n.widgets_values.length) {
            params[tp.key] = n.widgets_values[wi];
          }
        });
      }
    }

    const nodeSpec = { id: stageId, pattern_id: patternId, params };
    if (n.type.startsWith('patterns/')) {
      nodeSpec.node_type = 'pattern';
    }
    nodes.push(nodeSpec);
  });

  const edges = [];
  const nodeById = {};
  allNodes.forEach((n) => { nodeById[n.id] = n; });

  // Build link lookup for tracing through reroute nodes
  const linkById = {};
  for (const link of allLinks) {
    if (link && link.length >= 6) linkById[link[0]] = link;
  }

  function traceOutputThroughReroutes(nodeId, slot, visited) {
    if (!visited) visited = new Set();
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);
    const results = [];
    for (const link of allLinks) {
      if (!link || link.length < 6) continue;
      if (link[1] !== nodeId) continue;
      const dstNode = nodeById[link[3]];
      if (!dstNode) continue;
      if (dstNode.type === 'special/Reroute') {
        results.push(...traceOutputThroughReroutes(link[3], 0, visited));
      } else {
        results.push({ nodeId: link[3], slot: link[4] });
      }
    }
    return results;
  }

  function traceInputThroughReroutes(nodeId, slot, visited) {
    if (!visited) visited = new Set();
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    const node = nodeById[nodeId];
    if (!node || !node.inputs) return null;
    const input = node.inputs[slot];
    if (!input || !input.link) return null;
    const link = linkById[input.link];
    if (!link) return null;
    const srcNode = nodeById[link[1]];
    if (!srcNode) return null;
    if (srcNode.type === 'special/Reroute') {
      return traceInputThroughReroutes(link[1], 0, visited);
    }
    return { nodeId: link[1], slot: link[2] };
  }

  // Collect edges between primitives/patterns, tracing through reroutes
  const isWorkNode = (n) => n && (n.type.startsWith('primitives/') || n.type.startsWith('patterns/'));
  const edgeSet = new Set();

  for (const link of allLinks) {
    if (!link || link.length < 6) continue;
    const [linkId, srcNodeId, srcSlot, dstNodeId, dstSlot, linkType] = link;
    const srcNode = nodeById[srcNodeId];
    const dstNode = nodeById[dstNodeId];
    if (!srcNode || !dstNode) continue;
    if (srcNode.type === 'special/PriceData' || dstNode.type === 'special/Reducer') continue;

    let realSrc = isWorkNode(srcNode) ? { nodeId: srcNodeId, slot: srcSlot } : null;
    let realDsts = [];

    if (srcNode.type === 'special/Reroute') continue;

    if (isWorkNode(srcNode) && dstNode.type === 'special/Reroute') {
      realDsts = traceOutputThroughReroutes(dstNodeId, 0, new Set());
    } else if (isWorkNode(srcNode) && isWorkNode(dstNode)) {
      realDsts = [{ nodeId: dstNodeId, slot: dstSlot }];
    }

    if (!realSrc) continue;

    for (const dst of realDsts) {
      const dNode = nodeById[dst.nodeId];
      if (!dNode || dNode.type === 'special/Reducer' || dNode.type === 'special/PriceData') continue;
      if (!isWorkNode(dNode)) continue;

      const edgeKey = `${realSrc.nodeId}:${realSrc.slot}->${dst.nodeId}:${dst.slot}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      const sNode = nodeById[realSrc.nodeId];
      const sIsPrim = sNode.type.startsWith('primitives/');
      const dIsPrim = dNode.type.startsWith('primitives/');
      const srcRow = sIsPrim
        ? pipelinePrimitiveRows.find((r) => `primitives/${r.pattern_id}` === sNode.type)
        : pipelinePatternRows.find((r) => `patterns/${r.pattern_id}` === sNode.type);
      const dstRow = dIsPrim
        ? pipelinePrimitiveRows.find((r) => `primitives/${r.pattern_id}` === dNode.type)
        : pipelinePatternRows.find((r) => `patterns/${r.pattern_id}` === dNode.type);
      if (!srcRow || !dstRow) continue;

      const srcOutputNames = Object.keys(srcRow.port_outputs || {});
      const dstInputNames = Object.keys(dstRow.port_inputs || {});
      const fromPort = srcOutputNames[realSrc.slot] || `out_${realSrc.slot}`;
      const toPort = dstInputNames[dst.slot] || `in_${dst.slot}`;

      const fromStageId = nodeIdToStageId[realSrc.nodeId];
      const toStageId = nodeIdToStageId[dst.nodeId];
      if (fromStageId && toStageId) {
        edges.push({ from: fromStageId, from_port: fromPort, to: toStageId, to_port: toPort });
      }
    }
  }

  const rawDecision = String((reducerNode.widgets_values && reducerNode.widgets_values[0]) || 'ALL must pass');
  const reducerN = (reducerNode.widgets_values && reducerNode.widgets_values[1]) || 2;
  let reducerOp = 'AND';
  if (/ANY/i.test(rawDecision)) reducerOp = 'OR';
  else if (/AT LEAST/i.test(rawDecision)) reducerOp = 'N_OF_M';
  const reducer = { op: reducerOp, inputs: nodes.map((n) => n.id) };
  if (reducer.op === 'N_OF_M') reducer.n = Math.max(1, Math.floor(Number(reducerN)));

  const nameInput = document.getElementById('pipeline-pattern-name');
  const idInput = document.getElementById('pipeline-pattern-id');
  const categoryInput = document.getElementById('pipeline-category');
  const intentSelect = document.getElementById('pipeline-intent');
  let patternName = String(nameInput?.value || '').trim() || 'New Pipeline Composite';
  if (!/composite/i.test(patternName)) patternName += ' Composite';
  let patternId = String(idInput?.value || '').trim();
  if (!patternId) patternId = `${toPatternId(patternName)}_composite`;
  patternId = toPatternId(patternId);
  if (!patternId.endsWith('_composite')) patternId = `${patternId}_composite`;
  const category = String(categoryInput?.value || 'indicator_signals').trim().toLowerCase() || 'indicator_signals';
  const intent = String(intentSelect?.value || 'entry').trim().toLowerCase();
  if (idInput) idInput.value = patternId;

  const definition = {
    pattern_id: patternId,
    name: patternName,
    category,
    description: 'Pipeline composite indicator generated from node graph.',
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
        intent,
        mode: 'pipeline',
        stages: nodes,
        edges,
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
  definition.tunable_params = inferPipelineTunableParams(nodes);

  return { errors: [], definition };
}

function updatePipelinePreview() {
  const preview = document.getElementById('pipeline-json-preview');
  if (!preview) return;
  const built = buildPipelineSpec();
  if (built.errors?.length) {
    preview.textContent = `Errors:\n- ${built.errors.join('\n- ')}`;
    return;
  }
  preview.textContent = JSON.stringify(built.definition, null, 2);
}

// ---------------------------------------------------------------------------
// Validation & Registration
// ---------------------------------------------------------------------------

async function computePipelineHash(definition) {
  const raw = JSON.stringify(definition || {});
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function updatePipelineRegisterButton() {
  const btn = document.getElementById('btn-pipeline-register');
  if (!btn) return;
  const nameInput = document.getElementById('pipeline-pattern-name');
  const hasName = String(nameInput?.value || '').trim().length > 0;
  btn.disabled = !(pipelineValidationPassed && hasName);
}

function showPipelineValidationFeedback(passed, errors) {
  const container = document.getElementById('pipeline-validation-feedback');
  if (!container) return;
  container.style.display = 'block';
  if (passed) {
    container.innerHTML = '<span class="workshop-validation-badge workshop-validation-pass">Validation Passed</span>';
  } else {
    const list = (errors || []).map((e) => `<li>${escapeHtml(typeof e === 'string' ? e : e.message || JSON.stringify(e))}</li>`).join('');
    container.innerHTML = `<span class="workshop-validation-badge workshop-validation-fail">Validation Failed</span><ul class="workshop-rule-list" style="margin-top:6px;">${list}</ul>`;
  }
}

async function validatePipeline() {
  const built = buildPipelineSpec();
  if (built.errors?.length) {
    pipelineValidationPassed = false;
    showPipelineValidationFeedback(false, built.errors);
    updatePipelineRegisterButton();
    return false;
  }
  const nameInput = document.getElementById('pipeline-pattern-name');
  if (!String(nameInput?.value || '').trim()) {
    showPipelineValidationFeedback(false, ['Indicator Name is required.']);
    updatePipelineRegisterButton();
    return false;
  }
  pipelineValidationPassed = true;
  pipelineValidationHash = await computePipelineHash(built.definition);
  showPipelineValidationFeedback(true, []);
  updatePipelineRegisterButton();
  setPipelineStatus('Pipeline valid — ready to register');
  return true;
}

async function registerPipeline() {
  if (!pipelineValidationPassed) {
    alert('Please validate the pipeline first.');
    return;
  }
  const built = buildPipelineSpec();
  if (built.errors?.length) {
    pipelineValidationPassed = false;
    showPipelineValidationFeedback(false, built.errors);
    updatePipelineRegisterButton();
    return;
  }

  const currentHash = await computePipelineHash(built.definition);
  if (currentHash !== pipelineValidationHash) {
    pipelineValidationPassed = false;
    showPipelineValidationFeedback(false, ['Pipeline changed since validation. Re-validate.']);
    updatePipelineRegisterButton();
    return;
  }

  const definition = built.definition;
  const patternId = definition.pattern_id;
  const ok = confirm(`Register pipeline composite?\n\n${definition.name} (${patternId})`);
  if (!ok) return;

  setPipelineStatus('Registering...');

  try {
    const thinCode = [
      `"""Pipeline composite wrapper for ${patternId}"""`,
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
      body: JSON.stringify({ code: thinCode, definition, pattern_id: patternId }),
    });
    const data = await res.json();

    if (!res.ok || !data?.success) {
      const valErrors = Array.isArray(data?.data?.errors) ? data.data.errors.map((e) => e.message || JSON.stringify(e)) : [data?.error || 'Registration failed'];
      showPipelineValidationFeedback(false, valErrors);
      setPipelineStatus('Registration failed', true);
      return;
    }

    const assignedId = String(data?.data?.pattern_id || patternId);
    setPipelineStatus(`Registered: ${assignedId}`);
    const container = document.getElementById('pipeline-validation-feedback');
    if (container) {
      container.innerHTML = `<span class="workshop-validation-badge workshop-validation-pass">Registered: ${escapeHtml(assignedId)}</span>`;
      container.style.display = 'block';
    }
    const statusBadge = document.getElementById('pipeline-status');
    if (statusBadge) statusBadge.textContent = 'registered';

    pipelineChatMessages.push({ sender: 'ai', text: `Pipeline indicator "${definition.name}" (${assignedId}) registered.` });
    renderPipelineChat();
  } catch (err) {
    showPipelineValidationFeedback(false, [`Error: ${err.message || 'Unknown'}`]);
    setPipelineStatus('Registration error', true);
  }
}

// ---------------------------------------------------------------------------
// Wire actions
// ---------------------------------------------------------------------------

function wirePipelineActions() {
  const clearBtn = document.getElementById('btn-pipeline-clear');
  const validateBtn = document.getElementById('btn-pipeline-validate');
  const copyBtn = document.getElementById('btn-pipeline-copy-json');
  const registerBtn = document.getElementById('btn-pipeline-register');
  const sendBtn = document.getElementById('btn-pipeline-send-builder');

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!pipelineGraph) return;
      if (!confirm('Clear all nodes?')) return;
      pipelineGraph.clear();
      const priceNode = LiteGraph.createNode('special/PriceData');
      priceNode.pos = [50, 200];
      pipelineGraph.add(priceNode);
      const reducerNode = LiteGraph.createNode('special/Reducer');
      reducerNode.pos = [700, 200];
      pipelineGraph.add(reducerNode);
      const nameInput = document.getElementById('pipeline-pattern-name');
      const idInput = document.getElementById('pipeline-pattern-id');
      if (nameInput) nameInput.value = '';
      if (idInput) idInput.value = '';
      pipelineValidationPassed = false;
      updatePipelineRegisterButton();
      updatePipelinePreview();
      setPipelineStatus('Workspace cleared');
    });
  }

  if (validateBtn) validateBtn.addEventListener('click', validatePipeline);
  if (registerBtn) registerBtn.addEventListener('click', registerPipeline);

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const built = buildPipelineSpec();
      if (built.errors?.length) { alert(built.errors.join('\n')); return; }
      try {
        await navigator.clipboard.writeText(JSON.stringify(built.definition, null, 2));
        setPipelineStatus('Copied JSON');
      } catch (e) { alert('Copy failed'); }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const built = buildPipelineSpec();
      if (built.errors?.length) { alert(built.errors.join('\n')); return; }
      localStorage.setItem('blockly-composer-export', JSON.stringify({ exported_at: new Date().toISOString(), definition: built.definition }));
      window.location.href = 'workshop.html?tab=builder';
    });
  }
}

// ---------------------------------------------------------------------------
// Chat (mirrors Blockly chat, reuses blockly_composer AI role)
// ---------------------------------------------------------------------------

function initializePipelineChat() {
  if (!pipelineChatMessages.length) {
    pipelineChatMessages.push({ sender: 'ai', text: 'I am your Pipeline Assistant. Tell me what strategy you want to build and I will walk you through it step by step.\n\nOnce we agree on the logic, I will give you pseudocode and a wiring diagram you can follow to build the pipeline on the canvas.' });
    pipelineChatMessages.push({ sender: 'ai', text: 'Colored ports indicate data types: blue = Swing/Leg, green = Fib, orange = Signal, purple = Pattern/Energy, white = Price.\n\nRight-click the canvas to add nodes. The Decision node at the end collects all signals and makes the final GO/NO-GO call.' });
  }
  renderPipelineChat();
}

function renderPipelineChat() {
  const container = document.getElementById('pipeline-chat-messages');
  if (!container) return;
  container.innerHTML = pipelineChatMessages.map((msg) => {
    const cls = msg.sender === 'ai' ? 'ai' : 'user';
    return `<div class="workshop-chat-bubble ${cls}">${escapeHtml(msg.text)}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendPipelineChat(prefill) {
  const input = document.getElementById('pipeline-chat-input');
  const message = String(typeof prefill === 'string' ? prefill : (input ? input.value : '')).trim();
  if (!message) return;
  if (input && typeof prefill !== 'string') input.value = '';

  pipelineChatMessages.push({ sender: 'user', text: message });
  renderPipelineChat();
  const statusEl = document.getElementById('pipeline-chat-status');
  if (statusEl) statusEl.textContent = 'Thinking...';

  try {
    const built = buildPipelineSpec();
    const context = {
      page: 'pipeline_composer',
      metadata: {
        patternName: String(document.getElementById('pipeline-pattern-name')?.value || '').trim(),
        patternId: String(document.getElementById('pipeline-pattern-id')?.value || '').trim(),
        category: String(document.getElementById('pipeline-category')?.value || '').trim(),
        intent: String(document.getElementById('pipeline-intent')?.value || 'entry').trim(),
      },
      currentComposition: built.errors?.length ? { status: 'invalid', errors: built.errors } : { status: 'valid', definition: built.definition },
      availablePrimitives: pipelinePrimitiveRows.slice(0, 200),
      chatHistory: pipelineChatMessages.slice(-12).map((m) => ({ sender: m.sender === 'ai' ? 'assistant' : 'user', text: String(m.text || '').slice(0, 1200) })),
    };

    const _pcSettings = (() => { try { return JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) { return {}; } })();
    const res = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context,
        role: 'blockly_composer',
        aiModel: _pcSettings.aiModel,
        pluginEngineerModel: _pcSettings.pluginEngineerModel,
      }),
    });
    const data = await res.json();
    const aiText = data?.data?.response || data?.response || data?.error || 'No response.';

    extractPipelineMetadata(aiText);

    const autoBuild = extractAndBuildPipeline(aiText);

    let displayText = aiText;
    displayText = displayText.replace(/\[PIPELINE_SPEC:\s*[\s\S]*?\]/g, '').trim();
    displayText = displayText.replace(/\[INDICATOR_NAME:\s*.+?\]/gi, '').trim();
    displayText = displayText.replace(/\[INDICATOR_ID:\s*.+?\]/gi, '').trim();
    displayText = displayText.replace(/\[CATEGORY:\s*.+?\]/gi, '').trim();

    pipelineChatMessages.push({ sender: 'ai', text: displayText || 'Pipeline built on canvas.' });
    renderPipelineChat();
  } catch (err) {
    pipelineChatMessages.push({ sender: 'ai', text: `Error: ${err.message || 'Unknown'}` });
    renderPipelineChat();
  } finally {
    if (statusEl) statusEl.textContent = 'Ready';
  }
}

function extractPipelineMetadata(aiText) {
  if (!aiText) return;
  const nameMatch = aiText.match(/\[INDICATOR_NAME:\s*(.+?)\]/i);
  const idMatch = aiText.match(/\[INDICATOR_ID:\s*(.+?)\]/i);
  const categoryMatch = aiText.match(/\[CATEGORY:\s*(.+?)\]/i);

  if (nameMatch) {
    const el = document.getElementById('pipeline-pattern-name');
    let name = nameMatch[1].trim();
    if (!/composite/i.test(name)) name += ' Composite';
    if (el) el.value = name;
  }
  if (idMatch) {
    const el = document.getElementById('pipeline-pattern-id');
    if (el) el.value = idMatch[1].trim();
  } else if (nameMatch) {
    const el = document.getElementById('pipeline-pattern-id');
    if (el) {
      let id = toPatternId(nameMatch[1].trim());
      if (!id.endsWith('_composite')) id += '_composite';
      el.value = id;
    }
  }
  if (categoryMatch) {
    const el = document.getElementById('pipeline-category');
    if (el) el.value = categoryMatch[1].trim();
  }
}

function handlePipelineChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPipelineChat();
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
/* end of pipeline-composer.js */
