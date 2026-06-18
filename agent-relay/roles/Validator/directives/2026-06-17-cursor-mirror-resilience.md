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
