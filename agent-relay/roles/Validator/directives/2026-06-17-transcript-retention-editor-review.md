# Validator Directive — Editor Review: Transcript Retention and Archival

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Validator
- To: Editor
- Tier: 2

## Validator verification (passed)

Independently verified against files/diff/command output (not the Builder report):

- `split_hot_archive` cutoff = newest-route-timestamp − 30d; hot = newer-or-equal
  or unparseable; older bucketed by `%Y-%m`. Hot ∪ archive == input (no loss/dup).
- `routes.jsonl` append-only (numstat 3/0); not mutated.
- Phase transcripts changed only their `Generated:` line (behavior preserved).
- `all.md` renders "last 30 days" with archive pointer; `verify` ok (64 routes).
- Dry-run isolates the single 99-day folder and moves nothing.

## Editor task (structure-only, no behavior change)

Anti-spaghetti review of:

- `tools/agent_router.py` (new: `parse_route_timestamp`, `split_hot_archive`,
  `regenerate_relay_timeline`, `HOT_WINDOW_DAYS`, `ARCHIVE_DIR`, `header_note`).
- `tools/archive_transcripts.py` (new file).
- `memory-bank/MEMORY_ARCHIVE_POLICY.md`, `memory-bank/CODEX_MEMORY_POLICY.md`.

Check naming, duplication, dead code, oversized functions, clarity of the
dry-run/--apply path, and doc/code agreement. Preserve validated behavior. If you
find a behavior/data-flow problem, raise an EDITOR BLOCKER for the Builder rather
than fixing it yourself. Report findings; do not certify your own changes.
