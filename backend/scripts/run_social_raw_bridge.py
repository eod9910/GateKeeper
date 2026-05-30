#!/usr/bin/env python3
"""Bridge ticker-indexed Social Intelligence posts into MI raw evidence.

Social Intelligence collectors own the platform-specific fetching for
StockTwits, Yahoo Finance, and Reddit. Market Intelligence owns the
scenario/narrative pipeline through `mi_raw_hits`. This bridge normalizes
recent social posts into `mi_raw_hits` when they match active Social ARB
concepts by either:

  1. concept search-term text match, or
  2. ticker match against a concept's `watch_tickers`.

That makes ticker-indexed chatter participate in the same z-score, promotion,
authenticity, and reporting loop as HN/4chan/forum/YouTube hits.

Usage:
    py backend/scripts/run_social_raw_bridge.py --verbose
    py backend/scripts/run_social_raw_bridge.py --days-back 7 --limit 25000
    py backend/scripts/run_social_raw_bridge.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
MI_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
SI_DB_PATH = ROOT / "backend" / "data" / "social-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 5
DAY_SECONDS = 86_400

PLATFORM_SOURCE_TYPE = {
    "stocktwits": "stocktwits_post",
    "yahoo finance": "yahoo_community_post",
    "reddit": "reddit_post",
}


def _now_unix() -> int:
    return int(time.time())


def _day_bucket(ts: int) -> int:
    return (int(ts) // DAY_SECONDS) * DAY_SECONDS


def _parse_time_to_unix(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            return int(float(text))
        except (TypeError, ValueError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _compile_term_pattern(term: str) -> re.Pattern[str]:
    parts = [re.escape(p) for p in re.split(r"\s+", term.strip()) if p]
    if not parts:
        return re.compile(r"(?!x)x")
    return re.compile(r"(?<!\w)" + r"\s+".join(parts) + r"(?!\w)", re.IGNORECASE)


def _load_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return fallback


def _connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise SystemExit(f"[social-raw-bridge] DB missing: {path}")
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _assert_mi_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT value FROM schema_meta WHERE key = 'schema_version'").fetchone()
    try:
        actual = int(row["value"]) if row else None
    except (TypeError, ValueError):
        actual = None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"[social-raw-bridge] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}"
        )


def _extract_terms(metadata: Dict[str, Any], fallback: str) -> List[str]:
    terms: List[str] = []
    raw_terms = metadata.get("search_terms")
    if isinstance(raw_terms, list):
        terms.extend(str(t).strip() for t in raw_terms if str(t).strip())
    elif isinstance(raw_terms, str) and raw_terms.strip():
        terms.append(raw_terms.strip())
    if fallback and fallback.strip():
        terms.append(fallback.strip())
    seen: Set[str] = set()
    out: List[str] = []
    for term in terms:
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def _extract_tickers(metadata: Dict[str, Any]) -> Set[str]:
    raw = metadata.get("watch_tickers") or metadata.get("tickers") or []
    if not isinstance(raw, list):
        return set()
    return {str(t).strip().upper() for t in raw if str(t).strip()}


def _load_active_concepts(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, concept_key, target_key, display_label, metadata_json
        FROM tracked_concepts
        WHERE status = 'active'
        ORDER BY id
        """
    ).fetchall()
    concepts: List[Dict[str, Any]] = []
    for row in rows:
        metadata = _load_json(row["metadata_json"], {})
        if not isinstance(metadata, dict):
            metadata = {}
        terms = _extract_terms(metadata, str(row["display_label"] or row["concept_key"]))
        concepts.append(
            {
                "id": int(row["id"]),
                "concept_key": str(row["concept_key"]),
                "target_key": str(row["target_key"] or ""),
                "display_label": str(row["display_label"] or ""),
                "terms": terms,
                "patterns": [_compile_term_pattern(t) for t in terms],
                "watch_tickers": _extract_tickers(metadata),
            }
        )
    return concepts


def _index_concepts_by_ticker(concepts: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    by_ticker: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for concept in concepts:
        for ticker in concept["watch_tickers"]:
            by_ticker[ticker].append(concept)
    return by_ticker


def _match_concepts(
    *,
    text: str,
    symbol: str,
    concepts: List[Dict[str, Any]],
    concepts_by_ticker: Dict[str, List[Dict[str, Any]]],
    ticker_match: bool,
    term_match: bool,
) -> Tuple[Set[int], List[str]]:
    matched: Set[int] = set()
    reasons: List[str] = []

    if ticker_match and symbol:
        for concept in concepts_by_ticker.get(symbol.upper(), []):
            matched.add(int(concept["id"]))
            reasons.append(f"ticker:{symbol}:{concept['concept_key']}")

    if term_match and text:
        for concept in concepts:
            for term, pattern in zip(concept["terms"], concept["patterns"]):
                if pattern.search(text):
                    matched.add(int(concept["id"]))
                    reasons.append(f"term:{term}:{concept['concept_key']}")
                    break

    return matched, reasons


def _source_type_for_platform(platform: str) -> str:
    return PLATFORM_SOURCE_TYPE.get(platform.strip().lower(), f"{platform.strip().lower().replace(' ', '_')}_post")


def _source_community(row: sqlite3.Row, platform_key: str) -> str:
    symbol = str(row["symbol"] or "").strip().upper()
    payload = _load_json(row["payload_json"], {})
    if platform_key == "reddit" and isinstance(payload, dict):
        subreddit = str(payload.get("subreddit") or "").strip()
        if subreddit:
            return f"reddit:{subreddit}"
    if platform_key == "stocktwits":
        return f"stocktwits:{symbol}" if symbol else "stocktwits"
    if platform_key == "yahoo finance":
        return f"yahoo_finance:{symbol}" if symbol else "yahoo_finance"
    return platform_key.replace(" ", "_")


def _fetch_recent_social_posts(
    conn: sqlite3.Connection,
    *,
    since_iso: str,
    platforms: List[str],
    limit: int,
) -> List[sqlite3.Row]:
    rows: List[sqlite3.Row] = []
    for platform in platforms:
        params: List[Any] = [platform, since_iso]
        limit_sql = ""
        if limit > 0:
            limit_sql = "LIMIT ?"
            params.append(limit)
        rows.extend(
            conn.execute(
                f"""
                SELECT raw_post_id, symbol, platform, platform_post_id, platform_thread_id,
                       author_id, author_handle, posted_at, fetched_at, body_text, url,
                       like_count, reply_count, repost_count, view_count,
                       engagement_score, is_reply, is_repost, payload_json
                FROM social_posts_raw
                WHERE lower(platform) = ?
                  AND posted_at >= ?
                  AND body_text IS NOT NULL
                  AND trim(body_text) != ''
                ORDER BY posted_at DESC
                {limit_sql}
                """,
                params,
            ).fetchall()
        )
    rows.sort(key=lambda row: str(row["posted_at"] or ""), reverse=True)
    return rows


def _upsert_hits(
    conn: sqlite3.Connection,
    rows: List[Dict[str, Any]],
    *,
    dry_run: bool,
) -> Dict[str, int]:
    inserted = 0
    merged = 0
    unchanged = 0

    for row in rows:
        existing = conn.execute(
            """
            SELECT id, matched_concept_ids_json
            FROM mi_raw_hits
            WHERE source_type = ? AND source_post_id = ?
            """,
            (row["source_type"], row["source_post_id"]),
        ).fetchone()
        new_ids = set(int(x) for x in row["matched_concept_ids"])

        if existing is None:
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
                        row["fetched_at"],
                        row["score"],
                        row["comment_count"],
                        json.dumps(sorted(new_ids), separators=(",", ":")),
                        row["raw_payload_json"],
                    ),
                )
            inserted += 1
            continue

        existing_ids = set()
        try:
            existing_ids = set(int(x) for x in (json.loads(existing["matched_concept_ids_json"] or "[]") or []))
        except (TypeError, ValueError, json.JSONDecodeError):
            existing_ids = set()
        merged_ids = existing_ids | new_ids
        if merged_ids == existing_ids:
            unchanged += 1
            continue
        if not dry_run:
            conn.execute(
                """
                UPDATE mi_raw_hits
                SET matched_concept_ids_json = ?,
                    raw_payload_json = ?
                WHERE source_type = ? AND source_post_id = ?
                """,
                (
                    json.dumps(sorted(merged_ids), separators=(",", ":")),
                    row["raw_payload_json"],
                    row["source_type"],
                    row["source_post_id"],
                ),
            )
        merged += 1

    return {"inserted": inserted, "merged": merged, "unchanged": unchanged}


def _refresh_daily_counts(
    conn: sqlite3.Connection,
    affected: Set[Tuple[int, int, str]],
    *,
    dry_run: bool,
) -> int:
    refreshed = 0
    for concept_id, day, community in sorted(affected):
        day_end = day + DAY_SECONDS
        row = conn.execute(
            """
            SELECT COUNT(*) AS mentions,
                   COUNT(DISTINCT author) AS authors
            FROM mi_raw_hits
            WHERE source_community = ?
              AND posted_at >= ?
              AND posted_at < ?
              AND EXISTS (
                  SELECT 1 FROM json_each(mi_raw_hits.matched_concept_ids_json)
                  WHERE json_each.value = ?
              )
            """,
            (community, day, day_end, concept_id),
        ).fetchone()
        mentions = int(row["mentions"] or 0)
        authors = int(row["authors"] or 0)
        if not dry_run:
            conn.execute(
                """
                INSERT INTO concept_daily_counts (
                    concept_id, community, day,
                    mention_count, unique_authors,
                    polarity_mean, intent_mix_json
                )
                VALUES (?, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT(concept_id, community, day) DO UPDATE SET
                    mention_count = excluded.mention_count,
                    unique_authors = excluded.unique_authors
                """,
                (concept_id, community, day, mentions, authors),
            )
        refreshed += 1
    return refreshed


def run(
    *,
    mi_db_path: Path = MI_DB_PATH,
    si_db_path: Path = SI_DB_PATH,
    days_back: int = 7,
    limit: int = 25000,
    platforms: List[str],
    dry_run: bool = False,
    ticker_match: bool = True,
    term_match: bool = True,
    verbose: bool = False,
) -> Dict[str, Any]:
    if not si_db_path.exists():
        print("[social-raw-bridge] social-intelligence.sqlite not found; skipped")
        return {"status": "skipped", "reason": "missing_social_intelligence_db"}

    mi = _connect(mi_db_path)
    si = _connect(si_db_path)
    try:
        _assert_mi_schema(mi)
        concepts = _load_active_concepts(mi)
        concepts_by_ticker = _index_concepts_by_ticker(concepts)
        platform_keys = [p.strip().lower() for p in platforms if p.strip()]

        since_ts = _now_unix() - max(1, days_back) * DAY_SECONDS
        since_iso = datetime.fromtimestamp(since_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        fetched_at = _now_unix()

        social_rows = _fetch_recent_social_posts(si, since_iso=since_iso, platforms=platform_keys, limit=limit)
        normalized: List[Dict[str, Any]] = []
        affected: Set[Tuple[int, int, str]] = set()
        platform_counts: Dict[str, int] = defaultdict(int)
        matched_by_reason = {"ticker": 0, "term": 0}

        for row in social_rows:
            posted_at = _parse_time_to_unix(row["posted_at"])
            if posted_at is None:
                continue
            symbol = str(row["symbol"] or "").strip().upper()
            text = str(row["body_text"] or "").strip()
            matched_ids, reasons = _match_concepts(
                text=text,
                symbol=symbol,
                concepts=concepts,
                concepts_by_ticker=concepts_by_ticker,
                ticker_match=ticker_match,
                term_match=term_match,
            )
            if not matched_ids:
                continue

            if any(r.startswith("ticker:") for r in reasons):
                matched_by_reason["ticker"] += 1
            if any(r.startswith("term:") for r in reasons):
                matched_by_reason["term"] += 1

            platform = str(row["platform"] or "")
            platform_key = platform.strip().lower()
            source_type = _source_type_for_platform(platform)
            source_post_id = f"{row['platform_post_id']}:{symbol}" if symbol else str(row["platform_post_id"])
            community = _source_community(row, platform_key)
            payload = _load_json(row["payload_json"], {})
            raw_payload = {
                "bridge": "social_raw_bridge",
                "source_db": "social-intelligence.sqlite",
                "raw_post_id": row["raw_post_id"],
                "symbol": symbol,
                "platform": platform,
                "match_reasons": reasons,
                "like_count": row["like_count"],
                "reply_count": row["reply_count"],
                "repost_count": row["repost_count"],
                "view_count": row["view_count"],
                "engagement_score": row["engagement_score"],
                "is_reply": row["is_reply"],
                "is_repost": row["is_repost"],
                "payload": payload,
            }

            normalized.append(
                {
                    "source_type": source_type,
                    "source_post_id": source_post_id,
                    "source_thread_id": row["platform_thread_id"],
                    "source_url": row["url"],
                    "source_community": community,
                    "author": row["author_handle"] or row["author_id"],
                    "title": None,
                    "body_text": text,
                    "posted_at": posted_at,
                    "fetched_at": fetched_at,
                    "score": row["like_count"],
                    "comment_count": row["reply_count"],
                    "matched_concept_ids": sorted(matched_ids),
                    "raw_payload_json": json.dumps(raw_payload, separators=(",", ":"), sort_keys=True),
                }
            )
            platform_counts[source_type] += 1
            day = _day_bucket(posted_at)
            for concept_id in matched_ids:
                affected.add((int(concept_id), day, community))

        upserted = _upsert_hits(mi, normalized, dry_run=dry_run)
        refreshed = _refresh_daily_counts(mi, affected, dry_run=dry_run)
        if not dry_run:
            mi.commit()

        summary: Dict[str, Any] = {
            "status": "ok",
            "days_back": days_back,
            "platforms": platform_keys,
            "source_rows_read": len(social_rows),
            "matched_rows": len(normalized),
            "platform_counts": dict(platform_counts),
            "matched_by_reason": matched_by_reason,
            "daily_buckets_refreshed": refreshed,
            **upserted,
            "dry_run": dry_run,
        }
        print(f"[social-raw-bridge] Done. {json.dumps(summary, sort_keys=True)}")
        if verbose and normalized:
            for row in normalized[:20]:
                print(
                    f"  {row['source_type']:22s} {row['source_community']:20s} "
                    f"concepts={row['matched_concept_ids']} post={row['source_post_id']}"
                )
        return summary
    finally:
        mi.close()
        si.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge Social Intelligence raw posts into Market Intelligence mi_raw_hits.")
    parser.add_argument("--mi-db", default=str(MI_DB_PATH))
    parser.add_argument("--si-db", default=str(SI_DB_PATH))
    parser.add_argument("--days-back", type=int, default=7)
    parser.add_argument("--limit", type=int, default=25000, help="Max social_posts_raw rows to scan per platform after date filtering. 0 = no limit.")
    parser.add_argument("--platforms", default="StockTwits,Yahoo Finance,reddit")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-ticker-match", action="store_true")
    parser.add_argument("--no-term-match", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]
    run(
        mi_db_path=Path(args.mi_db),
        si_db_path=Path(args.si_db),
        days_back=args.days_back,
        limit=args.limit,
        platforms=platforms,
        dry_run=args.dry_run,
        ticker_match=not args.no_ticker_match,
        term_match=not args.no_term_match,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
