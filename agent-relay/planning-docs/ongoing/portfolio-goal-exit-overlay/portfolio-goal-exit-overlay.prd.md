# Portfolio Goal Exit Overlay PRD

Checklist: portfolio-goal-exit-overlay-checklist.md

Status: TODO
Owner: TBD
Created: 2026-06-02

## Summary

Build a portfolio-level equity goal overlay that can flatten, pause, or reduce risk once a running strategy reaches a defined account-growth target inside a defined time window.

This is not an individual trade take-profit rule. It is an account or portfolio management rule: "Once the strategy has made enough for this week/month/quarter, stop pressing and protect the result."

## Problem

Current backtests and sweeps mostly optimize strategy mechanics: entry filters, stop types, take-profit rules, holding periods, timeframes, and universe constraints. They do not model the trader's account-level goal behavior.

For speculative or volatile strategies, the main failure mode may not be finding winners. It may be giving back a strong portfolio gain after the account already met its target. A portfolio goal overlay tests whether stopping after a goal improves realized outcomes.

## User Story

As a trader testing a strategy, I want to define an account-growth target, such as +10% per week, so that the simulator can exit or pause the portfolio once the goal is reached and tell me whether that improves the tradability of the strategy.

## Core Concept

Example configuration:

- Goal target: +10%
- Goal window: weekly
- Trigger basis: account equity, including open P&L
- Action: flatten all positions
- Reset: next window

If the portfolio equity reaches +10% during the week, the overlay exits active positions and does not keep pushing for more upside during that same window.

## Product Boundaries

### In Scope

- Define portfolio-level goal target percent.
- Define time window: weekly, monthly, quarterly, custom bars or days.
- Define action on trigger:
  - Flatten all positions.
  - Stop new entries.
  - Reduce exposure.
- Define reset behavior:
  - Next window.
  - Cooldown period.
  - Manual reset in live execution contexts.
- Report portfolio-level performance before and after overlay.
- Track missed upside and protected drawdown.

### Out Of Scope For V1

- Brokerage automation.
- Live order routing.
- Tax optimization.
- Per-symbol discretionary overrides.
- Treating this as a Parameter Sweep primary control before true portfolio simulation exists.

## Required Data Model

The overlay requires a true portfolio simulation, not independent trade averages.

The simulator must track:

- Starting equity.
- Realized P&L.
- Unrealized P&L.
- Cash balance.
- Open positions.
- Position sizing.
- Portfolio equity by timestamp.
- Goal window boundaries.
- Goal trigger timestamp.
- Actions taken after trigger.

## UX Placement

Primary home: future Portfolio Simulator or Execution Overlay.

Secondary future use: once portfolio simulation is reliable, Parameter Sweep may test this overlay as a portfolio-level dimension.

Recommended UI section:

```text
Portfolio Goal Exit
Goal target %
Goal window
Trigger basis
Action
Reset behavior
```

## Metrics

The report should compare baseline strategy performance against overlay performance:

- CAGR.
- Total return.
- Max drawdown.
- Sharpe or equivalent risk-adjusted return.
- Goal-hit rate.
- Average time to goal.
- Number of flattened windows.
- Missed upside after goal exit.
- Drawdown avoided after goal exit.
- SPY comparison over the same windows.
- Trade count and opportunity loss.

## Design Principles

- The page should tell the user how to trade, not expose a bag of knobs.
- This overlay should be framed as an account discipline rule.
- The UI must clearly distinguish trade exits from portfolio exits.
- The tool must show both what was protected and what was sacrificed.
- Avoid overfitting by presenting robustness across several target/window combinations.

## Open Questions

- Should the default action be flatten all positions or stop new entries only?
- Should goal trigger use intraday equity, close-only equity, or rebalance-point equity?
- Should the overlay block new entries until the next window or allow re-entry after a cooldown?
- Should trailing portfolio drawdown after goal be modeled separately?
- Should goal exits be allowed for long-only baskets, long/short books, and options strategies equally?

## Acceptance Criteria

- A true portfolio simulation can apply a goal exit overlay without pretending independent trade averages are portfolio equity.
- Reports show baseline versus overlay side by side.
- The UI makes clear that this is a portfolio/account rule.
- The overlay can be disabled cleanly.
- Results include missed upside as well as drawdown avoided.
