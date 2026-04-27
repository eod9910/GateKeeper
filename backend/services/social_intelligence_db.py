from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
SOCIAL_INTELLIGENCE_DB_PATH = DATA_DIR / "social-intelligence.sqlite"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _trim_text(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _to_float(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num == num and num not in (float("inf"), float("-inf")) else None


class SocialIntelligenceDb:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve() if root is not None else ROOT
        self.db_path = self.root / "backend" / "data" / "social-intelligence.sqlite"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tracked_symbols (
                  symbol TEXT PRIMARY KEY,
                  universe_name TEXT NOT NULL,
                  active INTEGER NOT NULL DEFAULT 1,
                  first_seen_at TEXT NOT NULL,
                  last_seen_at TEXT NOT NULL,
                  source_json TEXT,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tracked_symbols_universe_active
                  ON tracked_symbols(universe_name, active, symbol);

                CREATE TABLE IF NOT EXISTS social_fetch_runs (
                  run_id TEXT PRIMARY KEY,
                  platform TEXT NOT NULL,
                  universe_name TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  completed_at TEXT,
                  status TEXT NOT NULL,
                  symbols_requested INTEGER,
                  symbols_succeeded INTEGER,
                  symbols_failed INTEGER,
                  notes_json TEXT,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_social_fetch_runs_platform_started
                  ON social_fetch_runs(platform, started_at DESC);

                CREATE TABLE IF NOT EXISTS social_posts_raw (
                  raw_post_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  symbol TEXT NOT NULL,
                  platform TEXT NOT NULL,
                  platform_post_id TEXT NOT NULL,
                  platform_thread_id TEXT,
                  author_id TEXT,
                  author_handle TEXT,
                  posted_at TEXT NOT NULL,
                  fetched_at TEXT NOT NULL,
                  body_text TEXT,
                  url TEXT,
                  language TEXT,
                  like_count INTEGER,
                  reply_count INTEGER,
                  repost_count INTEGER,
                  view_count INTEGER,
                  engagement_score REAL,
                  is_reply INTEGER,
                  is_repost INTEGER,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  UNIQUE(platform, platform_post_id)
                );

                CREATE INDEX IF NOT EXISTS idx_social_posts_raw_symbol_posted
                  ON social_posts_raw(symbol, posted_at DESC);

                CREATE INDEX IF NOT EXISTS idx_social_posts_raw_platform_posted
                  ON social_posts_raw(platform, posted_at DESC);

                CREATE TABLE IF NOT EXISTS social_posts_clean (
                  raw_post_id INTEGER PRIMARY KEY,
                  symbol TEXT NOT NULL,
                  platform TEXT NOT NULL,
                  canonical_post_key TEXT NOT NULL,
                  canonical_author_key TEXT,
                  trade_date TEXT NOT NULL,
                  posted_at TEXT NOT NULL,
                  cleaned_text TEXT,
                  token_count INTEGER,
                  has_ticker_mention INTEGER,
                  is_spam INTEGER,
                  spam_score REAL,
                  duplicate_group_key TEXT,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(raw_post_id) REFERENCES social_posts_raw(raw_post_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_social_posts_clean_symbol_trade_date
                  ON social_posts_clean(symbol, trade_date DESC, posted_at DESC);

                CREATE INDEX IF NOT EXISTS idx_social_posts_clean_duplicate_group
                  ON social_posts_clean(duplicate_group_key);

                CREATE TABLE IF NOT EXISTS social_post_sentiment (
                  raw_post_id INTEGER PRIMARY KEY,
                  symbol TEXT NOT NULL,
                  platform TEXT NOT NULL,
                  trade_date TEXT NOT NULL,
                  sentiment_label TEXT,
                  sentiment_score REAL,
                  sentiment_confidence REAL,
                  sentiment_model TEXT,
                  topic_label TEXT,
                  hype_score REAL,
                  fear_score REAL,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(raw_post_id) REFERENCES social_posts_raw(raw_post_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_social_post_sentiment_symbol_trade_date
                  ON social_post_sentiment(symbol, trade_date DESC);

                CREATE TABLE IF NOT EXISTS ticker_social_daily (
                  symbol TEXT NOT NULL,
                  trade_date TEXT NOT NULL,
                  platform TEXT NOT NULL DEFAULT 'aggregate',
                  mention_count_1d INTEGER,
                  mention_count_3d INTEGER,
                  mention_count_7d INTEGER,
                  mention_count_30d INTEGER,
                  unique_authors_1d INTEGER,
                  unique_authors_7d INTEGER,
                  posts_per_author REAL,
                  author_concentration REAL,
                  new_authors_ratio REAL,
                  bullish_count INTEGER,
                  bearish_count INTEGER,
                  neutral_count INTEGER,
                  bullish_ratio REAL,
                  bearish_ratio REAL,
                  net_sentiment REAL,
                  weighted_sentiment REAL,
                  engagement_per_post REAL,
                  likes_per_post REAL,
                  replies_per_post REAL,
                  reposts_per_post REAL,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(symbol, trade_date, platform)
                );

                CREATE INDEX IF NOT EXISTS idx_ticker_social_daily_trade_date
                  ON ticker_social_daily(trade_date DESC, symbol, platform);

                CREATE TABLE IF NOT EXISTS ticker_buzz_scores (
                  symbol TEXT NOT NULL,
                  trade_date TEXT NOT NULL,
                  buzz_zscore REAL,
                  unique_author_zscore REAL,
                  engagement_zscore REAL,
                  mention_velocity REAL,
                  mention_acceleration REAL,
                  sentiment_trend_3d REAL,
                  sentiment_trend_7d REAL,
                  yahoo_mentions INTEGER,
                  stocktwits_mentions INTEGER,
                  yahoo_sentiment REAL,
                  stocktwits_sentiment REAL,
                  cross_platform_agreement REAL,
                  tradability_score REAL,
                  final_buzz_score REAL,
                  buzz_rank REAL,
                  score_validity TEXT,
                  confidence_tier TEXT,
                  is_score_valid INTEGER NOT NULL DEFAULT 0,
                  reason_codes_json TEXT,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(symbol, trade_date)
                );

                CREATE INDEX IF NOT EXISTS idx_ticker_buzz_scores_trade_date_rank
                  ON ticker_buzz_scores(trade_date DESC, final_buzz_score DESC, symbol);
                """
            )
            self._ensure_column(conn, "ticker_buzz_scores", "score_validity", "TEXT")
            self._ensure_column(conn, "ticker_buzz_scores", "confidence_tier", "TEXT")
            self._ensure_column(conn, "ticker_buzz_scores", "is_score_valid", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(conn, "ticker_buzz_scores", "reason_codes_json", "TEXT")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ticker_buzz_scores_trade_date_valid_rank
                  ON ticker_buzz_scores(trade_date DESC, is_score_valid DESC, final_buzz_score DESC, symbol)
                """
            )

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        existing = {str(row[1]).lower() for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column.lower() in existing:
            return
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def upsert_tracked_symbols(
        self,
        symbols: Sequence[Dict[str, Any]],
        *,
        universe_name: str = "clean_stocks",
    ) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in symbols:
            symbol = _norm_symbol(row.get("symbol") or row.get("ticker"))
            if not symbol:
                continue
            prepared.append(
                (
                    symbol,
                    universe_name,
                    1,
                    now,
                    now,
                    json.dumps(row),
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO tracked_symbols (
                  symbol, universe_name, active, first_seen_at, last_seen_at, source_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                  universe_name = excluded.universe_name,
                  active = excluded.active,
                  last_seen_at = excluded.last_seen_at,
                  source_json = excluded.source_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def tracked_symbols(self, *, universe_name: Optional[str] = None, active_only: bool = True) -> List[str]:
        clauses: List[str] = []
        params: List[Any] = []
        if universe_name:
            clauses.append("universe_name = ?")
            params.append(universe_name)
        if active_only:
            clauses.append("active = 1")
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT symbol FROM tracked_symbols {where_sql} ORDER BY symbol",
                params,
            ).fetchall()
        return [str(row["symbol"]) for row in rows]

    def bulk_upsert_raw_posts(self, rows: Sequence[Dict[str, Any]]) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in rows:
            symbol = _norm_symbol(row.get("symbol"))
            platform = _trim_text(row.get("platform"))
            platform_post_id = _trim_text(row.get("platform_post_id"))
            posted_at = _trim_text(row.get("posted_at"))
            if not symbol or not platform or not platform_post_id or not posted_at:
                continue
            prepared.append(
                (
                    symbol,
                    platform,
                    platform_post_id,
                    _trim_text(row.get("platform_thread_id")),
                    _trim_text(row.get("author_id")),
                    _trim_text(row.get("author_handle")),
                    posted_at,
                    _trim_text(row.get("fetched_at")) or now,
                    _trim_text(row.get("body_text")),
                    _trim_text(row.get("url")),
                    _trim_text(row.get("language")),
                    row.get("like_count"),
                    row.get("reply_count"),
                    row.get("repost_count"),
                    row.get("view_count"),
                    _to_float(row.get("engagement_score")),
                    1 if row.get("is_reply") else 0,
                    1 if row.get("is_repost") else 0,
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO social_posts_raw (
                  symbol, platform, platform_post_id, platform_thread_id, author_id, author_handle,
                  posted_at, fetched_at, body_text, url, language, like_count, reply_count, repost_count,
                  view_count, engagement_score, is_reply, is_repost, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, platform_post_id) DO UPDATE SET
                  symbol = excluded.symbol,
                  platform_thread_id = excluded.platform_thread_id,
                  author_id = excluded.author_id,
                  author_handle = excluded.author_handle,
                  posted_at = excluded.posted_at,
                  fetched_at = excluded.fetched_at,
                  body_text = excluded.body_text,
                  url = excluded.url,
                  language = excluded.language,
                  like_count = excluded.like_count,
                  reply_count = excluded.reply_count,
                  repost_count = excluded.repost_count,
                  view_count = excluded.view_count,
                  engagement_score = excluded.engagement_score,
                  is_reply = excluded.is_reply,
                  is_repost = excluded.is_repost,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def raw_post_id_map(self, rows: Sequence[Dict[str, Any]]) -> Dict[tuple[str, str], int]:
        keys = []
        for row in rows:
            platform = _trim_text(row.get("platform"))
            platform_post_id = _trim_text(row.get("platform_post_id"))
            if not platform or not platform_post_id:
                continue
            keys.append((platform, platform_post_id))
        if not keys:
            return {}
        placeholders = ", ".join(["(?, ?)"] * len(keys))
        params: List[Any] = []
        for platform, post_id in keys:
            params.extend([platform, post_id])
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT platform, platform_post_id, raw_post_id
                FROM social_posts_raw
                WHERE (platform, platform_post_id) IN ({placeholders})
                """,
                params,
            ).fetchall()
        return {
            (str(row["platform"]), str(row["platform_post_id"])): int(row["raw_post_id"])
            for row in rows
        }

    def bulk_upsert_clean_posts(self, rows: Sequence[Dict[str, Any]]) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in rows:
            raw_post_id = row.get("raw_post_id")
            symbol = _norm_symbol(row.get("symbol"))
            platform = _trim_text(row.get("platform"))
            canonical_post_key = _trim_text(row.get("canonical_post_key"))
            trade_date = _trim_text(row.get("trade_date"))
            posted_at = _trim_text(row.get("posted_at"))
            if raw_post_id is None or not symbol or not platform or not canonical_post_key or not trade_date or not posted_at:
                continue
            prepared.append(
                (
                    raw_post_id,
                    symbol,
                    platform,
                    canonical_post_key,
                    _trim_text(row.get("canonical_author_key")),
                    trade_date,
                    posted_at,
                    _trim_text(row.get("cleaned_text")),
                    row.get("token_count"),
                    1 if row.get("has_ticker_mention") else 0,
                    1 if row.get("is_spam") else 0,
                    _to_float(row.get("spam_score")),
                    _trim_text(row.get("duplicate_group_key")),
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO social_posts_clean (
                  raw_post_id, symbol, platform, canonical_post_key, canonical_author_key,
                  trade_date, posted_at, cleaned_text, token_count, has_ticker_mention,
                  is_spam, spam_score, duplicate_group_key, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(raw_post_id) DO UPDATE SET
                  symbol = excluded.symbol,
                  platform = excluded.platform,
                  canonical_post_key = excluded.canonical_post_key,
                  canonical_author_key = excluded.canonical_author_key,
                  trade_date = excluded.trade_date,
                  posted_at = excluded.posted_at,
                  cleaned_text = excluded.cleaned_text,
                  token_count = excluded.token_count,
                  has_ticker_mention = excluded.has_ticker_mention,
                  is_spam = excluded.is_spam,
                  spam_score = excluded.spam_score,
                  duplicate_group_key = excluded.duplicate_group_key,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def bulk_upsert_post_sentiment(self, rows: Sequence[Dict[str, Any]]) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in rows:
            raw_post_id = row.get("raw_post_id")
            symbol = _norm_symbol(row.get("symbol"))
            platform = _trim_text(row.get("platform"))
            trade_date = _trim_text(row.get("trade_date"))
            if raw_post_id is None or not symbol or not platform or not trade_date:
                continue
            prepared.append(
                (
                    raw_post_id,
                    symbol,
                    platform,
                    trade_date,
                    _trim_text(row.get("sentiment_label")),
                    _to_float(row.get("sentiment_score")),
                    _to_float(row.get("sentiment_confidence")),
                    _trim_text(row.get("sentiment_model")),
                    _trim_text(row.get("topic_label")),
                    _to_float(row.get("hype_score")),
                    _to_float(row.get("fear_score")),
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO social_post_sentiment (
                  raw_post_id, symbol, platform, trade_date, sentiment_label, sentiment_score,
                  sentiment_confidence, sentiment_model, topic_label, hype_score, fear_score,
                  payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(raw_post_id) DO UPDATE SET
                  symbol = excluded.symbol,
                  platform = excluded.platform,
                  trade_date = excluded.trade_date,
                  sentiment_label = excluded.sentiment_label,
                  sentiment_score = excluded.sentiment_score,
                  sentiment_confidence = excluded.sentiment_confidence,
                  sentiment_model = excluded.sentiment_model,
                  topic_label = excluded.topic_label,
                  hype_score = excluded.hype_score,
                  fear_score = excluded.fear_score,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def bulk_upsert_daily_features(self, rows: Sequence[Dict[str, Any]]) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in rows:
            symbol = _norm_symbol(row.get("symbol"))
            trade_date = _trim_text(row.get("trade_date"))
            if not symbol or not trade_date:
                continue
            prepared.append(
                (
                    symbol,
                    trade_date,
                    _trim_text(row.get("platform")) or "aggregate",
                    row.get("mention_count_1d"),
                    row.get("mention_count_3d"),
                    row.get("mention_count_7d"),
                    row.get("mention_count_30d"),
                    row.get("unique_authors_1d"),
                    row.get("unique_authors_7d"),
                    _to_float(row.get("posts_per_author")),
                    _to_float(row.get("author_concentration")),
                    _to_float(row.get("new_authors_ratio")),
                    row.get("bullish_count"),
                    row.get("bearish_count"),
                    row.get("neutral_count"),
                    _to_float(row.get("bullish_ratio")),
                    _to_float(row.get("bearish_ratio")),
                    _to_float(row.get("net_sentiment")),
                    _to_float(row.get("weighted_sentiment")),
                    _to_float(row.get("engagement_per_post")),
                    _to_float(row.get("likes_per_post")),
                    _to_float(row.get("replies_per_post")),
                    _to_float(row.get("reposts_per_post")),
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO ticker_social_daily (
                  symbol, trade_date, platform, mention_count_1d, mention_count_3d, mention_count_7d, mention_count_30d,
                  unique_authors_1d, unique_authors_7d, posts_per_author, author_concentration, new_authors_ratio,
                  bullish_count, bearish_count, neutral_count, bullish_ratio, bearish_ratio, net_sentiment,
                  weighted_sentiment, engagement_per_post, likes_per_post, replies_per_post, reposts_per_post,
                  payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, trade_date, platform) DO UPDATE SET
                  mention_count_1d = excluded.mention_count_1d,
                  mention_count_3d = excluded.mention_count_3d,
                  mention_count_7d = excluded.mention_count_7d,
                  mention_count_30d = excluded.mention_count_30d,
                  unique_authors_1d = excluded.unique_authors_1d,
                  unique_authors_7d = excluded.unique_authors_7d,
                  posts_per_author = excluded.posts_per_author,
                  author_concentration = excluded.author_concentration,
                  new_authors_ratio = excluded.new_authors_ratio,
                  bullish_count = excluded.bullish_count,
                  bearish_count = excluded.bearish_count,
                  neutral_count = excluded.neutral_count,
                  bullish_ratio = excluded.bullish_ratio,
                  bearish_ratio = excluded.bearish_ratio,
                  net_sentiment = excluded.net_sentiment,
                  weighted_sentiment = excluded.weighted_sentiment,
                  engagement_per_post = excluded.engagement_per_post,
                  likes_per_post = excluded.likes_per_post,
                  replies_per_post = excluded.replies_per_post,
                  reposts_per_post = excluded.reposts_per_post,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def start_fetch_run(
        self,
        *,
        run_id: str,
        platform: str,
        universe_name: str,
        symbols_requested: int,
        notes: Optional[Dict[str, Any]] = None,
    ) -> None:
        now = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO social_fetch_runs (
                  run_id, platform, universe_name, started_at, completed_at, status,
                  symbols_requested, symbols_succeeded, symbols_failed, notes_json, updated_at
                )
                VALUES (?, ?, ?, ?, NULL, 'running', ?, 0, 0, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                  platform = excluded.platform,
                  universe_name = excluded.universe_name,
                  started_at = excluded.started_at,
                  completed_at = NULL,
                  status = 'running',
                  symbols_requested = excluded.symbols_requested,
                  notes_json = excluded.notes_json,
                  updated_at = excluded.updated_at
                """,
                (
                    _trim_text(run_id),
                    _trim_text(platform),
                    _trim_text(universe_name),
                    now,
                    symbols_requested,
                    json.dumps(notes) if notes is not None else None,
                    now,
                ),
            )

    def finish_fetch_run(
        self,
        *,
        run_id: str,
        status: str,
        symbols_succeeded: int,
        symbols_failed: int,
        notes: Optional[Dict[str, Any]] = None,
    ) -> None:
        now = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE social_fetch_runs
                SET completed_at = ?,
                    status = ?,
                    symbols_succeeded = ?,
                    symbols_failed = ?,
                    notes_json = COALESCE(?, notes_json),
                    updated_at = ?
                WHERE run_id = ?
                """,
                (
                    now,
                    _trim_text(status) or "completed",
                    symbols_succeeded,
                    symbols_failed,
                    json.dumps(notes) if notes is not None else None,
                    now,
                    _trim_text(run_id),
                ),
            )

    def bulk_upsert_buzz_scores(self, rows: Sequence[Dict[str, Any]]) -> None:
        now = _utc_now_iso()
        prepared: List[tuple[Any, ...]] = []
        for row in rows:
            symbol = _norm_symbol(row.get("symbol"))
            trade_date = _trim_text(row.get("trade_date"))
            if not symbol or not trade_date:
                continue
            prepared.append(
                (
                    symbol,
                    trade_date,
                    _to_float(row.get("buzz_zscore")),
                    _to_float(row.get("unique_author_zscore")),
                    _to_float(row.get("engagement_zscore")),
                    _to_float(row.get("mention_velocity")),
                    _to_float(row.get("mention_acceleration")),
                    _to_float(row.get("sentiment_trend_3d")),
                    _to_float(row.get("sentiment_trend_7d")),
                    row.get("yahoo_mentions"),
                    row.get("stocktwits_mentions"),
                    _to_float(row.get("yahoo_sentiment")),
                    _to_float(row.get("stocktwits_sentiment")),
                    _to_float(row.get("cross_platform_agreement")),
                    _to_float(row.get("tradability_score")),
                    _to_float(row.get("final_buzz_score")),
                    _to_float(row.get("buzz_rank")),
                    _trim_text(row.get("score_validity")),
                    _trim_text(row.get("confidence_tier")),
                    1 if row.get("is_score_valid") else 0,
                    json.dumps(row.get("reason_codes")) if row.get("reason_codes") is not None else None,
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    now,
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO ticker_buzz_scores (
                  symbol, trade_date, buzz_zscore, unique_author_zscore, engagement_zscore,
                  mention_velocity, mention_acceleration, sentiment_trend_3d, sentiment_trend_7d,
                  yahoo_mentions, stocktwits_mentions, yahoo_sentiment, stocktwits_sentiment,
                  cross_platform_agreement, tradability_score, final_buzz_score, buzz_rank,
                  score_validity, confidence_tier, is_score_valid, reason_codes_json,
                  payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, trade_date) DO UPDATE SET
                  buzz_zscore = excluded.buzz_zscore,
                  unique_author_zscore = excluded.unique_author_zscore,
                  engagement_zscore = excluded.engagement_zscore,
                  mention_velocity = excluded.mention_velocity,
                  mention_acceleration = excluded.mention_acceleration,
                  sentiment_trend_3d = excluded.sentiment_trend_3d,
                  sentiment_trend_7d = excluded.sentiment_trend_7d,
                  yahoo_mentions = excluded.yahoo_mentions,
                  stocktwits_mentions = excluded.stocktwits_mentions,
                  yahoo_sentiment = excluded.yahoo_sentiment,
                  stocktwits_sentiment = excluded.stocktwits_sentiment,
                  cross_platform_agreement = excluded.cross_platform_agreement,
                  tradability_score = excluded.tradability_score,
                  final_buzz_score = excluded.final_buzz_score,
                  buzz_rank = excluded.buzz_rank,
                  score_validity = excluded.score_validity,
                  confidence_tier = excluded.confidence_tier,
                  is_score_valid = excluded.is_score_valid,
                  reason_codes_json = excluded.reason_codes_json,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def db_stats(self) -> Dict[str, int]:
        with self._connect() as conn:
            tracked = conn.execute("SELECT COUNT(*) FROM tracked_symbols").fetchone()[0]
            raw_posts = conn.execute("SELECT COUNT(*) FROM social_posts_raw").fetchone()[0]
            clean_posts = conn.execute("SELECT COUNT(*) FROM social_posts_clean").fetchone()[0]
            sentiment = conn.execute("SELECT COUNT(*) FROM social_post_sentiment").fetchone()[0]
            daily = conn.execute("SELECT COUNT(*) FROM ticker_social_daily").fetchone()[0]
            scores = conn.execute("SELECT COUNT(*) FROM ticker_buzz_scores").fetchone()[0]
        return {
            "tracked_symbols": tracked,
            "social_posts_raw": raw_posts,
            "social_posts_clean": clean_posts,
            "social_post_sentiment": sentiment,
            "ticker_social_daily": daily,
            "ticker_buzz_scores": scores,
        }
