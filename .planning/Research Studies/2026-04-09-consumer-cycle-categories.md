# Consumer-cycle category classification — which spending categories are cyclical (FRED/BEA)

- Date: 2026-04-09
- Question: Classify consumer spending categories by how cyclical they are
  (expansion vs recession growth behavior), as a reference layer for the Consumer
  Cycle page — not a tradable signal.
- Script: `backend/scripts/run_consumer_cycle_category_study.py`
- Output: `backend/data/research/consumer_cycle_category_study.latest.md/.json`
- Data: official FRED/BEA quarterly chain-type quantity indices; recession quarters
  flagged with `USRECQ`; real PCE share reference `PCECC96`.

## Method
For each category compute quarterly YoY growth, split expansion vs recession quarters,
take the spread, and bucket:
- **highly_cyclical**: spread ≥ 6.0 pp
- **mildly_cyclical**: spread ≥ 3.0 pp
- **stable**: spread < 3.0 pp or still grows through recessions (+ a stable guardrail)

## Result (latest real-PCE shares)
| Bucket | Categories | ~Share of real PCE |
|---|---:|---:|
| Highly cyclical | 5 | 16.3% |
| Mildly cyclical | 4 | 20.7% |
| Stable | 6 | 61.4% |

So ~37% of consumer spend is cyclical (the highly + mildly buckets), ~61% is stable
— the bulk of PCE is defensive.

## Conclusion
A **reference/classification artifact**, not a trading signal: it tags which consumer
categories swing with the cycle so the Consumer Cycle page can weight/segment names
by cyclicality. Refreshable from FRED on demand. No forward-return claim attached.
