# Strategy-Centric Sweep Lifecycle PRD

Checklist: strategy-centric-sweep-lifecycle-checklist.md

## Purpose

Move the research lifecycle from validator-first to strategy-centric:

Research engines and indicators produce entry ideas. Parameter Sweep turns those ideas into tuned strategy candidates. Validator then tests the frozen candidate and is the only place that grants validation tier status.

## Problem

Current Sweep behavior blurs optimization and validation:

- Sweep variants run through Validator and can inherit validation reports when promoted.
- A promoted winner can look validated even though its parameters changed during Sweep.
- Tier 3 Sweep is blocked unless the base strategy is already Tier 3, which reinforces a validator-first workflow.
- Fundamental sweep candidates still identify as a special `fundamental_backtest` scan mode instead of a normal strategy with fundamental entry rules.

## Goals

- Treat Sweep as an optimization/search stage, not final validation.
- Treat promoted Sweep winners as frozen strategy candidates that must be validated after promotion.
- Allow Sweep scopes such as Tier 1, Tier 2, and Tier 3 without implying validation tier status.
- Convert Fundamental Backtester sweep winners into regular strategy packages with fundamental entry criteria.
- Preserve Sweep evidence and lineage as metadata without copying Validator pass/fail status.

## Non-Goals

- Replace the current Validator robustness engine.
- Build full walk-forward optimization inside Sweep in this pass.
- Remove the fundamental trade-generation adapter before a generic strategy executor can evaluate fundamental entry rules.

## Product Doctrine

Lifecycle:

```text
Entry idea -> Parameter Sweep -> frozen strategy candidate -> Validator -> tier status
```

Parameter Sweep answers:

```text
Which settings create the strongest candidate without obvious fragility?
```

Validator answers:

```text
Does the frozen candidate survive robustness, OOS, walk-forward, Monte Carlo, sensitivity, and kill tests?
```

## Acceptance Criteria

- Sweep promotion does not copy validation reports or trade instances to the promoted strategy id.
- Promoted Sweep winners are marked as candidates/testing, not approved or validated.
- Promoted strategies retain Sweep evidence in metadata.
- Tier 3 Sweep can be run as a sweep scope without requiring an existing Tier 3 baseline.
- Fundamental sweep winners use normal strategy identity (`scan_mode: strategy`) while retaining fundamental entry rules.
- Validator can still generate trades for fundamental-entry strategies by detecting the entry trigger/config, not by relying only on `scan_mode`.
- UI language makes clear that promoted Sweep winners must be validated.
