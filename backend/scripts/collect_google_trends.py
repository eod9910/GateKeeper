#!/usr/bin/env python3
"""Google Trends collector for Market Intelligence — Phase 6 (D19).

Fetches Google Trends interest-over-time data for brand keywords from
the brand_to_ticker registry. Stores daily interest values as consumer
brand signals that feed into the attention layer for single_company_catalyst
and consumer_cycle scenarios.

Uses the public Google Trends widget API (no API key needed). The same
unofficial JSON endpoint that pytrends uses, but with zero external deps
(stdlib urllib only).

Pipeline:
    1. Load brands with tickers from brand_to_ticker table
    2. For each brand (batched in groups of 5), fetch 90-day interest-over-time
    3. Compute acceleration (7d vs 30d moving average ratio)
    4. Store results in consumer_brand_signals table
    5. Flag brands with acceleration > 1.5 as potential catalysts

Rate-limiting: Google Trends returns 429 if you hit it too fast.
We add 2s delay between batches and retry with exponential backoff.

Usage:
    py backend/scripts/collect_google_trends.py
    py backend/scripts/collect_google_trends.py --brands tesla,nvidia,lululemon
    py backend/scripts/collect_google_trends.py --dry-run --verbose
    py backend/scripts/collect_google_trends.py --top-n 50
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 6

TRENDS_WIDGET_URL = "https://trends.google.com/trends/api/explore"
TRENDS_MULTILINE_URL = "https://trends.google.com/trends/api/widgetdata/multiline"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

BATCH_SIZE = 5
RATE_LIMIT_DELAY = 2.5
MAX_RETRIES = 3
LOOKBACK_DAYS = 90


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
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cbs_brand_date
        ON consumer_brand_signals (brand_key, signal_date DESC)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cbs_source_date
        ON consumer_brand_signals (source_type, signal_date DESC)
    """)


def _build_opener() -> urllib.request.OpenerDirector:
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [("User-Agent", USER_AGENT)]
    return opener


def _fetch_trends_token(opener: urllib.request.OpenerDirector, keywords: List[str]) -> Optional[Dict]:
    """Get widget tokens from Google Trends explore endpoint."""
    req_data = {
        "comparisonItem": [
            {"keyword": kw, "geo": "US", "time": f"today {LOOKBACK_DAYS}-d"}
            for kw in keywords
        ],
        "category": 0,
        "property": "",
    }
    params = urllib.parse.urlencode({
        "hl": "en-US",
        "tz": "420",
        "req": json.dumps(req_data),
    })
    url = f"{TRENDS_WIDGET_URL}?{params}"

    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url)
            with opener.open(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                if raw.startswith(")]}'"):
                    raw = raw[5:]
                data = json.loads(raw)
                widgets = data.get("widgets", [])
                for w in widgets:
                    if w.get("id") == "TIMESERIES":
                        return w
                return None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = (2 ** attempt) * 5
                time.sleep(wait)
                continue
            return None
        except Exception:
            return None
    return None


def _fetch_trends_data(
    opener: urllib.request.OpenerDirector,
    widget: Dict,
) -> Optional[List[Dict]]:
    """Fetch actual interest-over-time data using widget token."""
    token = widget.get("token", "")
    req_obj = widget.get("request", {})

    params = urllib.parse.urlencode({
        "hl": "en-US",
        "tz": "420",
        "req": json.dumps(req_obj),
        "token": token,
    })
    url = f"{TRENDS_MULTILINE_URL}?{params}"

    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url)
            with opener.open(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                if raw.startswith(")]}'"):
                    raw = raw[5:]
                data = json.loads(raw)
                timeline = data.get("default", {}).get("timelineData", [])
                return timeline
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = (2 ** attempt) * 5
                time.sleep(wait)
                continue
            return None
        except Exception:
            return None
    return None


def _compute_acceleration(values: List[float]) -> float:
    """Compute 7d/30d moving average ratio as acceleration metric."""
    if len(values) < 30:
        return 1.0
    recent_7d = sum(values[-7:]) / 7.0
    past_30d = sum(values[-30:]) / 30.0
    if past_30d <= 0:
        return 1.0
    return round(recent_7d / past_30d, 3)


def _brand_to_search_term(brand_key: str) -> str:
    """Convert snake_case brand_key to a Google-friendly search term."""
    return brand_key.replace("_", " ").title()


def run(
    db_path: str = str(DEFAULT_DB_PATH),
    *,
    dry_run: bool = False,
    verbose: bool = False,
    brands: Optional[List[str]] = None,
    top_n: int = 100,
) -> Dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[google-trends] schema_version mismatch")

    _ensure_signals_table(conn)

    if brands:
        brand_rows = []
        for b in brands:
            row = conn.execute(
                "SELECT brand_key, parent_ticker FROM brand_to_ticker WHERE brand_key = ?",
                (b,),
            ).fetchone()
            if row:
                brand_rows.append(dict(row))
            else:
                brand_rows.append({"brand_key": b, "parent_ticker": None})
    else:
        brand_rows = [
            dict(r) for r in conn.execute(
                "SELECT brand_key, parent_ticker FROM brand_to_ticker "
                "WHERE parent_ticker IS NOT NULL "
                "ORDER BY RANDOM() LIMIT ?",
                (top_n,),
            ).fetchall()
        ]

    if verbose:
        print(f"[google-trends] {len(brand_rows)} brands to query")

    opener = _build_opener()
    now = int(time.time())
    today = time.strftime("%Y-%m-%d")

    fetched = 0
    stored = 0
    accelerating = 0
    errors = 0

    batches = [brand_rows[i:i + BATCH_SIZE] for i in range(0, len(brand_rows), BATCH_SIZE)]

    for batch_idx, batch in enumerate(batches):
        keywords = [_brand_to_search_term(b["brand_key"]) for b in batch]
        if verbose:
            print(f"  batch {batch_idx + 1}/{len(batches)}: {keywords}")

        if dry_run:
            fetched += len(batch)
            continue

        widget = _fetch_trends_token(opener, keywords)
        if not widget:
            errors += len(batch)
            if verbose:
                print(f"    WARN: no widget token for batch")
            time.sleep(RATE_LIMIT_DELAY)
            continue

        timeline = _fetch_trends_data(opener, widget)
        if not timeline:
            errors += len(batch)
            if verbose:
                print(f"    WARN: no timeline data")
            time.sleep(RATE_LIMIT_DELAY)
            continue

        fetched += len(batch)

        for kw_idx, brand_info in enumerate(batch):
            brand_key = brand_info["brand_key"]
            ticker = brand_info.get("parent_ticker")

            values = []
            latest_date = today
            for point in timeline:
                val = 0
                if "value" in point and len(point["value"]) > kw_idx:
                    val = point["value"][kw_idx]
                values.append(val)
                if "formattedTime" in point:
                    latest_date = point.get("formattedAxisTime", today)

            if not values:
                continue

            accel = _compute_acceleration(values)
            latest_val = values[-1] if values else 0
            baseline_val = sum(values[-30:]) / max(len(values[-30:]), 1) if len(values) >= 30 else sum(values) / max(len(values), 1)

            if accel > 1.5:
                accelerating += 1
                if verbose:
                    print(f"    ACCEL: {brand_key} ({ticker}) accel={accel:.2f} latest={latest_val}")

            conn.execute(
                """
                INSERT OR REPLACE INTO consumer_brand_signals (
                    brand_key, parent_ticker, source_type, signal_date,
                    signal_value, baseline_value, acceleration,
                    raw_payload_json, fetched_at
                ) VALUES (?, ?, 'google_trends', ?, ?, ?, ?, ?, ?)
                """,
                (
                    brand_key, ticker, today,
                    latest_val, round(baseline_val, 2), accel,
                    json.dumps({"values": values[-14:], "keyword": _brand_to_search_term(brand_key)}),
                    now,
                ),
            )
            stored += 1

        time.sleep(RATE_LIMIT_DELAY)

    if not dry_run:
        conn.commit()

    conn.close()

    summary = {
        "brands_queried": fetched,
        "signals_stored": stored,
        "accelerating_brands": accelerating,
        "errors": errors,
        "dry_run": dry_run,
    }
    print(f"[google-trends] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Google Trends collector (Phase 6)")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--brands", type=str, default=None,
                        help="Comma-separated brand_keys to query")
    parser.add_argument("--top-n", type=int, default=100,
                        help="Max brands to query (random sample from DB)")
    args = parser.parse_args()

    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        brands=args.brands.split(",") if args.brands else None,
        top_n=args.top_n,
    )
