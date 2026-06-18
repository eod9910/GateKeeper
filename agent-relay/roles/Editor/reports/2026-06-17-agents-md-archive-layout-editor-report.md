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
