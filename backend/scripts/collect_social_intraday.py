from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.fundamentalsService import build_social_intelligence_payload
from backend.services.social_intelligence_db import SocialIntelligenceDb

DATA_DIR = ROOT / "backend" / "data"
DEFAULT_UNIVERSE_PATH = DATA_DIR / "universe_clean.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_symbols_from_universe(path: Path) -> List[str]:
    payload = load_json(path)
    stocks = payload.get("stocks") or []
    symbols: List[str] = []
    seen = set()
    for stock in stocks:
        symbol = str((stock or {}).get("symbol") or (stock or {}).get("ticker") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def enrich_rows_with_raw_ids(
    rows: List[Dict[str, Any]],
    id_map: Dict[tuple[str, str], int],
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect current social posts into the social intelligence DB.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols to collect.")
    parser.add_argument("--limit", type=int, default=0, help="Limit symbols processed from the tracked universe.")
    parser.add_argument("--sleep-ms", type=int, default=350, help="Sleep between symbols to reduce rate pressure.")
    parser.add_argument(
        "--universe-json",
        type=Path,
        default=DEFAULT_UNIVERSE_PATH,
        help="Fallback universe JSON used if tracked_symbols is empty.",
    )
    parser.add_argument("--universe-name", default="clean_stocks", help="Universe name for fetch-run tracking.")
    args = parser.parse_args()

    db = SocialIntelligenceDb(ROOT)
    symbols = [part.strip().upper() for part in str(args.symbols or "").split(",") if part.strip()]
    if not symbols:
        symbols = db.tracked_symbols(universe_name=args.universe_name, active_only=True)
    if not symbols:
        symbols = load_symbols_from_universe(args.universe_json.resolve())
        db.upsert_tracked_symbols([{"symbol": symbol, "ticker": symbol} for symbol in symbols], universe_name=args.universe_name)
    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]

    started_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"social_intraday_{started_at}"
    db.start_fetch_run(
        run_id=run_id,
        platform="stocktwits+yahoo_finance",
        universe_name=args.universe_name,
        symbols_requested=len(symbols),
        notes={"mode": "intraday_collect"},
    )

    succeeded = 0
    failed = 0
    total_raw_posts = 0
    total_clean_posts = 0
    total_sentiment_rows = 0
    errors: Dict[str, str] = {}

    for index, symbol in enumerate(symbols, start=1):
        try:
            payload = build_social_intelligence_payload(symbol)
            raw_posts = payload.get("raw_posts") or []
            clean_posts = payload.get("clean_posts") or []
            post_sentiment = payload.get("post_sentiment") or []

            db.bulk_upsert_raw_posts(raw_posts)
            id_map = db.raw_post_id_map(raw_posts)
            db.bulk_upsert_clean_posts(enrich_rows_with_raw_ids(clean_posts, id_map))
            db.bulk_upsert_post_sentiment(enrich_rows_with_raw_ids(post_sentiment, id_map))

            succeeded += 1
            total_raw_posts += len(raw_posts)
            total_clean_posts += len(clean_posts)
            total_sentiment_rows += len(post_sentiment)
            print(f"[SocialCollect] [{index}/{len(symbols)}] {symbol}: raw={len(raw_posts)} clean={len(clean_posts)} sentiment={len(post_sentiment)}")
        except Exception as exc:
            failed += 1
            errors[symbol] = str(exc)
            print(f"[SocialCollect] [{index}/{len(symbols)}] {symbol}: failed ({exc})")
        if args.sleep_ms > 0 and index < len(symbols):
            time.sleep(args.sleep_ms / 1000.0)

    db.finish_fetch_run(
        run_id=run_id,
        status="completed" if failed == 0 else ("partial" if succeeded > 0 else "failed"),
        symbols_succeeded=succeeded,
        symbols_failed=failed,
        notes={
            "mode": "intraday_collect",
            "total_raw_posts": total_raw_posts,
            "total_clean_posts": total_clean_posts,
            "total_sentiment_rows": total_sentiment_rows,
            "errors": errors,
        },
    )

    print(
        json.dumps(
            {
                "run_id": run_id,
                "requested": len(symbols),
                "succeeded": succeeded,
                "failed": failed,
                "total_raw_posts": total_raw_posts,
                "total_clean_posts": total_clean_posts,
                "total_sentiment_rows": total_sentiment_rows,
                "db_stats": db.db_stats(),
            },
            indent=2,
        )
    )
    return 0 if succeeded > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
