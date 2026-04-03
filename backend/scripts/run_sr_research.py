#!/usr/bin/env python3
"""
Run SR for Research sessions: load bars -> build X,y -> gplearn -> output JSON.

Prints a single JSON object to stdout so Node can parse it.

Usage:
  python backend/scripts/run_sr_research.py --symbol SPY --interval 1d \
    [--years 2] [--target_bars 5] [--population_size 500] [--generations 20] \
    [--features '[{"id":"rsi","period":14},{"id":"sma_distance","period":20}]']
"""

from __future__ import annotations

import argparse
import json
import os
import sys

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_SERVICES = os.path.join(_BACKEND, "services")
if _SERVICES not in sys.path:
    sys.path.insert(0, _SERVICES)


def load_bars_yfinance(symbol: str, interval: str, date_start: str, date_end: str):
    try:
        import yfinance as yf
    except ImportError:
        return [], "error"
    yahoo_interval = "1h" if interval == "4h" else interval
    df = yf.download(symbol, start=date_start, end=date_end, interval=yahoo_interval, progress=False, auto_adjust=False)
    if df is None or len(df) == 0:
        return [], "no_data"
    bars = []
    for idx, row in df.iterrows():
        ts = idx.strftime("%Y-%m-%d %H:%M:%S") if hasattr(idx, "strftime") else str(idx)
        def _f(v):
            if hasattr(v, "iloc"):
                return float(v.iloc[0])
            return float(v)
        o = _f(row.get("Open", row.get("open", 0)))
        h = _f(row.get("High", row.get("high", 0)))
        l_ = _f(row.get("Low", row.get("low", 0)))
        c = _f(row.get("Close", row.get("close", 0)))
        if o != o or h != h or l_ != l_ or c != c:
            continue
        bars.append({"timestamp": ts, "open": o, "high": h, "low": l_, "close": c})
    if interval == "4h" and len(bars) >= 4:
        agg = []
        for i in range(0, len(bars) - 3, 4):
            agg.append({
                "timestamp": bars[i + 3]["timestamp"],
                "open": bars[i]["open"],
                "high": max(b["high"] for b in bars[i : i + 4]),
                "low": min(b["low"] for b in bars[i : i + 4]),
                "close": bars[i + 3]["close"],
            })
        bars = agg
    return bars, "ok" if bars else "no_data"


def main() -> None:
    parser = argparse.ArgumentParser(description="SR research: bars -> formula JSON")
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--interval", default="1d")
    parser.add_argument("--years", type=float, default=2.0)
    parser.add_argument("--target_bars", type=int, default=5)
    parser.add_argument("--population_size", type=int, default=500)
    parser.add_argument("--generations", type=int, default=20)
    parser.add_argument("--features", default=None,
                        help='JSON array of feature specs, e.g. [{"id":"rsi","period":14},{"id":"sma_distance","period":20}]')
    args = parser.parse_args()

    from datetime import datetime, timedelta

    end = datetime.now()
    start = end - timedelta(days=int(args.years * 365))
    date_start = start.strftime("%Y-%m-%d")
    date_end = end.strftime("%Y-%m-%d")

    bars, status = load_bars_yfinance(args.symbol, args.interval, date_start, date_end)
    if status != "ok" or not bars:
        print(json.dumps({"success": False, "error": f"load_bars failed: status={status}, n={len(bars)}"}))
        sys.exit(1)

    from sr.feature_matrix import build_feature_matrix_from_bars, get_feature_names
    from sr.formula_registry import persist_formula
    from sr.regression import run_symbolic_regression

    fm_config = {
        "target_bars": args.target_bars,
        "target_atr_normalized": True,
    }
    if args.features:
        try:
            fm_config["features"] = json.loads(args.features)
        except json.JSONDecodeError as e:
            print(json.dumps({"success": False, "error": f"Invalid --features JSON: {e}"}))
            sys.exit(1)

    feature_names = get_feature_names(fm_config)

    X, y, meta = build_feature_matrix_from_bars(bars, config=fm_config)
    if X.shape[0] == 0:
        print(json.dumps({"success": False, "error": "No rows after building feature matrix"}))
        sys.exit(1)

    parsimony_coefficient = 0.01

    result = run_symbolic_regression(
        X, y,
        config={
            "population_size": args.population_size,
            "generations": args.generations,
            "parsimony_coefficient": parsimony_coefficient,
        },
        feature_names=feature_names,
    )

    formula_id = None
    if result.get("success") and result.get("formula"):
        record = persist_formula(
            formula=result.get("formula", ""),
            formula_readable=result.get("formula_readable", ""),
            feature_specs=fm_config.get("features") or [],
            feature_names=feature_names,
            result=result,
            training_context={
                "symbol": args.symbol,
                "interval": args.interval,
                "years": args.years,
                "target_bars": args.target_bars,
                "target_atr_normalized": True,
                "population_size": args.population_size,
                "generations": args.generations,
                "parsimony_coefficient": parsimony_coefficient,
            },
        )
        formula_id = record.get("formula_id")

    payload = {
        "success": result.get("success", False),
        "formula_id": formula_id,
        "formula": result.get("formula", ""),
        "formula_readable": result.get("formula_readable", ""),
        "complexity": result.get("complexity", 0),
        "fitness": result.get("fitness", 0.0),
        "n_samples": result.get("n_samples", 0),
        "error": result.get("error"),
        "symbol": args.symbol,
        "interval": args.interval,
        "n_bars": len(bars),
        "features_used": feature_names,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
