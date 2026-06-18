# Revenue To Earnings Follow-Through - partial support, not the whole story

- Date: 2026-06-01
- Question: Are investors front-running future earnings after depressed stocks show revenue re-acceleration?
- Script: `backend/scripts/run_revenue_to_earnings_followthrough.py`
- Data: Rule A candidates from `full_convergence_stack_obs.csv`, PIT quarterly fundamentals, daily forward returns

## Method

Rule A signal:

- `eigen_z >= 2`
- `range_pos_252d <= 0.10`
- `revenue_ttm_growth_pct >= 17.7`

The signal uses only point-in-time data available at the signal date. The study then looks at the next four subsequently available quarterly reports and checks:

- whether net income becomes positive
- whether net income improves
- whether net margin improves by at least 10 percentage points
- whether FCF becomes positive or improves
- whether the signal was a "front-run confirmed" case: revenue re-accel while net margin is negative or missing, followed by future net income/margin/operating-margin improvement

## Result

| Group | Count | 6M avg | 6M median | 6M beat SPY | 1Y avg | 1Y median | 1Y beat SPY |
|---|---:|---:|---:|---:|---:|---:|---:|
| All Rule A | 15 | +46.8% | +21.5% | 66.7% | +567.3% | +18.0% | 54.5% |
| Entry net margin already positive | 3 | +12.9% | +21.5% | 66.7% | +7.2% | +11.0% | 33.3% |
| Entry net margin negative/missing | 12 | +55.2% | +20.7% | 66.7% | +777.3% | +20.4% | 62.5% |
| Future net income becomes positive | 7 | +24.7% | +21.5% | 71.4% | -4.3% | +5.9% | 33.3% |
| Future net income improves | 12 | +16.4% | +20.5% | 66.7% | +680.2% | +14.5% | 50.0% |
| Future net margin improves >=10pp | 7 | +29.7% | +55.8% | 71.4% | +1077.7% | +0.8% | 40.0% |
| Front-run confirmed | 11 | +15.9% | +19.4% | 63.6% | +775.8% | +18.0% | 57.1% |
| Front-run not confirmed | 4 | +131.7% | +23.1% | 75.0% | +202.3% | +16.3% | 50.0% |

## Key Cases

| Symbol | Signal date | 6M | 1Y | What happened |
|---|---:|---:|---:|---|
| DBGI | 2024-12-31 | +488.0% | +787.3% | No earnings follow-through; likely anticipation/squeeze, not confirmed operating leverage. |
| CTKB | 2025-05-30 | +104.0% | N/A | Net income turned positive and improved; clean front-run candidate. |
| GWH | 2025-05-30 | +61.8% | N/A | Net income improved from an extremely bad base, but remained negative. |
| LIVE | 2024-10-31 / 2024-11-29 | +19.4% / +57.2% | +22.7% / +0.8% | Net income turned positive and margins improved. |
| CMCT | 2024-12-31 | +55.8% | +5500.0% | Margins improved from weak levels, but this remains a corporate-action/event-style outlier. |
| TXG / SG / VELO | various | losses | losses | Future improvement signals existed but did not protect the trade. |

## Conclusion

The user hypothesis is **partly right**:

> Investors do appear to bid some depressed revenue-reacceleration names before earnings visibly recover.

But it is not the whole edge:

- Positive earnings at entry was not the trigger.
- Future earnings improvement helped some cases, especially the cleaner median winners.
- The biggest spike winner, DBGI, had no earnings follow-through.
- Several losers also showed later improvement, so "future earnings improves" is not enough by itself.

Practical interpretation:

- Revenue re-acceleration is the trigger.
- Earnings/margin follow-through is a confirmation path, not a prerequisite.
- The strategy needs to separate:
  - **operating leverage rebounds**: revenue up, margins later improve, survivable balance sheet
  - **anticipation/squeeze spikes**: revenue up, price spikes before fundamentals validate
  - **false positives**: revenue up but equity still loses because balance sheet, margins, or expectations remain bad

Next useful feature: an "operating leverage runway" score combining revenue growth, gross/operating margin direction, FCF burn, current ratio, dilution, and debt/equity stub risk.
