# Fundamental Research Lab PRD

Status: ACTIVE
Created: 2026-06-01
Updated: 2026-06-01
Owner: Research Studio / Market Intelligence
Checklist: fundamental-research-lab-checklist.md
Checklist: `fundamental-research-lab-checklist.md`

## Summary

Build a point-in-time fundamental backtester for testing whether fundamental signals actually predict forward returns. This should be separate from the current technical/pattern backtesting flow. The goal is to answer questions like: "If revenue accelerates while price is depressed, what happens next?" and "Does an EPS surprise improve the win rate?"

Current product direction: this is one research page with two explicit modes:

1. Fundamental Screener / Trade Outcome Tester.
2. Fundamental Portfolio Backtester.

The first tool answers: "Which symbols matched this rule, and what happened to each individual trade?"

The second tool answers: "If we allocated capital mechanically to this rule, did the portfolio beat SPY?"

Both modes must use the same point-in-time rule engine. The difference is not the signal definition; the difference is how selected symbols are evaluated. Screener mode treats each candidate as an independent trade observation. Portfolio mode turns the same candidates into a capital allocation process with position sizing, rebalance rules, cash, turnover, and an equity curve.

## Why This Matters

The app now has enough data to test real fundamental hypotheses instead of relying on intuition. We already have clean-universe membership, PIT fundamentals, earnings-report events, EPS and sales surprises, revenue growth, balance sheet metrics, liquidity, range position, price history, and SPY comparison data.

The risk is that single anecdotes can fool us. A fundamental research lab should force every idea through the same discipline: point-in-time data only, fixed entry rules, fixed exit rules, year-by-year performance, sample size checks, outlier checks, and benchmark comparison.

## Core User Question

"Given what we would have known on a specific date, which stocks passed this fundamental rule, and what happened afterward?"

## Two-Mode Product Contract

### Mode 1 - Fundamental Screener / Trade Outcome Tester

Purpose:

- Find individual symbols that matched a fundamental rule.
- Show the exact as-of date, entry date, exit date, return, benchmark-relative return, and exit reason for each match.
- Support discretionary research and symbol drilldown.
- Answer whether a rule produces interesting candidates, even before it becomes a portfolio strategy.

Primary outputs:

- Candidate table.
- Trade-level return distribution.
- Symbol/date drilldown.
- Win rate and trades beating benchmark.
- Average, median, best, worst, and outlier-adjusted returns.
- Time to first profit, max favorable excursion, and drawdown before exit.

This mode must not be described as a portfolio result. Its average return is an average of trades, not an investable equity curve.

### Mode 2 - Fundamental Portfolio Backtester

Purpose:

- Test whether the same rule can be traded mechanically as an investable strategy.
- Simulate capital allocation over a calendar range.
- Compare the resulting portfolio to SPY over the same period.
- Answer whether a rule is merely good at finding interesting names or actually works as a portfolio.

Primary outputs:

- Equity curve.
- Starting capital and ending capital.
- Total return, CAGR, max drawdown, volatility, exposure, turnover, and cash drag.
- Rebalance-by-rebalance holdings.
- Realized and unrealized P/L.
- SPY buy-and-hold benchmark over the same calendar window.
- Portfolio-relative alpha/underperformance versus SPY.

This mode is the only mode that can answer "did the strategy beat SPY as a portfolio?"

## Initial Hypotheses To Test

1. Depressed price plus revenue reacceleration.
2. Depressed price plus positive EPS surprise.
3. Depressed price plus positive sales surprise.
4. Depressed price plus revenue reacceleration plus positive EPS surprise.
5. Revenue reacceleration with poor balance sheet excluded.
6. Revenue reacceleration with reverse splits included versus excluded.
7. Revenue reacceleration with liquidity filters.
8. Revenue reacceleration with trailing stops and take-profit exits.

## Minimum Viable Page

Create a new research page or Research Studio mode called `Fundamental Research Lab`.

Implemented v1 page path:

- `frontend/public/fundamental-backtester.html`
- Sidebar entry: `Fundamental Backtester`
- API: `/api/research/fundamental-backtest` and `/api/research/fundamental-backtest/run`
- Script runner: `backend/scripts/run_fundamental_backtester.py`

Required controls:

- Mode: Screener / Trade Outcomes, Portfolio Backtest.
- Universe: clean universe, liquid clean universe, microcap-only, all PIT symbols.
- Date range: start year, end year, rebalance frequency.
- Entry rules: revenue growth, revenue acceleration, EPS surprise, sales surprise, beat streak, current ratio, debt, market cap, price range position, dollar volume.
- Exit rules: 1 month, 3 months, 6 months, 12 months, max hold, stop loss, trailing stop, take-profit ladder.
- Exclusions: reverse splits, low liquidity, missing fundamentals, stale fundamentals, extreme dilution.
- Benchmark: SPY forward return over the same hold window.
- Portfolio controls: starting capital, max positions, sizing method, rebalance cadence, allow overlapping positions, sell when no longer qualified, cash handling.

Current UI gap:

- The page currently has a `Result mode` selector with `Equal weight`, `Trade level`, and `Top N per date`.
- That selector is not the final two-mode product control.
- `Trade level` is currently the closest usable setting for Screener / Trade Outcomes.
- `Equal weight` is misleading until true portfolio simulation exists, because it does not yet produce a portfolio equity curve.
- Rename the current `Result mode` control to `Candidate handling` or equivalent, and add a separate top-level `Mode` selector for Screener / Trade Outcomes versus Portfolio Backtest.

Required results:

- Trade count.
- Win rate.
- Average return.
- Median return.
- Beat SPY rate.
- Best and worst trades.
- Year-by-year breakdown.
- Performance excluding top winner.
- Performance excluding bottom loser.
- Distribution by hold window.
- Symbol/date drilldown.

Implemented results today:

- Data source.
- Usable as-of range.
- Universe symbols scanned.
- PIT observations / snapshots tested.
- Candidate count.
- Trade count.
- Win rate.
- Average return.
- Median return.
- Average benchmark return over the same windows.
- Trades beating benchmark.
- Outlier dependency.

Important clarification: the current v1 result table is trade-level, not a true portfolio equity curve.

## Data Requirements

Use point-in-time sources only:

- `backend/data/fundamentals-pit.sqlite`
- PIT fundamental facts.
- PIT event facts for earnings reports.
- Local clean universe files.
- Local OHLCV files.
- SPY OHLCV for benchmark comparison.

Important existing fields:

- `earnings_report.epsSurprisePct`
- `earnings_report.salesSurprisePct`
- `revenue_ttm_growth_pct`
- current ratio, debt, margins, market cap where available.
- range position and liquidity from local OHLCV.

## Guardrails

- Do not use future fundamentals to select past trades.
- Do not rank strategies by average return alone.
- Require minimum sample sizes.
- Show median and outlier-adjusted results.
- Separate discovery years from validation years.
- Flag rules where one spike explains the entire edge.
- Store every run configuration so results are reproducible.

## Suggested Implementation Phases

### Phase 1 - CLI Research Harness - SUBSTANTIALLY COMPLETE

Build a script that can test one rule definition against PIT fundamentals and price history. Output JSON and CSV.

Status:

- Implemented `run_fundamental_backtester.py`.
- Supports structured JSON rules from the page.
- Supports stop loss, first take-profit rung, trailing stop, max hold, and SPY matched-window comparison.
- Writes JSON summary and CSV trade observations.
- Uses `asof_symbol_snapshots` when the requested range is covered.
- Falls back to historical `pit_fundamental_facts` for older ranges.

### Phase 2 - Rule Library - PARTIAL

Add reusable signal definitions: revenue reacceleration, EPS surprise, sales surprise, depressed price, liquidity, reverse split filter, balance sheet filter.

Status:

- Implemented page presets:
  - `depressed_revenue_reacceleration_v1`
  - `depressed_eps_surprise_v1`
  - `dcf_gap_plus_reacceleration_v1`
- Historical EPS/sales surprise facts are available from 2016 onward.
- Revenue and balance sheet metrics are partially supported through PIT facts.

### Phase 3 - Page UI - PARTIAL

Add the Fundamental Research Lab page with controls, leaderboard, result table, and symbol drilldown.

Status:

- Page UI exists and runs real backend jobs.
- Structured rule builder exists.
- Saved local configs exist.
- Result summary exists.
- Current `Result mode` control exists, but it is not the final Screener versus Portfolio mode selector.
- Current page should be treated as Screener / Trade Outcomes only.
- Trade-row table and symbol drilldown are still pending.

### Phase 4 - Signal Tournament - NOT STARTED

Run disciplined sweeps: single-factor tests first, then two-factor combinations, then limited three-factor combinations. Preserve holdout windows.

### Phase 5 - Promotion Path - NOT STARTED

Allow a robust rule to graduate into Market Intelligence as a live screen, with its backtest evidence attached.

### Phase 6 - Portfolio Backtester - NEW ACTIVE DESIGN ITEM

Build true portfolio simulation on top of the same rule engine.

Required capabilities:

- Starting capital.
- Monthly or quarterly rebalance.
- Max positions.
- Equal-weight sizing.
- Cash tracking.
- Overlapping position management.
- Sell if no longer qualifies.
- Optional fixed hold / stop / trailing stop / take-profit exits.
- Daily or rebalance-date equity curve.
- SPY buy-and-hold benchmark over the same calendar range.
- CAGR, total return, max drawdown, volatility, turnover, and exposure.

Implementation rule:

- Keep signal generation shared with screener mode.
- Add a separate portfolio simulation layer that consumes dated candidates.
- Do not reuse trade-level average return as portfolio performance.
- Show both the portfolio equity curve and SPY buy-and-hold equity curve on the same date axis.

## Definition Of Done

- A user can select a fundamental rule and date range.
- The engine only uses data available as of each test date.
- Results show forward return and SPY-relative return.
- Results include year-by-year performance and outlier dependency.
- At least the revenue reacceleration plus EPS surprise study can be reproduced from the UI.

Current DoD status:

- [x] User can select a fundamental rule and date range.
- [x] Engine uses point-in-time facts for historical entry metrics.
- [x] Results show individual trade forward returns and matched-window SPY comparison.
- [x] Results include median return and outlier dependency.
- [ ] Year-by-year performance table.
- [ ] Trade-row table in the UI.
- [ ] Symbol/date drilldown in the UI.
- [ ] Rename current `Result mode` to `Candidate handling` or equivalent.
- [ ] Add true top-level Mode selector: Screener / Trade Outcomes vs Portfolio Backtest.
- [ ] True portfolio equity curve.
- [ ] Portfolio-level SPY comparison.
- [ ] UI mode selector for Screener / Trade Outcomes vs Portfolio Backtest.
- [ ] Portfolio run config persisted separately from trade-outcome runs.
- [ ] Revenue reacceleration plus EPS surprise preset.
