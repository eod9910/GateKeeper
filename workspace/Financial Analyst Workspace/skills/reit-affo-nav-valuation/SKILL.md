# REIT AFFO / FFO / NAV Valuation

## Purpose

Value REITs and REIT-like real estate operating structures using the real estate valuation framework Ledger keeps in `references/valuation-models/reit-affo-nav/`.

This skill exists because a standard operating-company DCF can be misleading for REITs. Low current ratio, low cash balance, high leverage, and negative free cash flow from property acquisition can be normal features of the structure rather than proof of operating distress.

## Runtime Contract

- Runtime tool: `run_dcf_valuation`
- Backend engine: `reit_affo_valuation_engine`
- Valuation method: `reit_affo_nav_proxy`
- Valuation engine class: `reit_affo`
- Normal dependency inputs:
  - `get_ledger_context`
  - `run_earnings_quality`
  - `run_financial_analysis`

What this means:

- this skill defines how Ledger should reason about REIT value
- the backend dispatches REITs to the REIT-specific valuation engine
- Ledger must explain the output as AFFO / FFO / NAV work, not as an industrial DCF

## Reference Set

Primary references for this skill:

- `../../references/valuation-models/reit-affo-nav/2018-FFO-white-paper-(11-27-18).pdf`
  Use for Nareit's FFO definition and the conceptual distinction between GAAP net income and REIT operating performance.
- `../../references/valuation-models/reit-affo-nav/UpdatedInvestorsGuideToREITs.pdf`
  Use for REIT structure, investor metrics, dividends, property economics, and sector context.
- `../../references/valuation-models/reit-affo-nav/Non-GAAP Financial Measures.md`
  Use for SEC non-GAAP discipline, especially FFO, per-share presentation, reconciliation, and misleading-adjustment risk.
- `../../references/valuation-models/reit-affo-nav/EPRA_BPR_Guidelines_241019.pdf`
  Use for NAV / NTA / real estate reporting best-practice concepts.
- `../../references/valuation-models/reit-affo-nav/ADC-Supplemental-Financial-Information-Q1-2026.pdf`
  Use as a real company example of REIT supplemental reporting: FFO, AFFO, portfolio, leverage, dividend, tenant, and debt schedule disclosures.

Reference rules:

1. Use Nareit for FFO definition.
2. Use company supplementals for real-world metric layout and reconciliation examples.
3. Use SEC non-GAAP guidance to avoid treating management-adjusted AFFO as unquestioned truth.
4. Use NAV/cap-rate references as a cross-check, not as fake precision when property-level NOI or cap rates are missing.
5. If true AFFO, NAV, cap rates, or debt maturity detail is missing, say the model is a proxy.

## When To Use

Use this skill when:

- the company is a REIT
- the company is REIT-like and derives value primarily from income-producing real estate
- the symbol classification says `company_type = reit` or `valuation_engine_class = reit_affo`
- the question involves FFO, AFFO, NAV, dividend coverage, occupancy, cap rates, debt maturities, lease quality, or REIT valuation

## When Not To Use

Do not use this skill for:

- banks or insurers
- normal operating companies with conventional free cash flow
- pre-profit growth companies
- commodity reserve businesses
- signed merger or bankruptcy situations where event value dominates

If a REIT is under a signed acquisition or restructuring, use the special-situation frame first and this skill only as a secondary standalone-value cross-check.

## Core REIT Principle

A REIT is primarily valued by the recurring cash earnings and asset value of its property portfolio.

GAAP EPS is usually less useful than FFO or AFFO because depreciation of real estate can obscure property-level cash generation. Free cash flow can also look negative when the company is acquiring or developing properties. That does not automatically mean the business is burning cash.

## Required Inputs

Prefer these inputs:

- FFO per share
- AFFO per share
- net income reconciliation to FFO
- recurring capex / maintenance capex / leasing costs
- dividend per share
- occupancy
- same-store NOI growth
- tenant concentration
- lease maturity schedule
- debt maturity schedule
- fixed-charge coverage
- net debt / EBITDA or similar leverage metric
- NAV per share or property NOI and cap-rate assumptions
- share count and preferred equity

If the engine only has operating cash flow or net income proxies, Ledger must label the result as a proxy and lower confidence.

## Workflow

1. Confirm the company is a REIT or REIT-like property company.
2. Identify property type: net lease, industrial, residential, office, data center, retail, healthcare, lodging, self-storage, or diversified.
3. Start with FFO and AFFO, not GAAP EPS.
4. Reconcile management-adjusted measures back to GAAP net income where available.
5. Calculate or inspect dividend coverage using AFFO.
6. Assess property operating quality:
   - occupancy
   - same-store NOI growth
   - tenant quality
   - lease duration and rollover risk
   - property type exposure
7. Assess capital structure:
   - debt maturities
   - fixed-charge coverage
   - secured vs unsecured debt
   - floating-rate exposure
   - refinancing risk
   - access to equity and debt markets
8. Estimate value with the best available method:
   - AFFO / FFO multiple when per-share cash metrics are available
   - NAV when property NOI and cap rates are available
   - provisional AFFO proxy when only operating cash flow is available
9. Cross-check valuation:
   - P/FFO
   - P/AFFO
   - AFFO yield
   - dividend yield and payout ratio
   - NAV premium/discount
10. State model limitations directly.

## False Positive Warnings

Do not automatically flag these as distress for a REIT:

- low current ratio
- low cash balance
- negative free cash flow caused by acquisitions or development
- high debt/equity compared with normal operating companies
- equity issuance used to fund accretive property acquisitions

These can be risks, but they must be interpreted through REIT economics.

Real REIT concerns include:

- AFFO per share deterioration
- dividend payout ratio above sustainable levels
- declining occupancy
- weak leasing spreads
- tenant concentration or tenant credit problems
- near-term debt maturities during tight credit markets
- floating-rate debt exposure
- poor acquisition spreads versus cost of capital
- persistent NAV discount that blocks external growth
- management adjustments that stretch SEC non-GAAP discipline

## Output Contract

Return or explain:

- valuation_method
- valuation_engine_class
- property_type
- FFO / AFFO facts
- dividend_coverage
- NAV_or_AFFO_multiple_cross_check
- leverage_and_refinancing_risk
- portfolio_quality
- tenant_and_lease_risk
- fair_value_range
- price_vs_value_judgment
- model_limitations
- confidence_level

## Analyst Voice

Be explicit when this is not a DCF:

> I am valuing this as a REIT using AFFO / FFO and NAV logic, not as a normal operating-company DCF.

For ADC-style cases, say plainly when generic distress flags are false positives:

> Low current ratio and negative free cash flow are not enough to call a REIT distressed. I need to see AFFO coverage, debt maturities, occupancy, tenant quality, and refinancing risk.
