#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
SCRIPTS_DIR = ROOT / "backend" / "scripts"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
LEDGER_ELIGIBLE_PATH = DATA_DIR / "ledger_filing_eligible.json"
SEC_TICKER_MAP_PATH = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "company_tickers_exchange.json"
SP500_PATH = DATA_DIR / "sp500_universe.json"
SP400_PATH = DATA_DIR / "sp400_universe.json"
SP600_PATH = DATA_DIR / "sp600_universe.json"
MARKET_CAP_SNAPSHOT_PATH = DATA_DIR / "market_cap_snapshot.json"


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _run_step(script_name: str) -> Dict[str, Any]:
    cmd = [sys.executable, str(SCRIPTS_DIR / script_name)]
    completed = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=1800,
    )
    return {
        "ok": completed.returncode == 0,
        "script": script_name,
        "returncode": completed.returncode,
        "stdout": completed.stdout[-4000:],
        "stderr": completed.stderr[-4000:],
    }


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


def _derive_market_cap_bucket(value: float | None) -> str:
    if value is None:
        return "unknown"
    if value >= 10e9:
        return "large"
    if value >= 2e9:
        return "mid"
    if value >= 0.3e9:
        return "small"
    return "micro"


def _resolve_index(symbol: str, sp500: set[str], sp400: set[str], sp600: set[str]) -> Optional[str]:
    if symbol in sp500:
        return "sp500"
    if symbol in sp400:
        return "sp400"
    if symbol in sp600:
        return "sp600"
    return None


def _seed_stock_row(
    symbol: str,
    *,
    sec_map: Dict[str, Dict[str, Any]],
    market_caps: Dict[str, float | None],
    sp500: set[str],
    sp400: set[str],
    sp600: set[str],
) -> Optional[Dict[str, Any]]:
    sec_info = sec_map.get(symbol) or {}
    market_cap = market_caps.get(symbol)
    index = _resolve_index(symbol, sp500, sp400, sp600)
    cap_tier = (
        "large" if index == "sp500"
        else "mid" if index == "sp400"
        else "small" if index == "sp600"
        else _derive_market_cap_bucket(market_cap)
    )
    if not sec_info and market_cap is None and index is None:
        return None
    return {
        "ticker": symbol,
        "name": sec_info.get("sec_name") or symbol,
        "exchange": sec_info.get("sec_exchange"),
        "cap_tier": cap_tier,
        "index": index,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Ensure one symbol exists in the canonical stock universe.")
    parser.add_argument("--symbol", required=True, help="Ticker symbol to repair in universe_clean.json.")
    args = parser.parse_args()

    symbol = _normalize_symbol(args.symbol)
    if not symbol:
        raise SystemExit(json.dumps({"ok": False, "status": "invalid_symbol", "message": "A symbol is required."}))

    if not UNIVERSE_PATH.exists():
        raise SystemExit(json.dumps({
            "ok": False,
            "status": "missing_universe_clean",
            "message": "Canonical universe file is missing.",
        }))

    payload = _load_json(UNIVERSE_PATH)
    stocks = payload.get("stocks") if isinstance(payload, dict) else None
    if not isinstance(stocks, list):
        raise SystemExit(json.dumps({
            "ok": False,
            "status": "invalid_universe_clean",
            "message": "Canonical universe file does not contain a stocks array.",
        }))

    sp500 = _load_symbol_set(SP500_PATH)
    sp400 = _load_symbol_set(SP400_PATH)
    sp600 = _load_symbol_set(SP600_PATH)
    sec_map = _load_sec_map(SEC_TICKER_MAP_PATH)
    market_caps = _load_market_caps(MARKET_CAP_SNAPSHOT_PATH)

    existing_row = next((row for row in stocks if _normalize_symbol((row or {}).get("ticker")) == symbol), None)
    added_to_canonical = False

    if existing_row is None:
        seeded_row = _seed_stock_row(
            symbol,
            sec_map=sec_map,
            market_caps=market_caps,
            sp500=sp500,
            sp400=sp400,
            sp600=sp600,
        )
        if seeded_row is None:
            print(json.dumps({
                "ok": False,
                "symbol": symbol,
                "status": "no_canonical_seed_source",
                "message": "I could not repair the canonical universe for this symbol because it was not present in local universe inputs or the SEC ticker map.",
                "canonical_present_before": False,
                "canonical_present_after": False,
                "added_to_canonical": False,
            }, indent=2))
            return

        stocks.append(seeded_row)
        stocks.sort(key=lambda row: _normalize_symbol((row or {}).get("ticker")))
        payload["stocks"] = stocks
        payload["count"] = len(stocks)
        _write_json(UNIVERSE_PATH, payload)
        added_to_canonical = True

    rebuild_steps = [
        _run_step("build_ledger_filing_eligible_universe.py"),
        _run_step("enrich_canonical_universe.py"),
    ]
    rebuild_ok = all(step.get("ok") for step in rebuild_steps)

    refreshed_payload = _load_json(UNIVERSE_PATH) if UNIVERSE_PATH.exists() else {"stocks": []}
    refreshed_stocks = refreshed_payload.get("stocks") if isinstance(refreshed_payload, dict) else []
    final_row = next(
        (row for row in refreshed_stocks if _normalize_symbol((row or {}).get("ticker")) == symbol),
        None,
    )
    ledger_eligible_symbols = _load_symbol_set(LEDGER_ELIGIBLE_PATH)

    if not rebuild_ok:
        status = "canonical_refresh_failed"
        message = "Canonical universe repair started, but the eligibility or enrichment refresh failed."
    elif added_to_canonical:
        status = "added_and_refreshed"
        message = "I added the symbol to the canonical universe and refreshed Ledger eligibility metadata."
    else:
        status = "already_present_and_refreshed"
        message = "The symbol was already in the canonical universe. I refreshed Ledger eligibility metadata."

    print(json.dumps({
        "ok": rebuild_ok,
        "symbol": symbol,
        "status": status,
        "message": message,
        "canonical_present_before": existing_row is not None,
        "canonical_present_after": final_row is not None,
        "added_to_canonical": added_to_canonical,
        "has_sec_mapping_after": bool((final_row or {}).get("has_sec_mapping")) if isinstance(final_row, dict) else bool(sec_map.get(symbol)),
        "ledger_eligible_after": symbol in ledger_eligible_symbols,
        "cik": (final_row or {}).get("cik") if isinstance(final_row, dict) else sec_map.get(symbol, {}).get("cik"),
        "memberships_after": (final_row or {}).get("universe_memberships") if isinstance(final_row, dict) else [],
        "rebuild_steps": rebuild_steps,
    }, indent=2))


if __name__ == "__main__":
    main()
