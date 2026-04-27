#!/usr/bin/env python3
"""Seed tracked_concepts in market-intelligence.sqlite from tracked-concepts.json.

This is the hand-curated baseline watchlist for the Phase 2 collectors.
The LLM concept-extractor (D21 S2) will append additional rows to this
table over time as it discovers new concepts in collected posts.

Idempotent: uses ON CONFLICT(concept_key, target_key) DO UPDATE so
re-runs are safe AND preserve the `id` of existing rows. This matters
because four other tables FK into tracked_concepts(id) ON DELETE
CASCADE — an INSERT OR REPLACE would silently delete child data on
edits to display_label / metadata.

Schema-creation lives in build_market_intelligence_db.py; this script
assumes the table already exists at schema_version 2 or later.

Usage:
    py backend/scripts/seed_tracked_concepts.py
    py backend/scripts/seed_tracked_concepts.py --dry-run
    py backend/scripts/seed_tracked_concepts.py --db-path /tmp/test.sqlite
    py backend/scripts/seed_tracked_concepts.py --concepts-path /custom/path.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "market-intelligence.sqlite"
DEFAULT_CONCEPTS_PATH = (
    ROOT / "backend" / "data" / "scenarios" / "tracked-concepts.json"
)

EXPECTED_SCHEMA_VERSION = 2

# tracked_concepts.target_type CHECK constraint (must match build script).
ALLOWED_TARGET_TYPES = {
    "brand",
    "product",
    "category",
    "behavior",
    "keyword",
    "event_type",
}

# tracked_concepts.created_by CHECK constraint (must match build script).
ALLOWED_CREATED_BY = {"llm_extractor", "operator", "seed_taxonomy"}


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
    cur = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit(
            "schema_meta.schema_version is missing. "
            "Run build_market_intelligence_db.py to migrate first."
        )
    version = int(row[0])
    if version < EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            f"Schema version too old: DB has {version}, "
            f"this script expects >= {EXPECTED_SCHEMA_VERSION}. "
            "Run build_market_intelligence_db.py to migrate."
        )
    return version


def _load_concepts(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Concepts file not found: {path}")
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    concepts = payload.get("concepts")
    if not isinstance(concepts, list):
        raise SystemExit(
            f"{path}: top-level 'concepts' must be a list, "
            f"got {type(concepts).__name__}"
        )
    return concepts


def _validate_concept(concept: Dict[str, Any], idx: int) -> None:
    """Pre-flight validation so we fail fast before hitting CHECK constraints."""
    required = ("concept_key", "target_type", "target_key", "display_label")
    for field in required:
        value = concept.get(field)
        if not isinstance(value, str) or not value.strip():
            raise SystemExit(
                f"concepts[{idx}]: missing or non-string '{field}' "
                f"(got {value!r})"
            )

    target_type = concept["target_type"]
    if target_type not in ALLOWED_TARGET_TYPES:
        raise SystemExit(
            f"concepts[{idx}] ({concept['concept_key']}): "
            f"target_type={target_type!r} not in "
            f"{sorted(ALLOWED_TARGET_TYPES)}"
        )

    created_by = concept.get("created_by", "seed_taxonomy")
    if created_by not in ALLOWED_CREATED_BY:
        raise SystemExit(
            f"concepts[{idx}] ({concept['concept_key']}): "
            f"created_by={created_by!r} not in {sorted(ALLOWED_CREATED_BY)}"
        )


def _seed_tracked_concepts(
    conn: sqlite3.Connection,
    concepts: List[Dict[str, Any]],
    *,
    dry_run: bool,
) -> Dict[str, Any]:
    now = int(time.time())

    inserted = 0
    updated = 0
    unchanged = 0
    seen_unique: Dict[Tuple[str, str], int] = {}

    for idx, concept in enumerate(concepts):
        _validate_concept(concept, idx)

        concept_key = concept["concept_key"].strip()
        target_type = concept["target_type"].strip()
        target_key = concept["target_key"].strip()
        display_label = concept["display_label"].strip()
        created_by = concept.get("created_by", "seed_taxonomy")
        status = concept.get("status", "active")
        metadata = concept.get("metadata")

        # Guard against fixture-level dupes (the unique index would catch
        # this too, but a clearer error helps editors of the JSON).
        unique_key = (concept_key, target_key)
        if unique_key in seen_unique:
            raise SystemExit(
                f"concepts[{idx}] ({concept_key}): duplicate "
                f"(concept_key, target_key)={unique_key} also at index "
                f"{seen_unique[unique_key]}"
            )
        seen_unique[unique_key] = idx

        metadata_json = (
            json.dumps(metadata, separators=(",", ":"), sort_keys=True)
            if metadata is not None
            else None
        )

        existing = conn.execute(
            "SELECT id, display_label, status, metadata_json, target_type "
            "FROM tracked_concepts "
            "WHERE concept_key = ? AND target_key = ?",
            (concept_key, target_key),
        ).fetchone()

        if existing is None:
            if not dry_run:
                conn.execute(
                    """
                    INSERT INTO tracked_concepts (
                        concept_key, target_type, target_key,
                        display_label, created_at, created_by,
                        status, metadata_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        concept_key,
                        target_type,
                        target_key,
                        display_label,
                        now,
                        created_by,
                        status,
                        metadata_json,
                    ),
                )
            inserted += 1
        else:
            (_, ex_label, ex_status, ex_meta, ex_target_type) = existing
            if (
                ex_label == display_label
                and ex_status == status
                and ex_meta == metadata_json
                and ex_target_type == target_type
            ):
                unchanged += 1
                continue
            if not dry_run:
                # UPDATE preserves id (and child cascades), unlike REPLACE.
                conn.execute(
                    """
                    UPDATE tracked_concepts
                    SET target_type = ?,
                        display_label = ?,
                        status = ?,
                        metadata_json = ?
                    WHERE concept_key = ? AND target_key = ?
                    """,
                    (
                        target_type,
                        display_label,
                        status,
                        metadata_json,
                        concept_key,
                        target_key,
                    ),
                )
            updated += 1

    return {
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "total_in_payload": len(concepts),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed tracked_concepts from tracked-concepts.json"
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to market-intelligence.sqlite (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--concepts-path",
        type=Path,
        default=DEFAULT_CONCEPTS_PATH,
        help=f"Path to tracked-concepts.json (default: {DEFAULT_CONCEPTS_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report changes without writing.",
    )
    args = parser.parse_args()

    concepts = _load_concepts(args.concepts_path)

    conn = _connect(args.db_path)
    try:
        schema_version = _check_schema_version(conn)
        report = _seed_tracked_concepts(
            conn, concepts, dry_run=args.dry_run
        )
        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    output = {
        "db_path": str(args.db_path),
        "concepts_path": str(args.concepts_path),
        "schema_version": schema_version,
        "dry_run": args.dry_run,
        **report,
    }
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
