# Validator Directive: Memory Bank Audit And Cleanup Plan

- Date: 2026-06-16
- Phase: memory-bank-audit
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

## Mediator Intent

The Agent Relay and dated Codex transcript system now carry the serious
auditable continuity trail. The older `memory-bank/` may contain useful context,
but it may also contain stale, duplicated, or misplaced governance material.

Do not delete or move memory files yet. First produce an inventory and cleanup
proposal.

## Required Work

Audit `memory-bank/` and classify files into these buckets:

1. Keep as active startup memory.
2. Keep as dated/searchable transcript history.
3. Archive as historical context.
4. Move governance rules into contracts or role files.
5. Move role conversation records into `agent-relay/`.
6. Ignore/delete generated or stale junk, only after Validator/User approval.

## Required Output

Create a Builder report under:

```text
agent-relay/roles/Builder/reports/
```

The report must include:

- inventory of top-level `memory-bank/` files and transcript folders;
- recommended classification for each file/folder;
- any files that look sensitive or unsafe to publish;
- any files that duplicate `agent-relay/`, `TRI_AGENT_CODING_CONTRACT.md`,
  `AGENT_OPERATING_CONTRACT.md`, or `memory-bank/CODEX_MEMORY_POLICY.md`;
- a proposed cleanup sequence that avoids data loss.

## Constraints

- Do not delete files.
- Do not move files.
- Do not rewrite historical transcripts.
- Do not change contracts yet.
- Treat ambiguous memory as archive/keep until Editor and Validator review it.

