#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import re


ROOT = pathlib.Path(__file__).resolve().parents[2]
VALIDATOR_TS = ROOT / "backend" / "src" / "routes" / "validator.ts"
UNIVERSE_CLEAN = ROOT / "backend" / "data" / "universe_clean.json"
OPTIONABLE_JSON = ROOT / "backend" / "data" / "universe" / "optionable.json"
STOCKS_TIER1B_TARGET_SYMBOLS = 250
FILE_BACKED_TIER_SOURCES = {
    "tier1": ROOT / "backend" / "data" / "validation_tier1_mixed_cap.json",
    "tier1s": ROOT / "backend" / "data" / "validation_tier1_mixed_cap.json",
    "tier1b": ROOT / "backend" / "data" / "validation_tier1b_mixed_cap.json",
    "tier2": ROOT / "backend" / "data" / "validation_tier2_mixed_cap.json",
    "tier3": ROOT / "backend" / "data" / "validation_tier3_mixed_cap_holdout.json",
}


def load_clean_set() -> set[str]:
    data = json.loads(UNIVERSE_CLEAN.read_text(encoding="utf-8"))
    return {
        str(entry.get("ticker", "")).strip().upper()
        for entry in data.get("stocks", [])
        if entry.get("ticker")
    }


def extract_stock_lists(ts_text: str) -> dict[str, list[str]]:
    marker = "stocks: {"
    start = ts_text.find(marker)
    if start < 0:
        raise RuntimeError("Could not locate stocks block in validator.ts")
    i = start + len(marker)
    depth = 1
    while i < len(ts_text) and depth > 0:
        ch = ts_text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    if depth != 0:
        raise RuntimeError("Unbalanced stocks block in validator.ts")
    block = ts_text[start + len(marker): i - 1]
    lines = block.splitlines()
    out: dict[str, list[str]] = {}
    for key in ("tier1", "tier1s", "tier1b", "tier2", "tier3", "large_cap_known"):
        collecting = False
        collected: list[str] = []
        for line in lines:
            if not collecting:
                if re.match(rf"^\s*{key}:\s*\[", line):
                    collecting = True
                    collected.append(line.split("[", 1)[1])
                continue
            if re.match(r"^\s*\],", line):
                break
            collected.append(line)
        if not collected:
            out[key] = []
            continue
        syms = re.findall(r"'([^']+)'", "\n".join(collected))
        deduped: list[str] = []
        seen: set[str] = set()
        for sym in syms:
            if sym not in seen:
                seen.add(sym)
                deduped.append(sym)
        out[key] = deduped
    return out


def hydrate_file_backed_tiers(lists: dict[str, list[str]]) -> dict[str, list[str]]:
    hydrated = dict(lists)
    for tier, path in FILE_BACKED_TIER_SOURCES.items():
        if hydrated.get(tier):
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        hydrated[tier] = [
            str(symbol).strip().upper()
            for symbol in payload.get("symbols", [])
            if str(symbol).strip()
        ]
    return hydrated


def audit_against_clean(name: str, symbols: list[str], clean: set[str]) -> None:
    missing = [s for s in symbols if s not in clean]
    print(f"{name}: {len(symbols)} total, {len(missing)} not in clean universe")
    if missing:
        preview = ", ".join(missing[:40])
        suffix = f" ... +{len(missing) - 40} more" if len(missing) > 40 else ""
        print(f"  missing: {preview}{suffix}")


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


def main() -> None:
    clean = load_clean_set()
    ts_text = VALIDATOR_TS.read_text(encoding="utf-8")
    lists = hydrate_file_backed_tiers(extract_stock_lists(ts_text))

    print(f"Clean universe size: {len(clean)}")
    print()
    for name, symbols in lists.items():
        audit_against_clean(name, symbols, clean)

    print()
    optionable = json.loads(OPTIONABLE_JSON.read_text(encoding="utf-8"))
    source_symbols = optionable.get("optionable") or optionable.get("symbols") or optionable.get("source_symbols") or []
    deduped: list[str] = []
    seen: set[str] = set()
    for sym in source_symbols:
        sym_u = str(sym).strip().upper()
        if sym_u and sym_u not in seen:
            seen.add(sym_u)
            deduped.append(sym_u)
    missing = [s for s in deduped if s not in clean]
    print(
        "optionable.json: "
        f"{len(deduped)} symbols, {len(missing)} not in clean universe, "
        f"source_count={optionable.get('source_symbol_count')}, include_etfs={optionable.get('include_etfs')}"
    )
    if missing:
        preview = ", ".join(missing[:40])
        suffix = f" ... +{len(missing) - 40} more" if len(missing) > 40 else ""
        print(f"  first missing: {preview}{suffix}")
    filtered = [s for s in deduped if s in clean]
    filtered_slice = deterministic_slice(filtered, STOCKS_TIER1B_TARGET_SYMBOLS)
    audit_against_clean("optionable legacy clean-filtered slice", filtered_slice, clean)


if __name__ == "__main__":
    main()
