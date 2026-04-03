#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
from typing import Iterable


ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_DIR = DATA_DIR / "universe"
MARKET_CAP_FILE = DATA_DIR / "market_cap_snapshot.json"
UNIVERSE_CLEAN_FILE = DATA_DIR / "universe_clean.json"
STOCK_EXCLUSIONS_FILE = UNIVERSE_DIR / "stock_exclusions.json"

TIER1_COUNT = 13
TIER1B_COUNT = 25
TIER2_COUNT = 50
TIER3_COUNT = 45
BUCKETS = ("large", "mid", "small", "micro")
CAP_RANGES = {
    "large": (10e9, None),
    "mid": (2e9, 10e9),
    "small": (0.3e9, 2e9),
    "micro": (0.05e9, 0.3e9),
}


def normalize_symbols(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        symbol = str(value or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out


def flatten_buckets(buckets: dict[str, list[str]]) -> list[str]:
    out: list[str] = []
    for bucket in BUCKETS:
        out.extend(buckets[bucket])
    return out


def deterministic_slice(symbols: list[str], target_count: int) -> list[str]:
    if target_count <= 0 or not symbols:
        return []
    if len(symbols) <= target_count:
        return symbols[:]
    out: list[str] = []
    seen: set[str] = set()
    step = len(symbols) / target_count
    for i in range(target_count):
        idx = min(len(symbols) - 1, int(i * step))
        while idx < len(symbols) and symbols[idx] in seen:
            idx += 1
        if idx >= len(symbols):
            break
        seen.add(symbols[idx])
        out.append(symbols[idx])
    return out


def load_clean_symbols() -> set[str]:
    payload = json.loads(UNIVERSE_CLEAN_FILE.read_text(encoding="utf-8"))
    excluded = load_excluded_symbols()
    return {
        str(stock.get("ticker", "")).strip().upper()
        for stock in payload.get("stocks", [])
        if isinstance(stock, dict) and str(stock.get("ticker", "")).strip()
        and str(stock.get("ticker", "")).strip().upper() not in excluded
    }


def load_excluded_symbols() -> set[str]:
    try:
        payload = json.loads(STOCK_EXCLUSIONS_FILE.read_text(encoding="utf-8"))
        symbols = payload.get("symbols") if isinstance(payload, dict) else payload
        return {
            str(symbol or "").strip().upper()
            for symbol in (symbols or [])
            if str(symbol or "").strip()
        }
    except Exception:
        return set()


def build_market_cap_pools(snapshot: dict[str, float | None], clean_symbols: set[str]) -> dict[str, list[str]]:
    pools: dict[str, list[tuple[str, float]]] = {bucket: [] for bucket in BUCKETS}
    for symbol, market_cap in snapshot.items():
        sym = str(symbol or "").strip().upper()
        if not sym or sym not in clean_symbols or market_cap is None:
            continue
        try:
            mc = float(market_cap)
        except (TypeError, ValueError):
            continue
        if mc <= 0:
            continue
        for bucket, (min_cap, max_cap) in CAP_RANGES.items():
            if mc >= min_cap and (max_cap is None or mc < max_cap):
                pools[bucket].append((sym, mc))
                break
    return {
        bucket: [sym for sym, _ in sorted(entries, key=lambda item: (-item[1], item[0]))]
        for bucket, entries in pools.items()
    }


def build_tier_payload(name: str, description: str, buckets: dict[str, list[str]]) -> dict:
    return {
        "name": name,
        "description": description,
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "source": "market_cap_snapshot.json + universe_clean.json",
        "buckets": buckets,
        "symbols": flatten_buckets(buckets),
    }


def main() -> None:
    snapshot = json.loads(MARKET_CAP_FILE.read_text(encoding="utf-8"))
    clean_symbols = load_clean_symbols()
    source_pools = build_market_cap_pools(snapshot, clean_symbols)

    for bucket in BUCKETS:
        needed = TIER2_COUNT + TIER3_COUNT
        if len(source_pools[bucket]) < needed:
            raise RuntimeError(
                f"Not enough market-cap-qualified symbols in {bucket}: need {needed}, have {len(source_pools[bucket])}"
            )

    tier2_buckets = {
        bucket: normalize_symbols(deterministic_slice(source_pools[bucket], TIER2_COUNT))
        for bucket in BUCKETS
    }
    tier1b_buckets = {
        bucket: normalize_symbols(deterministic_slice(tier2_buckets[bucket], TIER1B_COUNT))
        for bucket in BUCKETS
    }
    tier1_buckets = {
        bucket: normalize_symbols(deterministic_slice(tier1b_buckets[bucket], TIER1_COUNT))
        for bucket in BUCKETS
    }
    holdout_buckets = {}
    for bucket in BUCKETS:
        tier2_set = set(tier2_buckets[bucket])
        holdout_source = [sym for sym in source_pools[bucket] if sym not in tier2_set]
        holdout_buckets[bucket] = normalize_symbols(deterministic_slice(holdout_source, TIER3_COUNT))

    outputs = {
        DATA_DIR / "validation_tier1_mixed_cap.json": build_tier_payload(
            "Validation Tier 1 Mixed Cap",
            "Nested mixed-cap kill test: 13 large + 13 mid + 13 small + 13 micro (52 total). Derived from the market-cap-backed Tier 2 mixed-cap benchmark.",
            tier1_buckets,
        ),
        DATA_DIR / "validation_tier1b_mixed_cap.json": build_tier_payload(
            "Validation Tier 1B Mixed Cap",
            "Nested mixed-cap evidence expansion: 25 large + 25 mid + 25 small + 25 micro (100 total). Derived from the market-cap-backed Tier 2 mixed-cap benchmark.",
            tier1b_buckets,
        ),
        DATA_DIR / "validation_tier2_mixed_cap.json": build_tier_payload(
            "Validation Tier 2 Mixed Cap",
            "Mixed-cap core validation universe: 50 large + 50 mid + 50 small + 50 micro (200 total), selected from live market-cap tiers.",
            tier2_buckets,
        ),
        DATA_DIR / "validation_tier3_mixed_cap_holdout.json": build_tier_payload(
            "Validation Tier 3 Mixed Cap Holdout",
            "Non-overlapping mixed-cap robustness holdout: 45 large + 45 mid + 45 small + 45 micro (180 total). Excludes all Tier 2 mixed-cap symbols and uses the same live market-cap pools.",
            holdout_buckets,
        ),
    }

    compatibility_outputs = {
        UNIVERSE_DIR / "validator-tier1-stocks.json": {
            "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "source": "validation_tier1_mixed_cap.json",
            "description": "Compatibility alias for the canonical Tier 1 mixed-cap stock validation universe.",
            "symbols": flatten_buckets(tier1_buckets),
        }
    }

    for path, payload in outputs.items():
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {path.name}: {len(payload['symbols'])} symbols")

    for path, payload in compatibility_outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {path.name}: {len(payload['symbols'])} symbols")


if __name__ == "__main__":
    main()
