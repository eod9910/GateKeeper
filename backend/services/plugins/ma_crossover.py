#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time

def compute_spec_hash(spec: Dict[str, Any]) -> str:
    """
    Compute a deterministic SHA-256 hash of the config-relevant fields.
    Must produce the same result as the TypeScript computeSpecHash().
    """
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

def run_ma_crossover_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Detect moving average crossover signals.

    Setup params (from spec.setup_config):
      fast_period:       int   (default 50)  — fast MA period
      slow_period:       int   (default 200) — slow MA period
      ma_type:           str   (default "sma") — "sma" or "ema"
      cross_direction:   str   (default "bullish") — "bullish" or "bearish"
      volume_multiple:   float (default 0.0) — min volume vs 20-bar avg (0 = no filter)
      lookback_bars:     int   (default 10) — only find crosses in last N bars
      trend_filter:      bool  (default False) — require price above slow MA for bullish
      score_min:         float (default 0.0) — minimum score to keep

    Entry params (from spec.entry_config):
      confirmation_bars: int   (default 1) — bars the cross must hold

    Returns list of StrategyCandidate dicts.
    """
    import numpy as np

    setup = spec.get('setup_config', {})
    entry_cfg = spec.get('entry_config', {})
    strategy_version_id = spec.get('strategy_version_id',
                                    f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}")
    spec_hash = spec.get('spec_hash') or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:12]

    # ── Thresholds from spec ─────────────────────────────────────────────
    fast_period     = int(setup.get('fast_period', 50))
    slow_period     = int(setup.get('slow_period', 200))
    ma_type         = str(setup.get('ma_type', 'sma')).strip().lower()
    cross_direction = str(setup.get('cross_direction', 'bullish')).strip().lower()
    volume_multiple = float(setup.get('volume_multiple', 0.0))
    lookback_bars   = int(setup.get('lookback_bars', 10))
    trend_filter    = bool(setup.get('trend_filter', False))
    confirm_bars    = int(entry_cfg.get('confirmation_bars', 1))
    score_min       = float(setup.get('score_min', 0.0))

    if cross_direction not in ('bullish', 'bearish'):
        print(f"[MA Crossover] Unsupported cross_direction '{cross_direction}'. Supported: bullish, bearish", file=sys.stderr)
        return []

    if fast_period >= slow_period:
        print(f"[MA Crossover] fast_period ({fast_period}) must be less than slow_period ({slow_period})", file=sys.stderr)
        return []

    n = len(data)
    if n < slow_period + 5:
        print(f"[MA Crossover] Not enough data: {n} bars, need {slow_period + 5}", file=sys.stderr)
        return []

    # ── Calculate moving averages ────────────────────────────────────────
    closes = np.array([bar.close for bar in data], dtype=float)
    volumes = np.array([bar.volume for bar in data], dtype=float)

    def calc_sma(arr, period):
        if len(arr) < period:
            return np.full_like(arr, np.nan)
        ret = np.cumsum(arr, dtype=float)
        ret[period:] = ret[period:] - ret[:-period]
        out = np.full_like(arr, np.nan)
        out[period - 1:] = ret[period - 1:] / period
        return out

    def calc_ema(arr, period):
        out = np.full_like(arr, np.nan)
        mult = 2.0 / (period + 1)
        # Seed with SMA
        out[period - 1] = np.mean(arr[:period])
        for i in range(period, len(arr)):
            out[i] = (arr[i] - out[i - 1]) * mult + out[i - 1]
        return out

    SUPPORTED_MA_TYPES = {'sma': calc_sma, 'ema': calc_ema}
    if ma_type not in SUPPORTED_MA_TYPES:
        print(f"[MA Crossover] Unsupported ma_type '{ma_type}'. Supported: {list(SUPPORTED_MA_TYPES.keys())}", file=sys.stderr)
        return []
    calc_ma = SUPPORTED_MA_TYPES[ma_type]

    fast_ma = calc_ma(closes, fast_period)
    slow_ma = calc_ma(closes, slow_period)
    vol_avg = calc_sma(volumes, 20)

    # ── Detect crossovers ────────────────────────────────────────────────
    candidates = []
    search_start = max(slow_period, n - lookback_bars) if lookback_bars > 0 else slow_period

    for i in range(search_start, n):
        if np.isnan(fast_ma[i]) or np.isnan(slow_ma[i]):
            continue
        if np.isnan(fast_ma[i - 1]) or np.isnan(slow_ma[i - 1]):
            continue

        # Check for crossover
        if cross_direction == 'bullish':
            crossed = (fast_ma[i] > slow_ma[i]) and (fast_ma[i - 1] <= slow_ma[i - 1])
        else:
            crossed = (fast_ma[i] < slow_ma[i]) and (fast_ma[i - 1] >= slow_ma[i - 1])

        if not crossed:
            continue

        # ── Build rule checklist ─────────────────────────────────────────
        rules = []

        # Rule 1: Cross detected
        rules.append({
            'rule_name': f'{fast_period}/{slow_period} {"Golden" if cross_direction == "bullish" else "Death"} Cross',
            'passed': True,
            'value': f'fast={fast_ma[i]:.2f}, slow={slow_ma[i]:.2f}',
            'threshold': f'{ma_type.upper()} {fast_period} crosses {"above" if cross_direction == "bullish" else "below"} {slow_period}'
        })

        # Rule 2: Confirmation bars
        confirmed = True
        if confirm_bars > 0 and i + confirm_bars < n:
            for j in range(1, confirm_bars + 1):
                if cross_direction == 'bullish':
                    if fast_ma[i + j] <= slow_ma[i + j]:
                        confirmed = False
                        break
                else:
                    if fast_ma[i + j] >= slow_ma[i + j]:
                        confirmed = False
                        break
        elif i + confirm_bars >= n:
            confirmed = False  # Not enough bars to confirm yet

        rules.append({
            'rule_name': f'Confirmation ({confirm_bars} bars)',
            'passed': bool(confirmed),
            'value': str(confirmed),
            'threshold': f'Cross holds for {confirm_bars} bar(s)'
        })

        # Rule 3: Volume filter (optional)
        vol_ok = True
        vol_ratio = 0.0
        if volume_multiple > 0 and not np.isnan(vol_avg[i]) and vol_avg[i] > 0:
            vol_ratio = float(volumes[i] / vol_avg[i])
            vol_ok = bool(vol_ratio >= volume_multiple)
        rules.append({
            'rule_name': 'Volume Confirmation',
            'passed': bool(vol_ok) if volume_multiple > 0 else True,
            'value': f'{vol_ratio:.1f}x avg' if volume_multiple > 0 else 'No filter',
            'threshold': f'>= {volume_multiple}x 20-bar avg' if volume_multiple > 0 else 'Disabled'
        })

        # Rule 4: Trend filter (optional)
        trend_ok = True
        if trend_filter:
            if cross_direction == 'bullish':
                trend_ok = bool(closes[i] > slow_ma[i])
            else:
                trend_ok = bool(closes[i] < slow_ma[i])
        rules.append({
            'rule_name': 'Trend Alignment',
            'passed': bool(trend_ok) if trend_filter else True,
            'value': f'Price {"above" if closes[i] > slow_ma[i] else "below"} {slow_period} MA',
            'threshold': f'Price {"above" if cross_direction == "bullish" else "below"} slow MA' if trend_filter else 'Disabled'
        })

        # Rule 5: MA separation (how decisive is the cross)
        ma_gap_pct = float(abs(fast_ma[i] - slow_ma[i]) / slow_ma[i] * 100) if slow_ma[i] > 0 else 0.0
        rules.append({
            'rule_name': 'MA Separation',
            'passed': True,  # informational
            'value': f'{ma_gap_pct:.2f}%',
            'threshold': 'Larger = more decisive cross'
        })

        # ── Score ────────────────────────────────────────────────────────
        all_passed = all(r['passed'] for r in rules)
        score = 0.0
        if all_passed:
            # Score based on: confirmation (0.4) + volume strength (0.3) + MA separation (0.3)
            score += 0.4 if confirmed else 0.0
            score += min(0.3, (vol_ratio / 3.0) * 0.3) if volume_multiple > 0 and vol_ratio > 0 else 0.15
            score += min(0.3, (ma_gap_pct / 2.0) * 0.3)

        if score < score_min:
            continue

        # ── Entry readiness ──────────────────────────────────────────────
        entry_ready = all_passed and confirmed

        # ── Anchors ──────────────────────────────────────────────────────
        cross_bar = data[i]
        anchors = {
            'cross_bar': {'index': i, 'price': float(cross_bar.close), 'date': cross_bar.timestamp},
            'fast_ma_at_cross': float(fast_ma[i]),
            'slow_ma_at_cross': float(slow_ma[i]),
        }

        # Find recent swing low for stop placement
        recent_low_price = min(bar.low for bar in data[max(0, i - 20):i + 1])
        recent_low_idx = next(
            j for j in range(max(0, i - 20), i + 1) if data[j].low == recent_low_price
        )
        anchors['recent_swing_low'] = {
            'index': int(recent_low_idx),
            'price': float(recent_low_price),
            'date': data[recent_low_idx].timestamp
        }

        # ── Chart data ───────────────────────────────────────────────────
        chart_start = max(0, i - slow_period - 20)
        is_intraday = _detect_intraday(data)
        chart_data = []
        fast_overlay_data = []
        slow_overlay_data = []
        for j in range(chart_start, min(n, i + 20)):
            bar = data[j]
            t = _format_chart_time(bar.timestamp, is_intraday)
            if t is None:
                continue
            chart_data.append({
                'time': t,
                'open': float(bar.open),
                'high': float(bar.high),
                'low': float(bar.low),
                'close': float(bar.close),
                'volume': float(bar.volume),
                'fast_ma': round(float(fast_ma[j]), 4) if not np.isnan(fast_ma[j]) else None,
                'slow_ma': round(float(slow_ma[j]), 4) if not np.isnan(slow_ma[j]) else None,
            })
            # Build overlay line data using the same time reference
            if not np.isnan(fast_ma[j]):
                fast_overlay_data.append({'time': t, 'value': round(float(fast_ma[j]), 4)})
            if not np.isnan(slow_ma[j]):
                slow_overlay_data.append({'time': t, 'value': round(float(slow_ma[j]), 4)})

        overlays = [
            {
                'type': 'line',
                'label': f'{ma_type.upper()} {fast_period}',
                'color': '#FF6B00',   # Orange for fast MA
                'lineWidth': 2,
                'data': fast_overlay_data,
            },
            {
                'type': 'line',
                'label': f'{ma_type.upper()} {slow_period}',
                'color': '#2962FF',   # Blue for slow MA
                'lineWidth': 2,
                'data': slow_overlay_data,
            },
        ]

        # ── Build candidate ──────────────────────────────────────────────
        candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash_short}_{chart_start}_{min(n - 1, i + 20)}"

        candidates.append({
            'candidate_id': candidate_id,
            'id': candidate_id,
            'strategy_version_id': strategy_version_id,
            'spec_hash': spec_hash,
            'symbol': symbol,
            'timeframe': timeframe,
            'score': round(float(score), 3),
            'entry_ready': bool(entry_ready),
            'rule_checklist': rules,
            'anchors': anchors,
            'window_start': chart_start,
            'window_end': min(n - 1, i + 20),
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'chart_data': chart_data,
            'overlays': overlays,
            'pattern_type': setup.get('pattern_type', 'ma_crossover'),
            'node_result': {
                'passed': bool(entry_ready),
                'score': round(float(score), 3),
                'features': {
                    'fast_period': int(fast_period),
                    'slow_period': int(slow_period),
                    'ma_type': ma_type,
                    'cross_direction': cross_direction,
                    'ma_gap_pct': round(float(ma_gap_pct), 2),
                    'confirmed': bool(confirmed),
                },
                'anchors': anchors,
                'reason': 'cross_confirmed' if entry_ready else 'cross_not_confirmed',
            },
            'cross_bar_index': i,
            'cross_price': float(cross_bar.close),
            'cross_date': cross_bar.timestamp,
            'fast_period': int(fast_period),
            'slow_period': int(slow_period),
            'output_ports': {
                'signal': {
                    'passed': bool(entry_ready),
                    'score': round(float(score), 3),
                    'reason': 'cross_confirmed' if entry_ready else 'cross_not_confirmed',
                },
            },
        })

    print(f"[MA Crossover] Found {len(candidates)} crossover signals for {symbol}", file=sys.stderr)
    return candidates

