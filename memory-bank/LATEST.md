# Latest Session - 2026-03-30

## Status

- Phase: `REFINE` — ledger-data foundation, PIT source-of-truth hardening, and isolated SEC/Docling ingestion probe
- Product state: universe centralization and PIT historical ownership clarified; isolated SEC filing extraction probe now works end to end
- Current source-of-truth planning area: `.planning/plans/`
- Startup continuity now includes `memory-bank/CURSOR_CONTINUITY.md`, generated from the live Cursor mirror

## Latest Update (2026-03-30)

### Ledger Data Foundation / PIT / Docling Probe

This session shifted focus away from frontend discretionary UX and into the data foundation required for the `Financial Analyst Ledger` to do its job correctly.

### Follow-up Continuation (2026-03-30)

The next continuation step from this handoff was completed:

- hardened the isolated SEC fetch path in `Financial data/docling_probe/scripts/fetch_sec_filing.py`
- added retry/backoff handling for transient SEC request failures
- added cached raw-filing reuse so repeated smoke-test runs do not needlessly re-download filings

This mattered because the one remaining Microsoft `10-Q` failure was not an extraction/layout issue. It was a transient SEC network disconnect on accession:

- `0000950170-23-054855` (`MSFT`, `10-Q`, filing date `2023-10-24`, report date `2023-09-30`)

Validated after the hardening change:

- the missing Microsoft filing now downloads successfully
- Docling conversion succeeds
- canonical extraction succeeds with the full minimum metric set present
- Microsoft smoke test now completes at:
  - `5/5` recent `10-K`s
  - `8/8` recent `10-Q`s

PIT follow-through:

- reran import for Microsoft smoke-test artifacts into `backend/data/fundamentals-pit.sqlite`
- Microsoft filing-derived PIT footprint is now:
  - `13` documents
  - `264` statement fact rows

Implication:

- the remaining Microsoft gap was a probe resilience problem, not a confirmed cross-issuer extraction blind spot
- the next highest-value work is now:
  - stronger evidence references
  - scale/unit/fiscal normalization hardening
  - third-issuer validation
- execution order is now explicitly gated:
  - define canonical schema (strict)
  - define normalization rules (hard)
  - define evidence contract (stable)
  - validate on 2–3 issuers
  - only then scale ingestion

The core architectural decision is now explicit:

- **Universe registry** is the source of truth for which symbols belong to named stock universes
- **Scanner** is the present-time observation layer for what is happening now
- **PIT** is the authoritative historical fact layer for symbol fundamentals over time
- **Validator / backtester** consumes PIT; it is not the owner of historical fundamentals
- **Ledger** should consume PIT facts plus raw/document evidence, not ad hoc scraped summaries

### Repo State Recovery / Guardrails

An explicit cleanup-and-prevention plan now exists for the repo's broader state-management issues:

- `.planning/plans/ACTIVE/repo-state-recovery-and-guardrails-plan.md`
- `.planning/plans/ACTIVE/repo-state-snapshot-2026-03-30.md`
- `backend/scripts/check_repo_state.ps1`

This was created because the repo is currently carrying:

- a large mixed tracked/untracked worktree
- source-of-truth doc drift across some status surfaces
- a partially valid SEC bulk baseline (`companyfacts.zip` good, `submissions.zip` currently invalid)
- a real but not yet fully contract-hardened Ledger/PIT/SEC pipeline

The recovery order is now:

1. establish a clean operational baseline
2. clean the worktree safely
3. reconcile source-of-truth docs
4. stabilize the Ledger data contract
5. repair SEC bulk/raw ingestion discipline
6. finish universe eligibility hardening
7. add operational guardrails
8. add enforcement/automation

Intentional guardrail:

- do not rely on terminal memory or repo-wide git noise to infer current operational state in future sessions
- do run `backend/scripts/check_repo_state.ps1` before ending a session or widening into a new initiative

### Financial Data Execution Follow-Through

The current financial-data repair pass has now executed several concrete cleanup steps:

- added `.planning/plans/ACTIVE/financial-data-execution-plan-2026-03-30.md`
- added `workspace/Financial Analyst Workspace/DATA_CONTRACT.md`
- updated workspace memory so the analyst contract is no longer an open question
- completed PIT hydration against the current cleaned universe:
  - `3539 / 3539` current-universe symbols covered
- pruned old-universe spillover from symbol-keyed PIT tables
- created a PIT safety backup before pruning:
  - `backend/data/pit-backups/fundamentals-pit-before-universe-prune-20260330T141105.sqlite`
- repaired the SEC bulk baseline:
  - `companyfacts.zip` verified valid
  - `submissions.zip` redownloaded and verified valid
- added verification script:
  - `Financial data/docling_probe/scripts/verify_financial_data_state.py`
- wrote machine-readable verification output:
  - `Financial data/docling_probe/raw/sec/bulk/verification_latest.json`

Current verified financial-data state:

- no current-universe hydration gaps remain
- no out-of-universe symbols remain in symbol-keyed PIT tables
- filing-derived PIT data for `AAPL` and `MSFT` was preserved
- both SEC bulk ZIPs are now valid according to zip integrity checks
- a new SEC-backed Ledger filing universe now exists:
  - `backend/data/ledger_filing_eligible.json`
  - registered as `ledger_filing_eligible` in `backend/data/universe/registry.json`
  - counts from the first pass:
    - `3539` source symbols from `clean_stocks`
    - `3263` with recent domestic `10-K`/`10-Q` style reporting forms
    - `240` classified as foreign-reporting filers
    - `31` with no recent domestic reporting forms
    - `5` with no SEC ticker mapping
    - `11` removed by stock exclusions
    - final registry-loaded universe: `3252`
- coverage-tier policy is now explicit:
  - `.planning/plans/ACTIVE/ledger-coverage-tier-contract.md`
  - scanner remains broad on `clean_stocks`
  - Ledger filing-backed depth uses `ledger_filing_eligible`
  - symbols outside the filing-backed subset must be answered with explicit limited-coverage tiers, not silent fallback
- normalization-family guardrail is now explicit:
  - `.planning/plans/ACTIVE/ledger-normalization-family-design.md`
  - normalization rules must generalize by filing family, not by issuer
  - exact dates should only be promoted when recovered from real statement-header context
  - conservative inferred prior periods are preferred over wrong exact dates
- parked workspace/harness follow-up plan now exists:
  - `.planning/plans/ACTIVE/workspace-agent-harness-plan.md`
  - keep the current workspace-per-agent structure
  - add manifests/runners/reports only when we are ready to formalize recurring experiments
- Ledger storage/retrieval architecture is now explicit:
  - `.planning/plans/ACTIVE/ledger-data-storage-and-retrieval-architecture.md`
  - PIT/relational DB is the structured source of truth
  - raw filings and Docling outputs remain on disk for provenance
  - filing narrative should be chunked into a retrieval layer for Ledger evidence and hidden-risk review
  - graph storage is a possible later layer, not the first answer
- internal agent/tooling development playbook now exists:
  - `docs/agent-tooling-development-howto.md`
  - captures what to borrow from the Claude Code architecture material without copying unnecessary swarm complexity
  - formalizes coordinator vs worker roles, tool/workflow contracts, sandbox-to-production promotion rules, and memory/checkpoint discipline for future Ledger development
  - now also includes a repo-specific `proactive agent mode` section
  - captures what is useful from the `KAIROS`/always-on assistant idea:
    - heartbeat-based noticing
    - append-only action logs
    - scheduled background review
    - explicit notification modes
  - and what must remain guarded:
    - no unconstrained autonomy
    - no silent high-risk action
    - no proactive claims without evidence and coverage awareness
- `companyfacts` now has a direct PIT import path:
  - `backend/scripts/import_companyfacts_to_pit.py`
  - imports SEC bulk `companyfacts` JSON into the existing `pit_documents` and `pit_statement_facts` tables
  - uses strict duration filtering so annual facts come from true annual periods and quarterly facts avoid 6-month / 9-month `10-Q` durations
  - stores rows under `source_type = sec_companyfacts_bulk`
  - derives `free_cash_flow` from operating cash flow and capex when both are present for the same filing/period
- full `companyfacts` import completed on `2026-04-01`:
  - report: `Financial data/docling_probe/raw/sec/bulk/companyfacts_import_20260401T095318Z.json`
  - requested eligible symbols: `3263`
  - symbols with imported facts: `3257`
  - imported `pit_documents`: `142813`
  - imported `pit_statement_facts`: `2295572`
  - status breakdown:
    - `3257` ok
    - `4` no usable companyfacts rows
    - `2` missing companyfacts files
  - current outliers:
    - missing file: `BTGO`, `MWH`
    - no usable rows after filtering: `BOBS`, `OFRM`, `PARK`, `YSS`
- implication:
  - PIT now has a broad SEC/XBRL statement backbone for the Ledger filing universe
  - next major step should be retrieval indexing over the chunk corpus and then Ledger review logic that combines PIT facts with filing narrative evidence
- source precedence is now explicit:
  - `.planning/plans/ACTIVE/ledger-source-priority-matrix.md`
  - statement facts:
    - primary = SEC `companyfacts`
    - secondary = Docling/canonical filing extraction
    - fallback = vendor PIT hydration
  - market facts:
    - primary = vendor PIT hydration
  - narrative/hidden-risk evidence:
    - primary = filing text + retrieval chunks
  - implication:
    - next implementation should include a canonical statement-fact resolver rather than deleting overlapping source rows

Implication:

- the next financial-data work should move to contract hardening, evidence hardening, and third-issuer validation rather than basic bulk/PIT cleanup

#### 1. Stock universe centralization completed

Remaining fragmented universe usage was moved onto the shared registry and loaders:

- Added Python helper: `backend/services/universe_registry.py`
- Added one rebuild entrypoint: `backend/scripts/rebuild_stock_universes.py`
- Added regime universes to `backend/data/universe/registry.json`
- Migrated validator regime lookups to registry-backed loading
- Migrated regime builder and market-cap seeding logic to shared loaders

Result:

- stock universe definitions are more centralized
- exclusions and market-cap snapshots are applied consistently
- PIT hydration and validation paths can now point at canonical universes instead of scattered JSON assumptions

#### 2. PIT ownership corrected toward historical source-of-truth semantics

The PIT layer was explicitly moved toward "whole universe, point-in-time historical truth" semantics instead of being treated as a sidecar for validator subsets.

Key changes:

- `backend/scripts/hydrate_fundamentals_pit.py`
  - default universe changed toward `clean_stocks`
  - explicit `--universe` support added
  - explicit `--symbols` / `--symbols-file` now correctly override universe defaults
- `backend/services/fundamentals_pit_store.py`
  - added append-only `raw_source_cache_history`
  - ingestion now writes both latest raw snapshot and historical raw snapshot lineage
- `backend/tests/test_fundamentals_pit_store.py`
  - updated to verify raw history retention across multiple ingests

Result:

- PIT now better matches the intended historical source-of-truth role
- raw vendor payload lineage is preserved instead of only the latest copy
- future normalization work has a durable historical evidence base

#### 3. Minimum viable ledger data was clarified

The working conclusion is that Ledger does not need vague "AI notes." It needs structured business facts and evidence with time correctness.

Minimum useful ledger inputs now understood as:

- filing metadata and timing context
- income statement facts
- balance sheet facts
- cash flow facts
- capital allocation facts
- evidence links/snippets back to the raw filing or raw payload source
- PIT-style `available_at` discipline so historical reasoning does not leak future data

#### 4. Isolated SEC + Docling ingestion probe built

To keep experimentation separate from the main runtime path, an isolated probe was built under:

- `Financial data/docling_probe`

What now exists there:

- SEC filing fetch script
- Docling conversion script
- first-pass canonical fact extractor
- one-company end-to-end pipeline runner
- separated folders for raw SEC files, processed Docling outputs, and extracted canonical facts

Validated end-to-end on Apple `10-K`:

- filing downloaded from SEC
- Docling produced structured markdown + JSON
- first-pass canonical extractor pulled useful financial facts including revenue, operating income, net income, current assets/liabilities, equity, operating cash flow, capex, and derived free cash flow

Result:

- this is now a real proof-of-concept, not just a thought experiment
- we have evidence that primary-source filing ingestion is viable
- the next work is normalization depth and PIT integration, not "does this concept work at all?"

#### 5. Local Ledger/PIT database path implemented

The workstream is now beyond pure planning.

Completed:

- added canonical schema doc: `docs/ledger-canonical-fact-schema.md`
- extended `backend/services/fundamentals_pit_store.py` with:
  - `pit_documents`
  - `pit_statement_facts`
  - filing-derived canonical ingestion helpers
- extended `backend/services/fundamentals_pit_query.py` with:
  - `get_facts`
  - `get_statement_history`
  - `get_document_evidence`
  - `get_latest_available_facts`
- added import bridge:
  - `Financial data/docling_probe/scripts/import_smoke_test_to_pit.py`
- loaded Apple `5 annual + 8 quarterly` smoke-test data into:
  - `backend/data/fundamentals-pit.sqlite`

Verified:

- `13` documents imported
- `264` filing-derived fact rows imported
- unit tests for PIT store/query passed
- live query validation against the real SQLite database succeeded

Result:

- the repo now has a real local Ledger/PIT database path
- filing-derived facts are no longer only isolated JSON artifacts
- the next work is hardening and broadening the schema, not first creation

#### 6. Second issuer validation advanced the probe

The next expansion step was started on Microsoft (`MSFT`, `CIK 789019`).

What happened:

- the first Microsoft smoke test exposed a real portability weakness:
  - the extractor was too dependent on Apple-style labels and date headers
- the isolated extractor was then hardened to support:
  - `Total stockholders' equity`
  - `Net cash from operations`
  - `Additions to property and equipment`
  - year-only header layouts and partial-row/header alignment

Current Microsoft result:

- `5/5` recent `10-K`s retrieved and extracted successfully
- `7/8` recent `10-Q`s retrieved, extracted, and imported successfully
- `12` Microsoft documents imported into PIT
- `246` Microsoft filing-derived fact rows imported into PIT

Result:

- the pipeline now clearly generalizes beyond Apple
- however, one remaining Microsoft `10-Q` still failed, so cross-issuer robustness is improved but not yet complete

#### 7. New planning anchor for Ledger data work

Primary active planning file for this workstream:

- `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`

Additional related planning files:

- `.planning/plans/ACTIVE/family-structure-validation-ledger.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
- `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md`
- `.planning/plans/ACTIVE/primitive-normalization-engine-and-autonomous-research.md`

Additional implementation/reference doc:

- `docs/ledger-canonical-fact-schema.md`

Isolated experimental workspace for this workstream:

- `Financial data/docling_probe`

Next-AI handoff:

- start with `memory-bank/LATEST.md` and `memory-bank/CHAT_MEMORY.md`
- then read `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- for ledger fact contracts and normalization, also read:
  - `docs/ledger-canonical-fact-schema.md`
  - `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md`
  - `.planning/plans/ACTIVE/primitive-normalization-engine-and-autonomous-research.md`
- for family-backed ledger evaluation context, also read:
  - `.planning/plans/ACTIVE/family-structure-validation-ledger.md`
- for the isolated SEC filing probe, inspect:
  - `Financial data/docling_probe/README.md`
  - `Financial data/docling_probe/scripts/`
  - `Financial data/docling_probe/raw/sec/`
  - `Financial data/docling_probe/processed/docling/`
  - `Financial data/docling_probe/extracted/canonical/`
  - `Financial data/docling_probe/extracted/smoke_tests/`
- for the implemented local Ledger database path, inspect:
  - `backend/services/fundamentals_pit_store.py`
  - `backend/services/fundamentals_pit_query.py`
  - `backend/data/fundamentals-pit.sqlite`

That file is the explicit record of:

- what has been completed
- what remains
- which information is required for Ledger to do its job
- how the isolated Docling probe should eventually connect to PIT

---

## Previous State

## Latest Update (2026-03-25)

### Trading Desk — Discretionary Workflow Hardening

All work this session focused on the Trading Desk (`copilot.html` + supporting JS files). Three major features were built and debugged to working state.

#### 1. Programmatic Stop / Take Profit Config (Stock Risk Config)

Added a "Risk Configuration" section to the Instrument Settings sidebar (shown only for `stock` instrument type):

- **Stop Type** dropdown: manual (chart placement), ATR Stop, Fixed % Stop
- **ATR Stop** sub-fields: ATR Period (default 14), ATR Multiplier (default 2.0)
- **Fixed % Stop** sub-field: Stop Distance %
- **Take Profit Type** dropdown: manual, Fixed R-Multiple, Fixed %
- **R-Multiple** sub-field: R Multiple (default 2)
- **Fixed % TP** sub-field: Target Distance %

Behavior:
- Stops/TP are only calculated AFTER an entry price is placed on the chart
- When entry is placed (`setEntry()`), `applyStockRiskConfig()` runs automatically if a programmatic stop type is selected
- Lines draw on the chart immediately via `window.setStopLoss()` / `window.setTakeProfit()`
- Manual chart placement (clicking Stop/Target buttons) resets the dropdown to "manual" via `window._stockRiskClearStop()` / `window._stockRiskClearTP()`
- Settings persist across page reloads via a dedicated `saveStockRiskConfig()` function that only writes risk config fields, preventing clobbering by `autoPopulateInstrumentSettings()` default values

Key fix: `oninput` (not `onchange`) used on all number spinners so spinner arrows fire the recalculation instantly.

Files: `copilot.html` (UI), `copilot-core.js` (`applyStockRiskConfig`, `saveStockRiskConfig`, `_computeATR`), `copilot-chart.js` (`setEntry` triggers recalc, click handler clears dropdowns on manual placement).

#### 2. Trade P&L Summary Panel

A live "Trade P&L Summary" panel below Position Size in the Instrument card shows:

- **Stop @ Price** — exact stop price + % distance from entry
- **Target @ Price** — exact target price + % gain from entry
- **Max Loss** — dollar loss if stopped out
- **Max Gain** — dollar gain if target hit
- **R:R** — risk/reward ratio

Instrument-aware calculations in `syncInstrumentPnlSummary()` (`copilot-analysis.js`):
- **Options**: uses premium × multiplier × contracts; stop = zero (full loss of premium); TP = entry premium × optionTpR (min 2R default)
- **Futures**: uses point value × contracts; stop/target from chart levels
- **Stock / Crypto / Forex**: price × shares/units from position size

Panel shows when entry is set with either stop or target; hides when `clearLevels()` is called.

#### 3. Watch List Right Drawer

Replaced the sidebar Watch List panel with a collapsible right-side drawer:

- **Tab**: fixed vertical tab on the right edge, badge showing count, slides right when drawer is open
- **Drawer**: 280px wide, slides in from the right with CSS transition, `position: fixed`
- **Chart resize**: when drawer opens, `padding-right: 284px` is set on `#main-content` (not `margin-right` — flex item margin doesn't reduce content width; padding with `box-sizing: border-box` does). `requestAnimationFrame` lets the browser reflow before dispatching `window.resize`. A second resize fires 250ms later (after the 220ms CSS transition settles) to snap the chart to final width.
- **Load on click**: clicking a symbol item calls `tdWatchListLoad(sym)` — closes drawer, then after 50ms sets the symbol input and calls `runCopilotAnalysis()`

**Bugs fixed this session:**
1. `runCopilotAnalysis` was never exposed as `window.runCopilotAnalysis` — the `typeof` check in `tdWatchListLoad` silently failed. Fixed by adding `window.runCopilotAnalysis = runCopilotAnalysis` at the bottom of `copilot-analysis.js`.
2. Drawer item `onclick` attribute used `JSON.stringify(sym)` inside double-quoted HTML attribute → `onclick="tdWatchListLoad("NVDA")"` — broken HTML. Fixed by switching to single-quoted attribute: `onclick='tdWatchListLoad("NVDA")'`.
3. Chart `margin-right` approach didn't reduce the flex item's content width. Switched to `padding-right`.
4. `window.dispatchEvent(new Event('resize'))` fired before browser reflow — fixed with `requestAnimationFrame`.

#### 4. Watch List — Scanner Integration

Both scanner pages (main `/` and `/workshop`) have star (☆/★) buttons on each candidate row to save/remove from the Watch List. The Watch List persists in `localStorage` via `watch-list.js` (TTL: 5 trading days, key: `scanner-watchlist-v1`). Both pages include `watch-list.js` via `<script>` tag.

---

## Previous State

## What Changed Recently

### 2026-03-15 highlights — Structural Motif Family Research System

1. **Complete research_v1 Python pipeline** (`backend/services/research_v1/`):
   - 12 modules: `schema.py`, `normalizer.py`, `atr_pivots.py`, `legs.py`, `labels.py`, `motifs.py`, `outcomes.py`, `families.py`, `inspection.py`, `multi_symbol.py`, `stability.py`, `direction.py`, `explorer.py`
   - Pipeline: `bars → normalize (ATR-14) → ATR reversal pivots → legs → pivot labels (HH/HL/LH/LL) → 5-pivot motifs → forward outcomes → family aggregation → fragmentation → inspection → cross-symbol comparison → behavior stability`
   - Causal throughout: pivot-5 confirmation bar is the outcome anchor, chronological splits only (never shuffled)

2. **Two-layer family signature system**:
   - **v1 (exact)**: `pivot_type_seq | pivot_label_seq | leg_direction_seq | retrace_bins` — traceable but over-fragmented (128 families from 155 motifs on SPY 1d 5y)
   - **v2 (generalized)**: `orientation | structural_class | break_profile | retrace_profile` — 17 families from 155 motifs, 9 present in all splits, 8 candidate families

3. **Multi-symbol research** (SPY, QQQ, IWM, DIA — daily, 10 years):
   - Cross-symbol family comparison (`build_cross_symbol_family_comparison`)
   - Behavior stability report with trade simulation (1R target/stop), direction agreement, regime sensitivity
   - All artifacts saved per-symbol under `backend/data/research/atr_pivot_v1/`

4. **Family Explorer UI**:
   - Static HTML explorer built by `explorer.py` with embedded LightweightCharts
   - Sidebar: family list with search, direction filter, comparison filter, candidate filter
   - Detail panel: per-symbol stats, representative exact signatures, motif examples with SVG snippets
   - Chart inspector modal: candles, pivots, motif window highlight, entry anchor
   - Served via `/family-explorer` route → iframe loads generated `etf_1d_10y_family_explorer.html`

5. **Research runner** (`backend/scripts/run_atr_pivot_research.py`):
   - Runs full pipeline for 4 ETFs, saves all intermediate JSON artifacts
   - Produces cross-symbol comparison and stability reports

6. **Test coverage**:
   - `test_structure_discovery_families.py` — family aggregation, splits, fragmentation
   - `test_structure_discovery_inspection.py` — inspection reports and SVG snippets

7. **Strategy validation policy** (`docs/strategy-validation-policy.md`):
   - Tier 1 (Existence) → Tier 2 (Repairability, bounded sweep) → Tier 3 (Certification, no rescue) → Post-certification optimization
   - Result categories: Pass, Review, Hard Fail, Tombstone
   - Identity preservation rule: tuning adjustments only, not logic changes
   - Sweep rules: bounded attempts, failure-targeted, identity-preserving

8. **Roadmap** (`.planning/plans/ACTIVE/Update.md`):
   - System layers: Research → Signal → Strategy → Portfolio
   - UI build priority: Family ranking controls → Baseline/null-model comparison → Visual motif inspection → Signal layer → Execution simulation → Strategy layer → Portfolio layer

### 2026-03-11 highlights

1. **Stockdex integration** (fundamentals enrichment):
   - Installed `stockdex` Python package (v1.2.4) — pulls from Finviz, Macrotrends, Yahoo Web scraping
   - Extended `fundamentalsService.py` with `_fetch_stockdex()` function that supplements the existing yfinance data with:
     - Finviz insider trading (recent 10 transactions: who, date, buy/sell, cost, value)
     - Finviz earnings history (12 quarters: EPS actual vs estimate, beat %, sales)
     - Yahoo Web growth estimates (current qtr, next qtr, current year, next year)
     - Yahoo Web financial highlights (revenue, margins, cash, debt with TTM/MRQ)
     - Yahoo Web trading information (52W range, MAs, short interest, dividends)
     - Yahoo Web top institutional holders (top 10 with shares and % outstanding)
   - Graceful degradation: if stockdex import fails or any endpoint errors, returns null for that section
   - Service timeout increased from 20s to 30s for the additional network calls

2. **Type system and contract validation**:
   - Added `stockdex?: Record<string, unknown> | null` to `FundamentalsSnapshotV2` type
   - Updated `normalizeFundamentalsSnapshot()` to pass through the stockdex object

3. **Scanner fundamentals panel UI** (new sections when stockdex data available):
   - **Growth Estimates** card — forward EPS growth projections (current/next qtr, current/next year)
   - **Price & Momentum** card — 52W range, 50/200-day MAs, avg volume
   - **Earnings History** table — QTR / EPS / EST / BEAT% / SALES for last 6 quarters
   - **Insider Trades** table — WHO / DATE / TYPE / VALUE with color-coded buy (green) / sell (red)
   - **Top Institutional Holders** table — HOLDER / SHARES / % OUT for top 8
   - Added 3 new builder functions: `buildEarningsHistoryCard`, `buildInsiderTradesCard`, `buildInstitutionalHoldersCard`

4. **AI copilot context enrichment**:
   - Extended `FUNDAMENTALS_SNAPSHOT` in `ai-chat.js` with `[STOCKDEX_EXTENDED]` block
   - AI now receives: growth estimates, recent earnings beat/miss summary, insider activity summary (buys vs sales), top institutional holder names

### 2026-03-09 highlights

1. Execution bridge hardening:
   - crypto execution is now filtered to broker-tradable Alpaca assets before order attempts
   - bridge config persists across backend restarts and auto-resumes on boot
   - live execution and backtesting now resolve `R_multiple` targets from `exit_config.target_level`
   - managed positions can repair missing or wrong exits
2. Live paper-trade proof:
   - the bridge successfully submitted a paper trade using `pullback_uptrend_entry_composite_v2`
   - current proof path used `PALL`
3. Execution UI clarity:
   - execution page shows the active strategy
   - positions and execution log now expose strategy context
   - positions show unrealized PnL percent
4. Scanner AI UX:
   - scanner page now has a fundamentals-aware copilot under the fundamentals snapshot
   - AI chat composers were standardized to the wider embedded-arrow layout across pages
   - scanner decision questions now force a direct `BUY` / `WAIT` / `PASS` style call
5. Cursor continuity system:
   - live Cursor storage is mirrored into `offline-cursor-transcripts-live/`
   - compact startup continuity is generated in `memory-bank/CURSOR_CONTINUITY.md`
   - searchable long-term transcript memory is generated in `memory-bank/transcripts/cursor-session-live.md`

### Core hardening work completed

1. Added real backend regression coverage for:
   - vision response parsing
   - training forward resolution
   - candidate filtering
   - candidate semantics
   - candidate persistence
   - chart normalization
   - runtime contract validation
   - Python validator fixtures
   - fundamentals scoring/tagging
2. Tightened route/service contract normalization across:
   - candidates
   - chart
   - fundamentals
   - plugin service responses
3. Refactored route-owned logic into focused backend services.

### Scanner semantics cleanup

Scanner candidates now distinguish:

- `candidate_role`
  - `context_indicator`
  - `pattern_detector`
  - `entry_signal`
- `candidate_actionability`
  - `context_only`
  - `setup_watch`
  - `entry_ready`

This separation now flows through:

- backend candidate APIs
- scanner result rows
- candidate detail badges
- scanner AI/copilot context

### Fundamentals snapshot upgrade

The scanner fundamentals panel was upgraded from a static Yahoo-style summary to a more tactical/speculative decision layer with:

- survivability / cash runway
- growth trend and acceleration
- dilution risk
- catalyst timing
- squeeze pressure context
- EV / sales / net cash context
- tactical tags and scores

The scanner copilot also receives that fundamentals snapshot.

### Documentation cleanup

The main docs were rewritten to match the actual system:

- `README.md`
- `docs/ARCHITECTURE.md`

### Planning cleanup

The old flat planning folder was cleaned up into:

- `.planning/plans/ACTIVE`
- `.planning/plans/BACKLOG`
- `.planning/plans/REFERENCE`
- `.planning/plans/ARCHIVE`

Additional cleanup completed:

- merged Python execution planning into one active file
- merged indicator library planning into one backlog file
- deleted stale mockups and low-value dead plans
- moved stale references out of the live reference bucket

See:

- `.planning/plans/README.md`
- `.planning/plans/RETENTION-AUDIT.md`

## Current Priorities

Top active planning files:

1. `.planning/plans/ACTIVE/family-discovery-v2-prd-pdr.md` — structural motif family research (current focus)
2. `.planning/plans/ACTIVE/Update.md` — phased roadmap (research → signal → strategy → portfolio)
3. `.planning/plans/ACTIVE/single-user-production-readiness-checklist.md`
4. `.planning/plans/ACTIVE/backtesting-master.md`
5. `.planning/plans/ACTIVE/research-to-live-trading.md`

## Immediate Next Candidates

Per the roadmap in `Update.md`, the next build priorities are:

1. **Family ranking controls** — sorting/filtering families by t-score, occurrence count, cross-symbol dispersion, agreement status
2. **Baseline / null-model comparison panel** — compare family behavior vs random timestamps, random motifs, direction-only baseline
3. **Visual motif inspection improvements** — beyond current SVG snippets
4. **Signal layer** — turn a family into a live/causal event at pivot-5 confirmation, integrate with backtester
5. **Execution simulation panel** — simulate trading top families under actual rules

## Notes

- The app is still file-backed by design.
- The frontend is still a multi-page vanilla JS system, not a React app.
- The project does not need more broad features right now; it needs reliability and lower maintenance drag.

## Latest Update (2026-03-19)

### Next Intended Workstream

- Begin the repo-wide **state-machine migration audit** for strategies.
- Working rule: any strategy whose logic depends on inter-bar memory must be migrated to explicit `setup_config.state_machine` semantics.
- Why this migration is necessary:
  - the old engine evaluated strategies statelessly on each bar prefix, with no memory across bars
  - sequence-dependent strategies were therefore being tested incorrectly
  - strategies that should arm on one event and trigger later were re-evaluated cold on every bar
  - this caused false positives, duplicate entries, broken watch-window semantics, and phantom trades
  - the first migrated families proved the issue was real: once explicit state was added, trade behavior and validation results changed materially
  - conclusion: for any strategy that depends on temporal sequencing, stateless backtests are not trustworthy enough for promotion to live execution
- Family-by-family checklist now lives in:
  - `.planning/plans/ACTIVE/structural-families-to-execution-prd.md`
- Current inventory status:
  - `wyckoff_accumulation_rdp` — stateful-required, migrated lineage exists
  - `lth_continuation_composite` — stateful-required, migrated lineage exists
  - `macd_divergence_crypto_14R` — stateful-required, historical migration documented, current stateful spec needs normalization/recovery
  - `pullback_uptrend_entry_composite` — needs review because it may inherit stateful timing from MACD divergence
  - `sma_50_200_benchmark` — stateless-safe control
- Important policy: do not mass-convert every strategy; only families that truly require inter-bar state should be migrated.

### State Machine Engine — Full Implementation

#### Problem confirmed by audit
The strategy engine was 100% stateless. Every call to `run_strategy()` was cold — no memory across bars. 93% of production strategies (13 of 14) require inter-bar state to execute correctly. Backtest results for those strategies were systematically wrong.

#### What was built
Four surgical changes, zero breaking changes to existing stateless strategies:

1. **`backend/services/execution_state.py`** (new file) — the entire state model:
   - `StrategyState` dataclass: `phase`, `armed_bar_index`, `watch_bars_remaining`, `flags`, `anchors`, `bars_in_phase`
   - `apply_state_transitions()` — reads `state_machine` config, mutates state, returns emit signal
   - `make_state_store()` / `get_or_create_state()` — keyed by `(strategy_version_id, symbol, timeframe)`
   - Phases: `idle → armed → watching → entered / invalidated / expired`

2. **`backend/services/backtestEngine.py`** — state store initialized before bar loop, threaded per bar, stateless path unchanged when no `state_machine` config present

3. **`backend/services/strategyRunner.py`** — `run_strategy()` accepts `strategy_state=None`, passes to plugin via kwargs with `TypeError` fallback for stateless plugins

4. **`backend/services/plugins/composite_runner.py`** — `run_composite_plugin()` and `_evaluate_condition_tree()` accept `strategy_state=None`

5. **`backend/src/types/strategy.ts`** — `StateMachineConfig`, `StateMachineTransition`, `StrategyPhase` types added; `state_machine?: StateMachineConfig` added to `SetupConfig`

6. **Tests** — `backend/tests/test_execution_state.py` — 21/21 passing. Covers: init defaults, tick, expiry, invalidation, arm sequence, emit, store singletons, stateless regression.

#### Three migrated strategy specs
- `macd_divergence_crypto_14R_v2_stateful.json` — MACD Divergence family
- `wyckoff_accumulation_rdp_v1_stateful.json` — Wyckoff family
- `lth_continuation_composite_v1_stateful.json` — LTH Continuation family

#### Validation results (MACD Divergence stateful)
- Tier 1: Expectancy 0.30R → **0.48R (+61%)**, trades 30 → 42. Both pass.
- Tier 2: Expectancy 1.10R vs 1.06R stateless. Trade count 111 vs 49 (stateless failed threshold). OOS degradation 61.6% both versions → confirmed as strategy design problem (14R TP), not engine problem.
- **Root cause of OOS degradation**: `take_profit_R: 14` requires too long to resolve. A few massive winners inflate in-sample; they don't repeat OOS.
- **Fix**: TP reduced to 3R, `max_hold_bars` reduced to 30. Parameter manifest updated.
- Tier 1 re-run at 3R: Expectancy **+0.46R**, trades **194**, sensitivity score **4.4/100**.
- Sensitivity findings: `take_profit_R` +15% when raised, `atr_multiplier` +19.6% when raised, `swing_epsilon_pct` and `watch_bars` both 0% (flat — excluded from sweep).

#### Parameter manifest made sweep-aware
- `sweep_enabled: false` set on flat parameters (`swing_epsilon_pct`, `watch_bars`)
- Sweep values for TP biased upward: 2.5, 3.0, 3.5, 4.0
- Sweep values for ATR biased upward: 2.0, 2.5, 3.0
- `_sensitivity_note` added to each manifest entry explaining why

#### Sensitivity-driven sweep plan (new feature)
- New endpoint: `GET /api/sweep/smart-plan/:strategyVersionId`
- Reads latest Tier 2 report, extracts `nudged_results`, ranks by impact, excludes flat params, biases ranges toward productive direction
- `sweep.html` — new `<div id="smart-plan-banner">` above Quick Presets
- `sweep.js` — `loadSmartPlan()`, `renderSmartPlan()`, `applySmartPlanParam()` — auto-loads on strategy select, shows ranked params with Use/Run All buttons

#### Parameter sensitivity panel formatting fixed
- `validator.js` sensitivity rows rewritten: full param name (prefix stripped), ▲/▼ direction labels, Result R in own column, bar fills cleanly left/right, Change % in own column, large impact rows highlighted red

## Latest Update (2026-03-18)

### Family Explorer → Strategy Pipeline: First Live Test

#### Architecture clarified (this session)

Full taxonomy settled:
- **Regime** — market permission layer (not yet built)
- **Composite** = Structure + Location + Timing
  - **Structure** — family detection (`structural_family_signal` plugin, already built)
  - **Location** — price zone gate (Fib primitive, already exists)
  - **Timing** — indicator trigger (RSI primitive, already exists)
- **Risk** — stop, target, sizing (existing validator/execution infrastructure)
- **Validation gate** — Tier 1 → Tier 2 → Tier 3 before live execution (existing)

#### Key architectural finding

`structural_family_signal.py` and `structural_family_signal.json` already exist and are fully wired into the plugin/validator system. The bridge between the family research layer and the strategy validator was already built. No new code was needed to run a family-based strategy through the validator.

#### Fixes shipped (2026-03-18)

1. **`structural_family_signal.json`** — changed `indicator_role` from `"timing_trigger"` to `"anchor_structure"` so the block drops into the Structure slot (not Timing) in the Blockly composer.

2. **`GET /api/research/families`** — new endpoint in `research.ts` that reads `etf_1d_10y_family_comparison_v2.json` and returns families sorted by candidates first, then |t10|. Enables the family picker UI.

3. **Blockly composer family picker** — added `loadKnownFamilies()` async loader, `openFamilyPicker()` modal system, and `injectFamilyPickerButton()` banner above the workspace. The banner appears whenever a `structural_family_signal` block is present and lets you pick a family from a searchable modal showing signature, t10, mean10, occ, symbol count, and candidate status.

4. **Composition validator** — removed the `requireAll` gate that forced all three slots (structure + location + timing) to be filled for entry intent. Structure-only composites are now valid so you can test structure in isolation.

5. **Family Explorer tooltips** — full CSS tooltip system added to `explorer.py` covering all signature tokens, tag badges, metric cards, kv rows, and chart inspector meta cards.

6. **Family Explorer `build_family_explorer.py`** — confirmed this script regenerates the HTML from existing artifacts without re-running the full data pipeline. Run this after any `explorer.py` changes.

#### First family strategy now running through validator

Composite: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Structure: structural_family_signal (that family only)
- Location: Fib 50–79%
- Timing: RSI(14) < 30, cross below
- Risk: ATR stop 2.0×, take profit 2R, max hold 20 bars
- Universe: SPY, QQQ, IWM, DIA (daily)
- Status: Tier 1 running

Key watch metrics: trade count (need ≥25), expectancy direction.

#### Recommended test sequence (post-Tier 1)

1. Structure only → raw edge baseline
2. Structure + Location → does Fib zone add edge?
3. Structure + Location + Timing → does RSI add edge?
4. If any pass Tier 1 → Tier 2 sweep on Fib range, RSI level, R target

## Latest Update (2026-03-17)

### Parameter Manifest Is Now the Core Contract

The app now has a canonical parameter contract for strategies:

- `parameter_manifest` on `StrategySpec`
- shared resolver in `backend/src/services/parameterManifest.ts`
- shared consumption by:
  - Sweep
  - Validator sensitivity
  - Strategy Details
  - stored strategy/read paths

This closed a major gap discovered during Density Base / sweep debugging:
- the policy said Sweep should only turn real, identity-preserving knobs
- but the app was not consistently exposing those knobs

### Composite Builders Are Being Unified

Current state:
- Blockly composer: infers real tunable params from stage params
- Pipeline/node editor: infers real tunable params from node params
- AI composite builder: now updated to do the same instead of emitting empty `tunable_params`

Result:
- all composite creation paths are converging on the same parameter-exposure model

### Key Policy Learning

The strategy validation policy was directionally correct but incomplete.

What it already said:
- Sweep is bounded
- Sweep is failure-specific
- Sweep must preserve identity

What was missing:
- a canonical declaration of which knobs are actually valid to sweep

The parameter manifest is the missing operational layer.

### Snapshot / Recovery State

We now have both:

1. Local full recovery snapshot
- branch: `snapshot/local-2026-03-17-125952`
- tag: `snapshot-local-2026-03-17-125952`

2. Separate runtime data backup
- `C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector-backups\snapshot_2026-03-17_125511`

3. Clean remote code snapshot in GitHub
- remote repo: `GateKeeper`
- remote `main` now points to the clean snapshot export
- remote branch: `snapshot/clean-gatekeeper-2026-03-17-export`
- remote tag: `snapshot-clean-gatekeeper-2026-03-17`

### Current Big Truth

The repo is now safer in two senses:
- code recovery exists locally and remotely
- data recovery exists separately outside git

And architecturally:
- Sweep and Validator are now moving toward the same strategy-native parameter model instead of generic ad hoc knobs
## 2026-03-30 - Ledger raw filing pull completed; Docling batch processing started

- Raw SEC filing download across `ledger_filing_eligible` is complete at the current rule set:
  - `3252` symbols requested
  - `3219` symbols completed
  - `33` symbols failed due missing recent `10-K` or `10-Q`
  - `6438` filing HTML documents downloaded
- Added resumable Docling batch tooling:
  - `Financial data/docling_probe/scripts/run_docling_batch.py`
  - `Financial data/docling_probe/scripts/run_docling_worker.ps1`
- Docling processing is running in background batches against the staged SEC raw filings.
- Normalization and PIT import remain intentionally on hold until schema / normalization / evidence hardening.

## 2026-04-01 - Scanner metric source registry

- Added `backend/data/scanner_metric_source_registry.json`.
- This is the explicit field-by-field provenance map for the scanner page.
- It marks each displayed metric as one of:
  - `sec_primary`
  - `vendor_primary`
  - `vendor_composed`
  - `derived`
  - `heuristic`
- It also records the intended primary source, fallback sources, and formulas/notes for the main displayed financial fields so scanner and Ledger can align on one source policy.
