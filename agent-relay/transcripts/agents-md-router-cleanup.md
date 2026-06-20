# Agent Relay Transcript: agents-md-router-cleanup

Generated: 2026-06-20T13:00:33Z

## 1. Builder -> Validator: AGENTS.md router cleanup builder report

- Routing ID: `route-20260616-024041-builder-to-validator-ce44828e`
- Type: `report`
- Phase: `agents-md-router-cleanup`
- Timestamp: `2026-06-16T02:40:41Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-16-agents-md-router-cleanup-builder-report.md`
- Body: `agent-relay/messages/route-20260616-024041-builder-to-validator-ce44828e.md`
- SHA-256: `d8275f927f89317e7acbc8233d68317c0054689b2fca2cfda929ae4558bce331`

### Builder Report: AGENTS.md Router Cleanup

Date: 2026-06-16
Phase: agents-md-router-cleanup
Source: Builder
Target: Validator

#### Scope

Builder cleaned the hand-authored startup sections of `AGENTS.md` so the file acts as a router instead of duplicating detailed contracts.

Builder preserved the planning PRD/checklist naming convention in `AGENTS.md` because the User/Mediator explicitly identified it as startup-critical.

#### Changes

Builder kept the `Planning Conventions` section visible and added an explicit note that the paired planning naming rule must stay in `AGENTS.md`.

Builder reduced `Workspace AI / Agent Creation` to pointers:

- `workspace/WORKSPACE_ARCHITECTURE.md`
- `_skills/build-agent/SKILL.md`
- `_skills/build-agent/BUILD_AGENT_WORKFLOW.md`

Detailed workspace shape, runtime binding, skill activation, and naming rules remain in `workspace/WORKSPACE_ARCHITECTURE.md`.

Builder reduced `Agent Operating Contract` to pointers:

- `AGENT_OPERATING_CONTRACT.md`
- `TRI_AGENT_CODING_CONTRACT.md`
- `ROUTER_ONLY_PROTOCOL.md`
- `tools/agent_router.py`

Detailed backtest routing, approved engines, artifact storage, exploratory research storage, and scratch rules remain in `AGENT_OPERATING_CONTRACT.md`.

Builder reduced `Codex Continuity Memory` to pointers:

- `memory-bank/CODEX_MEMORY_POLICY.md`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/MEMORY_ARCHIVE_POLICY.md`

Detailed transcript retention and sensitive-memory handling remain in memory policy files.

#### Not Changed

Builder did not change the generated GitNexus block in this cleanup.

Builder did not move planning naming conventions out of `AGENTS.md`.

#### Builder Result

Builder reports `AGENTS.md` is now closer to a startup routing document while preserving the PRD/checklist naming convention exactly where future agents will see it.


---
