# Base Method Tombstones

Purpose: keep a permanent record of base-finding methods that were tested and rejected, so they do not get reinvented without a clear reason.

## Review Rule

A method should only survive review if it does both:

- finds candidates on a meaningful share of the review batch
- explicitly marks a usable base box

A "usable base box" means the method emits at least:

- floor
- ceiling
- enough time information to know where the base starts and ends, or at minimum its duration

## Workflow

1. Run the suite on the review batch.
2. Compare `cov`, `raw`, `mark`, `full`, and `ann`.
3. Open the promising methods on the chart and verify the marked base is the intended one.
4. If a method is not useful, add a tombstone entry here and in `backend/data/research/base-method-tombstones.json`.

## Current Tombstones

### `rdp_base_75`

- Date: 2026-02-28
- Verdict: `tombstoned`
- Review batch: Base Test 40 review workflow
- Reason: The core rule does not define the base in a useful way.
- Failure mode: Uses an RDP high-low pair and defines the base as the lower 25% of that range, which visually misses the intended base structure.
- Evidence: Manual visual review; method logic is `base_ceiling = low + 0.25 * (high - low)`.
- Revisit only if: there is a materially different definition than the current fixed lower-25%-of-range formula.

## Entry Template

### `pattern_id`

- Date:
- Verdict: `tombstoned`
- Review batch:
- Reason:
- Failure mode:
- Evidence:
- Revisit only if:
