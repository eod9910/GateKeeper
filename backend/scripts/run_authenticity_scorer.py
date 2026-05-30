#!/usr/bin/env python
"""Authenticity Layer scorer — CLI / cron entry point.

PRD: market-intelligence-scenario-engine-prd-pdr.md → Authenticity Layer (D23)

Picks up every `emerging_topics` row that has not yet been authenticity-scored
(or, with --rescore-all, every active row) and replaces the placeholder
`authenticity_score = 0.5` with a real value computed from the underlying
`mi_raw_hits`. Writes per-signal audit rows to `authenticity_signals` and an
aggregated cache to `emerging_topics.authenticity_signals_json`.

When a hard-limit rule fires, `suppression_reason` is set on the topic so the
promoter (`promote_emerging_topics.py`) skips it.

Slot in the cron schedule (PRD operational architecture):

    *:00, *:15, *:30, *:45  zscore_engine writes new emerging_topics
    *:07, *:22, *:37, *:52  authenticity_scorer (this script)
    *:00, *:15, *:30, *:45  topic_promotion (next cycle picks up the score)

The ~7-min offset means: an emerging topic written at *:00 gets scored at *:07,
and the promoter at *:15 sees the real score (not the 0.5 placeholder).

Usage:
    py backend/scripts/run_authenticity_scorer.py
    py backend/scripts/run_authenticity_scorer.py --rescore-all --verbose
    py backend/scripts/run_authenticity_scorer.py --topic-id 1 --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import List, Optional, Sequence

# Ensure backend.services is importable when this script is run directly
# (cron uses absolute path; PYTHONPATH is not set).
_SCRIPT_DIR = os.path.abspath(os.path.dirname(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_SCRIPT_DIR, os.pardir, os.pardir))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from backend.services.authenticity_scorer import (  # noqa: E402
    NOT_YET_IMPLEMENTED_REASON,
    load_weights,
    persist_score,
    score_topic,
)

EXPECTED_SCHEMA_VERSION = 5
DEFAULT_DB_PATH = os.path.join(_PROJECT_ROOT, "backend", "data", "market-intelligence.sqlite")

# `0.5` is the literal placeholder z-score-engine writes when it inserts a new
# emerging_topics row. Combined with `authenticity_signals_json IS NULL`, this
# uniquely identifies "never authentically-scored" rows.
PLACEHOLDER_SCORE = 0.5


def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(f"[auth] market-intelligence.sqlite missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema_version(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    raw = row["value"] if row else None
    try:
        actual = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        actual = None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[auth] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )


def fetch_unscored(conn: sqlite3.Connection, max_rows: int) -> List[sqlite3.Row]:
    """Topics that still hold the placeholder authenticity score."""
    return conn.execute(
        """
        SELECT *
        FROM emerging_topics
        WHERE authenticity_signals_json IS NULL
          AND ABS(authenticity_score - ?) < 1e-6
        ORDER BY first_anomaly_at DESC
        LIMIT ?
        """,
        (PLACEHOLDER_SCORE, max_rows),
    ).fetchall()


def fetch_all_active(conn: sqlite3.Connection, max_rows: int) -> List[sqlite3.Row]:
    """All non-suppressed topics (used by --rescore-all)."""
    return conn.execute(
        """
        SELECT * FROM emerging_topics
        WHERE suppression_reason IS NULL
        ORDER BY first_anomaly_at DESC
        LIMIT ?
        """,
        (max_rows,),
    ).fetchall()


def fetch_one(conn: sqlite3.Connection, topic_id: int) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM emerging_topics WHERE id = ?", (topic_id,)
    ).fetchone()


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Authenticity Layer scorer (PRD D23)."
    )
    p.add_argument("--db", default=DEFAULT_DB_PATH)
    p.add_argument(
        "--topic-id", type=int, default=None,
        help="score one specific emerging_topic id (overrides selection mode)"
    )
    p.add_argument(
        "--rescore-all", action="store_true",
        help="rescore every active topic, not just placeholders",
    )
    p.add_argument("--max-topics", type=int, default=200,
                   help="cap topics scored per run (default 200)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything, do not commit")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    conn = open_db(args.db)
    try:
        assert_schema_version(conn)
        weights = load_weights()

        if args.topic_id is not None:
            row = fetch_one(conn, args.topic_id)
            if row is None:
                print(f"[auth] no emerging_topic with id={args.topic_id}")
                return 1
            topics = [row]
        elif args.rescore_all:
            topics = fetch_all_active(conn, args.max_topics)
        else:
            topics = fetch_unscored(conn, args.max_topics)

        if not topics:
            print("[auth] no topics to score")
            return 0

        scored = 0
        suppressed = 0
        as_of = int(time.time())

        for topic in topics:
            result = score_topic(conn, topic, weights=weights)
            if args.verbose or args.dry_run:
                signals_summary = ", ".join(
                    f"{s.signal_type}={s.value:.2f}" for s in result.computed_signals
                )
                hl = f" HL={result.hard_limit_fired}" if result.hard_limit_fired else ""
                print(
                    f"[auth] topic_id={topic['id']} concept_id={topic['concept_id']} "
                    f"score={result.score:.3f}{hl} "
                    f"window_hits={result.window_total_mentions} "
                    f"named_authors={result.window_unique_authors} | {signals_summary}"
                )
                if args.verbose:
                    for s in result.computed_signals:
                        print(f"    - {s.signal_type:30s} value={s.value:.3f}  w={s.weight}  {s.notes}")

            if not args.dry_run:
                persist_score(conn, int(topic["id"]), result, as_of=as_of)
                scored += 1
                if result.suppression_reason:
                    suppressed += 1

        if not args.dry_run:
            conn.commit()

        print(
            f"[auth] done: candidates={len(topics)} scored={scored} "
            f"suppressed={suppressed} dry_run={args.dry_run}"
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
