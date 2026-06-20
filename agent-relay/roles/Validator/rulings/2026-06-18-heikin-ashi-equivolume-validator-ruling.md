# Validator Ruling — Heikin-Ashi + Equivolume

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- Decision: ACCEPTED (static verification); pending User live sign-off

## Relay trail

1. Validator -> Builder directive (frozen R1–R8): `route-20260619-042800-validator-to-builder-0d621679`
2. Builder -> Validator report: `route-20260619-043501-builder-to-validator-9b35034e`
3. Validator -> Editor review directive: `route-20260619-043650-validator-to-editor-0237d314`
4. Editor -> Validator review (0 blockers): `route-20260619-044032-editor-to-validator-91c6fdf9`

## Validator independent verification (against files/diff, not reports)

- R1 HA util (`shared-chart-utils.js`): `computeHeikinAshi` / `computeHeikinAshiBar`
  correct math, non-mutating (Object.assign copy), preserves `time`, passes
  `volume`/`tick_volume`, seeds first bar `(o+c)/2`, defensive on non-finite. PASS.
- R2 state separation: `chartCandleType` independent of `chartDisplayMode`,
  persisted to `scanner-chart-candle-type`. PASS.
- R3 both layouts: `renderData = applyCandleType(displayData)` used for
  `patternSeries.setData`, `equivolumeDisplayData`, and `window._scannerChartBars`;
  raw kept in `window._scannerChartRawBars`. Normal mode returns same reference =>
  legacy path unchanged. PASS.
- R4 markers/levels on raw price (`displayData`/`safeData`); synthetic-bodies note
  added in `index.html`. PASS.
- R5 HA-aware poller: raw is source of truth; rollover pushes to raw+HA in sync;
  in-place recompute uses `haBars[len-2]` as prior HA bar. Normal path unchanged.
  PASS.
- R6 (folded blocker from chart-performance-cache-coalescing): `clearChart()` now
  calls `_scannerRtStop()`. Open Editor blocker from prior phase is CLEARED. PASS.
- R7 toggle trio + wiring at `initChartTimeframeButtons`. PASS.
- R8 frontend-only; no backend/cache/equivol-width changes. PASS.
- `node --check` clean on both JS files; IDE linter clean.

## Editor outcome

0 EDITOR BLOCKERS. Non-blocking note: toggle-trio duplication mirrors the existing
display-mode trio (acceptable parallelism; left as-is per directive). HA math is
single-sourced. Length-mismatch from `continue` is theoretical only (sanitize
strips falsy bars upstream).

## Decision

Code is ACCEPTED on static + structural grounds. Remaining gate is USER live
verification of the acceptance criteria in a browser (four combinations
normal/heikin x time/equivol, live poller updating the last HA candle, poller
interval cleared after leaving the chart). Not committed (User has not requested a
commit).

## Cross-phase note

This phase clears the only open blocker from `chart-performance-cache-coalescing`
(poller teardown). That phase's coalescing change was already Validator+Editor
verified correct; with R6 done, both phases are now blocker-free.
