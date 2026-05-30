# Special Situation Valuation

## Purpose

Value companies where a hard event dominates ordinary standalone valuation.

Use this skill for bankruptcy, restructuring, post-reorg equity, signed mergers, go-private transactions, CVRs, liquidation, spin-offs, major financing events, restatements, listing risk, or legal/regulatory events that change the investment frame.

This skill should normally be entered through the valuation dispatcher tool, currently exposed as `run_dcf_valuation` for compatibility.

## Runtime Contract

- Runtime tool: `run_dcf_valuation`
- Backend engine: `special_situation_valuation_engine`
- Valuation method:
  - `special_situation_post_reorg_scenario` for bankruptcy, restructuring, and post-reorg cases
  - `special_situation_deal_value` for signed cash deals, go-private transactions, and CVR situations
- Valuation engine class: `special_situation`

What this means:

- the workspace defines the event-driven doctrine and model-selection rules
- the backend performs scenario math, deal spread math, and equity-waterfall math
- Ledger explains the result as a special situation, not as a normal DCF

## When To Use

Use this skill when filing evidence or current context shows:

- Chapter 11, bankruptcy emergence, restructuring support agreement, going-concern language, covenant default, forbearance, missed interest, or debt exchange
- signed merger, acquisition, go-private agreement, cash consideration, CVR, or expected close language
- liquidation, spin-off, recapitalization, major financing, or material dilution event
- delisting, restatement, auditor-integrity, legal, or regulatory hard flag that can dominate normal valuation

## Core Principle

Hard events are regime switches.

Do not force a DCF when the equity is really a claim on event outcome, capital structure, survival, financing, deal close, or litigation/regulatory resolution.

## Primary Anchors

For post-reorg or restructuring:

- post-event cash
- post-event debt
- remaining claims
- warrants, new equity, convertibles, and contingent shares
- post-reorg share count
- liquidity runway
- revenue base and margin recovery path
- capex burden
- date of free-cash-flow breakeven
- EV/Sales, EV/EBITDA, or normalized FCF cross-check
- break value or liquidation value

For signed deals:

- deal price
- spread to deal price
- CVR terms
- expected close timing
- probability of close
- break value
- financing, regulatory, shareholder vote, and litigation risk

## Workflow

1. Identify the hard event and say it early.
2. Decide whether the main frame is deal value, post-reorg equity waterfall, liquidation/break value, or unresolved event risk.
3. Gather the capital structure before doing valuation math.
4. Build bear/base/bull cases.
5. Probability-weight the cases when survival, deal close, or execution risk dominates.
6. State missing inputs plainly.
7. Use standalone DCF only as a secondary cross-check after the event frame is understood.

## Hard Rules

1. Never call this a DCF.
2. Never present a post-bankruptcy company as if pre-bankruptcy history is cleanly comparable.
3. Never ignore post-reorg share count, debt, warrants, or remaining claims.
4. Never call a signed deal cheap or expensive without discussing deal spread and break risk.
5. If plan terms or capital structure are missing, return model requirements instead of false precision.

## Output Contract

Return or explain:

- valuation_method
- valuation_engine_class
- event_type
- event_analysis
- post_event_capital_structure
- bear_case_assumptions
- base_case_assumptions
- bull_case_assumptions
- scenario_outputs
- fair_value_range
- price_vs_value_judgment
- key_sensitivities
- required_inputs
- model_limitations
- confidence_level
