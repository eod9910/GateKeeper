"""Analyze market regime at entry time for each trade instance."""
import json
import os
import glob
from datetime import datetime
from collections import Counter

import yfinance as yf

TRADE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "trade-instances", "rpt_76d99f0a")


def load_trades():
    trades = []
    for f in glob.glob(os.path.join(TRADE_DIR, "*.json")):
        with open(f) as fh:
            trades.append(json.load(fh))
    return trades


def get_regime(df, entry_date_str):
    entry_date = datetime.strptime(entry_date_str[:10], "%Y-%m-%d")
    mask = df.index <= entry_date
    if mask.sum() == 0:
        return "unknown", {}

    idx = mask.sum() - 1
    if idx < 200:
        return "insufficient_data", {}

    closes = df["Close"].values.flatten()
    close = float(closes[idx])
    ma50 = float(closes[max(0, idx - 49) : idx + 1].mean())
    ma200 = float(closes[max(0, idx - 199) : idx + 1].mean())
    ma20 = float(closes[max(0, idx - 19) : idx + 1].mean())

    if close > ma200 and close > ma50:
        regime = "expansion" if ma50 > ma200 else "recovery"
    elif close > ma200 and close < ma50:
        regime = "pullback"
    elif close < ma200 and close > ma50:
        regime = "bear_rally"
    elif close < ma200 and close < ma50:
        regime = "distribution" if ma50 < ma200 else "decline"
    else:
        regime = "flat"

    return regime, {
        "close": round(close, 2),
        "ma20": round(ma20, 2),
        "ma50": round(ma50, 2),
        "ma200": round(ma200, 2),
        "pct_above_200ma": round((close / ma200 - 1) * 100, 1),
    }


def main():
    trades = load_trades()
    symbols = sorted(set(t["symbol"] for t in trades))
    print(f"Downloading data for {len(symbols)} symbols...")

    sym_data = {}
    for sym in symbols:
        try:
            df = yf.download(sym, start="2018-01-01", end="2026-01-01", interval="1d", progress=False)
            if len(df) > 0:
                sym_data[sym] = df
        except Exception:
            pass

    print(f"Got data for {len(sym_data)} symbols\n")

    results = []
    for t in trades:
        sym = t["symbol"]
        if sym not in sym_data:
            regime, details = "no_data", {}
        else:
            regime, details = get_regime(sym_data[sym], t["entry_time"])

        results.append({
            "symbol": sym,
            "entry_time": t["entry_time"],
            "R_multiple": t["R_multiple"],
            "exit_reason": t["exit_reason"],
            "hold_bars": t["exit_bar_index"] - t["entry_bar_index"],
            "regime": regime,
            **details,
        })

    # === REGIME BREAKDOWN ===
    print("=" * 80)
    print("REGIME BREAKDOWN (ALL TRADES)")
    print("=" * 80)
    regime_all = Counter(r["regime"] for r in results)
    for regime, cnt in regime_all.most_common():
        w = sum(1 for r in results if r["regime"] == regime and r["R_multiple"] > 0)
        l = cnt - w
        wr = 100 * w / cnt if cnt > 0 else 0
        avg_r = sum(r["R_multiple"] for r in results if r["regime"] == regime) / cnt
        print(f"  {regime:20s}  trades: {cnt:3d}  wins: {w:3d}  losses: {l:3d}  win_rate: {wr:.0f}%  avg_R: {avg_r:+.3f}")

    # === QUICK STOPS BY REGIME ===
    print()
    print("=" * 80)
    print("QUICK STOPS (<=3 bars) BY REGIME")
    print("=" * 80)
    quick_stops = [r for r in results if r["hold_bars"] <= 3 and r["R_multiple"] <= 0]
    print(f"Total quick stops: {len(quick_stops)}")
    regime_quick = Counter(r["regime"] for r in quick_stops)
    for regime, cnt in regime_quick.most_common():
        print(f"  {regime:20s}  quick_stops: {cnt}")

    # === DISTANCE FROM 200MA ===
    print()
    print("=" * 80)
    print("DISTANCE FROM 200MA AT ENTRY")
    print("=" * 80)
    with_ma = [r for r in results if "pct_above_200ma" in r]
    if with_ma:
        w_above = [r for r in with_ma if r["R_multiple"] > 0]
        l_above = [r for r in with_ma if r["R_multiple"] <= 0]
        if w_above:
            avg_w = sum(r["pct_above_200ma"] for r in w_above) / len(w_above)
            print(f"Winners avg distance from 200MA: {avg_w:.1f}%")
        if l_above:
            avg_l = sum(r["pct_above_200ma"] for r in l_above) / len(l_above)
            print(f"Losers  avg distance from 200MA: {avg_l:.1f}%")

        above = [r for r in with_ma if r["pct_above_200ma"] > 0]
        below = [r for r in with_ma if r["pct_above_200ma"] <= 0]

        if above:
            a_w = sum(1 for r in above if r["R_multiple"] > 0)
            a_avg = sum(r["R_multiple"] for r in above) / len(above)
            print(f"Above 200MA: {len(above)} trades, {a_w} wins ({100*a_w/len(above):.0f}% WR), avg R: {a_avg:+.3f}")
        if below:
            b_w = sum(1 for r in below if r["R_multiple"] > 0)
            b_avg = sum(r["R_multiple"] for r in below) / len(below)
            print(f"Below 200MA: {len(below)} trades, {b_w} wins ({100*b_w/len(below):.0f}% WR), avg R: {b_avg:+.3f}")

    # === DETAILED LOSER LIST WITH REGIME ===
    print()
    print("=" * 80)
    print("ALL LOSING TRADES WITH REGIME CONTEXT")
    print("=" * 80)
    losers = sorted([r for r in results if r["R_multiple"] <= 0], key=lambda r: r["hold_bars"])
    for r in losers:
        pct = r.get("pct_above_200ma", "?")
        pct_str = f"{pct:+.1f}%" if isinstance(pct, (int, float)) else pct
        print(
            f"  {r['symbol']:6s}  {r['entry_time'][:10]}  "
            f"hold: {r['hold_bars']:2d}d  R: {r['R_multiple']:+.2f}  "
            f"regime: {r['regime']:15s}  vs200MA: {pct_str}"
        )


if __name__ == "__main__":
    main()
