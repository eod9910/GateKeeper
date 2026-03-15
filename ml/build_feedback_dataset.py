"""
Build ML datasets from local Pattern Detector feedback.

Inputs:
- backend/data/labels/*.json
- backend/data/corrections/*.json
- backend/data/candidates/*.json

Outputs:
- classifier_rows.csv   (YES/NO labels mapped to binary targets)
- regressor_rows.csv    (manual base corrections mapped to top/bottom deltas)
- dataset_report.json   (counts, coverage, skip reasons)
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


FEATURE_COLUMNS: List[str] = [
    "score",
    "entry_ready",
    "rule_pass_ratio",
    "rule_count",
    "window_len",
    "chart_len",
    "base_high",
    "base_low",
    "base_range_pct",
    "base_duration",
    "current_close",
    "current_pos_in_base",
    "touches_top",
    "touches_bottom",
    "pivot_switches",
    "window_pivots",
    "trendiness",
    "slope_pct_per_bar",
    "rdp_swing_count_total",
    "rdp_swing_count_highs",
    "rdp_swing_count_lows",
    "node_score",
]

META_COLUMNS: List[str] = [
    "candidate_id",
    "symbol",
    "timeframe",
    "pattern_type",
    "strategy_version_id",
    "created_at",
    "feedback_timestamp",
]


@dataclass
class CandidateResolution:
    candidate: Optional[Dict[str, Any]]
    method: str
    reason: Optional[str] = None


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def _safe_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(v)
    except Exception:
        return None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _parse_ts(s: Any) -> Optional[datetime]:
    text = str(s or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _iter_json_files(folder: Path) -> Iterable[Path]:
    if not folder.exists():
        return []
    return sorted(folder.glob("*.json"))


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _extract_symbol_timeframe_from_candidate_id(candidate_id: str) -> Tuple[Optional[str], Optional[str]]:
    parts = str(candidate_id or "").split("_")
    if len(parts) < 2:
        return None, None
    symbol = parts[0].strip().upper() or None
    timeframe = parts[1].strip() or None
    return symbol, timeframe


def _pick_base_prices(candidate: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    base = candidate.get("base") if isinstance(candidate.get("base"), dict) else {}
    base_high = _safe_float(base.get("high"))
    base_low = _safe_float(base.get("low"))

    if base_high is None or base_low is None:
        ports = candidate.get("output_ports") if isinstance(candidate.get("output_ports"), dict) else {}
        best = (
            ports.get("base_boxes", {}).get("best", {})
            if isinstance(ports.get("base_boxes"), dict)
            else {}
        )
        if base_high is None:
            base_high = _safe_float(best.get("ceiling"))
        if base_low is None:
            base_low = _safe_float(best.get("floor"))

    if base_high is None:
        base_high = _safe_float(candidate.get("base_high"))
    if base_low is None:
        base_low = _safe_float(candidate.get("base_low"))

    if base_high is not None and base_low is not None and base_low > base_high:
        base_high, base_low = base_low, base_high
    return base_high, base_low


def _extract_features(candidate: Dict[str, Any]) -> Dict[str, Any]:
    score = _safe_float(candidate.get("score"))
    entry_ready = 1 if bool(candidate.get("entry_ready")) else 0

    rule_checklist = candidate.get("rule_checklist")
    rules = rule_checklist if isinstance(rule_checklist, list) else []
    rule_count = len(rules)
    passed = sum(1 for r in rules if bool((r or {}).get("passed")))
    rule_pass_ratio = (passed / rule_count) if rule_count > 0 else None

    window_start = _safe_int(candidate.get("window_start"))
    window_end = _safe_int(candidate.get("window_end"))
    window_len = None
    if window_start is not None and window_end is not None and window_end >= window_start:
        window_len = window_end - window_start + 1

    chart_data = candidate.get("chart_data")
    chart_len = len(chart_data) if isinstance(chart_data, list) else 0
    current_close = None
    if chart_len > 0 and isinstance(chart_data[-1], dict):
        current_close = _safe_float(chart_data[-1].get("close"))

    base_high, base_low = _pick_base_prices(candidate)
    base_range_pct = None
    current_pos_in_base = None
    if base_high is not None and base_low is not None and base_high > 0:
        rng = base_high - base_low
        if rng >= 0:
            base_range_pct = rng / base_high
            if current_close is not None and rng > 1e-12:
                current_pos_in_base = _clamp((current_close - base_low) / rng, -2.0, 3.0)

    base_duration = None
    if isinstance(candidate.get("base"), dict):
        base_duration = _safe_float(candidate["base"].get("duration"))
    if base_duration is None:
        ports = candidate.get("output_ports") if isinstance(candidate.get("output_ports"), dict) else {}
        best = (
            ports.get("base_boxes", {}).get("best", {})
            if isinstance(ports.get("base_boxes"), dict)
            else {}
        )
        base_duration = _safe_float(best.get("base_span_bars"))

    ports = candidate.get("output_ports") if isinstance(candidate.get("output_ports"), dict) else {}
    best = (
        ports.get("base_boxes", {}).get("best", {})
        if isinstance(ports.get("base_boxes"), dict)
        else {}
    )
    touches_top = _safe_float(best.get("touches_top"))
    touches_bottom = _safe_float(best.get("touches_bottom"))
    pivot_switches = _safe_float(best.get("pivot_switches"))
    window_pivots = _safe_float(best.get("window_pivots"))
    trendiness = _safe_float(best.get("trendiness"))
    slope_pct_per_bar = _safe_float(best.get("slope_pct_per_bar"))

    rdp = candidate.get("rdp_pivots") if isinstance(candidate.get("rdp_pivots"), dict) else {}
    rdp_total = _safe_float(rdp.get("swing_count_total"))
    rdp_highs = _safe_float(rdp.get("swing_count_highs"))
    rdp_lows = _safe_float(rdp.get("swing_count_lows"))

    node_result = candidate.get("node_result") if isinstance(candidate.get("node_result"), dict) else {}
    node_score = _safe_float(node_result.get("score"))

    return {
        "score": score,
        "entry_ready": entry_ready,
        "rule_pass_ratio": rule_pass_ratio,
        "rule_count": rule_count,
        "window_len": window_len,
        "chart_len": chart_len,
        "base_high": base_high,
        "base_low": base_low,
        "base_range_pct": base_range_pct,
        "base_duration": base_duration,
        "current_close": current_close,
        "current_pos_in_base": current_pos_in_base,
        "touches_top": touches_top,
        "touches_bottom": touches_bottom,
        "pivot_switches": pivot_switches,
        "window_pivots": window_pivots,
        "trendiness": trendiness,
        "slope_pct_per_bar": slope_pct_per_bar,
        "rdp_swing_count_total": rdp_total,
        "rdp_swing_count_highs": rdp_highs,
        "rdp_swing_count_lows": rdp_lows,
        "node_score": node_score,
    }


class CandidateResolver:
    def __init__(self, candidates_dir: Path):
        self.candidates_dir = candidates_dir
        self._cache_by_path: Dict[Path, Dict[str, Any]] = {}
        self._cache_by_id: Dict[str, Dict[str, Any]] = {}
        self._bucket_cache: Dict[Tuple[str, str], List[Path]] = {}

    def _load_candidate(self, path: Path) -> Optional[Dict[str, Any]]:
        if path in self._cache_by_path:
            return self._cache_by_path[path]
        obj = _load_json(path)
        if not isinstance(obj, dict):
            return None
        self._cache_by_path[path] = obj
        cid = str(obj.get("id") or obj.get("candidate_id") or "").strip()
        if cid:
            self._cache_by_id[cid] = obj
        return obj

    def _candidates_for_bucket(self, symbol: str, timeframe: str) -> List[Path]:
        key = (symbol.upper(), timeframe)
        if key in self._bucket_cache:
            return self._bucket_cache[key]
        pattern = f"{symbol}_{timeframe}_*.json"
        files = sorted(self.candidates_dir.glob(pattern))
        self._bucket_cache[key] = files
        return files

    def resolve(
        self,
        candidate_id: str,
        symbol: Optional[str] = None,
        timeframe: Optional[str] = None,
        feedback_ts: Optional[datetime] = None,
    ) -> CandidateResolution:
        cid = str(candidate_id or "").strip()
        if not cid:
            return CandidateResolution(None, "none", "missing_candidate_id")

        if cid in self._cache_by_id:
            return CandidateResolution(self._cache_by_id[cid], "cache_by_id")

        direct_path = self.candidates_dir / f"{cid}.json"
        if direct_path.exists():
            obj = self._load_candidate(direct_path)
            if obj:
                return CandidateResolution(obj, "direct_file")

        parsed_symbol, parsed_timeframe = _extract_symbol_timeframe_from_candidate_id(cid)
        symbol = (symbol or parsed_symbol or "").strip().upper() or None
        timeframe = (timeframe or parsed_timeframe or "").strip() or None
        if not symbol or not timeframe:
            return CandidateResolution(None, "unresolved", "no_symbol_timeframe_for_fallback")

        bucket = self._candidates_for_bucket(symbol, timeframe)
        if not bucket:
            return CandidateResolution(None, "unresolved", "no_candidate_files_for_symbol_timeframe")

        # Pick nearest candidate by created_at to feedback timestamp if available, else newest.
        best_obj: Optional[Dict[str, Any]] = None
        best_score: Optional[Tuple[int, float]] = None
        for path in bucket:
            obj = self._load_candidate(path)
            if not obj:
                continue
            created = _parse_ts(obj.get("created_at"))
            if feedback_ts and created:
                # Prefer prior candidates, then closest absolute distance.
                is_prior = 1 if created <= feedback_ts else 0
                distance = abs((feedback_ts - created).total_seconds())
                score = (is_prior, -distance)
            elif created:
                score = (1, created.timestamp())
            else:
                score = (0, path.stat().st_mtime)

            if best_score is None or score > best_score:
                best_score = score
                best_obj = obj

        if best_obj:
            return CandidateResolution(best_obj, "fallback_symbol_timeframe")
        return CandidateResolution(None, "unresolved", "bucket_candidates_unreadable")


def _extract_corrected_base_levels(correction: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    corrected = correction.get("corrected")
    top = None
    bottom = None
    if isinstance(corrected, dict):
        for key in ("baseTopPrice", "base_top_price", "top", "baseTop", "base_high"):
            if top is None:
                top = _safe_float(corrected.get(key))
        for key in ("baseBottomPrice", "base_bottom_price", "bottom", "baseBottom", "base_low"):
            if bottom is None:
                bottom = _safe_float(corrected.get(key))

    # Legacy drawing corrections (box annotation): infer top/bottom from price1/price2.
    if top is None or bottom is None:
        drawings = correction.get("drawings")
        if isinstance(drawings, dict):
            base_draw = drawings.get("base")
            if isinstance(base_draw, dict):
                prices = []
                p1 = _safe_float(base_draw.get("price1"))
                p2 = _safe_float(base_draw.get("price2"))
                if p1 is not None:
                    prices.append(p1)
                if p2 is not None:
                    prices.append(p2)
                if prices:
                    inferred_top = max(prices)
                    inferred_bottom = min(prices)
                    if top is None:
                        top = inferred_top
                    if bottom is None:
                        bottom = inferred_bottom

    if top is not None and bottom is not None and bottom > top:
        top, bottom = bottom, top
    return top, bottom


def _label_to_binary(label: str, include_close: bool) -> Optional[int]:
    val = str(label or "").strip().lower()
    if val == "yes":
        return 1
    if val == "no":
        return 0
    if val == "close" and include_close:
        return 1
    return None


def _write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    cols = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def build_datasets(
    data_root: Path,
    out_dir: Path,
    include_close: bool = False,
) -> Dict[str, Any]:
    labels_dir = data_root / "labels"
    corrections_dir = data_root / "corrections"
    candidates_dir = data_root / "candidates"

    resolver = CandidateResolver(candidates_dir)
    report: Dict[str, Any] = {
        "labels_total": 0,
        "labels_used": 0,
        "labels_skipped": 0,
        "corrections_total": 0,
        "corrections_used": 0,
        "corrections_skipped": 0,
        "candidate_resolution_methods": Counter(),
        "skip_reasons": Counter(),
    }

    classifier_rows: List[Dict[str, Any]] = []
    regressor_rows: List[Dict[str, Any]] = []

    for path in _iter_json_files(labels_dir):
        row = _load_json(path)
        if not isinstance(row, dict):
            report["labels_skipped"] += 1
            report["skip_reasons"]["invalid_label_json"] += 1
            continue
        report["labels_total"] += 1

        target = _label_to_binary(str(row.get("label", "")), include_close=include_close)
        if target is None:
            report["labels_skipped"] += 1
            report["skip_reasons"]["label_not_used"] += 1
            continue

        feedback_ts = _parse_ts(row.get("timestamp"))
        candidate_id = str(row.get("candidateId") or "").strip()
        resolved = resolver.resolve(candidate_id=candidate_id, feedback_ts=feedback_ts)
        report["candidate_resolution_methods"][resolved.method] += 1
        if not resolved.candidate:
            report["labels_skipped"] += 1
            report["skip_reasons"][resolved.reason or "candidate_unresolved"] += 1
            continue

        c = resolved.candidate
        feature_vals = _extract_features(c)
        meta = {
            "candidate_id": str(c.get("id") or c.get("candidate_id") or candidate_id),
            "symbol": str(c.get("symbol") or ""),
            "timeframe": str(c.get("timeframe") or ""),
            "pattern_type": str(c.get("pattern_type") or ""),
            "strategy_version_id": str(c.get("strategy_version_id") or ""),
            "created_at": str(c.get("created_at") or ""),
            "feedback_timestamp": str(row.get("timestamp") or ""),
            "label_text": str(row.get("label") or "").lower(),
            "label": target,
            "label_source": "labels",
        }
        classifier_rows.append({**meta, **feature_vals})
        report["labels_used"] += 1

    for path in _iter_json_files(corrections_dir):
        corr = _load_json(path)
        if not isinstance(corr, dict):
            report["corrections_skipped"] += 1
            report["skip_reasons"]["invalid_correction_json"] += 1
            continue
        report["corrections_total"] += 1

        feedback_ts = _parse_ts(corr.get("timestamp"))
        candidate_id = str(corr.get("candidateId") or "").strip()
        symbol = str(corr.get("symbol") or "").strip().upper() or None
        timeframe = str(corr.get("timeframe") or "").strip() or None

        resolved = resolver.resolve(
            candidate_id=candidate_id,
            symbol=symbol,
            timeframe=timeframe,
            feedback_ts=feedback_ts,
        )
        report["candidate_resolution_methods"][resolved.method] += 1
        if not resolved.candidate:
            report["corrections_skipped"] += 1
            report["skip_reasons"][resolved.reason or "correction_candidate_unresolved"] += 1
            continue

        c = resolved.candidate
        detected_top, detected_bottom = _pick_base_prices(c)
        corrected_top, corrected_bottom = _extract_corrected_base_levels(corr)
        if (
            detected_top is None
            or detected_bottom is None
            or corrected_top is None
            or corrected_bottom is None
        ):
            report["corrections_skipped"] += 1
            report["skip_reasons"]["missing_base_levels_for_regression"] += 1
            continue

        feature_vals = _extract_features(c)
        meta = {
            "candidate_id": str(c.get("id") or c.get("candidate_id") or candidate_id),
            "symbol": str(c.get("symbol") or symbol or ""),
            "timeframe": str(c.get("timeframe") or timeframe or ""),
            "pattern_type": str(c.get("pattern_type") or corr.get("patternType") or ""),
            "strategy_version_id": str(c.get("strategy_version_id") or ""),
            "created_at": str(c.get("created_at") or ""),
            "feedback_timestamp": str(corr.get("timestamp") or ""),
            "correction_source": "corrections",
            "detected_top": detected_top,
            "detected_bottom": detected_bottom,
            "corrected_top": corrected_top,
            "corrected_bottom": corrected_bottom,
            "target_delta_top": corrected_top - detected_top,
            "target_delta_bottom": corrected_bottom - detected_bottom,
        }
        regressor_rows.append({**meta, **feature_vals})
        report["corrections_used"] += 1

    report["candidate_resolution_methods"] = dict(report["candidate_resolution_methods"])
    report["skip_reasons"] = dict(report["skip_reasons"])
    report["classifier_rows"] = len(classifier_rows)
    report["regressor_rows"] = len(regressor_rows)

    out_dir.mkdir(parents=True, exist_ok=True)
    clf_csv = out_dir / "classifier_rows.csv"
    reg_csv = out_dir / "regressor_rows.csv"
    report_json = out_dir / "dataset_report.json"

    _write_csv(clf_csv, classifier_rows)
    _write_csv(reg_csv, regressor_rows)
    report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    return {
        "classifier_rows_path": str(clf_csv),
        "regressor_rows_path": str(reg_csv),
        "report_path": str(report_json),
        "report": report,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build classifier/regressor rows from labels + corrections.")
    parser.add_argument(
        "--data-root",
        default=str((Path(__file__).resolve().parents[1] / "backend" / "data")),
        help="Path to backend/data folder.",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parent / "artifacts" / "feedback_dataset"),
        help="Output directory for dataset files.",
    )
    parser.add_argument(
        "--include-close",
        action="store_true",
        help="Treat CLOSE labels as positive class in classifier rows.",
    )
    args = parser.parse_args()

    result = build_datasets(
        data_root=Path(args.data_root),
        out_dir=Path(args.out_dir),
        include_close=bool(args.include_close),
    )

    report = result["report"]
    print("Feedback dataset build complete")
    print(f"Classifier rows: {report['classifier_rows']}")
    print(f"Regressor rows:  {report['regressor_rows']}")
    print(f"Labels used/skipped: {report['labels_used']}/{report['labels_skipped']}")
    print(f"Corrections used/skipped: {report['corrections_used']}/{report['corrections_skipped']}")
    print(f"Report: {result['report_path']}")


if __name__ == "__main__":
    main()

