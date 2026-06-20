# Validator Directive — Editor Cleanup Pass: Chart Performance / Cache Coalescing

- Date: 2026-06-18
- Phase: chart-performance-cache-coalescing
- From: Validator
- To: Editor
- Tier: 2 (data-critical concurrency in shared DataCache + frontend chart path)
- Type: REVIEW DIRECTIVE (anti-spaghetti cleanup pass)

## Context (full disclosure)

This change set was implemented OUT OF BAND — directly by the running agent, NOT
through a Builder handoff. There is no Builder report. The Editor is therefore
reviewing un-Built, un-reviewed code. Treat every claim below as UNTRUSTED and
verify against the actual files and `git diff`.

The goal of the change set was to fix two user-reported symptoms on the scanner
chart:

1. The scanner chart did not update live (last candle stayed frozen until a
   manual page reload).
2. Switching timeframes took a long time to load.

## Files in scope (and ONLY these)

- `backend/services/plugin_service.py` — `DataCache.__init__`, new
  `DataCache._key_lock`, and `DataCache.fetch_or_cache` (per-key fetch
  coalescing via double-checked locking).
- `frontend/public/chart.js` — parallelized timeframe switch (OHLCV + scan fire
  concurrently, bars render first, scan overlays later, stale-guard), plus a new
  `_scannerRtTick` real-time poller mirroring `copilot-chart.js`.

Use `git diff -- backend/services/plugin_service.py frontend/public/chart.js`
to see exactly what changed. Do not review unrelated code.

## What the change claims to do

- `fetch_or_cache` now acquires a per-key lock (keyed by `symbol::interval::period`)
  after an in-memory cache miss, re-checks the cache under the lock
  (double-checked), and only the first caller hits `fetch_data_yfinance`; the rest
  reuse the populated cache. `force_refresh` / long-history (`bypass_memory_cache`)
  callers are serialized but still fetch.
- `chart.js` `switchChartTimeframe` fires `/api/chart/ohlcv` and
  `/api/candidates/scan` in parallel, renders bars as soon as OHLCV returns, then
  overlays scan markers/levels, with an `isStale()` guard to discard results if
  the user switched symbol/timeframe mid-flight.
- A `_scannerRtTick` poller hits `/api/quotes` every 5s and updates the last
  candle in place (with intraday rollover in time-indexed mode only).

## Review scope (anti-spaghetti + correctness)

This is the Editor's standard anti-spaghetti pass, but because the core change is
concurrency, the review MUST also reason about correctness, not just style:

1. **Concurrency correctness of the per-key lock** (PRIMARY):
   - Is the double-checked locking pattern correct? Any TOCTOU window that could
     still double-fetch or return stale data?
   - `_key_locks` grows unbounded (one `threading.Lock` per distinct
     symbol/interval/period forever). Is that an acceptable leak for this
     single-user service, or does it need bounding/eviction? Flag, don't fix
     silently.
   - Lock-hold duration: the per-key lock is held across the blocking
     `fetch_data_yfinance` network call. Confirm it is NOT held across the
     CPU-bound `run_strategy` (that runs in `_run_scanner_for_symbol` AFTER
     `fetch_or_cache` returns). Confirm no nested/global lock is held during the
     network call that could serialize unrelated symbols.
   - Deadlock / re-entrancy: can any path call `fetch_or_cache` again while
     holding the same key lock (e.g. `_repair_recent_forex_daily_bars` calls
     `fetch_or_cache` for a DIFFERENT key — confirm it cannot self-deadlock)?
   - Interaction with the 30s Node->Python timeout: a waiter blocks up to one
     fetch duration. Is there a realistic case where the lock makes the waiter
     EXCEED 30s and trigger the cold spawn fallback MORE often than before?
2. **Frontend structure**: is `switchChartTimeframe` now too large / branchy?
   Duplicated render logic across the `renderedBars` branches? Naming clarity of
   the new module-scope globals (`_scannerRtTimer`, `window._scannerChartBars`,
   etc.). Any leak of the `setInterval` timer across symbol switches?
3. **Duplicated systems**: does `_scannerRtTick` duplicate `copilot-chart.js`
   logic in a way that should be shared, or is copy acceptable here? Flag only;
   do not unify without Validator approval (that would be new behavior risk).
4. **Behavior preservation**: confirm the cache-hit fast path and the
   `force_refresh` path behave exactly as before for healthy/sequential callers.

## Constraints

- Editor MAY make structure-only refactors that preserve behavior (naming,
  extracting helpers, comments). Editor MUST NOT change product behavior, alter
  the locking semantics, or unify frontend pollers without Validator approval.
- Editor MUST NOT certify that its own refactor preserved behavior.
- Any issue that must be fixed before this is trusted must be labeled
  `EDITOR BLOCKER` with: blocked artifact, why blocking, recommended owner
  (Builder for behavior/concurrency-semantics changes, Editor for structure-only),
  and the evidence required to clear it.

## Deliverable

Write the review to:
`agent-relay/roles/Editor/reports/2026-06-18-chart-cache-coalescing-editor-review.md`

Include: anti-spaghetti review, any refactor summary + files changed (if Editor
refactored), behavior-preservation statement (as a claim, not a certification),
remaining structural concerns, explicit EDITOR BLOCKER list (or "none"), and a
revalidation request back to Validator.

Do NOT route to Builder. Do NOT commit. Report back to Validator only.
