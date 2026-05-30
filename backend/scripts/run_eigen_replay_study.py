#!/usr/bin/env python3
"""
Historical eigen/PCA perturbation replay study.

This is a point-in-time, price-only replay harness. For each as-of date it:
  1. Uses only OHLCV data available on or before that date.
  2. Fits a PCA model to trailing clean-universe returns.
  3. Ranks residual movers whose latest return is poorly explained by factors.
  4. Walks forward and measures future returns.

It intentionally does not use current valuation, options, social, or narrative
data. Those overlays belong in later phases after their point-in-time rules are
made explicit.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
PRICE_DIR = DATA_DIR / "universe"
RESEARCH_DIR = DATA_DIR / "research"


@dataclass
class SymbolMeta:
    symbol: str
    name: str = ""
    cap_tier: Optional[str] = None
    market_cap: Optional[float] = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_symbol(symbol: str) -> str:
    return str(symbol).upper().strip().replace("/", "_").replace("=", "_").replace("-", "_")


def parse_int_list(value: str) -> List[int]:
    out: List[int] = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        out.append(int(part))
    return sorted(set(out))


def parse_float_list(value: str) -> List[float]:
    out: List[float] = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        out.append(float(part))
    return sorted(set(out))


def load_clean_universe(path: Path) -> List[SymbolMeta]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload.get("stocks") if isinstance(payload, dict) else payload
    symbols: List[SymbolMeta] = []
    for row in rows or []:
        symbol = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
        if not symbol:
            continue
        symbols.append(
            SymbolMeta(
                symbol=symbol,
                name=str(row.get("name") or ""),
                cap_tier=row.get("market_cap_bucket") or row.get("cap_tier"),
                market_cap=float(row["market_cap"]) if row.get("market_cap") is not None else None,
            )
        )
    symbols.sort(key=lambda item: item.market_cap or 0.0, reverse=True)
    return symbols


def load_symbol_ohlcv(symbol: str, price_dir: Path, min_rows: int) -> Optional[pd.DataFrame]:
    path = price_dir / f"{safe_symbol(symbol)}_1d.csv"
    if not path.exists():
        return None
    try:
        frame = pd.read_csv(path, usecols=["date", "close", "volume"])
    except Exception:
        return None
    if len(frame) < min_rows:
        return None
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce")
    frame = frame.dropna(subset=["date", "close"]).drop_duplicates("date", keep="last")
    frame = frame.sort_values("date")
    if len(frame) < min_rows:
        return None
    return frame.set_index("date")[["close", "volume"]]


def load_ohlcv_panel(
    symbols: Sequence[str],
    *,
    price_dir: Path,
    min_rows: int,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, int]]:
    closes: List[pd.Series] = []
    volumes: List[pd.Series] = []
    stats = {"requested": len(symbols), "loaded": 0, "missing": 0, "too_short_or_invalid": 0}

    for symbol in symbols:
        frame = load_symbol_ohlcv(symbol, price_dir, min_rows)
        if frame is None:
            path = price_dir / f"{safe_symbol(symbol)}_1d.csv"
            if path.exists():
                stats["too_short_or_invalid"] += 1
            else:
                stats["missing"] += 1
            continue
        closes.append(frame["close"].rename(symbol))
        volumes.append(frame["volume"].rename(symbol))
        stats["loaded"] += 1

    if not closes:
        raise RuntimeError(f"No usable OHLCV CSVs found in {price_dir}")

    close_df = pd.concat(closes, axis=1).sort_index()
    volume_df = pd.concat(volumes, axis=1).sort_index()
    return close_df, volume_df, stats


def replay_dates(
    close_df: pd.DataFrame,
    *,
    start: str,
    end: str,
    frequency: str,
) -> List[pd.Timestamp]:
    dates = pd.DatetimeIndex(close_df.index.unique()).sort_values()
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    dates = dates[(dates >= start_ts) & (dates <= end_ts)]
    if dates.empty:
        raise RuntimeError(f"No market dates found between {start} and {end}")

    freq = frequency.lower().strip()
    if freq in {"daily", "day", "1d"}:
        return [pd.Timestamp(d) for d in dates]
    if freq in {"weekly", "week", "1w"}:
        grouped = pd.Series(dates, index=dates).groupby(dates.to_period("W-FRI")).max()
        return [pd.Timestamp(d) for d in grouped.tolist()]
    if freq in {"monthly", "month", "1m"}:
        grouped = pd.Series(dates, index=dates).groupby(dates.to_period("M")).max()
        return [pd.Timestamp(d) for d in grouped.tolist()]
    raise ValueError(f"Unsupported rebalance frequency: {frequency}")


def eligible_symbols(
    close_df: pd.DataFrame,
    volume_df: pd.DataFrame,
    as_of: pd.Timestamp,
    *,
    lookback: int,
    min_coverage: float,
    min_price: float,
    min_dollar_volume: float,
) -> List[str]:
    close_window = close_df.loc[:as_of].tail(lookback + 1)
    volume_window = volume_df.loc[:as_of].tail(max(20, min(lookback, 60)))
    if len(close_window) < lookback + 1:
        return []

    coverage_floor = max(20, int(math.ceil((lookback + 1) * min_coverage)))
    counts = close_window.notna().sum(axis=0)
    latest_close = close_window.iloc[-1]
    avg_dollar_volume = (close_window.reindex(volume_window.index).ffill() * volume_window).tail(20).mean(axis=0)

    mask = (
        (counts >= coverage_floor)
        & (latest_close >= min_price)
        & (avg_dollar_volume >= min_dollar_volume)
    )
    return [str(symbol) for symbol in mask.index[mask]]


def trailing_returns(close_df: pd.DataFrame, as_of: pd.Timestamp, symbols: Sequence[str], lookback: int) -> pd.DataFrame:
    closes = close_df.loc[:as_of, list(symbols)].tail(lookback + 1)
    returns = closes.pct_change(fill_method=None).tail(lookback)
    returns = returns.dropna(axis=1, how="any")
    returns = returns.dropna(axis=0, how="all").fillna(0.0)
    return returns


def run_pca_residuals(returns: pd.DataFrame, n_factors: int) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    if returns.shape[0] < 30 or returns.shape[1] < 20:
        raise RuntimeError(f"Need at least 30 days and 20 symbols; got {returns.shape}")

    means = returns.mean(axis=0)
    stdevs = returns.std(axis=0).replace(0, np.nan)
    usable_cols = stdevs.dropna().index
    r = returns[usable_cols]
    means = means[usable_cols]
    stdevs = stdevs[usable_cols]

    x = ((r - means) / stdevs).to_numpy(dtype=float)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)

    u, singular_values, vt = np.linalg.svd(x, full_matrices=False)
    k = max(1, min(n_factors, len(singular_values), x.shape[0] - 1, x.shape[1] - 1))
    reconstructed = (u[:, :k] * singular_values[:k]) @ vt[:k, :]
    residuals = x - reconstructed
    residual_df = pd.DataFrame(residuals, index=r.index, columns=r.columns)

    latest_resid = residual_df.iloc[-1]
    residual_sigma = residual_df.std(axis=0).replace(0, np.nan)
    residual_z_df = residual_df.divide(residual_sigma, axis=1)
    residual_z = latest_resid / residual_sigma
    prev_residual_z_1d = residual_z_df.iloc[-2] if len(residual_z_df) >= 2 else pd.Series(index=r.columns, dtype=float)
    prev_residual_z_3d_mean = (
        residual_z_df.iloc[-4:-1].mean(axis=0)
        if len(residual_z_df) >= 4
        else pd.Series(index=r.columns, dtype=float)
    )
    residual_z_change_1d = residual_z - prev_residual_z_1d
    residual_z_slope_3d = residual_z - prev_residual_z_3d_mean
    actual_return = r.iloc[-1]
    factor_expected_std = pd.Series(reconstructed[-1, :], index=r.columns)
    factor_expected_return = factor_expected_std * stdevs + means

    total_variance = float(np.sum(singular_values ** 2))
    explained = [
        float((s ** 2) / total_variance) if total_variance > 0 else 0.0
        for s in singular_values[:k]
    ]

    ranked = pd.DataFrame(
        {
            "symbol": r.columns,
            "residual_z": residual_z.reindex(r.columns).to_numpy(dtype=float),
            "prev_residual_z_1d": prev_residual_z_1d.reindex(r.columns).to_numpy(dtype=float),
            "residual_z_change_1d": residual_z_change_1d.reindex(r.columns).to_numpy(dtype=float),
            "residual_z_slope_3d": residual_z_slope_3d.reindex(r.columns).to_numpy(dtype=float),
            "actual_return_pct": (actual_return.reindex(r.columns) * 100.0).to_numpy(dtype=float),
            "factor_expected_return_pct": (factor_expected_return.reindex(r.columns) * 100.0).to_numpy(dtype=float),
            "unexplained_return_pct": ((actual_return - factor_expected_return).reindex(r.columns) * 100.0).to_numpy(dtype=float),
        }
    )
    ranked["abs_residual_z"] = ranked["residual_z"].abs()
    ranked = ranked.replace([np.inf, -np.inf], np.nan).dropna(subset=["residual_z"])
    ranked = ranked.sort_values("abs_residual_z", ascending=False)

    meta = {
        "factors_used": k,
        "explained_variance_by_factor": explained,
        "explained_variance_total": float(sum(explained)),
        "top_eigenvalue_share": explained[0] if explained else 0.0,
        "symbols_in_model": int(len(r.columns)),
        "days_in_model": int(len(r.index)),
        "return_start_date": str(r.index.min().date()),
        "return_end_date": str(r.index.max().date()),
    }
    return ranked, meta


def forward_return_pct(
    close_df: pd.DataFrame,
    symbol: str,
    as_of: pd.Timestamp,
    horizon: int,
    *,
    entry_lag_days: int = 0,
) -> Optional[float]:
    series = close_df[symbol].dropna()
    after_or_at = series.index[series.index >= as_of]
    if len(after_or_at) == 0:
        return None
    entry_date = after_or_at[0]
    loc = series.index.get_loc(entry_date)
    if isinstance(loc, slice) or isinstance(loc, np.ndarray):
        return None
    entry_loc = int(loc) + max(0, int(entry_lag_days))
    future_loc = entry_loc + int(horizon)
    if future_loc >= len(series):
        return None
    entry = float(series.iloc[entry_loc])
    future = float(series.iloc[future_loc])
    if entry <= 0 or not math.isfinite(entry) or not math.isfinite(future):
        return None
    return ((future - entry) / entry) * 100.0


def signal_volume_ratio(volume_df: pd.DataFrame, symbol: str, as_of: pd.Timestamp, lookback: int = 20) -> Optional[float]:
    if symbol not in volume_df.columns:
        return None
    series = volume_df.loc[:as_of, symbol].dropna()
    if len(series) < lookback + 1:
        return None
    latest = float(series.iloc[-1])
    baseline = float(series.iloc[-(lookback + 1):-1].mean())
    if baseline <= 0 or not math.isfinite(latest) or not math.isfinite(baseline):
        return None
    return latest / baseline


def classify_signal_phase(
    row: Dict[str, Any],
    volume_ratio: Optional[float],
    args: argparse.Namespace,
) -> str:
    actual = abs(float(row.get("actual_return_pct") or 0.0))
    unexplained = abs(float(row.get("unexplained_return_pct") or 0.0))
    abs_z = abs(float(row.get("abs_residual_z") or 0.0))

    if (
        actual >= args.shock_return_pct
        or unexplained >= args.shock_unexplained_pct
        or abs_z >= args.shock_abs_z
    ):
        return "post_event_shock"

    if volume_ratio is not None and volume_ratio >= args.volume_surge_ratio:
        return "pressure_build_volume_confirmed"

    return "pressure_build_quiet"


def classify_signal_setup(row: Dict[str, Any], phase: str, args: argparse.Namespace) -> str:
    residual_z = float(row.get("residual_z") or 0.0)
    actual = abs(float(row.get("actual_return_pct") or 0.0))
    unexplained = abs(float(row.get("unexplained_return_pct") or 0.0))
    z_change = float(row.get("residual_z_change_1d") or 0.0)
    z_slope = float(row.get("residual_z_slope_3d") or 0.0)

    if phase == "post_event_shock":
        return "post_event_shock"
    if residual_z <= 0:
        return "negative_residual"
    if (
        residual_z >= args.pre_pressure_min_z
        and z_change >= args.pre_pressure_min_z_change
        and z_slope >= args.pre_pressure_min_z_slope_3d
        and actual <= args.pre_pressure_max_return_pct
        and unexplained <= args.pre_pressure_max_unexplained_pct
    ):
        return "positive_pre_explosion_pressure"
    return "positive_nonshock_other"


def bucket_for_z(abs_z: float, thresholds: Sequence[float]) -> str:
    bucket = f"<{thresholds[0]:g}" if thresholds else "all"
    for threshold in thresholds:
        if abs_z >= threshold:
            bucket = f">={threshold:g}"
    return bucket


def summarize_returns(values: Sequence[float]) -> Dict[str, Any]:
    clean = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not clean:
        return {
            "count": 0,
            "expectancy_pct": None,
            "avg_pct": None,
            "median_pct": None,
            "win_rate_pct": None,
            "avg_win_pct": None,
            "avg_loss_pct": None,
            "payoff_ratio": None,
            "profit_factor": None,
        }
    wins = [v for v in clean if v > 0]
    losses = [v for v in clean if v < 0]
    avg_win = float(statistics.mean(wins)) if wins else None
    avg_loss = float(statistics.mean(losses)) if losses else None
    gross_win = float(sum(wins)) if wins else 0.0
    gross_loss = abs(float(sum(losses))) if losses else 0.0
    payoff_ratio = (avg_win / abs(avg_loss)) if avg_win is not None and avg_loss not in (None, 0.0) else None
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else None
    return {
        "count": len(clean),
        "expectancy_pct": round(float(statistics.mean(clean)), 4),
        "avg_pct": round(float(statistics.mean(clean)), 4),
        "median_pct": round(float(statistics.median(clean)), 4),
        "win_rate_pct": round((len(wins) / len(clean)) * 100.0, 2),
        "avg_win_pct": round(avg_win, 4) if avg_win is not None else None,
        "avg_loss_pct": round(avg_loss, 4) if avg_loss is not None else None,
        "payoff_ratio": round(payoff_ratio, 4) if payoff_ratio is not None else None,
        "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
    }


def aggregate_signals(signals: Sequence[Dict[str, Any]], horizons: Sequence[int], thresholds: Sequence[float]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "overall_directional_continuation": {},
        "overall_directional_r": {},
        "by_residual_direction": {},
        "by_residual_direction_r": {},
        "by_abs_z_bucket": {},
        "by_signal_phase": {},
        "by_signal_phase_r": {},
        "by_signal_setup": {},
        "by_signal_setup_r": {},
        "by_threshold": {},
        "by_threshold_r": {},
    }

    for horizon in horizons:
        key = f"{horizon}d"
        signed_values: List[float] = []
        raw_positive: List[float] = []
        raw_negative: List[float] = []
        for signal in signals:
            value = signal.get("forward_returns", {}).get(key)
            if value is None:
                continue
            signed = value if signal["residual_z"] > 0 else -value
            signed_values.append(float(signed))
            r_value = signal.get("directional_r", {}).get(key)
            if signal["residual_z"] > 0:
                raw_positive.append(float(value))
            else:
                raw_negative.append(float(value))
        out["overall_directional_continuation"][key] = summarize_returns(signed_values)
        out["overall_directional_r"][key] = summarize_returns([
            signal.get("directional_r", {}).get(key)
            for signal in signals
            if signal.get("directional_r", {}).get(key) is not None
        ])
        out["by_residual_direction"].setdefault("positive_residual_raw", {})[key] = summarize_returns(raw_positive)
        out["by_residual_direction"].setdefault("negative_residual_raw", {})[key] = summarize_returns(raw_negative)
        out["by_residual_direction_r"].setdefault("positive_residual_long_r", {})[key] = summarize_returns([
            signal.get("directional_r", {}).get(key)
            for signal in signals
            if signal["residual_z"] > 0 and signal.get("directional_r", {}).get(key) is not None
        ])
        out["by_residual_direction_r"].setdefault("negative_residual_short_r", {})[key] = summarize_returns([
            signal.get("directional_r", {}).get(key)
            for signal in signals
            if signal["residual_z"] < 0 and signal.get("directional_r", {}).get(key) is not None
        ])

    for threshold in thresholds:
        subset = [signal for signal in signals if signal["abs_residual_z"] >= threshold]
        out["by_threshold"][f">={threshold:g}"] = {
            f"{horizon}d": summarize_returns(
                [
                    (signal["forward_returns"].get(f"{horizon}d") if signal["residual_z"] > 0 else -signal["forward_returns"].get(f"{horizon}d"))
                    for signal in subset
                    if signal.get("forward_returns", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }
        out["by_threshold_r"][f">={threshold:g}"] = {
            f"{horizon}d": summarize_returns(
                [
                    signal.get("directional_r", {}).get(f"{horizon}d")
                    for signal in subset
                    if signal.get("directional_r", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }

    buckets = sorted({signal["abs_z_bucket"] for signal in signals})
    for bucket in buckets:
        subset = [signal for signal in signals if signal["abs_z_bucket"] == bucket]
        out["by_abs_z_bucket"][bucket] = {
            f"{horizon}d": summarize_returns(
                [
                    (signal["forward_returns"].get(f"{horizon}d") if signal["residual_z"] > 0 else -signal["forward_returns"].get(f"{horizon}d"))
                    for signal in subset
                    if signal.get("forward_returns", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }

    phases = sorted({str(signal.get("signal_phase") or "unknown") for signal in signals})
    for phase in phases:
        subset = [signal for signal in signals if str(signal.get("signal_phase") or "unknown") == phase]
        out["by_signal_phase"][phase] = {
            f"{horizon}d": summarize_returns(
                [
                    (signal["forward_returns"].get(f"{horizon}d") if signal["residual_z"] > 0 else -signal["forward_returns"].get(f"{horizon}d"))
                    for signal in subset
                    if signal.get("forward_returns", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }
        out["by_signal_phase_r"][phase] = {
            f"{horizon}d": summarize_returns(
                [
                    signal.get("directional_r", {}).get(f"{horizon}d")
                    for signal in subset
                    if signal.get("directional_r", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }

    setups = sorted({str(signal.get("signal_setup") or "unknown") for signal in signals})
    for setup in setups:
        subset = [signal for signal in signals if str(signal.get("signal_setup") or "unknown") == setup]
        out["by_signal_setup"][setup] = {
            f"{horizon}d": summarize_returns(
                [
                    (signal["forward_returns"].get(f"{horizon}d") if signal["residual_z"] > 0 else -signal["forward_returns"].get(f"{horizon}d"))
                    for signal in subset
                    if signal.get("forward_returns", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }
        out["by_signal_setup_r"][setup] = {
            f"{horizon}d": summarize_returns(
                [
                    signal.get("directional_r", {}).get(f"{horizon}d")
                    for signal in subset
                    if signal.get("directional_r", {}).get(f"{horizon}d") is not None
                ]
            )
            for horizon in horizons
        }

    return out


def top_examples(signals: Sequence[Dict[str, Any]], horizon: int, count: int = 10) -> Dict[str, List[Dict[str, Any]]]:
    key = f"{horizon}d"
    rows = []
    for signal in signals:
        value = signal.get("forward_returns", {}).get(key)
        if value is None:
            continue
        signed = value if signal["residual_z"] > 0 else -value
        rows.append({**signal, "directional_return_pct": signed})
    rows.sort(key=lambda row: row["directional_return_pct"], reverse=True)
    slim_keys = ["as_of_date", "symbol", "name", "residual_z", "abs_residual_z", "actual_return_pct", "directional_return_pct"]
    return {
        "best": [{k: row.get(k) for k in slim_keys} for row in rows[:count]],
        "worst": [{k: row.get(k) for k in slim_keys} for row in rows[-count:]][::-1],
    }


def run_replay(args: argparse.Namespace) -> Dict[str, Any]:
    horizons = parse_int_list(args.forward_windows)
    thresholds = parse_float_list(args.z_thresholds)
    if not horizons:
        raise ValueError("At least one forward window is required")
    if not thresholds:
        thresholds = [2.0, 2.5, 3.0, 4.0]

    universe = load_clean_universe(Path(args.universe))
    selected = universe if args.max_symbols <= 0 else universe[: args.max_symbols]
    metas = {item.symbol: item for item in universe}

    min_rows = args.lookback + max(horizons) + 5
    close_df, volume_df, load_stats = load_ohlcv_panel(
        [item.symbol for item in selected],
        price_dir=Path(args.price_dir),
        min_rows=min_rows,
    )
    dates = replay_dates(
        close_df,
        start=args.as_of_start,
        end=args.as_of_end,
        frequency=args.rebalance_frequency,
    )

    signals: List[Dict[str, Any]] = []
    replay_runs: List[Dict[str, Any]] = []
    skipped_dates: List[Dict[str, Any]] = []

    for as_of in dates:
        eligible = eligible_symbols(
            close_df,
            volume_df,
            as_of,
            lookback=args.lookback,
            min_coverage=args.min_coverage,
            min_price=args.min_price,
            min_dollar_volume=args.min_dollar_volume,
        )
        if len(eligible) < 20:
            skipped_dates.append({"as_of_date": str(as_of.date()), "reason": "too_few_eligible_symbols", "eligible": len(eligible)})
            continue

        returns = trailing_returns(close_df, as_of, eligible, args.lookback)
        try:
            ranked, pca_meta = run_pca_residuals(returns, args.factors)
        except Exception as err:
            skipped_dates.append({"as_of_date": str(as_of.date()), "reason": str(err), "eligible": len(eligible)})
            continue

        ranked = ranked[ranked["abs_residual_z"] >= args.min_abs_z]
        ranked = ranked.head(args.top_per_date)

        date_signals: List[Dict[str, Any]] = []
        for row in ranked.to_dict(orient="records"):
            symbol = str(row["symbol"])
            meta = metas.get(symbol)
            vol_ratio = signal_volume_ratio(volume_df, symbol, as_of)
            phase = classify_signal_phase(row, vol_ratio, args)
            setup = classify_signal_setup(row, phase, args)
            fwd = {
                f"{horizon}d": (
                    round(value, 4) if (value := forward_return_pct(
                        close_df,
                        symbol,
                        as_of,
                        horizon,
                        entry_lag_days=args.entry_lag_days,
                    )) is not None else None
                )
                for horizon in horizons
            }
            directional_r = {}
            for horizon in horizons:
                key = f"{horizon}d"
                value = fwd.get(key)
                if value is None or args.risk_pct <= 0:
                    directional_r[key] = None
                    continue
                signed_value = value if float(row["residual_z"]) > 0 else -value
                directional_r[key] = round(float(signed_value) / float(args.risk_pct), 4)
            signal = {
                "as_of_date": str(as_of.date()),
                "symbol": symbol,
                "name": meta.name if meta else "",
                "cap_tier": meta.cap_tier if meta else None,
                "market_cap": meta.market_cap if meta else None,
                "residual_z": round(float(row["residual_z"]), 4),
                "prev_residual_z_1d": round(float(row["prev_residual_z_1d"]), 4) if row.get("prev_residual_z_1d") is not None and math.isfinite(float(row["prev_residual_z_1d"])) else None,
                "residual_z_change_1d": round(float(row["residual_z_change_1d"]), 4) if row.get("residual_z_change_1d") is not None and math.isfinite(float(row["residual_z_change_1d"])) else None,
                "residual_z_slope_3d": round(float(row["residual_z_slope_3d"]), 4) if row.get("residual_z_slope_3d") is not None and math.isfinite(float(row["residual_z_slope_3d"])) else None,
                "abs_residual_z": round(float(row["abs_residual_z"]), 4),
                "abs_z_bucket": bucket_for_z(float(row["abs_residual_z"]), thresholds),
                "actual_return_pct": round(float(row["actual_return_pct"]), 4),
                "factor_expected_return_pct": round(float(row["factor_expected_return_pct"]), 4),
                "unexplained_return_pct": round(float(row["unexplained_return_pct"]), 4),
                "volume_ratio_20d": round(float(vol_ratio), 4) if vol_ratio is not None else None,
                "signal_phase": phase,
                "signal_setup": setup,
                "forward_returns": fwd,
                "directional_r": directional_r,
            }
            signals.append(signal)
            date_signals.append(signal)

        replay_runs.append(
            {
                "as_of_date": str(as_of.date()),
                "eligible_symbols": len(eligible),
                "model_symbols": pca_meta["symbols_in_model"],
                "signals": len(date_signals),
                "pca": pca_meta,
                "top_symbols": [signal["symbol"] for signal in date_signals[:10]],
            }
        )

    aggregate = aggregate_signals(signals, horizons, thresholds)
    examples = top_examples(signals, horizon=max(horizons), count=10) if signals else {"best": [], "worst": []}

    return {
        "meta": {
            "generated_at": now_iso(),
            "script": "backend/scripts/run_eigen_replay_study.py",
            "mode": "price_only_phase_1",
            "universe_path": str(Path(args.universe)),
            "price_dir": str(Path(args.price_dir)),
            "as_of_start": args.as_of_start,
            "as_of_end": args.as_of_end,
            "rebalance_frequency": args.rebalance_frequency,
            "lookback": args.lookback,
            "factors": args.factors,
            "max_symbols": args.max_symbols,
            "top_per_date": args.top_per_date,
            "min_abs_z": args.min_abs_z,
            "z_thresholds": thresholds,
            "forward_windows": horizons,
            "min_price": args.min_price,
            "min_dollar_volume": args.min_dollar_volume,
            "risk_pct": args.risk_pct,
            "entry_lag_days": args.entry_lag_days,
            "shock_return_pct": args.shock_return_pct,
            "shock_unexplained_pct": args.shock_unexplained_pct,
            "shock_abs_z": args.shock_abs_z,
            "volume_surge_ratio": args.volume_surge_ratio,
            "pre_pressure_min_z": args.pre_pressure_min_z,
            "pre_pressure_min_z_change": args.pre_pressure_min_z_change,
            "pre_pressure_min_z_slope_3d": args.pre_pressure_min_z_slope_3d,
            "pre_pressure_max_return_pct": args.pre_pressure_max_return_pct,
            "pre_pressure_max_unexplained_pct": args.pre_pressure_max_unexplained_pct,
            "known_limitations": [
                "Uses today's clean universe, so survivorship bias is present.",
                "Price-only Phase 1 does not include PIT valuation, options flow, social, or macro overlays.",
                "R expectancy uses a fixed percent-risk denominator, not a simulated stop/target fill model.",
                "Corporate actions and event-driven gaps may appear as perturbations until artifact filters mature.",
            ],
        },
        "load_stats": {
            **load_stats,
            "price_start": str(close_df.index.min().date()),
            "price_end": str(close_df.index.max().date()),
        },
        "replay_summary": {
            "requested_replay_dates": len(dates),
            "completed_replay_dates": len(replay_runs),
            "skipped_replay_dates": len(skipped_dates),
            "signals": len(signals),
        },
        "skipped_dates": skipped_dates,
        "replay_runs": replay_runs,
        "aggregate": aggregate,
        "examples": examples,
        "signals": signals,
    }


def markdown_stat(stat: Dict[str, Any]) -> str:
    if not stat or not stat.get("count"):
        return "n/a"
    pf = stat.get("profit_factor")
    pf_text = f", pf={pf:.2f}" if pf is not None else ""
    return (
        f"n={stat['count']}, exp={stat['expectancy_pct']:.2f}%, "
        f"med={stat['median_pct']:.2f}%, win={stat['win_rate_pct']:.1f}%, "
        f"avgW={stat['avg_win_pct']:.2f}%, avgL={stat['avg_loss_pct']:.2f}%{pf_text}"
    )


def markdown_r_stat(stat: Dict[str, Any]) -> str:
    if not stat or not stat.get("count"):
        return "n/a"
    pf = stat.get("profit_factor")
    pf_text = f", pf={pf:.2f}" if pf is not None else ""
    return (
        f"n={stat['count']}, exp={stat['expectancy_pct']:.2f}R, "
        f"med={stat['median_pct']:.2f}R, win={stat['win_rate_pct']:.1f}%, "
        f"avgW={stat['avg_win_pct']:.2f}R, avgL={stat['avg_loss_pct']:.2f}R{pf_text}"
    )


def write_markdown(path: Path, payload: Dict[str, Any]) -> None:
    meta = payload["meta"]
    summary = payload["replay_summary"]
    agg = payload["aggregate"]
    horizons = meta["forward_windows"]
    lines = [
        "# Eigen Historical Replay Study",
        "",
        f"Generated: `{meta['generated_at']}`",
        f"As-of range: `{meta['as_of_start']}` to `{meta['as_of_end']}`",
        f"Frequency: `{meta['rebalance_frequency']}`",
        f"Lookback: `{meta['lookback']}` trading days",
        f"Factors: `{meta['factors']}`",
        f"Selected symbols: `{meta['max_symbols']}`",
        f"Entry lag: `{meta['entry_lag_days']}` trading day(s)",
        f"Fixed risk denominator: `{meta['risk_pct']}%`",
        f"Completed replay dates: `{summary['completed_replay_dates']}` / `{summary['requested_replay_dates']}`",
        f"Signals studied: `{summary['signals']}`",
        "",
        "## Directional Continuation",
        "",
        "Directional continuation treats positive residuals as long and negative residuals as short. Expectancy is average directional return per signal before any transaction costs or sizing rules.",
        "",
        "| Horizon | Result |",
        "|---|---|",
    ]
    for horizon in horizons:
        key = f"{horizon}d"
        lines.append(f"| {key} | {markdown_stat(agg['overall_directional_continuation'].get(key, {}))} |")

    lines.extend(["", "## R Expectancy", ""])
    lines.append(
        f"R expectancy divides the directional percent return by the fixed `{meta['risk_pct']}%` risk denominator. "
        "This is not yet a stop/target simulation."
    )
    lines.extend(["", "| Horizon | Result |", "|---|---|"])
    for horizon in horizons:
        key = f"{horizon}d"
        lines.append(f"| {key} | {markdown_r_stat(agg['overall_directional_r'].get(key, {}))} |")

    lines.extend(["", "## Residual Direction", "", "| Group | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for group, table in agg["by_residual_direction"].items():
        lines.append("| " + group + " | " + " | ".join(markdown_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Residual Direction R", "", "| Group | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for group, table in agg["by_residual_direction_r"].items():
        lines.append("| " + group + " | " + " | ".join(markdown_r_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Signal Phase Filter", ""])
    lines.append(
        f"`post_event_shock` = signal-day return >= `{meta['shock_return_pct']}%`, "
        f"or unexplained return >= `{meta['shock_unexplained_pct']}%`, "
        f"or residual z >= `{meta['shock_abs_z']}`. "
        f"`pressure_build_volume_confirmed` requires volume >= `{meta['volume_surge_ratio']}x` 20-day baseline."
    )
    lines.extend(["", "| Phase | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for phase, table in agg["by_signal_phase"].items():
        lines.append("| " + phase + " | " + " | ".join(markdown_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Signal Phase Filter R", "", "| Phase | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for phase, table in agg["by_signal_phase_r"].items():
        lines.append("| " + phase + " | " + " | ".join(markdown_r_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Pre-Explosion Pressure Setup", ""])
    lines.append(
        f"`positive_pre_explosion_pressure` = positive residual z >= `{meta['pre_pressure_min_z']}`, "
        f"1D z change >= `{meta['pre_pressure_min_z_change']}`, "
        f"3D z slope >= `{meta['pre_pressure_min_z_slope_3d']}`, "
        f"signal-day return <= `{meta['pre_pressure_max_return_pct']}%`, "
        f"and unexplained return <= `{meta['pre_pressure_max_unexplained_pct']}%`."
    )
    lines.extend(["", "| Setup | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for setup, table in agg["by_signal_setup"].items():
        lines.append("| " + setup + " | " + " | ".join(markdown_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Pre-Explosion Pressure Setup R", "", "| Setup | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for setup, table in agg["by_signal_setup_r"].items():
        lines.append("| " + setup + " | " + " | ".join(markdown_r_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Thresholds", "", "| Threshold | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for threshold, table in agg["by_threshold"].items():
        lines.append("| " + threshold + " | " + " | ".join(markdown_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", "## Thresholds R", "", "| Threshold | " + " | ".join(f"{h}d" for h in horizons) + " |"])
    lines.append("|---|" + "|".join("---" for _ in horizons) + "|")
    for threshold, table in agg["by_threshold_r"].items():
        lines.append("| " + threshold + " | " + " | ".join(markdown_r_stat(table.get(f"{h}d", {})) for h in horizons) + " |")

    lines.extend(["", f"## Best {max(horizons)}D Directional Examples", "", "| Date | Symbol | Resid Z | Signal Day | Directional Return |", "|---|---|---:|---:|---:|"])
    for row in payload["examples"]["best"]:
        lines.append(
            f"| {row['as_of_date']} | {row['symbol']} | {row['residual_z']:.2f} | "
            f"{row['actual_return_pct']:.2f}% | {row['directional_return_pct']:.2f}% |"
        )

    lines.extend(["", f"## Worst {max(horizons)}D Directional Examples", "", "| Date | Symbol | Resid Z | Signal Day | Directional Return |", "|---|---|---:|---:|---:|"])
    for row in payload["examples"]["worst"]:
        lines.append(
            f"| {row['as_of_date']} | {row['symbol']} | {row['residual_z']:.2f} | "
            f"{row['actual_return_pct']:.2f}% | {row['directional_return_pct']:.2f}% |"
        )

    lines.extend(["", "## Limitations", ""])
    for item in meta["known_limitations"]:
        lines.append(f"- {item}")

    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run point-in-time eigen/PCA historical replay study.")
    parser.add_argument("--as-of-start", required=True)
    parser.add_argument("--as-of-end", required=True)
    parser.add_argument("--rebalance-frequency", default="weekly", choices=["daily", "weekly", "monthly"])
    parser.add_argument("--lookback", type=int, default=120)
    parser.add_argument("--factors", type=int, default=5)
    parser.add_argument("--max-symbols", type=int, default=750)
    parser.add_argument("--top-per-date", type=int, default=25)
    parser.add_argument("--forward-windows", default="1,5,20,60,120")
    parser.add_argument("--z-thresholds", default="2,2.5,3,4")
    parser.add_argument("--min-abs-z", type=float, default=2.0)
    parser.add_argument("--min-coverage", type=float, default=0.95)
    parser.add_argument("--min-price", type=float, default=2.0)
    parser.add_argument("--min-dollar-volume", type=float, default=1_000_000.0)
    parser.add_argument("--risk-pct", type=float, default=10.0, help="Fixed risk percent denominator for R expectancy.")
    parser.add_argument("--entry-lag-days", type=int, default=0, help="Trading-day lag between signal date and simulated entry.")
    parser.add_argument("--shock-return-pct", type=float, default=15.0, help="Classify as post-event shock if abs signal-day return is at least this percent.")
    parser.add_argument("--shock-unexplained-pct", type=float, default=12.0, help="Classify as post-event shock if abs unexplained return is at least this percent.")
    parser.add_argument("--shock-abs-z", type=float, default=6.0, help="Classify as post-event shock if abs residual z is at least this value.")
    parser.add_argument("--volume-surge-ratio", type=float, default=1.5, help="Classify non-shock pressure as volume-confirmed above this 20-day volume ratio.")
    parser.add_argument("--pre-pressure-min-z", type=float, default=2.0, help="Minimum positive residual z for pre-explosion pressure setup.")
    parser.add_argument("--pre-pressure-min-z-change", type=float, default=0.5, help="Minimum 1-day increase in residual z for pre-explosion pressure setup.")
    parser.add_argument("--pre-pressure-min-z-slope-3d", type=float, default=0.75, help="Minimum residual z lift versus prior 3-day mean.")
    parser.add_argument("--pre-pressure-max-return-pct", type=float, default=10.0, help="Maximum abs signal-day return allowed before setup is considered too exploded.")
    parser.add_argument("--pre-pressure-max-unexplained-pct", type=float, default=8.0, help="Maximum abs unexplained signal-day return allowed before setup is considered too exploded.")
    parser.add_argument("--universe", default=str(UNIVERSE_PATH))
    parser.add_argument("--price-dir", default=str(PRICE_DIR))
    parser.add_argument("--output-dir", default=str(RESEARCH_DIR))
    parser.add_argument("--out-json", default="")
    parser.add_argument("--out-md", default="")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    payload = run_replay(args)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_json = Path(args.out_json) if args.out_json else output_dir / "eigen_replay_study.latest.json"
    out_md = Path(args.out_md) if args.out_md else output_dir / "eigen_replay_study.latest.md"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_markdown(out_md, payload)

    print(
        json.dumps(
            {
                "ok": True,
                "out_json": str(out_json),
                "out_md": str(out_md),
                "replay_summary": payload["replay_summary"],
                "directional_continuation": payload["aggregate"]["overall_directional_continuation"],
                "directional_r_expectancy": payload["aggregate"]["overall_directional_r"],
                "best_examples": payload["examples"]["best"][:5],
                "worst_examples": payload["examples"]["worst"][:5],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
