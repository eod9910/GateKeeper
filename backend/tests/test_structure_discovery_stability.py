import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import aggregate_family_stats, build_family_behavior_stability_report  # noqa: E402
from research_v1.schema import (  # noqa: E402
    BarRecord,
    LegDirection,
    MotifInstanceRecord,
    OutcomeRecord,
    PivotLabel,
    PivotType,
)


def _bar(index: int, close: float) -> BarRecord:
    return BarRecord(
        symbol="TEST",
        timeframe="1d",
        timestamp=f"2024-01-{(index % 28) + 1:02d} 00:00:00",
        bar_index=index,
        open=close - 0.2,
        high=close + 1.2,
        low=close - 1.2,
        close=close,
        volume=1000 + index,
        atr_14=1.0,
        bar_range=2.4,
        body_size=0.2,
        range_atr_norm=2.4,
        body_atr_norm=0.2,
    )


def _motif(symbol: str, motif_id: str, signature: str, end_bar_index: int) -> MotifInstanceRecord:
    return MotifInstanceRecord(
        motif_instance_id=motif_id,
        symbol=symbol,
        timeframe="1d",
        start_bar_index=max(0, end_bar_index - 4),
        end_bar_index=end_bar_index,
        pivot_ids=["p1", "p2", "p3", "p4", "p5"],
        leg_ids=["l1", "l2", "l3", "l4"],
        pivot_type_seq=[PivotType.HIGH, PivotType.LOW, PivotType.HIGH, PivotType.LOW, PivotType.HIGH],
        pivot_label_seq=[PivotLabel.HH, PivotLabel.HL, PivotLabel.HH, PivotLabel.HL, PivotLabel.HH],
        leg_direction_seq=[LegDirection.DOWN, LegDirection.UP, LegDirection.DOWN, LegDirection.UP],
        feature_vector={},
        quality_score=0.0,
        regime_tag=None,
        family_signature=signature,
        family_id=None,
    )


def _outcome(motif_id: str, entry_bar_index: int, entry_close: float, forward10: float) -> OutcomeRecord:
    return OutcomeRecord(
        motif_instance_id=motif_id,
        entry_bar_index=entry_bar_index,
        entry_timestamp=f"2024-02-{(entry_bar_index % 28) + 1:02d} 00:00:00",
        entry_close=entry_close,
        entry_atr=1.0,
        forward_5_return_atr=forward10 / 2.0,
        forward_10_return_atr=forward10,
        mfe_10_atr=max(forward10, 0.0) + 0.5,
        mae_10_atr=max(-forward10, 0.0) + 0.25,
        hit_plus_1atr_first=forward10 >= 0,
        hit_minus_1atr_first=forward10 < 0,
        next_break_up=forward10 >= 0,
        next_break_down=forward10 < 0,
    )


class StructureDiscoveryStabilityTests(unittest.TestCase):
    def test_family_behavior_stability_report_emits_trade_stats(self):
        signature = "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:SHALLOW|R4:DEEP"
        symbol_runs = []
        for symbol, forward_values in {
            "SPY": [0.8, 0.9, 0.7, 0.6, 0.5],
            "QQQ": [0.7, 0.8, 0.9, 0.6, 0.4],
            "IWM": [0.4, 0.5, 0.6, 0.7, 0.8],
            "DIA": [0.3, 0.4, 0.5, 0.6, 0.7],
        }.items():
            bars = [_bar(index, 100.0 + index * 0.5) for index in range(60)]
            motifs = []
            outcomes = []
            for idx, value in enumerate(forward_values, start=1):
                motif_id = f"{symbol}_motif_{idx}"
                end_bar = 10 + idx
                entry_bar = 20 + idx
                motifs.append(_motif(symbol, motif_id, signature, end_bar_index=end_bar))
                outcomes.append(_outcome(motif_id, entry_bar_index=entry_bar, entry_close=bars[entry_bar].close, forward10=value))

            family_stats_v2, family_summary_v2 = aggregate_family_stats(
                motifs=motifs,
                outcomes=outcomes,
                min_occurrence_count=5,
                min_valid_10bar_count=5,
                grouping_version="v2",
            )
            symbol_runs.append({
                "symbol": symbol,
                "family_stats_v2": family_stats_v2,
                "family_summary_v2": family_summary_v2,
                "motifs": motifs,
                "outcomes": outcomes,
                "normalized_bars": bars,
            })

        report = build_family_behavior_stability_report(symbol_runs, min_count_filter=5)

        self.assertEqual(report["candidateDefinition"], "present_in_all_four_symbols_and_passes_min_count_threshold_in_at_least_three_symbols")
        self.assertGreaterEqual(len(report["candidateFamilies"]), 1)

        row = report["candidateFamilies"][0]
        self.assertEqual(row["familySignatureV2"], "HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM")
        self.assertEqual(row["structuralDirection"], "BULLISH")
        self.assertTrue(row["sameDirectionalSignAcrossAllSymbols"])
        self.assertEqual(row["symbolsPassingMinCountThresholdCount"], 4)
        self.assertTrue(row["isCandidateFamily"])
        self.assertIn("SPY", row["perSymbol"])
        self.assertEqual(row["perSymbol"]["SPY"]["directionAgreement"], "AGREE")
        self.assertIn("tradeSimulationInferred", row["perSymbol"]["SPY"])
        self.assertIn("tradeSimulationStructural", row["perSymbol"]["SPY"])
        self.assertIsNotNone(row["perSymbol"]["SPY"]["tradeSimulationStructural"]["winRate"])
        self.assertIn("volatilityQuartiles", row["perSymbol"]["SPY"]["tradeSimulationStructural"]["regimeSensitivity"])
        self.assertIn("directionComparison", report)
        self.assertGreaterEqual(len(report["directionComparison"]["familiesWhereStructuralAndHistoricalDirectionAgree"]), 1)


if __name__ == "__main__":
    unittest.main()
