# Validator Plan: Memory Bank Audit

- Date: 2026-06-16
- Phase: memory-bank-audit
- Mediator request: Create a plan and relay it to Builder and Editor.

## Validator Assessment

`memory-bank/` is not obsolete, but its role has changed.

The new target architecture is:

- `agent-relay/`: official role communication, directives, reports, blockers,
  and meta-conversation transcripts.
- `memory-bank/`: broader conversation continuity, dated Codex transcripts, and
  compact startup memory.
- contracts: durable rules and policies.
- offline mirrors: raw local-only transcript archives.

## Plan

1. Builder inventories `memory-bank/` without changing files.
2. Builder classifies each file/folder as active, historical, archive, move,
   duplicate, sensitive, or stale.
3. Editor reviews the inventory and flags blockers.
4. Validator decides the cleanup sequence.
5. Builder performs approved moves/archives only after Validator authorization.
6. Editor reviews the cleanup before commit.

## Current Directives

- Builder directive:
  `agent-relay/roles/Validator/directives/2026-06-16-memory-bank-audit-builder-directive.md`
- Editor directive:
  `agent-relay/roles/Validator/directives/2026-06-16-memory-bank-audit-editor-directive.md`

