# Universe Process Runner Characterization Checklist

PRD: universe-process-runner-characterization-prd.md

Percent complete: 0% (0 complete, 0 partial, 13 remaining)

## Phase 1: Governed Start

- [ ] Confirm this workstream is active and paired with its PRD.
- [ ] Route the characterization directive through Agent Relay.
- [ ] Confirm no process ownership extraction is authorized yet.

## Phase 2: Test Seam Design

- [ ] Identify the smallest fake process or fake runner seam.
- [ ] Confirm the seam does not change runtime behavior.
- [ ] Confirm the seam can model stdout, stderr, close, and kill.

## Phase 3: Characterization Tests

- [ ] Add focused process runner characterization tests.
- [ ] Cover stdout log append.
- [ ] Cover stderr `[err]` log append.
- [ ] Cover close success and failure.
- [ ] Cover cancellation and kill.
- [ ] Cover regime progress and summary behavior where feasible.

## Phase 4: Verification And Decision

- [ ] Run focused characterization tests.
- [ ] Run existing universe module tests.
- [ ] Run backend build.
- [ ] Run relay verification.
- [ ] Validator decides whether extraction is safe, blocked, or needs more evidence.
