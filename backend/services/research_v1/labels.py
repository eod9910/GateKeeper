"""Deterministic pivot labeling against prior same-side pivots."""

from __future__ import annotations

from typing import Dict, List, Optional

from .schema import BarRecord, PivotLabel, PivotLabelRecord, PivotRecord, PivotType


def _bars_by_index(bars: List[BarRecord]) -> Dict[int, BarRecord]:
    return {bar.bar_index: bar for bar in bars}


def _same_side_label(
    pivot: PivotRecord,
    comparison: Optional[PivotRecord],
    atr: float,
    equal_band_atr: float,
) -> PivotLabelRecord:
    if comparison is None:
        default_label = PivotLabel.HH if pivot.pivot_type == PivotType.HIGH else PivotLabel.HL
        return PivotLabelRecord(
            pivot_id=pivot.pivot_id,
            major_label=default_label,
            comparison_pivot_id=None,
            price_delta=None,
            price_delta_atr_norm=None,
            equal_band_flag=False,
        )

    price_delta = float(pivot.price - comparison.price)
    atr_denom = atr if atr > 0 else 1.0
    price_delta_atr = price_delta / atr_denom
    equal_band = abs(price_delta_atr) <= equal_band_atr

    if pivot.pivot_type == PivotType.HIGH:
        if equal_band:
            label = PivotLabel.EH
        elif pivot.price > comparison.price:
            label = PivotLabel.HH
        else:
            label = PivotLabel.LH
    else:
        if equal_band:
            label = PivotLabel.EL
        elif pivot.price > comparison.price:
            label = PivotLabel.HL
        else:
            label = PivotLabel.LL

    return PivotLabelRecord(
        pivot_id=pivot.pivot_id,
        major_label=label,
        comparison_pivot_id=comparison.pivot_id,
        price_delta=price_delta,
        price_delta_atr_norm=price_delta_atr,
        equal_band_flag=equal_band,
    )


def label_pivots_against_same_side_history(
    pivots: List[PivotRecord],
    bars: List[BarRecord],
    equal_band_atr: float = 0.25,
) -> List[PivotLabelRecord]:
    """Label each pivot relative to the previous pivot of the same side."""
    by_index = _bars_by_index(bars)
    labels: List[PivotLabelRecord] = []
    previous_high: Optional[PivotRecord] = None
    previous_low: Optional[PivotRecord] = None

    for pivot in pivots:
        pivot_bar = by_index.get(pivot.bar_index)
        atr = pivot_bar.atr_14 if pivot_bar is not None and pivot_bar.atr_14 > 0 else pivot.atr_at_confirmation
        if pivot.pivot_type == PivotType.HIGH:
            record = _same_side_label(pivot, previous_high, atr, equal_band_atr)
            previous_high = pivot
        else:
            record = _same_side_label(pivot, previous_low, atr, equal_band_atr)
            previous_low = pivot
        labels.append(record)

    return labels
