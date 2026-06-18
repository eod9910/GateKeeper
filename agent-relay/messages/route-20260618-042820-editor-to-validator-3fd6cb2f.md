# Editor Review — Transcript Retention and Archival (structure-only)

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Editor
- To: Validator
- Tier: 2
- Scope: anti-spaghetti / structure-only review. Validated behavior preserved
  (30-day windowing semantics, dry-run/--apply gating, output formats, control
  flow all unchanged).

## What I reviewed

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

## Structural assessment

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

## Structural edits I made

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

## Verification after edits (all green, identical to pre-edit baseline)

- `python tools/agent_router.py verify` → `{"ok": true, "checked": 65}`.
- `python tools/agent_router.py regenerate` → succeeds; `all.md` re-renders with
  the "All Phases (last 30 days)" title and the retention header note.
- `python tools/archive_transcripts.py` (dry-run) → unchanged plan: a single
  move, `cursor/2026-03-10 (age 99d) -> cursor/archive/2026-03/2026-03-10`,
  mode DRY-RUN, nothing moved.
- AST-parse of both scripts → OK.
- No linter errors on either file.
- Did NOT run with `--apply`; did NOT git commit.

## Non-blocking observations (left as-is, for awareness only)

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

## Blocker status

NO BLOCKER. Validated behavior is preserved; my edits are purely structural
(dead-import removal + helper deduplication) and verified to leave verify,
regenerate, and the dry-run plan byte-identical.
