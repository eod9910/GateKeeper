#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


@dataclass
class PreprocessResult:
    values: List[float]
    method: str
    source: str
    window: int
    causal: bool
    metadata: Dict[str, Any]


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


def build_rule(rule_name: str, passed: bool, value: Any, threshold: Any) -> Dict[str, Any]:
    return {
        "rule_name": rule_name,
        "passed": bool(passed),
        "value": value,
        "threshold": threshold,
    }


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def ratio_distance(a: float, b: float) -> float:
    denom = max(abs(float(a)), abs(float(b)), 1e-9)
    return abs(float(a) - float(b)) / denom


def ratio_similarity(a: float, b: float, tolerance: float) -> float:
    tol = max(float(tolerance), 1e-9)
    return clamp01(1.0 - (ratio_distance(a, b) / tol))


def chart_time(data: List[OHLCV], index: int) -> Any:
    if not data:
        return ""
    index = max(0, min(int(index), len(data) - 1))
    return _format_chart_time(data[index].timestamp, _detect_intraday(data))


def build_chart_data(data: List[OHLCV]) -> List[Dict[str, Any]]:
    is_intraday = _detect_intraday(data)
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


def extract_price_series(data: List[OHLCV], source: str = "close") -> List[float]:
    key = str(source or "close").strip().lower()
    if key == "open":
        return [float(bar.open) for bar in data]
    if key == "high":
        return [float(bar.high) for bar in data]
    if key == "low":
        return [float(bar.low) for bar in data]
    if key == "hl2":
        return [(float(bar.high) + float(bar.low)) / 2.0 for bar in data]
    if key == "hlc3":
        return [(float(bar.high) + float(bar.low) + float(bar.close)) / 3.0 for bar in data]
    if key == "ohlc4":
        return [
            (float(bar.open) + float(bar.high) + float(bar.low) + float(bar.close)) / 4.0
            for bar in data
        ]
    return [float(bar.close) for bar in data]


def _normalize_window(window: Any, minimum: int = 1) -> int:
    try:
        normalized = int(float(window))
    except Exception:
        normalized = minimum
    return max(minimum, normalized)


def _sma(values: np.ndarray, window: int) -> np.ndarray:
    out = np.empty_like(values, dtype=float)
    for idx in range(len(values)):
        start = max(0, idx - window + 1)
        out[idx] = float(np.mean(values[start : idx + 1]))
    return out


def _ema(values: np.ndarray, window: int) -> np.ndarray:
    out = np.empty_like(values, dtype=float)
    alpha = 2.0 / (window + 1.0)
    out[0] = values[0]
    for idx in range(1, len(values)):
        out[idx] = (alpha * values[idx]) + ((1.0 - alpha) * out[idx - 1])
    return out


def _median(values: np.ndarray, window: int) -> np.ndarray:
    out = np.empty_like(values, dtype=float)
    for idx in range(len(values)):
        start = max(0, idx - window + 1)
        out[idx] = float(np.median(values[start : idx + 1]))
    return out


def _apply_non_causal_optional(
    values: np.ndarray,
    method: str,
    window: int,
) -> Tuple[np.ndarray, str, Dict[str, Any]]:
    method_key = str(method).strip().lower()
    metadata: Dict[str, Any] = {"optional_method": method_key, "causal": False}

    if method_key == "savgol":
        try:
            from scipy.signal import savgol_filter  # type: ignore
        except Exception:
            return values, "raw", {"fallback_from": method_key, "fallback_to": "raw", "reason": "scipy_unavailable"}
        win = max(3, window)
        if win % 2 == 0:
            win += 1
        polyorder = min(2, win - 1)
        return savgol_filter(values, win, polyorder), method_key, metadata

    if method_key == "kalman":
        try:
            from pykalman import KalmanFilter  # type: ignore
        except Exception:
            return values, "raw", {"fallback_from": method_key, "fallback_to": "raw", "reason": "pykalman_unavailable"}
        kf = KalmanFilter(initial_state_mean=float(values[0]), n_dim_obs=1)
        kf = kf.em(values, n_iter=5)
        means, _ = kf.filter(values)
        return means.flatten(), method_key, metadata

    if method_key == "wavelet":
        try:
            import pywt  # type: ignore
        except Exception:
            return values, "raw", {"fallback_from": method_key, "fallback_to": "raw", "reason": "pywavelets_unavailable"}
        coeff = pywt.wavedec(values, "db1", mode="per")
        for idx in range(1, len(coeff)):
            coeff[idx] = pywt.threshold(coeff[idx], value=np.std(coeff[idx]) / 2.0, mode="soft")
        smoothed = pywt.waverec(coeff, "db1", mode="per")
        smoothed = smoothed[: len(values)]
        return np.asarray(smoothed, dtype=float), method_key, metadata

    return values, "raw", {"fallback_from": method_key, "fallback_to": "raw", "reason": "unknown_optional_method"}


def preprocess_ohlcv_series(
    data: List[OHLCV],
    source: str = "close",
    method: str = "raw",
    window: Any = 5,
    passes: Any = 1,
    fallback_method: str = "ema",
) -> PreprocessResult:
    values = np.asarray(extract_price_series(data, source), dtype=float)
    if values.size == 0:
        return PreprocessResult(values=[], method="raw", source=source, window=1, causal=True, metadata={})

    method_key = str(method or "raw").strip().lower()
    win = _normalize_window(window, minimum=1)
    num_passes = _normalize_window(passes, minimum=1)
    metadata: Dict[str, Any] = {"requested_method": method_key, "passes": num_passes}
    current = values.copy()
    actual_method = method_key

    for _ in range(num_passes):
        if actual_method == "raw":
            continue
        if actual_method == "sma":
            current = _sma(current, win)
            continue
        if actual_method == "ema":
            current = _ema(current, win)
            continue
        if actual_method == "median":
            current = _median(current, win)
            continue

        current, resolved_method, optional_meta = _apply_non_causal_optional(current, actual_method, win)
        metadata.update(optional_meta)
        actual_method = resolved_method
        if resolved_method == "raw" and method_key not in ("raw", "sma", "ema", "median"):
            fallback = str(fallback_method or "raw").strip().lower()
            if fallback in ("sma", "ema", "median"):
                actual_method = fallback
                metadata["fallback_to"] = fallback
                if fallback == "sma":
                    current = _sma(current, win)
                elif fallback == "ema":
                    current = _ema(current, win)
                else:
                    current = _median(current, win)
            else:
                actual_method = "raw"
        if actual_method == "raw":
            break

    causal = actual_method in ("raw", "sma", "ema", "median")
    metadata["actual_method"] = actual_method
    return PreprocessResult(
        values=[float(v) for v in current.tolist()],
        method=actual_method,
        source=source,
        window=win,
        causal=causal,
        metadata=metadata,
    )


def find_local_extrema(
    values: Sequence[float],
    left: Any = 2,
    right: Optional[Any] = None,
    mode: str = "max",
) -> List[Dict[str, Any]]:
    arr = [float(v) for v in values]
    if not arr:
        return []

    left_n = _normalize_window(left, minimum=1)
    right_n = _normalize_window(right if right is not None else left_n, minimum=1)
    mode_key = str(mode or "max").strip().lower()
    extrema: List[Dict[str, Any]] = []

    for idx in range(left_n, len(arr) - right_n):
        center = arr[idx]
        left_slice = arr[idx - left_n : idx]
        right_slice = arr[idx + 1 : idx + right_n + 1]
        if mode_key == "min":
            if all(center < other for other in left_slice) and all(center <= other for other in right_slice):
                extrema.append({"index": idx, "value": center, "type": "LOW"})
        else:
            if all(center > other for other in left_slice) and all(center >= other for other in right_slice):
                extrema.append({"index": idx, "value": center, "type": "HIGH"})

    return extrema


def merge_alternating_pivots(
    highs: Sequence[Dict[str, Any]],
    lows: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    events = [dict(item) for item in highs] + [dict(item) for item in lows]
    events.sort(key=lambda item: (int(item["index"]), 0 if item["type"] == "HIGH" else 1))

    merged: List[Dict[str, Any]] = []
    for item in events:
        current = {
            "index": int(item["index"]),
            "price": float(item["value"]),
            "type": str(item["type"]).upper(),
        }
        if not merged:
            merged.append(current)
            continue

        previous = merged[-1]
        if current["index"] == previous["index"]:
            if current["type"] == previous["type"]:
                if current["type"] == "HIGH" and current["price"] > previous["price"]:
                    merged[-1] = current
                elif current["type"] == "LOW" and current["price"] < previous["price"]:
                    merged[-1] = current
            continue

        if current["type"] == previous["type"]:
            if current["type"] == "HIGH" and current["price"] >= previous["price"]:
                merged[-1] = current
            elif current["type"] == "LOW" and current["price"] <= previous["price"]:
                merged[-1] = current
            continue

        merged.append(current)

    return merged


def build_candidate(
    *,
    data: List[OHLCV],
    candidate_id: str,
    strategy_version_id: str,
    spec_hash: str,
    symbol: str,
    timeframe: str,
    score: float,
    entry_ready: bool,
    pattern_type: str,
    rule_checklist: List[Dict[str, Any]],
    anchors: Dict[str, Any],
    node_features: Dict[str, Any],
    node_reason: str,
    output_ports: Dict[str, Any],
    visual: Optional[Dict[str, Any]] = None,
    window_start: int = 0,
    window_end: Optional[int] = None,
    candidate_role: Optional[str] = None,
    candidate_actionability: Optional[str] = None,
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": round(clamp01(score), 4),
        "entry_ready": bool(entry_ready),
        "rule_checklist": rule_checklist,
        "anchors": anchors,
        "window_start": int(window_start),
        "window_end": int(len(data) - 1 if window_end is None else window_end),
        "pattern_type": pattern_type,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": build_chart_data(data),
        "visual": visual or {"markers": [], "overlay_series": []},
        "node_result": {
            "passed": bool(output_ports.get("signal", {}).get("passed", False)),
            "score": round(clamp01(score), 4),
            "features": node_features,
            "anchors": anchors,
            "reason": node_reason,
        },
        "output_ports": output_ports,
    }
    if candidate_role:
        payload["candidate_role"] = candidate_role
    if candidate_actionability:
        payload["candidate_actionability"] = candidate_actionability
    if extras:
        payload.update(extras)
    return payload
