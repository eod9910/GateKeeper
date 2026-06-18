"""Test whether depressed revenue re-acceleration later becomes earnings.

This follows the Rule A setup from the convergence research:

    eigen_z >= 2 + range_pos_252d <= 0.10 + revenue_ttm_growth_pct >= 17.7

The signal is built only from point-in-time facts available at the signal date.
Then we look at subsequently reported quarters to ask whether winners were the
stocks where revenue re-acceleration later converted into earnings/margins/FCF.

Usage:
    python backend/scripts/run_revenue_to_earnings_followthrough.py
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_convergence_winner_attribution as attr  # noqa: E402
import run_reacceleration_dcf_backtest as reaccel  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"
DEFAULT_OBS = RESEARCH_DIR / "full_convergence_stack_obs.csv"
DEFAULT_OUTPUT = RESEARCH_DIR / "revenue_to_earnings_followthrough.json"
DEFAULT_CSV = RESEARCH_DIR / "revenue_to_earnings_followthrough.csv"
DEFAULT_MD = RESEARCH_DIR / "revenue_to_earnings_followthrough.md"


def safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        v = float(value)
    except Exception:
        return None
    return v if math.isfinite(v) else None


def mean(values: Sequence[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def pct_change(now: Optional[float], prev: Optional[float]) -> Optional[float]:
    if now is None or prev in (None, 0):
        return None
    return (now / prev - 1.0) * 100.0


def parse_date(value: Any) -> Optional[pd.Timestamp]:
    try:
        return pd.Timestamp(str(value)[:10])
    except Exception:
        return None


def metric(row: Dict[str, Any], key: str) -> Optional[float]:
    return safe_float(row.get(key))


def margin(row: Dict[str, Any], numerator: str) -> Optional[float]:
    rev = metric(row, "revenue")
    val = metric(row, numerator)
    if rev in (None, 0) or val is None:
        return None
    return val / rev * 100.0


def series_for(periods: Sequence[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    return [p for p in periods if metric(p, key) is not None]


def latest_before(periods: Sequence[Dict[str, Any]], asof: pd.Timestamp, key: str) -> Optional[Dict[str, Any]]:
    rows = [
        p for p in series_for(periods, key)
        if parse_date(p.get("available_at")) is not None and parse_date(p["available_at"]) <= asof
    ]
    rows.sort(key=lambda p: (str(p.get("available_at")), str(p.get("period_end"))))
    return rows[-1] if rows else None


def future_periods(periods: Sequence[Dict[str, Any]], asof: pd.Timestamp, key: str, count: int) -> List[Dict[str, Any]]:
    rows = [
        p for p in series_for(periods, key)
        if parse_date(p.get("available_at")) is not None and parse_date(p["available_at"]) > asof
    ]
    rows.sort(key=lambda p: (str(p.get("available_at")), str(p.get("period_end"))))
    return rows[:count]


def best_delta(current: Optional[float], future_values: Sequence[Optional[float]]) -> Optional[float]:
    vals = [v for v in future_values if v is not None]
    if current is None or not vals:
        return None
    return max(vals) - current


def any_delta(current: Optional[float], future_values: Sequence[Optional[float]], threshold: float) -> Optional[bool]:
    delta = best_delta(current, future_values)
    if delta is None:
        return None
    return delta >= threshold


def load_candidates(args: argparse.Namespace) -> List[Dict[str, Any]]:
    by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for horizon in (126, 252):
        enriched, _features = attr.enrich_rows(Path(args.obs_csv), horizon)
        for row in enriched:
            if not reaccel.is_rule_a(row, args.revenue_ttm_growth_threshold, args.range_pos_max, args.min_eigen_z):
                continue
            key = (str(row["symbol"]).upper(), str(row["asof_date"]))
            target = by_key.setdefault(key, dict(row))
            target[f"forward_{horizon}d_pct"] = row.get("return_pct")
            target[f"spy_{horizon}d_pct"] = row.get("spy_return_pct")
    return list(by_key.values())


def enrich_followthrough(row: Dict[str, Any], periods_by_symbol: Dict[str, List[Dict[str, Any]]], future_quarters: int) -> Dict[str, Any]:
    symbol = str(row["symbol"]).upper()
    asof = pd.Timestamp(str(row["asof_date"]))
    periods = periods_by_symbol.get(symbol, [])

    entry_revenue_row = latest_before(periods, asof, "revenue")
    entry_net_income_row = latest_before(periods, asof, "net_income")
    entry_fcf_row = latest_before(periods, asof, "free_cash_flow")
    entry_operating_row = latest_before(periods, asof, "operating_income")

    future_revenue = future_periods(periods, asof, "revenue", future_quarters)
    future_net_income = future_periods(periods, asof, "net_income", future_quarters)
    future_fcf = future_periods(periods, asof, "free_cash_flow", future_quarters)
    future_operating = future_periods(periods, asof, "operating_income", future_quarters)

    entry_rev = metric(entry_revenue_row or {}, "revenue")
    entry_ni = metric(entry_net_income_row or {}, "net_income")
    entry_fcf = metric(entry_fcf_row or {}, "free_cash_flow")
    entry_net_margin = margin(entry_net_income_row or {}, "net_income")
    entry_fcf_margin = margin(entry_fcf_row or {}, "free_cash_flow")
    entry_op_margin = margin(entry_operating_row or {}, "operating_income")

    future_ni_vals = [metric(p, "net_income") for p in future_net_income]
    future_fcf_vals = [metric(p, "free_cash_flow") for p in future_fcf]
    future_rev_vals = [metric(p, "revenue") for p in future_revenue]
    future_net_margins = [margin(p, "net_income") for p in future_net_income]
    future_fcf_margins = [margin(p, "free_cash_flow") for p in future_fcf]
    future_op_margins = [margin(p, "operating_income") for p in future_operating]

    net_income_positive_any = any(v is not None and v > 0 for v in future_ni_vals)
    fcf_positive_any = any(v is not None and v > 0 for v in future_fcf_vals)
    revenue_continues_up_any = any(v is not None and entry_rev not in (None, 0) and v > entry_rev for v in future_rev_vals)

    net_income_improved_any = None
    if entry_ni is not None and future_ni_vals:
        vals = [v for v in future_ni_vals if v is not None]
        net_income_improved_any = bool(vals and max(vals) > entry_ni)

    fcf_improved_any = None
    if entry_fcf is not None and future_fcf_vals:
        vals = [v for v in future_fcf_vals if v is not None]
        fcf_improved_any = bool(vals and max(vals) > entry_fcf)

    net_margin_improved_10pp = any_delta(entry_net_margin, future_net_margins, 10.0)
    fcf_margin_improved_10pp = any_delta(entry_fcf_margin, future_fcf_margins, 10.0)
    operating_margin_improved_10pp = any_delta(entry_op_margin, future_op_margins, 10.0)

    front_run_confirmed = bool(
        safe_float(row.get("revenue_ttm_growth_pct")) is not None
        and safe_float(row.get("revenue_ttm_growth_pct")) >= 17.7
        and (entry_net_margin is None or entry_net_margin <= 0)
        and (
            net_income_positive_any
            or net_income_improved_any
            or net_margin_improved_10pp
            or operating_margin_improved_10pp
        )
    )

    out = dict(row)
    out.update({
        "entry_revenue": entry_rev,
        "entry_net_income": entry_ni,
        "entry_free_cash_flow": entry_fcf,
        "entry_net_margin_pct": entry_net_margin,
        "entry_fcf_margin_pct": entry_fcf_margin,
        "entry_operating_margin_pct": entry_op_margin,
        "future_quarters_seen": max(len(future_revenue), len(future_net_income), len(future_fcf)),
        "future_revenue_continues_up_any": revenue_continues_up_any,
        "future_net_income_positive_any": net_income_positive_any,
        "future_net_income_improved_any": net_income_improved_any,
        "future_fcf_positive_any": fcf_positive_any,
        "future_fcf_improved_any": fcf_improved_any,
        "future_net_margin_best_delta_pp": best_delta(entry_net_margin, future_net_margins),
        "future_fcf_margin_best_delta_pp": best_delta(entry_fcf_margin, future_fcf_margins),
        "future_operating_margin_best_delta_pp": best_delta(entry_op_margin, future_op_margins),
        "future_net_margin_improved_10pp": net_margin_improved_10pp,
        "future_fcf_margin_improved_10pp": fcf_margin_improved_10pp,
        "future_operating_margin_improved_10pp": operating_margin_improved_10pp,
        "front_run_confirmed": front_run_confirmed,
    })
    return out


def summarize_returns(rows: Sequence[Dict[str, Any]], horizon: int) -> Dict[str, Any]:
    vals = [safe_float(r.get(f"forward_{horizon}d_pct")) for r in rows]
    spys = [safe_float(r.get(f"spy_{horizon}d_pct")) for r in rows]
    pairs = [(v, s) for v, s in zip(vals, spys) if v is not None and s is not None]
    vals = [v for v in vals if v is not None]
    excess = [v - s for v, s in pairs]
    return {
        "n": len(vals),
        "avg_return_pct": round(mean(vals) or 0.0, 4) if vals else None,
        "median_return_pct": round(median(vals) or 0.0, 4) if vals else None,
        "win_rate": round(sum(1 for v in vals if v > 0) / len(vals), 4) if vals else None,
        "avg_vs_spy_pct": round(mean(excess) or 0.0, 4) if excess else None,
        "median_vs_spy_pct": round(median(excess) or 0.0, 4) if excess else None,
        "spy_beat_rate": round(sum(1 for v in excess if v > 0) / len(excess), 4) if excess else None,
        "best_pct": round(max(vals), 4) if vals else None,
        "worst_pct": round(min(vals), 4) if vals else None,
    }


def group_summaries(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    predicates = {
        "all_rule_a": lambda r: True,
        "entry_net_margin_positive": lambda r: (safe_float(r.get("entry_net_margin_pct")) or -10**9) > 0,
        "entry_net_margin_negative_or_missing": lambda r: safe_float(r.get("entry_net_margin_pct")) is None or safe_float(r.get("entry_net_margin_pct")) <= 0,
        "future_net_income_positive": lambda r: bool(r.get("future_net_income_positive_any")),
        "future_net_income_improved": lambda r: bool(r.get("future_net_income_improved_any")),
        "future_net_margin_improved_10pp": lambda r: bool(r.get("future_net_margin_improved_10pp")),
        "future_fcf_positive": lambda r: bool(r.get("future_fcf_positive_any")),
        "future_fcf_improved": lambda r: bool(r.get("future_fcf_improved_any")),
        "future_fcf_margin_improved_10pp": lambda r: bool(r.get("future_fcf_margin_improved_10pp")),
        "front_run_confirmed": lambda r: bool(r.get("front_run_confirmed")),
        "front_run_not_confirmed": lambda r: not bool(r.get("front_run_confirmed")),
    }
    out: Dict[str, Any] = {}
    for name, pred in predicates.items():
        subset = [r for r in rows if pred(r)]
        out[name] = {
            "count": len(subset),
            "horizon_126": summarize_returns(subset, 126),
            "horizon_252": summarize_returns(subset, 252),
        }
    return out


def write_md(path: Path, payload: Dict[str, Any]) -> None:
    rows = payload["rows"]
    groups = payload["group_summaries"]
    lines = [
        "# Revenue To Earnings Follow-Through",
        "",
        f"- Script: `{payload['study']['script']}`",
        f"- Candidates: {payload['study']['candidate_count']}",
        f"- Future quarters checked: {payload['study']['future_quarters']}",
        "",
        "## Main Result",
        "",
        "| Group | Count | 6M avg | 6M median | 6M beat SPY | 1Y avg | 1Y median | 1Y beat SPY |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for key in (
        "all_rule_a",
        "entry_net_margin_positive",
        "entry_net_margin_negative_or_missing",
        "future_net_income_positive",
        "future_net_income_improved",
        "future_net_margin_improved_10pp",
        "front_run_confirmed",
        "front_run_not_confirmed",
    ):
        block = groups[key]
        h126 = block["horizon_126"]
        h252 = block["horizon_252"]
        lines.append(
            f"| {key} | {block['count']} | {h126['avg_return_pct']} | {h126['median_return_pct']} | "
            f"{h126['spy_beat_rate']} | {h252['avg_return_pct']} | {h252['median_return_pct']} | {h252['spy_beat_rate']} |"
        )
    lines.extend([
        "",
        "## Candidate Detail",
        "",
        "| Symbol | Date | 6M | 1Y | Entry net margin | Future NI positive | Future NI improved | Future net margin delta | Front-run confirmed |",
        "|---|---:|---:|---:|---:|---|---|---:|---|",
    ])
    for row in sorted(rows, key=lambda r: safe_float(r.get("forward_126d_pct")) or -10**9, reverse=True):
        lines.append(
            f"| {row['symbol']} | {row['asof_date']} | {fmt(row.get('forward_126d_pct'))} | {fmt(row.get('forward_252d_pct'))} | "
            f"{fmt(row.get('entry_net_margin_pct'))} | {row.get('future_net_income_positive_any')} | "
            f"{row.get('future_net_income_improved_any')} | {fmt(row.get('future_net_margin_best_delta_pp'))} | "
            f"{row.get('front_run_confirmed')} |"
        )
    lines.extend([
        "",
        "## Interpretation",
        "",
        "This tests whether the market was front-running future earnings after revenue re-acceleration. "
        "The sample is small, so the result should guide the next filter rather than certify a portfolio rule.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def fmt(value: Any) -> str:
    v = safe_float(value)
    return "" if v is None else f"{v:.1f}"


def run(args: argparse.Namespace) -> Dict[str, Any]:
    candidates = load_candidates(args)
    periods = attr.load_fundamental_periods(str(r["symbol"]).upper() for r in candidates)
    rows = [enrich_followthrough(r, periods, args.future_quarters) for r in candidates]

    with Path(args.output_csv).open("w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "symbol", "asof_date", "forward_126d_pct", "spy_126d_pct", "forward_252d_pct", "spy_252d_pct",
            "score", "eigen_z", "range_pos_252d", "revenue_ttm_growth_pct",
            "entry_net_margin_pct", "entry_fcf_margin_pct", "entry_operating_margin_pct",
            "future_quarters_seen", "future_revenue_continues_up_any",
            "future_net_income_positive_any", "future_net_income_improved_any",
            "future_fcf_positive_any", "future_fcf_improved_any",
            "future_net_margin_best_delta_pp", "future_fcf_margin_best_delta_pp",
            "future_operating_margin_best_delta_pp", "future_net_margin_improved_10pp",
            "future_fcf_margin_improved_10pp", "future_operating_margin_improved_10pp",
            "front_run_confirmed",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k) for k in fieldnames})

    payload = {
        "study": {
            "name": "revenue_to_earnings_followthrough",
            "script": "backend/scripts/run_revenue_to_earnings_followthrough.py",
            "rule_a": f"eigen_z >= {args.min_eigen_z} + range_pos_252d <= {args.range_pos_max} + revenue_ttm_growth_pct >= {args.revenue_ttm_growth_threshold}",
            "future_quarters": args.future_quarters,
            "candidate_count": len(rows),
        },
        "group_summaries": group_summaries(rows),
        "rows": rows,
    }
    Path(args.output_json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_md(Path(args.output_md), payload)
    return payload


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obs-csv", default=str(DEFAULT_OBS))
    parser.add_argument("--range-pos-max", type=float, default=0.10)
    parser.add_argument("--revenue-ttm-growth-threshold", type=float, default=17.7)
    parser.add_argument("--min-eigen-z", type=float, default=2.0)
    parser.add_argument("--future-quarters", type=int, default=4)
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output-csv", default=str(DEFAULT_CSV))
    parser.add_argument("--output-md", default=str(DEFAULT_MD))
    args = parser.parse_args(argv)

    payload = run(args)
    print("\n=== Revenue to earnings follow-through ===")
    print(f"Candidates: {payload['study']['candidate_count']}")
    for key, block in payload["group_summaries"].items():
        print(key, block)
    print(f"\nWrote {args.output_json}")
    print(f"Wrote {args.output_csv}")
    print(f"Wrote {args.output_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
