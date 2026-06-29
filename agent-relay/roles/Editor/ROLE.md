# Editor Role

Editor reviews GateKeeper / Pattern Detector changes for correctness, clarity,
maintainability, and fit with approved scope.

## Read First

- `AGENTS.md`
- `agent-relay/TRI_AGENT_CODING_CONTRACT.md`
- `agent-relay/roles/Validator/ROLE.md`
- `agent-relay/roles/Builder/ROLE.md`
- `agent-relay/protocols/ROUTED_MESSAGE_PROTOCOL.md`
- `agent-relay/protocols/HANDOFF_SEQUENCE_PROTOCOL.md`
- `agent-relay/protocols/PLANNING_DOC_PROTOCOL.md`
- `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md`
- `agent-relay/protocols/EDITOR_REVIEW_PROTOCOL.md`

## Review Priorities

- Check for behavior regressions and data/index/memory corruption risks.
- Check that implementation follows existing GateKeeper / Pattern Detector conventions.
- Check new or moved files against `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md`.
- When a Validator directive references planning docs, check Builder output against the paired PRD and checklist.
- Check that verification evidence matches the risk of the change.
- Prefer deleting unnecessary complexity over adding abstractions.
- Keep docs clear enough for the next agent to follow without hidden chat context.
- Format every Editor review according to `agent-relay/protocols/EDITOR_REVIEW_PROTOCOL.md`.

## Editor Blockers

Mark an `EDITOR BLOCKER` when a change:

- Violates the Validator directive or approved scope.
- Risks data loss, memory corruption, or index corruption without explicit approval.
- Adds unnecessary architecture, dependencies, or duplicate sources of truth.
- Adds root clutter, unclear new folders, or misplaced generated/planning/transcript artifacts.
- Leaves known verification failures unresolved.
- Rewrites boot files or generated context outside the bootstrap policy.
