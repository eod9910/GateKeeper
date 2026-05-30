#!/usr/bin/env python
"""Eval set for conviction-layer prompt templates (PRD Phase 5).

Validates:
  1. Schema validation logic catches bad outputs correctly (unit tests)
  2. Prompt template formatting works for each scenario_type
  3. (Optional, --live) Real LLM call on fixture data produces valid output

Usage:
    py backend/tests/test_conviction_eval.py              # offline-only
    py backend/tests/test_conviction_eval.py --live        # includes real LLM call
"""

from __future__ import annotations

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))
sys.path.insert(0, os.path.join(BACKEND_DIR, "scripts"))
TEMPLATE_DIR = os.path.join(BACKEND_DIR, "data", "scenarios", "conviction-templates")

from run_conviction_producer import (
    CONVICTION_PROMPT,
    _validate_conviction,
)


# ============================================================================
# Fixture data
# ============================================================================

VALID_TICKERS = {"AMD", "NVDA", "AVGO", "MRVL", "PWR", "SBUX", "ELF", "ULTA"}

VALID_OUTPUT = {
    "thesis_summary": "AI capex is accelerating as hyperscalers announce record data center spending, directly benefiting GPU and power infrastructure names.",
    "why_now": "Q1 2026 capex guidance from MSFT, GOOGL, and META all beat consensus by 20%+, signaling a structural demand increase that is not yet fully reflected in semi valuations.",
    "what_breaks_it": "If hyperscaler management teams suddenly pivot to cost-cutting or GPU demand normalizes due to inference efficiency gains, the thesis weakens materially.",
    "expression_notes": "AMD offers the cleanest exposure with highest composite rank and direct GPU revenue leverage. NVDA is larger but trades closer to fair value.",
    "confirming_signals": [
        "More hyperscaler capex guidance beats",
        "GPU supply chain lead times extending",
        "Power utility new data center connections rising",
    ],
    "invalidating_signals": [
        "Hyperscaler capex guidance cuts",
        "GPU utilization rates declining",
        "Major inference efficiency breakthrough announced",
    ],
    "key_risks": [
        "Export controls tighten, limiting TAM",
        "Valuation compression in a risk-off environment",
    ],
    "best_expression_assets": ["AMD", "NVDA", "AVGO"],
    "cited_evidence_ids": [101, 102, 103],
}

FIXTURE_SCENARIOS = [
    {
        "name": "ai_capex_geopolitical",
        "scenario_type": "geopolitical",
        "title": "AI capex acceleration scenario",
        "summary": "Major hyperscalers increasing data center spend",
        "primary_theme": "ai_capex_acceleration",
        "status": "DEVELOPING",
        "detection_path": "news_cluster",
        "time_horizon": "months",
        "signal_strength": 78,
        "confidence_score": 65,
    },
    {
        "name": "single_company_catalyst",
        "scenario_type": "single_company_catalyst",
        "title": "Frame Cosmetics viral growth",
        "summary": "Beauty brand seeing explosive social media traction",
        "primary_theme": "consumer_trend",
        "status": "EARLY",
        "detection_path": "topic_anomaly",
        "time_horizon": "weeks",
        "signal_strength": 55,
        "confidence_score": 40,
    },
    {
        "name": "commodity_supply_shock",
        "scenario_type": "commodity",
        "title": "Cocoa supply disruption",
        "summary": "West African harvest failure driving cocoa futures higher",
        "primary_theme": "commodity_supply_shock_softs",
        "status": "CONFIRMED",
        "detection_path": "news_cluster",
        "time_horizon": "months",
        "signal_strength": 85,
        "confidence_score": 72,
    },
]


# ============================================================================
# Test cases
# ============================================================================

def test_valid_output_passes():
    """A well-formed output should pass validation."""
    err = _validate_conviction(VALID_OUTPUT, VALID_TICKERS, {101, 102, 103, 104, 105})
    assert err is None, f"Expected None, got: {err}"
    print("  PASS: valid output accepted")


def test_missing_thesis_rejected():
    """Missing thesis_summary should be caught."""
    bad = dict(VALID_OUTPUT)
    bad["thesis_summary"] = ""
    err = _validate_conviction(bad, VALID_TICKERS, {101, 102, 103})
    assert err is not None, "Expected error for empty thesis_summary"
    assert "thesis_summary" in err
    print("  PASS: missing thesis rejected")


def test_short_field_rejected():
    """Very short string field should be caught."""
    bad = dict(VALID_OUTPUT)
    bad["why_now"] = "Short."
    err = _validate_conviction(bad, VALID_TICKERS, {101, 102, 103})
    assert err is not None, "Expected error for short why_now"
    print("  PASS: short field rejected")


def test_missing_lists_rejected():
    """Missing confirming_signals should be caught."""
    bad = dict(VALID_OUTPUT)
    bad["confirming_signals"] = ["only one"]
    err = _validate_conviction(bad, VALID_TICKERS, {101, 102, 103})
    assert err is not None, "Expected error for single-item confirming_signals"
    print("  PASS: missing list items rejected")


def test_invalid_tickers_rejected():
    """Tickers not in the valid set should be caught."""
    bad = dict(VALID_OUTPUT)
    bad["best_expression_assets"] = ["FAKE", "NOTREAL"]
    err = _validate_conviction(bad, VALID_TICKERS, {101, 102, 103})
    assert err is not None, "Expected error for invalid tickers"
    assert "ticker" in err.lower() or "expression" in err.lower()
    print("  PASS: invalid tickers rejected")


def test_empty_tickers_rejected():
    """Empty best_expression_assets should be caught."""
    bad = dict(VALID_OUTPUT)
    bad["best_expression_assets"] = []
    err = _validate_conviction(bad, VALID_TICKERS, {101, 102, 103})
    assert err is not None, "Expected error for empty best_expression_assets"
    print("  PASS: empty tickers rejected")


def test_prompt_template_formats():
    """CONVICTION_PROMPT should format cleanly for each fixture scenario."""
    for fixture in FIXTURE_SCENARIOS:
        try:
            formatted = CONVICTION_PROMPT.format(
                title=fixture["title"],
                summary=fixture["summary"],
                scenario_type=fixture["scenario_type"],
                primary_theme=fixture["primary_theme"],
                status=fixture["status"],
                detection_path=fixture["detection_path"],
                time_horizon=fixture["time_horizon"],
                signal_strength=fixture["signal_strength"],
                confidence_score=fixture["confidence_score"],
                evidence_count=3,
                evidence_text="[1] Source A: detail\n[2] Source B: detail\n[3] Source C: detail",
                first_order_text="- Increased demand for GPUs",
                second_order_text="- Power infrastructure buildout accelerates",
                candidates_text="AMD (long_beneficiary, rank=73.6)\nNVDA (long_beneficiary, rank=69.5)",
                validity_flags="NONE",
            )
            assert len(formatted) > 200
            assert fixture["title"] in formatted
            print(f"  PASS: prompt formats for {fixture['name']}")
        except Exception as e:
            print(f"  FAIL: prompt format for {fixture['name']}: {e}")
            raise


def test_asymmetric_narrative_template_loads():
    """Asymmetric narrative template should encode the new claim/cluster workflow."""
    path = os.path.join(TEMPLATE_DIR, "asymmetric_narrative.json")
    with open(path, "r", encoding="utf-8") as f:
        template = json.load(f)

    meta = template.get("_meta", {})
    assert meta.get("scenario_type") == "asymmetric_narrative"
    assert "narrative_clusters" in meta.get("source_tables", [])
    assert "emerging_claims" in meta.get("source_tables", [])
    assert "VERIFY_PRIMARY_SOURCES" in template.get("system_prompt", "")
    assert "SINGLE_SOURCE_RISK" in template.get("system_prompt", "")
    assert "{{claims_json}}" in template.get("user_prompt_template", "")

    required = set(template["output_schema_summary"]["success_object_required_fields"])
    for field in {
        "why_edge_exists",
        "verification_plan",
        "source_breadth_gap",
        "conviction_score",
        "best_expression_assets",
    }:
        assert field in required
    print("  PASS: asymmetric narrative template loads")


def test_live_llm(api_key: str):
    """Run a real LLM call against a fixture and validate output."""
    fixture = FIXTURE_SCENARIOS[0]
    prompt = CONVICTION_PROMPT.format(
        title=fixture["title"],
        summary=fixture["summary"],
        scenario_type=fixture["scenario_type"],
        primary_theme=fixture["primary_theme"],
        status=fixture["status"],
        detection_path=fixture["detection_path"],
        time_horizon=fixture["time_horizon"],
        signal_strength=fixture["signal_strength"],
        confidence_score=fixture["confidence_score"],
        evidence_count=2,
        evidence_text="[101] Reuters: Hyperscaler capex guidance beats consensus.\n[102] Bloomberg: AMD revenue forecast raised.",
        first_order_text="- GPU demand increases 40% YoY",
        second_order_text="- Data center power infrastructure strain",
        candidates_text="AMD (long_beneficiary, rank=73.6)\nNVDA (long_beneficiary, rank=69.5)\nAVGO (long_beneficiary, rank=67.2)",
        validity_flags="NONE",
    )

    import openai
    client = openai.OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=1500,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or ""
    result = json.loads(raw)

    err = _validate_conviction(result, {"AMD", "NVDA", "AVGO", "MRVL", "PWR"}, {101, 102})
    if err:
        print(f"  WARN: live LLM output failed validation: {err}")
        print(f"  Output: {json.dumps(result, indent=2)[:500]}")
        return False
    else:
        print("  PASS: live LLM output passes validation")
        print(f"  thesis: {result['thesis_summary'][:80]}...")
        print(f"  tickers: {result['best_expression_assets']}")
        return True


# ============================================================================
# Runner
# ============================================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Conviction-layer eval set")
    parser.add_argument("--live", action="store_true", help="Include real LLM test")
    args = parser.parse_args()

    print("=== Conviction Layer Eval Set ===")
    print()
    print("[1] Schema validation tests:")
    passed = 0
    failed = 0

    tests = [
        test_valid_output_passes,
        test_missing_thesis_rejected,
        test_short_field_rejected,
        test_missing_lists_rejected,
        test_invalid_tickers_rejected,
        test_empty_tickers_rejected,
        test_prompt_template_formats,
        test_asymmetric_narrative_template_loads,
    ]

    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            print(f"  FAIL: {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  FAIL: {t.__name__}: {e}")
            failed += 1

    print(f"\n  Results: {passed} passed, {failed} failed")

    if args.live:
        print("\n[2] Live LLM test:")
        dotenv_path = os.path.join(BACKEND_DIR, ".env")
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key and os.path.isfile(dotenv_path):
            with open(dotenv_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("OPENAI_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break
        if not api_key:
            print("  SKIP: No OPENAI_API_KEY found")
        else:
            ok = test_live_llm(api_key)
            if ok:
                passed += 1
            else:
                failed += 1

    print(f"\n=== Final: {passed} passed, {failed} failed ===")
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
