#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple, Union

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from research_v1 import (
    build_five_pivot_motifs,
    build_leg_records,
    extract_atr_reversal_pivots,
    label_pivots_against_same_side_history,
    normalize_bars,
)
from research_v1.families import derive_family_signature_v2
from research_v1.schema import MotifInstanceRecord, PivotRecord


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        "cost_config": spec.get("cost_config") or None,
        "entry_config": spec.get("entry_config") or None,
        "exit_config": spec.get("exit_config") or None,
        "risk_config": spec.get("risk_config") or None,
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "structure_config": spec.get("structure_config") or None,
        "version": spec.get("version"),
    }

    def canonicalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: canonicalize(value[k]) for k in sorted(value.keys())}
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        return value

    json_str = json.dumps(canonicalize(payload), separators=(",", ":"))
    return hashlib.sha256(json_str.encode("utf-8")).hexdigest()


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_allowed_families(value: Any) -> Set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",")]
        return {part for part in parts if part}
    if isinstance(value, Iterable):
        out: Set[str] = set()
        for item in value:
            text = str(item or "").strip()
            if text:
                out.add(text)
        return out
    return set()


def _build_chart_data(data: Sequence[OHLCV]) -> List[Dict[str, Any]]:
    is_intraday = _detect_intraday(list(data))
    return [
        {
            "time": _format_chart_time(bar.timestamp, is_intraday),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(getattr(bar, "volume", 0.0) or 0.0),
        }
        for bar in data
    ]


def _pipeline_outputs(
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    setup: Dict[str, Any],
) -> Tuple[List[Any], Dict[str, PivotRecord], List[MotifInstanceRecord]]:
    normalized_bars = normalize_bars(data, symbol=symbol, timeframe=timeframe)
    pivots = extract_atr_reversal_pivots(
        normalized_bars,
        symbol=symbol,
        timeframe=timeframe,
        reversal_multiple=_safe_float(
            setup.get("reversal_multiple_atr", setup.get("reversal_multiple", 2.0)),
            2.0,
        ),
        min_bars_between_pivots=_safe_int(setup.get("min_bars_between_pivots", 3), 3),
    )
    legs = build_leg_records(normalized_bars, pivots, symbol=symbol, timeframe=timeframe)
    labels = label_pivots_against_same_side_history(
        pivots,
        normalized_bars,
        equal_band_atr=_safe_float(setup.get("equal_band_atr", 0.25), 0.25),
    )
    motifs = build_five_pivot_motifs(
        pivots=pivots,
        legs=legs,
        labels=labels,
        symbol=symbol,
        timeframe=timeframe,
    )
    pivot_lookup = {pivot.pivot_id: pivot for pivot in pivots}
    return normalized_bars, pivot_lookup, motifs


def _matched_signals(
    motifs: Sequence[MotifInstanceRecord],
    pivot_lookup: Dict[str, PivotRecord],
    allowed_families: Set[str],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for motif in motifs:
        exact_signature = motif.family_signature or "UNSPECIFIED"
        family_signature_v2 = derive_family_signature_v2(exact_signature)
        if allowed_families and family_signature_v2 not in allowed_families:
            continue
        if not motif.pivot_ids:
            continue
        terminal_pivot = pivot_lookup.get(motif.pivot_ids[-1])
        if terminal_pivot is None:
            continue
        rows.append(
            {
                "motif": motif,
                "family_signature": exact_signature,
                "family_signature_v2": family_signature_v2,
                "pivot": terminal_pivot,
                "signal_bar_index": int(terminal_pivot.confirmation_bar_index),
            }
        )
    rows.sort(
        key=lambda row: (
            int(row["signal_bar_index"]),
            str(row["motif"].motif_instance_id),
        )
    )
    return rows


def _signal_indices_from_rows(rows: Sequence[Dict[str, Any]]) -> Set[int]:
    return {int(row["signal_bar_index"]) for row in rows}


def run_structural_family_signal_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Union[List[Dict[str, Any]], Set[int]]:
    setup = spec.get("setup_config", {}) or {}
    allowed_families = _normalize_allowed_families(
        setup.get("allowed_families", setup.get("allowed_family_signatures_v2"))
    )
    if len(data) < 20:
        return set() if mode == "signal" else []

    normalized_bars, pivot_lookup, motifs = _pipeline_outputs(data, symbol, timeframe, setup)
    matched_rows = _matched_signals(motifs, pivot_lookup, allowed_families)

    if mode == "signal":
        return _signal_indices_from_rows(matched_rows)

    lookback_bars = max(1, _safe_int(setup.get("lookback_bars", 250), 250))
    max_candidates = max(1, _safe_int(setup.get("max_candidates", 20), 20))
    min_signal_bar = max(0, len(normalized_bars) - lookback_bars)

    recent_rows = [row for row in matched_rows if int(row["signal_bar_index"]) >= min_signal_bar]
    recent_rows = recent_rows[-max_candidates:]
    if not recent_rows:
        return []

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "structural_family_signal_v1")
    chart_data = _build_chart_data(data)
    allowed_family_list = sorted(allowed_families)
    candidates: List[Dict[str, Any]] = []

    for row in recent_rows:
        motif = row["motif"]
        pivot = row["pivot"]
        signal_bar_index = int(row["signal_bar_index"])
        signal_bar = normalized_bars[min(signal_bar_index, len(normalized_bars) - 1)]
        family_signature_v2 = str(row["family_signature_v2"])
        family_signature = str(row["family_signature"])
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:8]}_"
            f"{motif.start_bar_index}_{signal_bar_index}"
        )
        candidates.append(
            {
                "candidate_id": candidate_id,
                "id": candidate_id,
                "strategy_version_id": strategy_version_id,
                "spec_hash": spec_hash,
                "symbol": symbol,
                "timeframe": timeframe,
                "score": 1.0,
                "entry_ready": True,
                "rule_checklist": [
                    {
                        "rule_name": "five_pivot_motif_detected",
                        "passed": True,
                        "value": motif.motif_instance_id,
                        "threshold": True,
                    },
                    {
                        "rule_name": "family_allowed",
                        "passed": True,
                        "value": family_signature_v2,
                        "threshold": allowed_family_list or "ANY",
                    },
                ],
                "anchors": {
                    "motif_instance_id": motif.motif_instance_id,
                    "family_signature": family_signature,
                    "family_signature_v2": family_signature_v2,
                    "pivot_ids": list(motif.pivot_ids),
                    "confirmation_bar_index": signal_bar_index,
                    "confirmation_timestamp": signal_bar.timestamp,
                    "confirmation_price": float(signal_bar.close),
                    "pivot_5": {
                        "pivot_id": pivot.pivot_id,
                        "bar_index": int(pivot.bar_index),
                        "confirmation_bar_index": signal_bar_index,
                        "price": float(pivot.price),
                        "timestamp": str(pivot.timestamp),
                    },
                },
                "window_start": int(motif.start_bar_index),
                "window_end": int(signal_bar_index),
                "pattern_type": "structural_family_signal",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "chart_data": chart_data,
                "node_result": {
                    "passed": True,
                    "score": 1.0,
                    "reason": f"Detected allowed structural family {family_signature_v2}",
                    "features": {
                        "family_signature_v2": family_signature_v2,
                        "confirmation_bar_index": signal_bar_index,
                    },
                    "anchors": {
                        "motif_instance_id": motif.motif_instance_id,
                        "confirmation_bar_index": signal_bar_index,
                    },
                },
                "output_ports": {
                    "signal": {
                        "passed": True,
                        "familySignatureV2": family_signature_v2,
                        "signalBarIndex": signal_bar_index,
                        "signalTimestamp": signal_bar.timestamp,
                        "motifInstanceId": motif.motif_instance_id,
                    },
                },
            }
        )

    return candidates
