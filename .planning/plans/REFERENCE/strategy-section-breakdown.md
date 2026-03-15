# StrategySpec Section Breakdown
## What Each Section Does and Where It Falls

This document breaks down every section of a StrategySpec and categorizes it by what is **experimental** (you tune it), what is **mathematical** (computed, not discretionary), and what is **boilerplate** (set once, rarely changes).

---

## The Key Insight

A strategy is two things bolted together:

1. **The Signal** — "What are we looking for?" (the entry/pattern)
2. **The System** — "What do we do when we find it?" (risk, exit, sizing, execution)

You experiment with the signal. The system is mostly math and rules.

---

## Section-by-Section Breakdown

### 1. STRUCTURE CONFIG — "How do we read the chart?"

**Category: SIGNAL (experimental)**

```json
{
  "swing_method": "rdp",              // Algorithm for finding swing points
  "swing_epsilon_pct": 0.05,          // Sensitivity of swing detection
  "swing_left_bars": 10,              // How far left to look for pivot
  "swing_right_bars": 10,             // How far right to confirm pivot
  "swing_first_peak_decline": 0.5,    // Major mode: how much decline confirms a peak
  "swing_subsequent_decline": 0.25,   // Major mode: reversal threshold
  "base_min_duration": 20,            // Minimum bars for a base to count
  "base_max_duration": 500,           // Maximum bars for a base
  "base_max_range_pct": 0.8,          // How tight must the base be
  "base_volatility_threshold": 0.1,   // Max noise inside the base
  "causal": false                     // Lookahead bias control (true for backtest)
}
```

**What it does:** Controls how the system extracts features from raw OHLCV price data. Before you can find any pattern, you need to identify swing highs, swing lows, and consolidation bases. This section calibrates that detection.

**Analogy:** This is like adjusting the focus on a microscope. Different settings make you see different structures in the same price data. RDP method sees geometric simplification. Major method sees prominence-based peaks.

**What you experiment with:**
- `swing_method`: RDP vs Major produces different swing points from the same data
- `swing_epsilon_pct`: Higher = fewer swings (less noise, but might miss real ones)
- `base_min_duration`: Too short = false bases. Too long = misses real bases.

**What stays fixed:** `causal` must be `true` for backtesting (prevents lookahead bias).

---

### 2. SETUP CONFIG — "What pattern are we looking for?"

**Category: SIGNAL (experimental)**

```json
{
  "pattern_type": "wyckoff_accumulation",  // Which detection plugin to use
  "min_prominence": 0.2,                   // How obvious must the peak be
  "peak_lookback": 50,                     // How far back to look for the peak
  "min_markdown_pct": 0.7,                 // Minimum decline from peak (70%)
  "markdown_lookback": 300,                // Bars to search for the markdown low
  "base_resistance_closes": 3,             // Closes above resistance to confirm base end
  "markup_lookforward": 100,               // Bars to look for first breakout
  "markup_min_breakout_bars": 2,           // Bars that must hold above base
  "pullback_lookforward": 200,             // Bars to look for pullback
  "pullback_retracement_min": 0.3,         // Minimum pullback depth (30%)
  "pullback_retracement_max": 5.0,         // Maximum pullback depth
  "double_bottom_tolerance": 1.05,         // How close pullback low can be to base low
  "breakout_multiplier": 1.02,             // How far above resistance for breakout
  "score_min": 0                           // Minimum quality score to keep
}
```

**What it does:** Given the structural features extracted by Structure Config, this defines the specific pattern to detect. For Wyckoff Accumulation: Peak → Markdown → Base → Markup → Pullback → Breakout. Each phase has numeric thresholds that determine what counts.

**This IS the entry signal.** The pattern IS the entry. A Wyckoff accumulation second breakout is an entry signal. A 50/200 MA cross would be a different `pattern_type` with its own parameters.

**What you experiment with:**
- `min_markdown_pct`: How deep must the decline be? 50%? 70%? 90%?
- `pullback_retracement_min/max`: How deep should the pullback be?
- `breakout_multiplier`: How far above resistance counts as a breakout?
- `score_min`: Quality threshold — filter out weak candidates

**The `pattern_type` field is the plugin selector.** Today: `wyckoff_accumulation`. Tomorrow: `ma_crossover`, `rsi_divergence`, `quasimodo`, etc. Each plugin has its own parameters.

---

### 3. ENTRY CONFIG — "When exactly do we pull the trigger?"

**Category: SIGNAL (experimental, but simple)**

```json
{
  "trigger": "second_breakout",    // What event fires the entry
  "breakout_pct_above": 0.02,     // 2% above resistance level
  "confirmation_bars": 1          // Must hold for 1 bar
}
```

**What it does:** Once the pattern is detected (setup_config found a candidate), this defines the exact moment you enter. "Close above resistance by 2%, confirmed for 1 bar" = enter on the next open.

**This is the final piece of the signal.** Setup Config finds the pattern. Entry Config fires the trade.

**What you experiment with:**
- `trigger`: Different entry triggers for the same pattern (base breakout vs second breakout)
- `confirmation_bars`: 1 bar is aggressive. 3 bars is conservative.
- `breakout_pct_above`: Tighter = more entries. Looser = fewer but more confirmed.

---

### 4. RISK CONFIG — "Where is the stop?"

**Category: HYBRID — stop placement is signal-dependent, but position sizing is MATHEMATICAL**

```json
{
  "stop_type": "structural",     // How to determine stop placement
  "stop_level": "base_low",     // Which price anchor for the stop
  "stop_buffer_pct": 0.02       // 2% buffer below the anchor
}
```

**What it does:** Defines WHERE the stop goes. For a Wyckoff strategy, the stop goes below the base low (structural). For an MA crossover, it might go below the prior swing low. The stop placement depends on the pattern — it's part of the signal.

**What is NOT in this config but IS mathematical:**
- **Position sizing** = Account × Risk% ÷ Stop Distance
  - Account: $10,000
  - Risk: 3% = $300
  - Stop distance: $5 per share
  - Position: $300 ÷ $5 = 60 shares
  - This is MATH. Not discretionary. Not experimental.

- **Max risk per trade**: a global account setting (e.g., 1-3% typical, 10% absolute max)
  - This is a POLICY. Set once. Not part of the strategy.

**What you experiment with:**
- `stop_type`: Structural vs ATR-based vs fixed percentage
- `stop_level`: Below base low vs below pullback low
- `stop_buffer_pct`: How much room to give (tight = more stopped out, wide = more risk per share)

**What is fixed math:** Position size = risk budget ÷ stop distance. Period.

---

### 5. EXIT CONFIG — "Where do we get out?"

**Category: EXPERIMENTAL**

```json
{
  "target_type": "fibonacci",    // How to determine target
  "target_level": 0.25,         // Fibonacci 0.25 level (25% retrace of the prior move)
  "time_stop_bars": null,       // Max bars to hold (null = no time limit)
  "trailing": null              // Trailing stop config (null = no trailing)
}
```

**What it does:** Defines when to take profit. This is the most experimental part of a strategy. Different exit methods can dramatically change performance on the exact same entry signal.

**What you experiment with:**
- `target_type`: Fibonacci, ATR multiple, R-multiple, percentage, trailing
- `target_level`: For Fibonacci: 0.25 vs 0.382 vs 0.618 (where in the prior range)
- `time_stop_bars`: Hold for max N bars then exit (prevents dead positions)
- `trailing`: Move target as price advances

**This is where most of the backtesting experimentation happens.** Same entry, different exits = very different results.

---

### 6. COST CONFIG — "What does trading cost?"

**Category: BOILERPLATE (set once per broker/instrument)**

```json
{
  "commission_per_trade": 0,     // $0 for most brokers now
  "spread_pct": 0.001,          // 0.1% spread assumption
  "slippage_pct": 0.001         // 0.1% slippage assumption
}
```

**What it does:** The friction costs of trading. The backtester applies these to every simulated trade so the results are realistic. Without costs, everything looks profitable. With costs, many strategies die.

**Set once. Forget.** Unless you change brokers or trade different instruments. Futures have different costs than stocks. Options have different costs than futures.

---

### 7. EXECUTION CONFIG — "How do we protect ourselves?"

**Category: BOILERPLATE (set per instrument type, enforced by machine)**

```json
{
  "auto_breakeven_r": 1.0,
  "lock_in_r_ladder": [{"at_r": 2, "lock_r": 1}, {"at_r": 3, "lock_r": 2}],
  "green_to_red_protection": {"trigger_r": 1.5, "floor_r": 0.25, "action": "close_market"},
  "daily_profit_cap_usd": 500,
  "daily_profit_cap_action": "close_all_and_pause",
  "production_lock": true
}
```

**What it does:** Behavioral enforcement. Once a trade is open, these rules fire automatically:
- Move to breakeven at +1R
- Lock in profit at +2R, +3R, +4R (ladder)
- Never let a green trade go red
- Stop trading after $500 daily profit

**These are not discretionary.** They are machine-enforced rules that protect the trader from themselves. Set per instrument type (futures vs options), validated by the backtester, enforced live.

**For futures:** Breakeven, ladder, green-to-red protection, daily cap
**For options:** Scale-out rules, winner-never-to-red, time stop, profit retrace exit

---

### 8. UNIVERSE — "What do we scan?"

**Category: BOILERPLATE (set per strategy)**

```json
"universe": []        // Empty = scan everything. Or: ["AAPL", "MSFT", "GOOGL"]
```

**What it does:** The list of symbols to scan. Empty means "scan the whole market." A list means "only scan these symbols."

---

## Summary: What's Experimental vs Mathematical vs Boilerplate

| Section | Category | You experiment with it? | Notes |
|---------|----------|------------------------|-------|
| **structure_config** | SIGNAL | Yes — how to read the chart | Calibrate detection |
| **setup_config** | SIGNAL | Yes — what pattern to find | The entry signal |
| **entry_config** | SIGNAL | Yes — when to pull the trigger | Final piece of signal |
| **risk_config** | HYBRID | Stop placement = yes. Sizing = NO (math) | Stop is signal-dependent |
| **exit_config** | EXPERIMENTAL | Yes — biggest impact on results | Where most tuning happens |
| **cost_config** | BOILERPLATE | No — set once per broker | Friction costs |
| **execution_config** | BOILERPLATE | No — set per instrument type | Behavioral protection |
| **universe** | BOILERPLATE | No — set per strategy | What to scan |

## The New Strategy Flow

When you describe an idea to the AI:

1. **You describe the SIGNAL** — "I want to find stocks that have declined 70%+ and formed a base"
   → AI generates `structure_config` + `setup_config` + `entry_config`

2. **Risk is computed** — Stop goes below the structural anchor (base low, swing low, etc.)
   → AI generates `risk_config` (stop placement). Position sizing is math, done at trade time.

3. **Exit is the experiment** — "Target at the prior peak? Fibonacci? 3R?"
   → AI generates `exit_config`. This is where you iterate in backtesting.

4. **Everything else is boilerplate** — Costs from your broker. Execution rules from your instrument type. Universe from your watchlist.
   → AI fills in defaults. You rarely touch these.

## What This Means for the UI

The "New Strategy" form could be simplified:

- **BIG SECTION**: "Describe your entry signal" (what pattern, what triggers it)
- **MEDIUM SECTION**: "Define your exit" (target type, level, time stop)
- **SMALL SECTION**: "Stop placement" (structural, ATR, fixed — just the anchor)
- **AUTO-FILLED**: Position sizing (computed from account), costs (from broker), execution rules (from instrument type), universe (from settings)

The AI prompt "Describe your idea" is really asking: **"What is your entry signal?"** Everything else is either math or defaults.
