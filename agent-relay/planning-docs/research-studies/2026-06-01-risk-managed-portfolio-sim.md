# Risk-managed valuation portfolio — stops + position sizing made it WORSE than SPY

- Date: 2026-06-01
- Question: If we run the DCF-undervalued long signal as a *real* book — $100k, fixed 3%
  position sizing, a 20% stop-loss, long-only — with proper risk management, does it finally
  beat buy-and-hold SPY? (Follow-up to the finding that the unmanaged model portfolio merely
  matched SPY beta.)
- Script: `backend/scripts/run_valuation_portfolio_sim.py`
- Output: `backend/data/research/valuation_portfolio_sim.json`
- Design: event-driven daily equity curve (not trade-aggregation). Start $100,000; long-only
  DCF-undervalued (gap > +20%, reliability guardrail applied point-in-time); 3% of current
  equity per position (=> up to ~33 names); 20% hard stop checked intrabar on the daily low
  (conservative fill at the stop); max hold 252 bars (~1yr) then close; monthly formations fill
  open slots ranked most-undervalued first. Full `clean_stocks` universe (4,302 names, 1,586
  ever held), 2021-03-15 → 2026-05-29. **Transaction costs / slippage not modeled.**

## Result

| Metric | Risk-managed portfolio | **SPY buy & hold** |
|---|---:|---:|
| Final equity (from $100k) | $136,497 | **$204,432** |
| Total return (~5.2 yr) | +36.5% | **+104.4%** |
| CAGR | +9.1% | **+22.1%** |
| Max drawdown | **−31.3%** | −24.5% |

Trade stats: 248 entries, **154 stopped out (62%)**, 94 closed at horizon, avg trade +6.8%.

## What happened — risk management *hurt* on both axes

- **Worse return AND worse drawdown.** Stops are supposed to trade some return for lower
  drawdown. Here we got *less* return (9% vs 22% CAGR) *and* a *deeper* drawdown (−31% vs
  −25%). That's a strict loss on both dimensions.
- **The 20% stop whipsawed — 62% stop-out rate.** Beaten-down "undervalued" value names are
  exactly the volatile, mean-reverting names that dip 20% and recover. The stop sold the
  bottom on ~6 of every 10 positions, locking in −20% and then missing the bounce.
- **Cash drag.** A stopped-out slot sits in cash until the next monthly formation, so the book
  was chronically under-invested during the strongest recovery legs.
- **Wrong-tilt era.** 2021–2026 was a growth/mega-cap-led market; a value-undervalued tilt
  structurally lagged the cap-weighted index regardless of risk management.

## Conclusion

"Real" risk management (position sizing + a 20% stop) did **not** rescue the valuation signal —
it made it strictly worse than just buying SPY. A hard stop on a **mean-reverting value
signal** is counterproductive: it converts temporary drawdowns into realized losses and then
sits in cash through the recovery. This is the cleanest confirmation yet that:

1. The DCF-undervalued long is **not** a standalone edge — it's a lagging value tilt that
   trailed the index over this regime.
2. Stops belong on **momentum / trend** signals (cut losers, let winners run), not on a
   contrarian value signal where the thesis *is* "it fell too far."

Practical takeaway: do not run valuation-undervalued as a stop-managed standalone book. If
valuation is used, it must be a **confirming leg** inside the convergence stack, and any stop
logic should be attached to the trend/structure signal, not the value gap.

## Stop-level sweep — decomposing stop-drag vs signal-drag

Candidate observations are now cached (`valuation_portfolio_candidates.json`) so stop levels
sweep in seconds. Same $100k / 3% / monthly / 1-yr-hold book, varying only the stop:

| Stop | Final $ | Total % | CAGR % | Max DD % | Stopped-out % |
|---|---:|---:|---:|---:|---:|
| 20% | $136,497 | +36.5 | +9.07 | −31.3 | 62.1 |
| 30% | $133,887 | +33.9 | +8.48 | −38.2 | 44.2 |
| 40% | $158,658 | +58.7 | +13.75 | −26.5 | 25.0 |
| 50% | $181,182 | +81.2 | +18.04 | −25.6 | 13.1 |
| **no stop** | $183,037 | +83.0 | **+18.37** | −27.0 | 0.0 |
| **SPY B&H** | $204,432 | +104.4 | **+22.08** | −24.5 | — |

### Two clean conclusions

1. **The stop was actively destroying return — monotonically.** Tighter = worse. The 20%
   stop earned +9.1% CAGR; removing it earned +18.4%. **The stop cost ~9.3%/yr.** It also did
   *not* improve drawdown (−31% stopped vs −27% unstopped; the 30% stop was the worst at −38%).
   This is definitive: a hard stop on a mean-reverting value signal sells the bottom and sits
   in cash through the recovery. Do not stop value.
2. **Even with no stop, value still lost to SPY by ~3.7%/yr** (+18.4% vs +22.1% CAGR) with a
   slightly deeper drawdown (−27% vs −24.5%). So the ~13% CAGR gap of the original 20%-stop run
   decomposes into **~9.3% self-inflicted stop-drag + ~3.7% genuine value-tilt drag** over this
   growth-led 2021–26 regime.

## Revised conclusion

"Real" risk management didn't rescue the strategy — and the sweep shows *why*: the stop was
the single biggest drag, and even the best (unmanaged, fully-invested) version is just
**closet-SPY-minus-a-few-points**. The DCF-undervalued long is not a market-beating standalone
book in any stop configuration. Confirmed, with the mechanism isolated:

- Stops belong on momentum/trend, never on a contrarian value gap.
- Beating SPY requires a *better entry signal* (the full convergence stack) or a momentum
  overlay — not risk management bolted onto a lagging value tilt.

Next logical test: benchmark the **full convergence stack** (eigen + price-extension + crowd +
insider + thesis), the thing that's actually supposed to have edge, head-to-head vs SPY B&H.
