#!/usr/bin/env python3
from __future__ import annotations

"""
Valuation signal strategy study.

Strategy:
- Long names classified as undervalued
- Short names classified as overvalued
- Equal-weight all signals on each formation date
- Optional take-profit / stop-loss overlays

This is intentionally simpler than the validator engine. It is meant to answer:
- does the valuation signal behave like a tradable direction rule?
- what happens when we add simple exits?
"""

import argparse
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "backend" / "scripts"
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "fundamentals-pit.sqlite"
DEFAULT_OUTPUT_PATH = ROOT / "backend" / "data" / "research" / "valuation_signal_strategy_summary.json"

sys.path.insert(0, str(SCRIPTS_DIR))

import run_valuation_gap_accuracy_study as study  # noqa: E402


@dataclass
class StrategyTrade:
    symbol: str
    asof_date: str
    side: str
    entry_price: float
    exit_price: float
    exit_date: str
    exit_reason: str
    return_pct: float
    holding_bars: int
    valuation_state: str
    valuation_gap_pct: float
    fair_value_mid: float
    quality_grade: str


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _load_observations(
    conn: Any,
    args: argparse.Namespace,
) -> Dict[str, List[study.StudyObservation]]:
    symbols = study._load_symbols(args)
    by_date: Dict[str, List[study.StudyObservation]] = {}

    for symbol in symbols:
        bars = study._load_daily_bars(symbol)
        if len(bars) <= args.horizon + 24:
            continue
        observations = study._evaluate_symbol(
            conn,
            symbol,
            bars,
            rebalance_frequency=args.frequency,
            start_date=args.start_date,
            end_date=args.end_date,
            gap_threshold_pct=float(args.gap_threshold_pct),
            horizons=[int(args.horizon)],
            reliability_guard=True,
        )
        for obs in observations:
            if obs.valuation_state not in ("undervalued", "overvalued"):
                continue
            by_date.setdefault(obs.asof_date, []).append(obs)

    for asof_date, rows in by_date.items():
        rows.sort(key=lambda obs: abs(float(obs.valuation_gap_pct)), reverse=True)
    return by_date


def _find_bar_index(bars: Sequence[Dict[str, Any]], asof_date: str) -> int:
    for idx, bar in enumerate(bars):
        if str(bar.get("date") or "") == asof_date:
            return idx
    return -1


def _simulate_trade(
    obs: study.StudyObservation,
    bars: Sequence[Dict[str, Any]],
    *,
    horizon: int,
    take_profit_pct: Optional[float],
    stop_loss_pct: Optional[float],
) -> Optional[StrategyTrade]:
    entry_index = _find_bar_index(bars, obs.asof_date)
    if entry_index < 0 or entry_index + horizon >= len(bars):
        return None

    entry_price = float(obs.price)
    side = "long" if obs.valuation_state == "undervalued" else "short"
    stop_price: Optional[float] = None
    target_price: Optional[float] = None

    if take_profit_pct and take_profit_pct > 0:
        if side == "long":
            target_price = entry_price * (1.0 + take_profit_pct / 100.0)
        else:
            target_price = entry_price * (1.0 - take_profit_pct / 100.0)

    if stop_loss_pct and stop_loss_pct > 0:
        if side == "long":
            stop_price = entry_price * (1.0 - stop_loss_pct / 100.0)
        else:
            stop_price = entry_price * (1.0 + stop_loss_pct / 100.0)

    exit_price: Optional[float] = None
    exit_date = str(bars[entry_index + horizon].get("date") or obs.asof_date)
    exit_reason = "horizon_close"
    exit_index = entry_index + horizon

    for offset in range(1, horizon + 1):
        bar = bars[entry_index + offset]
        high = _safe_float(bar.get("high"))
        low = _safe_float(bar.get("low"))
        if high is None or low is None:
            continue

        if side == "long":
            stop_hit = stop_price is not None and low <= stop_price
            target_hit = target_price is not None and high >= target_price
        else:
            stop_hit = stop_price is not None and high >= stop_price
            target_hit = target_price is not None and low <= target_price

        # Conservative intrabar assumption: if both were reachable on the same day,
        # assume the adverse move hit first.
        if stop_hit:
            exit_price = float(stop_price)
            exit_reason = "stop_loss"
            exit_date = str(bar.get("date") or exit_date)
            exit_index = entry_index + offset
            break
        if target_hit:
            exit_price = float(target_price)
            exit_reason = "take_profit"
            exit_date = str(bar.get("date") or exit_date)
            exit_index = entry_index + offset
            break

    if exit_price is None:
        exit_price = float(_safe_float(bars[entry_index + horizon].get("close")) or entry_price)

    if side == "long":
        return_pct = ((exit_price - entry_price) / entry_price) * 100.0
    else:
        return_pct = ((entry_price - exit_price) / entry_price) * 100.0

    return StrategyTrade(
        symbol=obs.symbol,
        asof_date=obs.asof_date,
        side=side,
        entry_price=round(entry_price, 4),
        exit_price=round(exit_price, 4),
        exit_date=exit_date,
        exit_reason=exit_reason,
        return_pct=round(return_pct, 4),
        holding_bars=max(1, exit_index - entry_index),
        valuation_state=obs.valuation_state,
        valuation_gap_pct=round(float(obs.valuation_gap_pct), 4),
        fair_value_mid=round(float(obs.fair_value_mid), 4),
        quality_grade=str(obs.quality_grade),
    )


def _summarize_trade_list(trades: Sequence[StrategyTrade]) -> Dict[str, Any]:
    if not trades:
        return {
            "count": 0,
            "avg_return_pct": None,
            "median_return_pct": None,
            "win_rate": None,
            "best_return_pct": None,
            "worst_return_pct": None,
            "avg_holding_bars": None,
        }
    returns = [float(trade.return_pct) for trade in trades]
    holdings = [int(trade.holding_bars) for trade in trades]
    return {
        "count": len(trades),
        "avg_return_pct": round(statistics.mean(returns), 4),
        "median_return_pct": round(statistics.median(returns), 4),
        "win_rate": round(sum(1 for value in returns if value > 0) / len(returns), 4),
        "best_return_pct": round(max(returns), 4),
        "worst_return_pct": round(min(returns), 4),
        "avg_holding_bars": round(statistics.mean(holdings), 2),
    }


def _summarize_exit_reasons(trades: Sequence[StrategyTrade]) -> Dict[str, int]:
    out = {"take_profit": 0, "stop_loss": 0, "horizon_close": 0}
    for trade in trades:
        if trade.exit_reason not in out:
            out[trade.exit_reason] = 0
        out[trade.exit_reason] += 1
    return out


def _formation_summary(trades: Sequence[StrategyTrade]) -> Dict[str, Any]:
    formation_map: Dict[str, List[StrategyTrade]] = {}
    for trade in trades:
        formation_map.setdefault(trade.asof_date, []).append(trade)

    formation_returns: List[float] = []
    for asof_date, rows in formation_map.items():
        if not rows:
            continue
        formation_returns.append(sum(float(row.return_pct) for row in rows) / len(rows))

    summary = _summarize_trade_list(
        [
            StrategyTrade(
                symbol="FORMATION",
                asof_date="",
                side="formation",
                entry_price=0.0,
                exit_price=0.0,
                exit_date="",
                exit_reason="formation",
                return_pct=value,
                holding_bars=0,
                valuation_state="formation",
                valuation_gap_pct=0.0,
                fair_value_mid=0.0,
                quality_grade="n/a",
            )
            for value in formation_returns
        ]
    )
    summary["formation_count"] = len(formation_map)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the valuation signal strategy study.")
    parser.add_argument("--frequency", choices=["monthly", "quarterly"], default="monthly")
    parser.add_argument("--horizon", type=int, default=252, help="Holding horizon in trading bars")
    parser.add_argument("--gap-threshold-pct", type=float, default=20.0)
    parser.add_argument("--universe", default="clean_stocks")
    parser.add_argument("--symbols", default="")
    parser.add_argument("--cap-tier", choices=["micro", "small", "mid", "large"], default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--start-date", default="2020-01-01")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--take-profit-pct", type=float, default=0.0)
    parser.add_argument("--stop-loss-pct", type=float, default=0.0)
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT_PATH))
    args = parser.parse_args()

    conn = study.connect_pit(args.db_path)
    study.ensure_schema(conn)
    try:
        observations_by_date = _load_observations(conn, args)
    finally:
        conn.close()

    all_trades: List[StrategyTrade] = []
    by_side: Dict[str, List[StrategyTrade]] = {"long": [], "short": []}

    symbols = study._load_symbols(args)
    bars_cache = {symbol: study._load_daily_bars(symbol) for symbol in symbols}

    for asof_date in sorted(observations_by_date.keys()):
        for obs in observations_by_date[asof_date]:
            bars = bars_cache.get(obs.symbol) or []
            trade = _simulate_trade(
                obs,
                bars,
                horizon=int(args.horizon),
                take_profit_pct=float(args.take_profit_pct) if args.take_profit_pct > 0 else None,
                stop_loss_pct=float(args.stop_loss_pct) if args.stop_loss_pct > 0 else None,
            )
            if trade is None:
                continue
            all_trades.append(trade)
            by_side.setdefault(trade.side, []).append(trade)

    sample_trades = [
        {
            "symbol": trade.symbol,
            "asof_date": trade.asof_date,
            "side": trade.side,
            "return_pct": trade.return_pct,
            "exit_reason": trade.exit_reason,
            "holding_bars": trade.holding_bars,
            "valuation_gap_pct": trade.valuation_gap_pct,
            "quality_grade": trade.quality_grade,
        }
        for trade in all_trades[:25]
    ]

    summary = {
        "study": {
            "name": "valuation_signal_strategy",
            "universe": "clean_stocks",
            "frequency": args.frequency,
            "horizon_bars": int(args.horizon),
            "gap_threshold_pct": float(args.gap_threshold_pct),
            "cap_tier": args.cap_tier or None,
            "limit": int(args.limit) if args.limit > 0 else None,
            "start_date": args.start_date,
            "end_date": args.end_date or None,
            "take_profit_pct": float(args.take_profit_pct) if args.take_profit_pct > 0 else None,
            "stop_loss_pct": float(args.stop_loss_pct) if args.stop_loss_pct > 0 else None,
            "intrabar_exit_assumption": "conservative_stop_first_if_target_and_stop_both_touch_same_bar",
        },
        "results": {
            "overall": _summarize_trade_list(all_trades),
            "formations": _formation_summary(all_trades),
            "by_side": {
                "long": _summarize_trade_list(by_side.get("long", [])),
                "short": _summarize_trade_list(by_side.get("short", [])),
            },
            "exit_reasons": {
                "overall": _summarize_exit_reasons(all_trades),
                "long": _summarize_exit_reasons(by_side.get("long", [])),
                "short": _summarize_exit_reasons(by_side.get("short", [])),
            },
        },
        "sample_trades": sample_trades,
    }

    output_path = Path(args.output_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=True), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
