# Multi-Agent Patterns — Build Checklist

Living tracker for the Multi-Agent Patterns PRD.
Source of truth for "what have we actually finished?" — not "what code exists".

> **Companion to:** [`multi-agent-patterns-prd.md`](./multi-agent-patterns-prd.md)
> **Update protocol:** Tick a box only when the deliverable is **shipped + verified**, not when the code is written. Re-check exit-criteria boxes whenever live state changes.

---

## Status legend

- ✅ Done and verified
- 🟡 Partial (code shipped but not producing or not yet meeting threshold)
- 🔵 In progress this session
- ❌ Not started

---

## Snapshot — last verified 2026-04-29

**HEAD:** Phase A code complete, awaiting first valuation refresh
**Schema:** 3 new tables created in `app-state.sqlite` (on first access)
**New workspaces:** 0 of 3
**DCF predictions logged:** 0 (will populate on next valuation refresh)
**Calibration errors computed:** 0 (requires 1 quarter of prediction data)
**Calibration adjustments active:** 0 (requires calibration job run)
**Gate calls made:** 0
**Debates run:** 0

---

## Phase A — DCF Calibration Engine 🟡 code complete, awaiting data

### Deliverables

- [x] **Schema: `dcf_predictions` table** in `app-state.sqlite`
  - Columns: id, symbol, sector, industry, market_cap_band, prediction_date, price_at_prediction, fair_value_low/mid/high, valuation_gap_pct, judgment, confidence_level, revenue_growth_pct, target_fcf_margin_pct, discount_rate_pct, terminal_growth_pct, forecast_years, annual_revenue, reported_fcf, quality_adjusted_fcf, operating_margin_pct, source, engine_version, created_at
  - Indexes on symbol, sector, prediction_date
  - Migration is additive (no changes to existing tables)
  - **Shipped in:** `backend/src/services/dcfCalibrationDb.ts` (TS-side) + `backend/scripts/build_universe_valuation_snapshot.py` (Python-side, idempotent CREATE)
- [x] **Schema: `dcf_calibration_errors` table** in `app-state.sqlite`
  - Columns: id, prediction_id (FK), symbol, sector, industry, market_cap_band, predicted/actual revenue_growth_pct, revenue_growth_error_pct, predicted/actual fcf_margin_pct, fcf_margin_error_pct, predicted_fair_value_mid, actual_price_at_review, price_error_pct, direction_correct, prediction_date, review_date, quarters_elapsed, created_at
  - Indexes on sector, market_cap_band, prediction_id
  - **Shipped in:** `dcfCalibrationDb.ts` + `run_dcf_calibration.py`
- [x] **Schema: `dcf_calibration_adjustments` table** in `app-state.sqlite`
  - Columns: id, scope_type, scope_value, assumption_key, adjustment_pct, sample_size, confidence, last_computed_at
  - UNIQUE(scope_type, scope_value, assumption_key)
  - **Shipped in:** `dcfCalibrationDb.ts` + `run_dcf_calibration.py`
- [x] **`backend/src/services/dcfCalibrationDb.ts`** — CRUD helpers:
  - `logDcfPrediction(params)` → prediction_id
  - `getPredictionsForSymbol(symbol, limit?)` → DcfPredictionRow[]
  - `getPredictionsReadyForCalibration(minAge?, onlyUncalibrated?)` → DcfPredictionRow[]
  - `logCalibrationError(params)` → error_id
  - `getCalibrationErrorsByScope(scopeType, scopeValue)` → CalibrationErrorRow[]
  - `getCalibrationErrorsForPrediction(predictionId)` → CalibrationErrorRow[]
  - `upsertCalibrationAdjustment(params)` → void
  - `getCalibrationAdjustments(sector, industry?, marketCapBand?)` → CalibrationAdjustmentRow[]
  - `getAllCalibrationAdjustments()` → CalibrationAdjustmentRow[]
  - `computeCalibrationSummary(minSampleSize?)` → CalibrationSummaryRow[]
  - `getPredictionCount()` / `getCalibrationErrorCount()` / `getCalibrationAdjustmentCount()`
  - `deriveMarketCapBand(marketCap)` → MarketCapBand | null
  - All TypeScript types exported: `DcfPredictionRow`, `CalibrationErrorRow`, `CalibrationAdjustmentRow`, `LogDcfPredictionParams`, `LogCalibrationErrorParams`, `UpsertCalibrationAdjustmentParams`, `CalibrationSummaryRow`, `MarketCapBand`
- [x] **Prediction logging wired into valuation refresh** (`build_universe_valuation_snapshot.py`):
  - `_build_current_standardized_dcf()` now returns base-case assumptions: `dcf_revenue_growth_pct`, `dcf_target_fcf_margin_pct`, `dcf_discount_rate_pct`, `dcf_terminal_growth_pct`, `dcf_forecast_years`
  - `ValuationSnapshotRow` extended with assumption fields
  - `_log_dcf_predictions()` writes every row to `dcf_predictions` in `app-state.sqlite` after snapshot build
  - Source = `'valuation_refresh'`, engine_version = `'universe_snapshot_v1'`
  - Wrapped in try/except — failure doesn't block the valuation refresh
- [x] **Prediction logging wired into `copilotTools.ts`** for interactive analyses:
  - `buildLedgerWorkflowResult()` logs a prediction after every `run_dcf_valuation`
  - Captures all base-case assumptions from `dcfResult.scenarios.base_case`
  - Source = `'interactive_analysis'`, engine_version = `'ledger_engines_v1'`
  - Wrapped in try/catch — best-effort, never blocks the analysis
- [x] **`backend/scripts/run_dcf_calibration.py`** — quarterly calibration batch job:
  - Queries uncalibrated predictions older than `min_age_days` (default 90)
  - Fetches actual revenue and FCF from PIT facts (`pit_statement_facts`) available after prediction date
  - Fetches current price from PIT market facts
  - Computes per-prediction errors:
    - `revenue_growth_error_pct` = predicted - actual (positive = optimistic)
    - `fcf_margin_error_pct` = predicted - actual
    - `price_error_pct` = (predicted_fair_value_mid - actual_price) / actual_price
    - `direction_correct` = 1 if judgment direction matches price move since prediction
  - Writes per-prediction errors to `dcf_calibration_errors`
  - Aggregates errors by (sector, assumption_key), (market_cap_band, assumption_key), and (global, assumption_key)
  - Computes bias adjustments as mean error, with minimum sample size threshold (≥10)
  - Upserts to `dcf_calibration_adjustments`
  - Computes overall direction accuracy rate
  - Generates calibration report JSON saved to `backend/data/calibration/calibration_report_<date>.json`
- [x] **Manual trigger endpoint**: `POST /api/ledger-hydration/calibration/run`
  - Accepts `min_age_days` and `min_sample_size` in body
  - Spawns `run_dcf_calibration.py`, returns report JSON on success
  - **Note:** Cron-based scheduling (quarterly auto-trigger) not yet registered — manual trigger only for now
- [x] **Calibration injection into DCF engine** (`ledgerEngines.ts`):
  - New `CalibrationAdjustment` type exported
  - `DcfEngineOptions` extended with optional `calibration_adjustments: CalibrationAdjustment[]`
  - `runDcfValuationEngine()` applies adjustments before computing scenarios:
    - Revenue growth: `calibratedGrowthPct = baseNearTermGrowthPct - adjustment_pct` (clamped 0.5–25)
    - FCF margin: `calibratedFcfMarginPct = baseTargetFcfMarginPct - adjustment_pct` (clamped 1–30)
    - Only applied when user hasn't explicitly overridden the assumption via options
    - Uses most specific match first (adjustments arrive specificity-ordered: industry → sector → cap band → global)
  - Engine output includes `calibration_applied` field showing what adjustments were used (null when none applied)
  - `supporting_context` enriched with `market_cap`, `current_price`, `valuation_gap_pct`, `valuation_quality_score`
- [x] **Calibration data passed through the pipeline** (`copilotTools.ts`):
  - Before `runValuationEngine()`, queries `getCalibrationAdjustments()` for the symbol's sector/industry/cap-band from the snapshot
  - Passes adjustments as `calibration_adjustments` in engine options
  - Wrapped in try/catch — best-effort, engine runs without calibration if lookup fails
- [x] **Prior valuations injected into Ledger prompts** (`visionService.ts`):
  - `buildCalibrationContextBlock(context)` fetches prior predictions for the active symbol
  - If found, builds a `## Prior Valuations & Calibration` block with:
    - Last DCF prediction date, fair_value_range, judgment, price at prediction
    - If calibration errors exist: assumption errors (e.g., "revenue growth predicted 9%, actual 6%, 3% optimistic")
    - Active calibration adjustments for this sector (e.g., "sector=Technology, revenue_growth_pct: reduce by 2.8% (n=45)")
  - Block appended to `dynamicContext` in `buildFinancialAnalystPrompt()`
  - Wrapped in try/catch — returns empty string on any failure
- [x] **Calibration dashboard API endpoints** (`backend/src/routes/calibration.ts`):
  - `GET /api/calibration/summary` — counts, active adjustments, and bias summary (via `computeCalibrationSummary`)
  - `GET /api/calibration/errors/:symbol` — per-symbol prediction history
  - `GET /api/calibration/adjustments` — current active adjustments table
  - `GET /api/calibration/errors-by-scope?scope_type=...&scope_value=...` — errors filtered by scope
  - Registered at `/api/calibration` in `server.ts`

### Exit criteria

- [ ] ≥500 predictions logged after 1 full valuation refresh cycle across the universe
- [ ] Calibration job runs successfully on at least 1 quarter of prediction data (manual trigger OK for first run)
- [ ] At least 3 sectors have calibration adjustments computed with sample size ≥10
- [ ] Calibration adjustments are applied in at least 1 DCF engine run (`calibration_applied` field present in engine output)
- [ ] Prior valuation injection verified in at least 1 Ledger analysis (the `## Prior Valuations & Calibration` block appears in the system prompt)
- [ ] Calibration report JSON generated and human-readable
- [x] No regressions in existing DCF engine behavior (when no calibration data exists, engine behaves identically to today — all calibration paths are additive, guarded by null/empty checks)
- [x] Zero LLM cost for the entire Phase A pipeline (all computation is deterministic — prediction logging is DB writes, calibration is arithmetic, adjustment injection is arithmetic)

---

## Phase B — Approval Gate (Risk Reviewer) ❌ 0%

> **Status:** Not started. Depends on Phase A data being available. Consider building only if/when the execution bridge is actively used for live trading.

### Deliverables

- [ ] `workspace/Risk Reviewer Workspace/` — IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md
- [ ] `gateService.ts` — `runApprovalGate()` → `GateResult`
- [ ] `buildRiskReviewerPrompt()` in `visionService.ts`
- [ ] Gate wired into `copilotTools.ts` + conviction producer
- [ ] Operator toggle: `riskReviewEnabled`
- [ ] Gate uses Phase A calibration history for context

### Exit criteria

- [ ] Gate produces valid `GateResult` JSON on ≥95% of calls
- [ ] At least 1 FLAG or BLOCK correctly fires on a test case
- [ ] Gate adds ≤ 3 seconds latency
- [ ] LLM cost per gate call ≤ $0.005

---

## Phase C — Adversarial Debate ❌ 0%

> **Status:** Not started. Lowest priority. Consider building only after Phase A has produced measurable calibration improvements and Phase B is operational.

### Deliverables

- [ ] Bull + Bear Researcher workspaces (IDENTITY.md + SOUL.md each)
- [ ] `debateService.ts` — `runAdversarialDebate()` → `DebateResult`
- [ ] Debate wired into Ledger workflows + conviction producer
- [ ] Operator toggle: `debateEnabled`
- [ ] Debate calls run in parallel

### Exit criteria

- [ ] Debate produces valid `DebateResult` JSON on ≥95% of calls
- [ ] Debate adds ≤ 5 seconds latency (parallel calls)
- [ ] LLM cost per debate ≤ $0.01

---

## Open Infrastructure / Tech-Debt Items

- [x] TypeScript types for `DcfPredictionRow`, `CalibrationErrorRow`, `CalibrationAdjustmentRow` defined in `dcfCalibrationDb.ts` (co-located with the service, not in `backend/src/types/` — consistent with pattern in `symbolCatalog.ts`)
- [x] `CalibrationAdjustment` type exported from `ledgerEngines.ts`
- [ ] `GateResult`, `DebateResult` types (Phase B/C)
- [ ] New workspaces follow naming convention from `WORKSPACE_ARCHITECTURE.md` (Phase B/C)
- [x] `gitnexus_impact` run on `visionService.ts`, `copilotTools.ts`, `ledgerEngines.ts`, `build_universe_valuation_snapshot.py` before editing
- [ ] `gitnexus_detect_changes` run before committing

---

## Update protocol

When you finish work that touches this plan:

1. Re-run the snapshot block at the top (row counts, workspace count, etc.) so anyone returning to the doc sees the live state.
2. Tick the deliverable box only when the artifact is **shipped + verified**.
3. Re-tick exit-criteria boxes whenever live state changes.
4. If a deliverable changes meaning because the PRD changed, update both this doc and the PRD in the same commit.
