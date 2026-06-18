# Primitive Normalization Contract v0

**Status:** ACTIVE  
**Created:** 2026-03-21  
**Parent plan:** `ACTIVE/primitive-normalization-engine-and-autonomous-research.md`  
**Purpose:** Define the first canonical contract for imported and custom primitives so the app can consume one normalized primitive language regardless of indicator source.

---

## Goal

Every primitive, whether it comes from:

- an external indicator library
- an existing custom plugin
- a structural family signal
- a fundamentals layer
- a future research-only primitive

must be normalized into the same internal contract before the rest of the app consumes it.

This contract is the boundary between:

- source-specific math
- app-specific strategy authoring and research behavior

---

## Design Rule

The app should never consume raw third-party indicator outputs directly.

All primitives must pass through:

```text
source adapter
→ normalization engine
→ canonical primitive contract
→ registry / builders / research / validator / scanner
```

---

## v0 Contract Shape

## 1. Identity

Required:

- `pattern_id`
- `name`
- `category`
- `artifact_type`
- `composition`

Rules:

- `pattern_id` is the canonical app identifier
- source library names never leak into app-facing IDs
- imported indicators still look like native Pattern Detector primitives

Example:

```json
{
  "pattern_id": "rsi_primitive",
  "name": "RSI (Primitive)",
  "category": "indicator_signals",
  "artifact_type": "indicator",
  "composition": "primitive"
}
```

---

## 2. Role

Required:

- one canonical primitive role

Allowed v0 role set:

- `anchor_structure`
- `location`
- `timing_trigger`
- `regime_state`
- `state_filter`
- `context`
- `structure_filter`

Rules:

- each primitive must have one primary role
- secondary tags may exist later, but v0 requires a single main placement role
- role must drive builder placement and autonomous search eligibility

---

## 3. Parameter Contract

Required:

- normalized parameter list
- defaults
- valid bounds
- parameter types

Desired compatibility:

- existing `tunable_params`
- existing `parameter_manifest`

Each parameter should eventually expose:

- `key`
- `label`
- `type`
- `default`
- `min`
- `max`
- `step`
- `options`
- `identity_preserving`
- `sweep_enabled`
- `sensitivity_enabled`

Rules:

- external library parameter names may be remapped to app-standard names
- thresholds and periods should use consistent naming conventions
- warmup-sensitive parameters must affect `min_data_bars`

---

## 4. Runtime Contract

Required normalized runtime fields:

- `min_data_bars`
- `warmup_bars`
- `readiness`
- `values`
- `signal`
- `score`
- `metadata`

### 4A. Readiness

Every primitive should expose a readiness state, not just raw output values.

Example shape:

```json
{
  "ready": true,
  "reason": null,
  "warmup_bars_remaining": 0
}
```

Rules:

- no downstream consumer should have to infer readiness from `NaN`
- imported libraries that return partial/empty data must be normalized into explicit readiness

### 4B. Values

`values` should contain the canonical current-state payload used by UI, AI, validator, and scanner.

Example:

```json
{
  "current": 43.2,
  "prior": 39.8,
  "slope": 3.4
}
```

Rules:

- keys should be stable and human-reasonable
- app consumers should not need to parse library-specific series labels

### 4C. Signal

Signal contract should normalize verdict semantics.

Example:

```json
{
  "fired": true,
  "verdict": "RECOVERING",
  "direction": "bullish",
  "reason": "rsi_crossed_up_from_oversold"
}
```

Rules:

- standard indicators should emit app-readable signal semantics
- raw series-only indicators can emit `fired: false` if they are analysis-only in v0

### 4D. Score

Optional but strongly preferred:

```json
{
  "confidence": 0.74,
  "normalized_score": 0.74
}
```

Rules:

- score semantics should be explicit
- if a primitive has no meaningful confidence concept, return `null` rather than inventing fake precision

---

## 5. Visualization Contract

Required:

- overlay specification for chart use when relevant

Possible fields:

- `chart_indicator`
- `panel`
- `paneHeight`
- `overlays`
- `seriesType`

Rules:

- imported indicators must render through the same chart contract as native primitives
- front-end renderers should not care whether the primitive is imported or custom

---

## 6. Autonomy Metadata

Required v0 autonomy fields:

- `library_tier`
- `autonomy_safe`
- `state_compatible`
- `cost_class`
- `search_tags`

### 6A. Library tier

Allowed values:

- `core_stable`
- `advanced_experimental`
- `research_only`

### 6B. Autonomy safety

Meaning:

- `true`: safe for broad autonomous search
- `false`: only use via explicit user opt-in or specialized research mode

### 6C. State compatibility

Meaning:

- whether the primitive may safely participate in state-machine templates

### 6D. Cost class

Allowed values:

- `cheap`
- `moderate`
- `expensive`

This helps the research engine avoid broad search over primitives that are too costly.

---

## 7. Registry Compatibility

The existing registry format can be extended rather than replaced immediately.

### Existing fields already aligned

- `pattern_id`
- `name`
- `category`
- `definition_file`
- `status`
- `artifact_type`
- `composition`
- `indicator_role`

### Fields to add or normalize

- `library_tier`
- `autonomy_safe`
- `state_compatible`
- `cost_class`
- `search_tags`
- normalized parameter metadata where missing

---

## 8. Source Adapter Interface

Each imported library should implement an adapter with this rough shape:

```text
adapter input:
- bars
- normalized params
- runtime context

adapter output:
- raw values / series / events

normalizer input:
- raw adapter output
- primitive metadata
- params

normalizer output:
- canonical primitive contract payload
```

The adapter is source-specific.
The normalizer is app-specific.

---

## 9. First Imported Core Set

v0 import target set:

1. `RSI`
2. `ATR`
3. `EMA`
4. `SMA`
5. `MACD`

Why these first:

- low controversy
- useful across scanner, validator, builders, and research
- enough to prove the adapter + normalization path without exploding scope

---

## 10. Current Known Registry Cleanup Targets

These need explicit review during implementation:

- `structural_family_signal`
  - role assignment must match intended builder placement and autonomous search behavior
- timing/context/state roles across experimental primitives
- any primitive currently usable in builders but not clearly classified for autonomy

---

## 11. v0 Acceptance Criteria

This contract is ready when:

1. at least one external indicator source can be adapted through it
2. imported indicators and custom primitives can be described using the same contract language
3. builders and research can reason over primitives by role and tier, not source origin
4. readiness/warmup semantics are explicit and no longer inferred from raw `NaN` behavior

---

## 12. Immediate Next Build Step

Implement `Normalization Engine v0` with:

- one source adapter
- one normalizer path
- one or two imported indicators
- registry metadata extensions for tier/autonomy/state/cost

