#!/usr/bin/env python3
"""Bluesky intraday collector for the Market Intelligence engine.

Phase 2.1 third collector. Concept-keyed, mirrors
`collect_hackernews_intraday.py` and `collect_fourchan_intraday.py`. Together
they give us 3 distinct source-types ("hackernews", "fourchan", "bluesky") so
the z-score engine has a real multi-source corroboration footprint (PRD D29).

Pipeline:
    1. Load active tracked_concepts (id, search_terms[]) from DB.
    2. For each concept × search_term, query Bluesky's public
       `app.bsky.feed.searchPosts` endpoint with `sort=latest`, paginating
       via `cursor` until either we hit `--max-pages` or the next page's
       earliest `createdAt` falls before `since_unix`.
    3. For each hit, drop posts older than `since_unix` (the public API
       doesn't honour a `since` filter for sort=latest reliably) and apply
       a word-boundary post-filter so "GPT" doesn't match "GPT-4 fan".
    4. Build per-post (source_type, source_post_id) -> {matched_concepts}
       map. A single post can match multiple concepts/terms — we merge.
    5. Upsert into mi_raw_hits, idempotent via UNIQUE (source_type,
       source_post_id). matched_concept_ids_json is set/merged.
    6. Rebuild concept_daily_counts for affected (concept_id, day) buckets
       using the same json_each pattern as the other collectors.

source_type values:
    "bluesky_post"  — every result row from searchPosts (top-level posts AND
                      replies are both classified the same; Bluesky doesn't
                      expose a stable "is reply" flag in search results).

source_community: "bluesky" — matches COMMUNITY_TO_SOURCE_TYPE in
    backend/scripts/run_zscore_engine.py without any further mapping.

source_post_id: the AT-URI of the post (e.g. at://did:plc:xyz/app.bsky.feed.post/3l7f2qabc).
    AT-URIs are globally unique and stable, so they make a perfect idempotency
    key. We persist the full URI (not just the rkey) so we don't collide if
    two different DIDs ever publish the same rkey.

source_url: derived from `author.handle` + the rkey suffix of the AT-URI:
    https://bsky.app/profile/{handle}/post/{rkey}

"Multi-session" note (PRD checklist):
    Bluesky also publishes a real-time WebSocket firehose (com.atproto.sync.
    subscribeRepos) that streams every post on the network — ~5M posts/day.
    We deliberately use the polling search API instead because:
      (a) it slots into the same cron-tick scheduler model as HN/4chan with
          no new long-lived process supervision required;
      (b) tracked-concept search is exactly what searchPosts is built for
          (server-side filtering, no client-side firehose triage);
      (c) the public unauthenticated endpoint is rate-limited to 3000 req /
          5 min per IP, far above what 50-200 concepts need.
    A firehose consumer is a Phase 5 upgrade IF we ever need lower latency
    or the ability to backfill posts that mention low-frequency keywords
    Bluesky's search index missed. For now, polling is fine.

Day-bucket convention (matters for downstream baselines/z-scores):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.
    topic_baselines.as_of_day MUST follow the same convention.

LLM-extracted fields (polarity_mean, intent_mix_json) are intentionally
left NULL here. Phase 2.2 (concept extraction) populates them by
re-aggregating concept_mentions over the same daily buckets.

Zero external deps — uses stdlib urllib.request for the HTTP client.

Usage:
    py backend/scripts/collect_bluesky_intraday.py
    py backend/scripts/collect_bluesky_intraday.py --since-hours 6
    py backend/scripts/collect_bluesky_intraday.py --concept-keys ai_compute_shortage,tesla_fsd
    py backend/scripts/collect_bluesky_intraday.py --dry-run
    py backend/scripts/collect_bluesky_intraday.py --max-pages 3

Output: JSON report on stdout (same envelope as the HN/4chan collectors, so
the existing /collectors/:source_type/run wiring can JSON.parse it directly).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Pattern, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

# AT Protocol XRPC endpoints.
#   Unauthenticated (frequently throttled to 403 by Bluesky as of 2025-2026):
#     https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts
#   Authenticated (recommended for steady-state polling):
#     https://bsky.social/xrpc/com.atproto.server.createSession  -> JWT
#     https://bsky.social/xrpc/app.bsky.feed.searchPosts  -> Authorization: Bearer
#
# Bluesky's docs note: "This endpoint may require authentication (eg, not
# public) for some service providers and implementations."
#   https://docs.bsky.app/docs/api/app-bsky-feed-search-posts
# In practice the public AppView returns 403 for searchPosts almost
# constantly because of bot abuse during peak growth periods. The
# authenticated PDS endpoint is the only reliable path for our use case
# (https://github.com/bluesky-social/atproto/issues/2838,
# https://github.com/bluesky-social/bsky-docs/issues/332).
BSKY_PUBLIC_BASE = "https://public.api.bsky.app/xrpc"
BSKY_PDS_BASE = "https://bsky.social/xrpc"
BSKY_SEARCH_PATH = "app.bsky.feed.searchPosts"
BSKY_CREATE_SESSION_PATH = "com.atproto.server.createSession"
BSKY_REFRESH_SESSION_PATH = "com.atproto.server.refreshSession"
BSKY_USER_AGENT = "pattern-detector-mi/0.2 (Bluesky intraday collector)"

# Operator credentials. Created in the Bluesky web UI under Settings →
# Privacy and Security → App Passwords. These are revocable
# 19-character tokens scoped to API access; the operator's main password
# never leaves the local env.
BSKY_HANDLE_ENV = "BSKY_HANDLE"
BSKY_APP_PASSWORD_ENV = "BSKY_APP_PASSWORD"

# source_community is the human-readable bucket key that flows into
# concept_daily_counts.community. "bluesky" is what COMMUNITY_TO_SOURCE_TYPE
# expects so the z-score engine collapses it correctly.
BSKY_COMMUNITY = "bluesky"

# Single source_type — Bluesky doesn't distinguish OPs from replies in
# search results in a stable way, so we lump them together.
BSKY_SOURCE_TYPE = "bluesky_post"


# ============================================================================
# Word-boundary post-filter
# ----------------------------------------------------------------------------
# Bluesky's search does tokenisation + stemming + handle/hashtag indexing,
# which makes it high-recall but not term-precise: searching "RIF" can return
# posts mentioning "rifle" or "@rif.bsky.social". Same defence as the HN and
# 4chan collectors — every hit gets a second-pass word-boundary regex check
# against the term we queried with. Lookaround on \w correctly treats "+",
# "-" and "#" as boundaries (so "C++" and "$NVDA" tokens still match).
# ============================================================================

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _compile_term_pattern(term: str) -> Pattern[str]:
    cleaned = term.strip()
    parts = re.split(r"\s+", cleaned)
    parts_escaped = [re.escape(p) for p in parts if p]
    if not parts_escaped:
        return re.compile(r"(?!x)x")  # match-nothing sentinel
    inner = r"\s+".join(parts_escaped)
    pattern = rf"(?<!\w){inner}(?!\w)"
    return re.compile(pattern, re.IGNORECASE)


def _strip_text(text: Optional[str]) -> str:
    """Bluesky post text is usually plain UTF-8 (no embedded HTML), but
    callers occasionally include link facets that render as bare URLs. We
    still HTML-unescape and collapse whitespace so word-boundary matching
    is consistent with the HN flow."""
    if not text:
        return ""
    flat = _HTML_TAG_RE.sub(" ", text)
    flat = html.unescape(flat)
    return _WS_RE.sub(" ", flat).strip()


def _hit_matches_term(text: Optional[str], term_pattern: Pattern[str]) -> bool:
    cleaned = _strip_text(text)
    if not cleaned:
        return False
    return bool(term_pattern.search(cleaned))


# ============================================================================
# DB helpers — copied verbatim from the HN collector for consistency
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
# Bluesky HTTP client (with optional authenticated session)
# ============================================================================


class BskySession:
    """Holds the AT Protocol JWT pair returned by createSession.

    `access_jwt` is short-lived (~120 minutes); `refresh_jwt` is good for
    weeks but NOT renewable indefinitely — operators should regenerate the
    app password periodically. We refresh access tokens on 401 to keep
    long-running collector ticks resilient.
    """

    def __init__(
        self,
        *,
        access_jwt: str,
        refresh_jwt: str,
        did: str,
        handle: str,
    ) -> None:
        self.access_jwt = access_jwt
        self.refresh_jwt = refresh_jwt
        self.did = did
        self.handle = handle


def _bsky_create_session(
    handle: str,
    app_password: str,
    *,
    timeout: float,
) -> BskySession:
    body = json.dumps(
        {"identifier": handle, "password": app_password},
        separators=(",", ":"),
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BSKY_PDS_BASE}/{BSKY_CREATE_SESSION_PATH}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": BSKY_USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return BskySession(
        access_jwt=str(payload["accessJwt"]),
        refresh_jwt=str(payload["refreshJwt"]),
        did=str(payload.get("did", "")),
        handle=str(payload.get("handle", handle)),
    )


def _bsky_refresh_session(
    session: BskySession,
    *,
    timeout: float,
) -> BskySession:
    req = urllib.request.Request(
        f"{BSKY_PDS_BASE}/{BSKY_REFRESH_SESSION_PATH}",
        method="POST",
        headers={
            "Authorization": f"Bearer {session.refresh_jwt}",
            "User-Agent": BSKY_USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return BskySession(
        access_jwt=str(payload["accessJwt"]),
        refresh_jwt=str(payload["refreshJwt"]),
        did=session.did,
        handle=session.handle,
    )


def _bsky_search(
    query: str,
    *,
    cursor: Optional[str],
    limit: int,
    timeout: float,
    session: Optional[BskySession],
) -> Dict[str, Any]:
    """Single page of `app.bsky.feed.searchPosts`.

    `sort=latest` returns most recent posts first, which is what we want for
    intraday polling (we stop paginating once we cross `since_unix`). When
    `session` is provided, hits the authenticated PDS endpoint; otherwise
    falls back to the public AppView (which Bluesky frequently 403s).
    """
    params: Dict[str, str] = {
        "q": query,
        "sort": "latest",
        "limit": str(limit),
    }
    if cursor:
        params["cursor"] = cursor

    if session is not None:
        base = BSKY_PDS_BASE
        auth_header = {"Authorization": f"Bearer {session.access_jwt}"}
    else:
        base = BSKY_PUBLIC_BASE
        auth_header = {}

    url = f"{base}/{BSKY_SEARCH_PATH}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": BSKY_USER_AGENT,
            "Accept": "application/json",
            **auth_header,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def _iter_bsky_pages(
    query: str,
    *,
    since_unix: int,
    max_pages: int,
    limit: int,
    timeout: float,
    sleep_ms: int,
    session: Optional[BskySession],
    on_session_refresh: Optional[Any] = None,
) -> Iterable[Dict[str, Any]]:
    """Yield individual posts across up to `max_pages` pages, stopping early
    when (a) the API returns no posts, (b) the page's earliest createdAt
    falls before `since_unix` (we're past the lookback window), or (c) the
    cursor stops advancing."""
    cursor: Optional[str] = None
    for page in range(max_pages):
        try:
            payload = _bsky_search(
                query,
                cursor=cursor,
                limit=limit,
                timeout=timeout,
                session=session,
            )
        except urllib.error.HTTPError as err:
            # 401 means our access JWT expired mid-collection. Try to refresh
            # once with the refresh JWT and retry the same page; if that also
            # fails we bail out gracefully.
            if (
                err.code == 401
                and session is not None
                and on_session_refresh is not None
            ):
                try:
                    new_session = _bsky_refresh_session(session, timeout=timeout)
                    on_session_refresh(new_session)
                    session = new_session
                    payload = _bsky_search(
                        query,
                        cursor=cursor,
                        limit=limit,
                        timeout=timeout,
                        session=session,
                    )
                except (urllib.error.HTTPError, urllib.error.URLError) as refresh_err:
                    print(
                        f"[bsky] WARN: refreshSession after 401 failed for "
                        f"query={query!r}: {refresh_err}",
                        file=sys.stderr,
                    )
                    return
            else:
                # 400 from Bluesky on certain edge-case queries (e.g. only
                # punctuation), 403 from the public endpoint when throttled.
                # Log and bail rather than crashing the whole run.
                print(
                    f"[bsky] WARN: query={query!r} cursor={cursor!r} "
                    f"page={page} HTTP {err.code}: {err.reason}",
                    file=sys.stderr,
                )
                return
        except urllib.error.URLError as err:
            print(
                f"[bsky] WARN: query={query!r} cursor={cursor!r} "
                f"page={page} failed: {err}",
                file=sys.stderr,
            )
            return

        posts = payload.get("posts") or []
        if not posts:
            return

        crossed_window = False
        for post in posts:
            yield post
            posted_at = _post_created_at(post)
            if posted_at is not None and posted_at < since_unix:
                crossed_window = True

        if crossed_window:
            # The last post on this page is older than our lookback. There's
            # no point paginating further (sort=latest is monotonic).
            return

        next_cursor = payload.get("cursor")
        if not isinstance(next_cursor, str) or not next_cursor:
            return
        if next_cursor == cursor:
            return
        cursor = next_cursor

        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)


# ============================================================================
# Hit normalisation
# ============================================================================


def _post_created_at(post: Dict[str, Any]) -> Optional[int]:
    """Return record.createdAt as a unix timestamp, or None on bad input.

    Bluesky uses ISO 8601 with optional fractional seconds and a trailing
    'Z' for UTC, e.g. '2026-04-27T15:23:45.123Z'. fromisoformat() in 3.10
    chokes on 'Z' so we normalise it to '+00:00'.
    """
    record = post.get("record")
    if not isinstance(record, dict):
        return None
    created = record.get("createdAt")
    if not isinstance(created, str) or not created:
        return None
    iso = created.replace("Z", "+00:00")
    try:
        dt = _dt.datetime.fromisoformat(iso)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return int(dt.timestamp())


def _at_uri_rkey(uri: str) -> Optional[str]:
    """Extract the record key (last segment) from an at:// URI."""
    if not uri or not uri.startswith("at://"):
        return None
    parts = uri.split("/")
    return parts[-1] if parts else None


def _build_post_url(post: Dict[str, Any], uri: str) -> Optional[str]:
    """Build a public bsky.app web URL for the post.

    Format: https://bsky.app/profile/{handle}/post/{rkey}
    Falls back to the DID form if the handle is missing/inactive.
    """
    rkey = _at_uri_rkey(uri)
    if not rkey:
        return None
    author = post.get("author")
    handle = None
    did = None
    if isinstance(author, dict):
        handle = author.get("handle")
        did = author.get("did")
    identifier = handle if isinstance(handle, str) and handle else did
    if not isinstance(identifier, str) or not identifier:
        return None
    return f"https://bsky.app/profile/{identifier}/post/{rkey}"


def _normalize_post(post: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map a searchPosts hit -> mi_raw_hits row dict. Returns None if we
    can't get a stable identifier or timestamp."""
    uri = post.get("uri")
    if not isinstance(uri, str) or not uri:
        return None
    posted_at = _post_created_at(post)
    if posted_at is None:
        return None

    record = post.get("record")
    body_text: Optional[str] = None
    if isinstance(record, dict):
        text = record.get("text")
        if isinstance(text, str):
            body_text = text

    author_label: Optional[str] = None
    author = post.get("author")
    if isinstance(author, dict):
        handle = author.get("handle")
        did = author.get("did")
        if isinstance(handle, str) and handle:
            author_label = handle
        elif isinstance(did, str) and did:
            author_label = did

    # Engagement metrics — Bluesky exposes likeCount/repostCount/replyCount.
    # We use likeCount as the closest equivalent to HN points; replyCount maps
    # naturally to comment_count.
    score = post.get("likeCount")
    comment_count = post.get("replyCount")

    return {
        "source_type": BSKY_SOURCE_TYPE,
        "source_post_id": uri,
        # Bluesky doesn't expose a stable "thread root" in search results
        # (would need a follow-up getPostThread call). Leave NULL for v1.
        "source_thread_id": None,
        "source_url": _build_post_url(post, uri),
        "source_community": BSKY_COMMUNITY,
        "author": author_label,
        # No title concept on Bluesky — body carries everything.
        "title": None,
        "body_text": body_text,
        "posted_at": posted_at,
        "score": int(score) if isinstance(score, (int, float)) else None,
        "comment_count": (
            int(comment_count) if isinstance(comment_count, (int, float)) else None
        ),
        "raw_payload_json": json.dumps(post, separators=(",", ":"), sort_keys=True),
    }


def _day_bucket(posted_at: int) -> int:
    return (int(posted_at) // 86400) * 86400


# ============================================================================
# Persistence — same upsert + count refresh logic as the HN collector
# ============================================================================


def _upsert_hits(
    conn: sqlite3.Connection,
    rows_with_concepts: Dict[Tuple[str, str], Tuple[Dict[str, Any], Set[int]]],
    *,
    fetched_at: int,
    dry_run: bool,
) -> Dict[str, int]:
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

        # Existing row — merge concept ids only. Bluesky engagement counts
        # (likeCount/replyCount) DO drift over time, but we deliberately
        # don't update them on a re-run to keep mi_raw_hits append-only and
        # avoid silent baseline drift. The first-fetch snapshot is the one
        # that flows into concept_daily_counts.
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
            (BSKY_COMMUNITY, day, day_end, concept_id),
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
                (concept_id, BSKY_COMMUNITY, day, mentions, authors),
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
    page_size: int,
    only_concept_keys: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
    bsky_handle: Optional[str] = None,
    bsky_app_password: Optional[str] = None,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    # Create authenticated session if credentials supplied. The public
    # endpoint is so frequently 403'd that running without auth is mostly
    # for offline smoke testing — the scheduler should always set
    # BSKY_HANDLE / BSKY_APP_PASSWORD in the env.
    session: Optional[BskySession] = None
    auth_mode = "unauthenticated"
    auth_error: Optional[str] = None
    if bsky_handle and bsky_app_password:
        try:
            session = _bsky_create_session(
                bsky_handle, bsky_app_password, timeout=request_timeout
            )
            auth_mode = "authenticated"
        except (urllib.error.HTTPError, urllib.error.URLError) as err:
            auth_error = f"createSession failed: {err}"
            print(f"[bsky] WARN: {auth_error}", file=sys.stderr)

    # Mutable holder so the iterator's 401-refresh path can update the JWT
    # in-place across pages without us threading session through every layer.
    session_holder: Dict[str, Optional[BskySession]] = {"current": session}

    def _on_refresh(new_session: BskySession) -> None:
        session_holder["current"] = new_session

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)
        concepts = _load_active_concepts(conn, only_keys=only_concept_keys)

        rows_with_concepts: Dict[
            Tuple[str, str], Tuple[Dict[str, Any], Set[int]]
        ] = {}
        affected_buckets: Set[Tuple[int, int]] = set()

        per_concept_counts: List[Dict[str, Any]] = []
        total_api_calls = 0
        total_filter_rejects = 0
        total_window_rejects = 0

        for concept in concepts:
            concept_id = concept["id"]
            concept_key = concept["concept_key"]
            terms = concept["search_terms"]
            term_patterns = concept["term_patterns"]

            concept_total_hits = 0
            concept_filter_rejects = 0
            concept_window_rejects = 0
            for term, term_pattern in zip(terms, term_patterns):
                total_api_calls += 1
                for post in _iter_bsky_pages(
                    term,
                    since_unix=since_unix,
                    max_pages=max_pages,
                    limit=page_size,
                    timeout=request_timeout,
                    sleep_ms=sleep_ms,
                    session=session_holder["current"],
                    on_session_refresh=_on_refresh,
                ):
                    normalized = _normalize_post(post)
                    if normalized is None:
                        continue
                    if normalized["posted_at"] < since_unix:
                        # Page extended into the past — drop the tail and
                        # keep going (the iterator already short-circuits
                        # subsequent pages).
                        concept_window_rejects += 1
                        total_window_rejects += 1
                        continue
                    if not _hit_matches_term(
                        normalized.get("body_text"), term_pattern
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
                "window_rejects": concept_window_rejects,
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
        "auth_mode": auth_mode,
        "auth_error": auth_error,
        "raw_hits_seen": sum(p["raw_hits_observed"] for p in per_concept_counts),
        "filter_rejects": total_filter_rejects,
        "window_rejects": total_window_rejects,
        "unique_posts": len(rows_with_concepts),
        "affected_buckets": len(affected_buckets),
        "daily_counts_refreshed": refreshed,
        "mi_raw_hits": upsert_report,
        "per_concept": per_concept_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Concept-keyed Bluesky collector for Market Intelligence."
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
        default=3,
        help="Max searchPosts pages per (concept, term). 100 hits/page.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Bluesky searchPosts limit per request (max 100).",
    )
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
        default=300,
        help="Delay between Bluesky requests to be a polite client. The "
             "public endpoint allows 3000 req / 5 min per IP, which is "
             "300/min, so 300ms is the natural floor.",
    )
    parser.add_argument(
        "--bsky-handle",
        type=str,
        default=None,
        help=(
            f"Bluesky handle for authenticated session. Falls back to "
            f"${BSKY_HANDLE_ENV} env var. Required for any reliable "
            f"production polling — the unauthenticated public endpoint is "
            f"frequently 403'd by Bluesky's anti-abuse layer."
        ),
    )
    parser.add_argument(
        "--bsky-app-password",
        type=str,
        default=None,
        help=(
            f"Bluesky app password (NOT the main account password). "
            f"Falls back to ${BSKY_APP_PASSWORD_ENV} env var. Generate at "
            f"Settings → Privacy and Security → App Passwords in the "
            f"Bluesky web UI; tokens are revocable and limited to API access."
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    bsky_handle = (args.bsky_handle or os.environ.get(BSKY_HANDLE_ENV) or "").strip()
    bsky_app_password = (
        args.bsky_app_password
        or os.environ.get(BSKY_APP_PASSWORD_ENV)
        or ""
    ).strip()

    if args.page_size < 1 or args.page_size > 100:
        print(
            f"--page-size must be between 1 and 100 (got {args.page_size})",
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
        max_pages=args.max_pages,
        page_size=args.page_size,
        only_concept_keys=only_keys,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
        bsky_handle=bsky_handle or None,
        bsky_app_password=bsky_app_password or None,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
