# Agent Relay Transcript: transcript-retention-archival

Generated: 2026-06-20T14:10:41Z

## 1. Validator -> Builder: Transcript retention and archival (Tier 2)

- Routing ID: `route-20260618-040810-validator-to-builder-e37efc95`
- Type: `DIRECTIVE`
- Phase: `transcript-retention-archival`
- Timestamp: `2026-06-18T04:08:10Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-17-transcript-retention-archival.md`
- Body: `agent-relay/messages/route-20260618-040810-validator-to-builder-e37efc95.md`
- SHA-256: `88154f5559d3e2cbfcd482b170aad68c4bb74f559a3210bf87c873222f02f46b`

### Validator Directive — Transcript Retention and Archival

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Validator
- To: Builder
- Tier: 2 (PRD + checklist; full relay)

#### Frozen requirements

Implement the workstream defined in:

- `.planning/plans/ACTIVE/transcript-retention-archival-prd.md`
- `.planning/plans/ACTIVE/transcript-retention-archival-checklist.md`

Build to the checklist, in order, honoring these confirmed decisions:

1. Tracked `archive/` subfolders (not the offline local-only mirrors).
2. Monthly granularity (`YYYY-MM`); no weekly sharding.
3. Manual on-demand script `tools/archive_transcripts.py`, defaulting to dry-run,
   gated by the Destructive Cleanup process; not run at startup.
4. 30-day hot window.

#### Hard constraints

- `routes.jsonl` is the immutable source of truth. Archives are DERIVED views;
  never trim, rewrite, or reorder the log.
- Do NOT change the size-capped `*-session-live.md` transcripts.
- Archival is a MOVE, never a delete; the script must be idempotent and safe to
  re-run on Windows/OneDrive paths.
- Hot `all.md` + monthly archive files must reconstruct exactly to the full route
  set (no loss, no duplication).

#### Report back

Builder report must list every file created/modified, show the dry-run
affected-path output, and state any assumptions or limitations. Do NOT mark the
work accepted — Validator verifies, then Editor reviews.


---

## 2. Builder -> Validator: Transcript retention and archival build

- Routing ID: `route-20260618-041420-builder-to-validator-8e4457cc`
- Type: `REPORT`
- Phase: `transcript-retention-archival`
- Timestamp: `2026-06-18T04:14:20Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-17-transcript-retention-archival-builder-report.md`
- Body: `agent-relay/messages/route-20260618-041420-builder-to-validator-8e4457cc.md`
- SHA-256: `e02bc1d5f2121adfbe51d034d982770ad581668a27ccf7e68528147b74567ff8`

BUILDER -> VALIDATOR
ABOUT: Transcript Retention and Archival (Tier 2) build
ACTION: Verify against files/diff and script output; do not treat as accepted.
TYPE: FACTUAL REPORT

### Transcript Retention and Archival - Builder Report

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

#### Files created

- `tools/archive_transcripts.py`
  Standalone manual maintenance script (dry-run default).
- `agent-relay/roles/Builder/reports/2026-06-17-transcript-archival-dryrun-report.md`
  Affected-path report emitted by the dry-run (also reproduced below).

#### Files modified

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

#### Phase 2 implementation choices (tools/agent_router.py)

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

#### Phase 3 implementation choices (tools/archive_transcripts.py)

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

#### Validation performed (local)

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

#### Dry-run affected-path output

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

#### Assumptions

- "Older than 30 days" for snapshot folders uses `> 30` days relative to today's
  date (`date.today()`); for relay windowing it uses `>= cutoff` where
  `cutoff = newest_route_ts - 30 days`. The two different bases (today vs newest
  route timestamp) are intentional per the directive and documented.
- The relay rollover is treated as a non-destructive derived-view regeneration,
  so the archive script only triggers it under `--apply` (dry-run reports it but
  changes nothing).
- The `.snapshot-manifest.json` inside a day-folder is moved along with the
  folder (it is part of that day's snapshot record).

#### Limitations / not done by Builder

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


---

## 3. Builder -> Validator: Transcript retention and archival build

- Routing ID: `route-20260618-042124-builder-to-validator-df15f55d`
- Type: `REPORT`
- Phase: `transcript-retention-archival`
- Timestamp: `2026-06-18T04:21:24Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-17-transcript-retention-archival-builder-report.md`
- Body: `agent-relay/messages/route-20260618-042124-builder-to-validator-df15f55d.md`
- SHA-256: `7b573e11380451260ec27396042600a2d589f85a4de30f12e8a06c0274ec5e51`

### Builder Report — Transcript Retention and Archival

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Builder
- To: Validator
- Tier: 2 (PRD + checklist; full relay)
- Status: implemented; NOT self-certified. Validator verifies, Editor reviews.

#### Summary

Implemented the Tier 2 "Transcript Retention and Archival" workstream: a 30-day
hot window for both unbounded transcript stores, with tracked monthly cold
archives derived from the immutable `routes.jsonl`, plus a manual, dry-run-by-
default mover that rolls over both stores in one command.

Phases 1 (docs) and 2 (relay windowing in `tools/agent_router.py`) were already
present in the working tree from prior uncommitted work; I verified them against
the PRD/checklist and the hard constraints. Phase 3 (`tools/archive_transcripts.py`)
is new in this build. No git commit was made.

#### Files created / modified

Created:

- `tools/archive_transcripts.py` — Phase 3 manual mover (new).
- `agent-relay/roles/Builder/reports/2026-06-17-transcript-archival-dryrun-report.md`
  — affected-path report emitted by the dry-run (new, generated by the script).
- `agent-relay/roles/Builder/reports/2026-06-17-transcript-retention-archival-builder-report.md`
  — this report (new).

Modified (Phase 1 + Phase 2; verified, present from prior uncommitted work):

- `memory-bank/MEMORY_ARCHIVE_POLICY.md` — added the "Transcript Retention and
  Archival (30-Day Hot Window)" section: 30-day window, relay timeline layout
  (`agent-relay/transcripts/all.md` hot + `agent-relay/transcripts/archive/all-YYYY-MM.md`
  cold), dated snapshot layout (`memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/`),
  and the manual-rollover-under-Destructive-Cleanup-Gate statement.
- `memory-bank/CODEX_MEMORY_POLICY.md` — added a "Retention and Archival" section
  describing the hot window + monthly archive across the `codex/` and `cursor/`
  trees and the manual mover.
- `tools/agent_router.py` — added `HOT_WINDOW_DAYS=30`, `ARCHIVE_DIR`,
  `parse_route_timestamp`, `split_hot_archive`, `regenerate_relay_timeline`;
  `render_transcript` gained an optional `header_note`; `regenerate_transcripts`
  and `cmd_transcript` now produce the windowed hot `all.md` + monthly archive
  files. CLI subcommands (route, regenerate, verify, transcript, inbox, export,
  routes) are unchanged.

Untouched (by design):

- `agent-relay/router/routes.jsonl` — NOT modified by my code. `git diff` shows
  it is append-only (`2 insertions, 0 deletions`) from prior relay routing; no
  trimming, rewriting, or reordering.
- The size-capped `*-session-live.md` transcripts and `MAX_TRANSCRIPT_CHARS`
  behavior in the mirrors are untouched.

#### Key implementation choices

- **Deterministic relay window:** `split_hot_archive` computes the 30-day cutoff
  relative to the most recent route timestamp in `routes.jsonl` (not wall-clock),
  documented in a code comment, so regeneration is deterministic and testable.
- **No data loss in the relay split:** routes with a missing/unparseable
  timestamp are kept hot rather than dropped. Verified the union of hot + archive
  equals the full input with no loss and no duplication.
- **Snapshot mover eligibility** uses today's date (per policy): a
  `<agent>/YYYY-MM-DD/` folder is eligible when strictly older than 30 days.
  The `archive` subfolder and non-date folders are skipped, so the mover never
  recurses into already-archived content.
- **Move, never delete; idempotent:** fresh moves use `shutil.move` of the whole
  folder. A pre-existing destination (interrupted prior run) is reconciled
  file-by-file: identical files are de-duplicated (the byte-identical copy
  already exists at the destination), differing files are left in source and
  reported as conflicts (never overwritten). Only empty container directories
  are removed; no files are ever deleted.
- **Dry-run is the default and wins ambiguity:** `--apply` is required to mutate
  the filesystem; if both `--apply` and `--dry-run` are passed, dry-run wins.
  The relay rollover (`agent_router.regenerate_relay_timeline()`) only runs under
  `--apply`, keeping dry-run side-effect-free apart from writing the report.
- **One command, both stores:** the mover imports `agent_router` and drives the
  Phase 2 relay rollover so a single invocation handles both the relay timeline
  and the snapshot day-folders.

#### Validation performed

- `python tools/agent_router.py verify` -> `{"ok": true, "checked": 63}`.
- `python -c "import ast,pathlib; ast.parse(...)"` on both `tools/archive_transcripts.py`
  and `tools/agent_router.py` -> `AST OK`. No linter errors.
- `python tools/archive_transcripts.py` (dry-run) -> planned exactly one move:
  `memory-bank/transcripts/cursor/2026-03-10` (age 99d) ->
  `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10` [move-folder];
  recent folders (`codex/2026-06-15`, `codex/2026-06-17`, `cursor/2026-06-17`)
  correctly left hot; no files moved.
- `python tools/agent_router.py regenerate` -> `agent-relay/transcripts/all.md`
  renders with title "All Phases (last 30 days)" and the archive header note.
  With only recent routes, `all.md` legitimately contains everything and no
  `archive/all-YYYY-MM.md` files exist yet — expected.
- Windowing invariant proven with a temp in-memory test (no `routes.jsonl`
  fabrication): synthetic routes across Jan/Feb/Jun + one blank timestamp ->
  hot = `[r3(Jun), r4(Jun), r5(bad-ts)]`, archive = `{2026-01:[r1], 2026-02:[r2]}`,
  and the hot+archive union equaled the input exactly (no loss, no duplication).

#### Dry-run affected-path output

```
## Snapshot day-folder moves

### cursor/2026-03-10 (age 99d) -> cursor/archive/2026-03/2026-03-10
- Source: `memory-bank/transcripts/cursor/2026-03-10`
- Destination: `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10`
- Destination pre-existing: `False`
- File actions:
    - `memory-bank/transcripts/cursor/2026-03-10` -> `memory-bank/transcripts/cursor/archive/2026-03/2026-03-10` [move-folder]
- Source emptied/removed: `False`

## Relay timeline rollover
- would regenerate agent-relay/transcripts/all.md + agent-relay/transcripts/archive/all-YYYY-MM.md (derived from routes.jsonl, non-destructive)
```

Full report at
`agent-relay/roles/Builder/reports/2026-06-17-transcript-archival-dryrun-report.md`.

#### Assumptions

- Treated the prior uncommitted Phase 1/Phase 2 changes as part of this
  workstream and verified them rather than rewriting; they match the PRD,
  checklist, and hard constraints.
- The fixed dry-run report filename `2026-06-17-transcript-archival-dryrun-report.md`
  is written on every run (mode is recorded inside the report body).
- Removing emptied source container directories after a successful move is
  treated as in-scope cleanup, not a "delete" of historical memory (no files are
  removed except byte-identical duplicates already present at the destination).

#### Limitations / not done

- No `--apply` run was performed. Phase 4's first real archival move must go
  through the Destructive Cleanup Gate (Validator approval, this Builder report,
  Editor review, recoverable trail) before applying.
- The checklist `Percent complete:` line is left for the Validator to update
  after verification (Phase 4 close-out item), and no git commit was made.
- The merge/conflict reconciliation path (pre-existing destination) was exercised
  by reasoning and code review, not by a live interrupted-run scenario.


---

## 4. Validator -> Editor: Editor review: transcript retention build

- Routing ID: `route-20260618-042410-validator-to-editor-19f73143`
- Type: `DIRECTIVE`
- Phase: `transcript-retention-archival`
- Timestamp: `2026-06-18T04:24:10Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-17-transcript-retention-editor-review.md`
- Body: `agent-relay/messages/route-20260618-042410-validator-to-editor-19f73143.md`
- SHA-256: `b4e0ee65964014c38cb57746345218b94209cb77150d220b602181901fadee0f`

### Validator Directive — Editor Review: Transcript Retention and Archival

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Validator
- To: Editor
- Tier: 2

#### Validator verification (passed)

Independently verified against files/diff/command output (not the Builder report):

- `split_hot_archive` cutoff = newest-route-timestamp − 30d; hot = newer-or-equal
  or unparseable; older bucketed by `%Y-%m`. Hot ∪ archive == input (no loss/dup).
- `routes.jsonl` append-only (numstat 3/0); not mutated.
- Phase transcripts changed only their `Generated:` line (behavior preserved).
- `all.md` renders "last 30 days" with archive pointer; `verify` ok (64 routes).
- Dry-run isolates the single 99-day folder and moves nothing.

#### Editor task (structure-only, no behavior change)

Anti-spaghetti review of:

- `tools/agent_router.py` (new: `parse_route_timestamp`, `split_hot_archive`,
  `regenerate_relay_timeline`, `HOT_WINDOW_DAYS`, `ARCHIVE_DIR`, `header_note`).
- `tools/archive_transcripts.py` (new file).
- `memory-bank/MEMORY_ARCHIVE_POLICY.md`, `memory-bank/CODEX_MEMORY_POLICY.md`.

Check naming, duplication, dead code, oversized functions, clarity of the
dry-run/--apply path, and doc/code agreement. Preserve validated behavior. If you
find a behavior/data-flow problem, raise an EDITOR BLOCKER for the Builder rather
than fixing it yourself. Report findings; do not certify your own changes.


---

## 5. Editor -> Validator: Editor review: transcript retention build

- Routing ID: `route-20260618-042820-editor-to-validator-3fd6cb2f`
- Type: `REVIEW`
- Phase: `transcript-retention-archival`
- Timestamp: `2026-06-18T04:28:20Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-17-transcript-retention-editor-review.md`
- Body: `agent-relay/messages/route-20260618-042820-editor-to-validator-3fd6cb2f.md`
- SHA-256: `6363959931399a141411baa5f89ee2ffbe28cd615a52257143796b629904b998`

### Editor Review — Transcript Retention and Archival (structure-only)

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Editor
- To: Validator
- Tier: 2
- Scope: anti-spaghetti / structure-only review. Validated behavior preserved
  (30-day windowing semantics, dry-run/--apply gating, output formats, control
  flow all unchanged).

#### What I reviewed

- `tools/agent_router.py` — new `parse_route_timestamp`, `split_hot_archive`,
  `regenerate_relay_timeline`, the `HOT_WINDOW_DAYS` / `ARCHIVE_DIR` constants,
  and the `header_note` plumbing through `render_transcript` / `write_transcript`
  / `cmd_transcript`. Confirmed the existing subcommands
  (`route`, `regenerate`, `verify`, `transcript`, `inbox`, `export`, `routes`)
  are all still wired in `build_parser` and intact.
- `tools/archive_transcripts.py` — dry-run default, `--apply` gating, the
  move-only / idempotent folder reconciler (`reconcile_move`,
  `remove_empty_dirs`, `files_identical`), the report writer (`build_report`),
  and the relay rollover driver (`run_relay_rollover` → `agent_router.
  regenerate_relay_timeline`).
- `memory-bank/MEMORY_ARCHIVE_POLICY.md` and `memory-bank/CODEX_MEMORY_POLICY.md`
  — checked the documented 30-day window, monthly archive layout, and
  manual-under-gate language against the actual code paths.

#### Structural assessment

The build is clean and readable. Functions are well-sized and single-purpose,
docstrings accurately describe intent, the hot/archive split is deterministic
(anchored to the newest route, not wall-clock), and the dry-run/--apply path is
explicit (dry-run wins any ambiguity). Naming is consistent and descriptive.

Doc/code agreement is correct:
- Relay hot path `agent-relay/transcripts/all.md` + cold
  `agent-relay/transcripts/archive/all-YYYY-MM.md` match the code.
- Snapshot hot `memory-bank/transcripts/<agent>/YYYY-MM-DD/` + cold
  `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/` match the code.
- The 30-day window, relay-window-relative-to-newest-route vs.
  snapshot-relative-to-today distinction, manual-under-gate, and
  move-never-delete statements all match actual behavior.

#### Structural edits I made

1. `tools/agent_router.py`: removed the unused `import shutil`. It was
   pre-existing dead code (introduced in commit `0a4e40533`, never referenced)
   and is unrelated to but adjacent to this workstream. Pure dead-code removal,
   no behavior change.
2. `tools/archive_transcripts.py`: removed the duplicated local `utc_now` and
   `rel` helpers (byte-identical to the ones in `agent_router`, which the file
   already imports) and replaced them with module-level aliases
   `utc_now = agent_router.utc_now` / `rel = agent_router.rel`. This also fixes a
   pre-edit inconsistency where the file used its own `rel` in most places but
   `agent_router.rel` in `run_relay_rollover`; that call now uses the shared
   `rel` too. Dropped the now-unused `timezone` import. Both helpers share the
   same repo ROOT, so output is byte-for-byte identical. No behavior change.

Rationale: both edits reduce duplication / dead code (anti-spaghetti) without
touching control flow, the windowing math, the gating, or any emitted format.

#### Verification after edits (all green, identical to pre-edit baseline)

- `python tools/agent_router.py verify` → `{"ok": true, "checked": 65}`.
- `python tools/agent_router.py regenerate` → succeeds; `all.md` re-renders with
  the "All Phases (last 30 days)" title and the retention header note.
- `python tools/archive_transcripts.py` (dry-run) → unchanged plan: a single
  move, `cursor/2026-03-10 (age 99d) -> cursor/archive/2026-03/2026-03-10`,
  mode DRY-RUN, nothing moved.
- AST-parse of both scripts → OK.
- No linter errors on either file.
- Did NOT run with `--apply`; did NOT git commit.

#### Non-blocking observations (left as-is, for awareness only)

- `render_transcript` sorts its `records` argument in place
  (`records.sort(...)`). In `regenerate_relay_timeline` the lists passed (`hot`,
  per-month buckets) are freshly constructed, so no caller's list is unexpectedly
  mutated and current behavior is correct. Flagging only as a latent in-place
  mutation; not a defect today, so not changed.
- The `--dry-run` argparse help string ("Overridden by nothing; if both --apply
  and --dry-run are given, --dry-run wins for safety.") reads slightly
  self-contradictory. Left untouched to avoid changing CLI `--help` output; the
  documented behavior (dry-run wins) matches `main`'s
  `apply = bool(args.apply) and not args.dry_run`.

#### Blocker status

NO BLOCKER. Validated behavior is preserved; my edits are purely structural
(dead-import removal + helper deduplication) and verified to leave verify,
regenerate, and the dry-run plan byte-identical.


---
