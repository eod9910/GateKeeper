# Pattern Scanner Rules

This document defines the working rules for creating, reviewing, keeping, and tombstoning pattern scanner methods.

## 1. Purpose

The pattern scanner exists to:

- run a scanner method against a symbol universe
- produce structured candidates
- render the result clearly on the review chart
- let the user decide whether the method is useful

For base detection methods, the final standard is visual correctness, not just numeric output.

## 2. Definition Rules

Each scanner method must have a valid pattern definition.

Required definition rules:

- `pattern_id` must be lowercase snake case
- `name` is required
- `pattern_type` must match `pattern_id`
- `plugin_file` must match `plugins/<pattern_id>.py` unless it uses `plugins/composite_runner.py`
- `plugin_function` must match `run_<pattern_id>_plugin`
- `artifact_type` must be `indicator` or `pattern`
- `composition` must be `primitive`, `composite`, or `preset`
- `category` must be lowercase snake case

Additional required rules for primitive indicators:

- they must define `tunable_params`
- each tunable param must have a matching default in `default_setup_params`
- they must define `indicator_role`

Additional required rules for pattern artifacts:

- they must define `pattern_role`

Source of truth:

- `backend/src/services/pluginValidation.ts`
- `backend/data/patterns/registry.json`

## 3. Candidate Output Rules

Every scanner method must emit valid structured candidates.

Each candidate must include:

- `candidate_id`
- `id`
- `strategy_version_id`
- `pattern_type`
- `spec_hash`
- `score` in the range `0.0` to `1.0`
- `entry_ready` as a boolean
- `rule_checklist` as a non-empty array
- `chart_data`
- `node_result`
- `output_ports`

`node_result` must include:

- `passed`
- `score`
- `features`
- `anchors`
- `reason`

`output_ports` must include at least:

- `signal.passed`
- `signal.score`
- `signal.reason`

No-candidate output is valid. Invalid candidate structure is not valid.

## 4. Review Chart Rules

For base methods, the workshop chart must stay standardized.

Rules:

- RDP anchor points should be marked with `H` and `L`
- those labels may include the anchor price
- RDP markers do not draw horizontal lines
- only the detected base box draws horizontal lines
- the base box must clearly show a base top and a base bottom
- the chart should stay visually simple enough for fast review

This is the current review standard used in the workshop scanner.

## 5. Queue Rules

The candidate queue is a live inbox, not a history view.

Rules:

- loading a new universe starts with a blank active queue state
- every newly loaded candidate must appear as `UNLABELED`
- historical labels and corrections must not mark a freshly loaded queue
- saved labels and corrections still belong in their storage buckets
- after a candidate is labeled or corrected, it should leave the active queue

## 6. Base Method Success Rules

A base method is useful only if it survives visual review.

For base review, the method must:

- explicitly mark a base top and base bottom
- place the box on the actual base, not just any range
- work across the `base_test_40` universe with enough consistency to be worth keeping

The following do not count as success by themselves:

- producing candidates
- having a decent score
- passing structural validation
- drawing a box that is technically valid but visually wrong

For base methods, visual correctness is the deciding rule.

## 7. Tombstone Rules

If a method does not work, it should be tombstoned instead of left in the active review flow.

A method should be tombstoned when:

- it fails visual review on the review universe
- it does not explicitly mark the base correctly
- it produces misleading boxes often enough that it wastes review time
- it is inferior to simpler surviving methods
- the method is no longer worth keeping in the pattern scanner dropdown

Tombstoning means:

- the method is marked dead for review purposes
- it is removed from the active workshop picker
- its failure is recorded so the team does not reinvent the wheel
- the code is not automatically deleted

## 8. Tombstone Procedure

When a method fails:

1. Tombstone it from the workshop pattern picker using the `X`.
2. Record the method in `backend/data/research/base-method-tombstones.json`.
3. Record the reason in `memory-bank/BASE_METHOD_TOMBSTONES.md`.
4. Verify it no longer appears in the active workshop dropdown.
5. Verify it appears on the tombstones page.

If the UI tombstone flow is unavailable, add the tombstone record manually to the JSON ledger and document the reason in the markdown tombstone log.

## 9. Keep or Kill Rule

The keep-or-kill rule is simple:

- if the scanner method clearly helps review and marks the right structure, keep it
- if it does not, tombstone it

Do not keep weak methods around just because they produce output.

## 10. Current Source Files

Primary files involved in these rules:

- `backend/src/services/pluginValidation.ts`
- `backend/data/patterns/registry.json`
- `backend/data/research/base-method-tombstones.json`
- `memory-bank/BASE_METHOD_TOMBSTONES.md`
- `frontend/public/workshop-scanner.js`
- `frontend/public/tombstones.html`
- `frontend/public/tombstones.js`
