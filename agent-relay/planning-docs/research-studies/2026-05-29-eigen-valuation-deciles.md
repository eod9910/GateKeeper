# Eigen + valuation — eigen is a momentum signal, valuation alone is weak

- Date: 2026-05-29
- Question: How much edge does the DCF/valuation gap carry on its own, and does an
  eigen anomaly at the rebalance date sharpen it (especially the overvalued fade)?
- Script: `backend/scripts/run_eigen_valuation_study.py`
  (saves PIT observations to `backend/data/research/eigen_valuation_obs.csv`)
- Data: broad liquid universe (~750 names), monthly rebalances, strictly
  point-in-time. Forward returns = market-neutral EXCESS vs the cross-sectional
  **median** of the same universe (self-consistent → centers ≈ 0).

## Method
1. **Valuation standalone:** each month sort the universe into deciles by PIT DCF
   valuation gap; measure forward excess by decile. Looking for monotonicity vs a
   tail effect (we suspected the OVERVALUED tail fades).
2. **Eigen's marginal value:** within overvalued (and undervalued) names, compare
   forward excess WITH vs WITHOUT a fresh eigen residual spike (|z| ≥ 2, 120d
   lookback, 5 PCA factors removed) at T.

## Result
- **Valuation alone is a weak, non-monotonic signal.** No clean decile gradient;
  the edge that exists is concentrated in tails, not linear across the gap.
- **Eigen did NOT sharpen the fade.** An overvalued name with a fresh eigen spike
  did **not** fade harder/sooner — if anything the eigen spike pushed it the *same*
  direction as the move (UP for an up-spike). Eigen behaves like an **ignition /
  momentum** signal, not a mean-reversion/timing trigger for shorts.

## Conclusion
Eigen's natural home is the **long/momentum** side, not the short/reversal side
(followed up in `2026-05-30-eigen-long-momentum.md`). Valuation needs *other*
conditioning (price-extension, crowd, insider) to become a usable fade — which is
exactly what the live **fade composite** now does. Standalone valuation deciles are
not a tradable signal on their own.
