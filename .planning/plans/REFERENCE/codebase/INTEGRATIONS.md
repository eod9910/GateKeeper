# External Integrations

Analysis date: 2026-06-02
Status: Current orientation reference

## AI

### OpenAI

Used by AI chat, chart/vision workflows, co-pilot analysis, thesis/narrative extraction, and other analyst-like workflows. Configuration flows through backend settings/environment and service code such as `visionService.ts`, `copilotTools.ts`, and related routes.

### Ollama

Supported as a local AI/vision alternative. The legacy docs mention `minicpm-v`; check current settings before assuming a specific model.

## Market Data

### Yahoo Finance / yfinance

Used by Python services and scripts for OHLCV, quote, and symbol research workflows.

### Quote Cache

Local quote caches exist under `backend/data/quote-cache` and `backend/data/option-quote-cache`.

## Fundamentals And Filings

### EDGAR / SEC

EDGAR collection and scheduling live through `edgarFilings.ts`, `edgarFilingsDb.ts`, `edgarFilingsScheduler.ts`, and scripts such as `collect_edgar_filings.py`.

### Fundamentals / PIT

Fundamental data uses current cache plus point-in-time stores/backups. Important Python services include `fundamentalsService.py`, `fundamentals_pit_store.py`, and `fundamentals_pit_query.py`.

## Social And Market Intelligence

The market intelligence stack ingests or analyzes social/news/macro sources through scripts and DB/services:

- Reddit/social collectors
- YouTube collectors/transcripts
- Hacker News / forums / Discord / Bluesky / 4chan collectors
- macro news and macro economic collectors
- Google Trends and app-store style collectors
- authenticity and social text quality scoring

The current app treats this as a scenario/narrative intelligence layer, not just raw scraping.

## Broker / Execution

Execution services include:

- Alpaca dependency via `@alpacahq/alpaca-trade-api`
- Robinhood auth/probe/status services and Python auth flow scripts
- broker client abstraction
- order executor
- position manager
- manual/imported external positions
- execution bridge and kill switch

This area should be handled carefully because it touches real trading/execution concepts.

## Browser Libraries

Frontend pages use static assets and browser-loaded libraries. Lightweight Charts remains central to chart rendering. Some pages still use Tailwind/CDN-era patterns; newer surfaces rely more heavily on local CSS/JS modules.

## Local Scheduled/Background Work

On server startup, persisted schedulers may resume:

- ledger hydration
- social intelligence
- market intelligence
- EDGAR filings
- execution bridge

Startup also runs repo-state checks and may run ledger coverage sync depending on persisted preferences and environment.
