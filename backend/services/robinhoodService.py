from __future__ import annotations

import contextlib
import io
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)


def _require_robinhood() -> Any:
    try:
        import robin_stocks.robinhood as robinhood
    except ImportError as exc:
        raise RuntimeError(
            "robin_stocks is not installed. Run `python -m pip install robin_stocks` first."
        ) from exc
    return robinhood


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_id(url: Any) -> str | None:
    raw = str(url or "").strip().rstrip("/")
    if not raw:
        return None
    parts = [part for part in raw.split("/") if part]
    return parts[-1] if parts else None


def _safe_call(func: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return func(*args, **kwargs)
    except Exception:
        return {}


def _market_data_to_dict(market_data: Any) -> dict[str, Any]:
    if isinstance(market_data, list):
        if not market_data:
            return {}
        first = market_data[0]
        return first if isinstance(first, dict) else {}
    return market_data if isinstance(market_data, dict) else {}


def login_read_only() -> dict[str, Any]:
    robinhood = _require_robinhood()
    username = _env("ROBINHOOD_USERNAME")
    password = _env("ROBINHOOD_PASSWORD")
    mfa_code = _env("ROBINHOOD_MFA_CODE")
    totp_secret = _env("ROBINHOOD_TOTP_SECRET")
    session_path = Path(
        _env("ROBINHOOD_SESSION_PATH")
        or Path(__file__).resolve().parents[1] / "data" / "robinhood-session.pickle"
    )

    if not username or not password:
        raise RuntimeError(
            "Missing ROBINHOOD_USERNAME or ROBINHOOD_PASSWORD in the environment."
        )

    if not mfa_code and totp_secret:
        try:
            import pyotp

            mfa_code = pyotp.TOTP(totp_secret).now()
        except Exception as exc:
            raise RuntimeError(f"Failed to generate Robinhood TOTP code: {exc}") from exc

    session_path.parent.mkdir(parents=True, exist_ok=True)
    pickle_path = str(session_path.parent)
    pickle_name = session_path.stem
    if pickle_name.startswith("robinhood"):
        pickle_name = pickle_name[len("robinhood"):]

    # robin_stocks writes progress messages to stdout, which breaks our JSON bridge.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        result = robinhood.login(
            username=username,
            password=password,
            store_session=True,
            mfa_code=mfa_code,
            pickle_path=pickle_path,
            pickle_name=pickle_name,
        )

    if isinstance(result, dict) and result.get("access_token"):
        return result

    detail = None
    if isinstance(result, dict):
        detail = (
            result.get("detail")
            or result.get("error")
            or result.get("message")
            or result.get("verification_workflow", "")
        )
    raise RuntimeError(f"Robinhood login failed: {detail or result!r}")


def fetch_account_snapshot(*, already_authenticated: bool = False) -> dict[str, Any]:
    robinhood = _require_robinhood()
    if not already_authenticated:
        login_read_only()

    account_profile = _safe_call(robinhood.load_account_profile) or {}
    portfolio_profile = _safe_call(robinhood.load_portfolio_profile) or {}
    user_profile = _safe_call(robinhood.build_user_profile) or {}

    equity = (
        _to_float(portfolio_profile.get("equity"))
        or _to_float(user_profile.get("equity"))
        or 0.0
    )
    previous_equity = (
        _to_float(portfolio_profile.get("equity_previous_close"))
        or _to_float(portfolio_profile.get("adjusted_equity_previous_close"))
        or equity
    )
    cash = (
        _to_float(account_profile.get("portfolio_cash"))
        or _to_float(account_profile.get("cash"))
        or _to_float(user_profile.get("cash"))
        or 0.0
    )
    buying_power = _to_float(account_profile.get("buying_power")) or cash
    day_pnl = equity - previous_equity
    day_pnl_pct = ((day_pnl / previous_equity) * 100.0) if previous_equity else 0.0

    return {
        "id": str(account_profile.get("account_number") or "").strip() or None,
        "cash": cash,
        "buying_power": buying_power,
        "portfolio_value": equity,
        "equity": equity,
        "last_equity": previous_equity,
        "day_pnl": day_pnl,
        "day_pnl_pct": day_pnl_pct,
        "extended_hours_equity": _to_float(
            portfolio_profile.get("extended_hours_equity")
        ),
        "market_value": _to_float(portfolio_profile.get("market_value")),
        "cash_available_for_withdrawal": _to_float(
            account_profile.get("cash_available_for_withdrawal")
        ),
        "raw": {
            "account_profile": account_profile,
            "portfolio_profile": portfolio_profile,
            "user_profile": user_profile,
        },
    }


def fetch_positions_snapshot() -> dict[str, Any]:
    robinhood = _require_robinhood()
    login_read_only()
    account = fetch_account_snapshot(already_authenticated=True)

    raw_stock_positions = robinhood.get_open_stock_positions() or []
    raw_option_positions = robinhood.get_open_option_positions() or []
    holdings = robinhood.build_holdings() or {}

    stocks: list[dict[str, Any]] = []
    for position in raw_stock_positions:
        if not isinstance(position, dict):
            continue
        symbol = position.get("symbol")
        if not symbol:
            instrument_url = position.get("instrument")
            try:
                symbol = robinhood.get_symbol_by_url(instrument_url) if instrument_url else None
            except Exception:
                symbol = None
        symbol = str(symbol or "").strip().upper() or None
        holding = holdings.get(symbol, {}) if symbol else {}
        stocks.append(
            {
                "symbol": symbol,
                "quantity": _to_float(position.get("quantity")),
                "average_buy_price": _to_float(position.get("average_buy_price")),
                "pending_average_buy_price": _to_float(position.get("pending_average_buy_price")),
                "updated_at": position.get("updated_at"),
                "current_price": _to_float(holding.get("price")),
                "equity": _to_float(holding.get("equity")),
                "percent_change": _to_float(holding.get("percent_change")),
                "type": "stock",
                "raw": position,
            }
        )

    options: list[dict[str, Any]] = []
    for position in raw_option_positions:
        if not isinstance(position, dict):
            continue
        option_id = _extract_id(position.get("option"))
        instrument = {}
        market = {}
        if option_id:
            try:
                instrument = robinhood.get_option_instrument_data_by_id(option_id) or {}
            except Exception:
                instrument = {}
            try:
                market = _market_data_to_dict(
                    robinhood.get_option_market_data_by_id(option_id)
                )
            except Exception:
                market = {}

        options.append(
            {
                "symbol": str(instrument.get("chain_symbol") or "").strip().upper() or None,
                "quantity": _to_float(position.get("quantity")),
                "average_price": _to_float(position.get("average_price")),
                "type": "option",
                "option_type": instrument.get("type"),
                "expiration_date": instrument.get("expiration_date"),
                "strike_price": _to_float(instrument.get("strike_price")),
                "mark_price": _to_float(market.get("adjusted_mark_price") or market.get("mark_price")),
                "bid_price": _to_float(market.get("bid_price")),
                "ask_price": _to_float(market.get("ask_price")),
                "delta": _to_float(market.get("delta")),
                "gamma": _to_float(market.get("gamma")),
                "theta": _to_float(market.get("theta")),
                "vega": _to_float(market.get("vega")),
                "iv": _to_float(market.get("implied_volatility")),
                "open_interest": _to_float(market.get("open_interest")),
                "option_id": option_id,
                "updated_at": position.get("updated_at"),
                "raw": position,
            }
        )

    return {
        "source": "robinhood",
        "account": account,
        "stocks": stocks,
        "options": options,
        "counts": {
            "stocks": len(stocks),
            "options": len(options),
        },
    }
