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
