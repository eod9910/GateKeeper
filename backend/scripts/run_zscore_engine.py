#!/usr/bin/env python
"""
Z-score anomaly engine for the Market Intelligence Social Arbitrage layer.

Pipeline (PRD D17 / §Operational Architecture):

    concept_daily_counts        topic_baselines
            │                         │
            └────────────┬────────────┘
                         ▼
                  z = (obs - mean) / stdev
                         │
                         ▼  (apply seasonality + min_mention_floor)
                         │
                         ▼  (per concept: pick seed_community, gather corroborators)
                         ▼
                   emerging_topics  (UPSERT)

This is the **statistical** layer only. It does not score authenticity, does
not promote topics to scenarios, does not consult any LLM. Downstream stages
read its `emerging_topics` rows.

For v1 we combine both the every-15-min "score" pass and the nightly
"baseline rebuild" pass into a single script with mode flags:

    --score-only           skip baseline updates entirely (fast)
    --rebuild-baselines    force-recompute every baseline first
    (default)              recompute stale (>24h) or missing baselines, then score

Usage from the marketIntelligenceScheduler:
    py backend/scripts/run_zscore_engine.py                       # incremental
    py backend/scripts/run_zscore_engine.py --rebuild-baselines   # nightly

Flags:
    --threshold FLOAT          z-score threshold for anomaly emission (default 2.0)
    --corroboration FLOAT      lower z threshold for "corroborating" community
                               (default 1.5)
    --baseline-days INTEGER    rolling window for baseline mean/stdev (default 30)
    --min-baseline-days INT    minimum data_days required to score a concept
                               (default 7)
    --score-day INTEGER        unix-epoch UTC midnight of the day to score
                               (default: most recent day with data)
    --dry-run                  compute everything but do not write
    --verbose                  print every concept's z-score
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")

EXPECTED_SCHEMA_VERSION = 3

DAY_SECONDS = 86_400

# Source-type membership per community keyword (loose; the
# tracked-sources.json registry is the authoritative source eventually).
# Used only to compute `cross_platform_corroboration` — i.e. distinct
# source-types in the corroborating set.
COMMUNITY_TO_SOURCE_TYPE: Dict[str, str] = {
    "hackernews": "hackernews",
    "hn": "hackernews",
    "fourchan": "fourchan",
    "/biz/": "fourchan",
    "/g/": "fourchan",
    "bluesky": "bluesky",
    "discord": "discord",
    "forum": "forum",
    "reddit": "reddit",
}


def community_to_source_type(community: str) -> str:
    if not community:
        return "unknown"
    key = community.strip().lower()
    if key in COMMUNITY_TO_SOURCE_TYPE:
        return COMMUNITY_TO_SOURCE_TYPE[key]
    # Heuristic: prefix match (e.g. 'discord:gear-acquisition' -> 'discord').
    for prefix, st in COMMUNITY_TO_SOURCE_TYPE.items():
        if key.startswith(prefix):
            return st
    return key


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def now_unix() -> int:
    return int(time.time())


def midnight_utc(unix_seconds: int) -> int:
    return (unix_seconds // DAY_SECONDS) * DAY_SECONDS


def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(
            f"[zscore-engine] market-intelligence.sqlite missing at {db_path}. "
            f"Run backend/scripts/build_market_intelligence_db.py first."
        )
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
    if actual != EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[zscore-engine] schema_version mismatch: got {actual!r}, "
            f"expected {EXPECTED_SCHEMA_VERSION}. Run "
            f"backend/scripts/build_market_intelligence_db.py to migrate."
        )


# ---------------------------------------------------------------------------
# Baseline rebuild
# ---------------------------------------------------------------------------


def fetch_active_concept_ids(conn: sqlite3.Connection) -> List[int]:
    rows = conn.execute(
        "SELECT id FROM tracked_concepts WHERE status = 'active' ORDER BY id"
    ).fetchall()
    return [int(r["id"]) for r in rows]


def fetch_recent_daily_counts(
    conn: sqlite3.Connection,
    concept_id: int,
    end_day_exclusive: int,
    window_days: int,
) -> Dict[str, List[Tuple[int, int, int]]]:
    """
    Return {community: [(day, mention_count, unique_authors), ...]} for the
    [end_day_exclusive - window_days, end_day_exclusive) range.
    """
    start_day = end_day_exclusive - window_days * DAY_SECONDS
    rows = conn.execute(
        """
        SELECT community, day, mention_count, unique_authors
        FROM concept_daily_counts
        WHERE concept_id = ?
          AND day >= ?
          AND day < ?
        ORDER BY community, day
        """,
        (concept_id, start_day, end_day_exclusive),
    ).fetchall()
    out: Dict[str, List[Tuple[int, int, int]]] = defaultdict(list)
    for r in rows:
        out[str(r["community"])].append(
            (int(r["day"]), int(r["mention_count"]), int(r["unique_authors"]))
        )
    return out


def upsert_baseline(
    conn: sqlite3.Connection,
    concept_id: int,
    community: str,
    as_of_day: int,
    mean: float,
    stdev: float,
    data_days: int,
    min_mention_floor: int,
) -> None:
    conn.execute(
        """
        INSERT INTO topic_baselines (
            concept_id, community, as_of_day,
            rolling_mean_30d, rolling_stdev_30d,
            dow_multipliers_json, monthly_seasonality_json,
            min_mention_floor, data_days
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        ON CONFLICT(concept_id, community) DO UPDATE SET
            as_of_day = excluded.as_of_day,
            rolling_mean_30d = excluded.rolling_mean_30d,
            rolling_stdev_30d = excluded.rolling_stdev_30d,
            min_mention_floor = excluded.min_mention_floor,
            data_days = excluded.data_days
        """,
        (
            concept_id,
            community,
            as_of_day,
            mean,
            stdev,
            min_mention_floor,
            data_days,
        ),
    )


def rebuild_baselines(
    conn: sqlite3.Connection,
    *,
    today: int,
    window_days: int,
    min_mention_floor: int,
    only_concept_ids: Optional[Sequence[int]] = None,
    verbose: bool = False,
) -> Dict[str, int]:
    """
    Recompute (concept_id, community) baselines from
    concept_daily_counts over the last `window_days` (exclusive of today).
    """
    target_ids = list(only_concept_ids) if only_concept_ids else fetch_active_concept_ids(conn)
    written = 0
    skipped_insufficient = 0

    for concept_id in target_ids:
        per_community = fetch_recent_daily_counts(
            conn, concept_id, end_day_exclusive=today, window_days=window_days
        )
        for community, samples in per_community.items():
            counts = [s[1] for s in samples]
            data_days = len(counts)
            if data_days < 2:
                skipped_insufficient += 1
                if verbose:
                    print(
                        f"[zscore-engine] baseline skip "
                        f"concept={concept_id} community={community} data_days={data_days}"
                    )
                continue
            mean = float(statistics.fmean(counts))
            try:
                stdev = float(statistics.pstdev(counts))
            except statistics.StatisticsError:
                stdev = 0.0
            if stdev <= 0.0:
                # Avoid div-by-zero downstream; use sqrt(mean) as
                # a Poisson-ish floor (count data approximation).
                stdev = max(1.0, math.sqrt(max(mean, 1.0)))
            upsert_baseline(
                conn,
                concept_id=concept_id,
                community=community,
                as_of_day=today,
                mean=mean,
                stdev=stdev,
                data_days=data_days,
                min_mention_floor=min_mention_floor,
            )
            written += 1
            if verbose:
                print(
                    f"[zscore-engine] baseline upsert "
                    f"concept={concept_id} community={community} "
                    f"mean={mean:.2f} stdev={stdev:.2f} days={data_days}"
                )

    conn.commit()
    return {
        "concepts_processed": len(target_ids),
        "baselines_written": written,
        "skipped_insufficient_history": skipped_insufficient,
    }


# ---------------------------------------------------------------------------
# Scoring pass
# ---------------------------------------------------------------------------


def fetch_score_day(conn: sqlite3.Connection, score_day: Optional[int]) -> Optional[int]:
    if score_day is not None:
        return midnight_utc(int(score_day))
    row = conn.execute(
        "SELECT MAX(day) AS latest_day FROM concept_daily_counts"
    ).fetchone()
    if not row or row["latest_day"] is None:
        return None
    return int(row["latest_day"])


def fetch_observations(
    conn: sqlite3.Connection,
    score_day: int,
) -> Dict[int, List[Tuple[str, int, int]]]:
    """
    Return {concept_id: [(community, mention_count, unique_authors), ...]}
    for the score_day.
    """
    rows = conn.execute(
        """
        SELECT cdc.concept_id,
               cdc.community,
               cdc.mention_count,
               cdc.unique_authors
        FROM concept_daily_counts cdc
        JOIN tracked_concepts tc ON tc.id = cdc.concept_id
        WHERE cdc.day = ?
          AND tc.status = 'active'
        """,
        (score_day,),
    ).fetchall()
    out: Dict[int, List[Tuple[str, int, int]]] = defaultdict(list)
    for r in rows:
        out[int(r["concept_id"])].append(
            (str(r["community"]), int(r["mention_count"]), int(r["unique_authors"]))
        )
    return out


def fetch_baselines(
    conn: sqlite3.Connection, concept_ids: Iterable[int]
) -> Dict[Tuple[int, str], sqlite3.Row]:
    ids = list({int(c) for c in concept_ids})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        SELECT concept_id, community, rolling_mean_30d, rolling_stdev_30d,
               min_mention_floor, data_days
        FROM topic_baselines
        WHERE concept_id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    return {(int(r["concept_id"]), str(r["community"])): r for r in rows}


def upsert_emerging_topic(
    conn: sqlite3.Connection,
    *,
    concept_id: int,
    seed_community: str,
    peak_z: float,
    current_z: float,
    corroborating: List[str],
    cross_platform: bool,
    first_anomaly_at: int,
    last_anomaly_at: int,
    total_mentions: int,
    unique_authors: int,
) -> Tuple[str, int]:
    """
    Upsert into emerging_topics. Returns ('inserted'|'updated', row_id).

    Match criterion for "same emerging topic":
        same concept_id AND seeded_situation_id IS NULL AND
        suppression_reason IS NULL  -- still in the active surfacing window
    """
    existing = conn.execute(
        """
        SELECT id, peak_z_score, first_anomaly_at, total_mentions, unique_authors
        FROM emerging_topics
        WHERE concept_id = ?
          AND seeded_situation_id IS NULL
          AND suppression_reason IS NULL
        ORDER BY id DESC
        LIMIT 1
        """,
        (concept_id,),
    ).fetchone()

    now = now_unix()
    if existing is None:
        cur = conn.execute(
            """
            INSERT INTO emerging_topics (
                concept_id, seed_community,
                peak_z_score, current_z_score,
                corroborating_communities_json,
                cross_platform_corroboration,
                migration_to_ticker_indexed,
                migrated_at,
                first_anomaly_at, last_anomaly_at,
                total_mentions, unique_authors,
                authenticity_score,
                authenticity_signals_json,
                resolved_target_type, resolved_tickers_json,
                seeded_situation_id, suppression_reason,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?,
                      0.5, NULL, NULL, NULL, NULL, NULL, ?, ?)
            """,
            (
                concept_id,
                seed_community,
                peak_z,
                current_z,
                json.dumps(corroborating),
                1 if cross_platform else 0,
                first_anomaly_at,
                last_anomaly_at,
                total_mentions,
                unique_authors,
                now,
                now,
            ),
        )
        return ("inserted", int(cur.lastrowid))

    new_peak = max(float(existing["peak_z_score"]), peak_z)
    first_seen = min(int(existing["first_anomaly_at"]), first_anomaly_at)
    cumulative_mentions = int(existing["total_mentions"]) + total_mentions
    cumulative_authors = max(int(existing["unique_authors"]), unique_authors)
    conn.execute(
        """
        UPDATE emerging_topics SET
            seed_community = ?,
            peak_z_score = ?,
            current_z_score = ?,
            corroborating_communities_json = ?,
            cross_platform_corroboration = ?,
            first_anomaly_at = ?,
            last_anomaly_at = ?,
            total_mentions = ?,
            unique_authors = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            seed_community,
            new_peak,
            current_z,
            json.dumps(corroborating),
            1 if cross_platform else 0,
            first_seen,
            last_anomaly_at,
            cumulative_mentions,
            cumulative_authors,
            now,
            int(existing["id"]),
        ),
    )
    return ("updated", int(existing["id"]))


def score_concepts(
    conn: sqlite3.Connection,
    *,
    score_day: int,
    threshold: float,
    corroboration_threshold: float,
    min_baseline_days: int,
    dry_run: bool,
    verbose: bool,
) -> Dict[str, int]:
    observations = fetch_observations(conn, score_day)
    baselines = fetch_baselines(conn, observations.keys())

    inserted = 0
    updated = 0
    seen = 0
    skipped_no_baseline = 0
    skipped_below_floor = 0
    skipped_insufficient_history = 0
    skipped_below_threshold = 0

    for concept_id, samples in observations.items():
        per_community_z: List[Tuple[str, float, int, int]] = []  # community, z, count, authors
        for community, count, authors in samples:
            base = baselines.get((concept_id, community))
            if base is None:
                skipped_no_baseline += 1
                continue
            data_days = int(base["data_days"])
            if data_days < min_baseline_days:
                skipped_insufficient_history += 1
                continue
            floor = int(base["min_mention_floor"])
            if count < floor:
                skipped_below_floor += 1
                continue
            mean = float(base["rolling_mean_30d"])
            stdev = float(base["rolling_stdev_30d"])
            if stdev <= 0.0:
                stdev = max(1.0, math.sqrt(max(mean, 1.0)))
            z = (count - mean) / stdev
            seen += 1
            if verbose:
                print(
                    f"[zscore-engine] concept={concept_id} community={community} "
                    f"count={count} mean={mean:.2f} stdev={stdev:.2f} z={z:.2f}"
                )
            per_community_z.append((community, z, count, authors))

        if not per_community_z:
            continue

        per_community_z.sort(key=lambda t: t[1], reverse=True)
        seed_community, peak_z, _seed_count, _seed_authors = per_community_z[0]

        if peak_z < threshold:
            skipped_below_threshold += 1
            continue

        corroborators = [
            c for (c, z, _ct, _au) in per_community_z[1:]
            if z >= corroboration_threshold
        ]
        all_communities_in_signal = [seed_community] + corroborators
        source_types = {community_to_source_type(c) for c in all_communities_in_signal}
        cross_platform = len(source_types) >= 2

        total_mentions = sum(ct for (_c, _z, ct, _au) in per_community_z)
        unique_authors = max((au for (_c, _z, _ct, au) in per_community_z), default=0)

        if dry_run:
            print(
                f"[zscore-engine] DRY-RUN would emit "
                f"concept={concept_id} seed={seed_community} "
                f"peak_z={peak_z:.2f} corroborators={corroborators} "
                f"cross_platform={cross_platform} mentions={total_mentions}"
            )
            continue

        action, _row_id = upsert_emerging_topic(
            conn,
            concept_id=concept_id,
            seed_community=seed_community,
            peak_z=peak_z,
            current_z=peak_z,
            corroborating=corroborators,
            cross_platform=cross_platform,
            first_anomaly_at=score_day,
            last_anomaly_at=score_day,
            total_mentions=total_mentions,
            unique_authors=unique_authors,
        )
        if action == "inserted":
            inserted += 1
        else:
            updated += 1

    if not dry_run:
        conn.commit()

    return {
        "score_day": score_day,
        "observations_seen": seen,
        "emerging_inserted": inserted,
        "emerging_updated": updated,
        "skipped_no_baseline": skipped_no_baseline,
        "skipped_below_floor": skipped_below_floor,
        "skipped_insufficient_history": skipped_insufficient_history,
        "skipped_below_threshold": skipped_below_threshold,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Z-score anomaly engine for the Market Intelligence Social Arbitrage layer.",
    )
    p.add_argument("--db", default=DEFAULT_DB_PATH, help="path to market-intelligence.sqlite")
    p.add_argument("--threshold", type=float, default=2.0,
                   help="z-score threshold for anomaly emission (default: 2.0)")
    p.add_argument("--corroboration", type=float, default=1.5,
                   help="z-score threshold for corroborating communities (default: 1.5)")
    p.add_argument("--baseline-days", type=int, default=30,
                   help="rolling baseline window in days (default: 30)")
    p.add_argument("--min-baseline-days", type=int, default=7,
                   help="minimum data_days required to score a concept (default: 7)")
    p.add_argument("--min-mention-floor", type=int, default=20,
                   help="minimum mentions on the score day to qualify (default: 20)")
    p.add_argument("--score-day", type=int, default=None,
                   help="unix-epoch UTC midnight of the day to score "
                        "(default: most recent day with data)")
    p.add_argument("--rebuild-baselines", action="store_true",
                   help="force rebuild every baseline before scoring")
    p.add_argument("--score-only", action="store_true",
                   help="skip baseline updates entirely")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything, write nothing")
    p.add_argument("--verbose", action="store_true", help="print per-concept detail")
    return p.parse_args(argv)


def baselines_are_stale(conn: sqlite3.Connection, today: int) -> bool:
    row = conn.execute(
        "SELECT MAX(as_of_day) AS latest FROM topic_baselines"
    ).fetchone()
    latest = row["latest"] if row and row["latest"] is not None else None
    if latest is None:
        return True
    return int(latest) < today - DAY_SECONDS


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    conn = open_db(args.db)
    try:
        assert_schema_version(conn)

        today = midnight_utc(now_unix())

        # --- baseline pass ---
        if args.score_only:
            print("[zscore-engine] skipping baseline update (--score-only)")
        else:
            should_rebuild = (
                args.rebuild_baselines
                or baselines_are_stale(conn, today)
            )
            if should_rebuild:
                stats = rebuild_baselines(
                    conn,
                    today=today,
                    window_days=args.baseline_days,
                    min_mention_floor=args.min_mention_floor,
                    verbose=args.verbose,
                )
                print(
                    "[zscore-engine] baselines rebuilt: "
                    f"concepts={stats['concepts_processed']} "
                    f"written={stats['baselines_written']} "
                    f"insufficient={stats['skipped_insufficient_history']}"
                )
            else:
                if args.verbose:
                    print("[zscore-engine] baselines fresh, skipping rebuild")

        # --- score pass ---
        score_day = fetch_score_day(conn, args.score_day)
        if score_day is None:
            print("[zscore-engine] no concept_daily_counts data — nothing to score")
            return 0

        stats = score_concepts(
            conn,
            score_day=score_day,
            threshold=args.threshold,
            corroboration_threshold=args.corroboration,
            min_baseline_days=args.min_baseline_days,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )
        print(
            "[zscore-engine] scored: "
            f"day={score_day} obs={stats['observations_seen']} "
            f"inserted={stats['emerging_inserted']} updated={stats['emerging_updated']} "
            f"skip_no_baseline={stats['skipped_no_baseline']} "
            f"skip_below_floor={stats['skipped_below_floor']} "
            f"skip_history={stats['skipped_insufficient_history']} "
            f"skip_below_threshold={stats['skipped_below_threshold']}"
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
