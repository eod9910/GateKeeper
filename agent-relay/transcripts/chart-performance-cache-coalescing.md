# Agent Relay Transcript: chart-performance-cache-coalescing

Generated: 2026-06-20T14:10:41Z

## 1. Validator -> Editor: Editor Cleanup Pass: Chart Cache Coalescing

- Routing ID: `route-20260619-035637-validator-to-editor-28ce4bfd`
- Type: `REVIEW DIRECTIVE`
- Phase: `chart-performance-cache-coalescing`
- Timestamp: `2026-06-19T03:56:37Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-18-editor-review-chart-cache-coalescing.md`
- Body: `agent-relay/messages/route-20260619-035637-validator-to-editor-28ce4bfd.md`
- SHA-256: `1d3dbe82686c42e0d16a5ef50859a4d0a71ffd461777b3313c8c91a9357c747f`

### Validator Directive — Editor Cleanup Pass: Chart Performance / Cache Coalescing

- Date: 2026-06-18
- Phase: chart-performance-cache-coalescing
- From: Validator
- To: Editor
- Tier: 2 (data-critical concurrency in shared DataCache + frontend chart path)
- Type: REVIEW DIRECTIVE (anti-spaghetti cleanup pass)

#### Context (full disclosure)

This change set was implemented OUT OF BAND — directly by the running agent, NOT
through a Builder handoff. There is no Builder report. The Editor is therefore
reviewing un-Built, un-reviewed code. Treat every claim below as UNTRUSTED and
verify against the actual files and `git diff`.

The goal of the change set was to fix two user-reported symptoms on the scanner
chart:

1. The scanner chart did not update live (last candle stayed frozen until a
   manual page reload).
2. Switching timeframes took a long time to load.

#### Files in scope (and ONLY these)

- `backend/services/plugin_service.py` — `DataCache.__init__`, new
  `DataCache._key_lock`, and `DataCache.fetch_or_cache` (per-key fetch
  coalescing via double-checked locking).
- `frontend/public/chart.js` — parallelized timeframe switch (OHLCV + scan fire
  concurrently, bars render first, scan overlays later, stale-guard), plus a new
  `_scannerRtTick` real-time poller mirroring `copilot-chart.js`.

Use `git diff -- backend/services/plugin_service.py frontend/public/chart.js`
to see exactly what changed. Do not review unrelated code.

#### What the change claims to do

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

#### Review scope (anti-spaghetti + correctness)

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

#### Constraints

- Editor MAY make structure-only refactors that preserve behavior (naming,
  extracting helpers, comments). Editor MUST NOT change product behavior, alter
  the locking semantics, or unify frontend pollers without Validator approval.
- Editor MUST NOT certify that its own refactor preserved behavior.
- Any issue that must be fixed before this is trusted must be labeled
  `EDITOR BLOCKER` with: blocked artifact, why blocking, recommended owner
  (Builder for behavior/concurrency-semantics changes, Editor for structure-only),
  and the evidence required to clear it.

#### Deliverable

Write the review to:
`agent-relay/roles/Editor/reports/2026-06-18-chart-cache-coalescing-editor-review.md`

Include: anti-spaghetti review, any refactor summary + files changed (if Editor
refactored), behavior-preservation statement (as a claim, not a certification),
remaining structural concerns, explicit EDITOR BLOCKER list (or "none"), and a
revalidation request back to Validator.

Do NOT route to Builder. Do NOT commit. Report back to Validator only.


---

## 2. Editor -> Validator: Chart Cache Coalescing Review (1 blocker)

- Routing ID: `route-20260619-040157-editor-to-validator-ddfcc43c`
- Type: `EDITOR REVIEW`
- Phase: `chart-performance-cache-coalescing`
- Timestamp: `2026-06-19T04:01:57Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-18-chart-cache-coalescing-editor-review.md`
- Body: `agent-relay/messages/route-20260619-040157-editor-to-validator-ddfcc43c.md`
- SHA-256: `7b43de2affa238a5a7f678baecc2cdeda5901cce300951429577169d7639400e`

### Editor Review — Chart Performance / Cache Coalescing

- Date: 2026-06-18
- Phase: chart-performance-cache-coalescing
- From: Editor
- To: Validator
- Tier: 2 (data-critical concurrency + frontend chart path)
- Type: Anti-spaghetti + concurrency-correctness review (no Builder report; code reviewed OUT OF BAND)
- Files in scope (only): `backend/services/plugin_service.py`, `frontend/public/chart.js`

All prior claims were treated as UNTRUSTED. Findings below are verified against
`git --no-pager diff` and direct reads of the working-tree files. `plugin_service.py`
passes `py_compile` (doraise) clean.

---

#### Anti-spaghetti review (findings tied to file:line)

##### Backend — `DataCache` per-key coalescing

1. **Double-checked locking is correct.** `fetch_or_cache` does the outer
   cache check (`backend/services/plugin_service.py:100-102`), then acquires the
   per-key lock (`:109`), then re-checks the cache under the lock
   (`:113-116`) before fetching (`:117-118`). This is the standard, correct
   double-checked pattern. The inner re-check is correctly gated on
   `not bypass_memory_cache`, so `force_refresh`/long-history callers skip the
   re-check and always fetch — matching the stated intent.

2. **Lock-registry creation is race-safe.** `_key_lock`
   (`backend/services/plugin_service.py:57-63`) serializes lock creation behind
   `_locks_guard`, so two threads racing the same new key receive the *same*
   `Lock` object. Without this guard, coalescing would silently fail (each
   thread would get its own lock and both would fetch). Guard scope is minimal
   (dict get/create only) and is NOT held across the network fetch — good.

3. **Lock-hold scope is correct.** The per-key lock wraps `fetch_data_yfinance`
   (`:117`) — intentional, this is what coalesces concurrent fetches — and is
   released when `fetch_or_cache` returns. The CPU-bound `run_strategy` runs in
   `_run_scanner_for_symbol` at `backend/services/plugin_service.py:619`, which
   is AFTER `fetch_or_cache` returns at `:599`. Confirmed: the lock does NOT wrap
   `run_strategy`. `_locks_guard` is never held across the network call, so
   unrelated symbols/keys are not serialized.

4. **No self-deadlock via `_repair_recent_forex_daily_bars`.**
   `_repair_recent_forex_daily_bars` calls `fetch_or_cache(symbol, "1h", "720d")`
   (`backend/services/plugin_service.py:185`). It is invoked from the
   `/chart/ohlcv` handler at `:341`, which is AFTER that handler's own
   `fetch_or_cache(... fetch_interval, period ...)` returned at `:331` (lock
   released). It also targets a DIFFERENT key (`1h::720d` vs the daily key).
   `threading.Lock` is non-reentrant, but since (a) the first lock is already
   released and (b) the keys differ, there is no re-entrant or nested
   self-deadlock. (Assumption, not provable from these files: `fetch_data_yfinance`
   does not itself call back into `DATA_CACHE.fetch_or_cache`. This held by code
   reading but I cannot certify the whole `fetch_data_yfinance` call tree here.)

5. **`_key_locks` grows unbounded (per-key Lock leak) — FLAG, acceptable for
   single-user.** `backend/services/plugin_service.py:52,62` — one
   `threading.Lock` is created per distinct `SYMBOL::interval::period` and never
   evicted, even after the matching `_cache` entry TTL-expires and is popped
   (`get` at `:71`). The lock map and the cache map therefore diverge over time.
   For a single-user local service with a bounded symbol/timeframe universe this
   is a few thousand tiny objects at most — not a practical problem. Flagging per
   directive; do not fix silently. If this service ever becomes multi-tenant or
   long-lived with a large symbol universe, bound/evict the map.

6. **Batch-scan path is unaffected by contention.** `/scanner/run` pre-fetches
   via `ThreadPoolExecutor` submitting `fetch_or_cache` per symbol
   (`backend/services/plugin_service.py:789-793`). Distinct symbols use distinct
   keys → no lock contention; identical symbols (duplicates in a batch) now
   correctly coalesce instead of double-fetching. Net improvement, no regression.

7. **30s Node→Python timeout interaction — no increased cold-spawn risk.**
   `PY_SERVICE_TIMEOUT_MS` = 30000 (`backend/src/services/pluginServiceClient.ts:13`),
   `backend/src/routes/chart.ts:47,63` = 30000. A waiter on the per-key lock
   blocks for at most ONE in-flight fetch duration, then takes the inner
   cache-hit fast path and returns. Before this change, two same-key callers
   (the parallel OHLCV + scan) BOTH fetched concurrently, each finishing in
   ~`T_fetch`; now the first finishes in ~`T_fetch` and the second waits ~`T_fetch`
   then returns from cache — i.e. the second caller's wall time is still
   ~`T_fetch`, NOT `2·T_fetch`. So the lock does not push a waiter past 30s any
   more than the pre-change single fetch already could, and it reduces duplicate
   Yahoo load (less rate-limiting). No realistic increase in the cold-spawn
   fallback. The only residual exposure is the pre-existing one: a single cold
   Yahoo fetch that itself approaches 30s — unchanged by this diff.

##### Frontend — `switchChartTimeframe` + `_scannerRtTick`

8. **`switchChartTimeframe` is now larger and more branchy, with duplicated
   UI-commit logic.** `frontend/public/chart.js:~1320-1372`. The trio
   `commitIntervalUi()` + `document.getElementById('chart-symbol').textContent = ...`
   + `redrawWithCurrentMode(...)` now appears in ~3 branches (bars-first render,
   scan-found render, no-pattern fallback). A small pure helper
   (`commitChartHeader(symbol, timeframe)`) would remove the repetition. This is a
   structure-only opportunity; I did NOT make the edit (see Refactor summary for
   why). Non-blocking.

9. **Stale guard is reasonable.** `isStale()` compares both
   `_chartCurrentSymbol` and `_chartCurrentInterval` against the captured
   `switchSymbol`/`newInterval` (`frontend/public/chart.js:~1309`), and is
   checked before bars render and before the scan overlay clobbers a newer view
   (`return` at the post-scan check). Correct intent; prevents a late scan from
   stomping a newer selection.

10. **Double render when a candidate is found.** When the scan returns a
    candidate, the code renders the chart-only candidate first
    (`redrawWithCurrentMode(chartOnly)`) and then re-renders with the full
    candidate (`redrawWithCurrentMode(candidate)`). This is the intended
    "bars first, overlay later" UX, but it is two full redraws on the happy path.
    Acceptable; noted so it is not mistaken for a bug.

11. **New module-scope globals — naming is acceptable, one is loose.**
    `_scannerRtTimer`, `SCANNER_RT_POLL_MS`, `SCANNER_RT_INTRADAY_SECONDS`
    (`frontend/public/chart.js:1416-1418`) are clear and mirror the copilot
    `_rt*`/`RT_*` convention. `window._scannerChartBars`
    (`:863`, read at `:1431`) is a true window-global used as cross-function
    shared state; a module-scope variable would be cleaner, but it mirrors
    existing patterns in this file. Non-blocking.

12. **Timer is NOT leaked across symbol switches, BUT is never stopped on
    teardown.** `_scannerRtStart` calls `_scannerRtStop` first
    (`frontend/public/chart.js:1424`), so repeated starts (one per
    `drawPatternChart` at `:864`) replace rather than accumulate timers — at most
    one timer exists. However, `_scannerRtStop` is exposed on `window`
    (`:1479`) but is **never called anywhere** except inside `_scannerRtStart`
    (verified by repo-wide search). The copilot chart stops its equivalent poller
    in `clearChart()` via `window._rtStopChartUpdates()`
    (`frontend/public/copilot-chart.js:1806`); the scanner chart has no
    corresponding teardown call. Result: once started, the scanner poller hits
    `/api/quotes` every 5s indefinitely (for the last `_chartCurrentSymbol`) until
    the page is fully unloaded — including after the user navigates away from the
    chart within the SPA. See EDITOR BLOCKER 1.

13. **`_scannerRtTick` duplicates `copilot-chart.js` `_rtTick` — FLAG ONLY.**
    `frontend/public/chart.js:1429-1473` re-implements essentially the same
    `/api/quotes` poll, intraday-rollover math, and `series.update` last-bar
    logic as `copilot-chart.js:1951+`. This is copy-paste of a non-trivial
    algorithm (two places to fix any rollover/price bug). A shared
    `createRtChartPoller({ getSymbol, getInterval, getBars, getSeries, getMode })`
    factory would unify them. Per directive I am flagging only and NOT unifying —
    unifying these two pollers is behavior-risk and needs Validator/Builder
    ownership.

---

#### Refactor summary + files changed

**No edits made.**

Rationale: the highest-value safe refactor (extracting `commitChartHeader` and
de-duplicating the `switchChartTimeframe` branches, finding #8) sits directly on
top of the concurrency/UX-sensitive code under review, and per the Editor role I
cannot certify that my own refactor preserved behavior. Touching it would also
blur a review whose primary purpose is correctness of un-Built code. I have
therefore left the code unchanged and recorded the structural opportunities as
non-blocking concerns for a later, separately-reviewed pass.

---

#### Behavior-preservation statement (CLAIM — explicitly NOT a self-certification)

I made no edits, so there is no Editor refactor to certify. As a review CLAIM
(to be independently verified by the Validator against the files/diff, not
accepted on my word):

- The cache-hit fast path is unchanged for healthy/sequential callers: the outer
  `get()` check and early `return cached, True` at
  `backend/services/plugin_service.py:100-102` run before any lock is touched,
  identical to the pre-diff behavior.
- The `force_refresh` / long-history (`bypass_memory_cache`) path still always
  fetches: the inner re-check is skipped (`:113`), so these callers fetch every
  time and are only serialized per key — matching prior fetch semantics.
- For two sequential callers with no contention, behavior is identical to before;
  the lock is uncontended and adds only a negligible acquire/release.

This is a claim from reading, not a guarantee. Validator must confirm.

---

#### Remaining structural concerns (non-blocking)

- (#5) `_key_locks` is an unbounded map (acceptable for single-user; revisit if
  scope changes).
- (#8) Duplicated UI-commit lines in `switchChartTimeframe`; extract
  `commitChartHeader` in a future structure-only pass.
- (#10) Two redraws on the candidate-found happy path (intended; monitor for
  flicker).
- (#11) `window._scannerChartBars` as a window-global; prefer module scope.
- (#13) `_scannerRtTick` duplicates `copilot-chart.js _rtTick`; candidate for a
  shared poller factory (Validator-approved behavior work, not Editor structure).

---

#### EDITOR BLOCKERS

##### EDITOR BLOCKER 1 — Scanner real-time poller has no teardown (leaked indefinite `/api/quotes` polling)

- **What is blocked:** Acceptance of the `frontend/public/chart.js` real-time
  poller change (`_scannerRtStart`/`_scannerRtStop`/`_scannerRtTick`).
- **Why blocking:** `_scannerRtStop` (`frontend/public/chart.js:1419,1479`) is
  defined and exposed but never invoked on any teardown/navigation path
  (verified by repo-wide search; the only caller is `_scannerRtStart` itself).
  Once `drawPatternChart` starts the timer (`:864`), it polls `/api/quotes` every
  5s forever for the last `_chartCurrentSymbol`, even after the user leaves the
  chart view, until full page unload. The copilot chart avoids exactly this by
  calling `window._rtStopChartUpdates()` in `clearChart()`
  (`frontend/public/copilot-chart.js:1806`); the scanner path has no equivalent.
  This is a runtime/lifecycle resource leak and continued background network
  load, not a structure-only issue, so the Editor cannot fix it under
  behavior-preservation rules.
- **Recommended owner:** Builder (behavior/lifecycle change — decide and wire the
  correct teardown points so `_scannerRtStop()` is called when the scanner chart
  is cleared/closed or the symbol context is torn down, mirroring the copilot
  `clearChart()` teardown).
- **Evidence required to clear:** A diff showing `_scannerRtStop()` invoked from
  the scanner chart's teardown/clear path(s), plus a demonstration (manual or
  logged) that switching away from the scanner chart stops the 5s `/api/quotes`
  polling, with no orphaned timer remaining.

(All other reviewed items — the per-key locking semantics, double-checked
locking, lock-hold scope, no self-deadlock, and the timeout interaction — are
NOT blockers. The unbounded `_key_locks` map is a FLAG, not a blocker, for this
single-user service.)

---

#### Revalidation request back to Validator

Validator: please independently verify (against files/diff + compile/test, not
this report) and decide:

1. Confirm the behavior-preservation CLAIMS above (cache-hit fast path and
   `force_refresh`/`bypass_memory_cache` path) by reading
   `backend/services/plugin_service.py:100-119`.
2. Confirm BLOCKER 1: that `_scannerRtStop` is never called on teardown, and
   route it to Builder to wire teardown (mirroring `copilot-chart.js:1806`).
3. Decide disposition of the `_key_locks` unbounded-growth FLAG (#5) — accept as
   acceptable for single-user, or schedule bounding.
4. Decide whether to schedule the non-blocking structure-only refactors (#8, #11)
   as a later Editor pass, and whether to authorize a Builder unification of the
   two real-time pollers (#13) — which is behavior-risk, not Editor structure.

No code was committed. No frontend pollers were unified. No long-running servers
or watchers were started by the Editor.


---
