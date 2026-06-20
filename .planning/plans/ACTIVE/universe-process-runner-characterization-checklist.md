# Universe Process Runner Characterization Checklist

PRD: universe-process-runner-characterization-prd.md

Percent complete: 63% (10 complete, 1 partial, 5 remaining)

## Phase 1: Governed Start

- [x] Confirm this workstream is active and paired with its PRD.
- [x] Route the characterization directive through Agent Relay.
- [x] Confirm no process ownership extraction is authorized yet.

## Phase 2: Test Seam Design

- [x] Identify the smallest fake process or fake runner seam.
- [x] Confirm the seam does not change runtime behavior.
- [ ] Confirm the seam can model stdout, stderr, close, and kill.

## Phase 3: Characterization Tests

- [x] Add focused process runner characterization tests.
- [x] Cover stdout log append.
- [x] Cover stderr `[err]` log append.
- [x] Cover close success and failure.
- [ ] Cover cancellation and kill.
- [~] Cover regime progress and summary behavior where feasible.

## Phase 4: Verification And Decision

- [x] Run focused characterization tests.
- [x] Run existing universe module tests.
- [x] Run backend build.
- [x] Run relay verification.
- [x] Validator decides whether extraction is safe, blocked, or needs more evidence.
