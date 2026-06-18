# How to Create a Primitive

This is the long-form companion to `.claude/skills/pattern-detector/create-primitive/SKILL.md`. The skill is for fast agent lookups; this doc is for humans (or agents) who need the full context, examples, and rationale.

## What is a Primitive?

A **primitive** is the smallest scannable, composable building block in Pattern Detector. It is to a strategy what a single technical indicator is to a trading system.

Examples of primitives:

- **Indicators**: RSI, MACD, ATR, EMA, ADX
- **Chart patterns**: Double Top, Head & Shoulders, Triangle, Cup & Handle
- **Structural signals**: Wyckoff Spring, RDP swing structure
- **Harmonic patterns**: Three Drives, Bat, Crab
- **Volume signals**: Volume climax, accumulation/distribution

Primitives can be scanned directly when the user wants raw matches for one condition. They can also be combined into **composites**.

Primitives do not define trade-management rules. If the artifact says how to enter, where to stop, where to take profit, how to size, or when to exit, it belongs in a **strategy**.

See `indicator-architecture.md` for the canonical Primitive -> Composite -> Strategy boundary.

## Architecture Overview

Current methodology summary:

```text
Primitive -> emits one reusable metric/event/state component
Composite -> wires primitives together and may emit a stateful signal
Strategy  -> wraps a primitive/composite state with entry, exit, risk, and execution rules

Scanner consumes primitives and composites.
Validator consumes strategies.
```

```
┌──────────────────────────────────────────────────────────────────┐
│                         STRATEGY                                 │
│  setup_config + entry_config + risk_config + exit_config + ...   │
│  parameter_manifest (derived from primitive tunable_params)      │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ promotes
                              │
┌──────────────────────────────────────────────────────────────────┐
│                         COMPOSITE                                │
│   Wires N primitives via output_ports → produces signal          │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ composes
                              │
┌──────────────────────────────────────────────────────────────────┐
│                         PRIMITIVE                                │
│  Plugin .py + Definition .json + Registry entry                  │
│  Reads spec.setup_config, returns candidates with rules+anchors  │
└──────────────────────────────────────────────────────────────────┘
```

## The Three-File Contract

Every primitive consists of exactly three artifacts:

### 1. Python Plugin — `backend/services/plugins/<pattern_id>.py`

The actual detector logic. Reads `spec['setup_config']` for tuned parameters, reads OHLCV `data` and pre-computed `structure`, returns a list of candidate dicts. Each candidate has decomposed rule output, anchors, visuals, and output ports.

### 2. JSON Definition — `backend/data/patterns/<pattern_id>.json`

Declares:
- **Identity**: `pattern_id`, `name`, `description`, `version`
- **Wiring**: `plugin_file`, `plugin_function`
- **Defaults**: `default_setup_params`, `default_risk_config`, `default_structure_config`
- **Sweep manifest**: `tunable_params` — every knob the detector reads
- **Metadata**: `category`, `composition`, `indicator_role`, `library_tier`, `cost_class`, `autonomy_safe`, `state_compatible`, `search_tags`, `source_kind`
- **Optional**: `bulkowski_priors`, `examples`, `suggested_timeframes`, `min_data_bars`

### 3. Registry Entry — `backend/data/patterns/registry.json`

A summary entry under the `patterns` array that the strategy builders, AI composer, and scanner use for discovery. Mirrors the JSON definition's metadata (no defaults or tunables — those live in the per-primitive JSON).

## Reference Implementations

The codebase has four canonical examples spanning the complexity spectrum:

| Example | Use as template for |
|---|---|
| `rsi_primitive` | Single-value oscillators: RSI, MACD signal, momentum, ADX, CCI |
| `double_top_pattern` | Pivot-based Bulkowski chart patterns: Double/Triple Top/Bottom, H&S, Quasimodo |
| `head_shoulders_context_pattern` | Multi-stage patterns with post-break retrace zones, throwbacks, OTE/fib gating |
| `three_drives_pattern` | Pivot-anchored harmonic patterns: Three Drives, Gartley, Bat, Crab, ABCD |

Always read the closest reference end-to-end before writing your own. The plugin contract is large enough that copying the wrong template doubles the work.

## The Detector Function

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
    """Returns candidates (one per detected pattern instance)."""
```

`**kwargs` is required to absorb future contract additions without breaking older plugins.

### The Standard Pipeline

Every primitive follows this four-step pipeline (codified in `pattern_framework.py`):

1. **Preprocess** — read tunable params from `spec['setup_config']`, validate input data length
2. **Extract** — pull pivots from `structure` (pre-computed RDP) or run RDP fresh; or compute the indicator series
3. **Evaluate** — slide a window across pivots/bars and check geometric/numeric rules
4. **Emit** — wrap each detected instance as a candidate via `build_candidate(...)`

### Bulkowski Geometry Helper

For chart pattern primitives that work with pivots, use the shared `bulkowski_geometry.py` helpers:

- `extract_rdp_pivots(...)` — unified pivot extraction (structure → fallback to RDP)
- `marker(data, idx, position, color, shape, text)` — chart annotations
- `line(data, points, color, label, ...)` — overlay polylines
- `horizontal_line(data, start, end, price, color, label, ...)` — neckline / target / stop bands
- `find_close_break_index(data, start, threshold, direction)` — confirmation detection
- `measured_move_target(top, bottom, breakout, direction)` — Bulkowski-style measured move
- `pct_diff(a, b)` — symmetric percentage distance
- `as_bool(value, default)` — robust bool coercion from spec
- `round_anchor(point)` — clean anchor dict for serialization

## Decomposed Rule Output

Every primitive must emit an **auditable rule checklist** instead of one opaque pass/fail score. This is enforced by the validator and surfaced in the UI.

```python
from plugins.pattern_framework import build_rule

rules = [
    build_rule("peaks_roughly_equal", peaks_symmetric, observed=peak_delta, threshold=peak_symmetry_pct),
    build_rule("valley_deep_enough", valley_deep_enough, observed=valley_depth, threshold=valley_depth_min_pct),
    build_rule("min_bars_between_peaks", spacing_ok, observed=bars_between, threshold=min_bars_between_peaks),
    build_rule("prior_uptrend", prior_uptrend_ok, observed="ok", threshold="required"),
]

if not all(rule["passed"] for rule in rules):
    return None
```

The output looks like this in the candidate:

```json
{
  "rules": [
    {"name": "peaks_roughly_equal", "passed": true, "observed": 0.032, "threshold": 0.05},
    {"name": "valley_deep_enough", "passed": true, "observed": 0.14, "threshold": 0.10},
    ...
  ]
}
```

This makes every reject explainable, every parameter sweep targeted, and every AI explanation grounded.

## The Tunable Params Manifest

This is the most important part of the JSON definition. Every threshold, period, lookback, or threshold the Python detector reads from `setup_config` must appear here.

### Why?

The strategy promoter reads `tunable_params` and produces the strategy's `parameter_manifest`. That manifest is the single source of truth for:

- **Parameter Sweep** — which knobs to vary, with what suggested values
- **Validator sensitivity testing** — which knobs to perturb
- **Strategy Details UI** — which knobs to show
- **AI Composer / Repair** — which knobs to recommend tuning when failure modes appear
- **Sweep anatomy cards** — bucket categorization

If a knob is missing from `tunable_params`, it is invisible to all of the above. The detector might use it, but no system can tune it.

### Per-Param Fields

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

| Field | Required | Notes |
|---|---|---|
| `key` | yes | Stable identifier matching the `setup_config` key the detector reads |
| `label` | yes | Human-readable, shown in UI |
| `type` | yes | `int`, `float`, `bool`, `select` (with `options`), `enum` |
| `default` | yes | Must match `default_setup_params[key]` |
| `min`, `max`, `step` | for numeric | Sweep bounds |
| `options` | for select/enum | Array of allowed values |
| `description` | recommended | Surfaces in UI tooltips and AI context |

### Promotion to `parameter_manifest`

When the strategy promoter wraps the primitive into a strategy, each `tunable_param` becomes a full `parameter_manifest` entry with additional fields:

```json
{
  "key": "peak_symmetry_pct",
  "label": "Peak Symmetry",
  "path": "setup_config.peak_symmetry_pct",
  "anatomy": "structure",
  "type": "float",
  "identity_preserving": true,
  "sweep_enabled": true,
  "sensitivity_enabled": true,
  "suggested_values": [0.03, 0.04, 0.05, 0.06, 0.07],
  "min": 0.01,
  "max": 0.15,
  "step": 0.005,
  "priority": 70,
  "failure_modes_targeted": []
}
```

The promoter handles `path`, `anatomy`, `identity_preserving`, `sweep_enabled`, `sensitivity_enabled`, `suggested_values`, and `priority` — you don't need to declare them in the primitive JSON. But you can override defaults if needed.

See `../parameter-manifest-architecture.md` for the full manifest spec.

### Anatomy Buckets

When the promoter assigns an `anatomy` to each manifest entry, it uses these buckets:

- `structure` — pattern geometry knobs (lookback, symmetry, depth, swing settings)
- `location` — where in the chart context the pattern can fire
- `entry_timing` — bar-level entry triggers
- `regime_filter` — market regime conditioners
- `stop_loss` — stop placement and sizing
- `take_profit` — target levels and hold times
- `risk_controls` — concurrent positions, exposure caps

Most primitive knobs land in `structure`. Risk knobs (ATR multiplier, max hold, take profit R) land in `stop_loss` / `take_profit` / `risk_controls`.

## Visual Layer

Every candidate emits a `visual` block with `markers` and `overlay_series` that render on the chart:

```python
markers = [
    marker(data, p1_idx, "aboveBar", "#ef4444", "circle", "P1"),
    marker(data, p2_idx, "aboveBar", "#ef4444", "circle", "P2"),
    marker(data, valley_idx, "belowBar", "#3b82f6", "square", "V"),
    marker(data, break_idx, "belowBar", "#a855f7", "arrowDown", "BOS"),
]

overlay_series = [
    line(data, [p1, valley, p2], "#ef4444", "Pattern Structure", line_width=2),
    horizontal_line(data, p1_idx, len(data)-1, neckline_price, "#3b82f6", "Neckline", line_style=2),
    horizontal_line(data, p2_idx, len(data)-1, target_price, "#22c55e", "Target", line_style=2),
    horizontal_line(data, p1_idx, len(data)-1, stop_price, "#f59e0b", "Stop", line_style=2),
]
```

### Visual Rules

- Mark **only the geometry the detector validated**. Don't draw a neckline if you didn't check the break.
- Use consistent colors across the codebase: red `#ef4444` for resistance/peaks, blue `#3b82f6` for support/necklines, green `#22c55e` for targets, amber `#f59e0b` for stops, purple `#a855f7` for break confirmations.
- Use `line_style: 2` (dashed) for projected lines (target, stop, neckline) and `line_style: 0` (solid) for actual structural connections.

## Output Ports

Composites wire primitives together via `output_ports`. Every primitive should expose:

```python
output_ports = {
    "signal": {
        "passed": bool,         # Is this candidate actionable right now?
        "score": float,         # 0..1
        "reason": str,          # short identifier
    },
    "pattern_geometry": {
        "direction": str,       # "bullish" | "bearish"
        "anchors": dict,        # the actual pivot anchors
        "score": float,
    },
    "entry_zone": {
        "passed": bool,         # is current price in the entry zone?
        "current_price": float,
        # ... pattern-specific zone info
    },
}
```

Pattern-specific output ports (like `bulkowski_priors` for chart patterns or `oscillator_state` for indicators) are encouraged. Composites can reference any port by name.

## Dual Mode (Scan vs Signal)

For primitives used as **timing triggers in backtests** (entry signals), implement a second mode that returns just the bar indices where the signal fires:

```python
def run_<pattern_id>_plugin(data, structure, spec, symbol, timeframe, mode="scan", **kwargs):
    if mode == "signal":
        return _generate_signal_indices(data, spec)  # → set[int]
    # ... normal scan mode produces candidates ...
```

`_generate_signal_indices` returns a `set[int]` of bar indices where the entry trigger fires. The backtest engine consumes this set directly, bypassing the candidate-building overhead.

See `rsi_primitive.py::_generate_signal_indices` for the canonical example.

Chart patterns without a clean per-bar trigger (e.g. patterns that produce a context window rather than a single entry bar) can stay scan-only. Set `default_entry.entry_type = "analysis_only"` in the JSON to signal this to the backtest engine.

## Status Lifecycle

| Status | Meaning |
|---|---|
| `experimental` | Newly added, not yet validated. Default for all new primitives. |
| `production` | Validator-approved, safe for autonomous search and live strategies. |
| `deprecated` | Marked for removal. Will not appear in builders, but still loadable for legacy strategies. |

Promote `experimental` → `production` only after validator runs on the review universe (typically 100+ symbols across multiple regimes).

## Pre-Commit Verification Checklist

```
- [ ] All three files exist: .py, .json, registry entry
- [ ] tunable_params covers every knob the .py reads
- [ ] default_setup_params matches tunable_params defaults
- [ ] indicator_role chosen and matches builder placement intent
- [ ] library_tier, cost_class, autonomy_safe, state_compatible set
- [ ] search_tags populated (powers AI / search discovery)
- [ ] min_data_bars realistic for the detector's warmup
- [ ] suggested_timeframes set
- [ ] status: "experimental"
- [ ] ReadLints clean on all three files
- [ ] Smoke import works: python -c "from plugins import <id>"
- [ ] gitnexus_detect_changes shows only the three expected files changed
- [ ] (If editing pattern_framework.py or bulkowski_geometry.py) gitnexus_impact run first
```

## Common Mistakes

### Knob in code, not in `tunable_params`

The most common mistake. The detector uses a parameter, but it isn't declared in the JSON. Result: validator can't tune it, sweep is blind to it, AI can't recommend it. Always declare every knob.

### Single opaque score, no rule checklist

The detector returns `score: 0.7` with no breakdown. Result: rejects are unexplainable, validator UI can't show a checklist, AI can't tell the user why it didn't pass. Always use `build_rule()` for every check.

### Visual lies

The detector validates rule X but the visual draws line Y. Users see geometry the detector didn't actually use. Always make the visual reflect the validated rules.

### `min_data_bars` too low

The detector runs before warmup completes and returns garbage. RSI-14 needs ~30 bars; chart patterns typically need 40-60; pivot-based patterns may need 200+. Set realistically.

### Missing registry entry

The plugin loads but the strategy builders, AI composer, and scanner can't find it. Always all three files.

### Shipped as `production` on day 1

Validator hasn't run yet, so the primitive may be making bad calls under regime stress. Always ship as `experimental` and promote after validator approval.

### `autonomy_safe: true` on an expensive detector

Autonomous search will burn budget exploring this primitive at scale. Match `autonomy_safe` to the actual computational and signal-quality cost.

## Reference Material

| Doc | Purpose |
|---|---|
| `.claude/skills/pattern-detector/create-primitive/SKILL.md` | Quick-reference skill for agents |
| `indicator-architecture.md` | Primitive, composite, strategy, Scanner, Research, and Validator boundaries |
| `../parameter-manifest-architecture.md` | Full `parameter_manifest` contract |
| `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md` | Canonical primitive contract spec |
| `.planning/plans/ACTIVE/legacy-plugin-conversion-plan.md` | How legacy plugins are being converted to primitives |
| `memory-bank/PRIMITIVE_AUDIT_REPORT.md` | Audit findings on existing primitives |
| `backend/services/plugins/pattern_framework.py` | `build_candidate`, `build_rule`, `chart_time`, `compute_spec_hash` |
| `backend/services/plugins/bulkowski_geometry.py` | Pivot extraction, line/marker helpers, measured-move target |
