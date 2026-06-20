# Editor Review — Heikin-Ashi + Equivolume Combined Chart Mode

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

## Anti-spaghetti review (findings tied to file:line)

### Focus 1 — HA/raw bookkeeping in the poller (PRIMARY)

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

### Focus 2 — Duplication: candle-type trio vs display-mode trio

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

### Focus 3 — HA math centralization

**SINGLE SOURCE OF TRUTH — CONFIRMED, no duplicated formula.**

- The HA formula lives only in `computeHeikinAshiBar` (`shared-chart-utils.js:152-173`).
- `computeHeikinAshi` calls it per bar (`shared-chart-utils.js:187`).
- The poller calls the *same* exported function via
  `window.SharedChartUtils.computeHeikinAshiBar` (`chart.js:1533-1534`, used at
  `:1552` and `:1572`).
- No `(o+h+l+c)/4` / `(prevOpen+prevClose)/2` arithmetic appears anywhere else in
  the three files. Grep-clean.

### Focus 4 — Defensive behavior (does anything throw and kill the poller/draw?)

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

### Focus 5 — Length-mismatch risk (`if (!bar) continue;`)

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

### Other observations

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

## Refactor summary + files changed

**No edits made.**

The in-scope code is already well-named, single-sourced for HA math, and
intent-commented. The only duplication (toggle trio) is directive-mandated parallel
structure, and the only structural improvements available (unify the toggles /
extract a toggle factory) are explicitly out of bounds for this pass. Making
cosmetic edits would add churn without maintainability gain, so the Editor changed
nothing.

---

## Behavior-preservation statement (CLAIM — explicitly NOT a self-certification)

Because the Editor made no edits, there is no Editor refactor whose behavior could
need preserving. The Editor's *claim*, based on reading the code and diff, is that
the Builder's implementation leaves NORMAL mode behaviorally identical to prior
behavior (same single array mutated, `patternSeries.update(updated)`, no HA path)
and that the HA path is additive and isolated behind `chartCandleType === 'heikin'`.
Per the tri-agent contract, this is a claim for the Validator to verify
independently; the Editor does not certify it, and the Editor cannot certify its
own work (there was none).

---

## Remaining structural concerns

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

## EDITOR BLOCKERS

**None.**

The Heikin-Ashi math is centralized in one util, the poller keeps raw and HA arrays
in lockstep with correct prior-HA index math, normal mode is unchanged, and every
identified edge case degrades gracefully rather than throwing. The remaining
concerns are low-severity, non-blocking, and either advisory comments or future
factoring.

---

## Revalidation request to Validator

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
