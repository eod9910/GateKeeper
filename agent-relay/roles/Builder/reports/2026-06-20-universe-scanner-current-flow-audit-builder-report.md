# Builder Report: Universe/Scanner Current-Flow Audit And First Slice

Directive: `agent-relay/roles/Validator/directives/2026-06-20-builder-universe-scanner-current-flow-audit.md`

## Summary

Builder completed the current-flow audit and implemented the smallest safe first migration slice for the `universe/scanner` workstream.

The slice creates a domain-owned helper boundary at:

- `backend/src/modules/universe/universeJobProgress.ts`

The existing API route remains mounted and behavior-preserving at:

- `backend/src/routes/universe.ts`

## Current-Flow Audit

Backend route surface remains in `backend/src/routes/universe.ts`:

- `GET /api/universe/status`
- `GET /api/universe/prices`
- `POST /api/universe/build`
- `POST /api/universe/rebuild-optionable`
- `POST /api/universe/update`
- `POST /api/universe/classify-regimes`
- `GET /api/universe/regime-snapshot`
- `DELETE /api/universe/cancel`

Backend registry flow remains in `backend/src/services/universeRegistry.ts` and is consumed by scanner/candidate/validator code through `loadUniverseSymbols` and `loadUniverseSymbolsSync`.

Legacy universe scripts/services remain called by the route through the existing Python process flow:

- `backend/services/build_universe.py`
- `backend/services/update_universe.py`
- `backend/scripts/build_regime_universes.py`

Frontend universe controls and polling remain in `frontend/public/scanner.js`, calling the same `/api/universe/*` endpoints. The current slice does not modify frontend files.

`backend/tsconfig.json` has `rootDir: "./src"` and `include: ["src/**/*"]`, so Builder used `backend/src/modules/universe` as the first internal domain boundary rather than creating top-level `apps/server` files in this slice.

## GitNexus Impact Evidence

Builder ran pre-edit impact analysis for the extracted helper cluster:

- `appendUniverseJobLog`: LOW risk, direct dependents confined to `backend/src/routes/universe.ts`.
- `updateUniverseJobFromLine`: LOW risk, direct dependent `appendUniverseJobLog`.
- `computeUniverseProgress`: LOW risk, direct dependent `updateUniverseJobFromLine`.
- `clampUniverseProgress`: LOW risk, direct dependents confined to route/helper cluster.
- `getUniverseSourceLabel`: LOW risk, direct dependents confined to `backend/src/routes/universe.ts`.

No HIGH or CRITICAL risk warnings were returned.

## Changed Files

- `backend/src/modules/universe/universeJobProgress.ts`
  - New domain-owned module for `UniverseJob`, source labeling, progress clamping, progress computation, line parsing, and log appending.
- `backend/src/routes/universe.ts`
  - Imports the extracted helpers from the domain module.
  - Keeps route handlers, API paths, process spawning, response shapes, data paths, and cache behavior in place.
- `.planning/plans/ACTIVE/modular-domain-migration-checklist.md`
  - Updated checklist evidence for the completed audit and first slice.

Relay and memory mirror files also changed as expected from routing and transcript mirrors.

## Verification

- `python tools\agent_router.py verify` passed with `ok: true`, `checked: 108`.
- `npm.cmd --prefix backend run build` passed.
- `mcp__gitnexus.detect_changes(scope="all")` reported LOW risk and no affected execution flows.

PowerShell blocked `npm --prefix backend run build` through `npm.ps1` because local script execution is disabled. Builder reran the same build through `npm.cmd`, which passed.

## Behavior Preservation

No API route paths changed.
No frontend calls changed.
No data file paths changed.
No Python script invocation changed.
No trading, broker, backtest, or research behavior was touched.

## Remaining Old-Shape Follow-Up

`backend/src/routes/universe.ts` is still a large route file and still owns route orchestration, cache helpers, price snapshot building, subprocess spawning, and response assembly. Recommended next slices, after Editor/Validator acceptance:

- Extract universe route data/cache helpers into `backend/src/modules/universe/universeDataAccess.ts`.
- Extract Python process orchestration into `backend/src/modules/universe/universeJobs.ts`.
- Add focused unit tests for `universeJobProgress.ts` before expanding the boundary.

## Residual Risk

Residual risk is low. The primary risk is that progress parsing behavior was moved without dedicated unit tests. Backend compile passed, but runtime progress-display parity should be manually checked during a future universe build/update run.
