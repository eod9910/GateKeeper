from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.symbol_catalog_db import SymbolCatalogDb


def main() -> int:
    parser = argparse.ArgumentParser(description="Set a manual consumer-cycle classification override for one symbol.")
    parser.add_argument("--symbol", required=True, help="Ticker symbol")
    parser.add_argument("--cycle-bucket", required=True, choices=["highly_cyclical", "mildly_cyclical", "stable"])
    parser.add_argument("--category", required=True, help="Consumer spending category key")
    parser.add_argument("--spend-class", required=True, choices=["durable_goods", "nondurable_goods", "services"])
    parser.add_argument("--demand-bucket", help="Optional broad demand bucket")
    parser.add_argument("--cycle-sensitivity", choices=["defensive", "mildly_cyclical", "cyclical", "highly_cyclical", "neutral"])
    parser.add_argument("--recession-profile", choices=["resilient", "mixed", "vulnerable"])
    parser.add_argument("--macro-regime-preference", choices=["prefer_in_slowdown", "selective_in_slowdown", "neutral_in_slowdown", "avoid_in_slowdown"])
    parser.add_argument("--note", help="Reason for the override")
    args = parser.parse_args()

    db = SymbolCatalogDb()
    db.upsert_classification_override(
        args.symbol,
        domain="consumer_cycle",
        cycle_bucket=args.cycle_bucket,
        demand_bucket=args.demand_bucket,
        spend_class=args.spend_class,
        category=args.category,
        cycle_sensitivity=args.cycle_sensitivity,
        recession_profile=args.recession_profile,
        macro_regime_preference=args.macro_regime_preference,
        note=args.note,
        source="manual_override",
    )
    print(
        f"[ConsumerCycleOverride] {str(args.symbol).strip().upper()}: "
        f"{args.cycle_bucket} / {args.category} / {args.spend_class}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
