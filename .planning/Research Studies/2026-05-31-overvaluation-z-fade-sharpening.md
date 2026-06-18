# Overvaluation z + fade sharpening — each leg drives the 3mo excess more negative

- Date: 2026-05-31
- Question: How statistically "overvalued/stretched" is a name (how many σ above its
  own trend), does that correlate with the DCF gap and crowd bullishness, and does
  stacking those legs sharpen the short/fade signal?
- Script / data: ad-hoc PIT study → `backend/data/research/overvaluation_z_obs.csv`
  (16,969 monthly observations). `ext_trend_z` = σ above the symbol's own log-price
  trend; `gap`/`overval` = DCF gap; `crowd_net`/`crowd_n` = trailing crowd mood.
  `e21/e63/e126` = market-neutral excess at 1/3/6mo.

## Result — 3mo market-neutral excess (e63); more negative = better fade
| Bucket | n | e21 | e63 (t) | e126 |
|---|---:|---:|---:|---:|
| ALL | 16,969 | +0.55% | **+1.31%** (t 7.5) | +2.37% |
| overvalued (gap ≤ −25%) | 6,998 | +0.49% | +0.84% (t 2.9) | +1.63% |
| overvalued + stretched (≥2σ) | 930 | −0.10% | +0.04% (t 0.1) | +0.34% |
| **overvalued + stretched + crowd-bullish** | 122 | **−1.90%** | **−4.30%** (t −2.2, 57% neg) | −1.61% |

The gradient is the whole story: the universe drifts **+1.3%** at 3mo; "overvalued"
alone barely dents it (+0.84%); adding "stretched ≥2σ" neutralizes it (+0.04%); and
adding an **euphoric crowd flips it sharply negative (−4.3%, statistically significant).**

Correlations: overvaluation (DCF gap) and price-extension z are **moderately positive**
(rich names tend to be stretched); crowd bullishness is **~uncorrelated** with both —
so the crowd leg adds genuinely independent information.

## Conclusion
Confirmed the fade thesis with numbers: **DCF-overvalued + ≥2σ price-stretched +
euphoric crowd** is where shorts pay (~−4% over 3 months), and no single leg does it
alone. This study is the empirical backbone of the live **fade composite** (and the
`price_extension_z` column / `FADE` badge) on the convergence board. Insider
selling-into-strength was later added as a fourth confirming leg (see VIAV paper).
