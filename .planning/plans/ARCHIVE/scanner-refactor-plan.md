# Scanner Page Refactor — Step-by-Step Build Plan

> Hand this to your coding AI. It contains everything needed to refactor the Scanner page into a clean production tool and move R&D features into the Indicator Studio.

---

## Overview

The Scanner page (`index.html` / `index.js`) currently mixes two concerns:
1. **Production scanning** — finding trading candidates with validated strategies
2. **R&D pattern development** — labeling, corrections, ML feedback, legacy scan modes

This refactor splits them:
- **Scanner page** becomes a clean production tool (scan → candidates → trading desk)
- **Indicator Studio** gains a Pattern Scanner tab with chart + corrections + labels

---

## Architecture Context

### Current Scanner Page Structure

**File:** `frontend/public/index.html` + `frontend/public/index.js`

**Current scan modes** (in dropdown `#scan-mode`):
- `wyckoff` — Wyckoff Accumulation (uses `strategyRunner.py`)
- `swing` — Swing Structure (uses `patternScanner.py`)
- `fib-energy` — Fib + Energy (uses `patternScanner.py`)
- `discount-only` — Discount Zone (uses `patternScanner.py`)
- `discount` — Discount + Wyckoff (uses `patternScanner.py`)

**Current UI sections:**
- Scan controls (symbol, period, interval, mode, strategy, scope)
- Discount results panel
- Chart container (LightweightCharts) with drawing canvas overlay
- Candidate info panel (Wyckoff phases, rule checklist)
- Correction panel (hidden by default)
- Label buttons (YES, NO, CORRECT IT, SKIP)
- AI analysis panel with chat

**Key functions in `index.js`:**
- `runScan()` — line ~2066, main scan function
- `loadCandidates()` — line ~1136, fetches unlabeled candidates
- `showCandidate()` — line ~1176, displays candidate details
- `drawPatternChart()` — line ~560, renders chart with LightweightCharts
- `submitLabel()` — line ~1393, POSTs to `/api/labels`
- `enterCorrectionMode()` — line ~1526, shows correction panel
- `saveDrawingCorrection()` — line ~1660, POSTs to `/api/corrections`
- `onScanModeChange()` — line ~4500, shows/hides UI elements

**Key element IDs:**
- Chart: `pattern-chart`, `chart-container`, `drawing-canvas`
- Candidate info: `candidate-details`, `candidate-strategy-bar`, `rule-checklist-items`
- Labels: `label-grid`
- Corrections: `correction-panel`
- AI: `ai-panel`, `scanner-chat-messages`, `scanner-chat-input`
- Controls: `scan-mode`, `scan-strategy`, `scan-scope`, `scan-symbol`

### Backend Routes

**`backend/src/routes/candidates.ts`:**
- `POST /api/candidates/scan` — main scan endpoint
  - Strategy path (wyckoff): calls `runStrategyRunner()` → spawns `strategyRunner.py`
  - Legacy path (swing, fib-energy, discount): spawns `patternScanner.py`
- `POST /api/candidates/scan-batch` — batch scan
- `GET /api/candidates/unlabeled` — get unlabeled candidates (for labeling flow)

**`backend/src/routes/labels.ts`:**
- `POST /api/labels` — save a label
- `GET /api/labels/stats` — label statistics

**`backend/src/routes/corrections.ts`:**
- `POST /api/corrections` — save correction (drawing annotations or traditional)

### Chart Library
LightweightCharts v4.1.0 — loaded from CDN. Already used on both Scanner and Co-Pilot pages.

### Navigation Sidebar
Defined in each HTML file. Current nav items:
- Scanner (index.html)
- Co-Pilot (copilot.html)
- Trading Desk (history.html)
- Validator (validator.html)
- Strategy (strategy.html)
- Workshop (workshop.html) — if Workshop plan has been implemented

---

## Step 1: Clean Up the Scanner Page (Production Only)

### 1.1: Simplify the Scan Mode Dropdown

**File:** `frontend/public/index.html`

Replace the current scan mode dropdown with a strategy-based selector. The Scanner no longer picks "modes" — it picks validated strategies from the library.

**Remove** the `scan-mode` dropdown with options (wyckoff, swing, fib-energy, discount-only, discount).

**Replace with:**

```html
<div class="scan-control-group">
  <label for="scan-strategy-select">Strategy</label>
  <select id="scan-strategy-select">
    <option value="">-- Select a validated strategy --</option>
    <!-- Populated dynamically from /api/strategies?status=approved -->
  </select>
</div>

<div class="scan-control-group">
  <label for="scan-universe">Universe</label>
  <select id="scan-universe">
    <option value="watchlist">My Watchlist</option>
    <option value="sp500">S&P 500</option>
    <option value="custom">Custom Symbols</option>
  </select>
</div>

<div class="scan-control-group" id="custom-symbols-group" style="display:none;">
  <label for="scan-symbols-input">Symbols (comma-separated)</label>
  <input type="text" id="scan-symbols-input" placeholder="SPY, AAPL, MSFT..." />
</div>
```

### 1.2: Remove R&D UI Elements

**File:** `frontend/public/index.html`

**Remove or hide:**
- The label buttons grid (`#label-grid` — YES, NO, CORRECT IT, SKIP)
- The correction panel (`#correction-panel`)
- The drawing canvas overlay (`#drawing-canvas`) — production scanner doesn't need drawing tools
- The scan scope toggle (Production/Research) — it's always production now
- The discount results panel (`#discount-results-panel`) — discount mode moves to Studio
- The ML scores section inside AI panel (`#ml-scores`)

**Keep:**
- Chart container (`#chart-container`, `#pattern-chart`) — for viewing candidate charts
- Candidate info panel (`#candidate-details`) — for viewing signal details and rule checklist
- AI chat panel (`#ai-panel`, `#scanner-chat-messages`) — Contextual Ranker AI
- Scan controls (symbol, period, interval) — but simplified
- Batch scan button

### 1.3: Simplify the Scan Function

**File:** `frontend/public/index.js`

Rewrite `runScan()` to only support the strategy path:

```javascript
async function runScan() {
  const strategyId = document.getElementById('scan-strategy-select').value;
  if (!strategyId) {
    alert('Please select a validated strategy.');
    return;
  }

  const universe = document.getElementById('scan-universe').value;
  let symbols = [];

  if (universe === 'custom') {
    const input = document.getElementById('scan-symbols-input').value;
    symbols = input.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  } else if (universe === 'watchlist') {
    symbols = await fetchWatchlist();
  } else if (universe === 'sp500') {
    symbols = await fetchSP500();
  }

  if (symbols.length === 0) {
    alert('No symbols to scan.');
    return;
  }

  document.getElementById('scan-status').textContent = 'Scanning...';
  document.getElementById('btn-scan').disabled = true;

  try {
    const results = [];
    const progress = document.getElementById('batch-progress');

    for (let i = 0; i < symbols.length; i++) {
      progress.textContent = `${i + 1} / ${symbols.length}: ${symbols[i]}`;

      const res = await fetch('/api/candidates/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbols[i],
          strategyId: strategyId,
          scanMode: 'strategy',
          interval: document.getElementById('scan-interval').value,
          period: document.getElementById('scan-period').value,
        })
      });
      const data = await res.json();

      if (data.success && data.data?.candidates?.length > 0) {
        results.push(...data.data.candidates.map(c => ({
          ...c,
          symbol: symbols[i]
        })));
      }
    }

    // Sort by score descending
    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Display results
    candidates = results;
    renderCandidateList(results);

    document.getElementById('scan-status').textContent =
      `Found ${results.length} candidate(s) across ${symbols.length} symbols`;

  } catch (err) {
    document.getElementById('scan-status').textContent = 'Scan failed: ' + err.message;
  }

  document.getElementById('btn-scan').disabled = false;
}
```

### 1.4: Add Candidate List View

**File:** `frontend/public/index.html`

Add a results table/list between the scan controls and the chart. This shows all candidates from the scan:

```html
<div id="scan-results-panel" class="scan-results-panel" style="display:none;">
  <div class="scan-results-header">
    <span id="scan-results-count">0 candidates</span>
    <button onclick="exportCandidates()">Export CSV</button>
  </div>
  <div id="scan-results-list" class="scan-results-list">
    <!-- Candidate rows rendered here -->
  </div>
</div>
```

Each candidate row:
```html
<div class="scan-result-row" onclick="selectCandidate(index)">
  <span class="result-symbol">SPY</span>
  <span class="result-pattern">MA Crossover</span>
  <span class="result-score">0.85</span>
  <span class="result-entry">Ready</span>
  <span class="result-date">2025-06-27</span>
  <button class="result-action" onclick="sendToTradingDesk(index)">Trade →</button>
</div>
```

### 1.5: Add "Send to Trading Desk" Flow

**File:** `frontend/public/index.js`

When the user clicks "Trade →" on a candidate, store it and navigate to the Trading Desk:

```javascript
function sendToTradingDesk(candidateIndex) {
  const candidate = candidates[candidateIndex];
  // Store candidate + strategy in sessionStorage for Trading Desk to pick up
  sessionStorage.setItem('pending_trade', JSON.stringify({
    candidate: candidate,
    strategy_id: document.getElementById('scan-strategy-select').value,
    timestamp: new Date().toISOString()
  }));
  window.location.href = '/history.html?action=new_from_scan';
}
```

### 1.6: Populate Strategy Dropdown on Page Load

**File:** `frontend/public/index.js`

On page load, fetch approved strategies and populate the dropdown:

```javascript
async function loadApprovedStrategies() {
  try {
    const res = await fetch('/api/strategies?status=approved');
    const data = await res.json();
    const select = document.getElementById('scan-strategy-select');

    if (data.success && data.data) {
      data.data.forEach(strategy => {
        const option = document.createElement('option');
        option.value = strategy.strategy_id;
        option.textContent = `${strategy.name} (${strategy.setup_config?.pattern_type || 'unknown'})`;
        select.appendChild(option);
      });
    }

    // Also allow draft strategies for testing (with visual indicator)
    const resDraft = await fetch('/api/strategies?status=draft');
    const dataDraft = await resDraft.json();
    if (dataDraft.success && dataDraft.data?.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = '── Draft (not validated) ──';
      dataDraft.data.forEach(strategy => {
        const option = document.createElement('option');
        option.value = strategy.strategy_id;
        option.textContent = `⚠ ${strategy.name} (draft)`;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    }
  } catch (err) {
    console.error('Failed to load strategies:', err);
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', loadApprovedStrategies);
```

### 1.7: Remove Legacy Scan Functions

**File:** `frontend/public/index.js`

**Remove or comment out** the following functions that are no longer needed on the production Scanner page (they'll move to the Studio):

- `submitLabel()` — moves to Studio
- `enterCorrectionMode()` — moves to Studio
- `saveDrawingCorrection()` — moves to Studio
- All drawing tool functions (`initDrawingTools`, `onCanvasMouseDown`, etc.) — move to Studio
- `loadCandidates()` for unlabeled flow — the production scanner doesn't use labels
- Legacy scan mode handlers for `swing`, `fib-energy`, `discount`

**Keep:**
- `drawPatternChart()` — still needed to view candidate charts
- `showCandidate()` — still needed but simplified (no label buttons)
- Chart rendering functions
- AI chat functions (but change role to `contextual_ranker`)

---

## Step 2: Add Pattern Scanner to Indicator Studio

### 2.1: Add a Tab System to the Workshop Page

**File:** `frontend/public/workshop.html`

The Workshop page (if already built from the Plugin Workshop plan) needs tabs:

```html
<div class="workshop-tabs">
  <button class="workshop-tab active" onclick="switchTab('code')">Code Editor</button>
  <button class="workshop-tab" onclick="switchTab('pattern-scanner')">Pattern Scanner</button>
  <button class="workshop-tab" onclick="switchTab('library')">Library</button>
</div>

<div id="tab-code" class="workshop-tab-content active">
  <!-- Existing Workshop content: chat + Monaco editor -->
</div>

<div id="tab-pattern-scanner" class="workshop-tab-content" style="display:none;">
  <!-- Pattern Scanner R&D content (moved from index.html) -->
</div>

<div id="tab-library" class="workshop-tab-content" style="display:none;">
  <!-- Library browser: list all indicators in registry -->
</div>
```

### 2.2: Build the Pattern Scanner Tab

**File:** `frontend/public/workshop.html` (inside `#tab-pattern-scanner`)

This is the R&D scanner — it has the chart, corrections, labels, and ML feedback that were removed from the production Scanner.

```html
<div class="pattern-scanner-container">
  <!-- Left: Controls + Candidate List -->
  <div class="ps-controls-panel">
    <h3>Pattern Scanner (R&D)</h3>

    <div class="ps-control-group">
      <label>Indicator</label>
      <select id="ps-indicator">
        <!-- Populated from /api/plugins -->
      </select>
    </div>

    <div class="ps-control-group">
      <label>Symbol</label>
      <input type="text" id="ps-symbol" value="SPY" />
    </div>

    <div class="ps-control-group">
      <label>Interval</label>
      <select id="ps-interval">
        <option value="1d">Daily</option>
        <option value="1wk" selected>Weekly</option>
      </select>
    </div>

    <div class="ps-control-group">
      <label>Period</label>
      <select id="ps-period">
        <option value="2y">2 Years</option>
        <option value="5y">5 Years</option>
        <option value="max" selected>Max</option>
      </select>
    </div>

    <button id="ps-scan-btn" onclick="runPatternScan()">Scan</button>
    <div id="ps-scan-status"></div>

    <!-- Candidate list for labeling -->
    <div id="ps-candidate-list" class="ps-candidate-list">
      <!-- Rendered after scan -->
    </div>

    <!-- Label buttons -->
    <div id="ps-label-grid" class="ps-label-grid">
      <button class="label-btn label-yes" onclick="psSubmitLabel('YES')">YES</button>
      <button class="label-btn label-no" onclick="psSubmitLabel('NO')">NO</button>
      <button class="label-btn label-correct" onclick="psEnterCorrection()">CORRECT IT</button>
      <button class="label-btn label-skip" onclick="psSubmitLabel('SKIP')">SKIP</button>
    </div>

    <!-- Label stats -->
    <div id="ps-label-stats" class="ps-label-stats">
      <span id="ps-yes-count">0</span> YES /
      <span id="ps-no-count">0</span> NO /
      <span id="ps-total-count">0</span> Total
    </div>
  </div>

  <!-- Center: Chart -->
  <div class="ps-chart-panel">
    <div id="ps-chart-container" class="ps-chart-container">
      <div id="ps-chart" style="width:100%; height:400px;"></div>
      <canvas id="ps-drawing-canvas" class="ps-drawing-canvas"></canvas>
    </div>

    <!-- Correction panel (shown when CORRECT IT is clicked) -->
    <div id="ps-correction-panel" class="ps-correction-panel" style="display:none;">
      <h4>Correction Mode</h4>
      <p>Click on the chart to mark the correct pattern phases.</p>
      <div class="ps-correction-tools">
        <button onclick="psSetDrawingTool('peak')">Peak</button>
        <button onclick="psSetDrawingTool('base_start')">Base Start</button>
        <button onclick="psSetDrawingTool('base_end')">Base End</button>
        <button onclick="psSetDrawingTool('markup')">Markup</button>
        <button onclick="psSetDrawingTool('pullback')">Pullback</button>
      </div>
      <button onclick="psSaveCorrection()">Save Correction</button>
      <button onclick="psCancelCorrection()">Cancel</button>
    </div>

    <!-- Candidate details -->
    <div id="ps-candidate-details" class="ps-candidate-details">
      <h4 id="ps-candidate-title">No candidate selected</h4>
      <div id="ps-rule-checklist"></div>
      <div id="ps-anchors"></div>
    </div>
  </div>

  <!-- Right: AI Analysis -->
  <div class="ps-ai-panel">
    <div class="ps-ai-header">Pattern Analyst</div>
    <div id="ps-ai-messages" class="ps-ai-messages"></div>
    <div class="ps-ai-input-row">
      <textarea id="ps-ai-input" placeholder="Ask about this pattern..."></textarea>
      <button onclick="sendPatternAnalysis()">Send</button>
    </div>
    <div class="ps-ai-actions">
      <button onclick="sendPatternAnalysis('Is this a valid pattern?')">Validate</button>
      <button onclick="sendPatternAnalysis('What could improve detection?')">Improve</button>
      <button onclick="sendPatternAnalysis('Show me similar patterns')">Similar</button>
    </div>
  </div>
</div>
```

### 2.3: Add Pattern Scanner JavaScript

**File:** `frontend/public/workshop.js`

Add the Pattern Scanner functions. These are largely moved from `index.js`:

```javascript
// ── Pattern Scanner State ───────────────────────────────────────
let psCandidates = [];
let psCurrentIndex = 0;
let psChart = null;

// ── Tab Switching ───────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.workshop-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.workshop-tab-content').forEach(t => {
    t.style.display = 'none';
    t.classList.remove('active');
  });
  document.getElementById('tab-' + tabName).style.display = '';
  document.getElementById('tab-' + tabName).classList.add('active');
  event.target.classList.add('active');

  // Initialize chart on first visit to pattern scanner tab
  if (tabName === 'pattern-scanner' && !psChart) {
    initPatternScannerChart();
  }
}

// ── Chart Init ──────────────────────────────────────────────────
function initPatternScannerChart() {
  const container = document.getElementById('ps-chart');
  psChart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: '#0d1117' },
      textColor: '#e0e0e0',
    },
    grid: {
      vertLines: { color: '#1a1a2e' },
      horzLines: { color: '#1a1a2e' },
    },
    width: container.clientWidth,
    height: 400,
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  // Handle resize
  new ResizeObserver(() => {
    psChart.applyOptions({ width: container.clientWidth });
  }).observe(container);
}

// ── Scan Function ───────────────────────────────────────────────
async function runPatternScan() {
  const indicator = document.getElementById('ps-indicator').value;
  const symbol = document.getElementById('ps-symbol').value.toUpperCase();
  const interval = document.getElementById('ps-interval').value;
  const period = document.getElementById('ps-period').value;

  if (!indicator || !symbol) {
    alert('Select an indicator and enter a symbol.');
    return;
  }

  document.getElementById('ps-scan-status').textContent = 'Scanning...';
  document.getElementById('ps-scan-btn').disabled = true;

  try {
    const res = await fetch('/api/candidates/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        interval,
        period,
        scanMode: 'wyckoff',  // strategy runner path
        // Build a minimal spec from the indicator
        pluginId: indicator,
      })
    });
    const data = await res.json();

    if (data.success && data.data?.candidates?.length > 0) {
      psCandidates = data.data.candidates;
      psCurrentIndex = 0;
      renderPsCandidateList();
      showPsCandidate(0);
      document.getElementById('ps-scan-status').textContent =
        `Found ${psCandidates.length} candidate(s)`;
    } else {
      psCandidates = [];
      document.getElementById('ps-scan-status').textContent = 'No candidates found.';
      document.getElementById('ps-candidate-list').innerHTML =
        '<p>No detections. Try adjusting parameters.</p>';
    }
  } catch (err) {
    document.getElementById('ps-scan-status').textContent = 'Error: ' + err.message;
  }

  document.getElementById('ps-scan-btn').disabled = false;
}

// ── Render candidate list ───────────────────────────────────────
function renderPsCandidateList() {
  const list = document.getElementById('ps-candidate-list');
  list.innerHTML = psCandidates.map((c, i) => `
    <div class="ps-candidate-row ${i === psCurrentIndex ? 'active' : ''}"
         onclick="showPsCandidate(${i})">
      <span class="ps-cand-num">#${i + 1}</span>
      <span class="ps-cand-score">${(c.score || 0).toFixed(2)}</span>
      <span class="ps-cand-ready">${c.entry_ready ? '✓' : '—'}</span>
    </div>
  `).join('');
}

// ── Show a specific candidate ───────────────────────────────────
function showPsCandidate(index) {
  psCurrentIndex = index;
  const c = psCandidates[index];
  if (!c) return;

  renderPsCandidateList();

  // Draw chart
  // (Reuse drawPatternChart logic from index.js — pass chart_data to LightweightCharts)
  if (psChart && c.chart_data) {
    // Remove existing series
    psChart.timeScale().resetTimeRange();
    // Add new candlestick series with c.chart_data
    // ... (copy chart rendering logic from index.js drawPatternChart)
  }

  // Show candidate details
  const details = document.getElementById('ps-candidate-details');
  const title = document.getElementById('ps-candidate-title');
  title.textContent = `Candidate #${index + 1} — Score: ${(c.score || 0).toFixed(3)}`;

  // Rule checklist
  const checklist = document.getElementById('ps-rule-checklist');
  if (c.rule_checklist) {
    checklist.innerHTML = c.rule_checklist.map(r =>
      `<div class="ps-rule ${r.passed ? 'pass' : 'fail'}">
        ${r.passed ? '✓' : '✗'} ${r.rule_name}: ${r.value}
      </div>`
    ).join('');
  }
}

// ── Label submission ────────────────────────────────────────────
async function psSubmitLabel(label) {
  const c = psCandidates[psCurrentIndex];
  if (!c) return;

  try {
    await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: c.candidate_id || c.id,
        label: label,
        userId: 'user_1',  // or get from session
      })
    });

    // Update stats
    updatePsLabelStats();

    // Move to next candidate
    if (psCurrentIndex < psCandidates.length - 1) {
      showPsCandidate(psCurrentIndex + 1);
    }
  } catch (err) {
    console.error('Label error:', err);
  }
}

// ── Correction mode ─────────────────────────────────────────────
function psEnterCorrection() {
  document.getElementById('ps-correction-panel').style.display = '';
  // Enable drawing tools on canvas
  // (Move drawing tool logic from index.js)
}

function psCancelCorrection() {
  document.getElementById('ps-correction-panel').style.display = 'none';
}

async function psSaveCorrection() {
  // Save correction via /api/corrections
  // (Move correction save logic from index.js)
  document.getElementById('ps-correction-panel').style.display = 'none';
}
```

### 2.4: Load Indicators into Pattern Scanner Dropdown

**File:** `frontend/public/workshop.js`

On page load (or when switching to Pattern Scanner tab), populate the indicator dropdown:

```javascript
async function loadIndicatorsForScanner() {
  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    const select = document.getElementById('ps-indicator');

    if (data.success && data.data?.patterns) {
      data.data.patterns.forEach(p => {
        const option = document.createElement('option');
        option.value = p.pattern_id;
        option.textContent = `${p.name} (${p.category})`;
        select.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Failed to load indicators:', err);
  }
}
```

### 2.5: Add Library Browser Tab

**File:** `frontend/public/workshop.html` (inside `#tab-library`)

Simple read-only view of all indicators in the registry:

```html
<div class="library-container">
  <h3>Indicator Library</h3>
  <div class="library-filters">
    <select id="library-category-filter" onchange="filterLibrary()">
      <option value="all">All Categories</option>
      <option value="chart_patterns">Chart Patterns</option>
      <option value="indicator_signals">Indicator Signals</option>
      <option value="price_action">Price Action</option>
      <option value="custom">Custom</option>
    </select>
  </div>
  <div id="library-grid" class="library-grid">
    <!-- Indicator cards rendered here -->
  </div>
</div>
```

Each card:
```javascript
function renderLibraryCard(pattern) {
  return `
    <div class="library-card">
      <div class="library-card-header">
        <span class="library-card-name">${pattern.name}</span>
        <span class="library-card-status status-${pattern.status}">${pattern.status}</span>
      </div>
      <div class="library-card-category">${pattern.category}</div>
      <div class="library-card-description">${pattern.description || ''}</div>
      <div class="library-card-actions">
        <button onclick="loadIntoEditor('${pattern.pattern_id}')">Edit</button>
        <button onclick="scanWithIndicator('${pattern.pattern_id}')">Scan</button>
        <button onclick="sendToValidator('${pattern.pattern_id}')">Validate</button>
      </div>
    </div>
  `;
}
```

---

## Step 3: Update Backend

### 3.1: Add Strategy Filter Endpoint

**File:** `backend/src/routes/strategies.ts`

Add query parameter support for filtering by status:

```typescript
// GET /api/strategies?status=approved
router.get('/', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  let strategies = loadAllStrategies();

  if (status) {
    strategies = strategies.filter(s => s.status === status);
  }

  res.json({ success: true, data: strategies });
});
```

### 3.2: Add Scan Mode for Plugin-Based Scanning

**File:** `backend/src/routes/candidates.ts`

In the `POST /api/candidates/scan` handler, add support for `pluginId` parameter. When `pluginId` is provided, build a minimal spec from the plugin's default params and run it:

```typescript
// Inside the scan handler, before the strategy path:
if (req.body.pluginId) {
  // Load plugin definition from registry
  const registryPath = path.join(PATTERNS_DIR, 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  const pattern = registry.patterns.find(p => p.pattern_id === req.body.pluginId);

  if (pattern) {
    const defPath = path.join(PATTERNS_DIR, pattern.definition_file);
    const definition = JSON.parse(fs.readFileSync(defPath, 'utf-8'));

    // Build spec from plugin defaults
    const spec = {
      strategy_id: `scan_${pattern.pattern_id}`,
      strategy_version_id: `scan_${pattern.pattern_id}_v1`,
      version: 1,
      structure_config: definition.default_structure_config || {},
      setup_config: {
        pattern_type: pattern.pattern_id,
        ...(definition.default_setup_params || {})
      },
      entry_config: definition.default_entry || { confirmation_bars: 1 },
    };

    // Run strategy runner with this spec
    const result = await runStrategyRunner(spec, symbol, timeframe, period, interval);
    return res.json({ success: true, data: { candidates: result } });
  }
}
```

---

## Step 4: Update Navigation

### 4.1: Rename Workshop to Indicator Studio

**All HTML files** — update the sidebar nav link:

```html
<!-- Old -->
<a href="workshop.html" class="sidebar-nav-item">Workshop</a>

<!-- New -->
<a href="workshop.html" class="sidebar-nav-item">Indicator Studio</a>
```

Update in: `index.html`, `copilot.html`, `history.html`, `validator.html`, `strategy.html`, `workshop.html`

### 4.2: Update Page Title

**File:** `frontend/public/workshop.html`

```html
<title>Indicator Studio — Pattern Detector</title>
```

---

## Step 5: Wire Up LightweightCharts in Workshop

**File:** `frontend/public/workshop.html`

Add the LightweightCharts CDN script in the `<head>`:

```html
<script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
```

This is already used on the Scanner and Co-Pilot pages, so there's no new dependency.

---

## Validation Checklist

After building, verify:

### Scanner Page (Production)
- [ ] Strategy dropdown populates with approved strategies
- [ ] Draft strategies shown separately with warning indicator
- [ ] Scan runs against selected symbols using the strategy runner
- [ ] Results displayed as ranked list with scores
- [ ] Clicking a candidate shows chart + rule checklist
- [ ] "Trade →" button stores candidate and navigates to Trading Desk
- [ ] NO label buttons visible
- [ ] NO correction panel visible
- [ ] NO drawing tools
- [ ] NO legacy scan modes (swing, fib-energy, discount)
- [ ] AI chat uses `contextual_ranker` role

### Indicator Studio — Code Editor Tab
- [ ] Existing Workshop functionality preserved (Monaco + AI chat)
- [ ] Tab switching works

### Indicator Studio — Pattern Scanner Tab
- [ ] Indicator dropdown populates from registry
- [ ] Scan runs and shows candidates
- [ ] Chart renders with LightweightCharts
- [ ] Label buttons work (YES, NO, CORRECT IT, SKIP)
- [ ] Correction drawing tools work
- [ ] Labels save to `/api/labels`
- [ ] Corrections save to `/api/corrections`
- [ ] AI chat uses `pattern_analyst` role

### Indicator Studio — Library Tab
- [ ] All indicators displayed as cards
- [ ] Category filter works
- [ ] "Edit" opens Code Editor tab with indicator loaded
- [ ] "Scan" switches to Pattern Scanner tab with indicator selected
- [ ] "Validate" navigates to Validator page with indicator pre-selected

### Navigation
- [ ] "Indicator Studio" appears in sidebar on all pages
- [ ] Links work correctly

---

## File Summary

| Action | File | What |
|--------|------|------|
| MODIFY | `frontend/public/index.html` | Remove R&D elements, add strategy selector + candidate list |
| MODIFY | `frontend/public/index.js` | Remove label/correction/drawing functions, simplify scan |
| MODIFY | `frontend/public/workshop.html` | Add tabs (Code Editor, Pattern Scanner, Library) |
| MODIFY | `frontend/public/workshop.js` | Add Pattern Scanner + Library logic |
| MODIFY | `backend/src/routes/candidates.ts` | Add pluginId scan support |
| MODIFY | `backend/src/routes/strategies.ts` | Add status filter query param |
| MODIFY | All HTML files (6 files) | Rename Workshop → Indicator Studio in nav |
