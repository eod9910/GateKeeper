# Market Intelligence Scenario Engine — API Contract (v1)

> **Status:** Phase 0 deliverable. Frozen for Phase 1 implementation.
> **Source of truth:** This document + `backend/src/types/marketIntelligence.ts`.
> **Companion docs:** `.planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md` (§API Shape, §UI Contract).
> **Schema version:** `1` — see `MARKET_INTELLIGENCE_SCHEMA_VERSION`.
> **Frozen on:** 2026-04-26.

---

## 0. Purpose

This document is the **immutable Phase-0 freeze of the HTTP contract** for the Market Intelligence Scenario Engine. Phase 1 routes (`backend/src/routes/marketIntelligence.ts`) implement against it; the dual-panel UI mock in `frontend/public/market-intelligence.html` consumes shapes that match it.

Anything that contradicts this document either:

1. requires a `schema_version` bump and explicit migration plan, or
2. is a documented Phase 2+ extension listed in §10 below.

If you find a discrepancy between this contract and `marketIntelligence.ts`, the **TypeScript types win** — file an issue, fix this document.

---

## 1. Conventions

### 1.1 Base path

All routes are mounted under:

```
/api/market-intelligence
```

### 1.2 Response envelope

All routes use the same envelope as `routes/socialIntelligence.ts`:

```json
{ "success": true,  "data": <payload> }
{ "success": false, "error": "<message>", "code": "<machine_code>" }
```

- `success` is always present.
- On success, `data` is the response payload.
- On error, `error` is a human-readable message; `code` is a machine-readable error code from the table below.

### 1.3 Status codes

| Code | When                                                               |
| ---- | ------------------------------------------------------------------ |
| 200  | OK (synchronous result)                                            |
| 201  | Resource created (operator-promoted scenarios)                     |
| 202  | Accepted — work queued, returns `{ job_id, started_at }`           |
| 304  | Not modified — cached scenario list still fresh (see §1.7)         |
| 400  | Validation error (malformed query/body, unknown enum)              |
| 401  | Unauthorized — operator endpoints require auth (Phase 4+)          |
| 404  | Unknown id/slug                                                    |
| 409  | State conflict — e.g. forcing a state transition that's not legal  |
| 422  | Schema-version mismatch in the request body                        |
| 500  | Unexpected server error                                            |

### 1.4 Error codes

Stable strings emitted in the `code` field. Phase-1 set:

| Code                          | Meaning                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `VALIDATION_FAILED`           | One or more query/body params failed schema validation          |
| `UNKNOWN_SCENARIO`            | id/slug doesn't resolve                                         |
| `UNKNOWN_EMERGING_TOPIC`      | id doesn't resolve                                              |
| `UNKNOWN_SYMBOL`              | symbol not in `coverage_tiers` cache                            |
| `UNKNOWN_CONCEPT`             | id doesn't resolve in `tracked_concepts`                        |
| `UNKNOWN_THEME`               | theme key not in `theme_registry`                               |
| `UNKNOWN_SOURCE_TYPE`         | not in the `SourceType` union                                   |
| `INVALID_STATE_TRANSITION`    | State override would violate the lifecycle rules                |
| `SCHEMA_VERSION_MISMATCH`     | Request body declared `schema_version` ≠ server's current       |
| `SUPPRESSED`                  | Asked for a row hidden by suppression rules without opt-in flag |
| `JOB_FAILED_TO_QUEUE`         | Background queue rejected the job                               |
| `BUDGET_EXHAUSTED`            | LLM budget for the day exceeded; `LLM_BUDGET_EXHAUSTED` flag    |
| `RATE_LIMITED`                | Operator action throttled (Phase 4+)                            |

### 1.5 Timestamps

- Wire format: **unix epoch seconds**, integer (`number` in TS).
- Never milliseconds, never ISO strings.
- The UI is responsible for formatting.
- Exception: `created_at` / `updated_at` audit columns on operator actions also use seconds.

### 1.6 IDs and slugs

- `:id_or_slug` accepts either:
  - a positive integer id (`market_situations.id`), or
  - a kebab-case slug (`market_situations.slug`).
- Slugs are stable for the lifetime of a scenario; never reissued, never reused after archival.

### 1.7 Caching / freshness

- All read endpoints set `Cache-Control: no-store` for v1 (the data is "live").
- `freshness_seconds` on every scenario row is `now - last_updated_at` and is the canonical freshness signal — clients should NOT compute their own.
- Phase 5 may switch to ETag-based 304s; until then assume every GET hits the DB.

### 1.8 Pagination

- `GET /scenarios` and `GET /emerging-topics` accept a `limit` param (defaults documented per endpoint, max 200).
- `GET /scenarios/:id_or_slug/evidence` is the only paginated endpoint in v1; uses `?cursor=<id>&limit=<n>`.
- Other detail endpoints return all rows up to a hard cap (documented per endpoint).
- No offset-based pagination — cursors only, to survive concurrent inserts.

### 1.9 Schema version

- Every scenario response includes `schema_version` (currently `1`).
- POST bodies that include user-supplied JSON (e.g. operator exposure overrides) MAY include `schema_version`; if present and != server's current, the request returns 422 `SCHEMA_VERSION_MISMATCH`.
- Bumping the schema version is a coordinated change touching:
  1. `backend/scripts/build_market_intelligence_db.py` (migration),
  2. `backend/src/types/marketIntelligence.ts` (types),
  3. this document.

### 1.10 Idempotency

- All write endpoints are idempotent by `(target_id, action_type)` — re-issuing the same operator action is a no-op that returns the current state.
- The asynchronous endpoints (`/recompute-all`, `/coverage-tiers/recompute`) collapse concurrent requests into one in-flight job; calling twice within the same minute returns the same `job_id`.

### 1.11 Auth model (placeholder)

- Phase 1: localhost-only, no auth.
- Phase 4+: operator endpoints (`POST /scenarios/.../state`, `/exposure`, `/promote`, `/coverage-tiers/recompute`, `/tracked-concepts/.../status`) require a session header. Read endpoints stay open for now.

### 1.12 CORS

- Same-origin only in v1. The UI is served from the same Express process.

### 1.13 Snake_case everywhere

- Query params, body fields, and response fields all use `snake_case`.
- This is non-negotiable — it matches the SQL schema, the TS types, and the existing `socialIntelligence` routes.

### 1.14 Boolean encoding

- Booleans on the wire are JSON `true` / `false`.
- Booleans in query strings: any of `true`, `1`, `yes` (case-insensitive) → true; everything else → false.

---

## 2. Read endpoints

### 2.1 `GET /scenarios`

Ranked scenario stream. Powers both panels of the dual-panel UI.

#### Query params

All optional. Comma-list params accept e.g. `?status=EARLY,DEVELOPING`.

| Param                     | Type            | Default                                 | Notes                                                     |
| ------------------------- | --------------- | --------------------------------------- | --------------------------------------------------------- |
| `status`                  | comma-list      | `EARLY,DEVELOPING,CONFIRMED`            | One of `ScenarioStatus`                                   |
| `theme`                   | string          | —                                       | One of `theme_registry.theme_key`                         |
| `scenario_type`           | string          | —                                       | One of `ScenarioType`                                     |
| `time_horizon`            | string          | —                                       | One of `TimeHorizon`                                      |
| `engine`                  | string          | `both`                                  | `EngineFilter` — high-level filter mapped to `detection_path` |
| `detection_path`          | comma-list      | —                                       | Lower-level filter; **overrides `engine` if provided**    |
| `coverage_tier`           | comma-list      | engine-dependent (see below)            | One of `CoverageTier`                                     |
| `min_authenticity_score`  | float 0..1      | `0.65`                                  | Applied **only to Social Arbitrage** rows. Pass `0` to see borderline rows. |
| `min_signal_strength`     | int 0..100      | `0`                                     |                                                           |
| `min_confidence`          | float 0..1      | `0`                                     |                                                           |
| `min_peak_z`              | float           | —                                       | Applied **only to Social Arbitrage** rows                 |
| `cross_platform_only`     | boolean         | `false`                                 | Filters Social Arbitrage rows                             |
| `only_early`              | boolean         | `false`                                 | Shorthand for `status=EARLY`                              |
| `include_archived`        | boolean         | `false`                                 |                                                           |
| `include_invalidated`     | boolean         | `false`                                 | Required to see `status=INVALIDATED`                      |
| `include_suppressed`      | boolean         | `false`                                 | **Required** to see `LIKELY_INAUTHENTIC` rows             |
| `limit`                   | int 1..200      | `50`                                    |                                                           |

`engine` mapping rules:
- `engine=macro`            → `detection_path ∈ {news_cluster, mixed_news_led}`
- `engine=social_arbitrage` → `detection_path ∈ {topic_anomaly, mixed_anomaly_led}`
- `engine=both`             → no filter (all four `detection_path` values)

`coverage_tier` defaults:
- When the request resolves to **Social Arbitrage rows only** → default = `barely_covered,lightly_covered,well_covered` (mega excluded per D22).
- When **Macro is in scope** (`engine=macro` or `engine=both`) → default = all four tiers.
- Pass `coverage_tier` explicitly to override.

#### Response

`200 OK`:

```json
{
  "success": true,
  "data": {
    "items": [ApiScenarioListItem, ...],
    "count": 12,
    "limit": 50,
    "as_of": 1735776090,
    "schema_version": 1
  }
}
```

`ApiScenarioListItem` is exactly the type defined in `marketIntelligence.ts`:

```jsonc
{
  "id": 123,
  "slug": "frame-cosmetics-dupe-spike-2026-04",
  "title": "Frame Cosmetics — Drugstore Dupe Discovery Spike",
  "summary": "...",
  "status": "EARLY",
  "scenario_type": "single_company_catalyst",
  "primary_theme": "consumer_strength",
  "detection_path": "topic_anomaly",
  "seeded_emerging_topic_id": 4421,
  "coverage_tier": "lightly_covered",
  "edge_multiplier": 1.2,
  "authenticity_score": 0.81,
  "peak_z_score": 4.6,
  "cross_platform_corroboration": true,
  "signal_strength": 72,
  "confidence_score": 0.58,
  "confidence_level": "medium",
  "time_horizon": "weeks",
  "scenario_score": 79,
  "started_at": 1735689600,
  "last_updated_at": 1735776000,
  "expires_at": 1743462000,
  "evidence_count": 14,
  "validity_flags": ["LOW_HISTORY"],
  "top_universe_candidates": [
    { "symbol": "FRMC", "composite_rank": 82.7, "coverage_tier": "lightly_covered", "exposure_direction": "long_beneficiary" }
  ],
  "freshness_seconds": 142,
  "schema_version": 1
}
```

#### Error cases

- `400 VALIDATION_FAILED` — unknown enum value or `min_authenticity_score < 0`
- `400 UNKNOWN_THEME` — `theme` not in `theme_registry`

---

### 2.2 `GET /scenarios/:id_or_slug`

Full scenario detail.

#### Path params

- `:id_or_slug` — integer or kebab-case slug

#### Query params

None.

#### Response

`200 OK` with `data: ApiScenarioDetail`. Extends `ApiScenarioListItem` with:

```jsonc
{
  ...ApiScenarioListItem fields,
  "first_order_effects":  [OrderEffectSnapshot, ...],
  "second_order_effects": [OrderEffectSnapshot, ...],
  "confidence_reasons":   ["High account-quality + cross-platform spread", "..."],
  "conviction_layer": {
    "thesis_summary": "...",
    "why_now": "...",
    "what_breaks_it": "...",
    "expression_notes": "...",
    "generated_at": 1735776000,
    "prompt_template_version": "2026-04-25-v1",
    "cited_evidence_ids": [221, 224, 230]
  },
  "affected_sectors": ["consumer_discretionary"],
  "affected_assets":  ["FRMC", "ULTA"],
  "evidence_timeline": [ApiEvidenceItem, ...],   // capped at 50; use /evidence for full
  "consequence_map": {
    "nodes": [ { "id": "theme:beauty_dupe_culture", "label": "Beauty dupe culture", "kind": "theme" }, ... ],
    "edges": [ { "from": "theme:beauty_dupe_culture", "to": "equity:FRMC", "exposure_direction": "long_beneficiary", "exposure_order": "first", "exposure_strength": 0.85 } ]
  },
  "exposure_list": [RowSituationExposure, ...],   // capped at 50
  "top_universe_candidates": [ApiUniverseCandidate, ...]   // capped at 20
}
```

`OrderEffectSnapshot`, `ApiEvidenceItem`, `ApiConsequenceGraph`, `ApiUniverseCandidate`, and `ConvictionLayer` are defined in `marketIntelligence.ts`.

`conviction_layer` is `null` until the §Conviction Producer LLM job runs (Phase 4+).

#### Error cases

- `404 UNKNOWN_SCENARIO`

---

### 2.3 `GET /scenarios/:id_or_slug/candidates`

Investable names with full per-candidate detail. Used by the drawer's candidates table.

#### Query params

| Param           | Type     | Default            | Notes                                               |
| --------------- | -------- | ------------------ | --------------------------------------------------- |
| `coverage_tier` | comma-list | engine-dependent  | Same default rules as `GET /scenarios`              |
| `min_rank`      | float    | `0`                | Filters by `composite_rank`                         |
| `limit`         | int      | `50` (max 200)     |                                                     |

#### Response

`200 OK`:

```jsonc
{
  "success": true,
  "data": {
    "scenario_id": 123,
    "scenario_slug": "frame-cosmetics-dupe-spike-2026-04",
    "items": [
      {
        "exposure_id": 9001,
        "symbol": "FRMC",
        "asset_type": "equity",
        "exposure_direction": "long_beneficiary",
        "exposure_order": "first",
        "exposure_strength": 0.85,
        "exposure_rationale": "Dupe positioning expands TAM into mass-market cosmetics buyer",
        "source_method": "hand_curated",
        "confidence": 1.0,
        "coverage_tier": "lightly_covered",
        "valuation": {
          "dcf_gap_pct": 0.18,
          "valuation_score": 72.0,
          "quality_score": 64.0
        },
        "technical": {
          "technical_score": 78.0,
          "technical_readiness": "constructive",
          "active_primitives": ["base_complete", "rs_break"]
        },
        "social": {
          "final_buzz_score": 4.9,
          "buzz_zscore": 4.6,
          "mention_velocity": 312
        },
        "composite_rank": 91.2,
        "last_ranked_at": 1735776000
      }
    ],
    "count": 1,
    "as_of": 1735776090,
    "schema_version": 1
  }
}
```

`valuation`, `technical`, and `social` blocks are nullable when the underlying scorer hasn't produced a value yet (e.g. social is `null` for pure-Macro scenarios).

#### Error cases

- `404 UNKNOWN_SCENARIO`

---

### 2.4 `GET /scenarios/:id_or_slug/evidence`

Paginated evidence timeline.

#### Query params

| Param            | Type   | Default        | Notes                                                  |
| ---------------- | ------ | -------------- | ------------------------------------------------------ |
| `cursor`         | int    | —              | `id` of the last item from the previous page           |
| `limit`          | int    | `50` (max 200) |                                                        |
| `evidence_type`  | enum   | —              | One of `EvidenceType`                                  |
| `since`          | int    | —              | Unix seconds; only return rows with `published_at >= since` |

#### Response

`200 OK`:

```jsonc
{
  "success": true,
  "data": {
    "scenario_id": 123,
    "items": [ApiEvidenceItem, ...],     // sorted by published_at DESC
    "next_cursor": 187,                   // null when there are no more pages
    "as_of": 1735776090,
    "schema_version": 1
  }
}
```

#### Error cases

- `404 UNKNOWN_SCENARIO`
- `400 VALIDATION_FAILED` — unknown `evidence_type`

---

### 2.5 `GET /themes`

Returns the closed set of themes for the UI's filter dropdown.

#### Query params

None.

#### Response

```jsonc
{
  "success": true,
  "data": {
    "items": [
      {
        "theme_key": "beauty_dupe_culture",
        "display_name": "Beauty dupe culture",
        "category": "consumer",
        "taxonomy_version": 1,
        "created_at": 1735689600
      }
    ],
    "taxonomy_version": 1
  }
}
```

`taxonomy_version` is the **maximum** `taxonomy_version` across all rows; when the seed file `theme-taxonomy.json` is bumped, this number changes and the UI is expected to invalidate its filter cache.

---

### 2.6 `GET /emerging-topics`

Powers the Research tab — raw z-score engine output, including topics that did not seed scenarios.

#### Query params

| Param                  | Type     | Default | Notes                                                |
| ---------------------- | -------- | ------- | ---------------------------------------------------- |
| `min_z`                | float    | `3.0`   |                                                      |
| `min_authenticity`     | float    | `0.5`   |                                                      |
| `cross_platform_only`  | boolean  | `false` |                                                      |
| `community`            | string   | —       | Filters to topics seeded in this community           |
| `concept_target_type`  | enum     | —       | One of `TargetType`                                  |
| `seeded_only`          | boolean  | `false` | Only return topics with non-null `seeded_situation_id` |
| `include_suppressed`   | boolean  | `false` | Required to see rows with non-null `suppression_reason` |
| `limit`                | int      | `100` (max 500) |                                              |

#### Response

```jsonc
{
  "success": true,
  "data": {
    "items": [ApiEmergingTopicItem, ...],
    "count": 47,
    "limit": 100,
    "as_of": 1735776090,
    "schema_version": 1
  }
}
```

`ApiEmergingTopicItem` is defined in `marketIntelligence.ts`. Example row:

```jsonc
{
  "id": 4421,
  "concept": {
    "id": 89,
    "concept_key": "frame_primer_dupe",
    "target_type": "brand",
    "target_key": "frame_cosmetics",
    "display_label": "Frame Cosmetics primer dupe"
  },
  "seed_community": "discord:beauty-uncovered",
  "peak_z_score": 4.6,
  "current_z_score": 3.8,
  "cross_platform_corroboration": true,
  "corroborating_communities": ["bluesky:#beauty", "stocktwits:$FRMC"],
  "migration_to_ticker_indexed": true,
  "migrated_at": 1735690000,
  "first_anomaly_at": 1735689600,
  "last_anomaly_at": 1735776000,
  "total_mentions": 312,
  "unique_authors": 218,
  "authenticity_score": 0.81,
  "resolved_target_type": "brand",
  "resolved_tickers": [
    { "symbol": "FRMC", "coverage_tier": "lightly_covered", "confidence": 1.0, "source_method": "hand_curated" }
  ],
  "seeded_situation_id": 123,
  "suppression_reason": null
}
```

---

### 2.7 `GET /emerging-topics/:id/authenticity`

Per-signal breakdown of one topic's authenticity score.

#### Path params

- `:id` — integer (`emerging_topics.id`)

#### Query params

| Param   | Type | Default | Notes                                                                       |
| ------- | ---- | ------- | --------------------------------------------------------------------------- |
| `as_of` | int  | latest  | Unix seconds; if provided, returns the audit row closest to that timestamp  |

#### Response

```jsonc
{
  "success": true,
  "data": {
    "emerging_topic_id": 4421,
    "authenticity_score": 0.81,
    "computed_at": 1735776000,
    "signals": [
      { "type": "account_age_distribution", "value": 0.78, "weight": 0.15, "notes": "Median age 412 days; long tail to 2014 accounts" },
      { "type": "cross_platform_signature", "value": 0.92, "weight": 0.15, "notes": "Spread to bluesky:#beauty within 36h" },
      { "type": "comment_depth",             "value": 0.71, "weight": 0.10, "notes": "Avg thread depth 4.2 replies" },
      { "type": "sentiment_shape",           "value": 0.85, "weight": 0.10, "notes": "Polarity SD 0.58" },
      { "type": "linguistic_similarity",     "value": 0.94, "weight": 0.10, "notes": "Avg pairwise cosine 0.31 — organic" },
      { "type": "account_quality",           "value": 0.81, "weight": 0.10, "notes": "Avg karma 4.2k" },
      { "type": "mod_flag_rate",             "value": 0.95, "weight": 0.05, "notes": "Zero auto-removed comments" },
      { "type": "promoter_co_occurrence",    "value": 0.88, "weight": 0.10, "notes": "No detected affiliate ring" },
      { "type": "posting_cadence",           "value": 0.79, "weight": 0.10, "notes": "Diurnal pattern matches baseline" },
      { "type": "account_history_diversity", "value": 0.86, "weight": 0.05, "notes": "Authors active in unrelated communities pre-spike" }
    ],
    "hard_limits_triggered": [],
    "schema_version": 1
  }
}
```

`hard_limits_triggered` is a (possibly empty) list of strings naming any §Authenticity Layer hard-limit rules that fired (e.g. `"ACCOUNT_AGE_FLOOR"`, `"PROMOTER_RING_DETECTED"`). When non-empty the row is automatically marked `LIKELY_INAUTHENTIC` regardless of weighted score.

#### Error cases

- `404 UNKNOWN_EMERGING_TOPIC`

---

### 2.8 `GET /coverage-tiers/:symbol`

Cached coverage-tier classification for one symbol.

#### Path params

- `:symbol` — uppercase ticker

#### Response

```jsonc
{
  "success": true,
  "data": {
    "symbol": "FRMC",
    "coverage_tier": "lightly_covered",
    "edge_multiplier": 1.2,
    "composite_score": 32.1,
    "sellside_analyst_count": 4,
    "market_cap_usd": 2400000000,
    "institutional_ownership_pct": 38.2,
    "mainstream_mention_count_90d": 7,
    "daily_dollar_volume_avg": 14200000,
    "as_of": 1735689600,
    "schema_version": 1
  }
}
```

`edge_multiplier` is the per-tier multiplier that the Social Arbitrage scoring profile applies (D22). Server-computed; never user-supplied.

#### Error cases

- `404 UNKNOWN_SYMBOL`

---

### 2.9 `GET /healthcheck`

Scheduler + collector status. Mirrors `GET /api/social-intelligence/settings`.

#### Response

```jsonc
{
  "success": true,
  "data": {
    "scheduler": {
      "is_running": true,
      "started_at": 1735680000,
      "next_run_at": 1735776600
    },
    "collectors": [
      {
        "source_type": "rss_reuters",
        "last_run_at": 1735775400,
        "last_ok_at": 1735775400,
        "last_error": null,
        "rows_ingested_last_run": 47
      },
      {
        "source_type": "discord_public",
        "last_run_at": 1735775000,
        "last_ok_at": 1735775000,
        "last_error": null,
        "rows_ingested_last_run": 3120
      }
    ],
    "scenario_counts": {
      "EARLY": 7,
      "DEVELOPING": 12,
      "CONFIRMED": 9,
      "CROWDED": 3,
      "FADING": 5,
      "INVALIDATED_24h": 2,
      "LIKELY_INAUTHENTIC_24h": 4
    },
    "llm_budget": {
      "daily_cap_usd": 12.0,
      "spent_today_usd": 4.30,
      "concept_extraction_calls_today": 8421,
      "exhausted": false
    },
    "as_of": 1735776090,
    "schema_version": 1
  }
}
```

When `llm_budget.exhausted = true`, all scenarios written today receive the `LLM_BUDGET_EXHAUSTED` validity flag.

---

## 3. Write / admin endpoints

### 3.1 `POST /scenarios/:id_or_slug/recompute`

Synchronous rollup recompute for one scenario. Returns the recomputed row.

#### Path params

- `:id_or_slug`

#### Body

```jsonc
{ "reason": "manual operator refresh" }   // optional; logged for audit
```

#### Response

`200 OK` with `data: ApiScenarioListItem` (the freshly-recomputed row).

#### Error cases

- `404 UNKNOWN_SCENARIO`

---

### 3.2 `POST /recompute-all`

Background full sweep across all `EARLY`/`DEVELOPING`/`CONFIRMED`/`CROWDED` scenarios.

#### Body

None.

#### Response

`202 Accepted`:

```jsonc
{
  "success": true,
  "data": {
    "job_id": "recompute-all-1735776000",
    "started_at": 1735776000,
    "estimated_seconds": 35
  }
}
```

Re-issuing the same call within 60s returns the same `job_id` (idempotent collapse).

---

### 3.3 `POST /scenarios/:id_or_slug/state`

Operator state override.

#### Body

```jsonc
{
  "status": "INVALIDATED",
  "reason": "Underlying claim failed fact-check; see PR #214."
}
```

- `status` must be one of `ScenarioStatus`.
- `reason` is required (≥ 5 chars), persisted to `state_audit`.

#### Response

`200 OK` with `data: ApiScenarioListItem` (the post-transition row).

#### Error cases

- `404 UNKNOWN_SCENARIO`
- `400 VALIDATION_FAILED` — missing/short `reason`, unknown `status`
- `409 INVALID_STATE_TRANSITION` — can't go `FADING` → `EARLY`, etc. Lifecycle rules in PRD §State machine.

---

### 3.4 `POST /scenarios/:id_or_slug/exposure`

Operator-added or overridden exposure row.

#### Body

```jsonc
{
  "asset_type": "equity",
  "asset_key": "FRMC",
  "exposure_direction": "long_beneficiary",
  "exposure_order": "first",
  "exposure_strength": 0.7,
  "rationale": "Operator added based on conference-call commentary",
  "confidence": 0.6,
  "universe_symbol": "FRMC",
  "schema_version": 1
}
```

- `source_method` is forced to `operator_override` server-side; clients MUST NOT supply it.
- All numeric ranges are validated against the SQL CHECK constraints.

#### Response

`201 Created`:

```jsonc
{
  "success": true,
  "data": { "exposure": RowSituationExposure }
}
```

#### Error cases

- `404 UNKNOWN_SCENARIO`
- `400 VALIDATION_FAILED`
- `422 SCHEMA_VERSION_MISMATCH`

---

### 3.5 `POST /collectors/:source_type/run`

Manually triggers one collector.

#### Path params

- `:source_type` — one of `SourceType`

#### Body

```jsonc
{ "since": 1735680000 }   // optional unix-seconds floor; default = collector's stored watermark
```

#### Response

`202 Accepted`:

```jsonc
{
  "success": true,
  "data": {
    "job_id": "collector-discord_public-1735776000",
    "source_type": "discord_public",
    "started_at": 1735776000
  }
}
```

#### Error cases

- `400 UNKNOWN_SOURCE_TYPE`

---

### 3.6 `POST /emerging-topics/:id/recompute-authenticity`

Re-runs the §Authenticity Layer scoring for one emerging topic. Persists a new `authenticity_signals` audit row.

#### Body

```jsonc
{ "reason": "weight tuning experiment 2026-04-26" }   // optional, logged
```

#### Response

`200 OK` with the same shape as `GET /emerging-topics/:id/authenticity`.

#### Error cases

- `404 UNKNOWN_EMERGING_TOPIC`

---

### 3.7 `POST /emerging-topics/:id/promote`

Operator override — forces creation of a `market_situations` row from a topic that was suppressed.

#### Body

```jsonc
{
  "reason": "Manual review confirmed organic spread despite low cross_platform_signature; see ticket #418.",
  "override_validity_flag": "OPERATOR_OVERRODE_AUTHENTICITY"
}
```

- `reason` required (≥ 10 chars).
- `override_validity_flag` defaults to `OPERATOR_OVERRODE_AUTHENTICITY`; can also be `MEGA_COVERAGE_PENALTY` for `MEGA_COVERED_ONLY` overrides.

#### Response

`201 Created`:

```jsonc
{
  "success": true,
  "data": {
    "scenario": ApiScenarioListItem,
    "audit_row_id": 7712
  }
}
```

#### Error cases

- `404 UNKNOWN_EMERGING_TOPIC`
- `409 INVALID_STATE_TRANSITION` — topic already has a non-null `seeded_situation_id`

---

### 3.8 `POST /coverage-tiers/recompute`

Triggers a full coverage-tier recompute. Default schedule is weekly; this is the ad-hoc refresh hook.

#### Body

```jsonc
{ "scope": "all" }   // optional; "all" (default) | "delta" (only symbols touched in last 7d)
```

#### Response

`202 Accepted`:

```jsonc
{
  "success": true,
  "data": {
    "job_id": "coverage-tier-recompute-1735776000",
    "started_at": 1735776000,
    "scope": "all",
    "estimated_seconds": 120
  }
}
```

---

### 3.9 `POST /tracked-concepts/:id/status`

Operator can mark a concept as `pruned` or `merged_into:<id>`. Pruned concepts stop generating concept_mentions on next collector run; merged concepts redirect future mentions.

#### Body

```jsonc
{
  "status": "pruned",            // or "merged_into:<id>" or "active"
  "reason": "Confirmed spam / duplicate of concept 412."
}
```

- `status` is a free-form string but must match one of the allowed patterns (`active`, `pruned`, `merged_into:<positive_int>`).
- When merging into another concept, the target concept must already exist.

#### Response

`200 OK` with `data: RowTrackedConcept` (the updated row).

#### Error cases

- `404 UNKNOWN_CONCEPT`
- `400 VALIDATION_FAILED` — malformed `status`
- `409 INVALID_STATE_TRANSITION` — merge target doesn't exist or merge cycle would form

---

## 4. Scheduler control endpoints

These four endpoints mirror the existing `/api/social-intelligence/*` routes one-for-one and reuse the same envelope. They are a thin wrapper around the `marketIntelligenceScheduler` service (Phase 1 deliverable).

### 4.1 `GET /settings`

Returns scheduler config + status.

```jsonc
{
  "success": true,
  "data": {
    "is_running": true,
    "started_at": 1735680000,
    "next_run_at": 1735776600,
    "last_collect_at": 1735775000,
    "last_finalize_at": 1735774000,
    "config": {
      "collect_cadence_minutes": 5,
      "finalize_cadence_minutes": 60,
      "topic_baseline_cadence_hours": 24,
      "coverage_tier_cadence_days": 7,
      "llm_daily_budget_usd": 12.0,
      "concept_extraction": {
        "model": "gpt-4o-mini",
        "batch_size": 50,
        "registry_skip_enabled": true
      }
    }
  }
}
```

### 4.2 `PUT /settings`

#### Body

A partial `config` object (any subset of the fields above). Server merges with current config.

```jsonc
{ "collect_cadence_minutes": 10, "llm_daily_budget_usd": 15.0 }
```

#### Response

Same shape as `GET /settings`, reflecting the merged config.

#### Error cases

- `400 VALIDATION_FAILED` — out-of-range cadence, invalid model name, etc.

### 4.3 `POST /scheduler/start`

#### Body

None.

#### Response

`200 OK`:

```jsonc
{
  "success": true,
  "data": { "is_running": true, "started_at": 1735776090, "next_run_at": 1735776390 }
}
```

### 4.4 `POST /scheduler/stop`

#### Body

```jsonc
{ "drain": true }   // optional; default false. When true, waits for in-flight collectors to finish.
```

#### Response

`200 OK`:

```jsonc
{
  "success": true,
  "data": { "is_running": false, "stopped_at": 1735776100 }
}
```

---

## 5. Suppression behaviour (cross-cutting)

Suppression is a recurring concept across endpoints. Canonical rules:

| Suppression                                          | Hidden by default in        | Visible when                                                        |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| `LIKELY_INAUTHENTIC` (`emerging_topics.suppression_reason`) | `GET /scenarios`, `GET /emerging-topics` | Pass `include_suppressed=true`                              |
| `MEGA_COVERED_ONLY`                                  | `GET /scenarios` (Social Arb) | Pass `coverage_tier=mega_covered` explicitly OR `engine=macro`    |
| `NO_COVERAGE_ELIGIBLE_TICKERS`                       | `GET /scenarios`            | Pass `include_suppressed=true`                                      |
| `status=INVALIDATED`                                 | `GET /scenarios`            | Pass `include_invalidated=true`                                     |
| `archived_at != null`                                | `GET /scenarios`            | Pass `include_archived=true`                                        |

`POST /emerging-topics/:id/promote` is the ONLY way to convert a suppressed topic into a `market_situations` row.

---

## 6. Filter-default routing rules (D26 / D27)

Critical for not surprising the user. Every list endpoint applies these:

1. **Macro scenarios are NEVER hidden by default.** No "macro-only" filter excludes them.
2. **Social Arbitrage scenarios are filtered by default** to:
   - `coverage_tier ∈ {barely_covered, lightly_covered, well_covered}`
   - `authenticity_score ≥ 0.65`
   - This is the asymmetric-edge slot's selectivity baseline (D22).
3. **The `engine` query param is the user's intent signal.** When `engine=both` is requested, the server applies *each engine's own defaults to its own rows*, then unions the results.
4. **`detection_path` overrides `engine`.** Operators in research mode use `detection_path=topic_anomaly,mixed_anomaly_led,news_cluster,mixed_news_led` to see everything.
5. **`include_suppressed=true` is research-only.** It does not relax #2; the user must also pass `min_authenticity_score=0` and `coverage_tier=mega_covered` to actually see the suppressed rows.

---

## 7. Concrete request / response examples

### 7.1 Default page load (UI calls this on mount)

```http
GET /api/market-intelligence/scenarios HTTP/1.1
```

→ 200, both engines visible, Social Arb filtered to authenticity ≥ 0.65 + non-mega coverage, Macro filtered to `EARLY/DEVELOPING/CONFIRMED`.

### 7.2 Macro-only view, weeks horizon, ≥ 50 strength

```http
GET /api/market-intelligence/scenarios?engine=macro&time_horizon=weeks&min_signal_strength=50
```

### 7.3 Social Arb research view (see suppressed)

```http
GET /api/market-intelligence/scenarios?engine=social_arbitrage&include_suppressed=true&min_authenticity_score=0&coverage_tier=barely_covered,lightly_covered,well_covered,mega_covered,untradable
```

### 7.4 Operator invalidation

```http
POST /api/market-intelligence/scenarios/frame-cosmetics-dupe-spike-2026-04/state HTTP/1.1
Content-Type: application/json

{ "status": "INVALIDATED", "reason": "Founder-CEO confirmed product is discontinued; thesis dead." }
```

### 7.5 Promote a suppressed topic

```http
POST /api/market-intelligence/emerging-topics/4421/promote HTTP/1.1
Content-Type: application/json

{ "reason": "Operator review confirmed organic spread despite borderline cross_platform_signature." }
```

### 7.6 Healthcheck (scheduler dashboard polls this every 30s)

```http
GET /api/market-intelligence/healthcheck
```

---

## 8. Type registry (canonical)

For convenience, full enum values exposed in this contract — kept in lockstep with `marketIntelligence.ts`. **The TS file is the source of truth**; this list exists so this document is self-contained.

| TS type                  | Values                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `ScenarioStatus`         | `EARLY`, `DEVELOPING`, `CONFIRMED`, `CROWDED`, `FADING`, `INVALIDATED`                                                         |
| `ScenarioType`           | `macro`, `geopolitical`, `commodity`, `policy`, `sector_rotation`, `single_company_catalyst`, `consumer_cycle`, `tech_disruption`, `other` |
| `TimeHorizon`            | `intraday`, `days`, `weeks`, `months`, `quarters`, `structural`                                                                |
| `DetectionPath`          | `topic_anomaly`, `news_cluster`, `mixed_news_led`, `mixed_anomaly_led`                                                          |
| `EngineFilter`           | `macro`, `social_arbitrage`, `both`                                                                                            |
| `CoverageTier`           | `mega_covered`, `well_covered`, `lightly_covered`, `barely_covered`, `untradable`                                              |
| `ConfidenceLevel`        | `low`, `medium`, `high`                                                                                                        |
| `ExposureDirection`      | `long_beneficiary`, `short_loser`, `volatility_up`, `volatility_down`, `direction_uncertain`                                   |
| `ExposureOrder`          | `first`, `second`, `third`                                                                                                     |
| `SourceMethod`           | `hand_curated`, `llm_assist`, `operator_override`, `derived`                                                                   |
| `AssetType`              | `equity`, `sector`, `industry`, `commodity`, `fx`, `rate`, `etf`                                                               |
| `SignalType`             | `news_event`, `filing_event`, `social_buzz_spike`, `price_confirmation`, `consumer_cycle_state_change`, `invalidating_event`, `policy_release`, `macro_release` |
| `EvidenceType`           | `article`, `filing`, `social_post_cluster`, `price_chart`, `policy_release`, `consumer_cycle_note`                              |
| `TargetType`             | `brand`, `product`, `category`, `behavior`, `keyword`, `event_type`                                                            |
| `ConceptIntent`          | `adoption`, `abandonment`, `complaint`, `praise`, `comparison`, `question`, `prediction`                                       |
| `Polarity`               | `-1`, `0`, `1`                                                                                                                 |
| `CommunityTier`          | `niche`, `general`, `mega`                                                                                                     |
| `SuppressionReason`      | `LIKELY_INAUTHENTIC`, `NO_COVERAGE_ELIGIBLE_TICKERS`, `MEGA_COVERED_ONLY`                                                      |
| `AuthenticitySignalType` | `account_age_distribution`, `posting_cadence`, `account_history_diversity`, `cross_platform_signature`, `comment_depth`, `sentiment_shape`, `account_quality`, `mod_flag_rate`, `linguistic_similarity`, `promoter_co_occurrence` |
| `ValidityFlag`           | `LOW_HISTORY`, `ONE_SOURCE_ONLY`, `LOW_PARTICIPATION`, `NO_MARKET_CONFIRMATION`, `CONTRADICTORY_REACTION`, `HIGH_MAINSTREAM_SATURATION`, `EXPOSURE_MAP_WEAK`, `LOW_UNIVERSE_MATCH`, `NO_GOOD_EXPRESSION`, `THESIS_REAL_EXECUTION_DELAYED`, `STALE`, `CONVICTION_LAYER_UNRELIABLE`, `LLM_BUDGET_EXHAUSTED`, `LIKELY_INAUTHENTIC`, `MEGA_COVERAGE_PENALTY`, `AUTHENTICITY_BORDERLINE`, `OPERATOR_OVERRODE_AUTHENTICITY` |

---

## 9. Phase split

Not every endpoint ships in Phase 1. The minimum the dual-panel UI needs to render real data:

### Phase 1 (initial wire-up)

- `GET /scenarios`
- `GET /scenarios/:id_or_slug`
- `GET /scenarios/:id_or_slug/evidence`
- `GET /themes`
- `GET /healthcheck`
- `GET /settings`, `PUT /settings`, `POST /scheduler/start`, `POST /scheduler/stop`
- `POST /collectors/:source_type/run`

### Phase 2 (research tab + operator review)

- `GET /emerging-topics`
- `GET /emerging-topics/:id/authenticity`
- `GET /coverage-tiers/:symbol`
- `POST /scenarios/:id_or_slug/recompute`
- `POST /recompute-all`
- `POST /coverage-tiers/recompute`
- `POST /emerging-topics/:id/recompute-authenticity`
- `POST /tracked-concepts/:id/status`

### Phase 3+ (full operator workflow)

- `GET /scenarios/:id_or_slug/candidates` (full per-candidate detail; Phase 1 uses the snapshot already on `ApiScenarioDetail`)
- `POST /scenarios/:id_or_slug/state`
- `POST /scenarios/:id_or_slug/exposure`
- `POST /emerging-topics/:id/promote`

### Phase 4+ (auth, LLM-driven enrichment)

- `conviction_layer` populated on `GET /scenarios/:id_or_slug`
- Auth header + RBAC on operator endpoints

---

## 10. Out-of-scope for v1 (deliberately deferred)

- **GraphQL / batch endpoint** — not in v1; the UI is a single page that issues at most 5 requests on mount. If the request count grows, revisit.
- **WebSocket / SSE** — Phase 5+ if the UI needs sub-30s updates. v1 polls `/scenarios` every 60s.
- **Multi-tenant scoping** — single-user system per the existing `single-user-production-readiness-checklist.md`.
- **Reddit collectors** — `reddit_*` SourceType values are reserved (per D29) but no collector ships in v1.
- **Cursor-based pagination on `/scenarios`** — limit-based only in v1; the page-size cap is generous (200) and the dataset rarely exceeds it.
- **Bulk operator endpoints** — `POST /scenarios/state-bulk` is rejected as scope creep; operators act one row at a time.

---

## 11. Versioning policy

This is the v1 contract. Changes follow these rules:

| Change                                                | Action                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| Add a new optional response field                     | No version bump. Document under §"Changelog".   |
| Add a new endpoint                                    | No version bump. Document under §"Changelog".   |
| Add a new enum value to a field                       | Minor: bump `schema_version` patch (1 → 1.1).   |
| Remove a field, change a type, rename a field         | Major: bump `schema_version` (1 → 2). Both this doc and `marketIntelligence.ts` must be updated atomically. |
| Change a default (filter rules in §6)                 | Minor: bump `schema_version` patch + UI release notes. |

Phase 1 only sees v1; v2 is not contemplated until Phase 5.

---

## 12. Changelog

| Date       | Version | Author       | Change                                                |
| ---------- | ------- | ------------ | ----------------------------------------------------- |
| 2026-04-26 | 1       | Phase-0 freeze | Initial contract.                                   |
