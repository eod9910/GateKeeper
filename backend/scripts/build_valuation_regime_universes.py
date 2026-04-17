#!/usr/bin/env python3
from __future__ import annotations

"""
build_valuation_regime_universes.py
-----------------------------------
Builds validation-ready universe files from the latest standardized valuation
snapshot so Sweep/Validator can test strategies inside DCF valuation regimes.

Outputs (to backend/data/):
  valuation_regime_undervalued.json
  valuation_regime_fair.json
  valuation_regime_overvalued.json
  valuation_regime_snapshot.json
"""

import argparse
import json
import random
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
DEFAULT_INPUT = DATA_DIR / "research" / "valuation_universe_snapshot.json"
DEFAULT_SAMPLE_SIZE = 100
DEFAULT_SAMPLE_SEED = 42

STATE_TO_KEY = {
    "undervalued": "undervalued",
    "roughly_fair": "fair",
    "overvalued": "overvalued",
}


def load_snapshot(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle) or {}
    if not isinstance(payload, dict):
        raise ValueError("Valuation snapshot must be a JSON object.")
    return payload


def normalize_symbol(value: object) -> str:
    return str(value or "").strip().upper()


def build_regime_buckets(rows: list[dict]) -> tuple[dict[str, list[str]], dict[str, int]]:
    buckets: dict[str, list[str]] = defaultdict(list)
    skipped = {
        "missing_symbol": 0,
        "missing_state": 0,
        "unsupported_state": 0,
    }
    seen_by_bucket: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        if not isinstance(row, dict):
            skipped["unsupported_state"] += 1
            continue
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            skipped["missing_symbol"] += 1
            continue
        raw_state = str(row.get("valuation_state") or "").strip().lower()
        if not raw_state:
            skipped["missing_state"] += 1
            continue
        bucket_key = STATE_TO_KEY.get(raw_state)
        if not bucket_key:
            skipped["unsupported_state"] += 1
            continue
        if symbol in seen_by_bucket[bucket_key]:
            continue
        seen_by_bucket[bucket_key].add(symbol)
        buckets[bucket_key].append(symbol)

    for key in ("undervalued", "fair", "overvalued"):
        buckets.setdefault(key, [])
    return dict(buckets), skipped


def write_symbol_list(path: Path, symbols: list[str]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(symbols, handle, indent=2)
        handle.write("\n")


def build_sample(symbols: list[str], sample_size: int, rng: random.Random) -> list[str]:
    if sample_size <= 0 or len(symbols) <= sample_size:
        return list(symbols)
    return sorted(rng.sample(symbols, sample_size))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build valuation regime universes from the latest valuation snapshot.")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to valuation_universe_snapshot.json")
    parser.add_argument("--sample-size", type=int, default=DEFAULT_SAMPLE_SIZE, help="Deterministic sample size per valuation bucket.")
    parser.add_argument("--sample-seed", type=int, default=DEFAULT_SAMPLE_SEED, help="Random seed for deterministic valuation-bucket samples.")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Valuation snapshot not found: {input_path}")

    payload = load_snapshot(input_path)
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []

    buckets, skipped = build_regime_buckets(rows)
    sample_rng = random.Random(args.sample_seed)
    samples = {
        key: build_sample(symbols, args.sample_size, sample_rng)
        for key, symbols in buckets.items()
    }
    generated_at = datetime.utcnow().isoformat() + "Z"

    outputs = {
        "undervalued": DATA_DIR / "valuation_regime_undervalued.json",
        "fair": DATA_DIR / "valuation_regime_fair.json",
        "overvalued": DATA_DIR / "valuation_regime_overvalued.json",
    }
    for key, output_path in outputs.items():
        write_symbol_list(output_path, buckets[key])

    sample_outputs = {
        "undervalued": DATA_DIR / f"valuation_regime_undervalued_sample{args.sample_size}.json",
        "fair": DATA_DIR / f"valuation_regime_fair_sample{args.sample_size}.json",
        "overvalued": DATA_DIR / f"valuation_regime_overvalued_sample{args.sample_size}.json",
    }
    for key, output_path in sample_outputs.items():
        write_symbol_list(output_path, samples[key])

    snapshot = {
        "generated_at": generated_at,
        "source_snapshot": str(input_path),
        "summary": {key: len(symbols) for key, symbols in buckets.items()},
        "sample_config": {
            "sample_size": args.sample_size,
            "sample_seed": args.sample_seed,
        },
        "skipped": skipped,
        "universes": {
            key: {
                "count": len(symbols),
                "symbols": symbols,
            }
            for key, symbols in buckets.items()
        },
        "samples": {
            key: {
                "count": len(symbols),
                "symbols": symbols,
            }
            for key, symbols in samples.items()
        },
    }
    snapshot_path = DATA_DIR / "valuation_regime_snapshot.json"
    with snapshot_path.open("w", encoding="utf-8") as handle:
        json.dump(snapshot, handle, indent=2)
        handle.write("\n")

    print(f"Source snapshot: {input_path}")
    for key in ("undervalued", "fair", "overvalued"):
        print(f"  {key:<12}: {len(buckets[key]):>4} symbols -> {outputs[key]}")
        print(f"  {key + '_sample':<12}: {len(samples[key]):>4} symbols -> {sample_outputs[key]}")
    print(f"Snapshot saved: {snapshot_path}")


if __name__ == "__main__":
    main()
