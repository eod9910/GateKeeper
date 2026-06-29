# PAY (Paymentus) case study — euphoric narrative vs DCF, and the DCF won

- Date: 2026-05-31 (case T = 2025-11-04)
- Question: Pick a past eigen spike where the narrative and the DCF disagreed, run it
  forward, and see who was right. (The qualitative dry-run of the whole funnel.)
- Data: `run_eigen_replay_study.py` / eigen lab (eigen + eigen-volume), PIT DCF,
  `backend/data/universe/PAY_1d.csv`. Sibling to the VIAV paper.

## Setup at T (2025-11-04)
- **Eigen-price spike +6.82σ** with euphoric narrative — a strong idiosyncratic up-move
  getting loud crowd attention.
- **DCF: ~−48% overvalued** — the valuation engine flatly contradicted the euphoria.
- Classic divergence: narrative/price screaming up, business-evidence saying too rich.
- Entry reference close: **$36.10**.

## What happened forward
| Horizon | Close | Raw return |
|---|---:|---:|
| 1mo (2025-12-04) | $36.50 | +1.1% |
| **3mo (2026-02-05)** | **$24.37** | **−32.5%** |
| 6mo (2026-05-07) | $27.85 | −22.9% |
| now (2026-05-29) | $23.49 | −34.9% |

Market-neutral, the 3-month underperformance was ~**−38%** (the original case figure).

## Conclusion
**The DCF's overvaluation call beat the euphoric narrative**, decisively, within 3
months. The eigen spike marked attention/ignition, not durable value; the crowd
euphoria was a contra-tell. This is the short-side twin of the thesis: when an eigen
move + euphoric narrative collides with a clearly overvalued DCF, lean with the DCF
(fade), not the crowd. PAY is the historical proof-of-concept that the live **fade
composite** is built to catch — and it generalizes the same pattern later seen on VIAV.
