# Plans Index

This directory is organized into four buckets:

- `ACTIVE/`
  Current source-of-truth plans that still matter for near-term work.
- `BACKLOG/`
  Deferred ideas, experiments, mockups, and schemas that are not active work.
- `REFERENCE/`
  Architecture notes, guides, and technical references. Useful context, not execution plans.
- `ARCHIVE/`
  Historical plans for work that is already built, superseded, or no longer the right source of truth.

## Current Priority Order

Read these first:

1. `ACTIVE/structural-families-to-execution-prd.md` — master PRD for structure-first evolution (research → signal → strategy → portfolio)
2. `ACTIVE/family-discovery-v2-prd-pdr.md` — research layer detail (motifs, families, v1/v2 signatures)
3. `ACTIVE/SR Engine.md` — Symbolic Regression Module (SRM): formula discovery for scoring setups (families, indicators, strategies). Integrated as a Research page mode. First path: indicator + OHLCV; then family/strategy.
4. `ACTIVE/primitive-normalization-engine-and-autonomous-research.md` — canonical primitive contract, normalization engine, imported indicator core, and Research Studio rebuild for autonomous strategy discovery
5. `ACTIVE/single-user-production-readiness-checklist.md`
6. `ACTIVE/backtesting-master.md`
7. `ACTIVE/python-execution-layer.md`
8. `ACTIVE/research-to-live-trading.md` — composite/strategy discovery path (distinct from structural families)

## What Changed

- **SR Engine** added to ACTIVE: formula-discovery (SR) as a Research page mode; easiest first path = indicator + OHLCV; then structural families / strategies.
- **Primitive normalization + autonomous research** added to ACTIVE: import commodity indicators through a normalization engine, unify imported/custom primitives behind one contract, and rebuild Research Studio around normalized autonomous strategy discovery.
- The old flat `plans/` directory was split into `ACTIVE`, `BACKLOG`, `REFERENCE`, and `ARCHIVE`.
- Historical implementation plans like scanner refactors, validator landing page work, plugin workshop buildout, auto-labeler work, and ETFM planning were moved to `ARCHIVE`.
- Reference-heavy documents like system architecture, structure references, design-system notes, and authoring guides were moved to `REFERENCE`.
- Deferred feature ideas and mockups were moved to `BACKLOG`.
- The old `Pending/` folder was removed after its contents were reclassified.
- The Python execution files were consolidated into one active plan.
- The indicator library planning files were consolidated into one backlog plan.
- Obvious mockups, stale references, and completed low-value archive files were deleted.

## Working Rule

When deciding what to build next:

- Start in `ACTIVE`.
- Pull context from `REFERENCE` only when needed.
- Treat `BACKLOG` as optional idea inventory, not committed roadmap.
- Do not resume work from `ARCHIVE` unless there is a specific reason.
