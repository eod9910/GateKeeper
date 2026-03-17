# Plugin System Architecture
## AI-Generated Detection Plugins

---

## The Vision

No one writes detection logic by hand. You have a conversation with an AI.
The AI writes the Python code. It becomes a plugin. It shows up in a dropdown.

---

## Plugin Categories

The system has a categorized library of detection plugins:

### 1. Chart Patterns
Multi-phase structural patterns that unfold over time.
- Wyckoff Accumulation (exists)
- Wyckoff Distribution (future)
- Head & Shoulders (future)
- Inverse Head & Shoulders (future)
- Quasimodo (future)
- Double Bottom / Double Top (future)
- Cup & Handle (future)
- Flag / Pennant (future)
- Triangle (ascending, descending, symmetrical) (future)

### 2. Indicator Signals
Mathematical indicators that generate entry signals.
- MA Crossover (50/200, 20/50, custom)
- RSI Divergence (bullish, bearish)
- MACD Signal Cross
- Bollinger Band Squeeze → Expansion
- Stochastic Oversold/Overbought
- Volume Spike + Price Breakout
- ATR Expansion (volatility breakout)

### 3. Price Action
Single-bar or multi-bar candlestick patterns.
- Engulfing (bullish, bearish)
- Pin Bar / Hammer
- Inside Bar Breakout
- Morning Star / Evening Star
- Three White Soldiers / Three Black Crows

### 4. Custom
Whatever the AI generates from conversation.
- User-defined combinations
- Multi-indicator confluences
- Composite signals

---

## Plugin Registry

Each plugin is a JSON definition + a Python detection function.

### Registry Location
```
backend/data/patterns/
  ├── registry.json                    ← master list of all plugins
  ├── wyckoff_accumulation.json        ← pattern definition
  ├── ma_crossover.json                ← pattern definition (future)
  └── ...
```

### Registry Entry (registry.json)
```json
{
  "plugins": [
    {
      "pattern_id": "wyckoff_accumulation",
      "name": "Wyckoff Accumulation",
      "category": "chart_patterns",
      "description": "Detects accumulation bases after major markdowns",
      "version": 1,
      "status": "active",
      "created_by": "manual",
      "python_module": "plugins.wyckoff_accumulation"
    },
    {
      "pattern_id": "ma_crossover",
      "name": "Moving Average Crossover",
      "category": "indicator_signals",
      "description": "Detects when fast MA crosses above/below slow MA",
      "version": 1,
      "status": "active",
      "created_by": "ai_generated",
      "python_module": "plugins.ma_crossover"
    }
  ]
}
```

### Pattern Definition (per plugin)
```json
{
  "pattern_id": "wyckoff_accumulation",
  "name": "Wyckoff Accumulation",
  "category": "chart_patterns",
  "description": "Detects accumulation bases after 70%+ markdowns from prior peaks",

  "structure_config": {
    "swing_method": "rdp",
    "swing_epsilon_pct": 0.05,
    "swing_left_bars": 10,
    "swing_right_bars": 10,
    "swing_first_peak_decline": 0.5,
    "swing_subsequent_decline": 0.25,
    "base_min_duration": 20,
    "base_max_duration": 500,
    "base_max_range_pct": 0.8,
    "base_volatility_threshold": 0.1,
    "causal": false
  },

  "default_setup_params": {
    "min_prominence": 0.2,
    "peak_lookback": 50,
    "min_markdown_pct": 0.7,
    "markdown_lookback": 300,
    "base_resistance_closes": 3,
    "markup_lookforward": 100,
    "markup_min_breakout_bars": 2,
    "pullback_lookforward": 200,
    "pullback_retracement_min": 0.3,
    "pullback_retracement_max": 5.0,
    "double_bottom_tolerance": 1.05,
    "breakout_multiplier": 1.02,
    "score_min": 0
  },

  "default_entry": {
    "trigger": "second_breakout",
    "breakout_pct_above": 0.02,
    "confirmation_bars": 1
  },

  "available_entries": [
    { "trigger": "second_breakout", "description": "Enter on breakout after pullback" },
    { "trigger": "base_breakout", "description": "Enter on first breakout above base" },
    { "trigger": "pullback_bounce", "description": "Enter on bounce from pullback low" }
  ],

  "tunable_params": [
    { "name": "min_markdown_pct", "type": "float", "min": 0.3, "max": 0.95, "description": "Minimum decline from peak" },
    { "name": "pullback_retracement_min", "type": "float", "min": 0.1, "max": 0.8, "description": "Minimum pullback depth" },
    { "name": "breakout_multiplier", "type": "float", "min": 1.0, "max": 1.10, "description": "How far above resistance for breakout" }
  ]
}
```

---

## UI: Plugin Selector

The "New Strategy" form gets a two-dropdown selector:

```
[Category ▼]     [Pattern ▼]
 Chart Patterns    Wyckoff Accumulation
 Indicator Signals MA Crossover
 Price Action      ...
 Custom            ...
```

When a pattern is selected:
1. Load the pattern definition from the registry
2. Pre-fill structure_config (hidden from user)
3. Pre-fill setup params with defaults
4. Show available entry triggers as dropdown
5. Show tunable params as sliders/inputs (advanced section)
6. User defines risk + exit
7. Done

---

## AI Plugin Generator

### How It Works

1. **User starts a conversation** on the Strategy page:
   "I want to create a new detection plugin that finds stocks where the 50-day MA
   crosses above the 200-day MA and volume is above average"

2. **AI asks clarifying questions:**
   - "What timeframe? Daily? Weekly?"
   - "Simple or exponential moving average?"
   - "How much above average should volume be? 1.5x? 2x?"
   - "Should the cross happen in the last N bars, or any time?"

3. **AI generates the Python plugin code:**
   ```python
   def detect_ma_crossover(data, params):
       """Detect moving average crossover with volume confirmation."""
       fast = data['Close'].rolling(params.get('fast_period', 50)).mean()
       slow = data['Close'].rolling(params.get('slow_period', 200)).mean()
       vol_avg = data['Volume'].rolling(20).mean()

       # Find crossover points
       cross_up = (fast > slow) & (fast.shift(1) <= slow.shift(1))

       # Volume confirmation
       vol_threshold = params.get('volume_multiple', 1.5)
       vol_confirmed = data['Volume'] > (vol_avg * vol_threshold)

       candidates = []
       for idx in data.index[cross_up & vol_confirmed]:
           candidates.append({
               'signal_bar': idx,
               'fast_ma': fast[idx],
               'slow_ma': slow[idx],
               'volume_ratio': data['Volume'][idx] / vol_avg[idx],
               'entry_price': data['Close'][idx],
               'score': min(1.0, (data['Volume'][idx] / vol_avg[idx]) / 3.0)
           })
       return candidates
   ```

4. **AI generates the pattern definition JSON** (registry entry + defaults)

5. **Plugin gets saved and registered:**
   - Python file → `backend/services/plugins/ma_crossover.py`
   - JSON definition → `backend/data/patterns/ma_crossover.json`
   - Registry updated → `backend/data/patterns/registry.json`

6. **Plugin shows up in the dropdown** next time the user opens "New Strategy"

### Plugin Generator AI Role

This is a NEW AI role (not in ai_role_contracts.md yet):

**Plugin Engineer** — "I write detection code. I don't trade."

- Allowed: Generate Python detection functions, define parameter schemas, create test cases
- Forbidden: Claim the detection has edge, recommend trading it, skip validation
- Output: Python code + JSON definition + test expectations
- Posture: "I build the eyes. The validator decides if what they see is useful."

### Safety

- All AI-generated plugins start as `status: "experimental"`
- They MUST pass through the Pattern Scanner (labeling) to verify they detect real patterns
- They MUST pass through the Validator (backtester) before any strategy using them is approved
- AI-generated code is sandboxed (no file access, no network, only OHLCV data + numpy/pandas)

---

## The Complete Pipeline (Updated)

```
User describes a detection idea
         │
         ▼
  AI Plugin Generator
  (conversation → Python code + JSON definition)
         │
         ▼
  Plugin Registry
  (categorized, with defaults, versioned)
         │
         ▼
  Pattern Scanner (R&D)
  (Does this plugin actually detect real patterns? Label: Yes/No/Correct)
         │
         ▼
  Strategy Co-Pilot
  (Select plugin → wrap with entry/risk/exit → create StrategySpec)
         │
         ▼
  Validator
  (Backtest the strategy. PASS/FAIL.)
         │
         ▼
  Instrument Scanner (Production)
  (Scan market with approved strategy → candidates)
         │
         ▼
  Trading Co-Pilot
  (Candidate → stop/target/size → GO/NO-GO)
         │
         ▼
  Trading Desk
  (Execute. Enforce rules. Machine-enforced.)
```

---

## What Exists vs What We Need to Build

| Component | Status | Notes |
|-----------|--------|-------|
| Wyckoff plugin | EXISTS | Hardcoded in patternScanner.py |
| Pattern registry (JSON) | NEEDS BUILDING | Store pattern definitions separately |
| Registry API (GET /api/patterns) | NEEDS BUILDING | Serve available patterns to frontend |
| Plugin selector UI (dropdowns) | NEEDS BUILDING | Category + pattern dropdowns on strategy page |
| Auto-load structure_config | NEEDS BUILDING | When pattern selected, load defaults |
| AI Plugin Generator | NEEDS BUILDING | Conversation → Python code |
| Plugin sandboxing | NEEDS BUILDING | Safe execution of AI-generated code |
| Second plugin (MA crossover) | NEEDS BUILDING | Proof that the system works for >1 pattern |

## Build Order

1. **Pattern Registry** — Create the JSON files and API endpoint
2. **Plugin Selector UI** — Add dropdowns to the strategy page
3. **Auto-load defaults** — Pattern selection loads structure_config + setup params
4. **MA Crossover plugin** — Build manually as proof of concept
5. **AI Plugin Generator** — The AI writes Python detection code from conversation
6. **Plugin sandboxing** — Safety layer for AI-generated code

Steps 1-4 are immediate. Step 5 is the game-changer. Step 6 makes it production-safe.
