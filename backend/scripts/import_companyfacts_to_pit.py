#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
sys.path.insert(0, str(SERVICES_DIR))

import fundamentals_pit_store as pit_store  # noqa: E402


DEFAULT_COMPANYFACTS_DIR = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "companyfacts"
DEFAULT_ELIGIBILITY_REPORT = ROOT / "backend" / "data" / "ledger_filing_eligibility_report.json"
DEFAULT_UNIVERSE = ROOT / "backend" / "data" / "ledger_filing_eligible.json"
DEFAULT_SYMBOL_CATALOG_DB = ROOT / "backend" / "data" / "symbol-catalog.sqlite"

SOURCE_TYPE = "sec_companyfacts_bulk"
ALLOWED_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"}
SHARES_OUTSTANDING_CONCEPTS = (
    ("dei", "EntityCommonStockSharesOutstanding"),
    ("us-gaap", "CommonStockSharesOutstanding"),
    ("us-gaap", "WeightedAverageNumberOfSharesOutstandingBasic"),
    ("us-gaap", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"),
    ("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
)
CORE_METRICS = (
    "revenue",
    "operating_income",
    "net_income",
    "current_assets",
    "current_liabilities",
    "shareholders_equity",
    "operating_cash_flow",
    "capital_expenditures",
)

COMPANYFACTS_CONCEPTS: Dict[str, List[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "Revenues",
        "RevenuesNetOfInterestExpense",
        "RealEstateRevenueNet",
        "OperatingLeasesIncomeStatementLeaseRevenue",
        "UtilityRevenue",
        "RegulatedAndUnregulatedOperatingRevenue",
        "RegulatedOperatingRevenue",
        "RegulatedOperatingRevenueGas",
        "ElectricDomesticRegulatedRevenue",
        "GasDomesticRegulatedRevenue",
        "UnregulatedOperatingRevenue",
        "RevenueMineralSales",
        "OilAndGasRevenue",
        "OilAndGasSalesRevenue",
        "NaturalGasProductionRevenue",
        "NaturalGasMidstreamRevenue",
        "OilAndCondensateRevenue",
        "RevenueOilAndGasServices",
        "ResultsOfOperationsRevenueFromOilAndGasProducingActivities",
        "OtherSalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "TechnologyServicesRevenue",
        "NoninterestIncome",
        "InterestIncomeExpenseNet",
    ],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "shareholders_equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "capital_expenditures": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
        "PaymentsToAcquireOtherPropertyPlantAndEquipment",
        "PaymentsToAcquireOtherProductiveAssets",
        "PaymentsForProceedsFromProductiveAssets",
        "PaymentsToAcquireOilAndGasProperty",
        "PaymentsToAcquireOilAndGasPropertyAndEquipment",
        "PaymentsToAcquireMiningAssets",
        "PaymentsToAcquireMineralRights",
        "PaymentsToAcquireAssetsInvestingActivities",
        "PaymentsForCapitalImprovements",
        "SegmentExpenditureAdditionToLongLivedAssets",
        "PropertyPlantAndEquipmentAdditions",
        "CapitalExpendituresIncurredButNotYetPaid",
    ],
}

IFRS_COMPANYFACTS_CONCEPTS: Dict[str, List[str]] = {
    "revenue": [
        "RevenueFromContractsWithCustomers",
        "Revenue",
        "OtherRevenue",
        "RevenueFromSaleOfGoods",
        "RevenueFromRenderingOfServices",
    ],
    "operating_income": [
        "ProfitLossFromOperatingActivities",
    ],
    "net_income": [
        "ProfitLoss",
    ],
    "current_assets": [
        "CurrentAssets",
    ],
    "current_liabilities": [
        "CurrentLiabilities",
    ],
    "shareholders_equity": [
        "Equity",
        "EquityAttributableToOwnersOfParent",
    ],
    "operating_cash_flow": [
        "CashFlowsFromUsedInOperatingActivities",
        "CashFlowsFromUsedInOperations",
    ],
    "capital_expenditures": [
        "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
        "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
        "AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment",
    ],
}

DURATION_METRICS = {
    "revenue",
    "operating_income",
    "net_income",
    "operating_cash_flow",
    "capital_expenditures",
}

INSTANT_METRICS = {
    "current_assets",
    "current_liabilities",
    "shareholders_equity",
}


@dataclass(frozen=True)
class EligibleSymbol:
    symbol: str
    cik: str
    company_name: str
    status: str


@dataclass(frozen=True)
class FactCandidate:
    symbol: str
    cik: str
    company: str
    metric: str
    concept: str
    unit: str
    form: str
    accession_number: str
    filing_date: str
    period_end: str
    period_type: str
    fiscal_year: Optional[int]
    fiscal_quarter: Optional[int]
    value: Any
    start_date: Optional[str]
    fp: Optional[str]
    frame: Optional[str]
    source_path: str
    concept_priority: int


@dataclass(frozen=True)
class FundamentalCandidate:
    symbol: str
    cik: str
    metric: str
    concept_namespace: str
    concept: str
    unit: str
    form: str
    accession_number: str
    filing_date: str
    period_end: str
    value: Any
    source_path: str
    concept_priority: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import SEC companyfacts JSON into PIT statement/document tables.")
    parser.add_argument("--symbol", help="Import a single symbol, e.g. AAPL.")
    parser.add_argument("--symbols", help="Import a comma-separated symbol list, e.g. AAPL,MSFT,NVDA.")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit eligible symbols processed. 0 means all requested symbols.",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Offset into the eligible symbol list.",
    )
    parser.add_argument(
        "--companyfacts-dir",
        default=str(DEFAULT_COMPANYFACTS_DIR),
        help="Directory containing extracted SEC companyfacts JSON files.",
    )
    parser.add_argument(
        "--eligibility-report",
        default=str(DEFAULT_ELIGIBILITY_REPORT),
        help="Path to ledger filing eligibility report JSON.",
    )
    parser.add_argument(
        "--db-path",
        default=str(pit_store.DEFAULT_DB_PATH),
        help="Target PIT SQLite path.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and summarize without writing to PIT.",
    )
    parser.add_argument(
        "--fundamentals-only",
        action="store_true",
        help="Only import PIT fundamental facts such as sharesOutstanding; skip documents and statement facts.",
    )
    return parser.parse_args()


def _parse_iso_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _normalize_form(value: Any) -> str:
    return str(value or "").strip().upper()


def _period_type_for_form(form: str) -> Optional[str]:
    if form.startswith("10-K") or form.startswith("20-F") or form.startswith("40-F"):
        return "annual"
    if form.startswith("10-Q"):
        return "quarterly"
    return None


def _duration_days(start_date: Optional[str], end_date: Optional[str]) -> Optional[int]:
    start = _parse_iso_date(start_date)
    end = _parse_iso_date(end_date)
    if start is None or end is None:
        return None
    return (end - start).days + 1


def _is_duration_row_usable(metric: str, period_type: str, start_date: Optional[str], end_date: Optional[str]) -> bool:
    if metric in INSTANT_METRICS:
        return bool(end_date)
    if metric not in DURATION_METRICS:
        return bool(end_date)
    days = _duration_days(start_date, end_date)
    if days is None:
        return False
    if period_type == "annual":
        return 300 <= days <= 380
    if period_type == "quarterly":
        return 75 <= days <= 110
    return False


def _load_eligible_symbols(report_path: Path) -> List[EligibleSymbol]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    rows = payload.get("rows") or []
    out: List[EligibleSymbol] = []
    for row in rows:
        status = str(row.get("status") or "").strip().lower()
        if status != "eligible":
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        cik = str(row.get("cik") or "").strip()
        if not symbol or not cik:
            continue
        out.append(
            EligibleSymbol(
                symbol=symbol,
                cik=cik,
                company_name=str(row.get("sec_name") or row.get("company_name") or "").strip(),
                status=status,
            )
        )
    return out


def _select_symbols(
    all_symbols: List[EligibleSymbol],
    symbol: Optional[str],
    symbols: Optional[str],
    offset: int,
    limit: int,
) -> List[EligibleSymbol]:
    selected = all_symbols
    if symbols:
        wanted_symbols = {item.strip().upper() for item in symbols.split(",") if item.strip()}
        selected = [item for item in all_symbols if item.symbol in wanted_symbols]
        selected_symbols = {item.symbol for item in selected}
        for wanted in sorted(wanted_symbols - selected_symbols):
            fallback = _load_symbol_from_catalog(wanted)
            if fallback is not None:
                selected.append(fallback)
    if symbol:
        wanted = symbol.strip().upper()
        selected = [item for item in all_symbols if item.symbol == wanted]
    if offset > 0:
        selected = selected[offset:]
    if limit > 0:
        selected = selected[:limit]
    return selected


def _load_symbol_from_catalog(symbol: str, db_path: Path = DEFAULT_SYMBOL_CATALOG_DB) -> Optional[EligibleSymbol]:
    wanted = str(symbol or "").strip().upper()
    if not wanted or not db_path.exists():
        return None
    import sqlite3

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT symbol, cik, sec_name, name
            FROM symbols
            WHERE symbol = ?
              AND cik IS NOT NULL
              AND trim(cik) <> ''
            """,
            (wanted,),
        ).fetchone()
    if row is None:
        return None
    return EligibleSymbol(
        symbol=str(row["symbol"]).strip().upper(),
        cik=str(row["cik"]).strip(),
        company_name=str(row["sec_name"] or row["name"] or wanted).strip(),
        status="catalog_fallback",
    )


def _choose_better_candidate(current: FactCandidate, candidate: FactCandidate) -> FactCandidate:
    current_score = (current.concept_priority, current.unit != "USD", current.frame is not None)
    candidate_score = (candidate.concept_priority, candidate.unit != "USD", candidate.frame is not None)
    return candidate if candidate_score < current_score else current


def _concept_sources(facts: Dict[str, Any], metric: str) -> Iterable[Tuple[str, str, int, Dict[str, Any]]]:
    source_groups = (
        ("us-gaap", COMPANYFACTS_CONCEPTS.get(metric) or []),
        ("ifrs-full", IFRS_COMPANYFACTS_CONCEPTS.get(metric) or []),
    )
    for namespace, concepts in source_groups:
        namespace_payload = facts.get(namespace) or {}
        if not isinstance(namespace_payload, dict):
            continue
        for concept_priority, concept_name in enumerate(concepts):
            concept_payload = namespace_payload.get(concept_name)
            if isinstance(concept_payload, dict):
                yield namespace, concept_name, concept_priority, concept_payload


def _extract_companyfacts_candidates(companyfacts_file: Path, symbol: EligibleSymbol) -> Tuple[str, List[FactCandidate]]:
    payload = json.loads(companyfacts_file.read_text(encoding="utf-8"))
    company_name = str(payload.get("entityName") or symbol.company_name or symbol.symbol).strip()
    facts = payload.get("facts") or {}
    selected: Dict[Tuple[str, str, str, str], FactCandidate] = {}

    for metric in COMPANYFACTS_CONCEPTS:
        for namespace, concept_name, concept_priority, concept_payload in _concept_sources(facts, metric):
            units = concept_payload.get("units") or {}
            if not isinstance(units, dict):
                continue
            for unit_name, items in units.items():
                if not isinstance(items, list):
                    continue
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    form = _normalize_form(item.get("form"))
                    if form not in ALLOWED_FORMS:
                        continue
                    period_type = _period_type_for_form(form)
                    if not period_type:
                        continue
                    accession_number = str(item.get("accn") or "").strip()
                    filing_date = str(item.get("filed") or "").strip()
                    period_end = str(item.get("end") or "").strip()
                    if not accession_number or not filing_date or not period_end:
                        continue
                    if item.get("val") in (None, ""):
                        continue
                    start_date = str(item.get("start") or "").strip() or None
                    if not _is_duration_row_usable(metric, period_type, start_date, period_end):
                        continue

                    candidate = FactCandidate(
                        symbol=symbol.symbol,
                        cik=symbol.cik,
                        company=company_name,
                        metric=metric,
                        concept=concept_name,
                        unit=str(unit_name or "").strip() or "UNKNOWN",
                        form=form,
                        accession_number=accession_number,
                        filing_date=filing_date,
                        period_end=period_end,
                        period_type=period_type,
                        fiscal_year=pit_store._fiscal_year_for_period(period_end, period_type),
                        fiscal_quarter=pit_store._fiscal_quarter_for_period(period_end, period_type),
                        value=item.get("val"),
                        start_date=start_date,
                        fp=str(item.get("fp") or "").strip() or None,
                        frame=str(item.get("frame") or "").strip() or None,
                        source_path=f"{companyfacts_file}#facts.{namespace}.{concept_name}.units.{unit_name}",
                        concept_priority=concept_priority,
                    )
                    key = (candidate.accession_number, candidate.metric, candidate.period_end, candidate.period_type)
                    current = selected.get(key)
                    if current is None:
                        selected[key] = candidate
                    else:
                        selected[key] = _choose_better_candidate(current, candidate)

    return company_name, sorted(selected.values(), key=lambda item: (item.accession_number, item.period_end, item.metric))


def _load_companyfacts_company_name(companyfacts_file: Path, symbol: EligibleSymbol) -> str:
    payload = json.loads(companyfacts_file.read_text(encoding="utf-8"))
    return str(payload.get("entityName") or symbol.company_name or symbol.symbol).strip()


def _extract_companyfacts_fundamental_candidates(
    companyfacts_file: Path,
    symbol: EligibleSymbol,
) -> List[FundamentalCandidate]:
    payload = json.loads(companyfacts_file.read_text(encoding="utf-8"))
    facts = payload.get("facts") or {}
    selected: Dict[Tuple[str, str, str], FundamentalCandidate] = {}

    for concept_priority, (namespace, concept_name) in enumerate(SHARES_OUTSTANDING_CONCEPTS):
        namespace_payload = facts.get(namespace) or {}
        if not isinstance(namespace_payload, dict):
            continue
        concept_payload = namespace_payload.get(concept_name)
        if not isinstance(concept_payload, dict):
            continue
        units = concept_payload.get("units") or {}
        if not isinstance(units, dict):
            continue
        for unit_name, items in units.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                form = _normalize_form(item.get("form"))
                if form not in ALLOWED_FORMS:
                    continue
                accession_number = str(item.get("accn") or "").strip()
                filing_date = str(item.get("filed") or "").strip()
                period_end = str(item.get("end") or "").strip()
                if not accession_number or not filing_date or not period_end or item.get("val") in (None, ""):
                    continue
                candidate = FundamentalCandidate(
                    symbol=symbol.symbol,
                    cik=symbol.cik,
                    metric="sharesOutstanding",
                    concept_namespace=namespace,
                    concept=concept_name,
                    unit=str(unit_name or "").strip() or "UNKNOWN",
                    form=form,
                    accession_number=accession_number,
                    filing_date=filing_date,
                    period_end=period_end,
                    value=item.get("val"),
                    source_path=f"{companyfacts_file}#facts.{namespace}.{concept_name}.units.{unit_name}",
                    concept_priority=concept_priority,
                )
                key = (candidate.metric, candidate.accession_number, candidate.period_end)
                current = selected.get(key)
                if current is None or candidate.concept_priority < current.concept_priority:
                    selected[key] = candidate

    return sorted(selected.values(), key=lambda item: (item.accession_number, item.period_end, item.metric))


def _evidence_ref(candidate: FactCandidate) -> str:
    return json.dumps(
        {
            "kind": "sec_companyfacts_fact",
            "symbol": candidate.symbol,
            "cik": candidate.cik,
            "accession_number": candidate.accession_number,
            "form": candidate.form,
            "filed": candidate.filing_date,
            "period_end": candidate.period_end,
            "period_type": candidate.period_type,
            "start_date": candidate.start_date,
            "concept": candidate.concept,
            "unit": candidate.unit,
            "fiscal_period": candidate.fp,
            "frame": candidate.frame,
        },
        ensure_ascii=True,
        sort_keys=True,
    )


def _insert_document_rows(
    conn: Any,
    companyfacts_file: Path,
    candidates: Iterable[FactCandidate],
) -> int:
    documents: Dict[str, FactCandidate] = {}
    for candidate in candidates:
        documents.setdefault(candidate.accession_number, candidate)
    written = 0
    for accession_number, sample in documents.items():
        pit_store._insert_pit_document(
            conn,
            symbol=sample.symbol,
            source_type=SOURCE_TYPE,
            source_document=accession_number,
            company=sample.company,
            cik=sample.cik,
            form_type=sample.form,
            filing_date=sample.filing_date,
            report_date=sample.period_end,
            filing_url=None,
            raw_file_path=None,
            markdown_file_path=None,
            json_file_path=str(companyfacts_file),
            metadata_file_path=None,
        )
        written += 1
    return written


def _insert_statement_rows(
    conn: Any,
    candidates: List[FactCandidate],
) -> int:
    written = 0
    grouped: Dict[Tuple[str, str, str], Dict[str, FactCandidate]] = defaultdict(dict)

    for candidate in candidates:
        unit, currency, fact_origin = pit_store._statement_metric_metadata(candidate.metric)
        inserted = pit_store._insert_statement_fact(
            conn,
            symbol=candidate.symbol,
            fact_key=candidate.metric,
            value=candidate.value,
            fact_origin=fact_origin,
            unit=unit,
            scale="ones",
            currency=currency,
            period_type=candidate.period_type,
            period_end=candidate.period_end,
            fiscal_year=candidate.fiscal_year,
            fiscal_quarter=candidate.fiscal_quarter,
            filing_date=candidate.filing_date,
            available_at=candidate.filing_date,
            source_type=SOURCE_TYPE,
            source_document=candidate.accession_number,
            evidence_ref=_evidence_ref(candidate),
            confidence=1.0,
            source_path=candidate.source_path,
        )
        written += int(inserted)
        grouped[(candidate.accession_number, candidate.period_end, candidate.period_type)][candidate.metric] = candidate

    for (accession_number, period_end, period_type), metrics in grouped.items():
        ocf = metrics.get("operating_cash_flow")
        capex = metrics.get("capital_expenditures")
        if ocf is None or capex is None:
            continue
        try:
            free_cash_flow = float(ocf.value) - abs(float(capex.value))
        except Exception:
            continue
        inserted = pit_store._insert_statement_fact(
            conn,
            symbol=ocf.symbol,
            fact_key="free_cash_flow",
            value=free_cash_flow,
            fact_origin="derived",
            unit="currency",
            scale="ones",
            currency="USD",
            period_type=period_type,
            period_end=period_end,
            fiscal_year=ocf.fiscal_year,
            fiscal_quarter=ocf.fiscal_quarter,
            filing_date=ocf.filing_date,
            available_at=ocf.filing_date,
            source_type=SOURCE_TYPE,
            source_document=accession_number,
            evidence_ref=json.dumps(
                {
                    "kind": "derived_from_companyfacts",
                    "derived_fact": "free_cash_flow",
                    "accession_number": accession_number,
                    "period_end": period_end,
                    "inputs": {
                        "operating_cash_flow": json.loads(_evidence_ref(ocf)),
                        "capital_expenditures": json.loads(_evidence_ref(capex)),
                    },
                },
                ensure_ascii=True,
                sort_keys=True,
            ),
            confidence=0.95,
            source_path=str(DEFAULT_COMPANYFACTS_DIR),
        )
        written += int(inserted)

    return written


def _insert_fundamental_rows(conn: Any, candidates: List[FundamentalCandidate]) -> int:
    written = 0
    for candidate in candidates:
        inserted = pit_store._insert_fundamental_fact(
            conn,
            symbol=candidate.symbol,
            metric=candidate.metric,
            value=candidate.value,
            classification="capital_structure",
            period_type="instant",
            period_end=candidate.period_end,
            published_at=candidate.filing_date,
            available_at=candidate.filing_date,
            availability_basis="sec_filing_date",
            source=SOURCE_TYPE,
            source_path=candidate.source_path,
            fetched_at_ms=None,
        )
        written += int(inserted)
    return written


def main() -> None:
    args = parse_args()
    companyfacts_dir = Path(args.companyfacts_dir).resolve()
    eligibility_report = Path(args.eligibility_report).resolve()
    all_symbols = _load_eligible_symbols(eligibility_report)
    selected = _select_symbols(all_symbols, args.symbol, args.symbols, args.offset, args.limit)

    if args.symbol and not selected:
        fallback = _load_symbol_from_catalog(args.symbol)
        if fallback is None:
            raise SystemExit(f"Symbol not found in eligible universe/report or symbol catalog: {args.symbol}")
        selected = [fallback]

    conn = None
    if not args.dry_run:
        conn = pit_store.connect(args.db_path)
        pit_store.ensure_schema(conn)

    summary_rows: List[Dict[str, Any]] = []
    total_documents = 0
    total_statement_rows = 0
    total_fundamental_rows = 0
    total_symbols_with_facts = 0

    try:
        for item in selected:
            companyfacts_file = companyfacts_dir / f"CIK{int(item.cik):010d}.json"
            if not companyfacts_file.exists():
                summary_rows.append(
                    {
                        "symbol": item.symbol,
                        "cik": item.cik,
                        "status": "missing_companyfacts_file",
                        "companyfacts_file": str(companyfacts_file),
                    }
                )
                continue

            if args.fundamentals_only:
                company_name = _load_companyfacts_company_name(companyfacts_file, item)
                candidates = []
            else:
                company_name, candidates = _extract_companyfacts_candidates(companyfacts_file, item)
            fundamental_candidates = _extract_companyfacts_fundamental_candidates(companyfacts_file, item)
            if not candidates and not fundamental_candidates:
                summary_rows.append(
                    {
                        "symbol": item.symbol,
                        "cik": item.cik,
                        "company": company_name,
                        "status": "no_usable_companyfacts_rows",
                        "companyfacts_file": str(companyfacts_file),
                    }
                )
                continue

            metric_counts = defaultdict(int)
            accession_numbers = set()
            for candidate in candidates:
                metric_counts[candidate.metric] += 1
                accession_numbers.add(candidate.accession_number)

            document_rows = 0
            statement_rows = 0
            if conn is not None:
                if not args.fundamentals_only:
                    document_rows = _insert_document_rows(conn, companyfacts_file, candidates)
                    statement_rows = _insert_statement_rows(conn, candidates)
                fundamental_rows = _insert_fundamental_rows(conn, fundamental_candidates)
                conn.commit()
            else:
                fundamental_rows = 0

            total_symbols_with_facts += 1
            total_documents += len(accession_numbers)
            total_statement_rows += statement_rows
            total_fundamental_rows += fundamental_rows
            summary_rows.append(
                {
                    "symbol": item.symbol,
                    "cik": item.cik,
                    "company": company_name,
                    "status": "ok",
                    "companyfacts_file": str(companyfacts_file),
                    "documents_seen": len(accession_numbers),
                    "document_rows_written": document_rows,
                    "statement_rows_written": statement_rows,
                    "fundamental_rows_written": fundamental_rows,
                    "metric_counts": dict(sorted(metric_counts.items())),
                    "fundamental_metric_counts": {
                        "sharesOutstanding": len(fundamental_candidates),
                    },
                }
            )
    finally:
        if conn is not None:
            conn.close()

    print(
        json.dumps(
            {
                "db_path": str(Path(args.db_path).resolve()),
                "companyfacts_dir": str(companyfacts_dir),
                "eligibility_report": str(eligibility_report),
                "requested_symbols": len(selected),
                "symbols_with_facts": total_symbols_with_facts,
                "documents_seen": total_documents,
                "statement_rows_written": total_statement_rows,
                "fundamental_rows_written": total_fundamental_rows,
                "dry_run": bool(args.dry_run),
                "fundamentals_only": bool(args.fundamentals_only),
                "rows": summary_rows,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
