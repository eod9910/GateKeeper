# Builder Report: Universe Job Commands Module

Directive: `agent-relay/roles/Validator/directives/2026-06-20-builder-universe-job-commands-module.md`

## Summary

Builder extracted universe subprocess command construction into a domain-owned module while leaving process lifecycle handling in `backend/src/routes/universe.ts`.

## GitNexus Evidence

Pre-edit check:

- `backend/src/routes/universe.ts` file impact: LOW risk; direct importer `backend/src/server.ts`; no affected processes.

Final detection:

- `mcp__gitnexus.detect_changes(scope="all")` reported LOW risk and no affected execution flows.

## Changed Files

- `backend/src/modules/universe/universeJobCommands.ts`
  - New command builder module for build, optionable rebuild, update, and regime classification jobs.
- `backend/src/modules/universe/universeJobCommands.test.ts`
  - Focused tests for command, args, and cwd behavior.
- `backend/src/routes/universe.ts`
  - Uses command builders.
  - Still owns `spawn`, stdout/stderr listeners, close handlers, active job state, cancellation, and HTTP responses.
- `backend/package.json`
  - Adds `universe-job-commands:test`.
  - Adds the focused test to aggregate `test`.

## Verification

- `npm.cmd --prefix backend run universe-job-commands:test` passed.
- `npm.cmd --prefix backend run universe-price-snapshot:test` passed.
- `npm.cmd --prefix backend run universe-catalog-meta:test` passed.
- `npm.cmd --prefix backend run universe-job-progress:test` passed.
- `npm.cmd --prefix backend run build` passed.
- `python tools\agent_router.py verify` passed with `ok: true`, `checked: 123`.

## Behavior Preservation

No subprocess lifecycle behavior was intentionally moved or changed.
No API paths changed.
No frontend files changed.
No data formats changed.
No Python scripts changed.

Command construction still uses `path.join` for script paths, matching previous route behavior.

## Residual Risk

Residual risk is low. Tests verify constructed commands without spawning Python. Runtime process lifecycle remains in the existing route.
