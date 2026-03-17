# Architecture

**Analysis Date:** 2026-02-09

## Pattern Overview

**Layered Monolith with Python Service Integration and AI Vision Pipeline**

The Pattern Detector is a full-stack application for identifying Wyckoff accumulation/reaccumulation patterns in financial charts. It follows a human-in-the-loop active learning paradigm: a Python scanner proposes pattern candidates, users label them (Yes/No/Close), and an ML pipeline learns from the feedback. The system also integrates AI vision (OpenAI GPT-4o / Ollama MiniCPM-V) for chart image analysis and a trading co-pilot chat interface.

The architecture mirrors a handwriting recognition system adapted for market structure detection: strokes become OHLCV time series, ink recognition becomes rule-based pattern scanning, and user corrections become pattern labels.

## Layers

### 1. Presentation Layer (Frontend)
- **Purpose:** Renders chart data, pattern annotations, labeling UI, co-pilot chat, and trade management
- **Contains:** Static HTML pages with separated CSS and JS files, Tailwind CSS (CDN), Lightweight Charts (CDN)
- **Location:** `frontend/public/`
- **Key files:**
  - `frontend/public/index.html` + `index.css` + `index.js` — Scanner / labeling UI (HTML ~532 lines, JS ~3,825 lines). Sidebar navigation, chart viewer, labeling, drawing tools, scan controls, AI analysis panel
  - `frontend/public/copilot.html` + `copilot.css` + `copilot.js` — Trading Co-Pilot (HTML ~540 lines, JS ~2,040 lines). Chart with Fib/energy overlays, 4-layer verdict engine (Account Constraints → Instrument Rules → Risk Management → Setup Quality), 5 instrument types (Stock/ETF, Futures, Options, Forex, Crypto), trade history stats integration, position sizing, AI chat
  - `frontend/public/history.html` + `history.css` + `history.js` — Trading Desk (HTML ~301 lines, JS ~557 lines). Trade cards, journal, stats dashboard
- **Pattern:** Each page has its own `.html` (structure), `.css` (styles), and `.js` (logic). No shared modules between pages — similar utility functions duplicated per page with page-specific globals.
- **Depends on:** Backend API (`/api/*`), Lightweight Charts library (CDN), Tailwind CSS (CDN), html2canvas (CDN)
- **Used by:** End users (traders)

### 2. API Layer (Express Routes)
- **Purpose:** RESTful API endpoints that handle HTTP requests, validate input, and delegate to services
- **Contains:** Express Router modules, one per domain
- **Location:** `backend/src/routes/`
- **Key files:**
  - `backend/src/routes/candidates.ts` — CRUD for pattern candidates + scan triggers (spawns Python process)
  - `backend/src/routes/labels.ts` — CRUD for user labels + statistics
  - `backend/src/routes/corrections.ts` — Pattern corrections and drawing annotations
  - `backend/src/routes/vision.ts` — AI vision analysis and co-pilot chat endpoints
  - `backend/src/routes/savedCharts.ts` — Saved chart persistence (replaced localStorage)
  - `backend/src/routes/trades.ts` — Trade history CRUD
- **Depends on:** Service Layer (`storageService`, `visionService`), Type definitions
- **Used by:** Presentation Layer (via fetch API)

### 3. Service Layer
- **Purpose:** Business logic, data access, external API integration, and knowledge retrieval
- **Contains:** TypeScript services for storage, AI vision, and search
- **Location:** `backend/src/services/`
- **Key files:**
  - `backend/src/services/storageService.ts` — JSON file-based persistence for candidates, labels, corrections, saved charts, and trades
  - `backend/src/services/visionService.ts` — AI chart analysis via OpenAI GPT-4o or Ollama, prompt engineering, response parsing, co-pilot chat with trading context and help detection. Imports searchService for app knowledge injection
  - `backend/src/services/searchService.ts` — App knowledge retrieval: `globFiles()` (find files by pattern), `grepFile()` (search contents by regex), `readSection()` (extract markdown section by header), `searchAppReference()` (keyword-to-section mapper for AI prompt enrichment). Searches `backend/data/app-reference.md`
- **Depends on:** File system (`fs`, `fs/promises`), External APIs (OpenAI, Ollama), Type definitions
- **Used by:** API Layer

### 4. Pattern Detection Layer (Python)
- **Purpose:** Rule-based candidate generation from OHLCV data using hard gates (Wyckoff accumulation, swing points, Fibonacci/energy analysis)
- **Contains:** Python scanner with multiple scan modes
- **Location:** `backend/services/patternScanner.py`
- **Key files:**
  - `backend/services/patternScanner.py` — Main scanner (~3250 lines): detects swing highs/lows (MAJOR mode with RDP fallback via `fastrdp`), accumulation bases, markup breakouts, second pullbacks; supports `--wyckoff`, `--swing`, `--fib-energy`, and `--copilot` modes; `--swing-epsilon` controls RDP sensitivity; fetches data via `yfinance`
  - `backend/services/symbols.json` — List of available symbols to scan
- **Depends on:** `yfinance`, `pandas`, `numpy`, `fastrdp` (optional imports with graceful fallback)
- **Used by:** API Layer (spawned as child process via `child_process.spawn`)

### 5. ML Pipeline Layer
- **Purpose:** Train and serve a classifier that learns from user labels to improve pattern detection
- **Contains:** Training script, prediction module, model artifacts
- **Location:** `ml/`
- **Key files:**
  - `ml/train_classifier.py` — Trains RandomForest/GradientBoosting/LogisticRegression on 15 features (8 scanner + 5 AI scores + ai_valid + ai_confidence)
  - `ml/predict.py` — `PatternClassifier` class for inference; loads saved model from `ml/models/`
  - `ml/requirements.txt` — `pandas`, `numpy`, `scikit-learn`, `joblib`
- **Depends on:** Exported CSV training data from frontend, scikit-learn
- **Used by:** Offline training workflow (not yet integrated into live server)

### 6. Data Layer (JSON File Storage)
- **Purpose:** Persistent storage using individual JSON files per entity (no database)
- **Contains:** JSON files organized by entity type
- **Location:** `backend/data/`
- **Subdirectories:**
  - `backend/data/candidates/` — Scanner-generated pattern candidates (`{SYMBOL}_{TF}_chart_only.json` and `{SYMBOL}_{TF}.json`)
  - `backend/data/charts/` — Full chart data with OHLCV series
  - `backend/data/labels/` — User labels (UUID-named JSON files)
  - `backend/data/corrections/` — Pattern corrections and drawing annotations
  - `backend/data/saved-charts/` — User-saved chart snapshots
  - `backend/data/trade-history/` — Trade records (planned, not yet populated)
- **Depends on:** File system
- **Used by:** Service Layer (`storageService.ts`)

## Data Flow

### HTTP Request Flow
1. Browser sends HTTP request to Express server (port 3002)
2. `backend/src/server.ts` routes through CORS and JSON middleware
3. Request matched to route handler in `backend/src/routes/*.ts`
4. Route handler calls `storageService` or `visionService`
5. Service reads/writes JSON files in `backend/data/`
6. Response wrapped in `ApiResponse<T>` envelope: `{ success: boolean, data?: T, error?: string }`

### Scan Flow (Pattern Detection)
1. User enters symbol in frontend, selects scan mode (Wyckoff/Swing/Fib-Energy/Copilot)
2. Frontend POSTs to `/api/candidates/scan` with `ScanRequest` body
3. `candidates.ts` route spawns Python process: `python patternScanner.py --symbol X --timeframe W --wyckoff`
4. Python scanner fetches OHLCV data via `yfinance`, applies hard gates (accumulation detection, markup breakout, retracement 70-88%, time constraint)
5. Scanner outputs JSON array of `PatternCandidate` objects to stdout
6. Route handler parses stdout, saves candidates via `storageService.saveCandidates()`
7. Response returns candidate count and data to frontend
8. For non-Wyckoff modes (swing, fib-energy, copilot), results are returned directly without storage

### Labeling Flow
1. Frontend fetches unlabeled candidates from `/api/candidates/unlabeled`
2. User views chart with pattern annotations (base, markup, pullback highlighted)
3. User clicks Yes / No / Close button
4. Frontend POSTs to `/api/labels` with `{ candidateId, label, userId, notes }`
5. `storageService.saveLabel()` writes a new UUID-named JSON file to `backend/data/labels/`
6. Stats updated: `/api/labels/stats` aggregates yes/no/close counts

### Vision AI Flow
1. Frontend captures chart as base64 image (via `html2canvas`)
2. POSTs to `/api/vision/analyze` with `{ imageBase64, patternInfo }`
3. `visionService.ts` builds structured Wyckoff analysis prompt
4. Sends to OpenAI GPT-4o (or Ollama fallback) with image
5. Parses structured response: phases, price levels, ML scores (0-1)
6. Returns `VisionAnalysis` with confidence, validity, phases, levels, ML scores

### Co-Pilot Trade Verdict Flow
1. User sets entry, stop loss, and target on chart
2. Clicks "Calculate" — triggers `calculateAndVerdict()`
3. `runVerdictEngine()` loads trade stats from `/api/trades` (daily P&L, consecutive losses, open positions)
4. `calculatePositionSize()` dispatches to instrument-specific sizer (stock, futures, options, forex, crypto)
5. 4-layer verdict engine runs sequentially:
   - Layer 1: Account Constraints (buying power, risk budget, daily loss limit, max open positions)
   - Layer 2: Instrument Rules (sizing validation, margin checks, instrument-specific constraints)
   - Layer 3: Risk Management (R:R ratio, max position %, daily trades, consecutive losses, drawdown circuit breaker)
   - Layer 4: Setup Quality (trend alignment, energy state, selling pressure, retracement — advisory only, never hard deny)
6. All layers must PASS for APPROVED (except Layer 4 which is advisory)
7. Per-layer results rendered in verdict panel and chat

### Co-Pilot Chat Flow
1. User types message in co-pilot chat interface
2. POSTs to `/api/vision/chat` with `{ message, context, chartImage }`
3. `visionService.chatWithCopilot()` builds system prompt with trading context (entry, stop, target, position sizing for all 5 instrument types, copilot analysis data)
4. **Help detection**: `buildCopilotSystemPrompt()` checks if message matches help patterns (e.g., "what does X mean?"). If so, `searchAppReference()` greps `backend/data/app-reference.md` for relevant sections and injects them into the system prompt
5. If OpenAI available: sends to GPT-4o with optional chart image (enriched with app knowledge when relevant)
6. If not: falls back to `generateLocalResponse()` — checks searchAppReference first for help questions, then keyword-based local responses using analysis data

## Key Abstractions

### `PatternCandidate`
Core domain object representing a detected pattern. Contains `Base` (accumulation zone), `Markup` (breakout), `Pullback` (entry zone), score, and metadata. Defined in `backend/src/types/index.ts`.

### `PatternLabel`
User feedback on a candidate: `yes` | `no` | `close` with optional notes. Links to a candidate via `candidateId`.

### `PatternCorrection`
Dual-purpose: stores either traditional corrections (original vs. corrected positions) or drawing annotations (`DrawingAnnotations` with point/box/line types).

### `ApiResponse<T>`
Consistent API envelope: `{ success: boolean, data?: T, error?: string }`. Used across all route handlers.

### `VisionAnalysis`
Structured output from AI vision: confidence score, validity flag, phase analysis (peak/markdown/base/markup/pullback/breakout), price levels, ML scores (pattern likeness, structural clarity, phase completeness, failure risk, entry quality).

### `ScanRequest`
Request configuration for pattern scanning: symbol, timeframe, period, interval, scan mode (`wyckoff` | `swing` | `fib-energy` | `copilot`), `swingEpsilon` (RDP sensitivity), and mode-specific parameters.

### Storage Pattern (JSON-file-per-entity)
Each entity is stored as an individual JSON file named by UUID or natural key. The `storageService` provides CRUD operations that read/write to `backend/data/{entity}/`. Directories are auto-created on first write via `ensureDirectories()`.

## Entry Points

### Server Entry Point
- **File:** `backend/src/server.ts`
- **Start command:** `npm run dev` (uses `ts-node`) or `npm start` (uses compiled `dist/server.js`)
- **Port:** 3002 (configurable via `PORT` env var)
- **Registers:** CORS, JSON parser (50mb limit), static file serving, 6 API route groups, health check, SPA fallback

### Python Scanner Entry Point
- **File:** `backend/services/patternScanner.py`
- **Start command:** `python patternScanner.py --symbol SYMBOL --timeframe W`
- **Invocation:** Spawned as child process by `candidates.ts` route, or standalone via `npm run scan`
- **Output:** JSON to stdout, diagnostic logs to stderr

### ML Training Entry Point
- **File:** `ml/train_classifier.py`
- **Start command:** `python train_classifier.py --data ml_training_data.csv`
- **Workflow:** Offline — user exports CSV from frontend, runs training locally

### Frontend Entry Points
- **Main UI:** `http://localhost:3002/` → `frontend/public/index.html`
- **Co-Pilot:** `http://localhost:3002/copilot.html` → `frontend/public/copilot.html`
- **Trading Desk:** `http://localhost:3002/history.html` → `frontend/public/history.html`

## Error Handling

### Strategy
- **Try-catch at route level:** Every route handler wraps logic in try-catch and returns `{ success: false, error: message }` with appropriate HTTP status codes
- **ENOENT graceful handling:** `storageService` returns `null` for missing files instead of throwing
- **Child process errors:** Scanner failures return exit code and stderr in error response
- **AI fallback:** `visionService` falls back to local keyword-based responses when OpenAI is unavailable or errors
- **Input validation:** Required fields checked at route level with 400 responses
- **No global error handler:** Errors are handled per-route; no Express error middleware

### HTTP Status Codes Used
- `200` — Success
- `400` — Missing/invalid request parameters
- `404` — Entity not found
- `500` — Server errors, scanner failures, API errors

## Cross-Cutting Concerns

### CORS
- Enabled globally via `cors()` middleware with default permissive settings (all origins)

### Request Size
- JSON body limit set to `50mb` to accommodate base64 chart images for vision analysis

### Static File Serving
- Express serves `frontend/public/` as static files
- SPA fallback: all unmatched routes serve `index.html`

### Environment Configuration
- `dotenv` loaded at server startup from `backend/.env`
- Key variables: `PORT`, `VISION_PROVIDER` (`openai` | `ollama`), `OPENAI_API_KEY`, `OLLAMA_URL`, `VISION_MODEL`

### Logging
- Console logging only (no structured logging framework)
- Scanner output logged: `[Scanner]` prefix for stderr
- Batch scan progress: `[Batch Scan]` prefix
- Vision service: debug logs for chat request details

### Build
- TypeScript compiled to `backend/dist/` via `tsc`
- Target: ES2020, Module: CommonJS
- Strict mode enabled

### Python-Node Bridge
- Python scanner invoked via `child_process.spawn('python', [...])`
- Communication via stdout (JSON) and stderr (logs)
- No persistent Python process — spawned per-request
