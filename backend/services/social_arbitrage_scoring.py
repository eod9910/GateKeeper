"""Social Arbitrage scoring profile (D27).

Implements the Social Arbitrage profile of `scenario_score`:

    scenario_score =
      ( 0.40 * attention_score +
        0.20 * market_confirmation_score +
        0.15 * event_score +              # CORROBORATING (mixed_anomaly_led only)
        0.15 * source_breadth_score +
        0.10 * novelty_score )
      * coverage_edge_multiplier          # 1.5 / 1.2 / 1.0 / 0.4 by tier
      * authenticity_multiplier           # 1.0 / 0.85 / 0.65 / 0.0 by band
      - crowding_penalty
      - validity_penalty

Used by `promote_emerging_topics.py` to replace the previous "uniform" path
(`signal_strength = round(confidence * 100)`) which gave a `mega_covered` /
`authenticity_borderline` topic the same surfacing rank as a `barely_covered`
/ `clean` topic — the literal opposite of what the engine is supposed to do.

# What this module DOES
  * Compute attention_score from the emerging-topic columns we already have
    (peak_z, cross_platform_corroboration, mention_count). Falls back to a
    cheap heuristic when the rich derivation inputs aren't available yet
    (unique_authors / attention_acceleration columns ship with the conviction
    layer).
  * Look up the primary candidate's coverage_tier from `coverage_tiers` and
    derive the edge multiplier (D22).
  * Derive the authenticity multiplier from `emerging_topics.authenticity_score`
    (D23) AND emit the matching validity flag (`LIKELY_INAUTHENTIC` /
    `AUTHENTICITY_BORDERLINE`).
  * Compute the final `scenario_score` (0-100, scaled) and `confidence_score`
    (0-1, distinct from scenario_score per D5 / D27).
  * Emit a structured breakdown so the promoter can persist it in
    `metadata_json.scoring` for audit + UI inspection.

# What this module DOES NOT do
  * Compute `event_score` / `novelty_score` / `market_confirmation_score`
    properly. Those layers are filled by the Macro Engine + price-confirmation
    job (Phase 1.5+). For now they remain None — the dual-profile weights
    naturally tolerate missing layers because we re-normalize over the layers
    that ARE present.
  * Apply `MEGA_COVERAGE_PENALTY`. That flag fires when ALL top-3 candidates
    are mega-covered, which requires the conviction-layer producer (Phase 3).
    The single-ticker check we do here only flags the seeding ticker's tier
    via the edge multiplier itself.
  * Persist anything. The promoter owns the INSERT.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence


# D27 weights for the Social Arbitrage profile.
# attention is PRIMARY (0.40), market_confirmation contributes when price
# moves alongside the chatter, event/source_breadth/novelty are corroborating.
SOCIAL_ARB_WEIGHTS: Dict[str, float] = {
    "attention_score": 0.40,
    "market_confirmation_score": 0.20,
    "event_score": 0.15,
    "source_breadth_score": 0.15,
    "novelty_score": 0.10,
}

# D22 — coverage_tier → edge multiplier (Social Arbitrage profile only).
# `untradable` short-circuits to None and the promoter must skip the row.
COVERAGE_EDGE_MULTIPLIERS: Dict[str, Optional[float]] = {
    "barely_covered": 1.5,
    "lightly_covered": 1.2,
    "well_covered": 1.0,
    "mega_covered": 0.4,
    "untradable": None,
}

# D23 — authenticity_score band → multiplier + accompanying validity flag.
# Below 0.5 the multiplier collapses to 0 (the row should be suppressed by
# the promoter via LIKELY_INAUTHENTIC + suppression_reason on the topic).
AUTHENTICITY_BANDS = [
    (0.80, 1.00, None),
    (0.65, 0.80, 0.85),
    (0.50, 0.65, 0.65),     # also fires AUTHENTICITY_BORDERLINE
    (0.00, 0.50, 0.00),     # also fires LIKELY_INAUTHENTIC
]

DEFAULT_COVERAGE_TIER_WHEN_UNKNOWN = "lightly_covered"


# ---------------------------------------------------------------------------
# Result shape (the promoter writes these into the row + metadata_json)
# ---------------------------------------------------------------------------

@dataclass
class ScoringResult:
    scenario_score: float                      # 0-100, what we sort by
    confidence_score: float                    # 0-1, what we display as a pill
    signal_strength: int                       # 0-100, magnitude proxy

    attention_score: float                     # 0-1
    coverage_tier: Optional[str]               # cached on the row
    coverage_tier_source: str                  # "lookup" | "fallback"
    edge_multiplier: float
    authenticity_multiplier: float

    validity_flags: List[str] = field(default_factory=list)
    breakdown: Dict[str, object] = field(default_factory=dict)

    def to_metadata(self) -> Dict[str, object]:
        return {
            "profile": "social_arbitrage",
            "weights": SOCIAL_ARB_WEIGHTS,
            "scenario_score": self.scenario_score,
            "edge_multiplier": self.edge_multiplier,
            "authenticity_multiplier": self.authenticity_multiplier,
            "coverage_tier": self.coverage_tier,
            "coverage_tier_source": self.coverage_tier_source,
            "breakdown": self.breakdown,
        }


# ---------------------------------------------------------------------------
# Component computations
# ---------------------------------------------------------------------------

def compute_attention_score(
    *,
    peak_z: float,
    cross_platform: bool,
    mention_count: int,
    unique_authors: Optional[int] = None,
    attention_acceleration: Optional[float] = None,
    early_vs_mainstream_ratio: Optional[float] = None,
) -> float:
    """D27 attention_score formula, degraded to whatever inputs we have.

    PRD reference formula (full version, available once conviction-layer ships):

        attention_score = clamp(0, 1,
            0.50 * normalize(peak_z, range=[2.0, 6.0]) +
            0.20 * (1.0 if cross_platform else 0.0) +
            0.15 * normalize(unique_authors, range=[20, 500]) +
            0.10 * normalize(attention_acceleration, range=[0, 0.5]) +
            0.05 * (1.0 if early_vs_mainstream_ratio > 2.0 else 0.5)
        )

    For Phase 1 we only have peak_z, cross_platform and mention_count
    consistently. We re-normalize over the present terms so a 0.50-weighted
    peak_z signal doesn't get artificially capped at 0.50 just because the
    other terms are NULL.
    """
    parts: List[tuple[float, float]] = []  # (weight, value)
    parts.append((0.50, _normalize(peak_z, low=2.0, high=6.0)))
    parts.append((0.20, 1.0 if cross_platform else 0.0))

    if unique_authors is not None:
        parts.append((0.15, _normalize(float(unique_authors), low=20.0, high=500.0)))
    else:
        # mention_count is a coarse proxy for unique_authors when we don't
        # have author dedup yet (HN comments are roughly 1 author = 1 mention).
        parts.append((0.15, _normalize(float(mention_count), low=20.0, high=500.0)))

    if attention_acceleration is not None:
        parts.append((0.10, _normalize(attention_acceleration, low=0.0, high=0.5)))
    if early_vs_mainstream_ratio is not None:
        parts.append((0.05, 1.0 if early_vs_mainstream_ratio > 2.0 else 0.5))

    weight_sum = sum(w for w, _ in parts)
    if weight_sum <= 0:
        return 0.0
    weighted = sum(w * v for w, v in parts) / weight_sum
    return round(_clamp(weighted, 0.0, 1.0), 4)


def compute_coverage_edge(
    conn: sqlite3.Connection,
    tickers: Sequence[str],
) -> tuple[Optional[str], str, Optional[float]]:
    """Returns (coverage_tier, source, edge_multiplier).

    Strategy: pick the *most uncovered* tier across the ticker list (lowest
    composite_score). This favors the smallest, most uncovered name in a
    basket — which is the asymmetric edge the engine is designed for. If
    none of the tickers have a tier yet, fall back to `lightly_covered`
    (multiplier 1.2) so the score isn't zeroed; this is conservative and
    will be replaced once the weekly coverage refresh has populated the
    table.

    Returns multiplier=None for `untradable`, signaling the promoter must
    drop the row.
    """
    if not tickers:
        return (
            DEFAULT_COVERAGE_TIER_WHEN_UNKNOWN,
            "fallback",
            COVERAGE_EDGE_MULTIPLIERS[DEFAULT_COVERAGE_TIER_WHEN_UNKNOWN],
        )

    placeholders = ",".join("?" for _ in tickers)
    rows = conn.execute(
        f"""
        SELECT symbol, coverage_tier, composite_score
        FROM coverage_tiers
        WHERE symbol IN ({placeholders})
        """,
        list(tickers),
    ).fetchall()

    if not rows:
        return (
            DEFAULT_COVERAGE_TIER_WHEN_UNKNOWN,
            "fallback",
            COVERAGE_EDGE_MULTIPLIERS[DEFAULT_COVERAGE_TIER_WHEN_UNKNOWN],
        )

    # Most uncovered = lowest composite_score. Treat NULL composite_score as
    # +inf so it loses to any ranked row.
    rows_sorted = sorted(
        rows,
        key=lambda r: (r["composite_score"] if r["composite_score"] is not None else float("inf")),
    )
    primary = rows_sorted[0]
    tier = str(primary["coverage_tier"])
    return (tier, "lookup", COVERAGE_EDGE_MULTIPLIERS.get(tier))


def compute_authenticity(
    authenticity_score: Optional[float],
) -> tuple[float, List[str]]:
    """Returns (multiplier, validity_flags). Score below 0.5 returns (0.0,
    [LIKELY_INAUTHENTIC]) — the promoter should skip the row entirely (the
    authenticity_scorer also writes suppression_reason='LIKELY_INAUTHENTIC'
    on the source emerging_topic, which prevents it from ever being picked
    up again)."""
    if authenticity_score is None:
        # Treat unscored topics as borderline — better to surface w/ warning
        # than to silently drop.
        return (0.65, ["AUTHENTICITY_BORDERLINE"])

    score = float(authenticity_score)
    if score >= 0.80:
        return (1.0, [])
    if score >= 0.65:
        return (0.85, [])
    if score >= 0.50:
        return (0.65, ["AUTHENTICITY_BORDERLINE"])
    return (0.0, ["LIKELY_INAUTHENTIC"])


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------

def score_social_arbitrage(
    conn: sqlite3.Connection,
    *,
    peak_z: float,
    cross_platform: bool,
    mention_count: int,
    authenticity_score: Optional[float],
    tickers: Sequence[str],
    market_confirmation_score: Optional[float] = None,
    event_score: Optional[float] = None,
    novelty_score: Optional[float] = None,
    source_breadth_score: Optional[float] = None,
    crowding_penalty: float = 0.0,
    validity_penalty: float = 0.0,
) -> ScoringResult:
    """Full Social Arbitrage profile evaluator.

    Args we don't have yet (event_score/novelty_score/market_confirmation_score)
    are accepted as None and re-normalized out of the weight sum — that way
    a Phase 1 row with only attention_score gets a fair score instead of a
    structurally low one. As Phase 1.5 (Macro corroboration) and Phase 3
    (price confirmation) ship, the promoter will start passing real values
    and the weights will rebalance automatically.
    """
    attention = compute_attention_score(
        peak_z=peak_z,
        cross_platform=cross_platform,
        mention_count=mention_count,
    )

    if source_breadth_score is None:
        # Cheap proxy: # corroborating communities + 1 over 4 (saturates
        # quickly because Social Arb depth peaks ~3 communities). The promoter
        # was already doing this inline; we keep the contract.
        source_breadth_score = min(1.0, (1 + (1 if cross_platform else 0)) / 4.0)

    layer_values: Dict[str, Optional[float]] = {
        "attention_score": attention,
        "market_confirmation_score": market_confirmation_score,
        "event_score": event_score,
        "source_breadth_score": source_breadth_score,
        "novelty_score": novelty_score,
    }

    # Re-normalize weights over the layers actually present so a NULL layer
    # doesn't silently drag the score down.
    present = {k: v for k, v in layer_values.items() if v is not None}
    weight_sum_present = sum(SOCIAL_ARB_WEIGHTS[k] for k in present)
    if weight_sum_present <= 0:
        weighted_base = 0.0
    else:
        weighted_base = sum(
            SOCIAL_ARB_WEIGHTS[k] * float(v) for k, v in present.items()
        ) / weight_sum_present

    coverage_tier, coverage_source, edge_multiplier = compute_coverage_edge(
        conn, tickers
    )
    auth_multiplier, auth_flags = compute_authenticity(authenticity_score)

    # untradable → caller must skip; we still return the result for audit.
    if edge_multiplier is None:
        scenario_score_0_1 = 0.0
    else:
        scenario_score_0_1 = (
            weighted_base * float(edge_multiplier) * float(auth_multiplier)
            - float(crowding_penalty)
            - float(validity_penalty)
        )
    scenario_score_0_1 = _clamp(scenario_score_0_1, 0.0, 1.0)
    scenario_score_100 = round(scenario_score_0_1 * 100, 2)

    # confidence_score (0-1) is a separate concept from scenario_score (D5).
    # For now derive it from the un-multiplied weighted base (i.e., "how
    # confident are we in the underlying signal, before edge/auth scaling")
    # plus a small bonus for cross-platform corroboration.
    confidence = _clamp(weighted_base + (0.05 if cross_platform else 0.0), 0.0, 0.99)

    breakdown: Dict[str, object] = {
        "weights_used": {k: SOCIAL_ARB_WEIGHTS[k] for k in present},
        "renormalized_weight_sum": round(weight_sum_present, 4),
        "weighted_base": round(weighted_base, 4),
        "layers": {
            k: (round(float(v), 4) if v is not None else None)
            for k, v in layer_values.items()
        },
        "edge_multiplier": edge_multiplier if edge_multiplier is not None else 0.0,
        "authenticity_multiplier": auth_multiplier,
        "crowding_penalty": crowding_penalty,
        "validity_penalty": validity_penalty,
        "tickers_evaluated": list(tickers),
    }

    all_flags = list(auth_flags)
    if not tickers:
        all_flags.append("NO_PUBLIC_TICKER")

    return ScoringResult(
        scenario_score=scenario_score_100,
        confidence_score=round(confidence, 3),
        signal_strength=int(round(scenario_score_100)),
        attention_score=attention,
        coverage_tier=coverage_tier,
        coverage_tier_source=coverage_source,
        edge_multiplier=float(edge_multiplier) if edge_multiplier is not None else 0.0,
        authenticity_multiplier=auth_multiplier,
        validity_flags=all_flags,
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
