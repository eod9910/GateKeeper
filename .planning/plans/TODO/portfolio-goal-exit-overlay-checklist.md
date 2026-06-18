# Portfolio Goal Exit Overlay Checklist

Percent complete: 0% (0 complete, 0 partial, 38 remaining)
PRD: portfolio-goal-exit-overlay-prd.md

Status: TODO
Owner: TBD
Created: 2026-06-02

## Planning

- [ ] Confirm the overlay belongs to Portfolio Simulator / Execution Overlay before adding it to Parameter Sweep.
- [ ] Decide v1 action set: flatten all, stop new entries, reduce exposure.
- [ ] Decide v1 windows: weekly, monthly, quarterly.
- [ ] Decide trigger basis: close-only equity vs intraday/current equity.
- [ ] Define reset behavior for each window.

## Portfolio Simulation Prerequisites

- [ ] Track starting equity.
- [ ] Track cash, open positions, realized P&L, and unrealized P&L.
- [ ] Track portfolio equity by timestamp.
- [ ] Support position sizing compatible with the target strategy type.
- [ ] Mark goal window boundaries.
- [ ] Mark goal trigger timestamp and action taken.

## Overlay Logic

- [ ] Add goal target percent.
- [ ] Add goal window selection.
- [ ] Add action on trigger.
- [ ] Add reset behavior.
- [ ] Prevent repeated triggers inside the same locked window.
- [ ] Support disabled/off mode.

## Reporting

- [ ] Compare baseline portfolio vs goal-overlay portfolio.
- [ ] Report total return and CAGR.
- [ ] Report max drawdown.
- [ ] Report goal-hit rate.
- [ ] Report average time to goal.
- [ ] Report number of flattened or paused windows.
- [ ] Report missed upside after goal trigger.
- [ ] Report drawdown avoided after goal trigger.
- [ ] Report SPY comparison over equivalent windows.

## UX

- [ ] Create a Portfolio Goal Exit section.
- [ ] Label it as a portfolio/account rule, not a trade exit.
- [ ] Explain target, window, action, and reset in plain trading language.
- [ ] Keep the control order top-to-bottom: target, window, trigger basis, action, reset.
- [ ] Show disabled/off as the default until portfolio simulation is valid.

## Validation

- [ ] Test with a synthetic portfolio where the goal trigger is obvious.
- [ ] Test that the overlay does not trigger before the goal is reached.
- [ ] Test that flatten-all closes all open positions.
- [ ] Test that stop-new-entries leaves existing positions alone.
- [ ] Test that reset allows the next window to trade again.
- [ ] Compare a volatile strategy to ensure missed upside is visible.
- [ ] Compare a drawdown-prone strategy to ensure protected drawdown is visible.
