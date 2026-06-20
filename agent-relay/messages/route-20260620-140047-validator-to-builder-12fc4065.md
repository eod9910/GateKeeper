# Validator Directive: Universe Job Commands Module

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will extract Python subprocess command construction from the universe route into a tested domain module.

## Current Files Involved

- `backend/src/routes/universe.ts`
- `backend/package.json`

## Target Files

- `backend/src/modules/universe/universeJobCommands.ts`
- `backend/src/modules/universe/universeJobCommands.test.ts`
- `backend/package.json`

## Requirements

- Preserve command, args, and cwd behavior.
- Keep process spawning/listeners/close handlers in the route.
- Do not change API paths, frontend files, data formats, Python scripts, or subprocess lifecycle behavior.
- Follow existing backend `assert`/`tsx` test style.

## Required Pre-Edit Evidence

Builder must run GitNexus impact/context checks for the universe route before editing.

## Verification Commands

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
