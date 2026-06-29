# Market Intelligence Active Audit - 2026-06-01

## Question

Are the active Market Intelligence planning docs still active work, or did we finish the implementation and forget to update the checklists?

## Short Answer

The Market Intelligence checklist should stay active, but its snapshot data is stale. The scenario-engine PRD is no longer an active execution plan; it should move to `REFERENCE` or get a banner that says the baseline implementation has shipped and the checklist is the live status source.

Phase 0 through Phase 4 are effectively built. Phase 5 is partially built and still genuinely active. Phase 6 is partially built, but local data does not yet prove all advertised brand-signal collectors are operational.

## Implementation Evidence

Live healthcheck:

- `schema_version = 7`, `expected_schema_version = 7`
- `market_situations = 2,097`
- `situation_signals = 2,849`
- `situation_evidence = 2,852`
- `situation_exposure = 1,315`
- `concept_daily_counts = 1,206`
- `emerging_topics = 35`
- `emerging_claims = 876`
- `narrative_clusters = 6`
- `narrative_cluster_claims = 876`

Live data shape:

- `news_cluster = 2,084`
- `topic_anomaly = 5`
- `mixed_anomaly_led = 5`
- `mixed_news_led = 3`
- `EARLY = 2,093`
- `DEVELOPING = 2`
- `CONFIRMED = 1`
- `INVALIDATED = 1`

Raw hit sources present locally:

- Yahoo Finance RSS, Reuters RSS, AP RSS, Federal Reserve RSS, BLS, EIA
- StockTwits, Yahoo community posts
- Hacker News, 4chan, niche forums
- YouTube video metadata and one transcript row
- A small number of Reddit rows exist, but Reddit remains policy-deferred in the checklist

Consumer brand signals present locally:

- `stocktwits_buzz = 935`
- `app_store_rank = 29`
- `app_store_rank_finance = 21`
- `yahoo_buzz = 7`

No local `consumer_brand_signals` rows were found for `google_trends` or `amazon_reviews` during this audit, even though scheduler definitions and scripts exist.

Quality loop data present:

- `scenario_outcomes = 377`
- `theme_quality_snapshots = 18`

## Phase Reconciliation

| Phase | Doc Status | Audit Status | Notes |
| --- | --- | --- | --- |
| Phase 0 - Foundation | Complete | Complete | Schema, registry, API, UI skeleton, and scheduler foundation exist. |
| Phase 1 - Social Arbitrage | Mostly complete | Built but scale gates still open | Collectors, z-score, authenticity, promotion, and operator surfaces exist. Success gates like sustained high-volume ingestion and enough weekly emerging topics are not proven locally. |
| Phase 1.1 - Universe Normalization / Eigen | Mostly complete | Mostly complete | Universe movers, eigen scan, reports, options/social overlays, and convergence UI exist. One remaining gate is automatic promotion of high-z eigen residual movers into scenario candidates. |
| Phase 1.2 - Asymmetric Narrative | Mostly complete | Mostly complete | Claim extraction, cluster builder, promotion, and UI exist. YouTube comments and broader discovery/search remain deferred. |
| Phase 1.5 - Macro Engine | Complete | Complete | Macro ingestion, clustering, scoring, and UI stream exist. Local DB is overwhelmingly populated by `news_cluster` rows. |
| Phase 2 - Exposure Mapping | About 90% | Mostly complete | Exposure API and override flow exist. This is close enough that remaining work is tuning, not core build. |
| Phase 3 - Universe Ranking | About 98% | Mostly complete | Candidate ranking, valuation/buzz joins, conviction layer, and flags exist. One Social Arb mixed-coverage exit criterion remains unproven. |
| Phase 4 - UX | Complete | Complete | Page, filters, panels, detail drawer, Settings scheduler controls, and quality/auxiliary panels exist. |
| Phase 5 - Quality / Research Loop | About 50% | Active | Forward tracking and dashboard exist. Historical replay, calibration, threshold sweeps, and corroboration validation remain real work. |
| Phase 6 - Consumer Brand Signals | About 60% | Active / partly unproven | App Store and buzz bridge have rows. Google Trends and Amazon Reviews code/jobs exist, but local data did not show rows, so the checklist should not treat them as fully proven without a collector run or fixture evidence. |
| Phase 1.7 - Reddit | Blocked | Blocked | Still correctly marked policy-contingent. |

## Recommendation

1. Keep `agent-relay/planning-docs/ongoing/market-intelligence-checklist.md` in `ACTIVE`.
2. Refresh the checklist's counts and verification notes to the current schema v7 / 2,097-situation state.
3. Move `agent-relay/planning-docs/ongoing/market-intelligence-scenario-engine-prd-pdr.md` to `REFERENCE`, or add a top banner that says it is a historical PRD and no longer the live implementation tracker.
4. Keep historical replay and calibration plans active, because they are now the real unfinished Market Intelligence work.
5. Re-run or inspect Google Trends and Amazon review collectors before leaving their checklist items fully checked as "operational."

## Net

We did not fail to build Market Intelligence. The opposite happened: we built a lot of it, then the planning docs stopped reflecting the real state. The remaining work is less "build the page" and more "prove the signals, calibrate the weights, and make sure each collector is actually feeding data."
