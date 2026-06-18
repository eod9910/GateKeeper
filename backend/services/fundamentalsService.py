#!/usr/bin/env python3
"""
Fundamentals snapshot service for scanner candidate context.

Usage:
    py fundamentalsService.py AAPL
"""

from __future__ import annotations

import json
import math
import sys
import hashlib
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from backend.services.sec_financial_resolver import resolve_sec_first_financials
except ImportError:
    from sec_financial_resolver import resolve_sec_first_financials

try:
    from backend.services.social_text_quality import (
        content_dedup_key as _content_dedup_key,
        score_spam as _score_spam,
        classify_topic as _classify_topic,
    )
except ImportError:
    from social_text_quality import (
        content_dedup_key as _content_dedup_key,
        score_spam as _score_spam,
        classify_topic as _classify_topic,
    )

try:
    import yfinance as yf
except ImportError:
    print(json.dumps({"error": "yfinance not installed"}))
    sys.exit(1)

try:
    from stockdex import Ticker as StockdexTicker
    HAS_STOCKDEX = True
except ImportError:
    HAS_STOCKDEX = False


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _first_number(*values: Any) -> Optional[float]:
    for value in values:
        if _is_number(value):
            return float(value)
    return None


def _first_text(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _to_pct(value: Any) -> Optional[float]:
    if not _is_number(value):
        return None
    val = float(value)
    if abs(val) <= 1.0:
        return val * 100.0
    return val


def _to_iso_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime().date().isoformat()
        except Exception:
            return None
    if isinstance(value, str) and value.strip():
        return value[:10]
    if isinstance(value, (list, tuple)):
        for item in value:
            parsed = _to_iso_date(item)
            if parsed:
                return parsed
    return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    if value is None or not _is_number(value):
        return None
    return round(float(value), digits)


def _clean_text_compact(value: Any) -> str:
    text = str(value or "").replace("&#39;", "'").replace("&amp;", "&").strip()
    return re.sub(r"\s+", " ", text)


def _parse_compact_number_text(value: Any) -> Optional[float]:
    if _is_number(value):
        return float(value)
    if not isinstance(value, str):
        return None

    text = value.strip().replace(",", "").replace("$", "")
    if not text or text.upper() in {"N/A", "NA", "--", "-"}:
        return None

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()

    if text.startswith("+"):
        text = text[1:]

    multiplier = 1.0
    suffix = text[-1:].upper()
    if suffix == "K":
        multiplier = 1_000.0
        text = text[:-1]
    elif suffix == "M":
        multiplier = 1_000_000.0
        text = text[:-1]
    elif suffix == "B":
        multiplier = 1_000_000_000.0
        text = text[:-1]
    elif suffix == "T":
        multiplier = 1_000_000_000_000.0
        text = text[:-1]

    if text.endswith("%") or text.endswith("x") or text.endswith("X"):
        text = text[:-1]

    try:
        parsed = float(text) * multiplier
    except Exception:
        return None
    return -parsed if negative else parsed


def _parse_percent_text(value: Any) -> Optional[float]:
    if _is_number(value):
        return _to_pct(value)
    return _parse_compact_number_text(value)


def _sanitize_forward_growth_pct(value: Optional[float]) -> Optional[float]:
    """Ignore EPS-growth artifacts caused by tiny/negative comparison bases."""
    if value is None:
        return None
    if value <= -300.0 or value >= 300.0:
        return None
    return value


def _normalize_lookup_key(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def _lookup_loose_value(data: Any, *patterns: str) -> Any:
    if not isinstance(data, dict):
        return None

    items = [(_normalize_lookup_key(key), value) for key, value in data.items()]
    for pattern in patterns:
        target = _normalize_lookup_key(pattern)
        for normalized_key, value in items:
            if normalized_key == target:
                return value
    for pattern in patterns:
        target = _normalize_lookup_key(pattern)
        for normalized_key, value in items:
            if target and (target in normalized_key or normalized_key in target):
                return value
    return None


def _classify_insider_transaction(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return "other"
    if "purchase" in text or text == "buy":
        return "buy"
    if "sale" in text or "sell" in text:
        return "sell"
    return "other"


def _mean(values: Sequence[Optional[float]]) -> Optional[float]:
    clean = [float(value) for value in values if _is_number(value)]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _weighted_average(weighted_values: Sequence[Tuple[Optional[float], float]]) -> Optional[float]:
    total_weight = 0.0
    total_score = 0.0
    for value, weight in weighted_values:
        if value is None or weight <= 0:
            continue
        total_score += float(value) * float(weight)
        total_weight += float(weight)
    if total_weight <= 0:
        return None
    return total_score / total_weight


def _safe_attr(obj: Any, attr: str) -> Any:
    try:
        return getattr(obj, attr, None)
    except Exception:
        return None


def _extract_row_series(df: Any, names: Sequence[str]) -> List[Tuple[str, float]]:
    if df is None or getattr(df, "empty", True):
        return []

    row_name = next((name for name in names if name in df.index), None)
    if not row_name:
        return []

    row = df.loc[row_name]
    points: List[Tuple[str, float]] = []
    try:
        iterator = row.items()
    except Exception:
        return []

    for col, value in iterator:
        num = _first_number(value)
        iso = _to_iso_date(col)
        if num is None or not iso:
            continue
        points.append((iso, num))

    points.sort(key=lambda item: item[0], reverse=True)
    return points


def _series_value(series: Sequence[Tuple[str, float]], index: int) -> Optional[float]:
    if index < 0 or index >= len(series):
        return None
    return series[index][1]


def _quarter_label_from_iso(iso_date: Optional[str]) -> Optional[str]:
    if not iso_date:
        return None
    try:
        parsed = datetime.fromisoformat(iso_date[:10]).date()
    except Exception:
        return None
    quarter = ((parsed.month - 1) // 3) + 1
    return f"{parsed.year}Q{quarter}"


def _quarter_period_end(period: Any) -> Optional[str]:
    text = str(period or "").strip().upper()
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


def _series_to_date_map(series: Sequence[Tuple[str, float]]) -> Dict[str, float]:
    return {iso: value for iso, value in series if iso}


def _series_index_map(series: Sequence[Tuple[str, float]]) -> Dict[str, int]:
    return {iso: idx for idx, (iso, _) in enumerate(series) if iso}


def _series_ttm(series: Sequence[Tuple[str, float]], index_lookup: Dict[str, int], iso_date: str) -> Optional[float]:
    idx = index_lookup.get(iso_date)
    if idx is None:
        return None
    values: List[float] = []
    for offset in range(4):
        if idx + offset >= len(series):
            return None
        value = _series_value(series, idx + offset)
        if value is None:
            return None
        values.append(value)
    return sum(values)


def _ratio_pct(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or abs(denominator) < 1e-9:
        return None
    return (numerator / denominator) * 100.0


def _ratio_value(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or abs(denominator) < 1e-9:
        return None
    return numerator / denominator


def _build_historical_statements(
    *,
    revenue_series: Sequence[Tuple[str, float]],
    eps_series: Sequence[Tuple[str, float]],
    operating_income_series: Sequence[Tuple[str, float]],
    gross_profit_series: Sequence[Tuple[str, float]],
    net_income_series: Sequence[Tuple[str, float]],
    operating_cash_flow_series: Sequence[Tuple[str, float]],
    free_cash_flow_series: Sequence[Tuple[str, float]],
    share_series: Sequence[Tuple[str, float]],
    cash_series: Sequence[Tuple[str, float]],
    debt_series: Sequence[Tuple[str, float]],
    equity_series: Sequence[Tuple[str, float]],
    current_assets_series: Sequence[Tuple[str, float]],
    current_liabilities_series: Sequence[Tuple[str, float]],
    stockdex_data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    earnings_history = list(stockdex_data.get("earningsHistory") or [])
    if not earnings_history:
        return None

    revenue_by_date = _series_to_date_map(revenue_series)
    eps_by_date = _series_to_date_map(eps_series)
    operating_income_by_date = _series_to_date_map(operating_income_series)
    gross_profit_by_date = _series_to_date_map(gross_profit_series)
    net_income_by_date = _series_to_date_map(net_income_series)
    shares_by_date = _series_to_date_map(share_series)
    cash_by_date = _series_to_date_map(cash_series)
    debt_by_date = _series_to_date_map(debt_series)
    equity_by_date = _series_to_date_map(equity_series)
    current_assets_by_date = _series_to_date_map(current_assets_series)
    current_liabilities_by_date = _series_to_date_map(current_liabilities_series)

    revenue_index = _series_index_map(revenue_series)
    eps_index = _series_index_map(eps_series)
    ocf_index = _series_index_map(operating_cash_flow_series)
    fcf_index = _series_index_map(free_cash_flow_series)

    quarterly_rows: List[Dict[str, Any]] = []
    seen_period_ends = set()

    for row in earnings_history:
        if not isinstance(row, dict):
            continue
        period = str(row.get("period") or "").strip().upper()
        available_at = _to_iso_date(row.get("date"))
        period_end = _quarter_period_end(period)
        if not period_end or not available_at or period_end in seen_period_ends:
            continue
        seen_period_ends.add(period_end)

        revenue_value = revenue_by_date.get(period_end)
        eps_value = eps_by_date.get(period_end)
        revenue_idx = revenue_index.get(period_end)
        eps_idx = eps_index.get(period_end)
        metrics = {
            "revenue": _round(revenue_value, 2),
            "revenueYoYGrowthPct": _round(
                _pct_change(revenue_value, _series_value(revenue_series, revenue_idx + 4) if revenue_idx is not None else None, min_abs_prior=1.0),
                1,
            ),
            "revenueQoQGrowthPct": _round(
                _pct_change(revenue_value, _series_value(revenue_series, revenue_idx + 1) if revenue_idx is not None else None, min_abs_prior=1.0),
                1,
            ),
            "eps": _round(eps_value, 4),
            "epsYoYGrowthPct": _round(
                _pct_change(eps_value, _series_value(eps_series, eps_idx + 4) if eps_idx is not None else None, min_abs_prior=0.01),
                1,
            ),
            "epsQoQGrowthPct": _round(
                _pct_change(eps_value, _series_value(eps_series, eps_idx + 1) if eps_idx is not None else None, min_abs_prior=0.01),
                1,
            ),
            "grossMarginPct": _round(_ratio_pct(gross_profit_by_date.get(period_end), revenue_value), 1),
            "operatingMarginPct": _round(_ratio_pct(operating_income_by_date.get(period_end), revenue_value), 1),
            "profitMarginPct": _round(_ratio_pct(net_income_by_date.get(period_end), revenue_value), 1),
            "totalCash": _round(cash_by_date.get(period_end), 2),
            "totalDebt": _round(debt_by_date.get(period_end), 2),
            "debtToEquity": _round(_ratio_pct(debt_by_date.get(period_end), equity_by_date.get(period_end)), 2),
            "currentRatio": _round(_ratio_value(current_assets_by_date.get(period_end), current_liabilities_by_date.get(period_end)), 2),
            "sharesOutstanding": _round(shares_by_date.get(period_end), 2),
            "operatingCashFlowTTM": _round(_series_ttm(operating_cash_flow_series, ocf_index, period_end), 2),
            "freeCashFlowTTM": _round(_series_ttm(free_cash_flow_series, fcf_index, period_end), 2),
        }
        filtered_metrics = {key: value for key, value in metrics.items() if value is not None}
        if not filtered_metrics:
            continue

        quarterly_rows.append({
            "period": period,
            "periodEnd": period_end,
            "availableAt": available_at,
            "availabilityBasis": "matched_earnings_history",
            "metrics": filtered_metrics,
        })

    if not quarterly_rows:
        return None
    return {"quarterly": quarterly_rows}


def _pct_change(current: Optional[float], prior: Optional[float], min_abs_prior: float = 0.0) -> Optional[float]:
    if current is None or prior is None:
        return None
    if abs(prior) <= min_abs_prior:
        return None
    return ((current - prior) / abs(prior)) * 100.0


def _growth_flag(current_yoy: Optional[float], previous_yoy: Optional[float], qoq: Optional[float]) -> Optional[str]:
    if current_yoy is not None and previous_yoy is not None:
        delta = current_yoy - previous_yoy
        if delta >= 5:
            return "accelerating"
        if delta <= -5:
            return "decelerating"
        return "steady"
    if qoq is not None:
        if qoq >= 8:
            return "accelerating"
        if qoq <= -8:
            return "decelerating"
        return "steady"
    return None


def _calc_quarterly_burn(fcf_series: Sequence[Tuple[str, float]], ocf_series: Sequence[Tuple[str, float]]) -> Optional[float]:
    recent_fcf = [_series_value(fcf_series, idx) for idx in range(0, min(4, len(fcf_series)))]
    recent_fcf = [value for value in recent_fcf if value is not None]
    if recent_fcf:
        avg_fcf = sum(recent_fcf) / len(recent_fcf)
        if avg_fcf < 0:
            return abs(avg_fcf)

    recent_ocf = [_series_value(ocf_series, idx) for idx in range(0, min(4, len(ocf_series)))]
    recent_ocf = [value for value in recent_ocf if value is not None]
    if recent_ocf:
        avg_ocf = sum(recent_ocf) / len(recent_ocf)
        if avg_ocf < 0:
            return abs(avg_ocf)
    return 0.0


def _sum_recent(series: Sequence[Tuple[str, float]], quarters: int = 4) -> Optional[float]:
    values = [_series_value(series, idx) for idx in range(0, min(quarters, len(series)))]
    values = [value for value in values if value is not None]
    if not values:
        return None
    return sum(values)


def _extract_earnings_context(ticker: Any) -> Dict[str, Any]:
    today = date.today()
    next_date = None
    last_date = None
    eps_surprise = None
    sales_surprise = None

    try:
        earnings_dates = ticker.earnings_dates
    except Exception:
        earnings_dates = None

    if earnings_dates is not None and not getattr(earnings_dates, "empty", True):
        try:
            history = earnings_dates.sort_index(ascending=False)
            for idx, row in history.iterrows():
                iso = _to_iso_date(idx)
                if not iso:
                    continue
                parsed = datetime.fromisoformat(iso).date()
                if parsed >= today and next_date is None:
                    next_date = iso
                if parsed < today and last_date is None:
                    last_date = iso
                    eps_surprise = _first_number(row.get("Surprise(%)"))
                if next_date and last_date:
                    break
        except Exception:
            pass

    if next_date is None:
        try:
            calendar = ticker.calendar or {}
            next_date = _to_iso_date(calendar.get("Earnings Date"))
        except Exception:
            next_date = None

    try:
        earnings_history = ticker.earnings_history
    except Exception:
        earnings_history = None

    if eps_surprise is None and earnings_history is not None and not getattr(earnings_history, "empty", True):
        try:
            latest = earnings_history.sort_index(ascending=False).iloc[0]
            eps_surprise = _to_pct(_first_number(latest.get("surprisePercent")))
        except Exception:
            pass

    days_until = None
    if next_date:
        days_until = (datetime.fromisoformat(next_date).date() - today).days

    days_since = None
    if last_date:
        days_since = (today - datetime.fromisoformat(last_date).date()).days

    if days_until is not None and 0 <= days_until <= 14:
        catalyst_flag = "earnings_soon"
    elif days_since is not None and 0 <= days_since <= 10:
        catalyst_flag = "just_reported"
    else:
        catalyst_flag = "no_near_catalyst"

    return {
        "earningsDate": next_date,
        "daysUntilEarnings": days_until,
        "lastEarningsDate": last_date,
        "salesSurprisePct": sales_surprise,
        "epsSurprisePct": eps_surprise,
        "catalystFlag": catalyst_flag,
    }


def _tag(label: str, tone: str) -> Dict[str, str]:
    return {"label": label, "tone": tone}


def _dedupe_tags(tags: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    output: List[Dict[str, str]] = []
    for tag in tags:
        label = str(tag.get("label") or "").strip()
        if not label or label in seen:
            continue
        seen.add(label)
        output.append({"label": label, "tone": str(tag.get("tone") or "neutral")})
    return output


def _score_survivability(
    runway_quarters: Optional[float],
    free_cash_flow_ttm: Optional[float],
    operating_cash_flow_ttm: Optional[float],
    current_ratio: Optional[float],
    cash_pct_market_cap: Optional[float],
    debt_to_equity: Optional[float],
) -> float:
    score = 40.0
    if free_cash_flow_ttm is not None and free_cash_flow_ttm > 0:
        score += 20
    elif operating_cash_flow_ttm is not None and operating_cash_flow_ttm > 0:
        score += 10

    if runway_quarters is not None:
        if runway_quarters >= 12:
            score += 30
        elif runway_quarters >= 8:
            score += 22
        elif runway_quarters >= 4:
            score += 10
        elif runway_quarters < 2:
            score -= 20
        else:
            score -= 8

    if current_ratio is not None:
        if current_ratio >= 2:
            score += 8
        elif current_ratio < 1:
            score -= 10

    if cash_pct_market_cap is not None and cash_pct_market_cap >= 25:
        score += 8

    if debt_to_equity is not None and debt_to_equity > 2:
        score -= 8

    return _round(_clamp(score, 0, 100), 1) or 0.0


def _score_trend(
    revenue_yoy: Optional[float],
    revenue_qoq: Optional[float],
    revenue_flag: Optional[str],
    eps_yoy: Optional[float],
    eps_qoq: Optional[float],
    eps_surprise: Optional[float],
) -> float:
    score = 45.0
    if revenue_yoy is not None:
        if revenue_yoy >= 20:
            score += 15
        elif revenue_yoy >= 5:
            score += 8
        elif revenue_yoy < 0:
            score -= 12
    if revenue_qoq is not None:
        if revenue_qoq >= 8:
            score += 10
        elif revenue_qoq < 0:
            score -= 8
    if revenue_flag == "accelerating":
        score += 15
    elif revenue_flag == "decelerating":
        score -= 15

    if eps_yoy is not None:
        if eps_yoy >= 20:
            score += 10
        elif eps_yoy < 0:
            score -= 8
    if eps_qoq is not None:
        if eps_qoq >= 15:
            score += 8
        elif eps_qoq < 0:
            score -= 6
    if eps_surprise is not None:
        if eps_surprise >= 10:
            score += 10
        elif eps_surprise < 0:
            score -= 8

    return _round(_clamp(score, 0, 100), 1) or 0.0


def _score_squeeze(
    short_float: Optional[float],
    short_ratio: Optional[float],
    float_shares: Optional[float],
    relative_volume: Optional[float],
) -> float:
    short_score = 0.0 if short_float is None else _clamp(short_float / 25.0, 0, 1) * 42.0
    ratio_score = 0.0 if short_ratio is None else _clamp(short_ratio / 8.0, 0, 1) * 26.0

    float_score = 0.0
    if float_shares is not None:
        if float_shares <= 20_000_000:
            float_score = 18.0
        elif float_shares <= 50_000_000:
            float_score = 14.0
        elif float_shares <= 150_000_000:
            float_score = 8.0
        else:
            float_score = 3.0

    volume_score = 0.0
    if relative_volume is not None:
        volume_score = _clamp((relative_volume - 1.0) / 2.0, 0, 1) * 14.0

    return _round(_clamp(short_score + ratio_score + float_score + volume_score, 0, 100), 1) or 0.0


def _score_dilution(shares_yoy_change: Optional[float], recent_financing: bool) -> float:
    score = 15.0
    if shares_yoy_change is not None:
        if shares_yoy_change >= 15:
            score = 90.0
        elif shares_yoy_change >= 8:
            score = 72.0
        elif shares_yoy_change >= 3:
            score = 45.0
        elif shares_yoy_change <= -2:
            score = 8.0
        else:
            score = 22.0
    if recent_financing:
        score = min(100.0, score + 12.0)
    return _round(score, 1) or 0.0


def _score_catalyst(catalyst_flag: Optional[str], days_until: Optional[float]) -> float:
    if catalyst_flag == "earnings_soon":
        if days_until is not None and days_until <= 7:
            return 82.0
        return 72.0
    if catalyst_flag == "just_reported":
        return 60.0
    return 24.0


def _squeeze_label(score: Optional[float]) -> str:
    if score is None:
        return "N/A"
    if score >= 70:
        return "High"
    if score >= 45:
        return "Medium"
    return "Low"


def _score_reported_execution(
    beat_streak: Optional[int],
    miss_streak: Optional[int],
    avg_eps_surprise: Optional[float],
    avg_sales_surprise: Optional[float],
    latest_eps_surprise: Optional[float],
) -> Optional[float]:
    if beat_streak is None and miss_streak is None and avg_eps_surprise is None and avg_sales_surprise is None and latest_eps_surprise is None:
        return None

    score = 50.0

    if beat_streak is not None:
        if beat_streak >= 4:
            score += 18
        elif beat_streak >= 2:
            score += 10
    if miss_streak is not None:
        if miss_streak >= 3:
            score -= 24
        elif miss_streak >= 1:
            score -= 10

    if avg_eps_surprise is not None:
        if avg_eps_surprise >= 10:
            score += 16
        elif avg_eps_surprise >= 3:
            score += 10
        elif avg_eps_surprise < 0:
            score -= 16

    if avg_sales_surprise is not None:
        if avg_sales_surprise >= 5:
            score += 10
        elif avg_sales_surprise > 0:
            score += 5
        elif avg_sales_surprise < 0:
            score -= 10

    if latest_eps_surprise is not None:
        if latest_eps_surprise >= 5:
            score += 8
        elif latest_eps_surprise < 0:
            score -= 8

    return _round(_clamp(score, 0, 100), 1)


def _score_forward_expectations(
    current_qtr: Optional[float],
    next_qtr: Optional[float],
    current_year: Optional[float],
    next_year: Optional[float],
) -> Optional[float]:
    values = [current_qtr, next_qtr, current_year, next_year]
    if not any(value is not None for value in values):
        return None

    score = 50.0
    for value, strong, good, bad in [
        (current_qtr, 20, 5, -8),
        (next_qtr, 20, 5, -8),
        (current_year, 20, 5, -6),
        (next_year, 20, 8, -6),
    ]:
        if value is None:
            continue
        if value >= strong:
            score += 10
        elif value >= good:
            score += 5
        elif value < 0:
            score += bad

    if current_year is not None and next_year is not None:
        delta = next_year - current_year
        if delta >= 5:
            score += 8
        elif delta <= -5:
            score -= 8

    return _round(_clamp(score, 0, 100), 1)


def _score_positioning(
    buy_count: Optional[int],
    sell_count: Optional[int],
    buy_value: Optional[float],
    sell_value: Optional[float],
) -> Optional[float]:
    if buy_count is None and sell_count is None and buy_value is None and sell_value is None:
        return None

    buys = int(buy_count or 0)
    sells = int(sell_count or 0)
    score = 50.0

    if buys >= 3 and sells == 0:
        score += 20
    elif buys > sells:
        score += 10

    if sells >= 4 and buys == 0:
        score -= 22
    elif sells > buys:
        score -= 10

    if buy_value is not None and sell_value is not None:
        if buy_value > sell_value * 1.5:
            score += 12
        elif sell_value > buy_value * 1.5:
            score -= 12
    elif buy_value is not None and buy_value > 0:
        score += 8
    elif sell_value is not None and sell_value > 0:
        score -= 8

    return _round(_clamp(score, 0, 100), 1)


def _score_market_context(
    above_50_day: Optional[bool],
    above_200_day: Optional[bool],
    price_vs_range_pct: Optional[float],
) -> Optional[float]:
    if above_50_day is None and above_200_day is None and price_vs_range_pct is None:
        return None

    score = 50.0
    if above_200_day is True:
        score += 20
    elif above_200_day is False:
        score -= 18

    if above_50_day is True:
        score += 10
    elif above_50_day is False:
        score -= 10

    if price_vs_range_pct is not None:
        if price_vs_range_pct >= 75:
            score += 10
        elif price_vs_range_pct <= 25:
            score -= 12

    return _round(_clamp(score, 0, 100), 1)


def _build_reported_execution_context(stockdex_data: Dict[str, Any], fallback_eps_surprise: Optional[float]) -> Optional[Dict[str, Any]]:
    history = stockdex_data.get("earningsHistory") or []
    if not isinstance(history, list) or not history:
        return None

    recent = [entry for entry in history[:4] if isinstance(entry, dict)]
    if not recent:
        return None

    beat_streak = 0
    miss_streak = 0
    for entry in recent:
        surprise = _first_number(entry.get("epsSurprisePct"))
        if surprise is None:
            break
        if surprise >= 0:
            beat_streak += 1
        else:
            break
    for entry in recent:
        surprise = _first_number(entry.get("epsSurprisePct"))
        if surprise is None:
            break
        if surprise < 0:
            miss_streak += 1
        else:
            break

    avg_eps_surprise = _mean([_first_number(entry.get("epsSurprisePct")) for entry in recent])
    avg_sales_surprise = _mean([_first_number(entry.get("salesSurprisePct")) for entry in recent])
    latest_eps_surprise = _first_number(recent[0].get("epsSurprisePct"), fallback_eps_surprise)
    score = _score_reported_execution(beat_streak, miss_streak, avg_eps_surprise, avg_sales_surprise, latest_eps_surprise)

    return {
        "score": score,
        "epsBeatStreak": beat_streak,
        "epsMissStreak": miss_streak,
        "avgEpsSurprisePct": _round(avg_eps_surprise, 1),
        "avgSalesSurprisePct": _round(avg_sales_surprise, 1),
        "latestEpsSurprisePct": _round(latest_eps_surprise, 1),
        "latestPeriod": _first_text(recent[0].get("period")),
        "history": history[:8],
    }


def _build_forward_expectations_context(stockdex_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    growth = stockdex_data.get("growthEstimates") or {}
    highlights = stockdex_data.get("financialHighlights") or {}
    if not isinstance(growth, dict):
        growth = {}
    if not isinstance(highlights, dict):
        highlights = {}

    raw_current_qtr = _parse_percent_text(growth.get("currentQtr"))
    raw_next_qtr = _parse_percent_text(growth.get("nextQtr"))
    raw_current_year = _parse_percent_text(growth.get("currentYear"))
    raw_next_year = _parse_percent_text(growth.get("nextYear"))
    current_qtr = _sanitize_forward_growth_pct(raw_current_qtr)
    next_qtr = _sanitize_forward_growth_pct(raw_next_qtr)
    current_year = _sanitize_forward_growth_pct(raw_current_year)
    next_year = _sanitize_forward_growth_pct(raw_next_year)
    quarterly_revenue_growth = _parse_percent_text(_lookup_loose_value(highlights, "quarterly revenue growth"))
    quarterly_earnings_growth = _parse_percent_text(_lookup_loose_value(highlights, "quarterly earnings growth"))

    score = _score_forward_expectations(current_qtr, next_qtr, current_year, next_year)
    if score is None and quarterly_revenue_growth is None and quarterly_earnings_growth is None:
        return None

    signal = "mixed"
    positive_reads = sum(1 for value in [current_qtr, next_qtr, current_year, next_year] if value is not None and value > 0)
    negative_reads = sum(1 for value in [current_qtr, next_qtr, current_year, next_year] if value is not None and value < 0)
    if positive_reads >= 3 and negative_reads == 0:
        signal = "supportive"
    elif negative_reads >= 2 and positive_reads == 0:
        signal = "weak"

    outlier_notes = []
    for label, raw_value in [
        ("currentQtr", raw_current_qtr),
        ("nextQtr", raw_next_qtr),
        ("currentYear", raw_current_year),
        ("nextYear", raw_next_year),
    ]:
        if raw_value is not None and _sanitize_forward_growth_pct(raw_value) is None:
            outlier_notes.append({
                "field": label,
                "rawGrowthPct": _round(raw_value, 1),
                "reason": "ignored_extreme_eps_growth_artifact",
            })

    return {
        "score": score,
        "signal": signal,
        "currentQtrGrowthPct": _round(current_qtr, 1),
        "nextQtrGrowthPct": _round(next_qtr, 1),
        "currentYearGrowthPct": _round(current_year, 1),
        "nextYearGrowthPct": _round(next_year, 1),
        "quarterlyRevenueGrowthPct": _round(quarterly_revenue_growth, 1),
        "quarterlyEarningsGrowthPct": _round(quarterly_earnings_growth, 1),
        "raw": growth,
        "outlierNotes": outlier_notes,
    }


def _build_positioning_context(stockdex_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    trades = stockdex_data.get("insiderTrades") or []
    if not isinstance(trades, list) or not trades:
        return None

    recent = [trade for trade in trades[:10] if isinstance(trade, dict)]
    buy_count = 0
    sell_count = 0
    buy_value = 0.0
    sell_value = 0.0

    for trade in recent:
        kind = _classify_insider_transaction(trade.get("transaction"))
        value = _parse_compact_number_text(trade.get("value"))
        if kind == "buy":
            buy_count += 1
            if value is not None:
                buy_value += value
        elif kind == "sell":
            sell_count += 1
            if value is not None:
                sell_value += value

    score = _score_positioning(
        buy_count,
        sell_count,
        buy_value if buy_value > 0 else None,
        sell_value if sell_value > 0 else None,
    )
    if score is None:
        return None

    signal = "mixed"
    if buy_count > sell_count and buy_count >= 2:
        signal = "buying"
    elif sell_count > buy_count and sell_count >= 2:
        signal = "selling"
    elif buy_count == 0 and sell_count == 0:
        signal = "quiet"

    return {
        "score": score,
        "signal": signal,
        "recentBuyCount": buy_count,
        "recentSellCount": sell_count,
        "recentBuyValue": _round(buy_value, 0) if buy_value > 0 else None,
        "recentSellValue": _round(sell_value, 0) if sell_value > 0 else None,
        "recentTrades": recent,
    }


def _build_market_context(snapshot: Dict[str, Any], stockdex_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    trading = stockdex_data.get("tradingInformation") or {}
    if not isinstance(trading, dict):
        trading = {}

    ma_50 = _parse_compact_number_text(_lookup_loose_value(trading, "50 day moving average"))
    ma_200 = _parse_compact_number_text(_lookup_loose_value(trading, "200 day moving average"))
    week_change = _parse_percent_text(_lookup_loose_value(trading, "52 week change"))
    avg_volume_3m = _parse_compact_number_text(_lookup_loose_value(trading, "avg vol 3 month"))

    current_price = _first_number(snapshot.get("currentPrice"))
    week_high = _first_number(snapshot.get("fiftyTwoWeekHigh"))
    week_low = _first_number(snapshot.get("fiftyTwoWeekLow"))

    price_vs_50 = None
    above_50 = None
    if current_price is not None and ma_50 is not None and ma_50 != 0:
        price_vs_50 = ((current_price - ma_50) / abs(ma_50)) * 100.0
        above_50 = current_price >= ma_50

    price_vs_200 = None
    above_200 = None
    if current_price is not None and ma_200 is not None and ma_200 != 0:
        price_vs_200 = ((current_price - ma_200) / abs(ma_200)) * 100.0
        above_200 = current_price >= ma_200

    price_vs_range = None
    if current_price is not None and week_high is not None and week_low is not None and week_high > week_low:
        price_vs_range = ((current_price - week_low) / (week_high - week_low)) * 100.0

    score = _score_market_context(above_50, above_200, price_vs_range)
    if score is None and week_change is None and avg_volume_3m is None:
        return None

    return {
        "score": score,
        "fiftyDayMovingAverage": _round(ma_50, 2),
        "twoHundredDayMovingAverage": _round(ma_200, 2),
        "fiftyTwoWeekChangePct": _round(week_change, 1),
        "priceVs50DayPct": _round(price_vs_50, 1),
        "priceVs200DayPct": _round(price_vs_200, 1),
        "priceVs52WeekRangePct": _round(price_vs_range, 1),
        "above50Day": above_50,
        "above200Day": above_200,
        "avgVolume3Month": _round(avg_volume_3m, 0),
    }


def _reconcile_shares_outstanding(
    snapshot: Dict[str, Any],
    stockdex_data: Dict[str, Any],
) -> Tuple[Optional[float], Optional[str]]:
    trading = stockdex_data.get("tradingInformation") or {}
    if not isinstance(trading, dict):
        trading = {}

    vendor_shares = _first_number(snapshot.get("sharesOutstanding"))
    market_cap = _first_number(snapshot.get("marketCap"))
    current_price = _first_number(snapshot.get("currentPrice"))
    derived_shares = (market_cap / current_price) if market_cap and current_price else None
    stockdex_shares = _parse_compact_number_text(_lookup_loose_value(trading, "Shares Outstanding"))
    implied_shares = _parse_compact_number_text(_lookup_loose_value(trading, "Implied Shares Outstanding"))
    float_shares = _first_number(snapshot.get("floatShares"))

    candidates: List[Tuple[str, Optional[float]]] = [
        ("vendor_info", vendor_shares),
        ("stockdex_implied", implied_shares),
        ("market_cap_implied", derived_shares),
        ("stockdex_reported", stockdex_shares),
        ("float_shares", float_shares),
    ]

    valid_candidates = [(label, value) for label, value in candidates if value is not None and value > 0]
    if not valid_candidates:
        return vendor_shares, None

    if vendor_shares is None or vendor_shares <= 0:
        preferred_label, preferred_value = valid_candidates[0]
        return _round(preferred_value, 2), preferred_label

    for preferred_label, preferred_value in valid_candidates:
        if preferred_label == "vendor_info":
            continue
        ratio = preferred_value / vendor_shares if vendor_shares else None
        if ratio is None:
            continue
        if ratio >= 3.0 and derived_shares and implied_shares:
            if abs(implied_shares - derived_shares) / max(abs(derived_shares), 1.0) <= 0.35:
                return _round(implied_shares, 2), "stockdex_implied"
        if ratio >= 5.0 and preferred_label in {"stockdex_implied", "market_cap_implied"}:
            return _round(preferred_value, 2), preferred_label

    return _round(vendor_shares, 2), "vendor_info"


def _build_ownership_context(snapshot: Dict[str, Any], stockdex_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    top_holders = stockdex_data.get("topInstitutionalHolders") or []
    has_holders = isinstance(top_holders, list) and len(top_holders) > 0
    if snapshot.get("institutionalOwnershipPct") is None and snapshot.get("insiderOwnershipPct") is None and not has_holders:
        return None
    return {
        "institutionalOwnershipPct": snapshot.get("institutionalOwnershipPct"),
        "insiderOwnershipPct": snapshot.get("insiderOwnershipPct"),
        "topInstitutionalHolders": top_holders[:8] if has_holders else [],
    }


def _build_risk_flags(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Compute deterministic balance-sheet and fundamental risk flags.

    Each flag is a dict with: code, label, severity ('critical'|'high'|'moderate'),
    short (one-line), and detail (explanatory sentence).
    """
    flags: List[Dict[str, Any]] = []
    total_debt = snapshot.get("totalDebt")
    total_cash = snapshot.get("totalCash")
    market_cap = snapshot.get("marketCap")
    enterprise_value = snapshot.get("enterpriseValue")
    current_ratio = snapshot.get("currentRatio")
    free_cash_flow = snapshot.get("freeCashFlowTTM")
    revenue_growth = snapshot.get("revenueGrowthPct")
    revenue_yoy = snapshot.get("revenueYoYGrowthPct")
    profit_margin = snapshot.get("profitMarginPct")
    debt_to_equity = snapshot.get("debtToEquity")
    eps_surprise = snapshot.get("epsSurprisePct")

    net_debt = None
    if _is_number(total_debt) and _is_number(total_cash):
        net_debt = total_debt - total_cash

    if _is_number(net_debt) and _is_number(market_cap) and market_cap > 0:
        net_debt_to_equity_ratio = net_debt / market_cap
        if net_debt_to_equity_ratio >= 3.0:
            flags.append({
                "code": "extreme_leverage",
                "label": "Extreme leverage",
                "severity": "critical",
                "short": f"Net debt is {net_debt_to_equity_ratio:.1f}x equity market cap",
                "detail": f"Net debt ${net_debt/1e9:.1f}B vs market cap ${market_cap/1e9:.1f}B. "
                          "Equity is a thin residual — small changes in business value hit the stock hard.",
            })
        elif net_debt_to_equity_ratio >= 1.5:
            flags.append({
                "code": "high_leverage",
                "label": "High leverage",
                "severity": "high",
                "short": f"Net debt is {net_debt_to_equity_ratio:.1f}x equity market cap",
                "detail": f"Net debt ${net_debt/1e9:.1f}B vs market cap ${market_cap/1e9:.1f}B. "
                          "Significant debt load relative to equity value.",
            })

    if _is_number(enterprise_value) and _is_number(market_cap) and market_cap > 0:
        ev_to_equity = enterprise_value / market_cap
        if ev_to_equity >= 4.0:
            equity_pct = (market_cap / enterprise_value) * 100
            flags.append({
                "code": "thin_equity_stub",
                "label": "Thin equity stub",
                "severity": "critical",
                "short": f"Equity is only {equity_pct:.0f}% of enterprise value",
                "detail": f"EV ${enterprise_value/1e9:.1f}B but equity only ${market_cap/1e9:.1f}B. "
                          "Most of the business value is spoken for by debt.",
            })

    if _is_number(current_ratio) and current_ratio < 0.5 and current_ratio >= 0:
        flags.append({
            "code": "liquidity_crisis",
            "label": "Liquidity stress",
            "severity": "critical" if current_ratio < 0.3 else "high",
            "short": f"Current ratio {current_ratio:.2f}",
            "detail": "Current liabilities significantly exceed current assets. "
                      "May struggle to meet near-term obligations.",
        })

    growth_val = _first_number(revenue_growth, revenue_yoy)
    if _is_number(growth_val) and growth_val <= -5:
        revenue_flag_severity = "high" if growth_val <= -15 else "moderate"
        flags.append({
            "code": "revenue_declining",
            "label": "Revenue declining",
            "severity": revenue_flag_severity,
            "short": f"Revenue growth {growth_val:+.1f}%",
            "detail": "Top-line revenue is contracting. In a levered business, "
                      "this amplifies equity risk.",
        })

    if _is_number(eps_surprise) and eps_surprise <= -5:
        flags.append({
            "code": "earnings_miss",
            "label": "Earnings miss",
            "severity": "high" if eps_surprise <= -10 else "moderate",
            "short": f"EPS surprise {eps_surprise:+.1f}%",
            "detail": "Company missed earnings estimates, indicating potential "
                      "execution or demand weakness.",
        })

    leverage_present = any(f["code"] in ("extreme_leverage", "high_leverage", "thin_equity_stub") for f in flags)
    weakness_present = any(f["code"] in ("revenue_declining", "earnings_miss") for f in flags)
    if leverage_present and weakness_present:
        flags.append({
            "code": "leverage_plus_weakness",
            "label": "Leverage + fundamental weakness",
            "severity": "critical",
            "short": "High debt combined with deteriorating fundamentals",
            "detail": "This company carries heavy leverage AND shows declining revenue or earnings. "
                      "The combination makes the equity especially fragile.",
        })

    return flags


def _build_interpretation(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    runway_quarters = snapshot.get("cashRunwayQuarters")
    revenue_flag = snapshot.get("revenueTrendFlag")
    shares_yoy = snapshot.get("sharesOutstandingYoYChangePct")
    squeeze_score = snapshot.get("squeezePressureScore")
    catalyst_flag = snapshot.get("catalystFlag")
    survivability_score = snapshot.get("survivabilityScore")
    trend_score = snapshot.get("trendScore")
    dilution_score = snapshot.get("dilutionRiskScore")
    net_cash = snapshot.get("netCash")
    market_cap = snapshot.get("marketCap")
    profit_margin = snapshot.get("profitMarginPct")
    reported_execution = snapshot.get("reportedExecution") or {}
    forward_expectations = snapshot.get("forwardExpectations") or {}
    positioning = snapshot.get("positioning") or {}
    market_context = snapshot.get("marketContext") or {}
    reported_execution_score = snapshot.get("reportedExecutionScore")
    forward_score = snapshot.get("forwardExpectationsScore")
    positioning_score = snapshot.get("positioningScore")
    market_context_score = snapshot.get("marketContextScore")

    risk_flags = _build_risk_flags(snapshot)

    tags: List[Dict[str, str]] = []

    for rf in risk_flags:
        if rf["severity"] == "critical":
            tags.insert(0, _tag(rf["label"], "danger"))
        elif rf["severity"] == "high":
            tags.append(_tag(rf["label"], "danger"))

    if runway_quarters is not None and runway_quarters >= 8:
        tags.append(_tag("Strong runway", "positive"))
    elif runway_quarters is not None and runway_quarters < 4:
        tags.append(_tag("Heavy burn", "danger"))
    elif snapshot.get("freeCashFlowTTM") is not None and snapshot.get("freeCashFlowTTM") > 0:
        tags.append(_tag("Self-funded", "positive"))

    if revenue_flag == "accelerating":
        tags.append(_tag("Revenue accelerating", "positive"))
    elif revenue_flag == "decelerating":
        tags.append(_tag("Revenue decelerating", "warning"))

    if shares_yoy is not None and shares_yoy >= 5:
        tags.append(_tag("Dilution risk", "danger"))

    if squeeze_score is not None and squeeze_score >= 70:
        tags.append(_tag("Squeeze candidate", "positive"))

    if catalyst_flag == "earnings_soon":
        tags.append(_tag("Earnings soon", "warning"))
    elif catalyst_flag == "just_reported":
        tags.append(_tag("Just reported", "neutral"))
    else:
        tags.append(_tag("No catalyst", "muted"))

    if market_cap and net_cash is not None and market_cap > 0 and (net_cash / market_cap) >= 0.25:
        tags.append(_tag("Cash-rich story stock", "positive"))

    if reported_execution_score is not None and reported_execution_score >= 65:
        tags.append(_tag("Beating estimates", "positive"))
    elif reported_execution_score is not None and reported_execution_score <= 35:
        tags.append(_tag("Execution weak", "danger"))

    if forward_score is not None and forward_score >= 65:
        tags.append(_tag("Forward growth supportive", "positive"))
    elif forward_score is not None and forward_score <= 35:
        tags.append(_tag("Forward estimates weak", "warning"))

    if positioning.get("signal") == "buying":
        tags.append(_tag("Insider buying", "positive"))
    elif positioning.get("signal") == "selling":
        tags.append(_tag("Insider selling", "warning"))

    if market_context.get("above200Day") is True:
        tags.append(_tag("Above 200D", "positive"))
    elif market_context.get("above200Day") is False:
        tags.append(_tag("Below 200D", "warning"))

    low_quality_survivable = (
        profit_margin is not None and profit_margin < 0 and survivability_score is not None and survivability_score >= 65
    )
    if low_quality_survivable:
        tags.append(_tag("Low-quality / high survivability", "warning"))

    improving_setup = (
        trend_score is not None
        and survivability_score is not None
        and trend_score >= 60
        and survivability_score >= 50
        and dilution_score is not None
        and dilution_score < 60
        and (reported_execution_score is None or reported_execution_score >= 50)
        and (forward_score is None or forward_score >= 45)
    )
    deteriorating_setup = (
        (trend_score is not None and trend_score <= 40)
        or (survivability_score is not None and survivability_score <= 35)
        or (dilution_score is not None and dilution_score >= 75)
        or (reported_execution_score is not None and reported_execution_score <= 30)
        or (forward_score is not None and forward_score <= 30)
    )

    if improving_setup:
        tags.append(_tag("Improving setup", "positive"))
    if deteriorating_setup:
        tags.append(_tag("Deteriorating setup", "danger"))

    core_score = _weighted_average(
        [
            (snapshot.get("survivabilityScore"), 0.24),
            (snapshot.get("trendScore"), 0.18),
            (reported_execution_score, 0.16),
            (forward_score, 0.12),
            (snapshot.get("squeezePressureScore"), 0.14),
            (positioning_score, 0.06),
            (snapshot.get("catalystScore"), 0.05),
            (market_context_score, 0.05),
        ]
    )
    tactical_score = _clamp((core_score or 0) - ((snapshot.get("dilutionRiskScore") or 0) * 0.10), 0, 100)

    if tactical_score >= 65 and squeeze_score is not None and squeeze_score >= 55:
        tags.append(_tag("Tactical pop candidate", "positive"))

    if tactical_score >= 68:
        tactical_grade = "Tactical Pop"
    elif tactical_score >= 55:
        tactical_grade = "Watchlist"
    elif deteriorating_setup:
        tactical_grade = "Fragile"
    else:
        tactical_grade = "Speculative"

    if improving_setup and survivability_score is not None and survivability_score >= 55:
        quality = "Improving"
        hold_context = "Can hold pullbacks"
    elif reported_execution_score is not None and reported_execution_score >= 70 and forward_score is not None and forward_score >= 60:
        quality = "Executing"
        hold_context = "Buy quality pullbacks"
    elif low_quality_survivable:
        quality = "Speculative"
        hold_context = "Trade clean, size tight"
    elif deteriorating_setup:
        quality = "Deteriorating"
        hold_context = "Take strength fast"
    elif squeeze_score is not None and squeeze_score >= 70:
        quality = "Fuelled"
        hold_context = "Trade the event"
    else:
        quality = "Mixed"
        hold_context = "Manage tightly"

    tags = _dedupe_tags(tags)
    status_tags = [tag["label"] for tag in tags[:3]]
    status_note = " | ".join(status_tags) if status_tags else "Loaded"

    risk_note = status_note
    if risk_flags:
        worst = risk_flags[0]
        risk_note = worst["short"]

    return {
        "quality": quality,
        "holdContext": hold_context,
        "tacticalGrade": tactical_grade,
        "tacticalScore": _round(tactical_score, 1),
        "statusNote": status_note,
        "riskNote": risk_note,
        "tags": tags,
        "riskFlags": risk_flags,
    }


def get_fundamentals(symbol: str) -> Dict[str, Any]:
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}
    fast_info = _safe_attr(ticker, "fast_info")

    try:
        quarterly_income = ticker.quarterly_income_stmt
    except Exception:
        quarterly_income = None
    try:
        quarterly_cashflow = ticker.quarterly_cashflow
    except Exception:
        quarterly_cashflow = None
    try:
        quarterly_balance = ticker.quarterly_balance_sheet
    except Exception:
        quarterly_balance = None
    try:
        annual_income = ticker.income_stmt
    except Exception:
        annual_income = None

    current_price = _first_number(
        info.get("currentPrice"),
        info.get("regularMarketPrice"),
        _safe_attr(fast_info, "last_price"),
        _safe_attr(fast_info, "previous_close"),
    )

    market_cap = _first_number(
        info.get("marketCap"),
        _safe_attr(fast_info, "market_cap"),
    )
    enterprise_value = _first_number(info.get("enterpriseValue"))
    avg_volume = _first_number(
        info.get("averageVolume"),
        info.get("averageVolume10days"),
        _safe_attr(fast_info, "ten_day_average_volume"),
    )
    volume = _first_number(
        info.get("volume"),
        _safe_attr(fast_info, "last_volume"),
    )
    rel_volume = volume / avg_volume if avg_volume and volume else None

    revenue_series = _extract_row_series(quarterly_income, ["Total Revenue", "Operating Revenue"])
    eps_series = _extract_row_series(quarterly_income, ["Diluted EPS", "Basic EPS"])
    operating_income_series = _extract_row_series(quarterly_income, ["Operating Income", "Operating Income Or Loss"])
    gross_profit_series = _extract_row_series(quarterly_income, ["Gross Profit"])
    net_income_series = _extract_row_series(quarterly_income, ["Net Income", "Net Income Common Stockholders"])
    operating_cash_flow_series = _extract_row_series(
        quarterly_cashflow,
        ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
    )
    free_cash_flow_series = _extract_row_series(quarterly_cashflow, ["Free Cash Flow"])
    share_series = _extract_row_series(quarterly_balance, ["Ordinary Shares Number", "Share Issued"])
    cash_series = _extract_row_series(
        quarterly_balance,
        ["Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"],
    )
    debt_series = _extract_row_series(quarterly_balance, ["Total Debt"])
    equity_series = _extract_row_series(
        quarterly_balance,
        ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"],
    )
    current_assets_series = _extract_row_series(quarterly_balance, ["Current Assets", "Total Current Assets"])
    current_liabilities_series = _extract_row_series(
        quarterly_balance,
        ["Current Liabilities", "Total Current Liabilities"],
    )
    issuance_series = _extract_row_series(quarterly_cashflow, ["Issuance Of Capital Stock"])

    revenue_yoy = _pct_change(_series_value(revenue_series, 0), _series_value(revenue_series, 4), min_abs_prior=1.0)
    revenue_qoq = _pct_change(_series_value(revenue_series, 0), _series_value(revenue_series, 1), min_abs_prior=1.0)
    previous_revenue_yoy = _pct_change(_series_value(revenue_series, 1), _series_value(revenue_series, 5), min_abs_prior=1.0)
    revenue_flag = _growth_flag(revenue_yoy, previous_revenue_yoy, revenue_qoq)

    eps_yoy = _pct_change(_series_value(eps_series, 0), _series_value(eps_series, 4), min_abs_prior=0.01)
    eps_qoq = _pct_change(_series_value(eps_series, 0), _series_value(eps_series, 1), min_abs_prior=0.01)

    operating_cash_flow_ttm = _sum_recent(operating_cash_flow_series)
    free_cash_flow_ttm = _sum_recent(free_cash_flow_series)
    quarterly_burn = _calc_quarterly_burn(free_cash_flow_series, operating_cash_flow_series)

    total_cash = _first_number(
        info.get("totalCash"),
        info.get("cash"),
        _series_value(_extract_row_series(quarterly_balance, ["Cash Cash Equivalents And Short Term Investments"]), 0),
        _series_value(_extract_row_series(quarterly_balance, ["Cash And Cash Equivalents"]), 0),
    )
    total_debt = _first_number(
        info.get("totalDebt"),
        _series_value(_extract_row_series(quarterly_balance, ["Total Debt"]), 0),
    )

    cash_runway_quarters = None
    if total_cash is not None and quarterly_burn is not None:
        if quarterly_burn > 0:
            cash_runway_quarters = total_cash / quarterly_burn
        elif quarterly_burn == 0:
            cash_runway_quarters = 99.0

    cash_pct_market_cap = None
    if total_cash is not None and market_cap:
        cash_pct_market_cap = (total_cash / market_cap) * 100.0

    shares_outstanding = _first_number(
        info.get("sharesOutstanding"),
        _series_value(share_series, 0),
    )
    shares_yoy_change = _pct_change(_series_value(share_series, 0), _series_value(share_series, 4), min_abs_prior=1.0)

    recent_financing_flag = False
    recent_issuance = _sum_recent(issuance_series, quarters=4)
    if recent_issuance is not None and recent_issuance > 0:
        recent_financing_flag = True

    annual_revenue = _first_number(
        info.get("totalRevenue"),
        _series_value(_extract_row_series(annual_income, ["Total Revenue", "Operating Revenue"]), 0),
    )
    enterprise_to_sales = _first_number(info.get("enterpriseToRevenue"))
    if enterprise_to_sales is None and enterprise_value is not None and annual_revenue:
        enterprise_to_sales = enterprise_value / annual_revenue

    net_cash = None
    if total_cash is not None and total_debt is not None:
        net_cash = total_cash - total_debt

    low_ev_flag = False
    if enterprise_value is not None and market_cap:
        low_ev_flag = enterprise_value <= market_cap * 0.75

    earnings_context = _extract_earnings_context(ticker)

    snapshot: Dict[str, Any] = {
        "symbol": symbol.upper(),
        "companyName": _first_text(info.get("longName"), info.get("shortName")),
        "businessDescription": _first_text(info.get("longBusinessSummary")),
        "sector": _first_text(info.get("sectorDisp"), info.get("sector")),
        "industry": _first_text(info.get("industryDisp"), info.get("industry")),
        "country": _first_text(info.get("country")),
        "exchange": _first_text(info.get("exchange"), info.get("fullExchangeName")),
        "currentPrice": current_price,
        "targetPrice": _first_number(info.get("targetMeanPrice")),
        "marketCap": market_cap,
        "enterpriseValue": enterprise_value,
        "enterpriseToSales": _round(enterprise_to_sales, 2),
        "annualRevenue": annual_revenue,
        "netCash": net_cash,
        "cashPctMarketCap": _round(cash_pct_market_cap, 1),
        "lowEnterpriseValueFlag": low_ev_flag,
        "floatShares": _first_number(info.get("floatShares")),
        "floatSharesYoYChangePct": None,
        "sharesOutstanding": shares_outstanding,
        "sharesOutstandingYoYChangePct": _round(shares_yoy_change, 1),
        "dilutionFlag": bool(shares_yoy_change is not None and shares_yoy_change >= 5),
        "recentFinancingFlag": recent_financing_flag,
        "averageVolume": avg_volume,
        "volume": volume,
        "relativeVolume": _round(rel_volume, 2),
        "shortFloatPct": _round(_to_pct(_first_number(info.get("shortPercentOfFloat"))), 1),
        "shortRatio": _round(_first_number(info.get("shortRatio")), 2),
        "institutionalOwnershipPct": _round(_to_pct(_first_number(info.get("heldPercentInstitutions"))), 1),
        "insiderOwnershipPct": _round(_to_pct(_first_number(info.get("heldPercentInsiders"))), 1),
        "revenueGrowthPct": _round(_to_pct(_first_number(info.get("revenueGrowth"))), 1),
        "earningsGrowthPct": _round(_to_pct(_first_number(info.get("earningsGrowth"))), 1),
        "revenueYoYGrowthPct": _round(revenue_yoy, 1),
        "revenueQoQGrowthPct": _round(revenue_qoq, 1),
        "revenueTrendFlag": revenue_flag,
        "epsYoYGrowthPct": _round(eps_yoy, 1),
        "epsQoQGrowthPct": _round(eps_qoq, 1),
        "grossMarginPct": _round(_to_pct(_first_number(info.get("grossMargins"))), 1),
        "operatingMarginPct": _round(_to_pct(_first_number(info.get("operatingMargins"))), 1),
        "profitMarginPct": _round(_to_pct(_first_number(info.get("profitMargins"))), 1),
        "returnOnEquityPct": _round(_to_pct(_first_number(info.get("returnOnEquity"))), 1),
        "returnOnAssetsPct": _round(_to_pct(_first_number(info.get("returnOnAssets"))), 1),
        "salesSurprisePct": earnings_context["salesSurprisePct"],
        "epsSurprisePct": _round(earnings_context["epsSurprisePct"], 1),
        "totalCash": total_cash,
        "totalDebt": total_debt,
        "operatingCashFlowTTM": operating_cash_flow_ttm,
        "freeCashFlowTTM": free_cash_flow_ttm,
        "quarterlyCashBurn": _round(quarterly_burn, 2),
        "cashRunwayQuarters": _round(cash_runway_quarters, 1),
        "debtToEquity": _round(_first_number(info.get("debtToEquity")), 2),
        "currentRatio": _round(_first_number(info.get("currentRatio")), 2),
        "quickRatio": _round(_first_number(info.get("quickRatio")), 2),
        "beta": _round(_first_number(info.get("beta")), 2),
        "atr14": _round(_first_number(info.get("averageTrueRange")), 2),
        "fiftyTwoWeekHigh": _first_number(
            info.get("fiftyTwoWeekHigh"),
            _safe_attr(fast_info, "year_high"),
        ),
        "fiftyTwoWeekLow": _first_number(
            info.get("fiftyTwoWeekLow"),
            _safe_attr(fast_info, "year_low"),
        ),
        "earningsDate": earnings_context["earningsDate"],
        "daysUntilEarnings": earnings_context["daysUntilEarnings"],
        "lastEarningsDate": earnings_context["lastEarningsDate"],
        "catalystFlag": earnings_context["catalystFlag"],
        "atmShelfFlag": None,
    }

    sec_overrides = resolve_sec_first_financials(
        symbol,
        market_cap=snapshot.get("marketCap"),
        enterprise_value=snapshot.get("enterpriseValue"),
    )
    for field, value in sec_overrides.items():
        snapshot[field] = value

    snapshot["survivabilityScore"] = _score_survivability(
        snapshot.get("cashRunwayQuarters"),
        snapshot.get("freeCashFlowTTM"),
        snapshot.get("operatingCashFlowTTM"),
        snapshot.get("currentRatio"),
        snapshot.get("cashPctMarketCap"),
        snapshot.get("debtToEquity"),
    )
    snapshot["trendScore"] = _score_trend(
        snapshot.get("revenueYoYGrowthPct"),
        snapshot.get("revenueQoQGrowthPct"),
        snapshot.get("revenueTrendFlag"),
        snapshot.get("epsYoYGrowthPct"),
        snapshot.get("epsQoQGrowthPct"),
        snapshot.get("epsSurprisePct"),
    )
    snapshot["squeezePressureScore"] = _score_squeeze(
        snapshot.get("shortFloatPct"),
        snapshot.get("shortRatio"),
        snapshot.get("floatShares"),
        snapshot.get("relativeVolume"),
    )
    snapshot["squeezePressureLabel"] = _squeeze_label(snapshot.get("squeezePressureScore"))
    snapshot["dilutionRiskScore"] = _score_dilution(
        snapshot.get("sharesOutstandingYoYChangePct"),
        recent_financing_flag,
    )
    snapshot["catalystScore"] = _score_catalyst(
        snapshot.get("catalystFlag"),
        snapshot.get("daysUntilEarnings"),
    )
    snapshot["reportedExecutionScore"] = None
    snapshot["forwardExpectationsScore"] = None
    snapshot["positioningScore"] = None
    snapshot["marketContextScore"] = None
    snapshot["reportedExecution"] = None
    snapshot["forwardExpectations"] = None
    snapshot["positioning"] = None
    snapshot["marketContext"] = None
    snapshot["ownership"] = None
    snapshot["historicalStatements"] = None

    if HAS_STOCKDEX:
        try:
            stockdex_data = _fetch_stockdex(symbol)
            snapshot["stockdex"] = stockdex_data
            reconciled_shares, reconciled_source = _reconcile_shares_outstanding(snapshot, stockdex_data)
            if reconciled_shares is not None:
                snapshot["sharesOutstanding"] = reconciled_shares
            if reconciled_source:
                snapshot["sharesOutstandingSource"] = reconciled_source
            if stockdex_data.get("analystTargetPrice") and not snapshot.get("targetPrice"):
                snapshot["targetPrice"] = stockdex_data["analystTargetPrice"]
            snapshot["reportedExecution"] = _build_reported_execution_context(stockdex_data, snapshot.get("epsSurprisePct"))
            snapshot["forwardExpectations"] = _build_forward_expectations_context(stockdex_data)
            snapshot["positioning"] = _build_positioning_context(stockdex_data)
            snapshot["marketContext"] = _build_market_context(snapshot, stockdex_data)
            snapshot["ownership"] = _build_ownership_context(snapshot, stockdex_data)
            if snapshot["reportedExecution"]:
                snapshot["reportedExecutionScore"] = snapshot["reportedExecution"].get("score")
            if snapshot["forwardExpectations"]:
                snapshot["forwardExpectationsScore"] = snapshot["forwardExpectations"].get("score")
            if snapshot["positioning"]:
                snapshot["positioningScore"] = snapshot["positioning"].get("score")
            if snapshot["marketContext"]:
                snapshot["marketContextScore"] = snapshot["marketContext"].get("score")
            snapshot["historicalStatements"] = _build_historical_statements(
                revenue_series=revenue_series,
                eps_series=eps_series,
                operating_income_series=operating_income_series,
                gross_profit_series=gross_profit_series,
                net_income_series=net_income_series,
                operating_cash_flow_series=operating_cash_flow_series,
                free_cash_flow_series=free_cash_flow_series,
                share_series=share_series,
                cash_series=cash_series,
                debt_series=debt_series,
                equity_series=equity_series,
                current_assets_series=current_assets_series,
                current_liabilities_series=current_liabilities_series,
                stockdex_data=stockdex_data,
            )
        except Exception:
            snapshot["stockdex"] = None
    else:
        snapshot["stockdex"] = None

    snapshot.update(_build_interpretation(snapshot))
    return snapshot


def _fetch_stockdex(symbol: str) -> Dict[str, Any]:
    sdx = StockdexTicker(ticker=symbol)
    result: Dict[str, Any] = {}

    try:
        insider_df = sdx.finviz_get_insider_trading()
        if insider_df is not None and not getattr(insider_df, "empty", True):
            rows = []
            for _, row in insider_df.head(10).iterrows():
                rows.append({
                    "insider": str(row.get("Insider Trading", "")),
                    "relationship": str(row.get("Relationship", "")),
                    "date": str(row.get("Date", "")),
                    "transaction": str(row.get("Transaction", "")),
                    "cost": str(row.get("Cost", "")),
                    "shares": str(row.get("#Shares", "")),
                    "value": str(row.get("Value ($)", "")),
                })
            result["insiderTrades"] = rows
    except Exception:
        result["insiderTrades"] = []

    try:
        earnings_df = sdx.finviz_earnings_data()
        if earnings_df is not None and not getattr(earnings_df, "empty", True):
            history = []
            for _, row in earnings_df.head(12).iterrows():
                entry: Dict[str, Any] = {
                    "period": str(row.get("fiscalPeriod", "")),
                    "date": str(row.get("earningsDate", ""))[:10],
                }
                for k in ["epsActual", "epsEstimate", "salesActual", "salesEstimate"]:
                    entry[k] = _first_number(row.get(k))
                if entry["epsActual"] is not None and entry["epsEstimate"] is not None and entry["epsEstimate"] != 0:
                    entry["epsSurprisePct"] = _round(
                        ((entry["epsActual"] - entry["epsEstimate"]) / abs(entry["epsEstimate"])) * 100, 1
                    )
                if entry["salesActual"] is not None and entry["salesEstimate"] is not None and entry["salesEstimate"] != 0:
                    entry["salesSurprisePct"] = _round(
                        ((entry["salesActual"] - entry["salesEstimate"]) / abs(entry["salesEstimate"])) * 100, 1
                    )
                history.append(entry)
            result["earningsHistory"] = history
    except Exception:
        result["earningsHistory"] = []

    try:
        growth = sdx.yahoo_web_growth_estimates
        if growth is not None and not getattr(growth, "empty", True):
            stock_row = growth[growth["Symbol"] == symbol.upper()]
            if not stock_row.empty:
                r = stock_row.iloc[0]
                result["growthEstimates"] = {
                    "currentQtr": _first_text(r.get("Current Qtr.")),
                    "nextQtr": _first_text(r.get("Next Qtr.")),
                    "currentYear": _first_text(r.get("Current Year")),
                    "nextYear": _first_text(r.get("Next Year")),
                }
    except Exception:
        pass

    try:
        highlights = sdx.yahoo_web_financial_highlights
        if highlights is not None and not getattr(highlights, "empty", True):
            data: Dict[str, str] = {}
            for idx, row in highlights.iterrows():
                key = str(idx).strip()
                val = str(row.iloc[0]).strip() if len(row) > 0 else ""
                if key and val:
                    data[key] = val
            result["financialHighlights"] = data
    except Exception:
        pass

    try:
        trading = sdx.yahoo_web_trading_information
        if trading is not None and not getattr(trading, "empty", True):
            data = {}
            for idx, row in trading.iterrows():
                key = str(idx).strip()
                val = str(row.iloc[0]).strip() if len(row) > 0 else ""
                if key and val:
                    data[key] = val
            result["tradingInformation"] = data
    except Exception:
        pass

    try:
        top_inst = sdx.yahoo_web_top_institutional_holders
        if top_inst is not None and not getattr(top_inst, "empty", True):
            holders = []
            for _, row in top_inst.head(10).iterrows():
                holders.append({
                    "holder": str(row.get("Holder", "")),
                    "shares": str(row.get("Shares", "")),
                    "value": str(row.get("Value", "")),
                    "pctOut": str(row.get("% Out", "")),
                })
            result["topInstitutionalHolders"] = holders
    except Exception:
        pass

    return result


# ── Social Buzz (StockTwits + Yahoo Finance Community) ───────────────────────

def _stocktwits_social_buzz(symbol: str) -> Dict[str, Any]:
    """Fetch social buzz data from StockTwits public API (no auth required)."""
    import urllib.request
    import urllib.error

    base_url = f"https://api.stocktwits.com/api/2/streams/symbol/{symbol.upper()}.json"
    max_pages = 3
    sample_limit = 90
    recent_limit = 20

    def fetch_page(max_id: Optional[int] = None) -> Dict[str, Any]:
        url = base_url if max_id is None else f"{base_url}?max={int(max_id)}"
        req = urllib.request.Request(url, headers={"User-Agent": "PatternDetector/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))

    try:
        sym_info = {}
        messages: List[Dict[str, Any]] = []
        seen_ids = set()
        next_max_id = None
        pages_fetched = 0

        while pages_fetched < max_pages and len(messages) < sample_limit:
            raw = fetch_page(next_max_id)
            if raw.get("response", {}).get("status") != 200:
                if pages_fetched == 0:
                    return {"symbol": symbol, "error": "Bad response from StockTwits", "available": False}
                break

            if not sym_info:
                sym_info = raw.get("symbol", {})

            page_messages = raw.get("messages", [])
            if not page_messages:
                break

            added_this_page = 0
            for msg in page_messages:
                message_id = msg.get("id")
                if message_id in seen_ids:
                    continue
                seen_ids.add(message_id)
                messages.append(msg)
                added_this_page += 1
                if len(messages) >= sample_limit:
                    break

            pages_fetched += 1
            if added_this_page == 0:
                break

            last_id = page_messages[-1].get("id")
            if not last_id or last_id == next_max_id:
                break
            next_max_id = last_id
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError) as exc:
        return {"symbol": symbol, "error": str(exc), "available": False}

    bullish = 0
    bearish = 0
    no_sentiment = 0
    for msg in messages:
        s = (msg.get("entities") or {}).get("sentiment", {})
        basic = (s.get("basic") or "").lower() if isinstance(s, dict) else ""
        if basic == "bullish":
            bullish += 1
        elif basic == "bearish":
            bearish += 1
        else:
            no_sentiment += 1

    total_tagged = bullish + bearish
    sample_count = len(messages)
    bull_pct = round(bullish / total_tagged * 100, 1) if total_tagged > 0 else None
    bear_pct = round(bearish / total_tagged * 100, 1) if total_tagged > 0 else None
    neutral_pct = round(no_sentiment / sample_count * 100, 1) if sample_count > 0 else None

    if total_tagged >= 3:
        if bull_pct >= 70:
            mood = "Very Bullish"
        elif bull_pct >= 55:
            mood = "Bullish"
        elif bear_pct >= 70:
            mood = "Very Bearish"
        elif bear_pct >= 55:
            mood = "Bearish"
        else:
            mood = "Mixed"
    elif total_tagged > 0:
        mood = "Low Activity"
    else:
        mood = "No Data"

    recent_messages = []
    raw_posts = []
    for msg in messages[:recent_limit]:
        s = (msg.get("entities") or {}).get("sentiment", {})
        basic = s.get("basic") if isinstance(s, dict) else None
        body = _clean_text_compact(msg.get("body", ""))
        recent_messages.append({
            "body": body[:280],
            "sentiment": basic,
            "created_at": msg.get("created_at"),
            "user": (msg.get("user") or {}).get("username"),
            "source": "StockTwits",
        })
    for msg in messages:
        s = (msg.get("entities") or {}).get("sentiment", {})
        basic = s.get("basic") if isinstance(s, dict) else None
        user = msg.get("user") or {}
        likes = ((msg.get("likes") or {}).get("total")) if isinstance(msg.get("likes"), dict) else None
        raw_posts.append({
            "symbol": symbol.upper(),
            "platform": "StockTwits",
            "platform_post_id": str(msg.get("id") or "").strip(),
            "platform_thread_id": str((msg.get("conversation") or {}).get("parent_message_id") or "") or None,
            "author_id": str(user.get("id") or "").strip() or None,
            "author_handle": user.get("username"),
            "posted_at": msg.get("created_at"),
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "body_text": _clean_text_compact(msg.get("body", "")),
            "url": msg.get("url"),
            "language": msg.get("language"),
            "like_count": likes,
            "reply_count": (msg.get("conversation") or {}).get("replies"),
            "repost_count": None,
            "view_count": None,
            "engagement_score": float(likes or 0) + float(((msg.get("conversation") or {}).get("replies")) or 0),
            "is_reply": bool((msg.get("conversation") or {}).get("parent_message_id")),
            "is_repost": False,
            "sentiment_label": str(basic or "").lower() or None,
            "payload": msg,
        })

    newest_message_at = messages[0].get("created_at") if messages else None
    oldest_message_at = messages[-1].get("created_at") if messages else None

    return {
        "symbol": symbol.upper(),
        "source": "StockTwits",
        "available": True,
        "watchlist_count": sym_info.get("watchlist_count"),
        "title": sym_info.get("title"),
        "message_count": sample_count,
        "pages_fetched": pages_fetched,
        "sampled_message_count": sample_count,
        "tagged_message_count": total_tagged,
        "bullish": bullish,
        "bearish": bearish,
        "no_sentiment": no_sentiment,
        "bull_pct": bull_pct,
        "bear_pct": bear_pct,
        "neutral_pct": neutral_pct,
        "mood": mood,
        "newest_message_at": newest_message_at,
        "oldest_message_at": oldest_message_at,
          "recent_messages": recent_messages,
          "raw_posts": raw_posts,
      }


def _yahoo_community_buzz(symbol: str) -> Dict[str, Any]:
    """Fetch lightweight Yahoo Finance community comments using the message board id."""
    try:
        import requests
        import yfinance as yf
    except Exception as exc:
        return {"symbol": symbol, "source": "Yahoo Finance", "available": False, "error": str(exc)}

    symbol = symbol.upper().strip()
    sample_limit = 40
    recent_limit = 12
    page_size = 20
    max_pages = 2
    spot_id = "sp_Rba9aFpG"

    try:
        info = yf.Ticker(symbol).info or {}
        message_board_id = str(info.get("messageBoardId") or "").strip()
        if not message_board_id:
            return {
                "symbol": symbol,
                "source": "Yahoo Finance",
                "available": False,
                "error": "No Yahoo Finance message board id available.",
            }

        post_id = message_board_id.replace("_", "$")
        api_url = "https://api-2-0.spot.im/v1.0.0/conversation/read"
        headers = {
            "User-Agent": "PatternDetector/1.0",
            "Content-Type": "application/json",
            "x-spot-id": spot_id,
            "x-post-id": post_id,
        }

        comments: List[Dict[str, Any]] = []
        seen_ids = set()
        offset = 0
        pages_fetched = 0
        total_comments = None
        total_replies = None

        def flatten_comment(comment: Dict[str, Any]) -> List[Dict[str, Any]]:
            items = [comment]
            for reply in comment.get("replies") or []:
                if isinstance(reply, dict):
                    items.append(reply)
            return items

        while pages_fetched < max_pages and len(comments) < sample_limit:
            payload = {
                "conversation_id": f"{spot_id}_{post_id}",
                "count": page_size,
                "offset": offset,
                "sort_by": "newest",
            }
            resp = requests.post(api_url, headers=headers, data=json.dumps(payload), timeout=10)
            resp.raise_for_status()
            raw = resp.json()
            conversation = raw.get("conversation") or {}
            page_comments = conversation.get("comments") or []
            if total_comments is None:
                total_comments = conversation.get("comments_count")
            if total_replies is None:
                total_replies = conversation.get("replies_count")
            if not page_comments:
                break

            added_this_page = 0
            for root_comment in page_comments:
                for item in flatten_comment(root_comment):
                    item_id = item.get("id")
                    if not item_id or item_id in seen_ids:
                        continue
                    seen_ids.add(item_id)
                    comments.append(item)
                    added_this_page += 1
                    if len(comments) >= sample_limit:
                        break
                if len(comments) >= sample_limit:
                    break

            pages_fetched += 1
            if added_this_page == 0 or not conversation.get("has_next"):
                break
            next_offset = conversation.get("offset")
            if not isinstance(next_offset, int) or next_offset <= offset:
                break
            offset = next_offset

        def comment_text(comment: Dict[str, Any]) -> str:
            parts = []
            for part in comment.get("content") or []:
                if isinstance(part, dict):
                    text = str(part.get("text") or "").strip()
                    if text:
                        parts.append(text)
            return " ".join(parts).strip()

        recent_messages = []
        raw_posts = []
        newest_message_at = None
        oldest_message_at = None
        for comment in comments:
            written_at = comment.get("written_at") or comment.get("time")
            created_at = None
            if isinstance(written_at, (int, float)):
                created_at = datetime.utcfromtimestamp(int(written_at)).isoformat() + "Z"
            body = _clean_text_compact(comment_text(comment))
            if not body:
                continue
            if len(recent_messages) < recent_limit:
                if newest_message_at is None:
                    newest_message_at = created_at
                oldest_message_at = created_at
                recent_messages.append({
                    "body": body[:280],
                    "sentiment": None,
                    "created_at": created_at,
                    "user": comment.get("user_display_name") or "Yahoo User",
                    "source": "Yahoo Finance",
                    "replies_count": comment.get("replies_count"),
                    "stars": comment.get("stars"),
                })
            raw_posts.append({
                "symbol": symbol,
                "platform": "Yahoo Finance",
                "platform_post_id": str(comment.get("id") or "").strip(),
                "platform_thread_id": str(comment.get("root_id") or comment.get("parent_id") or comment.get("id") or "").strip() or None,
                "author_id": str(comment.get("user_id") or "").strip() or None,
                "author_handle": comment.get("user_display_name") or "Yahoo User",
                "posted_at": created_at,
                "fetched_at": datetime.utcnow().isoformat() + "Z",
                "body_text": body,
                "url": None,
                "language": None,
                "like_count": comment.get("stars"),
                "reply_count": comment.get("replies_count"),
                "repost_count": None,
                "view_count": None,
                "engagement_score": float(comment.get("stars") or 0) + float(comment.get("replies_count") or 0),
                "is_reply": bool(comment.get("parent_id")),
                "is_repost": False,
                "sentiment_label": None,
                "payload": comment,
            })

        return {
            "symbol": symbol,
            "source": "Yahoo Finance",
            "available": len(recent_messages) > 0,
            "message_board_id": message_board_id,
            "pages_fetched": pages_fetched,
            "message_count": len(recent_messages),
            "sampled_message_count": len(comments),
              "recent_messages": recent_messages,
              "raw_posts": raw_posts,
              "newest_message_at": newest_message_at,
              "oldest_message_at": oldest_message_at,
            "total_comments": total_comments,
            "total_replies": total_replies,
            "mood": "Community Active" if recent_messages else "No Data",
        }
    except Exception as exc:
        return {"symbol": symbol, "source": "Yahoo Finance", "available": False, "error": str(exc)}


def get_social_buzz(symbol: str) -> Dict[str, Any]:
    """Fetch and aggregate social buzz from StockTwits plus Yahoo Finance community."""
    stocktwits = _stocktwits_social_buzz(symbol)
    yahoo_finance = _yahoo_community_buzz(symbol)

    available_sources = []
    if stocktwits.get("available"):
        available_sources.append("StockTwits")
    if yahoo_finance.get("available"):
        available_sources.append("Yahoo Finance")

    combined_recent = []
    for source_payload in (stocktwits, yahoo_finance):
        for message in source_payload.get("recent_messages") or []:
            combined_recent.append(dict(message))

    def sort_key(item: Dict[str, Any]) -> float:
        created_at = item.get("created_at")
        try:
            if isinstance(created_at, str) and created_at:
                normalized = created_at.replace("Z", "+00:00")
                return datetime.fromisoformat(normalized).timestamp()
        except Exception:
            pass
        return 0.0

    combined_recent.sort(key=sort_key, reverse=True)
    combined_recent = combined_recent[:20]

    newest_message_at = combined_recent[0].get("created_at") if combined_recent else (
        stocktwits.get("newest_message_at") or yahoo_finance.get("newest_message_at")
    )
    oldest_message_at = combined_recent[-1].get("created_at") if combined_recent else (
        yahoo_finance.get("oldest_message_at") or stocktwits.get("oldest_message_at")
    )

    aggregate_message_count = int(stocktwits.get("sampled_message_count") or 0) + int(yahoo_finance.get("sampled_message_count") or 0)
    aggregate_pages_fetched = int(stocktwits.get("pages_fetched") or 0) + int(yahoo_finance.get("pages_fetched") or 0)
    source_label = " + ".join(available_sources) if available_sources else "StockTwits + Yahoo Finance"
    mood = stocktwits.get("mood") if stocktwits.get("available") else (yahoo_finance.get("mood") or "No Data")

    return {
        "symbol": symbol.upper(),
        "available": bool(available_sources),
        "source_label": source_label,
        "sources": available_sources,
        "primary_source": "StockTwits" if stocktwits.get("available") else ("Yahoo Finance" if yahoo_finance.get("available") else None),
        "source_breakdown": {
            "stocktwits": stocktwits,
            "yahoo_finance": yahoo_finance,
        },
        "watchlist_count": stocktwits.get("watchlist_count"),
        "title": stocktwits.get("title") or symbol.upper(),
        "message_count": aggregate_message_count,
        "pages_fetched": aggregate_pages_fetched,
        "sampled_message_count": aggregate_message_count,
        "tagged_message_count": stocktwits.get("tagged_message_count"),
        "bullish": stocktwits.get("bullish"),
        "bearish": stocktwits.get("bearish"),
        "no_sentiment": stocktwits.get("no_sentiment"),
        "bull_pct": stocktwits.get("bull_pct"),
        "bear_pct": stocktwits.get("bear_pct"),
        "neutral_pct": stocktwits.get("neutral_pct"),
        "mood": mood,
        "newest_message_at": newest_message_at,
        "oldest_message_at": oldest_message_at,
        "recent_messages": combined_recent,
        "stocktwits_message_count": stocktwits.get("sampled_message_count") or 0,
        "yahoo_message_count": yahoo_finance.get("sampled_message_count") or 0,
        "yahoo_total_comments": yahoo_finance.get("total_comments"),
        "yahoo_total_replies": yahoo_finance.get("total_replies"),
    }


def build_social_intelligence_payload(symbol: str) -> Dict[str, Any]:
    buzz = get_social_buzz(symbol)
    source_breakdown = buzz.get("source_breakdown") or {}
    raw_posts: List[Dict[str, Any]] = []
    for source_payload in source_breakdown.values():
        for post in source_payload.get("raw_posts") or []:
            platform_post_id = str(post.get("platform_post_id") or "").strip()
            posted_at = str(post.get("posted_at") or "").strip()
            platform = str(post.get("platform") or "").strip()
            if not platform_post_id or not posted_at or not platform:
                continue
            raw_posts.append(dict(post))

    clean_posts: List[Dict[str, Any]] = []
    post_sentiment: List[Dict[str, Any]] = []

    # Pre-pass: compute content dedup keys so we can catch copy-paste/botted
    # chatter within this batch (the full-corpus frequency is recomputed by the
    # backfill; here we at least flag duplicates seen in the same fetch).
    from collections import Counter as _Counter
    _dedup_keys: List[Optional[str]] = []
    for post in raw_posts:
        _bt = _clean_text_compact(post.get("body_text"))
        _pid = str(post.get("platform_post_id") or "").strip()
        _plat = str(post.get("platform") or "").strip().lower()
        _dedup_keys.append(_content_dedup_key(_bt, f"{_plat}:{_pid}"))
    _dedup_freq = _Counter(k for k in _dedup_keys if k)

    for post, duplicate_group_key in zip(raw_posts, _dedup_keys):
        body_text = _clean_text_compact(post.get("body_text"))
        symbol_upper = str(post.get("symbol") or symbol).strip().upper()
        platform = str(post.get("platform") or "").strip()
        platform_post_id = str(post.get("platform_post_id") or "").strip()
        posted_at = str(post.get("posted_at") or "").strip()
        trade_date = posted_at[:10] if posted_at else None
        if not trade_date:
            continue
        author_key = str(post.get("author_id") or post.get("author_handle") or "").strip().lower() or None
        normalized_text = body_text.lower()
        canonical_post_key = f"{platform.lower()}:{platform_post_id}"
        token_count = len(body_text.split()) if body_text else 0
        has_ticker_mention = f"${symbol_upper.lower()}" in normalized_text or symbol_upper.lower() in normalized_text
        is_spam, spam_score = _score_spam(
            body_text,
            token_count=token_count,
            dedup_frequency=_dedup_freq.get(duplicate_group_key, 1),
            has_ticker_mention=has_ticker_mention,
        )
        clean_posts.append({
            "platform_post_id": platform_post_id,
            "symbol": symbol_upper,
            "platform": platform,
            "canonical_post_key": canonical_post_key,
            "canonical_author_key": author_key,
            "trade_date": trade_date,
            "posted_at": posted_at,
            "cleaned_text": body_text,
            "token_count": token_count,
            "has_ticker_mention": has_ticker_mention,
            "is_spam": is_spam,
            "spam_score": spam_score,
            "duplicate_group_key": duplicate_group_key,
            "payload": {
                "platform_post_id": platform_post_id,
                "platform_thread_id": post.get("platform_thread_id"),
            },
        })

        sentiment_label = str(post.get("sentiment_label") or "").strip().lower() or None
        sentiment_score = None
        sentiment_confidence = None
        if sentiment_label == "bullish":
            sentiment_score = 1.0
            sentiment_confidence = 1.0
        elif sentiment_label == "bearish":
            sentiment_score = -1.0
            sentiment_confidence = 1.0
        else:
            bullish_terms = ("bull", "buy", "long", "breakout", "squeeze", "beat", "strong")
            bearish_terms = ("bear", "sell", "short", "dump", "miss", "weak", "fraud")
            bullish_hits = sum(1 for term in bullish_terms if term in normalized_text)
            bearish_hits = sum(1 for term in bearish_terms if term in normalized_text)
            if bullish_hits > bearish_hits and bullish_hits > 0:
                sentiment_label = "bullish"
                sentiment_score = min(1.0, 0.25 + bullish_hits * 0.15)
                sentiment_confidence = min(0.75, 0.25 + bullish_hits * 0.1)
            elif bearish_hits > bullish_hits and bearish_hits > 0:
                sentiment_label = "bearish"
                sentiment_score = max(-1.0, -0.25 - bearish_hits * 0.15)
                sentiment_confidence = min(0.75, 0.25 + bearish_hits * 0.1)
            else:
                sentiment_label = "neutral"
                sentiment_score = 0.0
                sentiment_confidence = 0.2

        post_sentiment.append({
            "platform_post_id": platform_post_id,
            "symbol": symbol_upper,
            "platform": platform,
            "trade_date": trade_date,
            "sentiment_label": sentiment_label,
            "sentiment_score": sentiment_score,
            "sentiment_confidence": sentiment_confidence,
            "sentiment_model": "source_or_keyword_v1",
            "topic_label": _classify_topic(body_text, is_spam=is_spam),
            "hype_score": 1.0 if "squeeze" in normalized_text or "moon" in normalized_text else 0.0,
            "fear_score": 1.0 if "panic" in normalized_text or "dump" in normalized_text else 0.0,
            "payload": {
                "platform_post_id": platform_post_id,
            },
        })

    return {
        "symbol": str(symbol or "").strip().upper(),
        "buzz": buzz,
        "raw_posts": raw_posts,
        "clean_posts": clean_posts,
        "post_sentiment": post_sentiment,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbol provided"}))
        sys.exit(1)

    cmd = str(sys.argv[1] or "").strip()

    if cmd == "--buzz" and len(sys.argv) >= 3:
        symbol = str(sys.argv[2] or "").strip().upper()
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(1)
        try:
            print(json.dumps(get_social_buzz(symbol)))
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            sys.exit(1)
    elif cmd == "--social-intel" and len(sys.argv) >= 3:
        symbol = str(sys.argv[2] or "").strip().upper()
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(1)
        try:
            print(json.dumps(build_social_intelligence_payload(symbol)))
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            sys.exit(1)
    else:
        symbol = cmd.upper()
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(1)
        try:
            print(json.dumps(get_fundamentals(symbol)))
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            sys.exit(1)
