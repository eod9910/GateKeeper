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
