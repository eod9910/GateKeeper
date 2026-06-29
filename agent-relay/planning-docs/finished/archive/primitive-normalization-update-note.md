Here’s the clean order.

## New Active Workstream — Primitive Normalization → Autonomous Strategy Research

Before the app can behave like a true autonomous strategy-design system, it needs a cleaner primitive language.

New active workstream:

1. build a **primitive normalization engine**
2. import a standard indicator core from external libraries instead of rewriting commodity indicators
3. normalize imported and custom primitives behind one canonical contract
4. expose that normalized primitive library to builders, validator, scanner, and research
5. rebuild `Research Studio` around autonomous strategy discovery over normalized primitives and approved state-machine templates

Source-of-truth plan:

- `ACTIVE/primitive-normalization-engine-and-autonomous-research.md`

You mentioned two different kinds of things:

1. **UI/workbench features**
2. **system layers / product evolution**

They are related, but they are not the same.

# First: the system layers, in order

This is the deepest order — the actual stack of what the app is becoming.

## 1. Research layer

This is where you are now.

Purpose:

* discover structural families
* validate them statistically
* compare across symbols
* measure t-scores, expectancy, dispersion
* **Symbolic Regression (SR):** discover scoring formulas for setups (from indicators, families, or strategies) so the system can rank/filter by quality instead of treating all detections equally

This layer answers:
**What recurring structures exist, and how do they behave?**
And: **Which instances (of a pattern, indicator, or strategy) score high vs low?** (SR)

---

## 2. Signal layer

This is the next operational layer.

Purpose:

* turn a family into a live/causal event
* emit a signal at the pivot-5 confirmation bar
* say: this family just happened now

This layer answers:
**When does the structure actually occur in real time?**

---

## 3. Strategy layer

This is where the signal becomes tradable.

Purpose:

* define entry
* define stop
* define target
* define time stop
* define skip rules

This layer answers:
**How exactly do I trade this signal?**

---

## 4. Portfolio layer

This comes after individual strategies work.

Purpose:

* position sizing
* max simultaneous trades
* family weighting
* symbol weighting
* risk caps
* correlation control

This layer answers:
**How do I trade multiple family strategies together without blowing up?**

That is the actual stack.

So the system order is:

```text
Research layer
→ Signal layer
→ Strategy layer
→ Portfolio layer
```

# Second: the UI/workbench features, in order

These are the practical features the app should add to support that stack.

## 1. Family ranking controls

This should come first.

Why:
Because right now the app can show families, but it does not yet aggressively answer:
**Which families matter most?**

You need sorting/filtering by things like:

* t-score
* occurrence count
* cross-symbol dispersion
* agreement status
* candidate status

This makes the research layer usable.

---

## 2. Visual motif inspection

This should come second.

Why:
Once a family ranks highly, you need to confirm:
**Do these examples actually look like the same structural thing?**

This protects you from statistical nonsense.

So after ranking says “look here,” visual inspection says “yes, this is real” or “no, this is a junk bucket.”

---

## 3. Baseline / null-model comparison panel

This should come third.

Why:
Once a family looks interesting and visually coherent, you need to ask:
**Better than what?**

This is where you compare the family against:

* random timestamps
* random motifs
* direction-only baseline
* simple structural baseline

This keeps the research honest.

---

## 4. Execution simulation panel

This should come fourth.

Why:
Only after a family is:

* ranked well
* visually coherent
* better than baselines

should you move to:
**How does this behave under actual trading rules?**

That panel closes the loop from research into strategy testing.

So the UI/workbench feature order should be:

```text
Family ranking controls
→ Visual motif inspection
→ Baseline / null-model comparison panel
→ Execution simulation panel
```

# Put both together into one master order

If I were sequencing the whole app, I would order it like this:

## Phase 1 — strengthen the research workstation

1. **Family ranking controls**
2. **Visual motif inspection**
3. **Baseline / null-model comparison panel**

Why first?
Because these all improve the **Research layer**, which is the foundation.

---

## Phase 2 — connect research to trading

4. **Signal layer**
5. **Execution simulation panel**
6. **Strategy layer**

Why here?
Because once you know which families are real, you convert them into executable setups.

---

## Phase 3 — scale it into a trading system

7. **Portfolio layer**

Why last?
Because portfolio logic only matters after individual strategies survive.

# The shortest practical answer

If you want the shortest version, the order is:

```text
1. Research layer
2. Family ranking controls
3. Visual motif inspection
4. Baseline / null-model comparison panel
5. Signal layer
6. Execution simulation panel
7. Strategy layer
8. Portfolio layer
```

# If you want the brutally practical priority list

If your question is really:
**What should I build next, then after that, then after that?**

Then this is the order I would actually recommend:

## Build next

1. **Family ranking controls**
2. **Baseline / null-model comparison panel**
3. **Visual motif inspection improvements**
4. **Symbolic Regression (SR) — Phase 1** (optional parallel track): formula discovery on Research page; first path = indicator + OHLCV. See `ACTIVE/SR Engine.md`.

## Then

5. **Signal layer integration into the backtester**
6. **Execution simulation panel**

## Then

7. **Formal strategy layer for top aligned families**

## Last

8. **Portfolio layer**

# Why visual inspection is not first in the practical list

Because you already have some inspection ability.

What you still lack more urgently is:

* a stronger way to rank families
* a way to compare them against baselines

Those two things help you know **what is worth inspecting**.

# Final answer

So, in order:

## System evolution

1. Research layer
2. Signal layer
3. Strategy layer
4. Portfolio layer

## UI/workbench features

1. Family ranking controls
2. Visual motif inspection
3. Baseline / null-model comparison panel
4. Execution simulation panel

## Real build priority

1. Family ranking controls
2. Baseline / null-model comparison panel
3. Better visual motif inspection
4. (Optional) Symbolic Regression Phase 1 — indicator + OHLCV formula discovery; Research page mode. See `ACTIVE/SR Engine.md`.
5. Signal layer into backtester
6. Execution simulation panel
7. Strategy layer
8. Portfolio layer

If you want, I can turn that into a **single phased roadmap prompt** for your coding agent.
