"""Bar normalization for the research-v1 structural parser."""

from __future__ import annotations

from typing import List

from platform_sdk.ohlcv import OHLCV

from .schema import BarRecord


def _compute_atr_14(data: List[OHLCV], period: int = 14) -> List[float]:
    if not data:
        return []

    true_ranges = [max(data[0].high - data[0].low, 0.0)]
    for idx in range(1, len(data)):
        bar = data[idx]
        prev_close = data[idx - 1].close
        true_ranges.append(max(
            bar.high - bar.low,
            abs(bar.high - prev_close),
            abs(bar.low - prev_close),
        ))

    atr_values = [0.0] * len(data)
    if len(data) <= period:
        fallback = sum(true_ranges) / max(len(true_ranges), 1)
        return [fallback for _ in data]

    seed = sum(true_ranges[1:period + 1]) / period
    atr_values[period] = seed
    for idx in range(period + 1, len(data)):
        atr_values[idx] = ((atr_values[idx - 1] * (period - 1)) + true_ranges[idx]) / period

    for idx in range(period):
        atr_values[idx] = atr_values[period]

    return atr_values


def normalize_bars(data: List[OHLCV], symbol: str, timeframe: str, atr_period: int = 14) -> List[BarRecord]:
    """Convert raw OHLCV bars into normalized bar records."""
    atr_values = _compute_atr_14(data, period=atr_period)
    records: List[BarRecord] = []

    for idx, bar in enumerate(data):
        bar_range = float(bar.high - bar.low)
        body_size = float(abs(bar.close - bar.open))
        atr = float(atr_values[idx]) if idx < len(atr_values) else 0.0
        denom = atr if atr > 0 else 1.0
        records.append(BarRecord(
            symbol=symbol,
            timeframe=timeframe,
            timestamp=str(bar.timestamp),
            bar_index=idx,
            open=float(bar.open),
            high=float(bar.high),
            low=float(bar.low),
            close=float(bar.close),
            volume=float(bar.volume),
            atr_14=atr,
            bar_range=bar_range,
            body_size=body_size,
            range_atr_norm=bar_range / denom,
            body_atr_norm=body_size / denom,
        ))

    return records
