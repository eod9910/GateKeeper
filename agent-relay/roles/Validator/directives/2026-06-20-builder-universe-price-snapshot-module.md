# Validator Directive: Universe Price Snapshot Module

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will extract universe price snapshot/cache behavior from the universe route into a domain-owned module with focused tests.

## Current Files Involved

- `backend/src/routes/universe.ts`
- `backend/package.json`

## Target Files

- `backend/src/modules/universe/universePriceSnapshot.ts`
- `backend/src/modules/universe/universePriceSnapshot.test.ts`
- `backend/package.json`

## Requirements

- Preserve `/api/universe/prices` response behavior.
- Preserve status freshness behavior for universe manifest and price snapshot cache.
- Keep filesystem paths supplied by the route.
- Do not change API paths, frontend files, data formats, Python services, or subprocess orchestration.
- Follow existing backend `assert`/`tsx` test style.

## Required Pre-Edit Evidence

Builder must run GitNexus impact/context checks for:

- `buildUniversePriceSnapshot`
- `readLastCloseFromCsv`
- `readPersistedPriceSnapshot`
- `persistPriceSnapshot`
- `buildUniverseFreshness`

## Verification Commands

```powershell
npm.cmd --prefix backend run universe-price-snapshot:test
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- GitNexus returns HIGH or CRITICAL risk;
- extraction changes response shape or cache semantics;
- focused tests require production data, network, Python services, or a running server.
