#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
sys.path.insert(0, str(SERVICES_DIR))

from validatorPipeline import run_pipeline  # noqa: E402


def main() -> None:
    strategy_path = ROOT / "backend" / "data" / "strategies" / "sma_50_200_benchmark_v1.json"
    with strategy_path.open("r", encoding="utf-8") as handle:
        spec = json.load(handle)

    universe = ["A", "AACB", "AADR", "AAL"]
    spec["universe"] = universe
    spec["fundamental_config"] = {
        "enabled": True,
        "rebalance_frequency": "monthly",
        "forward_bars": 13,
        "min_selected_count": 1,
        "min_excluded_count": 1,
        "variables": [
            {
                "metric": "operatingMarginPct",
                "label": "Operating Margin %",
                "operator": ">=",
                "threshold": 5.0,
            }
        ],
    }

    result = run_pipeline(
        spec,
        "2018-01-01",
        "2026-03-01",
        universe=universe,
        validation_tier="tier1",
        force_refresh=False,
    )
    report = result["report"]
    summary = {
        "strategy_version_id": report.get("strategy_version_id"),
        "universe": report.get("config", {}).get("universe"),
        "trades_summary": report.get("trades_summary"),
        "pass_fail": report.get("pass_fail"),
        "pass_fail_reasons": report.get("pass_fail_reasons"),
        "fundamental_validation": report.get("fundamental_validation"),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
