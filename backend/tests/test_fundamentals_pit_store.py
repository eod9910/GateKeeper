import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

import fundamentals_pit_store as pit  # noqa: E402


class FundamentalsPitStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / 'fundamentals-pit.sqlite'
        self.conn = pit.connect(self.db_path)
        pit.ensure_schema(self.conn)

    def tearDown(self):
        try:
            self.conn.close()
        finally:
            self.temp_dir.cleanup()

    def test_schema_tables_exist(self):
        tables = {
            row['name']
            for row in self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        self.assertIn('raw_source_cache', tables)
        self.assertIn('raw_source_cache_history', tables)
        self.assertIn('pit_fundamental_facts', tables)
        self.assertIn('pit_market_facts', tables)
        self.assertIn('pit_event_facts', tables)
        self.assertIn('pit_documents', tables)
        self.assertIn('pit_statement_facts', tables)
        self.assertIn('asof_symbol_snapshots', tables)

    def test_ingest_cached_snapshot_populates_all_layers(self):
        payload = {
            'symbol': 'TEST',
            'fetchedAt': 1774045435484,
            'data': {
                'symbol': 'TEST',
                'currentPrice': 10.5,
                'marketCap': 1000000,
                'revenueYoYGrowthPct': 12.5,
                'operatingMarginPct': 8.2,
                'debtToEquity': 0.45,
                'currentRatio': 1.8,
                'lastEarningsDate': '2026-02-25',
                'earningsDate': '2026-05-27',
                'reportedExecution': {
                    'history': [
                        {
                            'period': '2025Q4',
                            'date': '2026-02-25',
                            'epsActual': 1.2,
                            'epsEstimate': 1.0,
                            'salesActual': 500,
                            'salesEstimate': 480,
                            'epsSurprisePct': 20.0,
                            'salesSurprisePct': 4.2,
                        }
                    ]
                },
                'historicalStatements': {
                    'quarterly': [
                        {
                            'period': '2025Q4',
                            'periodEnd': '2025-12-31',
                            'availableAt': '2026-02-25',
                            'availabilityBasis': 'matched_earnings_history',
                            'metrics': {
                                'revenueYoYGrowthPct': 12.5,
                                'operatingMarginPct': 8.2,
                                'currentRatio': 1.8,
                            },
                        },
                        {
                            'period': '2025Q3',
                            'periodEnd': '2025-09-30',
                            'availableAt': '2025-11-20',
                            'availabilityBasis': 'matched_earnings_history',
                            'metrics': {
                                'revenueYoYGrowthPct': 9.1,
                                'operatingMarginPct': 7.4,
                                'currentRatio': 1.6,
                            },
                        },
                    ]
                },
                'positioning': {
                    'recentTrades': [
                        {
                            'insider': 'Jane Doe',
                            'date': "Dec 01 '25",
                            'transaction': 'Sale',
                            'value': '389,511',
                        }
                    ]
                },
                'ownership': {
                    'topInstitutionalHolders': [
                        {
                            'holder': 'Big Fund',
                            'shares': '1000',
                            'pctOut': '5.00%',
                        }
                    ]
                },
                'marketContext': {
                    'fiftyDayMovingAverage': 11.2,
                    'twoHundredDayMovingAverage': 9.7,
                    'fiftyTwoWeekChangePct': 18.4,
                    'avgVolume3Month': 250000,
                },
                'stockdex': {
                    'earningsHistory': [],
                    'insiderTrades': [],
                    'topInstitutionalHolders': [],
                },
            },
        }

        summary = pit.ingest_cached_snapshot(self.conn, payload)
        self.assertEqual(summary.symbol, 'TEST')
        self.assertEqual(summary.raw_rows, 1)
        self.assertGreaterEqual(summary.fundamental_rows, 4)
        self.assertGreaterEqual(summary.market_rows, 5)
        self.assertGreaterEqual(summary.event_rows, 3)
        self.assertEqual(summary.snapshots_built, 1)

        raw_count = self.conn.execute("SELECT COUNT(*) AS c FROM raw_source_cache").fetchone()['c']
        raw_history_count = self.conn.execute("SELECT COUNT(*) AS c FROM raw_source_cache_history").fetchone()['c']
        fact_count = self.conn.execute("SELECT COUNT(*) AS c FROM pit_fundamental_facts").fetchone()['c']
        market_count = self.conn.execute("SELECT COUNT(*) AS c FROM pit_market_facts").fetchone()['c']
        event_count = self.conn.execute("SELECT COUNT(*) AS c FROM pit_event_facts").fetchone()['c']
        snapshot_row = self.conn.execute(
            "SELECT snapshot_json FROM asof_symbol_snapshots WHERE symbol = ?",
            ('TEST',),
        ).fetchone()

        self.assertEqual(raw_count, 1)
        self.assertEqual(raw_history_count, 1)
        self.assertGreater(fact_count, 0)
        self.assertGreater(market_count, 0)
        self.assertGreater(event_count, 0)
        self.assertIsNotNone(snapshot_row)

        snapshot = json.loads(snapshot_row['snapshot_json'])
        self.assertEqual(snapshot['symbol'], 'TEST')
        self.assertEqual(snapshot['raw']['currentPrice'], 10.5)

        metrics = {
            row['metric']: row['value_numeric']
            for row in self.conn.execute(
                "SELECT metric, value_numeric FROM pit_fundamental_facts WHERE symbol = ?",
                ('TEST',),
            ).fetchall()
        }
        self.assertEqual(metrics['revenueYoYGrowthPct'], 12.5)
        self.assertEqual(metrics['operatingMarginPct'], 8.2)
        self.assertEqual(metrics['debtToEquity'], 0.45)

        historical_rows = self.conn.execute(
            """
            SELECT metric, available_at, value_numeric
            FROM pit_fundamental_facts
            WHERE symbol = ? AND source = 'historical_statements' AND metric = 'revenueYoYGrowthPct'
            ORDER BY available_at
            """,
            ('TEST',),
        ).fetchall()
        self.assertEqual(len(historical_rows), 2)
        self.assertEqual(historical_rows[0]['available_at'], '2025-11-20')
        self.assertEqual(historical_rows[0]['value_numeric'], 9.1)
        self.assertEqual(historical_rows[1]['available_at'], '2026-02-25')
        self.assertEqual(historical_rows[1]['value_numeric'], 12.5)

        event_types = {
            row['event_type']
            for row in self.conn.execute(
                "SELECT event_type FROM pit_event_facts WHERE symbol = ?",
                ('TEST',),
            ).fetchall()
        }
        self.assertIn('earnings_report', event_types)
        self.assertIn('insider_trade', event_types)
        self.assertIn('institutional_holder_snapshot', event_types)

    def test_raw_history_retains_multiple_ingests_per_symbol(self):
        first_payload = {
            'symbol': 'TEST',
            'fetchedAt': 1774045435484,
            'data': {
                'symbol': 'TEST',
                'currentPrice': 10.5,
                'historicalStatements': {'quarterly': []},
            },
        }
        second_payload = {
            'symbol': 'TEST',
            'fetchedAt': 1774131835484,
            'data': {
                'symbol': 'TEST',
                'currentPrice': 11.25,
                'historicalStatements': {'quarterly': []},
            },
        }

        pit.ingest_cached_snapshot(self.conn, first_payload)
        pit.ingest_cached_snapshot(self.conn, second_payload)

        latest_row = self.conn.execute(
            "SELECT fetched_at_ms FROM raw_source_cache WHERE symbol = ?",
            ('TEST',),
        ).fetchone()
        history_rows = self.conn.execute(
            """
            SELECT fetched_at_ms
            FROM raw_source_cache_history
            WHERE symbol = ?
            ORDER BY fetched_at_ms
            """,
            ('TEST',),
        ).fetchall()

        self.assertIsNotNone(latest_row)
        self.assertEqual(latest_row['fetched_at_ms'], 1774131835484)
        self.assertEqual([row['fetched_at_ms'] for row in history_rows], [1774045435484, 1774131835484])

    def test_ingest_canonical_filing_payload_populates_documents_and_statement_facts(self):
        filing_dir = Path(self.temp_dir.name) / 'filing'
        filing_dir.mkdir(parents=True, exist_ok=True)
        markdown_path = filing_dir / 'aapl-20240928.md'
        markdown_path.write_text("Amounts in millions.\n| Example |\n", encoding='utf-8')
        metadata_path = filing_dir / 'fetch_metadata.json'
        metadata_path.write_text(
            json.dumps(
                {
                    'report_date': '2024-09-28',
                    'downloaded_to': str(filing_dir / 'aapl-20240928.htm'),
                }
            ),
            encoding='utf-8',
        )
        canonical_path = filing_dir / 'canonical_facts.json'
        canonical_path.write_text(
            json.dumps(
                {
                    'source_type': 'sec_docling_probe',
                    'markdown_file': str(markdown_path),
                    'fetch_metadata_file': str(metadata_path),
                    'filing': {
                        'company': 'Apple Inc.',
                        'cik': '320193',
                        'form': '10-K',
                        'filing_date': '2024-11-01',
                        'accession_number': '0000320193-24-000123',
                        'filing_url': 'https://www.sec.gov/example',
                    },
                    'facts': {
                        'revenue': {
                            'September 28, 2024': 391035,
                            'September 30, 2023': 383285,
                        },
                        'free_cash_flow': {
                            'September 28, 2024': 101096,
                        },
                    },
                    'evidence': {
                        'revenue': ['| Total net sales | 391,035 |'],
                        'free_cash_flow': ['| Free cash flow | 101,096 |'],
                    },
                }
            ),
            encoding='utf-8',
        )

        summary = pit.ingest_canonical_filing_payload_file(canonical_path, self.conn, symbol='AAPL')

        self.assertEqual(summary.symbol, 'AAPL')
        self.assertEqual(summary.source_document, '0000320193-24-000123')
        self.assertEqual(summary.document_rows, 1)
        self.assertEqual(summary.statement_rows, 3)

        document_row = self.conn.execute(
            """
            SELECT source_document, filing_date, report_date, markdown_file_path
            FROM pit_documents
            WHERE symbol = ? AND source_document = ?
            """,
            ('AAPL', '0000320193-24-000123'),
        ).fetchone()
        self.assertIsNotNone(document_row)
        self.assertEqual(document_row['filing_date'], '2024-11-01')
        self.assertEqual(document_row['report_date'], '2024-09-28')

        fact_rows = self.conn.execute(
            """
            SELECT fact_key, period_end, fact_origin, scale, currency, available_at
            FROM pit_statement_facts
            WHERE symbol = ?
            ORDER BY fact_key, period_end
            """,
            ('AAPL',),
        ).fetchall()
        self.assertEqual(len(fact_rows), 3)
        revenue_rows = [row for row in fact_rows if row['fact_key'] == 'revenue']
        self.assertEqual(len(revenue_rows), 2)
        self.assertTrue(all(row['scale'] == 'millions' for row in revenue_rows))
        self.assertTrue(all(row['currency'] == 'USD' for row in revenue_rows))
        self.assertTrue(all(row['available_at'] == '2024-11-01' for row in revenue_rows))
        fcf_row = next(row for row in fact_rows if row['fact_key'] == 'free_cash_flow')
        self.assertEqual(fcf_row['fact_origin'], 'derived')


if __name__ == '__main__':
    unittest.main()
