#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[2]
VALIDATOR_TS = ROOT / "backend" / "src" / "routes" / "validator.ts"
STRATEGY_JS = ROOT / "frontend" / "public" / "strategy.js"
UNIVERSE_CLEAN = ROOT / "backend" / "data" / "universe_clean.json"
OPTIONABLE_JSON = ROOT / "backend" / "data" / "universe" / "optionable.json"

LARGE_CAP_KNOWN_TARGET = 76
TIER1B_FALLBACK_TARGET = 250


def normalize_symbols(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        sym = str(value or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def deterministic_slice(symbols: list[str], target_count: int) -> list[str]:
    if len(symbols) <= target_count:
        return symbols[:]
    out: list[str] = []
    seen: set[str] = set()
    step = len(symbols) / target_count
    for i in range(target_count):
        idx = min(len(symbols) - 1, int(i * step))
        while idx < len(symbols) and symbols[idx] in seen:
            idx += 1
        if idx >= len(symbols):
            break
        seen.add(symbols[idx])
        out.append(symbols[idx])
    return out


def format_symbol_block(symbols: list[str], indent: str = "      ", per_line: int = 10) -> str:
    chunks = []
    for i in range(0, len(symbols), per_line):
        chunk = ",".join(f"'{s}'" for s in symbols[i:i + per_line])
        chunks.append(f"{indent}{chunk},")
    if chunks:
        chunks[-1] = chunks[-1].rstrip(",")
    return "\n".join(chunks)


def extract_object_block(text: str, marker: str) -> tuple[int, int, str]:
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f"Could not locate object block marker: {marker}")
    i = start + len(marker)
    depth = 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    if depth != 0:
        raise RuntimeError(f"Unbalanced object block for marker: {marker}")
    return start, i, text[start:i]


def replace_block(text: str, key: str, replacement_lines: str, *, object_marker: str) -> str:
    obj_start, obj_end, obj_text = extract_object_block(text, object_marker)
    start_pattern = rf"(^\s*{key}:\s*\[)(.*?)(^\s*\],)"
    match = re.search(start_pattern, obj_text, re.S | re.M)
    if not match:
        raise RuntimeError(f"Could not find block for {key} inside {object_marker}")
    new_obj = obj_text[:match.start(2)] + "\n" + replacement_lines + "\n" + obj_text[match.end(2):]
    return text[:obj_start] + new_obj + text[obj_end:]


def main() -> None:
    clean = json.loads(UNIVERSE_CLEAN.read_text(encoding="utf-8"))
    stocks = clean.get("stocks", [])
    clean_set = {
        str(entry.get("ticker", "")).strip().upper()
        for entry in stocks
        if entry.get("ticker")
    }

    optionable = json.loads(OPTIONABLE_JSON.read_text(encoding="utf-8"))
    source_symbols = optionable.get("optionable") or optionable.get("symbols") or optionable.get("source_symbols") or []
    optionable_clean = normalize_symbols([s for s in source_symbols if str(s).strip().upper() in clean_set])
    tier1b_fallback = deterministic_slice(optionable_clean, TIER1B_FALLBACK_TARGET)

    large_caps = normalize_symbols([
        entry.get("ticker")
        for entry in stocks
        if str(entry.get("cap_tier", "")).lower() == "large"
    ])
    large_cap_known = deterministic_slice(large_caps, LARGE_CAP_KNOWN_TARGET)

    validator_text = VALIDATOR_TS.read_text(encoding="utf-8")
    validator_text = replace_block(
        validator_text,
        "large_cap_known",
        format_symbol_block(large_cap_known),
        object_marker="stocks: {",
    )
    validator_text = replace_block(
        validator_text,
        "tier1b",
        format_symbol_block(tier1b_fallback),
        object_marker="stocks: {",
    )
    VALIDATOR_TS.write_text(validator_text, encoding="utf-8")

    strategy_text = STRATEGY_JS.read_text(encoding="utf-8")
    strategy_text = replace_block(
        strategy_text,
        "large_cap_known",
        format_symbol_block(large_cap_known, indent="      "),
        object_marker="stocks: {",
    )
    STRATEGY_JS.write_text(strategy_text, encoding="utf-8")

    print(f"Updated large_cap_known to {len(large_cap_known)} clean large caps")
    print(f"Updated static tier1b fallback to {len(tier1b_fallback)} clean optionable stocks")


if __name__ == "__main__":
    main()
