# Transcript Retention and Archival

Checklist: transcript-retention-archival-checklist.md

**Status:** ACTIVE
**Created:** 2026-06-17
**Owner role:** Validator authors; Builder implements; Editor cleans; Validator verifies.
**Tier:** 2 (carries this PRD + checklist, full relay required).

**Purpose:** Stop the agent transcript stores from growing without bound by
introducing a 30-day "hot" window and a tracked, monthly cold archive, so future
agents and humans can read recent history quickly while older history stays
recoverable but out of the way.

---

## Core Problem

"Transcripts" is actually four stores with different growth behavior. Two are
already controlled; two grow without bound.

Already controlled (do NOT change in this workstream):

- `memory-bank/transcripts/codex-session-live.md` and
  `memory-bank/transcripts/cursor-session-live.md` are already capped via
  `MAX_TRANSCRIPT_CHARS` (~240 KB head+tail truncation) in the mirrors.
- `memory-bank/transcripts/codex|cursor/YYYY-MM-DD/` snapshots are already sorted
  into per-day folders. They accumulate one folder per active day but are not a
  single growing file.

Unbounded today:

- `agent-relay/transcripts/all.md` is regenerated from `routes.jsonl` and inlines
  every route body, so it grows roughly linearly with every role handoff forever
  (already ~2,400+ lines from 61 routes).
- The set of dated snapshot day-folders grows one folder per active day with no
  archival step, so the live `memory-bank/transcripts/<agent>/` tree keeps
  expanding.

---

## Confirmed Design Decisions

1. **Archive location:** tracked git subfolders under `archive/`. Archived history
   stays versioned and shared, accepting some repo-size growth. (NOT moved to the
   local-only `offline-*-transcripts-*` mirrors.)
2. **Granularity:** monthly folders (`YYYY-MM`). Weekly sharding within a month is
   a future option only if a single month becomes unwieldy; it is NOT built now.
3. **Automation:** a manual maintenance script run on demand
   (`tools/archive_transcripts.py`), gated by the Destructive Cleanup process in
   `memory-bank/MEMORY_ARCHIVE_POLICY.md`. NOT run automatically at mirror/router
   startup.

Retention window: **30 days hot**. Anything older than 30 days is eligible for
archival.

---

## Goals

1. Keep `agent-relay/transcripts/all.md` to the last 30 days of routes.
2. Roll older relay routes into tracked monthly files
   `agent-relay/transcripts/archive/all-YYYY-MM.md`.
3. Keep `routes.jsonl` as the immutable source of truth (archives are derived
   views, never destructive to the log).
4. Move dated snapshot day-folders older than 30 days into tracked monthly
   archives `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/`.
5. Provide one on-demand maintenance script that performs both rollovers, defaults
   to dry-run, and emits a report of affected paths.
6. Document the retention window, archive layout, and the gate in the memory
   policy files so future agents follow it.

Non-goals:

- Do not alter the size-capped live session transcripts.
- Do not summarize or lossy-compress archived content (archives stay full text).
- Do not trim or rewrite `routes.jsonl`.
- Do not build weekly sharding yet.

---

## Phase 1 - Retention Policy Spec (docs)

### Tasks
- Update `memory-bank/MEMORY_ARCHIVE_POLICY.md` with: the 30-day hot window, the
  tracked monthly archive layout for both the relay timeline and the dated
  snapshots, and an explicit statement that the rollover is manual and runs under
  the existing Destructive Cleanup Gate.
- Update `memory-bank/CODEX_MEMORY_POLICY.md` so the documented retention reflects
  hot window + monthly archive for `codex/` and `cursor/` trees.

### Exit Criteria
- A future agent can read the policy files and know exactly which paths are hot,
  which are archived, the 30-day rule, and how to run the rollover safely.

---

## Phase 2 - Relay Timeline Windowing

### Tasks
- Extend `tools/agent_router.py` so transcript generation produces a hot
  `agent-relay/transcripts/all.md` containing only routes from the last 30 days.
- Emit/refresh tracked monthly archive files
  `agent-relay/transcripts/archive/all-YYYY-MM.md` for older routes, rebuilt
  deterministically from `routes.jsonl`.
- Leave `routes.jsonl` and the per-phase transcript files unchanged in behavior.
- Add a short header note in the hot `all.md` pointing to the archive folder.

### Exit Criteria
- Regenerating yields a hot `all.md` bounded to 30 days and one archive file per
  older month, and the union of hot + archive routes equals `routes.jsonl` with no
  loss or duplication.

---

## Phase 3 - Snapshot Archival Mover

### Tasks
- Create `tools/archive_transcripts.py` that:
  - finds `memory-bank/transcripts/<agent>/YYYY-MM-DD/` folders older than 30 days
    (`<agent>` in `codex`, `cursor`),
  - moves each into `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/`,
  - also drives the Phase 2 relay rollover (or calls the router) so one command
    handles both stores,
  - defaults to `--dry-run`, requires an explicit flag to apply,
  - prints/writes a report listing every affected source and destination path.
- The script must be a move, never a delete, and must be safe to re-run
  (idempotent).

### Exit Criteria
- Dry-run lists the correct folders and target monthly paths; applying moves them
  losslessly; re-running is a no-op; the live `<agent>/` tree keeps only the last
  30 days plus the `archive/` subtree.

---

## Phase 4 - Validation, Gate, and Docs Close-out

### Tasks
- Run the script in dry-run against current data and capture the report.
- Execute the Destructive Cleanup Gate for the first real archival move
  (Validator approval, Builder report of affected paths, Editor review, recoverable
  audit trail) per `MEMORY_ARCHIVE_POLICY.md`.
- Confirm hot stores are within the 30-day window and archives are complete and
  readable.
- Update the checklist `Percent complete:` line.

### Exit Criteria
- One command performs both rollovers, defaults to safe dry-run, leaves a
  recoverable audit trail, and the documented policy matches actual behavior.

---

## Definition of Done

- `agent-relay/transcripts/all.md` shows only the last 30 days; older months live
  in `agent-relay/transcripts/archive/all-YYYY-MM.md`.
- Snapshot day-folders older than 30 days live under
  `memory-bank/transcripts/<agent>/archive/YYYY-MM/`.
- `routes.jsonl` and the live session-live transcripts are unchanged.
- `tools/archive_transcripts.py` exists, defaults to dry-run, is idempotent, and
  emits an affected-path report.
- `MEMORY_ARCHIVE_POLICY.md` and `CODEX_MEMORY_POLICY.md` document the window,
  layout, and gate.

---

## Risks / Notes

- The relay hot/archive split must be a derived view of `routes.jsonl`; never
  mutate the log, so archives are always rebuildable.
- Archival folder moves are destructive-ish (path changes); they must run under
  the Destructive Cleanup Gate and stay recoverable.
- OneDrive sync + Windows path semantics: the mover must handle existing target
  folders and re-runs without clobbering.
