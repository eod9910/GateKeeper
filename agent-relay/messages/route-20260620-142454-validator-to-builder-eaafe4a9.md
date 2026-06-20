# Validator Directive: Universe Cancel/Kill Characterization

Date: 2026-06-20
Phase: universe-process-runner-characterization
From: Validator
To: Builder

## Intent

Complete the remaining cancellation/kill characterization for the universe process runner plan without moving full process ownership out of `backend/src/routes/universe.ts`.

## Scope

- Add the smallest module helper needed to model cancellation against a fake killable process.
- Keep `spawn`, stdout/stderr listener registration, close handlers, HTTP response timing, and `activeProcess` ownership in the route.
- Add focused tests proving kill invocation, null process return, and existing cancellation state.

## Required Checks

- `npm.cmd --prefix backend run universe-job-lifecycle:test`
- `npm.cmd --prefix backend run universe-process-output:test`
- `npm.cmd --prefix backend run build`
- `python tools\agent_router.py verify`
- GitNexus detect changes before any commit.
