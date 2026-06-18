# Agent Relay Transcript: agent-memory-mirror-unification

Generated: 2026-06-18T03:51:18Z

## 1. Validator -> Builder: Unify agent transcript mirrors + AGENTS.md startup

- Routing ID: `route-20260618-031504-validator-to-builder-8c846aa2`
- Type: `EXECUTION DIRECTIVE`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:15:04Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-17-mirror-unification.md`
- Body: `agent-relay/messages/route-20260618-031504-validator-to-builder-8c846aa2.md`
- SHA-256: `8a48e9d4ffb22f224d2a8de978b08a83a0f65eb9cad6bab29024d066f37bb448`

# Validator Directive — Unify Agent Transcript Mirrors + AGENTS.md Startup

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Validator
- To: Builder
- Tier: 2 (governance + tooling, multi-step)
- Type: EXECUTION DIRECTIVE

## Goal (User/Mediator)

Make every agent (Codex and Cursor/Claude) boot from one synchronized governance
file, spin up BOTH transcript mirrors first thing, and write their transcripts
into one shared, source-tagged archive so each agent can read what it did AND
what the other agent did.

## Frozen Requirements

R1. Single startup source of truth.
- Every agent bootstrap file (`CLAUDE.md`, and any Cursor/Codex-specific
  startup file if one exists) must be a thin router to `AGENTS.md`.
- No duplicated governance content in bootstrap files. Confirm `CLAUDE.md`
  already routes; fix any bootstrap that does not.

R2. Mirrors spin first, for every agent.
- `AGENTS.md` "Codex Transcript Mirror Startup" section must be generalized so
  startup idempotently launches BOTH mirrors as the first action:
  - `tools/start_codex_transcript_mirror.ps1`
  - `tools/start_cursor_transcript_mirror.ps1`
- Both launchers are already idempotent (PID-guarded); starting both on every
  boot is safe.

R3. One shared, source-tagged transcript store.
- The Cursor/Claude mirror must write durable outputs into the SAME tracked
  layout under `memory-bank/transcripts/` that Codex uses, tagged source=cursor:
  - `memory-bank/transcripts/cursor/YYYY-MM-DD/latest.md`
  - `memory-bank/transcripts/cursor/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread>.md`
  - `memory-bank/transcripts/cursor/YYYY-MM-DD/.snapshot-manifest.json`
  - keep `memory-bank/CURSOR_CONTINUITY.md` and
    `memory-bank/transcripts/cursor-session-live.md` current.
- Use `tools/codex_transcript_mirror.py` as the reference implementation for
  layout, naming, and durable-snapshot cadence. Mirror its structure; do not
  invent a new scheme.

R4. Cross-agent visibility in the startup read order.
- `AGENTS.md` startup read order must have each agent read BOTH continuity files
  (`CODEX_CONTINUITY.md` and `CURSOR_CONTINUITY.md`) and both recent transcript
  windows (codex + cursor), so Codex sees Cursor's work and vice versa.

R5. Memory policy coverage.
- Update `memory-bank/CODEX_MEMORY_POLICY.md` (or add a parallel section) so the
  new cursor dated snapshots are covered by the same trackable/naming/sensitive
  handling rules already applied to the codex snapshots.

R6. No regressions.
- Do not change existing Codex mirror behavior or output.
- Preserve `.gitignore` rules for `offline-*-transcripts-*/` raw mirrors.

## Process Constraints

- GitNexus: run impact analysis before editing any indexed symbol; note if a
  tool/script is not indexed.
- Builder writes a report to
  `agent-relay/roles/Builder/reports/2026-06-17-mirror-unification-builder-report.md`
  listing every file changed, assumptions, and limitations. Builder does NOT
  certify its own work.
- Editor then reviews for duplication/clarity/behavior drift and writes
  `agent-relay/roles/Editor/reports/2026-06-17-mirror-unification-editor-review.md`.
- Validator verifies scope (git status / gitnexus detect_changes), routes all
  messages through `tools/agent_router.py` one at a time, and returns the
  decision to the User/Mediator.

## Acceptance Criteria

- `CLAUDE.md` (and peers) route to `AGENTS.md`; no duplicate governance.
- `AGENTS.md` startup starts both mirrors idempotently, first.
- Cursor dated snapshots appear under `memory-bank/transcripts/cursor/`.
- Startup read order references both continuity files + both transcript windows.
- Memory policy covers cursor snapshots.
- Codex mirror behavior unchanged; offline raw mirrors still git-ignored.


---

## 2. Builder -> Validator: Mirror unification builder report

- Routing ID: `route-20260618-032050-builder-to-validator-4fdf8daf`
- Type: `BUILDER REPORT`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:20:50Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-17-mirror-unification-builder-report.md`
- Body: `agent-relay/messages/route-20260618-032050-builder-to-validator-4fdf8daf.md`
- SHA-256: `9d3e551ae272eb0c8634dd97cb83d6c90274b4b81d330a41b86bcd6345721e3e`

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


---

## 3. Editor -> Validator: Mirror unification editor review

- Routing ID: `route-20260618-032606-editor-to-validator-fa191665`
- Type: `EDITOR REVIEW`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:26:06Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-17-mirror-unification-editor-review.md`
- Body: `agent-relay/messages/route-20260618-032606-editor-to-validator-fa191665.md`
- SHA-256: `5965686c7a615e4cdfe509bb2d9c2937b2809146c03fa76dd51c080295b03a7c`

# Editor Review — Mirror Unification + AGENTS.md Startup

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Editor
- To: Validator
- Directive: `agent-relay/roles/Validator/directives/2026-06-17-mirror-unification.md`
- Builder report: `agent-relay/roles/Builder/reports/2026-06-17-mirror-unification-builder-report.md`
- Tier: 2 (governance + tooling, multi-step)

> I am the Editor. I review for readability/modularity/maintainability and
> behavior drift, and may perform structure-only, behavior-preserving refactors.
> I do NOT add product behavior and I do NOT certify that any refactor preserved
> behavior — that is the Validator's call.

## What I Reviewed

- `tools/cursor_transcript_mirror.py` — the main change (new dated-snapshot logic + ported helpers).
- `tools/codex_transcript_mirror.py` — read as the reference implementation only; not modified.
- `AGENTS.md` — startup read order, new "Agent Transcript Mirror Startup" section, "Agent Continuity Memory" rename.
- `memory-bank/CODEX_MEMORY_POLICY.md` — cursor snapshot coverage.
- `CLAUDE.md` — router compliance (R1).
- `git diff` and `git status --porcelain` for the five files to confirm scope.

## Refactor Decision: LEFT AS-IS (no code change)

I performed **no** refactor. The one structural improvement on the table —
extracting the duplicated cadence helpers into a shared module
(`tools/_transcript_mirror_common.py`) imported by BOTH mirrors — is **not**
available without violating the directive:

- To actually remove the duplication, `tools/codex_transcript_mirror.py` would
  have to stop defining `write_text_if_changed`, `sanitize_filename`,
  `should_write_dated_snapshot`, `update_snapshot_manifest`, and the
  `SNAPSHOT_*` constants locally and import them from the shared module instead.
  That edits the codex file, which the directive (R6 and the explicit
  "codex path must stay untouched" constraint) prohibits.
- Extracting a shared module and importing it from cursor **only** would not
  reduce duplication — codex would still keep its own copies — it would just add
  a third home for the same code. That is strictly worse.

Therefore the only behavior-preserving, codex-safe option is to leave the
duplication and record it as a non-blocking tech-debt note (below). This is also
consistent with the file's pre-existing pattern: `cursor_transcript_mirror.py`
already carried its own private copies of `write_json` / `load_json_file` /
`copy_if_exists` before this change.

Independent compile check (mine, not a behavior certification):

```
python -c "import py_compile; py_compile.compile('tools/cursor_transcript_mirror.py', doraise=True)"
→ OK cursor (exit 0)
```

## Behavior-Drift Review

- **Existing cursor continuity / live writes preserved.** The only change to
  existing logic in `write_memory_bank_views` is hoisting
  `"\n".join(transcript_lines)` into a local `snapshot_text` variable and writing
  that same string. `CURSOR_CONTINUITY.md` and `cursor-session-live.md` are still
  written with direct `write_text` to the same paths with identical content. No
  observable drift in those two files.
- **New work is additive and runs last.** The dated-snapshot block executes
  *after* the continuity and live files are already written, so the critical
  startup files are produced even if the new block were to fail. Good ordering.
- **Codex path untouched.** `tools/codex_transcript_mirror.py` and
  `codex_transcript_memory.py` do not appear in `git diff`/`git status`. Scope is
  exactly `AGENTS.md`, `memory-bank/CODEX_MEMORY_POLICY.md`,
  `tools/cursor_transcript_mirror.py`. Codex behavior/output is unchanged.
- **Docs match intent.** AGENTS.md startup now reads both continuity files and
  both transcript windows (R4); the mirror-startup section launches both
  PID-guarded launchers first (R2); `CLAUDE.md` is already a thin router (R1);
  the memory policy now covers the cursor dated snapshots under the same
  trackable/naming/sensitive rules (R5).

I confirm I found no behavior drift I introduced (I introduced none), and no
sign that the Builder change altered the two existing cursor output files'
content. I do not certify Builder's new snapshot behavior is correct — that is
the Validator's call.

## Correctness Smells in the New Snapshot Code (reviewed, none blocking)

- **Date-folder derivation.** `snapshot_dt = epoch_ms_to_datetime(metadata.get("mirrored_at_epoch_ms")) or datetime.now()`.
  Note `write_memory_bank_views` runs *before* `write_metadata` in `mirror_once`,
  so `mirrored_at_epoch_ms` is the *previous* run's timestamp (or absent on the
  first run, falling back to `datetime.now()`). In practice this is ~one interval
  stale and rarely crosses a day boundary, so the `YYYY-MM-DD` folder and
  `HHMMSS` stamp are effectively "now-ish". This differs from codex, which dates
  by the conversation's `updated_at`; for old/idle composers the cursor folder
  date can land on the mirror day rather than the conversation day. Acceptable
  given Cursor exposes no reliable per-conversation timestamp. Non-blocking;
  already flagged by Builder.
- **Slug / manifest-key choice.** `cursor_snapshot_identity` returns a filename
  slug from the composer `name` and a manifest key base from `composerId`
  (falling back to name, then workspace path). `snapshot_key = f"{date_part}:{base}"`
  parallels codex's `f"{date_part}:{record.id}"`. `composerId` is the closest
  stable per-conversation analog to a codex session id; the key is stable across
  runs. Reasonable. The slug, even if derived from a UUID, is capped at 120 chars
  by `sanitize_filename`, so no oversized/binary filenames. Non-blocking.
- **Cadence gating.** `should_write_dated_snapshot` / `update_snapshot_manifest`
  and the `SNAPSHOT_MIN_SECONDS` (6h) / `SNAPSHOT_MIN_CHAR_DELTA` (100k) constants
  are byte-identical to codex, and `latest.md` is written every run via
  `write_text_if_changed` while the timestamped checkpoint is gated by the
  manifest. Matches the reference. No smell.

## Clarity Review

- Naming is clear and intent-revealing (`cursor_snapshot_identity`,
  `epoch_ms_to_datetime`, `snapshot_text`, `snapshot_key_base`).
- Comments explain intent, not mechanics (e.g. "Durable, source-tagged dated
  snapshots in the same tracked layout Codex uses ... mirroring
  codex_transcript_mirror.py"). No narration-style noise.
- No dead code introduced. The `datetime` import is now used.
- AGENTS.md reads cleanly. Minor, acceptable redundancy: the new "Agent
  Transcript Mirror Startup" section restates which files each mirror keeps
  current, which overlaps slightly with the memory policy; this is appropriate
  for a routing doc and not worth a change.

## Non-Blocking Concerns (tech debt)

1. **Helper duplication (tracked).** `write_text_if_changed`,
   `sanitize_filename`, `should_write_dated_snapshot`,
   `update_snapshot_manifest`, and the `SNAPSHOT_*` constants are duplicated
   between `cursor_transcript_mirror.py` and `codex_transcript_mirror.py`.
   Intentionally left as-is because de-duplicating requires editing the codex
   file, which is out of scope for this directive. Recommend a *separate,
   codex-inclusive* refactor ticket: extract a `tools/_transcript_mirror_common.py`
   and migrate both mirrors together, validated end-to-end. Do not attempt it
   piecemeal.
2. **Snapshot date can lag the conversation day** for idle composers (see "Date-
   folder derivation"). If exact conversation-day bucketing ever matters, source
   a per-composer `lastUpdatedAt` for the date instead of mirror time.
3. **Behavior parity is compile/lint-verified only.** Neither Builder nor Editor
   ran the mirror, so the composer-derived slug/key and the produced snapshot
   files are unverified against live Cursor storage shape. Flagging for the
   Validator's verification plan, not as a defect.

## Editor Blocker

**Editor found no blocker.**

## Certification

I am the Editor. I made no code changes, so there is nothing of mine to
certify. I do not certify that Builder's new snapshot behavior preserves prior
behavior or is functionally correct — that determination belongs to the
Validator.


---

## 4. Validator -> Builder: Cursor mirror resilience to malformed source DB

- Routing ID: `route-20260618-032915-validator-to-builder-62ef62b7`
- Type: `EXECUTION DIRECTIVE`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:29:15Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-17-cursor-mirror-resilience.md`
- Body: `agent-relay/messages/route-20260618-032915-validator-to-builder-62ef62b7.md`
- SHA-256: `162186f4c70af4029bca79821dda6ab3638fc94471ba8beb7e54a5d41ba87141`

# Validator Directive — Cursor Mirror Resilience to Malformed/Locked Source DB

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Validator
- To: Builder
- Tier: 1 (defensive bug fix)
- Type: EXECUTION DIRECTIVE

## Problem (found during Validator verification)

The Cursor mirror crashes on startup:

```
sqlite3.DatabaseError: database disk image is malformed
  tools/cursor_transcript_mirror.py: export_decoded_views -> read_itemtable_value(global_db, "openai.chatgpt")
```

`read_itemtable_value` (around line 267) opens a copied Cursor `state.vscdb`
read-only and queries `ItemTable` with NO error handling. When the copied DB
image is malformed (the global state.vscdb is copied while Cursor is mid-write in
WAL mode, in the OneDrive sync tree), the uncaught exception kills the entire
mirror loop. This is why `CURSOR_CONTINUITY.md` has been frozen since ~March and
why this session is currently not being captured.

## Frozen Requirements

R1. `read_itemtable_value` must never crash the mirror. Catch `sqlite3.Error`
    (covers `DatabaseError`/`OperationalError`) and any DB-open failure, and
    return `None` on failure instead of raising. Ensure the connection is always
    closed.

R2. `export_decoded_views` must degrade gracefully. If a given DB is
    unreadable/malformed, it should still write the decoded JSON with whatever
    keys were readable (null for the failed ones) and must not abort
    `mirror_once`.

R3. `mirror_once` / `run` must survive a single bad cycle. A failure in
    `export_decoded_views` must not prevent `write_memory_bank_views` and the new
    cursor dated-snapshot writing from running, and must not kill the watch loop.
    Log a concise warning to stderr and continue.

R4. Preserve all existing behavior when the DBs are healthy. Do not change codex
    mirror. Do not change output paths/layout established in the prior directive.

## Acceptance Criteria

- Restarting the cursor mirror with a malformed global `state.vscdb` does NOT
  crash; the process stays alive.
- `memory-bank/CURSOR_CONTINUITY.md`, `memory-bank/transcripts/cursor-session-live.md`,
  and `memory-bank/transcripts/cursor/YYYY-MM-DD/` are produced/updated from
  whatever data is readable.
- A concise stderr warning is emitted when a DB read is skipped.

## Process

- Builder writes report to
  `agent-relay/roles/Builder/reports/2026-06-17-cursor-mirror-resilience-builder-report.md`,
  does not certify own work, does not run the long watcher (a single
  `mirror_once`/`--once` style invocation or py_compile is fine), does not commit
  or route. Validator verifies by restarting the mirror and confirming it stays
  alive and emits output.


---

## 5. Builder -> Validator: Cursor mirror resilience builder report

- Routing ID: `route-20260618-033810-builder-to-validator-cc4dc983`
- Type: `BUILDER REPORT`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:38:10Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-17-cursor-mirror-resilience-builder-report.md`
- Body: `agent-relay/messages/route-20260618-033810-builder-to-validator-cc4dc983.md`
- SHA-256: `9e8730077563abc77c22bfed34444808dfffc4309e1dd612120b0c275596cb2b`

# Builder Report — Cursor Mirror Resilience to Malformed/Locked Source DB

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Builder
- To: Validator
- Tier: 1 (defensive bug fix)
- Directive: `agent-relay/roles/Validator/directives/2026-06-17-cursor-mirror-resilience.md` (R1–R4)
- File changed: `tools/cursor_transcript_mirror.py` (only this file)

> I am NOT certifying this work. The Validator owns verification (live restart
> against a malformed `state.vscdb`).

## Summary of changes

All edits are confined to `tools/cursor_transcript_mirror.py`. `tools/codex_transcript_mirror.py`
was not touched. No output paths/layout were changed.

### R1 — `read_itemtable_value` (was ~line 267)

- Moved `sqlite3.connect(...)` inside the `try` block and initialized `conn = None`
  before it, so a failed connect cannot leave the `finally` referencing an
  undefined/half-open handle.
- Added `except Exception as exc:` around the connect + query. This covers
  `sqlite3.Error` (and its subclasses `DatabaseError`/`OperationalError`, e.g.
  "database disk image is malformed") as well as any other open/decode failure.
  On failure it now returns `None` instead of raising.
- Emits the required concise stderr warning on failure:
  `[cursor-mirror] skipping unreadable DB <path> key <key>: <err>`.
- `finally` now closes the connection only when `conn is not None`, and the
  `conn.close()` itself is guarded by try/except so a close failure cannot raise.

### R2 — `export_decoded_views` (was ~line 773)

- Wrapped the global-DB block (build `global_payload` + `write_json` of
  `global-chat-state.json`) in its own try/except.
- Wrapped the workspace-DB block (build `workspace_payload` + `write_json` of
  `workspace-chat-state.json`) in its own separate try/except.
- Result: a bad global DB cannot stop the workspace export and vice versa. Each
  block logs `[cursor-mirror] failed exporting global/workspace decoded view: <err>`
  on failure. Because R1 returns `None` per unreadable key, the JSON is still
  written with null values for the keys that failed (when `write_json` itself
  succeeds).

### R3 — `mirror_once` (was ~line 794) and the watch loop in `main`/`run` (was ~line 851)

- In `mirror_once`, wrapped the `export_decoded_views(...)` call in try/except so
  its failure logs `[cursor-mirror] export_decoded_views failed, continuing: <err>`
  and execution still falls through to `write_memory_bank_views(...)` (which
  includes the dated `transcripts/cursor/YYYY-MM-DD/` snapshot writing) and the
  metadata write.
- Hardened the `--watch` loop: each `run()` call is now wrapped in try/except
  that logs `[cursor-mirror] mirror cycle failed, continuing: <err>` and then
  proceeds to `time.sleep(args.interval)` and loops again. Previously the loop
  only caught `KeyboardInterrupt`, so any per-cycle exception killed the watcher.
  `KeyboardInterrupt` handling is unchanged.

### R4 — Behavior preservation

- On healthy DBs, control flow is identical to before: the new `try` blocks
  simply pass through and return the same values / write the same files.
- No changes to `codex_transcript_mirror.py`.
- No changes to output filenames, directories, or JSON structure.

## Verification (performed by Builder; not certification)

- `python -c "import py_compile; py_compile.compile('tools/cursor_transcript_mirror.py', doraise=True)"`
  → **PASS** (`py_compile OK`, exit 0).
- Linter (editor diagnostics) on the file → **no errors**.
- One-shot run: the script has no explicit `--once` flag, but invoking it
  WITHOUT `--watch` is a genuine one-shot mode (runs `mirror_once` once and
  exits). I did NOT start the long watcher and did NOT add a new flag.
  - Command: `python tools/cursor_transcript_mirror.py --output offline-cursor-transcripts`
  - Result: exited cleanly with **exit code 0** and printed
    `[cursor_transcript_mirror] mirrored to ... (workspace storage: ...)`.
  - The live source DB was healthy this run, so no `[cursor-mirror] skipping...`
    warning was emitted — this confirms R4 (healthy path unchanged) but does NOT
    exercise the malformed-DB path via the full flow.
- Direct malformed-DB unit check (re-verification, 2026-06-17 second Builder
  pass): wrote a deliberately corrupt file (`SQLite format 3\0` header + junk
  bytes) to a temp path and called `read_itemtable_value(p, "openai.chatgpt")`
  directly. Result: it emitted exactly
  `[cursor-mirror] skipping unreadable DB <temp>\malformed_state.vscdb key openai.chatgpt: file is not a database`
  to stderr and **returned `None`** without raising. This exercises the R1
  failure path end-to-end (catch → warn → return None → no crash) that the prior
  pass could only establish by inspection.

### Re-verification note (current Builder pass)

The R1–R4 changes were already present, uncommitted, in the working tree from the
prior Builder pass (this report's original body). The current pass made **no
additional code edits** — it re-read the directive, confirmed each requirement is
satisfied in `tools/cursor_transcript_mirror.py`, re-ran `py_compile` (PASS), ran
the no-`--watch` one-shot (exit 0, clean), and added the direct malformed-DB test
above. `git diff HEAD` for the file matches the change set described in R1–R4.

## Assumptions

- "Catch `sqlite3.Error` and any DB-open failure" is satisfied by a single
  `except Exception`, since `sqlite3.Error` is a subclass of `Exception`; this
  also catches non-sqlite failures (e.g. decode/URI/open errors) per R1's intent.
- The default no-`--watch` invocation is the intended "one-shot" mode; I treated
  it as such rather than adding a `--once` flag (directive said not to add one).
- The malformed-DB warning path was not triggered live (DB was healthy at run
  time); correctness of that path is established by code inspection only.

## Limitations / risk

- The R1 failure path is now confirmed by a direct malformed-DB unit check (see
  Verification), but the malformed condition was not reproduced through the full
  `mirror_once` flow against a live corrupt `state.vscdb`. The Validator's planned
  restart test against a malformed global `state.vscdb` remains the authoritative
  check for the acceptance criteria.
- `write_json` failures (e.g. disk/permission) inside the R2 blocks are now
  swallowed with a warning rather than raising; this is intended per R2/R3 but
  means a persistent write failure would degrade silently (logged to stderr only).
- No commit was made and no relay messages were routed, per directive.


---

## 6. Validator -> Editor: Document two-file agent memory archive in AGENTS.md

- Routing ID: `route-20260618-034327-validator-to-editor-e9759f66`
- Type: `EXECUTION DIRECTIVE`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:43:27Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-17-agents-md-archive-layout.md`
- Body: `agent-relay/messages/route-20260618-034327-validator-to-editor-e9759f66.md`
- SHA-256: `5f242db6b227202dbc67742dea2a9fe1b94c6d881b5b6d3d816869ab8e553dff`

# Validator Directive — Document the Two-File Agent Memory Archive in AGENTS.md

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Validator
- To: Editor
- Tier: 0 (documentation/clarity, no behavior change)
- Type: EXECUTION DIRECTIVE

## Goal (User/Mediator)

Amend `AGENTS.md` so any agent clearly understands the memory archive is split
across FILES (plural): two parallel, source-tagged, co-located per-agent
archives that every agent must read — not one merged file.

## Frozen Requirements

R1. Add a concise subsection to `AGENTS.md` (suggested heading
    "## Agent Memory Archive Layout"), placed near the existing "Agent Transcript
    Mirror Startup" / "Startup Read Order" content, that states plainly:
    - There are TWO parallel agent memory archives, tagged by source:
      - Codex: `memory-bank/CODEX_CONTINUITY.md`,
        `memory-bank/transcripts/codex-session-live.md`,
        `memory-bank/transcripts/codex/YYYY-MM-DD/...`
      - Cursor/Claude: `memory-bank/CURSOR_CONTINUITY.md`,
        `memory-bank/transcripts/cursor-session-live.md`,
        `memory-bank/transcripts/cursor/YYYY-MM-DD/...`
    - Each agent's mirror writes ONLY its own archive (one writer per file; they
      are intentionally NOT a single shared file, to avoid concurrent-writer
      corruption).
    - Every agent MUST read BOTH archives at startup so Codex sees Cursor/Claude
      work and vice versa.
    - The single merged timeline is `agent-relay/transcripts/all.md`, and it
      covers ROLE/governance handoffs (Validator/Builder/Editor) only — it is a
      separate system from the session-memory mirrors.

R2. Keep it short and non-duplicative. Reconcile with the existing Startup Read
    Order (steps that already say "read BOTH") so the document does not repeat
    itself; cross-reference instead of restating.

R3. Documentation only. Do NOT change any tooling, paths, or behavior. Do not
    touch the codex mirror or cursor mirror code.

## Acceptance Criteria

- `AGENTS.md` contains an explicit, plain-language statement that there are two
  per-agent archives, who writes each, that both must be read, and that
  `all.md` is a separate single governance timeline.
- No duplication bloat; existing read-order steps remain consistent.

## Process

- Editor edits `AGENTS.md` and writes a report to
  `agent-relay/roles/Editor/reports/2026-06-17-agents-md-archive-layout-editor-report.md`.
  Editor does not certify its own doc as accepted; Validator verifies and
  returns the decision to the User/Mediator.


---

## 7. Editor -> Validator: AGENTS.md archive layout editor report

- Routing ID: `route-20260618-034554-editor-to-validator-89d619fb`
- Type: `EDITOR REPORT`
- Phase: `agent-memory-mirror-unification`
- Timestamp: `2026-06-18T03:45:54Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-17-agents-md-archive-layout-editor-report.md`
- Body: `agent-relay/messages/route-20260618-034554-editor-to-validator-89d619fb.md`
- SHA-256: `37c9e572fbc98557ac55bf9407a79abbfe548a4f97faacafd564f38104a9f2d1`

# Editor Report — Document the Two-File Agent Memory Archive in AGENTS.md

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Editor
- To: Validator
- Tier: 0 (documentation/clarity, no behavior change)
- Type: EXECUTION REPORT
- Directive: `agent-relay/roles/Validator/directives/2026-06-17-agents-md-archive-layout.md` (R1–R3)

## What I Changed

Amended `AGENTS.md` only. Added one new subsection, `## Agent Memory Archive
Layout`, placed immediately after the existing "Agent Transcript Mirror Startup"
section and before "Planning Conventions" (i.e., adjacent to the Startup Read
Order / Mirror Startup content, as R1 requested).

The new subsection states plainly:

- Session memory is split across two parallel, source-tagged per-agent archives
  (not one merged file):
  - Codex: `memory-bank/CODEX_CONTINUITY.md`,
    `memory-bank/transcripts/codex-session-live.md`,
    `memory-bank/transcripts/codex/YYYY-MM-DD/...`
  - Cursor/Claude: `memory-bank/CURSOR_CONTINUITY.md`,
    `memory-bank/transcripts/cursor-session-live.md`,
    `memory-bank/transcripts/cursor/YYYY-MM-DD/...`
- Each agent's mirror writes ONLY its own archive (one writer per file),
  intentionally NOT a single shared file, to avoid concurrent-writer corruption.
- Every agent MUST read BOTH archives at startup so Codex sees Cursor/Claude work
  and vice versa.
- `agent-relay/transcripts/all.md` is a separate single merged timeline covering
  ROLE/governance handoffs (Validator/Builder/Editor) only.

## Non-Duplication Handling (R2)

To avoid restating existing content, the new subsection cross-references the
"read BOTH" steps already present in "Startup Read Order" rather than repeating
the read instructions. The file paths are listed once in the new layout section
because this is the canonical place that names the two-archive layout.

## Scope / Behavior (R3)

- Documentation only. No tooling, paths, code, or behavior changed.
- Only `AGENTS.md` was edited (plus this report file under the Editor reports
  folder, which is the required output artifact).
- No commit made; no relay messages routed.

## Non-Blocking Note

The pre-existing line in "Agent Transcript Mirror Startup" reads "Running both
keeps one shared, source-tagged archive...". The phrase "one shared ... archive"
can read as if there is a single file, whereas the layout is two co-located
per-agent files. I left that line unchanged (out of this directive's scope), but
the new "Agent Memory Archive Layout" subsection clarifies the two-file reality.
Validator may wish to reconcile that wording in a follow-up.

## R2 Reconciliation Follow-up (2026-06-17)

Per Validator follow-up, edited the single flagged sentence in "Agent Transcript
Mirror Startup" to remove the "one shared ... archive" wording; it now reads
"Running both keeps the two co-located, source-tagged per-agent archives current,
so each agent can read what it did AND what the other agent did." AGENTS.md only,
documentation-only, no behavior change.

## Status

Editor work complete. Not self-certified as accepted — Validator to verify and
return the decision to the User/Mediator.


---
