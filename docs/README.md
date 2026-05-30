# Pattern Detector Documents

This folder contains durable system documentation: how the product works, how major subsystems are shaped, and what contracts developers and agents should follow.

PRDs, execution checklists, and active implementation plans belong in `.planning/plans/ACTIVE/`, not here.

## Canonical System Docs

Read these first when orienting to the project.

| Document | Purpose |
|---|---|
| `ARCHITECTURE.md` | Top-level system architecture and route/storage map |
| `indicator/indicator-architecture.md` | Canonical Primitive -> Composite -> Strategy methodology |
| `validator-architecture.md` | Validator purpose, API, job lifecycle, and strategy-only boundary |
| `strategy-validation-policy.md` | Validation tiers, repair rules, sweep rules, and tombstone philosophy |
| `parameter-manifest-architecture.md` | Parameter manifest contract used by strategies, sweep, validator, and AI repair |

## Indicator Studio Docs

These live in `docs/indicator/`.

| Document | Purpose |
|---|---|
| `indicator/indicator-architecture.md` | Broad architecture for primitives, composites, strategies, Scanner, Research, and Validator |
| `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` | Practical long-form primitive creation guide |
| `indicator/HOW-TO-CREATE-A-COMPOSITE.md` | Practical long-form composite creation guide |
| `indicator/HOW-TO-CREATE-A-STRATEGY.md` | Practical long-form strategy creation guide |

## Data and Intelligence Docs

These live in `docs/data/`.

| Document | Purpose |
|---|---|
| `data/ledger-canonical-fact-schema.md` | Ledger/PIT normalized fact schema |
| `data/symbol-catalog-architecture.md` | Symbol universe and classification model |
| `data/social-intelligence-architecture.md` | Social signal collection and scoring architecture |

## Agent and Tooling Docs

| Document | Purpose |
|---|---|
| `agent-tooling-development-howto.md` | Agent workflow, capability, and workspace guidance |

## Legacy Redirects

These files remain so old links do not break, but their content has been folded into canonical docs:

| Legacy file | Canonical replacement |
|---|---|
| `archive/pattern-scannerrules.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/pattern-detector-framework.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/base-method-review-workflow.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/synthetic-calibration-framework.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/validator-api-v2.md` | `validator-architecture.md` |
