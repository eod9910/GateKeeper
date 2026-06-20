# Validator Directive: Fix Duplicate Scanner Universe Functions

## Classification

Tier 1 localized frontend cleanup to clear an `EDITOR BLOCKER`.

## Frozen Intent

`frontend/public/scanner.js` must contain one canonical implementation of each universe-management function. Preserve the latest intended behavior and remove overwritten duplicate declarations that are dead at runtime.

## Impact Analysis

GitNexus impact was run before editing:

- `universeRefreshStatus`: MEDIUM risk, 5 direct callers in `frontend/public/scanner.js`, no affected indexed execution flows.
- `universeBuild`: LOW risk, no indexed upstream callers.
- `_universeCheckWeeklyUpdate`: LOW risk, no indexed upstream callers.

## Builder Tasks

1. Edit `frontend/public/scanner.js`.
2. Remove or consolidate superseded duplicate definitions of:
   - `universeRefreshStatus`
   - `universeBuild`
   - `_universeCheckWeeklyUpdate`
3. Also remove any directly associated duplicate helper blocks if they are part of the overwritten universe-management copies and superseded by the later canonical implementation.
4. Preserve the latest intended behavior from the later universe-management implementation.
5. Do not refactor unrelated scanner behavior.

## Required Verification

- `node --check frontend\public\scanner.js`
- Search confirms only one declaration each for:
  - `universeRefreshStatus`
  - `universeBuild`
  - `_universeCheckWeeklyUpdate`

## Builder Report

Report files changed, declarations removed/consolidated, verification output, and any residual risks.
