"""Forward outcome evaluation for research-v1 motif instances."""

from __future__ import annotations

from typing import Dict, List, Sequence

from .schema import BarRecord, MotifInstanceRecord, OutcomeRecord, PivotRecord, PivotType


def _bars_by_index(bars: Sequence[BarRecord]) -> Dict[int, BarRecord]:
    return {bar.bar_index: bar for bar in bars}


def _pivots_by_id(pivots: Sequence[PivotRecord]) -> Dict[str, PivotRecord]:
    return {pivot.pivot_id: pivot for pivot in pivots}


def _forward_window(
    bars: Sequence[BarRecord],
    start_index: int,
    window_length: int,
) -> List[BarRecord]:
    end_index = start_index + window_length
    return [bar for bar in bars if start_index < bar.bar_index <= end_index]


def _last_structural_level(
    motif_pivots: Sequence[PivotRecord],
    pivot_type: PivotType,
) -> float | None:
    for pivot in reversed(motif_pivots):
        if pivot.pivot_type == pivot_type:
            return float(pivot.price)
    return None


def _return_atr(entry_close: float, future_close: float, entry_atr: float) -> float:
    denom = entry_atr if entry_atr > 0 else 1.0
    return (future_close - entry_close) / denom


def _mfe_mae_atr(entry_close: float, future_bars: Sequence[BarRecord], entry_atr: float) -> tuple[float, float]:
    denom = entry_atr if entry_atr > 0 else 1.0
    mfe = max(0.0, max((bar.high - entry_close) / denom for bar in future_bars))
    mae = max(0.0, max((entry_close - bar.low) / denom for bar in future_bars))
    return mfe, mae


def _first_hit_sequence(
    entry_close: float,
    future_bars: Sequence[BarRecord],
    entry_atr: float,
) -> tuple[bool, bool]:
    plus_level = entry_close + entry_atr
    minus_level = entry_close - entry_atr
    for bar in future_bars:
        hit_plus = bar.high >= plus_level
        hit_minus = bar.low <= minus_level
        if hit_plus and not hit_minus:
            return True, False
        if hit_minus and not hit_plus:
            return False, True
        if hit_plus and hit_minus:
            return False, False
    return False, False


def _structural_break_flags(
    motif_pivots: Sequence[PivotRecord],
    future_bars: Sequence[BarRecord],
) -> tuple[bool, bool]:
    recent_high = _last_structural_level(motif_pivots, PivotType.HIGH)
    recent_low = _last_structural_level(motif_pivots, PivotType.LOW)

    next_break_up = False
    next_break_down = False
    for bar in future_bars:
        if recent_high is not None and bar.high > recent_high:
            next_break_up = True
        if recent_low is not None and bar.low < recent_low:
            next_break_down = True
    return next_break_up, next_break_down


def evaluate_motif_outcomes(
    motifs: Sequence[MotifInstanceRecord],
    pivots: Sequence[PivotRecord],
    bars: Sequence[BarRecord],
    forward_5: int = 5,
    forward_10: int = 10,
) -> List[OutcomeRecord]:
    """Attach causal forward outcomes to each motif instance."""
    pivot_lookup = _pivots_by_id(pivots)
    bar_lookup = _bars_by_index(bars)
    outcomes: List[OutcomeRecord] = []

    for motif in motifs:
        if not motif.pivot_ids:
            continue

        pivot_5 = pivot_lookup[motif.pivot_ids[-1]]
        entry_bar = bar_lookup.get(pivot_5.confirmation_bar_index)
        if entry_bar is None:
            continue

        entry_index = entry_bar.bar_index
        entry_close = float(entry_bar.close)
        entry_atr = float(entry_bar.atr_14 if entry_bar.atr_14 > 0 else 1.0)

        future_5_bars = _forward_window(bars, entry_index, forward_5)
        future_10_bars = _forward_window(bars, entry_index, forward_10)
        motif_pivots = [pivot_lookup[pivot_id] for pivot_id in motif.pivot_ids if pivot_id in pivot_lookup]

        forward_5_return_atr = None
        if len(future_5_bars) >= forward_5:
            forward_5_return_atr = _return_atr(entry_close, future_5_bars[-1].close, entry_atr)

        forward_10_return_atr = None
        mfe_10_atr = None
        mae_10_atr = None
        hit_plus_1atr_first = None
        hit_minus_1atr_first = None
        next_break_up = None
        next_break_down = None

        if len(future_10_bars) >= forward_10:
            forward_10_return_atr = _return_atr(entry_close, future_10_bars[-1].close, entry_atr)
            mfe_10_atr, mae_10_atr = _mfe_mae_atr(entry_close, future_10_bars, entry_atr)
            hit_plus_1atr_first, hit_minus_1atr_first = _first_hit_sequence(entry_close, future_10_bars, entry_atr)
            next_break_up, next_break_down = _structural_break_flags(motif_pivots, future_10_bars)

        outcomes.append(OutcomeRecord(
            motif_instance_id=motif.motif_instance_id,
            entry_bar_index=entry_index,
            entry_timestamp=entry_bar.timestamp,
            entry_close=entry_close,
            entry_atr=entry_atr,
            forward_5_return_atr=forward_5_return_atr,
            forward_10_return_atr=forward_10_return_atr,
            mfe_10_atr=mfe_10_atr,
            mae_10_atr=mae_10_atr,
            hit_plus_1atr_first=hit_plus_1atr_first,
            hit_minus_1atr_first=hit_minus_1atr_first,
            next_break_up=next_break_up,
            next_break_down=next_break_down,
        ))

    return outcomes
