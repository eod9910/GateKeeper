#!/usr/bin/env python
"""Consumer Cycle adapter for the Macro Engine (PRD D12).

Polls the Consumer Cycle Monitor API endpoint, detects state-change
events (e.g., autos status yellow → red), and injects them as
situation_signals + situation_evidence into matching Macro scenarios.

Consumer Cycle output feeds the event_score and affected_sectors for
consumer_cycle and sector_rotation themes. State changes are significant
macro signals — when autos go red, that's an early-warning for the
entire consumer-cyclical complex.

Usage:
    py backend/scripts/run_consumer_cycle_adapter.py
    py backend/scripts/run_consumer_cycle_adapter.py --dry-run --verbose
    py backend/scripts/run_consumer_cycle_adapter.py --force-refresh
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
DEFAULT_BASE_URL = "http://localhost:3002"

EXPECTED_SCHEMA_VERSION = 6
SCENARIO_SCHEMA_VERSION = 1

SEVERITY_LABELS = {0: "green", 1: "yellow", 2: "orange", 3: "red"}

SERIES_THEME_MAP: Dict[str, str] = {
    "autos": "consumer_cycle",
    "furnishings": "consumer_cycle",
    "recreation": "consumer_cycle",
    "transport_services": "consumer_cycle",
    "housing": "rates_higher",
    "equipment": "ai_capex_acceleration",
}

SERIES_SECTOR_MAP: Dict[str, List[str]] = {
    "autos": ["Consumer Discretionary", "Industrials"],
    "furnishings": ["Consumer Discretionary"],
    "recreation": ["Consumer Discretionary", "Communication Services"],
    "transport_services": ["Industrials", "Consumer Discretionary"],
    "housing": ["Real Estate", "Financials"],
    "equipment": ["Industrials", "Information Technology"],
}


def fetch_monitor(base_url: str, force_refresh: bool = False) -> Dict[str, Any]:
    url = f"{base_url}/api/consumer-cycle/monitor"
    if force_refresh:
        url += "?refresh=true"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("success"):
        raise RuntimeError(f"Monitor API error: {data}")
    return data["data"]


def load_previous_state(conn: sqlite3.Connection) -> Dict[str, str]:
    """Load the last known consumer cycle state from schema_meta."""
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='consumer_cycle_state'"
    ).fetchone()
    if row and row["value"]:
        try:
            return json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            pass
    return {}


def save_current_state(conn: sqlite3.Connection, state: Dict[str, str]) -> None:
    conn.execute(
        """
        INSERT INTO schema_meta (key, value, updated_at)
        VALUES ('consumer_cycle_state', ?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (json.dumps(state), int(time.time())),
    )


def detect_changes(
    previous: Dict[str, str],
    current_series: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Compare previous and current status for each series. Return transitions."""
    changes = []
    for series in current_series:
        key = series["key"]
        new_status = series["status"]
        old_status = previous.get(key)

        if old_status is None:
            continue
        if old_status != new_status:
            changes.append({
                "key": key,
                "label": series["label"],
                "old_status": old_status,
                "new_status": new_status,
                "severity": series["severity"],
                "yoy_pct": series.get("yoyPct"),
                "qoq_pct": series.get("qoqAnnualizedPct"),
                "description": series.get("description", ""),
            })
    return changes


def find_matching_scenario(
    conn: sqlite3.Connection,
    theme: str,
) -> Optional[int]:
    """Find an active news_cluster or mixed_news_led scenario with a matching theme."""
    row = conn.execute(
        """
        SELECT id FROM market_situations
        WHERE primary_theme = ?
          AND detection_path IN ('news_cluster', 'mixed_news_led')
          AND status NOT IN ('FADING', 'ARCHIVED', 'INVALIDATED')
        ORDER BY evidence_count DESC, id DESC
        LIMIT 1
        """,
        (theme,),
    ).fetchone()
    return int(row["id"]) if row else None


def create_consumer_cycle_scenario(
    conn: sqlite3.Connection,
    change: Dict[str, Any],
    theme: str,
    now: int,
) -> int:
    """Create a new scenario seeded by a consumer cycle state change."""
    key = change["key"]
    direction = "worsening" if change["severity"] >= 2 else "improving"
    title = f"Consumer Cycle: {change['label']} {direction} ({change['old_status']} → {change['new_status']})"
    summary = (
        f"{change['label']} moved from {change['old_status']} to {change['new_status']}. "
        f"YoY: {change['yoy_pct']}%, QoQ annualized: {change['qoq_pct']}%. "
        f"{change['description']}"
    )
    slug = f"consumer-cycle-{key}-{now}"
    sectors = SERIES_SECTOR_MAP.get(key, [])

    metadata = {
        "consumer_cycle_series": key,
        "state_transition": f"{change['old_status']} → {change['new_status']}",
        "affected_sectors": sectors,
    }

    cur = conn.execute(
        """
        INSERT INTO market_situations (
            slug, title, summary, primary_theme, scenario_type,
            status, signal_strength, confidence_score, confidence_level,
            time_horizon,
            started_at, last_updated_at,
            event_score, source_breadth_score,
            evidence_count,
            detection_path, metadata_json,
            schema_version, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, 'consumer_cycle',
            'EARLY', 35, 0.40, 'medium',
            'months',
            ?, ?,
            0.4, 0.2,
            1,
            'news_cluster', ?,
            ?, ?, ?
        )
        """,
        (
            slug, title, summary, theme,
            now, now,
            json.dumps(metadata),
            SCENARIO_SCHEMA_VERSION, now, now,
        ),
    )
    return int(cur.lastrowid)


def attach_signal(
    conn: sqlite3.Connection,
    situation_id: int,
    change: Dict[str, Any],
    now: int,
) -> None:
    """Attach a consumer_cycle_state_change signal to a scenario."""
    source_id = f"consumer_cycle:{change['key']}:{change['old_status']}-{change['new_status']}:{now}"

    conn.execute(
        """
        INSERT INTO situation_signals (
            situation_id, signal_type, source_type, source_id,
            entity, theme, score, weight,
            observed_at, ingested_at, payload_json
        ) VALUES (?, 'consumer_cycle_state_change', 'consumer_cycle', ?,
                  ?, ?, ?, 0.9, ?, ?, ?)
        """,
        (
            situation_id, source_id,
            change["label"], SERIES_THEME_MAP.get(change["key"], "consumer_cycle"),
            change["severity"] / 3.0,
            now, now,
            json.dumps({
                "series_key": change["key"],
                "old_status": change["old_status"],
                "new_status": change["new_status"],
                "yoy_pct": change["yoy_pct"],
                "qoq_pct": change["qoq_pct"],
            }),
        ),
    )

    headline = (
        f"{change['label']}: {change['old_status']} → {change['new_status']} "
        f"(YoY {change['yoy_pct']}%)"
    )
    conn.execute(
        """
        INSERT INTO situation_evidence (
            situation_id, evidence_type, source_name,
            headline_or_label, summary, url,
            published_at, importance_score, novelty_score
        ) VALUES (?, 'consumer_cycle_note', 'Consumer Cycle Monitor',
                  ?, ?, '/consumer-cycle', ?, 0.7, 0.8)
        """,
        (
            situation_id,
            headline,
            f"{change['description']} QoQ annualized: {change['qoq_pct']}%.",
            now,
        ),
    )

    conn.execute(
        "UPDATE market_situations SET evidence_count = evidence_count + 1, "
        "updated_at = ? WHERE id = ?",
        (now, situation_id),
    )


def run(
    db_path: str,
    *,
    base_url: str = DEFAULT_BASE_URL,
    dry_run: bool = False,
    verbose: bool = False,
    force_refresh: bool = False,
) -> dict:
    try:
        monitor = fetch_monitor(base_url, force_refresh=force_refresh)
    except Exception as e:
        print(f"[consumer-cycle-adapter] ERROR: Could not fetch monitor: {e}")
        return {"error": str(e)}

    all_series = list(monitor.get("cyclicalConsumerSeries", []))
    all_series.extend(monitor.get("companionSeries", []))

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(actual["value"]) if actual else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[consumer-cycle-adapter] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )

    previous = load_previous_state(conn)
    current_state = {s["key"]: s["status"] for s in all_series}

    if verbose:
        print(f"[consumer-cycle-adapter] Overall: {monitor['overallStatus']} "
              f"severity={monitor['averageSeverity']}")
        print(f"  Previous state: {previous or '(first run — seeding)'}")
        print(f"  Current state:  {current_state}")

    if not previous:
        print("[consumer-cycle-adapter] First run — seeding state, no transitions to detect.")
        if not dry_run:
            save_current_state(conn, current_state)
            conn.commit()
        conn.close()
        return {"seeded": True, "changes": 0}

    changes = detect_changes(previous, all_series)
    if verbose:
        print(f"  Detected {len(changes)} state changes")

    created = 0
    attached = 0
    now = int(time.time())

    for change in changes:
        theme = SERIES_THEME_MAP.get(change["key"], "consumer_cycle")
        direction_label = "worsening" if change["severity"] >= 2 else "improving"

        if verbose:
            print(
                f"  {change['key']}: {change['old_status']} → {change['new_status']} "
                f"({direction_label}) theme={theme}"
            )

        if dry_run:
            continue

        scenario_id = find_matching_scenario(conn, theme)
        if scenario_id:
            attach_signal(conn, scenario_id, change, now)
            attached += 1
            if verbose:
                print(f"    → attached to scenario id={scenario_id}")
        else:
            scenario_id = create_consumer_cycle_scenario(conn, change, theme, now)
            attach_signal(conn, scenario_id, change, now)
            created += 1
            if verbose:
                print(f"    → created new scenario id={scenario_id}")

    if not dry_run:
        save_current_state(conn, current_state)
        conn.commit()
    conn.close()

    summary = {
        "changes": len(changes),
        "created": created,
        "attached": attached,
        "overall_status": monitor["overallStatus"],
        "dry_run": dry_run,
    }
    print(f"[consumer-cycle-adapter] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Consumer Cycle adapter for Macro Engine (D12)"
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--force-refresh", action="store_true",
                        help="Force FRED data refresh before checking")
    args = parser.parse_args()
    run(
        args.db_path,
        base_url=args.base_url,
        dry_run=args.dry_run,
        verbose=args.verbose,
        force_refresh=args.force_refresh,
    )
