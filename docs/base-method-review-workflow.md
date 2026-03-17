# Base Method Review Workflow

This workflow is for evaluating competing base-finding methods without repeating old failures.

## Goal

Decide whether each method is:

- useful
- needs more tuning
- tombstoned

## Review Steps

1. Run the centralized suite:

```bash
cd backend
npm run base:suite -- --symbols CRNX,NVDA,AMD,AAPL,TSLA --interval 1wk --period 5y --strict-base
```

2. Use these fields first:

- `cov`: symbols with filtered candidates
- `raw`: symbols with raw candidates before strict filtering
- `mark`: symbols where the method emitted a price box
- `full`: symbols where the method emitted a price box plus time window
- `ann`: average annotation score for the review candidate

3. Use chart review to answer the real question:

- Did the method mark the intended base?
- Did it mark the correct floor and cap?
- Did it mark the right start and end?
- Is the marked base still useful when the touch count is sparse?

4. Record the decision:

- keep promising methods in the suite
- tune methods that show `raw` or `mark` but weak `cov`
- tombstone methods that repeatedly fail to mark useful bases

## Tombstone Record

When a method is rejected, record it in both:

- `memory-bank/BASE_METHOD_TOMBSTONES.md`
- `backend/data/research/base-method-tombstones.json`

Minimum tombstone fields:

- `pattern_id`
- date
- review batch
- verdict
- failure mode
- evidence
- conditions required before revisiting
