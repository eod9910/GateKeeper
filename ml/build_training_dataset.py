"""
Build ML datasets from training-module execution data.

Reads resolved training attempts (manual backtest trades) and extracts
structural features suitable for training a model that predicts trade
outcomes from chart structure — the "structure recognition" ML pipeline.

Inputs:
- backend/data/training/attempts/*.json
- backend/data/training/sessions/*.json (for session context)

Outputs (written to ml/artifacts/training_dataset/):
- structure_trades.csv       (one row per resolved trade with structural features + outcome)
- dataset_report.json        (counts, feature distributions, skip reasons)

Usage:
    python build_training_dataset.py
    python build_training_dataset.py --min-bars 50
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


FEATURE_COLUMNS: List[str] = [
    # Fib geometry
    "fib_range",
    "fib_range_pct",
    "fib_direction",
    "entry_level",
    "implied_rr",

    # ATR context
    "atr_14",
    "atr_pct_of_price",
    "stop_atr_multiple",

    # Price action context (lookback window before entry)
    "lookback_trend",
    "lookback_volatility",
    "lookback_range_pct",
    "lookback_close_vs_high",
    "lookback_close_vs_low",
    "lookback_bar_count",

    # Bar statistics in the Fib zone
    "bars_in_fib_zone",
    "time_in_discount",
    "avg_body_pct",

    # Volume characteristics
    "volume_trend",
    "volume_at_entry_vs_avg",

    # Structural measurements
    "swing_count",
    "higher_lows_count",
    "lower_highs_count",
    "displacement_strength",
]

META_COLUMNS: List[str] = [
    "attempt_id",
    "session_id",
    "symbol",
    "timeframe",
    "side",
    "contract_id",
    "entry_price",
    "stop_price",
    "tp_price",
    "entry_bar_time",
    "created_at",
]

TARGET_COLUMNS: List[str] = [
    "outcome",
    "r_multiple",
    "exit_reason",
    "bars_held",
    "mae",
    "mfe",
]


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except Exception:
        return None


def _safe_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(v)
    except Exception:
        return None


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _iter_json_files(folder: Path):
    if not folder.exists():
        return []
    return sorted(folder.glob("*.json"))


def _compute_atr(bars: List[Dict[str, Any]], end_index: int, length: int = 14) -> Optional[float]:
    """Compute ATR at a given bar index."""
    if not bars or end_index <= 0:
        return None
    start = max(1, end_index - length + 1)
    tr_sum = 0.0
    count = 0
    for i in range(start, min(end_index + 1, len(bars))):
        bar = bars[i]
        prev = bars[i - 1]
        high = _safe_float(bar.get("high"))
        low = _safe_float(bar.get("low"))
        prev_close = _safe_float(prev.get("close"))
        if high is None or low is None or prev_close is None:
            continue
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr_sum += tr
        count += 1
    return (tr_sum / count) if count > 0 else None


def _find_fib_drawing(drawings: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Find the Fib drawing from the attempt's drawings list."""
    fibs = [d for d in drawings if d.get("type") == "fib"]
    return fibs[-1] if fibs else None


def _count_swings(bars: List[Dict[str, Any]], start: int, end: int) -> Tuple[int, int, int]:
    """Count swing highs, swing lows, and total swings in a bar range."""
    if end - start < 4:
        return 0, 0, 0
    swing_highs = 0
    swing_lows = 0
    subset = bars[max(0, start):min(len(bars), end + 1)]
    for i in range(2, len(subset) - 2):
        h = _safe_float(subset[i].get("high"))
        l = _safe_float(subset[i].get("low"))
        h_prev = _safe_float(subset[i - 1].get("high"))
        h_prev2 = _safe_float(subset[i - 2].get("high"))
        h_next = _safe_float(subset[i + 1].get("high"))
        h_next2 = _safe_float(subset[i + 2].get("high"))
        l_prev = _safe_float(subset[i - 1].get("low"))
        l_prev2 = _safe_float(subset[i - 2].get("low"))
        l_next = _safe_float(subset[i + 1].get("low"))
        l_next2 = _safe_float(subset[i + 2].get("low"))
        if all(v is not None for v in [h, h_prev, h_prev2, h_next, h_next2]):
            if h >= h_prev and h >= h_prev2 and h >= h_next and h >= h_next2:
                swing_highs += 1
        if all(v is not None for v in [l, l_prev, l_prev2, l_next, l_next2]):
            if l <= l_prev and l <= l_prev2 and l <= l_next and l <= l_next2:
                swing_lows += 1
    return swing_highs + swing_lows, swing_highs, swing_lows


def _extract_features(attempt: Dict[str, Any]) -> Dict[str, Any]:
    """Extract structural features from a resolved training attempt."""
    drawings = attempt.get("drawings") or []
    bars = attempt.get("bars") or []
    resolution = attempt.get("resolution") or {}
    side = attempt.get("side", "long")

    entry = _safe_float(attempt.get("entry"))
    stop = _safe_float(attempt.get("stop"))
    tp = _safe_float(attempt.get("takeProfit"))
    entry_bar_index = _safe_int(attempt.get("entryBarIndex")) or 0

    fib = _find_fib_drawing(drawings)

    # --- Fib geometry ---
    fib_range = None
    fib_range_pct = None
    fib_direction = None
    entry_level = None
    implied_rr = None

    if fib:
        price0 = _safe_float(fib.get("price"))
        price100 = _safe_float(fib.get("price2"))
        if price0 is not None and price100 is not None:
            fib_range = abs(price100 - price0)
            if price0 > 0:
                fib_range_pct = fib_range / price0
            fib_direction = 1.0 if price100 < price0 else -1.0

            if fib_range > 1e-12 and entry is not None:
                entry_level = abs(entry - price0) / fib_range

    if entry is not None and stop is not None and tp is not None:
        risk = abs(entry - stop)
        reward = abs(tp - entry)
        implied_rr = (reward / risk) if risk > 1e-12 else None

    # --- ATR context ---
    atr = _compute_atr(bars, entry_bar_index, 14)
    atr_pct = None
    stop_atr_mult = None
    if atr is not None and atr > 0:
        if entry is not None and entry > 0:
            atr_pct = atr / entry
        if entry is not None and stop is not None:
            stop_atr_mult = abs(entry - stop) / atr

    # --- Price action lookback (30 bars before entry) ---
    lookback_len = min(30, entry_bar_index)
    lookback_start = max(0, entry_bar_index - lookback_len)
    lookback_bars = bars[lookback_start:entry_bar_index + 1] if bars else []

    lookback_trend = None
    lookback_volatility = None
    lookback_range_pct = None
    lookback_close_vs_high = None
    lookback_close_vs_low = None

    if len(lookback_bars) >= 5:
        closes = [_safe_float(b.get("close")) for b in lookback_bars]
        closes = [c for c in closes if c is not None]
        highs = [_safe_float(b.get("high")) for b in lookback_bars]
        highs = [h for h in highs if h is not None]
        lows = [_safe_float(b.get("low")) for b in lookback_bars]
        lows = [lo for lo in lows if lo is not None]

        if len(closes) >= 5:
            first_close = closes[0]
            last_close = closes[-1]
            if first_close and first_close > 0:
                lookback_trend = (last_close - first_close) / first_close

            returns = [(closes[i] - closes[i-1]) / closes[i-1]
                       for i in range(1, len(closes))
                       if closes[i-1] and closes[i-1] > 0]
            if returns:
                lookback_volatility = statistics.stdev(returns) if len(returns) > 1 else 0.0

        if highs and lows:
            period_high = max(highs)
            period_low = min(lows)
            period_range = period_high - period_low
            if period_high > 0:
                lookback_range_pct = period_range / period_high
            if period_range > 1e-12 and closes:
                lookback_close_vs_high = (period_high - closes[-1]) / period_range
                lookback_close_vs_low = (closes[-1] - period_low) / period_range

    # --- Bars in the Fib zone ---
    bars_in_fib_zone = None
    time_in_discount = None
    if fib and bars and entry_bar_index > 0:
        price0 = _safe_float(fib.get("price"))
        price100 = _safe_float(fib.get("price2"))
        if price0 is not None and price100 is not None:
            fib_top = max(price0, price100)
            fib_bottom = min(price0, price100)
            fib_mid = (fib_top + fib_bottom) / 2
            zone_count = 0
            discount_count = 0
            scan_start = max(0, entry_bar_index - 50)
            for i in range(scan_start, min(entry_bar_index + 1, len(bars))):
                bar = bars[i]
                close = _safe_float(bar.get("close"))
                if close is None:
                    continue
                if fib_bottom <= close <= fib_top:
                    zone_count += 1
                if side == "long" and close < fib_mid:
                    discount_count += 1
                elif side == "short" and close > fib_mid:
                    discount_count += 1
            bars_in_fib_zone = zone_count
            scan_len = min(entry_bar_index + 1, len(bars)) - scan_start
            time_in_discount = (discount_count / scan_len) if scan_len > 0 else None

    # --- Average body percentage ---
    avg_body_pct = None
    if lookback_bars:
        bodies = []
        for b in lookback_bars:
            o = _safe_float(b.get("open"))
            c = _safe_float(b.get("close"))
            h = _safe_float(b.get("high"))
            lo = _safe_float(b.get("low"))
            if o is not None and c is not None and h is not None and lo is not None:
                bar_range = h - lo
                if bar_range > 1e-12:
                    bodies.append(abs(c - o) / bar_range)
        if bodies:
            avg_body_pct = statistics.mean(bodies)

    # --- Volume characteristics ---
    volume_trend = None
    volume_at_entry_vs_avg = None
    if lookback_bars and len(lookback_bars) >= 5:
        vols = [_safe_float(b.get("volume")) for b in lookback_bars]
        vols = [v for v in vols if v is not None and v > 0]
        if len(vols) >= 5:
            first_half = vols[:len(vols) // 2]
            second_half = vols[len(vols) // 2:]
            avg_first = statistics.mean(first_half)
            avg_second = statistics.mean(second_half)
            if avg_first > 0:
                volume_trend = (avg_second - avg_first) / avg_first
            avg_vol = statistics.mean(vols)
            if avg_vol > 0 and vols:
                volume_at_entry_vs_avg = vols[-1] / avg_vol

    # --- Structural measurements ---
    scan_start = max(0, entry_bar_index - 60)
    total_swings, s_highs, s_lows = _count_swings(bars, scan_start, entry_bar_index)

    higher_lows_count = 0
    lower_highs_count = 0
    if bars and entry_bar_index > 4:
        recent_lows = []
        recent_highs = []
        subset = bars[scan_start:min(len(bars), entry_bar_index + 1)]
        for i in range(2, len(subset) - 2):
            lo = _safe_float(subset[i].get("low"))
            hi = _safe_float(subset[i].get("high"))
            vals = [
                _safe_float(subset[i-1].get("low")), _safe_float(subset[i-2].get("low")),
                _safe_float(subset[i+1].get("low")), _safe_float(subset[i+2].get("low")),
            ]
            hvals = [
                _safe_float(subset[i-1].get("high")), _safe_float(subset[i-2].get("high")),
                _safe_float(subset[i+1].get("high")), _safe_float(subset[i+2].get("high")),
            ]
            if lo is not None and all(v is not None for v in vals):
                if lo <= min(vals):
                    recent_lows.append(lo)
            if hi is not None and all(v is not None for v in hvals):
                if hi >= max(hvals):
                    recent_highs.append(hi)
        for i in range(1, len(recent_lows)):
            if recent_lows[i] > recent_lows[i - 1]:
                higher_lows_count += 1
        for i in range(1, len(recent_highs)):
            if recent_highs[i] < recent_highs[i - 1]:
                lower_highs_count += 1

    # Displacement strength: largest single-bar move in lookback
    displacement_strength = None
    if lookback_bars:
        moves = []
        for b in lookback_bars:
            o = _safe_float(b.get("open"))
            c = _safe_float(b.get("close"))
            if o is not None and c is not None and o > 0:
                moves.append(abs(c - o) / o)
        if moves:
            displacement_strength = max(moves)

    return {
        "fib_range": fib_range,
        "fib_range_pct": fib_range_pct,
        "fib_direction": fib_direction,
        "entry_level": entry_level,
        "implied_rr": implied_rr,
        "atr_14": atr,
        "atr_pct_of_price": atr_pct,
        "stop_atr_multiple": stop_atr_mult,
        "lookback_trend": lookback_trend,
        "lookback_volatility": lookback_volatility,
        "lookback_range_pct": lookback_range_pct,
        "lookback_close_vs_high": lookback_close_vs_high,
        "lookback_close_vs_low": lookback_close_vs_low,
        "lookback_bar_count": len(lookback_bars),
        "bars_in_fib_zone": bars_in_fib_zone,
        "time_in_discount": time_in_discount,
        "avg_body_pct": avg_body_pct,
        "volume_trend": volume_trend,
        "volume_at_entry_vs_avg": volume_at_entry_vs_avg,
        "swing_count": total_swings,
        "higher_lows_count": higher_lows_count,
        "lower_highs_count": lower_highs_count,
        "displacement_strength": displacement_strength,
    }


def build_dataset(
    attempts_dir: Path,
    output_dir: Path,
    min_bars: int = 20,
) -> Dict[str, Any]:
    """Build the structure trades dataset from training attempts."""
    output_dir.mkdir(parents=True, exist_ok=True)

    skip_reasons: Counter = Counter()
    rows: List[Dict[str, Any]] = []

    attempt_files = list(_iter_json_files(attempts_dir))
    print(f"Found {len(attempt_files)} attempt files in {attempts_dir}")

    for path in attempt_files:
        attempt = _load_json(path)
        if not isinstance(attempt, dict):
            skip_reasons["invalid_json"] += 1
            continue

        if attempt.get("status") != "resolved":
            skip_reasons["not_resolved"] += 1
            continue

        resolution = attempt.get("resolution")
        if not isinstance(resolution, dict):
            skip_reasons["no_resolution"] += 1
            continue

        r_multiple = _safe_float(resolution.get("rMultiple"))
        if r_multiple is None:
            skip_reasons["no_r_multiple"] += 1
            continue

        bars = attempt.get("bars")
        if not isinstance(bars, list) or len(bars) < min_bars:
            skip_reasons["insufficient_bars"] += 1
            continue

        features = _extract_features(attempt)

        exit_reason = resolution.get("exitReason", "")
        outcome = 1 if r_multiple > 0 else 0

        meta = {
            "attempt_id": attempt.get("attemptId", ""),
            "session_id": attempt.get("sessionId", ""),
            "symbol": attempt.get("symbol", ""),
            "timeframe": attempt.get("timeframe", ""),
            "side": attempt.get("side", ""),
            "contract_id": attempt.get("contractId", ""),
            "entry_price": attempt.get("entry"),
            "stop_price": attempt.get("stop"),
            "tp_price": attempt.get("takeProfit"),
            "entry_bar_time": attempt.get("entryBarTime", ""),
            "created_at": attempt.get("createdAt", ""),
        }

        targets = {
            "outcome": outcome,
            "r_multiple": r_multiple,
            "exit_reason": exit_reason,
            "bars_held": _safe_int(resolution.get("barsHeld")),
            "mae": _safe_float(resolution.get("mae")),
            "mfe": _safe_float(resolution.get("mfe")),
        }

        row = {}
        row.update(meta)
        row.update(features)
        row.update(targets)
        rows.append(row)

    all_columns = META_COLUMNS + FEATURE_COLUMNS + TARGET_COLUMNS
    csv_path = output_dir / "structure_trades.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    # Feature distributions for the report
    feature_stats: Dict[str, Any] = {}
    for col in FEATURE_COLUMNS:
        vals = [_safe_float(r.get(col)) for r in rows]
        vals = [v for v in vals if v is not None]
        if vals:
            feature_stats[col] = {
                "count": len(vals),
                "mean": round(statistics.mean(vals), 6),
                "min": round(min(vals), 6),
                "max": round(max(vals), 6),
                "stdev": round(statistics.stdev(vals), 6) if len(vals) > 1 else 0,
                "null_count": len(rows) - len(vals),
            }

    wins = sum(1 for r in rows if r.get("outcome") == 1)
    losses = len(rows) - wins
    r_values = [_safe_float(r.get("r_multiple")) for r in rows]
    r_values = [v for v in r_values if v is not None]

    report = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "attempts_scanned": len(attempt_files),
        "rows_produced": len(rows),
        "skip_reasons": dict(skip_reasons),
        "outcome_distribution": {"wins": wins, "losses": losses},
        "r_multiple_stats": {
            "mean": round(statistics.mean(r_values), 4) if r_values else None,
            "median": round(statistics.median(r_values), 4) if r_values else None,
            "stdev": round(statistics.stdev(r_values), 4) if len(r_values) > 1 else None,
        },
        "symbols": list(set(r.get("symbol", "") for r in rows)),
        "timeframes": list(set(r.get("timeframe", "") for r in rows)),
        "feature_stats": feature_stats,
    }

    report_path = output_dir / "dataset_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\nDataset built: {len(rows)} rows from {len(attempt_files)} attempts")
    print(f"  Wins: {wins}, Losses: {losses}")
    if r_values:
        print(f"  Mean R: {statistics.mean(r_values):.4f}")
    print(f"  Skipped: {dict(skip_reasons)}")
    print(f"\nOutputs:")
    print(f"  {csv_path}")
    print(f"  {report_path}")

    return report


def main():
    parser = argparse.ArgumentParser(description="Build ML dataset from training module trades")
    parser.add_argument(
        "--attempts-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "backend" / "data" / "training" / "attempts",
        help="Path to training attempts JSON directory",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "artifacts" / "training_dataset",
        help="Output directory for CSV and report",
    )
    parser.add_argument(
        "--min-bars",
        type=int,
        default=20,
        help="Minimum number of OHLCV bars required per attempt (default: 20)",
    )
    args = parser.parse_args()
    build_dataset(args.attempts_dir, args.output_dir, args.min_bars)


if __name__ == "__main__":
    main()
