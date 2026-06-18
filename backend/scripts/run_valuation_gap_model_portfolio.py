#!/usr/bin/env python3
from __future__ import annotations

"""
Model portfolio built on top of the valuation-gap study.

Default sleeves:
- 40% large-cap undervalued (long)
- 30% small-cap undervalued (long)
- 20% micro-cap overvalued (short)
- 10% cash

The script forms a portfolio on each monthly formation date, holds it for
252 trading days, and reports the historical 1-year outcomes.
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
DEFAULT_OUTPUT_PATH = ROOT / "backend" / "data" / "research" / "valuation_gap_model_portfolio.json"

sys.path.insert(0, str(SCRIPTS_DIR))

import run_valuation_gap_accuracy_study as study  # noqa: E402


@dataclass
class SleeveSpec:
    name: str
    cap_tier: str
    valuation_state: str
    side: str
    weight: float
    max_names: int


DEFAULT_SLEEVES = [
    SleeveSpec(
        name="large_undervalued",
        cap_tier="large",
        valuation_state="undervalued",
        side="long",
        weight=0.40,
        max_names=4,
    ),
    SleeveSpec(
        name="small_undervalued",
        cap_tier="small",
        valuation_state="undervalued",
        side="long",
        weight=0.30,
        max_names=4,
    ),
    SleeveSpec(
        name="micro_overvalued",
        cap_tier="micro",
        valuation_state="overvalued",
        side="short",
        weight=0.20,
        max_names=4,
    ),
]


def _build_args(cap_tier: str, start_date: str, db_path: str) -> argparse.Namespace:
    return argparse.Namespace(
        universe="clean_stocks",
        symbols="",
        cap_tier=cap_tier,
        limit=0,
        frequency="monthly",
        horizons="252",
        gap_threshold_pct=20.0,
        start_date=start_date,
        end_date="",
        db_path=db_path,
        output_json="",
        output_csv="",
    )


def _collect_observations_by_date(
    conn: Any,
    sleeve: SleeveSpec,
    start_date: str,
    db_path: str,
) -> Dict[str, List[study.StudyObservation]]:
    args = _build_args(sleeve.cap_tier, start_date, db_path)
    symbols = study._load_symbols(args)
    by_date: Dict[str, List[study.StudyObservation]] = {}

    for symbol in symbols:
        bars = study._load_daily_bars(symbol)
        if len(bars) <= 252 + 24:
            continue
        observations = study._evaluate_symbol(
            conn,
            symbol,
            bars,
            rebalance_frequency="monthly",
            start_date=start_date,
            end_date=None,
            gap_threshold_pct=20.0,
            horizons=[252],
            reliability_guard=True,
        )
        for obs in observations:
            if obs.valuation_state != sleeve.valuation_state:
                continue
            by_date.setdefault(obs.asof_date, []).append(obs)

    for asof_date, items in by_date.items():
        items.sort(
            key=lambda obs: abs(obs.valuation_gap_pct),
            reverse=True,
        )
    return by_date


def _portfolio_return_for_sleeve(
    sleeve: SleeveSpec,
    candidates: Sequence[study.StudyObservation],
) -> Dict[str, Any]:
    selected = list(candidates[: sleeve.max_names])
    if not selected:
        return {
            "invested_weight": 0.0,
            "sleeve_return_pct": 0.0,
            "positions": [],
        }

    per_name_weight = sleeve.weight / len(selected)
    sleeve_return = 0.0
    positions = []

    for obs in selected:
        forward_return = obs.horizon_returns[252]
        if forward_return is None:
            continue
        contribution = per_name_weight * (forward_return / 100.0)
        if sleeve.side == "short":
            contribution *= -1.0
        sleeve_return += contribution
        positions.append(
            {
                "symbol": obs.symbol,
                "side": sleeve.side,
                "weight": round(per_name_weight, 4),
                "price": round(obs.price, 4),
                "fair_value_mid": round(obs.fair_value_mid, 4),
                "valuation_gap_pct": round(obs.valuation_gap_pct, 4),
                "forward_return_252d_pct": round(float(forward_return), 4),
                "quality_grade": obs.quality_grade,
            }
        )

    return {
        "invested_weight": round(per_name_weight * len(positions), 4),
        "sleeve_return_pct": round(sleeve_return * 100.0, 4),
        "positions": positions,
    }


def _summarize_returns(returns: List[float]) -> Dict[str, Any]:
    if not returns:
        return {
            "count": 0,
            "avg_return_pct": None,
            "median_return_pct": None,
            "win_rate": None,
            "best_return_pct": None,
            "worst_return_pct": None,
        }
    return {
        "count": len(returns),
        "avg_return_pct": round(statistics.mean(returns), 4),
        "median_return_pct": round(statistics.median(returns), 4),
        "win_rate": round(sum(1 for value in returns if value > 0) / len(returns), 4),
        "best_return_pct": round(max(returns), 4),
        "worst_return_pct": round(min(returns), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the valuation-gap model portfolio study.")
    parser.add_argument("--start-date", default="2020-01-01", help="Formation start date (YYYY-MM-DD)")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="Path to fundamentals PIT database")
    parser.add_argument("--portfolio-size", type=float, default=10_000.0, help="Portfolio size for notional reporting")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT_PATH), help="Path to summary output")
    args = parser.parse_args()

    conn = study.connect_pit(args.db_path)
    study.ensure_schema(conn)

    try:
        sleeve_maps = {
            sleeve.name: _collect_observations_by_date(conn, sleeve, args.start_date, args.db_path)
            for sleeve in DEFAULT_SLEEVES
        }
    finally:
        conn.close()

    common_dates = sorted(
        set().union(*[set(mapping.keys()) for mapping in sleeve_maps.values()])
    )

    formations: List[Dict[str, Any]] = []
    one_year_returns: List[float] = []

    for asof_date in common_dates:
        sleeves_out: Dict[str, Any] = {}
        total_return_pct = 0.0
        invested_weight = 0.0

        for sleeve in DEFAULT_SLEEVES:
            sleeve_result = _portfolio_return_for_sleeve(
                sleeve,
                sleeve_maps[sleeve.name].get(asof_date, []),
            )
            sleeves_out[sleeve.name] = sleeve_result
            invested_weight += float(sleeve_result["invested_weight"])
            total_return_pct += float(sleeve_result["sleeve_return_pct"])

        cash_weight = max(0.0, 1.0 - invested_weight)
        ending_value = args.portfolio_size * (1.0 + total_return_pct / 100.0)
        one_year_returns.append(total_return_pct)

        formations.append(
            {
                "asof_date": asof_date,
                "portfolio_size": args.portfolio_size,
                "cash_weight": round(cash_weight, 4),
                "one_year_return_pct": round(total_return_pct, 4),
                "ending_value": round(ending_value, 2),
                "sleeves": sleeves_out,
            }
        )

    summary = {
        "study": {
            "name": "valuation_gap_model_portfolio",
            "portfolio_size": args.portfolio_size,
            "start_date": args.start_date,
            "holding_horizon_bars": 252,
            "rebalance_frequency": "monthly_formations",
            "sleeves": [
                {
                    "name": sleeve.name,
                    "cap_tier": sleeve.cap_tier,
                    "valuation_state": sleeve.valuation_state,
                    "side": sleeve.side,
                    "weight": sleeve.weight,
                    "max_names": sleeve.max_names,
                }
                for sleeve in DEFAULT_SLEEVES
            ],
        },
        "results": _summarize_returns(one_year_returns),
        "sample_formations": {
            "first": formations[:3],
            "last": formations[-3:],
        },
        "formation_count": len(formations),
    }

    output_path = Path(args.output_json)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=True), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
