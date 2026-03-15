#!/usr/bin/env python3
"""
Robustness tests for Validator V1.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
import random


def _parse_dt(s: str) -> datetime:
    s = (s or "")[:19]
    if " " in s:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    if len(s) >= 10:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    return datetime(1970, 1, 1)


def expectancy(trades: List[Dict[str, Any]]) -> float:
    if not trades:
        return 0.0
    return sum(float(t.get("R_multiple", 0.0)) for t in trades) / len(trades)


def _dd_from_r(r_values: List[float]) -> float:
    eq = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in r_values:
        eq += r
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
    return max_dd


def out_of_sample(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not trades:
        return {"is_expectancy": 0.0, "is_n": 0, "oos_expectancy": 0.0, "oos_n": 0, "split_date": "N/A", "oos_degradation_pct": 100.0}

    t = sorted(trades, key=lambda x: _parse_dt(str(x.get("entry_time") or "")))
    split_idx = max(1, int(len(t) * 0.7))
    ins = t[:split_idx]
    oos = t[split_idx:]
    is_exp = expectancy(ins)
    oos_exp = expectancy(oos)
    degr = max(0.0, ((is_exp - oos_exp) / abs(is_exp)) * 100.0) if abs(is_exp) > 1e-9 else (0.0 if abs(oos_exp) < 1e-9 else 100.0)
    split_date = str(oos[0].get("entry_time") or ins[-1].get("entry_time") or "")[:10] if oos else str(ins[-1].get("entry_time") or "")[:10]

    return {
        "is_expectancy": round(is_exp, 4),
        "is_n": len(ins),
        "oos_expectancy": round(oos_exp, 4),
        "oos_n": len(oos),
        "split_date": split_date,
        "oos_degradation_pct": round(degr, 1),
    }


def walk_forward(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(trades) < 15:
        return {"windows": [], "avg_test_expectancy": 0.0, "pct_profitable_windows": 0.0}

    t = sorted(trades, key=lambda x: _parse_dt(str(x.get("entry_time") or "")))
    n = len(t)
    windows: List[Dict[str, Any]] = []

    for w in range(5):
        train_start = int((w / 5.0) * n)
        train_end = min(n - 3, train_start + max(5, int(n * 0.45)))
        test_end = min(n, train_end + max(3, int(n * 0.2)))
        train = t[train_start:train_end]
        test = t[train_end:test_end]
        if not train or not test:
            continue
        windows.append({
            "train_start": str(train[0].get("entry_time") or "")[:10],
            "train_end": str(train[-1].get("entry_time") or "")[:10],
            "test_start": str(test[0].get("entry_time") or "")[:10],
            "test_end": str(test[-1].get("entry_time") or "")[:10],
            "train_expectancy": round(expectancy(train), 4),
            "test_expectancy": round(expectancy(test), 4),
            "test_n": len(test),
        })

    if not windows:
        return {"windows": [], "avg_test_expectancy": 0.0, "pct_profitable_windows": 0.0}

    avg_test = sum(w["test_expectancy"] for w in windows) / len(windows)
    pct_prof = sum(1 for w in windows if w["test_expectancy"] > 0) / len(windows)
    return {"windows": windows, "avg_test_expectancy": round(avg_test, 4), "pct_profitable_windows": round(pct_prof, 4)}


def monte_carlo(
    trades: List[Dict[str, Any]],
    simulations: int = 1000,
    seed: int = 42,
    r_to_pct: float = 2.0,
) -> Dict[str, Any]:
    r_vals = [float(t.get("R_multiple", 0.0)) for t in trades]
    if not r_vals:
        return {"simulations": simulations, "median_dd_pct": 0.0, "p95_dd_pct": 0.0, "p99_dd_pct": 0.0, "median_final_R": 0.0, "p5_final_R": 0.0}

    rnd = random.Random(seed)
    dds = []
    finals = []
    for _ in range(simulations):
        arr = r_vals[:]
        rnd.shuffle(arr)
        dds.append(_dd_from_r(arr) * r_to_pct)
        finals.append(sum(arr))

    dds.sort(); finals.sort()

    def pct(arr, p):
        idx = int((len(arr) - 1) * p)
        return float(arr[idx])

    return {
        "simulations": simulations,
        "median_dd_pct": round(pct(dds, 0.5), 1),
        "p95_dd_pct": round(pct(dds, 0.95), 1),
        "p99_dd_pct": round(pct(dds, 0.99), 1),
        "median_final_R": round(pct(finals, 0.5), 2),
        "p5_final_R": round(pct(finals, 0.05), 2),
    }


def parameter_sensitivity(base_expectancy: float, rerun_with_nudge, params: List[str] | None = None) -> Dict[str, Any]:
    params = params or ["swing_epsilon", "stop_value", "take_profit_R"]
    nudged = []
    for p in params:
        for direction, factor in [("+10%", 1.10), ("-10%", 0.90)]:
            exp = rerun_with_nudge(p, factor)
            change = ((exp - base_expectancy) / abs(base_expectancy) * 100.0) if abs(base_expectancy) > 1e-9 else (0.0 if abs(exp) < 1e-9 else 100.0)
            nudged.append({"param": p, "direction": direction, "expectancy": round(exp, 4), "change_pct": round(change, 1)})

    score = min(100.0, sum(abs(x["change_pct"]) for x in nudged) / max(1, len(nudged)))
    return {
        "params_tested": params,
        "base_expectancy": round(base_expectancy, 4),
        "nudged_results": nudged,
        "sensitivity_score": round(score, 1),
    }
