# Universe Job Lifecycle State Checklist

PRD: universe-job-lifecycle-state-prd.md

Percent complete: 100% (17 complete, 0 partial, 0 remaining)

## Phase 1: Governed Start

- [x] Confirm this workstream is active and paired with its PRD.
- [x] Route the implementation directive through Agent Relay.
- [x] Confirm this is pure state mutation, not process ownership extraction.

## Phase 2: Extraction

- [x] Add `backend/src/modules/universe/universeJobLifecycle.ts`.
- [x] Move completion/failure/cancel state mutation into the module.
- [x] Move regime progress line parsing into the module.
- [x] Update `backend/src/routes/universe.ts` to use the module.
- [x] Preserve subprocess lifecycle ownership in the route.
- [x] Preserve route/API/frontend behavior.

## Phase 3: Tests And Verification

- [x] Add focused lifecycle tests.
- [x] Add focused backend package script.
- [x] Run focused lifecycle test.
- [x] Run existing universe module tests.
- [x] Run backend build.
- [x] Run relay verification.

## Phase 4: Review And Acceptance

- [x] Builder reports changed files, verification, assumptions, and residual risk.
- [x] Editor reviews structure and behavior-preservation evidence.
- [x] Validator independently verifies files, diff, and commands.
