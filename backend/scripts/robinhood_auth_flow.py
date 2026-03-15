from __future__ import annotations

import json
import sys
from pathlib import Path


SERVICES_DIR = Path(__file__).resolve().parents[1] / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

import robinhoodAuthFlow  # noqa: E402


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        action = str(payload.get("action") or "").strip().lower()
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}

        if action == "start":
            data = robinhoodAuthFlow.start_login(config)
        elif action == "status":
            data = robinhoodAuthFlow.check_login_status(config)
        elif action == "verify":
            data = robinhoodAuthFlow.verify_code(config)
        elif action == "positions":
            data = robinhoodAuthFlow.fetch_positions(config)
        else:
            raise RuntimeError(f"Unsupported Robinhood auth action: {action or 'missing'}")

        print(json.dumps({"success": True, "data": data}, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
