from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Dict, List, Set


DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data"))
UNIVERSE_DIR = os.path.join(DATA_DIR, "universe")
REGISTRY_PATH = os.path.join(UNIVERSE_DIR, "registry.json")
STOCK_EXCLUSIONS_PATH = os.path.join(UNIVERSE_DIR, "stock_exclusions.json")
MARKET_CAP_SNAPSHOT_PATH = os.path.join(DATA_DIR, "market_cap_snapshot.json")


def _normalize_symbols(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for value in values:
        symbol = str(value or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out


@lru_cache(maxsize=1)
def load_stock_exclusions() -> Set[str]:
    try:
        with open(STOCK_EXCLUSIONS_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        values = payload.get("symbols") if isinstance(payload, dict) else payload
        return set(_normalize_symbols(values))
    except Exception:
        return set()


def _apply_stock_exclusions(symbols: List[str]) -> List[str]:
    excluded = load_stock_exclusions()
    if not excluded:
        return symbols
    return [symbol for symbol in symbols if symbol not in excluded]


@lru_cache(maxsize=1)
def _load_registry() -> Dict[str, Any]:
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def resolve_universe_path(name: str) -> str | None:
    registry = _load_registry()
    entry = ((registry.get("universes") or {}) if isinstance(registry, dict) else {}).get(name) or {}
    rel_path = str(entry.get("path") or "").strip()
    if not rel_path:
        return None
    return os.path.normpath(os.path.join(UNIVERSE_DIR, rel_path))


def _parse_payload_symbols(payload: Any, schema: str) -> List[str]:
    if schema == "stocks":
        stocks = payload.get("stocks") if isinstance(payload, dict) else []
        return _normalize_symbols([
            item.get("ticker") for item in stocks
            if isinstance(item, dict)
        ])
    if schema == "optionable":
        return _normalize_symbols((payload or {}).get("optionable") or (payload or {}).get("symbols") or [])
    if schema == "source_symbols":
        return _normalize_symbols((payload or {}).get("source_symbols") or (payload or {}).get("symbols") or [])
    if isinstance(payload, dict):
        return _normalize_symbols(payload.get("symbols") or [])
    return _normalize_symbols(payload)


def load_universe_symbols(name: str) -> List[str]:
    registry = _load_registry()
    entry = ((registry.get("universes") or {}) if isinstance(registry, dict) else {}).get(name) or {}
    schema = str(entry.get("schema") or "symbols").strip()
    abs_path = resolve_universe_path(name)
    if not abs_path:
        return []
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return _apply_stock_exclusions(_parse_payload_symbols(payload, schema))
    except Exception:
        return []


def load_clean_stock_symbols() -> List[str]:
    return load_universe_symbols("clean_stocks")


@lru_cache(maxsize=1)
def load_market_cap_snapshot_billions() -> Dict[str, float]:
    try:
        with open(MARKET_CAP_SNAPSHOT_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f) or {}
        out: Dict[str, float] = {}
        for symbol, raw_value in payload.items():
            sym = str(symbol or "").strip().upper()
            if not sym:
                continue
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
            if value > 0:
                out[sym] = value / 1e9
        return out
    except Exception:
        return {}

