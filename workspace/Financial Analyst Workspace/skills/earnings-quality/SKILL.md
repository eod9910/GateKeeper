# Earnings Quality

## Purpose

Judge whether reported earnings reflect durable economic reality.

This skill should normally be entered through the `run_earnings_quality` tool.

## Reference Set

Primary references for this skill:

- `../../references/CFA Prerequisite 2024 - Volume 3 - Financial Statement Analysis.pdf`
  Use for statement analysis, accounting interpretation, and cross-statement consistency checks.
- `../../references/finstatement.pdf`
  Use for economic adjustments to reported numbers, especially leases, R&D, and classification distortions.

## Workflow

1. Compare net income with operating cash flow.
2. Compare operating cash flow with free cash flow after capex.
3. Check whether reinvestment burden is temporarily suppressing true owner cash flow or masking weak economics.
4. Look for likely distortion zones:
   - stock-based compensation and dilution
   - lease obligations
   - one-time gains or losses
   - aggressive revenue recognition
   - goodwill and impairment issues
5. Distinguish:
   - reported earnings
   - cash reality
   - unresolved note-level uncertainty

## Hard Rules

1. Do not treat accounting earnings as final truth.
2. Prefer cash conversion evidence over management framing.
3. If key note-level evidence is missing, say so directly.
4. Separate clear evidence from suspicion.

## Output Contract

Return:

- cash_conversion
- accounting_distortions
- dilution_and_capital_structure
- balance_sheet_pressure
- earnings_quality_judgment
- key_evidence_refs
- confidence_level
