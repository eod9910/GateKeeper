"""Backtest re-acceleration filters with and without PIT DCF.

This takes bullish convergence observations from
run_full_convergence_stack_study.py and tests two explicit rules:

Rule A:
  bullish convergence + price depressed + revenue acceleration

Rule B:
  Rule A + PIT DCF valuation_state == undervalued

The point is to answer whether DCF adds any legs once the more promising
"washed-out + business re-accelerating" condition is present.

Usage:
    python backend/scripts/run_reacceleration_dcf_backtest.py
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_convergence_winner_attribution as attr  # noqa: E402
import run_valuation_gap_accuracy_study as valuation  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"
DEFAULT_OBS = RESEARCH_DIR / "full_convergence_stack_obs.csv"
DEFAULT_OUTPUT = RESEARCH_DIR / "reacceleration_dcf_backtest.json"
DEFAULT_CSV = RESEARCH_DIR / "reacceleration_dcf_backtest_trades.csv"


def safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def mean(values: Sequence[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def summarize_returns(values: Sequence[float], spy_values: Sequence[float]) -> Dict[str, Any]:
    values = [float(v) for v in values if v is not None]
    spy_values = [float(v) for v in spy_values if v is not None]
    excess = [v - s for v, s in zip(values, spy_values)]
    return {
        "n": len(values),
        "avg_return_pct": round(mean(values) or 0.0, 4) if values else None,
        "median_return_pct": round(median(values) or 0.0, 4) if values else None,
        "win_rate": round(sum(1 for v in values if v > 0) / len(values), 4) if values else None,
        "avg_spy_pct": round(mean(spy_values) or 0.0, 4) if spy_values else None,
        "avg_vs_spy_pct": round(mean(excess) or 0.0, 4) if excess else None,
        "median_vs_spy_pct": round(median(excess) or 0.0, 4) if excess else None,
        "spy_beat_rate": round(sum(1 for v in excess if v > 0) / len(excess), 4) if excess else None,
        "best_pct": round(max(values), 4) if values else None,
        "worst_pct": round(min(values), 4) if values else None,
    }


def is_rule_a(row: Dict[str, Any], revenue_growth_threshold: float, range_pos_max: float, min_eigen_z: float) -> bool:
    eigen_z = safe_float(row.get("eigen_z"))
    if eigen_z is None or eigen_z < min_eigen_z:
        return False
    range_pos = safe_float(row.get("range_pos_252d"))
    rev_growth = safe_float(row.get("revenue_ttm_growth_pct"))
    if range_pos is None or rev_growth is None:
        return False
    return range_pos <= range_pos_max and rev_growth >= revenue_growth_threshold


def quality_pass(row: Dict[str, Any], args: argparse.Namespace) -> bool:
    current_ratio = safe_float(row.get("current_ratio_latest"))
    net_margin = safe_float(row.get("net_margin_latest_pct"))
    fcf_margin = safe_float(row.get("fcf_margin_latest_pct"))
    equity_to_mcap = safe_float(row.get("shareholders_equity_to_market_cap"))

    if current_ratio is None or current_ratio < args.min_current_ratio:
        return False
    if equity_to_mcap is None or equity_to_mcap < args.min_equity_to_market_cap:
        return False
    if net_margin is None or net_margin < args.min_net_margin_pct:
        return False
    if fcf_margin is None or fcf_margin < args.min_fcf_margin_pct:
        return False
    return True


def build_dcf_cache(rows: Sequence[Dict[str, Any]], horizons: Sequence[int], cache_path: Path, rebuild: bool) -> Dict[str, Dict[str, Any]]:
    if cache_path.exists() and not rebuild:
        return json.loads(cache_path.read_text(encoding="utf-8"))

    by_symbol: Dict[str, List[str]] = defaultdict(list)
    for row in rows:
        by_symbol[str(row["symbol"]).upper()].append(str(row["asof_date"]))

    conn = valuation.connect_pit(str(valuation.DEFAULT_DB_PATH))
    valuation.ensure_schema(conn)
    cache: Dict[str, Dict[str, Any]] = {}
    try:
        for idx, (symbol, dates) in enumerate(sorted(by_symbol.items()), start=1):
            bars = valuation._load_daily_bars(symbol)
            if len(bars) <= max(horizons) + 24:
                continue
            start = min(dates)
            end = max(dates)
            observations = valuation._evaluate_symbol(
                conn,
                symbol,
                bars,
                rebalance_frequency="monthly",
                start_date=start,
                end_date=end,
                gap_threshold_pct=20.0,
                horizons=horizons,
                reliability_guard=True,
            )
            for obs in observations:
                cache[f"{obs.symbol}|{obs.asof_date}"] = {
                    "valuation_state": obs.valuation_state,
                    "valuation_gap_pct": obs.valuation_gap_pct,
                    "fair_value_mid": obs.fair_value_mid,
                    "quality_grade": obs.quality_grade,
                    "quality_score": obs.quality_score,
                }
            if idx % 50 == 0:
                print(f"  DCF cache symbols {idx}/{len(by_symbol)}", flush=True)
    finally:
        conn.close()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    return cache


def portfolio_summary(rows: Sequence[Dict[str, Any]], horizon: int, top_n: int) -> Dict[str, Any]:
    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        ret = safe_float(row.get(f"forward_{horizon}d_pct"))
        if ret is None:
            continue
        by_date[str(row["asof_date"])].append(row)

    port = []
    spy = []
    counts = []
    for _date, group in sorted(by_date.items()):
        group = sorted(group, key=lambda r: abs(safe_float(r.get("score")) or 0.0), reverse=True)[:top_n]
        rets = [safe_float(r.get(f"forward_{horizon}d_pct")) for r in group]
        spys = [safe_float(r.get(f"spy_{horizon}d_pct")) for r in group]
        rets = [r for r in rets if r is not None]
        spys = [s for s in spys if s is not None]
        if not rets:
            continue
        port.append(statistics.mean(rets))
        spy.append(statistics.mean(spys) if spys else 0.0)
        counts.append(len(rets))

    out = summarize_returns(port, spy)
    out["formation_windows"] = len(port)
    out["top_n"] = top_n
    out["avg_names"] = round(mean(counts) or 0.0, 2) if counts else 0.0
    return out


def run_backtest(args: argparse.Namespace) -> Dict[str, Any]:
    horizons = [int(x.strip()) for x in str(args.horizons).split(",") if x.strip()]
    enriched_by_horizon: Dict[int, List[Dict[str, Any]]] = {}
    all_rule_a_rows: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for horizon in horizons:
        print(f"Enriching candidates for {horizon}d...", flush=True)
        enriched, _features = attr.enrich_rows(Path(args.obs_csv), horizon)
        for row in enriched:
            row[f"forward_{horizon}d_pct"] = row.get("return_pct")
            row[f"spy_{horizon}d_pct"] = row.get("spy_return_pct")
        rule_a = [r for r in enriched if is_rule_a(r, args.revenue_ttm_growth_threshold, args.range_pos_max, args.min_eigen_z)]
        rule_q = [r for r in rule_a if quality_pass(r, args)]
        enriched_by_horizon[horizon] = rule_a
        enriched_by_horizon[f"{horizon}_quality"] = rule_q
        for r in rule_a:
            all_rule_a_rows[(str(r["symbol"]).upper(), str(r["asof_date"]))] = r

    print(f"Rule A unique rows needing DCF: {len(all_rule_a_rows)}", flush=True)
    dcf_cache = build_dcf_cache(
        list(all_rule_a_rows.values()),
        horizons=horizons,
        cache_path=Path(args.dcf_cache),
        rebuild=args.rebuild_dcf_cache,
    )

    results: Dict[str, Any] = {}
    trade_rows: List[Dict[str, Any]] = []
    for horizon_key, rule_a in enriched_by_horizon.items():
        if isinstance(horizon_key, str) and horizon_key.endswith("_quality"):
            continue
        horizon = int(horizon_key)
        rule_q = enriched_by_horizon.get(f"{horizon}_quality", [])
        rule_b = []
        for row in rule_a:
            key = f"{str(row['symbol']).upper()}|{row['asof_date']}"
            dcf = dcf_cache.get(key)
            row = dict(row)
            row.update({
                "dcf_state": (dcf or {}).get("valuation_state"),
                "dcf_gap_pct": (dcf or {}).get("valuation_gap_pct"),
                "dcf_quality_grade": (dcf or {}).get("quality_grade"),
            })
            trade_rows.append({
                "horizon": horizon,
                "rule": "A",
                "symbol": row["symbol"],
                "asof_date": row["asof_date"],
                "return_pct": row.get(f"forward_{horizon}d_pct"),
                "spy_return_pct": row.get(f"spy_{horizon}d_pct"),
                "score": row.get("score"),
                "range_pos_252d": row.get("range_pos_252d"),
                "revenue_ttm_growth_pct": row.get("revenue_ttm_growth_pct"),
                "current_ratio_latest": row.get("current_ratio_latest"),
                "shareholders_equity_to_market_cap": row.get("shareholders_equity_to_market_cap"),
                "net_margin_latest_pct": row.get("net_margin_latest_pct"),
                "fcf_margin_latest_pct": row.get("fcf_margin_latest_pct"),
                "dcf_state": row.get("dcf_state"),
                "dcf_gap_pct": row.get("dcf_gap_pct"),
            })
            if row.get("dcf_state") == "undervalued":
                rule_b.append(row)
                trade_rows.append({**trade_rows[-1], "rule": "B"})

        for row in rule_q:
            key = f"{str(row['symbol']).upper()}|{row['asof_date']}"
            dcf = dcf_cache.get(key)
            trade_rows.append({
                "horizon": horizon,
                "rule": "C",
                "symbol": row["symbol"],
                "asof_date": row["asof_date"],
                "return_pct": row.get(f"forward_{horizon}d_pct"),
                "spy_return_pct": row.get(f"spy_{horizon}d_pct"),
                "score": row.get("score"),
                "range_pos_252d": row.get("range_pos_252d"),
                "revenue_ttm_growth_pct": row.get("revenue_ttm_growth_pct"),
                "current_ratio_latest": row.get("current_ratio_latest"),
                "shareholders_equity_to_market_cap": row.get("shareholders_equity_to_market_cap"),
                "net_margin_latest_pct": row.get("net_margin_latest_pct"),
                "fcf_margin_latest_pct": row.get("fcf_margin_latest_pct"),
                "dcf_state": (dcf or {}).get("valuation_state"),
                "dcf_gap_pct": (dcf or {}).get("valuation_gap_pct"),
            })

        results[str(horizon)] = {
            "rule_a_no_dcf": {
                "single_name": summarize_returns(
                    [safe_float(r.get(f"forward_{horizon}d_pct")) for r in rule_a],
                    [safe_float(r.get(f"spy_{horizon}d_pct")) for r in rule_a],
                ),
                "top10_portfolio": portfolio_summary(rule_a, horizon, 10),
                "top20_portfolio": portfolio_summary(rule_a, horizon, 20),
            },
            "rule_b_with_dcf_undervalued": {
                "single_name": summarize_returns(
                    [safe_float(r.get(f"forward_{horizon}d_pct")) for r in rule_b],
                    [safe_float(r.get(f"spy_{horizon}d_pct")) for r in rule_b],
                ),
                "top10_portfolio": portfolio_summary(rule_b, horizon, 10),
                "top20_portfolio": portfolio_summary(rule_b, horizon, 20),
            },
            "rule_c_quality_no_dcf": {
                "single_name": summarize_returns(
                    [safe_float(r.get(f"forward_{horizon}d_pct")) for r in rule_q],
                    [safe_float(r.get(f"spy_{horizon}d_pct")) for r in rule_q],
                ),
                "top10_portfolio": portfolio_summary(rule_q, horizon, 10),
                "top20_portfolio": portfolio_summary(rule_q, horizon, 20),
            },
            "dcf_coverage": {
                "rule_a_rows": len(rule_a),
                "rule_b_rows": len(rule_b),
                "rule_c_quality_rows": len(rule_q),
                "dcf_undervalued_rate": round(len(rule_b) / len(rule_a), 4) if rule_a else None,
            },
        }

    with Path(args.output_csv).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "horizon", "rule", "symbol", "asof_date", "return_pct", "spy_return_pct",
            "score", "range_pos_252d", "revenue_ttm_growth_pct", "current_ratio_latest",
            "shareholders_equity_to_market_cap", "net_margin_latest_pct", "fcf_margin_latest_pct",
            "dcf_state", "dcf_gap_pct",
        ])
        writer.writeheader()
        writer.writerows(trade_rows)

    return {
        "study": {
            "name": "reacceleration_dcf_backtest",
            "script": "backend/scripts/run_reacceleration_dcf_backtest.py",
            "obs_csv": args.obs_csv,
            "rule_a": f"bullish eigen_z >= {args.min_eigen_z} + range_pos_252d <= {args.range_pos_max} + revenue_ttm_growth_pct >= {args.revenue_ttm_growth_threshold}",
            "rule_b": "rule_a + PIT DCF valuation_state == undervalued",
            "rule_c": f"rule_a + current_ratio >= {args.min_current_ratio}, equity/mcap >= {args.min_equity_to_market_cap}, net_margin >= {args.min_net_margin_pct}%, fcf_margin >= {args.min_fcf_margin_pct}%",
            "horizons": horizons,
            "notes": "DCF uses PIT valuation helper with reliability_guard=True. No costs/slippage modeled.",
        },
        "results": results,
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obs-csv", default=str(DEFAULT_OBS))
    parser.add_argument("--horizons", default="126,252")
    parser.add_argument("--range-pos-max", type=float, default=0.10)
    parser.add_argument("--revenue-ttm-growth-threshold", type=float, default=17.7)
    parser.add_argument("--min-eigen-z", type=float, default=2.0)
    parser.add_argument("--min-current-ratio", type=float, default=0.75)
    parser.add_argument("--min-equity-to-market-cap", type=float, default=0.10)
    parser.add_argument("--min-net-margin-pct", type=float, default=-50.0)
    parser.add_argument("--min-fcf-margin-pct", type=float, default=-100.0)
    parser.add_argument("--dcf-cache", default=str(RESEARCH_DIR / "reacceleration_dcf_cache.json"))
    parser.add_argument("--rebuild-dcf-cache", action="store_true")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output-csv", default=str(DEFAULT_CSV))
    args = parser.parse_args(argv)

    payload = run_backtest(args)
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("\n=== Re-acceleration + DCF backtest ===")
    for horizon, res in payload["results"].items():
        print(f"\n--- Horizon {horizon} ---")
        for rule, block in res.items():
            if rule == "dcf_coverage":
                print(rule, block)
                continue
            print(rule)
            print("  single:", block["single_name"])
            print("  top10 :", block["top10_portfolio"])
            print("  top20 :", block["top20_portfolio"])
    print(f"\nWrote {args.output_json}")
    print(f"Wrote {args.output_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
