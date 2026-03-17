#!/usr/bin/env python3
"""
Regime Filter Primitive
=======================
Determines market regime using RDP swing structure (Dow Theory).

Definition:
  - UPTREND   : Higher Highs AND Higher Lows  (HH + HL)
  - DOWNTREND : Lower  Highs AND Lower  Lows  (LH + LL)
  - TRANSITION: Mixed signals (e.g. HH but LL, or LH but HL)

Optionally checks a REFERENCE SYMBOL (e.g. SPY for stocks, BTC for crypto)
instead of the chart symbol itself. This is the correct approach for
index-filtered strategy backtesting.

Usage in composite:
  - reference_symbol: "SPY"  → only trade stocks when SPY is in uptrend
  - reference_symbol: "BTC-USD" → only trade crypto when BTC is in uptrend
  - If reference_symbol is omitted, analyses the current symbol itself.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        'cost_config': spec.get('cost_config') or None,
        'entry_config': spec.get('entry_config') or None,
        'exit_config': spec.get('exit_config') or None,
        'risk_config': spec.get('risk_config') or None,
        'setup_config': spec.get('setup_config') or None,
        'strategy_id': spec.get('strategy_id'),
        'structure_config': spec.get('structure_config') or None,
        'version': spec.get('version'),
    }

    def canonicalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: canonicalize(value[k]) for k in sorted(value.keys())}
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        return value

    json_str = json.dumps(canonicalize(payload), separators=(',', ':'))
    return hashlib.sha256(json_str.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Core regime logic
# ---------------------------------------------------------------------------

def _count_direction(points: list) -> Tuple[int, int]:
    """Count falling vs rising transitions across consecutive swing points."""
    falling, rising = 0, 0
    for i in range(1, len(points)):
        if points[i].price < points[i - 1].price:
            falling += 1
        elif points[i].price > points[i - 1].price:
            rising += 1
    return falling, rising


def _classify_regime_from_swings(
    swing_points: list,
    min_swings: int = 4,
    majority_pct: float = 0.6,
) -> Tuple[str, Dict[str, Any]]:
    """
    Classify regime from RDP swing structure using majority vote.

    Instead of only checking the last 2 highs/lows, counts all
    consecutive falling/rising transitions across the full swing set.
    Requires a clear majority (default 60%) to classify as up or down.

    Returns (regime_label, detail_dict).
    """
    highs = [p for p in swing_points if p.point_type == 'HIGH']
    lows  = [p for p in swing_points if p.point_type == 'LOW']

    h_fall, h_rise = _count_direction(highs)
    l_fall, l_rise = _count_direction(lows)
    h_total = h_fall + h_rise or 1
    l_total = l_fall + l_rise or 1

    detail: Dict[str, Any] = {
        'swing_high_count': len(highs),
        'swing_low_count': len(lows),
        'high_falling': h_fall,
        'high_rising': h_rise,
        'low_falling': l_fall,
        'low_rising': l_rise,
        'high_fall_pct': round(h_fall / h_total, 2),
        'low_fall_pct': round(l_fall / l_total, 2),
        'last_high': round(highs[-1].price, 4) if highs else None,
        'prev_high': round(highs[-2].price, 4) if len(highs) >= 2 else None,
        'last_low':  round(lows[-1].price, 4) if lows else None,
        'prev_low':  round(lows[-2].price, 4) if len(lows) >= 2 else None,
        'hh': highs[-1].price > highs[-2].price if len(highs) >= 2 else None,
        'hl': lows[-1].price > lows[-2].price if len(lows) >= 2 else None,
    }

    if len(highs) < 2 or len(lows) < 2:
        return 'transition', detail

    if len(highs) >= 3 and len(lows) >= 3:
        if (h_fall / h_total >= majority_pct) and (l_fall / l_total >= majority_pct):
            return 'distribution', detail   # structural downtrend
        if (h_rise / h_total >= majority_pct) and (l_rise / l_total >= majority_pct):
            return 'expansion', detail      # structural uptrend
    else:
        if h_fall > h_rise and l_fall > l_rise:
            return 'distribution', detail
        if h_rise > h_fall and l_rise > l_fall:
            return 'expansion', detail

    return 'transition', detail


# ---------------------------------------------------------------------------
# Regime timeline cache — populated once per backtest run, looked up per bar
# ---------------------------------------------------------------------------

# {f"{symbol}_{timeframe}": [(confirmed_date_str, regime_str), ...]}
# Sorted ascending by confirmed_date so binary search / linear scan works.
_REGIME_TIMELINES: Dict[str, List[Tuple[str, str]]] = {}


def _build_regime_timeline(swing_points: list, data: List[OHLCV], majority_pct: float = 0.6) -> List[Tuple[str, str]]:
    """
    Build a (confirmation_date, regime) timeline from RDP swing points.

    A swing is only "known" when it is CONFIRMED (price breaks through the
    subsequent swing to prove the prior swing was real). Using confirmed_by_index
    means we never look ahead — the regime at bar i is determined only by swings
    confirmed on or before bar i.
    """
    highs = sorted([p for p in swing_points if p.point_type == 'HIGH'], key=lambda p: p.index)
    lows  = sorted([p for p in swing_points if p.point_type == 'LOW'],  key=lambda p: p.index)

    # Gather all (confirmation_bar_index, swing_point) events
    events = sorted(
        swing_points,
        key=lambda p: p.confirmed_by_index if p.confirmed_by_index is not None else p.index
    )

    timeline: List[Tuple[str, str]] = []
    for event in events:
        conf_idx = event.confirmed_by_index if event.confirmed_by_index is not None else event.index
        if conf_idx < 0 or conf_idx >= len(data):
            continue
        conf_date = data[conf_idx].timestamp[:10]

        # Highs and lows confirmed on or before this event's confirmation bar
        c_highs = [h for h in highs if (h.confirmed_by_index if h.confirmed_by_index is not None else h.index) <= conf_idx]
        c_lows  = [l for l in lows  if (l.confirmed_by_index if l.confirmed_by_index is not None else l.index) <= conf_idx]

        confirmed_swings = c_highs + c_lows
        regime, _ = _classify_regime_from_swings(confirmed_swings, majority_pct=majority_pct)

        # Only record when regime changes (de-duplicate consecutive same values)
        if not timeline or timeline[-1][1] != regime:
            timeline.append((conf_date, regime))

    return timeline


def precompute_regime_timeline(reference_symbol: str, timeframe: str, epsilon_pct: float = 0.05, majority_pct: float = 0.6) -> None:
    """
    Called ONCE by backtestEngine before the sliding window loop.
    Fetches full history for reference_symbol, runs RDP, and stores the
    confirmation-date regime timeline so the plugin can look it up per bar.
    """
    key = f"{reference_symbol}_{timeframe}"
    if key in _REGIME_TIMELINES:
        return  # already computed for this session

    ref_data = _load_reference_data(reference_symbol, timeframe)
    if not ref_data:
        return

    swing_structure = detect_swings_rdp(ref_data, reference_symbol, timeframe, epsilon_pct=epsilon_pct)
    if not swing_structure or not swing_structure.swing_points:
        return

    _REGIME_TIMELINES[key] = _build_regime_timeline(swing_structure.swing_points, ref_data, majority_pct)


def get_regime_at_date(reference_symbol: str, timeframe: str, cutoff_date: str) -> Optional[str]:
    """
    Look up the market regime on a specific date using only confirmed swings
    that occurred ON OR BEFORE that date. Zero lookahead.
    """
    key = f"{reference_symbol}_{timeframe}"
    timeline = _REGIME_TIMELINES.get(key)
    if not timeline:
        return None

    regime = 'transition'
    for date, r in timeline:
        if date <= cutoff_date:
            regime = r
        else:
            break
    return regime


def _load_reference_data(reference_symbol: str, timeframe: str) -> Optional[List[OHLCV]]:
    """
    Load price data for the reference/benchmark symbol.
    Uses the existing yfinance cache so it's fast on repeat calls.
    """
    try:
        from platform_sdk.ohlcv import fetch_data_yfinance
        interval_map = {
            'W': '1wk', 'D': '1d', '4H': '4h',
            '1H': '1h', 'M': '1mo',
        }
        yf_interval = interval_map.get(timeframe, '1wk')
        return fetch_data_yfinance(reference_symbol, period='max', interval=yf_interval)
    except Exception as e:
        print(f"[RegimeFilter] Could not load reference data for {reference_symbol}: {e}", file=sys.stderr)
        return None


def _swings_up_to_date(swing_points: list, cutoff_date: str) -> list:
    """Filter swing points to only include those on or before cutoff_date."""
    return [p for p in swing_points if p.date <= cutoff_date]


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run_regime_filter_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Regime filter primitive using RDP swing structure.

    setup_config params:
      reference_symbol  : str  — benchmark to check (e.g. "SPY", "BTC-USD").
                                 If omitted, uses the chart symbol's own swings.
      epsilon_pct       : float — RDP sensitivity (default auto-scaled by TF)
      required_regime   : str  — if set, node_result.passed=True ONLY when regime
                                 matches (e.g. "expansion" for longs-only filter)
      majority_pct      : float — fraction of swing transitions that must agree
                                  to classify as up/down (default 0.6 = 60%)
    """
    setup = spec.get('setup_config', {}) if isinstance(spec, dict) else {}

    reference_symbol = setup.get('reference_symbol') or None
    required_regime  = setup.get('required_regime') or None   # e.g. "expansion"
    majority_pct     = float(setup.get('majority_pct', 0.6))

    _EPSILON_BY_TF = {
        'M': 0.08, 'W': 0.05, 'D': 0.03,
        '4H': 0.015, '1H': 0.008,
    }
    default_epsilon = _EPSILON_BY_TF.get(timeframe, 0.03)
    epsilon_pct = float(setup.get('epsilon_pct', default_epsilon))

    # ── Choose data source ────────────────────────────────────────────────────
    # Regime determination needs FULL history — a 2-year scanner window is not
    # enough to establish a proper HH/HL chain. Always fetch max history for
    # the regime symbol, whether it's the chart symbol or a reference benchmark.
    if reference_symbol and reference_symbol.upper() != symbol.upper():
        regime_symbol = reference_symbol
    else:
        regime_symbol = symbol

    ref_data = _load_reference_data(regime_symbol, timeframe)
    if ref_data and len(ref_data) > len(data):
        # Full history available — use it for regime detection
        regime_data = ref_data
    else:
        # Fallback to scanner data if fetch failed or returned less
        regime_data = data

    # ── Determine regime (backtest-safe) ──────────────────────────────────────
    # In a backtest the engine pre-builds the regime timeline before the loop.
    # We look up regime at the current bar's date — zero lookahead.
    # In scan mode the timeline won't exist yet, so we fall back to live RDP.
    cutoff_date = data[-1].timestamp[:10] if data else None
    precomputed = get_regime_at_date(regime_symbol, timeframe, cutoff_date) if cutoff_date else None

    if precomputed is not None:
        current_regime = precomputed
        detail: Dict[str, Any] = {'source': 'precomputed_timeline', 'cutoff_date': cutoff_date}
    else:
        # Scan / live mode: run RDP now
        swing_structure = detect_swings_rdp(regime_data, regime_symbol, timeframe, epsilon_pct=epsilon_pct)
        if swing_structure is None or not swing_structure.swing_points:
            return []
        current_regime, detail = _classify_regime_from_swings(swing_structure.swing_points, majority_pct=majority_pct)
        swing_structure_for_markers = swing_structure

    # ── Determine pass/fail ───────────────────────────────────────────────────
    if required_regime:
        passed = (current_regime == required_regime)
    else:
        passed = (current_regime != 'transition')

    # ── Build visual markers ──────────────────────────────────────────────────
    # All markers MUST use timestamps from `data` (the chart symbol),
    # not from `regime_data` (which may be a different instrument with
    # different bar timestamps that don't exist in the chart series).
    is_intraday = _detect_intraday(data)

    _REGIME_STYLE = {
        'expansion':    {'color': '#22c55e', 'shape': 'arrowUp',   'position': 'belowBar'},
        'distribution': {'color': '#ef4444', 'shape': 'arrowDown', 'position': 'aboveBar'},
        'transition':   {'color': '#9ca3af', 'shape': 'circle',    'position': 'belowBar'},
    }

    markers = []
    zigzag_data = []
    using_self = (regime_symbol.upper() == symbol.upper())

    if using_self and precomputed is None and 'swing_structure_for_markers' in dir():
        highs = [p for p in swing_structure_for_markers.swing_points if p.point_type == 'HIGH']
        lows  = [p for p in swing_structure_for_markers.swing_points if p.point_type == 'LOW']

        for i, h in enumerate(highs):
            if i == 0:
                continue
            is_hh = h.price > highs[i - 1].price
            color = '#22c55e' if is_hh else '#ef4444'
            label = 'HH' if is_hh else 'LH'
            idx = h.index
            if 0 <= idx < len(data):
                t = _format_chart_time(data[idx].timestamp, is_intraday)
                if t:
                    markers.append({'time': t, 'position': 'aboveBar',
                                    'color': color, 'shape': 'circle', 'text': label})

        for i, l in enumerate(lows):
            if i == 0:
                continue
            is_hl = l.price > lows[i - 1].price
            color = '#22c55e' if is_hl else '#ef4444'
            label = 'HL' if is_hl else 'LL'
            idx = l.index
            if 0 <= idx < len(data):
                t = _format_chart_time(data[idx].timestamp, is_intraday)
                if t:
                    markers.append({'time': t, 'position': 'belowBar',
                                    'color': color, 'shape': 'circle', 'text': label})

        # Zigzag line connecting all swing points in chronological order
        all_swings = sorted(swing_structure_for_markers.swing_points, key=lambda p: p.index)
        for sp in all_swings:
            idx = sp.index
            if 0 <= idx < len(data):
                t = _format_chart_time(data[idx].timestamp, is_intraday)
                if t:
                    zigzag_data.append({'time': t, 'value': float(sp.price)})
    # When using a reference_symbol, skip historical swing markers — those
    # timestamps belong to a different instrument and won't align with the
    # chart bars. Only the NOW banner (pinned to last chart bar) is shown.

    # Current regime banner — always pinned to the chart symbol's last bar
    if data:
        style = _REGIME_STYLE.get(current_regime, _REGIME_STYLE['transition'])
        t = _format_chart_time(data[-1].timestamp, is_intraday)
        ref_note = f' via {regime_symbol}' if not using_self else ''
        hh = detail.get('hh')
        hl = detail.get('hl')
        structure_note = ''
        if hh is not None and hl is not None:
            structure_note = f' ({"HH" if hh else "LH"}+{"HL" if hl else "LL"})'
        if t:
            markers.append({
                'time': t,
                'position': style['position'],
                'color': style['color'],
                'shape': style['shape'],
                'text': f"{current_regime.upper()}{ref_note}{structure_note}",
            })

    # ── Build candidate ───────────────────────────────────────────────────────
    spec_hash = spec.get('spec_hash', compute_spec_hash(spec)) if isinstance(spec, dict) else 'unknown'
    svid = (spec.get('strategy_version_id', 'scan_regime_filter_v1') if isinstance(spec, dict) else 'scan_regime_filter_v1')

    is_intraday = _detect_intraday(data)
    chart_data = []
    for bar in data:
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t:
            chart_data.append({
                'time': t, 'open': float(bar.open), 'high': float(bar.high),
                'low': float(bar.low), 'close': float(bar.close),
            })

    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    return [{
        'candidate_id': cid,
        'id': cid,
        'strategy_version_id': svid,
        'spec_hash': spec_hash,
        'symbol': symbol,
        'timeframe': timeframe,
        'score': 0.9 if current_regime == 'expansion' else (0.3 if current_regime == 'distribution' else 0.5),
        'entry_ready': passed,
        'rule_checklist': [
            {'rule_name': 'Regime detected', 'passed': current_regime != 'transition',
             'value': current_regime, 'threshold': 'expansion or distribution'},
            {'rule_name': 'Required regime met', 'passed': passed,
             'value': current_regime, 'threshold': required_regime or 'any'},
        ],
        'anchors': {
            'current_regime': current_regime,
            'reference_symbol': regime_symbol,
            **detail,
        },
        'window_start': window_start,
        'window_end': window_end,
        'pattern_type': 'regime_filter',
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'chart_data': chart_data,
        'visual': {
            'markers': markers,
            'overlay_series': [{
                'title': 'Regime Zigzag',
                'pane': 'overlay',
                'lines': [{
                    'data': zigzag_data,
                    'color': '#f59e0b',
                    'lineWidth': 1,
                    'title': 'Structure',
                }],
            }] if zigzag_data else [],
        },
        'node_result': {
            'passed': passed,
            'score': 0.9 if current_regime == 'expansion' else (0.3 if current_regime == 'distribution' else 0.5),
            'features': {
                'current_regime': current_regime,
                'reference_symbol': regime_symbol,
                **detail,
            },
            'anchors': {'current_regime': current_regime},
            'reason': f'regime_{current_regime}' + (f'_required_{required_regime}' if required_regime else ''),
        },
        'output_ports': {
            'pattern_result': {
                'current_regime': current_regime,
                'reference_symbol': regime_symbol,
                'passed': passed,
                **detail,
            },
        },
    }]
