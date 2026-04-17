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
NOTE_SECTION_HEADING_PATTERNS = (
    "notes to%",
    "%liquidity and capital resources%",
    "item 7. management's discussion and analysis of financial condition and results of operations",
    "item 2. management's discussion and analysis of financial condition and results of operations",
    "%risk factors%",
    "%legal proceedings%",
    "%financial statements%",
)
HARD_FLAG_QUERY_MARKERS = (
    "merger",
    "acquisition",
    "go-private",
    "going private",
    "take private",
    "take-private",
    "definitive agreement",
    "merger agreement",
    "stockholders to receive",
    "contingent value right",
    "cvr",
    "chapter 11",
    "going concern",
    "forbearance",
    "restatement",
    "material weakness",
    "auditor resignation",
    "at-the-market",
    "pipe",
    "convertible",
    "subpoena",
    "warning letter",
    "product recall",
)
HARD_FLAG_SECTION_HEADING_PATTERNS = (
    "%proposed acquisition%",
    "%merger%",
    "%definitive agreement%",
    "%going private%",
    "%risk factors%",
    "%legal proceedings%",
)
NOTE_SEARCH_SYNONYMS = {
    "dilution": ("dilution", "share issuance", "equity offering", "stock-based compensation", "share-based compensation", "sbc"),
    "stock": ("stock-based compensation", "share-based compensation", "equity award", "restricted stock"),
    "compensation": ("stock-based compensation", "share-based compensation", "equity compensation"),
    "lease": ("lease", "right-of-use", "operating lease", "finance lease"),
    "leases": ("lease", "right-of-use", "operating lease", "finance lease"),
    "debt": ("debt", "borrowing", "credit facility", "covenant", "notes payable"),
    "liquidity": ("liquidity", "working capital", "cash requirements", "capital resources"),
    "cash": ("cash", "working capital", "liquidity", "capital resources"),
    "legal": ("legal", "litigation", "regulatory", "investigation", "contingency"),
    "risk": ("risk", "uncertainty", "contingency", "material weakness"),
    "revenue": ("revenue recognition", "deferred revenue", "contract asset", "contract liability"),
    "recognition": ("revenue recognition", "deferred revenue", "contract asset"),
    "one-time": ("one-time", "non-recurring", "restructuring", "impairment"),
    "restructuring": ("restructuring", "impairment", "non-recurring", "exit activity"),
    "accruals": ("accrual", "working capital", "accounts payable", "accounts receivable"),
    "concentration": ("customer concentration", "major customer", "supplier concentration"),
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


def _build_note_search_terms(query: str) -> List[str]:
    base_tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", str(query or "").lower())
    terms: List[str] = []
    seen = set()
    for token in base_tokens:
        if len(token) < 4:
            continue
        for candidate in (token, *NOTE_SEARCH_SYNONYMS.get(token, ())):
            text = str(candidate or "").strip().lower()
            if not text or text in seen:
                continue
            seen.add(text)
            terms.append(text)
            if len(terms) >= 24:
                return terms
    if not terms:
        terms = ["liquidity", "debt", "risk", "lease", "stock-based compensation"]
    return terms


def _query_requests_hard_flags(query: str) -> bool:
    text = str(query or "").strip().lower()
    if not text:
        return False
    return any(marker in text for marker in HARD_FLAG_QUERY_MARKERS)


def _serialize_retrieval_row(row: sqlite3.Row, keyword_score: Optional[float], match_reason: str) -> Dict[str, Any]:
    text = str(row["text"] or "")
    return {
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
        "match_reason": match_reason,
    }


def _query_note_section_fallback(
    conn: sqlite3.Connection,
    symbol: str,
    query: str,
    top_k: int,
    excluded_chunk_ids: Iterable[str],
) -> List[Dict[str, Any]]:
    excluded = {str(value) for value in excluded_chunk_ids if value}
    params: List[Any] = [symbol.upper()]
    clauses = ["LOWER(COALESCE(c.section_heading, '')) LIKE ?" for _ in NOTE_SECTION_HEADING_PATTERNS]
    params.extend(NOTE_SECTION_HEADING_PATTERNS)
    rows = conn.execute(
        f"""
        SELECT c.chunk_id, c.symbol, c.company, c.form, c.filing_date, c.report_date,
               c.accession_number, c.section_heading, c.source_markdown_file, c.text
        FROM retrieval_chunks c
        WHERE UPPER(COALESCE(c.symbol, '')) = ?
          AND ({' OR '.join(clauses)})
        ORDER BY c.filing_date DESC, c.row_id ASC
        LIMIT 160
        """,
        tuple(params),
    ).fetchall()

    query_terms = _build_note_search_terms(query)
    scored_rows: List[Tuple[int, Dict[str, Any]]] = []
    for row in rows:
        chunk_id = str(row["chunk_id"] or "")
        if chunk_id in excluded:
            continue
        heading = str(row["section_heading"] or "").lower()
        text = str(row["text"] or "").lower()

        score = 0
        if heading.startswith("notes to"):
            score += 30
        if "liquidity and capital resources" in heading:
            score += 24
        if "management's discussion" in heading:
            score += 18
        if "risk factors" in heading:
            score += 16
        if "legal proceedings" in heading:
            score += 14
        if "financial statements" in heading:
            score += 10

        for term in query_terms:
            if term in heading:
                score += 10
            elif term in text:
                score += 4

        if score <= 0:
            continue

        keyword_score = min(score / 100.0, 0.99)
        scored_rows.append((score, _serialize_retrieval_row(row, keyword_score, "note_section_fallback")))

    scored_rows.sort(
        key=lambda item: (
            -item[0],
            str(item[1].get("filing_date") or ""),
            str(item[1].get("chunk_id") or ""),
        ),
    )
    return [item[1] for item in scored_rows[: max(0, top_k)]]


def _query_hard_flag_fallback(
    conn: sqlite3.Connection,
    symbol: str,
    query: str,
    top_k: int,
    excluded_chunk_ids: Iterable[str],
) -> List[Dict[str, Any]]:
    excluded = {str(value) for value in excluded_chunk_ids if value}
    params: List[Any] = [symbol.upper()]
    clauses = ["LOWER(COALESCE(c.section_heading, '')) LIKE ?" for _ in HARD_FLAG_SECTION_HEADING_PATTERNS]
    params.extend(HARD_FLAG_SECTION_HEADING_PATTERNS)
    rows = conn.execute(
        f"""
        SELECT c.chunk_id, c.symbol, c.company, c.form, c.filing_date, c.report_date,
               c.accession_number, c.section_heading, c.source_markdown_file, c.text
        FROM retrieval_chunks c
        WHERE UPPER(COALESCE(c.symbol, '')) = ?
          AND (c.form = '8-K' OR {' OR '.join(clauses)})
        ORDER BY c.filing_date DESC, c.row_id ASC
        LIMIT 200
        """,
        tuple(params),
    ).fetchall()

    query_text = str(query or "").lower()
    scored_rows: List[Tuple[int, Dict[str, Any]]] = []
    for row in rows:
        chunk_id = str(row["chunk_id"] or "")
        if chunk_id in excluded:
            continue
        heading = str(row["section_heading"] or "").lower()
        text = str(row["text"] or "").lower()
        score = 0

        if str(row["form"] or "").upper() == "8-K":
            score += 18
        if "proposed acquisition" in heading:
            score += 60
        if "merger" in heading:
            score += 40
        if "definitive agreement" in text:
            score += 40
        if "merger agreement" in text:
            score += 40
        if "stockholders to receive" in text:
            score += 40
        if "contingent value right" in text or " cvr " in f" {text} ":
            score += 36
        if "to be acquired by" in text or "acquired by" in text:
            score += 36
        if "expected to close" in text:
            score += 24
        if "going private" in text or "take private" in text or "take-private" in text:
            score += 24

        if "chapter 11" in text or "going concern" in text or "forbearance" in text:
            score += 30
        if "restatement" in text or "material weakness" in text or "cannot rely on" in text:
            score += 30
        if "at-the-market" in text or "pipe" in text or "convertible note" in text:
            score += 24
        if "subpoena" in text or "warning letter" in text or "product recall" in text:
            score += 24

        for marker in HARD_FLAG_QUERY_MARKERS:
            if marker in query_text and marker in text:
                score += 6
            if marker in query_text and marker in heading:
                score += 10

        if score <= 0:
            continue

        keyword_score = min(score / 100.0, 0.99)
        scored_rows.append((score, _serialize_retrieval_row(row, keyword_score, "hard_flag_fallback")))

    scored_rows.sort(
        key=lambda item: (
            -item[0],
            str(item[1].get("filing_date") or ""),
            str(item[1].get("chunk_id") or ""),
        ),
        reverse=False,
    )
    return [item[1] for item in scored_rows[: max(0, top_k)]]


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
        keyword_score = _coerce_float(row["bm25_score"])
        if keyword_score is not None:
            keyword_score = 1.0 / (1.0 + max(keyword_score, 0.0))
        results.append(_serialize_retrieval_row(row, keyword_score, "fts_query"))

    retrieval_mode = "fts_fast"
    if _query_requests_hard_flags(query):
        conn = sqlite3.connect(RETRIEVAL_DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            event_rows = _query_hard_flag_fallback(
                conn,
                symbol,
                query,
                max(1, top_k),
                [],
            )
        finally:
            conn.close()
        if event_rows:
            merged_rows: List[Dict[str, Any]] = []
            seen_chunk_ids = set()
            for row in [*event_rows, *results]:
                chunk_id = str(row.get("chunk_id") or "")
                if not chunk_id or chunk_id in seen_chunk_ids:
                    continue
                seen_chunk_ids.add(chunk_id)
                merged_rows.append(row)
                if len(merged_rows) >= max(1, top_k):
                    break
            results = merged_rows
            retrieval_mode = "fts_fast_plus_hard_flag_fallback"

    if len(results) < max(2, top_k):
        conn = sqlite3.connect(RETRIEVAL_DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
          supplemental = _query_note_section_fallback(
              conn,
              symbol,
              query,
              max(1, top_k - len(results)),
              [row.get("chunk_id") for row in results],
          )
        finally:
          conn.close()
        if supplemental:
            results.extend(supplemental)
            retrieval_mode = "fts_fast_plus_note_fallback"

    return {
        "available": True,
        "query": query,
        "top_k": top_k,
        "results": results,
        "meta": {
            **meta,
            "retrieval_mode": retrieval_mode,
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
