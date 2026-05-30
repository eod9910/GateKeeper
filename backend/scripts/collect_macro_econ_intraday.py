#!/usr/bin/env python3
"""Macro Engine — EIA + BLS economic data collector.

Phase 1.5 third collector script. Pulls structured time-series data
from the U.S. Energy Information Administration (EIA) and Bureau of
Labor Statistics (BLS) public JSON APIs and lands them as mi_raw_hits
rows with synthesised title + body_text for the embedding pipeline.

Why synthesise body text?
    The downstream embedding + clustering pipeline operates on
    (title + body_text) to group macro hits into situations. A raw
    numerical data point ("$91.06/bbl") carries zero semantic signal
    by itself, but a synthesised sentence like "WTI Crude Oil spot
    price: $91.06/bbl on 2026-04-20 (+6.0% week-over-week)" gives
    the embedding model enough context to cluster it with other
    energy-related hits from Yahoo Finance, Reuters, and the Fed.

source_type values:
    "econ_eia"   — EIA data releases (petroleum, natural gas)
    "econ_bls"   — BLS data releases (CPI, employment)

source_community:
    "macro:eia"  — all EIA series
    "macro:bls"  — all BLS series

source_post_id: "<source_key>:<series_id>:<period>" — globally unique
    per data release.

API details:
    EIA v2: https://api.eia.gov/v2/ — public, DEMO_KEY works for
        low-volume polling (30 req/hr). Operator can set EIA_API_KEY
        env var for higher limits.
    BLS v2: https://api.bls.gov/publicAPI/v2/ — public, no key
        needed for 1-series unauthenticated requests (25 req/day).
        Operator can set BLS_API_KEY for 500 req/day.

Series registry:
    EIA:
        RWTC   — WTI Crude Oil Spot Price (daily)
        RNGWHHD — Henry Hub Natural Gas Spot Price (daily)
    BLS:
        CUUR0000SA0  — CPI-U All Items (monthly)
        CES0000000001 — Total Nonfarm Employment (monthly)

Cadence:
    EIA data updates daily (weekdays). BLS monthly (8:30 AM ET on
    release day). A 6-hour cron tick is plenty for both — the
    collector is idempotent and deduplicates on (series_id, period).

Zero external deps — uses stdlib urllib.request + json.

Usage:
    py backend/scripts/collect_macro_econ_intraday.py
    py backend/scripts/collect_macro_econ_intraday.py --sources eia
    py backend/scripts/collect_macro_econ_intraday.py --sources bls
    py backend/scripts/collect_macro_econ_intraday.py --dry-run
    py backend/scripts/collect_macro_econ_intraday.py --list-series
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

USER_AGENT = (
    "pattern-detector-mi/0.2 (Macro EIA/BLS collector; "
    "+https://github.com/pattern-detector)"
)


# ============================================================================
# Series registry
# ============================================================================

EIA_SERIES: List[Dict[str, str]] = [
    {
        "series_id": "RWTC",
        "label": "WTI Crude Oil Spot Price",
        "api_path": "petroleum/pri/spt",
        "units_label": "$/bbl",
    },
    {
        "series_id": "RNGWHHD",
        "label": "Henry Hub Natural Gas Spot Price",
        "api_path": "natural-gas/pri/fut",
        "units_label": "$/MMBtu",
    },
]

BLS_SERIES: List[Dict[str, str]] = [
    {
        "series_id": "CUUR0000SA0",
        "label": "CPI-U All Items (seasonally unadjusted)",
        "units_label": "index",
    },
    {
        "series_id": "CES0000000001",
        "label": "Total Nonfarm Employment",
        "units_label": "thousands",
    },
]

ALL_SOURCE_KEYS = ["eia", "bls"]


# ============================================================================
# DB helpers
# ============================================================================


def _connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(
            f"Database not found at {db_path}. "
            "Run build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _check_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    if row is None:
        raise SystemExit(
            "schema_meta.schema_version is missing. "
            "Run build_market_intelligence_db.py first."
        )
    version = int(row[0])
    if version < EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"Schema too old: DB has {version}, "
            f"this collector expects >= {EXPECTED_SCHEMA_VERSION}."
        )
    return version


# ============================================================================
# EIA fetcher
# ============================================================================


def _fetch_eia_series(
    series: Dict[str, str],
    *,
    api_key: str,
    lookback: int,
    timeout: float,
) -> List[Dict[str, Any]]:
    url = (
        f"https://api.eia.gov/v2/{series['api_path']}/data/"
        f"?api_key={api_key}"
        f"&frequency=daily"
        f"&data[0]=value"
        f"&facets[series][]={series['series_id']}"
        f"&sort[0][column]=period&sort[0][direction]=desc"
        f"&length={lookback}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())

    rows: List[Dict[str, Any]] = []
    for item in data.get("response", {}).get("data", []):
        period = item.get("period")
        value = item.get("value")
        if period is None or value is None:
            continue
        try:
            val_float = float(value)
        except (TypeError, ValueError):
            continue

        desc_raw = item.get("series-description") or series["label"]
        units = item.get("units") or series["units_label"]

        title = f"{series['label']}: {val_float} {units} ({period})"
        body = (
            f"{desc_raw}. "
            f"Value: {val_float} {units} for period {period}. "
            f"Product: {item.get('product-name', 'N/A')}. "
            f"Source: U.S. Energy Information Administration (EIA)."
        )

        rows.append({
            "source_type": "econ_eia",
            "source_post_id": f"eia:{series['series_id']}:{period}",
            "source_thread_id": None,
            "source_url": f"https://www.eia.gov/petroleum/",
            "source_community": "macro:eia",
            "author": None,
            "title": title,
            "body_text": body,
            "posted_at": _period_to_unix(period),
            "score": None,
            "comment_count": None,
            "raw_payload_json": json.dumps(
                {
                    "source": "eia",
                    "series_id": series["series_id"],
                    "period": period,
                    "value": val_float,
                    "units": units,
                    "description": desc_raw,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        })

    return rows


# ============================================================================
# BLS fetcher
# ============================================================================


def _fetch_bls_series(
    series: Dict[str, str],
    *,
    api_key: Optional[str],
    timeout: float,
) -> List[Dict[str, Any]]:
    url = f"https://api.bls.gov/publicAPI/v2/timeseries/data/{series['series_id']}"
    if api_key:
        url += f"?registrationkey={api_key}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())

    if data.get("status") != "REQUEST_SUCCEEDED":
        raise ValueError(f"BLS API error: {data.get('message', data.get('status'))}")

    rows: List[Dict[str, Any]] = []
    for s in data.get("Results", {}).get("series", []):
        sid = s.get("seriesID", series["series_id"])
        for item in s.get("data", []):
            year = item.get("year")
            period = item.get("period", "")
            period_name = item.get("periodName", "")
            value = item.get("value")
            if not year or not period or value is None:
                continue
            try:
                val_float = float(value)
            except (TypeError, ValueError):
                continue

            period_key = f"{year}-{period}"
            is_preliminary = any(
                fn.get("code") == "P" for fn in (item.get("footnotes") or []) if isinstance(fn, dict)
            )

            title = f"{series['label']}: {val_float:,.1f} {series['units_label']} ({period_name} {year})"
            body = (
                f"Bureau of Labor Statistics series {sid}. "
                f"{series['label']}: {val_float:,.1f} {series['units_label']} "
                f"for {period_name} {year}"
                f"{' (preliminary)' if is_preliminary else ''}. "
                f"Source: U.S. Bureau of Labor Statistics."
            )

            posted_at = _period_to_unix_bls(year, period)

            rows.append({
                "source_type": "econ_bls",
                "source_post_id": f"bls:{sid}:{period_key}",
                "source_thread_id": None,
                "source_url": f"https://www.bls.gov/",
                "source_community": "macro:bls",
                "author": None,
                "title": title,
                "body_text": body,
                "posted_at": posted_at,
                "score": None,
                "comment_count": None,
                "raw_payload_json": json.dumps(
                    {
                        "source": "bls",
                        "series_id": sid,
                        "year": year,
                        "period": period,
                        "period_name": period_name,
                        "value": val_float,
                        "units": series["units_label"],
                        "preliminary": is_preliminary,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            })

    return rows


# ============================================================================
# Helpers
# ============================================================================


def _period_to_unix(period: str) -> int:
    """Convert 'YYYY-MM-DD' to unix timestamp (midnight UTC)."""
    import datetime as _dt
    try:
        d = _dt.datetime.strptime(period, "%Y-%m-%d")
        d = d.replace(tzinfo=_dt.timezone.utc)
        return int(d.timestamp())
    except ValueError:
        return int(time.time())


def _period_to_unix_bls(year: str, period: str) -> int:
    """Convert BLS year + period (M01-M13) to unix timestamp."""
    import datetime as _dt
    try:
        month = int(period.replace("M", ""))
        if month < 1 or month > 12:
            month = 1
        d = _dt.datetime(int(year), month, 1, tzinfo=_dt.timezone.utc)
        return int(d.timestamp())
    except (ValueError, TypeError):
        return int(time.time())


# ============================================================================
# Persistence
# ============================================================================


def _upsert_hits(
    conn: sqlite3.Connection,
    rows: List[Dict[str, Any]],
    *,
    fetched_at: int,
    dry_run: bool,
) -> Dict[str, int]:
    inserted = 0
    unchanged = 0

    for row in rows:
        existing = conn.execute(
            """
            SELECT id FROM mi_raw_hits
            WHERE source_type = ? AND source_post_id = ?
            """,
            (row["source_type"], row["source_post_id"]),
        ).fetchone()

        if existing is not None:
            unchanged += 1
            continue

        if not dry_run:
            conn.execute(
                """
                INSERT INTO mi_raw_hits (
                    source_type, source_post_id, source_thread_id,
                    source_url, source_community, author, title,
                    body_text, posted_at, fetched_at, score,
                    comment_count, matched_concept_ids_json,
                    raw_payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["source_type"],
                    row["source_post_id"],
                    row["source_thread_id"],
                    row["source_url"],
                    row["source_community"],
                    row["author"],
                    row["title"],
                    row["body_text"],
                    row["posted_at"],
                    fetched_at,
                    row["score"],
                    row["comment_count"],
                    "[]",
                    row["raw_payload_json"],
                ),
            )
        inserted += 1

    return {"inserted": inserted, "merged": 0, "unchanged": unchanged}


# ============================================================================
# Orchestration
# ============================================================================


def collect(
    *,
    db_path: Path,
    only_sources: Optional[Set[str]],
    eia_lookback: int,
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())

    do_eia = only_sources is None or "eia" in only_sources
    do_bls = only_sources is None or "bls" in only_sources

    eia_api_key = os.environ.get("EIA_API_KEY", "DEMO_KEY")
    bls_api_key = os.environ.get("BLS_API_KEY")

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)

        all_rows: List[Dict[str, Any]] = []
        per_series_report: List[Dict[str, Any]] = []

        if do_eia:
            for series in EIA_SERIES:
                series_error: Optional[str] = None
                fetched: List[Dict[str, Any]] = []
                try:
                    fetched = _fetch_eia_series(
                        series,
                        api_key=eia_api_key,
                        lookback=eia_lookback,
                        timeout=request_timeout,
                    )
                except urllib.error.HTTPError as err:
                    series_error = f"HTTP {err.code}: {err.reason}"
                except urllib.error.URLError as err:
                    series_error = f"URLError: {err}"
                except Exception as err:
                    series_error = f"unexpected: {err.__class__.__name__}: {err}"

                if series_error:
                    print(
                        f"[macro_econ] WARN: EIA {series['series_id']} failed: {series_error}",
                        file=sys.stderr,
                    )

                all_rows.extend(fetched)
                per_series_report.append({
                    "source": "eia",
                    "series_id": series["series_id"],
                    "label": series["label"],
                    "fetched": len(fetched),
                    "error": series_error,
                })

                if sleep_ms > 0:
                    time.sleep(sleep_ms / 1000.0)

        if do_bls:
            for series in BLS_SERIES:
                series_error = None
                fetched = []
                try:
                    fetched = _fetch_bls_series(
                        series,
                        api_key=bls_api_key,
                        timeout=request_timeout,
                    )
                except urllib.error.HTTPError as err:
                    series_error = f"HTTP {err.code}: {err.reason}"
                except urllib.error.URLError as err:
                    series_error = f"URLError: {err}"
                except Exception as err:
                    series_error = f"unexpected: {err.__class__.__name__}: {err}"

                if series_error:
                    print(
                        f"[macro_econ] WARN: BLS {series['series_id']} failed: {series_error}",
                        file=sys.stderr,
                    )

                all_rows.extend(fetched)
                per_series_report.append({
                    "source": "bls",
                    "series_id": series["series_id"],
                    "label": series["label"],
                    "fetched": len(fetched),
                    "error": series_error,
                })

                if sleep_ms > 0:
                    time.sleep(sleep_ms / 1000.0)

        upsert_report = _upsert_hits(
            conn, all_rows, fetched_at=fetched_at, dry_run=dry_run
        )

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    series_attempted = len(per_series_report)
    series_succeeded = sum(1 for r in per_series_report if r.get("error") is None)

    return {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "fetched_at": fetched_at,
        "eia_api_key_source": "env" if os.environ.get("EIA_API_KEY") else "DEMO_KEY",
        "bls_api_key_source": "env" if bls_api_key else "unauthenticated",
        "series_attempted": series_attempted,
        "series_succeeded": series_succeeded,
        "total_data_points": len(all_rows),
        "mi_raw_hits": upsert_report,
        "per_series": per_series_report,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Macro Engine EIA + BLS economic data collector "
            "(JSON APIs, synthesised text for embedding pipeline)."
        )
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--sources",
        type=str,
        default="",
        help="Comma-separated source keys: eia, bls (default: all).",
    )
    parser.add_argument(
        "--eia-lookback",
        type=int,
        default=10,
        help="Number of most-recent EIA data points to fetch per series (default 10).",
    )
    parser.add_argument("--request-timeout", type=float, default=15.0)
    parser.add_argument("--sleep-ms", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list-series",
        action="store_true",
        help="Print the series registry and exit.",
    )
    args = parser.parse_args()

    if args.list_series:
        print(json.dumps({"eia": EIA_SERIES, "bls": BLS_SERIES}, indent=2))
        return 0

    only_sources: Optional[Set[str]] = None
    if args.sources.strip():
        only_sources = {k.strip() for k in args.sources.split(",") if k.strip()}
        unknown = only_sources - set(ALL_SOURCE_KEYS)
        if unknown:
            print(
                f"Unknown source keys: {sorted(unknown)}. Known: {ALL_SOURCE_KEYS}",
                file=sys.stderr,
            )
            return 2

    report = collect(
        db_path=args.db_path,
        only_sources=only_sources,
        eia_lookback=args.eia_lookback,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
