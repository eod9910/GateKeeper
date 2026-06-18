#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_CATALOG_DB = DATA_DIR / "symbol-catalog.sqlite"
DEFAULT_OUTPUT = DATA_DIR / "research" / "valuation_coverage_audit.json"


def _rows(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(query, params).fetchall()]


def audit_catalog(db_path: Path, universe: str) -> Dict[str, Any]:
    conn = sqlite3.connect(str(db_path))
    try:
        rows = _rows(
            conn,
            """
            SELECT
              s.symbol,
              s.name,
              COALESCE(s.company_type, 'N/A') AS company_type,
              COALESCE(s.valuation_engine_class, 'N/A') AS valuation_engine_class,
              CASE WHEN EXISTS (
                SELECT 1 FROM symbol_metrics m
                WHERE m.symbol = s.symbol
                  AND m.metric_name IN ('valuation_fair_value_mid', 'valuation_gap_pct')
              ) THEN 1 ELSE 0 END AS has_valuation
            FROM symbols s
            JOIN symbol_memberships u
              ON u.symbol = s.symbol
             AND u.membership_type = 'universe'
             AND u.membership_value = ?
            WHERE s.active = 1
              AND s.asset_class = 'stocks'
            ORDER BY s.symbol
            """,
            (universe,),
        )
    finally:
        conn.close()

    total = len(rows)
    valued = [row for row in rows if int(row.get("has_valuation") or 0) == 1]
    missing = [row for row in rows if int(row.get("has_valuation") or 0) != 1]
    by_engine = Counter(
        f"{row.get('company_type') or 'N/A'} / {row.get('valuation_engine_class') or 'N/A'}"
        for row in missing
    )
    coverage_pct = (len(valued) / total * 100.0) if total else 0.0
    return {
        "meta": {
            "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "db_path": str(db_path),
            "universe": universe,
            "total": total,
            "valued": len(valued),
            "missing": len(missing),
            "coverage_pct": round(coverage_pct, 4),
            "missing_by_type_engine": dict(by_engine),
        },
        "missing": missing,
    }


def parse_args(argv: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit valuation coverage for a catalog universe")
    parser.add_argument("--db", default=str(DEFAULT_CATALOG_DB), help="Path to symbol-catalog.sqlite")
    parser.add_argument("--universe", default="clean", help="symbol_memberships universe value to audit")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON report path")
    parser.add_argument("--min-coverage-pct", type=float, default=80.0, help="Fail if coverage is below this percentage")
    parser.add_argument("--allow-low-coverage", action="store_true", help="Do not fail below --min-coverage-pct")
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
    args = parse_args(argv)
    db_path = Path(args.db).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report = audit_catalog(db_path, str(args.universe or "clean"))
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    meta = report["meta"]
    print(
        f"[ValuationCoverage] {meta['universe']}: {meta['valued']}/{meta['total']} valued "
        f"({meta['coverage_pct']:.2f}%), missing {meta['missing']}",
        flush=True,
    )
    print(f"[ValuationCoverage] wrote {output_path}", flush=True)
    if not args.allow_low_coverage and float(meta["coverage_pct"]) < float(args.min_coverage_pct):
        print(
            f"[ValuationCoverage] ERROR: coverage {meta['coverage_pct']:.2f}% is below required {float(args.min_coverage_pct):.2f}%",
            flush=True,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
