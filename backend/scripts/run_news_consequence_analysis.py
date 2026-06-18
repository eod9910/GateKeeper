#!/usr/bin/env python
"""LLM consequence-analysis pass for newly ingested Macro Engine scenarios.

This is the missing "so what?" layer between deterministic clustering and
portfolio-facing ranking. It asks an analyst model to reason through possible
market ramifications, then writes an auditable structured assessment into
market_situations.metadata_json and conservative score floors.

Usage:
    py backend/scripts/run_news_consequence_analysis.py --llm-provider openai
    py backend/scripts/run_news_consequence_analysis.py --dry-run --verbose
    py backend/scripts/run_news_consequence_analysis.py --situation-id 2606
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
DOTENV_PATH = os.path.join(BACKEND_DIR, ".env")

EXPECTED_SCHEMA_VERSION = 6
ANALYSIS_VERSION = "v2"

PROMPT = """You are a senior market intelligence analyst. Your job is not to summarize
the headline. Your job is to reason through second- and third-order market
consequences before they are obvious.

Do not rely on a narrow checklist. Build a scenario tree. For every material
claim, identify:
- who is directly constrained, enabled, enriched, impaired, or forced to change;
- who depends on those actors, tools, inputs, customers, workers, permissions,
  financing conditions, supply chains, or regulatory assumptions;
- which business workflows, revenue lines, cost structures, adoption curves,
  margins, hiring models, compliance obligations, capex plans, or valuation
  narratives break if the claim is true;
- whether restrictions apply by geography, citizenship/nationality, residency,
  employee status, contractor status, subsidiary location, customer location,
  data location, or end-user identity; do not assume "foreign" only means
  overseas customers;
- which second-order and third-order channels the market may be missing because
  they are not named in the headline;
- what must be verified before treating the scenario as tradable.

Explicitly look for access-control, permissioning, workforce, customer-eligibility,
platform-dependency, substitution, compliance, and chilling-effect branches when
the scenario involves regulation, national security, export controls, licensing,
technology restrictions, labor rules, capital controls, sanctions, or litigation.
If access depends on nationality, residency, clearance, employer, or location,
trace the effect on employees, contractors, vendors, subsidiaries, customers,
and internal tool rollouts separately.

SCENARIO:
Title: {title}
Summary: {summary}
Theme: {primary_theme}
Scenario Type: {scenario_type}
Detection Path: {detection_path}
Status: {status}
Current Signal Strength: {signal_strength}
Current Confidence: {confidence_score}
Existing Validity Flags: {validity_flags}

EVIDENCE:
{evidence_text}

CURRENT EXPOSURE / CANDIDATES:
{exposure_text}

Think like a portfolio strategist. Ask:
- If this is true and persists, what business models, valuations, capex plans,
  supply chains, workforce models, customer access, product roadmaps, or
  regulatory assumptions change?
- Who cannot use, sell, build, finance, deploy, hire, contract, import, export,
  insure, or rely on something they previously could?
- Are any blocked users inside otherwise-unblocked companies, and would that
  fragment internal workflows, AI-assisted productivity, engineering velocity,
  enterprise deployment value, or compliance operations?
- Which internal corporate workflows become impaired even if the company itself
  is not the direct subject of the headline?
- What obvious first-order trades might be crowded, and what second-order
  effects might matter more?
- What evidence would confirm this is a real regime change?
- What evidence would invalidate it quickly?
- How urgent is it?

Respond with ONLY valid JSON:
{{
  "market_moving": true,
  "importance_score": 0,
  "confidence": 0.0,
  "time_sensitivity": "intraday|days|weeks|months|structural",
  "headline_read": "one sentence",
  "core_thesis": "2-4 sentences on why this matters",
  "scenario_branches": ["branch the market may miss"],
  "dependency_chains": ["actor/input -> affected workflow -> financial impact"],
  "workflow_constraints": ["constrained workflow or user group"],
  "causal_chain": ["step 1", "step 2", "step 3"],
  "valuation_implications": ["implication 1", "implication 2"],
  "first_order_effects": ["effect 1", "effect 2"],
  "second_order_effects": ["effect 1", "effect 2"],
  "affected_tickers": ["TICKER"],
  "affected_sectors": ["sector"],
  "confirming_evidence": ["signal 1", "signal 2"],
  "invalidating_evidence": ["signal 1", "signal 2"],
  "key_assumptions": ["assumption 1", "assumption 2"],
  "risk_flags": ["flag"],
  "why_it_could_be_mispriced": "1-3 sentences"
}}

Calibrate importance_score:
- 90-100: systemic or immediate market-wide shock
- 75-89: major sector/theme repricing risk
- 60-74: important but narrower or less certain
- 40-59: watchlist only
- below 40: low immediate market importance
"""


def _load_dotenv() -> None:
    if not os.path.isfile(DOTENV_PATH):
        return
    with open(DOTENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()


def _json_loads(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _confidence_level(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.55:
        return "medium"
    if score >= 0.35:
        return "low"
    return "very_low"


def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(f"[consequence-analysis] DB missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    version = int(row["value"]) if row else 0
    if version < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[consequence-analysis] schema_version={version}; "
            f"expected >= {EXPECTED_SCHEMA_VERSION}"
        )
    return conn


def fetch_scenarios(
    conn: sqlite3.Connection,
    *,
    situation_id: Optional[int],
    limit: int,
    since_hours: int,
    force: bool,
) -> List[sqlite3.Row]:
    params: List[Any] = []
    where = """
        ms.detection_path IN ('news_cluster', 'mixed_news_led')
        AND ms.status IN ('EARLY', 'DEVELOPING', 'CONFIRMED')
        AND ms.evidence_count >= 1
    """
    if situation_id is not None:
        where += " AND ms.id = ?"
        params.append(situation_id)
    else:
        cutoff = int(time.time()) - max(1, since_hours) * 3600
        where += " AND ms.created_at >= ?"
        params.append(cutoff)
        if not force:
            where += """
                AND (
                    ms.metadata_json IS NULL
                    OR ms.metadata_json NOT LIKE '%"consequence_analysis"%'
                )
            """

    rows = conn.execute(
        f"""
        SELECT ms.id, ms.title, ms.summary, ms.primary_theme, ms.scenario_type,
               ms.detection_path, ms.status, ms.signal_strength,
               ms.confidence_score, ms.validity_flags_json, ms.metadata_json,
               ms.evidence_count
        FROM market_situations ms
        WHERE {where}
        ORDER BY ms.signal_strength DESC, ms.created_at DESC
        LIMIT ?
        """,
        params + [max(1, limit)],
    ).fetchall()
    return rows


def fetch_evidence(conn: sqlite3.Connection, situation_id: int) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, source_name, headline_or_label, summary, url, published_at,
               importance_score
        FROM situation_evidence
        WHERE situation_id = ?
        ORDER BY published_at DESC
        LIMIT 20
        """,
        (situation_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def fetch_exposure(conn: sqlite3.Connection, situation_id: int) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT universe_symbol, asset_type, asset_key, exposure_direction,
               exposure_order, exposure_strength, composite_rank, rationale
        FROM situation_exposure
        WHERE situation_id = ?
        ORDER BY composite_rank DESC NULLS LAST, exposure_order ASC,
                 exposure_strength DESC
        LIMIT 30
        """,
        (situation_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def build_prompt(
    scenario: sqlite3.Row,
    evidence_rows: List[Dict[str, Any]],
    exposure_rows: List[Dict[str, Any]],
) -> str:
    evidence_text = "\n".join(
        f"- [evidence_id={r.get('id')}] [{r.get('source_name')}] "
        f"{r.get('headline_or_label')}"
        + (f" -- {r.get('summary')}" if r.get("summary") else "")
        for r in evidence_rows
    ) or "(no evidence rows)"

    exposure_text = "\n".join(
        f"- {r.get('universe_symbol') or r.get('asset_key')} "
        f"({r.get('asset_type')}, {r.get('exposure_direction')}, "
        f"rank={r.get('composite_rank')})"
        for r in exposure_rows[:15]
    ) or "(no exposure mapped yet)"

    flags = _json_loads(scenario["validity_flags_json"], [])
    return PROMPT.format(
        title=scenario["title"] or "",
        summary=scenario["summary"] or "",
        primary_theme=scenario["primary_theme"] or "",
        scenario_type=scenario["scenario_type"] or "",
        detection_path=scenario["detection_path"] or "",
        status=scenario["status"] or "",
        signal_strength=scenario["signal_strength"] or 0,
        confidence_score=scenario["confidence_score"] or 0,
        validity_flags=", ".join(flags) if flags else "(none)",
        evidence_text=evidence_text,
        exposure_text=exposure_text,
    )


def call_openai(prompt: str, *, model: str) -> Optional[Dict[str, Any]]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[consequence-analysis] WARNING: No OPENAI_API_KEY found")
        return None
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.25,
        "max_tokens": 2800,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read())
        raw = body["choices"][0]["message"]["content"] or ""
        return json.loads(raw)
    except Exception as exc:
        print(f"[consequence-analysis] OpenAI error: {exc}")
        return None


def mock_analysis(scenario: sqlite3.Row) -> Dict[str, Any]:
    flags = _json_loads(scenario["validity_flags_json"], [])
    policy_shock = "POLICY_SHOCK" in flags
    score = max(int(scenario["signal_strength"] or 0), 72 if policy_shock else 45)
    return {
        "market_moving": score >= 60,
        "importance_score": score,
        "confidence": max(float(scenario["confidence_score"] or 0), 0.58 if policy_shock else 0.35),
        "time_sensitivity": "weeks" if policy_shock else "days",
        "headline_read": str(scenario["title"] or "")[:180],
        "core_thesis": str(scenario["summary"] or scenario["title"] or "")[:500],
        "causal_chain": ["Initial evidence requires analyst review"],
        "valuation_implications": [],
        "first_order_effects": [],
        "second_order_effects": [],
        "affected_tickers": [],
        "affected_sectors": [],
        "confirming_evidence": ["Additional primary-source confirmation"],
        "invalidating_evidence": ["Policy reversal or clarification"],
        "key_assumptions": ["Headline remains materially true"],
        "risk_flags": ["MOCK_CONSEQUENCE_ANALYSIS"],
        "why_it_could_be_mispriced": "No LLM API key was available, so this is a conservative placeholder.",
    }


def validate_analysis(raw: Dict[str, Any]) -> Dict[str, Any]:
    score = int(round(_clamp(float(raw.get("importance_score", 0)), 0, 100)))
    confidence = round(_clamp(float(raw.get("confidence", 0.0)), 0.0, 0.99), 3)
    market_moving = bool(raw.get("market_moving")) or score >= 60

    def str_list(name: str, limit: int = 8) -> List[str]:
        value = raw.get(name, [])
        if not isinstance(value, list):
            return []
        return [str(v).strip()[:240] for v in value if str(v).strip()][:limit]

    return {
        "market_moving": market_moving,
        "importance_score": score,
        "confidence": confidence,
        "time_sensitivity": str(raw.get("time_sensitivity", "days"))[:40],
        "headline_read": str(raw.get("headline_read", ""))[:400],
        "core_thesis": str(raw.get("core_thesis", ""))[:1200],
        "scenario_branches": str_list("scenario_branches", 10),
        "dependency_chains": str_list("dependency_chains", 10),
        "workflow_constraints": str_list("workflow_constraints", 10),
        "causal_chain": str_list("causal_chain"),
        "valuation_implications": str_list("valuation_implications"),
        "first_order_effects": str_list("first_order_effects"),
        "second_order_effects": str_list("second_order_effects"),
        "affected_tickers": [s.upper() for s in str_list("affected_tickers", 20)],
        "affected_sectors": str_list("affected_sectors", 12),
        "confirming_evidence": str_list("confirming_evidence"),
        "invalidating_evidence": str_list("invalidating_evidence"),
        "key_assumptions": str_list("key_assumptions"),
        "risk_flags": str_list("risk_flags"),
        "why_it_could_be_mispriced": str(raw.get("why_it_could_be_mispriced", ""))[:800],
    }


def apply_analysis(
    conn: sqlite3.Connection,
    scenario: sqlite3.Row,
    analysis: Dict[str, Any],
    *,
    model: str,
) -> None:
    sid = int(scenario["id"])
    now = int(time.time())
    meta = _json_loads(scenario["metadata_json"], {})
    if not isinstance(meta, dict):
        meta = {}
    meta["consequence_analysis"] = {
        **analysis,
        "generated_at": now,
        "analysis_version": ANALYSIS_VERSION,
        "model": model,
    }

    flags = _json_loads(scenario["validity_flags_json"], [])
    if not isinstance(flags, list):
        flags = []
    if "AI_CONSEQUENCE_ANALYSIS" not in flags:
        flags.append("AI_CONSEQUENCE_ANALYSIS")
    if analysis["market_moving"] and "POTENTIAL_MARKET_MOVING" not in flags:
        flags.append("POTENTIAL_MARKET_MOVING")

    old_signal = int(scenario["signal_strength"] or 0)
    old_conf = float(scenario["confidence_score"] or 0)
    next_signal = max(old_signal, int(analysis["importance_score"]))
    next_conf = max(old_conf, float(analysis["confidence"]))
    next_event = max(float(analysis["importance_score"]) / 100.0, 0.0)

    reasons = [
        analysis.get("core_thesis", ""),
        analysis.get("why_it_could_be_mispriced", ""),
        *analysis.get("scenario_branches", [])[:3],
        *analysis.get("dependency_chains", [])[:3],
        *analysis.get("workflow_constraints", [])[:3],
        *analysis.get("causal_chain", [])[:4],
    ]
    reasons = [str(r)[:500] for r in reasons if str(r).strip()]

    conn.execute(
        """
        UPDATE market_situations
        SET signal_strength = ?,
            confidence_score = ?,
            confidence_level = ?,
            event_score = MAX(COALESCE(event_score, 0), ?),
            validity_flags_json = ?,
            confidence_reasons_json = ?,
            metadata_json = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            next_signal,
            next_conf,
            _confidence_level(next_conf),
            next_event,
            json.dumps(sorted(set(str(f) for f in flags))),
            json.dumps(reasons),
            json.dumps(meta),
            now,
            sid,
        ),
    )


def run(
    *,
    db_path: str,
    dry_run: bool,
    verbose: bool,
    situation_id: Optional[int],
    limit: int,
    since_hours: int,
    force: bool,
    llm_provider: str,
    model: str,
) -> Dict[str, Any]:
    conn = open_db(db_path)
    try:
        scenarios = fetch_scenarios(
            conn,
            situation_id=situation_id,
            limit=limit,
            since_hours=since_hours,
            force=force,
        )
        analyzed = 0
        failed = 0
        for scenario in scenarios:
            sid = int(scenario["id"])
            evidence = fetch_evidence(conn, sid)
            exposure = fetch_exposure(conn, sid)
            prompt = build_prompt(scenario, evidence, exposure)
            if llm_provider == "openai":
                raw = call_openai(prompt, model=model)
            else:
                raw = mock_analysis(scenario)
            if raw is None:
                failed += 1
                continue
            analysis = validate_analysis(raw)
            if verbose:
                title = str(scenario["title"] or "")[:70]
                print(
                    f"  id={sid} importance={analysis['importance_score']} "
                    f"conf={analysis['confidence']} market_moving={analysis['market_moving']} | {title}"
                )
                print(f"    thesis: {analysis['core_thesis'][:220]}")
            if not dry_run:
                apply_analysis(conn, scenario, analysis, model=model)
            analyzed += 1

        if not dry_run:
            conn.commit()
        summary = {
            "analyzed": analyzed,
            "failed": failed,
            "candidates": len(scenarios),
            "dry_run": dry_run,
            "llm_provider": llm_provider,
        }
        print(f"[consequence-analysis] Done. {json.dumps(summary)}")
        return summary
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze market consequences of new macro news")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--situation-id", type=int, default=None)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--since-hours", type=int, default=6)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--llm-provider", choices=["openai", "mock"], default="openai")
    parser.add_argument("--model", default=os.environ.get("MI_CONSEQUENCE_MODEL", "gpt-4o-mini"))
    args = parser.parse_args()
    run(
        db_path=args.db_path,
        dry_run=args.dry_run,
        verbose=args.verbose,
        situation_id=args.situation_id,
        limit=max(1, args.limit),
        since_hours=max(1, args.since_hours),
        force=args.force,
        llm_provider=args.llm_provider,
        model=args.model,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
