# Ledger Canonical Fact Schema

Date: 2026-03-30  
Status: Implemented v0

## Purpose

Define the normalized filing-derived fact shape that `Ledger` and `PIT` should use for historical financial facts.

## Core Rule

Each stored row represents one atomic fact for one symbol, one period, one source document, and one availability time.

## Fact Row Fields

- `symbol`
- `fact_key`
- `value_numeric`
- `value_text`
- `value_type`
- `fact_origin`
- `unit`
- `scale`
- `currency`
- `period_type`
- `period_end`
- `fiscal_year`
- `fiscal_quarter`
- `filing_date`
- `available_at`
- `source_type`
- `source_document`
- `evidence_ref`
- `confidence`
- `source_path`

## Current v0 Decisions

- Store filing-derived statement facts in `pit_statement_facts`
- Store document metadata in `pit_documents`
- Keep raw SEC files and Docling outputs on disk
- Link fact rows back to evidence through `source_document`, file paths, and `evidence_ref`
- Use `available_at = filing_date` for the current isolated filing-ingestion path
- Treat `free_cash_flow` as `derived`; the current extracted metrics are otherwise `reported`
- Import the current isolated smoke-test set through `Financial data/docling_probe/scripts/import_smoke_test_to_pit.py`

## Current Implemented Files

- `backend/services/fundamentals_pit_store.py`
- `backend/services/fundamentals_pit_query.py`
- `Financial data/docling_probe/scripts/import_smoke_test_to_pit.py`
- `backend/data/fundamentals-pit.sqlite`

## Current Database State

The current local Ledger/PIT database path is now real, not just planned.

As of this implementation:

- Apple `5 annual + 8 quarterly` smoke-test filings were imported
- `13` documents were loaded into `pit_documents`
- `264` filing-derived fact rows were loaded into `pit_statement_facts`
- Microsoft smoke-test filings were imported as the second issuer
- `12` Microsoft documents were loaded into `pit_documents`
- `246` Microsoft filing-derived fact rows were loaded into `pit_statement_facts`
- Ledger query helpers can retrieve facts, history, latest available rows, and document evidence from PIT

## v0 Metric Set Proven by Smoke Test

- `revenue`
- `operating_income`
- `net_income`
- `current_assets`
- `current_liabilities`
- `shareholders_equity`
- `operating_cash_flow`
- `capital_expenditures`
- `free_cash_flow`

## Current Caveats

- `scale` is inferred from the Docling markdown and is not yet guaranteed across every issuer/layout
- `fiscal_quarter` is currently calendar-quarter-derived for filing-derived quarterly data
- broader unit normalization and issuer-specific fiscal-calendar handling still need refinement
- evidence references currently depend on markdown line snippets rather than stable structural IDs
- Microsoft proved the extractor can generalize beyond Apple, but one recent Microsoft `10-Q` still failed during the smoke test and should be investigated before declaring the pipeline robust
- normalization should generalize by filing family (`table_first`, `text_statement_fallback`, etc.), not by issuer-specific special cases
