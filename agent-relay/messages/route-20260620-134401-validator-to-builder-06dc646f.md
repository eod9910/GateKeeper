# Validator Directive: Universe Job Progress Tests

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will add focused tests for the new `backend/src/modules/universe/universeJobProgress.ts` boundary before any further universe migration.

## Current Files Involved

- `backend/src/modules/universe/universeJobProgress.ts`
- `backend/package.json`
- Existing backend `*.test.ts` files for local test style examples.

## Target Files

- `backend/src/modules/universe/universeJobProgress.test.ts`
- `backend/package.json`

## Requirements

- Follow existing backend TypeScript test style using `assert` and `tsx`.
- Cover source labels, clamping, representative progress parsing, retry parsing, log trimming, and completion.
- Do not change API routes, frontend files, Python services, data paths, or runtime behavior.
- Do not add a new test framework.

## Verification Commands

```powershell
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- testing requires real universe data, network calls, Python services, or a running server;
- the production module requires behavior changes to test basic behavior;
- package script updates would conflict with existing backend test conventions.
