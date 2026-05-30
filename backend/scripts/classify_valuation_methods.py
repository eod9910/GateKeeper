#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
DATA_DIR = BACKEND_DIR / "data"
SERVICES_DIR = BACKEND_DIR / "services"
DEFAULT_PIT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_SYMBOL_CATALOG_DB_PATH = DATA_DIR / "symbol-catalog.sqlite"
DEFAULT_OUTPUT_DIR = DATA_DIR / "research"

sys.path.insert(0, str(SERVICES_DIR))

from symbol_catalog_db import SymbolCatalogDb, classify_company_from_snapshot  # noqa: E402
from universe_registry import load_universe_symbols  # noqa: E402


DCF_FACT_KEYS = (
    "revenue",
    "operating_cash_flow",
    "capital_expenditures",
    "free_cash_flow",
)

ETF_TOKENS = (
    " etf",
    " exchange traded",
    " exchange-traded",
    " fund",
    " trust",
    " ishares",
    " spdr",
    " vanguard",
    " invesco",
    " proshares",
    " direxion",
    " wisdomtree",
    " global x",
    " select sector",
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _dedupe_symbols(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        symbol = _norm_symbol(value)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out


def _load_symbols(args: argparse.Namespace) -> List[str]:
    if args.symbols:
        symbols = _dedupe_symbols(args.symbols.split(","))
    else:
        symbols = _dedupe_symbols(load_universe_symbols(args.universe))
    if args.limit and args.limit > 0:
        return symbols[: args.limit]
    return symbols


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _load_raw_snapshots(pit_db_path: Path, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    if not pit_db_path.exists() or not symbols:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    with _connect(pit_db_path) as conn:
        for chunk_start in range(0, len(symbols), 800):
            chunk = symbols[chunk_start : chunk_start + 800]
            placeholders = ", ".join("?" for _ in chunk)
            rows = conn.execute(
                f"""
                SELECT symbol, payload_json
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
                    out[symbol] = data
    return out


def _pit_dcf_failure_reason(conn: sqlite3.Connection, symbol: str, as_of_date: str) -> Optional[str]:
    fact_row = conn.execute(
        """
        SELECT 1
        FROM pit_fundamental_facts
        WHERE symbol = ? AND available_at <= ?
        LIMIT 1
        """,
        (symbol, as_of_date),
    ).fetchone()
    market_row = conn.execute(
        """
        SELECT 1
        FROM pit_market_facts
        WHERE symbol = ? AND market_date <= ?
        LIMIT 1
        """,
        (symbol, as_of_date),
    ).fetchone()
    if fact_row is None and market_row is None:
        return "no_asof_snapshot"

    shares_row = conn.execute(
        """
        SELECT 1
        FROM pit_fundamental_facts
        WHERE symbol = ? AND metric = 'sharesOutstanding' AND available_at <= ?
        LIMIT 1
        """,
        (symbol, as_of_date),
    ).fetchone()
    if shares_row is None:
        return "missing_shares_outstanding"

    rows = conn.execute(
        """
        SELECT fact_key, period_end, value_numeric
        FROM pit_statement_facts
        WHERE symbol = ?
          AND available_at <= ?
          AND period_type = 'annual'
          AND fact_key IN ('revenue', 'operating_cash_flow', 'capital_expenditures', 'free_cash_flow')
        ORDER BY period_end DESC, available_at DESC
        """,
        (symbol, as_of_date),
    ).fetchall()
    if not rows:
        return "no_annual_statement_facts"

    latest_period = str(rows[0]["period_end"] or "")
    latest_metrics = {
        str(row["fact_key"]): row["value_numeric"]
        for row in rows
        if str(row["period_end"] or "") == latest_period and row["value_numeric"] is not None
    }
    if latest_metrics.get("revenue") is None:
        return "missing_annual_revenue"
    has_fcf = latest_metrics.get("free_cash_flow") is not None
    has_ocf_capex = latest_metrics.get("operating_cash_flow") is not None and latest_metrics.get("capital_expenditures") is not None
    if not has_fcf and not has_ocf_capex:
        return "missing_fcf_and_ocf_capex"
    return None


def _load_pit_dcf_readiness(pit_db_path: Path, symbols: Sequence[str], as_of_date: str) -> Dict[str, Optional[str]]:
    if not pit_db_path.exists():
        return {symbol: "pit_database_missing" for symbol in symbols}
    out: Dict[str, Optional[str]] = {}
    with _connect(pit_db_path) as conn:
        for symbol in symbols:
            out[symbol] = _pit_dcf_failure_reason(conn, symbol, as_of_date)
    return out


def _is_fund_or_etf(symbol: str, snapshot: Dict[str, Any], catalog_row: Dict[str, Any]) -> bool:
    quote_type = str(snapshot.get("quoteType") or snapshot.get("quote_type") or "").strip().lower()
    if quote_type in {"etf", "mutualfund", "index"}:
        return True
    haystack = " ".join(
        str(value or "")
        for value in (
            symbol,
            snapshot.get("companyName"),
            snapshot.get("name"),
            snapshot.get("longName"),
            snapshot.get("shortName"),
            snapshot.get("fundFamily"),
            snapshot.get("category"),
            catalog_row.get("name"),
            catalog_row.get("sec_name"),
            catalog_row.get("industry"),
            catalog_row.get("sector"),
        )
    ).lower()
    return any(token in f" {haystack}" for token in ETF_TOKENS)


def _unsupported_classification(reason: str, confidence: float = 0.9) -> Dict[str, Any]:
    return {
        "company_type": reason,
        "valuation_engine_class": "unsupported",
        "classification_source": "valuation_method_classifier",
        "classification_confidence": confidence,
    }


def _classify_symbol(symbol: str, snapshot: Dict[str, Any], catalog_row: Dict[str, Any]) -> Dict[str, Any]:
    if _is_fund_or_etf(symbol, snapshot, catalog_row):
        return _unsupported_classification("fund_or_etf", 0.95)

    if not snapshot:
        return _unsupported_classification("no_fundamental_source", 0.9)

    seed_snapshot = {
        **snapshot,
        "name": snapshot.get("name") or catalog_row.get("name"),
        "sec_name": snapshot.get("sec_name") or catalog_row.get("sec_name"),
        "sector": snapshot.get("sector") or catalog_row.get("sector"),
        "industry": snapshot.get("industry") or catalog_row.get("industry"),
    }
    classification = classify_company_from_snapshot(seed_snapshot)
    if classification:
        return classification

    return _unsupported_classification("no_fundamental_source", 0.85)


def _delete_classification_memberships(db_path: Path, symbols: Sequence[str]) -> None:
    if not symbols:
        return
    with sqlite3.connect(str(db_path)) as conn:
        for chunk_start in range(0, len(symbols), 800):
            chunk = symbols[chunk_start : chunk_start + 800]
            placeholders = ", ".join("?" for _ in chunk)
            conn.execute(
                f"""
                DELETE FROM symbol_memberships
                WHERE membership_type IN (
                    'company_type',
                    'valuation_engine_class',
                    'valuation_data_status',
                    'valuation_data_reason'
                )
                  AND symbol IN ({placeholders})
                """,
                tuple(chunk),
            )
        conn.commit()


def classify_universe(args: argparse.Namespace) -> Dict[str, Any]:
    symbols = _load_symbols(args)
    catalog = SymbolCatalogDb(root=ROOT)
    raw_snapshots = _load_raw_snapshots(Path(args.pit_db_path), symbols)
    dcf_readiness = _load_pit_dcf_readiness(Path(args.pit_db_path), symbols, args.as_of_date)
    now = _utc_now_iso()

    symbol_rows: List[Dict[str, Any]] = []
    membership_rows: List[Dict[str, Any]] = []
    classified_rows: List[Dict[str, Any]] = []
    engine_counts: Counter[str] = Counter()
    company_type_counts: Counter[str] = Counter()
    data_status_counts: Counter[str] = Counter()
    examples: Dict[str, List[str]] = defaultdict(list)

    for symbol in symbols:
        catalog_row = catalog.get_symbol(symbol) or {"symbol": symbol, "asset_class": "stocks"}
        snapshot = raw_snapshots.get(symbol) or {}
        classification = _classify_symbol(symbol, snapshot, catalog_row)
        company_type = str(classification.get("company_type") or "no_fundamental_source")
        engine_class = str(classification.get("valuation_engine_class") or "unsupported")
        source = str(classification.get("classification_source") or "valuation_method_classifier")
        confidence = classification.get("classification_confidence")
        data_reason = ""
        if engine_class == "dcf_operating":
            data_reason = str(dcf_readiness.get(symbol) or "")
            data_status = "ready" if not data_reason else "needs_pit_repair"
        elif engine_class == "unsupported":
            data_status = "unsupported"
            data_reason = company_type
        else:
            data_status = "method_specific"

        row = {
            "symbol": symbol,
            "name": catalog_row.get("name") or snapshot.get("companyName") or snapshot.get("name"),
            "sector": classification.get("sector") or catalog_row.get("sector") or snapshot.get("sector"),
            "industry": classification.get("industry") or catalog_row.get("industry") or snapshot.get("industry"),
            "company_type": company_type,
            "valuation_engine_class": engine_class,
            "classification_source": source,
            "classification_confidence": confidence,
            "valuation_data_status": data_status,
            "valuation_data_reason": data_reason,
            "has_raw_fundamentals_snapshot": symbol in raw_snapshots,
            "has_sec_mapping": catalog_row.get("has_sec_mapping"),
            "cik": catalog_row.get("cik"),
        }
        classified_rows.append(row)
        engine_counts[engine_class] += 1
        company_type_counts[company_type] += 1
        data_status_counts[data_status] += 1
        if len(examples[engine_class]) < 20:
            examples[engine_class].append(symbol)

        symbol_rows.append(
            {
                "symbol": symbol,
                "asset_class": catalog_row.get("asset_class") or "stocks",
                "name": row["name"],
                "exchange": catalog_row.get("exchange"),
                "sector": row["sector"],
                "industry": row["industry"],
                "active": bool(catalog_row.get("active", 1)),
                "optionable": bool(catalog_row.get("optionable")) if catalog_row.get("optionable") is not None else None,
                "underlying_symbol": catalog_row.get("underlying_symbol"),
                "currency": catalog_row.get("currency"),
                "cik": catalog_row.get("cik"),
                "sec_name": catalog_row.get("sec_name"),
                "sec_exchange": catalog_row.get("sec_exchange"),
                "has_sec_mapping": bool(catalog_row.get("has_sec_mapping")) if catalog_row.get("has_sec_mapping") is not None else None,
                "company_type": company_type,
                "valuation_engine_class": engine_class,
                "classification_source": source,
                "classification_confidence": confidence,
                "last_classified_at": now,
                "source": {"source": "classify_valuation_methods.py", "universe": args.universe},
            }
        )
        membership_payload = {
            "source": "classify_valuation_methods.py",
            "classification_source": source,
            "classification_confidence": confidence,
        }
        membership_rows.extend(
            [
                {
                    "symbol": symbol,
                    "membership_type": "company_type",
                    "membership_value": company_type,
                    "source": "classify_valuation_methods.py",
                    "as_of": now,
                    "payload": membership_payload,
                },
                {
                    "symbol": symbol,
                    "membership_type": "valuation_engine_class",
                    "membership_value": engine_class,
                    "source": "classify_valuation_methods.py",
                    "as_of": now,
                    "payload": membership_payload,
                },
                {
                    "symbol": symbol,
                    "membership_type": "valuation_data_status",
                    "membership_value": data_status,
                    "source": "classify_valuation_methods.py",
                    "as_of": args.as_of_date,
                    "payload": membership_payload,
                },
            ]
        )
        if data_reason:
            membership_rows.append(
                {
                    "symbol": symbol,
                    "membership_type": "valuation_data_reason",
                    "membership_value": data_reason,
                    "source": "classify_valuation_methods.py",
                    "as_of": args.as_of_date,
                    "payload": membership_payload,
                }
            )

    if not args.dry_run:
        _delete_classification_memberships(Path(args.symbol_catalog_db_path), symbols)
        catalog.bulk_upsert_symbols(symbol_rows)
        catalog.bulk_upsert_memberships(membership_rows)

    return {
        "generated_at": now,
        "universe": args.universe,
        "symbol_count": len(symbols),
        "dry_run": bool(args.dry_run),
        "raw_snapshot_count": len(raw_snapshots),
        "as_of_date": args.as_of_date,
        "valuation_engine_counts": dict(engine_counts.most_common()),
        "company_type_counts": dict(company_type_counts.most_common()),
        "valuation_data_status_counts": dict(data_status_counts.most_common()),
        "examples_by_valuation_engine": dict(examples),
        "rows": classified_rows,
    }


def write_report(report: Dict[str, Any], output_dir: Path, prefix: str) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{prefix}.latest.json"
    md_path = output_dir / f"{prefix}.latest.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    lines = [
        "# Valuation Method Classification",
        "",
        f"Generated: {report['generated_at']}",
        f"Universe: `{report['universe']}` ({report['symbol_count']} symbols)",
        f"Raw fundamentals snapshots: {report['raw_snapshot_count']}",
        "",
        "## Valuation Engines",
        "",
        "| Engine | Symbols |",
        "|---|---:|",
    ]
    for engine, count in report["valuation_engine_counts"].items():
        lines.append(f"| {engine} | {count} |")
    lines.extend(["", "## Company Types", "", "| Company Type | Symbols |", "|---|---:|"])
    for company_type, count in report["company_type_counts"].items():
        lines.append(f"| {company_type} | {count} |")
    lines.extend(["", "## Data Status", "", "| Status | Symbols |", "|---|---:|"])
    for status, count in report["valuation_data_status_counts"].items():
        lines.append(f"| {status} | {count} |")
    md_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return json_path, md_path


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tag each universe symbol with the valuation method it should use.")
    parser.add_argument("--universe", default="clean_stocks")
    parser.add_argument("--symbols", default="", help="Comma-separated symbol override")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--pit-db-path", default=str(DEFAULT_PIT_DB_PATH))
    parser.add_argument("--symbol-catalog-db-path", default=str(DEFAULT_SYMBOL_CATALOG_DB_PATH))
    parser.add_argument("--as-of-date", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--prefix", default="valuation_method_classification")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    report = classify_universe(args)
    json_path, md_path = write_report(report, Path(args.output_dir), args.prefix)
    print(f"Wrote JSON: {json_path}")
    print(f"Wrote Markdown: {md_path}")
    print(json.dumps(report["valuation_engine_counts"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
