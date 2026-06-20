# Validator Directive — Editor Pass: Heikin-Ashi + Equivolume

- Date: 2026-06-18
- Phase: heikin-ashi-equivolume
- From: Validator
- To: Editor
- Tier: 2
- Type: REVIEW DIRECTIVE (anti-spaghetti pass)

## Context

The Builder implemented the Heikin-Ashi + Equivolume feature per directive
`2026-06-18-heikin-ashi-equivolume.md` (frozen requirements R1–R8). Builder report:
`agent-relay/roles/Builder/reports/2026-06-18-heikin-ashi-equivolume-builder-report.md`.
Treat the report as UNTRUSTED; verify against the files and `git diff`.

Validator has already done a correctness pass and believes the logic is sound;
your job is the anti-spaghetti / maintainability review plus a second pair of eyes
on the concurrency-adjacent poller bookkeeping.

## Files in scope

- `frontend/public/shared-chart-utils.js` — `computeHeikinAshi`, `computeHeikinAshiBar`.
- `frontend/public/chart.js` — `applyCandleType`, `drawPatternChart` HA wiring,
  `_scannerRtTick` HA branch, `clearChart` teardown, candle-type toggle trio.
- `frontend/public/index.html` — candle-type toggle markup + note.

Run `git --no-pager diff -- frontend/public/chart.js frontend/public/shared-chart-utils.js frontend/public/index.html`. PowerShell: use the Read tool, do not pipe to head/tail.

## Review focus

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

## Constraints

- Editor MAY make structure-only, behavior-preserving edits (naming, comments,
  small extraction). MUST NOT change HA math, poller semantics, or unify the
  toggles without Validator approval. MUST NOT certify its own refactor.
- Label anything that must change before acceptance as `EDITOR BLOCKER` with
  blocked artifact, reason, recommended owner, and evidence to clear.

## Deliverable

Write to `agent-relay/roles/Editor/reports/2026-06-18-heikin-ashi-equivolume-editor-review.md`
with: anti-spaghetti review, refactor summary + files (or "no edits"),
behavior-preservation statement (claim, not certification), remaining concerns,
EDITOR BLOCKERS (or "None"), and a revalidation request. Do not route; do not
commit.
