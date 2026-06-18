"""Collect SEC EDGAR filings (Form 4 insider transactions, SC 13D activist stakes).

Uses the free EDGAR API — no auth, no API key, 10 req/sec limit.
Polls EFTS for recent filings, fetches and parses ownership XML,
filters to our clean universe, stores to edgar-filings.sqlite.

Zero LLM cost — all parsing and alert generation is deterministic.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
DB_PATH = DATA_DIR / "edgar-filings.sqlite"
TICKERS_CACHE = DATA_DIR / "company_tickers.json"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"

USER_AGENT = "PatternDetector/1.0 edgar-filings-collector@patterndetector.local"
EFTS_BASE = "https://efts.sec.gov/LATEST/search-index"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

REQUEST_DELAY_S = 0.2
MAX_PAGES = 20
PAGE_SIZE = 100


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _fetch(url: str, retries: int = 2, accept: str = "*/*") -> Optional[str]:
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(retries + 1):
        try:
            time.sleep(REQUEST_DELAY_S)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 403:
                wait = 60 * (attempt + 1)
                print(f"  [rate-limit] 403 on {url}, waiting {wait}s")
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                if attempt >= retries:
                    print(f"  [http-err] {e.code} {url}")
                    return None
                time.sleep(2 * (attempt + 1))
        except Exception as exc:
            if attempt >= retries:
                print(f"  [err] {url}: {exc}")
                return None
            time.sleep(2 * (attempt + 1))
    return None


def _fetch_json(url: str) -> Optional[dict]:
    raw = _fetch(url, accept="application/json")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Universe + CIK mapping
# ---------------------------------------------------------------------------

def load_universe(path: Path) -> Set[str]:
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    stocks = payload.get("stocks") or []
    return {str(s.get("symbol") or s.get("ticker") or "").strip().upper()
            for s in stocks if s} - {""}


def load_or_fetch_cik_map() -> Dict[str, str]:
    """Return ticker -> CIK mapping. Caches to disk for 24h."""
    if TICKERS_CACHE.exists():
        age_h = (time.time() - TICKERS_CACHE.stat().st_mtime) / 3600
        if age_h < 24:
            raw = json.loads(TICKERS_CACHE.read_text(encoding="utf-8"))
            return {str(v.get("ticker", "")).upper(): str(v.get("cik_str", ""))
                    for v in raw.values() if v.get("ticker")}

    print("[cik] downloading company_tickers.json ...")
    body = _fetch(TICKERS_URL, accept="application/json")
    if not body:
        if TICKERS_CACHE.exists():
            raw = json.loads(TICKERS_CACHE.read_text(encoding="utf-8"))
            return {str(v.get("ticker", "")).upper(): str(v.get("cik_str", ""))
                    for v in raw.values() if v.get("ticker")}
        return {}
    TICKERS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TICKERS_CACHE.write_text(body, encoding="utf-8")
    raw = json.loads(body)
    return {str(v.get("ticker", "")).upper(): str(v.get("cik_str", ""))
            for v in raw.values() if v.get("ticker")}


def build_cik_to_ticker(ticker_to_cik: Dict[str, str]) -> Dict[str, str]:
    return {cik: ticker for ticker, cik in ticker_to_cik.items()}


# ---------------------------------------------------------------------------
# EFTS polling
# ---------------------------------------------------------------------------

def poll_efts(form_types: str, start_date: str, end_date: str,
              ciks: Optional[str] = None, max_pages: Optional[int] = None) -> List[dict]:
    """Poll EFTS for filings. Returns list of hit dicts.

    When ``ciks`` is provided (a zero-padded 10-digit CIK, or comma list), results
    are restricted to filings that reference that CIK. This is what makes a
    per-issuer historical backfill cheap: instead of scanning the whole market in a
    window, we ask EDGAR only for the filings tied to one company.
    """
    all_hits: List[dict] = []
    offset = 0
    pages = max_pages if max_pages is not None else MAX_PAGES

    for _ in range(pages):
        url = (
            f"{EFTS_BASE}?"
            f"q=%22%22"
            f"&forms={urllib.request.quote(form_types)}"
            f"&dateRange=custom"
            f"&startdt={start_date}"
            f"&enddt={end_date}"
            f"&from={offset}"
            f"&size={PAGE_SIZE}"
            + (f"&ciks={ciks}" if ciks else "")
        )
        data = _fetch_json(url)
        if not data:
            break

        hits = (data.get("hits") or {}).get("hits") or []
        if not hits:
            break

        all_hits.extend(hits)
        total = (data.get("hits") or {}).get("total", {}).get("value", 0)
        offset += PAGE_SIZE
        if offset >= total:
            break

    return all_hits


def parse_efts_hit(hit: dict) -> Optional[Dict[str, str]]:
    """Extract accession number, CIKs, and document URL from an EFTS hit."""
    _id = hit.get("_id", "")
    source = hit.get("_source") or {}

    parts = _id.split(":", 1)
    accession = source.get("adsh") or parts[0].strip()
    document = parts[1].strip() if len(parts) > 1 else ""

    if not accession or len(accession) < 10:
        return None

    ciks = source.get("ciks") or []
    filer_cik = str(int(ciks[0])) if ciks else ""
    if not filer_cik:
        cik_part = accession.split("-")[0]
        filer_cik = str(int(cik_part))

    accession_no_dashes = accession.replace("-", "")

    display_names = source.get("display_names") or []
    entity_name = display_names[0].split("(")[0].strip() if display_names else ""

    xml_url = ""
    if document and filer_cik:
        xml_url = f"{ARCHIVES_BASE}/{filer_cik}/{accession_no_dashes}/{document}"

    return {
        "accession": accession,
        "accession_no_dashes": accession_no_dashes,
        "filer_cik": filer_cik,
        "all_ciks": [str(int(c)) for c in ciks],
        "document": document,
        "xml_url": xml_url,
        "entity_name": entity_name,
        "form_type": source.get("form") or source.get("form_type", ""),
        "file_date": source.get("file_date", ""),
    }


# ---------------------------------------------------------------------------
# Filing XML fetch + parse
# ---------------------------------------------------------------------------

def find_ownership_xml_url(filer_cik: str, accession_no_dashes: str) -> Optional[str]:
    """Fetch filing index.json and find the ownership XML document."""
    index_url = f"{ARCHIVES_BASE}/{filer_cik}/{accession_no_dashes}/index.json"
    data = _fetch_json(index_url)
    if not data:
        return None

    items = (data.get("directory") or {}).get("item") or []
    xml_candidates = []
    for item in items:
        name = item.get("name", "")
        lower = name.lower()
        if lower.endswith(".xml") and "r9999" not in lower:
            xml_candidates.append(name)

    if not xml_candidates:
        return None

    preferred = [n for n in xml_candidates
                 if any(k in n.lower() for k in ("doc4", "primary_doc", "ownership", "form4"))]
    chosen = preferred[0] if preferred else xml_candidates[0]
    return f"{ARCHIVES_BASE}/{filer_cik}/{accession_no_dashes}/{chosen}"


def _xml_text(elem: Optional[ET.Element], path: str) -> str:
    if elem is None:
        return ""
    node = elem.find(path)
    if node is None:
        return ""
    val = node.find("value")
    if val is not None and val.text:
        return val.text.strip()
    return (node.text or "").strip()


def _xml_float(elem: Optional[ET.Element], path: str) -> Optional[float]:
    text = _xml_text(elem, path)
    if not text:
        return None
    try:
        return float(text.replace(",", ""))
    except (ValueError, TypeError):
        return None


def parse_form4_xml(xml_str: str, accession: str, file_date: str) -> Optional[Dict[str, Any]]:
    """Parse a Form 4 ownership XML document."""
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        return None

    tag_local = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if tag_local != "ownershipDocument":
        return None

    ns = ""
    if "}" in root.tag:
        ns = root.tag.split("}")[0] + "}"

    def find(path: str) -> Optional[ET.Element]:
        result = root.find(path)
        if result is not None:
            return result
        if ns:
            ns_path = "/".join(f"{ns}{p}" for p in path.split("/"))
            return root.find(ns_path)
        return None

    def find_all(path: str) -> List[ET.Element]:
        results = root.findall(path)
        if results:
            return results
        if ns:
            ns_path = "/".join(f"{ns}{p}" for p in path.split("/"))
            return root.findall(ns_path)
        return []

    issuer = find("issuer")
    issuer_cik = _xml_text(issuer, "issuerCik")
    issuer_name = _xml_text(issuer, "issuerName")
    issuer_ticker = _xml_text(issuer, "issuerTradingSymbol").upper()

    if not issuer_ticker:
        return None

    owner = find("reportingOwner")
    owner_id = owner.find("reportingOwnerId") if owner is not None else None
    owner_rel = owner.find("reportingOwnerRelationship") if owner is not None else None

    insider_name = _xml_text(owner_id, "rptOwnerName") if owner_id is not None else ""
    insider_cik = _xml_text(owner_id, "rptOwnerCik") if owner_id is not None else ""

    is_officer = _xml_text(owner_rel, "isOfficer") if owner_rel is not None else "0"
    is_director = _xml_text(owner_rel, "isDirector") if owner_rel is not None else "0"
    is_ten_pct = _xml_text(owner_rel, "isTenPercentOwner") if owner_rel is not None else "0"
    officer_title = _xml_text(owner_rel, "officerTitle") if owner_rel is not None else ""

    title_parts = []
    if is_officer in ("1", "true"):
        title_parts.append(officer_title or "Officer")
    if is_director in ("1", "true"):
        title_parts.append("Director")
    if is_ten_pct in ("1", "true"):
        title_parts.append("10% Owner")
    insider_title = ", ".join(title_parts) or "Other"

    transactions: List[Dict[str, Any]] = []
    for txn in find_all("nonDerivativeTable/nonDerivativeTransaction"):
        coding = txn.find("transactionCoding") if txn is not None else None
        amounts = txn.find("transactionAmounts") if txn is not None else None
        post = txn.find("postTransactionAmounts") if txn is not None else None
        ownership_nature = txn.find("ownershipNature") if txn is not None else None

        txn_code = _xml_text(coding, "transactionCode")
        txn_date = _xml_text(txn, "transactionDate")
        shares = _xml_float(amounts, "transactionShares")
        price = _xml_float(amounts, "transactionPricePerShare")
        acq_disp = _xml_text(amounts, "transactionAcquiredDisposedCode")
        shares_after = _xml_float(post, "sharesOwnedFollowingTransaction")
        direct_indirect = _xml_text(ownership_nature, "directOrIndirectOwnership")

        total_value = None
        if shares is not None and price is not None:
            total_value = round(shares * price, 2)

        transactions.append({
            "symbol": issuer_ticker,
            "cik": issuer_cik,
            "filing_date": file_date,
            "accession_number": accession,
            "insider_name": insider_name,
            "insider_title": insider_title,
            "transaction_type": txn_code,
            "transaction_date": txn_date,
            "shares": shares,
            "price_per_share": price,
            "total_value": total_value,
            "shares_owned_after": shares_after,
            "is_direct": 1 if direct_indirect == "D" else 0,
            "acquired_disposed": acq_disp,
            "filing_url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={issuer_cik}&type=4&dateb=&owner=include&count=10",
        })

    return {
        "issuer_ticker": issuer_ticker,
        "issuer_cik": issuer_cik,
        "issuer_name": issuer_name,
        "insider_name": insider_name,
        "insider_title": insider_title,
        "transactions": transactions,
    }


# ---------------------------------------------------------------------------
# SC 13D metadata extraction
# ---------------------------------------------------------------------------

def extract_13d_from_efts(hit_meta: Dict[str, str], cik_to_ticker: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Extract SC 13D information from filing metadata and index."""
    filer_cik = hit_meta["filer_cik"]
    accession_no_dashes = hit_meta["accession_no_dashes"]
    accession = hit_meta["accession"]
    file_date = hit_meta["file_date"]
    entity_name = hit_meta["entity_name"]
    form_type = hit_meta["form_type"]

    index_url = f"{ARCHIVES_BASE}/{filer_cik}/{accession_no_dashes}/index.json"
    data = _fetch_json(index_url)
    if not data:
        return None

    filing_url = f"https://www.sec.gov/Archives/edgar/data/{filer_cik}/{accession_no_dashes}/"

    return {
        "filer_name": entity_name,
        "filer_cik": filer_cik,
        "accession_number": accession,
        "filing_date": file_date,
        "form_type": form_type,
        "filing_url": filing_url,
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS insider_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    cik TEXT,
    filing_date TEXT NOT NULL,
    accession_number TEXT NOT NULL,
    insider_name TEXT,
    insider_title TEXT,
    transaction_type TEXT,
    transaction_date TEXT,
    shares REAL,
    price_per_share REAL,
    total_value REAL,
    shares_owned_after REAL,
    is_direct INTEGER DEFAULT 1,
    filing_url TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insider_txn_symbol ON insider_transactions(symbol);
CREATE INDEX IF NOT EXISTS idx_insider_txn_date ON insider_transactions(filing_date);
CREATE INDEX IF NOT EXISTS idx_insider_txn_accession ON insider_transactions(accession_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insider_txn_dedup
    ON insider_transactions(accession_number, insider_name, transaction_type, transaction_date, shares);

CREATE TABLE IF NOT EXISTS activist_stakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    cik TEXT,
    filing_date TEXT NOT NULL,
    accession_number TEXT NOT NULL,
    filer_name TEXT,
    filer_cik TEXT,
    form_type TEXT,
    percent_owned REAL,
    shares_held REAL,
    filing_url TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activist_symbol ON activist_stakes(symbol);
CREATE INDEX IF NOT EXISTS idx_activist_date ON activist_stakes(filing_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activist_dedup ON activist_stakes(accession_number);

CREATE TABLE IF NOT EXISTS filing_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    headline TEXT,
    details_json TEXT,
    filing_date TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_symbol ON filing_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_alert_date ON filing_alerts(created_at);

CREATE TABLE IF NOT EXISTS edgar_fetch_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    form_types_polled TEXT,
    filings_found INTEGER DEFAULT 0,
    filings_in_universe INTEGER DEFAULT 0,
    transactions_inserted INTEGER DEFAULT 0,
    alerts_generated INTEGER DEFAULT 0,
    notes_json TEXT
);
"""


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.executescript(SCHEMA_SQL)
    return conn


def is_accession_known(conn: sqlite3.Connection, accession: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM insider_transactions WHERE accession_number = ? LIMIT 1",
        (accession,),
    ).fetchone()
    if row:
        return True
    row = conn.execute(
        "SELECT 1 FROM activist_stakes WHERE accession_number = ? LIMIT 1",
        (accession,),
    ).fetchone()
    return row is not None


def insert_transactions(conn: sqlite3.Connection, txns: List[Dict[str, Any]]) -> int:
    now = _utc_now()
    inserted = 0
    for txn in txns:
        try:
            conn.execute(
                """INSERT OR IGNORE INTO insider_transactions
                   (symbol, cik, filing_date, accession_number, insider_name,
                    insider_title, transaction_type, transaction_date, shares,
                    price_per_share, total_value, shares_owned_after, is_direct,
                    filing_url, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    txn["symbol"], txn["cik"], txn["filing_date"],
                    txn["accession_number"], txn["insider_name"],
                    txn["insider_title"], txn["transaction_type"],
                    txn["transaction_date"], txn["shares"],
                    txn["price_per_share"], txn["total_value"],
                    txn["shares_owned_after"], txn["is_direct"],
                    txn["filing_url"], now,
                ),
            )
            inserted += conn.total_changes and 1 or 0
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    return inserted


def insert_activist_stake(conn: sqlite3.Connection, stake: Dict[str, Any]) -> bool:
    now = _utc_now()
    try:
        conn.execute(
            """INSERT OR IGNORE INTO activist_stakes
               (symbol, cik, filing_date, accession_number, filer_name,
                filer_cik, form_type, percent_owned, shares_held,
                filing_url, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                stake.get("symbol"), stake.get("cik"), stake["filing_date"],
                stake["accession_number"], stake["filer_name"],
                stake["filer_cik"], stake["form_type"],
                stake.get("percent_owned"), stake.get("shares_held"),
                stake["filing_url"], now,
            ),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


# ---------------------------------------------------------------------------
# Alert generation
# ---------------------------------------------------------------------------

def generate_alerts(conn: sqlite3.Connection, symbol: str, lookback_days: int = 14) -> int:
    """Check for notable patterns and generate filing alerts."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    now = _utc_now()
    alerts_created = 0

    purchases = conn.execute(
        """SELECT insider_name, insider_title, shares, price_per_share, total_value,
                  transaction_date, filing_date
           FROM insider_transactions
           WHERE symbol = ? AND transaction_type = 'P' AND filing_date >= ?
           ORDER BY filing_date DESC""",
        (symbol, cutoff),
    ).fetchall()

    if not purchases:
        return 0

    unique_buyers = set()
    for p in purchases:
        unique_buyers.add(p["insider_name"])

    if len(unique_buyers) >= 3:
        headline = f"{len(unique_buyers)} insiders bought {symbol} in the last {lookback_days} days"
        details = json.dumps({
            "buyers": list(unique_buyers),
            "total_purchases": len(purchases),
        })
        existing = conn.execute(
            "SELECT 1 FROM filing_alerts WHERE symbol=? AND alert_type='cluster_buying' AND filing_date>=?",
            (symbol, cutoff),
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO filing_alerts (symbol,alert_type,severity,headline,details_json,filing_date,created_at) VALUES (?,?,?,?,?,?,?)",
                (symbol, "cluster_buying", "critical", headline, details, purchases[0]["filing_date"], now),
            )
            alerts_created += 1

    for p in purchases:
        val = p["total_value"] or 0
        if val >= 1_000_000:
            headline = f"{p['insider_name']} ({p['insider_title']}) bought ${val:,.0f} of {symbol}"
            existing = conn.execute(
                "SELECT 1 FROM filing_alerts WHERE symbol=? AND alert_type='large_purchase' AND details_json LIKE ?",
                (symbol, f'%{p["insider_name"]}%'),
            ).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO filing_alerts (symbol,alert_type,severity,headline,details_json,filing_date,created_at) VALUES (?,?,?,?,?,?,?)",
                    (symbol, "large_purchase", "notable", headline,
                     json.dumps({"insider": p["insider_name"], "value": val}),
                     p["filing_date"], now),
                )
                alerts_created += 1

    for p in purchases:
        title_lower = (p["insider_title"] or "").lower()
        if any(t in title_lower for t in ("ceo", "cfo", "coo", "cto", "president", "chief")):
            headline = f"C-suite purchase: {p['insider_name']} ({p['insider_title']}) bought {symbol}"
            existing = conn.execute(
                "SELECT 1 FROM filing_alerts WHERE symbol=? AND alert_type='csuite_purchase' AND details_json LIKE ?",
                (symbol, f'%{p["insider_name"]}%'),
            ).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO filing_alerts (symbol,alert_type,severity,headline,details_json,filing_date,created_at) VALUES (?,?,?,?,?,?,?)",
                    (symbol, "csuite_purchase", "notable", headline,
                     json.dumps({"insider": p["insider_name"], "title": p["insider_title"],
                                 "shares": p["shares"], "value": p["total_value"]}),
                     p["filing_date"], now),
                )
                alerts_created += 1

    conn.commit()
    return alerts_created


# ---------------------------------------------------------------------------
# Per-issuer historical backfill
# ---------------------------------------------------------------------------

def backfill_symbol(
    conn: sqlite3.Connection,
    symbol: str,
    issuer_cik: str,
    cik_to_ticker: Dict[str, str],
    start_date: str,
    end_date: str,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Backfill all Form 4 + SC 13D/13G filings for ONE issuer over a date range.

    Filtering EFTS by the issuer's CIK keeps each symbol's pull to tens/low-hundreds
    of filings, so multi-year history is feasible on the free EDGAR API.
    """
    cik10 = str(issuer_cik).lstrip("0").zfill(10)
    cik_int = str(int(issuer_cik))
    stats = {"form4_hits": 0, "txns": 0, "activist_hits": 0, "activist": 0, "alerts": 0}

    # --- Form 4 (insider transactions) ---
    f4_hits = poll_efts("4", start_date, end_date, ciks=cik10)
    stats["form4_hits"] = len(f4_hits)
    seen: Set[str] = set()
    for hit in f4_hits:
        meta = parse_efts_hit(hit)
        if not meta:
            continue
        accession = meta["accession"]
        if accession in seen or is_accession_known(conn, accession):
            continue
        seen.add(accession)

        xml_url = meta.get("xml_url") or find_ownership_xml_url(meta["filer_cik"], meta["accession_no_dashes"])
        if not xml_url:
            continue
        xml_str = _fetch(xml_url, accept="application/xml")
        if not xml_str:
            continue
        parsed = parse_form4_xml(xml_str, accession, meta["file_date"])
        if not parsed:
            continue
        # Trust the issuer CIK on the filing; the ticker symbol on old filings
        # can differ, so key on CIK and stamp the requested symbol.
        if cik_int and str(parsed.get("issuer_cik") or "").lstrip("0") not in ("", cik_int):
            continue
        for txn in parsed["transactions"]:
            txn["symbol"] = symbol
        if dry_run:
            for txn in parsed["transactions"]:
                _print(f"    [dry] {symbol} | {parsed['insider_name']} ({parsed['insider_title']}) | "
                       f"{txn['transaction_type']} {txn.get('shares') or 0:,.0f} @ "
                       f"${txn.get('price_per_share') or 0:.2f} | {txn.get('transaction_date')}")
        else:
            stats["txns"] += insert_transactions(conn, parsed["transactions"])

    # --- SC 13D/13G (activist / large holders) ---
    td_hits = poll_efts("SC 13D,SC 13D/A,SC 13G,SC 13G/A", start_date, end_date, ciks=cik10)
    stats["activist_hits"] = len(td_hits)
    for hit in td_hits:
        meta = parse_efts_hit(hit)
        if not meta:
            continue
        accession = meta["accession"]
        if accession in seen or is_accession_known(conn, accession):
            continue
        seen.add(accession)

        stake_meta = extract_13d_from_efts(meta, cik_to_ticker)
        if not stake_meta:
            continue
        # We queried by SUBJECT company CIK, so the target IS this symbol.
        stake_meta["symbol"] = symbol
        stake_meta["cik"] = cik_int
        if dry_run:
            _print(f"    [dry] 13D/G {symbol} <- {stake_meta.get('filer_name')} "
                   f"({meta['form_type']}) {meta['file_date']}")
        elif insert_activist_stake(conn, stake_meta):
            stats["activist"] += 1

    if not dry_run:
        stats["alerts"] = generate_alerts(conn, symbol, lookback_days=10000)
    return stats


def run_backfill(symbols: List[str], days: int, dry_run: bool = False) -> None:
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    _print(f"[edgar-backfill] {len(symbols)} symbol(s) | {start_date} -> {end_date} ({days}d)")

    ticker_to_cik = load_or_fetch_cik_map()
    cik_to_ticker = build_cik_to_ticker(ticker_to_cik)
    conn = get_db()

    run_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO edgar_fetch_runs (run_id, started_at, status, form_types_polled) VALUES (?,?,?,?)",
        (run_id, _utc_now(), "running", f"backfill:4,SC 13D/G ({days}d)"),
    )
    conn.commit()

    totals = {"txns": 0, "activist": 0, "alerts": 0, "no_cik": 0, "symbols": 0}
    for i, symbol in enumerate(symbols, 1):
        cik = ticker_to_cik.get(symbol.upper())
        if not cik:
            totals["no_cik"] += 1
            _print(f"[{i}/{len(symbols)}] {symbol}: no CIK mapping, skipped")
            continue
        s = backfill_symbol(conn, symbol.upper(), cik, cik_to_ticker, start_date, end_date, dry_run)
        totals["txns"] += s["txns"]
        totals["activist"] += s["activist"]
        totals["alerts"] += s["alerts"]
        totals["symbols"] += 1
        _print(f"[{i}/{len(symbols)}] {symbol}: form4_hits={s['form4_hits']} txns+{s['txns']} "
               f"| 13D/G_hits={s['activist_hits']} +{s['activist']} | alerts+{s['alerts']}")

    conn.execute(
        """UPDATE edgar_fetch_runs SET completed_at=?, status=?, filings_in_universe=?,
           transactions_inserted=?, alerts_generated=?, notes_json=? WHERE run_id=?""",
        (_utc_now(), "completed", totals["symbols"], totals["txns"], totals["alerts"],
         json.dumps({"mode": "backfill", "days": days, "symbols": len(symbols),
                     "no_cik": totals["no_cik"], "activist": totals["activist"]}), run_id),
    )
    conn.commit()
    conn.close()
    _print(f"\n[edgar-backfill] Complete: {json.dumps(totals)}")
    _print(json.dumps({"backfill": True, **totals}))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _print(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect SEC EDGAR filings")
    parser.add_argument("--lookback-hours", type=int, default=48,
                        help="Hours to look back for filings (default: 48)")
    parser.add_argument("--form-types", type=str, default="4,SC 13D,SC 13D/A,SC 13G,SC 13G/A",
                        help="Comma-separated form types to poll")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be collected without storing")
    parser.add_argument("--backfill-symbols", type=str, default=None,
                        help="Comma-separated tickers to backfill per-issuer (Form 4 + 13D/13G history)")
    parser.add_argument("--backfill-universe", action="store_true",
                        help="Backfill the entire clean universe per-issuer (long run)")
    parser.add_argument("--backfill-days", type=int, default=1095,
                        help="How many days of history to backfill (default: 1095 = ~3y)")
    args = parser.parse_args()

    # --- Backfill mode (per-issuer historical pull) ---
    if args.backfill_symbols or args.backfill_universe:
        if args.backfill_universe:
            symbols = sorted(load_universe(UNIVERSE_PATH))
        else:
            symbols = [s.strip().upper() for s in args.backfill_symbols.split(",") if s.strip()]
        run_backfill(symbols, args.backfill_days, dry_run=args.dry_run)
        return

    run_id = str(uuid.uuid4())
    started_at = _utc_now()

    _print(f"[edgar] Run {run_id[:8]} started at {started_at}")
    _print(f"[edgar] Lookback: {args.lookback_hours}h | Forms: {args.form_types}")

    universe = load_universe(UNIVERSE_PATH)
    _print(f"[edgar] Universe: {len(universe)} symbols")

    ticker_to_cik = load_or_fetch_cik_map()
    cik_to_ticker = build_cik_to_ticker(ticker_to_cik)
    _print(f"[edgar] CIK map: {len(ticker_to_cik)} tickers")

    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = (datetime.now(timezone.utc) - timedelta(hours=args.lookback_hours)).strftime("%Y-%m-%d")

    conn = get_db()
    conn.execute(
        "INSERT INTO edgar_fetch_runs (run_id, started_at, status, form_types_polled) VALUES (?,?,?,?)",
        (run_id, started_at, "running", args.form_types),
    )
    conn.commit()

    form4_types = "4"
    thirteend_types = "SC 13D,SC 13D/A,SC 13G,SC 13G/A"

    total_filings_found = 0
    total_in_universe = 0
    total_txns_inserted = 0
    total_alerts = 0
    symbols_with_filings: Set[str] = set()

    # --- Form 4 filings ---
    _print(f"\n[edgar] Polling Form 4 filings ({start_date} to {end_date})...")
    form4_hits = poll_efts(form4_types, start_date, end_date)
    _print(f"[edgar] Found {len(form4_hits)} Form 4 filing documents")
    total_filings_found += len(form4_hits)

    seen_accessions: Set[str] = set()
    for i, hit in enumerate(form4_hits):
        meta = parse_efts_hit(hit)
        if not meta:
            continue

        accession = meta["accession"]
        if accession in seen_accessions:
            continue
        seen_accessions.add(accession)

        if is_accession_known(conn, accession):
            continue

        xml_url = meta.get("xml_url")
        if not xml_url:
            xml_url = find_ownership_xml_url(meta["filer_cik"], meta["accession_no_dashes"])
        if not xml_url:
            continue

        xml_str = _fetch(xml_url, accept="application/xml")
        if not xml_str:
            continue

        parsed = parse_form4_xml(xml_str, accession, meta["file_date"])
        if not parsed:
            continue

        ticker = parsed["issuer_ticker"]
        if ticker not in universe:
            continue

        total_in_universe += 1
        symbols_with_filings.add(ticker)

        if args.dry_run:
            for txn in parsed["transactions"]:
                code = txn["transaction_type"]
                shares = txn["shares"] or 0
                price = txn["price_per_share"] or 0
                val = txn["total_value"] or 0
                _print(f"  [dry] {ticker} | {parsed['insider_name']} ({parsed['insider_title']}) | {code} {shares:,.0f} @ ${price:.2f} = ${val:,.0f}")
        else:
            inserted = insert_transactions(conn, parsed["transactions"])
            total_txns_inserted += inserted
            alerts = generate_alerts(conn, ticker)
            total_alerts += alerts

        if (i + 1) % 100 == 0:
            _print(f"  [progress] Processed {i+1}/{len(form4_hits)} Form 4 hits, {total_in_universe} in universe")

    # --- SC 13D filings ---
    _print(f"\n[edgar] Polling SC 13D/13G filings ({start_date} to {end_date})...")
    thirteend_hits = poll_efts(thirteend_types, start_date, end_date)
    _print(f"[edgar] Found {len(thirteend_hits)} SC 13D/13G filing documents")
    total_filings_found += len(thirteend_hits)

    for hit in thirteend_hits:
        meta = parse_efts_hit(hit)
        if not meta:
            continue

        accession = meta["accession"]
        if accession in seen_accessions:
            continue
        seen_accessions.add(accession)

        if is_accession_known(conn, accession):
            continue

        stake_meta = extract_13d_from_efts(meta, cik_to_ticker)
        if not stake_meta:
            continue

        target_ticker = cik_to_ticker.get(meta["filer_cik"])
        if not target_ticker or target_ticker not in universe:
            continue

        total_in_universe += 1
        symbols_with_filings.add(target_ticker)

        stake_meta["symbol"] = target_ticker
        stake_meta["cik"] = meta["filer_cik"]

        if args.dry_run:
            _print(f"  [dry] 13D: {stake_meta['filer_name']} -> {target_ticker} ({meta['form_type']})")
        else:
            if insert_activist_stake(conn, stake_meta):
                headline = f"New {meta['form_type']}: {stake_meta['filer_name']} filed on {target_ticker}"
                conn.execute(
                    "INSERT INTO filing_alerts (symbol,alert_type,severity,headline,details_json,filing_date,created_at) VALUES (?,?,?,?,?,?,?)",
                    (target_ticker, "new_13d", "notable", headline,
                     json.dumps({"filer": stake_meta["filer_name"], "form_type": meta["form_type"]}),
                     meta["file_date"], _utc_now()),
                )
                conn.commit()
                total_alerts += 1

    completed_at = _utc_now()
    conn.execute(
        """UPDATE edgar_fetch_runs
           SET completed_at=?, status=?, filings_found=?, filings_in_universe=?,
               transactions_inserted=?, alerts_generated=?, notes_json=?
           WHERE run_id=?""",
        (
            completed_at, "completed", total_filings_found, total_in_universe,
            total_txns_inserted, total_alerts,
            json.dumps({"symbols_with_filings": sorted(symbols_with_filings)}),
            run_id,
        ),
    )
    conn.commit()
    conn.close()

    summary = {
        "run_id": run_id[:8],
        "filings_found": total_filings_found,
        "filings_in_universe": total_in_universe,
        "transactions_inserted": total_txns_inserted,
        "alerts_generated": total_alerts,
        "symbols_with_filings": len(symbols_with_filings),
    }
    _print(f"\n[edgar] Complete: {json.dumps(summary)}")
    _print(json.dumps(summary))


if __name__ == "__main__":
    main()
