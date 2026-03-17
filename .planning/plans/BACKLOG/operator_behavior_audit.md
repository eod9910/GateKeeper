# Operator Behavior Audit & Reliability System

## Purpose

This system exists to objectively distinguish **strategy performance** from **operator behavior**, and to correct the latter without corrupting the former.

Trading outcomes fail for exactly two reasons:
1. The strategy behaved as expected but lost (model variance).
2. The operator deviated from the strategy (process failure).

This system formalizes that distinction and enforces learning through structure, not emotion.

---

## Core Principle

The trader is a **component** of the trading system.

Like any component, the trader must be:
- observable
- auditable
- measurable
- subject to risk throttling when reliability degrades

Psychology is not treated as emotion.
It is treated as **execution reliability**.

---

## Mandatory Post-Trade Fork

Every trade must pass through the same fork:

### Question:
**Was this trade executed exactly according to the approved strategy and risk policy?**

This is a binary check.

- YES → Strategy Outcome
- NO → Operator Deviation

There is no third category.

---

## Branch A: Strategy Outcome Analysis

If the trade followed all rules:

The loss or gain is attributed to **model variance**.

AI responsibilities:
- Compare outcome to expected distribution
- Determine if result is statistically normal
- Detect clustering or expectancy degradation
- Recommend revalidation if thresholds are breached

No behavioral correction occurs here.

The operator did their job.

---

## Branch B: Operator Deviation Analysis

If any rule was violated:

The AI becomes a **Behavioral Debugger**.

The goal is **fault isolation**, not judgment.

Each deviation is classified, stored, and analyzed for recurrence.

---

## Deviation Classification

Deviations are tagged using a structured schema:
- type of deviation
- severity
- self-reported cause
- contextual notes

Single mistakes matter less than **patterns**.

Repeated small deviations are more dangerous than rare large ones.

---

## Behavioral Pattern Detection

The system continuously analyzes:
- deviation frequency
- deviation clustering
- deviation type correlation with drawdowns
- deviation correlation with PnL

This produces an **Operator Reliability Score (ORS)**.

---

## Operator Reliability Score (ORS)

ORS represents execution discipline over time.

- Starts at 1.0
- Decreases with repeated or severe deviations
- Recovers slowly with sustained compliance

ORS is not moral.
It is mechanical.

---

## Risk Adjustment Based on ORS

Behavior affects capital exposure automatically.

Example policy:
- ORS ≥ 0.90 → full risk
- ORS 0.75–0.89 → risk reduced 20%
- ORS 0.60–0.74 → risk reduced 40%
- ORS < 0.60 → execution pause or confirmation gate

This mirrors drawdown-based de-leveraging.

---

## AI Postmortem Conversation Rules

AI conversations are structured.

For strategy outcomes:
- Is this outcome statistically expected?
- Is revalidation required?

For operator deviations:
- Which rule was violated?
- Has this occurred before?
- Under what conditions does it recur?
- What system change could prevent recurrence?

The AI never assigns blame.
It assigns cause.

---

## Invariants

- Strategy rules are never edited post-hoc.
- Operator behavior is corrected via system constraints, not willpower.
- AI explains facts; it does not decide outcomes.
- Discipline and edge are treated symmetrically.

---

## Outcome

This system converts:
- psychology into data
- mistakes into structure
- self-awareness into infrastructure

It closes the loop between intent, execution, and outcome.

This is how discretionary failure is eliminated without eliminating human judgment.
