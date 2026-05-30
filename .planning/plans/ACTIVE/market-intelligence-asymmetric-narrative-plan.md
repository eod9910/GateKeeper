# Market Intelligence: Asymmetric Narrative Radar

## Purpose

Build Market Intelligence into an early-warning system for investable narratives that are high consequence, undercovered, and beginning to accelerate across niche social channels before they become mainstream consensus.

The goal is not to crawl the whole internet. The goal is to find a small number of asymmetric ideas early enough to matter.

## Core Thesis

The best opportunities often appear first as non-obvious narratives:

- a technology moves from science project to investable market
- a product or brand begins spreading organically
- a policy or market-structure change creates new winners and losers
- a small basket of public companies becomes the clean expression of a theme
- niche communities discuss the shift before mainstream finance prices it

Examples of the desired pattern:

- quantum computing attention before the basket became obvious
- Palantir-style defense/AI narrative formation
- tokenized equities and 24-hour/on-chain trading as market-structure disruption
- consumer product or brand breakout before earnings acceleration is obvious

## Existing System Pieces

The repo already has most of the foundation:

- `backend/data/scenarios/tracked-concepts.json`
  - hand-curated and discovered concepts to monitor
- `backend/data/scenarios/tracked-sources.json`
  - niche communities and source definitions
- `backend/data/scenarios/theme-taxonomy.json`
  - theme-to-exposure mapping for first-order and second-order consequences
- `backend/data/scenarios/coverage-thresholds.json`
  - rewards undercovered tradable names and penalizes mega-covered names
- `backend/data/scenarios/authenticity-weights.json`
  - separates organic attention from promotional/manipulated attention
- `backend/services/social_arbitrage_scoring.py`
  - scores attention, source breadth, coverage edge, authenticity, and confidence
- `backend/scripts/promote_emerging_topics.py`
  - promotes emerging social topics into Market Intelligence scenarios
- `backend/data/market-intelligence.sqlite`
  - stores raw hits, emerging topics, situations, evidence, signals, and exposures
- `frontend/public/market-intelligence.js`
  - displays Market Intelligence scenarios and reports

This plan should extend that system rather than replace it.

## Opportunity Template

An asymmetric narrative candidate should rank highly when it has these traits:

1. Big consequence
   - If true, the scenario changes market structure, company economics, sector demand, or consumer behavior in a meaningful way.

2. Low current awareness
   - The idea is not yet fully reflected in mainstream financial media, sell-side coverage, or consensus positioning.

3. Niche social acceleration
   - Discussion is rising unusually fast in specialist communities, product communities, forums, YouTube, Reddit, StockTwits, Hacker News, 4chan, Bluesky, or similar sources.

4. Tradable exposure
   - The system can map the narrative to public companies, ETFs, sectors, commodities, or baskets.

5. Undercovered expression
   - At least one mapped instrument is lightly covered, smaller, overlooked, or not yet treated as the obvious winner.

6. Verification path
   - The claim can be checked against primary sources, filings, company statements, regulatory documents, product data, or credible reporting.

7. Time delay
   - The market has not fully reacted yet, or the reaction is early enough that confirmation could still produce a tradeable move.

Locked target signal:

```text
undercovered + high-consequence + socially accelerating + tradable + verifiable
```

This is the target signal for the Social Arbitrage / Asymmetric Narrative Radar workstream.

## Intelligence Pipeline

Raw posts, videos, comments, filings, and articles should not become scenarios directly. They should pass through a structured intelligence layer first:

```text
raw source hit
-> emerging claim
-> narrative cluster
-> tradable exposure map
-> Ledger-verified scenario
```

This prevents the system from confusing "a post exists" with "an investable thesis exists."

### Raw Source Hit

A raw source hit is a source artifact stored in `mi_raw_hits`, such as a YouTube transcript, forum post, Hacker News thread, StockTwits post, Yahoo message-board item, RSS article, or macro data release.

StockTwits, Yahoo Finance community posts, and Reddit are fetched by the Social Intelligence pipeline first. The Market Intelligence layer should not scrape them a second time; instead `backend/scripts/run_social_raw_bridge.py` normalizes matched Social Intelligence rows into `mi_raw_hits` so the same database evidence layer feeds concepts, z-scores, narratives, cards, and Ledger reports.

### Emerging Claim

An emerging claim is one extracted idea from one or more raw hits.

Example:

```text
U.S. equities may move toward tokenized, 24-hour/on-chain trading.
```

Candidate fields:

- `claim_id`
- `claim_text`
- `claim_type`
- `source_hit_ids`
- `detected_entities`
- `detected_brands`
- `detected_tickers`
- `detected_themes`
- `event_dates`
- `confidence`
- `verification_status`
- `first_seen_at`
- `last_seen_at`
- `validity_flags`

Claim types:

- `policy_change`
- `technology_adoption`
- `product_adoption`
- `consumer_behavior_shift`
- `market_structure_shift`
- `earnings_demand_signal`
- `supply_chain_signal`
- `risk_signal`

### Narrative Cluster

A narrative cluster groups related claims into an investable thesis candidate.

Example:

```text
Tokenized equities / 24-hour trading / stablecoin settlement infrastructure.
```

Candidate fields:

- `cluster_id`
- `title`
- `summary`
- `primary_theme`
- `claim_ids`
- `source_breadth`
- `attention_velocity`
- `novelty_score`
- `mainstream_coverage_score`
- `undercoverage_score`
- `authenticity_score`
- `tradable_exposure_status`
- `verification_status`
- `mapped_tickers`
- `status`
- `created_at`
- `updated_at`

Cluster statuses:

- `WATCH`
- `RESEARCH`
- `SCENARIO_READY`
- `PROMOTED`
- `INVALIDATED`
- `ARCHIVED`

## Promotion Rules

The radar should use staged promotion so early smoke is visible without pretending it is actionable.

### WATCH

A cluster enters `WATCH` when it has:

- at least one meaningful claim
- at least one source
- a plausible theme, entity, brand, or ticker
- no obvious spam or hard authenticity failure

### RESEARCH

A cluster enters `RESEARCH` when it has:

- two or more meaningful claims, or
- two or more raw hits supporting the same claim, or
- one high-impact source plus a clear verification path
- at least one possible tradable exposure

### SCENARIO_READY

A cluster becomes `SCENARIO_READY` when it has:

- source breadth or primary-source support
- clear tradable exposure
- high consequence score
- undercoverage edge
- no hard authenticity failure
- concrete confirmation and invalidation paths

Only `SCENARIO_READY` clusters should promote into `market_situations` by default.

Required audit flags:

- `OPERATOR_SEEDED`
- `SINGLE_SOURCE_RISK`
- `VERIFY_PRIMARY_SOURCES`
- `POLICY_RUMOR_RISK`
- `NO_GOOD_EXPRESSION`
- `LIKELY_INAUTHENTIC`

## Tokenized Wall Street Example

Narrative:

Tokenized equities, stablecoin banking infrastructure, and crypto legislation may move public equities toward 24-hour or on-chain trading.

Why it matters:

- could disrupt brokerage, exchange, clearing, settlement, custody, and market data economics
- could benefit crypto infrastructure, brokerages, tokenization platforms, and stablecoin rails
- could pressure legacy exchange or clearing economics if settlement and access models change

Potential exposure map:

- beneficiaries: `COIN`, `HOOD`, `IBKR`, stablecoin/crypto infrastructure
- ambiguous/disrupted: `ICE`, `NDAQ`, `CME`, clearing/market-data incumbents
- second-order: payment processors, custody providers, fintech platforms

Required verification:

- SEC speeches and rulemaking
- Senate/House bill text and markup schedule
- OCC/FDIC/banking charter evidence
- company announcements and filings
- exchange/broker product launches

Current status:

- The first tokenized Wall Street scenario was operator-seeded from a YouTube transcript.
- It proved the report path works.
- It was not organically discovered yet.
- The scenario correctly carries `OPERATOR_SEEDED`, `VERIFY_PRIMARY_SOURCES`, and `POLICY_RUMOR_RISK` flags.

## Target Data Lanes

Use three discovery lanes so the engine does not depend only on ticker mentions.

### 1. Ticker-First Lane

Start from the clean universe and existing aliases.

Use when:

- the public company is already known
- a basket is already known
- we want daily monitoring on clean-universe symbols

Examples:

- `IONQ`, `RGTI`, `QBTS`, `QUBT`
- `PLTR`
- `COIN`, `HOOD`, `NDAQ`, `ICE`
- consumer names like `BROS`, `CELH`, `ONON`, `ABNB`

### 2. Theme-First Lane

Start from themes that may create investable exposure.

Examples:

- quantum computing commercialization
- defense AI operating systems
- tokenized equities and 24-hour trading
- stablecoin banking infrastructure
- AI data center power demand
- robotics, autonomy, nuclear, uranium, GLP-1 supply chain

The theme is mapped back to public companies through `theme-taxonomy.json`, `brand-to-ticker.json`, and Ledger.

### 3. Brand/Product-First Lane

Start from products, brands, and behavior shifts that may not mention tickers.

Examples:

- "everyone is using this app"
- "I switched to this coffee/energy drink/restaurant"
- "this product is replacing X"
- "this tool is everywhere"
- "customers are cancelling/subscribing/changing behavior"

The system should create an emerging narrative first, then map the brand/product to public-company exposure later.

## Living Watchlist

The tracked-concept registry should be a living watchlist, not a static list.

Two layers:

- **Seed Watchlist**: curated frontier themes we intentionally listen for now.
- **Organic Expansion**: concepts proposed by the system when repeated unknown phrases, entities, products, or claims appear in raw hits.

The initial asymmetric seed set now includes:

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

Tracking a concept does not mean Ledger believes the thesis. It means the topic is important enough to listen for.

## YouTube Scope

YouTube should be one sensor, not an infinite crawl.

Initial scope:

- targeted search queries from tracked concepts
- known high-signal channels
- Shorts URL normalization into watch URLs
- transcript extraction when available
- comments only for candidates that pass metadata/transcript thresholds
- store canonical fields: original URL, canonical URL, video ID, channel, publish date, transcript, comments, engagement, matched concepts

YouTube hits should usually enter as raw evidence or emerging topics first. A single viral video should not become a high-confidence scenario without corroboration or primary-source verification.

## Scoring Priorities

The Social Arbitrage score should favor:

- attention acceleration
- source breadth
- undercoverage
- novelty
- authenticity
- market confirmation
- clear tradable exposure
- evidence quality

It should penalize:

- single-source narratives
- mega-covered obvious names
- likely promotional campaigns
- no verification path
- no tradable expression
- already-consensus stories

## Social ARB Hunting Criteria

The Social ARB Engine should not treat generic social chatter as the desired signal. The target hunting profile is:

- undercovered tradable companies, not only broad technology themes
- product adoption suddenly appearing in niche communities
- unusual buyer/user enthusiasm that reads like real use, not promotion
- specialist forum chatter from practitioners, buyers, operators, or power users
- YouTube narratives with ticker, company, product, or market-structure implications
- repeated comments that mention real use, demand, procurement, shortages, pricing power, new customers, renewals, churn, migration, or behavior change
- cross-platform migration from niche communities into retail/ticker-indexed communities

Repeated pulses are persistence evidence, not separate ideas. The UI and API should group repeated spike events by concept/card and expose pulse count, source breadth, real-use evidence, ticker/product specificity, and hunting-fit flags. Generic, single-source, well-known themes should remain visible for diagnostics but should not be treated as high-quality Social ARB cards without corroboration.

## Required Outputs

For each promoted scenario, the report should answer:

- What is the narrative?
- Why could it matter financially?
- What evidence exists?
- Is it organic or promotional?
- How covered is it already?
- What public assets are exposed?
- Which names are beneficiaries, losers, or ambiguous?
- What does Ledger say about the mapped companies?
- What would confirm the thesis?
- What would invalidate it?
- Is this monitor, research, or actionable?

## Near-Term Build Plan

1. [x] Inventory and clean the existing Social Arbitrage pipeline.
   - Confirm which sources are actually collecting.
   - Confirm which scenarios are organic versus seeded.
   - Confirm `mi_raw_hits`, `emerging_topics`, and `market_situations` lifecycle.

2. [x] Add the claim and narrative-cluster schema.
   - Add `emerging_claims`.
   - Add `narrative_clusters`.
   - Add `narrative_cluster_claims`.
   - Keep raw source lineage back to `mi_raw_hits`.

3. [x] Build the claim extractor.
   - Input: promising `mi_raw_hits`.
   - Output: structured `emerging_claims`.
   - Use cheap rules first and LLM only for hits that pass relevance thresholds.

4. [x] Build the narrative clusterer.
   - Group claims by theme, entities, semantic similarity, shared tickers, and event dates.
   - Assign `WATCH`, `RESEARCH`, or `SCENARIO_READY`.

5. [x] Add the narrative-cluster promotion bridge.
   - Promote `SCENARIO_READY` clusters into `market_situations`.
   - Preserve cluster lineage and validity flags.

6. [x] Add an asymmetric narrative conviction template.
   - New template should handle multi-company, theme, policy, and market-structure narratives.
   - It should be stricter than single-company catalyst templates.

7. [x] Expand tracked concepts for the current hunting profile.
   - financial tokenization
   - 24-hour trading
   - stablecoin banking infrastructure
   - quantum computing commercialization
   - defense AI operating system
   - consumer product breakout

8. [x] Add YouTube as a managed source lane.
   - Do not crawl all YouTube.
   - Use tracked concept queries and high-signal channels.
   - Store transcript/comment evidence in `mi_raw_hits`.

9. [x] Improve promotion rules.
   - Allow early watchlist candidates.
   - Require corroboration before high confidence.
   - Preserve flags such as `OPERATOR_SEEDED`, `VERIFY_PRIMARY_SOURCES`, and `SINGLE_SOURCE_RISK`.

10. [x] Wire Ledger cross-checks.
   - For mapped tickers, Ledger should use the correct valuation engine and company type.
   - Reports should include fundamental viability, valuation risk, and best expression.
   - Implemented as `GET /api/market-intelligence/narrative-clusters/:id/report` plus a Narrative Radar "Report" action in the Market Intelligence UI.

11. [x] Surface the Narrative Radar in the Market Intelligence UI.
   - `GET /api/market-intelligence/narrative-clusters` lists cluster status, counts, flags, mapped tickers, and updated dates.
   - `GET /api/market-intelligence/narrative-clusters/:id` returns claim lineage for inspection.
   - The Market Intelligence page has a collapsed `Narrative Radar` section so watch/research/promoted clusters are visible before they become standard scenario cards.

## Open Questions

- Should YouTube start with channels, search queries, or both?
- What minimum evidence is required before a scenario surfaces in the main UI?
- Should low-confidence single-source scenarios appear in a separate "Radar" tab?
- How aggressively should mega-covered names be penalized when they are part of a structurally important narrative?
- Should the engine create baskets automatically, or only recommend existing symbols?

## Definition of Success

The system succeeds if it surfaces a small number of undercovered, high-consequence narratives early enough to research and act before they become consensus.

We do not need complete coverage at this stage. We need a cheap, disciplined radar that can find a few real hits, then improve data access and coverage over time.
