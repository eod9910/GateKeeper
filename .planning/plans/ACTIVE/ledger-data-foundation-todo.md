# Ledger Data Foundation TODO

**Status:** ACTIVE  
**Created:** 2026-03-30  
**Purpose:** Compact execution checklist for the Ledger / PIT / SEC filing ingestion workstream.

Related docs:

- `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- `.planning/plans/ACTIVE/primitive-normalization-contract-v0.md`
- `.planning/plans/ACTIVE/primitive-normalization-engine-and-autonomous-research.md`
- `.planning/plans/ACTIVE/family-structure-validation-ledger.md`
- `Financial data/docling_probe/README.md`

---

## Completed

- [x] Clarify ownership: universe registry vs scanner vs PIT vs validator vs Ledger
- [x] Centralize remaining universe consumers toward shared registry loaders
- [x] Add `backend/services/universe_registry.py`
- [x] Add `backend/scripts/rebuild_stock_universes.py`
- [x] Move PIT hydration defaults toward full-universe semantics
- [x] Add PIT raw lineage retention via `raw_source_cache_history`
- [x] Verify PIT raw-history behavior with tests
- [x] Build isolated SEC + Docling probe under `Financial data/docling_probe`
- [x] Fetch one SEC filing successfully
- [x] Convert one filing with Docling successfully
- [x] Extract first-pass canonical facts from one filing successfully
- [x] Update memory bank and planning docs with this workstream

---

## Immediate Next Tasks

- [x] Freeze the canonical Ledger fact schema
- [x] Define the evidence reference contract from canonical facts back to raw sources
- [x] Define period normalization rules (`annual`, `quarterly`, trailing/derived if added)
- [x] Define unit/scale normalization rules (`raw`, `thousands`, `millions`, `billions`) at v0 level
- [x] Define `available_at` rules for filing-derived facts at v0 level
- [x] Decide how filing-derived facts map into PIT storage
- [x] Decide coexistence rules between vendor facts and filing-derived facts at v0 level

Notes:

- v0 canonical schema lives in `docs/ledger-canonical-fact-schema.md`
- filing-derived facts now live in `pit_statement_facts`
- document metadata now lives in `pit_documents`
- Apple `5 annual + 8 quarterly` filing-derived data has been loaded into `backend/data/fundamentals-pit.sqlite`

---

## Probe Expansion Tasks

- [ ] Expand the extractor beyond the current minimum metric set
- [x] Test the probe on at least one additional large-cap issuer
- [x] Test the probe on at least one `10-Q`
- [ ] Measure extraction consistency across multiple filing layouts
- [ ] Add explicit validation checks for missing/misaligned table values
- [~] Preserve stable evidence snippets/refs for each extracted fact
- [x] Produce PIT-ready normalized payloads from the isolated probe

Notes:

- Apple smoke test successfully processed `5` recent `10-K`s and `8` recent `10-Q`s
- Microsoft smoke test now successfully processes `5/5` recent `10-K`s and `8/8` recent `10-Q`s
- the prior Microsoft miss was traced to a transient SEC disconnect on accession `0000950170-23-054855`
- current evidence refs work, but are still markdown-line-based and need stronger structural IDs later

---

## PIT Integration Tasks

- [x] Define canonical PIT row shape for filing-derived facts
- [x] Decide whether filing facts use the existing PIT table, a sibling table, or a shared interface over both
- [x] Add insertion path from normalized filing payload into PIT
- [x] Preserve source-document lineage and dedupe behavior during PIT writes
- [x] Add query support for filing-derived facts by `symbol` and `asof_date`
- [~] Verify no lookahead leakage in filing-derived `available_at` handling

Notes:

- filing facts currently use sibling tables: `pit_statement_facts` and `pit_documents`
- query helpers now exist in `backend/services/fundamentals_pit_query.py`
- current `available_at = filing_date` rule is intentional for v0 but still needs deeper validation across issuers/forms

---

## Ledger-Specific Tasks

- [x] Define the minimum query set Ledger needs from PIT at v0 level
- [x] Define which metrics are reported facts vs derived metrics at v0 level
- [ ] Define which judgments Ledger is allowed to make directly from facts
- [ ] Define which judgments require evidence drill-down
- [x] Add confidence / provenance fields that help Ledger avoid overclaiming at v0 level

Notes:

- implemented v0 query helpers:
  - `get_facts`
  - `get_statement_history`
  - `get_document_evidence`
  - `get_latest_available_facts`
- current v0 derived metric distinction includes `free_cash_flow`

---

## Nice-to-Have After Core Contract

- [ ] Add segment revenue / geography extraction
- [ ] Add debt / share-count / buyback extraction
- [ ] Add multi-period trend helpers for Ledger
- [ ] Add issuer coverage tracking so we know which symbols have filing-derived depth

---

## Current Recommended Order

1. Define the canonical schema strictly
2. Define normalization rules hard enough for cross-issuer use
3. Define a stable evidence contract
4. Validate the path on 2–3 issuers
5. Only then scale ingestion

Operational hold until the above gates are complete:

- do not start broad bulk normalization rollout
- do not widen the ingestion queue just because the downloads exist
- do not treat ingestion volume as progress unless the contract is stable
