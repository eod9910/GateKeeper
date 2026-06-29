# Artifact Methodology: Primitives, Composites, and Strategies

Implementation PRD: ../ACTIVE/signal-strategy-methodology-implementation-prd.md

Status: Reference
Date: 2026-05-16

## Purpose

This is the canonical methodology for creating and classifying signal artifacts in Pattern Detector.

It defines how primitives, composites, and strategies are different, where they are used, and what each artifact type is allowed to own.

## Ownership

Reference documents define the shared doctrine.

Workspace skills define how an in-app AI worker performs its job.

Artifact authoring instructions belong to the workspace agent responsible for that artifact type:

| Artifact / job | Owning workspace skill |
|---|---|
| Primitive/plugin creation | `workspace/Plugin Engineer Workspace/skills/create-primitive/SKILL.md` |
| Composite design | `workspace/Composite Architect Workspace/skills/composite-architecture/SKILL.md` |
| Strategy creation/promotion | `workspace/Hypothesis Author Workspace/skills/create-strategy/SKILL.md` |
| Strategy review | `workspace/Hypothesis Author Workspace/skills/strategy-review/SKILL.md` |

Do not keep Pattern Detector artifact-authoring doctrine in `.claude/skills/pattern-detector`.

## Background

Pattern Detector previously blurred three concepts in UI language and workflow:

- primitive signal components
- composite signals, including stateful composites
- strategies with entry, exit, risk, and expectancy validation

This causes confusion in Scanner, Indicator Studio, Strategy Builder, and Validator. Users should not have to guess whether a "composite" is a strategy, whether a primitive can be scanned, or whether the Validator should run naked signals.

## Product Decision

Adopt this canonical methodology:

```text
Primitive -> emits a metric, event, or state component
Composite -> combines primitives and may emit a stateful signal
Strategy -> wraps a primitive/composite state with entry, exit, risk, and execution rules
```

Scanner consumes primitives and composites.

Validator consumes strategies only.

Research Studio may run naked signal checks for primitives and composites, but those checks do not certify tradability.

## Goals

- Rename and reorganize Indicator Studio around the true artifact boundaries.
- Make Scanner show signal-producing artifacts only.
- Make Validator strategy-only.
- Add Strategy Builder as the place where a signal becomes a tradable hypothesis.
- Preserve composite state as a first-class concept.
- Make documentation and UI language consistently use "signal" instead of "indicator" where appropriate.

## Non-Goals

- Do not remove existing primitive or composite runners.
- Do not change the Validator into a naked-signal tester.
- Do not force every primitive to become a composite before scanning.
- Do not require every composite to have state.
- Do not migrate all existing strategy JSON in the first pass.

## User Model

Users should understand the workflow as:

1. Build a primitive when they need one reusable signal question.
2. Build a composite when they need multiple primitives or a signal lifecycle/state machine.
3. Scan primitives and composites to find current matches.
4. Use Research Studio to ask whether the signal has predictive value.
5. Build a strategy by wrapping the primitive/composite state with entry, exit, risk, and cost rules.
6. Use Validator to test whether the strategy has positive expectancy.

## Required UI Model

Indicator Studio top-level tabs should become:

- Primitive Builder
- Composite Builder
- Strategy Builder
- Pattern Scanner
- Signal Library

Scanner signal families should remain:

- Technical
- Fundamental
- Patterns
- Composites

Strategy artifacts should not appear as normal Scanner signal options.

## Artifact Contracts

### Primitive

Must define `composition: "primitive"`, answer one reusable signal question, expose tunable parameters, be scannable directly, and be usable inside composites.

Must not define stop loss, take profit, sizing, strategy exits, or execution costs.

### Composite

Must define `composition: "composite"`, reference one or more primitives, emit a signal, score, candidate, and/or state, and be scannable directly.

May implement stateful lifecycle semantics such as `setup_detected`, `entry_ready`, `invalidated`, or `cooldown`.

Must not define stop loss, take profit, sizing, strategy exits, or execution costs.

### Strategy

Must live as strategy JSON, reference a primitive or composite signal source, define required state when the source is stateful, define entry/risk/exit/cost/execution rules, expose a parameter manifest, and run in Validator/backtester.

Must not be treated as a normal Scanner signal.

## Acceptance Criteria

- Documentation has one canonical methodology document.
- Primitive and strategy how-to docs no longer contradict the methodology.
- Indicator Studio labels distinguish Primitive Builder, Composite Builder, and Strategy Builder.
- Scanner groups primitives and composites as signal families.
- Composite Builder copy explains that composites may have state but do not own entry/exit/risk rules.
- Strategy Builder copy explains that strategies wrap primitive/composite states and belong to Validator.
- Validator docs explicitly say strategies only.
- Research docs or UI can later add signal-only reports without changing Validator semantics.

## Risks

- Existing code and file names use "indicator" heavily. UI labels can change before internal identifiers.
- Some existing composites may include entry-like metadata. Those should be treated as signal readiness, not actual trade execution.
- Strategy Builder already exists separately enough that integration should reuse it instead of creating a duplicate builder.

## Open Questions

- Should stateful composite states have a fixed enum, a registry per composite, or free-form states with validation?
- Should Scanner support state filters immediately, or first show composites as a family only?
- Should Strategy Builder live inside Indicator Studio or deep-link to the existing strategy editor?
- Should Research Studio own a "Signal Report" workflow for naked primitive/composite outcome checks?
