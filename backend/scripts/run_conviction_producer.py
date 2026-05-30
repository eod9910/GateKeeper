#!/usr/bin/env python
"""Conviction-layer producer (PRD D3, D16).

For each scenario that has enough evidence and exposure, generates a structured
conviction layer via OpenAI. Output is schema-validated and cached by a hash
of the evidence + exposure pack so re-runs are free until data changes.

Output shape (matches ConvictionLayer in marketIntelligence.ts):
    thesis_summary: string (<=3 sentences)
    why_now: string (<=3 sentences)
    what_breaks_it: string (<=3 sentences)
    expression_notes: string (<=3 sentences)
    confirming_signals: string[] (3-6 items)
    invalidating_signals: string[] (3-6 items)
    key_risks: string[] (2-4 items)
    best_expression_assets: string[] (must intersect exposure list)
    cited_evidence_ids: int[]

Usage:
    py backend/scripts/run_conviction_producer.py
    py backend/scripts/run_conviction_producer.py --dry-run --verbose
    py backend/scripts/run_conviction_producer.py --situation-id 168
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from typing import Any, Dict, List, Optional, Set

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
DOTENV_PATH = os.path.join(BACKEND_DIR, ".env")

EXPECTED_SCHEMA_VERSION = 6
MIN_EVIDENCE = 2
MAX_SCENARIOS_PER_RUN = 30

CONVICTION_PROMPT = """You are a senior macro analyst and portfolio strategist. Given a market
scenario with its evidence and exposure mapping, produce a structured conviction assessment.

SCENARIO:
Title: {title}
Summary: {summary}
Type: {scenario_type}
Theme: {primary_theme}
Status: {status}
Detection Path: {detection_path}
Time Horizon: {time_horizon}
Signal Strength: {signal_strength}
Confidence: {confidence_score}

EVIDENCE ({evidence_count} items):
{evidence_text}

FIRST-ORDER EFFECTS:
{first_order_text}

SECOND-ORDER EFFECTS:
{second_order_text}

TOP EXPRESSION CANDIDATES:
{candidates_text}

VALIDITY FLAGS: {validity_flags}

INSTRUCTIONS:
1. Write a thesis_summary (2-3 sentences) explaining WHY this scenario matters for portfolio positioning
2. Write why_now (2-3 sentences) explaining what has changed recently that makes this actionable NOW
3. Write what_breaks_it (2-3 sentences) describing what specific evidence would invalidate this thesis
4. Write expression_notes (2-3 sentences) about which exposure is cleanest and why
5. List 3-6 confirming_signals (each <=12 words) that would INCREASE conviction
6. List 3-6 invalidating_signals (each <=12 words) that would DECREASE conviction
7. List 2-4 key_risks
8. List best_expression_assets — ONLY use ticker symbols from the candidates list above
9. List cited_evidence_ids — reference the evidence IDs (numbers) you relied on most

Respond with ONLY valid JSON:
{{
    "thesis_summary": "...",
    "why_now": "...",
    "what_breaks_it": "...",
    "expression_notes": "...",
    "confirming_signals": ["...", "..."],
    "invalidating_signals": ["...", "..."],
    "key_risks": ["...", "..."],
    "best_expression_assets": ["TICKER", "..."],
    "cited_evidence_ids": [1, 2, 3]
}}
"""


def _load_dotenv() -> None:
    if not os.path.isfile(DOTENV_PATH):
        return
    with open(DOTENV_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()


def _compute_pack_hash(evidence_rows: List[Dict], exposure_rows: List[Dict]) -> str:
    """Deterministic hash of evidence + exposure for cache check."""
    pack = {
        "evidence_ids": sorted(r.get("id", 0) for r in evidence_rows),
        "exposure_ids": sorted(r.get("id", 0) for r in exposure_rows),
        "evidence_count": len(evidence_rows),
        "exposure_count": len(exposure_rows),
    }
    return hashlib.sha256(json.dumps(pack, sort_keys=True).encode()).hexdigest()[:16]


def _validate_conviction(
    result: Dict,
    valid_tickers: Set[str],
    valid_evidence_ids: Set[int],
) -> Optional[str]:
    """Validate LLM output. Returns error string or None if valid."""
    required_str = ["thesis_summary", "why_now", "what_breaks_it", "expression_notes"]
    for field in required_str:
        val = result.get(field, "")
        if not val or not isinstance(val, str) or len(val.strip()) < 10:
            return f"Missing or too short: {field}"

    required_lists = ["confirming_signals", "invalidating_signals", "key_risks"]
    for field in required_lists:
        val = result.get(field, [])
        if not isinstance(val, list) or len(val) < 2:
            return f"Missing or too few items: {field}"

    best = result.get("best_expression_assets", [])
    if not isinstance(best, list) or len(best) == 0:
        return "best_expression_assets is empty"
    for ticker in best:
        if ticker not in valid_tickers:
            return f"best_expression_assets contains {ticker} not in exposure list"

    cited = result.get("cited_evidence_ids", [])
    if isinstance(cited, list):
        result["cited_evidence_ids"] = [
            int(x) for x in cited if isinstance(x, (int, float))
        ]

    return None


def call_openai_conviction(
    scenario: Dict,
    evidence_rows: List[Dict],
    first_order: List[Dict],
    second_order: List[Dict],
    top_candidates: List[Dict],
    validity_flags: List[str],
    *,
    model: str = "gpt-4o-mini",
) -> Optional[Dict]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[conviction] WARNING: No OPENAI_API_KEY found")
        return None

    evidence_text = "\n".join(
        f"[ID:{r.get('id', '?')}] [{r.get('source_name', '?')}] "
        f"{r.get('headline_or_label', '?')}"
        + (f" — {r.get('summary', '')}" if r.get("summary") else "")
        for r in evidence_rows[:20]
    )

    fo_text = "\n".join(
        f"- {e.get('asset_or_sector', '?')} → {e.get('direction', '?')} "
        f"({e.get('magnitude_hint', 'moderate')})"
        for e in (first_order or [])
    ) or "(none mapped)"

    so_text = "\n".join(
        f"- {e.get('asset_or_sector', '?')} → {e.get('direction', '?')} "
        f"({e.get('magnitude_hint', 'moderate')})"
        for e in (second_order or [])
    ) or "(none mapped)"

    cands_text = "\n".join(
        f"- {c.get('symbol', '?')} (rank={c.get('composite_rank', 0):.1f}, "
        f"dir={c.get('exposure_direction', '?')})"
        for c in top_candidates[:10]
    ) or "(no ranked candidates)"

    prompt = CONVICTION_PROMPT.format(
        title=scenario.get("title", ""),
        summary=scenario.get("summary", ""),
        scenario_type=scenario.get("scenario_type", "unknown"),
        primary_theme=scenario.get("primary_theme", "unknown"),
        status=scenario.get("status", "EARLY"),
        detection_path=scenario.get("detection_path", "unknown"),
        time_horizon=scenario.get("time_horizon", "weeks"),
        signal_strength=scenario.get("signal_strength", 0),
        confidence_score=scenario.get("confidence_score", 0),
        evidence_count=len(evidence_rows),
        evidence_text=evidence_text or "(no evidence)",
        first_order_text=fo_text,
        second_order_text=so_text,
        candidates_text=cands_text,
        validity_flags=", ".join(validity_flags) if validity_flags else "(none)",
    )

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=1500,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or ""
        return json.loads(raw)
    except Exception as e:
        print(f"[conviction] OpenAI error: {e}")
        return None


def run(
    db_path: str = DEFAULT_DB_PATH,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    model: str = "gpt-4o-mini",
    situation_id: Optional[int] = None,
    force: bool = False,
    max_scenarios: int = MAX_SCENARIOS_PER_RUN,
) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[conviction] schema_version mismatch")

    where = "1=1"
    params: list = []
    if situation_id is not None:
        where += " AND ms.id = ?"
        params.append(situation_id)

    scenarios = conn.execute(
        f"""
        SELECT ms.id, ms.title, ms.summary, ms.scenario_type, ms.primary_theme,
               ms.status, ms.detection_path, ms.time_horizon,
               ms.signal_strength, ms.confidence_score,
               ms.evidence_count, ms.conviction_layer_json, ms.conviction_pack_hash,
               ms.first_order_effects_json, ms.second_order_effects_json,
               ms.validity_flags_json
        FROM market_situations ms
        WHERE {where}
          AND ms.status NOT IN ('ARCHIVED', 'INVALIDATED')
          AND ms.evidence_count >= {MIN_EVIDENCE}
        ORDER BY ms.evidence_count DESC, ms.id DESC
        LIMIT ?
        """,
        params + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[conviction] {len(scenarios)} eligible scenarios")

    produced = 0
    cached = 0
    failed = 0
    flagged = 0

    for row in scenarios:
        sid = int(row["id"])

        evidence_rows = conn.execute(
            """
            SELECT id, source_name, headline_or_label, summary
            FROM situation_evidence
            WHERE situation_id = ?
            ORDER BY published_at DESC LIMIT 20
            """,
            (sid,),
        ).fetchall()
        evidence_rows = [dict(e) for e in evidence_rows]

        exposure_rows = conn.execute(
            """
            SELECT id, universe_symbol, exposure_direction, composite_rank,
                   asset_type, asset_key
            FROM situation_exposure
            WHERE situation_id = ? AND universe_symbol IS NOT NULL
            ORDER BY composite_rank DESC LIMIT 20
            """,
            (sid,),
        ).fetchall()
        exposure_rows = [dict(e) for e in exposure_rows]

        pack_hash = _compute_pack_hash(evidence_rows, exposure_rows)

        if not force and row["conviction_pack_hash"] == pack_hash:
            cached += 1
            if verbose:
                print(f"  id={sid} CACHED (hash={pack_hash})")
            continue

        first_order = []
        try:
            first_order = json.loads(row["first_order_effects_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            pass
        second_order = []
        try:
            second_order = json.loads(row["second_order_effects_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            pass
        validity_flags = []
        try:
            validity_flags = json.loads(row["validity_flags_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            pass

        top_candidates = [
            {"symbol": e["universe_symbol"], "composite_rank": e["composite_rank"] or 0,
             "exposure_direction": e["exposure_direction"]}
            for e in exposure_rows if e["universe_symbol"]
        ]

        title = (row["title"] or "")[:50]
        if verbose:
            print(f"  id={sid} evidence={len(evidence_rows)} exposure={len(exposure_rows)} | {title}")

        if dry_run:
            produced += 1
            continue

        result = call_openai_conviction(
            dict(row), evidence_rows, first_order, second_order,
            top_candidates, validity_flags, model=model,
        )
        if result is None:
            failed += 1
            continue

        valid_tickers = {e["universe_symbol"] for e in exposure_rows if e["universe_symbol"]}
        valid_evidence_ids = {e["id"] for e in evidence_rows}

        error = _validate_conviction(result, valid_tickers, valid_evidence_ids)
        if error:
            if verbose:
                print(f"    VALIDATION FAILED: {error} — retrying...")
            result = call_openai_conviction(
                dict(row), evidence_rows, first_order, second_order,
                top_candidates, validity_flags, model=model,
            )
            if result:
                error = _validate_conviction(result, valid_tickers, valid_evidence_ids)

            if error or result is None:
                if verbose:
                    print(f"    RETRY FAILED: {error}")
                flags = validity_flags[:]
                if "CONVICTION_LAYER_UNRELIABLE" not in flags:
                    flags.append("CONVICTION_LAYER_UNRELIABLE")
                conn.execute(
                    "UPDATE market_situations SET validity_flags_json = ? WHERE id = ?",
                    (json.dumps(flags), sid),
                )
                flagged += 1
                failed += 1
                continue

        conviction_json = {
            "thesis_summary": result["thesis_summary"],
            "why_now": result["why_now"],
            "what_breaks_it": result["what_breaks_it"],
            "expression_notes": result["expression_notes"],
            "generated_at": int(time.time()),
            "prompt_template_version": "v1",
            "cited_evidence_ids": result.get("cited_evidence_ids", []),
            "confirming_signals": result.get("confirming_signals", []),
            "invalidating_signals": result.get("invalidating_signals", []),
            "key_risks": result.get("key_risks", []),
            "best_expression_assets": result.get("best_expression_assets", []),
        }

        conn.execute(
            """
            UPDATE market_situations SET
                conviction_layer_json = ?,
                conviction_pack_hash = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(conviction_json), pack_hash, int(time.time()), sid),
        )
        produced += 1

        if verbose:
            best = result.get("best_expression_assets", [])
            print(f"    OK -> best_expression: {best}")

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "produced": produced,
        "cached": cached,
        "failed": failed,
        "flagged_unreliable": flagged,
        "dry_run": dry_run,
    }
    print(f"[conviction] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Conviction-layer producer (D3, D16)")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--model", default="gpt-4o-mini")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--force", action="store_true",
                        help="Regenerate even if cache hash matches")
    parser.add_argument("--max-scenarios", type=int, default=MAX_SCENARIOS_PER_RUN)
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        model=args.model,
        situation_id=args.situation_id,
        force=args.force,
        max_scenarios=args.max_scenarios,
    )
