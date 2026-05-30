#!/usr/bin/env python3
"""Macro Engine — Federal Reserve RSS collector.

Phase 1.5 first collector (PRD Phase 1.5 — Macro Engine, deliverable
"RSS Federal Reserve"). Lands every entry from the Fed's public RSS
feeds in `mi_raw_hits` so the downstream embedding + clustering
pipeline (separate Phase 1.5 deliverable) can compute embeddings on
the body text and emit `market_situations` with
`detection_path = "news_cluster"`.

How it differs from the Social Arbitrage collectors
    The social-arb collectors (HN / 4chan / Bluesky / forums / Discord)
    are CONCEPT-KEYED — they fan each hit out across every active
    `tracked_concepts` row, run a word-boundary post-filter, and only
    keep the matches. The Macro engine does NOT use `tracked_concepts`
    at all; it groups hits by semantic embedding similarity instead.
    So this collector deliberately:
      - Skips loading active concepts from the DB
      - Skips the word-boundary filter
      - Keeps EVERY entry that lands inside `since_hours`
      - Writes `matched_concept_ids_json = "[]"` so the
        concept_daily_counts rollup doesn't accidentally pick them up
        (the EXISTS-on-json_each subquery returns 0 rows on an empty
        array, so the z-score engine literally cannot see macro hits)
      - Skips the `concept_daily_counts` refresh entirely

source_type values:
    "rss_federal_reserve" — every entry, regardless of which sub-feed
        (press releases / monetary policy / speeches / testimony) it
        came from. Sub-feed identity is preserved in `raw_payload_json`
        so the embedding pipeline can stratify if needed.

source_community: "macro:fed" — Phase 1.5's "macro:" prefix groups
    every Fed-issued hit into one community bucket. The clustering
    job will read by community + posted_at window, not by
    (community, concept_id, day) like the social-arb stack.

source_post_id: feed_key + ":" + guid. Fed guids are the absolute URL
    of the press release, which is globally unique, so prefixing with
    feed_key is technically redundant — but it matches the per-source
    convention of every other collector and makes operator queries
    easier (`WHERE source_post_id LIKE 'press_all:%'`).

source_url: the <link> from the entry — this is the canonical
    federalreserve.gov press-release URL the operator will want to
    open from the UI.

Feed registry (all four are public, no auth, ~10kB each, plain RSS 2.0):
    - press_all       https://www.federalreserve.gov/feeds/press_all.xml
    - press_monetary  https://www.federalreserve.gov/feeds/press_monetary.xml
    - speeches        https://www.federalreserve.gov/feeds/speeches.xml
    - testimony       https://www.federalreserve.gov/feeds/testimony.xml

Politeness:
    - Single GET per feed per tick (4 requests/tick at default cadence)
    - User-Agent identifies the project + a contact path
    - 8-second timeout with no retries — better to skip a feed for
      one tick than wedge the whole job
    - 500ms sleep between feed fetches (Fed publishes daily at most;
      no per-IP rate limit concern, but be polite)

Day-bucket convention (matters for the macro clustering job, not z-score):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.

Zero external deps — uses stdlib urllib.request for HTTP and
xml.etree.ElementTree for feed parsing. Lifted the RSS parser bones
from `collect_niche_forums.py` (Atom support kept for future-proofing
even though the four Fed feeds are all RSS 2.0 today).

Usage:
    py backend/scripts/collect_macro_fed_intraday.py
    py backend/scripts/collect_macro_fed_intraday.py --since-hours 168
    py backend/scripts/collect_macro_fed_intraday.py --feeds press_monetary,speeches
    py backend/scripts/collect_macro_fed_intraday.py --dry-run
    py backend/scripts/collect_macro_fed_intraday.py --list-feeds

Output: JSON report on stdout — same envelope shape as the social-arb
collectors so the existing `/collectors/:source_type/run` and
scheduler runtime-doc plumbing can JSON.parse it directly.
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
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

USER_AGENT = (
    "pattern-detector-mi/0.2 (Macro Fed RSS collector; "
    "+https://github.com/pattern-detector)"
)

FED_SOURCE_TYPE = "rss_federal_reserve"
FED_COMMUNITY = "macro:fed"


# ============================================================================
# Feed registry
# ----------------------------------------------------------------------------
# Each entry: key (CLI shorthand + source_post_id prefix), label
# (operator UI), url, sub_feed (categorical bucket carried in
# raw_payload_json so the embedding pipeline can weight or stratify
# without re-parsing the URL).
# ============================================================================

FED_FEEDS: List[Dict[str, str]] = [
    {
        "key": "press_all",
        "label": "Federal Reserve — All Press Releases",
        "url": "https://www.federalreserve.gov/feeds/press_all.xml",
        "sub_feed": "press_release",
    },
    {
        "key": "press_monetary",
        "label": "Federal Reserve — Monetary Policy Press Releases",
        "url": "https://www.federalreserve.gov/feeds/press_monetary.xml",
        "sub_feed": "monetary_policy",
    },
    {
        "key": "speeches",
        "label": "Federal Reserve — Speeches",
        "url": "https://www.federalreserve.gov/feeds/speeches.xml",
        "sub_feed": "speech",
    },
    {
        "key": "testimony",
        "label": "Federal Reserve — Testimony",
        "url": "https://www.federalreserve.gov/feeds/testimony.xml",
        "sub_feed": "testimony",
    },
]

FEED_BY_KEY: Dict[str, Dict[str, str]] = {f["key"]: f for f in FED_FEEDS}

# Atom + RSS namespaces; same dict the niche-forums collector uses.
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


# ============================================================================
# DB helpers — same shape as the other collectors
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


# ============================================================================
# Body cleanup — strip HTML tags, unescape entities, collapse whitespace.
# Fed RSS descriptions are usually plain text but speeches/testimony
# occasionally include &nbsp; / &mdash; entities and stray <br/> tags.
# ============================================================================

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_text(text: Optional[str]) -> str:
    if not text:
        return ""
    flat = _HTML_TAG_RE.sub(" ", text)
    flat = html.unescape(flat)
    return _WS_RE.sub(" ", flat).strip()


# ============================================================================
# Feed fetching + parsing — RSS 2.0 path is what every Fed feed uses today;
# Atom path kept for forward-compat in case the Fed migrates.
# ============================================================================


def _fetch_feed(url: str, *, timeout: float) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "application/rss+xml, application/atom+xml, "
                "application/xml, text/xml;q=0.9, */*;q=0.5"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _parse_pubdate_rss(text: Optional[str]) -> Optional[int]:
    """RSS 2.0 pubDate is RFC 822 e.g. 'Fri, 24 Apr 2026 20:00:00 GMT'."""
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
    """Atom <published>/<updated> is ISO-8601."""
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
    if elem is None or elem.text is None:
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
    feed: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    channel = root.find("channel")
    if channel is None:
        return
    base_link = _text(channel.find("link")) or feed["url"]
    for item in channel.findall("item"):
        title = (_text(item.find("title")) or "").strip()
        link = _normalize_url(_text(item.find("link")), base_link)
        guid_elem = item.find("guid")
        guid = (_text(guid_elem) or "").strip()
        if not guid and link:
            guid = link

        pub_text = _text(item.find("pubDate"))
        posted_at = _parse_pubdate_rss(pub_text)
        if posted_at is None:
            dc_date = _text(item.find(f"{{{NS['dc']}}}date"))
            posted_at = _parse_pubdate_atom(dc_date)
        if posted_at is None:
            posted_at = fetched_at

        body_elem = item.find(f"{{{NS['content']}}}encoded")
        if body_elem is None or _text(body_elem) is None:
            body_elem = item.find("description")
        body_text = _text(body_elem)

        category = (_text(item.find("category")) or "").strip() or None

        if not guid or not link:
            continue
        if posted_at < since_unix:
            yield {"_window_reject": True}
            continue

        yield {
            "guid": guid,
            "link": link,
            "title": title,
            "body_text": body_text,
            "posted_at": int(posted_at),
            "category": category,
        }


def _iter_atom_entries(
    root: ET.Element,
    *,
    feed: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    base_link_elem = root.find(f"{{{NS['atom']}}}link[@rel='alternate']")
    if base_link_elem is None:
        base_link_elem = root.find(f"{{{NS['atom']}}}link")
    base_link = (
        base_link_elem.get("href") if base_link_elem is not None else feed["url"]
    )
    for entry in root.findall(f"{{{NS['atom']}}}entry"):
        title = (_text(entry.find(f"{{{NS['atom']}}}title")) or "").strip()
        link_elem = entry.find(f"{{{NS['atom']}}}link[@rel='alternate']")
        if link_elem is None:
            link_elem = entry.find(f"{{{NS['atom']}}}link")
        link = (
            _normalize_url(link_elem.get("href"), base_link or feed["url"])
            if link_elem is not None
            else None
        )

        guid = (_text(entry.find(f"{{{NS['atom']}}}id")) or "").strip()
        if not guid and link:
            guid = link

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

        if not guid or not link:
            continue
        if posted_at < since_unix:
            yield {"_window_reject": True}
            continue

        yield {
            "guid": guid,
            "link": link,
            "title": title,
            "body_text": body_text,
            "posted_at": int(posted_at),
            "category": None,
        }


def _iter_feed_entries(
    raw: bytes,
    *,
    feed: Dict[str, str],
    fetched_at: int,
    since_unix: int,
) -> Iterable[Dict[str, Any]]:
    root = ET.fromstring(raw)
    tag = root.tag
    if tag.endswith("}feed") or tag == "feed":
        yield from _iter_atom_entries(
            root, feed=feed, fetched_at=fetched_at, since_unix=since_unix,
        )
    elif tag == "rss":
        yield from _iter_rss_items(
            root, feed=feed, fetched_at=fetched_at, since_unix=since_unix,
        )
    else:
        raise ValueError(f"Unsupported feed root element: {tag!r}")


# ============================================================================
# Hit normalisation — Macro hits land in mi_raw_hits with empty
# matched_concept_ids_json so they're invisible to concept_daily_counts
# and the z-score engine, but visible to the upcoming embedding pipeline.
# ============================================================================


def _day_bucket(posted_at: int) -> int:
    return (int(posted_at) // 86400) * 86400


def _normalize_entry(
    entry: Dict[str, Any],
    *,
    feed: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    guid = entry.get("guid")
    link = entry.get("link")
    posted_at = entry.get("posted_at")
    if not guid or not link or not isinstance(posted_at, int):
        return None

    feed_key = feed["key"]
    sub_feed = feed["sub_feed"]
    source_post_id = f"{feed_key}:{guid}"

    title = (entry.get("title") or "").strip() or None
    body_text = _strip_text(entry.get("body_text")) or None
    category = entry.get("category")

    return {
        "source_type": FED_SOURCE_TYPE,
        "source_post_id": source_post_id,
        # Fed press releases are standalone documents — no thread concept.
        "source_thread_id": None,
        "source_url": link,
        "source_community": FED_COMMUNITY,
        # Fed authorship sits at the institutional level; per-speech
        # speaker is in the title (e.g. "Speech by Chair Powell on …").
        # Leave author NULL rather than parsing a fragile prefix.
        "author": None,
        "title": title,
        "body_text": body_text,
        "posted_at": int(posted_at),
        "score": None,
        "comment_count": None,
        "raw_payload_json": json.dumps(
            {
                "feed_key": feed_key,
                "sub_feed": sub_feed,
                "guid": guid,
                "link": link,
                "title": title,
                "category": category,
                "posted_at": posted_at,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    }


# ============================================================================
# Persistence — append-only with no concept-id merge logic. Fed entries
# never gain a new concept tag after first ingestion; if the embedding
# pipeline later assigns a cluster, it writes to a separate table
# (Phase 1.5 deliverable, not this collector's job).
# ============================================================================


def _upsert_hits(
    conn: sqlite3.Connection,
    rows: List[Dict[str, Any]],
    *,
    fetched_at: int,
    dry_run: bool,
) -> Dict[str, int]:
    inserted = 0
    unchanged = 0

    for row in rows:
        existing = conn.execute(
            """
            SELECT id FROM mi_raw_hits
            WHERE source_type = ? AND source_post_id = ?
            """,
            (row["source_type"], row["source_post_id"]),
        ).fetchone()

        if existing is not None:
            unchanged += 1
            continue

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
                    # Empty JSON array — flags this hit as "macro, not
                    # concept-keyed" so the daily-count rollup ignores it.
                    "[]",
                    row["raw_payload_json"],
                ),
            )
        inserted += 1

    return {"inserted": inserted, "merged": 0, "unchanged": unchanged}


# ============================================================================
# Orchestration
# ============================================================================


def collect(
    *,
    db_path: Path,
    since_hours: int,
    only_feeds: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    selected_feeds = [
        f for f in FED_FEEDS if only_feeds is None or f["key"] in only_feeds
    ]
    if only_feeds and not selected_feeds:
        raise SystemExit(
            f"No feeds matched --feeds={sorted(only_feeds)!r}. "
            f"Known keys: {sorted(FEED_BY_KEY)}"
        )

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)

        all_normalized: List[Dict[str, Any]] = []
        per_feed_report: List[Dict[str, Any]] = []

        for index, feed in enumerate(selected_feeds):
            feed_key = feed["key"]
            entries_seen = 0
            window_rejects = 0
            kept = 0
            feed_error: Optional[str] = None

            try:
                raw = _fetch_feed(feed["url"], timeout=request_timeout)
            except urllib.error.HTTPError as err:
                feed_error = f"HTTP {err.code}: {err.reason}"
            except urllib.error.URLError as err:
                feed_error = f"URLError: {err}"
            except Exception as err:  # noqa: BLE001 — last-resort guard
                feed_error = f"unexpected: {err.__class__.__name__}: {err}"

            if feed_error is not None:
                print(
                    f"[macro_fed] WARN: {feed_key} fetch failed: {feed_error}",
                    file=sys.stderr,
                )
            else:
                try:
                    entries = list(_iter_feed_entries(
                        raw,
                        feed=feed,
                        fetched_at=fetched_at,
                        since_unix=since_unix,
                    ))
                except (ET.ParseError, ValueError) as parse_err:
                    feed_error = f"parse error: {parse_err}"
                    entries = []
                    print(
                        f"[macro_fed] WARN: {feed_key} parse failed: {parse_err}",
                        file=sys.stderr,
                    )

                for entry in entries:
                    if entry.get("_window_reject"):
                        window_rejects += 1
                        continue
                    entries_seen += 1
                    normalized = _normalize_entry(entry, feed=feed)
                    if normalized is None:
                        continue
                    all_normalized.append(normalized)
                    kept += 1

            per_feed_report.append({
                "feed_key": feed_key,
                "label": feed["label"],
                "url": feed["url"],
                "sub_feed": feed["sub_feed"],
                "entries_seen": entries_seen,
                "window_rejects": window_rejects,
                "kept": kept,
                "error": feed_error,
            })

            if sleep_ms > 0 and index < len(selected_feeds) - 1:
                time.sleep(sleep_ms / 1000.0)

        # Dedup across feeds: press_all is a superset of the other three,
        # so the same press release shows up under multiple feed_keys.
        # Our source_post_id prefixes the feed_key, which would create
        # 2-4 rows for the same release. Collapse to one row, preferring
        # the most-specific feed (monetary > speeches/testimony > press_all)
        # so operator URLs in raw_payload_json land on the correct
        # sub-feed bucket for downstream weighting.
        FEED_PRIORITY = {
            "press_monetary": 4,
            "speeches": 3,
            "testimony": 3,
            "press_all": 1,
        }
        deduped: Dict[str, Dict[str, Any]] = {}
        for row in all_normalized:
            link = (
                json.loads(row["raw_payload_json"]).get("link")
                if row.get("raw_payload_json")
                else None
            )
            dedup_key = link or row["source_post_id"]
            existing = deduped.get(dedup_key)
            if existing is None:
                deduped[dedup_key] = row
                continue
            old_pri = FEED_PRIORITY.get(
                json.loads(existing["raw_payload_json"]).get("feed_key", ""), 0
            )
            new_pri = FEED_PRIORITY.get(
                json.loads(row["raw_payload_json"]).get("feed_key", ""), 0
            )
            if new_pri > old_pri:
                deduped[dedup_key] = row

        deduped_rows = list(deduped.values())
        upsert_report = _upsert_hits(
            conn, deduped_rows, fetched_at=fetched_at, dry_run=dry_run
        )

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    feeds_attempted = len(selected_feeds)
    feeds_succeeded = sum(1 for r in per_feed_report if r.get("error") is None)

    return {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "since_hours": since_hours,
        "since_unix": since_unix,
        "fetched_at": fetched_at,
        "feeds_attempted": feeds_attempted,
        "feeds_succeeded": feeds_succeeded,
        "raw_entries_seen": sum(r["entries_seen"] for r in per_feed_report),
        "window_rejects": sum(r["window_rejects"] for r in per_feed_report),
        "raw_normalized": len(all_normalized),
        "after_dedup": len(deduped_rows),
        "mi_raw_hits": upsert_report,
        "per_feed": per_feed_report,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Macro Engine collector for the Federal Reserve RSS feeds "
            "(Phase 1.5 — first macro source_type)."
        )
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Look back this many hours from now (default 24).",
    )
    parser.add_argument(
        "--feeds",
        type=str,
        default="",
        help=(
            "Comma-separated feed keys to limit collection (default: all). "
            f"Known keys: {','.join(sorted(FEED_BY_KEY))}"
        ),
    )
    parser.add_argument("--request-timeout", type=float, default=8.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=500,
        help="Delay between feed fetches (ms). Fed has no rate limit; be polite.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list-feeds",
        action="store_true",
        help="Print the built-in feed registry and exit.",
    )
    args = parser.parse_args()

    if args.list_feeds:
        print(json.dumps(FED_FEEDS, indent=2))
        return 0

    only_feeds: Optional[Set[str]] = None
    if args.feeds.strip():
        only_feeds = {k.strip() for k in args.feeds.split(",") if k.strip()}
        unknown = only_feeds - set(FEED_BY_KEY)
        if unknown:
            print(
                f"Unknown feed keys: {sorted(unknown)}. "
                f"Known: {sorted(FEED_BY_KEY)}",
                file=sys.stderr,
            )
            return 2

    report = collect(
        db_path=args.db_path,
        since_hours=args.since_hours,
        only_feeds=only_feeds,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
