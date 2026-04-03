# Data Caching & Freshness Architecture

Status: Active  
Owner: Platform / Data / Runtime  
Last Updated: 2026-03-20

## Purpose

Define one cache-first freshness policy for the whole app so data is:

- fast to read
- safe to reuse
- refreshed only when stale
- resilient when upstream providers fail

This plan turns caching from an ad hoc optimization into a system rule.

## Core Rule

For every external or derived data source:

1. read cache first
2. check freshness against that data type's TTL / staleness rule
3. if fresh, use cache
4. if stale, refresh
5. if refresh fails and stale data is still safe for that workflow, fall back to stale cache and mark it stale

Short version:

```text
cache first -> stale check -> refresh only when needed -> stale fallback when safe
```

## Why This Is The Right Default

The app is file-backed and single-user. That means disk caching is cheap, simple, inspectable, and reliable.

Benefits:

- lower latency in UI and APIs
- fewer repeated yfinance / Stockdex / upstream fetches
- lower Python process churn
- lower memory pressure
- better behavior when upstream sources are slow or partially down
- more deterministic behavior during research and validation

## Freshness Classes

Not all data should have the same TTL.

### 1. Hot data

Use when decisions are sensitive to near-live state.

Examples:

- quotes
- option premiums / chains
- intraday bars
- active execution positions / broker state

Rules:

- short TTL
- prefer incremental refresh over full rebuild
- stale fallback only when explicitly acceptable in UI / workflow

### 2. Warm data

Use when data changes regularly but not every second.

Examples:

- daily OHLCV snapshots
- weekly OHLCV snapshots
- universe manifests
- optionable status
- cached chart render payloads

Rules:

- medium TTL
- incremental refresh preferred
- stale fallback usually acceptable

### 3. Cold data

Use when data changes slowly and repeated fetches are wasteful.

Examples:

- fundamentals
- insider trades
- earnings history
- growth estimates
- institutional holders
- static symbol metadata

Rules:

- long TTL
- file-backed cache should be the default
- stale fallback is strongly preferred over failure

## Recommended TTL Policy

These are the default targets unless a service has a strong reason to differ.

| Data class | Examples | Recommended TTL | Notes |
|---|---|---:|---|
| `hot-live` | quotes, option premium, broker status | 15s to 60s | no heavy disk writes needed unless audit requires it |
| `hot-intraday` | 1m / 5m / 1h bars | 5m to 30m | incremental append preferred |
| `warm-daily-market` | 1d bars, 1wk bars, universe prices | 12h to 24h | refresh once per market day usually enough |
| `warm-manifest` | optionable universe, symbol metadata | 1d to 7d | route should expose stale status |
| `cold-fundamentals` | yfinance fundamentals, Stockdex enrichment, insider trades | 7d | already started for scanner fundamentals |
| `cold-research-artifact` | family stats, validation reports, snapshots | immutable or manual refresh | never auto-refresh unless artifact generation is rerun |

## Storage Model

Every cacheable payload should follow the same envelope shape on disk:

```json
{
  "key": "AAPL",
  "fetchedAt": 1773686400000,
  "ttlMs": 604800000,
  "source": "fundamentalsService",
  "version": 1,
  "data": {}
}
```

Required fields:

- `key`
- `fetchedAt`
- `ttlMs`
- `source`
- `version`
- `data`

Optional fields:

- `staleReason`
- `refreshError`
- `upstreamStatus`
- `derivedFrom`

Current helper:

- `backend/src/services/cacheService.ts` now provides the shared TypeScript envelope + freshness helpers used by cached routes.

## Runtime Rules

### In-memory + disk

Use a two-layer cache:

1. in-memory cache for the current server lifetime
2. file-backed cache for durable reuse across restarts

Expected behavior:

- memory cache hit -> fastest path
- disk cache hit -> good path
- stale disk cache + refresh succeeds -> update cache
- stale disk cache + refresh fails -> return stale cache if safe

### Stale fallback policy

Allowed:

- fundamentals
- insider trades
- earnings context
- daily / weekly bars for research workflows
- optionable universe metadata

Not allowed by default:

- broker position state
- live order state
- near-live quotes when used for execution

### Force refresh

Any route that uses cached data should support an explicit refresh override when appropriate.

Examples:

- `force_refresh=true`
- UI button: `Refresh Data`

This should bypass freshness checks but still write the refreshed result back to cache.

## What Should Be Migrated First

### Phase 1: cold-data hardening

Highest ROI, lowest risk.

1. scanner fundamentals / insider / Stockdex
2. yfinance fundamentals snapshot
3. symbol metadata and universe manifests

Why first:

- heavy upstream cost
- low freshness requirements
- visible UI performance wins

### Phase 2: market-data freshness policy

1. daily / weekly OHLCV
2. validator snapshot TTL policy
3. universe price snapshot TTL

Why second:

- already partially cached
- needs consistent expiry rules, not just storage

### Phase 3: hot-path trading data

1. quotes
2. option chains
3. execution bridge runtime reads

Why third:

- more sensitive to stale reads
- requires tighter UX / route semantics

## Current App Mapping

### Already present

- validator snapshot cache with TTL by timeframe and manual `force_refresh`
- invalid-symbol cache
- scanner fundamentals now has a file-backed weekly cache for fundamentals / insider data
- universe manifest + price snapshot freshness policy
- quote cache (memory + disk)
- option quote cache (memory + disk)
- OHLCV fetch path already supports refresh-aware caching in the market-data layer

### Still incomplete

- no unified cache envelope across services
- no shared cache utility across both TypeScript and Python paths
- no global stale/fresh metadata contract in responses
- no force-refresh standard across every route yet
- no repo-wide TTL table enforced in code

## Rollout Status

Implemented now:

- `fundamentals` / insider screen: weekly file-backed cache with in-memory reuse
- `universe` manifest and price snapshot: freshness metadata + refresh override
- `validator` snapshots: TTL-aware reuse + refresh override
- `quotes` and `quotes/options`: short-lived memory + disk caches
- shared TypeScript cache helper for envelope reads/writes and freshness metadata
- top-level `freshness` blocks on the main cached TypeScript routes

Still to standardize later:

- Python-side shared cache helper so validator/fetch services follow the same utility layer
- consistent `freshness` metadata block on every cached response
- explicit stale-fallback semantics for each route/UI workflow

## API Contract Recommendation

When returning cached data, routes should expose freshness metadata:

```json
{
  "success": true,
  "data": {},
  "freshness": {
    "fetchedAt": "2026-03-20T12:00:00Z",
    "ttlMs": 604800000,
    "stale": false,
    "sourceStatus": "ok"
  }
}
```

This lets the frontend:

- show when data is stale
- explain why refreshes are not instant
- avoid pretending cold data is real-time

Current convention:

- preserve existing `data` payload shapes for compatibility
- add a top-level `freshness` object on cached responses
- allow `freshness.counts` on batched routes
- keep nested freshness blocks when a route exposes multiple freshness scopes

## Recommended Shared Utility

Current TypeScript utility:

- `createCacheEnvelope(...)`
- `readCacheEnvelope(...)`
- `writeCacheEnvelope(...)`
- `buildFreshnessInfo(...)`
- `buildBatchFreshnessInfo(...)`

Next goal:

- mirror the same utility model in Python
- remove remaining repeated cache logic from routes
- standardize stale handling
- make TTLs explicit and auditable

## Design Constraints

1. Cache correctness is more important than cache aggressiveness.
2. The app should never silently use stale data for live execution decisions that require freshness.
3. Cold-data screens should prefer stale cache over user-visible failure.
4. Cache metadata must be inspectable on disk.
5. Incremental refresh beats full redownload whenever possible.

## Immediate Next Steps

1. Mirror the shared cache utility pattern into Python services.
2. Add top-level `freshness` blocks to any remaining cached routes that still expose only raw data.
3. Standardize explicit stale-fallback semantics route by route.
4. Add a repo-wide TTL registry so cache policy is centralized.

## Bottom Line

The app should not aim for "always live" data everywhere.

It should aim for:

- live where necessary
- cached where sensible
- stale-aware everywhere

That is the right performance/reliability architecture for this system.
