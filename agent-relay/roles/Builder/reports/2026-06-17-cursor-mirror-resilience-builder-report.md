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
