#!/usr/bin/env python
"""Cross-engine corroboration logic (PRD D21 M5, S8).

When entities overlap between a Macro Engine scenario and a Social
Arbitrage scenario, upgrades detection_path:

  news_cluster    + topic_anomaly overlap → mixed_news_led
  topic_anomaly   + news_cluster  overlap → mixed_anomaly_led

Corroboration adds +0.10 to confidence_score (capped at 1.0).

The scoring profile follows the seeding engine (D27): a scenario that
started as news_cluster keeps the Macro profile even after upgrade.

Usage:
    py backend/scripts/run_cross_engine_corroboration.py
    py backend/scripts/run_cross_engine_corroboration.py --dry-run --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Dict, List, Optional, Set, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")

EXPECTED_SCHEMA_VERSION = 6
CONFIDENCE_BONUS = 0.10


def _extract_entities(metadata_json: Optional[str]) -> Tuple[Set[str], Set[str]]:
    """Extract entity_ids and tickers from a scenario's metadata_json."""
    if not metadata_json:
        return set(), set()
    try:
        meta = json.loads(metadata_json)
    except (json.JSONDecodeError, TypeError):
        return set(), set()

    entity_ids = set(meta.get("entity_ids", []))
    tickers = set(meta.get("tickers", []))
    watch_tickers = set(meta.get("watch_tickers", []))
    return entity_ids, tickers | watch_tickers


def _entity_overlap(
    entities_a: Set[str], tickers_a: Set[str],
    entities_b: Set[str], tickers_b: Set[str],
) -> int:
    """Count shared entities between two scenarios.

    Overlaps can occur via:
    - Shared entity_ids (e.g. TICKER:AAPL, SECTOR:Technology)
    - Shared tickers (e.g. AAPL in both ticker sets)
    - Ticker appearing as entity_id (e.g. TICKER:AAPL matching ticker AAPL)
    """
    # Direct entity_id overlap
    shared = entities_a & entities_b

    # Ticker overlap
    shared_tickers = tickers_a & tickers_b

    # Cross-match: ticker in A matches TICKER:sym in B (and vice versa)
    for t in tickers_a:
        if f"TICKER:{t}" in entities_b:
            shared_tickers.add(t)
    for t in tickers_b:
        if f"TICKER:{t}" in entities_a:
            shared_tickers.add(t)

    return len(shared) + len(shared_tickers)


def run(
    db_path: str,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    min_overlap: int = 1,
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
            f"[cross-engine] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )

    # Load all active scenarios grouped by detection_path
    all_scenarios = conn.execute(
        """
        SELECT id, title, detection_path, confidence_score, metadata_json, status
        FROM market_situations
        WHERE status NOT IN ('FADING', 'ARCHIVED')
          AND detection_path IN ('news_cluster', 'topic_anomaly')
        ORDER BY id
        """
    ).fetchall()

    macro_scenarios = [r for r in all_scenarios if r["detection_path"] == "news_cluster"]
    social_scenarios = [r for r in all_scenarios if r["detection_path"] == "topic_anomaly"]

    if verbose:
        print(
            f"[cross-engine] {len(macro_scenarios)} news_cluster, "
            f"{len(social_scenarios)} topic_anomaly scenarios to check"
        )

    if not macro_scenarios or not social_scenarios:
        print("[cross-engine] One engine has 0 scenarios; no cross-engine matches possible.")
        conn.close()
        return {"upgraded_macro": 0, "upgraded_social": 0, "skipped": 0}

    # Pre-extract entities for all scenarios
    macro_entities: Dict[int, Tuple[Set[str], Set[str]]] = {}
    for s in macro_scenarios:
        macro_entities[s["id"]] = _extract_entities(s["metadata_json"])

    social_entities: Dict[int, Tuple[Set[str], Set[str]]] = {}
    for s in social_scenarios:
        social_entities[s["id"]] = _extract_entities(s["metadata_json"])

    upgraded_macro = 0
    upgraded_social = 0
    now = int(time.time())

    # M5: Check if any Macro scenario shares entities with a Social scenario
    for macro in macro_scenarios:
        m_ent, m_tick = macro_entities[macro["id"]]
        if not m_ent and not m_tick:
            continue

        best_overlap = 0
        best_social_id = None
        for social in social_scenarios:
            s_ent, s_tick = social_entities[social["id"]]
            overlap = _entity_overlap(m_ent, m_tick, s_ent, s_tick)
            if overlap > best_overlap:
                best_overlap = overlap
                best_social_id = social["id"]

        if best_overlap >= min_overlap:
            old_conf = float(macro["confidence_score"]) if macro["confidence_score"] else 0.0
            new_conf = min(old_conf + CONFIDENCE_BONUS, 1.0)

            meta = json.loads(macro["metadata_json"]) if macro["metadata_json"] else {}
            meta["cross_engine_corroboration"] = {
                "corroborating_scenario_id": best_social_id,
                "overlap_count": best_overlap,
                "confidence_bonus": CONFIDENCE_BONUS,
                "upgraded_at": now,
            }

            if verbose:
                title = (macro["title"] or "")[:50]
                print(
                    f"  UPGRADE id={macro['id']} news_cluster → mixed_news_led "
                    f"(overlap={best_overlap} with social_id={best_social_id}) "
                    f"conf {old_conf:.3f} → {new_conf:.3f} | {title}"
                )

            if not dry_run:
                conn.execute(
                    """
                    UPDATE market_situations SET
                        detection_path = 'mixed_news_led',
                        confidence_score = ?,
                        metadata_json = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (new_conf, json.dumps(meta), now, macro["id"]),
                )
            upgraded_macro += 1

    # S8: Check if any Social scenario shares entities with a Macro scenario
    for social in social_scenarios:
        s_ent, s_tick = social_entities[social["id"]]
        if not s_ent and not s_tick:
            continue

        best_overlap = 0
        best_macro_id = None
        for macro in macro_scenarios:
            m_ent, m_tick = macro_entities[macro["id"]]
            overlap = _entity_overlap(s_ent, s_tick, m_ent, m_tick)
            if overlap > best_overlap:
                best_overlap = overlap
                best_macro_id = macro["id"]

        if best_overlap >= min_overlap:
            old_conf = float(social["confidence_score"]) if social["confidence_score"] else 0.0
            new_conf = min(old_conf + CONFIDENCE_BONUS, 1.0)

            meta = json.loads(social["metadata_json"]) if social["metadata_json"] else {}
            meta["cross_engine_corroboration"] = {
                "corroborating_scenario_id": best_macro_id,
                "overlap_count": best_overlap,
                "confidence_bonus": CONFIDENCE_BONUS,
                "upgraded_at": now,
            }

            if verbose:
                title = (social["title"] or "")[:50]
                print(
                    f"  UPGRADE id={social['id']} topic_anomaly → mixed_anomaly_led "
                    f"(overlap={best_overlap} with macro_id={best_macro_id}) "
                    f"conf {old_conf:.3f} → {new_conf:.3f} | {title}"
                )

            if not dry_run:
                conn.execute(
                    """
                    UPDATE market_situations SET
                        detection_path = 'mixed_anomaly_led',
                        confidence_score = ?,
                        metadata_json = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (new_conf, json.dumps(meta), now, social["id"]),
                )
            upgraded_social += 1

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "upgraded_macro": upgraded_macro,
        "upgraded_social": upgraded_social,
        "dry_run": dry_run,
    }
    print(f"[cross-engine] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Cross-engine corroboration (D21 M5, S8)"
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--min-overlap", type=int, default=1,
                        help="Min shared entities to trigger upgrade (default 1)")
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        min_overlap=args.min_overlap,
    )
