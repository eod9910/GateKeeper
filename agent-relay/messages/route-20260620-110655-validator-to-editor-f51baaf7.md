# Validator Directive: Frontend Public Chart Cluster Editor Review

## Classification

Editor review only. No product-code edits are authorized.

## Scope

Review the scanner/chart cluster in `frontend/public/`:

- `frontend/public/chart.js`
- `frontend/public/shared-chart-utils.js`
- `frontend/public/index.html`
- `frontend/public/scanner.js`
- `frontend/public/index.js`

## Review Goals

- Identify structural/maintainability risk.
- Identify global-state and script-order coupling risk.
- Identify duplicate logic or unclear ownership boundaries.
- Run the Ponytail-style anti-overengineering pass:
  - `delete`
  - `stdlib`
  - `native`
  - `existing-dependency`
  - `yagni`
  - `shrink`
- State whether there are any `EDITOR BLOCKER` findings.

## Boundaries

- Do not certify product behavior.
- Do not modify source files.
- Do not remove validation, safety checks, accessibility, required tests, or behavior-preservation evidence.
- If a concern is not blocking, label it non-blocking.
