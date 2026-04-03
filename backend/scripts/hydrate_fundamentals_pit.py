#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
sys.path.insert(0, str(SERVICES_DIR))

from fundamentalsService import get_fundamentals  # noqa: E402
from fundamentals_pit_store import DEFAULT_DB_PATH, connect, ensure_schema, ingest_cached_snapshot  # noqa: E402
from universe_registry import load_universe_symbols, resolve_universe_path  # noqa: E402


DEFAULT_CACHE_DIR = ROOT / "backend" / "data" / "fundamentals-cache"
DEFAULT_UNIVERSE_NAME = "clean_stocks"
DEFAULT_SYMBOLS_FILE = Path(
    resolve_universe_path(DEFAULT_UNIVERSE_NAME)
    or (ROOT / "backend" / "data" / "universe_clean.json")
)


def _normalize_symbol(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-=")
    cleaned = "".join(ch for ch in text if ch in allowed)
    return cleaned[:15]


def _dedupe(symbols: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for symbol in symbols:
        normalized = _normalize_symbol(symbol)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _load_symbols_from_file(path: Path) -> List[str]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        payload = json.loads(text)
        if isinstance(payload, list):
            return _dedupe(payload)
        for key in ("symbols", "source_symbols", "optionable"):
            value = payload.get(key)
            if isinstance(value, list):
                return _dedupe(value)
        raise ValueError(f"Unsupported universe JSON shape in {path}")
    return _dedupe(line.strip() for line in text.splitlines())


def _load_requested_symbols(args: argparse.Namespace) -> List[str]:
    requested: List[str] = []
    if args.symbols:
        requested.extend(str(item).strip() for item in args.symbols.split(","))
    if args.symbols_file:
        requested.extend(_load_symbols_from_file(Path(args.symbols_file)))
    elif not args.symbols and args.universe:
        requested.extend(load_universe_symbols(str(args.universe).strip()))
    elif not args.symbols:
        requested.extend(_load_symbols_from_file(DEFAULT_SYMBOLS_FILE))
    symbols = _dedupe(requested)
    if args.offset and args.offset > 0:
        symbols = symbols[args.offset :]
    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]
    return symbols


def _cache_path(cache_dir: Path, symbol: str) -> Path:
    return cache_dir / f"{symbol}.json"


def _read_cached_payload(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_cached_payload(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def main() -> None:
    parser = argparse.ArgumentParser(description="Hydrate fundamentals cache and PIT store for a symbol universe.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols")
    parser.add_argument("--symbols-file", default="", help="Path to JSON/TXT symbol file")
    parser.add_argument(
        "--universe",
        default=DEFAULT_UNIVERSE_NAME,
        help=f"Registry universe name to hydrate when no explicit symbols file is supplied (default: {DEFAULT_UNIVERSE_NAME})",
    )
    parser.add_argument("--offset", type=int, default=0, help="Optional symbol offset after loading")
    parser.add_argument("--limit", type=int, default=0, help="Optional limit after symbol loading")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR), help="Fundamentals cache directory")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="PIT SQLite database path")
    parser.add_argument("--refresh-cache", action="store_true", help="Fetch even when cache file exists")
    parser.add_argument("--delay-ms", type=int, default=250, help="Delay between live fetches")
    args = parser.parse_args()

    symbols = _load_requested_symbols(args)
    if not symbols:
        raise SystemExit("No symbols to hydrate.")

    cache_dir = Path(args.cache_dir)
    conn = connect(args.db_path)
    ensure_schema(conn)

    summary = {
        "symbols_requested": len(symbols),
        "symbols_completed": 0,
        "cache_reused": 0,
        "cache_refreshed": 0,
        "pit_symbols_ingested": 0,
        "failures": [],
    }

    try:
        for index, symbol in enumerate(symbols, start=1):
            cache_file = _cache_path(cache_dir, symbol)
            payload: Dict[str, Any]
            used_cache = False

            try:
                if cache_file.exists() and not args.refresh_cache:
                    payload = _read_cached_payload(cache_file)
                    used_cache = True
                    summary["cache_reused"] += 1
                else:
                    snapshot = get_fundamentals(symbol)
                    payload = {
                        "symbol": symbol,
                        "fetchedAt": _now_ms(),
                        "data": snapshot,
                    }
                    _write_cached_payload(cache_file, payload)
                    summary["cache_refreshed"] += 1
                    if args.delay_ms > 0:
                        time.sleep(args.delay_ms / 1000.0)

                ingest_cached_snapshot(conn, payload)
                summary["pit_symbols_ingested"] += 1
                summary["symbols_completed"] += 1
                source = "cache" if used_cache else "live"
                print(f"[{index}/{len(symbols)}] {symbol} ok ({source})", flush=True)
            except Exception as exc:
                summary["failures"].append({"symbol": symbol, "error": str(exc)})
                print(f"[{index}/{len(symbols)}] {symbol} failed: {exc}", file=sys.stderr, flush=True)
    finally:
        conn.close()

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
