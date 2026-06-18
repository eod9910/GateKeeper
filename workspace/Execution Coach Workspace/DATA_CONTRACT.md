# Data Contract

## Required Inputs

The AI coach should receive a compact payload with:

- `contractId`
- `generatedAt`
- `scope`
- `baseline`
- `diagnostics`
- `slices`
- `observations`

These fields come from `GET /api/training/coach`.

## Recommended Supporting Inputs

- recent resolved attempts
- current active session summary
- active contract rules
- rule-checklist failures
- user question or requested coaching focus

## Expected Output

The AI coach should return structured JSON with:

- `verdict`
- `primary_leak`
- `evidence`
- `next_drill`
- `live_trading_restriction`
- `improvement_metric`
- `confidence`
- `caveats`
- `ai_input_summary`

## Provenance Rules

- Every metric cited must come from the deterministic payload.
- If a claim is an inference, label it as coaching judgment.
- If the data is insufficient, the output must say what is missing.
- Do not use the LLM response as the official source of numeric truth.

## Cache Rules

Cache the AI coach response by contract and payload fingerprint.

Invalidate the cache when:

- a new attempt is resolved,
- the active contract changes,
- the user manually refreshes the AI coach,
- or the deterministic coach report changes materially.

