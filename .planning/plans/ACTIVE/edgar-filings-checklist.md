# SEC EDGAR Filings Integration — Build Checklist

Living tracker for the EDGAR Filings Integration PRD.

> **Companion to:** [`edgar-filings-prd.md`](./edgar-filings-prd.md)
> **Update protocol:** Tick a box only when the deliverable is **shipped + verified**, not when the code is written.

---

## Status legend

- ✅ Done and verified
- 🟡 Partial
- 🔵 In progress this session
- ❌ Not started

---

## Snapshot — last verified 2026-04-29

**HEAD:** Phase 1 code complete, verified with live data
**New files:** 4 of 4 (collector, scheduler, routes, settings UI)
**Insider transactions stored:** 811 (from first 24h collection)
**Activist stakes stored:** 0 (none filed today — normal)
**Alerts generated:** 16 (all C-suite/Director purchases)
**Filing fetch runs:** 3 (1 dry-run, 2 live)

---

## Phase 1 — Form 4 + SC 13D Collector ✅ complete

### Infrastructure

- [x] **`backend/scripts/collect_edgar_filings.py`** — Main collector script
  - Downloads and caches `company_tickers.json` for ticker-to-CIK mapping
  - Polls EFTS for recent Form 4 and SC 13D filings (paginated, up to 2000 results)
  - Parses Form 4 XML to extract insider transactions (handles namespaces, nested elements)
  - Extracts SC 13D metadata from filing index
  - Filters to clean universe symbols (4313 symbols)
  - Stores to `edgar-filings.sqlite` with deduplication via unique indexes
  - Generates filing alerts for cluster buying (≥3 insiders), large purchases (≥$1M), C-suite purchases
  - Logs fetch run metadata
  - Rate-limited to 5 req/sec with exponential backoff on 403
- [x] **`edgar-filings.sqlite`** database with tables:
  - `insider_transactions` — 811 rows from first 24h collection
  - `activist_stakes` — schema ready, 0 rows (none filed today)
  - `filing_alerts` — 16 alerts generated
  - `edgar_fetch_runs` — 3 runs tracked
- [x] **`backend/src/services/edgarFilingsScheduler.ts`** — TypeScript scheduler
  - Config: enabled, frequency (manual/hourly/4h/daily), lookback hours, timezone, time_of_day
  - Runtime state management (running, pid, last_started_at, etc.)
  - Cron job management with weekday-only daily schedule
  - Manual trigger function
  - Resume from disk on server start
- [x] **`backend/src/routes/edgarFilings.ts`** — Express API routes
  - `GET /api/edgar-filings/settings` — config + runtime status
  - `POST /api/edgar-filings/settings` — save config
  - `POST /api/edgar-filings/run-collect` — manual trigger
- [x] **`server.ts`** wiring — import router, register at `/api/edgar-filings`, resume scheduler on startup
- [x] **Settings UI** — EDGAR Filings section in Automation tab
  - Enable/disable toggle
  - Frequency selector (manual/hourly/4h/daily)
  - Lookback hours config
  - Time of day for daily runs
  - Timezone config
  - Status display with last run info and polling
  - Run Now button with progress display

### Exit criteria

- [x] Collector successfully polls EFTS and returns Form 4 + SC 13D filings — 849 Form 4 filings found in 24h
- [x] Form 4 XML parsing extracts insider name, title, transaction type, shares, price — all fields verified
- [x] At least 10 insider transactions stored in `edgar-filings.sqlite` from a test run — 811 stored
- [x] Filing alerts generated for cluster buying or large purchases — 16 alerts (C-suite/Director purchases)
- [x] Scheduler starts/stops via Settings UI — wired and tested
- [x] Manual trigger works from Settings UI — wired and tested
- [x] Zero LLM cost for the entire pipeline — all computation is deterministic

---

## Phase 2 — 13F Institutional Holdings ❌

- [ ] Quarterly batch job for 13F filings
- [ ] `institutional_holdings` table
- [ ] Smart money consensus signal

## Phase 3 — Cross-Signal Integration ❌

- [ ] Wire insider data into Ledger agent context
- [ ] Wire into Market Intelligence conviction layer
- [ ] Cross-signal alert rules (insider + social + DCF)

---

## Update protocol

When you finish work that touches this plan:
1. Re-run the snapshot block at the top.
2. Tick the deliverable box only when the artifact is **shipped + verified**.
3. If a deliverable changes meaning, update both this doc and the PRD.
