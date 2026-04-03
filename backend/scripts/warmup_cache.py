#!/usr/bin/env python3
"""
Nightly cache warmup — refreshes OHLCV data for every symbol in the universe.

Run this at 4am via Windows Task Scheduler so all sweeps during the day
hit warm cache instead of making live Yahoo Finance calls.

Usage:
    python backend/scripts/warmup_cache.py
    python backend/scripts/warmup_cache.py --interval 1d
    python backend/scripts/warmup_cache.py --force   # re-download everything
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Allow imports from backend root
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..')))

from backend.services.platform_sdk.ohlcv import fetch_data_yfinance, get_cache_path

SYMBOLS_FILE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'data', 'symbols.json')
)

INTERVALS = ['1d']  # Daily bars are what backtests use most


def load_universe() -> list[str]:
    with open(SYMBOLS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    symbols = data.get('all', [])
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for s in symbols:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return unique


def warmup_symbol(symbol: str, interval: str, force: bool) -> dict:
    start = time.time()
    try:
        bars = fetch_data_yfinance(symbol, period='10y', interval=interval, force_refresh=force)
        elapsed = time.time() - start
        return {'symbol': symbol, 'status': 'ok', 'bars': len(bars), 'elapsed': round(elapsed, 2)}
    except Exception as e:
        elapsed = time.time() - start
        return {'symbol': symbol, 'status': 'error', 'error': str(e), 'elapsed': round(elapsed, 2)}


def main():
    parser = argparse.ArgumentParser(description='Warm up OHLCV cache for full universe')
    parser.add_argument('--interval', default='1d', choices=['1d', '1wk', '1h'], help='Bar interval to warm')
    parser.add_argument('--force', action='store_true', help='Force re-download even if cache is fresh')
    parser.add_argument('--workers', type=int, default=4, help='Parallel download workers (default: 4)')
    parser.add_argument('--dry-run', action='store_true', help='List symbols without downloading')
    args = parser.parse_args()

    symbols = load_universe()
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Warming {len(symbols)} symbols ({args.interval})"
          f"{' [FORCE]' if args.force else ''}{' [DRY RUN]' if args.dry_run else ''}")

    if args.dry_run:
        for s in symbols:
            cache = get_cache_path(s, args.interval)
            exists = os.path.exists(cache)
            age_h = round((time.time() - os.path.getmtime(cache)) / 3600, 1) if exists else None
            status = f"cached ({age_h}h old)" if exists else "MISSING"
            print(f"  {s:20s}  {status}")
        return

    ok = 0
    errors = []
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(warmup_symbol, sym, args.interval, args.force): sym for sym in symbols}
        for i, future in enumerate(as_completed(futures), 1):
            result = future.result()
            sym = result['symbol']
            if result['status'] == 'ok':
                ok += 1
                print(f"  [{i:>3}/{len(symbols)}] OK    {sym:20s}  {result['bars']} bars  ({result['elapsed']}s)")
            else:
                errors.append(result)
                print(f"  [{i:>3}/{len(symbols)}] ERROR {sym:20s}  {result['error'][:60]}")

    elapsed_total = round(time.time() - t0, 1)
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Done — {ok} ok, {len(errors)} errors in {elapsed_total}s")

    if errors:
        print("\nFailed symbols:")
        for r in errors:
            print(f"  {r['symbol']}: {r.get('error', '?')}")
        sys.exit(1)


if __name__ == '__main__':
    main()
