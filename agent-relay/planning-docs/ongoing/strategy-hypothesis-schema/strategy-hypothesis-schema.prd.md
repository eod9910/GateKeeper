# Strategy Hypothesis Specification

## Purpose

This document defines the **formal declarative format** for trading strategies.

A strategy is not code.
A strategy is a **testable hypothesis**.

Strategies are authored in structured form so they can be:
- versioned
- audited
- validated
- interpreted by AI
- enforced by engines

---

## Lifecycle States

- draft
- testing
- approved
- rejected

Once frozen, a strategy cannot be edited.
All changes create a new version.

---

## Strategy Schema (Conceptual)

Each strategy defines:

### Identity
- strategy_id
- version
- status

### Universe
- symbols
- liquidity filters

### Timeframes
- primary
- confirmation

### Market State Filters
- trend
- range
- volatility
- structural conditions

### Entry Rules
- rule definitions
- parameters

### Exit Rules
- stop logic
- profit logic

### Risk Model
- risk per trade
- concurrency limits
- volatility adjustments

### Cost Model
- commissions
- slippage assumptions

### Metadata
- author (AI or human)
- creation timestamp
- notes

---

## Design Invariants

- No implicit logic
- No discretionary language
- No performance claims
- All rules must be machine-evaluable

---

## AI Usage

AI may:
- author strategy JSON
- refactor hypotheses
- suggest alternatives

AI may not:
- declare edge
- auto-approve
- bypass validation

The schema is the contract.
Everything else is commentary.
