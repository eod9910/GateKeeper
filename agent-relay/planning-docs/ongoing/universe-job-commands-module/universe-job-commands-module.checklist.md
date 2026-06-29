# Universe Job Commands Module Checklist

PRD: universe-job-commands-module-prd.md

Percent complete: 100% (16 complete, 0 partial, 0 remaining)

## Phase 1: Governed Start

- [x] Confirm this workstream is active and paired with its PRD.
- [x] Route the implementation directive through Agent Relay.
- [x] Run GitNexus impact/context checks before production edits.

## Phase 2: Extraction

- [x] Add `backend/src/modules/universe/universeJobCommands.ts`.
- [x] Move command argument construction into the module.
- [x] Update `backend/src/routes/universe.ts` to use the module.
- [x] Preserve subprocess command, args, and cwd behavior.
- [x] Preserve route/API/frontend behavior.

## Phase 3: Tests And Verification

- [x] Add focused command construction tests.
- [x] Add focused backend package script.
- [x] Run focused command test.
- [x] Run existing universe module tests.
- [x] Run backend build.
- [x] Run relay verification.

## Phase 4: Review And Acceptance

- [x] Builder reports changed files, verification, assumptions, and residual risk.
- [x] Editor reviews structure and behavior-preservation evidence.
- [x] Validator independently verifies files, diff, and commands.
