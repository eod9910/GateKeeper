// =========================================================================
// workshop-composite.js — AI Composite Builder (standalone chat)
// Loaded after workshop-core.js, workshop-builder.js, workshop-scanner.js
// =========================================================================

let _compositeInitialized = false;
let _compositePrimitives = [];
let _compositeChatMessages = [];
let _compositeDefinition = null;
let _compositeDefinitionConfirmed = false;
let _compositeValidationPassed = false;
let _compositeValidationHash = '';

// Role tag constants
const ROLE_LABELS = {
  anchor_structure: { label: 'Structure', cls: 'structure' },
  location:         { label: 'Location',  cls: 'location' },
  location_filter:  { label: 'Location',  cls: 'location' },
  timing_trigger:   { label: 'Trigger',   cls: 'trigger' },
  trigger:          { label: 'Trigger',   cls: 'trigger' },
  context:          { label: 'Context',   cls: 'context' },
  state_filter:     { label: 'Filter',    cls: 'filter' },
  regime_state:     { label: 'Filter',    cls: 'filter' },
  structure_filter: { label: 'Filter',    cls: 'filter' },
};

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

function initCompositeBuilder() {
  if (_compositeInitialized) return;
  _compositeInitialized = true;

  _loadCompositePrimitives();
  _initCompositeChat();
  _renderCompositeJsonPreview();
}

async function _loadCompositePrimitives() {
  try {
    const res = await fetch('/api/plugins/primitives');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data)) throw new Error(data?.error || `HTTP ${res.status}`);

    _compositePrimitives = data.data
      .filter((r) => r && r.pattern_id)
      .map((r) => ({
        pattern_id: String(r.pattern_id || '').trim(),
        name: String(r.name || r.pattern_id || '').trim(),
        indicator_role: String(r.indicator_role || 'unknown').trim(),
        description: String(r.description || '').trim(),
        category: String(r.category || 'custom').trim(),
        tunable_params: Array.isArray(r.tunable_params) ? r.tunable_params : [],
      }))
      .sort((a, b) => a.indicator_role.localeCompare(b.indicator_role) || a.pattern_id.localeCompare(b.pattern_id));
  } catch (err) {
    console.warn('[CompositeBuilder] Failed to load primitives:', err);
    _compositePrimitives = [];
  }

  _renderCompositePrimitivesSidebar();
}

// -------------------------------------------------------------------------
// Primitives sidebar
// -------------------------------------------------------------------------

function _renderCompositePrimitivesSidebar() {
  const container = document.getElementById('composite-ai-primitives-list');
  if (!container) return;

  if (!_compositePrimitives.length) {
    container.innerHTML = '<p class="text-muted" style="padding:8px;font-size:var(--text-caption);">No primitives found.</p>';
    return;
  }

  const grouped = {};
  for (const p of _compositePrimitives) {
    const role = p.indicator_role || 'unknown';
    if (!grouped[role]) grouped[role] = [];
    grouped[role].push(p);
  }

  const roleOrder = ['anchor_structure', 'location', 'location_filter', 'timing_trigger', 'trigger', 'context', 'state_filter', 'regime_state', 'structure_filter'];
  const sortedRoles = Object.keys(grouped).sort((a, b) => {
    const ia = roleOrder.indexOf(a);
    const ib = roleOrder.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  let html = '';
  for (const role of sortedRoles) {
    const info = ROLE_LABELS[role] || { label: role, cls: 'filter' };
    for (const p of grouped[role]) {
      html += `<button class="composite-primitive-chip" onclick="_addPrimitiveToComposite('${_escHtmlAttr(p.pattern_id)}','${_escHtmlAttr(role)}')" title="${_escHtml(p.description || p.name)}">
        <span class="chip-role chip-role--${info.cls}">${_escHtml(info.label)}</span>
        <span>${_escHtml(p.name)}</span>
      </button>`;
    }
  }

  container.innerHTML = html;
}

function _addPrimitiveToComposite(patternId, role) {
  if (!_compositeDefinition) _scaffoldCompositeDefinition();

  const stages = _compositeDefinition.default_setup_params.composite_spec.stages;
  const reducer = _compositeDefinition.default_setup_params.composite_spec.reducer;

  const stageId = _roleToStageId(role, stages);

  if (stages.find((s) => s.pattern_id === patternId)) return;

  stages.push({ id: stageId, pattern_id: patternId });
  if (!reducer.inputs.includes(stageId)) reducer.inputs.push(stageId);

  _renderCompositeStages();
  _renderCompositeJsonPreview();
  _compositeValidationPassed = false;
  _updateCompositeRegisterButton();
}

function _roleToStageId(role, existingStages) {
  const baseMap = {
    anchor_structure: 'structure',
    location: 'location',
    location_filter: 'location',
    timing_trigger: 'timing',
    trigger: 'timing',
    context: 'context',
    state_filter: 'filter',
    regime_state: 'regime',
    structure_filter: 'structure_filter',
  };
  let base = baseMap[role] || role;
  const existing = new Set(existingStages.map((s) => s.id));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// -------------------------------------------------------------------------
// Composite definition scaffolding
// -------------------------------------------------------------------------

function _scaffoldCompositeDefinition() {
  const nameEl = document.getElementById('composite-name');
  const idEl = document.getElementById('composite-id');
  const intentEl = document.getElementById('composite-intent');
  const name = String(nameEl?.value || '').trim() || 'New Composite';
  const patternId = String(idEl?.value || '').trim() || _toCompositeId(name);
  const intent = String(intentEl?.value || 'entry').trim();

  _compositeDefinition = {
    pattern_id: patternId,
    name: name,
    category: 'indicator_signals',
    description: `Composite ${intent} indicator.`,
    author: 'user',
    version: '1.0.0',
    plugin_file: 'plugins/composite_runner.py',
    plugin_function: 'run_composite_plugin',
    pattern_type: patternId,
    chart_indicator: true,
    default_structure_config: { swing_method: 'rdp', swing_epsilon_pct: 0.05 },
    default_setup_params: {
      pattern_type: patternId,
      composite_spec: {
        intent: intent,
        stages: [],
        reducer: { op: 'AND', inputs: [] },
      },
    },
    default_entry: { entry_type: intent === 'exit' ? 'exit_signal' : intent === 'entry' ? 'market_on_close' : 'analysis_only' },
    tunable_params: [],
    suggested_timeframes: ['D', 'W'],
    min_data_bars: 60,
    artifact_type: 'indicator',
    composition: 'composite',
    indicator_role: `${intent}_composite`,
  };
}

function _toCompositeId(name) {
  let id = String(name || 'new_composite').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!id) id = 'new_composite';
  if (!id.endsWith('_composite')) id += '_composite';
  return id;
}

// -------------------------------------------------------------------------
// Metadata inputs
// -------------------------------------------------------------------------

function onCompositeNameInput() {
  const nameEl = document.getElementById('composite-name');
  const idEl = document.getElementById('composite-id');
  const name = String(nameEl?.value || '').trim();
  if (idEl) idEl.value = _toCompositeId(name);

  if (_compositeDefinition) {
    _compositeDefinition.name = name || 'New Composite';
    _compositeDefinition.pattern_id = idEl?.value || _toCompositeId(name);
    _compositeDefinition.pattern_type = _compositeDefinition.pattern_id;
    if (_compositeDefinition.default_setup_params) {
      _compositeDefinition.default_setup_params.pattern_type = _compositeDefinition.pattern_id;
    }
    _renderCompositeJsonPreview();
  }

  _compositeValidationPassed = false;
  _updateCompositeRegisterButton();
}

function onCompositeIntentChange() {
  const intentEl = document.getElementById('composite-intent');
  const intent = String(intentEl?.value || 'entry').trim();

  if (_compositeDefinition) {
    if (_compositeDefinition.default_setup_params?.composite_spec) {
      _compositeDefinition.default_setup_params.composite_spec.intent = intent;
    }
    _compositeDefinition.indicator_role = `${intent}_composite`;
    _compositeDefinition.default_entry = {
      entry_type: intent === 'exit' ? 'exit_signal' : intent === 'entry' ? 'market_on_close' : 'analysis_only',
    };
    _renderCompositeJsonPreview();
  }

  _compositeValidationPassed = false;
  _updateCompositeRegisterButton();
}

// -------------------------------------------------------------------------
// Stages rendering
// -------------------------------------------------------------------------

function _renderCompositeStages() {
  const container = document.getElementById('composite-stages-list');
  if (!container) return;

  const stages = _compositeDefinition?.default_setup_params?.composite_spec?.stages || [];
  if (!stages.length) {
    container.innerHTML = '<p class="text-muted" style="padding:8px;font-size:var(--text-caption);">No stages yet. Chat with the AI or add primitives from the sidebar.</p>';
    return;
  }

  container.innerHTML = stages.map((s, i) => `
    <div class="composite-stage-row">
      <span class="stage-id">${_escHtml(s.id)}</span>
      <span class="stage-pattern">${_escHtml(s.pattern_id)}</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto;padding:2px 6px;font-size:11px;" onclick="_removeCompositeStage(${i})" title="Remove stage">x</button>
    </div>
  `).join('');
}

function _removeCompositeStage(index) {
  if (!_compositeDefinition) return;
  const stages = _compositeDefinition.default_setup_params.composite_spec.stages;
  const reducer = _compositeDefinition.default_setup_params.composite_spec.reducer;
  const removed = stages.splice(index, 1)[0];
  if (removed) {
    const idx = reducer.inputs.indexOf(removed.id);
    if (idx !== -1) reducer.inputs.splice(idx, 1);
  }
  _renderCompositeStages();
  _renderCompositeJsonPreview();
  _compositeValidationPassed = false;
  _updateCompositeRegisterButton();
}

// -------------------------------------------------------------------------
// JSON preview
// -------------------------------------------------------------------------

function _renderCompositeJsonPreview() {
  const el = document.getElementById('composite-json-preview');
  if (!el) return;

  if (_compositeDefinitionConfirmed && _compositeDefinition) {
    const json = JSON.stringify(_compositeDefinition, null, 2);
    el.innerHTML = `<code>${_escHtml(json)}</code>`;
    const details = el.closest('details');
    if (details && !details.open) details.open = true;
  } else {
    const stages = _compositeDefinition?.default_setup_params?.composite_spec?.stages || [];
    if (stages.length) {
      el.innerHTML = `<code class="text-muted">Staged ${stages.length} primitive${stages.length > 1 ? 's' : ''}. Ask the Composite Architect to generate the definition.</code>`;
    } else {
      el.innerHTML = `<code class="text-muted">No definition yet. Add primitives and ask the Composite Architect to build the composite.</code>`;
    }
  }
}

// -------------------------------------------------------------------------
// Validation & Registration
// -------------------------------------------------------------------------

async function validateCompositeDefinition() {
  if (!_compositeDefinition) {
    _showCompositeBadge(false, 'No composite definition to validate.');
    return false;
  }

  const errors = [];
  const def = _compositeDefinition;
  if (!def.pattern_id || !/^[a-z][a-z0-9_]*$/.test(def.pattern_id)) errors.push('Invalid pattern_id (must be lowercase snake_case).');
  if (!def.name || !String(def.name).trim()) errors.push('Name is required.');
  if (!def.pattern_id.endsWith('_composite')) errors.push('pattern_id must end with _composite.');

  const stages = def.default_setup_params?.composite_spec?.stages || [];
  if (!stages.length) errors.push('At least one stage is required.');

  const knownIds = new Set(_compositePrimitives.map((p) => p.pattern_id));
  for (const s of stages) {
    if (!knownIds.has(s.pattern_id)) errors.push(`Stage "${s.id}" references unknown primitive "${s.pattern_id}".`);
  }

  if (errors.length) {
    _showCompositeBadge(false, errors.join(' '));
    _compositeValidationPassed = false;
    _updateCompositeRegisterButton();
    return false;
  }

  _compositeValidationPassed = true;
  _compositeValidationHash = await _computeHash(JSON.stringify(def));
  _showCompositeBadge(true, 'Validation passed');
  _updateCompositeRegisterButton();
  return true;
}

async function registerCompositeDefinition() {
  if (!_compositeValidationPassed || !_compositeDefinition) {
    alert('Please validate the composite first.');
    return;
  }

  const currentHash = await _computeHash(JSON.stringify(_compositeDefinition));
  if (currentHash !== _compositeValidationHash) {
    _compositeValidationPassed = false;
    _showCompositeBadge(false, 'Definition changed since validation. Re-validate.');
    _updateCompositeRegisterButton();
    return;
  }

  const def = _compositeDefinition;
  const patternId = def.pattern_id;

  const ok = confirm(`Register composite indicator?\n\n${def.name} (${patternId})\n\nThis will publish it to the indicator library.`);
  if (!ok) return;

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

  const regBtn = document.getElementById('btn-composite-register');
  if (regBtn) { regBtn.disabled = true; regBtn.textContent = 'Registering...'; }

  try {
    const res = await fetch('/api/plugins/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: thinCode, definition: def, pattern_id: patternId }),
    });

    const data = await res.json();

    if (!res.ok || !data?.success) {
      const validationErrors = Array.isArray(data?.data?.errors) ? data.data.errors : [];
      const msg = validationErrors.length
        ? validationErrors.map((e) => e.message || JSON.stringify(e)).join('\n')
        : (data?.error || `Registration failed (HTTP ${res.status})`);
      _showCompositeBadge(false, msg);
      return;
    }

    const assignedId = String(data?.data?.pattern_id || patternId);
    _showCompositeBadge(true, `Registered: ${assignedId}`);

    _compositeChatMessages.push({ sender: 'ai', text: `Composite indicator "${def.name}" (${assignedId}) has been registered to the library.` });
    _renderCompositeChat();
  } catch (error) {
    _showCompositeBadge(false, `Registration error: ${error?.message || 'Unknown'}`);
  } finally {
    if (regBtn) { regBtn.disabled = false; regBtn.textContent = 'Register Composite'; }
  }
}

function _showCompositeBadge(passed, text) {
  const badge = document.getElementById('composite-validation-badge');
  if (!badge) return;
  badge.style.display = 'inline-block';
  badge.className = passed ? 'workshop-validation-badge workshop-validation-pass' : 'workshop-validation-badge workshop-validation-fail';
  badge.textContent = text;
}

function _updateCompositeRegisterButton() {
  const btn = document.getElementById('btn-composite-register');
  if (!btn) return;
  const nameEl = document.getElementById('composite-name');
  const hasName = String(nameEl?.value || '').trim().length > 0;
  const hasStages = (_compositeDefinition?.default_setup_params?.composite_spec?.stages || []).length > 0;
  btn.disabled = !_compositeValidationPassed || !hasName || !hasStages;
}

async function _computeHash(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return String(Date.now());
  }
}

// -------------------------------------------------------------------------
// Chat
// -------------------------------------------------------------------------

function _initCompositeChat() {
  if (_compositeChatMessages.length === 0) {
    _compositeChatMessages.push({
      sender: 'ai',
      text: 'I am the Composite Architect. I help you wire primitives together into composite indicators.\n\nTell me what kind of composite you want to build (Entry, Exit, Analysis, Regime) and I will recommend the right primitives and generate the JSON definition.',
    });
  }
  _renderCompositeChat();
}

function _renderCompositeChat() {
  const container = document.getElementById('composite-ai-messages');
  if (!container) return;

  container.innerHTML = _compositeChatMessages.map((msg) => {
    if (msg.sender === 'ai') {
      return `<div class="workshop-chat-bubble ai">${_formatAiMessage(msg.text)}</div>`;
    }
    return `<div class="workshop-chat-bubble user">${_escHtml(msg.text)}</div>`;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function _formatAiMessage(text) {
  let escaped = _escHtml(text);
  // Render fenced code blocks
  escaped = escaped.replace(/```(?:json)?\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Render inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Render newlines
  escaped = escaped.replace(/\n/g, '<br>');
  return escaped;
}

async function sendCompositeChat(prefill) {
  const input = document.getElementById('composite-ai-input');
  const rawMessage = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  const message = String(rawMessage || '').trim();
  if (!message) return;

  if (input && typeof prefill !== 'string') input.value = '';

  _compositeChatMessages.push({ sender: 'user', text: message });
  _renderCompositeChat();

  const statusEl = document.getElementById('composite-ai-messages');

  try {
    const context = _buildCompositeContext();

    const res = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context,
        role: 'composite_architect',
      }),
    });

    const data = await res.json();
    const aiText = data?.data?.response || data?.response || data?.error || 'No response.';

    _extractAndApplyCompositeMetadata(aiText);
    const jsonApplied = _extractAndApplyCompositeJson(aiText);

    let displayText = aiText;
    if (jsonApplied) {
      displayText = displayText.replace(/```(?:json)?\s*\n[\s\S]*?```/g, '').trim();
      if (!displayText) displayText = 'Composite definition updated. Check the JSON preview below.';
    }
    displayText = displayText.replace(/\[COMPOSITE_NAME:[^\]]*\]/gi, '').replace(/\[COMPOSITE_ID:[^\]]*\]/gi, '').trim();

    _compositeChatMessages.push({ sender: 'ai', text: displayText });
    _renderCompositeChat();
  } catch (error) {
    const msg = error?.message || 'Unknown chat error';
    _compositeChatMessages.push({ sender: 'ai', text: `Error: ${msg}` });
    _renderCompositeChat();
  }
}

function _buildCompositeContext() {
  const chatHistory = _compositeChatMessages
    .slice(-12)
    .map((m) => ({
      sender: m.sender === 'ai' ? 'assistant' : 'user',
      text: String(m.text || '').slice(0, 1200),
    }));

  const primitiveSummary = _compositePrimitives.map((p) => ({
    pattern_id: p.pattern_id,
    name: p.name,
    indicator_role: p.indicator_role,
    description: p.description ? p.description.slice(0, 200) : '',
  }));

  return {
    page: 'composite_architect',
    metadata: {
      patternName: String(document.getElementById('composite-name')?.value || '').trim(),
      patternId: String(document.getElementById('composite-id')?.value || '').trim(),
      intent: String(document.getElementById('composite-intent')?.value || 'entry').trim(),
    },
    currentDefinition: _compositeDefinition || null,
    availablePrimitives: primitiveSummary,
    chatHistory,
  };
}

// -------------------------------------------------------------------------
// AI response parsing — metadata markers & JSON artifacts
// -------------------------------------------------------------------------

function _extractAndApplyCompositeMetadata(aiText) {
  if (!aiText) return;

  const nameMatch = aiText.match(/\[COMPOSITE_NAME:\s*(.+?)\]/i);
  const idMatch = aiText.match(/\[COMPOSITE_ID:\s*(.+?)\]/i);

  if (nameMatch) {
    const nameEl = document.getElementById('composite-name');
    if (nameEl) {
      let name = nameMatch[1].trim();
      if (!/composite/i.test(name)) name += ' Composite';
      nameEl.value = name;
    }
  }

  if (idMatch) {
    const idEl = document.getElementById('composite-id');
    if (idEl) idEl.value = idMatch[1].trim();
  } else if (nameMatch) {
    const idEl = document.getElementById('composite-id');
    if (idEl) idEl.value = _toCompositeId(nameMatch[1].trim());
  }

  if (nameMatch || idMatch) {
    _compositeValidationPassed = false;
    _updateCompositeRegisterButton();
  }
}

function _extractAndApplyCompositeJson(aiText) {
  if (!aiText) return false;

  const jsonMatches = aiText.match(/```(?:json)?\s*\n([\s\S]*?)```/g);
  if (!jsonMatches) return false;

  for (const block of jsonMatches) {
    const inner = block.replace(/```(?:json)?\s*\n?/, '').replace(/\n?```$/, '').trim();
    try {
      const parsed = JSON.parse(inner);
      if (parsed.pattern_id && parsed.composition === 'composite' && parsed.default_setup_params?.composite_spec) {
        parsed.plugin_file = 'plugins/composite_runner.py';
        parsed.plugin_function = 'run_composite_plugin';
        if (!parsed.pattern_id.endsWith('_composite')) parsed.pattern_id += '_composite';
        parsed.pattern_type = parsed.pattern_id;

        _compositeDefinition = parsed;
        _compositeDefinitionConfirmed = true;

        const nameEl = document.getElementById('composite-name');
        const idEl = document.getElementById('composite-id');
        const intentEl = document.getElementById('composite-intent');
        if (nameEl) nameEl.value = parsed.name || '';
        if (idEl) idEl.value = parsed.pattern_id || '';
        if (intentEl) intentEl.value = parsed.default_setup_params.composite_spec.intent || 'entry';

        _renderCompositeStages();
        _renderCompositeJsonPreview();
        _compositeValidationPassed = false;
        _updateCompositeRegisterButton();
        return true;
      }
    } catch (_) {
      // Not valid JSON — skip
    }
  }
  return false;
}

// -------------------------------------------------------------------------
// Pre-seed from library (called by startCompositeFromPrimitive)
// -------------------------------------------------------------------------

function seedCompositeFromPrimitive(primitiveId, primitiveRole, primitiveName, detail) {
  const compositeId = `composite_${primitiveId}_entry`.replace(/_primitive$/, '').replace(/_primitive_/, '_');
  const compositeName = `${(primitiveName || primitiveId).replace(/ \(Primitive\)$/, '').trim()} Entry (Composite)`;

  _compositeDefinition = {
    pattern_id: compositeId.endsWith('_composite') ? compositeId : compositeId + '_composite',
    name: compositeName,
    category: 'indicator_signals',
    description: `Composite ENTRY indicator built around ${primitiveName || primitiveId}.`,
    author: 'user',
    version: '1.0.0',
    plugin_file: 'plugins/composite_runner.py',
    plugin_function: 'run_composite_plugin',
    pattern_type: compositeId.endsWith('_composite') ? compositeId : compositeId + '_composite',
    chart_indicator: true,
    default_structure_config: { swing_method: 'rdp', swing_epsilon_pct: 0.05 },
    default_setup_params: {
      pattern_type: compositeId.endsWith('_composite') ? compositeId : compositeId + '_composite',
      composite_spec: {
        intent: 'entry',
        stages: [
          { id: primitiveRole === 'anchor_structure' ? 'structure' : (primitiveRole || 'stage_1'), pattern_id: primitiveId },
        ],
        reducer: {
          op: 'AND',
          inputs: [primitiveRole === 'anchor_structure' ? 'structure' : (primitiveRole || 'stage_1')],
        },
      },
    },
    default_entry: { entry_type: 'market_on_close' },
    tunable_params: [],
    suggested_timeframes: detail?.suggested_timeframes || ['D', 'W'],
    min_data_bars: detail?.min_data_bars || 60,
    artifact_type: 'indicator',
    composition: 'composite',
    indicator_role: 'entry_composite',
  };

  // Sync UI
  const nameEl = document.getElementById('composite-name');
  const idEl = document.getElementById('composite-id');
  const intentEl = document.getElementById('composite-intent');
  if (nameEl) nameEl.value = compositeName;
  if (idEl) idEl.value = _compositeDefinition.pattern_id;
  if (intentEl) intentEl.value = 'entry';

  _renderCompositeStages();
  _renderCompositeJsonPreview();
  _compositeValidationPassed = false;
  _updateCompositeRegisterButton();

  // Fire a kickoff chat message
  const kickoff = `I want to build a composite entry indicator using the \`${primitiveId}\` primitive (role: ${primitiveRole || 'unknown'}) as one of the stages.

The template is already loaded. Please:
1. Review the available primitives and recommend the best additional stages (Structure, Location, Trigger) to complete this composite.
2. Generate the final composite JSON definition.

Do NOT write any Python code — composites only need a JSON definition.`;

  _compositeChatMessages = [];
  _initCompositeChat();

  setTimeout(() => sendCompositeChat(kickoff), 200);
}

// -------------------------------------------------------------------------
// Utility
// -------------------------------------------------------------------------

function _escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
