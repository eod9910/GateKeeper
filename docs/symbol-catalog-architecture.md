# Symbol Catalog Architecture

## Purpose

This document defines the target organization for symbol-level data in this repo.

The goal is to stop treating symbol universes as scattered JSON lists and instead
maintain one queryable symbol catalog with normalized memberships and metrics.

This catalog is designed for questions like:

- show me `stocks` that are `optionable`
- show me `undervalued` stocks from the DCF model
- show me `overvalued` names in `markdown`
- show me `sp500` symbols that are also `ledger_filing_eligible`

## Database

The catalog lives in:

- `backend/data/symbol-catalog.sqlite`

It is separate from:

- `app-state.sqlite` for app state
- `fundamentals-pit.sqlite` for PIT financial facts

## Core Design

The catalog uses one master table plus sub-tables.

### 1. `symbols`

One row per tradable symbol.

Fields include:

- `symbol`
- `asset_class`
- `name`
- `exchange`
- `sector`
- `industry`
- `active`
- `optionable`
- `cik`
- `sec_name`
- `sec_exchange`
- `has_sec_mapping`
- `company_type`
- `valuation_engine_class`
- `classification_source`
- `classification_confidence`
- `last_classified_at`

This is the master identity table.

### 2. `symbol_memberships`

One row per symbol-to-bucket relationship.

Examples:

- `('AAPL', 'index_membership', 'sp500')`
- `('CURI', 'valuation_regime', 'overvalued')`
- `('NVDA', 'technical_regime', 'expansion')`
- `('AA', 'validation_tier', 'tier1b')`

This is the main filtering layer.

### 3. `symbol_metrics`

One row per symbol-level metric.

Examples:

- `market_cap`
- `bars`
- future derived ranking values

Use this for values that are numeric or text metrics, not memberships.

## Why This Shape

Do not create one giant everything-table.

That makes it harder to:

- add new regime families
- support overlapping universes
- support multiple snapshots or sources
- query cleanly across categories

The normalized shape is better:

- `symbols` = identity
- `symbol_memberships` = buckets, universes, regimes, tags
- `symbol_metrics` = numbers and measured values

## Membership Types

Current first-pass membership families:

- `universe`
- `index_membership`
- `validation_tier`
- `valuation_regime`
- `valuation_sample`
- `technical_regime`
- `cap_tier`
- `market_cap_bucket`
- `listing_quality`
- `reporting_profile`
- `instrument_quality`
- `eligibility`
- `company_type`
- `valuation_engine_class`

## Valuation Classification

The symbol catalog is also the canonical home for valuation-routing metadata.

That means Ledger should not keep re-guessing company type forever from raw snapshot
fields. Instead:

- `symbols.company_type` stores what kind of company this is
- `symbols.valuation_engine_class` stores which valuation engine to use
- `classification_source` tells us whether this came from rule-based inference,
  manual override, or a future enrichment pipeline

Current intended engine classes:

- `dcf_operating`
- `roe_book_value`
- `reit_affo`
- `sales_scenario`

Current intended company types:

- `operating_company`
- `financial_company`
- `reit`
- `preprofit_growth`
- `unknown`

More can be added later without changing the master table.

Current enrichment flow:

- Ledger can infer classification from the fundamentals snapshot when it analyzes a symbol.
- That inferred classification is persisted back into `symbol-catalog.sqlite`.
- `backend/scripts/backfill_symbol_classifications.py` can bulk-seed the tradable stock universe so filtering does not depend on prior Ledger chats.

## Default Tradable Subset

The master catalog is intentionally broad and includes symbols we know about.
It should not be used as the default scanner/trading universe.

The current default stock-eligibility bucket is:

- `eligibility = tradable_stock_default`

This tag is derived from the clean universe plus:

- SEC mapping present
- core US exchange listing
- not foreign-reporting-only
- not obviously a non-common-equity instrument name like ETF/fund/note/warrant/unit

## Example Query

Undervalued optionable stocks:

```sql
SELECT s.symbol, s.name
FROM symbols s
JOIN symbol_memberships m
  ON m.symbol = s.symbol
WHERE s.asset_class = 'stocks'
  AND s.optionable = 1
  AND m.membership_type = 'valuation_regime'
  AND m.membership_value = 'undervalued'
ORDER BY s.symbol;
```

Overvalued stocks in markdown:

```sql
SELECT DISTINCT s.symbol
FROM symbols s
JOIN symbol_memberships v
  ON v.symbol = s.symbol
JOIN symbol_memberships r
  ON r.symbol = s.symbol
WHERE s.asset_class = 'stocks'
  AND v.membership_type = 'valuation_regime'
  AND v.membership_value = 'overvalued'
  AND r.membership_type = 'technical_regime'
  AND r.membership_value = 'markdown';
```

## Build Source

The initial catalog is rebuilt from current source files:

- `backend/data/universe_clean.json`
- `backend/data/universe/optionable.json`
- `backend/data/universe/registry.json`
- `backend/data/regime_snapshot.json`

The rebuild script is:

- `backend/scripts/rebuild_symbol_catalog.py`

## Transition Plan

Phase 1:

- build and populate the catalog
- prove that the schema supports the intersections we need

Phase 2:

- add backend query helpers
- use catalog queries in validator/scanner/universe filtering paths

Phase 3:

- reduce dependence on scattered file-based universe intersections

## Rule Of Thumb

If a symbol property or grouping needs to be:

- filtered
- joined
- intersected
- updated incrementally
- queried repeatedly

it belongs in the symbol catalog, not as another isolated JSON list.
