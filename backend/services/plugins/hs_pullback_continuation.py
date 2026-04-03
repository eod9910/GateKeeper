#!/usr/bin/env python3
"""
H&S Pullback Continuation (Long) — reuses the bearish H&S detector but
treats the pattern as a pullback setup within an uptrend rather than a
reversal.  Entry is long in the OTE zone after the H&S breakdown, with
stop below the break-of-structure low.

Detection is identical to head_shoulders_context_pattern; only the trade
direction and semantic labels change.
"""
from __future__ import annotations

from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV
from plugins.head_shoulders_context_pattern import (
    _as_bool,
    _evaluate_bearish_sequence,
    _extract_rdp_pivots,
)
from plugins.pattern_framework import build_candidate, compute_spec_hash
from universe_registry import load_market_cap_snapshot_billions


# Process-level cache: symbol → (market_cap_billions, avg_volume_k)
# Populated once per symbol per process lifetime — no repeated yfinance calls.
_LIQUIDITY_CACHE: dict[str, tuple[float | None, float | None]] = {}

# Cap tier brackets (min_billions, max_billions).  None = no bound.
_CAP_TIERS: dict[str, tuple[float | None, float | None]] = {
    "all":   (None, None),
    "micro": (0.0,  0.3),
    "small": (0.3,  2.0),
    "mid":   (2.0,  10.0),
    "large": (10.0, 200.0),
    "mega":  (200.0, None),
}

def _seed_cache_from_known_lists() -> None:
    """Pre-populate the liquidity cache from verified cap snapshots so live
    yfinance fetches are never needed for known symbols."""
    for sym, cap_b in load_market_cap_snapshot_billions().items():
        if sym not in _LIQUIDITY_CACHE:
            _LIQUIDITY_CACHE[sym] = (float(cap_b), None)

_seed_cache_from_known_lists()


def _fetch_liquidity_data(symbol: str) -> tuple[float | None, float | None]:
    """Fetch market cap (billions) and avg volume (K shares) from yfinance, with caching."""
    if symbol in _LIQUIDITY_CACHE:
        return _LIQUIDITY_CACHE[symbol]
    try:
        import yfinance as yf
        info = yf.Ticker(symbol).fast_info
        mktcap_b = None
        avg_vol_k = None
        raw_cap = getattr(info, "market_cap", None)
        if raw_cap is not None:
            mktcap_b = raw_cap / 1e9
        raw_vol = getattr(info, "three_month_average_volume", None)
        if raw_vol is not None:
            avg_vol_k = raw_vol / 1_000
        result: tuple[float | None, float | None] = (mktcap_b, avg_vol_k)
    except Exception:
        result = (None, None)
    _LIQUIDITY_CACHE[symbol] = result
    return result


def _check_liquidity_gate(
    symbol: str,
    min_market_cap_billions: float,
    min_avg_volume_k: float,
    market_cap_tier: str = "all",
) -> bool:
    """
    Market-cap / volume gate with optional tier isolation.

    market_cap_tier isolates a specific cap slice (micro/small/mid/large/mega).
    min_market_cap_billions is a simple floor filter (0 = disabled).
    Results are cached so sweeps never re-fetch the same symbol.
    """
    tier = str(market_cap_tier or "all").strip().lower()
    tier_bounds = _CAP_TIERS.get(tier, (None, None))
    tier_min, tier_max = tier_bounds

    no_tier = tier == "all"
    no_min  = min_market_cap_billions <= 0
    no_vol  = min_avg_volume_k <= 0

    if no_tier and no_min and no_vol:
        return True  # nothing to filter

    mktcap_b, avg_vol_k = _fetch_liquidity_data(symbol)

    # Tier bracket — symbol must fall within [tier_min, tier_max)
    if not no_tier and mktcap_b is not None:
        if tier_min is not None and mktcap_b < tier_min:
            return False
        if tier_max is not None and mktcap_b >= tier_max:
            return False

    # Simple floor filter (independent of tier)
    if not no_min and mktcap_b is not None:
        if mktcap_b < min_market_cap_billions:
            return False

    # Volume floor
    if not no_vol and avg_vol_k is not None:
        if avg_vol_k < min_avg_volume_k:
            return False

    return True


def run_hs_pullback_continuation_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    structure_cfg = spec.get("structure_config", {}) or {}

    lookback_bars = max(60, int(setup.get("lookback_bars", 220)))
    pivot_source = str(setup.get("pivot_source", "rdp")).strip().lower()
    swing_epsilon_pct = float(setup.get("swing_epsilon_pct", structure_cfg.get("swing_epsilon_pct", 0.08)))
    use_exact_epsilon = _as_bool(setup.get("use_exact_epsilon", structure_cfg.get("use_exact_epsilon", True)), default=True)
    shoulder_tolerance_pct = float(setup.get("shoulder_tolerance_pct", 0.08))
    head_dominance_pct = float(setup.get("head_dominance_pct", 0.015))
    neckline_tolerance_pct = float(setup.get("neckline_tolerance_pct", 0.08))
    break_min_pct = float(setup.get("break_min_pct", 0.01))
    entry_zone_min_level = float(setup.get("entry_zone_min_level", 0.618))
    entry_zone_max_level = float(setup.get("entry_zone_max_level", 0.786))
    min_score = float(setup.get("min_score", 0.60))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))
    require_above_200ma = _as_bool(setup.get("require_above_200ma", True), default=True)
    min_history_bars = max(0, int(setup.get("min_history_bars", 200)))
    min_market_cap_billions = float(setup.get("min_market_cap_billions", 0.0))
    min_avg_volume_k = float(setup.get("min_avg_volume_k", 0.0))
    market_cap_tier = str(setup.get("market_cap_tier", "all")).strip().lower()

    _MA_PERIOD_BY_TF = {
        "1d": 200, "D": 200, "d": 200,
        "1wk": 40, "W": 40, "w": 40,
        "1mo": 10, "M": 10, "m": 10,
    }
    ma_period = _MA_PERIOD_BY_TF.get(timeframe, 200)

    if len(data) < max(40, min_history_bars):
        return []
    if entry_zone_min_level >= entry_zone_max_level:
        return []

    if require_above_200ma and len(data) >= ma_period:
        closes = [float(bar.close) for bar in data[-ma_period:]]
        ma_value = sum(closes) / len(closes)
        current_close = float(data[-1].close)
        if current_close < ma_value:
            return []

    if not _check_liquidity_gate(symbol, min_market_cap_billions, min_avg_volume_k, market_cap_tier):
        return []

    lookback_start = max(0, len(data) - lookback_bars)
    pivots, resolved_pivot_source = _extract_rdp_pivots(
        data=data,
        structure=structure,
        lookback_start=lookback_start,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=swing_epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        pivot_source=pivot_source,
    )
    if len(pivots) < 6:
        return []

    found: List[Dict[str, Any]] = []
    for start in range(0, len(pivots) - 5):
        result = _evaluate_bearish_sequence(
            data=data,
            pivots=pivots,
            start=start,
            shoulder_tolerance_pct=shoulder_tolerance_pct,
            head_dominance_pct=head_dominance_pct,
            neckline_tolerance_pct=neckline_tolerance_pct,
            break_min_pct=break_min_pct,
            entry_zone_min_level=entry_zone_min_level,
            entry_zone_max_level=entry_zone_max_level,
            min_score=min_score,
        )
        if result:
            found.append(result)

    if not found:
        return []

    deduped: List[Dict[str, Any]] = []
    occupied_keys: set = set()
    for result in sorted(found, key=lambda item: float(item["score"]), reverse=True):
        key = (
            int(result["anchors"]["head"]["index"]),
            int(result["anchors"]["structure_break_low"]["index"]),
        )
        if key in occupied_keys:
            continue
        occupied_keys.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "hs_pullback_continuation_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{result['anchors']['structure_break_low']['index']}_{idx}"
        )

        node_features = dict(result["features"])
        node_features["pivot_source"] = resolved_pivot_source
        node_features["swing_epsilon_pct"] = swing_epsilon_pct
        node_features["use_exact_epsilon"] = use_exact_epsilon
        node_features["pattern_direction"] = "bullish_continuation"

        output_ports = {
            "signal": {
                "passed": True,
                "score": result["score"],
                "reason": "hs_pullback_continuation_ote_long",
            },
            "pattern_geometry": {
                "direction": "bullish",
                "anchors": anchors,
                "score": result["score"],
            },
            "entry_zone": result["entry_zone"],
            "break_leg": result["break_leg"],
            "fib_levels": {
                "retracement_pct": result["entry_zone"]["retracement_pct"],
                "nearest_level": result["features"]["nearest_fib_level"],
                "range_high": result["break_leg"]["leg_high"]["price"],
                "range_low": result["break_leg"]["leg_low"]["price"],
                "proximity_pct": result["features"]["nearest_fib_distance_pct"],
            },
        }

        candidates.append(
            build_candidate(
                data=data,
                candidate_id=candidate_id,
                strategy_version_id=strategy_version_id,
                spec_hash=spec_hash,
                symbol=symbol,
                timeframe=timeframe,
                score=result["score"],
                entry_ready=True,
                pattern_type="hs_pullback_continuation",
                rule_checklist=result["rules"],
                anchors=anchors,
                node_features=node_features,
                node_reason="hs_pullback_continuation_ote_long",
                output_ports=output_ports,
                visual=result["visual"],
                window_start=result["window_start"],
                window_end=result["window_end"],
                candidate_role="pattern_detector",
                candidate_actionability="entry_ready",
                extras={
                    "candidate_role": "pattern_detector",
                    "candidate_actionability": "entry_ready",
                    "fib_levels": result["fib_levels"],
                },
            )
        )

    return candidates
