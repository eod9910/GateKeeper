# Universe Job Progress Tests PRD

Checklist: universe-job-progress-tests-checklist.md

## Status

Active. Follow-up verification slice for the accepted universe/scanner migration.

## Selected Package

`medium-large-modular-web`

## Problem

The first universe/scanner migration slice extracted job progress parsing and log mutation into `backend/src/modules/universe/universeJobProgress.ts`. The backend build passes, but the extracted parser has no focused unit tests yet.

Before expanding the universe domain boundary, Pattern Detector should lock down representative progress behavior so later migrations are safer.

## Scope

In scope:

- Add focused TypeScript tests for `backend/src/modules/universe/universeJobProgress.ts`.
- Add a backend package script for the new test, following existing `tsx` test style.
- Include the new test in the backend aggregate `test` script if it stays fast and isolated.
- Verify the focused test and backend build.

Out of scope:

- Changing route behavior.
- Changing API paths or frontend calls.
- Changing Python universe scripts.
- Adding a new test framework.
- Expanding the universe module boundary beyond test coverage.

## Requirements

- Tests must cover source labels, progress clamping, representative build progress parsing, retry progress parsing, log trimming, and completion behavior.
- Tests must not require network access, Python services, data files, or a running server.
- Existing API route behavior must remain untouched.

## Verification Gates

```powershell
npm.cmd --prefix backend run universe-job-progress:test
npm.cmd --prefix backend run build
python tools\agent_router.py verify
```

## STOP Conditions

Stop and report if:

- tests require real universe data or external services;
- the extracted module needs behavior changes to become testable;
- package scripts conflict with the existing backend test pattern.

## Done Criteria

- Focused tests exist for `universeJobProgress`.
- Focused test command passes.
- Backend build passes.
- Builder, Editor, and Validator reports record the evidence.
