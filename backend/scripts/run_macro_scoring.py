#!/usr/bin/env python
"""Macro Engine scoring profile applicator (PRD D27).

Rescores all `detection_path='news_cluster'` scenarios using the Macro
scoring profile (event_score 0.30, market_confirmation 0.25,
source_breadth 0.20, attention 0.15, novelty 0.10 — no coverage penalty,
no authenticity multiplier).

Designed to run on a cron (after macro_clustering and cluster_naming)
so that scores stay fresh as new evidence arrives.

Usage:
    py backend/scripts/run_macro_scoring.py
    py backend/scripts/run_macro_scoring.py --dry-run --verbose
    py backend/scripts/run_macro_scoring.py --situation-id 175
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")

EXPECTED_SCHEMA_VERSION = 6

sys.path.insert(0, PROJECT_ROOT)

from backend.services.macro_scoring import (  # noqa: E402
    MacroScoringResult,
    score_macro_scenario,
)


def _derive_confidence_level(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.55:
        return "medium"
    if score >= 0.35:
        return "low"
    return "very_low"


def run(
    db_path: str,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    situation_id: Optional[int] = None,
    max_scenarios: int = 500,
) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(actual["value"]) if actual else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[macro-scoring] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}. Run "
            f"backend/scripts/build_market_intelligence_db.py first."
        )

    where = "detection_path = 'news_cluster'"
    params: list = []
    if situation_id is not None:
        where += " AND id = ?"
        params.append(situation_id)

    scenarios = conn.execute(
        f"""
        SELECT id, title, status, signal_strength, confidence_score,
               event_score, source_breadth_score, metadata_json
        FROM market_situations
        WHERE {where}
        ORDER BY id
        LIMIT ?
        """,
        params + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[macro-scoring] {len(scenarios)} news_cluster scenarios to rescore")

    scored = 0
    skipped = 0
    for row in scenarios:
        sid = int(row["id"])
        try:
            result = score_macro_scenario(conn, sid)
        except Exception as e:
            print(f"  [macro-scoring] ERROR scoring id={sid}: {e}")
            skipped += 1
            continue

        old_ss = row["signal_strength"]
        old_conf = row["confidence_score"]

        if verbose:
            title_short = (row["title"] or "")[:55]
            print(
                f"  id={sid} evidence={result.evidence_count} "
                f"score={result.scenario_score:.1f} "
                f"(was {old_ss}) conf={result.confidence_score:.3f} "
                f"(was {old_conf}) flags={result.validity_flags} "
                f"| {title_short}"
            )

        if dry_run:
            scored += 1
            continue

        meta = json.loads(row["metadata_json"]) if row["metadata_json"] else {}
        meta["scoring"] = result.to_metadata()
        confidence_level = _derive_confidence_level(result.confidence_score)

        conn.execute(
            """
            UPDATE market_situations SET
                signal_strength = ?,
                confidence_score = ?,
                confidence_level = ?,
                event_score = ?,
                source_breadth_score = ?,
                evidence_count = ?,
                validity_flags_json = ?,
                metadata_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                result.signal_strength,
                result.confidence_score,
                confidence_level,
                result.event_score,
                result.source_breadth_score,
                result.evidence_count,
                json.dumps(result.validity_flags),
                json.dumps(meta),
                int(time.time()),
                sid,
            ),
        )
        scored += 1

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "scored": scored,
        "skipped": skipped,
        "dry_run": dry_run,
    }
    print(f"[macro-scoring] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Macro scoring profile (D27)")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--situation-id", type=int, default=None,
                        help="Score a single scenario by ID")
    parser.add_argument("--max-scenarios", type=int, default=500)
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        situation_id=args.situation_id,
        max_scenarios=args.max_scenarios,
    )
