#!/usr/bin/env python3
"""
Post-Break Behavior Analysis
=============================
For every instrument where hourly structure broke (price below trough),
analyze what happened AFTER the break:
  - Did price ever retest the trough level? (come back within 1-2%)
  - How far did price fall from the trough?
  - How many bars from break to lowest point?

This validates or disproves the "break → retest → continuation" theory.
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(__file__))

from platform_sdk.ohlcv import fetch_data_yfinance, OHLCV
from plugins.choch_primitive import find_structure_levels


def analyze_post_break(data, trough_price, peak_idx, trough_idx):
    """
    After the trough breaks, what happens?
    
    Returns dict with:
      - break_bar_idx: first bar that closed below the trough
      - retested: did price come back within 1.5% of trough after breaking?
      - retest_bar_idx: if retested, which bar?
      - max_drop_pct: max drop below trough (as % of trough price)
      - bars_to_max_drop: how many bars from break to lowest point
      - current_vs_trough_pct: where is price now relative to trough
    """
    # Find the first bar AFTER the peak that closed below the trough
    break_bar_idx = None
    for i in range(peak_idx + 1, len(data)):
        if float(data[i].close) < trough_price:
            break_bar_idx = i
            break

    if break_bar_idx is None:
        return None

    # Now analyze everything after the break
    retest_threshold = 0.015  # Within 1.5% of trough = retest
    retested = False
    retest_bar_idx = None
    lowest_price = float(data[break_bar_idx].low)
    lowest_bar_idx = break_bar_idx

    for i in range(break_bar_idx + 1, len(data)):
        bar_high = float(data[i].high)
        bar_low = float(data[i].low)
        bar_close = float(data[i].close)

        # Check for retest: price comes back UP near the trough
        if bar_high >= trough_price * (1 - retest_threshold):
            retested = True
            if retest_bar_idx is None:
                retest_bar_idx = i

        # Track lowest point
        if bar_low < lowest_price:
            lowest_price = bar_low
            lowest_bar_idx = i

    current_price = float(data[-1].close)
    max_drop_pct = ((trough_price - lowest_price) / trough_price) * 100
    current_vs_trough_pct = ((current_price - trough_price) / trough_price) * 100
    bars_from_break = lowest_bar_idx - break_bar_idx
    bars_since_break = len(data) - 1 - break_bar_idx

    return {
        "break_bar_idx": break_bar_idx,
        "bars_since_break": bars_since_break,
        "retested": retested,
        "retest_bar_idx": retest_bar_idx,
        "retest_bars_after_break": (retest_bar_idx - break_bar_idx) if retest_bar_idx else None,
        "max_drop_pct": round(max_drop_pct, 2),
        "bars_to_max_drop": bars_from_break,
        "lowest_price": round(lowest_price, 2),
        "current_price": round(current_price, 2),
        "current_vs_trough_pct": round(current_vs_trough_pct, 2),
    }


def main():
    # Load symbol library
    symbols_path = os.path.join(os.path.dirname(__file__), "..", "data", "symbols.json")
    with open(symbols_path) as f:
        symbol_lib = json.load(f)

    # Use small_caps_180 or whatever the user scanned
    symbols = symbol_lib.get("small_caps_180", symbol_lib.get("all", []))
    if not symbols:
        print("No symbols found", file=sys.stderr)
        return

    interval = "1h"
    period = "60d"
    timeframe = "1h"
    rally_threshold = 0.04  # Same as hourly default

    print(f"\n{'='*80}")
    print(f"POST-BREAK BEHAVIOR ANALYSIS")
    print(f"Interval: {interval} | Rally threshold: {rally_threshold*100:.0f}% | Symbols: {len(symbols)}")
    print(f"{'='*80}\n")

    broke_count = 0
    retest_count = 0
    no_retest_count = 0
    total_max_drop = 0
    results = []

    for sym in symbols:
        try:
            data = fetch_data_yfinance(sym, period=period, interval=interval)
            if not data or len(data) < 20:
                continue
        except Exception:
            continue

        structure = find_structure_levels(data, rally_threshold_pct=rally_threshold)
        if structure is None:
            continue

        # Only interested in broken structures
        if structure["structure_intact"]:
            continue

        broke_count += 1
        analysis = analyze_post_break(
            data,
            structure["trough_price"],
            structure["peak_idx"],
            structure["trough_idx"],
        )

        if analysis is None:
            continue

        if analysis["retested"]:
            retest_count += 1
            retest_label = f"YES (after {analysis['retest_bars_after_break']} bars)"
        else:
            no_retest_count += 1
            retest_label = "NO"

        total_max_drop += analysis["max_drop_pct"]

        results.append({
            "symbol": sym,
            "peak": structure["peak_price"],
            "trough": structure["trough_price"],
            "current": analysis["current_price"],
            "retested": analysis["retested"],
            "max_drop_pct": analysis["max_drop_pct"],
            "bars_since_break": analysis["bars_since_break"],
        })

        print(
            f"  {sym:8s} | peak=${structure['peak_price']:>8.2f} | "
            f"trough=${structure['trough_price']:>8.2f} | "
            f"now=${analysis['current_price']:>8.2f} ({analysis['current_vs_trough_pct']:+.1f}%) | "
            f"max_drop={analysis['max_drop_pct']:.1f}% | "
            f"retest={retest_label}"
        )

    # Summary
    print(f"\n{'='*80}")
    print(f"SUMMARY")
    print(f"{'='*80}")
    print(f"Total symbols scanned:     {len(symbols)}")
    print(f"Structures broken:         {broke_count}")
    print(f"  - Retested trough:       {retest_count} ({retest_count/broke_count*100:.0f}% of breaks)" if broke_count > 0 else "")
    print(f"  - NO retest (waterfall): {no_retest_count} ({no_retest_count/broke_count*100:.0f}% of breaks)" if broke_count > 0 else "")
    print(f"Average max drop below trough: {total_max_drop/broke_count:.1f}%" if broke_count > 0 else "")
    print(f"{'='*80}")

    if broke_count > 0:
        print(f"\nVERDICT: ", end="")
        if no_retest_count / broke_count > 0.65:
            print(f"Data CONFIRMS your observation — {no_retest_count/broke_count*100:.0f}% of breaks "
                  f"do NOT retest. Once it breaks, it drops.")
        elif retest_count / broke_count > 0.50:
            print(f"Data shows retests DO happen — {retest_count/broke_count*100:.0f}% of breaks "
                  f"came back near the trough level.")
        else:
            print(f"Mixed results — {retest_count/broke_count*100:.0f}% retested, "
                  f"{no_retest_count/broke_count*100:.0f}% waterfalled.")


if __name__ == "__main__":
    main()
