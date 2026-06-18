# Valuation signal strategy & model portfolio — long edge is mostly beta/skew, short side is a blow-up

- Date: 2026-05-31
- Question: If we trade the DCF valuation gap as an actual rule — long undervalued,
  short overvalued — does it behave like a tradable strategy? And does a fixed
  cap-tiered sleeve portfolio built on it produce a respectable 1-year track record?
- Scripts:
  - `backend/scripts/run_valuation_signal_strategy.py`
  - `backend/scripts/run_valuation_gap_model_portfolio.py`
  - (both sit on top of `backend/scripts/run_valuation_gap_accuracy_study.py`)
- Outputs:
  - `backend/data/research/valuation_signal_strategy_summary.json`
  - `backend/data/research/valuation_gap_model_portfolio.json`
- Data: full `clean_stocks` universe (~4k names), monthly formations 2020→2025
  (51 formation dates), 252-bar (~1yr) holds, no stops. **Raw single-name returns —
  NOT market-neutral / beta-loaded over a bull market.**

## Run 1 — Valuation signal strategy (113,033 trades)
Long = DCF undervalued (gap > +20%); Short = DCF overvalued (gap < −20%); equal-weight
per formation; held to horizon (all exits were horizon-close — no stops fired).

| Bucket | Trades | Avg | Median | Win rate |
|---|---:|---:|---:|---:|
| Overall | 113,033 | +3.7% | +6.1% | 56% |
| **Long (undervalued)** | 40,560 | **+15.8%** | +3.7% | 54% |
| **Short (overvalued)** | 72,473 | **−3.1%** | +7.4%¹ | 58% |
| Formation-level (portfolio of the month) | 51 | +4.2% | +6.1% | 67% |

¹ For shorts, positive return_pct = profitable short; median is positive but the **mean
is negative** because of unbounded left tail.

- **Long works only through fat tails.** Avg +15.8% vs median +3.7% — carried by a few
  moonshots (best +6757%, AMR +531%). Typical undervalued name ≈ +3.7%/yr.
- **Short is a trap.** Avg −3.1% despite 58% nominal win rate; worst single short
  −22,510% (a name that ran ~225x). Classic short asymmetry.
- No stops were applied — this is the unmanaged version, exactly where short blow-ups
  hurt most.

## Run 2 — Model portfolio (51 monthly formations)
Fixed sleeves: 40% large-cap undervalued long, 30% small-cap undervalued long,
20% micro-cap overvalued short, 10% cash. ≤4 names/sleeve, held 1 year.

| Metric | Value |
|---|---:|
| Formations | 51 |
| Avg 1-yr return | **+15.4%** |
| Median 1-yr return | +11.4% |
| Win rate (formations green) | **82%** |
| Best formation | +99.6% |
| Worst formation | **−141.7%** |

- Headline looks strong, but it's **70% long in a 2020–25 bull market** — most of the
  +15% is beta on the undervalued-long sleeves, not valuation alpha.
- **Short sleeve = the time bomb.** The −141.7% worst formation requires a ~5%-weight
  micro short (e.g. WATT) to run **+300%** in a year. The short sleeve adds catastrophic
  tail risk, not edge.
- **Micro/small DCF gaps are numerically garbage** and contaminate selection: TYGO gap
  +57,390% (fair value $466 vs price $0.81), RFL gap −18,550,723% (fair value
  −$289,053). On illiquid names the DCF is meaningless, so the sleeves partly select on
  broken model output.

## Conclusion
Consistent with `2026-05-30-valuation-gap-accuracy.md`: the DCF gap is a **weak
standalone signal**.
- Undervalued-long: positive but skew-driven and largely beta — real, mild, not precise.
- Overvalued-short: unmanaged, it loses on average and blows up in the tail.
- The model portfolio's nice-looking +15.4%/82% is **beta + right-skew + a hidden tail
  bomb**, not a robust valuation edge.

Practical takeaway: keep DCF gap as a **confirming leg**, never a primary trigger —
especially on the short side, where it must be paired with the confirmation stack
(price ≥2σ stretched + euphoric crowd + insider selling) and a fade-timing trigger
before it's actionable. Filter out micro-cap / extreme-gap DCF outputs as unreliable.

## Addendum — 2026-06-01: re-run with the reliability guardrail

After the micro-cap valuation fix (relative-multiples engine + reliability guardrail), we
ported the same guardrail into the backtest PIT path (`run_valuation_gap_accuracy_study._evaluate_symbol`,
new `reliability_guard=True` flag passed by both strategy scripts) and re-ran. The guard
neutralizes a point-in-time observation to `unrated` (so the selectors skip it) when
**price < $1, market cap < $25M, or |gap| > 300%**. This directly tests whether the
micro-cap garbage was contaminating the original results.

### Signal strategy — before vs after guardrail

| Bucket | Trades (before→after) | Avg (before→after) | Median | Win rate |
|---|---|---|---|---|
| Overall | 113,033 → **100,408** | +3.7% → +4.1% | +6.1% → +6.3% | 56% → 57% |
| Long | 40,560 → **30,476** | +15.8% → **+11.6%** | +3.7% → +2.9% | 54% → 53% |
| Short | 72,473 → **69,932** | **−3.1% → +0.9%** | +7.4% → +7.8% | 58% → 58% |

- ~12,600 trades removed (~11%), including ~10k bogus "undervalued" micro longs.
- The long fat-tail shrank (avg +15.8% → +11.6%): part of the long edge was garbage moonshots.
- The short **mean flipped from −3.1% to +0.9%** — removing garbage shorts erased most of the
  average loss. But the single worst short is still ≈ −22,510% (a legit >$1 entry that ran ~225x):
  the unmanaged-short tail is inherent, not a valuation artifact.

### Model portfolio — before vs after guardrail

| Metric | Before | After |
|---|---:|---:|
| Avg 1-yr return | +15.4% | **+12.9%** |
| Median 1-yr return | +11.4% | +12.5% |
| Win rate | 82% | **88%** |
| Best formation | +99.6% | +39.2% |
| Worst formation | **−141.7%** | **−20.7%** |

- **The headline win: the short-sleeve time bomb is defused — worst formation −141.7% → −20.7%.**
  The garbage micro shorts (e.g. WATT +300%) that caused the −141.7% wipeout are gone.
- The right tail also shrank (best +99.6% → +39.2%): some "upside" was fake garbage-gap moonshots.
- What remains is an honest, long-biased ≈ +12.9%/yr, 88%-green portfolio — still mostly bull-market
  beta on the undervalued-long sleeves, but no longer a beta + skew + hidden-tail-bomb illusion.

### Revised conclusion
The reliability guardrail does what the original paper recommended: it removes the
numerically meaningless micro/extreme-gap DCF outputs from selection. It does **not**
manufacture a standalone edge — central tendency is essentially unchanged — but it makes
the track record honest by killing both the fake upside skew and, crucially, the
catastrophic short tail at the portfolio level. The original takeaway stands: DCF gap is a
confirming leg, not a primary trigger; the guardrail is now a permanent part of the
valuation pipeline (live snapshot) and the backtest path.

## Addendum 2 — 2026-06-01: did the portfolio beat buy-and-hold?

The only question that matters for a long-biased strategy run over a 2021–25 bull market:
did it beat just buying the index? Computed buy-and-hold returns over the **same 50 monthly,
1-year-hold windows** using the study's own bar loader / forward-return helper.

- Script: `backend/scripts/run_benchmark_buyhold_compare.py`

| Metric | Model portfolio (guarded) | **SPY** (cap-wt S&P 500) | RSP (equal-wt S&P 500) |
|---|---:|---:|---:|
| Avg 1-yr | +12.9% | **+12.91%** | +7.62% |
| Median 1-yr | +12.5% | +15.81% | +8.87% |
| Win rate | 88% | 80% | 76% |
| Best | +39.2% | +37.81% | +31.88% |
| Worst | −20.7% | −18.52% | −13.59% |

- **Vs the cap-weighted S&P 500 (SPY): it did NOT beat it.** Average return was identical to
  two decimals (+12.9% vs +12.91%), the **median was worse** (+12.5% vs +15.8%), and the
  **drawdown was deeper** (−20.7% vs −18.5%). You took single-name concentration + short-sleeve
  tail risk for the same return as SPY. The only edge was consistency (88% vs 80% green).
- **Vs the equal-weight S&P 500 (RSP): it beat it by ≈ +5.3%/yr** (+12.9% vs +7.6%). RSP is the
  fairer beta benchmark given the portfolio's small/micro tilt, so this ~5% is the closest thing
  to real alpha — but it is modest and carries the tail/concentration risk above.

**Verdict:** the portfolio is essentially SPY beta with a small-cap tilt. It matched the
cap-weighted index and modestly beat the equal-weight index. This is hard quantitative
confirmation of the paper's thesis — the DCF valuation gap is **not** a standalone alpha
engine; it earns its keep only as a confirming leg inside the convergence stack.
