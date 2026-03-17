# Codebase Structure

**Analysis Date:** 2026-02-09

## Directory Layout

```
pattern-detector/
├── backend/                  # Express server + Python scanner
│   ├── data/                 # JSON file storage (runtime data)
│   ├── dist/                 # Compiled TypeScript output
│   ├── node_modules/         # Node.js dependencies
│   ├── services/             # Python scanner + legacy JS service
│   ├── src/                  # TypeScript source code
│   │   ├── routes/           # Express route handlers
│   │   ├── services/         # Business logic services
│   │   └── types/            # TypeScript type definitions
│   ├── package.json          # Node.js project config
│   └── tsconfig.json         # TypeScript compiler config
├── docs/                     # Project documentation
├── frontend/                 # Browser-based UI
│   └── public/               # Static HTML/JS/CSS files
├── gsd/                      # GSD workflow templates & references
│   ├── references/           # Reference documentation
│   ├── templates/            # Project management templates
│   └── workflows/            # Workflow definitions
├── memory-bank/              # AI conversation memory/context
├── ml/                       # Machine learning pipeline
├── .cursor/                  # Cursor IDE configuration
│   └── rules/                # AI assistant rules
├── .planning/                # Planning documents
│   └── codebase/             # Architecture & structure docs
├── README.md                 # Project readme
└── requirements.txt          # Python dependencies (root)
```

## Directory Purposes

### `backend/`
- **Purpose:** Express.js server providing REST API and hosting the Python pattern scanner
- **Contains:** TypeScript source, Python scanner, compiled output, JSON data storage
- **Key files:**
  - `backend/package.json` — Dependencies: `express`, `cors`, `dotenv`, `node-fetch`, `uuid`
  - `backend/tsconfig.json` — TypeScript config (ES2020, CommonJS, strict)

### `backend/src/`
- **Purpose:** TypeScript source code for the Express server
- **Contains:** Server entry point, route handlers, services, type definitions
- **Key files:**
  - `backend/src/server.ts` — Express app setup, middleware, route registration, static file serving, server startup on port 3002

### `backend/src/routes/`
- **Purpose:** Express Router modules, one per domain
- **Contains:** 6 route files
- **Key files:**
  - `backend/src/routes/candidates.ts` — `GET /api/candidates`, `GET /api/candidates/unlabeled`, `GET /api/candidates/:id`, `POST /api/candidates/scan`, `POST /api/candidates/scan-batch`, `GET /api/candidates/symbols`, `DELETE /api/candidates`
  - `backend/src/routes/labels.ts` — `GET /api/labels`, `GET /api/labels/stats`, `GET /api/labels/candidate/:id`, `POST /api/labels`, `DELETE /api/labels/:id`, `DELETE /api/labels/all`
  - `backend/src/routes/corrections.ts` — `GET /api/corrections`, `POST /api/corrections`, `DELETE /api/corrections/:id`, `DELETE /api/corrections/all`
  - `backend/src/routes/vision.ts` — `GET /api/vision/status`, `POST /api/vision/analyze`, `POST /api/vision/chat`
  - `backend/src/routes/savedCharts.ts` — `GET /api/saved-charts`, `GET /api/saved-charts/:id`, `POST /api/saved-charts`, `DELETE /api/saved-charts/:id`, `DELETE /api/saved-charts`
  - `backend/src/routes/trades.ts` — `GET /api/trades`, `GET /api/trades/:id`, `POST /api/trades`, `PUT /api/trades/:id`, `DELETE /api/trades/:id`, `DELETE /api/trades`

### `backend/src/services/`
- **Purpose:** Business logic and data access layer
- **Contains:** 3 TypeScript services
- **Key files:**
  - `backend/src/services/storageService.ts` — JSON file CRUD for all entity types: candidates, labels, corrections, saved charts, trades. Exports ~25 functions (save/get/getAll/delete/clear per entity)
  - `backend/src/services/visionService.ts` — AI vision integration: `analyzeChartPattern()`, `checkOllamaStatus()`, `chatWithCopilot()`. Supports OpenAI GPT-4o and Ollama MiniCPM-V. ~880 lines including prompt engineering, response parsing, and help detection via searchService
  - `backend/src/services/searchService.ts` — App knowledge retrieval: `globFiles()`, `grepFile()`, `readSection()`, `searchAppReference()`. Provides grep-based search of `backend/data/app-reference.md` to inject help context into AI prompts. ~180 lines

### `backend/src/types/`
- **Purpose:** Shared TypeScript interfaces and types
- **Contains:** 1 file
- **Key files:**
  - `backend/src/types/index.ts` — `PatternCandidate`, `PatternLabel`, `PatternCorrection`, `DrawingAnnotation`, `DrawingAnnotations`, `LabelType`, `LabelingStats`, `ScanRequest` (includes `swingEpsilon`), `ApiResponse<T>`, `Base`, `Markup`, `Pullback`

### `backend/services/`
- **Purpose:** Python scanner and legacy JavaScript services
- **Contains:** Python scanner, JS storage service (legacy), symbol list
- **Key files:**
  - `backend/services/patternScanner.py` — Main Python scanner (~3250 lines). Dataclasses: `OHLCV`, `Base`, `Markup`, `Pullback`, `PatternCandidate`. Functions: `detect_swing_highs_lows()`, `detect_accumulation_bases()`, `detect_markup()`, `detect_second_pullback()`, `calculate_retracement()`, `detect_swings_rdp()`. Modes: `--wyckoff`, `--swing`, `--fib-energy`, `--copilot`. Dependencies: `yfinance`, `pandas`, `numpy`, `fastrdp`
  - `backend/services/symbols.json` — JSON list of ticker symbols available for scanning
  - `backend/services/storageService.js` — Legacy JavaScript storage service (superseded by TypeScript version)

### `backend/data/`
- **Purpose:** Runtime JSON file storage (no database) + reference data
- **Contains:** 83+ JSON files across 5 subdirectories + reference markdown
- **Subdirectories:**
  - `backend/data/candidates/` — 35 files. Pattern candidates named `{SYMBOL}_{TF}_chart_only.json` (e.g., `SPY_W_chart_only.json`)
  - `backend/data/charts/` — 36 files. Full chart data named `{SYMBOL}_{TF}.json` (e.g., `SPY_W.json`)
  - `backend/data/labels/` — 9 files. User labels named by UUID (e.g., `118d2447-c81a-4b90-bf7d-cfcafa5a6c51.json`)
  - `backend/data/corrections/` — 3 files. Pattern corrections named by UUID
  - `backend/data/saved-charts/` — 1 file. User-saved chart snapshots named by timestamp
- **Reference files:**
  - `backend/data/app-reference.md` — Structured markdown help reference for all app settings, instrument types, risk rules, verdict engine layers, chart controls, AI settings, and navigation. Greppable by section header — used by `searchService.ts` to inject relevant help into AI prompts

### `backend/dist/`
- **Purpose:** Compiled TypeScript output (JavaScript + declaration files)
- **Contains:** 15 files mirroring `src/` structure
- **Key files:** `backend/dist/server.js` (production entry point)

### `frontend/`
- **Purpose:** Browser-based user interface
- **Contains:** Static HTML, CSS, and JS files (separated from monolithic HTML)

### `frontend/public/`
- **Purpose:** Static assets served by Express
- **Contains:** 9 files — 3 HTML pages + 3 CSS files + 3 JS files (no build step, no framework, no bundler)
- **Key files:**
  - `frontend/public/index.html` — Scanner HTML structure (~532 lines). Features: collapsible sidebar, Lightweight Charts viewer, pattern labeling, drawing tools, batch scanning, AI panel, stats dashboard
  - `frontend/public/index.css` — Scanner styles (~44 lines). Sidebar, button, collapse toggle, collapsible section styles
  - `frontend/public/index.js` — Scanner logic (~3,825 lines). Chart rendering, candidate navigation, labeling, corrections, drawing annotations, batch scan, AI analysis, ML vector export
  - `frontend/public/copilot.html` — Co-Pilot HTML structure (~540 lines). Chart area, entry/stop/target controls, position sizing, reorganized sidebar (Account, Instrument, Risk Rules, AI), per-layer verdict panel, chat panel
  - `frontend/public/copilot.css` — Co-Pilot styles (~85 lines). Chat messages, settings inputs, custom scrollbar, instrument panel transitions, verdict layer badges (pass/fail/caution)
  - `frontend/public/copilot.js` — Co-Pilot logic (~2,040 lines). 4-layer verdict engine (Account Constraints → Instrument Rules → Risk Management → Setup Quality), 5 instrument sizers (Stock, Futures, Options, Forex, Crypto), trade history stats integration, chart init, marker/line dragging, drawing canvas, AI verdict, chat, position sizing
  - `frontend/public/history.html` — Trading Desk HTML structure (~301 lines). Trade cards, modals, stats, sidebar
  - `frontend/public/history.css` — Trading Desk styles (~32 lines). Tabs, status badges, modal overlay
  - `frontend/public/history.js` — Trading Desk logic (~557 lines). Trade CRUD, execution/closeout modals, journal, stats, import/export
- **Note:** Each page loads its own `.css` and `.js` via `<link>` and `<script src>`. No shared module — similar functions (e.g., `toggleSidebar`, `drawArrowHead`) exist per-page with different implementations due to page-specific globals. Shared extraction deferred to GSD rebuild.

### `ml/`
- **Purpose:** Machine learning pipeline for pattern classification
- **Contains:** Training script, prediction module, requirements
- **Key files:**
  - `ml/train_classifier.py` — Trains classifiers (RandomForest, GradientBoosting, LogisticRegression) on 15 features. Outputs model to `ml/models/`
  - `ml/predict.py` — `PatternClassifier` class wrapping joblib model for inference
  - `ml/requirements.txt` — `pandas`, `numpy`, `scikit-learn`, `joblib`
  - `ml/README.md` — ML pipeline documentation

### `docs/`
- **Purpose:** Project documentation
- **Contains:** Architecture design document
- **Key files:**
  - `docs/ARCHITECTURE.md` — Original architecture mapping from handwriting recognition to pattern detection. Covers data models, API design, active learning pipeline, implementation phases

### `gsd/`
- **Purpose:** GSD (Get Stuff Done) workflow system — templates for project planning and execution
- **Contains:** Reference docs, templates, workflows
- **Subdirectories:**
  - `gsd/references/` — 9 markdown reference files
  - `gsd/templates/` — Project management templates (milestone, roadmap, requirements, debug, etc.)
  - `gsd/templates/codebase/` — Codebase analysis templates
  - `gsd/templates/research-project/` — Research templates
  - `gsd/workflows/` — Workflow definitions (discovery, execute, verify, resume, etc.)

### `memory-bank/`
- **Purpose:** AI conversation memory and context persistence
- **Contains:** Chat memory, phase tracking, transcripts
- **Key files:**
  - `memory-bank/CHAT_MEMORY.md` — Conversation history
  - `memory-bank/LATEST.md` — Latest state snapshot
  - `memory-bank/PHASE.md` — Current project phase
  - `memory-bank/transcripts/` — Full conversation transcripts

## Key File Locations

### Entry Points
| Entry Point | File | Start Command |
|---|---|---|
| Express Server | `backend/src/server.ts` | `npm run dev` / `npm start` |
| Python Scanner | `backend/services/patternScanner.py` | `python patternScanner.py --symbol X` |
| ML Training | `ml/train_classifier.py` | `python train_classifier.py --data FILE.csv` |
| ML Prediction | `ml/predict.py` | Import as module |
| Main UI | `frontend/public/index.html` | `http://localhost:3002/` |
| Co-Pilot UI | `frontend/public/copilot.html` | `http://localhost:3002/copilot.html` |
| Trading Desk UI | `frontend/public/history.html` | `http://localhost:3002/history.html` |

### Configuration
| Purpose | File |
|---|---|
| Node.js project | `backend/package.json` |
| TypeScript config | `backend/tsconfig.json` |
| Python deps (root) | `requirements.txt` |
| ML Python deps | `ml/requirements.txt` |
| Environment vars | `backend/.env` (not committed) |
| Cursor AI rules | `.cursor/rules/*.mdc` |

### Core Logic
| Component | File | Lines |
|---|---|---|
| Server setup | `backend/src/server.ts` | 78 |
| Storage service | `backend/src/services/storageService.ts` | 516 |
| Vision AI service | `backend/src/services/visionService.ts` | ~880 |
| Search service | `backend/src/services/searchService.ts` | ~180 |
| Type definitions | `backend/src/types/index.ts` | 151 |
| Pattern scanner | `backend/services/patternScanner.py` | ~3250 |
| ML trainer | `ml/train_classifier.py` | ~278 |
| ML predictor | `ml/predict.py` | ~179 |

### Documentation
| Document | File |
|---|---|
| Project README | `README.md` |
| Architecture design | `docs/ARCHITECTURE.md` |
| ML README | `ml/README.md` |

## Naming Conventions

### Files
- **TypeScript routes:** `camelCase.ts` (e.g., `savedCharts.ts`, `storageService.ts`)
- **Python files:** `camelCase.py` (e.g., `patternScanner.py`) — note: not snake_case
- **ML Python files:** `snake_case.py` (e.g., `train_classifier.py`, `predict.py`)
- **HTML pages:** `lowercase.html` (e.g., `copilot.html`, `history.html`)
- **Frontend JS:** `lowercase.js` matching HTML page name (e.g., `index.js`, `copilot.js`)
- **Frontend CSS:** `lowercase.css` matching HTML page name (e.g., `index.css`, `copilot.css`)
- **JSON data (candidates/charts):** `{SYMBOL}_{TIMEFRAME}.json` or `{SYMBOL}_{TF}_chart_only.json`
- **JSON data (labels/corrections):** `{UUID}.json`
- **JSON data (saved charts):** `{TIMESTAMP}.json`

### Directories
- **Top-level:** `lowercase` (e.g., `backend`, `frontend`, `ml`, `docs`)
- **Data subdirs:** `kebab-case` (e.g., `saved-charts`, `trade-history`)
- **Source subdirs:** `lowercase` (e.g., `routes`, `services`, `types`)

### Code Patterns
- **Route modules:** Export `Router()` instance as default export
- **Service functions:** Exported named async functions (e.g., `export async function saveCandidate()`)
- **API responses:** Consistent `{ success: boolean, data?: T, error?: string }` envelope
- **IDs:** UUIDs for labels/corrections, natural keys for candidates (`{SYMBOL}_{TF}`), timestamps for saved charts

## Where to Add New Code

### New API Route
1. Create `backend/src/routes/newDomain.ts`
2. Define Express `Router()` with endpoints
3. Import and use `storageService` for data operations
4. Register in `backend/src/server.ts`: `app.use('/api/new-domain', newDomainRouter);`

### New Service
1. Create `backend/src/services/newService.ts`
2. Export async functions for business logic
3. Import from route handlers

### New Entity Type (Data)
1. Add TypeScript interfaces to `backend/src/types/index.ts`
2. Add directory constant in `backend/src/services/storageService.ts`
3. Add to `ensureDirectories()` function
4. Add CRUD functions following existing patterns (save/get/getAll/delete/clear)
5. Data stored in `backend/data/{entity-name}/`

### New Scan Mode
1. Add mode to `ScanRequest.scanMode` union in `backend/src/types/index.ts`
2. Add CLI flag handling in `backend/services/patternScanner.py`
3. Add mode routing in `backend/src/routes/candidates.ts` POST `/scan`
4. Add frontend UI controls in `frontend/public/index.html` (HTML) and scan logic in `frontend/public/index.js`

### New Frontend Page
1. Create 3 files: `frontend/public/newpage.html`, `newpage.css`, `newpage.js`
2. In the HTML: add `<link rel="stylesheet" href="newpage.css">` in `<head>` and `<script src="newpage.js"></script>` before `</body>`
3. Add sidebar navigation link in other pages' HTML files
4. Access at `http://localhost:3002/newpage.html`

### New ML Feature
1. Add feature extraction in `ml/train_classifier.py` (update `SCANNER_FEATURES` or `AI_FEATURES`)
2. Update `ml/predict.py` feature expectations
3. Re-export training CSV from frontend with new columns

### New Utility
1. For TypeScript: add to relevant service file or create new service in `backend/src/services/`
2. For Python: add to `backend/services/patternScanner.py` or create sibling module

## Special Directories

### Generated / Build Output
- `backend/dist/` — TypeScript compilation output. Regenerated by `npm run build` (`tsc`). Contains `.js` and `.d.ts` files mirroring `src/` structure
- `backend/node_modules/` — npm dependencies (~1200 files). Regenerated by `npm install`
- `backend/services/__pycache__/` — Python bytecode cache. Auto-generated

### Data Storage (Runtime)
- `backend/data/` — All runtime data stored as JSON files. No database. 83 files across 5 subdirectories. Not suitable for high-volume production use. Consider backing up this directory
- `backend/data/candidates/` — Scanner output, can be regenerated by re-scanning
- `backend/data/charts/` — Full chart OHLCV data, can be regenerated
- `backend/data/labels/` — User labels — **irreplaceable**, represents human labeling effort
- `backend/data/corrections/` — User corrections — **irreplaceable**
- `backend/data/saved-charts/` — User saved charts
- `backend/data/trade-history/` — Trade records (directory exists in code, created on demand)

### AI / Workflow Metadata
- `memory-bank/` — AI conversation context persistence. Used by Cursor AI rules for continuity across sessions
- `gsd/` — Project management templates and workflows. Not runtime code — used as planning scaffolding
- `.cursor/rules/` — Cursor IDE AI behavior rules (`.mdc` files)
- `.planning/` — Architecture and structure documentation (this file)
