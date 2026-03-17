"""Inspection reporting for top v2 family buckets."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence

from .families import assign_chronological_splits, derive_family_signature_v2
from .schema import BarRecord, FamilyStatsRecord, MotifInstanceRecord, OutcomeRecord, PivotRecord, PivotType


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _median(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


def _stddev(values: Sequence[float]) -> Optional[float]:
    if len(values) < 2:
        return 0.0 if values else None
    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return math.sqrt(variance)


def _price_bounds(bars: Sequence[BarRecord]) -> tuple[float, float]:
    low = min(bar.low for bar in bars)
    high = max(bar.high for bar in bars)
    padding = (high - low) * 0.08 if high > low else 1.0
    return low - padding, high + padding


def _price_to_y(price: float, min_price: float, max_price: float, height: int, top_pad: int, bottom_pad: int) -> float:
    usable_height = height - top_pad - bottom_pad
    if usable_height <= 0 or max_price <= min_price:
        return float(height - bottom_pad)
    ratio = (price - min_price) / (max_price - min_price)
    return float(height - bottom_pad - (ratio * usable_height))


def _sanitize_token(value: str) -> str:
    return "".join(char.lower() if char.isalnum() else "_" for char in value).strip("_") or "family"


def _pick_representative_indices(
    motifs: Sequence[MotifInstanceRecord],
    outcomes_by_motif: Dict[str, OutcomeRecord],
) -> List[int]:
    if not motifs:
        return []

    ordered_indices = list(range(len(motifs)))
    chosen: List[int] = [ordered_indices[0]]
    if len(ordered_indices) > 1:
        chosen.append(ordered_indices[-1])

    valid_with_values = [
        (idx, outcomes_by_motif[motif.motif_instance_id].forward_10_return_atr)
        for idx, motif in enumerate(motifs)
        if motif.motif_instance_id in outcomes_by_motif
        and outcomes_by_motif[motif.motif_instance_id].forward_10_return_atr is not None
    ]
    if valid_with_values:
        values = [float(value) for _, value in valid_with_values if value is not None]
        median_value = _median(values)
        median_idx = min(
            valid_with_values,
            key=lambda item: abs(float(item[1]) - float(median_value)),
        )[0]
        chosen.append(median_idx)

    deduped: List[int] = []
    for idx in chosen:
        if idx not in deduped:
            deduped.append(idx)

    for idx in ordered_indices:
        if len(deduped) >= 3:
            break
        if idx not in deduped:
            deduped.append(idx)
    return deduped[:3]


def _render_snippet_svg(
    bars: Sequence[BarRecord],
    pivots: Sequence[PivotRecord],
    motif: MotifInstanceRecord,
    outcome: OutcomeRecord,
    family_signature_v2: str,
    output_path: Path,
) -> None:
    window_start = max(0, motif.start_bar_index - 20)
    window_end = min(len(bars) - 1, max(outcome.entry_bar_index + 10, motif.end_bar_index + 15))
    window_bars = bars[window_start:window_end + 1]
    if not window_bars:
        return

    pivots_in_window = [pivot for pivot in pivots if window_start <= pivot.bar_index <= window_end]
    motif_pivot_ids = set(motif.pivot_ids)

    width = 1280
    height = 540
    left_pad = 70
    right_pad = 30
    top_pad = 44
    bottom_pad = 54
    usable_width = width - left_pad - right_pad
    min_price, max_price = _price_bounds(window_bars)
    step = usable_width / max(len(window_bars) - 1, 1)
    candle_width = max(step * 0.55, 1.0)

    motif_start_x = left_pad + ((motif.start_bar_index - window_start) * step)
    motif_end_x = left_pad + ((motif.end_bar_index - window_start) * step)
    entry_x = left_pad + ((outcome.entry_bar_index - window_start) * step)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#081018" />',
        f'<rect x="{motif_start_x:.2f}" y="{top_pad}" width="{max(motif_end_x - motif_start_x, 2):.2f}" height="{height - top_pad - bottom_pad}" fill="#17324d" opacity="0.18" />',
        f'<line x1="{entry_x:.2f}" y1="{top_pad}" x2="{entry_x:.2f}" y2="{height - bottom_pad}" stroke="#fde047" stroke-width="2" stroke-dasharray="6 4" />',
        '<text x="70" y="24" fill="#e5e7eb" font-size="16" font-family="monospace">Top Family Inspection Snippet</text>',
        f'<text x="70" y="42" fill="#93c5fd" font-size="12" font-family="monospace">{family_signature_v2}</text>',
    ]

    for offset, bar in enumerate(window_bars):
        x = left_pad + (offset * step)
        open_y = _price_to_y(bar.open, min_price, max_price, height, top_pad, bottom_pad)
        close_y = _price_to_y(bar.close, min_price, max_price, height, top_pad, bottom_pad)
        high_y = _price_to_y(bar.high, min_price, max_price, height, top_pad, bottom_pad)
        low_y = _price_to_y(bar.low, min_price, max_price, height, top_pad, bottom_pad)
        color = "#22c55e" if bar.close >= bar.open else "#ef4444"
        body_top = min(open_y, close_y)
        body_height = max(abs(close_y - open_y), 1.0)
        parts.append(f'<line x1="{x:.2f}" y1="{high_y:.2f}" x2="{x:.2f}" y2="{low_y:.2f}" stroke="{color}" stroke-width="1" />')
        parts.append(
            f'<rect x="{x - candle_width / 2:.2f}" y="{body_top:.2f}" '
            f'width="{candle_width:.2f}" height="{body_height:.2f}" fill="{color}" opacity="0.85" />'
        )

    if pivots_in_window:
        polyline = []
        for pivot in pivots_in_window:
            x = left_pad + ((pivot.bar_index - window_start) * step)
            y = _price_to_y(pivot.price, min_price, max_price, height, top_pad, bottom_pad)
            polyline.append(f"{x:.2f},{y:.2f}")
        parts.append(f'<polyline points="{" ".join(polyline)}" fill="none" stroke="#64748b" stroke-width="1.8" opacity="0.9" />')

        for pivot in pivots_in_window:
            x = left_pad + ((pivot.bar_index - window_start) * step)
            y = _price_to_y(pivot.price, min_price, max_price, height, top_pad, bottom_pad)
            is_motif_pivot = pivot.pivot_id in motif_pivot_ids
            fill = "#38bdf8" if pivot.pivot_type == PivotType.LOW else "#f97316"
            radius = 5.5 if is_motif_pivot else 3.3
            stroke = "#f8fafc" if is_motif_pivot else "#0f172a"
            stroke_width = 1.8 if is_motif_pivot else 1.1
            parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}" />')

    parts.extend([
        f'<text x="{left_pad}" y="{height - 24}" fill="#cbd5e1" font-size="12" font-family="monospace">{window_bars[0].timestamp[:10]}</text>',
        f'<text x="{width - 140}" y="{height - 24}" fill="#cbd5e1" font-size="12" font-family="monospace">{window_bars[-1].timestamp[:10]}</text>',
        f'<text x="{left_pad}" y="{height - 8}" fill="#94a3b8" font-size="12" font-family="monospace">entry={outcome.entry_timestamp[:10]} fwd10={outcome.forward_10_return_atr}</text>',
        "</svg>",
    ])
    output_path.write_text("\n".join(parts), encoding="utf-8")


def _representative_exact_signatures(motifs: Sequence[MotifInstanceRecord], limit: int = 5) -> List[Dict[str, object]]:
    counts = Counter(motif.family_signature or "UNSPECIFIED" for motif in motifs)
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [{"exact_signature": signature, "count": count} for signature, count in ordered[:limit]]


def _rate(values: Iterable[Optional[bool]]) -> Optional[float]:
    filtered = [bool(value) for value in values if value is not None]
    if not filtered:
        return None
    return sum(1 for value in filtered if value) / len(filtered)


def _motif_examples(
    motifs: Sequence[MotifInstanceRecord],
    outcomes_by_motif: Dict[str, OutcomeRecord],
    pivots_by_id: Dict[str, PivotRecord],
    bars: Sequence[BarRecord],
    pivots: Sequence[PivotRecord],
    snippets_dir: Path,
    family_id: str,
    family_signature_v2: str,
) -> List[Dict[str, object]]:
    snippets_dir.mkdir(parents=True, exist_ok=True)
    selected_indices = _pick_representative_indices(motifs, outcomes_by_motif)
    examples: List[Dict[str, object]] = []
    for rank, idx in enumerate(selected_indices, start=1):
        motif = motifs[idx]
        outcome = outcomes_by_motif.get(motif.motif_instance_id)
        if outcome is None:
            continue

        snippet_name = f"{family_id}_{rank:02d}_{motif.motif_instance_id}.svg"
        snippet_path = snippets_dir / snippet_name
        _render_snippet_svg(bars, pivots, motif, outcome, family_signature_v2, snippet_path)

        pivot_records = [pivots_by_id[pivot_id] for pivot_id in motif.pivot_ids if pivot_id in pivots_by_id]
        examples.append({
            "motif_instance_id": motif.motif_instance_id,
            "motifInstanceId": motif.motif_instance_id,
            "exact_signature": motif.family_signature,
            "startTimestamp": bars[motif.start_bar_index].timestamp,
            "start_bar_index": motif.start_bar_index,
            "end_bar_index": motif.end_bar_index,
            "start_timestamp": bars[motif.start_bar_index].timestamp,
            "endTimestamp": bars[motif.end_bar_index].timestamp,
            "end_timestamp": bars[motif.end_bar_index].timestamp,
            "entryBarIndex": outcome.entry_bar_index,
            "entry_bar_index": outcome.entry_bar_index,
            "entryTimestamp": outcome.entry_timestamp,
            "entry_timestamp": outcome.entry_timestamp,
            "pivot_timestamps": [pivot.timestamp for pivot in pivot_records],
            "forward10ReturnAtr": outcome.forward_10_return_atr,
            "forward_10_return_atr": outcome.forward_10_return_atr,
            "hit_plus_1atr_first": outcome.hit_plus_1atr_first,
            "next_break_up": outcome.next_break_up,
            "next_break_down": outcome.next_break_down,
            "chartSnippetPath": str(snippet_path),
            "chart_snippet_path": str(snippet_path),
        })
    return examples


def _split_consistency_score(record: FamilyStatsRecord) -> tuple:
    complete_split_coverage = int(record.discovery_count > 0 and record.validation_count > 0 and record.holdout_count > 0)
    validation_deg = abs(record.validation_degradation_pct) if record.validation_degradation_pct is not None else 999999.0
    holdout_deg = abs(record.holdout_degradation_pct) if record.holdout_degradation_pct is not None else 999999.0
    return (
        int(record.sign_consistent_across_splits),
        complete_split_coverage,
        min(record.discovery_count, record.validation_count, record.holdout_count),
        -validation_deg,
        -holdout_deg,
        record.valid_10bar_count,
        abs(record.avg_forward_10_return_atr or 0.0),
    )


def _family_rank_payload(record: FamilyStatsRecord, metric_name: str, metric_value: object) -> Dict[str, object]:
    return {
        "family_id": record.family_id,
        "familySignatureV2": record.family_signature,
        "family_signature_v2": record.family_signature,
        "occurrenceCount": record.occurrence_count,
        "occurrence_count": record.occurrence_count,
        "valid10BarCount": record.valid_10bar_count,
        "valid_10bar_count": record.valid_10bar_count,
        metric_name: metric_value,
    }


def build_top_family_inspection_report(
    bars: Sequence[BarRecord],
    pivots: Sequence[PivotRecord],
    motifs: Sequence[MotifInstanceRecord],
    outcomes: Sequence[OutcomeRecord],
    family_stats_v2: Sequence[FamilyStatsRecord],
    output_dir: Path,
    top_n: int = 10,
    min_count_filter: int = 5,
    snippet_dir_name: str = "v2_family_snippets",
) -> Dict[str, object]:
    """Build an inspection-focused report for the v2 aggregation layer."""
    output_dir.mkdir(parents=True, exist_ok=True)
    snippets_dir = output_dir / snippet_dir_name
    snippets_dir.mkdir(parents=True, exist_ok=True)

    pivots_by_id = {pivot.pivot_id: pivot for pivot in pivots}
    outcomes_by_motif = {outcome.motif_instance_id: outcome for outcome in outcomes}
    _, split_boundaries = assign_chronological_splits(outcomes)

    motifs_by_v2_family: Dict[str, List[MotifInstanceRecord]] = defaultdict(list)
    for motif in motifs:
        family_signature_v2 = derive_family_signature_v2(motif.family_signature or "UNSPECIFIED")
        motifs_by_v2_family[family_signature_v2].append(motif)

    top_by_occurrence = sorted(
        family_stats_v2,
        key=lambda record: (record.occurrence_count, record.valid_10bar_count, record.family_signature),
        reverse=True,
    )[:top_n]
    top_by_avg_forward = sorted(
        [
            record for record in family_stats_v2
            if record.occurrence_count >= min_count_filter
            and record.valid_10bar_count >= min_count_filter
            and record.avg_forward_10_return_atr is not None
        ],
        key=lambda record: (record.avg_forward_10_return_atr, record.occurrence_count, record.family_signature),
        reverse=True,
    )[:top_n]
    top_by_split_consistency = sorted(
        [record for record in family_stats_v2 if record.valid_10bar_count > 0],
        key=lambda record: (_split_consistency_score(record), record.family_signature),
        reverse=True,
    )[:top_n]

    selected_records = {}
    for record in [*top_by_occurrence, *top_by_avg_forward, *top_by_split_consistency]:
        selected_records[record.family_id] = record

    family_details: Dict[str, Dict[str, object]] = {}
    for family_id, record in sorted(selected_records.items(), key=lambda item: item[0]):
        family_motifs = sorted(
            motifs_by_v2_family.get(record.family_signature, []),
            key=lambda motif: outcomes_by_motif.get(motif.motif_instance_id, OutcomeRecord(
                motif_instance_id=motif.motif_instance_id,
                entry_bar_index=motif.end_bar_index,
                entry_timestamp=bars[motif.end_bar_index].timestamp,
                entry_close=bars[motif.end_bar_index].close,
                entry_atr=bars[motif.end_bar_index].atr_14,
                forward_5_return_atr=None,
                forward_10_return_atr=None,
                mfe_10_atr=None,
                mae_10_atr=None,
                hit_plus_1atr_first=None,
                hit_minus_1atr_first=None,
                next_break_up=None,
                next_break_down=None,
            )).entry_bar_index,
        )
        exact_signature_counts = Counter(motif.family_signature or "UNSPECIFIED" for motif in family_motifs)
        family_outcomes = [outcomes_by_motif[motif.motif_instance_id] for motif in family_motifs if motif.motif_instance_id in outcomes_by_motif]
        valid_10_values = [float(outcome.forward_10_return_atr) for outcome in family_outcomes if outcome.forward_10_return_atr is not None]
        examples = _motif_examples(
            motifs=family_motifs,
            outcomes_by_motif=outcomes_by_motif,
            pivots_by_id=pivots_by_id,
            bars=bars,
            pivots=pivots,
            snippets_dir=snippets_dir / family_id,
            family_id=family_id,
            family_signature_v2=record.family_signature,
        )
        family_details[family_id] = {
            "family_id": family_id,
            "familySignatureV2": record.family_signature,
            "family_signature_v2": record.family_signature,
            "occurrenceCount": record.occurrence_count,
            "occurrence_count": record.occurrence_count,
            "discoveryCount": record.discovery_count,
            "discovery_count": record.discovery_count,
            "validationCount": record.validation_count,
            "validation_count": record.validation_count,
            "holdoutCount": record.holdout_count,
            "holdout_count": record.holdout_count,
            "avgForward10ReturnAtr": record.avg_forward_10_return_atr,
            "avg_forward_10_return_atr": record.avg_forward_10_return_atr,
            "medianForward10ReturnAtr": record.median_forward_10_return_atr,
            "median_forward_10_return_atr": record.median_forward_10_return_atr,
            "hitPlus1AtrFirstRate": record.hit_plus_1atr_first_rate,
            "hit_plus_1atr_first_rate": record.hit_plus_1atr_first_rate,
            "signConsistencyAcrossSplits": record.sign_consistent_across_splits,
            "sign_consistent_across_splits": record.sign_consistent_across_splits,
            "numberOfExactSignaturesContained": record.exact_signature_count,
            "discovery_avg_forward_10_return_atr": record.discovery_avg_forward_10_return_atr,
            "validation_avg_forward_10_return_atr": record.validation_avg_forward_10_return_atr,
            "holdout_avg_forward_10_return_atr": record.holdout_avg_forward_10_return_atr,
            "discovery_hit_plus_1atr_first_rate": record.discovery_hit_plus_1atr_first_rate,
            "validation_hit_plus_1atr_first_rate": record.validation_hit_plus_1atr_first_rate,
            "holdout_hit_plus_1atr_first_rate": record.holdout_hit_plus_1atr_first_rate,
            "exact_signature_count": record.exact_signature_count,
            "representativeExactSignatures": _representative_exact_signatures(family_motifs),
            "representative_exact_signatures": _representative_exact_signatures(family_motifs),
            "exact_signature_distribution": [
                {"exact_signature": signature, "count": count}
                for signature, count in sorted(exact_signature_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
            "regime_distribution": record.regime_distribution,
            "avg_quality_score": record.avg_quality_score,
            "forward_10_stddev_atr": _stddev(valid_10_values),
            "forward_10_min_atr": min(valid_10_values) if valid_10_values else None,
            "forward_10_max_atr": max(valid_10_values) if valid_10_values else None,
            "internal_hit_plus_1atr_first_rate": _rate(outcome.hit_plus_1atr_first for outcome in family_outcomes if outcome.forward_10_return_atr is not None),
            "representativeMotifExamples": examples,
            "representative_motif_examples": examples,
            "contained_exact_signature_examples": record.exact_signature_examples,
        }

    report = {
        "grouping_version": "v2",
        "split_boundaries": split_boundaries,
        "total_unique_families": len(family_stats_v2),
        "top_10_by_occurrence_count": [
            _family_rank_payload(record, "occurrence_count", record.occurrence_count) for record in top_by_occurrence
        ],
        "top_10_by_avg_forward_10_return_atr": [
            _family_rank_payload(record, "avg_forward_10_return_atr", record.avg_forward_10_return_atr) for record in top_by_avg_forward
        ],
        "top_10_by_split_consistency": [
            _family_rank_payload(record, "split_consistency_score", list(_split_consistency_score(record)))
            for record in top_by_split_consistency
        ],
        "inspected_family_count": len(family_details),
        "family_details": family_details,
        "inspection_questions": [
            "Do grouped motifs show family resemblance rather than random leftovers?",
            "Are the exact signatures inside each v2 family structurally related?",
            "Are the outcomes concentrated or internally noisy?",
            "Do the chart snippets look like one visible behavior class?",
        ],
    }
    return report
