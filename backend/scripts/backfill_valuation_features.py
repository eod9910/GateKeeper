#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "backend" / "scripts"
SERVICES_DIR = ROOT / "backend" / "services"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from run_fundamental_backtester import _load_bars, _load_universe_symbols, _safe_float, _select_rebalance_indices
from valuation_feature_store import (
    DEFAULT_GAP_THRESHOLD_PCT,
    ensure_valuation_feature_schema,
    get_valuation_features,
    valuation_feature_coverage,
)


def _bar_price(bars: List[Dict[str, Any]], index: int) -> Optional[float]:
    if index < 0 or index >= len(bars):
        return None
    return _safe_float(bars[index].get("close"))


def backfill(
    *,
    universe: str,
    start: Optional[str],
    end: Optional[str],
    frequency: str,
    limit: int,
    max_forward_bars: int,
    gap_threshold_pct: float,
) -> Dict[str, Any]:
    ensure_valuation_feature_schema()
    symbols = _load_universe_symbols(universe)
    if limit > 0:
        symbols = symbols[:limit]

    attempted = 0
    written = 0
    missing = 0
    asof_dates = set()
    for symbol in symbols:
        bars = _load_bars(symbol)
        if not bars:
            continue
        for index in _select_rebalance_indices(
            bars,
            frequency,
            start=start,
            end=end,
            max_forward_bars=max_forward_bars,
        ):
            asof_date = str(bars[index]["date"])
            asof_dates.add(asof_date)
            attempted += 1
            features = get_valuation_features(
                symbol,
                asof_date,
                _bar_price(bars, index),
                gap_threshold_pct=gap_threshold_pct,
                prefer_persisted=False,
                persist=True,
            )
            if features:
                written += 1
            else:
                missing += 1

    coverage = valuation_feature_coverage(
        symbols,
        asof_dates,
        gap_threshold_pct=gap_threshold_pct,
    )
    return {
        "universe": universe,
        "start": start,
        "end": end,
        "frequency": frequency,
        "symbol_count": len(symbols),
        "rebalance_date_count": len(asof_dates),
        "attempted": attempted,
        "written": written,
        "missing": missing,
        "coverage": coverage,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill canonical valuation_features rows for rebalance dates.")
    parser.add_argument("--universe", default="clean")
    parser.add_argument("--start", default=None)
    parser.add_argument("--end", default=None)
    parser.add_argument("--frequency", default="monthly", choices=["monthly", "quarterly", "yearly"])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-forward-bars", type=int, default=180)
    parser.add_argument("--gap-threshold-pct", type=float, default=DEFAULT_GAP_THRESHOLD_PCT)
    args = parser.parse_args()
    result = backfill(
        universe=args.universe,
        start=args.start,
        end=args.end,
        frequency=args.frequency,
        limit=max(0, int(args.limit or 0)),
        max_forward_bars=max(1, int(args.max_forward_bars or 180)),
        gap_threshold_pct=float(args.gap_threshold_pct),
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
