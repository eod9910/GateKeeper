# Chat Memory (Key Decisions & Context)

> Keep this small. Goals, decisions, preferences, open threads only.
> Use transcripts/ for full detail. Use Grep to search them.

## Active Project: Pattern Detector / Trading Co-Pilot

### Recent Working State (2026-05-05) — Market Intelligence Asymmetric Narrative Layer

- **Target hunting model locked:** find undercovered, high-consequence, socially accelerating, tradable, verifiable narratives before Wall Street fully models them.
- **Social ARB field-map architecture locked and first slice built:** clean universe is now the coordinate system. `run_universe_mention_normalization.py` maps broad `mi_raw_hits` to all `backend/data/universe_clean.json` symbols/aliases, writes normalized mention/daily/baseline/perturbation tables, labels ticker-board sources as confirmation vs broad matches as organic discovery, and exposes `GET /api/market-intelligence/social-arb/universe-movers` plus the Market Intelligence `Normalized Universe Movers` panel. First local run scanned `6,037` raw hits, matched `5,837` symbol mentions, refreshed `1,564` daily buckets, wrote `258` baselines, and scored `7` latest-day perturbations. Scheduler job: `universe_mention_normalization` every 2h at `:28`. `run_universe_mover_claims.py` is now the conservative bridge into `emerging_claims` (`universe_mover_claims` every 2h at `:30`), requiring multiple mentions, organic discovery, and z-score/score thresholds; current production run inserted `0` claims because latest movers are weak/noisy. Cluster builder now keeps single-company mover clusters separated per ticker.
- **Pipeline now exists end to end locally:**
  - `mi_raw_hits -> emerging_claims -> narrative_clusters -> market_situations`
- **Claim extraction:** `backend/scripts/run_narrative_claim_extraction.py` produced `47` local `emerging_claims`.
- **Narrative clustering built:** `backend/scripts/run_narrative_cluster_builder.py`
  - Groups claims by asymmetric theme/claim type.
  - Preserves many-to-many claim lineage in `narrative_cluster_claims`.
  - Assigns `WATCH`, `RESEARCH`, or `SCENARIO_READY`.
  - Stores deterministic promotion rationale in cluster metadata.
  - Maps richer asymmetric themes to existing `theme_registry` keys while keeping `metadata_json.asymmetric_theme`.
- **Narrative promotion built:** `backend/scripts/promote_narrative_clusters.py`
  - Promotes only mapped, unpromoted `SCENARIO_READY` clusters.
  - Preserves lineage in `market_situations.metadata_json` and `situation_evidence.payload_json`.
  - Marks source cluster `PROMOTED`.
- **Local DB result:** `47` claims, `5` clusters, `47` cluster-claim links.
  - `PROMOTED`: `1`
  - `RESEARCH`: `4`
  - promoted scenario `#457`: `narrative-ai-power-grid-bottleneck`, `detection_path = mixed_anomaly_led`
  - watch tickers: `CEG`, `ETN`, `GEV`, `NEE`, `PWR`, `SO`, `VST`
- **Scheduler wiring added:** `narrative_claim_extraction`, `narrative_cluster_builder`, and `narrative_cluster_promotion` in `backend/src/services/marketIntelligenceScheduler.ts`.
- **Market Intelligence UI naming corrected:**
  - `Theme Performance` = forward-tracking quality/returns
  - `Macro Source Monitor` = macro scheduler/source health
  - `Social Arbitrage Engine` = listening concepts + emerging-topic operator controls
  - `Listening Concepts` = tracked concept registry
- **Active checklist:** `.planning/plans/ACTIVE/market-intelligence-checklist.md`
  - Phase 1.2 now has clustering, promotion bridge, deterministic transitions, lineage promotion, asymmetric conviction template, YouTube collector, Shorts normalization, and operator-seeded flag visibility checked off.
- **Asymmetric narrative conviction template added:** `backend/data/scenarios/conviction-templates/asymmetric_narrative.json`
  - Requires claim/cluster lineage, verification plan, source-breadth gap, no invented tickers, and primary-source humility.
  - Offline eval coverage added to `backend/tests/test_conviction_eval.py`.
- **YouTube collector added:** `backend/scripts/collect_youtube_transcripts.py`
  - Normalizes `watch`, `youtu.be`, raw video IDs, and `/shorts/{id}` into canonical watch URLs.
  - Fetches public caption tracks when available.
  - Supports `--transcript-file` for operator-copied transcripts when Shorts/captions are not exposed.
  - Registered as `youtube_transcript_collector`.
- **YouTube engine v1 expanded:** PRD D31 now defines staged YouTube discovery: channel/feed watcher -> transcript collector -> later comments -> later bounded search. Added `backend/scripts/collect_youtube_channel_feeds.py`, scheduler job `youtube_channel_feed_collector` (every 2h at `:11`), and `backend/data/preferences/youtube-channels.json`. The channel watcher uses free YouTube RSS, writes `youtube_video` metadata rows, and can pass URLs to the existing transcript collector with `--fetch-transcripts`. Empty channel/watchlist configs skip cleanly.
- **Operator-seeded flag visibility verified:** scenario `#456` has `OPERATOR_SEEDED`; Market Intelligence card/drawer renders validity flags. UI flag metadata now includes explicit tooltips/severity for `OPERATOR_SEEDED`, `VERIFY_PRIMARY_SOURCES`, `POLICY_RUMOR_RISK`, and `SINGLE_SOURCE_RISK`.
- **Narrative Radar API/UI added:** Market Intelligence now exposes narrative clusters before/after promotion via `GET /api/market-intelligence/narrative-clusters` and `GET /api/market-intelligence/narrative-clusters/:id`; frontend has a collapsed `Narrative Radar` section showing status, title/summary, claim count, source count/breadth, mapped tickers, flags, and updated date. Local smoke test returned 5 clusters and decoded first detail with 3 claims.
- **Narrative Radar Ledger reports added:** `GET /api/market-intelligence/narrative-clusters/:id/report` builds a Ledger-style narrative cross-check from mapped tickers using `/api/fundamentals/:symbol`, carrying `company_type` and `valuation_engine` into `candidate_fundamentals`. UI now has a `Report` action per narrative cluster. Smoke test on cluster `#5` returned `GOOGL`/`IBM` as `dcf_operating` and `IONQ` as `sales_scenario`.
- **Options Flow clean-universe optionability added:** `backend/scripts/collect_options_flow.py` now maintains `options_symbol_optionability` inside `options-flow.sqlite`. Clean universe remains master; `backend/data/universe/optionable.json` is seed-only. Current totals: `3272` clean optionable, `989` not-optionable, `52` unknown. Daily collector now defaults to `optionable-clean`; manual `/api/options-flow/run-collect` also uses `optionable-clean`; scheduler includes daily full clean-optionable collection plus weekly optionability refresh. Added `/api/options-flow/optionability` summary endpoint.
- **Options Flow smoke-row cleanup:** Removed the two `2026-05-06` test snapshots (`A`, `AA`) created during collector smoke testing because they made the anomaly UI show only one symbol. `getTopAnomalies()` now defaults to the latest date with at least 20 distinct symbols so partial smoke/failed runs do not hide the prior usable snapshot set.
- **Options Flow chain snapshot hydration added:** `collect_options_flow.py` now writes raw contract rows into `options_contract_snapshot` with expiration/strike/type/bid/ask/volume/OI/IV fields while also writing aggregate `options_daily_snapshot`. API optionability summary includes chain stats. Hydration smoke over 5 clean-optionable symbols wrote `1482` contract rows for `2026-05-06`. `getTopAnomalies()` threshold was raised to require at least 50 symbols on a date so partial chain hydration does not replace the prior anomaly page.
- **Options Flow settings surface added:** Settings > Market Intel now has an expanded Options Flow Scanner block showing manual collection status, scheduler job state, clean-universe optionability counts, and raw-chain coverage. Buttons were added for daily chain hydration, weekly optionability refresh, manual full optionable-universe hydration, and status refresh. Live server check showed the current backend process is still on the old scheduler registry, so a backend restart is needed before the new optionability endpoint/job appears there.
- **Social ARB Engine intake audit added:** Market Intelligence now has an `Intelligence Network Intake` panel inside the Social Arbitrage Engine console. Backend endpoint `GET /api/market-intelligence/social-arb/audit` reports 7-day non-macro raw hits, matched hits, tracked concept counts, emerging-topic funnel counts, Social ARB card counts, and source/community breakdown. UI renders the funnel so the gap between the Intelligence Network and promoted Social ARB cards is visible.
- **Social ARB promoted-topic ledger added:** `GET /api/market-intelligence/social-arb/promoted-topics` and the new `Promoted Topic Ledger` UI table explain where promoted topics went. Current DB finding: `34` promoted topics compress into only `3` situation cards (`29` -> self-hosted/off-cloud `#181`, `4` -> Nvidia/CUDA `#177`, `1` -> OpenAI model releases `#20`), all without cross-platform corroboration.
- **Social ARB repeat cleanup:** The promoted-topic ledger now groups repeated spike events by concept/card. UI wording changed from “Promoted topics” to “Promoted spike events,” and shows unique Social ARB cards + repeated pulses. Repeated spikes are preserved as `pulse_count` persistence evidence instead of duplicated rows.
- **Social ARB hunting criteria locked:** Social ARB target is now explicitly undercovered tradable companies, niche product adoption, unusual buyer/user enthusiasm, specialist forum chatter, YouTube narratives with ticker/product implications, real-use/demand/procurement/shortage/pricing/new-customer language, and niche -> retail -> ticker-indexed cross-platform migration. Promoted spike groups now expose hunting-fit diagnostics: score, source breadth, real-use hits, ticker/product specificity, watch-ticker exposure, and flags such as `SINGLE_SOURCE_DOMINATED`, `NO_REAL_USE_LANGUAGE`, `NO_COMPANY_OR_PRODUCT_SPECIFICITY`, `HUNTING_FIT_WEAK/WATCH/STRONG`.
- **Social ARB watchlist pruned:** 27 noisy/context concepts were marked `pruned` in `tracked_concepts` with audit metadata (`social_arb_role=context_pruned`, reason `generic_or_noisy_context_watchlist`). Active watchlist is now 19 core hunting concepts: `ai_compute_shortage`, financial tokenization, 24-hour trading, stablecoin rails, quantum, nuclear/SMR, AI power/grid, defense AI, drones/counter-drone, robotics, AI drug discovery, AI clinical trials, radiopharma, precision diagnostics, gene editing delivery, synthetic biology tools, critical minerals, water infrastructure, and consumer product breakout. DB backup created: `backend/data/market-intelligence.sqlite.pre-social-arb-prune-20260505-223505.bak`.
- **Social ARB promoted ledger now excludes pruned concepts by default:** `social-arb/audit` and `social-arb/promoted-topics` count/display only active core concepts. Historical pruned groups can still be retrieved with `include_pruned=true`. Current active promoted spike events/cards are `0/0`; all historical promoted spike events/cards remain `34/3`.
- **Social Intelligence -> Market Intelligence raw bridge added:** Created `backend/scripts/run_social_raw_bridge.py` and scheduler job `social_raw_bridge`. It imports matched StockTwits, Yahoo Finance community, and Reddit rows from `social-intelligence.sqlite` into `market-intelligence.sqlite.mi_raw_hits` using active Social ARB search terms and `watch_tickers`, then refreshes `concept_daily_counts`. First live run wrote `1,255` rows (`1,195` StockTwits, `52` Reddit, `8` Yahoo community) and refreshed `242` daily buckets. New 7d MI source totals now include `stocktwits_post`, `reddit_post`, and `yahoo_community_post` alongside HN/4chan/forums/YouTube.
- **Social ARB candidate-intel fallback added:** Promoted spike groups were empty because the new ticker-indexed communities had no mature baseline yet. `listSocialArbPromotedTopicLedger()` now returns `candidate_groups`, and the Market Intelligence UI renders those rows when no promoted groups exist. First backend smoke returned 16 candidates; top row was `quantum_computing_commercialization` with 207 7d mentions, 7 communities, 2 source types, and hunting fit 100.

### GitNexus / Tooling (2026-05-05)

- GitNexus CLI/index is healthy:
  - indexed repo: `pattern-detector`
  - `518` files, `8151` symbols, `23657` edges, `300` processes
  - `npx gitnexus status` reports up to date at commit `10fba5a`.
- Codex GitNexus MCP was enabled but not attached in the current session because config used failing `npx -y gitnexus@latest mcp`.
- Updated `C:\Users\eod99\.codex\config.toml` to match Cursor's working launcher:
  - command: `C:\Users\eod99\AppData\Roaming\npm\gitnexus.cmd`
  - args: `["mcp"]`
- New Codex session/restart should expose GitNexus MCP resources/tools. Current session can still use CLI `query`, `context`, `impact`, `cypher`; MCP-only `detect_changes` remains unavailable until restart.

### Recent Working State (2026-04-30) — Market Intelligence + Sector-Aware Reports

- **Options Flow Intelligence Reports** now produce hedge-fund-quality analysis by cross-referencing:
  - Full balance sheet, quarterly trends, earnings execution, forward expectations, DCF valuation
  - Risk flags with severity, tags with tone, status/risk notes
  - Social buzz aggregated from ALL sources (StockTwits, Yahoo, Reddit, HN, 4chan, Bluesky, Discord, Forums, news feeds)
  - SEC Form 4 insider trades
- **Critical bug fixed**: Report endpoint was looking for `fJson.data.snapshot` but API returns at `fJson.data` — fundamentals were always null.
- **Sector-specific valuation guidance** injected into LLM prompt based on `company_type` from symbol catalog:
  - REITs: Don't flag low current ratio or negative FCF as distress; use AFFO, dividend coverage
  - Financial companies: Price/Book, ROE, NIM — not standard DCF
  - Pre-profit growth: Revenue multiples, Rule of 40
- **ADC case study**: System correctly classified ADC as REIT but applied generic distress heuristics. Ledger (Financial Analyst workspace) correctly pushed back. The sector guidance now prevents this class of false positive.
- **Architecture discovery**: Ledger's full agent definition lives at `workspace/Financial Analyst Workspace/` (hidden from IDE by `.gitignore` line 96: `workspace/`). Contains `SOUL.md`, `IDENTITY.md`, skills (`dcf-valuation`, `buried-risk-review`), and reference PDFs (Morningstar, CFA).
- **Social buzz aggregation**: `getMiRawHitsForSymbol()` in `fundamentals.ts` now queries `market-intelligence.sqlite` for HN/4chan/Bluesky/Discord/Forums/news hits mentioning the symbol, merging them into the buzz endpoint.
- **Enable All Jobs button**: Added to settings page to bulk-enable all MI scheduler jobs at once.
- Files modified: `backend/src/routes/optionsFlow.ts`, `backend/src/routes/fundamentals.ts`, `frontend/public/market-intelligence.js`, `frontend/public/settings.html`, `frontend/public/settings.js`

### Recent Working State (2026-04-16) — Hygiene + Scope Pass

- Closed the data-leakage half of the standing repo-state recovery plan.
- Three open decisions for the user, captured in `.planning/plans/ACTIVE/repo-hygiene-followups-2026-04-16.md`.

### Recent Working State (2026-03-30)
- Workstream shifted to the **data foundation required for Ledger** rather than frontend UX.
- Source-of-truth split now clarified:
  - **Universe registry** = canonical symbol set definitions
  - **Scanner** = current-market observation layer
  - **PIT** = authoritative historical fundamentals layer
  - **Validator/backtester** = PIT consumer, not PIT owner
  - **Ledger** = consumer of PIT facts plus raw evidence
- Stock universe cleanup continued and remaining runtime consumers were moved toward shared registry loaders.
- PIT hydration was redirected toward full-universe semantics (`clean_stocks` default, explicit `--universe`, correct symbol precedence).
- PIT schema now retains **historical raw payload lineage** through append-only `raw_source_cache_history`.
- An isolated SEC filing ingestion experiment now exists under `Financial data/docling_probe`:
  - fetch filing from SEC
  - convert with Docling
  - extract first-pass canonical financial facts
  - keep all of it outside the main runtime path for now
- Apple `10-K` probe succeeded end to end and extracted a usable first-pass fact payload.
- Apple Ledger MVP smoke test then succeeded for:
  - `5` recent `10-K`s
  - `8` recent `10-Q`s
- A real local Ledger/PIT database path now exists:
  - canonical schema doc: `docs/ledger-canonical-fact-schema.md`
  - SQLite file: `backend/data/fundamentals-pit.sqlite`
  - filing metadata table: `pit_documents`
  - filing-derived fact table: `pit_statement_facts`
  - query helpers in `backend/services/fundamentals_pit_query.py`
- Apple filing-derived smoke-test data has been imported into PIT:
  - `13` documents
  - `264` filing-derived fact rows
- Second issuer validation then progressed on Microsoft:
  - initial smoke test exposed extractor portability gaps
  - extractor was hardened for year-only headers and Microsoft-style labels
  - a later continuation pass confirmed the remaining miss was a transient SEC fetch disconnect, not an extractor failure
  - `fetch_sec_filing.py` now retries SEC requests and reuses cached downloads
  - current result: `5/5` recent `10-K`s and `8/8` recent `10-Q`s successfully processed
  - Microsoft import size: `13` documents and `264` filing-derived fact rows
- New active planning anchor for this work:
  - `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- Additional related docs for the next AI:
  - `.planning/plans/ACTIVE/family-structure-validation-ledger.md`
  - `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
  - `docs/ledger-canonical-fact-schema.md`
  - `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md`
  - `.planning/plans/ACTIVE/primitive-normalization-engine-and-autonomous-research.md`
- Isolated experiment location for continuation:
  - `Financial data/docling_probe`
- Next AI should recover this thread by reading:
  - `memory-bank/LATEST.md`
  - `memory-bank/CHAT_MEMORY.md`
  - `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
  - then the related docs above as needed

### Current Open Threads (2026-03-30)
- Expand the isolated Docling extractor beyond the first minimum set of headline metrics.
- Harden evidence references beyond markdown-line snippets.
- Harden scale/unit normalization and fiscal-period handling across issuers/layouts.
- Validate `available_at` semantics more deeply across more filings/forms.
- Validate a third issuer now that Apple + Microsoft both run end to end.

### Recent Working State (2026-03-25)
- **Trading Desk discretionary workflow** was the primary workstream this session.
- Three major features shipped and debugged to working state:
  1. **Programmatic Stop/TP Config** — ATR or % stop/TP calculated from entry, drawn on chart, persists across reloads
  2. **Trade P&L Summary Panel** — live Max Loss / Max Gain / R:R / exact stop+target prices, instrument-aware (stock, options, futures, crypto, forex)
  3. **Watch List Right Drawer** — collapsible 280px drawer with badge count, chart resize on open/close, click-to-load symbol
- **Three bugs fixed this session** (see LATEST.md for full detail):
  - `runCopilotAnalysis` not exposed to `window` → drawer click-to-load silently did nothing
  - `onclick` attribute HTML breakage from `JSON.stringify` inside double-quoted attribute
  - Chart resize: `margin-right` on flex item doesn't reduce content width; switched to `padding-right` + `requestAnimationFrame`
- Server is on port **3002** (not 3000)

### Recent Working State (2026-03-18)
- **Structural motif family research system** is the current primary workstream.
- Full pipeline built: `bars → ATR pivots → legs → labels → 5-pivot motifs → outcomes → families → inspection → cross-symbol comparison → stability`
- Two family signature layers: v1 (exact, traceable, too fragmented) and v2 (generalized, 17 families, 8 candidates on SPY)
- Multi-symbol research completed: SPY, QQQ, IWM, DIA (daily, 10y)
- Family Explorer UI live: static HTML with LightweightCharts, per-family detail, chart inspector modal
- Strategy validation policy documented (`docs/strategy-validation-policy.md`): Tier 1 → Tier 2 → Tier 3 → Post-cert optimization, with tombstone/review/pass categories
- Roadmap locked: Family ranking controls → Baseline comparison → Visual inspection → Signal layer → Execution simulation → Strategy layer → Portfolio layer
- **Stockdex integration**: `fundamentalsService.py` enriched with Finviz and Yahoo Web data (insider trades, earnings history, growth estimates, institutional holders)
- Execution bridge config persisted and auto-resumes after backend restarts
- Scanner copilot with fundamentals-aware AI context live

### Current Open Threads (2026-03-25)
- **Trading Desk**: core discretionary workflow is now solid (risk config, P&L panel, watch list drawer). No known outstanding bugs.
- **Family research next step**: manual inspection of top v2 families to decide if buckets are coherent before scaling
- **Family ranking controls**: first UI feature to build (sort/filter by t-score, count, dispersion, agreement)
- **Baseline/null-model comparison**: needed to validate families are better than random
- Macrotrends data (10+ year historical financials) requires headless Chrome/Selenium setup — blocked on driver availability
- Execution behavior should still be watched on the next scheduled or forced scan

### Current State (2026-03-18)
- Project is in refinement + research mode.
- Research layer (structural motif families) is the active focus.
- `.planning/plans/` organized into `ACTIVE`, `BACKLOG`, `REFERENCE`, and `ARCHIVE`.
- Current active planning files:
  - `.planning/plans/ACTIVE/family-discovery-v2-prd-pdr.md` — structural motif family research (primary)
  - `.planning/plans/ACTIVE/Update.md` — phased roadmap
  - `.planning/plans/ACTIVE/single-user-production-readiness-checklist.md`
  - `.planning/plans/ACTIVE/backtesting-master.md`
  - `.planning/plans/ACTIVE/research-to-live-trading.md`
- Scanner candidates distinguish context vs pattern vs signal semantics.
- Tactical fundamentals snapshot (yfinance + Stockdex) and scanner copilot integration are live.

### What It Does
- Scans instruments (stocks, futures, crypto) for trading setups
- Detects swing points (MAJOR mode with RDP fallback — replaced old RELATIVE mode)
- Calculates Fibonacci retracements (anchored to structural swing low/high)
- Measures "Energy State" (physics-based: velocity, acceleration, candle range)
- Calculates "Selling Pressure Index" (0-100 composite score)
- Trading Co-Pilot: 4-layer verdict engine (Account → Instrument → Risk → Setup Quality)
- 5 instrument types: Stock/ETF, Futures, Options, Forex, Crypto
- AI chat with full analysis context + grep-based app knowledge retrieval
- Position sizing per instrument (shares, contracts, options contracts, lots, fractional crypto)
- **Auto P&L Calculator**: contract specs lookup, live unrealized P&L, direction toggle, instrument-aware closeout
- **Editable trade levels**: Entry/Stop/TP as number inputs with tick-aware stepping, scroll wheel, chart drag sync
- **Options premium tracking**: Auto-fetches live option premiums from yfinance options chain, inline editable entry/current premium, premium-based P&L

### Tech Stack
- Frontend: Vanilla HTML/JS, modular (8 JS files + orchestrator), no bundler
- Backend: Node.js/Express with TypeScript
- Scanner/Plugins: Python (`strategyRunner.py` — all plugins route here now)
- Data Utilities: Python — decomposed from monolithic `patternScanner.py` into 6 modules:
  - `ohlcv.py` — OHLCV data structures, Yahoo Finance fetching, caching
  - `rdp.py` — RDP algorithm, swing detection, RDP cache
  - `swing_structure.py` — Swing structure analysis, trend classification, regime detection
  - `energy.py` — Energy state, selling/buying pressure calculations
  - `fib_analysis.py` — Fibonacci retracement + energy entry signals
  - `copilot.py` — Trading co-pilot analysis, Wyckoff patterns, CLI
  - `patternScanner.py` — Now a backward-compatible **shim** that re-exports from above modules
- Quote Service: Python (`quoteService.py`) — stock prices + option chain lookups
- Compiled Indicators: `numba_indicators.py` — JIT-compiled SMA/EMA/RSI/MACD/ATR/Bollinger/etc. via `@njit(cache=True)`
- Storage: Backend filesystem (data/ folder)
- Charts: LightweightCharts v5.1.0 (`chart.addSeries(type, opts, paneIndex)` API, multi-pane support)
- AI: OpenAI API (GPT-4o default, configurable per-task), with local fallback (mini-cpm-v-olama for vision)

### Key Decisions
- Model-first thinking: constraints before patterns
- Vibe code prototype first, then GSD rebuild with proper spec
- Navigation-based memory (don't load everything into context)
- Futures position sizing: margin + risk budget, whole contracts only
- Backend storage over localStorage for all persistent data
- Self-hosted server planned (B-Link mini PC)

### Key Concepts
- "If this signal is correct, who is forced to act—and why?"
- Selling pressure measures shadows (price symptoms), not forces (who is liquidating) - needs evolution
- Fibonacci levels are pattern-first, not model-first
- Energy states and selling pressure are closer to model-first
- **Energy Momentum is NOT an oscillator** — it's a trend strength accelerometer. Don't read peaks/valleys as overbought/oversold. Read the **histogram bar magnitude pattern**: "big, big, big, small" = energy exhaustion = likely reversal/pullback. Zero-line crossings signal momentum shift.
- **Three-indicator reversal strategy**: Regression Channel (statistical deviation) + Energy State (trend strength) + Energy Momentum (deceleration) — when all three align, high-confidence reversal signal

### Key Decisions (cont.)
- RDP algorithm chosen for swing detection — matches how humans visually identify price curve shape
- Swing Sensitivity slider (1-15) maps exponentially to RDP epsilon — higher = more swings, lower = fewer
- fastrdp package used for RDP implementation
- CONTRACT_SPECS lookup for auto-populating futures/forex/crypto settings from symbol
- P&L formulas: futures uses pointValue × contracts, options uses contractMultiplier, forex uses lotUnits
- Trade direction (long/short) explicitly stored with each trade, default = long
- Live P&L updates via chart crosshair movement, not polling
- **Direction toggle must be always visible** (not buried in hidden sections) — user sets direction BEFORE analysis
- **Direction change auto-reruns analysis** — no need to click Analyze again
- **Trade level inputs are editable number fields**, not static text — supports typing, scroll wheel (tick-aware), and chart drag (all three stay in sync)
- **Manual position size input in Instrument sidebar section** — spinner with dynamic unit labels, risk warnings

### Options P&L Decisions (2026-02-12)
- **Options P&L uses premium only** — `(currentPremium - entryPremium) × multiplier × contracts`. Never use intrinsic value from stock price (ignores time value).
- **`optionPrice` is the sole source for entry premium** — never fall back to `plannedEntry` (that's the underlying stock chart entry, not the premium).
- **Options premiums auto-fetch** from yfinance options chain using strike, expiry, and type stored on the trade.
- **Inline premium editing** on trade cards — both entry and current premium editable right on the card.
- **User's ATOM trade**: 10 call contracts, avg cost $1.53/sh, breakeven $4.05, expiry 7/17. Confirmed against Robinhood.
- **Co-Pilot save has Market vs Limit order type** — Market saves as "open", Limit shows price input and saves as "planned".

### Trade Lifecycle
1. **Co-Pilot** → Analyze symbol → Set levels → Save as Market (Open) or Limit (Planned)
2. **Trading Desk — Planned** → Execute (moves to Open) or Delete
3. **Trading Desk — Open** → Live P&L (stock via quotes, options via chain), Close, Edit, Delete
4. **Trading Desk — Closed** → Final P&L recorded, Reopen (undo), Edit, Delete

### Recent Session (2026-02-12)
- Options P&L overhauled: premium-based, not stock-price-based
- Auto-fetch option premiums via `POST /api/quotes/options` → `quoteService.py --options`
- Inline entry + current premium inputs on open options trade cards
- Closeout modal shows "enter premium you sold at" for options
- Edit modal has option premium field
- Trade cards show "Premium: $X.XX/sh" + "Cost" for options

### Validator System (2026-02-12)
- **Validator = Backtester (core) + Robustness tests + PASS/FAIL gate**
- **StrategySpec** defines complete strategy: scan_mode, params, entry/exit rules, costs, universe, timeframes
- **ValidationReport** contains: trade summary, risk summary, robustness (OOS, walk-forward, Monte Carlo, param sensitivity), pass/fail verdict, decision log
- **TradeInstance** records individual backtest trades with full audit trail
- Scaffolded: types, storage, API endpoints (stubbed), frontend page, navigation
- See `.planning/plans/validator-system.md` for full design
- Next: Strategy editor UI → Python backtest engine → Robustness tests → Production gate
- **Key decision**: No strategy enters production scanning without PASS + APPROVED report

### Scanner Architecture (2026-02-14)
- Scanner is **indicator-driven** (not strategy-driven)
- Scanner only needs: Indicator, Asset Class, Period, Interval
- No "Universe" or "Tiers" (those are for Validator)
- All scans route through `strategyRunner.py` plugins — no legacy CLI spawning
- Frontend sends `pluginId`, backend auto-generates spec from pattern JSON definition

### Frontend Modular Architecture (2026-02-15)
- `index.js` split into 8 modules: `chart.js`, `drawing.js`, `correction.js`, `ai-chat.js`, `training.js`, `discount.js`, `scanner.js`, `index.js` (orchestrator)
- No bundler — plain `<script>` tags loaded in dependency order
- All cross-module references via global scope (verified safe)

### Plugin System (2026-02-14, updated 2026-02-20)
- Pattern Registry: `backend/data/patterns/registry.json` — **30 plugins** across 5 categories
- Plugin definitions: `backend/data/patterns/*.json` (default params, tunable params, examples)
- Plugins implemented: `ma_crossover`, `swing_structure`, `fib_energy`, `regime_filter`, `discount_zone`, `wyckoff_accumulation`, `discount_wyckoff_pipeline`, `energy_state`, `rdp_energy_swing_detector_v1`, `rdp_swing_analysis_v1`, `regression_channel`, `order_blocks`, `rdp_wiggle_base`, `ob_regime_long_entry_composite`, plus 5 experimental base detectors and others
- Overlay contract: plugins emit `overlays[]` array → frontend renders as chart line series or price lines
- Research Agent dynamically reads registry at session start — all Indicator Studio plugins available for AI composition

### System Pipeline (2026-02-14)
- **Indicator Studio** — R&D, pattern refinement, visual charts, ML (was Plugin Workshop)
- **Validator** — Strategy backtesting by market regime, PASS/FAIL gate
- **Scanner** — Production signal finding (indicator-driven)
- **Trading Desk** — Strategy-enforced execution (Co-Pilot)
- **Post-Trade Review** — Feedback loop

### Data Caching (2026-02-15)
- Yahoo Finance data cached persistently to disk (never expires)
- Incremental updates: fetch only new bars since last cached data
- Graceful fallback to stale data on download failure
- File: `backend/services/ohlcv.py` (moved from `patternScanner.py` during decomposition)

### Performance (2026-02-15 — Resolved)
- **Before**: 1 Python process spawn per symbol, sequential — 9 instruments took ~62s
- **After**: Persistent FastAPI service + parallel compute (ProcessPoolExecutor) + parallel data fetch (ThreadPoolExecutor) — 9 instruments in ~10-13s (**5-6x speedup**)
- Batch scan now flows: Frontend → one `POST /scan-batch` → Node → one `POST /scanner/scan-universe` → Python service (parallel fetch + parallel compute)
- Node client timeout dynamically scaled (15s/symbol, min 60s, max 10 min) — fixed silent timeout that was causing fallback to sequential path
- `npm run dev` now launches both Python service + Node backend via `concurrently`
- Plan: `.planning/plans/ACTIVE/python-execution-layer.md`

### Chart Indicators Architecture (2026-02-18, updated 2026-02-22)
- **Primitives = Chart Indicators** (visualize data), **Composites = Scans** (find setups)
- `chart-indicators.js` is the central file: defines, registers, computes, and renders all frontend chart indicators
- Hardcoded JS indicators: SMA, EMA, VWAP, RSI, MACD, Bollinger, Energy State, Energy Momentum, Swing Structure, RDP Swing Points
- Backend-computed indicators: Regime Filter (Trend), MACD Histogram, Regression Channel, Composite Fib, Order Blocks, FVG
- Dynamic indicators: backend plugins with `chart_indicator: true` auto-appear in dropdown
- **Portable context system**: `ciBindToChart()` attaches to any LightweightCharts instance (scanner, validator, trade browser)
- Sub-panel indicators (`panel: 'sub'`) get their own pane via `paneIndex` — each with configurable `paneHeight`
- **Settings dialog** (2026-02-22): indicators with `params` array get TradingView-style settings modal on badge click
- **Backend param pipeline** (2026-02-22): `pluginParams` sent with scan requests, merged into `setup_config` on backend
- **Histogram series support** (2026-02-22): generic backend renderer handles `seriesType: 'histogram'` → `HistogramSeries`
- `quickLoadSymbol()` loads plain OHLCV chart without scanning
- **OneDrive sync warning**: `chart-indicators.js` was deleted by OneDrive once — keep backups / use git

### Energy Momentum Details
- Computed from Energy State: smooth(5-bar) → ROC(3-bar) → produces line + histogram
- Histogram color: green when positive (upward energy), red when negative (downward energy)
- **Reading it**: magnitude of bars matters more than direction. Shrinking bars = fading force. Zero-line cross = momentum shift.
- Not ADX (ADX measures strength, Energy Momentum measures rate of change of strength)
- `computeEnergyMomentum(chartData, lookback)` in `chart-indicators.js`

### Regression Channel Details
- Python plugin: `regression_channel_primitive.py`
- Anchored at significant low, calculates linear regression + SD bands
- Dynamic band display: shows only the 2 SD bands bracketing current price position
- Supports up to 6 SD levels

### Validator / Backtest Architecture (2026-02-19, updated 2026-02-20)
- `backtestEngine.py` sliding window: `window_step=1` (every bar). Composite strategies that return `entry_ready=True` but no `second_breakout` anchor now use bar `i` as the signal (prevents silent zero-trade results).
- `strategyRunner.py`: when `plugin_fn` not found but spec has `composite_spec`, falls back to generic `run_composite_plugin`. Enables Research Agent-generated strategies to run without a dedicated `.py` file.
- `validatorPipeline.py`: 3 parallel workers via `ProcessPoolExecutor` (configurable `BACKTEST_WORKERS` env var, was 6), streaming NDJSON progress to frontend
- **Cancellation**: `_kill_executor_workers()` directly terminates worker processes via `os.kill(pid, 9)` — `future.cancel()` alone can't kill running `ProcessPoolExecutor` workers
- **Typical Tier 1 timing**: 50 symbols, weekly, ~20 minutes with parallel workers

### Research Agent Architecture (2026-02-19, updated 2026-02-20)
- **Session config**: `allow_new_primitives: boolean` — when true, AI is instructed to invent new primitives; when false, only uses existing catalogue
- **Primitive catalogue**: dynamic, reads from `registry.json` at session start — all Indicator Studio primitives are automatically available
- **fetchReport URL**: `/api/validator/report/:id` (singular — was wrong plural before)
- **Composite fallback**: generated strategies with `composite_spec` in `setup_config` route through `run_composite_plugin` even if no `.py` plugin file exists
- **Fitness score**: `computeFitnessScore()` returns 0 if `total_trades < 200`; otherwise weighted: expectancy (40%), win rate (20%), Sharpe (20%), OOS robustness (20%)
- **Reflection step** (2026-02-20): After each gen's backtest, AI performs forensic analysis of trade-level data (per-symbol breakdown, exit reasons, sample losers/winners). Stored on `GenomeEntry.reflection`, fed into next gen's hypothesis prompt. Non-blocking — if reflection fails, loop continues.
- **Cancel fix** (2026-02-20): `stopSession()` now calls validator cancel API → kills ProcessPoolExecutor workers via `os.kill(pid, 9)`. Three layers: research agent → validator → Python pipeline worker processes.
- **Worker count**: Reduced from 6 to 3 (`BACKTEST_WORKERS` env var). Still 3x faster than serial on 32-core machine.

### AI Analyst Rules (Statistical Interpreter)
- CRITICAL RULE: when explaining failure, ONLY cite metrics with status=fail in Pass/Fail Reasons
- Distinguish "Hard Fails" (why it failed) from "Areas for Improvement" (passed but suboptimal)
- Do NOT cite passing metrics as failure causes

### Order Blocks Definition (2026-02-19)
- **Bullish OB**: Last DOWN candle before first UP candle at a swing LOW turning point. Found by scanning BACKWARD from the swing low in the preceding bearish leg. That candle's high/low = the OB zone.
- **Bearish OB**: Last UP candle before first DOWN candle at a swing HIGH. Same logic reversed.
- Entry signal: when price RETURNS to that zone (pullback). `entry_ready=True` when `bar.low <= last_close <= bar.high` of any OB zone.
- Pullback strategy — identify AFTER the fact, wait for price to come back.

### Regime Filter Definition (2026-02-19, updated 2026-02-22)
- Uses RDP swing structure (Dow Theory), NOT rolling regression. No lag.
- **Majority vote classifier** (2026-02-22): counts ALL consecutive falling/rising transitions, requires 60% majority (`majority_pct`, configurable) to classify. Not just last-2-swings.
- HH + HL = uptrend (expansion). LH + LL = downtrend (distribution). Mixed = transition.
- `reference_symbol` = benchmark to check (SPY for stocks, BTC-USD for crypto). Default empty = uses chart symbol's own structure. Fetches full max-history.
- Lookahead prevention: `precompute_regime_timeline()` uses `confirmed_by_index` per swing — regime at bar i only uses swings confirmed before bar i.
- Key rule: if testing 2002 bar, 2003+ swings are invisible.
- **Available as chart indicator** — shows HH/HL/LH/LL markers + zigzag line + regime banner on any chart

### Composite Architecture Decision (2026-02-19, reinforced 2026-02-22)
- Primitives stay single-responsibility. Regime awareness does NOT go inside order_blocks plugin.
- Regime filtering = a separate primitive stage in a composite, combined via AND reducer.
- `ob_regime_long_entry_composite`: regime_filter(SPY, expansion) AND order_blocks → long entry
- This pattern generalises: any primitive + regime_filter = regime-aware version of that primitive.
- **2026-02-22**: Trend filter was temporarily embedded inside MACD divergence primitive — removed and divorced back to standalone regime_filter. Lesson reinforced: filters are ALWAYS separate primitives.

### The Base-as-Anchor Concept (2026-02-22)
- **Core problem**: MACD divergence fires in ALL market contexts — uptrends, downtrends, bases. Counter-trend signals (bullish divergence in a downtrend) lose money.
- **User insight**: "The only way we can know where we are is to know where the base is. If you're above the base you're long, if you're below the base you're short."
- **How it works**: A bullish divergence in an uptrend = end of pullback = go long (good). A bullish divergence in a downtrend = counter-trend = skip (bad). The base (consolidation zone) is the dividing line between uptrend territory and downtrend territory.
- **Implementation path**: The self-referencing regime filter (using the instrument's own swing structure, not SPY) should provide this context. If it correctly identifies expansion (above base) vs distribution (below base), it can gate the MACD divergence. Needs visual verification before composing.
- **Key distinction from SPY regime**: The 0.4R strategy uses SPY's trend. But SPY being in an uptrend doesn't mean an individual stock is above its base. Need SELF-referencing structure for per-instrument context.

### MACD Histogram Primitive (2026-02-22)
- Standalone primitive for MACD histogram signals (zero-line crossover + momentum shift)
- Separate from MACD divergence primitive — composable independently
- Emits color-coded histogram bars + MACD/Signal lines in sub-pane
- Signal types: `zero_cross`, `momentum_shift`, `both`
- Files: `macd_histogram_primitive.py`, `macd_histogram.json`, registered in `registry.json`

### Indicator Settings Dialog (2026-02-22)
- TradingView-style settings modal for chart indicators with configurable params
- Click badge label → dialog with number inputs, dropdowns, checkboxes
- Apply → removes old series, re-renders with new params
- Backend indicators pass `pluginParams` through scan endpoint → merged into `setup_config`
- RDP Swing Points epsilon now adjustable from chart UI (lower = finer structure)

### Parameter Sweep (PLANNED — not yet built)
- Vary a single parameter (e.g. RSI `oversold_level`: [20, 25, 30, 35, 40]) across N parallel backtests
- Pure JSON manipulation + parallel job dispatch — no Python changes needed per variant
- Results aggregated into comparison table: trades, expectancy, win rate, drawdown per value
- Winner promoted to next validation tier
- Key overfitting concern: optimize on in-sample, validate on out-of-sample

### patternScanner.py Decomposition (2026-02-20)
- Monolithic ~4,000-line file broken into 6 focused modules
- `patternScanner.py` is now a compatibility shim (re-exports all public symbols)
- 24 plugin files + 6 consumer files had their imports migrated from `from patternScanner import X` to `from <module> import X`
- Absolute imports used throughout (not relative) — `services/` is not a Python package
- Verbose output suppressed during backtests via `_BACKTEST_MODE` flag in `rdp.py` and `swing_structure.py`
- `analyze_breaks.py` has pre-existing broken import (`choch_primitive` never existed) — dead code, safe to ignore

### Base Detection R&D (2026-02-19 to 2026-02-20)
- **Problem**: Programmatically detecting Wyckoff-style "bases" (coiled volatility compression) is extremely difficult. Different for every chart and instrument.
- **User insight**: "RDP marks the bottom of bases. Anything ~25% above the RDP low is the base ceiling."
- **7 approaches tried**: ATR+StdDev, BT/BF box retest, multi-scale RDP, 75%-below-high, regression channel angle, heartbeat detection, dual-epsilon wiggle
- **Winner**: `rdp_wiggle_base` — two-pass RDP with WIGGLE_SCORE (multiplicative: ALT * AMP * TURN)
- **5 experimental base primitives** remain in registry for reference: `base_breakout`, `base_box_retest`, `rdp_base_75`, `rdp_regression_flat_base`, `heartbeat_base`
- **RDP decision time**: On weekly charts, RDP takes ~2-8 weeks to confirm a low. Bases typically last long enough that RDP decides while price is still in the base.
- **Best swing detector**: `rdp_energy_swing_detector_v1_primitive` — user-confirmed most accurate. Should be the default.

### Composite Architect Prompt Architecture (2026-02-21)
- `buildCompositeArchitectPrompt()` in `visionService.ts` is the single source of truth for AI composite generation behavior
- Staged primitives surfaced prominently at prompt top (`## CRITICAL: Current Staged Primitives`)
- Exact JSON template enforced with `CRITICAL format rules` — prevents AI from outputting malformed JSON
- Naming convention: by strategy intent, not by primitive list. Bad: "MA Crossover Regime Filter Composite". Good: "Trend Following with Regime Gate"
- Frontend (`workshop-composite.js`) strips JSON from chat display — definition panel is the only JSON destination

### Numpy Serialization Rule (2026-02-21)
- **ALL numpy scalars MUST be cast to native Python types before entering any dict that will be JSON serialized**
- `bool(numpy_bool)`, `float(numpy_float64)`, `int(numpy_int64)` — always explicit
- This is systemic in any plugin doing numpy array comparisons or arithmetic
- Audit done: 3 plugins fixed, 3 already safe, all others don't use numpy

### Structure Extraction Conditional Logic (2026-02-21)
- `_lookup_indicator_role()` in `strategyRunner.py` reads `indicator_role` from pattern JSON via registry
- `needs_structure` set to `False` for roles: `timing_trigger`, `momentum`, `oscillator`, `filter`
- `precompute_rdp_for_backtest()` in `backtestEngine.py` also skips for these roles
- Prevents expensive RDP/swing/base computation for simple indicator-based strategies

### Platform SDK Architecture Decision (2026-02-21)
- **Three tiers**: Platform SDK (core team) → Packages (advanced devs) → Studio Primitives (end users via AI)
- Platform SDK = `rdp.py`, `swing_structure.py`, `ohlcv.py`, `numba_indicators.py` — always available, version-pinned
- Studio Primitives must be AI-generatable: pure math on OHLCV arrays, calling SDK functions
- Composites = pure JSON wiring (stages + reducer), no code
- Visual diagnostics over code debugging: stage-level pass/fail with values, not stack traces
- Influenced by: TradingView Pine Script SDK model, NinjaTrader zip import/export, QuantConnect LEAN built-in indicators
- **Future refactor**: move SDK modules under `backend/services/platform/` with `manifest.json` for AI discoverability
- **Future cleanup**: remove centralized RDP precompute from `strategyRunner.py` — plugins should be self-contained

### Validated Strategy: MACD Divergence Pullback (ELITE)
- **Composition**: MACD divergence primitive (RDP-based, `divergence_source: macd_line`) + regime expansion filter (SPY)
- **Optimal params**: 2 ATR stop, 7R take profit, max 3 concurrent positions
- **Tier 2 results**: 0.40R expectancy, 29.9% max DD, 1.73 PF, 3.02 Sharpe, 227 trades
- **Quality tier**: ELITE (0.35R+ = elite, 0.20-0.35 = solid, 0.10-0.20 = marginal, <0.10 = junk)
- **IMPORTANT**: Default `divergence_source` is `macd_line` — do NOT change to `histogram` without re-validating
- **Future enhancement**: Structural exits (prior RDP swing high as take profit instead of fixed R-multiple)
- **Future enhancement**: Compose with structural trend filter (regime_filter on self, not SPY) for trend-aligned entries

### Parameter Sweep System (BUILT — 2026-02-22)
- Presets: stop_type, atr_multiplier, stop_pct, take_profit_r, max_hold_bars, rsi_oversold, rdp_epsilon, max_concurrent
- Tier selector (Tier 1 fast vs Tier 2 full universe)
- Cancel-and-promote (picks winner from completed variants on cancel)
- Tier gate bypass for sweep variants (`skip_tier_gate: true`)
- Copy Results button, Recent Sweeps list

### Max Concurrent Positions (BUILT — 2026-02-22)
- Portfolio-level post-processing filter in `validatorPipeline.py`
- Applied AFTER all trades generated, BEFORE metrics calculated
- Controls: `risk_config.max_concurrent_positions` in strategy spec
- Sweepable via "Max Positions" preset

### Autonomous Pipeline Vision (2026-02-22)
1. Research Agent generates strategy → gates it (positive expectancy or tombstone)
2. Parameter Sweep optimizes it → sequential params with adaptive early termination
3. Validator confirms it → Tier 1, Tier 2, Tier 3
4. Execution Bridge trades it → autonomous, no human (Alpaca API)
5. Data warehouse logs everything → meta-knowledge feeds back into step 1
- **Two accounts**: Discretionary (20%, manual) + Systematic (80%, autonomous)
- **Fine-tuning opportunity**: accumulated strategy/sweep/validation data = training dataset for domain-specific model

### ML/AI Pipeline Workflow (Locked In — 2026-02-25)
**The Loop:**
1. Hand label → 300+ charts (labels + corrections)
2. Train ML → `cd ml && python run_feedback_pipeline.py` → check `pipeline_report.json`
3. Auto-label → run with high thresholds (Auto Labeler page), review outputs
4. Human review/correct → fix AI mistakes
5. Retrain → every 50-100 new reviewed items
6. Repeat

**CRITICAL RULE**: Human labels FIRST, train FIRST, THEN auto-label. Never let AI labels into training data before first human-trained model.

**Labeling policy:**
- YES = clean base. YES + correct = base exists but cap is wrong (fix it). CLOSE = marginal. NO = genuinely nothing.
- Corrections > labels in training value. Ugly bases should be corrected, not rejected.
- The hard/ambiguous cases are the most valuable training data.

### Distilled Base Analyst (Long-Term Vision — 2026-02-25)
- **Plan**: `.planning/plans/distilled-base-analyst.md`
- **Goal**: Domain-specific 3-8B model that REASONS about bases (not just classifies)
- **Method**: Distillation — GPT-4o generates reasoning for each labeled chart, small model (Qwen2.5-7B) learns to reproduce that reasoning via LoRA fine-tune
- **Deployment**: Export to GGUF → Ollama → runs locally, $0 per inference
- **Training**: Cloud GPU (RunPod/Colab), ~$10-15 total
- **Prerequisites**: 300+ labels complete, ML classifier working
- **Phase 0 (no AI)**: Cluster wiggle base floors/caps into unified base box + CHoCH detection. Ships independently.

### Wiggle Base Structural Insight (2026-02-25)
- The RDP wiggle base primitive **accidentally marks Wyckoff accumulation zones**
- Multiple floor/cap events from successive wiggle passes trace the same consolidation range
- Clustering nearby floors → floor band, nearby caps → ceiling band → unified base box
- **Change of Character (CHoCH)**: when price breaks above the ceiling band, regime has changed
- Verified on: ACIC (V-bottom CHoCH), ABSI (multi-event base boxing), ACMR (textbook Wyckoff cycle)
- Phase 0 of distilled-base-analyst plan encodes this as explicit logic

### Structural Motif Family Research System (2026-03-15)
- **Goal**: Discover recurring structural price motifs, group them into statistically testable families, validate across symbols
- **Pipeline**: `bars → normalize_bars (ATR-14) → extract_atr_reversal_pivots → build_leg_records → label_pivots_against_same_side_history → build_five_pivot_motifs → evaluate_motif_outcomes → aggregate_family_stats → inspection/comparison/stability`
- **Implementation**: `backend/services/research_v1/` — 12 Python modules
- **Key data structures** (`schema.py`): `BarRecord`, `PivotRecord`, `LegRecord`, `PivotLabelRecord`, `MotifInstanceRecord`, `OutcomeRecord`, `FamilyStatsRecord`
- **ATR reversal pivots**: causal state machine for alternating HIGH/LOW pivots using `reversal_multiple × ATR` and `min_bars_between_pivots`
- **5-pivot motifs**: rolling 5-pivot window with deterministic family signature and feature vector
- **Outcomes**: forward 5/10 bar returns in ATR, MFE/MAE, hit ±1ATR first, next break up/down
- **Chronological splits**: discovery (60%) / validation (20%) / holdout (20%) — NEVER shuffled
- **v1 exact signature**: `pivot_type_seq | pivot_label_seq | leg_direction_seq | retrace_bins` — too fragmented (128 families from 155 motifs on SPY)
- **v2 generalized signature**: `orientation (HTL/LTH) | structural_class (CONTINUATION_UP/DOWN, REVERSAL_UP/DOWN, MIXED_TRANSITION) | break_profile (BOTH_BREAKS, HH_ONLY, LL_ONLY, NO_EXTREME_BREAK) | retrace_profile (DEEP_DOM, DEEP_PRESENT, MID_RETRACE, SHALLOW_ONLY)` — 17 families, 9 in all splits, 8 candidates
- **Both signatures kept simultaneously** — v1 for traceability, v2 for aggregation
- **Cross-symbol comparison**: `build_cross_symbol_family_comparison` — family overlap, per-symbol stats, rankings (all_four, same_sign, low_dispersion, min_count_three)
- **Behavior stability**: `build_family_behavior_stability_report` — trade simulation (1R target/stop), direction agreement, regime sensitivity
- **Family Explorer UI**: static HTML with LightweightCharts, sidebar family list, detail panel, chart inspector modal with candles/pivots/motif highlight
- **Baseline dataset**: SPY, QQQ, IWM, DIA — daily, 10 years, 2.0 ATR reversal, min 3 bars between pivots
- **Artifacts**: `backend/data/research/atr_pivot_v1/` — per-symbol JSON (normalized bars, pivots, legs, labels, motifs, outcomes, family stats v1/v2, fragmentation, inspection), cross-symbol comparison, stability report, explorer HTML, SVG snippets
- **Runner script**: `backend/scripts/run_atr_pivot_research.py`
- **Tests**: `test_structure_discovery_families.py`, `test_structure_discovery_inspection.py`
- **PRD/PDR**: `.planning/plans/ACTIVE/family-discovery-v2-prd-pdr.md`
- **Key design decisions**:
  - Fragmentation analysis showed exact pivot label sequence was the biggest uniqueness driver
  - Do not scale to multi-symbol before family inspection proves coherence
  - Do not jump to clustering before the checkpoint is resolved
  - The system is not detecting named chart patterns — it discovers structural motifs from scratch
- **Top v2 families by occurrence**: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` (26), `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` (21), `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` (20)

### Strategy Validation Policy (2026-03-15)
- **Document**: `docs/strategy-validation-policy.md`
- **Tier 1 (Existence)**: fixed spec, no sweep, no tuning — does the idea have life?
- **Tier 2 (Repairability)**: bounded sweep (5 attempts/param), failure-targeted, identity-preserving — is it salvageable?
- **Tier 3 (Certification)**: no sweep, no rescue, pass/fail only — does it survive full validation?
- **Post-Tier 3**: optimization allowed only after certification, baseline frozen, optimized version = new branch requiring revalidation
- **Result categories**: Pass, Review (borderline, enters Tier 2 sweep), Hard Fail (tombstone immediately), Tombstone (preserved for lineage, removed from active pipeline)
- **Identity rule**: tuning adjustments only, not logic changes — if identity breaks, it's a new branch
- **Philosophy**: the pipeline is designed to kill most strategies — reject weak, rescue borderline, certify robust, optimize only after certification

### Research-to-Trading Roadmap (2026-03-15)
- **System layers**: Research → Signal → Strategy → Portfolio
- **UI build priority**: Family ranking controls → Baseline/null-model comparison → Visual motif inspection → Signal layer into backtester → Execution simulation → Strategy layer → Portfolio layer
- **Reference**: `.planning/plans/ACTIVE/Update.md`

### Open Threads

**Current Priority: FAMILY RESEARCH**
- Top v2 families need manual visual inspection to decide if buckets are coherent
- Two valid outcomes: (A) families look coherent → keep v2, scale to more symbols; (B) families too mixed → tighten structural class definitions, rerun
- Next UI features: family ranking controls, baseline/null-model comparison
- Signal layer integration (family → live causal event at pivot-5 confirmation) is the next system layer after research solidifies

**State-machine migration audit (new)**
- Repo decision: any strategy that depends on inter-bar memory must be migrated to explicit `setup_config.state_machine` semantics.
- Why: the old stateless engine re-ran each strategy cold on every bar prefix, which breaks any strategy that depends on sequence, anchoring, expiry, invalidation, or single-fire event semantics. That produced false positives, duplicate signals, and phantom trades in backtests.
- Current family inventory:
  - `wyckoff_accumulation_rdp` — stateful-required
  - `lth_continuation_composite` — stateful-required
  - `macd_divergence_crypto_14R` — stateful-required, current stateful file not present under `backend/data/strategies/`
  - `pullback_uptrend_entry_composite` — needs review because it may inherit stateful timing from MACD divergence
  - `sma_50_200_benchmark` — stateless-safe
- Detailed checklist lives in `.planning/plans/ACTIVE/structural-families-to-execution-prd.md`.

**LABELING (paused)**
- Full Russell 2000 scan ran (1,721 symbols, weekly, wiggle base)
- ~851 candidates from ~863 scanned (98.6% pass rate — too high, needs tightening)
- Target: 300+ hand-reviewed labels with corrections
- Was at ~150 labels when focus shifted to family research

**V1 Critical Path (ship first)**:
- **Fix MACD Divergence Context Problem** — Divergence fires everywhere (uptrend, downtrend, bases). Need a "base position" filter: above base → only long, below base → only short. The regime filter (self-referencing, majority vote) may solve this — needs visual verification on bad-trade symbols before composing with MACD.
- **Execution Bridge** — Alpaca API connection, signal scanner on schedule, order executor, position manager (enforces max concurrent), kill switch. THIS is V1.
- **Stabilize/Refactor** — App works but is fragile. Needs hardening before autonomous trading.

**V2 Features**:
- **Structural Exits** — Prior RDP swing high as take profit. RDP data already available at signal time. Would increase win rate.
- **Adaptive Optimizer Phase 1** — Early termination when fitness degrades across sweep variants. Plan: `.planning/plans/adaptive-optimizer-plan.md`
- **Adaptive Optimizer Phase 2** — LLM analyst reviews sweep results, picks next parameter, runs next sweep automatically
- **Adaptive Optimizer Phase 3** — 2D confirmation sweeps with heatmaps
- **Distilled Base Analyst** — Domain-specific reasoning AI. Plan: `.planning/plans/distilled-base-analyst.md`

- **Unified Strategy Visibility** — All pages (Validator, Sweep, Strategy) should see the same strategy list from one source. Need editable risk_config view on Strategy page. Currently fragmented.

**Existing threads (unchanged)**:
- Platform SDK refactor — move under `services/platform/`
- Package import system — zip export/import
- Research Agent 24/7 — continuous autonomous sessions
- Shorts composite — `required_regime: "distribution"`
- IWM variant — small caps check IWM not SPY
- Sub-panel collapse/expand — in progress
- Codify "big big big small" pattern
- RestrictedPython sandbox (Phase 3)
- Security: rotate API key, `.gitignore` before git init
- Yahoo Finance 4H aggregation


## Session Update (2026-02-13)
### Validator V1 Realization
- Validator moved from mock output to real computed reports.
- Backtest, robustness, and pass/fail now run through Python pipeline and async job API.
- Trade-instance audit retrieval endpoint added (/api/validator/report/:id/trades).
- Report clearing added (POST /api/validator/reports/clear).
### Strategy Workflow UX
- Added strategy builder modal in Validator:
  - prompt-driven draft generation (POST /api/strategies/generate-draft)
  - form <-> JSON sync
  - save as new version via /api/strategies
- Added direct status-apply action for selected version (patch status route).
- Strategy details moved to separate page (strategy.html) while validator remains report-centric.
### Validator Analysis UX
- Added explicit Validation Criteria table showing threshold vs actual vs pass/fail.
- Added in-page Validator Copilot chat next to reports.
- Chat context now includes structured validator facts (verdict, reasons, expectancy, OOS, WF, MC DD, etc.).
- Chat panel adjusted for better usability (larger, scrollable messages, auto-growing input).
### Data Hygiene
- Removed hardcoded validator seeding behavior.
- Filtered invalid non-strategy JSON from strategy listing.
- Persisted strategies visible in sidebar reflect real stored versions/status.

## Session Update (2026-02-13, Later)
### Validator Architecture Corrections
- Backtest engine no longer defaults to hardcoded SMA when strategy spec is present.
- Validator now derives entries from strategy-runner pattern candidates in causal bar-prefix mode.
- Added explicit backtest signal-source switch:
  - `backtest_config.signal_source = "strategy"` (default for real validation)
  - `backtest_config.signal_source = "legacy_sma"` (fixture/testing compatibility only)
### Robustness + Policy
- Pass/fail thresholds moved from hardcoded constants to `validator_config` in strategy spec (with defaults).
- DD percent conversion made configurable via `validator_config.r_to_pct`.
- Walk-forward windowing alignment corrected to 5-window schedule.
### Reliability + UX Stability
- Validator async jobs now persist to disk and survive process restart.
- Added validator run concurrency cap (`VALIDATOR_MAX_CONCURRENT_RUNS`).
- Validator frontend report rendering hardened with null-safe guards; malformed/partial reports no longer crash detail view.
- Validation criteria table now reflects report-provided thresholds instead of fixed display constants.
### Test State
- Validator fixture suite passes after remediation.
- Added robustness unit coverage for OOS/walk-forward/parameter-sensitivity.

## Session Update (2026-02-13, Latest)
### Validator Run UX + Symbols
- Validator run modal symbol library endpoint fixed (`/api/candidates/symbols` route precedence issue).
- Run status now includes elapsed/timeout timing context, reducing ambiguity when long jobs sit near high progress.
- Confirmed long-running jobs can fail by timeout (`Validation timed out after 480s`) rather than true UI deadlock.
### Validator Chat Panel
- Validator chat panel restyled to match Co-Pilot panel structure and spacing language.
- Chat keeps validator-aware context behavior while adopting updated panel hierarchy and controls.

## Session Update (2026-02-13, Progress Streaming)
### Validator Progress Model
- Replaced synthetic progress model with real progress events from Python pipeline.
- Progress events now stream over `stderr` as JSONL (`progress`, `stage`, `detail`).
- Node validator route parses these events and updates run-job fields in real time.
- Frontend now renders `detail` text in run status, improving transparency during long backtests/robustness phases.

## Session Update (2026-02-14 to 2026-02-15)
### Scanner Refactor + Plugin System + Frontend Modular Split
- Scanner refactored: indicator-driven (pluginId), not strategy-driven
- 6 legacy scanner modes converted to StrategyRunner plugins
- Persistent data caching with incremental Yahoo updates
- Symbol library dynamically loaded from `symbols.json`
- Scanner UI fixes (results panel position, swing annotations, blank results)
- `index.js` split into 8 modules (chart, drawing, correction, ai-chat, training, discount, scanner, orchestrator)
- Indicator overlay system: `renderOverlays()` + `clearOverlays()` in chart.js
- MA crossover plugin emits overlay lines (SMA 50 orange, SMA 200 blue)
- Fixed chart data `date` → `time` field for LightweightCharts compatibility
- Identified scan performance bottleneck (sequential Python spawn per symbol)
- Python Execution Layer plans created for persistent FastAPI service
---

## Session Update (2026-02-15, Phase 1B Service Expansion)
### Decisions
- Persistent Python service is now the primary acceleration path for both Validator and Scanner when enabled.
- Keep spawn-based execution as fallback for reliability during rollout.
- Scanner frontend uses batch endpoint so universe scans can run through one service call.

### Implementation State
- Added service: `backend/services/plugin_service.py`
- Added client: `backend/src/services/pluginServiceClient.ts`
- Validator route supports service routing with health-check + fallback.
- Candidates route supports service routing for run-plugin and scan-universe.
- Service currently exposes: `/health`, `/validator/run`, `/scanner/run-plugin`, `/scanner/scan-universe`.

### Feature Flag
- `VALIDATOR_USE_PY_SERVICE=1` gates service routing (used by validator and scanner integrations).

## Session Update (2026-02-15, Scan Parallelization)
### Problem Diagnosed
- `/scanner/scan-universe` was timing out silently (30s Node client timeout) and falling back to 9 sequential `/scanner/run-plugin` calls
- Each symbol's RDP computation took ~7s, totaling ~62s for 9 symbols

### Fixes
- **Dynamic timeout**: Node client now scales timeout per symbol count (15s/sym, 60s min, 10min max)
- **Parallel I/O**: `ThreadPoolExecutor` (4 workers) pre-fetches all Yahoo Finance data concurrently
- **Parallel CPU**: `ProcessPoolExecutor` (4 workers) runs RDP swing computation across separate Python processes (bypasses GIL)
- **Unified dev script**: `npm run dev` launches Python service + Node backend via `concurrently` + `cross-env`

### Benchmark
- 9 symbols warm cache: **62s → 10-13s (5-6x speedup)**

### Files Changed
- `backend/services/plugin_service.py` (ProcessPoolExecutor, ThreadPoolExecutor, timing)
- `backend/src/services/pluginServiceClient.ts` (dynamic batch timeout)
- `backend/package.json` (concurrently, cross-env, new scripts)

## Session Update (2026-03-17, Parameter Manifest + Snapshot Recovery)
### Validation / Sweep Policy Maturity
- The strategy validation policy was clarified around anatomy and sweep behavior:
  - `Structure`
  - `Location`
  - `Entry Timing`
  - `Regime Filter`
  - `Stop Loss`
  - `Take Profit`
- A key architecture gap was discovered: the policy defined what sweep is allowed to do, but the app did not have a canonical way to declare which knobs are real, exposed, identity-preserving, and materially binding.

### Parameter Manifest Architecture
- Added a canonical `parameter_manifest` to `StrategySpec`.
- Implemented shared manifest resolution in:
  - `backend/src/services/parameterManifest.ts`
- Integrated manifest-aware behavior into:
  - strategy storage/read paths
  - validator strategy resolution
  - validator parameter sensitivity selection
  - sweep parameter discovery
- Added native manifest adapters for the main strategy families currently in use, including:
  - density base detector
  - MA crossover
  - Wyckoff accumulation RDP
  - pullback-in-uptrend composite
  - base box / compression / regime / RDP fib / trend-following families
- Added audit tooling:
  - `backend/scripts/auditParameterManifest.ts`
  - `npm run manifest:audit`
- Result: validator sensitivity and sweep now have a shared parameter contract instead of separate ad hoc logic.

### Builder / Composer Alignment
- Blockly composer already inferred tunable params from connected primitive stage params.
- Pipeline / node editor already inferred tunable params from node params.
- AI composite builder (`frontend/public/workshop-composite.js`) was the remaining mismatch:
  - it scaffolded composites with `tunable_params: []`
  - it relied on backend fallback instead of explicitly carrying real tunable stage params
- This was fixed by:
  - loading primitive `default_setup_params`
  - seeding stage `params` when primitives are added
  - deriving composite `tunable_params` from those stage params
  - resyncing tunables on AI JSON import, validation, and registration
- Result: Blockly, pipeline/node editor, and AI composite builder now follow the same model for exposing meaningful knobs.

### Sweep / Sensitivity Findings
- A real workflow issue was confirmed:
  - some sweeps were flat because they targeted non-binding or downstream filter knobs
  - `min_score` in density-base was mostly a final filter, not a formation-changing structural lever
- Reading the plugin code directly confirmed which knobs materially change detection:
  - `swing_lookback`
  - `swing_lookahead`
  - `min_drop_pct`
  - `min_void_bars`
  - `min_base_bars`
- This reinforced the need for strategy-native manifest-driven sweep/sensitivity behavior.

### Tier Policy / Sweep Guardrails
- Fixed a loophole where Sweep could run a Tier 3-style sweep on a non-T3 strategy.
- Current intended rule:
  - only true T3 baselines may use Tier 3 holdout sweep mode
  - T2/T2R strategies may only use Tier 2 repair sweep mode
- Also clarified verdict language in the UI:
  - `Pass`
  - `Review`
  - `Fail`
  - `Hard Fail`

### Snapshot / Recovery Strategy
- Created a local full recovery snapshot:
  - branch: `snapshot/local-2026-03-17-125952`
  - tag: `snapshot-local-2026-03-17-125952`
- Created a full filesystem backup of runtime data:
  - `C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector-backups\snapshot_2026-03-17_125511`
- Separated code recovery from data recovery:
  - git for code / intentional assets
  - filesystem backup for volatile symbol/runtime data

### GateKeeper Remote
- `GateKeeper` is now the canonical remote identity for the project.
- A clean, history-free code snapshot was exported and pushed to GitHub:
  - remote: `https://github.com/eod9910/GateKeeper.git`
  - branch: `snapshot/clean-gatekeeper-2026-03-17-export`
  - tag: `snapshot-clean-gatekeeper-2026-03-17`
- Remote `main` was force-updated to that clean snapshot export.
- Local working repo remote now points to:
  - `origin = https://github.com/eod9910/GateKeeper.git`

### GitNexus
- GitNexus was initially broken because repo registration/index state was inconsistent.
- Recovered with:
  - `npx gitnexus analyze --force .`
- GitNexus impact analysis is now usable again.
- `gitnexus detect_changes` CLI command is still unavailable in this environment, so direct `git diff/status` remains the fallback scope check before commits.
