# Universe Process Runner Characterization PRD

Checklist: universe-process-runner-characterization-checklist.md

## Status

Active. Pre-extraction characterization plan for the risky process-runner boundary.

## Selected Package

`medium-large-modular-web`

## Problem

The universe route still owns live subprocess lifecycle behavior: spawning Python, wiring stdout/stderr listeners, handling close events, maintaining `activeProcess`, handling cancellation, and timing HTTP responses.

Earlier migration slices safely extracted pure helpers, command construction, cache behavior, and lifecycle state mutation. Moving live process ownership is riskier because a mistake can break universe build/update/regime jobs while still passing compile-time checks.

## Goal

Create characterization coverage before any process-runner extraction. The tests should prove current behavior around process event wiring and job mutation using a fake process/runner, without spawning Python.

## Scope

In scope:

- Design a fake process or fake runner seam for universe job lifecycle tests.
- Characterize stdout handling.
- Characterize stderr handling.
- Characterize close-code success and failure behavior.
- Characterize cancellation behavior.
- Characterize regime classification final summary behavior if feasible without real Python.

Out of scope:

- Moving process ownership before tests exist.
- Changing subprocess commands.
- Changing route paths, frontend calls, Python scripts, or data formats.
- Running real universe builds as part of automated tests.

## Required Behavior To Prove

- stdout lines append to active job log.
- stderr lines append as `[err] ...`.
- close code `0` completes the job with the correct success label.
- nonzero or null close code fails the job with the current error text.
- cancellation calls `kill()` on the active process and marks the job canceled.
- regime progress lines update progress before log append.
- regime classification close success can still read final summary metrics when the snapshot file exists.

## Verification Gates

The initial characterization slice must pass:

```powershell
npm.cmd --prefix backend run universe-process-runner:test
npm.cmd --prefix backend run universe-job-lifecycle:test
npm.cmd --prefix backend run universe-job-commands:test
npm.cmd --prefix backend run universe-price-snapshot:test
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and return to Validator/User if:

- test seam requires changing runtime behavior;
- test seam makes route ownership unclear;
- fake process behavior cannot represent Node `ChildProcess` closely enough;
- any existing universe module test or backend build fails.

## Done Criteria

- Characterization tests exist and pass.
- No live process ownership has moved yet.
- Validator has enough evidence to authorize or reject a later extraction.
