# Fundamental Backtester Research Ledger Checklist

PRD: fundamental-backtester-research-ledger-prd.md

Percent complete: 82% (40 complete, 0 partial, 9 remaining)

## Database

- [x] Identify the existing database layer and migration pattern.
- [x] Add a durable `fundamental_backtest_runs` table or equivalent model.
- [x] Store full run config JSON.
- [x] Store full run result JSON.
- [x] Store normalized summary columns for sorting and filtering.
- [x] Add indexes for recent runs, score ranking, and rule lookup.
- [x] Decide how duplicate configs are handled.

## Persistence Flow

- [x] Save each completed Fundamental Backtester run after the runner returns results.
- [x] Preserve zero-candidate runs without letting them rank as winners.
- [x] Handle failed or partial runs without corrupting run history.
- [x] Add saved-run id to completed run state.
- [x] Ensure saved runs survive page navigation.
- [x] Ensure saved runs survive browser refresh.

## Research Score

- [x] Implement Research Score V1.
- [x] Weight median return above average return.
- [x] Include win rate.
- [x] Include benchmark beat rate.
- [x] Include trade-count confidence.
- [x] Penalize outlier dependency.
- [x] Penalize tiny sample sizes.
- [x] Penalize missing benchmark data.
- [x] Keep score explainable in UI.

## API

- [x] Add endpoint/service to create a saved run.
- [x] Add endpoint/service to list saved runs.
- [x] Add endpoint/service to fetch one saved run.
- [ ] Add endpoint/service to delete or hide a saved run if needed.
- [x] Add endpoint/service to restore a saved run config.
- [x] Add endpoint/service to compare selected runs.

## Fundamental Backtester UI

- [x] Add a saved research runs section.
- [x] Show recent runs.
- [x] Show top-ranked runs.
- [x] Show tested-rule summary for each run.
- [x] Show key metrics for each run.
- [x] Show research score for each run.
- [x] Add sort controls for score, date, median return, average return, win rate, benchmark beat rate, and trade count.
- [x] Add restore config action.
- [x] Add view saved result action.
- [x] Add compare action.
- [x] Add copy saved result action.

## Comparison

- [x] Compare at least two saved runs side by side.
- [x] Show tested rules for each run.
- [x] Show core metrics for each run.
- [x] Show research score for each run.
- [x] Make revenue/EPS/sales-surprise combinations easy to compare.

## Verification

- [ ] Run a smoke test with a small max-symbol count.
- [x] Run a 500-symbol test and confirm it saves.
- [ ] Navigate away and return to confirm the saved run remains visible.
- [ ] Refresh browser and confirm the saved run remains visible.
- [ ] Restore a saved config and confirm the JSON matches the original run.
- [x] Confirm copy output includes saved-run id and research score.
