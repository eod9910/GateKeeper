#!/usr/bin/env python3
"""
Build a SEC-backed Ledger filing-eligible universe from the canonical clean stock universe.

Eligibility rule (v0):
- symbol must exist in the current canonical clean universe
- symbol must map to an SEC CIK via company_tickers_exchange.json
- the SEC submissions record must show at least one recent 10-K-like or 10-Q-like filing

This intentionally creates a stricter subset for Ledger filing ingestion without mutating the
broader canonical tradable universe.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
OUTPUT_PATH = DATA_DIR / "ledger_filing_eligible.json"
REPORT_PATH = DATA_DIR / "ledger_filing_eligibility_report.json"
STOCK_EXCLUSIONS_PATH = DATA_DIR / "universe" / "stock_exclusions.json"
SEC_TICKER_MAP_PATH = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "company_tickers_exchange.json"
SEC_SUBMISSIONS_DIR_CANDIDATES = [
    ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "submissions_verified",
    ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "submissions",
]

DOMESTIC_REPORT_FORMS = ("10-K", "10-Q")
FOREIGN_REPORT_FORMS = ("20-F", "6-K", "40-F")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper()


def _symbol_variants(symbol: str) -> List[str]:
    normalized = _normalize_symbol(symbol)
    if not normalized:
        return []
    variants = [normalized]
    if "." in normalized:
        variants.append(normalized.replace(".", "-"))
    if "-" in normalized:
        variants.append(normalized.replace("-", "."))
    return list(dict.fromkeys(variants))


def _load_clean_universe() -> List[Dict[str, Any]]:
    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    return list(payload.get("stocks") or [])


def _load_stock_exclusions() -> set[str]:
    if not STOCK_EXCLUSIONS_PATH.exists():
        return set()
    payload = json.loads(STOCK_EXCLUSIONS_PATH.read_text(encoding="utf-8"))
    values = payload.get("symbols") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        return set()
    return {_normalize_symbol(value) for value in values if _normalize_symbol(value)}


def _load_sec_ticker_map() -> Dict[str, Dict[str, Any]]:
    payload = json.loads(SEC_TICKER_MAP_PATH.read_text(encoding="utf-8"))
    fields = payload.get("fields") or []
    rows = payload.get("data") or []
    indexes = {name: fields.index(name) for name in ("cik", "name", "ticker", "exchange")}
    mapping: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, list) or len(row) <= max(indexes.values()):
            continue
        ticker = _normalize_symbol(row[indexes["ticker"]])
        if not ticker:
            continue
        record = {
            "cik": int(row[indexes["cik"]]),
            "sec_name": row[indexes["name"]],
            "sec_exchange": row[indexes["exchange"]],
        }
        for variant in _symbol_variants(ticker):
            mapping[variant] = record
    return mapping


def _resolve_submissions_dir() -> Path:
    for candidate in SEC_SUBMISSIONS_DIR_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No SEC submissions directory found.")


def _load_submission(submissions_dir: Path, cik: int) -> Dict[str, Any] | None:
    path = submissions_dir / f"CIK{cik:010d}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _recent_forms(payload: Dict[str, Any]) -> List[str]:
    recent = ((payload.get("filings") or {}).get("recent") or {})
    return [str(value or "").strip().upper() for value in (recent.get("form") or []) if str(value or "").strip()]


def _has_form_prefix(forms: List[str], prefixes: tuple[str, ...]) -> bool:
    return any(any(form.startswith(prefix) for prefix in prefixes) for form in forms)


def main() -> None:
    universe_stocks = _load_clean_universe()
    stock_exclusions = _load_stock_exclusions()
    ticker_map = _load_sec_ticker_map()
    submissions_dir = _resolve_submissions_dir()

    eligible_symbols: List[str] = []
    report_rows: List[Dict[str, Any]] = []

    counts = {
        "eligible": 0,
        "no_sec_mapping": 0,
        "no_submissions_file": 0,
        "foreign_reporting_filer": 0,
        "no_recent_domestic_reports": 0,
    }

    for stock in universe_stocks:
        symbol = _normalize_symbol(stock.get("ticker"))
        if not symbol:
            continue

        sec_record = None
        for variant in _symbol_variants(symbol):
            sec_record = ticker_map.get(variant)
            if sec_record:
                break

        row: Dict[str, Any] = {
            "symbol": symbol,
            "company_name": stock.get("name"),
            "universe_exchange": stock.get("exchange"),
            "cap_tier": stock.get("cap_tier"),
            "index": stock.get("index"),
        }

        if not sec_record:
            row["status"] = "no_sec_mapping"
            row["reason"] = "symbol did not map to SEC company_tickers_exchange data"
            counts["no_sec_mapping"] += 1
            report_rows.append(row)
            continue

        cik = int(sec_record["cik"])
        row["cik"] = str(cik)
        row["sec_exchange"] = sec_record.get("sec_exchange")
        row["sec_name"] = sec_record.get("sec_name")

        submission = _load_submission(submissions_dir, cik)
        if not submission:
            row["status"] = "no_submissions_file"
            row["reason"] = "mapped to SEC CIK but no local submissions JSON was found"
            counts["no_submissions_file"] += 1
            report_rows.append(row)
            continue

        forms = _recent_forms(submission)
        has_domestic = _has_form_prefix(forms, DOMESTIC_REPORT_FORMS)
        has_foreign = _has_form_prefix(forms, FOREIGN_REPORT_FORMS)
        row["state_of_incorporation"] = submission.get("stateOfIncorporation")
        row["state_of_incorporation_description"] = submission.get("stateOfIncorporationDescription")
        row["recent_form_sample"] = forms[:20]
        row["has_domestic_reporting_forms"] = has_domestic
        row["has_foreign_reporting_forms"] = has_foreign

        if has_domestic:
            row["status"] = "eligible"
            row["reason"] = "recent SEC submissions include 10-K-like or 10-Q-like reporting forms"
            eligible_symbols.append(symbol)
            counts["eligible"] += 1
        elif has_foreign:
            row["status"] = "foreign_reporting_filer"
            row["reason"] = "recent SEC submissions use foreign reporting form families such as 20-F, 6-K, or 40-F"
            counts["foreign_reporting_filer"] += 1
        else:
            row["status"] = "no_recent_domestic_reports"
            row["reason"] = "mapped to SEC but recent submissions did not show domestic 10-K/10-Q reporting forms"
            counts["no_recent_domestic_reports"] += 1

        report_rows.append(row)

    stock_exclusions_removed = len({symbol for symbol in eligible_symbols if symbol in stock_exclusions})
    eligible_symbols = sorted(dict.fromkeys(symbol for symbol in eligible_symbols if symbol not in stock_exclusions))

    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "generated_at": _utc_now_iso(),
                "source_universe": str(UNIVERSE_PATH.relative_to(ROOT)),
                "source_symbol_count": len(universe_stocks),
                "eligible_symbol_count": len(eligible_symbols),
                "stock_exclusions_removed": stock_exclusions_removed,
                "criteria": [
                    "must be in clean_stocks canonical universe",
                    "must map to SEC company_tickers_exchange.json",
                    "must show recent 10-K-like or 10-Q-like SEC reporting forms",
                    "must not be present in stock_exclusions.json",
                ],
                "symbols": eligible_symbols,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    REPORT_PATH.write_text(
        json.dumps(
            {
                "generated_at": _utc_now_iso(),
                "source_universe": str(UNIVERSE_PATH.relative_to(ROOT)),
                "submissions_dir": str(submissions_dir.relative_to(ROOT)),
                "summary": {
                    "source_symbol_count": len(universe_stocks),
                    **counts,
                    "stock_exclusions_removed": stock_exclusions_removed,
                    "eligible_symbol_count_after_exclusions": len(eligible_symbols),
                },
                "rows": report_rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(
        {
            "output": str(OUTPUT_PATH),
            "report": str(REPORT_PATH),
            "summary": {
                "source_symbol_count": len(universe_stocks),
                **counts,
                "stock_exclusions_removed": stock_exclusions_removed,
                "eligible_symbol_count_after_exclusions": len(eligible_symbols),
            },
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
