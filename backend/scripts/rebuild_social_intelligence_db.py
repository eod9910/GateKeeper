from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.social_intelligence_db import SocialIntelligenceDb, SOCIAL_INTELLIGENCE_DB_PATH

DATA_DIR = ROOT / "backend" / "data"
DEFAULT_UNIVERSE_PATH = DATA_DIR / "universe_clean.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_clean_universe_symbols(path: Path) -> List[Dict[str, Any]]:
    payload = load_json(path)
    stocks = payload.get("stocks") or []
    rows: List[Dict[str, Any]] = []
    for stock in stocks:
        symbol = str((stock or {}).get("symbol") or (stock or {}).get("ticker") or "").strip().upper()
        if not symbol:
            continue
        rows.append(
            {
                "symbol": symbol,
                "ticker": symbol,
                "name": stock.get("name"),
                "exchange": stock.get("exchange"),
                "cap_tier": stock.get("cap_tier"),
                "market_cap": stock.get("market_cap"),
                "market_cap_bucket": stock.get("market_cap_bucket"),
                "index_memberships": stock.get("index_memberships") or [],
                "universe_memberships": stock.get("universe_memberships") or [],
                "has_sec_mapping": stock.get("has_sec_mapping"),
                "cik": stock.get("cik"),
                "sec_name": stock.get("sec_name"),
                "sec_exchange": stock.get("sec_exchange"),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize and seed the social intelligence database.")
    parser.add_argument(
        "--universe-json",
        type=Path,
        default=DEFAULT_UNIVERSE_PATH,
        help="Path to the clean-universe JSON file.",
    )
    parser.add_argument(
        "--universe-name",
        default="clean_stocks",
        help="Universe name to attach to tracked symbols.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete the existing social-intelligence.sqlite file before rebuilding.",
    )
    args = parser.parse_args()

    universe_path = args.universe_json.resolve()
    if not universe_path.exists():
        raise SystemExit(f"Universe JSON not found: {universe_path}")

    db_path = SOCIAL_INTELLIGENCE_DB_PATH
    if args.reset and db_path.exists():
        db_path.unlink()

    db = SocialIntelligenceDb(ROOT)
    rows = load_clean_universe_symbols(universe_path)
    db.upsert_tracked_symbols(rows, universe_name=args.universe_name)
    stats = db.db_stats()

    print(
        json.dumps(
            {
                "db_path": str(db.db_path),
                "universe_path": str(universe_path),
                "universe_name": args.universe_name,
                "seeded_symbols": len(rows),
                "stats": stats,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
