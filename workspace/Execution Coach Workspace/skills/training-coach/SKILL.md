# Training Coach

## When To Use

Use this skill when the user asks for:

- an execution coach read
- contract-level training review
- session review
- live-trading readiness
- diagnosis of win rate, expectancy, payoff, TP hit rates, MAE/MFE, or R leaks
- a drill recommendation based on training data

## Inputs

- deterministic coach report from `GET /api/training/coach`
- optional training report from `GET /api/training/report`
- optional recent attempts and active session context
- optional user question

## Procedure

1. Establish scope: contract-level, session-level, recent attempts, or live-readiness.
2. Check sample size before making strong claims.
3. Read the deterministic baseline first: expectancy, win rate, payoff, total R, TP rates, average win/loss.
4. Read diagnostics next: MAE/MFE on winners and losers.
5. Read slices: side, symbol, timeframe, and contract outliers.
6. Identify the primary leak or opportunity with the highest expected R impact.
7. Convert the leak into one concrete drill.
8. State the live-trading restriction if the data does not support live exposure.
9. Name the metric that would prove improvement.
10. Keep secondary observations brief.

## Output Contract

Return:

- `verdict`: one sentence.
- `primary_leak`: the most important execution issue.
- `evidence`: metrics and sample sizes that support the read.
- `next_drill`: one specific drill.
- `live_trading_restriction`: what the user should avoid live until improved.
- `improvement_metric`: the measurable target.
- `confidence`: high, medium, low, or insufficient.
- `caveats`: missing data or sample-size limits.

## Tool Notes

- Use the deterministic coach report as the source of truth.
- Do not make tool claims that are not implemented in runtime.
- If the planned AI endpoint is unavailable, this skill still defines the desired coaching behavior for future wiring.

