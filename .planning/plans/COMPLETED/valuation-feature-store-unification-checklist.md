# Valuation Feature Store Unification Checklist

PRD: valuation-feature-store-unification-prd.md

Percent complete: 100% (12 complete, 0 partial, 0 remaining)

## Phase 1: Canonical Doorway

- [x] Create active PRD/checklist pair for the valuation feature store workstream.
- [x] Audit current valuation data locations and coverage.
- [x] Prove historical PIT valuation can return `valuation_gap_pct`, fair value, and state for historical dates.
- [x] Add a canonical valuation feature module/service and wire the Fundamental Backtester through it.
- [x] Add focused tests or smoke fixtures for the canonical valuation feature retrieval path.

## Phase 2: Consumer Migration

- [x] Inventory all direct consumers of valuation snapshots, `dcf_predictions`, and valuation primitive internals.
- [x] Migrate Fundamental Backtester fully off direct valuation primitive imports.
- [x] Identify the next highest-risk consumer and migrate it to the canonical doorway.

## Phase 3: Persistence

- [x] Design the normalized `valuation_features` schema.
- [x] Add a migration/backfill job for rebalance-date valuation features.
- [x] Add coverage reporting by universe/date/source.

## Phase 4: Completion

- [x] Update reference architecture docs with the official valuation data access contract.
- [x] Move this workstream to `COMPLETED/` when the canonical store/interface is adopted by the main app consumers.
