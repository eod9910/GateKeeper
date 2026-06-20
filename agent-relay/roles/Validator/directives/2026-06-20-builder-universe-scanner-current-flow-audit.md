# Builder Directive: Universe/Scanner Current-Flow Audit

## Objective

Start the first modular-domain migration slice by auditing the current
`universe/scanner` flow before moving code.

## Selected Package

`medium-large-modular-web`

## Affected Domain

`universe/scanner`

## Current Files To Inspect

- `backend/src/routes/universe.ts`
- `backend/src/services/universeRegistry.ts`
- `backend/src/server.ts`
- `frontend/public/scanner.js`
- `frontend/public/chart.js` only where it interacts with scanner/universe behavior
- `frontend/public/shared-chart-utils.js` only where it interacts with scanner/universe behavior
- related legacy Python universe services/scripts when needed for route behavior

## Scope

Audit first. Do not move product code until the current flow is understood and a
small candidate slice has GitNexus impact evidence.

Allowed outputs:

- a concise audit report under `agent-relay/roles/Builder/reports/`;
- optionally, one small behavior-preserving code slice if:
  - the owning boundary is clear;
  - GitNexus impact is LOW or MEDIUM;
  - no API response shape changes;
  - no frontend workflow changes;
  - verification can be run immediately.

## Out Of Scope

- Whole-repo folder reshuffle.
- Frontend framework migration.
- Backend route rewiring that changes public API paths.
- Universe data format changes.
- Trading, broker, backtest, or research behavior changes.

## Required Audit Questions

- Which backend endpoints control universe status/build/update/weekly checks?
- Which service functions/classes own the backend behavior?
- Which frontend functions call those endpoints?
- Which data files are read or written?
- What is the smallest candidate domain boundary?
- What STOP conditions or risks block a first code slice?

## Verification

- Run targeted syntax checks if code is touched.
- Run `python tools\agent_router.py verify`.
- Run `mcp__gitnexus.detect_changes(scope="all")` before reporting.
