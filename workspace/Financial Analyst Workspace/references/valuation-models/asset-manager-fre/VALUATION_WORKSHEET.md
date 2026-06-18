# Asset-Manager Valuation Worksheet

Use this worksheet when implementing or reviewing the `asset_manager_fre` valuation engine.

## Step 1: Confirm Business Type

Ask:

- Is the company primarily earning management/advisory fees?
- Is balance-sheet capital secondary to the fee franchise?
- Does book value fail to capture the economic engine?

If yes, use `asset_manager_fre`.

If the company is a bank, insurer, lender, mortgage finance company, or balance-sheet broker, use `roe_book_value`.

If the company is a REIT or owns income-producing property directly, use `reit_affo`.

## Step 2: Select Earnings Base

Choose one base in priority order:

| Rank | Base | Confidence |
|---|---|---|
| 1 | FRE | Medium |
| 2 | Distributable earnings with clear carry split | Medium |
| 3 | Adjusted net income / economic net income | Medium-low |
| 4 | Free cash flow / operating cash flow | Low |
| 5 | Revenue margin proxy | Low |

Record the source and label the base clearly.

## Step 3: Normalize The Base

Normalize for:

- unusual realizations
- compensation timing
- acquisition-related costs
- mark-to-market gains/losses
- one-time expenses
- unusually strong or weak fundraising periods

If there is not enough data to normalize, keep the model low confidence.

## Step 4: Choose Subtype

Classify into:

- `traditional_asset_manager`
- `alternative_asset_manager`
- `private_credit_manager`
- `capital_markets_platform`
- `diversified`

Use `alternative_asset_manager` for Blackstone-style companies unless evidence points elsewhere.

## Step 5: Apply FRE Multiple

Use the configured multiple band for the subtype:

```text
FRE value = normalized FRE * FRE multiple
```

Adjust within the band for:

- AUM growth
- net flows
- fee rate stability
- permanence of capital
- earnings quality
- leverage
- fundraising environment

## Step 6: Value Carry Separately

If realized performance income or carry is available:

```text
Carry value = normalized carry income * carry multiple
```

If only accrued carry is available:

```text
Carry value = accrued carry * realization haircut
```

If no carry data is available, set carry value to zero and disclose that upside may be excluded.

## Step 7: Add Balance-Sheet Items

Add:

- excess cash
- disclosed net investments
- seed capital when clearly separable

Subtract:

- corporate debt
- preferred claims
- non-controlling claims when relevant

Avoid double-counting investments that already support reported earnings.

## Step 8: Build Scenarios

Bear:

```text
lower FRE multiple + lower carry multiple + weaker flows + realization pressure
```

Base:

```text
mid FRE multiple + modest carry + normalized flows
```

Bull:

```text
higher FRE multiple + stronger flows + better realization cycle
```

## Step 9: Convert To Per-Share Value

```text
Fair value per share = equity value / diluted shares
```

Use diluted shares. If only market cap and price are available:

```text
shares = market cap / current price
```

Label inferred shares as lower-confidence.

## Step 10: Output

The final output should include:

- valuation method: `asset_manager_fre_distributable_earnings`
- earnings base used
- proxy status
- subtype
- FRE/proxy earnings per share
- carry value per share if modeled
- bear/base/bull fair value range
- current price versus midpoint
- key missing inputs
- confidence level

## BX Example Frame

For Blackstone-style companies:

- do not use book value as primary value
- do not use REIT AFFO just because the firm manages real-estate funds
- use alternative asset manager subtype
- value FRE first
- value carry separately if data is available
- use AUM and fee-paying AUM as quality and scale cross-checks
