"""Deterministic family aggregation for research-v1 motif instances."""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import median
import math
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from .schema import FamilyStatsRecord, MotifInstanceRecord, OutcomeRecord


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _median(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


def _rate(values: Sequence[bool]) -> Optional[float]:
    if not values:
        return None
    return sum(1 for value in values if value) / len(values)


def _stddev(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    if len(values) == 1:
        return 0.0
    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return variance ** 0.5


def _std_error(values: Sequence[float]) -> Optional[float]:
    std_dev = _stddev(values)
    if std_dev is None or not values:
        return None
    return std_dev / math.sqrt(len(values))


def _t_score(mean_value: Optional[float], std_error: Optional[float]) -> Optional[float]:
    if mean_value is None or std_error is None or std_error == 0:
        return None
    return mean_value / std_error


def _sharpe_like(mean_value: Optional[float], std_dev: Optional[float]) -> Optional[float]:
    if mean_value is None or std_dev is None or std_dev == 0:
        return None
    return mean_value / std_dev


def _extract_numeric(items: Iterable[Optional[float]]) -> List[float]:
    return [float(item) for item in items if item is not None]


def _extract_bools(items: Iterable[Optional[bool]]) -> List[bool]:
    return [bool(item) for item in items if item is not None]


def _sorted_top(records: Sequence[FamilyStatsRecord], key_name: str, reverse: bool, limit: int = 10) -> List[Dict[str, object]]:
    filtered = [record for record in records if getattr(record, key_name) is not None]
    ordered = sorted(
        filtered,
        key=lambda record: (getattr(record, key_name), record.occurrence_count, record.family_signature),
        reverse=reverse,
    )
    return [
        {
            "family_id": record.family_id,
            "family_signature": record.family_signature,
            "occurrence_count": record.occurrence_count,
            key_name: getattr(record, key_name),
        }
        for record in ordered[:limit]
    ]


def _sorted_top_with_min_count(
    records: Sequence[FamilyStatsRecord],
    key_name: str,
    reverse: bool,
    min_count: int,
    limit: int = 10,
) -> List[Dict[str, object]]:
    filtered = [
        record for record in records
        if record.occurrence_count >= min_count
        and record.valid_10bar_count >= min_count
        and getattr(record, key_name) is not None
    ]
    ordered = sorted(
        filtered,
        key=lambda record: (
            getattr(record, key_name),
            record.occurrence_count,
            abs(record.avg_forward_10_return_atr or 0.0),
            record.family_signature,
        ),
        reverse=reverse,
    )
    return [
        {
            "family_id": record.family_id,
            "family_signature": record.family_signature,
            "occurrence_count": record.occurrence_count,
            key_name: getattr(record, key_name),
        }
        for record in ordered[:limit]
    ]


def _sign(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _degradation_pct(base_value: Optional[float], compare_value: Optional[float]) -> Optional[float]:
    if base_value is None or compare_value is None:
        return None
    if base_value == 0:
        return None
    return ((compare_value - base_value) / abs(base_value)) * 100.0


def derive_family_signature_v2(exact_signature: str) -> str:
    parts = exact_signature.split("|")
    pivot_type_sequence = parts[0] if len(parts) > 0 else "UNSPECIFIED"
    label_sequence = parts[1] if len(parts) > 1 else ""
    retrace_parts = parts[3:] if len(parts) > 3 else []

    labels = [label for label in label_sequence.split("-") if label]
    bullish_tokens = {"HH", "HL"}
    bearish_tokens = {"LH", "LL"}
    bullish_count = sum(1 for label in labels if label in bullish_tokens)
    bearish_count = sum(1 for label in labels if label in bearish_tokens)
    has_hh = "HH" in labels
    has_ll = "LL" in labels

    directional_labels = [label for label in labels if label in bullish_tokens or label in bearish_tokens]
    latest_direction = directional_labels[-1] if directional_labels else None

    if bullish_count > 0 and bearish_count == 0:
        structural_class = "CONTINUATION_UP"
    elif bearish_count > 0 and bullish_count == 0:
        structural_class = "CONTINUATION_DOWN"
    elif latest_direction in bearish_tokens and has_hh:
        structural_class = "REVERSAL_DOWN"
    elif latest_direction in bullish_tokens and has_ll:
        structural_class = "REVERSAL_UP"
    else:
        structural_class = "MIXED_TRANSITION"

    if has_hh and has_ll:
        break_profile = "BOTH_BREAKS"
    elif has_hh:
        break_profile = "HH_ONLY"
    elif has_ll:
        break_profile = "LL_ONLY"
    else:
        break_profile = "NO_EXTREME_BREAK"

    coarse_retrace_bins: List[str] = []
    for item in retrace_parts:
        raw_value = item.split(":")[-1]
        if raw_value == "SHALLOW":
            coarse_retrace_bins.append("SHALLOW")
        elif raw_value == "MEDIUM":
            coarse_retrace_bins.append("MID")
        else:
            coarse_retrace_bins.append("DEEP")

    deep_count = coarse_retrace_bins.count("DEEP")
    mid_count = coarse_retrace_bins.count("MID")
    if deep_count >= 2:
        retrace_profile = "DEEP_DOM"
    elif deep_count >= 1:
        retrace_profile = "DEEP_PRESENT"
    elif mid_count >= 1:
        retrace_profile = "MID_RETRACE"
    else:
        retrace_profile = "SHALLOW_ONLY"

    orientation = "HTL" if pivot_type_sequence.startswith("HIGH") else "LTH"
    return "|".join([orientation, structural_class, break_profile, retrace_profile])


def _split_for_rank(position: int, total: int) -> str:
    if total <= 0:
        return "discovery"
    discovery_end = max(1, int(total * 0.6))
    validation_end = max(discovery_end + 1, int(total * 0.8))
    if position < discovery_end:
        return "discovery"
    if position < validation_end:
        return "validation"
    return "holdout"


def assign_chronological_splits(
    outcomes: Sequence[OutcomeRecord],
) -> Tuple[Dict[str, str], Dict[str, Dict[str, object]]]:
    """Assign outcome records to chronological discovery/validation/holdout partitions."""
    ordered = sorted(outcomes, key=lambda outcome: (outcome.entry_bar_index, outcome.motif_instance_id))
    mapping: Dict[str, str] = {}

    total = len(ordered)
    if total == 0:
        return mapping, {}

    split_buckets: Dict[str, List[OutcomeRecord]] = {"discovery": [], "validation": [], "holdout": []}
    for idx, outcome in enumerate(ordered):
        split_name = _split_for_rank(idx, total)
        mapping[outcome.motif_instance_id] = split_name
        split_buckets[split_name].append(outcome)

    boundaries: Dict[str, Dict[str, object]] = {}
    for split_name, records in split_buckets.items():
        if not records:
            boundaries[split_name] = {
                "count": 0,
                "start_entry_bar_index": None,
                "end_entry_bar_index": None,
                "start_entry_timestamp": None,
                "end_entry_timestamp": None,
            }
            continue
        boundaries[split_name] = {
            "count": len(records),
            "start_entry_bar_index": records[0].entry_bar_index,
            "end_entry_bar_index": records[-1].entry_bar_index,
            "start_entry_timestamp": records[0].entry_timestamp,
            "end_entry_timestamp": records[-1].entry_timestamp,
        }

    return mapping, boundaries


def _signature_fragment(signature: str, index: int) -> str:
    parts = signature.split("|")
    return parts[index] if index < len(parts) else ""


def build_fragmentation_report(
    motifs: Sequence[MotifInstanceRecord],
    family_stats: Sequence[FamilyStatsRecord],
) -> Dict[str, object]:
    """Explain how deterministic family signature components contribute to uniqueness."""
    signatures = [motif.family_signature or "UNSPECIFIED" for motif in motifs]
    unique_full = len(set(signatures))
    component_counters = {
        "pivot_type_sequence": Counter(),
        "pivot_label_sequence": Counter(),
        "leg_direction_sequence": Counter(),
        "retracement_bins": Counter(),
        "pivot_type_plus_label": Counter(),
        "pivot_type_label_direction": Counter(),
    }

    for signature in signatures:
        pivot_type = _signature_fragment(signature, 0)
        pivot_label = _signature_fragment(signature, 1)
        leg_dir = _signature_fragment(signature, 2)
        retrace = "|".join(signature.split("|")[3:]) if len(signature.split("|")) > 3 else ""
        component_counters["pivot_type_sequence"][pivot_type] += 1
        component_counters["pivot_label_sequence"][pivot_label] += 1
        component_counters["leg_direction_sequence"][leg_dir] += 1
        component_counters["retracement_bins"][retrace] += 1
        component_counters["pivot_type_plus_label"][f"{pivot_type}|{pivot_label}"] += 1
        component_counters["pivot_type_label_direction"][f"{pivot_type}|{pivot_label}|{leg_dir}"] += 1

    unique_counts = {name: len(counter) for name, counter in component_counters.items()}
    incremental_uniqueness = {
        "pivot_type_sequence": unique_counts["pivot_type_sequence"],
        "pivot_label_sequence_increment": unique_counts["pivot_type_plus_label"] - unique_counts["pivot_type_sequence"],
        "leg_direction_increment": unique_counts["pivot_type_label_direction"] - unique_counts["pivot_type_plus_label"],
        "retracement_bins_increment": unique_full - unique_counts["pivot_type_label_direction"],
    }

    candidate_families = [record for record in family_stats if record.is_candidate_family]
    return {
        "total_motif_instances": len(motifs),
        "total_unique_family_signatures": unique_full,
        "candidate_family_count": len(candidate_families),
        "component_unique_counts": unique_counts,
        "incremental_uniqueness": incremental_uniqueness,
        "top_pivot_label_sequences": component_counters["pivot_label_sequence"].most_common(10),
        "top_retracement_bin_groups": component_counters["retracement_bins"].most_common(10),
    }


def build_fragmentation_report_v2(
    motifs: Sequence[MotifInstanceRecord],
    family_stats_v2: Sequence[FamilyStatsRecord],
) -> Dict[str, object]:
    exact_signatures = [motif.family_signature or "UNSPECIFIED" for motif in motifs]
    v2_signatures = [derive_family_signature_v2(signature) for signature in exact_signatures]
    exact_per_v2 = defaultdict(set)
    for exact_signature, v2_signature in zip(exact_signatures, v2_signatures):
        exact_per_v2[v2_signature].add(exact_signature)

    candidate_families = [record for record in family_stats_v2 if record.is_candidate_family]
    return {
        "total_motif_instances": len(motifs),
        "total_unique_v2_families": len(set(v2_signatures)),
        "candidate_family_count": len(candidate_families),
        "avg_exact_signatures_per_v2_family": _mean([float(len(signatures)) for signatures in exact_per_v2.values()]),
        "max_exact_signatures_per_v2_family": max((len(signatures) for signatures in exact_per_v2.values()), default=0),
        "top_v2_families_by_exact_signature_diversity": sorted(
            (
                {
                    "family_signature_v2": signature,
                    "exact_signature_count": len(signatures),
                    "exact_signature_examples": sorted(signatures)[:5],
                }
                for signature, signatures in exact_per_v2.items()
            ),
            key=lambda item: (item["exact_signature_count"], item["family_signature_v2"]),
            reverse=True,
        )[:10],
    }


def aggregate_family_stats(
    motifs: Sequence[MotifInstanceRecord],
    outcomes: Sequence[OutcomeRecord],
    min_occurrence_count: int = 5,
    min_valid_10bar_count: int = 5,
    grouping_version: str = "v1",
    family_key_fn: Optional[Callable[[MotifInstanceRecord], str]] = None,
) -> Tuple[List[FamilyStatsRecord], Dict[str, object]]:
    """Aggregate motif instances into deterministic families using family_signature."""
    outcomes_by_motif = {outcome.motif_instance_id: outcome for outcome in outcomes}
    split_by_motif, split_boundaries = assign_chronological_splits(outcomes)
    motifs_by_family: Dict[str, List[MotifInstanceRecord]] = defaultdict(list)

    if family_key_fn is None:
        if grouping_version == "v2":
            family_key_fn = lambda motif: derive_family_signature_v2(motif.family_signature or "UNSPECIFIED")
        else:
            family_key_fn = lambda motif: motif.family_signature or "UNSPECIFIED"

    for motif in motifs:
        signature = family_key_fn(motif)
        motifs_by_family[signature].append(motif)

    family_records: List[FamilyStatsRecord] = []
    ordered_signatures = sorted(motifs_by_family.keys())
    for family_idx, signature in enumerate(ordered_signatures, start=1):
        family_motifs = motifs_by_family[signature]
        family_outcomes = [
            outcomes_by_motif[motif.motif_instance_id]
            for motif in family_motifs
            if motif.motif_instance_id in outcomes_by_motif
        ]
        exact_signatures = sorted({motif.family_signature or "UNSPECIFIED" for motif in family_motifs})
        family_outcomes_by_split: Dict[str, List[OutcomeRecord]] = {"discovery": [], "validation": [], "holdout": []}
        for outcome in family_outcomes:
            split_name = split_by_motif.get(outcome.motif_instance_id, "discovery")
            family_outcomes_by_split[split_name].append(outcome)

        valid_5 = [outcome for outcome in family_outcomes if outcome.forward_5_return_atr is not None]
        valid_10 = [outcome for outcome in family_outcomes if outcome.forward_10_return_atr is not None]
        valid_10_values = _extract_numeric(outcome.forward_10_return_atr for outcome in valid_10)
        split_valid_10 = {
            split_name: [outcome for outcome in split_outcomes if outcome.forward_10_return_atr is not None]
            for split_name, split_outcomes in family_outcomes_by_split.items()
        }

        regime_distribution = Counter((motif.regime_tag or "UNSPECIFIED") for motif in family_motifs)
        avg_quality_score = _mean([float(motif.quality_score) for motif in family_motifs])
        passes_min_count = len(family_motifs) >= min_occurrence_count
        passes_outcome_coverage = len(valid_10) >= min_valid_10bar_count

        discovery_avg_10 = _mean(_extract_numeric(outcome.forward_10_return_atr for outcome in split_valid_10["discovery"]))
        validation_avg_10 = _mean(_extract_numeric(outcome.forward_10_return_atr for outcome in split_valid_10["validation"]))
        holdout_avg_10 = _mean(_extract_numeric(outcome.forward_10_return_atr for outcome in split_valid_10["holdout"]))
        forward_10_std_dev = _stddev(valid_10_values)
        forward_10_std_error = _std_error(valid_10_values)
        avg_forward_10 = _mean(valid_10_values)

        split_signs = [_sign(discovery_avg_10), _sign(validation_avg_10), _sign(holdout_avg_10)]
        non_null_signs = [value for value in split_signs if value is not None]
        sign_consistent = len(non_null_signs) == 3 and len(set(non_null_signs)) == 1

        family_records.append(FamilyStatsRecord(
            grouping_version=grouping_version,
            family_id=f"family_{family_idx:06d}",
            family_signature=signature,
            occurrence_count=len(family_motifs),
            valid_5bar_count=len(valid_5),
            valid_10bar_count=len(valid_10),
            discovery_count=len(family_outcomes_by_split["discovery"]),
            validation_count=len(family_outcomes_by_split["validation"]),
            holdout_count=len(family_outcomes_by_split["holdout"]),
            avg_forward_5_return_atr=_mean(_extract_numeric(outcome.forward_5_return_atr for outcome in valid_5)),
            median_forward_5_return_atr=_median(_extract_numeric(outcome.forward_5_return_atr for outcome in valid_5)),
            avg_forward_10_return_atr=avg_forward_10,
            median_forward_10_return_atr=_median(valid_10_values),
            forward_10_std_dev_atr=forward_10_std_dev,
            forward_10_std_error_atr=forward_10_std_error,
            t_score_forward_10=_t_score(avg_forward_10, forward_10_std_error),
            sharpe_like_forward_10=_sharpe_like(avg_forward_10, forward_10_std_dev),
            discovery_avg_forward_10_return_atr=discovery_avg_10,
            validation_avg_forward_10_return_atr=validation_avg_10,
            holdout_avg_forward_10_return_atr=holdout_avg_10,
            avg_mfe_10_atr=_mean(_extract_numeric(outcome.mfe_10_atr for outcome in valid_10)),
            median_mfe_10_atr=_median(_extract_numeric(outcome.mfe_10_atr for outcome in valid_10)),
            avg_mae_10_atr=_mean(_extract_numeric(outcome.mae_10_atr for outcome in valid_10)),
            median_mae_10_atr=_median(_extract_numeric(outcome.mae_10_atr for outcome in valid_10)),
            hit_plus_1atr_first_rate=_rate(_extract_bools(outcome.hit_plus_1atr_first for outcome in valid_10)),
            hit_minus_1atr_first_rate=_rate(_extract_bools(outcome.hit_minus_1atr_first for outcome in valid_10)),
            next_break_up_rate=_rate(_extract_bools(outcome.next_break_up for outcome in valid_10)),
            next_break_down_rate=_rate(_extract_bools(outcome.next_break_down for outcome in valid_10)),
            discovery_hit_plus_1atr_first_rate=_rate(_extract_bools(outcome.hit_plus_1atr_first for outcome in split_valid_10["discovery"])),
            validation_hit_plus_1atr_first_rate=_rate(_extract_bools(outcome.hit_plus_1atr_first for outcome in split_valid_10["validation"])),
            holdout_hit_plus_1atr_first_rate=_rate(_extract_bools(outcome.hit_plus_1atr_first for outcome in split_valid_10["holdout"])),
            avg_quality_score=avg_quality_score,
            regime_distribution=dict(regime_distribution),
            exact_signature_count=len(exact_signatures),
            exact_signature_examples=exact_signatures[:5],
            sign_consistent_across_splits=sign_consistent,
            validation_degradation_pct=_degradation_pct(discovery_avg_10, validation_avg_10),
            holdout_degradation_pct=_degradation_pct(discovery_avg_10, holdout_avg_10),
            passes_min_count=passes_min_count,
            passes_outcome_coverage=passes_outcome_coverage,
            is_candidate_family=passes_min_count and passes_outcome_coverage,
        ))

    candidate_families = [record for record in family_records if record.is_candidate_family]
    ranking_base = candidate_families if candidate_families else [record for record in family_records if record.valid_10bar_count > 0]

    summary = {
        "grouping_version": grouping_version,
        "total_unique_families": len(family_records),
        "split_boundaries": split_boundaries,
        "families_with_split_coverage_all_three": sum(
            1
            for record in family_records
            if record.discovery_count > 0 and record.validation_count > 0 and record.holdout_count > 0
        ),
        "families_with_min_occurrences": sum(1 for record in family_records if record.passes_min_count),
        "families_with_min_valid10": sum(1 for record in family_records if record.passes_outcome_coverage),
        "families_passing_discovery_and_validation_counts": sum(
            1 for record in family_records if record.discovery_count >= min_occurrence_count and record.validation_count >= min_occurrence_count
        ),
        "candidate_family_count": len(candidate_families),
        "families_sign_consistent_across_splits": sum(1 for record in family_records if record.sign_consistent_across_splits),
        "top_10_avg_forward_10_return_atr": _sorted_top(ranking_base, "avg_forward_10_return_atr", reverse=True, limit=10),
        "top_10_t_score_forward_10": _sorted_top_with_min_count(
            family_records,
            "t_score_forward_10",
            reverse=True,
            min_count=min_valid_10bar_count,
            limit=10,
        ),
        "top_10_hit_plus_1atr_first_rate": _sorted_top(ranking_base, "hit_plus_1atr_first_rate", reverse=True, limit=10),
        "bottom_10_avg_forward_10_return_atr": _sorted_top(ranking_base, "avg_forward_10_return_atr", reverse=False, limit=10),
    }

    return family_records, summary
