#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"

if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from ledger_hydration_jobs import LedgerHydrationJobManager, LedgerSyncJobOptions  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync Ledger filing coverage to the canonical universe by hydrating eligible symbols missing filing PIT coverage."
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional max number of symbols to hydrate.")
    parser.add_argument("--annual-count", type=int, default=1, help="Recent annual filing count per symbol.")
    parser.add_argument("--quarterly-count", type=int, default=2, help="Recent quarterly filing count per symbol.")
    parser.add_argument("--current-count", type=int, default=6, help="Recent current-report filing count per symbol.")
    parser.add_argument("--symbols", nargs="*", help="Optional explicit symbols to sync instead of auto-discovering gaps.")
    parser.add_argument("--dry-run", action="store_true", help="List candidate symbols without hydrating them.")
    parser.add_argument("--write-report", action="store_true", help="Write a JSON report under backend/data/research.")
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, min(3, os.cpu_count() or 1)),
        help="Number of symbols to hydrate in parallel. Defaults to a conservative value to avoid DB contention.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manager = LedgerHydrationJobManager(root=ROOT)
    payload = manager.run_sync_job(
        LedgerSyncJobOptions(
            limit=int(args.limit or 0),
            annual_count=max(0, args.annual_count),
            quarterly_count=max(0, args.quarterly_count),
            current_count=max(0, args.current_count),
            symbols=list(args.symbols or []),
            dry_run=bool(args.dry_run),
            write_report=bool(args.write_report),
            workers=max(1, int(args.workers or 1)),
        ),
        emit_progress=lambda message: print(message, flush=True),
    )
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
