import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

import fundamentals_pit_query as pit_query  # noqa: E402
import fundamentals_pit_store as pit_store  # noqa: E402


def _bar(date_str: str, close: float) -> dict:
    return {
        'timestamp': f'{date_str}T00:00:00Z',
        'open': close,
        'high': close,
        'low': close,
        'close': close,
        'volume': 1000,
    }


class FundamentalsPitQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / 'fundamentals-pit.sqlite'
        self.conn = pit_store.connect(self.db_path)
        pit_store.ensure_schema(self.conn)

    def tearDown(self):
        try:
            self.conn.close()
        finally:
            self.temp_dir.cleanup()

    def test_run_fundamental_validation_builds_selected_vs_excluded_spread(self):
        updated_at = '2026-03-19T00:00:00Z'
        fact_rows = [
            ('AAA', 'revenueYoYGrowthPct', 30.0, '2026-01-30'),
            ('AAA', 'revenueYoYGrowthPct', 28.0, '2026-02-27'),
            ('BBB', 'revenueYoYGrowthPct', 5.0, '2026-01-30'),
            ('BBB', 'revenueYoYGrowthPct', 4.0, '2026-02-27'),
        ]
        for symbol, metric, value_numeric, available_at in fact_rows:
            self.conn.execute(
                """
                INSERT INTO pit_fundamental_facts (
                    symbol, metric, value_numeric, value_text, value_type, classification,
                    period_type, period_end, published_at, available_at, availability_basis,
                    source, source_path, source_record_hash, fetched_at_ms, updated_at
                ) VALUES (?, ?, ?, NULL, 'number', 'derived_feature', 'quarterly', ?, ?, ?, 'reported',
                          'unit_test', NULL, ?, NULL, ?)
                """,
                (
                    symbol,
                    metric,
                    value_numeric,
                    available_at,
                    available_at,
                    available_at,
                    f'{symbol}-{metric}-{available_at}',
                    updated_at,
                ),
            )
        self.conn.commit()

        bars_by_symbol = {
            'AAA': [
                _bar('2026-01-05', 100.0),
                _bar('2026-01-30', 100.0),
                _bar('2026-02-20', 110.0),
                _bar('2026-02-27', 110.0),
                _bar('2026-03-20', 121.0),
                _bar('2026-04-17', 133.1),
            ],
            'BBB': [
                _bar('2026-01-05', 100.0),
                _bar('2026-01-30', 100.0),
                _bar('2026-02-20', 95.0),
                _bar('2026-02-27', 95.0),
                _bar('2026-03-20', 90.0),
                _bar('2026-04-17', 85.5),
            ],
        }
        spec = {
            'fundamental_config': {
                'enabled': True,
                'rebalance_frequency': 'monthly',
                'forward_bars': 2,
                'min_selected_count': 1,
                'min_excluded_count': 1,
                'variables': [
                    {
                        'metric': 'revenueYoYGrowthPct',
                        'label': 'Revenue Growth',
                        'operator': '>=',
                        'threshold': 20.0,
                    }
                ],
            }
        }

        result = pit_query.run_fundamental_validation(spec, bars_by_symbol, db_path=str(self.db_path))

        self.assertTrue(result['enabled'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['selected']['periods'], 2)
        self.assertEqual(result['excluded']['periods'], 2)
        self.assertAlmostEqual(result['selected']['avg_forward_return_pct'], 15.5, places=2)
        self.assertAlmostEqual(result['excluded']['avg_forward_return_pct'], -7.5, places=2)
        self.assertAlmostEqual(result['spread']['avg_return_spread_pct'], 23.0, places=2)
        self.assertEqual(result['rebalance_dates'], ['2026-01-30', '2026-02-27'])
        self.assertIn('revenueYoYGrowthPct', result['sensitivity']['params_tested'])

    def test_statement_query_helpers_return_latest_rows_and_document_evidence(self):
        self.conn.execute(
            """
            INSERT INTO pit_documents (
                symbol, source_type, source_document, company, cik, form_type,
                filing_date, report_date, filing_url, raw_file_path,
                markdown_file_path, json_file_path, metadata_file_path,
                payload_hash, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                'AAPL',
                'sec_docling_probe',
                '0000320193-24-000123',
                'Apple Inc.',
                '320193',
                '10-K',
                '2024-11-01',
                '2024-09-28',
                'https://www.sec.gov/example',
                'raw.htm',
                'doc.md',
                'doc.json',
                'fetch.json',
                'doc-hash',
                '2026-03-30T00:00:00Z',
            ),
        )
        statement_rows = [
            (
                'AAPL', 'revenue', 391035.0, 'number', 'reported', 'currency', 'millions', 'USD',
                'annual', '2024-09-28', 2024, None, '2024-11-01', '2024-11-01', 'sec_docling_probe',
                '0000320193-24-000123', '{"kind":"docling_markdown_lines"}', 1.0, 'canonical_2024.json',
                'hash-r-2024', '2026-03-30T00:00:00Z',
            ),
            (
                'AAPL', 'revenue', 383285.0, 'number', 'reported', 'currency', 'millions', 'USD',
                'annual', '2023-09-30', 2023, None, '2024-11-01', '2024-11-01', 'sec_docling_probe',
                '0000320193-24-000123', '{"kind":"docling_markdown_lines"}', 1.0, 'canonical_2024.json',
                'hash-r-2023-new', '2026-03-30T00:00:00Z',
            ),
            (
                'AAPL', 'revenue', 383200.0, 'number', 'reported', 'currency', 'millions', 'USD',
                'annual', '2023-09-30', 2023, None, '2023-11-03', '2023-11-03', 'sec_docling_probe',
                '0000320193-23-000106', '{"kind":"docling_markdown_lines"}', 1.0, 'canonical_2023.json',
                'hash-r-2023-old', '2026-03-30T00:00:00Z',
            ),
            (
                'AAPL', 'net_income', 93736.0, 'number', 'reported', 'currency', 'millions', 'USD',
                'annual', '2024-09-28', 2024, None, '2024-11-01', '2024-11-01', 'sec_docling_probe',
                '0000320193-24-000123', '{"kind":"docling_markdown_lines"}', 1.0, 'canonical_2024.json',
                'hash-ni-2024', '2026-03-30T00:00:00Z',
            ),
        ]
        for row in statement_rows:
            self.conn.execute(
                """
                INSERT INTO pit_statement_facts (
                    symbol, fact_key, value_numeric, value_text, value_type, fact_origin,
                    unit, scale, currency, period_type, period_end, fiscal_year, fiscal_quarter,
                    filing_date, available_at, source_type, source_document, evidence_ref,
                    confidence, source_path, source_record_hash, updated_at
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )
        self.conn.commit()

        facts = pit_query.get_facts(self.conn, 'AAPL', ['revenue', 'net_income'], '2024-12-31')
        self.assertEqual(facts['revenue']['period_end'], '2024-09-28')
        self.assertEqual(facts['net_income']['value_numeric'], 93736.0)

        history = pit_query.get_statement_history(self.conn, 'AAPL', 'annual', '2024-12-31', fact_keys=['revenue'])
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['period_end'], '2024-09-28')
        self.assertEqual(history[1]['value_numeric'], 383285.0)

        latest = pit_query.get_latest_available_facts(self.conn, 'AAPL', period_type='annual')
        self.assertEqual(latest['revenue']['available_at'], '2024-11-01')

        evidence = pit_query.get_document_evidence(self.conn, 'AAPL', '0000320193-24-000123')
        self.assertIsNotNone(evidence['document'])
        self.assertEqual(evidence['document']['form_type'], '10-K')
        self.assertGreaterEqual(len(evidence['facts']), 3)
        self.assertIsInstance(evidence['facts'][0]['evidence_ref'], dict)


if __name__ == '__main__':
    unittest.main()

