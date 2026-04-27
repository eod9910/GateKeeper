#!/usr/bin/env python3
"""Seed registry tables in market-intelligence.sqlite from JSON config files.

Loads:
  - backend/data/scenarios/theme-taxonomy.json -> theme_registry
  - backend/data/scenarios/brand-to-ticker.json -> brand_to_ticker

Idempotent: uses INSERT OR REPLACE so re-runs are safe and pick up edits to
the JSON files. Schema-creation lives in build_market_intelligence_db.py;
this script assumes the tables already exist.

Brand rows whose parent_ticker is null (private companies tracked as
buzz-only signals) are skipped because brand_to_ticker.parent_ticker is
NOT NULL. They are reported in the output so the operator can review.

Usage:
    py backend/scripts/seed_market_intelligence_registry.py
    py backend/scripts/seed_market_intelligence_registry.py --dry-run
    py backend/scripts/seed_market_intelligence_registry.py --db-path /tmp/test.sqlite
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
THEME_TAXONOMY_PATH = ROOT / "backend" / "data" / "scenarios" / "theme-taxonomy.json"
BRAND_TO_TICKER_PATH = ROOT / "backend" / "data" / "scenarios" / "brand-to-ticker.json"

EXPECTED_SCHEMA_VERSION = 1


def _connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(
            f"Database not found at {db_path}. Run build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _check_schema_version(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(
            "schema_meta.schema_version is missing. "
            "Run build_market_intelligence_db.py to migrate first."
        )
    version = int(row[0])
    if version != EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"Schema version mismatch: DB has {version}, "
            f"this script expects {EXPECTED_SCHEMA_VERSION}."
        )
    return version


def _seed_theme_registry(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    *,
    dry_run: bool,
) -> Dict[str, Any]:
    themes = payload.get("themes") or []
    if not isinstance(themes, list):
        raise ValueError("theme-taxonomy.json: 'themes' must be a list")

    now = int(time.time())
    inserted = 0
    skipped: List[Dict[str, Any]] = []

    for theme in themes:
        theme_key = theme.get("theme_key")
        display_name = theme.get("display_name")
        category = theme.get("category")
        taxonomy_version = int(theme.get("taxonomy_version") or 1)

        if not theme_key or not display_name or not category:
            skipped.append({"theme": theme, "reason": "missing required field"})
            continue

        if dry_run:
            inserted += 1
            continue

        conn.execute(
            """
            INSERT OR REPLACE INTO theme_registry
                (theme_key, display_name, category, taxonomy_version, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (theme_key, display_name, category, taxonomy_version, now),
        )
        inserted += 1

    return {
        "input_rows": len(themes),
        "inserted": inserted,
        "skipped": skipped,
    }


def _seed_brand_to_ticker(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    *,
    dry_run: bool,
) -> Dict[str, Any]:
    brands = payload.get("brands") or []
    if not isinstance(brands, list):
        raise ValueError("brand-to-ticker.json: 'brands' must be a list")

    now = int(time.time())
    inserted = 0
    skipped_private: List[str] = []
    skipped_invalid: List[Dict[str, Any]] = []

    for brand in brands:
        brand_key = brand.get("brand_key")
        parent_ticker = brand.get("parent_ticker")
        secondary = brand.get("secondary_tickers") or []
        confidence = brand.get("confidence")
        source_method = brand.get("source_method")

        if not brand_key:
            skipped_invalid.append({"brand": brand, "reason": "missing brand_key"})
            continue

        if parent_ticker is None or parent_ticker == "":
            # Private company — schema requires NOT NULL parent_ticker.
            # Skip and report; these are tracked as buzz-only signals.
            skipped_private.append(brand_key)
            continue

        if confidence is None or source_method is None:
            skipped_invalid.append(
                {"brand": brand, "reason": "missing confidence or source_method"}
            )
            continue

        if source_method not in ("hand_curated", "llm_assist", "operator_override"):
            skipped_invalid.append(
                {"brand": brand, "reason": f"invalid source_method: {source_method}"}
            )
            continue

        if dry_run:
            inserted += 1
            continue

        conn.execute(
            """
            INSERT OR REPLACE INTO brand_to_ticker
                (brand_key, parent_ticker, secondary_tickers_json, confidence, source_method, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                brand_key,
                parent_ticker,
                json.dumps(secondary, ensure_ascii=False),
                float(confidence),
                source_method,
                now,
            ),
        )
        inserted += 1

    return {
        "input_rows": len(brands),
        "inserted": inserted,
        "skipped_private_count": len(skipped_private),
        "skipped_private": skipped_private,
        "skipped_invalid": skipped_invalid,
    }


def seed(db_path: Path, *, dry_run: bool) -> Dict[str, Any]:
    if not THEME_TAXONOMY_PATH.exists():
        raise SystemExit(f"theme-taxonomy.json not found at {THEME_TAXONOMY_PATH}")
    if not BRAND_TO_TICKER_PATH.exists():
        raise SystemExit(f"brand-to-ticker.json not found at {BRAND_TO_TICKER_PATH}")

    theme_payload = json.loads(THEME_TAXONOMY_PATH.read_text(encoding="utf-8"))
    brand_payload = json.loads(BRAND_TO_TICKER_PATH.read_text(encoding="utf-8"))

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)

        theme_result = _seed_theme_registry(conn, theme_payload, dry_run=dry_run)
        brand_result = _seed_brand_to_ticker(conn, brand_payload, dry_run=dry_run)

        if not dry_run:
            conn.commit()

        theme_count = conn.execute("SELECT COUNT(*) FROM theme_registry").fetchone()[0]
        brand_count = conn.execute("SELECT COUNT(*) FROM brand_to_ticker").fetchone()[0]
    finally:
        conn.close()

    return {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "theme_registry": theme_result,
        "brand_to_ticker": brand_result,
        "table_counts_after": {
            "theme_registry": theme_count,
            "brand_to_ticker": brand_count,
        },
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Seed market-intelligence registry tables")
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate inputs and report counts without writing to the DB",
    )
    args = parser.parse_args(argv)

    result = seed(args.db_path, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
