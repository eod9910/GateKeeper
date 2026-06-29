# Universe Catalog Meta Module PRD

Checklist: universe-catalog-meta-module-checklist.md

## Status

Active. Third incremental universe migration slice.

## Selected Package

`medium-large-modular-web`

## Problem

`backend/src/routes/universe.ts` still owns pure optionable catalog metadata logic. This keeps route code responsible for parsing and classifying domain data, even though the route should primarily orchestrate HTTP and job state.

## Scope

In scope:

- Move pure optionable catalog helpers into `backend/src/modules/universe`.
- Add focused tests for catalog metadata behavior.
- Keep `backend/src/routes/universe.ts` as the API route owner.
- Preserve existing `/api/universe/status` response behavior.

Out of scope:

- Moving route handlers.
- Changing API paths or frontend calls.
- Changing data file paths.
- Changing Python services or subprocess orchestration.
- Changing price snapshot/cache behavior.

## Requirements

- Extract `normalizeUniverseSymbols` and `getOptionableCatalogMeta` behavior into a domain-owned module.
- Test dedupe/sort/uppercase normalization.
- Test optionable metadata counts for complete and incomplete catalogs.
- Follow existing backend `assert` and `tsx` test style.
- Do not introduce a test framework.

## Verification Gates

```powershell
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- impact analysis returns HIGH or CRITICAL;
- extraction requires route response shape changes;
- tests require data files, services, network, or a running server.

## Done Criteria

- Catalog metadata helpers live under `backend/src/modules/universe`.
- Route imports those helpers without changing endpoints.
- Focused tests pass.
- Backend build passes.
- Builder, Editor, and Validator artifacts record evidence.
