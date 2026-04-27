#!/usr/bin/env python3
"""Estimate daily and monthly LLM cost for the Social Arbitrage Engine's
concept-extraction pipeline (D21 S2, D14).

Models the four cost-discipline mechanisms from the PRD:
    1. batching   (>=50 comments / call)
    2. pre-filter (drops ~30% of raw comments before any LLM call)
    3. tracked-concept match (skips LLM when comment matches only known concepts)
    4. cheap-tier model only

Reads:
    backend/data/scenarios/concept-extraction-prompt.json

Outputs:
    A markdown-style table of projected daily LLM-call count + USD cost across
    the v1 corpus range (30k - 150k comments/day) for each candidate cheap-tier
    model. Compares against the PRD target ($4 - $12/day, <=15k LLM calls/day).

Usage:
    py backend/scripts/estimate_concept_extraction_cost.py
    py backend/scripts/estimate_concept_extraction_cost.py --comments-per-day 75000
    py backend/scripts/estimate_concept_extraction_cost.py --json
    py backend/scripts/estimate_concept_extraction_cost.py --avg-comment-chars 220

Notes on token accounting:
    - Uses tiktoken if installed (cl100k_base encoding); falls back to a
      4-char-per-token approximation otherwise.
    - Pricing snapshot is documented inline (PRICING_SNAPSHOT_DATE).  Re-run
      after any provider price change.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
PROMPT_FILE = ROOT / "backend" / "data" / "scenarios" / "concept-extraction-prompt.json"

# ----------------------------------------------------------------------------
# Pricing snapshot.  USD per 1,000,000 tokens (input / output).
# Update this block when provider prices change; print prominently at the top
# of every run so a stale number can never silently propagate.
# ----------------------------------------------------------------------------
PRICING_SNAPSHOT_DATE = "2026-04-25"
PRICING_USD_PER_MTOKEN: Dict[str, Dict[str, float]] = {
    # OpenAI cheap tier (matches existing copilot infra in
    # backend/src/services/visionService.ts, strategyGenService.ts).
    "gpt-4o-mini":      {"input": 0.15,  "output": 0.60},
    "gpt-5-mini":       {"input": 0.25,  "output": 1.00},
    "gpt-5.4-mini":     {"input": 0.20,  "output": 0.80},
    # Reference points for sanity checking.
    "gpt-4o":           {"input": 2.50,  "output": 10.00},
    "claude-haiku-4.5": {"input": 1.00,  "output": 5.00},
}

# Default workload assumptions (calibrated to PRD section
# "Concept extraction cost discipline" and the prompt JSON file).
DEFAULTS = {
    "comments_per_day_low":   30_000,
    "comments_per_day_mid":   75_000,
    "comments_per_day_high":  150_000,
    "avg_comment_chars":      180,        # mixed HN/Bluesky/4chan/Discord/forum
    "batch_size":             80,         # prompt JSON target
    "pre_filter_drop_rate":   0.30,       # prompt JSON: PF rules drop ~30%
    "registry_skip_rate":     0.40,       # prompt JSON: registry-match skip
    "avg_extractions_per_comment": 0.6,   # most comments yield 0; ~30% yield 1
    "output_tokens_per_extraction": 55,   # JSON object per few_shot_examples
    "output_overhead_tokens_per_comment": 8,  # input_id echo + array braces
    "registry_skip_phase": "phase5",      # 'now' = apply 40% skip; 'phase5' = apply 0%
}


# ----------------------------------------------------------------------------
# Token counter.  tiktoken if available, simple fallback otherwise.
# ----------------------------------------------------------------------------
def _make_token_counter():
    try:
        import tiktoken  # type: ignore
        enc = tiktoken.get_encoding("cl100k_base")

        def count(text: str) -> int:
            return len(enc.encode(text))
        return count, "tiktoken/cl100k_base"
    except Exception:
        def count(text: str) -> int:
            # Empirically 1 token ~= 4 chars for English UGC.
            return max(1, math.ceil(len(text) / 4))
        return count, "approximate (4 chars / token)"


# ----------------------------------------------------------------------------
# Prompt token measurement.
# ----------------------------------------------------------------------------
@dataclass
class PromptTokenProfile:
    system_tokens: int
    user_template_tokens: int
    few_shot_tokens: int
    few_shot_count: int
    fixed_overhead_per_call: int
    counter_name: str


def measure_prompt_tokens(prompt_doc: dict) -> PromptTokenProfile:
    counter, counter_name = _make_token_counter()

    system_text = prompt_doc["system_prompt"]
    user_template = prompt_doc["user_prompt_template"]
    few_shots = prompt_doc.get("few_shot_examples", [])

    # Few-shot serialization: simulate how the runtime would inline them as
    # priming messages.  Each example contributes input + expected output JSON.
    few_shot_payload = []
    for ex in few_shots:
        few_shot_payload.append({
            "input": ex["input"],
            "expected_output": ex["expected_output"],
        })
    few_shot_str = json.dumps(few_shot_payload, ensure_ascii=False)

    sys_tk = counter(system_text)
    usr_tk = counter(user_template)
    fs_tk = counter(few_shot_str)

    # ChatML-ish overhead: ~4 tokens per message for role/separator markers.
    chatml_overhead = 4 * 3  # system + few-shot block + user

    return PromptTokenProfile(
        system_tokens=sys_tk,
        user_template_tokens=usr_tk,
        few_shot_tokens=fs_tk,
        few_shot_count=len(few_shots),
        fixed_overhead_per_call=sys_tk + usr_tk + fs_tk + chatml_overhead,
        counter_name=counter_name,
    )


# ----------------------------------------------------------------------------
# Workload model.
# ----------------------------------------------------------------------------
@dataclass
class WorkloadProjection:
    label: str
    raw_comments_per_day: int
    surviving_after_filter: int
    surviving_after_registry_skip: int
    llm_calls_per_day: int
    input_tokens_per_day: int
    output_tokens_per_day: int


def project_workload(
    raw_comments_per_day: int,
    avg_comment_chars: int,
    batch_size: int,
    pre_filter_drop_rate: float,
    registry_skip_rate_effective: float,
    avg_extractions_per_comment: float,
    output_tokens_per_extraction: int,
    output_overhead_tokens_per_comment: int,
    fixed_overhead_per_call: int,
    counter,
) -> WorkloadProjection:
    surviving_after_filter = int(round(raw_comments_per_day * (1 - pre_filter_drop_rate)))
    surviving_after_registry_skip = int(round(
        surviving_after_filter * (1 - registry_skip_rate_effective)
    ))

    if surviving_after_registry_skip == 0:
        return WorkloadProjection(
            label=f"{raw_comments_per_day:,} raw / day",
            raw_comments_per_day=raw_comments_per_day,
            surviving_after_filter=surviving_after_filter,
            surviving_after_registry_skip=0,
            llm_calls_per_day=0,
            input_tokens_per_day=0,
            output_tokens_per_day=0,
        )

    llm_calls_per_day = math.ceil(surviving_after_registry_skip / batch_size)

    # Per-call comment payload tokens (the JSON-encoded batch).  Add ~10 chars
    # of envelope per comment for input_id + JSON braces.
    avg_comment_payload_chars = avg_comment_chars + 40
    sample_comment = "x" * avg_comment_payload_chars
    tokens_per_comment_in_batch = counter(sample_comment)

    input_tokens_per_call = (
        fixed_overhead_per_call + (tokens_per_comment_in_batch * batch_size)
    )

    output_tokens_per_call = (
        (output_overhead_tokens_per_comment * batch_size)
        + int(round(avg_extractions_per_comment * output_tokens_per_extraction * batch_size))
    )

    return WorkloadProjection(
        label=f"{raw_comments_per_day:,} raw / day",
        raw_comments_per_day=raw_comments_per_day,
        surviving_after_filter=surviving_after_filter,
        surviving_after_registry_skip=surviving_after_registry_skip,
        llm_calls_per_day=llm_calls_per_day,
        input_tokens_per_day=input_tokens_per_call * llm_calls_per_day,
        output_tokens_per_day=output_tokens_per_call * llm_calls_per_day,
    )


# ----------------------------------------------------------------------------
# Cost computation.
# ----------------------------------------------------------------------------
def cost_for_model(
    model_name: str,
    projection: WorkloadProjection,
) -> Dict[str, float]:
    pricing = PRICING_USD_PER_MTOKEN[model_name]
    in_cost = (projection.input_tokens_per_day / 1_000_000) * pricing["input"]
    out_cost = (projection.output_tokens_per_day / 1_000_000) * pricing["output"]
    daily = in_cost + out_cost
    return {
        "input_usd_per_day":   round(in_cost, 4),
        "output_usd_per_day":  round(out_cost, 4),
        "total_usd_per_day":   round(daily, 4),
        "total_usd_per_month": round(daily * 30, 2),
    }


# ----------------------------------------------------------------------------
# Output rendering.
# ----------------------------------------------------------------------------
def render_text_report(
    profile: PromptTokenProfile,
    projections: List[WorkloadProjection],
    cost_table: Dict[str, Dict[str, Dict[str, float]]],
    args: argparse.Namespace,
) -> str:
    lines: List[str] = []
    lines.append("=" * 78)
    lines.append("CONCEPT-EXTRACTION COST ESTIMATE (Social Arbitrage Engine, D21 S2)")
    lines.append("=" * 78)
    lines.append("")
    lines.append(f"  Prompt file        : {PROMPT_FILE.relative_to(ROOT)}")
    lines.append(f"  Token counter      : {profile.counter_name}")
    lines.append(f"  Pricing snapshot   : {PRICING_SNAPSHOT_DATE}  (UPDATE WHEN PROVIDER PRICES CHANGE)")
    lines.append(f"  Registry skip mode : {args.registry_skip_phase}  "
                 f"(now=apply 40% skip, phase5=0% \u2014 v1 launches at 0%)")
    lines.append("")
    lines.append("Prompt token profile (per LLM call, fixed overhead):")
    lines.append(f"  - system_prompt      : {profile.system_tokens:>6} tok")
    lines.append(f"  - user_prompt_tmpl   : {profile.user_template_tokens:>6} tok")
    lines.append(f"  - {profile.few_shot_count:>2} few-shot examples: {profile.few_shot_tokens:>6} tok")
    lines.append(f"  - chatml overhead    : {12:>6} tok")
    lines.append(f"  - TOTAL per call     : {profile.fixed_overhead_per_call:>6} tok  "
                 "(amortized across batch_size comments)")
    lines.append("")
    lines.append(f"Workload assumptions:")
    lines.append(f"  - avg comment length : {args.avg_comment_chars} chars")
    lines.append(f"  - batch size         : {args.batch_size} comments / LLM call")
    lines.append(f"  - pre-filter drop    : {int(args.pre_filter_drop_rate * 100)}%")
    effective_skip = args.registry_skip_rate if args.registry_skip_phase == "now" else 0.0
    lines.append(f"  - registry skip      : {int(effective_skip * 100)}% of post-filter")
    lines.append(f"  - avg extractions    : {args.avg_extractions_per_comment} per surviving comment")
    lines.append("")
    lines.append("PRD targets (\u00a7Concept extraction cost discipline):")
    lines.append("  - LLM calls / day    : <= 15,000")
    lines.append("  - USD / day          : $4 - $12 at peak corpus")
    lines.append("")

    for proj in projections:
        lines.append("-" * 78)
        lines.append(f"  Scenario: {proj.label}")
        lines.append(f"    raw comments               : {proj.raw_comments_per_day:>10,}")
        lines.append(f"    after pre-filter ({int(args.pre_filter_drop_rate*100)}% drop) : {proj.surviving_after_filter:>10,}")
        lines.append(f"    after registry skip        : {proj.surviving_after_registry_skip:>10,}")
        lines.append(f"    LLM calls / day            : {proj.llm_calls_per_day:>10,}")
        lines.append(f"    input tokens / day         : {proj.input_tokens_per_day:>10,}")
        lines.append(f"    output tokens / day        : {proj.output_tokens_per_day:>10,}")
        lines.append("")
        lines.append(f"    Per-model cost projection:")
        lines.append(f"      {'model':<20} {'in $/day':>10} {'out $/day':>10} "
                     f"{'TOTAL $/day':>13} {'TOTAL $/mo':>13}  {'verdict':<22}")
        for model_name, costs in cost_table[proj.label].items():
            verdict = _verdict(costs["total_usd_per_day"], proj.llm_calls_per_day)
            lines.append(
                f"      {model_name:<20} "
                f"{costs['input_usd_per_day']:>10.4f} "
                f"{costs['output_usd_per_day']:>10.4f} "
                f"{costs['total_usd_per_day']:>13.4f} "
                f"{costs['total_usd_per_month']:>13.2f}  "
                f"{verdict:<22}"
            )
        lines.append("")

    lines.append("=" * 78)
    lines.append("Notes:")
    lines.append("  - 'verdict' compares total daily cost against the PRD's $4-$12 peak target")
    lines.append("    AND LLM-call ceiling of 15,000/day.")
    lines.append("  - The peak (150k comments/day) scenario is the gating budget; the low")
    lines.append("    (30k) and mid (75k) scenarios are reference points for early operation.")
    lines.append("  - At v1 launch, registry skip rate = 0% (the registry is empty). It ramps")
    lines.append("    to ~40% by week 4 once the LLM has populated tracked_concepts. Re-run")
    lines.append("    this script with --registry-skip-phase now to see the steady-state cost.")
    lines.append("  - Update PRICING_USD_PER_MTOKEN whenever the provider changes prices.")
    lines.append("=" * 78)
    return "\n".join(lines)


def _verdict(total_usd_per_day: float, llm_calls_per_day: int) -> str:
    if llm_calls_per_day > 15_000:
        return "OVER call ceiling"
    if total_usd_per_day > 12.0:
        return "OVER $ ceiling"
    if total_usd_per_day < 4.0:
        return "UNDER target (ok)"
    return "WITHIN $4-$12 target"


# ----------------------------------------------------------------------------
# CLI.
# ----------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--comments-per-day", type=int, default=None,
                   help="Override: project a single workload at this volume instead of low/mid/high.")
    p.add_argument("--avg-comment-chars", type=int, default=DEFAULTS["avg_comment_chars"])
    p.add_argument("--batch-size", type=int, default=DEFAULTS["batch_size"])
    p.add_argument("--pre-filter-drop-rate", type=float, default=DEFAULTS["pre_filter_drop_rate"])
    p.add_argument("--registry-skip-rate", type=float, default=DEFAULTS["registry_skip_rate"])
    p.add_argument("--registry-skip-phase", choices=["now", "phase5"],
                   default=DEFAULTS["registry_skip_phase"],
                   help="'now' applies the configured registry skip rate; "
                        "'phase5' (default) shows v1-launch cost with 0% registry skip.")
    p.add_argument("--avg-extractions-per-comment", type=float,
                   default=DEFAULTS["avg_extractions_per_comment"])
    p.add_argument("--output-tokens-per-extraction", type=int,
                   default=DEFAULTS["output_tokens_per_extraction"])
    p.add_argument("--prompt-file", type=Path, default=PROMPT_FILE)
    p.add_argument("--json", action="store_true", help="Emit JSON instead of a human report.")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if not args.prompt_file.exists():
        print(f"ERROR: prompt file not found: {args.prompt_file}", file=sys.stderr)
        return 2

    with open(args.prompt_file, "r", encoding="utf-8") as f:
        prompt_doc = json.load(f)

    profile = measure_prompt_tokens(prompt_doc)
    counter, _ = _make_token_counter()

    if args.comments_per_day:
        scenarios = [("custom", args.comments_per_day)]
    else:
        scenarios = [
            ("low",  DEFAULTS["comments_per_day_low"]),
            ("mid",  DEFAULTS["comments_per_day_mid"]),
            ("high", DEFAULTS["comments_per_day_high"]),
        ]

    effective_registry_skip = (
        args.registry_skip_rate if args.registry_skip_phase == "now" else 0.0
    )

    projections: List[WorkloadProjection] = []
    for _label, n in scenarios:
        proj = project_workload(
            raw_comments_per_day=n,
            avg_comment_chars=args.avg_comment_chars,
            batch_size=args.batch_size,
            pre_filter_drop_rate=args.pre_filter_drop_rate,
            registry_skip_rate_effective=effective_registry_skip,
            avg_extractions_per_comment=args.avg_extractions_per_comment,
            output_tokens_per_extraction=args.output_tokens_per_extraction,
            output_overhead_tokens_per_comment=DEFAULTS["output_overhead_tokens_per_comment"],
            fixed_overhead_per_call=profile.fixed_overhead_per_call,
            counter=counter,
        )
        projections.append(proj)

    cost_table: Dict[str, Dict[str, Dict[str, float]]] = {}
    for proj in projections:
        cost_table[proj.label] = {
            model: cost_for_model(model, proj) for model in PRICING_USD_PER_MTOKEN
        }

    if args.json:
        out = {
            "pricing_snapshot_date": PRICING_SNAPSHOT_DATE,
            "prompt_file": str(args.prompt_file.relative_to(ROOT)),
            "token_counter": profile.counter_name,
            "fixed_overhead_per_call_tokens": profile.fixed_overhead_per_call,
            "system_tokens": profile.system_tokens,
            "few_shot_tokens": profile.few_shot_tokens,
            "user_template_tokens": profile.user_template_tokens,
            "registry_skip_phase": args.registry_skip_phase,
            "registry_skip_rate_effective": effective_registry_skip,
            "scenarios": [
                {
                    "label": p.label,
                    "raw_comments_per_day": p.raw_comments_per_day,
                    "surviving_after_filter": p.surviving_after_filter,
                    "surviving_after_registry_skip": p.surviving_after_registry_skip,
                    "llm_calls_per_day": p.llm_calls_per_day,
                    "input_tokens_per_day": p.input_tokens_per_day,
                    "output_tokens_per_day": p.output_tokens_per_day,
                    "cost_by_model": cost_table[p.label],
                }
                for p in projections
            ],
        }
        print(json.dumps(out, indent=2))
    else:
        print(render_text_report(profile, projections, cost_table, args))

    return 0


if __name__ == "__main__":
    sys.exit(main())
