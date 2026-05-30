# SEC EDGAR Filings Integration — PRD

**Created:** 2026-04-29
**Updated:** 2026-04-29
**Status:** IN PROGRESS
**Scope:** Integrate SEC EDGAR filing data (Form 4 insider transactions, SC 13D/13G activist stakes) into Pattern Detector as a new institutional data pipeline, providing near-real-time signals on insider buying/selling and activist investor positioning.

---

## Mission

> **Add institutional money-movement detection to the existing sensor array so that insider buying clusters, insider selling patterns, and activist stake disclosures are captured automatically and available for cross-referencing with social buzz, DCF valuations, and technical signals.**

SEC filings represent the highest-fidelity signal source available — these are legally mandated disclosures of real money movement by people with material non-public information access. Unlike social sentiment (noisy, easily gamed), EDGAR data is:
- **Legally required** — filers face SEC enforcement for late or inaccurate filings
- **Structured XML/JSON** — machine-parseable, no NLP needed
- **Free and unlimited** — 10 req/sec, no API key, no daily cap
- **Near-real-time** — Form 4 filings appear within seconds of submission

---

## Decisions

| # | Topic | Commitment |
|---|-------|------------|
| D1 | Filing types — Phase 1 | **Form 4** (insider transactions) and **SC 13D / SC 13D/A** (activist stakes ≥5%). These are near-real-time filings with the highest signal value. |
| D2 | Filing types — Phase 2 (future) | **13F** (quarterly institutional holdings). Deferred because it's a quarterly batch job with 45-day delay — lower urgency. |
| D3 | Data source | SEC's free EDGAR APIs: `efts.sec.gov` (full-text search / filing index) for polling recent filings, `data.sec.gov/submissions/` for company filing history, `sec.gov/files/company_tickers.json` for ticker-to-CIK mapping. No paid third-party API. |
| D4 | Storage | New `edgar-filings.sqlite` database in `backend/data/`. Separate from social-intelligence.sqlite because the data semantics are fundamentally different (regulatory disclosure vs. social chatter). |
| D5 | Collection strategy | Poll EFTS for Form 4 and SC 13D filings from the last N hours (configurable). Parse the filing XML/metadata to extract structured transaction data. Filter to symbols in our clean universe. |
| D6 | Ticker-to-CIK mapping | Download `company_tickers.json` once per day, cache locally at `backend/data/company_tickers.json`. Build a bidirectional ticker↔CIK lookup. |
| D7 | Form 4 parsing | Form 4 filings contain structured XML at a predictable URL pattern: `https://www.sec.gov/Archives/edgar/data/{CIK}/{accession}/`. The ownership XML contains issuer, reporting owner, and transaction details. We parse transaction type (P=Purchase, S=Sale), shares, price, and ownership relationship. |
| D8 | Architecture constraint | Follows the same scheduler pattern as social intelligence: Python collector script + TypeScript scheduler service + Express API routes + Settings UI. |
| D9 | Rate limiting | Target 5 req/sec to stay well under SEC's 10 req/sec limit. 200ms delay between requests. User-Agent header: `PatternDetector/1.0 (edgar-filings-collector)`. |
| D10 | Scheduling | Configurable: manual, hourly, every 4 hours, or daily. Default: manual. Runs during market hours make the most sense since filings cluster around market close. |
| D11 | Alert generation | The collector flags notable filings: cluster insider buying (≥3 insiders buying same stock within 14 days), large purchases (≥$1M), C-suite transactions, new 13D stakes. Alerts stored in `filing_alerts` table. |
| D12 | Universe filtering | Only track filings for symbols in our clean universe (from `universe_clean.json`). Ignore filings for companies we don't track. |
| D13 | LLM cost | Zero. All collection, parsing, and alert generation is deterministic. |

---

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  EDGAR Filings Pipeline (deterministic, zero LLM cost)          │
  │                                                                 │
  │  ┌─────────────────┐  poll every N hrs  ┌────────────────────┐ │
  │  │ EFTS API         │ ──────────────►   │ Collector Script   │ │
  │  │ (Form 4, 13D)    │                   │ (Python)           │ │
  │  └─────────────────┘                    └────────┬───────────┘ │
  │                                                  │             │
  │  ┌─────────────────┐  ticker lookup    ┌────────▼───────────┐ │
  │  │ company_tickers  │ ◄───────────────  │ Parse XML/JSON     │ │
  │  │ .json (cached)   │                   │ Extract transactions│ │
  │  └─────────────────┘                    └────────┬───────────┘ │
  │                                                  │             │
  │                                         ┌────────▼───────────┐ │
  │                                         │ edgar-filings.sqlite│ │
  │                                         │ • insider_txns      │ │
  │                                         │ • activist_stakes   │ │
  │                                         │ • filing_alerts     │ │
  │                                         │ • edgar_fetch_runs  │ │
  │                                         └────────────────────┘ │
  └─────────────────────────────────────────────────────────────────┘
```

### Database Schema

**`insider_transactions`** — Form 4 parsed data
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | Ticker symbol |
| cik | TEXT | Company CIK |
| filing_date | TEXT | Date filed with SEC |
| accession_number | TEXT | Unique filing identifier |
| insider_name | TEXT | Reporting person name |
| insider_title | TEXT | Relationship to issuer (CEO, CFO, Director, 10% Owner, etc.) |
| transaction_type | TEXT | P (Purchase), S (Sale), A (Award/Grant), etc. |
| transaction_date | TEXT | Date of transaction |
| shares | REAL | Number of shares transacted |
| price_per_share | REAL | Price per share (null for grants) |
| total_value | REAL | shares * price_per_share |
| shares_owned_after | REAL | Total shares held post-transaction |
| is_direct | INTEGER | 1 = direct ownership, 0 = indirect |
| filing_url | TEXT | URL to the filing on EDGAR |
| created_at | TEXT | When we ingested this record |

**`activist_stakes`** — SC 13D/13G parsed data
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | Target company ticker |
| cik | TEXT | Target company CIK |
| filing_date | TEXT | Date filed with SEC |
| accession_number | TEXT | Unique filing identifier |
| filer_name | TEXT | Activist/fund name |
| filer_cik | TEXT | Filer CIK |
| form_type | TEXT | SC 13D, SC 13D/A, SC 13G, SC 13G/A |
| percent_owned | REAL | Percentage of outstanding shares |
| shares_held | REAL | Total shares held |
| filing_url | TEXT | URL to the filing on EDGAR |
| created_at | TEXT | When we ingested this record |

**`filing_alerts`** — Notable events detected
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | Ticker |
| alert_type | TEXT | cluster_buying, large_purchase, csuite_purchase, new_13d, etc. |
| severity | TEXT | info, notable, critical |
| headline | TEXT | Human-readable summary |
| details_json | TEXT | Structured context |
| filing_date | TEXT | Date of the triggering filing |
| created_at | TEXT | When alert was generated |

**`edgar_fetch_runs`** — Collection run tracking
| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT PK | UUID |
| started_at | TEXT | ISO timestamp |
| completed_at | TEXT | ISO timestamp |
| status | TEXT | running, completed, failed |
| form_types_polled | TEXT | Comma-separated form types |
| filings_found | INTEGER | Total filings returned by EFTS |
| filings_in_universe | INTEGER | Filings matching our universe |
| transactions_inserted | INTEGER | New transactions stored |
| alerts_generated | INTEGER | New alerts created |
| notes_json | TEXT | Additional run metadata |

---

## Phase 2 — 13F Institutional Holdings (Future)

Quarterly batch job to download 13F filings and build a "smart money consensus" signal:
- Which top funds hold a position
- Who's adding vs. reducing
- Crowded trades (many funds holding same stock)
- New positions from known successful managers

This is deferred because 13F data is inherently delayed (45 days) and quarterly — the daily Form 4 + 13D pipeline provides much more actionable, timely signals.

---

## Phase 3 — Cross-Signal Integration (Future)

Wire EDGAR signals into the Ledger agent context and the Market Intelligence conviction layer:
- Insider buying cluster + social buzz spike + DCF undervalued = high-conviction long signal
- Insider selling cluster + overvalued DCF + negative sentiment = risk flag
- New 13D filing + price breakout = momentum + catalyst confirmation
