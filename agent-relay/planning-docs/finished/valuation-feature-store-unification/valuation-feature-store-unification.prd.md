# Valuation Feature Store Unification PRD

Checklist: valuation-feature-store-unification-checklist.md

## Purpose

Make valuation data easy and safe for every app surface to find by creating one canonical doorway for valuation features.

This workstream exists because the Fundamental Backtester exposed `DCF gap %` as a selectable metric before it was connected to the existing PIT valuation engine. The data existed, but it was spread across `dcf_predictions`, PIT statement facts, current valuation snapshots, valuation primitives, and research outputs. The app should not require every feature to know that storage map.

## Problem

Valuation data is currently useful but balkanized:

- `backend/data/app-state.sqlite.dcf_predictions` stores recent valuation predictions.
- `backend/data/fundamentals-pit.sqlite` stores PIT statement and fundamental facts needed to rebuild historical valuation.
- `backend/data/research/valuation_universe_snapshot.json` stores current valuation snapshot exports.
- `backend/services/plugins/valuation_state_primitive.py` rebuilds historical PIT valuation state.
- Research JSON/CSV files store study outputs but are not canonical app facts.

Because there is no central contract, application surfaces can accidentally read the wrong source or assume fields are already present in a local fact map.

## Goals

- Provide a canonical valuation feature interface for `symbol + asof_date`.
- Preserve point-in-time behavior for historical research and backtests.
- Normalize valuation fields across operating-company DCF, REIT AFFO/NAV, financial ROE/book, sales-scenario, and relative-multiple engines.
- Make coverage explicit: missing valuation is a diagnostic, not silent failure.
- Migrate app consumers toward the canonical doorway before attempting broad database consolidation.

## Non-Goals

- Do not immediately collapse all data into one database.
- Do not delete current research exports or caches.
- Do not rewrite the valuation engine.
- Do not force every date to be precomputed before consumers can use valuation features.

## Canonical Feature Contract

The canonical interface should return:

- `symbol`
- `asof_date`
- `current_price`
- `fair_value_low`
- `fair_value_mid`
- `fair_value_high`
- `valuation_gap_pct`
- `valuation_state`
- `quality_score`
- `quality_grade`
- `coverage_mode`
- `engine_class`
- `source`
- `computed_at` or `prediction_date` when persisted

## Migration Strategy

### Phase 1: Canonical Doorway

Create a service/module that wraps existing valuation sources and exposes one function such as `get_valuation_features(symbol, asof_date, current_price)`.

Initial priority:

- Fundamental Backtester
- Validator valuation primitive
- Market Intelligence valuation cross-check
- Training DCF context tags

### Phase 2: Persisted Feature Table

Add a normalized `valuation_features` table or equivalent app-state table. Backfill rebalance dates first, not every trading day.

### Phase 3: Writer Migration

Have valuation refresh jobs publish into the canonical feature table while preserving current export files for reports.

### Phase 4: Consumer Migration

Move downstream code away from direct reads of valuation snapshots, ad hoc DCF prediction queries, or private primitive imports.

### Phase 5: Coverage Dashboard

Expose valuation coverage by universe/date/source so research tools can explain when valuation features are missing.

## Acceptance Criteria

- Fundamental Backtester can use DCF/valuation rules without knowing where valuation data lives.
- Historical DCF rules use PIT valuation logic and do not leak current valuation backward.
- Zero-result reports show valuation-missing diagnostics when valuation coverage is the reason.
- At least one canonical service/module owns valuation feature retrieval.
- A later implementation can add persistence without changing consumer contracts.
