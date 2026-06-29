# DCF-first funnel — "undervalued + bullish narrative" underperformed; contrarian beat it

- Date: 2026-05-31
- Question: Does the user's actual long process work? Gate 1 DCF undervalued →
  Gate 2 bullish narrative → Gate 3 (optional) open-market insider buying.
- Script: `backend/scripts/run_dcf_funnel_study.py`
  (saves `backend/data/research/dcf_funnel_obs.csv`)
- Data: strictly PIT — DCF from statement facts available_at ≤ T; narrative from
  posts posted_at ≤ T (substantive-post bull share ≥ 0.60); insider from Form 4
  'P' purchases ≤ T. Forward returns = market-neutral excess vs the cross-sectional
  **median** of a broad liquid benchmark. (Options call-volume is current-only →
  not backtestable, excluded.)

## Method
Report buckets so each gate's marginal contribution is visible: undervalued alone,
undervalued + bullish narrative, + insider buying, and the contrarian mirror
(undervalued + *bearish* narrative).

## Result
- A first cut showed everything negative — traced to a **benchmark bias** (socially
  covered names underperform a mega-cap benchmark). After switching to the
  median-of-peers baseline:
- **"Undervalued + bullish narrative" UNDERPERFORMED.** Adding a bullish crowd to a
  cheap name did not help — arguably hurt (you're buying what the crowd already likes).
- **The contrarian mirror — "undervalued + BEARISH narrative" — looked better.**
  Cheap + disliked outperformed cheap + loved.

## Conclusion
The intuitive funnel (cheap + crowd agrees) is backwards. The edge is **contrarian**:
cheap names the crowd dislikes. This directly motivated (a) the contrarian-bottom
watch (`2026-05-31-eigen-crowd-contrarian.md`) and (b) reframing "narrative" as a
*thesis/justification* discriminator rather than crowd agreement. Bullish crowd
sentiment is closer to a fade input than a long input.
