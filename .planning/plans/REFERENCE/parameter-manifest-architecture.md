# Parameter Manifest Architecture

This document defines the canonical parameter architecture for Pattern Detector.

Its purpose is to make strategy parameters work consistently across:

- Strategy creation
- Indicator Studio
- AI Composer
- Blockly Composer
- Node Editor Composer
- Strategy storage and versioning
- Validator sensitivity testing
- Parameter Sweep
- AI copilots and reviewers

The goal is simple:

- parameters are declared once
- consumed everywhere
- never re-inferred separately in different subsystems

## Problem

Today, parameter exposure is fragmented.

- Sweep uses hardcoded frontend preset maps.
- Validator sensitivity uses family-specific code paths.
- Strategy definitions do not declare which parameters are officially exposed.
- Indicator Studio builders do not emit a canonical parameter contract.
- AI surfaces do not have one shared source of truth for which knobs are safe to turn.

This creates drift.

Examples of drift:

- Sweep can expose knobs that do not materially affect a strategy.
- Validator sensitivity can test generic knobs that are not the true structural parameters for a strategy family.
- A strategy can be created without enough metadata for downstream repair and audit.

## Core Rule

Every strategy family must declare a canonical `parameter_manifest`.

That manifest is the only authoritative source for:

- which parameters are exposed
- what they mean
- where they live in the spec
- which anatomy bucket they belong to
- whether they are identity-preserving
- whether they are sweep-eligible
- whether they are sensitivity-test eligible

## Design Principles

### Declare Once

Parameter definitions must be declared once at the strategy family level and then persisted into saved strategy versions.

### Consume Everywhere

Sweep, Validator, Strategy Details, and AI copilots must all read the same manifest.

### Preserve Identity

Only parameters marked as identity-preserving may be used for repair sweeps.

### Anatomy First

Every exposed parameter must belong to a strategy anatomy bucket.

Current canonical anatomy:

- Structure
- Location
- Entry Timing
- Regime Filter
- Stop Loss
- Take Profit
- Risk Controls

### Failure-Driven Repair

The manifest should support targeting parameters to failure modes such as:

- low trade count
- high sensitivity
- high drawdown
- poor OOS degradation
- weak walk-forward stability

## Canonical Manifest Shape

Each strategy should expose a `parameter_manifest` array.

Each manifest item should include:

- `key`
  - stable logical identifier
- `label`
  - user-facing display name
- `path`
  - JSON path in the saved strategy spec
- `anatomy`
  - `structure`, `location`, `entry_timing`, `regime_filter`, `stop_loss`, `take_profit`, or `risk_controls`
- `type`
  - `int`, `float`, `enum`, `bool`
- `description`
  - short explanation of what the parameter does
- `identity_preserving`
  - whether changing the parameter keeps the strategy the same strategy
- `sweep_enabled`
  - whether Sweep can use this knob
- `sensitivity_enabled`
  - whether Validator sensitivity can use this knob
- `suggested_values`
  - recommended values for Sweep
- `min`
  - optional numeric lower bound
- `max`
  - optional numeric upper bound
- `step`
  - optional UI step value
- `priority`
  - ranking hint for AI and UI
- `failure_modes_targeted`
  - optional list such as `["low_trade_count", "high_sensitivity"]`

## Where the Manifest Lives

There are two layers.

### Family Definition Layer

Each strategy family should define its canonical manifest in code.

This is the authoring source.

### Saved Strategy Layer

When a strategy is created or versioned, the resolved manifest should be copied into the saved `StrategySpec`.

This makes the strategy self-describing and portable.

## System Responsibilities

### Indicator Studio

Indicator Studio builders must emit a parameter manifest when a strategy is created.

This includes:

- AI Composer
- Blockly Composer
- Node Editor Composer

The builders should map sockets, stages, and config fields to anatomy buckets and exposed parameters.

### Strategy Storage

Saved strategies must persist `parameter_manifest` with the rest of the strategy spec.

This allows downstream systems to work from the saved version directly instead of re-deriving exposure rules.

### Validator

Validator sensitivity testing must use:

- `manifest.filter(p => p.sensitivity_enabled)`

If a strategy lacks a manifest, Validator may temporarily use a family adapter fallback, but the fallback should be treated as transitional only.

### Parameter Sweep

Sweep must use:

- `manifest.filter(p => p.sweep_enabled)`

Sweep anatomy cards, parameter dropdowns, labels, and suggested values should all come from the manifest.

### AI Surfaces

AI surfaces should be able to read:

- strategy spec
- parameter manifest
- validation reports
- sweep comparisons

This enables grounded recommendations such as:

- what failed
- which knob best targets that failure
- which values should be tested
- whether the strategy should be repaired, promoted, or tombstoned

## Migration Strategy

This should be rolled out in phases.

### Phase 1: Foundation

- Add `parameter_manifest` to `StrategySpec`
- Add shared manifest types
- Add family manifest adapters for existing strategies

### Phase 2: Validator + Sweep

- Validator sensitivity reads strategy-native manifest params
- Sweep reads strategy-native manifest params
- Keep existing generic fallbacks only as temporary compatibility paths

### Phase 3: Strategy Creation

- Builders and composers emit manifests for newly created strategies
- Saved versions persist the manifest automatically

### Phase 4: Audit and Cleanup

- Audit all existing strategy families
- Remove family-specific one-off parameter logic where manifest coverage exists
- Add tooling to detect missing or invalid manifests

Audit command:

- `cd backend && npm run manifest:audit`
- `cd backend && npm run manifest:backfill`

## Audit Rules

Every strategy family should pass these checks:

- every sweep-exposed parameter path exists in the spec
- every sensitivity parameter path exists in the spec
- every exposed parameter is identity-preserving if used for repair
- every exposed parameter is assigned to the correct anatomy bucket
- suggested sweep values are materially capable of changing behavior
- no generic fallback remains once the manifest is available

## Initial Family Rollout

The first families to normalize should be:

1. `density_base_detector_v1_pattern`
2. `ma_crossover`
3. `wyckoff_accumulation_rdp`
4. `pullback_uptrend_entry_composite`

These give good coverage across:

- monolithic pattern families
- crossover strategies
- structure-heavy setup families
- composite entry systems

## Immediate Implementation Priority

The first end-to-end implementation should do three things:

1. Persist `parameter_manifest` in `StrategySpec`
2. Make Validator sensitivity prefer manifest-driven parameters
3. Make Sweep prefer manifest-driven parameters

That gives one shared source of truth for the two systems that currently need it most.

## Long-Term Outcome

When this architecture is complete:

- strategy creation will declare real knobs explicitly
- Validator will test the right knobs
- Sweep will expose the right knobs
- AI will recommend the right knobs
- strategy anatomy will be grounded in actual declared metadata

This is the intended canonical parameter system for Pattern Detector.
