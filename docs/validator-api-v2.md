# Validator API V2

## POST /api/validator/run
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

## GET /api/validator/run/:job_id
Returns run status.

Status payload:
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
- `stage` and `detail` represent real pipeline milestones (not time-derived fake stages).
- Default pipeline timeout is `480s` (`VALIDATOR_PIPELINE_TIMEOUT_MS` override available).
- Concurrency is limited by `VALIDATOR_MAX_CONCURRENT_RUNS` (default `2`).

## GET /api/validator/report/:id
Returns a single ValidationReport.

## GET /api/validator/report/:id/trades
Returns persisted `TradeInstance[]` audit trail for a report.

## Validation failures
Invalid payloads return `400` with explicit `error`:
- invalid dates
- `date_start >= date_end`
- malformed symbol universe
- missing required fields

---

## Symbol Library Endpoint (Used By Validator Run Modal)

### GET /api/candidates/symbols
Returns symbol catalog JSON used by the run modal library/category picker.

Important:
- Route precedence must keep `/symbols` above `/api/candidates/:id` to avoid accidental `404 Candidate not found` responses.
