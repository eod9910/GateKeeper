# Asset-Manager Inputs And Disclosures

## Preferred Inputs

Ledger should look for these fields in company filings, earnings releases, investor supplements, and management commentary.

## Company Classification

Use this model when the company is primarily:

- asset management
- investment management
- alternative asset management
- private equity
- private credit
- infrastructure funds
- real assets funds
- hedge funds / multi-strategy funds
- investment advisory
- capital-light capital-markets platform

Do not use this model for balance-sheet financial companies whose value depends on deposits, loans, underwriting, credit risk, or regulatory capital.

## Core Operating Inputs

Priority order:

1. Fee-related earnings (FRE)
2. FRE per share
3. Distributable earnings (DE)
4. DE per share
5. Adjusted net income / economic net income
6. Free cash flow
7. Operating cash flow
8. Revenue times fee-earnings margin proxy

## AUM Inputs

Useful AUM fields:

- total AUM
- fee-paying AUM
- perpetual / permanent capital AUM
- AUM not yet earning fees
- dry powder
- inflows / fundraising
- outflows / redemptions
- market appreciation / depreciation
- realization activity
- fee rate or management-fee revenue

## Carry Inputs

Useful carry / incentive fields:

- realized performance revenue
- realized carried interest
- accrued performance revenue
- net accrued carry
- performance-fee eligible AUM
- carried-interest compensation allocation
- fund marks
- investment realizations

## Balance-Sheet Inputs

Useful balance-sheet fields:

- cash
- corporate debt
- fund investments
- seed investments
- accrued performance revenue
- net investments
- diluted shares
- preferred stock or other claims

## Derived Metrics

Ledger should derive:

```text
FRE margin = FRE / management-fee revenue
```

```text
Management fee rate = management-fee revenue / fee-paying AUM
```

```text
FRE per share = FRE / diluted shares
```

```text
DE per share = distributable earnings / diluted shares
```

```text
Carry contribution per share = realized performance income / diluted shares
```

## Proxy Rules

If true FRE is unavailable:

1. Use DE if it is mostly recurring or if carry can be separated.
2. Use adjusted net income if management defines it clearly.
3. Use free cash flow only as a low-confidence proxy.
4. Use revenue times configured fee-earnings margin only as a low-confidence fallback.

If using a revenue proxy:

```text
FRE proxy = revenue * default fee-earnings margin
```

Margin should vary by subtype:

- traditional asset manager: lower margin and lower multiple
- alternative asset manager: higher margin and higher multiple
- private credit manager: high recurring fee quality but watch credit cycle risk
- capital-markets platform: lower margin and more cyclicality

## Missing Input Messages

If no true FRE/DE is available, Ledger should say:

```text
The model is using a proxy because the available data does not expose fee-related earnings or distributable earnings.
```

If no carry data is available, Ledger should say:

```text
Carry and incentive-fee value is not separately modeled because the current evidence does not disclose a usable realized or accrued carry base.
```

If AUM is unavailable, Ledger should say:

```text
AUM is unavailable, so the valuation cannot cross-check fee revenue, fee rate, or asset-flow quality.
```
