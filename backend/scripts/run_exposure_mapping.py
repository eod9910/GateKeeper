#!/usr/bin/env python
"""Exposure mapping populator (PRD D2, Phase 2).

For each scenario that has a `primary_theme` matching the theme taxonomy,
inserts first-order and second-order `situation_exposure` rows with
`source_method = 'hand_curated'`. Resolves sector ticker seeds against
`universe_clean.json` to populate `universe_symbol`.

For scenarios whose theme is NOT in the taxonomy (long-tail), marks them
for future LLM-assist mapping (Phase 2 Tier 2).

Usage:
    py backend/scripts/run_exposure_mapping.py
    py backend/scripts/run_exposure_mapping.py --dry-run --verbose
    py backend/scripts/run_exposure_mapping.py --situation-id 175
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Any, Dict, List, Optional, Set

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
THEME_TAXONOMY_PATH = os.path.join(BACKEND_DIR, "data", "scenarios", "theme-taxonomy.json")
UNIVERSE_CLEAN_PATH = os.path.join(BACKEND_DIR, "data", "universe_clean.json")

EXPECTED_SCHEMA_VERSION = 6

DIRECTION_MAP = {
    "up": "long_beneficiary",
    "down": "short_loser",
    "mixed": "direction_uncertain",
}

MAGNITUDE_CONFIDENCE = {
    "large": 0.85,
    "moderate": 0.65,
    "small": 0.45,
}


def load_taxonomy() -> Dict[str, Dict]:
    """Load theme taxonomy keyed by theme_key."""
    with open(THEME_TAXONOMY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    themes = data.get("themes", [])
    return {t["theme_key"]: t for t in themes}


def load_universe_symbols() -> Set[str]:
    """Load the set of valid universe symbols from universe_clean.json."""
    if not os.path.exists(UNIVERSE_CLEAN_PATH):
        return set()
    with open(UNIVERSE_CLEAN_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "stocks" in data:
        return {s["symbol"] for s in data["stocks"] if isinstance(s, dict) and "symbol" in s}
    if isinstance(data, list):
        return {
            (item["symbol"] if isinstance(item, dict) else str(item))
            for item in data
        }
    return set()


def populate_exposure_for_scenario(
    conn: sqlite3.Connection,
    situation_id: int,
    theme_entry: Dict,
    universe_symbols: Set[str],
    *,
    verbose: bool = False,
) -> int:
    """Insert exposure rows from taxonomy. Returns count inserted."""
    existing = conn.execute(
        "SELECT COUNT(*) FROM situation_exposure WHERE situation_id = ?",
        (situation_id,),
    ).fetchone()[0]
    if existing > 0:
        if verbose:
            print(f"    Skipping id={situation_id}: already has {existing} exposure rows")
        return 0

    inserted = 0
    ticker_seeds = theme_entry.get("ticker_seeds", {})

    for order_label, effects in [("first", theme_entry.get("first_order", [])),
                                  ("second", theme_entry.get("second_order", []))]:
        for effect in effects:
            asset_type = effect.get("asset_type", "sector")
            asset_key = effect.get("asset_key", "")
            direction_raw = effect.get("direction", "up")
            magnitude = effect.get("magnitude", "moderate")

            exposure_direction = DIRECTION_MAP.get(direction_raw, "direction_uncertain")
            confidence = MAGNITUDE_CONFIDENCE.get(magnitude, 0.5)
            exposure_strength = confidence

            tickers_for_sector = ticker_seeds.get(asset_key, [])

            if asset_type in ("equity",) and asset_key in universe_symbols:
                conn.execute(
                    """
                    INSERT INTO situation_exposure (
                        situation_id, asset_type, asset_key, exposure_direction,
                        exposure_order, exposure_strength, source_method,
                        rationale, confidence, universe_symbol
                    ) VALUES (?, ?, ?, ?, ?, ?, 'hand_curated', ?, ?, ?)
                    """,
                    (situation_id, asset_type, asset_key, exposure_direction,
                     order_label, exposure_strength, f"taxonomy:{theme_entry['theme_key']}",
                     confidence, asset_key),
                )
                inserted += 1
            elif asset_type in ("commodity", "fx", "rate", "etf"):
                conn.execute(
                    """
                    INSERT INTO situation_exposure (
                        situation_id, asset_type, asset_key, exposure_direction,
                        exposure_order, exposure_strength, source_method,
                        rationale, confidence
                    ) VALUES (?, ?, ?, ?, ?, ?, 'hand_curated', ?, ?)
                    """,
                    (situation_id, asset_type, asset_key, exposure_direction,
                     order_label, exposure_strength, f"taxonomy:{theme_entry['theme_key']}",
                     confidence),
                )
                inserted += 1
            else:
                conn.execute(
                    """
                    INSERT INTO situation_exposure (
                        situation_id, asset_type, asset_key, exposure_direction,
                        exposure_order, exposure_strength, source_method,
                        rationale, confidence
                    ) VALUES (?, 'sector', ?, ?, ?, ?, 'hand_curated', ?, ?)
                    """,
                    (situation_id, asset_key, exposure_direction,
                     order_label, exposure_strength, f"taxonomy:{theme_entry['theme_key']}",
                     confidence),
                )
                inserted += 1

            for ticker in tickers_for_sector:
                if ticker in universe_symbols:
                    conn.execute(
                        """
                        INSERT INTO situation_exposure (
                            situation_id, asset_type, asset_key, exposure_direction,
                            exposure_order, exposure_strength, source_method,
                            rationale, confidence, universe_symbol
                        ) VALUES (?, 'equity', ?, ?, ?, ?, 'hand_curated', ?, ?, ?)
                        """,
                        (situation_id, ticker, exposure_direction,
                         order_label, exposure_strength * 0.9,
                         f"taxonomy:{theme_entry['theme_key']}:{asset_key}",
                         confidence * 0.9, ticker),
                    )
                    inserted += 1

    # Update first/second order effects JSON on the scenario
    first_order = [
        {"asset_or_sector": e["asset_key"], "direction": e["direction"],
         "magnitude_hint": e.get("magnitude", "moderate"), "source_method": "hand_curated"}
        for e in theme_entry.get("first_order", [])
    ]
    second_order = [
        {"asset_or_sector": e["asset_key"], "direction": e["direction"],
         "magnitude_hint": e.get("magnitude", "moderate"), "source_method": "hand_curated"}
        for e in theme_entry.get("second_order", [])
    ]
    conn.execute(
        """
        UPDATE market_situations SET
            first_order_effects_json = ?,
            second_order_effects_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (json.dumps(first_order), json.dumps(second_order), int(time.time()), situation_id),
    )

    return inserted


def run(
    db_path: str,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    situation_id: Optional[int] = None,
    max_scenarios: int = 500,
) -> dict:
    taxonomy = load_taxonomy()
    universe = load_universe_symbols()

    if verbose:
        print(f"[exposure-mapping] {len(taxonomy)} themes in taxonomy, "
              f"{len(universe)} universe symbols loaded")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(actual["value"]) if actual else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[exposure-mapping] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )

    where = "1=1"
    params: list = []
    if situation_id is not None:
        where += " AND id = ?"
        params.append(situation_id)

    scenarios = conn.execute(
        f"""
        SELECT id, title, primary_theme, detection_path
        FROM market_situations
        WHERE {where}
          AND status NOT IN ('ARCHIVED', 'INVALIDATED')
        ORDER BY evidence_count DESC, id DESC
        LIMIT ?
        """,
        params + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[exposure-mapping] {len(scenarios)} scenarios to process")

    mapped = 0
    skipped_no_theme = 0
    skipped_not_in_taxonomy = 0
    total_rows = 0

    for row in scenarios:
        sid = int(row["id"])
        theme = row["primary_theme"]

        if not theme:
            skipped_no_theme += 1
            continue

        if theme not in taxonomy:
            skipped_not_in_taxonomy += 1
            if verbose:
                print(f"  id={sid} theme={theme} — NOT in taxonomy (needs LLM-assist)")
            continue

        theme_entry = taxonomy[theme]
        if dry_run:
            fo = len(theme_entry.get("first_order", []))
            so = len(theme_entry.get("second_order", []))
            seeds = sum(len(v) for v in theme_entry.get("ticker_seeds", {}).values())
            title = (row["title"] or "")[:45]
            print(f"  id={sid} theme={theme} → {fo}fo + {so}so + {seeds} tickers | {title}")
            mapped += 1
            continue

        count = populate_exposure_for_scenario(
            conn, sid, theme_entry, universe, verbose=verbose
        )
        if count > 0:
            mapped += 1
            total_rows += count
            if verbose:
                title = (row["title"] or "")[:45]
                print(f"  id={sid} theme={theme} → {count} rows | {title}")

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "mapped": mapped,
        "total_exposure_rows": total_rows,
        "skipped_no_theme": skipped_no_theme,
        "skipped_not_in_taxonomy": skipped_not_in_taxonomy,
        "dry_run": dry_run,
    }
    print(f"[exposure-mapping] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Exposure mapping populator (D2)")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--max-scenarios", type=int, default=500)
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        situation_id=args.situation_id,
        max_scenarios=args.max_scenarios,
    )
