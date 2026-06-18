# Pattern Detector Documents

This folder contains durable system documentation: methodology, subsystem contracts, and long-lived product architecture notes.

PRDs, execution checklists, and active implementation plans belong in `.planning/plans/ACTIVE/`, not here.

Current codebase orientation belongs in `.planning/plans/REFERENCE/codebase/`. Read that folder with the memory bank when getting caught up on the live repo.

## Canonical System Docs

Read these first when orienting to the project.

| Document | Purpose |
|---|---|
| `ARCHITECTURE.md` | Gateway to the current codebase orientation bundle |
| `indicator/indicator-architecture.md` | Canonical Primitive -> Composite -> Strategy methodology |
| `validator-architecture.md` | Validator purpose, API, job lifecycle, and strategy-only boundary |
| `strategy-validation-policy.md` | Validation tiers, repair rules, sweep rules, and tombstone philosophy |
| `parameter-manifest-architecture.md` | Parameter manifest contract used by strategies, sweep, validator, and AI repair |

## Codebase Orientation Docs

These are maintained outside `docs/` because they are not product policy; they are current repo-orientation references:

| Document | Purpose |
|---|---|
| `.planning/plans/REFERENCE/codebase/README.md` | Index, trust levels, and refresh rule |
| `.planning/plans/REFERENCE/codebase/ARCHITECTURE.md` | Current architecture orientation |
| `.planning/plans/REFERENCE/codebase/STRUCTURE.md` | Current repo structure |
| `.planning/plans/REFERENCE/codebase/STACK.md` | Current technology stack |
| `.planning/plans/REFERENCE/codebase/INTEGRATIONS.md` | Current integrations |
| `.planning/plans/REFERENCE/codebase/TESTING.md` | Current testing commands and gaps |
| `.planning/plans/REFERENCE/codebase/CONVENTIONS.md` | Current engineering conventions |
| `.planning/plans/REFERENCE/codebase/CONCERNS.md` | Current concerns and risks |

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
| `archive/pattern-detector-architecture-legacy-2026-03-06.md` | `.planning/plans/REFERENCE/codebase/README.md` |
| `archive/base-method-review-workflow.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/synthetic-calibration-framework.md` | `indicator/HOW-TO-CREATE-A-PRIMITIVE.md` |
| `archive/validator-api-v2.md` | `validator-architecture.md` |
