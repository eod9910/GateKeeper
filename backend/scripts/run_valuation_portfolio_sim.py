"""Risk-managed portfolio simulation: real equity curve with position sizing + stops.

Unlike run_valuation_signal_strategy.py (which aggregates independent single-name trades),
this walks a daily calendar and runs an actual book:

- Start equity: $100,000
- Long-only: enter DCF-undervalued names (reliability guardrail applied point-in-time)
- Position sizing: fixed 3% of current equity per position (=> up to ~33 concurrent names)
- Stop-loss: configurable (checked intrabar on the daily low; conservative fill at the stop;
  0 = no stop)
- Max hold: 252 trading bars (~1 year), then close at the close
- Monthly formations fill open slots, ranked by most-undervalued gap first

The point-in-time candidate scan (~16 min over the full universe) is cached to disk so we can
sweep stop levels in seconds without rescanning. Benchmark: $100k buy-and-hold SPY.

Usage:
    python backend/scripts/run_valuation_portfolio_sim.py
    python backend/scripts/run_valuation_portfolio_sim.py --stop-pcts 20,30,40,50,0
    python backend/scripts/run_valuation_portfolio_sim.py --rebuild-cache
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_valuation_gap_accuracy_study as study  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"
DEFAULT_OUTPUT = RESEARCH_DIR / "valuation_portfolio_sim.json"
DEFAULT_CACHE = RESEARCH_DIR / "valuation_portfolio_candidates.json"
BENCHMARK = "SPY"


def _max_drawdown(curve: List[float]) -> float:
    peak = float("-inf")
    mdd = 0.0
    for v in curve:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (v - peak) / peak
            if dd < mdd:
                mdd = dd
    return mdd * 100.0


def _cagr(start_v: float, end_v: float, n_days: int) -> Optional[float]:
    if start_v <= 0 or n_days <= 0:
        return None
    years = n_days / 365.25
    if years <= 0:
        return None
    return ((end_v / start_v) ** (1.0 / years) - 1.0) * 100.0


def collect_candidates(
    conn: Any,
    symbols: List[str],
    start_date: str,
    gap_threshold: float,
    max_hold: int,
) -> Dict[str, List[List[Any]]]:
    by_date: Dict[str, List[List[Any]]] = {}
    for i, sym in enumerate(symbols):
        bars = study._load_daily_bars(sym)
        if len(bars) <= max_hold + 24:
            continue
        obs = study._evaluate_symbol(
            conn,
            sym,
            bars,
            rebalance_frequency="monthly",
            start_date=start_date,
            end_date=None,
            gap_threshold_pct=gap_threshold,
            horizons=[max_hold],
            reliability_guard=True,
        )
        for o in obs:
            if o.valuation_state != "undervalued":
                continue
            by_date.setdefault(o.asof_date, []).append([o.symbol, float(o.valuation_gap_pct), float(o.price)])
        if (i + 1) % 500 == 0:
            print(f"  ...scanned {i + 1}/{len(symbols)} symbols", flush=True)
    for d in by_date:
        by_date[d].sort(key=lambda x: x[1], reverse=True)
    return by_date


def load_or_build_candidates(args: argparse.Namespace) -> Dict[str, List[List[Any]]]:
    cache_path = Path(args.cache_path)
    meta_key = {
        "universe": args.universe,
        "symbols": args.symbols,
        "cap_tier": args.cap_tier,
        "limit": args.limit,
        "start_date": args.start_date,
        "gap_threshold_pct": args.gap_threshold_pct,
        "max_hold_bars": args.max_hold_bars,
    }
    if cache_path.exists() and not args.rebuild_cache:
        try:
            blob = json.loads(cache_path.read_text(encoding="utf-8"))
            if blob.get("meta") == meta_key:
                print(f"Loaded candidate cache: {cache_path.name}", flush=True)
                return {k: v for k, v in blob["by_date"].items()}
            print("Candidate cache present but parameters changed -> rescanning.", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"Candidate cache unreadable ({exc}) -> rescanning.", flush=True)

    conn = study.connect_pit(args.db_path)
    study.ensure_schema(conn)
    symbols = study._load_symbols(args)
    print(f"Scanning {len(symbols)} symbols for undervalued formations...", flush=True)
    by_date = collect_candidates(conn, symbols, args.start_date, args.gap_threshold_pct, args.max_hold_bars)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"meta": meta_key, "by_date": by_date}), encoding="utf-8")
    print(f"Wrote candidate cache: {cache_path.name}", flush=True)
    return by_date


def load_price_index(symbols: List[str]) -> Dict[str, Dict[str, Tuple[float, float]]]:
    idx: Dict[str, Dict[str, Tuple[float, float]]] = {}
    for sym in symbols:
        bars = study._load_daily_bars(sym)
        m: Dict[str, Tuple[float, float]] = {}
        for b in bars:
            close = study._safe_float(b.get("close"))
            if close is None:
                continue
            low = study._safe_float(b.get("low"))
            m[str(b["date"])] = (close, low if low is not None else close)
        if m:
            idx[sym] = m
    return idx


def simulate(
    by_date: Dict[str, List[List[Any]]],
    idx: Dict[str, Dict[str, Tuple[float, float]]],
    calendar: List[str],
    start_equity: float,
    pos_frac: float,
    stop_pct: float,
    max_hold_bars: int,
    max_positions: int,
) -> Dict[str, Any]:
    no_stop = stop_pct <= 0
    stop_frac = stop_pct / 100.0
    formation_dates = set(by_date.keys())

    cash = float(start_equity)
    positions: Dict[str, Dict[str, float]] = {}
    equity_curve: List[float] = []
    n_entries = n_stopped = n_horizon = 0
    trade_returns: List[float] = []

    def mark_equity() -> float:
        total = cash
        for p in positions.values():
            total += p["shares"] * p["last_price"]
        return total

    for date in calendar:
        for sym in list(positions.keys()):
            pos = positions[sym]
            pr = idx.get(sym, {}).get(date)
            if pr is None:
                continue
            close, low = pr
            pos["bars_held"] += 1
            if (not no_stop) and low <= pos["stop_price"]:
                cash += pos["shares"] * pos["stop_price"]
                trade_returns.append((pos["stop_price"] - pos["entry_price"]) / pos["entry_price"] * 100.0)
                n_stopped += 1
                del positions[sym]
                continue
            if pos["bars_held"] >= max_hold_bars:
                cash += pos["shares"] * close
                trade_returns.append((close - pos["entry_price"]) / pos["entry_price"] * 100.0)
                n_horizon += 1
                del positions[sym]
                continue
            pos["last_price"] = close

        if date in formation_dates and len(positions) < max_positions:
            equity_now = mark_equity()
            for sym, _gap, _px in by_date[date]:
                if len(positions) >= max_positions:
                    break
                if sym in positions:
                    continue
                pr = idx.get(sym, {}).get(date)
                if pr is None:
                    continue
                entry_price = pr[0]
                if entry_price <= 0:
                    continue
                notional = min(pos_frac * equity_now, cash)
                if notional <= 0:
                    break
                shares = notional / entry_price
                cash -= notional
                positions[sym] = {
                    "shares": shares,
                    "entry_price": entry_price,
                    "stop_price": entry_price * (1.0 - stop_frac),
                    "bars_held": 0.0,
                    "last_price": entry_price,
                }
                n_entries += 1

        equity_curve.append(mark_equity())

    final_equity = equity_curve[-1]
    n_days = len(calendar)
    return {
        "stop_pct": stop_pct if not no_stop else 0.0,
        "stop_label": "no stop" if no_stop else f"{stop_pct:g}%",
        "final_equity": round(final_equity, 2),
        "total_return_pct": round((final_equity / start_equity - 1.0) * 100.0, 2),
        "cagr_pct": round(_cagr(start_equity, final_equity, n_days) or 0.0, 2),
        "max_drawdown_pct": round(_max_drawdown(equity_curve), 2),
        "entries": n_entries,
        "stopped_out": n_stopped,
        "stopped_out_pct": round(n_stopped / n_entries * 100.0, 1) if n_entries else 0.0,
        "closed_at_horizon": n_horizon,
        "avg_trade_return_pct": round(sum(trade_returns) / len(trade_returns), 2) if trade_returns else None,
        "open_at_end": len(positions),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", default=str(study.DEFAULT_DB_PATH))
    parser.add_argument("--universe", default="clean_stocks")
    parser.add_argument("--symbols", default="")
    parser.add_argument("--cap-tier", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--start-equity", type=float, default=100_000.0)
    parser.add_argument("--position-pct", type=float, default=3.0)
    parser.add_argument("--stop-pcts", default="20,30,40,50,0", help="comma list; 0 = no stop")
    parser.add_argument("--max-hold-bars", type=int, default=252)
    parser.add_argument("--gap-threshold-pct", type=float, default=20.0)
    parser.add_argument("--start-date", default="2020-01-01")
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE))
    parser.add_argument("--rebuild-cache", action="store_true")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args(argv)

    pos_frac = args.position_pct / 100.0
    max_positions = max(1, int(round(1.0 / pos_frac)))
    stop_levels = [float(s.strip()) for s in args.stop_pcts.split(",") if s.strip() != ""]

    by_date = load_or_build_candidates(args)
    used = sorted({row[0] for rows in by_date.values() for row in rows})
    print(f"{sum(len(v) for v in by_date.values())} undervalued obs / {len(by_date)} formations / {len(used)} names", flush=True)

    print("Loading price series for held + benchmark names...", flush=True)
    idx = load_price_index(used + [BENCHMARK])
    if BENCHMARK not in idx:
        print(f"ERROR: no benchmark bars for {BENCHMARK}")
        return 1

    first_formation = min(by_date.keys())
    calendar = sorted(d for d in idx[BENCHMARK].keys() if d >= first_formation)
    if not calendar:
        print("ERROR: empty calendar")
        return 1
    n_days = len(calendar)

    variants = [
        simulate(by_date, idx, calendar, args.start_equity, pos_frac, stop, args.max_hold_bars, max_positions)
        for stop in stop_levels
    ]

    spy_first = idx[BENCHMARK][calendar[0]][0]
    spy_last = idx[BENCHMARK][calendar[-1]][0]
    spy_shares = args.start_equity / spy_first
    spy_curve = [spy_shares * idx[BENCHMARK][d][0] for d in calendar if d in idx[BENCHMARK]]
    spy_final = spy_shares * spy_last
    benchmark = {
        "final_equity": round(spy_final, 2),
        "total_return_pct": round((spy_final / args.start_equity - 1.0) * 100.0, 2),
        "cagr_pct": round(_cagr(args.start_equity, spy_final, n_days) or 0.0, 2),
        "max_drawdown_pct": round(_max_drawdown(spy_curve), 2),
    }

    result = {
        "study": {
            "name": "valuation_portfolio_sim",
            "universe": args.universe,
            "start_equity": args.start_equity,
            "position_pct": args.position_pct,
            "max_positions": max_positions,
            "max_hold_bars": args.max_hold_bars,
            "gap_threshold_pct": args.gap_threshold_pct,
            "long_only": True,
            "period": {"start": calendar[0], "end": calendar[-1], "trading_days": n_days},
            "costs": "transaction costs / slippage NOT modeled",
        },
        "variants": variants,
        "benchmark_spy_buyhold": benchmark,
    }
    Path(args.output_json).write_text(json.dumps(result, indent=2), encoding="utf-8")

    # readable comparison table
    print("\n=== Risk-managed valuation portfolio vs SPY buy & hold ===")
    print(f"Period {calendar[0]} -> {calendar[-1]}  (${args.start_equity:,.0f} start, {args.position_pct:g}% positions)\n")
    hdr = f"{'stop':>8} | {'final $':>12} | {'total %':>8} | {'CAGR %':>7} | {'maxDD %':>8} | {'stopped %':>9}"
    print(hdr)
    print("-" * len(hdr))
    for v in variants:
        print(f"{v['stop_label']:>8} | {v['final_equity']:>12,.0f} | {v['total_return_pct']:>8.1f} | {v['cagr_pct']:>7.2f} | {v['max_drawdown_pct']:>8.1f} | {v['stopped_out_pct']:>9.1f}")
    print(f"{'SPY B&H':>8} | {benchmark['final_equity']:>12,.0f} | {benchmark['total_return_pct']:>8.1f} | {benchmark['cagr_pct']:>7.2f} | {benchmark['max_drawdown_pct']:>8.1f} | {'-':>9}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
