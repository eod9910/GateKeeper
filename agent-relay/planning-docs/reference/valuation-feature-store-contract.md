# Valuation Feature Store Contract

Analysis date: 2026-06-02

## Purpose

Valuation data must be accessed through a canonical feature-store doorway instead of direct reads from one-off snapshots, primitive internals, or research outputs.

Python research tools use:

```python
from valuation_feature_store import get_valuation_features

features = get_valuation_features(symbol, asof_date, current_price)
```

## Canonical Fields

The normalized feature record is:

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

Persisted rows live in `backend/data/app-state.sqlite` table `valuation_features`.

## Current Implementation

The first implementation is `backend/services/valuation_feature_store.py`.

It supports:

- `ensure_valuation_feature_schema()`
- `get_valuation_features(...)`
- `get_persisted_valuation_features(...)`
- `upsert_valuation_features(...)`
- `valuation_feature_coverage(...)`

For historical point-in-time valuation, the current compute backend is the existing `valuation_state_primitive` logic. Consumers should not import that primitive directly for valuation facts.

## Current Source Inventory

- `backend/data/app-state.sqlite.dcf_predictions`: recent valuation prediction log.
- `backend/data/app-state.sqlite.valuation_features`: canonical persisted feature rows.
- `backend/data/fundamentals-pit.sqlite.pit_statement_facts`: historical PIT statement facts used to rebuild valuation.
- `backend/data/fundamentals-pit.sqlite.pit_fundamental_facts`: historical fundamental facts.
- `backend/data/research/valuation_universe_snapshot.json`: current/latest valuation export.
- `backend/services/plugins/valuation_state_primitive.py`: PIT valuation compute backend.
- Research JSON/CSV files: study outputs, not canonical app facts.

## Migrated Consumers

- `backend/scripts/run_fundamental_backtester.py`
- `backend/services/fundamentals_pit_query.py`

## Known Direct Consumers To Migrate Later

- TypeScript app surfaces using `getSymbolValuationSnapshot(...)` for current valuation display can continue temporarily, but new code should prefer a TypeScript companion to the feature-store contract.
- Standalone research scripts that read `valuation_universe_snapshot.json` should be migrated when they become app-facing features.
- DCF calibration code may keep using `dcf_predictions` for prediction-history analytics, but app feature lookup should use `valuation_features`.

## Backfill And Coverage

Use:

```powershell
py backend/scripts/backfill_valuation_features.py --universe clean --start 2024-01-01 --end 2025-12-31 --frequency monthly --limit 500
```

Use `valuation_feature_coverage(...)` or the backfill script output to explain missing valuation coverage.

## Design Principle

Raw sources and research outputs can remain separate. The app should still have one official doorway for valuation facts.
