import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import aggregate_family_stats, build_cross_symbol_family_comparison  # noqa: E402
from research_v1.schema import MotifInstanceRecord, OutcomeRecord  # noqa: E402


def _motif(motif_id: str, signature: str) -> MotifInstanceRecord:
    return MotifInstanceRecord(
        motif_instance_id=motif_id,
        symbol="TEST",
        timeframe="1d",
        start_bar_index=0,
        end_bar_index=4,
        pivot_ids=["p1", "p2", "p3", "p4", "p5"],
        leg_ids=["l1", "l2", "l3", "l4"],
        pivot_type_seq=[],
        pivot_label_seq=[],
        leg_direction_seq=[],
        feature_vector={},
        quality_score=0.0,
        regime_tag=None,
        family_signature=signature,
        family_id=None,
    )


def _outcome(motif_id: str, entry_bar_index: int, forward10: float) -> OutcomeRecord:
    return OutcomeRecord(
        motif_instance_id=motif_id,
        entry_bar_index=entry_bar_index,
        entry_timestamp=f"2024-01-{entry_bar_index + 1:02d} 00:00:00",
        entry_close=100.0,
        entry_atr=2.0,
        forward_5_return_atr=forward10 / 2,
        forward_10_return_atr=forward10,
        mfe_10_atr=abs(forward10) + 0.5,
        mae_10_atr=0.5,
        hit_plus_1atr_first=forward10 >= 0,
        hit_minus_1atr_first=forward10 < 0,
        next_break_up=forward10 >= 0,
        next_break_down=forward10 < 0,
    )


class StructureDiscoveryMultiSymbolTests(unittest.TestCase):
    def test_cross_symbol_family_comparison_reports_overlap_and_rankings(self):
        spy_motifs = [
            _motif("s1", "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:SHALLOW|R4:DEEP"),
            _motif("s2", "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP"),
            _motif("s3", "LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM"),
        ]
        qqq_motifs = [
            _motif("q1", "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:MEDIUM|R4:OVERDEEP"),
            _motif("q4", "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:MEDIUM|R4:OVERDEEP"),
            _motif("q2", "LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW"),
            _motif("q3", "LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP"),
        ]

        spy_outcomes = [
            _outcome("s1", 10, 0.8),
            _outcome("s2", 20, 0.6),
            _outcome("s3", 30, -0.3),
        ]
        qqq_outcomes = [
            _outcome("q1", 10, 1.0),
            _outcome("q4", 15, 0.7),
            _outcome("q2", 20, -0.4),
            _outcome("q3", 30, 0.5),
        ]

        spy_stats_v2, spy_summary_v2 = aggregate_family_stats(
            motifs=spy_motifs,
            outcomes=spy_outcomes,
            min_occurrence_count=1,
            min_valid_10bar_count=1,
            grouping_version="v2",
        )
        qqq_stats_v2, qqq_summary_v2 = aggregate_family_stats(
            motifs=qqq_motifs,
            outcomes=qqq_outcomes,
            min_occurrence_count=1,
            min_valid_10bar_count=1,
            grouping_version="v2",
        )

        report = build_cross_symbol_family_comparison(
            [
                {"symbol": "SPY", "family_stats_v2": spy_stats_v2, "family_summary_v2": spy_summary_v2},
                {"symbol": "QQQ", "family_stats_v2": qqq_stats_v2, "family_summary_v2": qqq_summary_v2},
            ],
            min_count_filter=1,
            top_n=5,
        )

        self.assertEqual(report["symbols"], ["SPY", "QQQ"])
        self.assertIn("SPY", report["perSymbol"])
        self.assertIn("QQQ", report["perSymbol"])
        self.assertGreaterEqual(report["familySignatureV2Overlap"]["commonToAllSymbolsCount"], 1)
        self.assertEqual(len(report["familySignatureV2Overlap"]["pairwiseOverlap"]), 1)
        self.assertGreaterEqual(len(report["perSymbol"]["SPY"]["topFamiliesByOccurrence"]), 1)
        self.assertGreaterEqual(len(report["perSymbol"]["QQQ"]["topFamiliesByAvgForward10ReturnAtr"]), 1)
        self.assertGreaterEqual(len(report["perSymbol"]["QQQ"]["topFamiliesByTScoreForward10"]), 1)
        self.assertIn("familyBehaviorStability", report)
        self.assertGreaterEqual(len(report["familyBehaviorStability"]["familyRows"]), 1)

        first_row = report["familyBehaviorStability"]["familyRows"][0]
        self.assertIn("familySignatureV2", first_row)
        self.assertIn("perSymbol", first_row)
        self.assertIn("crossSymbolMeanAvgForward10ReturnAtr", first_row)
        self.assertIn("crossSymbolStddevAvgForward10ReturnAtr", first_row)
        self.assertIn("crossSymbolMeanTScoreForward10", first_row)
        self.assertIn("crossSymbolStddevTScoreForward10", first_row)
        self.assertIn("sameDirectionalSignAcrossAllSymbols", first_row)
        self.assertIn("symbolsPassingMinCountThresholdCount", first_row)
        self.assertIn("SPY", first_row["perSymbol"])
        self.assertIn("QQQ", first_row["perSymbol"])
        self.assertIn("tScoreForward10", first_row["perSymbol"]["SPY"])

    def test_cross_symbol_family_row_tracks_same_sign_and_threshold_coverage(self):
        shared_signature = "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:SHALLOW|R4:DEEP"
        runs = []
        for symbol, values in {
            "SPY": [0.6, 0.8],
            "QQQ": [0.4, 0.7],
            "IWM": [0.2, 0.3],
            "DIA": [0.5, 0.9],
        }.items():
            motifs = [_motif(f"{symbol}_m{idx}", shared_signature) for idx in range(1, 3)]
            outcomes = [_outcome(f"{symbol}_m{idx}", idx * 10, value) for idx, value in enumerate(values, start=1)]
            family_stats_v2, family_summary_v2 = aggregate_family_stats(
                motifs=motifs,
                outcomes=outcomes,
                min_occurrence_count=2,
                min_valid_10bar_count=2,
                grouping_version="v2",
            )
            runs.append({"symbol": symbol, "family_stats_v2": family_stats_v2, "family_summary_v2": family_summary_v2})

        report = build_cross_symbol_family_comparison(runs, min_count_filter=2, top_n=5)
        row = report["familyBehaviorStability"]["familiesPresentInAllFourSymbols"][0]

        self.assertEqual(row["symbolCount"], 4)
        self.assertTrue(row["sameDirectionalSignAcrossAllSymbols"])
        self.assertEqual(row["symbolsPassingMinCountThresholdCount"], 4)
        self.assertTrue(row["passesMinCountThresholdInAtLeastThreeSymbols"])
        self.assertGreater(row["crossSymbolMeanAvgForward10ReturnAtr"], 0)
        self.assertGreater(row["crossSymbolMeanTScoreForward10"], 0)
        self.assertEqual(row["perSymbol"]["SPY"]["occurrenceCount"], 2)
        self.assertEqual(row["perSymbol"]["DIA"]["occurrenceCount"], 2)


if __name__ == "__main__":
    unittest.main()
