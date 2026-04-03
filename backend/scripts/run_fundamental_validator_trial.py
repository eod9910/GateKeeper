#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
sys.path.insert(0, str(SERVICES_DIR))

from universe_registry import resolve_universe_path  # noqa: E402
from validatorPipeline import run_pipeline  # noqa: E402


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a validator trial with PIT fundamentals enabled.")
    parser.add_argument(
        "--strategy",
        default=str(ROOT / "backend" / "data" / "strategies" / "sma_50_200_benchmark_v1.json"),
        help="Path to strategy JSON",
    )
    parser.add_argument(
        "--universe-file",
        default=str(
            resolve_universe_path("validation_tier1_stocks")
            or (ROOT / "backend" / "data" / "validation_tier1_mixed_cap.json")
        ),
        help="Path to universe JSON",
    )
    parser.add_argument("--date-start", default="2018-01-01")
    parser.add_argument("--date-end", default="2026-03-21")
    parser.add_argument("--tier", default="tier1")
    parser.add_argument("--metric", default="operatingMarginPct")
    parser.add_argument("--label", default="Operating Margin %")
    parser.add_argument("--operator", default=">=")
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--rebalance-frequency", default="monthly")
    parser.add_argument("--forward-bars", type=int, default=1)
    parser.add_argument("--min-selected-count", type=int, default=5)
    parser.add_argument("--min-excluded-count", type=int, default=5)
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    strategy = _load_json(Path(args.strategy))
    universe_payload = _load_json(Path(args.universe_file))
    universe = list(universe_payload.get("symbols") or [])

    strategy["universe"] = universe
    strategy["fundamental_config"] = {
        "enabled": True,
        "rebalance_frequency": args.rebalance_frequency,
        "forward_bars": args.forward_bars,
        "min_selected_count": args.min_selected_count,
        "min_excluded_count": args.min_excluded_count,
        "variables": [
            {
                "metric": args.metric,
                "label": args.label,
                "operator": args.operator,
                "threshold": args.threshold,
            }
        ],
    }

    result = run_pipeline(
        strategy,
        args.date_start,
        args.date_end,
        universe=universe,
        validation_tier=args.tier,
        force_refresh=bool(args.force_refresh),
    )
    report = result["report"]
    summary = {
        "strategy_version_id": report.get("strategy_version_id"),
        "universe_size": len(report.get("config", {}).get("universe") or []),
        "date_start": report.get("config", {}).get("date_start"),
        "date_end": report.get("config", {}).get("date_end"),
        "trades_summary": report.get("trades_summary"),
        "pass_fail": report.get("pass_fail"),
        "pass_fail_reasons": report.get("pass_fail_reasons"),
        "fundamental_validation": report.get("fundamental_validation"),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
