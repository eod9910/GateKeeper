"""Topic-to-ticker resolver (PRD D21 S6).

Single source of truth for "given an emerging topic / tracked concept, which
public tickers should we attribute the signal to?". Used by:

  * `backend/scripts/promote_emerging_topics.py` (promotion gate)
  * Future: conviction layer producer, /emerging-topics endpoints, scoring

Originally lived inline in promote_emerging_topics.py. Extracted here so
non-promoter callers can resolve without importing the promoter, and so the
fallback chain can be extended without touching the promotion pipeline.

# Resolution chain (first hit wins)

  Tier 1  metadata_json.watch_tickers       operator_override
  Tier 2  brand_to_ticker by target_key     hand_curated
  Tier 3  brand_to_ticker by concept_key    hand_curated
  Tier 4  theme_taxonomy ticker_seeds       theme_fallback
          (only when the concept resolves to a known primary_theme AND
           target_type is NOT 'brand'/'product' — for brand/product we
           prefer to surface no tickers rather than the wrong ones)
  Tier 5  empty list                        derived

Tier 4 is the new addition vs the original promoter version. It lets
`category` / `behavior` / `event_type` concepts that don't have explicit
operator-curated `watch_tickers` (e.g. `tech_layoffs`, `rust_adoption`)
still surface a sensible candidate basket, drawn from theme-taxonomy.json's
`ticker_seeds`. Capped at MAX_TICKERS_FROM_THEME because theme baskets can
be wide (5+ sectors x 5+ tickers).
"""
from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[2]
THEME_TAXONOMY_PATH = ROOT / "backend" / "data" / "scenarios" / "theme-taxonomy.json"

# Cap on how many tickers Tier 4 (theme fallback) returns. Themes can have
# 5+ sectors with 4-7 tickers each (= 20-35 tickers); a typical scenario
# wants 6-8 candidates max for the conviction layer to chew on.
MAX_TICKERS_FROM_THEME = 8

# Target types where theme fallback is suppressed. For a brand-typed concept
# without an explicit watch_tickers and no brand_to_ticker hit, returning a
# theme basket would attribute the signal to companies the operator never
# linked the brand to. Better to return [] and let the operator add a
# mapping than to surface noise.
TARGET_TYPES_WITHOUT_THEME_FALLBACK = frozenset({"brand", "product"})


def _loads_json(blob: Optional[str]) -> Any:
    if not blob:
        return None
    try:
        return json.loads(blob)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Theme taxonomy access
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_theme_seeds() -> Dict[str, List[str]]:
    """Returns {theme_key: [ticker, ...]} flattened across all sector buckets.

    Order preservation: tickers are returned in the JSON's iteration order so
    operator review (and tests) are deterministic.
    """
    if not THEME_TAXONOMY_PATH.exists():
        return {}
    payload = json.loads(THEME_TAXONOMY_PATH.read_text(encoding="utf-8"))
    seeds: Dict[str, List[str]] = {}
    for theme in payload.get("themes", []):
        key = theme.get("theme_key")
        if not key:
            continue
        flat: List[str] = []
        seen: set[str] = set()
        for sector_tickers in (theme.get("ticker_seeds") or {}).values():
            if not isinstance(sector_tickers, list):
                continue
            for t in sector_tickers:
                if isinstance(t, str) and t and t not in seen:
                    seen.add(t)
                    flat.append(t)
        seeds[key] = flat
    return seeds


def reset_caches() -> None:
    """Force a re-read of theme-taxonomy.json. Useful when the operator edits
    the file at runtime; cron jobs that run as long-lived workers should call
    this on a SIGHUP-style refresh, but for our short-lived script invocations
    the per-run cache is fine."""
    _load_theme_seeds.cache_clear()


# ---------------------------------------------------------------------------
# brand_to_ticker access
# ---------------------------------------------------------------------------

def _lookup_brand_to_ticker(
    conn: sqlite3.Connection, candidate_keys: Sequence[str]
) -> List[str]:
    """Returns parent_ticker(s) + secondary_tickers for matching brand_keys.

    Order: parent_tickers first (in candidate_keys order), then their
    secondary_tickers (deduped against earlier picks).
    """
    if not candidate_keys:
        return []
    placeholders = ",".join("?" for _ in candidate_keys)
    rows = conn.execute(
        f"""
        SELECT brand_key, parent_ticker, secondary_tickers_json
        FROM brand_to_ticker
        WHERE brand_key IN ({placeholders})
        """,
        list(candidate_keys),
    ).fetchall()

    by_key: Dict[str, sqlite3.Row] = {r["brand_key"]: r for r in rows}

    seen: List[str] = []
    seen_set: set[str] = set()
    for k in candidate_keys:
        row = by_key.get(k)
        if row is None:
            continue
        primary = row["parent_ticker"]
        if primary and primary not in seen_set:
            seen_set.add(primary)
            seen.append(primary)
        for t in (_loads_json(row["secondary_tickers_json"]) or []):
            if isinstance(t, str) and t and t not in seen_set:
                seen_set.add(t)
                seen.append(t)
    return seen


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_target_tickers(
    conn: sqlite3.Connection,
    concept: sqlite3.Row,
    *,
    primary_theme: Optional[str] = None,
) -> Tuple[List[str], str]:
    """Resolve a tracked-concept to its candidate tickers.

    Args:
      conn:           Open SQLite connection (already on market-intelligence).
      concept:        Row from `tracked_concepts` (must expose target_type,
                      target_key, concept_key, metadata_json).
      primary_theme:  Optional pre-resolved theme key. When provided, Tier 4
                      fallback can fire even when the concept's metadata
                      doesn't carry a primary_theme. Passing None means we
                      only use the concept's own metadata for theme lookup.

    Returns:
      (tickers, source_method) where source_method is one of:
        "operator_override" | "hand_curated" | "theme_fallback" | "derived"
    """
    metadata = _loads_json(concept["metadata_json"]) or {}

    # Tier 1: operator override.
    if isinstance(metadata, dict):
        watch = metadata.get("watch_tickers")
        if isinstance(watch, list):
            cleaned = [str(t).strip() for t in watch if isinstance(t, str) and t.strip()]
            if cleaned:
                return (cleaned, "operator_override")

    # Tier 2-3: brand_to_ticker by target_key, then by concept_key.
    candidates: List[str] = []
    seen: set[str] = set()
    for raw in (concept["target_key"], concept["concept_key"]):
        if not raw:
            continue
        norm = str(raw).strip().lower()
        if norm and norm not in seen:
            seen.add(norm)
            candidates.append(norm)
    tickers = _lookup_brand_to_ticker(conn, candidates)
    if tickers:
        return (tickers, "hand_curated")

    # Tier 4: theme fallback (only for non-brand/product target_types).
    target_type = str(concept["target_type"] or "").strip().lower()
    if target_type not in TARGET_TYPES_WITHOUT_THEME_FALLBACK:
        theme = primary_theme
        if theme is None and isinstance(metadata, dict):
            t = metadata.get("primary_theme")
            if isinstance(t, str) and t.strip():
                theme = t.strip()
        if theme:
            seeds = _load_theme_seeds().get(theme) or []
            if seeds:
                return (seeds[:MAX_TICKERS_FROM_THEME], "theme_fallback")

    # Tier 5: empty.
    return ([], "derived")
