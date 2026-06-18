# Fundamental Run To Parameter Sweep Adapter Checklist

PRD: fundamental-run-to-parameter-sweep-adapter-prd.md

Percent complete: 99% (45 complete, 2 partial, 1 remaining)

## Planning

- [x] Confirm the existing Parameter Sweep can accept a non-technical source type.
- [x] Identify the current sweep session creation API.
- [x] Identify the current sweep config schema.
- [x] Map saved fundamental run fields to sweep session fields.

## Fundamental Backtester UI

- [x] Add `Promote To Sweep` action to saved Research Runs.
- [x] Keep `Promote To Sweep` visually distinct from `View` and `Reload Study`.
- [x] Send saved-run id to the backend promotion endpoint.
- [x] Navigate to the created Parameter Sweep session after promotion.
- [x] Show a clear error if promotion fails.

## Backend Adapter

- [x] Add endpoint to promote a saved fundamental run into a sweep session.
- [x] Load saved fundamental run by id.
- [x] Validate that the saved run has a usable config.
- [x] Convert entry rules into sweep-compatible source metadata.
- [x] Convert exit config into sweep-compatible parameters.
- [x] Preserve original research metrics.
- [x] Preserve original saved-run id.
- [x] Label source type as `fundamental_backtest_run`.
- [x] Return destination session id or URL.

## Parameter Sweep Integration

- [x] Add fundamental source metadata display.
- [x] Show original tested rules.
- [x] Show original research score and core metrics.
- [x] Generate default fundamental sweep dimensions.
- [x] Allow EPS surprise threshold sweep.
- [x] Allow revenue acceleration threshold sweep.
- [x] Allow sales surprise threshold sweep.
- [x] Generate sweep knobs from all numeric entry rules, including price drawdown.
- [x] Allow preset values and custom added values for fundamental sweep knobs.
- [x] Allow max hold sweep.
- [x] Allow stop loss sweep.
- [x] Allow trailing stop sweep.
- [x] Allow take-profit ladder sweep.
- [x] Allow liquidity threshold sweep.
- [x] Allow reverse-split inclusion/exclusion sweep.

## Lifecycle Guardrails

- [x] Label promoted item as research candidate or strategy candidate.
- [x] Do not label the item as validated.
- [x] Do not send the item directly to Validator.
- [x] Add a link or note to the strategy lifecycle doctrine if useful.
- [x] Save a completed fundamental sweep winner as a StrategySpec JSON package.
- [x] Include original Fundamental Backtester config in the saved package.
- [x] Include sweepable parameter manifest entries in the saved package.
- [x] Surface a UI action to open the saved package in Validator.
- [x] Add read-only copy report action for fundamental sweep results.

## Verification

- [x] Promote the current EPS-confirmed reacceleration run into Sweep.
- [-] Confirm Parameter Sweep opens with the correct source run.
  - API handoff and URL generation verified; browser visual verification still needed.
- [x] Confirm rules and metrics match the saved run.
- [x] Show original run baseline score and metrics beside swept variants.
- [-] Run a small EPS threshold sweep as a smoke test.
  - One capped variant completed; two-value smoke exceeded the verification timeout.
- [ ] Confirm the best swept variant can be distinguished from the original run.
