# Ledger Data Foundation and PIT Ingestion Plan

Checklist: ledger-data-foundation-and-pit-ingestion-checklist.md

**Status:** ACTIVE  
**Created:** 2026-03-30  
**Purpose:** Define the data foundation required for the `Financial Analyst Ledger` to do its job: authoritative historical facts, raw evidence lineage, isolated filing-ingestion experimentation, and the path from SEC filings into PIT.

---

## Core Statement

This workstream exists because `Ledger` cannot do serious financial analysis from loose summaries, current-only snapshots, or undocumented agent output.

`Ledger` needs:

- authoritative historical financial facts
- explicit timing semantics
- raw evidence lineage
- deterministic normalization rules
- a stable symbol source of truth

Everything in this plan should be understood as **information necessary for Ledger to do its job**.

---

## Source-of-Truth Decisions

The current ownership model is now:

- **Universe registry** owns named symbol universes
- **Scanner** observes the current market state
- **PIT** owns historical point-in-time fundamentals and supporting raw payload lineage
- **Validator / backtester** consumes PIT; it does not own historical financial truth
- **Ledger** should consume PIT facts plus evidence references, not ad hoc prose dumps

This is the required separation of concerns.

---

## What Has Been Completed

## 1. Universe centralization was pushed further toward one registry

Completed:

- added `backend/services/universe_registry.py`
- added `backend/scripts/rebuild_stock_universes.py`
- added regime universes to `backend/data/universe/registry.json`
- moved validator regime loading toward shared registry-based lookups
- moved Python-side regime and market-cap consumers toward shared helpers

Why this matters for Ledger:

- Ledger cannot reason over a changing or fragmented symbol universe foundation
- PIT hydration, validator runs, and downstream analysis all need consistent universe definitions

---

## 2. PIT was clarified as the historical source of truth

Completed:

- `backend/scripts/hydrate_fundamentals_pit.py`
  - default universe moved toward `clean_stocks`
  - added explicit `--universe`
  - fixed precedence so explicit symbol selection wins over default universe loading
- `backend/services/fundamentals_pit_store.py`
  - added append-only `raw_source_cache_history`
  - ingestion now writes latest raw snapshot and historical raw lineage
- `backend/tests/test_fundamentals_pit_store.py`
  - added verification that multiple ingests for the same symbol are retained historically

Why this matters for Ledger:

- Ledger needs point-in-time truth, not only latest values
- Ledger needs to know what data was available when
- Ledger needs evidence lineage for auditability and future trust scoring

---

## 3. Minimum viable Ledger data was clarified conceptually

Current minimum useful data categories:

- filing metadata
- income statement facts
- balance sheet facts
- cash flow facts
- capital allocation facts
- evidence links/snippets back to the raw source
- point-in-time timing fields such as `period_end`, `filing_date`, and `available_at`

Examples of the first minimum fact set already validated in the isolated probe:

- revenue / net sales
- operating income
- net income
- total current assets
- total current liabilities
- shareholders' equity
- operating cash flow
- capital expenditures
- free cash flow

Why this matters for Ledger:

- this is the smallest credible foundation for quality, durability, efficiency, and capital-allocation analysis
- without this, Ledger is just narrating current snapshots rather than performing real historical financial reasoning

---

## 4. An isolated SEC + Docling probe was built

Location:

- `Financial data/docling_probe`

Completed:

- built SEC filing fetch script
- built Docling conversion script
- built first-pass canonical fact extractor
- built one-company orchestrator pipeline
- separated outputs into:
  - raw SEC inputs
  - processed Docling outputs
  - extracted canonical facts

Validated:

- Apple `10-K` fetched successfully from SEC
- Docling produced markdown + JSON with tables preserved
- first-pass canonical extractor successfully recovered the minimum metric set above

Why this matters for Ledger:

- this proves that primary-source filing ingestion is viable
- this provides a realistic path to evidence-backed PIT enrichment
- this keeps experimentation isolated until the contract is trustworthy

---

## 5. Local Ledger/PIT database path was implemented

Completed:

- added canonical fact schema doc:
  - `.planning/plans/REFERENCE/data/ledger-canonical-fact-schema.md`
- extended `backend/services/fundamentals_pit_store.py` with:
  - `pit_documents`
  - `pit_statement_facts`
  - filing-derived canonical ingestion helpers
- extended `backend/services/fundamentals_pit_query.py` with:
  - `get_facts`
  - `get_statement_history`
  - `get_document_evidence`
  - `get_latest_available_facts`
- added isolated import bridge:
  - `Financial data/docling_probe/scripts/import_smoke_test_to_pit.py`
- loaded Apple `5 annual + 8 quarterly` filing-derived facts into:
  - `backend/data/fundamentals-pit.sqlite`

Verified:

- `13` Apple SEC filings imported
- `264` filing-derived statement fact rows imported
- query helpers successfully retrieve filing-derived facts and document evidence from the real PIT database

Why this matters for Ledger:

- Ledger now has an actual local queryable database path for filing-derived facts
- filing-derived facts are no longer only isolated JSON artifacts
- PIT now has a concrete database shape for document metadata and statement facts

---

## What Ledger Still Needs

The current probe is only a first foothold. Ledger still needs a disciplined canonical fact layer.

## 1. Canonical fact schema

Needed fields per fact family:

- `symbol`
- `source_type`
- `source_document`
- `fact_key`
- `fact_value`
- `unit`
- `scale`
- `currency`
- `period_type`
- `period_end`
- `fiscal_year`
- `fiscal_quarter`
- `filing_date`
- `available_at`
- `confidence`
- `evidence_ref`

Ledger requirement:

- facts must be queryable deterministically, not scraped from markdown on demand

Current state:

- v0 canonical fact schema now exists in `.planning/plans/REFERENCE/data/ledger-canonical-fact-schema.md`
- `pit_statement_facts` and `pit_documents` implement the first real storage shape
- the schema is usable now, but still needs refinement for broader issuer/layout coverage

---

## 2. Period and unit normalization

Still required:

- normalize annual vs quarterly periods
- normalize thousands / millions / billions scaling
- normalize currencies
- distinguish flow metrics from stock metrics
- distinguish reported values from derived values

Ledger requirement:

- comparisons across time are not trustworthy without normalized units and period semantics

Current state:

- `period_type`, `period_end`, `fiscal_year`, `fiscal_quarter`, `scale`, `currency`, `fact_origin`, and `available_at` are now stored
- `available_at = filing_date` is implemented for the current filing-ingestion path
- scale inference currently depends on Docling markdown text and needs hardening
- quarterly fiscal handling is still approximate and needs issuer-aware refinement

---

## 3. Evidence contract

Still required:

- stable evidence references from canonical facts back to:
  - raw SEC document
  - Docling markdown
  - Docling table context
  - raw vendor payload where applicable

Ledger requirement:

- every important judgment should be traceable back to raw evidence

Current state:

- fact rows now link back through `source_document`, file paths, and `evidence_ref`
- `get_document_evidence()` can retrieve document metadata plus attached fact evidence
- evidence is good enough for the Apple smoke test, but still needs a more stable contract than raw markdown line snippets

---

## 4. PIT integration strategy

Implemented decisions:

- filing-derived statement facts now live in `pit_statement_facts`
- document metadata now lives in `pit_documents`
- vendor snapshot facts remain in the existing PIT tables
- the query layer is beginning to unify those views without forcing them into one physical table immediately

Still required:

- define the long-term coexistence rules between:
  - vendor snapshot data
  - filing-derived canonical facts
  - derived metrics
- decide whether a future unified view/table should be added above the current split

Ledger requirement:

- Ledger needs one coherent historical query surface, even if the storage implementation uses multiple internal tables

---

## 5. Coverage expansion

Completed:

- Apple `5 annual + 8 quarterly` smoke test now runs end to end and imports into PIT
- Microsoft second-issuer smoke test now runs meaningfully end to end:
  - `5/5` recent `10-K`s retrieved and extracted successfully
  - `7/8` recent `10-Q`s retrieved, extracted, and imported successfully
  - one `10-Q` still failed during the smoke test and remains an open extraction/reliability follow-up

Still required:

- extend beyond Apple and Microsoft to more issuers
- evaluate extraction drift across different filing layouts
- expand beyond the current minimum metric set

Ledger requirement:

- a single-document success is encouraging, but not enough to support production analytical trust

---

## Immediate Plan

## Execution Gate

The current execution order is intentionally gated:

1. define the canonical schema strictly
2. define normalization rules hard enough for cross-issuer use
3. define a stable evidence contract
4. validate the full path on 2–3 issuers
5. only then scale ingestion across the broader canonical universe

Explicit hold:

- do **not** scale bulk filing ingestion yet
- do **not** treat broad ingestion volume as success until schema, normalization, and evidence are stable

---

## Phase 1 — Define the canonical schema (strict)

Deliverables:

- written fact schema for filing-derived fundamentals
- rules for derived-vs-reported fields
- rules for `available_at`

Success condition:

- one canonical contract exists that PIT and Ledger can both rely on

Status:

- largely completed for v0 through `.planning/plans/REFERENCE/data/ledger-canonical-fact-schema.md` and the implemented `pit_statement_facts` / `pit_documents` tables
- still needs refinement rather than first creation

---

## Phase 2 — Define normalization rules (hard)

Deliverables:

- add period/unit normalization
- produce normalized canonical payloads, not just raw extracted values
- harden fiscal-period handling across issuers/layouts
- make normalization rules deterministic enough that repeated runs should produce the same canonical rows

Success condition:

- the isolated probe can produce consistent normalized payloads across multiple filings

Status:

- partially completed
- still needs hardening before scale-out is allowed

---

## Phase 3 — Define the evidence contract (stable)

Deliverables:

- stable evidence references from canonical facts back to the source document
- stable links into Docling output / table context / raw filing paths
- evidence payload rules strong enough for Ledger drill-down and auditability

Success condition:

- Ledger can trace important claims back to stable evidence without relying on fragile markdown-line snippets

Status:

- partially completed
- current evidence references are usable for the probe but not yet stable enough for scale ingestion

---

## Phase 4 — Validate on 2–3 issuers

Deliverables:

- run the strict schema + hard normalization + stable evidence contract on 2–3 issuers
- confirm results survive different filing layouts and forms
- explicitly review misses, drift, and weak evidence cases before broad rollout

Success condition:

- the path is trusted across a small but real issuer set before the queue is widened

Status:

- Apple and Microsoft provide the first two issuers
- one more issuer-level validation pass is still needed after the tighter contract work above

---

## Phase 5 — Scale ingestion

Deliverables:

- widen ingestion across the broader canonical universe
- add coverage tracking / queue management
- preserve rate-limit safety and issuer-level observability during rollout

Success condition:

- scale happens only after the contract work is stable enough that broader ingestion produces trustworthy data

Status:

- intentionally blocked behind Phases 1–4

---

## Phase 6 — Ledger query model

Deliverables:

- define what Ledger queries actually need:
  - trend over time
  - historical snapshots
  - evidence drill-down
  - derived business-quality metrics
- define the minimum query helpers Ledger should get from PIT

Success condition:

- Ledger can answer financial questions without re-parsing documents or inventing unsupported claims

Status:

- first helper layer exists
- next step is expanding the query surface into actual Ledger-facing workflows

---

## Non-Negotiable Rules

1. `Ledger` must not rely on undocumented agent-collected blobs as its primary source of truth.
2. Historical financial reasoning must be based on point-in-time data with explicit timing semantics.
3. Raw lineage must be preserved.
4. Filing ingestion remains isolated until normalization quality is good enough to merge.
5. Vendor data and filing data must converge into one coherent historical interface, even if their ingestion paths differ.

---

## Current Assessment

What is true now:

- the architectural direction is clearer than before
- PIT ownership is better defined
- universe centralization is materially improved
- primary-source filing ingestion is now proven viable in an isolated probe
- a local SQLite/PIT Ledger database path now exists
- canonical filing-derived facts are now inserted into PIT for Apple
- canonical filing-derived facts are now also inserted into PIT for Microsoft
- document evidence lookup is now implemented

What is not true yet:

- the canonical fact contract is still v0 rather than fully hardened
- evidence references are not yet fully standardized across issuers/layouts
- multi-company extraction reliability is improved but not yet fully proven
- broader metric coverage is not yet implemented

---

## Primary Next Step

The next highest-value move is:

**tighten the contract first: strict canonical schema, hard normalization rules, and a stable evidence contract — then validate on a third issuer before any scale-ingestion push.**
