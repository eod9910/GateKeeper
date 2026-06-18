#!/usr/bin/env python3
"""Normalize broad Market Intelligence evidence against the clean universe.

This is the first pass of the Social ARB "field map":

    mi_raw_hits
      -> universe_symbol_mentions
      -> universe_symbol_daily_counts
      -> universe_symbol_baselines
      -> universe_symbol_perturbations

The engine deliberately runs *inside our database* rather than issuing one
search per symbol/source. Collect broadly first, then match locally against
the full clean universe and rank abnormal movement relative to each
symbol/source/community's own baseline.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MI_DB = ROOT / "backend" / "data" / "market-intelligence.sqlite"
DEFAULT_UNIVERSE = ROOT / "backend" / "data" / "universe_clean.json"
DAY_SECONDS = 86_400

TICKER_BLACKLIST: Set[str] = {
    "A", "I", "DD", "TA", "FD", "IV", "OI", "PM", "AH", "ATH", "EOD",
    "EPS", "PE", "CEO", "IPO", "ETF", "SEC", "GDP", "CPI", "FOMC",
    "IMO", "FOMO", "YOLO", "FYI", "LOL", "WTF", "OMG", "TLDR", "USA",
    "FBI", "IRS", "HODL", "DCA", "RSI", "SMA", "EMA", "MACD", "VWAP",
    "ITM", "OTM", "ATM", "DTE", "YTD", "QOQ", "YOY", "MOM", "WOW",
    "NSFW", "PSA", "TIL", "EDIT", "RIP", "PUTS", "CALL", "CALLS",
    "PUT", "LONG", "SHORT", "BUY", "SELL", "HOLD", "MOON", "APE",
    "APES", "PUMP", "DUMP", "DIP", "DIPS", "RUN", "BULL", "BEAR",
    "GREEN", "RED", "GAIN", "LOSS", "MOVE", "PLAY", "SAFE", "RISK",
    "DEBT", "CASH", "FREE", "HIGH", "LOW", "OPEN", "CLOSE", "NEXT",
    "BEST", "GOOD", "REAL", "NEW", "NOW", "ALL", "ARE", "FOR", "THE",
    "HAS", "HAD", "CAN", "HIS", "HER", "ITS", "OUR", "WHO", "HOW",
    "WHY", "NOT", "YES", "TOP", "BIG", "OLD", "WAR", "OIL", "GAS",
    "FED", "GO", "UP", "OR", "AN", "AT", "BY", "DO", "IF", "IN",
    "IS", "IT", "MY", "NO", "OF", "ON", "SO", "TO", "WE", "AI",
    "UK", "EU", "US", "UN", "TV", "PC", "LLC", "INC", "LTD", "EST",
    "AVG", "MAX", "MIN", "NET", "ROI", "ROE", "ROA", "DCF", "NAV",
    "FCF", "TTM", "FWD", "REV", "DIV", "EV", "MKT", "VOL", "BID",
    "ASK", "GAP", "LEG", "LOT", "OTC", "PRE", "POST",
    # Common all-caps words/product terms that are valid tickers but too noisy
    # without an explicit cashtag or company-name context.
    "LIVE", "OLED",
    # 4-char acronyms/benchmark names that pass the prose length filter but are
    # almost never deliberate ticker references on HN/forums.
    "GAIA", "SAAS", "PAAS", "IAAS", "JSON", "HTML", "HTTP", "REST", "CRUD",
    "STEM",
}

COMPANY_ALIAS_BLACKLIST: Set[str] = {
    # Generic technology/domain words that are also public-company names.
    # These must be detected through richer context, not raw exact phrase match.
    # Observed false-positive aliases on long-form prose (HN/forums/4chan):
    # "frontier models" -> ULCC, "strategy" -> MSTR, "honest answer" -> HNST,
    # "design pattern" -> PTRN, "popular" -> BPOP, "freedom" -> FRHC,
    # "target audience" -> TGT, "quantum computing" -> QUBT, etc. These are
    # common English/tech words that collide constantly; require richer context.
    "interface",
    "quantum",
    "quantum computing",
    "frontier",
    "strategy",
    "honest",
    "pattern",
    "popular",
    "freedom",
    "target",
    "coffee",
    "bandwidth",
    "square",
    "signal",
    # Second-tier common-word aliases surfaced by dry-run validation:
    # "universal" -> UVV, "innovate" -> VATE, "employers" -> EIG,
    # "vertex" -> VERX (graph/3D vertex), "reliance" -> RS, "coherent" -> COHR.
    "universal",
    "innovate",
    "employers",
    "vertex",
    "reliance",
    "coherent",
    # Third-tier: common HN/programmer vocabulary that are also company names.
    # "integer" -> ITGR, "graham" -> GHC (Paul Graham), "fossil" -> FOSL.
    "integer",
    "graham",
    "fossil",
}

COMPANY_SUFFIX_RE = re.compile(
    r"\b("
    r"incorporated|inc|corp|corporation|company|co|plc|ltd|limited|holdings|"
    r"holding|group|class|common|stock|ordinary|shares|depositary|adr|ads|"
    r"reit|trust|lp|llc|sa|nv|ag|se"
    r")\b",
    re.IGNORECASE,
)
PUNCT_RE = re.compile(r"[^a-z0-9$]+")
CASHTAG_RE = re.compile(r"\$([A-Z][A-Z0-9]{0,5})\b")
BARE_TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")


# Sources where a bare all-caps token is a deliberate ticker reference (retail
# cashtag culture). On long-form prose (HN, forums, 4chan, news, YouTube,
# Reddit) bare acronyms are overwhelmingly English/tech jargon (UI, AGI, CC,
# OS, CI, CV, OSS, CTO, MS, IP, DB, VS ...), so bare-ticker matching is
# restricted there — see match_hit.
TICKER_NATIVE_SOURCE_PREFIXES = ("stocktwits", "yahoo_community")
# On prose sources, only accept bare tickers at least this long. The observed
# acronym false positives are all 2-3 chars; legit prose ticker references
# (NVDA, TSLA, MSFT, GOOGL, AMZN, PLTR ...) are 4+. Cashtags ($AMD) and company
# aliases ("advanced micro devices") still catch shorter names.
PROSE_BARE_TICKER_MIN_LEN = 4


def allows_bare_ticker(source_type: str) -> bool:
    st = str(source_type or "").lower()
    return any(st.startswith(p) for p in TICKER_NATIVE_SOURCE_PREFIXES)


def now_unix() -> int:
    return int(time.time())


def day_bucket(ts: int) -> int:
    return (int(ts) // DAY_SECONDS) * DAY_SECONDS


def normalize_text(value: Any) -> str:
    text = str(value or "").lower()
    text = text.replace("&amp;", " and ").replace("&#39;", "'")
    text = PUNCT_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_company_name(name: str) -> str:
    text = str(name or "")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = COMPANY_SUFFIX_RE.sub(" ", text)
    text = normalize_text(text)
    return text


def token_count(text: str) -> int:
    return len([t for t in text.split() if t])


def load_universe(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    stocks = payload.get("stocks") if isinstance(payload, dict) else payload
    if not isinstance(stocks, list):
        raise SystemExit(f"[universe-normalize] bad universe payload: {path}")
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for row in stocks:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or row.get("ticker") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(row)
    return out


def build_aliases(stocks: Sequence[Dict[str, Any]]) -> Tuple[Set[str], Dict[str, List[Tuple[str, str]]]]:
    symbols = {str(s.get("symbol") or s.get("ticker") or "").strip().upper() for s in stocks}
    symbols = {s for s in symbols if s}
    alias_index: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for row in stocks:
        symbol = str(row.get("symbol") or row.get("ticker") or "").strip().upper()
        if not symbol:
            continue
        raw_names = [
            row.get("name"),
            row.get("sec_name"),
        ]
        for raw_name in raw_names:
            alias = normalize_company_name(str(raw_name or ""))
            if not alias:
                continue
            if alias in COMPANY_ALIAS_BLACKLIST:
                continue
            # One-word aliases are noisy unless fairly distinctive. Single
            # letter tickers/names are never company-alias matches.
            if token_count(alias) == 1 and len(alias) < 6:
                continue
            if len(alias) < 5:
                continue
            alias_index[alias].append((symbol, "company_alias"))
    return symbols, alias_index


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS universe_symbol_mentions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hit_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_community TEXT NOT NULL,
          posted_at INTEGER NOT NULL,
          day INTEGER NOT NULL,
          author TEXT,
          match_method TEXT NOT NULL,
          matched_text TEXT NOT NULL,
          discovery_role TEXT NOT NULL,
          raw_payload_json TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(hit_id, symbol, match_method, matched_text)
        );

        CREATE INDEX IF NOT EXISTS idx_universe_symbol_mentions_symbol_day
          ON universe_symbol_mentions(symbol, day DESC);
        CREATE INDEX IF NOT EXISTS idx_universe_symbol_mentions_source_day
          ON universe_symbol_mentions(source_type, source_community, day DESC);

        CREATE TABLE IF NOT EXISTS universe_symbol_daily_counts (
          symbol TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_community TEXT NOT NULL,
          day INTEGER NOT NULL,
          mention_count INTEGER NOT NULL,
          unique_authors INTEGER NOT NULL,
          discovery_count INTEGER NOT NULL,
          confirmation_count INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(symbol, source_type, source_community, day)
        );

        CREATE TABLE IF NOT EXISTS universe_symbol_baselines (
          symbol TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_community TEXT NOT NULL,
          as_of_day INTEGER NOT NULL,
          rolling_mean_30d REAL NOT NULL,
          rolling_stdev_30d REAL NOT NULL,
          data_days INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(symbol, source_type, source_community)
        );

        CREATE TABLE IF NOT EXISTS universe_symbol_perturbations (
          symbol TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_community TEXT NOT NULL,
          day INTEGER NOT NULL,
          mention_count INTEGER NOT NULL,
          baseline_mean REAL NOT NULL,
          baseline_stdev REAL NOT NULL,
          z_score REAL NOT NULL,
          velocity_ratio REAL NOT NULL,
          unique_authors INTEGER NOT NULL,
          discovery_count INTEGER NOT NULL,
          confirmation_count INTEGER NOT NULL,
          perturbation_score REAL NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(symbol, source_type, source_community, day)
        );
        """
    )


def discovery_role(source_type: str, source_community: str, match_method: str) -> str:
    st = str(source_type or "").lower()
    comm = str(source_community or "").lower()
    if st.startswith("stocktwits") or st.startswith("yahoo_community") or comm.startswith("stocktwits:") or comm.startswith("yahoo_finance:"):
        return "ticker_confirmation"
    if match_method in {"company_alias", "ticker_cashtag", "ticker_bare"}:
        return "organic_discovery"
    return "unknown"


def fetch_hits(conn: sqlite3.Connection, since: int, limit: int) -> List[sqlite3.Row]:
    limit_clause = "LIMIT ?" if limit > 0 else ""
    params: List[Any] = [since]
    if limit > 0:
        params.append(limit)
    return conn.execute(
        f"""
        SELECT id, source_type, source_post_id, source_thread_id, source_url,
               source_community, author, title, body_text, posted_at,
               score, comment_count
        FROM mi_raw_hits
        WHERE posted_at >= ?
          AND source_community NOT LIKE 'macro:%'
          AND (title IS NOT NULL OR body_text IS NOT NULL)
        ORDER BY posted_at DESC
        {limit_clause}
        """,
        params,
    ).fetchall()


def match_hit(
    row: sqlite3.Row,
    symbols: Set[str],
    alias_index: Dict[str, List[Tuple[str, str]]],
) -> List[Dict[str, Any]]:
    title = str(row["title"] or "")
    body = str(row["body_text"] or "")
    text = f"{title}\n{body}"
    normalized = f" {normalize_text(text)} "
    matches: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for match in CASHTAG_RE.finditer(text):
        symbol = match.group(1).upper()
        if symbol in symbols:
            key = (symbol, "ticker_cashtag", f"${symbol}")
            matches[key] = {"symbol": symbol, "method": "ticker_cashtag", "text": f"${symbol}"}

    native_source = allows_bare_ticker(str(row["source_type"]))
    for match in BARE_TICKER_RE.finditer(text):
        symbol = match.group(1).upper()
        if symbol not in symbols or symbol in TICKER_BLACKLIST:
            continue
        # Prose: reject short bare tokens (2-3 chars) — almost always acronyms
        # (UI/CC/OS/CI/CV/OSS/AGI/CTO/MS/IP/DB/VS), not deliberate tickers.
        if not native_source and len(symbol) < PROSE_BARE_TICKER_MIN_LEN:
            continue
        key = (symbol, "ticker_bare", symbol)
        matches[key] = {"symbol": symbol, "method": "ticker_bare", "text": symbol}

    # Alias matching is intentionally conservative: exact normalized phrase
    # with whitespace boundaries, no substring matching inside words.
    for alias, targets in alias_index.items():
        if f" {alias} " not in normalized:
            continue
        for symbol, method in targets:
            key = (symbol, method, alias)
            matches[key] = {"symbol": symbol, "method": method, "text": alias}

    out: List[Dict[str, Any]] = []
    for item in matches.values():
        role = discovery_role(str(row["source_type"]), str(row["source_community"]), item["method"])
        out.append(
            {
                "hit_id": int(row["id"]),
                "symbol": item["symbol"],
                "source_type": str(row["source_type"]),
                "source_community": str(row["source_community"]),
                "posted_at": int(row["posted_at"]),
                "day": day_bucket(int(row["posted_at"])),
                "author": row["author"],
                "match_method": item["method"],
                "matched_text": item["text"],
                "discovery_role": role,
                "raw_payload_json": json.dumps(
                    {
                        "source_post_id": row["source_post_id"],
                        "source_thread_id": row["source_thread_id"],
                        "source_url": row["source_url"],
                        "score": row["score"],
                        "comment_count": row["comment_count"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            }
        )
    return out


def upsert_mentions(conn: sqlite3.Connection, mentions: Sequence[Dict[str, Any]], dry_run: bool) -> int:
    now = now_unix()
    inserted = 0
    for row in mentions:
        if dry_run:
            inserted += 1
            continue
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO universe_symbol_mentions (
              hit_id, symbol, source_type, source_community, posted_at, day,
              author, match_method, matched_text, discovery_role,
              raw_payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["hit_id"],
                row["symbol"],
                row["source_type"],
                row["source_community"],
                row["posted_at"],
                row["day"],
                row["author"],
                row["match_method"],
                row["matched_text"],
                row["discovery_role"],
                row["raw_payload_json"],
                now,
            ),
        )
        inserted += int(cur.rowcount or 0)
    return inserted


def purge_mentions_since(conn: sqlite3.Connection, since: int, dry_run: bool) -> Set[int]:
    rows = conn.execute(
        """
        SELECT DISTINCT day
        FROM universe_symbol_mentions
        WHERE posted_at >= ?
        """,
        (since,),
    ).fetchall()
    affected_days = {int(row["day"]) for row in rows}
    if not dry_run:
        conn.execute(
            """
            DELETE FROM universe_symbol_mentions
            WHERE posted_at >= ?
            """,
            (since,),
        )
    return affected_days


def refresh_daily_counts(conn: sqlite3.Connection, days: Iterable[int], dry_run: bool) -> int:
    now = now_unix()
    refreshed = 0
    for day in sorted(set(days)):
        if not dry_run:
            conn.execute(
                "DELETE FROM universe_symbol_daily_counts WHERE day = ?",
                (day,),
            )
        rows = conn.execute(
            """
            SELECT symbol, source_type, source_community,
                   COUNT(DISTINCT hit_id) AS mention_count,
                   COUNT(DISTINCT author) AS unique_authors,
                   SUM(CASE WHEN discovery_role = 'organic_discovery' THEN 1 ELSE 0 END) AS discovery_count,
                   SUM(CASE WHEN discovery_role = 'ticker_confirmation' THEN 1 ELSE 0 END) AS confirmation_count
            FROM universe_symbol_mentions
            WHERE day = ?
            GROUP BY symbol, source_type, source_community
            """,
            (day,),
        ).fetchall()
        for row in rows:
            if not dry_run:
                conn.execute(
                    """
                    INSERT INTO universe_symbol_daily_counts (
                      symbol, source_type, source_community, day,
                      mention_count, unique_authors, discovery_count,
                      confirmation_count, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(symbol, source_type, source_community, day)
                    DO UPDATE SET
                      mention_count = excluded.mention_count,
                      unique_authors = excluded.unique_authors,
                      discovery_count = excluded.discovery_count,
                      confirmation_count = excluded.confirmation_count,
                      updated_at = excluded.updated_at
                    """,
                    (
                        row["symbol"],
                        row["source_type"],
                        row["source_community"],
                        day,
                        int(row["mention_count"] or 0),
                        int(row["unique_authors"] or 0),
                        int(row["discovery_count"] or 0),
                        int(row["confirmation_count"] or 0),
                        now,
                    ),
                )
            refreshed += 1
    return refreshed


def purge_orphan_perturbations(conn: sqlite3.Connection, days: Iterable[int], dry_run: bool) -> int:
    purged = 0
    for day in sorted(set(days)):
        rows = conn.execute(
            """
            SELECT p.symbol, p.source_type, p.source_community
            FROM universe_symbol_perturbations p
            LEFT JOIN universe_symbol_daily_counts c
              ON c.symbol = p.symbol
             AND c.source_type = p.source_type
             AND c.source_community = p.source_community
             AND c.day = p.day
            WHERE p.day = ?
              AND c.symbol IS NULL
            """,
            (day,),
        ).fetchall()
        purged += len(rows)
        if rows and not dry_run:
            conn.execute(
                """
                DELETE FROM universe_symbol_perturbations
                WHERE day = ?
                  AND NOT EXISTS (
                    SELECT 1
                    FROM universe_symbol_daily_counts c
                    WHERE c.symbol = universe_symbol_perturbations.symbol
                      AND c.source_type = universe_symbol_perturbations.source_type
                      AND c.source_community = universe_symbol_perturbations.source_community
                      AND c.day = universe_symbol_perturbations.day
                  )
                """,
                (day,),
            )
    return purged


def rebuild_baselines(conn: sqlite3.Connection, as_of_day: int, dry_run: bool) -> int:
    now = now_unix()
    start = as_of_day - 30 * DAY_SECONDS
    rows = conn.execute(
        """
        SELECT symbol, source_type, source_community, day, mention_count
        FROM universe_symbol_daily_counts
        WHERE day >= ? AND day < ?
        ORDER BY symbol, source_type, source_community, day
        """,
        (start, as_of_day),
    ).fetchall()
    grouped: Dict[Tuple[str, str, str], List[int]] = defaultdict(list)
    for row in rows:
        grouped[(row["symbol"], row["source_type"], row["source_community"])].append(int(row["mention_count"] or 0))

    written = 0
    for (symbol, source_type, community), counts in grouped.items():
        if len(counts) < 2:
            continue
        mean = float(statistics.fmean(counts))
        stdev = float(statistics.pstdev(counts))
        if not dry_run:
            conn.execute(
                """
                INSERT INTO universe_symbol_baselines (
                  symbol, source_type, source_community, as_of_day,
                  rolling_mean_30d, rolling_stdev_30d, data_days, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, source_type, source_community)
                DO UPDATE SET
                  as_of_day = excluded.as_of_day,
                  rolling_mean_30d = excluded.rolling_mean_30d,
                  rolling_stdev_30d = excluded.rolling_stdev_30d,
                  data_days = excluded.data_days,
                  updated_at = excluded.updated_at
                """,
                (symbol, source_type, community, as_of_day, mean, stdev, len(counts), now),
            )
        written += 1
    return written


def score_perturbations(conn: sqlite3.Connection, score_day: int, min_history: int, dry_run: bool) -> int:
    now = now_unix()
    if not dry_run:
        conn.execute(
            "DELETE FROM universe_symbol_perturbations WHERE day = ?",
            (score_day,),
        )
    rows = conn.execute(
        """
        SELECT c.symbol, c.source_type, c.source_community, c.day,
               c.mention_count, c.unique_authors, c.discovery_count,
               c.confirmation_count, b.rolling_mean_30d, b.rolling_stdev_30d,
               b.data_days
        FROM universe_symbol_daily_counts c
        JOIN universe_symbol_baselines b
          ON b.symbol = c.symbol
         AND b.source_type = c.source_type
         AND b.source_community = c.source_community
        WHERE c.day = ?
        """,
        (score_day,),
    ).fetchall()

    written = 0
    for row in rows:
        data_days = int(row["data_days"] or 0)
        if data_days < min_history:
            continue
        count = int(row["mention_count"] or 0)
        mean = float(row["rolling_mean_30d"] or 0.0)
        stdev = float(row["rolling_stdev_30d"] or 0.0)
        if stdev <= 0:
            stdev = max(1.0, math.sqrt(max(mean, 1.0)))
        z = (count - mean) / stdev
        velocity = count / mean if mean > 0 else float(count)
        discovery = int(row["discovery_count"] or 0)
        confirmation = int(row["confirmation_count"] or 0)
        role_bonus = 1.25 if discovery > 0 else 0.85
        source_bonus = 1.0
        score = max(0.0, (z * 20.0) + min(velocity, 10.0) * 5.0 + math.log1p(count) * 5.0)
        score *= role_bonus * source_bonus
        if not dry_run:
            conn.execute(
                """
                INSERT INTO universe_symbol_perturbations (
                  symbol, source_type, source_community, day,
                  mention_count, baseline_mean, baseline_stdev,
                  z_score, velocity_ratio, unique_authors,
                  discovery_count, confirmation_count,
                  perturbation_score, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, source_type, source_community, day)
                DO UPDATE SET
                  mention_count = excluded.mention_count,
                  baseline_mean = excluded.baseline_mean,
                  baseline_stdev = excluded.baseline_stdev,
                  z_score = excluded.z_score,
                  velocity_ratio = excluded.velocity_ratio,
                  unique_authors = excluded.unique_authors,
                  discovery_count = excluded.discovery_count,
                  confirmation_count = excluded.confirmation_count,
                  perturbation_score = excluded.perturbation_score,
                  updated_at = excluded.updated_at
                """,
                (
                    row["symbol"], row["source_type"], row["source_community"], score_day,
                    count, mean, stdev, z, velocity, int(row["unique_authors"] or 0),
                    discovery, confirmation, score, now,
                ),
            )
        written += 1
    return written


def run(
    *,
    db_path: Path,
    universe_path: Path,
    days_back: int,
    limit: int,
    score_day: Optional[int],
    min_history: int,
    dry_run: bool,
    verbose: bool,
) -> Dict[str, Any]:
    stocks = load_universe(universe_path)
    symbols, aliases = build_aliases(stocks)
    since = now_unix() - max(1, days_back) * DAY_SECONDS
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        ensure_tables(conn)
        hits = fetch_hits(conn, since, limit)
        purged_days = purge_mentions_since(conn, since, dry_run)
        all_mentions: List[Dict[str, Any]] = []
        for hit in hits:
            all_mentions.extend(match_hit(hit, symbols, aliases))
        inserted = upsert_mentions(conn, all_mentions, dry_run)
        affected_days = purged_days | {m["day"] for m in all_mentions}
        daily = refresh_daily_counts(conn, affected_days, dry_run)
        orphan_perturbations = purge_orphan_perturbations(conn, affected_days, dry_run)
        current_day = day_bucket(now_unix())
        eligible_days = [d for d in affected_days if d <= current_day]
        target_day = score_day if score_day is not None else (max(eligible_days) if eligible_days else current_day)
        baselines = rebuild_baselines(conn, target_day, dry_run)
        perturbations = score_perturbations(conn, target_day, min_history, dry_run)
        if not dry_run:
            conn.commit()
        summary = {
            "status": "ok",
            "universe_symbols": len(symbols),
            "company_aliases": len(aliases),
            "raw_hits_scanned": len(hits),
            "mentions_matched": len(all_mentions),
            "mentions_inserted": inserted,
            "daily_buckets_refreshed": daily,
            "orphan_perturbations_purged": orphan_perturbations,
            "baselines_written": baselines,
            "perturbations_scored": perturbations,
            "score_day": target_day,
            "dry_run": dry_run,
        }
        print(f"[universe-normalize] Done. {json.dumps(summary, sort_keys=True)}")
        if verbose:
            top = conn.execute(
                """
                SELECT symbol, source_type, source_community, mention_count,
                       baseline_mean, z_score, velocity_ratio,
                       discovery_count, confirmation_count, perturbation_score
                FROM universe_symbol_perturbations
                WHERE day = ?
                ORDER BY perturbation_score DESC
                LIMIT 20
                """,
                (target_day,),
            ).fetchall()
            for row in top:
                print(
                    f"  {row['symbol']:6s} {row['source_community'][:24]:24s} "
                    f"count={int(row['mention_count']):4d} mean={float(row['baseline_mean']):6.1f} "
                    f"z={float(row['z_score']):6.2f} vel={float(row['velocity_ratio']):5.1f} "
                    f"disc={int(row['discovery_count']):3d} conf={int(row['confirmation_count']):3d} "
                    f"score={float(row['perturbation_score']):6.1f}"
                )
        return summary
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize MI raw hits against the clean universe.")
    parser.add_argument("--db", default=str(DEFAULT_MI_DB))
    parser.add_argument("--universe", default=str(DEFAULT_UNIVERSE))
    parser.add_argument("--days-back", type=int, default=14)
    parser.add_argument("--limit", type=int, default=0, help="Max mi_raw_hits to scan. 0 = all in window.")
    parser.add_argument("--score-day", type=int, default=None, help="UTC midnight epoch day to score. Defaults to most recent affected day.")
    parser.add_argument("--min-history", type=int, default=2)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    run(
        db_path=Path(args.db),
        universe_path=Path(args.universe),
        days_back=args.days_back,
        limit=args.limit,
        score_day=args.score_day,
        min_history=max(1, args.min_history),
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
