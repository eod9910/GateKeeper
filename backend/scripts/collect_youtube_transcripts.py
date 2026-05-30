#!/usr/bin/env python3
"""
Collect YouTube transcripts into Market Intelligence raw hits.

Supports normal YouTube URLs, youtu.be links, and Shorts URLs. Shorts are
normalized to canonical watch URLs before storage:

    https://www.youtube.com/shorts/<id> -> https://www.youtube.com/watch?v=<id>

The collector uses YouTube's public caption tracks when available. It stores
one append-only-ish row per video in mi_raw_hits with source_type
`youtube_transcript` and a raw payload containing video metadata and the
canonical URL.
"""

from __future__ import annotations

import argparse
import html
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
from typing import Any, Dict, Iterable, List, Optional, Sequence


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 7
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


@dataclass
class YoutubeUrl:
    video_id: str
    original_url: str
    canonical_url: str
    was_short: bool


@dataclass
class TranscriptPayload:
    url: YoutubeUrl
    title: str
    channel: str
    published_at: int
    transcript: str
    caption_language: str
    caption_kind: str
    raw_metadata: Dict[str, Any]


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[youtube] DB missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(row["value"]) if row and str(row["value"]).isdigit() else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[youtube] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def normalize_youtube_url(value: str) -> YoutubeUrl:
    raw = value.strip()
    if not raw:
        raise ValueError("empty YouTube URL")
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        video_id = raw
        was_short = False
    else:
        parsed = urllib.parse.urlparse(raw)
        host = parsed.netloc.lower().replace("www.", "")
        path_parts = [p for p in parsed.path.split("/") if p]
        query = urllib.parse.parse_qs(parsed.query)
        was_short = False
        video_id = ""
        if host in {"youtube.com", "m.youtube.com"}:
            if path_parts and path_parts[0] == "shorts" and len(path_parts) >= 2:
                video_id = path_parts[1]
                was_short = True
            elif path_parts and path_parts[0] in {"watch", "live"}:
                video_id = (query.get("v") or [""])[0] or (path_parts[1] if len(path_parts) >= 2 else "")
            elif path_parts and path_parts[0] == "embed" and len(path_parts) >= 2:
                video_id = path_parts[1]
        elif host == "youtu.be" and path_parts:
            video_id = path_parts[0]
        else:
            # Last-resort: find an 11-char id in copied URLs.
            m = re.search(r"(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])", raw)
            video_id = m.group(1) if m else ""
        video_id = video_id.split("?")[0].split("&")[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError(f"could not extract YouTube video id from {value!r}")
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    return YoutubeUrl(video_id=video_id, original_url=raw, canonical_url=canonical, was_short=was_short)


def read_urls(args: argparse.Namespace) -> List[str]:
    urls: List[str] = []
    urls.extend(args.url or [])
    if args.urls_file:
        path = Path(args.urls_file)
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s and not s.startswith("#"):
                urls.append(s)
    return urls


def http_get(url: str, *, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def extract_json_object(text: str, marker: str) -> Dict[str, Any]:
    idx = text.find(marker)
    if idx < 0:
        return {}
    start = text.find("{", idx)
    if start < 0:
        return {}
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except Exception:
                    return {}
    return {}


def parse_publish_time(player: Dict[str, Any]) -> int:
    details = player.get("microformat", {}).get("playerMicroformatRenderer", {})
    date = str(details.get("publishDate") or details.get("uploadDate") or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return int(time.mktime(time.strptime(date, "%Y-%m-%d")))
    return int(time.time())


def select_caption_track(player: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    tracks = (
        player.get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not isinstance(tracks, list) or not tracks:
        return None
    preferred = []
    preferred.extend(t for t in tracks if str(t.get("languageCode", "")).lower().startswith("en") and t.get("kind") != "asr")
    preferred.extend(t for t in tracks if str(t.get("languageCode", "")).lower().startswith("en"))
    preferred.extend(t for t in tracks if t.get("kind") != "asr")
    preferred.extend(tracks)
    return preferred[0] if preferred else None


def caption_url_with_format(base_url: str, fmt: str) -> str:
    parsed = urllib.parse.urlparse(base_url)
    query = urllib.parse.parse_qs(parsed.query)
    query["fmt"] = [fmt]
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))


def transcript_from_json3(text: str) -> str:
    try:
        data = json.loads(text)
    except Exception:
        return ""
    events = data.get("events", []) if isinstance(data, dict) else []
    parts: List[str] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        segs = event.get("segs", [])
        if not isinstance(segs, list):
            continue
        line = "".join(str(seg.get("utf8", "")) for seg in segs if isinstance(seg, dict))
        line = html.unescape(line).strip()
        if line:
            parts.append(re.sub(r"\s+", " ", line))
    return "\n".join(parts)


def transcript_from_xml(text: str) -> str:
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return ""
    parts: List[str] = []
    for node in root.iter():
        if node.tag.endswith("text") and node.text:
            text = html.unescape(node.text).strip()
            if text:
                parts.append(re.sub(r"\s+", " ", text))
    return "\n".join(parts)


def fetch_transcript(track: Dict[str, Any]) -> str:
    base_url = str(track.get("baseUrl") or "")
    if not base_url:
        return ""
    attempts = [
        caption_url_with_format(base_url, "json3"),
        caption_url_with_format(base_url, "srv3"),
        base_url,
    ]
    for url in attempts:
        body = http_get(url)
        transcript = transcript_from_json3(body) if "json3" in url else transcript_from_xml(body)
        if transcript:
            return transcript
    return ""


def fetch_payload(url: YoutubeUrl, *, max_transcript_chars: int) -> TranscriptPayload:
    page = http_get(url.canonical_url)
    player = extract_json_object(page, "ytInitialPlayerResponse")
    if not player:
        raise RuntimeError(f"could not parse YouTube player metadata for {url.video_id}")
    details = player.get("videoDetails", {}) if isinstance(player.get("videoDetails"), dict) else {}
    title = str(details.get("title") or f"YouTube video {url.video_id}")
    channel = str(details.get("author") or "youtube")
    track = select_caption_track(player)
    if not track:
        raise RuntimeError(f"no transcript/caption track available for {url.video_id}")
    transcript = fetch_transcript(track)
    if not transcript:
        raise RuntimeError(f"caption track was empty for {url.video_id}")
    if max_transcript_chars > 0:
        transcript = transcript[:max_transcript_chars]
    return TranscriptPayload(
        url=url,
        title=title,
        channel=channel,
        published_at=parse_publish_time(player),
        transcript=transcript,
        caption_language=str(track.get("languageCode") or ""),
        caption_kind=str(track.get("kind") or "manual"),
        raw_metadata={
            "video_id": url.video_id,
            "original_url": url.original_url,
            "canonical_url": url.canonical_url,
            "was_short": url.was_short,
            "title": title,
            "channel": channel,
            "caption_language": str(track.get("languageCode") or ""),
            "caption_kind": str(track.get("kind") or "manual"),
        },
    )


def payload_from_transcript_file(
    url: YoutubeUrl,
    *,
    transcript_file: Path,
    title: Optional[str],
    channel: Optional[str],
    max_transcript_chars: int,
) -> TranscriptPayload:
    transcript = transcript_file.read_text(encoding="utf-8").strip()
    if max_transcript_chars > 0:
        transcript = transcript[:max_transcript_chars]
    if not transcript:
        raise RuntimeError(f"transcript file is empty: {transcript_file}")
    clean_title = title or f"YouTube transcript {url.video_id}"
    clean_channel = channel or "youtube"
    return TranscriptPayload(
        url=url,
        title=clean_title,
        channel=clean_channel,
        published_at=int(time.time()),
        transcript=transcript,
        caption_language="operator",
        caption_kind="operator_file",
        raw_metadata={
            "video_id": url.video_id,
            "original_url": url.original_url,
            "canonical_url": url.canonical_url,
            "was_short": url.was_short,
            "title": clean_title,
            "channel": clean_channel,
            "caption_language": "operator",
            "caption_kind": "operator_file",
            "transcript_file": str(transcript_file),
        },
    )


def upsert_payload(conn: sqlite3.Connection, payload: TranscriptPayload, *, now: int) -> str:
    source_post_id = f"youtube:{payload.url.video_id}:transcript"
    existing = conn.execute(
        "SELECT id, body_text FROM mi_raw_hits WHERE source_type = 'youtube_transcript' AND source_post_id = ?",
        (source_post_id,),
    ).fetchone()
    if existing:
        if str(existing["body_text"] or "") == payload.transcript:
            return "unchanged"
        conn.execute(
            """
            UPDATE mi_raw_hits
            SET title = ?, body_text = ?, source_url = ?, fetched_at = ?,
                raw_payload_json = ?
            WHERE id = ?
            """,
            (
                payload.title,
                payload.transcript,
                payload.url.canonical_url,
                now,
                json.dumps(payload.raw_metadata, sort_keys=True),
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
            "youtube_transcript",
            source_post_id,
            payload.url.video_id,
            payload.url.canonical_url,
            f"youtube:{payload.channel}".lower().replace(" ", "_")[:120],
            payload.channel,
            payload.title,
            payload.transcript,
            payload.published_at,
            now,
            json.dumps([]),
            json.dumps(payload.raw_metadata, sort_keys=True),
        ),
    )
    return "inserted"


def run(
    *,
    db_path: Path,
    urls: Sequence[str],
    dry_run: bool,
    normalize_only: bool,
    max_transcript_chars: int,
    transcript_file: Optional[Path],
    title: Optional[str],
    channel: Optional[str],
) -> Dict[str, Any]:
    normalized = [normalize_youtube_url(u) for u in urls]
    if normalize_only:
        return {
            "ok": True,
            "dry_run": dry_run,
            "normalize_only": True,
            "videos": [u.__dict__ for u in normalized],
        }
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        now = int(time.time())
        results = []
        for url in normalized:
            try:
                if transcript_file is not None:
                    if len(normalized) != 1:
                        raise RuntimeError("--transcript-file can only be used with one --url")
                    payload = payload_from_transcript_file(
                        url,
                        transcript_file=transcript_file,
                        title=title,
                        channel=channel,
                        max_transcript_chars=max_transcript_chars,
                    )
                else:
                    payload = fetch_payload(url, max_transcript_chars=max_transcript_chars)
                status = "dry_run" if dry_run else upsert_payload(conn, payload, now=now)
                results.append({
                    "video_id": url.video_id,
                    "canonical_url": url.canonical_url,
                    "was_short": url.was_short,
                    "title": payload.title,
                    "transcript_chars": len(payload.transcript),
                    "status": status,
                })
            except Exception as exc:
                results.append({
                    "video_id": url.video_id,
                    "canonical_url": url.canonical_url,
                    "was_short": url.was_short,
                    "status": "error",
                    "error": str(exc),
                })
        if not dry_run:
            conn.commit()
        return {
            "ok": True,
            "dry_run": dry_run,
            "normalize_only": False,
            "videos": results,
        }
    finally:
        conn.close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Collect YouTube transcripts into mi_raw_hits.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--url", action="append", help="YouTube watch, youtu.be, Shorts URL, or video id")
    parser.add_argument("--urls-file", help="Optional newline-delimited URL file")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--normalize-only", action="store_true")
    parser.add_argument("--max-transcript-chars", type=int, default=120_000)
    parser.add_argument("--transcript-file", help="Optional operator-copied transcript file for one URL")
    parser.add_argument("--title", help="Optional title used with --transcript-file")
    parser.add_argument("--channel", help="Optional channel used with --transcript-file")
    args = parser.parse_args(argv)

    urls = read_urls(args)
    if not urls:
        print(json.dumps(
            {
                "ok": True,
                "dry_run": bool(args.dry_run),
                "normalize_only": bool(args.normalize_only),
                "videos": [],
                "status": "skipped",
                "reason": "no_urls_configured",
            },
            indent=2,
        ))
        return 0
    print(json.dumps(run(
        db_path=Path(args.db_path),
        urls=urls,
        dry_run=bool(args.dry_run),
        normalize_only=bool(args.normalize_only),
        max_transcript_chars=max(0, int(args.max_transcript_chars)),
        transcript_file=Path(args.transcript_file) if args.transcript_file else None,
        title=args.title,
        channel=args.channel,
    ), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
