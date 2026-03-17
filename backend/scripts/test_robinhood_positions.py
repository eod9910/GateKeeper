from __future__ import annotations

import json
import sys
from pathlib import Path


SERVICES_DIR = Path(__file__).resolve().parents[1] / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

import robinhoodService  # noqa: E402


def main() -> int:
    try:
        snapshot = robinhoodService.fetch_positions_snapshot()
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, indent=2))
        return 1

    print(json.dumps({"success": True, "data": snapshot}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
