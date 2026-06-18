# Validator Directive — Transcript Retention and Archival

- Date: 2026-06-17
- Phase: transcript-retention-archival
- From: Validator
- To: Builder
- Tier: 2 (PRD + checklist; full relay)

## Frozen requirements

Implement the workstream defined in:

- `.planning/plans/ACTIVE/transcript-retention-archival-prd.md`
- `.planning/plans/ACTIVE/transcript-retention-archival-checklist.md`

Build to the checklist, in order, honoring these confirmed decisions:

1. Tracked `archive/` subfolders (not the offline local-only mirrors).
2. Monthly granularity (`YYYY-MM`); no weekly sharding.
3. Manual on-demand script `tools/archive_transcripts.py`, defaulting to dry-run,
   gated by the Destructive Cleanup process; not run at startup.
4. 30-day hot window.

## Hard constraints

- `routes.jsonl` is the immutable source of truth. Archives are DERIVED views;
  never trim, rewrite, or reorder the log.
- Do NOT change the size-capped `*-session-live.md` transcripts.
- Archival is a MOVE, never a delete; the script must be idempotent and safe to
  re-run on Windows/OneDrive paths.
- Hot `all.md` + monthly archive files must reconstruct exactly to the full route
  set (no loss, no duplication).

## Report back

Builder report must list every file created/modified, show the dry-run
affected-path output, and state any assumptions or limitations. Do NOT mark the
work accepted — Validator verifies, then Editor reviews.
