# Market Intelligence Historical Replay - Checklist

Percent complete: 39% (43 complete, 0 partial, 68 remaining)

PRD: market-intelligence-historical-replay-prd.md

Living execution checklist for `market-intelligence-historical-replay-prd.md`.

## Current Next Sprint - 2026-06-01

Goal: turn the existing price-only replay prototype into the Market Intelligence Phase 5 proof loop.

- [ ] Promote replay/calibration to the next active implementation focus.
- [ ] Run a longer baseline price-only replay across multiple years.
- [ ] Add PIT fundamental overlays from `fundamentals-pit.sqlite`.
- [ ] Add revenue growth and revenue acceleration buckets.
- [ ] Add earnings surprise buckets where PIT/dated earnings data is available.
- [ ] Add valuation-state buckets: undervalued, fair, overvalued, unavailable.
- [ ] Compare signal-family results:
  - [ ] eigen residual only
  - [ ] eigen + undervalued
  - [ ] eigen + revenue growth
  - [ ] eigen + revenue acceleration
  - [ ] eigen + positive earnings surprise
  - [ ] depressed price + revenue acceleration
  - [ ] social buzz + improving fundamentals
  - [ ] macro scenario + exposed ticker + valuation support
  - [ ] mixed-engine corroboration vs single-engine signal
- [ ] Report win rate, average return, median return, loss rate, time-to-profit, and best hold window.
- [ ] Produce threshold recommendations for live Market Intelligence ranking.
- [ ] Decide which signals should be promoted, demoted, or killed.

## Current State

- [x] Confirmed clean-universe OHLCV is sufficient for Phase 1.
- [x] Refreshed clean-universe OHLCV through `2026-05-08`.
- [x] Built first eigen/PCA perturbation prototype.
- [x] Confirmed options-flow history is too recent for two-year replay.
- [x] Confirmed Market Intelligence raw fetch history is mostly recent.
- [x] Confirmed PIT fundamentals contain historical `available_at` data.

## Phase 1 - Price-Only Replay

- [x] Create `backend/scripts/run_eigen_replay_study.py`.
- [x] Add CLI args:
  - [x] `--as-of-start`
  - [x] `--as-of-end`
  - [x] `--rebalance-frequency`
  - [x] `--lookback`
  - [x] `--factors`
  - [x] `--max-symbols`
  - [x] `--forward-windows`
  - [x] `--z-thresholds`
  - [x] `--output-dir`
- [x] Load clean-universe OHLCV from `backend/data/universe/*_1d.csv`.
- [x] Build replay date calendar from available market dates.
- [x] For each replay date, train PCA only on trailing data ending at that date.
- [x] Compute factor-expected move, residual move, residual z-score, and rank.
- [x] Store top positive and negative residual movers per replay date.
- [x] Compute forward returns for `1D`, `5D`, `20D`, `60D`, and `120D`.
- [x] Exclude forward windows that do not have enough future data.
- [x] Emit JSON run artifact.
- [x] Emit Markdown report.
- [x] Add artifact path under `backend/data/research/`.

## Phase 1 Guardrails

- [x] Add explicit lookahead-bias checks.
- [x] Add run metadata with data start/end, universe count, and skipped symbols.
- [x] Flag survivorship bias because today's clean universe is being used.
- [ ] Flag corporate-action artifacts where price jumps exceed a sanity threshold.
- [x] Add minimum liquidity filter.
- [x] Add minimum price filter.
- [ ] Add duplicate ticker / stale CSV warnings.

## Phase 1 Analysis Tables

- [x] Aggregate forward returns by residual z-score bucket.
- [x] Aggregate forward returns by positive vs negative residual direction.
- [x] Aggregate hit rate by threshold.
- [ ] Aggregate median, mean, win rate, max drawdown proxy, and count.
- [x] Add fixed-risk R expectancy tables.
- [x] Show top historical winners.
- [x] Show top historical losers.
- [ ] Show top false positives.
- [ ] Show examples worth manually researching.

## Phase 2 - PIT Valuation Overlay

- [ ] Add `--overlay pit_valuation`.
- [ ] Query `fundamentals-pit.sqlite` as of each replay date.
- [ ] Reuse PIT query helpers where possible.
- [ ] Attach company type where available.
- [ ] Attach valuation engine class where available.
- [ ] Recompute valuation as-of date where feasible.
- [ ] If recomputation is not feasible, attach only raw PIT fundamentals and mark valuation unavailable.
- [ ] Produce performance tables by valuation state.
- [ ] Produce performance tables by company type.
- [ ] Produce cross-signal study:
  - [ ] positive residual + undervalued
  - [ ] positive residual + overvalued
  - [ ] negative residual + overvalued
  - [ ] negative residual + undervalued

## Phase 3 - Social / Market Intelligence Overlay

- [ ] Add evidence mode distinction:
  - [ ] strict causal: `fetched_at <= as_of_date`
  - [ ] historical content: `posted_at <= as_of_date`, fetched later
- [ ] Attach MI raw-hit counts where strict causal data exists.
- [ ] Attach Social Intelligence ticker buzz where causal data exists.
- [ ] Produce coverage report by date and platform.
- [ ] Do not include non-causal social data in main performance tables.
- [ ] Add separate diagnostic report for historical content mode.

## Phase 4 - Options Flow Overlay

- [ ] Add options overlay only for replay dates with real stored option snapshots.
- [ ] Attach put/call ratio, call/put ratio, flow bias, and imbalance tier.
- [ ] Produce performance by options-flow direction.
- [ ] Produce performance by imbalance tier.
- [ ] Add daily collection dependency to options-flow scheduler plan.
- [ ] Mark historical options replay blocked until enough daily snapshots exist or vendor history is acquired.

## Data Collection Follow-Ups

- [ ] Schedule `backend/scripts/refresh_universe_ohlcv.py` daily after market close.
- [ ] Add OHLCV freshness status to Settings update engines.
- [ ] Persist daily options-flow snapshots for the optionable clean universe.
- [ ] Persist Market Intelligence raw ingestion with fetched timestamps.
- [ ] Persist source coverage reports so replay knows where evidence is missing.
- [ ] Consider archived/historical social data only if source terms permit it.

## UI / Product Follow-Ups

- [ ] Add Historical Replay section to Market Intelligence page only after Phase 1 works.
- [ ] Show latest replay report summary.
- [ ] Show signal thresholds and resulting historical hit rates.
- [ ] Allow click-through from replay example to price chart.
- [ ] Add "promote to live rule" only after replay evidence supports it.

## Definition of Done

- [ ] A user can run a two-year historical replay from CLI.
- [ ] The replay report clearly states what was knowable as of each date.
- [ ] The output separates price-only results from overlay-enhanced results.
- [ ] The report identifies whether eigen perturbation is useful, noisy, or conditional.
- [ ] The next live Market Intelligence threshold decision can be made from replay evidence.

## First Implementation Target

Run a smoke replay:

```powershell
py backend/scripts/run_eigen_replay_study.py `
  --as-of-start 2024-05-01 `
  --as-of-end 2024-08-01 `
  --rebalance-frequency weekly `
  --lookback 120 `
  --factors 5 `
  --max-symbols 750 `
  --forward-windows 1,5,20,60,120
```

Expected output:

- `backend/data/research/eigen_replay_study.latest.json`
- `backend/data/research/eigen_replay_study.latest.md`

Status:

- [x] Smoke replay completed for `2024-05-01` to `2024-08-01`.
- [x] Completed `14 / 14` weekly replay dates.
- [x] Produced `318` price-only signals.
- [x] Wrote `backend/data/research/eigen_replay_study.latest.json`.
- [x] Wrote `backend/data/research/eigen_replay_study.latest.md`.
