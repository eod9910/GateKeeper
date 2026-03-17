# Strategy Authoring Guide

> How strategies are structured, written, and executed in the Pattern Detector system.
> This document is the spec for building a Strategy Co-Pilot that helps author new strategies.

---

## 1. Core Principle

**A strategy is not code. A strategy is a testable hypothesis.**

Strategies are authored as structured JSON conforming to the `StrategySpec` schema.
They are:
- Versioned (each edit creates a new version, old versions are immutable)
- Auditable (every parameter has a name, value, and threshold)
- Validatable (the validator backtests them before they go live)
- Machine-interpretable (no prose, no discretion, no "feel")

The JSON is consumed by a Python **strategy runner** that executes the hypothesis
against market data and returns standardized **candidates** with rule checklists,
anchor points, and scores.

---

## 2. The StrategySpec Schema

Every strategy JSON has these sections:

### 2.1 Identity

```json
{
  "strategy_id": "wyckoff_accumulation",
  "version": "1",
  "strategy_version_id": "wyckoff_accumulation_v1",
  "status": "draft",
  "name": "Wyckoff Accumulation",
  "description": "Human-readable description of the hypothesis",
  "interval": "1wk",
  "universe": []
}
```

| Field | Purpose |
|-------|---------|
| `strategy_id` | Stable identifier across versions |
| `version` | Auto-incremented on each change |
| `strategy_version_id` | `{strategy_id}_v{version}` — unique key |
| `status` | Lifecycle: `draft` → `testing` → `approved` / `rejected` |
| `interval` | Canonical timeframe: `1wk`, `1d`, `4h`, `1h`, `15m` etc. |
| `universe` | Symbol list (empty = scan everything) |

### 2.2 Structure Config

Controls how the engine extracts structural features (swings and bases) from raw OHLCV data.
This is **shared across all pattern types** — it's the "eyes" of the system.

```json
"structure_config": {
  "swing_method": "major",
  "swing_epsilon_pct": 0.05,
  "swing_left_bars": 10,
  "swing_right_bars": 10,
  "swing_first_peak_decline": 0.50,
  "swing_subsequent_decline": 0.25,
  "base_min_duration": 20,
  "base_max_duration": 500,
  "base_max_range_pct": 0.80,
  "base_volatility_threshold": 0.10,
  "causal": false
}
```

| Field | What It Does |
|-------|-------------|
| `swing_method` | Algorithm: `major` (prominence-based), `rdp` (Ramer-Douglas-Peucker), `relative`, `energy` |
| `swing_epsilon_pct` | Sensitivity for RDP method — smaller = more swings detected |
| `swing_left_bars` / `swing_right_bars` | Local pivot detection window |
| `swing_first_peak_decline` | MAJOR mode: how much price must decline from a high to confirm it as a peak (0.50 = 50%) |
| `swing_subsequent_decline` | MAJOR mode: subsequent reversal threshold |
| `base_min_duration` | Minimum bars for a consolidation to qualify as a base |
| `base_max_duration` | Maximum bars (filters out absurdly long ranges) |
| `base_max_range_pct` | Maximum price range as % of midpoint (tight range = real base) |
| `base_volatility_threshold` | Maximum avg bar range / close (low volatility = accumulation) |
| `causal` | **CRITICAL for backtesting**: when true, structure extraction only uses bars ≤ current bar (no lookahead) |

**The v1 vs v2 difference**: v1 uses `swing_method: "major"` (prominence peaks), v2 uses `swing_method: "rdp"` (geometric simplification). Same pattern logic, different eyes.

### 2.3 Setup Config

Pattern-specific parameters. This is where the hypothesis lives.
The `pattern_type` field determines which **plugin** the runner invokes.

```json
"setup_config": {
  "pattern_type": "wyckoff_accumulation",
  "min_prominence": 0.20,
  "peak_lookback": 50,
  "min_markdown_pct": 0.70,
  "markdown_lookback": 300,
  "base_resistance_closes": 3,
  "markup_lookforward": 100,
  "markup_min_breakout_bars": 2,
  "pullback_lookforward": 200,
  "pullback_retracement_min": 0.30,
  "pullback_retracement_max": 5.0,
  "double_bottom_tolerance": 1.05,
  "breakout_multiplier": 1.02,
  "score_min": 0
}
```

Each parameter controls a specific detection rule. Every rule produces a
`{ rule_name, passed, value, threshold }` entry in the output checklist.

### 2.4 Entry Config

When and how to enter a trade once the pattern is detected.

```json
"entry_config": {
  "trigger": "second_breakout",
  "breakout_pct_above": 0.02,
  "confirmation_bars": 1
}
```

| Field | What It Does |
|-------|-------------|
| `trigger` | What event fires the entry: `second_breakout`, `base_breakout`, etc. |
| `breakout_pct_above` | How far above resistance price must close (0.02 = 2%) |
| `confirmation_bars` | How many bars must hold above the level to confirm |

### 2.5 Risk Config

Stop loss placement and position risk rules.

```json
"risk_config": {
  "stop_type": "structural",
  "stop_level": "base_low",
  "stop_buffer_pct": 0.02
}
```

| Field | What It Does |
|-------|-------------|
| `stop_type` | Method: `structural` (anchor-based), `atr_multiple`, `fixed_pct`, `swing_low` |
| `stop_level` | Which anchor to use: `base_low`, `pullback_low`, etc. |
| `stop_buffer_pct` | Buffer below the anchor (0.02 = 2% below base low) |
| `take_profit_R` | Optional: exit at this R-multiple |
| `trailing_stop_R` | Optional: trailing stop at this R |
| `max_hold_bars` | Optional: time stop |

### 2.6 Exit Config

Target / profit-taking logic.

```json
"exit_config": {
  "target_type": "fibonacci",
  "target_level": 0.25,
  "time_stop_bars": null,
  "trailing": null
}
```

| Field | What It Does |
|-------|-------------|
| `target_type` | Method: `fibonacci`, `atr_multiple`, `percentage`, `R_multiple` |
| `target_level` | For fibonacci: retracement level. For R_multiple: number of R. |
| `time_stop_bars` | Max bars in trade before forced exit |
| `trailing` | Trailing stop configuration |

### 2.7 Cost Config

Assumptions for backtesting realism.

```json
"cost_config": {
  "commission_per_trade": 0,
  "spread_pct": 0.001,
  "slippage_pct": 0.001
}
```

### 2.8 Execution Config

Harvest + behavioral lock rules (applied in both backtest and live).

```json
"execution_config": {
  "auto_breakeven_r": 1.0,
  "lock_in_r_ladder": [
    { "at_r": 2, "lock_r": 1 },
    { "at_r": 3, "lock_r": 2 },
    { "at_r": 4, "lock_r": 3 }
  ],
  "green_to_red_protection": {
    "trigger_r": 1.5,
    "floor_r": 0.25,
    "action": "close_market"
  },
  "daily_profit_cap_usd": 500,
  "daily_profit_cap_action": "close_all_and_pause",
  "production_lock": true
}
```

### 2.9 Integrity

```json
"spec_hash": "e07e0e8f..."
```

SHA-256 hash computed from the config-relevant fields (excludes metadata like
timestamps and notes). Used to verify that a candidate was produced by exactly
this version of the spec. Computed identically in both TypeScript and Python.

---

## 3. How the Wyckoff Accumulation Strategy Works

This is the only pattern currently implemented. It detects a 6-phase structure:

### Phase 1: Prior Peak
Find major peaks in the price history using prominence analysis.
A peak must have declined by at least `swing_first_peak_decline` (50%) to qualify.

**Rule**: `min_prominence >= 0.20`
**Anchor**: `prior_peak` (index, price, date)

### Phase 2: Markdown
From each peak, find the lowest low within `markdown_lookback` bars (300).
The decline from peak to low must be >= `min_markdown_pct` (70%).

**Rule**: `markdown_decline >= 0.70` (passed/failed, actual value vs threshold)
**Anchor**: `markdown_low`

### Phase 3: Base (Accumulation)
Find a consolidation zone near the markdown low. Must be:
- At least `base_min_duration` bars long (20)
- Price range within `base_max_range_pct` (80%)
- Volatility below `base_volatility_threshold` (10%)

**Rules**: `base_found`, `base_duration >= 20`
**Anchors**: `base_start`, `base_end`, `base_low`, `base_high`

### Phase 4: First Markup
Price breaks above the base resistance with at least `markup_min_breakout_bars` (2)
bars closing above.

**Rule**: `markup_breakout` (passed if detected)
**Anchor**: `markup_high`

### Phase 5: Pullback
After the first markup, price pulls back. The retracement must be between
`pullback_retracement_min` (30%) and `pullback_retracement_max` (500%) of the
markup range. Also checks for a double bottom (pullback low near base low).

**Rules**: `pullback_found`, `pullback_retracement`, `double_bottom`
**Anchor**: `pullback_low`

### Phase 6: Second Breakout
Price breaks above `base_high * breakout_multiplier` (base high + 2%).
Must be confirmed by `confirmation_bars` (1) bar closing above base high.

**Rule**: `second_breakout`
**Anchor**: `second_breakout` (this is the entry point)

### Scoring (0.0 - 1.0)
```
Pullback quality:     max 0.40  (best: 70-79% retracement)
Double bottom bonus:  max 0.25
Base duration:        max 0.20  (100+ bars = max)
Markdown quality:     max 0.15  (90%+ decline = max)
```

---

## 4. Architecture: How Code Executes a Strategy

```
StrategySpec (JSON)
       │
       ▼
  strategyRunner.py
       │
       ├── extract_structure()      ← uses structure_config
       │     ├── swing detection    ← major / rdp / relative / energy
       │     └── base detection     ← accumulation zones
       │
       ├── PLUGINS[pattern_type]()  ← uses setup_config + entry_config
       │     └── run_wyckoff_plugin()  ← the only plugin currently
       │           ├── Phase 1: Find peaks
       │           ├── Phase 2: Find markdowns
       │           ├── Phase 3: Match to bases
       │           ├── Phase 4: Detect markup breakout
       │           ├── Phase 5: Detect pullback
       │           ├── Phase 6: Detect second breakout
       │           └── Score and assemble candidate
       │
       └── Output: StrategyCandidate[]
             ├── candidate_id (includes spec_hash for integrity)
             ├── rule_checklist: [{rule_name, passed, value, threshold}, ...]
             ├── anchors: {prior_peak, markdown_low, base_start, ...}
             ├── score: 0.0 - 1.0
             ├── entry_ready: boolean
             └── chart_data: OHLCV for rendering
```

### Plugin Architecture

The runner uses a plugin registry:

```python
PLUGINS = {
    'wyckoff_accumulation': run_wyckoff_plugin,
    # Future: 'quasimodo': run_quasimodo_plugin,
    # Future: 'mean_reversion': run_mean_reversion_plugin,
}
```

Each plugin receives:
1. `data` — OHLCV bars
2. `structure` — Pre-extracted swings and bases (shared)
3. `spec` — The full StrategySpec JSON
4. `symbol` — Ticker
5. `timeframe` — Display label

Each plugin returns a list of `StrategyCandidate` dicts with the standardized
schema (rule_checklist, anchors, score, entry_ready).

### Shared vs Plugin-Specific

| Layer | Shared | Plugin-Specific |
|-------|--------|----------------|
| Data fetch | ✅ `fetch_data_yfinance()` | |
| Swing detection | ✅ `extract_structure()` | |
| Base detection | ✅ `detect_accumulation_bases()` | |
| Pattern logic | | ✅ `run_wyckoff_plugin()` |
| Scoring | | ✅ `_score_wyckoff()` |
| Candidate format | ✅ Standard schema | ✅ Legacy compat fields |

---

## 5. How to Author a New Strategy

### Step 1: Define the Hypothesis

Write it in plain language first:
> "I want to find stocks that have been in a strong uptrend, pulled back to the
> 50-day moving average, and are showing a hammer candlestick at support."

### Step 2: Decompose into Detectable Phases

Each phase must have:
- A clear detection rule (machine-evaluable, not "looks like")
- A pass/fail threshold
- An anchor point (price + index + date)

Example decomposition:
1. **Uptrend**: Higher highs and higher lows over last N bars
2. **Pullback to MA**: Close within X% of 50-day MA
3. **Hammer candle**: Body < 30% of range, lower wick > 60% of range
4. **Confirmation**: Next bar closes above hammer high

### Step 3: Map to StrategySpec Sections

- Structural features (swings, MAs) → `structure_config`
- Pattern rules (hammer, divergence) → `setup_config`
- Entry trigger → `entry_config`
- Stop placement → `risk_config`
- Target logic → `exit_config`
- Cost assumptions → `cost_config`

### Step 4: Write the Plugin

Create a new function in `strategyRunner.py`:

```python
def run_ma_pullback_plugin(data, structure, spec, symbol, timeframe):
    """Detect MA pullback patterns."""
    setup = spec.get('setup_config', {})
    # ... detection logic using thresholds from setup ...
    # ... build rule_checklist, anchors, score ...
    return candidates
```

Register it:
```python
PLUGINS['ma_pullback'] = run_ma_pullback_plugin
```

### Step 5: Create the Spec JSON

```json
{
  "strategy_id": "ma_pullback",
  "version": "1",
  "strategy_version_id": "ma_pullback_v1",
  "status": "draft",
  "setup_config": {
    "pattern_type": "ma_pullback",
    "ma_period": 50,
    "pullback_distance_pct": 0.02,
    "hammer_body_max_pct": 0.30,
    "hammer_wick_min_pct": 0.60
  },
  ...
}
```

### Step 6: Validate

Run the spec through the validator to get backtest results, robustness tests,
and a PASS/FAIL verdict before using it live.

---

## 6. Design Invariants (Non-Negotiable)

1. **No implicit logic** — every rule must have a named parameter and threshold
2. **No discretionary language** — "looks strong" is not a rule
3. **No performance claims** — the validator proves performance, the spec doesn't claim it
4. **All rules must be machine-evaluable** — if a human has to interpret it, it's not a rule
5. **AI can author strategies but cannot declare edge or auto-approve**
6. **Changes create new versions** — frozen specs are immutable
7. **Spec hash ensures integrity** — candidates are traceable to exactly the spec that produced them

---

## 7. What a Strategy Co-Pilot Would Do

Given this architecture, an AI co-pilot would:

1. **Take a hypothesis in natural language** and decompose it into phases
2. **Generate a complete StrategySpec JSON** with all required sections
3. **Generate the corresponding Python plugin** (or reuse existing structure extraction)
4. **Suggest parameter ranges** based on historical norms (e.g. "20-bar base minimum is standard for weekly charts")
5. **Flag design issues** — missing confirmation bars, unrealistic thresholds, no cost model
6. **Version and diff** — show what changed between v1 and v2 of a strategy
7. **NEVER auto-approve** — all strategies must pass through the validator

The co-pilot generates hypotheses. The validator proves them. The execution ladder enforces them.

---

## 8. Existing Strategies (Reference)

### Wyckoff Accumulation v1 (Major Peaks)
- **File**: `backend/data/strategies/wyckoff_accumulation_v1.json`
- **Swing method**: `major` — prominence-based peak detection
- **Hypothesis**: After catastrophic decline (>70%), accumulation base forms, first markup proves demand, pullback retests base, second breakout confirms trend reversal
- **Status**: `draft`

### Wyckoff Accumulation v2 (RDP)
- **File**: `backend/data/strategies/wyckoff_accumulation_v2.json`
- **Swing method**: `rdp` — Ramer-Douglas-Peucker geometric simplification
- **Hypothesis**: Same as v1 but with more geometrically accurate swing points
- **Status**: `testing`
- **Only difference from v1**: `structure_config.swing_method = "rdp"` and `description`

### Execution Rules v1 (Futures)
- **File**: `backend/data/strategies/execution_rules_futures_v1.json`
- **Purpose**: Harvest rules for single-contract futures positions

### Execution Rules v1 (Options)
- **File**: `backend/data/strategies/execution_rules_options_v1.json`
- **Purpose**: Scale-out and protection rules for multi-contract options positions

---

## 9. File Map

```
backend/
├── src/types/
│   └── strategy.ts              ← TypeScript type definitions (StrategySpec, StrategyCandidate, ExecutionConfig)
├── services/
│   ├── strategyRunner.py        ← Strategy execution engine (plugins, structure extraction)
│   ├── patternScanner.py        ← Core detection functions (swings, bases, peaks, markup, pullback)
│   ├── executionEngine.ts       ← Execution rule enforcement (pure functions)
│   └── validatorPipeline.py     ← Backtest + robustness validation
├── data/strategies/
│   ├── wyckoff_accumulation_v1.json
│   ├── wyckoff_accumulation_v2.json
│   ├── execution_rules_futures_v1.json
│   └── execution_rules_options_v1.json
└── src/routes/
    ├── strategies.ts            ← CRUD API for strategy specs
    └── validator.ts             ← Validation run/report API
```
