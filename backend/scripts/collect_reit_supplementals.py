"""Collect and normalize REIT supplemental reporting documents.

This is the first layer of the REIT data pipeline:

1. Build a source map for REITs in the clean universe.
2. Discover candidate supplemental PDFs from company IR pages and SEC 8-K exhibits.
3. Download documents into backend/data/reit-supplementals.
4. Extract basic text and metric candidates into a SQLite store.

The extractor is intentionally conservative. It stores evidence snippets and
candidate values, but the valuation engine should only treat a metric as high
confidence once the label/source pattern is proven for that issuer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import requests
except Exception:  # pragma: no cover - script can still explain the missing dependency
    requests = None

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
SUPPLEMENTAL_DIR = DATA_DIR / "reit-supplementals"
SOURCE_MAP_PATH = SUPPLEMENTAL_DIR / "source-map.json"
DB_PATH = SUPPLEMENTAL_DIR / "reit-supplementals.sqlite"
CATALOG_DB_PATH = DATA_DIR / "symbol-catalog.sqlite"
TICKERS_CACHE = DATA_DIR / "company_tickers.json"

USER_AGENT = "PatternDetector/1.0 reit-supplemental-collector contact@example.com"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
SEC_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"
REQUEST_DELAY_S = 0.25

DOC_KEYWORDS = (
    "supplemental",
    "financial supplement",
    "supplemental financial",
    "quarterly supplement",
    "quarterly results",
    "earnings release",
    "earnings presentation",
    "investor presentation",
    "financial information",
)

METRIC_PATTERNS: Dict[str, Sequence[re.Pattern[str]]] = {
    "ffo_per_share": (
        re.compile(r"(?:nareit[-\s]defined\s+)?ffo\s+per\s+(?:diluted\s+)?share\s+guidance[^$]{0,120}\$\s*(-?\d+(?:\.\d+)?)\s+(?:to|-)\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
        re.compile(r"funds\s+from\s+operations[^\\n]{0,120}per\s+(?:diluted\s+)?share\s+guidance[^$]{0,120}\$\s*(-?\d+(?:\.\d+)?)\s+(?:to|-)\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
        re.compile(r"(?:nareit\s+)?ffo(?:\s+as\s+adjusted|\s+attributable)?\s+per\s+(?:diluted\s+)?share[^$\d-]{0,80}\$?\s*(-?\d+(?:\.\d+)?)", re.I),
        re.compile(r"funds\s+from\s+operations[^\\n]{0,120}per\s+(?:diluted\s+)?share[^$\d-]{0,80}\$?\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    "affo_per_share": (
        re.compile(r"(?:adjusted\s+funds\s+from\s+operations|affo)\s+per\s+(?:diluted\s+)?share[^$\d-]{0,80}\$?\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    "core_ffo_per_share": (
        re.compile(r"core\s+ffo\s+per\s+(?:diluted\s+)?share[^$\d-]{0,80}\$?\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    "occupancy_pct": (
        re.compile(r"(?:portfolio\s+)?occupancy[^%\d-]{0,80}(-?\d+(?:\.\d+)?)\s*%", re.I),
    ),
    "same_store_noi_growth_pct": (
        re.compile(r"same[-\s]?(?:store|property)\s+noi[^%\d-]{0,120}(-?\d+(?:\.\d+)?)\s*%", re.I),
    ),
    "net_debt_to_ebitda": (
        re.compile(r"net\s+debt\s+(?:to|/)\s+(?:adjusted\s+)?ebitda(?:re)?[^x\d-]{0,80}(-?\d+(?:\.\d+)?)\s*x", re.I),
    ),
    "fixed_charge_coverage": (
        re.compile(r"fixed[-\s]charge\s+coverage[^x\d-]{0,80}(-?\d+(?:\.\d+)?)\s*x", re.I),
    ),
    "dividend_per_share": (
        re.compile(r"(?:common\s+)?dividend(?:s)?\s+per\s+share[^$\d-]{0,80}\$?\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    "affo_payout_ratio_pct": (
        re.compile(r"(?:affo|adjusted\s+funds\s+from\s+operations)\s+payout\s+ratio[^%\d-]{0,80}(-?\d+(?:\.\d+)?)\s*%", re.I),
    ),
}


@dataclass
class SourceEntry:
    symbol: str
    company_name: str
    sector: Optional[str]
    industry: Optional[str]
    ir_url: Optional[str] = None
    search_urls: List[str] = None  # type: ignore[assignment]
    enabled: bool = True
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if self.search_urls is None:
            self.search_urls = []


@dataclass
class NormalizedReitFact:
    symbol: str
    document_id: int
    metric_name: str
    metric_value_num: Optional[float]
    metric_value_text: str
    period_hint: Optional[str]
    confidence: str
    evidence_text: str
    source_url: str
    extraction_method: str


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: List[Tuple[str, str]] = []
        self._href: Optional[str] = None
        self._text: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if tag.lower() != "a":
            return
        attrs_map = {k.lower(): v for k, v in attrs}
        href = attrs_map.get("href")
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text).strip()))
            self._href = None
            self._text = []


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def ensure_dirs() -> None:
    (SUPPLEMENTAL_DIR / "documents").mkdir(parents=True, exist_ok=True)
    (SUPPLEMENTAL_DIR / "text").mkdir(parents=True, exist_ok=True)
    (SUPPLEMENTAL_DIR / "docling").mkdir(parents=True, exist_ok=True)


def ensure_db() -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS reit_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            url TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_page_url TEXT,
            title TEXT,
            local_path TEXT,
            content_type TEXT,
            sha256 TEXT,
            fetched_at TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            UNIQUE(symbol, url)
        );

        CREATE TABLE IF NOT EXISTS reit_metric_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            document_id INTEGER,
            metric_name TEXT NOT NULL,
            metric_value_num REAL,
            metric_value_text TEXT,
            period_hint TEXT,
            confidence TEXT NOT NULL,
            evidence_text TEXT,
            source_url TEXT,
            extracted_at TEXT NOT NULL,
            UNIQUE(symbol, document_id, metric_name, metric_value_num, evidence_text)
        );

        CREATE INDEX IF NOT EXISTS idx_reit_documents_symbol ON reit_documents(symbol, fetched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reit_metric_symbol ON reit_metric_candidates(symbol, metric_name);

        CREATE TABLE IF NOT EXISTS reit_docling_outputs (
            document_id INTEGER PRIMARY KEY,
            symbol TEXT NOT NULL,
            markdown_path TEXT,
            converted_at TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS reit_normalized_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            document_id INTEGER NOT NULL,
            metric_name TEXT NOT NULL,
            metric_value_num REAL,
            metric_value_text TEXT,
            period_hint TEXT,
            confidence TEXT NOT NULL,
            evidence_text TEXT NOT NULL,
            source_url TEXT,
            extraction_method TEXT NOT NULL,
            extracted_at TEXT NOT NULL,
            UNIQUE(symbol, document_id, metric_name, metric_value_text, evidence_text)
        );

        CREATE INDEX IF NOT EXISTS idx_reit_normalized_symbol
            ON reit_normalized_facts(symbol, metric_name, confidence);
        """
    )
    return conn


def http_get(url: str, *, binary: bool = False, timeout: int = 30, retries: int = 2) -> Optional[Any]:
    if requests is None:
        raise RuntimeError("Python package 'requests' is required for REIT supplemental collection.")
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    for attempt in range(max(1, retries + 1)):
        try:
            time.sleep(REQUEST_DELAY_S * (attempt + 1))
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            if resp.status_code in {429, 500, 502, 503, 504} and attempt < retries:
                continue
            if resp.status_code >= 400:
                return None
            return resp.content if binary else resp.text
        except requests.RequestException as exc:
            if attempt >= retries:
                print(f"[REITSupplementals] request failed after retries: {url} ({exc})", file=sys.stderr, flush=True)
                return None
            continue
    return None


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_reits_from_catalog() -> List[SourceEntry]:
    if not CATALOG_DB_PATH.exists():
        raise FileNotFoundError(f"symbol catalog not found: {CATALOG_DB_PATH}")
    conn = sqlite3.connect(CATALOG_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT symbol, COALESCE(name, sec_name, symbol) AS company_name, sector, industry
        FROM symbols
        WHERE company_type = 'reit' OR valuation_engine_class = 'reit_affo'
        ORDER BY symbol
        """
    ).fetchall()
    conn.close()
    return [
        SourceEntry(
            symbol=normalize_symbol(row["symbol"]),
            company_name=str(row["company_name"] or row["symbol"]),
            sector=row["sector"],
            industry=row["industry"],
        )
        for row in rows
    ]


def init_source_map(force: bool = False) -> Dict[str, Any]:
    ensure_dirs()
    existing = read_json(SOURCE_MAP_PATH, {"symbols": {}})
    existing_symbols = existing.get("symbols") or {}
    if SOURCE_MAP_PATH.exists() and not force:
        reits = load_reits_from_catalog()
        for entry in reits:
            existing_symbols.setdefault(entry.symbol, asdict(entry))
        payload = {"updated_at": utc_now(), "symbols": dict(sorted(existing_symbols.items()))}
    else:
        payload = {
            "updated_at": utc_now(),
            "symbols": {entry.symbol: asdict(entry) for entry in load_reits_from_catalog()},
        }
    write_json(SOURCE_MAP_PATH, payload)
    return payload


def load_source_map() -> Dict[str, SourceEntry]:
    if not SOURCE_MAP_PATH.exists():
        init_source_map()
    payload = read_json(SOURCE_MAP_PATH, {"symbols": {}})
    out: Dict[str, SourceEntry] = {}
    for symbol, raw in (payload.get("symbols") or {}).items():
        if not raw:
            continue
        entry = SourceEntry(
            symbol=normalize_symbol(raw.get("symbol") or symbol),
            company_name=str(raw.get("company_name") or symbol),
            sector=raw.get("sector"),
            industry=raw.get("industry"),
            ir_url=raw.get("ir_url"),
            search_urls=list(raw.get("search_urls") or []),
            enabled=bool(raw.get("enabled", True)),
            notes=raw.get("notes"),
        )
        out[entry.symbol] = entry
    return out


def load_ticker_to_cik() -> Dict[str, str]:
    if not TICKERS_CACHE.exists():
        body = http_get("https://www.sec.gov/files/company_tickers.json")
        if body:
            TICKERS_CACHE.write_text(body, encoding="utf-8")
    raw = read_json(TICKERS_CACHE, {})
    return {
        normalize_symbol(item.get("ticker")): str(item.get("cik_str") or "").zfill(10)
        for item in raw.values()
        if item.get("ticker") and item.get("cik_str")
    }


def looks_like_supplemental(url: str, text: str = "") -> bool:
    haystack = f"{url} {text}".lower()
    if not any(keyword in haystack for keyword in DOC_KEYWORDS):
        return False
    return any(token in haystack for token in (".pdf", ".htm", ".html", "download", "document", "ex-99"))


def looks_like_sec_exhibit_document(name: str, description: str = "") -> bool:
    clean_name = str(name or "").strip().lower()
    haystack = f"{clean_name} {description}".lower()
    if not clean_name.endswith((".htm", ".html", ".pdf")):
        return False
    if any(token in haystack for token in ("index", ".xml", ".xsd", ".css", ".js", ".jpg", ".png", ".zip")):
        return False
    if re.search(r"(?:^|[-_])ex(?:hibit)?[-_]?99", haystack):
        return True
    return any(keyword in haystack for keyword in DOC_KEYWORDS)


def discover_from_pages(entry: SourceEntry, limit: int = 12) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    pages = [entry.ir_url, *entry.search_urls]
    for page_url in [url for url in pages if url]:
        try:
            html = http_get(str(page_url))
        except Exception as exc:
            candidates.append({
                "symbol": entry.symbol,
                "source_type": "ir_page_error",
                "source_page_url": page_url,
                "error": str(exc),
            })
            continue
        if not html:
            continue
        parser = LinkParser()
        parser.feed(html)
        for href, label in parser.links:
            absolute = urllib.parse.urljoin(str(page_url), href)
            if looks_like_supplemental(absolute, label):
                candidates.append({
                    "symbol": entry.symbol,
                    "url": absolute,
                    "title": label or absolute.rsplit("/", 1)[-1],
                    "source_type": "ir_page",
                    "source_page_url": page_url,
                })
    deduped: Dict[str, Dict[str, Any]] = {}
    for item in candidates:
        url = item.get("url")
        if url:
            deduped[url] = item
    return list(deduped.values())[:limit]


def sec_filing_index(cik: str, accession: str) -> Optional[Dict[str, Any]]:
    cik_no_zero = str(int(cik))
    accession_no_dash = accession.replace("-", "")
    url = f"{SEC_ARCHIVES_BASE}/{cik_no_zero}/{accession_no_dash}/index.json"
    raw = http_get(url)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def discover_from_sec(symbol: str, ticker_to_cik: Dict[str, str], max_filings: int = 20) -> List[Dict[str, Any]]:
    cik = ticker_to_cik.get(symbol)
    if not cik:
        return []
    raw = http_get(SEC_SUBMISSIONS_URL.format(cik10=cik))
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    accessions = recent.get("accessionNumber") or []
    filing_dates = recent.get("filingDate") or []
    candidates: List[Dict[str, Any]] = []
    scanned = 0
    for form, accession, filing_date in zip(forms, accessions, filing_dates):
        if form not in {"8-K", "10-Q", "10-K"}:
            continue
        scanned += 1
        if scanned > max_filings:
            break
        index = sec_filing_index(cik, accession)
        if not index:
            continue
        directory = (index.get("directory") or {}).get("item") or []
        cik_no_zero = str(int(cik))
        accession_no_dash = accession.replace("-", "")
        for doc in directory:
            name = str(doc.get("name") or "")
            desc = str(doc.get("description") or "")
            if not name or not looks_like_sec_exhibit_document(name, desc):
                continue
            url = f"{SEC_ARCHIVES_BASE}/{cik_no_zero}/{accession_no_dash}/{name}"
            candidates.append({
                "symbol": symbol,
                "url": url,
                "title": desc or name,
                "source_type": "sec_exhibit",
                "source_page_url": f"{SEC_ARCHIVES_BASE}/{cik_no_zero}/{accession_no_dash}/",
                "filing_date": filing_date,
                "form": form,
            })
    return candidates


def discover(
    symbols: Sequence[str],
    *,
    limit_per_symbol: int = 10,
    max_symbols: int = 0,
    max_sec_filings: int = 20,
) -> List[Dict[str, Any]]:
    source_map = load_source_map()
    ticker_to_cik = load_ticker_to_cik()
    selected = [normalize_symbol(symbol) for symbol in symbols] if symbols else sorted(source_map)
    if max_symbols and max_symbols > 0:
        selected = selected[:max_symbols]
    all_candidates: List[Dict[str, Any]] = []
    for index, symbol in enumerate(selected, start=1):
        entry = source_map.get(symbol)
        if not entry or not entry.enabled:
            continue
        print(f"[REITSupplementals] discover {index}/{len(selected)} {symbol}", flush=True)
        candidates = discover_from_pages(entry, limit=limit_per_symbol)
        candidates.extend(discover_from_sec(symbol, ticker_to_cik, max_filings=max_sec_filings))
        seen = set()
        for item in candidates:
            url = item.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            all_candidates.append(item)
    return all_candidates


def safe_doc_name(url: str, title: Optional[str]) -> str:
    parsed = urllib.parse.urlparse(url)
    stem = Path(parsed.path).name or (title or "document")
    stem = re.sub(r"[^A-Za-z0-9._=-]+", "_", stem).strip("_") or "document"
    if "." not in stem:
        stem += ".html"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{digest}_{stem}"


def upsert_document(conn: sqlite3.Connection, item: Dict[str, Any], *, status: str, local_path: Optional[Path] = None, content: bytes = b"", error: Optional[str] = None) -> int:
    sha = hashlib.sha256(content).hexdigest() if content else None
    conn.execute(
        """
        INSERT INTO reit_documents (
            symbol, url, source_type, source_page_url, title, local_path,
            content_type, sha256, fetched_at, status, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, url) DO UPDATE SET
            source_type=excluded.source_type,
            source_page_url=excluded.source_page_url,
            title=excluded.title,
            local_path=excluded.local_path,
            content_type=excluded.content_type,
            sha256=excluded.sha256,
            fetched_at=excluded.fetched_at,
            status=excluded.status,
            error=excluded.error
        """,
        (
            item["symbol"],
            item["url"],
            item.get("source_type") or "unknown",
            item.get("source_page_url"),
            item.get("title"),
            str(local_path) if local_path else None,
            "application/pdf" if str(item["url"]).lower().endswith(".pdf") else "text/html",
            sha,
            utc_now(),
            status,
            error,
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM reit_documents WHERE symbol = ? AND url = ?",
        (item["symbol"], item["url"]),
    ).fetchone()
    return int(row["id"])


def download_candidates(candidates: Sequence[Dict[str, Any]], *, max_docs: int = 50) -> Dict[str, int]:
    conn = ensure_db()
    counts = {"downloaded": 0, "failed": 0, "skipped": 0}
    for item in candidates[:max_docs]:
        symbol = normalize_symbol(item.get("symbol"))
        url = str(item.get("url") or "")
        if not symbol or not url:
            counts["skipped"] += 1
            continue
        item = {**item, "symbol": symbol, "url": url}
        out_dir = SUPPLEMENTAL_DIR / "documents" / symbol
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / safe_doc_name(url, item.get("title"))
        try:
            content = http_get(url, binary=True)
            if not content:
                upsert_document(conn, item, status="failed", error="empty response")
                counts["failed"] += 1
                continue
            out_path.write_bytes(content)
            upsert_document(conn, item, status="downloaded", local_path=out_path, content=content)
            counts["downloaded"] += 1
        except Exception as exc:
            upsert_document(conn, item, status="failed", error=str(exc))
            counts["failed"] += 1
    conn.close()
    return counts


def extract_text_from_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm", ".txt"}:
        raw = path.read_text(encoding="utf-8", errors="replace")
        if suffix in {".html", ".htm"} and BeautifulSoup is not None:
            soup = BeautifulSoup(raw, "lxml")
            for node in soup(["script", "style"]):
                node.decompose()
            return soup.get_text("\n")
        return raw
    if suffix == ".pdf":
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def evidence_window(text: str, start: int, end: int, width: int = 180) -> str:
    left = max(0, start - width)
    right = min(len(text), end + width)
    return re.sub(r"\s+", " ", text[left:right]).strip()


def extract_metric_candidates(conn: sqlite3.Connection, symbol: str, document_id: int, source_url: str, text: str) -> int:
    inserted = 0
    for metric_name, patterns in METRIC_PATTERNS.items():
        for pattern in patterns:
            for match in pattern.finditer(text):
                raw_value = match.group(1)
                try:
                    value_num = float(raw_value.replace(",", ""))
                except Exception:
                    value_num = None
                snippet = evidence_window(text, match.start(), match.end())
                confidence = "candidate"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO reit_metric_candidates (
                        symbol, document_id, metric_name, metric_value_num,
                        metric_value_text, period_hint, confidence,
                        evidence_text, source_url, extracted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        symbol,
                        document_id,
                        metric_name,
                        value_num,
                        raw_value,
                        None,
                        confidence,
                        snippet,
                        source_url,
                        utc_now(),
                    ),
                )
                inserted += 1
                break
    conn.commit()
    return inserted


def extract_downloaded(symbols: Sequence[str]) -> Dict[str, int]:
    conn = ensure_db()
    where = "status = 'downloaded' AND local_path IS NOT NULL"
    params: List[Any] = []
    selected = [normalize_symbol(symbol) for symbol in symbols if normalize_symbol(symbol)]
    if selected:
        placeholders = ", ".join("?" for _ in selected)
        where += f" AND symbol IN ({placeholders})"
        params.extend(selected)
    rows = conn.execute(
        f"SELECT * FROM reit_documents WHERE {where} ORDER BY fetched_at DESC",
        params,
    ).fetchall()
    counts = {"documents": 0, "text_extracted": 0, "metric_candidates": 0}
    for row in rows:
        path = Path(row["local_path"])
        if not path.exists():
            continue
        text = extract_text_from_file(path)
        if not text:
            counts["documents"] += 1
            continue
        text_path = SUPPLEMENTAL_DIR / "text" / row["symbol"] / f"{path.stem}.txt"
        text_path.parent.mkdir(parents=True, exist_ok=True)
        text_path.write_text(text, encoding="utf-8")
        counts["documents"] += 1
        counts["text_extracted"] += 1
        counts["metric_candidates"] += extract_metric_candidates(conn, row["symbol"], int(row["id"]), row["url"], text)
    conn.close()
    return counts


def convert_downloaded_with_docling(symbols: Sequence[str]) -> Dict[str, Any]:
    try:
        from docling.document_converter import DocumentConverter
    except Exception as exc:
        return {"documents": 0, "converted": 0, "failed": 0, "error": str(exc)}

    conn = ensure_db()
    where = "status = 'downloaded' AND local_path IS NOT NULL"
    params: List[Any] = []
    selected = [normalize_symbol(symbol) for symbol in symbols if normalize_symbol(symbol)]
    if selected:
        placeholders = ", ".join("?" for _ in selected)
        where += f" AND symbol IN ({placeholders})"
        params.extend(selected)
    rows = conn.execute(
        f"SELECT * FROM reit_documents WHERE {where} ORDER BY fetched_at DESC",
        params,
    ).fetchall()
    converter = DocumentConverter()
    counts = {"documents": 0, "converted": 0, "failed": 0}
    for row in rows:
        counts["documents"] += 1
        path = Path(row["local_path"])
        out_dir = SUPPLEMENTAL_DIR / "docling" / row["symbol"]
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{path.stem}.md"
        try:
            result = converter.convert(str(path))
            markdown = result.document.export_to_markdown()
            out_path.write_text(markdown, encoding="utf-8")
            conn.execute(
                """
                INSERT INTO reit_docling_outputs (
                    document_id, symbol, markdown_path, converted_at, status, error
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    markdown_path=excluded.markdown_path,
                    converted_at=excluded.converted_at,
                    status=excluded.status,
                    error=excluded.error
                """,
                (int(row["id"]), row["symbol"], str(out_path), utc_now(), "converted", None),
            )
            counts["converted"] += 1
        except Exception as exc:
            conn.execute(
                """
                INSERT INTO reit_docling_outputs (
                    document_id, symbol, markdown_path, converted_at, status, error
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    converted_at=excluded.converted_at,
                    status=excluded.status,
                    error=excluded.error
                """,
                (int(row["id"]), row["symbol"], None, utc_now(), "failed", str(exc)),
            )
            counts["failed"] += 1
        conn.commit()
    conn.close()
    return counts


def extract_docling_outputs(symbols: Sequence[str]) -> Dict[str, int]:
    conn = ensure_db()
    where = "o.status = 'converted' AND o.markdown_path IS NOT NULL"
    params: List[Any] = []
    selected = [normalize_symbol(symbol) for symbol in symbols if normalize_symbol(symbol)]
    if selected:
        placeholders = ", ".join("?" for _ in selected)
        where += f" AND o.symbol IN ({placeholders})"
        params.extend(selected)
    rows = conn.execute(
        f"""
        SELECT o.*, d.url
        FROM reit_docling_outputs o
        JOIN reit_documents d ON d.id = o.document_id
        WHERE {where}
        ORDER BY o.converted_at DESC
        """,
        params,
    ).fetchall()
    counts = {"documents": 0, "metric_candidates": 0}
    for row in rows:
        path = Path(row["markdown_path"])
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        counts["documents"] += 1
        counts["metric_candidates"] += extract_metric_candidates(
            conn,
            row["symbol"],
            int(row["document_id"]),
            row["url"],
            text,
        )
    conn.close()
    return counts


def clean_evidence(value: str, *, max_len: int = 900) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 3].rstrip() + "..."


def parse_number(raw: str) -> Optional[float]:
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()$%x ")
    try:
        value = float(text)
    except Exception:
        return None
    return -value if negative else value


def add_normalized_fact(
    facts: List[NormalizedReitFact],
    *,
    symbol: str,
    document_id: int,
    metric_name: str,
    raw_value: str,
    period_hint: Optional[str],
    evidence_text: str,
    source_url: str,
    extraction_method: str,
    confidence: str = "high",
) -> None:
    numeric = parse_number(raw_value)
    if numeric is None:
        return
    facts.append(
        NormalizedReitFact(
            symbol=symbol,
            document_id=document_id,
            metric_name=metric_name,
            metric_value_num=numeric,
            metric_value_text=str(raw_value).strip(),
            period_hint=period_hint,
            confidence=confidence,
            evidence_text=clean_evidence(evidence_text),
            source_url=source_url,
            extraction_method=extraction_method,
        )
    )


PER_SHARE_METRICS = {"ffo_per_share", "affo_per_share", "core_ffo_per_share"}


def is_valid_reit_per_share_value(value: Optional[float], evidence: str, raw_value: str = "") -> bool:
    if value is None or value <= 0 or value > 100:
        return False
    if 1900 <= value <= 2100 and float(value).is_integer():
        return False
    raw = str(raw_value or "").strip()
    if raw and re.search(rf"{re.escape(raw)}\s*%", evidence):
        return False
    lower = evidence.lower()
    if "per share growth" in lower and " to $" not in lower:
        return False
    if "accretion" in lower and " to $" not in lower:
        return False
    return True


def per_share_value_from_evidence(evidence: str, metric_name: str) -> Optional[str]:
    if metric_name not in PER_SHARE_METRICS:
        return None
    cleaned = clean_evidence(evidence, max_len=1200)
    lower = cleaned.lower()
    if "per share growth" in lower and " to $" not in lower:
        return None
    if "accretion" in lower and " to $" not in lower:
        return None

    to_matches = re.findall(r"\bto\s+\$\s*(-?\d+(?:\.\d+)?)", cleaned, re.I)
    for raw in reversed(to_matches):
        value = parse_number(raw)
        if is_valid_reit_per_share_value(value, cleaned, raw):
            return raw

    dollar_matches = re.findall(r"\$\s*(-?\d+(?:\.\d+)?)", cleaned, re.I)
    for raw in dollar_matches:
        value = parse_number(raw)
        if is_valid_reit_per_share_value(value, cleaned, raw):
            return raw
    return None


def period_from_evidence(evidence: str) -> Optional[str]:
    patterns = (
        r"(?:First|Second|Third|Fourth)\s+Quarter\s+20\d{2}",
        r"Full\s+Year\s+20\d{2}",
        r"(?:three|six|nine|twelve)\s+months\s+ended\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}",
        r"(?:quarter|year)\s+ended\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}",
        r"(?:as\s+of|at)\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}",
        r"Q[1-4]\s+20\d{2}",
        r"20\d{2}",
    )
    for pattern in patterns:
        match = re.search(pattern, evidence, re.I)
        if match:
            return match.group(0)
    return None


def normalize_reit_period_hint(metric_name: str, raw_value: str, period_hint: Optional[str]) -> Optional[str]:
    value = parse_number(raw_value)
    if metric_name in {"affo_per_share", "core_ffo_per_share", "ffo_per_share"} and value is not None:
        if value >= 2.0:
            if not period_hint or re.fullmatch(r"20\d{2}", period_hint) or period_hint == "2035":
                return "full_year"
        elif value > 0 and not period_hint:
            return "quarter"
    return period_hint


DOC_LEVEL_FACT_PATTERNS: Sequence[Tuple[str, re.Pattern[str]]] = (
    (
        "ffo_per_share",
        re.compile(r"\b(?:Nareit[-\s]defined\s+|NAREIT\s+|Normalized\s+|Core\s+)?FFO\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "ffo_per_share",
        re.compile(r"\b(?:Nareit\s+|Normalized\s+|Core\s+)?Funds\s+from\s+Operations(?:\s*\([^)]*\))?\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "ffo_per_share",
        re.compile(r"\b(?:Nareit[-\s]defined\s+|NAREIT\s+|Normalized\s+|Core\s+)?FFO\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\b(?:was|of|to|range\s+of)\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "ffo_per_share",
        re.compile(r"\bFFO\s+to\s+be\s+within\s+a\s+range\s+of\s+\$\s*(-?\d+(?:\.\d+)?)\s+to\s+\$\s*(-?\d+(?:\.\d+)?)\s+per\s+(?:diluted\s+)?share", re.I),
    ),
    (
        "core_ffo_per_share",
        re.compile(r"Core\s+Funds\s+from\s+Operations\s+\(\"Core\s+FFO\"\)\s+per\s+share[^$]{0,160}?\b(?:increased|decreased)[^$]{0,80}?\bto\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "core_ffo_per_share",
        re.compile(r"\bCore\s+FFO\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "core_ffo_per_share",
        re.compile(r"Core\s+FFO\s+per\s+share[^$]{0,160}?\b(?:increased|decreased)[^$]{0,80}?\bto\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_per_share",
        re.compile(r"Adjusted\s+Funds\s+from\s+Operations\s+\(\"AFFO\"\)\s+per\s+share[^$]{0,160}?\b(?:increased|decreased)[^$]{0,80}?\bto\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_per_share",
        re.compile(r"\bAFFO\s+per\s+share[^$]{0,160}?\b(?:increased|decreased)[^$]{0,80}?\bto\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_per_share",
        re.compile(r"\b(?:Adjusted\s+)?FFO\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_per_share",
        re.compile(r"\bAdjusted\s+Funds\s+from\s+Operations(?:\s*\([^)]*\))?\s+per\s+(?:diluted\s+)?(?:share|share\s+and\s+unit)[^$]{0,180}?\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_guidance_low",
        re.compile(r"\bAFFO\s+per\s+share\s+guidance\s+of\s+\$\s*(-?\d+(?:\.\d+)?)\s+to\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "affo_guidance_high",
        re.compile(r"\bAFFO\s+per\s+share\s+guidance\s+of\s+\$\s*(-?\d+(?:\.\d+)?)\s+to\s+\$\s*(-?\d+(?:\.\d+)?)", re.I),
    ),
    (
        "monthly_dividend_per_share",
        re.compile(r"monthly\s+dividend\s+of\s+\$\s*(-?\d+(?:\.\d+)?)\s+per\s+common\s+share", re.I),
    ),
    (
        "annual_dividend_per_share",
        re.compile(r"annualized\s+dividend\s+amount\s+of\s+\$\s*(-?\d+(?:\.\d+)?)\s+per\s+common\s+share", re.I),
    ),
    (
        "net_debt_to_recurring_ebitda",
        re.compile(r"\bnet\s+debt\s+to\s+recurring\s+EBITDA\s+was\s+(-?\d+(?:\.\d+)?)\s+times", re.I),
    ),
    (
        "proforma_net_debt_to_recurring_ebitda",
        re.compile(r"\bproforma\s+net\s+debt\s+to\s+recurring\s+EBITDA\s+was\s+(-?\d+(?:\.\d+)?)\s+times", re.I),
    ),
    (
        "fixed_charge_coverage",
        re.compile(r"fixed\s+charge\s+coverage\s+ratio\s+was\s+(-?\d+(?:\.\d+)?)\s+times", re.I),
    ),
    (
        "portfolio_occupancy_pct",
        re.compile(r"portfolio\s+was\s+approximately\s+(-?\d+(?:\.\d+)?)%\s+leased", re.I),
    ),
    (
        "affo_payout_ratio_pct",
        re.compile(r"payout\s+ratios?\s+of\s+approximately\s+\d+(?:\.\d+)?%\s+of\s+Core\s+FFO\s+per\s+share\s+and\s+(-?\d+(?:\.\d+)?)%\s+of\s+AFFO\s+per\s+share", re.I),
    ),
)


TABLE_ROW_METRICS: Sequence[Tuple[str, str]] = (
    ("adjusted funds from operations per common share", "affo_per_share"),
    ("adjusted ffo per diluted share", "affo_per_share"),
    ("adjusted ffo per share", "affo_per_share"),
    ("adjusted ffo per diluted share and unit", "affo_per_share"),
    ("affo per share", "affo_per_share"),
    ("affo per diluted share", "affo_per_share"),
    ("affo per diluted share and unit", "affo_per_share"),
    ("core funds from operations per common share", "core_ffo_per_share"),
    ("core funds from operations per diluted share", "core_ffo_per_share"),
    ("core ffo per diluted share", "core_ffo_per_share"),
    ("core ffo per share", "core_ffo_per_share"),
    ("nareit ffo per diluted share", "ffo_per_share"),
    ("normalized ffo per diluted share", "ffo_per_share"),
    ("normalized ffo per share", "ffo_per_share"),
    ("ffo per diluted share/unit", "ffo_per_share"),
    ("ffo per diluted share and unit", "ffo_per_share"),
    ("ffo per diluted share", "ffo_per_share"),
    ("ffo per share", "ffo_per_share"),
    ("affo payout ratio", "affo_payout_ratio_pct"),
    ("fixed charge coverage ratio", "fixed_charge_coverage"),
)


def split_markdown_row(line: str) -> List[str]:
    if not line.lstrip().startswith("|"):
        return []
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def select_table_metric_value(cells: Sequence[str], label_index: int, metric_name: str) -> Optional[str]:
    candidates = list(cells[label_index + 1 :])
    for index, cell in enumerate(candidates):
        if cell.strip() != "$":
            continue
        for next_cell in candidates[index + 1 : index + 4]:
            match = re.search(r"\(?-?\d+(?:,\d{3})*(?:\.\d+)?\)?", next_cell)
            if not match:
                continue
            raw = match.group(0)
            value = parse_number(raw)
            if is_valid_reit_per_share_value(value, " | ".join(cells), raw):
                return raw
    for cell in candidates:
        if "%" in cell:
            continue
        for match in re.finditer(r"\$?\s*(\(?-?\d+(?:,\d{3})*(?:\.\d+)?\)?)", cell):
            raw = match.group(1)
            value = parse_number(raw)
            if metric_name in PER_SHARE_METRICS and "." not in raw:
                continue
            if metric_name in PER_SHARE_METRICS:
                if is_valid_reit_per_share_value(value, " | ".join(cells), raw):
                    return raw
                continue
            if value is not None:
                return raw
    return None


def promote_docling_facts_for_text(
    *,
    symbol: str,
    document_id: int,
    source_url: str,
    text: str,
) -> List[NormalizedReitFact]:
    facts: List[NormalizedReitFact] = []
    seen_doc_patterns = set()
    for metric_name, pattern in DOC_LEVEL_FACT_PATTERNS:
        for match in pattern.finditer(text):
            raw_value = match.group(2) if metric_name.endswith("_high") and match.lastindex and match.lastindex >= 2 else match.group(1)
            key = (metric_name, raw_value)
            if key in seen_doc_patterns:
                continue
            seen_doc_patterns.add(key)
            snippet = evidence_window(text, match.start(), match.end(), width=320)
            if metric_name in PER_SHARE_METRICS:
                raw_value = per_share_value_from_evidence(snippet, metric_name) or raw_value
                value = parse_number(raw_value)
                if not is_valid_reit_per_share_value(value, snippet, raw_value):
                    continue
            add_normalized_fact(
                facts,
                symbol=symbol,
                document_id=document_id,
                metric_name=metric_name,
                raw_value=raw_value,
                period_hint=normalize_reit_period_hint(metric_name, raw_value, period_from_evidence(snippet)),
                evidence_text=snippet,
                source_url=source_url,
                extraction_method="docling_phrase",
            )
            break

    for line in text.splitlines():
        cells = split_markdown_row(line)
        if len(cells) < 2:
            continue
        labels = [clean_evidence(cell.lower(), max_len=260) for cell in cells]
        metric_name = None
        label_index = 0
        for needle, mapped_metric in TABLE_ROW_METRICS:
            matched_index = next((i for i, label in enumerate(labels) if needle in label), None)
            if matched_index is not None:
                metric_name = mapped_metric
                label_index = matched_index
                break
        if not metric_name:
            continue
        raw_value = select_table_metric_value(cells, label_index, metric_name)
        if raw_value is None:
            continue
        add_normalized_fact(
            facts,
            symbol=symbol,
            document_id=document_id,
            metric_name=metric_name,
            raw_value=raw_value,
            period_hint=normalize_reit_period_hint(metric_name, raw_value, period_from_evidence(line)),
            evidence_text=line,
            source_url=source_url,
            extraction_method="docling_table_row",
            confidence="medium_high",
        )
    return facts


def insert_normalized_facts(conn: sqlite3.Connection, facts: Sequence[NormalizedReitFact]) -> int:
    inserted = 0
    for fact in facts:
        before = conn.total_changes
        conn.execute(
            """
            INSERT OR IGNORE INTO reit_normalized_facts (
                symbol, document_id, metric_name, metric_value_num,
                metric_value_text, period_hint, confidence, evidence_text,
                source_url, extraction_method, extracted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fact.symbol,
                fact.document_id,
                fact.metric_name,
                fact.metric_value_num,
                fact.metric_value_text,
                fact.period_hint,
                fact.confidence,
                fact.evidence_text,
                fact.source_url,
                fact.extraction_method,
                utc_now(),
            ),
        )
        if conn.total_changes > before:
            inserted += 1
    conn.commit()
    return inserted


def promote_docling_facts(symbols: Sequence[str]) -> Dict[str, int]:
    conn = ensure_db()
    where = "o.status = 'converted' AND o.markdown_path IS NOT NULL"
    params: List[Any] = []
    selected = [normalize_symbol(symbol) for symbol in symbols if normalize_symbol(symbol)]
    if selected:
        placeholders = ", ".join("?" for _ in selected)
        where += f" AND o.symbol IN ({placeholders})"
        params.extend(selected)
    rows = conn.execute(
        f"""
        SELECT o.*, d.url
        FROM reit_docling_outputs o
        JOIN reit_documents d ON d.id = o.document_id
        WHERE {where}
        ORDER BY o.converted_at DESC
        """,
        params,
    ).fetchall()
    counts = {"documents": 0, "facts_found": 0, "facts_inserted": 0, "candidate_facts_found": 0, "candidate_facts_inserted": 0}
    for row in rows:
        path = Path(row["markdown_path"])
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        facts = promote_docling_facts_for_text(
            symbol=row["symbol"],
            document_id=int(row["document_id"]),
            source_url=row["url"],
            text=text,
        )
        counts["documents"] += 1
        counts["facts_found"] += len(facts)
        counts["facts_inserted"] += insert_normalized_facts(conn, facts)
    candidate_where = "metric_name IN ('ffo_per_share', 'affo_per_share', 'core_ffo_per_share')"
    candidate_params: List[Any] = []
    if selected:
        placeholders = ", ".join("?" for _ in selected)
        candidate_where += f" AND symbol IN ({placeholders})"
        candidate_params.extend(selected)
    candidate_rows = conn.execute(
        f"""
        SELECT *
        FROM reit_metric_candidates
        WHERE {candidate_where}
        ORDER BY extracted_at DESC
        """,
        candidate_params,
    ).fetchall()
    candidate_facts: List[NormalizedReitFact] = []
    seen_candidate_keys = set()
    for row in candidate_rows:
        metric_name = str(row["metric_name"] or "")
        evidence = str(row["evidence_text"] or "")
        raw_value = per_share_value_from_evidence(evidence, metric_name)
        if raw_value is None:
            value = parse_number(str(row["metric_value_text"] or ""))
            if not is_valid_reit_per_share_value(value, evidence, str(row["metric_value_text"] or "")):
                continue
            raw_value = str(row["metric_value_text"] or "")
        key = (row["symbol"], row["document_id"], metric_name, raw_value, clean_evidence(evidence))
        if key in seen_candidate_keys:
            continue
        seen_candidate_keys.add(key)
        add_normalized_fact(
            candidate_facts,
            symbol=row["symbol"],
            document_id=int(row["document_id"] or 0),
            metric_name=metric_name,
            raw_value=raw_value,
            period_hint=normalize_reit_period_hint(metric_name, raw_value, period_from_evidence(evidence)),
            evidence_text=evidence,
            source_url=row["source_url"] or "",
            extraction_method="metric_candidate_evidence",
            confidence="medium_high",
        )
    counts["candidate_facts_found"] = len(candidate_facts)
    counts["candidate_facts_inserted"] = insert_normalized_facts(conn, candidate_facts)
    conn.close()
    return counts


def parse_symbols(raw: str) -> List[str]:
    return [normalize_symbol(part) for part in str(raw or "").split(",") if normalize_symbol(part)]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Collect REIT supplemental financial documents")
    parser.add_argument("--init-source-map", action="store_true", help="Create/update backend/data/reit-supplementals/source-map.json from symbol catalog")
    parser.add_argument("--force-init", action="store_true", help="Replace source-map.json instead of preserving existing URLs")
    parser.add_argument("--discover", action="store_true", help="Discover supplemental document candidates")
    parser.add_argument("--download", action="store_true", help="Download discovered candidates")
    parser.add_argument("--extract", action="store_true", help="Extract metric candidates from downloaded text/html documents")
    parser.add_argument("--docling", action="store_true", help="Convert downloaded documents to Docling markdown")
    parser.add_argument("--extract-docling", action="store_true", help="Extract metric candidates from Docling markdown")
    parser.add_argument("--promote-docling", action="store_true", help="Promote Docling markdown into normalized high-confidence REIT facts")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols, e.g. ADC,PLD")
    parser.add_argument("--limit", type=int, default=50, help="Max documents to download")
    parser.add_argument("--max-symbols", type=int, default=0, help="Max REIT symbols to process when --symbols is not set")
    parser.add_argument("--max-sec-filings", type=int, default=20, help="Max recent SEC filings to inspect per symbol during discovery")
    parser.add_argument("--out", default=str(SUPPLEMENTAL_DIR / "discovered-candidates.json"), help="Discovery output JSON")
    args = parser.parse_args(argv)

    if args.init_source_map:
        payload = init_source_map(force=bool(args.force_init))
        print(json.dumps({"source_map": str(SOURCE_MAP_PATH), "symbols": len(payload.get("symbols") or {})}, indent=2))

    selected_symbols = parse_symbols(args.symbols)

    if args.discover:
        candidates = discover(
            selected_symbols,
            max_symbols=int(args.max_symbols),
            max_sec_filings=int(args.max_sec_filings),
        )
        out_path = Path(args.out)
        write_json(out_path, {"generated_at": utc_now(), "candidates": candidates})
        print(json.dumps({"discovered": len(candidates), "out": str(out_path)}, indent=2))

    if args.download:
        payload = read_json(Path(args.out), {"candidates": []})
        candidates = payload.get("candidates") or []
        if selected_symbols:
            selected = set(selected_symbols)
            candidates = [item for item in candidates if normalize_symbol(item.get("symbol")) in selected]
        counts = download_candidates(candidates, max_docs=int(args.limit))
        print(json.dumps(counts, indent=2))

    if args.extract:
        counts = extract_downloaded(selected_symbols)
        print(json.dumps(counts, indent=2))

    if args.docling:
        counts = convert_downloaded_with_docling(selected_symbols)
        print(json.dumps(counts, indent=2))

    if args.extract_docling:
        counts = extract_docling_outputs(selected_symbols)
        print(json.dumps(counts, indent=2))

    if args.promote_docling:
        counts = promote_docling_facts(selected_symbols)
        print(json.dumps(counts, indent=2))

    if not any([args.init_source_map, args.discover, args.download, args.extract, args.docling, args.extract_docling, args.promote_docling]):
        parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
