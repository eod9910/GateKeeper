"""
Backfill spam / topic / dedup fields on existing social posts.

Recomputes, using the shared deterministic scorers in social_text_quality:
  - social_posts_clean: duplicate_group_key, is_spam, spam_score
  - social_post_sentiment: topic_label

Pure local compute (no network / no LLM). Idempotent: safe to re-run. The live
collectors already write these fields for new posts; this fixes the ~797k rows
ingested before the scorers existed (when they were hardcoded False/0.0/NULL).

Usage:
    python backend/scripts/backfill_social_text_quality.py            # all rows
    python backend/scripts/backfill_social_text_quality.py --limit 5000   # test
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.social_text_quality import (  # noqa: E402
    content_dedup_key,
    score_spam,
    classify_topic,
)

DB_PATH = ROOT / "backend" / "data" / "social-intelligence.sqlite"
BATCH = 10_000


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Max rows to process (0 = all).")
    ap.add_argument("--db", default=str(DB_PATH))
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}")
        return 1

    # Separate connections: a read-only cursor connection (so iterating doesn't
    # collide with our own writes) and a dedicated writer. WAL lets the reader
    # hold a snapshot while the writer commits; busy_timeout waits out the live
    # collector/server if it happens to be writing.
    read_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=60)
    read_conn.execute("PRAGMA busy_timeout = 60000")
    write_conn = sqlite3.connect(str(db_path), timeout=120)
    write_conn.execute("PRAGMA journal_mode = WAL")
    write_conn.execute("PRAGMA busy_timeout = 120000")
    write_conn.execute("PRAGMA synchronous = NORMAL")
    conn = write_conn

    limit_clause = f" LIMIT {int(args.limit)}" if args.limit and args.limit > 0 else ""

    # --- Pass A: corpus-wide content frequency (for copy-paste spam signal) ---
    t0 = time.time()
    print("Pass A: computing content dedup frequencies...")
    freq: Counter = Counter()
    cur = read_conn.execute(
        f"SELECT raw_post_id, cleaned_text, canonical_post_key FROM social_posts_clean{limit_clause}"
    )
    n_seen = 0
    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for _rid, text, cpk in rows:
            key = content_dedup_key(text, cpk)
            if key:
                freq[key] += 1
        n_seen += len(rows)
        if n_seen % 100_000 == 0:
            print(f"  scanned {n_seen:,}")
    print(f"  pass A done: {n_seen:,} rows, {len(freq):,} distinct content groups ({time.time()-t0:.1f}s)")

    # --- Pass B: recompute + update clean (spam/dedup) and sentiment (topic) ---
    print("Pass B: recomputing + updating...")
    t1 = time.time()
    cur = read_conn.execute(
        f"SELECT raw_post_id, cleaned_text, token_count, canonical_post_key, has_ticker_mention "
        f"FROM social_posts_clean{limit_clause}"
    )
    clean_updates = []
    topic_updates = []
    n_done = 0
    n_spam = 0
    topic_counts: Counter = Counter()

    def flush():
        if clean_updates:
            conn.executemany(
                "UPDATE social_posts_clean SET duplicate_group_key=?, is_spam=?, spam_score=? "
                "WHERE raw_post_id=?",
                clean_updates,
            )
        if topic_updates:
            conn.executemany(
                "UPDATE social_post_sentiment SET topic_label=? WHERE raw_post_id=?",
                topic_updates,
            )
        conn.commit()
        clean_updates.clear()
        topic_updates.clear()

    while True:
        rows = cur.fetchmany(BATCH)
        if not rows:
            break
        for rid, text, token_count, cpk, has_tkr in rows:
            key = content_dedup_key(text, cpk)
            is_spam, spam_score = score_spam(
                text,
                token_count=token_count,
                dedup_frequency=freq.get(key, 1),
                has_ticker_mention=bool(has_tkr),
            )
            topic = classify_topic(text, is_spam=is_spam)
            clean_updates.append((key, 1 if is_spam else 0, spam_score, rid))
            topic_updates.append((topic, rid))
            if is_spam:
                n_spam += 1
            topic_counts[topic] += 1
        n_done += len(rows)
        flush()
        if n_done % 100_000 == 0:
            print(f"  updated {n_done:,} ({time.time()-t1:.1f}s)")

    read_conn.close()
    write_conn.close()
    print(f"\nDone: {n_done:,} rows updated in {time.time()-t0:.1f}s total")
    print(f"  spam flagged: {n_spam:,} ({100.0*n_spam/max(1,n_done):.1f}%)")
    print("  topic distribution:")
    for topic, c in topic_counts.most_common():
        print(f"    {c:>8,}  {topic}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
