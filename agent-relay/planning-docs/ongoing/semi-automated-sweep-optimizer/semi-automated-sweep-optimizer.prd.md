# Semi-Automated Sweep Optimizer PRD

Checklist: semi-automated-sweep-optimizer-checklist.md

## Purpose

Build a semi-automated optimization loop for Parameter Sweep that helps find strong strategy candidates faster while keeping the user in control of promotion and validation decisions.

The optimizer should propose the next sweep axis, run staged one-knob or small-grid sweeps, compare each winner against the current baseline, and recommend whether to adopt the winner for the next step.

## Context

The app is moving to a strategy-centric workflow:

```text
Entry idea -> Parameter Sweep -> frozen strategy candidate -> Validator -> tier status
```

Sweep is the optimization/search stage. Validator is the robustness gate. The semi-automated optimizer should make Sweep faster and more systematic without turning it into an uncontrolled overfitting machine.

## Problem

Manual Sweep is useful but slow:

- The user must choose each knob manually.
- It is easy to forget which settings were already tested.
- It is easy to over-focus on win rate or average return.
- It is hard to know whether the next best knob should be entry logic, drawdown, DCF gap, stop loss, trailing stop, max hold, or take profit.
- A brute-force grid across everything creates too many variants and increases overfit risk.

## Goals

- Add a guided optimizer that recommends and runs the next most useful sweep step.
- Use staged hill-climbing rather than massive all-at-once grids.
- Keep the current baseline visible at every step.
- Compare each winner against the baseline using robust candidate-quality metrics.
- Require user approval before adopting a winner, promoting a candidate, or sending to Validator.
- Preserve an audit trail of tested knobs, tested values, winners, rejected steps, and rationale.

## Non-Goals

- Fully autonomous strategy deployment.
- Automatic approval of Validator results.
- Replacing the existing manual Sweep UI.
- Building full walk-forward optimization in this first pass.
- Running unbounded Cartesian grids.

## Core Workflow

1. User selects a strategy candidate.
2. Optimizer builds a sweep plan from available knobs.
3. Optimizer recommends the first axis to test.
4. User starts the step.
5. Sweep runs variants for that axis.
6. Optimizer compares the winner against the current baseline.
7. User chooses whether to adopt the winner as the new baseline.
8. Optimizer recommends the next axis.
9. Repeat until improvement stalls or the user stops.
10. User promotes the final optimized candidate.
11. User sends the frozen candidate to Validator.

## Candidate Quality Score

The optimizer should rank variants using a robust composite score, not win rate alone.

Primary factors:

- Expectancy or risk-adjusted return.
- Median return / median R.
- Trade count.
- Benchmark beat rate for equity/fundamental strategies.
- Drawdown.
- Outlier dependency.
- Profit factor.
- Win rate as a secondary signal.

Guardrail penalties:

- Too few trades.
- Trade count collapse versus baseline.
- Outlier dependency spike.
- Large drawdown increase.
- Tiny improvement that does not justify added specificity.
- Isolated parameter spike with weak nearby values.

## Suggested First Knob Order

For fundamental-entry strategies:

1. EPS surprise threshold.
2. 6M drawdown threshold.
3. DCF gap threshold.
4. Revenue acceleration threshold.
5. Max hold days.
6. Stop loss percent.
7. Trailing stop percent.
8. Take-profit ladder.
9. Universe/sweep scope.

For chart/indicator strategies:

1. Entry threshold / score threshold.
2. Stop model or stop distance.
3. Take-profit R.
4. Max hold.
5. Structure sensitivity.
6. Timeframe.
7. Universe/sweep scope.

## UI Requirements

Add a semi-automated panel to Parameter Sweep:

- Current baseline summary.
- Next recommended knob.
- Reason for recommendation.
- Values to test.
- Start step button.
- Step result comparison.
- Adopt winner button.
- Reject step button.
- Promote final candidate button.
- Session history / audit trail.

The UI must make clear:

```text
Sweep winner = optimized candidate, not validated.
Validator pass = tier evidence.
```

## Data Requirements

Persist optimizer sessions with:

- Session id.
- Source strategy id.
- Current baseline strategy package.
- Baseline metrics.
- Step list.
- Knobs tested.
- Values tested.
- Winner per step.
- Adopt/reject decision.
- Rationale.
- Final promoted strategy id.

## Acceptance Criteria

- User can start a semi-automated optimizer session from a strategy candidate.
- Optimizer recommends the next knob from available sweep dimensions.
- User can run one recommended step without manually rebuilding the sweep.
- Step results compare winner versus baseline.
- User can adopt or reject the step winner.
- Adopted winner becomes the baseline for the next step.
- Optimizer avoids giant unbounded grids.
- Final candidate can be promoted and then opened in Validator.
- Existing manual Sweep still works.
- Optimizer session persists across refresh.
