# Codebase Concerns

**Analysis Date:** 2026-02-09

---

## Tech Debt

### TD-1: Large Frontend Files, No Component System (High)
- **Issue:** Frontend CSS and JS have been separated from HTML (no longer monolithic single-file), but the JS files are still very large with no module system or component framework.
  - `frontend/public/index.js` — **3,825 lines** (Scanner logic)
  - `frontend/public/copilot.js` — **~2,040 lines** (Co-Pilot logic — grew from 1,636 due to 4-layer verdict engine + 5 instrument sizers + trade stats)
  - `frontend/public/history.js` — **557 lines** (Trading Desk logic)
  - HTML files are now manageable: index.html (532), copilot.html (~540), history.html (301)
- **Why:** Rapid prototyping with vibe-coding. CSS/JS extraction done as interim step before GSD rebuild.
- **Impact:** No code reuse between pages — similar functions (sidebar, chart, drawArrowHead) duplicated per page with page-specific globals. Large JS files still hard to navigate. No IDE support for module imports/exports.
- **Partially mitigated:** File separation makes it possible to target edits (e.g., "edit chart rendering in copilot.js" instead of "go to line 1847 in copilot.html"). The verdict engine is well-structured with clear function boundaries (`checkAccountConstraints`, `checkInstrumentRules`, `checkRiskManagement`, `checkSetupQuality`, `runVerdictEngine`). Backend services are growing but well-separated: `searchService.ts` (~180 lines) is cleanly isolated from `visionService.ts` (~880 lines).
- **Fix approach (GSD rebuild):** Decompose into a component-based framework (React, Vue, or Svelte). Extract shared UI (sidebar, chart, AI status) into reusable components. Add a bundler (Vite).

### TD-2: Pervasive Use of `any` Type in Storage Service
- **Issue:** `backend/src/services/storageService.ts` uses `any` type 16 times for saved charts and trades — `saveChart(chart: any)`, `getAllSavedCharts(): Promise<any[]>`, `saveTrade(trade: any)`, `updateTrade(id: string, updates: any)`, etc.
- **Why:** Charts and trades were added later to replace `localStorage`; the schema wasn't defined before implementation.
- **Impact:** No compile-time safety for chart/trade data. Silent data corruption possible. The type system that protects candidates/labels/corrections does NOT protect charts/trades.
- **Fix approach:** Define `SavedChart` and `Trade` interfaces in `backend/src/types/index.ts`. Replace all `any` usages.

### TD-3: ~3,250-Line Python Scanner with Hardcoded Magic Numbers
- **Issue:** `backend/services/patternScanner.py` is a single ~3,250-line file containing all pattern detection logic including RDP swing detection. Dozens of hardcoded thresholds: `0.70`, `0.79`, `0.50`, `0.20`, `0.15`, `0.25`, `0.80`, `0.88`, `0.82`, `0.75`, `0.77`, `0.40`, `0.10`, `0.15`, `0.98`, `0.99`, etc.
- **Why:** Iterative tuning during prototype development — each number was adjusted through trial and error.
- **Impact:** Thresholds are scattered across functions with no centralized configuration. Changing one often requires changing others. No documentation on WHY specific values were chosen. Extremely difficult for a new developer to understand or tune.
- **Fix approach:** Extract all thresholds into a configuration dataclass at the top of the file. Group by detection phase (swing detection, Wyckoff, Fibonacci, energy). Add comments explaining each value's purpose.

### TD-4: Duplicated Code Across HTML Files
- **Issue:** Sidebar markup, sidebar toggle logic, chart initialization, AI status checking, and saved chart management code are duplicated across `index.html`, `copilot.html`, and `history.html`.
- **Why:** Each page was developed independently as the feature set expanded.
- **Impact:** Bug fixes must be applied in 3 places. UI inconsistencies appear when one file is updated but not others. The sidebar width even differs: 240px in `index.html` vs 260px in `copilot.html` vs 256px (w-64) in `history.html`.
- **Fix approach:** Move to a component framework with shared layout. Or as interim: extract shared JS/CSS into separate files loaded via `<script src>` and `<link>`.

### TD-5: File-Per-Record JSON Storage
- **Issue:** `backend/src/services/storageService.ts` stores every candidate, label, correction, chart, and trade as a separate `.json` file in subdirectories of `backend/data/`.
- **Why:** Simplest possible persistence — no database setup required for prototyping.
- **Impact:** Every "get all" operation reads and parses every file in a directory (N filesystem reads + N JSON parses). No indexing, no querying, no relationships. Race conditions possible on concurrent writes. Already 35+ candidate files and 36+ chart files; will degrade at scale.
- **Fix approach:** Migrate to SQLite for local use or PostgreSQL for production. Define proper schemas based on existing TypeScript types.

### TD-6: No TypeScript Types File Export/Organization
- **Issue:** Types exist in `backend/src/types/index.ts` but only cover candidates, labels, and corrections. Chart and trade types are completely absent. The Python scanner's dataclasses don't match the TypeScript types (snake_case vs camelCase).
- **Why:** Types were defined for the first feature (labeling) but not extended as features were added.
- **Impact:** Frontend has no type safety at all (vanilla JS). Python ↔ TypeScript data contract is implicit and fragile.
- **Fix approach:** Add `SavedChart` and `Trade` interfaces. Create a shared type contract (JSON Schema or similar) between Python and TypeScript.

### TD-7: Sequential Batch Scanning
- **Issue:** `backend/src/routes/candidates.ts` `/scan-batch` processes symbols sequentially in a `for` loop (line 230), spawning one Python process at a time.
- **Why:** Simple implementation to get batch scanning working.
- **Impact:** Scanning 35 symbols takes 35x the time of one scan. No parallelism despite being I/O-bound (yfinance network calls).
- **Fix approach:** Use `Promise.all` with a concurrency limiter (e.g., p-limit) to run 3-5 scans in parallel.

---

## Known Bugs

### BUG-1: Path Traversal via Unsanitized IDs
- **Symptoms:** An attacker could read/write arbitrary JSON files on the filesystem.
- **Trigger:** Sending a request like `GET /api/candidates/../../etc/passwd` or `POST /api/labels` with `candidateId` containing `../`.
- **Workaround:** None currently in place.
- **Root cause:** `backend/src/services/storageService.ts` constructs file paths by directly interpolating user-supplied IDs: `path.join(CANDIDATES_DIR, \`${id}.json\`)` (line 44, 72, etc.). No validation that `id` contains only safe characters.

### BUG-2: `DELETE /api/labels/all` Route Conflict
- **Symptoms:** Attempting to delete all labels might instead try to delete a label with id "all", or vice versa.
- **Trigger:** `DELETE /api/labels/all` (line 154 in `backend/src/routes/labels.ts`) is registered AFTER `DELETE /api/labels/:id` (line 127). Express matches `:id` first, so "all" becomes the `id` parameter.
- **Workaround:** The `deleteLabel("all")` call will return `false` (file not found), and the `clearLabels` handler may never execute.
- **Root cause:** Route ordering conflict — the parameterized route catches the literal path.

### BUG-3: Stale `localStorage` References in Frontend
- **Symptoms:** 34 references to `localStorage` in `index.js`, ~4 in `copilot.js` (settings storage via localStorage is intentional for sidebar state), 2 in `history.js` despite migration to server-side storage for trades/candidates.
- **Trigger:** When server storage is empty, frontend may fall back to `localStorage` data or vice versa, causing data inconsistency between storage layers.
- **Workaround:** User data appears in one view but not another.
- **Root cause:** Incomplete migration from `localStorage` to API-based storage. Some features were migrated, others still use `localStorage`.

### BUG-4: No Response Timeout on Python Scanner
- **Symptoms:** Server hangs indefinitely if Python scanner gets stuck (e.g., yfinance network timeout).
- **Trigger:** Run a scan on a symbol that causes yfinance to hang. The Express request never completes.
- **Workaround:** Restart the server.
- **Root cause:** `backend/src/routes/candidates.ts` spawns `python` (line 143) with no timeout. Neither the child process nor the HTTP request has a timeout configured.

---

## Security Considerations

### SEC-1: Exposed OpenAI API Key (CRITICAL)
- **Issue:** `backend/.env` contains a real OpenAI API key in plaintext: `sk-proj-Ml-DP1p...`. There is **no `.gitignore`** file in the repository, meaning this key would be committed to version control.
- **Impact:** If this repository is ever pushed to GitHub (public or private with collaborators), the API key is immediately compromised. OpenAI's automated scanners will likely revoke it, but not before potential charges.
- **Fix:** Immediately rotate the API key. Add a `.gitignore` with `.env` before any git operations. Use `.env.example` with placeholder values.

### SEC-2: No Authentication or Authorization
- **Issue:** All API endpoints are completely open. No login, no API keys, no session tokens. The `userId` parameter is accepted from the client with no verification — `(req.query.userId as string) || 'default'` in `backend/src/routes/candidates.ts` line 39.
- **Impact:** Anyone with network access can read all data, delete all records, run scans, and impersonate any user.
- **Fix:** Add authentication middleware (JWT or session-based). Validate userId from auth token, not query params.

### SEC-3: CORS Wide Open
- **Issue:** `backend/src/server.ts` line 26: `app.use(cors())` — allows requests from any origin with no restrictions.
- **Impact:** Any website can make API calls to this server if it's accessible on the network.
- **Fix:** Configure CORS to only allow the frontend origin.

### SEC-4: Command Injection via Scanner Arguments
- **Issue:** `backend/src/routes/candidates.ts` line 143 passes user-supplied `symbol` directly to `spawn('python', [scannerPath, '--symbol', scanRequest.symbol, ...])`. While `spawn` with an args array is safer than `exec`, the symbol value flows unvalidated into yfinance which makes HTTP requests.
- **Impact:** A malicious symbol string could potentially cause unexpected behavior in yfinance or be used to probe internal networks.
- **Fix:** Validate that `symbol` matches a strict regex pattern (e.g., `/^[A-Z0-9._-]{1,20}$/`).

### SEC-5: No Input Validation on Request Bodies
- **Issue:** Endpoints like `POST /api/trades`, `POST /api/saved-charts`, and `PUT /api/trades/:id` accept arbitrary JSON bodies and write them directly to disk with no schema validation. `req.body` is spread into the stored object untouched.
- **Impact:** Arbitrary data injection, potential for extremely large payloads (though body limit is 50MB — which is itself generous), prototype pollution.
- **Fix:** Add request body validation using Zod or Joi. Enforce schemas for all POST/PUT endpoints.

### SEC-6: 50MB JSON Body Limit
- **Issue:** `backend/src/server.ts` line 27: `express.json({ limit: '50mb' })` — likely set to accommodate base64-encoded chart images.
- **Impact:** A single request can consume 50MB of server memory. Easy denial-of-service vector.
- **Fix:** Reduce the default limit. Use a dedicated image upload endpoint with streaming for large payloads.

### SEC-7: No Rate Limiting
- **Issue:** No rate limiting on any endpoint, including the scanner (which spawns Python processes) and the OpenAI vision API (which costs money per call).
- **Impact:** Uncontrolled resource consumption. OpenAI API costs could spike from automated/malicious requests.
- **Fix:** Add rate limiting middleware (e.g., `express-rate-limit`), especially on `/api/candidates/scan`, `/api/vision/analyze`, and `/api/vision/chat`.

### SEC-8: XSS Risk via `innerHTML`
- **Issue:** The frontend uses `innerHTML` assignment 36 times across all HTML files to render dynamic content including data from the server (symbol names, chart names, notes, etc.). No sanitization or escaping.
- **Impact:** If any stored data contains malicious HTML/JS (e.g., a chart name of `<img onerror=alert(1)>`), it will execute in the user's browser.
- **Fix:** Use `textContent` for plain text. Use a sanitization library for HTML content. Or adopt a framework with auto-escaping (React, Vue).

---

## Performance Issues

### PERF-1: Frontend Bundle Size
- **Issue:** `index.html` alone is 185 KB of unminified, uncompressed source code delivered as a single HTTP response. Combined with `copilot.html` (97 KB) and `history.html` (41 KB), the frontend is 323 KB of raw HTML/CSS/JS. External CDN dependencies add more: Tailwind CSS (full CDN version), Lightweight Charts, html2canvas.
- **Impact:** Slow initial page load, especially on mobile. Full Tailwind CDN is ~300KB+ and not tree-shaken. No code splitting — everything loads even if unused.
- **Fix:** Use a build system with minification, tree-shaking, and code splitting. Replace CDN Tailwind with build-time compilation.

### PERF-2: N+1 File Reads for All List Operations
- **Issue:** Every "get all" function in `backend/src/services/storageService.ts` reads every file individually: `getAllCandidates()` reads 35+ files, `getAllLabels()` reads 9+ files, etc. `getUnlabeledCandidates()` calls BOTH `getAllCandidates()` AND `getAllLabels()` — two full directory scans.
- **Impact:** Latency grows linearly with data volume. With 100 candidates and 100 labels, a single "get unlabeled" request reads 200+ files.
- **Fix:** Migrate to a database. Or as interim: add an in-memory cache with file-watching invalidation.

### PERF-3: No Caching of Scanner Results
- **Issue:** Every scan request spawns a new Python process, downloads fresh market data from yfinance, and runs the full 3,100-line detection algorithm.
- **Impact:** Scanning the same symbol twice in a row does the full work twice. yfinance calls take 2-5 seconds each.
- **Fix:** Cache chart data by symbol+timeframe with a TTL (e.g., 1 hour for daily data). Store scanner results and skip re-processing if data hasn't changed.

### PERF-4: Synchronous Scanner Execution Blocks Other Requests
- **Issue:** While a scan is running, the spawned Python process consumes resources. Batch scans of 35+ symbols run sequentially, blocking the endpoint for minutes.
- **Impact:** Other users/requests to the `/api/candidates/scan-batch` endpoint must wait for the entire batch to complete.
- **Fix:** Make batch scanning a background job. Return a job ID immediately and let clients poll for results.

---

## Fragile Areas

### FRAG-1: Python ↔ TypeScript Data Contract
- **Issue:** The Python scanner (`backend/services/patternScanner.py`) outputs JSON with snake_case keys (`chart_data`, `swing_points`, `fib_levels`). The TypeScript types (`backend/src/types/index.ts`) use camelCase (`windowStart`, `createdAt`). The translation happens implicitly — some fields match, some don't.
- **Impact:** Any change to the Python output schema silently breaks the frontend. There's no validation that scanner output matches expected TypeScript types. The `candidates.ts` route just does `JSON.parse(stdout)` and passes it through.
- **Fix:** Define a JSON Schema shared between Python and TypeScript. Add runtime validation of scanner output.

### FRAG-2: AI Response Parsing via Regex
- **Issue:** `backend/src/services/visionService.ts` parses the OpenAI GPT-4o response using 25+ individual regex patterns (lines 190-265). Each regex extracts a single field from a semi-structured text response.
- **Impact:** Any change to the AI prompt or model behavior changes the response format, breaking some/all regex patterns. Failed matches silently default to `0.5` or `'UNKNOWN'`. The parser has no way to signal partial failures.
- **Fix:** Switch to structured output (OpenAI function calling / response_format: json_schema). Or at minimum, add validation that critical fields were actually parsed.

### FRAG-3: `ensureDirectories()` Called on Every Operation
- **Issue:** `backend/src/services/storageService.ts` calls `ensureDirectories()` (5 x `fs.mkdir`) at the start of nearly every function — save, get all, clear, etc.
- **Impact:** Defensive but wasteful. Creates filesystem overhead on every API call. If directory creation ever fails, every subsequent operation also fails.
- **Fix:** Call `ensureDirectories()` once at server startup. Add a health check that verifies directories exist.

### FRAG-4: Frontend State Scattered Across Global Variables
- **Issue:** `index.html` manages state through dozens of global JS variables and DOM manipulation. Pattern data, chart state, sidebar state, labeling state, and AI status are all in the global scope with no encapsulation.
- **Impact:** Any function can modify any state. State dependencies are invisible. Hard to reason about what triggers what. Debugging requires reading through 4,000+ lines of JavaScript.
- **Fix:** Adopt a framework with proper state management. Or as interim: organize globals into state objects and use an event-based update pattern.

---

## Missing Infrastructure

### INFRA-1: Zero Tests
- **Issue:** No test files exist anywhere in the project. No unit tests, no integration tests, no end-to-end tests. No test runner is installed (`package.json` has no test-related dependencies).
- **Impact:** Every change is deployed with zero confidence. Pattern detection logic (3,100 lines of numerical code) has no verification. API endpoints have no contract tests.
- **Fix:** Add Jest (backend) and Playwright or Cypress (frontend). Priority: test the Python scanner's detection logic first — it's the most complex and most important code.

### INFRA-2: No CI/CD Pipeline
- **Issue:** No `.github/workflows/`, no `Dockerfile`, no deployment configuration of any kind.
- **Impact:** No automated builds, no automated testing, no automated deployment. Everything is manual.
- **Fix:** Add GitHub Actions for lint + test on PR. Add Docker for reproducible builds.

### INFRA-3: No Git Repository (Currently)
- **Issue:** The project is not currently a git repository (as noted in workspace metadata). No `.gitignore` file exists.
- **Impact:** No version history, no branching, no rollback capability. The `.env` file with the API key would be tracked if git is initialized without a `.gitignore`.
- **Fix:** Initialize git. Create `.gitignore` FIRST (before `git init`) covering `.env`, `node_modules/`, `dist/`, `backend/data/`, `__pycache__/`.

### INFRA-4: No Database
- **Issue:** All data persistence is via JSON files on the local filesystem. No database of any kind.
- **Impact:** No querying, no indexing, no transactions, no relationships, no concurrent access safety. Cannot scale beyond a single machine.
- **Fix:** SQLite for local/dev, PostgreSQL for production. Migrate existing JSON data with a one-time script.

### INFRA-5: No Logging or Monitoring
- **Issue:** Logging is limited to `console.log` and `console.error` scattered throughout the code. No structured logging, no log levels, no request logging middleware, no error tracking.
- **Impact:** Debugging production issues requires reading terminal output. No way to trace requests, measure latency, or detect errors after the fact.
- **Fix:** Add a structured logger (Winston or Pino). Add request logging middleware. Consider error tracking (Sentry).

### INFRA-6: No Error Boundary / Global Error Handler
- **Issue:** `backend/src/server.ts` has no global Express error handler. Unhandled rejections in async routes could crash the server. No `process.on('uncaughtException')` or `process.on('unhandledRejection')` handlers.
- **Impact:** A single unhandled error can take down the entire server with no recovery.
- **Fix:** Add Express error-handling middleware. Add process-level error handlers. Consider using `express-async-errors` or wrap all route handlers.

### INFRA-7: No Environment Validation
- **Issue:** The server starts regardless of whether required environment variables are set. `OPENAI_API_KEY` is only checked when a vision request is made, not at startup.
- **Impact:** Server appears healthy but fails on first use of AI features. Silent misconfiguration.
- **Fix:** Validate required env vars at startup. Fail fast with clear error messages.

---

## Prototype vs Production Gaps

### GAP-1: Single-User Design
- **Current:** `userId` is just a string passed from the client. No auth, no user registration, no sessions.
- **Production needs:** User accounts, authentication (OAuth/JWT), role-based access control, multi-tenancy.

### GAP-2: Local Filesystem Storage → Database
- **Current:** JSON files in `backend/data/` on the local filesystem.
- **Production needs:** PostgreSQL or similar RDBMS with proper schemas, migrations, backups, replication.

### GAP-3: CDN Tailwind → Build System
- **Current:** `<script src="https://cdn.tailwindcss.com">` — the full development build of Tailwind loaded at runtime from CDN.
- **Production needs:** Tailwind compiled at build time with PurgeCSS. Vite or similar bundler. Minification, source maps, code splitting.

### GAP-4: `python` Spawn → Job Queue
- **Current:** Each scan spawns a `python` process directly. No timeout, no concurrency control, no retry logic.
- **Production needs:** Background job queue (Bull, BullMQ). Workers with concurrency limits. Timeout and retry policies. Job status tracking.

### GAP-5: OpenAI Direct Calls → Abstraction Layer
- **Current:** `backend/src/services/visionService.ts` makes direct `fetch()` calls to OpenAI with hardcoded model names (`gpt-4o`).
- **Production needs:** AI provider abstraction layer. Retry logic with exponential backoff. Token usage tracking. Cost monitoring. Model version management. Fallback providers.

### GAP-6: Separated Files → Component Framework
- **Current:** CSS/JS extracted from HTML into separate files (9 files total). Reduces per-file complexity but JS files are still large (3,825 + ~2,040 + 557 lines) with no modules, no shared code, and duplicated utility functions across pages. Co-Pilot JS grew with 4-layer verdict engine and 5 instrument sizers but functions are well-structured.
- **Production needs:** React/Vue/Svelte with component architecture, routing, state management, shared component library, and proper build tooling (Vite).

### GAP-7: `console.log` → Structured Logging & Observability
- **Current:** `console.log` for all output. `console.error` for errors. Verbose debug output in Python scanner (`print(..., file=sys.stderr)`).
- **Production needs:** Structured JSON logging. Log levels. Request correlation IDs. Performance metrics. Health check dashboards.

### GAP-8: No Data Backup or Recovery
- **Current:** All user data (labels, corrections, trades) is in flat JSON files with no backup mechanism.
- **Production needs:** Automated backups, point-in-time recovery, data export/import.

### GAP-9: No HTTPS
- **Current:** Plain HTTP on port 3002.
- **Production needs:** TLS termination (via reverse proxy or direct HTTPS). Secure cookie flags if using sessions.

### GAP-10: No Input Sanitization Anywhere
- **Current:** User input flows from `req.body`/`req.query` directly into storage and back into HTML via `innerHTML`.
- **Production needs:** Input validation (Zod/Joi), output encoding, Content Security Policy headers, CSRF tokens.
