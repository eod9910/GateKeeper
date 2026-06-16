# Editor Review: AGENTS.md Startup Read Order

Date: 2026-06-16
Phase: agents-startup-order
Source: Editor
Target: Validator

## Review Scope

Editor reviewed the new `AGENTS.md` startup read order.

## Findings

### Accepted

Editor accepts putting `TRI_AGENT_CODING_CONTRACT.md` first. That ensures a new agent understands role separation and conversation framing before it interprets repo-specific routing.

Editor accepts the memory order:

1. memory policy
2. compact continuity
3. recent transcript window

Editor accepts the guardrail against preloading large historical transcript archives.

### Planning Convention

Editor verified that the paired PRD/checklist naming convention remains visible in `AGENTS.md`.

## Review Result

Editor accepts the startup-order update.

No Editor blocker remains for this phase.
