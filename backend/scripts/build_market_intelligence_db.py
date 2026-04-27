#!/usr/bin/env python3
"""Create / migrate the market-intelligence SQLite database.

Implements the 13-table schema defined in
.planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md
(section "Backend Data Model").

Phase 0 deliverable. Idempotent: re-running on an existing DB is a no-op
unless --reset is passed.

Usage:
    py backend/scripts/build_market_intelligence_db.py
    py backend/scripts/build_market_intelligence_db.py --reset
    py backend/scripts/build_market_intelligence_db.py --dry-run
    py backend/scripts/build_market_intelligence_db.py --db-path /tmp/test.sqlite
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

SCHEMA_VERSION = 1


# Each entry is (table_name, CREATE TABLE statement). Ordered so foreign-key
# dependencies are satisfied if/when SQLite enforces FKs (PRAGMA foreign_keys=ON).
TABLES: List[Tuple[str, str]] = [
    # ------------------------------------------------------------------
    # Migration metadata (PRD D13: schema_version on every row;
    # schema_meta is the per-DB version anchor).
    # ------------------------------------------------------------------
    (
        "schema_meta",
        """
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """,
    ),

    # ------------------------------------------------------------------
    # Theme registry (closed list of valid primary_theme values; loaded
    # from theme-taxonomy.json at startup; persisted for FK integrity).
    # ------------------------------------------------------------------
    (
        "theme_registry",
        """
        CREATE TABLE IF NOT EXISTS theme_registry (
            theme_key       TEXT PRIMARY KEY,
            display_name    TEXT NOT NULL,
            category        TEXT NOT NULL CHECK (
                category IN (
                    'macro', 'geopolitical', 'commodity', 'policy',
                    'sector', 'tech', 'consumer'
                )
            ),
            taxonomy_version INTEGER NOT NULL DEFAULT 1,
            created_at       INTEGER NOT NULL
        )
        """,
    ),

    # ------------------------------------------------------------------
    # tracked_concepts (D21 topic-anomaly engine — growing registry).
    # ------------------------------------------------------------------
    (
        "tracked_concepts",
        """
        CREATE TABLE IF NOT EXISTS tracked_concepts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            concept_key     TEXT NOT NULL,
            target_type     TEXT NOT NULL CHECK (
                target_type IN (
                    'brand', 'product', 'category',
                    'behavior', 'keyword', 'event_type'
                )
            ),
            target_key      TEXT NOT NULL,
            display_label   TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            created_by      TEXT NOT NULL CHECK (
                created_by IN ('llm_extractor', 'operator', 'seed_taxonomy')
            ),
            status          TEXT NOT NULL DEFAULT 'active',
            metadata_json   TEXT
        )
        """,
    ),

    # ------------------------------------------------------------------
    # coverage_tiers (D22 — per-symbol filter, refreshed weekly).
    # ------------------------------------------------------------------
    (
        "coverage_tiers",
        """
        CREATE TABLE IF NOT EXISTS coverage_tiers (
            symbol                          TEXT PRIMARY KEY,
            coverage_tier                   TEXT NOT NULL CHECK (
                coverage_tier IN (
                    'mega_covered', 'well_covered',
                    'lightly_covered', 'barely_covered', 'untradable'
                )
            ),
            sellside_analyst_count          INTEGER,
            market_cap_usd                  REAL,
            institutional_ownership_pct     REAL,
            mainstream_mention_count_90d    INTEGER,
            daily_dollar_volume_avg         REAL,
            composite_score                 REAL,
            as_of                           INTEGER NOT NULL
        )
        """,
    ),

    # ------------------------------------------------------------------
    # brand_to_ticker (D21 S6 — small, hand-curated + LLM-extended).
    # ------------------------------------------------------------------
    (
        "brand_to_ticker",
        """
        CREATE TABLE IF NOT EXISTS brand_to_ticker (
            brand_key                TEXT PRIMARY KEY,
            parent_ticker            TEXT NOT NULL,
            secondary_tickers_json   TEXT,
            confidence               REAL NOT NULL DEFAULT 1.0,
            source_method            TEXT NOT NULL CHECK (
                source_method IN ('hand_curated', 'llm_assist', 'operator_override')
            ),
            created_at               INTEGER NOT NULL
        )
        """,
    ),

    # ------------------------------------------------------------------
    # market_situations (the canonical scenario record — center of the
    # data model; everything else FKs into this).
    # ------------------------------------------------------------------
    (
        "market_situations",
        """
        CREATE TABLE IF NOT EXISTS market_situations (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            slug                            TEXT NOT NULL UNIQUE,
            title                           TEXT NOT NULL,
            summary                         TEXT NOT NULL,
            primary_theme                   TEXT NOT NULL REFERENCES theme_registry(theme_key),
            scenario_type                   TEXT NOT NULL,
            status                          TEXT NOT NULL CHECK (
                status IN (
                    'EARLY', 'DEVELOPING', 'CONFIRMED',
                    'CROWDED', 'FADING', 'INVALIDATED'
                )
            ),
            signal_strength                 INTEGER NOT NULL CHECK (
                signal_strength BETWEEN 0 AND 100
            ),
            confidence_score                REAL NOT NULL CHECK (
                confidence_score BETWEEN 0.0 AND 1.0
            ),
            confidence_level                TEXT NOT NULL,
            time_horizon                    TEXT NOT NULL CHECK (
                time_horizon IN (
                    'intraday', 'days', 'weeks',
                    'months', 'quarters', 'structural'
                )
            ),
            started_at                      INTEGER NOT NULL,
            last_confirmed_at               INTEGER,
            last_updated_at                 INTEGER NOT NULL,
            expires_at                      INTEGER,
            event_score                     REAL,
            attention_score                 REAL,
            market_confirmation_score       REAL,
            crowding_score                  REAL,
            source_breadth_score            REAL,
            evidence_count                  INTEGER NOT NULL DEFAULT 0,
            first_order_effects_json        TEXT,
            second_order_effects_json       TEXT,
            validity_flags_json             TEXT,
            confidence_reasons_json         TEXT,
            conviction_layer_json           TEXT,
            conviction_pack_hash            TEXT,
            detection_path                  TEXT NOT NULL CHECK (
                detection_path IN (
                    'topic_anomaly', 'news_cluster',
                    'mixed_news_led', 'mixed_anomaly_led'
                )
            ),
            seeded_emerging_topic_id        INTEGER,
            coverage_tier                   TEXT,
            authenticity_score              REAL,
            peak_z_score                    REAL,
            cross_platform_corroboration    INTEGER NOT NULL DEFAULT 0 CHECK (
                cross_platform_corroboration IN (0, 1)
            ),
            edge_multiplier                 REAL NOT NULL DEFAULT 1.0,
            metadata_json                   TEXT,
            schema_version                  INTEGER NOT NULL,
            created_at                      INTEGER NOT NULL,
            updated_at                      INTEGER NOT NULL,
            archived_at                     INTEGER
        )
        """,
    ),

    # ------------------------------------------------------------------
    # situation_signals (normalized inputs that contributed to a scenario).
    # ------------------------------------------------------------------
    (
        "situation_signals",
        """
        CREATE TABLE IF NOT EXISTS situation_signals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            situation_id    INTEGER NOT NULL REFERENCES market_situations(id) ON DELETE CASCADE,
            signal_type     TEXT NOT NULL CHECK (
                signal_type IN (
                    'news_event', 'filing_event', 'social_buzz_spike',
                    'price_confirmation', 'consumer_cycle_state_change',
                    'invalidating_event', 'policy_release', 'macro_release'
                )
            ),
            source_type     TEXT NOT NULL,
            source_id       TEXT NOT NULL,
            entity          TEXT,
            theme           TEXT,
            score           REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
            weight          REAL NOT NULL DEFAULT 1.0,
            observed_at     INTEGER NOT NULL,
            ingested_at     INTEGER NOT NULL,
            payload_json    TEXT
        )
        """,
    ),

    # ------------------------------------------------------------------
    # situation_evidence (human-readable evidence with traceability).
    # ------------------------------------------------------------------
    (
        "situation_evidence",
        """
        CREATE TABLE IF NOT EXISTS situation_evidence (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            situation_id        INTEGER NOT NULL REFERENCES market_situations(id) ON DELETE CASCADE,
            evidence_type       TEXT NOT NULL CHECK (
                evidence_type IN (
                    'article', 'filing', 'social_post_cluster',
                    'price_chart', 'policy_release', 'consumer_cycle_note'
                )
            ),
            source_name         TEXT NOT NULL,
            headline_or_label   TEXT NOT NULL,
            summary             TEXT,
            url                 TEXT,
            published_at        INTEGER NOT NULL,
            importance_score    REAL,
            novelty_score       REAL,
            signal_id           INTEGER REFERENCES situation_signals(id) ON DELETE SET NULL,
            payload_json        TEXT
        )
        """,
    ),

    # ------------------------------------------------------------------
    # situation_exposure (sector / asset / security mappings).
    # ------------------------------------------------------------------
    (
        "situation_exposure",
        """
        CREATE TABLE IF NOT EXISTS situation_exposure (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            situation_id        INTEGER NOT NULL REFERENCES market_situations(id) ON DELETE CASCADE,
            asset_type          TEXT NOT NULL CHECK (
                asset_type IN (
                    'equity', 'sector', 'industry',
                    'commodity', 'fx', 'rate', 'etf'
                )
            ),
            asset_key           TEXT NOT NULL,
            exposure_direction  TEXT NOT NULL CHECK (
                exposure_direction IN (
                    'long_beneficiary', 'short_loser',
                    'volatility_up', 'volatility_down', 'direction_uncertain'
                )
            ),
            exposure_order      TEXT NOT NULL CHECK (
                exposure_order IN ('first', 'second', 'third')
            ),
            exposure_strength   REAL NOT NULL CHECK (exposure_strength BETWEEN 0.0 AND 1.0),
            source_method       TEXT NOT NULL CHECK (
                source_method IN ('hand_curated', 'llm_assist', 'operator_override', 'derived')
            ),
            rationale           TEXT,
            confidence          REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
            universe_symbol     TEXT,
            dcf_gap_pct         REAL,
            quality_score       REAL,
            technical_score     REAL,
            final_buzz_score    REAL,
            composite_rank      REAL,
            last_ranked_at      INTEGER,
            payload_json        TEXT
        )
        """,
    ),

    # ------------------------------------------------------------------
    # concept_mentions (highest-volume table — every comment generates
    # 0-N rows). Append-only; pruned after 90 days into concept_daily_counts.
    # ------------------------------------------------------------------
    (
        "concept_mentions",
        """
        CREATE TABLE IF NOT EXISTS concept_mentions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            concept_id              INTEGER NOT NULL REFERENCES tracked_concepts(id) ON DELETE CASCADE,
            signal_id               INTEGER NOT NULL REFERENCES situation_signals(id) ON DELETE CASCADE,
            community               TEXT NOT NULL,
            community_tier          TEXT NOT NULL CHECK (
                community_tier IN ('niche', 'general', 'mega')
            ),
            polarity                INTEGER NOT NULL CHECK (polarity IN (-1, 0, 1)),
            intent                  TEXT NOT NULL CHECK (
                intent IN (
                    'adoption', 'abandonment', 'complaint', 'praise',
                    'comparison', 'question', 'prediction'
                )
            ),
            mentioned_at            INTEGER NOT NULL,
            extraction_confidence   REAL NOT NULL CHECK (
                extraction_confidence BETWEEN 0.0 AND 1.0
            )
        )
        """,
    ),

    # ------------------------------------------------------------------
    # concept_daily_counts (pre-aggregated daily counts; what the live
    # z-score and topic_baselines read from).
    # ------------------------------------------------------------------
    (
        "concept_daily_counts",
        """
        CREATE TABLE IF NOT EXISTS concept_daily_counts (
            concept_id          INTEGER NOT NULL REFERENCES tracked_concepts(id) ON DELETE CASCADE,
            community           TEXT NOT NULL,
            day                 INTEGER NOT NULL,
            mention_count       INTEGER NOT NULL,
            unique_authors      INTEGER NOT NULL,
            polarity_mean       REAL,
            intent_mix_json     TEXT,
            PRIMARY KEY (concept_id, community, day)
        )
        """,
    ),

    # ------------------------------------------------------------------
    # topic_baselines (per-(concept, community) baselines with
    # seasonality; recomputed nightly).
    # ------------------------------------------------------------------
    (
        "topic_baselines",
        """
        CREATE TABLE IF NOT EXISTS topic_baselines (
            concept_id                  INTEGER NOT NULL REFERENCES tracked_concepts(id) ON DELETE CASCADE,
            community                   TEXT NOT NULL,
            as_of_day                   INTEGER NOT NULL,
            rolling_mean_30d            REAL NOT NULL,
            rolling_stdev_30d           REAL NOT NULL,
            dow_multipliers_json        TEXT,
            monthly_seasonality_json    TEXT,
            min_mention_floor           INTEGER NOT NULL DEFAULT 20,
            data_days                   INTEGER NOT NULL,
            PRIMARY KEY (concept_id, community)
        )
        """,
    ),

    # ------------------------------------------------------------------
    # emerging_topics (output of the z-score engine; seeds a scenario
    # iff it passes the authenticity gate AND coverage filter).
    # ------------------------------------------------------------------
    (
        "emerging_topics",
        """
        CREATE TABLE IF NOT EXISTS emerging_topics (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            concept_id                      INTEGER NOT NULL REFERENCES tracked_concepts(id) ON DELETE CASCADE,
            seed_community                  TEXT NOT NULL,
            peak_z_score                    REAL NOT NULL,
            current_z_score                 REAL NOT NULL,
            corroborating_communities_json  TEXT,
            cross_platform_corroboration    INTEGER NOT NULL DEFAULT 0 CHECK (
                cross_platform_corroboration IN (0, 1)
            ),
            migration_to_ticker_indexed     INTEGER NOT NULL DEFAULT 0 CHECK (
                migration_to_ticker_indexed IN (0, 1)
            ),
            migrated_at                     INTEGER,
            first_anomaly_at                INTEGER NOT NULL,
            last_anomaly_at                 INTEGER NOT NULL,
            total_mentions                  INTEGER NOT NULL,
            unique_authors                  INTEGER NOT NULL,
            authenticity_score              REAL NOT NULL CHECK (
                authenticity_score BETWEEN 0.0 AND 1.0
            ),
            authenticity_signals_json       TEXT,
            resolved_target_type            TEXT CHECK (
                resolved_target_type IS NULL OR resolved_target_type IN (
                    'brand', 'product', 'category', 'behavior'
                )
            ),
            resolved_tickers_json           TEXT,
            seeded_situation_id             INTEGER REFERENCES market_situations(id) ON DELETE SET NULL,
            suppression_reason              TEXT CHECK (
                suppression_reason IS NULL OR suppression_reason IN (
                    'LIKELY_INAUTHENTIC',
                    'NO_COVERAGE_ELIGIBLE_TICKERS',
                    'MEGA_COVERED_ONLY'
                )
            ),
            created_at                      INTEGER NOT NULL,
            updated_at                      INTEGER NOT NULL
        )
        """,
    ),

    # ------------------------------------------------------------------
    # authenticity_signals (per emerging-topic per signal-type audit row;
    # write-once; iterate scoring rules without losing history).
    # ------------------------------------------------------------------
    (
        "authenticity_signals",
        """
        CREATE TABLE IF NOT EXISTS authenticity_signals (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            emerging_topic_id   INTEGER NOT NULL REFERENCES emerging_topics(id) ON DELETE CASCADE,
            as_of               INTEGER NOT NULL,
            signal_type         TEXT NOT NULL CHECK (
                signal_type IN (
                    'account_age_distribution',
                    'posting_cadence',
                    'account_history_diversity',
                    'cross_platform_signature',
                    'comment_depth',
                    'sentiment_shape',
                    'account_quality',
                    'mod_flag_rate',
                    'linguistic_similarity',
                    'promoter_co_occurrence'
                )
            ),
            signal_value        REAL NOT NULL CHECK (signal_value BETWEEN 0.0 AND 1.0),
            weight              REAL NOT NULL CHECK (weight BETWEEN 0.0 AND 1.0),
            notes               TEXT
        )
        """,
    ),
]


# Each entry is (index_name, CREATE INDEX statement).
INDEXES: List[Tuple[str, str]] = [
    # market_situations: power the engine-aware filters and lifecycle queries.
    ("idx_market_situations_status_updated",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_status_updated "
     "ON market_situations (status, last_updated_at DESC)"),
    ("idx_market_situations_theme_status",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_theme_status "
     "ON market_situations (primary_theme, status)"),
    ("idx_market_situations_expires",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_expires "
     "ON market_situations (expires_at) WHERE expires_at IS NOT NULL"),
    ("idx_market_situations_detection_path",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_detection_path "
     "ON market_situations (detection_path, status)"),
    ("idx_market_situations_coverage_tier",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_coverage_tier "
     "ON market_situations (coverage_tier, status)"),
    ("idx_market_situations_authenticity",
     "CREATE INDEX IF NOT EXISTS idx_market_situations_authenticity "
     "ON market_situations (authenticity_score) WHERE authenticity_score IS NOT NULL"),

    # situation_signals: dedup uniqueness + per-scenario time queries.
    ("idx_situation_signals_situation_observed",
     "CREATE INDEX IF NOT EXISTS idx_situation_signals_situation_observed "
     "ON situation_signals (situation_id, observed_at DESC)"),
    ("idx_situation_signals_source_unique",
     "CREATE UNIQUE INDEX IF NOT EXISTS idx_situation_signals_source_unique "
     "ON situation_signals (source_type, source_id)"),

    # situation_evidence: per-scenario time-ordered fetch.
    ("idx_situation_evidence_situation_published",
     "CREATE INDEX IF NOT EXISTS idx_situation_evidence_situation_published "
     "ON situation_evidence (situation_id, published_at DESC)"),

    # situation_exposure: per-scenario candidate lookup + universe-wide reverse.
    ("idx_situation_exposure_ranked",
     "CREATE INDEX IF NOT EXISTS idx_situation_exposure_ranked "
     "ON situation_exposure (situation_id, exposure_order, composite_rank DESC)"),
    ("idx_situation_exposure_symbol",
     "CREATE INDEX IF NOT EXISTS idx_situation_exposure_symbol "
     "ON situation_exposure (universe_symbol) WHERE universe_symbol IS NOT NULL"),

    # tracked_concepts: dedup + status filter.
    ("idx_tracked_concepts_concept_target_unique",
     "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_concepts_concept_target_unique "
     "ON tracked_concepts (concept_key, target_key)"),
    ("idx_tracked_concepts_status",
     "CREATE INDEX IF NOT EXISTS idx_tracked_concepts_status "
     "ON tracked_concepts (status, created_at DESC)"),

    # concept_mentions: z-score input lookups.
    ("idx_concept_mentions_concept_time",
     "CREATE INDEX IF NOT EXISTS idx_concept_mentions_concept_time "
     "ON concept_mentions (concept_id, mentioned_at DESC)"),
    ("idx_concept_mentions_community_time",
     "CREATE INDEX IF NOT EXISTS idx_concept_mentions_community_time "
     "ON concept_mentions (community, mentioned_at DESC)"),
    ("idx_concept_mentions_signal",
     "CREATE INDEX IF NOT EXISTS idx_concept_mentions_signal "
     "ON concept_mentions (signal_id)"),

    # emerging_topics: surface most-anomalous + scenario lookup.
    ("idx_emerging_topics_authenticity_zscore",
     "CREATE INDEX IF NOT EXISTS idx_emerging_topics_authenticity_zscore "
     "ON emerging_topics (authenticity_score, peak_z_score DESC)"),
    ("idx_emerging_topics_situation",
     "CREATE INDEX IF NOT EXISTS idx_emerging_topics_situation "
     "ON emerging_topics (seeded_situation_id) WHERE seeded_situation_id IS NOT NULL"),
    ("idx_emerging_topics_suppression",
     "CREATE INDEX IF NOT EXISTS idx_emerging_topics_suppression "
     "ON emerging_topics (suppression_reason, created_at DESC) WHERE suppression_reason IS NOT NULL"),

    # coverage_tiers: tier and ranking lookups.
    ("idx_coverage_tiers_tier",
     "CREATE INDEX IF NOT EXISTS idx_coverage_tiers_tier "
     "ON coverage_tiers (coverage_tier)"),
    ("idx_coverage_tiers_score",
     "CREATE INDEX IF NOT EXISTS idx_coverage_tiers_score "
     "ON coverage_tiers (composite_score)"),

    # authenticity_signals: per-topic audit fetch.
    ("idx_authenticity_signals_topic_time",
     "CREATE INDEX IF NOT EXISTS idx_authenticity_signals_topic_time "
     "ON authenticity_signals (emerging_topic_id, as_of DESC)"),
]


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def _index_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def _read_schema_version(conn: sqlite3.Connection) -> Optional[int]:
    if not _table_exists(conn, "schema_meta"):
        return None
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if row is None:
        return None
    try:
        return int(row["value"])
    except (TypeError, ValueError):
        return None


def _write_schema_version(conn: sqlite3.Connection, version: int) -> None:
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO schema_meta (key, value, updated_at)
        VALUES ('schema_version', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (str(version), now),
    )


def build(db_path: Path, *, reset: bool, dry_run: bool) -> Dict[str, Any]:
    """Create or update the schema. Idempotent.

    Returns a dict summary suitable for printing or logging.
    """
    summary: Dict[str, Any] = {
        "db_path": str(db_path),
        "schema_version": SCHEMA_VERSION,
        "reset": reset,
        "dry_run": dry_run,
        "tables_created": [],
        "tables_existing": [],
        "indexes_created": [],
        "indexes_existing": [],
        "previous_schema_version": None,
    }

    if reset and not dry_run and db_path.exists():
        # Also remove sidecar WAL files when resetting.
        for suffix in ("", "-wal", "-shm"):
            sidecar = Path(str(db_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        summary["reset_performed"] = True

    if dry_run:
        summary["note"] = "dry-run: nothing was written"
        # Connect to a temporary in-memory DB so we still validate the SQL parses.
        conn = sqlite3.connect(":memory:")
    else:
        conn = _connect(db_path)

    try:
        previous_version = _read_schema_version(conn)
        summary["previous_schema_version"] = previous_version

        for name, ddl in TABLES:
            existed = _table_exists(conn, name)
            conn.executescript(ddl)
            if existed:
                summary["tables_existing"].append(name)
            else:
                summary["tables_created"].append(name)

        for name, ddl in INDEXES:
            existed = _index_exists(conn, name)
            conn.execute(ddl)
            if existed:
                summary["indexes_existing"].append(name)
            else:
                summary["indexes_created"].append(name)

        _write_schema_version(conn, SCHEMA_VERSION)

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create or migrate the market-intelligence SQLite database."
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite file (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete the existing DB file (and -wal/-shm sidecars) before rebuilding.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate DDL against an in-memory DB; do not touch the on-disk file.",
    )
    args = parser.parse_args(argv)

    summary = build(
        db_path=args.db_path.resolve(),
        reset=args.reset,
        dry_run=args.dry_run,
    )
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
