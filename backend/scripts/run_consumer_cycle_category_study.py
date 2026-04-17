from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"


@dataclass(frozen=True)
class SeriesDefinition:
    key: str
    label: str
    quantity_index_series_id: str
    level_series_id: str | None
    spend_class: str
    domain: str
    notes: str = ""


CONSUMER_SERIES: list[SeriesDefinition] = [
    SeriesDefinition(
        key="motor_vehicles_parts",
        label="Motor Vehicles & Parts",
        quantity_index_series_id="DMOTRA3Q086SBEA",
        level_series_id="DMOTRX1Q020SBEA",
        spend_class="durable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="furnishings_household_equipment",
        label="Furnishings & Household Equipment",
        quantity_index_series_id="DFDHRA3Q086SBEA",
        level_series_id="DFDHRX1Q020SBEA",
        spend_class="durable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="recreational_goods_vehicles",
        label="Recreational Goods & Vehicles",
        quantity_index_series_id="DREQRA3Q086SBEA",
        level_series_id="DREQRX1Q020SBEA",
        spend_class="durable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="transportation_services",
        label="Transportation Services",
        quantity_index_series_id="DTRSRA3Q086SBEA",
        level_series_id="DTRSRX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="other_durable_goods",
        label="Other Durable Goods",
        quantity_index_series_id="DODGRA3Q086SBEA",
        level_series_id="DODGRX1Q020SBEA",
        spend_class="durable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="clothing_footwear",
        label="Clothing & Footwear",
        quantity_index_series_id="DCLORA3Q086SBEA",
        level_series_id="DCLORX1Q020SBEA",
        spend_class="nondurable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="other_nondurable_goods",
        label="Other Nondurable Goods",
        quantity_index_series_id="DONGRA3Q086SBEA",
        level_series_id="DONGRX1Q020SBEA",
        spend_class="nondurable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="food_service_accommodations",
        label="Food Services & Accommodations",
        quantity_index_series_id="DFSARA3Q086SBEA",
        level_series_id="DFSARX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="other_services",
        label="Other Services",
        quantity_index_series_id="DOTSRA3Q086SBEA",
        level_series_id="DOTSRX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="gas_energy_goods",
        label="Gasoline & Other Energy Goods",
        quantity_index_series_id="DGOERA3Q086SBEA",
        level_series_id="DGOERX1Q020SBEA",
        spend_class="nondurable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="recreation_services",
        label="Recreation Services",
        quantity_index_series_id="DRCARA3Q086SBEA",
        level_series_id="DRCARX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="food_beverages_home",
        label="Food & Beverages (Home)",
        quantity_index_series_id="DFXARA3Q086SBEA",
        level_series_id="DFXARX1Q020SBEA",
        spend_class="nondurable_goods",
        domain="consumer",
    ),
    SeriesDefinition(
        key="housing_utilities",
        label="Housing & Utilities",
        quantity_index_series_id="DHUTRA3Q086SBEA",
        level_series_id="DHUTRX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="healthcare",
        label="Health Care",
        quantity_index_series_id="DHLCRA3Q086SBEA",
        level_series_id="DHLCRX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
    SeriesDefinition(
        key="financial_services_insurance",
        label="Financial Services & Insurance",
        quantity_index_series_id="DIFSRA3Q086SBEA",
        level_series_id="DIFSRX1Q020SBEA",
        spend_class="services",
        domain="consumer",
    ),
]

COMPANION_SERIES: list[SeriesDefinition] = [
    SeriesDefinition(
        key="residential_investment",
        label="Residential Investment",
        quantity_index_series_id="PRFIC1",
        level_series_id=None,
        spend_class="durable_goods",
        domain="companion",
        notes="Not part of consumer spending; included as a companion cycle driver.",
    ),
    SeriesDefinition(
        key="business_equipment_investment",
        label="Business Equipment Investment",
        quantity_index_series_id="ND000340Q",
        level_series_id=None,
        spend_class="durable_goods",
        domain="companion",
        notes="Not part of consumer spending; included as a companion cycle driver.",
    ),
]

ALL_SERIES = CONSUMER_SERIES + COMPANION_SERIES


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_series(series_id: str) -> list[tuple[str, float]]:
    url = FRED_CSV_URL.format(series_id=series_id)
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = response.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(payload))
    rows: list[tuple[str, float]] = []
    for row in reader:
        value = row.get(series_id)
        if not value or value == ".":
            continue
        rows.append((row["observation_date"], float(value)))
    if not rows:
        raise ValueError(f"No rows returned for {series_id}")
    return rows


def yoy_growth(points: list[tuple[str, float]]) -> list[tuple[str, float]]:
    out: list[tuple[str, float]] = []
    for idx in range(4, len(points)):
        date, value = points[idx]
        prev = points[idx - 4][1]
        if prev == 0:
            continue
        out.append((date, (value / prev - 1.0) * 100.0))
    return out


def mean(values: Iterable[float]) -> float | None:
    seq = list(values)
    if not seq:
        return None
    return sum(seq) / len(seq)


def classify_cycle_bucket(spread: float | None, recession_avg: float | None) -> str:
    if spread is None or recession_avg is None:
        return "unclassified"
    if spread >= 6.0:
        return "highly_cyclical"
    if recession_avg >= 0.0 and spread < 3.0:
        return "stable"
    if spread >= 3.0:
        return "mildly_cyclical"
    return "stable"


def format_pct(value: float | None) -> str:
    if value is None or math.isnan(value):
        return "n/a"
    return f"{value:.2f}%"


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    recession_lookup = {date: int(value) for date, value in fetch_series("USRECQ")}
    total_real_pce_lookup = {date: value for date, value in fetch_series("PCECC96")}
    latest_total_real_pce_date = max(total_real_pce_lookup)
    latest_total_real_pce = total_real_pce_lookup[latest_total_real_pce_date]

    categories: list[dict[str, Any]] = []
    for definition in ALL_SERIES:
        quantity_points = fetch_series(definition.quantity_index_series_id)
        yoy_points = yoy_growth(quantity_points)
        expansion_values = [value for date, value in yoy_points if recession_lookup.get(date, 0) == 0]
        recession_values = [value for date, value in yoy_points if recession_lookup.get(date, 0) == 1]
        expansion_avg = mean(expansion_values)
        recession_avg = mean(recession_values)
        spread = None if expansion_avg is None or recession_avg is None else expansion_avg - recession_avg
        classification = classify_cycle_bucket(spread, recession_avg)

        level_share_of_real_pce = None
        level_latest_date = None
        if definition.level_series_id:
            level_points = {date: value for date, value in fetch_series(definition.level_series_id)}
            if latest_total_real_pce_date in level_points:
                level_latest_date = latest_total_real_pce_date
                level_share_of_real_pce = (level_points[latest_total_real_pce_date] / latest_total_real_pce) * 100.0

        categories.append(
            {
                **asdict(definition),
                "source_urls": {
                    "quantity_index": FRED_CSV_URL.format(series_id=definition.quantity_index_series_id),
                    "level": FRED_CSV_URL.format(series_id=definition.level_series_id) if definition.level_series_id else None,
                },
                "sample_window": {
                    "quantity_index_start": quantity_points[0][0],
                    "quantity_index_end": quantity_points[-1][0],
                    "yoy_start": yoy_points[0][0] if yoy_points else None,
                    "yoy_end": yoy_points[-1][0] if yoy_points else None,
                },
                "statistics": {
                    "expansion_avg_yoy_pct": expansion_avg,
                    "recession_avg_yoy_pct": recession_avg,
                    "expansion_recession_spread_pct": spread,
                    "share_of_latest_real_pce_pct": level_share_of_real_pce,
                    "share_of_latest_real_pce_date": level_latest_date,
                },
                "classification": {
                    "cycle_bucket": classification,
                },
            }
        )

    consumer_rows = [row for row in categories if row["domain"] == "consumer"]
    by_bucket: dict[str, dict[str, Any]] = {}
    for bucket in ("highly_cyclical", "mildly_cyclical", "stable"):
        members = [row for row in consumer_rows if row["classification"]["cycle_bucket"] == bucket]
        by_bucket[bucket] = {
            "count": len(members),
            "share_of_latest_real_pce_pct": sum((row["statistics"]["share_of_latest_real_pce_pct"] or 0.0) for row in members),
            "keys": [row["key"] for row in members],
        }

    categories.sort(
        key=lambda row: (row["statistics"]["expansion_recession_spread_pct"] or -999.0),
        reverse=True,
    )

    return {
        "generated_at": utc_now_iso(),
        "methodology": {
            "summary": (
                "Official FRED/BEA quarterly chain-type quantity index series were used to measure the growth behavior "
                "of consumer spending categories across expansion and recession quarters. YoY growth was computed for "
                "each quarter, recession quarters were identified with USRECQ, and cycle buckets were assigned from the "
                "observed spread plus whether the category still grew during recessions."
            ),
            "recession_indicator_series_id": "USRECQ",
            "total_real_pce_series_id": "PCECC96",
            "growth_measure": "quarterly YoY percent change",
            "classification_rules": {
                "highly_cyclical": "spread >= 6.0 percentage points",
                "mildly_cyclical": "spread >= 3.0 percentage points and not already highly cyclical",
                "stable": "spread < 3.0 percentage points or still grows through recessions with limited spread",
                "stable_guardrail": "if recession average growth >= 0 and spread < 3.0, classify as stable",
            },
        },
        "bucket_summary": by_bucket,
        "categories": categories,
    }


def write_json_report(report: dict[str, Any], out_path: Path) -> None:
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def bucket_title(bucket: str) -> str:
    return bucket.replace("_", " ").title()


def write_markdown_report(report: dict[str, Any], out_path: Path) -> None:
    lines: list[str] = []
    lines.append("# Consumer Cycle Category Study")
    lines.append("")
    lines.append(f"Generated: `{report['generated_at']}`")
    lines.append("")
    lines.append("## Methodology")
    lines.append("")
    lines.append(report["methodology"]["summary"])
    lines.append("")
    lines.append("- Growth measure: quarterly YoY percent change")
    lines.append(f"- Recession flag: `{report['methodology']['recession_indicator_series_id']}`")
    lines.append(f"- Total real PCE share reference: `{report['methodology']['total_real_pce_series_id']}`")
    lines.append("- Cycle-bucket rules:")
    for key, value in report["methodology"]["classification_rules"].items():
        lines.append(f"  - `{key}`: {value}")
    lines.append("")
    lines.append("## Consumer Bucket Summary")
    lines.append("")
    lines.append("| Cycle Bucket | Category Count | Approx. Share of Latest Real PCE |")
    lines.append("|---|---:|---:|")
    for bucket in ("highly_cyclical", "mildly_cyclical", "stable"):
        summary = report["bucket_summary"][bucket]
        lines.append(
            f"| {bucket_title(bucket)} | {summary['count']} | {summary['share_of_latest_real_pce_pct']:.2f}% |"
        )
    lines.append("")
    lines.append("## Category Results")
    lines.append("")
    lines.append(
        "| Category | Domain | Spend Class | Expansion Avg YoY | Recession Avg YoY | Spread | Share of Latest Real PCE | Cycle Bucket |"
    )
    lines.append("|---|---|---|---:|---:|---:|---:|---|")
    for row in report["categories"]:
        stats = row["statistics"]
        lines.append(
            f"| {row['label']} | {row['domain']} | {row['spend_class'].replace('_', ' ')} | "
            f"{format_pct(stats['expansion_avg_yoy_pct'])} | {format_pct(stats['recession_avg_yoy_pct'])} | "
            f"{format_pct(stats['expansion_recession_spread_pct'])} | {format_pct(stats['share_of_latest_real_pce_pct'])} | "
            f"{bucket_title(row['classification']['cycle_bucket'])} |"
        )
    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append("- Consumer categories use FRED/BEA quantity-index series for the long history needed to span multiple recessions.")
    lines.append("- Approximate shares of real PCE use the latest quarterly chained-dollar level series where available.")
    lines.append("- `Residential Investment` and `Business Equipment Investment` are companion cycle drivers, not literal consumer-spending categories, but they are included because they matter for cycle confirmation.")
    lines.append("- This study is repo-native and reproducible: rerun `py backend/scripts/run_consumer_cycle_category_study.py` whenever you want to refresh it.")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a repo-native consumer cycle category study from official FRED/BEA data.")
    parser.add_argument("--prefix", default="consumer_cycle_category_study", help="Output filename prefix.")
    args = parser.parse_args()

    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report(args)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = RESEARCH_DIR / f"{args.prefix}_{timestamp}.json"
    md_path = RESEARCH_DIR / f"{args.prefix}_{timestamp}.md"
    latest_json_path = RESEARCH_DIR / f"{args.prefix}.latest.json"
    latest_md_path = RESEARCH_DIR / f"{args.prefix}.latest.md"

    write_json_report(report, json_path)
    write_json_report(report, latest_json_path)
    write_markdown_report(report, md_path)
    write_markdown_report(report, latest_md_path)

    print(f"[ConsumerCycleStudy] JSON: {json_path}")
    print(f"[ConsumerCycleStudy] Markdown: {md_path}")
    print(f"[ConsumerCycleStudy] Latest JSON: {latest_json_path}")
    print(f"[ConsumerCycleStudy] Latest Markdown: {latest_md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
