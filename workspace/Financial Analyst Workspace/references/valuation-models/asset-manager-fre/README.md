# Asset-Manager FRE / AUM Valuation

Use this folder for references that teach Ledger how to value capital-light asset managers, alternative asset managers, investment advisers, and capital-markets platforms where book value is not the economic capital base.

## Primary Anchors

- fee-related earnings (FRE)
- distributable earnings (DE)
- management-fee revenue
- assets under management (AUM)
- fee-paying AUM
- base management fee rate
- FRE margin
- incentive fees / carried interest
- realization cycle and performance-fee cyclicality
- fund-raising cadence and net flows
- balance-sheet investments and accrued performance revenue

## Reference Materials

- `alternative-asset-manager-sources-of-value-reference.txt`
  Industry reference on valuing alternative asset-management firms by separating management-fee earnings from incentive-fee / carry earnings.

## Use When

The company earns most of its value from managing third-party capital, collecting recurring management fees, and optionally earning incentive fees or carried interest. This includes traditional asset managers, alternative asset managers, private-equity managers, credit managers, infrastructure/real-asset managers, and investment advisers.

## Do Not Use When

Do not use this model for banks, insurers, lenders, mortgage finance companies, or balance-sheet brokers where the primary value driver is financial assets, liabilities, credit spread, underwriting risk, deposits, or regulatory capital.

Do not use a REIT AFFO model unless the company itself is a REIT or primarily owns income-producing real estate. Owning real-estate funds or managing real-estate vehicles is not the same as being a REIT.

## Valuation Frame

Separate the business into three layers:

1. Fee-related earnings: recurring management fees minus compensation and operating costs. This is the highest-quality base and should receive the main multiple.
2. Incentive fees / carry: performance-linked earnings that can be valuable but are cyclical, realization-dependent, and lower certainty. This should receive a lower multiple or a probability haircut.
3. Balance-sheet investments / net cash: investments, seed capital, accrued performance revenue, debt, and cash. Add or subtract these only when the data is explicit enough.

## Proxy Hierarchy

Use true company-disclosed inputs first:

1. FRE per share or total FRE
2. distributable earnings per share or total DE
3. adjusted net income / economic net income
4. free cash flow or operating cash flow
5. revenue times a conservative fee-earnings margin

If the model reaches level 4 or 5, confidence should be low and the output should say it used a proxy.

## Scenario Logic

Bear case:

- lower FRE multiple
- lower carry multiple
- slower AUM growth or net outflows
- weaker realization environment
- higher compensation pressure

Base case:

- normalized FRE multiple
- modest AUM growth
- carry valued separately with a lower multiple
- no heroic margin expansion

Bull case:

- higher FRE multiple
- stronger net flows
- better realization cycle
- performance fees recovering or accelerating

## Output Contract

The valuation output should state:

- which earnings base was used
- whether the base was true FRE/DE or a proxy
- FRE or proxy earnings per share
- carry / incentive-fee contribution if available
- bear/base/bull fair value range
- current price versus midpoint
- why book value was not used as the primary valuation anchor
- confidence level and missing inputs

## Failure Conditions

Return low confidence or insufficient inputs when:

- no FRE, DE, adjusted earnings, cash-flow, revenue, or share-count base is available
- AUM / fee data is missing and revenue proxy quality is weak
- reported earnings are dominated by marks, gains, realizations, or one-time items
- the firm has material balance-sheet leverage or financing risk not captured by the FRE base

## Model Limitations

This model is a first-pass public-data valuation. A full institutional model should use segment-level FRE, fee-paying AUM, management-fee rate, performance-fee eligible AUM, accrued carry, fund investment marks, compensation ratios, and net balance-sheet investments.
