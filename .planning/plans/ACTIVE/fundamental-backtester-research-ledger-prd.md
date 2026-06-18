# Fundamental Backtester Research Ledger PRD

Checklist: fundamental-backtester-research-ledger-checklist.md

## Status

Active.

## Problem

The Fundamental Backtester currently behaves like a one-shot research tool. A user can run a valuable test, but if they navigate away, refresh, or run another test, the prior result is easy to lose. This makes it hard to compare experiments, remember exactly what was tested, or identify which fundamental rules are actually working over time.

The page needs to become a durable research ledger: every completed backtest should be saved with its exact configuration, result metrics, timestamp, and ranking score so the app can surface the strongest setups and bury weak ones.

## Goal

Build a database-backed Fundamental Backtester Research Ledger that records completed runs, ranks them, and lets the user review and compare prior experiments.

The app should answer:

- What did I test?
- What were the results?
- Which tests are best so far?
- Which rules are weak or misleading?
- How does this run compare to other similar runs?

## Non-Goals

- This is not a full portfolio simulator yet.
- This is not an automated trading system.
- This is not a guarantee that high-ranked rules are tradable.
- This should not replace proper out-of-sample validation, survivorship checks, or corporate-action audit.

## Users

Primary user: a discretionary/research trader using the app to discover fundamental setups, especially depressed stocks with improving revenue, EPS surprise, sales surprise, or other point-in-time fundamental signals.

Future user: a less discretionary trader who needs the app to show the strongest tested strategies and make the workflow more systematic.

## Core Requirements

### Durable Run Storage

Every completed Fundamental Backtester run should be saved to a database table.

Each saved run must include:

- Run id
- Created timestamp
- Rule name
- Universe
- Date range
- Rebalance frequency
- Benchmark
- Max symbols
- Entry rules tested
- Exclusion rules
- Exit and hold logic
- Result mode
- Data source
- Snapshot range
- Universe symbols
- PIT snapshot count
- Candidate count
- Trade count
- Win rate
- Average return
- Median return
- Average benchmark return over same windows
- Trades beating benchmark
- Outlier dependency
- Raw config JSON
- Raw result JSON

### Research Score

Each saved run should get a computed research score so results can be ranked.

The first version should reward:

- Higher median return
- Higher average return
- Higher win rate
- Higher benchmark beat rate
- Higher trade count, up to a reasonable confidence cap

The first version should penalize:

- High outlier dependency
- Very low trade count
- Missing benchmark comparison
- Zero-candidate runs

The score should be presented as a relative research ranking, not a probability and not investment advice.

### Run History

The Fundamental Backtester page should show saved runs after execution.

At minimum, the run history should support:

- Sort by research score
- Sort by created date
- Sort by median return
- Sort by average return
- Sort by win rate
- Sort by benchmark beat rate
- Sort by trade count
- Select a prior run and restore its config
- Select a prior run and view its results

### Winner / Loser Surfacing

The UI should make winners and losers obvious.

High-quality runs should rise to the top when sorted by score. Weak runs should sink lower. Zero-candidate runs should remain searchable but should not pollute the top of the leaderboard.

### Comparison

The user should be able to compare at least two saved runs.

The first comparison version should show:

- Rule/config summary
- Tested rules
- Trade count
- Win rate
- Average return
- Median return
- Average benchmark return
- Benchmark beat rate
- Outlier dependency
- Research score

This should make comparisons like these easy:

- Revenue acceleration only
- EPS surprise only
- Sales surprise only
- Revenue acceleration + EPS surprise
- Revenue acceleration + sales surprise
- Revenue acceleration + EPS surprise + liquidity filter

### Copy / Export

Saved run views should include a copy button that exports the same plain-text result format the user already uses, plus the research score and saved-run id.

## Suggested Database Shape

Use the existing application database layer and naming conventions.

Proposed table:

```text
fundamental_backtest_runs
```

Suggested columns:

```text
id
created_at
rule_name
universe
as_of_start
as_of_end
rebalance_frequency
benchmark
max_symbols
entry_rules_json
exclusion_rules_json
exit_json
result_mode
data_source
snapshot_start
snapshot_end
universe_symbols
pit_snapshots
candidates
trade_count
win_rate_pct
average_return_pct
median_return_pct
average_benchmark_return_pct
benchmark_beat_rate_pct
outlier_dependency_pct
research_score
config_json
result_json
notes
```

Indexes should support:

- Recent runs
- Top-ranked runs
- Rule name lookup
- Universe/date-range lookup

## Research Score V1

Use a simple transparent formula first.

Suggested inputs:

```text
median_return_pct
average_return_pct
win_rate_pct
benchmark_beat_rate_pct
trade_count
outlier_dependency_pct
```

Suggested behavior:

- Median return should matter more than average return.
- Benchmark beat rate should matter at least as much as raw win rate.
- Trade count should improve confidence, but not linearly forever.
- Outlier dependency should be a serious penalty.
- Zero-candidate runs should score at or near zero.

The UI should show the component metrics, not just the final score.

## UX Requirements

The page should keep the existing Fundamental Backtester layout.

Add a saved research section that feels like a research ledger, not a marketing page.

The interface should make this workflow natural:

1. Configure a test.
2. Run the backtest.
3. Automatically save the completed run.
4. See where it ranks.
5. Restore or compare prior runs.
6. Continue testing the next hypothesis.

## Open Questions

- Should every completed run auto-save, or should the user be able to opt out?
- Should duplicate configs overwrite, create a new run, or both?
- Should notes be manual only, or should the app generate an AI summary of why the run ranked well or poorly?
- Should the ranking score be global, per universe, or both?
- Should zero-candidate runs be saved by default?

## Acceptance Criteria

- Completed Fundamental Backtester runs survive page navigation and browser refresh.
- Completed runs are saved to the database with full config and metrics.
- Saved runs appear in a history/leaderboard UI.
- Runs can be sorted by score and core metrics.
- A prior run can be restored into the backtester config.
- A prior run can be viewed without re-running the backtest.
- The research score is visible and explainable.
- Copy results includes tested rules, metrics, saved-run id, and research score.
- Zero-candidate runs do not rank above meaningful tested runs.

