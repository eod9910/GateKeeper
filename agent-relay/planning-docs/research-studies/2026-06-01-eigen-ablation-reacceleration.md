# Eigen Ablation For Revenue Re-Acceleration - eigen sharpens but is not required

- Date: 2026-06-01
- Question: What happens if we drop the eigen requirement from the depressed + revenue re-acceleration rule?
- Script: ad-hoc Python using `run_convergence_winner_attribution.py`
- Data: bullish full-convergence observations, PIT fundamentals, daily forward returns

## Method

Compare:

- Baseline bullish convergence observations.
- Depressed only: `range_pos_252d <= 0.10`.
- Revenue only: `revenue_ttm_growth_pct >= 17.7`.
- No-eigen rule: `range_pos_252d <= 0.10 + revenue_ttm_growth_pct >= 17.7`.
- Rule A: `eigen_z >= 2 + range_pos_252d <= 0.10 + revenue_ttm_growth_pct >= 17.7`.
- Quality versions of both.

## Result

### Six-month horizon

| Rule | N | Symbols | Avg | Median | Avg vs SPY | Median vs SPY | Beat SPY |
|---|---:|---:|---:|---:|---:|---:|---:|
| Bullish convergence | 382 | 325 | +7.4% | +1.9% | -2.3% | -8.7% | 39.3% |
| Depressed only | 179 | 152 | +9.8% | +0.8% | -0.6% | -12.8% | 38.0% |
| Revenue only | 84 | 68 | +8.5% | +3.2% | -0.4% | -8.9% | 40.5% |
| Depressed + revenue, no eigen | 38 | 29 | +19.2% | +9.8% | +9.6% | +1.9% | 50.0% |
| Rule A with eigen | 15 | 14 | +46.8% | +21.5% | +38.5% | +15.5% | 66.7% |
| Depressed + revenue + quality, no eigen | 11 | 8 | -8.1% | +1.6% | -20.0% | -18.2% | 18.2% |
| Rule A + quality | 3 | 3 | -16.7% | -17.5% | -28.2% | -24.0% | 33.3% |

### One-year horizon

| Rule | N | Symbols | Avg | Median | Avg vs SPY | Median vs SPY | Beat SPY |
|---|---:|---:|---:|---:|---:|---:|---:|
| Bullish convergence | 175 | 163 | +52.2% | +8.1% | +32.6% | -11.7% | 38.9% |
| Depressed only | 94 | 86 | +76.0% | +5.4% | +56.6% | -13.6% | 36.2% |
| Revenue only | 30 | 27 | +223.9% | +19.7% | +204.3% | +2.6% | 53.3% |
| Depressed + revenue, no eigen | 19 | 16 | +335.7% | +18.0% | +316.3% | +2.5% | 52.6% |
| Rule A with eigen | 11 | 10 | +567.3% | +18.0% | +550.5% | +2.5% | 54.5% |
| Depressed + revenue + quality, no eigen | 4 | 3 | +47.5% | +49.8% | +23.9% | +24.8% | 100.0% |
| Rule A + quality | 1 | 1 | +24.5% | +24.5% | +10.1% | +10.1% | 100.0% |

## Symbols Added By Dropping Eigen

Six-month no-eigen symbols added:

`ACTG, ATEX, BTMD, DSP, EEX, ENOV, GSHD, MANH, PDFS, RYAN, TRDA, TW, VERX, VRNS, WHD`

One-year no-eigen symbols added:

`ACTG, BTMD, EEX, MANH, PDFS, WHD`

## Conclusion

Eigen is **not required** for the depressed + revenue re-acceleration idea to have signal.

What eigen does:

- reduces six-month candidates from 38 to 15
- improves six-month median from +9.8% to +21.5%
- improves six-month SPY beat rate from 50.0% to 66.7%
- concentrates the right-tail outliers

What dropping eigen does:

- gives a larger sample
- still beats SPY on average and median at the combined depressed + revenue layer
- may be more useful as a broad watchlist filter before ranking

Practical decision:

- Use **depressed + revenue re-acceleration** as the core discovery screen.
- Use eigen as a **ranking/urgency amplifier**, not a mandatory gate.
- Next test should rank no-eigen candidates by operating-leverage runway, balance-sheet risk, dilution, and event/squeeze tags.
