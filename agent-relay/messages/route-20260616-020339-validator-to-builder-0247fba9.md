# Validator Directive: Add Dated Codex Transcript Snapshots

- Date: 2026-06-16
- Phase: codex-continuity-memory
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

## Mediator Need

The rolling file `memory-bank/transcripts/codex-session-live.md` is useful for
current continuity, but it is hard to search historically because it does not
distinguish today's conversation from two weeks ago.

## Required Work

Keep the rolling live file, and add dated searchable snapshots for Codex
continuity transcripts.

Recommended convention:

- rolling latest file: `memory-bank/transcripts/codex-session-live.md`
- dated snapshots: `memory-bank/transcripts/codex/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md`
- daily latest pointer: `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md`

Update policy docs so future agents understand the distinction.

