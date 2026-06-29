# Modular Domain Migration PRD

Checklist: modular-domain-migration-checklist.md

## Status

Active. Initial architecture migration workstream.

## Selected Package

`medium-large-modular-web`

Pattern Detector is governed by `PATTERN_DETECTOR_CODING_PARADIGM.md`. This
workstream starts the incremental migration from the current legacy layout toward
domain-owned modules without a whole-repo reshuffle.

## Problem

Pattern Detector has grown beyond its original folder shape. Product behavior is
spread across broad technical folders and static frontend scripts. This makes it
hard for Validator to state safe scope, for Builder to know where new code
belongs, and for Editor to stop architecture drift early.

The migration should not pause feature work or move the whole repository at
once. It should create a repeatable vertical-slice pattern and apply it when
work touches a domain.

## Current-State Evidence

Observed current structure:

- Backend TypeScript entrypoint: `backend/src/server.ts`
- Backend route bucket: `backend/src/routes/`
- Backend service bucket: `backend/src/services/`
- Legacy Python service bucket: `backend/services/`
- Frontend static scripts: `frontend/public/`
- Existing coding paradigm contract: `PATTERN_DETECTOR_CODING_PARADIGM.md`

Scanner/universe evidence from current files:

- `backend/src/routes/universe.ts`
- `backend/src/services/universeRegistry.ts`
- `backend/services/universe_registry.py`
- `backend/services/build_universe.py`
- `backend/services/update_universe.py`
- `backend/scripts/build_clean_universe.py`
- `backend/scripts/update_universe.py`
- `backend/scripts/rebuild_stock_universes.py`
- `frontend/public/scanner.js`
- `frontend/public/chart.js`
- `frontend/public/shared-chart-utils.js`
- `backend/data/universe_tickers.json`
- `backend/data/universe_clean.json`
- `backend/data/universe/`

Recent Editor work already found duplicate universe-management frontend
functions in `frontend/public/scanner.js`, and Builder removed the duplicate
definitions. That makes `universe/scanner` the right first migration candidate.

## Target Architecture

The eventual target follows the repo coding paradigm:

```text
apps/
  server/
    src/
      modules/
        universe/
        scanner/
      shared/
  web/
    src/
      pages/
        scanner/
      api-client/
      state/
packages/
  contracts/
```

This PRD does not require that exact tree to exist immediately. The first slice
should prove the domain-boundary pattern while preserving current behavior.

## First Slice

The first migration slice is `universe/scanner`.

Validator should not authorize broad movement until Builder completes a
current-flow audit. The first implementation directive should be limited to one
behavior-preserving vertical slice, such as creating a domain-owned universe API
adapter/module around the current route/service files, or moving a narrow
frontend universe API/status concern behind a domain-owned boundary.

## Scope

In scope:

- Document current universe/scanner route, service, frontend, data, and script
  flow.
- Identify the smallest behavior-preserving first slice.
- Create domain boundary scaffolding only when it has an immediate consumer.
- Preserve existing routes and UI behavior.
- Add or update tests/checks appropriate to the touched files.
- Record remaining old-shape code as follow-up.

Out of scope:

- Whole-repo folder reshuffle.
- Moving all `backend/src/routes` or `backend/src/services`.
- Migrating all frontend static scripts to a new app framework.
- Rewriting scanner UI.
- Changing universe data formats.
- Changing trading/backtest/research behavior.
- Introducing microservices.
- Introducing a frontend build system without a separate directive.

## Validator Requirements

Each implementation directive under this PRD must state:

- selected package: `medium-large-modular-web`;
- affected domain: `universe`, `scanner`, or both;
- current files involved;
- target boundary/files;
- allowed shared contracts/packages;
- verification commands;
- STOP conditions.

## Builder Requirements

Builder must:

- run drift checks before editing;
- inspect current route/service/frontend/data flow before moving code;
- keep changes in one vertical slice;
- preserve existing API and UI behavior unless explicitly directed otherwise;
- stop if the owning boundary becomes unclear;
- report any affected routes, services, frontend entry points, scripts, and data
  files.

## Editor Requirements

Editor must review for:

- new global dumping grounds;
- duplicate route/service/frontend behavior;
- hidden product logic in generic utilities;
- unsafe broad movement;
- missing behavior-preservation evidence.

## Verification Gates

Use gates appropriate to the touched slice. Candidate commands:

```powershell
node --check frontend\public\scanner.js
node --check frontend\public\chart.js
node --check frontend\public\shared-chart-utils.js
npm --prefix backend test
npm --prefix backend run build
python tools\agent_router.py verify
```

If a command is unavailable or too broad for the slice, Builder must report why
and provide the smallest meaningful alternative.

## STOP Conditions

Stop and report to Validator if:

- the current code path differs from the PRD evidence;
- the first slice would affect trading, broker, backtest, or research behavior;
- the change requires a new frontend build system;
- a shared contract/package change affects another domain;
- preserving current route/UI behavior requires a larger rewrite;
- GitNexus impact analysis returns HIGH or CRITICAL for a symbol to be edited.

## Done Criteria

This workstream is complete when:

- Pattern Detector has at least one accepted behavior-preserving domain
  migration slice;
- future universe/scanner work has a clear owning boundary;
- Validator/Builder/Editor reports show the coding paradigm was enforced;
- no new duplicate universe/scanner workflow was introduced;
- verification evidence exists for the touched slice.
