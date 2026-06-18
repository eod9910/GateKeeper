"""Macro Engine scoring profile (D27).

Implements the Macro Engine profile of `scenario_score`:

    scenario_score =
      ( 0.30 * event_score +
        0.25 * market_confirmation_score +
        0.20 * source_breadth_score +
        0.15 * attention_score +              # CORROBORATING (mixed_news_led only)
        0.10 * novelty_score )
      - crowding_penalty
      - validity_penalty

No `coverage_edge_multiplier` and no `authenticity_multiplier` — a Macro
scenario about energy supply correctly surfaces XOM and CVX (mega_covered)
without penalty; that IS the Macro Engine's job (D22, D25).

Consumed by `run_macro_clustering.py` when creating / rescoring scenarios,
and by any future "recompute all macro scores" sweep.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Dict, List, Optional


MACRO_WEIGHTS: Dict[str, float] = {
    "event_score": 0.30,
    "market_confirmation_score": 0.25,
    "source_breadth_score": 0.20,
    "attention_score": 0.15,
    "novelty_score": 0.10,
}


@dataclass
class MacroScoringResult:
    scenario_score: float           # 0-100
    confidence_score: float         # 0-1
    signal_strength: int            # 0-100 magnitude proxy

    event_score: float
    source_breadth_score: float
    evidence_count: int

    validity_flags: List[str] = field(default_factory=list)
    breakdown: Dict[str, object] = field(default_factory=dict)

    def to_metadata(self) -> Dict[str, object]:
        return {
            "profile": "macro",
            "weights": MACRO_WEIGHTS,
            "scenario_score": self.scenario_score,
            "breakdown": self.breakdown,
        }


# ---------------------------------------------------------------------------
# Component computations
# ---------------------------------------------------------------------------

def compute_event_score(
    *,
    evidence_count: int,
    distinct_source_types: int,
    has_fed_source: bool = False,
    has_econ_data: bool = False,
    avg_importance: float = 0.5,
) -> float:
    """Event score for macro scenarios.

    Approximation until the full conviction-layer ships (Phase 3). Combines
    evidence volume, source diversity, and presence of high-authority sources
    (Fed / economic data releases).
    """
    parts: list[tuple[float, float]] = []

    parts.append((0.35, _normalize(float(evidence_count), low=1.0, high=20.0)))
    parts.append((0.25, _normalize(float(distinct_source_types), low=1.0, high=5.0)))
    parts.append((0.20, 1.0 if has_fed_source else 0.0))
    parts.append((0.10, 1.0 if has_econ_data else 0.0))
    parts.append((0.10, _clamp(avg_importance, 0.0, 1.0)))

    weight_sum = sum(w for w, _ in parts)
    if weight_sum <= 0:
        return 0.0
    return round(_clamp(sum(w * v for w, v in parts) / weight_sum, 0.0, 1.0), 4)


def compute_source_breadth(
    *,
    distinct_source_types: int,
    distinct_communities: int,
) -> float:
    """Source breadth — how many independent channels corroborate the event.

    Caps at 5 source types and 8 communities. Even 3 distinct mainstream
    sources (e.g., Reuters + AP + Fed) is strong macro breadth.
    """
    type_score = _normalize(float(distinct_source_types), low=1.0, high=5.0)
    community_score = _normalize(float(distinct_communities), low=1.0, high=8.0)
    return round(_clamp(0.6 * type_score + 0.4 * community_score, 0.0, 1.0), 4)


def compute_novelty_from_evidence(
    conn: sqlite3.Connection,
    situation_id: int,
) -> float:
    """Simple novelty proxy: average novelty_score from situation_evidence."""
    row = conn.execute(
        "SELECT AVG(novelty_score) AS avg_n FROM situation_evidence "
        "WHERE situation_id = ?",
        (situation_id,),
    ).fetchone()
    if row and row["avg_n"] is not None:
        return round(_clamp(float(row["avg_n"]), 0.0, 1.0), 4)
    return 0.5  # neutral default


# ---------------------------------------------------------------------------
# Evidence introspection helpers
# ---------------------------------------------------------------------------

def _gather_evidence_stats(
    conn: sqlite3.Connection,
    situation_id: int,
) -> Dict:
    """Pull aggregate stats from situation_signals + situation_evidence."""
    evidence_row = conn.execute(
        "SELECT COUNT(*) AS cnt, AVG(importance_score) AS avg_imp "
        "FROM situation_evidence WHERE situation_id = ?",
        (situation_id,),
    ).fetchone()

    evidence_count = int(evidence_row["cnt"]) if evidence_row else 0
    avg_importance = float(evidence_row["avg_imp"]) if evidence_row and evidence_row["avg_imp"] is not None else 0.5

    signal_rows = conn.execute(
        "SELECT source_type, source_id FROM situation_signals "
        "WHERE situation_id = ?",
        (situation_id,),
    ).fetchall()

    source_types = set()
    communities = set()
    has_fed = False
    has_econ = False
    for sr in signal_rows:
        st = sr["source_type"] or ""
        source_types.add(st)
        # Derive community from source_id prefix (e.g. "reuters:xyz" → "reuters")
        sid = sr["source_id"] or ""
        community = sid.split(":")[0] if ":" in sid else st
        communities.add(community)
        if "federal_reserve" in st or "fed" in st.lower():
            has_fed = True
        if st.startswith("econ_"):
            has_econ = True

    return {
        "evidence_count": evidence_count,
        "avg_importance": avg_importance,
        "distinct_source_types": len(source_types),
        "distinct_communities": len(communities),
        "has_fed_source": has_fed,
        "has_econ_data": has_econ,
    }


def _gather_scenario_context(
    conn: sqlite3.Connection,
    situation_id: int,
) -> Dict:
    """Pull scenario-level flags/metadata used for importance floors."""
    row = conn.execute(
        """
        SELECT primary_theme, validity_flags_json, metadata_json
        FROM market_situations
        WHERE id = ?
        """,
        (situation_id,),
    ).fetchone()
    if not row:
        return {"primary_theme": "", "validity_flags": [], "metadata": {}}

    flags: List[str] = []
    metadata: Dict = {}
    try:
        parsed = json.loads(row["validity_flags_json"] or "[]")
        if isinstance(parsed, list):
            flags = [str(v) for v in parsed]
    except Exception:
        flags = []
    try:
        parsed_meta = json.loads(row["metadata_json"] or "{}")
        if isinstance(parsed_meta, dict):
            metadata = parsed_meta
    except Exception:
        metadata = {}

    return {
        "primary_theme": str(row["primary_theme"] or ""),
        "validity_flags": flags,
        "metadata": metadata,
    }


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------

def score_macro_scenario(
    conn: sqlite3.Connection,
    situation_id: int,
    *,
    market_confirmation_score: Optional[float] = None,
    attention_score: Optional[float] = None,
    novelty_score: Optional[float] = None,
    crowding_penalty: float = 0.0,
    validity_penalty: float = 0.0,
) -> MacroScoringResult:
    """Full Macro Engine profile evaluator (D27).

    Pulls evidence statistics from the DB to compute event_score and
    source_breadth_score. Layers not yet available (market_confirmation,
    attention, novelty) degrade gracefully via weight renormalization.
    """
    stats = _gather_evidence_stats(conn, situation_id)
    scenario_context = _gather_scenario_context(conn, situation_id)
    existing_flags = list(scenario_context["validity_flags"])
    is_policy_shock = (
        "POLICY_SHOCK" in existing_flags
        or bool(scenario_context["metadata"].get("policy_shock_type"))
    )

    event = compute_event_score(
        evidence_count=stats["evidence_count"],
        distinct_source_types=stats["distinct_source_types"],
        has_fed_source=stats["has_fed_source"],
        has_econ_data=stats["has_econ_data"],
        avg_importance=stats["avg_importance"],
    )

    source_breadth = compute_source_breadth(
        distinct_source_types=stats["distinct_source_types"],
        distinct_communities=stats["distinct_communities"],
    )
    if is_policy_shock:
        # A single Reuters/AP/official policy action can be market-moving before
        # source breadth exists. Do not bury it merely because it is early.
        event = max(event, 0.8)
        source_breadth = max(source_breadth, 0.35)

    if novelty_score is None:
        novelty_score = compute_novelty_from_evidence(conn, situation_id)

    layer_values: Dict[str, Optional[float]] = {
        "event_score": event,
        "market_confirmation_score": market_confirmation_score,
        "source_breadth_score": source_breadth,
        "attention_score": attention_score,
        "novelty_score": novelty_score,
    }

    present = {k: v for k, v in layer_values.items() if v is not None}
    weight_sum_present = sum(MACRO_WEIGHTS[k] for k in present)
    if weight_sum_present <= 0:
        weighted_base = 0.0
    else:
        weighted_base = sum(
            MACRO_WEIGHTS[k] * float(v) for k, v in present.items()
        ) / weight_sum_present

    scenario_score_0_1 = _clamp(
        weighted_base - crowding_penalty - validity_penalty,
        0.0, 1.0,
    )
    if is_policy_shock:
        scenario_score_0_1 = max(scenario_score_0_1, 0.72)
    scenario_score_100 = round(scenario_score_0_1 * 100, 2)

    # D25: Macro scenarios are evidence-backed. Confidence derives from
    # source diversity + evidence volume (how well-corroborated is this?),
    # not from authenticity or coverage tier.
    confidence = _clamp(
        0.10 + 0.50 * _normalize(float(stats["evidence_count"]), low=2.0, high=15.0)
             + 0.30 * _normalize(float(stats["distinct_source_types"]), low=1.0, high=4.0)
             + 0.10 * (1.0 if stats["has_fed_source"] or stats["has_econ_data"] else 0.0),
        0.0, 0.99,
    )
    if is_policy_shock:
        confidence = max(confidence, 0.58)

    # Signal strength (0-100): magnitude proxy based on event gravity.
    signal_strength = int(round(_clamp(
        event * 70 + source_breadth * 30, 0.0, 100.0
    )))
    if is_policy_shock:
        signal_strength = max(signal_strength, 72)

    validity_flags: List[str] = list(existing_flags)
    # D25: Macro scenarios need >=2 distinct mainstream sources to be
    # considered "evidence-backed".
    if stats["distinct_source_types"] < 2 and not is_policy_shock:
        validity_flags.append("INSUFFICIENT_SOURCE_DIVERSITY")
    validity_flags = sorted(set(validity_flags))

    breakdown: Dict[str, object] = {
        "weights_used": {k: MACRO_WEIGHTS[k] for k in present},
        "renormalized_weight_sum": round(weight_sum_present, 4),
        "weighted_base": round(weighted_base, 4),
        "layers": {
            k: (round(float(v), 4) if v is not None else None)
            for k, v in layer_values.items()
        },
        "evidence_stats": stats,
        "crowding_penalty": crowding_penalty,
        "validity_penalty": validity_penalty,
        "importance_floor": "policy_shock" if is_policy_shock else None,
    }

    return MacroScoringResult(
        scenario_score=scenario_score_100,
        confidence_score=round(confidence, 3),
        signal_strength=signal_strength,
        event_score=event,
        source_breadth_score=source_breadth,
        evidence_count=stats["evidence_count"],
        validity_flags=validity_flags,
        breakdown=breakdown,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _normalize(value: float, *, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return _clamp((value - low) / (high - low), 0.0, 1.0)
