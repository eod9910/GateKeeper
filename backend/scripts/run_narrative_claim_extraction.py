#!/usr/bin/env python3
"""
Extract first-pass asymmetric narrative claims from Market Intelligence raw hits.

This is the v7 bridge from:

    mi_raw_hits -> emerging_claims

It is intentionally cheap and conservative. The first pass uses deterministic
rules for the hunting lanes we have locked in planning:

    ticker/company, theme/technology/policy, product/brand/consumer

An LLM-backed extractor can replace or augment this later, but the schema
should prove useful with existing local evidence before we add YouTube scale.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
EXPECTED_SCHEMA_VERSION = 7


@dataclass
class ClaimCandidate:
    claim_text: str
    claim_type: str
    source_hit_id: int
    detected_entities: List[str]
    detected_brands: List[str]
    detected_tickers: List[str]
    detected_themes: List[str]
    confidence: float
    validity_flags: List[str]


THEME_RULES: Sequence[Dict[str, Any]] = [
    {
        "theme": "financial_tokenization",
        "claim_type": "market_structure_shift",
        "claim_text": "U.S. equities may move toward tokenized, 24-hour, or on-chain trading infrastructure.",
        "patterns": [
            r"\btokeni[sz]ed (stock|stocks|equit|securit)",
            r"\bon[- ]?chain (stock|stocks|equit|trading|settlement)",
            r"\b24[- ]?hour trading\b",
            r"\bstablecoin (bank|banking|settlement|payments|rail|rails)",
            r"\bclarity act\b",
        ],
        "tickers": ["COIN", "HOOD", "ICE", "NDAQ", "CME", "IBKR", "SCHW"],
        "entities": ["SEC", "stablecoins", "tokenized equities"],
        "confidence": 0.62,
        "flags": ["VERIFY_PRIMARY_SOURCES", "POLICY_RUMOR_RISK"],
    },
    {
        "theme": "quantum_computing_commercialization",
        "claim_type": "technology_adoption",
        "claim_text": "Quantum computing may be shifting from science project to investable commercial theme.",
        "patterns": [
            r"\bquantum comput",
            r"\bqubit(s)?\b",
            r"\bquantum advantage\b",
            r"\bquantum (breakthrough|commerciali[sz]ation|supremacy)\b",
        ],
        "tickers": ["IONQ", "RGTI", "QBTS", "QUBT", "IBM", "GOOGL"],
        "entities": ["quantum computing"],
        "confidence": 0.58,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "defense_ai_operating_system",
        "claim_type": "technology_adoption",
        "claim_text": "Defense AI platforms may be becoming operational infrastructure for government and military workflows.",
        "patterns": [
            r"\bdefen[cs]e ai\b",
            r"\bmilitary ai\b",
            r"\bbattlefield ai\b",
            r"\bpalantir\b",
            r"\baip\b.*\b(defen[cs]e|military|government)\b",
        ],
        "tickers": ["PLTR", "LMT", "RTX", "NOC", "GD", "LHX"],
        "entities": ["defense AI", "government AI"],
        "confidence": 0.56,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "ai_power_grid_bottleneck",
        "claim_type": "supply_chain_signal",
        "claim_text": "AI data-center growth may be creating a power, grid, and infrastructure bottleneck.",
        "patterns": [
            r"\b(ai|data[- ]?center|datacenter).{0,50}\b(power|electricity|grid|energy)\b",
            r"\bpower.{0,40}\b(data[- ]?center|datacenter|ai)\b",
            r"\bgrid.{0,40}\b(data[- ]?center|datacenter|ai)\b",
        ],
        "tickers": ["VST", "CEG", "ETN", "GEV", "PWR", "NEE", "SO"],
        "entities": ["AI data centers", "power grid"],
        "confidence": 0.54,
        "flags": [],
    },
    {
        "theme": "consumer_product_breakout",
        "claim_type": "consumer_behavior_shift",
        "claim_text": "A consumer product or brand may be spreading organically before the demand shift is visible in earnings.",
        "patterns": [
            r"\beveryone (is|suddenly) (using|buying|switching to)\b",
            r"\bi switched to\b",
            r"\bthis (app|brand|drink|coffee|restaurant|product|tool) is everywhere\b",
            r"\b(blowing up|going viral|obsessed with)\b",
        ],
        "tickers": [],
        "entities": ["consumer behavior"],
        "confidence": 0.46,
        "flags": ["NEEDS_TICKER_MAPPING"],
    },
    {
        "theme": "ai_capex_acceleration",
        "claim_type": "capex_cycle_signal",
        "claim_text": "AI infrastructure spending may still be accelerating across chips, cloud, networking, and data-center suppliers.",
        "patterns": [
            r"\b(ai|genai|generative ai).{0,60}\b(capex|capital spending|infrastructure spend|data[- ]?center buildout)\b",
            r"\b(hyperscaler|cloud).{0,50}\b(ai|gpu|accelerator|data[- ]?center)\b",
            r"\b(gpu|accelerator).{0,50}\b(shortage|demand|orders|backlog)\b",
        ],
        "tickers": ["NVDA", "AMD", "AVGO", "MSFT", "GOOGL", "AMZN", "META", "ANET", "SMCI", "DELL"],
        "entities": ["AI capex", "hyperscalers", "data centers"],
        "confidence": 0.58,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "semis_supply_shock",
        "claim_type": "supply_chain_signal",
        "claim_text": "Semiconductor supply, export controls, or foundry constraints may be changing the investable setup.",
        "patterns": [
            r"\bsemiconductor(s)?\b.{0,70}\b(shortage|supply|export control|restriction|foundry|capacity)\b",
            r"\b(chip|chips)\b.{0,60}\b(shortage|supply|export control|restriction|foundry|capacity)\b",
            r"\btsmc\b|\basml\b|\bnvidia\b|\badvanced micro devices\b",
        ],
        "tickers": ["NVDA", "AMD", "AVGO", "TSM", "ASML", "INTC", "MU", "LRCX", "AMAT", "KLAC"],
        "entities": ["semiconductors", "chip supply"],
        "confidence": 0.57,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "energy_supply",
        "claim_type": "commodity_supply_signal",
        "claim_text": "Energy supply risk may be repricing oil, natural gas, or power-sensitive equities.",
        "patterns": [
            r"\b(oil|crude|brent|wti|natural gas|lng)\b.{0,60}\b(supply|inventory|output|production|sanction|opec|pipeline)\b",
            r"\b(opec|iran|russia|lng|pipeline)\b.{0,60}\b(oil|crude|natural gas|energy)\b",
        ],
        "tickers": ["XOM", "CVX", "COP", "EOG", "SLB", "HAL", "LNG", "KMI", "WMB", "OXY"],
        "entities": ["oil", "natural gas", "energy supply"],
        "confidence": 0.56,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "rates_higher",
        "claim_type": "macro_policy_signal",
        "claim_text": "Rates may stay higher for longer as inflation, yields, or central-bank guidance reset expectations.",
        "patterns": [
            r"\b(higher for longer|rate hike|rate hikes|hawkish|inflation sticky|sticky inflation)\b",
            r"\b(treasury yield|yields|bond yields)\b.{0,50}\b(rise|rising|jump|higher|surge)\b",
            r"\b(fed|fomc|powell)\b.{0,60}\b(hawkish|inflation|rates|cuts delayed)\b",
        ],
        "tickers": ["TLT", "TBT", "KRE", "JPM", "BAC", "SCHW", "XLF"],
        "entities": ["Federal Reserve", "rates", "inflation"],
        "confidence": 0.55,
        "flags": ["VERIFY_PRIMARY_SOURCES", "POLICY_RUMOR_RISK"],
    },
    {
        "theme": "rates_lower",
        "claim_type": "macro_policy_signal",
        "claim_text": "Rate-cut expectations may be rising as growth, labor, or inflation data soften.",
        "patterns": [
            r"\b(rate cut|rate cuts|dovish|cuts coming|easing cycle)\b",
            r"\b(fed|fomc|powell)\b.{0,60}\b(dovish|cut|cuts|easing)\b",
            r"\b(inflation|cpi|pce|jobs|payrolls)\b.{0,60}\b(cool|cooling|soften|slowing|weaker)\b",
        ],
        "tickers": ["TLT", "IEF", "KRE", "IWM", "XLRE", "VNQ", "XHB"],
        "entities": ["Federal Reserve", "rate cuts", "growth slowdown"],
        "confidence": 0.55,
        "flags": ["VERIFY_PRIMARY_SOURCES", "POLICY_RUMOR_RISK"],
    },
    {
        "theme": "healthcare_policy_change",
        "claim_type": "policy_signal",
        "claim_text": "Healthcare policy, drug pricing, or regulatory pressure may be changing sector risk.",
        "patterns": [
            r"\b(drug pricing|medicare negotiation|fda approval|fda rejection|pbm|healthcare policy)\b",
            r"\b(pharma|biotech|healthcare)\b.{0,60}\b(regulation|policy|pricing|approval|rejection)\b",
        ],
        "tickers": ["LLY", "NVO", "PFE", "MRK", "ABBV", "UNH", "CVS", "HUM", "BIIB", "REGN"],
        "entities": ["healthcare policy", "drug pricing", "FDA"],
        "confidence": 0.55,
        "flags": ["VERIFY_PRIMARY_SOURCES", "POLICY_RUMOR_RISK"],
    },
    {
        "theme": "china_growth",
        "claim_type": "macro_growth_signal",
        "claim_text": "China growth, stimulus, or trade data may be changing global cyclicals and commodity exposure.",
        "patterns": [
            r"\bchina\b.{0,70}\b(stimulus|growth|factory|pmi|exports|imports|industrial production|property)\b",
            r"\b(chinese)\b.{0,70}\b(stimulus|growth|factory|pmi|exports|imports|property)\b",
        ],
        "tickers": ["BABA", "JD", "PDD", "FXI", "KWEB", "BHP", "RIO", "FCX", "CAT", "DE"],
        "entities": ["China", "global growth", "commodities"],
        "confidence": 0.56,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
    {
        "theme": "consumer_weakness",
        "claim_type": "consumer_cycle_signal",
        "claim_text": "Consumer demand may be weakening through trade-down behavior, delinquencies, or soft retail commentary.",
        "patterns": [
            r"\b(consumer|retail|shopper|household)\b.{0,70}\b(weak|weakness|soft|slowing|trade down|trading down|delinquen)\b",
            r"\b(credit card|auto loan|student loan)\b.{0,60}\b(delinquen|stress|default|late payment)\b",
        ],
        "tickers": ["WMT", "TGT", "COST", "DG", "DLTR", "M", "KSS", "XRT", "COF", "DFS"],
        "entities": ["consumer weakness", "retail", "credit stress"],
        "confidence": 0.54,
        "flags": ["VERIFY_PRIMARY_SOURCES"],
    },
]

TICKER_RE = re.compile(r"(?<![A-Z0-9])\$?([A-Z]{1,5})(?![A-Z0-9])")
COMMON_FALSE_TICKERS = {
    "A",
    "AI",
    "API",
    "CEO",
    "CFO",
    "CTO",
    "ETF",
    "FDA",
    "GDP",
    "IPO",
    "LLM",
    "SEC",
    "USA",
    "USD",
}


def open_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[claims] DB missing at {db_path}")
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
            f"[claims] schema_version {actual!r} is below "
            f"{EXPECTED_SCHEMA_VERSION}; run build_market_intelligence_db.py"
        )


def load_candidate_hits(
    conn: sqlite3.Connection,
    *,
    limit: int,
    since_hours: Optional[int],
) -> List[sqlite3.Row]:
    where = ""
    params: List[Any] = []
    if since_hours is not None and since_hours > 0:
        cutoff = int(time.time()) - int(since_hours) * 3600
        where = "WHERE posted_at >= ?"
        params.append(cutoff)
    params.append(limit)
    return conn.execute(
        f"""
        SELECT id, source_type, source_post_id, source_url, source_community,
               author, title, body_text, posted_at, fetched_at,
               matched_concept_ids_json, raw_payload_json
        FROM mi_raw_hits
        {where}
        ORDER BY posted_at DESC, id DESC
        LIMIT ?
        """,
        params,
    ).fetchall()


def combined_text(row: sqlite3.Row) -> str:
    parts = [
        str(row["title"] or ""),
        str(row["body_text"] or ""),
    ]
    return "\n".join(p for p in parts if p).strip()


def extract_tickers(text: str, seeded: Sequence[str]) -> List[str]:
    found: Set[str] = {str(t).upper() for t in seeded if str(t).strip()}
    for match in TICKER_RE.finditer(text):
        ticker = match.group(1).upper()
        if ticker in COMMON_FALSE_TICKERS:
            continue
        # Keep explicit $TICKER only. Seeded exposure lists carry known
        # beneficiaries; free all-caps extraction is too noisy for prose.
        raw = match.group(0)
        if raw.startswith("$"):
            found.add(ticker)
    return sorted(found)


def extract_claims_from_hit(row: sqlite3.Row) -> List[ClaimCandidate]:
    text = combined_text(row)
    if len(text) < 80:
        return []

    text_lower = text.lower()
    claims: List[ClaimCandidate] = []
    for rule in THEME_RULES:
        matched = any(re.search(pattern, text_lower, flags=re.IGNORECASE) for pattern in rule["patterns"])
        if not matched:
            continue
        tickers = extract_tickers(text, rule.get("tickers", []))
        flags = list(rule.get("flags", []))
        if row["source_type"] == "youtube_transcript":
            flags.append("SINGLE_SOURCE_RISK")
        claims.append(
            ClaimCandidate(
                claim_text=str(rule["claim_text"]),
                claim_type=str(rule["claim_type"]),
                source_hit_id=int(row["id"]),
                detected_entities=sorted(set(rule.get("entities", []))),
                detected_brands=[],
                detected_tickers=tickers,
                detected_themes=[str(rule["theme"])],
                confidence=float(rule.get("confidence", 0.5)),
                validity_flags=sorted(set(flags)),
            )
        )
    return claims


def content_hash_for(claim: ClaimCandidate) -> str:
    payload = {
        "claim_text": claim.claim_text,
        "source_hit_ids": [claim.source_hit_id],
        "themes": claim.detected_themes,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def insert_claim(
    conn: sqlite3.Connection,
    claim: ClaimCandidate,
    *,
    now: int,
) -> bool:
    content_hash = content_hash_for(claim)
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO emerging_claims (
            claim_text, claim_type, source_hit_ids_json,
            detected_entities_json, detected_brands_json, detected_tickers_json,
            detected_themes_json, event_dates_json, confidence,
            verification_status, validity_flags_json, extraction_method,
            extraction_model, content_hash, first_seen_at, last_seen_at,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            claim.claim_text,
            claim.claim_type,
            json.dumps([claim.source_hit_id]),
            json.dumps(claim.detected_entities),
            json.dumps(claim.detected_brands),
            json.dumps(claim.detected_tickers),
            json.dumps(claim.detected_themes),
            json.dumps([]),
            claim.confidence,
            "needs_primary_source"
            if "VERIFY_PRIMARY_SOURCES" in claim.validity_flags
            else "unverified",
            json.dumps(claim.validity_flags),
            "rule_based",
            None,
            content_hash,
            now,
            now,
            now,
            now,
        ),
    )
    return cur.rowcount > 0


def run(
    *,
    db_path: Path,
    limit: int,
    since_hours: Optional[int],
    dry_run: bool,
) -> Dict[str, Any]:
    conn = open_db(db_path)
    try:
        assert_schema(conn)
        rows = load_candidate_hits(conn, limit=limit, since_hours=since_hours)
        claims: List[ClaimCandidate] = []
        for row in rows:
            claims.extend(extract_claims_from_hit(row))

        inserted = 0
        now = int(time.time())
        if not dry_run:
            for claim in claims:
                if insert_claim(conn, claim, now=now):
                    inserted += 1
            conn.commit()

        return {
            "ok": True,
            "dry_run": dry_run,
            "hits_scanned": len(rows),
            "claims_found": len(claims),
            "claims_inserted": inserted,
            "sample_claims": [
                {
                    "claim_text": c.claim_text,
                    "claim_type": c.claim_type,
                    "source_hit_id": c.source_hit_id,
                    "detected_themes": c.detected_themes,
                    "detected_tickers": c.detected_tickers[:10],
                    "validity_flags": c.validity_flags,
                    "confidence": c.confidence,
                }
                for c in claims[:10]
            ],
        }
    finally:
        conn.close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract first-pass narrative claims from mi_raw_hits."
    )
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--since-hours", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    summary = run(
        db_path=Path(args.db_path),
        limit=max(1, int(args.limit)),
        since_hours=args.since_hours,
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
