# Builder Report — Mirror Unification + AGENTS.md Startup

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Builder
- To: Validator (for routing) / Editor (for review)
- Directive: `agent-relay/roles/Validator/directives/2026-06-17-mirror-unification.md`
- Tier: 2 (governance + tooling, multi-step)

> I am NOT certifying this work. The Editor and Validator review and decide.

## Files Changed

1. `tools/cursor_transcript_mirror.py` — (R3) Cursor mirror now also writes durable,
   source-tagged dated snapshots into the same tracked layout Codex uses:
   `memory-bank/transcripts/cursor/YYYY-MM-DD/latest.md`,
   `.../YYYY-MM-DD-HHMMSS-<thread>.md`, and `.../.snapshot-manifest.json`. Added the
   `datetime` import, snapshot cadence constants, and helpers ported from
   `codex_transcript_mirror.py` (`write_text_if_changed`, `sanitize_filename`,
   `should_write_dated_snapshot`, `update_snapshot_manifest`) plus cursor-specific
   `epoch_ms_to_datetime` and `cursor_snapshot_identity`. The existing
   `memory-bank/CURSOR_CONTINUITY.md` and `memory-bank/transcripts/cursor-session-live.md`
   writes are preserved unchanged in behavior.

2. `AGENTS.md` — (R2) Renamed/generalized the "Codex Transcript Mirror Startup" section to
   "Agent Transcript Mirror Startup"; the documented first boot action now idempotently
   launches BOTH `tools/start_codex_transcript_mirror.ps1` AND
   `tools/start_cursor_transcript_mirror.ps1` (both launchers are PID-guarded).
   (R4) Startup Read Order now has each agent read BOTH continuity files
   (`CODEX_CONTINUITY.md` + `CURSOR_CONTINUITY.md`) and BOTH recent transcript windows
   (codex + cursor live + dated `latest.md`). Also generalized the "Codex Continuity Memory"
   routing section to "Agent Continuity Memory" pointing at both continuity files.

3. `memory-bank/CODEX_MEMORY_POLICY.md` — (R5) Trackable Memory, Naming Convention, and
   Handling Rules now cover the new cursor dated snapshots
   (`memory-bank/transcripts/cursor/YYYY-MM-DD/...`) under the same trackable/naming/
   sensitive-handling rules as the codex snapshots. Notes the two mirrors share identical
   layout/cadence, differing only by the source-tagged `codex/` vs `cursor/` subfolder.

## What I Verified

- `python -c "import py_compile; py_compile.compile('tools/cursor_transcript_mirror.py', doraise=True)"`
  → `OK cursor`. Codex mirror also re-compiled → `OK codex`. Exit code 0.
- Editor/IDE linter on `tools/cursor_transcript_mirror.py` → no linter errors.
- Did NOT run the mirrors or any watcher (per constraints). No runtime/output verification of
  produced snapshot files was performed.

## R1 Finding (no change made)

- `CLAUDE.md` is already a thin router to `AGENTS.md` with no duplicated governance — left as-is
  (no gratuitous rewrite). No other agent bootstrap files were found
  (`.cursorrules`, `CODEX.md`, `CURSOR.md`, `.github/copilot-instructions.md` — none exist).

## R6 Finding (no change needed)

- `.gitignore` already ignores `offline-cursor-transcripts-*/` and `offline-codex-transcripts-*/`
  (lines 17–18). Left unchanged.
- `tools/codex_transcript_mirror.py` was NOT modified; codex behavior/output is preserved.

## Assumptions Made

- For the cursor dated-snapshot identity I reused the active Cursor composer: filename slug from
  the composer `name` (sanitized), and the manifest key base from `composerId` (falling back to the
  workspace path string when no composer is found). Codex keys snapshots by session id; Cursor has no
  session-id equivalent, so composerId is the closest stable analog.
- The snapshot timestamp/date uses `mirror-metadata.json`'s `mirrored_at_epoch_ms` when present,
  else `datetime.now()`. This determines the `YYYY-MM-DD` folder and the `HHMMSS` stamp.
- The dated snapshot content is the same `cursor-session-live.md` transcript text (parallel to how
  the codex mirror writes the same `snapshot_text` to both the live file and the dated snapshot).
- Snapshot cadence constants match codex exactly (6h min interval / 100k char delta).

## Limitations / Risks (for the Editor to focus on)

- Helper duplication: the cadence helpers are copied into `cursor_transcript_mirror.py` rather than
  shared. Codex imports its summary helpers from `codex_transcript_memory.py`; the cursor mirror keeps
  its own inline copies (pre-existing pattern). A shared module would reduce duplication but would be
  a larger refactor and risks touching the codex path — intentionally avoided to honor R6.
- Behavior parity is verified only by compile + lint, not by an actual mirror run. Snapshot key/slug
  derivation from composer data is unverified against live Cursor storage shape.
- I used `epoch_ms_to_datetime` for the snapshot date; if `mirrored_at_epoch_ms` is missing the folder
  date falls back to the local run time, which can differ from the conversation's actual day (codex
  derives its date from the session `updated_at`).
- I did not change `write_memory_bank_views`'s existing continuity/live writes to use
  `write_text_if_changed`; they still use direct `write_text` to avoid behavior drift. The new dated
  snapshots do use `write_text_if_changed` (matching codex).

## Intentionally NOT Done

- Did not rewrite `CLAUDE.md` (already compliant).
- Did not modify `tools/codex_transcript_mirror.py`, `codex_transcript_memory.py`, or the codex
  output layout.
- Did not modify `.gitignore` (offline raw-mirror ignores already present).
- Did not run mirrors/watchers, did not commit, did not route relay messages.
- GitNexus: these are Python tooling/mirror scripts and the edited docs are governance markdown; they
  are not application symbols in the indexed call graph, so no `gitnexus_impact` was run. If the
  Validator wants, `gitnexus_detect_changes` can confirm scope at review time.

## Certification

I am the Builder. I do NOT certify this work. Editor reviews for duplication/clarity/behavior drift;
Validator verifies scope and routes the decision.
