#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_COMPANYFACTS_DIR = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "companyfacts"
DEFAULT_ELIGIBILITY_REPORT = ROOT / "backend" / "data" / "ledger_filing_eligibility_report.json"
ALLOWED_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A"}


@dataclass(frozen=True)
class FactRow:
    concept: str
    concept_priority: int
    form: str
    filed: str
    end: str
    start: Optional[str]
    accession: str
    unit: str
    value: float


INSTANT_CONCEPTS: Dict[str, Sequence[str]] = {
    "cash_and_equivalents": (
        "CashAndCashEquivalentsAtCarryingValue",
    ),
    "marketable_securities_current": (
        "MarketableSecuritiesCurrent",
        "AvailableForSaleSecuritiesCurrent",
        "ShortTermInvestments",
    ),
    "receivables_current": (
        "AccountsReceivableNetCurrent",
        "ReceivablesNetCurrent",
    ),
    "current_assets": (
        "AssetsCurrent",
    ),
    "current_liabilities": (
        "LiabilitiesCurrent",
    ),
    "equity": (
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ),
    "current_debt": (
        "LongTermDebtCurrent",
        "LongTermDebtAndCapitalLeaseObligationsCurrent",
        "ShortTermBorrowings",
    ),
    "long_term_debt": (
        "LongTermDebtNoncurrent",
        "LongTermDebtAndCapitalLeaseObligations",
    ),
    "commercial_paper": (
        "CommercialPaper",
    ),
}

DURATION_CONCEPTS: Dict[str, Sequence[str]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "Revenues",
    ),
    "operating_cash_flow": (
        "NetCashProvidedByUsedInOperatingActivities",
    ),
    "capital_expenditures": (
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "CapitalExpendituresIncurredButNotYetPaid",
    ),
}


def _parse_iso_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _duration_days(start_date: Optional[str], end_date: Optional[str]) -> Optional[int]:
    start = _parse_iso_date(start_date)
    end = _parse_iso_date(end_date)
    if start is None or end is None:
        return None
    return (end - start).days + 1


def _is_duration_row_usable(period_type: str, start_date: Optional[str], end_date: Optional[str]) -> bool:
    days = _duration_days(start_date, end_date)
    if days is None:
        return False
    if period_type == "annual":
        return 300 <= days <= 380
    if period_type == "quarterly":
        return 75 <= days <= 110
    return False


def _load_symbol_to_cik(report_path: Path) -> Dict[str, str]:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    rows = payload.get("rows") or []
    out: Dict[str, str] = {}
    for row in rows:
        status = str(row.get("status") or "").strip().lower()
        if status != "eligible":
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        cik = str(row.get("cik") or "").strip()
        if symbol and cik:
            out[symbol] = cik
    return out


def _companyfacts_path(symbol: str) -> Optional[Path]:
    symbol = str(symbol or "").strip().upper()
    if not symbol:
        return None
    try:
        cik = _load_symbol_to_cik(DEFAULT_ELIGIBILITY_REPORT).get(symbol)
    except Exception:
        return None
    if not cik:
        return None
    path = DEFAULT_COMPANYFACTS_DIR / f"CIK{int(cik):010d}.json"
    return path if path.exists() else None


def _iter_fact_rows(companyfacts_payload: Dict[str, Any], concepts: Sequence[str]) -> Iterable[FactRow]:
    us_gaap = ((companyfacts_payload.get("facts") or {}).get("us-gaap") or {})
    for concept_priority, concept_name in enumerate(concepts):
        concept_payload = us_gaap.get(concept_name)
        if not isinstance(concept_payload, dict):
            continue
        units = concept_payload.get("units") or {}
        if not isinstance(units, dict):
            continue
        for unit_name, items in units.items():
            if str(unit_name or "").upper() != "USD" or not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                form = str(item.get("form") or "").strip().upper()
                if form not in ALLOWED_FORMS:
                    continue
                filed = str(item.get("filed") or "").strip()
                end = str(item.get("end") or "").strip()
                accession = str(item.get("accn") or "").strip()
                value = _safe_float(item.get("val"))
                if not filed or not end or not accession or value is None:
                    continue
                yield FactRow(
                    concept=concept_name,
                    concept_priority=concept_priority,
                    form=form,
                    filed=filed,
                    end=end,
                    start=str(item.get("start") or "").strip() or None,
                    accession=accession,
                    unit=str(unit_name),
                    value=value,
                )


def _choose_better(current: FactRow, candidate: FactRow) -> FactRow:
    current_score = (
        current.concept_priority,
        current.form.endswith("/A"),
        current.end,
        current.filed,
    )
    candidate_score = (
        candidate.concept_priority,
        candidate.form.endswith("/A"),
        candidate.end,
        candidate.filed,
    )
    return candidate if candidate_score < current_score else current


def _latest_balance_sheet_snapshot(companyfacts_payload: Dict[str, Any]) -> Tuple[Optional[Tuple[str, str, str]], Dict[str, FactRow]]:
    bucket_rows: Dict[str, List[FactRow]] = {}
    for bucket, concepts in INSTANT_CONCEPTS.items():
        rows = list(_iter_fact_rows(companyfacts_payload, concepts))
        if rows:
            bucket_rows[bucket] = rows
    if not bucket_rows:
        return None, {}

    snapshots: Dict[Tuple[str, str, str], int] = {}
    for rows in bucket_rows.values():
        for row in rows:
            key = (row.end, row.filed, row.accession)
            snapshots[key] = snapshots.get(key, 0) + 1
    if not snapshots:
        return None, {}

    latest_key = max(snapshots.keys(), key=lambda item: (item[0], item[1], snapshots[item]))
    selected: Dict[str, FactRow] = {}
    for bucket, rows in bucket_rows.items():
        best: Optional[FactRow] = None
        for row in rows:
            if (row.end, row.filed, row.accession) != latest_key:
                continue
            best = row if best is None else _choose_better(best, row)
        if best is not None:
            selected[bucket] = best
    return latest_key, selected


def _select_period_series(
    companyfacts_payload: Dict[str, Any],
    concepts: Sequence[str],
    period_type: str,
) -> List[FactRow]:
    rows: Dict[str, FactRow] = {}
    for row in _iter_fact_rows(companyfacts_payload, concepts):
        row_period_type = "annual" if row.form.startswith("10-K") else "quarterly"
        if row_period_type != period_type:
            continue
        if not _is_duration_row_usable(period_type, row.start, row.end):
            continue
        current = rows.get(row.end)
        rows[row.end] = row if current is None else _choose_better(current, row)
    return sorted(rows.values(), key=lambda item: (item.end, item.filed), reverse=True)


def _sum_recent_values(rows: Sequence[FactRow], count: int = 4) -> Optional[float]:
    if len(rows) < count:
        return None
    total = 0.0
    for row in rows[:count]:
        total += row.value
    return total


def _calc_quarterly_burn(fcf_rows: Sequence[FactRow], ocf_rows: Sequence[FactRow]) -> float:
    recent_fcf = [row.value for row in fcf_rows[:4]]
    if recent_fcf:
        avg_fcf = sum(recent_fcf) / len(recent_fcf)
        if avg_fcf < 0:
            return abs(avg_fcf)
    recent_ocf = [row.value for row in ocf_rows[:4]]
    if recent_ocf:
        avg_ocf = sum(recent_ocf) / len(recent_ocf)
        if avg_ocf < 0:
            return abs(avg_ocf)
    return 0.0


def resolve_sec_first_financials(
    symbol: str,
    *,
    market_cap: Optional[float] = None,
    enterprise_value: Optional[float] = None,
) -> Dict[str, float]:
    companyfacts_path = _companyfacts_path(symbol)
    if companyfacts_path is None:
        return {}

    try:
        payload = json.loads(companyfacts_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    _, instant = _latest_balance_sheet_snapshot(payload)

    cash_and_equivalents = instant.get("cash_and_equivalents").value if instant.get("cash_and_equivalents") else None
    marketable_securities = (
        instant.get("marketable_securities_current").value if instant.get("marketable_securities_current") else None
    )
    receivables = instant.get("receivables_current").value if instant.get("receivables_current") else None
    current_assets = instant.get("current_assets").value if instant.get("current_assets") else None
    current_liabilities = instant.get("current_liabilities").value if instant.get("current_liabilities") else None
    equity = instant.get("equity").value if instant.get("equity") else None
    current_debt = instant.get("current_debt").value if instant.get("current_debt") else None
    long_term_debt = instant.get("long_term_debt").value if instant.get("long_term_debt") else None
    commercial_paper = instant.get("commercial_paper").value if instant.get("commercial_paper") else None

    total_cash = None
    cash_components = [value for value in (cash_and_equivalents, marketable_securities) if value is not None]
    if cash_components:
        total_cash = sum(cash_components)

    total_debt = None
    debt_components = [value for value in (current_debt, long_term_debt, commercial_paper) if value is not None]
    if debt_components:
        total_debt = sum(debt_components)

    current_ratio = None
    if current_assets is not None and current_liabilities not in (None, 0):
        current_ratio = current_assets / current_liabilities

    quick_ratio = None
    quick_components = [value for value in (cash_and_equivalents, marketable_securities, receivables) if value is not None]
    if quick_components and current_liabilities not in (None, 0):
        quick_ratio = sum(quick_components) / current_liabilities

    debt_to_equity = None
    if total_debt is not None and equity not in (None, 0):
        debt_to_equity = total_debt / equity

    revenue_annual_rows = _select_period_series(payload, DURATION_CONCEPTS["revenue"], "annual")
    operating_cash_flow_quarterly_rows = _select_period_series(payload, DURATION_CONCEPTS["operating_cash_flow"], "quarterly")
    capital_expenditures_quarterly_rows = _select_period_series(payload, DURATION_CONCEPTS["capital_expenditures"], "quarterly")
    operating_cash_flow_annual_rows = _select_period_series(payload, DURATION_CONCEPTS["operating_cash_flow"], "annual")
    capital_expenditures_annual_rows = _select_period_series(payload, DURATION_CONCEPTS["capital_expenditures"], "annual")

    operating_cash_flow_ttm = _sum_recent_values(operating_cash_flow_quarterly_rows, 4)
    if operating_cash_flow_ttm is None and operating_cash_flow_annual_rows:
        operating_cash_flow_ttm = operating_cash_flow_annual_rows[0].value

    capital_expenditures_ttm = _sum_recent_values(capital_expenditures_quarterly_rows, 4)
    if capital_expenditures_ttm is None and capital_expenditures_annual_rows:
        capital_expenditures_ttm = capital_expenditures_annual_rows[0].value

    free_cash_flow_ttm = None
    if operating_cash_flow_ttm is not None and capital_expenditures_ttm is not None:
        free_cash_flow_ttm = operating_cash_flow_ttm - capital_expenditures_ttm

    quarterly_fcf_rows: List[FactRow] = []
    capex_by_end = {row.end: row for row in capital_expenditures_quarterly_rows}
    for ocf_row in operating_cash_flow_quarterly_rows:
        capex_row = capex_by_end.get(ocf_row.end)
        if capex_row is None:
            continue
        quarterly_fcf_rows.append(
            FactRow(
                concept="free_cash_flow",
                concept_priority=0,
                form=ocf_row.form,
                filed=ocf_row.filed,
                end=ocf_row.end,
                start=ocf_row.start,
                accession=ocf_row.accession,
                unit="USD",
                value=ocf_row.value - capex_row.value,
            )
        )
    quarterly_cash_burn = _calc_quarterly_burn(quarterly_fcf_rows, operating_cash_flow_quarterly_rows)

    cash_runway_quarters = None
    if total_cash is not None:
        if quarterly_cash_burn > 0:
            cash_runway_quarters = total_cash / quarterly_cash_burn
        elif quarterly_cash_burn == 0:
            cash_runway_quarters = 99.0

    net_cash = None
    if total_cash is not None and total_debt is not None:
        net_cash = total_cash - total_debt

    cash_pct_market_cap = None
    if total_cash is not None and market_cap not in (None, 0):
        cash_pct_market_cap = (total_cash / market_cap) * 100.0

    enterprise_to_sales = None
    if enterprise_value not in (None, 0) and revenue_annual_rows:
        annual_revenue = revenue_annual_rows[0].value
        if annual_revenue:
            enterprise_to_sales = enterprise_value / annual_revenue

    result: Dict[str, float] = {}
    for key, value in (
        ("totalCash", total_cash),
        ("totalDebt", total_debt),
        ("currentRatio", current_ratio),
        ("quickRatio", quick_ratio),
        ("debtToEquity", debt_to_equity),
        ("operatingCashFlowTTM", operating_cash_flow_ttm),
        ("freeCashFlowTTM", free_cash_flow_ttm),
        ("quarterlyCashBurn", quarterly_cash_burn),
        ("cashRunwayQuarters", cash_runway_quarters),
        ("netCash", net_cash),
        ("cashPctMarketCap", cash_pct_market_cap),
        ("enterpriseToSales", enterprise_to_sales),
    ):
        if value is not None:
            result[key] = value
    return result
