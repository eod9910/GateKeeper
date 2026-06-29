# SEC EDGAR Filings Integration â€” Build Checklist

Percent complete: 68% (13 complete, 0 partial, 6 remaining)

PRD: edgar-filings-prd.md

Living tracker for the EDGAR Filings Integration PRD.

> **Companion to:** [`edgar-filings-prd.md`](./edgar-filings-prd.md)
> **Update protocol:** Tick a box only when the deliverable is **shipped + verified**, not when the code is written.

---

## Status legend

- âœ… Done and verified
- ðŸŸ¡ Partial
- ðŸ”µ In progress this session
- âŒ Not started

---

## Snapshot â€” last verified 2026-04-29

**HEAD:** Phase 1 code complete, verified with live data
**New files:** 4 of 4 (collector, scheduler, routes, settings UI)
**Insider transactions stored:** 811 (from first 24h collection)
**Activist stakes stored:** 0 (none filed today â€” normal)
**Alerts generated:** 16 (all C-suite/Director purchases)
**Filing fetch runs:** 3 (1 dry-run, 2 live)

---

## Phase 1 â€” Form 4 + SC 13D Collector âœ… complete

### Infrastructure

- [x] **`backend/scripts/collect_edgar_filings.py`** â€” Main collector script
  - Downloads and caches `company_tickers.json` for ticker-to-CIK mapping
  - Polls EFTS for recent Form 4 and SC 13D filings (paginated, up to 2000 results)
  - Parses Form 4 XML to extract insider transactions (handles namespaces, nested elements)
  - Extracts SC 13D metadata from filing index
  - Filters to clean universe symbols (4313 symbols)
  - Stores to `edgar-filings.sqlite` with deduplication via unique indexes
  - Generates filing alerts for cluster buying (â‰¥3 insiders), large purchases (â‰¥$1M), C-suite purchases
  - Logs fetch run metadata
  - Rate-limited to 5 req/sec with exponential backoff on 403
- [x] **`edgar-filings.sqlite`** database with tables:
  - `insider_transactions` â€” 811 rows from first 24h collection
  - `activist_stakes` â€” schema ready, 0 rows (none filed today)
  - `filing_alerts` â€” 16 alerts generated
  - `edgar_fetch_runs` â€” 3 runs tracked
- [x] **`backend/src/services/edgarFilingsScheduler.ts`** â€” TypeScript scheduler
  - Config: enabled, frequency (manual/hourly/4h/daily), lookback hours, timezone, time_of_day
  - Runtime state management (running, pid, last_started_at, etc.)
  - Cron job management with weekday-only daily schedule
  - Manual trigger function
  - Resume from disk on server start
- [x] **`backend/src/routes/edgarFilings.ts`** â€” Express API routes
  - `GET /api/edgar-filings/settings` â€” config + runtime status
  - `POST /api/edgar-filings/settings` â€” save config
  - `POST /api/edgar-filings/run-collect` â€” manual trigger
- [x] **`server.ts`** wiring â€” import router, register at `/api/edgar-filings`, resume scheduler on startup
- [x] **Settings UI** â€” EDGAR Filings section in Automation tab
  - Enable/disable toggle
  - Frequency selector (manual/hourly/4h/daily)
  - Lookback hours config
  - Time of day for daily runs
  - Timezone config
  - Status display with last run info and polling
  - Run Now button with progress display

### Exit criteria

- [x] Collector successfully polls EFTS and returns Form 4 + SC 13D filings â€” 849 Form 4 filings found in 24h
- [x] Form 4 XML parsing extracts insider name, title, transaction type, shares, price â€” all fields verified
- [x] At least 10 insider transactions stored in `edgar-filings.sqlite` from a test run â€” 811 stored
- [x] Filing alerts generated for cluster buying or large purchases â€” 16 alerts (C-suite/Director purchases)
- [x] Scheduler starts/stops via Settings UI â€” wired and tested
- [x] Manual trigger works from Settings UI â€” wired and tested
- [x] Zero LLM cost for the entire pipeline â€” all computation is deterministic

---

## Phase 2 â€” 13F Institutional Holdings âŒ

- [ ] Quarterly batch job for 13F filings
- [ ] `institutional_holdings` table
- [ ] Smart money consensus signal

## Phase 3 â€” Cross-Signal Integration âŒ

- [ ] Wire insider data into Ledger agent context
- [ ] Wire into Market Intelligence conviction layer
- [ ] Cross-signal alert rules (insider + social + DCF)

---

## Update protocol

When you finish work that touches this plan:
1. Re-run the snapshot block at the top.
2. Tick the deliverable box only when the artifact is **shipped + verified**.
3. If a deliverable changes meaning, update both this doc and the PRD.
