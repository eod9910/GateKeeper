# Universe Job Commands Module PRD

Checklist: universe-job-commands-module-checklist.md

## Status

Active. Fifth incremental universe migration slice.

## Selected Package

`medium-large-modular-web`

## Problem

`backend/src/routes/universe.ts` still constructs Python subprocess command arguments inline for build, optionable rebuild, update, and regime classification jobs. That command construction is domain behavior, while the route should focus on HTTP and process lifecycle orchestration.

## Scope

In scope:

- Extract subprocess command construction into `backend/src/modules/universe`.
- Keep process spawning, stdout/stderr listeners, close handlers, and active job state in the route.
- Add focused tests for constructed commands and arguments.

Out of scope:

- Moving live process lifecycle handling.
- Changing Python scripts or arguments.
- Changing route paths, frontend calls, or data formats.

## Requirements

- Preserve command, args, and cwd behavior.
- Do not introduce process lifecycle abstractions in this slice.
- Tests must not spawn Python or require production data.

## Verification Gates

```powershell
npm.cmd --prefix backend run universe-job-commands:test
npm.cmd --prefix backend run universe-price-snapshot:test
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- GitNexus returns HIGH or CRITICAL risk;
- preserving command/cwd behavior becomes unclear;
- tests require spawning subprocesses.

## Done Criteria

- Command construction lives under `backend/src/modules/universe`.
- Route uses the command module while retaining lifecycle ownership.
- Focused command tests pass.
- Backend build passes.
