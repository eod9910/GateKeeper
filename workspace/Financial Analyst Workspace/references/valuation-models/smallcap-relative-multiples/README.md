# Small / Micro-Cap Relative-Multiple & Asset-Floor Valuation

Use this folder for references that teach Ledger how to value small and micro-cap
operating companies where a multi-stage operating DCF is structurally unreliable. The
right frame here is **relative multiples anchored to peers, bounded by an asset/NAV
floor, and haircut for dilution and solvency risk** — not a forecast-and-discount DCF.

## Why DCF Fails Here

A standard operating DCF detonates on small/micro-caps for structural, not cosmetic,
reasons. Ledger should understand these so it does not present a fragile DCF as a
confident fair value:

1. **Terminal value dominates and is extrapolated from noise.** Terminal value is
   typically 70-90% of a DCF. On a micro-cap, the cash-flow base is tiny and lumpy, so
   capitalizing it into perpetuity manufactures enormous fair values. A name trading at
   under $1 with one good cash-flow year can be modeled to a fair value many multiples
   of price. This is a math artifact, not undervaluation.
2. **The base year is not normalizable.** Micro-cap cash flows are episodic — one-off
   working-capital swings, single contracts, capitalized vs expensed shifts. There is no
   stable base to fade from.
3. **DCF is blind to the exact risks that make these names cheap.** Going-concern doubt,
   covenant pressure, emergency dilution, and negative tangible equity are precisely why
   the market discounts the stock. A cash-flow DCF cannot see any of this and therefore
   almost always reads "undervalued."
4. **The required discount rate is off the chart.** Real micro-cap cost of capital is
   often 18-30%+. Standard DCF discount-rate ranges are far too low to offset the
   optimistic terminal, biasing fair value upward.

The practical consequence: forcing these companies into `dcf_operating` produces
implausible valuation gaps that pollute any screen or fade signal built on the gap. The
fix is to value them the way practitioners actually do.

## Primary Anchors

- EV/Sales versus sector / peer-group median
- EV/EBITDA versus sector / peer-group median (only when EBITDA is positive and clean)
- Price/Book and Price/Tangible-Book versus peers
- P/E versus peers (only when earnings are positive and not distorted by one-offs)
- Tangible book value / net asset value as a downside **floor** (net-net / liquidation lens)
- Net cash or net debt per share
- Dilution trajectory (share-count growth, ATM programs, convertibles, warrants)
- Solvency / runway (cash vs burn, near-term maturities, covenant headroom)

## Method (Doctrine)

1. **Build a peer comp set.** Use sector/industry peers of comparable business model.
   Prefer industry-level medians, fall back to sector when the industry group is too thin.
2. **Apply peer multiples to the company's own clean metrics** (sales, EBITDA, book) to
   get a multiple-implied equity value. Use revenue/book multiples as the workhorse;
   EV/EBITDA and P/E only when those denominators are positive and not one-off-distorted.
3. **Establish an asset floor.** Compute tangible book / NAV (and a net-net figure where
   relevant). The valuation should rarely be presented above the multiple-implied
   ceiling or below a credible liquidation floor.
4. **Apply explicit haircuts** for dilution risk and solvency/going-concern risk — the
   things DCF ignores. State the haircut, do not bury it.
5. **Return a band, not a point** — asset floor → peer-multiple ceiling — and default to
   **low confidence**. Micro-cap valuation is inherently imprecise.

## Use When

- Small or micro-cap operating company (roughly sub-$300M market cap) **and/or**
- An operating company where the DCF base is not normalizable: tiny, erratic, or
  one-off free cash flow; weak cash-flow quality; or a DCF output that is implausible
  on its face.
- The company is NOT a financial, REIT, pre-profit hyper-growth, or hard-event case
  (those route to `roe_book_value`, `asset_manager_fre`, `reit_affo`, `sales_scenario`, or
  `special_situation` respectively).

## Do Not Use

- Do not use for companies with stable, normalizable cash flows — those belong in
  `dcf_operating`.
- Do not present a relative-multiple valuation as a DCF.
- Do not state a precise point fair value or high confidence; this method produces a
  wide, low-confidence band by design.
- Do not ignore the asset floor or the dilution/solvency haircut — they are the core of
  the method, not optional add-ons.
- Do not apply EV/EBITDA or P/E multiples when EBITDA/earnings are negative or distorted;
  fall back to EV/Sales and Price/Tangible-Book.

## Engine Status

As of this writing the doctrine exists but the backend engine class
(`relative_multiples`) is **not yet implemented**. Per the Ledger architecture rule, a
new valuation model requires updating four layers — reference material (this folder),
the workspace skill and `MODEL_MAP.md`, the backend engine and dispatcher in
`ledgerEngines.ts`, and the tool/response docs. Until the engine is wired, Ledger should
state that the operating DCF is unreliable for this name and explain the relative-multiple
and asset-floor read qualitatively rather than forcing a DCF number.
