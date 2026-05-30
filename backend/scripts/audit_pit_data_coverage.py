#!/usr/bin/env python3
from __future__ import annotations

"""
Audit point-in-time fundamentals coverage.

The goal is not just to count rows. A valuation backtest only works when a
symbol/date has the full chain of inputs needed to build the DCF primitive:
snapshot data, shares outstanding, annual statements, revenue, and FCF or
operating-cash-flow minus capex.
"""

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
DATA_DIR = BACKEND_DIR / "data"
SERVICES_DIR = BACKEND_DIR / "services"
DEFAULT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_SYMBOL_CATALOG_DB_PATH = DATA_DIR / "symbol-catalog.sqlite"
DEFAULT_OUTPUT_DIR = DATA_DIR / "research"
DEFAULT_START_DATE = "2020-01-01"
DEFAULT_END_DATE = date.today().isoformat()

sys.path.insert(0, str(SERVICES_DIR))

from universe_registry import load_universe_symbols  # noqa: E402


DCF_FACT_KEYS = (
    "revenue",
    "operating_income",
    "net_income",
    "operating_cash_flow",
    "capital_expenditures",
    "free_cash_flow",
    "current_assets",
    "current_liabilities",
)


@dataclass
class SymbolAudit:
    symbol: str
    attempted_dates: int = 0
    valuation_ready_dates: int = 0
    latest_ready_date: Optional[str] = None
    first_ready_date: Optional[str] = None
    no_asof_snapshot: int = 0
    missing_shares_outstanding: int = 0
    no_annual_statement_facts: int = 0
    missing_annual_revenue: int = 0
    missing_fcf_and_ocf_capex: int = 0
    latest_failure_reason: Optional[str] = None
    latest_failure_date: Optional[str] = None
    fundamental_fact_metrics: int = 0
    market_fact_metrics: int = 0
    annual_statement_periods: int = 0
    annual_statement_fact_keys: int = 0


def _parse_date(value: str) -> date:
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _month_ends(start: str, end: str) -> List[str]:
    start_dt = _parse_date(start)
    end_dt = _parse_date(end)
    if end_dt < start_dt:
        raise ValueError("end-date must be on or after start-date")

    out: List[str] = []
    year = start_dt.year
    month = start_dt.month
    while True:
        if month == 12:
            next_month = date(year + 1, 1, 1)
        else:
            next_month = date(year, month + 1, 1)
        month_end = next_month.fromordinal(next_month.toordinal() - 1)
        if month_end >= start_dt:
            out.append(min(month_end, end_dt).isoformat())
        if month_end >= end_dt:
            break
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return out


def _dedupe_symbols(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        symbol = str(value or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out


def _load_symbols(args: argparse.Namespace) -> List[str]:
    if args.symbols:
        symbols = _dedupe_symbols(args.symbols.split(","))
    elif args.universe_file:
        payload = json.loads(Path(args.universe_file).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("stocks"), list):
            symbols = _dedupe_symbols(item.get("ticker") for item in payload["stocks"] if isinstance(item, dict))
        elif isinstance(payload, dict):
            symbols = _dedupe_symbols(payload.get("symbols") or [])
        else:
            symbols = _dedupe_symbols(payload)
    else:
        symbols = _dedupe_symbols(load_universe_symbols(args.universe))
    if args.limit and args.limit > 0:
        return symbols[: args.limit]
    return symbols


def _symbols_with_valuation_engine(db_path: Path, valuation_engine_class: str) -> set[str]:
    if not valuation_engine_class or not db_path.exists():
        return set()
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            """
            SELECT symbol
            FROM symbols
            WHERE lower(coalesce(valuation_engine_class, '')) = lower(?)
            """,
            (valuation_engine_class,),
        ).fetchall()
    return {str(row[0] or "").strip().upper() for row in rows if str(row[0] or "").strip()}


def _symbols_with_membership(db_path: Path, membership_type: str, membership_value: str) -> set[str]:
    if not membership_type or not membership_value or not db_path.exists():
        return set()
    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute(
            """
            SELECT symbol
            FROM symbol_memberships
            WHERE membership_type = ?
              AND lower(membership_value) = lower(?)
            """,
            (membership_type, membership_value),
        ).fetchall()
    return {str(row[0] or "").strip().upper() for row in rows if str(row[0] or "").strip()}


def _apply_symbol_catalog_filters(symbols: Sequence[str], args: argparse.Namespace) -> Tuple[List[str], Dict[str, Any]]:
    filtered = list(symbols)
    catalog_path = Path(args.symbol_catalog_db_path)
    filters: List[Dict[str, Any]] = []

    valuation_engine_class = str(args.valuation_engine_class or "").strip()
    if valuation_engine_class:
        tagged_symbols = _symbols_with_valuation_engine(catalog_path, valuation_engine_class)
        before = len(filtered)
        filtered = [symbol for symbol in filtered if symbol in tagged_symbols]
        filters.append(
            {
                "kind": "valuation_engine_class",
                "value": valuation_engine_class,
                "tagged_symbol_count": len(tagged_symbols),
                "before": before,
                "after": len(filtered),
            }
        )

    membership_type = str(args.required_membership_type or "").strip()
    membership_value = str(args.required_membership_value or "").strip()
    if membership_type and membership_value:
        tagged_symbols = _symbols_with_membership(catalog_path, membership_type, membership_value)
        before = len(filtered)
        filtered = [symbol for symbol in filtered if symbol in tagged_symbols]
        filters.append(
            {
                "kind": "membership",
                "membership_type": membership_type,
                "membership_value": membership_value,
                "tagged_symbol_count": len(tagged_symbols),
                "before": before,
                "after": len(filtered),
            }
        )

    return filtered, {
        "enabled": bool(filters),
        "symbol_catalog_db_path": str(catalog_path),
        "input_symbol_count": len(symbols),
        "filtered_symbol_count": len(filtered),
        "excluded_symbol_count": len(symbols) - len(filtered),
        "filters": filters,
    }


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _table_inventory(conn: sqlite3.Connection, table: str) -> Dict[str, Any]:
    if not _table_exists(conn, table):
        return {"exists": False}
    row_count = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
    out: Dict[str, Any] = {"exists": True, "rows": row_count}
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if "symbol" in columns:
        out["distinct_symbols"] = conn.execute(f"SELECT COUNT(DISTINCT symbol) AS n FROM {table}").fetchone()["n"]
    for col in ("available_at", "market_date", "period_end", "fetched_at_date", "updated_at"):
        if col in columns:
            row = conn.execute(f"SELECT MIN({col}) AS min_date, MAX({col}) AS max_date FROM {table}").fetchone()
            out[f"{col}_min"] = row["min_date"]
            out[f"{col}_max"] = row["max_date"]
    return out


def _symbol_set(conn: sqlite3.Connection, table: str) -> set[str]:
    if not _table_exists(conn, table):
        return set()
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if "symbol" not in columns:
        return set()
    return {
        str(row["symbol"]).upper()
        for row in conn.execute(f"SELECT DISTINCT symbol FROM {table} WHERE symbol IS NOT NULL").fetchall()
    }


def _chunks(values: Sequence[str], size: int = 800) -> Iterable[List[str]]:
    for idx in range(0, len(values), size):
        yield list(values[idx : idx + size])


def _empty_inventory() -> Dict[str, Any]:
    return {
        "fundamental_metrics": {},
        "market_metrics": {},
        "fundamental_first_dates": {},
        "market_first_dates": {},
        "annual_rows": [],
    }


def _load_all_symbol_inventory(conn: sqlite3.Connection, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    inventory: Dict[str, Dict[str, Any]] = {symbol: _empty_inventory() for symbol in symbols}
    fact_placeholders = ", ".join("?" for _ in DCF_FACT_KEYS)

    for chunk in _chunks(list(symbols)):
        placeholders = ", ".join("?" for _ in chunk)
        for row in conn.execute(
            f"""
            SELECT symbol, metric, MIN(available_at) AS first_available_at, MAX(available_at) AS latest_available_at
            FROM pit_fundamental_facts
            WHERE symbol IN ({placeholders})
            GROUP BY symbol, metric
            """,
            tuple(chunk),
        ).fetchall():
            symbol = str(row["symbol"]).upper()
            metric = str(row["metric"])
            if symbol not in inventory:
                continue
            inventory[symbol]["fundamental_metrics"][metric] = str(row["latest_available_at"])
            inventory[symbol]["fundamental_first_dates"][metric] = str(row["first_available_at"])

        for row in conn.execute(
            f"""
            SELECT symbol, metric, MIN(market_date) AS first_market_date, MAX(market_date) AS latest_market_date
            FROM pit_market_facts
            WHERE symbol IN ({placeholders})
            GROUP BY symbol, metric
            """,
            tuple(chunk),
        ).fetchall():
            symbol = str(row["symbol"]).upper()
            metric = str(row["metric"])
            if symbol not in inventory:
                continue
            inventory[symbol]["market_metrics"][metric] = str(row["latest_market_date"])
            inventory[symbol]["market_first_dates"][metric] = str(row["first_market_date"])

        for row in conn.execute(
            f"""
            SELECT symbol, fact_key, period_end, available_at, value_numeric
            FROM pit_statement_facts
            WHERE symbol IN ({placeholders})
              AND period_type = 'annual'
              AND fact_key IN ({fact_placeholders})
            ORDER BY symbol ASC, available_at ASC, period_end DESC
            """,
            tuple(chunk) + tuple(DCF_FACT_KEYS),
        ).fetchall():
            symbol = str(row["symbol"]).upper()
            if symbol in inventory:
                inventory[symbol]["annual_rows"].append(dict(row))

    return inventory


def _latest_metric_before(metric_dates: Dict[str, str], metric: str, asof_date: str) -> bool:
    first = metric_dates.get(metric)
    return bool(first and str(first) <= asof_date)


def _has_any_metric_before(metric_dates: Dict[str, str], asof_date: str) -> bool:
    return any(str(first) <= asof_date for first in metric_dates.values() if first)


def _annual_periods_before(rows: Sequence[Dict[str, Any]], asof_date: str) -> List[Dict[str, Any]]:
    by_period: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        available_at = str(row.get("available_at") or "")
        period_end = str(row.get("period_end") or "")
        fact_key = str(row.get("fact_key") or "")
        if not period_end or not fact_key or not available_at or available_at > asof_date:
            continue
        bucket = by_period.setdefault(period_end, {"period_end": period_end, "metrics": {}})
        value = row.get("value_numeric")
        if value is not None and fact_key not in bucket["metrics"]:
            bucket["metrics"][fact_key] = value
    return sorted(by_period.values(), key=lambda item: item["period_end"], reverse=True)


def _valuation_failure_reason(inventory: Dict[str, Any], asof_date: str) -> Optional[str]:
    fundamental_metrics = inventory["fundamental_first_dates"]
    market_metrics = inventory["market_first_dates"]
    if not (_has_any_metric_before(fundamental_metrics, asof_date) or _has_any_metric_before(market_metrics, asof_date)):
        return "no_asof_snapshot"
    if not _latest_metric_before(fundamental_metrics, "sharesOutstanding", asof_date):
        return "missing_shares_outstanding"
    periods = _annual_periods_before(inventory["annual_rows"], asof_date)
    if not periods:
        return "no_annual_statement_facts"
    latest_metrics = periods[0].get("metrics") or {}
    if latest_metrics.get("revenue") is None:
        return "missing_annual_revenue"
    has_fcf = latest_metrics.get("free_cash_flow") is not None
    has_ocf_capex = (
        latest_metrics.get("operating_cash_flow") is not None
        and latest_metrics.get("capital_expenditures") is not None
    )
    if not has_fcf and not has_ocf_capex:
        return "missing_fcf_and_ocf_capex"
    return None


def _audit_symbol(symbol: str, inventory: Dict[str, Any], grid_dates: Sequence[str]) -> SymbolAudit:
    audit = SymbolAudit(
        symbol=symbol,
        attempted_dates=len(grid_dates),
        fundamental_fact_metrics=len(inventory["fundamental_metrics"]),
        market_fact_metrics=len(inventory["market_metrics"]),
        annual_statement_periods=len({str(row.get("period_end") or "") for row in inventory["annual_rows"] if row.get("period_end")}),
        annual_statement_fact_keys=len({str(row.get("fact_key") or "") for row in inventory["annual_rows"] if row.get("fact_key")}),
    )

    for asof_date in grid_dates:
        reason = _valuation_failure_reason(inventory, asof_date)
        if reason is None:
            audit.valuation_ready_dates += 1
            if audit.first_ready_date is None:
                audit.first_ready_date = asof_date
            audit.latest_ready_date = asof_date
            continue
        setattr(audit, reason, getattr(audit, reason) + 1)
        audit.latest_failure_reason = reason
        audit.latest_failure_date = asof_date
    return audit


def _pct(numerator: float, denominator: float) -> float:
    return round((numerator / denominator) * 100.0, 2) if denominator else 0.0


def _top_missing_symbols(symbol_audits: Sequence[SymbolAudit], reason: str, limit: int) -> List[Dict[str, Any]]:
    ranked = sorted(
        symbol_audits,
        key=lambda item: (getattr(item, reason), item.attempted_dates, item.symbol),
        reverse=True,
    )
    return [
        {
            "symbol": item.symbol,
            "missing_dates": getattr(item, reason),
            "attempted_dates": item.attempted_dates,
            "ready_dates": item.valuation_ready_dates,
            "latest_failure_date": item.latest_failure_date,
        }
        for item in ranked[:limit]
        if getattr(item, reason) > 0
    ]


def _build_repair_priorities(reason_counts: Counter[str]) -> List[Dict[str, Any]]:
    labels = {
        "no_asof_snapshot": "Hydrate/materialize PIT snapshot facts for missing symbol-date history.",
        "missing_shares_outstanding": "Backfill sharesOutstanding into pit_fundamental_facts from SEC EntityCommonStockSharesOutstanding, latest filings, or market-data snapshots.",
        "no_annual_statement_facts": "Import SEC companyfacts/filing statement rows for annual periods.",
        "missing_annual_revenue": "Map additional revenue tags into normalized revenue and repair annual statement period grouping.",
        "missing_fcf_and_ocf_capex": "Backfill operating cash flow and capex, or store free_cash_flow directly where available.",
    }
    return [
        {"reason": reason, "missing_symbol_dates": count, "recommended_fix": labels.get(reason, "Investigate source coverage.")}
        for reason, count in reason_counts.most_common()
    ]


def _render_markdown(report: Dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# PIT Data Coverage Audit",
        "",
        f"Generated: {report['generated_at']}",
        f"Database: `{report['database']['path']}`",
        f"Universe: `{report['universe']['name']}` ({report['universe']['symbol_count']} symbols)",
        f"Date grid: {report['date_grid']['start_date']} to {report['date_grid']['end_date']} ({report['date_grid']['points']} monthly points)",
    ]
    valuation_filter = report["universe"].get("symbol_catalog_filters") or {}
    if valuation_filter.get("enabled"):
        lines.append(
            f"Symbol catalog filters: `{json.dumps(valuation_filter['filters'])}` "
            f"({valuation_filter['filtered_symbol_count']} of {valuation_filter['input_symbol_count']} input symbols)"
        )
    lines.extend(
        [
            "",
            "## Executive Summary",
            "",
            f"- Symbol-date checks: {summary['symbol_date_checks']}",
            f"- Valuation-ready checks: {summary['valuation_ready_checks']} ({summary['valuation_ready_pct']}%)",
            f"- Missing checks: {summary['missing_checks']} ({summary['missing_pct']}%)",
            f"- Symbols ever valuation-ready: {summary['symbols_ever_ready']} / {report['universe']['symbol_count']}",
            f"- Symbols never valuation-ready: {summary['symbols_never_ready']} / {report['universe']['symbol_count']}",
            "",
            "## Missing Reason Breakdown",
            "",
            "| Reason | Symbol-Date Count | Share |",
            "|---|---:|---:|",
        ]
    )
    for reason, count in report["missing_reasons"].items():
        lines.append(f"| {reason} | {count} | {_pct(count, summary['symbol_date_checks'])}% |")

    lines.extend(["", "## Table Inventory", "", "| Table | Rows | Symbols | Date Range |", "|---|---:|---:|---|"])
    for table, info in report["table_inventory"].items():
        if not info.get("exists"):
            lines.append(f"| {table} | missing | missing | missing |")
            continue
        date_bits = []
        for key, value in info.items():
            if key.endswith("_min") and value:
                prefix = key[:-4]
                max_value = info.get(f"{prefix}_max")
                date_bits.append(f"{prefix}: {value} to {max_value}")
        lines.append(
            f"| {table} | {info.get('rows', 0)} | {info.get('distinct_symbols', 'N/A')} | {'; '.join(date_bits) or 'N/A'} |"
        )

    lines.extend(["", "## Universe Coverage By Table", "", "| Table | Covered | Missing | Covered % |", "|---|---:|---:|---:|"])
    for table, info in report["universe_table_coverage"].items():
        lines.append(f"| {table} | {info['covered']} | {info['missing']} | {info['covered_pct']}% |")

    lines.extend(["", "## Repair Priorities", ""])
    for item in report["repair_priorities"]:
        lines.append(f"- `{item['reason']}`: {item['missing_symbol_dates']} symbol-dates. {item['recommended_fix']}")

    lines.extend(["", "## Worst Missing Symbols", ""])
    for reason, rows in report["top_missing_symbols"].items():
        lines.append(f"### {reason}")
        if not rows:
            lines.append("")
            lines.append("None.")
            lines.append("")
            continue
        lines.extend(["", "| Symbol | Missing Dates | Attempted Dates | Ready Dates | Latest Failure Date |", "|---|---:|---:|---:|---|"])
        for row in rows:
            lines.append(
                f"| {row['symbol']} | {row['missing_dates']} | {row['attempted_dates']} | {row['ready_dates']} | {row.get('latest_failure_date') or ''} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_report(args: argparse.Namespace) -> Dict[str, Any]:
    db_path = Path(args.db_path)
    loaded_symbols = _load_symbols(args)
    symbols, symbol_catalog_filters = _apply_symbol_catalog_filters(loaded_symbols, args)
    grid_dates = _month_ends(args.start_date, args.end_date)
    if not symbols:
        raise RuntimeError("No symbols loaded for audit")
    if not db_path.exists():
        raise RuntimeError(f"PIT database not found: {db_path}")

    with _connect(db_path) as conn:
        tables = [
            "raw_source_cache",
            "raw_source_cache_history",
            "pit_fundamental_facts",
            "pit_market_facts",
            "pit_statement_facts",
            "pit_documents",
            "pit_event_facts",
            "asof_symbol_snapshots",
        ]
        table_inventory = {table: _table_inventory(conn, table) for table in tables}
        universe_set = set(symbols)
        universe_table_coverage = {}
        for table in tables:
            covered = len(universe_set & _symbol_set(conn, table))
            missing = len(universe_set) - covered
            universe_table_coverage[table] = {
                "covered": covered,
                "missing": missing,
                "covered_pct": _pct(covered, len(universe_set)),
            }

        all_inventory = _load_all_symbol_inventory(conn, symbols)
        symbol_audits = [_audit_symbol(symbol, all_inventory[symbol], grid_dates) for symbol in symbols]

    reason_counts: Counter[str] = Counter()
    for audit in symbol_audits:
        for reason in (
            "no_asof_snapshot",
            "missing_shares_outstanding",
            "no_annual_statement_facts",
            "missing_annual_revenue",
            "missing_fcf_and_ocf_capex",
        ):
            count = getattr(audit, reason)
            if count:
                reason_counts[reason] += count

    total_checks = len(symbols) * len(grid_dates)
    ready_checks = sum(item.valuation_ready_dates for item in symbol_audits)
    missing_checks = total_checks - ready_checks
    symbols_ever_ready = sum(1 for item in symbol_audits if item.valuation_ready_dates > 0)

    report = {
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "database": {
            "path": str(db_path),
            "size_mb": round(db_path.stat().st_size / (1024 * 1024), 2),
        },
        "universe": {
            "name": args.universe if not args.symbols and not args.universe_file else "custom",
            "input_symbol_count": len(loaded_symbols),
            "symbol_count": len(symbols),
            "symbols": symbols,
            "symbol_catalog_filters": symbol_catalog_filters,
        },
        "date_grid": {
            "start_date": args.start_date,
            "end_date": args.end_date,
            "frequency": "monthly",
            "points": len(grid_dates),
            "dates": grid_dates,
        },
        "table_inventory": table_inventory,
        "universe_table_coverage": universe_table_coverage,
        "summary": {
            "symbol_date_checks": total_checks,
            "valuation_ready_checks": ready_checks,
            "valuation_ready_pct": _pct(ready_checks, total_checks),
            "missing_checks": missing_checks,
            "missing_pct": _pct(missing_checks, total_checks),
            "symbols_ever_ready": symbols_ever_ready,
            "symbols_never_ready": len(symbols) - symbols_ever_ready,
        },
        "missing_reasons": dict(reason_counts.most_common()),
        "repair_priorities": _build_repair_priorities(reason_counts),
        "top_missing_symbols": {
            reason: _top_missing_symbols(symbol_audits, reason, args.top)
            for reason in (
                "no_asof_snapshot",
                "missing_shares_outstanding",
                "no_annual_statement_facts",
                "missing_annual_revenue",
                "missing_fcf_and_ocf_capex",
            )
        },
        "symbols": [asdict(item) for item in symbol_audits],
    }
    return report


def write_report(report: Dict[str, Any], output_dir: Path, prefix: str) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"{prefix}_{stamp}.json"
    md_path = output_dir / f"{prefix}_{stamp}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(_render_markdown(report), encoding="utf-8")
    (output_dir / f"{prefix}.latest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (output_dir / f"{prefix}.latest.md").write_text(_render_markdown(report), encoding="utf-8")
    return json_path, md_path


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit PIT fundamentals coverage for valuation/backtest readiness.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="Path to fundamentals-pit.sqlite")
    parser.add_argument("--symbol-catalog-db-path", default=str(DEFAULT_SYMBOL_CATALOG_DB_PATH), help="Path to symbol-catalog.sqlite")
    parser.add_argument("--universe", default="clean_stocks", help="Universe registry key to audit")
    parser.add_argument("--universe-file", default="", help="Optional JSON file containing symbols/stocks")
    parser.add_argument("--symbols", default="", help="Comma-separated symbol override")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument("--limit", type=int, default=0, help="Optional symbol limit for smoke tests")
    parser.add_argument("--valuation-engine-class", default="", help="Only audit symbols tagged with this valuation engine class, e.g. dcf_operating")
    parser.add_argument("--required-membership-type", default="", help="Optional symbol_memberships type filter")
    parser.add_argument("--required-membership-value", default="", help="Optional symbol_memberships value filter")
    parser.add_argument("--top", type=int, default=25, help="Top missing symbols per failure reason")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--prefix", default="pit_data_coverage_audit")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    report = build_report(args)
    json_path, md_path = write_report(report, Path(args.output_dir), args.prefix)
    summary = report["summary"]
    print(f"Wrote JSON: {json_path}")
    print(f"Wrote Markdown: {md_path}")
    print(
        "Valuation-ready: "
        f"{summary['valuation_ready_checks']}/{summary['symbol_date_checks']} "
        f"({summary['valuation_ready_pct']}%)"
    )
    if report["missing_reasons"]:
        print("Top missing reasons:")
        for reason, count in list(report["missing_reasons"].items())[:5]:
            print(f"  {reason}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
