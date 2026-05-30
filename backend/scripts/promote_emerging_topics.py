#!/usr/bin/env python
"""
Emerging-topic → market_situations promoter.

This is the bridge between the Social Arbitrage statistical layer and the
operator-facing scenario stream:

    emerging_topics (z-score engine output)
            │
            │  pass authenticity gate ?
            │  pass coverage gate ?
            │  resolve target tickers ?
            ▼
    market_situations  +  situation_signals  +  situation_evidence
            │
            ▼  (UI surfaces the row)

For v1 we keep the gates lenient on purpose so the pipeline produces
visible output as soon as the z-score engine starts firing:

  * authenticity_score gate           default >= 0.4 (placeholder 0.5 passes)
  * coverage tier gate                disabled (allow all)
  * target-ticker resolution          uses tracked_concepts.metadata_json.watch_tickers
                                      first, then brand_to_ticker by target_key,
                                      else empty list (still promote for visibility)
  * primary_theme                     reads metadata_json.primary_theme; falls back
                                      to inline CONCEPT_THEME_FALLBACK; if neither
                                      maps to a registered theme, the topic is
                                      skipped with a warning

Once the authenticity scorer (D23) and coverage_tier_refresh land, those
gates tighten without changing this script's contract.

Idempotency: the script only promotes emerging_topics rows where
    seeded_situation_id IS NULL AND suppression_reason IS NULL
After promotion the row's seeded_situation_id is set, so re-running is
a no-op.

Usage from the marketIntelligenceScheduler (every 15 min):
    py backend/scripts/promote_emerging_topics.py

Flags:
    --auth-threshold FLOAT    minimum authenticity_score to promote (default 0.4)
    --max-promotions INTEGER  cap promotions per run (default 50)
    --dry-run                 print intended writes, do not commit
    --verbose                 detailed per-topic logging
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")

if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.services.topic_ticker_resolver import (  # noqa: E402
    resolve_target_tickers as _resolve_target_tickers,
)
from backend.services.social_arbitrage_scoring import (  # noqa: E402
    ScoringResult,
    score_social_arbitrage,
)

EXPECTED_SCHEMA_VERSION = 5
SCENARIO_SCHEMA_VERSION = 1  # market_situations.schema_version (NOT meta)

# Inline fallback mapping from concept_key → theme_key. Operator can override
# per-concept via tracked_concepts.metadata_json.primary_theme. This list is
# intentionally small; expand it as the concept registry grows.
CONCEPT_THEME_FALLBACK: Dict[str, str] = {
    "ai_compute_shortage": "ai_capex_acceleration",
    "vision_pro_adoption": "consumer_strength",
    "tesla_fsd": "ai_capex_acceleration",
    "cloudflare_edge": "ai_capex_acceleration",
    "nvidia_cuda_moat": "ai_capex_acceleration",
    "openai_models": "ai_capex_acceleration",
    "github_copilot": "ai_capex_acceleration",
    "tech_layoffs": "ai_capex_pullback",
    "self_hosted_migration": "ai_capex_pullback",
    "rust_adoption": "ai_capex_acceleration",
}

# Tracked-concept target_type → market-scenario scenario_type (the contract
# allows: macro / geopolitical / commodity / policy / sector_rotation /
# single_company_catalyst / consumer_cycle / tech_disruption / other).
DEFAULT_SCENARIO_TYPE_FOR_TARGET: Dict[str, str] = {
    "brand": "single_company_catalyst",
    "product": "single_company_catalyst",
    "category": "tech_disruption",
    "behavior": "tech_disruption",
    "keyword": "other",
    "event_type": "sector_rotation",
}

DEFAULT_TIME_HORIZON = "weeks"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def now_unix() -> int:
    return int(time.time())


def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(
            f"[promote] market-intelligence.sqlite missing at {db_path}. "
            f"Run backend/scripts/build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema_version(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    raw = row["value"] if row else None
    try:
        actual = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        actual = None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[promote] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}. Run "
            f"backend/scripts/build_market_intelligence_db.py to migrate."
        )


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.strip().lower())
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "concept"


def confidence_level_for(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.5:
        return "medium"
    if score >= 0.25:
        return "low"
    return "very_low"


def derive_confidence(peak_z: float, cross_platform: bool, mention_count: int) -> float:
    """Legacy scalar — kept only for `--dry-run` log lines (the actual write
    path uses `score_social_arbitrage()`, which returns a richer
    ScoringResult). Once the dry-run logging is rewritten to print the full
    scoring breakdown, this function can be removed."""
    base = max(0.0, min(0.4 + 0.10 * peak_z, 0.85))
    if cross_platform:
        base += 0.05
    if mention_count >= 50:
        base += 0.05
    return round(min(base, 0.95), 3)


def loads_json(blob: Optional[str]) -> Any:
    if not blob:
        return None
    try:
        return json.loads(blob)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def fetch_unpromoted_emerging(
    conn: sqlite3.Connection, max_rows: int
) -> List[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM emerging_topics
        WHERE seeded_situation_id IS NULL
          AND suppression_reason IS NULL
        ORDER BY peak_z_score DESC, last_anomaly_at DESC
        LIMIT ?
        """,
        (max_rows,),
    ).fetchall()


def fetch_emerging_by_ids(
    conn: sqlite3.Connection, ids: Sequence[int],
) -> List[sqlite3.Row]:
    """Operator-driven path: fetch specific emerging_topics rows even if
    they are already promoted or suppressed. The caller decides whether
    to force-bypass the auth/coverage gate; this just returns the raw
    rows without the seeded_situation_id / suppression_reason filter."""
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    return conn.execute(
        f"SELECT * FROM emerging_topics WHERE id IN ({placeholders})",
        tuple(int(x) for x in ids),
    ).fetchall()


def fetch_concept(conn: sqlite3.Connection, concept_id: int) -> Optional[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, concept_key, target_type, target_key,
               display_label, status, metadata_json
        FROM tracked_concepts
        WHERE id = ?
        """,
        (concept_id,),
    ).fetchone()


def fetch_registered_themes(conn: sqlite3.Connection) -> Set[str]:
    rows = conn.execute("SELECT theme_key FROM theme_registry").fetchall()
    return {str(r["theme_key"]) for r in rows}


# NOTE: first/second-order theme effects live in
# backend/data/scenarios/theme-taxonomy.json, not theme_registry. The
# scenario detail GET (or a future conviction-layer rollup) can hydrate
# those at read time. Promotion leaves the columns NULL.


def fetch_existing_slugs_with_prefix(
    conn: sqlite3.Connection, prefix: str
) -> Set[str]:
    rows = conn.execute(
        "SELECT slug FROM market_situations WHERE slug LIKE ?",
        (prefix + "%",),
    ).fetchall()
    return {str(r["slug"]) for r in rows}


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


def resolve_primary_theme(
    concept: sqlite3.Row, registered_themes: Set[str], verbose: bool = False
) -> Optional[str]:
    metadata = loads_json(concept["metadata_json"]) or {}
    candidate = None
    if isinstance(metadata, dict):
        c = metadata.get("primary_theme")
        if isinstance(c, str) and c.strip():
            candidate = c.strip()
    if candidate is None:
        candidate = CONCEPT_THEME_FALLBACK.get(str(concept["concept_key"]))
    if candidate is None:
        if verbose:
            print(
                f"[promote] concept_key={concept['concept_key']!r} has no "
                f"primary_theme override and no fallback in CONCEPT_THEME_FALLBACK"
            )
        return None
    if candidate not in registered_themes:
        if verbose:
            print(
                f"[promote] concept_key={concept['concept_key']!r} maps to "
                f"theme={candidate!r} but it is not in theme_registry — skipping"
            )
        return None
    return candidate


def resolve_scenario_type(concept: sqlite3.Row) -> str:
    metadata = loads_json(concept["metadata_json"]) or {}
    if isinstance(metadata, dict):
        s = metadata.get("scenario_type")
        if isinstance(s, str) and s.strip():
            return s.strip()
    return DEFAULT_SCENARIO_TYPE_FOR_TARGET.get(
        str(concept["target_type"]), "other"
    )


def resolve_time_horizon(concept: sqlite3.Row) -> str:
    metadata = loads_json(concept["metadata_json"]) or {}
    if isinstance(metadata, dict):
        h = metadata.get("time_horizon")
        if isinstance(h, str) and h.strip():
            return h.strip()
    return DEFAULT_TIME_HORIZON


def resolve_target_tickers(
    conn: sqlite3.Connection,
    concept: sqlite3.Row,
    *,
    primary_theme: Optional[str] = None,
) -> Tuple[List[str], str]:
    """Thin shim retained for backwards-compatibility with anything that still
    imports `promote_emerging_topics.resolve_target_tickers`. The real
    implementation lives in `backend/services/topic_ticker_resolver.py` so
    non-promoter callers (conviction layer, /emerging-topics endpoints) can
    use it without dragging in this module's CLI scaffolding."""
    return _resolve_target_tickers(conn, concept, primary_theme=primary_theme)


def make_unique_slug(
    conn: sqlite3.Connection, concept_key: str, score_day: int
) -> str:
    base_date = datetime.fromtimestamp(score_day, tz=timezone.utc).strftime("%Y%m%d")
    base = slugify(f"emerging-{concept_key}-{base_date}")
    existing = fetch_existing_slugs_with_prefix(conn, base)
    if base not in existing:
        return base
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if candidate not in existing:
            return candidate
    return f"{base}-{int(time.time())}"


# ---------------------------------------------------------------------------
# Promotion writer
# ---------------------------------------------------------------------------


def write_situation_and_signal(
    conn: sqlite3.Connection,
    *,
    emerging: sqlite3.Row,
    concept: sqlite3.Row,
    primary_theme: str,
    scenario_type: str,
    time_horizon: str,
    tickers: List[str],
    ticker_source_method: str,
    scoring: ScoringResult,
    score_day: int,
) -> Tuple[int, int]:
    """
    Returns (situation_id, signal_id).
    """
    now = now_unix()
    confidence_level = confidence_level_for(scoring.confidence_score)
    peak_z = float(emerging["peak_z_score"])
    cross_platform = bool(int(emerging["cross_platform_corroboration"]))
    corroborating = loads_json(emerging["corroborating_communities_json"]) or []
    seed_community = str(emerging["seed_community"])

    title = f"{concept['display_label']} — emerging chatter spike"
    summary_parts = [
        f"Anomalous community chatter detected on {seed_community} "
        f"(peak z={peak_z:.1f}, mentions={emerging['total_mentions']})."
    ]
    if cross_platform and corroborating:
        summary_parts.append(
            "Cross-platform corroboration via " + ", ".join(corroborating) + "."
        )
    elif corroborating:
        summary_parts.append("Corroborating communities: " + ", ".join(corroborating) + ".")
    if tickers:
        summary_parts.append("Target universe: " + ", ".join(tickers[:6]) + ".")
    summary = " ".join(summary_parts)

    slug = make_unique_slug(conn, str(concept["concept_key"]), score_day)

    # Source-breadth heuristic mirrors the cheap proxy the scorer uses; we
    # also persist it on the row so the API can render it without rerunning
    # the scoring profile.
    source_breadth_score = min(1.0, (1 + len(corroborating)) / 4.0)

    metadata = {
        "promoted_from_emerging_topic_id": int(emerging["id"]),
        "concept_id": int(concept["id"]),
        "concept_key": str(concept["concept_key"]),
        "ticker_resolution_method": ticker_source_method,
        "watch_tickers": tickers,
        "scoring": scoring.to_metadata(),
    }

    validity_flags_json = (
        json.dumps(scoring.validity_flags) if scoring.validity_flags else None
    )

    cur = conn.execute(
        """
        INSERT INTO market_situations (
            slug, title, summary, primary_theme, scenario_type,
            status, signal_strength, confidence_score, confidence_level,
            time_horizon,
            started_at, last_confirmed_at, last_updated_at, expires_at,
            event_score, attention_score, market_confirmation_score,
            crowding_score, source_breadth_score,
            evidence_count,
            first_order_effects_json, second_order_effects_json,
            validity_flags_json, confidence_reasons_json,
            -- ^^ first/second-order effects intentionally NULL — see note above
            conviction_layer_json, conviction_pack_hash,
            detection_path, seeded_emerging_topic_id, coverage_tier,
            authenticity_score, peak_z_score, cross_platform_corroboration,
            edge_multiplier, metadata_json,
            schema_version, created_at, updated_at, archived_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            'EARLY', ?, ?, ?,
            ?,
            ?, NULL, ?, NULL,
            NULL, ?, NULL,
            NULL, ?,
            0,
            ?, ?,
            ?, NULL,
            NULL, NULL,
            'topic_anomaly', ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?, NULL
        )
        """,
        (
            slug, title, summary, primary_theme, scenario_type,
            scoring.signal_strength, scoring.confidence_score, confidence_level,
            time_horizon,
            score_day, now,
            scoring.attention_score,
            source_breadth_score,
            None, None,
            validity_flags_json,
            int(emerging["id"]),
            scoring.coverage_tier,
            float(emerging["authenticity_score"]),
            peak_z,
            1 if cross_platform else 0,
            scoring.edge_multiplier,
            json.dumps(metadata),
            SCENARIO_SCHEMA_VERSION, now, now,
        ),
    )
    situation_id = int(cur.lastrowid)

    cur = conn.execute(
        """
        INSERT INTO situation_signals (
            situation_id, signal_type, source_type, source_id,
            entity, theme, score, weight,
            observed_at, ingested_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            situation_id,
            "social_buzz_spike",
            f"market_intelligence:{seed_community}",
            f"emerging_topic:{int(emerging['id'])}",
            str(concept["concept_key"]),
            primary_theme,
            scoring.attention_score,
            1.0,
            int(emerging["last_anomaly_at"]),
            now,
            json.dumps({
                "peak_z_score": peak_z,
                "current_z_score": float(emerging["current_z_score"]),
                "seed_community": seed_community,
                "corroborating_communities": corroborating,
                "cross_platform_corroboration": cross_platform,
                "total_mentions": int(emerging["total_mentions"]),
                "unique_authors": int(emerging["unique_authors"]),
            }),
        ),
    )
    signal_id = int(cur.lastrowid)

    return (situation_id, signal_id)


def update_emerging_after_promotion(
    conn: sqlite3.Connection,
    *,
    emerging_id: int,
    situation_id: int,
    resolved_target_type: Optional[str],
    resolved_tickers: List[str],
) -> None:
    conn.execute(
        """
        UPDATE emerging_topics SET
            seeded_situation_id = ?,
            resolved_target_type = ?,
            resolved_tickers_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            situation_id,
            resolved_target_type,
            json.dumps(resolved_tickers),
            now_unix(),
            emerging_id,
        ),
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def promote(
    conn: sqlite3.Connection,
    *,
    auth_threshold: float,
    max_promotions: int,
    dry_run: bool,
    verbose: bool,
    only_ids: Optional[Sequence[int]] = None,
    force_bypass_thresholds: bool = False,
) -> Dict[str, int]:
    if only_ids:
        rows = fetch_emerging_by_ids(conn, only_ids)
        if verbose:
            print(
                f"[promote] operator-targeted run: ids={list(only_ids)} "
                f"(force_bypass_thresholds={force_bypass_thresholds})"
            )
    else:
        rows = fetch_unpromoted_emerging(conn, max_promotions)
    if not rows:
        return {
            "candidates": 0,
            "promoted": 0,
            "skipped_low_authenticity": 0,
            "skipped_no_concept": 0,
            "skipped_no_theme": 0,
            "errors": 0,
        }

    registered_themes = fetch_registered_themes(conn)

    promoted = 0
    skipped_auth = 0
    skipped_no_concept = 0
    skipped_no_theme = 0
    errors = 0
    promoted_concept_ids: dict = {}

    for emerging in rows:
        try:
            # Operator-targeted runs that have already produced a situation
            # are a no-op — the situation_id FK in emerging_topics already
            # points at it and re-promoting would duplicate the row.
            if only_ids and emerging["seeded_situation_id"] is not None:
                if verbose:
                    print(
                        f"[promote] emerging_id={emerging['id']} already "
                        f"promoted to situation_id={emerging['seeded_situation_id']} "
                        f"— skip (idempotent)"
                    )
                continue

            concept_id = int(emerging["concept_id"])
            existing_sit = conn.execute(
                "SELECT id FROM market_situations WHERE seeded_emerging_topic_id IN "
                "(SELECT id FROM emerging_topics WHERE concept_id = ?)",
                (concept_id,),
            ).fetchone()
            if concept_id in promoted_concept_ids or existing_sit:
                existing_id = promoted_concept_ids.get(
                    concept_id, existing_sit[0] if existing_sit else None
                )
                if verbose:
                    print(
                        f"[promote] emerging_id={emerging['id']} concept_id="
                        f"{concept_id} already has situation #{existing_id} — "
                        f"skip (dedup)"
                    )
                if existing_id is not None:
                    conn.execute(
                        "UPDATE emerging_topics SET seeded_situation_id = ? "
                        "WHERE id = ? AND seeded_situation_id IS NULL",
                        (existing_id, int(emerging["id"])),
                    )
                continue

            auth = float(emerging["authenticity_score"])
            if auth < auth_threshold and not force_bypass_thresholds:
                skipped_auth += 1
                if verbose:
                    print(
                        f"[promote] emerging_id={emerging['id']} authenticity={auth:.2f} "
                        f"< threshold={auth_threshold:.2f} — skip"
                    )
                continue

            concept = fetch_concept(conn, int(emerging["concept_id"]))
            if concept is None:
                skipped_no_concept += 1
                if verbose:
                    print(
                        f"[promote] emerging_id={emerging['id']} concept_id="
                        f"{emerging['concept_id']} missing — skip"
                    )
                continue

            primary_theme = resolve_primary_theme(
                concept, registered_themes, verbose=verbose
            )
            if primary_theme is None:
                skipped_no_theme += 1
                continue

            scenario_type = resolve_scenario_type(concept)
            time_horizon = resolve_time_horizon(concept)
            tickers, ticker_source = resolve_target_tickers(
                conn, concept, primary_theme=primary_theme
            )

            # If the concept's primary entity is a brand/product that resolved
            # only via theme_fallback (i.e., the brand itself is private / has
            # no parent_ticker), mark it so the UI can filter or deprioritize.
            target_type = str(concept["target_type"] or "").lower()
            is_private_entity = (
                target_type in ("brand", "product")
                and ticker_source == "theme_fallback"
            )

            scoring = score_social_arbitrage(
                conn,
                peak_z=float(emerging["peak_z_score"]),
                cross_platform=bool(int(emerging["cross_platform_corroboration"])),
                mention_count=int(emerging["total_mentions"]),
                authenticity_score=(
                    float(emerging["authenticity_score"])
                    if emerging["authenticity_score"] is not None
                    else None
                ),
                tickers=tickers,
            )

            if is_private_entity:
                scoring.validity_flags.append("PRIVATE_ENTITY")

            # Untradable coverage tier OR multiplier collapsed to 0 ⇒ skip
            # entirely. The promoter is the right place to enforce this
            # because it owns the INSERT — the scorer just signals.
            #
            # Operator force-bypass overrides this: surface the scenario
            # anyway so a human can investigate. The validity flags will
            # still be present on the resulting situation row for audit.
            if (
                scoring.edge_multiplier <= 0.0
                or scoring.authenticity_multiplier <= 0.0
            ) and not force_bypass_thresholds:
                skipped_auth += 1
                if verbose:
                    print(
                        f"[promote] emerging_id={emerging['id']} suppressed "
                        f"(edge={scoring.edge_multiplier} auth_mult="
                        f"{scoring.authenticity_multiplier} flags="
                        f"{scoring.validity_flags})"
                    )
                continue

            if dry_run:
                print(
                    f"[promote] DRY-RUN would emit situation: "
                    f"concept={concept['concept_key']} theme={primary_theme} "
                    f"type={scenario_type} horizon={time_horizon} "
                    f"tickers={tickers} score={scoring.scenario_score:.1f} "
                    f"conf={scoring.confidence_score:.2f} "
                    f"tier={scoring.coverage_tier} flags={scoring.validity_flags}"
                )
                promoted += 1
                continue

            situation_id, signal_id = write_situation_and_signal(
                conn,
                emerging=emerging,
                concept=concept,
                primary_theme=primary_theme,
                scenario_type=scenario_type,
                time_horizon=time_horizon,
                tickers=tickers,
                ticker_source_method=ticker_source,
                scoring=scoring,
                score_day=int(emerging["last_anomaly_at"]),
            )
            update_emerging_after_promotion(
                conn,
                emerging_id=int(emerging["id"]),
                situation_id=situation_id,
                resolved_target_type=str(concept["target_type"]),
                resolved_tickers=tickers,
            )
            promoted_concept_ids[concept_id] = situation_id
            promoted += 1
            print(
                f"[promote] promoted emerging_id={emerging['id']} -> "
                f"situation_id={signal_id and situation_id} "
                f"({concept['concept_key']} z={float(emerging['peak_z_score']):.2f} "
                f"score={scoring.scenario_score:.1f} tier={scoring.coverage_tier} "
                f"edge={scoring.edge_multiplier} auth_mult={scoring.authenticity_multiplier})"
            )

        except Exception as exc:  # noqa: BLE001
            errors += 1
            print(
                f"[promote] ERROR while promoting emerging_id={emerging['id']}: {exc}"
            )
            conn.rollback()

    if not dry_run:
        conn.commit()

    return {
        "candidates": len(rows),
        "promoted": promoted,
        "skipped_low_authenticity": skipped_auth,
        "skipped_no_concept": skipped_no_concept,
        "skipped_no_theme": skipped_no_theme,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Promote emerging_topics into market_situations rows."
    )
    p.add_argument("--db", default=DEFAULT_DB_PATH)
    p.add_argument("--auth-threshold", type=float, default=0.4,
                   help="minimum authenticity_score to promote (default 0.4)")
    p.add_argument("--max-promotions", type=int, default=50,
                   help="cap promotions per run (default 50)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything, write nothing")
    p.add_argument(
        "--emerging-id",
        action="append",
        type=int,
        default=None,
        help=(
            "Operator-targeted run: promote only the listed emerging_topic id(s). "
            "Repeat the flag for multiple ids. Bypasses the default queue order "
            "and the seeded_situation_id IS NULL filter (already-promoted rows "
            "are still skipped idempotently)."
        ),
    )
    p.add_argument(
        "--force",
        action="store_true",
        help=(
            "Operator override: bypass the auth-threshold + edge_multiplier + "
            "authenticity_multiplier suppression gates. Validity flags are "
            "still recorded on the resulting situation for audit. Intended for "
            "use only with --emerging-id when an operator has manually verified "
            "a borderline topic."
        ),
    )
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    conn = open_db(args.db)
    try:
        assert_schema_version(conn)
        stats = promote(
            conn,
            auth_threshold=args.auth_threshold,
            max_promotions=args.max_promotions,
            dry_run=args.dry_run,
            verbose=args.verbose,
            only_ids=args.emerging_id,
            force_bypass_thresholds=args.force,
        )
        print(
            "[promote] done: "
            f"candidates={stats['candidates']} "
            f"promoted={stats['promoted']} "
            f"skip_auth={stats['skipped_low_authenticity']} "
            f"skip_no_concept={stats['skipped_no_concept']} "
            f"skip_no_theme={stats['skipped_no_theme']} "
            f"errors={stats['errors']}"
        )
        return 0 if stats["errors"] == 0 else 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
