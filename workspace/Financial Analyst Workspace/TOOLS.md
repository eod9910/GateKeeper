# Financial Analyst Workspace Tools

## Default Tool Inventory

For the full mental model of how Ledger, workspace skills, runtime tools, and backend engines fit together, see `documents/LEDGER_ARCHITECTURE.md`.

Ledger's active runtime tools are:

- `get_ledger_context`
- `get_social_buzz`
- `get_consumer_cycle_context`
- `screen_clean_universe`
- `refresh_filing_coverage`
- `run_financial_analysis`
- `run_earnings_quality`
- `run_dcf_valuation`

## Skill To Tool To Engine Map

- `financial-analysis`
  - runtime tool: `run_financial_analysis`
  - backend engine: `financial_analysis_engine`
- `earnings-quality`
  - runtime tool: `run_earnings_quality`
  - backend engine: `earnings_quality_engine`
- `dcf-valuation`
  - runtime tool: `run_dcf_valuation`
  - backend engine: valuation dispatcher, usually `dcf_engine`
  - small/micro-cap or non-normalizable operating companies dispatch to the `relative_multiples` engine (`relative_multiple_asset_floor` method); interpret as a relative-multiple + asset-floor band, not a DCF. See `references/valuation-models/smallcap-relative-multiples/`.
- `reit-affo-nav-valuation`
  - runtime tool: `run_dcf_valuation`
  - backend engine: `reit_affo_valuation_engine`
  - valuation method: `reit_affo_nav_proxy`
- `special-situation-valuation`
  - runtime tool: `run_dcf_valuation`
  - backend engine: `special_situation_valuation_engine`
  - valuation method: `special_situation_post_reorg_scenario` or `special_situation_deal_value`
  - valuation engine class: `special_situation`
- `buried-risk-review`
  - runtime tool: `get_ledger_context`
  - backend implementation: filing-note retrieval plus note classification/filtering
- `sentiment-context`
  - runtime tool: `get_social_buzz`
  - backend implementation: social-buzz fetch plus workspace interpretation rules
- `consumer-cycle-context`
  - runtime tool: `get_consumer_cycle_context`
  - backend implementation: consumer-cycle monitor plus symbol classification from the repo consumer taxonomy

### 1. `get_ledger_context`

Use it to retrieve the current company-analysis bundle for the active symbol, including:

- filing-backed statement facts
- recent SEC document metadata
- retrieved filing-note evidence
- coverage tier and provenance-aware snapshot context

### 1.5 `get_social_buzz`

Use it when the user asks for:

- social buzz
- sentiment
- crowd positioning
- watcher activity
- bull / bear balance
- message tone or hype risk

This tool should:

- return the active symbol's social-buzz snapshot
- include mood, watchers, message count, bull / bear mix, and recent message samples when available
- be treated as secondary context rather than proof
- help frame squeeze risk, hype risk, crowdedness, and mean-reversion risk

### 1.75 `get_consumer_cycle_context`

Use it when the user asks for:

- consumer cycle
- cyclical demand
- slowdown risk
- recession sensitivity
- defensive vs cyclical exposure
- whether the company belongs in a highly cyclical, mildly cyclical, or stable bucket

This tool should:

- return the current macro consumer-cycle monitor
- return the active symbol's cycle bucket, specific category, and slowdown preference when classified
- use the repo's consumer-cycle taxonomy rather than ad hoc language
- help frame whether weakness in autos, housing, business equipment, or other cyclical pockets matters for the symbol

### 1.9 `screen_clean_universe`

Use it when the user asks for:

- best 5 stocks to buy
- best 5 shorts
- top ideas from the database
- ranked clean-universe picks
- stock selection based on valuation, debt, quality, and trend together
- natural-language Finviz-style screens such as "high P/E and high price-to-sales", "low debt and high gross margin", "high short float", "high beta", or "high relative volume"

This tool should:

- screen only the `tradable_stock_default` clean universe
- use the symbol catalog as the primary prefilter layer
- narrow by valuation state, consumer-cycle positioning, optional theme, and optional optionability
- optionally narrow by trust-gated social conditions such as:
  - `social_signal = buzz_hot`
  - `social_signal = buzz_rising`
  - `social_signal = bullish`
  - `min_buzz_zscore`
  - `min_final_buzz_score`
- translate plain-English metric requests into `metric_filters`, using aliases such as:
  - `pe`
  - `price_to_sales`
  - `enterprise_to_sales`
  - `market_cap`
  - `revenue_growth`
  - `gross_margin`
  - `profit_margin`
  - `roe`
  - `debt_to_equity`
  - `short_float`
  - `beta`
  - `relative_volume`
- then rank candidates with fundamentals snapshot checks for liquidity, balance-sheet quality, earnings quality, and technical trend
- return a ranked list that Ledger can explain rather than inventing picks from one loaded symbol
- be clear when a metric is computed from available raw fields rather than directly stored

### 2. `run_financial_analysis`

Use this when the user wants a full company read.

This tool should be treated as the runtime entrypoint for the `financial-analysis` skill.

### 2.5 `refresh_filing_coverage`

Use this when:

- I do not have strong filing coverage for the company
- the company is missing from PIT / filing-note retrieval
- SEC-backed coverage looks stale or incomplete

This tool should:

- repair the symbol in the canonical universe if it was missed there
- refresh Ledger filing eligibility metadata for that symbol
- refresh the fundamentals snapshot
- fetch the latest SEC filing history when available
- run Docling history ingestion
- import new filing facts into PIT
- refresh filing-note retrieval coverage

This is a Ledger recovery tool. Use it before concluding that a company is unavailable if coverage looks fetchable.

### 3. `run_earnings_quality`

Use this when the user wants to understand:

- cash conversion
- accounting quality
- dilution
- capex burden
- one-time distortion risk
- whether reported earnings reflect economic reality

This tool should be treated as the runtime entrypoint for the `earnings-quality` skill.

### 4. `run_dcf_valuation`

Use this when the user asks for:

- DCF
- intrinsic value
- fair value
- overvalued vs undervalued judgment

This tool should be treated as the runtime entrypoint for the valuation dispatcher. The name is legacy; it can return a normal DCF, REIT AFFO/NAV valuation, financial-company ROE/book valuation, small/micro-cap relative-multiple valuation, pre-profit sales scenario, or special-situation valuation depending on the company and hard flags.

For REITs, the same runtime tool dispatches to `reit_affo_valuation_engine` and should be interpreted through the `reit-affo-nav-valuation` skill, not as a normal operating-company DCF.

For bankruptcy, restructuring, signed deals, CVRs, liquidation, delisting, restatement, or other hard-event cases, the same runtime tool dispatches to `special_situation_valuation_engine` and should be interpreted through the `special-situation-valuation` skill, not as a normal operating-company DCF.

## Note Review / Buried Risk Usage

When the user asks for:

- hidden risks
- buried notes
- what management may be downplaying
- note review
- risk-factor interpretation
- liquidity language
- legal or regulatory caveats

Ledger should use `get_ledger_context` as the retrieval tool and follow the `buried-risk-review` skill as the interpretation procedure.

## Tool Boundaries

Ledger should not rely on scanner-native technical tools as part of its default operating path.

These are not Ledger-default tools:

- `get_chart_snapshot`
- `get_candidate_details`

Those belong to technical or scanner-oriented analysts such as Structure or Atlas.

If Ledger references chart context at all, it should treat it as secondary timing context, not as its main basis for judgment.

## Usage Rules

1. Call `get_ledger_context` before making specific claims about:
   - business quality
   - balance sheet strength
   - dilution
   - liquidity
   - debt pressure
   - filing-note risk
2. Prefer filing-backed evidence over vendor summaries whenever coverage allows.
3. Keep tool output separate from analyst judgment.
4. State when coverage is partial, vendor-only, or otherwise limited.
5. If coverage is missing but likely fetchable, call `refresh_filing_coverage` before concluding that I have no data.
6. Use `get_social_buzz` for crowd-positioning context, but never let it override filing-backed business evidence.
7. Use `get_consumer_cycle_context` for business-cycle positioning context, especially when the user asks about slowdown exposure, cyclical demand, or defensive vs cyclical buckets.
8. Use `screen_clean_universe` when the user asks for database-wide ranking, top longs, top shorts, or best ideas from the clean universe.

## Planned Future Ledger Data Tools

These are desired future Ledger-native tools, but they are not yet the active runtime contract:

- `search_filing_chunks`
- `get_statement_facts`
- `compare_statement_periods`
- `get_recent_filings`
- `get_evidence_refs`
- `web_research_latest`
