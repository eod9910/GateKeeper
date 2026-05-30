#!/usr/bin/env python3
"""Discord intraday collector for the Market Intelligence engine.

Phase 1 fifth collector (PRD D29). Concept-keyed, mirrors the shape of
`collect_hackernews_intraday.py`, `collect_fourchan_intraday.py`,
`collect_bluesky_intraday.py`, and `collect_niche_forums.py` so the z-score
engine sees a consistent (concept_id, community, day) tuple regardless of
which platform produced the hit.

Pipeline:
    1. Resolve the bot token (CLI arg → DISCORD_BOT_TOKEN env → app-state
       Settings JSON document if mirrored). If no token is available, the
       collector returns a success envelope with auth_mode="skipped" so
       the scheduler can register the job without exploding pre-credentials.
    2. Load the server/channel allowlist from
       `backend/data/preferences/discord-servers.json` (operator-curated:
       guild_id, channel_id, server_slug, channel_slug, server_tier).
    3. Load active tracked_concepts (id, search_terms[], term_patterns[])
       from the DB.
    4. For each (guild, channel) pair, page back through
       `GET /channels/{channel.id}/messages?limit=100[&before=<snowflake>]`
       until the page's earliest message timestamp falls below `since_unix`
       OR we hit `--max-pages-per-channel`.
    5. For each message, run the word-boundary post-filter against every
       active concept's term_patterns. A single message can match multiple
       concepts — we merge.
    6. Upsert into mi_raw_hits, idempotent via UNIQUE (source_type,
       source_post_id). matched_concept_ids_json is set/merged.
    7. Rebuild concept_daily_counts for affected (concept_id, day) buckets
       using the same json_each rollup as the other collectors.

source_type values:
    "discord_message"  — every message regardless of channel type. Discord
                         exposes thread/forum messages via the same endpoint
                         shape, so we don't bother distinguishing OP-vs-reply
                         the way 4chan does. The raw_payload_json carries
                         the full message dict so a downstream concept-
                         extraction pass can dig if needed.

source_community: "discord:<server_slug>" — the per-server bucket the
    z-score engine z-scores against. Channel-level granularity is preserved
    in raw_payload_json + source_url. We deliberately bucket at server
    level (not channel) so a 12-channel server doesn't dilute its baseline
    into 12 separate pseudo-communities; the PRD's tracked-source
    cardinality assumes server-level granularity.

source_post_id: the Discord message snowflake id. Snowflakes are
    globally-unique 64-bit ints with the timestamp baked into the high bits,
    so they make a perfect idempotency key.

source_url: https://discord.com/channels/{guild_id}/{channel_id}/{message_id}
    — the canonical "Copy Message Link" format the Discord client surfaces.

"Multi-session" note (PRD checklist):
    Discord publishes a real-time WebSocket Gateway (gateway.discord.gg) that
    streams every event the bot has access to. We deliberately use the
    polling REST API instead because:
      (a) it slots into the same cron-tick scheduler model as HN/4chan/
          Bluesky/forums with no new long-lived process supervision required;
      (b) for tracked-concept search at our cadence (~50–200 concepts every
          15 min), polling each channel for the last hour of messages once
          per tick is well under Discord's 50 req/sec global rate limit;
      (c) the Gateway requires the privileged MESSAGE CONTENT INTENT plus
          GUILDS + GUILD_MESSAGES intents, all of which Discord verifies
          manually for any bot in 100+ servers. Polling needs only the
          message-content intent (still privileged but no manual review).
    A Gateway consumer is a Phase 5 upgrade IF we ever need lower latency
    or per-message reaction tracking. For now, polling is fine.

Operator setup:
    1. Create a Discord application at https://discord.com/developers/applications.
    2. Under "Bot", click "Add Bot", copy the token, set DISCORD_BOT_TOKEN.
    3. Enable "MESSAGE CONTENT INTENT" under Privileged Gateway Intents.
    4. Generate an OAuth2 invite URL with scopes=bot, permissions=
       View Channels + Read Message History (66560).
    5. Invite the bot to each server in `discord-servers.json`.
    6. Resolve channel ids in the Discord client (Settings → Advanced →
       Developer Mode → right-click channel → Copy Channel ID).

Day-bucket convention (matters for downstream baselines/z-scores):
    unix-epoch midnight UTC, in seconds: (posted_at // 86400) * 86400.
    topic_baselines.as_of_day MUST follow the same convention.

LLM-extracted fields (polarity_mean, intent_mix_json) are intentionally
left NULL here. Phase 1 (`run_concept_extraction.py`) populates them by
re-aggregating concept_mentions over the same daily buckets.

Zero external deps — uses stdlib urllib.request for the HTTP client.

Usage:
    py backend/scripts/collect_discord_intraday.py
    py backend/scripts/collect_discord_intraday.py --since-hours 6
    py backend/scripts/collect_discord_intraday.py --concept-keys ai_compute_shortage,tesla_fsd
    py backend/scripts/collect_discord_intraday.py --server-slugs wsb-public,fintwit-discord
    py backend/scripts/collect_discord_intraday.py --dry-run
    py backend/scripts/collect_discord_intraday.py --max-pages-per-channel 5

Output: JSON report on stdout (same envelope as the HN/4chan/Bluesky/forums
collectors, so the existing /collectors/:source_type/run wiring can
JSON.parse it directly).
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
DEFAULT_SERVERS_PATH = (
    ROOT / "backend" / "data" / "preferences" / "discord-servers.json"
)

EXPECTED_SCHEMA_VERSION = 5

# Discord REST API. v10 is current (Discord deprecates old major versions
# every ~18 months but maintains a 6-month overlap window).
DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_USER_AGENT = (
    "DiscordBot (https://github.com/pattern-detector/market-intelligence, 0.1) "
    "pattern-detector-mi/0.2 (Discord intraday collector)"
)

# Operator credential. Bot tokens are obtained from
# https://discord.com/developers/applications/<app_id>/bot. Format is
# `<base64_app_id>.<timestamp>.<hmac>` and they are rotatable.
DISCORD_BOT_TOKEN_ENV = "DISCORD_BOT_TOKEN"

# Discord snowflake → unix timestamp. The high 42 bits of a snowflake encode
# the millisecond timestamp since the Discord epoch (2015-01-01 00:00:00 UTC,
# i.e. 1420070400000 ms after the unix epoch).
# https://discord.com/developers/docs/reference#snowflakes
DISCORD_EPOCH_MS = 1420070400000

# Single source_type — Discord doesn't distinguish OPs from replies in any
# way that's meaningful for concept-keyed aggregation.
DISCORD_SOURCE_TYPE = "discord_message"

# Maximum messages per /channels/.../messages page per Discord docs.
DISCORD_MAX_PAGE_SIZE = 100


# ============================================================================
# Word-boundary post-filter (shared shape with HN/4chan/Bluesky/forums)
# ----------------------------------------------------------------------------
# Discord allows arbitrary unicode + emoji + code blocks + custom emoji
# notation like <:foo:1234567890>. Our defence is the same as the other
# collectors: word-boundary regex against the cleaned text so "GPT" doesn't
# match "GPTeen". Lookaround on \w correctly treats "+", "-", "$" and "#"
# as boundaries (so "C++" and "$NVDA" tokens still match).
# ============================================================================

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_DISCORD_CUSTOM_EMOJI_RE = re.compile(r"<a?:[A-Za-z0-9_]+:\d+>")
_DISCORD_MENTION_RE = re.compile(r"<[@#&!]?\d+>")


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
    """Discord message text can contain custom emoji tags, channel/role/user
    mentions, embedded HTML-ish chunks (rare, mostly from bot relays), and
    markdown. We strip the noisy noise so the word-boundary post-filter is
    consistent with the HN/Bluesky flow.
    """
    if not text:
        return ""
    flat = _DISCORD_CUSTOM_EMOJI_RE.sub(" ", text)
    flat = _DISCORD_MENTION_RE.sub(" ", flat)
    flat = _HTML_TAG_RE.sub(" ", flat)
    flat = html.unescape(flat)
    return _WS_RE.sub(" ", flat).strip()


def _hit_matches_term(text: Optional[str], term_pattern: Pattern[str]) -> bool:
    cleaned = _strip_text(text)
    if not cleaned:
        return False
    return bool(term_pattern.search(cleaned))


# ============================================================================
# Snowflake helpers
# ============================================================================


def _snowflake_to_unix(snowflake: Any) -> Optional[int]:
    """Return the unix-second timestamp encoded in a Discord snowflake, or
    None if the input is unparseable."""
    try:
        sf = int(snowflake)
    except (TypeError, ValueError):
        return None
    if sf <= 0:
        return None
    ms = (sf >> 22) + DISCORD_EPOCH_MS
    return ms // 1000


# ============================================================================
# DB helpers — copied verbatim from the Bluesky collector for consistency
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
# Server allowlist
# ----------------------------------------------------------------------------
# Operators curate this file by hand; the bot can technically discover
# channels via GET /guilds/{id}/channels, but channel id stability is not
# enforced and we want explicit operator review of which channels the bot
# is allowed to scrape.
#
# Schema (per server entry):
#   {
#     "server_slug": "wsb-public",                        # bucket key
#     "guild_id": "1234567890123456789",                  # Discord snowflake
#     "server_name": "WallStreetBets — public mirror",    # for ops UI
#     "server_tier": "general",                           # niche|general|mega
#     "channels": [
#       { "channel_id": "...", "channel_slug": "general",  "channel_name": "general" },
#       { "channel_id": "...", "channel_slug": "dd",       "channel_name": "dd" }
#     ]
#   }
# ============================================================================


def _load_server_allowlist(
    path: Path,
    *,
    only_slugs: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError) as err:
        raise SystemExit(f"Failed to parse {path}: {err}") from err

    servers_raw: List[Any]
    if isinstance(payload, list):
        servers_raw = payload
    elif isinstance(payload, dict) and isinstance(payload.get("servers"), list):
        servers_raw = payload["servers"]
    else:
        raise SystemExit(
            f"{path} must be a list of servers OR an object with a 'servers' list"
        )

    out: List[Dict[str, Any]] = []
    for entry in servers_raw:
        if not isinstance(entry, dict):
            continue
        slug = str(entry.get("server_slug") or "").strip()
        guild_id = str(entry.get("guild_id") or "").strip()
        if not slug or not guild_id:
            continue
        if only_slugs is not None and slug not in only_slugs:
            continue
        channels_raw = entry.get("channels")
        if not isinstance(channels_raw, list):
            continue
        channels: List[Dict[str, str]] = []
        for ch in channels_raw:
            if not isinstance(ch, dict):
                continue
            ch_id = str(ch.get("channel_id") or "").strip()
            if not ch_id:
                continue
            channels.append({
                "channel_id": ch_id,
                "channel_slug": str(ch.get("channel_slug") or "").strip(),
                "channel_name": str(ch.get("channel_name") or "").strip(),
            })
        if not channels:
            continue
        out.append({
            "server_slug": slug,
            "guild_id": guild_id,
            "server_name": str(entry.get("server_name") or "").strip() or slug,
            "server_tier": str(entry.get("server_tier") or "general").strip(),
            "channels": channels,
        })
    return out


# ============================================================================
# Discord HTTP client (token-aware, 429-respecting)
# ============================================================================


class DiscordRateLimitError(RuntimeError):
    """Raised on a 429 we couldn't satisfy by sleeping inside the request."""


def _resolve_bot_token(arg_token: Optional[str]) -> Optional[str]:
    """Token precedence:
       1. --bot-token CLI arg
       2. $DISCORD_BOT_TOKEN env var
       3. None (collector enters skipped mode and exits cleanly)
    Mirrors how aiSettings.ts resolves OpenAI keys: explicit > env > skip.
    """
    if arg_token and arg_token.strip():
        return arg_token.strip()
    env_token = os.environ.get(DISCORD_BOT_TOKEN_ENV, "")
    if env_token and env_token.strip():
        return env_token.strip()
    return None


def _fetch_messages(
    token: str,
    channel_id: str,
    *,
    before: Optional[str],
    limit: int,
    timeout: float,
    max_429_retries: int = 3,
) -> List[Dict[str, Any]]:
    """Fetch up to `limit` messages from a channel, optionally before a given
    snowflake. Honours 429 with Retry-After / X-RateLimit-Reset-After.

    Returns [] for 403/404 (bot not in channel / channel deleted) and logs
    the WARN to stderr so a single broken channel doesn't kill the run.
    """
    params: Dict[str, str] = {"limit": str(limit)}
    if before:
        params["before"] = before
    url = (
        f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
        f"?{urllib.parse.urlencode(params)}"
    )

    attempts = 0
    while True:
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bot {token}",
                "User-Agent": DISCORD_USER_AGENT,
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code == 429 and attempts < max_429_retries:
                # Respect Discord's per-route rate limit. Retry-After header
                # is in seconds and may be fractional. Bump attempts so a
                # buggy channel doesn't loop forever.
                retry_after = err.headers.get("Retry-After") or "1"
                try:
                    sleep_s = max(0.0, float(retry_after))
                except ValueError:
                    sleep_s = 1.0
                # Discord recommends adding ~250ms jitter on top of the
                # advertised window to avoid synchronised retries from a
                # restarted scheduler hitting the same wall.
                time.sleep(sleep_s + 0.25)
                attempts += 1
                continue
            if err.code in (403, 404):
                print(
                    f"[discord] WARN: channel_id={channel_id} HTTP {err.code} "
                    f"({err.reason}); skipping. Bot may not be in this "
                    "channel or the channel may have been deleted.",
                    file=sys.stderr,
                )
                return []
            if err.code == 401:
                raise SystemExit(
                    "[discord] FATAL: HTTP 401 Unauthorized. Bot token is "
                    "invalid or revoked. Regenerate it in the Discord "
                    "developer portal and update DISCORD_BOT_TOKEN."
                )
            print(
                f"[discord] WARN: channel_id={channel_id} HTTP {err.code} "
                f"({err.reason}); skipping page.",
                file=sys.stderr,
            )
            return []
        except urllib.error.URLError as err:
            print(
                f"[discord] WARN: channel_id={channel_id} request failed: "
                f"{err}; skipping page.",
                file=sys.stderr,
            )
            return []


def _iter_channel_messages(
    token: str,
    channel_id: str,
    *,
    since_unix: int,
    max_pages: int,
    page_size: int,
    timeout: float,
    sleep_ms: int,
) -> Iterable[Dict[str, Any]]:
    """Yield messages newest-first across up to `max_pages` pages, stopping
    early when the page's earliest message timestamp falls below
    `since_unix`. Discord returns messages in id-descending (newest-first)
    order, which matches our lookback model.
    """
    before: Optional[str] = None
    for page in range(max_pages):
        messages = _fetch_messages(
            token,
            channel_id,
            before=before,
            limit=page_size,
            timeout=timeout,
        )
        if not messages:
            return

        crossed_window = False
        oldest_id_on_page: Optional[str] = None
        for msg in messages:
            msg_id = msg.get("id")
            if not isinstance(msg_id, str):
                continue
            ts = _snowflake_to_unix(msg_id)
            if ts is None:
                continue
            yield msg
            oldest_id_on_page = msg_id
            if ts < since_unix:
                crossed_window = True

        if crossed_window:
            return
        if not oldest_id_on_page:
            return
        # Discord pagination uses snowflakes directly: ?before=<id> returns
        # messages strictly older than that id. Don't reset the cursor mid-
        # collection — page after page just walks further into the past.
        if before == oldest_id_on_page:
            return
        before = oldest_id_on_page

        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)


# ============================================================================
# Hit normalisation
# ============================================================================


def _normalize_message(
    msg: Dict[str, Any],
    *,
    guild_id: str,
    channel_id: str,
    server_slug: str,
    channel_slug: str,
) -> Optional[Dict[str, Any]]:
    """Map a Discord REST message → mi_raw_hits row dict. Returns None if
    we can't get a stable identifier or timestamp."""
    msg_id = msg.get("id")
    if not isinstance(msg_id, str) or not msg_id:
        return None
    posted_at = _snowflake_to_unix(msg_id)
    if posted_at is None:
        return None

    body_text: Optional[str] = None
    raw_content = msg.get("content")
    if isinstance(raw_content, str) and raw_content:
        body_text = raw_content
    # Embeds (link previews, bot-posted rich cards) carry text in
    # `title` + `description` + nested `fields`. We concatenate them onto
    # body_text so word-boundary matching catches them too.
    embeds = msg.get("embeds")
    if isinstance(embeds, list):
        embed_chunks: List[str] = []
        for emb in embeds:
            if not isinstance(emb, dict):
                continue
            for k in ("title", "description"):
                v = emb.get(k)
                if isinstance(v, str) and v:
                    embed_chunks.append(v)
            fields = emb.get("fields")
            if isinstance(fields, list):
                for f in fields:
                    if not isinstance(f, dict):
                        continue
                    for k in ("name", "value"):
                        v = f.get(k)
                        if isinstance(v, str) and v:
                            embed_chunks.append(v)
        if embed_chunks:
            embed_blob = "\n".join(embed_chunks)
            body_text = f"{body_text}\n{embed_blob}" if body_text else embed_blob

    author_label: Optional[str] = None
    author = msg.get("author")
    if isinstance(author, dict):
        username = author.get("username")
        if isinstance(username, str) and username:
            author_label = username
        elif isinstance(author.get("id"), str):
            author_label = str(author["id"])

    # Discord doesn't expose a per-message score. Reactions provide a
    # rough engagement proxy; sum total counts across reactions for a
    # single integer.
    score: Optional[int] = None
    reactions = msg.get("reactions")
    if isinstance(reactions, list):
        total = 0
        for r in reactions:
            if not isinstance(r, dict):
                continue
            c = r.get("count")
            if isinstance(c, (int, float)):
                total += int(c)
        score = total if total > 0 else None

    # Reply count is harder than on Bluesky — Discord doesn't return it on
    # the bare message dict (you'd need GET /channels/{id}/messages/{id}/
    # threads or the channel-thread sidecar). Leave NULL for v1.
    comment_count: Optional[int] = None

    source_url = (
        f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"
    )
    community_key = f"discord:{server_slug}" if server_slug else "discord:unknown"
    title_label: Optional[str] = None
    if channel_slug:
        title_label = f"#{channel_slug}"

    return {
        "source_type": DISCORD_SOURCE_TYPE,
        "source_post_id": msg_id,
        # Discord threads have a parent_message via msg.message_reference;
        # for non-thread channels this is None. Use it as the thread id
        # when present so a downstream concept-mention rollup can group
        # replies together.
        "source_thread_id": _extract_thread_id(msg, channel_id),
        "source_url": source_url,
        "source_community": community_key,
        "author": author_label,
        "title": title_label,
        "body_text": body_text,
        "posted_at": posted_at,
        "score": score,
        "comment_count": comment_count,
        "raw_payload_json": json.dumps(msg, separators=(",", ":"), sort_keys=True),
    }


def _extract_thread_id(msg: Dict[str, Any], channel_id: str) -> Optional[str]:
    """Return the parent thread/message id for a reply, or None if standalone.

    Discord's thread model puts the thread itself as a sub-channel of the
    parent text channel; messages inside the thread carry the thread's
    channel id under msg.channel_id (which may not match the channel we
    polled if we're polling the parent + Discord backfilled a few thread
    messages into the parent feed). Messages that are direct replies in a
    plain channel carry a `message_reference.message_id`.
    """
    ref = msg.get("message_reference")
    if isinstance(ref, dict):
        ref_msg_id = ref.get("message_id")
        if isinstance(ref_msg_id, str) and ref_msg_id:
            return ref_msg_id
    msg_channel_id = msg.get("channel_id")
    if isinstance(msg_channel_id, str) and msg_channel_id and msg_channel_id != channel_id:
        # Polled the parent channel but got a thread message back; treat the
        # thread channel id as the thread root.
        return msg_channel_id
    return None


def _day_bucket(posted_at: int) -> int:
    return (int(posted_at) // 86400) * 86400


# ============================================================================
# Persistence — same upsert + count-refresh pattern as the Bluesky collector
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

        # Existing row — merge concept ids only. Discord reaction counts
        # DO drift over time, but we deliberately don't update them on a
        # re-run to keep mi_raw_hits append-only and avoid silent baseline
        # drift. The first-fetch snapshot is the one that flows into
        # concept_daily_counts.
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
    """Affected tuples are (concept_id, day, community) because Discord
    distributes hits across many per-server communities (`discord:wsb-public`,
    `discord:fintwit-discord`, ...). Each gets its own daily-count row so the
    z-score engine baselines per-community independently."""
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
    servers_path: Path,
    bot_token: Optional[str],
    since_hours: int,
    max_pages_per_channel: int,
    page_size: int,
    only_concept_keys: Optional[Set[str]],
    only_server_slugs: Optional[Set[str]],
    request_timeout: float,
    sleep_ms: int,
    dry_run: bool,
) -> Dict[str, Any]:
    fetched_at = int(time.time())
    since_unix = fetched_at - max(1, since_hours) * 3600

    # Skip-mode: bot token missing → return success envelope, no API calls.
    # Lets the scheduler register discord_collector before the operator has
    # finished bot setup without polluting last_error.
    if not bot_token:
        return {
            "db_path": str(db_path),
            "servers_path": str(servers_path),
            "schema_version": None,
            "dry_run": dry_run,
            "since_hours": since_hours,
            "since_unix": since_unix,
            "fetched_at": fetched_at,
            "auth_mode": "skipped",
            "auth_error": (
                f"No bot token resolved (checked --bot-token + "
                f"${DISCORD_BOT_TOKEN_ENV}). Collector exited cleanly without "
                "making any Discord API calls."
            ),
            "servers_loaded": 0,
            "channels_polled": 0,
            "concepts_processed": 0,
            "raw_hits_seen": 0,
            "filter_rejects": 0,
            "window_rejects": 0,
            "unique_messages": 0,
            "affected_buckets": 0,
            "daily_counts_refreshed": 0,
            "mi_raw_hits": {"inserted": 0, "merged": 0, "unchanged": 0},
            "per_channel": [],
        }

    servers = _load_server_allowlist(servers_path, only_slugs=only_server_slugs)
    if not servers:
        # Allowlist file missing or empty — still success, just no work.
        # The scheduler will keep retrying every cron tick; the operator
        # populates discord-servers.json once they've invited the bot.
        return {
            "db_path": str(db_path),
            "servers_path": str(servers_path),
            "schema_version": None,
            "dry_run": dry_run,
            "since_hours": since_hours,
            "since_unix": since_unix,
            "fetched_at": fetched_at,
            "auth_mode": "skipped",
            "auth_error": (
                f"Server allowlist {servers_path} missing or empty. "
                "Populate it with the operator-curated list of servers + "
                "channels the bot has access to."
            ),
            "servers_loaded": 0,
            "channels_polled": 0,
            "concepts_processed": 0,
            "raw_hits_seen": 0,
            "filter_rejects": 0,
            "window_rejects": 0,
            "unique_messages": 0,
            "affected_buckets": 0,
            "daily_counts_refreshed": 0,
            "mi_raw_hits": {"inserted": 0, "merged": 0, "unchanged": 0},
            "per_channel": [],
        }

    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)
        concepts = _load_active_concepts(conn, only_keys=only_concept_keys)

        rows_with_concepts: Dict[
            Tuple[str, str], Tuple[Dict[str, Any], Set[int]]
        ] = {}
        affected_buckets: Set[Tuple[int, int, str]] = set()

        per_channel_counts: List[Dict[str, Any]] = []
        total_filter_rejects = 0
        total_window_rejects = 0
        channels_polled = 0

        for server in servers:
            for channel in server["channels"]:
                channels_polled += 1
                channel_total_hits = 0
                channel_filter_rejects = 0
                channel_window_rejects = 0
                channel_messages_seen = 0

                for msg in _iter_channel_messages(
                    bot_token,
                    channel["channel_id"],
                    since_unix=since_unix,
                    max_pages=max_pages_per_channel,
                    page_size=page_size,
                    timeout=request_timeout,
                    sleep_ms=sleep_ms,
                ):
                    channel_messages_seen += 1
                    normalized = _normalize_message(
                        msg,
                        guild_id=server["guild_id"],
                        channel_id=channel["channel_id"],
                        server_slug=server["server_slug"],
                        channel_slug=channel["channel_slug"],
                    )
                    if normalized is None:
                        continue
                    if normalized["posted_at"] < since_unix:
                        channel_window_rejects += 1
                        total_window_rejects += 1
                        continue

                    matched_for_msg: Set[int] = set()
                    text_for_match = normalized.get("body_text") or normalized.get("title")
                    if not text_for_match:
                        continue
                    for concept in concepts:
                        for term_pattern in concept["term_patterns"]:
                            if _hit_matches_term(text_for_match, term_pattern):
                                matched_for_msg.add(concept["id"])
                                break

                    if not matched_for_msg:
                        channel_filter_rejects += 1
                        total_filter_rejects += 1
                        continue

                    key = (
                        normalized["source_type"],
                        normalized["source_post_id"],
                    )
                    if key in rows_with_concepts:
                        rows_with_concepts[key][1].update(matched_for_msg)
                    else:
                        rows_with_concepts[key] = (normalized, matched_for_msg)

                    bucket_day = _day_bucket(normalized["posted_at"])
                    for cid in matched_for_msg:
                        affected_buckets.add(
                            (cid, bucket_day, normalized["source_community"])
                        )
                    channel_total_hits += 1

                per_channel_counts.append({
                    "server_slug": server["server_slug"],
                    "guild_id": server["guild_id"],
                    "channel_id": channel["channel_id"],
                    "channel_slug": channel["channel_slug"],
                    "messages_seen": channel_messages_seen,
                    "raw_hits_observed": channel_total_hits,
                    "filter_rejects": channel_filter_rejects,
                    "window_rejects": channel_window_rejects,
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
        "servers_path": str(servers_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "since_hours": since_hours,
        "since_unix": since_unix,
        "fetched_at": fetched_at,
        "auth_mode": "authenticated",
        "auth_error": None,
        "servers_loaded": len(servers),
        "channels_polled": channels_polled,
        "concepts_processed": len(concepts),
        "raw_hits_seen": sum(p["raw_hits_observed"] for p in per_channel_counts),
        "filter_rejects": total_filter_rejects,
        "window_rejects": total_window_rejects,
        "unique_messages": len(rows_with_concepts),
        "affected_buckets": len(affected_buckets),
        "daily_counts_refreshed": refreshed,
        "mi_raw_hits": upsert_report,
        "per_channel": per_channel_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Concept-keyed Discord collector for Market Intelligence."
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--servers-path",
        type=Path,
        default=DEFAULT_SERVERS_PATH,
        help="Path to discord-servers.json operator allowlist.",
    )
    parser.add_argument(
        "--since-hours",
        type=int,
        default=24,
        help="Look back this many hours from now.",
    )
    parser.add_argument(
        "--max-pages-per-channel",
        type=int,
        default=3,
        help="Max /messages pages per channel. 100 messages/page.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Discord limit per page (max 100).",
    )
    parser.add_argument(
        "--concept-keys",
        type=str,
        default="",
        help="Comma-separated concept_keys to limit collection (default: all active).",
    )
    parser.add_argument(
        "--server-slugs",
        type=str,
        default="",
        help="Comma-separated server_slugs to limit collection (default: all).",
    )
    parser.add_argument("--request-timeout", type=float, default=10.0)
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=300,
        help="Delay between Discord requests to be a polite client. The "
             "global rate limit is 50 req/sec; 300ms is well under and gives "
             "headroom for burst recovery without tripping per-route limits.",
    )
    parser.add_argument(
        "--bot-token",
        type=str,
        default=None,
        help=(
            f"Discord bot token. Falls back to ${DISCORD_BOT_TOKEN_ENV} env "
            f"var. Get it from https://discord.com/developers/applications/"
            f"<app>/bot. Bot must have MESSAGE CONTENT INTENT enabled and be "
            f"invited to every guild listed in discord-servers.json."
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    bot_token = _resolve_bot_token(args.bot_token)

    if args.page_size < 1 or args.page_size > DISCORD_MAX_PAGE_SIZE:
        print(
            f"--page-size must be between 1 and {DISCORD_MAX_PAGE_SIZE} "
            f"(got {args.page_size})",
            file=sys.stderr,
        )
        return 2

    only_concept_keys: Optional[Set[str]] = None
    if args.concept_keys.strip():
        only_concept_keys = {
            k.strip() for k in args.concept_keys.split(",") if k.strip()
        }

    only_server_slugs: Optional[Set[str]] = None
    if args.server_slugs.strip():
        only_server_slugs = {
            s.strip() for s in args.server_slugs.split(",") if s.strip()
        }

    report = collect(
        db_path=args.db_path,
        servers_path=args.servers_path,
        bot_token=bot_token,
        since_hours=args.since_hours,
        max_pages_per_channel=args.max_pages_per_channel,
        page_size=args.page_size,
        only_concept_keys=only_concept_keys,
        only_server_slugs=only_server_slugs,
        request_timeout=args.request_timeout,
        sleep_ms=args.sleep_ms,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
