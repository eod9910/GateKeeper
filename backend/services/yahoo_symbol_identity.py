from __future__ import annotations

import contextlib
import io
import random
import time
from typing import Any, Dict, Optional

try:
    import yfinance as yf
except ImportError as exc:  # pragma: no cover
    raise RuntimeError("yfinance is required for Yahoo symbol identity enrichment") from exc


@contextlib.contextmanager
def suppress_yfinance_output():
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        yield


def _first_text(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _is_rate_limit_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return any(
        token in text
        for token in (
            "too many requests",
            "rate limited",
            "rate limit",
            "429",
        )
    )


def fetch_yahoo_symbol_identity(
    symbol: str,
    *,
    max_attempts: int = 4,
    base_delay_seconds: float = 2.0,
) -> Dict[str, Optional[str]]:
    sym = str(symbol or "").strip().upper()
    if not sym:
        return {}
    last_error: Optional[BaseException] = None
    attempts = max(1, int(max_attempts))
    for attempt in range(1, attempts + 1):
        try:
            with suppress_yfinance_output():
                info = yf.Ticker(sym).info or {}
            break
        except Exception as exc:
            last_error = exc
            if not _is_rate_limit_error(exc) or attempt >= attempts:
                raise
            sleep_seconds = max(0.5, float(base_delay_seconds)) * (2 ** (attempt - 1))
            sleep_seconds += random.uniform(0.0, 0.75)
            time.sleep(sleep_seconds)
    else:  # pragma: no cover
        if last_error:
            raise last_error
        return {}
    return {
        "symbol": sym,
        "name": _first_text(info.get("longName"), info.get("shortName")),
        "sector": _first_text(info.get("sectorDisp"), info.get("sector")),
        "industry": _first_text(info.get("industryDisp"), info.get("industry")),
        "exchange": _first_text(info.get("exchange"), info.get("fullExchangeName")),
        "country": _first_text(info.get("country")),
    }
