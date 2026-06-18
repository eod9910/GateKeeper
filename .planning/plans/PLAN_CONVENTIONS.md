# Planning File Conventions

This file is the source of truth for how planning documents are organized.

## PRD / Checklist Pairs

Every active or completed workstream must have exactly two paired files:

```text
.planning/plans/ACTIVE/<slug>-prd.md
.planning/plans/ACTIVE/<slug>-checklist.md
```

Completed work uses the same shape:

```text
.planning/plans/COMPLETED/<slug>-prd.md
.planning/plans/COMPLETED/<slug>-checklist.md
```

The shared `<slug>` is the workstream name. Keeping the same slug makes the PRD and checklist sort together in file browsers.

Examples:

```text
fundamental-research-lab-prd.md
fundamental-research-lab-checklist.md

market-intelligence-historical-replay-prd.md
market-intelligence-historical-replay-checklist.md
```

## Required Links

Each PRD must link to its checklist near the top:

```text
Checklist: <slug>-checklist.md
```

Each checklist must link back to its PRD near the top:

```text
PRD: <slug>-prd.md
```

Each checklist must also show progress near the top:

```text
Percent complete: 42% (10 complete, 2 partial, 12 remaining)
```

Use the checklist item count as the default basis. If the checklist is a new shell that still needs a first implementation audit, use `0%` rather than hiding the uncertainty.

## Folder Rules

- `ACTIVE/` contains only current workstreams with a PRD/checklist pair.
- `TODO/` contains proposed work that has not started yet.
- `REFERENCE/` contains architecture notes, research notes, conventions, and evergreen context.
- `COMPLETED/` contains shipped or fully completed work as PRD/checklist pairs. Completed checklists should show `Percent complete: 100%`.
- `ARCHIVE/` contains abandoned, superseded, stale, or historical checkpoint plans. Do not use `ARCHIVE/` as a completed-work drawer.

Standalone notes, architecture references, and loose execution plans should not live in `ACTIVE/` unless they are converted into a PRD/checklist pair.

## Non-Code Knowledge Rule

All non-code project knowledge belongs under `.planning/` unless it is a top-level project `README.md`, source-adjacent generated artifact, runtime data file, code asset, or required config.

Use these buckets:

- `.planning/plans/ACTIVE/` for current PRDs and checklists.
- `.planning/plans/TODO/` for future PRDs and checklists.
- `.planning/plans/COMPLETED/` for completed PRDs and checklists.
- `.planning/plans/ARCHIVE/` for historical snapshots, retired docs, stale drafts, and legacy redirects.
- `.planning/plans/REFERENCE/` for durable methodology, architecture, schemas, policies, conventions, and current codebase orientation.

Do not create a separate `docs/` knowledge tree. If a document is reference material, put it in `REFERENCE`; if it describes work to do, create a PRD/checklist pair in `TODO` or `ACTIVE`.

## Orientation Rule

When getting caught up on the app, read the memory bank and then read:

```text
.planning/plans/REFERENCE/codebase/README.md
```

Use the codebase reference bundle as orientation, not blind truth. Check each document's analysis date and orientation audit note. If a claim affects implementation, verify it against the current repo, GitNexus, and source files before acting.

## When Creating A New Plan

When asked to create a PRD, checklist, active plan, or workstream:

1. Choose a stable lowercase kebab-case slug.
2. Create both `<slug>-prd.md` and `<slug>-checklist.md`.
3. Put them in `TODO/` if the work has not started.
4. Move both files to `ACTIVE/` when implementation begins.
5. Move both files to `COMPLETED/` when the work is shipped or genuinely finished, and update the checklist to `Percent complete: 100%`.
6. Move both files to `ARCHIVE/` only when the work is abandoned, superseded, stale, or preserved as a historical checkpoint.
7. Update any inventory/index docs that reference the plan.

## When Auditing Active Or Completed Plans

Flag any of the following as cleanup items:

- A PRD without a matching checklist.
- A checklist without a matching PRD.
- An `ACTIVE/` or `COMPLETED/` file that is not part of a PRD/checklist pair.
- A pair whose internal links are missing or stale.
- A checklist without a `Percent complete:` line near the top.
- A `COMPLETED/` checklist whose percent complete is not `100%`.
