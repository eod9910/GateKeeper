"""Family behavior stability reporting for research-v1."""

from __future__ import annotations

from collections import defaultdict
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence

from .direction import classify_family_direction_v2
from .families import derive_family_signature_v2
from .schema import BarRecord, FamilyStatsRecord, MotifInstanceRecord, OutcomeRecord, PivotRecord


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _median(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


def _stddev(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    if len(values) == 1:
        return 0.0
    mean_value = sum(values) / len(values)
    variance = sum((value - mean_value) ** 2 for value in values) / len(values)
    return variance ** 0.5


def _sign(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _quantile(sorted_values: Sequence[float], quantile: float) -> float:
    if not sorted_values:
        return 0.0
    index = int((len(sorted_values) - 1) * quantile)
    return float(sorted_values[index])


def _rolling_mean(values: Sequence[float], window: int) -> List[float]:
    if not values:
        return []
    prefix = [0.0]
    for value in values:
        prefix.append(prefix[-1] + value)
    result: List[float] = []
    for idx in range(len(values)):
        start = max(0, idx - window + 1)
        total = prefix[idx + 1] - prefix[start]
        count = idx - start + 1
        result.append(total / count if count > 0 else values[idx])
    return result


def _bar_lookup(bars: Sequence[BarRecord]) -> Dict[int, BarRecord]:
    return {bar.bar_index: bar for bar in bars}


def _build_bar_contexts(bars: Sequence[BarRecord]) -> Dict[int, Dict[str, object]]:
    closes = [float(bar.close) for bar in bars]
    atr_ratios = [float((bar.atr_14 / bar.close) if bar.close else 0.0) for bar in bars]
    sorted_atr_ratios = sorted(atr_ratios)
    q1 = _quantile(sorted_atr_ratios, 0.25)
    q2 = _quantile(sorted_atr_ratios, 0.50)
    q3 = _quantile(sorted_atr_ratios, 0.75)

    sma50 = _rolling_mean(closes, 50)
    sma200 = _rolling_mean(closes, 200)

    contexts: Dict[int, Dict[str, object]] = {}
    for idx, bar in enumerate(bars):
        vol_ratio = atr_ratios[idx]
        if vol_ratio <= q1:
            vol_quartile = "Q1"
        elif vol_ratio <= q2:
            vol_quartile = "Q2"
        elif vol_ratio <= q3:
            vol_quartile = "Q3"
        else:
            vol_quartile = "Q4"

        atr = float(bar.atr_14 if bar.atr_14 > 0 else 1.0)
        trend_distance = abs(sma50[idx] - sma200[idx]) / atr
        trend_range = "TREND" if trend_distance >= 1.5 else "RANGE"
        bull_bear = "BULL" if closes[idx] >= sma200[idx] else "BEAR"

        contexts[bar.bar_index] = {
            "volatilityQuartile": vol_quartile,
            "trendRange": trend_range,
            "bullBear": bull_bear,
            "trendDistanceAtr": trend_distance,
        }
    return contexts


def _future_window(bars: Sequence[BarRecord], start_index: int, window_length: int) -> List[BarRecord]:
    end_index = start_index + window_length
    return [bar for bar in bars if start_index < bar.bar_index <= end_index]


def _simulate_trade(
    bars: Sequence[BarRecord],
    entry_bar_index: int,
    entry_close: float,
    entry_atr: float,
    direction: str,
    max_hold_bars: int = 10,
) -> Optional[Dict[str, object]]:
    future_bars = _future_window(bars, entry_bar_index, max_hold_bars)
    if len(future_bars) < max_hold_bars:
        return None

    atr = entry_atr if entry_atr > 0 else 1.0
    if direction == "LONG":
        target_level = entry_close + atr
        stop_level = entry_close - atr
    else:
        target_level = entry_close - atr
        stop_level = entry_close + atr

    for holding_bars, bar in enumerate(future_bars, start=1):
        if direction == "LONG":
            hit_target = bar.high >= target_level
            hit_stop = bar.low <= stop_level
        else:
            hit_target = bar.low <= target_level
            hit_stop = bar.high >= stop_level

        if hit_target and hit_stop:
            return {
                "r_multiple": -1.0,
                "exitReason": "both_hit_same_bar",
                "holdingBars": holding_bars,
                "win": False,
            }
        if hit_target:
            return {
                "r_multiple": 1.0,
                "exitReason": "target",
                "holdingBars": holding_bars,
                "win": True,
            }
        if hit_stop:
            return {
                "r_multiple": -1.0,
                "exitReason": "stop",
                "holdingBars": holding_bars,
                "win": False,
            }

    final_close = future_bars[-1].close
    if direction == "LONG":
        r_multiple = (final_close - entry_close) / atr
    else:
        r_multiple = (entry_close - final_close) / atr

    return {
        "r_multiple": float(r_multiple),
        "exitReason": "time",
        "holdingBars": max_hold_bars,
        "win": r_multiple > 0,
    }


def _equity_drawdown(r_values: Sequence[float]) -> Optional[float]:
    if not r_values:
        return None
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for value in r_values:
        equity += value
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    return max_drawdown


def _bucket_stats(
    trades: Sequence[Dict[str, object]],
    key_name: str,
) -> Dict[str, Dict[str, object]]:
    grouped: Dict[str, List[Dict[str, object]]] = defaultdict(list)
    for trade in trades:
        key = str(trade.get(key_name, "UNKNOWN"))
        grouped[key].append(trade)

    stats: Dict[str, Dict[str, object]] = {}
    for key, items in grouped.items():
        r_values = [float(item["r_multiple"]) for item in items]
        win_rate = sum(1 for item in items if item["win"]) / len(items) if items else None
        stats[key] = {
            "count": len(items),
            "winRate": win_rate,
            "expectancyR": _mean(r_values),
            "averageRMultiple": _mean(r_values),
        }
    return stats


def _holding_time_distribution(trades: Sequence[Dict[str, object]]) -> Dict[str, object]:
    holding_values = [int(trade["holdingBars"]) for trade in trades]
    if not holding_values:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "min": None,
            "max": None,
        }
    return {
        "count": len(holding_values),
        "mean": _mean([float(value) for value in holding_values]),
        "median": _median([float(value) for value in holding_values]),
        "min": min(holding_values),
        "max": max(holding_values),
    }


def _symbol_family_behavior(
    family_signature_v2: str,
    family_record: FamilyStatsRecord,
    motifs: Sequence[MotifInstanceRecord],
    outcomes_by_motif: Dict[str, OutcomeRecord],
    bars: Sequence[BarRecord],
    contexts: Dict[int, Dict[str, object]],
    direction_mode: str,
    structural_direction: str,
) -> Dict[str, object]:
    historical_direction = "BULLISH" if (family_record.avg_forward_10_return_atr or 0.0) >= 0 else "BEARISH"
    if direction_mode == "STRUCTURAL":
        direction_label = structural_direction
    else:
        direction_label = historical_direction
    if direction_label == "AMBIGUOUS":
        return {
            "directionMode": direction_mode,
            "directionalBias": direction_label,
            "tradeCount": 0,
            "winRate": None,
            "expectancyR": None,
            "averageRMultiple": None,
            "naiveStrategyMaxDrawdownR": None,
            "holdingTimeDistribution": {
                "count": 0,
                "mean": None,
                "median": None,
                "min": None,
                "max": None,
            },
            "exitReasonDistribution": {},
            "regimeSensitivity": {
                "volatilityQuartiles": {},
                "trendVsRange": {},
                "bullVsBear": {},
            },
        }
    direction = "LONG" if direction_label == "BULLISH" else "SHORT"
    family_motifs = [
        motif for motif in motifs
        if derive_family_signature_v2(motif.family_signature or "UNSPECIFIED") == family_signature_v2
    ]
    family_motifs.sort(key=lambda motif: outcomes_by_motif[motif.motif_instance_id].entry_bar_index if motif.motif_instance_id in outcomes_by_motif else motif.end_bar_index)

    trades: List[Dict[str, object]] = []
    for motif in family_motifs:
        outcome = outcomes_by_motif.get(motif.motif_instance_id)
        if outcome is None:
            continue
        trade = _simulate_trade(
            bars=bars,
            entry_bar_index=outcome.entry_bar_index,
            entry_close=outcome.entry_close,
            entry_atr=outcome.entry_atr,
            direction=direction,
            max_hold_bars=10,
        )
        if trade is None:
            continue
        context = contexts.get(outcome.entry_bar_index, {})
        trades.append({
            "motifInstanceId": motif.motif_instance_id,
            "entryBarIndex": outcome.entry_bar_index,
            "entryTimestamp": outcome.entry_timestamp,
            "r_multiple": trade["r_multiple"],
            "exitReason": trade["exitReason"],
            "holdingBars": trade["holdingBars"],
            "win": trade["win"],
            "volatilityQuartile": context.get("volatilityQuartile", "UNKNOWN"),
            "trendRange": context.get("trendRange", "UNKNOWN"),
            "bullBear": context.get("bullBear", "UNKNOWN"),
        })

    r_values = [float(trade["r_multiple"]) for trade in trades]
    return {
        "directionMode": direction_mode,
        "directionalBias": direction_label,
        "tradeCount": len(trades),
        "winRate": (sum(1 for trade in trades if trade["win"]) / len(trades)) if trades else None,
        "expectancyR": _mean(r_values),
        "averageRMultiple": _mean(r_values),
        "naiveStrategyMaxDrawdownR": _equity_drawdown(r_values),
        "holdingTimeDistribution": _holding_time_distribution(trades),
        "exitReasonDistribution": {
            key: len([trade for trade in trades if trade["exitReason"] == key])
            for key in sorted({trade["exitReason"] for trade in trades})
        },
        "regimeSensitivity": {
            "volatilityQuartiles": _bucket_stats(trades, "volatilityQuartile"),
            "trendVsRange": _bucket_stats(trades, "trendRange"),
            "bullVsBear": _bucket_stats(trades, "bullBear"),
        },
    }


def build_family_behavior_stability_report(
    symbol_runs: Sequence[Dict[str, object]],
    min_count_filter: int = 5,
) -> Dict[str, object]:
    """Build a cross-symbol family behavior stability report."""
    ordered_symbols = [str(run["symbol"]) for run in symbol_runs]
    family_lookup: Dict[str, Dict[str, FamilyStatsRecord]] = {}
    motifs_lookup: Dict[str, Sequence[MotifInstanceRecord]] = {}
    outcomes_lookup: Dict[str, Dict[str, OutcomeRecord]] = {}
    bars_lookup: Dict[str, Sequence[BarRecord]] = {}
    contexts_lookup: Dict[str, Dict[int, Dict[str, object]]] = {}

    for run in symbol_runs:
        symbol = str(run["symbol"])
        family_lookup[symbol] = {record.family_signature: record for record in run["family_stats_v2"]}
        motifs_lookup[symbol] = list(run["motifs"])
        outcomes_lookup[symbol] = {outcome.motif_instance_id: outcome for outcome in run["outcomes"]}
        bars_lookup[symbol] = list(run["normalized_bars"])
        contexts_lookup[symbol] = _build_bar_contexts(run["normalized_bars"])

    all_signatures = sorted(set().union(*(set(records.keys()) for records in family_lookup.values())) if family_lookup else set())
    family_rows: List[Dict[str, object]] = []

    for signature in all_signatures:
        structural_direction_info = classify_family_direction_v2(signature)
        structural_direction = structural_direction_info["direction"]
        per_symbol: Dict[str, Dict[str, object]] = {}
        avg_forward_values: List[float] = []
        expectancy_values: List[float] = []
        win_rate_values: List[float] = []
        mean_r_values: List[float] = []
        structural_expectancy_values: List[float] = []
        structural_win_rate_values: List[float] = []
        structural_mean_r_values: List[float] = []
        count_pass_symbols: List[str] = []
        sign_values: List[int] = []
        present_symbols: List[str] = []
        direction_agreement_symbols: List[str] = []
        direction_disagreement_symbols: List[str] = []
        direction_ambiguous_symbols: List[str] = []

        for symbol in ordered_symbols:
            family_record = family_lookup[symbol].get(signature)
            if family_record is None:
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
                    "isCandidateFamily": False,
                    "historicalDirection": None,
                    "structuralDirection": structural_direction,
                    "directionAgreement": "NOT_PRESENT",
                    "tradeSimulationInferred": None,
                    "tradeSimulationStructural": None,
                }
                continue

            present_symbols.append(symbol)
            sign_value = _sign(family_record.avg_forward_10_return_atr)
            if sign_value is not None:
                sign_values.append(sign_value)
            if family_record.occurrence_count >= min_count_filter and family_record.valid_10bar_count >= min_count_filter:
                count_pass_symbols.append(symbol)
            if family_record.avg_forward_10_return_atr is not None:
                avg_forward_values.append(family_record.avg_forward_10_return_atr)

            historical_direction = "BULLISH" if (family_record.avg_forward_10_return_atr or 0.0) >= 0 else "BEARISH"
            if structural_direction == "AMBIGUOUS":
                direction_agreement = "AMBIGUOUS"
                direction_ambiguous_symbols.append(symbol)
            elif historical_direction == structural_direction:
                direction_agreement = "AGREE"
                direction_agreement_symbols.append(symbol)
            else:
                direction_agreement = "DISAGREE"
                direction_disagreement_symbols.append(symbol)

            inferred_trade_simulation = _symbol_family_behavior(
                family_signature_v2=signature,
                family_record=family_record,
                motifs=motifs_lookup[symbol],
                outcomes_by_motif=outcomes_lookup[symbol],
                bars=bars_lookup[symbol],
                contexts=contexts_lookup[symbol],
                direction_mode="INFERRED",
                structural_direction=structural_direction,
            )
            structural_trade_simulation = _symbol_family_behavior(
                family_signature_v2=signature,
                family_record=family_record,
                motifs=motifs_lookup[symbol],
                outcomes_by_motif=outcomes_lookup[symbol],
                bars=bars_lookup[symbol],
                contexts=contexts_lookup[symbol],
                direction_mode="STRUCTURAL",
                structural_direction=structural_direction,
            )
            if inferred_trade_simulation["expectancyR"] is not None:
                expectancy_values.append(float(inferred_trade_simulation["expectancyR"]))
            if inferred_trade_simulation["winRate"] is not None:
                win_rate_values.append(float(inferred_trade_simulation["winRate"]))
            if inferred_trade_simulation["averageRMultiple"] is not None:
                mean_r_values.append(float(inferred_trade_simulation["averageRMultiple"]))
            if structural_trade_simulation["expectancyR"] is not None:
                structural_expectancy_values.append(float(structural_trade_simulation["expectancyR"]))
            if structural_trade_simulation["winRate"] is not None:
                structural_win_rate_values.append(float(structural_trade_simulation["winRate"]))
            if structural_trade_simulation["averageRMultiple"] is not None:
                structural_mean_r_values.append(float(structural_trade_simulation["averageRMultiple"]))

            per_symbol[symbol] = {
                "present": True,
                "occurrenceCount": family_record.occurrence_count,
                "discoveryCount": family_record.discovery_count,
                "validationCount": family_record.validation_count,
                "holdoutCount": family_record.holdout_count,
                "avgForward10ReturnAtr": family_record.avg_forward_10_return_atr,
                "medianForward10ReturnAtr": family_record.median_forward_10_return_atr,
                "hitPlus1AtrFirstRate": family_record.hit_plus_1atr_first_rate,
                "signConsistencyAcrossSplits": family_record.sign_consistent_across_splits,
                "passesMinCountThreshold": family_record.passes_min_count and family_record.passes_outcome_coverage,
                "isCandidateFamily": family_record.is_candidate_family,
                "historicalDirection": historical_direction,
                "structuralDirection": structural_direction,
                "directionAgreement": direction_agreement,
                "tradeSimulationInferred": inferred_trade_simulation,
                "tradeSimulationStructural": structural_trade_simulation,
            }

        same_sign_all_four = (
            len(present_symbols) == len(ordered_symbols)
            and len(sign_values) == len(ordered_symbols)
            and len(set(sign_values)) == 1
        )
        candidate_family = len(present_symbols) == len(ordered_symbols) and len(count_pass_symbols) >= 3

        family_rows.append({
            "familySignatureV2": signature,
            "structuralDirection": structural_direction,
            "structuralDirectionReason": structural_direction_info["reason"],
            "structuralDirectionComponents": structural_direction_info,
            "symbolCount": len(present_symbols),
            "symbolsPresent": present_symbols,
            "perSymbol": per_symbol,
            "crossSymbolMeanAvgForward10ReturnAtr": _mean(avg_forward_values),
            "crossSymbolStddevAvgForward10ReturnAtr": _stddev(avg_forward_values),
            "crossSymbolMeanExpectancyRInferred": _mean(expectancy_values),
            "crossSymbolStddevExpectancyRInferred": _stddev(expectancy_values),
            "crossSymbolMeanWinRateInferred": _mean(win_rate_values),
            "crossSymbolStddevWinRateInferred": _stddev(win_rate_values),
            "crossSymbolMeanAverageRMultipleInferred": _mean(mean_r_values),
            "crossSymbolStddevAverageRMultipleInferred": _stddev(mean_r_values),
            "crossSymbolMeanExpectancyRStructural": _mean(structural_expectancy_values),
            "crossSymbolStddevExpectancyRStructural": _stddev(structural_expectancy_values),
            "crossSymbolMeanWinRateStructural": _mean(structural_win_rate_values),
            "crossSymbolStddevWinRateStructural": _stddev(structural_win_rate_values),
            "crossSymbolMeanAverageRMultipleStructural": _mean(structural_mean_r_values),
            "crossSymbolStddevAverageRMultipleStructural": _stddev(structural_mean_r_values),
            "sameDirectionalSignAcrossAllSymbols": same_sign_all_four,
            "symbolsPassingMinCountThreshold": count_pass_symbols,
            "symbolsPassingMinCountThresholdCount": len(count_pass_symbols),
            "passesMinCountThresholdInAtLeastThreeSymbols": len(count_pass_symbols) >= 3,
            "isCandidateFamily": candidate_family,
            "directionAgreementSummary": {
                "agreeSymbols": direction_agreement_symbols,
                "disagreeSymbols": direction_disagreement_symbols,
                "ambiguousSymbols": direction_ambiguous_symbols,
            },
        })

    families_present_in_all_four = [row for row in family_rows if row["symbolCount"] == 4]
    families_same_sign = [row for row in families_present_in_all_four if row["sameDirectionalSignAcrossAllSymbols"]]
    families_low_dispersion = [
        row for row in families_present_in_all_four
        if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None
    ]
    families_min_count_three = [row for row in family_rows if row["passesMinCountThresholdInAtLeastThreeSymbols"]]
    candidate_families = [row for row in family_rows if row["isCandidateFamily"]]
    families_structural_ambiguous = [row for row in family_rows if row["structuralDirection"] == "AMBIGUOUS"]
    families_direction_agree = [
        row for row in family_rows
        if row["structuralDirection"] != "AMBIGUOUS"
        and len(row["directionAgreementSummary"]["disagreeSymbols"]) == 0
        and len(row["directionAgreementSummary"]["agreeSymbols"]) > 0
    ]
    families_direction_disagree = [
        row for row in family_rows
        if len(row["directionAgreementSummary"]["disagreeSymbols"]) > 0
    ]

    families_present_in_all_four.sort(
        key=lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )
    families_same_sign.sort(
        key=lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )
    families_low_dispersion.sort(
        key=lambda row: (
            row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0,
            -(row["symbolsPassingMinCountThresholdCount"]),
            -(1 if row["sameDirectionalSignAcrossAllSymbols"] else 0),
            -(abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0)),
            row["familySignatureV2"],
        )
    )
    families_min_count_three.sort(
        key=lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            row["symbolCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            -(row["crossSymbolStddevAvgForward10ReturnAtr"] if row["crossSymbolStddevAvgForward10ReturnAtr"] is not None else 999999.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )
    families_direction_agree.sort(
        key=lambda row: (
            row["symbolsPassingMinCountThresholdCount"],
            abs(row["crossSymbolMeanExpectancyRStructural"] or 0.0),
            -(row["crossSymbolStddevExpectancyRStructural"] if row["crossSymbolStddevExpectancyRStructural"] is not None else 999999.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )
    families_structural_ambiguous.sort(
        key=lambda row: (
            row["symbolCount"],
            row["symbolsPassingMinCountThresholdCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )
    families_direction_disagree.sort(
        key=lambda row: (
            len(row["directionAgreementSummary"]["disagreeSymbols"]),
            row["symbolsPassingMinCountThresholdCount"],
            abs(row["crossSymbolMeanAvgForward10ReturnAtr"] or 0.0),
            row["familySignatureV2"],
        ),
        reverse=True,
    )

    return {
        "candidateDefinition": "present_in_all_four_symbols_and_passes_min_count_threshold_in_at_least_three_symbols",
        "minCountFilter": min_count_filter,
        "symbols": ordered_symbols,
        "candidateFamilies": candidate_families,
        "directionComparison": {
            "familiesWhereStructuralAndHistoricalDirectionAgree": families_direction_agree,
            "familiesWhereStructuralDirectionIsAmbiguous": families_structural_ambiguous,
            "familiesWhereStructuralDirectionDisagreesWithHistoricalBias": families_direction_disagree,
        },
        "rankings": {
            "familiesPresentInAllFourSymbols": families_present_in_all_four,
            "familiesWithSameForward10SignInAllFourSymbols": families_same_sign,
            "familiesWithLowDispersionOfOutcomesAcrossSymbols": families_low_dispersion,
            "familiesPassingCountThresholdsInAtLeastThreeOfFourSymbols": families_min_count_three,
        },
    }
