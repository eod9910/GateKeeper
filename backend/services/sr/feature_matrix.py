"""
Feature matrix builder for Symbolic Regression (bar-level, indicator + OHLCV).

Builds X (features) and y (target) from bar data and config.
Features are configurable: user picks which indicators to include and their periods.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from platform_sdk.numba_indicators import rsi, atr, sma


AVAILABLE_FEATURES = {
    "rsi":          {"label": "RSI",                "default_period": 14,  "description": "Relative Strength Index"},
    "atr_norm":     {"label": "ATR (normalized)",   "default_period": 14,  "description": "Average True Range / price"},
    "momentum":     {"label": "Momentum",           "default_period": 5,   "description": "N-bar return (close-to-close)"},
    "sma_distance": {"label": "SMA Distance",       "default_period": 20,  "description": "(close - SMA) / SMA"},
    "rsi_slope":    {"label": "RSI Slope",          "default_period": 14,  "description": "RSI change over last 3 bars"},
    "range_pct":    {"label": "Range %",            "default_period": 1,   "description": "(high - low) / close"},
}


def _resolve_feature_specs(config: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    config = config or {}
    feature_specs = config.get("features")
    if feature_specs:
        return list(feature_specs)
    return [
        {"id": "rsi", "period": int(config.get("rsi_period", 14))},
        {"id": "atr_norm", "period": int(config.get("atr_period", 14))},
        {"id": "momentum", "period": int(config.get("momentum_bars", 5))},
    ]


def _build_feature_columns(
    bars: List[Dict[str, Any]],
    feature_specs: List[Dict[str, Any]],
) -> Tuple[Dict[str, np.ndarray], List[int], List[str], np.ndarray]:
    closes = np.array([float(b["close"]) for b in bars], dtype=np.float64)
    highs = np.array([float(b["high"]) for b in bars], dtype=np.float64)
    lows = np.array([float(b["low"]) for b in bars], dtype=np.float64)
    n = len(closes)

    atr_period = 14
    for fs in feature_specs:
        if fs["id"] in ("atr_norm",):
            atr_period = int(fs.get("period", 14))
    atr_vals = atr(highs, lows, closes, atr_period)

    columns: Dict[str, np.ndarray] = {}
    warmup_bars: List[int] = []
    feature_names: List[str] = []

    for fs in feature_specs:
        fid = fs["id"]
        period = int(fs.get("period", AVAILABLE_FEATURES.get(fid, {}).get("default_period", 14)))

        if fid == "rsi":
            vals = rsi(closes, period)
            warmup_bars.append(period)
            columns[f"RSI({period})"] = vals
            feature_names.append(f"RSI({period})")

        elif fid == "atr_norm":
            atr_v = atr(highs, lows, closes, period)
            atr_norm = np.empty(n, dtype=np.float64)
            atr_norm[:] = np.nan
            for i in range(n):
                if closes[i] > 0 and not np.isnan(atr_v[i]):
                    atr_norm[i] = atr_v[i] / closes[i]
            warmup_bars.append(period)
            columns[f"ATR_norm({period})"] = atr_norm
            feature_names.append(f"ATR_norm({period})")

        elif fid == "momentum":
            mom = np.empty(n, dtype=np.float64)
            mom[:] = np.nan
            for i in range(period, n):
                if closes[i - period] > 0:
                    mom[i] = (closes[i] - closes[i - period]) / closes[i - period]
            warmup_bars.append(period)
            columns[f"Mom({period})"] = mom
            feature_names.append(f"Mom({period})")

        elif fid == "sma_distance":
            sma_vals = sma(closes, period)
            dist = np.empty(n, dtype=np.float64)
            dist[:] = np.nan
            for i in range(n):
                if not np.isnan(sma_vals[i]) and sma_vals[i] > 0:
                    dist[i] = (closes[i] - sma_vals[i]) / sma_vals[i]
            warmup_bars.append(period)
            columns[f"SMA_dist({period})"] = dist
            feature_names.append(f"SMA_dist({period})")

        elif fid == "rsi_slope":
            rsi_vals = rsi(closes, period)
            slope = np.empty(n, dtype=np.float64)
            slope[:] = np.nan
            for i in range(3, n):
                if not np.isnan(rsi_vals[i]) and not np.isnan(rsi_vals[i - 3]):
                    slope[i] = rsi_vals[i] - rsi_vals[i - 3]
            warmup_bars.append(period + 3)
            columns[f"RSI_slope({period})"] = slope
            feature_names.append(f"RSI_slope({period})")

        elif fid == "range_pct":
            rng = np.empty(n, dtype=np.float64)
            rng[:] = np.nan
            for i in range(n):
                if closes[i] > 0:
                    rng[i] = (highs[i] - lows[i]) / closes[i]
            warmup_bars.append(1)
            columns["Range_pct"] = rng
            feature_names.append("Range_pct")

    return columns, warmup_bars, feature_names, atr_vals


def compute_forward_return(
    closes: np.ndarray,
    atr_arr: np.ndarray,
    n_bars: int = 5,
    atr_normalized: bool = True,
) -> np.ndarray:
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(n - n_bars):
        if atr_normalized and atr_arr[i] is not None and not np.isnan(atr_arr[i]) and atr_arr[i] > 0:
            out[i] = (closes[i + n_bars] - closes[i]) / atr_arr[i]
        else:
            if closes[i] > 0:
                out[i] = (closes[i + n_bars] - closes[i]) / closes[i]
            else:
                out[i] = np.nan
    return out


def build_feature_matrix_from_bars(
    bars: List[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[np.ndarray, np.ndarray, List[Dict[str, Any]]]:
    """
    Build feature matrix X and target y from bar data.

    Config keys:
        features: list of feature specs, e.g. [{"id": "rsi", "period": 14}, {"id": "sma_distance", "period": 20}]
                  If omitted, defaults to [rsi(14), atr_norm(14), momentum(5)].
        target_bars: forward return horizon (default 5)
        target_atr_normalized: y in ATR units (default True)

    Returns:
        X: 2d array (n_rows, n_features)
        y: 1d array
        row_metadata: list of dicts with bar_index, timestamp
    Also sets feature_names on the returned X via X.feature_names attribute hack — or callers
    can use get_feature_names(config) to get the same list.
    """
    config = config or {}
    target_bars = int(config.get("target_bars", 5))
    target_atr_normalized = config.get("target_atr_normalized", True)

    feature_specs = _resolve_feature_specs(config)

    if not bars:
        return np.zeros((0, len(feature_specs))), np.zeros(0), []

    closes = np.array([float(b["close"]) for b in bars], dtype=np.float64)
    n = len(closes)
    columns, warmup_bars, feature_names, atr_vals = _build_feature_columns(bars, feature_specs)

    if not columns:
        return np.zeros((0, 0)), np.zeros(0), []

    start = max(warmup_bars) if warmup_bars else 0
    end = n - target_bars
    if start >= end:
        return np.zeros((0, len(columns))), np.zeros(0), []

    y_full = compute_forward_return(closes, atr_vals, n_bars=target_bars, atr_normalized=target_atr_normalized)

    col_arrays = list(columns.values())
    X_list = []
    y_list = []
    meta_list = []
    for i in range(start, end):
        if np.isnan(y_full[i]):
            continue
        row = []
        skip = False
        for arr in col_arrays:
            if np.isnan(arr[i]):
                skip = True
                break
            row.append(float(arr[i]))
        if skip:
            continue
        X_list.append(row)
        y_list.append(float(y_full[i]))
        ts = bars[i].get("timestamp") or bars[i].get("date") or ""
        meta_list.append({"bar_index": i, "timestamp": ts})

    if not X_list:
        return np.zeros((0, len(columns))), np.zeros(0), []

    X = np.array(X_list, dtype=np.float64)
    y = np.array(y_list, dtype=np.float64)
    return X, y, meta_list


def build_feature_snapshot_from_bars(
    bars: List[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[np.ndarray, Dict[str, Any], List[str]]:
    """
    Build the latest causal feature row from bar data.

    Unlike build_feature_matrix_from_bars(), this does not require a forward
    return target and therefore keeps the most recent valid row.
    """
    config = config or {}
    feature_specs = _resolve_feature_specs(config)

    if not bars:
        return np.zeros(0, dtype=np.float64), {}, []

    columns, warmup_bars, feature_names, _ = _build_feature_columns(bars, feature_specs)
    if not columns:
        return np.zeros(0, dtype=np.float64), {}, []

    start = max(warmup_bars) if warmup_bars else 0
    col_arrays = list(columns.values())
    for i in range(len(bars) - 1, start - 1, -1):
        row = []
        skip = False
        for arr in col_arrays:
            if np.isnan(arr[i]):
                skip = True
                break
            row.append(float(arr[i]))
        if skip:
            continue
        ts = bars[i].get("timestamp") or bars[i].get("date") or ""
        return np.array(row, dtype=np.float64), {"bar_index": i, "timestamp": ts}, feature_names

    return np.zeros(0, dtype=np.float64), {}, feature_names


def get_feature_names(config: Optional[Dict[str, Any]] = None) -> List[str]:
    """Return the list of feature column names for a given config (mirrors build logic)."""
    config = config or {}
    feature_specs = _resolve_feature_specs(config)
    names = []
    for fs in feature_specs:
        fid = fs["id"]
        period = int(fs.get("period", AVAILABLE_FEATURES.get(fid, {}).get("default_period", 14)))
        if fid == "rsi":
            names.append(f"RSI({period})")
        elif fid == "atr_norm":
            names.append(f"ATR_norm({period})")
        elif fid == "momentum":
            names.append(f"Mom({period})")
        elif fid == "sma_distance":
            names.append(f"SMA_dist({period})")
        elif fid == "rsi_slope":
            names.append(f"RSI_slope({period})")
        elif fid == "range_pct":
            names.append("Range_pct")
    return names
