# Research Studies

Findable, durable write-ups ("papers") of the research we run against the
pattern-detector data. **Scripts stay in `backend/scripts/`** — this folder holds
the *results* and *conclusions* so we can pull them back up later without
re-deriving them from memory or stdout.

## Convention

When we run a study:

1. The script lives in `backend/scripts/run_*_study.py` (or an ad-hoc probe).
2. Write a **paper** here: `YYYY-MM-DD-short-slug.md`.
3. The paper **links back to the script(s)** that produced it (relative path),
   and records: the question, method, data window, result (with numbers), and
   the conclusion / what we decided to do about it.
4. Scripts mostly print to stdout (no saved artifact), so the paper IS the
   record of the result. Paste the key numbers into the paper.

## Paper template

```
# <Title> — <verdict in one line>
- Date: YYYY-MM-DD
- Question: <what we were trying to learn>
- Script(s): backend/scripts/run_xxx_study.py
- Data: <universe, date window, benchmark>

## Method
## Result   (numbers / tables)
## Conclusion   (what it means + what we changed)
```

## Index

| Paper | Question | Script | Verdict |
|-------|----------|--------|---------|
| [2026-05-31-viav-uptick-attribution.md](./2026-05-31-viav-uptick-attribution.md) | What caused VIAV's +629% uptick? | `run_eigen_perturbation_lab.py` + `fundamentals-pit.sqlite` | Not earnings — a real but small revenue kernel blown into a narrative/multiple overshoot; now a STRONG **FADE** candidate (incl. $19.5M insider selling). |
| [2026-05-31-dcf-funnel.md](./2026-05-31-dcf-funnel.md) | Does "undervalued → bullish narrative → insider buying" work? | `run_dcf_funnel_study.py` | No — bullish-narrative hurt; **contrarian "undervalued + bearish" beat it**. |
| [2026-05-31-eigen-crowd-contrarian.md](./2026-05-31-eigen-crowd-contrarian.md) | Eigen + undervalued + bearish crowd = bottom? | `run_eigen_crowd_study.py` | **Not testable pre-2026** → shipped as the live `BOTTOM?` watch + forward ledger. |
| [2026-05-31-overvaluation-z-fade-sharpening.md](./2026-05-31-overvaluation-z-fade-sharpening.md) | Does stacking overvalued + stretched + euphoric sharpen the fade? | `overvaluation_z_obs.csv` | Yes — each leg drives 3mo excess down; full triple **−4.3%** (t −2.2). Backbone of the fade composite. |
| [2026-05-31-crowd-flip-capitulation.md](./2026-05-31-crowd-flip-capitulation.md) | Does a bull→bear crowd flip mark a bottom? | ad-hoc PIT | **No — falling knife**; flip precedes more downside, worst on extreme DCF gaps. |
| [2026-05-31-pay-case-study.md](./2026-05-31-pay-case-study.md) | Eigen spike + euphoria vs DCF overvalued — who won? | `run_eigen_replay_study.py` + DCF | **DCF won**: PAY −32.5% at 3mo (~−38% market-neutral). Short-side proof-of-concept. |
| [2026-05-27-bases-dont-work.md](./2026-05-27-bases-dont-work.md) | Can we find bases and buy the breakout? | `run_base_method_suite.py` | **No** — detector caught tops not bases, no edge; salvage = volume confirmation. |
| [2026-05-30-eigen-long-momentum.md](./2026-05-30-eigen-long-momentum.md) | Is eigen a long signal? | `run_eigen_long_study.py` | `eigen UP + uptrend` = momentum long; **undervaluation kills it** (separate value long). |
| [2026-05-30-narrative-lead.md](./2026-05-30-narrative-lead.md) | Does narrative lead price? | `run_narrative_lead_study.py` | **No** significant leading edge; substance ≈ hype; narrative ≈ coincident. Use as discriminator only. |
| [2026-05-31-valuation-strategy-and-model-portfolio.md](./2026-05-31-valuation-strategy-and-model-portfolio.md) | Does trading the DCF gap (long/short + sleeve portfolio) work? | `run_valuation_signal_strategy.py`, `run_valuation_gap_model_portfolio.py` | Long edge = **beta + right-skew**; short side **loses/blows up**; reliability guard defused the tail (worst formation −141%→−21%); but it only **matched cap-wt SPY** (`run_benchmark_buyhold_compare.py`). |
| [2026-06-01-risk-managed-portfolio-sim.md](./2026-06-01-risk-managed-portfolio-sim.md) | Does $100k + 3% sizing + 20% stop beat buy-and-hold SPY? | `run_valuation_portfolio_sim.py` | **No — strictly worse**: +9% vs +22% CAGR AND deeper drawdown (−31% vs −25%). 20% stop whipsawed (62% stop-out); stops are wrong for a mean-reverting value signal. |
| [2026-06-01-full-convergence-stack.md](./2026-06-01-full-convergence-stack.md) | Does the full convergence stack beat SPY? | `run_full_convergence_stack_study.py` | **Not certified**: 6mo fails, shorts fail, 1yr mean beats only via right-tail skew while median top baskets lose to SPY. Use as watchlist/ranking, not autonomous portfolio. |
| [2026-06-01-speculative-spike-exits.md](./2026-06-01-speculative-spike-exits.md) | Can exits make Rule A spike candidates tradable? | `run_speculative_spike_backtest.py` | **Tiny event sleeve only**: ladder/trail works on all names (+23% avg), but edge fades with liquidity and no-split filters; not a core strategy. |
| [2026-06-01-revenue-to-earnings-followthrough.md](./2026-06-01-revenue-to-earnings-followthrough.md) | Are investors front-running future earnings after revenue re-acceleration? | `run_revenue_to_earnings_followthrough.py` | **Partly yes**: some winners later improved earnings/margins, but DBGI-style spikes did not; future earnings follow-through is confirmation, not the whole edge. |
| [2026-06-01-eigen-ablation-reacceleration.md](./2026-06-01-eigen-ablation-reacceleration.md) | Does depressed + revenue re-acceleration need eigen? | ad-hoc using `run_convergence_winner_attribution.py` | **Eigen sharpens, not required**: no-eigen screen expands 15→38 6M candidates and still beats SPY; eigen improves median and beat rate. |
| [2026-05-30-valuation-gap-accuracy.md](./2026-05-30-valuation-gap-accuracy.md) | Is the PIT DCF gap directionally informative? | `run_valuation_gap_accuracy_study.py` | Weak (acc 0.51–0.55); **overvalued-short is the cleaner half**. Use as a leg, not alone. |
| [2026-05-29-eigen-valuation-deciles.md](./2026-05-29-eigen-valuation-deciles.md) | Valuation deciles + eigen conditioning | `run_eigen_valuation_study.py` | Valuation alone weak/non-monotonic; **eigen = momentum, not a fade sharpener**. |
| [2026-05-28-breakout-volume.md](./2026-05-28-breakout-volume.md) | Do breakouts want volume? | `run_breakout_volume_study.py` | Yes — **Real Volume (eigen)** best separates winners from losers → wired into board. |
| [2026-05-10-eigen-replay.md](./2026-05-10-eigen-replay.md) | Do eigen residual movers continue or revert? | `run_eigen_replay_study.py` | **UP residuals = momentum longs (pf 3.1 @120d); DOWN residuals are NOT shorts** (pf 0.25). |
| [2026-04-09-consumer-cycle-categories.md](./2026-04-09-consumer-cycle-categories.md) | Which consumer categories are cyclical? | `run_consumer_cycle_category_study.py` | Reference classification (FRED/BEA): ~37% of PCE cyclical, ~61% stable. Not a trade signal. |
| [2026-04-05-financial-factor-comparison.md](./2026-04-05-financial-factor-comparison.md) | Which PIT financial factors inform direction? | `run_financial_factor_comparison_study.py` | **Earnings growth/ROE > DCF gap** at 3mo (small sample — directional only). |
