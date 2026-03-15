#!/usr/bin/env python3
"""
RDP Swing Detection Lag Analysis

Measures how many bars after an actual swing high/low RDP first identifies it.
Runs RDP incrementally (adding one bar at a time) and records when each
final swing point first appears.

Usage:
    cd backend/services
    python ../scripts/rdp_lag_analysis.py --symbol MES=F --interval W
    python ../scripts/rdp_lag_analysis.py --symbol MES=F --interval W --epsilon 0.05
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))

from patternScanner import OHLCV, detect_swings_rdp, load_cached_data


def load_chart_data(symbol: str, interval: str):
    interval_map = {"W": "1wk", "D": "1d", "M": "1mo", "4h": "4h", "1h": "1h"}
    yf_interval = interval_map.get(interval, interval)
    data = load_cached_data(symbol, yf_interval)
    if data:
        return data

    safe_sym = symbol.replace("/", "_").replace("=", "_").replace("-", "_")
    cache_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'charts')
    path = os.path.join(cache_dir, f"{safe_sym}_{interval}.json")
    if os.path.exists(path):
        with open(path, 'r') as f:
            cached = json.load(f)
        return [
            OHLCV(
                timestamp=bar.get("timestamp", bar.get("time", "")),
                open=float(bar.get("open", 0)),
                high=float(bar.get("high", 0)),
                low=float(bar.get("low", 0)),
                close=float(bar.get("close", 0)),
                volume=float(bar.get("volume", 0)),
            )
            for bar in cached.get("data", [])
        ]
    return None


def run_lag_analysis(symbol: str, interval: str, epsilon_pct: float, min_bars: int = 40):
    data = load_chart_data(symbol, interval)
    if not data:
        print(f"ERROR: No cached data found for {symbol} ({interval})")
        return

    print(f"\n{'='*80}")
    print(f"RDP LAG ANALYSIS: {symbol} ({interval})")
    print(f"{'='*80}")
    print(f"Total bars: {len(data)}")
    print(f"Date range: {data[0].timestamp[:10]} -> {data[-1].timestamp[:10]}")
    print(f"Epsilon: {epsilon_pct}")
    print(f"Min bars before analysis: {min_bars}")

    # Step 1: Get "ground truth" swing points from full history
    full_swings = detect_swings_rdp(data, f"{symbol}_FULL", interval, epsilon_pct=epsilon_pct)
    final_points = sorted(full_swings.swing_points, key=lambda sp: sp.index)

    print(f"\nFinal swing points (full history): {len(final_points)}")
    print(f"  Highs: {sum(1 for sp in final_points if sp.point_type == 'HIGH')}")
    print(f"  Lows:  {sum(1 for sp in final_points if sp.point_type == 'LOW')}")

    # Step 2: For each final swing point, find when RDP first detects it
    # A swing is "detected" when RDP on data[0:i] produces a point at the same index
    # with the same type (HIGH/LOW).

    final_map = {(sp.index, sp.point_type): sp for sp in final_points}
    first_seen = {}  # (index, type) -> first bar count where it appeared

    print(f"\nRunning incremental RDP from bar {min_bars} to {len(data)}...")
    t0 = time.time()

    for i in range(min_bars, len(data) + 1):
        subset = data[:i]
        swings = detect_swings_rdp(subset, f"{symbol}_LAG_{i}", interval, epsilon_pct=epsilon_pct)

        for sp in swings.swing_points:
            key = (sp.index, sp.point_type)
            if key in final_map and key not in first_seen:
                first_seen[key] = i

        # Progress indicator every 100 bars
        if i % 100 == 0:
            found = len(first_seen)
            total = len(final_map)
            print(f"  Bar {i}/{len(data)} — detected {found}/{total} swing points", end='\r')

    elapsed = time.time() - t0
    print(f"\n  Completed in {elapsed:.1f}s")

    # Step 3: Compute lag for each swing point
    print(f"\n{'-'*80}")
    print(f"{'Type':<6} {'Bar':>5} {'Date':<12} {'Price':>10} {'Detected':>9} {'Lag':>5} {'Lag':>8}")
    print(f"{'':6} {'Idx':>5} {'':12} {'':>10} {'At Bar':>9} {'Bars':>5} {'Weeks':>8}")
    print(f"{'-'*80}")

    high_lags = []
    low_lags = []
    not_found = []

    for sp in final_points:
        key = (sp.index, sp.point_type)
        if key in first_seen:
            lag = first_seen[key] - sp.index
            if sp.point_type == "HIGH":
                high_lags.append(lag)
            else:
                low_lags.append(lag)
            print(f"{sp.point_type:<6} {sp.index:>5} {data[sp.index].timestamp[:10]:<12} "
                  f"{sp.price:>10.2f} {first_seen[key]:>9} {lag:>5} {lag:>8}")
        else:
            not_found.append(sp)
            print(f"{sp.point_type:<6} {sp.index:>5} {data[sp.index].timestamp[:10]:<12} "
                  f"{sp.price:>10.2f} {'NEVER':>9} {'  -':>5} {'  -':>8}")

    # Step 4: Summary statistics
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")

    def stats(lags, label):
        if not lags:
            print(f"\n  {label}: No data")
            return
        lags_sorted = sorted(lags)
        n = len(lags_sorted)
        median = lags_sorted[n // 2]
        avg = sum(lags_sorted) / n
        print(f"\n  {label} ({n} points):")
        print(f"    Min lag:    {min(lags_sorted)} bars")
        print(f"    Max lag:    {max(lags_sorted)} bars")
        print(f"    Avg lag:    {avg:.1f} bars")
        print(f"    Median lag: {median} bars")
        if interval == "W":
            print(f"    Avg lag:    {avg:.1f} weeks ({avg/4.33:.1f} months)")
            print(f"    Median lag: {median} weeks ({median/4.33:.1f} months)")
        elif interval == "D":
            print(f"    Avg lag:    {avg:.1f} days ({avg/5:.1f} trading weeks)")
            print(f"    Median lag: {median} days ({median/5:.1f} trading weeks)")

    stats(high_lags, "HIGHS")
    stats(low_lags, "LOWS")
    stats(high_lags + low_lags, "ALL SWINGS")

    if not_found:
        print(f"\n  WARNING: {len(not_found)} swing points were never detected incrementally.")
        print(f"  These appear only when the full history is available (tail effects).")

    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RDP Swing Detection Lag Analysis")
    parser.add_argument("--symbol", default="MES=F", help="Symbol to analyze (default: MES=F)")
    parser.add_argument("--interval", default="W", help="Interval: W, D, 4h, 1h (default: W)")
    parser.add_argument("--epsilon", type=float, default=0.05, help="RDP epsilon_pct (default: 0.05)")
    parser.add_argument("--min-bars", type=int, default=40, help="Min bars before starting analysis (default: 40)")
    args = parser.parse_args()

    run_lag_analysis(args.symbol, args.interval, args.epsilon, args.min_bars)
