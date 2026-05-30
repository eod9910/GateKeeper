#!/usr/bin/env python3
"""Macro Engine — multi-source news RSS collector.

Phase 1.5 second collector script. Pulls from three news-level macro
sources that all expose standard RSS 2.0 feeds:

    yahoo_finance   — Yahoo Finance main feed + S&P 500 headline feed
    reuters         — Reuters articles via Google News RSS proxy
                      (reuters.com deprecated their direct RSS in 2024;
                       Google News `site:reuters.com` returns ~100
                       items/day with pubDate + link)
    ap              — AP News via Google News RSS proxy (same pattern)

Each source maps to its own `source_type` in `mi_raw_hits`:
    rss_yahoo_finance   source_community = "macro:yahoo_finance"
    rss_reuters         source_community = "macro:reuters"
    rss_ap              source_community = "macro:ap"

Like the Fed collector, these are NOT concept-keyed — they ship
`matched_concept_ids_json = "[]"` so the social-arb stack ignores
them entirely, and the upcoming embedding + clustering pipeline
(Phase 1.5 deliverable) picks them up by community + posted_at window.

Google News RSS caveats:
    - The <link> is a Google redirect URL (news.google.com/rss/articles/…)
      not the original reuters.com / apnews.com URL. We store it as
      source_url anyway because the redirect always resolves. The
      original URL is in <source url="…"> when available.
    - <description> may contain CDATA HTML; we strip tags.
    - <guid> is the Google redirect URL (isPermaLink=false).
    - Google News imposes undocumented rate limits; the collector
      sleeps 2s between feeds (well under any observed threshold).

Yahoo Finance RSS:
    - Two feeds: main index (48+ items) and S&P headline (20 items).
    - <description> is usually present and substantive (2-3 sentences).
    - <source> element names the wire service (Reuters, Bloomberg, etc.)
      which we stash in raw_payload_json.
    - <guid> is a short slug (not a URL), so we prefix with feed_key
      to avoid cross-feed collisions.

Zero external deps — stdlib urllib + xml.etree.ElementTree.

Usage:
    py backend/scripts/collect_macro_news_intraday.py
    py backend/scripts/collect_macro_news_intraday.py --sources yahoo_finance
    py backend/scripts/collect_macro_news_intraday.py --sources reuters,ap
    py backend/scripts/collect_macro_news_intraday.py --since-hours 12
    py backend/scripts/collect_macro_news_intraday.py --dry-run
    py backend/scripts/collect_macro_news_intraday.py --list-feeds
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
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

EXPECTED_SCHEMA_VERSION = 5

USER_AGENT = (
    "pattern-detector-mi/0.2 (Macro news RSS collector; "
    "+https://github.com/pattern-detector)"
)


# ============================================================================
# Feed registry
# ============================================================================

FEED_REGISTRY: List[Dict[str, str]] = [
    # --- Yahoo Finance ---
    {
        "key": "yahoo_main",
        "source_key": "yahoo_finance",
        "source_type": "rss_yahoo_finance",
        "community": "macro:yahoo_finance",
        "label": "Yahoo Finance — Main",
        "url": "https://finance.yahoo.com/news/rssindex",
    },
    {
        "key": "yahoo_sp500",
        "source_key": "yahoo_finance",
        "source_type": "rss_yahoo_finance",
        "community": "macro:yahoo_finance",
        "label": "Yahoo Finance — S&P 500 Headlines",
        "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US",
    },
    # --- Reuters via Google News ---
    {
        "key": "reuters_gnews",
        "source_key": "reuters",
        "source_type": "rss_reuters",
        "community": "macro:reuters",
        "label": "Reuters via Google News RSS",
        "url": "https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en",
    },
    # --- AP via Google News ---
    {
        "key": "ap_gnews",
        "source_key": "ap",
        "source_type": "rss_ap",
        "community": "macro:ap",
        "label": "AP News via Google News RSS",
        "url": "https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en",
    },
]

ALL_SOURCE_KEYS = sorted(set(f["source_key"] for f in FEED_REGISTRY))
FEED_BY_KEY: Dict[str, Dict[str, str]] = {f["key"]: f for f in FEED_REGISTRY}

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "media": "http://search.yahoo.com/mrss/",
}


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


# ============================================================================
# Text cleanup
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
# Feed fetching + parsing
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


def _parse_pubdate_iso(text: Optional[str]) -> Optional[int]:
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
    for item in channel.findall("item"):
        title = (_text(item.find("title")) or "").strip()
        link = (_text(item.find("link")) or "").strip()
        guid = (_text(item.find("guid")) or "").strip()
        if not guid and link:
            guid = link

        pub_text = _text(item.find("pubDate"))
        posted_at = _parse_pubdate_rss(pub_text)
        if posted_at is None:
            posted_at = _parse_pubdate_iso(pub_text)
        if posted_at is None:
            posted_at = fetched_at

        body_elem = item.find("description")
        body_text = _text(body_elem)

        source_elem = item.find("source")
        wire_source = _text(source_elem)
        wire_url = source_elem.get("url") if source_elem is not None else None

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
            "wire_source": wire_source,
            "wire_url": wire_url,
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
    if tag == "rss":
        yield from _iter_rss_items(
            root, feed=feed, fetched_at=fetched_at, since_unix=since_unix,
        )
    else:
        raise ValueError(f"Unsupported feed root element: {tag!r}")


# ============================================================================
# Hit normalisation
# ============================================================================


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
    source_type = feed["source_type"]
    community = feed["community"]
    source_post_id = f"{feed_key}:{guid}"

    title = (entry.get("title") or "").strip() or None
    body_text = _strip_text(entry.get("body_text")) or None

    return {
        "source_type": source_type,
        "source_post_id": source_post_id,
        "source_thread_id": None,
        "source_url": link,
        "source_community": community,
        "author": None,
        "title": title,
        "body_text": body_text,
        "posted_at": int(posted_at),
        "score": None,
        "comment_count": None,
        "raw_payload_json": json.dumps(
            {
                "feed_key": feed_key,
                "source_key": feed["source_key"],
                "guid": guid,
                "link": link,
                "title": title,
                "wire_source": entry.get("wire_source"),
                "wire_url": entry.get("wire_url"),
                "posted_at": posted_at,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
    }


# ============================================================================
# Persistence — same append-only shape as the Fed collector
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
    only_sources: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    selected_feeds = [
        f for f in FEED_REGISTRY
        if only_sources is None or f["source_key"] in only_sources
    ]
    if only_sources and not selected_feeds:
        raise SystemExit(
            f"No sources matched --sources={sorted(only_sources)!r}. "
            f"Known source keys: {ALL_SOURCE_KEYS}"
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
            except Exception as err:  # noqa: BLE001
                feed_error = f"unexpected: {err.__class__.__name__}: {err}"

            if feed_error is not None:
                print(
                    f"[macro_news] WARN: {feed_key} fetch failed: {feed_error}",
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
                        f"[macro_news] WARN: {feed_key} parse failed: {parse_err}",
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
                "source_key": feed["source_key"],
                "label": feed["label"],
                "url": feed["url"],
                "entries_seen": entries_seen,
                "window_rejects": window_rejects,
                "kept": kept,
                "error": feed_error,
            })

            if sleep_ms > 0 and index < len(selected_feeds) - 1:
                time.sleep(sleep_ms / 1000.0)

        # Dedup across feeds within the same source_key. Yahoo has two
        # feeds that may overlap; Reuters/AP only have one each so their
        # dedup pass is a no-op.
        deduped: Dict[str, Dict[str, Any]] = {}
        for row in all_normalized:
            link = row.get("source_url") or row["source_post_id"]
            dedup_key = f"{row['source_type']}:{link}"
            if dedup_key not in deduped:
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
            "Macro Engine multi-source news RSS collector "
            "(Yahoo Finance + Reuters + AP via Google News RSS)."
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
        "--sources",
        type=str,
        default="",
        help=(
            "Comma-separated source keys to limit collection (default: all). "
            f"Known keys: {','.join(ALL_SOURCE_KEYS)}"
        ),
    )
    parser.add_argument("--request-timeout", type=float, default=15.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=2000,
        help="Delay between feed fetches (ms). 2s default for Google News politeness.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--list-feeds",
        action="store_true",
        help="Print the built-in feed registry and exit.",
    )
    args = parser.parse_args()

    if args.list_feeds:
        print(json.dumps(FEED_REGISTRY, indent=2))
        return 0

    only_sources: Optional[Set[str]] = None
    if args.sources.strip():
        only_sources = {k.strip() for k in args.sources.split(",") if k.strip()}
        unknown = only_sources - set(ALL_SOURCE_KEYS)
        if unknown:
            print(
                f"Unknown source keys: {sorted(unknown)}. "
                f"Known: {ALL_SOURCE_KEYS}",
                file=sys.stderr,
            )
            return 2

    report = collect(
        db_path=args.db_path,
        since_hours=args.since_hours,
        only_sources=only_sources,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
