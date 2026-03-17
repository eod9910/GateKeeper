"""ATR-reversal pivot state machine for the research-v1 structural parser."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .schema import BarRecord, PivotRecord, PivotType


@dataclass
class _PivotCandidate:
    pivot_type: PivotType
    bar_index: int
    timestamp: str
    price: float


def _opposite_pivot_type(pivot_type: PivotType) -> PivotType:
    return PivotType.LOW if pivot_type == PivotType.HIGH else PivotType.HIGH


def _candidate_from_bar(bar: BarRecord, pivot_type: PivotType) -> _PivotCandidate:
    price = bar.high if pivot_type == PivotType.HIGH else bar.low
    return _PivotCandidate(
        pivot_type=pivot_type,
        bar_index=bar.bar_index,
        timestamp=bar.timestamp,
        price=float(price),
    )


def _replace_candidate_if_more_extreme(candidate: _PivotCandidate, bar: BarRecord) -> _PivotCandidate:
    if candidate.pivot_type == PivotType.HIGH and bar.high >= candidate.price:
        return _candidate_from_bar(bar, PivotType.HIGH)
    if candidate.pivot_type == PivotType.LOW and bar.low <= candidate.price:
        return _candidate_from_bar(bar, PivotType.LOW)
    return candidate


def _reversal_amount(candidate: _PivotCandidate, bar: BarRecord) -> float:
    if candidate.pivot_type == PivotType.HIGH:
        return candidate.price - bar.low
    return bar.high - candidate.price


def _candidate_is_confirmable(
    candidate: _PivotCandidate,
    bar: BarRecord,
    reversal_multiple: float,
    min_bars_between_pivots: int,
    previous_pivot: Optional[PivotRecord],
) -> bool:
    if bar.bar_index <= candidate.bar_index:
        return False
    threshold = reversal_multiple * max(bar.atr_14, 0.0)
    if threshold <= 0:
        return False
    if _reversal_amount(candidate, bar) < threshold:
        return False
    if previous_pivot is not None and (bar.bar_index - previous_pivot.bar_index) < min_bars_between_pivots:
        return False
    return True


def _build_pivot_record(
    candidate: _PivotCandidate,
    confirmation_bar: BarRecord,
    previous_pivot: Optional[PivotRecord],
    symbol: str,
    timeframe: str,
    pivot_number: int,
) -> PivotRecord:
    prev_distance = None
    bars_from_prev = None
    if previous_pivot is not None:
        prev_distance = abs(candidate.price - previous_pivot.price) / max(confirmation_bar.atr_14, 1e-9)
        bars_from_prev = candidate.bar_index - previous_pivot.bar_index

    return PivotRecord(
        pivot_id=f"pivot_{pivot_number:06d}",
        symbol=symbol,
        timeframe=timeframe,
        bar_index=candidate.bar_index,
        timestamp=candidate.timestamp,
        price=float(candidate.price),
        pivot_type=candidate.pivot_type,
        candidate_bar_index=candidate.bar_index,
        confirmation_bar_index=confirmation_bar.bar_index,
        confirmation_delay_bars=confirmation_bar.bar_index - candidate.bar_index,
        atr_at_confirmation=float(confirmation_bar.atr_14),
        distance_from_prev_pivot_atr=prev_distance,
        bars_from_prev_pivot=bars_from_prev,
    )


def _choose_initial_confirmation(
    high_candidate: _PivotCandidate,
    low_candidate: _PivotCandidate,
    bar: BarRecord,
    reversal_multiple: float,
    min_bars_between_pivots: int,
) -> Optional[_PivotCandidate]:
    high_ready = _candidate_is_confirmable(
        high_candidate,
        bar,
        reversal_multiple=reversal_multiple,
        min_bars_between_pivots=min_bars_between_pivots,
        previous_pivot=None,
    )
    low_ready = _candidate_is_confirmable(
        low_candidate,
        bar,
        reversal_multiple=reversal_multiple,
        min_bars_between_pivots=min_bars_between_pivots,
        previous_pivot=None,
    )

    if not high_ready and not low_ready:
        return None
    if high_ready and not low_ready:
        return high_candidate
    if low_ready and not high_ready:
        return low_candidate

    high_reversal = _reversal_amount(high_candidate, bar)
    low_reversal = _reversal_amount(low_candidate, bar)
    if high_reversal > low_reversal:
        return high_candidate
    if low_reversal > high_reversal:
        return low_candidate
    if high_candidate.bar_index < low_candidate.bar_index:
        return high_candidate
    return low_candidate


def extract_atr_reversal_pivots(
    bars: List[BarRecord],
    symbol: str,
    timeframe: str,
    reversal_multiple: float = 1.5,
    min_bars_between_pivots: int = 3,
) -> List[PivotRecord]:
    """Extract a causal alternating pivot stream using ATR reversal confirmation."""
    if len(bars) < 2:
        return []

    pivots: List[PivotRecord] = []
    pivot_number = 1

    initial_high = _candidate_from_bar(bars[0], PivotType.HIGH)
    initial_low = _candidate_from_bar(bars[0], PivotType.LOW)
    active_candidate: Optional[_PivotCandidate] = None

    for bar in bars[1:]:
        if not pivots:
            initial_high = _replace_candidate_if_more_extreme(initial_high, bar)
            initial_low = _replace_candidate_if_more_extreme(initial_low, bar)
            initial_choice = _choose_initial_confirmation(
                high_candidate=initial_high,
                low_candidate=initial_low,
                bar=bar,
                reversal_multiple=reversal_multiple,
                min_bars_between_pivots=min_bars_between_pivots,
            )
            if initial_choice is None:
                continue

            confirmed = _build_pivot_record(
                candidate=initial_choice,
                confirmation_bar=bar,
                previous_pivot=None,
                symbol=symbol,
                timeframe=timeframe,
                pivot_number=pivot_number,
            )
            pivots.append(confirmed)
            pivot_number += 1
            active_candidate = _candidate_from_bar(bar, _opposite_pivot_type(confirmed.pivot_type))
            continue

        previous_pivot = pivots[-1]
        expected_type = _opposite_pivot_type(previous_pivot.pivot_type)
        if active_candidate is None or active_candidate.pivot_type != expected_type:
            active_candidate = _candidate_from_bar(bar, expected_type)

        active_candidate = _replace_candidate_if_more_extreme(active_candidate, bar)
        if not _candidate_is_confirmable(
            active_candidate,
            bar,
            reversal_multiple=reversal_multiple,
            min_bars_between_pivots=min_bars_between_pivots,
            previous_pivot=previous_pivot,
        ):
            continue

        confirmed = _build_pivot_record(
            candidate=active_candidate,
            confirmation_bar=bar,
            previous_pivot=previous_pivot,
            symbol=symbol,
            timeframe=timeframe,
            pivot_number=pivot_number,
        )
        pivots.append(confirmed)
        pivot_number += 1
        active_candidate = _candidate_from_bar(bar, _opposite_pivot_type(confirmed.pivot_type))

    return pivots
