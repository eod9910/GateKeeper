# Ledger Valuation Model Map

## Purpose

This file maps company types and situation flags to the valuation reference library Ledger should use.

Ledger must select the valuation model before discussing fair value. DCF is the default only for normal operating companies with meaningful, normalizable cash flows.

## Model Selection

| Company / Situation | Valuation Model | Reference Folder |
|---|---|---|
| Normal operating company | Operating-company DCF | `operating-dcf/` |
| Small / micro-cap operating company (sub-~$300M) or any operating company whose DCF base is not normalizable (tiny, erratic, one-off cash flow) | Relative-multiple & asset-floor valuation | `smallcap-relative-multiples/` |
| Bank, insurer, lender, balance-sheet broker, credit company | ROE / book-value valuation | `financials-roe-book/` |
| Capital-light asset manager, alternative asset manager, investment adviser, capital-markets platform | Asset-manager FRE / distributable-earnings valuation | `asset-manager-fre/` |
| REIT or REIT-like real estate operating structure | AFFO / FFO / NAV valuation | `reit-affo-nav/` |
| Pre-profit, high-growth, unstable cash-flow company | Revenue scenario valuation | `preprofit-sales-scenario/` |
| Cyclical industrial, auto, semiconductor, steel, shipping, chemical, homebuilder | Normalized mid-cycle earnings valuation | `cyclical-normalized/` |
| Oil, gas, mining, royalty, reserve-based business | Commodity / resource NAV valuation | `commodity-nav/` |
| Conglomerate, holding company, multi-segment business | Sum-of-the-parts valuation | `sum-of-parts/` |
| Merger, acquisition, go-private, bankruptcy, restructuring, spin-off, CVR | Special-situation / deal-value analysis | `special-situations/` |

## Hard Rule

If the selected reference folder does not yet contain enough source material or the runtime engine lacks required inputs, Ledger should say what is missing rather than forcing an operating-company DCF.
