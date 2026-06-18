"""Speculative spike backtest for convergence Rule A candidates.

This intentionally treats the convergence + revenue re-acceleration setup as a
trade, not an investment. It tests whether hard exits could capture the spike
behavior that polluted the fundamental-long study.

Entry:
    next daily open after the monthly signal date

Exit:
    partial take-profit ladder, optional initial stop, trailing stop, max hold

Usage:
    python backend/scripts/run_speculative_spike_backtest.py
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_convergence_winner_attribution as attr  # noqa: E402
import run_reacceleration_dcf_backtest as reaccel  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"
DEFAULT_OBS = RESEARCH_DIR / "full_convergence_stack_obs.csv"
DEFAULT_OUTPUT = RESEARCH_DIR / "speculative_spike_backtest.json"
DEFAULT_CSV = RESEARCH_DIR / "speculative_spike_backtest_trades.csv"


@dataclass(frozen=True)
class ExitConfig:
    name: str
    max_hold_days: int
    profit_targets: Tuple[float, ...]
    target_fractions: Tuple[float, ...]
    trailing_stop_pct: float
    trailing_activate_pct: float
    initial_stop_pct: Optional[float]


def safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        v = float(value)
    except Exception:
        return None
    return v if math.isfinite(v) else None


def mean(values: Sequence[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def pct_return(exit_price: float, entry_price: float) -> float:
    return (exit_price / entry_price - 1.0) * 100.0


def parse_targets(raw: str) -> Tuple[float, ...]:
    targets = tuple(float(x.strip()) for x in raw.split(",") if x.strip())
    return tuple(sorted(targets))


def parse_fractions(raw: str, n: int) -> Tuple[float, ...]:
    if not raw.strip():
        return tuple([1.0 / n] * n)
    vals = tuple(float(x.strip()) for x in raw.split(",") if x.strip())
    if len(vals) != n:
        raise ValueError(f"target fractions count {len(vals)} does not match target count {n}")
    total = sum(vals)
    if total <= 0 or total > 1.0:
        raise ValueError("target fractions must sum to > 0 and <= 1.0")
    return vals


def load_spy() -> Optional[pd.DataFrame]:
    for symbol in ("SPY", "SPY.US"):
        df = attr.load_price_series(symbol)
        if df is not None and not df.empty:
            return df
    return None


def entry_slice(symbol: str, asof_date: str, max_hold_days: int) -> Optional[pd.DataFrame]:
    df = attr.load_price_series(symbol)
    if df is None or df.empty:
        return None
    asof = pd.Timestamp(asof_date)
    future = df[df.index > asof].head(max_hold_days + 1)
    if future.empty:
        return None
    return future


def spy_return(spy: Optional[pd.DataFrame], entry_date: pd.Timestamp, exit_date: pd.Timestamp) -> Optional[float]:
    if spy is None or spy.empty:
        return None
    w = spy[(spy.index >= entry_date) & (spy.index <= exit_date)]
    if w.empty:
        return None
    entry = safe_float(w.iloc[0].get("open")) or safe_float(w.iloc[0].get("close"))
    exit_px = safe_float(w.iloc[-1].get("close"))
    if entry in (None, 0) or exit_px is None:
        return None
    return pct_return(exit_px, entry)


def split_proxy(symbol: str, asof_date: str, extreme_ratio: float, gap_ratio: float) -> Tuple[bool, Dict[str, Any]]:
    df = attr.load_price_series(symbol)
    if df is None or df.empty:
        return False, {"split_proxy_reason": "missing_price_history"}
    asof = pd.Timestamp(asof_date)
    hist = df[df.index <= asof].tail(1008)
    if hist.empty:
        return False, {"split_proxy_reason": "missing_pre_entry_history"}
    close = hist["close"].dropna()
    entry_close = safe_float(close.iloc[-1]) if not close.empty else None
    max_close = safe_float(close.max()) if not close.empty else None
    max_to_entry = (max_close / entry_close) if entry_close not in (None, 0) and max_close is not None else None

    gap_hit = False
    max_gap = None
    if {"open", "close"}.issubset(hist.columns):
        prev_close = hist["close"].shift(1)
        gaps = (hist["open"] / prev_close).replace([math.inf, -math.inf], pd.NA).dropna()
        abs_gaps = gaps.apply(lambda x: max(float(x), 1.0 / float(x)) if float(x) > 0 else None).dropna()
        if not abs_gaps.empty:
            max_gap = safe_float(abs_gaps.max())
            gap_hit = bool(max_gap is not None and max_gap >= gap_ratio)

    extreme_hit = bool(max_to_entry is not None and max_to_entry >= extreme_ratio)
    reason = []
    if extreme_hit:
        reason.append(f"pre_entry_max_close/entry_close={max_to_entry:.1f}")
    if gap_hit:
        reason.append(f"max_abs_open_gap={max_gap:.1f}")
    return extreme_hit or gap_hit, {
        "pre_entry_max_close_to_entry": max_to_entry,
        "pre_entry_max_abs_open_gap": max_gap,
        "split_proxy_reason": "; ".join(reason),
    }


def liquidity_pass(row: Dict[str, Any], min_dollar_volume: float, min_entry_price: float) -> bool:
    entry_price = safe_float(row.get("entry_price"))
    dollar_volume = safe_float(row.get("dollar_volume_63d"))
    if entry_price is None or entry_price < min_entry_price:
        return False
    if dollar_volume is None or dollar_volume < min_dollar_volume:
        return False
    return True


def simulate_trade(symbol: str, asof_date: str, config: ExitConfig) -> Optional[Dict[str, Any]]:
    bars = entry_slice(symbol, asof_date, config.max_hold_days)
    if bars is None or bars.empty:
        return None

    first = bars.iloc[0]
    entry_price = safe_float(first.get("open")) or safe_float(first.get("close"))
    if entry_price in (None, 0):
        return None
    entry_date = bars.index[0]

    remaining = 1.0
    realized = 0.0
    targets_hit = 0
    high_water = entry_price
    exit_reason = "max_hold"
    exit_date = bars.index[-1]
    final_exit_price = safe_float(bars.iloc[-1].get("close")) or entry_price

    pending_targets = list(zip(config.profit_targets, config.target_fractions))
    for dt, bar in bars.iterrows():
        high = safe_float(bar.get("high")) or safe_float(bar.get("close")) or entry_price
        low = safe_float(bar.get("low")) or safe_float(bar.get("close")) or entry_price
        close = safe_float(bar.get("close")) or entry_price
        high_water = max(high_water, high)

        stop_price = None
        if config.initial_stop_pct is not None:
            stop_price = entry_price * (1.0 + config.initial_stop_pct / 100.0)
        runup_pct = pct_return(high_water, entry_price)
        if runup_pct >= config.trailing_activate_pct:
            trail_price = high_water * (1.0 - config.trailing_stop_pct / 100.0)
            stop_price = max(stop_price or 0.0, trail_price)

        # Conservative same-day ordering: if a stop and target are both touched,
        # assume the stop came first.
        if stop_price is not None and low <= stop_price and remaining > 0:
            realized += remaining * pct_return(stop_price, entry_price)
            final_exit_price = stop_price
            exit_reason = "stop" if runup_pct < config.trailing_activate_pct else "trailing_stop"
            exit_date = dt
            remaining = 0.0
            break

        next_pending = []
        for target_pct, fraction in pending_targets:
            target_price = entry_price * (1.0 + target_pct / 100.0)
            if high >= target_price and remaining > 0:
                sell_fraction = min(fraction, remaining)
                realized += sell_fraction * target_pct
                remaining -= sell_fraction
                targets_hit += 1
            else:
                next_pending.append((target_pct, fraction))
        pending_targets = next_pending

        if remaining <= 0:
            final_exit_price = close
            exit_reason = "all_targets_hit"
            exit_date = dt
            break

        final_exit_price = close
        exit_date = dt

    if remaining > 0:
        realized += remaining * pct_return(final_exit_price, entry_price)

    max_runup_pct = pct_return(high_water, entry_price)
    hold_days = int((exit_date - entry_date).days)
    return {
        "entry_date": str(entry_date.date()),
        "entry_price": entry_price,
        "exit_date": str(exit_date.date()),
        "exit_price": final_exit_price,
        "exit_reason": exit_reason,
        "return_pct": realized,
        "max_runup_pct": max_runup_pct,
        "targets_hit": targets_hit,
        "hold_days": hold_days,
    }


def summarize(trades: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    returns = [safe_float(t.get("return_pct")) for t in trades]
    returns = [r for r in returns if r is not None]
    spy = [safe_float(t.get("spy_return_pct")) for t in trades]
    spy = [s for s in spy if s is not None]
    excess = [
        (safe_float(t.get("return_pct")) or 0.0) - (safe_float(t.get("spy_return_pct")) or 0.0)
        for t in trades
        if safe_float(t.get("return_pct")) is not None and safe_float(t.get("spy_return_pct")) is not None
    ]
    reasons = Counter(str(t.get("exit_reason")) for t in trades)
    return {
        "n": len(trades),
        "avg_return_pct": round(mean(returns) or 0.0, 4) if returns else None,
        "median_return_pct": round(median(returns) or 0.0, 4) if returns else None,
        "win_rate": round(sum(1 for r in returns if r > 0) / len(returns), 4) if returns else None,
        "avg_spy_pct": round(mean(spy) or 0.0, 4) if spy else None,
        "avg_vs_spy_pct": round(mean(excess) or 0.0, 4) if excess else None,
        "median_vs_spy_pct": round(median(excess) or 0.0, 4) if excess else None,
        "spy_beat_rate": round(sum(1 for e in excess if e > 0) / len(excess), 4) if excess else None,
        "best_pct": round(max(returns), 4) if returns else None,
        "worst_pct": round(min(returns), 4) if returns else None,
        "avg_max_runup_pct": round(mean([safe_float(t.get("max_runup_pct")) or 0.0 for t in trades]) or 0.0, 4) if trades else None,
        "median_max_runup_pct": round(median([safe_float(t.get("max_runup_pct")) or 0.0 for t in trades]) or 0.0, 4) if trades else None,
        "exit_reasons": dict(reasons),
    }


def parse_ints(raw: str) -> Tuple[int, ...]:
    vals = tuple(int(x.strip()) for x in raw.split(",") if x.strip())
    if not vals:
        raise ValueError("at least one hold day is required")
    return tuple(sorted(set(vals)))


def build_candidates(args: argparse.Namespace, candidate_horizon: int) -> List[Dict[str, Any]]:
    horizon = int(candidate_horizon)
    enriched, _features = attr.enrich_rows(Path(args.obs_csv), horizon)
    rows = [
        r for r in enriched
        if reaccel.is_rule_a(r, args.revenue_ttm_growth_threshold, args.range_pos_max, args.min_eigen_z)
    ]
    out = []
    for row in rows:
        row = dict(row)
        flagged, meta = split_proxy(
            str(row["symbol"]),
            str(row["asof_date"]),
            args.split_extreme_ratio,
            args.split_gap_ratio,
        )
        row["split_proxy"] = flagged
        row.update(meta)
        row["liquidity_pass"] = liquidity_pass(row, args.min_dollar_volume, args.min_entry_price)
        out.append(row)
    return out


def run_backtest(args: argparse.Namespace) -> Dict[str, Any]:
    targets = parse_targets(args.profit_targets)
    fractions = parse_fractions(args.target_fractions, len(targets))
    hold_days_list = parse_ints(args.hold_days_list)
    configs = []
    for hold_days in hold_days_list:
        configs.extend([
            ExitConfig(
                name=f"ladder_trail_{hold_days}d",
                max_hold_days=hold_days,
                profit_targets=targets,
                target_fractions=fractions,
                trailing_stop_pct=args.trailing_stop_pct,
                trailing_activate_pct=args.trailing_activate_pct,
                initial_stop_pct=args.initial_stop_pct,
            ),
            ExitConfig(
                name=f"trail_only_{hold_days}d",
                max_hold_days=hold_days,
                profit_targets=tuple(),
                target_fractions=tuple(),
                trailing_stop_pct=args.trailing_stop_pct,
                trailing_activate_pct=args.trailing_activate_pct,
                initial_stop_pct=args.initial_stop_pct,
            ),
            ExitConfig(
                name=f"max_hold_only_{hold_days}d",
                max_hold_days=hold_days,
                profit_targets=tuple(),
                target_fractions=tuple(),
                trailing_stop_pct=10_000.0,
                trailing_activate_pct=10_000.0,
                initial_stop_pct=None,
            ),
        ])

    candidates = build_candidates(args, max(hold_days_list))
    spy = load_spy()
    trade_rows: List[Dict[str, Any]] = []
    results: Dict[str, Any] = {}

    for config in configs:
        config_trades = []
        for universe_name, universe_filter in (
            ("all", lambda r: True),
            ("liquid", lambda r: bool(r.get("liquidity_pass"))),
            ("liquid_no_split_proxy", lambda r: bool(r.get("liquidity_pass")) and not bool(r.get("split_proxy"))),
            ("split_proxy_only", lambda r: bool(r.get("split_proxy"))),
        ):
            trades = []
            for row in candidates:
                if not universe_filter(row):
                    continue
                sim = simulate_trade(str(row["symbol"]), str(row["asof_date"]), config)
                if sim is None:
                    continue
                spy_ret = spy_return(spy, pd.Timestamp(sim["entry_date"]), pd.Timestamp(sim["exit_date"]))
                trade = {
                    "config": config.name,
                    "universe": universe_name,
                    "symbol": row["symbol"],
                    "asof_date": row["asof_date"],
                    "score": row.get("score"),
                    "eigen_z": row.get("eigen_z"),
                    "range_pos_252d": row.get("range_pos_252d"),
                    "revenue_ttm_growth_pct": row.get("revenue_ttm_growth_pct"),
                    "entry_liquidity_dollar_volume_63d": row.get("dollar_volume_63d"),
                    "split_proxy": row.get("split_proxy"),
                    "split_proxy_reason": row.get("split_proxy_reason"),
                    "spy_return_pct": spy_ret,
                    **sim,
                }
                trades.append(trade)
                trade_rows.append(trade)
            results[f"{config.name}:{universe_name}"] = summarize(trades)
            config_trades.extend(trades)
        results[f"{config.name}:all_repeated_universes_check"] = {"rows_written": len(config_trades)}

    with Path(args.output_csv).open("w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "config", "universe", "symbol", "asof_date", "entry_date", "entry_price",
            "exit_date", "exit_price", "exit_reason", "return_pct", "spy_return_pct",
            "max_runup_pct", "targets_hit", "hold_days", "score", "eigen_z",
            "range_pos_252d", "revenue_ttm_growth_pct", "entry_liquidity_dollar_volume_63d",
            "split_proxy", "split_proxy_reason",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(trade_rows)

    return {
        "study": {
            "name": "speculative_spike_backtest",
            "script": "backend/scripts/run_speculative_spike_backtest.py",
            "rule_a": f"eigen_z >= {args.min_eigen_z} + range_pos_252d <= {args.range_pos_max} + revenue_ttm_growth_pct >= {args.revenue_ttm_growth_threshold}",
            "entry": "next daily open after signal date",
            "exit": {
                "hold_days_list": hold_days_list,
                "profit_targets_pct": targets,
                "target_fractions": fractions,
                "trailing_stop_pct": args.trailing_stop_pct,
                "trailing_activate_pct": args.trailing_activate_pct,
                "initial_stop_pct": args.initial_stop_pct,
            },
            "filters": {
                "min_dollar_volume": args.min_dollar_volume,
                "min_entry_price": args.min_entry_price,
                "split_extreme_ratio": args.split_extreme_ratio,
                "split_gap_ratio": args.split_gap_ratio,
            },
            "candidate_count": len(candidates),
            "notes": "Split exclusion uses a PIT adjusted-price distortion/gap proxy because no corporate-actions table is available locally.",
        },
        "results": results,
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obs-csv", default=str(DEFAULT_OBS))
    parser.add_argument("--range-pos-max", type=float, default=0.10)
    parser.add_argument("--revenue-ttm-growth-threshold", type=float, default=17.7)
    parser.add_argument("--min-eigen-z", type=float, default=2.0)
    parser.add_argument("--hold-days-list", default="21,63,126")
    parser.add_argument("--profit-targets", default="50,100,200")
    parser.add_argument("--target-fractions", default="0.33,0.33,0.34")
    parser.add_argument("--trailing-stop-pct", type=float, default=35.0)
    parser.add_argument("--trailing-activate-pct", type=float, default=50.0)
    parser.add_argument("--initial-stop-pct", type=float, default=-50.0)
    parser.add_argument("--min-dollar-volume", type=float, default=250_000.0)
    parser.add_argument("--min-entry-price", type=float, default=0.50)
    parser.add_argument("--split-extreme-ratio", type=float, default=100.0)
    parser.add_argument("--split-gap-ratio", type=float, default=8.0)
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output-csv", default=str(DEFAULT_CSV))
    args = parser.parse_args(argv)

    payload = run_backtest(args)
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("\n=== Speculative spike backtest ===")
    print(f"Candidates: {payload['study']['candidate_count']}")
    for key, res in payload["results"].items():
        if key.endswith("all_repeated_universes_check"):
            continue
        print(f"{key}: {res}")
    print(f"\nWrote {args.output_json}")
    print(f"Wrote {args.output_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
