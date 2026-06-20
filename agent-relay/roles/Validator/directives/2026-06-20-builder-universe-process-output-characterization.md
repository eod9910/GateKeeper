# Validator Directive: Universe Process Output Characterization

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will characterize and centralize universe subprocess output chunk handling without moving process ownership.

## Current Files Involved

- `backend/src/routes/universe.ts`
- `backend/src/modules/universe/universeJobProgress.ts`
- `backend/src/modules/universe/universeJobLifecycle.ts`
- `backend/package.json`

## Target Files

- `backend/src/modules/universe/universeProcessOutput.ts`
- `backend/src/modules/universe/universeProcessOutput.test.ts`
- `backend/src/routes/universe.ts`
- `backend/package.json`

## Requirements

- Preserve stdout chunk behavior: split by newline, ignore empty string chunks, append lines to job log.
- Preserve stderr chunk behavior: append lines as `[err] ${line}`.
- Preserve regime stdout behavior: apply regime progress parsing before appending the log line.
- Do not move `spawn`, `kill`, active process assignment, close handlers, or HTTP response timing.
- Do not change API paths, frontend files, Python scripts, or data formats.

## Verification Commands

```powershell
npm.cmd --prefix backend run universe-process-output:test
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

- preserving chunk/log behavior becomes unclear;
- the change requires moving process ownership;
- tests require spawning subprocesses;
- existing universe tests or backend build fail.
