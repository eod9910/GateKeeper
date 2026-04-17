#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
SP500_PATH = DATA_DIR / "sp500_universe.json"
SP400_PATH = DATA_DIR / "sp400_universe.json"
SP600_PATH = DATA_DIR / "sp600_universe.json"
LARGE_CAP_PATH = DATA_DIR / "large_cap_500.json"
MID_CAP_PATH = DATA_DIR / "mid_cap_500.json"
SMALL_CAP_PATH = DATA_DIR / "small_cap_500.json"
MARKET_CAP_SNAPSHOT_PATH = DATA_DIR / "market_cap_snapshot.json"
LEDGER_ELIGIBLE_PATH = DATA_DIR / "ledger_filing_eligible.json"
LEDGER_ELIGIBILITY_REPORT_PATH = DATA_DIR / "ledger_filing_eligibility_report.json"
SEC_TICKER_MAP_PATH = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "company_tickers_exchange.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _load_symbol_set(path: Path) -> set[str]:
    if not path.exists():
        return set()
    payload = _load_json(path)
    values = payload.get("symbols") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        return set()
    return {_normalize_symbol(value) for value in values if _normalize_symbol(value)}


def _load_market_caps(path: Path) -> Dict[str, float | None]:
    if not path.exists():
        return {}
    payload = _load_json(path)
    if not isinstance(payload, dict):
        return {}
    result: Dict[str, float | None] = {}
    for key, value in payload.items():
        symbol = _normalize_symbol(key)
        if not symbol:
            continue
        try:
            result[symbol] = float(value) if value is not None else None
        except (TypeError, ValueError):
            result[symbol] = None
    return result


def _load_sec_map(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    payload = _load_json(path)
    fields = payload.get("fields") or []
    rows = payload.get("data") or []
    if not isinstance(fields, list) or not isinstance(rows, list):
        return {}
    indexes = {name: fields.index(name) for name in ("cik", "name", "ticker", "exchange")}
    mapping: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, list) or len(row) <= max(indexes.values()):
            continue
        symbol = _normalize_symbol(row[indexes["ticker"]])
        if not symbol:
            continue
        mapping[symbol] = {
            "cik": str(row[indexes["cik"]]),
            "sec_name": row[indexes["name"]],
            "sec_exchange": row[indexes["exchange"]],
        }
    return mapping


def _load_eligibility_report(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    payload = _load_json(path)
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    result: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = _normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        result[symbol] = row
    return result


def _derive_market_cap_bucket(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 10e9:
        return "large"
    if value >= 2e9:
        return "mid"
    if value >= 0.3e9:
        return "small"
    return "micro"


def _sorted_unique(values: Iterable[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        output.append(text)
    output.sort()
    return output


def _build_memberships(
    symbol: str,
    sp500: set[str],
    sp400: set[str],
    sp600: set[str],
    large_cap_500: set[str],
    mid_cap_500: set[str],
    small_cap_500: set[str],
    ledger_eligible: set[str],
) -> List[str]:
    return _sorted_unique([
        "clean",
        "sp500" if symbol in sp500 else "",
        "sp400" if symbol in sp400 else "",
        "sp600" if symbol in sp600 else "",
        "large_cap_500" if symbol in large_cap_500 else "",
        "mid_cap_500" if symbol in mid_cap_500 else "",
        "small_cap_500" if symbol in small_cap_500 else "",
        "ledger_filing_eligible" if symbol in ledger_eligible else "",
    ])


def _build_index_memberships(symbol: str, sp500: set[str], sp400: set[str], sp600: set[str]) -> List[str]:
    return _sorted_unique([
        "sp500" if symbol in sp500 else "",
        "sp400" if symbol in sp400 else "",
        "sp600" if symbol in sp600 else "",
    ])


def _build_row(
    stock: Dict[str, Any],
    symbol: str,
    *,
    sp500: set[str],
    sp400: set[str],
    sp600: set[str],
    large_cap_500: set[str],
    mid_cap_500: set[str],
    small_cap_500: set[str],
    ledger_eligible: set[str],
    market_caps: Dict[str, float | None],
    sec_map: Dict[str, Dict[str, Any]],
    eligibility_rows: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    row = dict(stock)
    sec_info = sec_map.get(symbol) or {}
    eligibility = eligibility_rows.get(symbol) or {}
    market_cap = market_caps.get(symbol)
    market_cap_bucket = _derive_market_cap_bucket(market_cap)
    memberships = _build_memberships(
        symbol, sp500, sp400, sp600, large_cap_500, mid_cap_500, small_cap_500, ledger_eligible
    )
    index_memberships = _build_index_memberships(symbol, sp500, sp400, sp600)
    primary_index = index_memberships[0] if index_memberships else None

    row.setdefault("ticker", symbol)
    row.setdefault("name", sec_info.get("sec_name") or symbol)
    row.setdefault("exchange", sec_info.get("sec_exchange"))
    row["symbol"] = symbol
    row["is_clean"] = True
    row["index_memberships"] = index_memberships
    row["index"] = row.get("index") or primary_index
    row["is_sp500"] = symbol in sp500
    row["is_sp400"] = symbol in sp400
    row["is_sp600"] = symbol in sp600
    row["is_large_cap_500"] = symbol in large_cap_500
    row["is_mid_cap_500"] = symbol in mid_cap_500
    row["is_small_cap_500"] = symbol in small_cap_500
    row["universe_memberships"] = memberships
    row["market_cap"] = market_cap
    row["market_cap_bucket"] = market_cap_bucket
    row["cap_tier"] = row.get("cap_tier") or market_cap_bucket or "unknown"
    row["has_sec_mapping"] = bool(sec_info)
    row["cik"] = sec_info.get("cik")
    row["sec_name"] = sec_info.get("sec_name")
    row["sec_exchange"] = sec_info.get("sec_exchange")
    row["is_ledger_filing_eligible"] = symbol in ledger_eligible
    row["ledger_eligibility_status"] = eligibility.get("status")
    row["ledger_eligibility_reason"] = eligibility.get("reason")
    row["has_domestic_reporting_forms"] = eligibility.get("has_domestic_reporting_forms")
    row["has_foreign_reporting_forms"] = eligibility.get("has_foreign_reporting_forms")
    return row


def main() -> None:
    if not UNIVERSE_PATH.exists():
        raise SystemExit("universe_clean.json not found. Run build_clean_universe.py first.")

    payload = _load_json(UNIVERSE_PATH)
    stocks = payload.get("stocks") if isinstance(payload, dict) else None
    if not isinstance(stocks, list):
        raise SystemExit("universe_clean.json is missing a stocks array.")

    sp500 = _load_symbol_set(SP500_PATH)
    sp400 = _load_symbol_set(SP400_PATH)
    sp600 = _load_symbol_set(SP600_PATH)
    large_cap_500 = _load_symbol_set(LARGE_CAP_PATH)
    mid_cap_500 = _load_symbol_set(MID_CAP_PATH)
    small_cap_500 = _load_symbol_set(SMALL_CAP_PATH)
    ledger_eligible = _load_symbol_set(LEDGER_ELIGIBLE_PATH)
    market_caps = _load_market_caps(MARKET_CAP_SNAPSHOT_PATH)
    sec_map = _load_sec_map(SEC_TICKER_MAP_PATH)
    eligibility_rows = _load_eligibility_report(LEDGER_ELIGIBILITY_REPORT_PATH)

    enriched_rows: List[Dict[str, Any]] = []
    count_sec_mapped = 0
    count_ledger_eligible = 0
    seen_symbols: set[str] = set()

    for stock in stocks:
        if not isinstance(stock, dict):
            continue
        symbol = _normalize_symbol(stock.get("ticker"))
        if not symbol:
            continue
        row = _build_row(
            stock,
            symbol,
            sp500=sp500,
            sp400=sp400,
            sp600=sp600,
            large_cap_500=large_cap_500,
            mid_cap_500=mid_cap_500,
            small_cap_500=small_cap_500,
            ledger_eligible=ledger_eligible,
            market_caps=market_caps,
            sec_map=sec_map,
            eligibility_rows=eligibility_rows,
        )
        if row.get("has_sec_mapping"):
            count_sec_mapped += 1
        if symbol in ledger_eligible:
            count_ledger_eligible += 1
        enriched_rows.append(row)
        seen_symbols.add(symbol)

    supplemental_symbols = sorted(
        (sp500 | sp400 | sp600 | large_cap_500 | mid_cap_500 | small_cap_500 | ledger_eligible) - seen_symbols
    )
    supplemental_added = 0
    for symbol in supplemental_symbols:
        row = _build_row(
            {},
            symbol,
            sp500=sp500,
            sp400=sp400,
            sp600=sp600,
            large_cap_500=large_cap_500,
            mid_cap_500=mid_cap_500,
            small_cap_500=small_cap_500,
            ledger_eligible=ledger_eligible,
            market_caps=market_caps,
            sec_map=sec_map,
            eligibility_rows=eligibility_rows,
        )
        enriched_rows.append(row)
        supplemental_added += 1
        if row.get("has_sec_mapping"):
            count_sec_mapped += 1
        if symbol in ledger_eligible:
            count_ledger_eligible += 1

    payload["schema_version"] = 2
    payload["canonical"] = True
    payload["canonicalized_at"] = _utc_now_iso()
    payload["count"] = len(enriched_rows)
    payload["stocks"] = sorted(enriched_rows, key=lambda item: item.get("ticker", ""))
    payload["attribute_summary"] = {
        "sec_mapped_count": count_sec_mapped,
        "ledger_filing_eligible_count": count_ledger_eligible,
        "sp500_count": len(sp500),
        "sp400_count": len(sp400),
        "sp600_count": len(sp600),
        "large_cap_500_count": len(large_cap_500),
        "mid_cap_500_count": len(mid_cap_500),
        "small_cap_500_count": len(small_cap_500),
        "supplemental_symbols_added": supplemental_added,
    }

    UNIVERSE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps({
        "output": str(UNIVERSE_PATH),
        "count": len(enriched_rows),
        "schema_version": payload["schema_version"],
        "canonicalized_at": payload["canonicalized_at"],
        "attribute_summary": payload["attribute_summary"],
    }, indent=2))


if __name__ == "__main__":
    main()
