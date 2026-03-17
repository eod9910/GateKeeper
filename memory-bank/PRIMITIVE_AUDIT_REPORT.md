# PRIMITIVE Indicators Audit Report

**Date:** 2026-02-16  
**Registry:** `backend/data/patterns/registry.json`  
**Patterns Directory:** `backend/data/patterns/`  
**Plugins Directory:** `backend/services/plugins/`

---

## Summary Table

| pattern_id | JSON exists | plugin_file | plugin_function | Python exists | has node_result | issues |
|------------|:-----------:|-------------|-----------------|:-------------:|:---------------:|--------|
| ma_crossover | ✅ | `plugins/ma_crossover.py` | `run_ma_crossover_plugin` | ✅ | ❌ | Returns candidates only; no node_result. Heavy patternScanner imports (14 symbols). |
| golden_cross_50_200_sma | ✅ | `plugins/golden_cross_50_200_sma.py` | `run_ma_crossover_plugin` | ✅ | ❌ | Same as ma_crossover. Candidate hardcodes `pattern_type: 'ma_crossover'` instead of pattern_id. |
| fib_location_primitive | ✅ | `plugins/fib_location_primitive.py` | `run_fib_location_primitive_plugin` | ✅ | ✅ | Imports fib_energy_primitives (resolve_fib_signal → calculate_fib_energy_signal). Stage has passed/score/features/anchors/reason. |
| energy_state_primitive | ✅ | `plugins/energy_state_primitive.py` | `run_energy_state_primitive_plugin` | ✅ | ✅ | Same fib_energy_primitives dependency. |
| fib_signal_trigger_primitive | ✅ | `plugins/fib_signal_trigger_primitive.py` | `run_fib_signal_trigger_primitive_plugin` | ✅ | ✅ | Same fib_energy_primitives dependency. |
| regime_filter | ✅ | `plugins/regime_filter.py` | `run_regime_filter_plugin` | ✅ | ❌ | **Param mismatch:** JSON uses `regime_lookback_bars`; plugin reads `lookback`. Plugin ignores tunable `regime_lookback_bars`. No node_result. Heavy patternScanner imports. |
| rdp_swing_structure | ✅ | `plugins/rdp_swing_structure.py` | `run_rdp_pivots_plugin` | ✅ | ❌ | No node_result. Clean, minimal imports. |
| rsi_cross_30_primitive | ✅ | `plugins/rsi_cross_30_primitive.py` | `run_rsi_cross_30_primitive_plugin` | ✅ | ✅ | Hardcoded spec_hash, strategy_version_id. No patternScanner import; self-contained. OHLCV supports `__getitem__` so dict-style access works. |

---

## Detailed Findings

### A. JSON Definition Files

All 8 primitive definition files exist under `backend/data/patterns/`:
- `ma_crossover.json`
- `golden_cross_50_200_sma.json`
- `fib_location_primitive.json`
- `energy_state_primitive.json`
- `fib_signal_trigger_primitive.json`
- `regime_filter.json`
- `rdp_swing_structure.json`
- `rsi_cross_30_primitive.json`

### B. Plugin File & Function Mapping

| pattern_id | plugin_file | plugin_function |
|------------|-------------|-----------------|
| ma_crossover | plugins/ma_crossover.py | run_ma_crossover_plugin |
| golden_cross_50_200_sma | plugins/golden_cross_50_200_sma.py | run_ma_crossover_plugin |
| fib_location_primitive | plugins/fib_location_primitive.py | run_fib_location_primitive_plugin |
| energy_state_primitive | plugins/energy_state_primitive.py | run_energy_state_primitive_plugin |
| fib_signal_trigger_primitive | plugins/fib_signal_trigger_primitive.py | run_fib_signal_trigger_primitive_plugin |
| regime_filter | plugins/regime_filter.py | run_regime_filter_plugin |
| rdp_swing_structure | plugins/rdp_swing_structure.py | run_rdp_pivots_plugin |
| rsi_cross_30_primitive | plugins/rsi_cross_30_primitive.py | run_rsi_cross_30_primitive_plugin |

### C. Python Plugin File Existence

All 8 plugin files exist under `backend/services/plugins/`.

### D. node_result Structure

**Required for primitives used in composites:** `{ passed, score, features, anchors, reason }`

- **With node_result (composite-ready):** fib_location_primitive, energy_state_primitive, fib_signal_trigger_primitive, rsi_cross_30_primitive  
  - Fib primitives embed `stage` from fib_energy_primitives (evaluate_location_stage, evaluate_energy_stage, evaluate_trigger_stage) which have the correct shape.

- **Without node_result:** ma_crossover, golden_cross_50_200_sma, regime_filter, rdp_swing_structure  
  - These return StrategyCandidate-like dicts with score, anchors, rule_checklist, etc., but no explicit `node_result` key. Composite runner expects `candidate.get("node_result")` for node evaluation.

### E. Old/Monolithic Code

| Primitive | Notes |
|-----------|-------|
| ma_crossover | Imports 14 symbols from patternScanner (detect_accumulation_bases, detect_markup, detect_second_pullback, find_major_peaks, detect_swing_points_with_fallback, detect_swings_rdp, _detect_intraday, _format_chart_time, serialize_swing_structure, detect_regime_windows, _linear_regression_slope, calculate_selling_pressure, calculate_buying_pressure, calculate_energy_state, scan_discount_zone). Only uses _detect_intraday, _format_chart_time for chart building. |
| golden_cross_50_200_sma | Same bloated imports as ma_crossover. |
| fib_location_primitive | Imports fib_energy_primitives; delegates to resolve_fib_signal (calls calculate_fib_energy_signal from patternScanner). Properly factored. |
| energy_state_primitive | Same fib_energy_primitives dependency. |
| fib_signal_trigger_primitive | Same fib_energy_primitives dependency. |
| regime_filter | Imports 14 symbols from patternScanner; uses detect_regime_windows, _detect_intraday, _format_chart_time. |
| rdp_swing_structure | Minimal: patternScanner (OHLCV, detect_swings_rdp, serialize_swing_structure). Clean. |
| rsi_cross_30_primitive | No patternScanner import. Self-contained RSI logic. |

---

## Flagged Issues

### High Priority

1. **regime_filter setup param mismatch**  
   - JSON `default_setup_params` and `tunable_params` define `regime_lookback_bars`.  
   - Plugin reads `setup.get('lookback', 26)`.  
   - **Fix:** Use `setup.get('regime_lookback_bars', setup.get('lookback', 26))` or align JSON to use `lookback`.

### Medium Priority

2. **Primitives without node_result**  
   - ma_crossover, golden_cross_50_200_sma, regime_filter, rdp_swing_structure return candidate dicts without `node_result`.  
   - If used inside a composite (via composite_runner), node evaluation will fail or be skipped.  
   - **Recommendation:** Add `node_result` to each candidate when used as composite nodes.

3. **Bloated imports**  
   - ma_crossover, golden_cross_50_200_sma, regime_filter import many unused patternScanner symbols.  
   - **Recommendation:** Reduce to only what’s used (e.g. OHLCV, _detect_intraday, _format_chart_time).

### Low Priority

4. **golden_cross candidate pattern_type**  
   - Candidates use `pattern_type: 'ma_crossover'` instead of `'golden_cross_50_200_sma'` for consistency with pattern_id.

5. **rsi_cross_30 hardcoded values**  
   - Uses `spec_hash: "hash_placeholder"` and `strategy_version_id: "1.0.0"` instead of values from spec.
