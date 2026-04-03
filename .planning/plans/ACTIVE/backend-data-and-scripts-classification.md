# Backend Data And Scripts Classification

Date: 2026-04-02

## Purpose

Classify the remaining dirty items in:

- `backend/data`
- `backend/scripts`

after the first artifact/noise cleanup pass.

This is a classification pass, not a delete/revert pass.

## Summary

After ignoring obvious generated artifacts, the remaining dirty items in `backend/data` and `backend/scripts` are mostly **real source or research assets**, not disposable runtime clutter.

That means:

- `backend/scripts` should mostly remain visible as source work
- much of `backend/data` is acting as configuration / registry / research-definition source
- only a small subset of `backend/data` is still “special local state”

## `backend/scripts` Classification

### Classification: `active-source`

The current dirty `backend/scripts` files are overwhelmingly source utilities and research/build pipelines.

Examples:

- universe builders
  - `build_clean_universe.py`
  - `build_large_cap_universe.py`
  - `build_ledger_filing_eligible_universe.py`
  - `build_mixed_cap_validation_ladder.py`
  - `build_regime_universes.py`
  - `rebuild_stock_universes.py`
  - `update_universe.py`

- PIT / fundamentals / SEC ingestion
  - `build_fundamentals_pit_store.py`
  - `hydrate_fundamentals_pit.py`
  - `import_companyfacts_to_pit.py`
  - `populate_cap_tier_pit.py`
  - `run_fundamental_smoke_test.py`
  - `run_fundamental_validator_trial.py`

- SR / regime / validation research
  - `analyze_expectancy_drop.py`
  - `analyze_regime_performance.py`
  - `analyze_trade_regimes.py`
  - `run_sr_indicator_demo.py`
  - `run_sr_research.py`
  - `audit_validation_lists_against_clean.py`
  - `normalize_validation_fallbacks.py`

- utilities / maintenance
  - `check_name_bytes.py`
  - `check_snapshot.py`
  - `fix_encoding_all_strategies.py`
  - `fix_encoding_deep.py`
  - `fix_hs_strategies.py`
  - `warmup_cache.py`
  - `warmup_cache.bat`
  - `install_cache_warmup_task.ps1`
  - `REGISTER_TASK_AS_ADMIN.bat`

### Conclusion For `backend/scripts`

Do **not** treat these as clutter.

They are best classified as:

- `active-source`
- `review-later-by-initiative`

They should stay visible unless we later reorganize them by domain into subfolders such as:

- `scripts/universe/`
- `scripts/fundamentals/`
- `scripts/research/`
- `scripts/maintenance/`

That would be a future codebase organization pass, not immediate repo-state cleanup.

## `backend/data` Classification

The remaining `backend/data` items split into three categories.

### 1. Durable Definition / Registry Source

These should be treated as source-like assets, not generated clutter.

#### Pattern Definitions

- `backend/data/patterns/*.json`

Examples:

- `atr_primitive.json`
- `fundamental_quality_filter_primitive.json`
- `hs_pullback_continuation.json`
- `lth_continuation_composite.json`
- `ma_base_detector_indicator.json`
- `ma_base_detector_primitive.json`
- `sr_score_primitive.json`
- modified existing pattern definitions

These are product/research definitions and should remain visible.

#### Strategy Definitions

- `backend/data/strategies/*.json`

Examples:

- `base_box_detector_rdp_v1_pattern_v1.json`
- `head_shoulders_context_pattern_v1.json`
- `hs_pullback_continuation_v1.json`
- `lth_continuation_composite_v1.json`
- `pullback_uptrend_entry_composite_v2_stateful.json`
- modified MACD / Wyckoff / pullback strategy files

These are also durable assets, not cache noise.

#### Formula / Regime / Registry Files

- `backend/data/regime_*.json`
- `backend/data/sr_formulas.json`
- `backend/data/scanner_metric_source_registry.json`
- `backend/data/universal_sweep_dims.json`
- `backend/data/symbols.json`
- `backend/data/app-reference.md`

These should also be treated as durable source/configuration.

### 2. Durable Local Data Assets

These are not source code, but they appear to be intentionally generated datasets worth preserving locally.

Examples:

- universe snapshot JSONs
- market-cap bucket lists
- ledger eligibility outputs
- local PIT database

These were already locally excluded in `.git/info/exclude` where appropriate.

They should be classified as:

- `durable-local-data`

not:

- `disposable-artifact`

### 3. Special Local State / Runtime State

These are the main remaining `backend/data` files that still behave like noisy local state.

#### `backend/data/execution-bridge-config.json`

This is a tracked local state/config file and remains noisy.

Classification:

- `special-local-state`

This file is not handled by `.gitignore` because it is already tracked.

If we want it to stop polluting the worktree long-term, we need a deliberate architectural change later, such as:

- moving mutable runtime state out of tracked config
- or introducing a template/default plus local override pattern

We should **not** try to hide or rewrite that behavior casually in this repo-state pass.

## What Was Successfully Cleaned Already

These buckets are now out of the main status surface:

- benchmark outputs
- stderr/log outputs
- caches
- sweep output files
- local filing corpus
- local PIT/universe snapshot assets

So the remaining `backend/data` surface is much more legitimate than it looked before.

## Recommended Interpretation Going Forward

### Treat As Source / Reviewable Work

- `backend/scripts/**`
- `backend/data/patterns/**`
- `backend/data/strategies/**`
- `backend/data/regime_*.json`
- `backend/data/sr_formulas.json`
- `backend/data/scanner_metric_source_registry.json`
- `backend/data/symbols.json`

### Treat As Durable Local Data

- local PIT DB
- universe list snapshots
- filing eligibility outputs
- local `Financial data/` corpus

### Treat As Special Local State

- `backend/data/execution-bridge-config.json`

## Immediate Next Step

Do **not** keep trying to “clean” `backend/scripts` as if it were noise.

The next useful cleanup decision should instead be:

- whether to do a future **directory reorganization pass** for scripts and data definitions

That would be a codebase-structure improvement, not repo-state triage.
