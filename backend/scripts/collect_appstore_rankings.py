#!/usr/bin/env python3
"""Apple App Store / Google Play rankings collector — Phase 6 (D19).

Fetches top app rankings from the Apple App Store RSS feed (public, no API
key needed) and stores rank + velocity signals in consumer_brand_signals.

Apple exposes a public RSS/JSON feed:
    https://rss.applemarketingtools.com/api/v2/us/apps/top-free/50/apps.json

For Google Play, we use a similar public feed approach.

Pipeline:
    1. Fetch top-N free/paid/grossing app lists from Apple RSS
    2. Match app names/publishers against brand_to_ticker registry
    3. Store rank position + rank change as consumer brand signals
    4. Flag significant rank changes (new entry or jump > 10 positions)

Usage:
    py backend/scripts/collect_appstore_rankings.py
    py backend/scripts/collect_appstore_rankings.py --verbose
    py backend/scripts/collect_appstore_rankings.py --dry-run
    py backend/scripts/collect_appstore_rankings.py --categories 6014,6015
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 6

APPLE_RSS_BASE = "https://rss.applemarketingtools.com/api/v2/us/apps"
USER_AGENT = "pattern-detector-mi/0.2 (app-store-rankings)"

FEED_TYPES = [
    ("top-free", 100),
    ("top-paid", 50),
    ("top-grossing", 50),
]

CATEGORY_IDS = {
    "6014": "games",
    "6015": "finance",
    "6018": "health_fitness",
    "6013": "health",
    "6012": "lifestyle",
    "6017": "education",
    "6016": "entertainment",
    "6023": "food_drink",
    "6024": "shopping",
    "6020": "social_networking",
}


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


def _fetch_apple_feed(feed_type: str, limit: int, genre_id: Optional[str] = None) -> Optional[List[Dict]]:
    url = f"{APPLE_RSS_BASE}/{feed_type}/{limit}/apps.json"
    if genre_id:
        url = f"{APPLE_RSS_BASE}/{feed_type}/{limit}/apps.json?genre={genre_id}"

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("feed", {}).get("results", [])
            return results
    except Exception:
        return None


def _normalize_name(name: str) -> str:
    """Normalize app name for brand matching."""
    name = name.lower().strip()
    name = re.sub(r'[^a-z0-9\s]', '', name)
    return name


def _build_brand_matcher(conn: sqlite3.Connection) -> Dict[str, Tuple[str, str]]:
    """Build a lookup of normalized brand name fragments -> (brand_key, ticker)."""
    rows = conn.execute(
        "SELECT brand_key, parent_ticker FROM brand_to_ticker WHERE parent_ticker IS NOT NULL"
    ).fetchall()

    matcher: Dict[str, Tuple[str, str]] = {}
    for r in rows:
        brand_key = r["brand_key"]
        ticker = r["parent_ticker"]
        name = brand_key.replace("_", " ").lower()
        matcher[name] = (brand_key, ticker)
        parts = name.split()
        if len(parts) >= 2:
            matcher[parts[0]] = (brand_key, ticker)

    return matcher


def _match_app_to_brand(
    app_name: str,
    artist_name: str,
    matcher: Dict[str, Tuple[str, str]],
) -> Optional[Tuple[str, str]]:
    """Try to match an app to a known brand."""
    norm_name = _normalize_name(app_name)
    norm_artist = _normalize_name(artist_name)

    for brand_fragment, (brand_key, ticker) in matcher.items():
        if brand_fragment in norm_name or brand_fragment in norm_artist:
            return (brand_key, ticker)
    return None


def run(
    db_path: str = str(DEFAULT_DB_PATH),
    *,
    dry_run: bool = False,
    verbose: bool = False,
    categories: Optional[List[str]] = None,
) -> Dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[appstore-rankings] schema_version mismatch")

    _ensure_signals_table(conn)

    matcher = _build_brand_matcher(conn)
    if verbose:
        print(f"[appstore] {len(matcher)} brand fragments in matcher")

    now = int(time.time())
    today = time.strftime("%Y-%m-%d")

    feeds_fetched = 0
    apps_scanned = 0
    matches_found = 0
    signals_stored = 0

    cat_list = categories or list(CATEGORY_IDS.keys())

    for feed_type, limit in FEED_TYPES:
        if verbose:
            print(f"  Fetching {feed_type} (overall, limit={limit})")

        if not dry_run:
            results = _fetch_apple_feed(feed_type, limit)
            if results:
                feeds_fetched += 1
                for rank, app in enumerate(results, 1):
                    apps_scanned += 1
                    app_name = app.get("name", "")
                    artist = app.get("artistName", "")
                    match = _match_app_to_brand(app_name, artist, matcher)
                    if match:
                        brand_key, ticker = match
                        matches_found += 1

                        prev = conn.execute(
                            """SELECT signal_value FROM consumer_brand_signals
                               WHERE brand_key = ? AND source_type = 'app_store_rank'
                               ORDER BY signal_date DESC LIMIT 1""",
                            (brand_key,),
                        ).fetchone()
                        prev_rank = prev["signal_value"] if prev else None
                        rank_change = (prev_rank - rank) if prev_rank else 0

                        conn.execute(
                            """INSERT OR REPLACE INTO consumer_brand_signals (
                                brand_key, parent_ticker, source_type, signal_date,
                                signal_value, baseline_value, acceleration,
                                raw_payload_json, fetched_at
                            ) VALUES (?, ?, 'app_store_rank', ?, ?, ?, ?, ?, ?)""",
                            (
                                brand_key, ticker, today,
                                float(rank), prev_rank,
                                rank_change,
                                json.dumps({
                                    "app_name": app_name,
                                    "artist": artist,
                                    "feed_type": feed_type,
                                    "app_id": app.get("id", ""),
                                    "genre": app.get("genres", [{}])[0].get("name", "") if app.get("genres") else "",
                                }),
                                now,
                            ),
                        )
                        signals_stored += 1

                        if verbose:
                            print(f"    #{rank} {app_name} -> {brand_key} ({ticker}) change={rank_change:+.0f}")
            else:
                if verbose:
                    print(f"    WARN: no data for {feed_type}")

            time.sleep(1)

        for cat_id in cat_list:
            cat_name = CATEGORY_IDS.get(cat_id, cat_id)
            if verbose:
                print(f"  Fetching {feed_type} category={cat_name}")

            if dry_run:
                feeds_fetched += 1
                continue

            results = _fetch_apple_feed(feed_type, min(limit, 50), genre_id=cat_id)
            if results:
                feeds_fetched += 1
                for rank, app in enumerate(results, 1):
                    apps_scanned += 1
                    app_name = app.get("name", "")
                    artist = app.get("artistName", "")
                    match = _match_app_to_brand(app_name, artist, matcher)
                    if match:
                        brand_key, ticker = match
                        matches_found += 1
                        source_key = f"app_store_rank_{cat_name}"

                        conn.execute(
                            """INSERT OR REPLACE INTO consumer_brand_signals (
                                brand_key, parent_ticker, source_type, signal_date,
                                signal_value, baseline_value, acceleration,
                                raw_payload_json, fetched_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                brand_key, ticker, source_key, today,
                                float(rank), None, 0,
                                json.dumps({
                                    "app_name": app_name,
                                    "artist": artist,
                                    "feed_type": feed_type,
                                    "category": cat_name,
                                }),
                                now,
                            ),
                        )
                        signals_stored += 1

                        if verbose:
                            print(f"    #{rank} {app_name} -> {brand_key} ({ticker})")

            time.sleep(1)

    if not dry_run:
        conn.commit()

    conn.close()

    summary = {
        "feeds_fetched": feeds_fetched,
        "apps_scanned": apps_scanned,
        "brand_matches": matches_found,
        "signals_stored": signals_stored,
        "dry_run": dry_run,
    }
    print(f"[appstore-rankings] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="App Store rankings collector (Phase 6)")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--categories", type=str, default=None,
                        help="Comma-separated Apple category IDs")
    args = parser.parse_args()

    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        categories=args.categories.split(",") if args.categories else None,
    )
