# Codebase Concerns

Analysis date: 2026-06-02
Status: Current orientation reference

## High-Level Risk

Pattern Detector is powerful but organically grown. The main risk is not one bad module; it is hidden coupling across large frontend files, backend services, Python scripts, local data artifacts, and planning assumptions.

## Current Concerns

### 1. Large Frontend Files

Several frontend files are very large, including market intelligence, sweep, training module, validator, workshop scanner, index/scanner, history, and drawing tools. Changes can have wide behavioral effects even when they look local.

Mitigation: use targeted search, inspect event bindings/state shape, and run `node --check` plus visual verification.

### 2. Static Frontend Without Build System

The frontend has no bundler or module system. Script order, globals, and implicit contracts matter.

Mitigation: avoid assuming import/export behavior; inspect HTML script order and page globals.

### 3. File-Backed Local Data Stores

The app stores many records under `backend/data`. This is good for local-first work but can create stale caches, partial migrations, and inconsistent point-in-time/current data assumptions.

Mitigation: know which data source is historical PIT, current cache, generated report, or user state before changing logic.

### 4. PIT vs Current Data Confusion

Fundamental backtests require point-in-time facts. Current screening and Ledger-style snapshots may use newer cached reports. Mixing these can create false candidates.

Mitigation: explicitly label data source and as-of behavior in code and UI.

### 5. Scheduler Side Effects

Server startup can resume background schedulers and bridge state. Local runs may do more than simply serve pages.

Mitigation: check server startup code and environment toggles before changing scheduler behavior.

### 6. Execution/Broker Risk

Execution modules include broker clients, order executor, position manager, Robinhood/Alpaca flows, imported/manual positions, and kill switch. Bugs here can affect trading workflows.

Mitigation: treat execution code as high risk; test and review carefully.

### 7. Research Script Sprawl

`backend/scripts` contains many one-off and semi-production research scripts. Some are experiments, some are operationally important.

Mitigation: do not clean scripts by filename alone; inspect usage, generated data, and planning references.

### 8. Planning Drift

Planning docs have historically become stale or misplaced. The current convention requires PRD/checklist pairs for active/TODO/completed work and reference docs under `REFERENCE`.

Mitigation: update planning status when work changes and keep checklist percent complete current.

### 9. Git Worktree Noise

The worktree may contain many unrelated edits. GitNexus change detection can report critical because of broad pre-existing changes.

Mitigation: never revert unrelated changes; scope status/diffs to touched files when reporting.

## Known Documentation Risk

The old February codebase reference docs have been archived under:

```text
.planning/plans/ARCHIVE/codebase-reference-legacy-2026-02-09/
```

Use the current files in `REFERENCE/codebase`, not the archived versions, for orientation.
