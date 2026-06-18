# Primitive and Pattern Authoring Framework

This is the canonical framework for creating, scanning, reviewing, calibrating, keeping, and tombstoning primitive and pattern scanner methods.

It consolidates the old pattern scanner rules, pattern detector framework notes, base method review workflow, and synthetic calibration methodology.

For the broader product boundary, see `../indicator/indicator-architecture.md`.

## Core Boundary

```text
Primitive -> emits one reusable metric/event/state component
Composite -> combines primitives and may emit a stateful signal
Strategy  -> wraps a primitive/composite state with entry, exit, risk, and execution rules
```

Scanner consumes primitives and composites.

Validator consumes strategies.

## Purpose

Primitive and pattern methods exist to:

- detect one reusable signal or structure
- emit structured candidates
- render the result clearly on the review chart
- expose tunable parameters and output ports
- support composition into larger signals
- support later wrapping into strategies

For pattern and base methods, the final standard is visual correctness and contract correctness, not just numeric output.

## Definition Contract

Each method must have a valid pattern definition.

Required fields:

- `pattern_id`: lowercase snake case
- `name`
- `pattern_type`: must match `pattern_id`
- `plugin_file`: usually `plugins/<pattern_id>.py`, or `plugins/composite_runner.py` for composites
- `plugin_function`: usually `run_<pattern_id>_plugin`
- `artifact_type`: `indicator` or `pattern`
- `composition`: `primitive`, `composite`, or `preset`
- `category`: lowercase snake case

Primitive indicators must also define:

- `tunable_params`
- matching defaults in `default_setup_params`
- `indicator_role`

Pattern artifacts must also define:

- `pattern_role`

Primary source files:

- `backend/src/services/pluginValidation.ts`
- `backend/data/patterns/registry.json`

## Plugin Pipeline

The shared framework lives in `backend/services/plugins/pattern_framework.py`.

The standard four-step flow is:

1. Preprocess a selected OHLC-derived series.
2. Extract pivots from local extrema, RDP, or shared structure.
3. Evaluate a geometric or numeric predicate.
4. Emit a contract-valid candidate with anchors, visuals, `node_result`, and `output_ports`.

Design rules:

- Keep preprocessing and predicates separate.
- Share predicates across preprocessing modes when possible.
- Keep rule outputs decomposed and auditable.
- Mark the actual geometry the detector used.
- Default experimental detectors to `entry_ready = false` until reviewed.

Reference implementation:

- `backend/services/plugins/head_shoulders_context_pattern.py`

## Candidate Output Contract

Every scanner method must emit valid structured candidates.

Each candidate should include:

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

`node_result` should include:

- `passed`
- `score`
- `features`
- `anchors`
- `reason`

`output_ports` should include at least:

- `signal.passed`
- `signal.score`
- `signal.reason`

No-candidate output is valid. Invalid candidate structure is not valid.

## Output Ports

Composites wire primitives together through `output_ports`.

Every primitive should expose a basic signal port:

```json
{
  "signal": {
    "passed": true,
    "score": 0.72,
    "reason": "RSI crossed above threshold"
  }
}
```

Pattern-specific ports are encouraged when they help composition, for example:

- `oscillator_state`
- `bulkowski_priors`
- `base_box`
- `active_leg`
- `valuation_state`
- `fundamental_quality`

## Dual Mode

Some primitives need a scan mode and a faster signal mode.

Scan mode returns full candidates for Scanner review.

Signal mode returns compact bar indices or state transitions for backtests and Research signal studies.

Use signal mode when the method is a clean per-bar trigger. Methods that produce context windows can remain scan-only.

## Synthetic Calibration

Synthetic calibration validates detector mechanics against known ground truth before real-market testing.

Use it when:

- the expected geometry can be generated
- false positives are expensive
- the detector has many tunable thresholds
- you need to know whether failure is geometric or market-specific

Calibration flow:

1. Build synthetic charts with known signal regions.
2. Run the detector across parameter grids.
3. Measure timing, location, false positives, and missed detections.
4. Pick candidate defaults based on mechanical correctness.
5. Then test on real review universes.

Failure modes:

- `MISSED`: detector did not fire
- `WRONG_LOCATION`: detector fired in the wrong place
- `FALSE_POSITIVE`: detector fired outside ground truth
- `UNSTABLE`: small parameter changes cause large behavior changes

The detailed historical notes live in `../archive/synthetic-calibration-framework.md`. Keep that file as a calibration reference until its scripts and examples are fully migrated here.

## Review Chart Rules

For base methods, the workshop chart should stay standardized:

- RDP anchor points should be marked with `H` and `L`.
- Anchor labels may include price.
- RDP markers should not draw horizontal lines.
- Only the detected base box should draw horizontal lines.
- The base box must clearly show top and bottom.
- The chart should stay simple enough for fast review.

## Queue Rules

The candidate queue is a live inbox, not a history view.

Rules:

- Loading a new universe starts with a blank active queue.
- Newly loaded candidates appear as `UNLABELED`.
- Historical labels and corrections must not mark a fresh queue.
- Saved labels and corrections still belong in their storage buckets.
- After a candidate is labeled or corrected, it should leave the active queue.

## Base Method Review Workflow

Run the centralized suite:

```bash
cd backend
npm run base:suite -- --symbols CRNX,NVDA,AMD,AAPL,TSLA --interval 1wk --period 5y --strict-base
```

Use these fields first:

- `cov`: symbols with filtered candidates
- `raw`: symbols with raw candidates before strict filtering
- `mark`: symbols where the method emitted a price box
- `full`: symbols where the method emitted a price box plus time window
- `ann`: average annotation score for the review candidate

Then use chart review to answer:

- Did the method mark the intended base?
- Did it mark the correct floor and cap?
- Did it mark the right start and end?
- Is the marked base useful when the touch count is sparse?

## Keep, Tune, or Tombstone

A method is useful only if it survives review.

Keep it when:

- it clearly helps review
- it marks the right structure
- it emits contract-valid candidates
- it is not inferior to a simpler method

Tune it when:

- it has promising raw candidates
- it marks something useful but filters too aggressively
- it is close enough that parameter repair is reasonable

Tombstone it when:

- it fails visual review
- it does not mark the intended structure
- it often emits misleading boxes
- it wastes review time
- it is inferior to simpler surviving methods

Tombstoning means:

- the method is marked dead for review purposes
- it is removed from the active workshop picker
- its failure is recorded
- the code is not automatically deleted

Record tombstones in:

- `backend/data/research/base-method-tombstones.json`
- `memory-bank/BASE_METHOD_TOMBSTONES.md`

Minimum tombstone fields:

- `pattern_id`
- date
- review batch
- verdict
- failure mode
- evidence
- conditions required before revisiting

## Source Files

Primary files involved:

- `backend/src/services/pluginValidation.ts`
- `backend/data/patterns/registry.json`
- `backend/services/plugins/pattern_framework.py`
- `backend/data/research/base-method-tombstones.json`
- `memory-bank/BASE_METHOD_TOMBSTONES.md`
- `frontend/public/workshop-scanner.js`
- `frontend/public/tombstones.html`
- `frontend/public/tombstones.js`
