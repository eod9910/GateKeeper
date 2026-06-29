# Ledger Data Storage And Retrieval Architecture

Date: 2026-03-31
Status: Active design

## Purpose

Define where different kinds of financial and filing data should live so `Ledger` can move beyond surface-level ratios and reason over both structured facts and hidden filing context.

## Core Principle

Not all downloaded data belongs in the same storage system.

The system should separate:

- structured fact truth
- raw document provenance
- narrative retrieval
- derived Ledger judgments

## Desired Outcome

`Ledger` should be able to answer:

- what do the numbers say?
- what changed?
- what is hidden in the notes or narrative?
- what looks risky, contradictory, or understated?

That requires both:

- a strong structured fact backbone
- searchable filing text and evidence

## Recommended Storage Model

### 1. PIT / Relational Database = Source Of Truth

Use PIT/SQLite/relational storage for:

- filing-derived canonical facts
- vendor-backed PIT facts
- document metadata
- derived risk signals
- coverage status
- evidence references

This is the authoritative store for:

- point-in-time historical facts
- `available_at` semantics
- fact provenance
- app-facing Ledger queries

### 2. Raw Files On Disk = Provenance Layer

Keep raw files on disk for:

- SEC filing HTML
- Docling JSON
- Docling markdown
- extracted canonical JSON artifacts

These files are the durable audit trail.

They should not be the primary query surface for Ledger, but they must remain available for:

- evidence drill-down
- reruns
- debugging
- future extractor improvements

### 3. RAG / Vector Retrieval = Narrative Layer

Use a retrieval layer for:

- MD&A
- footnotes
- debt and covenant language
- liquidity discussion
- customer concentration
- legal/regulatory issues
- accounting-policy changes
- unusual risk disclosures

This layer should be built from filing text chunks, not from canonical fact rows.

Purpose:

- help Ledger find relevant narrative evidence quickly
- support "what changed?" and "what looks wrong?" style questions
- surface hidden context that structured XBRL facts do not capture well

### 4. Optional Graph Layer = Future Relationship Layer

Do **not** make graph storage the first answer for filing ingestion.

A graph may become useful later for relationships like:

- company -> debt facility -> covenant
- company -> segment -> margin decline
- company -> customer concentration -> risk

But it is not required for the first useful Ledger system.

## Recommended Data Assignment

### Structured Backbone

Primary source:

- `companyfacts`
- filing-derived XBRL facts

Store in:

- `pit_statement_facts`
- related PIT metadata tables

Use for:

- revenue
- operating income
- net income
- current assets/liabilities
- equity
- operating cash flow
- capex
- derived free cash flow

### Narrative And Evidence

Primary source:

- raw SEC filings
- Docling markdown/JSON

Store as:

- raw files on disk
- chunk metadata and embeddings in a retrieval index
- references back into PIT evidence records

Use for:

- nuance
- hidden risk
- management wording
- note disclosures
- contradiction detection

## Retrieval Flow For Ledger

For a full filing-supported symbol:

1. query PIT for structured statement facts
2. retrieve latest `10-K` and recent `10-Q` metadata
3. query the filing-text retrieval layer for relevant chunks
4. attach evidence refs back to documents and chunks
5. let Ledger synthesize facts plus narrative evidence

For a vendor/PIT-only symbol:

1. query PIT vendor-backed facts
2. skip filing-text retrieval
3. downgrade analysis mode and confidence explicitly

## What Should Not Happen

Do not:

- put all filing intelligence into the vector store
- treat RAG as source-of-truth for numeric facts
- force every filing artifact into a graph database first
- make Docling text the only truth source for statement numbers

## Recommended First Production Architecture

### Facts

- `companyfacts` first
- current/future canonical PIT rows as the normalized interface

### Evidence

- Docling and raw filing text second
- chunked for retrieval over notes and MD&A

### Ledger

- facts from PIT
- evidence from retrieval
- judgments with explicit provenance and confidence

## First Useful Ledger Outputs

This design supports:

- "core financial health"
- "what changed versus the prior filing"
- "what management is not emphasizing"
- "hidden risks in the latest filing"
- "numbers versus narrative contradictions"

## Immediate Next Step

Define the first Ledger filing-review checklist and map each review item to:

- PIT facts
- filing sections/chunks
- expected evidence refs
- allowed judgment output
