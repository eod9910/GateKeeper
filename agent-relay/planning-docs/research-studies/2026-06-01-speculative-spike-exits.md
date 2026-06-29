# Speculative Spike Exits - tradable only as a tiny event bucket

- Date: 2026-06-01
- Question: If Rule A finds squeeze/rebound candidates, can exits make it tradable?
- Script: `backend/scripts/run_speculative_spike_backtest.py`
- Data: Rule A candidates from `full_convergence_stack_obs.csv`, daily OHLCV in `backend/data/universe`, SPY benchmark

## Method

Rule A candidate:

- `eigen_z >= 2`
- `range_pos_252d <= 0.10`
- `revenue_ttm_growth_pct >= 17.7`

Trade simulation:

- Entry: next daily open after the monthly signal date.
- Exit configs tested:
  - ladder + trailing stop
  - trailing stop only
  - max-hold only
- Hold windows tested: 21, 63, and 126 trading days.
- Main ladder: sell 33% at +50%, 33% at +100%, 34% at +200%.
- Main risk: initial stop -50%, trailing stop 35% after +50% runup.
- Liquidity filter: default median 63-day dollar volume >= $250k and entry price >= $0.50.
- Reverse-split / corporate-action handling: no clean local corporate-actions table exists, so the study reports a PIT adjusted-price distortion/gap proxy:
  - pre-entry max close / entry close >= 100, or
  - pre-entry absolute open gap >= 8x.

Important caveat: this is a small sample. Treat it as strategy triage, not a certified edge.

## Result

Main exit policy: `ladder_trail_126d`, all Rule A candidates:

| Metric | Value |
|---|---:|
| Trades | 15 |
| Avg return | +23.4% |
| Median return | +21.3% |
| Win rate | 80.0% |
| Avg SPY | +5.0% |
| Avg vs SPY | +18.5% |
| Median vs SPY | +20.6% |
| SPY beat rate | 73.3% |
| Best / worst | +117.5% / -50.0% |

But the result deteriorates under more executable filters:

| Universe | N | Avg return | Median return | Avg vs SPY | SPY beat |
|---|---:|---:|---:|---:|---:|
| All Rule A | 15 | +23.4% | +21.3% | +18.5% | 73.3% |
| Liquid >= $250k | 9 | +9.4% | +18.4% | -0.1% | 55.6% |
| Liquid, no split proxy | 8 | +8.3% | +11.7% | -2.0% | 50.0% |
| Split-proxy only | 3 | +36.9% | +23.0% | +33.1% | 100.0% |
| Liquid >= $1M, no split proxy | 6 | +7.1% | +1.7% | -4.3% | 50.0% |
| Liquid >= $5M, no split proxy | 5 | -7.6% | -18.0% | -18.2% | 40.0% |

Main 126-day ladder/trail trade list:

| Symbol | Signal date | Return | SPY | Exit | Max runup | Split proxy |
|---|---:|---:|---:|---|---:|---|
| CMCT | 2024-12-31 | +117.5% | +1.0% | all targets hit | +565.5% | No |
| CTKB | 2025-05-30 | +80.9% | +16.1% | max hold | +123.1% | No |
| VELO | 2024-09-30 | +69.4% | +2.6% | trailing stop | +143.8% | Yes |
| ATRC | 2024-04-30 | +46.4% | +16.4% | max hold | +52.0% | No |
| GWH | 2025-05-30 | +23.0% | +6.1% | trailing stop | +68.8% | Yes |
| DBGI | 2024-12-31 | +18.4% | +2.9% | trailing stop | +82.1% | Yes |
| SG | 2025-06-30 | -50.0% | +11.8% | stop | +18.6% | No |

## Conclusion

This does **not** certify a robust standalone strategy.

The honest reading:

- Hard exits can prevent the worst round-trip behavior.
- The best-looking results still depend heavily on event/split-style names and very small samples.
- As liquidity gets stricter, the edge mostly disappears.
- Removing the split-proxy bucket also weakens the result.
- The spike process is not a fundamental long strategy and should not use DCF undervaluation as an entry requirement.

Practical decision:

- Keep this as a **tiny speculative event sleeve**, not a core portfolio sleeve.
- Use DCF/risk flags as labels and sizing warnings, not as entry vetoes for this sleeve.
- Require hard exits:
  - next-open entry only
  - +50/+100/+200 ladder
  - trailing stop after +50% runup
  - max hold no longer than 126 trading days
  - explicit liquidity and corporate-action tags
- Do not deploy until the sample is expanded and corporate-actions data is made explicit rather than inferred.
