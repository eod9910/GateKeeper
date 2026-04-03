# Scalping Strategy Capability Inventory

**Status:** ACTIVE  
**Created:** 2026-03-20  
**Purpose:** Inventory what the app already has, what can be approximated, and what still needs to be built to backtest a codified version of the gap + SMA + breakout/pullback scalping workflow discussed in `memory-bank/transcripts/ChatGPT-Scalping Strategy Breakdown.md`.

---

## Strategy Shape Being Evaluated

The target workflow is roughly:

- premarket or opening-session **gap context**
- daily-chart **bias**
  - gap up ending a downtrend / clearing resistance
  - gap down ending an uptrend / breaking support
- low-timeframe **execution**
  - opening range breakout
  - base breakout
  - pullback into rising `20 SMA`
- `200 SMA` used as context / support-resistance / possible target reference
- fast risk management, tight stops, and quick exits

---

## Summary

| Area | Status | Notes |
|---|---|---|
| Intraday backtesting infrastructure | **Exists** | Validator and chart stack support intraday intervals, so the engine can backtest low-timeframe rule-based strategies. |
| Simple moving average concepts | **Partial** | MA crossover and MA-based base detection exist, but there is not yet a clean general-purpose “price vs MA / pullback to MA / distance from MA / slope of MA” primitive. |
| Base breakout / pullback style entries | **Exists / Partial** | Several base, breakout, and pullback-related primitives/composites already exist. |
| Gap detection | **Missing** | No dedicated session gap primitive yet. Existing FVG primitive is not the same thing. |
| Opening range breakout | **Missing** | No explicit ORB/high-low primitive found yet. |
| Premarket scanner / unusual premarket volume | **Missing** | No first-class primitive for premarket gap + volume qualification. |
| Daily bias from “gap ends trend / clears resistance” | **Partial** | Can be approximated using existing structural/regime/context primitives, but not currently expressed as one clean primitive. |
| Fast discretionary management | **Missing for exact replication** | Can be approximated with fixed stops, targets, time stops, and portfolio rules, but not fully replicated as spoken in the transcript. |

---

## What Already Exists

### 1. Intraday support in the engine

This is the key enabling layer. The app is not limited to daily/weekly only.

Already present:

- validator pipeline has intraday handling
- chart/validator trade browser support intraday intervals like `5m` and `15m`
- platform SDK and multiple plugins detect and format intraday data

Interpretation:

- a rule-based low-timeframe strategy is backtestable in principle
- we do **not** need a new validator architecture just to test a scalping strategy

---

### 2. Moving-average related building blocks

#### Existing: `ma_crossover`

Useful for:

- MA relationship logic
- `50/200`, `9/21`, or other fast/slow cross logic
- basic trend-following constructs

Limitation:

- not the same as “price pulled back into the rising 20 SMA”
- crossover is too narrow for the transcript’s style

#### Existing: `ma_base_detector_primitive`

Useful for:

- detecting consolidation around a moving average
- representing “base near MA” type context
- configurable `SMA` / `EMA`

Limitation:

- designed as a base/location primitive
- not a direct “20 SMA pullback trend scalp” entry primitive

#### Existing: `ma_base_detector_indicator`

Useful for:

- visual analysis and chart inspection
- confirming whether price is respecting a chosen MA band

Limitation:

- indicator/analysis use is helpful, but we still need clean entry semantics for validator use

---

### 3. Base / breakout / pullback-related patterns

#### Existing: `base_breakout`

Useful for:

- breakout after base formation
- pullback toward base ceiling

#### Existing: `base_breakout_entry_composite`

Useful for:

- codified base detection + breakout/retest entry

#### Existing related family:

- `rdp_fib_pullback_entry_composite`
- `rdp_fib_pullback_rsi_entry_composite`
- `pullback_uptrend_entry_composite`

Interpretation:

- the app already understands “breakout” and “pullback” ideas
- that means this scalping system is **closer to expressible than it first appears**

Limitation:

- the existing patterns are not specifically “opening range breakout after gap” or “20 SMA micro pullback scalp”
- they are more swing-structure oriented than session-open scalp oriented

---

### 4. Structural / trend context pieces

Existing context-like building blocks include:

- `regime_filter`
- `structural_family_signal`
- base/box/breakout detectors

Interpretation:

- the app can already encode directional context and structural bias
- but not yet in the exact vocabulary of “this gap just ended a downtrend and cleared resistance”

---

## What Can Be Approximated Right Now

These are not perfect matches, but they are close enough to prototype a first-pass backtest.

### Approximation A: Trend pullback version

Possible with current system:

- use MA-related logic for trend context
- use existing pullback/base/breakout primitives for entries
- use simple fixed stop/target/time stop

This would test:

- trend continuation after strength
- pullback/retest entries

It would **not** fully test:

- overnight gap quality as the catalyst

### Approximation B: Breakout version without a gap primitive

Possible with current system:

- pick already-moving symbols externally
- run breakout/base-entry logic on intraday timeframe

This would test:

- whether the entry mechanics have value

It would **not** fully test:

- the gap-based premarket selection edge

### Approximation C: Daily bias + intraday execution hybrid

Possible in principle:

- use an existing trend/context layer to proxy daily bias
- use breakout or pullback entry on `5m`

This is the closest current approximation to the transcript without adding new primitives.

---

## What Is Missing

### 1. `gap_primitive`

This is the highest-priority missing piece.

Needed behavior:

- detect `gap up` / `gap down`
- compare current session open to previous close and optionally previous high/low
- emit:
  - `gap_direction`
  - `gap_pct`
  - `clears_prev_high`
  - `breaks_prev_low`
  - optional volume confirmation
- only evaluate once per session / first regular-session bar

Why it matters:

- the transcript’s edge claim is not “SMA alone”
- it is more like: **gap catalyst + clean execution**

Without a real gap primitive, we are only approximating the strategy.

---

### 2. Opening range breakout primitive

Needed behavior:

- define an opening range based on first `1m`, `2m`, or `5m` bar(s)
- support:
  - breakout above opening range high
  - breakdown below opening range low
  - optional breakdown-failure / bounce-failure variants

Useful outputs:

- `range_high`
- `range_low`
- `breakout_direction`
- `entry_ready`

Why it matters:

- this is one of the main entry patterns described in the transcript

---

### 3. General-purpose moving-average context primitive

Even though MA-based patterns exist, a cleaner dedicated primitive would be valuable.

Needed behavior:

- price above/below MA
- MA slope up/down
- pullback into MA
- distance from MA
- extension away from MA
- configurable `SMA` / `EMA`
- configurable period like `20` or `200`

Why it matters:

- the transcript’s execution logic is framed around the `20 SMA`
- the `200 SMA` is used as support/resistance context
- current MA pieces are helpful but not cleanly focused on this use case

---

### 4. Gap-quality / bias primitive

This may be separate from the raw gap primitive or a second-stage primitive built on top of it.

Needed behavior:

- gap ends prior downtrend / uptrend
- gap clears resistance / breaks support
- gap shocks trapped participants

Deterministic approximations:

- gap up above prior close and prior high
- recent structure was bearish before the gap
- gap down below prior close and prior low
- recent structure was bullish before the gap

Why it matters:

- this is the actual “bias” layer from the transcript

---

### 5. Premarket volume / unusual activity primitive

Needed behavior:

- detect unusual premarket or session-opening volume
- compare against recent baseline

Why it matters:

- the workflow explicitly prefers names with momentum and significant volume
- without this, many false-positive gaps will be low-quality

---

## Exact Replication Gaps

These are the discretionary parts that are unlikely to map perfectly 1:1:

- “I jumped in early because the move lower failed”
- “this looked sloppy / too extended / too crazy”
- ultra-fast manual partials
- trader discretion around whether the setup “felt too late”

These can still be approximated with:

- fixed stop/target rules
- time stops
- break-even rules
- trailing logic

But they will not exactly reproduce the spoken discretionary workflow.

---

## Recommended Build Order

If the goal is “make this backtestable with the least wasted work,” the order should be:

1. **`gap_primitive`**
   Gives us the catalyst layer.

2. **opening range breakout primitive**
   Gives us the cleanest first executable entry style.

3. **general-purpose moving-average context primitive**
   Gives us `20 SMA` pullback/extension logic and `200 SMA` context.

4. **gap-quality / bias primitive**
   Refines which gaps are worth trading.

5. **premarket volume primitive**
   Makes the selection process closer to the transcript.

---

## First Practical Backtest Candidate

The best first codified version is probably:

**gap + daily bias + 5m opening range breakout**

Why this first:

- easiest to define clearly
- least discretionary
- closest to the transcript’s repeated examples
- avoids overcomplicating the first prototype

Second candidate after that:

**gap + rising 20 SMA + pullback entry**

---

## Bottom Line

The app is already capable of backtesting a **formalized approximation** of this scalping framework.

What already exists:

- intraday support
- breakout/base/pullback building blocks
- MA-related pieces
- risk/validator infrastructure

What still needs to be built for a cleaner and more faithful test:

- a real `gap_primitive`
- an opening range breakout primitive
- a general-purpose MA context primitive
- better bias/volume qualification primitives
