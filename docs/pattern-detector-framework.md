# Pattern Detector Framework

This document captures the plugin-side pattern framework added in March 2026.

## Goal

Make pattern detectors reusable without forcing every plugin to reinvent:

- price preprocessing
- pivot extraction
- rule checklist assembly
- chart annotations
- candidate contract wiring

## Pipeline

The framework lives in `backend/services/plugins/pattern_framework.py` and standardizes a four-step flow:

1. Preprocess a selected OHLC-derived series.
2. Extract pivots from either local extrema or shared structure.
3. Evaluate a geometric predicate over a pivot window.
4. Emit a contract-valid candidate with anchors, visuals, `node_result`, and `output_ports`.

## Why This Exists

This is an explicit response to the same design pattern seen in external chart-pattern repos:

- keep the predicate logic simple
- vary the preprocessing layer
- compare detector families instead of betting on one formula

The key repo that informed this direction was `white07S/TradingPatternScanner`, but the implementation here is adapted to this codebase's candidate contract and backtest-aware architecture.

## Reference Plugin

`backend/services/plugins/head_shoulders_context_pattern.py` is the reference implementation.

It demonstrates:

- RDP-first structural swing extraction
- pivot-source switching: `rdp`, `structure`, or `auto`
- decomposed rule checklist output
- structured anchors for shoulders, neckline/protected low, and break leg
- post-break fib/OTE retrace gating instead of neckline-break entry

It is intentionally experimental. The current version is closer to a structural distribution/retrace detector than a textbook neckline-break scanner.

## Design Rules

- Preprocessing and pattern predicates should stay separate.
- Detector families should share one predicate across multiple preprocessing modes.
- Rule outputs should stay decomposed and auditable.
- Visuals should mark the actual geometry the detector used.
- Experimental detectors should default to `entry_ready = false` until validated on the real review universe.

## Migration Path

Existing plugins do not need immediate refactors.

Use the framework when:

- a new detector needs multiple preprocessing variants
- a detector should expose explicit geometry rather than one opaque score
- a plugin is becoming repetitive enough that candidate assembly is obscuring the pattern logic

The head-and-shoulders plugin is a reminder that the framework does not require one fixed recipe. The shared value is the contract wiring and explicit rule output; the detector itself can be local-extrema-based, RDP-based, or any other structural reduction that fits the trading workflow.
