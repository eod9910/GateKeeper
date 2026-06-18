# Valuation Method Selection

## Purpose

Estimate a company's intrinsic value using the valuation method that fits the business model. A discounted cash flow framework is the default for normal operating companies, but it is not adequate for every industry.

This skill should normally be entered through the `run_dcf_valuation` tool.

## Runtime Contract

This skill is the workspace contract for Ledger's valuation workflow.

- Runtime tool: `run_dcf_valuation`
- Backend engine: `dcf_engine` / valuation-engine dispatcher
- Normal dependency inputs:
  - `get_ledger_context`
  - `earnings_quality_engine`
  - `financial_analysis_engine`

What this means:

- the workspace defines the valuation doctrine, method-selection rules, assumptions discipline, and output contract
- the backend engine performs the structured valuation math
- Ledger interprets the result and states the price-versus-value judgment

## Reference Set

Primary references for this skill:

- `../../references/705988Morningstar_Equity_Research_Methodology.pdf`
  Use for explicit forecast periods, fade periods, ROIC versus cost of capital framing, and fair value range logic.
- `../../references/rf-v2017-n4-1-pdf.pdf`
  Use for intrinsic value logic, discounting principles, and uncertainty-aware valuation thinking.
- `../../references/finstatement.pdf`
  Use when accounting adjustments materially affect forecast cash flows or capital structure.

## Method Selection

Ledger must choose the valuation method before discussing fair value. Do not force every company into an operating-company DCF.

### Operating Companies

Use `dcf_operating` when the company has a normal industrial, software, consumer, healthcare, or services cash-flow profile.

Primary anchors:

- revenue
- operating margin
- operating cash flow
- free cash flow
- reinvestment intensity
- discount rate
- terminal growth

DCF is appropriate when cash flows are economically meaningful and can be normalized.

### Small / Micro-Cap Or Non-Normalizable Operating Companies

Use `relative_multiples` for small and micro-cap operating companies (roughly sub-$300M
market cap), and for any operating company whose cash-flow base is too small, lumpy, or
one-off to support a multi-stage DCF.

Primary anchors:

- EV/Sales and EV/EBITDA versus sector / peer-group medians
- Price/Book and Price/Tangible-Book versus peers
- tangible book value / net asset value as a downside floor
- dilution trajectory (share-count growth, ATM, convertibles, warrants)
- solvency and cash runway

Do not force these companies into an operating-company DCF. On a tiny, lumpy cash-flow
base the terminal value dominates and manufactures absurd fair values, while the model
stays blind to the dilution and solvency risk that make the stock cheap in the first
place. Value them off peer multiples, bound the result with an asset/NAV floor, apply an
explicit dilution and solvency haircut, and return a wide, low-confidence band — never a
precise point. See `references/valuation-models/smallcap-relative-multiples/`.

### Financial Companies

Use `roe_book_value` for banks, insurers, credit companies, mortgage lenders, balance-sheet brokers, and other balance-sheet financials.

Primary anchors:

- book value per share or tangible book value per share
- normalized ROE
- cost of equity
- credit quality
- capital adequacy
- reserves, provisions, and regulatory constraints

Do not value these companies with industrial free cash flow. Deposits, leverage, working capital, and cash flow statements do not mean the same thing here.

### Asset Managers And Capital-Light Financial Platforms

Use `asset_manager_fre` for capital-light asset managers, alternative asset managers, investment advisers, private-equity managers, credit managers, infrastructure/real-asset managers, and capital-markets platforms where book value is not the economic capital base.

Primary anchors:

- fee-related earnings (FRE)
- distributable earnings (DE)
- management-fee revenue
- fee-paying AUM
- base fee rate
- FRE margin
- incentive fees / carried interest
- realization cycle
- net flows and fundraising cadence

Do not treat these as ordinary banks or insurers. Book value can be a balance-sheet reference, but it is usually not the primary valuation anchor. If true FRE, DE, carry, AUM, or fee-rate data is missing, use the proxy hierarchy in `references/valuation-models/asset-manager-fre/` and keep confidence low.

### REITs And Real Estate Companies

Use `reit_affo` for real estate investment trusts and REIT-like operating structures.

Primary anchors:

- FFO and AFFO per share
- dividend coverage
- net asset value
- cap rates
- occupancy and same-store rent growth
- debt maturities, fixed-charge coverage, and refinancing risk
- cost of capital versus acquisition/development yields

Do not treat low current ratio, low cash balance, or negative free cash flow from property acquisitions as ordinary operating distress. A standard FCF DCF is usually the wrong primary model.

### Pre-Profit Or High-Growth Companies

Use `sales_scenario` when the company has negative or unstable cash flow but meaningful revenue growth or strategic optionality.

Primary anchors:

- revenue growth
- gross margin and unit economics
- path to contribution margin
- cash runway and financing need
- dilution risk
- EV/Sales or scenario-based terminal economics

Do not present a fragile DCF as high confidence when the current cash-flow base is not normalizable.

### Special Situations

If filing evidence shows a signed merger, acquisition, go-private transaction, bankruptcy, restructuring, material restatement, or other hard event, stop treating the stock as a normal standalone valuation case. Explain the event terms and use valuation only as secondary context.

## Workflow

1. Choose the correct valuation engine for the business model.
2. If the company is an operating company, choose whether the valuation should be FCFF/WACC or FCFE/cost of equity.
3. Establish the current economic base:
   - revenue
   - operating margin
   - operating cash flow
   - free cash flow
   - capital intensity
   - balance sheet constraints
4. For non-operating-company models, replace the economic base with the correct sector anchors listed above.
5. State the forecast assumptions explicitly.
6. Build a base case, and when possible also a bear and bull case.
7. Return a value range, not false precision.

## Hard Rules

1. Never hide assumptions.
2. Never present a single-point fair value as if it were certain.
3. Never call a non-DCF valuation a DCF.
4. If cash flow is too unstable or assumptions are too fragile, say the valuation is low confidence.
5. Use multiples only as cross-checks unless the selected method requires a multiple or scenario framework.
6. If the selected engine is not implemented or lacks required facts, say so directly and return the right model requirements rather than forcing a bad DCF.

## Output Contract

Return:

- valuation_method
- valuation_engine_class
- base_case_assumptions
- bear_case_assumptions
- bull_case_assumptions
- fair_value_range
- price_vs_value_judgment
- key_sensitivities
- model_limitations
- confidence_level
