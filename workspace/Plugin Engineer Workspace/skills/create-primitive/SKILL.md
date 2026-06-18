---
name: pattern-detector-create-primitive
description: "Use when the user wants to create a new primitive, indicator, or chart pattern detector for Pattern Detector. Examples: \"Add a Double Bottom primitive\", \"Build an ATR primitive\", \"Create a new chart pattern\", \"Wire up a Bulkowski pattern\", \"Make a new indicator scannable\""
---

# Create a Primitive (Pattern Detector)

A **primitive** is the smallest scannable, composable building block in Pattern Detector — analogous to a single technical indicator. Every chart pattern (Double Top, Head & Shoulders, Triangle), indicator (RSI, MACD, ATR), and structural signal is a primitive. Composites combine primitives into strategies.

This skill walks through the **full end-to-end contract** for shipping a new primitive: the Python plugin, the JSON definition, the registry entry, and how its tunable parameters become a sweepable `parameter_manifest` when promoted to a strategy.

## When to Use

- "Add a `<pattern_name>` primitive"
- "Build a new indicator I can scan for"
- "Wire up a Bulkowski chart pattern"
- "Create a new entry trigger / structural anchor / regime filter"
- "Convert this legacy plugin into a normalized primitive"

## The Three Files Every Primitive Needs

```
1. backend/services/plugins/<pattern_id>.py        ← Python detector logic
2. backend/data/patterns/<pattern_id>.json         ← Defaults + tunable_params manifest
3. backend/data/patterns/registry.json             ← One new entry under "patterns"
```

That's the entire contract. No other system requires touching.

## Reference Implementations (copy from these)

| Complexity | Reference file | Use when building |
|---|---|---|
| Simple indicator (oscillator / single value) | `backend/services/plugins/rsi_primitive.py` + `rsi_primitive.json` | RSI, ATR, EMA, MACD, ADX, momentum |
| Pivot-based chart pattern (Bulkowski) | `backend/services/plugins/double_top_primitive.py` + `double_top_primitive.json` | Double/Triple Top/Bottom, H&S, Quasimodo, Triangles, Wedges, Cup & Handle |
| Complex multi-stage pattern (post-break retrace, multiple visual layers) | `backend/services/plugins/head_shoulders_context_pattern.py` + `head_shoulders_context_pattern.json` | Patterns needing OTE/fib retrace zones, throwback detection, stage gating |
| Pivot-anchored harmonic-style | `backend/services/plugins/three_drives_pattern.py` + `three_drives_pattern.json` | Three Drives, Bat, Crab, Gartley, ABCD, harmonic patterns |

## Workflow

```
1. RUN gitnexus_impact on registry.json + pattern_framework.py    → check blast radius
2. Pick the closest reference plugin (table above) and READ it
3. Pick the closest reference JSON and READ it
4. WRITE backend/services/plugins/<pattern_id>.py                 → detector logic
5. WRITE backend/data/patterns/<pattern_id>.json                  → defaults + tunable_params
6. EDIT backend/data/patterns/registry.json                       → add registry entry
7. Smoke test: python -c "from plugins import <pattern_id>"
8. RUN gitnexus_detect_changes                                    → verify scope
```

## Pre-Flight Checklist (Required Decisions)

Before you write a single line, decide and write down:

- [ ] **`pattern_id`** — snake_case canonical identifier (e.g. `double_top_primitive`). Suffix with `_primitive` for primitives.
- [ ] **`category`** — one of `chart_patterns` | `indicator_signals` | `price_action` | `structure` | `volume`
- [ ] **`indicator_role`** — one of `anchor_structure` | `location` | `timing_trigger` | `regime_state` | `state_filter` | `context` | `structure_filter`
- [ ] **`composition`** — `primitive` (single detector) or `composite` (combines other primitives)
- [ ] **`artifact_type`** — usually `indicator` for primitives, `pattern` for composites
- [ ] **`library_tier`** — `core_stable` | `advanced_experimental` | `research_only`
- [ ] **`cost_class`** — `cheap` | `moderate` | `expensive` (drives autonomous-search budget)
- [ ] **`autonomy_safe`** (bool) — safe for broad autonomous search?
- [ ] **`state_compatible`** (bool) — usable in state-machine templates?
- [ ] **`source_kind`** — `native` (custom) or `imported` (TA-Lib / pandas-ta / external lib)
- [ ] **`status`** — `experimental` | `production` (default to `experimental` until validator-approved)

## File 1: The Python Plugin

### Required Signature

```python
def run_<pattern_id>_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """Returns list of candidate dicts (one per detected instance)."""
```

`data` is the OHLCV bar list, `structure` carries pre-computed RDP swing points if available, `spec` is the strategy spec (read `spec['setup_config']` for tuned params), and the function returns a list of candidates built via `pattern_framework.build_candidate(...)`.

### Required Imports

```python
from platform_sdk.ohlcv import OHLCV
from plugins.pattern_framework import (
    build_candidate, build_rule, clamp01, compute_spec_hash,
)
# For chart patterns with pivots, ALSO import:
from plugins.bulkowski_geometry import (
    as_bool, extract_rdp_pivots, find_close_break_index,
    horizontal_line, line, marker, measured_move_target,
    pct_diff, round_anchor,
)
```

### Standard Detector Skeleton

```python
def run_<pattern_id>_plugin(data, structure, spec, symbol, timeframe, **kwargs):
    setup = spec.get("setup_config", {}) or {}
    structure_cfg = spec.get("structure_config", {}) or {}

    # 1. Extract every tunable param from setup_config (with defaults)
    lookback_bars = max(60, int(setup.get("lookback_bars", 220)))
    min_score = float(setup.get("min_score", 0.55))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))
    # ... pattern-specific knobs ...

    # 2. Bail early on insufficient data
    if len(data) < 40:
        return []

    # 3. Extract pivots (RDP / structure / auto) — chart patterns only
    pivots, source_used = extract_rdp_pivots(...)

    # 4. Slide a window across the pivots, evaluate Bulkowski/geometry rules
    found = []
    for start in range(...):
        result = _evaluate_pattern(...)  # returns dict with rules, anchors, score, visual
        if result:
            found.append(result)

    # 5. Dedupe + rank, keep top max_candidates
    deduped = sorted(found, key=lambda r: r["score"], reverse=True)[:max_candidates]

    # 6. Wrap each as a candidate via build_candidate(...)
    return [build_candidate(...) for r in deduped]
```

### Rules Output (CRITICAL)

Every primitive must emit a **decomposed, auditable rule checklist** — never one opaque score. Use `build_rule(name, passed, observed, threshold)`:

```python
rules = [
    build_rule("peaks_roughly_equal", peaks_symmetric, round(peak_delta, 4), peak_symmetry_pct),
    build_rule("valley_deep_enough", valley_deep_enough, round(valley_depth, 4), valley_depth_min_pct),
    build_rule("min_bars_between_peaks", spacing_ok, bars_between, min_bars_between_peaks),
    build_rule("prior_uptrend", prior_uptrend_ok, "ok", "required"),
]
if not all(rule["passed"] for rule in rules):
    return None
```

This makes every reject auditable in the UI and traceable in validator reports.

### Output Ports

Every candidate emits `output_ports` so composites can wire it up:

```python
output_ports = {
    "signal": {"passed": bool, "score": float, "reason": str},
    "pattern_geometry": {"direction": str, "anchors": dict, "score": float},
    "entry_zone": {"passed": bool, "current_price": float, ...},
    # Optional pattern-specific ports:
    "bulkowski_priors": {"failure_rate": float, "avg_decline_pct": float, ...},
}
```

### Visual Layer

Anchors, markers, and overlay lines that make the pattern obvious on the chart:

```python
markers = [
    marker(data, idx, "aboveBar", "#ef4444", "circle", "P1"),
    marker(data, idx, "belowBar", "#3b82f6", "square", "V"),
]
overlays = [
    line(data, [p1, valley, p2], "#ef4444", "Pattern Structure", line_width=2),
    horizontal_line(data, start_idx, end_idx, neckline_price, "#3b82f6", "Neckline", line_style=2),
]
```

The visual MUST mark the actual geometry the detector used. Don't draw lines the rules didn't validate.

### Dual Mode (for backtest-aware primitives)

If the primitive will be used as a **timing trigger** in backtests (entry signal), implement a second mode that returns just the signal bar indices:

```python
def run_<pattern_id>_plugin(data, structure, spec, symbol, timeframe, mode="scan", **kwargs):
    if mode == "signal":
        return _generate_signal_indices(data, spec)  # → set[int]
    # ... normal scan mode ...
```

See `rsi_primitive.py::_generate_signal_indices` for the canonical example. Chart pattern primitives without a clean per-bar trigger semantic can skip this and stay scan-only (set `default_entry.entry_type = "analysis_only"` in JSON).

## File 2: The JSON Definition

### Required Top-Level Fields

```json
{
  "pattern_id": "<id>",
  "name": "<Display Name>",
  "category": "<see decisions checklist>",
  "description": "<one paragraph: what it detects, when it fires, what makes it special>",
  "author": "system",
  "version": "1.0.0",
  "plugin_file": "plugins/<pattern_id>.py",
  "plugin_function": "run_<pattern_id>_plugin",
  "pattern_type": "<pattern_id>",
  "artifact_type": "indicator",
  "composition": "primitive",
  "indicator_role": "<see decisions checklist>",
  "library_tier": "core_stable",
  "autonomy_safe": true,
  "state_compatible": true,
  "cost_class": "moderate",
  "search_tags": ["..."],
  "source_kind": "native",
  "status": "experimental",
  "min_data_bars": 40,
  "suggested_timeframes": ["D", "W"]
}
```

### `default_setup_params` — The Default Spec

Every knob the detector reads from `setup_config` must have a default here. This is what `setup_config` looks like when the primitive is first added to a strategy.

### `tunable_params` — The Sweep Manifest (CRITICAL)

This is the canonical contract. **Every threshold the detector reads must appear here**, because it becomes the `parameter_manifest` when promoted to a strategy. If you don't list it here, the validator and sweep cannot tune it.

Each entry needs:

```json
{
  "key": "peak_symmetry_pct",
  "label": "Peak Symmetry (Bulkowski ~5%)",
  "type": "float",
  "min": 0.01,
  "max": 0.15,
  "step": 0.005,
  "default": 0.05,
  "description": "Max % difference between the two peaks for them to be considered roughly equal"
}
```

Types: `int`, `float`, `bool`, `select` (with `options: [...]`), `enum` (alias for select).

See `docs/parameter-manifest-architecture.md` for how `tunable_params` becomes a full `parameter_manifest` (with `path`, `anatomy`, `identity_preserving`, `sweep_enabled`, `sensitivity_enabled`, `failure_modes_targeted`) when the strategy promoter runs.

### `default_risk_config` — Suggested Defaults

```json
{
  "stop_type": "atr_multiple",
  "atr_length": 14,
  "atr_multiplier": 2.0,
  "take_profit_R": 2.0,
  "max_hold_bars": 30,
  "max_concurrent_positions": 3
}
```

### Optional: `bulkowski_priors` (for classical chart patterns)

```json
{
  "bulkowski_priors": {
    "source": "Bulkowski, Encyclopedia of Chart Patterns, 3rd ed.",
    "failure_rate": 0.11,
    "avg_decline_pct": 0.20,
    "pullback_rate": 0.59,
    "notes": "Reference priors only. Validator/sweep should derive symbol/regime-specific values."
  }
}
```

These are **reference values, not detector thresholds** — they show up in the AI context and UI for grounding, but the validator overrides them per regime.

## File 3: The Registry Entry

Append to the `patterns` array in `backend/data/patterns/registry.json`:

```json
{
  "pattern_id": "<id>",
  "name": "<Display Name>",
  "category": "<category>",
  "definition_file": "<pattern_id>.json",
  "status": "experimental",
  "artifact_type": "indicator",
  "composition": "primitive",
  "indicator_role": "<role>",
  "library_tier": "core_stable",
  "autonomy_safe": true,
  "state_compatible": true,
  "cost_class": "moderate",
  "search_tags": ["..."],
  "source_kind": "native"
}
```

The registry is the discovery surface — strategy builders, AI composer, scanner all read from it.

## Smoke Test

```bash
cd backend/services && python -c "import sys; sys.path.insert(0, '.'); from plugins import <pattern_id>; print('OK:', <pattern_id>.run_<pattern_id>_plugin.__name__)"
```

If imports fail, the plugin won't load. Fix before committing.

## Pre-Commit Verification

```
1. ReadLints on the three files
2. Smoke import test (above)
3. gitnexus_detect_changes → verify only the three expected files changed
4. (Optional) Run scanner on a known symbol to sanity check candidate output
```

## Common Mistakes

- **Knob exists in code but missing from `tunable_params`** → validator can't tune it, sweep blind to it, AI can't recommend it. Always declare every knob.
- **Single opaque score, no rule checklist** → unauditable, breaks validator UI. Use `build_rule()` for every check.
- **Visual draws lines the rules didn't check** → misleading. Anchors, markers, and overlays must reflect actual detector logic.
- **`min_data_bars` too low** → detector runs before warmup, returns garbage. Set realistically (RSI-14 needs ~30, chart patterns ~40-60).
- **Forgetting registry entry** → plugin loads but is invisible to scanner / builders / AI. Always all three files.
- **`status: "production"` on day 1** → ship as `experimental`, promote after validator approval on the review universe.
- **Marking `autonomy_safe: true` for an expensive detector** → autonomous search will burn budget. Set `cost_class: "expensive"` and `autonomy_safe: false` until proven.

## Reference Docs

| Doc | What you get |
|---|---|
| `docs/HOW-TO-CREATE-A-PRIMITIVE.md` | Long-form companion to this skill |
| `docs/pattern-detector-framework.md` | Framework rationale + design rules |
| `docs/parameter-manifest-architecture.md` | How `tunable_params` becomes a `parameter_manifest` |
| `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md` | Canonical primitive contract (v0) |
| `memory-bank/PRIMITIVE_AUDIT_REPORT.md` | Audit findings on existing primitives |

## Related Skills

- `pattern-detector/create-strategy` — how to compose primitives into strategies (TODO)
- `gitnexus/gitnexus-impact-analysis` — run before editing shared files like `registry.json` or `pattern_framework.py`
- `gitnexus/gitnexus-refactoring` — for renaming or moving primitives safely
