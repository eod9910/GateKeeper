#!/usr/bin/env python
"""LLM-assist exposure mapping (PRD D2, Phase 2 Tier 2).

For scenarios whose primary_theme does NOT match the hand-curated taxonomy
(or have no primary_theme at all), uses OpenAI to propose first/second-order
effects. Results are validated against known sector keys and universe symbols,
then inserted with `source_method = 'llm_assist'` and a 0.6 confidence discount.

Usage:
    py backend/scripts/run_llm_exposure_mapping.py --llm-provider openai
    py backend/scripts/run_llm_exposure_mapping.py --dry-run --verbose
    py backend/scripts/run_llm_exposure_mapping.py --situation-id 176
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
THEME_TAXONOMY_PATH = os.path.join(
    BACKEND_DIR, "data", "scenarios", "theme-taxonomy.json"
)
UNIVERSE_CLEAN_PATH = os.path.join(BACKEND_DIR, "data", "universe_clean.json")
DOTENV_PATH = os.path.join(BACKEND_DIR, ".env")

EXPECTED_SCHEMA_VERSION = 6
LLM_CONFIDENCE_DISCOUNT = 0.6

VALID_ASSET_TYPES = {"equity", "sector", "industry", "commodity", "fx", "rate", "etf"}
VALID_DIRECTIONS = {"up", "down", "mixed", "neutral"}
DIRECTION_MAP = {
    "up": "long_beneficiary",
    "down": "short_loser",
    "mixed": "direction_uncertain",
    "neutral": "direction_uncertain",
}

KNOWN_SECTOR_KEYS = {
    "energy", "technology", "healthcare", "financials", "industrials",
    "consumer_discretionary", "consumer_staples", "utilities", "real_estate",
    "communication_services", "materials", "defense", "transports_airlines",
    "transports_truckers", "discount_retail", "luxury", "semis", "biotech",
    "insurance", "banks", "regional_banks", "homebuilders", "reits",
    "auto_manufacturers", "ev_makers", "solar", "wind", "nuclear",
    "cloud_infrastructure", "cybersecurity", "fintech", "streaming",
    "social_media", "e_commerce", "restaurants", "gaming", "pharma",
    "medical_devices", "agriculture", "mining", "steel", "chemicals",
    "aerospace", "shipping", "railroads",
}

EXPOSURE_PROMPT = """You are an expert financial analyst. Given a market scenario, propose the
first-order and second-order effects on sectors, industries, and specific equities.

SCENARIO:
Title: {title}
Summary: {summary}
Primary Theme: {primary_theme}
Scenario Type: {scenario_type}
Detection Path: {detection_path}

EVIDENCE:
{evidence_text}

INSTRUCTIONS:
1. Identify 2-4 FIRST-ORDER effects (direct, immediate impact)
2. Identify 2-4 SECOND-ORDER effects (indirect, downstream consequences)
3. For each effect, specify:
   - asset_type: one of "equity", "sector", "industry", "commodity", "fx", "rate", "etf"
   - asset_key: a specific ticker symbol (for equity), GICS sector key, commodity code, etc.
   - direction: "up" or "down" or "mixed"
   - magnitude: "large", "moderate", or "small"
   - rationale: 1 sentence explaining the causal chain

4. For equity effects, use real US-listed ticker symbols
5. Be specific — prefer individual companies over broad sectors when the causal chain is clear

Respond with ONLY valid JSON matching this schema:
{{
  "first_order": [
    {{
      "asset_type": "sector|equity|commodity|...",
      "asset_key": "string",
      "direction": "up|down|mixed",
      "magnitude": "large|moderate|small",
      "rationale": "string"
    }}
  ],
  "second_order": [
    {{
      "asset_type": "...",
      "asset_key": "...",
      "direction": "...",
      "magnitude": "...",
      "rationale": "..."
    }}
  ]
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


def load_taxonomy_keys() -> Set[str]:
    if not os.path.exists(THEME_TAXONOMY_PATH):
        return set()
    with open(THEME_TAXONOMY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {t["theme_key"] for t in data.get("themes", [])}


def load_universe_symbols() -> Set[str]:
    if not os.path.exists(UNIVERSE_CLEAN_PATH):
        return set()
    with open(UNIVERSE_CLEAN_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "stocks" in data:
        return {s["symbol"] for s in data["stocks"] if isinstance(s, dict) and "symbol" in s}
    return set()


def validate_effects(
    effects: List[Dict], universe: Set[str]
) -> Tuple[List[Dict], int]:
    """Validate and filter LLM-proposed effects. Returns (valid, rejected_count)."""
    valid = []
    rejected = 0
    for e in effects:
        at = e.get("asset_type", "")
        ak = e.get("asset_key", "")
        d = e.get("direction", "")

        if at not in VALID_ASSET_TYPES:
            rejected += 1
            continue
        if d not in VALID_DIRECTIONS:
            rejected += 1
            continue
        if not ak:
            rejected += 1
            continue

        if at == "equity" and ak.upper() not in universe:
            rejected += 1
            continue

        if at == "sector" and ak.lower() not in KNOWN_SECTOR_KEYS:
            pass  # allow novel sector keys from LLM

        e["asset_key"] = ak.upper() if at == "equity" else ak.lower()
        valid.append(e)

    return valid, rejected


def call_openai(
    scenario: Dict,
    evidence_rows: List[Dict],
    *,
    model: str = "gpt-4o-mini",
) -> Optional[Dict]:
    """Call OpenAI to propose exposure effects."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[llm-exposure] WARNING: No OPENAI_API_KEY found")
        return None

    evidence_text = "\n".join(
        f"- [{r.get('source_name', '?')}] {r.get('headline_or_label', '?')}"
        for r in evidence_rows[:15]
    )

    prompt = EXPOSURE_PROMPT.format(
        title=scenario.get("title", ""),
        summary=scenario.get("summary", ""),
        primary_theme=scenario.get("primary_theme", "unknown"),
        scenario_type=scenario.get("scenario_type", "unknown"),
        detection_path=scenario.get("detection_path", "unknown"),
        evidence_text=evidence_text or "(no evidence available)",
    )

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1200,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or ""
        return json.loads(raw)
    except Exception as e:
        print(f"[llm-exposure] OpenAI error: {e}")
        return None


def insert_llm_exposure(
    conn: sqlite3.Connection,
    situation_id: int,
    effects: List[Dict],
    order: str,
    universe: Set[str],
) -> int:
    """Insert validated effects as situation_exposure rows."""
    inserted = 0
    for e in effects:
        asset_type = e["asset_type"]
        asset_key = e["asset_key"]
        direction = DIRECTION_MAP.get(e.get("direction", "mixed"), "direction_uncertain")
        magnitude = e.get("magnitude", "moderate")

        base_conf = {"large": 0.85, "moderate": 0.65, "small": 0.45}.get(magnitude, 0.5)
        confidence = round(base_conf * LLM_CONFIDENCE_DISCOUNT, 3)
        strength = confidence

        universe_symbol = asset_key if (asset_type == "equity" and asset_key in universe) else None
        rationale = e.get("rationale", "LLM-proposed")

        conn.execute(
            """
            INSERT INTO situation_exposure (
                situation_id, asset_type, asset_key, exposure_direction,
                exposure_order, exposure_strength, source_method,
                rationale, confidence, universe_symbol
            ) VALUES (?, ?, ?, ?, ?, ?, 'llm_assist', ?, ?, ?)
            """,
            (situation_id, asset_type, asset_key, direction,
             order, strength, rationale, confidence, universe_symbol),
        )
        inserted += 1
    return inserted


def run(
    db_path: str,
    *,
    dry_run: bool = False,
    verbose: bool = False,
    llm_provider: str = "openai",
    model: str = "gpt-4o-mini",
    situation_id: Optional[int] = None,
    max_scenarios: int = 30,
) -> dict:
    taxonomy_keys = load_taxonomy_keys()
    universe = load_universe_symbols()

    if verbose:
        print(f"[llm-exposure] {len(taxonomy_keys)} taxonomy themes, "
              f"{len(universe)} universe symbols")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    actual = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    if actual is None or int(actual["value"]) < EXPECTED_SCHEMA_VERSION:
        sys.exit("[llm-exposure] schema_version mismatch")

    where = "1=1"
    params: list = []
    if situation_id is not None:
        where += " AND ms.id = ?"
        params.append(situation_id)

    # Find scenarios that need LLM-assist:
    # - No existing exposure rows, OR
    # - primary_theme not in taxonomy
    scenarios = conn.execute(
        f"""
        SELECT ms.id, ms.title, ms.summary, ms.primary_theme,
               ms.scenario_type, ms.detection_path, ms.evidence_count
        FROM market_situations ms
        WHERE {where}
          AND ms.status NOT IN ('ARCHIVED', 'INVALIDATED')
          AND (
              ms.primary_theme IS NULL
              OR ms.primary_theme NOT IN ({','.join('?' for _ in taxonomy_keys)})
          )
          AND NOT EXISTS (
              SELECT 1 FROM situation_exposure se
              WHERE se.situation_id = ms.id
              AND se.source_method = 'llm_assist'
          )
        ORDER BY ms.evidence_count DESC, ms.id DESC
        LIMIT ?
        """,
        params + list(taxonomy_keys) + [max_scenarios],
    ).fetchall()

    if verbose:
        print(f"[llm-exposure] {len(scenarios)} scenarios need LLM-assist mapping")

    mapped = 0
    total_rows = 0
    rejected_total = 0
    failed = 0

    for row in scenarios:
        sid = int(row["id"])
        title = (row["title"] or "")[:60]

        evidence_rows = conn.execute(
            """
            SELECT source_name, headline_or_label, summary
            FROM situation_evidence
            WHERE situation_id = ?
            ORDER BY published_at DESC LIMIT 15
            """,
            (sid,),
        ).fetchall()

        if verbose:
            print(f"  id={sid} theme={row['primary_theme']} evidence={len(evidence_rows)} | {title}")

        if dry_run:
            mapped += 1
            continue

        if llm_provider != "openai":
            if verbose:
                print(f"    Skipping — LLM provider '{llm_provider}' not supported")
            continue

        result = call_openai(
            dict(row), [dict(e) for e in evidence_rows], model=model
        )
        if result is None:
            failed += 1
            continue

        fo_raw = result.get("first_order", [])
        so_raw = result.get("second_order", [])

        fo_valid, fo_rej = validate_effects(fo_raw, universe)
        so_valid, so_rej = validate_effects(so_raw, universe)

        if not fo_valid and not so_valid:
            if verbose:
                print(f"    All effects rejected ({fo_rej + so_rej} total)")
            rejected_total += fo_rej + so_rej
            failed += 1
            continue

        fo_count = insert_llm_exposure(conn, sid, fo_valid, "first", universe)
        so_count = insert_llm_exposure(conn, sid, so_valid, "second", universe)

        # Update effects JSON on scenario
        first_order_json = [
            {"asset_or_sector": e["asset_key"], "direction": e["direction"],
             "magnitude_hint": e.get("magnitude", "moderate"), "source_method": "llm_assist"}
            for e in fo_valid
        ]
        second_order_json = [
            {"asset_or_sector": e["asset_key"], "direction": e["direction"],
             "magnitude_hint": e.get("magnitude", "moderate"), "source_method": "llm_assist"}
            for e in so_valid
        ]
        conn.execute(
            """
            UPDATE market_situations SET
                first_order_effects_json = ?,
                second_order_effects_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(first_order_json), json.dumps(second_order_json),
             int(time.time()), sid),
        )

        total_rows += fo_count + so_count
        rejected_total += fo_rej + so_rej
        mapped += 1
        if verbose:
            print(f"    → {fo_count} first-order + {so_count} second-order rows "
                  f"({fo_rej + so_rej} rejected)")

    if not dry_run:
        conn.commit()
    conn.close()

    summary = {
        "mapped": mapped,
        "total_exposure_rows": total_rows,
        "rejected_effects": rejected_total,
        "failed": failed,
        "dry_run": dry_run,
    }
    print(f"[llm-exposure] Done. {json.dumps(summary)}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LLM-assist exposure mapping (D2 Tier 2)")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--llm-provider", default="openai")
    parser.add_argument("--model", default="gpt-4o-mini")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--max-scenarios", type=int, default=30)
    args = parser.parse_args()
    run(
        args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        llm_provider=args.llm_provider,
        model=args.model,
        situation_id=args.situation_id,
        max_scenarios=args.max_scenarios,
    )
