"""Authenticity Layer scorer for the Social Arbitrage engine.

PRD reference: market-intelligence-scenario-engine-prd-pdr.md → Authenticity Layer (D23).

This module is the v1 implementation of the Authenticity Layer — the gate
between `emerging_topics` (statistical anomalies) and `market_situations`
(operator-visible scenarios). Its job is to look at the raw posts behind
an emerging topic and decide: is this organic, or did someone orchestrate it?

# v1 scope (3 of 10 weighted signals + 1 hard-limit rule)

The full spec defines 10 weighted signals + 4 hard-limit rules. This v1
implements only the signals computable from the data we collect today
(`mi_raw_hits` populated by HN + 4chan collectors). The other 7 signals
need data we don't yet capture (HN karma, account age, embeddings, etc.)
or sources we haven't built (Discord, Bluesky, forums). They're declared
as "missing" in the audit so a re-score after those land naturally fills
them in.

Implemented:

  * `posting_cadence`           — burst-vs-distribution within the 48h
                                  window around the anomaly. Lower window
                                  concentration = higher organic score.
  * `cross_platform_signature`  — how many distinct communities mention
                                  the concept in the window. Single-platform
                                  signals look more orchestrated.
  * `account_history_diversity` — fraction of mentioning authors who also
                                  posted about *other* concepts in the last
                                  30 days. Single-purpose accounts are a
                                  pump signature.

Hard limit:

  * `HL_BURST_CONCENTRATION`    — ≥50% of mentions inside a single 4-hour
                                  rolling window forces score=0 +
                                  suppression_reason='LIKELY_INAUTHENTIC'.

Signals not yet computable (audited in `missing_signals`):

  * `account_age_distribution`  — needs HN profile fetch (not collected)
  * `account_quality`           — needs HN karma per author
  * `linguistic_similarity`     — needs embeddings
  * `promoter_co_occurrence`    — needs cross-emerging-topic author overlap
                                  (could be added next; deferred for v1)
  * `comment_depth`             — needs reply-tree from raw_payload_json
                                  (HN provides parent_id; partial)
  * `sentiment_shape`           — needs sentiment classifier
  * `mod_flag_rate`             — needs moderation events not stored

# Score formula

We renormalize over computed signals only:

    raw  = sum(value_i * weight_i)  for each computed signal i
    norm = raw / sum(weight_i)      so missing signals neither help nor hurt

The PRD's `clamp01(sum(value * weight))` formula assumes all 10 signals are
present. With 3 signals (weights 0.10 + 0.15 + 0.10 = 0.35), an unweighted
formula would cap any topic at 0.35 even if all signals scream "organic".
Renormalizing makes the v1 score behave the same on a pump-style burst
(rejected) and an organic spike (passed) as the v3 score will once all
signals are populated.

When a hard-limit rule fires, the renormalization is bypassed and the
score is forced to 0 + a `suppression_reason` is set on the topic.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WEIGHTS_PATH = ROOT / "backend" / "data" / "scenarios" / "authenticity-weights.json"

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# Window we pull raw hits from when scoring a topic. Wider than the score
# day so cadence + diversity computations have enough data to be stable.
WINDOW_BEFORE_SECS = 48 * 3600
WINDOW_AFTER_SECS = 12 * 3600

# Burst-window for cadence + HL_BURST_CONCENTRATION.
BURST_WINDOW_SECS = 4 * 3600

# Cross-platform signature parameters.
MIN_MENTIONS_PER_COMMUNITY_TO_COUNT = 3
TARGET_COMMUNITY_COUNT_FOR_FULL_SCORE = 4  # value=1 reached at >=4 communities

# Author-diversity window.
DIVERSITY_LOOKBACK_SECS = 30 * 24 * 3600


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class SignalResult:
    signal_type: str
    value: float
    weight: float
    notes: str = ""


@dataclass
class MissingSignal:
    signal_type: str
    weight: float
    reason: str


@dataclass
class ScoreResult:
    score: float
    computed_signals: List[SignalResult] = field(default_factory=list)
    missing_signals: List[MissingSignal] = field(default_factory=list)
    hard_limit_fired: Optional[str] = None
    suppression_reason: Optional[str] = None
    window_total_mentions: int = 0
    window_unique_authors: int = 0

    def to_audit_json(self) -> str:
        """Serialised form for emerging_topics.authenticity_signals_json."""
        return json.dumps({
            "score": round(self.score, 4),
            "computed_signals": [
                {"signal_type": s.signal_type, "value": round(s.value, 4),
                 "weight": s.weight, "notes": s.notes}
                for s in self.computed_signals
            ],
            "missing_signals": [
                {"signal_type": m.signal_type, "weight": m.weight, "reason": m.reason}
                for m in self.missing_signals
            ],
            "hard_limit_fired": self.hard_limit_fired,
            "suppression_reason": self.suppression_reason,
            "window_total_mentions": self.window_total_mentions,
            "window_unique_authors": self.window_unique_authors,
        }, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Weights config
# ---------------------------------------------------------------------------

def load_weights(path: Optional[Path] = None) -> Dict[str, Any]:
    p = path or DEFAULT_WEIGHTS_PATH
    return json.loads(p.read_text(encoding="utf-8"))


def _weight_for(weights: Dict[str, Any], signal_type: str) -> float:
    for s in weights.get("weighted_signals", []):
        if s.get("signal_type") == signal_type:
            return float(s.get("weight", 0.0))
    return 0.0


# ---------------------------------------------------------------------------
# Raw-hit pull
# ---------------------------------------------------------------------------

def _fetch_window_hits(
    conn: sqlite3.Connection, concept_id: int, anchor_ts: int
) -> List[sqlite3.Row]:
    """All raw hits for the concept in the [anchor-48h, anchor+12h] window.

    Filter on `matched_concept_ids_json` containing the concept id. The column
    is JSON like `"[6]"` or `"[6, 7]"`; `json_each` is the correct filter so
    we don't false-match on substrings (e.g. concept_id=6 matching `"[16]"`).
    """
    start = anchor_ts - WINDOW_BEFORE_SECS
    end = anchor_ts + WINDOW_AFTER_SECS
    return conn.execute(
        """
        SELECT id, source_community, author, posted_at, source_type
        FROM mi_raw_hits
        WHERE posted_at BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM json_each(mi_raw_hits.matched_concept_ids_json)
            WHERE json_each.value = ?
          )
        """,
        (start, end, concept_id),
    ).fetchall()


# ---------------------------------------------------------------------------
# Signal computers
# ---------------------------------------------------------------------------

def _compute_posting_cadence(
    hits: Sequence[sqlite3.Row],
) -> Tuple[float, str, int, float]:
    """Returns (value, notes, max_window_mentions, max_window_share).

    Scans every 4-hour window starting at each post timestamp; finds the
    window with the most posts; reports its share of the total. Lower share =
    more spread out = more organic = higher value.

      value = clamp01(1 - (max_share - baseline_share) / (1 - baseline_share))

    where baseline_share = BURST_WINDOW_SECS / total_observed_span. This
    rewards spans much wider than the burst window (organic) without
    penalizing topics whose total span happens to be ~4h (could be early-
    detection noise).
    """
    if not hits:
        return 0.5, "no posts in window", 0, 0.0

    timestamps = sorted(int(h["posted_at"]) for h in hits)
    n = len(timestamps)
    if n < 2:
        return 0.5, f"only {n} post in window — insufficient signal", n, 1.0

    span = max(1, timestamps[-1] - timestamps[0])
    baseline_share = min(1.0, BURST_WINDOW_SECS / span)

    # Sliding window: for each post i, how many posts fall in [t_i, t_i + 4h]?
    max_count = 0
    j = 0
    for i in range(n):
        if j < i:
            j = i
        while j + 1 < n and timestamps[j + 1] - timestamps[i] <= BURST_WINDOW_SECS:
            j += 1
        cnt = j - i + 1
        if cnt > max_count:
            max_count = cnt

    max_share = max_count / n
    if baseline_share >= 1.0:
        # Span is shorter than burst window — can't differentiate
        return 0.5, f"observed span ({span}s) shorter than 4h burst window — neutral", max_count, max_share

    excess = max(0.0, max_share - baseline_share)
    value = max(0.0, min(1.0, 1.0 - excess / (1.0 - baseline_share)))
    notes = (f"max 4h burst held {max_count}/{n} mentions "
             f"({max_share:.0%}, baseline {baseline_share:.0%})")
    return value, notes, max_count, max_share


def _compute_cross_platform_signature(
    hits: Sequence[sqlite3.Row],
) -> Tuple[float, str]:
    """Returns (value, notes).

    Counts distinct `source_community` values that have at least
    MIN_MENTIONS_PER_COMMUNITY_TO_COUNT mentions in the window. Maps to:

      0 communities -> n/a (no posts)
      1 community   -> 0.0  (single-platform, suspicious)
      2 communities -> 0.33
      3 communities -> 0.67
      4+ communities-> 1.0  (organic spread)

    This signal is gated by collector count: with only HN + 4chan online
    today, the max realistic value is 0.33. That's intentional — adding
    Bluesky/Discord/forums lifts the ceiling without changing the formula.
    """
    by_community: Dict[str, int] = {}
    for h in hits:
        c = str(h["source_community"] or "")
        if not c:
            continue
        by_community[c] = by_community.get(c, 0) + 1

    qualifying = [c for c, n in by_community.items() if n >= MIN_MENTIONS_PER_COMMUNITY_TO_COUNT]
    if not qualifying:
        # Treat as single-platform if any community present at all, else neutral.
        if by_community:
            return 0.0, f"only 1 community with mentions ({list(by_community)})"
        return 0.5, "no community data"

    k = len(qualifying)
    denom = max(1, TARGET_COMMUNITY_COUNT_FOR_FULL_SCORE - 1)
    value = max(0.0, min(1.0, (k - 1) / denom))
    breakdown = ", ".join(f"{c}={by_community[c]}" for c in sorted(by_community, key=by_community.get, reverse=True))
    return value, f"{k} qualifying communities (>= {MIN_MENTIONS_PER_COMMUNITY_TO_COUNT} mentions): {breakdown}"


def _compute_account_history_diversity(
    conn: sqlite3.Connection, hits: Sequence[sqlite3.Row], anchor_ts: int, this_concept_id: int
) -> Tuple[float, str]:
    """Returns (value, notes).

    For each named author appearing in the window, look at their `mi_raw_hits`
    activity across ALL concepts in the last 30 days. An author is "diverse"
    if they show up in ≥2 distinct concepts; "single-purpose" if they only
    appear under this concept. Higher diverse-fraction = more organic.

    Anonymous authors (4chan) are excluded from the denominator since the
    signal is meaningless for them. If <3 named authors are present at all,
    we mark the signal as inconclusive (return value=0.5 + a note) rather
    than letting tiny populations drive the score.
    """
    named_authors: List[str] = []
    seen: set[str] = set()
    for h in hits:
        a = (h["author"] or "").strip()
        if not a or a.lower() in {"anonymous", "anon"}:
            continue
        if a in seen:
            continue
        seen.add(a)
        named_authors.append(a)

    n_named = len(named_authors)
    if n_named < 3:
        return 0.5, f"only {n_named} named authors — inconclusive"

    lookback_start = anchor_ts - DIVERSITY_LOOKBACK_SECS
    placeholders = ",".join("?" for _ in named_authors)
    query = f"""
        SELECT author, COUNT(DISTINCT json_each.value) AS distinct_concepts
        FROM mi_raw_hits, json_each(mi_raw_hits.matched_concept_ids_json)
        WHERE author IN ({placeholders})
          AND posted_at >= ?
        GROUP BY author
    """
    params = list(named_authors) + [lookback_start]
    diverse = 0
    rows = conn.execute(query, params).fetchall()
    counts_by_author = {r["author"]: int(r["distinct_concepts"]) for r in rows}
    for author in named_authors:
        if counts_by_author.get(author, 1) >= 2:
            diverse += 1

    value = diverse / n_named if n_named > 0 else 0.5
    notes = (f"{diverse}/{n_named} named authors posted across >=2 concepts "
             f"in last 30 days")
    return value, notes


# ---------------------------------------------------------------------------
# Hard-limit checks
# ---------------------------------------------------------------------------

def _check_hl_burst_concentration(
    max_window_share: float, total: int
) -> Optional[str]:
    """HL_BURST_CONCENTRATION: ≥50% of mentions in a 4h window.

    Only applies when total mentions >= 10 — below that, the signal is too
    noisy for the rule to be meaningful (5/8 in 4h could be a slow news day).
    """
    if total < 10:
        return None
    if max_window_share >= 0.5:
        return "HL_BURST_CONCENTRATION"
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

NOT_YET_IMPLEMENTED_REASON = "not_yet_implemented_v1"


def score_topic(
    conn: sqlite3.Connection,
    topic: sqlite3.Row,
    *,
    weights: Optional[Dict[str, Any]] = None,
) -> ScoreResult:
    """Compute the authenticity score for one emerging topic.

    `topic` must expose `concept_id`, `last_anomaly_at`, `total_mentions`,
    `unique_authors`. The function does not write to the DB; the caller is
    responsible for persisting `ScoreResult` and committing.
    """
    weights = weights or load_weights()
    concept_id = int(topic["concept_id"])
    anchor_ts = int(topic["last_anomaly_at"])

    hits = _fetch_window_hits(conn, concept_id, anchor_ts)

    cadence_value, cadence_notes, max_window_count, max_window_share = (
        _compute_posting_cadence(hits)
    )
    cross_value, cross_notes = _compute_cross_platform_signature(hits)
    diversity_value, diversity_notes = _compute_account_history_diversity(
        conn, hits, anchor_ts, concept_id
    )

    computed = [
        SignalResult(
            "posting_cadence",
            cadence_value,
            _weight_for(weights, "posting_cadence"),
            cadence_notes,
        ),
        SignalResult(
            "cross_platform_signature",
            cross_value,
            _weight_for(weights, "cross_platform_signature"),
            cross_notes,
        ),
        SignalResult(
            "account_history_diversity",
            diversity_value,
            _weight_for(weights, "account_history_diversity"),
            diversity_notes,
        ),
    ]
    missing = [
        MissingSignal(s["signal_type"], float(s["weight"]), NOT_YET_IMPLEMENTED_REASON)
        for s in weights.get("weighted_signals", [])
        if s.get("signal_type") not in {c.signal_type for c in computed}
    ]

    hl = _check_hl_burst_concentration(max_window_share, len(hits))
    if hl is not None:
        return ScoreResult(
            score=0.0,
            computed_signals=computed,
            missing_signals=missing,
            hard_limit_fired=hl,
            suppression_reason="LIKELY_INAUTHENTIC",
            window_total_mentions=len(hits),
            window_unique_authors=len({(h["author"] or "").strip() for h in hits if (h["author"] or "").strip()}),
        )

    weight_sum = sum(s.weight for s in computed)
    if weight_sum <= 0:
        score = 0.5
    else:
        raw = sum(s.value * s.weight for s in computed)
        score = max(0.0, min(1.0, raw / weight_sum))

    return ScoreResult(
        score=score,
        computed_signals=computed,
        missing_signals=missing,
        hard_limit_fired=None,
        suppression_reason=None,
        window_total_mentions=len(hits),
        window_unique_authors=len({(h["author"] or "").strip() for h in hits if (h["author"] or "").strip()}),
    )


def persist_score(
    conn: sqlite3.Connection,
    topic_id: int,
    result: ScoreResult,
    *,
    as_of: int,
) -> None:
    """Write the per-signal audit rows + update the emerging_topics row.

    Caller is responsible for `conn.commit()`. We delete prior audit rows for
    this `(topic_id, as_of)` first so re-scoring is idempotent.
    """
    conn.execute(
        "DELETE FROM authenticity_signals WHERE emerging_topic_id = ? AND as_of = ?",
        (topic_id, as_of),
    )
    for s in result.computed_signals:
        conn.execute(
            """
            INSERT INTO authenticity_signals
                (emerging_topic_id, as_of, signal_type, signal_value, weight, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (topic_id, as_of, s.signal_type, s.value, s.weight, s.notes),
        )
    if result.hard_limit_fired:
        conn.execute(
            """
            UPDATE emerging_topics SET
                authenticity_score = ?,
                authenticity_signals_json = ?,
                suppression_reason = COALESCE(suppression_reason, ?),
                updated_at = ?
            WHERE id = ?
            """,
            (result.score, result.to_audit_json(), result.suppression_reason, as_of, topic_id),
        )
    else:
        conn.execute(
            """
            UPDATE emerging_topics SET
                authenticity_score = ?,
                authenticity_signals_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (result.score, result.to_audit_json(), as_of, topic_id),
        )
