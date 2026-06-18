---
name: pattern-detector-create-strategy
description: "Use when the user wants to create a new strategy, wrap a primitive into a strategy, build a composite strategy, promote a primitive, or assemble a parameter_manifest. Examples: \"Create a strategy from this primitive\", \"Build a composite strategy\", \"Wrap RSI into a strategy\", \"Promote this primitive\", \"Wire up a sweep-ready strategy\""
---

# Create a Strategy (Pattern Detector)

A **strategy** is the runnable unit in Pattern Detector. It wraps one primitive (or composes several) and adds entry, risk, exit, and cost configs. It carries a canonical `parameter_manifest` that sweep, validator sensitivity, AI repair, and the strategy details UI all read from.

If you're authoring a new detector first, see `pattern-detector/create-primitive` — strategies wrap primitives, not raw plugin code.

## When to Use

- "Create a strategy from `<pattern_id>` primitive"
- "Wrap RSI / MACD / Double Top into a sweep-ready strategy"
- "Build a composite strategy that combines structure + location + timing"
- "Promote this experimental primitive to a benchmark strategy"
- "Add a parameter_manifest to this strategy"

## The Strategy Spec Shape

```jsonc
{
  "strategy_id": "<snake_case_id>",
  "strategy_version_id": "<strategy_id>_v1",
  "version": 1,
  "name": "Display Name",
  "description": "What it detects, when it fires, and how it should be used.",
  "status": "experimental",                          // experimental | live | rejected | deprecated
  "asset_class": "stocks",                           // stocks | crypto | futures | fx
  "interval": "1d",                                  // 1d | 1wk | 1h | 15m
  "universe": [],                                    // [] = all symbols, or specific list
  "base_pattern_id": "<primitive_id>",               // the primitive being wrapped (REQUIRED)

  "structure_config": { ... },                       // swing detection (RDP epsilon, etc.)
  "setup_config":     { ... },                       // primitive defaults OR composite_spec
  "entry_config":     { ... },                       // entry trigger type + bars
  "risk_config":      { ... },                       // stop, take profit, sizing
  "exit_config":      { ... },                       // time stops, trailing
  "cost_config":      { ... },                       // commission, slippage
  "execution_config": { ... },                       // production_lock, auto_breakeven_r

  "parameter_manifest": [ ... ],                     // canonical sweep contract
  "spec_hash": "<auto-computed sha256>"
}
```

## Two Strategy Shapes

### A. Primitive Wrapper Strategy

The simple case — wrap one primitive with one set of tuned params.

```jsonc
"setup_config": {
  "pattern_type": "<primitive_id>",                  // matches base_pattern_id
  // ... copy primitive's default_setup_params here ...
  "lookback_bars": 220,
  "min_score": 0.55
}
```

`pattern_type` is the dispatch key — the runtime looks it up in the registry to find the plugin.

### B. Composite Strategy

Combines multiple primitives via a reducer.

```jsonc
"setup_config": {
  "pattern_type": "<composite_id>",
  "composite_spec": {
    "intent": "entry",                               // entry | exit | filter
    "stages": [
      {
        "id": "structure",                           // stage role
        "pattern_id": "structural_family_signal",    // primitive
        "params": { ... }                            // stage-specific knobs
      },
      {
        "id": "location",
        "pattern_id": "fib_location_primitive",
        "params": { ... }
      },
      {
        "id": "timing",
        "pattern_id": "rsi_primitive",
        "params": { ... }
      }
    ],
    "reducer": {
      "op": "AND",                                   // AND | OR | WEIGHTED
      "inputs": ["structure", "location", "timing"]  // stage IDs
    }
  }
}
```

Stage IDs by convention map to anatomy: `structure`, `location`, `timing`, `regime`, `filter`. The promoter uses these to resolve `parameter_manifest` paths.

## Workflow

```
1. RUN gitnexus_impact on parameter_manifest.ts before authoring (verify auto-promoter contract intact)
2. Pick the closest reference strategy (table below) and READ it
3. WRITE backend/data/strategies/<strategy_id>_v1.json
4. EITHER let the auto-promoter derive parameter_manifest at load time
   OR  hand-author parameter_manifest in the JSON for fine control
5. (Optional) Add a family-specific manifest builder in parameter_manifest.ts
6. RUN gitnexus_detect_changes  → verify scope
```

## Reference Strategies (copy from these)

| Shape | Reference file | Use when |
|---|---|---|
| Primitive wrapper, hand-curated manifest | `backend/data/strategies/sma_50_200_benchmark_v1.json` | Simple indicator wrapped, you want explicit anatomy/priority/failure_modes_targeted |
| Primitive wrapper, auto-derived manifest | `backend/data/strategies/three_drives_pattern_*.json` | Bulkowski/harmonic/chart-pattern primitive wrapper, primitive's `tunable_params` is enough |
| Pattern wrapper, partial hand-curated manifest | `backend/data/strategies/head_shoulders_context_pattern_v1.json` | Wrap chart pattern, only hand-curate risk knobs, let promoter handle structural |
| Composite (multi-stage) | `backend/data/strategies/lth_continuation_composite_v2.json` | Combine N primitives via AND/OR reducer |
| Composite via Wyckoff | `backend/data/strategies/wyckoff_accumulation_rdp_v3.json` | Structural family + entry timing composite |

## Required Decisions Before Authoring

- [ ] **`strategy_id`** — snake_case, no `_v1` suffix here
- [ ] **`strategy_version_id`** — `<strategy_id>_v1` (bump on revisions)
- [ ] **`base_pattern_id`** — the primitive in the registry being wrapped (REQUIRED for promoter)
- [ ] **`asset_class`** + **`interval`** — drives data fetch and validator universe selection
- [ ] **Wrapper or composite?** — single `pattern_type` vs `composite_spec.stages[]`
- [ ] **Status**: `experimental` (default) → `live` (validator-approved) → `rejected` / `deprecated`
- [ ] **Manifest path**: auto-derived or hand-curated or hybrid?

## The `parameter_manifest` (Critical)

This is the single source of truth that **sweep**, **validator sensitivity**, **AI repair**, and the **strategy details UI** all read from.

### Per-Entry Required Fields

```jsonc
{
  "key": "swing_epsilon_pct",
  "label": "RDP Epsilon",
  "path": "structure_config.swing_epsilon_pct",      // JSON path in this strategy spec
  "anatomy": "structure",                            // bucket — drives sweep card grouping
  "type": "float",                                   // int | float | bool | enum | select | string
  "identity_preserving": true,                       // does changing this still make it the same strategy?
  "sweep_enabled": true,                             // sweep can vary this knob
  "sensitivity_enabled": true,                       // validator can perturb this knob
  "suggested_values": [0.07, 0.075, 0.08, 0.085, 0.09],
  "min": 0.01,
  "max": 0.20,
  "step": 0.005,
  "priority": 100,                                   // 0..100, higher = AI prefers tuning this first
  "failure_modes_targeted": ["high_sensitivity", "low_trade_count"]
}
```

### Anatomy Buckets

| Bucket | Meaning |
|---|---|
| `structure` | Pattern geometry (lookback, symmetry, depth, swings) |
| `location` | Where in chart context the setup can fire (fib levels, retracement zones) |
| `entry_timing` | Bar-level entry triggers (confirmation bars, breakout pct) |
| `regime_filter` | Market regime conditioners (trend filter, volume threshold) |
| `stop_loss` | Stop placement and sizing (ATR multiplier, stop pct) |
| `take_profit` | Target levels and hold caps (take_profit_R, max_hold_bars) |
| `risk_controls` | Position sizing and concurrency (max_concurrent_positions) |

### Failure Modes (drives AI repair)

Tag each knob with the failure modes it targets so AI can recommend the right fix:

| Failure mode | When to tag a knob |
|---|---|
| `low_trade_count` | Loosening this knob produces more setups |
| `high_sensitivity` | Tightening this knob makes the setup less noisy |
| `high_drawdown` | Adjusting this knob reduces per-trade or aggregate drawdown |
| `montecarlo_dd` | Adjusting this knob improves MC drawdown distribution |
| `oos_degradation` | Adjusting this knob reduces in-sample → out-of-sample drift |

### Path Resolution

| Spec location | Path |
|---|---|
| `structure_config.<key>` | `structure_config.<key>` |
| `setup_config.<key>` | `setup_config.<key>` |
| `entry_config.<key>` | `entry_config.<key>` |
| `risk_config.<key>` | `risk_config.<key>` |
| `exit_config.<key>` | `exit_config.<key>` |
| Composite stage param | `setup_config.composite_spec.stages.<idx>.params.<key>` |

The auto-promoter (`backend/src/services/parameterManifest.ts::resolvePathForParam`) infers these automatically from key name + spec shape, but you can override.

## Three Authoring Paths

### Path 1: Let the Auto-Promoter Do Everything (easiest)

Required:
- Primitive being wrapped has good `tunable_params` (every knob declared with `key`, `label`, `type`, `min`, `max`, `step`, `default`)
- Strategy JSON has `base_pattern_id` set
- Strategy JSON omits `parameter_manifest` entirely OR includes only overrides

The auto-promoter:
1. Loads `tunable_params` from the primitive's JSON definition
2. Resolves each knob's `path` from key name + spec shape
3. Resolves each knob's `anatomy` via keyword heuristics (`stop`→`stop_loss`, `confirm`→`entry_timing`, `concurrent`→`risk_controls`, default→`structure`)
4. Builds `suggested_values` from `min`/`max`/`step` ± 2 steps from default
5. Appends standard risk-controls (`max_concurrent_positions`, `atr_multiplier`, `take_profit_R`, `max_hold_bars`) to every strategy

Use this path for primitive wrappers where defaults are good.

### Path 2: Hand-Author the Full Manifest in Strategy JSON

Use when:
- You want explicit `priority` and `failure_modes_targeted` on every knob
- The strategy is hand-built (not promoted from a primitive)
- The composite stages need custom labels (e.g. `structure: ATR Reversal Multiple` instead of just `reversal_multiple_atr`)

Reference: `sma_50_200_benchmark_v1.json` and the structure-stage entries in `lth_continuation_composite_v2.json`.

### Path 3: Add a Family-Specific Manifest Builder

For strategy families that need consistent overrides across many strategy versions, add a builder function in `backend/src/services/parameterManifest.ts`. Examples already there:

- `densityBaseManifest` — for `density_base_detector_v1_pattern`
- `maCrossoverManifest` — for `ma_crossover`
- `wyckoffAccumulationManifest` — for `wyckoff_accumulation_rdp`
- `pullbackUptrendManifest` — for the pullback composite
- `fibSignalTriggerManifest` — for fib trigger family

Add yours, register it by `pattern_type` in the dispatcher, and the auto-promoter routes to it.

## Standard Risk Controls (always appended)

Every strategy automatically gets these four manifest entries appended (unless the strategy already declared the same key). You don't need to add them yourself.

```jsonc
[
  { "key": "max_concurrent_positions", "anatomy": "risk_controls", "priority": 90,
    "failure_modes_targeted": ["high_drawdown", "montecarlo_dd"] },
  { "key": "atr_multiplier",           "anatomy": "stop_loss",     "priority": 85,
    "failure_modes_targeted": ["high_drawdown", "montecarlo_dd"] },
  { "key": "take_profit_R",            "anatomy": "take_profit",   "priority": 80,
    "failure_modes_targeted": ["oos_degradation", "high_drawdown", "montecarlo_dd"] },
  { "key": "max_hold_bars",            "anatomy": "take_profit",   "priority": 60,
    "failure_modes_targeted": ["oos_degradation"] }
]
```

These show up on every strategy automatically via `withStandardRiskControls()` in `parameterManifest.ts`.

## Status Lifecycle

| Status | Meaning |
|---|---|
| `experimental` | Default for new strategies. Visible in builders, not promoted to live trading. |
| `live` | Validator-approved on review universe. Eligible for paper / live trading. |
| `rejected` | Failed validator review. Kept for archival / replay. |
| `deprecated` | Superseded. Not shown in builders. |

Promote `experimental` → `live` only after passing the validator's review universe checks.

## Pre-Commit Checklist

```
- [ ] strategy_id + strategy_version_id set, version: 1
- [ ] base_pattern_id matches a registry entry
- [ ] asset_class + interval set
- [ ] structure_config + setup_config + entry_config + risk_config + exit_config + cost_config all present
- [ ] If composite: composite_spec.stages[] all reference registered primitives
- [ ] If hand-curating manifest: every entry has key + label + path + anatomy + type
- [ ] Standard risk controls auto-appended (don't duplicate them)
- [ ] status: "experimental"
- [ ] spec_hash will auto-compute on save (omit it in JSON, or set null)
- [ ] ReadLints clean
- [ ] gitnexus_detect_changes shows only the strategy JSON changed
```

## Common Mistakes

- **Missing `base_pattern_id`** → auto-promoter has nothing to derive from, manifest comes back empty.
- **`pattern_type` mismatch with primitive's `pattern_id`** → runtime can't resolve plugin.
- **Composite stage references unregistered primitive** → composite runner errors at first scan.
- **Hand-authored manifest path doesn't exist in spec** → validator + sweep silently skip the knob (audit catches this).
- **Knob `identity_preserving: true` but actually changes strategy identity** → repair sweeps drift across strategy boundaries.
- **Missing `failure_modes_targeted`** → AI repair can't recommend the knob for the right symptom.
- **`status: "live"` on day 1** → bypasses validator review. Always start `experimental`.
- **Duplicating standard risk controls** → confusing UI; let the promoter add them.

## Reference Docs

| Doc | Purpose |
|---|---|
| `docs/HOW-TO-CREATE-A-STRATEGY.md` | Long-form companion to this skill |
| `docs/parameter-manifest-architecture.md` | Full manifest contract + audit rules |
| `docs/strategy-validation-policy.md` | When a strategy can be promoted from `experimental` to `live` |
| `backend/src/services/parameterManifest.ts` | Auto-promoter + family builders |
| `backend/src/types/strategy.ts` | TypeScript types for `StrategySpec` and manifest items |
| `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md` | Why this contract exists |

## Related Skills

- `pattern-detector/create-primitive` — author the underlying detector first
- `gitnexus/gitnexus-impact-analysis` — required before editing `parameterManifest.ts`
- `gitnexus/gitnexus-refactoring` — for renaming strategy keys safely
