#!/usr/bin/env python3
"""Run the research-v1 ATR pivot parser and save inspection artifacts."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk.ohlcv import fetch_data_yfinance  # noqa: E402
from research_v1 import (  # noqa: E402
    aggregate_family_stats,
    build_fragmentation_report,
    build_fragmentation_report_v2,
    build_five_pivot_motifs,
    build_leg_records,
    build_top_family_inspection_report,
    evaluate_motif_outcomes,
    extract_atr_reversal_pivots,
    label_pivots_against_same_side_history,
    normalize_bars,
    record_to_dict,
)
from research_v1.schema import BarRecord, PivotRecord, PivotType  # noqa: E402


OUTPUT_DIR = ROOT / "data" / "research" / "atr_pivot_v1"


def _parse_timestamp(timestamp: str) -> datetime:
    cleaned = str(timestamp).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return datetime.strptime(str(timestamp)[:19], "%Y-%m-%d %H:%M:%S")


def _subtract_years(anchor: datetime, years: int) -> datetime:
    try:
        return anchor.replace(year=anchor.year - years)
    except ValueError:
        # Handle leap-year overflow by falling back to the last valid prior-day boundary.
        return anchor.replace(month=2, day=28, year=anchor.year - years)


def _trim_to_recent_years(bars: List, years: int) -> List:
    if not bars:
        return []
    anchor = _parse_timestamp(bars[-1].timestamp)
    cutoff = _subtract_years(anchor, years)
    trimmed = [bar for bar in bars if _parse_timestamp(bar.timestamp) >= cutoff]
    return trimmed or bars


def _threshold_tag(threshold: float) -> str:
    return f"atr{str(threshold).replace('.', '')}"


def _price_bounds(bars: List[BarRecord]) -> tuple[float, float]:
    low = min(bar.low for bar in bars)
    high = max(bar.high for bar in bars)
    padding = (high - low) * 0.05 if high > low else 1.0
    return low - padding, high + padding


def _price_to_y(price: float, min_price: float, max_price: float, height: int, top_pad: int, bottom_pad: int) -> float:
    usable_height = height - top_pad - bottom_pad
    if usable_height <= 0 or max_price <= min_price:
        return float(height - bottom_pad)
    ratio = (price - min_price) / (max_price - min_price)
    return float(height - bottom_pad - (ratio * usable_height))


def _render_svg(bars: List[BarRecord], pivots: List[PivotRecord], output_path: Path, threshold: float) -> None:
    width = 1800
    height = 900
    left_pad = 70
    right_pad = 30
    top_pad = 40
    bottom_pad = 70
    usable_width = width - left_pad - right_pad
    min_price, max_price = _price_bounds(bars)

    if not bars:
        raise ValueError("No bars available for plotting")

    step = usable_width / max(len(bars) - 1, 1)
    candle_body_width = max(step * 0.55, 1.0)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#0b1220" />',
        '<text x="70" y="24" fill="#e5e7eb" font-size="18" font-family="monospace">ATR Pivot Research v1 - SPY 1d - 5y</text>',
        f'<text x="70" y="46" fill="#93c5fd" font-size="12" font-family="monospace">Candles with confirmed ATR-reversal pivots ({threshold:.1f} ATR, min 3 bars)</text>',
    ]

    for idx, bar in enumerate(bars):
        x = left_pad + (idx * step)
        open_y = _price_to_y(bar.open, min_price, max_price, height, top_pad, bottom_pad)
        close_y = _price_to_y(bar.close, min_price, max_price, height, top_pad, bottom_pad)
        high_y = _price_to_y(bar.high, min_price, max_price, height, top_pad, bottom_pad)
        low_y = _price_to_y(bar.low, min_price, max_price, height, top_pad, bottom_pad)
        color = "#22c55e" if bar.close >= bar.open else "#ef4444"
        body_top = min(open_y, close_y)
        body_height = max(abs(close_y - open_y), 1.0)
        parts.append(f'<line x1="{x:.2f}" y1="{high_y:.2f}" x2="{x:.2f}" y2="{low_y:.2f}" stroke="{color}" stroke-width="1" />')
        parts.append(
            f'<rect x="{x - candle_body_width / 2:.2f}" y="{body_top:.2f}" '
            f'width="{candle_body_width:.2f}" height="{body_height:.2f}" fill="{color}" opacity="0.9" />'
        )

    if pivots:
        polyline_points = []
        for pivot in pivots:
            x = left_pad + (pivot.bar_index * step)
            y = _price_to_y(pivot.price, min_price, max_price, height, top_pad, bottom_pad)
            polyline_points.append(f"{x:.2f},{y:.2f}")
        parts.append(f'<polyline points="{" ".join(polyline_points)}" fill="none" stroke="#f59e0b" stroke-width="2.2" />')

        for pivot in pivots:
            x = left_pad + (pivot.bar_index * step)
            y = _price_to_y(pivot.price, min_price, max_price, height, top_pad, bottom_pad)
            fill = "#38bdf8" if pivot.pivot_type == PivotType.LOW else "#f97316"
            parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4.5" fill="{fill}" stroke="#0f172a" stroke-width="1.5" />')

    first_ts = bars[0].timestamp[:10]
    last_ts = bars[-1].timestamp[:10]
    parts.extend([
        f'<text x="{left_pad}" y="{height - 24}" fill="#cbd5e1" font-size="12" font-family="monospace">{first_ts}</text>',
        f'<text x="{width - 140}" y="{height - 24}" fill="#cbd5e1" font-size="12" font-family="monospace">{last_ts}</text>',
        f'<text x="{left_pad}" y="{height - 8}" fill="#94a3b8" font-size="12" font-family="monospace">Pivots: {len(pivots)}</text>',
        "</svg>",
    ])

    output_path.write_text("\n".join(parts), encoding="utf-8")


def _build_inspection_markdown(report: dict) -> str:
    lines = [
        "# Top Family Inspection Report",
        "",
        f"Grouping version: `{report['grouping_version']}`",
        f"Total unique families: `{report['total_unique_families']}`",
        f"Inspected families: `{report['inspected_family_count']}`",
        "",
        "## Top 10 By Occurrence",
        "",
    ]
    for row in report["top_10_by_occurrence_count"]:
        lines.append(f"- `{row['family_id']}` `{row['family_signature_v2']}` count={row['occurrence_count']}")

    lines.extend([
        "",
        "## Top 10 By Avg Forward 10-Bar Return",
        "",
    ])
    for row in report["top_10_by_avg_forward_10_return_atr"]:
        lines.append(
            f"- `{row['family_id']}` `{row['family_signature_v2']}` avg10={row['avg_forward_10_return_atr']} count={row['occurrence_count']}"
        )

    lines.extend([
        "",
        "## Top 10 By Split Consistency",
        "",
    ])
    for row in report["top_10_by_split_consistency"]:
        lines.append(
            f"- `{row['family_id']}` `{row['family_signature_v2']}` score={row['split_consistency_score']} count={row['occurrence_count']}"
        )

    lines.extend([
        "",
        "## Family Details",
        "",
    ])
    for family_id, details in report["family_details"].items():
        lines.extend([
            f"### {family_id}",
            "",
            f"- Signature: `{details['family_signature_v2']}`",
            f"- Counts: total={details['occurrence_count']} discovery={details['discovery_count']} validation={details['validation_count']} holdout={details['holdout_count']}",
            f"- Forward10: avg={details['avg_forward_10_return_atr']} median={details['median_forward_10_return_atr']} std={details['forward_10_stddev_atr']}",
            f"- Hit+1ATR: {details['hit_plus_1atr_first_rate']}",
            f"- Sign consistent across splits: {details['sign_consistent_across_splits']}",
            f"- Exact signatures contained: {details['exact_signature_count']}",
            "",
            "Representative exact signatures:",
        ])
        for exact in details["representative_exact_signatures"]:
            lines.append(f"- `{exact['exact_signature']}` count={exact['count']}")
        lines.extend([
            "",
            "Representative motifs:",
        ])
        for example in details["representative_motif_examples"]:
            lines.append(
                f"- `{example['motif_instance_id']}` entry={example['entry_timestamp']} fwd10={example['forward_10_return_atr']} snippet={example['chart_snippet_path']}"
            )
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    symbol = "SPY"
    timeframe = "1d"
    period = "5y"
    threshold = 2.0

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    raw_bars = fetch_data_yfinance(symbol=symbol, period=period, interval=timeframe)
    raw_bars = _trim_to_recent_years(raw_bars, years=5)
    normalized_bars = normalize_bars(raw_bars, symbol=symbol, timeframe=timeframe)
    pivots = extract_atr_reversal_pivots(
        normalized_bars,
        symbol=symbol,
        timeframe=timeframe,
        reversal_multiple=threshold,
        min_bars_between_pivots=3,
    )
    legs = build_leg_records(normalized_bars, pivots, symbol=symbol, timeframe=timeframe)
    pivot_labels = label_pivots_against_same_side_history(pivots, normalized_bars, equal_band_atr=0.25)
    motifs = build_five_pivot_motifs(
        pivots=pivots,
        legs=legs,
        labels=pivot_labels,
        symbol=symbol,
        timeframe=timeframe,
    )
    outcomes = evaluate_motif_outcomes(
        motifs=motifs,
        pivots=pivots,
        bars=normalized_bars,
        forward_5=5,
        forward_10=10,
    )
    family_stats, family_summary = aggregate_family_stats(
        motifs=motifs,
        outcomes=outcomes,
        min_occurrence_count=5,
        min_valid_10bar_count=5,
        grouping_version="v1",
    )
    family_stats_v2, family_summary_v2 = aggregate_family_stats(
        motifs=motifs,
        outcomes=outcomes,
        min_occurrence_count=5,
        min_valid_10bar_count=5,
        grouping_version="v2",
    )
    fragmentation_report = build_fragmentation_report(
        motifs=motifs,
        family_stats=family_stats,
    )
    fragmentation_report_v2 = build_fragmentation_report_v2(
        motifs=motifs,
        family_stats_v2=family_stats_v2,
    )
    inspection_report_v2 = build_top_family_inspection_report(
        bars=normalized_bars,
        pivots=pivots,
        motifs=motifs,
        outcomes=outcomes,
        family_stats_v2=family_stats_v2,
        output_dir=OUTPUT_DIR,
        top_n=10,
        min_count_filter=5,
    )
    inspection_markdown_v2 = _build_inspection_markdown(inspection_report_v2)

    threshold_tag = _threshold_tag(threshold)

    normalized_path = OUTPUT_DIR / f"spy_1d_5y_normalized_bars_{threshold_tag}.json"
    pivots_path = OUTPUT_DIR / f"spy_1d_5y_pivots_{threshold_tag}.json"
    legs_path = OUTPUT_DIR / f"spy_1d_5y_legs_{threshold_tag}.json"
    labels_path = OUTPUT_DIR / f"spy_1d_5y_pivot_labels_{threshold_tag}.json"
    motifs_path = OUTPUT_DIR / f"spy_1d_5y_motifs_{threshold_tag}.json"
    outcomes_path = OUTPUT_DIR / f"spy_1d_5y_motif_outcomes_{threshold_tag}.json"
    family_stats_path = OUTPUT_DIR / f"spy_1d_5y_family_stats_{threshold_tag}.json"
    family_summary_path = OUTPUT_DIR / f"spy_1d_5y_family_summary_{threshold_tag}.json"
    fragmentation_report_path = OUTPUT_DIR / f"spy_1d_5y_fragmentation_report_{threshold_tag}.json"
    family_stats_v2_path = OUTPUT_DIR / f"spy_1d_5y_family_stats_v2_{threshold_tag}.json"
    family_summary_v2_path = OUTPUT_DIR / f"spy_1d_5y_family_summary_v2_{threshold_tag}.json"
    fragmentation_report_v2_path = OUTPUT_DIR / f"spy_1d_5y_fragmentation_report_v2_{threshold_tag}.json"
    family_comparison_path = OUTPUT_DIR / f"spy_1d_5y_family_comparison_{threshold_tag}.json"
    inspection_report_v2_path = OUTPUT_DIR / f"spy_1d_5y_top_family_inspection_v2_{threshold_tag}.json"
    inspection_markdown_v2_path = OUTPUT_DIR / f"spy_1d_5y_top_family_inspection_v2_{threshold_tag}.md"
    svg_path = OUTPUT_DIR / f"spy_1d_5y_pivots_{threshold_tag}.svg"

    canonical_normalized_path = OUTPUT_DIR / "spy_1d_5y_normalized_bars.json"
    canonical_pivots_path = OUTPUT_DIR / "spy_1d_5y_atr_pivots.json"
    canonical_legs_path = OUTPUT_DIR / "spy_1d_5y_leg_records.json"
    canonical_labels_path = OUTPUT_DIR / "spy_1d_5y_pivot_labels.json"
    canonical_motifs_path = OUTPUT_DIR / "spy_1d_5y_motif_instances.json"
    canonical_outcomes_path = OUTPUT_DIR / "spy_1d_5y_motif_outcomes.json"
    canonical_family_stats_path = OUTPUT_DIR / "spy_1d_5y_family_stats.json"
    canonical_family_summary_path = OUTPUT_DIR / "spy_1d_5y_family_summary.json"
    canonical_fragmentation_report_path = OUTPUT_DIR / "spy_1d_5y_fragmentation_report.json"
    canonical_family_stats_v2_path = OUTPUT_DIR / "spy_1d_5y_family_stats_v2.json"
    canonical_family_summary_v2_path = OUTPUT_DIR / "spy_1d_5y_family_summary_v2.json"
    canonical_fragmentation_report_v2_path = OUTPUT_DIR / "spy_1d_5y_fragmentation_report_v2.json"
    canonical_family_comparison_path = OUTPUT_DIR / "spy_1d_5y_family_comparison.json"
    canonical_inspection_report_v2_path = OUTPUT_DIR / "spy_1d_5y_top_family_inspection_v2.json"
    canonical_inspection_markdown_v2_path = OUTPUT_DIR / "spy_1d_5y_top_family_inspection_v2.md"
    canonical_svg_path = OUTPUT_DIR / "spy_1d_5y_atr_pivots.svg"

    normalized_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(normalized_bars),
        "records": [record_to_dict(record) for record in normalized_bars],
    }
    pivots_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(pivots),
        "records": [record_to_dict(record) for record in pivots],
    }
    legs_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(legs),
        "records": [record_to_dict(record) for record in legs],
    }
    labels_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(pivot_labels),
        "records": [record_to_dict(record) for record in pivot_labels],
    }
    motifs_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(motifs),
        "records": [record_to_dict(record) for record in motifs],
    }
    outcomes_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(outcomes),
        "records": [record_to_dict(record) for record in outcomes],
    }
    family_stats_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(family_stats),
        "records": [record_to_dict(record) for record in family_stats],
    }
    family_summary_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        **family_summary,
    }
    family_stats_v2_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "count": len(family_stats_v2),
        "records": [record_to_dict(record) for record in family_stats_v2],
    }
    family_summary_v2_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        **family_summary_v2,
    }
    fragmentation_report_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        **fragmentation_report,
    }
    fragmentation_report_v2_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        **fragmentation_report_v2,
    }
    comparison_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "v1": {
            "total_unique_families": family_summary["total_unique_families"],
            "families_with_split_coverage_all_three": family_summary["families_with_split_coverage_all_three"],
            "families_passing_discovery_and_validation_counts": family_summary["families_passing_discovery_and_validation_counts"],
            "families_sign_consistent_across_splits": family_summary["families_sign_consistent_across_splits"],
            "candidate_family_count": family_summary["candidate_family_count"],
        },
        "v2": {
            "total_unique_families": family_summary_v2["total_unique_families"],
            "families_with_split_coverage_all_three": family_summary_v2["families_with_split_coverage_all_three"],
            "families_passing_discovery_and_validation_counts": family_summary_v2["families_passing_discovery_and_validation_counts"],
            "families_sign_consistent_across_splits": family_summary_v2["families_sign_consistent_across_splits"],
            "candidate_family_count": family_summary_v2["candidate_family_count"],
        },
    }
    inspection_report_v2_payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        **inspection_report_v2,
    }

    valid_forward_5 = sum(1 for outcome in outcomes if outcome.forward_5_return_atr is not None)
    valid_forward_10 = sum(1 for outcome in outcomes if outcome.forward_10_return_atr is not None)
    inspection_summary = {
        "valid_forward_5_count": valid_forward_5,
        "valid_forward_10_count": valid_forward_10,
        "sample_rows": [record_to_dict(outcome) for outcome in outcomes[:3]],
    }

    normalized_path.write_text(json.dumps(normalized_payload, indent=2), encoding="utf-8")
    pivots_path.write_text(json.dumps(pivots_payload, indent=2), encoding="utf-8")
    legs_path.write_text(json.dumps(legs_payload, indent=2), encoding="utf-8")
    labels_path.write_text(json.dumps(labels_payload, indent=2), encoding="utf-8")
    motifs_path.write_text(json.dumps(motifs_payload, indent=2), encoding="utf-8")
    outcomes_path.write_text(json.dumps(outcomes_payload, indent=2), encoding="utf-8")
    family_stats_path.write_text(json.dumps(family_stats_payload, indent=2), encoding="utf-8")
    family_summary_path.write_text(json.dumps(family_summary_payload, indent=2), encoding="utf-8")
    fragmentation_report_path.write_text(json.dumps(fragmentation_report_payload, indent=2), encoding="utf-8")
    family_stats_v2_path.write_text(json.dumps(family_stats_v2_payload, indent=2), encoding="utf-8")
    family_summary_v2_path.write_text(json.dumps(family_summary_v2_payload, indent=2), encoding="utf-8")
    fragmentation_report_v2_path.write_text(json.dumps(fragmentation_report_v2_payload, indent=2), encoding="utf-8")
    family_comparison_path.write_text(json.dumps(comparison_payload, indent=2), encoding="utf-8")
    inspection_report_v2_path.write_text(json.dumps(inspection_report_v2_payload, indent=2), encoding="utf-8")
    inspection_markdown_v2_path.write_text(inspection_markdown_v2, encoding="utf-8")
    _render_svg(normalized_bars, pivots, svg_path, threshold=threshold)

    canonical_normalized_path.write_text(json.dumps(normalized_payload, indent=2), encoding="utf-8")
    canonical_pivots_path.write_text(json.dumps(pivots_payload, indent=2), encoding="utf-8")
    canonical_legs_path.write_text(json.dumps(legs_payload, indent=2), encoding="utf-8")
    canonical_labels_path.write_text(json.dumps(labels_payload, indent=2), encoding="utf-8")
    canonical_motifs_path.write_text(json.dumps(motifs_payload, indent=2), encoding="utf-8")
    canonical_outcomes_path.write_text(json.dumps(outcomes_payload, indent=2), encoding="utf-8")
    canonical_family_stats_path.write_text(json.dumps(family_stats_payload, indent=2), encoding="utf-8")
    canonical_family_summary_path.write_text(json.dumps(family_summary_payload, indent=2), encoding="utf-8")
    canonical_fragmentation_report_path.write_text(json.dumps(fragmentation_report_payload, indent=2), encoding="utf-8")
    canonical_family_stats_v2_path.write_text(json.dumps(family_stats_v2_payload, indent=2), encoding="utf-8")
    canonical_family_summary_v2_path.write_text(json.dumps(family_summary_v2_payload, indent=2), encoding="utf-8")
    canonical_fragmentation_report_v2_path.write_text(json.dumps(fragmentation_report_v2_payload, indent=2), encoding="utf-8")
    canonical_family_comparison_path.write_text(json.dumps(comparison_payload, indent=2), encoding="utf-8")
    canonical_inspection_report_v2_path.write_text(json.dumps(inspection_report_v2_payload, indent=2), encoding="utf-8")
    canonical_inspection_markdown_v2_path.write_text(inspection_markdown_v2, encoding="utf-8")
    _render_svg(normalized_bars, pivots, canonical_svg_path, threshold=threshold)

    print(json.dumps({
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "reversal_multiple_atr": threshold,
        "bar_count": len(normalized_bars),
        "pivot_count": len(pivots),
        "leg_count": len(legs),
        "label_count": len(pivot_labels),
        "motif_count": len(motifs),
        "motif_outcome_count": len(outcomes),
        "family_count": len(family_stats),
        "family_count_v2": len(family_stats_v2),
        "valid_forward_5_count": valid_forward_5,
        "valid_forward_10_count": valid_forward_10,
        "normalized_path": str(canonical_normalized_path),
        "pivots_path": str(canonical_pivots_path),
        "legs_path": str(canonical_legs_path),
        "labels_path": str(canonical_labels_path),
        "motifs_path": str(canonical_motifs_path),
        "outcomes_path": str(canonical_outcomes_path),
        "family_stats_path": str(canonical_family_stats_path),
        "family_stats_v2_path": str(canonical_family_stats_v2_path),
        "fragmentation_report_path": str(canonical_fragmentation_report_path),
        "fragmentation_report_v2_path": str(canonical_fragmentation_report_v2_path),
        "inspection_report_v2_path": str(canonical_inspection_report_v2_path),
        "plot_path": str(canonical_svg_path),
        "inspection_summary": inspection_summary,
        "family_summary": family_summary_payload,
        "family_summary_v2": family_summary_v2_payload,
        "fragmentation_report": fragmentation_report_payload,
        "fragmentation_report_v2": fragmentation_report_v2_payload,
        "family_comparison": comparison_payload,
        "top_family_inspection_v2": inspection_report_v2_payload,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
