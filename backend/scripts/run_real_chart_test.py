"""
Real-chart test for rdp_wiggle_base_primitive.

Fetches weekly OHLCV data via yfinance and runs the detector with the
calibrated parameters. Reports what bases were found, where, and whether
a breakout has occurred.

Usage (from backend/services):
    py ../scripts/run_real_chart_test.py
    py ../scripts/run_real_chart_test.py --tickers NVDA AAPL MSFT --period 10y
"""
from __future__ import annotations

import argparse
import io
import os
import sys
from datetime import datetime

_HERE    = os.path.dirname(os.path.abspath(__file__))
_SVC     = os.path.join(_HERE, "..", "services")
_PLUGINS = os.path.join(_SVC, "plugins")
sys.path.insert(0, _SVC)
sys.path.insert(0, _PLUGINS)

from ohlcv import fetch_data_yfinance, OHLCV
from rdp_wiggle_base_primitive import run_rdp_wiggle_base_primitive_plugin

# ── Calibrated parameters (from synthetic grid search 2026-02-20) ────────────
BEST_SPEC = {
    "setup_config": {
        "epsilon_coarse":  0.05,
        "epsilon_fine":    0.010,
        "window_n":        8,
        "persist_m":       2,
        "wiggle_threshold": 0.30,
        "k_expand":        2.0,
        "max_marked_events": 5,
    }
}

# Tickers with historically clear base structures across durations
DEFAULT_TICKERS = [
    # Long primary accumulation bases
    "NVDA",   # ~2yr base 2021-2023 before explosion
    "AMD",    # multiple base phases
    "TSLA",   # long base 2019-2020
    # Medium reaccumulation
    "AAPL",
    "MSFT",
    "META",
    # Shorter bases / more active
    "SPY",
    "QQQ",
]

def _fetch(ticker: str, period: str, interval: str) -> list:
    """Fetch OHLCV data, suppress yfinance chatter."""
    old_stderr = sys.stderr
    sys.stderr = io.StringIO()
    try:
        bars = fetch_data_yfinance(ticker, period=period, interval=interval)
    finally:
        sys.stderr = old_stderr
    return bars or []


def _run(bars: list, ticker: str) -> list:
    """Run detector, suppress RDP verbose output."""
    old_stderr = sys.stderr
    sys.stderr = io.StringIO()
    try:
        result = run_rdp_wiggle_base_primitive_plugin(
            data=bars,
            structure=None,
            spec=BEST_SPEC,
            symbol=ticker,
            timeframe="W",
        )
    finally:
        sys.stderr = old_stderr
    return result or []


def _duration_str(n_bars: int) -> str:
    weeks = n_bars
    if weeks < 8:
        return f"{weeks}w"
    months = weeks / 4.33
    if months < 24:
        return f"{months:.0f}mo"
    return f"{months/12:.1f}yr"


def _bar_date(bars: list, idx: int) -> str:
    if 0 <= idx < len(bars):
        return bars[idx].timestamp[:10]
    return "?"


def report_ticker(ticker: str, bars: list, candidates: list) -> None:
    print(f"\n{'='*64}")
    print(f"  {ticker}   ({len(bars)} weekly bars)")
    print(f"{'='*64}")

    if not candidates:
        print("  No candidates returned.")
        return

    c = candidates[0]
    events = c.get("output_ports", {}).get("rdp_wiggle_base", {}).get("events", [])

    if not events:
        print("  No base events found.")
        return

    current_price = bars[-1].close if bars else 0
    print(f"  Current price: ${current_price:.2f}   as of {bars[-1].timestamp[:10]}")
    print()

    for i, e in enumerate(events):
        a_idx   = e.get("anchor_idx", 0)
        a_price = e.get("anchor_price", 0)
        cap     = e.get("cap_price", 0)
        q_idx   = e.get("qualify_idx")       # relative to anchor
        esc_idx = e.get("escape_idx")
        active  = e.get("active", False)
        broken  = e.get("broken_out", False)
        wiggle  = e.get("wiggle")
        alt     = e.get("alt")
        amp     = e.get("amp")
        turn    = e.get("turn")
        n_legs  = e.get("fine_leg_count", 0)

        base_end_idx = c.get("window_end", len(bars) - 1)

        # Duration: from anchor to qualify (if qualified), else anchor to now
        if q_idx is not None:
            q_abs = a_idx + q_idx
            n_base_bars = q_abs - a_idx
        else:
            n_base_bars = len(bars) - 1 - a_idx

        status = []
        if broken:
            status.append("BROKEN OUT")
        elif active and q_idx is not None:
            status.append("BASE ACTIVE")
        elif active:
            status.append("FORMING")
        else:
            status.append("INVALIDATED")

        print(f"  Base #{i+1}  [{', '.join(status)}]")
        print(f"    Floor   : ${a_price:.2f}  ({_bar_date(bars, a_idx)})")
        print(f"    Cap     : ${cap:.2f}  (range: {((cap-a_price)/a_price*100):.1f}%)")
        print(f"    Duration: ~{_duration_str(n_base_bars)} ({n_base_bars} bars)")
        print(f"    Legs    : {n_legs} fine-RDP segments")

        if wiggle is not None:
            print(f"    WIGGLE  : {wiggle:.3f}  (ALT={alt:.2f}  AMP={amp:.2f}  TURN={turn:.2f})")

        if q_idx is not None:
            q_abs = a_idx + q_idx
            print(f"    Qualified at bar {q_abs}  ({_bar_date(bars, q_abs)})")

        if esc_idx is not None:
            print(f"    Escape (breakout) at bar {esc_idx}  ({_bar_date(bars, esc_idx)})")
            if esc_idx < len(bars):
                esc_price = bars[esc_idx].close
                gain = (current_price - esc_price) / esc_price * 100
                print(f"    Price at escape: ${esc_price:.2f}  |  Since escape: {gain:+.1f}%")

        # Visual range bar
        box_pct = (cap - a_price) / a_price * 100
        price_vs_box = (current_price - a_price) / (cap - a_price) if (cap - a_price) > 0 else 0
        bar_len = 30
        filled = max(0, min(bar_len, int(price_vs_box * bar_len)))
        bar = "[" + "#" * filled + "-" * (bar_len - filled) + "]"
        if current_price > cap:
            bar = "[" + "#" * bar_len + "]  ABOVE CAP"
        elif current_price < a_price:
            bar = "[" + "-" * bar_len + "]  BELOW FLOOR"
        print(f"    Price in box: {bar}  {price_vs_box*100:.0f}% of box height")
        print()


def main():
    parser = argparse.ArgumentParser(description="Real-chart wiggle base test")
    parser.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS)
    parser.add_argument("--period",  default="15y", help="yfinance period (5y, 10y, 15y, max)")
    parser.add_argument("--interval", default="1wk", help="yfinance interval (1wk, 1d)")
    args = parser.parse_args()

    print(f"Real-chart wiggle base detection")
    print(f"Params: eps_fine=0.010  window_n=8  thresh=0.30  persist_m=2")
    print(f"Period: {args.period}  Interval: {args.interval}")
    print(f"Tickers: {', '.join(args.tickers)}")

    summary_rows = []

    for ticker in args.tickers:
        sys.stdout.write(f"  Fetching {ticker}... ")
        sys.stdout.flush()
        bars = _fetch(ticker, args.period, args.interval)
        if not bars:
            print("NO DATA")
            continue
        print(f"{len(bars)} bars")

        candidates = _run(bars, ticker)

        # Quick summary
        events = candidates[0].get("output_ports", {}).get("rdp_wiggle_base", {}).get("events", []) if candidates else []
        qualified = [e for e in events if e.get("qualify_idx") is not None]
        active    = [e for e in qualified if e.get("active")]
        broken    = [e for e in qualified if e.get("broken_out")]

        summary_rows.append({
            "ticker": ticker,
            "bars": len(bars),
            "events": len(events),
            "qualified": len(qualified),
            "active": len(active),
            "broken": len(broken),
            "candidates": candidates,
            "bar_data": bars,
        })

    # Detailed reports
    for row in summary_rows:
        report_ticker(row["ticker"], row["bar_data"], row["candidates"])

    # Summary table
    print("\n" + "="*64)
    print("SUMMARY")
    print("="*64)
    print(f"{'Ticker':<8} {'Bars':>5} {'Events':>7} {'Qualified':>10} {'Active':>7} {'Broken Out':>11}")
    print("-"*64)
    for row in summary_rows:
        print(
            f"{row['ticker']:<8} {row['bars']:>5} {row['events']:>7} "
            f"{row['qualified']:>10} {row['active']:>7} {row['broken']:>11}"
        )


if __name__ == "__main__":
    main()
