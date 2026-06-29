# Eigen + undervalued + bearish crowd — not testable pre-2026; shipped as a live watch

- Date: 2026-05-31
- Question: Is a cheap (DCF-undervalued) name where the crowd has turned bearish
  (capitulation) and eigen flags an idiosyncratic down-move marking a contrarian
  bottom?
- Script: `backend/scripts/run_eigen_crowd_study.py`
  (layers PIT crowd sentiment onto `eigen_valuation_obs.csv`)
- Data: `social-intelligence.sqlite` → `social_post_sentiment`; crowd mood = net
  bull share of directional posts over a trailing 45d window. Two reads: bearish
  LEVEL (≤0.45) and bearish FLIP (was ≥0.55, now ≤0.45).

## Method
For each (symbol, T) compute the trailing crowd mood and bucket the eigen/undervalued
observations by bearish level / flip; measure the stored forward market-neutral excess.

## Result
- **Inconclusive — historical social coverage is too thin.** Through 2024–2025 the
  directional-post counts per symbol are too sparse to reliably classify "bearish
  crowd" point-in-time. The data only becomes dense enough from **2026** onward
  (the live board now sees ~4,000 symbols with crowd coverage).

## Conclusion
Not yet backtestable. **Decision: track it forward (live)** rather than drop it.
Implemented as the **`BOTTOM?` contrarian watch** on the convergence board
(undervalued + eigen-down + bearish/flipped crowd), with an append-only forward
ledger (`mi_contrarian_watch`) capturing every fire with entry price + legs so we
can compute forward returns once the dense 2026+ data matures.
See related: `run_eigen_perturbation_lab.py` (assess_contrarian_watch).
