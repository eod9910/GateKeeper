#!/usr/bin/env python3
"""Build a static family explorer HTML report from existing research artifacts."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from research_v1.explorer import build_family_explorer_html  # noqa: E402


OUTPUT_DIR = ROOT / "data" / "research" / "atr_pivot_v1"
OUTPUT_PATH = OUTPUT_DIR / "etf_1d_10y_family_explorer.html"
SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"]


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    result = build_family_explorer_html(
        base_dir=OUTPUT_DIR,
        output_path=OUTPUT_PATH,
        symbols=SYMBOLS,
        timeframe="1d",
        period="10y",
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
