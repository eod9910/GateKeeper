# Validator Architecture

This document defines the Validator as the strategy-only backtest and expectancy gate.

For validation philosophy and tier rules, see `agent-relay/planning-docs/reference/strategy-validation-policy.md`.

For the Primitive -> Composite -> Strategy boundary, see `agent-relay/planning-docs/reference/indicator/indicator-architecture.md`.

## Core Rule

Validator consumes strategies only.

It does not run naked primitives or naked composites. Signal-only checks belong in Research Studio.

The Validator answers:

```text
Does this trade plan have positive expectancy after realistic entry, exit, risk, cost, and robustness testing?
```

## Strategy Input

Validator runs a saved strategy version or an equivalent strategy spec.

A valid strategy defines:

- signal source: primitive or composite
- required state, if the signal source is stateful
- direction
- entry config
- risk config
- exit config
- cost config
- execution config
- validation universe and dates
- parameter manifest

## API

### POST `/api/validator/run`

Starts an async validator run.

Request body:

```json
{
  "strategy_version_id": "wyckoff_accumulation_v1",
  "date_start": "2020-01-01",
  "date_end": "2025-12-31",
  "universe": ["SPY", "QQQ"]
}
```

Success response:

```json
{
  "success": true,
  "data": {
    "job_id": "job_123abc456d",
    "status": "queued",
    "strategy_version_id": "wyckoff_accumulation_v1"
  }
}
```

Validation failures return `400` with an explicit error:

- invalid dates
- `date_start >= date_end`
- malformed symbol universe
- missing required fields

### GET `/api/validator/run/:job_id`

Returns run status.

Example status payload:

```json
{
  "success": true,
  "data": {
    "job_id": "job_123abc456d",
    "status": "running",
    "strategy_version_id": "wyckoff_accumulation_v1",
    "created_at": "2026-02-13T01:00:00.000Z",
    "started_at": "2026-02-13T01:00:01.000Z",
    "progress": 0.88,
    "stage": "finalizing_report",
    "detail": "Running parameter sensitivity (6 reruns)...",
    "elapsed_sec": 312,
    "timeout_sec": 480,
    "warning": "This run is taking longer than expected. Data fetch latency or complex strategy logic can cause delays."
  }
}
```

Terminal statuses:

- `completed` with `report_id`
- `failed` with `error`

Notes:

- `progress` is streamed from the Python validator pipeline via structured `stderr` JSON events.
- `stage` and `detail` represent real pipeline milestones.
- Default pipeline timeout is `480s` through `VALIDATOR_PIPELINE_TIMEOUT_MS`.
- Concurrency is limited by `VALIDATOR_MAX_CONCURRENT_RUNS`, default `2`.

### GET `/api/validator/report/:id`

Returns a single validation report.

### GET `/api/validator/report/:id/trades`

Returns persisted trade audit rows for a report.

## Symbol Library Endpoint

### GET `/api/candidates/symbols`

Returns symbol catalog JSON used by the run modal library/category picker.

Route precedence must keep `/symbols` above `/api/candidates/:id` to avoid accidental `404 Candidate not found` responses.

## Output Responsibility

Validator output should support:

- expectancy
- win rate
- drawdown
- trade count
- robustness checks
- sensitivity checks
- Monte Carlo checks
- failure modes for repair
- promotion or tombstone decisions

## Relationship to Research

Research Studio can test whether a primitive or composite signal has predictive value.

Validator tests whether a complete trade-management wrapper around that signal is tradable.
