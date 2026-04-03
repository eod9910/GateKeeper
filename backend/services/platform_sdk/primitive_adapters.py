from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

from .numba_indicators import atr, macd, rsi

try:
    import pandas as pd
    from ta.momentum import RSIIndicator
    from ta.trend import MACD as TaMACD
    from ta.volatility import AverageTrueRange
    _TA_AVAILABLE = True
except Exception:
    pd = None
    RSIIndicator = None
    TaMACD = None
    AverageTrueRange = None
    _TA_AVAILABLE = False


def _close_array(data: List[Any]) -> np.ndarray:
    closes: List[float] = []
    for bar in data:
        if isinstance(bar, dict):
            closes.append(float(bar["close"]))
        else:
            closes.append(float(bar.close))
    return np.asarray(closes, dtype=np.float64)


def _high_array(data: List[Any]) -> np.ndarray:
    highs: List[float] = []
    for bar in data:
        if isinstance(bar, dict):
            highs.append(float(bar["high"]))
        else:
            highs.append(float(bar.high))
    return np.asarray(highs, dtype=np.float64)


def _low_array(data: List[Any]) -> np.ndarray:
    lows: List[float] = []
    for bar in data:
        if isinstance(bar, dict):
            lows.append(float(bar["low"]))
        else:
            lows.append(float(bar.low))
    return np.asarray(lows, dtype=np.float64)


def _readiness_payload(values: np.ndarray, warmup_bars: int) -> Dict[str, Any]:
    total = int(len(values))
    valid = np.where(~np.isnan(values))[0]
    if valid.size == 0:
        remaining = max(0, warmup_bars - total)
        return {
            "ready": False,
            "reason": "warmup_incomplete",
            "warmup_bars": int(warmup_bars),
            "warmup_bars_remaining": int(remaining),
            "first_valid_index": None,
        }

    first_valid = int(valid[0])
    remaining = max(0, first_valid - (total - 1))
    return {
        "ready": True,
        "reason": None,
        "warmup_bars": int(warmup_bars),
        "warmup_bars_remaining": int(remaining),
        "first_valid_index": first_valid,
    }


def _pandas_series(values: np.ndarray):
    if pd is None:
        raise RuntimeError("pandas is unavailable")
    return pd.Series(values, dtype="float64")


def compute_rsi_adapter(data: List[Any], period: int = 14) -> Dict[str, Any]:
    closes = _close_array(data)
    source = "numba_indicators.rsi"
    values: np.ndarray
    if _TA_AVAILABLE and RSIIndicator is not None:
        try:
            values = RSIIndicator(close=_pandas_series(closes), window=int(period), fillna=False).rsi().to_numpy(dtype=np.float64)
            source = "ta.momentum.RSIIndicator"
        except Exception:
            values = rsi(closes, int(period))
    else:
        values = rsi(closes, int(period))
    readiness = _readiness_payload(values, int(period))
    return {
      "source": source,
      "values": values,
      "readiness": readiness,
    }


def compute_atr_adapter(data: List[Any], period: int = 14) -> Dict[str, Any]:
    highs = _high_array(data)
    lows = _low_array(data)
    closes = _close_array(data)
    source = "numba_indicators.atr"
    values: np.ndarray
    if _TA_AVAILABLE and AverageTrueRange is not None:
        try:
            values = AverageTrueRange(
                high=_pandas_series(highs),
                low=_pandas_series(lows),
                close=_pandas_series(closes),
                window=int(period),
                fillna=False,
            ).average_true_range().to_numpy(dtype=np.float64)
            values[: max(0, int(period) - 1)] = np.nan
            source = "ta.volatility.AverageTrueRange"
        except Exception:
            values = atr(highs, lows, closes, int(period))
    else:
        values = atr(highs, lows, closes, int(period))
    readiness = _readiness_payload(values, int(period))
    atr_pct = np.empty_like(values, dtype=np.float64)
    atr_pct[:] = np.nan
    for idx in range(len(values)):
        if np.isnan(values[idx]) or closes[idx] == 0:
            continue
        atr_pct[idx] = values[idx] / closes[idx]
    return {
        "source": source,
        "values": values,
        "atr_pct": atr_pct,
        "readiness": readiness,
    }


def compute_macd_adapter(
    data: List[Any],
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9,
) -> Dict[str, Any]:
    closes = _close_array(data)
    source = "numba_indicators.macd"
    if _TA_AVAILABLE and TaMACD is not None:
        try:
            indicator = TaMACD(
                close=_pandas_series(closes),
                window_slow=int(slow_period),
                window_fast=int(fast_period),
                window_sign=int(signal_period),
                fillna=False,
            )
            macd_line = indicator.macd().to_numpy(dtype=np.float64)
            signal_line = indicator.macd_signal().to_numpy(dtype=np.float64)
            histogram = indicator.macd_diff().to_numpy(dtype=np.float64)
            source = "ta.trend.MACD"
        except Exception:
            macd_line, signal_line, histogram = macd(
                closes,
                int(fast_period),
                int(slow_period),
                int(signal_period),
            )
    else:
        macd_line, signal_line, histogram = macd(
            closes,
            int(fast_period),
            int(slow_period),
            int(signal_period),
        )
    readiness = _readiness_payload(histogram, int(slow_period) + int(signal_period))
    return {
        "source": source,
        "macd_line": macd_line,
        "signal_line": signal_line,
        "histogram": histogram,
        "readiness": readiness,
    }
