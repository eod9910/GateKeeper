"""Collect SEC 13F-HR institutional holdings from notable fund managers.

For each fund in the registry, fetches their latest 13F-HR filing via the
submissions API, parses the infotable XML, matches holdings to our universe,
and stores quarter-by-quarter snapshots in edgar-filings.sqlite.

Zero LLM cost — all parsing and scoring is deterministic.
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
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
TICKERS_CACHE = DATA_DIR / "company_tickers.json"

USER_AGENT = "PatternDetector/1.0 edgar-13f-collector@patterndetector.local"
SUBMISSIONS_BASE = "https://data.sec.gov/submissions"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"

REQUEST_DELAY_S = 0.22

# Notable institutional managers — seeded with well-known funds.
# CIK -> (short_name, category)
SEED_FUNDS: Dict[str, Tuple[str, str]] = {
    "1067983": ("Berkshire Hathaway", "conglomerate"),
    "1423053": ("Citadel Advisors", "hedge_fund"),
    "1037389": ("Renaissance Technologies", "hedge_fund"),
    "1336528": ("Bridgewater Associates", "hedge_fund"),
    "1103804": ("Two Sigma Investments", "hedge_fund"),
    "1009207": ("D.E. Shaw", "hedge_fund"),
    "1061768": ("Millennium Management", "hedge_fund"),
    "1364742": ("Point72 Asset Management", "hedge_fund"),
    "1535392": ("Tiger Global Management", "hedge_fund"),
    "921669":  ("Appaloosa Management", "hedge_fund"),
    "921768":  ("Druckenmiller (Duquesne)", "hedge_fund"),
    "1336326": ("Baupost Group", "hedge_fund"),
    "1056831": ("Icahn (Icahn Capital)", "activist"),
    "1336291": ("Pershing Square", "activist"),
    "885590":  ("Greenlight Capital", "hedge_fund"),
    "1345471": ("AQR Capital Management", "quant"),
    "1649339": ("Coatue Management", "hedge_fund"),
    "1061165": ("Elliott Management", "activist"),
    "1159159": ("Third Point", "activist"),
    "1006438": ("ValueAct Capital", "activist"),
    "102909":  ("Vanguard Group", "index_fund"),
    "1364954": ("Fidelity (FMR)", "mutual_fund"),
    "93751":   ("State Street", "index_fund"),
    "1166559": ("ARK Invest", "etf"),
    "1350694": ("Jana Partners", "activist"),
    "1079114": ("Lone Pine Capital", "hedge_fund"),
    "1167557": ("Viking Global", "hedge_fund"),
    "1599901": ("Whale Rock Capital", "hedge_fund"),
    "1040273": ("Maverick Capital", "hedge_fund"),
    "1029160": ("Matrix Capital Management", "hedge_fund"),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _print(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# HTTP helpers (reuse patterns from collect_edgar_filings.py)
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
                _print(f"  [rate-limit] 403 on {url}, waiting {wait}s")
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                if attempt >= retries:
                    _print(f"  [http-err] {e.code} {url}")
                    return None
                time.sleep(2 * (attempt + 1))
        except Exception as exc:
            if attempt >= retries:
                _print(f"  [err] {url}: {exc}")
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
# Universe + name matching
# ---------------------------------------------------------------------------

def load_universe(path: Path) -> Dict[str, str]:
    """Return {SYMBOL: company_name} for all universe stocks."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    stocks = payload.get("stocks") or []
    result = {}
    for s in stocks:
        sym = str(s.get("symbol") or s.get("ticker") or "").strip().upper()
        name = str(s.get("name") or s.get("company") or "").strip()
        if sym:
            result[sym] = name
    return result


def build_name_to_ticker_map(universe: Dict[str, str]) -> Dict[str, str]:
    """Build a map from cleaned company name fragments to tickers."""
    mapping: Dict[str, str] = {}

    for ticker, full_name in universe.items():
        mapping[ticker.upper()] = ticker

        clean = full_name.upper()
        for suffix in [" COMMON STOCK", " - COMMON STOCK", " CLASS A", " CLASS B",
                       " CLASS C", " INC.", " INC", " CORP.", " CORP",
                       " CO.", " CO", " LTD.", " LTD", " PLC", " N.V.",
                       " S.A.", " AG", " SE", " GROUP", " HOLDINGS",
                       " ENTERPRISES", " INTERNATIONAL", " TECHNOLOGIES",
                       " TECHNOLOGY", ", INC.", ", INC", ", CORP.", ", CORP"]:
            clean = clean.replace(suffix, "")
        clean = clean.strip()
        if clean and len(clean) >= 3:
            mapping[clean] = ticker

    return mapping


def match_issuer_to_ticker(
    issuer_name: str,
    name_map: Dict[str, str],
    universe_symbols: Set[str],
) -> Optional[str]:
    """Try to match a 13F issuer name to a ticker in our universe."""
    upper = issuer_name.upper().strip()

    for suffix in [" COM", " CL A", " CL B", " CL C", " NEW", " SHS",
                   " ORD", " ADR", " ADS", " HLDGS", " HOLDING",
                   " INC", " CORP", " CO", " LTD", " PLC", " AG", " SE",
                   " N V", " S A", " GROUP", " INTL", " TECHNOLOGIES",
                   " TECH"]:
        upper = upper.replace(suffix, "")
    upper = upper.strip()

    if upper in name_map:
        return name_map[upper]

    for name_key, ticker in name_map.items():
        if len(name_key) >= 4 and name_key in upper:
            return ticker
        if len(upper) >= 4 and upper in name_key:
            return ticker

    return None


# ---------------------------------------------------------------------------
# 13F submission discovery
# ---------------------------------------------------------------------------

def find_latest_13f(cik: str) -> Optional[Dict[str, str]]:
    """Find the most recent 13F-HR filing for a CIK via the submissions API."""
    padded = cik.zfill(10)
    url = f"{SUBMISSIONS_BASE}/CIK{padded}.json"
    data = _fetch_json(url)
    if not data:
        return None

    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    filing_dates = recent.get("filingDate", [])
    primary_docs = recent.get("primaryDocument", [])

    for i, form in enumerate(forms):
        if form in ("13F-HR", "13F-HR/A"):
            return {
                "form": form,
                "accession": accessions[i] if i < len(accessions) else "",
                "filing_date": filing_dates[i] if i < len(filing_dates) else "",
                "primary_doc": primary_docs[i] if i < len(primary_docs) else "",
                "cik": cik,
            }

    return None


def find_all_13f(cik: str, max_quarters: int = 12) -> List[Dict[str, str]]:
    """Return ALL recent 13F-HR filings for a CIK (newest first), up to max_quarters.

    The submissions ``recent`` block holds ~1000 filings; for a fund filing
    quarterly that easily spans several years, which is enough for our backfill.
    """
    padded = cik.zfill(10)
    data = _fetch_json(f"{SUBMISSIONS_BASE}/CIK{padded}.json")
    if not data:
        return []
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    filing_dates = recent.get("filingDate", [])
    primary_docs = recent.get("primaryDocument", [])

    out: List[Dict[str, str]] = []
    for i, form in enumerate(forms):
        if form in ("13F-HR", "13F-HR/A"):
            out.append({
                "form": form,
                "accession": accessions[i] if i < len(accessions) else "",
                "filing_date": filing_dates[i] if i < len(filing_dates) else "",
                "primary_doc": primary_docs[i] if i < len(primary_docs) else "",
                "cik": cik,
            })
            if len(out) >= max_quarters:
                break
    return out


def find_infotable_url(cik: str, accession: str) -> Optional[str]:
    """Find the infotable XML document in a 13F filing."""
    accession_no_dashes = accession.replace("-", "")
    index_url = f"{ARCHIVES_BASE}/{cik}/{accession_no_dashes}/index.json"
    data = _fetch_json(index_url)
    if not data:
        return None

    items = (data.get("directory") or {}).get("item") or []
    for item in items:
        name = item.get("name", "")
        lower = name.lower()
        if lower.endswith(".xml") and ("infotable" in lower or "information" in lower):
            return f"{ARCHIVES_BASE}/{cik}/{accession_no_dashes}/{name}"

    for item in items:
        name = item.get("name", "")
        lower = name.lower()
        if lower.endswith(".xml") and lower != "primary_doc.xml" and "r9999" not in lower:
            size = item.get("size", "0")
            if int(str(size).replace(",", "") or "0") > 1000:
                return f"{ARCHIVES_BASE}/{cik}/{accession_no_dashes}/{name}"

    return None


# ---------------------------------------------------------------------------
# 13F infotable XML parsing
# ---------------------------------------------------------------------------

INFOTABLE_NS = "http://www.sec.gov/edgar/document/thirteenf/informationtable"


def parse_infotable_xml(xml_str: str) -> List[Dict[str, Any]]:
    """Parse a 13F infotable XML document into a list of holdings."""
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        return []

    ns_map = {"ns": INFOTABLE_NS}

    entries = root.findall(".//ns:infoTable", ns_map)
    if not entries:
        entries = root.findall(".//{%s}infoTable" % INFOTABLE_NS)
    if not entries:
        entries = root.findall(".//infoTable")
    if not entries:
        for child in root:
            tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            if tag.lower() == "infotable":
                entries.append(child)

    holdings: List[Dict[str, Any]] = []
    for entry in entries:
        holding = _parse_infotable_entry(entry)
        if holding:
            holdings.append(holding)

    return holdings


def _xml_find_text(elem: ET.Element, tag: str) -> str:
    """Find text in an element, trying with and without namespace."""
    node = elem.find(tag)
    if node is None:
        node = elem.find(f"{{{INFOTABLE_NS}}}{tag}")
    if node is None:
        for child in elem:
            child_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            if child_tag.lower() == tag.lower():
                node = child
                break
    if node is not None and node.text:
        return node.text.strip()
    return ""


def _parse_infotable_entry(entry: ET.Element) -> Optional[Dict[str, Any]]:
    """Parse a single infoTable entry."""
    issuer = _xml_find_text(entry, "nameOfIssuer")
    title = _xml_find_text(entry, "titleOfClass")
    cusip = _xml_find_text(entry, "cusip")
    value_str = _xml_find_text(entry, "value")
    put_call = _xml_find_text(entry, "putCall")
    discretion = _xml_find_text(entry, "investmentDiscretion")

    value_thousands = None
    if value_str:
        try:
            value_thousands = int(value_str.replace(",", ""))
        except ValueError:
            pass

    shares = None
    share_type = "SH"
    shares_elem = entry.find("shrsOrPrnAmt")
    if shares_elem is None:
        shares_elem = entry.find(f"{{{INFOTABLE_NS}}}shrsOrPrnAmt")
    if shares_elem is None:
        for child in entry:
            child_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            if child_tag.lower() == "shrsorprnamt":
                shares_elem = child
                break
    if shares_elem is not None:
        amt_text = _xml_find_text(shares_elem, "sshPrnamt")
        type_text = _xml_find_text(shares_elem, "sshPrnamtType")
        if amt_text:
            try:
                shares = int(amt_text.replace(",", ""))
            except ValueError:
                pass
        if type_text:
            share_type = type_text.upper()

    if not issuer and not cusip:
        return None

    return {
        "issuer_name": issuer,
        "title_of_class": title,
        "cusip": cusip,
        "value_thousands": value_thousands,
        "shares": shares,
        "share_type": share_type,
        "put_call": put_call or None,
        "investment_discretion": discretion or "SOLE",
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA_13F_SQL = """
CREATE TABLE IF NOT EXISTS fund_registry (
    cik TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT,
    category TEXT,
    is_notable INTEGER DEFAULT 0,
    last_filing_date TEXT,
    last_report_period TEXT,
    last_accession TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institutional_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_cik TEXT NOT NULL,
    fund_name TEXT,
    report_period TEXT NOT NULL,
    filing_date TEXT NOT NULL,
    accession_number TEXT NOT NULL,
    symbol TEXT,
    cusip TEXT,
    issuer_name TEXT,
    title_of_class TEXT,
    value_thousands INTEGER,
    shares INTEGER,
    share_type TEXT DEFAULT 'SH',
    put_call TEXT,
    investment_discretion TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inst_hold_symbol ON institutional_holdings(symbol);
CREATE INDEX IF NOT EXISTS idx_inst_hold_fund ON institutional_holdings(fund_cik);
CREATE INDEX IF NOT EXISTS idx_inst_hold_period ON institutional_holdings(report_period);
CREATE INDEX IF NOT EXISTS idx_inst_hold_accession ON institutional_holdings(accession_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inst_hold_dedup
    ON institutional_holdings(accession_number, cusip, fund_cik, shares);
"""


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.executescript(SCHEMA_13F_SQL)
    return conn


def seed_fund_registry(conn: sqlite3.Connection) -> int:
    """Seed the fund registry with notable institutional managers."""
    now = _utc_now()
    inserted = 0
    for cik, (short_name, category) in SEED_FUNDS.items():
        try:
            conn.execute(
                """INSERT OR IGNORE INTO fund_registry
                   (cik, name, short_name, category, is_notable, created_at, updated_at)
                   VALUES (?,?,?,?,1,?,?)""",
                (cik, short_name, short_name, category, now, now),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    return inserted


def get_notable_funds(conn: sqlite3.Connection) -> List[Dict[str, str]]:
    rows = conn.execute(
        "SELECT cik, name, short_name, category, last_accession FROM fund_registry WHERE is_notable = 1"
    ).fetchall()
    return [dict(r) for r in rows]


def is_accession_collected(conn: sqlite3.Connection, accession: str, fund_cik: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM institutional_holdings WHERE accession_number = ? AND fund_cik = ? LIMIT 1",
        (accession, fund_cik),
    ).fetchone()
    return row is not None


def insert_holdings(
    conn: sqlite3.Connection,
    fund_cik: str,
    fund_name: str,
    report_period: str,
    filing_date: str,
    accession: str,
    holdings: List[Dict[str, Any]],
) -> int:
    now = _utc_now()
    inserted = 0
    for h in holdings:
        try:
            conn.execute(
                """INSERT OR IGNORE INTO institutional_holdings
                   (fund_cik, fund_name, report_period, filing_date, accession_number,
                    symbol, cusip, issuer_name, title_of_class, value_thousands,
                    shares, share_type, put_call, investment_discretion, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    fund_cik, fund_name, report_period, filing_date, accession,
                    h.get("symbol"), h["cusip"], h["issuer_name"],
                    h["title_of_class"], h["value_thousands"],
                    h["shares"], h["share_type"], h.get("put_call"),
                    h.get("investment_discretion"), now,
                ),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    return inserted


def update_fund_registry(
    conn: sqlite3.Connection,
    cik: str,
    filing_date: str,
    report_period: str,
    accession: str,
) -> None:
    conn.execute(
        """UPDATE fund_registry
           SET last_filing_date=?, last_report_period=?, last_accession=?, updated_at=?
           WHERE cik=?""",
        (filing_date, report_period, accession, _utc_now(), cik),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Report period extraction
# ---------------------------------------------------------------------------

def extract_report_period(cik: str, accession: str) -> Optional[str]:
    """Try to extract the report period from the primary 13F document."""
    accession_no_dashes = accession.replace("-", "")
    index_url = f"{ARCHIVES_BASE}/{cik}/{accession_no_dashes}/index.json"
    data = _fetch_json(index_url)
    if not data:
        return None

    items = (data.get("directory") or {}).get("item") or []
    for item in items:
        name = item.get("name", "")
        lower = name.lower()
        if lower.endswith(".xml") and ("primary" in lower or "13f" in lower) and "infotable" not in lower:
            xml_url = f"{ARCHIVES_BASE}/{cik}/{accession_no_dashes}/{name}"
            xml_str = _fetch(xml_url, accept="application/xml")
            if xml_str:
                match = re.search(
                    r"<reportCalendarOrQuarter>(.*?)</reportCalendarOrQuarter>",
                    xml_str,
                    re.IGNORECASE,
                )
                if match:
                    return match.group(1).strip()
                match = re.search(
                    r"<periodOfReport>(.*?)</periodOfReport>",
                    xml_str,
                    re.IGNORECASE,
                )
                if match:
                    return match.group(1).strip()

    return None


# ---------------------------------------------------------------------------
# Smart money alerts
# ---------------------------------------------------------------------------

def generate_13f_alerts(conn: sqlite3.Connection, symbols_with_holdings: Set[str]) -> int:
    """Generate alerts for notable institutional activity."""
    now = _utc_now()
    alerts = 0

    for symbol in symbols_with_holdings:
        fund_count = conn.execute(
            """SELECT COUNT(DISTINCT fund_cik) FROM institutional_holdings
               WHERE symbol = ? AND report_period = (
                   SELECT MAX(report_period) FROM institutional_holdings WHERE symbol = ?
               )""",
            (symbol, symbol),
        ).fetchone()[0]

        if fund_count >= 3:
            existing = conn.execute(
                "SELECT 1 FROM filing_alerts WHERE symbol=? AND alert_type='smart_money_consensus'",
                (symbol,),
            ).fetchone()
            if not existing:
                funds = conn.execute(
                    """SELECT DISTINCT fund_name FROM institutional_holdings
                       WHERE symbol = ? AND report_period = (
                           SELECT MAX(report_period) FROM institutional_holdings WHERE symbol = ?
                       )""",
                    (symbol, symbol),
                ).fetchall()
                fund_names = [r["fund_name"] for r in funds]
                headline = f"{fund_count} notable funds hold {symbol}"
                conn.execute(
                    """INSERT INTO filing_alerts
                       (symbol,alert_type,severity,headline,details_json,filing_date,created_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (symbol, "smart_money_consensus", "notable", headline,
                     json.dumps({"funds": fund_names, "count": fund_count}),
                     now[:10], now),
                )
                alerts += 1

    conn.commit()
    return alerts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_filing(conn, args, cik, fund_name, filing, name_map, universe_symbols,
                   symbols_with_holdings: Set[str]) -> Tuple[int, int, bool]:
    """Process one 13F-HR filing: parse infotable, match to universe, store.

    Returns (holdings_stored, holdings_matched, processed_flag).
    """
    accession = filing["accession"]
    filing_date = filing["filing_date"]
    _print(f"  {filing['form']} filed {filing_date} (acc: {accession})")

    if not args.dry_run and is_accession_collected(conn, accession, cik):
        _print(f"  [skip] Already in database")
        update_fund_registry(conn, cik, filing_date, "", accession)
        return (0, 0, False)

    report_period = extract_report_period(cik, accession)
    _print(f"  Report period: {report_period or 'unknown'}")

    infotable_url = find_infotable_url(cik, accession)
    if not infotable_url:
        _print(f"  [skip] Could not find infotable XML")
        return (0, 0, False)

    xml_str = _fetch(infotable_url, accept="application/xml")
    if not xml_str:
        _print(f"  [skip] Could not download infotable")
        return (0, 0, False)

    holdings = parse_infotable_xml(xml_str)
    matched = 0
    for h in holdings:
        ticker = match_issuer_to_ticker(h["issuer_name"], name_map, universe_symbols)
        h["symbol"] = ticker if ticker else None
        if ticker:
            matched += 1
    universe_holdings = [h for h in holdings if h.get("symbol")]
    _print(f"  Parsed {len(holdings)} holdings, matched {matched} to universe")

    if args.dry_run:
        for h in universe_holdings[:10]:
            _print(f"    {h['symbol']:6s} | {h['issuer_name'][:30]:30s} | {h.get('shares') or 0:,} shs")
        return (0, matched, True)

    inserted = insert_holdings(conn, cik, fund_name, report_period or "unknown",
                               filing_date, accession, universe_holdings)
    update_fund_registry(conn, cik, filing_date, report_period or "", accession)
    for h in universe_holdings:
        if h.get("symbol"):
            symbols_with_holdings.add(h["symbol"])
    return (inserted, matched, True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect 13F institutional holdings")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be collected without storing")
    parser.add_argument("--fund-cik", type=str, default=None,
                        help="Collect only this specific fund CIK (for testing)")
    parser.add_argument("--backfill", action="store_true",
                        help="Walk ALL historical 13F-HR quarters per fund (not just latest)")
    parser.add_argument("--max-quarters", type=int, default=12,
                        help="Max historical quarters per fund when backfilling (default: 12 = ~3y)")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())
    started_at = _utc_now()

    _print(f"[13f] Run {run_id[:8]} started at {started_at}")

    universe = load_universe(UNIVERSE_PATH)
    universe_symbols = set(universe.keys())
    _print(f"[13f] Universe: {len(universe)} symbols")

    name_map = build_name_to_ticker_map(universe)
    _print(f"[13f] Name map: {len(name_map)} entries")

    conn = get_db()
    seeded = seed_fund_registry(conn)
    if seeded > 0:
        _print(f"[13f] Seeded {seeded} funds into registry")

    if args.fund_cik:
        funds = [{"cik": args.fund_cik, "name": args.fund_cik, "short_name": args.fund_cik,
                  "category": "custom", "last_accession": None}]
    else:
        funds = get_notable_funds(conn)

    _print(f"[13f] Processing {len(funds)} notable funds...")

    total_funds_processed = 0
    total_holdings_stored = 0
    total_matched = 0
    total_alerts = 0
    symbols_with_holdings: Set[str] = set()

    for i, fund in enumerate(funds):
        cik = fund["cik"]
        fund_name = fund.get("short_name") or fund.get("name") or cik
        _print(f"\n[13f] ({i+1}/{len(funds)}) {fund_name} (CIK {cik})...")

        if args.backfill:
            filings = find_all_13f(cik, max_quarters=args.max_quarters)
            if not filings:
                _print(f"  [skip] No 13F-HR filings found")
                continue
            _print(f"  Backfilling {len(filings)} 13F-HR quarter(s)")
        else:
            latest = find_latest_13f(cik)
            if not latest:
                _print(f"  [skip] No 13F-HR filing found")
                continue
            if not args.dry_run and fund.get("last_accession") == latest["accession"]:
                _print(f"  [skip] Already collected this filing")
                continue
            filings = [latest]

        fund_did_process = False
        for filing in filings:
            stored, matched, processed = process_filing(
                conn, args, cik, fund_name, filing, name_map, universe_symbols, symbols_with_holdings)
            total_holdings_stored += stored
            total_matched += matched
            fund_did_process = fund_did_process or processed

        if fund_did_process:
            total_funds_processed += 1

    if not args.dry_run and symbols_with_holdings:
        total_alerts = generate_13f_alerts(conn, symbols_with_holdings)

    conn.close()

    summary = {
        "run_id": run_id[:8],
        "funds_processed": total_funds_processed,
        "total_holdings_stored": total_holdings_stored,
        "symbols_matched": len(symbols_with_holdings),
        "alerts_generated": total_alerts,
    }
    _print(f"\n[13f] Complete: {json.dumps(summary)}")
    _print(json.dumps(summary))


if __name__ == "__main__":
    main()
