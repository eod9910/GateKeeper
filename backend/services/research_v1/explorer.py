"""Static HTML explorer for research-v1 family inspection."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Sequence

from .direction import classify_family_direction_v2


def _load_json(path: Path) -> Dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def _relative_path(base: Path, target: Path) -> str:
    return target.resolve().relative_to(base.resolve()).as_posix()


def _behavior_rows_by_signature(report: Dict[str, object]) -> Dict[str, Dict[str, object]]:
    rows: Dict[str, Dict[str, object]] = {}
    for ranked_rows in report.get("rankings", {}).values():
        for row in ranked_rows:
            signature = str(row["familySignatureV2"])
            rows.setdefault(signature, row)
    return rows


def _direction_comparison_map(report: Dict[str, object]) -> Dict[str, str]:
    comparison = report.get("directionComparison", {})
    mapping: Dict[str, str] = {}
    for row in comparison.get("familiesWhereStructuralAndHistoricalDirectionAgree", []):
        mapping[str(row["familySignatureV2"])] = "AGREE"
    for row in comparison.get("familiesWhereStructuralDirectionIsAmbiguous", []):
        mapping[str(row["familySignatureV2"])] = "AMBIGUOUS"
    for row in comparison.get("familiesWhereStructuralDirectionDisagreesWithHistoricalBias", []):
        mapping[str(row["familySignatureV2"])] = "DISAGREE"
    return mapping


def _inspection_lookup(
    base_dir: Path,
    symbols: Sequence[str],
    timeframe: str,
    period: str,
    html_output_path: Path,
) -> Dict[str, Dict[str, Dict[str, object]]]:
    lookup: Dict[str, Dict[str, Dict[str, object]]] = {}
    for symbol in symbols:
        path = base_dir / f"{symbol.lower()}_{timeframe}_{period}_top_family_inspection_v2.json"
        if not path.exists():
            lookup[symbol] = {}
            continue
        report = _load_json(path)
        symbol_lookup: Dict[str, Dict[str, object]] = {}
        for details in report.get("family_details", {}).values():
            signature = str(details["familySignatureV2"])
            examples = []
            for example in details.get("representativeMotifExamples", []):
                snippet_path = example.get("chartSnippetPath") or example.get("chart_snippet_path")
                if snippet_path:
                    snippet_rel = _relative_path(html_output_path.parent, Path(str(snippet_path)))
                else:
                    snippet_rel = None
                examples.append({
                    "motifInstanceId": example.get("motifInstanceId") or example.get("motif_instance_id"),
                    "entryTimestamp": example.get("entryTimestamp") or example.get("entry_timestamp"),
                    "forward10ReturnAtr": example.get("forward10ReturnAtr") or example.get("forward_10_return_atr"),
                    "exactSignature": example.get("exact_signature"),
                    "chartSnippetPath": snippet_rel,
                })
            symbol_lookup[signature] = {
                "familyId": details.get("family_id"),
                "exactSignatureCount": details.get("exact_signature_count"),
                "representativeExactSignatures": details.get("representativeExactSignatures") or details.get("representative_exact_signatures", []),
                "representativeMotifExamples": examples,
            }
        lookup[symbol] = symbol_lookup
    return lookup


def _derive_direction_agreement(
    structural_direction: str,
    avg_forward_10_return_atr: float | None,
) -> str:
    if structural_direction == "AMBIGUOUS":
        return "AMBIGUOUS"
    if avg_forward_10_return_atr is None:
        return "UNKNOWN"
    historical_direction = "BULLISH" if avg_forward_10_return_atr >= 0 else "BEARISH"
    return "AGREE" if historical_direction == structural_direction else "DISAGREE"


def build_family_explorer_payload(
    base_dir: Path,
    output_path: Path,
    symbols: Sequence[str],
    timeframe: str,
    period: str,
) -> Dict[str, object]:
    comparison_path = base_dir / f"etf_{timeframe}_{period}_family_comparison_v2.json"
    behavior_path = base_dir / f"etf_{timeframe}_{period}_family_behavior_stability_report.json"
    comparison_report = _load_json(comparison_path)
    behavior_report = _load_json(behavior_path)

    family_rows = comparison_report["familyBehaviorStability"]["familyRows"]
    behavior_rows = _behavior_rows_by_signature(behavior_report)
    direction_map = _direction_comparison_map(behavior_report)
    inspection_by_symbol = _inspection_lookup(base_dir, symbols, timeframe, period, output_path)

    families: List[Dict[str, object]] = []
    for row in family_rows:
        signature = str(row["familySignatureV2"])
        structural_direction = classify_family_direction_v2(signature)
        behavior_row = behavior_rows.get(signature, {})
        per_symbol: Dict[str, Dict[str, object]] = {}
        total_occurrences = 0
        candidate_symbols = 0
        for symbol in symbols:
            base_symbol = dict(row["perSymbol"].get(symbol, {}))
            behavior_symbol = dict(behavior_row.get("perSymbol", {}).get(symbol, {}))
            merged_symbol = {
                **base_symbol,
                **behavior_symbol,
            }
            merged_symbol["inspection"] = inspection_by_symbol.get(symbol, {}).get(signature)
            merged_symbol.setdefault(
                "directionAgreement",
                _derive_direction_agreement(
                    structural_direction["direction"],
                    merged_symbol.get("avgForward10ReturnAtr"),
                ),
            )
            total_occurrences += int(merged_symbol.get("occurrenceCount") or 0)
            candidate_symbols += int(bool(merged_symbol.get("isCandidateFamily")))
            per_symbol[symbol] = merged_symbol

        families.append({
            "familySignatureV2": signature,
            "structuralDirection": structural_direction["direction"],
            "structuralDirectionReason": structural_direction["reason"],
            "structuralDirectionComponents": {
                "orientation": structural_direction["orientation"],
                "structuralClass": structural_direction["structuralClass"],
                "breakProfile": structural_direction["breakProfile"],
                "retraceProfile": structural_direction["retraceProfile"],
            },
            "directionComparisonCategory": direction_map.get(signature, "UNRANKED"),
            "symbolCount": row.get("symbolCount"),
            "symbolsPresent": row.get("symbolsPresent"),
            "totalOccurrenceCount": total_occurrences,
            "candidateSymbolCount": candidate_symbols,
            "perSymbol": per_symbol,
            "crossSymbolMeanAvgForward10ReturnAtr": row.get("crossSymbolMeanAvgForward10ReturnAtr"),
            "crossSymbolMedianAvgForward10ReturnAtr": row.get("crossSymbolMedianAvgForward10ReturnAtr"),
            "crossSymbolStddevAvgForward10ReturnAtr": row.get("crossSymbolStddevAvgForward10ReturnAtr"),
            "crossSymbolRangeAvgForward10ReturnAtr": row.get("crossSymbolRangeAvgForward10ReturnAtr"),
            "crossSymbolMeanTScoreForward10": row.get("crossSymbolMeanTScoreForward10"),
            "crossSymbolStddevTScoreForward10": row.get("crossSymbolStddevTScoreForward10"),
            "crossSymbolStdErrorTScoreForward10": row.get("crossSymbolStdErrorTScoreForward10"),
            "crossSymbolMeanSharpeLikeForward10": row.get("crossSymbolMeanSharpeLikeForward10"),
            "crossSymbolStddevSharpeLikeForward10": row.get("crossSymbolStddevSharpeLikeForward10"),
            "crossSymbolMeanHitPlus1AtrFirstRate": row.get("crossSymbolMeanHitPlus1AtrFirstRate"),
            "crossSymbolStddevHitPlus1AtrFirstRate": row.get("crossSymbolStddevHitPlus1AtrFirstRate"),
            "crossSymbolMeanExpectancyRStructural": behavior_row.get("crossSymbolMeanExpectancyRStructural"),
            "crossSymbolStddevExpectancyRStructural": behavior_row.get("crossSymbolStddevExpectancyRStructural"),
            "crossSymbolMeanExpectancyRInferred": behavior_row.get("crossSymbolMeanExpectancyRInferred"),
            "crossSymbolStddevExpectancyRInferred": behavior_row.get("crossSymbolStddevExpectancyRInferred"),
            "sameDirectionalSignAcrossAllSymbols": row.get("sameDirectionalSignAcrossAllSymbols"),
            "symbolsPassingMinCountThreshold": row.get("symbolsPassingMinCountThreshold"),
            "symbolsPassingMinCountThresholdCount": row.get("symbolsPassingMinCountThresholdCount"),
            "passesMinCountThresholdInAtLeastThreeSymbols": row.get("passesMinCountThresholdInAtLeastThreeSymbols"),
            "isCandidateFamily": behavior_row.get("isCandidateFamily", row.get("passesMinCountThresholdInAtLeastThreeSymbols")),
            "directionAgreementSummary": behavior_row.get("directionAgreementSummary"),
        })

    families.sort(
        key=lambda item: (
            int(bool(item["isCandidateFamily"])),
            int(item.get("symbolCount") or 0),
            float(item.get("crossSymbolMeanTScoreForward10") or float("-inf")),
            int(item.get("totalOccurrenceCount") or 0),
            abs(float(item.get("crossSymbolMeanAvgForward10ReturnAtr") or 0.0)),
            item["familySignatureV2"],
        ),
        reverse=True,
    )

    direction_counts = {
        direction: sum(1 for family in families if family["structuralDirection"] == direction)
        for direction in ("BULLISH", "BEARISH", "AMBIGUOUS")
    }
    category_counts = {
        category: sum(1 for family in families if family["directionComparisonCategory"] == category)
        for category in ("AGREE", "AMBIGUOUS", "DISAGREE", "UNRANKED")
    }

    symbol_artifacts = {
        symbol: {
            "normalizedBarsPath": f"{symbol.lower()}_{timeframe}_{period}_normalized_bars.json",
            "pivotsPath": f"{symbol.lower()}_{timeframe}_{period}_atr_pivots.json",
        }
        for symbol in symbols
    }

    return {
        "meta": {
            "timeframe": timeframe,
            "period": period,
            "symbols": list(symbols),
            "symbolArtifacts": symbol_artifacts,
            "comparisonReportPath": _relative_path(output_path.parent, comparison_path),
            "behaviorReportPath": _relative_path(output_path.parent, behavior_path),
            "familyCount": len(families),
            "candidateFamilyCount": sum(1 for family in families if family["isCandidateFamily"]),
            "directionCounts": direction_counts,
            "directionComparisonCounts": category_counts,
        },
        "families": families,
    }


def _render_html(payload: Dict[str, object]) -> str:
    data_json = json.dumps(payload, indent=2)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Family Explorer</title>
  <script src="https://unpkg.com/lightweight-charts@5.1.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root {{
      --bg: #f5efe2;
      --panel: #fffaf0;
      --ink: #1f2933;
      --muted: #5a6775;
      --line: #d8ccb8;
      --accent: #9a3412;
      --accent-soft: #fed7aa;
      --bull: #166534;
      --bear: #991b1b;
      --amb: #7c3aed;
      --shadow: rgba(31, 41, 51, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Aptos", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(251, 191, 36, 0.18), transparent 24rem),
        linear-gradient(180deg, #f8f3e8 0%, var(--bg) 100%);
    }}
    .shell {{
      display: grid;
      grid-template-columns: 26rem 1fr;
      min-height: 100vh;
    }}
    .sidebar {{
      border-right: 1px solid var(--line);
      padding: 1.25rem;
      background: rgba(255, 250, 240, 0.88);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }}
    .content {{
      padding: 1.5rem;
    }}
    h1, h2, h3 {{
      font-family: Georgia, "Times New Roman", serif;
      margin: 0;
    }}
    h1 {{
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }}
    .lede {{
      color: var(--muted);
      line-height: 1.4;
      margin-bottom: 1rem;
    }}
    .summary-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.75rem;
      margin: 1rem 0 1.5rem;
    }}
    .card, .detail-card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 12px 30px var(--shadow);
    }}
    .card {{
      padding: 0.9rem 1rem;
    }}
    .metric {{
      font-size: 1.6rem;
      font-weight: 700;
      margin-top: 0.2rem;
    }}
    .metric-label {{
      color: var(--muted);
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }}
    .controls {{
      display: grid;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }}
    .controls input, .controls select {{
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.75rem 0.9rem;
      background: #fffdf8;
      color: var(--ink);
      font: inherit;
    }}
    .family-list {{
      display: grid;
      gap: 0.6rem;
    }}
    .family-item {{
      width: 100%;
      text-align: left;
      border: 1px solid var(--line);
      background: #fffdf8;
      border-radius: 16px;
      padding: 0.85rem 0.9rem;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }}
    .family-item:hover, .family-item.active {{
      transform: translateY(-1px);
      border-color: var(--accent);
      box-shadow: 0 16px 28px rgba(154, 52, 18, 0.12);
    }}
    .family-sig {{
      font-size: 0.92rem;
      font-weight: 700;
      line-height: 1.3;
      word-break: break-word;
    }}
    .tag-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.45rem;
    }}
    .tag {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0.18rem 0.5rem;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      border: 1px solid var(--line);
      background: #fef7ed;
    }}
    .tag.bull {{ color: var(--bull); border-color: rgba(22, 101, 52, 0.25); background: rgba(22, 101, 52, 0.08); }}
    .tag.bear {{ color: var(--bear); border-color: rgba(153, 27, 27, 0.25); background: rgba(153, 27, 27, 0.08); }}
    .tag.amb {{ color: var(--amb); border-color: rgba(124, 58, 237, 0.25); background: rgba(124, 58, 237, 0.08); }}
    .tag.candidate {{ color: var(--accent); background: var(--accent-soft); border-color: rgba(154, 52, 18, 0.25); }}
    .detail-card {{
      padding: 1rem 1.1rem;
      margin-bottom: 1rem;
    }}
    .detail-grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.8rem;
    }}
    .symbol-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
    }}
    .symbol-card {{
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fffdf8;
      padding: 0.85rem;
    }}
    .symbol-head {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }}
    .kv {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.3rem 0.7rem;
      font-size: 0.92rem;
    }}
    .kv div:nth-child(odd) {{ color: var(--muted); }}
    .snippet-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
    }}
    .snippet {{
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 0.75rem;
      background: #fffdf8;
    }}
    .snippet img {{
      width: 100%;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #0b1220;
    }}
    .snippet-meta {{
      font-size: 0.84rem;
      color: var(--muted);
      margin-top: 0.5rem;
      line-height: 1.35;
    }}
    .snippet-actions {{
      display: flex;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }}
    .snippet-actions button,
    .snippet-actions a {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 0.75rem;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff5eb;
      color: var(--accent);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }}
    .snippet-actions button:hover,
    .snippet-actions a:hover {{
      border-color: var(--accent);
      background: var(--accent-soft);
    }}
    .chart-modal {{
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background: rgba(15, 23, 42, 0.62);
      backdrop-filter: blur(10px);
      z-index: 999;
    }}
    .chart-modal.open {{
      display: flex;
    }}
    .chart-panel {{
      width: min(1200px, 100%);
      max-height: 92vh;
      overflow: auto;
      border-radius: 20px;
      background: #0f172a;
      color: #e2e8f0;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.4);
    }}
    .chart-panel-header {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.15rem 0.75rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }}
    .chart-panel-header p {{
      color: #94a3b8;
      margin-top: 0.4rem;
      max-width: 80ch;
    }}
    .chart-panel-close {{
      width: 38px;
      height: 38px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: rgba(15, 23, 42, 0.4);
      color: #e2e8f0;
      font-size: 1.2rem;
      cursor: pointer;
    }}
    .chart-stage {{
      padding: 1rem 1.15rem 1.15rem;
    }}
    #inspector-chart {{
      width: 100%;
      height: 520px;
      border-radius: 16px;
      overflow: hidden;
      background: #020617;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }}
    .chart-meta-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.8rem;
      margin-top: 0.9rem;
    }}
    .chart-meta-card {{
      border-radius: 14px;
      padding: 0.8rem 0.9rem;
      background: rgba(15, 23, 42, 0.46);
      border: 1px solid rgba(148, 163, 184, 0.18);
    }}
    .chart-meta-label {{
      font-size: 0.74rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.28rem;
    }}
    .chart-meta-value {{
      font-size: 1rem;
      font-weight: 700;
      color: #f8fafc;
    }}
    .chart-loading {{
      color: #94a3b8;
      padding: 1rem 0;
    }}
    .empty {{
      color: var(--muted);
      padding: 1rem 0;
    }}
    a {{
      color: var(--accent);
      text-decoration: none;
    }}
    @media (max-width: 1200px) {{
      .shell {{ grid-template-columns: 1fr; }}
      .sidebar {{ position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }}
      .summary-grid, .detail-grid, .symbol-grid, .snippet-grid, .chart-meta-grid {{ grid-template-columns: 1fr; }}
      #inspector-chart {{ height: 420px; }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <h1>Family Explorer</h1>
      <p class="lede">A static inspection UI for the deterministic v2 family layer. Use this to inspect which structural families are recurring, stable, and visually coherent.</p>
      <div class="controls">
        <input id="search" type="search" placeholder="Search family signature or structural class">
        <select id="directionFilter">
          <option value="ALL">All directions</option>
          <option value="BULLISH">Bullish</option>
          <option value="BEARISH">Bearish</option>
          <option value="AMBIGUOUS">Ambiguous</option>
        </select>
        <select id="comparisonFilter">
          <option value="ALL">All direction states</option>
          <option value="AGREE">Structural/historical agree</option>
          <option value="DISAGREE">Structural/historical disagree</option>
          <option value="AMBIGUOUS">Structural ambiguous</option>
          <option value="UNRANKED">Unranked</option>
        </select>
        <select id="candidateFilter">
          <option value="ALL">All families</option>
          <option value="CANDIDATE">Candidate families only</option>
          <option value="ALL4">Present in all 4 symbols</option>
        </select>
      </div>
      <div id="familyList" class="family-list"></div>
    </aside>
    <main class="content">
      <section class="summary-grid" id="summary"></section>
      <section id="detail"></section>
    </main>
  </div>
  <div id="chartModal" class="chart-modal" aria-hidden="true">
    <div class="chart-panel">
      <div class="chart-panel-header">
        <div>
          <h2 id="chartModalTitle">Family Chart Inspector</h2>
          <p id="chartModalSubtitle">Select a motif example to inspect its candles, pivots, motif boundaries, and entry anchor.</p>
        </div>
        <button id="chartModalClose" class="chart-panel-close" aria-label="Close chart inspector">×</button>
      </div>
      <div class="chart-stage">
        <div id="chartLoading" class="chart-loading hidden">Loading chart window…</div>
        <div id="inspector-chart"></div>
        <div id="chartMetaGrid" class="chart-meta-grid"></div>
      </div>
    </div>
  </div>
  <script id="family-data" type="application/json">{data_json}</script>
  <script>
    const DATA = JSON.parse(document.getElementById("family-data").textContent);
    const state = {{
      search: "",
      direction: "ALL",
      comparison: "ALL",
      candidate: "ALL",
      selected: DATA.families[0]?.familySignatureV2 || null,
    }};

    const classForDirection = (direction) => {{
      if (direction === "BULLISH") return "bull";
      if (direction === "BEARISH") return "bear";
      return "amb";
    }};

    const fmt = (value, digits = 3) => value === null || value === undefined ? "—" : Number(value).toFixed(digits);
    const pct = (value) => value === null || value === undefined ? "—" : `${{(Number(value) * 100).toFixed(1)}}%`;
    const toChartDate = (timestamp) => String(timestamp || "").slice(0, 10);
    const artifactCache = new Map();
    let inspectorChart = null;
    let inspectorResizeHandler = null;

    async function loadSymbolArtifacts(symbol) {{
      if (artifactCache.has(symbol)) {{
        return artifactCache.get(symbol);
      }}
      const paths = DATA.meta.symbolArtifacts[symbol];
      if (!paths) {{
        throw new Error(`No artifact paths found for ${{symbol}}`);
      }}
      const [barsResponse, pivotsResponse] = await Promise.all([
        fetch(paths.normalizedBarsPath),
        fetch(paths.pivotsPath),
      ]);
      if (!barsResponse.ok || !pivotsResponse.ok) {{
        throw new Error(`Failed to load artifacts for ${{symbol}}`);
      }}
      const payload = {{
        bars: await barsResponse.json(),
        pivots: await pivotsResponse.json(),
      }};
      artifactCache.set(symbol, payload);
      return payload;
    }}

    function closeChartInspector() {{
      const modal = document.getElementById("chartModal");
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }}

    function setChartLoading(isLoading, message = "Loading chart window…") {{
      const loading = document.getElementById("chartLoading");
      loading.classList.toggle("hidden", !isLoading);
      loading.textContent = message;
    }}

    function destroyInspectorChart() {{
      if (inspectorResizeHandler) {{
        window.removeEventListener("resize", inspectorResizeHandler);
        inspectorResizeHandler = null;
      }}
      if (inspectorChart) {{
        inspectorChart.remove();
        inspectorChart = null;
      }}
    }}

    async function openChartInspector(family, symbol, example) {{
      const modal = document.getElementById("chartModal");
      const title = document.getElementById("chartModalTitle");
      const subtitle = document.getElementById("chartModalSubtitle");
      const metaGrid = document.getElementById("chartMetaGrid");
      title.textContent = `${{symbol}} · ${{family.familySignatureV2}}`;
      subtitle.textContent = `${{example.entryTimestamp || "Unknown entry"}} · ${{example.exactSignature || "UNSPECIFIED"}}`;
      metaGrid.innerHTML = "";
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      setChartLoading(true);

      try {{
        const artifacts = await loadSymbolArtifacts(symbol);
        const bars = artifacts.bars.records || [];
        const pivots = artifacts.pivots.records || [];
        const startBarIndex = Number(example.start_bar_index ?? example.startBarIndex ?? 0);
        const endBarIndex = Number(example.end_bar_index ?? example.endBarIndex ?? startBarIndex);
        const entryBarIndex = Number(example.entry_bar_index ?? example.entryBarIndex ?? endBarIndex);
        const windowStart = Math.max(0, startBarIndex - 20);
        const windowEnd = Math.min(bars.length - 1, Math.max(endBarIndex + 15, entryBarIndex + 12));
        const windowBars = bars.filter((bar) => bar.bar_index >= windowStart && bar.bar_index <= windowEnd);
        const windowPivots = pivots.filter((pivot) => pivot.bar_index >= windowStart && pivot.bar_index <= windowEnd);
        const motifPivotSet = new Set((example.pivot_timestamps || []).map(toChartDate));

        destroyInspectorChart();
        const container = document.getElementById("inspector-chart");
        inspectorChart = LightweightCharts.createChart(container, {{
          width: container.clientWidth,
          height: container.clientHeight,
          layout: {{
            background: {{ color: "#020617" }},
            textColor: "#cbd5e1",
          }},
          grid: {{
            vertLines: {{ color: "rgba(148, 163, 184, 0.12)" }},
            horzLines: {{ color: "rgba(148, 163, 184, 0.12)" }},
          }},
          rightPriceScale: {{
            borderColor: "rgba(148, 163, 184, 0.2)",
          }},
          timeScale: {{
            borderColor: "rgba(148, 163, 184, 0.2)",
            timeVisible: true,
          }},
        }});

        const candleSeries = inspectorChart.addSeries(LightweightCharts.CandlestickSeries, {{
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderUpColor: "#22c55e",
          borderDownColor: "#ef4444",
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        }});
        candleSeries.setData(windowBars.map((bar) => ({{
          time: toChartDate(bar.timestamp),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }})));

        const pivotSeries = inspectorChart.addSeries(LightweightCharts.LineSeries, {{
          color: "#f97316",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        }});
        pivotSeries.setData(windowPivots.map((pivot) => ({{
          time: toChartDate(pivot.timestamp),
          value: pivot.price,
        }})));

        const markers = [];
        for (const pivot of windowPivots) {{
          const date = toChartDate(pivot.timestamp);
          if (!motifPivotSet.has(date)) {{
            continue;
          }}
          markers.push({{
            time: date,
            position: pivot.pivot_type === "HIGH" ? "aboveBar" : "belowBar",
            color: pivot.pivot_type === "HIGH" ? "#fb7185" : "#38bdf8",
            shape: "circle",
            text: pivot.pivot_type === "HIGH" ? "H" : "L",
          }});
        }}
        const entryBar = bars.find((bar) => bar.bar_index === entryBarIndex);
        if (entryBar) {{
          markers.push({{
            time: toChartDate(entryBar.timestamp),
            position: "inBar",
            color: "#fde047",
            shape: "square",
            text: "ENTRY",
          }});
        }}
        if (LightweightCharts.createSeriesMarkers) {{
          LightweightCharts.createSeriesMarkers(candleSeries, markers);
        }}

        inspectorChart.timeScale().fitContent();
        inspectorResizeHandler = () => {{
          inspectorChart.applyOptions({{
            width: container.clientWidth,
            height: container.clientHeight,
          }});
        }};
        window.addEventListener("resize", inspectorResizeHandler);

        metaGrid.innerHTML = [
          ["Window", `${{windowBars[0]?.timestamp?.slice(0, 10) || "—"}} → ${{windowBars[windowBars.length - 1]?.timestamp?.slice(0, 10) || "—"}}`],
          ["Motif span", `${{startBarIndex}} → ${{endBarIndex}}`],
          ["Entry bar", `${{entryBarIndex}}`],
          ["Forward 10 ATR", `${{fmt(example.forward10ReturnAtr)}}`],
          ["Exact signature", example.exactSignature || "UNSPECIFIED"],
          ["Motif pivots", `${{motifPivotSet.size}}`],
          ["Pivots in window", `${{windowPivots.length}}`],
          ["Bars in window", `${{windowBars.length}}`],
        ].map(([label, value]) => `
          <div class="chart-meta-card">
            <div class="chart-meta-label">${{label}}</div>
            <div class="chart-meta-value">${{value}}</div>
          </div>
        `).join("");
        setChartLoading(false);
      }} catch (error) {{
        setChartLoading(true, error instanceof Error ? error.message : "Failed to load chart window");
      }}
    }}

    function filteredFamilies() {{
      return DATA.families.filter((family) => {{
        const haystack = `${{family.familySignatureV2}} ${{family.structuralDirection}} ${{family.structuralDirectionComponents.structuralClass}}`.toLowerCase();
        if (state.search && !haystack.includes(state.search.toLowerCase())) return false;
        if (state.direction !== "ALL" && family.structuralDirection !== state.direction) return false;
        if (state.comparison !== "ALL" && family.directionComparisonCategory !== state.comparison) return false;
        if (state.candidate === "CANDIDATE" && !family.isCandidateFamily) return false;
        if (state.candidate === "ALL4" && Number(family.symbolCount || 0) < 4) return false;
        return true;
      }});
    }}

    function renderSummary() {{
      const meta = DATA.meta;
      const summary = document.getElementById("summary");
      const cards = [
        ["Families", meta.familyCount],
        ["Candidates", meta.candidateFamilyCount],
        ["Agree / Ambiguous / Disagree", `${{meta.directionComparisonCounts.AGREE}} / ${{meta.directionComparisonCounts.AMBIGUOUS}} / ${{meta.directionComparisonCounts.DISAGREE}}`],
        ["Bull / Bear / Ambiguous", `${{meta.directionCounts.BULLISH}} / ${{meta.directionCounts.BEARISH}} / ${{meta.directionCounts.AMBIGUOUS}}`],
      ];
      summary.innerHTML = cards.map(([label, value]) => `
        <div class="card">
          <div class="metric-label">${{label}}</div>
          <div class="metric">${{value}}</div>
        </div>
      `).join("");
    }}

    function renderList() {{
      const families = filteredFamilies();
      if (!families.find((family) => family.familySignatureV2 === state.selected)) {{
        state.selected = families[0]?.familySignatureV2 || null;
      }}
      const list = document.getElementById("familyList");
      list.innerHTML = families.map((family) => `
        <button class="family-item ${{family.familySignatureV2 === state.selected ? "active" : ""}}" data-signature="${{family.familySignatureV2}}">
          <div class="family-sig">${{family.familySignatureV2}}</div>
          <div class="tag-row">
            <span class="tag ${{classForDirection(family.structuralDirection)}}">${{family.structuralDirection}}</span>
            <span class="tag">${{family.directionComparisonCategory}}</span>
            ${{family.isCandidateFamily ? '<span class="tag candidate">candidate</span>' : ''}}
          </div>
          <div class="snippet-meta">
            occ=${{family.totalOccurrenceCount}} · symbols=${{family.symbolCount}} · t10=${{fmt(family.crossSymbolMeanTScoreForward10)}} · mean10=${{fmt(family.crossSymbolMeanAvgForward10ReturnAtr)}}
          </div>
        </button>
      `).join("") || '<div class="empty">No families match the current filters.</div>';
      list.querySelectorAll(".family-item").forEach((button) => {{
        button.addEventListener("click", () => {{
          state.selected = button.dataset.signature;
          renderList();
          renderDetail();
        }});
      }});
    }}

    function renderDetail() {{
      const family = DATA.families.find((item) => item.familySignatureV2 === state.selected);
      const detail = document.getElementById("detail");
      if (!family) {{
        detail.innerHTML = '<div class="detail-card"><div class="empty">Select a family to inspect.</div></div>';
        return;
      }}

      const symbolCards = Object.entries(family.perSymbol).map(([symbol, stats]) => {{
        const inspection = stats.inspection || {{}};
        const exacts = inspection.representativeExactSignatures || [];
        const snippets = inspection.representativeMotifExamples || [];
        return `
          <div class="symbol-card">
            <div class="symbol-head">
              <h3>${{symbol}}</h3>
              <div class="tag-row">
                <span class="tag ${{classForDirection(stats.structuralDirection || family.structuralDirection)}}">${{stats.structuralDirection || family.structuralDirection}}</span>
                <span class="tag">${{stats.directionAgreement || "UNKNOWN"}}</span>
              </div>
            </div>
            <div class="kv">
              <div>Occurrences</div><div>${{stats.occurrenceCount ?? 0}}</div>
              <div>Split counts</div><div>${{stats.discoveryCount ?? 0}} / ${{stats.validationCount ?? 0}} / ${{stats.holdoutCount ?? 0}}</div>
            <div>Avg forward 10</div><div>${{fmt(stats.avgForward10ReturnAtr)}}</div>
            <div>Median forward 10</div><div>${{fmt(stats.medianForward10ReturnAtr)}}</div>
            <div>Std dev 10</div><div>${{fmt(stats.forward10StdDevAtr)}}</div>
            <div>Std error 10</div><div>${{fmt(stats.forward10StdErrorAtr)}}</div>
            <div>T-score 10</div><div>${{fmt(stats.tScoreForward10)}}</div>
            <div>Sharpe-like 10</div><div>${{fmt(stats.sharpeLikeForward10)}}</div>
            <div>Hit +1 ATR first</div><div>${{pct(stats.hitPlus1AtrFirstRate)}}</div>
            <div>Sign consistency</div><div>${{String(stats.signConsistencyAcrossSplits)}}</div>
            <div>Structural expectancy R</div><div>${{fmt(stats.tradeSimulationStructural?.expectancyR)}}</div>
            <div>Inferred expectancy R</div><div>${{fmt(stats.tradeSimulationInferred?.expectancyR)}}</div>
            </div>
            <div class="snippet-meta">
              Exact signatures: ${{exacts.slice(0, 3).map((item) => `${{item.exact_signature}} (${{item.count}})`).join(" · ") || "none in inspection sample"}}
            </div>
            <div class="snippet-grid" style="margin-top:0.7rem;">
              ${{snippets.map((example, index) => `
                <div class="snippet">
                  ${{example.chartSnippetPath ? `<img src="${{example.chartSnippetPath}}" alt="${{symbol}} snippet">` : '<div class="empty">No snippet saved</div>'}}
                  <div class="snippet-meta">
                    ${{example.entryTimestamp || "—"}}<br>
                    fwd10=${{fmt(example.forward10ReturnAtr)}}<br>
                    ${{example.exactSignature || "UNSPECIFIED"}}
                  </div>
                  <div class="snippet-actions">
                    <button type="button" class="inspect-example-btn" data-symbol="${{symbol}}" data-index="${{index}}">Inspect On Chart</button>
                    ${{example.chartSnippetPath ? `<a href="${{example.chartSnippetPath}}" target="_blank" rel="noreferrer">Open Snippet</a>` : ""}}
                  </div>
                </div>
              `).join("") || '<div class="empty">No snippet samples for this family in the current inspection set.</div>'}}
            </div>
          </div>
        `;
      }}).join("");

      detail.innerHTML = `
        <div class="detail-card">
          <div class="tag-row" style="margin-bottom:0.7rem;">
            <span class="tag ${{classForDirection(family.structuralDirection)}}">${{family.structuralDirection}}</span>
            <span class="tag">${{family.directionComparisonCategory}}</span>
            ${{family.isCandidateFamily ? '<span class="tag candidate">candidate</span>' : ''}}
          </div>
          <h2>${{family.familySignatureV2}}</h2>
          <p class="lede">${{family.structuralDirectionReason}}</p>
          <div class="detail-grid">
            <div class="card">
              <div class="metric-label">Cross-symbol mean t-score</div>
              <div class="metric">${{fmt(family.crossSymbolMeanTScoreForward10)}}</div>
            </div>
            <div class="card">
              <div class="metric-label">Cross-symbol avg 10-bar</div>
              <div class="metric">${{fmt(family.crossSymbolMeanAvgForward10ReturnAtr)}}</div>
            </div>
            <div class="card">
              <div class="metric-label">Cross-symbol dispersion</div>
              <div class="metric">${{fmt(family.crossSymbolStddevAvgForward10ReturnAtr)}}</div>
            </div>
            <div class="card">
              <div class="metric-label">Occurrence total</div>
              <div class="metric">${{family.totalOccurrenceCount}}</div>
            </div>
          </div>
        </div>
        <div class="detail-card">
          <h3 style="margin-bottom:0.75rem;">Structural Components</h3>
          <div class="kv">
            <div>Orientation</div><div>${{family.structuralDirectionComponents.orientation}}</div>
            <div>Structural class</div><div>${{family.structuralDirectionComponents.structuralClass}}</div>
            <div>Break profile</div><div>${{family.structuralDirectionComponents.breakProfile}}</div>
            <div>Retrace profile</div><div>${{family.structuralDirectionComponents.retraceProfile}}</div>
            <div>Cross-symbol mean t-score</div><div>${{fmt(family.crossSymbolMeanTScoreForward10)}}</div>
            <div>Cross-symbol t-score dispersion</div><div>${{fmt(family.crossSymbolStddevTScoreForward10)}}</div>
            <div>Cross-symbol mean sharpe-like</div><div>${{fmt(family.crossSymbolMeanSharpeLikeForward10)}}</div>
            <div>Same forward sign across symbols</div><div>${{String(family.sameDirectionalSignAcrossAllSymbols)}}</div>
            <div>Passes count threshold in 3+ symbols</div><div>${{String(family.passesMinCountThresholdInAtLeastThreeSymbols)}}</div>
            <div>Symbols passing count threshold</div><div>${{(family.symbolsPassingMinCountThreshold || []).join(", ") || "—"}}</div>
            <div>Behavioral stability report</div><div><a href="${{DATA.meta.behaviorReportPath}}" target="_blank" rel="noreferrer">open JSON</a></div>
          </div>
        </div>
        <div class="detail-card">
          <h3 style="margin-bottom:0.4rem;">Per-symbol View</h3>
          <p class="lede" style="margin-bottom:0.9rem;">Use “Inspect On Chart” on any representative motif to open the live candle window with pivots and entry anchor.</p>
          <div class="symbol-grid">${{symbolCards}}</div>
        </div>
      `;
      detail.querySelectorAll(".inspect-example-btn").forEach((button) => {{
        button.addEventListener("click", () => {{
          const symbol = button.dataset.symbol;
          const index = Number(button.dataset.index || 0);
          const examples = family.perSymbol?.[symbol]?.inspection?.representativeMotifExamples || [];
          const example = examples[index];
          if (example) {{
            openChartInspector(family, symbol, example);
          }}
        }});
      }});
    }}

    document.getElementById("search").addEventListener("input", (event) => {{
      state.search = event.target.value;
      renderList();
      renderDetail();
    }});
    document.getElementById("directionFilter").addEventListener("change", (event) => {{
      state.direction = event.target.value;
      renderList();
      renderDetail();
    }});
    document.getElementById("comparisonFilter").addEventListener("change", (event) => {{
      state.comparison = event.target.value;
      renderList();
      renderDetail();
    }});
    document.getElementById("candidateFilter").addEventListener("change", (event) => {{
      state.candidate = event.target.value;
      renderList();
      renderDetail();
    }});
    document.getElementById("chartModalClose").addEventListener("click", closeChartInspector);
    document.getElementById("chartModal").addEventListener("click", (event) => {{
      if (event.target.id === "chartModal") {{
        closeChartInspector();
      }}
    }});

    renderSummary();
    renderList();
    renderDetail();
  </script>
</body>
</html>
"""


def build_family_explorer_html(
    base_dir: Path,
    output_path: Path,
    symbols: Sequence[str],
    timeframe: str = "1d",
    period: str = "10y",
) -> Dict[str, object]:
    payload = build_family_explorer_payload(
        base_dir=base_dir,
        output_path=output_path,
        symbols=symbols,
        timeframe=timeframe,
        period=period,
    )
    output_path.write_text(_render_html(payload), encoding="utf-8")
    return {
        "outputPath": str(output_path),
        "familyCount": payload["meta"]["familyCount"],
        "candidateFamilyCount": payload["meta"]["candidateFamilyCount"],
    }
