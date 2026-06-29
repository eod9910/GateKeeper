# Ledger Coverage Tier Contract

**Status:** ACTIVE
**Created:** 2026-03-30
**Purpose:** Make scanner and Ledger universe differences explicit so symbol coverage never fails silently.

---

## Core Rule

`clean_stocks` and `ledger_filing_eligible` do not mean the same thing.

- `clean_stocks` is the broad discovery and PIT-hydration universe
- `ledger_filing_eligible` is the stricter domestic SEC filing-backed Ledger universe

This difference is intentional and must be exposed explicitly in the app and in Ledger responses.

---

## Universe Roles

### 1. `clean_stocks`

Use for:

- scanner discovery
- broad vendor-backed PIT hydration
- general tradable symbol coverage

Meaning:

- symbol is considered part of the broad clean tradable universe
- symbol may still lack domestic filing-backed Ledger depth

### 2. `ledger_filing_eligible`

Use for:

- SEC raw filing queue
- Docling filing extraction
- filing-derived PIT enrichment
- full Ledger filing-backed analysis mode

Meaning:

- symbol is in `clean_stocks`
- symbol maps cleanly to SEC identity data
- symbol shows recent domestic `10-K` / `10-Q` style reporting
- symbol is suitable for the current filing-backed Ledger path

---

## Coverage Tiers

Every Ledger symbol request should resolve to one explicit tier.

### `full_filing_supported`

Criteria:

- symbol is in `ledger_filing_eligible`
- filing-derived PIT facts and/or filing-backed evidence path are available or expected

Allowed behavior:

- full Ledger analysis
- use filing-derived evidence
- use stronger judgment modes

### `vendor_pit_only`

Criteria:

- symbol is in `clean_stocks`
- symbol is not in `ledger_filing_eligible`
- vendor-backed PIT data is available

Allowed behavior:

- limited Ledger analysis
- use vendor-backed PIT only
- explicitly state that filing-backed domestic Ledger depth is unavailable

### `foreign_reporting`

Criteria:

- symbol is tradable and in `clean_stocks`
- symbol failed `ledger_filing_eligible` because it follows foreign-reporting form families such as `20-F`, `6-K`, or `40-F`

Allowed behavior:

- limited analysis with explicit coverage warning
- no pretending that domestic `10-K` / `10-Q` support exists

### `insufficient_data`

Criteria:

- symbol lacks the minimum reliable PIT/evidence coverage needed for a serious view

Allowed behavior:

- return a constrained response
- say the evidence is insufficient

---

## Runtime Resolution Order

When Ledger receives a symbol:

1. check whether the symbol is in `clean_stocks`
2. check whether the symbol is in `ledger_filing_eligible`
3. inspect available PIT/vendor/document coverage
4. assign one explicit coverage tier
5. shape the analysis mode and confidence accordingly

Ledger must not silently fall back from filing-backed analysis to vendor-only analysis.

---

## User-Facing Rule

If a scanner candidate is outside `ledger_filing_eligible`, Ledger should still respond when possible, but it must say what mode it is using.

Required explicitness:

- whether the symbol has filing-backed Ledger support
- whether the response is vendor/PIT-only
- whether the symbol is foreign-reporting or otherwise limited

---

## Recommended Response Semantics

### For `full_filing_supported`

- "Full filing-backed analysis available."

### For `vendor_pit_only`

- "This symbol is in the clean tradable universe, but not in the domestic filing-backed Ledger universe. Analysis is limited to vendor/PIT coverage."

### For `foreign_reporting`

- "This symbol is tradable, but it does not follow the domestic `10-K` / `10-Q` path used by the current Ledger filing workflow. Analysis is limited."

### For `insufficient_data`

- "This symbol does not currently have enough reliable PIT/evidence coverage for a serious Ledger judgment."

---

## Operational Implication

Do not force scanner down to `ledger_filing_eligible`.

Instead:

- scanner remains broad
- PIT hydration remains broad
- filing-backed Ledger depth remains explicit and narrower
- coverage tier makes the difference understandable instead of surprising
