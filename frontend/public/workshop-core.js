// =========================================================================
// workshop-core.js - State, init, drafts, indicator library
// Split from workshop.js for maintainability. Load first.
// =========================================================================
let workshopChatMessages = [];
let pluginEditor = null;
let jsonEditor = null;
let currentPluginDraft = null;
let workshopLastTestResult = null;
let loadedBuilderPatternId = '';
let workshopAvailablePrimitives = [];
let workshopGeneratedArtifacts = [];

// Gate: tracks whether the last test passed validation
let workshopTestValidationPassed = false;
let workshopTestPassHash = ''; // SHA of code+definition at time of last passing test
let currentLocalDraftId = '';
let workshopLiveValidationTimer = null;

const WORKSHOP_DRAFT_KEY = 'plugin-workshop-draft';
const WORKSHOP_DRAFTS_KEY = 'plugin-workshop-drafts';
const WORKSHOP_TAB_KEY = 'indicator-studio-tab';
const BLOCKLY_COMPOSER_EXPORT_KEY = 'blockly-composer-export';
const WORKSHOP_VALIDATION_FIELDS = {
  name: { inputId: 'workshop-pattern-name', errorId: 'workshop-error-pattern-name' },
  pattern_id: { inputId: 'workshop-pattern-id', errorId: 'workshop-error-pattern-id' },
  category: { inputId: 'workshop-category', errorId: 'workshop-error-category' },
  code: { inputId: 'code-editor-container', errorId: 'workshop-error-code' },
  json: { inputId: 'workshop-json-section', errorId: 'workshop-error-json' },
};
const WORKSHOP_ID_REGEX = /^[a-z][a-z0-9_]*$/;
const WORKSHOP_CATEGORY_REGEX = /^[a-z][a-z0-9_]*$/;

let currentWorkshopTab = 'builder';
let indicatorLibrary = {
  loaded: false,
  loading: false,
  registry: null,
  rows: [],
  categoryMap: {},
  detailsById: {},
  selectedPatternId: '',
  loadingDetailId: '',
  localDrafts: [],
};

let workshopScannerState = {
  initialized: false,
  options: [],
  byPatternId: {},
  symbolCatalog: [],
  symbolBuckets: {},
  methodBuckets: {},
  symbolBucketOrder: ['base_test_40', 'all', 'futures', 'commodities', 'crypto', 'indices', 'sectors', 'international', 'bonds', 'smallcaps'],
  activeUniverseSymbols: [],
  allCandidates: [],
  candidates: [],
  labelsByCandidateId: {},
  correctionsByCandidateId: {},
  autoLabelJobId: null,
  autoLabelPollTimer: null,
  aiDecisionsByCandidateId: {},
  lastAutoLabelJobId: null,
  currentIndex: 0,
  chart: null,
  series: null,
  currentSafeBars: [],
  chat: [],
};

const DEFAULT_PLUGIN_CODE = '';

const DEFAULT_DEFINITION = {
  pattern_id: 'new_plugin',
  name: 'New Plugin',
  category: 'custom',
  description: 'AI-generated plugin draft',
  author: 'ai_generated',
  version: '1.0.0',
  plugin_file: 'plugins/new_plugin.py',
  plugin_function: 'run_new_plugin_plugin',
  pattern_type: 'new_plugin',
  default_structure_config: {
    swing_method: 'major',
    swing_epsilon_pct: 0.05,
  },
  default_setup_params: {
    pattern_type: 'new_plugin',
  },
  default_entry: {
    entry_type: 'market_on_close',
    confirmation_bars: 1,
  },
  tunable_params: [],
  suggested_timeframes: ['D', 'W'],
  min_data_bars: 200,
};

document.addEventListener('DOMContentLoaded', async () => {
  await initializeWorkshopEditors();
  clearWorkshopValidationErrors();
  initializeWorkshopChat();
  const importedFromBlockly = tryImportBlocklyComposerExport();
  if (!importedFromBlockly) {
    promptRestoreWorkshopDraft();
  }
  syncPatternIdFromName();
  scheduleWorkshopLiveValidation();
  await loadAvailablePrimitives();
  initializeWorkshopTabs();
});

async function initializeWorkshopEditors() {
  const monacoReady = await initMonacoEditors();
  if (!monacoReady) {
    pluginEditor = createFallbackEditor('code-editor-container', DEFAULT_PLUGIN_CODE, 'python');
    jsonEditor = createFallbackEditor('json-editor-container', JSON.stringify(DEFAULT_DEFINITION, null, 2), 'json');
  }

  // Leave code editor blank by default on first load.
  if (jsonEditor && !jsonEditor.getValue()) {
    jsonEditor.setValue(JSON.stringify(DEFAULT_DEFINITION, null, 2));
  }
}

async function loadAvailablePrimitives(force = false) {
  if (workshopAvailablePrimitives.length && !force) return workshopAvailablePrimitives;

  try {
    const res = await fetch('/api/plugins/primitives');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    workshopAvailablePrimitives = data.data
      .filter((row) => row && typeof row === 'object' && row.pattern_id)
      .map((row) => ({
        pattern_id: String(row.pattern_id || '').trim(),
        name: String(row.name || row.pattern_id || '').trim(),
        indicator_role: String(row.indicator_role || 'unknown').trim(),
        description: String(row.description || '').trim(),
        category: String(row.category || 'custom').trim(),
      }))
      .filter((row) => !!row.pattern_id)
      .sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
  } catch (error) {
    console.warn('Failed to load available primitives:', error);
    workshopAvailablePrimitives = [];
  }

  return workshopAvailablePrimitives;
}

const VALID_WORKSHOP_TABS = ['builder', 'composite', 'scanner', 'library'];

function initializeWorkshopTabs() {
  const queryTab = new URLSearchParams(window.location.search).get('tab');
  const savedTab = localStorage.getItem(WORKSHOP_TAB_KEY);
  const requestedTab = queryTab || savedTab;
  const tab = VALID_WORKSHOP_TABS.includes(requestedTab) ? requestedTab : 'builder';
  setWorkshopTab(tab, { persist: false });
}

function setWorkshopTab(tab, options = {}) {
  const nextTab = VALID_WORKSHOP_TABS.includes(tab) ? tab : 'builder';
  currentWorkshopTab = nextTab;

  const workshopContainer = document.querySelector('.workshop-container');
  const tabs = {
    builder:   document.getElementById('workshop-tab-builder'),
    composite: document.getElementById('workshop-tab-composite'),
    scanner:   document.getElementById('workshop-tab-scanner'),
    library:   document.getElementById('workshop-tab-library'),
  };
  const views = {
    builder:   document.getElementById('workshop-builder-view'),
    composite: document.getElementById('workshop-composite-view'),
    scanner:   document.getElementById('workshop-scanner-view'),
    library:   document.getElementById('workshop-library-view'),
  };
  const builderChatPanel = document.getElementById('workshop-builder-chat-panel');

  for (const [key, el] of Object.entries(tabs)) {
    if (!el) continue;
    el.classList.toggle('active', key === nextTab);
    el.setAttribute('aria-selected', key === nextTab ? 'true' : 'false');
  }

  for (const [key, el] of Object.entries(views)) {
    if (!el) continue;
    el.classList.toggle('hidden', key !== nextTab);
  }

  // Builder chat panel only visible on the builder tab
  if (builderChatPanel) builderChatPanel.classList.toggle('hidden', nextTab !== 'builder');
  // Single-pane mode for all tabs except builder (builder has the side chat panel)
  if (workshopContainer) workshopContainer.classList.toggle('workshop-container--single-pane', nextTab !== 'builder');

  if (options.persist !== false) {
    localStorage.setItem(WORKSHOP_TAB_KEY, nextTab);
  }

  if (nextTab === 'library') {
    initializeIndicatorLibrary();
  } else if (nextTab === 'scanner') {
    initializeWorkshopScanner();
  } else if (nextTab === 'composite') {
    if (typeof initCompositeBuilder === 'function') initCompositeBuilder();
  }
}

let _compositeSubTab = 'ai';

function setCompositeSubTab(sub) {
  _compositeSubTab = sub;
  const subs = ['ai', 'blockly', 'pipeline'];
  for (const s of subs) {
    const btn = document.getElementById(`composite-subtab-${s}`);
    if (btn) {
      btn.classList.toggle('active', s === sub);
      btn.setAttribute('aria-selected', s === sub ? 'true' : 'false');
    }
    const view = document.getElementById(`composite-${s}-view`);
    if (view) view.style.display = s === sub ? 'flex' : 'none';
  }

  // Lazy-load iframes
  if (sub === 'blockly') {
    const iframe = document.getElementById('composite-blockly-iframe');
    if (iframe && !iframe.src) iframe.src = 'blockly-composer.html';
  } else if (sub === 'pipeline') {
    const iframe = document.getElementById('composite-pipeline-iframe');
    if (iframe && !iframe.src) iframe.src = 'pipeline-composer.html';
  }
}

function parseDateSafe(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeLocalDraftRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const patternName = String(record.pattern_name || '').trim() || 'New Plugin';
  const patternId = toPatternId(String(record.pattern_id || patternName || 'new_plugin'));
  const category = String(record.category || 'custom').trim() || 'custom';
  const savedAt = String(record.saved_at || new Date().toISOString());
  const draftId = String(record.draft_id || record.id || `${patternId}_${Date.now()}`).trim();
  const code = String(record.code || '');
  const definitionRaw = typeof record.definition === 'string'
    ? record.definition
    : JSON.stringify(record.definition || {}, null, 2);
  const parsedDef = tryParseJson(definitionRaw) || {};
  const composition = String(parsedDef.composition || 'composite').trim() || 'composite';
  const artifactType = String(parsedDef.artifact_type || 'indicator').trim() || 'indicator';

  return {
    draft_id: draftId,
    saved_at: savedAt,
    pattern_name: patternName,
    pattern_id: patternId,
    category,
    code,
    definition: definitionRaw,
    source: 'draft',
    row_key: `draft:${draftId}`,
    name: `${patternName} (Local Draft)`,
    status: 'draft',
    category_name: toLabelCase(category),
    definition_file: '(local draft)',
    composition,
    artifact_type: artifactType,
  };
}

function loadLocalDraftsFromStorage() {
  const drafts = [];
  const rawList = localStorage.getItem(WORKSHOP_DRAFTS_KEY);
  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const normalized = normalizeLocalDraftRecord(item);
          if (normalized) drafts.push(normalized);
        });
      }
    } catch (error) {
      console.warn('Failed to parse local draft list:', error);
    }
  }

  // Backward compatibility for single-draft storage.
  const legacy = localStorage.getItem(WORKSHOP_DRAFT_KEY);
  if (legacy) {
    try {
      const parsedLegacy = JSON.parse(legacy);
      const normalizedLegacy = normalizeLocalDraftRecord(parsedLegacy);
      if (normalizedLegacy && !drafts.some((d) => d.draft_id === normalizedLegacy.draft_id)) {
        drafts.push(normalizedLegacy);
      }
    } catch {
      // ignore legacy parse failures
    }
  }

  drafts.sort((a, b) => parseDateSafe(b.saved_at) - parseDateSafe(a.saved_at));
  return drafts;
}

function persistLocalDrafts(drafts) {
  const normalized = Array.isArray(drafts) ? drafts : [];
  localStorage.setItem(
    WORKSHOP_DRAFTS_KEY,
    JSON.stringify(
      normalized.map((d) => ({
        draft_id: d.draft_id,
        saved_at: d.saved_at,
        pattern_name: d.pattern_name,
        pattern_id: d.pattern_id,
        category: d.category,
        code: d.code,
        definition: d.definition,
      })),
    ),
  );
}

function getMostRecentLocalDraft() {
  const drafts = loadLocalDraftsFromStorage();
  return drafts.length ? drafts[0] : null;
}

function isBuilderDirty() {
  const code = getEditorValue(pluginEditor).trim();
  const json = getEditorValue(jsonEditor).trim();
  const name = getFieldValue('workshop-pattern-name');
  const category = getFieldValue('workshop-category');
  return !!(code || name || category || (json && json !== JSON.stringify(DEFAULT_DEFINITION, null, 2)));
}

function applyDraftToBuilder(draft) {
  if (!draft) return;
  setFieldValue('workshop-pattern-name', draft.pattern_name || 'New Plugin');
  setFieldValue('workshop-pattern-id', draft.pattern_id || toPatternId(draft.pattern_name || 'new plugin'));
  setFieldValue('workshop-category', draft.category || 'custom');
  if (pluginEditor) pluginEditor.setValue(String(draft.code || ''));
  if (jsonEditor) jsonEditor.setValue(String(draft.definition || JSON.stringify(DEFAULT_DEFINITION, null, 2)));
  setTextContent('workshop-status', 'draft');
  loadedBuilderPatternId = String(draft.pattern_id || '').trim();
  currentLocalDraftId = String(draft.draft_id || '').trim();
  workshopGeneratedArtifacts = [];
  scheduleWorkshopLiveValidation();
  renderTestOutput(
    `<p><strong>Restored local draft:</strong> ${escapeHtml(String(draft.pattern_id || 'draft'))}</p>`,
  );
}

function promptRestoreWorkshopDraft() {
  const latest = getMostRecentLocalDraft();
  if (!latest) return;

  const label = latest.pattern_name || latest.pattern_id || 'draft';
  const savedAt = latest.saved_at ? new Date(latest.saved_at).toLocaleString() : 'unknown time';
  const shouldRestore = confirm(`Restore your last local draft?\n\n${label}\nSaved: ${savedAt}\n\nPress Cancel to start with a blank Indicator Builder.`);
  if (!shouldRestore) {
    startBlankBuilder(false);
    return;
  }
  applyDraftToBuilder(latest);
}

function tryImportBlocklyComposerExport() {
  const raw = localStorage.getItem(BLOCKLY_COMPOSER_EXPORT_KEY);
  if (!raw) return false;

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    localStorage.removeItem(BLOCKLY_COMPOSER_EXPORT_KEY);
    return false;
  }

  const definition = payload && typeof payload === 'object' ? payload.definition : null;
  if (!definition || typeof definition !== 'object') {
    localStorage.removeItem(BLOCKLY_COMPOSER_EXPORT_KEY);
    return false;
  }

  const patternName = String(definition.name || '').trim() || 'New Composite Indicator';
  const patternId = String(definition.pattern_id || '').trim() || toPatternId(patternName);
  const category = String(definition.category || 'indicator_signals').trim() || 'indicator_signals';

  currentLocalDraftId = '';
  loadedBuilderPatternId = '';
  workshopGeneratedArtifacts = [];
  workshopLastTestResult = null;
  currentPluginDraft = null;

  setFieldValue('workshop-pattern-name', patternName);
  setFieldValue('workshop-pattern-id', patternId);
  setFieldValue('workshop-category', category);
  if (pluginEditor) pluginEditor.setValue('');
  if (jsonEditor) jsonEditor.setValue(JSON.stringify(definition, null, 2));
  setTextContent('workshop-status', 'draft');
  renderTestOutput(
    `<p><strong>Imported from Blockly Composer:</strong> ${escapeHtml(patternId)}</p>` +
    '<p class="workshop-test-placeholder">Composite JSON loaded. Ask Plugin Engineer to generate wrapper code, then test/register.</p>',
  );
  localStorage.removeItem(BLOCKLY_COMPOSER_EXPORT_KEY);
  return true;
}

function startBlankBuilder(confirmIfDirty = true) {
  if (confirmIfDirty && isBuilderDirty()) {
    const ok = confirm('Clear the current Indicator Builder state and start blank? Unsaved edits in the editor will be cleared.');
    if (!ok) return;
  }

  currentLocalDraftId = '';
  loadedBuilderPatternId = '';
  workshopGeneratedArtifacts = [];
  clearWorkshopValidationErrors();
  workshopLastTestResult = null;
  currentPluginDraft = null;

  setFieldValue('workshop-pattern-name', '');
  setFieldValue('workshop-pattern-id', 'new_plugin');
  setFieldValue('workshop-category', '');
  if (pluginEditor) pluginEditor.setValue('');
  if (jsonEditor) jsonEditor.setValue(JSON.stringify(DEFAULT_DEFINITION, null, 2));
  setTextContent('workshop-status', 'draft');
  scheduleWorkshopLiveValidation();
  renderTestOutput('<p class="workshop-test-placeholder">Blank Indicator Builder ready. Generate or paste plugin code to continue.</p>');
}

function upsertLocalDraft(draftPayload) {
  const drafts = loadLocalDraftsFromStorage();
  const existingIndex = drafts.findIndex((d) => d.draft_id === draftPayload.draft_id);
  if (existingIndex >= 0) {
    drafts[existingIndex] = normalizeLocalDraftRecord(draftPayload);
  } else {
    drafts.unshift(normalizeLocalDraftRecord(draftPayload));
  }
  drafts.sort((a, b) => parseDateSafe(b.saved_at) - parseDateSafe(a.saved_at));
  persistLocalDrafts(drafts);
  localStorage.setItem(WORKSHOP_DRAFT_KEY, JSON.stringify(draftPayload)); // legacy pointer to latest
  return drafts;
}

function deleteLocalDraftById(draftId) {
  const drafts = loadLocalDraftsFromStorage().filter((d) => d.draft_id !== draftId);
  persistLocalDrafts(drafts);
  if (!drafts.length) {
    localStorage.removeItem(WORKSHOP_DRAFT_KEY);
  } else {
    localStorage.setItem(
      WORKSHOP_DRAFT_KEY,
      JSON.stringify({
        draft_id: drafts[0].draft_id,
        saved_at: drafts[0].saved_at,
        pattern_name: drafts[0].pattern_name,
        pattern_id: drafts[0].pattern_id,
        category: drafts[0].category,
        code: drafts[0].code,
        definition: drafts[0].definition,
      }),
    );
  }
  return drafts;
}

async function initializeIndicatorLibrary(force = false) {
  if (indicatorLibrary.loading) return;
  if (indicatorLibrary.loaded && !force) {
    indicatorLibrary.localDrafts = loadLocalDraftsFromStorage();
    populateIndicatorLibraryFilters();
    renderIndicatorLibrary();
    return;
  }

  indicatorLibrary.loading = true;
  setLibraryListLoadingState('Loading indicator library...');

  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const registry = data?.data || {};
    const categories = Array.isArray(registry.categories) ? registry.categories : [];
    const patterns = Array.isArray(registry.patterns) ? registry.patterns : [];

    const categoryMap = {};
    categories.forEach((cat) => {
      if (!cat || typeof cat !== 'object') return;
      const id = String(cat.id || '').trim();
      if (!id) return;
      categoryMap[id] = String(cat.name || id);
    });

    const rows = patterns
      .filter((pattern) => pattern && typeof pattern === 'object')
      .map((pattern) => {
        const patternId = String(pattern.pattern_id || '').trim();
        const categoryId = String(pattern.category || 'custom').trim() || 'custom';
        const status = String(pattern.status || 'unknown').trim() || 'unknown';
        return {
          row_key: patternId,
          source: 'registered',
          draft_id: '',
          pattern_id: patternId,
          name: String(pattern.name || patternId || 'Unnamed Indicator'),
          category: categoryId,
          category_name: categoryMap[categoryId] || toLabelCase(categoryId),
          definition_file: String(pattern.definition_file || ''),
          status,
          artifact_type: inferArtifactTypeFromPattern(pattern),
          composition: inferCompositionFromPattern(pattern),
        };
      })
      .filter((row) => !!row.pattern_id)
      .sort((a, b) => a.name.localeCompare(b.name));

    indicatorLibrary = {
      ...indicatorLibrary,
      loaded: true,
      loading: false,
      registry,
      rows,
      localDrafts: loadLocalDraftsFromStorage(),
      categoryMap,
      detailsById: indicatorLibrary.detailsById || {},
      selectedPatternId: indicatorLibrary.selectedPatternId || '',
      loadingDetailId: '',
    };

    populateIndicatorLibraryFilters();
    renderIndicatorLibrary();
  } catch (error) {
    indicatorLibrary.loading = false;
    setLibraryListErrorState(`Failed to load indicator library: ${error.message || 'Unknown error'}`);
  }
}

function getAllLibraryRows() {
  const drafts = Array.isArray(indicatorLibrary.localDrafts) ? indicatorLibrary.localDrafts : [];
  const registered = Array.isArray(indicatorLibrary.rows) ? indicatorLibrary.rows : [];
  return [...drafts, ...registered];
}

function findLibraryRowByKey(rowKey) {
  return getAllLibraryRows().find((row) => row.row_key === rowKey) || null;
}

function populateIndicatorLibraryFilters() {
  const categorySelect = document.getElementById('workshop-library-category');
  const statusSelect = document.getElementById('workshop-library-status');
  if (!categorySelect || !statusSelect) return;

  const prevCategory = categorySelect.value;
  const prevStatus = statusSelect.value;

  const categoryPairs = new Map();
  getAllLibraryRows().forEach((row) => {
    categoryPairs.set(row.category, row.category_name || toLabelCase(row.category));
  });

  categorySelect.innerHTML = '<option value="">All</option>';
  Array.from(categoryPairs.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([id, name]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      categorySelect.appendChild(option);
    });

  statusSelect.innerHTML = '<option value="">All</option>';
  const statuses = Array.from(new Set(getAllLibraryRows().map((row) => row.status))).sort((a, b) => a.localeCompare(b));
  statuses.forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = toLabelCase(status);
    statusSelect.appendChild(option);
  });

  if (prevCategory && Array.from(categorySelect.options).some((opt) => opt.value === prevCategory)) {
    categorySelect.value = prevCategory;
  }
  if (prevStatus && Array.from(statusSelect.options).some((opt) => opt.value === prevStatus)) {
    statusSelect.value = prevStatus;
  }
}

function handleLibraryFilterChange() {
  renderIndicatorLibrary();
}

function getLibraryFilters() {
  const search = String(getFieldValue('workshop-library-search') || '').toLowerCase();
  const type = String(getFieldValue('workshop-library-type') || '');
  const category = String(getFieldValue('workshop-library-category') || '');
  const status = String(getFieldValue('workshop-library-status') || '');
  return { search, type, category, status };
}

function getFilteredIndicatorRows() {
  const filters = getLibraryFilters();
  return getAllLibraryRows().filter((row) => {
    if (filters.type === 'primitive' && row.composition !== 'primitive') return false;
    // "Composites" = composite indicators only (not patterns, primitives, or presets)
    if (filters.type === 'composite' && (row.composition !== 'composite' || row.artifact_type !== 'indicator')) return false;
    if (filters.type === 'pattern' && row.artifact_type !== 'pattern') return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.status && row.status !== filters.status) return false;

    if (!filters.search) return true;
    const haystack = [
      row.pattern_id,
      row.name,
      row.category,
      row.category_name,
      row.status,
      row.artifact_type,
      row.composition,
      row.source,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(filters.search);
  });
}

function renderIndicatorLibrary() {
  const summaryEl = document.getElementById('workshop-library-summary');
  const filtered = getFilteredIndicatorRows();
  const allRows = getAllLibraryRows();

  if (summaryEl) {
    const total = allRows.length;
    const draftCount = allRows.filter((r) => r.source === 'draft').length;
    const regCount = total - draftCount;
    summaryEl.textContent = `${filtered.length} of ${total} items (${draftCount} drafts, ${regCount} registered)`;
  }

  renderIndicatorLibraryList(filtered);

  if (!filtered.length) {
    indicatorLibrary.selectedPatternId = '';
    renderIndicatorLibraryDetail(null);
    return;
  }

  const selectedInFiltered = filtered.some((row) => row.row_key === indicatorLibrary.selectedPatternId);
  if (!selectedInFiltered) {
    indicatorLibrary.selectedPatternId = filtered[0].row_key;
  }

  renderIndicatorLibraryDetail(indicatorLibrary.selectedPatternId);
}

function renderIndicatorLibraryList(filteredRows) {
  const listEl = document.getElementById('workshop-library-list');
  if (!listEl) return;

  const draftRows = filteredRows.filter((row) => row.source === 'draft');
  const registeredRows = filteredRows.filter((row) => row.source !== 'draft');

  const renderGroup = (rows, groupTitle, emptyText) => {
    const groupRows = rows
      .map((row) => {
        const active = row.row_key === indicatorLibrary.selectedPatternId ? ' active' : '';
        const sourceLabel = row.source === 'draft' ? 'Local Draft' : 'Registered';
        const sourceClass = row.source === 'draft' ? 'is-draft' : 'is-registered';
        return `
          <button class="workshop-library-row${active}" data-row-key="${escapeHtml(row.row_key)}" type="button">
            <div class="workshop-library-row-top">
              <span class="workshop-library-row-name">${escapeHtml(row.name)}</span>
              <span class="workshop-library-row-source ${sourceClass}">${escapeHtml(sourceLabel)}</span>
            </div>
            <div class="workshop-library-row-meta">
              <span>${escapeHtml(row.pattern_id)}</span>
              <span>${escapeHtml(row.category_name || toLabelCase(row.category))}</span>
            </div>
          </button>
        `;
      })
      .join('');
    const body = groupRows || `<p class="workshop-test-placeholder">${escapeHtml(emptyText)}</p>`;
    return `<div class="workshop-library-group-title">${escapeHtml(groupTitle)}</div>${body}`;
  };

  listEl.innerHTML = `${renderGroup(draftRows, `Drafts (${draftRows.length})`, 'No local drafts yet. Use Save Draft in Indicator Builder.')}${renderGroup(registeredRows, `Registered (${registeredRows.length})`, 'No registered indicators match current filters.')}`;

  listEl.querySelectorAll('.workshop-library-row').forEach((node) => {
    node.addEventListener('click', () => {
      const rowKey = node.getAttribute('data-row-key');
      if (rowKey) selectIndicatorFromLibrary(rowKey);
    });
  });
}

function renderIndicatorLibraryDetail(rowKey) {
  const detailEl = document.getElementById('workshop-library-detail');
  if (!detailEl) return;

  if (!rowKey) {
    detailEl.innerHTML = '<p class="workshop-test-placeholder">Select an indicator to inspect details.</p>';
    return;
  }

  const row = findLibraryRowByKey(rowKey);
  if (!row) {
    detailEl.innerHTML = '<p class="workshop-test-placeholder">Indicator not found.</p>';
    return;
  }

  const detail = row.source === 'draft'
    ? (tryParseJson(row.definition) || {})
    : indicatorLibrary.detailsById[row.pattern_id];
  const isLoading = row.source === 'draft' ? false : indicatorLibrary.loadingDetailId === row.pattern_id;

  const description = detail && typeof detail.description === 'string' ? detail.description : '';
  const tunableCount = detail && Array.isArray(detail.tunable_params) ? detail.tunable_params.length : 0;
  const tfCount = detail && Array.isArray(detail.suggested_timeframes) ? detail.suggested_timeframes.length : 0;
  const minBars = detail && detail.min_data_bars != null ? String(detail.min_data_bars) : 'N/A';
  const savedAt = row.saved_at ? new Date(row.saved_at).toLocaleString() : '';

  detailEl.innerHTML = `
    <div class="workshop-library-detail-grid">
      <div><span class="label">Name</span><div>${escapeHtml(row.name)}</div></div>
      <div><span class="label">Pattern ID</span><div class="text-mono">${escapeHtml(row.pattern_id)}</div></div>
      <div><span class="label">Category</span><div>${escapeHtml(row.category_name || toLabelCase(row.category))}</div></div>
      <div><span class="label">Status</span><div>${escapeHtml(toLabelCase(row.status))}</div></div>
      <div><span class="label">Min Bars</span><div>${escapeHtml(minBars)}</div></div>
      <div><span class="label">Timeframes</span><div>${escapeHtml(String(tfCount))}</div></div>
      <div><span class="label">Tunable Params</span><div>${escapeHtml(String(tunableCount))}</div></div>
      <div><span class="label">Definition</span><div class="text-mono">${escapeHtml(row.definition_file || 'N/A')}</div></div>
      ${row.source === 'draft' ? `<div><span class="label">Saved</span><div>${escapeHtml(savedAt || 'Unknown')}</div></div>` : ''}
    </div>
    ${description ? `<p class="workshop-library-description">${escapeHtml(description)}</p>` : ''}
    <div class="workshop-library-detail-actions">
      <button id="workshop-load-builder-btn" class="btn btn-primary" type="button">${row.source === 'draft' ? 'Load Draft to Indicator Builder' : 'Load to Indicator Builder'}</button>
      ${row.composition !== 'composite' && row.source !== 'draft'
        ? '<button id="workshop-build-composite-btn" class="btn" style="background:var(--color-purple,#6366f1);color:#fff;" type="button" title="Start a new composite indicator using this primitive as a stage">Build Composite →</button>'
        : ''}
      <button id="workshop-load-strategy-btn" class="btn" style="background:var(--color-surface-hover);" type="button" title="Open Strategy Page to build a strategy using this indicator">Build Strategy</button>
      ${row.source === 'draft'
        ? '<button id="workshop-delete-draft-btn" class="btn btn-ghost" type="button">Delete Draft</button>'
        : '<button id="workshop-refresh-detail-btn" class="btn btn-ghost" type="button">Refresh Detail</button>'}
      ${row.source !== 'draft' ? '<button id="workshop-edit-indicator-btn" class="btn btn-ghost" type="button">Edit</button>' : ''}
      ${row.source !== 'draft' ? '<button id="workshop-edit-json-btn" class="btn btn-ghost" type="button">Edit JSON</button>' : ''}
      ${row.source !== 'draft' ? '<button id="workshop-delete-indicator-btn" class="btn btn-ghost" style="color:var(--color-red,#ef4444);" type="button">Delete</button>' : ''}
    </div>
    ${isLoading ? '<p class="workshop-test-placeholder">Loading full definition...</p>' : ''}
  `;

  const loadButton = document.getElementById('workshop-load-builder-btn');
  if (loadButton) {
    loadButton.addEventListener('click', () => loadIndicatorIntoBuilder(row.row_key));
  }

  const buildCompositeBtn = document.getElementById('workshop-build-composite-btn');
  if (buildCompositeBtn) {
    buildCompositeBtn.addEventListener('click', () => startCompositeFromPrimitive(row.row_key));
  }

  const loadStrategyBtn = document.getElementById('workshop-load-strategy-btn');
  if (loadStrategyBtn) {
    loadStrategyBtn.addEventListener('click', () => {
      const seedText = `Create a breakout strategy using the existing \`${row.pattern_id}\` primitive.\n\nSetup Rules:\n- Use the \`${row.pattern_id}\` primitive.\n\nEntry Logic:\n- Enter on the first weekly close above the breakout point.\n\nExit Logic:\n- Stop Loss: ATR-based trailing stop (multiplier: 2.0).\n- Take Profit: Fixed target of 3.0R.\n- Max Hold Time: 20 bars.`;
      window.location.href = `strategy.html?seed=${encodeURIComponent(seedText)}`;
    });
  }

  if (row.source === 'draft') {
    const deleteButton = document.getElementById('workshop-delete-draft-btn');
    if (deleteButton) {
      deleteButton.addEventListener('click', () => {
        const ok = confirm(`Delete local draft "${row.pattern_name || row.pattern_id}"?`);
        if (!ok) return;
        indicatorLibrary.localDrafts = deleteLocalDraftById(String(row.draft_id || ''));
        if (currentLocalDraftId && currentLocalDraftId === String(row.draft_id || '')) {
          currentLocalDraftId = '';
        }
        populateIndicatorLibraryFilters();
        renderIndicatorLibrary();
      });
    }
  } else {
    const refreshButton = document.getElementById('workshop-refresh-detail-btn');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => selectIndicatorFromLibrary(row.row_key, true));
    }
    const editButton = document.getElementById('workshop-edit-indicator-btn');
    if (editButton) {
      editButton.addEventListener('click', () => renderIndicatorEditForm(row, detail || {}));
    }
    const editJsonButton = document.getElementById('workshop-edit-json-btn');
    if (editJsonButton) {
      editJsonButton.addEventListener('click', () => renderIndicatorJsonEditor(row, detail || {}));
    }
    const deleteIndicatorBtn = document.getElementById('workshop-delete-indicator-btn');
    if (deleteIndicatorBtn) {
      deleteIndicatorBtn.addEventListener('click', async () => {
        const name = row.pattern_name || row.pattern_id;
        const ok = confirm(`Permanently delete "${name}"?\n\nThis will remove the registry entry, JSON definition, and plugin file. This cannot be undone.`);
        if (!ok) return;
        try {
          deleteIndicatorBtn.disabled = true;
          deleteIndicatorBtn.textContent = 'Deleting...';
          const resp = await fetch(`/api/plugins/${encodeURIComponent(row.pattern_id)}`, { method: 'DELETE' });
          const result = await resp.json();
          if (!resp.ok || !result.success) {
            alert(`Delete failed: ${result.error || 'Unknown error'}`);
            return;
          }
          delete indicatorLibrary.detailsById[row.pattern_id];
          indicatorLibrary.selectedRowKey = '';
          indicatorLibrary.loaded = false;
          await initializeIndicatorLibrary(true);
        } catch (err) {
          alert(`Delete failed: ${err.message || err}`);
        } finally {
          if (deleteIndicatorBtn) {
            deleteIndicatorBtn.disabled = false;
            deleteIndicatorBtn.textContent = 'Delete';
          }
        }
      });
    }
  }
}

function renderIndicatorEditForm(row, detail) {
  const detailEl = document.getElementById('workshop-library-detail');
  if (!detailEl) return;

  const ROLE_OPTIONS = [
    ['anchor_structure', 'Structure'],
    ['location', 'Location'],
    ['location_filter', 'Location Filter'],
    ['timing_trigger', 'Timing Trigger'],
    ['trigger', 'Trigger'],
    ['state_filter', 'State Filter'],
    ['regime_state', 'Regime State'],
    ['pattern_gate', 'Regime Filter'],
    ['entry_composite', 'Entry Composite'],
    ['exit_composite', 'Exit Composite'],
    ['analysis_payload', 'Analysis'],
  ];

  const CATEGORY_OPTIONS = [
    'indicator_signals', 'price_action', 'chart_patterns', 'scan_pipelines', 'custom',
  ];

  const STATUS_OPTIONS = ['experimental', 'stable', 'deprecated'];

  const currentRole = String(detail.indicator_role || row.indicator_role || '');
  const currentCat = String(detail.category || row.category || 'indicator_signals');
  const currentStatus = String(detail.status || row.status || 'experimental');

  const roleOpts = ROLE_OPTIONS.map(([val, label]) =>
    `<option value="${val}" ${currentRole === val ? 'selected' : ''}>${label}</option>`
  ).join('');

  const catOpts = CATEGORY_OPTIONS.map(cat =>
    `<option value="${cat}" ${currentCat === cat ? 'selected' : ''}>${cat}</option>`
  ).join('');

  const statusOpts = STATUS_OPTIONS.map(s =>
    `<option value="${s}" ${currentStatus === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  detailEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-12);padding-bottom:var(--space-8);">
      <div class="sidebar-field">
        <label class="sidebar-field-label">Name</label>
        <input id="edit-indicator-name" class="input input-sm" style="width:100%;" value="${escapeHtml(row.name || '')}">
      </div>
      <div class="sidebar-field">
        <label class="sidebar-field-label">Description</label>
        <textarea id="edit-indicator-desc" class="input input-sm" rows="3" style="width:100%;resize:vertical;">${escapeHtml(detail.description || '')}</textarea>
      </div>
      <div class="sidebar-field">
        <label class="sidebar-field-label">Category</label>
        <select id="edit-indicator-category" class="select select-sm" style="width:100%;">${catOpts}</select>
      </div>
      <div class="sidebar-field">
        <label class="sidebar-field-label">Indicator Role</label>
        <select id="edit-indicator-role" class="select select-sm" style="width:100%;">${roleOpts}</select>
      </div>
      <div class="sidebar-field">
        <label class="sidebar-field-label">Status</label>
        <select id="edit-indicator-status" class="select select-sm" style="width:100%;">${statusOpts}</select>
      </div>
      <div id="edit-indicator-feedback" style="font-size:var(--text-caption);"></div>
      <div style="display:flex;gap:var(--space-8);">
        <button id="edit-indicator-save-btn" class="btn btn-primary btn-sm">Save Changes</button>
        <button id="edit-indicator-cancel-btn" class="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('edit-indicator-cancel-btn')?.addEventListener('click', () => {
    renderIndicatorLibraryDetail(row.row_key);
  });

  document.getElementById('edit-indicator-save-btn')?.addEventListener('click', async () => {
    const feedback = document.getElementById('edit-indicator-feedback');
    const updates = {
      name: document.getElementById('edit-indicator-name')?.value?.trim(),
      description: document.getElementById('edit-indicator-desc')?.value?.trim(),
      category: document.getElementById('edit-indicator-category')?.value,
      indicator_role: document.getElementById('edit-indicator-role')?.value,
      status: document.getElementById('edit-indicator-status')?.value,
    };

    if (!updates.name) {
      if (feedback) feedback.textContent = 'Name is required.';
      return;
    }

    if (feedback) feedback.textContent = 'Saving...';

    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(row.pattern_id)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (feedback) feedback.textContent = `Error: ${data.error || 'Save failed.'}`;
        return;
      }
      // Refresh the library and re-select this indicator
      await initializeIndicatorLibrary(true);
      selectIndicatorFromLibrary(row.row_key, true);
    } catch (err) {
      if (feedback) feedback.textContent = `Error: ${err?.message || 'Unknown error.'}`;
    }
  });
}

function renderIndicatorJsonEditor(row, detail) {
  const detailEl = document.getElementById('workshop-library-detail');
  if (!detailEl) return;

  const jsonText = JSON.stringify(detail, null, 2);

  detailEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-12);padding-bottom:var(--space-8);">
      <div class="sidebar-field">
        <label class="sidebar-field-label">Definition JSON — editing overwrites in place</label>
        <textarea id="edit-indicator-json" class="input input-sm" rows="24" style="width:100%;resize:vertical;font-family:monospace;font-size:11px;">${escapeHtml(jsonText)}</textarea>
      </div>
      <div id="edit-json-feedback" style="font-size:var(--text-caption);"></div>
      <div style="display:flex;gap:var(--space-8);">
        <button id="edit-json-save-btn" class="btn btn-primary btn-sm">Save JSON</button>
        <button id="edit-json-cancel-btn" class="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('edit-json-cancel-btn')?.addEventListener('click', () => {
    renderIndicatorLibraryDetail(row.row_key);
  });

  document.getElementById('edit-json-save-btn')?.addEventListener('click', async () => {
    const feedback = document.getElementById('edit-json-feedback');
    const raw = document.getElementById('edit-indicator-json')?.value || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      if (feedback) feedback.textContent = `Invalid JSON: ${e?.message}`;
      return;
    }

    if (feedback) feedback.textContent = 'Saving...';

    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(row.pattern_id)}/definition`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: parsed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (feedback) feedback.textContent = `Error: ${data.error || 'Save failed.'}`;
        return;
      }
      await initializeIndicatorLibrary(true);
      selectIndicatorFromLibrary(row.row_key, true);
    } catch (err) {
      if (feedback) feedback.textContent = `Error: ${err?.message || 'Unknown error.'}`;
    }
  });
}

async function selectIndicatorFromLibrary(rowKey, forceRefresh = false) {
  indicatorLibrary.selectedPatternId = rowKey;
  renderIndicatorLibrary();

  const row = findLibraryRowByKey(rowKey);
  if (!row) return;
  if (row.source === 'draft') {
    renderIndicatorLibraryDetail(rowKey);
    return;
  }
  const patternId = row.pattern_id;
  if (!forceRefresh && indicatorLibrary.detailsById[patternId]) return;

  indicatorLibrary.loadingDetailId = patternId;
  renderIndicatorLibraryDetail(rowKey);

  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(patternId)}`);
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const definition = data.data || {};
    indicatorLibrary.detailsById[patternId] = definition;
  } catch (error) {
    console.warn(`Failed to load indicator detail for ${patternId}:`, error);
  } finally {
    if (indicatorLibrary.loadingDetailId === patternId) {
      indicatorLibrary.loadingDetailId = '';
    }
    if (indicatorLibrary.selectedPatternId === rowKey) {
      renderIndicatorLibraryDetail(rowKey);
    }
  }
}

function loadLocalDraftIntoBuilder(draftRow) {
  applyDraftToBuilder(draftRow);
  setWorkshopTab('builder');
}

async function loadIndicatorIntoBuilder(rowKey) {
  const row = findLibraryRowByKey(rowKey);
  if (!row) {
    alert('Selected indicator was not found.');
    return;
  }
  if (row.source === 'draft') {
    loadLocalDraftIntoBuilder(row);
    return;
  }
  const patternId = row.pattern_id;
  try {
    const [definitionRes, sourceRes] = await Promise.all([
      fetch(`/api/plugins/${encodeURIComponent(patternId)}`),
      fetch(`/api/plugins/${encodeURIComponent(patternId)}/source`),
    ]);

    const definitionData = await definitionRes.json();
    if (!definitionRes.ok || !definitionData?.success) {
      throw new Error(definitionData?.error || `Failed to load definition (${definitionRes.status})`);
    }

    const definition = definitionData?.data || {};
    const sourceData = sourceRes.ok ? await sourceRes.json() : null;
    const sourceCode = sourceData?.success ? String(sourceData?.data?.code || '') : '';
    const loadedPatternId = String(definition.pattern_id || patternId);

    setFieldValue('workshop-pattern-name', String(definition.name || patternId));
    setFieldValue('workshop-pattern-id', loadedPatternId);
    setFieldValue('workshop-category', String(definition.category || 'custom'));
    setTextContent('workshop-status', String(definition.status || 'loaded'));
    loadedBuilderPatternId = loadedPatternId;
    currentLocalDraftId = '';

    if (pluginEditor) {
      pluginEditor.setValue(sourceCode || '');
    }

    if (jsonEditor) {
      jsonEditor.setValue(JSON.stringify(definition, null, 2));
    }

    currentPluginDraft = {
      code: sourceCode,
      definition,
      name: String(definition.name || patternId),
      category: String(definition.category || 'custom'),
      updated_at: new Date().toISOString(),
    };
    workshopGeneratedArtifacts = [];
    scheduleWorkshopLiveValidation();

    setWorkshopTab('builder');
    renderTestOutput(
      `<p><strong>Loaded:</strong> ${escapeHtml(String(definition.pattern_id || patternId))}</p>` +
      `${sourceCode ? '' : '<p class="workshop-test-placeholder">Source file was not found; definition loaded.</p>'}`,
    );
  } catch (error) {
    alert(`Failed to load indicator into Indicator Builder: ${error.message || 'Unknown error'}`);
  }
}

// -------------------------------------------------------------------------
// Build Composite from Primitive — routes to the dedicated Composite Builder
// -------------------------------------------------------------------------
async function startCompositeFromPrimitive(rowKey) {
  const row = findLibraryRowByKey(rowKey);
  if (!row) {
    alert('Primitive not found in library.');
    return;
  }

  let detail = indicatorLibrary.detailsById[row.pattern_id] || null;
  if (!detail) {
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(row.pattern_id)}`);
      const data = await res.json();
      if (data?.success) detail = data.data || {};
    } catch (_) {}
  }

  const primitiveRole = detail?.indicator_role || row.indicator_role || 'unknown';
  const primitiveName = row.name || row.pattern_id;
  const primitiveId = row.pattern_id;

  // Switch to the Composite Builder tab → AI Composer sub-tab
  setWorkshopTab('composite');
  setCompositeSubTab('ai');

  // Seed the composite builder with this primitive
  if (typeof seedCompositeFromPrimitive === 'function') {
    seedCompositeFromPrimitive(primitiveId, primitiveRole, primitiveName, detail);
  }
}

function setLibraryListLoadingState(text) {
  const listEl = document.getElementById('workshop-library-list');
  const detailEl = document.getElementById('workshop-library-detail');
  if (listEl) listEl.innerHTML = `<p class="workshop-test-placeholder">${escapeHtml(text)}</p>`;
  if (detailEl) detailEl.innerHTML = '<p class="workshop-test-placeholder">Select an indicator to inspect details.</p>';
}

function setLibraryListErrorState(text) {
  const listEl = document.getElementById('workshop-library-list');
  if (listEl) listEl.innerHTML = `<p class="workshop-test-error">${escapeHtml(text)}</p>`;
}

function toLabelCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function inferCompositionFromPattern(pattern) {
  const explicit = String(pattern?.composition || '').trim().toLowerCase();
  if (explicit === 'primitive' || explicit === 'composite') return explicit;

  const patternId = String(pattern?.pattern_id || '').trim().toLowerCase();
  if (patternId.endsWith('_primitive')) return 'primitive';
  if (patternId.endsWith('_composite')) return 'composite';

  const name = String(pattern?.name || '').trim().toLowerCase();
  if (name.includes('(primitive)')) return 'primitive';
  if (name.includes('(composite)')) return 'composite';

  return 'composite';
}

function inferArtifactTypeFromPattern(pattern) {
  const explicit = String(pattern?.artifact_type || '').trim().toLowerCase();
  if (explicit === 'indicator' || explicit === 'pattern') return explicit;

  const category = String(pattern?.category || '').trim().toLowerCase();
  if (category === 'chart_patterns' || category === 'scan_pipelines') return 'pattern';
  return 'indicator';
}
