from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.symbol_catalog_db import SymbolCatalogDb, SYMBOL_CATALOG_DB_PATH
import sync_valuation_snapshot_to_symbol_catalog as valuation_snapshot_sync

DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_DIR = DATA_DIR / "universe"
CORE_US_EXCHANGES = {"NASDAQ", "NYSE", "NYSE AMERICAN", "NYSEARCA", "AMEX"}
NON_STOCK_NAME_PATTERNS = (
    re.compile(r"\bETF\b", re.I),
    re.compile(r"\bETN\b", re.I),
    re.compile(r"\bFUND\b", re.I),
    re.compile(r"\bWARRANTS?\b", re.I),
    re.compile(r"\bRIGHTS?\b", re.I),
    re.compile(r"\bUNITS?\b", re.I),
    re.compile(r"\bNOTES?\b", re.I),
    re.compile(r"\bBOND\b|\bDEBENTURE\b", re.I),
    re.compile(r"\bNEXTSHARES\b", re.I),
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def iter_unique_symbols(values: Iterable[Any]) -> Iterable[str]:
    seen = set()
    for value in values:
        symbol = normalize_symbol(value)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        yield symbol


def load_universe_registry() -> Dict[str, Any]:
    path = UNIVERSE_DIR / "registry.json"
    payload = load_json(path)
    return payload.get("universes") or {}


def load_registry_symbols(entry: Dict[str, Any]) -> List[str]:
    path = (UNIVERSE_DIR / entry["path"]).resolve()
    payload = load_json(path)
    if isinstance(payload, list):
        return list(iter_unique_symbols(payload))
    schema = str(entry.get("schema") or "symbols")
    if schema == "stocks":
        return list(iter_unique_symbols((item or {}).get("ticker") for item in (payload.get("stocks") or [])))
    if schema == "optionable":
        return list(iter_unique_symbols(payload.get("optionable") or payload.get("symbols") or []))
    if schema == "source_symbols":
        return list(iter_unique_symbols(payload.get("source_symbols") or payload.get("symbols") or []))
    return list(iter_unique_symbols(payload.get("symbols") or payload))


def universe_membership_map(universe_name: str) -> List[Tuple[str, str]]:
    mapping = {
        "clean_stocks": [("universe", "clean")],
        "ledger_filing_eligible": [("universe", "ledger_filing_eligible")],
        "optionable_stocks": [("universe", "optionable_stocks")],
        "optionable_source_stocks": [("universe", "optionable_source")],
        "validation_tier1_stocks": [("validation_tier", "tier1")],
        "validation_tier1b_stocks": [("validation_tier", "tier1b")],
        "validation_tier2_stocks": [("validation_tier", "tier2")],
        "validation_tier3_stocks": [("validation_tier", "tier3")],
        "sp500": [("index_membership", "sp500")],
        "sp400": [("index_membership", "sp400")],
        "sp600": [("index_membership", "sp600")],
        "valuation_regime_undervalued": [("valuation_regime", "undervalued")],
        "valuation_regime_undervalued_sample100": [("valuation_sample", "undervalued_sample100")],
        "valuation_regime_fair": [("valuation_regime", "fair")],
        "valuation_regime_fair_sample100": [("valuation_sample", "fair_sample100")],
        "valuation_regime_overvalued": [("valuation_regime", "overvalued")],
        "valuation_regime_overvalued_sample100": [("valuation_sample", "overvalued_sample100")],
        "regime_expansion": [("technical_regime", "expansion")],
        "regime_distribution": [("technical_regime", "distribution")],
        "regime_accumulation": [("technical_regime", "accumulation")],
        "regime_markdown": [("technical_regime", "markdown")],
        "large_cap_known": [("universe", "large_cap_known")],
    }
    return mapping.get(universe_name, [("universe", universe_name)])


def clean_eligibility_tags(row: Dict[str, Any]) -> List[Tuple[str, str]]:
    tags: List[Tuple[str, str]] = []
    sec_exchange = str(row.get("sec_exchange") or "").upper()
    has_sec_mapping = bool(row.get("has_sec_mapping"))
    has_domestic_reporting = bool(row.get("has_domestic_reporting_forms"))
    has_foreign_reporting = bool(row.get("has_foreign_reporting_forms"))
    name = str(row.get("name") or "")

    if has_sec_mapping:
        tags.append(("listing_quality", "sec_mapped"))
    else:
        tags.append(("listing_quality", "missing_sec_mapping"))

    if sec_exchange in CORE_US_EXCHANGES:
        tags.append(("listing_quality", "core_us_exchange"))
    else:
        tags.append(("listing_quality", "non_core_exchange"))

    if has_domestic_reporting and has_foreign_reporting:
        tags.append(("reporting_profile", "dual_reporting"))
    elif has_foreign_reporting:
        tags.append(("reporting_profile", "foreign_reporting"))
    elif has_domestic_reporting:
        tags.append(("reporting_profile", "domestic_reporting"))
    else:
        tags.append(("reporting_profile", "no_recent_reporting_signal"))

    is_non_stock_name = any(pattern.search(name) for pattern in NON_STOCK_NAME_PATTERNS)
    if is_non_stock_name:
        tags.append(("instrument_quality", "non_common_equity_name"))
    else:
        tags.append(("instrument_quality", "common_equity_like"))

    is_foreign_only = has_foreign_reporting and not has_domestic_reporting
    is_core_us = has_sec_mapping and sec_exchange in CORE_US_EXCHANGES
    if is_core_us and not is_foreign_only and not is_non_stock_name:
        tags.append(("eligibility", "tradable_stock_default"))
    else:
        tags.append(("eligibility", "excluded_from_tradable_stock_default"))

    return tags


def ingest_universe_clean(db: SymbolCatalogDb) -> int:
    payload = load_json(DATA_DIR / "universe_clean.json")
    stocks = payload.get("stocks") or []
    symbols = []
    memberships = []
    metrics = []
    for row in stocks:
        symbol = normalize_symbol((row or {}).get("ticker") or (row or {}).get("symbol"))
        if not symbol:
            continue
        symbols.append(
            {
                "symbol": symbol,
                "asset_class": "stocks",
                "name": row.get("name"),
                "exchange": row.get("exchange"),
                "active": bool(row.get("is_clean", True)),
                "optionable": None,
                "cik": str(row.get("cik")) if row.get("cik") not in (None, "") else None,
                "sec_name": row.get("sec_name"),
                "sec_exchange": row.get("sec_exchange"),
                "has_sec_mapping": bool(row.get("has_sec_mapping")) if row.get("has_sec_mapping") is not None else None,
                "source": row,
            }
        )
        if row.get("cap_tier"):
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "cap_tier",
                    "membership_value": str(row["cap_tier"]),
                    "source": "universe_clean.json",
                }
            )
        if row.get("market_cap_bucket"):
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "market_cap_bucket",
                    "membership_value": str(row["market_cap_bucket"]),
                    "source": "universe_clean.json",
                }
            )
        for membership in row.get("index_memberships") or []:
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "index_membership",
                    "membership_value": str(membership),
                    "source": "universe_clean.json",
                }
            )
        for membership in row.get("universe_memberships") or []:
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "universe",
                    "membership_value": str(membership),
                    "source": "universe_clean.json",
                }
            )
        for membership_type, membership_value in clean_eligibility_tags(row):
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": membership_type,
                    "membership_value": membership_value,
                    "source": "universe_clean.json",
                }
            )
        if row.get("market_cap") is not None:
            try:
                metrics.append(
                    {
                        "symbol": symbol,
                        "metric_name": "market_cap",
                        "metric_value_num": float(row["market_cap"]),
                        "source": "universe_clean.json",
                    }
                )
            except Exception:
                pass
    db.bulk_upsert_symbols(symbols)
    db.bulk_upsert_memberships(memberships)
    db.bulk_upsert_metrics(metrics)
    return len(stocks)


def ingest_optionability(db: SymbolCatalogDb) -> None:
    payload = load_json(UNIVERSE_DIR / "optionable.json")
    symbols = []
    memberships = []
    for symbol in iter_unique_symbols(payload.get("source_symbols") or []):
        symbols.append({"symbol": symbol, "asset_class": "stocks", "optionable": None, "source": {"source": "optionable.json"}})
        memberships.append(
            {
                "symbol": symbol,
                "membership_type": "universe",
                "membership_value": "optionable_source",
                "source": "optionable.json",
            }
        )
    for symbol in iter_unique_symbols(payload.get("optionable") or []):
        symbols.append({"symbol": symbol, "asset_class": "stocks", "optionable": True, "source": {"source": "optionable.json"}})
        memberships.append(
            {
                "symbol": symbol,
                "membership_type": "universe",
                "membership_value": "optionable_stocks",
                "source": "optionable.json",
            }
        )
    for symbol in iter_unique_symbols(payload.get("not_optionable") or []):
        symbols.append({"symbol": symbol, "asset_class": "stocks", "optionable": False, "source": {"source": "optionable.json"}})
    db.bulk_upsert_symbols(symbols)
    db.bulk_upsert_memberships(memberships)


def ingest_registry_universes(db: SymbolCatalogDb) -> int:
    universes = load_universe_registry()
    symbol_rows = []
    memberships_batch = []
    membership_rows = 0
    for universe_name, entry in universes.items():
        universe_symbols = load_registry_symbols(entry)
        memberships = universe_membership_map(universe_name)
        for symbol in universe_symbols:
            symbol_rows.append({"symbol": symbol, "asset_class": "stocks", "source": {"registry_universe": universe_name}})
            for membership_type, membership_value in memberships:
                memberships_batch.append(
                    {
                        "symbol": symbol,
                        "membership_type": membership_type,
                        "membership_value": membership_value,
                        "source": f"registry:{universe_name}",
                        "payload": {"description": entry.get("description")},
                    }
                )
                membership_rows += 1
    db.bulk_upsert_symbols(symbol_rows)
    db.bulk_upsert_memberships(memberships_batch)
    return membership_rows


def ingest_regime_snapshot(db: SymbolCatalogDb) -> int:
    payload = load_json(DATA_DIR / "regime_snapshot.json")
    rows = payload.get("tickers") or []
    count = 0
    as_of = payload.get("generated_at")
    symbols = []
    memberships = []
    metrics = []
    for row in rows:
        symbol = normalize_symbol((row or {}).get("symbol"))
        regime = str((row or {}).get("regime") or "").strip().lower()
        if not symbol or not regime:
            continue
        symbols.append({"symbol": symbol, "asset_class": "stocks", "source": {"source": "regime_snapshot.json"}})
        memberships.append(
            {
                "symbol": symbol,
                "membership_type": "technical_regime",
                "membership_value": regime,
                "source": "regime_snapshot.json",
                "as_of": as_of,
                "payload": row,
            }
        )
        bars = row.get("bars")
        if bars is not None:
            try:
                metrics.append(
                    {
                        "symbol": symbol,
                        "metric_name": "regime_bars",
                        "metric_value_num": float(bars),
                        "source": "regime_snapshot.json",
                        "as_of": as_of,
                        "payload": row,
                    }
                )
            except Exception:
                pass
        count += 1
    db.bulk_upsert_symbols(symbols)
    db.bulk_upsert_memberships(memberships)
    db.bulk_upsert_metrics(metrics)
    return count


def ingest_valuation_snapshot(db: SymbolCatalogDb) -> int:
    path = DATA_DIR / "research" / "valuation_universe_snapshot.json"
    if not path.exists():
        return 0
    payload = load_json(path)
    counts = valuation_snapshot_sync.sync_snapshot(payload, db_path=db.db_path, source=path.name)
    return counts.get("symbols", 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild the master symbol catalog SQLite database.")
    parser.add_argument("--keep-existing", action="store_true", help="Do not clear existing catalog rows before ingest.")
    args = parser.parse_args()

    db = SymbolCatalogDb()
    if not args.keep_existing:
        db.reset()

    clean_count = ingest_universe_clean(db)
    ingest_optionability(db)
    registry_memberships = ingest_registry_universes(db)
    regime_rows = ingest_regime_snapshot(db)
    valuation_rows = ingest_valuation_snapshot(db)
    counts = db.count_rows()

    print("Symbol catalog rebuilt.")
    print(f"  DB path:        {SYMBOL_CATALOG_DB_PATH}")
    print(f"  Clean symbols:  {clean_count}")
    print(f"  Registry tags:  {registry_memberships}")
    print(f"  Regime rows:    {regime_rows}")
    print(f"  Valuation rows: {valuation_rows}")
    print(f"  Total symbols:  {counts['symbols']}")
    print(f"  Memberships:    {counts['memberships']}")
    print(f"  Metrics:        {counts['metrics']}")
    tradable_default = db.query_symbols(
        asset_class="stocks",
        memberships=[("eligibility", "tradable_stock_default")],
        limit=10,
    )
    print()
    print("Example query target now supported:")
    print("  stocks + optionable + valuation_regime=undervalued")
    example = db.query_symbols(
        asset_class="stocks",
        optionable=True,
        memberships=[("valuation_regime", "undervalued")],
        limit=10,
    )
    print(f"  Sample result count: {len(example)}")
    if example:
        print("  Sample symbols: " + ", ".join(row["symbol"] for row in example[:10]))
    print()
    print("Default tradable-stock subset:")
    print("  stocks + eligibility=tradable_stock_default")
    print(f"  Sample result count: {len(tradable_default)}")
    if tradable_default:
        print("  Sample symbols: " + ", ".join(row["symbol"] for row in tradable_default[:10]))


if __name__ == "__main__":
    main()
