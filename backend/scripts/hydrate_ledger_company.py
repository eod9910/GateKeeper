#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"

if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from ledger_hydration import HydrationOptions, LedgerHydrationCoordinator  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hydrate one company into Ledger coverage.")
    parser.add_argument("--symbol", required=True, help="Ticker symbol to hydrate.")
    parser.add_argument("--annual-count", type=int, default=1, help="Recent 10-K count to fetch through Docling probe.")
    parser.add_argument("--quarterly-count", type=int, default=2, help="Recent 10-Q count to fetch through Docling probe.")
    parser.add_argument("--current-count", type=int, default=6, help="Recent 8-K count to fetch through Docling probe.")
    parser.add_argument("--skip-sec", action="store_true", help="Skip SEC filing hydration.")
    parser.add_argument("--skip-snapshot", action="store_true", help="Skip fundamentals snapshot hydration.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    coordinator = LedgerHydrationCoordinator(root=ROOT)
    summary = coordinator.hydrate_symbol(
        args.symbol,
        HydrationOptions(
            annual_count=max(0, args.annual_count),
            quarterly_count=max(0, args.quarterly_count),
            current_count=max(0, args.current_count),
            skip_sec=bool(args.skip_sec),
            skip_snapshot=bool(args.skip_snapshot),
        ),
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
