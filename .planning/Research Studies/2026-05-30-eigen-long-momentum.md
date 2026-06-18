# Eigen as a long — "eigen UP + uptrend" is a momentum long; undervaluation kills it

- Date: 2026-05-30
- Question: Since eigen is ignition/momentum (not reversal), does
  "eigen UP + (undervalued) + confirmed uptrend" beat plain eigen UP and the universe?
- Script: `backend/scripts/run_eigen_long_study.py`
  (reuses `eigen_valuation_obs.csv`; no DCF/PCA re-run)
- Data: saved PIT observations; layers a PIT trend filter
  (close > 50d SMA AND 20d SMA > 50d SMA = confirmed uptrend). Horizons 1/3/6mo,
  market-neutral excess.

## Method
Bucket the eigen-UP observations (z ≥ 2) by undervalued/overvalued and by the
uptrend flag; compare forward market-neutral excess across buckets.

## Result
- **`eigen UP + confirmed uptrend` is a valid momentum long** — strongest in
  *expensive* (overvalued) names, consistent with momentum/ignition behavior.
- **`undervalued + uptrend` is a separate, weaker value-long** — works, but it's a
  different animal (value catching a bid), not the eigen momentum effect.
- **Combining eigen with undervaluation KILLS the momentum edge.** Requiring a name
  be cheap filters out exactly the expensive momentum names where eigen-UP pays.

## Conclusion
Don't fuse the two. Treat **eigen-UP + uptrend** as a momentum long (let it run
expensive) and **undervalued + uptrend** as a separate value long. Forcing both
conditions at once produces the worst of both. This is why the live board keeps
eigen and valuation as independent legs rather than a single AND-gate.
