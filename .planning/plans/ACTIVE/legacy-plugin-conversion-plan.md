# Legacy Plugin Conversion Plan

> **Goal**: Convert all 6 legacy `patternScanner.py` scan modes into proper StrategyRunner plugins, eliminating the `scanner_mode` shim and the spawn-per-call patternScanner path entirely.

---

## Current State

### What "legacy" means

The scan route (`candidates.ts`) has two execution paths:

1. **StrategyRunner path** — builds a `StrategySpec`, spawns `strategyRunner.py`, which calls a registered plugin function. This is the **target architecture**.
2. **patternScanner path** — reads `scanner_mode` from the plugin JSON, assembles CLI flags (`--swing`, `--fib-energy`, etc.), spawns `patternScanner.py` with those flags, parses stdout. This is the **legacy path**.

When a plugin JSON has `"scanner_mode": "swing"`, the scan route takes path #2. When it has `"plugin_file": "strategyRunner.py"` and no `scanner_mode`, it takes path #1.

### Already converted (3)

| Plugin | `pattern_type` | Plugin Function |
|--------|---------------|-----------------|
| `ma_crossover` | `ma_crossover` | `run_ma_crossover_plugin` |
| `golden_cross_50_200_sma` | `golden_cross_50_200_sma` | `run_ma_crossover_plugin` |
| `wyckoff_accumulation_rdp` | `wyckoff_accumulation` | `run_wyckoff_plugin` |

### Need conversion (6)

| # | Plugin ID | scanner_mode | Main Function | Approx Lines | Dependencies |
|---|-----------|-------------|---------------|-------------|-------------|
| 1 | `swing_structure` | `swing` | `detect_swing_points_with_fallback()` | ~770 | numpy, fastrdp |
| 2 | `fib_energy` | `fib-energy` | `calculate_fib_energy_signal()` | ~600 | swing detection, energy |
| 3 | `regime_filter` | `regime` | `detect_regime_windows()` | ~380 | swing detection, numpy |
| 4 | `discount_zone` | `discount-only` | `scan_discount_zone()` | ~650 | swing, fib-energy, energy |
| 5 | `wyckoff_accumulation` | `wyckoff` | `detect_wyckoff_patterns()` | ~640 | basic pivots only |
| 6 | `discount_wyckoff_pipeline` | `discount` | Composite: discount → wyckoff | ~800 | discount + wyckoff |

---

## Shared Helper Dependency Graph

Many legacy functions share helpers. These must be extracted into a shared module first.

```
swing_structure
  ├── detect_confirmed_swing_points()    ← MAJOR mode (217 lines)
  ├── detect_swings_rdp()                ← RDP mode (149 lines)
  ├── detect_relative_swing_points()     ← Relative fallback (128 lines)
  ├── _build_swing_structure()           ← Builds SwingStructure (181 lines)
  ├── detect_swing_highs_lows()          ← Basic pivots (34 lines)
  └── serialize_swing_structure()        ← JSON output (95 lines)

fib_energy
  ├── calculate_fib_energy_signal()      ← Main (210 lines)
  ├── calculate_energy_state()           ← Physics model (192 lines)
  ├── calculate_selling_pressure()       ← Selling pressure (125 lines)
  └── [swing detection helpers]          ← Shared with swing_structure

regime_filter
  ├── detect_regime_windows()            ← Main (127 lines)
  ├── _linear_regression_slope()         ← Regression (16 lines)
  └── [swing detection helpers]          ← Shared with swing_structure

discount_zone
  ├── scan_discount_zone()               ← Main (175 lines)
  └── [swing + fib-energy helpers]       ← Shared

copilot (folds into fib_energy — see note)
  ├── generate_copilot_analysis()        ← Main (438 lines)
  ├── calculate_buying_pressure()        ← Buying pressure (120 lines)
  └── [swing + fib-energy helpers]       ← Shared

wyckoff_accumulation
  ├── detect_wyckoff_patterns()          ← Main (265 lines)
  ├── find_major_peaks()                 ← Peak detection (45 lines)
  ├── detect_swing_highs_lows()          ← Basic pivots (34 lines)
  └── serialize_wyckoff_pattern()        ← JSON output (326 lines)
```

### The shared core that needs extracting first:

| Helper | Lines | Used by |
|--------|-------|---------|
| `_detect_intraday()` | 11 | All |
| `_format_chart_time()` | 14 | All |
| `detect_swing_highs_lows()` | 34 | swing, wyckoff |
| `_build_swing_structure()` | 181 | swing, fib-energy, regime, discount, copilot |
| `detect_swings_rdp()` | 149 | swing, regime, discount, copilot |
| `detect_confirmed_swing_points()` | 217 | swing, fib-energy, discount, copilot |
| `detect_swing_points_with_fallback()` | 69 | fib-energy, discount, copilot |
| `calculate_energy_state()` | 192 | fib-energy, discount, copilot |
| `calculate_selling_pressure()` | 125 | fib-energy, discount, copilot |
| `calculate_buying_pressure()` | 120 | copilot |
| `calculate_fib_energy_signal()` | 210 | discount, copilot |
| `_linear_regression_slope()` | 16 | regime |
| `serialize_swing_structure()` | 95 | swing, regime |
| `detect_relative_swing_points()` | 128 | swing (fallback) |

**Total shared code: ~1,561 lines**

---

## Architecture Decision: Shared Module

### New file: `backend/services/pluginHelpers.py`

Extract all shared helpers into this module. Each plugin function in `strategyRunner.py` will `from pluginHelpers import ...` what it needs.

This keeps `strategyRunner.py` focused on plugin functions (business logic) while `pluginHelpers.py` holds the reusable analysis primitives.

**Contents of `pluginHelpers.py`:**
- Utility functions (`_detect_intraday`, `_format_chart_time`)
- Swing detection suite (basic pivots, MAJOR, RDP, relative, fallback, structure builder)
- Energy model (`calculate_energy_state`, `calculate_selling_pressure`, `calculate_buying_pressure`)
- Fibonacci analysis (`calculate_fib_energy_signal`)
- Regime analysis (`_linear_regression_slope`)
- Serialization helpers (`serialize_swing_structure`)
- All necessary dataclasses (`SwingPoint`, `SwingStructure`, etc.)

---

## Conversion Order (dependency-driven)

The order matters because of the dependency chain:

```
Step 0: Extract shared helpers → pluginHelpers.py
Step 1: swing_structure  (no deps beyond shared helpers)
Step 2: regime_filter    (uses swing detection from shared helpers)
Step 3: wyckoff_accumulation (standalone, but move to proper plugin path)
Step 4: fib_energy       (uses swing + energy from shared helpers)
Step 5: discount_zone    (uses swing + fib-energy from shared helpers)
Step 6: discount_wyckoff_pipeline (composite: discount + wyckoff)
```

### Note on `copilot`

The `copilot` scanner mode (`generate_copilot_analysis`) is a superset of `fib_energy` — it combines fib + energy + buying/selling pressure + a go/no-go reasoning engine. It's currently exposed in `patternScanner.py` but is **not registered as a plugin in the registry**.

**Decision**: Do NOT convert copilot to a StrategyRunner plugin. It's an AI analysis function, not a signal detector. It belongs as a service endpoint (e.g., called by the Co-Pilot chat), not in the plugin system. We'll leave the `copilot` code in `patternScanner.py` for now, or move it to its own service file later. The shared helpers it needs will be importable from `pluginHelpers.py`.

---

## Step-by-Step Plan

### Step 0: Extract Shared Helpers

**Create `backend/services/pluginHelpers.py`**

1. Copy from `patternScanner.py`:
   - All dataclasses: `OHLCV` (already in strategyRunner, so import from there or define canonical one), `SwingPoint`, `SwingStructure`, any others
   - Utility functions: `_detect_intraday()`, `_format_chart_time()`
   - Swing detection: `detect_swing_highs_lows()`, `detect_confirmed_swing_points()`, `detect_swings_rdp()`, `detect_relative_swing_points()`, `detect_swing_points_with_fallback()`, `_build_swing_structure()`
   - Energy model: `calculate_energy_state()`, `calculate_selling_pressure()`, `calculate_buying_pressure()`
   - Fibonacci: `calculate_fib_energy_signal()`
   - Regime: `_linear_regression_slope()`
   - Serialization: `serialize_swing_structure()`, `serialize_wyckoff_pattern()`
   - Wyckoff helpers: `find_major_peaks()`

2. Add proper imports at the top (numpy, fastrdp, etc.)
3. Use the same `OHLCV` dataclass from `strategyRunner.py` (or make it the canonical import source)
4. Test: `python -c "from pluginHelpers import detect_swings_rdp; print('OK')"`

**Update `patternScanner.py`**: 
- Replace extracted function bodies with imports from `pluginHelpers`
- This keeps `patternScanner.py` working for the `copilot` mode and any direct CLI usage during transition
- Can be deleted entirely once all modes are converted

---

### Step 1: Convert `swing_structure`

**New plugin function**: `run_swing_structure_plugin()` in `strategyRunner.py`

**Input adaptation**:
- Receives `(data, structure, spec, symbol, timeframe)` per standard signature
- Reads swing params from `spec['setup_config']`: `swing_method`, `swing_pct`, `swing_epsilon_pct`
- Calls `detect_swing_points_with_fallback()` from `pluginHelpers`

**Output adaptation** — must return `List[StrategyCandidate]`:
```python
{
    'candidate_id': f"{symbol}_{timeframe}_swing_{hash}_{window}",
    'strategy_version_id': spec['strategy_version_id'],
    'spec_hash': spec.get('spec_hash', ''),
    'symbol': symbol,
    'timeframe': timeframe,
    'score': <derived from swing quality>,
    'entry_ready': <True if fresh swing confirmed>,
    'rule_checklist': [
        {'rule_name': 'Swing detected', 'passed': True, 'value': 'HH', 'threshold': 'any'},
        {'rule_name': 'Min swing %', 'passed': True, 'value': 0.18, 'threshold': 0.15},
    ],
    'anchors': {
        'latest_swing': {'index': i, 'price': p, 'date': d, 'type': 'HH|HL|LH|LL'},
        'previous_swing': {...},
    },
    'window_start': <start index>,
    'window_end': <end index>,
    'pattern_type': 'swing_structure',
    'created_at': datetime.utcnow().isoformat() + 'Z',
    'chart_data': <serialize bars>,
    'swing_structure': <full swing structure data for frontend charting>,
}
```

**JSON definition update** (`swing_structure.json`):
- Remove `"scanner_mode": "swing"`
- Add `"plugin_file": "strategyRunner.py"`, `"plugin_function": "run_swing_structure_plugin"`
- Ensure `default_setup_params.pattern_type` = `"swing_structure"`

**Register in PLUGINS**:
```python
PLUGINS['swing_structure'] = run_swing_structure_plugin
```

**Validation**: Run scan from UI, verify swing results appear.

---

### Step 2: Convert `regime_filter`

**New plugin function**: `run_regime_filter_plugin()` in `strategyRunner.py`

**Reads from setup_config**: `volatility_window`, `slope_window`, `regime_labels`

**Calls**: `detect_swings_rdp()`, `_linear_regression_slope()`, `_build_swing_structure()` from `pluginHelpers`

**Returns**: `List[StrategyCandidate]` — one candidate per detected regime window, with:
- `anchors`: regime boundaries with classification
- `rule_checklist`: volatility level, slope direction, swing structure alignment
- `score`: regime clarity metric

**JSON definition update** (`regime_filter.json`):
- Remove `"scanner_mode": "regime"`
- Add `"plugin_file"`, `"plugin_function"`, `"pattern_type": "regime_filter"`

**Register**: `PLUGINS['regime_filter'] = run_regime_filter_plugin`

---

### Step 3: Convert `wyckoff_accumulation`

**Note**: `wyckoff_accumulation` currently has `scanner_mode: "wyckoff"` which routes it through the legacy **strategy** path (not patternScanner). But it uses the default Wyckoff spec + the old dispatch chain. The RDP variant (`wyckoff_accumulation_rdp`) already goes through the proper plugin path.

**Fix**: Remove `scanner_mode` from `wyckoff_accumulation.json`. Since it already has `pattern_type: "wyckoff_accumulation"` and `run_wyckoff_plugin` is already registered for that key in PLUGINS, this should "just work" — the scan route will auto-generate a StrategySpec from the plugin's `default_setup_params` and route through StrategyRunner.

**Test**: Verify the auto-generated spec uses reasonable defaults from the JSON definition. May need to update `default_structure_config` and `default_setup_params` in `wyckoff_accumulation.json` to match what the old default Wyckoff spec provided.

---

### Step 4: Convert `fib_energy`

**New plugin function**: `run_fib_energy_plugin()` in `strategyRunner.py`

**Reads from setup_config**: `fib_proximity`, `energy_lookback`, `selling_pressure_threshold`

**Calls**: `calculate_fib_energy_signal()`, `calculate_energy_state()`, `detect_swing_points_with_fallback()` from `pluginHelpers`

**Returns**: `List[StrategyCandidate]` with:
- `anchors`: swing high, swing low, current fib level, energy state
- `rule_checklist`: fib proximity, energy state, selling pressure exhaustion, volume confirmation
- `score`: composite fib-energy signal quality
- Pattern-specific: `fib_levels`, `energy_state`, `selling_pressure`

**JSON definition update** (`fib_energy.json`):
- Remove `"scanner_mode": "fib-energy"`
- Add proper plugin references

**Register**: `PLUGINS['fib_energy'] = run_fib_energy_plugin`

---

### Step 5: Convert `discount_zone`

**New plugin function**: `run_discount_zone_plugin()` in `strategyRunner.py`

**Reads from setup_config**: `min_markdown_pct`, `structure_intact_check`, `fib_confirmation`

**Calls**: `scan_discount_zone()` logic from `pluginHelpers` (may refactor `scan_discount_zone` into the helper or keep inline)

**Returns**: `List[StrategyCandidate]` with:
- `anchors`: all-time/52wk high, current price, retracement level
- `rule_checklist`: uptrend confirmed, markdown >= threshold, structure intact, fib level, energy state
- `score`: discount quality

**JSON definition update** (`discount_zone.json`):
- Remove `"scanner_mode": "discount-only"`
- Add proper plugin references

**Register**: `PLUGINS['discount_zone'] = run_discount_zone_plugin`

---

### Step 6: Convert `discount_wyckoff_pipeline`

**New plugin function**: `run_discount_wyckoff_pipeline_plugin()` in `strategyRunner.py`

This is a **composite plugin** — it runs discount zone detection first, then Wyckoff pattern detection on passing candidates.

**Implementation**:
```python
def run_discount_wyckoff_pipeline_plugin(data, structure, spec, symbol, timeframe):
    # Stage 1: Run discount zone check
    discount_results = run_discount_zone_plugin(data, structure, spec, symbol, timeframe)
    if not discount_results:
        return []
    
    # Stage 2: Run Wyckoff on discount candidates
    wyckoff_results = run_wyckoff_plugin(data, structure, spec, symbol, timeframe)
    
    # Merge: only return Wyckoff candidates that also passed discount
    # Score = average of both scores
    ...
```

**JSON definition update** (`discount_wyckoff_pipeline.json`):
- Remove `"scanner_mode": "discount"` and `"secondary_scanner_mode": "wyckoff"`
- Add proper plugin references

**Register**: `PLUGINS['discount_wyckoff_pipeline'] = run_discount_wyckoff_pipeline_plugin`

---

## Step 7: Cleanup

After all 6 are converted:

1. **Remove legacy routing from `candidates.ts`**:
   - Delete the `scanner_mode` check in the plugin block (lines 375-378)
   - Delete the entire patternScanner spawn section (lines ~560-650)
   - Delete the legacy scan mode dispatch (`if scanMode === 'swing' ... else if ...`)
   - Remove `scanMode` variable entirely — everything goes through StrategyRunner

2. **Deprecate `patternScanner.py` CLI scan modes**:
   - Keep the file for `copilot` mode and any direct research usage
   - Remove `--swing`, `--fib-energy`, `--discount`, `--regime` flags from argparse
   - Or simply leave them for backward compatibility but add a deprecation notice

3. **Remove the `scanner_mode` field from type definitions**:
   - Clean up `ScanRequest` interface if it has `scanMode` 
   - Remove `scanMode` references from frontend `index.js`

4. **Test all indicators** from the Scanner UI

---

## File Summary

| File | Action |
|------|--------|
| `backend/services/pluginHelpers.py` | **CREATE** — shared analysis primitives (~1,600 lines) |
| `backend/services/strategyRunner.py` | **MODIFY** — add 4 new plugin functions, register in PLUGINS |
| `backend/services/patternScanner.py` | **MODIFY** — replace function bodies with imports from pluginHelpers |
| `backend/data/patterns/swing_structure.json` | **MODIFY** — remove scanner_mode, add plugin refs |
| `backend/data/patterns/fib_energy.json` | **MODIFY** — remove scanner_mode, add plugin refs |
| `backend/data/patterns/regime_filter.json` | **MODIFY** — remove scanner_mode, add plugin refs |
| `backend/data/patterns/discount_zone.json` | **MODIFY** — remove scanner_mode, add plugin refs |
| `backend/data/patterns/discount_wyckoff_pipeline.json` | **MODIFY** — remove scanner_mode, add plugin refs |
| `backend/data/patterns/wyckoff_accumulation.json` | **MODIFY** — remove scanner_mode |
| `backend/src/routes/candidates.ts` | **MODIFY** — remove legacy patternScanner spawn path |

---

## Complexity Estimate

| Step | Estimated Effort | Risk |
|------|-----------------|------|
| Step 0: Extract helpers | Medium (mostly copy-paste + imports) | Low — mechanical |
| Step 1: swing_structure | High (largest, most modes) | Medium — output format adaptation |
| Step 2: regime_filter | Low (small, simple) | Low |
| Step 3: wyckoff_accumulation | Low (just remove scanner_mode) | Low — already has plugin |
| Step 4: fib_energy | Medium (energy model complexity) | Medium — complex output |
| Step 5: discount_zone | Medium (multi-criteria logic) | Medium |
| Step 6: discount_wyckoff_pipeline | Medium (composite orchestration) | Medium — two-stage merge |
| Step 7: Cleanup | Low (delete dead code) | Low |

**Total**: ~4-6 working sessions

---

## Success Criteria

- [ ] All 9 indicators in registry have NO `scanner_mode` field
- [ ] All 9 indicators scannable from the UI Scanner dropdown
- [ ] `patternScanner.py` is no longer spawned by `candidates.ts` for scan requests
- [ ] No `--swing`, `--fib-energy`, `--regime`, `--discount` flags passed from TypeScript
- [ ] Each plugin returns proper `StrategyCandidate` format with `rule_checklist`, `anchors`, `score`
- [ ] Frontend renders results identically (or better) than legacy path
