#!/usr/bin/env python3
"""Seed operator-reviewed Social Arbitrage narratives into Market Intelligence.

This script is intentionally small and explicit. It is for cases where a
high-signal social narrative is observed before the automated collectors have a
proper YouTube/transcript ingestion path.

Usage:
    py backend/scripts/seed_social_arbitrage_narrative.py --preset tokenized-wall-street
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
SCHEMA_VERSION = 6
DAY = 86_400


def now_unix() -> int:
    return int(time.time())


def midnight_utc(value: int) -> int:
    return (value // DAY) * DAY


def ts_utc(year: int, month: int, day: int, hour: int = 16) -> int:
    return int(time.mktime((year, month, day, hour, 0, 0, 0, 0, 0)))


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def delete_existing(conn: sqlite3.Connection, slug: str) -> int:
    row = conn.execute("SELECT id FROM market_situations WHERE slug = ?", (slug,)).fetchone()
    if not row:
        return 0
    conn.execute("DELETE FROM market_situations WHERE id = ?", (int(row["id"]),))
    return int(row["id"])


def ensure_theme(conn: sqlite3.Connection, fx: Dict[str, Any], now: int) -> None:
    conn.execute(
        """
        INSERT INTO theme_registry (
            theme_key, display_name, category, taxonomy_version, created_at
        )
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(theme_key) DO UPDATE SET
            display_name = excluded.display_name,
            category = excluded.category
        """,
        (
            fx["primary_theme"],
            fx.get("primary_theme_display") or fx["primary_theme"].replace("_", " ").title(),
            fx.get("primary_theme_category") or "tech",
            now,
        ),
    )


def insert_situation(conn: sqlite3.Connection, fx: Dict[str, Any], now: int) -> int:
    cur = conn.execute(
        """
        INSERT INTO market_situations (
            slug, title, summary,
            primary_theme, scenario_type, status,
            signal_strength, confidence_score, confidence_level, time_horizon,
            started_at, last_confirmed_at, last_updated_at, expires_at,
            evidence_count,
            first_order_effects_json, second_order_effects_json,
            validity_flags_json, confidence_reasons_json,
            detection_path, coverage_tier, authenticity_score, peak_z_score,
            cross_platform_corroboration, edge_multiplier, source_breadth_score,
            metadata_json, schema_version, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fx["slug"],
            fx["title"],
            fx["summary"],
            fx["primary_theme"],
            fx["scenario_type"],
            fx["status"],
            fx["signal_strength"],
            fx["confidence_score"],
            fx["confidence_level"],
            fx["time_horizon"],
            fx["started_at"],
            fx.get("last_confirmed_at"),
            fx["last_updated_at"],
            fx.get("expires_at"),
            len(fx.get("evidence", [])),
            json.dumps(fx.get("first_order_effects") or []),
            json.dumps(fx.get("second_order_effects") or []),
            json.dumps(fx.get("validity_flags") or []),
            json.dumps(fx.get("confidence_reasons") or []),
            fx["detection_path"],
            fx.get("coverage_tier"),
            fx.get("authenticity_score"),
            fx.get("peak_z_score"),
            1 if fx.get("cross_platform_corroboration") else 0,
            float(fx.get("edge_multiplier", 1.0)),
            fx.get("source_breadth_score"),
            json.dumps(fx.get("metadata") or {}),
            SCHEMA_VERSION,
            now,
            now,
        ),
    )
    return int(cur.lastrowid)


def insert_signals(conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any], now: int) -> List[int]:
    signal_ids: List[int] = []
    for sig in fx.get("signals", []):
        cur = conn.execute(
            """
            INSERT INTO situation_signals (
                situation_id, signal_type, source_type, source_id,
                entity, theme, score, weight, observed_at, ingested_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                situation_id,
                sig["signal_type"],
                sig["source_type"],
                sig["source_id"],
                sig.get("entity"),
                sig.get("theme"),
                float(sig["score"]),
                float(sig.get("weight", 1.0)),
                int(sig["observed_at"]),
                now,
                json.dumps(sig.get("payload") or {}),
            ),
        )
        signal_ids.append(int(cur.lastrowid))
    return signal_ids


def insert_evidence(conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any], signal_ids: List[int]) -> int:
    count = 0
    for i, ev in enumerate(fx.get("evidence", [])):
        signal_id = signal_ids[min(i, len(signal_ids) - 1)] if signal_ids else None
        conn.execute(
            """
            INSERT INTO situation_evidence (
                situation_id, evidence_type, source_name, headline_or_label,
                summary, url, published_at, importance_score, novelty_score,
                signal_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                situation_id,
                ev["evidence_type"],
                ev["source_name"],
                ev["headline_or_label"],
                ev.get("summary"),
                ev.get("url"),
                int(ev["published_at"]),
                ev.get("importance_score"),
                ev.get("novelty_score"),
                signal_id,
                json.dumps(ev.get("payload") or {}),
            ),
        )
        count += 1
    return count


def insert_exposures(conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any], now: int) -> int:
    count = 0
    for ex in fx.get("exposures", []):
        conn.execute(
            """
            INSERT INTO situation_exposure (
                situation_id, asset_type, asset_key, exposure_direction, exposure_order,
                exposure_strength, source_method, rationale, confidence,
                universe_symbol, dcf_gap_pct, quality_score, technical_score,
                final_buzz_score, composite_rank, last_ranked_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                situation_id,
                ex["asset_type"],
                ex["asset_key"],
                ex["exposure_direction"],
                ex["exposure_order"],
                float(ex["exposure_strength"]),
                ex["source_method"],
                ex.get("rationale"),
                float(ex.get("confidence", 0.65)),
                ex.get("universe_symbol"),
                ex.get("dcf_gap_pct"),
                ex.get("quality_score"),
                ex.get("technical_score"),
                ex.get("final_buzz_score"),
                ex.get("composite_rank"),
                now,
                json.dumps(ex.get("payload") or {}),
            ),
        )
        count += 1
    return count


def insert_raw_hits(conn: sqlite3.Connection, fx: Dict[str, Any], now: int) -> int:
    count = 0
    for hit in fx.get("raw_hits", []):
        conn.execute(
            """
            INSERT OR IGNORE INTO mi_raw_hits (
                source_type, source_post_id, source_thread_id, source_url,
                source_community, author, title, body_text,
                posted_at, fetched_at, score, comment_count,
                matched_concept_ids_json, raw_payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                hit["source_type"],
                hit["source_post_id"],
                hit.get("source_thread_id"),
                hit.get("source_url"),
                hit["source_community"],
                hit.get("author"),
                hit.get("title"),
                hit.get("body_text"),
                int(hit["posted_at"]),
                now,
                hit.get("score"),
                hit.get("comment_count"),
                json.dumps([]),
                json.dumps(hit.get("payload") or {}),
            ),
        )
        count += 1
    return count


def tokenized_wall_street_fixture(now: int) -> Dict[str, Any]:
    apr21 = ts_utc(2026, 4, 21)
    apr22 = ts_utc(2026, 4, 22)
    apr23 = ts_utc(2026, 4, 23)
    source_url = "https://www.youtube.com/watch?v=BIkyUJFIvH4"
    return {
        "slug": "social-tokenized-wall-street-rollout",
        "title": "Tokenized Wall Street rollout narrative emerging from crypto social channels",
        "summary": (
            "A viral YouTube/social narrative frames three April 2026 events as one coordinated rollout: "
            "SEC tokenized-stock relief, stablecoin banking infrastructure, and crypto-industry pressure "
            "for market-structure legislation. Treat as a high-signal narrative to verify, not as confirmed fact."
        ),
        "primary_theme": "financial_tokenization",
        "primary_theme_display": "Financial Tokenization",
        "primary_theme_category": "tech",
        "scenario_type": "tech_disruption",
        "status": "EARLY",
        "signal_strength": 74,
        "confidence_score": 0.58,
        "confidence_level": "medium",
        "time_horizon": "quarters",
        "started_at": apr21,
        "last_confirmed_at": now,
        "last_updated_at": now,
        "expires_at": now + 45 * DAY,
        "first_order_effects": [
            {
                "asset_type": "sector",
                "asset_key": "crypto_market_infrastructure",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.78,
                "rationale": "Tokenized equities and stablecoin settlement would expand demand for compliant crypto rails.",
            },
            {
                "asset_type": "equity",
                "asset_key": "COIN",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.72,
                "rationale": "Coinbase is a liquid public-market expression for US crypto market infrastructure.",
            },
        ],
        "second_order_effects": [
            {
                "asset_type": "equity",
                "asset_key": "ICE",
                "exposure_direction": "direction_uncertain",
                "exposure_strength": 0.48,
                "rationale": "Legacy exchange owners could face disruption risk or participate through tokenized venues.",
            },
            {
                "asset_type": "equity",
                "asset_key": "HOOD",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.54,
                "rationale": "Retail brokerage with crypto adjacency could benefit if tokenized equities broaden retail access.",
            },
        ],
        "validity_flags": ["OPERATOR_SEEDED", "VERIFY_PRIMARY_SOURCES", "POLICY_RUMOR_RISK"],
        "confidence_reasons": [
            "Narrative has a clear three-step structure: legal layer, banking layer, political layer.",
            "The claim connects named institutions and dates, which makes it testable.",
            "Source is social/video commentary; primary-source verification is required before treating it as confirmed.",
            "Tradable map exists, but beneficiary/loser direction is still early and uncertain.",
        ],
        "detection_path": "topic_anomaly",
        "coverage_tier": "lightly_covered",
        "authenticity_score": 0.72,
        "peak_z_score": 4.2,
        "cross_platform_corroboration": False,
        "edge_multiplier": 1.2,
        "source_breadth_score": 0.45,
        "metadata": {
            "operator_seeded": True,
            "narrative_type": "timeline_claim",
            "requires_primary_source_verification": True,
            "source_url": source_url,
            "claimed_timeline": ["2026-04-21", "2026-04-22", "2026-04-23"],
        },
        "signals": [
            {
                "signal_type": "social_buzz_spike",
                "source_type": "youtube_transcript",
                "source_id": "youtube:BIkyUJFIvH4:tokenized-wall-street",
                "entity": "tokenized_equities",
                "theme": "financial_tokenization",
                "score": 0.82,
                "weight": 1.0,
                "observed_at": now,
                "payload": {"url": source_url, "operator_seeded": True},
            },
            {
                "signal_type": "policy_release",
                "source_type": "social_claimed_sec_policy",
                "source_id": "claim:2026-04-21:innovation-exemption",
                "entity": "SEC Innovation Exemption",
                "theme": "financial_tokenization",
                "score": 0.66,
                "weight": 0.8,
                "observed_at": apr21,
                "payload": {"verification_status": "needs_primary_source_check"},
            },
            {
                "signal_type": "policy_release",
                "source_type": "social_claimed_crypto_lobbying",
                "source_id": "claim:2026-04-23:clarity-act-markup-letter",
                "entity": "CLARITY Act",
                "theme": "financial_tokenization",
                "score": 0.64,
                "weight": 0.8,
                "observed_at": apr23,
                "payload": {"verification_status": "needs_primary_source_check"},
            },
        ],
        "evidence": [
            {
                "evidence_type": "social_post_cluster",
                "source_name": "YouTube transcript",
                "headline_or_label": "Viral thesis: Wall Street's monopoly replaced by tokenized equities",
                "summary": (
                    "Commentary claims tokenized stocks, stablecoin banking, and crypto legislation moved in a "
                    "three-day sequence. This is the social narrative that should enter the Social Arbitrage stream."
                ),
                "url": source_url,
                "published_at": now,
                "importance_score": 0.88,
                "novelty_score": 0.8,
            },
            {
                "evidence_type": "policy_release",
                "source_name": "Transcript claim",
                "headline_or_label": "April 21: SEC Innovation Exemption described as legal door for tokenized stocks",
                "summary": "Claimed catalyst: tokenized Apple, Tesla, and Nvidia shares could trade on-chain without traditional settlement rails.",
                "url": source_url,
                "published_at": apr21,
                "importance_score": 0.74,
                "novelty_score": 0.72,
            },
            {
                "evidence_type": "social_post_cluster",
                "source_name": "Transcript claim",
                "headline_or_label": "April 22: fiat/stablecoin banking API framed as institutional plumbing",
                "summary": "Claimed catalyst: a bank/API stack for stablecoin businesses, AI companies, defense contractors, and crypto firms.",
                "url": source_url,
                "published_at": apr22,
                "importance_score": 0.66,
                "novelty_score": 0.68,
            },
            {
                "evidence_type": "policy_release",
                "source_name": "Transcript claim",
                "headline_or_label": "April 23: crypto companies press for CLARITY Act markup",
                "summary": "Claimed catalyst: Coinbase, Ripple, Kraken, Circle, Solana Policy Institute, Consensys, and others coordinate on legislation.",
                "url": source_url,
                "published_at": apr23,
                "importance_score": 0.7,
                "novelty_score": 0.64,
            },
        ],
        "exposures": [
            {
                "asset_type": "equity",
                "asset_key": "COIN",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.82,
                "source_method": "operator_override",
                "rationale": "Direct listed crypto-market-infrastructure expression.",
                "confidence": 0.78,
                "universe_symbol": "COIN",
                "composite_rank": 1,
                "final_buzz_score": 4.2,
            },
            {
                "asset_type": "equity",
                "asset_key": "HOOD",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "second",
                "exposure_strength": 0.58,
                "source_method": "operator_override",
                "rationale": "Retail brokerage and crypto-adjacent platform; potential beneficiary if tokenized stocks go mainstream.",
                "confidence": 0.62,
                "universe_symbol": "HOOD",
                "composite_rank": 2,
                "final_buzz_score": 3.2,
            },
            {
                "asset_type": "equity",
                "asset_key": "ICE",
                "exposure_direction": "direction_uncertain",
                "exposure_order": "second",
                "exposure_strength": 0.52,
                "source_method": "operator_override",
                "rationale": "NYSE owner; could be disrupted by on-chain settlement or adapt via regulated tokenization venues.",
                "confidence": 0.58,
                "universe_symbol": "ICE",
                "composite_rank": 3,
                "final_buzz_score": 2.8,
            },
            {
                "asset_type": "equity",
                "asset_key": "NDAQ",
                "exposure_direction": "direction_uncertain",
                "exposure_order": "second",
                "exposure_strength": 0.48,
                "source_method": "operator_override",
                "rationale": "Legacy exchange/data infrastructure potentially affected by tokenized-equity market structure.",
                "confidence": 0.55,
                "universe_symbol": "NDAQ",
                "composite_rank": 4,
                "final_buzz_score": 2.6,
            },
            {
                "asset_type": "sector",
                "asset_key": "crypto_market_infrastructure",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.8,
                "source_method": "operator_override",
                "rationale": "Broad sector expression for tokenized securities, stablecoin payments, and crypto compliance rails.",
                "confidence": 0.7,
                "composite_rank": 5,
                "final_buzz_score": 4.0,
            },
        ],
        "raw_hits": [
            {
                "source_type": "youtube_transcript",
                "source_post_id": "BIkyUJFIvH4",
                "source_thread_id": "BIkyUJFIvH4",
                "source_url": source_url,
                "source_community": "youtube:crypto_finance",
                "author": "operator_seed",
                "title": "Wall Street's 233-Year Monopoly Is Officially Over",
                "body_text": (
                    "Transcript describes a three-day April 2026 narrative: SEC Innovation Exemption for tokenized "
                    "stocks, a fiat/stablecoin banking API launch, and coordinated crypto-industry pressure for "
                    "CLARITY Act markup."
                ),
                "posted_at": now,
                "score": None,
                "comment_count": None,
                "payload": {"operator_seeded": True, "full_transcript_provided_by_user": False},
            },
        ],
    }


PRESETS = {
    "tokenized-wall-street": tokenized_wall_street_fixture,
}


def seed_preset(conn: sqlite3.Connection, preset: str, *, replace: bool) -> Dict[str, Any]:
    if preset not in PRESETS:
        raise ValueError(f"Unknown preset '{preset}'. Available: {', '.join(sorted(PRESETS))}")
    now = now_unix()
    fx = PRESETS[preset](now)
    deleted_id = delete_existing(conn, fx["slug"]) if replace else 0
    ensure_theme(conn, fx, now)
    situation_id = insert_situation(conn, fx, now)
    signal_ids = insert_signals(conn, situation_id, fx, now)
    evidence_count = insert_evidence(conn, situation_id, fx, signal_ids)
    exposure_count = insert_exposures(conn, situation_id, fx, now)
    raw_hit_count = insert_raw_hits(conn, fx, now)
    conn.commit()
    return {
        "preset": preset,
        "slug": fx["slug"],
        "situation_id": situation_id,
        "replaced_situation_id": deleted_id or None,
        "signals": len(signal_ids),
        "evidence": evidence_count,
        "exposures": exposure_count,
        "raw_hits": raw_hit_count,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed operator-reviewed Social Arbitrage narratives")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--preset", choices=sorted(PRESETS), required=True)
    parser.add_argument("--no-replace", action="store_true", help="Do not delete an existing scenario with the same slug first")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    conn = connect(Path(args.db_path))
    try:
        result = seed_preset(conn, args.preset, replace=not args.no_replace)
    finally:
        conn.close()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
