#!/usr/bin/env python3
"""
analyze_regime_performance.py
------------------------------
Tags each trade in the most recent validation report with the S&P 500
market regime at the time of entry, then breaks down expectancy by regime.

Regime classification (based on SPY 200-day SMA + rate-of-change):
  - Accumulation : SPY below 200MA but momentum turning up (ROC 20 > -2%)
  - Expansion    : SPY above 200MA and trending up (ROC 20 > 0%)
  - Distribution : SPY above 200MA but momentum fading (ROC 20 <= 0%)
  - Markdown     : SPY below 200MA and falling (ROC 20 <= -2%)

Usage:
  py backend/scripts/analyze_regime_performance.py [report_id]
  py backend/scripts/analyze_regime_performance.py --all  (last 5 reports)
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
TRADE_DIR = os.path.join(DATA_DIR, "trade-instances")
REPORTS_DIR = os.path.join(DATA_DIR, "validation-reports")


def get_spy_data() -> list[dict]:
    """Fetch SPY daily OHLCV — try local cache first, then yfinance."""
    cache_path = os.path.join(DATA_DIR, "quote-cache", "SPY_1d.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            bars = raw if isinstance(raw, list) else raw.get("bars") or raw.get("data") or []
            if len(bars) > 200:
                return bars
        except Exception:
            pass

    print("  Fetching SPY daily data from yfinance...")
    import yfinance as yf
    spy = yf.download("SPY", start="2015-01-01", progress=False, auto_adjust=True)
    bars = []
    for ts, row in spy.iterrows():
        bars.append({
            "time": ts.strftime("%Y-%m-%d"),
            "open": float(row["Open"].iloc[0]) if hasattr(row["Open"], "iloc") else float(row["Open"]),
            "high": float(row["High"].iloc[0]) if hasattr(row["High"], "iloc") else float(row["High"]),
            "low": float(row["Low"].iloc[0]) if hasattr(row["Low"], "iloc") else float(row["Low"]),
            "close": float(row["Close"].iloc[0]) if hasattr(row["Close"], "iloc") else float(row["Close"]),
        })
    return bars


def build_regime_map(bars: list[dict]) -> dict[str, str]:
    """Returns {date_str: regime_label} for every bar."""
    closes = [b["close"] for b in bars]
    dates = [b["time"][:10] for b in bars]
    n = len(closes)
    ma200 = [None] * n
    roc20 = [None] * n

    for i in range(199, n):
        ma200[i] = sum(closes[i-199:i+1]) / 200
    for i in range(20, n):
        if closes[i-20] > 0:
            roc20[i] = (closes[i] - closes[i-20]) / closes[i-20] * 100

    regime_map: dict[str, str] = {}
    for i, date in enumerate(dates):
        ma = ma200[i]
        roc = roc20[i]
        if ma is None or roc is None:
            regime_map[date] = "unknown"
            continue
        price = closes[i]
        above_ma = price > ma
        if above_ma and roc > 0:
            regime_map[date] = "expansion"
        elif above_ma and roc <= 0:
            regime_map[date] = "distribution"
        elif not above_ma and roc > -2:
            regime_map[date] = "accumulation"
        else:
            regime_map[date] = "markdown"

    return regime_map


def load_trades(report_id: str) -> list[dict]:
    """Load all trade instance JSON files for a report."""
    folder = os.path.join(TRADE_DIR, report_id)
    if not os.path.isdir(folder):
        return []
    trades = []
    for fname in os.listdir(folder):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, fname), "r", encoding="utf-8") as f:
                trades.append(json.load(f))
        except Exception:
            pass
    return trades


def analyze_report(report_id: str, regime_map: dict[str, str]) -> None:
    trades = load_trades(report_id)
    if not trades:
        print(f"  No trades found for {report_id}")
        return

    # Load report meta for strategy name
    strategy_name = report_id
    report_path = os.path.join(REPORTS_DIR, f"{report_id}.json")
    if os.path.exists(report_path):
        try:
            with open(report_path, "r", encoding="utf-8") as f:
                rpt = json.load(f)
            strategy_name = rpt.get("strategy_version_id") or report_id
        except Exception:
            pass

    # Tag each trade with regime
    regime_trades: dict[str, list[float]] = defaultdict(list)
    untagged = 0
    sorted_dates = sorted(regime_map.keys())

    def nearest_regime(date_str: str) -> str:
        """Find regime for date or nearest prior trading day."""
        if date_str in regime_map:
            return regime_map[date_str]
        # Walk back up to 7 days to find nearest prior trading day
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            for delta in range(1, 8):
                prior = (dt - timedelta(days=delta)).strftime("%Y-%m-%d")
                if prior in regime_map:
                    return regime_map[prior]
        except Exception:
            pass
        return "unknown"

    for t in trades:
        entry_time = str(t.get("entry_time") or "")[:10]
        r_mult = (t.get("R_multiple") or t.get("r_multiple") or
                  t.get("r_mult") or t.get("pnl_r"))
        if r_mult is None:
            continue
        regime = nearest_regime(entry_time)
        if regime == "unknown":
            untagged += 1
        regime_trades[regime].append(float(r_mult))

    order = ["expansion", "distribution", "accumulation", "markdown", "unknown"]
    print(f"\n{'='*60}")
    print(f"  Strategy: {strategy_name}")
    print(f"  Report:   {report_id}")
    print(f"  Total trades: {len(trades)}  (untagged: {untagged})")
    print(f"{'='*60}")
    print(f"  {'Regime':<16} {'Trades':>6}  {'Expectancy':>10}  {'Win%':>6}  {'Avg Win':>8}  {'Avg Loss':>9}")
    print(f"  {'-'*60}")

    for regime in order:
        rs = regime_trades.get(regime, [])
        if not rs:
            continue
        wins = [r for r in rs if r > 0]
        losses = [r for r in rs if r <= 0]
        exp = sum(rs) / len(rs)
        win_pct = len(wins) / len(rs) * 100
        avg_win = sum(wins) / len(wins) if wins else 0
        avg_loss = sum(losses) / len(losses) if losses else 0
        flag = " << BEST" if exp == max(
            sum(v)/len(v) for v in regime_trades.values() if v
        ) else ""
        print(f"  {regime:<16} {len(rs):>6}  {exp:>+9.2f}R  {win_pct:>5.1f}%  {avg_win:>+7.2f}R  {avg_loss:>+8.2f}R{flag}")

    print()


def find_recent_reports(n: int = 5) -> list[str]:
    """Return the n most recently modified report IDs."""
    if not os.path.isdir(REPORTS_DIR):
        return []
    files = [(os.path.getmtime(os.path.join(REPORTS_DIR, f)), f.replace(".json", ""))
             for f in os.listdir(REPORTS_DIR) if f.endswith(".json")]
    files.sort(reverse=True)
    return [f[1] for f in files[:n]]


def main() -> None:
    print("=" * 60)
    print(" S&P 500 Regime Performance Analyzer")
    print("=" * 60)

    args = sys.argv[1:]
    run_all = "--all" in args
    report_ids = [a for a in args if not a.startswith("--")]

    if not report_ids and not run_all:
        # Default: most recent report
        report_ids = find_recent_reports(1)
        if not report_ids:
            print("No reports found.")
            sys.exit(1)
        print(f"  Using most recent report: {report_ids[0]}")
    elif run_all:
        report_ids = find_recent_reports(5)
        print(f"  Analyzing {len(report_ids)} most recent reports")

    print("\n  Loading SPY data and computing regimes...")
    spy_bars = get_spy_data()
    regime_map = build_regime_map(spy_bars)
    print(f"  Regime map built: {len(regime_map)} days")

    for rid in report_ids:
        analyze_report(rid, regime_map)

    print("Done.")


if __name__ == "__main__":
    main()
