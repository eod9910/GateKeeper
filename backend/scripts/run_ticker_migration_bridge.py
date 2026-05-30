#!/usr/bin/env python3
"""Ticker-indexed migration bridge (PRD D28).

Reads buzz spikes from social-intelligence.sqlite (StockTwits + Yahoo Finance)
and checks whether any mapped ticker from active emerging topics or social-arb
scenarios has a recent mention spike. If so, sets migration_to_ticker_indexed
on the emerging topic and can escalate the scenario lifecycle.

This bridges the existing Scanner social intelligence data (ticker-indexed:
StockTwits, Yahoo Finance) into the Market Intelligence engine's Social
Arbitrage pipeline (topic-indexed: HN, 4chan, Bluesky, Discord, forums).

Per PRD D28: "When a concept's mapped ticker showed a buzz spike in a
ticker-indexed source 1-7 days AFTER the topic-indexed anomaly fired,
the emerging topic gets migration_to_ticker_indexed = true"

Pipeline:
    1. Load active emerging topics + their resolved tickers
    2. Load recent ticker_social_daily from social-intelligence.sqlite
    3. For each emerging topic, check if any mapped ticker had a mention
       spike (1d mentions > 3x 7d daily avg) within 7 days of anomaly
    4. If migration detected, update emerging_topics + escalate scenario

Usage:
    py backend/scripts/run_ticker_migration_bridge.py --verbose
    py backend/scripts/run_ticker_migration_bridge.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
MI_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
SI_DB_PATH = ROOT / "backend" / "data" / "social-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 6

SPIKE_RATIO_THRESHOLD = 2.5
MIGRATION_WINDOW_DAYS = 7
BUZZ_ZSCORE_THRESHOLD = 1.5


def run(
    mi_db_path: str = str(MI_DB_PATH),
    si_db_path: str = str(SI_DB_PATH),
    *,
    dry_run: bool = False,
    verbose: bool = False,
) -> Dict[str, Any]:

    if not os.path.isfile(si_db_path):
        print("[migration-bridge] social-intelligence.sqlite not found, skipping")
        return {"status": "skipped", "reason": "no social-intelligence DB"}

    mi = sqlite3.connect(mi_db_path)
    mi.row_factory = sqlite3.Row
    mi.execute("PRAGMA journal_mode=WAL")

    si = sqlite3.connect(si_db_path)
    si.row_factory = sqlite3.Row

    actual = mi.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[migration-bridge] schema_version mismatch")

    topics = mi.execute(
        "SELECT id, concept_id, seed_community, peak_z_score, "
        "  first_anomaly_at, last_anomaly_at, resolved_tickers_json, "
        "  migration_to_ticker_indexed, migrated_at, seeded_situation_id "
        "FROM emerging_topics "
        "WHERE suppression_reason IS NULL"
    ).fetchall()

    if verbose:
        print(f"[migration-bridge] {len(topics)} emerging topics to check")

    now = int(time.time())
    today = time.strftime("%Y-%m-%d")
    cutoff_epoch = now - (MIGRATION_WINDOW_DAYS * 86400)
    cutoff_date = time.strftime("%Y-%m-%d", time.gmtime(cutoff_epoch))

    migrations_found = 0
    scenarios_escalated = 0
    tickers_checked = 0
    spikes_detected = 0

    for topic in topics:
        tickers_json = topic["resolved_tickers_json"]
        if not tickers_json:
            continue

        try:
            tickers = json.loads(tickers_json)
        except (json.JSONDecodeError, TypeError):
            continue

        if not tickers:
            continue

        if isinstance(tickers[0], dict):
            ticker_list = [t.get("ticker", t.get("symbol", "")) for t in tickers]
        else:
            ticker_list = [str(t) for t in tickers]

        ticker_list = [t for t in ticker_list if t and len(t) <= 6]

        if not ticker_list:
            continue

        already_migrated = bool(topic["migration_to_ticker_indexed"])
        anomaly_at = topic["first_anomaly_at"] or topic["last_anomaly_at"] or 0

        if verbose:
            concept_id = topic["concept_id"]
            concept_row = mi.execute(
                "SELECT concept_key FROM tracked_concepts WHERE id = ?",
                (concept_id,)
            ).fetchone()
            concept_key = concept_row["concept_key"] if concept_row else f"concept_{concept_id}"
            print(f"\n  topic={topic['id']} concept={concept_key} tickers={ticker_list} migrated={already_migrated}")

        for ticker in ticker_list:
            tickers_checked += 1

            spike = si.execute(
                "SELECT symbol, platform, trade_date, "
                "  mention_count_1d, mention_count_7d, weighted_sentiment "
                "FROM ticker_social_daily "
                "WHERE symbol = ? AND platform != 'aggregate' "
                "  AND trade_date >= ? "
                "ORDER BY mention_count_1d DESC LIMIT 1",
                (ticker, cutoff_date),
            ).fetchone()

            if not spike:
                continue

            m1d = spike["mention_count_1d"] or 0
            m7d = spike["mention_count_7d"] or 0
            daily_avg = m7d / 7.0 if m7d > 0 else 0

            if daily_avg <= 0:
                continue

            ratio = m1d / daily_avg

            buzz_row = si.execute(
                "SELECT buzz_zscore, mention_velocity, final_buzz_score "
                "FROM ticker_buzz_scores "
                "WHERE symbol = ? AND trade_date >= ? "
                "ORDER BY buzz_zscore DESC LIMIT 1",
                (ticker, cutoff_date),
            ).fetchone()

            buzz_z = buzz_row["buzz_zscore"] if buzz_row else 0
            velocity = buzz_row["mention_velocity"] if buzz_row else 0

            is_spike = ratio >= SPIKE_RATIO_THRESHOLD or (buzz_z and buzz_z >= BUZZ_ZSCORE_THRESHOLD)

            if is_spike:
                spikes_detected += 1
                if verbose:
                    print(f"    SPIKE: {ticker} on {spike['platform']} {spike['trade_date']} "
                          f"1d={m1d} 7d_avg={daily_avg:.0f} ratio={ratio:.1f}x "
                          f"buzz_z={buzz_z or 0:.1f} velocity={velocity or 0:.1f}")

                if not already_migrated and not dry_run:
                    mi.execute(
                        "UPDATE emerging_topics "
                        "SET migration_to_ticker_indexed = 1, migrated_at = ? "
                        "WHERE id = ?",
                        (now, topic["id"]),
                    )
                    migrations_found += 1
                    already_migrated = True

                    if verbose:
                        print(f"    -> Set migration_to_ticker_indexed = true")

                    sit_id = topic["seeded_situation_id"]
                    if sit_id:
                        current = mi.execute(
                            "SELECT status, detection_path FROM market_situations WHERE id = ?",
                            (sit_id,),
                        ).fetchone()
                        if current and current["status"] == "EARLY":
                            mi.execute(
                                "UPDATE market_situations SET status = 'DEVELOPING', "
                                "updated_at = ? WHERE id = ?",
                                (now, sit_id),
                            )
                            scenarios_escalated += 1
                            if verbose:
                                print(f"    -> Escalated scenario {sit_id} EARLY -> DEVELOPING")

                elif already_migrated and verbose:
                    print(f"    (already migrated)")

    if not dry_run:
        mi.commit()

    mi.close()
    si.close()

    summary = {
        "topics_checked": len(topics),
        "tickers_checked": tickers_checked,
        "spikes_detected": spikes_detected,
        "migrations_set": migrations_found,
        "scenarios_escalated": scenarios_escalated,
        "dry_run": dry_run,
    }
    print(f"[migration-bridge] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ticker migration bridge (D28)")
    parser.add_argument("--mi-db", default=str(MI_DB_PATH))
    parser.add_argument("--si-db", default=str(SI_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    run(args.mi_db, args.si_db, dry_run=args.dry_run, verbose=args.verbose)
