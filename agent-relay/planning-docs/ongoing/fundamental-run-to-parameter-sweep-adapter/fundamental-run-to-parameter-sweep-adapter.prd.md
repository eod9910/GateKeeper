# Fundamental Run To Parameter Sweep Adapter PRD

Checklist: fundamental-run-to-parameter-sweep-adapter-checklist.md

## Status

ACTIVE. Implementation started 2026-06-03.

## Problem

The Fundamental Backtester can now discover and save promising research candidates, but the user still has to manually rerun variants one at a time. That is slow and easy to forget.

The current promising example is:

```text
6M drawdown % <= -50
Revenue acceleration QoQ % > 0
EPS surprise % >= 10
```

This appears to be a strong research candidate, but it is not a validated strategy. It needs to be promoted into Parameter Sweep so execution and threshold variants can be tested systematically.

## Decision

Use the existing Parameter Sweep.

Do not build a separate Fundamental Sweep page unless the existing Parameter Sweep cannot support the workflow.

Parameter Sweep should become the universal strategy-candidate lab bench. Fundamental Backtester should promote saved research runs into that existing bench.

## Goal

Add a "Promote To Sweep" workflow from saved Fundamental Backtester research runs into the existing Parameter Sweep page.

The workflow should convert a saved fundamental research run into a sweep-ready strategy candidate with prefilled dimensions, parameters, and variants.

## Non-Goals

- Do not create a new standalone Fundamental Sweep page.
- Do not send raw research candidates directly to Validator.
- Do not mark promoted candidates as validated.
- Do not build Trading Desk execution in this workstream.

## Lifecycle Doctrine

This work follows:

```text
Research Candidate
-> Parameter Sweep
-> Validator
-> Strategy Library
-> Trading Desk
```

Reference: `agent-relay/planning-docs/reference/strategy-lifecycle-doctrine.md`

## User Workflow

1. User runs a Fundamental Backtester study.
2. The completed run is saved in Research Runs.
3. User clicks `Promote To Sweep`.
4. App creates a Parameter Sweep session using the saved run config.
5. User lands on Parameter Sweep with the research candidate preloaded.
6. User selects or edits sweep dimensions.
7. Sweep ranks variants.
8. Best swept variant can later be sent to Validator.

## Source Object

Input source:

```text
fundamental_backtest_run
```

Required source fields:

- saved run id
- rule name
- universe
- date range
- rebalance frequency
- benchmark
- max symbols
- entry rules
- exclusions
- exit config
- result mode
- research score
- prior result metrics

## Sweep Dimensions

The adapter should expose sensible sweep parameters for fundamental research candidates.

Suggested first dimensions:

```text
EPS surprise threshold
Sales surprise threshold
Revenue acceleration threshold
Max hold days
Stop loss %
Trailing stop %
Take-profit ladder %
Top N per date
20D dollar volume threshold
Reverse split exclusion window
Current ratio exclusion
```

Initial default grid for the current research candidate:

```text
EPS surprise %: 0 / 10 / 25 / 50 / 100
Max hold days: 30 / 60 / 90 / 180 / 252
Stop loss %: none / -15 / -25 / -35 / -50
Trailing stop %: none / 15 / 25 / 35 / 50
Take-profit ladder %: 25,50,100 / 50,100,200 / 100,200,400
20D dollar volume: 250000 / 1000000 / 5000000
Reverse split exclusion: include / exclude 365D
```

## UI Requirements

### Fundamental Backtester

Add action to saved Research Runs:

```text
Promote To Sweep
```

The action should be visibly distinct from:

- View
- Reload Study
- Compare

### Parameter Sweep

When opened from a fundamental run, Parameter Sweep should show:

- source type: Fundamental Backtester
- saved run id
- original tested rules
- original research metrics
- sweep dimensions generated from the source config
- editable values to test

It should not look like a separate product. It should feel like the existing Parameter Sweep with a fundamental candidate source.

## API Requirements

Add or adapt backend functionality to:

- create a sweep session from a saved fundamental run
- carry source metadata into the sweep session
- preserve original run config and metrics
- expose fundamental-specific sweep parameters
- return a destination URL or session id
- promote a completed fundamental sweep winner into a saved StrategySpec JSON package
- include parameter manifest paths so Sweep, Validator, and review tooling can see the tunable knobs

## Acceptance Criteria

- A saved Fundamental Backtester run has a `Promote To Sweep` action.
- Clicking it creates or opens a Parameter Sweep session.
- The Parameter Sweep session knows the source saved-run id.
- The original fundamental rules are visible in the sweep session.
- The original research metrics are visible in the sweep session.
- The user can sweep at least one fundamental threshold, such as EPS surprise.
- The user can sweep execution parameters, such as max hold, stop loss, trailing stop, and take-profit ladder.
- The promoted candidate is labeled as a research candidate or strategy candidate, not validated.
- No separate Fundamental Sweep page is created.
- A completed sweep winner can be saved as a strategy package.
- The saved package carries the original Fundamental Backtester config and sweepable parameter manifest.

## Notes From Current Research

The user reported a later run where average return declined to about `15.3%` and win rate also came down. This reinforces why manual one-off threshold testing is insufficient. The app should move promising candidates into Sweep so variants can be compared systematically instead of interpreted from isolated runs.
