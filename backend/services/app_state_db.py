from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
APP_STATE_DB_PATH = DATA_DIR / "app-state.sqlite"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AppStateDb:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve() if root is not None else ROOT
        self.db_path = self.root / "backend" / "data" / "app-state.sqlite"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cache_entries (
                  namespace TEXT NOT NULL,
                  cache_key TEXT NOT NULL,
                  fetched_at INTEGER NOT NULL,
                  ttl_ms INTEGER NOT NULL,
                  source TEXT NOT NULL,
                  version INTEGER NOT NULL DEFAULT 1,
                  data_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (namespace, cache_key)
                );

                CREATE INDEX IF NOT EXISTS idx_cache_entries_namespace_updated
                  ON cache_entries(namespace, updated_at DESC);

                CREATE TABLE IF NOT EXISTS json_documents (
                  namespace TEXT NOT NULL,
                  document_key TEXT NOT NULL,
                  json_value TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (namespace, document_key)
                );

                CREATE INDEX IF NOT EXISTS idx_json_documents_namespace_updated
                  ON json_documents(namespace, updated_at DESC);

                CREATE TABLE IF NOT EXISTS hydration_jobs (
                  job_id TEXT PRIMARY KEY,
                  job_type TEXT NOT NULL,
                  status TEXT NOT NULL,
                  started_at TEXT,
                  completed_at TEXT,
                  updated_at TEXT NOT NULL,
                  payload_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_hydration_jobs_status_updated
                  ON hydration_jobs(status, updated_at DESC);

                CREATE TABLE IF NOT EXISTS validation_reports (
                  report_id TEXT PRIMARY KEY,
                  strategy_version_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  decision TEXT,
                  payload_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_validation_reports_strategy_created
                  ON validation_reports(strategy_version_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS trade_instances (
                  report_id TEXT NOT NULL,
                  trade_id TEXT NOT NULL,
                  entry_time TEXT,
                  payload_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (report_id, trade_id)
                );

                CREATE INDEX IF NOT EXISTS idx_trade_instances_report_entry
                  ON trade_instances(report_id, entry_time ASC);

                CREATE TABLE IF NOT EXISTS app_records (
                  namespace TEXT NOT NULL,
                  record_id TEXT NOT NULL,
                  user_key TEXT,
                  sort_key TEXT,
                  payload_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (namespace, record_id)
                );

                CREATE INDEX IF NOT EXISTS idx_app_records_namespace_sort
                  ON app_records(namespace, sort_key DESC, updated_at DESC);

                CREATE INDEX IF NOT EXISTS idx_app_records_namespace_user
                  ON app_records(namespace, user_key, updated_at DESC);
                """
            )

    def upsert_hydration_job(
        self,
        job_id: str,
        status: str,
        payload: Dict[str, Any],
    ) -> None:
        job_meta = payload.get("job") if isinstance(payload, dict) else {}
        started_at = job_meta.get("started_at") if isinstance(job_meta, dict) else None
        completed_at = job_meta.get("completed_at") if isinstance(job_meta, dict) else None
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO hydration_jobs (
                  job_id, job_type, status, started_at, completed_at, updated_at, payload_json
                )
                VALUES (?, 'ledger_sync', ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                  status = excluded.status,
                  started_at = excluded.started_at,
                  completed_at = excluded.completed_at,
                  updated_at = excluded.updated_at,
                  payload_json = excluded.payload_json
                """,
                (
                    str(job_id),
                    str(status or "unknown"),
                    started_at,
                    completed_at,
                    _utc_now_iso(),
                    json.dumps(payload, indent=2),
                ),
            )
