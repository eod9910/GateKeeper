# Validator Backtesting Task List + Implementation Audit

Audit Date: 2026-02-15  
Scope: Validator backtesting module

## A. Core Validator Capabilities

- [x] Async validator run jobs with queue/running/completed/failed states  
Evidence: `backend/src/routes/validator.ts:21`, `backend/src/routes/validator.ts:530`

- [x] Run cancellation endpoint and process kill  
Evidence: `backend/src/routes/validator.ts:548`

- [x] Python pipeline execution with structured progress parsing  
Evidence: `backend/src/routes/validator.ts:168`, `backend/src/routes/validator.ts:204`

- [x] Tier progression gates (Tier 2 requires Tier 1 PASS, Tier 3 requires Tier 2 PASS)  
Evidence: `backend/src/routes/validator.ts:503`, `backend/src/routes/validator.ts:509`

- [x] Tier run tags persisted into report config  
Evidence: `backend/src/routes/validator.ts:595`

## B. Asset-Class Tiering (This Session)

- [x] Asset-class-specific Tier 1/2/3 universes in Validator backend  
Evidence: `backend/src/routes/validator.ts:59`

- [x] Effective run universe selected from strategy asset class + selected tier  
Evidence: `backend/src/routes/validator.ts:498`

- [x] Manual universe override ignored for tiered runs  
Evidence: `backend/src/routes/validator.ts:518`

- [x] Tier progression pass check constrained to same asset class  
Evidence: `backend/src/routes/validator.ts:499`, `backend/src/routes/validator.ts:502`

- [x] Report config now stores effective `asset_class` and `universe` used  
Evidence: `backend/src/routes/validator.ts:596`

- [x] Backend tier-config endpoint for UI (`/api/validator/tier-config`)  
Evidence: `backend/src/routes/validator.ts:426`

- [x] Validator UI now loads tier config from backend and displays asset-class-aware symbols  
Evidence: `frontend/public/validator.js:276`, `frontend/public/validator.js:358`

- [x] Validator run status includes asset class + symbol count context  
Evidence: `frontend/public/validator.js:910`

## C. Remaining Work (Not Implemented Yet)

- [x] Early-stop kill rules in Python pipeline (trade-count-based abort conditions)  
Evidence: `backend/services/validatorPipeline.py:576`, `backend/services/validatorPipeline.py:746`

- [ ] Explicit Tier API contract doc update for `/api/validator/tier-config`  
Target: `docs/validator-api-v2.md`

- [ ] Backfill/migration of historical reports missing `config.asset_class`  
Target: one-time data migration script under `backend/scripts/`

- [ ] Add API tests for asset-class tier selection and same-class gate enforcement  
Target: backend route-level automated tests

## D. Execution Order

1. Implement kill-rule early-stop in Python pipeline.
2. Update API docs.
3. Add tests for tier-config + gating behavior.
4. Run migration/backfill for older reports if needed.
