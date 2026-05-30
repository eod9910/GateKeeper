#!/usr/bin/env python
"""Universe ranking engine (PRD Phase 3).

For each scenario with exposure rows, computes `composite_rank` per the PRD
formula and persists top-N candidates. Joins valuation data from symbol-catalog,
buzz scores from social-intelligence, and a lightweight technical readiness
score computed from OHLCV data.

composite_rank =
    0.30 * scenario_relevance +
    0.25 * valuation_score +
    0.15 * quality_score +
    0.15 * technical_readiness +
    0.10 * buzz_support +
    0.05 * liquidity_score
    - crowding_penalty

Usage:
    py backend/scripts/run_universe_ranking.py
    py backend/scripts/run_universe_ranking.py --dry-run --verbose
    py backend/scripts/run_universe_ranking.py --situation-id 168
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))

MI_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
SC_DB_PATH = os.path.join(BACKEND_DIR, "data", "symbol-catalog.sqlite")
SI_DB_PATH = os.path.join(BACKEND_DIR, "data", "social-intelligence.sqlite")

EXPECTED_SCHEMA_VERSION = 6
TOP_N = 20

RANK_WEIGHTS = {
    "scenario_relevance": 0.30,
    "valuation_score": 0.25,
    "quality_score": 0.15,
    "technical_readiness": 0.15,
    "buzz_support": 0.10,
    "liquidity_score": 0.05,
}


# ── Valuation joiner ────────────────────────────────────────────────

def load_valuation_data(symbols: Set[str]) -> Dict[str, Dict]:
    """Load valuation_gap_pct and quality_score from symbol-catalog."""
    if not os.path.exists(SC_DB_PATH) or not symbols:
        return {}
    conn = sqlite3.connect(SC_DB_PATH)
    conn.row_factory = sqlite3.Row

    result: Dict[str, Dict] = {}
    placeholders = ",".join("?" for _ in symbols)
    rows = conn.execute(
        f"""
        SELECT sm.symbol, sm.metric_name, sm.metric_value_num
        FROM symbol_metrics sm
        WHERE sm.symbol IN ({placeholders})
          AND sm.metric_name IN (
              'valuation_gap_pct', 'valuation_quality_score',
              'valuation_market_cap', 'valuation_current_ratio'
          )
        """,
        list(symbols),
    ).fetchall()
    for r in rows:
        sym = r["symbol"]
        if sym not in result:
            result[sym] = {}
        result[sym][r["metric_name"]] = r["metric_value_num"]
    conn.close()
    return result


# ── Buzz joiner ─────────────────────────────────────────────────────

def load_buzz_data(symbols: Set[str]) -> Dict[str, float]:
    """Load latest final_buzz_score from social-intelligence."""
    if not os.path.exists(SI_DB_PATH) or not symbols:
        return {}
    conn = sqlite3.connect(SI_DB_PATH)
    conn.row_factory = sqlite3.Row

    placeholders = ",".join("?" for _ in symbols)
    rows = conn.execute(
        f"""
        SELECT tbs.symbol, tbs.final_buzz_score
        FROM ticker_buzz_scores tbs
        INNER JOIN (
            SELECT symbol, MAX(trade_date) AS trade_date
            FROM ticker_buzz_scores
            WHERE symbol IN ({placeholders})
            GROUP BY symbol
        ) latest ON latest.symbol = tbs.symbol AND latest.trade_date = tbs.trade_date
        """,
        list(symbols),
    ).fetchall()
    conn.close()
    return {r["symbol"]: float(r["final_buzz_score"] or 0) for r in rows}


# ── Technical readiness (lightweight v1) ────────────────────────────

def fetch_ohlcv(symbol: str) -> Optional[List[Dict]]:
    """Fetch OHLCV from the local server chart cache."""
    try:
        url = f"http://localhost:3002/api/chart/ohlcv?symbol={symbol}&period=3mo&interval=1d"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        if isinstance(data, list):
            return data
        return None
    except Exception:
        return None


def compute_rsi(closes: List[float], period: int = 14) -> float:
    """Compute RSI from closing prices."""
    if len(closes) < period + 1:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))

    if len(gains) < period:
        return 50.0

    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def compute_technical_readiness(symbol: str) -> float:
    """Compute a 0-1 technical readiness score.

    v1 uses: RSI position, trend alignment (price vs 50d SMA), and
    proximity to recent support level. This is a thin aggregator per PRD.
    """
    bars = fetch_ohlcv(symbol)
    if not bars or len(bars) < 20:
        return 0.0

    closes = []
    for b in bars:
        c = b.get("close") or b.get("Close")
        if c is not None:
            closes.append(float(c))

    if len(closes) < 20:
        return 0.0

    rsi = compute_rsi(closes)
    rsi_score = 0.0
    if 30 <= rsi <= 45:
        rsi_score = 0.9
    elif 45 < rsi <= 55:
        rsi_score = 0.7
    elif 55 < rsi <= 70:
        rsi_score = 0.5
    elif rsi < 30:
        rsi_score = 0.4
    else:
        rsi_score = 0.2

    sma_50 = sum(closes[-50:]) / min(len(closes), 50)
    current = closes[-1]
    trend_score = 0.0
    if current > sma_50:
        pct_above = (current - sma_50) / sma_50
        if pct_above < 0.05:
            trend_score = 0.8
        elif pct_above < 0.15:
            trend_score = 0.6
        else:
            trend_score = 0.4
    else:
        pct_below = (sma_50 - current) / sma_50
        if pct_below < 0.05:
            trend_score = 0.5
        elif pct_below < 0.15:
            trend_score = 0.3
        else:
            trend_score = 0.1

    recent_low = min(closes[-20:])
    proximity = (current - recent_low) / max(current, 0.01)
    if proximity < 0.05:
        support_score = 0.9
    elif proximity < 0.10:
        support_score = 0.7
    elif proximity < 0.20:
        support_score = 0.5
    else:
        support_score = 0.3

    return round(0.40 * rsi_score + 0.35 * trend_score + 0.25 * support_score, 4)


# ── Composite rank formula ──────────────────────────────────────────

def compute_composite_rank(
    scenario_relevance: float,
    valuation_gap_pct: Optional[float],
    quality_score_raw: Optional[float],
    technical_readiness: float,
    buzz_score: float,
    market_cap: Optional[float],
    crowding_penalty: float = 0.0,
) -> float:
    """Compute the PRD composite_rank (0-100 scale).

    scenario_relevance: exposure_strength from the taxonomy/LLM (0-1)
    valuation_gap_pct: from symbol-catalog (negative = undervalued)
    quality_score_raw: 0-100 from symbol-catalog
    technical_readiness: 0-1 from technical aggregator
    buzz_score: 0-100 from social-intelligence
    market_cap: for liquidity proxy
    crowding_penalty: 0-1 deduction
    """
    val_score = 0.5
    if valuation_gap_pct is not None:
        gap = valuation_gap_pct
        if gap < -30:
            val_score = 0.95
        elif gap < -15:
            val_score = 0.80
        elif gap < -5:
            val_score = 0.65
        elif gap < 5:
            val_score = 0.50
        elif gap < 15:
            val_score = 0.35
        else:
            val_score = 0.20

    q_score = 0.5
    if quality_score_raw is not None:
        q_score = min(quality_score_raw / 100.0, 1.0)

    buzz_norm = min(buzz_score / 100.0, 1.0) if buzz_score else 0.0

    liq_score = 0.5
    if market_cap is not None and market_cap > 0:
        log_cap = math.log10(max(market_cap, 1))
        liq_score = min(max((log_cap - 8) / 4, 0), 1.0)

    raw = (
        RANK_WEIGHTS["scenario_relevance"] * scenario_relevance +
        RANK_WEIGHTS["valuation_score"] * val_score +
        RANK_WEIGHTS["quality_score"] * q_score +
        RANK_WEIGHTS["technical_readiness"] * technical_readiness +
        RANK_WEIGHTS["buzz_support"] * buzz_norm +
        RANK_WEIGHTS["liquidity_score"] * liq_score
        - crowding_penalty
    )

    return round(max(0, min(raw * 100, 100)), 2)


# ── Main runner ─────────────────────────────────────────────────────

def run(
    db_path: str = MI_DB_PATH,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    situation_id: Optional[int] = None,
    max_scenarios: int = 200,
    skip_technical: bool = False,
) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[universe-ranking] schema_version mismatch")

    where = "1=1"
    params: list = []
    if situation_id is not None:
        where += " AND ms.id = ?"
        params.append(situation_id)

    scenarios = conn.execute(
        f"""
        SELECT ms.id, ms.title, ms.detection_path, ms.confidence_score,
               ms.attention_score, ms.started_at, ms.updated_at
        FROM market_situations ms
        WHERE {where}
          AND ms.status NOT IN ('ARCHIVED', 'INVALIDATED')
        ORDER BY ms.evidence_count DESC, ms.id DESC
        LIMIT ?
        """,
        params + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[universe-ranking] {len(scenarios)} scenarios to rank")

    all_symbols: Set[str] = set()
    scenario_exposures: Dict[int, List[Dict]] = {}

    for row in scenarios:
        sid = int(row["id"])
        exposures = conn.execute(
            """
            SELECT id, asset_type, asset_key, exposure_direction,
                   exposure_order, exposure_strength, source_method,
                   confidence, universe_symbol
            FROM situation_exposure
            WHERE situation_id = ? AND universe_symbol IS NOT NULL
            ORDER BY exposure_order ASC, exposure_strength DESC
            """,
            (sid,),
        ).fetchall()
        if exposures:
            scenario_exposures[sid] = [dict(e) for e in exposures]
            for e in exposures:
                sym = e["universe_symbol"]
                if sym:
                    all_symbols.add(sym)

    if verbose:
        print(f"[universe-ranking] {len(all_symbols)} unique symbols across "
              f"{len(scenario_exposures)} scenarios with equity exposure")

    valuation_data = load_valuation_data(all_symbols)
    buzz_data = load_buzz_data(all_symbols)

    if verbose:
        print(f"[universe-ranking] Valuation data: {len(valuation_data)} symbols, "
              f"buzz data: {len(buzz_data)} symbols")

    tech_cache: Dict[str, float] = {}
    if not skip_technical:
        tech_symbols = list(all_symbols)[:100]
        if verbose:
            print(f"[universe-ranking] Computing technical readiness for "
                  f"{len(tech_symbols)} symbols...")
        for i, sym in enumerate(tech_symbols):
            tech_cache[sym] = compute_technical_readiness(sym)
            if verbose and (i + 1) % 20 == 0:
                print(f"  ... {i + 1}/{len(tech_symbols)} done")

    now = int(time.time())
    ranked_count = 0
    total_candidates = 0

    for row in scenarios:
        sid = int(row["id"])
        if sid not in scenario_exposures:
            continue

        exposures = scenario_exposures[sid]
        detection_path = row["detection_path"] or "news_cluster"

        candidates = []
        for exp in exposures:
            sym = exp["universe_symbol"]
            if not sym:
                continue

            relevance = float(exp["exposure_strength"] or 0)
            val = valuation_data.get(sym, {})
            gap = val.get("valuation_gap_pct")
            quality_raw = val.get("valuation_quality_score")
            market_cap = val.get("valuation_market_cap")
            buzz = buzz_data.get(sym, 0.0)
            tech = tech_cache.get(sym, 0.0)

            rank = compute_composite_rank(
                scenario_relevance=relevance,
                valuation_gap_pct=gap,
                quality_score_raw=quality_raw,
                technical_readiness=tech,
                buzz_score=buzz,
                market_cap=market_cap,
            )

            candidates.append({
                "exposure_id": exp["id"],
                "symbol": sym,
                "composite_rank": rank,
                "dcf_gap_pct": gap,
                "quality_score": quality_raw,
                "technical_score": tech,
                "final_buzz_score": buzz,
                "exposure_direction": exp["exposure_direction"],
            })

        candidates.sort(key=lambda c: c["composite_rank"], reverse=True)
        top = candidates[:TOP_N]

        if not dry_run:
            for c in top:
                conn.execute(
                    """
                    UPDATE situation_exposure SET
                        dcf_gap_pct = ?,
                        quality_score = ?,
                        technical_score = ?,
                        final_buzz_score = ?,
                        composite_rank = ?,
                        last_ranked_at = ?
                    WHERE id = ?
                    """,
                    (c["dcf_gap_pct"], c["quality_score"],
                     c["technical_score"], c["final_buzz_score"],
                     c["composite_rank"], now, c["exposure_id"]),
                )

            conn.execute(
                "UPDATE market_situations SET updated_at = ? WHERE id = ?",
                (now, sid),
            )

            # Check and set validity flags
            flags_row = conn.execute(
                "SELECT validity_flags_json FROM market_situations WHERE id = ?",
                (sid,),
            ).fetchone()
            existing_flags = []
            if flags_row and flags_row["validity_flags_json"]:
                try:
                    existing_flags = json.loads(flags_row["validity_flags_json"])
                except (json.JSONDecodeError, TypeError):
                    existing_flags = []

            new_flags = [f for f in existing_flags
                         if f not in ("NO_GOOD_EXPRESSION", "LOW_UNIVERSE_MATCH",
                                      "THESIS_REAL_EXECUTION_DELAYED")]

            if len(candidates) < 5 and (not top or top[0]["composite_rank"] < 50):
                new_flags.append("LOW_UNIVERSE_MATCH")
            elif len(candidates) >= 5 and top and top[0]["composite_rank"] < 50:
                new_flags.append("NO_GOOD_EXPRESSION")

            attention = float(row["attention_score"] or 0)
            started = int(row["started_at"] or now)
            age_days = (now - started) / 86400
            conf = float(row["confidence_score"] or 0)
            if attention >= 0.5 and conf < 0.2 and age_days >= 60:
                new_flags.append("THESIS_REAL_EXECUTION_DELAYED")

            conn.execute(
                "UPDATE market_situations SET validity_flags_json = ? WHERE id = ?",
                (json.dumps(new_flags), sid),
            )

        ranked_count += 1
        total_candidates += len(top)

        if verbose and top:
            title = (row["title"] or "")[:40]
            print(f"  id={sid} top={top[0]['symbol']}({top[0]['composite_rank']:.1f}) "
                  f"| {len(candidates)} candidates | {title}")

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "scenarios_ranked": ranked_count,
        "total_candidates_persisted": total_candidates,
        "symbols_with_valuation": len(valuation_data),
        "symbols_with_buzz": len(buzz_data),
        "symbols_with_technical": len(tech_cache),
        "dry_run": dry_run,
    }
    print(f"[universe-ranking] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Universe ranking engine (Phase 3)")
    parser.add_argument("--db-path", default=MI_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--max-scenarios", type=int, default=200)
    parser.add_argument("--skip-technical", action="store_true",
                        help="Skip OHLCV-based technical readiness (faster)")
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        situation_id=args.situation_id,
        max_scenarios=args.max_scenarios,
        skip_technical=args.skip_technical,
    )
