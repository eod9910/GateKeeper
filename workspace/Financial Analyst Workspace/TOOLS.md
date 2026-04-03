# Financial Analyst Workspace Tools

## Default Tool Inventory

Ledger's active runtime tools are:

- `get_ledger_context`
- `run_financial_analysis`
- `run_earnings_quality`
- `run_dcf_valuation`

### 1. `get_ledger_context`

Use it to retrieve the current company-analysis bundle for the active symbol, including:

- filing-backed statement facts
- recent SEC document metadata
- retrieved filing-note evidence
- coverage tier and provenance-aware snapshot context

### 2. `run_financial_analysis`

Use this when the user wants a full company read.

This tool should be treated as the runtime entrypoint for the `financial-analysis` skill.

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

This tool should be treated as the runtime entrypoint for the `dcf-valuation` skill.

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

## Planned Future Ledger Data Tools

These are desired future Ledger-native tools, but they are not yet the active runtime contract:

- `search_filing_chunks`
- `get_statement_facts`
- `compare_statement_periods`
- `get_recent_filings`
- `get_evidence_refs`
- `web_research_latest`
