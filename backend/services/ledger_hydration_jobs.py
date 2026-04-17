from __future__ import annotations

import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from ledgerCoverage import resolve_coverage
from app_state_db import AppStateDb
from ledger_hydration import HydrationOptions, LedgerHydrationCoordinator


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
REPORTS_DIR = DATA_DIR / "research"
PIT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
ProgressCallback = Callable[[str], None]


@dataclass(frozen=True)
class LedgerSyncJobOptions:
    limit: int = 0
    annual_count: int = 1
    quarterly_count: int = 2
    current_count: int = 6
    symbols: List[str] = field(default_factory=list)
    dry_run: bool = False
    write_report: bool = False
    workers: int = 1


class LedgerHydrationJobManager:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve() if root is not None else ROOT
        self.coordinator = LedgerHydrationCoordinator(root=self.root)
        self.app_state = AppStateDb(root=self.root)

    def run_sync_job(
        self,
        options: LedgerSyncJobOptions,
        *,
        emit_progress: Optional[ProgressCallback] = None,
    ) -> Dict[str, Any]:
        emit = emit_progress or (lambda _message: None)
        candidates = self._candidate_rows(list(options.symbols or []))
        if options.limit and options.limit > 0:
            candidates = candidates[: options.limit]

        current_filing_before = self._load_current_filing_coverage()
        total = len(candidates)
        report_path = (
            REPORTS_DIR / f"ledger_canonical_sync_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
            if options.write_report else None
        )
        job_id = self._make_job_id()
        rows_by_index: Dict[int, Dict[str, Any]] = {}
        job_state: Dict[str, Any] = {
            "job": {
                "job_id": job_id,
                "status": "running",
                "dry_run": bool(options.dry_run),
                "started_at": self._utc_now_iso(),
                "completed_at": None,
                "workers": max(1, int(options.workers or 1)),
                "annual_count": max(0, options.annual_count),
                "quarterly_count": max(0, options.quarterly_count),
                "current_count": max(0, options.current_count),
                "candidate_count": total,
                "completed_count": 0,
                "failed_count": 0,
                "report_path": str(report_path) if report_path is not None else None,
                "source_universe": str(UNIVERSE_PATH.relative_to(self.root)),
                "symbols_filter": list(options.symbols or []),
                "last_message": None,
                "storage": {
                    "type": "sqlite",
                    "db_path": str(self.app_state.db_path),
                },
            },
            "summary": {},
            "rows": [],
        }
        self.app_state.upsert_hydration_job(job_id, "running", job_state)
        emit(
            f"[LedgerSync] Starting {'dry run' if options.dry_run else 'live sync'} for {total} symbol(s) "
            f"(annual={max(0, options.annual_count)}, quarterly={max(0, options.quarterly_count)}, "
            f"current={max(0, options.current_count)}, workers={max(1, int(options.workers or 1))})"
        )

        def enrich_job_progress(last_message: Optional[str] = None) -> None:
            started_at = str(job_state["job"].get("started_at") or "").strip()
            started_ts = 0.0
            if started_at:
                try:
                    started_ts = datetime.fromisoformat(started_at.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    started_ts = 0.0
            now_ts = time.time()
            elapsed_seconds = max(0.0, now_ts - started_ts) if started_ts > 0 else 0.0
            completed_count = len(rows_by_index)
            remaining_count = max(0, total - completed_count)
            progress_pct = round((completed_count / total) * 100.0, 1) if total > 0 else 100.0
            avg_seconds_per_symbol = (elapsed_seconds / completed_count) if completed_count > 0 else None
            symbols_per_hour = (
                round((completed_count / elapsed_seconds) * 3600.0, 1)
                if elapsed_seconds > 0 and completed_count > 0 else None
            )
            eta_seconds = (
                int(round((avg_seconds_per_symbol or 0.0) * remaining_count))
                if avg_seconds_per_symbol is not None and remaining_count > 0 else 0
            )
            eta_display = self._format_duration(eta_seconds) if eta_seconds > 0 else None

            job_state["job"]["completed_count"] = completed_count
            job_state["job"]["remaining_count"] = remaining_count
            job_state["job"]["progress_pct"] = progress_pct
            job_state["job"]["elapsed_seconds"] = int(round(elapsed_seconds))
            job_state["job"]["avg_seconds_per_symbol"] = (
                round(avg_seconds_per_symbol, 2) if avg_seconds_per_symbol is not None else None
            )
            job_state["job"]["symbols_per_hour"] = symbols_per_hour
            job_state["job"]["eta_seconds"] = eta_seconds if eta_seconds > 0 else None
            job_state["job"]["eta_display"] = eta_display
            if last_message:
                job_state["job"]["last_message"] = last_message

        def persist(last_message: Optional[str] = None) -> None:
            ordered_rows = [rows_by_index[idx] for idx in sorted(rows_by_index)]
            payload = self._build_payload(options, candidates, ordered_rows, report_path)
            job_state["summary"] = payload["summary"]
            job_state["rows"] = ordered_rows
            job_state["job"]["failed_count"] = payload["summary"]["failed_count"]
            enrich_job_progress(last_message)
            self.app_state.upsert_hydration_job(
                job_id,
                str(job_state["job"].get("status") or "running"),
                job_state,
            )
            if report_path is not None:
                self._persist_json(report_path, payload)

        try:
            if options.dry_run or max(1, int(options.workers or 1)) == 1:
                for index, row in enumerate(candidates, start=1):
                    symbol = self._normalize_symbol(row.get("ticker"))
                    if not symbol:
                        continue
                    emit(f"[LedgerSync] [{index}/{total}] Hydrating {symbol}...")
                    hydration = None if options.dry_run else self._run_hydration(
                        symbol,
                        max(0, options.annual_count),
                        max(0, options.quarterly_count),
                        max(0, options.current_count),
                    )
                    row_summary = self._build_row_summary(symbol, hydration, options.dry_run, current_filing_before)
                    rows_by_index[index] = row_summary
                    if options.dry_run:
                        message = (
                            f"[LedgerSync] [{index}/{total}] {symbol}: "
                            f"coverage={((row_summary.get('coverage_before') or {}).get('coverage_tier') or 'unknown')} "
                            f"current_8k={row_summary.get('has_current_filing_before')}"
                        )
                    else:
                        coverage_after = (row_summary.get("coverage_after") or {}).get("coverage_tier") or "unknown"
                        message = (
                            f"[LedgerSync] [{index}/{total}] {symbol}: status={row_summary.get('status') or 'unknown'} "
                            f"coverage={coverage_after} current_8k={row_summary.get('has_current_filing_after')}"
                        )
                    persist(message)
                    emit(message)
            else:
                work_items = [
                    (index, self._normalize_symbol(row.get("ticker")))
                    for index, row in enumerate(candidates, start=1)
                    if self._normalize_symbol(row.get("ticker"))
                ]
                completed_count = 0
                with ThreadPoolExecutor(max_workers=max(1, int(options.workers or 1))) as executor:
                    future_map = {
                        executor.submit(
                            self._run_hydration,
                            symbol,
                            max(0, options.annual_count),
                            max(0, options.quarterly_count),
                            max(0, options.current_count),
                        ): (index, symbol)
                        for index, symbol in work_items
                    }
                    for future in as_completed(future_map):
                        index, symbol = future_map[future]
                        completed_count += 1
                        try:
                            hydration = future.result()
                        except Exception as exc:
                            hydration = {"ok": False, "payload": None, "stderr": str(exc), "attempts": 1}
                        row_summary = self._build_row_summary(symbol, hydration, False, current_filing_before)
                        if not hydration.get("ok"):
                            row_summary["status"] = row_summary.get("status") or "failed"
                            row_summary["attempts"] = hydration.get("attempts")
                        rows_by_index[index] = row_summary
                        coverage_after = (row_summary.get("coverage_after") or {}).get("coverage_tier") or "unknown"
                        attempt_suffix = (
                            f" attempts={hydration.get('attempts')}"
                            if hydration.get("attempts", 1) > 1 else ""
                        )
                        message = (
                            f"[LedgerSync] [{completed_count}/{total}] {symbol}: status={row_summary.get('status') or 'unknown'} "
                            f"coverage={coverage_after} current_8k={row_summary.get('has_current_filing_after')}{attempt_suffix}"
                        )
                        persist(message)
                        emit(message)

            rows = [rows_by_index[idx] for idx in sorted(rows_by_index)]
            payload = self._build_payload(options, candidates, rows, report_path)
            job_state["job"]["status"] = "completed"
            job_state["job"]["completed_at"] = self._utc_now_iso()
            job_state["summary"] = payload["summary"]
            job_state["rows"] = rows
            enrich_job_progress(job_state["job"].get("last_message"))
            self.app_state.upsert_hydration_job(job_id, "completed", job_state)
            if report_path is not None:
                self._persist_json(report_path, payload)
                emit(f"[LedgerSync] Report written to {report_path}")
            payload["job"] = job_state["job"]
            payload["job_ref"] = f"{self.app_state.db_path}#{job_id}"
            return payload
        except Exception as exc:
            rows = [rows_by_index[idx] for idx in sorted(rows_by_index)]
            payload = self._build_payload(options, candidates, rows, report_path)
            job_state["job"]["status"] = "failed"
            job_state["job"]["completed_at"] = self._utc_now_iso()
            job_state["job"]["error"] = str(exc)
            job_state["summary"] = payload["summary"]
            job_state["rows"] = rows
            enrich_job_progress(job_state["job"].get("last_message"))
            self.app_state.upsert_hydration_job(job_id, "failed", job_state)
            raise

    def _candidate_rows(self, explicit_symbols: List[str]) -> List[Dict[str, Any]]:
        rows = self._load_universe_rows()
        if explicit_symbols:
            wanted = {self._normalize_symbol(symbol) for symbol in explicit_symbols if self._normalize_symbol(symbol)}
            return [row for row in rows if self._normalize_symbol(row.get("ticker")) in wanted]

        current_filing_coverage = self._load_current_filing_coverage()
        candidates: List[Dict[str, Any]] = []
        for row in rows:
            symbol = self._normalize_symbol(row.get("ticker"))
            if not symbol or row.get("is_ledger_filing_eligible") is not True:
                continue
            coverage = resolve_coverage(symbol)
            if coverage.get("coverage_tier") == "full_filing_supported" and current_filing_coverage.get(symbol, False):
                continue
            item = dict(row)
            item["_coverage_tier"] = coverage.get("coverage_tier")
            item["_has_current_filing"] = current_filing_coverage.get(symbol, False)
            candidates.append(item)

        candidates.sort(key=self._candidate_sort_key)
        return candidates

    @staticmethod
    def _candidate_sort_key(row: Dict[str, Any]) -> tuple[float, str]:
        market_cap = row.get("market_cap")
        try:
            market_cap_num = float(market_cap) if market_cap is not None else -1.0
        except (TypeError, ValueError):
            market_cap_num = -1.0
        return (-market_cap_num, str(row.get("ticker") or "").strip().upper())

    @staticmethod
    def _normalize_symbol(value: Any) -> str:
        return str(value or "").strip().upper()

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _make_job_id() -> str:
        return f"ledger_hydration_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{time.time_ns() % 1000000:06d}"

    def _load_universe_rows(self) -> List[Dict[str, Any]]:
        payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
        rows = payload.get("stocks") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise SystemExit("universe_clean.json is missing a stocks array.")
        return [row for row in rows if isinstance(row, dict)]

    def _load_current_filing_coverage(self) -> Dict[str, bool]:
        coverage: Dict[str, bool] = {}
        if not PIT_DB_PATH.exists():
            return coverage
        conn = sqlite3.connect(PIT_DB_PATH)
        try:
            rows = conn.execute(
                """
                SELECT symbol, COUNT(*) AS n
                FROM pit_documents
                WHERE source_type = 'sec_docling_probe'
                  AND form_type = '8-K'
                GROUP BY symbol
                """
            ).fetchall()
            for symbol, count in rows:
                normalized = self._normalize_symbol(symbol)
                if normalized:
                    coverage[normalized] = bool(count)
        finally:
            conn.close()
        return coverage

    def _run_hydration(self, symbol: str, annual_count: int, quarterly_count: int, current_count: int) -> Dict[str, Any]:
        attempts = 0
        while True:
            attempts += 1
            try:
                payload = self.coordinator.hydrate_symbol(
                    symbol,
                    HydrationOptions(
                        annual_count=annual_count,
                        quarterly_count=quarterly_count,
                        current_count=current_count,
                    ),
                )
                return {"ok": True, "payload": payload, "stderr": str(payload.get("stderr") or "")[-4000:], "attempts": attempts}
            except Exception as exc:
                error_text = str(exc)
                retryable_text = error_text.lower()
                retryable = any(
                    needle in retryable_text
                    for needle in ("database is locked", "database table is locked", "sqlite_busy", "timeout", "timed out")
                )
                if attempts >= 3 or not retryable:
                    return {"ok": False, "payload": None, "stderr": error_text[-4000:], "attempts": attempts}
            time.sleep(5 * attempts)

    def _build_row_summary(
        self,
        symbol: str,
        hydration: Dict[str, Any] | None,
        dry_run: bool,
        current_filing_coverage: Dict[str, bool],
    ) -> Dict[str, Any]:
        coverage_before = resolve_coverage(symbol)
        if dry_run or hydration is None:
            return {
                "symbol": symbol,
                "coverage_before": coverage_before,
                "has_current_filing_before": current_filing_coverage.get(symbol, False),
                "status": "dry_run",
            }

        payload = hydration.get("payload") or {}
        return {
            "symbol": symbol,
            "status": payload.get("status") or ("failed" if not hydration.get("ok") else None),
            "coverage_before": payload.get("coverage_before") or coverage_before,
            "coverage_after": payload.get("coverage_after") or resolve_coverage(symbol),
            "has_current_filing_before": current_filing_coverage.get(symbol, False),
            "has_current_filing_after": self._load_current_filing_coverage().get(symbol, False),
            "canonical_refresh": payload.get("canonical_refresh"),
            "snapshot_hydration_ok": bool((payload.get("snapshot_hydration") or {}).get("ok")),
            "sec_hydration_ok": bool((payload.get("sec_hydration") or {}).get("ok")),
            "pit_import_ok": bool((payload.get("pit_import") or {}).get("ok")),
            "retrieval_refresh_ok": bool((payload.get("retrieval_refresh") or {}).get("ok")),
            "stderr": hydration.get("stderr") or None,
        }

    def _build_payload(
        self,
        options: LedgerSyncJobOptions,
        candidates: List[Dict[str, Any]],
        rows: List[Dict[str, Any]],
        report_path: Optional[Path],
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "summary": {
                "generated_at": self._utc_now_iso(),
                "dry_run": bool(options.dry_run),
                "source_universe": str(UNIVERSE_PATH.relative_to(self.root)),
                "candidate_count": len(candidates),
                "completed_count": len(rows),
                "workers": max(1, int(options.workers or 1)),
                "symbols": [row.get("symbol") for row in rows],
                "full_filing_supported_after": sum(
                    1 for row in rows if ((row.get("coverage_after") or {}).get("coverage_tier") == "full_filing_supported")
                ),
                "current_filing_supported_after": sum(1 for row in rows if row.get("has_current_filing_after") is True),
                "partial_hydration_count": sum(1 for row in rows if row.get("status") == "partial_hydration"),
                "no_change_count": sum(1 for row in rows if row.get("status") == "no_change"),
                "failed_count": sum(1 for row in rows if (row.get("status") or "").lower() in {"failed", "error", "timeout"}),
            },
            "rows": rows,
        }
        if report_path is not None:
            payload["report_path"] = str(report_path)
        return payload

    @staticmethod
    def _persist_json(path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @staticmethod
    def _format_duration(total_seconds: int) -> str:
        seconds = max(0, int(total_seconds or 0))
        hours, remainder = divmod(seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {minutes}m"
        return f"{minutes}m"
