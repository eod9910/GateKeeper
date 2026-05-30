#!/usr/bin/env python3
"""
Build first-pass asymmetric narrative clusters from emerging claims.

This is the v7 bridge from:

    emerging_claims -> narrative_clusters -> narrative_cluster_claims

The builder is intentionally deterministic. It groups claims by primary theme,
preserves raw-hit lineage, assigns WATCH / RESEARCH / SCENARIO_READY, and keeps
clusters auditable before any scenario promotion step exists.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 7

MAINSTREAM_SOURCE_TYPES = {
    "rss_ap",
    "rss_reuters",
    "rss_yahoo_finance",
    "youtube_transcript",
}

THEME_TITLES = {
    "ai_capex_acceleration": "AI infrastructure capex acceleration",
    "financial_tokenization": "Tokenized equities and 24-hour market structure",
    "quantum_computing_commercialization": "Quantum computing commercialization",
    "defense_ai_operating_system": "Defense AI operating systems",
    "ai_power_grid_bottleneck": "AI data-center power and grid bottleneck",
    "consumer_product_breakout": "Consumer product breakout signal",
    "single_company_social_perturbation": "Single-company social perturbation",
    "semis_supply_shock": "Semiconductor supply and export-control shock",
    "energy_supply": "Energy supply risk",
    "rates_higher": "Higher-for-longer rates pressure",
    "rates_lower": "Rate-cut expectation shift",
    "healthcare_policy_change": "Healthcare policy change",
    "china_growth": "China growth and stimulus signal",
    "consumer_weakness": "Consumer weakness signal",
}

THEME_REGISTRY_FALLBACKS = {
    "ai_power_grid_bottleneck": "energy_demand",
    "consumer_product_breakout": "consumer_cycle",
    "defense_ai_operating_system": "defense_spending_up",
    "quantum_computing_commercialization": "semis_supply_shock",
    "single_company_social_perturbation": "consumer_cycle",
}


@dataclass
class ClaimRow:
    id: int
    claim_text: str
    claim_type: str
    source_hit_ids: List[int]
    detected_entities: List[str]
    detected_brands: List[str]
    detected_tickers: List[str]
    detected_themes: List[str]
    confidence: float
    verification_status: str
    validity_flags: List[str]
    first_seen_at: int
    last_seen_at: int


@dataclass
class SourceHit:
    id: int
    source_type: str
    source_community: str
    source_url: Optional[str]
    author: Optional[str]
    title: Optional[str]
    posted_at: int


@dataclass
class ClusterCandidate:
    slug: str
    title: str
    summary: str
    primary_theme: str
    status: str
    source_breadth: float
    attention_velocity: float
    novelty_score: float
    mainstream_coverage_score: float
    undercoverage_score: float
    authenticity_score: float
    tradable_exposure_status: str
    verification_status: str
    mapped_tickers: List[str]
    validity_flags: List[str]
    metadata: Dict[str, Any]
    first_seen_at: int
    last_seen_at: int
    claim_ids: List[int] = field(default_factory=list)


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[clusters] DB missing at {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def assert_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    actual = int(row["value"]) if row and str(row["value"]).isdigit() else None
    if actual is None or actual < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[clusters] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def parse_json_list(value: Any) -> List[Any]:
    if value is None or value == "":
        return []
    try:
        parsed = json.loads(str(value))
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def unique_sorted(values: Iterable[Any]) -> List[str]:
    return sorted({str(v).strip() for v in values if str(v).strip()})


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)[:80] or "narrative-cluster"


def load_claims(conn: sqlite3.Connection, *, limit: int) -> List[ClaimRow]:
    rows = conn.execute(
        """
        SELECT id, claim_text, claim_type, source_hit_ids_json,
               detected_entities_json, detected_brands_json,
               detected_tickers_json, detected_themes_json,
               confidence, verification_status, validity_flags_json,
               first_seen_at, last_seen_at
        FROM emerging_claims
        WHERE verification_status != 'invalidated'
        ORDER BY last_seen_at DESC, id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    claims: List[ClaimRow] = []
    for row in rows:
        claims.append(
            ClaimRow(
                id=int(row["id"]),
                claim_text=str(row["claim_text"]),
                claim_type=str(row["claim_type"]),
                source_hit_ids=[int(x) for x in parse_json_list(row["source_hit_ids_json"]) if str(x).isdigit()],
                detected_entities=unique_sorted(parse_json_list(row["detected_entities_json"])),
                detected_brands=unique_sorted(parse_json_list(row["detected_brands_json"])),
                detected_tickers=unique_sorted(parse_json_list(row["detected_tickers_json"])),
                detected_themes=unique_sorted(parse_json_list(row["detected_themes_json"])),
                confidence=float(row["confidence"] or 0.0),
                verification_status=str(row["verification_status"] or "unverified"),
                validity_flags=unique_sorted(parse_json_list(row["validity_flags_json"])),
                first_seen_at=int(row["first_seen_at"] or 0),
                last_seen_at=int(row["last_seen_at"] or 0),
            )
        )
    return claims


def load_hits(conn: sqlite3.Connection, hit_ids: Sequence[int]) -> Dict[int, SourceHit]:
    ids = sorted({int(x) for x in hit_ids if int(x) > 0})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        SELECT id, source_type, source_community, source_url, author, title, posted_at
        FROM mi_raw_hits
        WHERE id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    return {
        int(row["id"]): SourceHit(
            id=int(row["id"]),
            source_type=str(row["source_type"] or ""),
            source_community=str(row["source_community"] or ""),
            source_url=row["source_url"],
            author=row["author"],
            title=row["title"],
            posted_at=int(row["posted_at"] or 0),
        )
        for row in rows
    }


def load_theme_registry(conn: sqlite3.Connection) -> Set[str]:
    return {
        str(row["theme_key"])
        for row in conn.execute("SELECT theme_key FROM theme_registry").fetchall()
    }


def registry_theme_for(theme: str, registry: Set[str]) -> str:
    if theme in registry:
        return theme
    fallback = THEME_REGISTRY_FALLBACKS.get(theme)
    if fallback in registry:
        return fallback
    return "consumer_cycle" if "consumer_cycle" in registry else sorted(registry)[0]


def group_key_for(claim: ClaimRow) -> Tuple[str, str]:
    theme = claim.detected_themes[0] if claim.detected_themes else claim.claim_type
    if theme == "single_company_social_perturbation" and claim.detected_tickers:
        return (theme, f"{claim.claim_type}:{claim.detected_tickers[0]}")
    return (theme, claim.claim_type)


def status_for(
    *,
    claim_count: int,
    hit_count: int,
    unique_source_types: int,
    mapped_tickers: Sequence[str],
    avg_confidence: float,
    flags: Set[str],
    verification_status: str,
) -> str:
    if "LIKELY_INAUTHENTIC" in flags:
        return "WATCH"
    if not mapped_tickers:
        return "WATCH" if claim_count < 2 else "RESEARCH"
    verification_ok = verification_status in {"unverified", "partially_verified", "verified"}
    verification_ok = verification_ok or (
        verification_status == "needs_primary_source"
        and unique_source_types >= 2
        and claim_count >= 5
        and "POLICY_RUMOR_RISK" not in flags
    )
    if (
        claim_count >= 3
        and hit_count >= 3
        and unique_source_types >= 2
        and avg_confidence >= 0.54
        and verification_ok
        and "NEEDS_TICKER_MAPPING" not in flags
    ):
        return "SCENARIO_READY"
    if claim_count >= 2 or hit_count >= 2:
        return "RESEARCH"
    return "WATCH"


def verification_for(flags: Set[str], unique_source_types: int) -> str:
    if "VERIFY_PRIMARY_SOURCES" in flags or "POLICY_RUMOR_RISK" in flags:
        return "needs_primary_source"
    if unique_source_types >= 2:
        return "partially_verified"
    return "unverified"


def build_summary(
    *,
    title: str,
    claim_count: int,
    source_types: Sequence[str],
    tickers: Sequence[str],
    flags: Sequence[str],
) -> str:
    source_part = ", ".join(source_types[:4]) if source_types else "unknown sources"
    ticker_part = ", ".join(tickers[:8]) if tickers else "no mapped ticker yet"
    flag_part = f" Flags: {', '.join(flags)}." if flags else ""
    return (
        f"{title} is appearing across {claim_count} structured claim(s) from "
        f"{source_part}. Current mapped exposure: {ticker_part}.{flag_part}"
    )


def build_cluster_candidates(
    claims: Sequence[ClaimRow],
    hits: Dict[int, SourceHit],
    theme_registry: Set[str],
) -> List[ClusterCandidate]:
    grouped: Dict[Tuple[str, str], List[ClaimRow]] = {}
    for claim in claims:
        grouped.setdefault(group_key_for(claim), []).append(claim)

    clusters: List[ClusterCandidate] = []
    for (theme, claim_type), group in sorted(grouped.items()):
        registry_theme = registry_theme_for(theme, theme_registry)
        claim_ids = sorted(c.id for c in group)
        source_hit_ids = sorted({hid for c in group for hid in c.source_hit_ids})
        source_hits = [hits[hid] for hid in source_hit_ids if hid in hits]
        source_types = unique_sorted(h.source_type for h in source_hits)
        communities = unique_sorted(h.source_community for h in source_hits)
        authors = unique_sorted(h.author for h in source_hits if h.author)
        tickers = unique_sorted(t for c in group for t in c.detected_tickers)
        entities = unique_sorted(e for c in group for e in c.detected_entities)
        flags = set(unique_sorted(f for c in group for f in c.validity_flags))
        if len(source_types) < 2:
            flags.add("SINGLE_SOURCE_RISK")
        if not tickers:
            flags.add("NO_GOOD_EXPRESSION")

        first_seen = min(c.first_seen_at for c in group if c.first_seen_at)
        last_seen = max(c.last_seen_at for c in group if c.last_seen_at)
        span_days = max(1.0, (last_seen - first_seen) / 86_400.0)
        avg_confidence = sum(c.confidence for c in group) / max(1, len(group))
        mainstream_hits = sum(1 for h in source_hits if h.source_type in MAINSTREAM_SOURCE_TYPES)
        mainstream_score = min(1.0, mainstream_hits / max(1, len(source_hits)))
        source_breadth = min(1.0, (len(source_types) / 4.0) * 0.65 + (len(communities) / 8.0) * 0.35)
        attention_velocity = round(len(source_hit_ids) / span_days, 4)
        undercoverage_score = max(0.0, min(1.0, 1.0 - mainstream_score * 0.65))
        authenticity_score = 0.72
        if "SINGLE_SOURCE_RISK" in flags:
            authenticity_score -= 0.12
        if "POLICY_RUMOR_RISK" in flags:
            authenticity_score -= 0.05
        authenticity_score = max(0.0, min(1.0, authenticity_score))
        verification_status = verification_for(flags, len(source_types))
        tradable_status = "mapped" if tickers else "no_good_expression"
        status = status_for(
            claim_count=len(group),
            hit_count=len(source_hit_ids),
            unique_source_types=len(source_types),
            mapped_tickers=tickers,
            avg_confidence=avg_confidence,
            flags=flags,
            verification_status=verification_status,
        )
        if theme == "single_company_social_perturbation" and tickers:
            title = f"{tickers[0]} social perturbation"
        else:
            title = THEME_TITLES.get(theme, theme.replace("_", " ").title())
        summary = build_summary(
            title=title,
            claim_count=len(group),
            source_types=source_types,
            tickers=tickers,
            flags=sorted(flags),
        )
        metadata = {
            "asymmetric_theme": theme,
            "registry_primary_theme": registry_theme,
            "claim_count": len(group),
            "source_hit_count": len(source_hit_ids),
            "source_hit_ids": source_hit_ids,
            "source_types": source_types,
            "source_communities": communities,
            "authors_sample": authors[:20],
            "entities": entities,
            "claim_type": claim_type,
            "avg_claim_confidence": round(avg_confidence, 4),
            "mainstream_hit_count": mainstream_hits,
            "promotion_rationale": {
                "status": status,
                "rules": [
                    "SCENARIO_READY requires mapped tickers, >=3 claims/hits, >=2 source types, and avg confidence >=0.54.",
                    "RESEARCH requires repeated claims/hits or a possible tradable exposure.",
                    "WATCH preserves early/single-source/no-expression smoke without promoting it.",
                ],
            },
        }
        clusters.append(
            ClusterCandidate(
                slug=f"narrative-{slugify(theme)}",
                title=title,
                summary=summary,
                primary_theme=registry_theme,
                status=status,
                source_breadth=round(source_breadth, 4),
                attention_velocity=attention_velocity,
                novelty_score=round(max(0.25, min(1.0, 0.85 - mainstream_score * 0.2)), 4),
                mainstream_coverage_score=round(mainstream_score, 4),
                undercoverage_score=round(undercoverage_score, 4),
                authenticity_score=round(authenticity_score, 4),
                tradable_exposure_status=tradable_status,
                verification_status=verification_status,
                mapped_tickers=tickers,
                validity_flags=sorted(flags),
                metadata=metadata,
                first_seen_at=first_seen,
                last_seen_at=last_seen,
                claim_ids=claim_ids,
            )
        )
    return clusters


def upsert_cluster(conn: sqlite3.Connection, cluster: ClusterCandidate, *, now: int) -> int:
    row = conn.execute(
        "SELECT id, status FROM narrative_clusters WHERE slug = ?",
        (cluster.slug,),
    ).fetchone()
    if row:
        cluster_id = int(row["id"])
        existing_status = str(row["status"])
        status = "PROMOTED" if existing_status == "PROMOTED" else cluster.status
        conn.execute(
            """
            UPDATE narrative_clusters SET
                title = ?, summary = ?, primary_theme = ?, status = ?,
                source_breadth = ?, attention_velocity = ?, novelty_score = ?,
                mainstream_coverage_score = ?, undercoverage_score = ?,
                authenticity_score = ?, tradable_exposure_status = ?,
                verification_status = ?, mapped_tickers_json = ?,
                validity_flags_json = ?, metadata_json = ?,
                first_seen_at = MIN(first_seen_at, ?),
                last_seen_at = MAX(last_seen_at, ?),
                updated_at = ?
            WHERE id = ?
            """,
            (
                cluster.title,
                cluster.summary,
                cluster.primary_theme,
                status,
                cluster.source_breadth,
                cluster.attention_velocity,
                cluster.novelty_score,
                cluster.mainstream_coverage_score,
                cluster.undercoverage_score,
                cluster.authenticity_score,
                cluster.tradable_exposure_status,
                cluster.verification_status,
                json.dumps(cluster.mapped_tickers),
                json.dumps(cluster.validity_flags),
                json.dumps(cluster.metadata, sort_keys=True),
                cluster.first_seen_at,
                cluster.last_seen_at,
                now,
                cluster_id,
            ),
        )
        return cluster_id

    cur = conn.execute(
        """
        INSERT INTO narrative_clusters (
            slug, title, summary, primary_theme, status,
            source_breadth, attention_velocity, novelty_score,
            mainstream_coverage_score, undercoverage_score, authenticity_score,
            tradable_exposure_status, verification_status,
            mapped_tickers_json, validity_flags_json, promotion_situation_id,
            metadata_json, first_seen_at, last_seen_at, created_at, updated_at,
            archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)
        """,
        (
            cluster.slug,
            cluster.title,
            cluster.summary,
            cluster.primary_theme,
            cluster.status,
            cluster.source_breadth,
            cluster.attention_velocity,
            cluster.novelty_score,
            cluster.mainstream_coverage_score,
            cluster.undercoverage_score,
            cluster.authenticity_score,
            cluster.tradable_exposure_status,
            cluster.verification_status,
            json.dumps(cluster.mapped_tickers),
            json.dumps(cluster.validity_flags),
            json.dumps(cluster.metadata, sort_keys=True),
            cluster.first_seen_at,
            cluster.last_seen_at,
            now,
            now,
        ),
    )
    return int(cur.lastrowid)


def link_claims(conn: sqlite3.Connection, *, cluster_id: int, claim_ids: Sequence[int], now: int) -> int:
    inserted = 0
    for claim_id in claim_ids:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO narrative_cluster_claims (
                cluster_id, claim_id, relationship, weight, added_at
            ) VALUES (?, ?, 'supporting', 1.0, ?)
            """,
            (cluster_id, int(claim_id), now),
        )
        inserted += int(cur.rowcount)
    return inserted


def run(*, db_path: Path, limit: int, dry_run: bool) -> Dict[str, Any]:
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        claims = load_claims(conn, limit=limit)
        hit_ids = sorted({hid for claim in claims for hid in claim.source_hit_ids})
        hits = load_hits(conn, hit_ids)
        theme_registry = load_theme_registry(conn)
        clusters = build_cluster_candidates(claims, hits, theme_registry)

        upserted = 0
        linked = 0
        now = int(time.time())
        if not dry_run:
            for cluster in clusters:
                cluster_id = upsert_cluster(conn, cluster, now=now)
                upserted += 1
                linked += link_claims(conn, cluster_id=cluster_id, claim_ids=cluster.claim_ids, now=now)
            conn.commit()

        return {
            "ok": True,
            "dry_run": dry_run,
            "claims_scanned": len(claims),
            "clusters_found": len(clusters),
            "clusters_upserted": upserted,
            "claim_links_inserted": linked,
            "clusters": [
                {
                    "slug": c.slug,
                    "title": c.title,
                    "status": c.status,
                    "claims": len(c.claim_ids),
                    "source_breadth": c.source_breadth,
                    "mapped_tickers": c.mapped_tickers[:10],
                    "validity_flags": c.validity_flags,
                }
                for c in clusters
            ],
        }
    finally:
        conn.close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build narrative clusters from emerging_claims."
    )
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    summary = run(
        db_path=Path(args.db_path),
        limit=max(1, int(args.limit)),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
