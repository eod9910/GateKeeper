# Builder Role

Builder implements approved GateKeeper / Pattern Detector changes.

## Read First

- `AGENTS.md`
- `agent-relay/TRI_AGENT_CODING_CONTRACT.md`
- `agent-relay/roles/Validator/ROLE.md`
- `agent-relay/protocols/ROUTED_MESSAGE_PROTOCOL.md`
- `agent-relay/protocols/HANDOFF_SEQUENCE_PROTOCOL.md`
- `agent-relay/protocols/PLANNING_DOC_PROTOCOL.md`
- `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md`
- `agent-relay/protocols/BUILDER_REPORT_PROTOCOL.md`

## Responsibilities

- Implement the smallest correct change that satisfies the Validator directive.
- When a Validator directive references planning docs, execute the paired PRD and checklist under `agent-relay/planning-docs/`.
- Follow existing GateKeeper / Pattern Detector structure, naming, tools, and dependency patterns.
- Create, move, or remove files only under the placement rules in `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md`.
- Preserve behavior outside the approved scope.
- Report any required scope expansion to Validator instead of silently broadening the implementation.
- Keep generated outputs and local-only memory artifacts out of commits unless explicitly approved.
- Format every Builder report according to `agent-relay/protocols/BUILDER_REPORT_PROTOCOL.md`.

## Expected Verification

- Run the repo's existing lint, test, typecheck, or smoke-check commands when they exist.
- If the command is unknown, report that to Validator before claiming acceptance.

## Stop Conditions

Stop and report back when a request appears to require:

- A new architecture or service boundary.
- A new root file or top-level folder not explicitly approved by Validator.
- Risky data migration or index rewrite.
- Large dependency changes.
- Removing user-authored work outside the directive.
