# PIT financial factors — earnings growth/ROE edge out the DCF gap short-term (small sample)

- Date: 2026-04-05
- Question: Which PIT financial factors are directionally informative, at which
  horizons — DCF gap vs earnings growth vs ROE vs earnings quality?
- Script: `backend/scripts/run_financial_factor_comparison_study.py`
- Output: `backend/data/research/financial_factor_comparison_summary.large200.json`
  (also limit60, small200 variants)
- Data: large-cap cut, monthly, horizons 63/126/252d, from 2020-01. **Caveat: thin**
  — only 62 symbols / 122 usable observations in this cut. Treat as directional, not
  conclusive.

## Result (directional accuracy, large-cap cut)
- **DCF gap:** combined accuracy ~0.54 @63d but **inverts at longer horizons**
  (0.44 @126d, 0.41 @252d). At 126/252d the "bullish/undervalued" bucket posted big
  returns (+35%, +57%) but on tiny n=23 — not trustworthy.
- **Earnings growth:** the most informative short-term — combined **0.59 @63d**
  (bullish +2.3% / bearish −2.5%, bearish accuracy 0.63). Edge decays by 126d.
- ROE / earnings quality: mild, secondary.

## Conclusion
On a small large-cap sample, **earnings growth and ROE were more directionally
informative at the 3-month horizon than the DCF gap itself**, while the DCF gap's
apparent long-horizon edge rests on too few observations to trust. Practical read:
don't over-rely on the DCF gap as a standalone factor; momentum-in-fundamentals
(earnings growth) carries useful short-horizon information. Sample size is the main
limitation — would need a broader, deeper rerun before acting on it.
