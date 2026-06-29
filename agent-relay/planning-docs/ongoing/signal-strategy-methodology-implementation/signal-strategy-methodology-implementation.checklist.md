# Signal Strategy Methodology Implementation Checklist

Percent complete: 80% (33 complete, 0 partial, 8 remaining)

PRD: signal-strategy-methodology-implementation-prd.md

Reference: ../REFERENCE/artifact-methodology-primitives-composites-strategies.md

Status: Active
Date: 2026-05-16

## Documentation

- [x] Create canonical methodology doc at `agent-relay/planning-docs/reference/indicator/indicator-architecture.md`.
- [x] Update primitive how-to with the new scannable primitive boundary.
- [x] Update strategy how-to with the Validator-only strategy boundary.
- [x] Update strategy validation policy to say Validator consumes strategies only.
- [x] Update architecture doc with the Primitive -> Composite -> Strategy model.

## Indicator Studio UI

- [x] Rename `Indicator Builder` tab to `Primitive Builder`.
- [x] Keep `Composite Builder` but update copy to describe stateful signal composition.
- [x] Add or route to `Strategy Builder`.
- [x] Rename `Indicator Library` to `Signal Library`.
- [x] Audit visible text for places where "indicator" should become "signal".
- [x] Ensure `Pattern Scanner` remains separate from strategy validation.

Note: high-risk generated library-rendering copy in `workshop-core.js` was audited but not renamed in this pass because GitNexus rated that symbol CRITICAL. Static Indicator Studio labels and Composite Builder copy are updated.

## Composite Builder

- [x] Add copy that composites may emit states.
- [x] Add copy that composites do not define entry, exit, stop, target, sizing, or cost rules.
- [x] Ensure generated composite JSON stays `composition: "composite"`.
- [x] Ensure stateful composite metadata has a place in the definition.
- [x] Ensure stage parameters remain available for strategy manifests.

## Strategy Builder

- [x] Define the builder as a wrapper around a primitive or composite.
- [x] Add required-state selection when the source is stateful.
- [x] Require direction, entry, risk, exit, cost, and execution configs.
- [x] Generate strategy JSON only, not primitive/composite definitions.
- [x] Route saved strategies to Validator.
- [x] Keep strategies out of normal Scanner signal lists.
- [x] Split Strategy Builder into a purpose-built page separate from Validator and Strategy Details.

## Scanner

- [x] Reorganize signal family filter into Technical, Fundamental, Patterns, and Composites.
- [x] Verify Scanner options include primitives and composites only.
- [ ] Add state filter support for stateful composites.
- [x] Show composite state in result rows/details where available.
- [x] Prevent strategy JSON from appearing as a normal scan signal.

## Research Studio

- [ ] Define a signal-only report for primitives and composites.
- [ ] Measure forward return, MFE/MAE, hit rates, and state-transition outcomes.
- [ ] Make signal-only reports recommend strategy wrapping, not live approval.
- [ ] Keep signal-only reports outside the Validator pass/fail gate.

## Validator

- [ ] Confirm Validator entrypoints require strategy IDs/specs.
- [ ] Confirm naked primitive/composite runs are rejected or routed to Research.
- [x] Display source primitive/composite and required state in strategy details.
- [ ] Keep expectancy, drawdown, Monte Carlo, sensitivity, and tier gates strategy-level only.

## Data Contracts

- [x] Document primitive signal output fields.
- [x] Document composite state output fields.
- [x] Decide fixed vs free-form state enum policy.
- [x] Document strategy source reference fields.
- [x] Confirm parameter manifest can reference composite stage params and strategy risk/exit params.
