# Signal Strategy Methodology Implementation PRD

Checklist: signal-strategy-methodology-implementation-checklist.md

Reference: ../REFERENCE/artifact-methodology-primitives-composites-strategies.md

Status: Active
Date: 2026-05-16

## Purpose

Implement the canonical primitive, composite, and strategy methodology across the app.

The methodology itself is reference doctrine. This active PRD tracks only the remaining product and code work needed to make the app follow that doctrine consistently.

## Canonical Model

```text
Primitive -> emits a metric, event, or state component
Composite -> combines primitives and may emit a stateful signal
Strategy -> wraps a primitive/composite state with entry, exit, risk, and execution rules
```

Scanner consumes primitives and composites.

Validator consumes strategies only.

Research may evaluate naked primitives and composites, but those reports do not certify tradability.

## Current State

Most UI and documentation work is complete. Remaining work is concentrated in:

- state filter support for stateful composites in Scanner
- signal-only research reports for primitives and composites
- Validator guardrails that reject or reroute naked primitive/composite runs
- final confirmation that strategy-level robustness metrics stay strategy-only

## Acceptance Criteria

- Active checklist reaches 100%.
- Scanner can support stateful composite filtering or explicitly documents why it is deferred.
- Research Studio has a defined signal-only report path for primitive/composite outcome checks.
- Validator entrypoints consume strategies only.
- Primitive/composite methodology remains documented in `REFERENCE`, not duplicated as active work.
