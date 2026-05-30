from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import pandas as pd


@dataclass
class SwingPoint:
    kind: str  # "high" or "low"
    index: int  # global bar index
    local_index: int
    price: float


def is_pivot_high(df: pd.DataFrame, i: int, left: int, right: int) -> bool:
    value = df.iloc[i]["high"]
    left_slice = df.iloc[i - left : i]["high"]
    right_slice = df.iloc[i + 1 : i + 1 + right]["high"]
    return (
        len(left_slice) == left
        and len(right_slice) == right
        and value > left_slice.max()
        and value >= right_slice.max()
    )


def is_pivot_low(df: pd.DataFrame, i: int, left: int, right: int) -> bool:
    value = df.iloc[i]["low"]
    left_slice = df.iloc[i - left : i]["low"]
    right_slice = df.iloc[i + 1 : i + 1 + right]["low"]
    return (
        len(left_slice) == left
        and len(right_slice) == right
        and value < left_slice.min()
        and value <= right_slice.min()
    )


def find_swings(df: pd.DataFrame, global_offset: int, left: int, right: int) -> List[SwingPoint]:
    swings: List[SwingPoint] = []

    for i in range(left, len(df) - right):
        if is_pivot_high(df, i, left, right):
            swings.append(
                SwingPoint(
                    kind="high",
                    index=global_offset + i,
                    local_index=i,
                    price=float(df.iloc[i]["high"]),
                )
            )
        if is_pivot_low(df, i, left, right):
            swings.append(
                SwingPoint(
                    kind="low",
                    index=global_offset + i,
                    local_index=i,
                    price=float(df.iloc[i]["low"]),
                )
            )

    swings.sort(key=lambda s: s.local_index)
    return swings


def line_value_at(x1: int, y1: float, x2: int, y2: float, x: int) -> float:
    if x2 == x1:
        return y1
    slope = (y2 - y1) / (x2 - x1)
    return y1 + slope * (x - x1)


def pick_best_hs_candidate(swings: List[SwingPoint], shoulder_tolerance: float) -> Optional[Dict[str, Any]]:
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]

    best = None

    for i in range(len(highs) - 2):
        left_shoulder = highs[i]
        head = highs[i + 1]
        right_shoulder = highs[i + 2]

        # Must be in order.
        if not (left_shoulder.local_index < head.local_index < right_shoulder.local_index):
            continue

        # Head must be above both shoulders.
        if not (head.price > left_shoulder.price and head.price > right_shoulder.price):
            continue

        # Right shoulder cannot be materially above left shoulder.
        if right_shoulder.price > left_shoulder.price * (1.0 + shoulder_tolerance):
            continue

        # Find the two lows between the three highs.
        between_low_1 = [l for l in lows if left_shoulder.local_index < l.local_index < head.local_index]
        between_low_2 = [l for l in lows if head.local_index < l.local_index < right_shoulder.local_index]

        if not between_low_1 or not between_low_2:
            continue

        low1 = min(between_low_1, key=lambda x: x.price)
        low2 = min(between_low_2, key=lambda x: x.price)

        # Score candidate: bigger head relative to shoulders is better.
        avg_shoulder = (left_shoulder.price + right_shoulder.price) / 2.0
        prominence = head.price - avg_shoulder

        candidate = {
            "left_shoulder": left_shoulder,
            "head": head,
            "right_shoulder": right_shoulder,
            "neckline_low_1": low1,
            "neckline_low_2": low2,
            "score": prominence,
        }

        if best is None or candidate["score"] > best["score"]:
            best = candidate

    return best


def confirm_neckline_break(
    df: pd.DataFrame,
    right_shoulder_local_index: int,
    low1: SwingPoint,
    low2: SwingPoint,
) -> Optional[Dict[str, Any]]:
    for local_i in range(right_shoulder_local_index + 1, len(df)):
        global_i = low1.index - low1.local_index + local_i
        neckline_here = line_value_at(
            x1=low1.index,
            y1=low1.price,
            x2=low2.index,
            y2=low2.price,
            x=global_i,
        )
        close_here = float(df.iloc[local_i]["close"])

        if close_here < neckline_here:
            return {
                "break_local_index": local_i,
                "break_global_index": global_i,
                "close": close_here,
                "neckline_value": neckline_here,
            }

    return None


def validate_head_shoulders(
    ohlc_slice: pd.DataFrame,
    global_offset: int,
    pivot_left: int = 3,
    pivot_right: int = 3,
    shoulder_tolerance: float = 0.03,
) -> Dict[str, Any]:
    if len(ohlc_slice) < (pivot_left + pivot_right + 10):
        return {"valid": False, "reason": "Slice too small to evaluate pattern"}

    swings = find_swings(
        df=ohlc_slice,
        global_offset=global_offset,
        left=pivot_left,
        right=pivot_right,
    )

    if len(swings) < 5:
        return {"valid": False, "reason": "Not enough swing points found"}

    candidate = pick_best_hs_candidate(swings, shoulder_tolerance)
    if candidate is None:
        return {"valid": False, "reason": "No valid left-shoulder/head/right-shoulder triplet found"}

    neckline_break = confirm_neckline_break(
        df=ohlc_slice,
        right_shoulder_local_index=candidate["right_shoulder"].local_index,
        low1=candidate["neckline_low_1"],
        low2=candidate["neckline_low_2"],
    )

    if neckline_break is None:
        return {
            "valid": False,
            "reason": "No confirmed close below neckline after right shoulder",
            "pattern": serialize_candidate(candidate),
        }

    entry = neckline_break["close"]
    stop = candidate["right_shoulder"].price
    neckline_at_head = line_value_at(
        x1=candidate["neckline_low_1"].index,
        y1=candidate["neckline_low_1"].price,
        x2=candidate["neckline_low_2"].index,
        y2=candidate["neckline_low_2"].price,
        x=candidate["head"].index,
    )
    measured_move = candidate["head"].price - neckline_at_head
    target = entry - measured_move

    return {
        "valid": True,
        "reason": "Pattern structurally valid",
        "pattern": serialize_candidate(candidate),
        "neckline_break": neckline_break,
        "trade_idea": {
            "entry": entry,
            "stop": stop,
            "target": target,
            "measured_move": measured_move,
        },
    }


def serialize_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
    def s(sp: SwingPoint) -> Dict[str, Any]:
        return {
            "kind": sp.kind,
            "index": sp.index,
            "local_index": sp.local_index,
            "price": sp.price,
        }

    return {
        "left_shoulder": s(candidate["left_shoulder"]),
        "head": s(candidate["head"]),
        "right_shoulder": s(candidate["right_shoulder"]),
        "neckline_low_1": s(candidate["neckline_low_1"]),
        "neckline_low_2": s(candidate["neckline_low_2"]),
        "score": candidate["score"],
    }
