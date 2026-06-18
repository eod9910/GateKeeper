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
