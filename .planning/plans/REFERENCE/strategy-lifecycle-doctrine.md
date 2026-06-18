# Strategy Lifecycle Doctrine

## Core Rule

A research rule is not a validated strategy.

The default lifecycle is:

```text
Research Candidate
-> Parameter Sweep
-> Validator
-> Strategy Library
-> Trading Desk
```

Do not send a raw research rule directly to Validator unless it already has a complete execution model.

## Why This Changed

The old mental model was:

```text
Research result
-> Validator
-> Parameter Sweep after Tier 3
```

That is backwards for most strategies.

Validator should judge a completed strategy candidate. It should not be used to certify a rule whose trading mechanics are still unknown.

Parameter Sweep comes first because it answers:

- How should this rule be traded?
- What hold period works?
- What stop model works?
- Should there be a trailing stop?
- Should there be take-profit ladders?
- Should candidates be traded as all names or top-N per rebalance?
- What liquidity, split, universe, and portfolio filters are required?

Only after those mechanics are selected does Validator answer:

- Is this robust?
- Does it survive out-of-sample?
- Does it degrade gracefully?
- Is it too dependent on one symbol, one year, or one market regime?
- Does it pass trade-count, drawdown, expectancy, and stability thresholds?

## Lifecycle Definitions

### Research Candidate

A rule or signal that looks promising but has not yet earned strategy status.

Examples:

- Depressed price + revenue acceleration
- Revenue acceleration + EPS surprise
- DCF undervaluation + reacceleration
- Social buzz perturbation + price lag
- Structural family setup
- Eigen shock + supporting confirmation

Research candidates may have good backtest results, but they are still incomplete because execution is not settled.

### Strategy Candidate

A research candidate that has gone through Parameter Sweep and now has a proposed execution shape.

This includes:

- Entry rule
- Universe
- Rebalance or scan cadence
- Max hold
- Stop logic
- Trailing stop logic
- Take-profit logic
- Position/portfolio constraints
- Liquidity and corporate-action exclusions
- Cost/slippage assumptions

### Validated Strategy

A strategy candidate that has passed Validator checks.

Validator is the certification gate, not the tuning bench.

### Tradable Strategy

A validated strategy with production controls:

- Position sizing
- Execution routing
- Monitoring
- kill switch / pause rules
- Risk caps
- Operator visibility
- Trading Desk integration

## Tool Responsibilities

### Fundamental Backtester / Research Tools

Purpose: discover promising rules.

Output: Research Candidate.

Button language should be:

```text
Promote To Sweep
```

Not:

```text
Validate
```

### Parameter Sweep

Purpose: test execution and portfolio mechanics.

Output: Strategy Candidate.

Parameter Sweep should explore:

- Stop losses
- ATR stops
- Trailing stops
- Take-profit ladders
- Max hold periods
- Top-N per date
- Rebalance frequency
- Liquidity filters
- reverse-split exclusions
- market-cap buckets
- cost/slippage assumptions

### Validator

Purpose: judge a completed strategy candidate.

Output: Validated Strategy or rejection.

Validator should test:

- in-sample and out-of-sample behavior
- robustness
- sensitivity
- degradation
- drawdown
- trade count
- regime dependence
- concentration risk
- benchmark comparison

### Trading Desk

Purpose: execute only validated strategies with production risk controls.

Output: live or simulated execution.

## Exception Rule

A candidate may go directly to Validator only if it already has a complete execution model and there are no open trade-mechanics questions.

This should be rare.

When in doubt, send it to Parameter Sweep first.

## Practical Example

A Fundamental Backtester rule:

```text
6M drawdown % <= -50
Revenue acceleration QoQ % > 0
EPS surprise % >= 0
```

This is a Research Candidate.

It should go to Parameter Sweep to test:

```text
max_hold_days: 30 / 60 / 90 / 180 / 252
stop_loss_pct: -15 / -25 / -35 / none
trailing_stop_pct: 15 / 25 / 35 / 50
take_profit_ladder_pct: 25 / 50 / 100 / 200
top_n_per_date: 5 / 10 / 20 / all
liquidity_filter: 250k / 1M / 5M
reverse_split_exclusion: include / exclude
```

Only the best viable swept variant should go to Validator.

