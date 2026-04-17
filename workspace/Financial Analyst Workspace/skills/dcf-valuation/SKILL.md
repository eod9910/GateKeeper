# DCF Valuation

## Purpose

Estimate a company’s intrinsic value using a disciplined discounted cash flow framework.

This skill should normally be entered through the `run_dcf_valuation` tool.

## Runtime Contract

This skill is the workspace contract for Ledger's DCF workflow.

- Runtime tool: `run_dcf_valuation`
- Backend engine: `dcf_engine`
- Normal dependency inputs:
  - `get_ledger_context`
  - `earnings_quality_engine`
  - `financial_analysis_engine`

What this means:

- the workspace defines the valuation doctrine, assumptions discipline, and output contract
- the backend engine performs the structured DCF math
- Ledger interprets the result and states the price-versus-value judgment

## Reference Set

Primary references for this skill:

- `../../references/705988Morningstar_Equity_Research_Methodology.pdf`
  Use for explicit forecast periods, fade periods, ROIC versus cost of capital framing, and fair value range logic.
- `../../references/rf-v2017-n4-1-pdf.pdf`
  Use for intrinsic value logic, discounting principles, and uncertainty-aware valuation thinking.
- `../../references/finstatement.pdf`
  Use when accounting adjustments materially affect forecast cash flows or capital structure.

## Workflow

1. Choose whether the valuation should be FCFF/WACC or FCFE/cost of equity.
2. Establish the current economic base:
   - revenue
   - operating margin
   - operating cash flow
   - free cash flow
   - capital intensity
   - balance sheet constraints
3. State the forecast assumptions explicitly:
   - near-term revenue growth
   - margin path
   - reinvestment needs
   - discount rate
   - terminal growth
4. Build a base case, and when possible also a bear and bull case.
5. Return a value range, not false precision.

## Hard Rules

1. Never hide assumptions.
2. Never present a single-point fair value as if it were certain.
3. If cash flow is too unstable or assumptions are too fragile, say the DCF is low confidence.
4. Use multiples only as cross-checks, not as the main valuation method.

## Output Contract

Return:

- valuation_method
- base_case_assumptions
- bear_case_assumptions
- bull_case_assumptions
- fair_value_range
- price_vs_value_judgment
- key_sensitivities
- confidence_level
