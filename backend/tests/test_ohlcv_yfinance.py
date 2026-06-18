import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk import ohlcv  # noqa: E402


class YahooSymbolAliasTests(unittest.TestCase):
    def test_tradingview_continuous_futures_aliases_map_to_yahoo(self):
        self.assertEqual(ohlcv._normalize_yahoo_symbol("ES1"), "ES=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("$ES1"), "ES=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("/ES1!"), "ES=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("NQ1!"), "NQ=F")

    def test_contract_month_futures_aliases_map_to_continuous_yahoo_symbol(self):
        self.assertEqual(ohlcv._normalize_yahoo_symbol("M2KM2026"), "M2K=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("M2KM26"), "M2K=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("/M2KM2026"), "M2K=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("ESZ2026"), "ES=F")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("6EU26"), "6E=F")

    def test_unknown_symbols_pass_through(self):
        self.assertEqual(ohlcv._normalize_yahoo_symbol("AAPL"), "AAPL")
        self.assertEqual(ohlcv._normalize_yahoo_symbol("BRK-B"), "BRK-B")


class YahooIntradayPeriodTests(unittest.TestCase):
    def test_hourly_max_requests_use_yahoo_deep_hourly_window(self):
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("1h", "max"), "730d")
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("60m", "10y"), "730d")
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("4h", "max"), "730d")

    def test_sub_hour_intraday_requests_remain_capped(self):
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("15m", "10y"), "60d")
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("5m", "max"), "60d")
        self.assertEqual(ohlcv._yahoo_safe_intraday_period("1m", "max"), "7d")

    def test_hourly_incremental_refresh_stays_light(self):
        self.assertEqual(ohlcv.INTRADAY_INCREMENTAL_PERIOD["1h"], "60d")
        self.assertEqual(ohlcv.INTRADAY_INCREMENTAL_PERIOD["60m"], "60d")


@unittest.skipUnless(ohlcv.HAS_PANDAS, "pandas is required for OHLCV yfinance tests")
class YahooDownloadTests(unittest.TestCase):
    def test_history_scraper_failure_retries_fallback_period(self):
        frame = ohlcv.pd.DataFrame(
            {
                "Open": [10.0],
                "High": [12.0],
                "Low": [9.5],
                "Close": [11.0],
                "Volume": [12345.0],
            },
            index=ohlcv.pd.to_datetime(["2026-06-01"]),
        )

        class FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol
                self.calls = []

            def history(self, period, interval):
                self.calls.append((period, interval))
                if period == "max":
                    raise TypeError("'NoneType' object is not subscriptable")
                return frame

        fake = FakeTicker("BFRI")

        with mock.patch.object(ohlcv.yf, "Ticker", return_value=fake):
            bars = ohlcv._download_from_yahoo("BFRI", "max", "1d")

        self.assertEqual(fake.calls, [("max", "1d"), ("10y", "1d")])
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].close, 11.0)

    def test_history_scraper_failure_uses_download_fallback(self):
        frame = ohlcv.pd.DataFrame(
            {
                "Open": [20.0],
                "High": [21.0],
                "Low": [19.0],
                "Close": [20.5],
                "Volume": [98765.0],
            },
            index=ohlcv.pd.to_datetime(["2026-06-01"]),
        )

        class FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol
                self.calls = []

            def history(self, period, interval):
                self.calls.append((period, interval))
                raise TypeError("'NoneType' object is not subscriptable")

        fake = FakeTicker("WELL")

        with mock.patch.object(ohlcv.yf, "Ticker", return_value=fake), \
             mock.patch.object(ohlcv.yf, "download", return_value=frame) as download:
            bars = ohlcv._download_from_yahoo("WELL", "max", "1d")

        self.assertEqual(fake.calls, [
            ("max", "1d"),
            ("10y", "1d"),
            ("5y", "1d"),
            ("2y", "1d"),
            ("1y", "1d"),
            ("6mo", "1d"),
            ("60d", "1d"),
        ])
        download.assert_called_once()
        self.assertEqual(download.call_args.kwargs["period"], "60d")
        self.assertEqual(download.call_args.kwargs["interval"], "1d")
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].close, 20.5)


if __name__ == "__main__":
    unittest.main()
