# Full convergence stack vs SPY - not certified; only 1-year mean works, and it is skew

- Date: 2026-06-01
- Question: Does the full convergence stack - eigen residual + price extension + crowd mood
  + insider activity + thesis proxy - beat buy-and-hold SPY?
- Script: `backend/scripts/run_full_convergence_stack_study.py`
- Outputs:
  - `backend/data/research/full_convergence_stack_study.json`
  - `backend/data/research/full_convergence_stack_obs.csv`
  - sensitivity: `backend/data/research/full_convergence_stack_study.mcap300m.json`
- Data: monthly point-in-time formations from 2024-01-31 through 2025-11-28.
  Six-month horizon has 22 usable formation windows; one-year horizon has 16 usable
  formation windows. No transaction costs, slippage, borrow costs, or beta hedging modeled.

## Method

The study recomputes the stack on each historical formation date using only data available
at that date:

- eigen residual: rolling 120-day PCA residual z-score
- price extension: log-price z-score versus the stock's own historical trend
- crowd mood: trailing 45-day bullish share of directional social posts
- insider activity: trailing 45-day Form 4 net transaction value
- thesis proxy: deterministic substantive-post spike, z-scored against each symbol's own
  trailing 12-week baseline and signed by bullish/bearish sentiment

Important limitation: the LLM thesis extractor itself is not historically point-in-time, so
the thesis leg is a deterministic proxy. Minimum investability guardrails were applied in
the main run: price >= $1 and market cap >= $25M. A stricter $300M market-cap sensitivity was
also run.

## Main result - $25M market-cap floor

Coverage:

| Metric | Value |
|---|---:|
| Observations | 694 |
| Symbols | 527 |
| Formation dates with observations | 22 |
| Bullish / bearish | 382 / 312 |
| 3+ aligned-leg observations | 38 |
| 4+ aligned-leg observations | 2 |

### Six-month horizon: fails versus SPY

| Bucket / portfolio | N / windows | Avg return | Median return | Avg vs SPY | Median vs SPY |
|---|---:|---:|---:|---:|---:|
| Bullish observations | 382 | +7.4% | +1.9% | -2.3% | -8.7% |
| 3+ aligned legs | 38 | -5.2% | -3.4% | -10.9% | -12.5% |
| Bullish top-10 monthly basket | 22 | -0.2% | -2.9% | -9.4% | -12.2% |
| Bullish top-20 monthly basket | 22 | +1.2% | +3.8% | -7.9% | -8.2% |
| Bearish short top-10 basket | 22 | -8.7% | -2.7% | -17.8% | -17.6% |

Six-month verdict: no edge. The long side trails SPY; the short/fade side is actively bad.
The supposedly stronger 3+ leg subset is worse than the looser two-leg screen.

### One-year horizon: mean beats SPY, but median fails

| Bucket / portfolio | N / windows | Avg return | Median return | Avg vs SPY | Median vs SPY |
|---|---:|---:|---:|---:|---:|
| Bullish observations | 175 | +52.2% | +8.1% | +32.6% | -11.7% |
| 3+ aligned legs | 6 | -4.9% | +12.6% | +1.1% | -2.4% |
| Bullish top-10 monthly basket | 16 | +35.6% | -5.0% | +18.3% | -21.5% |
| Bullish top-20 monthly basket | 16 | +23.9% | -4.7% | +6.6% | -20.5% |
| Bearish short top-10 basket | 16 | -20.6% | -18.0% | -38.0% | -37.3% |

One-year verdict: not clean enough to certify. The average looks good because a few large
winners dominate; the median monthly basket loses badly to SPY and the win rate is only
31-38% for top baskets. This is a right-tail hunting signal, not a stable portfolio engine.

## $300M market-cap sensitivity

The stricter investability filter did not change the decision:

- Six-month bullish top-10: +0.5% average vs SPY +9.1%; median vs SPY -10.0%.
- One-year bullish top-10: +38.1% average vs SPY +17.3%, but median return -3.6% and
  median vs SPY -21.1%.
- Short/fade top-10 remained awful: -20.8% one-year average, -38.1% vs SPY.

## Conclusion

The full stack is **not certified** as a standalone SPY-beating strategy.

What survived:

- The bullish stack may be useful as a **right-tail discovery / candidate-ranking layer**.
  It can find big winners, especially at a one-year horizon.

What failed:

- It does not produce a reliable six-month edge.
- Higher alignment count does not improve outcomes in this run.
- The top-ranked basket has negative median excess versus SPY.
- The bearish/short side remains a trap.

Practical decision: keep the convergence stack as a research/watchlist engine, not as an
autonomous portfolio rule. The next improvement should not be "add more legs"; it should be
better ranking and risk controls for the bullish right-tail subset, plus a separate, stricter
fade-timing trigger before any short-side use.

## Follow-up: re-acceleration plus quality gate

After inspecting DBGI and CMCT, the important distinction is that the original
re-acceleration rule was finding **squeeze/rebound vehicles**, not necessarily investable
fundamental longs. The follow-up backtest added a PIT quality gate:

- current ratio >= 0.75
- shareholders' equity / market cap >= 0.10
- latest net margin >= -50%
- latest FCF margin >= -100%

Result:

| Rule | 6M N | 6M Avg | 6M Median | 6M Avg vs SPY | 1Y N | 1Y Avg | 1Y Median | 1Y Avg vs SPY |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rule A: eigen + washed-out + revenue re-accel | 15 | +46.8% | +21.5% | +38.5% | 11 | +567.3% | +18.0% | +550.5% |
| Rule B: Rule A + DCF undervalued | 0 | N/A | N/A | N/A | 0 | N/A | N/A | N/A |
| Rule C: Rule A + PIT quality gate | 3 | -16.7% | -17.5% | -28.2% | 1 | +24.5% | +24.5% | +10.1% |

Rule C survivors:

| Horizon | Symbol | Date | Return | SPY | Notes |
|---|---|---:|---:|---:|---|
| 6M | ATRC | 2024-04-30 | +22.0% | +16.6% | Passed quality gate; DCF overvalued |
| 6M | SG | 2025-06-30 | -54.4% | +11.7% | Passed quality gate; no PIT DCF rating |
| 6M | WEAV | 2025-10-31 | -17.5% | +6.4% | Passed quality gate; no PIT DCF rating |
| 1Y | ATRC | 2024-04-30 | +24.5% | +14.3% | Only full-window Rule C survivor |

Exclusion audit for the 15 six-month Rule A rows:

- 9 failed or lacked equity/market-cap support.
- 3 failed or lacked current-ratio support.
- 3 failed or lacked net-margin support.
- 2 failed or lacked FCF-margin support.
- CMCT and DBGI both failed the liquidity/equity-stub gate.

Conclusion: once we strip the obvious losers/fragile balance sheets, most of the historical
"edge" disappears. That is useful: it means DCF and risk flags were probably doing their job
for the fundamental-long version. The remaining edge, if any, must be treated as a separate
speculative squeeze process with explicit entry timing, liquidity controls, and exits.
