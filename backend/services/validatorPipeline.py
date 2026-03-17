#!/usr/bin/env python3
"""
Validator pipeline (real computations).
Outputs JSON: {"report": ValidationReport, "trades": TradeInstance[]}
"""

from __future__ import annotations

import argparse
import copy
import contextlib
import hashlib
import io
import json
import math
import multiprocessing
import os
import queue
import statistics
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

# Thread-local storage so each validator request running in its own thread
# inside the FastAPI worker pool has its own progress queue without
# interfering with concurrent requests.
_tl = threading.local()

# Number of parallel workers for symbol-level backtest parallelism.
# Leave one core free for the FastAPI service itself; cap at 6 to avoid
# overwhelming the machine on large universes.
_N_BACKTEST_WORKERS = max(1, min(3, int(os.getenv("BACKTEST_WORKERS", "3"))))

try:
    import yfinance as yf
except Exception:
    yf = None

from backtestEngine import run_backtest_on_bars, trades_to_dicts, _entry_signal_indices_from_spec, _safe_float
from robustnessTests import expectancy, out_of_sample, walk_forward, monte_carlo, parameter_sensitivity
from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import clear_rdp_cache, clear_rdp_precomputed, rdp_cache_stats, set_backtest_mode as _set_rdp_backtest_mode
from platform_sdk.swing_structure import set_backtest_mode as _set_swing_backtest_mode

# ── Cancellation flag registry ────────────────────────────────────────────────
# Keyed by job_id. Set via register_cancel_flag(), cleared on job start/end.
_cancel_flags: set = set()


def register_cancel_flag(job_id: str) -> None:
    """Signal that a running job should stop at the next checkpoint."""
    _cancel_flags.add(job_id)


def clear_cancel_flag(job_id: str) -> None:
    """Remove the cancel flag for a job (call on start and on completion)."""
    _cancel_flags.discard(job_id)


def _is_cancelled(job_id: str | None) -> bool:
    return bool(job_id and job_id in _cancel_flags)


def _kill_executor_workers(executor) -> None:
    """Terminate all worker processes in a ProcessPoolExecutor immediately."""
    try:
        pids = []
        if hasattr(executor, '_processes'):
            pids = list(executor._processes.keys())
        for pid in pids:
            try:
                if sys.platform == 'win32':
                    import subprocess
                    subprocess.run(
                        ['taskkill', '/F', '/T', '/PID', str(pid)],
                        capture_output=True, timeout=5,
                    )
                else:
                    os.kill(pid, 9)
            except (OSError, ProcessLookupError):
                pass
            except Exception:
                pass
        executor.shutdown(wait=False, cancel_futures=True)
    except Exception:
        try:
            executor.shutdown(wait=False)
        except Exception:
            pass


def _bars_to_ohlcv_list(bars: List[Dict[str, Any]]) -> List[OHLCV]:
    """Convert bar dicts to OHLCV dataclass list for primitive plugins."""
    out: List[OHLCV] = []
    for b in bars:
        out.append(OHLCV(
            timestamp=str(b.get("timestamp") or ""),
            open=_safe_float(b.get("open"), 0.0),
            high=_safe_float(b.get("high"), 0.0),
            low=_safe_float(b.get("low"), 0.0),
            close=_safe_float(b.get("close"), 0.0),
            volume=_safe_float(b.get("volume"), 0.0),
        ))
    return out


def _get_signal_indices_from_primitive(
    symbol: str,
    timeframe: str,
    bars: List[Dict[str, Any]],
    spec: Dict[str, Any],
) -> set:
    """
    Try to get signal indices by calling the primitive plugin in signal mode.
    Falls back to the backtest engine's built-in signal generators if no
    primitive plugin is found.
    """
    setup_cfg = spec.get("setup_config") or {}
    pattern_type = str(setup_cfg.get("pattern_type") or "").strip()

    if not pattern_type:
        return _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)

    # Try to load the primitive plugin via strategyRunner's resolver
    try:
        from strategyRunner import _resolve_plugin_from_registry
        plugin_fn = _resolve_plugin_from_registry(pattern_type)
    except Exception:
        plugin_fn = None

    if plugin_fn is None:
        return _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)

    # Call the plugin in signal mode
    try:
        import inspect
        sig = inspect.signature(plugin_fn)
        if "mode" not in sig.parameters:
            # Plugin doesn't support signal mode — fall back
            return _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)

        ohlcv_data = _bars_to_ohlcv_list(bars)
        result = plugin_fn(
            data=ohlcv_data,
            structure=None,
            spec=spec,
            symbol=symbol,
            timeframe=timeframe,
            mode="signal",
        )

        if isinstance(result, set):
            return result
        else:
            # Plugin returned something unexpected in signal mode
            print(f"[Validator] {symbol}: primitive {pattern_type} signal mode "
                  f"returned {type(result).__name__}, expected set. Falling back.",
                  file=sys.stderr)
            return _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)

    except Exception as e:
        print(f"[Validator] {symbol}: primitive {pattern_type} signal mode failed: {e}. Falling back.",
              file=sys.stderr)
        return _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)


_DENSITY_PATTERN_TYPES = {
    "density_base_detector_v1_pattern",
    "density_base_detector_v2_pattern",
}


def _split_path(path: str) -> List[str]:
    return [segment for segment in str(path or "").split(".") if segment]


def _get_nested_value(target: Any, path: str) -> Any:
    current = target
    for segment in _split_path(path):
        if isinstance(current, list):
            if not segment.isdigit():
                return None
            idx = int(segment)
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
            continue
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current.get(segment)
    return current


def _set_nested_value(target: Any, path: str, value: Any) -> bool:
    segments = _split_path(path)
    if not segments:
        return False

    current = target
    for segment in segments[:-1]:
        if isinstance(current, list):
            if not segment.isdigit():
                return False
            idx = int(segment)
            if idx < 0 or idx >= len(current):
                return False
            current = current[idx]
            continue
        if not isinstance(current, dict):
            return False
        if segment not in current or current[segment] is None:
            current[segment] = {}
        current = current[segment]

    leaf = segments[-1]
    if isinstance(current, list):
      if not leaf.isdigit():
          return False
      idx = int(leaf)
      if idx < 0 or idx >= len(current):
          return False
      current[idx] = value
      return True

    if not isinstance(current, dict):
        return False
    current[leaf] = value
    return True


def _manifest_sensitivity_params(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    manifest = spec.get("parameter_manifest")
    if not isinstance(manifest, list):
        return []

    params: List[Dict[str, Any]] = []
    for item in manifest:
        if not isinstance(item, dict):
            continue
        if item.get("sensitivity_enabled") is not True:
            continue
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        value_type = str(item.get("type") or "float").strip().lower()
        if value_type not in ("int", "float"):
            continue
        params.append({
            "label": str(item.get("label") or path),
            "path": path,
            "type": value_type,
            "min": item.get("min"),
        })
    return params


def _resolve_sensitivity_params(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    manifest_params = _manifest_sensitivity_params(spec)
    if manifest_params:
        return manifest_params

    setup_cfg = spec.get("setup_config") or {}
    pattern_type = str(setup_cfg.get("pattern_type") or "").strip().lower()
    if pattern_type in _DENSITY_PATTERN_TYPES:
        return [
            {"label": "Swing Lookback", "path": "setup_config.swing_lookback", "type": "int", "min": 1},
            {"label": "Swing Lookahead", "path": "setup_config.swing_lookahead", "type": "int", "min": 1},
            {"label": "Min Base Bars", "path": "setup_config.min_base_bars", "type": "int", "min": 1},
        ]
    return [
        {"label": "RDP Epsilon %", "path": "structure_config.swing_epsilon_pct", "type": "float", "min": 0.0001},
        {"label": "Stop Value", "path": "risk_config.stop_value", "type": "float", "min": 0.0001},
        {"label": "Take Profit R", "path": "risk_config.take_profit_R", "type": "float", "min": 0.0001},
    ]


def _nudge_float(base: float, factor: float, minimum: float) -> float:
    return max(minimum, base * factor)


def _nudge_int(base: int, factor: float, minimum: int) -> int:
    nudged = math.ceil(base * factor) if factor > 1.0 else math.floor(base * factor)
    if nudged == base:
        nudged = base + (1 if factor > 1.0 else -1)
    return max(minimum, nudged)


def _apply_sensitivity_nudge(spec: Dict[str, Any], param: str, factor: float) -> None:
    if isinstance(param, dict) and param.get("path"):
        path = str(param.get("path") or "").strip()
        current = _get_nested_value(spec, path)
        if current is None:
            return
        value_type = str(param.get("type") or "float").strip().lower()
        minimum = float(param.get("min") or 0.0001)
        if value_type == "int":
            _set_nested_value(spec, path, _nudge_int(int(current), factor, max(1, int(minimum))))
            return
        _set_nested_value(spec, path, _nudge_float(float(current), factor, minimum))
        return

    if param in ("stop_value", "take_profit_R"):
        rc = spec.setdefault("risk_config", {})
        base = float(rc.get(param, 0.08 if param == "stop_value" else 2.0))
        rc[param] = _nudge_float(base, factor, 0.0001)
        return

    if param == "swing_epsilon":
        sc = spec.setdefault("structure_config", {})
        base = float(sc.get("swing_epsilon_pct", 0.05))
        sc["swing_epsilon_pct"] = _nudge_float(base, factor, 0.0001)
        return

    setup_cfg = spec.setdefault("setup_config", {})
    if param == "min_drop_pct":
        base = float(setup_cfg.get("min_drop_pct", 0.08))
        setup_cfg["min_drop_pct"] = _nudge_float(base, factor, 0.0001)
        return

    if param == "min_score":
        base = float(setup_cfg.get("min_score", 0.25))
        setup_cfg["min_score"] = _nudge_float(base, factor, 0.0001)
        return

    if param == "swing_lookback":
        base = int(setup_cfg.get("swing_lookback", 10))
        setup_cfg["swing_lookback"] = _nudge_int(base, factor, 1)
        return

    if param == "swing_lookahead":
        base = int(setup_cfg.get("swing_lookahead", 10))
        setup_cfg["swing_lookahead"] = _nudge_int(base, factor, 1)
        return

    if param == "min_void_bars":
        base = int(setup_cfg.get("min_void_bars", 8))
        setup_cfg["min_void_bars"] = _nudge_int(base, factor, 1)
        return

    if param == "min_base_bars":
        base = int(setup_cfg.get("min_base_bars", 5))
        setup_cfg["min_base_bars"] = _nudge_int(base, factor, 1)
        return


_pipeline_start_time: float = 0.0

# ---------------------------------------------------------------------------
# Indicator warmup buffer
# ---------------------------------------------------------------------------
# Many indicators (e.g. 200-period SMA) need N bars of history before they
# produce valid values.  If the backtest date range starts at T, the first
# SMA(200) value only appears at bar 200 — so a crossover that happens at
# bar 175 is invisible.  To fix this, we prepend extra "warmup" bars by
# extending the data-fetch window backward.

_WARMUP_DEFAULTS = {
    "1wk": 250,   # ~5 years for weekly — covers SMA(200) with room
    "1d":  300,    # ~14 months for daily
    "1mo": 250,    # ~20 years for monthly (acceptable)
    "1h":  300,    # ~12 days for hourly
    "4h":  300,    # ~50 days for 4H
}
_MIN_WARMUP = 60


def _compute_warmup_bars(spec: Dict[str, Any], interval: str) -> int:
    """Derive the minimum number of warmup bars the spec requires.

    Scans composite stages, setup_config, and min_data_bars for obvious
    period/lookback parameters and returns the largest value found (plus
    a small buffer).  Falls back to a generous default per interval so
    indicators always have enough history to converge.
    """
    max_period = 0

    setup = spec.get("setup_config") or {}
    for key in ("slow_period", "period", "lookback_bars", "lookback"):
        val = setup.get(key)
        if isinstance(val, (int, float)) and val > max_period:
            max_period = int(val)

    composite = setup.get("composite_spec") or {}
    for stage in (composite.get("stages") or composite.get("nodes") or []):
        params = stage.get("params") or {}
        for key in ("slow_period", "period", "lookback_bars", "lookback"):
            val = params.get(key)
            if isinstance(val, (int, float)) and val > max_period:
                max_period = int(val)

    min_data = int(spec.get("min_data_bars") or 0)
    if min_data > max_period:
        max_period = min_data

    default = _WARMUP_DEFAULTS.get(interval, 250)
    warmup = max(max_period + 50, default, _MIN_WARMUP)
    return warmup


def _extend_date_start(date_start: str, warmup_bars: int, interval: str) -> str:
    """Shift date_start backward by warmup_bars calendar days.

    Conversion: bars → approximate calendar days.
    """
    from datetime import timedelta

    bars_per_calendar_day = {
        "1wk": 1 / 7,
        "1mo": 1 / 30,
        "1d":  5 / 7,   # trading days per calendar day
        "1h":  6.5 * 5 / 7,   # ~6.5 trading hours/day
        "4h":  (6.5 / 4) * 5 / 7,
    }
    rate = bars_per_calendar_day.get(interval, 5 / 7)
    if rate <= 0:
        rate = 5 / 7
    calendar_days = int(warmup_bars / rate) + 30  # extra buffer
    dt = datetime.strptime(date_start, "%Y-%m-%d") - timedelta(days=calendar_days)
    return dt.strftime("%Y-%m-%d")


_SNAPSHOT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "validator-snapshots"))
_INVALID_SYMBOLS_FILE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "validator-invalid-symbols.json"))
_INVALID_SYMBOL_TTL_SEC = 14 * 24 * 60 * 60


def _snapshot_meta(symbols: List[str], interval: str, date_start: str, date_end: str) -> Dict[str, Any]:
    return {
        "symbols": symbols,
        "interval": interval,
        "date_start": date_start,
        "date_end": date_end,
        "provider": "yfinance",
        "auto_adjust": False,
    }


def _snapshot_path(symbols: List[str], interval: str, date_start: str, date_end: str) -> str:
    meta = _snapshot_meta(symbols, interval, date_start, date_end)
    key = hashlib.sha1(json.dumps(meta, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    return os.path.join(_SNAPSHOT_DIR, f"snapshot_{key}.json")


def _load_snapshot(path: str) -> Dict[str, List[Dict[str, Any]]] | None:
    try:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        data = raw.get("data")
        if not isinstance(data, dict):
            return None
        # Keep only symbol->list payloads
        return {str(k): (v if isinstance(v, list) else []) for k, v in data.items()}
    except Exception:
        return None


def _save_snapshot(path: str, data_cache: Dict[str, List[Dict[str, Any]]], symbols: List[str], interval: str, date_start: str, date_end: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "created_at": datetime.utcnow().isoformat() + "Z",
        "meta": _snapshot_meta(symbols, interval, date_start, date_end),
        "data": data_cache,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def _format_eta(seconds: float) -> str:
    """Format seconds into a human-readable ETA string."""
    if seconds <= 0:
        return ""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes >= 60:
        hours = minutes // 60
        mins = minutes % 60
        return f"~{hours}h {mins}m remaining"
    if minutes > 0:
        return f"~{minutes}m {secs}s remaining"
    return f"~{secs}s remaining"


def _emit_progress(progress: float, stage: str, detail: str = "", eta_seconds: float = -1) -> None:
    """Write structured JSONL progress updates to stderr and to the thread-local
    streaming queue (if one is set by the FastAPI service endpoint)."""
    try:
        msg: dict = {"progress": float(progress), "stage": str(stage), "detail": str(detail or "")}
        if eta_seconds >= 0:
            msg["eta_seconds"] = round(eta_seconds)
            msg["eta_display"] = _format_eta(eta_seconds)
        print(json.dumps(msg), file=sys.stderr, flush=True)
        q: Optional[queue.Queue] = getattr(_tl, "progress_queue", None)
        if q is not None:
            q.put_nowait(msg)
    except Exception:
        return


def _safe_float(x: Any, default: float) -> float:
    try:
        return float(x)
    except Exception:
        return default


def _safe_int(x: Any, default: int) -> int:
    try:
        return int(x)
    except Exception:
        return default


_TIER_TRADE_THRESHOLDS: Dict[str, Dict[str, int]] = {
    # Fast kill gate still requires meaningful evidence.
    "tier1": {"min_trades_pass": 300, "min_trades_fail": 200},
    # Evidence expansion keeps the fast runtime but expects a broader sample.
    "tier1b": {"min_trades_pass": 500, "min_trades_fail": 300},
    # Core validation expands evidence requirements.
    "tier2": {"min_trades_pass": 500, "min_trades_fail": 300},
    # Robustness/stress layer expects deeper sample size.
    "tier3": {"min_trades_pass": 800, "min_trades_fail": 400},
}

# Reference universe size for the stock tiers that define the standard thresholds.
_REFERENCE_UNIVERSE_SIZE = 50

# Small-universe quality compensation: when the universe is too small to
# generate 300+ trades, we scale the trade threshold down proportionally
# but demand higher per-trade quality to compensate for smaller sample size.
_SMALL_UNIVERSE_THRESHOLD = 15  # below this, apply quality scaling
_SMALL_UNIVERSE_QUALITY = {
    "min_expectancy_R": 0.20,       # must show a meaningful per-trade edge
    "min_profit_factor": 1.30,      # higher than normal 1.0 floor
    "min_payoff_ratio": 1.5,        # avg_win / |avg_loss| — asymmetric reward
    "max_mc_p95_dd_pct": 25.0,      # tighter drawdown ceiling
}


def _validator_thresholds(spec: Dict[str, Any], tier_key: str = "tier3", universe_size: int = 50) -> Dict[str, Any]:
    cfg = spec.get("validator_config") or {}
    normalized_tier = str(tier_key or "tier3").strip().lower()
    if normalized_tier not in _TIER_TRADE_THRESHOLDS:
        normalized_tier = "tier3"
    tier_defaults = _TIER_TRADE_THRESHOLDS[normalized_tier]
    tier_overrides = {}
    tiers_cfg = cfg.get("tiers")
    if isinstance(tiers_cfg, dict):
        candidate = tiers_cfg.get(normalized_tier)
        if isinstance(candidate, dict):
            tier_overrides = candidate

    # Backward-compatible override precedence:
    # tier-specific nested config > tier-suffixed flat key > legacy flat key > tier default.
    min_trades_pass_default = tier_defaults["min_trades_pass"]
    min_trades_fail_default = tier_defaults["min_trades_fail"]
    min_trades_pass = _safe_int(
        tier_overrides.get(
            "min_trades_pass",
            cfg.get(f"min_trades_pass_{normalized_tier}", cfg.get("min_trades_pass", min_trades_pass_default)),
        ),
        min_trades_pass_default,
    )
    min_trades_fail = _safe_int(
        tier_overrides.get(
            "min_trades_fail",
            cfg.get(f"min_trades_fail_{normalized_tier}", cfg.get("min_trades_fail", min_trades_fail_default)),
        ),
        min_trades_fail_default,
    )

    is_small_universe = universe_size < _SMALL_UNIVERSE_THRESHOLD
    if is_small_universe:
        scale = max(0.1, universe_size / _REFERENCE_UNIVERSE_SIZE)
        min_trades_pass = max(30, int(min_trades_pass * scale))
        min_trades_fail = max(20, int(min_trades_fail * scale))

    mc_p95 = max(0.0, _safe_float(cfg.get("max_mc_p95_dd_pct", 30.0), 30.0))
    if is_small_universe:
        mc_p95 = min(mc_p95, _SMALL_UNIVERSE_QUALITY["max_mc_p95_dd_pct"])

    return {
        "min_trades_pass": max(1, min_trades_pass),
        "min_trades_fail": max(1, min_trades_fail),
        "small_universe": is_small_universe,
        "min_expectancy_R": _SMALL_UNIVERSE_QUALITY["min_expectancy_R"] if is_small_universe else 0.0,
        "min_profit_factor": _SMALL_UNIVERSE_QUALITY["min_profit_factor"] if is_small_universe else 1.0,
        "min_payoff_ratio": _SMALL_UNIVERSE_QUALITY["min_payoff_ratio"] if is_small_universe else 0.0,
        "max_oos_degradation_pct": max(0.0, _safe_float(cfg.get("max_oos_degradation_pct", 50.0), 50.0)),
        "min_wf_profitable_windows": min(1.0, max(0.0, _safe_float(cfg.get("min_wf_profitable_windows", 0.6), 0.6))),
        "max_mc_p95_dd_pct": mc_p95,
        "max_mc_p99_dd_pct": max(0.0, _safe_float(cfg.get("max_mc_p99_dd_pct", 50.0), 50.0)),
        "max_sensitivity_score": max(0.0, _safe_float(cfg.get("max_sensitivity_score", 40.0), 40.0)),
        "r_to_pct": max(0.1, _safe_float(cfg.get("r_to_pct", 2.0), 2.0)),
    }


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _load_invalid_symbol_cache() -> Dict[str, Dict[str, Any]]:
    try:
        with open(_INVALID_SYMBOLS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        for k, v in raw.items():
            if isinstance(k, str) and isinstance(v, dict):
                out[k] = v
        return out
    except Exception:
        return {}


def _save_invalid_symbol_cache(cache: Dict[str, Dict[str, Any]]) -> None:
    try:
        os.makedirs(os.path.dirname(_INVALID_SYMBOLS_FILE), exist_ok=True)
        with open(_INVALID_SYMBOLS_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except Exception:
        return


def _is_recent_invalid(entry: Dict[str, Any], now_ts: float) -> bool:
    try:
        last_seen = str(entry.get("last_seen") or "")
        if not last_seen:
            return False
        dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        age = now_ts - dt.timestamp()
        return 0 <= age <= _INVALID_SYMBOL_TTL_SEC
    except Exception:
        return False


def _is_invalid_symbol_diag(diag: str) -> bool:
    text = (diag or "").lower()
    needles = [
        "possibly delisted",
        "quote not found",
        "no timezone found",
        "failed download",
        "no price data found",
    ]
    return any(n in text for n in needles)


def _aggregate_bars_dicts(bars: List[Dict[str, Any]], factor: int) -> List[Dict[str, Any]]:
    """Aggregate 1h bars into N-hour bars (e.g. factor=4 for 4h)."""
    if factor <= 1 or not bars:
        return bars
    out: List[Dict[str, Any]] = []
    for i in range(0, len(bars), factor):
        chunk = bars[i : i + factor]
        if not chunk:
            break
        agg = {
            "timestamp": chunk[0]["timestamp"],
            "open": chunk[0]["open"],
            "high": max(b["high"] for b in chunk),
            "low": min(b["low"] for b in chunk),
            "close": chunk[-1]["close"],
        }
        out.append(agg)
    return out


def load_ohlcv(symbol: str, interval: str, date_start: str, date_end: str) -> tuple[List[Dict[str, Any]], str]:
    if yf is None:
        raise RuntimeError("yfinance is not installed")

    needs_aggregation = interval == "4h"
    yahoo_interval = "1h" if needs_aggregation else interval

    stderr_buf = io.StringIO()
    stdout_buf = io.StringIO()
    with contextlib.redirect_stderr(stderr_buf), contextlib.redirect_stdout(stdout_buf):
        df = yf.download(symbol, start=date_start, end=date_end, interval=yahoo_interval, progress=False, auto_adjust=False)
    diag = (stderr_buf.getvalue() + "\n" + stdout_buf.getvalue()).strip()
    if df is None or len(df) == 0:
        if _is_invalid_symbol_diag(diag):
            return [], "invalid_symbol"
        return [], "no_data"

    bars: List[Dict[str, Any]] = []
    def _coerce_num(v: Any) -> float:
        if hasattr(v, "iloc"):
            return float(v.iloc[0])
        return float(v)

    for idx, row in df.iterrows():
        ts = idx.to_pydatetime().strftime("%Y-%m-%d %H:%M:%S")
        o = _coerce_num(row.get("Open", row.get("open", 0.0)))
        h = _coerce_num(row.get("High", row.get("high", 0.0)))
        l = _coerce_num(row.get("Low", row.get("low", 0.0)))
        c = _coerce_num(row.get("Close", row.get("close", 0.0)))
        if any(math.isnan(v) for v in [o, h, l, c]):
            continue
        bars.append({"timestamp": ts, "open": o, "high": h, "low": l, "close": c})

    if needs_aggregation:
        bars = _aggregate_bars_dicts(bars, 4)

    if not bars:
        return [], "no_data"
    return bars, "ok"


def _streaks(results: List[float]) -> Dict[str, Any]:
    longest_losing = 0
    longest_winning = 0
    cur_l = 0
    cur_w = 0
    losing_streaks: List[int] = []

    for r in results:
        if r > 0:
            cur_w += 1
            longest_winning = max(longest_winning, cur_w)
            if cur_l > 0:
                losing_streaks.append(cur_l)
            cur_l = 0
        else:
            cur_l += 1
            longest_losing = max(longest_losing, cur_l)
            cur_w = 0
    if cur_l > 0:
        losing_streaks.append(cur_l)

    avg_losing = sum(losing_streaks) / len(losing_streaks) if losing_streaks else 0.0
    return {"longest_losing": longest_losing, "longest_winning": longest_winning, "avg_losing": avg_losing}


def _risk_metrics(r_values: List[float], r_to_pct: float) -> Dict[str, Any]:
    eq = 0.0
    peak = 0.0
    max_dd_r = 0.0
    bars_under_water = 0
    cur_under_water = 0

    for r in r_values:
        eq += r
        if eq >= peak:
            peak = eq
            cur_under_water = 0
        else:
            cur_under_water += 1
            bars_under_water = max(bars_under_water, cur_under_water)
        dd = peak - eq
        if dd > max_dd_r:
            max_dd_r = dd

    max_dd_pct = max_dd_r * r_to_pct
    sharpe = None
    if len(r_values) >= 2:
        std = statistics.pstdev(r_values)
        sharpe = (statistics.mean(r_values) / std) * math.sqrt(len(r_values)) if std > 0 else None
    calmar = (statistics.mean(r_values) / max_dd_r) if (r_values and max_dd_r > 0) else None

    return {
        "max_drawdown_pct": max_dd_pct,
        "max_drawdown_R": max_dd_r,
        "time_under_water_bars": bars_under_water,
        "expected_recovery_time_bars": bars_under_water,
        "sharpe_ratio": sharpe,
        "calmar_ratio": calmar,
    }


def _filter_max_concurrent(trades: List[Dict[str, Any]], max_concurrent: int) -> List[Dict[str, Any]]:
    """Filter trades to enforce a max concurrent positions limit.

    Sorts trades by entry time, walks chronologically, and skips any trade
    where the number of already-open positions >= max_concurrent.
    """
    if not trades or max_concurrent <= 0:
        return trades

    sorted_trades = sorted(trades, key=lambda t: t.get("entry_time", ""))
    accepted: List[Dict[str, Any]] = []

    for trade in sorted_trades:
        entry_time = trade.get("entry_time", "")
        open_count = sum(
            1 for t in accepted
            if t.get("entry_time", "") <= entry_time < t.get("exit_time", "Z")
        )
        if open_count < max_concurrent:
            accepted.append(trade)

    skipped = len(trades) - len(accepted)
    if skipped > 0:
        print(
            f"[MaxConcurrent] Filtered {skipped}/{len(trades)} trades "
            f"(max_concurrent={max_concurrent}, kept={len(accepted)})",
            file=sys.stderr,
        )
    return accepted


def _trade_summary(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    r_vals = [float(t.get("R_multiple", 0.0)) for t in trades]
    wins = [r for r in r_vals if r > 0]
    losses = [r for r in r_vals if r <= 0]
    return {
        "total_trades": len(r_vals),
        "winners": len(wins),
        "losers": len(losses),
        "win_rate": (len(wins) / len(r_vals)) if r_vals else 0.0,
        "avg_win_R": (sum(wins) / len(wins)) if wins else 0.0,
        "avg_loss_R": (sum(losses) / len(losses)) if losses else 0.0,
        "expectancy_R": expectancy(trades),
        "profit_factor": (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else (sum(wins) if wins else 0.0),
        "largest_win_R": max(wins) if wins else 0.0,
        "largest_loss_R": min(losses) if losses else 0.0,
    }


def _pass_fail(report: Dict[str, Any], thresholds: Dict[str, Any]) -> Dict[str, Any]:
    ts = report["trades_summary"]
    oos = report["robustness"]["out_of_sample"]
    wf = report["robustness"]["walk_forward"]
    mc = report["robustness"]["monte_carlo"]
    ps = report["robustness"]["parameter_sensitivity"]
    is_small = bool(thresholds.get("small_universe"))
    min_exp = thresholds.get("min_expectancy_R", 0.0)
    min_pf = thresholds.get("min_profit_factor", 1.0)

    reasons: List[str] = []
    if ts["expectancy_R"] > min_exp:
        reasons.append(f"Expectancy meets threshold ({ts['expectancy_R']:.2f}R >= {min_exp:.2f}R)")
    else:
        reasons.append(f"Expectancy below threshold ({ts['expectancy_R']:.2f}R < {min_exp:.2f}R)")
    if oos["oos_expectancy"] > 0:
        reasons.append(f"OOS expectancy positive ({oos['oos_expectancy']:.2f}R)")
    else:
        reasons.append("OOS expectancy <= 0")
    reasons.append(
        f"Walk-forward profitable windows: {wf['pct_profitable_windows']*100:.1f}% "
        f"(threshold {thresholds['min_wf_profitable_windows']*100:.1f}%)"
    )
    reasons.append(
        f"Monte Carlo p95 DD: {mc['p95_dd_pct']:.1f}% "
        f"(threshold < {thresholds['max_mc_p95_dd_pct']:.1f}%)"
    )
    reasons.append(
        f"Sensitivity score: {ps['sensitivity_score']:.1f}/100 "
        f"(threshold < {thresholds['max_sensitivity_score']:.1f})"
    )

    if is_small:
        avg_win = abs(ts.get("avg_win_R", 0.0))
        avg_loss = abs(ts.get("avg_loss_R", 1.0)) or 1.0
        payoff = avg_win / avg_loss
        min_payoff = thresholds.get("min_payoff_ratio", 0.0)
        reasons.append(
            f"Small-universe quality gates: PF={ts['profit_factor']:.2f} (>={min_pf:.2f}), "
            f"Payoff={payoff:.2f} (>={min_payoff:.1f})"
        )

    core_pass = (
        ts["expectancy_R"] > min_exp
        and ts["total_trades"] >= thresholds["min_trades_pass"]
        and oos["oos_expectancy"] > 0
        and ts["profit_factor"] >= min_pf
    )

    if is_small and core_pass:
        avg_win = abs(ts.get("avg_win_R", 0.0))
        avg_loss = abs(ts.get("avg_loss_R", 1.0)) or 1.0
        payoff = avg_win / avg_loss
        if payoff < thresholds.get("min_payoff_ratio", 0.0):
            core_pass = False

    robust_pass = (
        oos["oos_degradation_pct"] < thresholds["max_oos_degradation_pct"]
        and wf["pct_profitable_windows"] >= thresholds["min_wf_profitable_windows"]
        and mc["p95_dd_pct"] < thresholds["max_mc_p95_dd_pct"]
        and ps["sensitivity_score"] < thresholds["max_sensitivity_score"]
    )

    if core_pass and robust_pass:
        verdict = "PASS"
    elif (
        ts["expectancy_R"] <= 0
        or ts["total_trades"] < thresholds["min_trades_fail"]
        or oos["oos_expectancy"] <= 0
        or mc["p99_dd_pct"] > thresholds["max_mc_p99_dd_pct"]
    ):
        verdict = "FAIL"
    else:
        verdict = "NEEDS_REVIEW"

    return {"verdict": verdict, "reasons": reasons}


def _pass_fail_tier1(
    report: Dict[str, Any],
    thresholds: Dict[str, Any],
    tier_label: str = "Tier 1",
) -> Dict[str, Any]:
    ts = report["trades_summary"]
    risk = report["risk_summary"]
    is_small = bool(thresholds.get("small_universe"))
    hard_reasons: List[str] = []
    review_reasons: List[str] = []

    if ts["total_trades"] < thresholds["min_trades_fail"]:
        review_reasons.append(
            f"Too few trades for {tier_label} confidence: {ts['total_trades']} < {thresholds['min_trades_fail']}"
        )
    if ts["expectancy_R"] <= thresholds.get("min_expectancy_R", 0.0):
        if is_small:
            hard_reasons.append(
                f"Expectancy below small-universe minimum: {ts['expectancy_R']:.3f}R < {thresholds['min_expectancy_R']:.2f}R"
            )
        elif ts["expectancy_R"] <= 0:
            hard_reasons.append(f"Expectancy not positive: {ts['expectancy_R']:.3f}R")
    if ts["profit_factor"] < thresholds.get("min_profit_factor", 1.0):
        hard_reasons.append(f"Profit factor below threshold: {ts['profit_factor']:.3f} < {thresholds['min_profit_factor']:.2f}")
    if risk["max_drawdown_pct"] > thresholds["max_mc_p95_dd_pct"]:
        hard_reasons.append(
            f"Drawdown above {tier_label} risk ceiling: {risk['max_drawdown_pct']:.1f}% > {thresholds['max_mc_p95_dd_pct']:.1f}%"
        )
    if is_small:
        avg_win = abs(ts.get("avg_win_R", 0.0))
        avg_loss = abs(ts.get("avg_loss_R", 1.0)) or 1.0
        payoff = avg_win / avg_loss
        min_payoff = thresholds.get("min_payoff_ratio", 0.0)
        if min_payoff > 0 and payoff < min_payoff:
            hard_reasons.append(
                f"Payoff ratio below small-universe minimum: {payoff:.2f} < {min_payoff:.1f} (avg_win/avg_loss)"
            )

    if hard_reasons:
        return {"verdict": "FAIL", "reasons": hard_reasons + review_reasons}

    pass_reasons: List[str] = []
    if ts["total_trades"] >= thresholds["min_trades_pass"]:
        pass_reasons.append(f"Trade count meets {tier_label} pass threshold ({ts['total_trades']}).")
    else:
        review_reasons.append(
            f"Trade count below {tier_label} pass threshold ({ts['total_trades']} < {thresholds['min_trades_pass']}); flagging for review."
        )

    if is_small:
        pass_reasons.append(
            f"Small-universe quality gates applied: expectancy >= {thresholds['min_expectancy_R']:.2f}R, "
            f"PF >= {thresholds['min_profit_factor']:.2f}, payoff >= {thresholds['min_payoff_ratio']:.1f}, "
            f"DD < {thresholds['max_mc_p95_dd_pct']:.0f}%."
        )

    pass_reasons.append(f"{tier_label} robustness suite deferred to Tier 2/3 by design.")

    if ts["total_trades"] >= thresholds["min_trades_pass"]:
        return {"verdict": "PASS", "reasons": pass_reasons}
    return {"verdict": "NEEDS_REVIEW", "reasons": review_reasons + pass_reasons}


def _worker_init() -> None:
    """Ensure the services directory and its sub-packages are on sys.path in
    spawned worker processes, and enable backtest mode to suppress verbose
    diagnostic prints.  Globals don't carry across process boundaries, so
    each worker must set them independently.
    """
    services_dir = os.path.dirname(os.path.abspath(__file__))
    sdk_dir = os.path.join(services_dir, "platform_sdk")
    plugins_dir = os.path.join(services_dir, "plugins")
    for d in (services_dir, sdk_dir, plugins_dir):
        if d not in sys.path:
            sys.path.insert(0, d)
    from platform_sdk.rdp import set_backtest_mode as _rdp_bm
    from platform_sdk.swing_structure import set_backtest_mode as _sw_bm
    _rdp_bm(True)
    _sw_bm(True)


def _backtest_one_symbol(
    sym: str,
    interval: str,
    bars: List[Dict[str, Any]],
    spec: Dict[str, Any],
    report_id: str,
    strategy_version_id: str,
    is_tier1_fast: bool,
) -> Dict[str, Any]:
    """Backtest one symbol. Runs in a worker process via ProcessPoolExecutor."""
    t0 = time.monotonic()
    try:
        baseline_signals = _get_signal_indices_from_primitive(sym, interval, bars, spec)
        trades_with_rules, exec_stats = run_backtest_on_bars(
            sym, interval, bars, spec, apply_execution_rules=True,
            signal_indices=baseline_signals,
        )
        trades_without_rules = []
        if not is_tier1_fast:
            trades_without_rules, _ = run_backtest_on_bars(
                sym, interval, bars, spec, apply_execution_rules=False,
                signal_indices=baseline_signals,
            )
        return {
            "sym": sym,
            "trades_with_rules": trades_to_dicts(trades_with_rules, report_id, strategy_version_id),
            "trades_without_rules": trades_to_dicts(trades_without_rules, report_id, strategy_version_id),
            "exec_stats": exec_stats,
            "error": None,
            "elapsed": time.monotonic() - t0,
        }
    except Exception as exc:
        return {
            "sym": sym,
            "trades_with_rules": [],
            "trades_without_rules": [],
            "exec_stats": {},
            "error": str(exc),
            "elapsed": time.monotonic() - t0,
        }


def _nudge_one_symbol(
    sym: str,
    interval: str,
    bars: List[Dict[str, Any]],
    spec2: Dict[str, Any],
    report_id: str,
    strategy_version_id: str,
) -> List[Dict[str, Any]]:
    """Run a single nudged backtest for parameter sensitivity. Worker function."""
    try:
        t, _ = run_backtest_on_bars(sym, interval, bars, spec2, apply_execution_rules=True)
        return trades_to_dicts(t, report_id, strategy_version_id)
    except Exception:
        return []


def run_pipeline(
    spec: Dict[str, Any],
    date_start: str,
    date_end: str,
    universe: List[str] | None = None,
    validation_tier: str = "tier3",
    job_id: str | None = None,
) -> Dict[str, Any]:
    # Clear RDP caches at the start of each run so a fresh run isn't polluted
    # by a prior run's data (different date ranges → different bar arrays).
    clear_rdp_cache()
    clear_rdp_precomputed()
    _set_rdp_backtest_mode(True)
    _set_swing_backtest_mode(True)

    report_id = f"rpt_{uuid4().hex[:8]}"
    strategy_version_id = spec.get("strategy_version_id") or "unknown"
    spec_universe = spec.get("universe")
    if universe is not None and len(universe) > 0:
        symbols = universe
    elif isinstance(spec_universe, list) and len(spec_universe) > 0:
        symbols = spec_universe
    else:
        symbols = ["SPY", "QQQ"]
    interval = spec.get("interval") or (spec.get("timeframes") or ["1wk"])[0] or "1wk"

    # Extend data window backward so indicators (e.g. SMA-200) are fully
    # warmed up by the time the trading window starts.
    warmup_bars = _compute_warmup_bars(spec, interval)
    fetch_date_start = _extend_date_start(date_start, warmup_bars, interval)
    print(
        f"[Validator] Warmup: {warmup_bars} bars → fetch from {fetch_date_start} "
        f"(original date_start={date_start})",
        file=sys.stderr,
    )

    # Yahoo Finance caps intraday history to ~730 days; enforce date_start floor
    if interval in ("1h", "4h", "1m", "2m", "5m", "15m", "30m", "60m", "90m"):
        from datetime import timedelta
        max_lookback_days = 720
        earliest = datetime.now() - timedelta(days=max_lookback_days)
        earliest_str = earliest.strftime("%Y-%m-%d")
        if fetch_date_start < earliest_str:
            fetch_date_start = earliest_str

    tier_key = str(validation_tier or "tier3").strip().lower()
    if tier_key not in ("tier1", "tier1b", "tier2", "tier3"):
        tier_key = "tier3"
    thresholds = _validator_thresholds(spec, tier_key, universe_size=len(symbols))
    is_tier1_fast = tier_key in ("tier1", "tier1b")
    evidence_tier_label = "Tier 1B" if tier_key == "tier1b" else "Tier 1"
    extra_passes_after_baseline = 0 if is_tier1_fast else 6
    baseline_progress_span = 0.60 if is_tier1_fast else 0.25

    data_cache: Dict[str, List[Dict[str, Any]]] = {}
    all_trades: List[Dict[str, Any]] = []
    all_trades_no_rules: List[Dict[str, Any]] = []
    exec_totals = {
        "breakeven_triggers": 0,
        "ladder_lock_triggers": 0,
        "green_to_red_exits": 0,
        "scale_out_triggers": 0,
        "time_stop_exits": 0,
        "profit_retrace_exits": 0,
        "daily_cap_triggers": 0,
        "avg_giveback_from_peak_R_sum": 0.0,
        "pct_trades_hitting_breakeven_sum": 0.0,
        "pct_trades_hitting_scale_out_sum": 0.0,
        "symbols_counted": 0,
    }

    n_symbols = max(1, len(symbols))
    global _pipeline_start_time
    _pipeline_start_time = time.monotonic()
    _backtest_times: List[float] = []
    tier1_early_stop_reason: str | None = None
    tier1_symbols_processed = 0
    snapshot_path = _snapshot_path(symbols, interval, fetch_date_start, date_end)
    snapshot_loaded_from_cache = False

    # Stage 1: data materialization (download + save snapshot).
    _emit_progress(0.05, "loading_data", f"Preparing data snapshot for {n_symbols} symbols (warmup from {fetch_date_start})...")
    cached_data = _load_snapshot(snapshot_path)
    if cached_data is not None:
        snapshot_loaded_from_cache = True
        for sym in symbols:
            data_cache[sym] = cached_data.get(sym, [])
        empty_count = sum(1 for sym in symbols if not data_cache.get(sym))
        suffix = f" - {empty_count} symbols without data" if empty_count > 0 else ""
        _emit_progress(0.20, "loading_data", f"Loaded cached snapshot {os.path.basename(snapshot_path)}{suffix}")
    else:
        invalid_cache = _load_invalid_symbol_cache()
        now_ts = datetime.utcnow().timestamp()
        invalid_skipped_cached: List[str] = []
        invalid_discovered: List[str] = []
        _download_times: List[float] = []
        for idx, sym in enumerate(symbols):
            if _is_recent_invalid(invalid_cache.get(sym, {}), now_ts):
                data_cache[sym] = []
                invalid_skipped_cached.append(sym)
                remaining_downloads = n_symbols - (idx + 1)
                avg_dl = statistics.mean(_download_times) if _download_times else 1.0
                avg_bt_guess = max(2.0, avg_dl * 0.8)
                eta = remaining_downloads * avg_dl + (n_symbols + extra_passes_after_baseline * n_symbols) * avg_bt_guess
                _emit_progress(
                    0.05 + ((idx + 1) / n_symbols) * 0.15,
                    "loading_data",
                    f"Skipped {sym} (known invalid symbol cache) - {_format_eta(eta)}",
                    eta_seconds=eta,
                )
                continue

            dl_start = time.monotonic()
            bars, status = load_ohlcv(sym, interval, fetch_date_start, date_end)
            data_cache[sym] = bars
            dl_elapsed = time.monotonic() - dl_start
            _download_times.append(dl_elapsed)

            remaining_downloads = n_symbols - (idx + 1)
            avg_dl = statistics.mean(_download_times) if _download_times else 1.0
            avg_bt_guess = max(2.0, avg_dl * 0.8)
            eta = remaining_downloads * avg_dl + (n_symbols + extra_passes_after_baseline * n_symbols) * avg_bt_guess
            detail = f"Downloaded {sym} ({idx + 1}/{n_symbols})"
            if not bars:
                if status == "invalid_symbol":
                    invalid_cache[sym] = {"last_seen": _now_iso(), "reason": "invalid_symbol"}
                    invalid_discovered.append(sym)
                    detail += " - invalid symbol"
                else:
                    detail += " - no data"
            elif sym in invalid_cache:
                # Symbol recovered or data became available again.
                invalid_cache.pop(sym, None)
            _emit_progress(
                0.05 + ((idx + 1) / n_symbols) * 0.15,
                "loading_data",
                f"{detail} - {_format_eta(eta)}",
                eta_seconds=eta,
            )

        _save_invalid_symbol_cache(invalid_cache)
        if invalid_skipped_cached or invalid_discovered:
            total_invalid = len(invalid_skipped_cached) + len(invalid_discovered)
            _emit_progress(
                0.21,
                "loading_data",
                (
                    f"Invalid symbol summary: {total_invalid} total "
                    f"({len(invalid_skipped_cached)} cached skips, {len(invalid_discovered)} new)"
                ),
            )

        _emit_progress(0.22, "saving_snapshot", f"Saving snapshot ({n_symbols} symbols)...")
        _save_snapshot(snapshot_path, data_cache, symbols, interval, fetch_date_start, date_end)
        _emit_progress(0.25, "saving_snapshot", f"Snapshot saved: {os.path.basename(snapshot_path)}")

    # Stage 2: parallel baseline backtests from local snapshot.
    _emit_progress(
        0.25, "running_backtest",
        f"Running baseline backtests from snapshot ({n_symbols} symbols, {_N_BACKTEST_WORKERS} workers)...",
    )

    # Separate symbols that have data from those that don't.
    syms_with_data = [(sym, data_cache.get(sym) or []) for sym in symbols if data_cache.get(sym)]
    syms_no_data = [sym for sym in symbols if not data_cache.get(sym)]

    # Emit instant progress for no-data symbols.
    n_completed = 0
    for sym in syms_no_data:
        n_completed += 1
        _emit_progress(
            0.25 + (n_completed / n_symbols) * baseline_progress_span,
            "running_backtest",
            f"Backtested {sym} ({n_completed}/{n_symbols}) - no data",
        )

    tier1_done = False
    with ProcessPoolExecutor(
        max_workers=_N_BACKTEST_WORKERS,
        initializer=_worker_init,
    ) as executor:
        future_to_sym = {
            executor.submit(
                _backtest_one_symbol,
                sym, interval, bars, spec, report_id, strategy_version_id, is_tier1_fast,
            ): sym
            for sym, bars in syms_with_data
        }

        for future in as_completed(future_to_sym):
            if _is_cancelled(job_id):
                for f in future_to_sym:
                    f.cancel()
                # Kill worker processes immediately — future.cancel() only
                # prevents queued tasks, it can't stop running processes.
                _kill_executor_workers(executor)
                raise RuntimeError("Validation cancelled by user")

            if tier1_done:
                # Early stop triggered — drain remaining futures without processing
                future.cancel()
                continue

            result = future.result()
            n_completed += 1
            sym = result["sym"]
            tier1_symbols_processed = n_completed

            _backtest_times.append(result["elapsed"])
            avg_bt = statistics.mean(_backtest_times)
            remaining = n_symbols - n_completed
            # With parallel workers the effective wall-clock remaining is shorter
            eta = (remaining / _N_BACKTEST_WORKERS) * avg_bt + extra_passes_after_baseline * n_symbols * avg_bt
            detail = f"Backtested {sym} ({n_completed}/{n_symbols})"
            if result["error"]:
                detail += f" - error: {result['error'][:60]}"
            _emit_progress(
                0.25 + (n_completed / n_symbols) * baseline_progress_span,
                "running_backtest",
                f"{detail} - {_format_eta(eta)}",
                eta_seconds=eta,
            )

            all_trades.extend(result["trades_with_rules"])
            if not is_tier1_fast:
                all_trades_no_rules.extend(result["trades_without_rules"])

            es = result["exec_stats"]
            exec_totals["breakeven_triggers"] += int(es.get("breakeven_triggers", 0))
            exec_totals["ladder_lock_triggers"] += int(es.get("ladder_lock_triggers", 0))
            exec_totals["green_to_red_exits"] += int(es.get("green_to_red_exits", 0))
            exec_totals["scale_out_triggers"] += int(es.get("scale_out_triggers", 0))
            exec_totals["time_stop_exits"] += int(es.get("time_stop_exits", 0))
            exec_totals["profit_retrace_exits"] += int(es.get("profit_retrace_exits", 0))
            exec_totals["daily_cap_triggers"] += int(es.get("daily_cap_triggers", 0))
            exec_totals["avg_giveback_from_peak_R_sum"] += float(es.get("avg_giveback_from_peak_R", 0.0))
            exec_totals["pct_trades_hitting_breakeven_sum"] += float(es.get("pct_trades_hitting_breakeven", 0.0))
            exec_totals["pct_trades_hitting_scale_out_sum"] += float(es.get("pct_trades_hitting_scale_out", 0.0))
            exec_totals["symbols_counted"] += 1

            if is_tier1_fast:
                partial_ts = _trade_summary(all_trades)
                if partial_ts["total_trades"] >= thresholds["min_trades_fail"] and partial_ts["expectancy_R"] <= 0:
                    tier1_early_stop_reason = (
                        f"{evidence_tier_label} early fail after {partial_ts['total_trades']} trades "
                        f"(expectancy={partial_ts['expectancy_R']:.3f}R)."
                    )
                elif (
                    partial_ts["total_trades"] >= thresholds["min_trades_pass"]
                    and partial_ts["expectancy_R"] > 0
                    and partial_ts["profit_factor"] >= 1.0
                ):
                    tier1_early_stop_reason = (
                        f"{evidence_tier_label} early pass evidence reached after {partial_ts['total_trades']} trades "
                        f"(expectancy={partial_ts['expectancy_R']:.3f}R, pf={partial_ts['profit_factor']:.3f})."
                    )

                if tier1_early_stop_reason:
                    _emit_progress(
                        0.88,
                        "running_backtest",
                        f"{tier1_early_stop_reason} Stopping baseline early ({n_completed}/{n_symbols} symbols).",
                    )
                    tier1_done = True

    # Portfolio-level filter: max concurrent positions
    max_concurrent = int((spec.get("risk_config") or {}).get("max_concurrent_positions", 0))
    if max_concurrent > 0 and len(all_trades) > 0:
        all_trades = _filter_max_concurrent(all_trades, max_concurrent)
        if not is_tier1_fast:
            all_trades_no_rules = _filter_max_concurrent(all_trades_no_rules, max_concurrent)

    ts = _trade_summary(all_trades)
    r_vals = [float(t.get("R_multiple", 0.0)) for t in all_trades]
    streak = _streaks(r_vals)
    risk = _risk_metrics(r_vals, r_to_pct=thresholds["r_to_pct"])

    if is_tier1_fast:
        _emit_progress(0.90, "finalizing_report", f"{evidence_tier_label} baseline complete. Building evidence report...")
        oos = {
            "is_expectancy": ts["expectancy_R"],
            "is_n": ts["total_trades"],
            "oos_expectancy": ts["expectancy_R"],
            "oos_n": ts["total_trades"],
            "split_date": date_end,
            "oos_degradation_pct": 0.0,
        }
        wf = {
            "windows": [],
            "avg_test_expectancy": ts["expectancy_R"],
            "pct_profitable_windows": 1.0 if ts["expectancy_R"] > 0 else 0.0,
        }
        mc = {
            "simulations": 0,
            "median_dd_pct": risk["max_drawdown_pct"],
            "p95_dd_pct": risk["max_drawdown_pct"],
            "p99_dd_pct": risk["max_drawdown_pct"],
            "median_final_R": sum(r_vals) if r_vals else 0.0,
            "p5_final_R": min(r_vals) if r_vals else 0.0,
        }
        sens = {
            "params_tested": [],
            "base_expectancy": ts["expectancy_R"],
            "nudged_results": [],
            "sensitivity_score": 0.0,
        }
    else:
        avg_bt = statistics.mean(_backtest_times) if _backtest_times else 1.0
        eta_sensitivity = 6 * n_symbols * avg_bt
        _emit_progress(0.50, "computing_robustness", f"Computing OOS + walk-forward - {_format_eta(eta_sensitivity)}", eta_seconds=eta_sensitivity)
        oos = out_of_sample(all_trades)
        wf = walk_forward(all_trades)
        mc = monte_carlo(all_trades, simulations=1000, seed=42, r_to_pct=thresholds["r_to_pct"])
        _emit_progress(0.55, "computing_robustness", "Monte Carlo complete...")

        sensitivity_params = _resolve_sensitivity_params(spec)
        sensitivity_param_paths = [str(param.get("path") or param.get("label") or "") for param in sensitivity_params]
        sensitivity_param_map = {
            str(param.get("path") or param.get("label") or ""): param
            for param in sensitivity_params
            if str(param.get("path") or param.get("label") or "")
        }
        nudge_count = [0]
        nudge_total = max(1, len(sensitivity_params) * 2)
        _nudge_times: List[float] = []

        _emit_progress(
            0.55,
            "parameter_sensitivity",
            f"Running parameter sensitivity ({nudge_total} reruns across {n_symbols} symbols)...",
        )

        def rerun_with_nudge(param_path: str, factor: float) -> float:
            nudge_start = time.monotonic()
            nudge_count[0] += 1
            direction = "up" if factor > 1 else "down"
            spec2 = copy.deepcopy(spec)
            descriptor = sensitivity_param_map.get(param_path, {"path": param_path, "label": param_path, "type": "float", "min": 0.0001})
            _apply_sensitivity_nudge(spec2, descriptor, factor)

            ntrades: List[Dict[str, Any]] = []
            with ProcessPoolExecutor(max_workers=_N_BACKTEST_WORKERS, initializer=_worker_init) as nudge_exec:
                nudge_futures = [
                    nudge_exec.submit(_nudge_one_symbol, sym, interval, bars, spec2, report_id, strategy_version_id)
                    for sym, bars in data_cache.items()
                    if bars
                ]
                for f in as_completed(nudge_futures):
                    if _is_cancelled(job_id):
                        for nf in nudge_futures:
                            nf.cancel()
                        _kill_executor_workers(nudge_exec)
                        raise RuntimeError("Validation cancelled by user")
                    ntrades.extend(f.result())

            nudge_elapsed = time.monotonic() - nudge_start
            _nudge_times.append(nudge_elapsed)
            remaining_nudges = nudge_total - nudge_count[0]
            avg_nudge = statistics.mean(_nudge_times)
            nudge_eta = remaining_nudges * avg_nudge
            _emit_progress(
                0.55 + (nudge_count[0] / nudge_total) * 0.35,
                "parameter_sensitivity",
                f"Nudged {descriptor.get('label', param_path)} {direction} ({nudge_count[0]}/{nudge_total}) - {_format_eta(nudge_eta)}",
                eta_seconds=nudge_eta,
            )
            return expectancy(ntrades)

        sens = parameter_sensitivity(ts["expectancy_R"], rerun_with_nudge, params=sensitivity_param_paths)
    _emit_progress(0.92, "finalizing_report", "Building report...")

    symbols_counted = max(1, exec_totals["symbols_counted"])
    exp_without_rules = ts["expectancy_R"] if is_tier1_fast else expectancy(all_trades_no_rules)
    exp_with_rules = ts["expectancy_R"]

    report = {
        "report_id": report_id,
        "strategy_version_id": strategy_version_id,
        "config": {
            "date_start": date_start,
            "date_end": date_end,
            "universe": symbols,
            "timeframes": [interval],
            "data_snapshot": {
                "path": snapshot_path,
                "loaded_from_cache": snapshot_loaded_from_cache,
            },
            "costs": {
                "commission_per_trade": float((spec.get("cost_config") or spec.get("costs") or {}).get("commission_per_trade", 1.0)),
                "slippage_pct": float((spec.get("cost_config") or spec.get("costs") or {}).get("slippage_pct", 0.05)),
            },
            "max_concurrent_positions": max_concurrent if max_concurrent > 0 else None,
            "validation_thresholds": thresholds,
            "tier_runtime_profile": f"{tier_key}_baseline_only" if is_tier1_fast else "full_robustness",
            "tier1_early_stop_reason": tier1_early_stop_reason,
            "tier1_symbols_processed": tier1_symbols_processed if is_tier1_fast else n_symbols,
        },
        "trades_summary": ts,
        "risk_summary": {
            **risk,
            "longest_losing_streak": streak["longest_losing"],
            "avg_losing_streak": streak["avg_losing"],
            "longest_winning_streak": streak["longest_winning"],
        },
        "robustness": {
            "out_of_sample": oos,
            "walk_forward": wf,
            "monte_carlo": mc,
            "parameter_sensitivity": sens,
        },
        "execution_stats": {
            "rules_active": bool(spec.get("execution_config")),
            "breakeven_triggers": exec_totals["breakeven_triggers"],
            "ladder_lock_triggers": exec_totals["ladder_lock_triggers"],
            "green_to_red_exits": exec_totals["green_to_red_exits"],
            "scale_out_triggers": exec_totals["scale_out_triggers"],
            "time_stop_exits": exec_totals["time_stop_exits"],
            "profit_retrace_exits": exec_totals["profit_retrace_exits"],
            "daily_cap_triggers": exec_totals["daily_cap_triggers"],
            "avg_giveback_from_peak_R": exec_totals["avg_giveback_from_peak_R_sum"] / symbols_counted,
            "pct_trades_hitting_breakeven": exec_totals["pct_trades_hitting_breakeven_sum"] / symbols_counted,
            "pct_trades_hitting_scale_out": exec_totals["pct_trades_hitting_scale_out_sum"] / symbols_counted,
            "expectancy_without_rules_R": exp_without_rules,
            "expectancy_with_rules_R": exp_with_rules,
        },
        "pass_fail": "NEEDS_REVIEW",
        "pass_fail_reasons": [],
        "decision_log": {"decision": "pending", "decided_by": "", "decided_at": None, "notes": ""},
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    pf = _pass_fail_tier1(report, thresholds, evidence_tier_label) if is_tier1_fast else _pass_fail(report, thresholds)
    report["pass_fail"] = pf["verdict"]
    report["pass_fail_reasons"] = pf["reasons"]
    _emit_progress(0.95, "finalizing_report", "Done.")

    stats = rdp_cache_stats()
    print(
        f"[RDP Cache] hits={stats['hits']} misses={stats['misses']} "
        f"hit_rate={stats['hit_rate_pct']}% entries={stats['entries']}",
        file=sys.stderr,
    )

    _set_rdp_backtest_mode(False)
    _set_swing_backtest_mode(False)
    return {"report": report, "trades": all_trades}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True)
    p.add_argument("--date-start", required=True)
    p.add_argument("--date-end", required=True)
    p.add_argument("--universe", default="")
    p.add_argument("--tier", default="tier3")
    args = p.parse_args()

    with open(args.spec, "r", encoding="utf-8") as f:
        spec = json.load(f)

    universe = [s.strip() for s in args.universe.split(",") if s.strip()] if args.universe else None
    result = run_pipeline(spec, args.date_start, args.date_end, universe, args.tier)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
