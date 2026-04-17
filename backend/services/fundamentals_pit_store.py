#!/usr/bin/env python3
"""
Fundamentals PIT store.

Purpose
-------
Persist a point-in-time-oriented research store for fundamentals while keeping
the existing flattened UI snapshot cache intact.

This module does three jobs:

1. Preserve the current cached snapshot payload verbatim in `raw_source_cache`
2. Append every raw ingest to `raw_source_cache_history` for PIT auditability
3. Normalize historically meaningful facts / events into PIT tables
4. Materialize as-of snapshots for validator-style reads

Important
---------
The existing fundamentals cache remains the vendor/source-ish recovery layer.
This PIT store is the research/validator layer built from that cache.
`raw_source_cache` keeps the latest payload per symbol for fast recovery, while
`raw_source_cache_history` preserves the full raw ingest timeline.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_json(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _coerce_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text.upper() in {"N/A", "NA", "NULL", "--"}:
        return None
    if text.endswith("%"):
        text = text[:-1]
    if text.startswith("$"):
        text = text[1:]
    try:
        return float(text)
    except Exception:
        return None


def _coerce_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _iso_date(value: Any) -> Optional[str]:
    text = _coerce_text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%b %d '%y", "%b %d %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except Exception:
            continue
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def _date_from_epoch_ms(value: Any) -> Optional[str]:
    try:
        ms = int(value)
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).date().isoformat()
    except Exception:
        return None


def _quarter_period_end(period: Optional[str]) -> Optional[str]:
    text = _coerce_text(period)
    if not text:
        return None
    if len(text) != 6 or text[4] != "Q":
        return None
    try:
        year = int(text[:4])
        quarter = int(text[5])
    except Exception:
        return None
    mapping = {
        1: f"{year}-03-31",
        2: f"{year}-06-30",
        3: f"{year}-09-30",
        4: f"{year}-12-31",
    }
    return mapping.get(quarter)


STATEMENT_FACT_FIELDS: Sequence[str] = (
    "floatShares",
    "sharesOutstanding",
    "institutionalOwnershipPct",
    "insiderOwnershipPct",
    "revenueGrowthPct",
    "earningsGrowthPct",
    "revenueYoYGrowthPct",
    "revenueQoQGrowthPct",
    "epsYoYGrowthPct",
    "epsQoQGrowthPct",
    "grossMarginPct",
    "operatingMarginPct",
    "profitMarginPct",
    "returnOnEquityPct",
    "returnOnAssetsPct",
    "salesSurprisePct",
    "epsSurprisePct",
    "totalCash",
    "totalDebt",
    "operatingCashFlowTTM",
    "freeCashFlowTTM",
    "debtToEquity",
    "currentRatio",
    "quickRatio",
)

MARKET_FACT_FIELDS: Sequence[str] = (
    "currentPrice",
    "targetPrice",
    "marketCap",
    "enterpriseValue",
    "averageVolume",
    "volume",
    "relativeVolume",
    "shortFloatPct",
    "shortRatio",
    "beta",
    "atr14",
    "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow",
)

MARKET_CONTEXT_FACT_FIELDS: Sequence[Tuple[str, str]] = (
    ("marketContext.fiftyDayMovingAverage", "fiftyDayMovingAverage"),
    ("marketContext.twoHundredDayMovingAverage", "twoHundredDayMovingAverage"),
    ("marketContext.fiftyTwoWeekChangePct", "fiftyTwoWeekChangePct"),
    ("marketContext.avgVolume3Month", "avgVolume3Month"),
)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS raw_source_cache (
    symbol TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    fetched_at_ms INTEGER,
    fetched_at_date TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_source_cache_history (
    symbol TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at_ms INTEGER,
    fetched_at_date TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, source, fetched_at_ms, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_source_cache_history_symbol_fetched
    ON raw_source_cache_history(symbol, fetched_at_ms);

CREATE TABLE IF NOT EXISTS pit_fundamental_facts (
    symbol TEXT NOT NULL,
    metric TEXT NOT NULL,
    value_numeric REAL,
    value_text TEXT,
    value_type TEXT NOT NULL,
    classification TEXT NOT NULL,
    period_type TEXT,
    period_end TEXT,
    published_at TEXT,
    available_at TEXT NOT NULL,
    availability_basis TEXT,
    source TEXT NOT NULL,
    source_path TEXT,
    source_record_hash TEXT NOT NULL,
    fetched_at_ms INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, metric, available_at, source, source_record_hash)
);

CREATE INDEX IF NOT EXISTS idx_pit_fundamental_facts_symbol_metric_available
    ON pit_fundamental_facts(symbol, metric, available_at);

CREATE TABLE IF NOT EXISTS pit_market_facts (
    symbol TEXT NOT NULL,
    metric TEXT NOT NULL,
    value_numeric REAL,
    value_text TEXT,
    value_type TEXT NOT NULL,
    market_date TEXT NOT NULL,
    available_at TEXT NOT NULL,
    source TEXT NOT NULL,
    source_path TEXT,
    source_record_hash TEXT NOT NULL,
    fetched_at_ms INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, metric, market_date, source, source_record_hash)
);

CREATE INDEX IF NOT EXISTS idx_pit_market_facts_symbol_metric_date
    ON pit_market_facts(symbol, metric, market_date);

CREATE TABLE IF NOT EXISTS pit_event_facts (
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    available_at TEXT NOT NULL,
    period TEXT,
    period_end TEXT,
    payload_json TEXT NOT NULL,
    source TEXT NOT NULL,
    source_path TEXT,
    source_record_hash TEXT NOT NULL,
    fetched_at_ms INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, event_type, event_date, source, source_record_hash)
);

CREATE INDEX IF NOT EXISTS idx_pit_event_facts_symbol_type_date
    ON pit_event_facts(symbol, event_type, event_date);

CREATE TABLE IF NOT EXISTS pit_documents (
    symbol TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_document TEXT NOT NULL,
    company TEXT,
    cik TEXT,
    form_type TEXT,
    filing_date TEXT,
    report_date TEXT,
    filing_url TEXT,
    raw_file_path TEXT,
    markdown_file_path TEXT,
    json_file_path TEXT,
    metadata_file_path TEXT,
    payload_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, source_type, source_document)
);

CREATE INDEX IF NOT EXISTS idx_pit_documents_symbol_form_date
    ON pit_documents(symbol, form_type, filing_date);

CREATE TABLE IF NOT EXISTS pit_statement_facts (
    symbol TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    value_numeric REAL,
    value_text TEXT,
    value_type TEXT NOT NULL,
    fact_origin TEXT NOT NULL,
    unit TEXT,
    scale TEXT,
    currency TEXT,
    period_type TEXT NOT NULL,
    period_end TEXT NOT NULL,
    fiscal_year INTEGER,
    fiscal_quarter INTEGER,
    filing_date TEXT,
    available_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_document TEXT NOT NULL,
    evidence_ref TEXT,
    confidence REAL,
    source_path TEXT,
    source_record_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, fact_key, period_end, available_at, source_document, source_record_hash)
);

CREATE INDEX IF NOT EXISTS idx_pit_statement_facts_symbol_key_available
    ON pit_statement_facts(symbol, fact_key, available_at);

CREATE INDEX IF NOT EXISTS idx_pit_statement_facts_symbol_period
    ON pit_statement_facts(symbol, period_type, period_end);

CREATE TABLE IF NOT EXISTS asof_symbol_snapshots (
    symbol TEXT NOT NULL,
    asof_date TEXT NOT NULL,
    snapshot_kind TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    source_max_available_at TEXT,
    formula_version TEXT,
    built_at TEXT NOT NULL,
    PRIMARY KEY (symbol, asof_date, snapshot_kind)
);
"""


def connect(db_path: Path | str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


@dataclass
class IngestSummary:
    symbol: str
    raw_rows: int = 0
    fundamental_rows: int = 0
    market_rows: int = 0
    event_rows: int = 0
    snapshots_built: int = 0


@dataclass
class FilingImportSummary:
    symbol: str
    source_document: str
    document_rows: int = 0
    statement_rows: int = 0


def _upsert_latest_raw_snapshot(
    conn: sqlite3.Connection,
    symbol: str,
    fetched_at_ms: Optional[int],
    payload: Dict[str, Any],
) -> None:
    conn.execute(
        """
        INSERT INTO raw_source_cache (
            symbol, source, fetched_at_ms, fetched_at_date, payload_json, payload_hash, updated_at
        ) VALUES (?, 'fundamentals-cache', ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            fetched_at_ms = excluded.fetched_at_ms,
            fetched_at_date = excluded.fetched_at_date,
            payload_json = excluded.payload_json,
            payload_hash = excluded.payload_hash,
            updated_at = excluded.updated_at
        """,
        (
            symbol,
            fetched_at_ms,
            _date_from_epoch_ms(fetched_at_ms),
            json.dumps(payload, ensure_ascii=True, sort_keys=True),
            _sha256_json(payload),
            _utc_now_iso(),
        ),
    )


def _insert_raw_snapshot_history(
    conn: sqlite3.Connection,
    symbol: str,
    fetched_at_ms: Optional[int],
    payload: Dict[str, Any],
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO raw_source_cache_history (
            symbol, source, fetched_at_ms, fetched_at_date, payload_json, payload_hash, updated_at
        ) VALUES (?, 'fundamentals-cache', ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            fetched_at_ms,
            _date_from_epoch_ms(fetched_at_ms),
            json.dumps(payload, ensure_ascii=True, sort_keys=True),
            _sha256_json(payload),
            _utc_now_iso(),
        ),
    )


def _docling_label_to_iso_date(value: Any) -> Optional[str]:
    text = _coerce_text(value)
    if not text:
        return None
    for fmt in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except Exception:
            continue
    return _iso_date(text)


def _infer_document_scale(markdown_path: Optional[str]) -> Optional[str]:
    if not markdown_path:
        return None
    try:
        markdown_lines = Path(markdown_path).read_text(encoding="utf-8").splitlines()
    except Exception:
        return None
    distinct_scales = {
        scale
        for line in markdown_lines
        for scale in [_extract_scale_from_text(line)]
        if scale and _looks_like_scale_header_line(line)
    }
    if len(distinct_scales) == 1:
        return next(iter(distinct_scales))
    return None


def _extract_scale_from_text(text: Optional[str]) -> Optional[str]:
    lowered = str(text or "").lower()
    if re.search(r"\b(?:in\s+)?billions?\b", lowered):
        return "billions"
    if re.search(r"\b(?:in\s+)?millions?\b", lowered):
        return "millions"
    if re.search(r"\b(?:in\s+)?thousands?\b", lowered):
        return "thousands"
    return None


def _looks_like_scale_header_line(text: Optional[str]) -> bool:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return False
    if not _extract_scale_from_text(lowered):
        return False
    if any(token in lowered for token in (" u.s. dollars", " us dollars", " usd", "(millions", "(billions", "(thousands")):
        return True
    if "tabular dollars" in lowered or "presented in millions" in lowered or "presented in billions" in lowered or "presented in thousands" in lowered:
        return True
    if len(lowered) > 140:
        return False
    if lowered.startswith("|") and lowered.count("|") >= 2:
        return True
    if lowered.startswith("(") and lowered.endswith(")"):
        return True
    return False


def _looks_like_numeric_evidence_line(text: Optional[str]) -> bool:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return False
    if "$" in lowered or "," in lowered or "e+" in lowered or "e-" in lowered:
        return True
    numeric_tokens = re.findall(r"\d+(?:\.\d+)?", lowered)
    long_tokens = [token for token in numeric_tokens if len(token.replace(".", "")) >= 5]
    return len(long_tokens) >= 2


def _infer_fact_scale(markdown_path: Optional[str], evidence_lines: Optional[List[str]]) -> Optional[str]:
    if evidence_lines:
        for line in evidence_lines:
            scale = _extract_scale_from_text(line)
            if scale and _looks_like_scale_header_line(line):
                return scale

    if markdown_path and evidence_lines:
        try:
            markdown_lines = Path(markdown_path).read_text(encoding="utf-8").splitlines()
        except Exception:
            markdown_lines = []
        if markdown_lines:
            normalized_candidates = [str(line or "").strip() for line in evidence_lines if str(line or "").strip()]
            preferred_candidates = [candidate for candidate in normalized_candidates if _looks_like_numeric_evidence_line(candidate)]
            if not preferred_candidates:
                preferred_candidates = [candidate for candidate in normalized_candidates if any(char.isdigit() for char in candidate)]
            candidate_pool = preferred_candidates or normalized_candidates
            matched_indexes: List[int] = []

            for idx, markdown_line in enumerate(markdown_lines):
                normalized_markdown = str(markdown_line or "").strip()
                if normalized_markdown and any(candidate and candidate == normalized_markdown for candidate in candidate_pool):
                    matched_indexes.append(idx)

            if not matched_indexes:
                for idx, markdown_line in enumerate(markdown_lines):
                    normalized_markdown = str(markdown_line or "").strip()
                    if not normalized_markdown:
                        continue
                    if any(candidate and candidate in normalized_markdown for candidate in candidate_pool):
                        matched_indexes.append(idx)

            for idx in matched_indexes:
                window_start = max(0, idx - 12)
                window_end = min(len(markdown_lines), idx + 3)
                for probe_line in reversed(markdown_lines[window_start:window_end]):
                    scale = _extract_scale_from_text(probe_line)
                    if scale and _looks_like_scale_header_line(probe_line):
                        return scale

                broader_window_start = max(0, idx - 120)
                for probe_line in reversed(markdown_lines[broader_window_start:window_start]):
                    lowered_probe = str(probe_line or "").strip().lower()
                    if "tabular dollars" not in lowered_probe and "presented in " not in lowered_probe:
                        continue
                    scale = _extract_scale_from_text(probe_line)
                    if scale and _looks_like_scale_header_line(probe_line):
                        return scale

    return _infer_document_scale(markdown_path)


def _statement_metric_metadata(fact_key: str) -> Tuple[str, Optional[str], str]:
    currency_metrics = {
        "revenue",
        "operating_income",
        "net_income",
        "current_assets",
        "current_liabilities",
        "shareholders_equity",
        "total_equity",
        "operating_cash_flow",
        "capital_expenditures",
        "free_cash_flow",
    }
    origin = "derived" if fact_key in {"free_cash_flow"} else "reported"
    if fact_key in currency_metrics:
        return ("currency", "USD", origin)
    return ("number", None, origin)


def _filing_period_type(form_type: Optional[str]) -> str:
    form = str(form_type or "").strip().upper()
    if form == "10-K":
        return "annual"
    if form == "10-Q":
        return "quarterly"
    return "statement"


def _fiscal_year_for_period(period_end: Optional[str], period_type: str) -> Optional[int]:
    if period_type != "annual" or not period_end:
        return None
    try:
        return int(period_end[:4])
    except Exception:
        return None


def _fiscal_quarter_for_period(period_end: Optional[str], period_type: str) -> Optional[int]:
    if period_type != "quarterly" or not period_end:
        return None
    try:
        month = int(period_end[5:7])
    except Exception:
        return None
    return ((month - 1) // 3) + 1


def _insert_pit_document(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    source_type: str,
    source_document: str,
    company: Optional[str],
    cik: Optional[str],
    form_type: Optional[str],
    filing_date: Optional[str],
    report_date: Optional[str],
    filing_url: Optional[str],
    raw_file_path: Optional[str],
    markdown_file_path: Optional[str],
    json_file_path: Optional[str],
    metadata_file_path: Optional[str],
) -> bool:
    payload_hash = _sha256_json(
        {
            "symbol": symbol,
            "source_type": source_type,
            "source_document": source_document,
            "company": company,
            "cik": cik,
            "form_type": form_type,
            "filing_date": filing_date,
            "report_date": report_date,
            "filing_url": filing_url,
            "raw_file_path": raw_file_path,
            "markdown_file_path": markdown_file_path,
            "json_file_path": json_file_path,
            "metadata_file_path": metadata_file_path,
        }
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO pit_documents (
            symbol, source_type, source_document, company, cik, form_type,
            filing_date, report_date, filing_url, raw_file_path,
            markdown_file_path, json_file_path, metadata_file_path,
            payload_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            source_type,
            source_document,
            company,
            cik,
            form_type,
            filing_date,
            report_date,
            filing_url,
            raw_file_path,
            markdown_file_path,
            json_file_path,
            metadata_file_path,
            payload_hash,
            _utc_now_iso(),
        ),
    )
    return True


def _insert_statement_fact(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    fact_key: str,
    value: Any,
    fact_origin: str,
    unit: Optional[str],
    scale: Optional[str],
    currency: Optional[str],
    period_type: str,
    period_end: str,
    fiscal_year: Optional[int],
    fiscal_quarter: Optional[int],
    filing_date: Optional[str],
    available_at: str,
    source_type: str,
    source_document: str,
    evidence_ref: Optional[str],
    confidence: Optional[float],
    source_path: Optional[str],
) -> bool:
    value_numeric = _coerce_float(value)
    value_text = None if value_numeric is not None else _coerce_text(value)
    if value_numeric is None and value_text is None:
        return False
    value_type = "number" if value_numeric is not None else "text"
    record_hash = _sha256_json(
        {
            "symbol": symbol,
            "fact_key": fact_key,
            "value_numeric": value_numeric,
            "value_text": value_text,
            "fact_origin": fact_origin,
            "unit": unit,
            "scale": scale,
            "currency": currency,
            "period_type": period_type,
            "period_end": period_end,
            "fiscal_year": fiscal_year,
            "fiscal_quarter": fiscal_quarter,
            "filing_date": filing_date,
            "available_at": available_at,
            "source_type": source_type,
            "source_document": source_document,
            "evidence_ref": evidence_ref,
            "confidence": confidence,
            "source_path": source_path,
        }
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO pit_statement_facts (
            symbol, fact_key, value_numeric, value_text, value_type, fact_origin,
            unit, scale, currency, period_type, period_end, fiscal_year, fiscal_quarter,
            filing_date, available_at, source_type, source_document, evidence_ref,
            confidence, source_path, source_record_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            fact_key,
            value_numeric,
            value_text,
            value_type,
            fact_origin,
            unit,
            scale,
            currency,
            period_type,
            period_end,
            fiscal_year,
            fiscal_quarter,
            filing_date,
            available_at,
            source_type,
            source_document,
            evidence_ref,
            confidence,
            source_path,
            record_hash,
            _utc_now_iso(),
        ),
    )
    return True


def _insert_fundamental_fact(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    metric: str,
    value: Any,
    classification: str,
    period_type: Optional[str],
    period_end: Optional[str],
    published_at: Optional[str],
    available_at: str,
    availability_basis: Optional[str],
    source: str,
    source_path: str,
    fetched_at_ms: Optional[int],
) -> bool:
    value_numeric = _coerce_float(value)
    value_text = None if value_numeric is not None else _coerce_text(value)
    if value_numeric is None and value_text is None:
        return False
    value_type = "number" if value_numeric is not None else "text"
    record_hash = _sha256_json({
        "symbol": symbol,
        "metric": metric,
        "value_numeric": value_numeric,
        "value_text": value_text,
        "period_type": period_type,
        "period_end": period_end,
        "published_at": published_at,
        "available_at": available_at,
        "source": source,
        "source_path": source_path,
    })
    conn.execute(
        """
        INSERT OR REPLACE INTO pit_fundamental_facts (
            symbol, metric, value_numeric, value_text, value_type, classification,
            period_type, period_end, published_at, available_at, availability_basis,
            source, source_path, source_record_hash, fetched_at_ms, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol, metric, value_numeric, value_text, value_type, classification,
            period_type, period_end, published_at, available_at, availability_basis,
            source, source_path, record_hash, fetched_at_ms, _utc_now_iso(),
        ),
    )
    return True


def _insert_market_fact(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    metric: str,
    value: Any,
    market_date: str,
    source: str,
    source_path: str,
    fetched_at_ms: Optional[int],
) -> bool:
    value_numeric = _coerce_float(value)
    value_text = None if value_numeric is not None else _coerce_text(value)
    if value_numeric is None and value_text is None:
        return False
    value_type = "number" if value_numeric is not None else "text"
    record_hash = _sha256_json({
        "symbol": symbol,
        "metric": metric,
        "value_numeric": value_numeric,
        "value_text": value_text,
        "market_date": market_date,
        "source": source,
        "source_path": source_path,
    })
    conn.execute(
        """
        INSERT OR REPLACE INTO pit_market_facts (
            symbol, metric, value_numeric, value_text, value_type, market_date,
            available_at, source, source_path, source_record_hash, fetched_at_ms, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol, metric, value_numeric, value_text, value_type, market_date,
            market_date, source, source_path, record_hash, fetched_at_ms, _utc_now_iso(),
        ),
    )
    return True


def _insert_event_fact(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    event_type: str,
    event_date: str,
    available_at: str,
    period: Optional[str],
    period_end: Optional[str],
    payload: Dict[str, Any],
    source: str,
    source_path: str,
    fetched_at_ms: Optional[int],
) -> bool:
    record_hash = _sha256_json({
        "symbol": symbol,
        "event_type": event_type,
        "event_date": event_date,
        "period": period,
        "period_end": period_end,
        "payload": payload,
        "source": source,
        "source_path": source_path,
    })
    conn.execute(
        """
        INSERT OR REPLACE INTO pit_event_facts (
            symbol, event_type, event_date, available_at, period, period_end,
            payload_json, source, source_path, source_record_hash, fetched_at_ms, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol, event_type, event_date, available_at, period, period_end,
            json.dumps(payload, ensure_ascii=True, sort_keys=True),
            source, source_path, record_hash, fetched_at_ms, _utc_now_iso(),
        ),
    )
    return True


def _merge_unique_rows(rows: Iterable[Dict[str, Any]], keys: Sequence[str]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        identity = tuple(str(row.get(key) or "").strip() for key in keys)
        if not any(identity):
            continue
        if identity in seen:
            continue
        seen.add(identity)
        out.append(row)
    return out


def _extract_statement_anchor(snapshot: Dict[str, Any], fetched_at_ms: Optional[int]) -> Tuple[Optional[str], str, Optional[str]]:
    published_at = _iso_date(snapshot.get("lastEarningsDate"))
    if published_at:
        return published_at, "last_earnings_date", published_at
    fetched_date = _date_from_epoch_ms(fetched_at_ms)
    return fetched_date, "fetched_at", None


def _ingest_historical_statements(
    conn: sqlite3.Connection,
    *,
    symbol: str,
    snapshot: Dict[str, Any],
    fetched_at_ms: Optional[int],
) -> int:
    block = snapshot.get("historicalStatements") or {}
    quarterly_rows = block.get("quarterly") if isinstance(block, dict) else None
    if not isinstance(quarterly_rows, list):
        return 0

    inserted_rows = 0
    for row in quarterly_rows:
        if not isinstance(row, dict):
            continue
        period = _coerce_text(row.get("period"))
        period_end = _iso_date(row.get("periodEnd")) or _quarter_period_end(period)
        available_at = _iso_date(row.get("availableAt"))
        availability_basis = _coerce_text(row.get("availabilityBasis")) or "historical_statement_series"
        metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
        if not period_end or not available_at or not metrics:
            continue

        for metric, value in metrics.items():
            metric_name = _coerce_text(metric)
            if not metric_name:
                continue
            inserted = _insert_fundamental_fact(
                conn,
                symbol=symbol,
                metric=metric_name,
                value=value,
                classification="pit_historical_statement",
                period_type="quarterly",
                period_end=period_end,
                published_at=available_at,
                available_at=available_at,
                availability_basis=availability_basis,
                source="historical_statements",
                source_path=f"historicalStatements.quarterly.{metric_name}",
                fetched_at_ms=fetched_at_ms,
            )
            inserted_rows += int(inserted)
    return inserted_rows


def _build_current_snapshot(symbol: str, asof_date: str, raw_payload: Dict[str, Any], source_max_available_at: Optional[str]) -> Dict[str, Any]:
    return {
        "symbol": symbol,
        "asof_date": asof_date,
        "source_max_available_at": source_max_available_at,
        "raw": raw_payload.get("data") or {},
    }


def rebuild_asof_snapshot(
    conn: sqlite3.Connection,
    symbol: str,
    asof_date: str,
    raw_payload: Dict[str, Any],
) -> bool:
    source_max_available_at = None
    row = conn.execute(
        """
        SELECT MAX(available_at) AS max_available_at
        FROM (
            SELECT available_at FROM pit_fundamental_facts WHERE symbol = ? AND available_at <= ?
            UNION ALL
            SELECT available_at FROM pit_market_facts WHERE symbol = ? AND available_at <= ?
            UNION ALL
            SELECT available_at FROM pit_event_facts WHERE symbol = ? AND available_at <= ?
        )
        """,
        (symbol, asof_date, symbol, asof_date, symbol, asof_date),
    ).fetchone()
    if row:
        source_max_available_at = row["max_available_at"]

    snapshot = _build_current_snapshot(symbol, asof_date, raw_payload, source_max_available_at)
    conn.execute(
        """
        INSERT OR REPLACE INTO asof_symbol_snapshots (
            symbol, asof_date, snapshot_kind, snapshot_json,
            source_max_available_at, formula_version, built_at
        ) VALUES (?, ?, 'current_flattened_snapshot', ?, ?, 'v1', ?)
        """,
        (
            symbol,
            asof_date,
            json.dumps(snapshot, ensure_ascii=True, sort_keys=True),
            source_max_available_at,
            _utc_now_iso(),
        ),
    )
    return True


def ingest_canonical_filing_payload(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    *,
    symbol: str,
    canonical_file_path: Optional[str] = None,
) -> FilingImportSummary:
    filing = payload.get("filing") or {}
    source_type = _coerce_text(payload.get("source_type")) or "sec_docling_probe"
    source_document = _coerce_text(filing.get("accession_number")) or "UNKNOWN_DOCUMENT"
    summary = FilingImportSummary(symbol=symbol, source_document=source_document)

    markdown_file = _coerce_text(payload.get("markdown_file"))
    metadata_file = _coerce_text(payload.get("fetch_metadata_file"))
    metadata_payload: Dict[str, Any] = {}
    if metadata_file:
        try:
            metadata_payload = json.loads(Path(metadata_file).read_text(encoding="utf-8"))
        except Exception:
            metadata_payload = {}

    report_date = _iso_date(metadata_payload.get("report_date"))
    filing_date = _iso_date(filing.get("filing_date"))
    available_at = filing_date or report_date or _utc_now_iso()[:10]
    form_type = _coerce_text(filing.get("form"))
    json_file_path = None
    if markdown_file:
        candidate = str(Path(markdown_file).with_suffix(".json"))
        if Path(candidate).exists():
            json_file_path = candidate

    inserted_document = _insert_pit_document(
        conn,
        symbol=symbol,
        source_type=source_type,
        source_document=source_document,
        company=_coerce_text(filing.get("company")),
        cik=_coerce_text(filing.get("cik")),
        form_type=form_type,
        filing_date=filing_date,
        report_date=report_date,
        filing_url=_coerce_text(filing.get("filing_url")),
        raw_file_path=_coerce_text(metadata_payload.get("downloaded_to")),
        markdown_file_path=markdown_file,
        json_file_path=json_file_path,
        metadata_file_path=metadata_file,
    )
    summary.document_rows += int(inserted_document)

    conn.execute(
        """
        DELETE FROM pit_statement_facts
        WHERE symbol = ?
          AND source_type = ?
          AND source_document = ?
        """,
        (symbol, source_type, source_document),
    )

    period_type = _filing_period_type(form_type)
    facts = payload.get("facts") or {}
    evidence = payload.get("evidence") or {}
    for fact_key, values in facts.items():
        if not isinstance(values, dict):
            continue
        unit, currency, fact_origin = _statement_metric_metadata(str(fact_key))
        evidence_lines = evidence.get(fact_key) if isinstance(evidence.get(fact_key), list) else None
        scale = _infer_fact_scale(markdown_file, evidence_lines)
        evidence_ref = None
        if evidence_lines:
            evidence_ref = json.dumps(
                {
                    "kind": "docling_markdown_lines",
                    "fact_key": fact_key,
                    "markdown_file": markdown_file,
                    "lines": evidence_lines,
                },
                ensure_ascii=True,
                sort_keys=True,
            )
        for period_label, value in values.items():
            period_end = _docling_label_to_iso_date(period_label)
            if not period_end:
                continue
            inserted = _insert_statement_fact(
                conn,
                symbol=symbol,
                fact_key=str(fact_key),
                value=value,
                fact_origin=fact_origin,
                unit=unit,
                scale=scale,
                currency=currency,
                period_type=period_type,
                period_end=period_end,
                fiscal_year=_fiscal_year_for_period(period_end, period_type),
                fiscal_quarter=_fiscal_quarter_for_period(period_end, period_type),
                filing_date=filing_date,
                available_at=available_at,
                source_type=source_type,
                source_document=source_document,
                evidence_ref=evidence_ref,
                confidence=1.0,
                source_path=canonical_file_path or markdown_file,
            )
            summary.statement_rows += int(inserted)

    conn.commit()
    return summary


def ingest_canonical_filing_payload_file(
    canonical_file: Path | str,
    conn: sqlite3.Connection,
    *,
    symbol: str,
) -> FilingImportSummary:
    canonical_path = Path(canonical_file)
    payload = json.loads(canonical_path.read_text(encoding="utf-8"))
    return ingest_canonical_filing_payload(conn, payload, symbol=symbol, canonical_file_path=str(canonical_path))


def ingest_cached_snapshot(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
) -> IngestSummary:
    symbol = _coerce_text(payload.get("symbol")) or _coerce_text((payload.get("data") or {}).get("symbol")) or "UNKNOWN"
    fetched_at_ms = None
    try:
        fetched_at_ms = int(payload.get("fetchedAt")) if payload.get("fetchedAt") is not None else None
    except Exception:
        fetched_at_ms = None
    data = payload.get("data") or {}
    summary = IngestSummary(symbol=symbol)

    _upsert_latest_raw_snapshot(conn, symbol, fetched_at_ms, payload)
    _insert_raw_snapshot_history(conn, symbol, fetched_at_ms, payload)
    summary.raw_rows += 1

    statement_available_at, availability_basis, statement_published_at = _extract_statement_anchor(data, fetched_at_ms)
    fetched_date = _date_from_epoch_ms(fetched_at_ms) or statement_available_at or _utc_now_iso()[:10]

    for metric in STATEMENT_FACT_FIELDS:
        if metric in data and statement_available_at:
            inserted = _insert_fundamental_fact(
                conn,
                symbol=symbol,
                metric=metric,
                value=data.get(metric),
                classification="pit_fact",
                period_type="statement_snapshot",
                period_end=statement_published_at,
                published_at=statement_published_at,
                available_at=statement_available_at,
                availability_basis=availability_basis,
                source="flattened_snapshot",
                source_path=metric,
                fetched_at_ms=fetched_at_ms,
            )
            summary.fundamental_rows += int(inserted)

    summary.fundamental_rows += _ingest_historical_statements(
        conn,
        symbol=symbol,
        snapshot=data,
        fetched_at_ms=fetched_at_ms,
    )

    for metric in MARKET_FACT_FIELDS:
        if metric in data and fetched_date:
            inserted = _insert_market_fact(
                conn,
                symbol=symbol,
                metric=metric,
                value=data.get(metric),
                market_date=fetched_date,
                source="flattened_snapshot",
                source_path=metric,
                fetched_at_ms=fetched_at_ms,
            )
            summary.market_rows += int(inserted)

    market_context = data.get("marketContext") or {}
    for metric_name, source_key in MARKET_CONTEXT_FACT_FIELDS:
        if source_key in market_context and fetched_date:
            inserted = _insert_market_fact(
                conn,
                symbol=symbol,
                metric=metric_name,
                value=market_context.get(source_key),
                market_date=fetched_date,
                source="flattened_snapshot",
                source_path=f"marketContext.{source_key}",
                fetched_at_ms=fetched_at_ms,
            )
            summary.market_rows += int(inserted)

    earnings_rows = _merge_unique_rows(
        list((data.get("reportedExecution") or {}).get("history") or []) + list((data.get("stockdex") or {}).get("earningsHistory") or []),
        keys=("period", "date"),
    )
    for row in earnings_rows:
        event_date = _iso_date(row.get("date"))
        if not event_date:
            continue
        period = _coerce_text(row.get("period"))
        period_end = _quarter_period_end(period)
        inserted = _insert_event_fact(
            conn,
            symbol=symbol,
            event_type="earnings_report",
            event_date=event_date,
            available_at=event_date,
            period=period,
            period_end=period_end,
            payload=row,
            source="earnings_history",
            source_path="reportedExecution.history",
            fetched_at_ms=fetched_at_ms,
        )
        summary.event_rows += int(inserted)
        for metric_key in ("epsActual", "epsEstimate", "salesActual", "salesEstimate", "epsSurprisePct", "salesSurprisePct"):
            if row.get(metric_key) is None:
                continue
            inserted_fact = _insert_fundamental_fact(
                conn,
                symbol=symbol,
                metric=f"earnings_report.{metric_key}",
                value=row.get(metric_key),
                classification="pit_event_fact",
                period_type="quarterly",
                period_end=period_end,
                published_at=event_date,
                available_at=event_date,
                availability_basis="reported_event_date",
                source="earnings_history",
                source_path=f"earningsHistory.{metric_key}",
                fetched_at_ms=fetched_at_ms,
            )
            summary.fundamental_rows += int(inserted_fact)

    insider_rows = _merge_unique_rows(
        list((data.get("positioning") or {}).get("recentTrades") or []) + list((data.get("stockdex") or {}).get("insiderTrades") or []),
        keys=("insider", "date", "transaction", "value"),
    )
    for row in insider_rows:
        event_date = _iso_date(row.get("date"))
        if not event_date:
            continue
        inserted = _insert_event_fact(
            conn,
            symbol=symbol,
            event_type="insider_trade",
            event_date=event_date,
            available_at=event_date,
            period=None,
            period_end=None,
            payload=row,
            source="insider_trades",
            source_path="stockdex.insiderTrades",
            fetched_at_ms=fetched_at_ms,
        )
        summary.event_rows += int(inserted)

    holder_rows = _merge_unique_rows(
        list((data.get("ownership") or {}).get("topInstitutionalHolders") or []) + list((data.get("stockdex") or {}).get("topInstitutionalHolders") or []),
        keys=("holder", "shares", "pctOut"),
    )
    for row in holder_rows:
        if not fetched_date:
            continue
        inserted = _insert_event_fact(
            conn,
            symbol=symbol,
            event_type="institutional_holder_snapshot",
            event_date=fetched_date,
            available_at=fetched_date,
            period=None,
            period_end=None,
            payload=row,
            source="institutional_holders",
            source_path="ownership.topInstitutionalHolders",
            fetched_at_ms=fetched_at_ms,
        )
        summary.event_rows += int(inserted)

    if data.get("earningsDate"):
        event_date = _iso_date(data.get("earningsDate"))
        if event_date:
            inserted = _insert_event_fact(
                conn,
                symbol=symbol,
                event_type="next_earnings_date_snapshot",
                event_date=event_date,
                available_at=fetched_date,
                period=None,
                period_end=None,
                payload={"earningsDate": data.get("earningsDate")},
                source="flattened_snapshot",
                source_path="earningsDate",
                fetched_at_ms=fetched_at_ms,
            )
            summary.event_rows += int(inserted)

    if rebuild_asof_snapshot(conn, symbol, fetched_date, payload):
        summary.snapshots_built += 1

    conn.commit()
    return summary


def ingest_cached_snapshot_file(
    cache_file: Path | str,
    conn: sqlite3.Connection,
) -> IngestSummary:
    payload = json.loads(Path(cache_file).read_text(encoding="utf-8"))
    return ingest_cached_snapshot(conn, payload)


def build_store_from_cache(
    cache_dir: Path | str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> Dict[str, Any]:
    conn = connect(db_path)
    ensure_schema(conn)
    summaries: List[IngestSummary] = []
    for cache_file in sorted(Path(cache_dir).glob("*.json")):
        summaries.append(ingest_cached_snapshot_file(cache_file, conn))
    conn.close()
    return {
        "db_path": str(Path(db_path)),
        "symbols_processed": len(summaries),
        "raw_rows": sum(item.raw_rows for item in summaries),
        "fundamental_rows": sum(item.fundamental_rows for item in summaries),
        "market_rows": sum(item.market_rows for item in summaries),
        "event_rows": sum(item.event_rows for item in summaries),
        "snapshots_built": sum(item.snapshots_built for item in summaries),
        "symbols": [item.symbol for item in summaries],
    }

