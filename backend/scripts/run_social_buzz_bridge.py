#!/usr/bin/env python3
"""Social buzz bridge — imports Scanner buzz data into MI consumer_brand_signals.

Reads ticker_buzz_scores and ticker_social_daily from social-intelligence.sqlite
for all tickers that appear in the MI brand_to_ticker or situation_exposure tables,
and writes the buzz metrics as consumer_brand_signals with source_type='stocktwits_buzz'
and 'yahoo_buzz'. This lets the MI quality dashboard and consumer_brand_score use
the existing Scanner social intelligence data.

Usage:
    py backend/scripts/run_social_buzz_bridge.py --verbose
    py backend/scripts/run_social_buzz_bridge.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
MI_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
SI_DB_PATH = ROOT / "backend" / "data" / "social-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 6


def _open_db(path: str, *, write: bool = False) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=60)
    conn.row_factory = sqlite3.Row
    if write:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=60000")
    return conn


def _ensure_signals_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS consumer_brand_signals (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_key           TEXT NOT NULL,
            parent_ticker       TEXT,
            source_type         TEXT NOT NULL,
            signal_date         TEXT NOT NULL,
            signal_value        REAL,
            baseline_value      REAL,
            acceleration        REAL,
            raw_payload_json    TEXT,
            fetched_at          INTEGER NOT NULL,
            UNIQUE(brand_key, source_type, signal_date)
        )
    """)


def run(
    mi_db_path: str = str(MI_DB_PATH),
    si_db_path: str = str(SI_DB_PATH),
    *,
    dry_run: bool = False,
    verbose: bool = False,
    days_back: int = 7,
) -> Dict[str, Any]:

    if not os.path.isfile(si_db_path):
        print("[social-buzz-bridge] social-intelligence.sqlite not found")
        return {"status": "skipped"}

    mi = _open_db(mi_db_path, write=True)

    actual = mi.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[social-buzz-bridge] schema_version mismatch")

    _ensure_signals_table(mi)

    si = _open_db(si_db_path)

    ticker_to_brand = {}
    rows = mi.execute(
        "SELECT brand_key, parent_ticker FROM brand_to_ticker WHERE parent_ticker IS NOT NULL"
    ).fetchall()
    for r in rows:
        ticker_to_brand[r["parent_ticker"]] = r["brand_key"]

    exposure_tickers = mi.execute(
        "SELECT DISTINCT universe_symbol FROM situation_exposure WHERE universe_symbol IS NOT NULL"
    ).fetchall()
    for r in exposure_tickers:
        sym = r["universe_symbol"]
        if sym not in ticker_to_brand:
            ticker_to_brand[sym] = sym.lower()

    if verbose:
        print(f"[social-buzz-bridge] {len(ticker_to_brand)} tickers to check")

    cutoff = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days_back * 86400))
    now = int(time.time())

    stored = 0
    spikes = 0

    for platform_filter, source_type in [("StockTwits", "stocktwits_buzz"), ("Yahoo Finance", "yahoo_buzz")]:
        for ticker, brand_key in ticker_to_brand.items():
            row = si.execute(
                "SELECT symbol, trade_date, mention_count_1d, mention_count_7d, "
                "  weighted_sentiment, bullish_ratio "
                "FROM ticker_social_daily "
                "WHERE symbol = ? AND platform = ? AND trade_date >= ? "
                "ORDER BY trade_date DESC LIMIT 1",
                (ticker, platform_filter, cutoff),
            ).fetchone()

            if not row or not row["mention_count_1d"]:
                continue

            m1d = row["mention_count_1d"] or 0
            m7d = row["mention_count_7d"] or 0
            daily_avg = m7d / 7.0 if m7d > 0 else 0
            accel = (m1d / daily_avg) if daily_avg > 0 else 1.0

            if accel > 2.0:
                spikes += 1

            if dry_run:
                if verbose and accel > 2.0:
                    print(f"  {ticker:8s} {source_type:15s} 1d={m1d:>5d} 7d_avg={daily_avg:>5.0f} accel={accel:.1f}x")
                continue

            mi.execute(
                """INSERT OR REPLACE INTO consumer_brand_signals (
                    brand_key, parent_ticker, source_type, signal_date,
                    signal_value, baseline_value, acceleration,
                    raw_payload_json, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    brand_key, ticker, source_type, row["trade_date"],
                    float(m1d), round(daily_avg, 1), round(accel, 2),
                    json.dumps({
                        "platform": platform_filter,
                        "sentiment": row["weighted_sentiment"],
                        "bullish_ratio": row["bullish_ratio"],
                        "mention_count_7d": m7d,
                    }),
                    now,
                ),
            )
            stored += 1

    if not dry_run:
        mi.commit()

    mi.close()
    si.close()

    summary = {
        "tickers_mapped": len(ticker_to_brand),
        "signals_stored": stored,
        "mention_spikes": spikes,
        "dry_run": dry_run,
    }
    print(f"[social-buzz-bridge] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Social buzz bridge")
    parser.add_argument("--mi-db", default=str(MI_DB_PATH))
    parser.add_argument("--si-db", default=str(SI_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--days-back", type=int, default=7)
    args = parser.parse_args()

    run(args.mi_db, args.si_db, dry_run=args.dry_run, verbose=args.verbose, days_back=args.days_back)
