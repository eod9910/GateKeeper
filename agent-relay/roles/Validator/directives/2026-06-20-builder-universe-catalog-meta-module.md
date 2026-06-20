# Validator Directive: Universe Catalog Meta Module

Selected package: `medium-large-modular-web`

Affected domain: `universe`

## Objective

Builder will extract pure optionable catalog metadata helpers from the universe route into a domain-owned module with focused tests.

## Current Files Involved

- `backend/src/routes/universe.ts`
- `backend/package.json`

## Target Files

- `backend/src/modules/universe/universeCatalogMeta.ts`
- `backend/src/modules/universe/universeCatalogMeta.test.ts`
- `backend/package.json`

## Requirements

- Preserve existing `/api/universe/status` behavior.
- Do not change API paths, frontend files, data paths, Python services, or subprocess orchestration.
- Follow existing backend `assert`/`tsx` test style.
- Add a focused package script for the new test.

## Required Pre-Edit Evidence

Builder must run GitNexus impact/context checks for:

- `getOptionableCatalogMeta`
- `normalizeUniverseSymbols` in `backend/src/routes/universe.ts`

## Verification Commands

```powershell
npm.cmd --prefix backend run universe-catalog-meta:test
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- GitNexus returns HIGH or CRITICAL risk;
- extraction requires route response shape changes;
- focused tests require data files, services, network, or a running server.
