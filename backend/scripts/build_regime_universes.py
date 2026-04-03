#!/usr/bin/env python3
"""
build_regime_universes.py
--------------------------
Classifies every stock in universe_tickers.json by its current market regime
(expansion / distribution / accumulation / markdown) using a 200-MA + 20-bar ROC
approach applied to each stock's own price history.

Outputs (to backend/data/):
  regime_expansion.json     — stocks in uptrend above 200MA
  regime_distribution.json  — stocks above 200MA but losing momentum
  regime_accumulation.json  — stocks below 200MA but recovering
  regime_markdown.json      — stocks below 200MA and declining
  regime_snapshot.json      — full classification table with metadata

Usage:
  py backend/scripts/build_regime_universes.py [--limit N] [--interval 1d|1wk]
"""

import json
import os
import sys
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
UNIVERSE_DIR = os.path.join(DATA_DIR, "universe")
SERVICES_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "services"))
sys.path.insert(0, SERVICES_DIR)

from universe_registry import load_clean_stock_symbols  # noqa: E402


def load_universe() -> list[str]:
    symbols = load_clean_stock_symbols()
    if not symbols:
        print("ERROR: clean_stocks universe unavailable. Rebuild the stock universe registry inputs first.")
        sys.exit(1)
    return symbols


def classify_regime(closes: list[float]) -> str:
    """200-MA + 20-bar ROC regime classification."""
    n = len(closes)
    if n < 210:
        return "unknown"
    ma200 = sum(closes[-200:]) / 200
    price = closes[-1]
    roc20 = (price - closes[-21]) / closes[-21] * 100 if closes[-21] > 0 else 0

    above_ma = price > ma200
    if above_ma and roc20 > 0:
        return "expansion"
    elif above_ma and roc20 <= 0:
        return "distribution"
    elif not above_ma and roc20 > -3:
        return "accumulation"
    else:
        return "markdown"


def load_closes_from_csv(symbol: str, interval: str) -> list[float]:
    """Try to load closing prices from local CSV universe cache."""
    fname = f"{symbol}_{interval}.csv"
    fpath = os.path.join(UNIVERSE_DIR, fname)
    if not os.path.exists(fpath):
        return []
    closes = []
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            lines = f.readlines()
        header = None
        close_idx = -1
        for line in lines:
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            if header is None:
                header = parts
                for i, h in enumerate(header):
                    if h.strip().lower() in ("close", "adj close", "adj_close"):
                        close_idx = i
                        break
                continue
            if close_idx >= 0 and close_idx < len(parts):
                try:
                    closes.append(float(parts[close_idx]))
                except ValueError:
                    pass
    except Exception:
        pass
    return closes


def load_closes_from_yfinance(symbol: str, interval: str) -> list[float]:
    """Fetch from yfinance as fallback."""
    try:
        import yfinance as yf
        period = "2y" if interval == "1d" else "5y"
        df = yf.download(symbol, period=period, interval=interval,
                         progress=False, auto_adjust=True)
        if df is None or df.empty:
            return []
        return [float(c) for c in df["Close"].dropna()]
    except Exception:
        return []


def build_regime_universes(limit: int | None = None, interval: str = "1d") -> None:
    tickers = load_universe()
    if limit:
        tickers = tickers[:limit]

    print(f"Classifying {len(tickers)} stocks on {interval} bars...")

    results: list[dict] = []
    regime_buckets: dict[str, list[str]] = {
        "expansion": [], "distribution": [], "accumulation": [], "markdown": [], "unknown": []
    }

    for i, sym in enumerate(tickers):
        if i > 0 and i % 100 == 0:
            totals = {k: len(v) for k, v in regime_buckets.items() if k != "unknown"}
            print(f"  [{i}/{len(tickers)}] regimes so far: {totals}")

        closes = load_closes_from_csv(sym, interval)
        source = "csv"
        if len(closes) < 210:
            # CSV too short or missing — skip yfinance to avoid rate limits
            regime = "unknown"
            source = "missing"
        else:
            regime = classify_regime(closes)

        regime_buckets[regime].append(sym)
        results.append({
            "symbol": sym,
            "regime": regime,
            "source": source,
            "bars": len(closes),
        })

    # Save outputs
    snapshot = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "interval": interval,
        "total": len(tickers),
        "summary": {k: len(v) for k, v in regime_buckets.items()},
        "tickers": results,
    }

    out = os.path.join(DATA_DIR, "regime_snapshot.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    print(f"\nSnapshot saved: {out}")

    for regime, syms in regime_buckets.items():
        if regime == "unknown":
            continue
        out = os.path.join(DATA_DIR, f"regime_{regime}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(syms, f, indent=2)
        print(f"  {regime:<16}: {len(syms):>4} stocks -> {out}")

    print("\nSummary:")
    for regime in ["expansion", "distribution", "accumulation", "markdown", "unknown"]:
        syms = regime_buckets[regime]
        print(f"  {regime:<16}: {len(syms)}")

    print("\nDone.")


def main() -> None:
    args = sys.argv[1:]
    limit = None
    interval = "1d"
    for i, a in enumerate(args):
        if a == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
        if a == "--interval" and i + 1 < len(args):
            interval = args[i + 1]

    build_regime_universes(limit=limit, interval=interval)


if __name__ == "__main__":
    main()
