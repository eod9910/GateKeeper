# Market Intelligence Historical Replay Engine - PRD

Checklist: market-intelligence-historical-replay-checklist.md

Status: ACTIVE
Updated: 2026-06-01

## Purpose

Build a point-in-time historical replay system that tests whether Market Intelligence perturbation signals would have pointed us toward useful trades before the outcome was known.

The first target is the eigen/PCA perturbation layer: find stocks whose price behavior diverged from broad factor structure, then walk forward to measure whether the signal had predictive or triage value.

The current target is broader than the first eigen prototype: make this the Phase 5 proof loop for Market Intelligence. The replay engine should decide which live signals deserve weight, which should be demoted, and what thresholds produce a manageable number of high-quality candidates.

## Current Status - 2026-06-01

The PRD and checklist already exist in `ACTIVE`. Phase 1 price-only eigen replay has a working prototype and a successful smoke run. The next useful work is Phase 2 plus calibration reporting:

- add PIT fundamentals / valuation overlays;
- test revenue growth, revenue acceleration, earnings surprise, and valuation state as cross-filters;
- measure whether social, macro, options, and mixed-engine corroboration improve hit rate where causal data exists;
- convert results into score-weight and threshold recommendations for the live Market Intelligence page.

## Problem

The Market Intelligence page can surface live anomalies, but we do not yet know whether those anomalies are useful. A live card that looks interesting may be noise, a late reaction to public news, or a data artifact.

We need a backtesting-style replay harness that answers:

- Did the signal exist before the move became obvious?
- Did the signal lead to follow-through, reversal, or no edge?
- Did valuation, options flow, social, or macro confirmation improve the hit rate?
- Which thresholds deserve to become live Market Intelligence cards?

## Product Thesis

Market Intelligence should not become another stream of interesting dashboards. It should become a measurable research filter.

The replay engine proves whether a signal earns its place in the live system. A signal can be visually interesting and still fail if it does not improve research prioritization or forward returns.

## Scope

### Phase 1 - Price-Only Eigen Replay

Use only data we already have enough of:

- Clean universe OHLCV CSVs.
- Historical as-of dates.
- Trailing lookback windows.
- PCA/eigen factor model fit only on data available up to the as-of date.
- Residual z-score ranking.
- Forward return windows.

Outputs:

- Replay run JSON.
- Markdown summary.
- Ranked signal table.
- Forward return distribution.
- Threshold study by residual z-score bucket.

### Phase 2 - Point-In-Time Fundamental and Valuation Overlay

Attach only information available as of the replay date:

- PIT fundamentals from `fundamentals-pit.sqlite`.
- Company classification where available.
- Valuation engine class where available.
- Recomputed as-of valuation where feasible.
- Current valuation snapshots are not allowed for historical replay except as a clearly marked non-PIT diagnostic.

Outputs:

- Signal performance by valuation state.
- Signal performance by company type and valuation engine.
- "Undervalued positive perturbation" and "overvalued negative perturbation" studies.

### Phase 3 - Limited Social / Market Intelligence Overlay

Use dated social and MI data only when collection/fetch time makes it causal:

- `posted_at` is not enough if the post was fetched later.
- `fetched_at <= as_of_date` is required for strict replay.
- Older backfilled data may be used only in a separate "historical content study" mode.

Outputs:

- Performance with and without social confirmation.
- Source reliability by platform.
- Coverage gaps report.

### Phase 4 - Options Flow Overlay

Use options flow only for dates where we have real historical option snapshots.

Current state is recent only, so the immediate requirement is to start collecting daily option snapshots going forward. Historical vendor data can be added later if budget allows.

Outputs:

- Performance by call-heavy / put-heavy / balanced flow.
- Performance by imbalance tier.
- Cross-signal results: eigen + options + valuation.

## Non-Goals

- Do not claim a live trading strategy from Phase 1.
- Do not use future data in replay.
- Do not optimize thresholds until the signal looks good without separating train/test periods.
- Do not use current valuation snapshots as historical truth.
- Do not treat backfilled social posts as if they were collected historically.

## Data Availability Assessment

### Enough for Phase 1

Clean-universe OHLCV covers roughly 2021-02-19 through 2026-05-08 across 4,313 clean symbols. This is enough to replay two-year-old dates and walk forward.

### Enough for Phase 2, With Work

`fundamentals-pit.sqlite` contains PIT facts with `available_at`, filing dates, and statement facts going back many years. The replay engine must query as-of facts instead of using current snapshots.

### Partial for Phase 3

Social Intelligence has old dated records, but Market Intelligence raw fetch history is mostly recent. Replay must distinguish:

- strict causal evidence: fetched before or on as-of date;
- historical content evidence: posted before as-of but fetched later.

### Not Enough for Historical Phase 4

Options-flow snapshots currently cover only recent dates. Start daily collection now, and treat options replay as forward-building until better historical data is available.

## Core Rules

1. On replay date `T`, every feature must be computed from data available on or before `T`.
2. PCA must be fit only on trailing returns ending at `T`.
3. Survivorship bias must be acknowledged when using today's clean universe.
4. Each replay run must store configuration, universe, data cutoffs, and code version metadata.
5. Every output must separate signal discovery metrics from trade simulation metrics.

## Replay Inputs

- `as_of_start`
- `as_of_end`
- `rebalance_frequency`
- `lookback_days`
- `factor_count`
- `max_symbols`
- `min_price`
- `min_dollar_volume`
- `residual_z_thresholds`
- `forward_windows`
- `overlay_mode`: `price_only`, `pit_valuation`, `social_diagnostic`, `options_available`

## Replay Outputs

Each replay run should produce:

- Run metadata.
- Data availability summary.
- Signal table.
- Forward returns per signal.
- Aggregate return table by horizon.
- Hit-rate table by threshold.
- Decile/bucket table.
- Cross-signal overlay table.
- Top historical examples.
- Failure/artifact table.

## Success Criteria

The replay engine is useful if it can answer these questions with evidence:

- Are high absolute residual z-score movers worth investigating?
- Is continuation or reversal more common?
- Do valuation overlays improve selection?
- Do options/social overlays improve selection where available?
- What threshold produces a manageable number of live cards?
- Which signals should be promoted into Market Intelligence and which should be killed?
- Which fundamental filters matter more: revenue, earnings surprise, valuation state, quality, or liquidity?
- Do `mixed_*` corroborated scenarios outperform single-engine signals enough to justify a ranking bonus?
- What hold period works best by signal family: 1 week, 1 month, 3 months, 6 months, or 1 year?

## Initial Recommendation

Phase 1 is already prototyped. Continue with Phase 2 PIT valuation/fundamental overlays, then add calibration tables that compare signal families and combinations. Options/social replay should be added carefully after collection gaps are addressed.

The first "decision-grade" report should not just say whether eigen perturbation works. It should rank combinations such as:

- eigen residual only;
- eigen + undervalued;
- eigen + revenue growth;
- eigen + revenue acceleration;
- eigen + positive earnings surprise;
- depressed price + revenue acceleration;
- social buzz + improving fundamentals;
- macro scenario + exposed ticker + valuation support;
- mixed-engine corroboration vs single-engine signal.

## Related Plans

- `agent-relay/planning-docs/ongoing/backtesting-master.md`
- `agent-relay/planning-docs/ongoing/market-intelligence-scenario-engine-checklist.md`
- `agent-relay/planning-docs/ongoing/market-intelligence-scenario-engine-prd.md`
- `agent-relay/planning-docs/ongoing/ledger-data-foundation-and-pit-ingestion-prd.md`
- `agent-relay/planning-docs/ongoing/ledger-source-priority-matrix.md`
