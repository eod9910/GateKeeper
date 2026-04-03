#!/usr/bin/env python3
"""
Demo: Run Symbolic Regression on bar-level indicator data (easiest path).

Loads bars for one symbol (default SPY, 1d), builds X (RSI, ATR_norm, momentum)
and y (forward 5-bar ATR return), runs gplearn, prints formula and fitness.

Usage (from repo root or backend):
  python backend/scripts/run_sr_indicator_demo.py [--symbol SPY] [--interval 1d] [--years 2]
"""

from __future__ import annotations

import argparse
import os
import sys

# Ensure backend/services is on path so we can import sr (which uses platform_sdk)
_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_SERVICES = os.path.join(_BACKEND, "services")
if _SERVICES not in sys.path:
    sys.path.insert(0, _SERVICES)


def load_bars_yfinance(symbol: str, interval: str, date_start: str, date_end: str):
    """Load OHLCV bars via yfinance (no validator dependency). Returns (bars, 'ok'|'no_data'|'error')."""
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
        if o != o or h != h or l_ != l_ or c != c:  # NaN check
            continue
        bars.append({"timestamp": ts, "open": o, "high": h, "low": l_, "close": c})
    if interval == "4h" and len(bars) >= 4:
        # Simple 4h aggregate: take every 4th bar's close, etc.
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
    parser = argparse.ArgumentParser(description="SR demo: indicator + OHLCV -> formula")
    parser.add_argument("--symbol", default="SPY", help="Symbol (default SPY)")
    parser.add_argument("--interval", default="1d", help="Interval: 1d, 1wk, 4h (default 1d)")
    parser.add_argument("--years", type=float, default=2.0, help="Years of history (default 2)")
    args = parser.parse_args()

    from datetime import datetime, timedelta

    end = datetime.now()
    start = end - timedelta(days=int(args.years * 365))
    date_start = start.strftime("%Y-%m-%d")
    date_end = end.strftime("%Y-%m-%d")

    from sr.feature_matrix import build_feature_matrix_from_bars
    from sr.regression import run_symbolic_regression, DEFAULT_FEATURE_NAMES

    print(f"Loading {args.symbol} {args.interval} from {date_start} to {date_end}...")
    bars, status = load_bars_yfinance(args.symbol, args.interval, date_start, date_end)
    if status != "ok" or not bars:
        print(f"Failed to load bars: status={status}, n={len(bars)}")
        sys.exit(1)
    print(f"Loaded {len(bars)} bars.")

    print("Building feature matrix (RSI, ATR_norm, momentum) and target (forward 5-bar ATR return)...")
    X, y, meta = build_feature_matrix_from_bars(
        bars,
        config={"target_bars": 5, "target_atr_normalized": True},
    )
    if X.shape[0] == 0:
        print("No rows after building matrix (not enough data or NaNs).")
        sys.exit(1)
    print(f"X shape: {X.shape}, y shape: {y.shape}")

    print("Running symbolic regression (gplearn)...")
    result = run_symbolic_regression(
        X, y,
        config={"population_size": 500, "generations": 20, "parsimony_coefficient": 0.01},
        feature_names=DEFAULT_FEATURE_NAMES,
    )

    if not result.get("success"):
        print(f"SR failed: {result.get('error', 'unknown')}")
        sys.exit(1)
    print(f"Formula (raw): {result['formula']}")
    print(f"Formula (readable): {result['formula_readable']}")
    print(f"Complexity: {result['complexity']}, R² (train): {result['fitness']:.4f}, n_samples: {result['n_samples']}")
    print("Done.")


if __name__ == "__main__":
    main()
