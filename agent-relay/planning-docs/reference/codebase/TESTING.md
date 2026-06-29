# Testing Patterns

Analysis date: 2026-06-02
Status: Current orientation reference

## Current State

The repo now has automated tests. The older claim that no tests exist is obsolete.

`backend/package.json` defines:

```text
npm test
```

This runs a chain of TypeScript service tests plus Python unittest suites.

## TypeScript Tests

Known TypeScript tests include:

- `backend/src/services/training/forwardResolver.test.ts`
- `backend/src/services/visionService.test.ts`
- `backend/src/services/candidateFilters.test.ts`
- `backend/src/services/candidateSemantics.test.ts`
- `backend/src/services/candidatePersistence.test.ts`
- `backend/src/services/brokerClient.test.ts`
- `backend/src/services/chartData.test.ts`
- `backend/src/services/contractValidation.test.ts`
- `backend/src/services/signalScanner.test.ts`

These are run directly with `tsx` scripts from `backend/package.json`.

## Python Tests

The backend test script runs Python unittest modules under `tests`, including validator fixture tests, fundamentals service tests, density/base detector tests, pattern framework tests, ATR pivot research tests, and structure discovery tests.

Use:

```powershell
cd backend
npm run py:test
```

or run the full backend test chain:

```powershell
cd backend
npm test
```

## Practical Verification Pattern

For narrow changes, run the smallest relevant command:

- JavaScript syntax: `node --check <file>`
- Python syntax: `py -m py_compile <file>`
- TypeScript service tests: the specific `npm run <name>:test` script
- Full backend verification: `npm test`

For frontend visual/layout work, use a dev server and browser/Playwright-style screenshot checks where practical.

## Current Gaps

- Many frontend pages still lack automated UI tests.
- Many research scripts are not covered by tests.
- File-backed data stores need more contract/regression tests.
- Integration tests for scheduler/execution/market-intelligence flows are limited.
- Tests are script-driven rather than organized through a single conventional test framework.
