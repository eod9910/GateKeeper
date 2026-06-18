# Fundamental Research Lab Checklist

Percent complete: 41% (29 complete, 0 partial, 42 remaining)

Status: ACTIVE
Created: 2026-06-01
Updated: 2026-06-01
Owner: Research Studio / Market Intelligence
PRD: fundamental-research-lab-prd.md
PRD: `fundamental-research-lab-prd.md`

## Goal

Build the first usable point-in-time fundamental backtester.

The v1 question is:

> Given a past date, what fundamental facts were knowable then, which symbols passed a rule, and what happened afterward?

This is intentionally separate from the technical-pattern backtester and separate from full Market Intelligence replay. Market Intelligence can consume the results later, but v1 should prove fundamental rules on their own first.

## Product Shape

v1 is a page-first workflow backed by a deterministic runner.

The page is the primary user interface. The backend runner may still be implemented as a script internally, but the user should not have to operate it from the command line.

The product has two explicit modes:

1. Screener / Trade Outcomes.
2. Portfolio Backtest.

Both modes use the same point-in-time rule engine. Screener mode reports what happened to each individual candidate. Portfolio mode simulates what would have happened if capital were allocated mechanically to those candidates.

Required v1 outputs:

- JSON run artifact.
- CSV trade/signal table.
- Markdown summary report.
- Saved run config for reproducibility.

Required v1 page:

- `frontend/public/fundamental-backtester.html`
- preset selector;
- structured rule builder;
- exit and portfolio controls;
- generated rule JSON preview;
- saved local configs;
- run status and latest results panel.
- mode selector:
  - Screener / Trade Outcomes;
  - Portfolio Backtest.

Implementation status:

- [x] Page shell created.
- [x] Presets, editable rules, exclusions, exit controls, JSON preview, copy, and local-save flow created.
- [x] Backend `/api/research/fundamental-backtest` status endpoint.
- [x] Backend `/api/research/fundamental-backtest/run` run endpoint.
- [x] TypeScript service wrapper for runtime state and Python process execution.
- [x] Python runner for structured rule configs.
- [x] Latest results loading into the page.
- [x] Trade-level JSON and CSV artifacts.
- [x] Historical PIT fallback using `pit_fundamental_facts` when `asof_symbol_snapshots` does not cover the requested range.
- [x] Result labels clarified for benchmark comparison:
  - average benchmark return over same windows;
  - trades beating benchmark.
- [x] Current implementation clearly treated as trade-level / screener mode, not true portfolio simulation.
- [ ] Rename current `Result mode` selector to `Candidate handling` because it does not switch between screener and portfolio backtest.
- [ ] Add a separate top-level `Mode` selector:
  - Screener / Trade Outcomes;
  - Portfolio Backtest.
- [ ] Trade-row table in the page.
- [ ] Symbol/date drilldown.
- [ ] Markdown report artifact rendering.
- [ ] Year-by-year performance table.
- [ ] UI mode selector for Screener / Trade Outcomes vs Portfolio Backtest.
- [ ] True portfolio simulation mode.

## Manual Control Model

The user should have high control over the research question, but the system should control point-in-time safety and metric definitions.

### User Controls

- Universe:
  - clean universe
  - liquid clean universe
  - microcap only
  - custom symbol list
- Date range:
  - start date
  - end date
  - rebalance frequency: monthly, quarterly, yearly
- Entry rules:
  - revenue growth
  - revenue acceleration
  - EPS surprise
  - sales surprise
  - valuation state
  - quality grade / quality score
  - current ratio
  - debt / leverage
  - market cap
  - price drawdown
  - below / above moving average
  - liquidity
  - reverse split filter
- Exit rules:
  - fixed hold: 1M, 3M, 6M, 12M
  - max hold days
  - stop loss
  - trailing stop
  - take-profit ladder
- Benchmark:
  - SPY forward return over the same hold window
- Result mode:
  - screener / trade outcomes
  - portfolio backtest
  - top-N per rebalance date
- Current UI note:
  - the existing `Result mode` field is not a real product mode selector yet;
  - `Trade level` should be treated as current Screener / Trade Outcomes behavior;
  - `Equal weight` should not be presented as true portfolio performance until an equity curve simulator exists.
- Portfolio controls:
  - starting capital
  - max positions
  - equal weight / fixed weight sizing
  - monthly or quarterly rebalance
  - sell when no longer qualified
  - allow or prevent overlapping positions
  - cash handling

### System-Controlled Guardrails

- No future fundamentals in entry selection.
- `available_at <= as_of_date` for PIT facts.
- Price entry uses next tradable bar after the rebalance/as-of date.
- Split-adjusted OHLCV is used consistently.
- Missing, stale, or non-PIT fields are explicitly marked.
- Results must include median and outlier dependency, not just average return.
- Rule sample size warnings are mandatory.

## v1 Rule Format

Rules should be structured data, not handwritten code.

Example:

```json
{
  "name": "depressed_revenue_reacceleration_v1",
  "universe": "clean",
  "rebalance_frequency": "monthly",
  "entry": {
    "all": [
      { "metric": "price_drawdown_6m_pct", "op": "<=", "value": -50 },
      { "metric": "revenue_growth_yoy_pct", "op": ">", "value": 0 },
      { "metric": "revenue_acceleration_qoq_pct", "op": ">", "value": 0 },
      { "metric": "dollar_volume_20d", "op": ">=", "value": 1000000 }
    ]
  },
  "exclusions": [
    { "metric": "reverse_split_within_days", "op": "<=", "value": 365 },
    { "metric": "current_ratio", "op": "<", "value": 0.5 }
  ],
  "exit": {
    "max_hold_days": 180,
    "stop_loss_pct": -35,
    "take_profit_ladder_pct": [50, 100, 200],
    "trailing_stop_pct": 35
  },
  "benchmark": "SPY"
}
```

## v1 Metrics

Every screener / trade-outcome run must report:

- [x] data source;
- [x] usable as-of range;
- [x] signal / candidate count;
- [x] trade count;
- [x] win rate;
- [x] average return;
- [x] median return;
- [x] average benchmark return over same windows;
- [x] trades beating benchmark;
- [x] max winner;
- [x] max loser;
- [x] outlier dependency;
- [x] skipped symbols and skip reasons;
- [ ] average time to first profit;
- [ ] average time to max favorable excursion;
- [ ] average drawdown before exit;
- [ ] best hold window;
- [ ] year-by-year performance;
- [ ] performance excluding top winner;
- [ ] performance excluding bottom loser;
- [ ] performance excluding top and bottom 1%;
- [ ] number of trades by rebalance year.

Every portfolio backtest run must report:

- [ ] starting capital;
- [ ] ending capital;
- [ ] total return;
- [ ] CAGR;
- [ ] SPY buy-and-hold total return over the same calendar range;
- [ ] portfolio return minus SPY return;
- [ ] max drawdown;
- [ ] volatility;
- [ ] exposure;
- [ ] turnover;
- [ ] cash drag;
- [ ] rebalance count;
- [ ] average holdings count;
- [ ] holdings by rebalance date;
- [ ] equity curve;
- [ ] SPY benchmark equity curve.

## First Built-In Studies

v1 should ship with these presets:

1. `depressed_revenue_growth`
   - price drawdown + positive revenue growth.
2. `depressed_revenue_reacceleration`
   - price drawdown + revenue growth + revenue acceleration.
3. `depressed_eps_surprise`
   - price drawdown + positive EPS surprise.
4. `depressed_sales_surprise`
   - price drawdown + positive sales surprise.
5. `revenue_reacceleration_quality_filtered`
   - revenue reacceleration + balance sheet / quality filters.
6. `revenue_reacceleration_reverse_split_included`
   - same rule with reverse splits included.
7. `revenue_reacceleration_reverse_split_excluded`
   - same rule with reverse splits excluded.
8. `dcf_gap_plus_revenue_reacceleration`
   - undervalued / overvalued valuation state plus revenue reacceleration, if PIT valuation is available.

## Data Sources

Required:

- `backend/data/fundamentals-pit.sqlite`
- local clean universe files
- local daily OHLCV files
- SPY daily OHLCV

Current implementation:

- Uses `asof_symbol_snapshots` for rich 2026 snapshot-backed runs.
- Uses `pit_fundamental_facts` for historical runs before the snapshot table is available.
- Uses local daily OHLCV for entry, exit, drawdown, moving-average, liquidity, and benchmark windows.
- Uses `earnings_report.epsSurprisePct` and `earnings_report.salesSurprisePct` for historical earnings surprise tests.
- Computes older market cap as `sharesOutstanding * entry close` when historical market facts are missing.

Preferred PIT fields:

- revenue TTM / quarterly revenue
- revenue growth YoY
- revenue acceleration QoQ / YoY delta
- EPS surprise %
- sales surprise %
- current ratio
- net debt / market cap
- market cap
- margins
- quality grade / quality score
- reverse split / corporate action flags if available

If a field is unavailable point-in-time, v1 must either skip that rule or mark the field as diagnostic-only. It must not silently use current data.

## CLI Sketch

```powershell
py backend/scripts/run_fundamental_backtester.py `
  --rule backend/data/research/fundamental-rules/depressed_revenue_reacceleration_v1.json `
  --as-of-start 2021-01-01 `
  --as-of-end 2025-12-31 `
  --rebalance-frequency monthly `
  --forward-windows 20,60,120,252 `
  --output-dir backend/data/research/fundamental-backtests
```

## Output Files

Current latest aliases:

- `backend/data/research/fundamental_backtest_summary_app.json`
- `backend/data/research/fundamental_backtest_observations_app.csv`
- `backend/data/research/fundamental_backtest_config_app.json`

Future timestamped artifacts:

- `backend/data/research/fundamental-backtests/fundamental_backtest_<run_id>.json`
- `backend/data/research/fundamental-backtests/fundamental_backtest_<run_id>.csv`
- `backend/data/research/fundamental-backtests/fundamental_backtest_<run_id>.md`

## v1 Acceptance Criteria

- [x] A user can run one preset fundamental rule over at least 2021-2025.
- [x] The run uses only data available as of each rebalance date.
- [x] The CSV lists every selected symbol, as-of date, entry date, exit date, exit reason, return, and benchmark-relative result.
- [x] The page report shows win rate, median return, outlier dependency, and sample size.
- [x] EPS surprise can be tested historically using PIT facts.
- [ ] The page report shows year-by-year results.
- [ ] Reverse-split included vs excluded runs can be compared reliably.
- [ ] Revenue growth vs revenue acceleration vs EPS surprise can be compared in a dedicated comparison view.
- [ ] The system clearly states when a rule cannot be tested because a PIT field is missing.
- [ ] A true portfolio mode can be run separately from trade-level/screener mode.
- [ ] The UI never labels trade-level average return as portfolio return.
- [ ] Portfolio mode compares a real equity curve against SPY buy-and-hold over the same calendar dates.
- [ ] Current `Result mode` control is renamed or reframed so it cannot be confused with true Portfolio Backtest mode.
- [ ] Screener mode and Portfolio mode have visibly separate result panels.

## v1 Non-Goals

- No unlimited combinatorial search.
- No LLM-generated rule execution.
- No live trading recommendation.
- No current-fundamental leakage into historical tests.
- No Market Intelligence overlay until the fundamental-only results are trustworthy.

## Next Implementation Step

Completed:

- Inspected PIT schema.
- Built the page.
- Wired the backend service and API.
- Built the Python runner.
- Added historical PIT fallback for EPS/sales surprise and core fundamentals.
- Verified a 2024 smoke run through the API using `pit_fundamental_facts`.

Next implementation targets:

1. Rename current `Result mode` to `Candidate handling`.
2. Add a top-level mode selector with Screener / Trade Outcomes and Portfolio Backtest.
3. Add a trade-row table to the page so the UI exposes the CSV rows directly.
4. Add a year-by-year breakdown.
5. Add a side-by-side factor comparison view:
   - revenue only;
   - EPS surprise only;
   - revenue + EPS surprise;
   - sales surprise;
   - DCF gap + reacceleration.
6. Add backend `mode`:
   - `screen_trade_outcomes`;
   - `portfolio_backtest`.
7. Implement true portfolio simulation:
   - starting capital;
   - max positions;
   - equal-weight sizing;
   - cash tracking;
   - monthly/quarterly rebalance;
   - SPY buy-and-hold benchmark;
   - equity curve, CAGR, drawdown, turnover.
8. Add a portfolio/screener results switch in the page so trade-level metrics and portfolio metrics cannot be confused.
