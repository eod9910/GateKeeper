# Editor Review: Frontend Public Chart Cluster

## Scope Reviewed

- `frontend/public/chart.js`
- `frontend/public/shared-chart-utils.js`
- `frontend/public/index.html`
- `frontend/public/scanner.js`
- `frontend/public/index.js`

No source edits were made by Editor.

## Verification Observed

- `node --check frontend\public\scanner.js` passed.
- `node --check frontend\public\index.js` passed.
- `node --check frontend\public\chart.js` passed.
- `node --check frontend\public\shared-chart-utils.js` passed.

## EDITOR BLOCKER

`frontend/public/scanner.js` contains duplicate overwritten universe-management functions:

- `universeRefreshStatus` at lines 10, 135, and 452.
- `universeBuild` at lines 80, 172, and 548.
- `_universeCheckWeeklyUpdate` at lines 207 and 715.

Why this blocks folder health:

- In plain browser JavaScript, later function declarations overwrite earlier declarations.
- The first two versions of `universeRefreshStatus` and `universeBuild` are dead at runtime but still visible to maintainers.
- The duplicate blocks differ in behavior and copy, so future edits could easily patch the wrong version.
- `index.html` and `index.js` call the global names directly, so the file depends on declaration-order side effects.

Recommended owner: Builder.

Evidence required to clear:

- Remove or consolidate the superseded duplicate universe-management function bodies.
- Preserve the latest intended behavior unless Validator explicitly freezes a different requirement.
- Run `node --check frontend\public\scanner.js`.
- Run or manually verify the Settings universe controls:
  - Build Universe
  - Update Universe
  - Refresh
  - weekly update check when Settings is opened

## Non-Blocking Structural Findings

1. `frontend/public/index.js` is very large and mixes fundamentals rendering, navigation, scanner state, formatting helpers, and candidate display behavior. This is not a blocker because it reflects the current static-frontend architecture, but it is a high-coupling area.

2. `frontend/public/chart.js` is also large and now owns base chart rendering, equal-volume rendering, Heikin-Ashi mode, markers, overlays, drawing-tool attachment, timeframe switching, and real-time polling. The current diff is understandable, but this file should be watched closely.

3. `frontend/public/index.html` relies on inline `onclick` handlers for scanner/universe actions. That matches the existing no-build frontend style, but it preserves global-name coupling and makes duplicate function declarations more dangerous.

4. `frontend/public/shared-chart-utils.js` is a good direction: reusable chart math and data normalization live outside `chart.js`. No blocker found there.

## Ponytail Pass

- `delete`: remove the overwritten duplicate universe-management function blocks in `scanner.js`.
- `yagni`: no new abstraction is needed to clear the blocker; a small consolidation/delete pass is enough.
- `shrink`: after duplicate removal, `scanner.js` should get shorter without changing behavior.
- `native`: inline `onclick` could eventually move to event listeners, but that would be a broader frontend convention change and is not required for this cleanup.
- `stdlib` / `existing-dependency`: no clear finding.

## Editor Decision

Blocked for folder health until the duplicate universe-management definitions in `frontend/public/scanner.js` are consolidated.
