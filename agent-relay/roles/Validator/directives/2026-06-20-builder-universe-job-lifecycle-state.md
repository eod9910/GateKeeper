# Validator Directive: Universe Job Lifecycle State Helpers

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will extract pure `UniverseJob` lifecycle state mutations from the universe route into a tested domain module.

## Current Files Involved

- `backend/src/routes/universe.ts`
- `backend/src/modules/universe/universeJobProgress.ts`
- `backend/package.json`

## Target Files

- `backend/src/modules/universe/universeJobLifecycle.ts`
- `backend/src/modules/universe/universeJobLifecycle.test.ts`
- `backend/package.json`

## Requirements

- Preserve job success/failure/cancel state behavior.
- Preserve regime progress line parsing behavior.
- Keep `spawn`, stdout/stderr listeners, close handlers, active process assignment, and HTTP responses in the route.
- Do not change API paths, frontend files, Python scripts, data formats, or process ownership.

## Verification Commands

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
- tests require subprocess spawning;
- existing universe tests or backend build fail.
