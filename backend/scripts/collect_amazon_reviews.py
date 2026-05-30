#!/usr/bin/env python3
"""Amazon review velocity collector — Phase 6 (D19).

Scrapes Amazon product pages for review count and average rating,
computes review velocity (new reviews per day vs historical baseline)
as a consumer adoption proxy.

Uses Amazon's public product page — no API key required. Rate-limited
to be polite (3s between requests).

Pipeline:
    1. Load brand -> ASIN mapping from brand-to-ticker.json (products field)
    2. For each mapped ASIN, fetch product page and extract review count + rating
    3. Compare against previous fetch to compute daily review velocity
    4. Store in consumer_brand_signals with source_type='amazon_reviews'

Usage:
    py backend/scripts/collect_amazon_reviews.py
    py backend/scripts/collect_amazon_reviews.py --verbose
    py backend/scripts/collect_amazon_reviews.py --dry-run
    py backend/scripts/collect_amazon_reviews.py --brands oatly,celsius
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
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
BRAND_TICKER_PATH = ROOT / "backend" / "data" / "scenarios" / "brand-to-ticker.json"
EXPECTED_SCHEMA_VERSION = 6

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
AMAZON_BASE = "https://www.amazon.com/dp"
RATE_LIMIT_DELAY = 3.0

BRAND_ASINS: Dict[str, List[str]] = {
    "oatly": ["B017OHO8OI"],
    "celsius": ["B005FMYGHW"],
    "crocs": ["B001ACSA64"],
    "stanley_cup": ["B09GKZ8JLK"],
    "lululemon": ["B09VHVHGY4"],
    "yeti": ["B073WJBQPR"],
    "dyson": ["B0BT9PJYF5"],
    "airpods": ["B0D1XD1ZV3"],
    "nintendo_switch": ["B0CHX5YNPX"],
    "peloton": ["B08QWMDL69"],
    "hoka": ["B09HQVXMWW"],
    "on_running": ["B09VZ53N3S"],
    "allbirds": ["B0BXFWFWZ2"],
    "birkenstocks": ["B0007TKMSG"],
    "skechers": ["B07B4P86W7"],
    "nike": ["B07RKLBLM7"],
    "adidas": ["B07FD8TQMP"],
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


def _fetch_amazon_product(asin: str) -> Optional[Dict]:
    """Fetch Amazon product page and extract review count + rating."""
    url = f"{AMAZON_BASE}/{asin}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        review_count = None
        rating = None

        rc_match = re.search(r'(\d[\d,]*)\s*(?:global\s+)?(?:ratings?|reviews?)', html, re.I)
        if rc_match:
            review_count = int(rc_match.group(1).replace(",", ""))

        rating_match = re.search(r'(\d\.\d)\s*out\s*of\s*5', html)
        if rating_match:
            rating = float(rating_match.group(1))

        return {
            "review_count": review_count,
            "rating": rating,
            "asin": asin,
        }
    except urllib.error.HTTPError as e:
        if e.code == 503:
            return None
        return None
    except Exception:
        return None


def run(
    db_path: str = str(DEFAULT_DB_PATH),
    *,
    dry_run: bool = False,
    verbose: bool = False,
    brands: Optional[List[str]] = None,
) -> Dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[amazon-reviews] schema_version mismatch")

    _ensure_signals_table(conn)

    ticker_lookup: Dict[str, str] = {}
    rows = conn.execute(
        "SELECT brand_key, parent_ticker FROM brand_to_ticker WHERE parent_ticker IS NOT NULL"
    ).fetchall()
    for r in rows:
        ticker_lookup[r["brand_key"]] = r["parent_ticker"]

    brand_list = brands if brands else list(BRAND_ASINS.keys())

    now = int(time.time())
    today = time.strftime("%Y-%m-%d")

    fetched = 0
    stored = 0
    velocity_alerts = 0
    errors = 0

    for brand_key in brand_list:
        asins = BRAND_ASINS.get(brand_key, [])
        if not asins:
            continue

        ticker = ticker_lookup.get(brand_key)
        if verbose:
            print(f"  {brand_key} ({ticker or 'no ticker'}): {len(asins)} ASINs")

        if dry_run:
            fetched += 1
            continue

        total_reviews = 0
        total_rating = 0.0
        rating_count = 0

        for asin in asins:
            result = _fetch_amazon_product(asin)
            if result:
                fetched += 1
                if result["review_count"] is not None:
                    total_reviews += result["review_count"]
                if result["rating"] is not None:
                    total_rating += result["rating"]
                    rating_count += 1
            else:
                errors += 1

            time.sleep(RATE_LIMIT_DELAY)

        if total_reviews == 0 and rating_count == 0:
            continue

        avg_rating = round(total_rating / max(rating_count, 1), 2)

        prev = conn.execute(
            """SELECT signal_value, fetched_at FROM consumer_brand_signals
               WHERE brand_key = ? AND source_type = 'amazon_reviews'
               ORDER BY signal_date DESC LIMIT 1""",
            (brand_key,),
        ).fetchone()

        velocity = 0.0
        if prev and prev["signal_value"]:
            days_diff = max((now - prev["fetched_at"]) / 86400, 1)
            new_reviews = total_reviews - prev["signal_value"]
            velocity = round(new_reviews / days_diff, 1)
            if velocity > 50:
                velocity_alerts += 1
                if verbose:
                    print(f"    VELOCITY: {brand_key} +{velocity:.0f} reviews/day")

        conn.execute(
            """INSERT OR REPLACE INTO consumer_brand_signals (
                brand_key, parent_ticker, source_type, signal_date,
                signal_value, baseline_value, acceleration,
                raw_payload_json, fetched_at
            ) VALUES (?, ?, 'amazon_reviews', ?, ?, ?, ?, ?, ?)""",
            (
                brand_key, ticker, today,
                float(total_reviews), avg_rating, velocity,
                json.dumps({
                    "asins": asins,
                    "total_reviews": total_reviews,
                    "avg_rating": avg_rating,
                    "velocity_per_day": velocity,
                }),
                now,
            ),
        )
        stored += 1

    if not dry_run:
        conn.commit()

    conn.close()

    summary = {
        "brands_processed": fetched,
        "signals_stored": stored,
        "velocity_alerts": velocity_alerts,
        "errors": errors,
        "dry_run": dry_run,
    }
    print(f"[amazon-reviews] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Amazon review velocity collector (Phase 6)")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--brands", type=str, default=None,
                        help="Comma-separated brand_keys")
    args = parser.parse_args()

    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        brands=args.brands.split(",") if args.brands else None,
    )
