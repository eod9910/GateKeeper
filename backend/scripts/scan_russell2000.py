"""
Russell 2000 Universe Scanner — Wiggle Base Primitive
======================================================
Loads all daily CSVs from data/universe/, aggregates to weekly bars,
runs the wiggle base detector, and ranks stocks by base quality.

Usage (from backend/services):
    py ../scripts/scan_russell2000.py
    py ../scripts/scan_russell2000.py --workers 8 --min-wiggle 0.40
    py ../scripts/scan_russell2000.py --top 50 --min-bars 60
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional

_HERE    = os.path.dirname(os.path.abspath(__file__))
_SVC     = os.path.join(_HERE, "..", "services")
_PLUGINS = os.path.join(_SVC, "plugins")
_DATA    = os.path.join(_HERE, "..", "data", "universe")

sys.path.insert(0, _SVC)
sys.path.insert(0, _PLUGINS)

from ohlcv import OHLCV, load_data_from_csv, aggregate_bars as _agg
from rdp_wiggle_base_primitive import run_rdp_wiggle_base_primitive_plugin

# ── Calibrated params ────────────────────────────────────────────────────────
SPEC = {
    "setup_config": {
        "epsilon_coarse":   0.05,
        "epsilon_fine":     0.010,
        "window_n":         8,
        "persist_m":        2,
        "wiggle_threshold": 0.30,
        "k_expand":         2.0,
        "max_marked_events": 3,
    }
}

DAILY_TO_WEEKLY = 5   # aggregate 5 daily bars → 1 weekly bar


# ─────────────────────────────────────────────────────────────────────────────

def _load_weekly(csv_path: str) -> List[OHLCV]:
    """Load daily CSV and aggregate to weekly bars."""
    try:
        daily = load_data_from_csv(csv_path)
        if len(daily) < 30:
            return []
        return _agg(daily, DAILY_TO_WEEKLY)
    except Exception:
        return []


def _run_detector(bars: List[OHLCV], symbol: str) -> list:
    old_err = sys.stderr; sys.stderr = io.StringIO()
    try:
        return run_rdp_wiggle_base_primitive_plugin(
            data=bars, structure=None, spec=SPEC, symbol=symbol, timeframe="W"
        ) or []
    except Exception:
        return []
    finally:
        sys.stderr = old_err


def _scan_one(csv_file: str, min_weekly_bars: int) -> Optional[dict]:
    symbol = csv_file.replace("_1d.csv", "")
    path   = os.path.join(_DATA, csv_file)

    bars = _load_weekly(path)
    if len(bars) < min_weekly_bars:
        return None

    candidates = _run_detector(bars, symbol)
    if not candidates:
        return None

    c = candidates[0]
    events = c.get("output_ports", {}).get("rdp_wiggle_base", {}).get("events", [])
    qualified = [e for e in events if e.get("qualify_idx") is not None]
    active    = [e for e in qualified if e.get("active")]

    if not active:
        return None

    current_price = bars[-1].close

    # Find the MOST RECENT qualified+active base whose box contains or is near current price.
    # "near" = current price within [floor*0.85 .. cap*1.25] — allows for:
    #   - slight undercut below floor (shakeout / spring)
    #   - fresh breakout up to +25% above cap (just broke out, still actionable)
    best = None
    for e in active:
        anchor_price = e.get("anchor_price", 0)
        cap_price    = e.get("cap_price", 0)
        if anchor_price <= 0 or cap_price <= anchor_price:
            continue
        lower_bound = anchor_price * 0.85
        upper_bound = cap_price   * 1.25
        if lower_bound <= current_price <= upper_bound:
            best = e
            break  # events are already sorted most-recent-anchor first

    if best is None:
        return None

    anchor_price  = best.get("anchor_price", 0)
    cap_price     = best.get("cap_price", 0)
    wiggle        = best.get("wiggle") or 0.0
    alt           = best.get("alt")   or 0.0
    amp           = best.get("amp")   or 0.0
    turn          = best.get("turn")  or 0.0
    anchor_idx    = best.get("anchor_idx", 0)
    qualify_rel   = best.get("qualify_idx") or 0
    qualify_abs   = anchor_idx + qualify_rel

    box_range     = cap_price - anchor_price
    price_in_box  = (current_price - anchor_price) / box_range if box_range > 0 else 0
    box_pct       = box_range / anchor_price * 100 if anchor_price > 0 else 0

    # Broken out = price is above cap (regardless of how far)
    broken_out    = current_price > cap_price

    anchor_date   = bars[anchor_idx].timestamp[:10] if anchor_idx < len(bars) else "?"
    qualify_date  = bars[qualify_abs].timestamp[:10] if qualify_abs < len(bars) else "?"
    n_base_weeks  = qualify_rel
    n_total_weeks = len(bars)

    return {
        "symbol":       symbol,
        "wiggle":       round(wiggle, 3),
        "alt":          round(alt, 3),
        "amp":          round(amp, 3),
        "turn":         round(turn, 3),
        "floor":        round(anchor_price, 2),
        "cap":          round(cap_price, 2),
        "current":      round(current_price, 2),
        "box_pct":      round(box_pct, 1),
        "price_in_box": round(price_in_box * 100, 1),
        "broken_out":   broken_out,
        "anchor_date":  anchor_date,
        "qualify_date": qualify_date,
        "n_base_weeks": n_base_weeks,
        "n_total_weeks": n_total_weeks,
        "active_count": len(active),
    }


def _duration_str(n_weeks: int) -> str:
    if n_weeks < 8:   return f"{n_weeks}w"
    months = n_weeks / 4.33
    if months < 24:   return f"{months:.0f}mo"
    return f"{months/12:.1f}yr"


def main():
    parser = argparse.ArgumentParser(description="Scan Russell 2000 for active wiggle bases")
    parser.add_argument("--workers",      type=int,   default=6,    help="Parallel workers")
    parser.add_argument("--min-wiggle",   type=float, default=0.40, help="Min WIGGLE score to include")
    parser.add_argument("--min-bars",     type=int,   default=60,   help="Min weekly bars required")
    parser.add_argument("--top",          type=int,   default=50,   help="Show top N results")
    parser.add_argument("--no-broken",    action="store_true",      help="Exclude broken-out bases")
    parser.add_argument("--max-box-pct",  type=float, default=50.0, help="Max box width as %% of floor (default 50)")
    parser.add_argument("--min-weeks",    type=int,   default=10,   help="Min base duration in weeks")
    parser.add_argument("--max-anchor-weeks", type=int, default=130, help="Max age of anchor in weeks (~2.5yr)")
    parser.add_argument("--in-box-only",  action="store_true",      help="Only include price strictly inside the box")
    parser.add_argument("--out",          default=None,             help="Save results to JSON file")
    args = parser.parse_args()

    csv_files = sorted([f for f in os.listdir(_DATA) if f.endswith("_1d.csv")])
    total = len(csv_files)
    print(f"Russell 2000 scanner  |  {total} stocks  |  {args.workers} workers")
    print(f"Filter: min_wiggle={args.min_wiggle}  max_box={args.max_box_pct}%  "
          f"base_dur>={args.min_weeks}wk  anchor_age<={args.max_anchor_weeks}wk  top={args.top}")
    print()

    results = []
    done = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_scan_one, f, args.min_bars): f for f in csv_files}
        for fut in as_completed(futures):
            done += 1
            if done % 100 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed
                eta = (total - done) / rate if rate > 0 else 0
                print(f"  [{done:4d}/{total}]  found={len(results)}  "
                      f"elapsed={elapsed:.0f}s  ETA={eta:.0f}s")
            try:
                r = fut.result()
                if r is None:
                    continue
                # Quality filters
                if r["wiggle"] < args.min_wiggle:
                    continue
                if r["box_pct"] > args.max_box_pct:
                    continue
                if r["n_base_weeks"] < args.min_weeks:
                    continue
                # Anchor age: how many weeks ago was the base formed?
                anchor_age_weeks = r["n_total_weeks"] - (r["n_total_weeks"] - (r["n_total_weeks"] - r["n_base_weeks"]))
                # Simpler: use n_total_weeks - n_base_weeks as proxy for anchor position
                # (n_base_weeks measures length RELATIVE to anchor)
                # Just filter out very old anchors by anchor_date string comparison
                from datetime import date
                try:
                    anchor_dt = date.fromisoformat(r["anchor_date"])
                    age_weeks = (date.today() - anchor_dt).days // 7
                    if age_weeks > args.max_anchor_weeks:
                        continue
                except Exception:
                    pass
                if args.no_broken and r["broken_out"]:
                    continue
                if args.in_box_only and (r["price_in_box"] < 0 or r["price_in_box"] > 100):
                    continue
                results.append(r)
            except Exception:
                pass

    # Sort by wiggle score descending
    results.sort(key=lambda x: -x["wiggle"])

    elapsed_total = time.time() - t0
    print(f"\nScan complete in {elapsed_total:.1f}s  |  {len(results)} active bases found")

    # ── Split into two groups ─────────────────────────────────────────────────
    in_base = [r for r in results if not r["broken_out"]]
    broken  = [r for r in results if r["broken_out"]]

    def _print_table(rows, title):
        if not rows:
            return
        rows = rows[:args.top]
        print()
        print("=" * 92)
        print(f"  {title}  ({len(rows)} shown)")
        print("=" * 92)
        hdr = f"{'#':>3}  {'SYM':<7} {'WIGGLE':>7} {'ALT':>5} {'AMP':>5} {'TURN':>5}  "
        hdr += f"{'FLOOR':>8} {'CAP':>8} {'CUR':>8}  {'BOX%':>5} {'IN BOX':>7}  "
        hdr += f"{'DURATION':<9} {'ANCHOR'}"
        print(hdr)
        print("-" * 92)
        for i, r in enumerate(rows, 1):
            dur = _duration_str(r["n_base_weeks"])
            row = (
                f"{i:>3}  {r['symbol']:<7} {r['wiggle']:>7.3f} {r['alt']:>5.2f} "
                f"{r['amp']:>5.2f} {r['turn']:>5.2f}  "
                f"{r['floor']:>8.2f} {r['cap']:>8.2f} {r['current']:>8.2f}  "
                f"{r['box_pct']:>4.1f}% {r['price_in_box']:>6.1f}%  "
                f"{dur:<9} {r['anchor_date']}"
            )
            print(row)

    _print_table(in_base, "STILL IN BASE  (consolidating, not yet broken out)")
    _print_table(broken,  "RECENTLY BROKEN OUT  (escaped above cap)")

    # ── Summary stats ─────────────────────────────────────────────────────────
    print()
    print("SUMMARY STATS")
    print(f"  Total active bases found : {len(results)}")
    print(f"  Still in base            : {len(in_base)}")
    print(f"  Recently broken out      : {len(broken)}")
    if results:
        avg_w = sum(r["wiggle"] for r in results) / len(results)
        print(f"  Avg WIGGLE score         : {avg_w:.3f}")

    # ── Optionally save ───────────────────────────────────────────────────────
    out_path = args.out
    if not out_path:
        out_path = os.path.join(_HERE, "..", "data", "scan_results_wiggle_base.json")

    with open(out_path, "w") as f:
        json.dump({"scan_date": time.strftime("%Y-%m-%d"), "results": results}, f, indent=2)
    print(f"\nFull results saved to: {out_path}")


if __name__ == "__main__":
    main()
