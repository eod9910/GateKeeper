# Asset-Manager FRE / AUM Valuation Reference

## Purpose

This reference explains how Ledger should value capital-light asset managers and alternative asset managers. These companies are not banks, insurers, REITs, or ordinary industrial operating companies.

The core mistake to avoid is using book value as the primary anchor. For an asset manager, the economic value usually comes from recurring fee streams, client assets, fund performance, and carried-interest optionality, not from the accounting equity on the balance sheet.

## Business Model

Asset managers earn revenue from:

- management fees charged on AUM or fee-paying AUM
- advisory fees
- incentive fees
- performance fees
- carried interest
- investment income from balance-sheet capital

Alternative asset managers often have two different earnings streams:

1. Fee-related earnings (FRE): recurring management fees less compensation and operating expenses.
2. Realized performance income / carry: incentive economics earned when funds realize gains.

FRE is more stable and deserves the primary valuation multiple. Carry is valuable but lower certainty because it depends on market performance, realization timing, fund marks, hurdle rates, and exit windows.

## Primary Valuation Equation

Use a sum-of-parts frame:

```text
Equity value =
  FRE value
+ carry / performance-fee value
+ net balance-sheet investments
- net debt and corporate obligations
```

Then divide by diluted shares outstanding.

## FRE Value

When true FRE is available:

```text
FRE value = normalized FRE * FRE multiple
```

When only FRE per share is available:

```text
FRE fair value per share = FRE per share * FRE multiple
```

Use normalized FRE rather than one-quarter annualized FRE when the quarter is distorted by compensation timing, fundraising costs, large realizations, or unusual expenses.

## Distributable Earnings

Distributable earnings (DE) can be used when FRE is unavailable, but it may include performance income. If DE includes realized performance fees, avoid applying a full FRE multiple to the whole amount.

Preferred treatment:

```text
DE = FRE-like base earnings + realized performance income
```

If the split is unavailable, use a lower multiple and label the output as a proxy.

## Carry And Performance Fees

Carry should be valued separately when the company discloses realized performance income, accrued carry, or performance-fee eligible AUM.

Simple proxy:

```text
Carry value = normalized realized performance income * carry multiple
```

Carry multiple should be lower than the FRE multiple because:

- realizations are cyclical
- exits depend on market liquidity
- fund marks can reverse
- compensation sharing can be high
- the timing of cash conversion is uncertain

## AUM Cross-Check

AUM is not fair value by itself. It is a scale input.

Use AUM to test whether the FRE base makes sense:

```text
Management fee revenue = fee-paying AUM * blended fee rate
FRE = management fee revenue * FRE margin
```

Useful checks:

- fee-paying AUM versus total AUM
- permanent capital versus incentive-sensitive capital
- net flows and fundraising momentum
- AUM growth from market appreciation versus actual client inflows
- fee rate compression

## Balance-Sheet Investments

Some asset managers hold fund investments, seed capital, cash, debt, and accrued performance revenue. Add these only when data is explicit enough.

Do not double-count balance-sheet investments that already support reported earnings.

Use conservative treatment:

- add excess cash and investments when clearly disclosed
- subtract corporate debt
- haircut accrued performance revenue if realization is uncertain
- avoid marking private investments above management's disclosed carrying value without evidence

## Scenario Framework

Bear case:

- lower FRE multiple
- lower or zero carry value
- lower AUM growth
- fee compression
- realization drought
- compensation margin pressure

Base case:

- normalized FRE
- mid FRE multiple
- modest carry value
- no heroic AUM or margin expansion

Bull case:

- higher FRE multiple
- stronger net flows
- stronger realization cycle
- carry contribution included with higher but still discounted multiple

## Multiple Discipline

FRE multiple should reflect:

- durability of management fees
- permanence of capital
- fund performance
- net flows
- fee rate stability
- operating leverage
- brand strength
- balance-sheet risk

Carry multiple should reflect:

- visibility of realization pipeline
- accrued carry quality
- market liquidity
- fund marks and valuation risk
- historical conversion into cash

## Confidence Rules

Medium confidence requires at least one of:

- true FRE
- distributable earnings with a clear split
- adjusted net income tied to asset-manager economics

Low confidence when the model uses:

- free cash flow proxy
- operating cash flow proxy
- revenue times estimated fee-earnings margin
- generic GAAP net income without segment clarity

Insufficient inputs when the model lacks:

- any usable earnings/revenue base
- current price
- shares outstanding or a way to infer share count

## Red Flags

Reduce confidence or multiple when:

- earnings are dominated by realizations
- FRE margin is falling
- AUM growth is mostly market beta, not flows
- fee-paying AUM is shrinking
- compensation ratio is rising
- debt is high at the management-company level
- balance-sheet investments are illiquid or heavily marked
- permanent capital is low
- fundraising slows materially

## What Ledger Should Say

Ledger should explicitly state:

- this is an asset-manager model, not a bank/book-value model
- which earnings base was used
- whether the base is true FRE/DE or a proxy
- whether carry was valued or excluded
- what inputs are missing
- why confidence is medium, low, or insufficient
