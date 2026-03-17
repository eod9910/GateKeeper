#!/usr/bin/env python3
"""
Run centralized base-detection methods one-by-one and emit a unified report.

This script solves two problems:
1) A single source of truth for which base methods are under test.
2) Deterministic side-by-side execution/reporting for each method.

Usage:
  py backend/scripts/run_base_method_suite.py --symbol NVDA --interval 1wk --period 5y
  py backend/scripts/run_base_method_suite.py --list
  py backend/scripts/run_base_method_suite.py --method rdp_wiggle_base --method base_box_detector_rdp_hybrid_v1_pattern
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


BACKEND_DIR = Path(__file__).resolve().parents[1]
SERVICES_DIR = BACKEND_DIR / "services"
PATTERNS_DIR = BACKEND_DIR / "data" / "patterns"
DEFAULT_SUITE_FILE = PATTERNS_DIR / "base_method_suite.json"
REGISTRY_FILE = PATTERNS_DIR / "registry.json"
REPORT_DIR = BACKEND_DIR / "data" / "research" / "base-method-suite"

if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from strategyRunner import run_strategy  # type: ignore
from platform_sdk.ohlcv import fetch_data_yfinance  # type: ignore


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _interval_to_timeframe(interval: str) -> str:
    v = str(interval or "").strip().lower()
    if "wk" in v:
        return "W"
    if "mo" in v:
        return "M"
    if v.endswith("h"):
        return v.upper()
    if v.endswith("m"):
        return v.upper()
    return "D"


BASE_QUALIFY_RULE_NAMES = {
    "base_detected",
    "base_qualified",
    "flat_base_events_found",
    "base_zones_found",
}


def _to_float(value: Any) -> Optional[float]:
    try:
        v = float(value)
    except Exception:
        return None
    return v if v == v else None  # NaN guard


def _to_int(value: Any) -> Optional[int]:
    try:
        v = int(value)
    except Exception:
        return None
    return v


def _candidate_rules(candidate: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = candidate.get("rule_checklist")
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("rule_name") or "").strip()
        if not name:
            continue
        out.append({"rule_name": name, "passed": bool(item.get("passed") is True)})
    return out


def _is_base_like_candidate(candidate: Dict[str, Any]) -> bool:
    pattern = str(candidate.get("pattern_type") or candidate.get("strategy_version_id") or "").strip().lower()
    if "base" in pattern:
        return True
    rules = _candidate_rules(candidate)
    return any(r.get("rule_name") in BASE_QUALIFY_RULE_NAMES for r in rules)


def _passes_strict_base(candidate: Dict[str, Any], strict_min_score: float) -> bool:
    rules = _candidate_rules(candidate)
    qualifying = [r for r in rules if r.get("rule_name") in BASE_QUALIFY_RULE_NAMES]
    if qualifying:
        return any(bool(r.get("passed")) for r in qualifying)

    # Fallback for base-like plugins that do not expose standardized rule names.
    if isinstance(candidate.get("entry_ready"), bool):
        return bool(candidate.get("entry_ready"))
    score = _to_float(candidate.get("score"))
    return score is not None and score >= strict_min_score


def _apply_strict_base_filter(
    candidates: List[Dict[str, Any]],
    strict_base: bool,
    strict_min_score: float,
) -> List[Dict[str, Any]]:
    rows = candidates if isinstance(candidates, list) else []
    if not strict_base:
        return rows
    out: List[Dict[str, Any]] = []
    for c in rows:
        if not isinstance(c, dict):
            continue
        if not _is_base_like_candidate(c):
            out.append(c)
            continue
        if _passes_strict_base(c, strict_min_score):
            out.append(c)
    return out


def _to_json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _to_json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_to_json_safe(v) for v in value]
    # Fallback for datetime/numpy/custom classes
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return _to_json_safe(vars(value))
        except Exception:
            pass
    return str(value)


def _parse_symbol_csv(text: str) -> List[str]:
    out: List[str] = []
    for part in str(text or "").split(","):
        sym = part.strip().upper()
        if sym:
            out.append(sym)
    return out


def _load_symbols_file(path: Path) -> List[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    out: List[str] = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.extend(_parse_symbol_csv(line))
    return out


def _unique_keep_order(items: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _fetch_symbol_data(symbol: str, period: str, interval: str, verbose: bool) -> List[Any]:
    if verbose:
        return fetch_data_yfinance(symbol, period=period, interval=interval) or []
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fetch_data_yfinance(symbol, period=period, interval=interval) or []


def _candidate_score(candidate: Dict[str, Any]) -> float:
    return float(candidate.get("score", 0.0) or 0.0)


def _pick_top_candidate(candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    rows = [c for c in (candidates or []) if isinstance(c, dict)]
    if not rows:
        return None
    return max(rows, key=_candidate_score)


def _make_base_mark(
    *,
    source: str,
    floor: Any = None,
    ceiling: Any = None,
    start_idx: Any = None,
    end_idx: Any = None,
    duration_bars: Any = None,
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lo = _to_float(floor)
    hi = _to_float(ceiling)
    start = _to_int(start_idx)
    end = _to_int(end_idx)
    duration = _to_float(duration_bars)

    if lo is not None and hi is not None and lo > hi:
        lo, hi = hi, lo

    if duration is None and start is not None and end is not None and start >= 0 and end >= start:
        duration = float(end - start + 1)

    has_price_box = lo is not None and hi is not None and hi > lo
    has_start = start is not None and start >= 0
    has_end = end is not None and end >= 0
    has_time_window = (has_start and has_end and end >= start) or (duration is not None and duration > 0)

    if not has_price_box and not has_time_window:
        return {}

    annotation_score = 0.0
    if has_price_box:
        annotation_score += 0.6
    if has_start:
        annotation_score += 0.2
    if has_end or (duration is not None and duration > 0):
        annotation_score += 0.2

    payload: Dict[str, Any] = {
        "source": source,
        "floor": lo,
        "ceiling": hi,
        "start_idx": start,
        "end_idx": end,
        "duration_bars": int(duration) if duration is not None else None,
        "has_price_box": has_price_box,
        "has_time_window": has_time_window,
        "complete": has_price_box and has_time_window,
        "annotation_score": round(annotation_score, 4),
    }
    if extras:
        payload["extras"] = _to_json_safe(extras)
    return payload


def _extract_base_mark(candidate: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(candidate, dict):
        return {}

    ports = candidate.get("output_ports") if isinstance(candidate.get("output_ports"), dict) else {}
    chart_base_start = _to_int(candidate.get("chart_base_start"))
    chart_base_end = _to_int(candidate.get("chart_base_end"))
    chart_data = candidate.get("chart_data")
    chart_len = len(chart_data) if isinstance(chart_data, list) else 0
    chart_last_idx = chart_len - 1 if chart_len > 0 else None

    boxes = ports.get("base_boxes", {}) if isinstance(ports.get("base_boxes"), dict) else {}
    best_box = boxes.get("best", {}) if isinstance(boxes.get("best"), dict) else {}
    if best_box:
        return _make_base_mark(
            source="output_ports.base_boxes.best",
            floor=best_box.get("floor"),
            ceiling=best_box.get("ceiling"),
            start_idx=best_box.get("base_start_idx", chart_base_start),
            end_idx=best_box.get("base_end_idx", chart_base_end),
            duration_bars=best_box.get("base_span_bars"),
            extras={
                "score": best_box.get("score"),
                "touches_top": best_box.get("touches_top"),
                "touches_bottom": best_box.get("touches_bottom"),
                "pivot_switches": best_box.get("pivot_switches"),
                "trendiness": best_box.get("trendiness"),
            },
        )

    wiggle = ports.get("rdp_wiggle_base", {}) if isinstance(ports.get("rdp_wiggle_base"), dict) else {}
    wiggle_events = wiggle.get("events", []) if isinstance(wiggle.get("events"), list) else []
    if wiggle_events:
        def _wiggle_rank(event: Dict[str, Any]) -> tuple:
            return (
                1 if _to_int(event.get("qualify_idx")) is not None else 0,
                1 if bool(event.get("active")) else 0,
                1 if _to_float(event.get("cap_price")) is not None and _to_float(event.get("base_floor")) is not None else 0,
            )

        best_event = max((e for e in wiggle_events if isinstance(e, dict)), key=_wiggle_rank, default=None)
        if best_event:
            start = _to_int(best_event.get("anchor_idx"))
            qualify_rel = _to_int(best_event.get("qualify_idx"))
            qualify_abs = (start + qualify_rel) if start is not None and qualify_rel is not None else None
            end = _to_int(best_event.get("escape_idx"))
            if end is None:
                end = qualify_abs if qualify_abs is not None else chart_last_idx
            return _make_base_mark(
                source="output_ports.rdp_wiggle_base.events",
                floor=best_event.get("base_floor", best_event.get("anchor_price")),
                ceiling=best_event.get("cap_price"),
                start_idx=start,
                end_idx=end,
                extras={
                    "active": best_event.get("active"),
                    "qualify_idx": best_event.get("qualify_idx"),
                    "escape_idx": best_event.get("escape_idx"),
                    "wiggle": best_event.get("wiggle"),
                    "alt": best_event.get("alt"),
                    "amp": best_event.get("amp"),
                    "turn": best_event.get("turn"),
                },
            )

    flat = ports.get("rdp_flat_base", {}) if isinstance(ports.get("rdp_flat_base"), dict) else {}
    flat_events = flat.get("events", []) if isinstance(flat.get("events"), list) else []
    if flat_events:
        best_event = max(
            (e for e in flat_events if isinstance(e, dict)),
            key=lambda e: (
                1 if bool(e.get("active")) else 0,
                1 if _to_float(e.get("base_ceiling")) is not None and _to_float(e.get("base_floor")) is not None else 0,
            ),
            default=None,
        )
        if best_event:
            start = _to_int(best_event.get("anchor_idx"))
            end = _to_int(best_event.get("invalidate_idx"))
            if end is None and bool(best_event.get("active")):
                end = chart_last_idx
            return _make_base_mark(
                source="output_ports.rdp_flat_base.events",
                floor=best_event.get("base_floor"),
                ceiling=best_event.get("base_ceiling"),
                start_idx=start,
                end_idx=end,
                extras={
                    "active": best_event.get("active"),
                    "flatten_idx": best_event.get("flatten_idx"),
                    "flatten_angle_deg": best_event.get("flatten_angle_deg"),
                },
            )

    base_75 = ports.get("rdp_base_75", {}) if isinstance(ports.get("rdp_base_75"), dict) else {}
    base_75_rows = base_75.get("bases", []) if isinstance(base_75.get("bases"), list) else []
    if base_75_rows:
        best_base = max(
            (b for b in base_75_rows if isinstance(b, dict)),
            key=lambda b: (
                1 if bool(b.get("broken_out")) else 0,
                1 if _to_float(b.get("base_ceiling")) is not None and _to_float(b.get("base_floor")) is not None else 0,
            ),
            default=None,
        )
        if best_base:
            start = _to_int(best_base.get("low_idx"))
            end = chart_base_end if chart_base_end is not None and chart_base_end >= 0 else chart_last_idx
            return _make_base_mark(
                source="output_ports.rdp_base_75.bases",
                floor=best_base.get("base_floor", best_base.get("low_price")),
                ceiling=best_base.get("base_ceiling"),
                start_idx=start,
                end_idx=end,
                extras={
                    "high_idx": best_base.get("high_idx"),
                    "high_price": best_base.get("high_price"),
                    "low_price": best_base.get("low_price"),
                    "broken_out": best_base.get("broken_out"),
                },
            )

    base = candidate.get("base") if isinstance(candidate.get("base"), dict) else {}
    base_high = _to_float(base.get("high"))
    base_low = _to_float(base.get("low"))
    if base_high is None:
        base_high = _to_float(candidate.get("base_high"))
    if base_low is None:
        base_low = _to_float(candidate.get("base_low"))
    if base_high is not None or base_low is not None or chart_base_start is not None or chart_base_end is not None:
        return _make_base_mark(
            source="candidate.base",
            floor=base_low,
            ceiling=base_high,
            start_idx=chart_base_start,
            end_idx=chart_base_end,
            duration_bars=base.get("duration"),
        )

    return {}


def _aggregate_methods(symbol_runs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    bucket: Dict[str, Dict[str, Any]] = {}
    for run in symbol_runs:
        for r in run.get("results", []):
            pid = str(r.get("pattern_id") or "")
            if not pid:
                continue
            if pid not in bucket:
                bucket[pid] = {
                    "pattern_id": pid,
                    "name": r.get("name") or pid,
                    "runs": 0,
                    "ok_runs": 0,
                    "error_runs": 0,
                    "symbols_with_candidates": 0,
                    "symbols_with_raw_candidates": 0,
                    "symbols_with_explicit_base_mark": 0,
                    "symbols_with_complete_base_mark": 0,
                    "total_candidates": 0,
                    "top_score_sum": 0.0,
                    "top_score_n": 0,
                    "annotation_score_sum": 0.0,
                    "annotation_score_n": 0,
                    "elapsed_ms_sum": 0,
                }
            row = bucket[pid]
            row["runs"] += 1
            row["elapsed_ms_sum"] += int(r.get("elapsed_ms", 0) or 0)
            if r.get("status") == "ok":
                row["ok_runs"] += 1
                summary = r.get("summary", {}) if isinstance(r.get("summary"), dict) else {}
                cc = int(summary.get("candidate_count", 0) or 0)
                raw_cc = int(summary.get("raw_candidate_count", 0) or 0)
                row["total_candidates"] += cc
                if cc > 0:
                    row["symbols_with_candidates"] += 1
                if raw_cc > 0:
                    row["symbols_with_raw_candidates"] += 1
                ts = summary.get("top_score")
                if isinstance(ts, (int, float)):
                    row["top_score_sum"] += float(ts)
                    row["top_score_n"] += 1
                if bool(summary.get("explicit_base_marked")):
                    row["symbols_with_explicit_base_mark"] += 1
                if bool(summary.get("complete_base_marked")):
                    row["symbols_with_complete_base_mark"] += 1
                ann = summary.get("annotation_score")
                if isinstance(ann, (int, float)):
                    row["annotation_score_sum"] += float(ann)
                    row["annotation_score_n"] += 1
            else:
                row["error_runs"] += 1

    out: List[Dict[str, Any]] = []
    for _, row in bucket.items():
        runs = max(1, int(row["runs"]))
        top_n = int(row["top_score_n"])
        ann_n = int(row["annotation_score_n"])
        out.append(
            {
                "pattern_id": row["pattern_id"],
                "name": row["name"],
                "runs": row["runs"],
                "ok_runs": row["ok_runs"],
                "error_runs": row["error_runs"],
                "symbols_with_candidates": row["symbols_with_candidates"],
                "symbols_with_raw_candidates": row["symbols_with_raw_candidates"],
                "symbols_with_explicit_base_mark": row["symbols_with_explicit_base_mark"],
                "symbols_with_complete_base_mark": row["symbols_with_complete_base_mark"],
                "avg_candidates_per_symbol": round(float(row["total_candidates"]) / runs, 4),
                "avg_top_score": round(float(row["top_score_sum"]) / top_n, 6) if top_n > 0 else None,
                "avg_annotation_score": round(float(row["annotation_score_sum"]) / ann_n, 6) if ann_n > 0 else None,
                "avg_elapsed_ms": round(float(row["elapsed_ms_sum"]) / runs, 2),
            }
        )

    out.sort(
        key=lambda x: (
            int(x.get("symbols_with_complete_base_mark", 0)),
            int(x.get("symbols_with_explicit_base_mark", 0)),
            int(x.get("symbols_with_candidates", 0)),
            float(x.get("avg_annotation_score") if x.get("avg_annotation_score") is not None else -1.0),
            float(x.get("avg_top_score") if x.get("avg_top_score") is not None else -1.0),
        ),
        reverse=True,
    )
    return out


def _normalize_methods(raw_suite: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_methods = raw_suite.get("methods")
    if not isinstance(raw_methods, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw_methods:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or item.get("pattern_id") or "").strip()
        if not mid:
            continue
        out.append(
            {
                "id": mid,
                "enabled": bool(item.get("enabled", True)),
                "setup_overrides": item.get("setup_overrides")
                if isinstance(item.get("setup_overrides"), dict)
                else {},
                "structure_overrides": item.get("structure_overrides")
                if isinstance(item.get("structure_overrides"), dict)
                else {},
            }
        )
    return out


def _registry_index() -> Dict[str, Dict[str, Any]]:
    registry = _read_json(REGISTRY_FILE)
    patterns = registry.get("patterns", [])
    idx: Dict[str, Dict[str, Any]] = {}
    if isinstance(patterns, list):
        for p in patterns:
            if not isinstance(p, dict):
                continue
            pid = str(p.get("pattern_id", "")).strip()
            if pid:
                idx[pid] = p
    return idx


def _definition_for_pattern(pattern_entry: Dict[str, Any]) -> Dict[str, Any]:
    definition_file = str(pattern_entry.get("definition_file") or "").strip()
    if not definition_file:
        return {}
    path = PATTERNS_DIR / definition_file
    if not path.exists():
        return {}
    raw = _read_json(path)
    return raw if isinstance(raw, dict) else {}


def _build_spec(
    pattern_id: str,
    definition: Dict[str, Any],
    setup_overrides: Dict[str, Any],
    structure_overrides: Dict[str, Any],
) -> Dict[str, Any]:
    setup = dict(definition.get("default_setup_params") or {})
    setup.update(setup_overrides or {})
    setup["pattern_type"] = pattern_id

    structure = dict(definition.get("default_structure_config") or {})
    structure.update(structure_overrides or {})

    indicator_role = str(definition.get("indicator_role") or "").strip()

    return {
        "strategy_id": f"suite_{pattern_id}",
        "strategy_version_id": f"suite_{pattern_id}_v1",
        "version": 1,
        "structure_config": structure,
        "setup_config": setup,
        "entry_config": {"confirmation_bars": 1},
        "indicator_role": indicator_role,
    }


def _candidate_summary(
    pattern_id: str,
    candidates: List[Dict[str, Any]],
    raw_candidates: Optional[List[Dict[str, Any]]] = None,
    raw_candidate_count: Optional[int] = None,
) -> Dict[str, Any]:
    filtered_rows = [c for c in (candidates or []) if isinstance(c, dict)]
    raw_rows = [c for c in (raw_candidates or []) if isinstance(c, dict)]

    if not filtered_rows and not raw_rows:
        return {
            "candidate_count": 0,
            "raw_candidate_count": int(raw_candidate_count or 0),
            "filtered_out_count": max(0, int(raw_candidate_count or 0)),
            "top_score": None,
            "raw_top_score": None,
            "entry_ready_count": 0,
            "top_candidate_id": None,
            "raw_top_candidate_id": None,
            "review_basis": None,
            "explicit_base_marked": False,
            "complete_base_marked": False,
            "annotation_score": None,
            "base_mark": {},
            "signals": {},
        }

    filtered_top = _pick_top_candidate(filtered_rows)
    raw_top = _pick_top_candidate(raw_rows) or filtered_top
    review_top = filtered_top or raw_top
    entry_ready_count = sum(1 for c in filtered_rows if bool(c.get("entry_ready")))
    top_score = _candidate_score(filtered_top) if filtered_top else None
    raw_top_score = _candidate_score(raw_top) if raw_top else None
    top_id = str((filtered_top or {}).get("id") or (filtered_top or {}).get("candidate_id") or "")
    raw_top_id = str((raw_top or {}).get("id") or (raw_top or {}).get("candidate_id") or "")
    review_candidate = review_top or {}
    base_mark = _extract_base_mark(review_candidate)
    base = review_candidate.get("base") if isinstance(review_candidate.get("base"), dict) else {}
    ports = review_candidate.get("output_ports") if isinstance(review_candidate.get("output_ports"), dict) else {}

    signals: Dict[str, Any] = {
        "base_duration": base_mark.get("duration_bars") or base.get("duration"),
        "base_high": base_mark.get("ceiling") or base.get("high"),
        "base_low": base_mark.get("floor") or base.get("low"),
    }

    if pattern_id == "rdp_wiggle_base":
        wiggle = ports.get("rdp_wiggle_base", {}) if isinstance(ports.get("rdp_wiggle_base"), dict) else {}
        events = wiggle.get("events", []) if isinstance(wiggle.get("events"), list) else []
        first = events[0] if events else {}
        signals.update(
            {
                "event_count": wiggle.get("count"),
                "wiggle": first.get("wiggle"),
                "alt": first.get("alt"),
                "amp": first.get("amp"),
                "turn": first.get("turn"),
                "active": first.get("active"),
            }
        )
    elif pattern_id in ("base_box_detector_v1_primitive", "base_box_detector_rdp_hybrid_v1_pattern"):
        boxes = ports.get("base_boxes", {}) if isinstance(ports.get("base_boxes"), dict) else {}
        best = boxes.get("best", {}) if isinstance(boxes.get("best"), dict) else {}
        signals.update(
            {
                "box_score": best.get("score"),
                "touches_top": best.get("touches_top"),
                "touches_bottom": best.get("touches_bottom"),
                "pivot_switches": best.get("pivot_switches"),
                "trendiness": best.get("trendiness"),
            }
        )
    elif pattern_id == "regime_filter":
        regime = ports.get("regime_state", {}) if isinstance(ports.get("regime_state"), dict) else {}
        signals.update(
            {
                "current_regime": regime.get("current_regime"),
                "reference_symbol": regime.get("reference_symbol"),
            }
        )

    return {
        "candidate_count": len(filtered_rows),
        "raw_candidate_count": int(raw_candidate_count if raw_candidate_count is not None else len(raw_rows)),
        "filtered_out_count": max(0, int(raw_candidate_count if raw_candidate_count is not None else len(raw_rows)) - len(filtered_rows)),
        "top_score": top_score,
        "raw_top_score": raw_top_score,
        "entry_ready_count": entry_ready_count,
        "top_candidate_id": top_id or None,
        "raw_top_candidate_id": raw_top_id or None,
        "review_basis": "filtered" if filtered_top else ("raw" if raw_top else None),
        "explicit_base_marked": bool(base_mark.get("has_price_box")),
        "complete_base_marked": bool(base_mark.get("complete")),
        "annotation_score": base_mark.get("annotation_score"),
        "base_mark": base_mark,
        "signals": signals,
    }


def _run_method(
    data: List[Any],
    symbol: str,
    timeframe: str,
    method_cfg: Dict[str, Any],
    registry: Dict[str, Dict[str, Any]],
    mode: str = "scan",
    strict_base: bool = False,
    strict_min_score: float = 0.5,
    verbose: bool = False,
) -> Dict[str, Any]:
    pattern_id = method_cfg["id"]
    t0 = time.time()

    if pattern_id not in registry:
        return {
            "pattern_id": pattern_id,
            "status": "error",
            "error": "pattern_id not found in registry.json",
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    pattern_entry = registry[pattern_id]
    definition = _definition_for_pattern(pattern_entry)
    if not definition:
        return {
            "pattern_id": pattern_id,
            "status": "error",
            "error": "definition file missing/unreadable",
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    spec = _build_spec(
        pattern_id=pattern_id,
        definition=definition,
        setup_overrides=method_cfg.get("setup_overrides", {}),
        structure_overrides=method_cfg.get("structure_overrides", {}),
    )

    try:
        if verbose:
            candidates = run_strategy(spec, data, symbol, timeframe, mode=mode)
        else:
            # Suppress verbose plugin diagnostics unless explicitly requested.
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                candidates = run_strategy(spec, data, symbol, timeframe, mode=mode)
        candidates = candidates if isinstance(candidates, list) else []
        raw_count = len(candidates)
        filtered = _apply_strict_base_filter(candidates, strict_base=strict_base, strict_min_score=strict_min_score)
        summary = _candidate_summary(pattern_id, filtered, raw_candidates=candidates, raw_candidate_count=raw_count)
        return {
            "pattern_id": pattern_id,
            "name": str(pattern_entry.get("name") or pattern_id),
            "status": "ok",
            "elapsed_ms": int((time.time() - t0) * 1000),
            "summary": summary,
        }
    except Exception as exc:
        return {
            "pattern_id": pattern_id,
            "name": str(pattern_entry.get("name") or pattern_id),
            "status": "error",
            "error": str(exc),
            "elapsed_ms": int((time.time() - t0) * 1000),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run centralized base methods one-by-one.")
    parser.add_argument("--suite-file", default=str(DEFAULT_SUITE_FILE), help="Path to suite JSON.")
    parser.add_argument("--symbol", default="AAPL", help="Ticker symbol.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols for multi-symbol compare run.")
    parser.add_argument("--symbols-file", default="", help="Optional file with symbols (comma/newline separated).")
    parser.add_argument("--period", default="5y", help="yfinance period (e.g. 2y, 5y, max).")
    parser.add_argument("--interval", default="1wk", help="yfinance interval (e.g. 1d, 1wk).")
    parser.add_argument("--timeframe", default="", help="Override timeframe label (default derived from interval).")
    parser.add_argument("--mode", default="scan", choices=["scan", "backtest"], help="Runner mode.")
    parser.add_argument("--strict-base", action="store_true", help="Keep base-like candidates only when base criteria are passed.")
    parser.add_argument("--strict-min-score", type=float, default=0.5, help="Fallback minimum score (0-1) for base-like plugins without base rule flags.")
    parser.add_argument(
        "--method",
        action="append",
        default=[],
        help="Run only selected method id(s). Repeat flag to pass multiple values.",
    )
    parser.add_argument("--list", action="store_true", help="List suite methods and exit.")
    parser.add_argument("--no-save", action="store_true", help="Do not save report JSON to disk.")
    parser.add_argument("--verbose", action="store_true", help="Print raw plugin diagnostics.")
    args = parser.parse_args()

    suite_path = Path(args.suite_file).resolve()
    if not suite_path.exists():
        print(f"ERROR: suite file not found: {suite_path}", file=sys.stderr)
        sys.exit(1)

    raw_suite = _read_json(suite_path)
    methods = _normalize_methods(raw_suite)
    enabled = [m for m in methods if m.get("enabled", True)]

    if args.method:
        wanted = {str(m).strip() for m in args.method if str(m).strip()}
        enabled = [m for m in enabled if m["id"] in wanted]

    if args.list:
        print("Base Method Suite")
        print("=================")
        for m in enabled:
            print(f"- {m['id']}")
        return

    if not enabled:
        print("ERROR: no methods selected after filters.", file=sys.stderr)
        sys.exit(1)

    timeframe = args.timeframe.strip().upper() if args.timeframe else _interval_to_timeframe(args.interval)
    symbol = str(args.symbol).strip().upper()
    period = str(args.period).strip()
    interval = str(args.interval).strip()
    mode = str(args.mode).strip().lower()
    strict_base = bool(args.strict_base)
    strict_min_score = max(0.0, min(1.0, float(args.strict_min_score)))
    symbols: List[str] = []
    if args.symbols:
        symbols.extend(_parse_symbol_csv(args.symbols))
    if args.symbols_file:
        symbols.extend(_load_symbols_file(Path(args.symbols_file).resolve()))
    if not symbols:
        symbols = [symbol]
    symbols = _unique_keep_order(symbols)

    registry = _registry_index()
    started = _now_iso()
    t_all = time.time()
    symbol_runs: List[Dict[str, Any]] = []

    for sym in symbols:
        print(f"[Suite] Fetching {sym} ({interval}, {period}) ...")
        data = _fetch_symbol_data(sym, period=period, interval=interval, verbose=args.verbose)
        if not data:
            print(f"         error | no data")
            symbol_runs.append(
                {
                    "symbol": sym,
                    "timeframe": timeframe,
                    "bar_count": 0,
                    "results": [
                        {
                            "pattern_id": m["id"],
                            "name": m["id"],
                            "status": "error",
                            "error": "no data returned",
                            "elapsed_ms": 0,
                        }
                        for m in enabled
                    ],
                }
            )
            continue

        print(f"[Suite] Loaded {len(data)} bars for {sym}")
        method_results: List[Dict[str, Any]] = []
        for method in enabled:
            pid = method["id"]
            print(f"[Suite] Running {pid} on {sym} ...")
            result = _run_method(
                data,
                sym,
                timeframe,
                method,
                registry,
                mode=mode,
                strict_base=strict_base,
                strict_min_score=strict_min_score,
                verbose=args.verbose,
            )
            method_results.append(result)
            status = result.get("status", "unknown")
            if status == "ok":
                summary = result.get("summary", {})
                print(
                    f"         ok | candidates={summary.get('candidate_count', 0)} "
                    f"(raw={summary.get('raw_candidate_count', summary.get('candidate_count', 0))}) "
                    f"top_score={summary.get('top_score')} "
                    f"mark={1 if summary.get('explicit_base_marked') else 0} "
                    f"full={1 if summary.get('complete_base_marked') else 0}"
                )
            else:
                print(f"         error | {result.get('error')}")

        symbol_runs.append(
            {
                "symbol": sym,
                "timeframe": timeframe,
                "bar_count": len(data),
                "results": method_results,
            }
        )

    completed = _now_iso()
    elapsed_ms = int((time.time() - t_all) * 1000)
    method_aggregate = _aggregate_methods(symbol_runs)
    ok_count = sum(int(m.get("ok_runs", 0)) for m in method_aggregate)
    error_count = sum(int(m.get("error_runs", 0)) for m in method_aggregate)

    report: Dict[str, Any] = {
        "suite_id": str(raw_suite.get("suite_id") or "base_method_suite"),
        "suite_name": str(raw_suite.get("name") or "Base Method Suite"),
        "started_at": started,
        "completed_at": completed,
        "elapsed_ms": elapsed_ms,
        "run_config": {
            "symbols": symbols,
            "symbols_count": len(symbols),
            "period": period,
            "interval": interval,
            "timeframe": timeframe,
            "mode": mode,
            "strict_base": strict_base,
            "strict_min_score": strict_min_score,
            "suite_file": str(suite_path),
        },
        "totals": {
            "methods": len(enabled),
            "symbol_runs": len(symbol_runs),
            "ok": ok_count,
            "error": error_count,
        },
        "method_aggregate": method_aggregate,
        "symbol_runs": symbol_runs,
    }

    print("\nSuite Summary")
    print("=============")
    print(f"Symbols: {len(symbols)}")
    print(f"Methods per symbol: {len(enabled)}")
    print(f"Total OK runs: {ok_count}")
    print(f"Total errors: {error_count}")
    print(f"Elapsed: {elapsed_ms} ms")
    if method_aggregate:
        print("\nMethod Ranking (by explicit/full base marking, coverage, then avg top score)")
        for i, row in enumerate(method_aggregate, start=1):
            print(
                f"{i:>2}. {row['pattern_id']} | coverage={row['symbols_with_candidates']}/{len(symbols)} "
                f"| raw={row['symbols_with_raw_candidates']}/{len(symbols)} "
                f"| mark={row['symbols_with_explicit_base_mark']}/{len(symbols)} "
                f"| full={row['symbols_with_complete_base_mark']}/{len(symbols)} "
                f"| ann={row['avg_annotation_score']} | avg_top_score={row['avg_top_score']} "
                f"| avg_candidates={row['avg_candidates_per_symbol']}"
            )

    if not args.no_save:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        sym_tag = symbols[0] if len(symbols) == 1 else f"{len(symbols)}syms"
        out = REPORT_DIR / f"{sym_tag}_{interval}_{stamp}.json"
        out.write_text(json.dumps(_to_json_safe(report), indent=2), encoding="utf-8")
        print(f"Report: {out}")
    else:
        print(json.dumps(_to_json_safe(report), indent=2))


if __name__ == "__main__":
    main()
