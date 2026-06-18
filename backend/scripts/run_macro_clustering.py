#!/usr/bin/env python
"""Macro Engine clustering job (PRD D21 M3–M4).

Reads embedded macro hits from ``hit_embeddings``, clusters them by
cosine similarity (>= 0.78) + shared entity reconciliation (>= 1 common
entity_id), and writes or updates ``market_situations`` with
``detection_path = 'news_cluster'``.

Pipeline:
    hit_embeddings (embedding_json + entities_json)
        │
        │  for each unassigned hit:
        │    1. compute cosine sim against centroids of open scenarios
        │    2. check entity overlap
        │    3. if match → attach as signal + evidence
        │    4. if no match → seed new scenario
        │
        ▼
    market_situations (detection_path='news_cluster')
    + situation_signals (signal_type='news_event')
    + situation_evidence (evidence_type='article')

Usage:
    py backend/scripts/run_macro_clustering.py
    py backend/scripts/run_macro_clustering.py --dry-run --verbose
    py backend/scripts/run_macro_clustering.py --cosine-threshold 0.80

Flags:
    --cosine-threshold FLOAT   Cosine similarity threshold (default 0.78 per PRD D4)
    --min-shared-entities INT  Min shared entity_ids for cluster match (default 1)
    --max-age-days INT         Only match against scenarios younger than N days (default 30)
    --dry-run                  Compute clusters but do not write to DB
    --verbose                  Print matching details
    --db-path PATH             Override default DB location
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sqlite3
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
THEME_TAXONOMY_PATH = os.path.join(
    BACKEND_DIR, "data", "scenarios", "theme-taxonomy.json"
)

EXPECTED_SCHEMA_VERSION = 6
SCENARIO_SCHEMA_VERSION = 1

DAY_SECONDS = 86_400

# Entity-to-theme heuristic mapping.
# Keys are entity_id prefixes; values are lists of (pattern, theme_key).
ENTITY_THEME_RULES: List[Tuple[str, str]] = [
    ("COMMODITY:CL", "energy_supply"),
    ("COMMODITY:BZ", "energy_supply"),
    ("COMMODITY:NG", "energy_supply"),
    ("MACRO:RATES", "rates_higher"),
    ("MACRO:INFLATION", "inflation_rising"),
    ("MACRO:CPI", "inflation_rising"),
    ("MACRO:PCE", "inflation_rising"),
    ("MACRO:EMPLOYMENT", "consumer_strength"),
    ("MACRO:GDP", "consumer_strength"),
    ("MACRO:RECESSION", "consumer_weakness"),
    ("MACRO:TARIFF", "geopolitical_escalation_eu"),
    ("MACRO:SANCTIONS", "geopolitical_escalation_mideast"),
    ("MACRO:YIELDS", "rates_higher"),
    ("POLICY:FED", "rates_higher"),
    ("POLICY:FOMC", "rates_higher"),
    ("POLICY:ECB", "rates_higher"),
    ("COUNTRY:CN", "china_growth"),
    ("POLICY:AI_EXPORT_CONTROLS", "ai_capex_pullback"),
    ("POLICY:AI_MODEL_ACCESS_RESTRICTION", "ai_capex_pullback"),
    ("POLICY:FOREIGN_NATIONAL_ACCESS", "ai_capex_pullback"),
    ("POLICY:ACCESS_RESTRICTION", "ai_capex_pullback"),
    ("MODEL:FABLE", "ai_capex_pullback"),
    ("MODEL:MYTHOS", "ai_capex_pullback"),
    ("TECH:FRONTIER_AI_MODEL", "ai_capex_pullback"),
    ("COMPANY:ANTHROPIC", "ai_capex_pullback"),
    ("SECTOR:AI", "ai_capex_acceleration"),
    ("SECTOR:SEMIS", "semis_supply_shock"),
    ("SECTOR:DEFENSE", "defense_spending_up"),
    ("SECTOR:EV", "consumer_strength"),
    ("SECTOR:ENERGY", "energy_supply"),
    ("SECTOR:PHARMA", "healthcare_policy_change"),
    ("SECTOR:BIOTECH", "healthcare_policy_change"),
    ("SECTOR:HEALTHCARE", "healthcare_policy_change"),
    ("MACRO:HOUSING", "housing_demand_change"),
    ("COMMODITY:GC", "dollar_strength"),
    ("COMMODITY:SI", "dollar_strength"),
    ("COMMODITY:HG", "china_growth"),
    ("COMMODITY:CC", "commodity_supply_shock_softs"),
    ("COMMODITY:KC", "commodity_supply_shock_softs"),
    ("COMMODITY:SB", "commodity_supply_shock_softs"),
    ("TICKER:NVDA", "ai_capex_acceleration"),
    ("TICKER:AMD", "ai_capex_acceleration"),
    ("TICKER:INTC", "semis_supply_shock"),
    ("TICKER:TSMC", "semis_supply_shock"),
    ("TICKER:AVGO", "ai_capex_acceleration"),
    ("TICKER:MSFT", "ai_capex_acceleration"),
    ("TICKER:GOOGL", "ai_capex_acceleration"),
    ("TICKER:AMZN", "consumer_strength"),
    ("TICKER:AAPL", "consumer_strength"),
    ("TICKER:TSLA", "consumer_strength"),
    ("TICKER:META", "ai_capex_acceleration"),
    ("TICKER:BA", "defense_spending_up"),
    ("TICKER:LMT", "defense_spending_up"),
    ("TICKER:RTX", "defense_spending_up"),
    ("TICKER:XOM", "energy_supply"),
    ("TICKER:CVX", "energy_supply"),
    ("SECTOR:SOCIALMEDIA", "ai_capex_acceleration"),
    ("SECTOR:CRYPTO", "dollar_strength"),
    ("SECTOR:FINTECH", "rates_lower"),
    ("SECTOR:RETAIL", "consumer_strength"),
    ("SECTOR:HOUSING", "housing_demand_change"),
]

FRONTIER_AI_ACCESS_SHOCK_RE = re.compile(
    r"\b(anthropic|openai|frontier (?:ai )?model|fable|mythos|ai model)"
    r".{0,100}\b(export control|foreign access|foreign national|"
    r"access restriction|suspend access|halt foreign access|national security|"
    r"licen[cs]e|licen[cs]ing)\b"
    r"|"
    r"\b(export control|foreign access|foreign national|national security|"
    r"access restriction)\b.{0,100}\b(ai model|frontier (?:ai )?model|"
    r"anthropic|openai|fable|mythos)\b",
    re.IGNORECASE,
)

FRONTIER_AI_ACCESS_SHOCK_ENTITY_IDS: Set[str] = {
    "COMPANY:ANTHROPIC",
    "MODEL:FABLE",
    "MODEL:MYTHOS",
    "POLICY:AI_EXPORT_CONTROLS",
    "POLICY:AI_MODEL_ACCESS_RESTRICTION",
    "POLICY:FOREIGN_NATIONAL_ACCESS",
    "POLICY:NATIONAL_SECURITY",
    "SECTOR:AI",
    "TECH:FRONTIER_AI_MODEL",
}


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def centroid(embeddings: List[List[float]]) -> List[float]:
    if not embeddings:
        return []
    dim = len(embeddings[0])
    n = len(embeddings)
    result = [0.0] * dim
    for emb in embeddings:
        for i in range(dim):
            result[i] += emb[i]
    return [v / n for v in result]


def entity_overlap(a: Set[str], b: Set[str]) -> int:
    return len(a & b)


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def normalize_hit_entities_for_text(
    entities: Dict[str, Any],
    text: str,
) -> Dict[str, Any]:
    """Apply deterministic event enrichments to older embedded hit metadata."""
    normalized = dict(entities)
    entity_ids = set(normalized.get("entity_ids", []))
    tickers = [
        str(t).upper()
        for t in normalized.get("tickers", [])
        if str(t).strip()
    ]

    if "$AI" not in text:
        entity_ids.discard("TICKER:AI")
        tickers = [t for t in tickers if t != "AI"]

    if FRONTIER_AI_ACCESS_SHOCK_RE.search(text):
        entity_ids.update(FRONTIER_AI_ACCESS_SHOCK_ENTITY_IDS)

    normalized["entity_ids"] = sorted(entity_ids)
    normalized["tickers"] = sorted(set(tickers))
    return normalized


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(
            f"[macro-cluster] DB missing at {db_path}. "
            f"Run backend/scripts/build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(db_path, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 60000")
    return conn


def check_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    version = int(row["value"]) if row else 0
    if version < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[macro-cluster] schema_version={version}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )


def now_unix() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Scenario cache — open news_cluster scenarios with their embeddings
# ---------------------------------------------------------------------------

class OpenScenario:
    """An open Macro Engine scenario with cached centroid + entities."""

    def __init__(
        self,
        situation_id: int,
        slug: str,
        title: str,
        primary_theme: str,
        entity_ids: Set[str],
        embeddings: List[List[float]],
        evidence_count: int,
        hit_ids: Set[int],
    ):
        self.situation_id = situation_id
        self.slug = slug
        self.title = title
        self.primary_theme = primary_theme
        self.entity_ids = entity_ids
        self.embeddings = embeddings
        self._centroid: Optional[List[float]] = None
        self.evidence_count = evidence_count
        self.hit_ids = hit_ids

    @property
    def centroid(self) -> List[float]:
        if self._centroid is None:
            self._centroid = centroid(self.embeddings)
        return self._centroid

    def add_embedding(self, emb: List[float], entity_ids: Set[str], hit_id: int):
        self.embeddings.append(emb)
        self._centroid = None
        self.entity_ids |= entity_ids
        self.hit_ids.add(hit_id)
        self.evidence_count += 1


def load_open_scenarios(
    conn: sqlite3.Connection,
    max_age_days: int = 30,
) -> List[OpenScenario]:
    """Load open Macro Engine scenarios with their associated embeddings."""
    cutoff = now_unix() - max_age_days * DAY_SECONDS
    rows = conn.execute(
        """
        SELECT id, slug, title, primary_theme, evidence_count, metadata_json
        FROM market_situations
        WHERE detection_path IN ('news_cluster', 'mixed_news_led')
          AND status IN ('EARLY', 'DEVELOPING', 'CONFIRMED')
          AND created_at >= ?
        ORDER BY created_at DESC
        """,
        (cutoff,),
    ).fetchall()

    scenarios: List[OpenScenario] = []
    for r in rows:
        sit_id = int(r["id"])
        meta = json.loads(r["metadata_json"] or "{}")
        cached_entity_ids = set(meta.get("entity_ids", []))

        emb_rows = conn.execute(
            """
            SELECT e.embedding_json, e.entities_json, e.hit_id
            FROM hit_embeddings e
            JOIN situation_signals s ON s.source_id = 'hit:' || CAST(e.hit_id AS TEXT)
            WHERE s.situation_id = ?
            """,
            (sit_id,),
        ).fetchall()

        embeddings = []
        hit_ids: Set[int] = set()
        all_ent_ids: Set[str] = set(cached_entity_ids)
        for er in emb_rows:
            embeddings.append(json.loads(er["embedding_json"]))
            ents = json.loads(er["entities_json"])
            all_ent_ids.update(ents.get("entity_ids", []))
            hit_ids.add(int(er["hit_id"]))

        scenarios.append(OpenScenario(
            situation_id=sit_id,
            slug=str(r["slug"]),
            title=str(r["title"]),
            primary_theme=str(r["primary_theme"]),
            entity_ids=all_ent_ids,
            embeddings=embeddings,
            evidence_count=int(r["evidence_count"]),
            hit_ids=hit_ids,
        ))

    return scenarios


# ---------------------------------------------------------------------------
# Fetch unassigned embedded hits
# ---------------------------------------------------------------------------

def fetch_unassigned_hits(
    conn: sqlite3.Connection,
    scenarios: List[OpenScenario],
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Get embedded macro hits not yet attached to any scenario."""
    all_assigned = set()
    for sc in scenarios:
        all_assigned |= sc.hit_ids

    limit_clause = ""
    params: Tuple[Any, ...] = ()
    if limit is not None and limit > 0:
        limit_clause = "LIMIT ?"
        params = (int(limit),)

    rows = conn.execute(
        """
        SELECT e.hit_id, e.embedding_json, e.entities_json,
               h.title, h.body_text, h.source_type, h.source_community,
               h.source_url, h.posted_at
        FROM hit_embeddings e
        JOIN mi_raw_hits h ON h.id = e.hit_id
        LEFT JOIN situation_signals s
          ON s.source_type = h.source_type
         AND s.source_id = 'hit:' || CAST(e.hit_id AS TEXT)
        WHERE s.id IS NULL
        ORDER BY h.posted_at DESC
        """ + limit_clause,
        params,
    ).fetchall()

    result = []
    for r in rows:
        hid = int(r["hit_id"])
        if hid in all_assigned:
            continue
        result.append({
            "hit_id": hid,
            "embedding": json.loads(r["embedding_json"]),
            "entities": json.loads(r["entities_json"]),
            "title": r["title"] or "",
            "body_text": r["body_text"] or "",
            "source_type": r["source_type"],
            "source_community": r["source_community"],
            "source_url": r["source_url"],
            "posted_at": int(r["posted_at"]),
        })
    return result


# ---------------------------------------------------------------------------
# Theme inference from entities
# ---------------------------------------------------------------------------

def load_valid_themes(path: str = THEME_TAXONOMY_PATH) -> Set[str]:
    if not os.path.exists(path):
        return set()
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {t["theme_key"] for t in data.get("themes", [])}


def infer_theme(
    entity_ids: Set[str],
    valid_themes: Set[str],
    text: str = "",
) -> str:
    """Best-effort theme assignment from entity set."""
    if (
        "ai_capex_pullback" in valid_themes
        and FRONTIER_AI_ACCESS_SHOCK_RE.search(text)
    ):
        return "ai_capex_pullback"

    counts: Dict[str, int] = {}
    for eid in entity_ids:
        for pattern, theme in ENTITY_THEME_RULES:
            if eid == pattern or eid.startswith(pattern):
                if theme in valid_themes:
                    counts[theme] = counts.get(theme, 0) + 1

    if not counts:
        return "uncategorized"
    return max(counts, key=counts.get)


# ---------------------------------------------------------------------------
# Slug generation
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def make_slug(title: str, existing_slugs: Set[str]) -> str:
    base = _SLUG_RE.sub("_", title.lower().strip()).strip("_")[:60]
    if not base:
        base = "macro_cluster"
    slug = base
    counter = 2
    while slug in existing_slugs:
        slug = f"{base}_{counter}"
        counter += 1
    return slug


# ---------------------------------------------------------------------------
# Scenario creation / update
# ---------------------------------------------------------------------------

def create_scenario(
    conn: sqlite3.Connection,
    hit: Dict[str, Any],
    primary_theme: str,
    existing_slugs: Set[str],
    verbose: bool = False,
) -> OpenScenario:
    """Create a new news_cluster market_situation from a single seed hit."""
    now = now_unix()
    title = hit["title"][:200] if hit["title"] else "Macro cluster"
    summary = (hit["body_text"] or hit["title"] or "")[:500]
    entity_ids = set(hit["entities"].get("entity_ids", []))

    tickers = hit["entities"].get("tickers", [])
    scenario_type = (
        "single_company_catalyst" if len(tickers) == 1
        else "sector_rotation" if any(
            e.startswith("SECTOR:") for e in entity_ids
        )
        else "macro_regime_shift"
    )

    slug = make_slug(title, existing_slugs)
    existing_slugs.add(slug)

    metadata = {
        "entity_ids": sorted(entity_ids),
        "seed_hit_id": hit["hit_id"],
        "seed_source_type": hit["source_type"],
        "tickers": tickers,
    }
    validity_flags: List[str] = []
    signal_strength = 20
    confidence_score = 0.15
    confidence_level = "very_low"
    event_score = 0.2
    source_breadth_score = 0.1
    time_horizon = "days"
    if (
        primary_theme == "ai_capex_pullback"
        and FRONTIER_AI_ACCESS_SHOCK_RE.search(f"{title}\n{summary}")
    ):
        signal_strength = 72
        confidence_score = 0.58
        confidence_level = "medium"
        event_score = 0.8
        source_breadth_score = 0.35
        time_horizon = "weeks"
        validity_flags = [
            "POLICY_SHOCK",
            "VERIFY_PRIMARY_SOURCES",
            "REVERSAL_RISK_3_TO_7_DAYS",
        ]
        metadata["policy_shock_type"] = "frontier_ai_access_control"

    cur = conn.execute(
        """
        INSERT INTO market_situations (
            slug, title, summary, primary_theme, scenario_type,
            status, signal_strength, confidence_score, confidence_level,
            time_horizon,
            started_at, last_confirmed_at, last_updated_at, expires_at,
            event_score, attention_score, market_confirmation_score,
            crowding_score, source_breadth_score,
            evidence_count,
            first_order_effects_json, second_order_effects_json,
            validity_flags_json, confidence_reasons_json,
            conviction_layer_json, conviction_pack_hash,
            detection_path, seeded_emerging_topic_id, coverage_tier,
            authenticity_score, peak_z_score, cross_platform_corroboration,
            edge_multiplier, metadata_json,
            schema_version, created_at, updated_at, archived_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            'EARLY', ?, ?, ?,
            ?,
            ?, NULL, ?, NULL,
            ?, NULL, NULL,
            NULL, ?,
            1,
            NULL, NULL,
            ?, NULL,
            NULL, NULL,
            'news_cluster', NULL, NULL,
            NULL, NULL, 0,
            1.0, ?,
            ?, ?, ?, NULL
        )
        """,
        (
            slug, title, summary, primary_theme, scenario_type,
            signal_strength, confidence_score, confidence_level,
            time_horizon,
            hit["posted_at"], now,
            event_score, source_breadth_score,
            json.dumps(validity_flags) if validity_flags else None,
            json.dumps(metadata),
            SCENARIO_SCHEMA_VERSION, now, now,
        ),
    )
    situation_id = int(cur.lastrowid)

    # Seed signal
    conn.execute(
        """
        INSERT INTO situation_signals (
            situation_id, signal_type, source_type, source_id,
            entity, theme, score, weight,
            observed_at, ingested_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            situation_id,
            "news_event",
            hit["source_type"],
            f"hit:{hit['hit_id']}",
            ",".join(sorted(entity_ids)[:5]),
            primary_theme,
            0.5,
            1.0,
            hit["posted_at"],
            now,
            json.dumps({
                "hit_id": hit["hit_id"],
                "source_community": hit["source_community"],
                "entity_ids": sorted(entity_ids),
            }),
        ),
    )

    # Seed evidence
    conn.execute(
        """
        INSERT INTO situation_evidence (
            situation_id, evidence_type, source_name,
            headline_or_label, summary, url,
            published_at, importance_score, novelty_score,
            signal_id, payload_json
        ) VALUES (?, 'article', ?, ?, ?, ?, ?, 0.5, 1.0, NULL, NULL)
        """,
        (
            situation_id,
            hit["source_community"] or hit["source_type"],
            title[:300],
            summary[:500],
            hit.get("source_url"),
            hit["posted_at"],
        ),
    )

    if verbose:
        print(
            f"  [NEW] situation_id={situation_id} slug={slug} "
            f"theme={primary_theme} entities={len(entity_ids)}"
        )

    return OpenScenario(
        situation_id=situation_id,
        slug=slug,
        title=title,
        primary_theme=primary_theme,
        entity_ids=entity_ids,
        embeddings=[hit["embedding"]],
        evidence_count=1,
        hit_ids={hit["hit_id"]},
    )


def attach_to_scenario(
    conn: sqlite3.Connection,
    scenario: OpenScenario,
    hit: Dict[str, Any],
    cos_sim: float,
    shared_entities: int,
    verbose: bool = False,
) -> None:
    """Attach a hit to an existing scenario as additional evidence."""
    now = now_unix()
    entity_ids = set(hit["entities"].get("entity_ids", []))
    title = hit["title"][:200] if hit["title"] else ""
    signal_score = clamp01(cos_sim)

    conn.execute(
        """
        INSERT INTO situation_signals (
            situation_id, signal_type, source_type, source_id,
            entity, theme, score, weight,
            observed_at, ingested_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            scenario.situation_id,
            "news_event",
            hit["source_type"],
            f"hit:{hit['hit_id']}",
            ",".join(sorted(entity_ids)[:5]),
            scenario.primary_theme,
            signal_score,
            1.0,
            hit["posted_at"],
            now,
            json.dumps({
                "hit_id": hit["hit_id"],
                "cosine_similarity": round(cos_sim, 4),
                "shared_entities": shared_entities,
                "entity_ids": sorted(entity_ids),
            }),
        ),
    )

    conn.execute(
        """
        INSERT INTO situation_evidence (
            situation_id, evidence_type, source_name,
            headline_or_label, summary, url,
            published_at, importance_score, novelty_score,
            signal_id, payload_json
        ) VALUES (?, 'article', ?, ?, ?, ?, ?, ?, 0.5, NULL, NULL)
        """,
        (
            scenario.situation_id,
            hit["source_community"] or hit["source_type"],
            title[:300],
            (hit["body_text"] or title)[:500],
            hit.get("source_url"),
            hit["posted_at"],
            signal_score,
        ),
    )

    scenario.add_embedding(hit["embedding"], entity_ids, hit["hit_id"])

    # Update evidence count + timestamp on the scenario
    conn.execute(
        """
        UPDATE market_situations
        SET evidence_count = ?,
            last_updated_at = ?,
            metadata_json = ?
        WHERE id = ?
        """,
        (
            scenario.evidence_count,
            now,
            json.dumps({
                "entity_ids": sorted(scenario.entity_ids),
                "evidence_hit_ids": sorted(scenario.hit_ids),
            }),
            scenario.situation_id,
        ),
    )

    if verbose:
        print(
            f"  [ATTACH] hit_id={hit['hit_id']} -> situation_id={scenario.situation_id} "
            f"(cos={cos_sim:.3f}, shared={shared_entities}, "
            f"evidence_count={scenario.evidence_count})"
        )


# ---------------------------------------------------------------------------
# Main clustering
# ---------------------------------------------------------------------------

def cluster(
    db_path: str = DEFAULT_DB_PATH,
    cosine_threshold: float = 0.78,
    min_shared_entities: int = 1,
    max_age_days: int = 30,
    limit: int = 1000,
    commit_every: int = 100,
    dry_run: bool = False,
    verbose: bool = False,
) -> Dict[str, int]:
    conn = open_db(db_path)
    check_schema(conn)

    valid_themes = load_valid_themes()
    scenarios = load_open_scenarios(conn, max_age_days)
    hits = fetch_unassigned_hits(conn, scenarios, limit=limit)

    total = len(hits)
    if total == 0:
        print("[macro-cluster] No unassigned embedded hits to process.")
        conn.close()
        return {"new_scenarios": 0, "attached": 0, "skipped": 0}

    print(
        f"[macro-cluster] {total} unassigned hits, "
        f"{len(scenarios)} open scenarios, "
        f"cosine>={cosine_threshold}, shared_entities>={min_shared_entities}, "
        f"limit={limit or 'all'}, commit_every={commit_every}"
    )

    existing_slugs: Set[str] = set()
    slug_rows = conn.execute(
        "SELECT slug FROM market_situations"
    ).fetchall()
    for r in slug_rows:
        existing_slugs.add(str(r["slug"]))

    new_scenarios = 0
    attached = 0
    skipped = 0
    mutated_since_commit = 0

    for idx, hit in enumerate(hits, start=1):
        hit_embedding = hit["embedding"]
        hit["entities"] = normalize_hit_entities_for_text(
            hit["entities"],
            f"{hit['title']}\n{hit['body_text']}",
        )
        hit_entity_ids = set(hit["entities"].get("entity_ids", []))

        best_match: Optional[OpenScenario] = None
        best_cos = 0.0
        best_shared = 0

        for sc in scenarios:
            if not sc.embeddings:
                continue
            cos = cosine_similarity(hit_embedding, sc.centroid)
            shared = entity_overlap(hit_entity_ids, sc.entity_ids)

            if cos >= cosine_threshold and shared >= min_shared_entities:
                if cos > best_cos:
                    best_match = sc
                    best_cos = cos
                    best_shared = shared

        if best_match:
            if not dry_run:
                attach_to_scenario(
                    conn, best_match, hit, best_cos, best_shared, verbose
                )
            else:
                if verbose:
                    print(
                        f"  [DRY ATTACH] hit_id={hit['hit_id']} -> "
                        f"situation_id={best_match.situation_id} "
                        f"(cos={best_cos:.3f}, shared={best_shared})"
                    )
            attached += 1
            if not dry_run:
                mutated_since_commit += 1
        elif hit_entity_ids:
            MARKET_PREFIXES = (
                "COMMODITY:", "MACRO:", "POLICY:", "SECTOR:",
                "COUNTRY:", "TICKER:",
            )
            market_entities = [
                e for e in hit_entity_ids
                if any(e.startswith(p) for p in MARKET_PREFIXES)
            ]
            if len(hit_entity_ids) < 2 or not market_entities:
                skipped += 1
                if verbose:
                    print(
                        f"  [SKIP] hit_id={hit['hit_id']} - insufficient "
                        f"market relevance (entities={len(hit_entity_ids)}, "
                        f"market={len(market_entities)})"
                    )
                continue

            theme = infer_theme(
                hit_entity_ids,
                valid_themes,
                f"{hit['title']}\n{hit['body_text']}",
            )
            if theme == "uncategorized":
                skipped += 1
                if verbose:
                    print(
                        f"  [SKIP] hit_id={hit['hit_id']} - uncategorized "
                        f"(no entity-to-theme match)"
                    )
                continue
            if not dry_run:
                new_sc = create_scenario(
                    conn, hit, theme, existing_slugs, verbose
                )
                scenarios.append(new_sc)
            else:
                if verbose:
                    print(
                        f"  [DRY NEW] hit_id={hit['hit_id']} "
                        f"theme={theme} entities={sorted(hit_entity_ids)[:5]}"
                    )
            new_scenarios += 1
            if not dry_run:
                mutated_since_commit += 1
        else:
            skipped += 1
            if verbose:
                print(
                    f"  [SKIP] hit_id={hit['hit_id']} - no entities extracted"
                )

        if (
            not dry_run
            and commit_every > 0
            and mutated_since_commit >= commit_every
        ):
            conn.commit()
            mutated_since_commit = 0
            if verbose:
                print(f"  [COMMIT] processed={idx}/{total}")

    if not dry_run and mutated_since_commit > 0:
        conn.commit()

    conn.close()

    summary = {
        "new_scenarios": new_scenarios,
        "attached": attached,
        "skipped": skipped,
        "total_hits": total,
        "open_scenarios_after": len(scenarios),
    }
    print(f"\n[macro-cluster] Done. {json.dumps(summary)}")
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Macro Engine cluster matching (PRD D21 M3–M4)."
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--cosine-threshold", type=float, default=0.78,
        help="Cosine similarity threshold (default 0.78 per PRD D4)",
    )
    parser.add_argument(
        "--min-shared-entities", type=int, default=1,
        help="Minimum shared entity_ids for cluster match (default 1)",
    )
    parser.add_argument(
        "--max-age-days", type=int, default=30,
        help="Only match against scenarios younger than N days (default 30)",
    )
    parser.add_argument(
        "--limit", type=int, default=1000,
        help="Maximum unassigned embedded hits to process per run (0 = all).",
    )
    parser.add_argument(
        "--commit-every", type=int, default=100,
        help="Commit after this many scenario writes to reduce DB lock windows.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args(list(argv) if argv else None)

    cluster(
        db_path=args.db_path,
        cosine_threshold=args.cosine_threshold,
        min_shared_entities=args.min_shared_entities,
        max_age_days=args.max_age_days,
        limit=args.limit,
        commit_every=args.commit_every,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
