# Backtesting Master Plan

Status: Active source of truth  
Last updated: 2026-02-15

## 1. Purpose

This document is the single backtesting reference for Pattern Detector.

Backtesting here is a falsification system, not a profit proof system:
- Kill weak strategy ideas quickly.
- Promote only strategies that survive statistical and robustness gates.
- Keep production scanning gated by validated strategy outcomes.

## 2. Scope

This covers:
- Validator run lifecycle
- Tiered validation model (Tier 1/2/3)
- Backtest pipeline stages
- Volatility-first gating model (volatility -> regression -> RDP)
- Robustness tests
- Pass/Fail/Needs Review logic
- Tier progression gates
- Current implementation state and known gaps

## 3. Current Canonical Implementation (Code)

Primary route and orchestration:
- `backend/src/routes/validator.ts`

Tier labels and fixed universes:
- `backend/src/routes/validator.ts:56`
- `backend/src/routes/validator.ts:57`

Current fixed universes:
- Tier 1: `ES=F, NQ=F, CL=F`
- Tier 2: `ES=F, NQ=F, CL=F, GC=F, ZN=F, RTY=F, EURUSD=X, SPY, QQQ, TLT`
- Tier 3: `ES=F, NQ=F, CL=F, GC=F, ZN=F, RTY=F, EURUSD=X, SPY, QQQ, IWM, DIA, XLF, XLK, XLE, XLV, TLT, GLD, USO, EEM, XLI`

Tier gating:
- Tier 2 requires prior Tier 1 PASS:
  - `backend/src/routes/validator.ts:393`
- Tier 3 requires prior Tier 2 PASS:
  - `backend/src/routes/validator.ts:399`

Universe override behavior:
- Manual universe override is ignored for tiered validation runs:
  - `backend/src/routes/validator.ts:405`

## 4. Validation Tier Model

### Tier 1 - Kill Test

Goal:
- Fast rejection of weak hypotheses.

Policy:
- Fixed small universe.
- Run first.
- Must pass before Tier 2.

### Tier 2 - Core Validation

Goal:
- Confirm edge stability on broader but controlled universe.

Policy:
- Fixed universe.
- Requires Tier 1 PASS.
- Produces report suitable for decision review.

### Tier 3 - Robustness

Goal:
- Stress test surviving strategies.

Policy:
- Fixed broad universe.
- Requires Tier 2 PASS.

## 5. Pipeline Stages

Execution flow:
1. Load OHLCV data by symbol and date range.
2. Generate causal entry signals (no lookahead).
3. Run backtest engine:
   - with execution rules
   - without execution rules
4. Compute trade and risk summaries.
5. Run robustness tests:
   - out-of-sample
   - walk-forward
   - Monte Carlo
   - parameter sensitivity
6. Build validation report and verdict.
7. Persist report and trade instances.

Core Python modules:
- `backend/services/validatorPipeline.py`
- `backend/services/backtestEngine.py`
- `backend/services/robustnessTests.py`
- `backend/services/strategyRunner.py`

## 6. Metrics and Verdict Logic

Core metrics:
- total trades
- win rate
- expectancy (R)
- average win/loss (R)
- profit factor
- max drawdown
- streak statistics

Robustness:
- OOS expectancy and degradation
- walk-forward profitable window ratio
- Monte Carlo DD percentiles
- parameter sensitivity score

Verdict categories:
- PASS
- NEEDS_REVIEW
- FAIL

Default threshold policy is strategy-configurable via validator config and persisted in report config for transparency.

## 7. Production Gate

Production scan eligibility requires:
- strategy status approved
- latest validator outcome PASS
- decision status approved (where applicable)

Research/testing bypass remains explicit and separate.

## 8. Backtesting Design Rules

1. Causal-only backtesting
- No future data leakage in signal generation.

2. Tier progression is earned
- No direct Tier 3 without passing lower tiers.

3. Trade evidence over symbol count
- Early validation should prioritize sufficient trade evidence and fast rejection.

4. Robustness is mandatory
- Edge claims without robustness are incomplete.

5. Asset-class awareness
- Strategy specs include `asset_class` metadata (`futures`, `stocks`, `options`, `forex`, `crypto`).
- Current tier universes are mixed baskets.
- Target state: enforce tier universes per declared asset class.

## 9. Volatility-First Methodology (Canonical Policy)

This master plan adopts a strict layer order for validation design:
1. Volatility normalization gate
2. Regression-channel statistical context
3. RDP structural extraction

Interpretation rules:
- Volatility is a gate, not a signal.
- Regression defines statistical position and stretch within a regime.
- RDP defines structural integrity (legs, swings, degradation) inside that context.

Indicator policy:
- Every indicator must declare intended regime(s) and expected volatility behavior.
- Indicators must not self-classify regimes or claim universal validity across all regimes.
- Indicators that fail volatility permission, regression consistency, or structure alignment are rejected.

Tier implications:
- Tier 1 remains fast and hostile, but should use volatility-consistent windows.
- Tier 2 and Tier 3 remain regime-scoped and curated, not full-market averaging.

Implementation note:
- This section is canonical methodology and product direction.
- Some items (e.g., full volatility-normalized epsilon enforcement and regression-bound checks) are still hardening work tracked in Known Gaps.

## 10. Known Gaps / Next Hardening

1. Enforce asset-class-specific tier universes
- Futures strategies validated on futures sets, stocks on stocks sets, etc.

2. Add explicit early-stop kill rules
- Example: negative expectancy after minimum trade count.

3. Continue performance optimization
- Signal generation and robustness stages remain the heaviest cost centers.

4. Keep progress telemetry tied to real stage boundaries
- Avoid purely time-based progress artifacts.

5. Enforce volatility-first layers in code
- Add explicit volatility permission checks as a first-class validation stage.
- Add regression-channel context checks as a first-class validation stage.
- Enforce volatility-aware RDP settings/policies consistently in validator runs.

## 11. Superseded Documents

The following legacy backtesting docs were merged into this master and removed:
- `.planning/plans/validator-system.md`
- `.planning/plans/validator-pipeline-anatomy.md`
- `.planning/plans/validator-build-report.md`
- `.planning/plans/fix-validator-progress.md`
- `.planning/plans/fix-validator-universe-bug.md`
- `.planning/plans/Regime-Aware, Structure-First Backtesting Framework.md`
- `.planning/plans/backtesting_volitity_rdp_regression.md`
- `.planning/plans/Pending/validation_report_spec.md`
- `.planning/plans/validator-v1-board/*`
