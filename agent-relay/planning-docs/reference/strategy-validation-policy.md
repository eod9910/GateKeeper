# Strategy Validation Policy

This document defines the validation, repair, certification, optimization, and tombstone rules for strategy progression in Pattern Detector.

## Core Principle

The system is designed to:

1. validate first
2. repair second
3. certify third
4. optimize last

It is not designed to sweep parameters early to make a strategy look good.

## Strategy Anatomy

A strategy wraps a primitive or composite signal in trade-management rules. The signal source may be stateful, but entry, exit, stop, take-profit, sizing, and cost assumptions belong to the strategy.

Scanner consumes primitives and composites. Validator consumes strategies only. Naked signal checks belong in Research Studio, not Validator.

See `agent-relay/planning-docs/reference/indicator/indicator-architecture.md` for the canonical Primitive -> Composite -> Strategy boundary.

A strategy has two main parts.

### Entry

Entry is broken into:

- Location
- Structure
- Entry Timing
- Regime Filter (optional)

Entry terms are defined as follows:

- Location
  - Where price is relative to the area of interest.
  - This answers: "Is price in the right place to consider the setup?"
  - Typical examples include retracement zones, support/resistance interaction, fib zones, base retests, and pullback depth.

- Structure
  - The tradable price formation itself.
  - This answers: "What pattern or swing geometry exists in price?"
  - Typical examples include impulse/pullback shape, swing sequences, RDP structure, higher-low sequences, bases, breakouts, and motif geometry.
  - Structure is not the same thing as regime or filter state.

- Entry Timing
  - The trigger that makes the setup actionable now instead of earlier or later.
  - This answers: "Why is this the right bar or moment to enter?"
  - Typical examples include confirmation bars, momentum/divergence triggers, break confirmations, reclaim candles, or threshold crosses.

- Regime Filter
  - An optional permission layer that allows or blocks an otherwise valid setup.
  - This answers: "Even if structure, location, and timing line up, is this trade allowed in the current market state?"
  - Typical examples include regime filters, volatility state filters, energy-state filters, or higher-level contextual vetoes.
  - Regime Filter is a permission filter, not the pattern itself.

### Exit

Exit is broken into:

- Stop Loss
- Take Profit

Only a limited subset of these parts may be adjusted during sweeps.

## Testing the Signal vs Testing the Strategy

The **primitive or composite** is the signal engine. It answers: "what state is this symbol in?" The **strategy** wraps that signal engine in entry/exit criteria, stops, take profits, sizing, costs, and validation settings. So: does the industry test the signal naked, or only with a strategy wrapped around it?

**They do both**, for different reasons.

### 1. Test the signal first — naked or minimally constrained

Serious quants and prop shops routinely evaluate **signal quality** without imposing their actual stop/target. They ask:

- When this signal fired, what was the **forward return** (e.g. 1-bar, 5-bar, N-bar)?
- What was **MFE/MAE** (max favorable / adverse excursion) after the signal?
- Did price hit **+1R before -1R** (or hit a target before a stop) in a fixed window?

That is signal validation in our terms: you are measuring **whether the signal has edge**. No execution rules yet. You are not confounding "bad signal" with "bad stop" or "bad target." This is what the research pipeline does for motifs: signal -> outcome, no stop/target. Same idea for any primitive or composite: run it over history, record the bar where it fired or the state it entered, then compute outcome stats for those bars. **Test the signal naked to see if it works.**

### 2. Test the full strategy (engine + exit) for tradability

Once the engine shows edge, they **wrap it in a strategy** (stop, take profit, sizing) and run a full backtest. That’s when you get expectancy, drawdown, capacity, and the metrics the validator uses. This answers: “Can we actually trade this? Does it survive realistic execution?” So they **do** always test with a strategy wrapped around the engine — but **after** (or alongside) checking that the engine itself has signal quality.

### How to use this in Pattern Detector

- **Signal-level validation:** Optional or first step. For a primitive, composite, or SR formula, compute signal-level metrics: when it fires, what is the distribution of forward return? MFE/MAE? Hit +1R before -1R? State-transition quality? No stop/target in this step; just "does this fire at useful times?" This belongs in Research or as a pre-check before a strategy is submitted to the validator.
- **Strategy-level (full) validation:** What the validator does today. Composite + stop + take profit → backtest → Tier 1 / 2 / 3. That’s the gate for “does this go live?”

So: **validate primitives/composites naked to see if the signal works; then wrap a strategy around the signal and validate the strategy.** The big boys separate "does the signal have edge?" from "does the full system with exits survive?" — and so can we.

**Current state in this app:** The validator **always** runs a primitive or composite as part of a strategy. We **never** run a primitive or composite naked in the validator today. Signal-only metrics live in Research or similar pipelines, not in the validator.

**Where should naked signal validation live?** Keep the validator for **strategies only**. Put naked primitive/composite validation in **Research Studio**. Research is already where we ask "does this idea work?" So: "Run this signal over history and show forward return / MFE/MAE / hit +1R before -1R" is a Research feature. You test the signal there; when it looks good, you wrap it in a strategy and send it to the **Validator** for strategy-level pass/fail. **Sweep** stays strategy-focused. If we ever add "sweep composite params and see signal-level metrics," that can be a Research-side option that uses the same naked-signal evaluation, not a second mode inside the Validator or existing Parameter Sweep UI.

**Research → Sweep contract:** Anything created in Research (primitives, composites, SR formulas, Research Agent strategies) must **expose its parameters** so that the Parameter Sweep can tune them. If Research produces something that can’t be parameterized and swept, it can’t be repaired or optimized through the existing pipeline. So: primitives and composites must declare tunable parameters (same contract as today’s pattern JSON); SR formulas that become primitives must expose any tunable inputs (e.g. score threshold, feature weights if applicable); Research Agent–generated strategies already flow through the registry with params. Sweep tunes what’s exposed; Research must expose it.

**Research module — viewing parameters:** In the Research page, when you open a generation’s detail drawer, a **“Parameters (for Sweep)”** section shows the parameters extracted from that generation’s strategy spec (composite stage params, risk_config, and top-level setup params) so you can see at a glance what the sweep can tune. Full strategy spec JSON remains below for reference.

## Tier Rules

### Tier 1: Existence

Purpose:

- Determine whether the raw strategy has any life at all.

Rules:

- Fixed spec
- Fixed parameters
- No sweep
- No tuning
- No rescue

Question:

- Does this idea show a real edge in untouched form?

Interpretation:

- A strategy that fails badly here should usually die.

### Tier 2: Repairability

Purpose:

- Determine whether a strategy that showed some life can be repaired enough to deserve stricter testing.

Rules:

- Tier 2 is not for maximizing return.
- Tier 2 is only for repair.
- Only review candidates are allowed into the sweep.
- Only a limited number of parameters may be adjusted.
- Parameters must be adjusted based on the specific failure mode.
- The sweep is bounded to 5 backtest attempts per parameter.
- Each adjustment must be followed by a new Tier 2 backtest.

Question:

- Is this strategy salvageable without changing its identity?

Interpretation:

- If yes, it can move on.
- If not, it gets tombstoned.

### Tier 3: Certification / Robustness

Purpose:

- Determine whether the repaired or inherited strategy is robust as-is.

Rules:

- No Tier 3 sweep
- No rescue
- No additional tuning
- It either passes or fails

Question:

- Does this version survive full validation without bargaining?

Interpretation:

- If it passes Tier 3, it is certified.
- If it fails Tier 3, it fails.

## Post-Certification Optimization

Only after a strategy passes Tier 3 may it be swept to improve returns.

Rules:

- This is not Tier 2 repair.
- This is post-certification optimization.
- The certified Tier 3 version must be frozen as the baseline.
- Any optimized version must be treated as a new branch.
- That optimized branch must be revalidated before promotion.

Question:

- Can return be improved without breaking robustness?

## Result Categories

### Pass

- Meets the required criteria for the current tier
- Can move forward

### Review

- Borderline, but may be salvageable
- Allowed into the bounded repair sweep

### Hard Fail

- Fundamentally broken
- Not worth repair
- Goes straight to tombstone

### Tombstone

- Not active
- Failed bounded salvage or failed hard
- Preserved for lineage and future reuse
- Not considered live-worthy

Tombstoning means:

- the strategy is not deleted
- the strategy is not retried forever
- the strategy DNA is preserved, but it is removed from the active pipeline

## Sweep Rules

Sweep is allowed only under controlled conditions.

### Sweep Is Allowed For

- Tier 2 repair of review candidates
- Post-Tier 3 return optimization

### Sweep Is Not Allowed For

- Tier 1 existence testing
- Tier 3 certification

### Sweep Must Be Bounded By

- limited parameters
- limited attempts
- failure-specific targeting
- identity preservation

The sweep is not there to produce pretty backtests.

## Identity Rule

A strategy may be adjusted only in ways that keep it the same strategy.

Allowed adjustments are tuning changes to the existing mechanism.

Not allowed:

- changing the strategy core logic so much that it becomes a new strategy while pretending it is the old one

If a change breaks identity, it must be treated as a new branch, not a repair.

## Philosophy

The system is supposed to kill a lot of strategies.

That is intentional.

Why:

- most strategies are fragile
- many good-looking backtests are curve-fit trash
- many strategies fail once forced through OOS, walk-forward, sensitivity, and Monte Carlo stress

So the pipeline is supposed to:

- reject weak ideas
- rescue only borderline repairable ones
- certify only robust survivors
- optimize only after certification

## One-Line Summary

Tier 1 tests whether a strategy has life. Tier 2 tests whether it is repairable. Tier 3 tests whether it is robust without rescue. Only after Tier 3 pass do you optimize for return. Anything that cannot survive bounded repair gets tombstoned.
