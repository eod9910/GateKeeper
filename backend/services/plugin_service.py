#!/usr/bin/env python3
"""
Persistent Python service scaffold (Phase 1B+Scanner).

This keeps a Python interpreter warm and exposes HTTP endpoints the Node
backend can call for validator and scanner execution.
"""

from __future__ import annotations

import argparse
import os
import threading
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import json
import queue

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

from platform_sdk.ohlcv import OHLCV, fetch_data_yfinance, aggregate_bars as _aggregate_bars
from platform_sdk.copilot import generate_copilot_analysis
from strategyRunner import run_strategy
from validatorPipeline import run_pipeline, register_cancel_flag, clear_cancel_flag, _tl


SERVICE_VERSION = "phase1d"
SERVICE_STARTED_AT = time.time()
SERVICE_STARTED_AT_ISO = datetime.now(timezone.utc).isoformat()
DEFAULT_DATA_TTL_SECONDS = max(60, int(os.getenv("PLUGIN_SERVICE_DATA_TTL_SECONDS", "3600")))


class DataCache:
    """In-memory OHLCV cache keyed by symbol+interval+period."""

    def __init__(self, ttl_seconds: int = DEFAULT_DATA_TTL_SECONDS):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._ttl = ttl_seconds

    def _key(self, symbol: str, interval: str, period: str) -> str:
        return f"{symbol.upper()}::{interval}::{period}"

    def get(self, symbol: str, interval: str, period: str) -> Optional[List[OHLCV]]:
        key = self._key(symbol, interval, period)
        entry = self._cache.get(key)
        if not entry:
            return None
        if (time.time() - float(entry.get("timestamp", 0))) > self._ttl:
            self._cache.pop(key, None)
            return None
        return entry.get("data")  # type: ignore[return-value]

    def put(self, symbol: str, interval: str, period: str, data: List[OHLCV]) -> None:
        key = self._key(symbol, interval, period)
        self._cache[key] = {
            "timestamp": time.time(),
            "data": data,
            "bars": len(data),
        }

    def fetch_or_cache(self, symbol: str, interval: str, period: str) -> tuple[List[OHLCV], bool]:
        # For long-history requests, avoid serving stale in-memory slices that
        # may have been cached from an older shorter fetch.
        p = str(period).strip().lower()
        long_history_request = p == "max"
        if not long_history_request and p.endswith("y"):
            try:
                long_history_request = int(p[:-1]) >= 5
            except Exception:
                long_history_request = False
        bypass_memory_cache = long_history_request and interval in ("1d", "1wk", "1mo")

        cached = None if bypass_memory_cache else self.get(symbol, interval, period)
        if cached is not None:
            return cached, True
        fetched = fetch_data_yfinance(symbol, period=period, interval=interval) or []
        self.put(symbol, interval, period, fetched)
        return fetched, False

    def stats(self) -> Dict[str, Any]:
        return {
            "entries": len(self._cache),
            "ttl_seconds": self._ttl,
            "total_bars": int(sum(int(v.get("bars", 0)) for v in self._cache.values())),
        }


DATA_CACHE = DataCache()


def _parse_period_days(period: str) -> Optional[int]:
    raw = str(period or "").strip().lower()
    if not raw or raw == "max":
        return None
    try:
        if raw.endswith("d"):
            return int(raw[:-1])
        if raw.endswith("y"):
            return int(raw[:-1]) * 365
        if raw.endswith("mo"):
            return int(raw[:-2]) * 30
    except Exception:
        return None
    return None


def _safe_bar_datetime(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        pass
    try:
        return datetime.strptime(str(ts)[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
    except Exception:
        pass
    try:
        return datetime.strptime(str(ts)[:10], "%Y-%m-%d")
    except Exception:
        return None


def _clip_bars_to_period(bars: List[OHLCV], period: str) -> List[OHLCV]:
    days = _parse_period_days(period)
    if not bars or days is None:
        return bars
    last_dt = _safe_bar_datetime(bars[-1].timestamp if bars else "")
    if not last_dt:
        return bars
    cutoff = last_dt - timedelta(days=days + 7)
    clipped = [bar for bar in bars if (_safe_bar_datetime(bar.timestamp) or last_dt) >= cutoff]
    return clipped or bars


def _looks_like_forex_daily(symbol: str, interval: str) -> bool:
    return str(interval or "").strip().lower() == "1d" and str(symbol or "").strip().upper().endswith("=X")


def _repair_recent_forex_daily_bars(symbol: str, bars: List[OHLCV]) -> List[OHLCV]:
    if not bars:
        return bars
    try:
        intraday_bars, _ = DATA_CACHE.fetch_or_cache(symbol, "1h", "720d")
    except Exception:
        return bars
    rebuilt_recent = _aggregate_bars(intraday_bars or [], 24)
    if not rebuilt_recent:
        return bars

    rebuilt_by_day = {str(bar.timestamp or "")[:10]: bar for bar in rebuilt_recent if getattr(bar, "timestamp", "")}
    if not rebuilt_by_day:
        return bars

    repaired: List[OHLCV] = []
    seen_days = set()
    for bar in bars:
        day_key = str(getattr(bar, "timestamp", "") or "")[:10]
        repaired.append(rebuilt_by_day.get(day_key, bar))
        if day_key:
            seen_days.add(day_key)

    for bar in rebuilt_recent:
        day_key = str(getattr(bar, "timestamp", "") or "")[:10]
        if day_key and day_key not in seen_days:
            repaired.append(bar)
            seen_days.add(day_key)

    repaired.sort(key=lambda bar: str(getattr(bar, "timestamp", "") or ""))
    return repaired


class ValidatorRunRequest(BaseModel):
    spec: Dict[str, Any] = Field(..., description="StrategySpec payload")
    date_start: str = Field(..., description="YYYY-MM-DD")
    date_end: str = Field(..., description="YYYY-MM-DD")
    universe: Optional[List[str]] = Field(default=None)
    tier: Optional[str] = Field(default="tier3")
    force_refresh: bool = Field(default=False)


class ChartOHLCVRequest(BaseModel):
    symbol: str = Field(..., description="Ticker symbol")
    interval: Optional[str] = Field(default="1d")
    period: Optional[str] = Field(default="2y")


class CopilotAnalyzeRequest(BaseModel):
    symbol: str = Field(..., description="Ticker symbol")
    interval: Optional[str] = Field(default="1wk")
    period: Optional[str] = Field(default="max")
    timeframe: Optional[str] = Field(default="W")
    epsilon_pct: Optional[float] = Field(default=0.05)
    user_direction: Optional[str] = Field(default=None)


class ScannerRunRequest(BaseModel):
    spec: Dict[str, Any] = Field(..., description="StrategySpec payload")
    symbol: str = Field(..., description="Ticker symbol")
    timeframe: Optional[str] = Field(default="W")
    period: Optional[str] = Field(default="max")
    interval: Optional[str] = Field(default="1wk")
    mode: Optional[str] = Field(default="scan")
    start_date: Optional[str] = Field(default=None, description="Clip bars to this start date")
    end_date: Optional[str] = Field(default=None, description="Clip bars to this end date")


class ScannerUniverseRequest(BaseModel):
    spec: Dict[str, Any] = Field(..., description="StrategySpec payload")
    symbols: List[str] = Field(..., description="Symbols to scan")
    timeframe: Optional[str] = Field(default="W")
    period: Optional[str] = Field(default="max")
    interval: Optional[str] = Field(default="1wk")
    mode: Optional[str] = Field(default="scan")


def _numba_warmup_thread() -> None:
    """Run Numba JIT compilation in a background thread so startup is non-blocking."""
    try:
        t0 = time.time()
        from platform_sdk.numba_indicators import warmup_all
        warmup_all()
        elapsed = time.time() - t0
        print(f"[Numba] JIT warmup complete in {elapsed:.1f}s", flush=True)
    except ImportError:
        print("[Numba] numba_indicators not found — skipping warmup", flush=True)
    except Exception as exc:
        print(f"[Numba] Warmup error (non-fatal): {exc}", flush=True)


@asynccontextmanager
async def lifespan(app_: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────
    print(f"[Service] Starting plugin_service {SERVICE_VERSION}", flush=True)
    warmup_thread = threading.Thread(target=_numba_warmup_thread, daemon=True)
    warmup_thread.start()
    yield
    # ── Shutdown ─────────────────────────────────────────────────────
    global _SCAN_POOL
    if _SCAN_POOL is not None:
        _SCAN_POOL.shutdown(wait=False)
        _SCAN_POOL = None
    print("[Service] Shutting down plugin_service", flush=True)


app = FastAPI(
    title="Pattern Detector Python Plugin Service",
    description="Persistent Python execution layer scaffold",
    version=SERVICE_VERSION,
    lifespan=lifespan,
)


@app.get("/health")
def health() -> Dict[str, Any]:
    uptime_seconds = max(0.0, time.time() - SERVICE_STARTED_AT)
    return {
        "ok": True,
        "service": "plugin_service",
        "version": SERVICE_VERSION,
        "started_at": SERVICE_STARTED_AT_ISO,
        "uptime_seconds": round(uptime_seconds, 3),
        "pid": os.getpid(),
        "cache": DATA_CACHE.stats(),
    }


@app.post("/chart/ohlcv")
def chart_ohlcv(req: ChartOHLCVRequest) -> Dict[str, Any]:
    """Return raw OHLCV bars formatted for LightweightCharts — no scanning."""
    try:
        symbol = str(req.symbol or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        interval = str(req.interval or "1d")
        period = str(req.period or "2y")

        # yfinance doesn't support 4h natively — fetch 1h and aggregate
        aggregate_factor = 0
        fetch_interval = interval
        if interval == "4h":
            fetch_interval = "1h"
            aggregate_factor = 4
            if period == "max":
                period = "730d"

        bars, cache_hit = DATA_CACHE.fetch_or_cache(symbol, fetch_interval, period)
        if not bars:
            raise ValueError(f"No data returned for {symbol}")

        if aggregate_factor > 0:
            bars = _aggregate_bars(bars, aggregate_factor)
        elif _looks_like_forex_daily(symbol, interval):
            # Yahoo's direct 1d forex open/close values behave like rollover
            # snapshots and produce near-doji candles. Rebuild the recent daily
            # segment from 1h bars so Training/Chart pages show actual bodies.
            bars = _repair_recent_forex_daily_bars(symbol, bars)

        bars = _clip_bars_to_period(bars, period)

        # Detect intraday
        date_counts: Dict[str, int] = {}
        is_intraday = False
        for bar in bars[:50]:
            ts = bar.timestamp or ""
            if ts and len(ts) >= 10:
                day = ts[:10]
                date_counts[day] = date_counts.get(day, 0) + 1
                if date_counts[day] > 1:
                    is_intraday = True
                    break

        chart_data = []
        for bar in bars:
            ts = bar.timestamp or ""
            if not ts:
                continue
            if is_intraday:
                try:
                    from datetime import datetime as _dt
                    dt = _dt.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
                    time_val: Any = int(dt.timestamp())
                except Exception:
                    time_val = ts[:10] if len(ts) >= 10 else ts
            else:
                time_val = ts[:10] if len(ts) >= 10 else ts
            chart_data.append({
                "time": time_val,
                "open": float(bar.open),
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
                "volume": float(getattr(bar, "volume", 0) or 0),
            })

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "bars": len(chart_data),
            "cache_hit": cache_hit,
            "chart_data": chart_data,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"message": str(exc), "traceback": traceback.format_exc(limit=3)},
        ) from exc


@app.post("/copilot/analyze")
def copilot_analyze(req: CopilotAnalyzeRequest) -> Dict[str, Any]:
    """Run the Trading Co-Pilot analysis using the warm interpreter + data cache.

    This mirrors the legacy ``spawn('py', ['-c', ...])`` path in the Node backend
    but avoids the ~3.4s cold-start cost of importing the scientific stack on
    every request, and reuses the in-memory OHLCV cache so repeated timeframe
    switches don't re-hit Yahoo.
    """
    try:
        symbol = str(req.symbol or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        interval = str(req.interval or "1wk")
        period = str(req.period or "max")
        timeframe = str(req.timeframe or "W")
        epsilon = float(req.epsilon_pct if req.epsilon_pct is not None else 0.05)
        user_direction = req.user_direction or None

        # yfinance doesn't support 4h natively — fetch 1h and aggregate (parity
        # with /chart/ohlcv).
        aggregate_factor = 0
        fetch_interval = interval
        if interval == "4h":
            fetch_interval = "1h"
            aggregate_factor = 4
            if period == "max":
                period = "730d"

        bars, cache_hit = DATA_CACHE.fetch_or_cache(symbol, fetch_interval, period)
        if aggregate_factor > 0 and bars:
            bars = _aggregate_bars(bars, aggregate_factor)

        result = generate_copilot_analysis(
            bars or [],
            symbol=symbol,
            timeframe=timeframe,
            epsilon_pct=epsilon,
            user_direction=user_direction,
        )
        payload = _to_json_safe(result)
        if isinstance(payload, dict):
            payload.setdefault("cache_hit", cache_hit)
        return payload
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"message": str(exc), "traceback": traceback.format_exc(limit=3)},
        ) from exc


def _to_json_safe(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, dict):
        return {str(k): _to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_json_safe(v) for v in value]
    return value


@app.post("/validator/run")
def validator_run(req: ValidatorRunRequest) -> StreamingResponse:
    """Run the validator pipeline and stream progress + final result as NDJSON.

    Each line is a JSON object with a "type" field:
      {"type": "progress", "data": {...}}   — progress update
      {"type": "result",   "data": {...}}   — final payload (last line)
      {"type": "error",    "message": "..."}— on failure
    """
    job_id = req.spec.get("_job_id") or ""
    if job_id:
        clear_cancel_flag(job_id)

    progress_queue: queue.Queue = queue.Queue()
    result_holder: List[Any] = [None]
    error_holder: List[Optional[Exception]] = [None]

    def _run() -> None:
        _tl.progress_queue = progress_queue
        try:
            result = run_pipeline(
                req.spec,
                req.date_start,
                req.date_end,
                req.universe,
                req.tier or "tier3",
                job_id=job_id or None,
                force_refresh=bool(req.force_refresh),
            )
            result_holder[0] = result
        except Exception as exc:
            error_holder[0] = exc
        finally:
            _tl.progress_queue = None
            if job_id:
                clear_cancel_flag(job_id)
            progress_queue.put(None)  # sentinel — signals stream end

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()

    def _stream():
        while True:
            try:
                item = progress_queue.get(timeout=180)
            except queue.Empty:
                # Keep connection alive with a heartbeat
                yield json.dumps({"type": "heartbeat"}) + "\n"
                if not worker.is_alive():
                    break
                continue

            if item is None:  # sentinel
                break
            yield json.dumps({"type": "progress", "data": item}) + "\n"

        if error_holder[0] is not None:
            err = error_holder[0]
            yield json.dumps({
                "type": "error",
                "message": str(err),
                "traceback": traceback.format_exc(limit=5),
            }) + "\n"
        else:
            yield json.dumps({"type": "result", "data": {"success": True, "data": result_holder[0]}}) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


@app.post("/validator/cancel/{job_id}")
def validator_cancel(job_id: str) -> Dict[str, Any]:
    """Signal a running validator job to stop at the next checkpoint."""
    register_cancel_flag(job_id)
    return {"success": True, "data": {"job_id": job_id, "cancelled": True}}


def _slice_bars_to_range(
    bars: List["OHLCV"],
    start_date: Optional[str],
    end_date: Optional[str],
) -> List["OHLCV"]:
    """Slice bars to an optional date window for scoped indicator computation."""
    if not start_date and not end_date:
        return bars
    from datetime import datetime as _dt

    def _ts_to_epoch(val: str) -> Optional[float]:
        try:
            n = float(val)
            return n if n > 1e9 else n * 1000
        except (ValueError, TypeError):
            pass
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
            try:
                return _dt.strptime(val[:19], fmt).timestamp()
            except Exception:
                continue
        return None

    def _bar_epoch(bar: "OHLCV") -> Optional[float]:
        ts = bar.timestamp
        if isinstance(ts, (int, float)):
            return float(ts) if ts > 1e9 else float(ts)
        if isinstance(ts, str) and ts:
            return _ts_to_epoch(ts)
        return None

    start_epoch = _ts_to_epoch(start_date) if start_date else None
    end_epoch = _ts_to_epoch(end_date) if end_date else None

    filtered = []
    for bar in bars:
        epoch = _bar_epoch(bar)
        if epoch is None:
            filtered.append(bar)
            continue
        if start_epoch is not None and epoch < start_epoch:
            continue
        if end_epoch is not None and epoch > end_epoch + 86400:
            continue
        filtered.append(bar)
    return filtered


def _run_scanner_for_symbol(
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    period: str,
    interval: str,
    mode: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        bars, cache_hit = DATA_CACHE.fetch_or_cache(symbol, interval, period)
    except Exception as exc:
        return {
            "symbol": symbol,
            "count": 0,
            "candidates": [],
            "bars": 0,
            "cache_hit": False,
            "error": str(exc) or "No data",
        }
    if not bars:
        return {
            "symbol": symbol,
            "count": 0,
            "candidates": [],
            "bars": 0,
            "cache_hit": cache_hit,
            "error": "No data",
        }
    bars = _slice_bars_to_range(bars, start_date, end_date)
    candidates = run_strategy(spec, bars, symbol, timeframe, mode=mode)
    safe_candidates = _to_json_safe(candidates)
    return {
        "symbol": symbol,
        "count": len(safe_candidates),
        "candidates": safe_candidates,
        "bars": len(bars),
        "cache_hit": cache_hit,
    }


@app.post("/scanner/run-plugin")
def scanner_run_plugin(req: ScannerRunRequest) -> Dict[str, Any]:
    try:
        symbol = str(req.symbol or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        timeframe = str(req.timeframe or "W")
        period = str(req.period or "max")
        interval = str(req.interval or "1wk")
        mode = str(req.mode or "scan")
        result = _run_scanner_for_symbol(
            req.spec, symbol, timeframe, period, interval, mode,
            start_date=req.start_date, end_date=req.end_date,
        )
        return {"success": True, "data": result}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "message": str(exc),
                "traceback": traceback.format_exc(limit=5),
            },
        ) from exc


MAX_SCAN_WORKERS = max(1, min(8, int(os.getenv("PLUGIN_SERVICE_SCAN_WORKERS", "4"))))

# Batch size per worker — each worker processes a chunk of symbols in one call
# to amortize pickle/IPC overhead. Tuned so 5000 symbols ÷ 250 = 20 batches
# spread across MAX_SCAN_WORKERS processes.
_SCAN_BATCH_SIZE = max(50, int(os.getenv("PLUGIN_SERVICE_SCAN_BATCH_SIZE", "250")))

# ----------- Persistent process pool for scan computation -----------------
# Kept warm across requests to avoid process-spawn overhead on every scan.
_SCAN_POOL: Optional[ProcessPoolExecutor] = None
_SCAN_POOL_LOCK = threading.Lock()


def _get_scan_pool() -> ProcessPoolExecutor:
    global _SCAN_POOL
    if _SCAN_POOL is None:
        with _SCAN_POOL_LOCK:
            if _SCAN_POOL is None:
                _SCAN_POOL = ProcessPoolExecutor(
                    max_workers=MAX_SCAN_WORKERS,
                    initializer=_scan_worker_init,
                )
    return _SCAN_POOL


def _scan_worker_init():
    """Pre-import heavy modules once per worker process at startup."""
    import strategyRunner  # noqa: F401 — warm the import cache
    import numpy  # noqa: F401


# ----------- Process-pool worker for CPU-bound scan computation -----------

def _process_worker_run_batch(
    spec: Dict[str, Any],
    batch: List[tuple],
    timeframe: str,
    mode: str,
) -> List[Dict[str, Any]]:
    """Run strategy on a batch of (symbol, bars) pairs in one worker call.

    Processing multiple symbols per call amortizes the IPC/pickle overhead.
    """
    from strategyRunner import run_strategy as _run
    results = []
    for symbol, bars in batch:
        try:
            candidates = _run(spec, bars, symbol, timeframe, mode=mode)
            safe = _to_json_safe_standalone(candidates)
            results.append({
                "symbol": symbol,
                "count": len(safe),
                "candidates": safe,
                "bars": len(bars),
                "error": None,
            })
        except Exception as exc:
            results.append({
                "symbol": symbol,
                "count": 0,
                "candidates": [],
                "bars": len(bars) if bars else 0,
                "error": str(exc),
            })
    return results


def _process_worker_run_strategy(
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str,
    bars: List[Any],
) -> Dict[str, Any]:
    """Run strategy computation for a single symbol (used by run-plugin)."""
    try:
        from strategyRunner import run_strategy as _run
        candidates = _run(spec, bars, symbol, timeframe, mode=mode)
        safe = _to_json_safe_standalone(candidates)
        return {
            "symbol": symbol,
            "count": len(safe),
            "candidates": safe,
            "bars": len(bars),
            "error": None,
        }
    except Exception as exc:
        return {
            "symbol": symbol,
            "count": 0,
            "candidates": [],
            "bars": len(bars) if bars else 0,
            "error": str(exc),
        }


def _to_json_safe_standalone(value):
    """Standalone version of _to_json_safe for use in worker processes."""
    import numpy as _np
    if isinstance(value, _np.ndarray):
        return value.tolist()
    if isinstance(value, (_np.integer,)):
        return int(value)
    if isinstance(value, (_np.floating,)):
        return float(value)
    if isinstance(value, (_np.bool_,)):
        return bool(value)
    if isinstance(value, dict):
        return {str(k): _to_json_safe_standalone(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_json_safe_standalone(v) for v in value]
    return value


@app.post("/scanner/scan-universe")
def scanner_scan_universe(req: ScannerUniverseRequest) -> Dict[str, Any]:
    try:
        symbols = [str(s or "").strip().upper() for s in req.symbols]
        symbols = [s for s in symbols if s]
        if not symbols:
            raise ValueError("symbols array is required")
        timeframe = str(req.timeframe or "W")
        period = str(req.period or "max")
        interval = str(req.interval or "1wk")
        mode = str(req.mode or "scan")

        t0 = time.time()

        # ── Phase 1: Pre-fetch all data in parallel (I/O-bound → threads) ──
        # Use more threads than CPU workers since this is I/O-bound (cache
        # lookups + occasional yfinance HTTP calls).
        fetch_workers = max(MAX_SCAN_WORKERS, min(16, len(symbols)))
        symbol_bars: Dict[str, List[Any]] = {}
        cache_hits: Dict[str, bool] = {}
        with ThreadPoolExecutor(max_workers=fetch_workers) as pool:
            fetch_futures = {
                pool.submit(DATA_CACHE.fetch_or_cache, sym, interval, period): sym
                for sym in symbols
            }
            for fut in as_completed(fetch_futures):
                sym = fetch_futures[fut]
                try:
                    bars, hit = fut.result()
                    symbol_bars[sym] = bars or []
                    cache_hits[sym] = hit
                except Exception:
                    symbol_bars[sym] = []
                    cache_hits[sym] = False

        t_fetch = time.time()

        # ── Phase 2: Run computations in parallel (CPU-bound → processes) ──
        results: List[Dict[str, Any]] = []
        total_candidates = 0

        # Separate symbols with data from those without
        no_data_results: Dict[str, Dict[str, Any]] = {}
        syms_with_bars: List[tuple] = []
        for sym in symbols:
            bars = symbol_bars.get(sym, [])
            if not bars:
                no_data_results[sym] = {
                    "symbol": sym,
                    "count": 0,
                    "candidates": [],
                    "bars": 0,
                    "cache_hit": cache_hits.get(sym, False),
                    "error": "No data",
                }
            else:
                syms_with_bars.append((sym, bars))

        # Build batches to reduce IPC overhead
        batches: List[List[tuple]] = []
        for i in range(0, len(syms_with_bars), _SCAN_BATCH_SIZE):
            batches.append(syms_with_bars[i : i + _SCAN_BATCH_SIZE])

        future_results: Dict[str, Dict[str, Any]] = dict(no_data_results)

        if batches:
            pool = _get_scan_pool()
            batch_futures = {
                pool.submit(_process_worker_run_batch, req.spec, batch, timeframe, mode): batch
                for batch in batches
            }
            for fut in as_completed(batch_futures):
                try:
                    batch_results = fut.result()
                    for row in batch_results:
                        sym = row["symbol"]
                        row["cache_hit"] = cache_hits.get(sym, False)
                        future_results[sym] = row
                except Exception as exc:
                    for sym, _ in batch_futures[fut]:
                        future_results[sym] = {
                            "symbol": sym,
                            "count": 0,
                            "candidates": [],
                            "bars": len(symbol_bars.get(sym, [])),
                            "cache_hit": cache_hits.get(sym, False),
                            "error": str(exc),
                        }

        # Preserve original symbol order
        for sym in symbols:
            row = future_results.get(sym)
            if row:
                results.append(row)
                total_candidates += int(row.get("count", 0))

        t_compute = time.time()
        elapsed_ms = int((t_compute - t0) * 1000)
        fetch_ms = int((t_fetch - t0) * 1000)
        compute_ms = int((t_compute - t_fetch) * 1000)

        return {
            "success": True,
            "data": {
                "total_symbols": len(symbols),
                "total_candidates": total_candidates,
                "results": results,
                "elapsed_ms": elapsed_ms,
                "fetch_ms": fetch_ms,
                "compute_ms": compute_ms,
                "workers": MAX_SCAN_WORKERS,
                "batches": len(batches),
                "batch_size": _SCAN_BATCH_SIZE,
            },
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "message": str(exc),
                "traceback": traceback.format_exc(limit=5),
            },
        ) from exc


# ---------------------------------------------------------------------------
# ML Prediction endpoint — uses trained feedback models
# ---------------------------------------------------------------------------

_ml_classifier = None
_ml_regressor = None
_ml_feature_columns: List[str] = []
_ml_loaded = False

def _load_ml_models():
    global _ml_classifier, _ml_regressor, _ml_feature_columns, _ml_loaded
    if _ml_loaded:
        return
    import joblib
    ml_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'models', 'feedback_v1')
    clf_path = os.path.join(ml_dir, 'feedback_classifier.joblib')
    reg_path = os.path.join(ml_dir, 'feedback_base_regressor.joblib')
    feat_path = os.path.join(ml_dir, 'feedback_classifier_features.json')

    print(f"[ML] Loading models from {ml_dir}")
    if os.path.exists(clf_path):
        _ml_classifier = joblib.load(clf_path)
        print(f"[ML] Classifier loaded: {clf_path}")
    else:
        print(f"[ML] Classifier NOT FOUND: {clf_path}")
    if os.path.exists(reg_path):
        _ml_regressor = joblib.load(reg_path)
        print(f"[ML] Regressor loaded: {reg_path}")
    else:
        print(f"[ML] Regressor NOT FOUND: {reg_path}")
    if os.path.exists(feat_path):
        with open(feat_path, 'r') as f:
            _ml_feature_columns = json.load(f).get('feature_columns', [])
        print(f"[ML] Features loaded: {len(_ml_feature_columns)} columns")
    else:
        print(f"[ML] Features NOT FOUND: {feat_path}")
    _ml_loaded = True


def _extract_ml_features(candidate: dict) -> dict:
    """Extract features from a candidate, mirroring build_feedback_dataset._extract_features."""
    def sf(v):
        try:
            return float(v) if v is not None else None
        except Exception:
            return None

    score = sf(candidate.get("score"))
    entry_ready = 1 if bool(candidate.get("entry_ready")) else 0

    rules = candidate.get("rule_checklist") or []
    if not isinstance(rules, list):
        rules = []
    rule_count = len(rules)
    passed = sum(1 for r in rules if bool((r or {}).get("passed")))
    rule_pass_ratio = (passed / rule_count) if rule_count > 0 else None

    ws = candidate.get("window_start")
    we = candidate.get("window_end")
    window_len = (int(we) - int(ws) + 1) if ws is not None and we is not None else None

    chart_data = candidate.get("chart_data")
    chart_len = len(chart_data) if isinstance(chart_data, list) else 0
    current_close = None
    if chart_len > 0 and isinstance(chart_data[-1], dict):
        current_close = sf(chart_data[-1].get("close"))

    base = candidate.get("base") if isinstance(candidate.get("base"), dict) else {}
    base_high = sf(base.get("high"))
    base_low = sf(base.get("low"))

    ports = candidate.get("output_ports") if isinstance(candidate.get("output_ports"), dict) else {}
    bb = ports.get("base_boxes", {}).get("best", {}) if isinstance(ports.get("base_boxes"), dict) else {}
    if base_high is None:
        base_high = sf(bb.get("ceiling")) or sf(candidate.get("base_high"))
    if base_low is None:
        base_low = sf(bb.get("floor")) or sf(candidate.get("base_low"))
    if base_high is not None and base_low is not None and base_low > base_high:
        base_high, base_low = base_low, base_high

    base_range_pct = None
    current_pos_in_base = None
    if base_high and base_low and base_high > 0:
        rng = base_high - base_low
        base_range_pct = rng / base_high
        if current_close is not None and rng > 1e-12:
            current_pos_in_base = max(-2.0, min(3.0, (current_close - base_low) / rng))

    base_duration = sf(base.get("duration")) or sf(bb.get("base_span_bars"))

    nr = candidate.get("node_result") if isinstance(candidate.get("node_result"), dict) else {}
    rdp = candidate.get("rdp_pivots") if isinstance(candidate.get("rdp_pivots"), dict) else {}

    return {
        "score": score,
        "entry_ready": entry_ready,
        "rule_pass_ratio": rule_pass_ratio,
        "rule_count": rule_count,
        "window_len": window_len,
        "chart_len": chart_len,
        "base_high": base_high,
        "base_low": base_low,
        "base_range_pct": base_range_pct,
        "base_duration": base_duration,
        "current_close": current_close,
        "current_pos_in_base": current_pos_in_base,
        "touches_top": sf(bb.get("touches_top")),
        "touches_bottom": sf(bb.get("touches_bottom")),
        "pivot_switches": sf(bb.get("pivot_switches")),
        "window_pivots": sf(bb.get("window_pivots")),
        "trendiness": sf(bb.get("trendiness")),
        "slope_pct_per_bar": sf(bb.get("slope_pct_per_bar")),
        "rdp_swing_count_total": sf(rdp.get("swing_count_total")),
        "rdp_swing_count_highs": sf(rdp.get("swing_count_highs")),
        "rdp_swing_count_lows": sf(rdp.get("swing_count_lows")),
        "node_score": sf(nr.get("score")),
    }


class MLPredictRequest(BaseModel):
    candidate: dict


@app.post("/ml/predict")
async def ml_predict(req: MLPredictRequest):
    _load_ml_models()
    if _ml_classifier is None:
        raise HTTPException(status_code=503, detail="ML classifier not trained yet")

    features = _extract_ml_features(req.candidate)
    feat_values = [features.get(c, None) for c in _ml_feature_columns]
    X = np.array([v if v is not None else np.nan for v in feat_values], dtype=float).reshape(1, -1)

    label_pred = int(_ml_classifier.predict(X)[0])
    label_conf = 0.5
    if hasattr(_ml_classifier, 'predict_proba'):
        proba = _ml_classifier.predict_proba(X)[0]
        label_conf = float(max(proba))

    detected_top = features.get("base_high")
    detected_bottom = features.get("base_low")

    result = {
        "label": "yes" if label_pred == 1 else "no",
        "labelConfidence": round(label_conf, 4),
        "needsCorrection": False,
        "baseTop": round(detected_top, 4) if detected_top is not None else None,
        "baseBottom": round(detected_bottom, 4) if detected_bottom is not None else None,
        "correctionConfidence": 0.0,
        "reasoning": f"ML classifier ({label_conf*100:.0f}% conf)",
        "modelVersion": "feedback_v1_rf",
        "features": features,
    }

    if _ml_regressor is not None:
        try:
            deltas = _ml_regressor.predict(X)[0]
            delta_top = float(deltas[0])
            delta_bottom = float(deltas[1])
            base_high = features.get("base_high")
            base_low = features.get("base_low")
            if base_high is not None and base_low is not None:
                suggested_top = base_high + delta_top
                suggested_bottom = base_low + delta_bottom
                if suggested_top > suggested_bottom:
                    result["needsCorrection"] = True
                    result["baseTop"] = round(suggested_top, 4)
                    result["baseBottom"] = round(suggested_bottom, 4)
                    result["correctionConfidence"] = round(min(label_conf, 0.85), 4)
                    result["reasoning"] += f" | Regressor suggests top={suggested_top:.2f}, bottom={suggested_bottom:.2f}"
        except Exception:
            pass

    return {"success": True, "data": result}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pattern Detector persistent Python plugin service")
    parser.add_argument("--host", default=os.getenv("PLUGIN_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PLUGIN_SERVICE_PORT", "8100")))
    return parser.parse_args()


def main() -> None:
    import multiprocessing
    multiprocessing.freeze_support()  # Required on Windows
    args = _parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
