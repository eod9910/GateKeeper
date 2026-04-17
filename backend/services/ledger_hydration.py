from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from ledgerCoverage import resolve_coverage


ROOT = Path(__file__).resolve().parents[2]
PROBE_ROOT = ROOT / "Financial data" / "docling_probe"
PROBE_SCRIPTS_DIR = PROBE_ROOT / "scripts"
PROBE_VENV_PYTHON = PROBE_ROOT / ".venv" / "Scripts" / "python.exe"
RETRIEVAL_DB_PATH = PROBE_ROOT / "retrieval" / "index" / "filing_rag.sqlite"
ELIGIBILITY_REPORT_PATH = ROOT / "backend" / "data" / "ledger_filing_eligibility_report.json"
SEC_TICKER_MAP_PATH = PROBE_ROOT / "raw" / "sec" / "bulk" / "company_tickers_exchange.json"
CANONICAL_REPAIR_SCRIPT = ROOT / "backend" / "scripts" / "ensure_canonical_universe_symbol.py"
SNAPSHOT_HYDRATE_SCRIPT = ROOT / "backend" / "scripts" / "hydrate_fundamentals_pit.py"


@dataclass(frozen=True)
class HydrationOptions:
    annual_count: int = 1
    quarterly_count: int = 2
    current_count: int = 6
    skip_sec: bool = False
    skip_snapshot: bool = False


class LedgerHydrationCoordinator:
    """Coordinator for all per-symbol Ledger hydration stages."""

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve() if root is not None else ROOT

    def hydrate_symbol(self, symbol: str, options: Optional[HydrationOptions] = None) -> Dict[str, Any]:
        opts = options or HydrationOptions()
        normalized = self._normalize_symbol(symbol)
        if not normalized:
            raise ValueError("symbol required")

        coverage_before = resolve_coverage(normalized)
        summary: Dict[str, Any] = {
            "ok": True,
            "symbol": normalized,
            "coverage_before": coverage_before,
            "canonical_refresh": None,
            "snapshot_hydration": None,
            "sec_hydration": None,
            "pit_import": None,
            "retrieval_refresh": None,
        }

        summary["canonical_refresh"] = self.run_canonical_refresh(normalized)

        if not opts.skip_snapshot:
            summary["snapshot_hydration"] = self.run_snapshot_hydration(normalized)

        if not opts.skip_sec:
            sec_bundle = self.run_sec_pipeline(normalized, opts)
            summary["sec_hydration"] = sec_bundle["sec_hydration"]
            summary["pit_import"] = sec_bundle["pit_import"]
            summary["retrieval_refresh"] = sec_bundle["retrieval_refresh"]

        coverage_after = resolve_coverage(normalized)
        summary["coverage_after"] = coverage_after

        canonical_ok = bool(summary.get("canonical_refresh") and summary["canonical_refresh"].get("ok"))
        sec_ok = bool(summary.get("sec_hydration") and summary["sec_hydration"].get("ok"))
        retrieval_ok = bool(summary.get("retrieval_refresh") and summary["retrieval_refresh"].get("ok"))
        snapshot_ok = bool(summary.get("snapshot_hydration") and summary["snapshot_hydration"].get("ok"))

        if coverage_after.get("coverage_tier") == "full_filing_supported":
            summary["status"] = "full_filing_supported"
        elif canonical_ok or sec_ok or retrieval_ok or snapshot_ok:
            summary["status"] = "partial_hydration"
        else:
            summary["status"] = "no_change"

        return summary

    def run_canonical_refresh(self, symbol: str) -> Optional[Dict[str, Any]]:
        if not CANONICAL_REPAIR_SCRIPT.exists():
            return None
        result = self._run_command(
            [
                sys.executable,
                str(CANONICAL_REPAIR_SCRIPT),
                "--symbol",
                symbol,
            ],
            timeout=1800,
        )
        if isinstance(result.get("json"), dict):
            return {
                "ok": result["ok"],
                **result["json"],
                "stderr": result["stderr"][-4000:],
            }
        return result

    def run_snapshot_hydration(self, symbol: str) -> Dict[str, Any]:
        return self._run_command(
            [
                sys.executable,
                str(SNAPSHOT_HYDRATE_SCRIPT),
                "--symbols",
                symbol,
                "--limit",
                "1",
                "--refresh-cache",
                "--delay-ms",
                "0",
            ],
            timeout=600,
        )

    def run_sec_pipeline(self, symbol: str, options: HydrationOptions) -> Dict[str, Any]:
        cik = self._resolve_cik(symbol)
        if not cik:
            return {
                "sec_hydration": {
                    "ok": False,
                    "status": "no_sec_mapping",
                    "message": "No SEC CIK mapping was found for this symbol.",
                },
                "pit_import": None,
                "retrieval_refresh": None,
            }

        sec_result = self._run_command(
            [
                self._probe_python(),
                str(PROBE_SCRIPTS_DIR / "pipeline_company_history.py"),
                "--cik",
                cik,
                "--annual-count",
                str(max(0, options.annual_count)),
                "--quarterly-count",
                str(max(0, options.quarterly_count)),
                "--current-count",
                str(max(0, options.current_count)),
            ],
            timeout=1800,
        )

        sec_hydration = {
            "ok": sec_result["ok"],
            "status": "completed" if sec_result["ok"] else "failed",
            "cik": cik,
            "result": sec_result["json"],
            "stderr": sec_result["stderr"][-4000:],
        }

        pit_import = None
        retrieval_refresh = None
        smoke_test_file = None
        if isinstance(sec_result.get("json"), dict):
            smoke_test_file = sec_result["json"].get("smoke_test_file")

        if sec_result["ok"] and smoke_test_file:
            pit_import = self._run_command(
                [
                    sys.executable,
                    str(PROBE_SCRIPTS_DIR / "import_smoke_test_to_pit.py"),
                    "--symbol",
                    symbol,
                    "--smoke-test-file",
                    str(smoke_test_file),
                ],
                timeout=600,
            )
            if pit_import is not None:
                pit_import = {
                    "ok": pit_import["ok"],
                    "result": pit_import["json"],
                    "stderr": pit_import["stderr"][-4000:],
                }

            smoke_summary = self._load_json_file(Path(smoke_test_file))
            retrieval_refresh = self.run_retrieval_refresh(symbol, smoke_summary)

        return {
            "sec_hydration": sec_hydration,
            "pit_import": pit_import,
            "retrieval_refresh": retrieval_refresh,
        }

    def run_retrieval_refresh(self, symbol: str, smoke_summary: Dict[str, Any]) -> Dict[str, Any]:
        chunk_reports: List[Dict[str, Any]] = []
        chunk_files: List[Path] = []
        for markdown_path in self._iter_smoke_test_markdown_files(smoke_summary):
            chunk_result = self._run_command(
                [
                    sys.executable,
                    str(PROBE_SCRIPTS_DIR / "chunk_docling_for_retrieval.py"),
                    "--markdown",
                    str(markdown_path),
                ],
                timeout=300,
            )
            chunk_reports.append(
                {
                    "ok": chunk_result["ok"],
                    "result": chunk_result["json"],
                    "stderr": chunk_result["stderr"][-2000:],
                }
            )
            if chunk_result["ok"]:
                chunk_files.extend(self._extract_chunk_files_from_chunk_result(chunk_result.get("json")))

        if not chunk_files:
            return {
                "ok": False,
                "status": "no_chunk_files",
                "chunk_reports": chunk_reports,
            }

        return {
            **self._incremental_import_chunks(chunk_files, fallback_symbol=symbol),
            "chunk_reports": chunk_reports,
        }

    @staticmethod
    def _normalize_symbol(value: Any) -> str:
        return str(value or "").strip().upper()

    @staticmethod
    def _probe_python() -> str:
        if PROBE_VENV_PYTHON.exists():
            return str(PROBE_VENV_PYTHON)
        return sys.executable

    @staticmethod
    def _parse_json_tail(text: str) -> Any:
        payload = (text or "").strip()
        if not payload:
            return None
        try:
            return json.loads(payload)
        except Exception:
            pass
        for idx in range(len(payload) - 1, -1, -1):
            if payload[idx] != "{":
                continue
            candidate = payload[idx:]
            try:
                return json.loads(candidate)
            except Exception:
                continue
        return None

    def _run_command(self, cmd: List[str], cwd: Optional[Path] = None, timeout: int = 900) -> Dict[str, Any]:
        completed = subprocess.run(
            cmd,
            cwd=str(cwd or self.root),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        payload = self._parse_json_tail(completed.stdout)
        return {
            "ok": completed.returncode == 0,
            "cmd": cmd,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "json": payload,
        }

    @staticmethod
    def _load_json_file(path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    def _lookup_cik_from_eligibility(self, symbol: str) -> Optional[str]:
        if not ELIGIBILITY_REPORT_PATH.exists():
            return None
        try:
            payload = self._load_json_file(ELIGIBILITY_REPORT_PATH)
            rows = payload.get("rows") or []
        except Exception:
            return None
        for row in rows:
            if self._normalize_symbol((row or {}).get("symbol")) != symbol:
                continue
            cik = str((row or {}).get("cik") or "").strip()
            if cik:
                return cik
        return None

    def _lookup_cik_from_sec_map(self, symbol: str) -> Optional[str]:
        if not SEC_TICKER_MAP_PATH.exists():
            return None
        try:
            payload = self._load_json_file(SEC_TICKER_MAP_PATH)
        except Exception:
            return None

        if isinstance(payload, dict):
            fields = payload.get("fields")
            rows = payload.get("data")
            if isinstance(fields, list) and isinstance(rows, list):
                indexes = {str(name): idx for idx, name in enumerate(fields)}
                ticker_idx = indexes.get("ticker")
                cik_idx = indexes.get("cik")
                if ticker_idx is not None and cik_idx is not None:
                    for row in rows:
                        if not isinstance(row, list):
                            continue
                        candidate = row[ticker_idx] if ticker_idx < len(row) else None
                        if self._normalize_symbol(candidate) != symbol:
                            continue
                        cik = str(row[cik_idx] if cik_idx < len(row) else "").strip()
                        if cik:
                            return cik
        return None

    def _resolve_cik(self, symbol: str) -> Optional[str]:
        return self._lookup_cik_from_eligibility(symbol) or self._lookup_cik_from_sec_map(symbol)

    @staticmethod
    def _iter_smoke_test_markdown_files(summary: Dict[str, Any]) -> Iterable[Path]:
        for block_name, filings in (summary or {}).items():
            if not str(block_name).endswith("_filings") or not isinstance(filings, list):
                continue
            for filing in filings:
                markdown_file = filing.get("docling_markdown_file")
                if markdown_file:
                    yield Path(markdown_file).resolve()

    @staticmethod
    def _ensure_retrieval_schema(conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS retrieval_chunks (
              row_id INTEGER PRIMARY KEY,
              chunk_id TEXT UNIQUE NOT NULL,
              symbol TEXT,
              company TEXT,
              cik TEXT,
              form TEXT,
              accession_number TEXT,
              filing_date TEXT,
              report_date TEXT,
              filing_url TEXT,
              section_index INTEGER,
              chunk_index INTEGER,
              section_heading TEXT,
              char_count INTEGER,
              text TEXT NOT NULL,
              source_markdown_file TEXT,
              source_metadata_file TEXT,
              created_at TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts USING fts5(
              text,
              section_heading,
              symbol,
              company,
              content='retrieval_chunks',
              content_rowid='row_id'
            );
            CREATE TABLE IF NOT EXISTS retrieval_index_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            """
        )

    @staticmethod
    def _load_chunk_rows(chunk_file: Path, fallback_symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        with chunk_file.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                item = json.loads(line)
                if fallback_symbol and not str(item.get("symbol") or "").strip():
                    item["symbol"] = fallback_symbol
                rows.append(item)
        return rows

    def _extract_chunk_files_from_chunk_result(self, payload: Any) -> List[Path]:
        if not isinstance(payload, dict):
            return []
        chunk_files: List[Path] = []
        direct = payload.get("chunks_file")
        if direct:
            chunk_files.append(Path(str(direct)).resolve())
        batch_report = payload.get("batch_report")
        if batch_report:
            try:
                batch_payload = self._load_json_file(Path(str(batch_report)).resolve())
            except Exception:
                batch_payload = None
            if isinstance(batch_payload, dict):
                for item in batch_payload.get("results") or []:
                    candidate = (item or {}).get("chunks_file")
                    if candidate:
                        chunk_files.append(Path(str(candidate)).resolve())
        deduped: List[Path] = []
        seen: set[str] = set()
        for path in chunk_files:
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(path)
        return deduped

    @staticmethod
    def _delete_existing_markdown_rows(conn: sqlite3.Connection, markdown_files: List[str]) -> int:
        if not markdown_files:
            return 0
        placeholders = ", ".join("?" for _ in markdown_files)
        row_ids = [
            int(row[0])
            for row in conn.execute(
                f"SELECT row_id FROM retrieval_chunks WHERE source_markdown_file IN ({placeholders})",
                tuple(markdown_files),
            ).fetchall()
        ]
        if not row_ids:
            return 0
        id_placeholders = ", ".join("?" for _ in row_ids)
        conn.execute(f"DELETE FROM retrieval_chunks_fts WHERE rowid IN ({id_placeholders})", tuple(row_ids))
        conn.execute(f"DELETE FROM retrieval_chunks WHERE row_id IN ({id_placeholders})", tuple(row_ids))
        conn.commit()
        return len(row_ids)

    def _incremental_import_chunks(self, chunk_files: List[Path], *, fallback_symbol: Optional[str] = None) -> Dict[str, Any]:
        RETRIEVAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(RETRIEVAL_DB_PATH, timeout=30)
        try:
            self._ensure_retrieval_schema(conn)
            conn.execute("PRAGMA busy_timeout = 30000")
            markdown_files = sorted({
                str(row.get("source_markdown_file") or "")
                for path in chunk_files
                for row in self._load_chunk_rows(path, fallback_symbol=fallback_symbol)
                if row.get("source_markdown_file")
            })
            deleted_rows = self._delete_existing_markdown_rows(conn, markdown_files)

            inserted_rows = 0
            for chunk_file in chunk_files:
                rows = self._load_chunk_rows(chunk_file, fallback_symbol=fallback_symbol)
                for item in rows:
                    cursor = conn.execute(
                        """
                        INSERT INTO retrieval_chunks (
                          chunk_id, symbol, company, cik, form, accession_number, filing_date, report_date,
                          filing_url, section_index, chunk_index, section_heading, char_count, text,
                          source_markdown_file, source_metadata_file, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            item.get("chunk_id"),
                            item.get("symbol"),
                            item.get("company"),
                            item.get("cik"),
                            item.get("form"),
                            item.get("accession_number"),
                            item.get("filing_date"),
                            item.get("report_date"),
                            item.get("filing_url"),
                            item.get("section_index"),
                            item.get("chunk_index"),
                            item.get("section_heading"),
                            item.get("char_count"),
                            item.get("text"),
                            item.get("source_markdown_file"),
                            item.get("source_metadata_file"),
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
                    row_id = int(cursor.lastrowid)
                    conn.execute(
                        "INSERT INTO retrieval_chunks_fts(rowid, text, section_heading, symbol, company) VALUES (?, ?, ?, ?, ?)",
                        (
                            row_id,
                            item.get("text"),
                            item.get("section_heading"),
                            item.get("symbol"),
                            item.get("company"),
                        ),
                    )
                    inserted_rows += 1

            meta = {
                "built_at": datetime.now(timezone.utc).isoformat(),
                "chunk_count": int(conn.execute("SELECT COUNT(*) FROM retrieval_chunks").fetchone()[0]),
                "model_name": "fts_incremental_only",
                "db_path": str(RETRIEVAL_DB_PATH),
            }
            conn.executemany(
                "INSERT OR REPLACE INTO retrieval_index_meta(key, value) VALUES (?, ?)",
                [
                    (key, json.dumps(value) if not isinstance(value, str) else value)
                    for key, value in meta.items()
                ],
            )
            conn.commit()
            return {
                "ok": True,
                "chunk_files": [str(path) for path in chunk_files],
                "deleted_rows": deleted_rows,
                "inserted_rows": inserted_rows,
                "chunk_count": meta["chunk_count"],
                "mode": "incremental_fts_only",
            }
        finally:
            conn.close()

