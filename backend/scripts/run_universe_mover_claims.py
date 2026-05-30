#!/usr/bin/env python3
"""
Promote normalized universe movers into the narrative-claim pipeline.

This is the bridge from:

    universe_symbol_perturbations -> emerging_claims

It deliberately does not create market_situations directly. A mover must still
survive narrative clustering, source-breadth checks, authenticity scoring, and
the existing SCENARIO_READY promotion bridge before it becomes a Social ARB
card.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 7
THEME = "single_company_social_perturbation"
CLAIM_TYPE = "single_company_social_perturbation"


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[universe-mover-claims] DB missing at {db_path}")
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
            f"[universe-mover-claims] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def latest_perturbation_day(conn: sqlite3.Connection) -> Optional[int]:
    row = conn.execute(
        "SELECT MAX(day) AS day FROM universe_symbol_perturbations"
    ).fetchone()
    return int(row["day"]) if row and row["day"] is not None else None


def load_candidate_movers(
    conn: sqlite3.Connection,
    *,
    day: int,
    min_z: float,
    min_score: float,
    min_mentions: int,
    min_discovery: int,
    include_confirmation_only: bool,
    limit: int,
) -> List[sqlite3.Row]:
    wheres = [
        "day = ?",
        "mention_count >= ?",
        "(z_score >= ? OR perturbation_score >= ?)",
    ]
    params: List[Any] = [day, min_mentions, min_z, min_score]
    if not include_confirmation_only:
        wheres.append("discovery_count >= ?")
        params.append(min_discovery)
    params.append(limit)
    return conn.execute(
        f"""
        SELECT *
        FROM universe_symbol_perturbations
        WHERE {' AND '.join(wheres)}
        ORDER BY perturbation_score DESC, z_score DESC, mention_count DESC
        LIMIT ?
        """,
        params,
    ).fetchall()


def load_supporting_mentions(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    per_mover_limit: int,
) -> List[sqlite3.Row]:
    return conn.execute(
        """
        SELECT hit_id, posted_at, author, discovery_role, match_method, matched_text
        FROM universe_symbol_mentions
        WHERE symbol = ?
          AND source_type = ?
          AND source_community = ?
          AND day = ?
        ORDER BY posted_at DESC, hit_id DESC
        LIMIT ?
        """,
        (
            row["symbol"],
            row["source_type"],
            row["source_community"],
            int(row["day"]),
            per_mover_limit,
        ),
    ).fetchall()


def content_hash_for(
    *,
    symbol: str,
    source_type: str,
    source_community: str,
    day: int,
    hit_id: int,
) -> str:
    payload = {
        "kind": "universe_mover_claim",
        "symbol": symbol,
        "source_type": source_type,
        "source_community": source_community,
        "day": day,
        "hit_id": hit_id,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def claim_text_for(row: sqlite3.Row) -> str:
    symbol = str(row["symbol"]).upper()
    source = f"{row['source_type']} / {row['source_community']}"
    return (
        f"{symbol} is showing abnormal organic social activity in {source}: "
        f"{int(row['mention_count'])} mention(s) versus a "
        f"{float(row['baseline_mean'] or 0):.1f} baseline, "
        f"z-score {float(row['z_score'] or 0):.2f}, velocity "
        f"{float(row['velocity_ratio'] or 0):.1f}x."
    )


def flags_for(row: sqlite3.Row) -> List[str]:
    flags = ["UNIVERSE_MOVER"]
    if int(row["confirmation_count"] or 0) > 0 and int(row["discovery_count"] or 0) == 0:
        flags.append("TICKER_CONFIRMATION_ONLY")
    if int(row["discovery_count"] or 0) > 0:
        flags.append("ORGANIC_DISCOVERY")
    # One mover row is one source/community. The cluster builder removes this
    # once another source type corroborates the same symbol.
    flags.append("SINGLE_SOURCE_RISK")
    return sorted(set(flags))


def confidence_for(row: sqlite3.Row) -> float:
    z = max(0.0, float(row["z_score"] or 0.0))
    velocity = max(0.0, float(row["velocity_ratio"] or 0.0))
    mentions = max(0, int(row["mention_count"] or 0))
    discovery = max(0, int(row["discovery_count"] or 0))
    score = 0.42 + min(0.16, z * 0.025) + min(0.10, velocity * 0.012)
    score += min(0.08, mentions * 0.01) + min(0.08, discovery * 0.012)
    return round(max(0.1, min(0.72, score)), 4)


def insert_claim_for_hit(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    mention: sqlite3.Row,
    *,
    now: int,
    dry_run: bool,
) -> bool:
    symbol = str(row["symbol"]).upper()
    source_type = str(row["source_type"])
    source_community = str(row["source_community"])
    day = int(row["day"])
    hit_id = int(mention["hit_id"])
    content_hash = content_hash_for(
        symbol=symbol,
        source_type=source_type,
        source_community=source_community,
        day=day,
        hit_id=hit_id,
    )
    if dry_run:
        existing = conn.execute(
            "SELECT 1 FROM emerging_claims WHERE content_hash = ?",
            (content_hash,),
        ).fetchone()
        return existing is None

    flags = flags_for(row)
    first_seen = int(mention["posted_at"] or row["day"])
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO emerging_claims (
            claim_text, claim_type, source_hit_ids_json,
            detected_entities_json, detected_brands_json, detected_tickers_json,
            detected_themes_json, event_dates_json, confidence,
            verification_status, validity_flags_json, extraction_method,
            extraction_model, content_hash, first_seen_at, last_seen_at,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            claim_text_for(row),
            CLAIM_TYPE,
            json.dumps([hit_id]),
            json.dumps([symbol]),
            json.dumps([]),
            json.dumps([symbol]),
            json.dumps([THEME]),
            json.dumps([]),
            confidence_for(row),
            "unverified",
            json.dumps(flags),
            "universe_mover_rule",
            None,
            content_hash,
            first_seen,
            first_seen,
            now,
            now,
        ),
    )
    return cur.rowcount > 0


def run(
    *,
    db_path: Path,
    day: Optional[int],
    min_z: float,
    min_score: float,
    min_mentions: int,
    min_discovery: int,
    include_confirmation_only: bool,
    limit: int,
    per_mover_limit: int,
    dry_run: bool,
) -> Dict[str, Any]:
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        for table in [
            "universe_symbol_perturbations",
            "universe_symbol_mentions",
            "emerging_claims",
        ]:
            if not table_exists(conn, table):
                sys.exit(f"[universe-mover-claims] Required table missing: {table}")

        score_day = int(day) if day is not None else latest_perturbation_day(conn)
        if score_day is None:
            return {
                "ok": True,
                "dry_run": dry_run,
                "day": None,
                "movers_scanned": 0,
                "claims_inserted": 0,
            }

        movers = load_candidate_movers(
            conn,
            day=score_day,
            min_z=min_z,
            min_score=min_score,
            min_mentions=min_mentions,
            min_discovery=min_discovery,
            include_confirmation_only=include_confirmation_only,
            limit=limit,
        )
        inserted = 0
        samples: List[Dict[str, Any]] = []
        now = int(time.time())
        for mover in movers:
            mentions = load_supporting_mentions(
                conn,
                mover,
                per_mover_limit=per_mover_limit,
            )
            mover_inserted = 0
            for mention in mentions:
                if insert_claim_for_hit(conn, mover, mention, now=now, dry_run=dry_run):
                    inserted += 1
                    mover_inserted += 1
            samples.append(
                {
                    "symbol": str(mover["symbol"]),
                    "source": f"{mover['source_type']} / {mover['source_community']}",
                    "mentions": int(mover["mention_count"]),
                    "z_score": float(mover["z_score"] or 0),
                    "perturbation_score": float(mover["perturbation_score"] or 0),
                    "claims_inserted": mover_inserted,
                }
            )
        if not dry_run:
            conn.commit()
        return {
            "ok": True,
            "dry_run": dry_run,
            "day": score_day,
            "movers_scanned": len(movers),
            "claims_inserted": inserted,
            "thresholds": {
                "min_z": min_z,
                "min_score": min_score,
                "min_mentions": min_mentions,
                "min_discovery": min_discovery,
                "include_confirmation_only": include_confirmation_only,
            },
            "sample_movers": samples[:10],
        }
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bridge normalized universe movers into emerging_claims."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--day", type=int, default=None, help="Unix day bucket. Default: latest perturbation day.")
    parser.add_argument("--min-z", type=float, default=2.5)
    parser.add_argument("--min-score", type=float, default=35.0)
    parser.add_argument("--min-mentions", type=int, default=3)
    parser.add_argument("--min-discovery", type=int, default=1)
    parser.add_argument("--include-confirmation-only", action="store_true")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--per-mover-limit", type=int, default=50)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    result = run(
        db_path=args.db,
        day=args.day,
        min_z=args.min_z,
        min_score=args.min_score,
        min_mentions=args.min_mentions,
        min_discovery=args.min_discovery,
        include_confirmation_only=args.include_confirmation_only,
        limit=args.limit,
        per_mover_limit=args.per_mover_limit,
        dry_run=args.dry_run,
    )
    prefix = "[universe-mover-claims]"
    print(prefix, json.dumps(result, sort_keys=True))
    if args.verbose:
        for row in result.get("sample_movers", []):
            print(prefix, row)


if __name__ == "__main__":
    main()
