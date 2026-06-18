"""Collect social posts from Reddit finance subreddits via public .json endpoints.

No authentication required — uses Reddit's unauthenticated JSON interface
(10 req/min rate limit). Polls subreddits for recent posts, extracts ticker
mentions, and feeds rows into the same social-intelligence.sqlite tables
used by StockTwits + Yahoo Finance collection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.social_intelligence_db import SocialIntelligenceDb
from backend.services.social_text_quality import (
    content_dedup_key as _content_dedup_key,
    score_spam as _score_spam,
    classify_topic as _classify_topic,
)

DATA_DIR = ROOT / "backend" / "data"
DEFAULT_UNIVERSE_PATH = DATA_DIR / "universe_clean.json"

DEFAULT_SUBREDDITS = ["wallstreetbets", "stocks", "investing", "options", "StockMarket"]

USER_AGENT = "PatternDetector/1.0 (social-intelligence-collector)"

TICKER_BLACKLIST: FrozenSet[str] = frozenset({
    "DD", "TA", "FD", "IV", "OI", "PM", "AH", "ATH", "EOD", "EPS", "PE",
    "CEO", "IPO", "ETF", "SEC", "GDP", "CPI", "FOMC", "IMO", "FOMO", "YOLO",
    "FYI", "LOL", "WTF", "OMG", "TLDR", "TL", "DR", "USA", "FBI", "IRS",
    "HODL", "DCA", "RSI", "SMA", "EMA", "MACD", "VWAP", "RR", "ITM", "OTM",
    "ATM", "DTE", "YTD", "QOQ", "YOY", "MOM", "WOW", "LMAO", "SMH", "IMO",
    "NSFW", "PSA", "TIL", "EDIT", "RIP", "PUTS", "CALL", "CALLS", "PUT",
    "LONG", "SHORT", "BUY", "SELL", "HOLD", "MOON", "APE", "APES", "TENDIES",
    "BAGS", "PUMP", "DUMP", "DIP", "DIPS", "RUN", "BULL", "BEAR", "GREEN",
    "RED", "GAIN", "LOSS", "MOVE", "PLAY", "SAFE", "RISK", "DEBT", "CASH",
    "FREE", "HIGH", "LOW", "OPEN", "CLOSE", "NEXT", "BEST", "GOOD", "REAL",
    "NEW", "NOW", "ALL", "ARE", "FOR", "THE", "HAS", "HAD", "CAN", "HIS",
    "HER", "ITS", "OUR", "WHO", "HOW", "WHY", "NOT", "YES", "TOP", "BIG",
    "OLD", "WAR", "OIL", "GAS", "FED", "GO", "UP", "OR", "AN", "AT", "BY",
    "DO", "IF", "IN", "IS", "IT", "MY", "NO", "OF", "ON", "SO", "TO", "WE",
    "AI", "UK", "EU", "US", "UN", "TV", "PC", "CEO", "CFO", "COO", "CTO",
    "LLC", "INC", "LTD", "EST", "AVG", "MAX", "MIN", "NET", "ROI", "ROE",
    "ROA", "DCF", "NAV", "FCF", "TTM", "FWD", "REV", "DIV", "EV", "MKT",
    "VOL", "BID", "ASK", "GAP", "LEG", "LOT", "OTC", "PRE", "POST",
})

CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")
BARE_TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")


def _clean_text(value: Any) -> str:
    text = str(value or "").replace("&#39;", "'").replace("&amp;", "&").strip()
    return re.sub(r"\s+", " ", text)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_symbols_from_universe(path: Path) -> List[str]:
    payload = load_json(path)
    stocks = payload.get("stocks") or []
    symbols: List[str] = []
    seen: Set[str] = set()
    for stock in stocks:
        symbol = str((stock or {}).get("symbol") or (stock or {}).get("ticker") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


# ---------------------------------------------------------------------------
# Reddit fetch
# ---------------------------------------------------------------------------

def fetch_subreddit_posts(
    subreddit: str,
    sort: str = "new",
    limit: int = 100,
    after: Optional[str] = None,
    max_retries: int = 3,
) -> List[Dict[str, Any]]:
    """Fetch posts from a subreddit using the public .json endpoint."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json?limit={limit}&raw_json=1"
    if after:
        url += f"&after={after}"

    headers = {"User-Agent": USER_AGENT}
    req = urllib.request.Request(url, headers=headers)

    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                children = (data.get("data") or {}).get("children") or []
                return [child["data"] for child in children if child.get("data")]
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                wait = 10 * (attempt + 1)
                print(f"[Reddit] 429 rate-limited on r/{subreddit}, waiting {wait}s...")
                time.sleep(wait)
                continue
            if exc.code in (403, 451):
                print(f"[Reddit] {exc.code} on r/{subreddit}, skipping.")
                return []
            raise
        except (urllib.error.URLError, OSError) as exc:
            if attempt < max_retries - 1:
                time.sleep(3)
                continue
            print(f"[Reddit] Network error on r/{subreddit}: {exc}")
            return []
    return []


# ---------------------------------------------------------------------------
# Ticker extraction
# ---------------------------------------------------------------------------

def extract_ticker_mentions(
    text: str,
    known_symbols: FrozenSet[str],
) -> List[str]:
    """Extract ticker symbols from text using cashtags and known-symbol matching."""
    if not text:
        return []

    found: Set[str] = set()

    for match in CASHTAG_RE.finditer(text):
        ticker = match.group(1)
        if ticker in known_symbols and ticker not in TICKER_BLACKLIST:
            found.add(ticker)

    for match in BARE_TICKER_RE.finditer(text):
        ticker = match.group(1)
        if ticker in known_symbols and ticker not in TICKER_BLACKLIST and len(ticker) >= 2:
            found.add(ticker)

    return sorted(found)


# ---------------------------------------------------------------------------
# Row builders
# ---------------------------------------------------------------------------

def reddit_post_to_raw_rows(
    post: Dict[str, Any],
    matched_symbols: List[str],
) -> List[Dict[str, Any]]:
    """Convert one Reddit post into N raw_post dicts (one per matched symbol)."""
    title = str(post.get("title") or "")
    selftext = str(post.get("selftext") or "")
    body = _clean_text(f"{title}\n{selftext}".strip())
    created_utc = post.get("created_utc")
    posted_at = (
        datetime.fromtimestamp(int(created_utc), tz=timezone.utc).isoformat().replace("+00:00", "Z")
        if created_utc
        else None
    )
    if not posted_at:
        return []

    reddit_id = str(post.get("name") or post.get("id") or "").strip()
    if not reddit_id:
        return []

    author = str(post.get("author") or "").strip()
    permalink = post.get("permalink") or ""
    url = f"https://reddit.com{permalink}" if permalink else None
    score = post.get("score") or 0
    num_comments = post.get("num_comments") or 0
    upvote_ratio = post.get("upvote_ratio")
    subreddit = post.get("subreddit") or ""
    flair = post.get("link_flair_text") or ""
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    rows: List[Dict[str, Any]] = []
    for symbol in matched_symbols:
        rows.append({
            "symbol": symbol,
            "platform": "reddit",
            "platform_post_id": f"{reddit_id}:{symbol}" if len(matched_symbols) > 1 else reddit_id,
            "platform_thread_id": reddit_id,
            "author_id": author if author and author != "[deleted]" else None,
            "author_handle": author if author and author != "[deleted]" else None,
            "posted_at": posted_at,
            "fetched_at": fetched_at,
            "body_text": body,
            "url": url,
            "language": None,
            "like_count": int(score),
            "reply_count": int(num_comments),
            "repost_count": None,
            "view_count": None,
            "engagement_score": float(score) + float(num_comments),
            "is_reply": False,
            "is_repost": bool(post.get("is_crosspostable") is False and post.get("crosspost_parent")),
            "sentiment_label": None,
            "payload": {
                "subreddit": subreddit,
                "flair": flair,
                "upvote_ratio": upvote_ratio,
                "is_self": post.get("is_self"),
                "num_crossposts": post.get("num_crossposts"),
            },
        })
    return rows


def build_clean_and_sentiment(
    raw_posts: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Derive clean_posts and post_sentiment rows from raw_posts (mirrors
    build_social_intelligence_payload logic in fundamentalsService.py)."""
    clean_posts: List[Dict[str, Any]] = []
    post_sentiment: List[Dict[str, Any]] = []

    bullish_terms = ("bull", "buy", "long", "breakout", "squeeze", "beat", "strong",
                     "moon", "rocket", "calls", "undervalued", "upside", "tendies")
    bearish_terms = ("bear", "sell", "short", "dump", "miss", "weak", "fraud",
                     "puts", "overvalued", "downside", "crash", "drill", "baghold")

    from collections import Counter as _Counter
    _dedup_keys: List[Optional[str]] = []
    for post in raw_posts:
        _bt = _clean_text(post.get("body_text"))
        _pid = str(post.get("platform_post_id") or "").strip()
        _plat = str(post.get("platform") or "").strip().lower()
        _dedup_keys.append(_content_dedup_key(_bt, f"{_plat}:{_pid}"))
    _dedup_freq = _Counter(k for k in _dedup_keys if k)

    for post, duplicate_group_key in zip(raw_posts, _dedup_keys):
        body_text = _clean_text(post.get("body_text"))
        symbol = str(post.get("symbol") or "").strip().upper()
        platform = str(post.get("platform") or "").strip()
        platform_post_id = str(post.get("platform_post_id") or "").strip()
        posted_at = str(post.get("posted_at") or "").strip()
        trade_date = posted_at[:10] if posted_at else None
        if not trade_date or not platform_post_id:
            continue

        author_key = str(post.get("author_id") or post.get("author_handle") or "").strip().lower() or None
        normalized_text = body_text.lower() if body_text else ""
        canonical_post_key = f"{platform.lower()}:{platform_post_id}"
        token_count = len(body_text.split()) if body_text else 0
        has_ticker_mention = f"${symbol.lower()}" in normalized_text or symbol.lower() in normalized_text
        is_spam, spam_score = _score_spam(
            body_text,
            token_count=token_count,
            dedup_frequency=_dedup_freq.get(duplicate_group_key, 1),
            has_ticker_mention=has_ticker_mention,
        )

        clean_posts.append({
            "platform_post_id": platform_post_id,
            "symbol": symbol,
            "platform": platform,
            "canonical_post_key": canonical_post_key,
            "canonical_author_key": author_key,
            "trade_date": trade_date,
            "posted_at": posted_at,
            "cleaned_text": body_text,
            "token_count": token_count,
            "has_ticker_mention": has_ticker_mention,
            "is_spam": is_spam,
            "spam_score": spam_score,
            "duplicate_group_key": duplicate_group_key,
            "payload": {
                "platform_post_id": platform_post_id,
                "platform_thread_id": post.get("platform_thread_id"),
            },
        })

        bullish_hits = sum(1 for term in bullish_terms if term in normalized_text)
        bearish_hits = sum(1 for term in bearish_terms if term in normalized_text)
        if bullish_hits > bearish_hits and bullish_hits > 0:
            sentiment_label = "bullish"
            sentiment_score = min(1.0, 0.25 + bullish_hits * 0.15)
            sentiment_confidence = min(0.75, 0.25 + bullish_hits * 0.1)
        elif bearish_hits > bullish_hits and bearish_hits > 0:
            sentiment_label = "bearish"
            sentiment_score = max(-1.0, -0.25 - bearish_hits * 0.15)
            sentiment_confidence = min(0.75, 0.25 + bearish_hits * 0.1)
        else:
            sentiment_label = "neutral"
            sentiment_score = 0.0
            sentiment_confidence = 0.2

        is_hype = any(t in normalized_text for t in ("squeeze", "moon", "rocket", "tendies", "yolo"))
        is_fear = any(t in normalized_text for t in ("panic", "dump", "crash", "drill", "capitulation"))

        post_sentiment.append({
            "platform_post_id": platform_post_id,
            "symbol": symbol,
            "platform": platform,
            "trade_date": trade_date,
            "sentiment_label": sentiment_label,
            "sentiment_score": sentiment_score,
            "sentiment_confidence": sentiment_confidence,
            "sentiment_model": "keyword_v1_reddit",
            "topic_label": _classify_topic(body_text, is_spam=is_spam),
            "hype_score": 1.0 if is_hype else 0.0,
            "fear_score": 1.0 if is_fear else 0.0,
            "payload": {"platform_post_id": platform_post_id},
        })

    return clean_posts, post_sentiment


def enrich_rows_with_raw_ids(
    rows: List[Dict[str, Any]],
    id_map: Dict[Tuple[str, str], int],
) -> List[Dict[str, Any]]:
    enriched: List[Dict[str, Any]] = []
    for row in rows:
        platform = str(row.get("platform") or "").strip()
        platform_post_id = str(row.get("platform_post_id") or "").strip()
        raw_post_id = id_map.get((platform, platform_post_id))
        if raw_post_id is None:
            continue
        payload = dict(row)
        payload["raw_post_id"] = raw_post_id
        enriched.append(payload)
    return enriched


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Collect Reddit finance posts into the social intelligence DB.")
    parser.add_argument("--subreddits", default="", help="Comma-separated subreddits to monitor (default: finance subs).")
    parser.add_argument("--sort", default="new", choices=["new", "hot", "rising", "top"], help="Sort order for subreddit listings.")
    parser.add_argument("--limit", type=int, default=100, help="Max posts to fetch per subreddit (max 100).")
    parser.add_argument("--sleep-ms", type=int, default=7000, help="Sleep between subreddit requests (ms). Default 7000 for 10 req/min safety.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols to filter to (empty = all tracked).")
    parser.add_argument(
        "--universe-json",
        type=Path,
        default=DEFAULT_UNIVERSE_PATH,
        help="Fallback universe JSON used if tracked_symbols is empty.",
    )
    parser.add_argument("--universe-name", default="clean_stocks", help="Universe name for fetch-run tracking.")
    args = parser.parse_args()

    subreddits = [s.strip() for s in (args.subreddits or "").split(",") if s.strip()]
    if not subreddits:
        subreddits = list(DEFAULT_SUBREDDITS)

    db = SocialIntelligenceDb(ROOT)

    filter_symbols: Optional[Set[str]] = None
    if args.symbols:
        filter_symbols = {s.strip().upper() for s in args.symbols.split(",") if s.strip()}

    known_symbols_list = db.tracked_symbols(universe_name=args.universe_name, active_only=True)
    if not known_symbols_list:
        known_symbols_list = load_symbols_from_universe(args.universe_json.resolve())
        db.upsert_tracked_symbols(
            [{"symbol": s, "ticker": s} for s in known_symbols_list],
            universe_name=args.universe_name,
        )
    known_symbols: FrozenSet[str] = frozenset(known_symbols_list)

    if filter_symbols:
        known_symbols = frozenset(filter_symbols & known_symbols)

    print(f"[Reddit] Monitoring {len(subreddits)} subreddits: {', '.join(subreddits)}")
    print(f"[Reddit] Known symbol universe: {len(known_symbols)} tickers")

    started_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"reddit_collect_{started_at}"
    db.start_fetch_run(
        run_id=run_id,
        platform="reddit",
        universe_name=args.universe_name,
        symbols_requested=len(known_symbols),
        notes={"mode": "reddit_collect", "subreddits": subreddits},
    )

    all_raw: List[Dict[str, Any]] = []
    sub_succeeded = 0
    sub_failed = 0
    symbols_seen: Set[str] = set()
    errors: Dict[str, str] = {}

    for idx, sub in enumerate(subreddits, start=1):
        try:
            posts = fetch_subreddit_posts(sub, sort=args.sort, limit=min(args.limit, 100))
            sub_raw: List[Dict[str, Any]] = []
            for post in posts:
                title = str(post.get("title") or "")
                selftext = str(post.get("selftext") or "")
                full_text = f"{title} {selftext}"
                tickers = extract_ticker_mentions(full_text, known_symbols)
                if not tickers:
                    continue
                rows = reddit_post_to_raw_rows(post, tickers)
                sub_raw.extend(rows)
                symbols_seen.update(tickers)

            all_raw.extend(sub_raw)
            sub_succeeded += 1
            print(f"[Reddit] [{idx}/{len(subreddits)}] r/{sub}: {len(posts)} posts, {len(sub_raw)} ticker-matched rows")
        except Exception as exc:
            sub_failed += 1
            errors[sub] = str(exc)
            print(f"[Reddit] [{idx}/{len(subreddits)}] r/{sub}: failed ({exc})")

        if args.sleep_ms > 0 and idx < len(subreddits):
            time.sleep(args.sleep_ms / 1000.0)

    clean_posts, post_sentiment = build_clean_and_sentiment(all_raw)

    db.bulk_upsert_raw_posts(all_raw)
    id_map = db.raw_post_id_map(all_raw)
    db.bulk_upsert_clean_posts(enrich_rows_with_raw_ids(clean_posts, id_map))
    db.bulk_upsert_post_sentiment(enrich_rows_with_raw_ids(post_sentiment, id_map))

    db.finish_fetch_run(
        run_id=run_id,
        status="completed" if sub_failed == 0 else ("partial" if sub_succeeded > 0 else "failed"),
        symbols_succeeded=sub_succeeded,
        symbols_failed=sub_failed,
        notes={
            "mode": "reddit_collect",
            "subreddits_requested": len(subreddits),
            "subreddits_succeeded": sub_succeeded,
            "subreddits_failed": sub_failed,
            "total_raw_posts": len(all_raw),
            "total_clean_posts": len(clean_posts),
            "total_sentiment_rows": len(post_sentiment),
            "symbols_found": sorted(symbols_seen),
            "errors": errors,
        },
    )

    summary = {
        "run_id": run_id,
        "subreddits": len(subreddits),
        "subreddits_succeeded": sub_succeeded,
        "subreddits_failed": sub_failed,
        "total_raw_posts": len(all_raw),
        "total_clean_posts": len(clean_posts),
        "total_sentiment_rows": len(post_sentiment),
        "unique_symbols": len(symbols_seen),
        "db_stats": db.db_stats(),
    }
    print(json.dumps(summary, indent=2))
    return 0 if sub_succeeded > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
