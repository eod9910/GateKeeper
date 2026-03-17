# Plans vs Code Audit Checklist

Audit date: 2026-02-14  
Scope: all `*.md` under `.planning/plans` (50 files).  
Method: compared each plan to current code artifacts in `backend/` + `frontend/public/` and marked implemented vs not fully implemented.

Legend:
- `[x]` Implemented (or doc-only/reference plan already realized in codebase)
- `[ ]` Not fully implemented (partial, pending, or superseded with remaining gaps)

## Implemented

- [x] `.planning/plans/validator-v1-board/README.md`
- [x] `.planning/plans/validator-v1-board/17-session-update-2026-02-13-late.md`
- [x] `.planning/plans/validator-v1-board/16-remediation-report-2026-02-13.md`
- [x] `.planning/plans/validator-v1-board/15-implementation-report.md`
- [x] `.planning/plans/validator-v1-board/14-cutover-checklist.md`
- [x] `.planning/plans/validator-v1-board/13-ticket-HARDEN-001-input-validation.md`
- [x] `.planning/plans/validator-v1-board/12-ticket-QA-002-spec-hash-parity-test.md`
- [x] `.planning/plans/validator-v1-board/11-ticket-QA-001-fixtures-and-regression-suite.md`
- [x] `.planning/plans/validator-v1-board/10-ticket-GT-001-production-gate-enforcement.md`
- [x] `.planning/plans/validator-v1-board/09-ticket-UI-001-validator-live-run-states.md`
- [x] `.planning/plans/validator-v1-board/08-ticket-API-001-validator-run-contract-v2.md`
- [x] `.planning/plans/validator-v1-board/07-ticket-PL-002-async-jobs-and-progress.md`
- [x] `.planning/plans/validator-v1-board/06-ticket-PL-001-validator-pipeline-and-passfail.md`
- [x] `.planning/plans/validator-v1-board/05-ticket-RB-002-montecarlo-and-sensitivity.md`
- [x] `.planning/plans/validator-v1-board/04-ticket-RB-001-oos-and-walkforward.md`
- [x] `.planning/plans/validator-v1-board/03-ticket-BE-003-tradeinstance-persistence.md`
- [x] `.planning/plans/validator-v1-board/02-ticket-BE-002-execution-rules-in-backtest.md`
- [x] `.planning/plans/validator-v1-board/01-ticket-BE-001-causal-backtest-engine.md`
- [x] `.planning/plans/validator-v1-board/00-roadmap.md`
- [x] `.planning/plans/validator-pipeline-anatomy.md`
- [x] `.planning/plans/strategy-section-breakdown.md`
- [x] `.planning/plans/strategy-scanner-refactor.md`
- [x] `.planning/plans/strategy-authoring-guide.md`
- [x] `.planning/plans/rdp-swing-detection.md`
- [x] `.planning/plans/fix-validator-universe-bug.md` (implemented/superseded by tiered flow)
- [x] `.planning/plans/fix-validator-progress.md`
- [x] `.planning/plans/energy-indicator-v2.md`
- [x] `.planning/plans/discount-zone-scanner.md`
- [x] `.planning/plans/discount-zone-entry-criteria.md`
- [x] `.planning/plans/auto-pnl-calculator.md`
- [x] `.planning/plans/ai-app-knowledge.md`
- [x] `.planning/plans/4-layer-verdict-engine.md`

## Not Fully Implemented

- [ ] `.planning/plans/validator-system.md`
  - Remaining gaps: strategy-health dashboard/longitudinal reporting called out in Phase 6; checklist in file still not fully reconciled.
- [ ] `.planning/plans/validator-build-report.md`
  - Outdated status text (Phase 1 complete / Phase 2 partial) vs current code now beyond that; report itself not updated.
- [ ] `.planning/plans/unified-symbol-catalog.md`
  - Partially unified (`/api/candidates/symbols` exists), but not fully centralized to a dedicated shared symbol service contract across all consumers.
- [ ] `.planning/plans/structure-detection-reference.md`
  - Reference has stale statements (e.g., “only one pattern type implemented”) vs current plugin set.
- [ ] `.planning/plans/strategy-copilot-metaprompt.md`
  - Co-pilot exists, but plan checklist in file is not fully closed; prompt-governance completeness not fully verifiable as done.
- [ ] `.planning/plans/Regime-Aware, Structure-First Backtesting Framework.md`
  - Phase/regime permissioning and per-phase enforcement framework not fully wired as specified.
- [ ] `.planning/plans/python-execution-layer.md`
  - Major planned components are missing (e.g., `plugin_service.py`, `sandbox.py`, `numba_indicators.py`, dedicated plugin service client).
- [ ] `.planning/plans/plugin-workshop-build-plan.md`
  - Core workshop is built (`workshop.html/js`, plugin routes), but full hard sandboxing and all planned production hardening items are not complete.
- [ ] `.planning/plans/plugin-system-architecture.md`
  - Partial: registry + plugin routes exist; full architecture items (all selector/injection flows, duplicate prevention logic, robust sandbox posture) are not fully complete.
- [ ] `.planning/plans/Pending/validation_report_spec.md`
  - Report pipeline exists, but this spec remains in Pending and is not fully ratified as the enforced canonical schema.
- [ ] `.planning/plans/Pending/strategy_hypothesis_schema.md`
  - Not implemented as an enforced schema contract in active request validation.
- [ ] `.planning/plans/Pending/scanner-page-mockup-v1.md`
  - Mockup plan remains pending by design; not fully translated into a finalized production layout spec.
- [ ] `.planning/plans/Pending/operator_behavior_audit/operator_behavior_audit.md`
  - Operator behavior audit system not implemented end-to-end.
- [ ] `.planning/plans/Pending/indicator-studio-library-plan.md`
  - Partial: Indicator Studio + Library tabs exist; full downstream integration/flows in plan are not fully complete.
- [ ] `.planning/plans/Pending/indicator-library-external-memory-plan.md`
  - Not complete: external markdown memory file workflow and read-before-generate AI behavior is not fully implemented.
- [ ] `.planning/plans/Pending/indicator-library-execution-plan.md`
  - Partial: execution flow exists for build/test/register, but full phased execution plan (all guardrails/automation) is not fully complete.
- [ ] `.planning/plans/Pending/ai_role_contracts.md`
  - AI role contracts are not fully enforced as runtime policy contracts in code.
- [ ] `.planning/plans/design-system-v4.md`
  - Significant convergence done, but not fully complete across all pages/components per the strict V4 spec.

## Code Evidence Used (primary)

- `backend/src/routes/validator.ts` (tiered validation, async jobs, progress, run contract, pass gating)
- `backend/services/validatorPipeline.py` (real pipeline, robustness, progress events)
- `backend/services/backtestEngine.py` (causal bar-by-bar backtest, execution rules)
- `backend/services/strategyRunner.py` (strategy/plugin execution path)
- `backend/src/routes/plugins.ts` + `frontend/public/workshop.html` + `frontend/public/workshop.js` (Indicator Studio builder/library)
- `frontend/public/strategy.html` + `frontend/public/strategy.js` (Edit Strategy, tiered run modal from strategy page)
- `frontend/public/validator.html` + `frontend/public/validator.js` (live run states, progress UI)
- `frontend/public/index.html` + `frontend/public/index.js` (scanner pages, training/saved/settings, discount flows)
- `frontend/public/history.js` + `frontend/public/copilot.js` + `backend/src/services/executionEngine.ts` (instrument-aware P&L stack)
