from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SERVICES_DIR = ROOT / "backend" / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from backend.services.symbol_catalog_db import SymbolCatalogDb
from backend.services.yahoo_symbol_identity import fetch_yahoo_symbol_identity


def _build_target_rows(db: SymbolCatalogDb, args: argparse.Namespace) -> List[Dict[str, Any]]:
    if args.symbol:
        symbol = str(args.symbol).strip().upper()
        row = db.get_symbol(symbol)
        if row:
            return [row]
        return [{"symbol": symbol, "asset_class": "stocks"}]

    memberships = []
    if args.membership_type and args.membership_value:
        memberships.append((args.membership_type, args.membership_value))

    return db.query_symbol_rows(
        asset_class=args.asset_class,
        optionable=args.optionable if args.optionable is not None else None,
        memberships=memberships or None,
        limit=args.limit,
    )


def _needs_identity_refresh(row: Dict[str, Any]) -> bool:
    return not any(
        str(row.get(key) or "").strip()
        for key in ("name", "sector", "industry")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich symbol-catalog identity metadata from Yahoo for the clean universe.")
    parser.add_argument("--symbol", help="Refresh one symbol only.")
    parser.add_argument("--asset-class", default="stocks", help="Asset class to enrich. Default: stocks")
    parser.add_argument("--membership-type", default="eligibility", help="Membership type filter. Default: eligibility")
    parser.add_argument("--membership-value", default="tradable_stock_default", help="Membership value filter. Default: tradable_stock_default")
    parser.add_argument("--optionable", action="store_true", help="Restrict to optionable symbols.")
    parser.add_argument("--limit", type=int, help="Maximum number of symbols to process.")
    parser.add_argument("--force", action="store_true", help="Refresh even if name/sector/industry already exist.")
    parser.add_argument("--max-attempts", type=int, default=4, help="Yahoo fetch retry attempts per symbol. Default: 4")
    parser.add_argument("--base-delay-seconds", type=float, default=2.0, help="Base retry delay for rate limits. Default: 2.0")
    parser.add_argument("--sleep-between-symbols-ms", type=int, default=150, help="Polite pause between Yahoo requests. Default: 150")
    parser.set_defaults(optionable=None)
    args = parser.parse_args()

    db = SymbolCatalogDb()
    rows = _build_target_rows(db, args)
    total = len(rows)
    print(f"[YahooIdentity] Starting enrichment for {total} symbol(s)")

    processed = 0
    updated = 0
    skipped = 0
    failed = 0

    for row in rows:
        processed += 1
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol:
            skipped += 1
            continue

        if not args.force and not _needs_identity_refresh(row):
            skipped += 1
            print(f"[YahooIdentity] [{processed}/{total}] {symbol}: skipped (already has identity metadata)")
            continue

        try:
            identity = fetch_yahoo_symbol_identity(
                symbol,
                max_attempts=args.max_attempts,
                base_delay_seconds=args.base_delay_seconds,
            )
            if not identity or not any(identity.get(key) for key in ("name", "sector", "industry")):
                skipped += 1
                print(f"[YahooIdentity] [{processed}/{total}] {symbol}: skipped (Yahoo returned no identity metadata)")
                continue

            db.upsert_symbol(
                symbol,
                asset_class=row.get("asset_class") or args.asset_class or "stocks",
                name=identity.get("name"),
                exchange=identity.get("exchange") or row.get("exchange"),
                sector=identity.get("sector"),
                industry=identity.get("industry"),
                active=bool(row.get("active", 1)),
                optionable=bool(row.get("optionable")) if row.get("optionable") is not None else None,
                underlying_symbol=row.get("underlying_symbol"),
                currency=row.get("currency"),
                cik=row.get("cik"),
                sec_name=row.get("sec_name"),
                sec_exchange=row.get("sec_exchange"),
                has_sec_mapping=bool(row.get("has_sec_mapping")) if row.get("has_sec_mapping") is not None else None,
            )
            updated += 1
            print(
                f"[YahooIdentity] [{processed}/{total}] {symbol}: "
                f"{identity.get('sector') or 'n/a'} / {identity.get('industry') or 'n/a'}"
            )
        except Exception as exc:
            failed += 1
            print(f"[YahooIdentity] [{processed}/{total}] {symbol}: failed ({exc})")
        finally:
            sleep_ms = max(0, int(args.sleep_between_symbols_ms or 0))
            if sleep_ms > 0:
                time.sleep(sleep_ms / 1000.0)

    print(
        f"[YahooIdentity] Done (processed={processed}, updated={updated}, "
        f"skipped={skipped}, failed={failed})"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
