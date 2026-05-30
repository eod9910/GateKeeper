# Market Intelligence Scenario Engine - PRD / PDR
**Created:** 2026-04-23  
**Revised:** 2026-04-16 (Rev 4 — Dual-engine architecture: Macro Engine + Social Arbitrage Engine)  
**Status:** PLANNING — schema lock target Phase 0  
**Scope:** Signal-first market intelligence system that turns open-source information into structured scenarios, maps consequences across the market, and intersects those scenarios with the clean universe to surface mispriced opportunities.

---

## Mission

> **Build a Market Intelligence Page that runs two peer detection engines: (1) a Macro Engine that surfaces broad-based scenarios — geopolitical, macro, policy, sector-rotation, commodity — and maps them to the affected industries and stocks; and (2) a Social Arbitrage Engine that finds publicly-traded but institutionally-uncovered companies receiving genuine, organic, grassroots social attention before the institutional class catches on.**

Both engines feed the same scenario object and the same UI. Together they answer the question:

> "What should I be paying attention to right now in the market — broad themes that could reprice large segments, AND specific names where attention is anomalously rising before anyone has noticed?"

### The two engines, side by side

| | Macro Engine | Social Arbitrage Engine |
|---|---|---|
| **Question answered** | "What broad-based situation is forming that will affect large parts of the market?" | "What uncovered single name is receiving anomalous organic attention right now?" |
| **Detection input** | News articles, SEC filings, RSS macro releases, policy statements, consumer-cycle state changes | Per-community comment text z-scored against per-community baselines |
| **Detection mechanism** | Embedding-based clustering + named-entity reconciliation across event sources | Per-(concept, community, day) z-score with seasonality + day-of-week adjustment |
| **Edge thesis** | Be early on understanding consequences and mapping the right exposures (broader, deeper, faster than headline reading) | Be early on noticing organic attention on uncovered names before institutional research catches it |
| **Coverage filter** | Off by default — macro scenarios SHOULD surface mega-covered names like XOM/LMT when geopolitically relevant | On by default — mega-covered names are excluded; the whole point is to find uncovered ones |
| **Authenticity filter** | Not applicable — news sources are pre-vetted | Mandatory — every emerging topic gets an authenticity score; manipulated buzz is suppressed |
| **Closest precedent** | Bridgewater-style scenario research, GS top-of-mind themes, classical macro newsletters | Chris Camillo's TickerTags / "social arbitrage" methodology |

Neither engine is primary. Neither is secondary. They serve different decisions and surface different scenarios. Both ship in MVP.

The information either engine consumes is fully public. The arbitrage is operational: no human and no institutional team systematically does both at the same time.

---

## Decisions Made In This Revision

This revision converts previously vague intent into concrete v1 commitments so Phase 0 schema lock can begin. Each decision is repeated in the relevant downstream section.

| # | Topic | v1 Commitment |
|---|-------|---------------|
| D1 | News / event ingestion | **Macro Engine inputs:** SEC EDGAR filings text (already partially ingested), Yahoo Finance news (already pulled for buzz), free RSS bundle (Reuters Top News, AP, Federal Reserve, EIA, BLS). **Social Arbitrage Engine topic-indexed inputs (per D29):** Hacker News (Algolia API), 4chan `/biz/` + `/g/` (JSON API), Bluesky firehose (AT Protocol), Discord public servers (bot API), niche product forums (RSS/scrape). **Social Arbitrage ticker-indexed inputs (per D28):** existing StockTwits + Yahoo Finance message boards (already in `social_posts_raw`). No paid news APIs in v1. Reddit deferred to Phase 1.7 per D29. |
| D2 | Consequence mapping strategy | Hybrid: hand-curated taxonomy of ~20 macro themes (sector / industry / ticker bands per theme) for first-order, LLM-assist for second-order and long-tail themes, with `rationale` and `source_method` recorded on every `situation_exposure` row. |
| D3 | Conviction layer producer | Templated by scenario `scenario_type`, populated by an LLM call against the assembled evidence + signal pack, validated against the validity-flag rules, cached by `(situation_id, last_signal_change_hash)`. |
| D4 | Scenario clustering method | Embedding-based topic clustering (sentence-transformers, cosine ≥ 0.78) with named-entity reconciliation as the primary key. LLM is used only to **name** clusters, never to decide membership. |
| D5 | `signal_strength` vs `confidence_score` | Orthogonal. `signal_strength` is **magnitude potential** (0–100, calibrated against historical move size for similar `scenario_type`). `confidence_score` is **scenario probability** (0–1, P(scenario plays out within `time_horizon`)). |
| D6 | `time_horizon` schema | Enum: `intraday`, `days`, `weeks`, `months`, `quarters`, `structural`. Drives `expires_at`, sort order, and which technical primitives feed `technical_readiness`. |
| D7 | `crowding_score` definition | Composite (0–1) of: (a) buzz z-score saturation (≥3σ for ≥5 days = 1.0), (b) source breadth into mainstream tier-1 outlets (Reuters/AP/major papers), (c) days since `started_at`, (d) flattening of mention-growth slope. |
| D8 | Lifecycle state thresholds | Numeric thresholds defined in §Scenario Lifecycle. Computed nightly + on every signal write. |
| D9 | Validity flags vs confidence reasons | `validity_flags` is a discrete enum (filterable, machine-readable). `confidence_reasons` is short free-text strings (display-only). Both shown on the card. |
| D10 | Writer architecture | Scheduled job mirroring `socialIntelligenceScheduler.ts`, plus admin `POST /api/market-intelligence/scenarios/recompute` for manual re-runs. |
| D11 | Stock Intelligence page | Does not exist today. PRD treats it as a forward reference; "candidate bridge" UI hook routes to existing Scanner (`index.html`) until the dedicated page is built. |
| D12 | Consumer Cycle relationship | Consumer Cycle output becomes one named **input source** to scenario detection (sector demand classifications feed `event_score` and `affected_sectors`), not a competitor or replacement. |
| D13 | Schema versioning | `schema_version` integer on `market_situations`. Migration policy: additive-only changes auto-upgrade; breaking changes ship a version bump and a backfill script. |
| D14 | LLM cost profile | Soft budget of ≤ 500 LLM calls / scenario / lifetime, ≤ $0.05 / scenario amortized. Caching by content hash. Eval set built in Phase 5. |
| D15 | Backtest corpus | Bootstrapped retroactively in Phase 5 by replaying news + social + price history through the v1 detector against 2022–2025 data, labeling outcomes by forward returns on top-3 exposed names. |
| D16 | Single-company-catalyst priority | `single_company_catalyst` is **promoted into MVP** for the conviction-layer producer (was deferred in Rev 1). Rationale: the closest commercial precedent (Chris Camillo / TickerTags-style social arbitrage) shows single-name consumer catalysts are the highest-edge category, not macro. |
| D17 | "Thesis right, stock wrong" handling | New validity flag `NO_GOOD_EXPRESSION` fires when scenario is real but `composite_rank` of #1 candidate < 50. Surfaces "we believe the trend, but no clean way to play it" cases that should not generate trades. |
| D18 | "Thesis right, timing wrong" handling | New validity flag `THESIS_REAL_EXECUTION_DELAYED` fires when `attention_score ≥ 0.5` AND `market_confirmation_score < 0.2` for ≥ 60 days. Common Camillo failure mode: real trend, market hasn't started repricing, position bleeds. |
| D19 | Consumer-brand signal sources | Phase 6 adds brand-level consumer signals (app store rankings, Google Trends, Amazon review velocity, web traffic proxies) as a new source class, distinct from the macro/RSS/social inputs in v1. |
| D20 | Per-theme performance measurement | Phase 5 ships **Theme Performance**: per-`primary_theme` forward tracking (lead time, hit rate, FP rate, expression-vehicle rate). Themes with consistently poor metrics are pruned or down-weighted. Prevents the "cover everything badly" failure mode. |
| D21 | Detection model — DUAL ENGINE | The system runs **two peer detection engines** that both write to `market_situations` with different `detection_path` values: (1) **Macro Engine** — embedding-based clustering + entity reconciliation over news / filings / RSS / policy / cycle inputs (`detection_path = news_cluster`); (2) **Social Arbitrage Engine** — per-(concept, community, day) z-score over comment universe with seasonality baselines (`detection_path = topic_anomaly`). Scenarios that gain corroborating signal from the other engine become `detection_path = mixed`. Neither engine is primary; they serve different decisions. (See §Detection Logic.) |
| D22 | Coverage tier filter — engine-scoped | Every candidate ticker is bucketed into a `coverage_tier` (`mega_covered`, `well_covered`, `lightly_covered`, `barely_covered`, `untradable`). For **Social Arbitrage** scenarios the same z-score on a `barely_covered` ticker scores higher than on a `mega_covered` ticker, and `mega_covered` is excluded from the default API/UI stream (the whole point is to find uncovered names). For **Macro Engine** scenarios all tiers are visible by default — a geopolitical scenario SHOULD surface XOM, LMT, etc. when relevant. `MEGA_COVERAGE_PENALTY` flag fires only on Social Arbitrage scenarios where all top-3 candidates are mega-covered. (See §Coverage Filter.) |
| D23 | Authenticity layer | Every emerging topic gets an `authenticity_score` (0–1) computed from account-age distribution, posting cadence, cross-platform signature, comment depth, sentiment shape, account quality, mod-flag rate, linguistic similarity, and promoter co-occurrence. `authenticity_score < 0.5` triggers `LIKELY_INAUTHENTIC` and the topic is suppressed from the actionable stream. **Applies only to Social Arbitrage scenarios** — Macro Engine scenarios source from pre-vetted news/filings and don't carry an authenticity score. (See §Authenticity Layer.) |
| D24 | Phase ordering: Social Arb first, Macro second | Both engines are MVP-required and ship together at Phase 4 page launch. **Phase 1 builds the Social Arbitrage Engine first** because it is structurally harder (5 net-new collectors per D29, concept extraction, baselines, z-score, authenticity scoring, coverage filter) and the entire mission rides on whether it can produce signal. **Phase 1.5 builds the Macro Engine second** (news/RSS/EDGAR ingestion, embedding clustering, entity reconciliation) — the building blocks are well-understood and we want Phase 1 results to influence how Macro is tuned. This is an implementation order, not a priority ranking. |
| D28 | Source topology — topic-indexed vs ticker-indexed | The Social Arbitrage Engine has two structurally different community-source classes that play different roles: **topic-indexed sources** (organized by topic/community — Hacker News threads, 4chan boards, Bluesky topic feeds, Discord public servers, niche product forums — where most participants don't know or care that the brand is publicly traded) are the **originating detection signal** and feed the per-(concept, community, day) z-score engine; **ticker-indexed sources** (StockTwits, Yahoo Finance message boards, ticker-tagged Twitter/X) are the **migration/confirmation signal** and feed the cross-platform corroboration check in the Authenticity Layer (D23 S4) and the lifecycle transition `EARLY → DEVELOPING → CONFIRMED`. By the time chatter has migrated to a ticker-indexed space, the institutional class is half-noticed; that migration is itself a signal that the asymmetry is closing. The specific topic-indexed source basket for v1 is defined in D29. |
| D29 | v1 topic-indexed source basket — Reddit deferred | Reddit was originally the load-bearing topic-indexed source (per the prior framing of D24/D28). After Reddit's 2024–2025 Responsible Builder Policy tightening (data-API access requires explicit approval; non-commercial mining requires a ticket; LLM-extraction of comment text is in policy-tense gray zone), **Reddit is deferred to Phase 1.7** as a future-add contingent on either (a) Reddit policy reversal, (b) approval of an enterprise-API ticket, or (c) explicit user decision to operate in the policy gray zone. The v1 topic-indexed basket is **5 source types with no auth/policy obstacles**: (1) **Hacker News** via the Algolia search API (free, public, no auth, no ToS issue) — covers tech/AI/startups/dev tooling; (2) **4chan `/biz/` and `/g/`** via the official 4chan JSON API (free, public, no auth) — covers crypto/micro-caps/contrarian + tech; (3) **Bluesky firehose** via the AT Protocol public endpoints (free, public) — broad chatter, growing user base; (4) **Discord public servers** via the official Discord bot API (free, ToS-allowed for public servers, requires bot account registration and per-server invite) — niche communities (gaming/crypto/finance); (5) **niche product forums** via RSS or HTML scrape of public pages (no API obstacle) — hobby/product verticals (initial seed: 1 audio gear forum, 1 sneaker forum, 1 beauty forum, 1 watches forum, 1 photography forum; specific forums TBD in `tracked-sources.json`). The architecture is source-agnostic per D28, so adding/removing source types is a config-file change, not a code change. |
| D30 | Universe normalization — field map before tickers | The Social Arbitrage Engine must not start from a hand-picked ticker list. All raw evidence is first treated as a broad field observation, then matched locally against the full clean universe (`backend/data/universe_clean.json`) using ticker, company-name, brand, product, and alias matching. The unit of measurement is `(symbol, source_type, source_community, day)`, not "which watchlist did we seed." Every source/symbol pair gets its own baseline so the system ranks **abnormal movement relative to that symbol's normal activity**, not raw mention size. Ticker-indexed sources such as StockTwits/Yahoo can confirm migration, but a ticker-watchlist match alone is labeled confirmation, not organic discovery. |

Implementation status (`2026-05-06`): `backend/scripts/run_universe_mention_normalization.py` creates normalized mention, daily count, baseline, and perturbation tables from `mi_raw_hits`; scheduler job `universe_mention_normalization` runs every two hours; API `GET /api/market-intelligence/social-arb/universe-movers` and the Social ARB "Normalized Universe Movers" panel expose the resulting clean-universe perturbations before they become scenario cards.
| D33 | Eigen perturbation radar - full clean-universe daily scan | The Market Intelligence page also carries a market-structure perturbation engine. After the daily OHLCV refresh, `eigen_perturbation_scan` runs across the full clean universe (`--max-symbols 0`), removes dominant PCA/eigen factors from recent returns, and ranks single-name residual moves by unexplained z-score. This is not a replacement for Macro or Social Arbitrage; it is the "what is bending the geometry?" layer. A stock with abnormal residual movement becomes more interesting when it also has Social ARB migration, unusual options flow, ticker-indexed social buzz confirmation, or a valuation-engine mismatch. The UI surfaces this as **Eigen Perturbation Engine** with latest scan metadata, historical replay expectancy, and overlays for options/social/valuation. Clicking a candidate opens an investigation card where Ledger performs a catalyst hunt using local database evidence first, then checks Social Buzz Confirmation (`social_buzz` + `social_eigen_alignment`) to see whether attention/sentiment is moving with the residual signal, then runs a fail-soft open-web catalyst check for current news, filings, company/IR sources, and public web corroboration before drawing conclusions. Actionable pressure-hit reports are precompiled immediately after a successful scan through `eigen_report_precompiler` and cached under `backend/data/research/eigen-reports/`, so the operator sees a ready investigation card instead of waiting for data gathering and narrative generation. When the Pre-Explosion Pressure Watch list is loaded in the UI, the displayed symbols are also submitted as an exact precompile queue; already-current cached reports are skipped rather than rebuilt. |
| D31 | YouTube engine - staged, free-data first | YouTube is too large to crawl blindly. The v1 engine uses a staged funnel: **channel/feed watcher** (free RSS, no API key) discovers recent uploads from operator-curated channels, persists `youtube_video` metadata rows, and optionally hands URLs to the transcript collector; **transcript collector** stores `youtube_transcript` rows when public captions exist or the operator provides a transcript; **comments ingestion** is a later gated layer for videos whose metadata/transcript passes signal thresholds; **search/discovery** is a later layer using bounded theme queries, not whole-YouTube crawling. YouTube evidence enters the same `mi_raw_hits -> universe normalization -> emerging claims -> narrative clusters -> cards` pipeline as other Social ARB evidence. Empty channel/watchlist configs must skip cleanly, not fail scheduled runs. |
| D32 | Do-not-miss perturbation playbook | The product exists to prevent missed plays, not to display feeds. Treat the two engines as radars over different scales: **Macro Engine = big-world perturbations** (weather, drought, crop disease, commodity supply shocks, oil/gas/refinery disruptions, strikes, ports/rail/shipping chokepoints, wars, sanctions, export bans, rate/liquidity shocks, insurance/catastrophe events) and **Social Arbitrage = micro/social perturbations** (product adoption, niche community enthusiasm, specialist forum/YouTube chatter, buyer/user behavior changes, retail migration into tickers). Every actionable card must answer: what changed, why now, which tradable exposures are first/second-order, what valuation engine says, whether options flow confirms or contradicts it, whether it is early/crowded, and what would invalidate the thesis. |
| D25 | Mission alignment — engine-aware | Each engine's mission alignment is enforced separately. **Social Arbitrage**: scenarios must be uncovered + organic + early; failing any of the three excludes them from the actionable stream. **Macro Engine**: scenarios must be evidence-backed (≥ 2 distinct mainstream sources) and have coherent exposure mapping (≥ 3 first-order rows resolving to ≥ 5 universe symbols); failing pushes them down-rank but never excludes. Mega-coverage is a feature for Macro scenarios, a failure mode only for Social Arbitrage. |
| D26 | Engine naming and labeling | Internal name and external label for each detection path is fixed: `detection_path = news_cluster` is **"Macro Engine"** (UI label "Macro"); `detection_path = topic_anomaly` is **"Social Arbitrage Engine"** (UI label "Social Arb"); `detection_path = mixed` is **"Macro + Social Arb"** with a sub-label indicating which engine seeded it (`mixed_news_led` or `mixed_anomaly_led`). The Social Arbitrage operator surface is labeled **"Social Arbitrage Engine"** and its registry rows are **"Listening Concepts"**. The Macro scheduler/source-health surface is labeled **"Macro Source Monitor"**. Forward-tracking and outcome analytics are labeled **"Theme Performance"**, not "Quality Dashboard". All log lines, telemetry, scoring profiles, and operator UI copy use these names — no other terms. |
| D27 | Dual scoring profile | `scenario_score` is computed under one of two profiles selected by `detection_path`. **Macro profile** (news_cluster, mixed_news_led): `event_score` weight 0.30, `market_confirmation_score` 0.25, `source_breadth_score` 0.20, `attention_score` 0.15 (corroborating only), `novelty_score` 0.10; **no coverage_edge_multiplier and no authenticity_multiplier applied**. **Social Arbitrage profile** (topic_anomaly, mixed_anomaly_led): `attention_score` weight 0.40, `market_confirmation_score` 0.20, `event_score` 0.15 (corroborating), `source_breadth_score` 0.15, `novelty_score` 0.10; `coverage_edge_multiplier` and `authenticity_multiplier` applied. Both profiles share the same `crowding_penalty` and `validity_penalty` deductions. (See §Scoring Framework.) |

---

## Vision

Build a **Market Intelligence Page** that does not behave like a news feed and does not start with a stock. It starts from **scenarios** — patterns the system has noticed in either the world (Macro Engine) or in public conversation (Social Arbitrage Engine).

It should answer:

**Macro Engine questions:**
- What broad-based scenario is forming right now (rates, geopolitics, commodity supply, policy, sector rotation, macro shift)?
- Which industries, sectors, and stocks are first-order and second-order exposed to it?
- Has the market already started pricing it, or is the repricing still ahead of us?
- What would confirm or invalidate the thesis?

**Social Arbitrage Engine questions:**
- What anomalous organic attention is forming on lightly-covered names that institutional research is missing?
- Is the attention authentic (organic grassroots interest) or manufactured (pump, bot activity, coordinated promotion)?
- Which public company is the cleanest expression — and is it actually under-covered enough to still hold an edge?
- What's the time horizon, and what would invalidate the thesis?

The core shift is:

```text
Today (industry standard ticker-first workflow):
  stock -> news/valuation -> chart -> buzz confirmation

Today (what we're replacing in the user's existing workflow):
  buzz screener -> chart -> news -> trade

Target (this PRD — two peer pipelines feeding one page):

  MACRO ENGINE:
    news / filings / RSS / policy / cycle ->
    embedding cluster + entity reconciliation ->
    scenario candidate -> theme taxonomy mapping ->
    sector + ticker exposure -> universe intersection -> ranked candidate

  SOCIAL ARBITRAGE ENGINE:
    comment universe -> per-community z-score -> emerging topic ->
    authenticity gate -> coverage filter -> scenario candidate ->
    topic-to-ticker mapping -> universe intersection -> ranked candidate
```

Both pipelines write to the same `market_situations` table, share the same lifecycle, the same exposure model, and the same UI card shape — just with different `detection_path` and different scoring profiles. The user toggles between "show me macro scenarios", "show me social-arb scenarios", or "show me everything" without leaving the page.

---

## Why This Exists

This page exists to solve two different but related problems:

### 1. Discovery

Find important situations, themes, and securities before they are fully obvious and before they are fully priced.

### 2. Conviction

Help the user stay with the right trade by explaining:

- what scenario is forming
- why it matters
- what the first-order and second-order effects are
- what confirms the thesis
- what invalidates the thesis

The motivating failure mode is not merely "missing a chart breakout."

It is:

- seeing part of the signal,
- entering the trade,
- lacking enough structured understanding to hold it,
- and exiting because the scenario consequences were never made explicit enough to create conviction.

The Market Intelligence Page should reduce that failure mode by turning fuzzy macro or thematic intuition into a concrete scenario model with consequences, evidence, and invalidation rules.

In plain terms, the page should help the user avoid saying:

> "I saw something important starting, but I did not understand it deeply enough to stay in the trade."

---

## What This Product Is

The Market Intelligence Page is an **intelligence system for emerging repricing environments**.

It converts raw inputs such as:

- news and article clusters
- social attention spikes
- sentiment shifts
- niche open-source discussion
- market reaction and cross-asset confirmation
- research papers, blogs, policy notes, and other open-source signals

into **structured scenario cards** with:

- explanation
- evidence
- lifecycle status
- confidence and validity flags
- first-order and second-order consequences
- linked sectors, assets, and tickers
- direct integration with the clean universe

---

## What This Product Is Not

This system is not:

- a headline feed
- a war predictor
- a generic macro dashboard
- a direct trade recommendation engine
- a replacement for valuation, technical analysis, or filing-backed company analysis

It is an upstream discovery engine that helps us decide **what we should be thinking about before the market fully reacts**.

---

## Core Product Thesis

Opportunity appears when three things start aligning before they are fully crowded:

1. **Event reality**
   Something actually changed in the world.
2. **Attention**
   People are beginning to notice, discuss, and amplify it.
3. **Exposure**
   A known set of sectors, business models, and securities are likely to benefit or suffer.

The strongest scenarios are the ones where:

- the event is real enough to matter,
- attention is rising but not fully crowded,
- market reaction is beginning but incomplete,
- and the best exposed names in the clean universe still have attractive valuation and setup quality.

---

## Relationship To Existing Product Surfaces

### Stock Intelligence Page (forward reference)

A dedicated Stock Intelligence Page does **not yet exist** in the product. Today the closest ticker-first workflows are spread across:

- **Scanner** (`frontend/public/index.html`) — pattern + universe screening
- **Workshop** — primitives + indicator studio
- **Copilot** ledger flows — DCF, fundamentals, buzz attached per symbol via `/api/fundamentals/:symbol/*`

When the PRD says "Stock Intelligence Page", treat it as the **eventual** ticker-first surface. Until that page exists, the "candidate bridge" UI hook in §UI Contract routes the user from a Scenario Card to the Scanner with the symbol pre-loaded. (D11)

When the dedicated page ships, the bridge target will switch without API changes.

The ticker-first workflow answers:

> "What is happening with this stock?"

### Market Intelligence Page

The Market Intelligence Page becomes a **signal-first** workflow:

- scenario detection
- evidence synthesis
- exposure mapping
- watchlist generation
- clean-universe ranking

Question answered:

> "What should I be paying attention to, and which stocks best express it?"

These two surfaces should reinforce each other:

```text
Market Intelligence discovers the situation
    ->
ticker-first surface validates the expression vehicle
```

### Consumer Cycle Page (existing)

`frontend/public/consumer-cycle.html` + `backend/src/routes/consumerCycle.ts` already classify sector-level demand state (early-cycle, late-cycle, etc.) with linked symbol lists. This overlaps with scenario "exposure mapping" but at a slower, more structural cadence.

Relationship (D12):

- Consumer Cycle output becomes one **named input source** to the Event and Market Confirmation layers (sector demand classifications feed `affected_sectors` defaults and contribute to `event_score` for cycle-rotation themes).
- The Market Intelligence Page does **not** replace Consumer Cycle. Consumer Cycle answers "where in the long cycle are we?". Market Intelligence answers "what is the *next* repricing event likely to be?".
- A scenario whose `primary_theme` matches a consumer-cycle classification should auto-link the Consumer Cycle page in its evidence panel.

### Other adjacencies

- **Validator / regime universes** (`backend/src/routes/validator.ts`) — feed valuation-regime symbol lists used in candidate ranking.
- **Settings → Social Intelligence** (`frontend/public/settings.html`) — operator surface for the existing social scheduler. Phase 0 will add equivalent controls for the Market Intelligence scheduler in the same Settings page.

---

## Primary User Outcome

The user should be able to open the page and quickly say:

- "This situation looks early."
- "These are the first-order effects."
- "These are the second-order effects."
- "These are the 5-10 names in our universe most exposed to it."
- "Of those, these 2-3 look undervalued, technically constructive, and not yet fully crowded."

That is the end-state workflow.

---

## Core Page Object: Scenario Card

The page is built around **situations**, not articles.

Each card represents a developing market scenario.

### Minimum card fields

| Field | Type | Definition |
|-------|------|------------|
| `title` | string | Human-readable label, ≤ 80 chars |
| `slug` | string | URL-safe stable id |
| `summary` | string | 1–3 sentence pattern explanation, not headline restatement |
| `status` | enum | `EARLY` \| `DEVELOPING` \| `CONFIRMED` \| `CROWDED` \| `FADING` \| `INVALIDATED` |
| `scenario_type` | enum | `macro` \| `geopolitical` \| `commodity` \| `policy` \| `sector_rotation` \| `single_company_catalyst` \| `consumer_cycle` \| `tech_disruption` \| `other` |
| `primary_theme` | enum | Drawn from a registry of ~25 themes (energy, AI infra, semis, defense, healthcare policy, …). Not free text. |
| `signal_strength` | int 0–100 | **Magnitude potential** — calibrated against historical move size for similar `scenario_type`. Independent of probability. (D5) |
| `confidence_score` | float 0–1 | **Probability** the scenario plays out as described within `time_horizon`. (D5) |
| `confidence_level` | enum | `low` \| `medium` \| `high` — display-friendly bucket of `confidence_score` (low <0.4, medium 0.4–0.7, high >0.7) |
| `confidence_reasons` | string[] | Short free-text rationale strings (display only, ≤5 items) |
| `validity_flags` | enum[] | Discrete failure-mode flags — see §Confidence Layer. Filterable. |
| `time_horizon` | enum | `intraday` \| `days` \| `weeks` \| `months` \| `quarters` \| `structural` (D6). Drives `expires_at`. |
| `started_at` | timestamp | First detection |
| `updated_at` | timestamp | Last signal write or rollup recompute |
| `last_confirmed_at` | timestamp | Last write that increased confidence or signal_strength |
| `expires_at` | timestamp | Derived from `time_horizon` (intraday→1d, days→14d, weeks→90d, months→365d, quarters→730d, structural→null). Past-`expires_at` scenarios auto-FADE. |
| `event_score` | float 0–1 | Layer 1 rollup |
| `attention_score` | float 0–1 | Layer 2 rollup |
| `market_confirmation_score` | float 0–1 | Layer 3 rollup |
| `crowding_score` | float 0–1 | See D7 |
| `source_breadth_score` | float 0–1 | Distinct-source count, log-scaled and capped (added v1) |
| `evidence_count` | int | Count of `situation_evidence` rows |
| `first_order_effects` | object[] | `{ asset_or_sector, direction, magnitude_hint, source_method }` |
| `second_order_effects` | object[] | Same shape; explicitly distinguished |
| `affected_sectors` | string[] | GICS sector keys |
| `affected_assets` | object[] | `{ asset_type, asset_key, exposure_direction, exposure_strength }` |
| `top_universe_candidates` | object[] | Top-N from `situation_exposure` ranked by `composite_rank` |
| `detection_path` | enum | `news_cluster` (Macro Engine) \| `topic_anomaly` (Social Arbitrage Engine) \| `mixed_news_led` (Macro-seeded, picked up an anomaly) \| `mixed_anomaly_led` (Social Arb-seeded, picked up news evidence) (D21, D26). Selects the scoring profile (D27). |
| `seeded_emerging_topic_id` | int NULL | FK → `emerging_topics`. Populated for `topic_anomaly` and `mixed_anomaly_led` paths |
| `coverage_tier` | enum | `mega_covered` \| `well_covered` \| `lightly_covered` \| `barely_covered` (D22). Cached from primary candidate's tier; refreshed nightly |
| `authenticity_score` | float 0–1 NULL | Copied from seeding `emerging_topic` (NULL for `news_cluster` and `mixed_news_led`). < 0.5 forces suppression for Social Arbitrage scenarios |
| `peak_z_score` | float NULL | Max z-score observed on the seeding emerging topic (NULL for `news_cluster` and `mixed_news_led`) |
| `cross_platform_corroboration` | bool | True if the seeding emerging topic spiked in ≥ 2 communities (D21 S4); always false for pure `news_cluster` |
| `edge_multiplier` | float | Tier-derived multiplier on `composite_rank` (D22). For Social Arbitrage scoring profile: 1.5 / 1.2 / 1.0 / 0.4 by tier. For Macro scoring profile: always 1.0 (no coverage penalty) |
| `schema_version` | int | (D13) |

### Why `signal_strength` and `confidence_score` are kept orthogonal (D5)

A high-magnitude / low-probability scenario (rare tail event, big move if it happens) and a high-probability / low-magnitude scenario (likely but small repricing) require different position sizing and different validity-flag treatment. Conflating them into one number erases the most useful distinction the page can offer.

Display rule for the card: show `signal_strength` as a 0–100 bar with the magnitude-band label ("small move", "moderate", "large", "tail") and `confidence_level` as a separate three-state pill.

### Example A — Social Arbitrage scenario (Social Arbitrage Engine)

```text
Frame Cosmetics — Drugstore Dupe Discovery Spike
Status: EARLY
Detection Path: topic_anomaly  (Social Arbitrage Engine)
Signal Strength: 72 / 100  (moderate–large move potential)
Confidence: Medium (0.58)
Time Horizon: weeks
Primary Theme: consumer_strength
Coverage Tier: lightly_covered  (edge_multiplier 1.2)
Authenticity Score: 0.81
Peak Z-Score: 4.6  (corroborated across HN beauty thread, beauty-forum #1, beauty Discord server)

Summary:
A skincare/makeup influencer's "drugstore dupe" video drove a 4.6σ spike in mentions of
Frame Cosmetics' new primer product across three independent beauty communities, sustained
over 6 days. Authenticity signals look organic (long-tail account ages, high comment depth,
varied source-types, real disagreement in threads). Mainstream coverage absent.

Universe candidates (top 3 of 5):
- FRMC  composite_rank 82.7  (post-multiplier)  coverage_tier=lightly_covered
- ULTA  composite_rank 41.2  (downstream beneficiary)  coverage_tier=well_covered
- TGT   composite_rank 22.0  (downstream beneficiary)  coverage_tier=mega_covered

Validity flags: [LOW_HISTORY]
Confidence reasons: ["organic spread across 3 subs in 6 days", "no mainstream pickup yet",
                     "no analyst note in last 90d", "authenticity score 0.81"]
```

### Example B — Macro scenario (Macro Engine)

```text
Oil Supply Shock Risk Rising
Status: DEVELOPING
Detection Path: news_cluster  (Macro Engine)
Signal Strength: 78 / 100  (large move potential)
Confidence: Medium (0.62)
Time Horizon: weeks
Primary Theme: energy_supply
Coverage Tier: mega_covered  (no penalty — Macro scoring profile)
Authenticity Score: n/a  (Macro Engine — sources pre-vetted)

Summary:
Multiple news inputs (Reuters, AP, EIA, two SEC 8-Ks) suggest a developing supply-risk regime
in energy. Market reaction has started in crude and defense-linked names, but downstream
sector repricing still appears uneven. Real-people discussion has not yet caught up
(no attached topic anomaly), but breadth across mainstream sources is high.

Universe candidates (top 5 of 12):
- XOM   composite_rank 78.5  (no coverage penalty under Macro profile)
- CVX   composite_rank 76.3
- HAL   composite_rank 71.6
- LMT   composite_rank 68.6  (defense second-order beneficiary)
- DAL   composite_rank 57.2  (airlines second-order, short side)

Validity flags: [LOW_HISTORY]
Confidence reasons: ["5 mainstream sources across 2 source_types",
                     "first-order assets (XOM, crude) confirming move",
                     "second-order (DAL, transports) showing early repricing",
                     "no topic-anomaly corroboration yet — pure Macro scenario"]
```

### Example C — Mixed scenario (cross-engine corroboration)

```text
AI Datacenter Cooling Capex Acceleration
Status: DEVELOPING
Detection Path: mixed_news_led  (Macro Engine seeded; Social Arb attached later)
Signal Strength: 82 / 100  (large move potential)
Confidence: High (0.74)
Time Horizon: months
Primary Theme: ai_capex_acceleration
Coverage Tier: lightly_covered  (cached from primary candidate VRT)
Authenticity Score: 0.79  (from attached emerging topic)
Peak Z-Score: 3.4  (in r/datacenter, attached 4 days after Macro seed)

Summary:
Macro Engine seeded this scenario from clustered news on hyperscaler AI capex disclosures
(NVDA earnings, MSFT/META capex guidance, two EIA datacenter-power notes). Social Arbitrage
Engine attached an emerging topic 4 days later: r/datacenter began discussing liquid-cooling
supply constraints with z=3.4 spike. Both signals now reinforcing.

Universe candidates (top 5 of 8):
- VRT   composite_rank 84.1  (cooling pure-play, lightly_covered)
- ETN   composite_rank 71.2  (power infra, well_covered)
- NVT   composite_rank 65.4  (cooling supplier, lightly_covered)
- AMP   composite_rank 58.0  (datacenter REIT, well_covered)
- DLR   composite_rank 54.1  (datacenter REIT, well_covered)

Validity flags: []
Confidence reasons: ["Macro evidence: 5 sources, 2 source_types",
                     "Social Arb confirmation: z=3.4 in r/datacenter, 4d after Macro seed",
                     "first-order (VRT, ETN) confirming",
                     "cross-engine corroboration adds 0.10 to confidence"]
```

---

## Conviction And Invalidation Framework

Discovery alone is not enough.

For many of the highest-value situations, the real edge is not just getting in early. The real edge is having enough structured reasoning to remain in the trade while uncertainty is still high.

Each scenario should therefore include a dedicated **conviction layer** with the following fields:

- `conviction_level`
- `conviction_summary`
- `confirming_signals`
- `invalidating_signals`
- `key_risks`
- `time_horizon`
- `best_expression_assets`

### What the conviction layer should do

It should answer:

- Why should this scenario matter enough to act on?
- What evidence would make conviction increase?
- What evidence would make conviction decrease?
- What would prove the thesis wrong?
- Which assets or stocks are the cleanest expressions of the scenario?

### Example: geopolitical escalation scenario

```text
Scenario:
Probability of military escalation involving Iran is rising.

Why it matters:
Escalation risk can quickly reprice crude, defense, shipping, inflation expectations,
and downstream sectors such as airlines and transports.

Confirming signals:
- crude breaks out and holds the move
- defense-linked equities show breadth
- shipping / freight stress increases
- source breadth expands across independent channels
- follow-through price action appears in exposed assets

Invalidating signals:
- diplomatic de-escalation with credible follow-through
- crude fails the breakout and reverses
- no confirmation in defense / shipping / related exposures
- attention spike fades without market persistence

Best expressions:
- crude-linked instruments
- energy equities
- defense equities
- selected second-order shorts such as airlines if the setup aligns
```

### Producer (D3)

The conviction layer is **not** populated by hand and is **not** a free LLM monologue. It is produced by a templated pipeline:

```text
1. Assemble the evidence + signal pack for the scenario
   - all situation_evidence rows
   - latest situation_signals rollup
   - current first_order_effects / second_order_effects
   - validity_flags
   - exposure list with direction

2. Render an LLM prompt from a template keyed by `scenario_type`
   - geopolitical, commodity, policy, sector_rotation, etc. each have
     their own prompt template with required output keys
   - templates live in `backend/data/scenarios/conviction-templates/<scenario_type>.md`

3. Call LLM with strict JSON output schema:
   {
     conviction_summary: string (≤ 3 sentences),
     confirming_signals: string[] (3–6 items, each ≤ 12 words),
     invalidating_signals: string[] (3–6 items, each ≤ 12 words),
     key_risks: string[] (2–4 items),
     best_expression_assets: string[]   (must intersect with situation_exposure)
   }

4. Validate LLM output:
   - reject if best_expression_assets contains tickers not in exposure list
   - reject if any field is empty
   - reject if any sentence cites a fact not present in evidence pack
     (semantic-similarity check against evidence text)
   - on rejection: retry once, then mark scenario with validity flag
     CONVICTION_LAYER_UNRELIABLE and ship without it

5. Cache by hash of (situation_id, scenario_type, evidence_pack_hash, exposure_pack_hash)
   - re-runs are free until evidence changes
```

This guarantees the conviction layer cannot drift from the underlying evidence and cannot recommend tickers the system has not actually mapped as exposed. Cost is bounded by the cache: a typical scenario triggers ≤ 3 conviction-layer LLM calls per week. (See §LLM Usage And Cost Profile.)

### Product implication

The page should help the user do three things:

1. detect the situation early
2. understand the consequence chain clearly
3. hold or exit based on explicit confirmation and invalidation logic rather than vague emotion

That conviction framework is a core part of the product, not an optional detail.

---

## Scenario Lifecycle

The page needs lifecycle discipline so situations do not linger forever.

### Proposed states

- `EARLY`
  Weak-to-moderate evidence, rising attention, limited price confirmation
- `DEVELOPING`
  Multi-source evidence with early market consequences beginning to appear
- `CONFIRMED`
  Cross-source evidence plus durable market confirmation
- `CROWDED`
  Theme is now obvious and likely widely discussed / partially priced
- `FADING`
  Evidence persistence and attention are decaying
- `INVALIDATED`
  Follow-up evidence contradicted the scenario

### State transition rules (D8)

Transitions are computed by a deterministic ruleset, run on every signal write **and** on a nightly sweep. Manual override is allowed but logged as a `manual_state_override` audit event.

#### v1 thresholds

| To state | Required conditions (all must hold) |
|----------|-------------------------------------|
| `EARLY` | Default state on creation. `evidence_count` ≥ 2 AND `attention_score` ≥ 0.3. |
| `DEVELOPING` | `evidence_count` ≥ 4 from ≥ 2 distinct `source_type`s AND `attention_score` ≥ 0.5 AND `market_confirmation_score` ≥ 0.2 within last 7 days. **Social Arbitrage shortcut (D28)**: also fires if the seeding emerging topic gains `migration_to_ticker_indexed = true` (chatter has migrated from any v1 topic-indexed source per D29 to StockTwits/Yahoo) — this is independently strong evidence the institutional class is starting to notice. |
| `CONFIRMED` | All `DEVELOPING` conditions AND `market_confirmation_score` ≥ 0.5 sustained across 3 of last 7 days AND `confidence_score` ≥ 0.6. **Social Arbitrage shortcut (D28)**: also fires if `migration_to_ticker_indexed = true` AND `market_confirmation_score` ≥ 0.4 — once chatter has migrated to ticker-aware spaces and price is cooperating, the scenario is no longer "early." |
| `CROWDED` | `crowding_score` ≥ 0.7 (see D7) OR mainstream-tier source coverage on ≥ 3 distinct outlets. |
| `FADING` | Either: (a) `attention_score` has dropped ≥ 50% over 7 days from peak AND `market_confirmation_score` < 0.3, OR (b) `expires_at` reached without re-confirmation. |
| `INVALIDATED` | A signal of `signal_type = invalidating_event` lands AND `confidence_score` drops below 0.3 in same recompute. Or: explicit operator action. |

State machine constraints:

- `INVALIDATED` is terminal — scenario is archived (see §Operational Architecture for archival policy).
- `FADING` can recover to `DEVELOPING` if `attention_score` and `market_confirmation_score` re-cross thresholds.
- `CROWDED` does not auto-FADE; it requires the FADING attention-drop conditions to be met independently.
- A scenario cannot skip from `EARLY` directly to `CONFIRMED`; it must pass through `DEVELOPING` for at least one recompute cycle. This prevents single-spike artifacts.

#### Invalidation UX

When a scenario reaches `INVALIDATED`:

- It is **not** deleted from the UI immediately.
- It moves to a collapsed "Recently invalidated" section in the scenario stream for 7 days, showing: original thesis, what invalidated it, and which exposed names.
- After 7 days it is archived (still queryable via `?include_archived=true` for research).
- Its evidence remains in `situation_evidence` indefinitely for backtest replay.
- If a new scenario with the same `primary_theme` is detected within 30 days, the UI surfaces a "previously invalidated" notice on the new scenario card.

`FADING` scenarios remain visible but visually de-emphasized (lower opacity, sorted to the bottom of the stream).

---

## Intelligence Layers

Each scenario is built from four layers. **Both engines write to all four layers** — the difference is which layer originates the scenario and which layers serve as confirmation. Neither layer is "primary" in the abstract; primacy is engine-dependent.

| Layer | Originating engine | Confirmation role for the other engine |
|---|---|---|
| Event Layer | Macro Engine seeds scenarios from this | Provides confirmation for Social Arbitrage scenarios when news catches up |
| Attention Layer | Social Arbitrage Engine seeds scenarios from this | Provides confirmation for Macro scenarios when real-people discussion appears |
| Market Confirmation Layer | Neither — pure post-detection signal | Confirms both engines' scenarios |
| Fundamental / Valuation Layer | Neither — used at exposure-mapping and ranking time | Used by both engines |

### 1. Event Layer (originates Macro Engine scenarios)

News, filings, RSS, policy releases, and macro data. This is the Macro Engine's seed layer and a confirmation layer for Social Arbitrage scenarios.

#### v1 inputs

| Source | Role | Cadence | Status |
|--------|------|---------|--------|
| SEC EDGAR filings (8-K, 10-K, 13D, S-1, DEF 14A) | Macro seed + Social Arb confirmation | every 30 min | Partial today |
| Yahoo Finance news (per-symbol headlines) | Macro seed + Social Arb confirmation | every 30 min | Partial today |
| Reuters Top News RSS | Macro seed + Social Arb confirmation | every 15 min | New |
| Associated Press Top News RSS | Macro seed + Social Arb confirmation | every 15 min | New |
| Federal Reserve statements / press releases (RSS) | Macro seed | daily | New |
| EIA (energy) weekly reports (RSS) | Macro seed | weekly | New |
| BLS macro releases (RSS) | Macro seed | monthly | New |
| Consumer Cycle classifications | Macro seed (state-change events) | event-driven | Existing |

#### Out of scope for v1 (Event)

- Bloomberg, FT, WSJ, paid news APIs — Phase 5+
- Research paper ingestion — Phase 5+

#### Outputs

- `event_novelty` (jaccard distance against last 90 days of clustered events)
- `source_breadth_score` (distinct mainstream-tier source count, log-scaled, capped)
- `recency_score` (exponential decay, half-life 48h)
- `entity_extraction` (companies, sectors, commodities, countries, policy bodies)
- `theme_classification` (mapped to `primary_theme` registry)
- `importance_score` (composite)
- `attention_event_alignment` (boolean — does an emerging topic from the Social Arbitrage Engine share entities with this event?)

### 2. Attention Layer (originates Social Arbitrage Engine scenarios)

Continuously z-scores public conversation per-community to detect emerging topics before institutional discovery. This is the Social Arbitrage Engine's seed layer and a confirmation layer for Macro scenarios.

#### v1 inputs (5 topic-indexed source types per D29 + existing ticker-indexed)

| Source | Role | Cadence | Status |
|--------|------|---------|--------|
| **Hacker News** posts + comment threads (Algolia API) | Social Arb seed (tech/AI/dev/startups) | every 30 min | New collector |
| **4chan `/biz/` + `/g/`** threads (JSON API) | Social Arb seed (crypto/micro-caps + tech) | every 30 min | New collector |
| **Bluesky firehose** filtered to tracked themes (AT Protocol) | Social Arb seed (broad chatter) | streaming | New collector |
| **Discord public servers** (bot API, ≥ 10 servers per D29) | Social Arb seed (niche communities) | every 30 min | New collector |
| **Niche product forums** (RSS where available, HTML scrape fallback) | Social Arb seed (vertical hobby/product) | every 60 min | New collector |
| Per-community baseline statistics | Social Arb seed | nightly recompute | New job |
| `ticker_buzz_scores` (StockTwits + Yahoo — ticker-indexed migration signal per D28) | Confirmation + lifecycle transition | existing | Existing |
| `ticker_social_daily` (mention counts, breadth, sentiment) | Confirmation | existing | Existing |
| YouTube comments on videos in tracked channels | Social Arb seed | every 60 min | **v1 stretch** |

#### Tracked community groups (v1)

A starting list, expanded by operator. Grouped to make per-community baselines meaningful. The full list lives in `backend/data/scenarios/tracked-sources.json`, with a `community_tier` per community (`niche`, `general`, `mega`) so baselines are computed against population-appropriate norms.

```text
Hacker News:           default frontpage + tag filters (ai, machine-learning, startups, ...)
4chan /biz/:           thread-level (crypto, micro-caps, tickers mentioned)
4chan /g/:             thread-level (tech products, hardware launches)
Bluesky:               topic-feed filters (#tech, #ai, #crypto, #beauty, #gaming, ...)
Discord (public):      audio-gear server, sneakerhead server, indie-gaming server,
                       crypto-research server, beauty/skincare server, ...
Niche forums:          1 audio-gear forum, 1 sneaker forum, 1 beauty forum,
                       1 watches forum, 1 photography forum, 1 PC-build forum, ...
```

#### Out of scope for v1 (Attention)

- **Reddit** — deferred to Phase 1.7 per D29 (policy gating). Re-enable when (a) Reddit policy reverses, (b) enterprise-API ticket approved, or (c) operator decision to operate in policy gray zone
- TikTok comments — Phase 6 (no clean API, scraping fragile, but actually highest-signal venue per Camillo)
- Twitch chat — Phase 6 (specialty venue, gaming/streaming-only)
- Twitter / X — deferred indefinitely (hostile API, expensive)
- Telegram — deferred (compliance + closed communities)

#### Outputs

- `peak_z_score` per emerging topic (D21 S4)
- `cross_platform_corroboration` boolean (≥ 2 communities corroborating same concept)
- `attention_acceleration` (1st derivative of mention velocity)
- `crowding_score` (D7)
- `early_vs_mainstream_ratio` (niche-tier subs + low-coverage outlets vs general/mega subs + tier-1 outlets)
- `unique_authors` (input to authenticity layer)
- `seasonality_adjusted_z` (raw z minus expected seasonal lift)

### 3. Market Confirmation Layer

Is price beginning to react?

#### v1 inputs

All from existing `chart-ohlcv` cache:

- Per-symbol OHLCV via existing chart cache for the affected_assets list
- Sector ETF moves (XLE, XLF, XLI, XLK, XLV, XLP, XLY, XLU, XLB, XLRE, XLC) for sector breadth
- Volatility proxy: 14-day realized vol vs 90-day baseline per affected asset
- Volume z-score per affected asset
- Cross-asset correlations across the affected_assets bundle

#### Outputs

- `market_confirmation_score` (0–1, weighted blend of below)
- `first_order_confirmation` (% of first-order assets moving in expected direction over 5 days)
- `second_order_confirmation` (same for second-order)
- `divergence_signals` (named list of expected-vs-actual mismatches; surfaced as `validity_flags = CONTRADICTORY_REACTION` when severe)

### 4. Fundamental / Valuation Layer

Which securities best express the scenario?

#### v1 inputs (existing infrastructure — no net-new ingestion)

| Input | Source today |
|-------|--------------|
| Clean universe | `backend/data/universe_clean.json` |
| Sector / industry tags | `backend/data/symbol-catalog.sqlite` (`symbols.sector`, `symbols.industry`) — joined at exposure-mapping time |
| DCF gap / fair value | `getSymbolValuationSnapshot()` in `symbolCatalog.ts` |
| Quality / balance-sheet | Filing-backed ledger via `ledgerEngines.ts` |
| Technical readiness | New aggregator (see §Universe Intersection) over existing primitives |
| Buzz support | `ticker_buzz_scores.final_buzz_score` |

#### Outputs

- `candidate_fit_score` (0–1, scenario-specific exposure relevance)
- `valuation_attractiveness` (0–1, scaled DCF gap)
- `implementation_readiness` (0–1, technical setup quality + liquidity)

---

## The Real Signal: Cross-Layer Alignment

No single layer is enough.

A scenario should only become important when the system detects meaningful alignment between:

- **reality**: something changed
- **attention**: people are noticing
- **market reaction**: repricing may be starting
- **universe fit**: there are investable expressions in our stock universe

This is where the page becomes useful.

---

## Authenticity Layer (D23)

The hardest design problem in the entire system and the one that will sink the product if it gets it wrong. A real consumer trend looks identical at the surface to a coordinated pump-and-dump on a microcap. Both produce comment spikes. Differentiating them is the whole game.

The Authenticity Layer scores every emerging topic on a 0–1 axis. `authenticity_score < 0.5` triggers `LIKELY_INAUTHENTIC` and the topic is **suppressed from the actionable stream** (still queryable for research; never recommended).

### Signal table (computed per emerging topic)

| Signal | Phony pattern | Organic pattern | Weight |
|---|---|---|---|
| `account_age_distribution` | Heavy skew to <90-day accounts | Long-tail of established accounts | 0.15 |
| `posting_cadence` | Burst-then-silence; many similar timestamps | Distributed across timezones over weeks | 0.10 |
| `account_history_diversity` | All accounts only post about this one thing | Accounts have varied posting history across topics | 0.10 |
| `cross_platform_signature` | Concentrated in one platform / few communities | Spreads naturally across communities and source-types | 0.15 |
| `comment_depth` | All top-level, no replies, no back-and-forth | Real discussion threads, replies, disagreements | 0.10 |
| `sentiment_shape` | Uniformly positive, scripted | Mixed sentiment with reasoning | 0.05 |
| `account_quality` (per-source quality proxy: HN karma, Discord roles/age, forum post-count, Bluesky handle age, etc.) | Low quality, new accounts, no relevant community history | Established accounts in subject-matter communities | 0.10 |
| `mod_flag_rate` | High removed-comment rate, ban patterns | Normal moderation profile | 0.05 |
| `linguistic_similarity` | Comments cluster suspiciously close in embedding space (LLM-generated or copy-paste) | Linguistic diversity; varied phrasing | 0.10 |
| `promoter_co_occurrence` | Same usernames pushing across multiple "trending" tickers in last 90 days | Each ticker has a different population | 0.10 |

`authenticity_score = sum(signal_value * weight)`, clamped to [0, 1].

Every signal value is normalized 0–1 where 1 = looks fully organic, 0 = looks fully orchestrated. The per-signal value, weight, and an audit note are persisted in `authenticity_signals` so the scoring rules can be iterated without losing history.

### What `LIKELY_INAUTHENTIC` does to the system

| Layer | Behavior |
|---|---|
| `emerging_topics` row | Persisted with `suppression_reason = LIKELY_INAUTHENTIC`; `seeded_situation_id = NULL` |
| `market_situations` row | Not created |
| API default response | Hidden |
| API with `?include_suppressed=true` | Visible, prominently flagged |
| UI default | Hidden from main stream |
| UI "Research" tab | Visible with red authenticity chip + per-signal breakdown |
| Operator override | Operator can manually create a scenario from a suppressed topic; logged + tagged `OPERATOR_OVERRODE_AUTHENTICITY` |

### Why this layer is the architectural insurance policy

TickerTags struggled at hedge funds in part because there was no defense against pump-and-dump signals contaminating the data. Building authenticity scoring as a first-class layer with its own audit trail addresses that head-on. If the layer is wrong (suppresses real signal or admits manipulated signal), we can trace why and tune the weights without rewriting the detector.

Phase 5 backtest will calibrate the weights against known historical pump-and-dump events (replay 2022–2025 data, score retroactively, measure how often `LIKELY_INAUTHENTIC` correctly fired).

### Hard limits (always-fire rules, no scoring required)

Some patterns are so clearly inauthentic that they bypass the weighted scoring and force `authenticity_score = 0`:

- ≥ 80% of mentioning accounts have age < 30 days
- ≥ 50% of mentions occur within a single 4-hour window
- ≥ 70% of mentioning accounts fail the per-source quality threshold (e.g. HN karma < 50, Discord account age < 30 days with no role, forum post-count < 5, Bluesky handle age < 30 days)
- The same username appears as a top mentioner across ≥ 5 "emerging" microcap tickers in the last 90 days

These hard limits are deliberately conservative. Better to suppress real signal occasionally than to surface manipulated signal as actionable.

---

## Coverage Filter (D22)

The system's job is to find **uncovered** companies receiving organic attention. High buzz on AAPL is not actionable — it's already priced. Coverage filter exists to enforce this at the infrastructure level, not as a guideline.

### Coverage tier definition

Computed weekly per-symbol, persisted to `coverage_tiers`.

| Tier | Sellside analysts | Market cap | Mainstream mentions (90d) | Asymmetric edge eligibility |
|---|---|---|---|---|
| `mega_covered` | ≥ 25 | ≥ $200B | ≥ 5/day average | **No** — buzz here is consensus |
| `well_covered` | 10–24 | $20B–$200B | regular | Marginal — buzz must be exceptional |
| `lightly_covered` | 3–9 | $1B–$20B | occasional | **Sweet spot** |
| `barely_covered` | 0–2 | $300M–$1B | rare | **Maximum edge potential** |
| `untradable` | any | < $300M OR avg daily volume < $1M | any | Excluded from candidates |

Composite `coverage_score` (0–100, lower = more uncovered):

```text
coverage_score =
  0.40 * normalize(sellside_analyst_count, log_scale, 0..30)
+ 0.30 * normalize(log10(market_cap_usd), 8..12)
+ 0.20 * normalize(log1p(mainstream_mention_count_90d), 0..6)
+ 0.10 * normalize(institutional_ownership_pct, 0..100)
```

Tier is assigned by `coverage_score` band:

```text
0–20   → barely_covered
20–45  → lightly_covered
45–70  → well_covered
70–100 → mega_covered
```

`untradable` is a separate hard rule (market cap or liquidity floor), not derived from `coverage_score`.

### How coverage filter affects scoring

`composite_rank` is multiplied by a tier-specific edge multiplier:

| Tier | `edge_multiplier` |
|---|---|
| `barely_covered` | 1.5 |
| `lightly_covered` | 1.2 |
| `well_covered` | 1.0 |
| `mega_covered` | 0.4 |
| `untradable` | 0 (filtered out) |

This means a moderate-quality candidate in `barely_covered` will out-rank a strong candidate in `mega_covered`, which is the entire point of the system.

### `MEGA_COVERAGE_PENALTY` validity flag

Fires when **all** top-3 candidates for a scenario are `mega_covered`. The scenario is real but the trade is structurally crowded — equivalent to "everyone already knows." Surfaces in UI with a "no edge" badge.

### Inputs and refresh cadence

| Input | Source | Refresh |
|---|---|---|
| Sellside analyst count | Yahoo Finance recommendation summary scrape | weekly |
| Market cap | Yahoo Finance / existing chart cache | daily |
| Mainstream mention count | Internal — count of tier-1-source `situation_signals` per `entity` over 90d | nightly |
| Institutional ownership | Most recent 13F aggregation | weekly |
| Daily dollar volume | OHLCV cache | daily |

### Why this is non-negotiable for v1

Without the coverage filter, the system will reliably surface "AAPL is being talked about a lot." That's not the product. The product surfaces companies most users haven't heard of yet. Coverage filter is the difference.

---

## Consequence Mapping

This is the most important product feature.

Every scenario must explicitly model:

### First-order effects

Immediate, direct consequences.

Examples:

- oil up
- freight rates up
- cocoa prices up
- datacenter power demand up

### Second-order effects

Where differentiated opportunities are often found.

Examples:

- airlines down
- discount retailers gain share
- grid equipment demand rises
- packaging costs rise
- insurers face new loss pressure

The system must train the user to think in **causal chains**, not headlines.

### Mapping strategy (D2)

Hybrid producer for `first_order_effects` and `second_order_effects`:

#### Tier 1 — hand-curated theme taxonomy (covers ~80% of common scenarios)

Stored in `backend/data/scenarios/theme-taxonomy.json`. v1 ships with ~20 themes:

```text
energy_supply, energy_demand, dollar_strength, rates_higher, rates_lower,
inflation_rising, inflation_falling, china_growth, china_slowdown,
geopolitical_escalation_mideast, geopolitical_escalation_eu,
ai_capex_acceleration, ai_capex_pullback, semis_supply_shock,
healthcare_policy_change, defense_spending_up, consumer_weakness,
consumer_strength, housing_demand_change, commodity_supply_shock_softs
```

Each theme entry contains:

```json
{
  "theme_key": "energy_supply",
  "first_order": [
    { "asset_type": "commodity", "asset_key": "CL", "direction": "up", "magnitude": "large" },
    { "asset_type": "sector", "asset_key": "energy", "direction": "up", "magnitude": "large" }
  ],
  "second_order": [
    { "asset_type": "sector", "asset_key": "transports_airlines", "direction": "down", "magnitude": "moderate" },
    { "asset_type": "sector", "asset_key": "defense", "direction": "up", "magnitude": "moderate" }
  ],
  "ticker_seeds": {
    "energy": ["XOM", "CVX", "COP", "OXY", "EOG", "HAL", "SLB"],
    "defense": ["LMT", "RTX", "NOC", "GD", "LHX"],
    "transports_airlines": ["DAL", "UAL", "AAL", "LUV"]
  }
}
```

When a scenario's `primary_theme` matches a taxonomy entry, the entry's first/second-order effects are inserted into `situation_exposure` rows with `source_method = hand_curated`.

#### Tier 2 — LLM-assist (covers long-tail and novel scenarios)

When `primary_theme` does not match the taxonomy or when the scenario clusters span multiple themes:

- LLM is asked to propose first/second-order effects given the assembled evidence pack
- Strict JSON output schema with bounded enums for `asset_type` and `direction`
- Output is validated: `asset_key` must resolve to either a known sector key, a tracked commodity, or a ticker present in the clean universe
- Rows persisted with `source_method = llm_assist` so they can be filtered or down-weighted in scoring

Each `situation_exposure` row carries:

- `source_method`: `hand_curated` | `llm_assist` | `operator_override`
- `rationale`: short string (taxonomy entry id, or LLM rationale snippet)
- `confidence`: 0–1 (taxonomy entries default to 0.9; LLM-assist gets a confidence-discount factor of 0.6)

#### Why hybrid

Pure taxonomy is rigid and never covers novel themes (e.g. "AI power grid demand surge" before it had a name). Pure LLM is creative but too hallucination-prone for exposure mapping where wrong tickers degrade the entire candidate ranking. The hybrid keeps the high-traffic core deterministic and only spends LLM tokens (and risk) on the tail.

#### Operator override

Any `situation_exposure` row can be overridden by an operator with `source_method = operator_override`. Overrides win over both taxonomy and LLM until cleared. Audit-logged.

---

## Universe Intersection

This is how intelligence turns into execution.

For each scenario we compute:

- directly exposed sectors
- directly exposed industries
- likely beneficiaries
- likely losers
- second-order beneficiaries
- second-order losers

### Sector → universe symbol resolution

`backend/data/universe_clean.json` does **not** carry sector/industry. Resolution is a join against `backend/data/symbol-catalog.sqlite` (`symbols.sector`, `symbols.industry`):

```text
exposure_row(asset_type=sector, asset_key=energy)
   -> SELECT symbol FROM symbols WHERE sector = 'Energy' AND symbol IN clean_universe
   -> intersect with theme_taxonomy.ticker_seeds[energy] (preferred when present)
   -> rank candidates
```

This join is a Phase 2 deliverable and lives in a single helper `resolveExposureToCandidates(situation_id)` so the rest of the system never has to know whether a row came from `universe_clean.json` or the catalog.

### Technical readiness aggregator (new in v1)

The PRD's `technical_readiness` field is a single 0–1 number, but the existing scanner is per-pattern, not per-symbol. v1 introduces a thin aggregator:

```text
technical_readiness(symbol, time_horizon)
  = max(
      score(swing_setup_quality),
      score(pullback_v1_active),
      score(breakout_v1_active),
      score(fade_v1_active when scenario direction is reversal)
    )
  scaled to 0–1 with a recency discount of 0.5 for setups older than time_horizon's
  characteristic window (e.g. 5d for `days`, 30d for `weeks`).
```

The aggregator lives in `backend/src/services/technicalReadiness.ts` and reads the existing primitive/strategy outputs. Symbols with no active setup get `technical_readiness = 0` rather than null.

### Ranking formula

For each symbol that survives the sector join, compute `composite_rank` per §Proposed Scoring Framework. Persist top-N (default N=20) per scenario in `situation_exposure`.

### Candidate example output

```json
[
  {
    "symbol": "CVX",
    "scenario_relevance": 0.89,
    "dcf_gap_pct": 18.4,
    "technical_readiness": 0.73,
    "final_buzz_score": 62.1,
    "crowding_penalty": 0.12,
    "composite_rank": 84.6,
    "exposure_direction": "long",
    "exposure_order": "first",
    "source_method": "hand_curated"
  }
]
```

---

## Confidence Layer

Every scenario must communicate uncertainty clearly.

### Core fields and how they relate (D9)

| Field | Type | Purpose | Producer |
|-------|------|---------|----------|
| `confidence_score` | float 0–1 | Machine-readable probability the scenario plays out within `time_horizon` | Computed from layer rollups + validity_flag penalties |
| `confidence_level` | enum | Display bucket of `confidence_score` (low / medium / high) | Derived |
| `validity_flags` | enum[] | Discrete failure-mode flags. Filterable in API. | Computed by deterministic rules below |
| `confidence_reasons` | string[] | Short free-text rationale strings, display-only | Templated string render of which validity flags fired and which layer scores were strongest/weakest |

`validity_flags` and `confidence_reasons` are **not duplicates**. Flags are for filtering, reasons are for the human reading the card.

### Validity flag triggers

| Flag | Fires when |
|------|------------|
| `LOW_HISTORY` | `evidence_count` < 3 OR scenario age < 24h |
| `ONE_SOURCE_ONLY` | All `situation_signals` rows share the same `source_type` |
| `LOW_PARTICIPATION` | `attention_score` < 0.3 AND scenario age > 48h |
| `NO_MARKET_CONFIRMATION` | `market_confirmation_score` < 0.15 AND scenario age > 72h |
| `CONTRADICTORY_REACTION` | `divergence_signals` non-empty AND ≥ 50% of first-order assets moving opposite to expected direction over last 5 days |
| `HIGH_MAINSTREAM_SATURATION` | ≥ 3 tier-1 mainstream outlets covering the theme |
| `EXPOSURE_MAP_WEAK` | < 3 first-order rows OR all rows have `source_method = llm_assist` AND average confidence < 0.5 |
| `LOW_UNIVERSE_MATCH` | < 5 candidate tickers survived the sector join AND `composite_rank` of #1 < 50 |
| `NO_GOOD_EXPRESSION` | Sector join produced ≥ 5 tickers BUT `composite_rank` of #1 < 50. Scenario is real but no clean expression vehicle exists. (D17) |
| `THESIS_REAL_EXECUTION_DELAYED` | `attention_score ≥ 0.5` AND `market_confirmation_score < 0.2` sustained for ≥ 60 days. The trend is real but the market hasn't started repricing — Camillo-style timing trap. (D18) |
| `STALE` | `updated_at` older than the freshness SLA for the scenario's `time_horizon` (see §Operational Architecture) |
| `CONVICTION_LAYER_UNRELIABLE` | LLM conviction-layer producer rejected output (see §Conviction Producer) |
| `LLM_BUDGET_EXHAUSTED` | Scenario hit 80% of its LLM lifetime budget; further LLM calls suppressed (see §LLM Usage And Cost Profile) |
| `LIKELY_INAUTHENTIC` | (D23) Seeding emerging topic has `authenticity_score < 0.5`. Scenario is forced into suppressed state — never appears in default API/UI streams. Visible only with `?include_suppressed=true`. **Social Arbitrage scenarios only** — Macro scenarios cannot fire this flag. |
| `MEGA_COVERAGE_PENALTY` | (D22) **Social Arbitrage scenarios only** — fires when all top-3 candidates are `mega_covered`. The scenario is real but the trade is structurally crowded — no asymmetric edge for the Social Arbitrage Engine. Heavy `composite_rank` penalty (`edge_multiplier = 0.4`). Macro scenarios never fire this flag because mega-coverage is a feature, not a failure mode, for the Macro Engine. |
| `AUTHENTICITY_BORDERLINE` | (D23) Seeding topic has `authenticity_score` in [0.5, 0.65). Scenario surfaces but with a yellow chip warning the score is borderline. Operator review recommended before sizing. **Social Arbitrage scenarios only.** |
| `OPERATOR_OVERRODE_AUTHENTICITY` | Scenario manually created from a `LIKELY_INAUTHENTIC` topic by operator action. Audit trail for post-mortem. |

Flags are computed every recompute. They contribute a `validity_penalty` to `scenario_score` (see §Proposed Scoring Framework) — each flag subtracts a fixed weight (typically 0.05–0.20 of the total score depending on severity).

Note on engine scoping: most flags fire on either engine, but a few are engine-specific:

- **Social Arbitrage only**: `LIKELY_INAUTHENTIC`, `MEGA_COVERAGE_PENALTY`, `AUTHENTICITY_BORDERLINE`, `OPERATOR_OVERRODE_AUTHENTICITY` (these enforce the Social Arbitrage mission of finding uncovered + organic + early names; they are nonsensical for Macro scenarios)
- **Either engine**: all other flags

Flags are critical to prevent false precision and confident nonsense. The mission-critical flags differ by engine:

- **Social Arbitrage**: `LIKELY_INAUTHENTIC`, `MEGA_COVERAGE_PENALTY`, `THESIS_REAL_EXECUTION_DELAYED` — failing any of these means the scenario is structurally not the engine's edge
- **Macro**: `EXPOSURE_MAP_WEAK`, `LOW_UNIVERSE_MATCH`, `NO_GOOD_EXPRESSION`, `CONTRADICTORY_REACTION` — failing any of these means the scenario lacks the consequence-mapping discipline that is the engine's edge

There is intentionally **no `NEWS_DRIVEN_ONLY` flag** — being news-driven is the entire point of the Macro Engine, not a failure. Use the `detection_path` field directly if you need to filter for "Macro only" or "Social Arb only" stream views.

---

## Backend Data Model

Lives in a new SQLite database: `backend/data/market-intelligence.sqlite` (separate from `social-intelligence.sqlite` and `fundamentals-pit.sqlite`, following the existing per-domain pattern).

The backend centers on four new core entities plus a small registry table.

### `market_situations`

The canonical scenario record.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE | URL-safe stable id, generated from title + date |
| `title` | TEXT | ≤ 80 chars |
| `summary` | TEXT | 1–3 sentence pattern explanation |
| `primary_theme` | TEXT | FK into `theme_registry.theme_key`; required (no free text) |
| `scenario_type` | TEXT | Enum (see Scenario Card) |
| `status` | TEXT | Enum (`EARLY` …) |
| `signal_strength` | INTEGER 0–100 | Magnitude potential (D5) |
| `confidence_score` | REAL 0–1 | Probability (D5) |
| `confidence_level` | TEXT | Derived bucket |
| `time_horizon` | TEXT | Enum (D6) |
| `started_at` | INTEGER (unix s) | |
| `last_confirmed_at` | INTEGER | Last write that increased confidence |
| `last_updated_at` | INTEGER | Last signal/rollup write |
| `expires_at` | INTEGER NULL | Derived from `time_horizon` (intraday→1d, days→14d, weeks→90d, months→365d, quarters→730d, structural→null). Computed at write time, not query time. |
| `event_score` | REAL 0–1 | Layer rollup |
| `attention_score` | REAL 0–1 | Layer rollup |
| `market_confirmation_score` | REAL 0–1 | Layer rollup |
| `crowding_score` | REAL 0–1 | (D7) |
| `source_breadth_score` | REAL 0–1 | Distinct-source count, log-scaled |
| `evidence_count` | INTEGER | Cached row count |
| `first_order_effects_json` | TEXT | Snapshot of first-order rows for fast card render |
| `second_order_effects_json` | TEXT | Same for second-order |
| `validity_flags_json` | TEXT | JSON array of enum strings (filterable via JSON1 or denormalized index) |
| `confidence_reasons_json` | TEXT | JSON array of display strings |
| `conviction_layer_json` | TEXT NULL | Templated LLM output (see §Conviction Producer); null until populated |
| `conviction_pack_hash` | TEXT NULL | Hash of (evidence_pack + exposure_pack); used to invalidate `conviction_layer_json` cache |
| `detection_path` | TEXT | Enum: `topic_anomaly`, `news_cluster`, `mixed` (D21) |
| `seeded_emerging_topic_id` | INTEGER NULL FK → emerging_topics | Populated for `topic_anomaly` and `mixed` paths |
| `coverage_tier` | TEXT | Enum (D22): `mega_covered`, `well_covered`, `lightly_covered`, `barely_covered`. Cached from primary candidate; refreshed nightly |
| `authenticity_score` | REAL NULL | Copied from seeding emerging topic; NULL for pure `news_cluster` scenarios |
| `peak_z_score` | REAL NULL | From seeding emerging topic; NULL for pure `news_cluster` scenarios |
| `cross_platform_corroboration` | INTEGER (0/1) | From seeding emerging topic |
| `edge_multiplier` | REAL | Derived from `coverage_tier` (D22) at write time |
| `metadata_json` | TEXT | Free-form |
| `schema_version` | INTEGER | (D13) |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |
| `archived_at` | INTEGER NULL | Set when invalidated/faded scenario rolls off the active stream |

Indexes: `(status, last_updated_at)`, `(primary_theme, status)`, `(slug)`, `(expires_at)` for the nightly sweep, `(detection_path, status)` to power the engine-aware filter (`engine=macro` and `engine=social_arbitrage`), `(coverage_tier, status)` to power the Social Arbitrage edge-tier filter, `(authenticity_score)` partial index where `authenticity_score IS NOT NULL`.

### `situation_signals`

Normalized inputs that contributed to the scenario.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `situation_id` | INTEGER FK | |
| `signal_type` | TEXT | Enum: `news_event`, `filing_event`, `social_buzz_spike`, `price_confirmation`, `consumer_cycle_state_change`, `invalidating_event`, `policy_release`, `macro_release` |
| `source_type` | TEXT | Enum: `rss_reuters`, `rss_ap`, `rss_fed`, `rss_eia`, `rss_bls`, `yahoo_news`, `sec_edgar`, `stocktwits`, `yahoo_community`, `hackernews`, `fourchan_biz`, `fourchan_g`, `bluesky`, `discord_public`, `forum_audio`, `forum_sneakers`, `forum_beauty`, `forum_watches`, `forum_photo`, `forum_pcbuild`, `consumer_cycle`, `chart_ohlcv`, `operator_manual`. Reddit values (`reddit_wsb`, `reddit_stocks`, `reddit_investing`, `reddit_theme`) reserved for Phase 1.7 per D29. |
| `source_id` | TEXT | Stable id within the source (URL hash, filing accession, post id) |
| `entity` | TEXT NULL | Extracted entity (company, commodity, country) |
| `theme` | TEXT NULL | Extracted theme |
| `score` | REAL 0–1 | Per-signal contribution |
| `weight` | REAL | Multiplier applied at rollup time (defaults: news=1.0, filing=1.2, social=0.6, price=0.8, consumer_cycle=0.9, operator_manual=1.5) |
| `observed_at` | INTEGER | When the signal happened in the world |
| `ingested_at` | INTEGER | When we recorded it |
| `payload_json` | TEXT | Source-specific extra fields |

#### Dedup semantics

A `situation_signals` row is uniquely keyed on `(source_type, source_id)`. Same headline arriving from 3 distinct `source_type` values produces 3 rows (correct — that's the breadth signal). Same headline arriving twice from the same source produces 1 row (UPSERT). Same article republished by 5 RSS aggregators is **collapsed** by URL canonicalization at the collector layer before it reaches `situation_signals`.

Indexes: `(situation_id, observed_at)`, `(source_type, source_id)` UNIQUE.

### `situation_evidence`

Human-readable evidence and machine traceability.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `situation_id` | INTEGER FK | |
| `evidence_type` | TEXT | `article`, `filing`, `social_post_cluster`, `price_chart`, `policy_release`, `consumer_cycle_note` |
| `source_name` | TEXT | Display name (e.g. "Reuters", "SEC 8-K", "Hacker News", "Bluesky #ai", "audiogear-forum") |
| `headline_or_label` | TEXT | |
| `summary` | TEXT | 1–2 sentence summary; for social_post_cluster this is a templated description (e.g. "147 mentions across 3 platforms in last 24h") |
| `url` | TEXT NULL | |
| `published_at` | INTEGER | |
| `importance_score` | REAL 0–1 | |
| `novelty_score` | REAL 0–1 | |
| `signal_id` | INTEGER NULL FK | When evidence was created from a specific signal |
| `payload_json` | TEXT | |

Indexes: `(situation_id, published_at DESC)`.

### `situation_exposure`

How the scenario maps to sectors, assets, and securities.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `situation_id` | INTEGER FK | |
| `asset_type` | TEXT | Enum: `equity`, `sector`, `industry`, `commodity`, `fx`, `rate`, `etf` |
| `asset_key` | TEXT | Sector/industry key, ticker, or commodity symbol |
| `exposure_direction` | TEXT | Enum: `long_beneficiary`, `short_loser`, `volatility_up`, `volatility_down`, `direction_uncertain` |
| `exposure_order` | TEXT | Enum: `first`, `second`, `third` |
| `exposure_strength` | REAL 0–1 | |
| `source_method` | TEXT | Enum: `hand_curated`, `llm_assist`, `operator_override`, `derived` |
| `rationale` | TEXT | Theme taxonomy entry id, or LLM rationale snippet |
| `confidence` | REAL 0–1 | |
| `universe_symbol` | TEXT NULL | Resolved ticker when `asset_type = equity`; null for sector/commodity rows |
| `dcf_gap_pct` | REAL NULL | Snapshot at exposure-write time |
| `quality_score` | REAL NULL | Same |
| `technical_score` | REAL NULL | Same |
| `final_buzz_score` | REAL NULL | Same |
| `composite_rank` | REAL NULL | Computed via §Proposed Scoring Framework |
| `last_ranked_at` | INTEGER | When composite_rank was last computed |
| `payload_json` | TEXT | |

Indexes: `(situation_id, exposure_order, composite_rank DESC)`, `(universe_symbol)`.

### `theme_registry` (new, small)

The closed list of valid `primary_theme` values. Loaded from `backend/data/scenarios/theme-taxonomy.json` at startup; persisted for FK integrity.

| Field | Type | Notes |
|-------|------|-------|
| `theme_key` | TEXT PK | Snake-case stable key |
| `display_name` | TEXT | |
| `category` | TEXT | `macro`, `geopolitical`, `commodity`, `policy`, `sector`, `tech`, `consumer` |
| `taxonomy_version` | INTEGER | Bumps when ticker_seeds or first/second-order rules change |
| `created_at` | INTEGER | |

### `tracked_concepts` (new — D21 topic-anomaly engine)

Growing registry of (concept, target) pairs the system z-scores. New rows are added by the LLM concept extractor when it encounters an unseen pair; an operator can prune or merge them.

The registry is a **living watchlist**, not a static list. It has two layers:

1. **Seed watchlist** - hand-curated frontier themes the operator believes are worth listening for now.
2. **Organic expansion** - concepts proposed by extraction/clustering when repeated unknown phrases, entities, products, or claims appear in raw hits.

Tracking a concept does **not** mean the system believes the thesis. It only means the topic is important enough to monitor. Claims, narrative clusters, exposure mapping, authenticity checks, and Ledger decide whether the topic becomes investable.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `concept_key` | TEXT | Normalized concept string (e.g. `switching_to_bralettes`, `roof_repair_search`) |
| `target_type` | TEXT | Enum: `brand`, `product`, `category`, `behavior`, `keyword`, `event_type` |
| `target_key` | TEXT | e.g. `victorias_secret`, `elf_primer_putty`, `cosmetics_drugstore`, `cancel_subscription` |
| `display_label` | TEXT | Human-readable |
| `created_at` | INTEGER | When first seen by the system |
| `created_by` | TEXT | Enum: `llm_extractor`, `operator`, `seed_taxonomy` |
| `status` | TEXT | Enum: `active`, `proposed`, `merged_into:<id>`, `pruned`, `rejected` |
| `metadata_json` | TEXT | Search terms, watch tickers, rationale, priority, LLM extraction confidence, example mentions |

Indexes: `(concept_key, target_key)` UNIQUE, `(status, created_at)`.

Initial asymmetric narrative seed categories:

- financial tokenization / tokenized equities
- 24-hour equity trading
- stablecoin banking rails
- quantum computing commercialization
- nuclear / SMR power demand
- AI data-center power and grid bottlenecks
- defense AI operating systems
- autonomous drones and counter-drone systems
- robotics and labor automation
- AI drug discovery
- AI-enabled clinical trials
- radiopharma cancer therapy
- precision medicine diagnostics
- gene editing delivery systems
- synthetic biology tools
- critical minerals processing
- water infrastructure / scarcity
- consumer product and brand breakouts

Organic expansion loop:

```text
raw hits
-> repeated unknown phrases/entities/products
-> proposed tracked concept
-> operator review
-> active / merged / rejected
```

Concept maintenance actions:

- `ADD`: create a new concept when evidence repeats across raw hits
- `MERGE`: collapse duplicate fragments into a broader concept
- `PRUNE`: remove stale or low-signal concepts from active monitoring
- `PROMOTE`: increase source coverage for concepts that repeatedly produce useful claims

### `concept_mentions` (new — high-volume, append-only)

Every comment / post text generates 0-N concept_mentions rows. This is the highest-volume table in the system — partitioned by month for retention manageability.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `concept_id` | INTEGER FK → tracked_concepts | |
| `signal_id` | INTEGER FK → situation_signals | The post or comment-thread row this came from |
| `community` | TEXT | Source-specific identifier — e.g. HN tag, 4chan board, Bluesky topic-feed, Discord server slug, forum URL, YouTube channel |
| `community_tier` | TEXT | Enum: `niche`, `general`, `mega` (drives baseline normalization). Tier is set per community in `tracked-sources.json`. |
| `polarity` | INTEGER | -1, 0, +1 |
| `intent` | TEXT | LLM-extracted: `adoption`, `abandonment`, `complaint`, `praise`, `comparison`, `question`, `prediction` |
| `mentioned_at` | INTEGER | |
| `extraction_confidence` | REAL 0–1 | LLM confidence; low confidence excluded from z-score |

Indexes: `(concept_id, mentioned_at)`, `(community, mentioned_at)`, `(signal_id)`.

Retention: 90 days hot, then aggregated into daily counts in `concept_daily_counts` (below) and the per-mention rows are pruned.

### `concept_daily_counts` (new — append-only summary)

Pre-aggregated daily mention counts per (concept, community). What `topic_baselines` and the live z-score reads from.

| Field | Type | Notes |
|-------|------|-------|
| `concept_id` | INTEGER FK | |
| `community` | TEXT | |
| `day` | INTEGER | unix midnight UTC |
| `mention_count` | INTEGER | |
| `unique_authors` | INTEGER | Distinct posting accounts that day (input to authenticity layer) |
| `polarity_mean` | REAL | |
| `intent_mix_json` | TEXT | Counts per intent enum |

PK: `(concept_id, community, day)`.

### `topic_baselines` (new — derived nightly)

Per-(concept, community) baseline statistics with seasonality decomposition.

| Field | Type | Notes |
|-------|------|-------|
| `concept_id` | INTEGER FK | |
| `community` | TEXT | |
| `as_of_day` | INTEGER | When the baseline was computed |
| `rolling_mean_30d` | REAL | |
| `rolling_stdev_30d` | REAL | |
| `dow_multipliers_json` | TEXT | 7-element array, weekday adjustments |
| `monthly_seasonality_json` | TEXT | 12-element array, when ≥ 90 days of data |
| `min_mention_floor` | INTEGER | Absolute floor below which z-scores are suppressed (default 20) |
| `data_days` | INTEGER | How many days of history this baseline was built from |

PK: `(concept_id, community)`. Recomputed nightly; previous baselines retained 30 days for change-point analysis.

### `emerging_topics` (new — the topic-anomaly output)

The output of the z-score engine. A scenario does **not** form until an emerging topic both passes the authenticity gate AND resolves to a coverage-eligible ticker.

| Field | Type | Notes |
|-------|------|-------|
| `id` | INTEGER PK | |
| `concept_id` | INTEGER FK | |
| `seed_community` | TEXT | The community where the anomaly first fired |
| `peak_z_score` | REAL | Max z observed during the topic's life |
| `current_z_score` | REAL | Latest |
| `corroborating_communities_json` | TEXT | Communities where the same concept later spiked (cross-platform corroboration) |
| `cross_platform_corroboration` | BOOLEAN | True if ≥ 2 independent **topic-indexed** communities corroborate (D21 S4, D28) |
| `migration_to_ticker_indexed` | BOOLEAN | True if the mapped ticker showed a buzz spike in StockTwits or Yahoo Finance message boards within 7 days AFTER the topic-indexed anomaly fired (D28) — strongest "institutional class is noticing" signal |
| `migrated_at` | INTEGER NULL | Timestamp when `migration_to_ticker_indexed` first became true; NULL until migration. Used by backtest to measure edge time. |
| `first_anomaly_at` | INTEGER | When `z ≥ 3.0` first crossed |
| `last_anomaly_at` | INTEGER | Most recent `z ≥ 3.0` day |
| `total_mentions` | INTEGER | Sum across the anomaly window |
| `unique_authors` | INTEGER | Distinct authors across the anomaly window |
| `authenticity_score` | REAL 0–1 | Computed by §Authenticity Layer |
| `authenticity_signals_json` | TEXT | Per-signal breakdown (account ages, cross-platform, etc.) |
| `resolved_target_type` | TEXT | `brand`, `product`, `category`, `behavior` |
| `resolved_tickers_json` | TEXT | Array of ticker resolutions with coverage_tier each |
| `seeded_situation_id` | INTEGER NULL FK | The market_situations row this seeded (NULL if suppressed) |
| `suppression_reason` | TEXT NULL | `LIKELY_INAUTHENTIC`, `NO_COVERAGE_ELIGIBLE_TICKERS`, `MEGA_COVERED_ONLY` |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

Indexes: `(authenticity_score, peak_z_score DESC)`, `(seeded_situation_id)`, `(suppression_reason, created_at)`.

### `coverage_tiers` (new — per-symbol filter)

Cached per-symbol coverage classification, refreshed weekly. Drives the asymmetric-edge filter.

| Field | Type | Notes |
|---|---|---|
| `symbol` | TEXT PK | |
| `coverage_tier` | TEXT | Enum (D22): `mega_covered`, `well_covered`, `lightly_covered`, `barely_covered`, `untradable` |
| `sellside_analyst_count` | INTEGER | Count of distinct sellside analysts publishing on the name in last 90 days |
| `market_cap_usd` | REAL | |
| `institutional_ownership_pct` | REAL | From most recent 13F aggregation |
| `mainstream_mention_count_90d` | INTEGER | Count of tier-1 outlet mentions in our news collectors over last 90 days |
| `daily_dollar_volume_avg` | REAL | 30-day average |
| `composite_score` | REAL 0–100 | Lower = more uncovered |
| `as_of` | INTEGER | |

Indexes: `(coverage_tier)`, `(composite_score)`.

### `authenticity_signals` (new — per emerging-topic, write-once)

Audit row for each authenticity decision. Stored separately from `emerging_topics` so we can iterate scoring rules without losing history.

| Field | Type | Notes |
|---|---|---|
| `emerging_topic_id` | INTEGER FK | |
| `as_of` | INTEGER | |
| `signal_type` | TEXT | Enum: see §Authenticity Layer signal table |
| `signal_value` | REAL | Normalized 0–1 |
| `weight` | REAL | Weight in composite |
| `notes` | TEXT | Human-readable explanation for audit |

Indexes: `(emerging_topic_id, as_of)`.

### `brand_to_ticker` (new — small, hand-curated + LLM-extended)

Maps brand keys (used in `tracked_concepts.target_key`) to public-company tickers. Lives in `backend/data/scenarios/brand-to-ticker.json`, loaded at startup.

| Field | Type | Notes |
|---|---|---|
| `brand_key` | TEXT PK | |
| `parent_ticker` | TEXT | Primary public parent |
| `secondary_tickers_json` | TEXT | Suppliers, competitors that also benefit |
| `confidence` | REAL 0–1 | Hand-curated rows = 1.0; LLM-proposed = 0.6 |
| `source_method` | TEXT | `hand_curated`, `llm_assist`, `operator_override` |
| `created_at` | INTEGER | |

### Snapshot vs live consistency

All denormalized rollup fields on `market_situations` (`event_score`, `attention_score`, `market_confirmation_score`, `crowding_score`, `signal_strength`, `confidence_score`, `evidence_count`, `validity_flags_json`, `*_effects_json`) are **snapshot values** updated by the recompute job. They are not computed at GET time. Recompute triggers:

- Every signal/evidence write for the affected `situation_id`
- Nightly sweep of all non-archived scenarios
- Manual `POST /api/market-intelligence/scenarios/:id/recompute`

This avoids GET-time fanout against `situation_signals` while keeping consistency bounded by the recompute lag (≤ a few seconds for write-triggered, ≤ 24h for nightly).

---

## Detection Logic

The system has **two peer detection engines** that both write to `market_situations`. They serve different decisions and surface different scenarios; neither is primary, neither is secondary. (D21, D26)

```text
MACRO ENGINE (detection_path = news_cluster):
  news / filing / RSS / policy / cycle signal →
  embedding cluster + entity reconciliation →
  scenario candidate → theme taxonomy mapping →
  exposure rows → ranked candidates

SOCIAL ARBITRAGE ENGINE (detection_path = topic_anomaly):
  comment universe → per-community z-score → emerging topic →
  authenticity gate → coverage filter → scenario candidate →
  topic-to-ticker mapping → exposure rows → ranked candidates

Cross-engine corroboration: when a Social Arbitrage scenario absorbs
news evidence (or a Macro scenario absorbs a topic anomaly), the row
is upgraded to detection_path = mixed and the scoring profile remains
that of the engine that originally seeded it.
```

The two engines complement each other:

- The **Macro Engine** is the system's broad situational awareness — it ensures the user sees rates, geopolitics, commodity, policy, and sector-rotation scenarios with proper exposure mapping the moment evidence accumulates. Its edge is consequence-mapping speed and breadth, not "knowing the news first."
- The **Social Arbitrage Engine** is the system's anomaly detector for organic attention on uncovered names. Its edge is temporal — discovering a name receiving genuine grassroots attention before institutional research notices.

A scenario seeded by either engine can be upgraded to **`mixed`** when corroborating signal arrives from the other. A Macro scenario about "AI infrastructure capex acceleration" that later picks up a Social Arbitrage anomaly on a small datacenter-cooling supplier becomes a `mixed_news_led` scenario with both signals attached. A Social Arbitrage scenario on "drugstore-dupe makeup primer" that later picks up a beat-the-quarter 8-K filing from the parent company becomes `mixed_anomaly_led`.

### Engine 1 — Macro Engine (D21, D26)

The classical scenario-detection pipeline. Operates on event sources (news, filings, macro releases, policy, consumer-cycle state changes) and clusters them into themes.

#### M1. Continuous event ingestion

Per-source collectors pull at source-appropriate cadence:

| Source | Cadence |
|---|---|
| Reuters Top News RSS | every 15 min |
| Associated Press Top News RSS | every 15 min |
| Yahoo Finance per-symbol news | every 30 min |
| SEC EDGAR filings (8-K, 10-K, 13D, S-1, DEF 14A) | every 30 min |
| Federal Reserve statements / press releases | daily |
| EIA weekly reports | weekly |
| BLS macro releases | monthly |
| Consumer Cycle classification changes | event-driven |

Each event becomes a `situation_signals` row with a `signal_type` from the enum (`news_event`, `filing_event`, `policy_release`, `macro_release`, `consumer_cycle_state_change`).

#### M2. Embedding + entity extraction

Each new event payload is:

1. **Embedded** with `sentence-transformers/all-MiniLM-L6-v2`
2. **Entity-extracted** to identify companies, sectors, commodities, countries, policy bodies (used as the cluster-membership reconciliation key, NOT for cluster decisions on their own)

#### M3. Cluster matching

A new event is matched against existing open Macro scenarios (`status` in `EARLY|DEVELOPING|CONFIRMED`, age ≤ 30 days) when:

- cosine similarity ≥ **0.78** AND
- ≥ 1 shared named entity

If no match → create a new `market_situations` row with `detection_path = "news_cluster"`. If match → attach the signal as evidence and recompute. (Threshold tuning is a Phase 5 backtest deliverable.)

LLM is used **only to name** clusters and propose `primary_theme` mapping. LLM never decides cluster membership. (D4)

#### M4. Theme + exposure mapping

The new scenario's `primary_theme` is matched against `theme-taxonomy.json` (~20 hand-curated themes — see §Consequence Mapping). On match, taxonomy-defined first/second-order effects are inserted as `situation_exposure` rows with `source_method = hand_curated`. On miss (long-tail scenario), LLM-assist proposes effects with `source_method = llm_assist`.

#### M5. Cross-engine corroboration check

When a Social Arbitrage emerging topic shares ≥ 1 entity (or a brand-mapped ticker) with an open Macro scenario, the Macro scenario is upgraded to `detection_path = mixed_news_led`. The attention signal then contributes to that scenario's `attention_score`. This is the Macro Engine's "hey, real people are also talking about this" channel.

### Engine 2 — Social Arbitrage Engine (D21, D26)

The Camillo-style topic anomaly engine. Operates on the comment universe and detects genuine, organic, grassroots attention shifts before mainstream coverage forms.

#### S1. Continuous comment ingestion

Per-platform collectors pull both **posts** and **comment threads** at platform-appropriate cadence (D29):

- Hacker News: new posts on tracked tags + top comments via Algolia API — every 30 min
- 4chan `/biz/` + `/g/`: new threads + replies via JSON API — every 30 min
- Bluesky: streaming firehose filtered to tracked theme hashtags via AT Protocol — continuous (batched persist every 5 min)
- Discord (public servers): new messages in tracked channels via bot API — every 30 min
- Niche forums: new threads + replies via RSS where available, HTML scrape fallback — every 60 min
- YouTube (v1 stretch): new comments on videos in tracked channels — every 60 min
- Reddit (Phase 1.7 future-add per D29): out of v1 scope

Each post and each comment-thread aggregate becomes a `situation_signals` row. Comment threads are first-class signal, not metadata.

#### S2. Concept extraction

For each new comment/post text, an LLM extracts (concept, target, intent) tuples and writes them to `concept_mentions`:

| Field | Example |
|---|---|
| `concept` | "switching to bralettes" |
| `target` | brand:victorias_secret |
| `intent` | abandonment |
| `polarity` | -1 |
| `community` | bluesky:#fashion |
| `mentioned_at` | 2026-04-15T22:14:00Z |

`tracked_concepts` is a **growing registry**: when LLM extracts a (concept, target) pair that doesn't exist yet, it gets added with a `created_at` timestamp. This lets the system discover new things to track without operator intervention, while the registry itself is auditable.

#### S3. Per-community baselines (with seasonality)

A nightly job computes, for every (concept, community) pair seen in the last 365 days:

- 30-day rolling mean mention rate
- 30-day rolling stdev
- 7-day-of-week multipliers (some communities are weekday-heavy)
- 12-month seasonality decomposition for concepts present > 90 days

Stored in `topic_baselines`. This is what makes z-scores meaningful — a spike in a beauty Discord at noon Tuesday is different from one at 3am Sunday, and roof-repair searches always spike in spring.

#### S4. Z-score anomaly detection

For each (concept, community, day):

```text
z = (today_mention_count - baseline_mean) / baseline_stdev
   adjusted by seasonality + day-of-week multipliers
```

When `z ≥ 3.0` AND the anomaly persists ≥ 24h AND mention count crosses an absolute floor (≥ 20 mentions to suppress single-thread artifacts), an `emerging_topics` row is created.

When the **same concept** spikes simultaneously (within 7 days) in **≥ 2 independent communities**, the emerging topic gets a `cross_platform_corroboration = true` flag — this is a much stronger signal than a single-community spike.

**Topic-indexed vs ticker-indexed corroboration** (D28). Cross-platform corroboration distinguishes two source classes:

- **Topic-indexed sources** (HN, 4chan, Bluesky, Discord public, niche forums per D29 — organized by topic/community): the originating detection signal. A concept spiking in ≥ 2 topic-indexed communities (e.g., a beauty Discord AND a beauty forum) sets `cross_platform_corroboration = true` and contributes to `attention_score` directly. Cross-source-type spread (e.g., HN + Bluesky) counts as stronger corroboration than two communities of the same source-type.
- **Ticker-indexed sources** (StockTwits, Yahoo Finance message boards, ticker-tagged Twitter/X — organized by ticker, where participants already know the brand is publicly traded): the migration/confirmation signal. When a concept's mapped ticker shows a buzz spike in a ticker-indexed source 1–7 days AFTER a topic-indexed spike, the emerging topic gets a `migration_to_ticker_indexed = true` flag. This is the strongest "the institutional class is starting to notice" signal we have, and it triggers the lifecycle transition `EARLY → DEVELOPING → CONFIRMED`. By the time chatter has fully migrated to ticker-indexed spaces, the asymmetry is closing — a `migrated_at` timestamp on the emerging topic supports backtesting "how much edge time did we have."

#### S5. Authenticity gate (see §Authenticity Layer)

Before an emerging topic is allowed to seed a scenario, it must pass `authenticity_score ≥ 0.5`. Topics below this threshold are persisted (research value) but tagged `LIKELY_INAUTHENTIC` and excluded from the actionable stream.

#### S6. Topic → ticker mapping

The `target` field on `concept_mentions` is the bridge:

- If `target` is `brand:X` → resolve to the public parent company via `brand_to_ticker.json`
- If `target` is `product:X` → resolve via product catalog → parent company
- If `target` is `category:X` → resolve to category-leader candidates via the theme taxonomy
- If `target` is `behavior:X` (e.g. "stopped using credit cards") → LLM-assist proposes affected sectors

Resolved tickers must pass the **coverage filter** (see §Coverage Filter) — for Social Arbitrage scenarios, `mega_covered` tickers are excluded from the actionable stream because they violate the engine's "uncovered" mission. The same emerging topic might map to 3 candidate companies; the system creates one scenario per (emerging_topic, primary_ticker) pair.

#### S7. Scenario candidate creation

A `market_situations` row is created with:

- `detection_path = "topic_anomaly"`
- Reference to the seeding `emerging_topic_id`
- `coverage_tier` of the primary candidate copied for fast filtering
- `authenticity_score` copied from the emerging topic
- Standard lifecycle starts at `EARLY`

#### S8. Cross-engine corroboration check

When the seeding emerging topic shares ≥ 1 entity with an open Macro scenario, the Social Arbitrage scenario is upgraded to `detection_path = mixed_anomaly_led` and the news evidence is attached. This is the Social Arbitrage Engine's "the news is starting to confirm what real people noticed first" channel.

### Cross-engine interaction

The same `market_situations` row supports either origin, distinguished only by `detection_path`:

- `news_cluster` — seeded by Macro Engine; uses Macro scoring profile (D27)
- `topic_anomaly` — seeded by Social Arbitrage Engine; uses Social Arbitrage scoring profile (D27)
- `mixed_news_led` — seeded by Macro Engine, later absorbed a topic anomaly; keeps Macro scoring profile but `attention_score` now contributes meaningfully
- `mixed_anomaly_led` — seeded by Social Arbitrage Engine, later absorbed news evidence; keeps Social Arbitrage scoring profile but `event_score` and `source_breadth_score` now contribute meaningfully

The distinction matters because the **scoring profile follows the seeding engine** (D27). A scenario about XOM that started as a news cluster (Macro Engine) does NOT get punished by the coverage filter when a Hacker News post later mentions it. A scenario about FRMC that started as a topic anomaly (Social Arbitrage) does NOT lose its coverage-tier edge multiplier just because a 10-K filing later corroborates it.

### End-to-end pipeline

```text
MACRO ENGINE PATH:
1.  Ingest news + filings + RSS + macro releases (M1).
2.  Embed + extract entities (M2) → embeddings + entity sets.
3.  Cluster matching against open Macro scenarios (M3) →
    new market_situations row (detection_path=news_cluster) OR
    attach to existing.
4.  Theme + exposure mapping (M4) → situation_exposure rows.
5.  Cross-engine check (M5) — upgrade to mixed_news_led if a topic anomaly attaches.

SOCIAL ARBITRAGE ENGINE PATH:
6.  Ingest comments + posts (S1) → situation_signals rows.
7.  Concept extraction on comments (S2) → concept_mentions rows.
8.  Nightly baseline rebuild (S3) → topic_baselines.
9.  Continuous z-score (S4) → emerging_topics.
10. Authenticity gate (S5) — pass = continue, fail = persist + suppress.
11. Topic → ticker resolution (S6).
12. Coverage filter (D22) — drop mega_covered candidates from
    actionable stream (Social Arbitrage scenarios only).
13. Create market_situations row (S7, detection_path=topic_anomaly).
14. Cross-engine check (S8) — upgrade to mixed_anomaly_led if news evidence attaches.

SHARED PIPELINE (both engines feed):
15. Score using profile selected by detection_path (D27).
16. Compute lifecycle state, validity flags.
17. Persist only scenarios crossing the quality threshold
    (scenario_score ≥ 30); below threshold = stays in pending_scenarios
    for ≥ 1 more recompute.
```

---

## Proposed Scoring Framework

Three orthogonal numbers per scenario:

| Number | Range | Meaning | Used for |
|--------|-------|---------|----------|
| `signal_strength` | 0–100 | **Magnitude potential** — how big the repricing could be (D5) | Sort + UI bar |
| `confidence_score` | 0–1 | **Probability** the scenario plays out within `time_horizon` (D5) | Sort + UI pill, drives `confidence_level` |
| `scenario_score` | 0–100 | **Surfacing rank** — used for sorting the scenario stream | Stream order, `min_signal_strength` filter is applied separately |

### Scenario-level surfacing score (D27 — dual profile)

`scenario_score` is computed under one of **two scoring profiles** selected by `detection_path`. Both profiles share the same `crowding_penalty` and `validity_penalty` deductions, but they weight the layer rollups differently and apply edge/authenticity multipliers only where they make sense.

#### Macro Engine profile — `detection_path ∈ {news_cluster, mixed_news_led}`

```text
scenario_score =
  ( 0.30 * event_score +                  # PRIMARY layer for this engine
    0.25 * market_confirmation_score +
    0.20 * source_breadth_score +
    0.15 * attention_score +              # CORROBORATING (only on mixed_news_led)
    0.10 * novelty_score )
  - crowding_penalty
  - validity_penalty
```

No `coverage_edge_multiplier` and no `authenticity_multiplier` are applied. A Macro scenario about energy supply correctly surfaces XOM and CVX (mega_covered) without penalty — that IS the Macro Engine's job.

#### Social Arbitrage Engine profile — `detection_path ∈ {topic_anomaly, mixed_anomaly_led}`

```text
scenario_score =
  ( 0.40 * attention_score +              # PRIMARY layer for this engine
    0.20 * market_confirmation_score +
    0.15 * event_score +                  # CORROBORATING (only on mixed_anomaly_led)
    0.15 * source_breadth_score +
    0.10 * novelty_score )
  * coverage_edge_multiplier              # (D22) — 1.5 / 1.2 / 1.0 / 0.4 by tier
  * authenticity_multiplier               # (D23) — see below
  - crowding_penalty
  - validity_penalty
```

This is the Camillo-style profile — coverage tier and authenticity gate the score because the engine's mission is uncovered + organic + early. A high-attention scenario on a mega-covered name correctly scores low (the user already knows AAPL is being discussed; that's not the edge).

(Both profile results scaled to 0–100.)

#### Cross-engine corroboration bonus

When `detection_path` upgrades from a single-engine value to a `mixed_*` value, the scenario receives a +0.10 bonus to `confidence_score` (capped at 1.0). The scoring profile does not change — the originating engine's profile is preserved — but `confidence_score` reflects the additional corroboration.

#### `attention_score` derivation

For Social Arbitrage scenarios (D21 S4):

```text
attention_score = clamp(0, 1,
    0.50 * normalize(peak_z_score, range=[2.0, 6.0]) +
    0.20 * (1.0 if cross_platform_corroboration else 0.0) +
    0.15 * normalize(unique_authors, range=[20, 500]) +
    0.10 * normalize(attention_acceleration, range=[0, 0.5]) +
    0.05 * (1.0 if early_vs_mainstream_ratio > 2.0 else 0.5)
)
```

For Macro scenarios with no attached emerging topic, `attention_score` falls back to the legacy buzz-z-score blend (mention velocity from `ticker_buzz_scores` over the affected_assets list). For Macro scenarios with an attached emerging topic (`mixed_news_led`), the topic-anomaly attention_score is used instead — the news-led profile then weights it at 0.15 to reflect that it's confirming, not driving.

#### `coverage_edge_multiplier` (D22 — Social Arbitrage profile only)

Applied **after** the weighted sum, before penalties. Not applied to Macro scenarios.

| Coverage tier | Multiplier (Social Arbitrage profile) |
|---|---|
| `barely_covered` | 1.5 |
| `lightly_covered` | 1.2 |
| `well_covered` | 1.0 |
| `mega_covered` | 0.4 |
| `untradable` | scenario filtered out entirely |

This is what makes a moderate `barely_covered` candidate beat a strong `mega_covered` candidate **inside the Social Arbitrage stream**.

#### `authenticity_multiplier` (D23 — Social Arbitrage profile only)

Not applied to Macro scenarios (which have no `authenticity_score`).

| `authenticity_score` band | Multiplier (Social Arbitrage profile) |
|---|---|
| ≥ 0.80 | 1.0 |
| 0.65–0.80 | 0.85 |
| 0.50–0.65 | 0.65 (also fires `AUTHENTICITY_BORDERLINE`) |
| < 0.50 | 0.0 (forces `LIKELY_INAUTHENTIC` and suppression) |

### Magnitude potential (signal_strength)

Computed independently from the surfacing score, calibrated against historical move size for similar `scenario_type`:

```text
signal_strength =
  base_magnitude_for_scenario_type    (lookup table, 0–100)
  * source_breadth_score              (broader breadth → larger eventual move)
  * (1 + 0.5 * abs(market_confirmation_score - 0.5) * 2)
                                      (price already moving large → upgrade)
  capped at 100
```

`base_magnitude_for_scenario_type` lookup (v1, replaceable post-backtest):

| scenario_type | base |
|---------------|------|
| `geopolitical` | 70 |
| `commodity` | 60 |
| `policy` | 65 |
| `macro` | 55 |
| `sector_rotation` | 50 |
| `tech_disruption` | 45 |
| `consumer_cycle` | 40 |
| `single_company_catalyst` | 35 |
| `other` | 30 |

### Probability (confidence_score)

```text
confidence_score =
  0.40 * source_breadth_score
+ 0.30 * market_confirmation_score
+ 0.20 * (1 - novelty_penalty_for_unprecedented_themes)
+ 0.10 * conviction_layer_consistency_score
- sum(validity_flag_severity_weights)
clamped to [0, 1]
```

`validity_flag_severity_weights` (v1):

| Flag | Weight |
|------|--------|
| `LOW_HISTORY` | 0.05 |
| `ONE_SOURCE_ONLY` | 0.15 |
| `LOW_PARTICIPATION` | 0.10 |
| `NO_MARKET_CONFIRMATION` | 0.15 |
| `CONTRADICTORY_REACTION` | 0.20 |
| `HIGH_MAINSTREAM_SATURATION` | 0.05 (this hurts edge but not validity) |
| `EXPOSURE_MAP_WEAK` | 0.10 |
| `LOW_UNIVERSE_MATCH` | 0.05 |
| `NO_GOOD_EXPRESSION` | 0.10 (hurts confidence in the trade, not the thesis) |
| `THESIS_REAL_EXECUTION_DELAYED` | 0.15 (heavy — timing failure is a common loss mode) |
| `STALE` | 0.10 |
| `CONVICTION_LAYER_UNRELIABLE` | 0.10 |
| `LLM_BUDGET_EXHAUSTED` | 0.05 |
| `LIKELY_INAUTHENTIC` | n/a — handled via `authenticity_multiplier = 0` (forces score to 0); Social Arbitrage scenarios only; not summed |
| `AUTHENTICITY_BORDERLINE` | n/a — handled via `authenticity_multiplier = 0.65`; Social Arbitrage scenarios only; not summed |
| `MEGA_COVERAGE_PENALTY` | n/a — handled via `coverage_edge_multiplier = 0.4`; Social Arbitrage scenarios only; not summed |
| `OPERATOR_OVERRODE_AUTHENTICITY` | 0.05 (audit-only signal; small reminder that operator override is in play) |

`validity_penalty` (used in `scenario_score`) is the same sum, scaled by 30 to operate on the 0–100 scale.

Note on `NO_GOOD_EXPRESSION`: this flag is design-positive — a high-confidence scenario with no clean expression vehicle should still be **visible** (research value) but should **not** be ranked alongside actionable scenarios. The penalty is moderate so it pushes the row down, not off the page.

Note on `THESIS_REAL_EXECUTION_DELAYED`: this is one of the highest-cost failure modes from the social-arbitrage precedent (right thesis, wrong timing, position bleeds). The penalty is heavier than most flags by design.

### Candidate-level rank within a scenario

```text
candidate_rank =
  0.30 * scenario_relevance +
  0.25 * valuation_score +
  0.15 * quality_score +
  0.15 * technical_readiness +
  0.10 * buzz_support +
  0.05 * liquidity_score
  - crowding_penalty
```

(Result scaled to 0–100, persisted in `situation_exposure.composite_rank`.)

### Calibration commitment

These weights and the `base_magnitude` table are explicitly placeholders. Phase 5 backtest (see §Backtest And Corpus Bootstrap) will produce per-`scenario_type` recalibrations. Until that backtest exists, **the scenario stream is sortable but unscored** in the strict sense — the UI must treat low-confidence rankings honestly (e.g. show "Calibration in progress" badge through Phase 4).

---

## Data Sources And Reuse Of Existing Assets

### Reused (no net-new ingestion)

| Capability | Existing artifact |
|------------|-------------------|
| Social buzz aggregation | `backend/data/social-intelligence.sqlite` + `socialIntelligenceScheduler.ts` |
| Buzz z-score / final buzz score | `ticker_buzz_scores` table |
| Clean universe | `backend/data/universe_clean.json` + `build_clean_universe.py` |
| Sector / industry tags | `backend/data/symbol-catalog.sqlite` (`symbols.sector`, `symbols.industry`) |
| DCF / valuation outputs | `getSymbolValuationSnapshot()`; underlying batch in `build_universe_valuation_snapshot.py` |
| Technical setup primitives | `backend/services/plugins/*` + scanner endpoints |
| Filing-backed company quality | `ledger_hydration.py` + `ledgerEngines.ts` |
| Consumer-cycle classifications | `consumerCycleService` |
| OHLCV cache for confirmation layer | Existing chart cache via `/api/chart/ohlcv` |

### Net-new ingestion — Phase 1 (Social Arbitrage Engine)

**Topic-indexed sources (originating detection, D28 + D29):**
- **Hacker News collector** (Algolia API) — posts + comment threads across tracked tags
- **4chan collector** (JSON API) — `/biz/` and `/g/` thread + reply ingestion
- **Bluesky collector** (AT Protocol firehose) — filtered to tracked theme hashtags, batched persist
- **Discord collector** (bot API) — public-server messages across ≥ 10 tracked servers (one bot account, multiple invites)
- **Niche forum collector** (RSS where available, HTML scrape fallback) — ≥ 6 tracked forums
- Per-community baseline statistics generator (nightly)

**Ticker-indexed sources (migration/confirmation, D28) — adapter work over existing ingestion:**
- StockTwits stream — already ingested via `collect_social_intraday.py` → `social_posts_raw`. Need adapter to feed the `migration_to_ticker_indexed` check.
- Yahoo Finance message boards (Spot.im) — already ingested via `fundamentalsService.py`. Same adapter path.

**Reddit (Phase 1.7 future-add per D29) — out of scope for v1.**

### Net-new ingestion — Phase 1.5 (Macro Engine)

- SEC EDGAR filings-as-events extractor
- Yahoo Finance per-symbol news collector
- RSS collectors: Reuters Top, AP Top, Federal Reserve, EIA, BLS
- Sector ETF and volatility helpers for the Market Confirmation layer (thin wrappers over existing OHLCV cache, used by both engines)

### Net-new processing capabilities

- **Concept extraction LLM worker** (D21 S2 — Social Arbitrage cost driver)
- **Per-(concept, community) baseline + seasonality engine** (D21 S3)
- **Z-score anomaly detector** (D21 S4)
- **Authenticity Layer scorer** with all 10 weighted signals + hard-limit rules (D23)
- **Coverage-tier classifier** (D22) — weekly job over the universe; multiplier applied only under Social Arbitrage scoring profile (D27)
- **Topic-to-ticker resolver** (D21 S6) — uses `brand_to_ticker.json`, product catalog, and theme taxonomy
- News scenario embedding + clustering (D21 M2–M3 — Macro Engine)
- **Cross-engine corroboration logic** (D21 M5, S8) — entity-overlap matching to upgrade `detection_path` to `mixed_news_led` or `mixed_anomaly_led`
- Cross-source evidence normalization (used by both engines)
- Causal consequence mapping (hand-curated taxonomy + LLM-assist) — primarily Macro Engine, also used for Social Arbitrage second-order beneficiaries
- Sector → universe symbol resolver (used by both engines)
- Technical readiness aggregator (used by both engines)
- Conviction layer LLM producer with caching + validation
- **Dual scoring profile** scoring/recompute job (D27) — selects Macro vs Social Arbitrage profile based on `detection_path`; coverage and authenticity multipliers apply only to Social Arbitrage profile
- Lifecycle state machine (engine-agnostic)

---

## API Shape

All routes mounted under `/api/market-intelligence/`.

### Read endpoints

#### `GET /scenarios`

Returns ranked scenarios for the page.

Query params:

- `status` — comma-list, default = `EARLY,DEVELOPING,CONFIRMED`
- `theme` — single theme key
- `scenario_type` — single enum
- `time_horizon` — single enum
- `engine` — enum (D26): `macro` | `social_arbitrage` | `both` (default). High-level filter mapped to `detection_path`:
  - `macro` → `detection_path ∈ {news_cluster, mixed_news_led}`
  - `social_arbitrage` → `detection_path ∈ {topic_anomaly, mixed_anomaly_led}`
  - `both` → all four `detection_path` values, no filter
- `detection_path` — comma-list. Lower-level filter; if specified overrides `engine`. No default-exclusion of any value (D27).
- `coverage_tier` — comma-list. **Default depends on which engine(s) are in scope:**
  - When `engine = social_arbitrage` (or `detection_path` filters to Social Arbitrage values only): default = `barely_covered,lightly_covered,well_covered`. `mega_covered` excluded by default for Social Arbitrage (D22, D25).
  - When `engine = macro` or `engine = both`: default = all four tiers visible. Mega-covered names are visible by default for Macro scenarios.
  - Pass `coverage_tier` explicitly to override either default.
- `min_authenticity_score` — float 0–1, default 0.65. Applied **only to Social Arbitrage scenarios** — Macro scenarios have no authenticity score and are unaffected. Pass 0.0 to see borderline Social Arbitrage rows.
- `min_signal_strength` — int 0–100
- `min_confidence` — float 0–1
- `min_peak_z` — float (filters Social Arbitrage scenarios by minimum peak z-score; ignored for Macro scenarios)
- `cross_platform_only` — boolean (only show Social Arbitrage scenarios with `cross_platform_corroboration = true`)
- `only_early` — boolean (shorthand for `status=EARLY`)
- `include_archived` — boolean, default false
- `include_invalidated` — boolean, default false (on by default for the "Recently invalidated" section in UI)
- `include_suppressed` — boolean, default false. Required to see `LIKELY_INAUTHENTIC` rows (research mode only)
- `limit` — int, default 50

Default response (no query params): both engines visible. Within each engine, sensible defaults apply (Social Arbitrage filters out mega-coverage and low-authenticity rows; Macro shows all coverage tiers). The user sees both engines' top output side by side without configuration.

Response (per row):

```json
{
  "id": 123,
  "slug": "frame-cosmetics-dupe-spike-2026-04",
  "title": "Frame Cosmetics — Drugstore Dupe Discovery Spike",
  "summary": "...",
  "status": "EARLY",
  "scenario_type": "single_company_catalyst",
  "primary_theme": "consumer_strength",
  "detection_path": "topic_anomaly",
  "seeded_emerging_topic_id": 4421,
  "coverage_tier": "lightly_covered",
  "edge_multiplier": 1.2,
  "authenticity_score": 0.81,
  "peak_z_score": 4.6,
  "cross_platform_corroboration": true,
  "signal_strength": 72,
  "confidence_score": 0.58,
  "confidence_level": "medium",
  "time_horizon": "weeks",
  "scenario_score": 79,
  "started_at": 1735689600,
  "last_updated_at": 1735776000,
  "expires_at": 1743462000,
  "evidence_count": 14,
  "validity_flags": ["LOW_HISTORY"],
  "top_universe_candidates": [
    {
      "symbol": "FRMC",
      "composite_rank": 82.7,
      "coverage_tier": "lightly_covered",
      "exposure_direction": "long_beneficiary"
    }
  ],
  "freshness_seconds": 142,
  "schema_version": 1
}
```

`freshness_seconds` is `now - last_updated_at` and lets the UI badge stale rows without doing math client-side.

#### `GET /scenarios/:id_or_slug`

Returns full scenario detail:

- everything from the list response
- full `first_order_effects` and `second_order_effects` arrays
- `confidence_reasons`
- `conviction_layer` (when present)
- `affected_sectors`, `affected_assets`
- `evidence_timeline` (array of `situation_evidence`, sorted desc)
- `consequence_map` (graph form for UI rendering)
- `exposure_list` (full `situation_exposure` rows)
- `top_universe_candidates` (already computed, capped at 20)

#### `GET /scenarios/:id_or_slug/candidates`

Returns investable names with full per-candidate detail:

- `exposure_rationale`, `source_method`, `confidence`
- valuation fields: `dcf_gap_pct`, `valuation_score`
- technical fields: `technical_readiness`, active primitive list
- social fields: `final_buzz_score`, `buzz_zscore`, `mention_velocity`
- `composite_rank`, `last_ranked_at`

#### `GET /scenarios/:id_or_slug/evidence`

Pagination-friendly evidence timeline (separate endpoint so detail call stays small).

#### `GET /themes`

Returns the `theme_registry` rows for client-side filter UI.

#### `GET /emerging-topics`

Returns currently-active emerging topics from the z-score engine (D21). Includes both topics that did and did not seed scenarios. Powers the "raw topic stream" debug/research view.

Query params:

- `min_z` — float, default 3.0
- `min_authenticity` — float 0–1, default 0.5
- `cross_platform_only` — boolean
- `community` — single community key (filters to topics seeded in this community)
- `concept_target_type` — enum (`brand`, `product`, `category`, `behavior`)
- `seeded_only` — boolean (only show topics that resulted in a `market_situations` row)
- `include_suppressed` — boolean
- `limit` — int, default 100

Response (per row):

```json
{
  "id": 4421,
  "concept": { "id": 89, "concept_key": "frame_primer_dupe", "target_type": "brand", "target_key": "frame_cosmetics", "display_label": "Frame Cosmetics primer dupe" },
  "seed_community": "r/MakeupAddiction",
  "peak_z_score": 4.6,
  "current_z_score": 3.8,
  "cross_platform_corroboration": true,
  "corroborating_communities": ["r/SkincareAddiction", "r/PanPorn"],
  "first_anomaly_at": 1735689600,
  "last_anomaly_at": 1735776000,
  "total_mentions": 312,
  "unique_authors": 218,
  "authenticity_score": 0.81,
  "resolved_target_type": "brand",
  "resolved_tickers": [
    { "symbol": "FRMC", "coverage_tier": "lightly_covered", "confidence": 1.0, "source_method": "hand_curated" }
  ],
  "seeded_situation_id": 123,
  "suppression_reason": null
}
```

#### `GET /emerging-topics/:id/authenticity`

Returns the per-signal breakdown for one emerging topic's authenticity score (D23). Used by the UI's authenticity-detail panel and operator review workflow.

```json
{
  "emerging_topic_id": 4421,
  "authenticity_score": 0.81,
  "computed_at": 1735776000,
  "signals": [
    { "type": "account_age_distribution", "value": 0.78, "weight": 0.15, "notes": "Median age 412 days; long tail to 2014 accounts" },
    { "type": "cross_platform_signature", "value": 0.92, "weight": 0.15, "notes": "Spread to r/SkincareAddiction within 36h" }
  ],
  "hard_limits_triggered": []
}
```

#### `GET /coverage-tiers/:symbol`

Returns the cached coverage tier classification for a symbol with full inputs (D22).

```json
{
  "symbol": "FRMC",
  "coverage_tier": "lightly_covered",
  "composite_score": 32.1,
  "sellside_analyst_count": 4,
  "market_cap_usd": 2400000000,
  "institutional_ownership_pct": 38.2,
  "mainstream_mention_count_90d": 7,
  "daily_dollar_volume_avg": 14200000,
  "as_of": 1735689600
}
```

#### `GET /healthcheck`

Returns scheduler status, last-run timestamps for each collector, and counts of scenarios per state. Mirrors the pattern of the existing social-intelligence settings page.

### Write / admin endpoints

#### `POST /scenarios/:id_or_slug/recompute`

Triggers a synchronous rollup recompute for one scenario. Returns the recomputed row.

#### `POST /recompute-all`

Triggers a background full sweep. Returns 202 + a job id.

#### `POST /scenarios/:id_or_slug/state`

Operator state override. Body: `{ status: "INVALIDATED", reason: "..." }`. Logged to a `state_audit` table.

#### `POST /scenarios/:id_or_slug/exposure`

Operator-added or overridden exposure row (`source_method = operator_override`).

#### `POST /collectors/:source_type/run`

Manually triggers a single collector. Returns 202 + run summary.

#### `POST /emerging-topics/:id/recompute-authenticity`

Re-runs the §Authenticity Layer scoring for one emerging topic. Used after weight tuning or when an operator suspects a stale score. Persists a new `authenticity_signals` audit row.

#### `POST /emerging-topics/:id/promote`

Operator action: forces creation of a `market_situations` row from a topic that was suppressed (`LIKELY_INAUTHENTIC` or `MEGA_COVERED_ONLY` or `NO_COVERAGE_ELIGIBLE_TICKERS`). The created scenario is tagged with `validity_flags = ["OPERATOR_OVERRODE_AUTHENTICITY"]` (or equivalent). Logged to audit table with operator id + reason.

#### `POST /coverage-tiers/recompute`

Triggers a full coverage-tier recompute across the universe. Returns 202 + job id. Default schedule is weekly; this endpoint exists for ad-hoc refresh after universe changes.

#### `POST /tracked-concepts/:id/status`

Operator can mark a concept as `pruned` or `merged_into:<id>`. Pruned concepts stop generating concept_mentions on next collector run. Merged concepts redirect future mentions to the canonical concept_id.

### Scheduler control endpoints

These mirror `/api/social-intelligence/*` patterns:

- `GET /settings`
- `PUT /settings`
- `GET /scheduler/status`
- `POST /scheduler/config`
- `POST /scheduler/jobs/:name/run`
- `POST /scheduler/jobs/:name/enable`
- `POST /scheduler/jobs/:name/disable`
- `POST /scheduler/start`
- `POST /scheduler/stop`

---

## UI Contract

Page lives at `frontend/public/market-intelligence.html` + `market-intelligence.js`.

The UI stays focused on **situations**, not content feeds.

Top-of-page control surfaces use fixed engine-aware labels:
- **Theme Performance**: forward-tracking outcomes and per-theme hit-rate/return analytics.
- **Macro Source Monitor**: scheduler/source health for Macro Engine collectors and pipeline jobs (`macro_*`, `embedding_pipeline`, `macro_clustering`, `cluster_naming`, `cross_engine_corroboration`, `consumer_cycle_adapter`).
- **Social Arbitrage Engine**: listening-concept registry controls plus emerging-topic promote/suppress actions.

### Page layout

The page is built around **two equal columns / two side-by-side panels**, one per engine, with shared global filters above them. Both columns are visible by default; the user can collapse either to focus on one engine.

1. **Top summary strip** (above the engine panels — global)
   - **Top Macro Scenarios**: top 3 by `scenario_score` where `engine = macro` AND `status ∈ {EARLY, DEVELOPING}` — the broad-based scenario stream's headline output
   - **Top Social Arbitrage Scenarios**: top 3 by `scenario_score` where `engine = social_arbitrage` AND `status = EARLY` AND `coverage_tier ∈ {barely_covered, lightly_covered}` AND `authenticity_score ≥ 0.65` — the asymmetric-edge headline output
   - **Macro counts**: count of Macro `EARLY` / `DEVELOPING` / `CROWDED`
   - **Social Arb counts**: count of Social Arb `EARLY` / `DEVELOPING` + count of `LIKELY_INAUTHENTIC` suppressions in last 24h (small text)
   - **Live anomaly count** (Social Arb): count of `emerging_topics` from last 24h with `peak_z_score ≥ 3.0` AND `authenticity_score ≥ 0.5`
   - **Cross-engine corroborations** (mixed): count of scenarios with `detection_path ∈ {mixed_news_led, mixed_anomaly_led}` updated in last 7d — these are the highest-confidence rows on the page
   - **Recently invalidated** (global): count + collapsible drawer of last 7d invalidations across both engines

2. **Main scenario stream — dual-panel layout**

   **Engine view selector** (top of the stream):
   - `Both` (default — shows both panels side by side)
   - `Macro Only` — collapses Social Arb panel
   - `Social Arb Only` — collapses Macro panel
   - `Mixed Only` — shows only `detection_path ∈ {mixed_news_led, mixed_anomaly_led}` rows in a single column

   **Macro panel** (left column when `Both`):
   - Header: "Macro Engine — broad-based scenarios"
   - Cards ranked by `scenario_score` desc within each status band, then by `last_updated_at` desc
   - Status filter tabs: `EARLY`, `DEVELOPING`, `CONFIRMED`, `CROWDED`, `FADING`
   - Coverage filter chip group: all four tiers visible by default (mega-covered NOT excluded)
   - Theme filter dropdown (from `GET /themes`)
   - No authenticity slider (Macro scenarios have no authenticity score)

   **Social Arbitrage panel** (right column when `Both`):
   - Header: "Social Arbitrage Engine — uncovered names with organic attention spikes"
   - Cards ranked by `scenario_score` desc within each status band, then by `last_updated_at` desc
   - Status filter tabs: `EARLY`, `DEVELOPING`, `CONFIRMED`, `CROWDED`, `FADING`
   - Coverage filter chip group: default excludes `mega_covered` (D22 mission alignment)
   - Theme filter dropdown (from `GET /themes`)
   - **Authenticity slider**: minimum `authenticity_score` floor (default 0.65)
   - **Min peak z-score slider** (default 3.0)
   - **Cross-platform-only toggle**

   **Global filters** (above both panels): `time_horizon`, `min_signal_strength`, `min_confidence`, `include_invalidated`, `include_archived`. "Calibration in progress" banner when `confidence_score` calibration is unverified (Phase 0–4).

3. **Scenario detail drawer / page**
   - **Engine badge** at top: "Macro Engine" / "Social Arbitrage Engine" / "Macro + Social Arb (news-led)" / "Macro + Social Arb (anomaly-led)" — color-coded per engine (Macro = blue, Social Arb = green, mixed = purple gradient)
   - **Coverage-tier chip** with hover detail showing analyst count, market cap, mainstream mentions, institutional ownership. Visually de-emphasized (neutral) for Macro scenarios; color-coded for Social Arbitrage scenarios per coverage rules.
   - **Authenticity panel** (Social Arb / `mixed_anomaly_led` only) — overall score + 10-signal breakdown + audit trail (when authenticity has been recomputed). Hidden for Macro / `mixed_news_led` scenarios.
   - Evidence timeline (paginated) — both engines populate this; rows from each engine visually distinguished by source-type icon
   - Consequence chain (visual: first-order row, second-order row, edges from event to first-order, first-order to second-order)
   - Affected sectors / assets (chips)
   - Conviction layer (when present): summary, confirming, invalidating, key risks
   - Validity flags (visible chips with hover explanations)
   - Confidence reasons (display strings) — explicitly call out cross-engine corroboration when `detection_path` is mixed
   - Clean-universe candidates table (sortable, exportable, **coverage_tier per row**)

4. **Candidate bridge**
   - Per-ticker action: "Open in Scanner" → routes to `index.html?symbol={ticker}`
   - Until the dedicated Stock Intelligence Page exists (D11), this is the bridge target. The route helper is `routeToTickerSurface(symbol)` so the destination can change without touching every card.

5. **Research tab** (separate route — `market-intelligence.html#research`)
   - Suppressed `LIKELY_INAUTHENTIC` topics with full per-signal explanation
   - Currently-active `emerging_topics` that haven't seeded scenarios yet
   - Tracked-concept registry browser
   - Operator action surface: prune/merge concepts, promote suppressed topics

### Card visual rules

- `signal_strength` rendered as a horizontal bar with magnitude band label
- `confidence_level` rendered as a separate three-state pill (low/medium/high) — never combined with strength
- **Engine badge** rendered top-left of every card. Macro = blue, Social Arb = green, mixed = purple. No engine is visually de-emphasized — both are first-class.
- **Coverage-tier chip** rendered top-right:
  - On **Social Arbitrage** cards, color-coded: `barely_covered` = green, `lightly_covered` = teal, `well_covered` = neutral, `mega_covered` = red ("no edge under social arb")
  - On **Macro** cards, neutral chip with tooltip — coverage tier is informational, not a quality signal
- **Authenticity chip** (Social Arb / `mixed_anomaly_led` only) — green ≥ 0.80, yellow 0.65–0.80, orange 0.50–0.65 (`AUTHENTICITY_BORDERLINE`), red < 0.50 (`LIKELY_INAUTHENTIC`, only visible with `?include_suppressed=true`). Hidden on Macro / `mixed_news_led` cards.
- **Peak z-score** rendered as a small subtitle on Social Arb / `mixed_anomaly_led` cards (e.g., "z=4.6, cross-platform")
- **Source breadth** rendered as a small subtitle on Macro / `mixed_news_led` cards (e.g., "5 sources / 3 source_types")
- **Cross-engine corroboration ribbon**: `mixed_*` cards get a small ribbon ("⇆ corroborated by other engine") top-right
- Validity flags rendered as small chips above the candidate list
- `freshness_seconds` > freshness SLA → row dims and shows a "stale" badge
- `crowding_score` ≥ 0.7 → "crowded" warning chip (per D7)
- `source_method = llm_assist` rows on the consequence chain visually distinguished from `hand_curated`

### Core card design principles

- explain the pattern, not the headline
- show evidence without overwhelming the user
- distinguish strong-but-early from strong-but-crowded
- make second-order effects visually explicit
- make uncertainty visible
- never render a number more precise than the underlying signal supports

### Operator surface

Settings page (`settings.html`) gains a "Market Intelligence" panel mirroring the existing "Social Intelligence" panel:

- collector schedule controls (per `source_type`)
- last-run timestamps
- pause/resume scheduler
- manual recompute / collector run buttons
- LLM call budget displays (per-scenario + platform-level concept-extraction daily cost)
- **Tracked-concept registry browser** — list, filter, prune, merge concepts; see per-concept mention totals over time
- **Emerging-topic queue** — review currently-active topics; promote suppressed ones with audit reason; manually re-run authenticity scoring
- **Coverage-tier overrides** — operator can set a `coverage_tier_override` per symbol when the automatic classification is wrong (rare; logged)
- **Authenticity-weight tuner** (Phase 5+) — adjust the 10 signal weights and re-run scoring on the recent topic backlog to compare outcomes

---

## Operational Architecture

### Writer architecture (D10)

A scheduled job mirroring `socialIntelligenceScheduler.ts`:

```text
backend/src/services/marketIntelligenceScheduler.ts
  ├── runs cron timetable per `source_type`:
  │
  │  SOCIAL ARBITRAGE ENGINE (Phase 1) — D29 source basket (Reddit deferred)
  │     hackernews_collector  → every 30 min (Algolia API)
  │     fourchan_collector    → every 30 min (/biz/ + /g/ JSON API)
  │     bluesky_firehose      → continuous stream, persist every 5 min
  │     discord_collector     → every 30 min (bot API, ≥ 10 public servers)
  │     forum_collector       → every 60 min (RSS + scrape, ≥ 6 forums)
  │     concept_extraction    → continuously (queue worker, batched)
  │     baseline_rebuild      → nightly 01:30 local
  │     z_score_engine        → every 15 min (incremental)
  │     authenticity_scorer   → on every emerging-topic create or score-input change
  │     coverage_tier_refresh → weekly (Sunday 03:00 local)
  │
  │  MACRO ENGINE (Phase 1.5)
  │     news_rss              → every 15 min
  │     yahoo_news            → every 30 min
  │     sec_edgar             → every 30 min (filings index sweep)
  │     consumer_cycle        → on consumer-cycle state change events
  │     macro_releases        → every 4 hours
  │     news_clustering       → every 30 min (incremental, after collectors)
  │
  │  CROSS-ENGINE (both)
  │     corroboration_check   → every 15 min (entity-overlap match between
  │                             active Macro scenarios and active emerging topics)
  │
  ├── after each collector run, enqueues affected scenarios for recompute
  │
  └── nightly sweep (default 02:00 local):
        - recompute every non-archived scenario
        - run lifecycle state transitions
        - archive scenarios past `archived_at + 7d`
        - rebuild `evidence_count` cached column
```

Operator controls live in Settings page panel (mirrors `frontend/public/settings.js` structure).

### Snapshot vs live consistency

All denormalized fields on `market_situations` are snapshot values updated by the recompute job. They are not computed at GET time. Recompute triggers:

- write-triggered: every signal/evidence write for the affected `situation_id` (in-process, ≤ a few seconds)
- nightly sweep: all non-archived scenarios
- manual: `POST /scenarios/:id/recompute`

This bounds GET latency and DB load while keeping consistency tight.

### Freshness SLA

Per-scenario freshness target derived from `time_horizon`:

| time_horizon | Freshness SLA | `STALE` flag fires after |
|--------------|---------------|--------------------------|
| `intraday` | 30 min | 2 hours |
| `days` | 4 hours | 24 hours |
| `weeks` | 24 hours | 7 days |
| `months` | 7 days | 30 days |
| `quarters` | 30 days | 90 days |
| `structural` | 30 days | 180 days |

Rows past their freshness SLA dim in the UI. Rows past their `STALE` threshold acquire the `STALE` validity flag and incur the corresponding score penalty.

### Archival policy

- `INVALIDATED` and `FADING` scenarios past 7 days move to `archived_at IS NOT NULL` and drop out of the default UI stream.
- Archived rows remain queryable via `?include_archived=true`.
- Archived rows still receive recomputes during nightly sweep for backtest replay (cheap because most fields don't change).
- `situation_signals` and `situation_evidence` are never deleted (research/replay value).

### Concurrency

- Single-writer model per scenario: signal writes acquire a row-level lock on `market_situations` for the recompute critical section.
- Collectors are independent processes; collisions resolve at the `(source_type, source_id)` UNIQUE constraint with UPSERT semantics.
- Nightly sweep runs scenarios in batches of 100; never blocks user GETs because GETs read snapshot fields only.

---

## LLM Usage And Cost Profile (D14)

The dual-engine architecture has two distinct LLM cost centers. The **Social Arbitrage Engine's** concept extraction from comments (D21 S2) is the dominant cost — millions of comment-text inputs per day, not hundreds. The **Macro Engine's** cluster naming and theme proposal (D21 M3, M4) are bounded — hundreds of clusters per day at most. Cost discipline for both engines is enforced by aggressive batching, cheap-tier model selection, and caching by content hash; per-engine LLM cost is displayed independently in the operator settings panel.

### Where LLMs are used

| Task | Frequency | Model tier | Caching key | Engine |
|------|-----------|------------|-------------|--------|
| **Concept extraction from comments** (D21 S2) | Per comment / post text | **Cheap, batched aggressively** | text hash | Social Arbitrage (largest cost) |
| **Topic-to-ticker mapping for `behavior` targets** (D21 S6) | Per emerging topic where target_type = `behavior` | Mid-tier | `(concept_id, brand_to_ticker_version)` | Social Arbitrage |
| **Authenticity-signal LLM analysis** (D23, linguistic similarity check) | Per emerging topic, once when authenticity scored | Cheap | `(emerging_topic_id, comment_window_hash)` | Social Arbitrage |
| Cluster naming (D21 M3) | Once per new news cluster | Cheap | Embedding centroid hash | Macro |
| Theme proposal (D21 M4) | Once per new cluster | Cheap | Embedding centroid hash | Macro |
| Conviction layer producer (D3) | On evidence/exposure change | Mid-tier | `(situation_id, evidence_pack_hash, exposure_pack_hash)` | No |
| Long-tail consequence mapping (D2 Tier 2) | Once per new long-tail scenario | Mid-tier | `(situation_id, taxonomy_version, primary_theme)` | No |
| Evidence summarization (when source text > 1000 chars) | Once per source row | Cheap | URL hash | No |

### Where LLMs are explicitly NOT used

- Cluster membership decisions (always embedding cosine + entity overlap)
- Sector → ticker resolution for non-`behavior` targets (always database join via `brand_to_ticker`)
- Lifecycle state transitions (always rule-based)
- Coverage tier classification (always rule-based)
- Score computation, including authenticity score weighted sum (always formulaic)
- Z-score anomaly detection (always statistical)
- Hand-curated taxonomy entries (analyst-written)

### Concept extraction cost discipline

Because this is the dominant cost, several optimizations are mandatory in v1:

1. **Batching**: ≥ 50 comment texts per LLM call, with one structured-output array response
2. **Pre-filter**: comments with < 20 chars or matching low-signal patterns (links-only, single-emoji) skipped before extraction
3. **Tracked-concept matching**: comments matching only known concepts via cheap regex/keyword pre-pass have extraction skipped (most comments yield zero new concepts; we only need full LLM extraction when a candidate phrase doesn't match the registry)
4. **Daily cap**: per-community daily LLM-call budget. When exceeded, we sample (not fail) to keep coverage broad
5. **Cheap-tier only**: concept extraction never uses mid-tier or above

Expected v1 volume: 30k-150k comments/day across tracked communities (D29 source basket — lower than the original Reddit-included estimate because HN+4chan+Bluesky+Discord-public+forums together produce less raw volume than Reddit alone, but signal density per comment is higher because the communities are more topic-focused). With batching and pre-filtering, target ≤ 15k LLM calls/day at cheap tier (≈ $4–$12/day at current pricing).

### Cost budget (per scenario, retained from D14 with new caveats)

Soft cap: ≤ **500 LLM calls per scenario per lifetime**, ≤ **$0.05 per scenario amortized**. **Concept-extraction LLM calls are NOT counted against per-scenario budget** because they generate the inputs that *seed* scenarios (chicken-and-egg). They're tracked separately as platform-level operating cost.

Tracked per-scenario in `llm_call_log` table with model, prompt-token, completion-token, cost. Operator dashboard surfaces:

- top-10 most expensive scenarios in last 30d
- average cost per scenario by `scenario_type` and `detection_path`
- cache hit rate per task
- platform-level concept-extraction daily cost
- concept-extraction cost per emerging topic (daily cost / emerging topics created that day)

When a scenario hits 80% of its lifetime budget, further LLM calls are skipped (display falls back to "no conviction summary available") and the scenario gets validity flag `LLM_BUDGET_EXHAUSTED`.

### Hallucination guardrails

1. **All LLM output is JSON-schema-validated** before persistence
2. **Citation requirement**: conviction-layer fields cite specific `situation_evidence` ids; rendered UI shows hover-citations
3. **Ticker validity check**: any ticker mentioned by an LLM must resolve in the clean universe; unresolved tickers → output rejected
4. **Semantic-similarity check**: LLM output sentences must be semantically supported by evidence pack (cosine ≥ 0.4 against at least one evidence summary); failures → retry once, then mark `CONVICTION_LAYER_UNRELIABLE`
5. **Eval set**: built in Phase 5 from manually-validated scenarios; eval suite runs on every prompt-template change in CI

### Model choice (v1)

Not committed yet — depends on existing copilot infra choice. Document the existing model tiers used by the project's copilot in Phase 0 and reuse them. The PRD requires only that the chosen model supports JSON-mode output and ≥ 32k context.

---

## Backtest And Corpus Bootstrap (D15)

### The chicken-and-egg problem

Phase 5 calls for backtesting scenario usefulness, but no labeled scenario corpus exists. v1 weights are placeholders. Without a corpus, the calibration loop never closes.

### Bootstrap strategy

Phase 5 builds the corpus retroactively:

1. **Replay window**: 2022-01-01 → 2025-12-31 (4 years of pre-system history).
2. **Replay inputs**: re-fetch historical RSS archives (where available), Hacker News full historical dump (Algolia covers since 2006), 4chan archives (mirrored on archived.moe etc., partial coverage), Bluesky historical (only since 2023 — gap acknowledged), niche-forum HTML archives where reachable, SEC EDGAR (already historical), Yahoo article archives, plus existing social-intelligence and OHLCV history. Discord historical replay is **not feasible** (no archive); Discord coverage starts forward from collector launch only. Reddit Pushshift dumps deferred to Phase 1.7 backtesting.
3. **Run the v1 detector** in a deterministic-time mode that respects the `observed_at` timestamp of every signal — i.e. as if the system had been live since 2022.
4. **Output**: a synthetic scenario corpus of estimated 200–500 scenarios per year.
5. **Label** each scenario with:
   - **Outcome metric**: forward return on top-3 exposed names, weighted by `composite_rank`, measured at 1d / 5d / 20d / 60d / 250d horizons matching `time_horizon`.
   - **Survival metric**: how long the scenario stayed in `DEVELOPING` or `CONFIRMED` before invalidation/fade.
   - **Crowding marker**: whether mainstream coverage materialized within 30 days.

### What the corpus enables

- **Threshold tuning**: lifecycle thresholds, cluster cosine threshold, validity-flag severity weights
- **Score weight tuning**: scenario_score and confidence_score formulas
- **Magnitude calibration**: `base_magnitude_for_scenario_type` lookup table
- **Holdout**: 2024–2025 portion held out for honest forward evaluation; 2022–2023 used for fitting

### Tracking metrics post-launch

- **Lead time**: median days between scenario `EARLY` state and mainstream coverage (proxy for "early")
- **Hit rate**: % of `DEVELOPING+` scenarios where top-3 candidates show forward return in expected direction at the `time_horizon`
- **False positive rate**: % of scenarios that reached `DEVELOPING` and ended `INVALIDATED` within 30 days
- **Crowding penalty validation**: do `crowding_score ≥ 0.7` scenarios actually underperform?

### What the v1 launch promises (and doesn't)

- v1 launches with **placeholder weights and no calibration**
- v1 UI honestly badges this with "Calibration in progress"
- Phase 5 ships the calibrated weights and a forward-tracking dashboard
- The system is research-useful from launch (it surfaces situations) and research-rigorous after Phase 5

---

## MVP Definition

**MVP ships both engines.** Phase ordering builds Social Arbitrage first (harder, higher-risk) and Macro second, but both are required before page launch (Phase 4). The MVP does not need every possible source type, but it does need a concretely-bounded source list and theme list per engine so scope creep is structural, not accidental. (D24)

### MVP must do — Social Arbitrage Engine (Phase 1)

| # | Capability | Concrete v1 scope |
|---|------------|-------------------|
| 1a | **Topic-indexed ingestion (originating detection)** | 5 source types per D29: Hacker News (Algolia API), 4chan `/biz/` + `/g/` (JSON API), Bluesky firehose (AT Protocol), Discord public servers (bot API, ≥ 10 servers), niche product forums (RSS/scrape, ≥ 6 forums). Total ≥ 50 communities tracked across the 5 source types. Per-community baselines computed nightly. This is the source class that detects new emerging topics. **Reddit deferred to Phase 1.7 per D29.** |
| 1b | **Ticker-indexed ingestion (migration/confirmation)** | StockTwits stream + Yahoo Finance message boards (Spot.im) — already ingesting today via `collect_social_intraday.py` and `fundamentalsService.py`. Used to detect when a topic-indexed signal has migrated to ticker-aware spaces (D28); feeds `migration_to_ticker_indexed` flag and lifecycle transitions. |
| 2 | **Concept extraction from comments (D21 S2)** | LLM extracts (concept, target, intent) tuples per comment, batched at ≥ 50/call, with pre-filter and tracked-concept matching for cost discipline. |
| 3 | **Z-score anomaly engine (D21 S3–S4)** | Per-(concept, community, day) z-scores with seasonality + DoW adjustment. Cross-platform corroboration check. `emerging_topics` rows persisted. |
| 4 | **Authenticity Layer (D23)** | All 10 weighted signals computed per emerging topic. `LIKELY_INAUTHENTIC` enforced at API + UI layer. Hard-limit always-fire rules implemented. Per-signal audit rows persisted. |
| 5 | **Coverage Filter (D22 — Social Arbitrage scope)** | `coverage_tiers` table populated for full universe weekly. `mega_covered` excluded from default Social Arb API responses. `MEGA_COVERAGE_PENALTY` flag fires correctly on Social Arb scenarios only. `edge_multiplier` applied in Social Arbitrage scoring profile (D27). |
| 6 | **Topic-to-ticker mapping (D21 S6)** | `brand_to_ticker.json` seeded with ≥ 200 hand-curated rows. Resolution pipeline operational for all four target_types. |
| 7 | Social Arbitrage scenarios persist with full schema | `detection_path = topic_anomaly`, `seeded_emerging_topic_id`, `coverage_tier`, `authenticity_score`, `peak_z_score`, `cross_platform_corroboration`. |

### MVP must do — Macro Engine (Phase 1.5)

| # | Capability | Concrete v1 scope |
|---|------------|-------------------|
| 8 | **News + filings + macro ingestion** | SEC EDGAR filings, Yahoo news, RSS (Reuters Top, AP, Fed, EIA, BLS). Independent ingestion path — does NOT depend on Social Arbitrage running first. |
| 9 | **Embedding-based clustering (D4, D21 M2–M3)** | Cosine ≥ 0.78 + named-entity overlap. LLM names clusters only. |
| 10 | **Theme + exposure mapping (D21 M4)** | `theme-taxonomy.json` resolver inserts `situation_exposure` rows with `source_method = hand_curated`. LLM-assist for long-tail. |
| 11 | Macro scenarios persist with full schema | `detection_path = news_cluster`, no coverage penalty applied, no authenticity score. |
| 12 | **Cross-engine corroboration (D21 M5, S8)** | When entities overlap, scenarios upgrade to `mixed_news_led` or `mixed_anomaly_led`. Corroboration adds +0.10 to `confidence_score`. |

### MVP must do — Shared (both engines feed)

| # | Capability | Concrete v1 scope |
|---|------------|-------------------|
| 13 | **Dual scoring profile (D27)** | `scenario_score` computed under Macro profile or Social Arbitrage profile based on `detection_path`. |
| 14 | Compute and display all four layer scores | Event Layer, Attention Layer, Market Confirmation Layer, Universe Fit Layer. |
| 15 | Compute lifecycle state | Per §Scenario Lifecycle threshold table. |
| 16 | Resolve sector → universe symbols | Catalog join helper. |
| 17 | Compute and persist top-N candidates per scenario | `composite_rank` formula. Coverage `edge_multiplier` and authenticity multiplier applied for Social Arbitrage scenarios only. |
| 18 | **Render the dual-panel page** | Top summary strip with both engines' headlines + side-by-side Macro panel and Social Arbitrage panel + detail drawer + candidate bridge. Engine tabs: Both / Macro Only / Social Arb Only / Mixed Only. |
| 19 | Operator surface | Settings panel + scheduler controls (per engine) + tracked-concept management + emerging-topic suppress/promote actions + per-engine LLM cost displays. |
| 20 | Ship all validity flags | Including new `LIKELY_INAUTHENTIC`, `MEGA_COVERAGE_PENALTY`, `AUTHENTICITY_BORDERLINE` (Social Arbitrage only). No `NEWS_DRIVEN_ONLY` flag — that pattern is intentionally removed (D27). |
| 21 | Conviction layer (templated, validated) | Per §Producer (D3) for `scenario_type` in {`geopolitical`, `commodity`, `policy`, `sector_rotation`, `consumer_cycle`, **`single_company_catalyst`**} (D16). |
| 22 | `GET /scenarios?engine={macro\|social_arbitrage\|both}` | Default = `both`. Engine-aware coverage and authenticity defaults. |

### MVP can defer

- YouTube comment ingestion (v1 stretch; Phase 2)
- TikTok comment ingestion (Phase 6 — biggest data goldmine, hardest plumbing)
- Twitch chat (Phase 6)
- Twitter / X (deferred indefinitely; hostile API)
- Discord / Telegram (closed communities, compliance)
- Conviction layer for `tech_disruption` scenario type only
- Theme taxonomy expansion beyond ~20 themes
- Full multi-hop (third-order+) causal graphing
- Research paper ingestion
- Advanced cross-source entity-resolution beyond named-entity overlap
- Probabilistic scenario trees / Monte Carlo
- Portfolio construction / position sizing automation
- Bloomberg / FT / WSJ / paid news APIs
- Eval-set CI for prompt templates (Phase 5)
- Backtest-derived weight calibration (Phase 5)
- Forward-tracking metrics dashboard (Phase 5)
- Brand-level signals: app store rankings, Google Trends, Amazon reviews, web traffic (Phase 6 — D19)
- Per-`primary_theme` Theme Performance dashboard (Phase 5 — D20)

### Hard non-goals for v1

These are explicitly **not** trying to be solved:

- A general news feed / aggregator (the page is scenarios, not articles)
- A war or election prediction market
- Real-time millisecond signals
- Trade automation
- Replacing valuation, technicals, or fundamentals analysis
- Mega-cap names as the primary Social Arbitrage Engine surface (mega-caps are deliberately deprioritized **inside the Social Arbitrage stream** — this is not a hole, it's D22). Mega-caps surface freely in the Macro Engine when geopolitically or commodity-relevant.
- Inauthentic-buzz suppression as a perfect classifier (the goal is to keep the worst pump-and-dump signals out of the actionable stream, not to be infallible)

---

## Phased Delivery Plan

Each phase has explicit exit criteria. Phase advancement is gated, not time-boxed.

### Phase 0 — Definition And Contracts

**Goal:** lock everything that makes downstream work safe.

**Deliverables:**

- Canonical TypeScript scenario types in `backend/src/types/marketIntelligence.ts`
- DB schema migration in `backend/scripts/build_market_intelligence_db.py` (creates `market-intelligence.sqlite` with **all tables**: `market_situations`, `situation_signals`, `situation_evidence`, `situation_exposure`, `theme_registry`, `tracked_concepts`, `concept_mentions`, `concept_daily_counts`, `topic_baselines`, `emerging_topics`, `coverage_tiers`, `authenticity_signals`, `brand_to_ticker` + indexes + `schema_version = 1`)
- API payload contract document (request/response shapes for every endpoint, including new `/emerging-topics`, `/emerging-topics/:id/authenticity`, `/coverage-tiers/:symbol`)
- UI card contract (component-level Storybook-style mocks of card variants: EARLY / DEVELOPING / CONFIRMED / CROWDED / FADING / INVALIDATED, plus Macro vs Social Arbitrage vs mixed_news_led vs mixed_anomaly_led visual differentiation, plus authenticity chip + coverage-tier chip)
- **Dual-panel page mock** showing Macro panel + Social Arbitrage panel side by side with engine view selector (Both / Macro Only / Social Arb Only / Mixed Only)
- Theme taxonomy v1 file (`backend/data/scenarios/theme-taxonomy.json`) with ~20 themes + ticker_seeds
- **Tracked sources seed file** (`backend/data/scenarios/tracked-sources.json`) with ≥ 50 communities across the 5 v1 source types (D29), each tagged with `source_type` and `community_tier`
- **Brand-to-ticker seed file** (`backend/data/scenarios/brand-to-ticker.json`) with ≥ 200 hand-curated rows
- **Authenticity-signal weights config** (`backend/data/scenarios/authenticity-weights.json`) with v1 weights from §Authenticity Layer
- **Coverage-tier thresholds config** (`backend/data/scenarios/coverage-thresholds.json`) with v1 bands from §Coverage Filter
- Conviction-layer prompt templates checked in for v1 `scenario_type`s including `single_company_catalyst`
- **Concept-extraction prompt template** (the highest-volume LLM workload — needs careful design)
- LLM model choice document (which existing copilot tier maps to which task; cheap tier for concept extraction is mandatory)

**Exit criteria:**

- Schema migration runs cleanly and is idempotent across all new tables
- All API contracts have a fixture file
- Theme taxonomy + tracked sources + brand-to-ticker reviewed by user
- Authenticity-weight config reviewed by user
- Coverage-tier thresholds reviewed by user
- Concept-extraction prompt produces valid JSON on a 50-comment fixture batch
- No `TODO` markers in the schema file

### Phase 1 — Social Arbitrage Engine (build the harder one first)

**Goal:** prove the Social Arbitrage thesis end-to-end — comments from the D29 source basket (HN + 4chan + Bluesky + Discord public + niche forums) → z-score anomaly → authenticity-gated emerging topic → coverage-filtered scenario candidate. **No RSS, no EDGAR, no clustering of news yet** — that's Phase 1.5. Phase 1 builds the Social Arbitrage Engine first because it is the structurally harder build (entirely new infrastructure: 5 net-new collectors, concept extraction, baselines, z-score, authenticity scoring, coverage filter) and the entire mission rides on whether it can produce signal. Phase 1 is **not** the only MVP capability; it's the riskier of the two MVP capabilities.

**Deliverables:**

- 5 net-new collectors (D29): Hacker News (Algolia API), 4chan (`/biz/` + `/g/` JSON API), Bluesky (AT Protocol firehose), Discord (bot API, ≥ 10 public servers), niche forums (RSS/scrape, ≥ 6 forums) — all rate-limit-aware
- `marketIntelligenceScheduler.ts` running on the same pattern as `socialIntelligenceScheduler.ts`, scheduling each of the 5 collectors at the cadence defined in §Operational Architecture
- **Concept-extraction worker** (LLM-batched, with pre-filter and tracked-concept-matching cost-discipline path)
- Nightly **baseline rebuild job** writing to `topic_baselines`
- **Z-score anomaly engine** writing to `emerging_topics` (D21 S4)
- Cross-platform corroboration check
- **Authenticity Layer scorer** (D23) — all 10 weighted signals + hard-limit always-fire rules
- **Coverage-tier weekly job** populating `coverage_tiers` for the full universe
- **Topic-to-ticker resolver** (D21 S6) for `brand`, `product`, `category` target_types
- Lifecycle state machine (engine-agnostic — used by Phase 1.5 too)
- Rollup recompute (synchronous on emerging-topic write, batched in nightly sweep)
- **Social Arbitrage scoring profile** (D27) implemented and applied to `detection_path = topic_anomaly` scenarios
- `GET /scenarios?engine=social_arbitrage`, `GET /scenarios/:id`, `GET /emerging-topics`, `GET /emerging-topics/:id/authenticity`, `GET /coverage-tiers/:symbol`, `GET /healthcheck`
- Operator UI for `POST /tracked-concepts/:id/status` (prune/merge) and `POST /emerging-topics/:id/promote`

**Exit criteria:**

- Scheduler runs for 14 days without manual intervention
- ≥ 30k comments/day ingested at steady state across the 5 source types (D29)
- ≥ 10 emerging topics with `peak_z_score ≥ 3.0` per week, of which ≥ 3 reach `authenticity_score ≥ 0.65` AND `coverage_tier ∈ {barely_covered, lightly_covered}` AND seed a scenario
- ≥ 1 cross-platform-corroborated emerging topic per week
- ≥ 1 scenario where `LIKELY_INAUTHENTIC` correctly fires (validated retrospectively against a known pump-and-dump pattern in test fixtures)
- ≥ 1 scenario where `MEGA_COVERAGE_PENALTY` correctly fires
- Concept-extraction LLM cost ≤ $20/day at steady-state ingestion volume
- Recompute round-trip < 2 seconds for an average scenario

### Phase 1.5 — Macro Engine (build the better-understood one second)

**Goal:** build the Macro Engine — news / filings / RSS / macro releases → embedding clustering → entity reconciliation → scenario candidate with theme-mapped exposure. The Macro Engine is built second because (a) the building blocks are well-understood (embeddings + clustering + entity overlap) and lower-risk than Phase 1's net-new infrastructure, and (b) Phase 1's results inform how Macro should be tuned (e.g., where cross-engine corroboration is most useful). It is **not** secondary in the product sense — both engines ship together at Phase 4 page launch.

**Deliverables:**

- Collectors for SEC EDGAR filings, Yahoo news, RSS bundle (Reuters Top, AP, Fed, EIA, BLS) — one PR per source_type
- Embedding pipeline (sentence-transformers via `backend/services/embeddings.py`)
- Macro clustering job → creates/updates `market_situations` with `detection_path = "news_cluster"` (D21 M1–M4)
- LLM cluster-naming + theme-proposal hooks (cheap-tier model)
- **Macro scoring profile** (D27) implemented and applied to `detection_path = news_cluster` scenarios — no coverage penalty, no authenticity multiplier
- Cross-engine corroboration logic (D21 M5, S8): when entities overlap with an existing scenario from the other engine, upgrade `detection_path` to `mixed_news_led` or `mixed_anomaly_led` and add +0.10 to `confidence_score`
- Consumer Cycle adapter
- `engine` and `detection_path` filters operational on `GET /scenarios`
- Default `GET /scenarios` returns both engines (no engine excluded by default)

**Exit criteria:**

- ≥ 30 Macro scenarios persisted within the first week
- ≥ 1 scenario observed transitioning from pure `news_cluster` → `mixed_news_led` after a Social Arbitrage topic attached
- ≥ 1 Macro scenario surfacing a `mega_covered` candidate without penalty (e.g., XOM in an energy scenario) — confirms scoring profile selection works
- Default `GET /scenarios` (no params) returns both engines, with engine-aware coverage / authenticity defaults
- Macro clustering does not contaminate Social Arbitrage scenarios (verified by SQL audit: no Macro signal accidentally writes to `seeded_emerging_topic_id`)

### Phase 2 — Exposure Mapping

**Goal:** every scenario points to specific sectors and tickers — for both engines.

**Deliverables:**

- Theme-taxonomy resolver (`source_method = hand_curated`) — used by both Macro and Social Arbitrage scenarios
- LLM-assist mapping for long-tail scenarios (`source_method = llm_assist`)
- Sector → universe symbol resolver
- `situation_exposure` populated on scenario create + theme-taxonomy version bumps for both engines
- Operator override endpoint
- Detail-drawer consequence chain UI

**Exit criteria:**

- Every `DEVELOPING+` scenario from either engine has ≥ 3 first-order exposure rows
- ≥ 80% of `hand_curated` rows resolve to ≥ 5 universe symbols
- LLM-assist rejection rate < 20%
- Macro scenarios resolve to first-order rows that include mega-covered names where appropriate (e.g., XOM in an energy scenario, LMT in a defense scenario) — confirms exposure mapping doesn't accidentally apply Social Arbitrage filters

### Phase 3 — Universe Ranking

**Goal:** the candidate list is the actual product output — under the **dual scoring profile** (D27).

**Deliverables:**

- `technical_readiness` aggregator (`backend/src/services/technicalReadiness.ts`) — used by both engines
- Valuation + buzz field joiners
- `composite_rank` formula — engine-aware (Social Arbitrage applies coverage_edge_multiplier and authenticity_multiplier; Macro does not)
- **Dual scoring profile implementation** (D27) — `scenario_score` selects Macro profile for `news_cluster`/`mixed_news_led` and Social Arbitrage profile for `topic_anomaly`/`mixed_anomaly_led`
- Top-N persistence per scenario
- Candidate list UI (sortable + exportable, with coverage_tier visible per row)
- Conviction-layer producer (D3) for v1 `scenario_type`s including **`single_company_catalyst`** (D16)
- `NO_GOOD_EXPRESSION` flag computation as part of the ranking pipeline (D17)
- `THESIS_REAL_EXECUTION_DELAYED` flag computation in the nightly sweep (D18)

**Exit criteria:**

- Top-3 candidates per scenario render in < 200ms (p95) for both engines
- Conviction-layer cache hit rate ≥ 60% in steady state
- Conviction-layer rejection rate < 15%
- ≥ 1 `single_company_catalyst` scenario successfully produces a validated conviction layer
- Macro scenario surfaces a `mega_covered` name as the top candidate (e.g., XOM in an energy scenario) — confirms Macro profile correctly disables coverage penalty
- Social Arbitrage scenario surfaces a `barely_covered` name as the top candidate even when an attached `mega_covered` name has higher raw attention — confirms Social Arbitrage profile correctly applies multipliers
- `NO_GOOD_EXPRESSION` and `THESIS_REAL_EXECUTION_DELAYED` flags fire correctly on synthetic test fixtures

### Phase 4 — UX And Analyst Workflows (DUAL-ENGINE PAGE LAUNCH)

**Goal:** the page is fast to read and obvious to act on. Both engines are visible side by side from the moment the page renders.

**Deliverables:**

- **Dual-panel scenario stream UI** — Macro panel (left) + Social Arbitrage panel (right), with engine view selector (Both / Macro Only / Social Arb Only / Mixed Only)
- **Top summary strip** with both engines' headline outputs side by side (Top Macro Scenarios + Top Social Arbitrage Scenarios + cross-engine corroboration count)
- All status filters per panel (`EARLY` / `DEVELOPING` / `CONFIRMED` / `CROWDED` / `FADING`)
- **Engine-aware default filters**: Social Arbitrage panel defaults to excluding `mega_covered` and applying authenticity floor; Macro panel shows all coverage tiers, no authenticity slider
- Detail drawer with evidence timeline + consequence chain + conviction layer + engine badge
- Validity flag chips with hover explanations (with engine-scope notes)
- Candidate bridge to Scanner (D11 fallback target)
- Settings page panel for operator controls — per-engine scheduler controls and per-engine LLM cost displays
- "Calibration in progress" badge until Phase 5

**Exit criteria:**

- User can identify first-order vs second-order effects in < 5 seconds (informal usability test)
- User can switch between engine views in one click and the page state persists across reloads
- p95 page load < 1s with 200 active scenarios across both engines
- Operator can pause/resume each engine's scheduler independently from Settings without restart
- Both engines have ≥ 1 scenario rendering on the dual-panel layout at ship time

### Phase 5 — Quality And Research Loop

**Goal:** close the calibration loop. Move from "research-useful" to "research-rigorous."

**Deliverables:**

- Backtest corpus build (D15) on 2022–2025 history — separate corpora for Macro and Social Arbitrage scenarios
- Per-engine threshold sweep + score weight tuning (Macro profile and Social Arbitrage profile tuned independently)
- `base_magnitude_for_scenario_type` recalibration
- Forward-tracking metrics dashboard (lead time, hit rate, false-positive rate, crowding-penalty validation) — split by engine
- **Per-`primary_theme` Theme Performance dashboard** (D20): for each theme in `theme_registry`, surface lead time, hit rate, FP rate, expression-vehicle rate (% of scenarios where `composite_rank` of #1 ≥ 50), and average days to invalidation. Themes with persistently poor metrics get auto-flagged for taxonomy review or weight reduction. Themes are tracked per-engine (a theme can perform well in Macro but poorly in Social Arbitrage, or vice versa).
- Cross-engine corroboration calibration — measure whether `mixed_*` scenarios actually outperform their single-engine peers on holdout set; tune corroboration thresholds and the +0.10 confidence bonus
- Eval set + CI for conviction-layer prompt templates
- False positive review loop (operator UI for marking and reviewing bad scenarios) — engine-aware
- Per-scenario_type validity-flag severity recalibration
- Schema v2 migration if backtest reveals required new fields

**Exit criteria:**

- Backtest corpus has ≥ 800 labeled scenarios across both engines (≥ 400 per engine)
- Calibration produces statistically distinguishable improvement over Phase 1 weights on holdout set, for each engine
- `mixed_*` scenarios show measurable forward-return outperformance vs single-engine peers (or corroboration bonus is reduced/removed)
- Forward-tracking dashboard live and updating daily, with per-engine views
- Theme Performance surfaces ≥ 1 theme per engine that should be pruned or rebuilt
- "Calibration in progress" badge removed from UI for the engine(s) that have hit calibration targets

### Phase 6 — Consumer-Brand Signal Sources (D19)

**Goal:** add the source class that the v1 macro/RSS/social mix is structurally missing — brand-level consumer observation. This is the lane the closest commercial precedent (Camillo / TickerTags-style social arbitrage) made its strongest calls in.

**Why it's a separate phase, not v1:**

- Each source has a meaningful integration cost and rate-limit profile
- They are noisier per-row than RSS, requiring per-source quality calibration
- They are most valuable for `single_company_catalyst` scenarios, which only become first-class in Phase 3
- Calibration data from Phase 5 should inform which sources actually move the needle before more get added

**Deliverables:**

| Source | Signal | Cadence |
|--------|--------|---------|
| Apple App Store / Google Play rankings (per app, per category) | App download/rank velocity for consumer-tech and gaming names | daily |
| Google Trends (per brand keyword + per product category) | Search interest acceleration vs baseline | daily |
| Amazon review velocity (per product / per brand) | Review count + rating drift as consumer-adoption proxy | daily |
| Web traffic proxies (SimilarWeb-style or open alternatives) | DAU / MAU trend per consumer-internet brand | weekly |
| Niche commerce indicators (StockX / eBay sold-listing velocity for brand-tagged categories) | Resale-market signal | daily |
| **Reddit consumer-brand subs** (per-brand subreddits, e.g. `/r/tesla`, `/r/lululemon`) — contingent on Phase 1.7 unlocking Reddit per D29 | Mention velocity tied to specific brand | hourly |

**New `source_type`s:** `app_store_rank`, `google_trends`, `amazon_reviews`, `web_traffic`, `commerce_indicator`, `reddit_brand` (only if Phase 1.7 unlocks)

**New `signal_type`:** `consumer_brand_signal`

**New scenario_type weighting:** `single_company_catalyst` and `consumer_cycle` get an additional `consumer_brand_score` rollup field that contributes to the Attention layer specifically for brand-driven scenarios.

**Exit criteria:**

- ≥ 2 brand-level data sources operational
- Backtest replay (extending Phase 5 corpus) shows brand-signal sources improve `single_company_catalyst` hit rate vs the v1 baseline by a statistically significant margin
- ≥ 1 historical Camillo-style success case (e.g. retroactive SodaStream / Lululemon / Skechers detection) reproducible from the bootstrap data

### Phase ordering note

The phase numbers reflect build order and risk, not product priority. **Both engines ship together at Phase 4 — neither is "secondary."** (D24, D27)

- **Phase 0** is the contract lock — pre-implementation
- **Phase 1 (Social Arbitrage Engine)** is the structurally harder build (entirely net-new infrastructure: comment ingestion, concept extraction, baselines, z-score, authenticity scoring, coverage filter). It goes first because if it can't produce signal, the dual-engine product loses one of its two pillars and that should be discovered before we build the other one. It is the load-bearing phase for the Social Arbitrage half of the product.
- **Phase 1.5 (Macro Engine)** is the lower-risk build (embeddings + clustering + entity overlap are well-understood patterns). It goes second so Phase 1 results can inform tuning (especially around cross-engine corroboration thresholds). It is the load-bearing phase for the Macro half of the product.
- **Phase 2–4** continue serially after both engines exist. Exposure mapping (Phase 2), candidate ranking (Phase 3), and page UI (Phase 4) all need both engines feeding `market_situations`.
- **Phase 5** is the calibration loop — explicitly allows a schema v2 migration when backtest reveals new required fields (Phase 0 is "lock for v1," not "lock forever"). Calibration runs per engine since the scoring profiles differ.
- **Phase 6** likely requires schema v3 (new source_types, new rollup field); the `schema_version` integer (D13) makes this clean

The reason Social Arbitrage is built first is **risk management, not product hierarchy**. The Macro Engine has well-understood building blocks (embeddings + clustering + entity overlap); the Social Arbitrage Engine is net-new infrastructure on top of an unproven thesis (per-community z-scoring of comment text is not standard practice anywhere). Building the riskier engine first lets us kill the project early if the social-arbitrage thesis doesn't pan out, instead of finding out after we've also built Macro. **At ship time both engines are equally first-class on the page**, with the dual-panel UI giving each its own column.

---

## Success Criteria

This page is successful if it helps surface relevant situations earlier and more usefully than a normal news workflow.

### Product success

- user can understand a scenario in under 30 seconds
- user can identify first-order and second-order effects immediately
- user can navigate from scenario to 3-10 ranked universe names
- scenarios feel distinct and durable, not like relabeled headlines

### System success

- low rate of duplicate / redundant scenarios
- confidence flags align with real evidence quality
- scenario lifecycles update correctly over time
- candidate ranking consistently surfaces plausible expression vehicles

### Research success

- early scenarios outperform crowded scenarios on downstream usefulness
- ranked candidates show better subsequent opportunity quality than naive theme baskets

---

## Key Risks

### 1. Repackaged headlines

Risk:

- the page becomes a prettier news feed

Mitigation:

- scenario object must summarize pattern and consequence, not merely display articles

### 2. Weak exposure mapping

Risk:

- scenarios sound smart but do not point to investable names

Mitigation:

- treat exposure mapping as first-class, not optional metadata

### 3. False precision

Risk:

- confidence appears scientific without enough evidence

Mitigation:

- validity flags, confidence reasons, and visible evidence breadth

### 4. Crowded-theme trap

Risk:

- the system highlights themes that are already obvious

Mitigation:

- explicit crowding score and ranking penalty

### 5. No clean-universe bridge

Risk:

- page is interesting but not actionable

Mitigation:

- require candidate ranking as part of the scenario detail contract

---

## Resolved In This Revision

| Revision | Resolved by |
|---|---|
| Rev 2 | D1–D15 — initial concretization |
| Rev 3 | D16–D20 — Camillo-precedent integration (single-name catalysts, expression flags, brand-signal phase, theme dashboard) |
| Rev 3 | D21–D25 (initial form) — comment-universe z-score engine, coverage filter, authenticity layer, Reddit-first commitment, mission-alignment |
| Rev 4 | **D21–D27 — dual-engine architecture restoration**: Macro Engine + Social Arbitrage Engine as peer detection systems (D21 reworded, D26 added). Coverage filter and authenticity layer become Social-Arbitrage-scoped only; Macro scenarios surface mega-coverage names without penalty (D22 reworded, D23 reworded, D27 added). `NEWS_DRIVEN_ONLY` auto-fire flag removed entirely. Phase 1 builds Social Arbitrage first because it's the harder build, Phase 1.5 builds Macro second (D24 reworded). Mission alignment enforced per-engine instead of globally (D25 reworded). |
| Rev 4 | **D28 — source topology**: Social Arbitrage community sources are split by topology — **topic-indexed** (originating detection) vs **ticker-indexed** (StockTwits, Yahoo Finance message boards) for migration/confirmation. Existing StockTwits + Yahoo ingestion (already in `social_posts_raw`) is repurposed as the migration signal that triggers the lifecycle transition `EARLY → DEVELOPING → CONFIRMED` via the new `migration_to_ticker_indexed` flag. |
| Rev 5 | **D29 — v1 topic-indexed source basket, Reddit deferred to Phase 1.7**: Reddit removed from v1 due to 2024–2025 Responsible Builder Policy gating (data-API access requires explicit approval; LLM-extraction of comment text falls in policy gray zone). v1 basket replaced with 5 source types with no auth/policy obstacles: Hacker News (Algolia API), 4chan `/biz/` + `/g/` (JSON API), Bluesky firehose (AT Protocol), Discord public servers (bot API), niche product forums (RSS/scrape). All references updated: D1, D24, D28, MVP table row 1a, scheduler diagram, Phase 1 deliverables, Phase 1 exit criteria, Net-new ingestion section, source_type schema enum, expected comment volume (50–200k → 30–150k/day), backtest historical inputs (Reddit Pushshift deferred). Architecture is source-agnostic per D28 — Reddit can be re-added in Phase 1.7 by adding a collector + entries to `tracked-sources.json`, no code surgery required. |
| Rev 6 | **D30 — universe normalization / field-map architecture**: Social Arbitrage discovery becomes clean-universe-wide instead of watchlist-first. Broad raw intake lands in `mi_raw_hits`, then a normalization engine maps every raw hit to clean-universe symbols/aliases, builds `(symbol, source_type, source_community, day)` baselines, and ranks perturbations by abnormality. StockTwits/Yahoo/other ticker-indexed sources become confirmation/migration evidence unless an organic source also carries the signal. |

## Remaining Open Questions

These were NOT resolved in this revision and need user input before Phase 0 can begin:

1. **LLM model tier mapping** — Phase 0 needs an explicit document of which existing copilot model tier (cheap / mid / heavy) maps to each LLM task in §LLM Usage. Concept extraction (now the dominant cost) MUST be cheap-tier; conviction layer should be mid-tier. Cannot finalize without confirming current copilot model setup and per-tier pricing.
2. **D29 source-basket validation** — confirm the 5 v1 source types (HN, 4chan, Bluesky, Discord public, niche forums) and confirm we accept the Reddit deferral to Phase 1.7. If Reddit must be in v1, Phase 0 needs to add a decision item: official API vs PRAW vs scraping vs Pushshift mirror, each with different ToS exposure.
3. **Tracked sources seed list (`tracked-sources.json`)** — the PRD sketches ≥ 50 communities across the 5 source types in D29. User should review the actual list, including specific Discord servers (each requires bot-invite) and specific niche forums (each requires per-site scrape verification).
4. **`brand-to-ticker.json` seeding strategy** — needs ≥ 200 hand-curated brands for v1. Open question: does the user want to seed this manually, accept LLM-proposed mappings with operator review, or both?
5. **Authenticity Layer weight calibration** — the v1 weights (D23 §Signal Table) are placeholders. They need a small labeled test set (≥ 20 known organic + 20 known orchestrated) to validate before Phase 1 launches. Where does this test set come from?
6. **RSS feed exact URLs** — D1 names the source organizations but the specific RSS endpoints (and any auth headers / rate limits) need confirmation before the Phase 1.5 collectors can be written.
7. **Theme taxonomy v1 review** — the proposed ~20 themes (energy_supply, etc.) are sketched in D2; user should review and edit the actual `theme-taxonomy.json` before Phase 0 closes.
8. **Settings page integration shape** — whether the Market Intelligence operator panel goes in `settings.html` (current pattern) or a dedicated `market-intelligence-settings.html`. Default in this revision: same `settings.html`.
9. **Backtest historical comment access (D29 sources)** — bootstrap plan (D15) assumes historical comment data is obtainable per source type. Coverage matrix: HN via Algolia full historical (since 2006, complete); 4chan via archived.moe / desuarchive (partial, varies by board); Bluesky historical only since 2023 (gap acknowledged); niche forums (per-site, varies); **Discord historical replay is not feasible** — Discord coverage starts forward from collector launch only. Coverage holes need enumeration before Phase 5 starts.
10. **Eval set authoring budget** — Phase 5 deliverables include an LLM-template eval set. How many hand-validated scenarios is the user willing to label?
11. **Coverage-tier definition review** — the bands in §Coverage Filter (analyst counts, market cap thresholds, etc.) are educated guesses. User should validate against their own definition of "what counts as uncovered."
12. **`OPERATOR_OVERRODE_AUTHENTICITY` workflow** — when an operator promotes a `LIKELY_INAUTHENTIC` topic to a scenario, what's the audit / approval workflow? Single-operator override, dual-approval, just-log-it?

---

## Recommended Near-Term Work Order

1. **Confirm the 12 Remaining Open Questions** with the user — especially #2 (D29 source-basket validation), #4 (brand-to-ticker seeding), #5 (authenticity calibration). Phase 1 cannot start until these resolve.
2. **Phase 0** — lock the schema (now 13 tables, not 5) + `tracked-sources.json` seed (D29 — 5 source types, ≥ 50 communities) + brand-to-ticker seed + authenticity weights config + coverage thresholds + theme taxonomy + API contracts + dual-panel UI mocks (Macro panel + Social Arbitrage panel side by side). Concept-extraction prompt template is the highest-risk Phase 0 deliverable.
3. **Phase 1 (Social Arbitrage Engine — the harder build)** — comment ingestion → concept extraction → z-score engine → authenticity gate → coverage filter → emerging topic → scenario candidate. **No RSS or news yet.** This is the riskier of the two engines and goes first so we can kill the project early if the social-arbitrage thesis can't produce signal.
4. **Phase 1.5 (Macro Engine — the better-understood build)** — collectors (EDGAR, news, RSS) → embedding clustering → entity reconciliation → theme/exposure mapping → cross-engine corroboration logic. Both engines must exist before Phase 4. Macro Engine is **not** secondary — it's the second build because it's lower-risk, but it's a peer engine in the product.
5. **Phase 2** — hand-curated theme exposure mapping for the ~20 v1 themes (used by both engines).
6. **Phase 3** — candidate ranking with **dual scoring profile** (D27) + conviction-layer producer (including `single_company_catalyst`). Verify the Macro profile correctly surfaces mega-covered names and the Social Arbitrage profile correctly penalizes them.
7. **Phase 4 — DUAL-ENGINE PAGE LAUNCH** — ship the page only after **both** Phase 1 has produced ≥ 30 real Social Arbitrage scenarios AND Phase 1.5 has produced ≥ 30 real Macro scenarios. Page renders both panels side by side at launch. Engine view selector (Both / Macro Only / Social Arb Only / Mixed Only) functional. At least one cross-engine corroboration (`mixed_*`) scenario must exist at ship time.
8. **Phase 5** — backtest each engine separately, calibrate authenticity weights and z-score thresholds (Social Arbitrage) and clustering thresholds (Macro) against the corpus, drop the "Calibration in progress" badge per engine when calibrated.
9. **Phase 6** — brand-level signal sources (app stores, Google Trends, Amazon reviews, web traffic) — only after Phase 5 Theme Performance shows where each engine's v1 signal mix is weakest. These primarily help the Social Arbitrage Engine; Macro Engine extensions in Phase 6 likely add international filings and additional macro RSS.

---

## Bottom Line

The Market Intelligence Page is the system's **scenario-detection workspace**, built around **two peer engines** that answer two different questions about the market and feed the same scenario object and the same dual-panel UI.

The page does not tell us what happened. It tells us, for each engine, two things:

**The Macro Engine tells us:**

> "A broad-based situation is forming — geopolitical, macro, policy, sector-rotation, commodity. Here's the consequence chain. Here's which sectors and stocks (including mega-covered ones like XOM and LMT, which are correctly the answer when the situation is geopolitical or commodity-driven) will be affected first, second, and third order. Here's the time horizon and how we'll know we were wrong."

**The Social Arbitrage Engine tells us:**

> "Real, organic, grassroots social attention is anomalously rising on this lightly-covered name **and the institutional class hasn't noticed yet**. Here's why we believe it's organic (10-signal authenticity score). Here's the causal chain to a tradeable expression. Here's the time horizon. Here's how we'll know we were wrong."

The two outputs run side by side. Neither is primary. Neither is secondary. Together they form a market-intelligence workspace where the user can scan the broad-based situational landscape (Macro) and the narrow asymmetric-attention landscape (Social Arbitrage) in the same workflow.

**The asymmetry is not informational** — every input either engine consumes is fully public. **The asymmetry is operational**: we systematically run two engines that no human and no institutional team systematically combines — Bridgewater-style scenario research on news and consequence chains AND Camillo-style temporal arbitrage on the organic comment universe — and we surface their outputs jointly, ranked, persisted, audited, and bridged to a tradeable expression. That dual-engine workflow is the entire product.
