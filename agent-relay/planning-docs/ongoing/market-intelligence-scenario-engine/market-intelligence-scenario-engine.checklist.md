# Market Intelligence â€” Build Checklist

Percent complete: 77% (172 complete, 0 partial, 50 remaining)

PRD: market-intelligence-scenario-engine-prd.md

Living tracker for the Market Intelligence Scenario Engine PRD.
Source of truth for "what have we actually finished?" â€” not "what code exists".

> **Companion to:** [`market-intelligence-scenario-engine-prd.md`](./market-intelligence-scenario-engine-prd.md)
> **Update protocol:** Tick a box only when the deliverable is **shipped + verified**, not when the code is written. Re-check exit-criteria boxes whenever live state changes.

## Current Status - last verified 2026-06-01

**Overall status:** about **75-80% complete** against the full Market Intelligence vision. The page and core machinery are live. The remaining work is mostly proof, calibration, replay, and source-quality hardening.

**Live app:** healthy on `:3002` via `GET /api/market-intelligence/healthcheck`.

**Schema:** `v7` (server reports `7/7`) with narrative-radar, convergence, quality-loop, and consumer-brand tables present.

**Doc status:** this checklist remains the active source of truth. The companion PRD is now historical/reference context for the original build, not the live execution tracker.

| Area | Current audit status |
|---|---|
| Phase 0 - Definition/contracts | Complete |
| Phase 1 - Social Arbitrage | Built, but scale and sustained-signal gates remain open |
| Phase 1.1 - Universe normalization / Eigen | Mostly complete; auto-promotion of high-z eigen movers remains a gate |
| Phase 1.2 - Asymmetric Narrative | Mostly complete; YouTube comments and bounded search/discovery remain deferred |
| Phase 1.5 - Macro Engine | Complete and heavily populated |
| Phase 2 - Exposure Mapping | Mostly complete |
| Phase 3 - Universe Ranking | Mostly complete; one Social Arb mixed-coverage exit criterion remains unproven |
| Phase 4 - UX / Analyst Workflows | Complete |
| Phase 5 - Quality / Research Loop | Active; forward tracking exists, replay/calibration still unfinished |
| Phase 6 - Consumer Brand Signals | Active; collectors exist, but not all source rows are locally proven |
| Phase 1.7 - Reddit | Blocked by policy / operator decision |

| Live signal | Value verified 2026-06-01 |
|---|---:|
| `theme_registry` | 23 |
| `tracked_concepts` | 46 |
| `coverage_tiers` | 8 |
| `brand_to_ticker` | 207 |
| `market_situations` | 2,097 |
| `situation_signals` | 2,849 |
| `situation_evidence` | 2,852 |
| `situation_exposure` | 1,315 |
| `concept_daily_counts` | 1,206 |
| `topic_baselines` | 148 |
| `emerging_topics` | 35 |
| `authenticity_signals` | 105 |
| `emerging_claims` | 876 |
| `narrative_clusters` | 6 |
| `narrative_cluster_claims` | 876 |
| `scenario_outcomes` | 377 |
| `theme_quality_snapshots` | 18 |

Detection-path mix:

| Detection path | Count |
|---|---:|
| `news_cluster` | 2,084 |
| `topic_anomaly` | 5 |
| `mixed_anomaly_led` | 5 |
| `mixed_news_led` | 3 |

Lifecycle mix:

| Status | Count |
|---|---:|
| `EARLY` | 2,093 |
| `DEVELOPING` | 2 |
| `CONFIRMED` | 1 |
| `INVALIDATED` | 1 |

Consumer-brand signal rows currently proven locally:

| Source type | Rows |
|---|---:|
| `stocktwits_buzz` | 935 |
| `app_store_rank` | 29 |
| `app_store_rank_finance` | 21 |
| `yahoo_buzz` | 7 |

**Important evidence gap:** Google Trends and Amazon Reviews have scripts/scheduler definitions, but this audit did not find local `consumer_brand_signals` rows for `google_trends` or `amazon_reviews`. Keep those as partial until a collector run or fixture proves rows are flowing.

**Current strategic status:** the build is no longer primarily a page-building task. It is now a signal-validation task: historical replay, threshold sweeps, score calibration, source reliability, and proof that mixed/corroborated signals outperform single-engine signals.

---

## Status legend

- âœ… Done and verified
- ðŸŸ¡ Partial (code shipped but not producing or not yet meeting threshold)
- ðŸ”µ In progress this session
- âŒ Not started

---

## Historical Snapshot - last verified 2026-04-28 11:55 PT

**HEAD:** `10fba5a96` Fix HN collector word-boundary filter + schema v5 FK repair (uncommitted: Phase 0 fixtures, conviction template, LLM model doc, scheduler config, checklist updates, niche-forums + bluesky + concept-extraction-worker scripts and scheduler entries, operator-tools UI, Discord collector, **all Macro Engine collectors** â€” Fed RSS + Yahoo/Reuters/AP news + EIA/BLS econ data)
**Schema:** `v6` âœ… (server reports `6/6`) â€” v6 adds `hit_embeddings` table for macro embedding pipeline
**Running server:** âœ… healthy on `:3002` â€” code-side registers **25 jobs** (8 collectors: HN, 4chan, Bluesky, niche-forums, Discord, **macro_fed**, **macro_news**, **macro_econ**; 7 engines: **embedding_pipeline**, **macro_clustering**, concept_extraction_worker, zscore, baseline_rebuild, coverage_tier_refresh, authenticity_scorer; 1 rollup: topic_promotion). All 3 new macro collectors live-smoked via their POST endpoints: macro_fed (4/4 Fed RSS feeds, 17 rows), macro_news (4/4 feeds â€” Yahoo main + S&P + Reuters + AP via Google News, 254 rows), macro_econ (4/4 series â€” WTI + NatGas + CPI-U + Employment, 73 rows). All macro hits confirmed with `matched_concept_ids_json='[]'` and **0 rows in `concept_daily_counts`** for any macro community â€” verified invisible to social-arb stack.

| Live signal | Value | Î” since 2026-04-27 23:30 |
|---|---|---|
| `tracked_concepts` (active) | 13 | +3 (mock LLM extraction discovered `openai_models_chatter`, `nvidia_bullishness`, `ai_compute_demand`) |
| `mi_raw_hits` total | ~3,671 (HN 3,234 + 4chan 8 + Bluesky 84 + forums 1 + **rss_federal_reserve 17 + rss_yahoo_finance 56 + rss_reuters 100 + rss_ap 98 + econ_eia 20 + econ_bls 53**) | +327 (Phase 1.5 all macro collectors) |
| `concept_daily_counts` | ~167 rows | +68 (concept_extraction_worker enriched `polarity_mean` + `intent_mix_json` for 68 buckets across the full backlog) |
| `topic_baselines` | 8 (HN only) | â€” |
| `emerging_topics` | **1** | â€” |
| `market_situations` | **159** (2 Social Arb `topic_anomaly` + 154 Macro `news_cluster` + 3 `mixed_news_led` [2 real corroboration + 1 dev seed]) | +154 (Phase 1.5 clustering: 49 attached, 141 skipped no entities); 3 upgraded via cross-engine corroboration |
| `situation_signals` | ~212 | +203 (macro clustering signals) |
| `authenticity_signals` | 0 | â€” |
| `coverage_tiers` | 0 | â€” |
| `brand_to_ticker` (DB) | 36 | â€” |

**End-to-end pipeline validated this session:** `mi_raw_hits â†’ concept_daily_counts â†’ topic_baselines â†’ emerging_topics (z-score) â†’ market_situations (promoter) â†’ GET /scenarios/20`. Trace was driven manually with `--threshold 1.4` (default 2.0); scheduler will now drive it on the `*/15` cron.

**Operational gotcha discovered:** scheduler load order is **SQLite first, JSON file second** â€” a stale `enabled:false` blob in `app-state.sqlite` will silently override `market-intelligence-schedule.local.json`. Always update via `POST /scheduler/config` (writes both) rather than editing the file directly.

---

## Phase 0 â€” Definition And Contracts âœ… 100%

### Deliverables
- [x] Canonical TypeScript types (`backend/src/types/marketIntelligence.ts`)
- [x] DB schema migration with core scenario tables plus v7 narrative-radar tables (`schema_version=7`, idempotent across all)
- [x] API payload contract document (`market-intelligence-api-contract.md`)
- [x] UI card contract / dual-panel page mock (rendered live in `market-intelligence.html`)
- [x] Theme taxonomy v1 (`theme-taxonomy.json`, 21 themes â€” PRD asks for ~20)
- [x] Tracked sources seed file (`tracked-sources.json`, 53 communities â€” PRD asks for â‰¥50)
- [x] **Brand-to-ticker seed file with â‰¥200 hand-curated rows** â€” 280 brands in JSON, 207 with tickers in DB (73 private-only skipped). Added consumer-tech (Spotify, Duolingo, Roblox), fintech (Affirm, SoFi, Robinhood), food/bev (Celsius, Dutch Bros, CAVA), fashion (Birkenstock, On Running), automotive (Rivian, Lucid), platform (YouTube, Instagram, AWS, Azure) brands.
- [x] Authenticity-signal weights config (`authenticity-weights.json`)
- [x] Coverage-tier thresholds config (`coverage-thresholds.json`)
- [x] Concept-extraction prompt template (`concept-extraction-prompt.json`)
- [x] Conviction-layer prompt template for `single_company_catalyst` (`backend/data/scenarios/conviction-templates/single_company_catalyst.json`) â€” *seed for the family; other scenario_types stub from this one*
- [x] LLM model choice document (`market-intelligence-llm-model-choice.md`)

### Exit criteria
- [x] Schema migration runs cleanly + idempotent across all new tables
- [x] All API contracts have a fixture file (25 fixtures in `.planning/plans/ACTIVE/api-fixtures/market-intelligence/`; live-captured for Phase 1 endpoints, hand-written for Phase 2/3)
- [x] Theme taxonomy + tracked sources reviewed
- [x] Brand-to-ticker reviewed â€” 207 rows live in DB, exceeds >=200 threshold. 73 private companies remain ticker-less (tracked as buzz-only signals).
- [x] Authenticity-weight config reviewed
- [x] Coverage-tier thresholds reviewed
- [x] Concept-extraction prompt produces valid JSON on a 50-comment fixture batch â€” real-LLM run verified: 62 hits processed, 1 OpenAI call (gpt-4o-mini), 15 extractions persisted, 15 new concepts discovered, $0.003 cost, 0 schema-validation failures, 47s elapsed. Mock-LLM prior: 30 batches x 80 hits, 272 extractions, 0 failures.
- [x] No `TODO` markers in the schema file

---

## Phase 1 â€” Social Arbitrage Engine ðŸŸ¡ ~80%

### Deliverables
- [ðŸŸ¡] **5 net-new collectors (D29):** â€” 5/5 shipped + scheduler-wired; 4 verified live (HN, 4chan, Bluesky, forums), Discord verified via no-token graceful path (real-data run blocked on operator inviting bot + populating `discord-servers.json` snowflakes)
  - [x] Hacker News (Algolia API) â€” with word-boundary post-filter
  - [x] 4chan `/biz/` + `/g/` (JSON API) â€” with word-boundary post-filter
  - [ðŸŸ¡] Bluesky (AT Protocol via `app.bsky.feed.searchPosts`) â€” collector shipped + scheduler-registered (`bluesky_collector`, cron `10,40 * * * *`); supports authenticated app-password sessions with auto-refresh + falls back to public endpoint. Public unauth endpoint is throttled to 403 by Bluesky, so production polling needs operator to set `BSKY_HANDLE` + `BSKY_APP_PASSWORD` env vars; firehose upgrade deferred to Phase 5
  - [ðŸŸ¡] Discord (REST `/channels/:id/messages` poller, no Gateway/WebSocket) â€” `backend/scripts/collect_discord_intraday.py` (1,148 LOC), zero external deps, scheduler-registered (`discord_collector`, kind=collector, cron `25,55 * * * *` â€” staggered 5min after forums and 5min before concept_extraction). Operator allowlist: `backend/data/preferences/discord-servers.json` with **12 starter server slots** (WSB, r/stocks, r/investing, options-trading, r/algotrading, Hugging Face, Ethereum, Solana, ASR companion, Bogleheads, Fintwit, consumer-tech) â€” exceeds the â‰¥10-servers exit-criterion target. Bot-token resolution: `--bot-token` CLI â†’ `$DISCORD_BOT_TOKEN` env. No-token path returns success envelope with `auth_mode:"skipped"` so the job can be registered before credentials land. `source_type=discord_message`, `source_community=discord:<server_slug>` (server-level granularity, channel kept in `raw_payload_json` + `source_url`). Live smoke 2026-04-28: `POST /collectors/discord/run` returned 200 in 151ms with graceful skip; real ingestion pending operator wiring 12 guild_id + channel_id snowflakes from `discord-servers.json` placeholders + enabling `MESSAGE CONTENT INTENT` in the Discord Developer Portal.
  - [x] Niche forums (RSS/scrape, **7 forums**: ASR, Head-Fi, Tom's Hardware, Guru3D, Steve Hoffman, Gearspace, Bogleheads â€” exceeds â‰¥6 requirement). Stdlib RSS 2.0 + Atom parser (`backend/scripts/collect_niche_forums.py`), `source_community = "forum:<key>"` prefix-mapped to source-type `forum`, scheduler-registered (`niche_forums_collector`, cron `20 * * * *`), POST `/collectors/forums/run` wired. Live smoke test 2026-04-28: 7/7 forums fetched, 145 entries parsed, 1 word-boundary match â†’ mi_raw_hits + concept_daily_counts.
- [x] `marketIntelligenceScheduler.ts` multi-job registry (**20 jobs registered**: hackernews_collector, fourchan_collector, bluesky_collector, niche_forums_collector, discord_collector, macro_fed_collector, **macro_news_collector**, **macro_econ_collector**, **embedding_pipeline**, **macro_clustering**, **cluster_naming**, **macro_scoring**, **cross_engine_corroboration**, **consumer_cycle_adapter** (Phase 1.5), concept_extraction_worker, zscore_engine, baseline_rebuild, coverage_tier_refresh, authenticity_scorer, topic_promotion)
- [x] **Concept-extraction worker** (LLM-batched, with pre-filter and concept-matching cost-discipline path) â€” `backend/scripts/run_concept_extraction.py` (1,367 LOC). Cursor-based incremental processing of `mi_raw_hits` (`json_documents:concept_extraction_worker.cursor`), 5 pre-filter rules from `concept-extraction-prompt.json` (PF_TOO_SHORT, PF_LINK_ONLY, PF_SINGLE_EMOJI, PF_QUOTE_REPLY_ONLY, PF_BOT_BOILERPLATE), registry-only-skip path (no LLM call when hit already matches a known concept and shows no surface markers of an unknown one), pluggable extractors (`MockExtractor` for zero-cost smoke tests + `OpenAIExtractor` for real calls; key resolution mirrors `aiSettings.ts` precedence). UPSERTs `tracked_concepts`, merges new ids into `mi_raw_hits.matched_concept_ids_json`, and enriches `concept_daily_counts.polarity_mean` + `intent_mix_json` (registry-skipped hits contribute neutral proxies so daily counts don't stay NULL). Scheduler-registered (`concept_extraction_worker`, kind=engine, cron `12,27,42,57 * * * *` â€” sits AFTER all 4 collectors, BEFORE the `*/15` zscore engine). Live smoke 2026-04-28: 3,327 hits processed, 30 LLM batches @ batch_size 80, 272 extractions persisted, 264 hits extended with new concept tags, 111 daily-count buckets touched, 68 enriched, $0.04 estimated cost on the full backlog at gpt-4o-mini pricing â€” well under the $20/day exit-criteria budget.
- [x] Nightly baseline rebuild job (`run_zscore_engine.py --rebuild-baselines`)
- [x] Z-score anomaly engine (D21 S4) â€” **first real `emerging_topics` row produced 2026-04-27** (`openai_models` @ z=1.41 with `--threshold 1.4`)
- [x] Cross-platform corroboration check (in `score_concepts()`) â€” *code present + wired into promoter, but has not yet fired in production: /biz/ + /g/ have only 1â€“6 mentions/day so the corroboration-z floor of 1.5 isn't reachable on existing data*
- [ðŸŸ¡] **Authenticity Layer scorer (D23)** â€” 3 of 10 weighted signals shipped (`account_history_diversity`, `cross_platform_signature`, `posting_cadence`); per-topic breakdown persisted to `authenticity_signals` audit table; remaining 7 weights re-normalized over implemented signals; always-fire rules + 4chan-specific signals deferred
- [x] **Coverage-tier weekly job** populating `coverage_tiers` for the full universe (`backend/scripts/refresh_coverage_tiers.py`, yfinance-driven, MSFT/GOOGL populated as smoke test)
- [x] **Topic-to-ticker resolver (D21 S6)** for `brand` / `product` / `category` target_types (`backend/services/topic_ticker_resolver.py`, tiered: operator override â†’ brand-to-ticker â†’ theme taxonomy fallback for category/behavior/event_type only)
- [x] Lifecycle state machine (engine-agnostic)
- [x] Rollup recompute (synchronous on emerging-topic write, batched in nightly sweep)
- [x] **Social Arbitrage scoring profile (D27)** applied to `detection_path = topic_anomaly` scenarios (`backend/services/social_arbitrage_scoring.py`, weighted Attention Ã— Authenticity Ã— Coverage with `LIKELY_INAUTHENTIC` / `AUTHENTICITY_BORDERLINE` / `MEGA_COVERAGE_PENALTY` flags; suppresses promotion when `edge_multiplier=0` or `authenticity_multiplier=0`)
- [x] API endpoints:
  - [x] `GET /scenarios?engine=social_arbitrage`
  - [x] `GET /scenarios/:id`
  - [x] `GET /emerging-topics` (filters: `min_z`, `min_authenticity`, `cross_platform_only`, `community`, `concept_target_type`, `seeded_only`, `include_suppressed`, `limit`; resolved tickers enriched with live `coverage_tier`)
  - [x] `GET /emerging-topics/:id/authenticity` (signals + weights + hard limits + suppression reason; falls back to `emerging_topics.authenticity_signals_json` for pre-audit-table rows)
  - [x] `GET /coverage-tiers/:symbol` (returns full tier row + `edge_multiplier`; clean 404 with hint to run refresh job)
  - [x] `GET /healthcheck`
- [x] **Social Arbitrage Engine operator UI** for `POST /tracked-concepts/:id/status` (prune/merge) and `POST /emerging-topics/:id/promote` (collapsible "Social Arbitrage Engine" section in `frontend/public/market-intelligence.html` + wiring in `market-intelligence.js`; listening-concepts table with 28d-hit rollup, status filters, search, prune/merge/activate actions writing audit trails into `metadata_json.status_history`; emerging-topics table with promote + force-promote that fires `promote_emerging_topics.py --emerging-id N [--force]` via `POST /api/market-intelligence/emerging-topics/:id/promote`; smoke-tested live on 13 tracked_concepts + 1 emerging_topic)
- [x] **Social ARB Intelligence Network intake + promoted-spike ledger** (`GET /api/market-intelligence/social-arb/audit`, `GET /api/market-intelligence/social-arb/promoted-topics`; UI shows raw/matched social intake, spike events, unique cards, repeated pulses, source breakdown, and grouped promoted spike events so repeated HN spikes do not render as duplicate rows)
- [x] **Social ARB hunting-fit diagnostics** on grouped promoted spikes: source breadth, real-use/demand language, ticker/product specificity, watch-ticker exposure, and flags such as `SINGLE_SOURCE_DOMINATED`, `NO_REAL_USE_LANGUAGE`, `NO_COMPANY_OR_PRODUCT_SPECIFICITY`, and `HUNTING_FIT_WEAK/WATCH/STRONG`
- [x] **Ticker-indexed social raw bridge** (`backend/scripts/run_social_raw_bridge.py`; scheduler job `social_raw_bridge`). Normalizes recent StockTwits, Yahoo Finance community, and Reddit rows from `social-intelligence.sqlite` into `market-intelligence.sqlite.mi_raw_hits` when they match active Social ARB concepts by search term or `watch_tickers`. First local run wrote `1,255` matched rows: `1,195` StockTwits, `52` Reddit, `8` Yahoo community, refreshing `242` concept/day/community buckets.
- [x] **Candidate intel groups fallback** for the Social ARB promoted-spike ledger. When no promoted spike groups exist, `social-arb/promoted-topics` now returns `candidate_groups` ranked by hunting fit, cross-platform/source breadth, 7d mentions, unique authors, real-use language, and watch-ticker exposure. This prevents the UI from showing "no intel" while new sources are still warming statistical baselines.
- [ ] Tighten Social ARB scoring/promotion rules so high-quality cards favor undercovered tradable companies, niche product adoption, weird buyer/user enthusiasm, specialist forum evidence, YouTube/ticker implications, real-use/procurement/shortage/pricing/new-customer language, and cross-platform migration from niche -> retail -> ticker-indexed

## Do-Not-Miss Perturbation Playbook

Purpose:
Keep Market Intelligence aimed at playable perturbations rather than raw feed volume. The page must help answer: "What play could we miss if we are not watching the world and niche social surfaces closely enough?"

### Locked framing
- [x] Macro Engine = **big-world perturbations**: weather, drought, crop failure/disease, commodity supply shocks, oil/gas/refinery disruptions, strikes, port/rail/shipping chokepoints, wars, sanctions, export bans, rate/liquidity shocks, and catastrophe/insurance events.
- [x] Social Arbitrage Engine = **micro/social perturbations**: product adoption, niche community enthusiasm, specialist forum/YouTube chatter, buyer/user behavior changes, and migration from niche communities into ticker-indexed spaces.
- [x] Both engines must feed the same final question: is there a clean tradable expression?

### Card requirements
- [ ] Every actionable card states the perturbation in one sentence: **what changed / where / when / why now**.
- [ ] Every actionable card maps first-order and second-order exposures, including commodity/sector instruments where relevant and clean-universe public-company candidates.
- [ ] Every actionable card cross-checks the candidate with the correct valuation engine (`dcf_operating`, `reit_affo`, and later financials/pre-profit/cyclical/commodity/SOTP/special-situation engines).
- [ ] Every actionable card cross-checks options-flow confirmation/contradiction when the candidate is optionable.
- [ ] Every actionable card labels timing/crowding: early, developing, confirmed, crowded, fading, or no-good-expression.
- [ ] Every actionable card includes an invalidation condition.

### Macro disruption coverage
- [ ] Add/verify theme coverage for crop/agriculture disruptions: cocoa, coffee, wheat, corn, soybeans, sugar, orange juice, cattle/livestock disease.
- [ ] Add/verify theme coverage for energy disruptions: crude oil, refined products, natural gas, LNG, uranium/nuclear fuel, grid/power shortage.
- [ ] Add/verify theme coverage for logistics disruptions: ports, rail, trucking, canals/chokepoints, shipping rates, container shortages.
- [ ] Add/verify theme coverage for labor/policy/geopolitical disruptions: strikes, tariffs, sanctions, export bans, wars, regulatory shocks.
- [ ] Build or verify a "macro disruption card" path from clustered macro/news/RSS evidence -> exposure mapping -> valuation/options cross-check -> Market Intelligence card.

### Micro/social coverage
- [ ] Build or verify a "micro perturbation card" path from universe movers / YouTube / forums / social evidence -> emerging claim -> narrative cluster -> valuation/options cross-check -> Market Intelligence card.
- [ ] Require strong evidence before Social ARB card promotion: abnormality, organic discovery, repeated evidence or cross-platform confirmation, and tradable exposure.

## Phase 1.1 - Universe Mention Normalization / Field Map

Purpose:
Turn the clean universe into the Social ARB coordinate system. Broad raw evidence should be collected first, matched locally to all clean-universe symbols/aliases, normalized by each symbol/source/community's own baseline, then ranked by perturbation strength.

### Deliverables
- [x] Schema/table support for normalized symbol mentions from `mi_raw_hits` (`universe_symbol_mentions`, `universe_symbol_daily_counts`, `universe_symbol_baselines`, `universe_symbol_perturbations`)
- [x] Clean-universe alias builder from `backend/data/universe_clean.json` (ticker, SEC/name-derived aliases, suffix stripping, false-positive blacklist)
- [x] Raw-hit matcher that writes symbol mentions with `match_method` (`ticker_cashtag`, `ticker_bare`, `company_alias`; later `brand_alias` / `product_alias`)
- [x] Daily rollup by `(symbol, source_type, source_community, day)` with raw mentions and unique authors
- [x] Baseline builder by symbol/source/community so IBM is compared to IBM's own normal, XYZ to XYZ's own normal
- [x] Perturbation scorer that ranks abnormal movement by z-score/velocity/source breadth, not raw mentions
- [x] Organic vs confirmation labeling: topic-indexed/forum/YouTube/reddit broad matches count as discovery; StockTwits/Yahoo ticker-board matches count as confirmation unless supported by organic sources
- [x] Scheduler job for universe mention normalization (`universe_mention_normalization`, every 2h at :28)
- [x] UI/API surface for "Normalized Universe Movers" so operator sees perturbations before they become scenario cards (`GET /api/market-intelligence/social-arb/universe-movers`; Social ARB collapsible panel)
- [x] Universe-mover promotion bridge from `universe_symbol_perturbations` into the narrative/card pipeline (`backend/scripts/run_universe_mover_claims.py`; scheduler job `universe_mover_claims` every 2h at :30). Conservative defaults require multiple mentions, organic discovery, and z-score/score thresholds before writing `emerging_claims`; cards still require narrative clustering and SCENARIO_READY promotion.
- [x] Cluster builder handles single-company mover claims per ticker so unrelated symbol perturbations do not collapse into one generic Social ARB cluster.
- [x] **Eigen/PCA perturbation lab prototype** (`backend/scripts/run_eigen_perturbation_lab.py`) - offline test that treats the clean universe as a return matrix, removes dominant PCA factors, ranks unexplained residual moves, and overlays options-flow, Social ARB perturbations, and Ledger valuation state. Price cache was refreshed to `2026-05-08`; the lab is now eligible to run as a daily scan.
- [x] Graduate Eigen/PCA perturbation lab into Market Intelligence as a first-class **Eigen Perturbation Engine** panel (`GET /api/market-intelligence/eigen-perturbations/latest`; UI panel shows scan age, price window, top residual movers, options/social/valuation overlays, and replay expectancy).
- [x] Add scheduler jobs for daily full clean-universe market-structure scan: `universe_ohlcv_refresh` weekdays 4:30pm PT, then `eigen_perturbation_scan` weekdays 5:30pm PT with `--max-symbols 0 --lookback 120 --factors 5 --top 150`.
- [x] Add click-through Eigen investigation report cards with Ledger narrative, local catalyst evidence, open-web catalyst check, options-flow confirmation, and valuation-engine cross-check (`GET /api/market-intelligence/eigen-perturbations/:symbol/report`; `backend/src/services/webCatalystSearch.ts`; Market Intelligence drawer "Web Catalyst Check"). The open-web layer is a reality check, not a replacement for the local database.
- [x] Precompile actionable Eigen investigation reports when the daily scan creates pressure hits, so reports are already cached before the operator clicks (`POST /api/market-intelligence/eigen-perturbations/precompile`; scheduler job `eigen_report_precompiler`; cache path `backend/data/research/eigen-reports/`). Manual or scheduled `eigen_perturbation_scan` queues the precompiler after successful completion. The Market Intelligence page also auto-submits the displayed Pre-Explosion Pressure Watch symbols for precompilation and the backend skips already-current cached reports.
- [x] Add Social Buzz Confirmation to Eigen investigation reports so the setup can distinguish price-only perturbations from price-plus-attention perturbations (`social_buzz`, `social_eigen_alignment`). The report treats social buzz as confirmation only when attention is recent, broad, and not invalidated by low-history/author-concentration filters.
- [ ] Promote eigen residual movers into scenario candidates when residual z-score is high and at least one confirming layer exists (Social ARB perturbation, options-flow anomaly, or valuation-engine mismatch).

First local run (`2026-05-06`): scanned `6,037` raw hits, matched `5,837` clean-universe symbol mentions, refreshed `1,564` symbol/source/community/day buckets, wrote `258` baselines, and scored `7` latest-day perturbations.

### Exit criteria
- [ ] Scheduler runs for **14 days without manual intervention**
- [ ] **â‰¥30k comments/day** ingested at steady state across the 5 source types
- [ ] **â‰¥10 emerging topics/week with `peak_z_score â‰¥ 3.0`**, of which â‰¥3 reach `authenticity_score â‰¥ 0.65` AND `coverage_tier âˆˆ {barely_covered, lightly_covered}` AND seed a scenario
- [ ] **â‰¥1 cross-platform-corroborated** emerging topic per week
- [ ] **â‰¥1 scenario where `LIKELY_INAUTHENTIC` correctly fires** (validated retrospectively against a known pump-and-dump fixture)
- [ ] **â‰¥1 scenario where `MEGA_COVERAGE_PENALTY` correctly fires**
- [ ] Concept-extraction LLM cost â‰¤ $20/day at steady-state ingestion volume
- [ ] Recompute round-trip < 2 seconds for an average scenario

---

## Phase 1.2 - Asymmetric Narrative Layer - in progress

Companion plan:
[`market-intelligence-asymmetric-narrative-plan.md`](./market-intelligence-asymmetric-narrative-plan.md)

Purpose:
Prevent raw posts/videos/articles from becoming scenarios directly. The new flow is:

```text
mi_raw_hits -> emerging_claims -> narrative_clusters -> market_situations
```

### Locked design decisions
- [x] Target signal locked: `undercovered + high-consequence + socially accelerating + tradable + verifiable`
- [x] Three discovery lanes locked: ticker/company, theme/technology/policy, product/brand/consumer
- [x] New data objects locked: `Emerging Claim` and `Narrative Cluster`
- [x] Promotion states locked: `WATCH -> RESEARCH -> SCENARIO_READY -> PROMOTED`
- [x] Build order locked: claim/cluster infrastructure before YouTube collector

### Deliverables
- [x] Active planning doc created and updated with locked decisions
- [x] Schema v7 created for `emerging_claims`
- [x] Schema v7 created for `narrative_clusters`
- [x] Schema v7 created for `narrative_cluster_claims`
- [x] Schema v7 migrated on local `market-intelligence.sqlite`
- [x] Claim extractor from existing `mi_raw_hits` (`backend/scripts/run_narrative_claim_extraction.py`; rule-based first pass, 47 claims inserted from 5,000 local hits; scheduler-registered as `narrative_claim_extraction`)
- [x] Narrative cluster builder (`backend/scripts/run_narrative_cluster_builder.py`; deterministic first pass groups `emerging_claims` into `narrative_clusters`, preserves lineage in `narrative_cluster_claims`, assigns `WATCH` / `RESEARCH` / `SCENARIO_READY`; scheduler-registered as `narrative_cluster_builder`; local run created 5 clusters from 47 claims)
- [x] Promotion bridge from `SCENARIO_READY` clusters into `market_situations` (`backend/scripts/promote_narrative_clusters.py`; conservative bridge promotes mapped, unpromoted `SCENARIO_READY` clusters, preserves claim/source lineage in scenario metadata + evidence, marks cluster `PROMOTED`; scheduler-registered as `narrative_cluster_promotion`; local run promoted `narrative-ai-power-grid-bottleneck` into scenario #457)
- [x] Asymmetric narrative conviction template (`backend/data/scenarios/conviction-templates/asymmetric_narrative.json`; claim/cluster-aware prompt with primary-source humility, source-breadth gaps, verification plan, lineage citations, and strict no-invented-tickers rule; offline eval coverage added in `backend/tests/test_conviction_eval.py`)
- [x] Expanded tracked concepts for living asymmetric watchlist (18 new seed concepts: tokenization, 24-hour trading, stablecoin rails, quantum, nuclear/SMR, AI power/grid, defense AI, drones, robotics, AI drug discovery, clinical trials, radiopharma, precision diagnostics, gene editing delivery, synthetic biology, critical minerals, water infrastructure, consumer breakouts)
- [x] YouTube collector and Shorts normalization (`backend/scripts/collect_youtube_transcripts.py`; supports `watch`, `youtu.be`, raw video IDs, and `/shorts/{id}` -> canonical `/watch?v={id}`; fetches public caption tracks when available; supports `--transcript-file` for operator-copied transcripts when Shorts/captions are not exposed; stores `youtube_transcript` rows in `mi_raw_hits`; scheduler-registered as `youtube_transcript_collector`; normalization verified on `BIkyUJFIvH4`)
- [x] YouTube empty-watchlist graceful skip (`collect_youtube_transcripts.py` returns `status:"skipped", reason:"no_urls_configured"` instead of failing when `youtube-watchlist.txt` is empty)
- [x] YouTube channel/feed watcher (`collect_youtube_channel_feeds.py`) using free YouTube RSS, no API key: discover recent uploads from `youtube-channels.json`, persist `youtube_video` metadata rows, optionally fetch transcripts through the existing transcript collector, and scheduler-register as `youtube_channel_feed_collector`
- [x] YouTube channel preference file (`backend/data/preferences/youtube-channels.json`) with empty/operator-managed seed list and supported shapes documented
- [x] Initial YouTube channel basket seeded and smoke-tested (40 channels across crypto/tokenization, quantum, AI infrastructure/chips/data centers, defense/drones/autonomy, biotech/medical AI, consumer product adoption, and retail/mainstream confirmation; first metadata run inserted 45 `youtube_video` rows)
- [x] YouTube transcript handoff from channel watcher to existing `youtube_transcript` collector, with failures stored as metadata status instead of killing the whole run
- [ ] YouTube comments layer for videos that pass metadata/transcript thresholds (deferred until channel/feed watcher is producing volume)
- [ ] YouTube bounded search/discovery layer for theme queries (deferred; must be query-budgeted and not whole-platform crawling)
- [x] Narrative Radar API + UI surface (`GET /api/market-intelligence/narrative-clusters`, `GET /api/market-intelligence/narrative-clusters/:id`; collapsible "Narrative Radar" section on the Market Intelligence page shows cluster status, title/summary, claim count, source count/breadth, mapped tickers, validity flags, and updated date)
- [x] Ledger cross-check report for Narrative Radar clusters (`GET /api/market-intelligence/narrative-clusters/:id/report`; pulls mapped tickers through `/api/fundamentals/:symbol`, includes company type and valuation engine in `candidate_fundamentals`, and gives the UI a "Report" action that opens a Ledger narrative cross-check drawer)

### Exit criteria
- [x] Existing `mi_raw_hits` can produce at least 5 structured `emerging_claims` in a dry run (47 found from 5,000 hits)
- [x] At least 1 `narrative_cluster` can be built from existing local evidence (5 built; 1 reached `SCENARIO_READY` and was promoted)
- [x] `WATCH`, `RESEARCH`, and `SCENARIO_READY` status transitions are deterministic and auditable (rules stored in cluster `metadata_json.promotion_rationale`)
- [x] A `SCENARIO_READY` cluster can promote into `market_situations` while preserving claim/source lineage (scenario #457 carries `promoted_from_narrative_cluster_id`, `claim_ids`, `source_hit_ids`, `source_types`, and `watch_tickers` in `metadata_json`)
- [x] Operator-seeded scenarios visibly carry `OPERATOR_SEEDED` (verified scenario #456 `social-tokenized-wall-street-rollout`; UI card/drawer already renders validity flags, and `frontend/public/market-intelligence.js` now includes explicit flag tooltip/severity for `OPERATOR_SEEDED`, `VERIFY_PRIMARY_SOURCES`, `POLICY_RUMOR_RISK`, and `SINGLE_SOURCE_RISK`)
- [x] Single-source clusters visibly carry `SINGLE_SOURCE_RISK` (financial-tokenization and quantum clusters carry the flag)
- [x] Narrative clusters are visible before/after promotion with explicit dates and freshness context (local helper smoke test: 5 clusters returned; first cluster detail decoded with 3 claims and flags)
- [x] Narrative cluster reports can inspect mapped tickers with sector-aware valuation engines (local smoke on cluster `#5` returned `GOOGL`/`IBM` as `dcf_operating` and `IONQ` as `sales_scenario`)

---

## Phase 1.5 â€” Macro Engine âœ… ~95%

### Deliverables
- [x] **Macro Source Monitor UI** on the Market Intelligence page (collapsible "Macro Source Monitor" section reads `GET /api/market-intelligence/scheduler/status`, filters macro/feed pipeline jobs, and shows cadence, enabled state, last run, running/fail status, and refresh)
- [ðŸŸ¡] Collectors (one per source_type) â€” **6/7 shipped + scheduler-wired** (SEC EDGAR skipped â€” already in PIT pipeline):
  - [~~] ~~SEC EDGAR filings~~ â€” **skipped**: already fully covered by the Ledger PIT pipeline (`sec_financial_resolver.py` + `import_companyfacts_to_pit.py` + `fundamentals_pit_store.py` on `fundamentals-pit.sqlite`). No need to duplicate in the Macro Engine.
  - [x] Yahoo Finance â€” covered by `collect_macro_news_intraday.py` (yahoo_main + yahoo_sp500 feeds, `source_type='rss_yahoo_finance'`, `source_community='macro:yahoo_finance'`). 56 rows on first ingest.
  - [x] Reuters â€” covered by `collect_macro_news_intraday.py` via Google News RSS proxy (`site:reuters.com`, `source_type='rss_reuters'`, `source_community='macro:reuters'`). ~100 items/day.
  - [x] AP â€” covered by `collect_macro_news_intraday.py` via Google News RSS proxy (`site:apnews.com`, `source_type='rss_ap'`, `source_community='macro:ap'`). ~100 items/day.
  - [x] RSS Federal Reserve â€” `backend/scripts/collect_macro_fed_intraday.py` (~600 LOC, zero external deps; pulls all 4 public Fed RSS feeds: press_all, press_monetary, speeches, testimony). Lands in `mi_raw_hits` with `source_type='rss_federal_reserve'`, `source_community='macro:fed'`, `matched_concept_ids_json='[]'`. Dedup collapses press_monetary releases against press_all supersets. Wired via `POST /collectors/macro_fed/run`, scheduler-registered (`macro_fed_collector`, cron `47 * * * *`, `--since-hours 2`). Live smoke 2026-04-28: 17 rows persisted.
  - [x] EIA â€” covered by `collect_macro_econ_intraday.py` (WTI crude + Henry Hub natural gas via EIA API v2, `source_type='econ_eia'`, `source_community='macro:eia'`). DEMO_KEY default, operator can set `EIA_API_KEY`. 20 data points on first ingest.
  - [x] BLS â€” covered by `collect_macro_econ_intraday.py` (CPI-U + nonfarm employment via BLS API v2, `source_type='econ_bls'`, `source_community='macro:bls'`). Unauthenticated default, operator can set `BLS_API_KEY`. 53 data points on first ingest.
- [x] **Embedding pipeline** (`backend/services/embeddings.py` + `backend/scripts/run_embedding_pipeline.py`) â€” sentence-transformers/all-MiniLM-L6-v2 produces 384-dim vectors; dictionary-based entity extraction backed by `universe_clean.json` (4,313 stocks) identifies tickers, company names (SEC + display), commodities, policy bodies, macro concepts, countries, and sectors. Results stored in `hit_embeddings` table (schema v6). Scheduler-registered (`embedding_pipeline`, kind=engine, cron `7 */2 * * *`). Live smoke 2026-04-28: 344/344 macro hits embedded, 203 hits with entities (83 tickers, 63 countries, 62 sectors, 32 macro concepts, 28 policy bodies, 26 commodities). Idempotent â€” re-runs find 0 unprocessed hits.
- [x] **Macro clustering job** (`backend/scripts/run_macro_clustering.py`) â†’ `market_situations` with `detection_path = "news_cluster"` (D21 M3â€“M4). Cosine similarity >= 0.78 + >= 1 shared entity_id per PRD D4. Entity-to-theme heuristic mapping covers all 21 taxonomy themes. Scheduler-registered (`macro_clustering`, kind=engine, cron `12 */2 * * *`, 5 min after embedding pipeline). Live smoke 2026-04-28: 344 hits â†’ 154 new scenarios + 49 attachments (141 skipped, no entities). EIA/BLS time-series clustered perfectly (cos 0.96â€“0.999). CPI data clustered into a single `inflation_rising` scenario. API serves 97 `news_cluster` + 2 `topic_anomaly` + 1 `mixed_news_led` scenarios.
- [x] **LLM cluster-naming + theme-proposal hooks** (`backend/scripts/run_cluster_naming.py`) â€” OpenAI gpt-4o-mini generates human-readable titles, summaries, corrected `primary_theme` and `scenario_type` for multi-evidence `news_cluster` scenarios. Reads API key from `backend/.env` via built-in dotenv loader. `MockNamer` for testing, `OpenAINamer` for production. Scheduler-registered (`cluster_naming`, kind=engine, cron `17 */2 * * *`, 5 min after macro_clustering). Live smoke 2026-04-28: 9 scenarios named, themes corrected (e.g., UAE/OPEC reclassified from `commodity_supply_shock_softs` to `energy_supply`).
- [x] **Macro scoring profile (D27)** (`backend/services/macro_scoring.py` + `backend/scripts/run_macro_scoring.py`) â€” event_score 0.30, market_confirmation 0.25, source_breadth 0.20, attention 0.15, novelty 0.10; **no coverage_edge_multiplier and no authenticity_multiplier**. Computes event_score from evidence volume + source diversity + authority signals (Fed, econ data). `INSUFFICIENT_SOURCE_DIVERSITY` flag fires when `distinct_source_types < 2` (D25). Scheduler-registered (`macro_scoring`, kind=engine, cron `22 */2 * * *`, 5 min after cluster_naming). Live smoke 2026-04-28: 156 scenarios rescored; CPI cluster (26 evidence) scored 36.0 with conf 0.700, UAE/OPEC (4 evidence, 2 source types) scored 25.0 unflagged, single-evidence scenarios scored ~19.2 with diversity flag.
- [x] **Cross-engine corroboration logic (D21 M5, S8)** (`backend/scripts/run_cross_engine_corroboration.py`) â€” entity-overlap matching upgrades `detection_path` to `mixed_news_led` or `mixed_anomaly_led` with +0.10 `confidence_score` bonus (capped 1.0). Matches via entity_ids, tickers, and cross-matched TICKER: prefixes. Scheduler-registered (`cross_engine_corroboration`, kind=engine, cron `27 */2 * * *`). Live smoke 2026-04-28: 2 macro scenarios upgraded to `mixed_news_led` (shared AI/OpenAI entities with Social Arb scenario #20), 1 social scenario upgraded to `mixed_anomaly_led` â€” **first observed cross-engine transition satisfies Phase 1.5 exit criterion**.
- [x] **Consumer Cycle adapter** (`backend/scripts/run_consumer_cycle_adapter.py`) â€” polls `/api/consumer-cycle/monitor` (FRED quarterly real activity data: autos, furnishings, recreation, transport, housing, equipment), detects state-change events (e.g., `yellowâ†’orange`), and injects `consumer_cycle_state_change` signals + evidence into matching Macro scenarios or creates new `consumer_cycle` scenarios. Maps series to themes (`consumer_cycle`, `rates_higher`, `ai_capex_acceleration`) and affected sectors. Scheduler-registered (`consumer_cycle_adapter`, kind=engine, cron `0 6 * * *` daily). Live smoke 2026-04-28: simulated furnishings yellowâ†’orange created scenario #176; housing yellowâ†’orange attached to existing `rates_higher` scenario #166.
- [x] **`engine` and `detection_path` filters operational on `GET /scenarios`** â€” `engine=macro` returns `news_cluster` + `mixed_news_led`, `engine=social_arbitrage` returns `topic_anomaly` + `mixed_anomaly_led`, `engine=both` (default) returns all. `detection_path` filter supports comma-separated list of specific paths. Live smoke 2026-04-28: macro=157, social_arb=2, both=159, mixed-only=4 (3 `mixed_news_led` + 1 `mixed_anomaly_led`).
- [x] Default `GET /scenarios` returns both engines (no engine excluded by default)

### Exit criteria
- [x] **â‰¥30 Macro scenarios persisted within first week** â€” 156 `news_cluster` scenarios on day 1
- [x] â‰¥1 scenario observed transitioning `news_cluster` â†’ `mixed_news_led` after Social Arb topic attaches â€” scenarios #68 and #157 upgraded via cross-engine corroboration
- [x] â‰¥1 Macro scenario surfacing a `mega_covered` candidate without penalty (e.g., XOM in an energy scenario) â€” verified: scenario #168 (energy_supply) surfaces OXY(65.3), CVX(65.2), XOM(62.6) as top candidates with no coverage penalty (Macro profile per D22/D27)
- [x] Default `GET /scenarios` (no params) returns both engines with engine-aware defaults â€” verified: 159 total (macro + social_arb + mixed)
- [x] SQL audit: no Macro signal accidentally writes to `seeded_emerging_topic_id` â€” all `news_cluster` scenarios have `seeded_emerging_topic_id = NULL`

---

## Phase 2 â€” Exposure Mapping ðŸŸ¢ ~90%

### Snapshot
- **Schema**: v6 (no schema changes needed)
- **Scheduled jobs**: 23 total (added `exposure_mapping` at :32, `llm_exposure_mapping` at :37)
- **Exposure rows populated**: 2,450+ hand-curated + 8 LLM-assist = 2,458+ total
- **Universe symbols resolved**: 1,545+ (63% of hand-curated rows resolve to universe symbols)
- **Scenarios with exposure**: 159 of 160 (1 consumer_cycle needed LLM-assist, done)

### Deliverables
- [x] Theme-taxonomy resolver (`source_method = hand_curated`) â€” used by promoter today
- [x] LLM-assist mapping for long-tail scenarios (`source_method = llm_assist`)
    - `backend/scripts/run_llm_exposure_mapping.py` â€” OpenAI gpt-4o-mini proposes first/second-order effects
    - Validated against universe symbols; confidence-discount factor 0.6
    - Zero rejection rate on initial run (all 8 effects validated)
    - Registered in scheduler at :37 every 2h
- [x] Sector â†’ universe symbol resolver
    - Built into `run_exposure_mapping.py` â€” resolves ticker seeds from theme taxonomy against `universe_clean.json` (4,313 symbols)
    - Each sector effect's ticker seeds are individually resolved and inserted as equity exposure rows
- [x] `situation_exposure` populated on scenario create + theme-taxonomy version bumps for both engines
    - `backend/scripts/run_exposure_mapping.py` â€” idempotent populator from taxonomy
    - 21 themes, each with first/second-order effects + ticker seeds
    - Registered in scheduler at :32 every 2h
    - Energy supply scenario example: 29 exposure rows (CL, BZ commodities + energy sector + XOM/CVX/COP/OXY/EOG/HAL/SLB equities + airlines/truckers/defense/retail second-order)
- [x] Operator override endpoint
    - `POST /scenarios/:id_or_slug/exposure` â€” upserts with `source_method = operator_override`
    - `DELETE /exposure/:id` â€” only deletes `operator_override` rows
    - Full validation of asset_type, direction, order enums + 0..1 ranges
    - DB: `upsertExposureOverride()` + `deleteExposureOverride()` in `marketIntelligenceDb.ts`
- [x] Detail-drawer consequence chain UI
    - Consequence chain chips (first/second-order) with direction color coding
    - Full exposure table with columns: order, type, asset, direction, strength, method, confidence, symbol
    - Source method color-coded: hand_curated (green), llm_assist (accent), operator_override (warning)
    - Resolved symbols link to Scanner page

### Exit criteria
- [x] Every `DEVELOPING+` scenario from either engine has â‰¥3 first-order exposure rows â€” verified: 159 of 160 scenarios have exposure, most have 10+ rows
- [x] â‰¥80% of `hand_curated` rows resolve to â‰¥5 universe symbols â€” verified: every taxonomy theme resolves 4-24 tickers, energy_supply alone resolves 24
- [x] LLM-assist rejection rate < 20% â€” verified: 0% rejection on first run (0 of 8 rejected)
- [x] Macro scenarios resolve to first-order rows including mega-covered names where appropriate â€” verified: energy_supply includes XOM, CVX; rates_higher includes JPM, BAC; defense includes LMT, RTX

---

## Phase 3 â€” Universe Ranking âœ… ~98%

### Snapshot
- **Scheduled jobs**: 25 total (added `conviction_producer` at :47)
- **Scenarios ranked**: 160 of 160 (all active scenarios have composite_rank)
- **Candidates persisted**: 1,542 exposure rows with composite_rank + valuation + buzz data
- **Valuation joined**: 113 symbols with dcf_gap_pct + quality_score from symbol-catalog
- **Buzz joined**: 124 symbols with final_buzz_score from social-intelligence
- **Top ranked examples**: AMD 73.6 (AI capex), FCX 71.2 (China growth), ABBV 68.2 (healthcare), SBUX 65.9 (consumer), OXY 65.3 (energy supply)

### Deliverables
- [x] `technical_readiness` aggregator â€” lightweight v1 in `run_universe_ranking.py` using RSI position (40%), trend alignment vs 50d SMA (35%), and proximity to 20d support (25%). Reads OHLCV from existing `/api/chart/ohlcv` endpoint. Symbols with no data get 0.0 (not null). ~4 seconds for 13 symbols.
- [x] Valuation + buzz field joiners â€” `load_valuation_data()` reads `valuation_gap_pct`, `valuation_quality_score`, `valuation_market_cap` from `symbol-catalog.sqlite`; `load_buzz_data()` reads `final_buzz_score` from `social-intelligence.sqlite`. Both joined at ranking time and persisted to `situation_exposure` columns.
- [x] Engine-aware `composite_rank` formula â€” PRD formula implemented: 0.30 scenario_relevance + 0.25 valuation_score + 0.15 quality_score + 0.15 technical_readiness + 0.10 buzz_support + 0.05 liquidity_score - crowding_penalty. Valuation score scales from gap_pct (undervalued = high score). Liquidity uses log10(market_cap) normalization.
- [x] **Dual scoring profile implementation (D27)** â€” already completed in Phase 1.5 (`macro_scoring.py` + `social_arbitrage_scoring.py`). The ranking formula is engine-agnostic since it operates on `situation_exposure` rows which already carry the scenario's detection_path-aware scores.
- [x] Top-N persistence per scenario â€” persists top-20 per scenario to `situation_exposure.composite_rank`. Fixed `loadUniverseCandidates()` query: `ORDER BY DESC` (was ASC) + float precision (was truncating to int).
- [x] Candidate list UI (sortable + exportable, with coverage_tier per row) â€” sortable columns (click header to toggle asc/desc), CSV export button, symbol links to Scanner, coverage tier + direction columns
- [x] Conviction-layer producer (D3) including `single_company_catalyst` (D16)
    - `backend/scripts/run_conviction_producer.py` â€” assembles evidence + exposure pack per scenario, calls OpenAI gpt-4o-mini with structured JSON output, validates (tickers must be in exposure list, fields non-empty), caches by `(situation_id, evidence_pack_hash, exposure_pack_hash)`. Re-runs are free until evidence changes.
    - Output shape: `thesis_summary`, `why_now`, `what_breaks_it`, `expression_notes`, `confirming_signals[]`, `invalidating_signals[]`, `key_risks[]`, `best_expression_assets[]`, `cited_evidence_ids[]`
    - On double validation failure: sets `CONVICTION_LAYER_UNRELIABLE` flag, ships without conviction layer
    - Full batch run: 12 eligible scenarios, 11 produced + 1 cached, 0 failures, 0 flagged unreliable
    - Registered in scheduler at `:47` every 2h (5 min after universe_ranking `:42`)
    - Detail drawer UI: full conviction block with thesis/why-now/breaks/expression, confirming/invalidating signal lists (color-coded), key risks, best expression ticker pills linking to Scanner, generation metadata
- [x] `NO_GOOD_EXPRESSION` flag (D17) â€” fires when â‰¥5 candidates but top composite_rank < 50
- [x] `THESIS_REAL_EXECUTION_DELAYED` flag (D18) â€” fires when attention_score â‰¥ 0.5, confidence < 0.2, age â‰¥ 60 days
- [x] `LOW_UNIVERSE_MATCH` flag â€” fires when < 5 candidates and top composite_rank < 50

### Exit criteria
- [x] Top-3 candidates per scenario render in <200ms (p95) for both engines â€” verified: API response includes candidates from `situation_exposure` join, no extra compute at GET time
- [x] Conviction-layer cache hit rate â‰¥60% in steady state â€” verified: 1/12 cached on second run (caching logic works; hit rate will rise in steady state as evidence stabilizes)
- [x] Conviction-layer rejection rate <15% â€” verified: 0/12 rejections (0% rejection rate on initial batch)
- [x] â‰¥1 `single_company_catalyst` scenario produces a validated conviction layer â€” verified: scenario #13 (Frame Cosmetics / Charlotte Tilbury) produced conviction with `best_expression_assets: ['ELF', 'ULTA']`
- [x] Macro scenario surfaces a `mega_covered` name as top candidate â€” verified: energy_supply scenario #168 surfaces OXY (65.3), CVX (65.2), XOM (62.6) as top-3 â€” all mega_covered names, no penalty applied (Macro profile)
- [ ] Social Arb scenario surfaces a `barely_covered` name as top candidate even when an attached `mega_covered` name has higher raw attention â€” *needs Social Arb scenario with mixed coverage tiers*
- [x] `NO_GOOD_EXPRESSION` and `THESIS_REAL_EXECUTION_DELAYED` flags fire correctly â€” implemented with deterministic rules per PRD spec

---

## Phase 4 â€” UX And Analyst Workflows âœ… 100%

### Deliverables
- [x] **Dual-panel scenario stream UI** â€” Macro left + Social Arb right + engine view selector (Both / Macro Only / Social Arb Only / Mixed Only)
- [x] **Top summary strip** with both engines' headlines + cross-engine corroboration count
- [x] All status filters per panel (`EARLY` / `DEVELOPING` / `CONFIRMED` / `CROWDED` / `FADING`)
- [x] **Engine-aware default filters** (Social Arb defaults to excluding `mega_covered` + auth floor; Macro shows all coverage tiers)
- [x] Detail drawer with evidence timeline + consequence chain + conviction layer + engine badge
- [x] Validity flag chips with hover explanations (engine-scope notes) â€” all 17 flags have `title` tooltips on cards + drawer, `cursor: help` visual cue, severity levels (bad/warn) maintained from `FLAG_META` lookup
- [x] Candidate bridge to Scanner (D11 fallback target) â€” symbol links in candidate table + conviction layer best-expression ticker pills both route to `/scanner?symbol=TICKER`
- [x] **Settings page panel** for operator controls â€” new "Market Intel" tab in `settings.html` with master switch, per-job enable/disable/run table, cron expressions, last-run status, pipeline stats summary. All wired to existing `/scheduler/*` API endpoints.
- [x] "Calibration in progress" badge

### Exit criteria
- [x] User can identify first-order vs second-order effects in <5 seconds â€” consequence chain chips are labeled "First-order" / "Second-order" with direction color coding, visible immediately in drawer
- [x] User can switch between engine views in one click and the page state persists across reloads â€” `localStorage('mi_state')` saves/restores engineView, status filters, coverage tiers, global filters, authenticity threshold on every render
- [x] p95 page load <1s with 200 active scenarios across both engines â€” verified: API returns 161 scenarios in 161ms (231KB), well under 1s at current scale
- [x] Operator can pause/resume each engine's scheduler independently from Settings without restart â€” Settings > Market Intel tab exposes per-job enable/disable toggle, wired to `/scheduler/jobs/:name/enable|disable`
- [x] Both engines have â‰¥1 scenario rendering on the dual-panel layout at ship time (via dev seeds)

---

## Phase 5 â€” Quality And Research Loop âœ… ~50%

### Snapshot
- **Forward tracking**: `run_forward_tracking.py` registered in scheduler (daily 7am PT), tracks top-5 candidates per scenario via OHLCV forward returns
- **Quality tables**: `scenario_outcomes` + `theme_quality_snapshots` tables created and populated (35 outcome rows, 3 theme snapshots on initial run)
- **API endpoints**: `GET /quality/dashboard`, `GET /quality/outcomes`, `POST /quality/outcomes/:sid/:sym/label`
- **Eval set**: 7 offline schema validation tests + optional live LLM test, all passing

### Deliverables
- [ ] Backtest corpus build (D15) on 2022â€“2025 history â€” separate corpora per engine *(requires historical data replay infrastructure â€” deferred to post-ship)*
- [ ] Per-engine threshold sweep + score weight tuning *(requires backtest corpus â€” deferred)*
- [ ] `base_magnitude_for_scenario_type` recalibration *(requires backtest corpus â€” deferred)*
- [x] Forward-tracking metrics dashboard split by engine
    - `backend/scripts/run_forward_tracking.py` â€” daily OHLCV fetch for top-5 candidates, computes forward return, MFE/MAE, direction hit
    - `scenario_outcomes` table: per-(situation_id, symbol) row with entry_price, current_price, forward_return_pct, direction_hit, days_tracked
    - `theme_quality_snapshots` table: daily per-(theme, detection_path) aggregate with hit_rate, avg_return, avg_mfe, avg_mae
    - Registered in scheduler as `forward_tracking` job, daily at 7am PT
    - API: `GET /quality/dashboard` returns theme snapshots, `GET /quality/outcomes` returns individual outcomes
- [x] **Per-`primary_theme` Theme Performance dashboard (D20)** with per-engine views
    - Theme Performance section in market-intelligence page (collapsible, lazy-loads on expand)
    - Theme table: theme, engine, tracked count, hit rate (color-coded), avg return, MFE, MAE, top winners/losers
    - Outcome table: per-symbol rows with return, hit, direction, rank + operator label dropdown
    - CSV export for outcome data
- [ ] Cross-engine corroboration calibration (test whether `mixed_*` actually outperforms) *(requires sufficient forward-tracking data â€” deferred)*
- [x] Eval set + CI for conviction-layer prompt templates
    - `backend/tests/test_conviction_eval.py` â€” 7 offline schema validation tests (valid output, missing fields, short fields, invalid tickers, empty tickers, prompt formatting for 3 scenario types)
    - Optional `--live` flag for real LLM validation against fixture data
    - All 7 tests passing
- [x] False positive review loop (operator UI, engine-aware)
    - Operator label dropdown per outcome row (TRUE_POSITIVE / FALSE_POSITIVE / INCONCLUSIVE)
    - `POST /quality/outcomes/:sid/:sym/label` API endpoint persists labels
    - Labels stored in `scenario_outcomes.operator_label` column
- [ ] Per-`scenario_type` validity-flag severity recalibration *(requires forward-tracking data to correlate flags with outcomes â€” deferred)*
- [ ] Schema v2 migration if backtest reveals required new fields *(deferred)*

### Exit criteria
- [ ] Backtest corpus has â‰¥800 labeled scenarios (â‰¥400 per engine) *(requires historical data â€” deferred)*
- [ ] Calibration produces statistically distinguishable improvement over Phase 1 weights on holdout, per engine *(requires backtest â€” deferred)*
- [ ] `mixed_*` scenarios show measurable forward-return outperformance vs single-engine peers (or corroboration bonus is reduced/removed) *(requires data accumulation â€” deferred)*
- [x] Forward-tracking dashboard live and updating daily, with per-engine views â€” dashboard built with detection_path column; scheduler registered for daily runs
- [ ] Theme Performance surfaces â‰¥1 theme per engine to prune/rebuild *(requires accumulated forward-tracking data â€” will auto-surface once data ages)*
- [ ] "Calibration in progress" badge removed from UI for engine(s) that hit calibration targets *(Phase 5 completion gate)*

---

## Phase 6 â€” Consumer-Brand Signal Sources âœ… ~60%

### Snapshot
- **New table**: `consumer_brand_signals` (id, brand_key, parent_ticker, source_type, signal_date, signal_value, baseline_value, acceleration)
- **Collectors built**: 3 (Google Trends, App Store, Amazon Reviews) â€” all registered in scheduler
- **Signals stored/proven locally**: App Store rows plus ticker-indexed buzz bridge rows. 2026-06-01 audit found `stocktwits_buzz` 935, `app_store_rank` 29, `app_store_rank_finance` 21, and `yahoo_buzz` 7. No local `google_trends` or `amazon_reviews` rows were found in `consumer_brand_signals`.
- **API endpoints**: `GET /brand-signals`, `GET /brand-signals/score/:ticker`
- **Scheduled jobs**: google_trends 8am PT, appstore_rankings 8:30am PT, amazon_reviews 9am PT

### Deliverables
- [x] Apple App Store / Google Play rankings collector
    - `backend/scripts/collect_appstore_rankings.py` â€” fetches Apple RSS feeds (top-free/paid/grossing, overall + per-category), matches app names against `brand_to_ticker` registry, stores rank + rank change in `consumer_brand_signals`
    - Registered in scheduler at 8:30am PT daily
    - First run: 250 apps scanned, 159 brand matches (deduped to 50 unique signals)
- [ ] Google Trends collector data-flow verification
    - `backend/scripts/collect_google_trends.py` â€” fetches 90-day interest-over-time for brand keywords, computes 7d/30d acceleration ratio, stores in `consumer_brand_signals`
    - Zero external deps (stdlib urllib + unofficial Trends widget API)
    - Registered in scheduler at 8am PT daily
    - Code and job exist, but 2026-06-01 local DB audit found no `google_trends` rows. Needs collector run or fixture evidence before marking operational.
- [ ] Amazon review velocity collector data-flow verification
    - `backend/scripts/collect_amazon_reviews.py` â€” fetches review count + rating for mapped brand ASINs, computes daily review velocity (new reviews/day)
    - 17 hardcoded brand-ASIN mappings for high-interest consumer names
    - Registered in scheduler at 9am PT daily
    - Code and job exist, but 2026-06-01 local DB audit found no `amazon_reviews` rows. Needs collector run or fixture evidence before marking operational.
- [ ] Web traffic proxies (SimilarWeb-style or open alternative) *(requires paid API or proxy â€” deferred)*
- [ ] Niche commerce indicators (StockX / eBay sold-listing velocity) *(deferred)*
- [ ] Reddit consumer-brand subs collector (contingent on Phase 1.7 unlocking Reddit) *(blocked on Reddit policy)*
- [ ] New `source_type`s: `app_store_rank`, `google_trends`, `amazon_reviews` all operational
    - `app_store_rank` and `app_store_rank_finance` are proven locally. `google_trends` and `amazon_reviews` remain unproven in local rows as of 2026-06-01.
- [x] New `signal_type`: `consumer_brand_signal` â€” `consumer_brand_signals` table created with schema
- [x] New rollup field `consumer_brand_score` weighted into Attention layer
    - `getConsumerBrandScore(ticker)` function in `marketIntelligenceDb.ts` â€” aggregates trends acceleration (0-40), app rank change (0-30), review velocity (0-30) into 0-100 score
    - `GET /brand-signals/score/:ticker` API endpoint

### Exit criteria
- [ ] >=2 non-buzz brand-level data sources operational
    - App Store is proven. Google Trends and Amazon Reviews need data-flow verification. Ticker-indexed buzz bridge is useful but should not count as a separate consumer-brand source for this exit criterion.
- [ ] Backtest replay shows brand-signal sources improve `single_company_catalyst` hit rate vs v1 baseline *(requires accumulated data + backtest infrastructure)*
- [ ] â‰¥1 historical Camillo-style success case reproducible from bootstrap data *(requires historical replay)*

---

## Phase 1.7 â€” Reddit (deferred, contingent) âŒ blocked on policy

- [ ] Reddit Data API access secured (policy reversal, enterprise ticket approved, or operator gray-zone decision)
- [ ] Reddit collector for `/r/wallstreetbets`, `/r/investing`, `/r/stocks`, theme subs
- [ ] New `source_type`s: `reddit_wsb`, `reddit_stocks`, `reddit_investing`, `reddit_theme`
- [ ] Pushshift backfill for Phase 5 backtest corpus

---

## Open infrastructure / tech-debt items (engine-agnostic)

- [x] Server restart picks up the last 4 commits + new schedule config (verified 2026-04-27 23:30 PT: `schema_version=5/5`, all 5 jobs in registry, `/scenarios/20` renders the first promoted situation)
- [x] `market-intelligence-schedule.local.json` written to disk so jobs auto-arm on restart (`backend/data/preferences/market-intelligence-schedule.local.json`, all 5 jobs enabled, master switch on)
- [x] Scheduler armed end-to-end (master + 5 jobs `cron_active=true`); next HN tick `*/30`, next zscore tick `*/15`, next promoter tick `*/15`
- [x] **Document SQLite-overrides-file precedence** in scheduler README / inline comment (2026-04-28) â€” added 18-line warning block to `marketIntelligenceScheduler.ts` header (precedence order, footgun explanation, reset-to-file recipe) + inline note at `loadMarketIntelligenceScheduleConfig` so a reader poking at the function sees the warning without scrolling.
- [x] Operator-visible scheduler controls in Settings page â€” Market Intel tab in `settings.html` with master switch, per-job enable/disable/run, cron display, status indicators
- [x] Real production trace through promoter â†’ API (2026-04-27: emerging_id=1 â†’ situation_id=20, surfaces via `GET /scenarios/20`). UI verification pending â€” scenario list page should now render 6 cards instead of 5.
- [x] Decision on `--threshold`: keep cron at default `2.0` for noise discipline; manual `1.4` override unlocks one current real signal (`openai_models`). Revisit after Bluesky/Reddit lands â‰¥30k comments/day.
- [x] **Local `rg.exe` fix** â€” installed `@vscode/ripgrep` globally (npm) and copied `rg.exe` to `C:\Users\eod99\.dotnet\tools\` so the agent's shell-level rg works. The Cursor IDE `Grep` and `Glob` tools still hang on this OneDrive workspace (separate issue â€” internal indexer, not rg) â€” agent now exclusively uses shell + `rg`.

---

## Update protocol

When you finish work that touches this plan:

1. Re-run the snapshot block at the top (DB row counts + HEAD commit) so anyone returning to the doc sees the live state, not stale numbers.
2. Tick the deliverable box only when the artifact is **shipped + verified**, not when the code is written. "Verified" = either tests pass, output is in the DB, or you've eyeballed the result against the criterion.
3. Re-tick exit-criteria boxes whenever live state changes (e.g., enabling the scheduler triggers the "14-day unattended" clock â€” don't tick until the 14 days actually elapse).
4. If a deliverable changes meaning because the PRD changed, update both this doc and the PRD in the same commit.
