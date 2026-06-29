# Unified Symbol Catalog Checklist

Percent complete: 0%

Status: TODO
PRD: `unified-symbol-catalog-prd.md`

## Scope

- [ ] Confirm the current Scanner, Co-Pilot, and Validator symbol catalog sources.
- [ ] Confirm the target master catalog location and key naming contract.
- [ ] Preserve `smallcaps` as the canonical small-cap category key.

## Backend

- [ ] Create `backend/data/symbols.json` as the master catalog.
- [ ] Merge all current Scanner hardcoded categories into the master catalog.
- [ ] Deduplicate and sort the `all` symbol list.
- [ ] Update `GET /api/candidates/symbols` to read from `backend/data/symbols.json`.
- [ ] Keep the endpoint URL unchanged.
- [ ] Remove or retire the old `backend/services/symbols.json` file after verification.

## Scanner

- [ ] Replace the hardcoded Scanner `symbolLists` source with an API-loaded catalog.
- [ ] Load the catalog before symbol autocomplete initialization.
- [ ] Preserve manual symbol entry when catalog loading fails.
- [ ] Verify batch scan still reads the selected category correctly.

## Co-Pilot

- [ ] Replace hardcoded `COPILOT_SYMBOL_LISTS` with an API-loaded catalog.
- [ ] Load the catalog before Co-Pilot autocomplete initialization.
- [ ] Preserve manual symbol entry when catalog loading fails.

## Validator

- [ ] Verify Validator category library receives the full catalog from the existing endpoint.
- [ ] Add or confirm an "Add All in Category" flow for Validator universe selection.
- [ ] Add or confirm warning behavior when submitting with an empty intended universe.
- [ ] Fix the empty-list fallback bug in `validatorPipeline.py`.

## Verification

- [ ] API returns all expected categories including futures and smallcaps.
- [ ] Scanner autocomplete works from the API catalog.
- [ ] Scanner smallcaps batch scan runs against the full smallcap list.
- [ ] Co-Pilot autocomplete works from the API catalog.
- [ ] Validator Small Caps category is populated.
- [ ] Validator runs the selected universe instead of silently falling back to SPY/QQQ.
- [ ] Backend/catalog failure does not break manual symbol entry.
