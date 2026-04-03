#!/usr/bin/env python3
"""
Fundamental Quality Filter — Regime Primitive.

Gates technical signals based on company fundamental quality.
Fetches live fundamentals from fundamentalsService.py (yfinance) and
evaluates a configurable set of pass/fail thresholds.

This primitive enables A/B testing:
  Strategy A: technical signals only (no this primitive)
  Strategy B: technical signals + fundamental gate (this primitive in regime slot)

The experiment answers: do fundamentals improve technical signal quality?

Tunable params (from spec.setup_config):
    min_survivability_score   float  (default 40.0)  — 0-100 composite survivability score
    require_positive_revenue  bool   (default True)   — revenue growth must be > 0
    require_profitable        bool   (default False)  — profit margin must be > 0
    max_debt_to_equity        float  (default 2.0)    — debt/equity cap (0 = disabled)
    min_tactical_score        float  (default 0.0)    — 0-100 tactical grade (0 = disabled)
    require_positive_fcf      bool   (default False)  — free cash flow must be > 0
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        "cost_config": spec.get("cost_config") or None,
        "entry_config": spec.get("entry_config") or None,
        "exit_config": spec.get("exit_config") or None,
        "risk_config": spec.get("risk_config") or None,
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "structure_config": spec.get("structure_config") or None,
        "version": spec.get("version"),
    }

    def canonicalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: canonicalize(value[k]) for k in sorted(value.keys())}
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        return value

    json_str = json.dumps(canonicalize(payload), separators=(",", ":"))
    return hashlib.sha256(json_str.encode("utf-8")).hexdigest()


def _fetch_fundamentals(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Import and call fundamentalsService.get_fundamentals().
    Returns the snapshot dict or None on failure.
    """
    try:
        import importlib.util, os
        service_path = os.path.join(
            os.path.dirname(__file__), "..", "fundamentalsService.py"
        )
        service_path = os.path.abspath(service_path)
        spec_mod = importlib.util.spec_from_file_location("fundamentalsService", service_path)
        mod = importlib.util.module_from_spec(spec_mod)
        spec_mod.loader.exec_module(mod)
        return mod.get_fundamentals(symbol)
    except Exception as e:
        print(f"[FundamentalQualityFilter] Failed to fetch fundamentals for {symbol}: {e}", file=sys.stderr)
        return None


def run_fundamental_quality_filter_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Regime primitive: passes only if the symbol meets fundamental quality thresholds.

    Returns a single candidate with passed=True if the company clears all
    enabled filters, passed=False otherwise. The validator uses this to gate
    downstream technical signals.
    """
    setup = spec.get("setup_config", {}) or {}
    strategy_version_id = spec.get(
        "strategy_version_id",
        f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}",
    )
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)

    # ── Thresholds ────────────────────────────────────────────────────────────
    min_survivability    = float(setup.get("min_survivability_score", 40.0))
    require_pos_revenue  = bool(setup.get("require_positive_revenue", True))
    require_profitable   = bool(setup.get("require_profitable", False))
    max_debt_equity      = float(setup.get("max_debt_to_equity", 2.0))
    min_tactical         = float(setup.get("min_tactical_score", 0.0))
    require_pos_fcf      = bool(setup.get("require_positive_fcf", False))

    # ── Fetch fundamentals ────────────────────────────────────────────────────
    fundamentals = _fetch_fundamentals(symbol)

    rules = []
    overall_passed = True

    if fundamentals is None:
        # Can't verify — treat as fail to avoid trading blind
        rules.append({
            "rule_name": "fundamentals_available",
            "passed": False,
            "value": "fetch failed",
            "threshold": "data must be available",
        })
        overall_passed = False
    else:
        # ── Rule 1: Survivability score ───────────────────────────────────────
        if min_survivability > 0:
            surv = fundamentals.get("survivabilityScore")
            surv_val = float(surv) if surv is not None else None
            surv_passed = surv_val is not None and surv_val >= min_survivability
            if surv_val is None:
                surv_passed = False
            rules.append({
                "rule_name": "survivability_score",
                "passed": surv_passed,
                "value": f"{surv_val:.1f}" if surv_val is not None else "n/a",
                "threshold": f">= {min_survivability}",
            })
            if not surv_passed:
                overall_passed = False

        # ── Rule 2: Revenue growth ────────────────────────────────────────────
        if require_pos_revenue:
            rev_growth = fundamentals.get("revenueGrowthPct") or fundamentals.get("revenueYoYGrowthPct")
            rev_val = float(rev_growth) if rev_growth is not None else None
            rev_passed = rev_val is not None and rev_val > 0
            rules.append({
                "rule_name": "revenue_growth_positive",
                "passed": rev_passed,
                "value": f"{rev_val:.1f}%" if rev_val is not None else "n/a",
                "threshold": "> 0%",
            })
            if not rev_passed:
                overall_passed = False

        # ── Rule 3: Profitability ─────────────────────────────────────────────
        if require_profitable:
            margin = fundamentals.get("profitMarginPct")
            margin_val = float(margin) if margin is not None else None
            margin_passed = margin_val is not None and margin_val > 0
            rules.append({
                "rule_name": "profit_margin_positive",
                "passed": margin_passed,
                "value": f"{margin_val:.1f}%" if margin_val is not None else "n/a",
                "threshold": "> 0%",
            })
            if not margin_passed:
                overall_passed = False

        # ── Rule 4: Debt / equity ─────────────────────────────────────────────
        if max_debt_equity > 0:
            de = fundamentals.get("debtToEquity")
            de_val = float(de) if de is not None else None
            de_passed = de_val is None or de_val <= max_debt_equity  # None = no debt data → allow
            rules.append({
                "rule_name": "debt_to_equity",
                "passed": de_passed,
                "value": f"{de_val:.2f}" if de_val is not None else "n/a",
                "threshold": f"<= {max_debt_equity}",
            })
            if not de_passed:
                overall_passed = False

        # ── Rule 5: Tactical score ────────────────────────────────────────────
        if min_tactical > 0:
            tact = fundamentals.get("tacticalScore")
            tact_val = float(tact) if tact is not None else None
            tact_passed = tact_val is not None and tact_val >= min_tactical
            rules.append({
                "rule_name": "tactical_score",
                "passed": tact_passed,
                "value": f"{tact_val:.1f}" if tact_val is not None else "n/a",
                "threshold": f">= {min_tactical}",
            })
            if not tact_passed:
                overall_passed = False

        # ── Rule 6: Free cash flow ────────────────────────────────────────────
        if require_pos_fcf:
            fcf = fundamentals.get("freeCashFlowTTM")
            fcf_val = float(fcf) if fcf is not None else None
            fcf_passed = fcf_val is not None and fcf_val > 0
            rules.append({
                "rule_name": "free_cash_flow_positive",
                "passed": fcf_passed,
                "value": f"${fcf_val/1e6:.1f}M" if fcf_val is not None else "n/a",
                "threshold": "> 0",
            })
            if not fcf_passed:
                overall_passed = False

    # ── Summary ───────────────────────────────────────────────────────────────
    passed_count = sum(1 for r in rules if r["passed"])
    total_count  = len(rules)
    score        = round(passed_count / total_count, 3) if total_count > 0 else 0.0
    reason = (
        f"Fundamental quality: {passed_count}/{total_count} checks passed"
        if overall_passed
        else f"Fundamental quality FAIL: {passed_count}/{total_count} checks passed"
    )

    n = len(data)
    spec_hash_short = spec_hash[:8]
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash_short}_0_{n - 1}"

    # Surface key fundamentals in anchors for AI/display context
    anchors: Dict[str, Any] = {}
    if fundamentals:
        anchors = {
            "survivabilityScore":   fundamentals.get("survivabilityScore"),
            "tacticalScore":        fundamentals.get("tacticalScore"),
            "revenueGrowthPct":     fundamentals.get("revenueGrowthPct"),
            "profitMarginPct":      fundamentals.get("profitMarginPct"),
            "debtToEquity":         fundamentals.get("debtToEquity"),
            "freeCashFlowTTM":      fundamentals.get("freeCashFlowTTM"),
            "returnOnEquityPct":    fundamentals.get("returnOnEquityPct"),
            "earningsGrowthPct":    fundamentals.get("earningsGrowthPct"),
            "sector":               fundamentals.get("sector"),
            "quality":              fundamentals.get("quality"),
            "tacticalGrade":        fundamentals.get("tacticalGrade"),
        }

    print(
        f"[FundamentalQualityFilter] {symbol}: passed={overall_passed} "
        f"({passed_count}/{total_count} rules)",
        file=sys.stderr,
    )

    return [{
        "candidate_id":        candidate_id,
        "id":                  candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash":           spec_hash,
        "symbol":              symbol,
        "timeframe":           timeframe,
        "score":               score,
        "entry_ready":         overall_passed,
        "rule_checklist":      rules,
        "anchors":             anchors,
        "window_start":        0,
        "window_end":          n - 1,
        "pattern_type":        "fundamental_quality_filter_primitive",
        "created_at":          datetime.utcnow().isoformat() + "Z",
        "chart_data":          [],
        "node_result": {
            "passed": overall_passed,
            "score":  score,
            "reason": reason,
        },
        "output_ports": {
            "signal": {
                "passed": overall_passed,
                "score":  score,
                "reason": reason,
            },
            "fundamentals": anchors,
        },
    }]
