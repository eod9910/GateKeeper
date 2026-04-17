from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SERVICES_DIR = ROOT / "backend" / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from backend.services.fundamentalsService import get_fundamentals
from backend.services.symbol_catalog_db import SymbolCatalogDb, classify_company_from_snapshot
from backend.services.yahoo_symbol_identity import fetch_yahoo_symbol_identity


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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

    rows = db.query_symbols(
        asset_class=args.asset_class,
        optionable=args.optionable if args.optionable is not None else None,
        memberships=memberships or None,
        limit=args.limit,
    )
    return rows


def _write_review_report(items: List[Dict[str, Any]]) -> None:
    research_dir = ROOT / "backend" / "data" / "research"
    research_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": _utc_now_iso(),
        "count": len(items),
        "items": items,
    }
    (research_dir / "consumer_cycle_classification_review.latest.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill symbol catalog company type / valuation engine classifications."
    )
    parser.add_argument("--symbol", help="Classify one symbol only.")
    parser.add_argument("--asset-class", default="stocks", help="Asset class to backfill. Default: stocks")
    parser.add_argument(
        "--membership-type",
        default="eligibility",
        help="Optional membership type filter. Default: eligibility",
    )
    parser.add_argument(
        "--membership-value",
        default="tradable_stock_default",
        help="Optional membership value filter. Default: tradable_stock_default",
    )
    parser.add_argument("--optionable", action="store_true", help="Restrict to optionable symbols.")
    parser.add_argument("--limit", type=int, help="Maximum number of symbols to process.")
    parser.add_argument("--force", action="store_true", help="Reclassify even if a symbol already has a stored company type.")
    parser.add_argument(
        "--refresh-yahoo-metadata",
        action="store_true",
        help="Refresh missing name/sector/industry from Yahoo before classifying.",
    )
    parser.set_defaults(optionable=None)
    args = parser.parse_args()

    db = SymbolCatalogDb()
    rows = _build_target_rows(db, args)
    total = len(rows)
    print(f"[SymbolClassification] Starting backfill for {total} symbol(s)")

    processed = 0
    updated = 0
    skipped = 0
    failed = 0
    review_items: List[Dict[str, Any]] = []

    for row in rows:
        processed += 1
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol:
            skipped += 1
            continue

        current = db.get_symbol(symbol) or {}
        current_memberships = db.get_memberships(symbol)
        membership_lookup = {
            str(item.get("membership_type") or ""): str(item.get("membership_value") or "")
            for item in current_memberships
        }
        seed_snapshot = {
            "sector": current.get("sector"),
            "industry": current.get("industry"),
            "name": current.get("name"),
            "sec_name": current.get("sec_name"),
            "exchange": current.get("exchange"),
        }
        seed_classification = classify_company_from_snapshot(seed_snapshot) or {}
        existing_theme_memberships = [
            str(item.get("membership_value") or "")
            for item in current_memberships
            if str(item.get("membership_type") or "") == "theme"
        ]
        has_theme_classification = bool(existing_theme_memberships) or not bool(seed_classification.get("theme_memberships"))
        has_full_classification = bool(
            current.get("company_type")
            and current.get("valuation_engine_class")
            and membership_lookup.get("consumer_demand_bucket")
            and membership_lookup.get("consumer_cycle_bucket")
            and membership_lookup.get("consumer_spend_class")
            and membership_lookup.get("consumer_spending_category")
            and membership_lookup.get("consumer_cycle_sensitivity")
            and membership_lookup.get("recession_profile")
            and membership_lookup.get("macro_regime_preference")
            and has_theme_classification
        )
        if not args.force and has_full_classification:
            skipped += 1
            print(
                f"[SymbolClassification] [{processed}/{total}] {symbol}: skipped "
                f"(existing {current.get('company_type')} / {current.get('valuation_engine_class')})"
            )
            continue

        try:
            snapshot = dict(seed_snapshot)
            needs_yahoo_identity = args.refresh_yahoo_metadata or not any(
                str(snapshot.get(key) or "").strip()
                for key in ("name", "sector", "industry")
            )
            if needs_yahoo_identity:
                yahoo_identity = fetch_yahoo_symbol_identity(symbol)
                if yahoo_identity:
                    snapshot = {
                        **snapshot,
                        "name": snapshot.get("name") or yahoo_identity.get("name"),
                        "sector": snapshot.get("sector") or yahoo_identity.get("sector"),
                        "industry": snapshot.get("industry") or yahoo_identity.get("industry"),
                        "exchange": snapshot.get("exchange") or yahoo_identity.get("exchange"),
                    }
            fundamentals = None
            classification = classify_company_from_snapshot(snapshot)
            needs_snapshot_refresh = not classification or (
                classification.get("consumer_classification_confidence") or 0
            ) < 0.7

            if needs_snapshot_refresh:
                fundamentals = get_fundamentals(symbol)
                snapshot_from_fundamentals = fundamentals.get("snapshot") if isinstance(fundamentals, dict) else None
                if isinstance(snapshot_from_fundamentals, dict):
                    snapshot = {
                        **snapshot,
                        **snapshot_from_fundamentals,
                    }
            snapshot = {
                **snapshot,
                "name": snapshot.get("name") or current.get("name"),
                "sec_name": snapshot.get("sec_name") or current.get("sec_name"),
                "exchange": snapshot.get("exchange") or current.get("exchange"),
            }
            classification = classify_company_from_snapshot(snapshot)
            if not classification:
                skipped += 1
                print(f"[SymbolClassification] [{processed}/{total}] {symbol}: skipped (no classifiable snapshot)")
                continue

            override = db.get_classification_override(symbol, "consumer_cycle")
            classification_source = str(classification.get("classification_source") or "snapshot_rule")
            if override:
                for source_key, target_key in (
                    ("demand_bucket", "consumer_demand_bucket"),
                    ("spend_class", "consumer_spend_class"),
                    ("category", "consumer_spending_category"),
                    ("cycle_bucket", "consumer_cycle_bucket"),
                    ("cycle_sensitivity", "consumer_cycle_sensitivity"),
                    ("recession_profile", "recession_profile"),
                    ("macro_regime_preference", "macro_regime_preference"),
                ):
                    override_value = override.get(source_key)
                    if override_value:
                        classification[target_key] = str(override_value)
                classification["classification_source"] = str(override.get("source") or "manual_override")
                classification["consumer_classification_confidence"] = 1.0
                classification_source = str(classification["classification_source"])

            now = _utc_now_iso()
            db.upsert_symbol(
                symbol,
                asset_class=current.get("asset_class") or args.asset_class or "stocks",
                name=current.get("name"),
                exchange=current.get("exchange") or (snapshot or {}).get("exchange"),
                sector=classification.get("sector"),
                industry=classification.get("industry"),
                active=bool(current.get("active", 1)),
                optionable=bool(current.get("optionable")) if current.get("optionable") is not None else None,
                underlying_symbol=current.get("underlying_symbol"),
                currency=current.get("currency"),
                cik=current.get("cik"),
                sec_name=current.get("sec_name"),
                sec_exchange=current.get("sec_exchange"),
                has_sec_mapping=bool(current.get("has_sec_mapping")) if current.get("has_sec_mapping") is not None else None,
                company_type=classification.get("company_type"),
                valuation_engine_class=classification.get("valuation_engine_class"),
                classification_source=classification.get("classification_source"),
                classification_confidence=classification.get("classification_confidence"),
                last_classified_at=now,
            )
            db.delete_memberships(symbol, "company_type")
            db.delete_memberships(symbol, "valuation_engine_class")
            db.delete_memberships(symbol, "consumer_demand_bucket")
            db.delete_memberships(symbol, "consumer_cycle_bucket")
            db.delete_memberships(symbol, "consumer_spend_class")
            db.delete_memberships(symbol, "consumer_spending_category")
            db.delete_memberships(symbol, "consumer_cycle_sensitivity")
            db.delete_memberships(symbol, "recession_profile")
            db.delete_memberships(symbol, "macro_regime_preference")
            db.delete_memberships(symbol, "theme")
            db.upsert_membership(
                symbol,
                "company_type",
                str(classification["company_type"]),
                source=str(classification.get("classification_source") or "snapshot_rule"),
                as_of=now,
            )
            db.upsert_membership(
                symbol,
                "valuation_engine_class",
                str(classification["valuation_engine_class"]),
                source=str(classification.get("classification_source") or "snapshot_rule"),
                as_of=now,
            )
            if classification.get("consumer_demand_bucket"):
                db.upsert_membership(
                    symbol,
                    "consumer_demand_bucket",
                    str(classification["consumer_demand_bucket"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("consumer_cycle_bucket"):
                db.upsert_membership(
                    symbol,
                    "consumer_cycle_bucket",
                    str(classification["consumer_cycle_bucket"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("consumer_spend_class"):
                db.upsert_membership(
                    symbol,
                    "consumer_spend_class",
                    str(classification["consumer_spend_class"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("consumer_spending_category"):
                db.upsert_membership(
                    symbol,
                    "consumer_spending_category",
                    str(classification["consumer_spending_category"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("consumer_cycle_sensitivity"):
                db.upsert_membership(
                    symbol,
                    "consumer_cycle_sensitivity",
                    str(classification["consumer_cycle_sensitivity"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("recession_profile"):
                db.upsert_membership(
                    symbol,
                    "recession_profile",
                    str(classification["recession_profile"]),
                    source=classification_source,
                    as_of=now,
                )
            if classification.get("macro_regime_preference"):
                db.upsert_membership(
                    symbol,
                    "macro_regime_preference",
                    str(classification["macro_regime_preference"]),
                    source=classification_source,
                    as_of=now,
                )
            for theme in classification.get("theme_memberships") or []:
                db.upsert_membership(
                    symbol,
                    "theme",
                    str(theme),
                    source=classification_source,
                    as_of=now,
                )
            consumer_confidence = float(classification.get("consumer_classification_confidence") or 0.0)
            if consumer_confidence < 0.75 or classification.get("consumer_spending_category") in {"mixed_consumer", "non_consumer"}:
                review_items.append(
                    {
                        "symbol": symbol,
                        "name": current.get("name") or snapshot.get("name") or snapshot.get("sec_name"),
                        "sector": snapshot.get("sector"),
                        "industry": snapshot.get("industry"),
                        "consumer_cycle_bucket": classification.get("consumer_cycle_bucket"),
                        "consumer_spending_category": classification.get("consumer_spending_category"),
                        "consumer_spend_class": classification.get("consumer_spend_class"),
                        "classification_source": classification_source,
                        "consumer_classification_confidence": consumer_confidence,
                    }
                )
            updated += 1
            print(
                f"[SymbolClassification] [{processed}/{total}] {symbol}: "
                f"{classification['company_type']} / {classification['valuation_engine_class']} / "
                f"{classification.get('consumer_spending_category', classification.get('consumer_demand_bucket', 'n/a'))}"
            )
        except Exception as exc:
            failed += 1
            print(f"[SymbolClassification] [{processed}/{total}] {symbol}: failed ({exc})")

    _write_review_report(review_items)
    print(
        "[SymbolClassification] Done "
        f"(processed={processed}, updated={updated}, skipped={skipped}, failed={failed}, review={len(review_items)})"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
