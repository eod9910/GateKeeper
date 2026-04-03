#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from fundamentals_pit_store import DEFAULT_DB_PATH, build_store_from_cache  # noqa: E402


def main() -> None:
    cache_dir = ROOT / "data" / "fundamentals-cache"
    result = build_store_from_cache(cache_dir=cache_dir, db_path=DEFAULT_DB_PATH)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
