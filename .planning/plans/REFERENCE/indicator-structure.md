The maximum-three rule: the only 3 questions you ever need inside an entry composite

If you cap entry composites at three primitives, the clean set is:

Anchor / Structure

Location

Timing Trigger

That’s it. Those three cover nearly every sane entry system.

Now map your example to that exactly.

Your example, translated into the new paradigm
Primitive 1 — Structure (RDP pivots)

Question it answers:
“What are the current meaningful swing anchors?” (where is the swing low, where is the swing high)

Output: anchors only (swing_low, swing_high)

This is not “entry.” This is the reference frame.


Primitive 2 — Location (Fib pullback)

Question it answers:
“Is price in the entry location we require?” (is retracement between 50–79%, specifically ~70%)

Input: swing_low & swing_high anchors
Output: passed + retracement_pct

This is not “entry.” This is permission inside the setup.

Primitive 3 — Timing (RSI crosses above 30)

Question it answers:
“Did the trigger happen now?” (RSI cross 30 is the timing event)

Output: passed (true/false) + maybe trigger bar index

This is the only part that is actually “NOW.”

Composite reducer — Decision

Decision rule:
structure.passed AND location.passed AND trigger.passed => ENTER_NOW

Strategy sees one boolean.

What you were calling “an indicator” before

Before, you were calling the whole pipeline an “indicator.”

In the new paradigm, you call it:

Entry Composite: “Pullback-to-70 then RSI-30 trigger”

And internally it’s just:

anchors → location filter → trigger → verdict

That’s clean.

A. Global rules the AI must obey (hard constraints)
1) Atomic primitive rule

One plugin = one question = one intent

No plugin imports any other plugin

Output must be a NodeResult with: passed, score, features, anchors, reason

2) Composite rule

Composite is spec-driven JSON, not merged Python

Composite may chain primitives and must emit one verdict only:

entry_go for entry composites

exit_go for exit composites

regime_label for regime composites

analysis_payload for analysis composites

3) Intent enforcement

Entry composite can only use nodes with intent="entry" (and optionally intent="structure" if you allow that subtype)

Exit composite only exit nodes

Risk nodes never live inside entry nodes unless you explicitly allow a pre-trade risk gate

4) Debug trace always on

Every composite run returns a per-node trace so you can see exactly why it failed.

B. The “structure / location / timing” template (applies to ENTRY composites)

For anything that ends with ENTER_NOW, the AI must build it as:

Stage 1 — Structure (anchors)

Question: “What are the anchors / reference points?”
Examples: RDP pivots, swing low/high, range boundaries

Stage 2 — Location (where price is relative to anchors)

Question: “Is price in the required zone?”
Examples: Fib 50–79%, discount zone, inside range, near support

Stage 3 — Timing (the now-trigger)

Question: “Did the trigger happen now?”
Examples: RSI cross, MA cross, breakout close, reclaim, pattern trigger

Reducer — Verdict

structure.passed AND location.passed AND timing.passed => entry_go

That is the entry paradigm. It absolutely applies to your Wyckoff entry.

C. How this maps to your Wyckoff rebuild specifically
ENTRY composite (uses structure/location/timing)

Structure: pivots/swing structure (RDP/major pivots)

Location: where are we in the Wyckoff sequence right now (pullback zone, retest zone, spring zone) OR Fib zone if that’s your chosen location filter

Timing: breakout/reclaim/RSI cross/etc.

Output: entry_go only.

ANALYSIS composite (does NOT need timing)

Wyckoff detection itself is mostly:

structure + interpretation + rules + scoring
It produces phase, not entries.

Output: phase_label, confidence, anchors, rule_checklist, score, annotations_payload

D. The exact “parameters” you should hand the coding AI (copy/paste)

Use this as your governing spec:

If building an ENTRY indicator, it must be a 3-stage composite:

Structure node → Location node → Timing node → AND reducer → entry_go

Each node must be an atomic plugin (one question only) with NodeResult output.

Composites are JSON specs referencing plugins by pattern_id; no importing other plugin code.

Any Wyckoff phase logic belongs in analysis/regime primitives, not in timing.

Annotations and candidate packaging are utilities, never part of a trading decision.

Return full trace of node results every run.

The core correction (this is the key)

Indicators answer “WHEN / WHERE”.
Patterns answer “WHAT IS THIS?”

They are not interchangeable.

Proper definitions (non-negotiable)
Indicator

An indicator is a decision primitive.

It answers one operational question:

Anchor / Structure: “What are my reference points?”

Location: “Is price in the required zone?”

Timing: “Did the trigger happen now?”

Indicators are:

numeric

immediate

stateless (or minimally stateful)

composable (Legos)

Indicators never interpret meaning. They measure conditions.

Pattern

A pattern is a classifier.

It answers a semantic question:

“Is this Wyckoff accumulation?”

“Is this Wyckoff distribution?”

“Is this a Quasimodo?”

“Is this a volatility squeeze?”

“Is this a base → breakout sequence?”

Patterns:

interpret structure over time

label state or sequence

produce context, not entries

are slow, structural, semantic

Patterns do not fire trades.

What Wyckoff actually is

Wyckoff is not an indicator.

Wyckoff is:

a pattern framework

a market-state classifier

a phase interpreter

It answers:

“What kind of market behavior is unfolding?”

It does not answer:

enter now

exit now

size this trade

That was the conceptual mix-up.

Correct system separation (this fixes everything)
Layer 1 — Indicators (mechanical)

Purpose: measure

Structure primitives → pivots, ranges, anchors

Location primitives → fib zones, discount zones

Timing primitives → RSI cross, MA cross, breakouts

These are Lego bricks.

Layer 2 — Patterns (semantic classifiers)

Purpose: interpret

Patterns consume:

structure outputs

sometimes location context

historical sequencing

Patterns output:

labels (accumulation, distribution, phase B, phase C…)

confidence

key structural anchors

Patterns do not decide trades.

Layer 3 — Strategy (permission + action)

Purpose: decide

Strategy logic:

“If pattern == accumulation”

“AND location == valid”

“AND timing trigger fires”
→ ENTER

So patterns gate indicators.
Indicators execute within pattern permission.

Re-express your Wyckoff example correctly

What you were doing conceptually (but not architecturally):

Structure indicator
Finds swing highs/lows (RDP)

Pattern classifier (Wyckoff)
Uses structure over time to say:

“This is accumulation”

“This is phase C”

“This is distribution”

Location indicator
“Are we in the spring / pullback / discount zone?”

Timing indicator
“Did RSI cross / breakout / reclaim happen now?”

Strategy reducer
If all allowed → ENTER

That is the correct flow.

Why you felt confused before

Because you were asking:

“Is Wyckoff structure / location / timing?”

Answer:

Wyckoff is structure + sequence interpretation

It uses structure

It defines allowed locations

It does not do timing

So trying to shoehorn Wyckoff into the “indicator = structure/location/timing” template was the mismatch.

Final mental model (lock this in)
Indicators = physics

price

distance

thresholds

events

Patterns = semantics

meaning

state

sequence

context

Strategy = authority

permission

execution

risk

One sentence that will keep you from ever mixing this up again

Indicators measure conditions.
Patterns interpret structure.
Strategies decide action.

# Indicator & Pattern Architecture Constitution

## Purpose

This document defines the **non-negotiable design philosophy and architectural rules**
for how **indicators**, **patterns**, and **strategies** are created and combined in this system.

Its purpose is to:
- Prevent monolithic indicators
- Enforce composability
- Preserve explainability and statistical validity
- Ensure the AI acts as an **architect and governor**, not a monolith generator

If any implementation violates this document, it is considered **incorrect by definition**.

---

## Core Philosophy

Markets operate in **states**.
Trading is the act of responding correctly **within the current state**.

This system separates concerns into three layers:

1. **Indicators** → measure objective conditions
2. **Patterns** → classify market structure/state
3. **Strategies** → decide action and risk

These layers must never be collapsed into one.

---

## Definitions

### Primitive Indicator

A **Primitive** is the smallest unit of logic in the system.

**A primitive answers exactly one question.**

Examples:
- Where are the swing highs/lows?
- Is price in discount?
- Did a timing event occur now?

#### Properties
- One job only
- One intent only
- Deterministic
- Reusable
- Stateless or minimally stateful

#### Allowed Intents
- `STRUCTURE`
- `LOCATION`
- `TRIGGER`

#### Forbidden
- No pattern interpretation
- No trade decisions
- No position sizing
- No importing other plugins

---

### Pattern

A **Pattern** is a **classifier**, not an indicator.

Patterns answer:
> “What kind of market structure is this?”

Examples:
- Wyckoff Accumulation
- Wyckoff Distribution
- Volatility Compression
- Reversal vs Continuation

#### Properties
- Consumes structure primitives
- Interprets structure over time
- Outputs semantic labels and confidence
- Grants or denies permission for indicators to act

#### Forbidden
- No entry/exit signals
- No timing logic
- No trade execution

Patterns never say **“enter now.”**

---

### Composite Indicator

A **Composite** is an orchestration layer.

It combines primitives (and optionally patterns) to answer **one strategy-facing question**.

Examples:
- “Is there a valid long entry now?”
- “Is there a valid exit now?”

#### Properties
- Declares exactly one intent (ENTRY or EXIT)
- Spec-driven (JSON/YAML), not hardcoded logic
- Produces exactly one verdict: `GO` or `NO_GO`
- Contains no detection logic

---

### Strategy

A **Strategy** consumes composites.

It is responsible for:
- Position sizing
- Risk limits
- Stops
- Portfolio constraints

Strategies never interpret raw price data.

---

## The Canonical Flow

The correct execution order is:

# Indicator Studio Design Rules (User-Facing) + AI Gatekeeper Enforcement

## Purpose

This document is what you can hand to any user of the app.

It defines:
- The only allowed way to design indicators in Indicator Studio
- What the AI will accept
- What the AI will refuse
- The exact workflow the user must follow

If a user attempts a different approach, the AI will **stop the build** and force decomposition.

---

## What You Are Allowed to Build

You may build only these object types:

1) **Primitive Indicator**
2) **Pattern Classifier**
3) **Composite Indicator**
4) **Strategy** (outside Indicator Studio)

You may NOT build a monolith that mixes these types.

---

## The Only Allowed Workflow

### Step 1 — Choose what you are building
You must select one:
- Primitive: STRUCTURE / LOCATION / TRIGGER
- Pattern: CLASSIFIER
- Composite: ENTRY / EXIT

If you do not choose one, the AI will ask you to choose.

---

### Step 2 — Define the single question it answers

#### Primitive questions (pick one)
- STRUCTURE: “What are the anchors?”
- LOCATION: “Is price in the zone?”
- TRIGGER: “Did the event happen now?”

#### Pattern questions
- CLASSIFIER: “What is this structure?” (Wyckoff accumulation/distribution/etc.)

#### Composite questions
- ENTRY: “Is there a valid entry now?”
- EXIT: “Is there a valid exit now?”

If your design answers more than one question, the AI will split it.

---

### Step 3 — Build using the required template

#### ENTRY Composite Template (mandatory)
An entry composite must contain exactly:
1) **1 Structure primitive**
2) **1 Location primitive**
3) **1 Trigger primitive**
4) **1 Reducer** (AND/OR/N-of-M)

Optional: A Pattern gate may be applied **outside** the composite as permission.

Final output is always one boolean verdict:
- `entry_go = true/false`

#### EXIT Composite Template (mandatory)
Same idea:
- Structure (optional)
- Location
- Trigger
- Reducer
- Output: `exit_go = true/false`

---

## The AI Gatekeeper Rules (What the AI Will Enforce)

### The AI will stop you if you try to:
- Put multiple intents in one primitive
- Put a pattern inside an indicator
- Put a trigger inside a pattern
- Put trade logic, sizing, stops, or exits inside an indicator
- Write a composite as a monolithic code file
- Import one plugin file from another plugin file

### What happens when the AI stops you
The AI will respond with:

1) **Violation detected** (what rule you broke)
2) **Correct decomposition** (the primitives/patterns needed)
3) **What it will build instead**
   - primitives (if missing)
   - composite spec (JSON)
   - tests / trace output

The AI will not proceed until the design matches the architecture.

---

## Examples (How the AI Will Reframe User Ideas)

### Example A — User asks for a monolith
User: “Build an indicator that finds Wyckoff accumulation in discount and enters on RSI 30.”

AI Response:
- This is not one indicator.
- It decomposes into:
  1) STRUCTURE primitive: pivots/anchors
  2) PATTERN classifier: Wyckoff accumulation detection
  3) LOCATION primitive: discount via Fib
  4) TRIGGER primitive: RSI cross 30
  5) ENTRY composite: AND reducer → entry_go

---

### Example B — Pure numeric entry (no pattern)
User: “Enter on Fib 70% pullback and RSI cross 30.”

AI Response:
- This is a valid ENTRY composite:
  1) STRUCTURE primitive: pivots
  2) LOCATION primitive: fib 50–79 (target 70)
  3) TRIGGER primitive: RSI cross 30
  Reducer: AND → entry_go

No pattern needed.

---

## What the User Must Understand (Final)

- Patterns classify meaning.
- Indicators detect conditions and events.
- Composites reduce primitives to one verdict.
- Strategies control risk and execution.

If your design does not fit inside:
- STRUCTURE → LOCATION → TRIGGER → VERDICT

…the AI will force it to be redesigned until it does.

---

## The Promise of This System

This architecture guarantees:
- modular building blocks
- swap-in / swap-out components
- explainable traces
- cleaner testing and backtesting
- prevention of monolith-driven chaos

The AI is a guardrail, not a shortcut.
