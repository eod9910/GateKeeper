from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from backend.services.research_v1.explorer import build_family_explorer_html


class StructureDiscoveryExplorerTests(unittest.TestCase):
    def test_build_family_explorer_html_renders_family_rows_and_relative_snippets(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            snippet_dir = base_dir / "v2_family_snippets" / "family_000001"
            snippet_dir.mkdir(parents=True)
            snippet_path = snippet_dir / "sample.svg"
            snippet_path.write_text("<svg></svg>", encoding="utf-8")

            comparison_report = {
                "familyBehaviorStability": {
                    "familyRows": [
                        {
                            "familySignatureV2": "HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM",
                            "symbolCount": 4,
                            "symbolsPresent": ["SPY", "QQQ", "IWM", "DIA"],
                            "crossSymbolMeanAvgForward10ReturnAtr": 0.8,
                            "crossSymbolMedianAvgForward10ReturnAtr": 0.7,
                            "crossSymbolStddevAvgForward10ReturnAtr": 0.1,
                            "crossSymbolRangeAvgForward10ReturnAtr": 0.2,
                            "crossSymbolMeanHitPlus1AtrFirstRate": 0.6,
                            "crossSymbolStddevHitPlus1AtrFirstRate": 0.04,
                            "sameDirectionalSignAcrossAllSymbols": True,
                            "symbolsPassingMinCountThreshold": ["SPY", "QQQ", "IWM"],
                            "symbolsPassingMinCountThresholdCount": 3,
                            "passesMinCountThresholdInAtLeastThreeSymbols": True,
                            "perSymbol": {
                                symbol: {
                                    "present": True,
                                    "occurrenceCount": 10,
                                    "discoveryCount": 4,
                                    "validationCount": 3,
                                    "holdoutCount": 3,
                                    "avgForward10ReturnAtr": 0.5,
                                    "medianForward10ReturnAtr": 0.4,
                                    "hitPlus1AtrFirstRate": 0.6,
                                    "signConsistencyAcrossSplits": True,
                                    "passesMinCountThreshold": True,
                                    "passesValid10Threshold": True,
                                    "isCandidateFamily": True,
                                }
                                for symbol in ("SPY", "QQQ", "IWM", "DIA")
                            },
                        }
                    ]
                }
            }
            behavior_report = {
                "rankings": {
                    "familiesPresentInAllFourSymbols": [
                        {
                            "familySignatureV2": "HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM",
                            "isCandidateFamily": True,
                            "crossSymbolMeanExpectancyRStructural": 0.2,
                            "crossSymbolStddevExpectancyRStructural": 0.05,
                            "crossSymbolMeanExpectancyRInferred": 0.3,
                            "crossSymbolStddevExpectancyRInferred": 0.06,
                            "directionAgreementSummary": {
                                "agreeSymbols": ["SPY", "QQQ", "IWM", "DIA"],
                                "disagreeSymbols": [],
                                "ambiguousSymbols": [],
                            },
                            "perSymbol": {
                                symbol: {
                                    "historicalDirection": "BULLISH",
                                    "structuralDirection": "BULLISH",
                                    "directionAgreement": "AGREE",
                                    "tradeSimulationInferred": {"expectancyR": 0.3},
                                    "tradeSimulationStructural": {"expectancyR": 0.2},
                                }
                                for symbol in ("SPY", "QQQ", "IWM", "DIA")
                            },
                        }
                    ]
                },
                "directionComparison": {
                    "familiesWhereStructuralAndHistoricalDirectionAgree": [
                        {"familySignatureV2": "HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM"}
                    ],
                    "familiesWhereStructuralDirectionIsAmbiguous": [],
                    "familiesWhereStructuralDirectionDisagreesWithHistoricalBias": [],
                },
            }
            inspection_report = {
                "family_details": {
                    "family_000001": {
                        "familySignatureV2": "HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM",
                        "representativeExactSignatures": [
                            {"exact_signature": "exact-a", "count": 3}
                        ],
                        "representativeMotifExamples": [
                            {
                                "motifInstanceId": "motif_1",
                                "entryTimestamp": "2026-01-05T00:00:00",
                                "forward10ReturnAtr": 0.8,
                                "exact_signature": "exact-a",
                                "chartSnippetPath": str(snippet_path),
                            }
                        ],
                    }
                }
            }

            (base_dir / "etf_1d_10y_family_comparison_v2.json").write_text(json.dumps(comparison_report), encoding="utf-8")
            (base_dir / "etf_1d_10y_family_behavior_stability_report.json").write_text(json.dumps(behavior_report), encoding="utf-8")
            for symbol in ("SPY", "QQQ", "IWM", "DIA"):
                (base_dir / f"{symbol.lower()}_1d_10y_top_family_inspection_v2.json").write_text(
                    json.dumps(inspection_report),
                    encoding="utf-8",
                )

            output_path = base_dir / "etf_1d_10y_family_explorer.html"
            result = build_family_explorer_html(
                base_dir=base_dir,
                output_path=output_path,
                symbols=["SPY", "QQQ", "IWM", "DIA"],
            )

            self.assertEqual(result["familyCount"], 1)
            html = output_path.read_text(encoding="utf-8")
            self.assertIn("HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM", html)
            self.assertIn("v2_family_snippets/family_000001/sample.svg", html)
            self.assertIn("Inspect On Chart", html)


if __name__ == "__main__":
    unittest.main()
