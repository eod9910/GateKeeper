# Latest Session - 2026-03-11

## Status

- Phase: `REFINE`
- Product state: refinement continues; latest work added Stockdex as a supplemental fundamentals data source and enriched the scanner copilot fundamentals panel
- Current source-of-truth planning area: `.planning/plans/`
- Startup continuity now includes `memory-bank/CURSOR_CONTINUITY.md`, generated from the live Cursor mirror

## What Changed Recently

### 2026-03-11 highlights

1. **Stockdex integration** (fundamentals enrichment):
   - Installed `stockdex` Python package (v1.2.4) — pulls from Finviz, Macrotrends, Yahoo Web scraping
   - Extended `fundamentalsService.py` with `_fetch_stockdex()` function that supplements the existing yfinance data with:
     - Finviz insider trading (recent 10 transactions: who, date, buy/sell, cost, value)
     - Finviz earnings history (12 quarters: EPS actual vs estimate, beat %, sales)
     - Yahoo Web growth estimates (current qtr, next qtr, current year, next year)
     - Yahoo Web financial highlights (revenue, margins, cash, debt with TTM/MRQ)
     - Yahoo Web trading information (52W range, MAs, short interest, dividends)
     - Yahoo Web top institutional holders (top 10 with shares and % outstanding)
   - Graceful degradation: if stockdex import fails or any endpoint errors, returns null for that section
   - Service timeout increased from 20s to 30s for the additional network calls

2. **Type system and contract validation**:
   - Added `stockdex?: Record<string, unknown> | null` to `FundamentalsSnapshotV2` type
   - Updated `normalizeFundamentalsSnapshot()` to pass through the stockdex object

3. **Scanner fundamentals panel UI** (new sections when stockdex data available):
   - **Growth Estimates** card — forward EPS growth projections (current/next qtr, current/next year)
   - **Price & Momentum** card — 52W range, 50/200-day MAs, avg volume
   - **Earnings History** table — QTR / EPS / EST / BEAT% / SALES for last 6 quarters
   - **Insider Trades** table — WHO / DATE / TYPE / VALUE with color-coded buy (green) / sell (red)
   - **Top Institutional Holders** table — HOLDER / SHARES / % OUT for top 8
   - Added 3 new builder functions: `buildEarningsHistoryCard`, `buildInsiderTradesCard`, `buildInstitutionalHoldersCard`

4. **AI copilot context enrichment**:
   - Extended `FUNDAMENTALS_SNAPSHOT` in `ai-chat.js` with `[STOCKDEX_EXTENDED]` block
   - AI now receives: growth estimates, recent earnings beat/miss summary, insider activity summary (buys vs sales), top institutional holder names

### 2026-03-09 highlights

1. Execution bridge hardening:
   - crypto execution is now filtered to broker-tradable Alpaca assets before order attempts
   - bridge config persists across backend restarts and auto-resumes on boot
   - live execution and backtesting now resolve `R_multiple` targets from `exit_config.target_level`
   - managed positions can repair missing or wrong exits
2. Live paper-trade proof:
   - the bridge successfully submitted a paper trade using `pullback_uptrend_entry_composite_v2`
   - current proof path used `PALL`
3. Execution UI clarity:
   - execution page shows the active strategy
   - positions and execution log now expose strategy context
   - positions show unrealized PnL percent
4. Scanner AI UX:
   - scanner page now has a fundamentals-aware copilot under the fundamentals snapshot
   - AI chat composers were standardized to the wider embedded-arrow layout across pages
   - scanner decision questions now force a direct `BUY` / `WAIT` / `PASS` style call
5. Cursor continuity system:
   - live Cursor storage is mirrored into `offline-cursor-transcripts-live/`
   - compact startup continuity is generated in `memory-bank/CURSOR_CONTINUITY.md`
   - searchable long-term transcript memory is generated in `memory-bank/transcripts/cursor-session-live.md`

### Core hardening work completed

1. Added real backend regression coverage for:
   - vision response parsing
   - training forward resolution
   - candidate filtering
   - candidate semantics
   - candidate persistence
   - chart normalization
   - runtime contract validation
   - Python validator fixtures
   - fundamentals scoring/tagging
2. Tightened route/service contract normalization across:
   - candidates
   - chart
   - fundamentals
   - plugin service responses
3. Refactored route-owned logic into focused backend services.

### Scanner semantics cleanup

Scanner candidates now distinguish:

- `candidate_role`
  - `context_indicator`
  - `pattern_detector`
  - `entry_signal`
- `candidate_actionability`
  - `context_only`
  - `setup_watch`
  - `entry_ready`

This separation now flows through:

- backend candidate APIs
- scanner result rows
- candidate detail badges
- scanner AI/copilot context

### Fundamentals snapshot upgrade

The scanner fundamentals panel was upgraded from a static Yahoo-style summary to a more tactical/speculative decision layer with:

- survivability / cash runway
- growth trend and acceleration
- dilution risk
- catalyst timing
- squeeze pressure context
- EV / sales / net cash context
- tactical tags and scores

The scanner copilot also receives that fundamentals snapshot.

### Documentation cleanup

The main docs were rewritten to match the actual system:

- `README.md`
- `docs/ARCHITECTURE.md`

### Planning cleanup

The old flat planning folder was cleaned up into:

- `.planning/plans/ACTIVE`
- `.planning/plans/BACKLOG`
- `.planning/plans/REFERENCE`
- `.planning/plans/ARCHIVE`

Additional cleanup completed:

- merged Python execution planning into one active file
- merged indicator library planning into one backlog file
- deleted stale mockups and low-value dead plans
- moved stale references out of the live reference bucket

See:

- `.planning/plans/README.md`
- `.planning/plans/RETENTION-AUDIT.md`

## Current Priorities

Top active planning files:

1. `.planning/plans/ACTIVE/single-user-production-readiness-checklist.md`
2. `.planning/plans/ACTIVE/legacy-plugin-conversion-plan.md`
3. `.planning/plans/ACTIVE/backtesting-master.md`
4. `.planning/plans/ACTIVE/python-execution-layer.md`
5. `.planning/plans/ACTIVE/research-to-live-trading.md`

## Immediate Next Candidates

If work continues from here, the most sensible next targets are:

1. Macrotrends long-term historical data (requires Selenium/Chrome — needs headless browser setup or alternative scraping)
2. density base detector v2 review and candidate quality evaluation
3. execution safety and auditability hardening
4. smarter continuity extraction from Cursor state, if deeper recall becomes necessary
5. observability across Node <-> Python boundaries

## Notes

- The app is still file-backed by design.
- The frontend is still a multi-page vanilla JS system, not a React app.
- The project does not need more broad features right now; it needs reliability and lower maintenance drag.
