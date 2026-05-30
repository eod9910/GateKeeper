#!/usr/bin/env python3
"""Niche-forums intraday collector for the Market Intelligence engine.

Phase 2.1 fourth collector. Concept-keyed, mirrors
`collect_hackernews_intraday.py`, `collect_fourchan_intraday.py`, and
`collect_bluesky_intraday.py`. This one reads RSS/Atom feeds from
hand-picked enthusiast forums where genuine product discussion lives —
the kind of corner where an audiophile, audio engineer, or watch
collector talks about real workflow pain a week before it hits Reddit
or Twitter (PRD D08 "trade-craft signal" thesis).

Why these forums:
    Each is a vertical community of practitioners (not retail
    investors), where the discussion is product-substantive and the
    population skews technical. They map cleanly to the social-arbitrage
    persona profile in PRD D27.

source_type values:
    "forum_post" — single RSS/Atom entry, regardless of whether the
                   underlying forum software treats it as a thread
                   starter (XenForo: yes; phpBB Bogleheads feed: per
                   reply; vBulletin Gearspace: thread starter). All
                   three flavours give us a stable URL + author +
                   posted_at, which is all the engine needs.

source_community: "forum:<forum_key>" — e.g. "forum:audiosciencereview".
    The "forum:" prefix is recognised by COMMUNITY_TO_SOURCE_TYPE in
    backend/scripts/run_zscore_engine.py via prefix match -> "forum",
    so cross-platform corroboration math sees all forum chatter as one
    source-type while concept_daily_counts.community still preserves
    which forum each hit came from for operator UX.

source_post_id: feed_key + ":" + guid (or URL fallback). Prefixing
    with the forum key prevents cross-forum guid collisions (a couple
    of XenForo installations both use bare integer guids).

source_url: the <link> from the entry, normalised to absolute form.

Forum registry:
    Hard-coded list of 7 verified feeds (≥6 required by checklist):
        - audiosciencereview  XenForo  RSS 2.0
        - head_fi             XenForo  RSS 2.0
        - tomshardware        XenForo  RSS 2.0
        - guru3d              XenForo  RSS 2.0
        - stevehoffman        XenForo  RSS 2.0  (music gear / pressings)
        - gearspace           vBulletin RSS 2.0 (pro audio)
        - bogleheads          phpBB    Atom    (long-only investing)
    Override via --forums comma-list (matches feed key) or set the
    FORUMS env list in backend/data/preferences/ if we ever externalise.

Politeness:
    - Single GET per forum per tick (≤9 requests total at default cadence).
    - User-Agent identifies the project + a contact path.
    - 8-second timeout with no retries — better to skip a forum for
      one tick than wedge the cron job.
    - 700ms sleep between forum fetches (well below any forum's per-IP
      rate limit; the bigger XenForo sites cache the feed for 60s
      anyway, so hammering changes nothing).

Word-boundary post-filter:
    Same pattern as HN/4chan/Bluesky — every entry's (title + stripped
    description) is regex-matched against the term that triggered the
    pull. Forums don't expose a server-side search; we instead pull
    each forum's "new posts" feed once and locally fan out to every
    tracked concept. That makes the API call count flat (1/forum/tick)
    regardless of how many concepts we track.

Day-bucket convention (matters for downstream baselines/z-scores):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.
    topic_baselines.as_of_day MUST follow the same convention.

LLM-extracted fields (polarity_mean, intent_mix_json) are intentionally
left NULL here. Phase 2.2 (concept extraction) populates them by
re-aggregating concept_mentions over the same daily buckets.

Zero external deps — uses stdlib urllib.request for HTTP and
xml.etree.ElementTree for feed parsing (handles both RSS 2.0 and Atom).

Usage:
    py backend/scripts/collect_niche_forums.py
    py backend/scripts/collect_niche_forums.py --since-hours 12
    py backend/scripts/collect_niche_forums.py --forums audiosciencereview,head_fi
    py backend/scripts/collect_niche_forums.py --concept-keys ai_compute_shortage
    py backend/scripts/collect_niche_forums.py --dry-run

Output: JSON report on stdout (same envelope as the HN/4chan/Bluesky
collectors, so the existing /collectors/:source_type/run wiring can
JSON.parse it directly).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import email.utils
import html
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Pattern, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

USER_AGENT = (
    "pattern-detector-mi/0.2 (Niche-forums collector; "
    "+https://github.com/pattern-detector)"
)

FORUM_SOURCE_TYPE = "forum_post"


# ============================================================================
# Forum registry
# ----------------------------------------------------------------------------
# Each entry must produce a feed parsable as either RSS 2.0 (root <rss>) or
# Atom (root <feed xmlns="http://www.w3.org/2005/Atom">). All seven below
# were probed live before commit; if a forum starts 403'ing or 404'ing we
# log the failure and continue rather than crashing the whole tick.
#
# `community_id` becomes source_community = "forum:<community_id>". Keep it
# short (<24 chars), lowercase, no spaces — it shows up in operator UI.
# ============================================================================

FORUM_REGISTRY: List[Dict[str, str]] = [
    {
        "key": "audiosciencereview",
        "community_id": "audiosciencereview",
        "label": "Audio Science Review (ASR)",
        "url": "https://www.audiosciencereview.com/forum/forums/-/index.rss",
    },
    {
        "key": "head_fi",
        "community_id": "head_fi",
        "label": "Head-Fi.org",
        "url": "https://www.head-fi.org/forums/-/index.rss",
    },
    {
        "key": "tomshardware",
        "community_id": "tomshardware",
        "label": "Tom's Hardware Forum",
        "url": "https://forums.tomshardware.com/forums/-/index.rss",
    },
    {
        "key": "guru3d",
        "community_id": "guru3d",
        "label": "Guru3D Forums",
        "url": "https://forums.guru3d.com/forums/-/index.rss",
    },
    {
        "key": "stevehoffman",
        "community_id": "stevehoffman",
        "label": "Steve Hoffman Music Forums",
        "url": "https://forums.stevehoffman.tv/forums/-/index.rss",
    },
    {
        "key": "gearspace",
        "community_id": "gearspace",
        "label": "Gearspace (Pro Audio)",
        "url": "https://gearspace.com/board/external.php?type=RSS2",
    },
    {
        "key": "bogleheads",
        "community_id": "bogleheads",
        "label": "Bogleheads Investing Forum",
        "url": "https://www.bogleheads.org/forum/feed.php",
    },
]

FORUM_BY_KEY: Dict[str, Dict[str, str]] = {f["key"]: f for f in FORUM_REGISTRY}

# Atom and RSS namespace prefixes encountered in the seven feeds above.
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


# ============================================================================
# Word-boundary post-filter (lifted verbatim from the Bluesky collector)
# ----------------------------------------------------------------------------
# RSS feeds give us free text — XenForo descriptions ship as HTML — and we
# don't want "GPT" matching "GPT-4 fan" or worse, "rifle" matching "RIF".
# Same lookaround-on-\w pattern lets us treat "+", "-" and "#" as
# boundaries so "C++" and "$NVDA" tokens still match cleanly.
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
    """Strip HTML tags, unescape entities, collapse whitespace.

    XenForo description blocks are short HTML snippets like
    `<a href="...">First post snippet</a>`. After stripping, we have
    plain searchable text.
    """
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
# DB helpers — copied verbatim from the HN/Bluesky collectors for consistency
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
# Feed fetching + parsing
# ----------------------------------------------------------------------------
# Two formats out in the wild: RSS 2.0 (XenForo + vBulletin) and Atom
# (phpBB / Bogleheads). The element layouts overlap enough that a single
# normaliser can flatten them after a tiny detection step on the root tag.
# ============================================================================


def _fetch_feed(url: str, *, timeout: float) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            # Some XenForo installs serve text/html if Accept is missing —
            # be explicit so we always get the XML body.
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _parse_pubdate_rss(text: Optional[str]) -> Optional[int]:
    """RSS 2.0 pubDate is RFC 822 e.g. 'Fri, 17 Apr 2026 02:21:44 GMT'."""
    if not text:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    try:
        return int(dt.timestamp())
    except (OverflowError, ValueError):
        return None


def _parse_pubdate_atom(text: Optional[str]) -> Optional[int]:
    """Atom <published>/<updated> is ISO-8601 e.g. '2026-04-28T02:39:26-05:00'."""
    if not text:
        return None
    iso = text.strip().replace("Z", "+00:00")
    try:
        dt = _dt.datetime.fromisoformat(iso)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    try:
        return int(dt.timestamp())
    except (OverflowError, ValueError):
        return None


def _text(elem: Optional[ET.Element]) -> Optional[str]:
    if elem is None:
        return None
    if elem.text is None:
        return None
    return elem.text


def _normalize_url(url: Optional[str], base: str) -> Optional[str]:
    if not url:
        return None
    url = url.strip()
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    try:
        return urllib.parse.urljoin(base, url)
    except ValueError:
        return None


def _iter_rss_items(
    root: ET.Element,
    *,
    forum: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    channel = root.find("channel")
    if channel is None:
        return
    base_link = _text(channel.find("link")) or forum["url"]
    for item in channel.findall("item"):
        title = (_text(item.find("title")) or "").strip()
        link = _normalize_url(_text(item.find("link")), base_link)
        guid_elem = item.find("guid")
        guid = (_text(guid_elem) or "").strip()
        if not guid and link:
            guid = link

        pub_text = _text(item.find("pubDate"))
        posted_at = _parse_pubdate_rss(pub_text)
        # Some feeds omit pubDate on the most recent item; fall back to
        # `dc:date` (vBulletin sometimes uses it) and finally to fetched_at
        # so we never lose a hit just because the timestamp is missing.
        if posted_at is None:
            dc_date = _text(item.find(f"{{{NS['dc']}}}date"))
            posted_at = _parse_pubdate_atom(dc_date)
        if posted_at is None:
            posted_at = fetched_at

        # Description: prefer content:encoded (full body) if present,
        # otherwise use description (snippet). XenForo populates both;
        # vBulletin only the description.
        body_elem = item.find(f"{{{NS['content']}}}encoded")
        if body_elem is None or _text(body_elem) is None:
            body_elem = item.find("description")
        body_text = _text(body_elem)

        author = _text(item.find(f"{{{NS['dc']}}}creator"))
        if not author:
            author = _text(item.find("author"))

        if not guid or not link:
            continue
        if posted_at < since_unix:
            continue

        yield {
            "guid": guid,
            "link": link,
            "title": title,
            "body_text": body_text,
            "posted_at": int(posted_at),
            "author": (author or "").strip() or None,
        }


def _iter_atom_entries(
    root: ET.Element,
    *,
    forum: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    base_link_elem = root.find(f"{{{NS['atom']}}}link[@rel='alternate']")
    if base_link_elem is None:
        base_link_elem = root.find(f"{{{NS['atom']}}}link")
    base_link = (
        base_link_elem.get("href") if base_link_elem is not None else forum["url"]
    )
    for entry in root.findall(f"{{{NS['atom']}}}entry"):
        title = (_text(entry.find(f"{{{NS['atom']}}}title")) or "").strip()
        link_elem = entry.find(f"{{{NS['atom']}}}link[@rel='alternate']")
        if link_elem is None:
            link_elem = entry.find(f"{{{NS['atom']}}}link")
        link = (
            _normalize_url(link_elem.get("href"), base_link or forum["url"])
            if link_elem is not None
            else None
        )

        guid = (_text(entry.find(f"{{{NS['atom']}}}id")) or "").strip()
        if not guid and link:
            guid = link

        # Atom has both <published> (creation) and <updated> (last edit).
        # We want creation for baseline math; fall back to updated if absent.
        posted_at = _parse_pubdate_atom(
            _text(entry.find(f"{{{NS['atom']}}}published"))
        )
        if posted_at is None:
            posted_at = _parse_pubdate_atom(
                _text(entry.find(f"{{{NS['atom']}}}updated"))
            )
        if posted_at is None:
            posted_at = fetched_at

        body_elem = entry.find(f"{{{NS['atom']}}}content")
        if body_elem is None:
            body_elem = entry.find(f"{{{NS['atom']}}}summary")
        body_text = _text(body_elem)

        author_elem = entry.find(f"{{{NS['atom']}}}author/{{{NS['atom']}}}name")
        author = _text(author_elem)

        if not guid or not link:
            continue
        if posted_at < since_unix:
            continue

        yield {
            "guid": guid,
            "link": link,
            "title": title,
            "body_text": body_text,
            "posted_at": int(posted_at),
            "author": (author or "").strip() or None,
        }


def _iter_feed_entries(
    raw: bytes,
    *,
    forum: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    """Detect format from the root element and dispatch to the right iterator."""
    root = ET.fromstring(raw)
    tag = root.tag
    # Atom uses '{http://www.w3.org/2005/Atom}feed', RSS 2.0 uses 'rss'.
    if tag.endswith("}feed") or tag == "feed":
        yield from _iter_atom_entries(
            root,
            forum=forum,
            fetched_at=fetched_at,
            since_unix=since_unix,
        )
    elif tag == "rss":
        yield from _iter_rss_items(
            root,
            forum=forum,
            fetched_at=fetched_at,
            since_unix=since_unix,
        )
    else:
        raise ValueError(f"Unsupported feed root element: {tag!r}")


# ============================================================================
# Hit normalisation
# ============================================================================


def _normalize_entry(
    entry: Dict[str, Any],
    *,
    forum: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    """Map a parsed feed entry -> mi_raw_hits row dict."""
    guid = entry.get("guid")
    link = entry.get("link")
    posted_at = entry.get("posted_at")
    if not guid or not link or not isinstance(posted_at, int):
        return None

    forum_key = forum["key"]
    community_id = forum["community_id"]
    # Prefix with forum key so guids from different forums (some are bare
    # integers) don't collide on the UNIQUE (source_type, source_post_id) idx.
    source_post_id = f"{forum_key}:{guid}"

    title = entry.get("title") or None
    body_text = entry.get("body_text") or None
    author = entry.get("author") or None

    return {
        "source_type": FORUM_SOURCE_TYPE,
        "source_post_id": source_post_id,
        # Forum RSS feeds don't reliably expose thread root vs. reply, so
        # we leave thread_id null; the link itself is the post-level URL.
        "source_thread_id": None,
        "source_url": link,
        # "forum:<community_id>" — prefix-matched by community_to_source_type
        # to source-type "forum" while keeping per-forum granularity.
        "source_community": f"forum:{community_id}",
        "author": author,
        "title": title,
        "body_text": body_text,
        "posted_at": int(posted_at),
        # Forum feeds don't expose vote counts in the entry payload.
        "score": None,
        "comment_count": None,
        "raw_payload_json": json.dumps(
            {
                "forum_key": forum_key,
                "community_id": community_id,
                "guid": guid,
                "link": link,
                "title": title,
                "author": author,
                "posted_at": posted_at,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    }


def _day_bucket(posted_at: int) -> int:
    return (int(posted_at) // 86400) * 86400


# ============================================================================
# Persistence — same upsert + count refresh logic as the HN/Bluesky collectors
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

        # Existing row — merge concept ids only. Forum RSS feeds don't
        # expose engagement counts that change over time, so there's
        # nothing else to update; mi_raw_hits stays append-only.
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
    affected: Set[Tuple[int, str, int]],
    *,
    dry_run: bool,
) -> int:
    """Refresh per-(concept, community, day) counts. Unlike the Bluesky
    collector we have multiple `community` values (one per forum), so the
    affected set keys on (concept_id, community, day) instead of just
    (concept_id, day).
    """
    if not affected:
        return 0

    refreshed = 0
    for concept_id, community, day in affected:
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
    only_concept_keys: Optional[Set[str]],
    only_forums: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    selected_forums = [
        f for f in FORUM_REGISTRY
        if only_forums is None or f["key"] in only_forums
    ]
    if only_forums and not selected_forums:
        raise SystemExit(
            f"No forums matched --forums={sorted(only_forums)!r}. "
            f"Known keys: {sorted(FORUM_BY_KEY)}"
        )

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)
        concepts = _load_active_concepts(conn, only_keys=only_concept_keys)

        rows_with_concepts: Dict[
            Tuple[str, str], Tuple[Dict[str, Any], Set[int]]
        ] = {}
        affected_buckets: Set[Tuple[int, str, int]] = set()

        per_forum_report: List[Dict[str, Any]] = []

        for index, forum in enumerate(selected_forums):
            forum_key = forum["key"]
            community = f"forum:{forum['community_id']}"
            forum_entry_count = 0
            forum_match_count = 0
            forum_filter_rejects = 0
            forum_window_rejects = 0
            forum_error: Optional[str] = None

            try:
                raw = _fetch_feed(forum["url"], timeout=request_timeout)
            except urllib.error.HTTPError as err:
                forum_error = f"HTTP {err.code}: {err.reason}"
            except urllib.error.URLError as err:
                forum_error = f"URLError: {err}"
            except Exception as err:  # noqa: BLE001 — last-resort guard
                forum_error = f"unexpected error: {err.__class__.__name__}: {err}"

            if forum_error is not None:
                print(
                    f"[forums] WARN: {forum_key} fetch failed: {forum_error}",
                    file=sys.stderr,
                )
                per_forum_report.append({
                    "forum_key": forum_key,
                    "label": forum["label"],
                    "url": forum["url"],
                    "entries_seen": 0,
                    "matches": 0,
                    "filter_rejects": 0,
                    "window_rejects": 0,
                    "error": forum_error,
                })
            else:
                try:
                    entries = list(_iter_feed_entries(
                        raw,
                        forum=forum,
                        fetched_at=fetched_at,
                        since_unix=since_unix,
                    ))
                except (ET.ParseError, ValueError) as parse_err:
                    forum_error = f"parse error: {parse_err}"
                    entries = []
                    print(
                        f"[forums] WARN: {forum_key} parse failed: {parse_err}",
                        file=sys.stderr,
                    )

                forum_entry_count = len(entries)

                for entry in entries:
                    normalized = _normalize_entry(entry, forum=forum)
                    if normalized is None:
                        continue
                    if normalized["posted_at"] < since_unix:
                        forum_window_rejects += 1
                        continue

                    # Forum feed entries don't tell us which concept (if any)
                    # they're about — fan out to every concept and apply
                    # the word-boundary filter against title + body.
                    haystack_parts: List[str] = []
                    if normalized.get("title"):
                        haystack_parts.append(str(normalized["title"]))
                    if normalized.get("body_text"):
                        haystack_parts.append(str(normalized["body_text"]))
                    haystack = " \n ".join(haystack_parts)

                    matched_for_entry: Set[int] = set()
                    for concept in concepts:
                        for term_pattern in concept["term_patterns"]:
                            if _hit_matches_term(haystack, term_pattern):
                                matched_for_entry.add(concept["id"])
                                break  # one term matching is enough

                    if not matched_for_entry:
                        forum_filter_rejects += 1
                        continue

                    key = (
                        normalized["source_type"],
                        normalized["source_post_id"],
                    )
                    if key in rows_with_concepts:
                        rows_with_concepts[key][1].update(matched_for_entry)
                    else:
                        rows_with_concepts[key] = (normalized, set(matched_for_entry))
                    day = _day_bucket(normalized["posted_at"])
                    for concept_id in matched_for_entry:
                        affected_buckets.add((concept_id, community, day))
                    forum_match_count += 1

                per_forum_report.append({
                    "forum_key": forum_key,
                    "label": forum["label"],
                    "url": forum["url"],
                    "entries_seen": forum_entry_count,
                    "matches": forum_match_count,
                    "filter_rejects": forum_filter_rejects,
                    "window_rejects": forum_window_rejects,
                    "error": forum_error,
                })

            # Polite pause between forums (skip after the last one).
            if sleep_ms > 0 and index < len(selected_forums) - 1:
                time.sleep(sleep_ms / 1000.0)

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

    forums_attempted = len(selected_forums)
    forums_succeeded = sum(1 for r in per_forum_report if r.get("error") is None)

    return {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "since_hours": since_hours,
        "since_unix": since_unix,
        "fetched_at": fetched_at,
        "concepts_processed": len(concepts),
        "forums_attempted": forums_attempted,
        "forums_succeeded": forums_succeeded,
        "raw_entries_seen": sum(r["entries_seen"] for r in per_forum_report),
        "filter_rejects": sum(r["filter_rejects"] for r in per_forum_report),
        "window_rejects": sum(r["window_rejects"] for r in per_forum_report),
        "unique_posts": len(rows_with_concepts),
        "affected_buckets": len(affected_buckets),
        "daily_counts_refreshed": refreshed,
        "mi_raw_hits": upsert_report,
        "per_forum": per_forum_report,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Concept-keyed niche-forums collector for Market Intelligence "
            "(RSS/Atom feeds, ≥6 forums)."
        )
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Look back this many hours from now.",
    )
    parser.add_argument(
        "--forums",
        type=str,
        default="",
        help=(
            "Comma-separated forum keys to limit collection (default: all). "
            f"Known keys: {','.join(sorted(FORUM_BY_KEY))}"
        ),
    )
    parser.add_argument(
        "--concept-keys",
        type=str,
        default="",
        help="Comma-separated concept_keys to limit matching (default: all active).",
    )
    parser.add_argument("--request-timeout", type=float, default=8.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=700,
        help=(
            "Delay between forum fetches. Default 700ms keeps us under any "
            "per-IP rate limit even on the smaller XenForo installs."
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list-forums",
        action="store_true",
        help="Print the built-in forum registry and exit.",
    )
    args = parser.parse_args()

    if args.list_forums:
        print(json.dumps(FORUM_REGISTRY, indent=2))
        return 0

    only_keys: Optional[Set[str]] = None
    if args.concept_keys.strip():
        only_keys = {
            k.strip() for k in args.concept_keys.split(",") if k.strip()
        }

    only_forums: Optional[Set[str]] = None
    if args.forums.strip():
        only_forums = {
            k.strip() for k in args.forums.split(",") if k.strip()
        }
        unknown = only_forums - set(FORUM_BY_KEY)
        if unknown:
            print(
                f"Unknown forum keys: {sorted(unknown)}. "
                f"Known: {sorted(FORUM_BY_KEY)}",
                file=sys.stderr,
            )
            return 2

    report = collect(
        db_path=args.db_path,
        since_hours=args.since_hours,
        only_concept_keys=only_keys,
        only_forums=only_forums,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
