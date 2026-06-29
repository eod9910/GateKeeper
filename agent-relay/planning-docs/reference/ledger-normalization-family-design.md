# Ledger Normalization Family Design

Date: 2026-03-30
Status: Active design guardrail

## Purpose

Prevent the filing-ingestion pipeline from degrading into issuer-specific extractors.

The normalization engine must generalize by recurring filing shape, not by company name.

## Core Rule

We normalize by `document family`, not by `issuer`.

That means:

- one canonical fact schema
- one normalization engine
- a small number of reusable extraction strategies
- conservative fallback when exact structure is not trustworthy

That does **not** mean:

- `if company == X` special cases
- issuer-named normalizers
- one-off date or label hacks that only work for a single company

## Current Family Model

The current v1 family split is:

1. `table_first`
   - For filings where Docling preserves usable financial tables.
   - Example validation issuers: `AAPL`, `MSFT`

2. `text_statement_fallback`
   - For filings where statement rows are flattened into ordered text but still recoverable.
   - Example validation issuers: `HSIC`, `LESAKA`

3. `conservative_inferred_periods`
   - For filings where values are recoverable but exact prior-period dates are not yet provably recoverable from local context.
   - This is acceptable as an intermediate state.

Possible future family:

4. `xbrl_assisted_fallback`
   - Only if raw text/table structure is too weak and structured SEC/XBRL metadata can safely assist period alignment.

## Rule Admission Standard

A new normalization rule should only be promoted if at least one of these is true:

- it works across at least `2` issuers with the same filing shape
- it matches a recurring statement pattern that is clearly generic
- it is required to preserve a canonical accounting concept already in the v0 metric set

A new rule should **not** be promoted if:

- it is justified by a single issuer only
- it depends on issuer name, ticker, or CIK
- it relies on arbitrary nearby text that is not statement-header context
- it improves one metric while silently breaking another

## Implementation Constraints

Every normalization rule should satisfy these constraints:

- issuer-agnostic
- deterministic
- local to the statement section being parsed
- compatible with the canonical fact schema
- able to fail conservatively instead of inventing precision

Preferred behavior:

- recover exact dates only from real statement-header context
- otherwise keep prior periods as inferred placeholders
- preserve evidence snippets for every extracted metric

## Validation Panel

Every new rule should be checked against a mixed panel, not just the triggering issuer.

Current validation panel:

- `AAPL`
  - clean table-heavy issuer
- `MSFT`
  - second table-heavy issuer
- `HSIC`
  - flattened text statement issuer
- `LESAKA`
  - zero-table fallback issuer with more ambiguous local date context

Minimum acceptance bar for a new rule:

- no regression on `AAPL`
- no regression on `MSFT`
- improved recovery on at least one messy issuer
- no false exact-date assignment where only inferred periods are justified

## Promotion Checklist

Before keeping a new fallback rule:

1. Identify the filing family the rule is supposed to solve.
2. Name the rule by pattern, not by issuer.
3. Validate it on at least one clean-table and one messy-text issuer.
4. Confirm period alignment, sign handling, and free-cash-flow derivation remain correct.
5. If exact dates cannot be proven, keep inferred labels.
6. Record the rule and the validation panel result in planning docs or memory.

## Current Working Interpretation

The current extractor still appears to be family-based, not issuer-specific:

- `AAPL` remains on the table-first path
- `HSIC` proves the text fallback can recover the full minimum metric set
- `LESAKA` proves the fallback must stay conservative on prior-period dates when the local context is weaker

That is acceptable.

The line we should not cross is introducing issuer-conditioned logic to force exact dates or labels for one company.

## Immediate Next Step

Continue improving period parsing only when the new rule can be explained as one of:

- better table-header recovery
- better text-statement header recovery
- better statement-block alignment

If the only justification is "it fixes issuer X", the rule should stay out.
