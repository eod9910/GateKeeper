#!/usr/bin/env python3
"""
Fetch market cap for all universe tickers and build named cap-tier lists.

Runs sequentially (1 request at a time) with a small delay to avoid
Yahoo Finance rate limits. Safe to leave running overnight.

Saves:
  backend/data/market_cap_snapshot.json  — full results (ticker -> market_cap in $)
  backend/data/large_cap_500.json        — top 500 by market cap (>= $10B)
  backend/data/mid_cap_500.json          — top 500 mid caps ($2B-$10B)
  backend/data/small_cap_500.json        — top 500 small caps ($300M-$2B)

Usage:
    python backend/scripts/build_large_cap_universe.py
    python backend/scripts/build_large_cap_universe.py --resume   # continue from checkpoint
    python backend/scripts/build_large_cap_universe.py --delay 0.5
"""

import argparse
import json
import os
import sys
import time

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

BASE_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data'))
TICKERS_FILE = os.path.join(BASE_DIR, 'universe_tickers.json')
SNAPSHOT_FILE = os.path.join(BASE_DIR, 'market_cap_snapshot.json')

CAP_TIERS = [
    ("large_cap", 10e9,   None,   "Large cap (>= $10B)"),
    ("mid_cap",    2e9,   10e9,   "Mid cap ($2B - $10B)"),
    ("small_cap",  0.3e9,  2e9,   "Small cap ($300M - $2B)"),
]
CHECKPOINT_EVERY = 500


def fetch_market_cap(symbol: str) -> float | None:
    try:
        t = yf.Ticker(symbol)
        mc = t.fast_info.market_cap
        if mc and mc > 0:
            return float(mc)
        # ETFs don't have marketCap — skip totalAssets (not comparable)
        return None
    except Exception:
        return None


def save_snapshot(snapshot: dict) -> None:
    with open(SNAPSHOT_FILE, 'w') as f:
        json.dump(snapshot, f)


def build_tier_files(snapshot: dict, top_n: int) -> None:
    for name, low, high, description in CAP_TIERS:
        matches = [
            (sym, mc)
            for sym, mc in snapshot.items()
            if mc is not None and mc >= low and (high is None or mc < high)
        ]
        matches.sort(key=lambda x: -x[1])
        selected = matches[:top_n]
        symbols = [sym for sym, _ in selected]

        result = {
            "name": f"{description} (top {len(symbols)})",
            "description": description,
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "count": len(symbols),
            "symbols": symbols,
            "market_caps_billions": {sym: round(mc / 1e9, 2) for sym, mc in selected},
        }

        out_file = os.path.join(BASE_DIR, f"{name}_{top_n}.json")
        with open(out_file, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"  Saved {len(symbols)} {name} tickers -> {os.path.basename(out_file)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--top',    type=int,   default=500, help='Tickers per tier (default: 500)')
    parser.add_argument('--delay',  type=float, default=0.3, help='Seconds between requests (default: 0.3)')
    parser.add_argument('--resume', action='store_true',     help='Continue from existing snapshot checkpoint')
    args = parser.parse_args()

    with open(TICKERS_FILE, 'r') as f:
        all_tickers = json.load(f)

    print(f"Universe: {len(all_tickers)} tickers")
    print(f"Delay: {args.delay}s per request")

    snapshot: dict[str, float | None] = {}
    if args.resume and os.path.exists(SNAPSHOT_FILE):
        with open(SNAPSHOT_FILE, 'r') as f:
            snapshot = json.load(f)
        print(f"Resuming from checkpoint: {len(snapshot)} already done\n")

    to_fetch = [t for t in all_tickers if t not in snapshot]
    total = len(to_fetch)
    eta_min = total * args.delay / 60
    print(f"To fetch: {total} | ETA: {eta_min:.0f} min ({eta_min/60:.1f} hrs)\n")

    start = time.time()
    for i, sym in enumerate(to_fetch, 1):
        mc = fetch_market_cap(sym)
        snapshot[sym] = mc

        if i % CHECKPOINT_EVERY == 0 or i == total:
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 1
            remaining_min = (total - i) / rate / 60
            found = sum(1 for v in snapshot.values() if v is not None)
            large = sum(1 for v in snapshot.values() if v and v >= 10e9)
            print(f"  [{i}/{total}] elapsed: {elapsed/60:.1f}min | ETA: {remaining_min:.0f}min "
                  f"| with data: {found} | large caps: {large}")
            save_snapshot(snapshot)

        time.sleep(args.delay)

    print(f"\nDone. Building tier files...")
    save_snapshot(snapshot)
    build_tier_files(snapshot, args.top)

    found = sum(1 for v in snapshot.values() if v is not None)
    print(f"\nComplete. {found}/{len(all_tickers)} tickers had market cap data.")


if __name__ == '__main__':
    main()
