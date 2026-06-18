#!/usr/bin/env python3
"""Hacker News intraday collector for the Market Intelligence engine.

Phase 2.1 first collector. Concept-keyed (NOT symbol-keyed) — distinct
from backend/scripts/collect_social_intraday.py, which iterates tickers
and stores in social-intelligence.sqlite. This one iterates the
tracked_concepts watchlist and stores in market-intelligence.sqlite, so
we can catch chatter BEFORE it gets ticker-indexed (the whole
social-arbitrage thesis).

Pipeline:
    1. Load active tracked_concepts (id, search_terms[]) from DB.
    2. For each concept, for each search term, query Algolia HN
       search_by_date for stories AND comments since `since_hours` ago.
    3. Build per-post (source_type, source_post_id) -> {matched_concepts}
       map. A single post can match multiple concepts/terms — we merge.
    4. Upsert into mi_raw_hits, idempotent via UNIQUE (source_type,
       source_post_id). matched_concept_ids_json is set/merged.
    5. Rebuild concept_daily_counts for affected (concept_id, day)
       buckets using json_each on matched_concept_ids_json.

Day-bucket convention (matters for downstream baselines/z-scores):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.
    topic_baselines.as_of_day MUST follow the same convention.

LLM-extracted fields (polarity_mean, intent_mix_json) are intentionally
left NULL here. Phase 2.2 (concept extraction) populates them by
re-aggregating concept_mentions over the same daily buckets.

Zero external deps — uses stdlib urllib.request for the HTTP client.

Usage:
    py backend/scripts/collect_hackernews_intraday.py
    py backend/scripts/collect_hackernews_intraday.py --since-hours 6
    py backend/scripts/collect_hackernews_intraday.py --concept-keys ai_compute_shortage,tesla_fsd
    py backend/scripts/collect_hackernews_intraday.py --dry-run
    py backend/scripts/collect_hackernews_intraday.py --max-pages 3
"""

from __future__ import annotations

import argparse
import http.client
import html
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Pattern, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

# Algolia HN. No auth, no rate-limit headers — be polite anyway.
HN_API_BASE = "https://hn.algolia.com/api/v1/search_by_date"
HN_USER_AGENT = "pattern-detector-mi/0.2 (HN intraday collector)"

# source_community is the human-readable bucket key that flows into
# concept_daily_counts.community. Keep it stable — baselines key on it.
HN_COMMUNITY = "hackernews"

# (algolia tag, mi_raw_hits.source_type) pairs we fetch for each term.
HN_PAIRS: List[Tuple[str, str]] = [
    ("story", "hackernews_story"),
    ("comment", "hackernews_comment"),
]


# ============================================================================
# Word-boundary post-filter
# ----------------------------------------------------------------------------
# Algolia's HN search API is high-recall by design: it tokenizes, applies
# typo-tolerance, and matches term prefixes. Searching "RIF" returns posts
# containing "rifle", "rifling", "Riff Raff" etc.; searching "GPT-4" returns
# posts mentioning "GPT" alone. That noise floor is fatal for our z-score
# engine — it inflates daily counts with off-topic posts and makes legitimate
# spikes indistinguishable from baseline drift.
#
# Defense: every Algolia hit gets a second-pass word-boundary regex check
# against the term we queried with. If the title/body don't actually contain
# the term as a standalone token, we drop the attribution. Mirrors the same
# logic used in the 4chan collector (which has the same problem because /biz/
# posts often contain unrelated tickers/terms in the same paragraph).
# ============================================================================

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _compile_term_pattern(term: str) -> Pattern[str]:
    """Case-insensitive word-boundary regex for a single search term.

    Multi-word terms become ordered phrases with flexible internal whitespace
    (matches "AI compute capacity" written as "AI  compute capacity" or
    "AI\tcompute capacity" alike). \\b would be wrong here because some search
    terms contain non-word chars (e.g. "C++"); we use lookaround on \\w which
    correctly treats "+" / "-" as boundaries.
    """
    cleaned = term.strip()
    parts = re.split(r"\s+", cleaned)
    parts_escaped = [re.escape(p) for p in parts if p]
    if not parts_escaped:
        return re.compile(r"(?!x)x")  # match-nothing sentinel
    inner = r"\s+".join(parts_escaped)
    pattern = rf"(?<!\w){inner}(?!\w)"
    return re.compile(pattern, re.IGNORECASE)


def _strip_html(text: Optional[str]) -> str:
    """HN comment_text and story_text come back with embedded <p>, <a>, <i>,
    and HTML entities. Flatten to plain text so word-boundary regex behaves
    predictably (otherwise "<p>RIF</p>" word-boundaries get eaten by tags)."""
    if not text:
        return ""
    flat = (
        text.replace("<p>", " ")
        .replace("</p>", " ")
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("<br />", " ")
    )
    flat = _HTML_TAG_RE.sub(" ", flat)
    flat = html.unescape(flat)
    return _WS_RE.sub(" ", flat).strip()


def _hit_matches_term(
    title: Optional[str],
    body_text: Optional[str],
    term_pattern: Pattern[str],
) -> bool:
    """True iff the term appears as a standalone token in title OR body."""
    title_clean = _strip_html(title)
    body_clean = _strip_html(body_text)
    if title_clean and term_pattern.search(title_clean):
        return True
    if body_clean and term_pattern.search(body_clean):
        return True
    return False


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


def _load_active_concepts(
    conn: sqlite3.Connection,
    *,
    only_keys: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    """Return [{id, concept_key, target_key, search_terms, term_patterns}, ...]
    for active concepts. term_patterns is the precompiled word-boundary regex
    list (same index as search_terms) used to post-filter Algolia hits."""
    rows = conn.execute(
        """
        SELECT id, concept_key, target_key, display_label, metadata_json
        FROM tracked_concepts
        WHERE status = 'active'
        ORDER BY id
        """
    ).fetchall()

    out: List[Dict[str, Any]] = []
    for row_id, concept_key, target_key, display_label, metadata_json in rows:
        if only_keys is not None and concept_key not in only_keys:
            continue
        terms = _extract_search_terms(metadata_json, display_label)
        if not terms:
            continue
        out.append({
            "id": int(row_id),
            "concept_key": concept_key,
            "target_key": target_key,
            "display_label": display_label,
            "search_terms": terms,
            "term_patterns": [_compile_term_pattern(t) for t in terms],
        })
    return out


def _extract_search_terms(
    metadata_json: Optional[str],
    fallback_label: str,
) -> List[str]:
    """Pull metadata.search_terms (preferred) or fall back to display_label."""
    if metadata_json:
        try:
            md = json.loads(metadata_json)
        except (TypeError, ValueError):
            md = None
        if isinstance(md, dict):
            terms = md.get("search_terms")
            if isinstance(terms, list):
                cleaned = [str(t).strip() for t in terms if t and str(t).strip()]
                if cleaned:
                    return cleaned
    label = (fallback_label or "").strip()
    return [label] if label else []


# ============================================================================
# HN HTTP client
# ============================================================================

def _hn_search(
    query: str,
    *,
    tag: str,
    since_unix: int,
    page: int,
    hits_per_page: int,
    timeout: float,
) -> Dict[str, Any]:
    """Single page of the Algolia HN search_by_date endpoint."""
    params = {
        "query": query,
        "tags": tag,
        "numericFilters": f"created_at_i>{since_unix}",
        "hitsPerPage": str(hits_per_page),
        "page": str(page),
    }
    url = f"{HN_API_BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": HN_USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def _iter_hn_pages(
    query: str,
    *,
    tag: str,
    since_unix: int,
    max_pages: int,
    hits_per_page: int,
    timeout: float,
    sleep_ms: int,
) -> Iterable[Dict[str, Any]]:
    """Yield individual hits across up to `max_pages` pages, stopping early
    when a page is empty or the API reports no more pages."""
    for page in range(max_pages):
        payload: Optional[Dict[str, Any]] = None
        for attempt in range(1, 4):
            try:
                payload = _hn_search(
                    query,
                    tag=tag,
                    since_unix=since_unix,
                    page=page,
                    hits_per_page=hits_per_page,
                    timeout=timeout,
                )
                break
            except (
                urllib.error.URLError,
                http.client.RemoteDisconnected,
                TimeoutError,
                OSError,
            ) as err:
                if attempt >= 3:
                    print(
                        f"[hn] WARN: query={query!r} tag={tag} page={page} failed: {err}",
                        file=sys.stderr,
                    )
                    return
                time.sleep(0.5 * attempt)
        if payload is None:
            return
        hits = payload.get("hits") or []
        for hit in hits:
            yield hit
        if not hits:
            return
        nb_pages = payload.get("nbPages")
        if isinstance(nb_pages, int) and page + 1 >= nb_pages:
            return
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)


# ============================================================================
# Hit normalization
# ============================================================================

def _normalize_hit(
    hit: Dict[str, Any],
    source_type: str,
) -> Optional[Dict[str, Any]]:
    """Map an Algolia HN hit -> mi_raw_hits row dict. Returns None if we
    can't get a stable identifier or timestamp."""
    object_id = hit.get("objectID")
    created_at_i = hit.get("created_at_i")
    if object_id is None or created_at_i is None:
        return None
    object_id = str(object_id)
    try:
        posted_at = int(created_at_i)
    except (TypeError, ValueError):
        return None

    if source_type == "hackernews_story":
        thread_id = object_id
        title = hit.get("title")
        body_text = hit.get("story_text")
    else:  # hackernews_comment
        thread_id = (
            str(hit.get("story_id")) if hit.get("story_id") is not None else None
        )
        title = hit.get("story_title")
        body_text = hit.get("comment_text")

    return {
        "source_type": source_type,
        "source_post_id": object_id,
        "source_thread_id": thread_id,
        "source_url": f"https://news.ycombinator.com/item?id={object_id}",
        "source_community": HN_COMMUNITY,
        "author": hit.get("author"),
        "title": title,
        "body_text": body_text,
        "posted_at": posted_at,
        "score": hit.get("points"),
        "comment_count": hit.get("num_comments"),
        "raw_payload_json": json.dumps(hit, separators=(",", ":"), sort_keys=True),
    }


def _day_bucket(posted_at: int) -> int:
    """Unix-epoch midnight UTC for the day containing posted_at."""
    return (int(posted_at) // 86400) * 86400


# ============================================================================
# Persistence
# ============================================================================

def _upsert_hits(
    conn: sqlite3.Connection,
    rows_with_concepts: Dict[Tuple[str, str], Tuple[Dict[str, Any], Set[int]]],
    *,
    fetched_at: int,
    dry_run: bool,
) -> Dict[str, int]:
    """Upsert mi_raw_hits, merging matched_concept_ids_json on conflict.

    rows_with_concepts is keyed by (source_type, source_post_id) and the
    value is (normalized_row, set_of_concept_ids).
    """
    inserted = 0
    merged = 0
    unchanged = 0

    for (source_type, source_post_id), (row, concept_ids) in rows_with_concepts.items():
        existing = conn.execute(
            """
            SELECT id, matched_concept_ids_json
            FROM mi_raw_hits
            WHERE source_type = ? AND source_post_id = ?
            """,
            (source_type, source_post_id),
        ).fetchone()

        new_ids: Set[int] = set(concept_ids)

        if existing is None:
            sorted_ids = sorted(new_ids)
            matched_json = json.dumps(sorted_ids, separators=(",", ":"))
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
                        matched_json,
                        row["raw_payload_json"],
                    ),
                )
            inserted += 1
            continue

        # Existing row — merge concept ids only. Don't touch fetched_at /
        # body_text on a re-run; the post is immutable on HN.
        _existing_id, existing_json = existing
        try:
            existing_ids = set(int(x) for x in (json.loads(existing_json) or []))
        except (TypeError, ValueError):
            existing_ids = set()
        merged_ids = existing_ids | new_ids
        if merged_ids == existing_ids:
            unchanged += 1
            continue
        sorted_merged = sorted(merged_ids)
        matched_json = json.dumps(sorted_merged, separators=(",", ":"))
        if not dry_run:
            conn.execute(
                """
                UPDATE mi_raw_hits
                SET matched_concept_ids_json = ?
                WHERE source_type = ? AND source_post_id = ?
                """,
                (matched_json, source_type, source_post_id),
            )
        merged += 1

    return {"inserted": inserted, "merged": merged, "unchanged": unchanged}


def _refresh_daily_counts(
    conn: sqlite3.Connection,
    affected: Set[Tuple[int, int]],
    *,
    dry_run: bool,
) -> int:
    """Recompute concept_daily_counts for the (concept_id, day) buckets
    touched by this run. Only counts/authors are filled — polarity_mean
    and intent_mix_json stay NULL until the LLM extractor populates
    concept_mentions in Phase 2.2."""
    if not affected:
        return 0

    refreshed = 0
    for concept_id, day in affected:
        day_end = day + 86400
        row = conn.execute(
            """
            SELECT COUNT(*) AS mentions,
                   COUNT(DISTINCT author) AS authors
            FROM mi_raw_hits
            WHERE source_community = ?
              AND posted_at >= ?
              AND posted_at <  ?
              AND EXISTS (
                  SELECT 1 FROM json_each(mi_raw_hits.matched_concept_ids_json)
                  WHERE json_each.value = ?
              )
            """,
            (HN_COMMUNITY, day, day_end, concept_id),
        ).fetchone()
        mentions = int(row[0] or 0)
        authors = int(row[1] or 0)

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
                    mention_count  = excluded.mention_count,
                    unique_authors = excluded.unique_authors
                """,
                (concept_id, HN_COMMUNITY, day, mentions, authors),
            )
        refreshed += 1
    return refreshed


# ============================================================================
# Orchestration
# ============================================================================

def collect(
    *,
    db_path: Path,
    since_hours: int,
    max_pages: int,
    hits_per_page: int,
    only_concept_keys: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)
        concepts = _load_active_concepts(conn, only_keys=only_concept_keys)

        # (source_type, source_post_id) -> (normalized_row, set[concept_id])
        rows_with_concepts: Dict[
            Tuple[str, str], Tuple[Dict[str, Any], Set[int]]
        ] = {}
        affected_buckets: Set[Tuple[int, int]] = set()

        per_concept_counts: List[Dict[str, Any]] = []
        total_api_calls = 0

        total_filter_rejects = 0

        for concept in concepts:
            concept_id = concept["id"]
            concept_key = concept["concept_key"]
            terms = concept["search_terms"]
            term_patterns = concept["term_patterns"]

            concept_total_hits = 0
            concept_filter_rejects = 0
            for term, term_pattern in zip(terms, term_patterns):
                for tag, source_type in HN_PAIRS:
                    total_api_calls += 1
                    for hit in _iter_hn_pages(
                        term,
                        tag=tag,
                        since_unix=since_unix,
                        max_pages=max_pages,
                        hits_per_page=hits_per_page,
                        timeout=request_timeout,
                        sleep_ms=sleep_ms,
                    ):
                        normalized = _normalize_hit(hit, source_type)
                        if normalized is None:
                            continue
                        # Word-boundary post-filter (see header comment for
                        # rationale). Algolia returns prefix/typo-tolerant
                        # matches; we want only standalone-token matches so
                        # the z-score baselines stay meaningful.
                        if not _hit_matches_term(
                            normalized.get("title"),
                            normalized.get("body_text"),
                            term_pattern,
                        ):
                            concept_filter_rejects += 1
                            total_filter_rejects += 1
                            continue
                        key = (
                            normalized["source_type"],
                            normalized["source_post_id"],
                        )
                        if key in rows_with_concepts:
                            rows_with_concepts[key][1].add(concept_id)
                        else:
                            rows_with_concepts[key] = (normalized, {concept_id})
                        affected_buckets.add(
                            (concept_id, _day_bucket(normalized["posted_at"]))
                        )
                        concept_total_hits += 1

            per_concept_counts.append({
                "concept_id": concept_id,
                "concept_key": concept_key,
                "terms": terms,
                "raw_hits_observed": concept_total_hits,
                "filter_rejects": concept_filter_rejects,
            })

        upsert_report = _upsert_hits(
            conn, rows_with_concepts, fetched_at=fetched_at, dry_run=dry_run
        )
        refreshed = _refresh_daily_counts(
            conn, affected_buckets, dry_run=dry_run
        )

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    return {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "since_hours": since_hours,
        "since_unix": since_unix,
        "fetched_at": fetched_at,
        "concepts_processed": len(concepts),
        "api_calls": total_api_calls,
        "raw_hits_seen": sum(p["raw_hits_observed"] for p in per_concept_counts),
        "filter_rejects": total_filter_rejects,
        "unique_posts": len(rows_with_concepts),
        "affected_buckets": len(affected_buckets),
        "daily_counts_refreshed": refreshed,
        "mi_raw_hits": upsert_report,
        "per_concept": per_concept_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Concept-keyed Hacker News collector for Market Intelligence."
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Look back this many hours from now.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=2,
        help="Max Algolia pages per (concept, term, tag). 100 hits/page.",
    )
    parser.add_argument("--hits-per-page", type=int, default=100)
    parser.add_argument(
        "--concept-keys",
        type=str,
        default="",
        help="Comma-separated concept_keys to limit collection (default: all active).",
    )
    parser.add_argument("--request-timeout", type=float, default=10.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        help="Delay between Algolia requests to be a polite client.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    only_keys: Optional[Set[str]] = None
    if args.concept_keys.strip():
        only_keys = {
            k.strip() for k in args.concept_keys.split(",") if k.strip()
        }

    report = collect(
        db_path=args.db_path,
        since_hours=args.since_hours,
        max_pages=args.max_pages,
        hits_per_page=args.hits_per_page,
        only_concept_keys=only_keys,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
