#!/usr/bin/env python3
"""4chan intraday collector for the Market Intelligence engine.

Phase 2.1 second collector. Concept-keyed (mirrors
collect_hackernews_intraday.py). Together with HN this gives us 2 distinct
source-types ("hackernews" and "fourchan") so the z-score engine can fire
its `cross_platform_corroboration` flag — the whole point of being
multi-source.

Pipeline:
    1. Load active tracked_concepts (id, search_terms[]) from DB.
    2. For each board in --boards (default: biz, g):
       - Fetch GET https://a.4cdn.org/{board}/catalog.json (single request).
       - The catalog response embeds every thread OP plus its `last_replies`
         array (3-5 most recent replies). We scan both as separate mi_raw_hits
         rows so a single board fetch yields ~150 OPs + ~600 recent replies.
       - For each post, lowercase-substring-match its `sub`+`com` (HTML
         stripped) against every concept's search_terms. A post can match
         multiple concepts — we merge.
    3. Filter posts to time >= since_unix.
    4. Upsert into mi_raw_hits, idempotent via UNIQUE (source_type,
       source_post_id). matched_concept_ids_json is set/merged.
    5. Rebuild concept_daily_counts for affected (concept_id, day) buckets
       using the same json_each pattern as the HN collector.

Day-bucket convention (matters for downstream baselines/z-scores):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.
    topic_baselines.as_of_day MUST follow the same convention.

source_community values:
    "/biz/" and "/g/" — these match COMMUNITY_TO_SOURCE_TYPE in
    backend/scripts/run_zscore_engine.py, which collapses both to
    source-type "fourchan" for cross-platform corroboration math.

source_type values:
    "fourchan_op"     — thread OP from catalog
    "fourchan_reply"  — preview reply from catalog `last_replies` array

Author note:
    Most 4chan posters identify as "Anonymous", so unique_authors counts will
    be low/uninformative on /biz/, /g/. The z-score engine weights mention
    counts more heavily; this is fine for v1.

Zero external deps — uses stdlib urllib.request for the HTTP client.

Usage:
    py backend/scripts/collect_fourchan_intraday.py
    py backend/scripts/collect_fourchan_intraday.py --since-hours 6
    py backend/scripts/collect_fourchan_intraday.py --boards biz,g
    py backend/scripts/collect_fourchan_intraday.py --concept-keys ai_compute_shortage,tesla_fsd
    py backend/scripts/collect_fourchan_intraday.py --dry-run

Output: JSON report on stdout (same envelope as the HN collector, so the
existing /collectors/:source_type/run wiring can JSON.parse it directly).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 3

# 4chan publishes its API contract here:
#   https://github.com/4chan/4chan-API
# No auth, no rate-limit headers — they ask for >= 1s between requests.
FOURCHAN_API_BASE = "https://a.4cdn.org"
FOURCHAN_USER_AGENT = "pattern-detector-mi/0.2 (4chan intraday collector)"

# Default boards. PRD calls out /biz/ (markets/crypto) and /g/ (technology)
# as the two relevant social-arbitrage signal sources. Skip /pol/ for v1
# (signal-to-noise too low for tracked-concept matching).
DEFAULT_BOARDS: Tuple[str, ...] = ("biz", "g")


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
    """Return [{id, concept_key, target_key, search_terms}, ...] for active concepts."""
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
            # Compile word-boundary regexes once so the inner matching loop
            # is hot-path cheap. Word boundaries are critical: without them,
            # short terms like "RIF" (a tech_layoffs term) match "terRIFied"
            # and produce nonsense corroborations.
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
# 4chan HTTP client
# ============================================================================

def _fetch_catalog(
    board: str,
    *,
    timeout: float,
) -> List[Dict[str, Any]]:
    """Single GET against /{board}/catalog.json. Returns the raw page-keyed array."""
    url = f"{FOURCHAN_API_BASE}/{board}/catalog.json"
    req = urllib.request.Request(url, headers={"User-Agent": FOURCHAN_USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    payload = json.loads(body)
    if not isinstance(payload, list):
        return []
    return payload


def _iter_catalog_posts(
    catalog: List[Dict[str, Any]],
    board: str,
) -> Iterable[Tuple[str, Dict[str, Any], int]]:
    """Yield (kind, post, thread_id) tuples for every OP and every embedded
    last_replies post in a catalog response.

    kind is "op" or "reply"."""
    for page in catalog:
        if not isinstance(page, dict):
            continue
        threads = page.get("threads")
        if not isinstance(threads, list):
            continue
        for thread in threads:
            if not isinstance(thread, dict):
                continue
            op_no = thread.get("no")
            if not isinstance(op_no, int):
                continue
            yield ("op", thread, op_no)
            replies = thread.get("last_replies") or []
            if not isinstance(replies, list):
                continue
            for reply in replies:
                if isinstance(reply, dict):
                    yield ("reply", reply, op_no)


# ============================================================================
# HTML / matching helpers
# ============================================================================

# 4chan `com` fields are HTML fragments. Strip down to a flat text string
# before we try substring-matching concept search_terms.
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _compile_term_pattern(term: str) -> "re.Pattern[str]":
    """Compile a case-insensitive word-boundary regex for a single search
    term. Multi-word terms are matched as ordered phrases, with internal
    whitespace allowed to vary (matches the same phrase whether posters
    typed it with single, double, or hyphen-separated spacing).

    Word-boundary matching is essential: "RIF" (a tech_layoffs term) without
    boundaries would match "terRIFied", "RIFle", etc. With \\b on each side
    "RIF" only matches the standalone token."""
    cleaned = term.strip()
    parts = re.split(r"\s+", cleaned)
    parts_escaped = [re.escape(p) for p in parts if p]
    if not parts_escaped:
        # Fallback for weird inputs — match nothing.
        return re.compile(r"(?!x)x")
    inner = r"\s+".join(parts_escaped)
    pattern = rf"(?<!\w){inner}(?!\w)"
    return re.compile(pattern, re.IGNORECASE)


def _strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    # Normalize <br> to spaces first so word boundaries don't get mashed.
    flat = text.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    flat = _TAG_RE.sub(" ", flat)
    flat = html.unescape(flat)
    return _WS_RE.sub(" ", flat).strip()


def _build_match_corpus(post: Dict[str, Any]) -> str:
    """Concatenate the post's subject and stripped body into a single
    haystack for word-boundary regex matching. Case-folding happens inside
    the compiled regex (re.IGNORECASE), so we don't lower-case here."""
    sub = (post.get("sub") or "").strip()
    body = _strip_html(post.get("com"))
    if sub and body:
        return f"{sub} {body}"
    return sub or body


def _build_author_label(post: Dict[str, Any]) -> str:
    """Most posts are 'Anonymous'. Tripcodes give us a stable handle when
    present. Posts with poster IDs (some boards enable them) are also useful."""
    name = (post.get("name") or "Anonymous").strip()
    trip = (post.get("trip") or "").strip()
    poster_id = (post.get("id") or "").strip()
    if trip:
        return f"{name}{trip}"
    if poster_id:
        return f"{name}#{poster_id}"
    return name or "Anonymous"


def _post_url(board: str, thread_id: int, post_id: int) -> str:
    """Permalink to the post. boards.4chan.org follows the pattern
    /{board}/thread/{thread_id}#p{post_id}."""
    if post_id == thread_id:
        return f"https://boards.4chan.org/{board}/thread/{thread_id}"
    return f"https://boards.4chan.org/{board}/thread/{thread_id}#p{post_id}"


# ============================================================================
# Hit normalization
# ============================================================================

def _normalize_post(
    post: Dict[str, Any],
    *,
    kind: str,
    board: str,
    thread_id: int,
) -> Optional[Dict[str, Any]]:
    """Map a 4chan catalog post -> mi_raw_hits row dict. Returns None if
    we can't get a stable identifier, timestamp, or any text content."""
    no = post.get("no")
    posted_at = post.get("time")
    if not isinstance(no, int) or not isinstance(posted_at, int):
        return None

    body_text = _strip_html(post.get("com"))
    title = (post.get("sub") or "").strip() or None

    # If neither subject nor body has any content there is nothing to match
    # against and nothing useful to store. Skip.
    if not title and not body_text:
        return None

    source_type = "fourchan_op" if kind == "op" else "fourchan_reply"

    return {
        "source_type": source_type,
        "source_post_id": str(no),
        "source_thread_id": str(thread_id),
        "source_url": _post_url(board, thread_id, no),
        # Use /board/ form so it lines up with COMMUNITY_TO_SOURCE_TYPE in
        # run_zscore_engine.py without any further mapping.
        "source_community": f"/{board}/",
        "author": _build_author_label(post),
        "title": title,
        "body_text": body_text or None,
        "posted_at": int(posted_at),
        # 4chan replies don't expose individual scores. OPs expose `replies`
        # and `images` counts; we map the former into `comment_count` so
        # downstream UI/analytics has a popularity proxy.
        "score": None,
        "comment_count": post.get("replies") if kind == "op" else None,
        # Strip the (huge) `last_replies` from raw_payload to avoid
        # double-storing reply bodies — they get their own mi_raw_hits rows.
        "raw_payload_json": json.dumps(
            {k: v for k, v in post.items() if k != "last_replies"},
            separators=(",", ":"),
            sort_keys=True,
        ),
    }


def _day_bucket(posted_at: int) -> int:
    """Unix-epoch midnight UTC for the day containing posted_at."""
    return (int(posted_at) // 86400) * 86400


def _match_concepts(
    haystack: str,
    concepts: List[Dict[str, Any]],
) -> Set[int]:
    """Return the set of concept IDs whose any search_term word-boundary-
    matches the haystack. Empty haystacks match nothing."""
    if not haystack:
        return set()
    matched: Set[int] = set()
    for concept in concepts:
        for pattern in concept["term_patterns"]:
            if pattern.search(haystack):
                matched.add(concept["id"])
                break
    return matched


# ============================================================================
# Persistence (mirrors collect_hackernews_intraday.py exactly)
# ============================================================================

def _upsert_hits(
    conn: sqlite3.Connection,
    rows_with_concepts: Dict[Tuple[str, str], Tuple[Dict[str, Any], Set[int]]],
    *,
    fetched_at: int,
    dry_run: bool,
) -> Dict[str, int]:
    """Upsert mi_raw_hits, merging matched_concept_ids_json on conflict."""
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

        # Existing row — merge concept ids only. 4chan posts are immutable
        # in practice (edits don't exist), so we don't refresh body_text.
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
    affected: Set[Tuple[int, int, str]],
    *,
    dry_run: bool,
) -> int:
    """Recompute concept_daily_counts for the (concept_id, day, community)
    buckets touched by this run.

    Note: keyed by community here (not just concept_id, day) — unlike the
    HN collector — because a single 4chan run touches /biz/ AND /g/ and
    those are distinct community baselines."""
    if not affected:
        return 0

    refreshed = 0
    for concept_id, day, community in affected:
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
            (community, day, day_end, concept_id),
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
                (concept_id, community, day, mentions, authors),
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
    boards: Tuple[str, ...],
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
        # concept_id, day, community
        affected_buckets: Set[Tuple[int, int, str]] = set()

        per_board_stats: List[Dict[str, Any]] = []
        total_api_calls = 0

        if not concepts:
            print(
                "[fourchan] WARN: no active tracked_concepts with search_terms — "
                "nothing to match against.",
                file=sys.stderr,
            )

        for i, board in enumerate(boards):
            if i > 0 and sleep_ms > 0:
                # 4chan asks for >= 1s between requests. sleep_ms default
                # of 1000 satisfies this; allow override only via --sleep-ms.
                time.sleep(sleep_ms / 1000.0)

            total_api_calls += 1
            posts_seen = 0
            posts_after_time_filter = 0
            matched_posts = 0

            try:
                catalog = _fetch_catalog(board, timeout=request_timeout)
            except urllib.error.URLError as err:
                print(
                    f"[fourchan] WARN: catalog /{board}/ failed: {err}",
                    file=sys.stderr,
                )
                per_board_stats.append({
                    "board": board,
                    "error": str(err),
                    "posts_seen": 0,
                    "posts_after_time_filter": 0,
                    "matched_posts": 0,
                })
                continue
            except (json.JSONDecodeError, ValueError) as err:
                print(
                    f"[fourchan] WARN: catalog /{board}/ returned non-JSON: {err}",
                    file=sys.stderr,
                )
                per_board_stats.append({
                    "board": board,
                    "error": f"json_decode: {err}",
                    "posts_seen": 0,
                    "posts_after_time_filter": 0,
                    "matched_posts": 0,
                })
                continue

            for kind, post, thread_id in _iter_catalog_posts(catalog, board):
                posts_seen += 1
                posted_at = post.get("time")
                if not isinstance(posted_at, int) or posted_at < since_unix:
                    continue
                posts_after_time_filter += 1

                haystack = _build_match_corpus(post)
                concept_ids = _match_concepts(haystack, concepts)
                if not concept_ids:
                    continue

                normalized = _normalize_post(
                    post, kind=kind, board=board, thread_id=thread_id
                )
                if normalized is None:
                    continue

                key = (
                    normalized["source_type"],
                    normalized["source_post_id"],
                )
                if key in rows_with_concepts:
                    rows_with_concepts[key][1].update(concept_ids)
                else:
                    rows_with_concepts[key] = (normalized, set(concept_ids))

                day = _day_bucket(normalized["posted_at"])
                community = normalized["source_community"]
                for cid in concept_ids:
                    affected_buckets.add((cid, day, community))
                matched_posts += 1

            per_board_stats.append({
                "board": board,
                "posts_seen": posts_seen,
                "posts_after_time_filter": posts_after_time_filter,
                "matched_posts": matched_posts,
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
        "boards": list(boards),
        "concepts_processed": len(concepts),
        "api_calls": total_api_calls,
        "raw_hits_seen": sum(
            p.get("matched_posts", 0) for p in per_board_stats
        ),
        "unique_posts": len(rows_with_concepts),
        "affected_buckets": len(affected_buckets),
        "daily_counts_refreshed": refreshed,
        "mi_raw_hits": upsert_report,
        "per_board": per_board_stats,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Concept-keyed 4chan catalog collector for Market Intelligence."
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Only ingest posts created within the last N hours.",
    )
    parser.add_argument(
        "--boards",
        type=str,
        default=",".join(DEFAULT_BOARDS),
        help="Comma-separated list of board codes (no slashes). Default: biz,g.",
    )
    parser.add_argument(
        "--concept-keys",
        type=str,
        default="",
        help="Comma-separated concept_keys to limit collection (default: all active).",
    )
    parser.add_argument("--request-timeout", type=float, default=15.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=1000,
        help="Delay between board catalog fetches. 4chan asks for >= 1000ms.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    boards_clean: List[str] = [
        b.strip().strip("/").lower()
        for b in args.boards.split(",")
        if b.strip()
    ]
    if not boards_clean:
        print(
            "[fourchan] ERROR: --boards resolved to an empty list. "
            "Pass at least one board (e.g. --boards biz,g).",
            file=sys.stderr,
        )
        return 2

    only_keys: Optional[Set[str]] = None
    if args.concept_keys.strip():
        only_keys = {
            k.strip() for k in args.concept_keys.split(",") if k.strip()
        }

    report = collect(
        db_path=args.db_path,
        since_hours=args.since_hours,
        boards=tuple(boards_clean),
        only_concept_keys=only_keys,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
