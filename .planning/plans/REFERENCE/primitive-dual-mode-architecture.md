# Primitive Dual-Mode Architecture

Status: Planning  
Date: 2026-02-17

## Problem

The backtest engine has been polluted with hardcoded signal generators that duplicate
primitive logic. This happened because:

1. Primitives only have **scan mode** (retrospective, full data)
2. Backtesting needs **signal mode** (causal, bar-by-bar, no lookahead)
3. Since primitives couldn't generate causal signals, the logic was hardcoded in the engine

Additionally, chart overlays (MAs, RSI, Fib lines) are missing from the scanner view.
You can see the swing structure arrows but not the indicators that would help you visually
evaluate the trade.

## Solution: Every Primitive Gets Two Modes

### Mode 1: `scan` (existing)
- Retrospective, full data
- Used by the Scanner to show "here's the current picture"
- Returns: `chart_data`, `markers`, `fib_levels`, `output_ports`, `rule_checklist`
- No lookahead concern — you're viewing, not trading

### Mode 2: `signal` (new)
- Causal, bar-by-bar
- Used by the Backtest Engine via the Validator
- Returns: `set[int]` — the bar indices where a signal fires
- Must guarantee: at bar `i`, only data `[0..i]` is used
- Lives IN the primitive, not in the backtest engine

## What Changes

### 1. Primitive Plugin Contract (Python)

Every primitive plugin function gets an optional `mode` parameter:

```python
def run_my_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",       # "scan" or "signal"
    **kwargs: Any,
) -> Union[List[Dict], set[int]]:
    if mode == "signal":
        return _generate_signal_indices(data, spec, timeframe)
    else:
        return _scan_and_annotate(data, spec, symbol, timeframe)
```

- `mode="scan"` → returns list of candidate dicts (existing behavior)
- `mode="signal"` → returns `set[int]` of signal bar indices (new)

### 2. Backtest Engine (Python)

The engine becomes a PURE trade simulator:

```python
def run_backtest_on_bars(symbol, timeframe, bars, spec, signal_indices):
    # signal_indices is REQUIRED — no more generating its own
    # Engine does: entry, stop, target, trailing, P&L, fees
    # Engine does NOT: detect patterns, find structure, compute indicators
```

Remove from engine:
- `_structure_break_signal_indices` ✅ (already removed)
- `_choch_fib_pullback_signal_indices` ✅ (already removed)
- Keep `_ma_crossover_signal_indices` temporarily (move to MA primitive later)
- Keep `_legacy_sma_signal_indices` for legacy compat

### 3. Validator Pipeline (Python)

The pipeline calls the primitive in signal mode:

```python
# In validatorPipeline.py
def get_signal_indices(bars, spec, symbol, timeframe):
    """Call the primitive's signal mode to get entry bar indices."""
    plugin_fn = load_plugin(spec)
    return plugin_fn(data=bars_to_ohlcv(bars), structure=None,
                     spec=spec, symbol=symbol, timeframe=timeframe,
                     mode="signal")
```

### 4. Composite Signal Generation

For composites (Structure → Location → Trigger → Verdict):

```python
def composite_signal_mode(data, spec, symbol, timeframe):
    """Run each primitive stage in signal mode, AND the results."""
    stage_signals = []
    for stage in spec["stages"]:
        primitive_fn = load_plugin(stage)
        signals = primitive_fn(data=data, ..., mode="signal")
        stage_signals.append(signals)
    
    # AND reducer: only fire where ALL stages agree
    combined = stage_signals[0]
    for s in stage_signals[1:]:
        combined = combined & s
    return combined
```

### 5. Chart Overlays (Frontend)

Primitives should return overlay data for visual indicators:

```python
# In scan mode, a primitive can return overlay series
candidate["overlay_series"] = [
    {
        "type": "line",           # line, histogram, area
        "label": "RSI(14)",
        "panel": "sub",           # "main" for price overlay, "sub" for sub-panel
        "data": [{"time": t, "value": v} for t, v in rsi_values],
        "color": "#8b5cf6",
    },
    {
        "type": "line",
        "label": "SMA(50)",
        "panel": "main",          # overlays on price chart
        "data": [{"time": t, "value": v} for t, v in sma_values],
        "color": "#3b82f6",
    },
]
```

Frontend `chart.js` renders these:
- `panel: "main"` → adds a line series on the candlestick chart
- `panel: "sub"` → creates a sub-panel below (like TradingView RSI/MACD panels)

## Implementation Order

### Phase 1: Signal Mode for Existing Primitives
1. Add `mode` parameter to `choch_primitive.py` → signal mode returns break bar indices
2. Add `mode` parameter to `impulse_trough_primitive.py` → signal mode returns trough bar indices
3. Add `mode` parameter to `unified_swing_primitive.py` → signal mode returns swing bar indices
4. Update `validatorPipeline.py` to call primitives in signal mode
5. Remove remaining hardcoded signal generators from backtest engine

### Phase 2: Chart Overlays
1. Add `overlay_series` to RSI primitive (sub-panel)
2. Add `overlay_series` to MA crossover primitive (main panel line)
3. Update `chart.js` to render `overlay_series` (main overlays + sub-panels)
4. Add `overlay_series` to Fib primitive (horizontal lines on main)

### Phase 3: Composite Signal Mode
1. Add signal mode to `composite_runner.py`
2. Composite calls each stage primitive in signal mode
3. AND reducer produces combined signal indices
4. Strategy wraps composite, passes signals to backtest engine

### Phase 4: Trade Visualization
1. Backtest engine returns trade entry/exit points with timestamps
2. Chart renders entry arrows (green up for long, red down for short)
3. Chart renders stop lines and target lines
4. Chart renders trade outcome (green/red shading for win/loss)

## What Stays Clean

- **Primitive** = one question, two modes (scan + signal)
- **Composite** = wires primitives, one verdict (GO/NO_GO), works in both modes
- **Strategy** = risk rules + composite reference (no detection logic)
- **Backtest Engine** = pure trade simulator (no signal logic)
- **Chart** = renders what the primitive tells it to render

## Sample End-to-End Flow

### Scanner (visual)
1. User selects "Unified Swing Structure" primitive, daily, Small Caps
2. Scanner calls primitive in `scan` mode
3. Primitive returns `chart_data`, `markers` (T1/T2/FILL arrows), `overlay_series` (optional)
4. Chart renders candlesticks + arrows + overlays

### Validator (backtest)
1. User selects "ChoCH Pullback 50% Gate" strategy
2. Strategy references composite: Structure (Unified Swing) → Location (Fib 50%) → Trigger (ChoCH break)
3. Validator calls composite in `signal` mode
4. Composite calls each primitive in signal mode, AND-reduces
5. Returns `set[int]` of signal bar indices
6. Backtest engine simulates trades on those indices
7. Report shows win rate, expectancy, R-multiples
