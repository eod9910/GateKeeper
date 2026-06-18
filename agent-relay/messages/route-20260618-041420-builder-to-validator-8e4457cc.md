BUILDER -> VALIDATOR
ABOUT: Transcript Retention and Archival (Tier 2) build
ACTION: Verify against files/diff and script output; do not treat as accepted.
TYPE: FACTUAL REPORT

# Transcript Retention and Archival - Builder Report

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Builder
- To: Validator
- Tier: 2 (PRD + checklist; full relay)

Implements the workstream in
`.planning/plans/ACTIVE/transcript-retention-archival-prd.md` and its checklist,
honoring the four confirmed decisions (tracked `archive/` subfolders, monthly
granularity, manual dry-run-default script, 30-day hot window) and all hard
constraints. Work is NOT self-certified; Validator verifies and Editor reviews.

## Files created

- `tools/archive_transcripts.py`
  Standalone manual maintenance script (dry-run default).
- `agent-relay/roles/Builder/reports/2026-06-17-transcript-archival-dryrun-report.md`
  Affected-path report emitted by the dry-run (also reproduced below).

## Files modified

- `memory-bank/MEMORY_ARCHIVE_POLICY.md`
  Added a "Transcript Retention and Archival (30-Day Hot Window)" section:
  retention window, relay timeline layout
  (`agent-relay/transcripts/all.md` hot + `archive/all-YYYY-MM.md` cold), dated
  snapshot layout (`<agent>/YYYY-MM-DD/` hot +
  `<agent>/archive/YYYY-MM/YYYY-MM-DD/` cold), and an explicit statement that the
  rollover is a manual `tools/archive_transcripts.py` run under the existing
  Destructive Cleanup Gate. Documents that relay windowing is relative to the
  newest route timestamp while snapshot archival is relative to today's date.
- `memory-bank/CODEX_MEMORY_POLICY.md`
  Added a "Retention and Archival" subsection documenting the 30-day hot window
  plus tracked monthly archive for both the `codex/` and `cursor/` trees, that
  archives stay tracked (not moved to `offline-*`), that `*-session-live.md` and
  `latest.md` are untouched, and that rollover is manual under the gate.
- `tools/agent_router.py`
  Phase 2 relay windowing (details below).

## Phase 2 implementation choices (tools/agent_router.py)

- Added `HOT_WINDOW_DAYS = 30` and `ARCHIVE_DIR = TRANSCRIPTS_DIR / "archive"`.
- Added `parse_route_timestamp()` to parse ISO-8601 UTC route timestamps
  (`...Z`), returning a tz-aware datetime or `None`.
- Added `split_hot_archive(records)` -> `(hot_list, {YYYY-MM: [records]})`.
  - The 30-day cutoff is computed relative to the MOST RECENT route timestamp in
    the log (NOT wall-clock), so regeneration is deterministic and testable. This
    choice is documented in a code comment/docstring.
  - Records with an unparseable/empty timestamp are kept HOT so no record is ever
    dropped.
  - Hot list + union of archive buckets equals the input exactly (no loss, no
    duplication).
- Added `regenerate_relay_timeline(records=None)` which writes the windowed hot
  `agent-relay/transcripts/all.md` (title `All Phases (last 30 days)`, with a
  header note pointing to the `archive/` folder) and one
  `agent-relay/transcripts/archive/all-YYYY-MM.md` per older month (each with its
  own header note), all rebuilt deterministically from `routes.jsonl`.
- Extended `render_transcript()` with an optional `header_note` parameter; the
  rendering of records is otherwise unchanged.
- Rewired `regenerate_transcripts()` to call `regenerate_relay_timeline()` for
  `all.md` instead of the previous full-dump `write_transcript(None, all.md)`.
  Per-phase transcript files are produced exactly as before.
- Updated `cmd_transcript()` so the default all-phases invocation (no `--phase`,
  no `--output`) produces the same windowed hot timeline, keeping `transcript`
  and `regenerate` consistent. All CLI subcommands remain intact: `route`,
  `regenerate`, `verify`, `transcript`, `inbox`, `export`, `routes`.
- `routes.jsonl`, the per-phase transcript files, and the size-capped
  `*-session-live.md` transcripts are behaviorally unchanged. The log is never
  trimmed, rewritten, or reordered; the views are derived and rebuildable.

## Phase 3 implementation choices (tools/archive_transcripts.py)

- Scans `memory-bank/transcripts/<agent>/YYYY-MM-DD/` for `<agent>` in
  `{codex, cursor}`, skipping the `archive/` subfolder and any non-date-named
  directories. Eligibility: folder date older than 30 days relative to today's
  date (`(today - folder_date).days > 30`).
- Plans moves into `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/`.
- Idempotent and OneDrive/Windows-safe: moves are file-by-file via `shutil.move`;
  files already present at the destination are reported as "skip, already
  archived" and left untouched; the source tree is removed only if it contains no
  remaining files (never deletes data).
- Defaults to `--dry-run`; `--apply` is required to make changes
  (mutually-exclusive flags; default is dry-run).
- Also drives the Phase 2 relay rollover: under `--apply` it imports
  `agent_router` and calls `regenerate_relay_timeline()`; under dry-run it reports
  what would be regenerated (so dry-run changes nothing).
- Always writes the affected-path report to
  `agent-relay/roles/Builder/reports/2026-06-17-transcript-archival-dryrun-report.md`
  and prints it to stdout.

## Validation performed (local)

- `python tools/agent_router.py verify` -> `{"ok": true, "checked": 62}`.
- `python -c "ast.parse(...)"` on both `tools/archive_transcripts.py` and
  `tools/agent_router.py` -> `AST OK`.
- `python tools/archive_transcripts.py` (dry-run) -> see affected paths below.
- `python tools/agent_router.py regenerate` -> hot `all.md` regenerated with the
  `All Phases (last 30 days)` title and the archive-pointer header note. With the
  current data (all routes within 30 days of the newest), `all.md` legitimately
  contains all 62 routes and NO `archive/all-YYYY-MM.md` files exist yet - this is
  expected.
- Windowing logic check WITHOUT fabricating data in `routes.jsonl`: an in-memory
  call to `split_hot_archive()` with synthetic records (Jan, Feb, an edge route
  inside the window, the newest route, and an empty-timestamp record) produced:
  - HOT: `edge-old`, `newest`, `no-ts`
  - ARCHIVE: `2026-01` -> `old-jan`, `2026-02` -> `old-feb`
  - union == all inputs (5 of 5), confirming no loss and no duplication.

## Dry-run affected-path output

```
# Transcript Archival Report

- Mode: `DRY-RUN`
- Generated (today): `2026-06-17`
- Hot window: `30` days
- Snapshot root: `memory-bank/transcripts`

## Relay timeline rollover

- Would regenerate agent-relay/transcripts/all.md (hot 30-day window) and agent-relay/transcripts/archive/all-YYYY-MM.md (older months) from routes.jsonl.

## Snapshot day-folder moves

### cursor/2026-03-10 (age 99 days)

- Move: `memory-bank/transcripts/cursor/2026-03-10` -> `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10`
  - `memory-bank/transcripts/cursor/2026-03-10/.snapshot-manifest.json` -> `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10/.snapshot-manifest.json`
  - `memory-bank/transcripts/cursor/2026-03-10/2026-03-10-153439-cursor-session.md` -> `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10/2026-03-10-153439-cursor-session.md`
  - `memory-bank/transcripts/cursor/2026-03-10/latest.md` -> `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10/latest.md`

## Summary

- Day-folders affected: `1`
- Files to move: `3`
```

## Assumptions

- "Older than 30 days" for snapshot folders uses `> 30` days relative to today's
  date (`date.today()`); for relay windowing it uses `>= cutoff` where
  `cutoff = newest_route_ts - 30 days`. The two different bases (today vs newest
  route timestamp) are intentional per the directive and documented.
- The relay rollover is treated as a non-destructive derived-view regeneration,
  so the archive script only triggers it under `--apply` (dry-run reports it but
  changes nothing).
- The `.snapshot-manifest.json` inside a day-folder is moved along with the
  folder (it is part of that day's snapshot record).

## Limitations / not done by Builder

- No real `--apply` archival move was performed; only the dry-run was run. The
  first real move must go through the Destructive Cleanup Gate (Validator
  approval, this Builder report, Editor review, recoverable trail) per
  `MEMORY_ARCHIVE_POLICY.md`. That gated apply step is Phase 4 and is not
  self-executed here.
- No `agent-relay/transcripts/archive/all-YYYY-MM.md` files exist yet because all
  current routes are within the hot window; the archive path is exercised only by
  the synthetic in-memory check, not by live data.
- Checklist `Percent complete:` line was left unchanged (Validator/Editor own
  acceptance state); no git commit was made.
