# Financial Data Contract

## Purpose

This file defines the app-facing data contract between the Pattern Detector runtime and the `Financial Analyst Workspace` (`Ledger`).

It is intentionally higher-level than the PIT canonical fact schema.

The PIT schema defines how facts are stored.
This contract defines what the analyst should receive and what it should return.

---

## Input Contract

When the app asks the Financial Analyst workspace to analyze a company, it should provide one structured payload with these sections.

### 1. Request Metadata

- `request_id`
- `requested_at`
- `symbol`
- `company_name`
- `analysis_mode`
- `asof_date`

### 2. Coverage Metadata

- `data_coverage.coverage_tier`
- `data_coverage.vendor_pit_available`
- `data_coverage.filing_pit_available`
- `data_coverage.document_count`
- `data_coverage.statement_fact_count`
- `data_coverage.coverage_notes`

Allowed `coverage_tier` values at v0:

- `full_filing_supported`
- `vendor_pit_only`
- `foreign_reporting`
- `insufficient_data`

### 3. Point-in-Time Financial Facts

- `latest_available_facts`
  - flat fact set available as of `asof_date`
- `statement_history`
  - multi-period statement facts by period
- `market_context`
  - market facts that are explicitly allowed to inform analysis
- `events`
  - earnings and other relevant PIT event rows if included

### 4. Evidence Context

- `documents`
  - filing metadata
  - source type
  - filing date
  - report date
  - document identifiers
- `evidence`
  - evidence references attached to important facts
- `provenance`
  - source type
  - confidence
  - reported vs derived distinction

### 5. Analyst Guardrails

- `allowed_inference_scope`
  - what the analyst may conclude directly from facts
- `required_evidence_scope`
  - what requires evidence drill-down before claiming
- `known_data_limits`
  - missing periods
  - uncertain units/scales
  - unresolved normalization caveats

---

## Output Contract

The Financial Analyst workspace should return one structured analysis result.

### 1. Result Metadata

- `request_id`
- `symbol`
- `asof_date`
- `generated_at`
- `coverage_tier`
- `confidence_level`
- `coverage_assessment`

### 2. Analysis Sections

- `business_summary`
- `financial_quality`
- `financial_risk`
- `competitive_advantage`
- `capital_allocation`
- `valuation_method`
- `intrinsic_value_conclusion`
- `price_vs_value_judgment`
- `main_risks`
- `what_would_change_the_view`

### 3. Evidence and Traceability

- `key_supporting_facts`
  - fact keys used in the judgment
- `key_evidence_refs`
  - evidence references used in the judgment
- `derived_claims`
  - explicit list of claims that go beyond directly reported facts

### 4. Limits

- `insufficient_evidence_areas`
- `open_questions`
- `normalization_warnings`

---

## Hard Rules

1. The analyst must distinguish reported facts from derived interpretation.
2. The analyst must not claim historical knowledge beyond `asof_date`.
3. The analyst must not treat missing data as neutral unless that is stated explicitly.
4. The analyst must expose low-confidence and insufficient-evidence states directly.
5. The analyst should prefer filing-derived evidence when available over vendor-only summaries.
6. The analyst must not present vendor-only coverage as if it were filing-backed coverage.

---

## Relationship To Other Docs

- low-level storage contract: `docs/ledger-canonical-fact-schema.md`
- active execution order: `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
- recovery plan: `.planning/plans/ACTIVE/repo-state-recovery-and-guardrails-plan.md`
- coverage-tier policy: `.planning/plans/ACTIVE/ledger-coverage-tier-contract.md`
- storage/retrieval architecture: `.planning/plans/ACTIVE/ledger-data-storage-and-retrieval-architecture.md`
