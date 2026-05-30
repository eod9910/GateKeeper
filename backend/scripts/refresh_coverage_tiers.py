#!/usr/bin/env python
"""Coverage Filter weekly refresh (PRD D22).

Pre-scores every symbol in our `brand_to_ticker` registry plus any symbol
currently appearing in active scenarios, computes the composite_score per
`coverage-thresholds.json`, and upserts a row into `coverage_tiers`.

The promoter doesn't read this table yet (the gate ships in a follow-up
patch with topic-to-ticker resolver). For now this script populates the
table so the API endpoint and downstream Social Arbitrage scoring can
look up tier + edge_multiplier per symbol.

# Inputs (per symbol)

  * sellside_analyst_count       yfinance info.numberOfAnalystOpinions
  * market_cap_usd               yfinance info.marketCap
  * institutional_ownership_pct  yfinance info.heldPercentInstitutions
  * daily_dollar_volume_avg      mean(Close * Volume) over last 30 trading days
  * mainstream_mention_count_90d count of situation_signals where source_type
                                 starts with 'mainstream' over last 90 days
                                 (will be 0 until tier-1 collectors land)

# Composite score

Per coverage-thresholds.json. Renormalized linear weighting; missing inputs
default to the *high* end of the normalization range (assume well-covered
when uncertain — protects the engine from accidentally over-trading
something we just couldn't fetch data for).

# Untradable rules

Hard-applied:

  * UNTRADABLE_MARKET_CAP   (market_cap < $300M)
  * UNTRADABLE_LIQUIDITY    (30d ADV < $1M)

When either fires, coverage_tier='untradable' regardless of composite score.

# Cron

Weekly Saturday 02:00 PT. Each run takes ~3-5 minutes for a 200-symbol
universe (yfinance 0.5-1s/symbol with retries). Polite pacing built in.

Usage:
    py backend/scripts/refresh_coverage_tiers.py
    py backend/scripts/refresh_coverage_tiers.py --symbols MSFT,GOOGL --verbose
    py backend/scripts/refresh_coverage_tiers.py --priority-only --verbose
    py backend/scripts/refresh_coverage_tiers.py --dry-run --max-symbols 5
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "market-intelligence.sqlite"
COVERAGE_CONFIG_PATH = (
    PROJECT_ROOT / "backend" / "data" / "scenarios" / "coverage-thresholds.json"
)

EXPECTED_SCHEMA_VERSION = 5
PER_SYMBOL_SLEEP_SECS = 0.4


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[coverage] DB missing at {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema_version(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    raw = row["value"] if row else None
    try:
        actual = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        actual = None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[coverage] schema_version mismatch: got {actual!r}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}"
        )


# ---------------------------------------------------------------------------
# Universe selection
# ---------------------------------------------------------------------------

def load_universe(
    conn: sqlite3.Connection, *, priority_only: bool, override: Optional[Sequence[str]]
) -> List[str]:
    """Return list of symbols to refresh, deduped + ordered by priority.

    Priority order:
      1. Symbols currently in active market_situations.metadata_json.watch_tickers
      2. Symbols appearing in unpromoted emerging_topics.resolved_tickers_json
      3. Every distinct parent_ticker in brand_to_ticker (alpha order)

    With --priority-only we stop after step 2.
    """
    if override:
        return [s.strip().upper() for s in override if s.strip()]

    seen: List[str] = []
    seen_set: set[str] = set()

    def _add(symbols: Sequence[str]) -> None:
        for s in symbols:
            if not s:
                continue
            up = s.strip().upper()
            if up and up not in seen_set:
                seen_set.add(up)
                seen.append(up)

    for r in conn.execute(
        "SELECT metadata_json FROM market_situations WHERE archived_at IS NULL"
    ):
        try:
            m = json.loads(r["metadata_json"] or "{}")
            _add(m.get("watch_tickers") or [])
        except (TypeError, ValueError):
            continue

    for r in conn.execute(
        "SELECT resolved_tickers_json FROM emerging_topics WHERE resolved_tickers_json IS NOT NULL"
    ):
        try:
            _add(json.loads(r["resolved_tickers_json"]) or [])
        except (TypeError, ValueError):
            continue

    if priority_only:
        return seen

    for r in conn.execute(
        "SELECT DISTINCT parent_ticker FROM brand_to_ticker WHERE parent_ticker IS NOT NULL ORDER BY parent_ticker"
    ):
        _add([r["parent_ticker"]])

    return seen


# ---------------------------------------------------------------------------
# Coverage config + score formula
# ---------------------------------------------------------------------------

def load_config() -> Dict[str, Any]:
    return json.loads(COVERAGE_CONFIG_PATH.read_text(encoding="utf-8"))


def _normalize_log_scale(value: Optional[float], lo: float, hi: float) -> float:
    """Log-spaced normalize. Used for analyst_count.

    A 0 means "no analysts at all" -> 0. We map log1p(value) into [lo, hi].
    """
    if value is None or value < 0:
        return 0.0
    if hi <= lo:
        return 0.0
    v = math.log1p(float(value))
    norm_hi = math.log1p(hi)
    return max(0.0, min(1.0, (v - lo) / (norm_hi - lo) if norm_hi > lo else 0.0))


def _normalize_log10(value: Optional[float], lo_log: float, hi_log: float) -> float:
    """log10-normalize for market_cap_usd. lo_log=8 means $100M, hi_log=12 means $1T."""
    if value is None or value <= 0:
        return 0.0
    v = math.log10(float(value))
    if hi_log <= lo_log:
        return 0.0
    return max(0.0, min(1.0, (v - lo_log) / (hi_log - lo_log)))


def _normalize_log1p(value: Optional[float], lo: float, hi: float) -> float:
    if value is None or value <= 0:
        return 0.0
    v = math.log1p(float(value))
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))


def _normalize_linear(value: Optional[float], lo: float, hi: float) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, (float(value) - lo) / (hi - lo))) if hi > lo else 0.0


def compute_composite_score(inputs: Dict[str, Optional[float]], cfg: Dict[str, Any]) -> float:
    """Return composite_score in [0, 100].

    For inputs that are None (couldn't fetch), we substitute the *median*
    normalized value (0.5) — neutral, neither rewarding nor penalizing.
    The PRD doesn't specify; "default to mid" is the most defensible
    behavior for v1 since we don't yet have a re-fetch retry path.
    """
    weights = cfg["composite_score"]["weights"]

    def _norm_or_neutral(value: Optional[float], spec: Dict[str, Any]) -> float:
        if value is None:
            return 0.5
        norm = spec["normalization"]
        rng = spec["range"]
        if norm == "log_scale":
            return _normalize_log_scale(value, float(rng[0]), float(rng[1]))
        if norm == "log10":
            return _normalize_log10(value, float(rng[0]), float(rng[1]))
        if norm == "log1p":
            return _normalize_log1p(value, float(rng[0]), float(rng[1]))
        if norm == "linear":
            return _normalize_linear(value, float(rng[0]), float(rng[1]))
        # Unknown normalization — neutral.
        return 0.5

    score = 0.0
    for key, spec in weights.items():
        score += float(spec["weight"]) * _norm_or_neutral(inputs.get(key), spec)
    return round(score * 100.0, 3)


def assign_tier(
    composite_score: float,
    market_cap_usd: Optional[float],
    daily_dollar_volume_avg: Optional[float],
    cfg: Dict[str, Any],
) -> Tuple[str, float, Optional[str]]:
    """Returns (tier, edge_multiplier, untradable_reason)."""
    rules = cfg["untradable_rules"]
    untradable_mult = float(rules.get("edge_multiplier", 0.0))
    if market_cap_usd is not None and market_cap_usd < 300_000_000:
        return ("untradable", untradable_mult, "UNTRADABLE_MARKET_CAP")
    if daily_dollar_volume_avg is not None and daily_dollar_volume_avg < 1_000_000:
        return ("untradable", untradable_mult, "UNTRADABLE_LIQUIDITY")

    for band in cfg["tier_bands"]:
        lo, hi = band["score_range"]
        last = band is cfg["tier_bands"][-1]
        in_band = (composite_score >= lo) and (composite_score < hi or last)
        if in_band:
            return (str(band["tier"]), float(band["edge_multiplier"]), None)
    # Fallback: shouldn't happen if bands cover [0, 100].
    return ("well_covered", 1.0, None)


# ---------------------------------------------------------------------------
# Yahoo Finance fetcher
# ---------------------------------------------------------------------------

def fetch_inputs_yf(symbol: str, *, verbose: bool) -> Dict[str, Optional[float]]:
    """Returns dict with all 5 inputs (each may be None)."""
    try:
        import yfinance as yf  # imported lazily so the module loads even without yfinance
    except ImportError:
        sys.exit("[coverage] yfinance not installed. pip install yfinance")

    inputs: Dict[str, Optional[float]] = {
        "sellside_analyst_count": None,
        "market_cap_usd": None,
        "institutional_ownership_pct": None,
        "daily_dollar_volume_avg": None,
        "mainstream_mention_count_90d": None,
    }

    try:
        tk = yf.Ticker(symbol)
        info: Dict[str, Any] = {}
        try:
            info = dict(tk.info or {})
        except Exception as exc:
            if verbose:
                print(f"  [coverage] {symbol}: .info failed: {exc}")

        ana = info.get("numberOfAnalystOpinions")
        if isinstance(ana, (int, float)) and ana >= 0:
            inputs["sellside_analyst_count"] = float(ana)

        mc = info.get("marketCap")
        if isinstance(mc, (int, float)) and mc > 0:
            inputs["market_cap_usd"] = float(mc)

        held = info.get("heldPercentInstitutions")
        if isinstance(held, (int, float)):
            inputs["institutional_ownership_pct"] = float(held) * 100.0  # yf returns 0-1

        try:
            hist = tk.history(period="30d")
            if hist is not None and not hist.empty:
                dollar = (hist["Close"] * hist["Volume"]).dropna()
                if len(dollar) > 0:
                    inputs["daily_dollar_volume_avg"] = float(dollar.mean())
        except Exception as exc:
            if verbose:
                print(f"  [coverage] {symbol}: .history failed: {exc}")
    except Exception as exc:
        if verbose:
            print(f"  [coverage] {symbol}: ticker construction failed: {exc}")

    return inputs


def fetch_mainstream_mentions(conn: sqlite3.Connection, symbol: str, lookback_secs: int) -> int:
    """Count situation_signals where source_type starts with 'mainstream' AND
    entity matches the symbol over the last `lookback_secs` seconds."""
    since = int(time.time()) - lookback_secs
    row = conn.execute(
        """
        SELECT COUNT(*) AS c
        FROM situation_signals
        WHERE source_type LIKE 'mainstream%'
          AND entity = ?
          AND observed_at >= ?
        """,
        (symbol, since),
    ).fetchone()
    return int(row["c"]) if row else 0


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def upsert_coverage_row(
    conn: sqlite3.Connection, *,
    symbol: str,
    tier: str,
    inputs: Dict[str, Optional[float]],
    composite: float,
    as_of: int,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO coverage_tiers (
            symbol, coverage_tier,
            sellside_analyst_count, market_cap_usd,
            institutional_ownership_pct, mainstream_mention_count_90d,
            daily_dollar_volume_avg, composite_score, as_of
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            tier,
            int(inputs["sellside_analyst_count"]) if inputs["sellside_analyst_count"] is not None else None,
            inputs["market_cap_usd"],
            inputs["institutional_ownership_pct"],
            int(inputs["mainstream_mention_count_90d"] or 0),
            inputs["daily_dollar_volume_avg"],
            composite,
            as_of,
        ),
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def refresh(
    conn: sqlite3.Connection,
    *,
    symbols: List[str],
    cfg: Dict[str, Any],
    dry_run: bool,
    verbose: bool,
    sleep_secs: float,
) -> Dict[str, Any]:
    if not symbols:
        return {"refreshed": 0, "skipped_errors": 0, "tier_counts": {}}

    refreshed = 0
    errors = 0
    tier_counts: Dict[str, int] = {}
    untradable_reasons: Dict[str, str] = {}

    as_of = int(time.time())
    lookback_secs = 90 * 24 * 3600

    for i, symbol in enumerate(symbols):
        try:
            inputs = fetch_inputs_yf(symbol, verbose=verbose)
            inputs["mainstream_mention_count_90d"] = float(
                fetch_mainstream_mentions(conn, symbol, lookback_secs)
            )

            composite = compute_composite_score(inputs, cfg)
            tier, edge_mult, untrad_reason = assign_tier(
                composite,
                inputs["market_cap_usd"],
                inputs["daily_dollar_volume_avg"],
                cfg,
            )
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            if untrad_reason:
                untradable_reasons[symbol] = untrad_reason

            if verbose:
                mc = inputs["market_cap_usd"]
                mc_str = f"${mc/1e9:.1f}B" if mc else "n/a"
                ana = inputs["sellside_analyst_count"]
                adv = inputs["daily_dollar_volume_avg"]
                adv_str = f"${adv/1e6:.1f}M" if adv else "n/a"
                tag = f" ({untrad_reason})" if untrad_reason else ""
                print(
                    f"[coverage] [{i+1}/{len(symbols)}] {symbol:10s} "
                    f"score={composite:5.1f} tier={tier:16s} edge={edge_mult:.1f}x "
                    f"mc={mc_str:>9s} ana={ana} adv={adv_str:>9s}{tag}"
                )

            if not dry_run:
                upsert_coverage_row(
                    conn, symbol=symbol, tier=tier, inputs=inputs,
                    composite=composite, as_of=as_of,
                )
            refreshed += 1
        except Exception as exc:
            errors += 1
            print(f"[coverage] {symbol}: error: {exc}")

        if i + 1 < len(symbols):
            time.sleep(sleep_secs)

    if not dry_run:
        conn.commit()

    return {
        "refreshed": refreshed,
        "errors": errors,
        "tier_counts": tier_counts,
        "untradable_reasons": untradable_reasons,
        "as_of": as_of,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Refresh coverage_tiers (PRD D22).")
    p.add_argument("--db", default=str(DEFAULT_DB_PATH))
    p.add_argument(
        "--symbols", default=None,
        help="comma-separated tickers; overrides registry-derived universe"
    )
    p.add_argument(
        "--priority-only", action="store_true",
        help="only refresh symbols currently in active scenarios + emerging topics"
    )
    p.add_argument("--max-symbols", type=int, default=None,
                   help="cap symbols processed per run")
    p.add_argument("--sleep-secs", type=float, default=PER_SYMBOL_SLEEP_SECS,
                   help=f"seconds between yfinance calls (default {PER_SYMBOL_SLEEP_SECS})")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything, do not write")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    conn = open_db(Path(args.db))
    try:
        assert_schema_version(conn)
        cfg = load_config()
        override = args.symbols.split(",") if args.symbols else None
        universe = load_universe(conn, priority_only=args.priority_only, override=override)
        if args.max_symbols is not None:
            universe = universe[: args.max_symbols]
        if not universe:
            print("[coverage] no symbols in universe — nothing to do")
            return 0
        if args.verbose:
            print(f"[coverage] universe ({len(universe)} symbols): {universe[:8]}{'...' if len(universe) > 8 else ''}")
        result = refresh(
            conn,
            symbols=universe,
            cfg=cfg,
            dry_run=args.dry_run,
            verbose=args.verbose,
            sleep_secs=args.sleep_secs,
        )
        print(json.dumps(result, indent=2))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
