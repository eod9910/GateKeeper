# Validator Directive — Heikin-Ashi + Equivolume Combined Chart Mode

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Validator
- To: Builder
- Tier: 2 (new frontend chart feature; also clears an open Editor blocker)
- Type: EXECUTION DIRECTIVE (frozen requirements)

## Goal

Add Heikin-Ashi as a selectable candle type on the scanner/workshop chart
(`frontend/public/chart.js`), and make it compose with the existing Equivolume
layout so the user can view **Heikin-Ashi candles with volume-proportional
width** (HA bodies + equivolume widths). Normal candles must remain the default
and behave exactly as today.

This also folds in an OPEN Editor blocker from the prior phase
(`chart-performance-cache-coalescing`): the scanner real-time poller is never
stopped on teardown. Fix it as part of R6 below.

## Current state (verified by Validator)

- `chartDisplayMode` is a 2-value layout flag: `'time'` (LightweightCharts
  candlestick series `patternSeries`) or `'equivol'` (custom canvas overlay
  `drawEquivolumeCandles`, which reads `open/high/low/close` for the body/wick and
  `volume`/`tick_volume` for width). See `chart.js:12`, `:137`, `:1121`.
- `drawPatternChart` builds `safeData` (raw) and `displayData`
  (`buildChartDisplayData`), sets `patternSeries.setData(displayData)` (`:859`),
  stores `window._scannerChartBars = displayData` for the poller (`:863`), sets
  `equivolumeDisplayData = safeData` (`:825`), and builds markers (`:866`).
- The real-time poller `_scannerRtTick` updates the last candle from `/api/quotes`
  using `window._scannerChartBars` (`:1415`–`:1479`). `_scannerRtStop` exists and
  is exposed but is ONLY called inside `_scannerRtStart` — never on teardown.
- There is NO Heikin-Ashi anywhere in the frontend today.
- The display-mode UI lives in `frontend/public/index.html` under
  `#chart-display-mode-btns` with `.chart-display-mode-btn[data-chart-display-mode]`.

## Frozen Requirements

R1. **HA transform util.** Add `computeHeikinAshi(bars)` to
    `frontend/public/shared-chart-utils.js`, exposed on `window.SharedChartUtils`.
    - Input: array of `{ time, open, high, low, close, volume?, tick_volume? }`.
    - Output: a NEW array (do not mutate input) with HA values:
      `haClose = (o+h+l+c)/4`; `haOpen = (prevHaOpen + prevHaClose)/2`, seeded on
      the first bar as `(o+c)/2`; `haHigh = max(h, haOpen, haClose)`;
      `haLow = min(l, haOpen, haClose)`.
    - MUST preserve `time` and pass through `volume`/`tick_volume` unchanged
      (equivolume width depends on real volume, not HA).
    - Must handle empty/short input and non-finite values defensively (skip/clamp,
      never throw).

R2. **Candle-type state, separate from layout.** Introduce
    `chartCandleType` = `'normal' | 'heikin'`, persisted to `localStorage` key
    `scanner-chart-candle-type`, defaulting to `'normal'`. Do NOT overload
    `chartDisplayMode`; layout (time/equivol) and candle type (normal/heikin) are
    independent and all four combinations must work.

R3. **Apply HA in both layouts.** In `drawPatternChart`, when
    `chartCandleType === 'heikin'`, derive an HA array from `displayData` once and
    use it consistently for:
    - the series data passed to `patternSeries.setData(...)` in `time` mode;
    - `equivolumeDisplayData` / the array fed to `drawEquivolumeCandles` in
      `equivol` mode (so HA bodies get equivolume widths from real volume);
    - `window._scannerChartBars` handed to the poller.
    When `chartCandleType === 'normal'`, behavior MUST be byte-for-byte the same as
    today (no HA path taken).

R4. **Markers/levels.** Pattern markers are time-indexed and must keep working.
    Price-based overlays/levels are computed on RAW price and are NOT to be
    recomputed onto HA — leave them on raw price. Add a brief, visible UI note (a
    small label or tooltip near the candle-type toggle) that Heikin-Ashi bodies are
    synthetic and levels reference real price. Keep it minimal.

R5. **Live poller is HA-aware.** `_scannerRtTick` must keep updating the last
    candle correctly when `chartCandleType === 'heikin'`:
    - Keep a raw-bar source of truth so HA can be recomputed (e.g. store raw bars
      alongside, such as `window._scannerChartRawBars`, in addition to the HA
      series the chart renders).
    - On each tick: update the raw last bar (high/low/close as today, with the same
      intraday-rollover rules and the equivol no-append rule), then recompute the
      HA value(s) for the affected tail bar(s) from the prior HA bar and call
      `patternSeries.update(...)` with the HA bar. In `normal` mode the poller path
      is unchanged.
    - A bad poll cycle must never throw or kill the timer (preserve existing
      try/catch behavior).

R6. **Clear the open blocker (poller teardown).** `clearChart()` (`chart.js:19`)
    MUST call `_scannerRtStop()` so the poller stops when the chart is cleared,
    mirroring the copilot chart (`copilot-chart.js:1806`). Confirm no other
    teardown/navigation path leaves the timer running.

R7. **UI toggle.** Add a candle-type toggle in `index.html` next to the existing
    display-mode buttons (parallel structure: a `#chart-candle-type-btns` wrapper
    with `.chart-candle-type-btn[data-chart-candle-type]` for `normal`/`heikin`).
    Mirror the existing display-mode wiring: a `setChartCandleType(type)` that
    persists, updates button styles, and redraws via `drawPatternChart` with
    `currentDisplayData`; a `_updateChartCandleTypeButtonStyles()`; and a
    `wireChartCandleTypeButtons()` called from the SAME init site as
    `wireChartDisplayModeButtons()`.

R8. **No backend changes.** This is frontend-only. Do not touch
    `plugin_service.py` or any data path. Do not change the equivolume width math
    or the cache-coalescing code.

## Acceptance Criteria

- Default load is Normal candles; Normal × Time and Normal × Equivolume are
  visually identical to current behavior.
- Toggling to Heikin-Ashi in Time mode shows HA candles (smoothed, fewer
  whipsaws). Toggling Equivolume on top shows HA bodies whose widths vary by
  volume.
- Switching candle type re-renders the currently displayed symbol without a full
  reload, and the choice persists across reloads (localStorage).
- With Heikin-Ashi active, the live poller keeps the last HA candle updating; in
  equivol mode it refreshes the last bar in place (no spurious append).
- After leaving/clearing the chart, the `/api/quotes` poll loop STOPS (blocker
  R6 cleared) — verify the interval is cleared.
- No console errors across the four combinations and during a timeframe switch.

## Process

- Builder writes a report to
  `agent-relay/roles/Builder/reports/2026-06-18-heikin-ashi-equivolume-builder-report.md`
  describing what changed (files + functions), assumptions, and limitations.
- Builder does NOT certify its own work, does NOT commit, and does NOT route.
  Builder MUST NOT start/leave the long-running dev server; a static review plus a
  JS syntax sanity check (e.g. `node --check frontend/public/chart.js` and
  `node --check frontend/public/shared-chart-utils.js`) is the expected
  verification depth for the Builder.
- Validator will independently verify against the files/diff, then route to the
  Editor for an anti-spaghetti pass (watch for: duplicated toggle scaffolding vs
  the display-mode code, the HA recompute living in one util not scattered, poller
  raw/HA bookkeeping clarity), then Validator accepts or rejects.
