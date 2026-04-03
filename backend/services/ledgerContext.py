#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[2]
PIT_DB_PATH = ROOT / "backend" / "data" / "fundamentals-pit.sqlite"
RETRIEVAL_DB_PATH = ROOT / "Financial data" / "docling_probe" / "retrieval" / "index" / "filing_rag.sqlite"

DEFAULT_QUERY = (
    "liquidity debt covenant dilution customer concentration accounting policy changes "
    "legal risk unusual adjustments margin pressure going concern"
)
DEFAULT_TOP_K = 8
DEFAULT_RECENT_QUARTERS = 4
DEFAULT_RECENT_ANNUALS = 3
SOURCE_PRIORITY = {
    "sec_companyfacts_bulk": 0,
    "sec_docling_probe": 1,
}
CORE_FACT_KEYS = (
    "revenue",
    "operating_income",
    "net_income",
    "current_assets",
    "current_liabilities",
    "shareholders_equity",
    "operating_cash_flow",
    "capital_expenditures",
    "free_cash_flow",
)


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _truncate_text(value: str, max_chars: int = 1200) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def _source_rank(source_type: Optional[str]) -> int:
    return SOURCE_PRIORITY.get(str(source_type or "").strip(), 99)


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _load_recent_documents(symbol: str, limit: int = 6) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(PIT_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT symbol, source_type, source_document, company, cik, form_type, filing_date, report_date,
                   filing_url, raw_file_path, markdown_file_path, json_file_path, metadata_file_path
            FROM pit_documents
            WHERE symbol = ?
            ORDER BY filing_date DESC, report_date DESC, source_document DESC
            LIMIT ?
            """,
            (symbol, limit),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def _load_statement_backbone(
    symbol: str,
    recent_quarters: int = DEFAULT_RECENT_QUARTERS,
    recent_annuals: int = DEFAULT_RECENT_ANNUALS,
) -> Dict[str, Any]:
    conn = sqlite3.connect(PIT_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        placeholders = ", ".join("?" for _ in CORE_FACT_KEYS)
        rows = conn.execute(
            f"""
            SELECT symbol, fact_key, value_numeric, value_text, value_type, fact_origin, unit, scale, currency,
                   period_type, period_end, fiscal_year, fiscal_quarter, filing_date, available_at,
                   source_type, source_document, evidence_ref, confidence
            FROM pit_statement_facts
            WHERE symbol = ?
              AND fact_key IN ({placeholders})
              AND period_type IN ('quarterly', 'annual')
            ORDER BY period_end DESC, filing_date DESC, available_at DESC
            """,
            (symbol, *CORE_FACT_KEYS),
        ).fetchall()

        best_by_fact_period: Dict[Tuple[str, str, str], sqlite3.Row] = {}
        for row in rows:
            key = (
                str(row["period_type"] or ""),
                str(row["period_end"] or ""),
                str(row["fact_key"] or ""),
            )
            incumbent = best_by_fact_period.get(key)
            if incumbent is None:
                best_by_fact_period[key] = row
                continue

            incumbent_rank = _source_rank(incumbent["source_type"])
            candidate_rank = _source_rank(row["source_type"])
            if candidate_rank < incumbent_rank:
                best_by_fact_period[key] = row
                continue
            if candidate_rank > incumbent_rank:
                continue

            candidate_key = (
                str(row["filing_date"] or ""),
                str(row["available_at"] or ""),
                str(row["source_document"] or ""),
            )
            incumbent_key = (
                str(incumbent["filing_date"] or ""),
                str(incumbent["available_at"] or ""),
                str(incumbent["source_document"] or ""),
            )
            if candidate_key > incumbent_key:
                best_by_fact_period[key] = row

        periods: Dict[str, Dict[str, Dict[str, Any]]] = {"quarterly": {}, "annual": {}}
        for row in best_by_fact_period.values():
            period_type = str(row["period_type"])
            period_end = str(row["period_end"])
            bucket = periods.setdefault(period_type, {})
            period_entry = bucket.setdefault(
                period_end,
                {
                    "period_type": period_type,
                    "period_end": period_end,
                    "filing_date": row["filing_date"],
                    "available_at": row["available_at"],
                    "fiscal_year": row["fiscal_year"],
                    "fiscal_quarter": row["fiscal_quarter"],
                    "source_documents": [],
                    "metrics": {},
                },
            )
            source_document = str(row["source_document"] or "").strip()
            if source_document and source_document not in period_entry["source_documents"]:
                period_entry["source_documents"].append(source_document)
            period_entry["metrics"][str(row["fact_key"])] = {
                "value_numeric": _coerce_float(row["value_numeric"]),
                "value_text": row["value_text"],
                "value_type": row["value_type"],
                "fact_origin": row["fact_origin"],
                "unit": row["unit"],
                "scale": row["scale"],
                "currency": row["currency"],
                "source_type": row["source_type"],
                "source_document": row["source_document"],
                "evidence_ref": row["evidence_ref"],
                "confidence": _coerce_float(row["confidence"]),
            }

        quarterly = sorted(periods.get("quarterly", {}).values(), key=lambda item: item["period_end"], reverse=True)
        annual = sorted(periods.get("annual", {}).values(), key=lambda item: item["period_end"], reverse=True)
        return {
            "fact_keys": list(CORE_FACT_KEYS),
            "quarterly": quarterly[:recent_quarters],
            "annual": annual[:recent_annuals],
        }
    finally:
        conn.close()


def _load_retrieval_meta() -> Dict[str, Any]:
    if not RETRIEVAL_DB_PATH.exists():
        return {"available": False, "reason": "retrieval index missing"}
    conn = sqlite3.connect(RETRIEVAL_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT key, value FROM retrieval_index_meta").fetchall()
        meta: Dict[str, Any] = {}
        for row in rows:
            key = str(row["key"])
            raw = row["value"]
            try:
                meta[key] = json.loads(raw)
            except Exception:
                meta[key] = raw
        chunk_count = int(conn.execute("SELECT COUNT(*) FROM retrieval_chunks").fetchone()[0])
        meta["chunk_count"] = chunk_count
        meta["available"] = True
        return meta
    finally:
        conn.close()


def _build_fast_fts_query(query: str) -> str:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", str(query or "").lower())
    filtered: List[str] = []
    for token in tokens:
        if len(token) < 4:
            continue
        if token in filtered:
            continue
        filtered.append(token)
        if len(filtered) >= 8:
            break
    if not filtered:
        filtered = ["liquidity", "debt", "risk"]
    return " ".join(f'"{token}"' for token in filtered)


def _query_retrieval(symbol: str, query: str, top_k: int) -> Dict[str, Any]:
    meta = _load_retrieval_meta()
    if not meta.get("available"):
        return {"available": False, "query": query, "top_k": top_k, "results": [], "meta": meta}
    conn = sqlite3.connect(RETRIEVAL_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        fts_query = _build_fast_fts_query(query)
        rows = conn.execute(
            """
            SELECT c.chunk_id, c.symbol, c.company, c.form, c.filing_date, c.report_date,
                   c.accession_number, c.section_heading, c.source_markdown_file, c.text,
                   bm25(retrieval_chunks_fts) AS bm25_score
            FROM retrieval_chunks_fts
            JOIN retrieval_chunks c ON c.row_id = retrieval_chunks_fts.rowid
            WHERE retrieval_chunks_fts MATCH ?
              AND UPPER(COALESCE(c.symbol, '')) = ?
            ORDER BY bm25_score ASC, c.filing_date DESC, c.row_id ASC
            LIMIT ?
            """,
            (fts_query, symbol.upper(), max(1, top_k)),
        ).fetchall()
    except Exception as exc:
        return {
            "available": False,
            "query": query,
            "top_k": top_k,
            "results": [],
            "meta": meta,
            "error": str(exc),
        }
    finally:
        conn.close()

    results = []
    for row in rows:
        text = str(row["text"] or "")
        keyword_score = _coerce_float(row["bm25_score"])
        if keyword_score is not None:
            keyword_score = 1.0 / (1.0 + max(keyword_score, 0.0))
        results.append(
            {
                "chunk_id": row["chunk_id"],
                "symbol": row["symbol"],
                "company": row["company"],
                "form": row["form"],
                "filing_date": row["filing_date"],
                "report_date": row["report_date"],
                "accession_number": row["accession_number"],
                "section_heading": row["section_heading"],
                "source_markdown_file": row["source_markdown_file"],
                "semantic_score": None,
                "keyword_score": keyword_score,
                "hybrid_score": keyword_score,
                "text_excerpt": _truncate_text(text),
                "text_length": len(text),
            }
        )

    return {
        "available": True,
        "query": query,
        "top_k": top_k,
        "results": results,
        "meta": {
            **meta,
            "retrieval_mode": "fts_fast",
            "fts_query": fts_query,
        },
    }


def build_ledger_context(symbol: str, query: str = DEFAULT_QUERY, top_k: int = DEFAULT_TOP_K) -> Dict[str, Any]:
    normalized = _normalize_symbol(symbol)
    if not normalized:
        raise ValueError("symbol required")
    return {
        "symbol": normalized,
        "statement_backbone": _load_statement_backbone(normalized),
        "recent_documents": _load_recent_documents(normalized),
        "retrieval": _query_retrieval(normalized, query, max(1, top_k)),
    }


def main(argv: Iterable[str]) -> None:
    args = list(argv)
    symbol = _normalize_symbol(args[1] if len(args) > 1 else "")
    query = str(args[2] or DEFAULT_QUERY).strip() if len(args) > 2 else DEFAULT_QUERY
    try:
        top_k = int(args[3]) if len(args) > 3 else DEFAULT_TOP_K
    except Exception:
        top_k = DEFAULT_TOP_K

    if not symbol:
        raise SystemExit(json.dumps({"error": "symbol required"}))

    try:
        payload = build_ledger_context(symbol, query=query or DEFAULT_QUERY, top_k=top_k)
        print(json.dumps(payload, indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        raise


if __name__ == "__main__":
    main(sys.argv)
