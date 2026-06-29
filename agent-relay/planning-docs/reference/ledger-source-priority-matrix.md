# Ledger Source Priority Matrix

Date: 2026-04-01
Status: Active design

## Purpose

Define the canonical source-precedence rules for financial and filing data used by:

- PIT
- Ledger
- filing review workflows
- future research and backtesting consumers

This document exists to prevent source confusion.

We now have overlapping data from multiple systems:

- SEC `companyfacts`
- Docling/canonical filing extraction
- vendor PIT hydration (`Yahoo` / `Stockdex`)
- SEC submissions metadata
- filing narrative chunks

The correct design is not “pick one source for everything.”

The correct design is:

- define the data bucket
- define the best source for that bucket
- define the fallback order
- preserve provenance

## Core Rule

For every fact or evidence type:

1. prefer the highest-trust source available
2. fall back only when the preferred source is missing or unusable
3. never hide the source used
4. do not present lower-tier fallback data as if it were primary-source truth

## Trust Tiers

### Tier 1: Primary-Source Structured Filing Data

Use when available for core financial truth.

Sources:

- SEC `companyfacts`
- future raw XBRL-derived structured facts if added

Strengths:

- primary-source
- structured
- filing-backed
- strong for historical statement truth

Weaknesses:

- limited to tagged concepts
- does not capture hidden narrative risk well

### Tier 2: Filing Extraction / Evidence Layer

Use for evidence, nuance, and fallback statement recovery.

Sources:

- Docling markdown
- Docling JSON
- canonical filing extraction output
- retrieval chunks from filing narrative

Strengths:

- tied to the actual filing text
- useful for narrative and hidden-risk analysis
- useful when structured facts are incomplete

Weaknesses:

- extraction quality varies by filing layout
- more heuristic
- less clean for broad-scale statement truth than `companyfacts`

### Tier 3: Vendor PIT Hydration

Use for breadth and support data.

Sources:

- Yahoo-backed hydration
- Stockdex-backed hydration

Strengths:

- broad coverage
- good market context
- useful event support
- fast and already integrated

Weaknesses:

- not the best source of truth for statement accounting facts
- may be derived, lagged, or summarized

## Bucket Priority Rules

## 1. Statement Facts

Examples:

- revenue
- operating income
- net income
- current assets
- current liabilities
- shareholders’ equity
- operating cash flow
- capital expenditures
- free cash flow

Priority:

1. SEC `companyfacts`
2. Docling/canonical filing extraction
3. vendor PIT hydration

Reason:

- core accounting truth should be filing-backed
- `companyfacts` is the best current structured backbone
- Docling is the best current fallback/evidence layer
- vendor hydration is fallback/support, not preferred truth

Current implementation note:

- `companyfacts` now lands in `pit_statement_facts` with `source_type = sec_companyfacts_bulk`
- Docling/canonical facts also land in `pit_statement_facts` with `source_type = sec_docling_probe`
- vendor statement-like facts currently live mainly in `pit_fundamental_facts`

## 2. Market Facts

Examples:

- current price
- market cap
- enterprise value
- volume
- average volume
- beta
- ATR
- 52-week high/low
- relative volume

Priority:

1. vendor PIT hydration
2. future dedicated market-data providers if added

Reason:

- SEC filing sources are not the right primary source for live market context
- vendor hydration is the right current backbone here

## 3. Event Facts

Examples:

- earnings dates
- earnings surprise
- insider transactions
- institutional-holder snapshots
- filing events

Priority by subtype:

### Earnings / market-facing events

1. vendor PIT hydration
2. future issuer/press-release cross-checking if added

### Filing events

1. SEC submissions metadata
2. raw filing metadata from SEC fetch path

Reason:

- earnings and market events are different from statement truth
- filings should come from SEC metadata, not vendor summaries when possible

## 4. Filing Narrative / Hidden Risk

Examples:

- liquidity stress language
- debt/covenant discussion
- customer concentration
- legal/regulatory issues
- accounting-policy changes
- unusual management wording
- segment deterioration hidden in narrative

Priority:

1. raw SEC filing text + Docling chunk retrieval
2. future enhanced retrieval/ranking layers
3. vendor summaries only as low-confidence support

Reason:

- this information lives in the filing narrative, not in `companyfacts`
- vendor summaries should never be the primary source for hidden-risk judgments

## 5. Coverage / Eligibility Metadata

Examples:

- symbol universe membership
- filing eligibility
- SEC mapping
- domestic vs foreign reporting
- document availability

Priority:

1. universe registry
2. SEC submissions and eligibility mapping
3. PIT coverage counters

Reason:

- we should define who is in-scope from our own registry
- then classify what SEC-backed coverage exists for them

## Canonical Resolver Rules

Any future canonical query layer should follow these rules.

### For structured statement facts

Given a requested:

- `symbol`
- `fact_key`
- `period_end`
- `asof_date`

Resolve in this order:

1. best `sec_companyfacts_bulk` row
2. else best `sec_docling_probe` row
3. else best vendor PIT row

### For narrative evidence

Resolve in this order:

1. filing chunk retrieval
2. linked Docling evidence
3. no answer if there is no evidence

Never invent narrative support from structured facts alone.

### For market context

Resolve from vendor PIT unless a better dedicated market source is added later.

## Current Overlap Policy

We currently keep overlapping rows from multiple sources on purpose.

Why:

- validation
- fallback support
- provenance preservation

What we should **not** do:

- delete lower-priority rows blindly
- pretend overlapping rows are all equally authoritative

What we **should** do:

- keep raw source rows
- add a canonical preferred-source query layer above them

## What Ledger Should Prefer

### For financial truth

Ledger should prefer:

1. `companyfacts`
2. filing-extracted fallback
3. vendor fallback

### For hidden issues

Ledger should prefer:

1. filing narrative evidence
2. retrieved chunks
3. explicit “insufficient evidence” if no relevant narrative support exists

### For general market context

Ledger should prefer:

1. vendor PIT market layer

## What Backtests Should Prefer

### Fundamental / statement backtests

Prefer:

1. `companyfacts` / filing-backed statement facts
2. fallback to filing extraction where justified

### Price / market / event backtests

Prefer:

1. vendor PIT market/event layers

## Required Next Implementation

This matrix implies the next production tasks:

1. build a canonical statement-fact resolver
2. expose source provenance in Ledger-facing queries
3. build retrieval indexing over filing chunks
4. make Ledger combine:
   - structured statement backbone
   - narrative evidence retrieval

## Hard Rules

1. Do not present vendor statement facts as equal to filing-backed statement facts.
2. Do not use `companyfacts` as a substitute for narrative evidence.
3. Do not use retrieval text as source-of-truth for numeric facts when a structured filing-backed fact exists.
4. Always preserve source provenance.
5. Prefer lower confidence with honest provenance over a cleaner but misleading answer.
