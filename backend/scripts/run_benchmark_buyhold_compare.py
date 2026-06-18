"""Benchmark comparison: buy-and-hold SPY (cap-weighted S&P 500) and RSP (equal-weight
S&P 500) over the same monthly, 1-year-hold formation windows used by the valuation
model portfolio / signal strategy.

This answers the only question that matters for a long-biased strategy run over a bull
market: did it actually beat just buying and holding the index, or was the return simply
market beta? It reuses the study's own bar loader and forward-return helper so the windows
line up apples-to-apples.

Usage:
    python backend/scripts/run_benchmark_buyhold_compare.py
    python backend/scripts/run_benchmark_buyhold_compare.py --start 2021-02-01 --end 2025-04-30 --horizon 252
"""
from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_valuation_gap_accuracy_study as study  # noqa: E402

DEFAULT_BENCHMARKS = ("SPY", "RSP")


def summarize_benchmark(symbol: str, start: str, end: str, horizon: int) -> dict | None:
    bars = study._load_daily_bars(symbol)
    if not bars:
        return None
    start_dt = study._parse_date(start)
    end_dt = study._parse_date(end)
    rets = []
    for i in study._select_rebalance_dates(bars, "monthly", horizon):
        d = study._parse_date(str(bars[i]["date"]))
        if d is None or (start_dt and d < start_dt) or (end_dt and d > end_dt):
            continue
        r = study._forward_return_pct(bars, i, horizon)
        if r is not None:
            rets.append(r)
    if not rets:
        return None
    return {
        "symbol": symbol,
        "windows": len(rets),
        "avg_pct": round(statistics.mean(rets), 2),
        "median_pct": round(statistics.median(rets), 2),
        "win_rate": round(sum(1 for r in rets if r > 0) / len(rets), 2),
        "best_pct": round(max(rets), 2),
        "worst_pct": round(min(rets), 2),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2021-02-01")
    parser.add_argument("--end", default="2025-04-30")
    parser.add_argument("--horizon", type=int, default=252)
    parser.add_argument("--benchmarks", default=",".join(DEFAULT_BENCHMARKS))
    args = parser.parse_args(argv)

    for sym in [s.strip().upper() for s in args.benchmarks.split(",") if s.strip()]:
        row = summarize_benchmark(sym, args.start, args.end, args.horizon)
        if not row:
            print(f"{sym}: no data in window")
            continue
        print(
            f"{row['symbol']:<5} n={row['windows']:>3}  "
            f"avg {row['avg_pct']:+6.2f}%  median {row['median_pct']:+6.2f}%  "
            f"win {row['win_rate']:.0%}  best {row['best_pct']:+6.2f}%  worst {row['worst_pct']:+7.2f}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
