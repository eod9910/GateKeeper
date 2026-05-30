#!/usr/bin/env python3
"""
Promote SCENARIO_READY narrative clusters into Market Intelligence scenarios.

This is the v7 bridge from:

    narrative_clusters(status='SCENARIO_READY') -> market_situations

It is deliberately conservative: only clusters with mapped exposure and no
existing promotion_situation_id are promoted. Claim/source lineage stays in
market_situations.metadata_json and situation_evidence.payload_json.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 7
SCENARIO_SCHEMA_VERSION = 1
DAY_SECONDS = 86_400


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[narrative-promote] DB missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(row["value"]) if row and str(row["value"]).isdigit() else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[narrative-promote] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def parse_json_list(value: Any) -> List[Any]:
    if value is None or value == "":
        return []
    try:
        parsed = json.loads(str(value))
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def parse_json_obj(value: Any) -> Dict[str, Any]:
    if value is None or value == "":
        return {}
    try:
        parsed = json.loads(str(value))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)[:80] or "narrative-scenario"


def unique_slug(conn: sqlite3.Connection, base: str) -> str:
    root = slugify(base)
    existing = {
        str(row["slug"])
        for row in conn.execute(
            "SELECT slug FROM market_situations WHERE slug LIKE ?",
            (f"{root}%",),
        ).fetchall()
    }
    if root not in existing:
        return root
    i = 2
    while f"{root}-{i}" in existing:
        i += 1
    return f"{root}-{i}"


def confidence_level(score: float) -> str:
    if score >= 0.72:
        return "high"
    if score >= 0.52:
        return "medium"
    if score >= 0.30:
        return "low"
    return "very_low"


def scenario_type_for(theme: str) -> str:
    if theme in {"energy_demand", "energy_supply", "ai_capex_acceleration", "semis_supply_shock"}:
        return "supply_chain"
    if theme in {"financial_tokenization", "rates_higher", "rates_lower"}:
        return "market_structure"
    if theme.startswith("consumer"):
        return "consumer_cycle"
    if theme == "defense_spending_up":
        return "policy"
    return "technology_adoption"


def detection_path_for(metadata: Dict[str, Any]) -> str:
    source_types = set(metadata.get("source_types") or [])
    has_social = any(
        s.startswith("hackernews") or s.startswith("fourchan") or s.startswith("youtube")
        for s in source_types
    )
    has_news = any(s.startswith("rss_") or s.startswith("econ_") for s in source_types)
    return "mixed_anomaly_led" if has_social and has_news else "topic_anomaly"


def load_ready_clusters(conn: sqlite3.Connection, *, limit: int) -> List[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM narrative_clusters
        WHERE status = 'SCENARIO_READY'
          AND promotion_situation_id IS NULL
          AND tradable_exposure_status = 'mapped'
        ORDER BY source_breadth DESC, updated_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()


def load_promoted_clusters_to_refresh(conn: sqlite3.Connection, *, limit: int) -> List[sqlite3.Row]:
    return conn.execute(
        """
        SELECT c.*
        FROM narrative_clusters c
        JOIN market_situations s
          ON s.id = c.promotion_situation_id
        WHERE c.status = 'PROMOTED'
          AND c.promotion_situation_id IS NOT NULL
          AND c.updated_at > COALESCE(s.updated_at, 0)
        ORDER BY c.updated_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()


def build_scenario_metadata(
    conn: sqlite3.Connection,
    cluster: sqlite3.Row,
) -> Tuple[List[int], List[str], List[str], Dict[str, Any]]:
    cluster_id = int(cluster["id"])
    metadata = parse_json_obj(cluster["metadata_json"])
    claim_ids = [
        int(row["claim_id"])
        for row in conn.execute(
            "SELECT claim_id FROM narrative_cluster_claims WHERE cluster_id = ? ORDER BY claim_id",
            (cluster_id,),
        ).fetchall()
    ]
    tickers = [str(t) for t in parse_json_list(cluster["mapped_tickers_json"])]
    flags = [str(f) for f in parse_json_list(cluster["validity_flags_json"])]
    scenario_metadata = {
        "promoted_from_narrative_cluster_id": cluster_id,
        "narrative_cluster_slug": str(cluster["slug"]),
        "claim_ids": claim_ids,
        "source_hit_ids": metadata.get("source_hit_ids") or [],
        "source_types": metadata.get("source_types") or [],
        "source_communities": metadata.get("source_communities") or [],
        "asymmetric_theme": metadata.get("asymmetric_theme"),
        "watch_tickers": tickers,
        "promotion_source": "promote_narrative_clusters.py",
    }
    return claim_ids, tickers, flags, scenario_metadata


def promote_cluster(conn: sqlite3.Connection, cluster: sqlite3.Row, *, now: int) -> int:
    cluster_id = int(cluster["id"])
    claim_ids, tickers, flags, scenario_metadata = build_scenario_metadata(conn, cluster)
    metadata = parse_json_obj(cluster["metadata_json"])
    source_breadth = float(cluster["source_breadth"] or 0.0)
    undercoverage = float(cluster["undercoverage_score"] or 0.0)
    authenticity = float(cluster["authenticity_score"] or 0.0)
    confidence = min(0.85, 0.25 + source_breadth * 0.25 + authenticity * 0.20 + undercoverage * 0.15)
    signal_strength = max(1, min(100, round(45 + source_breadth * 25 + authenticity * 15 + undercoverage * 15)))
    started_at = int(cluster["first_seen_at"])
    detection_path = detection_path_for(metadata)
    slug = unique_slug(conn, str(cluster["slug"]))
    confidence_reasons = [
        f"{len(claim_ids)} supporting claim(s) linked to this narrative cluster",
        f"source breadth score {source_breadth:.2f}",
        f"mapped exposure: {', '.join(tickers[:8])}",
    ]

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
            conviction_layer_json, conviction_pack_hash,
            detection_path, seeded_emerging_topic_id, coverage_tier,
            authenticity_score, peak_z_score, cross_platform_corroboration,
            edge_multiplier, metadata_json,
            schema_version, created_at, updated_at, archived_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            'EARLY', ?, ?, ?,
            'months',
            ?, NULL, ?, ?,
            ?, ?, NULL,
            NULL, ?,
            1,
            NULL, NULL,
            ?, ?,
            NULL, NULL,
            ?, NULL, NULL,
            ?, NULL, ?,
            1.0, ?,
            ?, ?, ?, NULL
        )
        """,
        (
            slug,
            str(cluster["title"]),
            str(cluster["summary"]),
            str(cluster["primary_theme"]),
            scenario_type_for(str(cluster["primary_theme"])),
            signal_strength,
            confidence,
            confidence_level(confidence),
            started_at,
            now,
            now + 90 * DAY_SECONDS,
            source_breadth,
            authenticity,
            source_breadth,
            json.dumps(flags) if flags else None,
            json.dumps(confidence_reasons),
            detection_path,
            authenticity,
            1 if detection_path == "mixed_anomaly_led" else 0,
            json.dumps(scenario_metadata, sort_keys=True),
            SCENARIO_SCHEMA_VERSION,
            now,
            now,
        ),
    )
    situation_id = int(cur.lastrowid)

    signal_cur = conn.execute(
        """
        INSERT INTO situation_signals (
            situation_id, signal_type, source_type, source_id,
            entity, theme, score, weight,
            observed_at, ingested_at, payload_json
        ) VALUES (?, 'social_buzz_spike', 'asymmetric_narrative', ?, ?, ?, ?, 1.0, ?, ?, ?)
        """,
        (
            situation_id,
            f"narrative_cluster:{cluster_id}",
            ",".join(tickers[:8]),
            str(cluster["primary_theme"]),
            min(1.0, signal_strength / 100.0),
            int(cluster["last_seen_at"]),
            now,
            json.dumps(scenario_metadata, sort_keys=True),
        ),
    )
    signal_id = int(signal_cur.lastrowid)

    conn.execute(
        """
        INSERT INTO situation_evidence (
            situation_id, evidence_type, source_name,
            headline_or_label, summary, url,
            published_at, importance_score, novelty_score,
            signal_id, payload_json
        ) VALUES (?, 'social_post_cluster', 'Asymmetric Narrative Cluster', ?, ?, NULL, ?, ?, ?, ?, ?)
        """,
        (
            situation_id,
            str(cluster["title"]),
            str(cluster["summary"]),
            int(cluster["last_seen_at"]),
            source_breadth,
            float(cluster["novelty_score"] or 0.5),
            signal_id,
            json.dumps(scenario_metadata, sort_keys=True),
        ),
    )

    conn.execute(
        """
        UPDATE narrative_clusters
        SET status = 'PROMOTED',
            promotion_situation_id = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (situation_id, now, cluster_id),
    )
    return situation_id


def refresh_promoted_cluster(conn: sqlite3.Connection, cluster: sqlite3.Row, *, now: int) -> int:
    situation_id = int(cluster["promotion_situation_id"])
    claim_ids, tickers, flags, scenario_metadata = build_scenario_metadata(conn, cluster)
    source_breadth = float(cluster["source_breadth"] or 0.0)
    undercoverage = float(cluster["undercoverage_score"] or 0.0)
    authenticity = float(cluster["authenticity_score"] or 0.0)
    last_seen_at = int(cluster["last_seen_at"] or now)
    confidence = min(0.85, 0.25 + source_breadth * 0.25 + authenticity * 0.20 + undercoverage * 0.15)
    signal_strength = max(1, min(100, round(45 + source_breadth * 25 + authenticity * 15 + undercoverage * 15)))
    detection_path = detection_path_for(parse_json_obj(cluster["metadata_json"]))
    confidence_reasons = [
        f"{len(claim_ids)} supporting claim(s) linked to this narrative cluster",
        f"source breadth score {source_breadth:.2f}",
        f"mapped exposure: {', '.join(tickers[:8])}",
    ]
    conn.execute(
        """
        UPDATE market_situations
        SET title = ?,
            summary = ?,
            primary_theme = ?,
            scenario_type = ?,
            signal_strength = ?,
            confidence_score = ?,
            confidence_level = ?,
            last_confirmed_at = ?,
            last_updated_at = ?,
            expires_at = ?,
            event_score = ?,
            attention_score = ?,
            source_breadth_score = ?,
            validity_flags_json = ?,
            confidence_reasons_json = ?,
            detection_path = ?,
            authenticity_score = ?,
            cross_platform_corroboration = ?,
            metadata_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            str(cluster["title"]),
            str(cluster["summary"]),
            str(cluster["primary_theme"]),
            scenario_type_for(str(cluster["primary_theme"])),
            signal_strength,
            confidence,
            confidence_level(confidence),
            last_seen_at,
            last_seen_at,
            last_seen_at + 90 * DAY_SECONDS,
            source_breadth,
            authenticity,
            source_breadth,
            json.dumps(flags) if flags else None,
            json.dumps(confidence_reasons),
            detection_path,
            authenticity,
            1 if detection_path == "mixed_anomaly_led" else 0,
            json.dumps(scenario_metadata, sort_keys=True),
            now,
            situation_id,
        ),
    )
    return situation_id


def run(*, db_path: Path, limit: int, dry_run: bool) -> Dict[str, Any]:
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        clusters = load_ready_clusters(conn, limit=limit)
        refresh_clusters = load_promoted_clusters_to_refresh(conn, limit=limit)
        promoted: List[Dict[str, Any]] = []
        refreshed: List[Dict[str, Any]] = []
        now = int(time.time())
        if dry_run:
            for c in clusters:
                promoted.append({
                    "cluster_id": int(c["id"]),
                    "slug": str(c["slug"]),
                    "title": str(c["title"]),
                    "mapped_tickers": parse_json_list(c["mapped_tickers_json"])[:10],
                })
            for c in refresh_clusters:
                refreshed.append({
                    "cluster_id": int(c["id"]),
                    "situation_id": int(c["promotion_situation_id"]),
                    "slug": str(c["slug"]),
                    "title": str(c["title"]),
                })
        else:
            for c in clusters:
                situation_id = promote_cluster(conn, c, now=now)
                promoted.append({
                    "cluster_id": int(c["id"]),
                    "situation_id": situation_id,
                    "slug": str(c["slug"]),
                    "title": str(c["title"]),
                })
            for c in refresh_clusters:
                situation_id = refresh_promoted_cluster(conn, c, now=now)
                refreshed.append({
                    "cluster_id": int(c["id"]),
                    "situation_id": situation_id,
                    "slug": str(c["slug"]),
                    "title": str(c["title"]),
                })
            conn.commit()
        return {
            "ok": True,
            "dry_run": dry_run,
            "eligible_clusters": len(clusters),
            "refreshable_clusters": len(refresh_clusters),
            "promoted_count": 0 if dry_run else len(promoted),
            "refreshed_count": 0 if dry_run else len(refreshed),
            "promoted": promoted,
            "refreshed": refreshed,
        }
    finally:
        conn.close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Promote SCENARIO_READY narrative clusters into market_situations."
    )
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(db_path=Path(args.db_path), limit=max(1, args.limit), dry_run=args.dry_run), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
