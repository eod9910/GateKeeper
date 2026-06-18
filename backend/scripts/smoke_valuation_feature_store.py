#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from valuation_feature_store import ensure_valuation_feature_schema, get_valuation_features


def main() -> None:
    ensure_valuation_feature_schema()
    sample = get_valuation_features(
        "AAPL",
        "2024-04-30",
        168.7938690185547,
        prefer_persisted=False,
        persist=False,
    )
    if not sample or sample.get("valuation_gap_pct") is None or not sample.get("valuation_state"):
        raise SystemExit("valuation feature smoke failed")
    print(json.dumps(sample, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
