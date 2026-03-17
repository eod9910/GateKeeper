"""5-pivot motif generation for the research-v1 structural parser."""

from __future__ import annotations

from typing import Dict, List, Sequence

from .schema import (
    LegDirection,
    LegRecord,
    MotifInstanceRecord,
    PivotLabel,
    PivotLabelRecord,
    PivotRecord,
    PivotType,
)


def _leg_by_end_pivot(legs: List[LegRecord]) -> Dict[str, LegRecord]:
    return {leg.end_pivot_id: leg for leg in legs}


def _label_by_pivot_id(labels: List[PivotLabelRecord]) -> Dict[str, PivotLabelRecord]:
    return {label.pivot_id: label for label in labels}


def _retrace_ratio(current_leg: LegRecord, prior_leg: LegRecord) -> float:
    prior_distance = abs(prior_leg.price_distance)
    if prior_distance <= 0:
        return 0.0
    return abs(current_leg.price_distance) / prior_distance


def _build_feature_vector(pivots: Sequence[PivotRecord], legs: Sequence[LegRecord]) -> Dict[str, float | str | bool | None]:
    feature_vector: Dict[str, float | str | bool | None] = {
        "pivot_count": len(pivots),
        "leg_count": len(legs),
        "net_move": float(pivots[-1].price - pivots[0].price),
        "span_bars": float(pivots[-1].bar_index - pivots[0].bar_index),
    }

    for idx, leg in enumerate(legs, start=1):
        feature_vector[f"leg{idx}_dist_atr"] = leg.distance_atr_norm
        feature_vector[f"leg{idx}_bars"] = float(leg.bar_count)
        feature_vector[f"leg{idx}_velocity"] = leg.velocity_atr_per_bar
        feature_vector[f"leg{idx}_strength"] = leg.leg_strength_score

    if len(legs) >= 2:
        feature_vector["leg2_retrace_of_leg1"] = _retrace_ratio(legs[1], legs[0])
    if len(legs) >= 3:
        feature_vector["leg3_retrace_of_leg2"] = _retrace_ratio(legs[2], legs[1])
    if len(legs) >= 4:
        feature_vector["leg4_retrace_of_leg3"] = _retrace_ratio(legs[3], legs[2])

    return feature_vector


def _build_family_signature(
    pivots: Sequence[PivotRecord],
    labels: Sequence[PivotLabelRecord],
    legs: Sequence[LegRecord],
) -> str:
    pivot_type_seq = "-".join(pivot.pivot_type.value for pivot in pivots)
    pivot_label_seq = "-".join(label.major_label.value for label in labels)
    leg_direction_seq = "-".join(leg.direction.value for leg in legs)

    retrace_bins: List[str] = []
    for idx in range(1, len(legs)):
        ratio = _retrace_ratio(legs[idx], legs[idx - 1])
        if ratio < 0.38:
            retrace_bins.append(f"R{idx+1}:SHALLOW")
        elif ratio < 0.62:
            retrace_bins.append(f"R{idx+1}:MEDIUM")
        elif ratio <= 1.0:
            retrace_bins.append(f"R{idx+1}:DEEP")
        else:
            retrace_bins.append(f"R{idx+1}:OVERDEEP")

    return "|".join([
        pivot_type_seq,
        pivot_label_seq,
        leg_direction_seq,
        *retrace_bins,
    ])


def build_five_pivot_motifs(
    pivots: List[PivotRecord],
    legs: List[LegRecord],
    labels: List[PivotLabelRecord],
    symbol: str,
    timeframe: str,
) -> List[MotifInstanceRecord]:
    """Roll a 5-pivot window across the confirmed structure stream."""
    if len(pivots) < 5:
        return []

    leg_by_end = _leg_by_end_pivot(legs)
    label_by_pivot = _label_by_pivot_id(labels)
    motifs: List[MotifInstanceRecord] = []

    for start_idx in range(0, len(pivots) - 4):
        window_pivots = pivots[start_idx:start_idx + 5]
        window_labels = [label_by_pivot[pivot.pivot_id] for pivot in window_pivots if pivot.pivot_id in label_by_pivot]
        if len(window_labels) != 5:
            continue

        window_legs: List[LegRecord] = []
        for pivot in window_pivots[1:]:
            leg = leg_by_end.get(pivot.pivot_id)
            if leg is None:
                window_legs = []
                break
            window_legs.append(leg)
        if len(window_legs) != 4:
            continue

        feature_vector = _build_feature_vector(window_pivots, window_legs)
        family_signature = _build_family_signature(window_pivots, window_labels, window_legs)

        motifs.append(MotifInstanceRecord(
            motif_instance_id=f"motif_{start_idx + 1:06d}",
            symbol=symbol,
            timeframe=timeframe,
            start_bar_index=window_pivots[0].bar_index,
            end_bar_index=window_pivots[-1].bar_index,
            pivot_ids=[pivot.pivot_id for pivot in window_pivots],
            leg_ids=[leg.leg_id for leg in window_legs],
            pivot_type_seq=[pivot.pivot_type for pivot in window_pivots],
            pivot_label_seq=[label.major_label for label in window_labels],
            leg_direction_seq=[leg.direction for leg in window_legs],
            feature_vector=feature_vector,
            quality_score=0.0,
            regime_tag=None,
            family_signature=family_signature,
            family_id=None,
        ))

    return motifs
