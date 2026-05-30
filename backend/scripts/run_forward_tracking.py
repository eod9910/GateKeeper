#!/usr/bin/env python
"""Forward-tracking metrics engine (PRD Phase 5).

For each scenario with ranked candidates, fetches the forward price return of
top-N symbols from the OHLCV endpoint and computes outcome metrics:
  - direction_hit: did price move in the expected direction?
  - forward_return_pct: actual % return since scenario created_at
  - max_favorable_pct: max favorable excursion (MFE)
  - max_adverse_pct: max adverse excursion (MAE)
  - days_since_created: age of scenario

Results are persisted to `scenario_outcomes` table for dashboard consumption.
The quality dashboard aggregates these per primary_theme and detection_path.

Usage:
    py backend/scripts/run_forward_tracking.py --verbose
    py backend/scripts/run_forward_tracking.py --dry-run
    py backend/scripts/run_forward_tracking.py --situation-id 168
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
DOTENV_PATH = os.path.join(BACKEND_DIR, ".env")

API_BASE = os.environ.get("API_BASE", "http://localhost:3002")
EXPECTED_SCHEMA_VERSION = 6
TOP_N = 5
LOOKBACK_DAYS = 90


def _ensure_outcomes_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scenario_outcomes (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            situation_id        INTEGER NOT NULL,
            symbol              TEXT NOT NULL,
            exposure_direction  TEXT,
            composite_rank      REAL,
            entry_price         REAL,
            current_price       REAL,
            forward_return_pct  REAL,
            max_favorable_pct   REAL,
            max_adverse_pct     REAL,
            direction_hit       INTEGER,
            days_tracked        INTEGER,
            scenario_age_days   INTEGER,
            primary_theme       TEXT,
            detection_path      TEXT,
            scenario_status     TEXT,
            outcome_label       TEXT,
            operator_label      TEXT,
            tracked_at          INTEGER NOT NULL,
            UNIQUE(situation_id, symbol)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS theme_quality_snapshots (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date       TEXT NOT NULL,
            primary_theme       TEXT NOT NULL,
            detection_path      TEXT,
            total_scenarios     INTEGER,
            scenarios_tracked   INTEGER,
            avg_forward_return  REAL,
            direction_hit_rate  REAL,
            avg_mfe             REAL,
            avg_mae             REAL,
            avg_composite_rank  REAL,
            avg_scenario_age    INTEGER,
            top_winners         TEXT,
            top_losers          TEXT,
            created_at          INTEGER NOT NULL,
            UNIQUE(snapshot_date, primary_theme, detection_path)
        )
    """)


def _fetch_ohlcv(symbol: str, days: int = LOOKBACK_DAYS) -> Optional[List[Dict]]:
    try:
        url = f"{API_BASE}/api/chart/ohlcv?symbol={symbol}&range={days}d&interval=1d"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict):
                if "chart_data" in data:
                    return data["chart_data"]
                if "candles" in data:
                    return data["candles"]
            if isinstance(data, list):
                return data
            return None
    except Exception:
        return None


def _compute_outcome(
    candles: List[Dict],
    created_at: int,
    direction: str,
) -> Dict[str, Any]:
    if not candles or len(candles) < 2:
        return {}

    created_date = time.strftime("%Y-%m-%d", time.gmtime(created_at))

    entry_idx = None
    for i, c in enumerate(candles):
        cdate = c.get("time", c.get("date", c.get("t", "")))
        if isinstance(cdate, (int, float)):
            cdate = time.strftime("%Y-%m-%d", time.gmtime(cdate))
        if cdate >= created_date:
            entry_idx = i
            break

    if entry_idx is None:
        entry_idx = 0

    entry_price = candles[entry_idx].get("close", candles[entry_idx].get("c", 0))
    if not entry_price or entry_price <= 0:
        return {}

    current_price = candles[-1].get("close", candles[-1].get("c", 0))
    if not current_price or current_price <= 0:
        return {}

    forward_return = ((current_price - entry_price) / entry_price) * 100

    max_high = max(
        c.get("high", c.get("h", entry_price))
        for c in candles[entry_idx:]
    )
    min_low = min(
        c.get("low", c.get("l", entry_price))
        for c in candles[entry_idx:]
    )

    mfe_long = ((max_high - entry_price) / entry_price) * 100
    mae_long = ((entry_price - min_low) / entry_price) * 100

    is_long = "long" in (direction or "").lower() or "beneficiary" in (direction or "").lower()

    if is_long:
        mfe = mfe_long
        mae = mae_long
        direction_hit = 1 if forward_return > 0 else 0
    else:
        mfe = mae_long
        mae = mfe_long
        direction_hit = 1 if forward_return < 0 else 0

    days_tracked = len(candles) - entry_idx

    return {
        "entry_price": round(entry_price, 2),
        "current_price": round(current_price, 2),
        "forward_return_pct": round(forward_return, 2),
        "max_favorable_pct": round(mfe, 2),
        "max_adverse_pct": round(mae, 2),
        "direction_hit": direction_hit,
        "days_tracked": days_tracked,
    }


def run(
    db_path: str = DEFAULT_DB_PATH,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    situation_id: Optional[int] = None,
    max_scenarios: int = 50,
) -> Dict[str, Any]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[forward-tracking] schema_version mismatch")

    _ensure_outcomes_table(conn)

    where = "1=1"
    params: list = []
    if situation_id is not None:
        where += " AND ms.id = ?"
        params.append(situation_id)

    scenarios = conn.execute(
        f"""
        SELECT ms.id, ms.title, ms.primary_theme, ms.detection_path,
               ms.status, ms.created_at, ms.scenario_type
        FROM market_situations ms
        WHERE {where}
          AND ms.status NOT IN ('ARCHIVED')
        ORDER BY ms.created_at DESC
        LIMIT ?
        """,
        params + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[forward-tracking] {len(scenarios)} scenarios to track")

    tracked = 0
    symbols_fetched = 0
    hits = 0
    misses = 0
    errors = 0
    now = int(time.time())

    for row in scenarios:
        sid = int(row["id"])
        created_at = int(row["created_at"])
        scenario_age_days = (now - created_at) // 86400

        candidates = conn.execute(
            """
            SELECT universe_symbol, exposure_direction, composite_rank
            FROM situation_exposure
            WHERE situation_id = ? AND universe_symbol IS NOT NULL
              AND composite_rank IS NOT NULL
            ORDER BY composite_rank DESC
            LIMIT ?
            """,
            (sid, TOP_N),
        ).fetchall()

        if not candidates:
            continue

        for cand in candidates:
            symbol = cand["universe_symbol"]
            direction = cand["exposure_direction"]
            rank = cand["composite_rank"]

            if verbose:
                title = (row["title"] or "")[:40]
                print(f"  id={sid} {symbol} dir={direction} rank={rank:.1f} | {title}")

            if dry_run:
                tracked += 1
                continue

            candles = _fetch_ohlcv(symbol)
            symbols_fetched += 1

            if not candles:
                errors += 1
                continue

            outcome = _compute_outcome(candles, created_at, direction)
            if not outcome:
                errors += 1
                continue

            if outcome["direction_hit"]:
                hits += 1
            else:
                misses += 1

            conn.execute(
                """
                INSERT OR REPLACE INTO scenario_outcomes (
                    situation_id, symbol, exposure_direction, composite_rank,
                    entry_price, current_price, forward_return_pct,
                    max_favorable_pct, max_adverse_pct, direction_hit,
                    days_tracked, scenario_age_days,
                    primary_theme, detection_path, scenario_status,
                    tracked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid, symbol, direction, rank,
                    outcome["entry_price"], outcome["current_price"],
                    outcome["forward_return_pct"],
                    outcome["max_favorable_pct"], outcome["max_adverse_pct"],
                    outcome["direction_hit"],
                    outcome["days_tracked"], scenario_age_days,
                    row["primary_theme"], row["detection_path"], row["status"],
                    now,
                ),
            )
            tracked += 1

    if not dry_run:
        _build_theme_snapshots(conn, verbose)
        conn.commit()

    conn.close()

    summary = {
        "scenarios_checked": len(scenarios),
        "outcomes_tracked": tracked,
        "symbols_fetched": symbols_fetched,
        "direction_hits": hits,
        "direction_misses": misses,
        "errors": errors,
        "hit_rate": round(hits / max(hits + misses, 1) * 100, 1),
        "dry_run": dry_run,
    }
    print(f"[forward-tracking] Done. {json.dumps(summary)}")
    return summary


def _build_theme_snapshots(conn: sqlite3.Connection, verbose: bool = False) -> None:
    today = time.strftime("%Y-%m-%d")

    themes = conn.execute(
        """
        SELECT primary_theme, detection_path,
               COUNT(*) as total,
               AVG(forward_return_pct) as avg_ret,
               AVG(CASE WHEN direction_hit = 1 THEN 1.0 ELSE 0.0 END) as hit_rate,
               AVG(max_favorable_pct) as avg_mfe,
               AVG(max_adverse_pct) as avg_mae,
               AVG(composite_rank) as avg_rank,
               AVG(scenario_age_days) as avg_age
        FROM scenario_outcomes
        WHERE tracked_at > ?
        GROUP BY primary_theme, detection_path
        ORDER BY total DESC
        """,
        (int(time.time()) - 86400 * 7,),
    ).fetchall()

    for t in themes:
        winners = conn.execute(
            """
            SELECT symbol, forward_return_pct FROM scenario_outcomes
            WHERE primary_theme = ? AND detection_path = ?
              AND direction_hit = 1
            ORDER BY ABS(forward_return_pct) DESC LIMIT 3
            """,
            (t["primary_theme"], t["detection_path"]),
        ).fetchall()
        losers = conn.execute(
            """
            SELECT symbol, forward_return_pct FROM scenario_outcomes
            WHERE primary_theme = ? AND detection_path = ?
              AND direction_hit = 0
            ORDER BY ABS(forward_return_pct) DESC LIMIT 3
            """,
            (t["primary_theme"], t["detection_path"]),
        ).fetchall()

        conn.execute(
            """
            INSERT OR REPLACE INTO theme_quality_snapshots (
                snapshot_date, primary_theme, detection_path,
                total_scenarios, scenarios_tracked,
                avg_forward_return, direction_hit_rate,
                avg_mfe, avg_mae, avg_composite_rank, avg_scenario_age,
                top_winners, top_losers, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                today, t["primary_theme"], t["detection_path"],
                t["total"], t["total"],
                round(t["avg_ret"] or 0, 2),
                round((t["hit_rate"] or 0) * 100, 1),
                round(t["avg_mfe"] or 0, 2),
                round(t["avg_mae"] or 0, 2),
                round(t["avg_rank"] or 0, 1),
                int(t["avg_age"] or 0),
                json.dumps([{"s": r["symbol"], "r": r["forward_return_pct"]} for r in winners]),
                json.dumps([{"s": r["symbol"], "r": r["forward_return_pct"]} for r in losers]),
                int(time.time()),
            ),
        )

    if verbose:
        print(f"  [quality] {len(themes)} theme/engine snapshots built for {today}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Forward-tracking metrics (Phase 5)")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--max-scenarios", type=int, default=50)
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        situation_id=args.situation_id,
        max_scenarios=args.max_scenarios,
    )
