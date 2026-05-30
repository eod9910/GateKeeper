# Social Intelligence Architecture

## Purpose

This database is the historical intelligence layer for crowd attention, social
commentary, and later news or event-derived signals.

The goal is to stop treating sentiment as:

- a live one-off lookup
- a temporary scrape
- a single current-score field

and instead track a persistent, date-aligned state for the full clean universe.

That makes it possible to answer questions like:

- what was social attention doing on the same date the stock was undervalued?
- did abnormal buzz improve forward returns?
- did euphoric sentiment plus overvaluation lead to weaker outcomes?

## Scope

Production scope should follow the clean universe:

- `backend/data/universe_clean.json`

The larger master symbol inventory remains useful for resolution, aliases,
historical mappings, and repair workflows, but it should not drive the
production social feed universe.

## Database

The social intelligence database lives at:

- `backend/data/social-intelligence.sqlite`

It is intentionally separate from:

- `backend/data/fundamentals-pit.sqlite` for PIT financial truth
- `backend/data/symbol-catalog.sqlite` for symbol identity, memberships, and
  latest snapshot metrics

## Core Model

The database tracks two layers:

### 1. Raw and cleaned post data

This is the event layer.

- `tracked_symbols`
  - the symbols actively tracked by the social engine
- `social_fetch_runs`
  - fetch-job metadata, platform, universe scope, completion status
- `social_posts_raw`
  - one row per raw post or comment gathered from a platform
- `social_posts_clean`
  - normalized post rows after cleaning, deduping, and spam flags
- `social_post_sentiment`
  - per-post sentiment classification and later topic or hype/fear scores

### 2. Derived daily ticker features

This is the usable research layer.

- `ticker_social_daily`
  - daily mention counts, breadth, sentiment mix, and engagement by symbol and
    platform
- `ticker_buzz_scores`
  - abnormality, acceleration, cross-platform confirmation, and final composite
    buzz scoring

## Why History Matters

Current sentiment alone is not enough.

The most useful signals require rolling history:

- `buzz_zscore`
- `mention_velocity`
- `mention_acceleration`
- `sentiment_trend`
- `unique_author_zscore`
- `engagement_zscore`

Without historical snapshots, the engine will over-favor names that are always
loud instead of detecting when a quiet stock is waking up.

## Current Tables

### `tracked_symbols`

Tracks which clean-universe symbols the social engine is expected to cover.

Key fields:

- `symbol`
- `universe_name`
- `active`
- `first_seen_at`
- `last_seen_at`
- `source_json`

### `social_fetch_runs`

Tracks the operational history of fetch jobs.

Key fields:

- `run_id`
- `platform`
- `universe_name`
- `status`
- `symbols_requested`
- `symbols_succeeded`
- `symbols_failed`

### `social_posts_raw`

One row per raw platform post.

Key fields:

- `symbol`
- `platform`
- `platform_post_id`
- `author_id`
- `author_handle`
- `posted_at`
- `body_text`
- `like_count`
- `reply_count`
- `repost_count`
- `engagement_score`

### `social_posts_clean`

Normalized post rows for downstream feature extraction.

Key fields:

- `raw_post_id`
- `symbol`
- `platform`
- `trade_date`
- `canonical_post_key`
- `canonical_author_key`
- `cleaned_text`
- `is_spam`
- `duplicate_group_key`

### `social_post_sentiment`

Per-post directional and topical classification.

Key fields:

- `raw_post_id`
- `symbol`
- `platform`
- `trade_date`
- `sentiment_label`
- `sentiment_score`
- `sentiment_confidence`
- `topic_label`
- `hype_score`
- `fear_score`

### `ticker_social_daily`

Daily derived features by symbol and platform.

Key fields:

- `mention_count_1d`
- `mention_count_3d`
- `mention_count_7d`
- `mention_count_30d`
- `unique_authors_1d`
- `unique_authors_7d`
- `posts_per_author`
- `author_concentration`
- `new_authors_ratio`
- `bullish_ratio`
- `bearish_ratio`
- `net_sentiment`
- `weighted_sentiment`
- `engagement_per_post`

### `ticker_buzz_scores`

Composite buzz features and sort-ready scores.

Key fields:

- `buzz_zscore`
- `unique_author_zscore`
- `engagement_zscore`
- `mention_velocity`
- `mention_acceleration`
- `sentiment_trend_3d`
- `sentiment_trend_7d`
- `yahoo_mentions`
- `stocktwits_mentions`
- `yahoo_sentiment`
- `stocktwits_sentiment`
- `cross_platform_agreement`
- `tradability_score`
- `final_buzz_score`
- `buzz_rank`

## Join Model

This database becomes most useful when joined by `symbol` and `trade_date` to:

- PIT financial state
- valuation regime state
- consumer-cycle state
- later forward returns

That is the research join we care about:

- `undervalued + rising buzz`
- `overvalued + euphoric buzz`
- `strong buzz + weak breadth`

## Build and Bootstrap

The initial bootstrap script is:

- `backend/scripts/rebuild_social_intelligence_db.py`

The first ingestion scripts are:

- `backend/scripts/collect_social_intraday.py`
- `backend/scripts/build_social_daily_snapshot.py`

Example:

```powershell
py backend/scripts/rebuild_social_intelligence_db.py --reset
```

That seeds the `tracked_symbols` table from the current clean universe and
initializes the database schema.

Example collection and daily finalize flow:

```powershell
py backend/scripts/collect_social_intraday.py --limit 200
py backend/scripts/build_social_daily_snapshot.py
```

## Implementation Phases

### Phase 1

- establish schema
- seed clean-universe tracked symbols
- persist latest snapshot sentiment and source counts

### Phase 2

- store raw StockTwits and Yahoo Finance posts historically
- normalize post-level features
- build daily aggregates

### Phase 3

- compute rolling z-scores and acceleration metrics
- rank symbols by final buzz score
- join to PIT for backtests and research studies

## Design Principle

This should be treated as its own intelligence domain.

It is not just:

- one more scanner field
- one more latest metric

It is a persistent, time-aware research layer that can be tested against
fundamentals, valuation, and future returns.
