"""Leg construction for the research-v1 structural parser."""

from __future__ import annotations

from typing import Dict, List

from .schema import BarRecord, LegDirection, LegRecord, PivotRecord, PivotType


def _bars_by_index(bars: List[BarRecord]) -> Dict[int, BarRecord]:
    return {bar.bar_index: bar for bar in bars}


def _bar_slice(bars: List[BarRecord], start_index: int, end_index: int) -> List[BarRecord]:
    lo = min(start_index, end_index)
    hi = max(start_index, end_index)
    return [bar for bar in bars if lo <= bar.bar_index <= hi]


def _max_internal_pullback_atr(
    leg_bars: List[BarRecord],
    direction: LegDirection,
    start_price: float,
    end_price: float,
    terminal_atr: float,
) -> float:
    if len(leg_bars) <= 2:
        return 0.0

    denom = terminal_atr if terminal_atr > 0 else 1.0
    if direction == LegDirection.UP:
        running_high = start_price
        max_pullback = 0.0
        for bar in leg_bars[1:-1]:
            running_high = max(running_high, bar.high)
            max_pullback = max(max_pullback, running_high - bar.low)
        return max_pullback / denom

    running_low = start_price
    max_pullback = 0.0
    for bar in leg_bars[1:-1]:
        running_low = min(running_low, bar.low)
        max_pullback = max(max_pullback, bar.high - running_low)
    return max_pullback / denom


def build_leg_records(
    bars: List[BarRecord],
    pivots: List[PivotRecord],
    symbol: str,
    timeframe: str,
) -> List[LegRecord]:
    """Build pivot-to-pivot structural legs from a confirmed pivot stream."""
    if len(pivots) < 2:
        return []

    by_index = _bars_by_index(bars)
    legs: List[LegRecord] = []

    for idx in range(1, len(pivots)):
        start_pivot = pivots[idx - 1]
        end_pivot = pivots[idx]
        leg_bars = _bar_slice(bars, start_pivot.bar_index, end_pivot.bar_index)
        if not leg_bars:
            continue

        direction = LegDirection.UP if end_pivot.price >= start_pivot.price else LegDirection.DOWN
        price_distance = float(end_pivot.price - start_pivot.price)
        terminal_bar = by_index.get(end_pivot.bar_index, leg_bars[-1])
        atr = terminal_bar.atr_14 if terminal_bar.atr_14 > 0 else 1.0
        bar_count = max(end_pivot.bar_index - start_pivot.bar_index, 1)
        distance_atr_norm = abs(price_distance) / atr
        slope_per_bar = price_distance / bar_count
        velocity_atr_per_bar = distance_atr_norm / bar_count
        volume_sum = float(sum(bar.volume for bar in leg_bars))
        avg_bar_range_atr_norm = sum(bar.range_atr_norm for bar in leg_bars) / max(len(leg_bars), 1)
        max_pullback_atr = _max_internal_pullback_atr(
            leg_bars=leg_bars,
            direction=direction,
            start_price=start_pivot.price,
            end_price=end_pivot.price,
            terminal_atr=atr,
        )

        # Simple strength score: reward distance and velocity, penalize internal pullback.
        leg_strength_score = max(0.0, distance_atr_norm + velocity_atr_per_bar - (0.5 * max_pullback_atr))

        legs.append(LegRecord(
            leg_id=f"leg_{idx:06d}",
            symbol=symbol,
            timeframe=timeframe,
            start_pivot_id=start_pivot.pivot_id,
            end_pivot_id=end_pivot.pivot_id,
            direction=direction,
            start_price=float(start_pivot.price),
            end_price=float(end_pivot.price),
            price_distance=price_distance,
            distance_atr_norm=distance_atr_norm,
            bar_count=bar_count,
            slope_per_bar=slope_per_bar,
            velocity_atr_per_bar=velocity_atr_per_bar,
            volume_sum=volume_sum,
            avg_bar_range_atr_norm=avg_bar_range_atr_norm,
            max_internal_pullback_atr=max_pullback_atr,
            leg_strength_score=leg_strength_score,
        ))

    return legs
