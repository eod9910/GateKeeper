// =========================================================================
// workshop-builder.js - Editors, chat, artifact parsing, testing, registration
// Split from workshop.js for maintainability. Load after workshop-core.js.
// =========================================================================

function initMonacoEditors() {
  return new Promise((resolve) => {
    if (typeof window.require !== 'function') {
      resolve(false);
      return;
    }

    window.require.config({
      paths: {
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs',
      },
    });

    window.require(['vs/editor/editor.main'], () => {
      try {
        const codeContainer = document.getElementById('code-editor-container');
        const jsonContainer = document.getElementById('json-editor-container');
        if (!codeContainer || !jsonContainer || !window.monaco) {
          resolve(false);
          return;
        }

        pluginEditor = window.monaco.editor.create(codeContainer, {
          value: DEFAULT_PLUGIN_CODE,
          language: 'python',
          theme: 'vs-dark',
          readOnly: false,
          minimap: { enabled: true },
          fontSize: 13,
          lineNumbers: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        });

        jsonEditor = window.monaco.editor.create(jsonContainer, {
          value: JSON.stringify(DEFAULT_DEFINITION, null, 2),
          language: 'json',
          theme: 'vs-dark',
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        });

        window.pluginEditor = pluginEditor;
        window.pluginJsonEditor = jsonEditor;
        if (typeof pluginEditor.onDidChangeModelContent === 'function') {
          pluginEditor.onDidChangeModelContent(() => scheduleWorkshopLiveValidation());
        }
        if (typeof jsonEditor.onDidChangeModelContent === 'function') {
          jsonEditor.onDidChangeModelContent(() => scheduleWorkshopLiveValidation());
        }
        resolve(true);
      } catch (error) {
        console.error('Monaco init failed:', error);
        resolve(false);
      }
    }, () => resolve(false));
  });
}

function createFallbackEditor(containerId, initialValue, language) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const textarea = document.createElement('textarea');
  textarea.className = 'workshop-fallback-editor';
  textarea.value = initialValue;
  textarea.setAttribute('aria-label', `${language} editor`);
  container.innerHTML = '';
  container.appendChild(textarea);

  return {
    getValue: () => textarea.value,
    setValue: (value) => {
      textarea.value = value;
    },
    onDidChangeModelContent: (handler) => {
      if (typeof handler !== 'function') return { dispose: () => {} };
      const wrapped = () => handler();
      textarea.addEventListener('input', wrapped);
      return {
        dispose: () => textarea.removeEventListener('input', wrapped),
      };
    },
  };
}

function initializeWorkshopChat() {
  if (workshopChatMessages.length === 0) {
    workshopChatMessages.push({
      sender: 'ai',
      text:
        'I am your Plugin Engineer. Describe a pattern or indicator and I can generate plugin code plus a pattern definition.',
    });
    workshopChatMessages.push({
      sender: 'ai',
      text:
        'I can also modify existing plugin code. Ask for edits and I will return full updated artifacts using code markers.',
    });
  }
  renderWorkshopChat();
}

function renderWorkshopChat() {
  const container = document.getElementById('workshop-chat-messages');
  if (!container) return;

  container.innerHTML = workshopChatMessages
    .map((msg) => {
      const displayText = getChatDisplayText(msg);
      return `<div class="workshop-chat-bubble ${msg.sender}">${escapeHtml(displayText)}</div>`;
    })
    .join('');

  container.scrollTop = container.scrollHeight;
}

function getChatDisplayText(msg) {
  const raw = String(msg?.text || '');
  if (msg?.sender !== 'ai') return raw;

  const hasCodeBlock = raw.includes('===PLUGIN_CODE===');
  const hasDefinitionBlock = raw.includes('===PLUGIN_DEFINITION===');
  const hasFenceBlock = /```[\s\S]*```/.test(raw);

  let cleaned = raw
    .replace(/===PLUGIN_CODE===([\s\S]*?)===END_PLUGIN_CODE===/g, '')
    .replace(/===PLUGIN_DEFINITION===([\s\S]*?)===END_PLUGIN_DEFINITION===/g, '')
    .replace(/===PLUGIN_CODE===[\s\S]*$/g, '')
    .replace(/===PLUGIN_DEFINITION===[\s\S]*$/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```[\s\S]*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (hasCodeBlock || hasDefinitionBlock || hasFenceBlock) {
    const status = [];
    if (hasCodeBlock) status.push('code block detected');
    if (hasDefinitionBlock) status.push('definition block detected');
    if (!hasCodeBlock && !hasDefinitionBlock && hasFenceBlock) status.push('fenced code detected');
    const suffix = `[${status.join(' | ')}]`;
    cleaned = cleaned ? `${cleaned}\n\n${suffix}` : suffix;
  }

  return cleaned || 'Ready.';
}

function setWorkshopChatStatus(text) {
  const status = document.getElementById('workshop-chat-status');
  if (status) status.textContent = text;
}

async function sendWorkshopChat(prefill) {
  const input = document.getElementById('workshop-chat-input');
  const rawMessage = typeof prefill === 'string' ? prefill : (input ? input.value : '');
  const message = String(rawMessage || '').trim();
  if (!message) return;

  if (input && typeof prefill !== 'string') {
    input.value = '';
  }

  workshopChatMessages.push({ sender: 'user', text: message });
  renderWorkshopChat();
  setWorkshopChatStatus('Thinking...');

  try {
    await loadAvailablePrimitives();
    const context = buildWorkshopContext();
    const _wsSettings = (() => { try { return JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) { return {}; } })();
    const res = await fetch('/api/vision/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context,
        role: 'plugin_engineer',
        aiModel: _wsSettings.aiModel,
        pluginEngineerModel: _wsSettings.pluginEngineerModel,
      }),
    });

    const data = await res.json();
    const aiText = data?.data?.response || data?.response || data?.error || 'No response.';

    workshopChatMessages.push({ sender: 'ai', text: aiText });
    renderWorkshopChat();
    extractCodeFromResponse(aiText);
  } catch (error) {
    const msg = error && error.message ? error.message : 'Unknown chat error';
    workshopChatMessages.push({ sender: 'ai', text: `Error: ${msg}` });
    renderWorkshopChat();
  } finally {
    setWorkshopChatStatus('Ready');
  }
}

function buildWorkshopContext() {
  const chatHistory = workshopChatMessages
    .slice(-12)
    .map((item) => ({
      sender: item.sender === 'ai' ? 'assistant' : 'user',
      text: String(item.text || '').slice(0, 1200),
    }));

  const rawCode = getEditorValue(pluginEditor) || '';
  const rawDef = getEditorValue(jsonEditor) || '';

  // Only send full code when it's short (freshly AI-generated or actively editing).
  // For large loaded plugins, send only the name/ID — the AI doesn't need all 400+ lines
  // just to know what plugin is in context.
  const CODE_INLINE_LIMIT = 4000;
  const DEF_INLINE_LIMIT = 2000;

  const currentCode = rawCode.length <= CODE_INLINE_LIMIT ? rawCode : null;
  const currentCodeRef = rawCode.length > CODE_INLINE_LIMIT
    ? { truncated: true, chars: rawCode.length, preview: rawCode.slice(0, 300) + '\n# ... (truncated — see plugin name/ID above)' }
    : null;

  const currentDefinition = rawDef.length <= DEF_INLINE_LIMIT ? rawDef : null;
  const currentDefinitionRef = rawDef.length > DEF_INLINE_LIMIT
    ? { truncated: true, chars: rawDef.length, preview: rawDef.slice(0, 400) + '\n// ... (truncated)' }
    : null;

  return {
    page: 'plugin_workshop',
    patternName: getFieldValue('workshop-pattern-name'),
    patternId: getFieldValue('workshop-pattern-id'),
    category: getFieldValue('workshop-category') || 'custom',
    status: getTextContent('workshop-status') || 'experimental',
    currentCode,
    currentCodeRef,
    currentDefinition,
    currentDefinitionRef,
    indicatorLibrary: {
      total: indicatorLibrary.rows.length,
      selectedPatternId: indicatorLibrary.selectedPatternId || null,
      names: indicatorLibrary.rows.slice(0, 50).map((row) => ({
        pattern_id: row.pattern_id,
        name: row.name,
        category: row.category,
      })),
    },
    availablePrimitives: workshopAvailablePrimitives.slice(0, 200),
    lastTestResult: workshopLastTestResult,
    chatHistory,
  };
}

function extractCodeFromResponse(text) {
  if (typeof text !== 'string') return [];

  const artifacts = parseAssistantArtifacts(text);
  workshopGeneratedArtifacts = artifacts;
  if (!artifacts.length) {
    const hasFenceBlock = /```[\s\S]*```/.test(text);
    if (hasFenceBlock) {
      renderTestOutput(
        '<p class="workshop-test-error">Could not parse plugin artifacts from the AI response.</p>' +
        '<p class="workshop-test-placeholder">Ask the AI to return artifacts using exact markers:</p>' +
        '<p class="workshop-test-placeholder"><code>===PLUGIN_CODE=== ... ===END_PLUGIN_CODE===</code></p>' +
        '<p class="workshop-test-placeholder"><code>===PLUGIN_DEFINITION=== ... ===END_PLUGIN_DEFINITION===</code></p>',
      );
    }
    return [];
  }

  const latestWithCode = [...artifacts].reverse().find((artifact) => !!artifact.code) || null;
  const latestWithDefinition = [...artifacts].reverse().find((artifact) => !!artifact.definition || !!artifact.definitionRaw) || null;
  const latestCompositeDefinition = [...artifacts]
    .reverse()
    .find((artifact) => String(artifact.definition?.composition || '').toLowerCase() === 'composite') || null;

  // For multi-artifact replies (primitive + composite), keep code loaded from latest code block
  // but always load the newest definition, preferring the composite definition when present.
  const definitionArtifact = latestCompositeDefinition || latestWithDefinition || latestWithCode || null;
  const codeArtifact = latestWithCode || definitionArtifact || null;

  if (codeArtifact?.code && pluginEditor) {
    pluginEditor.setValue(codeArtifact.code);
  }

  if (definitionArtifact && jsonEditor) {
    if (definitionArtifact.definition) {
      jsonEditor.setValue(JSON.stringify(definitionArtifact.definition, null, 2));
      applyDefinitionToFields(definitionArtifact.definition);
      const jsonSection = document.getElementById('workshop-json-section');
      if (jsonSection) jsonSection.open = true;
    } else if (definitionArtifact.definitionRaw) {
      jsonEditor.setValue(definitionArtifact.definitionRaw);
      const jsonSection = document.getElementById('workshop-json-section');
      if (jsonSection) jsonSection.open = true;
    }
  }

  const activeArtifact = definitionArtifact || codeArtifact || null;

  if (artifacts.length > 1) {
    const primitiveCount = artifacts.filter((a) => String(a.definition?.composition || '').toLowerCase() === 'primitive').length;
    const compositeCount = artifacts.filter((a) => String(a.definition?.composition || '').toLowerCase() === 'composite').length;
    const otherCount = Math.max(0, artifacts.length - primitiveCount - compositeCount);
    const summary = [];
    if (primitiveCount) summary.push(`${primitiveCount} primitive${primitiveCount === 1 ? '' : 's'}`);
    if (compositeCount) summary.push(`${compositeCount} composite${compositeCount === 1 ? '' : 's'}`);
    if (otherCount) summary.push(`${otherCount} other artifact${otherCount === 1 ? '' : 's'}`);
    const activeId = String(activeArtifact?.definition?.pattern_id || activeArtifact?.patternId || '').trim();
    const activeComp = String(activeArtifact?.definition?.composition || '').trim();
    const activeLabel = activeId
      ? `<p class="workshop-test-placeholder">Loaded in editor: <strong>${escapeHtml(activeId)}</strong>${activeComp ? ` (${escapeHtml(activeComp)})` : ''}</p>`
      : '';
    renderTestOutput(
      `<p><strong>Generated:</strong> ${escapeHtml(summary.join(' + ') || `${artifacts.length} artifacts`)}</p>` +
      activeLabel +
      '<p class="workshop-test-placeholder">Use Register Plugin to save all generated artifacts in sequence.</p>',
    );
  }

  currentPluginDraft = {
    code: getEditorValue(pluginEditor),
    definition: tryParseJson(getEditorValue(jsonEditor)),
    name: getFieldValue('workshop-pattern-name'),
    category: getFieldValue('workshop-category'),
    updated_at: new Date().toISOString(),
  };
  loadedBuilderPatternId = '';
  return artifacts;
}

function parseAssistantArtifacts(text) {
  const codeBlocks = extractAllMarkedPayloads(text, '===PLUGIN_CODE===', '===END_PLUGIN_CODE===', ['===PLUGIN_DEFINITION===']);
  const defBlocks = extractAllMarkedPayloads(text, '===PLUGIN_DEFINITION===', '===END_PLUGIN_DEFINITION===', ['===PLUGIN_CODE===']);
  const count = Math.max(codeBlocks.length, defBlocks.length);
  const artifacts = [];

  for (let i = 0; i < count; i += 1) {
    const code = stripMarkdownCodeFences(codeBlocks[i] || '');
    const rawDef = stripMarkdownCodeFences(defBlocks[i] || '');
    let parsedDef = null;
    if (rawDef) {
      try {
        const parseCandidate = extractFirstJsonObject(rawDef) || rawDef;
        parsedDef = JSON.parse(parseCandidate);
      } catch {
        parsedDef = null;
      }
    }

    const patternId = String(parsedDef?.pattern_id || '').trim();
    if (!code && !rawDef) continue;

    artifacts.push({
      index: i,
      patternId,
      code: code || '',
      definitionRaw: rawDef || '',
      definition: parsedDef && typeof parsedDef === 'object' ? parsedDef : null,
    });
  }

  if (artifacts.length > 0) {
    return artifacts;
  }

  // Fallback: tolerate markdown-fenced artifacts when markers are omitted by the model.
  const fencedBlocks = extractFencedCodeBlocks(text);
  if (fencedBlocks.length > 0) {
    fencedBlocks.forEach((block, idx) => {
      const content = stripMarkdownCodeFences(block.content || '');
      if (!content) return;

      let parsedDef = null;
      try {
        const parseCandidate = extractFirstJsonObject(content) || content;
        parsedDef = JSON.parse(parseCandidate);
      } catch {
        parsedDef = null;
      }

      const isDefinition = looksLikePluginDefinition(parsedDef);
      artifacts.push({
        index: idx,
        patternId: String(parsedDef?.pattern_id || '').trim(),
        code: isDefinition ? '' : content,
        definitionRaw: isDefinition ? content : '',
        definition: isDefinition ? parsedDef : null,
      });
    });
  }

  if (artifacts.length > 0) {
    return artifacts;
  }

  // Final fallback: attempt to extract a standalone JSON object from prose.
  const rawJson = extractFirstJsonObject(text);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (looksLikePluginDefinition(parsed)) {
        artifacts.push({
          index: 0,
          patternId: String(parsed?.pattern_id || '').trim(),
          code: '',
          definitionRaw: rawJson,
          definition: parsed,
        });
      }
    } catch {
      // Ignore invalid JSON fallback.
    }
  }

  return artifacts;
}

function extractFencedCodeBlocks(text) {
  const blocks = [];
  if (typeof text !== 'string' || !text) return blocks;

  const regex = /```([a-zA-Z0-9_+-]*)\s*([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: String(match[1] || '').trim().toLowerCase(),
      content: String(match[2] || '').trim(),
    });
  }
  return blocks;
}

function looksLikePluginDefinition(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const hasPatternId = typeof candidate.pattern_id === 'string' && candidate.pattern_id.trim().length > 0;
  const hasPluginFile = typeof candidate.plugin_file === 'string' && candidate.plugin_file.trim().length > 0;
  const hasPluginFn = typeof candidate.plugin_function === 'string' && candidate.plugin_function.trim().length > 0;
  const hasComposition = typeof candidate.composition === 'string' && candidate.composition.trim().length > 0;
  const hasCompositeSpec = !!candidate?.default_setup_params?.composite_spec;
  return hasPatternId && (hasPluginFile || hasPluginFn || hasComposition || hasCompositeSpec);
}

function extractAllMarkedPayloads(text, startMarker, endMarker, stopMarkers) {
  const payloads = [];
  if (typeof text !== 'string' || !text) return payloads;

  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(startMarker, cursor);
    if (start < 0) break;

    const payloadStart = start + startMarker.length;
    let payloadEnd = text.indexOf(endMarker, payloadStart);

    if (payloadEnd < 0) {
      payloadEnd = text.length;
      if (Array.isArray(stopMarkers)) {
        for (const marker of stopMarkers) {
          const markerIndex = text.indexOf(marker, payloadStart);
          if (markerIndex >= 0 && markerIndex < payloadEnd) payloadEnd = markerIndex;
        }
      }
      cursor = payloadEnd;
    } else {
      cursor = payloadEnd + endMarker.length;
    }

    payloads.push(text.slice(payloadStart, payloadEnd).trim());
  }

  return payloads;
}

function stripMarkdownCodeFences(raw) {
  return String(raw || '')
    .trim()
    .replace(/^```(?:[a-zA-Z0-9_+-]+)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
}

function extractFirstJsonObject(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      if (inString) escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return '';
}

function applyDefinitionToFields(definition) {
  if (!definition || typeof definition !== 'object') return;

  const normalizedPatternId = normalizePatternIdForDefinition(
    typeof definition.pattern_id === 'string' ? definition.pattern_id : '',
    definition,
  );
  if (normalizedPatternId && normalizedPatternId !== definition.pattern_id) {
    definition.pattern_id = normalizedPatternId;
    definition.pattern_type = normalizedPatternId;
    definition.plugin_file = `plugins/${normalizedPatternId}.py`;
    definition.plugin_function = `run_${normalizedPatternId}_plugin`;
  }

  if (typeof definition.name === 'string') {
    setFieldValue('workshop-pattern-name', definition.name);
  }

  if (typeof definition.pattern_id === 'string') {
    setFieldValue('workshop-pattern-id', definition.pattern_id);
  }

  if (typeof definition.category === 'string') {
    setFieldValue('workshop-category', definition.category);
  }
  scheduleWorkshopLiveValidation();
}

function handlePatternNameInput() {
  workshopGeneratedArtifacts = [];
  const nameField = WORKSHOP_VALIDATION_FIELDS.name;
  const idField = WORKSHOP_VALIDATION_FIELDS.pattern_id;
  if (nameField) {
    document.getElementById(nameField.inputId)?.classList.remove('workshop-field-invalid');
    const nameErr = document.getElementById(nameField.errorId);
    if (nameErr) nameErr.textContent = '';
  }
  if (idField) {
    document.getElementById(idField.inputId)?.classList.remove('workshop-field-invalid');
    const idErr = document.getElementById(idField.errorId);
    if (idErr) idErr.textContent = '';
  }
  syncPatternIdFromName();
  syncDefinitionMetaFields();
  scheduleWorkshopLiveValidation();
}

function syncPatternIdFromName() {
  // Keep ID stable when editing an indicator loaded from the library.
  if (loadedBuilderPatternId) return;
  const patternName = getFieldValue('workshop-pattern-name') || 'new plugin';
  const patternId = toPatternId(patternName);
  setFieldValue('workshop-pattern-id', patternId);
}

function syncDefinitionMetaFields() {
  const categoryField = WORKSHOP_VALIDATION_FIELDS.category;
  const jsonField = WORKSHOP_VALIDATION_FIELDS.json;
  if (categoryField) {
    document.getElementById(categoryField.inputId)?.classList.remove('workshop-field-invalid');
    const categoryErr = document.getElementById(categoryField.errorId);
    if (categoryErr) categoryErr.textContent = '';
  }
  if (jsonField) {
    document.getElementById(jsonField.inputId)?.classList.remove('workshop-field-invalid');
    const jsonErr = document.getElementById(jsonField.errorId);
    if (jsonErr) jsonErr.textContent = '';
  }

  const parsed = tryParseJson(getEditorValue(jsonEditor));
  if (!parsed) return;

  parsed.pattern_id = normalizePatternIdForDefinition(
    getFieldValue('workshop-pattern-id') || parsed.pattern_id,
    parsed,
  );
  parsed.name = getFieldValue('workshop-pattern-name') || parsed.name;
  parsed.category = getFieldValue('workshop-category') || parsed.category || 'custom';
  parsed.pattern_type = parsed.pattern_id;
  parsed.plugin_file = `plugins/${parsed.pattern_id}.py`;
  parsed.plugin_function = `run_${parsed.pattern_id}_plugin`;

  setFieldValue('workshop-pattern-id', parsed.pattern_id);
  jsonEditor.setValue(JSON.stringify(parsed, null, 2));
  scheduleWorkshopLiveValidation();
}

function getTestPeriodForInterval(interval) {
  const key = String(interval || '').trim().toLowerCase();
  if (key === '5m' || key === '15m') return '60d';
  if (key === '1h' || key === '4h') return '730d';
  if (key === '1wk') return '10y';
  if (key === '1mo') return '20y';
  return '2y';
}

async function testPlugin() {
  clearWorkshopValidationErrors();

  const code = getEditorValue(pluginEditor).trim();

  if (!code) {
    renderWorkshopValidationErrors([{ field: 'code', message: 'Plugin code is empty.' }]);
    renderTestOutput('<p class="workshop-test-error">Plugin code is empty.</p>');
    return;
  }

  syncPatternIdFromName();
  syncDefinitionMetaFields();

  const patternId = getFieldValue('workshop-pattern-id');
  const symbol = getFieldValue('workshop-test-symbol') || 'SPY';
  const interval = getFieldValue('workshop-test-interval') || '1d';
  const period = getTestPeriodForInterval(interval);

  renderTestOutput('<p class="workshop-test-placeholder">Running plugin test...</p>');
  workshopLastTestResult = {
    status: 'running',
    pattern_id: patternId,
    symbol,
    interval,
    at: new Date().toISOString(),
  };

  try {
    let definitionJson = null;
    try { definitionJson = JSON.parse(getEditorValue(jsonEditor).trim()); } catch {}

    const res = await fetch('/api/plugins/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        pattern_id: patternId,
        symbol,
        interval,
        period,
        definition: definitionJson,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      const errorMessage = data?.error || `HTTP ${res.status}`;
      const validationErrors = Array.isArray(data?.data?.errors) ? data.data.errors : [];
      if (validationErrors.length) {
        renderWorkshopValidationErrors(validationErrors, errorMessage);
      }
      const errorSource = String(data?.data?.error_source || '').trim();
      const phase = String(data?.data?.phase || '').trim();
      const tracebackRaw = String(data?.data?.traceback || '');
      const traceback = escapeHtml(tracebackRaw);
      const stderr = escapeHtml(data?.data?.stderr || '');
      const stdout = escapeHtml(data?.data?.stdout || '');
      let header = `Test failed: ${escapeHtml(errorMessage)}`;
      let hint = '';
      if (errorSource === 'plugin_code') {
        header = `Plugin code error (not website/backend): ${escapeHtml(errorMessage)}`;
      } else if (phase === 'plugin_runtime') {
        header = `Plugin runtime error: ${escapeHtml(errorMessage)}`;
      }
      if (/No module named/i.test(String(errorMessage))) {
        hint = 'Hint: this plugin imports a module that is not installed (or is a placeholder). Remove/replace that import in plugin code.';
      } else if (/No plugin function found/i.test(String(errorMessage))) {
        hint = 'Hint: define run_<pattern_id>_plugin or detect_<pattern_id>_plugin in your plugin code.';
      } else if (/Plugin code failed to load/i.test(String(errorMessage))) {
        hint = 'Hint: this is a code-load error in the generated plugin source. The website backend is running.';
      }
      workshopLastTestResult = {
        status: 'failed',
        pattern_id: patternId,
        symbol,
        interval,
        error: String(errorMessage || ''),
        stderr: truncateText(String(data?.data?.stderr || ''), 8000),
        stdout: truncateText(String(data?.data?.stdout || ''), 8000),
        at: new Date().toISOString(),
      };
      renderTestOutput(`
        <p class="workshop-test-error">${header}</p>
        ${hint ? `<p class="workshop-test-placeholder">${escapeHtml(hint)}</p>` : ''}
        ${traceback ? `<pre class="workshop-test-log">${traceback}</pre>` : ''}
        ${stderr ? `<pre class="workshop-test-log">${stderr}</pre>` : ''}
        ${stdout ? `<pre class="workshop-test-log">${stdout}</pre>` : ''}
      `);
      return;
    }

    const count = Number(data?.data?.count || 0);
    const candidates = Array.isArray(data?.data?.candidates) ? data.data.candidates : [];
    const validationPassed = Boolean(data?.data?.validation_passed);
    const validationErrors = Array.isArray(data?.data?.validation_errors) ? data.data.validation_errors : [];

    if (count === 0) {
      // No candidates is structurally OK (indicator didn't fire) â€” validation still applies
      workshopTestValidationPassed = validationPassed;
      if (validationPassed) {
        workshopTestPassHash = await computeCodeDefinitionHash();
      }
      workshopLastTestResult = {
        status: 'success_no_candidates',
        pattern_id: patternId,
        symbol,
        interval,
        count,
        at: new Date().toISOString(),
      };
      renderTestOutput('<p class="workshop-test-placeholder">Test ran successfully, but no candidates were produced. Validation passed (no output to check).</p>');
      updateRegisterButtonState();
      return;
    }

    const first = candidates[0] || {};
    const rules = Array.isArray(first.rule_checklist) ? first.rule_checklist : [];
    const rulesHtml = rules
      .slice(0, 8)
      .map((rule) => {
        const passed = !!rule.passed;
        return `<li><span class="${passed ? 'rule-pass' : 'rule-fail'}">${passed ? 'PASS' : 'FAIL'}</span> ${escapeHtml(rule.rule_name || 'rule')}</li>`;
      })
      .join('');

    renderTestOutput(`
      <p><strong>Success:</strong> ${count} candidate(s) returned.</p>
      <div class="test-candidate">
        <div><strong>Pattern:</strong> ${escapeHtml(first.pattern_type || patternId)}</div>
        <div><strong>Symbol:</strong> ${escapeHtml(first.symbol || symbol)} (${escapeHtml(first.timeframe || interval)})</div>
        <div><strong>Score:</strong> ${escapeHtml(String(first.score ?? 'n/a'))}</div>
        <div><strong>Entry Ready:</strong> ${first.entry_ready ? 'Yes' : 'No'}</div>
        ${rulesHtml ? `<ul class="workshop-rule-list">${rulesHtml}</ul>` : ''}
      </div>
    `);

    // Show validation results
    renderValidationResults(validationPassed, validationErrors);

    // Gate register based on validation
    workshopTestValidationPassed = validationPassed;
    if (validationPassed) {
      workshopTestPassHash = await computeCodeDefinitionHash();
    }
    updateRegisterButtonState();

    workshopLastTestResult = {
      status: 'success',
      pattern_id: patternId,
      symbol,
      interval,
      count,
      validation_passed: validationPassed,
      validation_errors: validationErrors,
      first_candidate: {
        pattern_type: first.pattern_type || patternId,
        score: first.score,
        entry_ready: !!first.entry_ready,
        rule_checklist: Array.isArray(first.rule_checklist) ? first.rule_checklist.slice(0, 8) : [],
      },
      at: new Date().toISOString(),
    };
  } catch (error) {
    const msg = error && error.message ? error.message : 'Unknown test error';
    workshopLastTestResult = {
      status: 'error',
      pattern_id: patternId,
      symbol,
      interval,
      error: String(msg || ''),
      at: new Date().toISOString(),
    };
    renderTestOutput(`<p class="workshop-test-error">Test error: ${escapeHtml(msg)}</p>`);
  }
}

async function saveDraft() {
  syncPatternIdFromName();
  syncDefinitionMetaFields();

  const patternName = getFieldValue('workshop-pattern-name') || 'New Plugin';
  const category = getFieldValue('workshop-category') || 'custom';
  const currentPatternId = getFieldValue('workshop-pattern-id') || toPatternId(patternName);
  const persistPatternId = loadedBuilderPatternId || currentPatternId;
  const definitionRaw = getEditorValue(jsonEditor);
  const parsedDefinition = tryParseJson(definitionRaw) || {};
  const normalizedDefinition = {
    ...parsedDefinition,
    pattern_id: persistPatternId,
    name: patternName,
    category,
    status: 'draft',
    pattern_type: persistPatternId,
    plugin_file: `plugins/${persistPatternId}.py`,
    plugin_function: `run_${persistPatternId}_plugin`,
  };

  if (jsonEditor) {
    jsonEditor.setValue(JSON.stringify(normalizedDefinition, null, 2));
  }

  const draftPayload = {
    draft_id: currentLocalDraftId || `${persistPatternId}_${Date.now()}`,
    saved_at: new Date().toISOString(),
    pattern_name: patternName,
    pattern_id: persistPatternId,
    category,
    code: getEditorValue(pluginEditor),
    definition: JSON.stringify(normalizedDefinition, null, 2),
  };

  indicatorLibrary.localDrafts = upsertLocalDraft(draftPayload);
  currentLocalDraftId = draftPayload.draft_id;
  loadedBuilderPatternId = persistPatternId;
  const payload = {
    ...draftPayload,
  };
  currentPluginDraft = payload;
  setTextContent('workshop-status', 'draft');
  if (indicatorLibrary.loaded) {
    indicatorLibrary.selectedPatternId = `draft:${draftPayload.draft_id}`;
    populateIndicatorLibraryFilters();
    renderIndicatorLibrary();
  }
  renderTestOutput(`<p><strong>Draft saved locally:</strong> ${escapeHtml(persistPatternId)}. Use <strong>Register Plugin</strong> to publish it.</p>`);
}

async function registerPlugin() {
  clearWorkshopValidationErrors();
  syncPatternIdFromName();

  if (!workshopTestValidationPassed) {
    renderTestOutput('<p class="workshop-test-error">You must run a successful test that passes validation before registering.</p>');
    return;
  }

  const currentHash = await computeCodeDefinitionHash();
  if (currentHash !== workshopTestPassHash) {
    workshopTestValidationPassed = false;
    updateRegisterButtonState();
    renderTestOutput('<p class="workshop-test-error">Code or definition has changed since the last successful test. Please re-test before registering.</p>');
    return;
  }

  const artifacts = buildArtifactsForRegistration();
  if (!artifacts.length) {
    alert('No plugin artifacts found. Generate or load a plugin first.');
    return;
  }

  const preflightIssues = validateArtifactsPreflight(artifacts);
  if (preflightIssues.length) {
    renderWorkshopValidationErrors(preflightIssues, 'Fix validation errors before registering.');
    renderTestOutput('<p class="workshop-test-error">Preflight failed. Fix highlighted fields before registering.</p>');
    return;
  }

  const summary = artifacts
    .map((a, i) => `${i + 1}. ${a.pattern_id} (${a.composition || a.artifact_type || 'artifact'})`)
    .join('\n');
  const ok = confirm(
    `Register ${artifacts.length} artifact(s)?\n\n${summary}\n\nThis writes JSON definitions and Python files.`,
  );
  if (!ok) return;

  try {
    const idMap = new Map();
    const results = [];

    for (let i = 0; i < artifacts.length; i += 1) {
      const artifact = artifacts[i];
      const definition = remapCompositeStageIds(artifact.definition, idMap);
      const requestedPatternId = artifact.pattern_id;

      definition.pattern_id = requestedPatternId;
      definition.name = definition.name || requestedPatternId;
      definition.category = definition.category || 'custom';
      definition.pattern_type = requestedPatternId;
      definition.plugin_file = `plugins/${requestedPatternId}.py`;
      definition.plugin_function = `run_${requestedPatternId}_plugin`;

      const chartIndCheckbox = document.getElementById('workshop-chart-indicator');
      definition.chart_indicator = chartIndCheckbox ? chartIndCheckbox.checked : true;

      renderTestOutput(
        `<p class="workshop-test-placeholder">Registering ${i + 1}/${artifacts.length}: ${escapeHtml(requestedPatternId)}...</p>`,
      );

      const res = await fetch('/api/plugins/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: artifact.code,
          definition,
          pattern_id: requestedPatternId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        const validationErrors = Array.isArray(data?.data?.errors) ? data.data.errors : [];
        if (validationErrors.length) {
          renderWorkshopValidationErrors(validationErrors, data?.error || 'Validation failed.');
        }
        throw new Error(`Failed on ${requestedPatternId}: ${data?.error || `HTTP ${res.status}`}`);
      }

      const assignedPatternId = String(data?.data?.pattern_id || requestedPatternId);
      if (assignedPatternId !== requestedPatternId) {
        idMap.set(requestedPatternId, assignedPatternId);
      }
      results.push({
        requestedPatternId,
        assignedPatternId,
        renamed: assignedPatternId !== requestedPatternId,
        composition: artifact.composition,
      });
    }

    const final = results[results.length - 1];
    const finalId = final?.assignedPatternId || '';
    const finalArtifact = artifacts[artifacts.length - 1];
    if (pluginEditor && finalArtifact?.code) pluginEditor.setValue(finalArtifact.code);
    if (jsonEditor) {
      const finalDefinition = remapCompositeStageIds(finalArtifact.definition, idMap);
      finalDefinition.pattern_id = finalId || finalArtifact.pattern_id;
      finalDefinition.pattern_type = finalDefinition.pattern_id;
      finalDefinition.plugin_file = `plugins/${finalDefinition.pattern_id}.py`;
      finalDefinition.plugin_function = `run_${finalDefinition.pattern_id}_plugin`;
      jsonEditor.setValue(JSON.stringify(finalDefinition, null, 2));
      applyDefinitionToFields(finalDefinition);
    }

    loadedBuilderPatternId = finalId;
    workshopGeneratedArtifacts = [];
    setTextContent('workshop-status', 'registered');
    await loadAvailablePrimitives(true);
    await initializeIndicatorLibrary(true);
    if (finalId) await selectIndicatorFromLibrary(finalId, true);

    if (typeof refreshDynamicIndicators === 'function') {
      refreshDynamicIndicators();
    }

    const resultLines = results.map((r) => {
      if (r.renamed) {
        return `<li>${escapeHtml(r.requestedPatternId)} <span class="workshop-test-placeholder">â†’ ${escapeHtml(r.assignedPatternId)}</span></li>`;
      }
      return `<li>${escapeHtml(r.assignedPatternId)}</li>`;
    });
    renderTestOutput(
      `<p><strong>Registered ${results.length} artifact(s)</strong></p><ul class="workshop-rule-list">${resultLines.join('')}</ul>`,
    );
  } catch (error) {
    alert(`Registration failed: ${error.message || 'Unknown error'}`);
  }
}

function buildArtifactsForRegistration() {
  const generated = Array.isArray(workshopGeneratedArtifacts)
    ? workshopGeneratedArtifacts
        .map((artifact) => normalizeArtifactForRegistration(artifact))
        .filter(Boolean)
    : [];
  if (generated.length) {
    return generated.sort((a, b) => artifactRegistrationWeight(a) - artifactRegistrationWeight(b));
  }

  const definitionStr = getEditorValue(jsonEditor).trim();
  if (!definitionStr) return [];

  let definition;
  try {
    definition = JSON.parse(definitionStr);
  } catch (error) {
    renderWorkshopValidationErrors([
      {
        field: 'definition',
        message: `Pattern definition JSON is invalid: ${error.message || 'Parse error'}`,
      },
    ]);
    renderTestOutput(`<p class="workshop-test-error">Pattern definition JSON is invalid: ${escapeHtml(error.message || 'Parse error')}</p>`);
    return [];
  }

  const requestedPatternId = getFieldValue('workshop-pattern-id') || definition.pattern_id;
  const pattern_id = normalizePatternIdForDefinition(
    requestedPatternId || definition.name || 'new_plugin',
    definition,
  );
  definition.pattern_id = pattern_id;
  definition.pattern_type = pattern_id;
  definition.name = String(definition.name || '').trim() || pattern_id;
  definition.category = String(definition.category || '').trim() || 'custom';
  const code = getEditorValue(pluginEditor).trim();
  const composition = String(definition?.composition || 'primitive').toLowerCase();
  definition.plugin_file = `plugins/${pattern_id}.py`;
  definition.plugin_function = `run_${pattern_id}_plugin`;

  const artifact_type = String(definition?.artifact_type || 'indicator').toLowerCase();
  const isDefaultPlaceholder = pattern_id === 'new_plugin'
    && !code
    && String(definition?.name || '').trim().toLowerCase() === 'new plugin';
  if (isDefaultPlaceholder) {
    renderTestOutput(
      '<p class="workshop-test-error">No plugin artifacts found.</p>' +
      '<p class="workshop-test-placeholder">Generate a primitive first, then register.</p>',
    );
    return [];
  }

  if (!code) {
    renderWorkshopValidationErrors([
      { field: 'code', message: `Plugin code is empty for ${pattern_id}.` },
    ]);
    renderTestOutput(`<p class="workshop-test-error">Plugin code is empty for ${escapeHtml(pattern_id)}.</p>`);
    return [];
  }

  return [
    {
      pattern_id,
      definition: { ...definition },
      code: normalizedCode,
      composition,
      artifact_type,
    },
  ];
}

function normalizeArtifactForRegistration(artifact) {
  const definition = artifact?.definition && typeof artifact.definition === 'object'
    ? { ...artifact.definition }
    : null;
  if (!definition) return null;

  const rawId = String(definition.pattern_id || artifact.patternId || definition.name || '').trim();
  const pattern_id = normalizePatternIdForDefinition(rawId || 'new_plugin', definition);
  if (!pattern_id) return null;

  definition.pattern_id = pattern_id;
  definition.pattern_type = pattern_id;
  definition.name = String(definition.name || '').trim() || pattern_id;
  definition.category = String(definition.category || '').trim() || 'custom';

  const composition = String(definition.composition || 'primitive').toLowerCase();
  const artifact_type = String(definition.artifact_type || 'indicator').toLowerCase();

  definition.plugin_file = `plugins/${pattern_id}.py`;
  definition.plugin_function = `run_${pattern_id}_plugin`;

  const code = String(artifact.code || '').trim();
  if (!code) return null;

  return {
    pattern_id,
    definition,
    code,
    composition,
    artifact_type,
  };
}

function artifactRegistrationWeight(artifact) {
  const composition = String(artifact?.composition || '').toLowerCase();
  if (composition === 'primitive') return 0;
  return 1;
}

function remapCompositeStageIds(definition, idMap) {
  const copy = JSON.parse(JSON.stringify(definition || {}));
  if (!idMap || !idMap.size) return copy;

  const compositeSpec = copy?.default_setup_params?.composite_spec;
  if (!compositeSpec || !Array.isArray(compositeSpec.stages)) return copy;

  compositeSpec.stages = compositeSpec.stages.map((stage) => {
    const stageId = String(stage?.pattern_id || '').trim();
    if (stageId && idMap.has(stageId)) {
      return { ...stage, pattern_id: idMap.get(stageId) };
    }
    return stage;
  });
  return copy;
}

function createPreflightIssue(field, message, expected = '', example = '') {
  return {
    field,
    message,
    expected,
    example,
  };
}

function isValidWorkshopId(value) {
  return WORKSHOP_ID_REGEX.test(String(value || '').trim());
}

function validateCompositeSpecPreflight(definition, artifactLabel) {
  const issues = [];
  const setup = definition?.default_setup_params;
  const compositeSpec = setup?.composite_spec;
  if (!compositeSpec || typeof compositeSpec !== 'object' || Array.isArray(compositeSpec)) {
    issues.push(
      createPreflightIssue(
        'default_setup_params.composite_spec',
        `${artifactLabel} missing default_setup_params.composite_spec.`,
        'Object with stages[] and reducer',
        '{"stages":[{"id":"structure","pattern_id":"rdp_swing_structure_primitive"}],"reducer":{"op":"AND","inputs":["structure"]}}',
      ),
    );
    return issues;
  }

  const isConditional = String(compositeSpec.type || '').trim().toLowerCase() === 'conditional';
  const hasBranches = isConditional && Array.isArray(compositeSpec.branches) && compositeSpec.branches.length > 0;

  // Conditional composites use branches[] instead of stages[] — skip stage validation entirely
  if (isConditional) {
    if (!hasBranches) {
      issues.push(
        createPreflightIssue(
          'default_setup_params.composite_spec.branches',
          `${artifactLabel} conditional composite_spec.branches is required.`,
          'Array with at least one branch',
          '[{"condition":{...},"then":{...}}]',
        ),
      );
    }
    return issues;
  }

  const stages = Array.isArray(compositeSpec.stages) ? compositeSpec.stages : [];
  if (!stages.length) {
    issues.push(
      createPreflightIssue(
        'default_setup_params.composite_spec.stages',
        `${artifactLabel} composite_spec.stages is required.`,
        'Array with at least one stage',
        '[{"id":"structure","pattern_id":"rdp_swing_structure_primitive"}]',
      ),
    );
  }

  stages.forEach((stage, idx) => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      issues.push(
        createPreflightIssue(
          `default_setup_params.composite_spec.stages[${idx}]`,
          `${artifactLabel} stage ${idx + 1} must be an object.`,
        ),
      );
      return;
    }

    const stageId = String(stage.id || '').trim();
    const stagePatternId = String(stage.pattern_id || '').trim();
    if (!stageId) {
      issues.push(
        createPreflightIssue(
          `default_setup_params.composite_spec.stages[${idx}].id`,
          `${artifactLabel} stage ${idx + 1} is missing id.`,
          'snake_case stage id',
          'structure',
        ),
      );
    }
    if (!stagePatternId) {
      issues.push(
        createPreflightIssue(
          `default_setup_params.composite_spec.stages[${idx}].pattern_id`,
          `${artifactLabel} stage ${idx + 1} is missing pattern_id.`,
          'Registered primitive/composite id',
          'rdp_swing_structure_primitive',
        ),
      );
    } else if (!isValidWorkshopId(stagePatternId)) {
      issues.push(
        createPreflightIssue(
          `default_setup_params.composite_spec.stages[${idx}].pattern_id`,
          `${artifactLabel} stage ${idx + 1} pattern_id must be snake_case.`,
          '^[a-z][a-z0-9_]*$',
          toPatternId(stagePatternId),
        ),
      );
    }
  });

  const reducer = compositeSpec.reducer;
  if (!reducer || typeof reducer !== 'object' || Array.isArray(reducer)) {
    issues.push(
      createPreflightIssue(
        'default_setup_params.composite_spec.reducer',
        `${artifactLabel} composite_spec.reducer is required.`,
        'Object',
        '{"op":"AND","inputs":["structure","location","trigger"]}',
      ),
    );
    return issues;
  }

  const reducerOp = String(reducer.op || '').trim();
  const reducerInputs = Array.isArray(reducer.inputs) ? reducer.inputs : [];
  if (!reducerOp) {
    issues.push(
      createPreflightIssue(
        'default_setup_params.composite_spec.reducer.op',
        `${artifactLabel} reducer.op is required.`,
        'AND or OR',
        'AND',
      ),
    );
  }
  if (!reducerInputs.length) {
    issues.push(
      createPreflightIssue(
        'default_setup_params.composite_spec.reducer.inputs',
        `${artifactLabel} reducer.inputs is required.`,
        'Array of stage ids',
        '["structure","location","trigger"]',
      ),
    );
  }
  return issues;
}

function validateArtifactPreflight(artifact, index, total, options = {}) {
  const issues = [];
  const label = `[${index + 1}/${total}] ${artifact?.pattern_id || 'artifact'}`;
  const definition = artifact?.definition;
  const requireCode = options.requireCode !== false;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    issues.push(createPreflightIssue('definition', `${label} definition must be a JSON object.`));
    return issues;
  }

  const patternId = String(artifact.pattern_id || '').trim();
  const composition = String(artifact.composition || '').trim().toLowerCase();
  const artifactType = String(artifact.artifact_type || '').trim().toLowerCase();
  const category = String(definition.category || '').trim().toLowerCase();
  const name = String(definition.name || '').trim();
  const code = String(artifact.code || '').trim();

  if (requireCode && !code) {
    issues.push(createPreflightIssue('code', `${label} code is empty.`));
  }

  if (!patternId) {
    issues.push(
      createPreflightIssue(
        'pattern_id',
        `${label} pattern_id is required.`,
        'lowercase snake_case',
        'rsi_cross_above_30_primitive',
      ),
    );
  } else if (!isValidWorkshopId(patternId)) {
    issues.push(
      createPreflightIssue(
        'pattern_id',
        `${label} pattern_id must be lowercase snake_case.`,
        '^[a-z][a-z0-9_]*$',
        toPatternId(patternId),
      ),
    );
  }

  if (!name) {
    issues.push(
      createPreflightIssue(
        'name',
        `${label} name is required.`,
        'Human-readable display name',
        'RSI Cross Above 30 (Primitive)',
      ),
    );
  }

  if (!category) {
    issues.push(
      createPreflightIssue(
        'category',
        `${label} category is required.`,
        'lowercase snake_case',
        'indicator_signals',
      ),
    );
  } else if (!WORKSHOP_CATEGORY_REGEX.test(category)) {
    issues.push(
      createPreflightIssue(
        'category',
        `${label} category must be lowercase snake_case.`,
        '^[a-z][a-z0-9_]*$',
        toPatternId(category),
      ),
    );
  }

  if (composition !== 'primitive' && composition !== 'composite') {
    issues.push(
      createPreflightIssue(
        'composition',
        `${label} composition must be "primitive" or "composite".`,
        'primitive|composite',
        'primitive',
      ),
    );
  }

  if (artifactType !== 'indicator' && artifactType !== 'pattern') {
    issues.push(
      createPreflightIssue(
        'artifact_type',
        `${label} artifact_type must be "indicator" or "pattern".`,
        'indicator|pattern',
        'indicator',
      ),
    );
  }

  if (patternId && composition === 'primitive' && !patternId.endsWith('_primitive')) {
    issues.push(
      createPreflightIssue(
        'pattern_id',
        `${label} primitive IDs must end with "_primitive".`,
        `${patternId}_primitive`,
        `${patternId}_primitive`,
      ),
    );
  }

  if (patternId && composition === 'composite' && patternId.endsWith('_primitive')) {
    issues.push(
      createPreflightIssue(
        'pattern_id',
        `${label} composite IDs cannot end with "_primitive".`,
        'Use a composite id (optional "_composite" suffix)',
        patternId.replace(/_primitive$/, '_composite'),
      ),
    );
  }

  const defPatternId = String(definition.pattern_id || '').trim();
  const defPatternType = String(definition.pattern_type || '').trim();
  const defPluginFile = String(definition.plugin_file || '').trim();
  const defPluginFunction = String(definition.plugin_function || '').trim();
  if (defPatternId && patternId && defPatternId !== patternId) {
    issues.push(
      createPreflightIssue(
        'definition.pattern_id',
        `${label} definition.pattern_id must match pattern_id.`,
        patternId,
        patternId,
      ),
    );
  }
  if (patternId && defPatternType && defPatternType !== patternId) {
    issues.push(
      createPreflightIssue(
        'pattern_type',
        `${label} pattern_type must match pattern_id.`,
        patternId,
        patternId,
      ),
    );
  }
  if (patternId) {
    const expectedFile = `plugins/${patternId}.py`;
    const expectedFn = `run_${patternId}_plugin`;
    if (defPluginFile && defPluginFile !== expectedFile) {
      issues.push(
        createPreflightIssue(
          'plugin_file',
          `${label} plugin_file must match pattern_id.`,
          expectedFile,
          expectedFile,
        ),
      );
    }
    if (defPluginFunction && defPluginFunction !== expectedFn) {
      issues.push(
        createPreflightIssue(
          'plugin_function',
          `${label} plugin_function must match pattern_id.`,
          expectedFn,
          expectedFn,
        ),
      );
    }
  }

  if (composition === 'composite') {
    issues.push(...validateCompositeSpecPreflight(definition, label));
  }

  if (composition === 'primitive' && artifactType === 'indicator') {
    const indicatorRole = String(definition.indicator_role || '').trim();
    if (!indicatorRole) {
      issues.push(
        createPreflightIssue(
          'indicator_role',
          `${label} primitive indicators require indicator_role.`,
          'anchor_structure|location|timing_trigger|state_filter|regime_state|entry_composite',
          'timing_trigger',
        ),
      );
    }
  }

  if (artifactType === 'pattern') {
    const patternRole = String(definition.pattern_role || '').trim();
    if (!patternRole) {
      issues.push(
        createPreflightIssue(
          'pattern_role',
          `${label} pattern artifacts require pattern_role.`,
          'phase_structure_pattern|pattern_pipeline|regime_pattern',
          'phase_structure_pattern',
        ),
      );
    }
  }

  return issues;
}

function validateArtifactsPreflight(artifacts, options = {}) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const issues = [];
  list.forEach((artifact, idx) => {
    issues.push(...validateArtifactPreflight(artifact, idx, list.length, options));
  });
  return issues;
}

function handleWorkshopChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendWorkshopChat();
  }
}

function renderTestOutput(html) {
  const container = document.getElementById('workshop-test-results');
  if (!container) return;
  container.innerHTML = html;
}
