#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Set


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "fundamentals-pit.sqlite"
ELIGIBILITY_REPORT_PATH = ROOT / "backend" / "data" / "ledger_filing_eligibility_report.json"

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from universe_registry import load_universe_symbols  # noqa: E402


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


@lru_cache(maxsize=1)
def _clean_universe() -> Set[str]:
    return set(load_universe_symbols("clean_stocks"))


@lru_cache(maxsize=1)
def _ledger_universe() -> Set[str]:
    return set(load_universe_symbols("ledger_filing_eligible"))


@lru_cache(maxsize=1)
def _eligibility_status_index() -> Dict[str, Dict[str, Any]]:
    if not ELIGIBILITY_REPORT_PATH.exists():
        return {}
    try:
        payload = json.loads(ELIGIBILITY_REPORT_PATH.read_text(encoding="utf-8"))
        rows = payload.get("rows") or []
        out: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            symbol = _normalize_symbol((row or {}).get("symbol"))
            if symbol:
                out[symbol] = row
        return out
    except Exception:
        return {}


def _pit_counts(symbol: str) -> Dict[str, int]:
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.cursor()
        counts: Dict[str, int] = {}
        for table in ("raw_source_cache", "asof_symbol_snapshots", "pit_documents", "pit_statement_facts"):
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE symbol = ?", (symbol,))
            counts[table] = int(cur.fetchone()[0])
        return counts
    finally:
        conn.close()


def resolve_coverage(symbol: str) -> Dict[str, Any]:
    normalized = _normalize_symbol(symbol)
    if not normalized:
        raise ValueError("symbol required")

    clean_universe = _clean_universe()
    ledger_universe = _ledger_universe()
    eligibility = _eligibility_status_index().get(normalized) or {}
    counts = _pit_counts(normalized)

    in_clean = normalized in clean_universe
    in_ledger = normalized in ledger_universe
    vendor_pit_available = counts.get("raw_source_cache", 0) > 0 or counts.get("asof_symbol_snapshots", 0) > 0
    filing_pit_available = counts.get("pit_documents", 0) > 0 and counts.get("pit_statement_facts", 0) > 0
    status = str(eligibility.get("status") or "").strip()
    notes: List[str] = []

    if not in_clean:
        coverage_tier = "insufficient_data"
        notes.append("Symbol is not present in the clean_stocks universe.")
    elif filing_pit_available:
        coverage_tier = "full_filing_supported"
        notes.append("Filing-derived PIT facts are available for this symbol.")
    elif status == "foreign_reporting_filer":
        coverage_tier = "foreign_reporting"
        notes.append("Symbol follows a foreign-reporting SEC form family rather than the domestic 10-K/10-Q path.")
    elif vendor_pit_available:
        coverage_tier = "vendor_pit_only"
        if in_ledger:
            notes.append("Symbol is eligible for filing-backed coverage, but filing-derived PIT facts are not loaded yet.")
        else:
            notes.append("Symbol is in the clean tradable universe but not in the domestic filing-backed Ledger universe.")
    else:
        coverage_tier = "insufficient_data"
        notes.append("No reliable PIT coverage is currently available for this symbol.")

    if status and not in_ledger and status not in {"eligible"}:
        reason = str(eligibility.get("reason") or "").strip()
        if reason:
            notes.append(reason)

    return {
        "symbol": normalized,
        "coverage_tier": coverage_tier,
        "in_clean_stocks": in_clean,
        "in_ledger_filing_eligible": in_ledger,
        "vendor_pit_available": vendor_pit_available,
        "filing_pit_available": filing_pit_available,
        "document_count": counts.get("pit_documents", 0),
        "statement_fact_count": counts.get("pit_statement_facts", 0),
        "eligibility_status": status or None,
        "coverage_notes": notes,
    }


def main() -> None:
    symbol = _normalize_symbol(sys.argv[1] if len(sys.argv) > 1 else "")
    if not symbol:
        raise SystemExit(json.dumps({"error": "symbol required"}))
    try:
        print(json.dumps(resolve_coverage(symbol), indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        raise


if __name__ == "__main__":
    main()
