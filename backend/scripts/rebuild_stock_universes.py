#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "backend" / "scripts"


def run_step(args: list[str]) -> None:
    cmd = [sys.executable, *args]
    print(f"> {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rebuild canonical stock-universe artifacts from the shared universe machinery."
    )
    parser.add_argument(
        "--refresh-clean",
        action="store_true",
        help="Rebuild universe_clean.json and index universes from upstream sources first.",
    )
    parser.add_argument(
        "--refresh-market-cap",
        action="store_true",
        help="Refresh market_cap_snapshot.json and cap tier files before rebuilding mixed-cap tiers.",
    )
    parser.add_argument(
        "--skip-regimes",
        action="store_true",
        help="Skip regime-universe rebuild.",
    )
    parser.add_argument(
        "--regime-interval",
        default="1d",
        help="Interval for regime rebuild (default: 1d).",
    )
    parser.add_argument(
        "--regime-limit",
        type=int,
        default=0,
        help="Optional regime rebuild symbol limit for faster spot checks.",
    )
    parser.add_argument(
        "--market-cap-top",
        type=int,
        default=500,
        help="Tier file size when refreshing market-cap buckets (default: 500).",
    )
    parser.add_argument(
        "--market-cap-delay",
        type=float,
        default=0.3,
        help="Delay between market-cap requests when refreshing (default: 0.3s).",
    )
    parsed = parser.parse_args()

    if parsed.refresh_clean:
        run_step([str(SCRIPTS_DIR / "build_clean_universe.py")])

    if parsed.refresh_market_cap:
        run_step([
            str(SCRIPTS_DIR / "build_large_cap_universe.py"),
            "--top",
            str(parsed.market_cap_top),
            "--delay",
            str(parsed.market_cap_delay),
            "--resume",
        ])

    run_step([str(SCRIPTS_DIR / "build_ledger_filing_eligible_universe.py")])
    run_step([str(SCRIPTS_DIR / "enrich_canonical_universe.py")])

    run_step([str(SCRIPTS_DIR / "build_mixed_cap_validation_ladder.py")])
    run_step([str(SCRIPTS_DIR / "build_universe_valuation_snapshot.py")])
    run_step([str(SCRIPTS_DIR / "build_valuation_regime_universes.py")])

    if not parsed.skip_regimes:
        regime_args = [
            str(SCRIPTS_DIR / "build_regime_universes.py"),
            "--interval",
            str(parsed.regime_interval),
        ]
        if parsed.regime_limit > 0:
            regime_args.extend(["--limit", str(parsed.regime_limit)])
        run_step(regime_args)

    print("Stock universe rebuild complete.", flush=True)


if __name__ == "__main__":
    main()

