> **📂 ALL RESEARCH REPORTS LIVE IN `.planning/Research Studies/`.**
> Every backtest / study / case-study we run is written up as a dated "paper" there, indexed in
> `.planning/Research Studies/README.md`. Scripts stay in `backend/scripts/`; the papers hold the
> results + conclusions. Look there first before re-deriving any signal finding.

---

> **PLANNING CONVENTION:** Follow `.planning/plans/PLAN_CONVENTIONS.md` whenever creating, moving, renaming, or auditing PRDs/checklists. Every active workstream must have a paired `<slug>-prd.md` and `<slug>-checklist.md` that sort together.

> **STRATEGY LIFECYCLE DOCTRINE:** A promising rule is not a validated strategy. Default path is `Research Candidate -> Parameter Sweep -> Validator -> Strategy Library -> Trading Desk`. Send raw rules to Parameter Sweep first to settle execution mechanics; Validator judges completed strategy candidates. Reference: `.planning/plans/REFERENCE/strategy-lifecycle-doctrine.md`.

# Reference Index (read these on demand — do NOT load into context unless relevant)

- **Consumer Cycle page — full teardown:** `.planning/plans/REFERENCE/consumer-cycle-page.md` — how the page is built, every file, data source (FRED/BEA series IDs), the green/red scoring logic, stock taxonomy, API endpoints, macro adapter, AND its known blind spots (lagging/quarterly, no producer-freight layer, one-directional, no persistence gate). Use this instead of re-deriving the page.
- **Freight method vs Consumer Cycle (methodology comparison):** `.planning/plans/REFERENCE/freight-method-vs-consumer-cycle.md` — the Maxonomics reindustrialization thesis vs. our page; the regime-rotation tension (cycle's leading driver possibly shifting consumption → production) and proposed upgrades. Live canvas mirror lives in Cursor's `canvases/` (out-of-repo).

---

# Latest Session - 2026-06-01

## Status

- Phase: `RESEARCH/VALIDATION` — valuation-engine fix + rigorous strategy backtesting against a real benchmark.
- **All studies from this session are written up in `.planning/Research Studies/`** (see the note at the top of this file). New/updated papers: `2026-05-31-valuation-strategy-and-model-portfolio.md` (two addenda), `2026-06-01-risk-managed-portfolio-sim.md`, `2026-06-01-full-convergence-stack.md`.
- Headline outcome: the DCF valuation gap is confirmed to be **not a standalone edge** — in every configuration (raw, sleeve portfolio, risk-managed equity curve, with/without stops) it merely matches or trails buy-and-hold SPY. It is a confirming leg only.

## Micro-cap valuation fix (shipped — live + backtest paths)

The DCF engine produced garbage for micro-caps (e.g. TYGO +57,390%, fair value over a near-zero price). Fixed across Ledger's 4-layer architecture:

- **New `relative_multiples` engine** (small/micro-cap or non-normalizable operating companies): EV/Sales + Price/Book vs sector bands, asset/NAV floor, dilution/solvency risk haircut, wide low-confidence band. Doctrine in `workspace/Financial Analyst Workspace/references/valuation-models/smallcap-relative-multiples/` (`README.md` + `config.json`); routed via `MODEL_MAP.md` + `dcf-valuation/SKILL.md`; implemented in `backend/src/services/ledgerEngines.ts` (`runRelativeMultiplesValuationEngine`, `shouldUseRelativeMultiplesEngine`) and mirrored in `backend/scripts/build_universe_valuation_snapshot.py`; rendered in `visionService.ts`.
- **Routing rules (tuned this session):** market cap < $300M → relative_multiples; OR genuine non-positive cash flow (FCF/OCF present-and-≤0, no positive evidence) **but only below a $2B `unstable_market_cap_ceiling`** so a large compounder with one negative-FCF/growth-capex year (e.g. AAON $6.6B) stays on DCF. Missing data must NOT misroute.
- **Reliability guardrail (Layer 0):** in the live snapshot builder AND the backtest PIT path, any valuation with **price < $1, market cap < $25M, or |gap| > 300%** is neutralized to `valuation_state = 'unrated'` so non-investable nano/sub-penny names can't pollute undervalued/overvalued screens or the fade composite. In `run_valuation_gap_accuracy_study._evaluate_symbol` this is opt-in via `reliability_guard=True` (the two strategy scripts pass it; the accuracy-study baseline is untouched).
- **Snapshot rebuilt** (full `clean_stocks`, ~2.3 min): 3,392 rows; engine mix dcf 1,647 / relmult 1,032 / roe 602 / reit 111; max |gap| among rated names now 299.5% (was 290-billion-%); 576 names `unrated`.

## Valuation strategy backtests — re-run with the guardrail, then benchmarked vs SPY

- **Signal strategy + guardrail:** removed ~12,600 garbage trades (~10k bogus "undervalued" micro longs). Long fat-tail shrank (avg +15.8%→+11.6% — some "edge" was garbage moonshots); short mean flipped −3.1%→+0.9% (but worst single short still ≈ −22,510%, inherent unmanaged-short tail).
- **Model portfolio + guardrail:** the short-sleeve time bomb is defused — **worst formation −141.7% → −20.7%**; win rate 82%→88%; avg +15.4%→+12.9%; best +99.6%→+39.2% (fake upside also trimmed).
- **Benchmark vs buy-and-hold** (`backend/scripts/run_benchmark_buyhold_compare.py`, same 50 monthly 1-yr windows): model portfolio **+12.9% avg = SPY +12.91%** (median WORSE: 12.5% vs 15.8%; drawdown deeper). It beat only the **equal-weight** S&P (RSP +7.6%). Verdict: SPY beta with a small-cap tilt, no real alpha.

## Risk-managed portfolio sim — "real" risk management did NOT rescue it

New event-driven equity-curve simulator `backend/scripts/run_valuation_portfolio_sim.py` ($100k, long-only undervalued, **fixed 3% position sizing**, stops, 1-yr max hold, monthly refills, reliability guardrail). Candidate observations cached to `valuation_portfolio_candidates.json` so stop levels sweep in seconds after one ~16-min scan. Period 2021-03 → 2026-05.

Stop-level sweep (CAGR / max-DD / stopped-out%):

| Stop | CAGR | Max DD | Stopped |
|---|---:|---:|---:|
| 20% | +9.1% | −31.3% | 62% |
| 30% | +8.5% | −38.2% | 44% |
| 40% | +13.8% | −26.5% | 25% |
| 50% | +18.0% | −25.6% | 13% |
| no stop | +18.4% | −27.0% | 0% |
| **SPY B&H** | **+22.1%** | −24.5% | — |

- **Stops on a value signal are self-defeating (monotonic): tighter = worse.** The 20% stop cost ~9.3%/yr vs no-stop AND didn't reduce drawdown — it sells the bottom on a mean-reverting signal and sits in cash through the recovery.
- **Even with no stop, value still trailed SPY by ~3.7%/yr** with a slightly deeper drawdown. The −13% gap of the 20%-stop run decomposes into ~9.3% stop-drag + ~3.7% value-tilt drag.
- Lesson: stops belong on momentum/trend, never on a contrarian value gap. Beating SPY needs a better entry signal (full convergence stack) or a momentum overlay — not risk management bolted onto a lagging value tilt.

## Open thread / next candidate

- **Full convergence stack benchmarked vs SPY: NOT certified.** New script `backend/scripts/run_full_convergence_stack_study.py` recomputed point-in-time eigen + price extension + crowd + insider + thesis-proxy stacks and compared monthly baskets vs SPY. Result: 6mo fails, short/fade side fails badly, 1yr bullish mean beats SPY only via right-tail skew while median top baskets lose to SPY. Keep as watchlist/ranking / right-tail discovery, not an autonomous portfolio rule.
- **Next candidate:** improve bullish-tail ranking/risk controls and require a separate strict fade-timing trigger before any short-side use.
- Optional: full relative-multiples PIT port so small-caps get sane historical fair values in backtests instead of just being excluded (`unrated`).

---

# Latest Session - 2026-05-30

## Status

- Phase: `RESEARCH/VALIDATION` — signal edge-testing (eigen, bases/tops) + EDGAR insider backfill; Market Intelligence narrative layer remains built
- Product state: Market Intelligence has raw-hit → claim → narrative-cluster → scenario promotion plumbing; thesis extractor (`mi_narrative_theses`) is live but UNVALIDATED; EDGAR Form4/13D/13F backfill in progress
- Current source-of-truth planning area: `.planning/plans/`
- **2026-05-30 session**: Built/validated a weekly base+top detector, ran four backtests that re-characterized the eigenvalue signal, scoped how to backtest the thesis extractor, and recorded a self-modifying-app design north-star
- **2026-05-05 session**: Built the asymmetric narrative cluster builder and promotion bridge, corrected Market Intelligence UI naming, and fixed Codex GitNexus MCP config for next session

## Latest Update (2026-05-30)

### Signal edge research — what we learned (high-value, durable)

**Base / Top detector (weekly bars, price geometry only — NO eigenvalues):**
- A base is a tight/flat consolidation (range ≤30%, flat slope+drift over ~30–40 weeks) that is PRECEDED BY A FALL and sits NEAR THE LOWS. A top is the same shape but after a RUN-UP, near the HIGHS (right shoulder / distribution).
- Discriminator that works: `pos_in_history` (price position in full range; base ≤0.40, top ≥0.55) + `wks_since_peak` (base = old peak; top = peak within ~90 weeks). Validated against user charts: TAL=base, RPM/TMUS/SKWD=tops; correctly flagged ATAT's 2024 base before its breakout.
- Detector is pure geometry. Eigenvalues add nothing to *finding* a base (residual-z is ~0 inside any flat base by definition).
- NOTE: price CSVs only go back ~5y, so `pos_in_history` is within a 5y window, not true all-time.

**Eigenvalue (cross-sectional residual-z from rolling PCA) — re-characterized across 4 backtests:**
1. Long base-breakout trigger: NO edge (confirmed breakouts +1.0% fwd13 vs unconfirmed +4.2%; both < +7.3% bull base rate). Confirmation HURT — it selects exhaustion spikes that mean-revert.
2. Short top-breakdown trigger: confirmation DISCRIMINATES (confirmed −6.6% vs unconfirmed −12.7% short return) but bull drift means standalone shorts still lose.
3. Market-neutral excess-return test (the clean one): eigen+vol shock is a **directional relative-momentum signal**, monotonic — strong UP-shock (ez≥2) +4.1% excess/26w (t≈2.5), down-shock −1.9% (t≈−2.5). "Short any shock" = 0 (they cancel).
4. **Verdict:** eigenvalue's only real edge is CROSS-SECTIONAL RELATIVE MOMENTUM, harvested as a diversified market-neutral basket (long up-shocks / short down-shocks), NOT as a single-name directional trigger. It is a coincident confirmer, never a leading predictor. Caveats: t-stats inflated by overlapping windows; median excess negative in every bucket (mean-driven fat tail); effect sizes modest.

**Signal scorecard (honest):**
- Eigen (convergence scoreboard): tested hard → modest relative-momentum only; NO leading edge. Whether it ADDS to convergence-in-combination is untested.
- Thesis extractor: believed to work, NEVER backtested. Do not crown it on vibes (same trap eigen nearly passed).
- Options flow: not historically testable (no backfilled history); forward-collected data matures ~a year out.
- Insider (Form 4): now testable thanks to backfill — HIGHEST-VALUE next experiment.

**How to backtest the thesis extractor (decided approach):**
- The LLM *narrative* is NOT backtestable (look-ahead bias + almost no dated history yet) → forward-log only.
- The *quantitative gap underneath it* IS backtestable now, no look-ahead: trigger = `buzz_zscore` rising while price/`dcf_gap_pct` hasn't caught up → measure forward EXCESS return vs universe. Test the signal the story narrates, not the story.
- `mi_narrative_theses` stores symbol, `direction` (bull/bear), timestamp, specificity — a dated directional prediction. Gating constraint: how deep per-symbol social-buzz history goes (likely far shorter than 5y price history → small sample).

### EDGAR insider/activist/institutional backfill
- Top-40 convergence backfill: DONE (40/40 symbols, 14,207 insider txns, 183 activist 13D/G, 72 alerts, 3-year window).
- Universe Form4/13D backfill: IN PROGRESS (chained after top-40; 4,314 symbols; idempotent; ~day-plus runtime). Log: `backend/data/_edgar_universe_backfill.log`.
- 13F multi-quarter backfill: DONE earlier (24 funds, 430k holdings, 2,673 symbols). 13F wired into EDGAR scheduler + settings checkbox (`s-edgar-include-13f`).
- Scripts: `backend/scripts/collect_edgar_filings.py` (per-issuer `--backfill-symbols/--backfill-universe/--backfill-days`; busy_timeout raised to 60s), `collect_13f_holdings.py` (`--backfill --max-quarters`).

### DESIGN NORTH-STAR — self-modifying app (capture-for-later, NOT building now)
User insight: we are using the app AND modifying it in the same loop (hypothesize → build → backtest → keep/kill). The vision is to make that loop a first-class capability INSIDE the app — an internal coding AI that exposes the code (not a black box) and lets the app evolve its own capabilities on user request.
- **Core principle (the hard-won lesson): the evaluation/validation harness IS the product, not the codegen.** Codegen is the easy 10%; knowing a new capability actually works is the 90%. An in-app AI that can build but can't honestly KILL its own bad ideas = a confident garbage generator (we nearly crowned the eigenvalue and the thesis on vibes).
- **Safe architecture (3 layers):** (1) Core engine — stable, human-reviewed, version-controlled; (2) Generated capability layer — sandboxed primitives/strategies the AI authors freely, each REQUIRED to carry backtest evidence + a kill-switch before promotion; (3) The harness — adversarial automatic validator gating every promotion ("show me the market-neutral forward-return test with the overlap caveat"). No promotion without provenance.
- **Already-present scaffolding pointing this way:** `create-primitive`/`create-strategy` skills + promotion path, parameter sweep, research studio, GitNexus (code-impact analysis = safe-navigation tool for an agent), MCP layer. Path = harden the primitive→strategy→promotion boundary and let an in-app agent operate inside it, harness as gatekeeper.

## Latest Update (2026-05-05)

### Market Intelligence - Social ARB Field Map / Universe Normalization

Social ARB discovery is now being redirected away from hand-picked ticker/watchlist seeding and toward the clean universe as the coordinate system:

- PRD/checklist updated with D30: broad raw intake first, then local clean-universe matching, symbol/source/community baselines, and perturbation ranking by abnormal movement rather than raw mention size.
- Added `backend/scripts/run_universe_mention_normalization.py`.
  - Creates `universe_symbol_mentions`, `universe_symbol_daily_counts`, `universe_symbol_baselines`, and `universe_symbol_perturbations`.
  - Matches `mi_raw_hits` against `backend/data/universe_clean.json` using cashtags, bare tickers, and company/name aliases.
  - Labels StockTwits/Yahoo ticker-board evidence as `ticker_confirmation`; broad/community matches are `organic_discovery`.
  - Builds per-symbol/source/community baselines and scores perturbations.
- First local run: scanned `6,037` raw hits, matched `5,837` clean-universe symbol mentions, refreshed `1,564` daily buckets, wrote `258` baselines, and scored `7` latest-day perturbations.
- Scheduler job added: `universe_mention_normalization`, every 2h at `:28`.
- Added the conservative card-pipeline bridge: `backend/scripts/run_universe_mover_claims.py`.
  - Scheduler job: `universe_mover_claims`, every 2h at `:30`.
  - Converts only strong `universe_symbol_perturbations` into `emerging_claims`.
  - Defaults require `min_mentions=3`, organic discovery, and either `z_score >= 2.5` or `perturbation_score >= 35`.
  - Current real run inserted `0` claims because latest movers are weak/noisy; a lowered-threshold dry run proved the bridge would pick up `TBH`, but production thresholds correctly suppress it.
- Updated `run_narrative_cluster_builder.py` so single-company mover claims cluster per ticker instead of collapsing unrelated symbols into one generic Social ARB cluster.
- API/UI added:
  - `GET /api/market-intelligence/social-arb/universe-movers`
  - Market Intelligence -> Social Arbitrage Engine -> `Normalized Universe Movers` collapsible panel.
- Validation passed:
  - `py -m py_compile backend/scripts/run_universe_mention_normalization.py`
  - `py -m py_compile backend/scripts/run_universe_mover_claims.py backend/scripts/run_narrative_cluster_builder.py`
  - `node --check frontend/public/market-intelligence.js`
  - `npm run build` from `backend/`

### Market Intelligence — Asymmetric Narrative Layer

### Market Intelligence - YouTube Engine v1

YouTube is now documented as a staged engine rather than a single transcript utility:

- PRD decision D31 added: YouTube runs as channel/feed watcher -> transcript collector -> later comments layer -> later bounded search/discovery. It does not attempt whole-YouTube crawling.
- Checklist updated with YouTube engine tasks.
- `collect_youtube_transcripts.py` now skips cleanly when `youtube-watchlist.txt` is empty instead of failing scheduled runs.
- Added `backend/scripts/collect_youtube_channel_feeds.py`.
  - Reads `backend/data/preferences/youtube-channels.json`.
  - Pulls free YouTube RSS feeds by channel id / handle / channel URL.
  - Persists upload metadata as `youtube_video` rows in `mi_raw_hits`.
  - Can optionally hand discovered video URLs to the existing transcript collector with `--fetch-transcripts`.
  - Empty config returns `status:"skipped"` with no error.
- Added operator-managed `backend/data/preferences/youtube-channels.json` with supported channel shapes documented.
- Registered scheduler job `youtube_channel_feed_collector`, every 2h at `:11`.
- Validation:
  - Empty config dry run returns clean skip.
  - Live dry run against Google Developers RSS found 3 recent videos and would write 3 metadata rows.
  - Python compile and backend TypeScript build pass.

The system now supports the intended hunting pipeline:

```text
mi_raw_hits -> emerging_claims -> narrative_clusters -> market_situations
```

**Built and run locally:**
- `backend/scripts/run_narrative_claim_extraction.py` already produced `47` `emerging_claims` from local `mi_raw_hits`.
- Added `backend/scripts/run_narrative_cluster_builder.py`.
  - Groups claims into `narrative_clusters`.
  - Preserves lineage in `narrative_cluster_claims`.
  - Assigns `WATCH`, `RESEARCH`, or `SCENARIO_READY`.
  - Stores deterministic promotion rationale in `metadata_json.promotion_rationale`.
  - Maps specific asymmetric themes to existing `theme_registry` keys while preserving the richer theme in metadata.
- Added `backend/scripts/promote_narrative_clusters.py`.
  - Promotes only mapped, unpromoted `SCENARIO_READY` clusters into `market_situations`.
  - Preserves `claim_ids`, `source_hit_ids`, `source_types`, `source_communities`, and `watch_tickers` in scenario metadata.
  - Writes a `situation_evidence` row and marks the source cluster `PROMOTED`.

**Local DB result:**
- `emerging_claims`: `47`
- `narrative_clusters`: `5`
- `narrative_cluster_claims`: `47`
- Cluster statuses after promotion:
  - `PROMOTED`: `1`
  - `RESEARCH`: `4`
- Promoted scenario:
  - scenario id: `457`
  - slug: `narrative-ai-power-grid-bottleneck`
  - detection path: `mixed_anomaly_led`
  - watch tickers: `CEG`, `ETN`, `GEV`, `NEE`, `PWR`, `SO`, `VST`

**Scheduler wiring added in `backend/src/services/marketIntelligenceScheduler.ts`:**
- `narrative_claim_extraction`
- `narrative_cluster_builder`
- `narrative_cluster_promotion`

**Checklist updated:**
- `.planning/plans/ACTIVE/market-intelligence-checklist.md`
- Phase 1.2 now marks claim extraction, cluster building, promotion bridge, deterministic status transitions, cluster creation, promotion lineage, and `SINGLE_SOURCE_RISK` flagging complete.
- Added Narrative Radar API/UI completion to the checklist:
  - `GET /api/market-intelligence/narrative-clusters`
  - `GET /api/market-intelligence/narrative-clusters/:id`
  - Market Intelligence page now has a collapsible `Narrative Radar` section showing status, narrative summary, claim count, source count/breadth, mapped tickers, flags, and updated date.
  - Local helper smoke test returned 5 clusters; first detail decoded 3 claims with `SINGLE_SOURCE_RISK` and `VERIFY_PRIMARY_SOURCES`.
- Added Ledger narrative cross-check reports:
  - `GET /api/market-intelligence/narrative-clusters/:id/report`
  - Narrative Radar rows now have a `Report` action.
  - Report payload includes `candidate_fundamentals` with `company_type` and `valuation_engine` so Ledger can avoid using DCF for the wrong company types.
  - Local smoke test on cluster `#5` returned `GOOGL`/`IBM` as `dcf_operating` and `IONQ` as `sales_scenario`.

**Still open in Phase 1.2:**
- Completed after the first memory update:
  - `backend/data/scenarios/conviction-templates/asymmetric_narrative.json` added and covered by offline eval.
  - `backend/scripts/collect_youtube_transcripts.py` added with Shorts/watch/youtu.be/video-id normalization, public caption fetch when available, and `--transcript-file` fallback for operator-copied transcripts.
  - `youtube_transcript_collector` registered in the Market Intelligence scheduler.
  - `OPERATOR_SEEDED`, `VERIFY_PRIMARY_SOURCES`, `POLICY_RUMOR_RISK`, and `SINGLE_SOURCE_RISK` now have explicit UI flag tooltips/severity.
- Phase 1.2 in `.planning/plans/ACTIVE/market-intelligence-checklist.md` is now fully checked off.

### Options Flow — Clean-Universe Optionability

Options Flow is now aligned to the canonical clean universe:

- Added `options_symbol_optionability` table in `backend/data/options-flow.sqlite`.
- `backend/data/universe/optionable.json` is now treated as a seed/intersection source, not a master universe.
- Seed result from clean universe:
  - `3272` optionable
  - `986` not-optionable
  - `55` unknown
- Active optionability refresh smoke checked 3 unknown symbols and moved totals to:
  - `3272` optionable
  - `989` not-optionable
  - `52` unknown
- Daily options flow collector now defaults to clean-universe symbols marked optionable.
- Manual `/api/options-flow/run-collect` now also defaults to `optionable-clean` instead of top 100.
- Added `/api/options-flow/optionability` so the app can report clean-universe optionability counts from SQLite.
- Scheduler now has:
  - daily `options_flow_collector` over `optionable-clean`
  - weekly `options_optionability_refresh`
- Two-symbol collection smoke originally added `2026-05-06` snapshots for `A` and `AA`; those smoke rows were removed because the anomaly UI chooses the latest snapshot date.
- `getTopAnomalies()` now defaults to the latest date with at least 20 distinct symbols, so partial/smoke days do not hide the prior usable options-flow dataset.
- Added raw options-chain snapshot storage:
  - `options_contract_snapshot` table in `options-flow.sqlite`
  - stores expiration, option type, strike, contract symbol, bid/ask, last price, volume, open interest, IV, moneyness, and last trade date
  - daily collector now hydrates raw contract rows and aggregate anomaly rows in the same pass
  - `GET /api/options-flow/optionability` includes chain snapshot stats
- Hydration smoke over 5 clean-optionable symbols wrote `1482` raw contract rows for `2026-05-06`.
- `getTopAnomalies()` now requires at least 50 symbols on a date before treating it as the default anomaly date, so partial hydration runs do not hide the prior usable anomaly set.
- Settings > Market Intel now includes the options-chain update engine controls:
  - manual collection status
  - scheduler state for `options_flow_collector` and `options_optionability_refresh`
  - clean-universe optionability counts
  - raw-chain snapshot coverage
  - buttons for daily chain hydration, optionability refresh, manual full optionable-universe hydration, and status refresh
- Live process check showed no `collect_options_flow.py` job running. Backend/Python services are listening, but the running backend still exposes the old scheduler registry (`options_flow_collector` disabled, no `options_optionability_refresh`), so restart backend before expecting the new Settings controls to show live job/coverage data.

### Market Intelligence UI Naming / Control Surfaces

The page now uses the clearer mental model:
- `Theme Performance` = forward-tracking outcomes and per-theme hit-rate/returns
- `Macro Source Monitor` = macro collector/engine scheduler health
- `Social Arbitrage Engine` = listening concepts + emerging-topic controls
- `Listening Concepts` = old tracked-concepts registry surface
- `Intelligence Network Intake` = Social ARB funnel health: raw social hits, matched concept hits, pending/promoted/suppressed emerging topics, cross-platform topics, and active Social ARB cards. Added via `GET /api/market-intelligence/social-arb/audit` and a new Social Arbitrage Engine panel.
- `Promoted Topic Ledger` = maps each promoted emerging topic to its destination scenario card and explains compression. Added via `GET /api/market-intelligence/social-arb/promoted-topics`.
- Current Social ARB compression finding: `34` promoted topics are only `3` unique destination cards (`29` self-hosted/off-cloud, `4` Nvidia/CUDA, `1` OpenAI model releases), with `0` cross-platform confirmations.
- The ledger now groups repeated spike events by concept/card, so the UI shows `3` grouped rows instead of `34` repeated rows. Repeats are represented as pulse counts: self-hosted/off-cloud `29`, Nvidia/CUDA `4`, OpenAI models `1`.
- Social ARB hunting criteria are now explicit in the active plan/checklist and visible in the promoted-spike groups: undercovered tradable exposure, niche adoption, user enthusiasm, specialist/forum evidence, YouTube/ticker implications, real-use/demand/procurement/shortage/pricing/new-customer language, and cross-platform migration. The ledger now includes hunting-fit score, source breadth, real-use hits, ticker/product-specific hits, watch tickers, and hunting flags.
- Pruned 27 noisy/context tracked concepts from active Social ARB listening (`openai_models`, `github_copilot`, `self_hosted_migration`, `nvidia_cuda_moat`, Tesla/Apple/Cloudflare derivative rows, etc.). Active concepts are now 19 core hunting targets. Backup before DB edit: `backend/data/market-intelligence.sqlite.pre-social-arb-prune-20260505-223505.bak`.
- Social ARB promoted-spike ledger and audit now exclude pruned/context concepts by default. Active core promoted spike events/cards are now `0/0`; historical pruned/context groups remain available with `include_pruned=true` (`34` spike events into `3` cards).
- Added the Social Intelligence -> Market Intelligence raw bridge:
  - `backend/scripts/run_social_raw_bridge.py`
  - scheduler job `social_raw_bridge`
  - imports matched StockTwits, Yahoo Finance community, and Reddit rows from `social-intelligence.sqlite` into `market-intelligence.sqlite.mi_raw_hits`
  - matches by active Social ARB concept search terms and `watch_tickers`
  - first live run wrote `1,255` rows: `1,195` StockTwits, `52` Reddit, `8` Yahoo community
  - refreshed `242` concept/day/community buckets
  - current top ticker-indexed Social ARB concepts by 7d mentions: quantum commercialization, consumer product breakout, stablecoin rails, AI compute shortage, robotics automation, tokenization, 24-hour trading, drones/counter-drone, defense AI, and AI drug discovery
- Added candidate-intel fallback for the Social ARB promoted-spike ledger:
  - `social-arb/promoted-topics` returns `candidate_groups` when raw Social ARB evidence exists but no promoted spike groups have matured
  - UI renders those candidates in the promoted-spike table as "candidate intel - baseline warming"
  - first backend smoke returned `16` candidate groups; top candidate was `quantum_computing_commercialization` with `207` 7d mentions, `7` communities, `2` source types, and hunting fit `100`

Files touched:
- `frontend/public/market-intelligence.html`
- `frontend/public/market-intelligence.js`
- `backend/src/routes/marketIntelligence.ts`
- `backend/src/services/marketIntelligenceDb.ts`
- `.planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md`
- `.planning/plans/ACTIVE/market-intelligence-checklist.md`

### GitNexus MCP Config

Codex config had GitNexus enabled, but pointed to:

```toml
command = "C:\\Program Files\\nodejs\\npx.cmd"
args = ["-y", "gitnexus@latest", "mcp"]
```

That launcher failed locally with:

```text
Cannot destructure property 'package' of 'node.target' as it is null.
```

Updated `C:\Users\eod99\.codex\config.toml` to use the working local executable:

```toml
[mcp_servers.gitnexus]
command = "C:\\Users\\eod99\\AppData\\Roaming\\npm\\gitnexus.cmd"
args = ["mcp"]
enabled = true
```

This likely requires a new Codex session to expose MCP resources/tools. In the current session, GitNexus CLI works and the repo index is healthy, but MCP resources were not attached.

---

## Previous Update (2026-04-30)

### Options Flow Intelligence Report — Full Fundamental Integration

The Options Flow Anomaly Engine was significantly enhanced to produce hedge-fund-quality intelligence reports by cross-referencing all available data sources.

**Problem found and fixed:**
- The report endpoint was looking for fundamentals at `fJson.data.snapshot` but the API returns data at `fJson.data`. This meant `fundamentalsData` was always null — the LLM had no fundamentals, risk flags, earnings data, or valuation context. Reports were generic and useless.

**Data pack now includes (backend: `optionsFlow.ts`):**
- Full balance sheet: D/E, current ratio, quick ratio, total cash vs debt, FCF, OCF, cash burn, cash runway
- Quarterly trend (last 3 quarters): revenue, EPS, margins, leverage, cash position
- Earnings execution: beat/miss streaks, average surprise %, full history with actuals vs estimates
- Forward expectations: current & next quarter growth estimates, revenue/earnings growth trajectory
- DCF valuation: fair value, gap %, quality grade, valuation state
- Risk flags with severity, short descriptions, and full detail
- Tags with tone (danger/positive/neutral)
- Status notes, risk notes, hold context, squeeze pressure, days until earnings
- Social buzz with per-platform source breakdown and sample messages
- Company type classification and valuation engine class

**Social Buzz Aggregation (backend: `fundamentals.ts`):**
- Added `getMiRawHitsForSymbol()` — queries `market-intelligence.sqlite` (`mi_raw_hits`) for posts from HN, 4chan, Bluesky, Forums, Discord, Yahoo News, Reuters, AP
- Buzz endpoint now merges ALL available social sources alongside StockTwits, Yahoo Finance, and Reddit
- Dynamic `source_label` lists only sources with actual data

**Sector-Specific Valuation Guidance:**
- The system already classifies companies by type (`reit`, `financial_company`, `preprofit_growth`, `operating_company`) via `getSymbolClassification()` in `symbolCatalog.ts`
- Added `getSectorValuationGuidance()` function that injects sector-appropriate analytical guidance into the LLM prompt:
  - **REITs**: Explains that low current ratio, negative FCF, and low cash are structurally normal. Instructs LLM to use AFFO, dividend coverage, cap rate spreads. Warns that `liquidity_crisis` flags are likely false positives.
  - **Financial companies**: Price/Book, ROE vs cost of equity, NIM, loan quality — not standard DCF.
  - **Pre-profit growth**: Revenue multiples, Rule of 40, cash runway — not earnings-based metrics.
- Prompt instructions explicitly tell the LLM to follow sector guidance and distinguish genuine concerns from false positives caused by sector-blind thresholds.

**Why this matters — the ADC case study:**
- ADC (Agree Realty, REIT) had a 56:1 put/call ratio. The original report called it a "compelling short" citing "liquidity crisis" (current ratio 0.29) and negative FCF.
- Ledger (Financial Analyst workspace) correctly pushed back: for a net lease REIT, current ratio 0.29 is normal, negative FCF reflects property acquisitions, and the company has $504M OCF + $625M commercial paper program.
- The original report was wrong because it applied generic financial distress heuristics to a REIT. The new sector-aware prompt prevents this class of error.

**Frontend enhancements (market-intelligence.js):**
- Report drawer now shows: company type badge, valuation state, quality grade, industry, current ratio, revenue growth, profit margin, FCF, short float, short ratio
- Earnings execution panel: score, beat streak, average surprise
- Forward expectations panel: score, signal, revenue growth QoQ
- Status/risk notes displayed inline
- Tags color-coded by tone (danger=red, positive=green, neutral=gray)
- Social buzz panel: per-source message counts as badges, sample messages with source and sentiment color-coding

**Files modified:**
- `backend/src/routes/optionsFlow.ts` — fundamentals extraction fix, enriched dataPack, sector guidance, rewritten LLM prompt
- `backend/src/routes/fundamentals.ts` — `getMiRawHitsForSymbol()`, aggregated social sources in buzz endpoint
- `frontend/public/market-intelligence.js` — enriched report drawer, social buzz panel, company type badge

**Architecture insight discovered:**
- The `workspace/Financial Analyst Workspace/` contains Ledger's full agent definition: `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `DATA_CONTRACT.md`, plus reference PDFs (Morningstar, CFA) and skills (`dcf-valuation`, `buried-risk-review`, `earnings-quality`, etc.)
- Ledger's `SOUL.md` teaches it to be skeptical of surface metrics and choose the right valuation framework per company type
- The DCF valuation skill explicitly says to choose FCFF/WACC vs FCFE based on company type
- The options flow report engine now has a miniature version of this sector awareness, but Ledger's full workspace remains the authoritative source for deep fundamental analysis

**Related prior work in this conversation:**
- Reddit social intelligence integration into buzz endpoint
- Enable All Jobs button for MI scheduler
- Options flow collector and anomaly detection system
- LLM-driven narrative generation for options reports
- Market Intelligence page live data integration

---

## Previous Status (2026-04-16)

### Repo Hygiene + Scope + Fragility Pass

A focused single-session pass closed the data-leakage half of the standing repo-state recovery plan and exposed the remaining decisions for the user.

**Closed in this session:**

- `.gitignore` extended to cover all currently-leaking classes:
  - `backend/data/*.sqlite` / `*.sqlite-shm` / `*.sqlite-wal` (and `*.db` variants)
  - `backend/data/valuation_regime_*.json`, `valuation_universe_snapshot*.json`
  - `backend/data/app-state.*` / `symbol-catalog.*` / `fundamentals[-_]pit.*`
  - `*.smoke.json` / `*_smoke.json`
  - `.tmp/`, root-level `_tmp_*` / `tmp_*`
- Orphan zero-byte `backend/data/fundamentals_pit.sqlite` (underscore variant) deleted. Canonical filename is hyphen `fundamentals-pit.sqlite`. Some recent one-off command typo'd the name and created the empty file. All in-repo code uses the hyphen variant.
- New npm script `npm run repo:check` (in `backend/`) wraps `check_repo_state.ps1` so the audit is one keystroke.
- `git status` `backend/data` entries dropped from **15 → 3**. The remaining three (`app-reference.md`, `patterns/registry.json`, `patterns/valuation_state_primitive.json`) are intentional new artifacts from the in-flight valuation work, not leakage.

**Still open after this session — these need a user decision, not more code:**

1. **Scope sprawl.** 116 changed files in worktree are real work across **valuation regime + consumer cycle + ledger hydration + analyst skills + workspace templates** — none of which is the contract-hardening / 3rd-issuer Ledger validation that the standing plan said was next. Recommendation in the followup doc is: take a labeled checkpoint commit now, then formally pick one workstream as active and park the rest in `.planning/plans/BACKLOG/`.
2. **OneDrive + multi-GB SQLite.** `fundamentals-pit.sqlite` is **3.87 GB**, `app-state.sqlite` is **615 MB**, both with active WAL files inside the OneDrive sync tree. This is a real corruption vector. Three options ranked by effort are spelled out in the followup doc — minimum viable is to exclude `backend/data/` from OneDrive sync; long-term right answer is to make the data dir env-configurable and move it out of the repo path entirely.
3. **Python/TS contract drift.** Crossing surface keeps widening (executionBridge, pluginServiceClient, ledgerEngines, signalScanner, now symbolCatalog + consumerCycle) with no canonical schema source. Not failing today; should be addressed before the next major interface lands. A one-pager `docs/ts-python-contract-policy.md` is the suggested next step.

**Why this pass matters:**

- The canonical "guardrails" plan (`.planning/plans/ACTIVE/repo-state-recovery-and-guardrails-plan.md`) existed but the worktree was still drifting under it. The hygiene-followups doc is the running operational checklist that the strategic plan needed.
- `check_repo_state.ps1` now reports `backend/data: 3` instead of `15`, so the script's RED score is now a *scope* signal (real work in flight) rather than a *leakage* signal. That's the correct meaning.

**Next-AI handoff:**

- Read `.planning/plans/ACTIVE/repo-hygiene-followups-2026-04-16.md` first
- Resolve Open Issues 1 and 2 with the user before doing more feature work
- Run `cd backend && npm run repo:check` at session start and before any commit

---

## Previous Status



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

## 2026-06-01 - Convergence stack quality-gate rerun

- Reran the re-acceleration convergence backtest with a PIT quality gate:
  - current ratio >= 0.75
  - shareholders' equity / market cap >= 0.10
  - net margin >= -50%
  - FCF margin >= -100%
- The original Rule A still shows large headline returns, but those are dominated by fragile spike/reverse-split style names such as CMCT and DBGI.
- Adding DCF-undervalued produced zero trades; DCF would have blocked the spike names.
- Adding the PIT quality gate reduced the six-month sample from 15 to 3 names and the one-year sample from 11 to 1 name.
- Quality-gated six-month result: -16.7% avg, -17.5% median, -28.2% avg vs SPY.
- Quality-gated one-year result: one survivor, ATRC 2024-04-30, +24.5% vs SPY +14.3%.
- Working conclusion: convergence + re-acceleration is a squeeze/rebound discovery signal, not a certified fundamental long strategy after distress is removed.

## 2026-06-01 - Speculative spike exit backtest

- Added `backend/scripts/run_speculative_spike_backtest.py`.
- It treats Rule A as a trade, not an investment:
  - entry next daily open after signal
  - hold windows 21/63/126 trading days
  - +50/+100/+200 profit ladder
  - 35% trailing stop after +50% runup
  - default -50% initial stop
  - liquidity buckets and split-proxy buckets
- Main 126-day ladder/trail result on all 15 Rule A names:
  - avg +23.4%, median +21.3%, win 80.0%, avg vs SPY +18.5%.
- But the result weakens when made more executable:
  - liquid >= $250k and no split proxy: avg +8.3%, median +11.7%, avg vs SPY -2.0%.
  - liquid >= $1M and no split proxy: avg +7.1%, median +1.7%, avg vs SPY -4.3%.
  - liquid >= $5M and no split proxy: avg -7.6%, median -18.0%, avg vs SPY -18.2%.
- Working conclusion: spike trading may be a tiny event sleeve, but not a core strategy. The edge still appears concentrated in event/split-style names and fragile liquidity.

## 2026-06-01 - Revenue to earnings follow-through

- Added `backend/scripts/run_revenue_to_earnings_followthrough.py`.
- Tested whether Rule A winners were investors front-running future earnings after revenue re-acceleration.
- Result: partial support, not a full explanation.
- Entry net margin already positive was not the edge:
  - 6M avg +12.9%, 1Y avg +7.2%.
- Entry net margin negative/missing did better:
  - 6M avg +55.2%, 1Y avg +777.3% skewed by outliers.
- Future net margin improving >=10pp had strong 6M median:
  - 6M avg +29.7%, median +55.8%, beat SPY 71.4%.
- But front-run confirmation did not explain every big winner:
  - DBGI had no earnings follow-through and still spiked.
  - TXG/SG/VELO showed some future improvement but still lost.
- Working conclusion:
  - revenue re-acceleration is the trigger
  - earnings/margin follow-through is a confirmation path
  - biggest spikes can still be anticipation/squeeze rather than real operating leverage

## 2026-06-01 - Eigen ablation on re-acceleration rule

- Tested dropping `eigen_z >= 2` from Rule A.
- Core no-eigen rule:
  - `range_pos_252d <= 0.10`
  - `revenue_ttm_growth_pct >= 17.7`
- Six-month result:
  - no-eigen: 38 rows / 29 symbols, avg +19.2%, median +9.8%, avg vs SPY +9.6%, beat SPY 50.0%
  - with eigen: 15 rows / 14 symbols, avg +46.8%, median +21.5%, avg vs SPY +38.5%, beat SPY 66.7%
- One-year result:
  - no-eigen: 19 rows / 16 symbols, avg +335.7%, median +18.0%, avg vs SPY +316.3%, beat SPY 52.6%
  - with eigen: 11 rows / 10 symbols, avg +567.3%, median +18.0%, avg vs SPY +550.5%, beat SPY 54.5%
- Working conclusion: eigen is not required; it sharpens/ranks the signal. Core discovery screen should be depressed + revenue re-acceleration, with eigen as an urgency/ranking amplifier.
