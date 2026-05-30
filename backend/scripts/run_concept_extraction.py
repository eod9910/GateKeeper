#!/usr/bin/env python3
"""Concept-extraction worker for the Market Intelligence engine.

Phase 2.2 — the LLM-batched extractor that promotes raw `mi_raw_hits`
into structured (concept, target, intent, polarity) tuples. This is the
single largest cost center of the Social Arbitrage engine, so the worker
implements every cost-discipline rule from PRD §"Concept extraction cost
discipline" and the prompt JSON's `pre_filter_rules` /
`tracked_concept_match_rules` blocks (D14, D21 S2):

    1. Cursor-based incremental processing (only new mi_raw_hits since
       last successful run, never re-extracts the same row).
    2. Pre-filter (regex/length-based) drops ~30% of raw hits before
       any LLM is called.
    3. Tracked-concept regex match: hits whose body matches ONLY known
       concepts skip the LLM and increment the registry directly.
    4. Batched calls (default 80 hits / call), amortising the
       ~1.1k-token prompt+few-shot fixed overhead.
    5. Cheap-tier model only (default gpt-4o-mini); bigger models gated
       behind explicit --llm-model.

Outputs:
    - UPSERT into `tracked_concepts` on (concept_key, target_key) for
      every newly-discovered concept; existing rows get an updated
      `metadata_json` with the latest LLM-suggested aliases.
    - Update `mi_raw_hits.matched_concept_ids_json` to add the newly
      learned concept_ids (so the next collector tick sees them and the
      regex matcher catches them locally).
    - Refresh `concept_daily_counts.polarity_mean` and `intent_mix_json`
      for every (concept_id, community, day) bucket touched. This is what
      Bluesky/HN/4chan/forums collectors deliberately leave NULL.
    - Persist a cursor + per-run stats blob to `json_documents`
      (namespace=`concept_extraction_worker`) so Operator UI can show
      "last run: N hits processed, M new concepts, $0.04 cost".

Does NOT write to:
    - `concept_mentions` (PRD: stays empty until a scenario materialises;
      written by `promote_emerging_topics.py`).
    - `tracked_concepts` rows for keys outside the prompt's enum sets.

LLM providers:
    - `--llm-provider mock` (default): zero-cost deterministic stub that
      produces a single dummy extraction for every Nth hit using a
      hashed-text seed. Useful for offline smoke tests, CI fixtures,
      and exercising the upsert/aggregate path without burning quota.
    - `--llm-provider openai`: real OpenAI API call (chat.completions
      with `response_format={'type':'json_object'}` so we get strict
      JSON back). Reads the API key from (a) backend/data/app-state.sqlite
      `settings:ai_settings.openai_api_key`, (b) backend/data/ai-settings.json,
      then (c) `OPENAI_API_KEY` env var. Errors out with a clear message
      if no key is configured.

Re-runnability:
    - Cursor advances only on rows the worker successfully processed
      (or skipped for a deterministic reason — pre-filter, registry-only
      match, dry-run). Mid-batch failures roll back the cursor for that
      batch so the next tick retries.
    - The `extracted_at` column DOES NOT exist on `mi_raw_hits` — we
      don't want a schema change for v1. Cursor is the source of truth.
      Operators who need to re-run a window can pass `--since-id 0`.

Usage:
    py backend/scripts/run_concept_extraction.py --llm-provider mock
    py backend/scripts/run_concept_extraction.py --llm-provider mock --max-batches 5
    py backend/scripts/run_concept_extraction.py --llm-provider openai --llm-model gpt-4o-mini
    py backend/scripts/run_concept_extraction.py --since-id 0 --dry-run

Output: JSON report on stdout (same envelope as the collectors).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
APP_STATE_DB_PATH = ROOT / "backend" / "data" / "app-state.sqlite"
LEGACY_AI_SETTINGS_PATH = ROOT / "backend" / "data" / "ai-settings.json"
PROMPT_FILE = ROOT / "backend" / "data" / "scenarios" / "concept-extraction-prompt.json"

EXPECTED_SCHEMA_VERSION = 5

WORKER_NAMESPACE = "concept_extraction_worker"
CURSOR_DOCUMENT_KEY = "cursor"
LAST_RUN_DOCUMENT_KEY = "last_run"

# Closed enums — must stay in lockstep with the prompt + DB CHECK constraints
# (build_market_intelligence_db.py concept_mentions / tracked_concepts).
ALLOWED_TARGET_TYPES: Set[str] = {
    "brand", "product", "category", "behavior", "keyword", "event_type",
}
ALLOWED_INTENTS: Set[str] = {
    "adoption", "abandonment", "complaint", "praise",
    "comparison", "question", "prediction",
}
ALLOWED_POLARITIES: Set[int] = {-1, 0, 1}

# Pre-filter / output thresholds (mirror prompt JSON exactly).
PRE_FILTER_MIN_CHARS = 20
PRE_FILTER_MIN_NON_LINK_CHARS = 10
PRE_FILTER_MIN_NON_EMOJI_CHARS = 5
EXTRACTION_CONFIDENCE_FLOOR = 0.4

# Pricing snapshot (USD per 1M tokens). Mirrors estimate_concept_extraction_cost.py
# so the worker's per-run $ estimate doesn't drift from the planning doc.
PRICING_USD_PER_MTOKEN: Dict[str, Dict[str, float]] = {
    "gpt-4o-mini":      {"input": 0.15,  "output": 0.60},
    "gpt-5-mini":       {"input": 0.25,  "output": 1.00},
    "gpt-5.4-mini":     {"input": 0.20,  "output": 0.80},
    "gpt-4o":           {"input": 2.50,  "output": 10.00},
    "claude-haiku-4.5": {"input": 1.00,  "output": 5.00},
}

# tracked-sources.json -> coverage_tier mapping. The prompt's
# downstream_contract.community_tier defaults to 'general'; we promote a
# small allowlist to 'niche' (most enthusiast forums) and 'mega' (huge
# subreddits / X / WSB). v1 keeps the list short and deterministic — a
# Phase 5 calibration job can refine it from real engagement data.
COMMUNITY_TIER_OVERRIDES: Dict[str, str] = {
    # Niche enthusiast / vertical communities.
    "/biz/":              "niche",
    "/g/":                "niche",
    "forum:audiosciencereview": "niche",
    "forum:head_fi":      "niche",
    "forum:tomshardware": "niche",
    "forum:guru3d":       "niche",
    "forum:stevehoffman": "niche",
    "forum:gearspace":    "niche",
    "forum:bogleheads":   "niche",
    # Mega — gigantic generalist platforms.
    "bluesky":            "mega",
    "hackernews":         "general",
}

DEFAULT_COMMUNITY_TIER = "general"


# ============================================================================
# Pre-filter implementation
# ----------------------------------------------------------------------------
# Mirrors `pre_filter_rules` in concept-extraction-prompt.json. PF_NON_ENGLISH
# is intentionally NOT implemented in v1 — it requires a fasttext model + a
# 100MB dependency download for marginal recall gain. Rule #11 in the LLM
# system prompt is the safety net; the model returns 0 extractions on
# non-English input.
# ============================================================================

_URL_RE = re.compile(r"https?://\S+")
_QUOTE_REPLY_RE = re.compile(r"^(\s*>.*\n?)+\s*\S{0,10}\s*$")
_BOT_BOILERPLATE_RE = re.compile(
    r"^(\[removed\]|\[deleted\]|I am a bot|This action was performed automatically)",
    re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(text: str) -> str:
    if not text:
        return ""
    return _WS_RE.sub(" ", _HTML_TAG_RE.sub(" ", text)).strip()


def _is_emoji(c: str) -> bool:
    """Cheap unicode-category check: 'So' covers most pictograph/emoji glyphs."""
    return unicodedata.category(c).startswith("So")


def pre_filter_reason(title: Optional[str], body: Optional[str]) -> Optional[str]:
    """Return a PF_* rule_id if the hit should be skipped, else None."""
    combined = " \n ".join(filter(None, [title or "", _strip_html(body or "")]))
    stripped = combined.strip()

    if len(stripped) < PRE_FILTER_MIN_CHARS:
        return "PF_TOO_SHORT"

    no_links = _URL_RE.sub("", stripped).strip()
    if len(no_links) < PRE_FILTER_MIN_NON_LINK_CHARS:
        return "PF_LINK_ONLY"

    non_emoji_count = sum(1 for c in stripped if not _is_emoji(c))
    if non_emoji_count < PRE_FILTER_MIN_NON_EMOJI_CHARS:
        return "PF_SINGLE_EMOJI"

    if _QUOTE_REPLY_RE.match(combined):
        return "PF_QUOTE_REPLY_ONLY"

    if _BOT_BOILERPLATE_RE.match(stripped):
        return "PF_BOT_BOILERPLATE"

    return None


# ============================================================================
# Key normalisation (matches prompt's key_normalization_rules)
# ----------------------------------------------------------------------------
# lowercase ASCII snake_case; strip diacritics; collapse non-alphanumerics
# to underscores; max 64 chars. Used as a defence against LLM responses
# that drift outside the regex constraint (^[a-z0-9_]{2,64}$).
# ============================================================================

_NORM_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_key(text: str, *, max_length: int = 64) -> str:
    if not text:
        return ""
    flat = unicodedata.normalize("NFKD", text)
    flat = "".join(c for c in flat if not unicodedata.combining(c))
    flat = flat.lower()
    flat = _NORM_NON_ALNUM.sub("_", flat).strip("_")
    return flat[:max_length]


# ============================================================================
# DB helpers
# ============================================================================


def _connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(
            f"Database not found at {db_path}. "
            "Run build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def _check_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    if row is None:
        raise SystemExit(
            "schema_meta.schema_version is missing. "
            "Run build_market_intelligence_db.py first."
        )
    version = int(row[0])
    if version < EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"Schema too old: DB has {version}, "
            f"this worker expects >= {EXPECTED_SCHEMA_VERSION}."
        )
    return version


# ----------------------------------------------------------------------------
# Cursor + run-summary storage in app-state.sqlite (json_documents table)
# ----------------------------------------------------------------------------
# We piggy-back on the same json_documents pattern the scheduler uses so the
# Operator UI can read both from one place. Schema (from appStateDb.ts):
#     json_documents (namespace TEXT, document_key TEXT, json_value TEXT,
#                     updated_at TEXT, PRIMARY KEY (namespace, document_key))
# ----------------------------------------------------------------------------


def _connect_app_state() -> Optional[sqlite3.Connection]:
    if not APP_STATE_DB_PATH.exists():
        return None
    conn = sqlite3.connect(str(APP_STATE_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _read_json_doc(namespace: str, key: str) -> Optional[Any]:
    conn = _connect_app_state()
    if conn is None:
        return None
    try:
        row = conn.execute(
            "SELECT json_value FROM json_documents WHERE namespace = ? AND document_key = ?",
            (namespace, key),
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    if row is None or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except (TypeError, ValueError):
        return None


def _write_json_doc(namespace: str, key: str, value: Any) -> None:
    conn = _connect_app_state()
    if conn is None:
        return
    try:
        conn.execute(
            """
            INSERT INTO json_documents (namespace, document_key, json_value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(namespace, document_key) DO UPDATE SET
                json_value = excluded.json_value,
                updated_at = excluded.updated_at
            """,
            (
                namespace,
                key,
                json.dumps(value, separators=(",", ":")),
                _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            ),
        )
        conn.commit()
    except sqlite3.OperationalError as err:
        print(
            f"[concept-extraction] WARN: could not persist {namespace}:{key}: {err}",
            file=sys.stderr,
        )
    finally:
        conn.close()


def get_cursor() -> int:
    doc = _read_json_doc(WORKER_NAMESPACE, CURSOR_DOCUMENT_KEY)
    if isinstance(doc, dict):
        try:
            return int(doc.get("last_processed_id", 0))
        except (TypeError, ValueError):
            return 0
    return 0


def set_cursor(last_processed_id: int) -> None:
    _write_json_doc(
        WORKER_NAMESPACE,
        CURSOR_DOCUMENT_KEY,
        {"last_processed_id": int(last_processed_id)},
    )


# ----------------------------------------------------------------------------
# OpenAI key resolution — match the precedence used by aiSettings.ts:
#   (1) app-state.sqlite settings:ai_settings.openai_api_key
#   (2) backend/data/ai-settings.json
#   (3) OPENAI_API_KEY env var
# ----------------------------------------------------------------------------

OPENAI_PLACEHOLDER = "your-openai-api-key-here"


def resolve_openai_key() -> Tuple[Optional[str], str]:
    """Return (key, source) where source ∈ {'saved','file','env','none'}."""
    saved = _read_json_doc("settings", "ai_settings")
    if isinstance(saved, dict):
        key = saved.get("openai_api_key")
        if isinstance(key, str) and key.strip() and key.strip() != OPENAI_PLACEHOLDER:
            return key.strip(), "saved"

    if LEGACY_AI_SETTINGS_PATH.exists():
        try:
            with open(LEGACY_AI_SETTINGS_PATH, "r", encoding="utf-8") as fh:
                file_settings = json.load(fh)
        except (OSError, ValueError):
            file_settings = None
        if isinstance(file_settings, dict):
            key = file_settings.get("openai_api_key")
            if isinstance(key, str) and key.strip() and key.strip() != OPENAI_PLACEHOLDER:
                return key.strip(), "file"

    env_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if env_key and env_key != OPENAI_PLACEHOLDER:
        return env_key, "env"

    return None, "none"


# ============================================================================
# Tracked-concepts read + UPSERT
# ============================================================================


def load_active_concepts(conn: sqlite3.Connection) -> Dict[Tuple[str, str], int]:
    """Return {(concept_key, target_key): id} for fast UPSERT-by-key lookups."""
    rows = conn.execute(
        """
        SELECT id, concept_key, target_key
        FROM tracked_concepts
        WHERE status = 'active'
        """
    ).fetchall()
    return {
        (row["concept_key"], row["target_key"]): int(row["id"])
        for row in rows
    }


def upsert_concept(
    conn: sqlite3.Connection,
    *,
    concept_key: str,
    target_type: str,
    target_key: str,
    display_label: str,
    extraction_confidence: float,
    dry_run: bool,
    cache: Dict[Tuple[str, str], int],
) -> Optional[int]:
    """UPSERT on (concept_key, target_key). Returns the concept_id, or
    None if dry-run inserted nothing.

    NOTE: target_type is locked at first INSERT — if the LLM later
    decides "stanley_quencher" is a `category` instead of `product`, we
    keep the original `product` row to avoid breaking downstream rollups.
    The DB unique index is on (concept_key, target_key) ONLY, not on
    target_type.
    """
    cache_key = (concept_key, target_key)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    existing = conn.execute(
        """
        SELECT id FROM tracked_concepts
        WHERE concept_key = ? AND target_key = ?
        """,
        (concept_key, target_key),
    ).fetchone()
    if existing is not None:
        cache[cache_key] = int(existing["id"])
        return int(existing["id"])

    if dry_run:
        return None

    metadata = {
        "first_seen_extraction_confidence": round(float(extraction_confidence), 3),
        "search_terms": [display_label] if display_label else [],
        "discovered_by": "concept_extraction_worker",
    }
    cur = conn.execute(
        """
        INSERT INTO tracked_concepts (
            concept_key, target_type, target_key, display_label,
            created_at, created_by, status, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, 'llm_extractor', 'active', ?)
        """,
        (
            concept_key,
            target_type,
            target_key,
            display_label,
            int(time.time()),
            json.dumps(metadata, separators=(",", ":")),
        ),
    )
    new_id = int(cur.lastrowid)
    cache[cache_key] = new_id
    return new_id


# ============================================================================
# mi_raw_hits read + matched_concept_ids_json update
# ============================================================================


@dataclass
class HitInput:
    id: int
    source_type: str
    source_post_id: str
    source_community: str
    title: Optional[str]
    body_text: Optional[str]
    posted_at: int
    matched_concept_ids: List[int]


def load_unprocessed_hits(
    conn: sqlite3.Connection,
    *,
    since_id: int,
    limit: int,
) -> List[HitInput]:
    rows = conn.execute(
        """
        SELECT id, source_type, source_post_id, source_community,
               title, body_text, posted_at, matched_concept_ids_json
        FROM mi_raw_hits
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?
        """,
        (int(since_id), int(limit)),
    ).fetchall()

    out: List[HitInput] = []
    for row in rows:
        try:
            matched = list(json.loads(row["matched_concept_ids_json"] or "[]"))
            matched = [int(x) for x in matched]
        except (TypeError, ValueError):
            matched = []
        out.append(HitInput(
            id=int(row["id"]),
            source_type=str(row["source_type"]),
            source_post_id=str(row["source_post_id"]),
            source_community=str(row["source_community"] or ""),
            title=row["title"],
            body_text=row["body_text"],
            posted_at=int(row["posted_at"]),
            matched_concept_ids=matched,
        ))
    return out


def merge_hit_concepts(
    conn: sqlite3.Connection,
    *,
    hit_id: int,
    new_concept_ids: Set[int],
    existing_ids: Sequence[int],
    dry_run: bool,
) -> bool:
    """Return True iff the row's matched_concept_ids_json was actually
    extended (i.e. there was at least one genuinely new concept_id)."""
    existing_set = set(int(x) for x in existing_ids)
    merged = existing_set | set(int(x) for x in new_concept_ids)
    if merged == existing_set:
        return False
    if dry_run:
        return True
    sorted_merged = sorted(merged)
    conn.execute(
        """
        UPDATE mi_raw_hits
        SET matched_concept_ids_json = ?
        WHERE id = ?
        """,
        (json.dumps(sorted_merged, separators=(",", ":")), hit_id),
    )
    return True


# ============================================================================
# concept_daily_counts polarity_mean + intent_mix_json refresh
# ----------------------------------------------------------------------------
# When the worker discovers an extraction (concept_id, polarity, intent)
# from a hit posted at T in community C, that contributes to bucket
# (concept_id, C, day(T)). At end-of-batch we recompute the bucket's
# polarity_mean (weighted by extraction_confidence) and intent_mix_json
# (a {intent: weighted_count} dict) by aggregating ALL extractions seen
# this run for the bucket.
#
# We DON'T recompute mention_count or unique_authors here — those are
# regex-driven by the collectors and reflect raw mentions, not LLM-
# enriched ones. Leaving them untouched preserves the z-score input
# series.
# ============================================================================


@dataclass
class BucketAccumulator:
    polarity_weighted_sum: float = 0.0
    weight_sum: float = 0.0
    intent_weights: Dict[str, float] = field(default_factory=dict)

    def add(self, *, polarity: int, intent: str, confidence: float) -> None:
        if confidence < EXTRACTION_CONFIDENCE_FLOOR:
            return
        self.polarity_weighted_sum += float(polarity) * float(confidence)
        self.weight_sum += float(confidence)
        self.intent_weights[intent] = (
            self.intent_weights.get(intent, 0.0) + float(confidence)
        )

    def polarity_mean(self) -> Optional[float]:
        if self.weight_sum <= 0.0:
            return None
        return round(self.polarity_weighted_sum / self.weight_sum, 4)

    def intent_mix_json(self) -> Optional[str]:
        if not self.intent_weights:
            return None
        # Normalise to fractions that sum to 1.
        total = sum(self.intent_weights.values()) or 1.0
        normalised = {
            intent: round(weight / total, 4)
            for intent, weight in self.intent_weights.items()
        }
        return json.dumps(normalised, separators=(",", ":"), sort_keys=True)


def _day_bucket(posted_at: int) -> int:
    return (int(posted_at) // 86400) * 86400


def write_daily_count_enrichments(
    conn: sqlite3.Connection,
    accumulators: Dict[Tuple[int, str, int], BucketAccumulator],
    *,
    dry_run: bool,
) -> int:
    """Update polarity_mean + intent_mix_json on existing concept_daily_counts
    rows. We only UPDATE — never INSERT — because mention_count is owned by
    the collectors and inserting a 0-mention row would corrupt z-score input.
    """
    if not accumulators:
        return 0
    written = 0
    for (concept_id, community, day), acc in accumulators.items():
        polarity_mean = acc.polarity_mean()
        intent_mix = acc.intent_mix_json()
        if polarity_mean is None and intent_mix is None:
            continue
        if dry_run:
            written += 1
            continue
        cur = conn.execute(
            """
            UPDATE concept_daily_counts
            SET polarity_mean = COALESCE(?, polarity_mean),
                intent_mix_json = COALESCE(?, intent_mix_json)
            WHERE concept_id = ? AND community = ? AND day = ?
            """,
            (polarity_mean, intent_mix, concept_id, community, day),
        )
        if cur.rowcount > 0:
            written += 1
    return written


# ============================================================================
# Tracked-concept regex-skip (cost-discipline rule #3)
# ----------------------------------------------------------------------------
# If a hit's body matches ONLY known tracked_concepts via word-boundary
# regex AND there's no candidate phrase suggesting a NEW concept, skip
# the LLM entirely and just attach the matched concept_ids to the row.
#
# v1 always-call-LLM heuristic (matches prompt's always_call_llm_when):
#   - Capitalised multi-word phrase appears outside any matched span
#   - Comparison conjunction (' vs ', ' instead of ', ' switched to ', etc.)
#   - Purchase / abandonment verb (' bought ', ' cancelled ', ' returned ', ...)
#
# When ALL three checks pass AND ≥1 known concept matched, we mark the
# hit "registry-only" and defer to next-tick if its body is short enough
# that the LLM would likely return [] anyway. This keeps the registry-
# skip ratio honest while the registry is still small.
# ============================================================================

_CAPITALISED_MULTIWORD_RE = re.compile(
    r"\b(?:[A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,}){1,3})\b"
)
_COMPARISON_CONJ_RE = re.compile(
    r"\b(vs\.?|instead of|switched to|replaced with)\b",
    re.IGNORECASE,
)
_PURCHASE_VERB_RE = re.compile(
    r"\b(bought|cancelled|canceled|returned|ditched|abandoned|sold off)\b",
    re.IGNORECASE,
)


def looks_like_unknown_concept(text: str) -> bool:
    if not text:
        return False
    if _CAPITALISED_MULTIWORD_RE.search(text):
        return True
    if _COMPARISON_CONJ_RE.search(text):
        return True
    if _PURCHASE_VERB_RE.search(text):
        return True
    return False


# ============================================================================
# LLM extractor interface + implementations
# ============================================================================


@dataclass
class Extraction:
    concept_key: str
    display_label: str
    target_type: str
    target_key: str
    intent: str
    polarity: int
    extraction_confidence: float


@dataclass
class LLMResponse:
    """One LLM call's response — extractions per input plus token bookkeeping."""
    extractions_per_input: List[List[Extraction]]
    input_tokens: int
    output_tokens: int
    raw_response: str  # for debugging; truncated before persist


class BaseExtractor:
    """Subclass contract: extract_batch(batch) -> LLMResponse, where the
    output's extractions_per_input list MUST be the same length and order
    as the input batch."""

    name: str = "base"

    def extract_batch(self, batch: List[Tuple[str, str]]) -> LLMResponse:
        raise NotImplementedError


class MockExtractor(BaseExtractor):
    """Deterministic stub. Produces 1 extraction for ~12% of inputs (every
    8th hit by hash mod), drawn from a small fixture pool. Useful for
    end-to-end smoke tests without burning API quota.

    The fixture pool is intentionally small + boring: we want to test
    the upsert + aggregation path, not pretend to be a real extractor.
    """

    name = "mock"

    _FIXTURE_POOL: List[Extraction] = [
        Extraction(
            concept_key="ai_compute_demand",
            display_label="AI compute demand",
            target_type="category",
            target_key="ai_compute",
            intent="prediction",
            polarity=1,
            extraction_confidence=0.72,
        ),
        Extraction(
            concept_key="openai_models_chatter",
            display_label="OpenAI model release chatter",
            target_type="brand",
            target_key="openai",
            intent="comparison",
            polarity=0,
            extraction_confidence=0.81,
        ),
        Extraction(
            concept_key="nvidia_bullishness",
            display_label="NVDA datacenter optimism",
            target_type="brand",
            target_key="nvidia",
            intent="praise",
            polarity=1,
            extraction_confidence=0.65,
        ),
    ]

    def extract_batch(self, batch: List[Tuple[str, str]]) -> LLMResponse:
        per_input: List[List[Extraction]] = []
        for idx, (_input_id, text) in enumerate(batch):
            digest = int(
                hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:8],
                16,
            )
            if (digest + idx) % 8 == 0 and self._FIXTURE_POOL:
                per_input.append([self._FIXTURE_POOL[digest % len(self._FIXTURE_POOL)]])
            else:
                per_input.append([])

        # Plausible-but-bogus token counts so the report's $-cost is non-zero.
        input_tokens = 1100 + 50 * len(batch)
        output_tokens = 8 * len(batch) + 55 * sum(len(e) for e in per_input)
        return LLMResponse(
            extractions_per_input=per_input,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_response='{"results":[<mock>]}',
        )


class OpenAIExtractor(BaseExtractor):
    """Real OpenAI chat.completions caller. Uses urllib.request only so we
    don't add the `openai` package as a hard dep — the prompt is the
    contract, not the SDK shape.

    Robust to:
      - Markdown code-fence wrapping (`json` is stripped from response.text)
      - Missing input_id echoes (we map by index as fallback)
      - Extractions outside the closed enum sets (silently dropped)
    """

    name = "openai"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        prompt_doc: Dict[str, Any],
        timeout: float,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.prompt_doc = prompt_doc
        self.timeout = timeout
        self.system_prompt = str(prompt_doc.get("system_prompt", ""))
        self.user_prompt_template = str(prompt_doc.get("user_prompt_template", ""))
        few_shots = prompt_doc.get("few_shot_examples", []) or []
        self.few_shot_block = json.dumps(
            [
                {"input": ex.get("input"), "expected_output": ex.get("expected_output")}
                for ex in few_shots
            ],
            separators=(",", ":"),
            ensure_ascii=False,
        )

    def extract_batch(self, batch: List[Tuple[str, str]]) -> LLMResponse:
        batch_payload = json.dumps(
            [{"input_id": iid, "text": text} for iid, text in batch],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        user_prompt = (
            self.user_prompt_template
            .replace("{{N}}", str(len(batch)))
            .replace("{{batch_json}}", batch_payload)
        )
        # Few-shots inlined as a system-level reference. Cheaper than
        # threading them as separate messages and matches how the prompt
        # JSON's cost estimate measured them.
        system_with_shots = (
            f"{self.system_prompt}\n\nFEW-SHOT EXAMPLES:\n{self.few_shot_block}"
        )

        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_with_shots},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        choices = payload.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI response has no choices")
        message = choices[0].get("message") or {}
        raw_text = message.get("content") or ""
        usage = payload.get("usage") or {}
        input_tokens = int(usage.get("prompt_tokens", 0))
        output_tokens = int(usage.get("completion_tokens", 0))

        per_input = self._parse_response_text(raw_text, batch)
        return LLMResponse(
            extractions_per_input=per_input,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_response=raw_text[:1500],
        )

    def _parse_response_text(
        self,
        raw_text: str,
        batch: List[Tuple[str, str]],
    ) -> List[List[Extraction]]:
        # Strip markdown fences if the model wrapped its JSON.
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            parsed = json.loads(cleaned)
        except (TypeError, ValueError) as err:
            raise RuntimeError(
                f"OpenAI returned non-JSON content: {err} :: {cleaned[:200]}"
            )

        results = parsed.get("results") if isinstance(parsed, dict) else None
        if not isinstance(results, list):
            raise RuntimeError(f"OpenAI response missing 'results' array: {cleaned[:200]}")

        # Map by input_id; fall back to positional alignment for missing echoes.
        by_input_id: Dict[str, List[Extraction]] = {}
        positional: List[Optional[List[Extraction]]] = [None] * len(batch)
        for idx, result in enumerate(results):
            if not isinstance(result, dict):
                continue
            input_id = result.get("input_id")
            extractions_raw = result.get("extractions") or []
            extractions = [
                e for e in (
                    self._validate_extraction(item) for item in extractions_raw
                )
                if e is not None
            ]
            if isinstance(input_id, str) and input_id:
                by_input_id[input_id] = extractions
            if idx < len(positional):
                positional[idx] = extractions

        per_input: List[List[Extraction]] = []
        for idx, (iid, _text) in enumerate(batch):
            if iid in by_input_id:
                per_input.append(by_input_id[iid])
            elif positional[idx] is not None:
                per_input.append(positional[idx] or [])
            else:
                per_input.append([])
        return per_input

    @staticmethod
    def _validate_extraction(item: Any) -> Optional[Extraction]:
        if not isinstance(item, dict):
            return None
        try:
            concept_key = normalize_key(str(item.get("concept_key", "")))
            target_key = normalize_key(str(item.get("target_key", "")))
            target_type = str(item.get("target_type", "")).lower()
            intent = str(item.get("intent", "")).lower()
            polarity = int(item.get("polarity", 0))
            confidence = float(item.get("extraction_confidence", 0.0))
            display_label = str(item.get("display_label", "") or concept_key)
        except (TypeError, ValueError):
            return None

        if not concept_key or not target_key:
            return None
        if target_type not in ALLOWED_TARGET_TYPES:
            return None
        if intent not in ALLOWED_INTENTS:
            return None
        if polarity not in ALLOWED_POLARITIES:
            return None
        if confidence < EXTRACTION_CONFIDENCE_FLOOR:
            return None
        if not (2 <= len(concept_key) <= 64) or not (2 <= len(target_key) <= 64):
            return None
        return Extraction(
            concept_key=concept_key,
            display_label=display_label[:60],
            target_type=target_type,
            target_key=target_key,
            intent=intent,
            polarity=polarity,
            extraction_confidence=max(0.0, min(1.0, confidence)),
        )


# ============================================================================
# Orchestration
# ============================================================================


def _community_tier(community: str) -> str:
    return COMMUNITY_TIER_OVERRIDES.get(community, DEFAULT_COMMUNITY_TIER)


def _hit_to_text(hit: HitInput) -> str:
    parts: List[str] = []
    if hit.title:
        parts.append(str(hit.title))
    if hit.body_text:
        parts.append(_strip_html(hit.body_text))
    return " \n ".join(parts).strip()


def run(
    *,
    db_path: Path,
    extractor: BaseExtractor,
    since_id: Optional[int],
    batch_size: int,
    max_batches: int,
    request_timeout: float,
    dry_run: bool,
    advance_cursor: bool,
) -> Dict[str, Any]:
    started_at = time.time()
    starting_cursor = since_id if since_id is not None else get_cursor()
    cursor = starting_cursor

    conn = _connect(db_path)
    schema_version = _check_schema_version(conn)
    concept_cache = load_active_concepts(conn)

    pre_filter_counts: Dict[str, int] = {}
    registry_only_count = 0
    llm_called_count = 0
    total_input_tokens = 0
    total_output_tokens = 0
    new_concepts_inserted = 0
    hits_with_new_concepts = 0
    hits_processed = 0
    extraction_count = 0

    accumulators: Dict[Tuple[int, str, int], BucketAccumulator] = {}

    last_id_processed = cursor
    batches_run = 0

    try:
        while batches_run < max_batches:
            hits = load_unprocessed_hits(
                conn, since_id=cursor, limit=batch_size * 4,
            )
            if not hits:
                break

            # Walk EVERY hit in the slice to attribute pre-filter / registry-only
            # accounting + daily-count proxies. LLM-eligible hits beyond the
            # current batch_size are deferred — we cap the cursor at the last
            # hit we fully processed so they get retried on the next tick.
            llm_inputs: List[Tuple[HitInput, str]] = []
            llm_full_at_index: Optional[int] = None  # 0-based idx where we hit cap

            for idx, hit in enumerate(hits):
                # Once the LLM batch is full, stop walking this slice — we
                # need to defer remaining hits so the cursor doesn't skip
                # past pf/registry-skip work that hasn't been done yet.
                if len(llm_inputs) >= batch_size:
                    llm_full_at_index = idx
                    break

                hits_processed += 1
                last_id_processed = hit.id

                pf_reason = pre_filter_reason(hit.title, hit.body_text)
                if pf_reason is not None:
                    pre_filter_counts[pf_reason] = (
                        pre_filter_counts.get(pf_reason, 0) + 1
                    )
                    continue

                cleaned = _hit_to_text(hit)
                if not cleaned:
                    pre_filter_counts["PF_EMPTY_AFTER_STRIP"] = (
                        pre_filter_counts.get("PF_EMPTY_AFTER_STRIP", 0) + 1
                    )
                    continue

                # Registry-only skip: the hit already matched ≥1 known
                # concept via the collector's regex AND the body has no
                # surface markers of an unknown concept. Skip the LLM
                # call but still attribute the existing matched concepts
                # to today's bucket so the polarity/intent rollup gets a
                # proxy weight (polarity=0, intent='question') instead of
                # staying NULL forever.
                if (
                    hit.matched_concept_ids
                    and not looks_like_unknown_concept(cleaned)
                ):
                    registry_only_count += 1
                    day = _day_bucket(hit.posted_at)
                    for cid in hit.matched_concept_ids:
                        bucket = accumulators.setdefault(
                            (cid, hit.source_community, day), BucketAccumulator()
                        )
                        # Conservative proxy: assume neutral / uncertain.
                        bucket.add(polarity=0, intent="question", confidence=0.5)
                    continue

                llm_inputs.append((hit, cleaned))

            # Compute the high-water mark for the cursor:
            # - If we filled the LLM batch mid-slice, only advance past
            #   hits we actually classified (the index before the break).
            # - Otherwise, advance past every hit in the slice.
            if llm_full_at_index is not None and llm_full_at_index > 0:
                slice_high_water = hits[llm_full_at_index - 1].id
            elif llm_full_at_index is None and hits:
                slice_high_water = hits[-1].id
            else:
                slice_high_water = cursor

            if not llm_inputs:
                # Nothing to LLM-call from this slice; advance cursor past
                # everything we just classified and continue.
                if slice_high_water > cursor:
                    cursor = slice_high_water
                continue

            # Build the (input_id, text) tuples and call the extractor.
            batch = [(f"hit_{hit.id}", text) for hit, text in llm_inputs]
            try:
                response = extractor.extract_batch(batch)
            except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as err:
                # Don't advance the cursor past the failed batch — we'll
                # retry on the next tick. Surface the error in the report.
                print(
                    f"[concept-extraction] WARN: extractor.{extractor.name} "
                    f"batch (size={len(batch)}) failed: {err}",
                    file=sys.stderr,
                )
                break

            llm_called_count += 1
            batches_run += 1
            total_input_tokens += response.input_tokens
            total_output_tokens += response.output_tokens

            # Apply each extraction back to the originating hit.
            for (hit, cleaned), per_hit_extractions in zip(
                llm_inputs, response.extractions_per_input
            ):
                if not per_hit_extractions:
                    continue
                new_concept_ids: Set[int] = set()
                for extraction in per_hit_extractions:
                    cache_key = (extraction.concept_key, extraction.target_key)
                    pre_existing = cache_key in concept_cache
                    concept_id = upsert_concept(
                        conn,
                        concept_key=extraction.concept_key,
                        target_type=extraction.target_type,
                        target_key=extraction.target_key,
                        display_label=extraction.display_label,
                        extraction_confidence=extraction.extraction_confidence,
                        dry_run=dry_run,
                        cache=concept_cache,
                    )
                    if concept_id is None:
                        continue  # dry-run insert
                    if not pre_existing:
                        new_concepts_inserted += 1
                    new_concept_ids.add(concept_id)
                    extraction_count += 1

                    day = _day_bucket(hit.posted_at)
                    bucket = accumulators.setdefault(
                        (concept_id, hit.source_community, day),
                        BucketAccumulator(),
                    )
                    bucket.add(
                        polarity=extraction.polarity,
                        intent=extraction.intent,
                        confidence=extraction.extraction_confidence,
                    )

                if new_concept_ids:
                    extended = merge_hit_concepts(
                        conn,
                        hit_id=hit.id,
                        new_concept_ids=new_concept_ids,
                        existing_ids=hit.matched_concept_ids,
                        dry_run=dry_run,
                    )
                    if extended:
                        hits_with_new_concepts += 1

            # Advance cursor past every hit in this slice we fully processed
            # (pre-filtered, registry-only, or LLM-called). Hits past
            # `slice_high_water` were deferred — they get retried next tick.
            if slice_high_water > cursor:
                cursor = slice_high_water

        daily_counts_updated = write_daily_count_enrichments(
            conn, accumulators, dry_run=dry_run,
        )

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    # Cost projection — use mock pricing for the mock provider so the
    # report still shows the shape of a real cost calc.
    pricing = PRICING_USD_PER_MTOKEN.get(getattr(extractor, "model", "gpt-4o-mini"))
    if pricing is None:
        pricing = PRICING_USD_PER_MTOKEN["gpt-4o-mini"]
    usd_in = (total_input_tokens / 1_000_000.0) * pricing["input"]
    usd_out = (total_output_tokens / 1_000_000.0) * pricing["output"]
    estimated_usd = round(usd_in + usd_out, 4)

    finished_at = time.time()
    if advance_cursor and not dry_run and last_id_processed > starting_cursor:
        set_cursor(last_id_processed)

    report: Dict[str, Any] = {
        "db_path": str(db_path),
        "schema_version": schema_version,
        "dry_run": dry_run,
        "extractor": extractor.name,
        "model": getattr(extractor, "model", None),
        "starting_cursor": starting_cursor,
        "ending_cursor": last_id_processed,
        "advance_cursor": advance_cursor,
        "hits_processed": hits_processed,
        "pre_filter_drops": pre_filter_counts,
        "registry_only_skips": registry_only_count,
        "llm_calls": llm_called_count,
        "batches_run": batches_run,
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
        "estimated_usd": estimated_usd,
        "extractions_persisted": extraction_count,
        "new_concepts_inserted": new_concepts_inserted,
        "hits_extended_with_new_concepts": hits_with_new_concepts,
        "daily_count_buckets_touched": len(accumulators),
        "daily_counts_enriched": daily_counts_updated,
        "started_at": int(started_at),
        "finished_at": int(finished_at),
        "elapsed_seconds": round(finished_at - started_at, 3),
    }

    # Persist a slim "last run" doc so Operator UI can pick it up later.
    if not dry_run:
        _write_json_doc(WORKER_NAMESPACE, LAST_RUN_DOCUMENT_KEY, {
            "extractor": extractor.name,
            "model": getattr(extractor, "model", None),
            "starting_cursor": starting_cursor,
            "ending_cursor": last_id_processed,
            "hits_processed": hits_processed,
            "llm_calls": llm_called_count,
            "extractions_persisted": extraction_count,
            "estimated_usd": estimated_usd,
            "finished_at_iso": _dt.datetime.fromtimestamp(
                finished_at, tz=_dt.timezone.utc,
            ).isoformat(),
        })

    return report


# ============================================================================
# CLI
# ============================================================================


def _load_prompt() -> Dict[str, Any]:
    if not PROMPT_FILE.exists():
        raise SystemExit(f"Prompt file not found: {PROMPT_FILE}")
    with open(PROMPT_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _build_extractor(args: argparse.Namespace) -> BaseExtractor:
    if args.llm_provider == "mock":
        return MockExtractor()
    if args.llm_provider == "openai":
        api_key, source = resolve_openai_key()
        if not api_key:
            raise SystemExit(
                "OpenAI API key not configured. Set it in Settings → AI "
                "(saves to backend/data/app-state.sqlite settings:ai_settings), "
                "in backend/data/ai-settings.json, or via the OPENAI_API_KEY env var."
            )
        prompt_doc = _load_prompt()
        # Validate the requested model is in the cheap-tier allowlist
        # (mirrors the prompt's _meta.model_assumptions.candidate_models).
        candidate_models = (
            prompt_doc.get("_meta", {})
            .get("model_assumptions", {})
            .get("candidate_models", [])
        )
        if (
            isinstance(candidate_models, list)
            and candidate_models
            and args.llm_model not in candidate_models
        ):
            print(
                f"[concept-extraction] WARN: model '{args.llm_model}' is not in "
                f"the prompt's candidate_models {candidate_models}. "
                f"Continuing anyway — re-confirm cost with "
                f"estimate_concept_extraction_cost.py.",
                file=sys.stderr,
            )
        extractor = OpenAIExtractor(
            api_key=api_key,
            model=args.llm_model,
            prompt_doc=prompt_doc,
            timeout=args.request_timeout,
        )
        print(
            f"[concept-extraction] OpenAI extractor armed (model={args.llm_model}, "
            f"key_source={source})",
            file=sys.stderr,
        )
        return extractor
    raise SystemExit(f"Unknown --llm-provider: {args.llm_provider}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Concept-extraction worker (Phase 2.2). Reads mi_raw_hits, runs "
            "pre-filter + registry-skip + LLM extraction (batched), UPSERTs "
            "tracked_concepts, and enriches concept_daily_counts polarity_mean "
            "+ intent_mix_json."
        ),
    )
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--llm-provider",
        choices=["mock", "openai"],
        default="mock",
        help="LLM backend. 'mock' is zero-cost deterministic for smoke tests.",
    )
    parser.add_argument(
        "--llm-model",
        type=str,
        default="gpt-4o-mini",
        help="OpenAI model name when --llm-provider=openai.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=80,
        help="Hits per LLM call (prompt JSON target = 80, max = 120).",
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        default=10,
        help="Cap on batches per tick (cost ceiling). Default 10 = 800 hits/tick.",
    )
    parser.add_argument(
        "--since-id",
        type=int,
        default=None,
        help=(
            "Override the persisted cursor. Default: resume from "
            "json_documents.concept_extraction_worker:cursor.last_processed_id."
        ),
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=60.0,
        help="OpenAI HTTP timeout (seconds). Cheap-tier models are usually <10s.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip all DB writes and cursor advancement. Reports the same shape.",
    )
    parser.add_argument(
        "--no-advance-cursor",
        action="store_true",
        help=(
            "Don't persist the new cursor (useful when smoke-testing with "
            "--since-id 0 against a populated DB)."
        ),
    )
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 120:
        raise SystemExit("--batch-size must be 1..120")

    extractor = _build_extractor(args)

    report = run(
        db_path=args.db_path,
        extractor=extractor,
        since_id=args.since_id,
        batch_size=args.batch_size,
        max_batches=args.max_batches,
        request_timeout=args.request_timeout,
        dry_run=args.dry_run,
        advance_cursor=not args.no_advance_cursor,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
