#!/usr/bin/env python3
"""
Strategy Runner — General-purpose hypothesis scanner.

Accepts a StrategySpec JSON, runs the specified plugin against OHLCV data,
and returns standardized candidates with rule-checklists + scores + anchors.

Usage:
  python strategyRunner.py --spec <path_to_spec.json> --symbol SYMBOL [--mode scan|backtest]
  python strategyRunner.py --spec-stdin --symbol SYMBOL   (reads spec from stdin)

Output: JSON array of StrategyCandidate objects to stdout.
"""

import argparse
import hashlib
import json
import sys
import os
from datetime import datetime

# Set RUNNER_DEBUG=1 to enable per-call verbose logging. Off by default to
# avoid flooding the terminal during backtest sliding-window iterations.
_RUNNER_DEBUG = os.environ.get("RUNNER_DEBUG", "").lower() in ("1", "true", "yes")
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple, Callable

# ── Import from the existing scanner ─────────────────────────────────────────
# patternScanner.py lives in the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
PATTERNS_DIR = os.path.normpath(os.path.join(SERVICES_DIR, '..', 'data', 'patterns'))
REGISTRY_FILE = os.path.join(PATTERNS_DIR, 'registry.json')

from platform_sdk.ohlcv import OHLCV, fetch_data_yfinance, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp
from platform_sdk.swing_structure import (
    ConfirmedSwingPoint,
    SwingStructure,
    detect_swing_points_with_fallback,
    serialize_swing_structure,
    _linear_regression_slope,
    detect_regime_windows,
    find_major_peaks,
)
from platform_sdk.energy import (
    EnergyState,
    SellingPressure,
    calculate_selling_pressure,
    calculate_buying_pressure,
    calculate_energy_state,
)
from platform_sdk.fib_analysis import FibonacciLevel, FibEnergySignal
from platform_sdk.copilot import (
    Base,
    Markup,
    Pullback,
    WyckoffPattern,
    detect_wyckoff_patterns,
    serialize_wyckoff_pattern,
    detect_accumulation_bases,
    detect_markup,
    detect_second_pullback,
    scan_discount_zone,
)


# ─────────────────────────────────────────────────────────────────────────────
# Spec Hash (mirrors TypeScript computeSpecHash)
# ─────────────────────────────────────────────────────────────────────────────

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


def _is_within(base_dir: str, target_path: str) -> bool:
    rel = os.path.relpath(target_path, base_dir)
    return rel == '.' or (not rel.startswith('..') and not os.path.isabs(rel))


# Runtime-injected plugin overrides (used by /api/plugins/test harness).
PLUGINS: Dict[str, Callable[..., List[Dict[str, Any]]]] = {}
_PLUGIN_FN_CACHE: Dict[str, Dict[str, Any]] = {}


def _resolve_plugin_from_registry(pattern_type: str) -> Optional[Callable[..., List[Dict[str, Any]]]]:
    """
    Resolve plugin callable from registry definition and load it from plugin_file.
    """
    if not pattern_type:
        return None

    try:
        if not os.path.exists(REGISTRY_FILE):
            return None

        with open(REGISTRY_FILE, 'r', encoding='utf-8-sig') as f:
            registry = json.load(f)

        patterns = registry.get('patterns', []) if isinstance(registry, dict) else []
        entry = None
        for p in patterns:
            if isinstance(p, dict) and str(p.get('pattern_id', '')).strip() == pattern_type:
                entry = p
                break
        if not entry:
            return None

        definition_file = str(entry.get('definition_file', '')).strip()
        if not definition_file:
            return None
        definition_path = os.path.join(PATTERNS_DIR, definition_file)
        if not os.path.exists(definition_path):
            return None

        with open(definition_path, 'r', encoding='utf-8-sig') as f:
            definition = json.load(f)
        if not isinstance(definition, dict):
            return None

        plugin_file = str(definition.get('plugin_file', '')).strip().replace('\\', '/')
        plugin_function = str(definition.get('plugin_function', '')).strip() or f'run_{pattern_type}_plugin'
        if not plugin_file:
            return None

        if os.path.isabs(plugin_file):
            plugin_path = os.path.normpath(plugin_file)
        else:
            plugin_path = os.path.normpath(os.path.join(SERVICES_DIR, plugin_file))

        if not _is_within(SERVICES_DIR, plugin_path):
            print(f"[Runner] ERROR: Refusing plugin path outside services dir: {plugin_path}", file=sys.stderr)
            return None
        if not os.path.exists(plugin_path):
            print(f"[Runner] ERROR: Plugin file not found: {plugin_path}", file=sys.stderr)
            return None

        plugin_dir = os.path.dirname(plugin_path)
        if plugin_dir and plugin_dir not in sys.path:
            # Allow plugin files to import sibling plugin modules (e.g. composite_runner).
            sys.path.insert(0, plugin_dir)

        mtime = os.path.getmtime(plugin_path)
        cache_key = f"{pattern_type}::{plugin_path}::{plugin_function}"
        cached = _PLUGIN_FN_CACHE.get(cache_key)
        if cached and cached.get('mtime') == mtime and callable(cached.get('fn')):
            return cached['fn']

        with open(plugin_path, 'r', encoding='utf-8') as f:
            source = f.read()

        plugin_globals: Dict[str, Any] = {
            '__name__': f'plugin_{pattern_type}',
            '__file__': plugin_path,
            '__package__': None,
            # Common typing/runtime symbols for AI-generated plugins that
            # use annotations without explicit imports.
            'Any': Any,
            'Dict': Dict,
            'List': List,
            'Optional': Optional,
            'Tuple': Tuple,
            'Callable': Callable,
            'OHLCV': OHLCV,
        }
        if 'StructureExtraction' in globals():
            plugin_globals['StructureExtraction'] = globals()['StructureExtraction']
        exec(compile(source, plugin_path, 'exec'), plugin_globals)

        fn = plugin_globals.get(plugin_function)
        if not callable(fn):
            fallback_name = f'run_{pattern_type}_plugin'
            fn = plugin_globals.get(fallback_name)
        if not callable(fn):
            # Last fallback: first run_*_plugin callable in file.
            for k, v in plugin_globals.items():
                if callable(v) and k.startswith('run_') and k.endswith('_plugin'):
                    fn = v
                    break
        if not callable(fn):
            print(f"[Runner] ERROR: Plugin function not found in {plugin_path}: {plugin_function}", file=sys.stderr)
            return None

        _PLUGIN_FN_CACHE[cache_key] = {'mtime': mtime, 'fn': fn}
        return fn
    except Exception as e:
        print(f"[Runner] ERROR: Failed loading plugin '{pattern_type}' from registry: {e}", file=sys.stderr)
        return None


_INDICATOR_ROLE_CACHE: Dict[str, str] = {}

def _lookup_indicator_role(pattern_type: str) -> str:
    """Look up indicator_role from the pattern's JSON definition in the registry."""
    if not pattern_type:
        return ''
    if pattern_type in _INDICATOR_ROLE_CACHE:
        return _INDICATOR_ROLE_CACHE[pattern_type]
    try:
        if not os.path.exists(REGISTRY_FILE):
            return ''
        with open(REGISTRY_FILE, 'r', encoding='utf-8-sig') as f:
            registry = json.load(f)
        patterns = registry.get('patterns', []) if isinstance(registry, dict) else []
        for p in patterns:
            if isinstance(p, dict) and str(p.get('pattern_id', '')).strip() == pattern_type:
                def_file = str(p.get('definition_file', '')).strip()
                if def_file:
                    def_path = os.path.join(PATTERNS_DIR, def_file)
                    if os.path.exists(def_path):
                        with open(def_path, 'r', encoding='utf-8-sig') as df:
                            defn = json.load(df)
                        role = str(defn.get('indicator_role', '')).strip().lower()
                        _INDICATOR_ROLE_CACHE[pattern_type] = role
                        return role
                break
    except Exception:
        pass
    _INDICATOR_ROLE_CACHE[pattern_type] = ''
    return ''


# ─────────────────────────────────────────────────────────────────────────────
# Structure Extraction  (shared across all plugins)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class StructureExtraction:
    """Standardized structure output usable by any pattern plugin."""
    pivots: List[Dict[str, Any]]       # [{index, price, date, type}]
    bases: List[Dict[str, Any]]        # [{start_index, end_index, high, low, height, duration, ...}]
    trend: str                         # UPTREND / DOWNTREND / SIDEWAYS


def extract_structure(data: List[OHLCV], structure_config: Dict[str, Any],
                      symbol: str = "UNKNOWN", timeframe: str = "W") -> StructureExtraction:
    """
    Extract shared structure (pivots + bases) from OHLCV data
    using the config from a StrategySpec.structure_config.

    LOOKAHEAD NOTE:
    This extractor operates on whatever data slice is passed in.
    For causal backtesting, caller must pass prefix bars (bars[0..t]) only.
    """
    causal = structure_config.get('causal', False)
    if causal and len(data) < 2:
        return StructureExtraction(pivots=[], bases=[], trend='SIDEWAYS')

    method = structure_config.get('swing_method', 'major')
    epsilon = structure_config.get('swing_epsilon_pct', 0.05)

    # ── Swing detection ──────────────────────────────────────────────────
    if method == 'rdp':
        swing_struct = detect_swings_rdp(
            data,
            symbol=symbol,
            timeframe=timeframe,
            epsilon_pct=epsilon
        )
    elif method == 'major':
        swing_struct = detect_swing_points_with_fallback(
            data,
            symbol=symbol,
            timeframe=timeframe,
            first_peak_decline=structure_config.get('swing_first_peak_decline', 0.50),
            relative_threshold=structure_config.get('swing_subsequent_decline', 0.25),
            epsilon_pct=epsilon
        )
    else:
        # fallback chain
        swing_struct = detect_swing_points_with_fallback(
            data, symbol=symbol, timeframe=timeframe, epsilon_pct=epsilon
        )

    # Serialize pivots
    pivots = []
    for sp in swing_struct.swing_points:
        pivots.append({
            'index': sp.index,
            'price': sp.price,
            'date': sp.date,
            'type': sp.point_type,
        })

    # Derive trend from swing structure
    trend = _classify_trend(swing_struct)

    # ── Base detection ───────────────────────────────────────────────────
    bases = []
    if structure_config.get('extract_bases', False):
        raw_bases = detect_accumulation_bases(
            data,
            min_duration=structure_config.get('base_min_duration', 15),
            max_duration=structure_config.get('base_max_duration', 500),
            max_range_pct=structure_config.get('base_max_range_pct', 0.80),
            volatility_threshold=structure_config.get('base_volatility_threshold', 0.10),
        )

        for b in raw_bases:
            bases.append({
                'start_index': b.start_index,
                'end_index': b.end_index,
                'high': b.high,
                'low': b.low,
                'height': b.height,
                'duration': b.duration,
                'start_date': b.start_date,
                'end_date': b.end_date,
            })

    return StructureExtraction(pivots=pivots, bases=bases, trend=trend)


def _classify_trend(swing: SwingStructure) -> str:
    """Classify trend from swing points (last 3 highs + lows)."""
    highs = [sp for sp in swing.swing_points if sp.point_type == 'HIGH']
    lows  = [sp for sp in swing.swing_points if sp.point_type == 'LOW']

    hh = ll = hl = lh = 0
    for i in range(1, min(4, len(highs))):
        if highs[i].price > highs[i - 1].price: hh += 1
        else: lh += 1
    for i in range(1, min(4, len(lows))):
        if lows[i].price > lows[i - 1].price: hl += 1
        else: ll += 1

    up = hh + hl
    down = ll + lh
    if up >= 3:
        return 'UPTREND'
    elif down >= 3:
        return 'DOWNTREND'
    return 'SIDEWAYS'


# ─────────────────────────────────────────────────────────────────────────────
# Wyckoff Accumulation Plugin
# ─────────────────────────────────────────────────────────────────────────────

def run_wyckoff_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Detect Wyckoff accumulation patterns.
    All thresholds come from spec.setup_config and spec.entry_config.
    Returns list of StrategyCandidate dicts.
    """
    setup = spec.get('setup_config', {})
    entry_cfg = spec.get('entry_config', {})
    struct_cfg = spec.get('structure_config', {})
    strategy_version_id = spec.get('strategy_version_id',
                                    f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}")

    # spec_hash: use pre-computed from spec, or compute on the fly
    spec_hash = spec.get('spec_hash') or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:12]   # short prefix for candidate_id

    # ── Thresholds from spec ─────────────────────────────────────────────
    min_prominence      = setup.get('min_prominence', 0.20)
    peak_lookback       = setup.get('peak_lookback', 50)
    min_markdown_pct    = setup.get('min_markdown_pct', 0.70)
    markdown_lookback   = setup.get('markdown_lookback', 300)
    # base_min_duration: CANONICAL location is structure_config, NOT setup_config
    base_min_dur        = struct_cfg.get('base_min_duration', 20)
    base_res_closes     = setup.get('base_resistance_closes', 3)
    mkp_lookforward     = setup.get('markup_lookforward', 100)
    mkp_min_bars        = setup.get('markup_min_breakout_bars', 2)
    pb_lookforward      = setup.get('pullback_lookforward', 200)
    pb_ret_min          = setup.get('pullback_retracement_min', 0.30)
    pb_ret_max          = setup.get('pullback_retracement_max', 5.0)
    dbl_bottom_tol      = setup.get('double_bottom_tolerance', 1.05)
    brk_mult            = setup.get('breakout_multiplier', 1.02)
    brk_pct             = entry_cfg.get('breakout_pct_above', 0.02)
    confirm_bars        = entry_cfg.get('confirmation_bars', 1)
    score_min           = setup.get('score_min', 0.0)

    n = len(data)
    candidates = []

    # Step 1: Find major peaks
    peaks = find_major_peaks(data, min_prominence=min_prominence, lookback=peak_lookback)
    print(f"[Runner] Found {len(peaks)} peaks (prominence >= {min_prominence})", file=sys.stderr)

    for peak_idx, peak_price in peaks:
        rules = []
        anchors = {}

        # ── Phase 1: Prior Peak ──────────────────────────────────────────
        anchors['prior_peak'] = {
            'index': peak_idx,
            'price': round(peak_price, 4),
            'date': data[peak_idx].timestamp[:10] if peak_idx < n else ''
        }

        # ── Phase 2: Markdown ────────────────────────────────────────────
        search_end = min(peak_idx + markdown_lookback, n)
        if search_end <= peak_idx:
            continue

        md_low_idx = peak_idx
        md_low_price = data[peak_idx].low
        for i in range(peak_idx + 1, search_end):
            if data[i].low < md_low_price:
                md_low_price = data[i].low
                md_low_idx = i

        if peak_price <= 0:
            continue
        decline_pct = (peak_price - md_low_price) / peak_price

        rules.append({
            'rule_name': 'markdown_decline',
            'passed': decline_pct >= min_markdown_pct,
            'value': round(decline_pct, 4),
            'threshold': min_markdown_pct
        })
        if decline_pct < min_markdown_pct:
            continue

        anchors['markdown_low'] = {
            'index': md_low_idx,
            'price': round(md_low_price, 4),
            'date': data[md_low_idx].timestamp[:10] if md_low_idx < n else ''
        }

        # ── Phase 3: Base ────────────────────────────────────────────────
        # Find the best base starting near the markdown low
        best_base = None
        best_base_dur = 0

        for b_info in structure.bases:
            b_start = b_info['start_index']
            b_end   = b_info['end_index']
            # Base must start near or after the markdown low
            if b_start < md_low_idx - 20:
                continue
            if b_start > md_low_idx + 50:
                continue
            if b_info['duration'] < base_min_dur:
                continue
            if b_info['duration'] > best_base_dur:
                best_base = b_info
                best_base_dur = b_info['duration']

        # If no pre-computed base found, try to find one from the markdown low
        if best_base is None:
            local_bases = detect_accumulation_bases(
                data[md_low_idx:min(md_low_idx + 600, n)],
                min_duration=base_min_dur,
                max_duration=500,
                max_range_pct=0.80,
                volatility_threshold=0.10,
            )
            if local_bases:
                b = local_bases[0]
                best_base = {
                    'start_index': b.start_index + md_low_idx,
                    'end_index': b.end_index + md_low_idx,
                    'high': b.high,
                    'low': b.low,
                    'height': b.height,
                    'duration': b.duration,
                    'start_date': b.start_date,
                    'end_date': b.end_date,
                }

        rules.append({
            'rule_name': 'base_found',
            'passed': best_base is not None,
            'value': best_base_dur if best_base else 0,
            'threshold': base_min_dur
        })
        if best_base is None:
            continue

        base_obj = Base(
            start_index=best_base['start_index'],
            end_index=best_base['end_index'],
            low=best_base['low'],
            high=best_base['high'],
            height=best_base['height'],
            duration=best_base['duration'],
            start_date=best_base.get('start_date', ''),
            end_date=best_base.get('end_date', '')
        )

        rules.append({
            'rule_name': 'base_duration',
            'passed': base_obj.duration >= base_min_dur,
            'value': base_obj.duration,
            'threshold': base_min_dur
        })

        anchors['base_start'] = {
            'index': base_obj.start_index,
            'price': round(base_obj.low, 4),
            'date': best_base.get('start_date', '')
        }
        anchors['base_end'] = {
            'index': base_obj.end_index,
            'price': round(base_obj.high, 4),
            'date': best_base.get('end_date', '')
        }
        anchors['base_low'] = round(base_obj.low, 4)
        anchors['base_high'] = round(base_obj.high, 4)

        # ── Phase 4: First Markup ────────────────────────────────────────
        markup = detect_markup(
            data, base_obj,
            min_breakout_bars=mkp_min_bars,
            lookforward=mkp_lookforward
        )

        rules.append({
            'rule_name': 'markup_breakout',
            'passed': markup is not None,
            'value': round(markup.high, 4) if markup else None,
            'threshold': round(base_obj.high, 4)
        })
        if markup is None:
            continue

        anchors['markup_high'] = {
            'index': markup.high_index if markup.high_index else markup.breakout_index,
            'price': round(markup.high, 4),
            'date': markup.high_date or markup.breakout_date
        }

        # ── Phase 5: Pullback ────────────────────────────────────────────
        pullback = detect_second_pullback(
            data, base_obj, markup,
            min_retracement=pb_ret_min,
            max_retracement=pb_ret_max,
            lookforward=pb_lookforward
        )

        rules.append({
            'rule_name': 'pullback_found',
            'passed': pullback is not None,
            'value': round(pullback.retracement, 4) if pullback else None,
            'threshold': [pb_ret_min, pb_ret_max]
        })
        if pullback is None:
            continue

        is_double_bottom = pullback.low <= base_obj.low * dbl_bottom_tol
        rules.append({
            'rule_name': 'pullback_retracement',
            'passed': pb_ret_min <= pullback.retracement <= pb_ret_max,
            'value': round(pullback.retracement, 4),
            'threshold': [pb_ret_min, pb_ret_max]
        })
        rules.append({
            'rule_name': 'double_bottom',
            'passed': is_double_bottom,
            'value': round(pullback.low, 4),
            'threshold': round(base_obj.low * dbl_bottom_tol, 4)
        })

        anchors['pullback_low'] = {
            'index': pullback.low_index,
            'price': round(pullback.low, 4),
            'date': pullback.low_date
        }

        # ── Phase 6: Second Breakout ─────────────────────────────────────
        breakout_level = base_obj.high * brk_mult
        brk_idx = None
        brk_price = None
        brk_date = ''

        search_start = pullback.low_index + 1
        for i in range(search_start, min(search_start + pb_lookforward, n)):
            if data[i].close > breakout_level:
                # Confirmation: next bar must hold above base_high
                if confirm_bars >= 1 and i + 1 < n:
                    if data[i + 1].close > base_obj.high:
                        brk_idx = i
                        brk_price = data[i].close
                        brk_date = data[i].timestamp[:10]
                        break
                else:
                    brk_idx = i
                    brk_price = data[i].close
                    brk_date = data[i].timestamp[:10]
                    break

        rules.append({
            'rule_name': 'second_breakout',
            'passed': brk_idx is not None,
            'value': round(brk_price, 4) if brk_price else None,
            'threshold': round(breakout_level, 4)
        })
        if brk_idx is None:
            continue

        # Entry-ready = breakout happened AND confirmation held
        entry_ready = True

        anchors['second_breakout'] = {
            'index': brk_idx,
            'price': round(brk_price, 4),
            'date': brk_date
        }

        # ── Scoring ──────────────────────────────────────────────────────
        score = _score_wyckoff(
            pullback.retracement, is_double_bottom,
            base_obj.duration, decline_pct
        )

        rules.append({
            'rule_name': 'score_above_min',
            'passed': score >= score_min,
            'value': round(score, 4),
            'threshold': score_min
        })
        if score < score_min:
            continue

        # ── Build chart data ─────────────────────────────────────────────
        is_intraday = _detect_intraday(data)
        chart_data = []
        for bar in data:
            t = _format_chart_time(bar.timestamp, is_intraday)
            if t is not None:
                chart_data.append({
                    'time': t,
                    'open': float(bar.open),
                    'high': float(bar.high),
                    'low': float(bar.low),
                    'close': float(bar.close)
                })

        # ── Assemble candidate ───────────────────────────────────────────
        # candidate_id includes spec_hash_short to prevent ID collision
        # if a spec is ever (incorrectly) edited in place
        cid = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash_short}_{peak_idx}_{brk_idx}"

        candidate = {
            'candidate_id': cid,
            'id': cid,                          # alias for legacy compat
            'strategy_version_id': strategy_version_id,
            'spec_hash': spec_hash,
            'symbol': symbol,
            'timeframe': timeframe,
            'score': round(score, 4),
            'entry_ready': entry_ready,
            'rule_checklist': rules,
            'anchors': anchors,
            'window_start': peak_idx,
            'window_end': brk_idx,
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'chart_data': chart_data,

            # Legacy compat fields for existing frontend
            'pattern_type': 'wyckoff',
            'prior_peak': anchors.get('prior_peak'),
            'markdown': {
                'low_index': md_low_idx,
                'low_price': round(md_low_price, 4),
                'decline_pct': round(decline_pct, 4)
            },
            'base': asdict(base_obj),
            'first_markup': {
                'index': markup.high_index or markup.breakout_index,
                'high': round(markup.high, 4),
                'date': markup.high_date or markup.breakout_date
            },
            'small_peak': {
                'index': markup.high_index or markup.breakout_index,
                'price': round(markup.high, 4),
                'date': markup.high_date or markup.breakout_date
            },
            'pullback': {
                'low_index': pullback.low_index,
                'low_price': round(pullback.low, 4),
                'retracement': round(pullback.retracement, 4),
                'retracement_pct': f"{pullback.retracement * 100:.0f}%",
                'date': pullback.low_date,
                'is_double_bottom': is_double_bottom
            },
            'second_breakout': anchors.get('second_breakout'),
            'retracement_pct': round(pullback.retracement * 100, 1),

            # Chart index helpers (indices relative to start of chart_data, which is 0)
            'chart_prior_peak': peak_idx,
            'chart_markdown_low': md_low_idx,
            'chart_base_start': base_obj.start_index,
            'chart_base_end': base_obj.end_index,
            'chart_first_markup': markup.high_index or markup.breakout_index,
            'chart_markup_high': markup.high_index or markup.breakout_index,
            'chart_pullback_low': pullback.low_index,
            'chart_second_breakout': brk_idx,
            'pattern_start_date': data[peak_idx].timestamp[:10] if peak_idx < n else '',
            'pattern_end_date': brk_date,
        }

        candidates.append(candidate)

    # De-duplicate by breakout index (keep highest score)
    seen_breakouts = {}
    for c in candidates:
        bk = c['window_end']
        if bk not in seen_breakouts or c['score'] > seen_breakouts[bk]['score']:
            seen_breakouts[bk] = c

    deduped = sorted(seen_breakouts.values(), key=lambda c: c['score'], reverse=True)
    if _RUNNER_DEBUG: print(f"[Runner] {len(candidates)} raw -> {len(deduped)} deduplicated candidates", file=sys.stderr)
    return deduped


def _score_wyckoff(retracement: float, is_double_bottom: bool,
                   base_duration: int, decline_pct: float) -> float:
    """
    Score a Wyckoff pattern (0.0 - 1.0).
    Same logic as the original scanner but extracted for clarity.
    """
    score = 0.0

    # Pullback quality (max 0.40)
    if 0.70 <= retracement <= 0.79:
        score += 0.40
    elif 0.50 <= retracement < 0.70:
        score += 0.30
    elif 0.30 <= retracement < 0.50:
        score += 0.15
    elif 0.79 < retracement <= 1.05:
        score += 0.35
    elif retracement > 1.05:
        score += 0.20

    # Double bottom bonus (max 0.25)
    if is_double_bottom:
        score += 0.25

    # Base duration (max 0.20)
    if base_duration >= 100:
        score += 0.20
    elif base_duration >= 50:
        score += 0.10

    # Markdown quality (max 0.20)
    if decline_pct >= 0.80:
        score += 0.20
    elif decline_pct >= 0.70:
        score += 0.15

    return min(score, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Plugin: Moving Average Crossover
# ─────────────────────────────────────────────────────────────────────────────

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
    ma_type         = setup.get('ma_type', 'sma')
    cross_direction = setup.get('cross_direction', 'bullish')
    volume_multiple = float(setup.get('volume_multiple', 0.0))
    lookback_bars   = int(setup.get('lookback_bars', 10))
    trend_filter    = bool(setup.get('trend_filter', False))
    confirm_bars    = int(entry_cfg.get('confirmation_bars', 1))
    score_min       = float(setup.get('score_min', 0.0))

    n = len(data)
    if n < slow_period + 5:
        print(f"[MA Crossover] Not enough data: {n} bars, need {slow_period + 5}", file=sys.stderr)
        return []

    # ── Calculate moving averages ────────────────────────────────────────
    closes = np.array([bar.close for bar in data], dtype=float)
    volumes = np.array([bar.volume for bar in data], dtype=float)

    def calc_sma(arr, period):
        out = np.full_like(arr, np.nan)
        for i in range(period - 1, len(arr)):
            out[i] = np.mean(arr[i - period + 1:i + 1])
        return out

    def calc_ema(arr, period):
        out = np.full_like(arr, np.nan)
        mult = 2.0 / (period + 1)
        # Seed with SMA
        out[period - 1] = np.mean(arr[:period])
        for i in range(period, len(arr)):
            out[i] = (arr[i] - out[i - 1]) * mult + out[i - 1]
        return out

    calc_ma = calc_ema if ma_type == 'ema' else calc_sma

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
            vol_ratio = volumes[i] / vol_avg[i]
            vol_ok = vol_ratio >= volume_multiple
        rules.append({
            'rule_name': 'Volume Confirmation',
            'passed': vol_ok if volume_multiple > 0 else True,
            'value': f'{vol_ratio:.1f}x avg' if volume_multiple > 0 else 'No filter',
            'threshold': f'>= {volume_multiple}x 20-bar avg' if volume_multiple > 0 else 'Disabled'
        })

        # Rule 4: Trend filter (optional)
        trend_ok = True
        if trend_filter:
            if cross_direction == 'bullish':
                trend_ok = closes[i] > slow_ma[i]
            else:
                trend_ok = closes[i] < slow_ma[i]
        rules.append({
            'rule_name': 'Trend Alignment',
            'passed': trend_ok if trend_filter else True,
            'value': f'Price {"above" if closes[i] > slow_ma[i] else "below"} {slow_period} MA',
            'threshold': f'Price {"above" if cross_direction == "bullish" else "below"} slow MA' if trend_filter else 'Disabled'
        })

        # Rule 5: MA separation (how decisive is the cross)
        ma_gap_pct = abs(fast_ma[i] - slow_ma[i]) / slow_ma[i] * 100 if slow_ma[i] > 0 else 0
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
            'pattern_type': 'ma_crossover',
            'cross_bar_index': i,
            'cross_price': float(cross_bar.close),
            'cross_date': cross_bar.timestamp,
            'fast_period': int(fast_period),
            'slow_period': int(slow_period),
        })

    print(f"[MA Crossover] Found {len(candidates)} crossover signals for {symbol}", file=sys.stderr)
    return candidates


# ─────────────────────────────────────────────────────────────────────────────
# Swing Structure Plugin  (was legacy --swing in patternScanner)
# ─────────────────────────────────────────────────────────────────────────────

def run_swing_structure_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Detect and return the full swing structure for a symbol.

    Wraps detect_swings_rdp / detect_swing_points_with_fallback
    and returns the result as a StrategyCandidate.
    """
    struct_cfg = spec.get('structure_config', {})
    method = struct_cfg.get('swing_method', 'rdp')
    epsilon_pct = struct_cfg.get('swing_epsilon_pct', 0.05)

    if method == 'rdp':
        swing = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    else:
        swing = detect_swing_points_with_fallback(
            data, symbol, timeframe,
            first_peak_decline=struct_cfg.get('swing_first_peak_decline', 0.50),
            epsilon_pct=epsilon_pct
        )

    if not swing.swing_points:
        return []

    serialized = serialize_swing_structure(swing, data)

    spec_hash = spec.get('spec_hash', compute_spec_hash(spec))
    svid = spec.get('strategy_version_id', 'scan_swing_structure_v1')
    window_start = swing.swing_points[0].index
    window_end = len(data) - 1

    num_highs = len([p for p in swing.swing_points if p.point_type == 'HIGH'])
    num_lows = len([p for p in swing.swing_points if p.point_type == 'LOW'])

    rules = [
        {'rule_name': 'Swing highs detected', 'passed': num_highs >= 1, 'value': num_highs, 'threshold': 1},
        {'rule_name': 'Swing lows detected', 'passed': num_lows >= 1, 'value': num_lows, 'threshold': 1},
        {'rule_name': 'Primary trend identified', 'passed': swing.primary_trend != 'UNKNOWN',
         'value': swing.primary_trend, 'threshold': 'any'},
        {'rule_name': 'Trend alignment', 'passed': swing.trend_alignment == 'ALIGNED',
         'value': swing.trend_alignment, 'threshold': 'ALIGNED'},
        {'rule_name': 'In buy zone (70-79%)', 'passed': swing.in_buy_zone,
         'value': swing.in_buy_zone, 'threshold': True},
    ]

    score = min(1.0, (num_highs + num_lows) / 10.0)
    if swing.trend_alignment == 'ALIGNED':
        score = min(1.0, score + 0.2)
    if swing.in_buy_zone:
        score = min(1.0, score + 0.2)

    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    def _anchor(sp):
        if not sp:
            return None
        return {'index': sp.index, 'price': sp.price,
                'date': sp.date[:10] if sp.date else None}

    candidate = {
        'candidate_id': cid,
        'id': cid,
        'strategy_version_id': svid,
        'spec_hash': spec_hash,
        'symbol': symbol,
        'timeframe': timeframe,
        'score': round(score, 2),
        'entry_ready': swing.in_buy_zone,
        'rule_checklist': rules,
        'anchors': {
            'current_peak': _anchor(swing.current_peak),
            'current_low': _anchor(swing.current_low),
            'prior_peak': _anchor(swing.prior_peak),
            'prior_low': _anchor(swing.prior_low),
        },
        'window_start': window_start,
        'window_end': window_end,
        'pattern_type': 'swing_structure',
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'chart_data': serialized.get('chart_data', []),
        # Extra swing-specific data for frontend charting
        'swing_structure': serialized,
    }

    return [candidate]


# ─────────────────────────────────────────────────────────────────────────────
# Regime Filter Plugin  (was legacy --regime in patternScanner)
# ─────────────────────────────────────────────────────────────────────────────

def run_regime_filter_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Detect market regime windows (expansion / accumulation / distribution)
    and return as StrategyCandidate(s).
    """
    setup = spec.get('setup_config', {})
    lookback = setup.get('lookback', 26)
    min_window_bars = setup.get('min_window_bars', 8)

    regime_result = detect_regime_windows(data, lookback=lookback, min_window_bars=min_window_bars)

    if not regime_result or regime_result.get('current_regime') == 'unknown':
        return []

    spec_hash = spec.get('spec_hash', compute_spec_hash(spec))
    svid = spec.get('strategy_version_id', 'scan_regime_filter_v1')

    # Build chart data
    is_intraday = _detect_intraday(data)
    chart_data = []
    for bar in data:
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is not None:
            chart_data.append({
                'time': t, 'open': float(bar.open), 'high': float(bar.high),
                'low': float(bar.low), 'close': float(bar.close)
            })

    current_regime = regime_result['current_regime']
    windows = regime_result.get('windows', [])

    rules = [
        {'rule_name': 'Current regime', 'passed': current_regime != 'unknown',
         'value': current_regime, 'threshold': 'any'},
        {'rule_name': 'Regime windows found', 'passed': len(windows) > 0,
         'value': len(windows), 'threshold': 1},
    ]

    regime_scores = {'expansion': 0.8, 'accumulation': 0.6, 'distribution': 0.4, 'transition': 0.2}
    score = regime_scores.get(current_regime, 0.3)

    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    candidate = {
        'candidate_id': cid,
        'id': cid,
        'strategy_version_id': svid,
        'spec_hash': spec_hash,
        'symbol': symbol,
        'timeframe': timeframe,
        'score': round(score, 2),
        'entry_ready': current_regime in ('accumulation', 'expansion'),
        'rule_checklist': rules,
        'anchors': {
            'current_regime': current_regime,
        },
        'window_start': window_start,
        'window_end': window_end,
        'pattern_type': 'regime_filter',
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'chart_data': chart_data,
        # Extra regime-specific data
        'regime_data': regime_result,
    }

    return [candidate]


# ─────────────────────────────────────────────────────────────────────────────
# DEPRECATED: Legacy monolithic Fib + Energy Plugin
# Replaced by composite_runner.py + 4 primitives (rdp_swing_structure,
# fib_location_primitive, energy_state_primitive, fib_signal_trigger_primitive).
# Kept only as a reference — not called by anything. Safe to delete.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Discount Zone Plugin  (was legacy --discount in patternScanner)
# ─────────────────────────────────────────────────────────────────────────────

def run_discount_zone_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Discount zone scan: uptrend + 50%+ retracement + structure intact.
    Returns qualifying discount candidates as StrategyCandidates.
    """
    setup = spec.get('setup_config', {})
    struct_cfg = spec.get('structure_config', {})
    epsilon_pct = struct_cfg.get('swing_epsilon_pct', 0.05)

    result = scan_discount_zone(data, symbol, timeframe, epsilon_pct=epsilon_pct)

    if result is None:
        return []

    spec_hash = spec.get('spec_hash', compute_spec_hash(spec))
    svid = spec.get('strategy_version_id', 'scan_discount_zone_v1')

    tier = result.get('tier', 'UNKNOWN')
    retracement = result.get('retracement', 0)
    rank_score = result.get('rank_score', 0)
    primary_trend = result.get('primary_trend', 'UNKNOWN')

    rules = [
        {'rule_name': 'Primary trend UPTREND', 'passed': primary_trend == 'UPTREND',
         'value': primary_trend, 'threshold': 'UPTREND'},
        {'rule_name': 'Retracement >= 50%', 'passed': retracement >= 50,
         'value': round(retracement, 1), 'threshold': 50},
        {'rule_name': 'Retracement < 100%', 'passed': retracement < 100,
         'value': round(retracement, 1), 'threshold': 100},
        {'rule_name': 'Discount tier', 'passed': True,
         'value': tier, 'threshold': 'any'},
    ]

    if result.get('near_fib'):
        rules.append({
            'rule_name': f'Near {result.get("nearest_fib", "?")} fib',
            'passed': True, 'value': True, 'threshold': True
        })

    score = min(1.0, rank_score / 100.0)

    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    candidate = {
        'candidate_id': cid,
        'id': cid,
        'strategy_version_id': svid,
        'spec_hash': spec_hash,
        'symbol': symbol,
        'timeframe': timeframe,
        'score': round(score, 2),
        'entry_ready': tier == 'SWEET_SPOT',
        'rule_checklist': rules,
        'anchors': {
            'range_high': {'price': result.get('range_high', 0)},
            'range_low': {'price': result.get('range_low', 0)},
        },
        'window_start': window_start,
        'window_end': window_end,
        'pattern_type': 'discount_zone',
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'chart_data': result.get('chart_data', []),
        # Extra discount-specific data
        'discount_data': {
            'tier': tier,
            'retracement': round(retracement, 1),
            'rank_score': rank_score,
            'energy_state': result.get('energy_state'),
            'energy_direction': result.get('energy_direction'),
            'selling_pressure': result.get('selling_pressure'),
            'pressure_trend': result.get('pressure_trend'),
            'nearest_fib': result.get('nearest_fib'),
            'near_fib': result.get('near_fib'),
            'fib_levels': result.get('fib_levels', []),
            'swing_points': result.get('swing_points', []),
        },
    }

    return [candidate]


# ─────────────────────────────────────────────────────────────────────────────
# Discount + Wyckoff Pipeline Plugin  (was legacy --discount + secondary wyckoff)
# ─────────────────────────────────────────────────────────────────────────────

def run_discount_wyckoff_pipeline_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str
) -> List[Dict[str, Any]]:
    """
    Two-stage pipeline:
    1. Run discount zone check — is this symbol in an uptrend discount?
    2. If yes, run Wyckoff accumulation detection on it.
    Returns merged candidates (Wyckoff patterns that are also in discount).
    """
    # Stage 1: Discount gate
    discount_candidates = run_discount_zone_plugin(data, structure, spec, symbol, timeframe)
    if not discount_candidates:
        return []

    # Stage 2: Wyckoff detection
    wyckoff_candidates = run_wyckoff_plugin(data, structure, spec, symbol, timeframe)

    if wyckoff_candidates:
        # Merge: annotate Wyckoff candidates with discount context
        discount_info = discount_candidates[0].get('discount_data', {})
        for wc in wyckoff_candidates:
            wc['_discount_context'] = discount_info
            wc['pattern_type'] = 'discount_wyckoff_pipeline'
            # Boost score by discount quality
            discount_score = discount_info.get('rank_score', 0) / 100.0
            wc['score'] = round(min(1.0, wc.get('score', 0.5) * 0.7 + discount_score * 0.3), 2)
        return wyckoff_candidates
    else:
        # No Wyckoff patterns, but symbol is in discount — still return the discount candidate
        discount_candidates[0]['pattern_type'] = 'discount_wyckoff_pipeline'
        discount_candidates[0]['_note'] = 'In discount zone but no Wyckoff pattern detected'
        return discount_candidates


# NOTE:
# Built-in plugins are now loaded from real files via registry definitions.
# PLUGINS remains as an in-memory override map used by /api/plugins/test
# to inject temporary plugin functions at runtime.


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point: run_strategy
# ─────────────────────────────────────────────────────────────────────────────

def run_strategy(
    spec: Dict[str, Any],
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    mode: str = 'scan'
) -> List[Dict[str, Any]]:
    """
    Main entry point.

    Args:
        spec:      Parsed StrategySpec JSON
        data:      OHLCV data
        symbol:    Ticker symbol
        timeframe: Timeframe label (e.g. 'W', 'D')
        mode:      'scan' or 'backtest'

    Returns:
        List of StrategyCandidate dicts
    """
    # Determine plugin
    setup_config = spec.get('setup_config', spec.get('params', {}))
    pattern_type = setup_config.get('pattern_type', 'wyckoff_accumulation')

    plugin_fn = PLUGINS.get(pattern_type)
    if plugin_fn is None:
        plugin_fn = _resolve_plugin_from_registry(pattern_type)
    if plugin_fn is None:
        # If the spec embeds a composite_spec, route through the generic composite runner
        # so Research Agent-generated strategies work without a dedicated plugin file.
        _composite_spec = (spec.get('setup_config') or {}).get('composite_spec')
        if _composite_spec:
            from plugins.composite_runner import run_composite_plugin
            plugin_fn = run_composite_plugin
        else:
            print(f"[Runner] ERROR: Unknown pattern type '{pattern_type}'", file=sys.stderr)
            return []

    # Extract structure
    structure_config = dict(spec.get('structure_config', {}) or {})
    if mode == 'backtest':
        # Backtest mode expects caller to pass prefix bars; this flag
        # makes intent explicit in extracted metadata.
        structure_config['causal'] = True
    if not structure_config:
        # Build default structure config from legacy params
        params = spec.get('params', {})
        structure_config = {
            'swing_method': 'major',
            'swing_epsilon_pct': params.get('swing_epsilon', 0.05),
            'swing_first_peak_decline': 0.50,
            'swing_subsequent_decline': 0.25,
            'base_min_duration': 15,
            'base_max_duration': 500,
            'base_max_range_pct': 0.80,
            'base_volatility_threshold': 0.10,
        }

    # Determine if this plugin needs structure extraction
    setup_config = spec.get('setup_config', {}) or {}
    indicator_role = str(setup_config.get('indicator_role', '') or spec.get('indicator_role', '') or '').strip().lower()

    # If no role on the spec, look it up from the pattern registry
    if not indicator_role:
        indicator_role = _lookup_indicator_role(pattern_type)

    # Roles that can SKIP the expensive structure extraction
    roles_skipping_structure = {'structure_filter', 'timing_trigger', 'momentum', 'oscillator', 'filter'}
    if indicator_role in roles_skipping_structure:
        needs_structure = False
    else:
        roles_needing_structure = {'anchor_structure', 'location', 'location_filter', 'state_filter', 'regime_state', 'entry_composite'}
        needs_structure = indicator_role in roles_needing_structure or indicator_role == ''

    if needs_structure:
        if _RUNNER_DEBUG: print(f"[Runner] Extracting structure for {symbol} ({timeframe}) using method={structure_config.get('swing_method', 'major')}", file=sys.stderr)
        structure = extract_structure(data, structure_config, symbol=symbol, timeframe=timeframe)
        if _RUNNER_DEBUG: print(f"[Runner] Structure: {len(structure.pivots)} pivots, {len(structure.bases)} bases, trend={structure.trend}", file=sys.stderr)
    else:
        if _RUNNER_DEBUG: print(f"[Runner] Skipping structure extraction (role={indicator_role or 'unknown'} does not require it)", file=sys.stderr)
        structure = StructureExtraction(pivots=[], bases=[], trend="UNKNOWN")

    # Run plugin
    if _RUNNER_DEBUG: print(f"[Runner] Running plugin: {pattern_type}", file=sys.stderr)
    candidates = plugin_fn(data, structure, spec, symbol, timeframe)
    if _RUNNER_DEBUG: print(f"[Runner] Plugin returned {len(candidates)} candidates", file=sys.stderr)

    return candidates


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Strategy Runner — general-purpose hypothesis scanner'
    )
    parser.add_argument('--spec', type=str, help='Path to StrategySpec JSON file')
    parser.add_argument('--spec-stdin', action='store_true', help='Read spec JSON from stdin')
    parser.add_argument('--symbol', type=str, required=True, help='Ticker symbol')
    parser.add_argument('--timeframe', type=str, default='W', help='Timeframe label (D, W, M)')
    parser.add_argument('--period', type=str, default='max', help='Data period for yfinance')
    parser.add_argument('--interval', type=str, default='1wk', help='Data interval for yfinance')
    parser.add_argument('--mode', type=str, default='scan', choices=['scan', 'backtest'],
                        help='Run mode')
    args = parser.parse_args()

    # Load spec
    if args.spec_stdin:
        spec = json.load(sys.stdin)
    elif args.spec:
        with open(args.spec, 'r') as f:
            spec = json.load(f)
    else:
        print("ERROR: Must provide --spec <path> or --spec-stdin", file=sys.stderr)
        sys.exit(1)

    # Fetch data
    print(f"[Runner] Fetching {args.symbol} ({args.interval}, {args.period})", file=sys.stderr)
    data = fetch_data_yfinance(args.symbol, period=args.period, interval=args.interval)
    if not data:
        print(f"ERROR: No data for {args.symbol}", file=sys.stderr)
        print(json.dumps([]))
        sys.exit(0)

    print(f"[Runner] Loaded {len(data)} bars", file=sys.stderr)

    # Run strategy
    results = run_strategy(spec, data, args.symbol, args.timeframe, mode=args.mode)

    # Output — use a custom encoder to handle numpy types and frozendict quirks
    class SafeEncoder(json.JSONEncoder):
        def default(self, obj):
            import numpy as np
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, (np.bool_,)):
                return bool(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
            return super().default(obj)
    print(json.dumps(results, indent=2, cls=SafeEncoder))


if __name__ == '__main__':
    main()
