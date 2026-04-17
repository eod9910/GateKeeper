#!/usr/bin/env python3
from __future__ import annotations

"""
Compare PIT financial factors side by side.

This script extends the valuation-gap research into a simple factor comparison:

- DCF valuation gap
- Earnings growth
- Return on equity
- Earnings quality

It does not try to build a tradable portfolio. It answers the narrower question:
- which financial factors are directionally informative at different horizons?
"""

import argparse
import json
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "backend" / "scripts"
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "fundamentals-pit.sqlite"
DEFAULT_OUTPUT_PATH = ROOT / "backend" / "data" / "research" / "financial_factor_comparison_summary.json"

sys.path.insert(0, str(SCRIPTS_DIR))

import run_valuation_gap_accuracy_study as study  # noqa: E402


FACTOR_IDS = (
    "dcf_gap",
    "earnings_growth",
    "return_on_equity",
    "earnings_quality",
)

EXTENDED_FACT_KEYS = tuple(list(study.DCF_FACT_KEYS) + ["shareholders_equity"])


@dataclass
class FactorObservation:
    symbol: str
    asof_date: str
    price: float
    dcf_gap_pct: Optional[float]
    earnings_growth_pct: Optional[float]
    return_on_equity_pct: Optional[float]
    earnings_quality_score: Optional[float]
    horizon_returns: Dict[int, Optional[float]]


def _safe_float(value: Any) -> Optional[float]:
    return study._safe_float(value)


def _dedupe(values: Iterable[str]) -> List[str]:
    return study._dedupe(values)


def _compute_earnings_growth_pct(snapshot: Dict[str, Any], latest_annual: Dict[str, Any], prior_annual: Optional[Dict[str, Any]]) -> Optional[float]:
    snapshot_growth = _safe_float(snapshot.get("earningsGrowthPct"))
    if snapshot_growth is not None and math.isfinite(snapshot_growth):
        return snapshot_growth

    latest_metrics = latest_annual.get("metrics") or {}
    prior_metrics = (prior_annual or {}).get("metrics") or {}
    latest_net_income = _safe_float(latest_metrics.get("net_income"))
    prior_net_income = _safe_float(prior_metrics.get("net_income"))
    if latest_net_income is None or prior_net_income in (None, 0):
        return None
    return ((latest_net_income / prior_net_income) - 1.0) * 100.0


def _compute_return_on_equity_pct(snapshot: Dict[str, Any], latest_annual: Dict[str, Any]) -> Optional[float]:
    roe = _safe_float(snapshot.get("returnOnEquityPct"))
    if roe is not None and math.isfinite(roe):
        return roe

    metrics = latest_annual.get("metrics") or {}
    net_income = _safe_float(metrics.get("net_income"))
    equity = _safe_float(metrics.get("shareholders_equity"))
    if net_income is None or equity in (None, 0):
        return None
    return (net_income / equity) * 100.0


def _evaluate_symbol(
    conn: Any,
    symbol: str,
    bars: List[Dict[str, Any]],
    *,
    rebalance_frequency: str,
    start_date: Optional[str],
    end_date: Optional[str],
    gap_threshold_pct: float,
    horizons: Sequence[int],
) -> List[FactorObservation]:
    observations: List[FactorObservation] = []
    max_forward_bars = max(horizons)
    rebalance_indices = study._select_rebalance_dates(bars, rebalance_frequency, max_forward_bars)

    start_dt = study._parse_date(start_date) if start_date else None
    end_dt = study._parse_date(end_date) if end_date else None

    for index in rebalance_indices:
        bar = bars[index]
        asof_date = str(bar["date"])
        asof_dt = study._parse_date(asof_date)
        if asof_dt is None:
            continue
        if start_dt and asof_dt < start_dt:
            continue
        if end_dt and asof_dt > end_dt:
            continue

        price = _safe_float(bar["close"])
        if price in (None, 0):
            continue

        snapshot = study.get_asof_snapshot(conn, symbol, asof_date)
        annual_rows = study.get_statement_history(conn, symbol, "annual", asof_date, fact_keys=EXTENDED_FACT_KEYS)
        annual_periods = study._group_annual_periods(annual_rows)
        if not annual_periods:
            continue

        latest_annual = annual_periods[0]
        prior_annual = annual_periods[1] if len(annual_periods) > 1 else None
        dcf = study._build_standardized_dcf(snapshot, latest_annual, prior_annual, float(price))
        if not dcf:
            continue

        horizon_returns = {h: study._forward_return_pct(bars, index, h) for h in horizons}
        observations.append(
            FactorObservation(
                symbol=symbol,
                asof_date=asof_date,
                price=float(price),
                dcf_gap_pct=_safe_float(dcf.get("valuation_gap_pct")),
                earnings_growth_pct=_compute_earnings_growth_pct(snapshot, latest_annual, prior_annual),
                return_on_equity_pct=_compute_return_on_equity_pct(snapshot, latest_annual),
                earnings_quality_score=_safe_float(dcf.get("quality_score")),
                horizon_returns=horizon_returns,
            )
        )

    return observations


def _factor_value(obs: FactorObservation, factor_id: str) -> Optional[float]:
    if factor_id == "dcf_gap":
        return obs.dcf_gap_pct
    if factor_id == "earnings_growth":
        return obs.earnings_growth_pct
    if factor_id == "return_on_equity":
        return obs.return_on_equity_pct
    if factor_id == "earnings_quality":
        return obs.earnings_quality_score
    return None


def _quantile(sorted_values: Sequence[float], pct: float) -> Optional[float]:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = pct * (len(sorted_values) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight


def _directionally_correct(side: str, forward_return_pct: Optional[float]) -> Optional[bool]:
    if forward_return_pct is None:
        return None
    if side == "bullish":
        return forward_return_pct > 0
    if side == "bearish":
        return forward_return_pct < 0
    return None


def _label_for_factor_value(factor_id: str, value: Optional[float], *, gap_threshold_pct: float, low_cut: Optional[float], high_cut: Optional[float]) -> str:
    if value is None or not math.isfinite(value):
        return "neutral"
    if factor_id == "dcf_gap":
        if value >= gap_threshold_pct:
            return "bullish"
        if value <= -gap_threshold_pct:
            return "bearish"
        return "neutral"

    if low_cut is None or high_cut is None:
        return "neutral"
    if value >= high_cut:
        return "bullish"
    if value <= low_cut:
        return "bearish"
    return "neutral"


def _classify_by_date(
    observations: Sequence[FactorObservation],
    factor_id: str,
    *,
    gap_threshold_pct: float,
    tail_quantile: float,
) -> Dict[str, Dict[str, str]]:
    labels: Dict[str, Dict[str, str]] = {}
    by_date: Dict[str, List[FactorObservation]] = {}
    for obs in observations:
        by_date.setdefault(obs.asof_date, []).append(obs)

    for asof_date, items in by_date.items():
        values = [
            _factor_value(obs, factor_id)
            for obs in items
            if _factor_value(obs, factor_id) is not None and math.isfinite(float(_factor_value(obs, factor_id)))
        ]
        sorted_values = sorted(float(value) for value in values)
        low_cut = None if factor_id == "dcf_gap" else _quantile(sorted_values, tail_quantile)
        high_cut = None if factor_id == "dcf_gap" else _quantile(sorted_values, 1.0 - tail_quantile)

        date_labels: Dict[str, str] = {}
        for obs in items:
            value = _factor_value(obs, factor_id)
            date_labels[obs.symbol] = _label_for_factor_value(
                factor_id,
                value,
                gap_threshold_pct=gap_threshold_pct,
                low_cut=low_cut,
                high_cut=high_cut,
            )
        labels[asof_date] = date_labels
    return labels


def _summarize_subset(
    observations: Sequence[FactorObservation],
    labels: Dict[str, Dict[str, str]],
    factor_id: str,
    side: str,
    horizon: int,
) -> Dict[str, Any]:
    subset = [
        obs
        for obs in observations
        if labels.get(obs.asof_date, {}).get(obs.symbol) == side
    ]
    returns = [obs.horizon_returns[horizon] for obs in subset if obs.horizon_returns[horizon] is not None]
    direction_flags = [
        _directionally_correct(side, obs.horizon_returns[horizon])
        for obs in subset
        if _directionally_correct(side, obs.horizon_returns[horizon]) is not None
    ]
    factor_values = [
        _factor_value(obs, factor_id)
        for obs in subset
        if _factor_value(obs, factor_id) is not None
    ]

    return {
        "observations": len(subset),
        "usable_returns": len(returns),
        "median_factor_value": round(statistics.median(factor_values), 4) if factor_values else None,
        "avg_forward_return_pct": round(statistics.mean(returns), 4) if returns else None,
        "median_forward_return_pct": round(statistics.median(returns), 4) if returns else None,
        "directional_accuracy": round(sum(1 for flag in direction_flags if flag) / len(direction_flags), 4) if direction_flags else None,
    }


def _factor_title(factor_id: str) -> str:
    if factor_id == "dcf_gap":
        return "DCF valuation gap"
    if factor_id == "earnings_growth":
        return "Earnings growth"
    if factor_id == "return_on_equity":
        return "Return on equity"
    if factor_id == "earnings_quality":
        return "Earnings quality"
    return factor_id


def _summarize_factor(
    observations: Sequence[FactorObservation],
    factor_id: str,
    *,
    horizons: Sequence[int],
    gap_threshold_pct: float,
    tail_quantile: float,
) -> Dict[str, Any]:
    labels = _classify_by_date(
        observations,
        factor_id,
        gap_threshold_pct=gap_threshold_pct,
        tail_quantile=tail_quantile,
    )
    usable_values = [
        _factor_value(obs, factor_id)
        for obs in observations
        if _factor_value(obs, factor_id) is not None
    ]

    horizon_summary: Dict[str, Any] = {}
    for horizon in horizons:
        bullish = _summarize_subset(observations, labels, factor_id, "bullish", horizon)
        bearish = _summarize_subset(observations, labels, factor_id, "bearish", horizon)
        combined_flags = []
        for side in ("bullish", "bearish"):
            for obs in observations:
                if labels.get(obs.asof_date, {}).get(obs.symbol) != side:
                    continue
                flag = _directionally_correct(side, obs.horizon_returns[horizon])
                if flag is not None:
                    combined_flags.append(flag)
        horizon_summary[str(horizon)] = {
            "bullish": bullish,
            "bearish": bearish,
            "combined_directional_accuracy": round(sum(1 for flag in combined_flags if flag) / len(combined_flags), 4) if combined_flags else None,
        }

    return {
        "title": _factor_title(factor_id),
        "classification_mode": "threshold" if factor_id == "dcf_gap" else "cross_sectional_quantile",
        "usable_factor_values": len(usable_values),
        "median_factor_value": round(statistics.median(usable_values), 4) if usable_values else None,
        "horizons": horizon_summary,
    }


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare PIT financial factors side by side.")
    parser.add_argument("--universe", default="clean_stocks", help="Universe name from backend/services/universe_registry.py")
    parser.add_argument("--symbols", default="", help="Optional comma-separated symbol override")
    parser.add_argument("--cap-tier", choices=("micro", "small", "mid", "large"), default="", help="Optional market-cap tier filter")
    parser.add_argument("--limit", type=int, default=0, help="Optional symbol limit")
    parser.add_argument("--frequency", choices=("monthly", "quarterly"), default="monthly", help="Rebalance frequency")
    parser.add_argument("--horizons", default="63,126,252", help="Comma-separated forward bar horizons")
    parser.add_argument("--gap-threshold-pct", type=float, default=20.0, help="Gap threshold for DCF bullish/bearish labels")
    parser.add_argument("--tail-quantile", type=float, default=0.3, help="Bottom/top tail split for non-DCF factors")
    parser.add_argument("--start-date", default="2020-01-01", help="Optional YYYY-MM-DD start date")
    parser.add_argument("--end-date", default="", help="Optional YYYY-MM-DD end date")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="Path to fundamentals PIT database")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT_PATH), help="Path to JSON summary output")
    args = parser.parse_args()

    horizons = sorted({int(part.strip()) for part in str(args.horizons).split(",") if part.strip()})
    if not horizons:
        raise SystemExit("No valid horizons supplied.")

    symbols = _dedupe(args.symbols.split(",")) if args.symbols else study._load_symbols(args)
    if not symbols:
        raise SystemExit("No symbols loaded for study.")

    conn = study.connect_pit(args.db_path)
    study.ensure_schema(conn)

    all_observations: List[FactorObservation] = []
    symbols_with_observations = 0

    try:
        for idx, symbol in enumerate(symbols, start=1):
            bars = study._load_daily_bars(symbol)
            if len(bars) <= max(horizons) + 24:
                continue

            observations = _evaluate_symbol(
                conn,
                symbol,
                bars,
                rebalance_frequency=args.frequency,
                start_date=args.start_date or None,
                end_date=args.end_date or None,
                gap_threshold_pct=float(args.gap_threshold_pct),
                horizons=horizons,
            )
            if not observations:
                continue
            all_observations.extend(observations)
            symbols_with_observations += 1
            print(f"[{idx}/{len(symbols)}] {symbol}: {len(observations)} observations", flush=True)
    finally:
        conn.close()

    summary = {
        "study": {
            "name": "pit_financial_factor_comparison",
            "universe": args.universe,
            "cap_tier": args.cap_tier or None,
            "symbols_requested": len(symbols),
            "symbols_with_observations": symbols_with_observations,
            "observation_count": len(all_observations),
            "rebalance_frequency": args.frequency,
            "horizons": list(horizons),
            "start_date": args.start_date or None,
            "end_date": args.end_date or None,
            "dcf_gap_threshold_pct": args.gap_threshold_pct,
            "tail_quantile": args.tail_quantile,
        },
        "factors": {
            factor_id: _summarize_factor(
                all_observations,
                factor_id,
                horizons=horizons,
                gap_threshold_pct=float(args.gap_threshold_pct),
                tail_quantile=float(args.tail_quantile),
            )
            for factor_id in FACTOR_IDS
        },
    }

    _write_json(Path(args.output_json), summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
