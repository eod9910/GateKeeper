"""Cross-symbol reporting for research-v1 family aggregation."""

from __future__ import annotations

from itertools import combinations
from statistics import median
from typing import Dict, List, Sequence

from .schema import FamilyStatsRecord


def _mean(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return float(median(values))


def _stddev(values: Sequence[float]) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return 0.0
    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return variance ** 0.5


def _std_error(values: Sequence[float]) -> float | None:
    std_dev = _stddev(values)
    if std_dev is None or not values:
        return None
    return std_dev / (len(values) ** 0.5)


def _sign(value: float | None) -> int | None:
    if value is None:
        return None
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _top_by_occurrence(records: Sequence[FamilyStatsRecord], limit: int = 10) -> List[Dict[str, object]]:
    ordered = sorted(
        records,
        key=lambda record: (record.occurrence_count, record.valid_10bar_count, record.family_signature),
        reverse=True,
    )
    return [
        {
            "family_id": record.family_id,
            "familySignatureV2": record.family_signature,
            "occurrenceCount": record.occurrence_count,
            "valid10BarCount": record.valid_10bar_count,
        }
        for record in ordered[:limit]
    ]


def _top_by_avg_forward_10(records: Sequence[FamilyStatsRecord], min_count: int = 5, limit: int = 10) -> List[Dict[str, object]]:
    ordered = sorted(
        [
            record for record in records
            if record.occurrence_count >= min_count
            and record.valid_10bar_count >= min_count
            and record.avg_forward_10_return_atr is not None
        ],
        key=lambda record: (record.avg_forward_10_return_atr, record.occurrence_count, record.family_signature),
        reverse=True,
    )
    return [
        {
            "family_id": record.family_id,
            "familySignatureV2": record.family_signature,
            "occurrenceCount": record.occurrence_count,
            "avgForward10ReturnAtr": record.avg_forward_10_return_atr,
            "medianForward10ReturnAtr": record.median_forward_10_return_atr,
            "tScoreForward10": record.t_score_forward_10,
        }
        for record in ordered[:limit]
    ]


def _top_by_t_score_forward_10(records: Sequence[FamilyStatsRecord], min_count: int = 5, limit: int = 10) -> List[Dict[str, object]]:
    ordered = sorted(
        [
            record for record in records
            if record.occurrence_count >= min_count
            and record.valid_10bar_count >= min_count
            and record.t_score_forward_10 is not None
        ],
        key=lambda record: (
            record.t_score_forward_10,
            record.occurrence_count,
            abs(record.avg_forward_10_return_atr or 0.0),
            record.family_signature,
        ),
        reverse=True,
    )
    return [
        {
            "family_id": record.family_id,
            "familySignatureV2": record.family_signature,
            "occurrenceCount": record.occurrence_count,
            "tScoreForward10": record.t_score_forward_10,
            "avgForward10ReturnAtr": record.avg_forward_10_return_atr,
            "forward10StdDevAtr": record.forward_10_std_dev_atr,
        }
        for record in ordered[:limit]
    ]


def _family_cross_symbol_row(
    signature: str,
    ordered_symbols: Sequence[str],
    family_lookup: Dict[str, Dict[str, FamilyStatsRecord]],
    min_count_filter: int,
) -> Dict[str, object]:
    present_symbols = [symbol for symbol in ordered_symbols if signature in family_lookup[symbol]]
    per_symbol: Dict[str, Dict[str, object]] = {}
    avg_values: List[float] = []
    median_values: List[float] = []
    hit_values: List[float] = []
    t_score_values: List[float] = []
    sharpe_like_values: List[float] = []
    sign_values: List[int] = []
    count_pass_symbols: List[str] = []

    for symbol in ordered_symbols:
        record = family_lookup[symbol].get(signature)
        if record is None:
            per_symbol[symbol] = {
                "present": False,
                "occurrenceCount": 0,
                "discoveryCount": 0,
                "validationCount": 0,
                "holdoutCount": 0,
                "avgForward10ReturnAtr": None,
                "medianForward10ReturnAtr": None,
                "hitPlus1AtrFirstRate": None,
                "signConsistencyAcrossSplits": None,
                "passesMinCountThreshold": False,
                "passesValid10Threshold": False,
                "isCandidateFamily": False,
            }
            continue

        avg_value = record.avg_forward_10_return_atr
        median_value = record.median_forward_10_return_atr
        hit_rate = record.hit_plus_1atr_first_rate
        t_score_value = record.t_score_forward_10
        sharpe_like_value = record.sharpe_like_forward_10
        sign_value = _sign(avg_value)
        passes_thresholds = record.occurrence_count >= min_count_filter and record.valid_10bar_count >= min_count_filter

        if avg_value is not None:
            avg_values.append(avg_value)
        if median_value is not None:
            median_values.append(median_value)
        if hit_rate is not None:
            hit_values.append(hit_rate)
        if t_score_value is not None:
            t_score_values.append(t_score_value)
        if sharpe_like_value is not None:
            sharpe_like_values.append(sharpe_like_value)
        if sign_value is not None:
            sign_values.append(sign_value)
        if passes_thresholds:
            count_pass_symbols.append(symbol)

        per_symbol[symbol] = {
            "present": True,
            "occurrenceCount": record.occurrence_count,
            "discoveryCount": record.discovery_count,
            "validationCount": record.validation_count,
            "holdoutCount": record.holdout_count,
            "avgForward10ReturnAtr": avg_value,
            "medianForward10ReturnAtr": median_value,
            "forward10StdDevAtr": record.forward_10_std_dev_atr,
            "forward10StdErrorAtr": record.forward_10_std_error_atr,
            "tScoreForward10": record.t_score_forward_10,
            "sharpeLikeForward10": record.sharpe_like_forward_10,
            "hitPlus1AtrFirstRate": hit_rate,
            "signConsistencyAcrossSplits": record.sign_consistent_across_splits,
            "passesMinCountThreshold": record.passes_min_count,
            "passesValid10Threshold": record.passes_outcome_coverage,
            "isCandidateFamily": record.is_candidate_family,
        }

    same_directional_sign_all_symbols = (
        len(present_symbols) == len(ordered_symbols)
        and len(sign_values) == len(ordered_symbols)
        and len(set(sign_values)) == 1
    )

    cross_symbol_mean_avg = _mean(avg_values)
    cross_symbol_stddev_avg = _stddev(avg_values)

    return {
        "familySignatureV2": signature,
        "symbolCount": len(present_symbols),
        "symbolsPresent": present_symbols,
        "perSymbol": per_symbol,
        "crossSymbolMeanAvgForward10ReturnAtr": cross_symbol_mean_avg,
        "crossSymbolMedianAvgForward10ReturnAtr": _median(avg_values),
        "crossSymbolStddevAvgForward10ReturnAtr": cross_symbol_stddev_avg,
        "crossSymbolRangeAvgForward10ReturnAtr": (max(avg_values) - min(avg_values)) if avg_values else None,
        "crossSymbolMeanMedianForward10ReturnAtr": _mean(median_values),
        "crossSymbolStddevMedianForward10ReturnAtr": _stddev(median_values),
        "crossSymbolMeanTScoreForward10": _mean(t_score_values),
        "crossSymbolStddevTScoreForward10": _stddev(t_score_values),
        "crossSymbolStdErrorTScoreForward10": _std_error(t_score_values),
        "crossSymbolMeanSharpeLikeForward10": _mean(sharpe_like_values),
        "crossSymbolStddevSharpeLikeForward10": _stddev(sharpe_like_values),
        "crossSymbolMeanHitPlus1AtrFirstRate": _mean(hit_values),
        "crossSymbolStddevHitPlus1AtrFirstRate": _stddev(hit_values),
        "sameDirectionalSignAcrossAllSymbols": same_directional_sign_all_symbols,
        "directionalSignAcrossSymbols": {symbol: _sign(per_symbol[symbol]["avgForward10ReturnAtr"]) for symbol in ordered_symbols},
        "symbolsPassingMinCountThreshold": count_pass_symbols,
        "symbolsPassingMinCountThresholdCount": len(count_pass_symbols),
        "passesMinCountThresholdInAtLeastThreeSymbols": len(count_pass_symbols) >= 3,
    }


def _sort_cross_symbol_rows(
    rows: Sequence[Dict[str, object]],
    *,
    mode: str,
    limit: int,
) -> List[Dict[str, object]]:
    if mode == "all_four":
        filtered = [row for row in rows if row["symbolCount"] == 4]
        key_fn = lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            sum(row["perSymbol"][symbol]["occurrenceCount"] for symbol in row["perSymbol"]),
            row["crossSymbolMeanAvgForward10ReturnAtr"] or float("-inf"),
            row["familySignatureV2"],
        )
        reverse = True
    elif mode == "same_sign":
        filtered = [row for row in rows if row["sameDirectionalSignAcrossAllSymbols"]]
        key_fn = lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            row["familySignatureV2"],
        )
        reverse = True
    elif mode == "low_dispersion":
        filtered = [row for row in rows if row["symbolCount"] == 4 and row["crossSymbolStddevAvgForward10ReturnAtr"] is not None]
        key_fn = lambda row: (
            row["crossSymbolStddevAvgForward10ReturnAtr"],
            -(row["symbolsPassingMinCountThresholdCount"]),
            -(1 if row["sameDirectionalSignAcrossAllSymbols"] else 0),
            -(abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0)),
            row["familySignatureV2"],
        )
        reverse = False
    elif mode == "min_count_three":
        filtered = [row for row in rows if row["passesMinCountThresholdInAtLeastThreeSymbols"]]
        key_fn = lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            row["symbolCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            row["familySignatureV2"],
        )
        reverse = True
    else:
        raise ValueError(f"Unknown ranking mode: {mode}")

    ordered = sorted(filtered, key=key_fn, reverse=reverse)
    return ordered[:limit]


def build_cross_symbol_family_comparison(
    symbol_runs: Sequence[Dict[str, object]],
    min_count_filter: int = 5,
    top_n: int = 10,
) -> Dict[str, object]:
    """Compare deterministic v2 families across multiple symbols."""
    per_symbol: Dict[str, Dict[str, object]] = {}
    signatures_by_symbol: Dict[str, set[str]] = {}
    family_lookup: Dict[str, Dict[str, FamilyStatsRecord]] = {}

    for run in symbol_runs:
        symbol = str(run["symbol"])
        family_stats_v2 = list(run["family_stats_v2"])
        family_summary_v2 = dict(run["family_summary_v2"])
        signatures = {record.family_signature for record in family_stats_v2}
        signatures_by_symbol[symbol] = signatures
        family_lookup[symbol] = {record.family_signature: record for record in family_stats_v2}

        per_symbol[symbol] = {
            "familyCountV2": family_summary_v2["total_unique_families"],
            "candidateFamilyCountV2": family_summary_v2["candidate_family_count"],
            "familiesPresentAcrossAllThreeSplits": family_summary_v2["families_with_split_coverage_all_three"],
            "topFamiliesByOccurrence": _top_by_occurrence(family_stats_v2, limit=top_n),
            "topFamiliesByTScoreForward10": _top_by_t_score_forward_10(
                family_stats_v2,
                min_count=min_count_filter,
                limit=top_n,
            ),
            "topFamiliesByAvgForward10ReturnAtr": _top_by_avg_forward_10(
                family_stats_v2,
                min_count=min_count_filter,
                limit=top_n,
            ),
        }

    ordered_symbols = [str(run["symbol"]) for run in symbol_runs]
    common_to_all = sorted(set.intersection(*(signatures_by_symbol[symbol] for symbol in ordered_symbols))) if ordered_symbols else []

    pairwise_overlap: List[Dict[str, object]] = []
    for left_symbol, right_symbol in combinations(ordered_symbols, 2):
        overlap = sorted(signatures_by_symbol[left_symbol] & signatures_by_symbol[right_symbol])
        pairwise_overlap.append({
            "symbols": [left_symbol, right_symbol],
            "overlapCount": len(overlap),
            "overlapFamilySignaturesV2": overlap,
        })

    all_signatures = sorted(set().union(*signatures_by_symbol.values()) if signatures_by_symbol else set())
    family_coverage_rows: List[Dict[str, object]] = []
    family_stability_rows: List[Dict[str, object]] = []
    for signature in all_signatures:
        present_symbols = [symbol for symbol in ordered_symbols if signature in signatures_by_symbol[symbol]]
        coverage_entry = {
            "familySignatureV2": signature,
            "symbolCount": len(present_symbols),
            "symbols": present_symbols,
            "perSymbolOccurrenceCount": {
                symbol: family_lookup[symbol][signature].occurrence_count
                for symbol in present_symbols
            },
            "perSymbolAvgForward10ReturnAtr": {
                symbol: family_lookup[symbol][signature].avg_forward_10_return_atr
                for symbol in present_symbols
            },
        }
        family_coverage_rows.append(coverage_entry)
        family_stability_rows.append(
            _family_cross_symbol_row(
                signature=signature,
                ordered_symbols=ordered_symbols,
                family_lookup=family_lookup,
                min_count_filter=min_count_filter,
            )
        )

    family_coverage_rows.sort(
        key=lambda row: (row["symbolCount"], sum(row["perSymbolOccurrenceCount"].values()), row["familySignatureV2"]),
        reverse=True,
    )
    family_stability_rows.sort(
        key=lambda row: (
            row["symbolCount"],
            row["symbolsPassingMinCountThresholdCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )

    symbol_coverage_histogram: Dict[str, int] = {}
    for row in family_coverage_rows:
        key = str(row["symbolCount"])
        symbol_coverage_histogram[key] = symbol_coverage_histogram.get(key, 0) + 1

    return {
        "symbols": ordered_symbols,
        "minCountFilter": min_count_filter,
        "perSymbol": per_symbol,
        "familySignatureV2Overlap": {
            "commonToAllSymbolsCount": len(common_to_all),
            "commonToAllSymbols": common_to_all,
            "pairwiseOverlap": pairwise_overlap,
            "familyCoverageHistogram": symbol_coverage_histogram,
            "topSharedFamilies": family_coverage_rows[:25],
        },
        "familyBehaviorStability": {
            "familyRows": family_stability_rows,
            "familiesPresentInAllFourSymbols": _sort_cross_symbol_rows(family_stability_rows, mode="all_four", limit=50),
            "familiesWithSameForward10SignInAllFourSymbols": _sort_cross_symbol_rows(family_stability_rows, mode="same_sign", limit=50),
            "familiesWithLowCrossSymbolDispersion": _sort_cross_symbol_rows(family_stability_rows, mode="low_dispersion", limit=50),
            "familiesPassingMinCountThresholdInAtLeastThreeSymbols": _sort_cross_symbol_rows(family_stability_rows, mode="min_count_three", limit=50),
        },
    }
