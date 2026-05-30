#!/usr/bin/env python
"""Embedding pipeline for the Macro Engine (PRD D21 M2).

Reads unprocessed macro hits from ``mi_raw_hits`` (those without a
corresponding ``hit_embeddings`` row), embeds each with
``sentence-transformers/all-MiniLM-L6-v2``, extracts entities via the
dictionary-based extractor backed by ``universe_clean.json``, and
persists the results to ``hit_embeddings``.

The downstream clustering job (M3) reads ``hit_embeddings`` to match
new events against open Macro scenarios.

Usage from the marketIntelligenceScheduler:
    py backend/scripts/run_embedding_pipeline.py
    py backend/scripts/run_embedding_pipeline.py --batch-size 100
    py backend/scripts/run_embedding_pipeline.py --limit 500
    py backend/scripts/run_embedding_pipeline.py --dry-run

Flags:
    --batch-size INT     Embed this many hits per model.encode() call (default 64)
    --limit INT          Process at most this many unembedded hits (default: all)
    --source-types TEXT  Comma-separated source_type filter (default: all macro types)
    --dry-run            Compute embeddings but do not write to DB
    --verbose            Print per-hit entity details
    --db-path PATH       Override default DB location
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")

sys.path.insert(0, PROJECT_ROOT)

from backend.services.embeddings import (
    EmbeddingModel,
    EntityExtractor,
    MODEL_NAME,
    embed_and_extract,
)

EXPECTED_SCHEMA_VERSION = 6

MACRO_SOURCE_TYPES = [
    "rss_federal_reserve",
    "rss_yahoo_finance",
    "rss_reuters",
    "rss_ap",
    "econ_eia",
    "econ_bls",
]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(
            f"[embedding-pipeline] market-intelligence.sqlite missing at {db_path}. "
            f"Run backend/scripts/build_market_intelligence_db.py first."
        )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def check_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    version = int(row["value"]) if row else 0
    if version < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[embedding-pipeline] schema_version={version}, "
            f"this pipeline expects >= {EXPECTED_SCHEMA_VERSION}. "
            f"Run backend/scripts/build_market_intelligence_db.py first."
        )


def fetch_unembedded_hits(
    conn: sqlite3.Connection,
    source_types: Sequence[str],
    limit: Optional[int] = None,
) -> List[Dict]:
    """Return mi_raw_hits rows that have no hit_embeddings entry."""
    placeholders = ",".join("?" for _ in source_types)
    sql = f"""
        SELECT h.id, h.title, h.body_text, h.source_type, h.source_community
        FROM mi_raw_hits h
        LEFT JOIN hit_embeddings e ON e.hit_id = h.id
        WHERE e.id IS NULL
          AND h.source_type IN ({placeholders})
        ORDER BY h.posted_at DESC
    """
    if limit:
        sql += f" LIMIT {int(limit)}"

    rows = conn.execute(sql, list(source_types)).fetchall()
    return [dict(r) for r in rows]


def persist_embeddings(
    conn: sqlite3.Connection,
    hit_id: int,
    embedding: List[float],
    entities_dict: dict,
    model_name: str,
    now_unix: int,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO hit_embeddings
            (hit_id, embedding_json, entities_json, model_name, embedded_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            hit_id,
            json.dumps(embedding),
            json.dumps(entities_dict),
            model_name,
            now_unix,
        ),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(
    db_path: str = DEFAULT_DB_PATH,
    batch_size: int = 64,
    limit: Optional[int] = None,
    source_types: Optional[List[str]] = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> dict:
    conn = open_db(db_path)
    check_schema(conn)

    types = source_types or MACRO_SOURCE_TYPES
    hits = fetch_unembedded_hits(conn, types, limit)
    total = len(hits)

    if total == 0:
        print("[embedding-pipeline] No unembedded hits to process.")
        conn.close()
        return {"processed": 0, "skipped": 0}

    print(f"[embedding-pipeline] {total} unembedded hits to process "
          f"(batch_size={batch_size}, dry_run={dry_run})")

    model = EmbeddingModel()
    extractor = EntityExtractor()

    processed = 0
    entities_found = 0
    now = int(time.time())

    for batch_start in range(0, total, batch_size):
        batch = hits[batch_start : batch_start + batch_size]

        # Build (hit_id, text) pairs — combine title + body
        pairs: List[Tuple[int, str]] = []
        for h in batch:
            title = h.get("title") or ""
            body = h.get("body_text") or ""
            text = f"{title}\n{body}".strip() if body else title.strip()
            if not text:
                text = "(empty)"
            pairs.append((h["id"], text))

        results = embed_and_extract(pairs, model=model, extractor=extractor)

        for r in results:
            eids = r.entities.all_entity_ids()
            if eids:
                entities_found += 1

            if verbose:
                print(
                    f"  hit_id={r.hit_id}  "
                    f"tickers={r.entities.tickers}  "
                    f"entities={len(eids)}"
                )

            if not dry_run:
                persist_embeddings(
                    conn,
                    r.hit_id,
                    r.embedding,
                    r.entities.to_dict(),
                    MODEL_NAME,
                    now,
                )

        processed += len(results)

        if not dry_run:
            conn.commit()

        pct = int(100 * processed / total)
        print(
            f"[embedding-pipeline] {processed}/{total} ({pct}%) — "
            f"batch {batch_start // batch_size + 1}"
        )

    conn.close()

    summary = {
        "processed": processed,
        "entities_found": entities_found,
        "dry_run": dry_run,
        "model": MODEL_NAME,
        "source_types": types,
    }
    print(f"\n[embedding-pipeline] Done. {json.dumps(summary)}")
    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Embed macro hits + extract entities (PRD D21 M2)."
    )
    parser.add_argument(
        "--db-path", default=DEFAULT_DB_PATH,
        help=f"Path to market-intelligence.sqlite (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--batch-size", type=int, default=64,
        help="Hits per model.encode() call (default: 64)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Max hits to process (default: all)",
    )
    parser.add_argument(
        "--source-types", default=None,
        help="Comma-separated source_type filter (default: all macro types)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args(argv)

    st = args.source_types.split(",") if args.source_types else None

    run(
        db_path=args.db_path,
        batch_size=args.batch_size,
        limit=args.limit,
        source_types=st,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
