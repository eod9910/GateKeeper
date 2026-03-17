"""Deterministic structural direction classification for v2 family signatures."""

from __future__ import annotations

from typing import Dict


def parse_family_signature_v2(family_signature_v2: str) -> Dict[str, str]:
    parts = family_signature_v2.split("|")
    return {
        "orientation": parts[0] if len(parts) > 0 else "UNSPECIFIED",
        "structural_class": parts[1] if len(parts) > 1 else "UNSPECIFIED",
        "break_profile": parts[2] if len(parts) > 2 else "UNSPECIFIED",
        "retrace_profile": parts[3] if len(parts) > 3 else "UNSPECIFIED",
    }


def classify_family_direction_v2(family_signature_v2: str) -> Dict[str, str]:
    """Classify structural direction from the generalized family signature alone."""
    parts = parse_family_signature_v2(family_signature_v2)
    structural_class = parts["structural_class"]
    break_profile = parts["break_profile"]
    retrace_profile = parts["retrace_profile"]
    orientation = parts["orientation"]

    if structural_class in {"CONTINUATION_UP", "REVERSAL_UP"}:
        direction = "BULLISH"
        reason = f"{structural_class} implies upward structural bias"
    elif structural_class in {"CONTINUATION_DOWN", "REVERSAL_DOWN"}:
        direction = "BEARISH"
        reason = f"{structural_class} implies downward structural bias"
    else:
        direction = "AMBIGUOUS"
        reason = "mixed structural class does not support deterministic directional bias"

    if direction != "AMBIGUOUS" and break_profile == "NO_EXTREME_BREAK":
        direction = "AMBIGUOUS"
        reason = "missing extreme-break evidence makes the structural bias too weak"

    return {
        "familySignatureV2": family_signature_v2,
        "direction": direction,
        "orientation": orientation,
        "structuralClass": structural_class,
        "breakProfile": break_profile,
        "retraceProfile": retrace_profile,
        "reason": reason,
    }
