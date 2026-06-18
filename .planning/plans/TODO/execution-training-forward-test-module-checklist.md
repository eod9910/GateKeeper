# Execution Training & Forward-Test Module Checklist

Percent complete: 0%

Status: TODO
PRD: `execution-training-forward-test-module-prd.md`

## Product Definition

- [ ] Confirm V1 module name and page placement.
- [ ] Define StrategyContract fields and required rule types.
- [ ] Define TrainingSession, TrainingAttempt, ForwardResolution, and ScoreSnapshot payloads.
- [ ] Define deterministic same-bar TP/SL tie-break policy.
- [ ] Define resolver and contract versioning rules.

## Backend

- [ ] Add training route skeleton.
- [ ] Add `contractEngine` service.
- [ ] Add `forwardResolver` service.
- [ ] Add `scoringEngine` service.
- [ ] Add `sessionEngine` service.
- [ ] Add JSON-first storage folders for contracts, sessions, attempts, events, and stats.
- [ ] Implement contract create/list endpoints.
- [ ] Implement session start/end endpoints.
- [ ] Implement attempt validate endpoint.
- [ ] Implement attempt run endpoint.
- [ ] Implement stats query endpoint.

## Forward Resolver

- [ ] Resolve long and short trades bar-by-bar after entry.
- [ ] Resolve take-profit hits.
- [ ] Resolve stop-loss hits.
- [ ] Resolve max-hold/time-stop exits.
- [ ] Apply conservative same-bar ambiguity handling.
- [ ] Persist resolver version with every attempt.
- [ ] Add deterministic resolver tests.

## Frontend

- [ ] Add Training page or tab.
- [ ] Add contract selector.
- [ ] Add rule checklist panel.
- [ ] Add entry, stop, take-profit, and risk controls.
- [ ] Add run/resolve action.
- [ ] Add result card after each attempt.
- [ ] Add session scoreboard.
- [ ] Show cooldown state when applicable.

## Scoring And Behavior

- [ ] Implement process score.
- [ ] Implement outcome score.
- [ ] Implement composite score.
- [ ] Implement rolling discipline, expectancy, and win-rate stats.
- [ ] Implement violation ladder.
- [ ] Implement cooldown lockout policy.
- [ ] Add confidence labels based on attempt count.

## Verification

- [ ] Entry cannot proceed when required rules fail.
- [ ] Every attempt is persisted with full context.
- [ ] Resolver output is reproducible.
- [ ] Scores update immediately after each run.
- [ ] Session stats are visible and queryable.
- [ ] Aggregate stats can be exported or inspected for later model work.
