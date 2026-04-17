from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.symbol_catalog_db import SymbolCatalogDb, SYMBOL_CATALOG_DB_PATH

DEFAULT_INPUT_PATH = ROOT / "backend" / "data" / "research" / "valuation_universe_snapshot.json"

VALUATION_MEMBERSHIP_TYPES = (
    "valuation_state",
    "valuation_quality_grade",
    "valuation_coverage_mode",
)

VALUATION_METRIC_FIELDS = {
    "valuation_price": "price",
    "valuation_fair_value_low": "fair_value_low",
    "valuation_fair_value_mid": "fair_value_mid",
    "valuation_fair_value_high": "fair_value_high",
    "valuation_gap_pct": "valuation_gap_pct",
    "valuation_market_cap": "market_cap",
    "valuation_enterprise_value": "enterprise_value",
    "valuation_enterprise_to_sales": "enterprise_to_sales",
    "valuation_revenue": "revenue",
    "valuation_free_cash_flow": "free_cash_flow",
    "valuation_shares_outstanding": "shares_outstanding",
    "valuation_revenue_growth_pct": "revenue_growth_pct",
    "valuation_operating_margin_pct": "operating_margin_pct",
    "valuation_free_cash_flow_margin_pct": "free_cash_flow_margin_pct",
    "valuation_current_ratio": "current_ratio",
    "valuation_quality_score": "quality_score",
}


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def clear_existing_valuation_rows(db_path: Path) -> None:
    with sqlite3.connect(db_path) as conn:
        placeholders = ", ".join("?" for _ in VALUATION_MEMBERSHIP_TYPES)
        conn.execute(
            f"DELETE FROM symbol_memberships WHERE membership_type IN ({placeholders})",
            tuple(VALUATION_MEMBERSHIP_TYPES),
        )
        metric_placeholders = ", ".join("?" for _ in VALUATION_METRIC_FIELDS)
        conn.execute(
            f"DELETE FROM symbol_metrics WHERE metric_name IN ({metric_placeholders})",
            tuple(VALUATION_METRIC_FIELDS.keys()),
        )
        conn.commit()


def build_membership_rows(rows: Iterable[Dict[str, Any]], as_of: str | None, source: str) -> List[Dict[str, Any]]:
    memberships: List[Dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        valuation_state = str(row.get("valuation_state") or "").strip().lower()
        quality_grade = str(row.get("quality_grade") or "").strip().lower()
        coverage_mode = str(row.get("coverage_mode") or "").strip().lower()
        if valuation_state:
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "valuation_state",
                    "membership_value": valuation_state,
                    "source": source,
                    "as_of": as_of,
                    "payload": row,
                }
            )
        if quality_grade:
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "valuation_quality_grade",
                    "membership_value": quality_grade,
                    "source": source,
                    "as_of": as_of,
                    "payload": row,
                }
            )
        if coverage_mode:
            memberships.append(
                {
                    "symbol": symbol,
                    "membership_type": "valuation_coverage_mode",
                    "membership_value": coverage_mode,
                    "source": source,
                    "as_of": as_of,
                    "payload": row,
                }
            )
    return memberships


def build_metric_rows(rows: Iterable[Dict[str, Any]], as_of: str | None, source: str) -> List[Dict[str, Any]]:
    metrics: List[Dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        for metric_name, field_name in VALUATION_METRIC_FIELDS.items():
            raw_value = row.get(field_name)
            if raw_value is None:
                continue
            try:
                metric_value_num = float(raw_value)
            except Exception:
                continue
            metrics.append(
                {
                    "symbol": symbol,
                    "metric_name": metric_name,
                    "metric_value_num": metric_value_num,
                    "source": source,
                    "as_of": as_of,
                    "payload": row,
                }
            )
    return metrics


def sync_snapshot(payload: Dict[str, Any], *, db_path: Path = SYMBOL_CATALOG_DB_PATH, source: str = "valuation_universe_snapshot.json") -> Dict[str, int]:
    rows = payload.get("rows") or []
    as_of = str((payload.get("meta") or {}).get("generated_at") or "").strip() or None
    db_root = db_path.resolve().parents[2]
    db = SymbolCatalogDb(root=db_root)
    clear_existing_valuation_rows(db_path)

    symbol_rows = []
    for row in rows:
        symbol = normalize_symbol((row or {}).get("symbol"))
        if not symbol:
            continue
        symbol_rows.append(
            {
                "symbol": symbol,
                "asset_class": "stocks",
                "source": {"source": source},
            }
        )

    memberships = build_membership_rows(rows, as_of, source)
    metrics = build_metric_rows(rows, as_of, source)

    db.bulk_upsert_symbols(symbol_rows)
    db.bulk_upsert_memberships(memberships)
    db.bulk_upsert_metrics(metrics)

    return {
        "symbols": len(symbol_rows),
        "memberships": len(memberships),
        "metrics": len(metrics),
    }


def parse_args(argv: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync valuation_universe_snapshot.json into symbol-catalog.sqlite")
    parser.add_argument("--input", default=str(DEFAULT_INPUT_PATH), help="Path to valuation_universe_snapshot.json")
    parser.add_argument("--db", default=str(SYMBOL_CATALOG_DB_PATH), help="Path to symbol-catalog.sqlite")
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
    args = parse_args(argv)
    input_path = Path(args.input).resolve()
    db_path = Path(args.db).resolve()
    payload = load_json(input_path)
    counts = sync_snapshot(payload, db_path=db_path, source=input_path.name)
    print(
        json.dumps(
            {
                "input": str(input_path),
                "db_path": str(db_path),
                **counts,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
