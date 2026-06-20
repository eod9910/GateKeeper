# Agent Relay Transcript: heikin-ashi-equivolume

Generated: 2026-06-20T14:20:28Z

## 1. Validator -> Builder: Heikin-Ashi + Equivolume Combined Chart Mode

- Routing ID: `route-20260619-042800-validator-to-builder-0d621679`
- Type: `EXECUTION DIRECTIVE`
- Phase: `heikin-ashi-equivolume`
- Timestamp: `2026-06-19T04:28:00Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-18-heikin-ashi-equivolume.md`
- Body: `agent-relay/messages/route-20260619-042800-validator-to-builder-0d621679.md`
- SHA-256: `0ed37458e3f16babc28c849b4851effb9cb70f8c6e12ab3d3d4904d93841fcc8`

### Validator Directive — Heikin-Ashi + Equivolume Combined Chart Mode

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Validator
- To: Builder
- Tier: 2 (new frontend chart feature; also clears an open Editor blocker)
- Type: EXECUTION DIRECTIVE (frozen requirements)

#### Goal

Add Heikin-Ashi as a selectable candle type on the scanner/workshop chart
(`frontend/public/chart.js`), and make it compose with the existing Equivolume
layout so the user can view **Heikin-Ashi candles with volume-proportional
width** (HA bodies + equivolume widths). Normal candles must remain the default
and behave exactly as today.

This also folds in an OPEN Editor blocker from the prior phase
(`chart-performance-cache-coalescing`): the scanner real-time poller is never
stopped on teardown. Fix it as part of R6 below.

#### Current state (verified by Validator)

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

#### Frozen Requirements

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

#### Acceptance Criteria

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

#### Process

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


---

## 2. Builder -> Validator: Heikin-Ashi + Equivolume Implemented

- Routing ID: `route-20260619-043501-builder-to-validator-9b35034e`
- Type: `BUILDER REPORT`
- Phase: `heikin-ashi-equivolume`
- Timestamp: `2026-06-19T04:35:01Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-18-heikin-ashi-equivolume-builder-report.md`
- Body: `agent-relay/messages/route-20260619-043501-builder-to-validator-9b35034e.md`
- SHA-256: `e641c715d845a990ee56fe9d4512df007f859a964d1f6bc8f687977778b384c9`

### Builder Report — Heikin-Ashi + Equivolume Combined Chart Mode

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Builder
- To: Validator
- Directive: `agent-relay/roles/Validator/directives/2026-06-18-heikin-ashi-equivolume.md`
- Tier: 2 (frontend chart feature; also clears the open poller-teardown Editor blocker)

> Builder does NOT certify this work. Validator must independently verify against
> the files/diff and compile output. No commit and no router action were taken.

#### Files Changed

1. `frontend/public/shared-chart-utils.js`
2. `frontend/public/chart.js`
3. `frontend/public/index.html`

No backend files were touched (R8 honored): `plugin_service.py`, the equivolume
width math, and the cache-coalescing code are unchanged.

#### Functions Added / Modified (with line refs)

##### `frontend/public/shared-chart-utils.js`
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

##### `frontend/public/chart.js`
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

##### `frontend/public/index.html`
- **Added `#chart-candle-type-btns`** right after `#chart-display-mode-btns`,
  with `.chart-candle-type-btn[data-chart-candle-type]` buttons for `normal` and
  `heikin`, matching the display-mode button markup/styling. Includes an inline
  info note (`#chart-candle-type-note`, an ⓘ glyph with a `title` tooltip +
  `aria-label`) stating HA bodies are synthetic and markers/levels reference real
  price (R4 UI note).

#### How Each Requirement Was Addressed

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

#### Assumptions

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

#### Deviations / Limitations

- **Added an extra exported util `computeHeikinAshiBar`** beyond the literal R1
  surface (`computeHeikinAshi`). Rationale: it centralizes the HA formula so the
  full-array transform and the live-poller tail recompute share one
  implementation (anti-spaghetti). Flagging for Validator/Editor awareness.
- Verification depth was limited per directive: `node --check` only; the dev
  server was NOT started/left running, and no browser smoke test of the four
  combinations was performed. Live/visual acceptance criteria remain for the
  Validator.

#### node --check Results

Run from repo root (PowerShell; commands run separately because PowerShell does
not accept `&&`):

```
node --check frontend/public/chart.js              -> exit 0
node --check frontend/public/shared-chart-utils.js -> exit 0
```

Both files pass syntax check. Editor/IDE linter reported no errors on the three
edited files.


---

## 3. Validator -> Editor: Editor Pass: Heikin-Ashi + Equivolume

- Routing ID: `route-20260619-043650-validator-to-editor-0237d314`
- Type: `REVIEW DIRECTIVE`
- Phase: `heikin-ashi-equivolume`
- Timestamp: `2026-06-19T04:36:50Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-18-editor-review-heikin-ashi-equivolume.md`
- Body: `agent-relay/messages/route-20260619-043650-validator-to-editor-0237d314.md`
- SHA-256: `cfcabd528752216a202772e9e0778d5d101f7601d9575af202a73a367a74c28c`

### Validator Directive — Editor Pass: Heikin-Ashi + Equivolume

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Validator
- To: Editor
- Tier: 2
- Type: REVIEW DIRECTIVE (anti-spaghetti pass)

#### Context

The Builder implemented the Heikin-Ashi + Equivolume feature per directive
`2026-06-18-heikin-ashi-equivolume.md` (frozen requirements R1–R8). Builder report:
`agent-relay/roles/Builder/reports/2026-06-18-heikin-ashi-equivolume-builder-report.md`.
Treat the report as UNTRUSTED; verify against the files and `git diff`.

Validator has already done a correctness pass and believes the logic is sound;
your job is the anti-spaghetti / maintainability review plus a second pair of eyes
on the concurrency-adjacent poller bookkeeping.

#### Files in scope

- `frontend/public/shared-chart-utils.js` — `computeHeikinAshi`, `computeHeikinAshiBar`.
- `frontend/public/chart.js` — `applyCandleType`, `drawPatternChart` HA wiring,
  `_scannerRtTick` HA branch, `clearChart` teardown, candle-type toggle trio.
- `frontend/public/index.html` — candle-type toggle markup + note.

Run `git --no-pager diff -- frontend/public/chart.js frontend/public/shared-chart-utils.js frontend/public/index.html`. PowerShell: use the Read tool, do not pipe to head/tail.

#### Review focus

1. **HA/raw bookkeeping in the poller** (PRIMARY): confirm `window._scannerChartBars`
   (rendered, HA in heikin mode) and `window._scannerChartRawBars` (raw) cannot
   drift out of sync across rollover vs in-place updates; confirm the prior-HA
   index math (`haBars[len-2]` for in-place, `haBars[len-1]` for rollover) is
   correct; confirm normal mode is behaviorally unchanged (same array mutated,
   `patternSeries.update(updated)`).
2. **Duplication**: the candle-type toggle trio mirrors the display-mode trio
   nearly verbatim. Is that acceptable parallelism or should it be factored? FLAG
   with a recommendation; do not refactor product behavior.
3. **HA math centralization**: is `computeHeikinAshiBar` genuinely the single
   source of truth (used by both the array transform and the poller), or is HA
   math duplicated anywhere?
4. **Defensive behavior**: empty/short arrays, missing `SharedChartUtils`,
   non-finite prices — does anything throw and kill the poller timer or break a
   draw?
5. **Length-mismatch risk**: `computeHeikinAshi` skips `!bar` via `continue` (could
   shorten the HA array vs raw). Given inputs are pre-sanitized, is this a real
   risk or only theoretical? State which.

#### Constraints

- Editor MAY make structure-only, behavior-preserving edits (naming, comments,
  small extraction). MUST NOT change HA math, poller semantics, or unify the
  toggles without Validator approval. MUST NOT certify its own refactor.
- Label anything that must change before acceptance as `EDITOR BLOCKER` with
  blocked artifact, reason, recommended owner, and evidence to clear.

#### Deliverable

Write to `agent-relay/roles/Editor/reports/2026-06-18-heikin-ashi-equivolume-editor-review.md`
with: anti-spaghetti review, refactor summary + files (or "no edits"),
behavior-preservation statement (claim, not certification), remaining concerns,
EDITOR BLOCKERS (or "None"), and a revalidation request. Do not route; do not
commit.


---

## 4. Editor -> Validator: Heikin-Ashi + Equivolume Review (0 blockers)

- Routing ID: `route-20260619-044032-editor-to-validator-91c6fdf9`
- Type: `EDITOR REVIEW`
- Phase: `heikin-ashi-equivolume`
- Timestamp: `2026-06-19T04:40:32Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-18-heikin-ashi-equivolume-editor-review.md`
- Body: `agent-relay/messages/route-20260619-044032-editor-to-validator-91c6fdf9.md`
- SHA-256: `9b3fe815130aa45ba992eb121fe6b71c724686210eca0b3e3dfb5d9fa0f22b5f`

### Editor Review — Heikin-Ashi + Equivolume Combined Chart Mode

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Editor
- To: Validator
- Tier: 2
- Type: Anti-spaghetti / maintainability review (second-eyes on poller bookkeeping)
- Directive: `agent-relay/roles/Validator/directives/2026-06-18-editor-review-heikin-ashi-equivolume.md`
- Builder report reviewed (treated as UNTRUSTED, verified against code): `agent-relay/roles/Builder/reports/2026-06-18-heikin-ashi-equivolume-builder-report.md`

Verification basis: read of `frontend/public/shared-chart-utils.js`, `frontend/public/chart.js`,
`frontend/public/index.html`; `git --no-pager diff` of the three files; `node --check`
on both JS files (both exit 0). No dev server started, no commit, no router action.

---

#### Anti-spaghetti review (findings tied to file:line)

##### Focus 1 — HA/raw bookkeeping in the poller (PRIMARY)

**Sync across rollover vs in-place: cannot drift. CONFIRMED.**

- In heikin mode the two arrays are genuinely distinct references: `renderData`
  is a NEW array from `computeHeikinAshi(displayData)` (`chart.js:853`), while the
  raw `displayData` is stored separately (`chart.js:894-895`:
  `window._scannerChartBars = renderData`, `window._scannerChartRawBars = displayData`).
- Poller picks raw as source of truth and HA as the rendered tail
  (`chart.js:1512-1538`).
- Rollover branch (`chart.js:1547-1558`): `rawBars.push(newBar)` AND
  `haBars.push(haBar)` — both grow by exactly one. In sync.
- In-place branch (`chart.js:1569-1574`): `rawBars[len-1] = updated` AND
  `haBars[len-1] = haBar` — both replace the last element. In sync.
- The two branches are mutually exclusive (`return` at `chart.js:1558` after a
  rollover), so no path mutates one array without the matching mutation on the
  other.

**Prior-HA index math: CORRECT.**

- Rollover (`chart.js:1551`): a brand-new bar is appended, so the previous HA bar
  is the *current* last element, read as `haBars[haBars.length - 1]` *before* the
  push. Correct.
- In-place (`chart.js:1571`): the last HA bar is being *recomputed*, so its
  predecessor is `haBars[haBars.length - 2]`. Correct. Using `len-1` here would
  have seeded the recompute from itself.
- Both reads are null-guarded (`haBars.length ? …`, `haBars.length >= 2 ? …`) and
  fall back to `NaN` seeds, which `computeHeikinAshiBar` interprets as the
  first-bar `(o+c)/2` seed. No throw on a short array.

**NORMAL mode behaviorally unchanged: CONFIRMED.**

- `applyCandleType` returns the *same array reference* in normal mode
  (`chart.js:77`), so `renderData === displayData`; `equivolumeDisplayData = safeData`
  exactly as before (`chart.js:854`), and `setData(renderData)` is the prior
  `setData(displayData)` (`chart.js:888`).
- In the poller, `isHeikin === false` ⇒ `rawBars === window._scannerChartBars`,
  `haBars === null`, `useHa === false` (`chart.js:1536-1539`), so the only mutation
  is `rawBars[len-1] = updated` / `patternSeries.update(updated)`
  (`chart.js:1569,1576`) — the single-array path, no HA branch, no double-mutation.

**Bonus correctness note (no compounding):** `setChartCandleType` redraws from
`currentDisplayData.chart_data`, which is the RAW `safeData` (`chart.js:884`), and
`drawPatternChart` re-derives HA from scratch every draw. So normal→heikin→normal
toggling never applies HA-on-HA. Good.

##### Focus 2 — Duplication: candle-type trio vs display-mode trio

**ACCEPTABLE PARALLELISM — recommend (do not require) future factoring.**

The trio `_updateChartCandleTypeButtonStyles` / `setChartCandleType` /
`wireChartCandleTypeButtons` (`chart.js:1182-1224`) mirrors the display-mode trio
nearly verbatim (button-style branch, `localStorage` persist, redraw-from-
`currentDisplayData`, `dataset.*Wired` guard, delegated click listener). This is
intentional parallel structure mandated by R7 ("mirror the existing display-mode
wiring") and it keeps the two toggles trivially comparable. It is the cleaner of
the two evils versus a premature abstraction.

Recommendation (NON-BLOCKING, NOT performed — would risk unifying the toggles,
which the directive forbids): if a third toggle is ever added, extract a small
`makeChartToggle({ wrapId, btnClass, attr, getState, setState })` factory. With
only two toggles today, the shared helper would not yet pay for itself. Leave as-is.

##### Focus 3 — HA math centralization

**SINGLE SOURCE OF TRUTH — CONFIRMED, no duplicated formula.**

- The HA formula lives only in `computeHeikinAshiBar` (`shared-chart-utils.js:152-173`).
- `computeHeikinAshi` calls it per bar (`shared-chart-utils.js:187`).
- The poller calls the *same* exported function via
  `window.SharedChartUtils.computeHeikinAshiBar` (`chart.js:1533-1534`, used at
  `:1552` and `:1572`).
- No `(o+h+l+c)/4` / `(prevOpen+prevClose)/2` arithmetic appears anywhere else in
  the three files. Grep-clean.

##### Focus 4 — Defensive behavior (does anything throw and kill the poller/draw?)

**No throw path identified.**

- `computeHeikinAshiBar` passes non-finite OHLC through untransformed instead of
  throwing (`shared-chart-utils.js:159-161`); `Object.assign({}, bar || {})`
  tolerates a null bar.
- `computeHeikinAshi` returns `[]` for empty/non-array input
  (`shared-chart-utils.js:180`); per-bar null skipped via `continue`
  (`shared-chart-utils.js:186`).
- `applyCandleType` is try/catch-wrapped with a raw fallback and a missing-util
  guard (`chart.js:78-86`).
- `drawPatternChart` returns early when `displayData.length === 0`
  (`chart.js:849`), so `renderData` is only built on non-empty input; the empty-HA
  edge cannot reach `setData`.
- The poller body is fully inside try/catch (`chart.js:1516-1580`), with
  `!rawBars || rawBars.length === 0` and `!lastBar` guards (`chart.js:1515,1531`)
  and a finite-price guard (`chart.js:1528`). A bad poll cycle is swallowed and the
  interval survives.
- `clearChart` calls `_scannerRtStop()` inside its own try/catch at the top
  (`chart.js:26`), so teardown cannot throw before `initPatternChart()`.

One graceful-degradation note (NON-BLOCKING): if `isHeikin` is true but
`computeHeikinAshiBar` is unavailable, `useHa` is false and the poller would
`patternSeries.update(updated)` with a RAW bar. This is coherent in practice,
because the same missing-util condition makes `applyCandleType` fall back to raw at
draw time (both functions are exported together), so the series is already showing
raw bars. No visual jump, no throw.

##### Focus 5 — Length-mismatch risk (`if (!bar) continue;`)

**THEORETICAL ONLY, not a real risk — with a latent-coupling caveat.**

- The HA array can only become shorter than raw if a `displayData` element is
  falsy. `displayData` comes from `buildChartDisplayData` → `sanitizeChartData`
  (`chart.js:67-70`), whose `.filter()` drops every falsy bar and every bar with
  null/NaN OHLC and returns a fresh array (`shared-chart-utils.js:22-57`). So
  `computeHeikinAshi`'s `continue` (`shared-chart-utils.js:186`) is unreachable on
  this input and `out.length === displayData.length`. The poller's tail-index
  alignment between `haBars` and `rawBars` therefore holds.
- Caveat (NON-BLOCKING): the no-mismatch guarantee depends entirely on the
  upstream sanitize contract, not on anything local to the poller. The poller
  indexes both arrays by tail position (`len-1`/`len-2`) and assumes positional
  alignment. If a future caller ever feeds unsanitized bars into the heikin path,
  the tails could silently misalign without throwing. Worth a one-line comment
  noting the precondition; not required for this acceptance.

##### Other observations

- **Mixed working-tree diff (NON-BLOCKING, Validator-relevant):** `git diff` for
  these files also shows the prior-phase `switchChartTimeframe` parallelization and
  the full `_scannerRt*` block as additions (uncommitted work from
  `chart-performance-cache-coalescing`). The directive's "current state" describes
  the poller as pre-existing, but it appears as new in the diff. The HA-specific
  additions I reviewed are interleaved with that prior work; Validator's
  diff-based verification should expect the diff to span both phases.
- **Comment quality:** the new comments explain intent/trade-offs (why raw+HA are
  kept separately, why no append in equivol, why normal mode is byte-identical)
  rather than narrating code. Good.

---

#### Refactor summary + files changed

**No edits made.**

The in-scope code is already well-named, single-sourced for HA math, and
intent-commented. The only duplication (toggle trio) is directive-mandated parallel
structure, and the only structural improvements available (unify the toggles /
extract a toggle factory) are explicitly out of bounds for this pass. Making
cosmetic edits would add churn without maintainability gain, so the Editor changed
nothing.

---

#### Behavior-preservation statement (CLAIM — explicitly NOT a self-certification)

Because the Editor made no edits, there is no Editor refactor whose behavior could
need preserving. The Editor's *claim*, based on reading the code and diff, is that
the Builder's implementation leaves NORMAL mode behaviorally identical to prior
behavior (same single array mutated, `patternSeries.update(updated)`, no HA path)
and that the HA path is additive and isolated behind `chartCandleType === 'heikin'`.
Per the tri-agent contract, this is a claim for the Validator to verify
independently; the Editor does not certify it, and the Editor cannot certify its
own work (there was none).

---

#### Remaining structural concerns

1. (Low) Poller tail-index alignment relies on an upstream sanitize precondition
   that is not asserted locally (Focus 5 caveat). A one-line comment at the
   `haBars` selection (`chart.js:1536`) noting "haBars and rawBars are
   index-aligned because both derive from sanitized displayData" would harden it.
2. (Low) Toggle-trio duplication will become real debt at a third toggle (Focus 2).
   Track for future factoring; not actionable now.
3. (Info) Mixed-phase working tree may complicate the Validator's clean
   phase-scoped diff (see Other observations).

None of these are blockers.

---

#### EDITOR BLOCKERS

**None.**

The Heikin-Ashi math is centralized in one util, the poller keeps raw and HA arrays
in lockstep with correct prior-HA index math, normal mode is unchanged, and every
identified edge case degrades gracefully rather than throwing. The remaining
concerns are low-severity, non-blocking, and either advisory comments or future
factoring.

---

#### Revalidation request to Validator

The Editor performed an anti-spaghetti / maintainability pass and made no edits, so
no re-review of an Editor refactor is required. The Editor requests that the
Validator:

1. Independently confirm the NORMAL-mode behavior-preservation CLAIM above against
   the files/diff (Editor did not certify it).
2. Perform the live acceptance checks the static pass cannot cover: the four
   normal/heikin × time/equivol combinations render without console errors; the
   live poller updates the last HA candle in heikin mode (rollover and in-place);
   equivol mode refreshes in place with no spurious append; and the `/api/quotes`
   loop STOPS after `clearChart` (R6 cleared — verify the interval is cleared).
3. Decide whether to accept the two low-severity advisory items (precondition
   comment at `chart.js:1536`; future toggle-factory note) now or defer them.


---
