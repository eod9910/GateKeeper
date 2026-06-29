# Universe Job Lifecycle State PRD

Checklist: universe-job-lifecycle-state-checklist.md

## Status

Active. Sixth incremental universe migration slice.

## Selected Package

`medium-large-modular-web`

## Problem

The universe route still repeats job completion/failure/cancel state mutation inline. Live process ownership is riskier and should stay in the route for now, but the pure state transitions can be moved into a tested domain module.

## Scope

In scope:

- Extract pure `UniverseJob` lifecycle state mutations into `backend/src/modules/universe`.
- Preserve `spawn`, stdout/stderr listeners, close handlers, cancellation trigger, and response timing in the route.
- Add focused tests for success, failure, cancellation, and regime progress line parsing.

Out of scope:

- Moving process runner/lifecycle ownership.
- Changing subprocess listeners.
- Changing API paths, frontend calls, Python scripts, or data formats.

## Requirements

- Preserve current job status/progress/progress_label/stage/error behavior.
- Helpers must not import Express or spawn processes.
- Tests must not spawn subprocesses.

## Verification Gates

```powershell
npm.cmd --prefix backend run universe-job-lifecycle:test
npm.cmd --prefix backend run universe-job-commands:test
npm.cmd --prefix backend run universe-price-snapshot:test
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- preserving lifecycle behavior becomes unclear;
- tests require spawning subprocesses;
- build or existing universe module tests fail.

## Done Criteria

- Pure lifecycle state helpers live under `backend/src/modules/universe`.
- Route uses those helpers while retaining process ownership.
- Focused lifecycle tests pass.
- Backend build passes.
