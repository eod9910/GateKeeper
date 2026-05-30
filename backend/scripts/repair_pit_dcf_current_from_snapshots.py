#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
DATA_DIR = ROOT / "backend" / "data"
DEFAULT_PIT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_SYMBOL_CATALOG_DB_PATH = DATA_DIR / "symbol-catalog.sqlite"

sys.path.insert(0, str(SERVICES_DIR))

import fundamentals_pit_store as pit_store  # noqa: E402


SOURCE_TYPE = "flattened_snapshot_ttm_repair"


def _norm_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _coerce_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _iso_date(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except Exception:
            continue
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def _load_target_symbols(catalog_db_path: Path, args: argparse.Namespace) -> List[str]:
    if args.symbols:
        return [_norm_symbol(item) for item in args.symbols.split(",") if _norm_symbol(item)]

    clauses = ["valuation_engine_class = 'dcf_operating'"]
    params: List[Any] = []
    if args.only_needs_repair:
        clauses.append(
            """
            EXISTS (
              SELECT 1
              FROM symbol_memberships m
              WHERE m.symbol = symbols.symbol
                AND m.membership_type = 'valuation_data_status'
                AND m.membership_value = 'needs_pit_repair'
            )
            """
        )
    sql = f"SELECT symbol FROM symbols WHERE {' AND '.join(clauses)} ORDER BY symbol"
    with sqlite3.connect(str(catalog_db_path)) as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_norm_symbol(row[0]) for row in rows if _norm_symbol(row[0])]


def _load_raw_payloads(conn: sqlite3.Connection, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for chunk_start in range(0, len(symbols), 800):
        chunk = symbols[chunk_start : chunk_start + 800]
        placeholders = ", ".join("?" for _ in chunk)
        rows = conn.execute(
            f"""
            SELECT symbol, fetched_at_ms, fetched_at_date, payload_json
            FROM raw_source_cache
            WHERE source = 'fundamentals-cache'
              AND symbol IN ({placeholders})
            """,
            tuple(chunk),
        ).fetchall()
        for row in rows:
            symbol = _norm_symbol(row["symbol"])
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                continue
            data = payload.get("data") if isinstance(payload, dict) else None
            if isinstance(data, dict):
                out[symbol] = {
                    "symbol": symbol,
                    "fetched_at_ms": row["fetched_at_ms"],
                    "fetched_at_date": row["fetched_at_date"],
                    "payload": payload,
                    "data": data,
                }
    return out


def _quarterly_rows(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    block = data.get("historicalStatements") or {}
    rows = block.get("quarterly") if isinstance(block, dict) else None
    if not isinstance(rows, list):
        return []
    clean_rows = [row for row in rows if isinstance(row, dict)]
    return sorted(clean_rows, key=lambda item: str(item.get("periodEnd") or item.get("period") or ""), reverse=True)


def _latest_quarter_value(rows: Sequence[Dict[str, Any]], metric: str) -> Optional[float]:
    for row in rows:
        metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
        value = _coerce_float(metrics.get(metric))
        if value is not None:
            return value
    return None


def _sum_recent_quarters(rows: Sequence[Dict[str, Any]], metric: str, count: int = 4) -> Optional[float]:
    values: List[float] = []
    for row in rows:
        metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
        value = _coerce_float(metrics.get(metric))
        if value is None:
            continue
        values.append(value)
        if len(values) >= count:
            break
    if len(values) < count:
        return None
    return sum(values)


def _statement_anchor(data: Dict[str, Any], raw: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    rows = _quarterly_rows(data)
    for row in rows:
        period_end = _iso_date(row.get("periodEnd"))
        available_at = _iso_date(row.get("availableAt"))
        if period_end and available_at:
            return period_end, available_at
    available_at = _iso_date(data.get("lastEarningsDate")) or _iso_date(raw.get("fetched_at_date"))
    return available_at, available_at


def _insert_statement(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    fact_key: str,
    value: float,
    period_end: str,
    available_at: str,
    source_path: str,
    evidence: Dict[str, Any],
    confidence: float,
) -> bool:
    return pit_store._insert_statement_fact(
        conn,
        symbol=symbol,
        fact_key=fact_key,
        value=value,
        fact_origin="derived" if fact_key == "free_cash_flow" else "reported",
        unit="currency",
        scale="ones",
        currency="USD",
        period_type="annual",
        period_end=period_end,
        fiscal_year=pit_store._fiscal_year_for_period(period_end, "annual"),
        fiscal_quarter=None,
        filing_date=available_at,
        available_at=available_at,
        source_type=SOURCE_TYPE,
        source_document=f"{symbol}:{available_at}:current_snapshot_ttm",
        evidence_ref=json.dumps(evidence, ensure_ascii=True, sort_keys=True),
        confidence=confidence,
        source_path=source_path,
    )


def _insert_shares(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    value: float,
    period_end: str,
    available_at: str,
    source_path: str,
) -> bool:
    return pit_store._insert_fundamental_fact(
        conn,
        symbol=symbol,
        metric="sharesOutstanding",
        value=value,
        classification="capital_structure",
        period_type="instant",
        period_end=period_end,
        published_at=available_at,
        available_at=available_at,
        availability_basis="flattened_snapshot_repair",
        source=SOURCE_TYPE,
        source_path=source_path,
        fetched_at_ms=None,
    )


def repair_symbol(conn: sqlite3.Connection, raw: Dict[str, Any]) -> Dict[str, Any]:
    symbol = raw["symbol"]
    data = raw["data"]
    rows = _quarterly_rows(data)
    period_end, available_at = _statement_anchor(data, raw)
    result = {
        "symbol": symbol,
        "status": "skipped",
        "statement_rows": 0,
        "fundamental_rows": 0,
        "period_end": period_end,
        "available_at": available_at,
        "facts": [],
    }
    if not period_end or not available_at:
        result["reason"] = "missing_statement_anchor"
        return result

    revenue = _coerce_float(data.get("annualRevenue"))
    revenue_source = "annualRevenue"
    revenue_confidence = 0.75
    if revenue is None:
        revenue = _sum_recent_quarters(rows, "revenue")
        revenue_source = "historicalStatements.quarterly.revenue.sum_last_4"
        revenue_confidence = 0.68

    free_cash_flow = _coerce_float(data.get("freeCashFlowTTM"))
    fcf_source = "freeCashFlowTTM"
    fcf_confidence = 0.72
    if free_cash_flow is None:
        free_cash_flow = _latest_quarter_value(rows, "freeCashFlowTTM")
        fcf_source = "historicalStatements.quarterly.freeCashFlowTTM.latest"
        fcf_confidence = 0.68

    operating_cash_flow = _coerce_float(data.get("operatingCashFlowTTM"))
    ocf_source = "operatingCashFlowTTM"
    if operating_cash_flow is None:
        operating_cash_flow = _latest_quarter_value(rows, "operatingCashFlowTTM")
        ocf_source = "historicalStatements.quarterly.operatingCashFlowTTM.latest"

    shares = _coerce_float(data.get("sharesOutstanding"))
    shares_source = "sharesOutstanding"
    if shares is None:
        shares = _latest_quarter_value(rows, "sharesOutstanding")
        shares_source = "historicalStatements.quarterly.sharesOutstanding.latest"

    for fact_key, value, source_path, confidence in (
        ("revenue", revenue, revenue_source, revenue_confidence),
        ("free_cash_flow", free_cash_flow, fcf_source, fcf_confidence),
        ("operating_cash_flow", operating_cash_flow, ocf_source, 0.72),
    ):
        if value is None:
            continue
        inserted = _insert_statement(
            conn,
            symbol=symbol,
            fact_key=fact_key,
            value=value,
            period_end=period_end,
            available_at=available_at,
            source_path=source_path,
            evidence={
                "kind": SOURCE_TYPE,
                "symbol": symbol,
                "source_path": source_path,
                "period_end": period_end,
                "available_at": available_at,
                "note": "Current flattened snapshot materialized for DCF eligibility; not SEC companyfacts.",
            },
            confidence=confidence,
        )
        result["statement_rows"] += int(inserted)
        result["facts"].append(fact_key)

    if shares is not None:
        inserted = _insert_shares(
            conn,
            symbol=symbol,
            value=shares,
            period_end=period_end,
            available_at=available_at,
            source_path=shares_source,
        )
        result["fundamental_rows"] += int(inserted)

    if result["statement_rows"] or result["fundamental_rows"]:
        result["status"] = "repaired"
    else:
        result["reason"] = "no_repairable_snapshot_values"
    return result


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair current DCF PIT readiness from flattened fundamentals snapshots.")
    parser.add_argument("--pit-db-path", default=str(DEFAULT_PIT_DB_PATH))
    parser.add_argument("--symbol-catalog-db-path", default=str(DEFAULT_SYMBOL_CATALOG_DB_PATH))
    parser.add_argument("--symbols", default="", help="Comma-separated symbol override")
    parser.add_argument("--only-needs-repair", action="store_true", default=True)
    parser.add_argument("--all-dcf", action="store_false", dest="only_needs_repair")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    pit_db_path = Path(args.pit_db_path)
    symbols = _load_target_symbols(Path(args.symbol_catalog_db_path), args)
    conn = pit_store.connect(pit_db_path)
    pit_store.ensure_schema(conn)
    raw_payloads = _load_raw_payloads(conn, symbols)

    results: List[Dict[str, Any]] = []
    for symbol in symbols:
        raw = raw_payloads.get(symbol)
        if not raw:
            results.append({"symbol": symbol, "status": "skipped", "reason": "no_raw_snapshot"})
            continue
        if args.dry_run:
            results.append({"symbol": symbol, "status": "would_repair"})
            continue
        results.append(repair_symbol(conn, raw))
    if not args.dry_run:
        conn.commit()
    conn.close()

    repaired = sum(1 for item in results if item.get("status") == "repaired")
    skipped = len(results) - repaired
    statement_rows = sum(int(item.get("statement_rows") or 0) for item in results)
    fundamental_rows = sum(int(item.get("fundamental_rows") or 0) for item in results)
    summary = {
        "requested_symbols": len(symbols),
        "raw_snapshots": len(raw_payloads),
        "repaired_symbols": repaired,
        "skipped_symbols": skipped,
        "statement_rows": statement_rows,
        "fundamental_rows": fundamental_rows,
        "skipped_reasons": {},
    }
    reasons: Dict[str, int] = {}
    for item in results:
        if item.get("status") == "repaired":
            continue
        reason = str(item.get("reason") or item.get("status") or "unknown")
        reasons[reason] = reasons.get(reason, 0) + 1
    summary["skipped_reasons"] = reasons
    print(json.dumps(summary, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
