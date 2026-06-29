# Eigen historical replay — UP residuals are momentum longs; DOWN residuals are NOT shorts

- Date: 2026-05-10
- Question: Price-only, point-in-time: do eigen/PCA residual movers continue or
  revert, and is the signal tradeable directionally?
- Script: `backend/scripts/run_eigen_replay_study.py`
- Output: `backend/data/research/eigen_replay_study.latest.md/.json`
- Data: as-of 2024-05-01 → 2024-08-01, weekly, 750 names, 120d lookback, 5 factors,
  **318 signals** (|residual z| ≥ 2). Price-only — no valuation/options/social overlays.

## Result
**Treating residual sign as direction (long +, short −) loses money net:**
| Horizon | Expectancy | Win |
|---|---:|---:|
| 20d | −0.70% | 50.0% |
| 60d | −1.03% | 50.0% |
| 120d | −1.88% | 52.8% |

**But split by residual sign, the asymmetry is stark:**
- **Positive residual (UP), held long:** 120d avg **+10.5%**, win **64.7%**, profit
  factor **3.14**. Up-residuals keep rising → momentum/ignition.
- **Negative residual (DOWN), shorted:** 120d **−1.66R**, profit factor **0.25**
  (win ~38%). Shorting down-residuals is a disaster — they bounce. (As *longs*,
  down-residuals actually rebounded: +16.6% avg @120d.)

Higher thresholds (≥3, ≥4) did not improve the short; they thinned the sample.
Best 120d winners were UP spikes (UI +110%, AGX +104%, ACHR +102%); worst were
shorted DOWN names that ripped back.

## Conclusion
**Eigen is a LONG/momentum signal, not a short signal.** An up-residual is ignition
to ride; a down-residual is a bounce risk, not a short. This is the empirical root
of every later decision: eigen-UP feeds momentum longs and the bottom-watch, while
the *short/fade* side is driven by valuation + price-extension + crowd/insider, NOT
by eigen. Caveats: short window (3mo of as-of dates), today's universe → survivorship
bias, no stop/target fill model.
