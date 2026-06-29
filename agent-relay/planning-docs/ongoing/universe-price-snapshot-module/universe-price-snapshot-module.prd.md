# Universe Price Snapshot Module PRD

Checklist: universe-price-snapshot-module-checklist.md

## Status

Active. Fourth incremental universe migration slice.

## Selected Package

`medium-large-modular-web`

## Problem

`backend/src/routes/universe.ts` still owns universe price snapshot/cache behavior, including CSV tail parsing, cache envelope reads/writes, and in-memory snapshot caching. This is domain behavior and makes the route harder to reason about.

## Scope

In scope:

- Extract universe price snapshot/cache helpers into `backend/src/modules/universe`.
- Preserve existing route paths and response shape.
- Keep filesystem paths supplied by the existing route to preserve runtime path behavior.
- Add focused tests for manifest values, CSV tail fallback, cache reuse, and freshness helper behavior.

Out of scope:

- Changing `/api/universe/prices` response shape.
- Moving route handlers.
- Changing frontend calls.
- Changing universe data formats.
- Changing Python services or subprocess orchestration.

## Requirements

- GitNexus impact/context checks must be LOW or MEDIUM before editing.
- The route must remain the HTTP owner.
- The new module must not depend on Express.
- Tests must not require network, Python services, production data files, or a running server.

## Verification Gates

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
- tests require production data or external services.

## Done Criteria

- Price snapshot/cache logic lives under `backend/src/modules/universe`.
- Route imports and uses the domain module.
- Focused tests pass.
- Backend build passes.
- Builder, Editor, and Validator artifacts record evidence.
