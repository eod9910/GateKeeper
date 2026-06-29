# Plans Index

This directory is the canonical home for non-code project knowledge: plans, PRDs, checklists, references, historical snapshots, and durable methodology docs.

This directory is organized into five buckets:

- `ACTIVE/`
  Current source-of-truth plans that still matter for near-term work.
- `TODO/`
  Approved or emerging work that should be kept visible, but is not active implementation yet.
- `BACKLOG/`
  Deferred ideas, experiments, mockups, and schemas that are not active work.
- `REFERENCE/`
  Architecture notes, guides, and technical references. Useful context, not execution plans.
- `COMPLETED/`
  Shipped or fully completed work that remains useful as completion history. Uses the same PRD/checklist pair convention as `ACTIVE`, with checklists at 100%.
- `ARCHIVE/`
  Abandoned, superseded, stale, or checkpoint history. This is not the completed-work folder.

## Current Priority Order

Read these first:

1. `ACTIVE/structural-families-to-execution-prd.md` - master PRD for structure-first evolution.
2. `REFERENCE/family-discovery-v2-prd-pdr.md` - research layer detail: motifs, families, v1/v2 signatures.
3. `ACTIVE/sr-engine-prd.md` - Symbolic Regression Module as a Research page mode.
4. `ACTIVE/primitive-normalization-engine-and-autonomous-research-prd.md` - canonical primitive contract, normalization engine, imported indicator core, and Research Studio rebuild.
5. `ACTIVE/single-user-production-readiness-prd.md`
6. `REFERENCE/backtesting-master.md`
7. `ACTIVE/python-execution-layer-prd.md`
8. `ACTIVE/research-to-live-trading-prd.md` - composite/strategy discovery path.

## What Changed

- **SR Engine** added to `ACTIVE`: formula discovery as a Research page mode.
- **Primitive normalization + autonomous research** added to `ACTIVE`.
- **TODO bucket added** for plans that should not be lost, but should not crowd active implementation.
- **Portfolio goal exit overlay added to TODO** as a future portfolio/account management rule for exiting or pausing once an equity target is reached.
- **2026-06-02 active convention cleanup:** normalized `ACTIVE` to PRD/checklist pairs only, moved standalone architecture/reference docs to `REFERENCE`, archived stale checkpoint notes, and renamed old plan files to convention-compliant slugs.
- **2026-06-02 archive cleanup:** added `COMPLETED`, moved shipped work there as PRD/checklist pairs, moved reusable architecture/design notes to `REFERENCE`, moved deferred ETFM planning to `BACKLOG`, and narrowed `ARCHIVE` to stale/superseded/checkpoint history.
- **2026-06-02 correction:** moved Page-Aware AI Help / App Knowledge back to `TODO`; the narrow grep-based slice was not the full app-wide intelligent page-help product.
- **2026-06-01 active cleanup:** moved completed/reference/checkpoint docs out of `ACTIVE`; the follow-up convention cleanup now leaves `ACTIVE` at 40 files / 20 paired workstreams.
- The old flat `plans/` directory was split into `ACTIVE`, `TODO`, `BACKLOG`, `REFERENCE`, and `ARCHIVE`.
- Historical implementation plans like scanner refactors, validator landing page work, plugin workshop buildout, auto-labeler work, and ETFM planning were moved to `ARCHIVE`.
- Reference-heavy documents like system architecture, structure references, design-system notes, and authoring guides were moved to `REFERENCE`.
- The old `docs/` tree was retired; durable product/methodology docs now live in `REFERENCE`, and historical docs snapshots live in `ARCHIVE`.
- Deferred feature ideas and mockups were moved to `BACKLOG`.
- The old `Pending/` folder was removed after its contents were reclassified.
- The Python execution files were consolidated into one active plan.
- The indicator library planning files were consolidated into one backlog plan.
- Obvious mockups, stale references, and completed low-value archive files were deleted.

## Working Rule

When deciding what to build next:

- Start in `ACTIVE`.
- Move newly approved ideas into `TODO` until implementation starts.
- Pull context from `REFERENCE` only when needed.
- Treat `BACKLOG` as optional idea inventory, not committed roadmap.
- Treat `COMPLETED` as shipped history.
- Do not resume work from `ARCHIVE` unless there is a specific reason.
