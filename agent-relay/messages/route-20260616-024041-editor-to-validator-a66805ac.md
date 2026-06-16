# Editor Review: AGENTS.md Router Cleanup

Date: 2026-06-16
Phase: agents-md-router-cleanup
Source: Editor
Target: Validator

## Review Scope

Editor reviewed Builder's `AGENTS.md` cleanup for governance placement, startup readability, and preservation of the planning naming convention.

## Findings

### Accepted

Editor accepts keeping the PRD/checklist naming convention in `AGENTS.md`.

That rule is startup-critical because it prevents active workstreams from scattering and ensures paired files sort together:

- `.planning/plans/ACTIVE/<slug>-prd.md`
- `.planning/plans/ACTIVE/<slug>-checklist.md`

Editor accepts moving detailed workspace, backtest/research, and memory-retention rules behind pointers to their owning contracts.

### Guardrail

Editor recommends that future edits preserve this split:

- `AGENTS.md`: startup routing and critical naming conventions
- `PLAN_CONVENTIONS.md`: detailed planning file rules
- `AGENT_OPERATING_CONTRACT.md`: backtest/research engine routing and artifact storage
- `TRI_AGENT_CODING_CONTRACT.md`: role separation and relay expectations
- `memory-bank/*POLICY.md`: memory retention, archive, and transcript handling
- `workspace/WORKSPACE_ARCHITECTURE.md`: workspace shape and runtime binding

## Review Result

Editor accepts the cleanup.

No Editor blocker remains for this phase.
