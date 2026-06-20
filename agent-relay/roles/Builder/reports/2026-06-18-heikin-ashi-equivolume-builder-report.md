# Builder Report — Heikin-Ashi + Equivolume Combined Chart Mode

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Builder
- To: Validator
- Directive: `agent-relay/roles/Validator/directives/2026-06-18-heikin-ashi-equivolume.md`
- Tier: 2 (frontend chart feature; also clears the open poller-teardown Editor blocker)

> Builder does NOT certify this work. Validator must independently verify against
> the files/diff and compile output. No commit and no router action were taken.

## Files Changed

1. `frontend/public/shared-chart-utils.js`
2. `frontend/public/chart.js`
3. `frontend/public/index.html`

No backend files were touched (R8 honored): `plugin_service.py`, the equivolume
width math, and the cache-coalescing code are unchanged.

## Functions Added / Modified (with line refs)

### `frontend/public/shared-chart-utils.js`
- **Added `computeHeikinAshiBar(bar, prevHaOpen, prevHaClose)`** (~lines 147–169).
  Single source of truth for HA math. Returns a NEW object (shallow copy via
  `Object.assign`), never mutates input, preserves `time`, passes
  `volume`/`tick_volume` through unchanged. Non-finite OHLC inputs are passed
  through untransformed (never throws). Seeds `haOpen=(o+c)/2` when no valid prior
  HA is supplied.
- **Added `computeHeikinAshi(bars)`** (~lines 171–193). Iterates raw bars, calls
  `computeHeikinAshiBar` per bar, advances `prevHaOpen/prevHaClose` only when the
  input bar's OHLC are all finite. Returns `[]` for empty/non-array input.
- **Modified the `window.SharedChartUtils` export** (~lines 195–202) to expose
  `computeHeikinAshi` and `computeHeikinAshiBar`.

### `frontend/public/chart.js`
- **Added `chartCandleType` state** (~line 12). Reads `localStorage`
  `scanner-chart-candle-type`, defaults to `'normal'` (only `'heikin'` opts in).
- **Added `applyCandleType(bars)` helper** (~after `buildChartDisplayData`).
  Returns the input array **unchanged (same reference)** in normal mode (so the
  normal path is byte-for-byte identical); returns a NEW HA array via
  `SharedChartUtils.computeHeikinAshi` in heikin mode, with a try/catch fallback
  to raw bars if the util is missing/throws.
- **Modified `clearChart()`** (~line 19, R6). Calls `_scannerRtStop()` inside a
  try/catch at the very top, before `initPatternChart()`.
- **Modified `drawPatternChart(candidate)`** (R3):
  - After `displayData` is built, derives `const renderData = applyCandleType(displayData)` ONCE.
  - `equivolumeDisplayData = chartCandleType === 'heikin' ? renderData : safeData`
    (normal mode keeps the exact prior `= safeData`).
  - `patternSeries.setData(renderData)` (was `displayData`).
  - `window._scannerChartBars = renderData` and **new** `window._scannerChartRawBars = displayData`.
  - The markers call still uses raw (`chartDisplayMode === 'equivol' ? displayData : safeData`) — unchanged (R4).
- **Modified `_scannerRtTick()`** (R5). Now picks a raw source of truth:
  `rawBars = isHeikin ? (window._scannerChartRawBars || window._scannerChartBars) : window._scannerChartBars`.
  Raw last bar is updated with the same high/low/close + intraday-rollover +
  equivol-no-append rules as before. When heikin, it recomputes the affected tail
  HA bar from the prior HA bar via `SharedChartUtils.computeHeikinAshiBar` and
  calls `patternSeries.update(haBar)`; the HA array (`window._scannerChartBars`,
  which is the same reference as `equivolumeDisplayData` in heikin mode) is updated
  in place. In normal mode `rawBars === window._scannerChartBars`, so the path is
  unchanged (no double-mutation). The existing try/catch is preserved so a bad
  poll never throws or kills the timer.
- **Added `_updateChartCandleTypeButtonStyles()`, `setChartCandleType(type)`,
  `wireChartCandleTypeButtons()`** (R7), mirroring the display-mode trio.
  `setChartCandleType` persists to `localStorage`, updates button styles, and
  redraws via `drawPatternChart` using `currentDisplayData`.
- **Modified `initChartTimeframeButtons()`** to call `wireChartCandleTypeButtons()`
  right beside `wireChartDisplayModeButtons()` — the same init site (also runs on
  `DOMContentLoaded`/immediate per the existing guard below it).
- **Added window exports** `window.setChartCandleType` and
  `window.wireChartCandleTypeButtons` next to the existing display-mode exports.

### `frontend/public/index.html`
- **Added `#chart-candle-type-btns`** right after `#chart-display-mode-btns`,
  with `.chart-candle-type-btn[data-chart-candle-type]` buttons for `normal` and
  `heikin`, matching the display-mode button markup/styling. Includes an inline
  info note (`#chart-candle-type-note`, an ⓘ glyph with a `title` tooltip +
  `aria-label`) stating HA bodies are synthetic and markers/levels reference real
  price (R4 UI note).

## How Each Requirement Was Addressed

- **R1** — `computeHeikinAshi(bars)` added and exposed on `window.SharedChartUtils`.
  New array (no mutation), `time` preserved, `volume`/`tick_volume` passed
  through, first-bar seed `(o+c)/2`, defensive on empty/short/non-finite (never
  throws). The per-bar math was factored into `computeHeikinAshiBar` so the live
  poller reuses the exact same formula (one util, not scattered).
- **R2** — `chartCandleType` (`'normal' | 'heikin'`) added, persisted to
  `scanner-chart-candle-type`, default `'normal'`. It is fully independent of
  `chartDisplayMode`; all four combinations are supported.
- **R3** — HA derived once as `renderData` in `drawPatternChart` and used for
  `patternSeries.setData`, `equivolumeDisplayData`/`drawEquivolumeCandles`, and
  `window._scannerChartBars`. In normal mode `applyCandleType` returns the same
  reference, so the path is byte-for-byte equivalent to before.
- **R4** — Markers continue to be built from raw (`displayData`/`safeData`);
  price overlays/levels in `buildCandidateOverlays`/`renderOverlays` are untouched
  and remain on raw price. Added the minimal visible UI note + tooltip near the
  toggle.
- **R5** — `_scannerRtTick` keeps `window._scannerChartRawBars` as the raw source
  of truth, applies the same update/rollover/no-append rules to the raw tail, then
  recomputes the HA tail bar and `patternSeries.update(...)`s it. Normal mode is
  unchanged; try/catch preserved.
- **R6** — `clearChart()` now calls `_scannerRtStop()`. I searched `chart.js`
  for poller start/stop sites: `_scannerRtStart()` is called only inside
  `drawPatternChart` (which calls `_scannerRtStop()` first via `_scannerRtStart`),
  and `_scannerRtStop()` is now also called on teardown in `clearChart()`. No
  other teardown path in `chart.js` starts the timer.
- **R7** — Toggle UI added in `index.html`; `setChartCandleType`,
  `_updateChartCandleTypeButtonStyles`, `wireChartCandleTypeButtons` mirror the
  display-mode functions and are wired from `initChartTimeframeButtons` (same site
  as `wireChartDisplayModeButtons`).
- **R8** — Frontend-only. No backend, equivolume-width, or cache-coalescing
  changes.

## Assumptions

- `currentDisplayData` is a pre-existing global (already referenced by
  `setChartDisplayMode`); `setChartCandleType` reuses it identically for redraw.
- In heikin mode, `window._scannerChartBars` (the rendered HA array) and
  `equivolumeDisplayData` intentionally point at the same `renderData` reference,
  so the live poller's in-place tail update is reflected if/when the equivolume
  canvas is redrawn by an interaction. The poller itself does not trigger a canvas
  redraw (matching prior behavior).
- "Visible UI note" was satisfied with a small always-present ⓘ glyph carrying a
  `title` tooltip + `aria-label`, per the directive's "small label or tooltip"
  allowance.
- The raw tail bar written by the poller carries `{time, open, high, low, close}`
  only (volume dropped), matching the pre-existing normal-mode behavior; HA tail
  recompute does not need volume, and the equivolume canvas is not redrawn by the
  poller, so widths are unaffected by this.

## Deviations / Limitations

- **Added an extra exported util `computeHeikinAshiBar`** beyond the literal R1
  surface (`computeHeikinAshi`). Rationale: it centralizes the HA formula so the
  full-array transform and the live-poller tail recompute share one
  implementation (anti-spaghetti). Flagging for Validator/Editor awareness.
- Verification depth was limited per directive: `node --check` only; the dev
  server was NOT started/left running, and no browser smoke test of the four
  combinations was performed. Live/visual acceptance criteria remain for the
  Validator.

## node --check Results

Run from repo root (PowerShell; commands run separately because PowerShell does
not accept `&&`):

```
node --check frontend/public/chart.js              -> exit 0
node --check frontend/public/shared-chart-utils.js -> exit 0
```

Both files pass syntax check. Editor/IDE linter reported no errors on the three
edited files.
