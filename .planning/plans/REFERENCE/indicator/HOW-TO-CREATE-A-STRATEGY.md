# How to Create a Strategy

This is the long-form companion to `.claude/skills/pattern-detector/create-strategy/SKILL.md`. The skill is for fast agent lookups; this doc is for humans (or agents) who need the architecture, examples, and rationale.

## What is a Strategy?

A **strategy** is the runnable unit in Pattern Detector. It wraps a primitive or composite signal in trade-management rules so the Validator can test expectancy, robustness, drawdown, and tradability.

Strategies are not normal Scanner artifacts. The Scanner consumes primitives and composites because it is looking for current signal matches. The Validator consumes strategies because it is testing whether acting on a signal has positive expectancy.

See `indicator-architecture.md` for the canonical Primitive -> Composite -> Strategy boundary.

A strategy combines:

- **Signal source**: one primitive or one composite
- **Required state** when the signal source is stateful
- **Entry config** (how to enter — at close, at next open, on confirmation)
- **Risk config** (stop type, stop distance, take profit, position sizing)
- **Exit config** (time stops, trailing logic)
- **Cost config** (commission, slippage assumptions)
- **Execution config** (production lock, breakeven rules, scale-out)
- **Fundamental / research config** when the strategy is testing valuation or fundamentals (DCF hold horizon, rebalance cadence, minimum observations)
- **`parameter_manifest`** (the canonical sweep / validator / AI contract)

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
┌─────────────────────────────────────────────────────────────┐
│                       PRIMITIVE                             │
│   .py + .json + registry entry                              │
│   Defines: tunable_params, default_setup_params,            │
│            indicator_role, library_tier                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ wrapped by
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       STRATEGY                              │
│   .json (in backend/data/strategies/)                       │
│   Adds: entry_config, risk_config, exit_config,             │
│         cost_config, execution_config                       │
│   Generates (or hand-curates): parameter_manifest           │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ consumed by
                          ▼
┌────────────┬──────────────┬──────────────┬─────────────────┐
│  Scanner   │  Backtester  │   Sweep      │  Validator      │
│            │              │              │  + AI Repair    │
└────────────┴──────────────┴──────────────┴─────────────────┘
```

## The Two Strategy Shapes

### Primitive Wrapper

The simple case. One primitive, one set of tuned params, one entry/exit recipe.

`setup_config.pattern_type` matches the primitive's `pattern_id`. The runtime looks up the primitive in `registry.json` and dispatches to its plugin.

### Composite Strategy

Combines N primitives via a reducer (`AND`, `OR`, or `WEIGHTED`). Each primitive is a "stage" with a role (`structure`, `location`, `timing`, `regime`, `filter`).

```jsonc
"setup_config": {
  "pattern_type": "lth_continuation_composite",
  "composite_spec": {
    "intent": "entry",
    "stages": [
      { "id": "structure", "pattern_id": "structural_family_signal", "params": { ... } },
      { "id": "location",  "pattern_id": "fib_location_primitive",   "params": { ... } },
      { "id": "timing",    "pattern_id": "rsi_primitive",            "params": { ... } }
    ],
    "reducer": { "op": "AND", "inputs": ["structure", "location", "timing"] }
  }
}
```

The composite runner evaluates each stage, collects their `output_ports`, and applies the reducer. If `reducer.op === "AND"` and all stages pass, the composite emits a candidate. If `OR`, any stage suffices. `WEIGHTED` uses each stage's score in a weighted average.

Composite stage paths in the manifest look like `setup_config.composite_spec.stages.<idx>.params.<key>`.

## The Strategy Spec Schema

Completed strategies must follow the canonical JSON Schema at `backend/data/schemas/strategy.schema.json`.

The schema is intentionally split into two layers:

- **Hard outer contract**: identity, status, asset class, interval, signal source, standard config buckets, cost assumptions, timestamps, and `parameter_manifest`.
- **Flexible inner configs**: `setup_config`, `structure_config`, `fundamental_config`, and execution details can differ by primitive, composite, asset class, and strategy family.

That means strategies are allowed to be different, but they are not allowed to be structurally random. RSI, MACD, DCF, and a stateful composite can each carry different knobs, but all completed strategies must expose those knobs through the same manifest contract so Validator and Sweep can reason about them.

```jsonc
{
  // Identity
  "strategy_id": "<snake_case_id>",
  "strategy_version_id": "<strategy_id>_v1",
  "version": 1,
  "name": "Display Name",
  "description": "<paragraph>",
  "status": "experimental",
  "asset_class": "stocks",
  "interval": "1d",
  "universe": [],
  "base_pattern_id": "<primitive_id>",

  // Per-bar configuration
  "structure_config": { "swing_method": "rdp", "swing_epsilon_pct": 0.08, ... },
  "setup_config":     { "pattern_type": "<id>", ... },
  "entry_config":     { "entry_type": "market_on_close", "confirmation_bars": 1 },
  "risk_config":      { "stop_type": "atr_multiple", "atr_multiplier": 2.0, ... },
  "exit_config":      { "time_stop_bars": 30, "trailing": null },
  "cost_config":      { "commission_per_trade": 0, "slippage_pct": 0.001 },
  "execution_config": { "auto_breakeven_r": 1, "production_lock": true },
  "fundamental_config": { "rebalance_frequency": "monthly", "forward_bars": 26 },

  // Audit and tooling
  "created_at": "2026-04-07T14:12:05.000Z",
  "updated_at": "2026-04-07T14:12:05.000Z",
  "parameter_manifest": [ ... ],
  "spec_hash": "<sha256 auto-computed>"
}
```

## The `parameter_manifest`

This is the single source of truth that sweep, validator sensitivity, AI repair, and the strategy details UI all read from.

Every strategy must be **sweep compliant**. That means every knob that defines the strategy's behavior is either:

- declared in `parameter_manifest`, or
- inherited from a primitive/composite definition that the strategy promoter converts into `parameter_manifest` at load time.

A strategy that cannot tell Sweep which values are tunable, where those values live in JSON, and which ranges are reasonable is not ready for Validator. It can be a draft, but it should not be treated as a valid backtestable strategy.

Every entry has:

| Field | Required | Notes |
|---|---|---|
| `key` | yes | Stable identifier — usually matches the spec key |
| `label` | yes | Human-readable, shown in UI |
| `path` | yes | JSON path in the strategy spec (where to read/write the value) |
| `anatomy` | yes | One of the 7 anatomy buckets |
| `type` | yes | `int` \| `float` \| `bool` \| `enum` \| `select` \| `string` |
| `identity_preserving` | yes | If true, changing this knob keeps it "the same strategy" |
| `sweep_enabled` | yes | Sweep is allowed to vary this knob |
| `sensitivity_enabled` | yes | Validator sensitivity test will perturb this knob |
| `suggested_values` | recommended | The 5-7 values sweep should try |
| `min`, `max`, `step` | for numerics | Sweep bounds |
| `priority` | recommended | 0..100, higher = AI prefers tuning this first |
| `failure_modes_targeted` | recommended | Which validator failure modes this knob can fix |

### Anatomy Buckets

| Bucket | Meaning | Examples |
|---|---|---|
| `structure` | Pattern geometry knobs | `lookback_bars`, `peak_symmetry_pct`, `swing_epsilon_pct` |
| `location` | Where the setup can fire | `location_min_retracement_pct`, fib zone bounds |
| `entry_timing` | Bar-level entry triggers | `confirmation_bars`, `breakout_pct_above`, `cross_direction` |
| `regime_filter` | Market regime conditioners | `trend_filter`, `volume_multiple`, `required_regime` |
| `stop_loss` | Stop placement | `atr_multiplier`, `stop_value` |
| `take_profit` | Target levels and hold caps | `take_profit_R`, `max_hold_bars`, `target_level` |
| `risk_controls` | Position sizing and concurrency | `max_concurrent_positions`, `risk_per_trade_pct` |
| `valuation` | Fundamental valuation test knobs | `forward_bars`, `rebalance_frequency`, `gap_threshold_pct` |

### Strategy-Level Sweepable Knobs Are Part Of The Strategy

If a value is something we may sweep, compare, repair, or explain, it must live in the saved strategy JSON and must have a `parameter_manifest` entry that points to it.

Do not leave strategy-defining knobs only in the Backtester modal or a temporary run override. Runtime overrides are useful for ad-hoc experiments, but they do not define the strategy. The sweep engine works by copying a strategy JSON file and changing the values at `parameter_manifest[].path`. If a knob is not in the spec and not in the manifest, Sweep, Validator sensitivity, AI repair, and strategy review are blind to it.

For valuation strategies, the forward hold period is part of the strategy. A DCF undervaluation strategy with a 13-bar hold is not the same test as one with a 52-bar hold, even if both use the same primitive.

Example DCF valuation strategy knobs:

```jsonc
{
  "setup_config": {
    "pattern_type": "dcf_long",
    "target_state": "undervalued",
    "gap_threshold_pct": 20.0
  },
  "fundamental_config": {
    "rebalance_frequency": "monthly",
    "forward_bars": 26,
    "min_selected_count": 1,
    "min_excluded_count": 1
  },
  "parameter_manifest": [
    {
      "key": "valuation_forward_bars",
      "label": "DCF Forward Hold Bars",
      "path": "fundamental_config.forward_bars",
      "anatomy": "valuation",
      "type": "int",
      "identity_preserving": true,
      "sweep_enabled": true,
      "sensitivity_enabled": true,
      "suggested_values": [13, 26, 52, 104],
      "min": 1,
      "max": 520,
      "step": 1,
      "priority": 95,
      "failure_modes_targeted": ["low_trade_count", "oos_degradation"]
    },
    {
      "key": "valuation_gap_threshold_pct",
      "label": "DCF Gap Threshold %",
      "path": "setup_config.gap_threshold_pct",
      "anatomy": "valuation",
      "type": "float",
      "identity_preserving": true,
      "sweep_enabled": true,
      "sensitivity_enabled": true,
      "suggested_values": [10, 15, 20, 25, 30],
      "min": 0,
      "max": 100,
      "step": 1,
      "priority": 90,
      "failure_modes_targeted": ["low_trade_count", "high_sensitivity"]
    },
    {
      "key": "valuation_rebalance_frequency",
      "label": "DCF Rebalance Frequency",
      "path": "fundamental_config.rebalance_frequency",
      "anatomy": "valuation",
      "type": "select",
      "identity_preserving": true,
      "sweep_enabled": true,
      "sensitivity_enabled": false,
      "suggested_values": ["monthly", "quarterly"],
      "priority": 80,
      "failure_modes_targeted": ["oos_degradation"]
    }
  ]
}
```

This same rule applies outside valuation. If a strategy exposes RSI length, MACD fast/slow/signal, ATR stop multiple, fixed percent stop, target R, max hold bars, or position sizing, the value belongs in the strategy JSON and the manifest must point to it.

### Identity-Preserving Semantics

A knob is `identity_preserving: true` if changing its value still describes "the same strategy" in the spec_hash sense. Examples:

- `peak_symmetry_pct` going from 0.05 → 0.06 — still the same Double Top strategy ✓ identity-preserving
- `pattern_type` going from `double_top` → `triple_top` — different strategy ✗ NOT identity-preserving
- `max_concurrent_positions` going from 3 → 5 — different exposure profile ✗ NOT identity-preserving

This drives the **repair sweep** — sweeps that improve a strategy without creating a new variant only touch identity-preserving knobs.

### Failure Modes (drives AI repair)

When the validator flags a strategy with a failure mode, the AI repair surface looks for manifest entries with that mode in `failure_modes_targeted`. Tag accurately:

| Failure mode | When to tag a knob |
|---|---|
| `low_trade_count` | Loosening this knob produces more setups (lower thresholds, wider bounds) |
| `high_sensitivity` | Tightening this knob makes results less noisy across param drift |
| `high_drawdown` | Adjusting this knob reduces per-trade or aggregate drawdown |
| `montecarlo_dd` | Adjusting this knob improves Monte Carlo drawdown distribution |
| `oos_degradation` | Adjusting this knob reduces in-sample → out-of-sample drift |

## The Three Authoring Paths

### Path 1: Auto-Promoter (Easiest)

Use when:
- You're wrapping a single well-defined primitive
- The primitive's `tunable_params` covers everything
- Defaults from the primitive are sensible

Requirements:
- Strategy JSON includes `base_pattern_id`
- Strategy JSON does NOT need to hand-write `parameter_manifest` when the promoter can derive a complete one
- Primitive's JSON definition has clean `tunable_params`

What happens:
1. At load time, `parameterManifest.ts::generateManifest()` is called
2. It loads the primitive's `tunable_params`
3. For each knob it resolves `path` (via `resolvePathForParam`), `anatomy` (via `resolveAnatomyForParam` keyword heuristics), `suggested_values` (centered on default ± 2 steps)
4. Appends the four standard risk controls (`max_concurrent_positions`, `atr_multiplier`, `take_profit_R`, `max_hold_bars`)
5. Returns the merged manifest

The Three Drives strategy in the user's example came from this path.

### Path 2: Hand-Authored (Most Control)

Use when:
- You want explicit `priority` and `failure_modes_targeted` per knob
- The strategy is hand-built (not promoted from a primitive)
- Labels need composite-stage prefixes (e.g. `"structure: ATR Reversal Multiple"`)
- You're benchmarking a known strategy where the manifest must match published parameters

Reference: `sma_50_200_benchmark_v1.json`.

### Path 3: Family-Specific Builder (DRY for many versions)

Use when:
- Many strategies share the same family (e.g. all `ma_crossover` variants)
- You want consistent overrides across all versions
- Extra knobs need to be added beyond what `tunable_params` declares

Add a builder function in `backend/src/services/parameterManifest.ts` following the existing patterns:

```typescript
function myFamilyManifest(strategy: StrategySpec, familyDef?: PatternDefinition) {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'my_knob', label: 'My Knob', type: 'float', min: 0, max: 1, step: 0.1 }, {
      anatomy: 'structure',
      priority: 95,
      failure_modes_targeted: ['high_sensitivity'],
    }),
  ];
  const overrides = {
    existing_knob: { anatomy: 'structure', priority: 100, failure_modes_targeted: ['low_trade_count'] },
  };
  return withStandardRiskControls(strategy, mergeManifestItems(manifest, overrides, extras));
}
```

Then register it by `pattern_type` in the dispatcher at the bottom of the file.

Existing builders to reference:
- `densityBaseManifest`
- `maCrossoverManifest`
- `wyckoffAccumulationManifest`
- `pullbackUptrendManifest`
- `fibSignalTriggerManifest`

## Standard Risk Controls (Always Appended)

Every strategy automatically gets these four manifest entries via `withStandardRiskControls()`:

| Key | Anatomy | Priority | Failure modes |
|---|---|---|---|
| `max_concurrent_positions` | `risk_controls` | 90 | `high_drawdown`, `montecarlo_dd` |
| `atr_multiplier` | `stop_loss` | 85 | `high_drawdown`, `montecarlo_dd` |
| `take_profit_R` | `take_profit` | 80 | `oos_degradation`, `high_drawdown`, `montecarlo_dd` |
| `max_hold_bars` | `take_profit` | 60 | `oos_degradation` |

Don't duplicate these in your hand-authored manifest. The promoter de-dupes by `key` but keeping the strategy JSON clean is preferred.

## Status Lifecycle

| Status | Meaning | Promotion criteria |
|---|---|---|
| `experimental` | New strategy, not yet validated | Default for all new strategies |
| `live` | Validator-approved | Passing review universe + sensitivity tests + Monte Carlo |
| `rejected` | Failed validator review | Kept for archival, debugging, AI learning |
| `deprecated` | Superseded by newer version | Hidden from builders, loadable for legacy refs |

See `../strategy-validation-policy.md` for the full promotion gate.

## Spec Hash

Every strategy gets a `spec_hash` (SHA-256 of canonicalized spec). This is auto-computed on save by the backend. You can omit it in your JSON or set it to `null`.

The hash covers: `cost_config`, `entry_config`, `exit_config`, `risk_config`, `setup_config`, `strategy_id`, `structure_config`, `version`. NOT included: `description`, `name`, `created_at`, `updated_at`, `status`, `parameter_manifest`.

This means you can re-author the description or rebuild the manifest without changing identity.

## File Locations

```
backend/data/strategies/<strategy_id>_v<N>.json    ← The strategy spec
backend/data/patterns/registry.json                ← Stays unchanged for strategies (only primitives register here)
backend/src/services/parameterManifest.ts          ← (Optional) family-specific manifest builder
```

Strategies do NOT get a registry entry. The registry is for primitives only. Strategies are discovered by listing the `backend/data/strategies/` directory.

## Examples By Path

### Auto-Promoter Example

```jsonc
// backend/data/strategies/double_top_v1.json
{
  "strategy_id": "double_top_v1",
  "strategy_version_id": "double_top_v1",
  "version": 1,
  "name": "Double Top (Bulkowski Defaults)",
  "description": "Bulkowski Double Top with standard defaults. Wrapped from double_top_pattern.",
  "status": "experimental",
  "asset_class": "stocks",
  "interval": "1d",
  "universe": [],
  "base_pattern_id": "double_top_pattern",
  "structure_config": { "swing_method": "rdp", "swing_epsilon_pct": 0.08, "use_exact_epsilon": true },
  "setup_config": {
    "pattern_type": "double_top_pattern",
    "lookback_bars": 220,
    "pivot_source": "rdp",
    "swing_epsilon_pct": 0.08,
    "use_exact_epsilon": true,
    "peak_symmetry_pct": 0.05,
    "valley_depth_min_pct": 0.10,
    "min_bars_between_peaks": 10,
    "require_prior_uptrend": true,
    "confirm_close_below_valley": true,
    "pullback_proximity_pct": 0.02,
    "min_score": 0.55,
    "max_candidates": 2
  },
  "entry_config": { "entry_type": "neckline_break_or_pullback" },
  "risk_config":  { "stop_type": "atr_multiple", "atr_length": 14, "atr_multiplier": 2.0,
                    "take_profit_R": 2.0, "max_hold_bars": 30, "max_concurrent_positions": 3 },
  "exit_config":  {},
  "cost_config":  { "commission_per_trade": 0, "slippage_pct": 0.001 },
  "execution_config": {},
  "backtest_config": { "direction": "short" }
}
```

The promoter will derive the manifest at load time. No hand-authored `parameter_manifest` is needed in the JSON, but the resulting strategy still must be sweep compliant after promotion.

### Hand-Authored Manifest Example

See `backend/data/strategies/sma_50_200_benchmark_v1.json` for the canonical example. Every knob has explicit `path`, `anatomy`, `priority`, `failure_modes_targeted`.

### Composite Example

See `backend/data/strategies/lth_continuation_composite_v2.json`. Note how stage params get prefixed labels (`"structure: ATR Reversal Multiple"`) and paths use `setup_config.composite_spec.stages.0.params.reversal_multiple_atr`.

## Pre-Commit Verification Checklist

```
- [ ] strategy_id + strategy_version_id + version: 1
- [ ] Strategy passes `backend/data/schemas/strategy.schema.json`
- [ ] base_pattern_id matches an entry in backend/data/patterns/registry.json
- [ ] asset_class + interval set
- [ ] All seven configs present: structure, setup, entry, risk, exit, cost, execution
- [ ] Any strategy-level research config present when needed (`fundamental_config` for valuation/fundamental strategies)
- [ ] Strategy is sweep compliant: every behavior-defining knob is exposed through `parameter_manifest` or auto-promoted from primitive/composite tunables
- [ ] If composite: every stage's pattern_id is in the registry
- [ ] If hand-curating manifest: every entry has key, label, path, anatomy, type
- [ ] If hand-curating manifest: paths actually exist in this spec
- [ ] Every sweepable knob exists in the strategy JSON, not only in a Backtester modal override
- [ ] DCF strategies include manifest entries for `fundamental_config.forward_bars` and `fundamental_config.rebalance_frequency` when hold time or rebalance cadence should be swept
- [ ] No duplicate keys in parameter_manifest (standard risk controls auto-append)
- [ ] status: "experimental"
- [ ] spec_hash omitted or null (auto-computed on save)
- [ ] ReadLints clean
- [ ] gitnexus_detect_changes shows only the strategy JSON changed
```

## Common Mistakes

### `base_pattern_id` missing or wrong

Without it the auto-promoter has no primitive to read `tunable_params` from. Manifest comes back empty. Sweep + validator + AI all degraded.

### `pattern_type` doesn't match the primitive

The runtime looks up `setup_config.pattern_type` in the registry and dispatches to the matching plugin. A typo here means the strategy won't run at all.

### Composite stage references unregistered primitive

The composite runner errors at first scan. Always verify each stage's `pattern_id` is in `backend/data/patterns/registry.json`.

### Hand-authored manifest path doesn't exist in spec

Validator and sweep silently skip the knob. The manifest audit (`npm run manifest:audit`) catches this — run it before committing hand-authored manifests.

### Marking knobs `identity_preserving: true` when they aren't

The repair sweep will drift across what should be different strategy identities. Be conservative — only mark as identity-preserving if changing the value still describes the same strategy.

### Missing `failure_modes_targeted`

AI repair can't recommend the right knob for the right symptom. Tag every knob honestly.

### `status: "live"` on day 1

Bypasses the validator review gate. Always start `experimental`. Promotion is automated by the validator pipeline once review universe checks pass.

### Duplicating standard risk controls

Confusing UI; let the promoter add them via `withStandardRiskControls()`.

### Auto-promoted manifest has wrong anatomy

The auto-promoter uses keyword heuristics. If your knob name doesn't match the heuristic patterns (e.g. `swing_epsilon_pct` defaults to `structure` correctly, but `oversold_level` would default to `structure` too — wrong, it's `entry_timing`), add a family-specific builder with explicit overrides.

## Reference Material

| Doc | Purpose |
|---|---|
| `.claude/skills/pattern-detector/create-strategy/SKILL.md` | Quick-reference skill for agents |
| `HOW-TO-CREATE-A-PRIMITIVE.md` | Sister doc for the primitive layer |
| `../parameter-manifest-architecture.md` | Full manifest contract + audit rules |
| `../strategy-validation-policy.md` | Promotion criteria from experimental → live |
| `backend/src/services/parameterManifest.ts` | Auto-promoter + family builders |
| `backend/src/types/strategy.ts` | TypeScript types |
| `backend/data/strategies/sma_50_200_benchmark_v1.json` | Hand-authored manifest reference |
| `backend/data/strategies/lth_continuation_composite_v2.json` | Composite reference |
| `backend/data/strategies/three_drives_pattern_*.json` | Auto-promoted reference |
