export function ledgerDisplayNumber(value: unknown, digits: number = 1): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : 'N/A';
}

export function ledgerDisplayMoney(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

export function ledgerDisplayPct(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : 'N/A';
}

export function ledgerScaleNumber(value: unknown, scale?: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const normalizedScale = String(scale || '').toLowerCase();
  if (normalizedScale === 'thousands') return num * 1_000;
  if (normalizedScale === 'millions') return num * 1_000_000;
  if (normalizedScale === 'billions') return num * 1_000_000_000;
  return num;
}

export function ledgerMetricValue(metric: any): number | null {
  if (metric && typeof metric === 'object' && 'value' in metric) {
    return ledgerScaleNumber(metric.value, metric.scale);
  }
  return ledgerScaleNumber(metric);
}

export function ledgerFirstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}

export function ledgerEvidenceText(data: any): string {
  const refs = Array.isArray(data?.key_evidence_refs) ? data.key_evidence_refs : [];
  const chunks = refs.flatMap((ref: any) => [
    ref?.section_heading,
    ref?.text_excerpt,
    ref?.summary,
  ]);
  return chunks.map((chunk: any) => String(chunk || '').trim()).filter(Boolean).join(' ');
}

export function ledgerTechnologyClues(data: any): string[] {
  const text = ledgerEvidenceText(data);
  if (!text) return [];
  const matches = text.match(/\b(?:technology|platform|proprietary|patent(?:ed|s)?|process|reactor|catalyst|software|algorithm|AI|machine learning|automation|manufacturing|chemistry|conversion|recycling|feedstock|sensor|device|therapy|drug|molecule|battery|semiconductor|network)\b/gi) || [];
  return Array.from(new Set(matches.map((match) => match.toLowerCase()))).slice(0, 8);
}

/**
 * Render the narrative-adjusted (social thesis overlay) section of a DCF
 * explanation. Returns [] when no narrative case was applied, so callers can
 * spread it in unconditionally.
 */
export function buildLedgerNarrativeCaseLines(narrativeCase: any): string[] {
  if (!narrativeCase || !narrativeCase.applied) return [];
  const gap = narrativeCase.narrative_vs_base_pct;
  const priceGap = narrativeCase.price_vs_narrative_pct;
  const gapText = Number.isFinite(Number(gap))
    ? `${Number(gap) > 0 ? '+' : ''}${gap}% vs the base case`
    : 'a different level than the base case';
  const priceLine = Number.isFinite(Number(priceGap))
    ? `- Against today's price, the narrative case implies ${Number(priceGap) >= 0 ? 'upside' : 'downside'} of ${Math.abs(Number(priceGap))}%. If the price has not moved yet, that delta IS the expectation gap — the market story front-running the fundamentals.`
    : '- Current price was unavailable to size the gap against the narrative case.';
  return [
    '',
    'Narrative-adjusted case (social-thesis overlay):',
    `- ${narrativeCase.rationale || 'A social-narrative thesis is influencing demand expectations for this name.'}`,
    `- I moved near-term revenue growth from ${ledgerDisplayPct(narrativeCase.base_revenue_growth_pct)} to ${ledgerDisplayPct(narrativeCase.adjusted_revenue_growth_pct)} in this scenario only.`,
    `- That shifts fair value from a base of ${ledgerDisplayMoney(narrativeCase.base_fair_value_per_share)} to ${ledgerDisplayMoney(narrativeCase.fair_value_per_share)} (${gapText}).`,
    priceLine,
    '- This overlay is narrative-driven and is NOT in the filings; the filing-anchored base case above is unchanged.',
  ];
}
