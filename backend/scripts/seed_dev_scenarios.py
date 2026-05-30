#!/usr/bin/env python3
"""Seed a small set of fake scenarios into market-intelligence.sqlite.

Phase 1.5 deliverable. Lets the wired-up UI render real rows from the live
API while collectors and the detection engine are still being built
(Phase 2+).

Five hand-crafted scenarios designed to exercise the dual-panel UI:
  1. Macro / news_cluster        — energy supply (well-covered)
  2. Macro / news_cluster        — rates higher (mega-covered)
  3. Social Arbitrage / topic_anomaly — beauty dupe (lightly covered, high z)
  4. Mixed / mixed_news_led      — china growth (well-covered, both engines)
  5. Social Arbitrage / topic_anomaly — INVALIDATED (suppressed, for filter test)

Each scenario gets:
  - A market_situations row
  - 1-3 situation_signals rows
  - 2-4 situation_evidence rows (so the evidence drawer has content)
  - 2-4 situation_exposure rows (one or two with universe_symbol set, so
    top_universe_candidates returns non-empty)

Idempotent: uses INSERT OR REPLACE keyed on slug, so re-running picks up
edits to this file's data without duplicating rows.

Usage:
    py backend/scripts/seed_dev_scenarios.py
    py backend/scripts/seed_dev_scenarios.py --dry-run
    py backend/scripts/seed_dev_scenarios.py --reset       # wipe scenario rows first
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"

NOW = int(time.time())
DAY = 86400

EXPECTED_SCHEMA_VERSION = 5


# Tables this script writes to. `--reset` deletes from these in FK-safe order.
SCENARIO_TABLES = [
    "situation_evidence",
    "situation_exposure",
    "situation_signals",
    "market_situations",
]


# ---------------------------------------------------------------------------
# Scenario fixtures
# ---------------------------------------------------------------------------

def _fixture_macro_energy() -> Dict[str, Any]:
    return {
        "slug": "dev-mideast-shipping-disruption",
        "title": "Red Sea shipping disruption escalating into Hormuz risk premium",
        "summary": (
            "Cluster of Reuters/AP/Lloyd's wires + EIA inventory build with "
            "overlapping named entities (CENTCOM, IRGC, Maersk) crossed cosine "
            "0.81 against 9 sources in 36h."
        ),
        "primary_theme": "energy_supply",
        "scenario_type": "geopolitical",
        "status": "DEVELOPING",
        "signal_strength": 78,
        "source_breadth_score": 0.85,
        "confidence_score": 0.62,
        "confidence_level": "medium",
        "time_horizon": "weeks",
        "started_at": NOW - 3 * DAY,
        "last_updated_at": NOW - 240,
        "expires_at": NOW + 21 * DAY,
        "evidence_count": 3,
        "first_order_effects": [
            {
                "asset_type": "commodity",
                "asset_key": "CL",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.8,
                "rationale": "Brent/WTI move on supply-chain risk premium",
            },
            {
                "asset_type": "sector",
                "asset_key": "energy",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.7,
                "rationale": "Sector rotation into upstream names",
            },
        ],
        "second_order_effects": [
            {
                "asset_type": "sector",
                "asset_key": "transports_airlines",
                "exposure_direction": "short_loser",
                "exposure_strength": 0.5,
                "rationale": "Jet fuel cost pressure on airlines",
            },
        ],
        "validity_flags": [],
        "confidence_reasons": [
            "9 independent wire sources within 36h",
            "EIA inventory build corroborates supply-side narrative",
            "Cosine similarity 0.81 across entity-extracted clusters",
        ],
        "detection_path": "news_cluster",
        "coverage_tier": "mega_covered",
        "authenticity_score": None,
        "peak_z_score": None,
        "cross_platform_corroboration": False,
        "edge_multiplier": 1.0,
        "signals": [
            {
                "signal_type": "news_event",
                "source_type": "rss_reuters",
                "source_id": "reuters:red-sea-2026-04-23",
                "entity": "CENTCOM",
                "theme": "energy_supply",
                "score": 0.85,
                "weight": 1.0,
                "observed_at": NOW - 36 * 3600,
            },
            {
                "signal_type": "macro_release",
                "source_type": "rss_eia",
                "source_id": "eia:weekly-petroleum-2026-04-24",
                "entity": "EIA",
                "theme": "energy_supply",
                "score": 0.7,
                "weight": 0.8,
                "observed_at": NOW - 4 * 3600,
            },
        ],
        "evidence": [
            {
                "evidence_type": "article",
                "source_name": "Reuters",
                "headline_or_label": "Maersk diverts Red Sea fleet, rerouting via Cape of Good Hope",
                "summary": "Largest container fleet operator pulls all Red Sea transits citing IRGC drone threat.",
                "url": "https://reuters.example.com/red-sea-divert",
                "published_at": NOW - 38 * 3600,
                "importance_score": 0.9,
            },
            {
                "evidence_type": "article",
                "source_name": "AP",
                "headline_or_label": "CENTCOM intercepts third anti-ship drone in 24h",
                "summary": None,
                "url": "https://ap.example.com/centcom-intercepts",
                "published_at": NOW - 30 * 3600,
                "importance_score": 0.7,
            },
            {
                "evidence_type": "policy_release",
                "source_name": "EIA",
                "headline_or_label": "Weekly Petroleum Status Report — surprise inventory build",
                "summary": "Crude stocks +2.1Mb vs -1.0Mb consensus.",
                "url": "https://eia.example.com/wpsr-2026-04-24",
                "published_at": NOW - 5 * 3600,
                "importance_score": 0.6,
            },
        ],
        "exposures": [
            {
                "asset_type": "commodity",
                "asset_key": "CL",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.85,
                "source_method": "hand_curated",
                "rationale": "Direct Brent/WTI risk premium from Hormuz scenario",
                "confidence": 0.9,
                "universe_symbol": None,
            },
            {
                "asset_type": "equity",
                "asset_key": "XOM",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.7,
                "source_method": "hand_curated",
                "rationale": "Diversified upstream — leverage to crude beta",
                "confidence": 0.85,
                "universe_symbol": "XOM",
                "composite_rank": 1,
            },
            {
                "asset_type": "equity",
                "asset_key": "CVX",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.65,
                "source_method": "hand_curated",
                "rationale": "Diversified upstream — leverage to crude beta",
                "confidence": 0.82,
                "universe_symbol": "CVX",
                "composite_rank": 2,
            },
            {
                "asset_type": "equity",
                "asset_key": "DAL",
                "exposure_direction": "short_loser",
                "exposure_order": "second",
                "exposure_strength": 0.4,
                "source_method": "hand_curated",
                "rationale": "Jet fuel cost pressure on legacy airlines",
                "confidence": 0.6,
                "universe_symbol": "DAL",
                "composite_rank": 3,
            },
        ],
    }


def _fixture_macro_rates() -> Dict[str, Any]:
    return {
        "slug": "dev-fomc-cut-repricing",
        "title": "Sub-200K NFP printing higher Fed-cut probability",
        "summary": (
            "Fed-funds futures repriced 18bps for Sept after softer-than-expected "
            "jobs print; Powell-speak followed within 4h."
        ),
        "primary_theme": "rates_lower",
        "scenario_type": "macro",
        "status": "CONFIRMED",
        "signal_strength": 64,
        "source_breadth_score": 0.92,
        "confidence_score": 0.71,
        "confidence_level": "high",
        "time_horizon": "days",
        "started_at": NOW - 2 * DAY,
        "last_updated_at": NOW - 1100,
        "expires_at": NOW + 7 * DAY,
        "evidence_count": 2,
        "first_order_effects": [
            {
                "asset_type": "rate",
                "asset_key": "US10Y",
                "exposure_direction": "short_loser",
                "exposure_strength": 0.6,
                "rationale": "Yields lower on dovish repricing",
            },
            {
                "asset_type": "sector",
                "asset_key": "longduration_tech",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.7,
                "rationale": "Long-duration assets benefit from rate cuts",
            },
        ],
        "second_order_effects": [
            {
                "asset_type": "sector",
                "asset_key": "homebuilders",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.5,
                "rationale": "Lower mortgage rates support demand",
            },
        ],
        "validity_flags": [],
        "confidence_reasons": [
            "Fed-funds futures moved 18bps in 90min",
            "Powell-speak corroborated within 4h",
            "Three Reuters sources cross-confirmed",
        ],
        "detection_path": "news_cluster",
        "coverage_tier": "mega_covered",
        "authenticity_score": None,
        "peak_z_score": None,
        "cross_platform_corroboration": False,
        "edge_multiplier": 1.0,
        "signals": [
            {
                "signal_type": "macro_release",
                "source_type": "rss_bls",
                "source_id": "bls:nfp-2026-04",
                "entity": "BLS",
                "theme": "rates_lower",
                "score": 0.9,
                "weight": 1.0,
                "observed_at": NOW - 26 * 3600,
            },
        ],
        "evidence": [
            {
                "evidence_type": "policy_release",
                "source_name": "BLS",
                "headline_or_label": "April NFP 167K vs 200K consensus; UR up 0.1pp",
                "summary": None,
                "url": "https://bls.example.com/nfp-2026-04",
                "published_at": NOW - 26 * 3600,
                "importance_score": 0.95,
            },
            {
                "evidence_type": "article",
                "source_name": "Reuters",
                "headline_or_label": "Powell: 'we are reaching a point where adjusting policy may be appropriate'",
                "summary": "Speech at Stanford echoed dovish lean during Q&A.",
                "url": "https://reuters.example.com/powell-stanford",
                "published_at": NOW - 22 * 3600,
                "importance_score": 0.85,
            },
        ],
        "exposures": [
            {
                "asset_type": "etf",
                "asset_key": "IWM",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.7,
                "source_method": "hand_curated",
                "rationale": "Russell 2000 small-caps lever to dovish repricing",
                "confidence": 0.8,
                "universe_symbol": "IWM",
                "composite_rank": 1,
            },
            {
                "asset_type": "etf",
                "asset_key": "XBI",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.65,
                "source_method": "hand_curated",
                "rationale": "Biotech long-duration tilt",
                "confidence": 0.7,
                "universe_symbol": "XBI",
                "composite_rank": 2,
            },
            {
                "asset_type": "etf",
                "asset_key": "KRE",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "second",
                "exposure_strength": 0.55,
                "source_method": "hand_curated",
                "rationale": "Regional banks rally on yield-curve steepening expectations",
                "confidence": 0.65,
                "universe_symbol": "KRE",
                "composite_rank": 3,
            },
        ],
    }


def _fixture_social_beauty() -> Dict[str, Any]:
    return {
        "slug": "dev-frame-primer-dupe",
        "title": "Frame Cosmetics primer flagged as Charlotte Tilbury Flawless Filter dupe",
        "summary": (
            "Concept 'frame_primer_dupe' spiked z=4.6 in r/MakeupAddiction, then "
            "corroborated within 36h in #beauty Bluesky and Discord beauty-uncovered."
        ),
        "primary_theme": "consumer_dupe_culture",
        "scenario_type": "consumer_cycle",
        "status": "EARLY",
        "signal_strength": 67,
        "source_breadth_score": 0.55,
        "confidence_score": 0.54,
        "confidence_level": "medium",
        "time_horizon": "weeks",
        "started_at": NOW - 10 * DAY,
        "last_updated_at": NOW - 142,
        "expires_at": NOW + 30 * DAY,
        "evidence_count": 4,
        "first_order_effects": [
            {
                "asset_type": "equity",
                "asset_key": "ELF",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.75,
                "rationale": "Brand-momentum signal — dupe narratives historically lift ELF",
            },
        ],
        "second_order_effects": [
            {
                "asset_type": "sector",
                "asset_key": "beauty_retail",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.4,
                "rationale": "Distribution flow-through to ULTA",
            },
        ],
        "validity_flags": ["LOW_HISTORY"],
        "confidence_reasons": [
            "z-score 4.6 in seed community over 30d baseline",
            "Cross-platform: Reddit -> Bluesky -> Discord within 36h",
            "Authenticity 0.81 (clean profile distribution)",
            "LOW_HISTORY: only 18 days of baseline data",
        ],
        "detection_path": "topic_anomaly",
        "coverage_tier": "lightly_covered",
        "authenticity_score": 0.81,
        "peak_z_score": 4.6,
        "cross_platform_corroboration": True,
        "edge_multiplier": 1.5,
        "signals": [
            {
                "signal_type": "social_buzz_spike",
                "source_type": "forum_beauty",
                "source_id": "forum_beauty:r-makeupaddiction:thread-4827",
                "entity": "frame_primer",
                "theme": "consumer_dupe_culture",
                "score": 0.78,
                "weight": 1.0,
                "observed_at": NOW - 8 * DAY,
            },
            {
                "signal_type": "social_buzz_spike",
                "source_type": "bluesky",
                "source_id": "bluesky:hashtag-beauty:cluster-19a",
                "entity": "frame_primer",
                "theme": "consumer_dupe_culture",
                "score": 0.72,
                "weight": 0.8,
                "observed_at": NOW - 5 * DAY,
            },
        ],
        "evidence": [
            {
                "evidence_type": "social_post_cluster",
                "source_name": "reddit:r/MakeupAddiction",
                "headline_or_label": "FRMC primer side-by-side w/ CT Flawless Filter",
                "summary": "Top post 4.1k upvotes, 287 comments, primarily positive comparison.",
                "url": "https://reddit.example.com/r/MakeupAddiction/comments/abc123",
                "published_at": NOW - 8 * DAY,
                "importance_score": 0.85,
            },
            {
                "evidence_type": "social_post_cluster",
                "source_name": "bluesky:#beauty",
                "headline_or_label": "Cross-platform spread: 47 unique authors mentioning frame_primer",
                "summary": "+12 verified beauty accounts; SD of polarity 0.58 (organic disagreement).",
                "url": None,
                "published_at": NOW - 5 * DAY,
                "importance_score": 0.7,
            },
            {
                "evidence_type": "social_post_cluster",
                "source_name": "discord:beauty-uncovered",
                "headline_or_label": "Initial extraction: 'literally the flawless filter dupe i've been begging for'",
                "summary": None,
                "url": None,
                "published_at": NOW - 10 * DAY,
                "importance_score": 0.6,
            },
            {
                "evidence_type": "social_post_cluster",
                "source_name": "stocktwits:$FRMC",
                "headline_or_label": "First ticker-indexed mention referencing the dupe narrative",
                "summary": "Migration signal — chatter beginning to land on stocktwits.",
                "url": None,
                "published_at": NOW - 4 * DAY,
                "importance_score": 0.75,
            },
        ],
        "exposures": [
            {
                "asset_type": "equity",
                "asset_key": "ELF",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.85,
                "source_method": "hand_curated",
                "rationale": "Frame Cosmetics is wholly-owned by ELF; pure-play",
                "confidence": 0.9,
                "universe_symbol": "ELF",
                "composite_rank": 1,
                "final_buzz_score": 4.6,
            },
            {
                "asset_type": "equity",
                "asset_key": "ULTA",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "second",
                "exposure_strength": 0.4,
                "source_method": "derived",
                "rationale": "Distribution channel for FRMC; mega-covered, smaller edge",
                "confidence": 0.6,
                "universe_symbol": "ULTA",
                "composite_rank": 2,
            },
        ],
    }


def _fixture_mixed_china() -> Dict[str, Any]:
    return {
        "slug": "dev-china-stimulus-mixed",
        "title": "China stimulus headlines + r/ChinaStocks attention spike",
        "summary": (
            "PBOC RRR cut + auto-channel stimulus headlines, picked up afterwards "
            "by topic-anomaly engine on r/ChinaStocks (z=3.2). Now mixed_news_led."
        ),
        "primary_theme": "china_growth",
        "scenario_type": "geopolitical",
        "status": "DEVELOPING",
        "signal_strength": 70,
        "source_breadth_score": 0.78,
        "confidence_score": 0.66,
        "confidence_level": "high",
        "time_horizon": "months",
        "started_at": NOW - 5 * DAY,
        "last_updated_at": NOW - 720,
        "expires_at": NOW + 90 * DAY,
        "evidence_count": 3,
        "first_order_effects": [
            {
                "asset_type": "etf",
                "asset_key": "FXI",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.75,
                "rationale": "Direct China-equity exposure",
            },
        ],
        "second_order_effects": [
            {
                "asset_type": "sector",
                "asset_key": "industrial_metals",
                "exposure_direction": "long_beneficiary",
                "exposure_strength": 0.55,
                "rationale": "China demand recovery flows through to copper/iron",
            },
        ],
        "validity_flags": [],
        "confidence_reasons": [
            "Macro: PBOC release + Reuters/SCMP cross-confirm",
            "Social: r/ChinaStocks z=3.2 corroborates within 4h of headline",
            "Cross-engine: news-led seed picked up an attention spike",
        ],
        "detection_path": "mixed_news_led",
        "coverage_tier": "well_covered",
        "authenticity_score": 0.74,
        "peak_z_score": 3.2,
        "cross_platform_corroboration": True,
        "edge_multiplier": 1.2,
        "signals": [
            {
                "signal_type": "policy_release",
                "source_type": "rss_reuters",
                "source_id": "reuters:pboc-rrr-2026-04-25",
                "entity": "PBOC",
                "theme": "china_growth",
                "score": 0.88,
                "weight": 1.0,
                "observed_at": NOW - 12 * 3600,
            },
            {
                "signal_type": "social_buzz_spike",
                "source_type": "hackernews",
                "source_id": "hackernews:thread-39281",
                "entity": "china_stimulus",
                "theme": "china_growth",
                "score": 0.62,
                "weight": 0.6,
                "observed_at": NOW - 8 * 3600,
            },
        ],
        "evidence": [
            {
                "evidence_type": "policy_release",
                "source_name": "Reuters",
                "headline_or_label": "PBOC cuts RRR 25bps, signals additional auto-channel stimulus",
                "summary": "Largest RRR move in 14 months.",
                "url": "https://reuters.example.com/pboc-rrr-2026-04-25",
                "published_at": NOW - 12 * 3600,
                "importance_score": 0.9,
            },
            {
                "evidence_type": "article",
                "source_name": "SCMP",
                "headline_or_label": "Auto-channel subsidies extended through Q3 in 14 provinces",
                "summary": None,
                "url": "https://scmp.example.com/auto-subsidies",
                "published_at": NOW - 10 * 3600,
                "importance_score": 0.7,
            },
            {
                "evidence_type": "social_post_cluster",
                "source_name": "hackernews",
                "headline_or_label": "Thread on PBOC stimulus and EV supply-chain implications (z=3.2)",
                "summary": "Authentic, niche, non-promotional discussion thread.",
                "url": None,
                "published_at": NOW - 8 * 3600,
                "importance_score": 0.5,
            },
        ],
        "exposures": [
            {
                "asset_type": "etf",
                "asset_key": "FXI",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "first",
                "exposure_strength": 0.75,
                "source_method": "hand_curated",
                "rationale": "Most liquid China-equity expression",
                "confidence": 0.9,
                "universe_symbol": "FXI",
                "composite_rank": 1,
            },
            {
                "asset_type": "equity",
                "asset_key": "FCX",
                "exposure_direction": "long_beneficiary",
                "exposure_order": "second",
                "exposure_strength": 0.55,
                "source_method": "derived",
                "rationale": "Copper exposure benefits from China demand recovery",
                "confidence": 0.7,
                "universe_symbol": "FCX",
                "composite_rank": 2,
            },
        ],
    }


def _fixture_invalidated_social() -> Dict[str, Any]:
    return {
        "slug": "dev-microcap-pump-invalidated",
        "title": "$ABCD microcap chatter — flagged LIKELY_INAUTHENTIC",
        "summary": (
            "Sudden coordinated $ABCD chatter across 3 niche Discords. Posting "
            "cadence and account-age distribution scored 0.18 authenticity. "
            "Suppressed."
        ),
        "primary_theme": "consumer_dupe_culture",
        "scenario_type": "single_company_catalyst",
        "status": "INVALIDATED",
        "signal_strength": 22,
        "source_breadth_score": 0.18,
        "confidence_score": 0.14,
        "confidence_level": "low",
        "time_horizon": "days",
        "started_at": NOW - 2 * DAY,
        "last_updated_at": NOW - 4 * 3600,
        "expires_at": NOW + 1 * DAY,
        "evidence_count": 1,
        "first_order_effects": [],
        "second_order_effects": [],
        "validity_flags": ["LIKELY_INAUTHENTIC", "LOW_HISTORY"],
        "confidence_reasons": [
            "authenticity_score 0.18 below 0.35 hard floor",
            "Coordinated posting cadence detected (linguistic_similarity 0.93)",
            "Account-age distribution heavily skewed <30d",
        ],
        "detection_path": "topic_anomaly",
        "coverage_tier": "barely_covered",
        "authenticity_score": 0.18,
        "peak_z_score": 5.1,
        "cross_platform_corroboration": False,
        "edge_multiplier": 0.0,
        "signals": [
            {
                "signal_type": "social_buzz_spike",
                "source_type": "discord_public",
                "source_id": "discord:microcap-rocket:cluster-7d",
                "entity": "ABCD",
                "theme": "consumer_dupe_culture",
                "score": 0.92,
                "weight": 0.1,  # heavily de-weighted
                "observed_at": NOW - 8 * 3600,
            },
        ],
        "evidence": [
            {
                "evidence_type": "social_post_cluster",
                "source_name": "discord:microcap-rocket",
                "headline_or_label": "$ABCD coordinated push detected (suppressed)",
                "summary": "Auth signals: posting cadence 0.12, linguistic similarity 0.07, account quality 0.21.",
                "url": None,
                "published_at": NOW - 8 * 3600,
                "importance_score": 0.1,
            },
        ],
        "exposures": [],
    }


def all_fixtures() -> List[Dict[str, Any]]:
    return [
        _fixture_macro_energy(),
        _fixture_macro_rates(),
        _fixture_social_beauty(),
        _fixture_mixed_china(),
        _fixture_invalidated_social(),
    ]


# ---------------------------------------------------------------------------
# DB plumbing
# ---------------------------------------------------------------------------

def _connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(
            f"Database not found at {db_path}. "
            "Run build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _check_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    if row is None:
        raise SystemExit("schema_meta.schema_version missing")
    version = int(row[0])
    if version < EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"Schema version mismatch: DB has {version}, expected >= {EXPECTED_SCHEMA_VERSION}"
        )
    return version


def _wipe_scenarios(conn: sqlite3.Connection) -> Dict[str, int]:
    deleted: Dict[str, int] = {}
    for table in SCENARIO_TABLES:
        cur = conn.execute(f"DELETE FROM {table}")
        deleted[table] = cur.rowcount or 0
    return deleted


def _insert_situation(conn: sqlite3.Connection, fx: Dict[str, Any], now: int) -> int:
    cur = conn.execute(
        """
        INSERT OR REPLACE INTO market_situations (
            slug, title, summary,
            primary_theme, scenario_type, status,
            signal_strength, confidence_score, confidence_level, time_horizon,
            started_at, last_confirmed_at, last_updated_at, expires_at,
            evidence_count,
            first_order_effects_json, second_order_effects_json,
            validity_flags_json, confidence_reasons_json,
            detection_path, coverage_tier, authenticity_score, peak_z_score,
            cross_platform_corroboration, edge_multiplier, source_breadth_score,
            schema_version, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            fx["evidence_count"],
            json.dumps(fx["first_order_effects"]) if fx.get("first_order_effects") else None,
            json.dumps(fx["second_order_effects"]) if fx.get("second_order_effects") else None,
            json.dumps(fx["validity_flags"]) if fx.get("validity_flags") else None,
            json.dumps(fx["confidence_reasons"]) if fx.get("confidence_reasons") else None,
            fx["detection_path"],
            fx.get("coverage_tier"),
            fx.get("authenticity_score"),
            fx.get("peak_z_score"),
            1 if fx.get("cross_platform_corroboration") else 0,
            float(fx.get("edge_multiplier", 1.0)),
            fx.get("source_breadth_score"),
            EXPECTED_SCHEMA_VERSION,
            now,
            now,
        ),
    )
    return int(cur.lastrowid or 0)


def _resolve_situation_id(conn: sqlite3.Connection, slug: str) -> int:
    row = conn.execute(
        "SELECT id FROM market_situations WHERE slug = ?", (slug,)
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Situation not found after insert: slug={slug}")
    return int(row[0])


def _insert_signals(
    conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any], now: int
) -> List[int]:
    ids: List[int] = []
    for sig in fx.get("signals", []) or []:
        cur = conn.execute(
            """
            INSERT INTO situation_signals (
                situation_id, signal_type, source_type, source_id,
                entity, theme, score, weight, observed_at, ingested_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )
        ids.append(int(cur.lastrowid or 0))
    return ids


def _insert_evidence(
    conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any]
) -> int:
    n = 0
    for ev in fx.get("evidence", []) or []:
        conn.execute(
            """
            INSERT INTO situation_evidence (
                situation_id, evidence_type, source_name, headline_or_label,
                summary, url, published_at, importance_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )
        n += 1
    return n


def _insert_exposures(
    conn: sqlite3.Connection, situation_id: int, fx: Dict[str, Any], now: int
) -> int:
    n = 0
    for ex in fx.get("exposures", []) or []:
        conn.execute(
            """
            INSERT INTO situation_exposure (
                situation_id, asset_type, asset_key, exposure_direction, exposure_order,
                exposure_strength, source_method, rationale, confidence,
                universe_symbol, dcf_gap_pct, quality_score, technical_score,
                final_buzz_score, composite_rank, last_ranked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                float(ex.get("confidence", 0.7)),
                ex.get("universe_symbol"),
                ex.get("dcf_gap_pct"),
                ex.get("quality_score"),
                ex.get("technical_score"),
                ex.get("final_buzz_score"),
                ex.get("composite_rank"),
                now if ex.get("composite_rank") is not None else None,
            ),
        )
        n += 1
    return n


def _validate_theme_keys(conn: sqlite3.Connection, fixtures: List[Dict[str, Any]]) -> None:
    """Fail fast with a clear message if any fixture references a theme_key
    that isn't in the seeded theme_registry (the FK constraint would surface
    as a generic 'FOREIGN KEY constraint failed' otherwise)."""
    registry = {
        r[0]
        for r in conn.execute("SELECT theme_key FROM theme_registry").fetchall()
    }
    missing: List[Dict[str, str]] = []
    for fx in fixtures:
        theme = fx.get("primary_theme")
        if theme not in registry:
            missing.append({"slug": fx["slug"], "primary_theme": str(theme)})
    if missing:
        sample = ", ".join(sorted(registry))[:300]
        raise SystemExit(
            "Pre-flight check failed: the following fixtures reference unknown "
            f"primary_theme values: {missing}. Available theme_keys ({len(registry)}): {sample}..."
        )


def seed(db_path: Path, *, dry_run: bool, reset: bool) -> Dict[str, Any]:
    conn = _connect(db_path)
    try:
        schema_version = _check_schema_version(conn)
        fixtures = all_fixtures()
        _validate_theme_keys(conn, fixtures)

        result: Dict[str, Any] = {
            "db_path": str(db_path),
            "schema_version": schema_version,
            "dry_run": dry_run,
            "reset": reset,
            "scenarios": [],
            "deleted_before_reseed": None,
        }

        if reset and not dry_run:
            result["deleted_before_reseed"] = _wipe_scenarios(conn)

        for fx in fixtures:
            if dry_run:
                result["scenarios"].append(
                    {
                        "slug": fx["slug"],
                        "would_insert": True,
                        "signals": len(fx.get("signals", [])),
                        "evidence": len(fx.get("evidence", [])),
                        "exposures": len(fx.get("exposures", [])),
                    }
                )
                continue

            _insert_situation(conn, fx, NOW)
            situation_id = _resolve_situation_id(conn, fx["slug"])
            # Re-run is idempotent: clear child rows for this situation, then reinsert.
            conn.execute(
                "DELETE FROM situation_signals  WHERE situation_id = ?", (situation_id,)
            )
            conn.execute(
                "DELETE FROM situation_evidence WHERE situation_id = ?", (situation_id,)
            )
            conn.execute(
                "DELETE FROM situation_exposure WHERE situation_id = ?", (situation_id,)
            )

            n_signals = len(_insert_signals(conn, situation_id, fx, NOW))
            n_evidence = _insert_evidence(conn, situation_id, fx)
            n_exposures = _insert_exposures(conn, situation_id, fx, NOW)
            result["scenarios"].append(
                {
                    "slug": fx["slug"],
                    "situation_id": situation_id,
                    "signals": n_signals,
                    "evidence": n_evidence,
                    "exposures": n_exposures,
                }
            )

        if not dry_run:
            conn.commit()

        result["table_counts_after"] = {
            t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in SCENARIO_TABLES
        }
        return result
    finally:
        conn.close()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Seed dev scenarios into market-intelligence.sqlite")
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete all scenario rows before seeding (situation_*, NOT registries)",
    )
    args = parser.parse_args(argv)

    result = seed(args.db_path, dry_run=args.dry_run, reset=args.reset)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
