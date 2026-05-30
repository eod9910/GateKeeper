#!/usr/bin/env python3
"""
Collect recent YouTube channel uploads into Market Intelligence.

This is the first YouTube "engine" layer: free channel RSS discovery, no API
key. It stores upload metadata as `youtube_video` rows in `mi_raw_hits` and can
optionally hand discovered URLs to `collect_youtube_transcripts.py` so public
captions become `youtube_transcript` rows.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import collect_youtube_transcripts as transcript_collector


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
DEFAULT_CHANNELS_FILE = ROOT / "backend" / "data" / "preferences" / "youtube-channels.json"
EXPECTED_SCHEMA_VERSION = 7
USER_AGENT = transcript_collector.USER_AGENT
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


@dataclass
class ChannelSpec:
    key: str
    label: str
    channel_id: Optional[str]
    handle: Optional[str]
    url: Optional[str]
    enabled: bool
    fetch_transcripts: bool


@dataclass
class VideoEntry:
    video_id: str
    channel_id: str
    channel_label: str
    title: str
    url: str
    author: str
    published_at: int
    updated_at: int
    raw: Dict[str, Any]


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[youtube-feeds] DB missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT value FROM schema_meta WHERE key='schema_version'").fetchone()
    actual = int(row["value"]) if row and str(row["value"]).isdigit() else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[youtube-feeds] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def http_get(url: str, *, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_time(value: str) -> int:
    value = str(value or "").strip()
    if not value:
        return int(time.time())
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            if fmt.endswith("%z"):
                return int(time.mktime(time.strptime(value.replace("Z", "+0000"), fmt)))
            return int(time.mktime(time.strptime(value, fmt)))
        except Exception:
            continue
    return int(time.time())


def slug(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return s[:80] or "youtube_channel"


def load_channel_specs(path: Path) -> List[ChannelSpec]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw.get("channels", raw) if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        raise ValueError("youtube channel config must be a list or {\"channels\": [...]}")
    specs: List[ChannelSpec] = []
    for idx, item in enumerate(rows):
        if isinstance(item, str):
            item = {"url": item}
        if not isinstance(item, dict):
            continue
        enabled = bool(item.get("enabled", True))
        channel_id = str(item.get("channel_id") or "").strip() or None
        handle = str(item.get("handle") or "").strip() or None
        url = str(item.get("url") or "").strip() or None
        label = str(item.get("label") or item.get("name") or handle or channel_id or url or f"channel_{idx+1}").strip()
        key = slug(str(item.get("key") or label))
        specs.append(
            ChannelSpec(
                key=key,
                label=label,
                channel_id=channel_id,
                handle=handle,
                url=url,
                enabled=enabled,
                fetch_transcripts=bool(item.get("fetch_transcripts", True)),
            )
        )
    return specs


def channel_id_from_url(url: str) -> Tuple[Optional[str], Optional[str]]:
    parsed = urllib.parse.urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if parts and parts[0] == "channel" and len(parts) >= 2:
        return parts[1], None
    if parts and parts[0].startswith("@"):
        return None, parts[0]
    return None, None


def resolve_channel_id(spec: ChannelSpec) -> str:
    if spec.channel_id:
        return spec.channel_id
    handle = spec.handle
    if spec.url:
        channel_id, url_handle = channel_id_from_url(spec.url)
        if channel_id:
            return channel_id
        handle = handle or url_handle
    if not handle:
        raise ValueError(f"channel '{spec.label}' needs channel_id, handle, or /channel/ URL")
    handle_url = f"https://www.youtube.com/{handle if handle.startswith('@') else '@' + handle}"
    page = http_get(handle_url)
    patterns = [
        r'"channelId"\s*:\s*"([^"]+)"',
        r'"externalId"\s*:\s*"([^"]+)"',
        r'<meta itemprop="channelId" content="([^"]+)"',
    ]
    for pattern in patterns:
        match = re.search(pattern, page)
        if match:
            return match.group(1)
    raise RuntimeError(f"could not resolve YouTube channel id for {spec.label}")


def parse_feed(xml_text: str, *, spec: ChannelSpec, channel_id: str) -> List[VideoEntry]:
    root = ET.fromstring(xml_text)
    entries: List[VideoEntry] = []
    for node in root.findall("atom:entry", ATOM_NS):
        video_id = (node.findtext("yt:videoId", default="", namespaces=ATOM_NS) or "").strip()
        if not video_id:
            continue
        title = (node.findtext("atom:title", default="", namespaces=ATOM_NS) or f"YouTube video {video_id}").strip()
        author_node = node.find("atom:author/atom:name", ATOM_NS)
        author = (author_node.text if author_node is not None else spec.label) or spec.label
        published = parse_time(node.findtext("atom:published", default="", namespaces=ATOM_NS))
        updated = parse_time(node.findtext("atom:updated", default="", namespaces=ATOM_NS))
        link = node.find("atom:link", ATOM_NS)
        url = link.attrib.get("href") if link is not None else f"https://www.youtube.com/watch?v={video_id}"
        entries.append(
            VideoEntry(
                video_id=video_id,
                channel_id=channel_id,
                channel_label=spec.label,
                title=title,
                url=url,
                author=str(author),
                published_at=published,
                updated_at=updated,
                raw={
                    "channel_key": spec.key,
                    "channel_label": spec.label,
                    "channel_id": channel_id,
                    "video_id": video_id,
                    "feed_updated_at": updated,
                },
            )
        )
    return entries


def fetch_channel_entries(spec: ChannelSpec, *, since: int, max_videos: int) -> Tuple[str, List[VideoEntry]]:
    channel_id = resolve_channel_id(spec)
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(channel_id)}"
    entries = parse_feed(http_get(feed_url), spec=spec, channel_id=channel_id)
    filtered = [entry for entry in entries if entry.published_at >= since]
    return channel_id, filtered[:max_videos]


def upsert_video(conn: sqlite3.Connection, entry: VideoEntry, *, now: int, dry_run: bool) -> str:
    source_post_id = f"youtube:{entry.video_id}:video"
    source_community = f"youtube:{slug(entry.channel_label)}"
    body = f"{entry.title}\nChannel: {entry.author}"
    if dry_run:
        return "dry_run"
    existing = conn.execute(
        "SELECT id FROM mi_raw_hits WHERE source_type = 'youtube_video' AND source_post_id = ?",
        (source_post_id,),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE mi_raw_hits
            SET title = ?, body_text = ?, source_url = ?, source_community = ?,
                author = ?, posted_at = ?, fetched_at = ?, raw_payload_json = ?
            WHERE id = ?
            """,
            (
                entry.title,
                body,
                entry.url,
                source_community,
                entry.author,
                entry.published_at,
                now,
                json.dumps(entry.raw, sort_keys=True),
                int(existing["id"]),
            ),
        )
        return "updated"
    conn.execute(
        """
        INSERT INTO mi_raw_hits (
            source_type, source_post_id, source_thread_id, source_url,
            source_community, author, title, body_text, posted_at, fetched_at,
            score, comment_count, matched_concept_ids_json, raw_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        """,
        (
            "youtube_video",
            source_post_id,
            entry.video_id,
            entry.url,
            source_community,
            entry.author,
            entry.title,
            body,
            entry.published_at,
            now,
            json.dumps([]),
            json.dumps(entry.raw, sort_keys=True),
        ),
    )
    return "inserted"


def run(
    *,
    db_path: Path,
    channels_file: Path,
    since_hours: int,
    max_videos_per_channel: int,
    fetch_transcripts: bool,
    max_transcript_chars: int,
    dry_run: bool,
) -> Dict[str, Any]:
    specs = [s for s in load_channel_specs(channels_file) if s.enabled]
    if not specs:
        return {
            "ok": True,
            "dry_run": dry_run,
            "status": "skipped",
            "reason": "no_channels_configured",
            "channels": [],
            "videos_seen": 0,
            "metadata_written": 0,
            "transcripts": {"attempted": 0, "inserted_or_updated": 0, "errors": 0},
        }
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        now = int(time.time())
        since = now - max(1, int(since_hours)) * 3600
        channel_results: List[Dict[str, Any]] = []
        all_urls: List[str] = []
        metadata_written = 0
        videos_seen = 0
        for spec in specs:
            try:
                channel_id, entries = fetch_channel_entries(
                    spec,
                    since=since,
                    max_videos=max(1, int(max_videos_per_channel)),
                )
                videos_seen += len(entries)
                statuses: Dict[str, int] = {}
                for entry in entries:
                    status = upsert_video(conn, entry, now=now, dry_run=dry_run)
                    statuses[status] = statuses.get(status, 0) + 1
                    if status in {"inserted", "updated", "dry_run"}:
                        metadata_written += 1
                    if fetch_transcripts and spec.fetch_transcripts:
                        all_urls.append(entry.url)
                channel_results.append(
                    {
                        "key": spec.key,
                        "label": spec.label,
                        "channel_id": channel_id,
                        "videos": len(entries),
                        "statuses": statuses,
                    }
                )
            except Exception as exc:
                channel_results.append(
                    {
                        "key": spec.key,
                        "label": spec.label,
                        "status": "error",
                        "error": str(exc),
                    }
                )
        transcript_summary = {"attempted": 0, "inserted_or_updated": 0, "errors": 0}
        if fetch_transcripts and all_urls:
            transcript_result = transcript_collector.run(
                db_path=db_path,
                urls=all_urls,
                dry_run=dry_run,
                normalize_only=False,
                max_transcript_chars=max(0, int(max_transcript_chars)),
                transcript_file=None,
                title=None,
                channel=None,
            )
            videos = transcript_result.get("videos", [])
            transcript_summary = {
                "attempted": len(videos),
                "inserted_or_updated": sum(1 for v in videos if v.get("status") in {"inserted", "updated", "dry_run"}),
                "errors": sum(1 for v in videos if v.get("status") == "error"),
            }
        if not dry_run:
            conn.commit()
        return {
            "ok": True,
            "dry_run": dry_run,
            "status": "ok",
            "channels": channel_results,
            "videos_seen": videos_seen,
            "metadata_written": metadata_written,
            "transcripts": transcript_summary,
        }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect YouTube channel RSS uploads into mi_raw_hits.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--channels-file", default=str(DEFAULT_CHANNELS_FILE))
    parser.add_argument("--since-hours", type=int, default=48)
    parser.add_argument("--max-videos-per-channel", type=int, default=5)
    parser.add_argument("--fetch-transcripts", action="store_true")
    parser.add_argument("--max-transcript-chars", type=int, default=120_000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(
        db_path=Path(args.db_path),
        channels_file=Path(args.channels_file),
        since_hours=args.since_hours,
        max_videos_per_channel=args.max_videos_per_channel,
        fetch_transcripts=bool(args.fetch_transcripts),
        max_transcript_chars=args.max_transcript_chars,
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
