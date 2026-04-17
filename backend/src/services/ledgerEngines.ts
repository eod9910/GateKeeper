import { classifyCompanyFromSnapshot, getSymbolClassification, upsertSymbolClassification } from './symbolCatalog';

type LedgerMetricEntry = {
  value?: number | null;
  unit?: string | null;
  scale?: string | null;
  source_type?: string | null;
  source_document?: string | null;
};

type LedgerPeriod = {
  period_end?: string | null;
  filing_date?: string | null;
  available_at?: string | null;
  fiscal_year?: number | null;
  fiscal_quarter?: number | null;
  metrics?: Record<string, LedgerMetricEntry | null | undefined>;
};

type LedgerContextSummary = {
  symbol?: string | null;
  company_name?: string | null;
  coverage?: Record<string, any> | null;
  current_snapshot?: Record<string, any> | null;
  annual_context?: {
    latest_annual?: LedgerPeriod | null;
    latest_quarterly?: LedgerPeriod | null;
    derived?: Record<string, any> | null;
  } | null;
  evidence_context?: {
    recent_documents?: any[];
    retrieval?: {
      available?: boolean | null;
      query?: string | null;
      result_count?: number | null;
      results?: Array<Record<string, any>>;
      error?: string | null;
      meta?: Record<string, any> | null;
    } | null;
  } | null;
};

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function trimString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function getMetricValue(period: LedgerPeriod | null | undefined, key: string): number | null {
  const entry = period?.metrics?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const baseValue = toFiniteNumber(entry.value);
  if (baseValue == null) return null;
  const scale = trimString((entry as any).scale)?.toLowerCase();
  const multiplier =
    scale === 'billions' ? 1_000_000_000 :
    scale === 'millions' ? 1_000_000 :
    scale === 'thousands' ? 1_000 :
    1;
  return baseValue * multiplier;
}

function getFirstMetricValue(period: LedgerPeriod | null | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = getMetricValue(period, key);
    if (value != null) return value;
  }
  return null;
}

function resolveAnnualRevenue(period: LedgerPeriod | null | undefined, snapshot: Record<string, any> | null | undefined): number | null {
  const statementRevenue = getMetricValue(period, 'revenue');
  const snapshotRevenue = toFiniteNumber(snapshot?.annualRevenue);
  if (statementRevenue != null && Number.isFinite(Number(statementRevenue))) {
    if (snapshotRevenue != null && Number.isFinite(Number(snapshotRevenue)) && Number(snapshotRevenue) > 0) {
      const ratio = Number(statementRevenue) / Number(snapshotRevenue);
      if (ratio > 5 || ratio < 0.2) {
        return Number(snapshotRevenue);
      }
    }
    return Number(statementRevenue);
  }

  if (snapshotRevenue != null && Number.isFinite(Number(snapshotRevenue))) {
    return Number(snapshotRevenue);
  }

  const enterpriseValue = toFiniteNumber(snapshot?.enterpriseValue);
  const enterpriseToSales = toFiniteNumber(snapshot?.enterpriseToSales);
  if (Number.isFinite(Number(enterpriseValue)) && Number.isFinite(Number(enterpriseToSales)) && Number(enterpriseToSales) > 0) {
    return Number(enterpriseValue) / Number(enterpriseToSales);
  }

  return null;
}

function buildValuationPriceJudgment(currentPrice: number | null, midpointFairValue: number | null): 'undervalued' | 'overvalued' | 'roughly_fair' | 'insufficient_precision' {
  const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(midpointFairValue)) && Number(currentPrice)
    ? ((Number(midpointFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
    : null;

  if (!Number.isFinite(Number(upsidePctToMid))) return 'insufficient_precision';
  if (Number(upsidePctToMid) >= 15) return 'undervalued';
  if (Number(upsidePctToMid) <= -15) return 'overvalued';
  return 'roughly_fair';
}

function classifyCashConversion(ratio: number | null): { label: string; score: number; summary: string } {
  if (!Number.isFinite(Number(ratio))) {
    return { label: 'unknown', score: 45, summary: 'Cash conversion cannot be judged cleanly from the loaded facts.' };
  }
  const value = Number(ratio);
  if (value >= 1.2) {
    return { label: 'strong', score: 85, summary: 'Operating cash flow is running ahead of reported net income, which usually supports earnings quality.' };
  }
  if (value >= 0.9) {
    return { label: 'acceptable', score: 70, summary: 'Operating cash flow broadly supports reported earnings.' };
  }
  if (value >= 0.6) {
    return { label: 'soft', score: 50, summary: 'Cash conversion looks weaker than reported earnings and deserves caution.' };
  }
  return { label: 'weak', score: 25, summary: 'Operating cash flow is materially lagging reported earnings, which is a quality concern.' };
}

function classifyCapexBurden(capexToOcfPct: number | null): { label: string; score: number; summary: string } {
  if (!Number.isFinite(Number(capexToOcfPct))) {
    return { label: 'unknown', score: 50, summary: 'Capex burden cannot be judged cleanly from the loaded facts.' };
  }
  const value = Number(capexToOcfPct);
  if (value <= 35) {
    return { label: 'light', score: 85, summary: 'Capital intensity looks manageable relative to operating cash flow.' };
  }
  if (value <= 65) {
    return { label: 'moderate', score: 65, summary: 'Capital spending is meaningful but not overwhelming relative to operating cash flow.' };
  }
  if (value <= 90) {
    return { label: 'heavy', score: 40, summary: 'Capital spending is absorbing most of operating cash flow.' };
  }
  return { label: 'very_heavy', score: 20, summary: 'Capital spending is consuming nearly all operating cash flow, which limits true owner cash generation.' };
}

function classifyFreeCashFlow(fcfMarginPct: number | null): { label: string; score: number; summary: string } {
  if (!Number.isFinite(Number(fcfMarginPct))) {
    return { label: 'unknown', score: 50, summary: 'Free cash flow margin cannot be judged cleanly from the loaded facts.' };
  }
  const value = Number(fcfMarginPct);
  if (value >= 10) {
    return { label: 'strong', score: 80, summary: 'Free cash flow margin is strong enough to support durable owner earnings.' };
  }
  if (value >= 5) {
    return { label: 'positive', score: 65, summary: 'Free cash flow is positive, though not especially rich relative to revenue.' };
  }
  if (value >= 0) {
    return { label: 'thin', score: 45, summary: 'Free cash flow is positive but thin after reinvestment.' };
  }
  return { label: 'negative', score: 20, summary: 'Free cash flow is negative after reinvestment, which raises earnings-quality caution.' };
}

function scoreKeywordRisk(results: Array<Record<string, any>>, patterns: RegExp[]): { hits: number; matches: Array<Record<string, any>> } {
  const matches = results.filter((row) => {
    const text = `${trimString(row?.section_heading) || ''}\n${trimString(row?.text_excerpt) || ''}`;
    return patterns.some((pattern) => pattern.test(text));
  });
  return { hits: matches.length, matches };
}

function buildEvidenceRefs(rows: Array<Record<string, any>>, limit: number = 4): Array<Record<string, any>> {
  return rows.slice(0, limit).map((row) => ({
    form: trimString(row?.form),
    filing_date: trimString(row?.filing_date),
    accession_number: trimString(row?.accession_number),
    section_heading: trimString(row?.section_heading),
    text_excerpt: trimString(row?.text_excerpt),
    hybrid_score: toFiniteNumber(row?.hybrid_score),
  }));
}

function buildEvidenceText(row: Record<string, any> | null | undefined): string {
  return [
    trimString(row?.section_heading),
    trimString(row?.text_excerpt),
  ].filter(Boolean).join('\n');
}

function parseFirstMatchNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = toFiniteNumber(match[1].replace(/,/g, ''));
    if (parsed != null) return parsed;
  }
  return null;
}

function parseFirstMatchText(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = trimString(match?.[1]);
    if (parsed) return parsed.replace(/[.;,\s]+$/g, '').trim();
  }
  return null;
}

function isFinancialCompanyForDcf(snapshot: Record<string, any> | null | undefined): boolean {
  const sector = trimString(snapshot?.sector)?.toLowerCase() || '';
  const industry = trimString(snapshot?.industry)?.toLowerCase() || '';
  const haystack = `${sector} ${industry}`;
  return /\bfinancial\b|\bbank\b|\bbanks\b|\binsurance\b|\bcredit\b|\blender\b|\blending\b|\bmortgage\b|\basset management\b|\bcapital markets\b|\bconsumer finance\b/.test(haystack);
}

function resolveValuationEngineClass(ledgerBase: LedgerContextSummary): string {
  const symbol = trimString(ledgerBase?.symbol);
  const snapshot = ledgerBase?.current_snapshot || {};
  const stored = symbol ? getSymbolClassification(symbol) : null;
  if (stored?.valuationEngineClass) {
    return stored.valuationEngineClass;
  }
  const inferred = classifyCompanyFromSnapshot(snapshot);
  if (symbol && inferred) {
    upsertSymbolClassification(symbol, {
      sector: inferred.sector,
      industry: inferred.industry,
      companyType: inferred.companyType,
      valuationEngineClass: inferred.valuationEngineClass,
      classificationSource: inferred.classificationSource,
      classificationConfidence: inferred.classificationConfidence,
      lastClassifiedAt: new Date().toISOString(),
    });
  }
  if (inferred?.valuationEngineClass) {
    return inferred.valuationEngineClass;
  }
  return isFinancialCompanyForDcf(snapshot) ? 'roe_book_value' : 'dcf_operating';
}

export function detectCorporateAction(ledgerBase: LedgerContextSummary): Record<string, any> | null {
  const snapshot = ledgerBase?.current_snapshot || {};
  const currentPrice = toFiniteNumber(snapshot.currentPrice);
  const retrievalResults = Array.isArray(ledgerBase?.evidence_context?.retrieval?.results)
    ? ledgerBase.evidence_context!.retrieval!.results
    : [];
  const recentDocuments = Array.isArray(ledgerBase?.evidence_context?.recent_documents)
    ? ledgerBase.evidence_context!.recent_documents
    : [];

  const candidateRows = retrievalResults.filter((row) => {
    const text = buildEvidenceText(row).toLowerCase();
    return /\bmerger\b|\bacquisition\b|\bgoing private\b|\btake-private\b|\bdefinitive agreement\b|\bmerger agreement\b|\bstockholders to receive\b|\bcontingent value right\b|\bcvr\b|\bexpected to close\b|\bacquired by\b/.test(text);
  });

  if (!candidateRows.length) {
    return null;
  }

  const combinedText = candidateRows.map((row) => buildEvidenceText(row)).join('\n');
  const strongSignal = /\bdefinitive agreement\b|\bmerger agreement\b|\bstockholders to receive\b|\bcontingent value right\b|\bacquired by\b|\bgoing private\b|\bexpected to close\b/i.test(combinedText);
  if (!strongSignal) {
    return null;
  }

  const cashDealPrice = parseFirstMatchNumber(combinedText, [
    /stockholders?\s+to\s+receive[^$]{0,100}\$([0-9]+(?:\.[0-9]+)?)/i,
    /receive[^$]{0,100}\$([0-9]+(?:\.[0-9]+)?)\s+per share in cash/i,
    /\$([0-9]+(?:\.[0-9]+)?)\s+per share in cash/i,
    /cash consideration[^$]{0,60}\$([0-9]+(?:\.[0-9]+)?)/i,
    /\bacquired\b[^$]{0,80}\$([0-9]+(?:\.[0-9]+)?)\s+per share/i,
  ]);
  const cvrMax = parseFirstMatchNumber(combinedText, [
    /contingent value right[^$]{0,80}up to \$([0-9]+(?:\.[0-9]+)?)/i,
    /\bcvr\b[^$]{0,80}up to \$([0-9]+(?:\.[0-9]+)?)/i,
    /up to \$([0-9]+(?:\.[0-9]+)?)\s+per share payable/i,
  ]);
  const expectedClose = parseFirstMatchText(combinedText, [
    /expected to close(?: around| on| in)?\s+([A-Za-z]+ \d{1,2}, \d{4})/i,
    /expected to close(?: around| on| in)?\s+([A-Za-z]+ \d{4})/i,
    /expected to close(?: around| on| in)?\s+(Q[1-4]\s+\d{4})/i,
  ]);
  const acquirer = parseFirstMatchText(combinedText, [
    /\bacquired by\s+([A-Z][A-Za-z0-9&.,\- ]{2,80}?)(?:\s+for\b|\.|,|$)/i,
    /\bto be acquired by\s+([A-Z][A-Za-z0-9&.,\- ]{2,80}?)(?:\s+for\b|\.|,|$)/i,
  ]);

  const currentToDealSpreadPct = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(cashDealPrice)) && Number(cashDealPrice) !== 0
    ? ((Number(currentPrice) - Number(cashDealPrice)) / Number(cashDealPrice)) * 100
    : null;

  const recent8kCount = recentDocuments.filter((doc) => trimString(doc?.form_type)?.toUpperCase() === '8-K').length;
  const summaryParts = [
    'The filings indicate this is a pending acquisition / go-private situation, not a normal standalone equity setup.',
    Number.isFinite(Number(cashDealPrice))
      ? `Cash consideration appears to be about $${Number(cashDealPrice).toFixed(2)} per share.`
      : null,
    Number.isFinite(Number(cvrMax))
      ? `There is also a contingent value right of up to $${Number(cvrMax).toFixed(2)} per share.`
      : null,
    expectedClose ? `Management says the deal is expected to close ${expectedClose}.` : null,
  ].filter(Boolean);

  return {
    code: 'pending_acquisition',
    status: 'pending_acquisition',
    label: 'Pending acquisition / going-private',
    severity: 'critical',
    analysis_mode_override: 'merger_arb',
    confidence: recent8kCount > 0 && Number.isFinite(Number(cashDealPrice)) ? 'high' : 'moderate',
    summary: summaryParts.join(' '),
    acquirer,
    deal_price_per_share: cashDealPrice,
    contingent_value_right_max_per_share: cvrMax,
    expected_close: expectedClose,
    current_price: currentPrice,
    current_to_deal_spread_pct: Number.isFinite(Number(currentToDealSpreadPct))
      ? Number(Number(currentToDealSpreadPct).toFixed(2))
      : null,
    short_thesis_warning: Number.isFinite(Number(cashDealPrice))
      ? 'I would not treat this as a normal short. Once a signed cash deal is live, the stock usually trades around the deal consideration and the real risk becomes deal breakage, timing, and spread compression.'
      : 'I would not treat this as a normal short. The filing evidence points to a signed corporate-action situation, so the stock is likely trading on deal terms rather than ordinary standalone valuation.',
    evidence_refs: buildEvidenceRefs(candidateRows, 3),
  };
}

function buildSimpleHardFlag(
  ledgerBase: LedgerContextSummary,
  code: string,
  label: string,
  severity: 'high' | 'critical',
  analysisModeOverride: string,
  patterns: RegExp[],
  summary: string,
  shortWarning: string,
): Record<string, any> | null {
  const retrievalResults = Array.isArray(ledgerBase?.evidence_context?.retrieval?.results)
    ? ledgerBase.evidence_context!.retrieval!.results
    : [];
  const candidateRows = retrievalResults.filter((row) => {
    const text = buildEvidenceText(row).toLowerCase();
    return patterns.some((pattern) => pattern.test(text));
  });
  if (!candidateRows.length) return null;

  return {
    code,
    status: code,
    label,
    severity,
    analysis_mode_override: analysisModeOverride,
    confidence: candidateRows.length >= 2 ? 'high' : 'moderate',
    summary,
    short_thesis_warning: shortWarning,
    evidence_refs: buildEvidenceRefs(candidateRows, 3),
  };
}

function detectLedgerHardFlags(ledgerBase: LedgerContextSummary): Array<Record<string, any>> {
  const flags: Array<Record<string, any>> = [];
  const corporateAction = detectCorporateAction(ledgerBase);
  if (corporateAction) {
    flags.push(corporateAction);
  }

  const distressFlag = buildSimpleHardFlag(
    ledgerBase,
    'distress_warning',
    'Distress / restructuring risk',
    'critical',
    'distress',
    [
      /\bchapter 11\b/i,
      /\bgoing concern\b/i,
      /\bsubstantial doubt\b/i,
      /\bcovenant breach\b/i,
      /\bevent of default\b/i,
      /\bforbearance\b/i,
      /\brestructuring support agreement\b/i,
      /\bmissed interest\b/i,
    ],
    'The filings point to a distress or restructuring situation. This should be analyzed as a survival and capital-structure problem, not a normal valuation setup.',
    'I would not treat this as a routine valuation short or long. The real issue is liquidity, capital structure, and restructuring risk.',
  );
  if (distressFlag) flags.push(distressFlag);

  const delistingFlag = buildSimpleHardFlag(
    ledgerBase,
    'listing_risk',
    'Delisting / trading-status risk',
    'high',
    'listing_risk',
    [
      /\bdeficiency notice\b/i,
      /\bminimum bid\b/i,
      /\bdelist(?:ing)?\b/i,
      /\bnon-?compliance with (nasdaq|nyse) listing\b/i,
      /\btrading suspension\b/i,
      /\bsuspended from trading\b/i,
    ],
    'The filings suggest a listing-status or trading-status problem. This changes the setup from normal equity analysis to market-access and listing-risk analysis.',
    'Before taking a position, I would focus on listing risk and market access. A delisting situation can make normal valuation work far less relevant.',
  );
  if (delistingFlag) flags.push(delistingFlag);

  const accountingFlag = buildSimpleHardFlag(
    ledgerBase,
    'forensic_accounting',
    'Restatement / accounting-integrity risk',
    'critical',
    'forensic',
    [
      /\brestatement\b/i,
      /\bcannot rely on\b/i,
      /\bmaterial weakness\b/i,
      /\bauditor resign/i,
      /\baccounting irregularit/i,
      /\bsec investigation\b/i,
      /\bdoj investigation\b/i,
    ],
    'The filings point to a restatement, internal-control, or accounting-integrity problem. This should be analyzed as a forensic situation, not a normal quality read.',
    'I would slow down here. If the numbers themselves are under question, ordinary valuation and quality conclusions become much less trustworthy.',
  );
  if (accountingFlag) flags.push(accountingFlag);

  const financingFlag = buildSimpleHardFlag(
    ledgerBase,
    'emergency_financing',
    'Dilution / financing event risk',
    'high',
    'financing_event',
    [
      /\bat-the-market\b/i,
      /\batm program\b/i,
      /\bregistered direct offering\b/i,
      /\bpipe\b/i,
      /\bprivate investment in public equity\b/i,
      /\bconvertible note/i,
      /\bwarrant inducement\b/i,
      /\bequity offering\b/i,
    ],
    'The filings suggest a meaningful financing or dilution event. This should be treated as a per-share capital-structure event, not just a routine business-quality update.',
    'I would not ignore this financing language. A fresh raise or dilution event can overwhelm the normal per-share thesis.',
  );
  if (financingFlag) flags.push(financingFlag);

  const legalShockFlag = buildSimpleHardFlag(
    ledgerBase,
    'legal_regulatory_shock',
    'Major legal / regulatory event',
    'high',
    'event_risk',
    [
      /\bsubpoena\b/i,
      /\bcivil investigative demand\b/i,
      /\bconsent decree\b/i,
      /\bwarning letter\b/i,
      /\bclinical hold\b/i,
      /\bproduct recall\b/i,
      /\bformal investigation\b/i,
      /\bsettlement agreement\b/i,
    ],
    'The filings point to a meaningful legal or regulatory event. This should be treated as event risk, not just a background note disclosure.',
    'I would treat this as event risk first. Legal or regulatory shocks can dominate the stock before normal valuation matters again.',
  );
  if (legalShockFlag) flags.push(legalShockFlag);

  return flags;
}

function toPctString(value: number | null): string | null {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : null;
}

function toRatioString(value: number | null): string | null {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : null;
}

function toMultipleString(value: number | null): string | null {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}x` : null;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (!Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator)) || !Number(denominator)) {
    return null;
  }
  return Number(numerator) / Number(denominator);
}

function hasFiniteNumber(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const num = Number(value);
  return Number.isFinite(num);
}

function cleanList(values: Array<string | null | undefined>, limit: number = 6): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const text = trimString(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}

function buildConfidenceLevel(hasAnnual: boolean, retrievalCount: number, extraSupport: number = 0): string {
  if (hasAnnual && retrievalCount >= 3 && extraSupport >= 2) return 'moderate';
  if (hasAnnual && retrievalCount >= 1) return 'moderate_low';
  if (hasAnnual) return 'low_to_moderate';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function interpolate(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}

function toMoneyString(value: number | null): string | null {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : null;
}

type LedgerEvidenceAssessment = {
  sufficient: boolean;
  status: 'sufficient' | 'no_company_data' | 'not_in_database';
  message: string;
  coverageTier: string | null;
  analysisMode: 'filing_backed' | 'vendor_snapshot_only' | 'insufficient';
};

function countAvailableMetrics(period: LedgerPeriod | null | undefined): number {
  const metrics = period?.metrics || {};
  return Object.values(metrics).filter((entry) => {
    return entry && typeof entry === 'object' && hasFiniteNumber((entry as LedgerMetricEntry).value);
  }).length;
}

function assessLedgerEvidence(ledgerBase: LedgerContextSummary): LedgerEvidenceAssessment {
  const coverageTier = trimString(ledgerBase?.coverage?.coverage_tier);
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const latestQuarterly = ledgerBase?.annual_context?.latest_quarterly || null;
  const retrievalResults = Array.isArray(ledgerBase?.evidence_context?.retrieval?.results)
    ? ledgerBase.evidence_context!.retrieval!.results
    : [];
  const recentDocuments = Array.isArray(ledgerBase?.evidence_context?.recent_documents)
    ? ledgerBase.evidence_context!.recent_documents
    : [];
  const snapshot = ledgerBase?.current_snapshot || {};

  const annualMetricCount = countAvailableMetrics(latestAnnual);
  const quarterlyMetricCount = countAvailableMetrics(latestQuarterly);
  const snapshotMetricCount = [
    snapshot.revenueGrowthPct,
    snapshot.operatingCashFlowTTM,
    snapshot.freeCashFlowTTM,
    snapshot.currentRatio,
    snapshot.enterpriseValue,
    snapshot.marketCap,
    snapshot.currentPrice,
  ].filter((value) => hasFiniteNumber(value)).length;

  const hasStructuredCoverage = annualMetricCount >= 3 || quarterlyMetricCount >= 3;
  const hasFilingEvidence = retrievalResults.length > 0 || recentDocuments.length > 0;
  const hasMeaningfulSnapshot = snapshotMetricCount >= 3;

  if (coverageTier === 'full_filing_supported' && (hasStructuredCoverage || hasFilingEvidence)) {
    return {
      sufficient: true,
      status: 'sufficient',
      message: 'Sufficient filing-backed evidence is available.',
      coverageTier,
      analysisMode: 'filing_backed',
    };
  }

  if ((coverageTier === 'insufficient_data' || !coverageTier) && !hasStructuredCoverage && !hasFilingEvidence && !hasMeaningfulSnapshot) {
    return {
      sufficient: false,
      status: 'not_in_database',
      message: 'I have no data on this company. This company is not in our database right now.',
      coverageTier,
      analysisMode: 'insufficient',
    };
  }

  if (coverageTier === 'foreign_reporting' && !hasStructuredCoverage && !hasFilingEvidence && hasMeaningfulSnapshot) {
    return {
      sufficient: true,
      status: 'sufficient',
      message: 'I can still give a provisional vendor-backed read from Yahoo and Stockdex, but I do not have the domestic 10-K/10-Q filing coverage Ledger normally relies on for a filing-backed analysis.',
      coverageTier,
      analysisMode: 'vendor_snapshot_only',
    };
  }

  if (coverageTier === 'foreign_reporting' && !hasStructuredCoverage && !hasFilingEvidence) {
    return {
      sufficient: false,
      status: 'no_company_data',
      message: hasMeaningfulSnapshot
        ? 'I have only partial coverage on this company. It appears to be a foreign reporting filer that uses forms like 20-F, 6-K, or 40-F, so I do not have the domestic 10-K/10-Q filing coverage Ledger relies on for a real analysis yet.'
        : 'I do not have strong Ledger coverage on this company. It appears to be a foreign reporting filer that uses forms like 20-F, 6-K, or 40-F, so the domestic 10-K/10-Q filing path Ledger relies on is not available here.',
      coverageTier,
      analysisMode: 'insufficient',
    };
  }

  if (!hasStructuredCoverage && !hasFilingEvidence && hasMeaningfulSnapshot) {
    return {
      sufficient: true,
      status: 'sufficient',
      message: 'I can give a provisional vendor-backed read from Yahoo and Stockdex, but I do not have filing-backed Ledger coverage for this company yet.',
      coverageTier,
      analysisMode: 'vendor_snapshot_only',
    };
  }

  if (!hasStructuredCoverage && !hasFilingEvidence) {
    return {
      sufficient: false,
      status: 'no_company_data',
      message: 'I have no information on this company that is strong enough for a real Ledger analysis.',
      coverageTier,
      analysisMode: 'insufficient',
    };
  }

  return {
    sufficient: true,
    status: 'sufficient',
    message: 'Enough evidence is available for a provisional analysis.',
    coverageTier,
    analysisMode: hasStructuredCoverage || hasFilingEvidence ? 'filing_backed' : 'vendor_snapshot_only',
  };
}

export function runEarningsQualityEngine(ledgerBase: LedgerContextSummary): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const derived = ledgerBase?.annual_context?.derived || {};
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: ledgerBase?.company_name || null,
      engine: 'earnings_quality_engine',
      confidence_level: 'low',
      status: evidenceAssessment.status,
      coverage_tier: evidenceAssessment.coverageTier,
      analysis_mode: evidenceAssessment.analysisMode,
      earnings_quality_grade: 'insufficient_evidence',
      earnings_quality_score: null,
      cash_conversion: {
        ratio_ocf_to_net_income: null,
        ratio_display: null,
        assessment: 'unknown',
        summary: evidenceAssessment.message,
        operating_cash_flow: null,
        net_income: null,
      },
      accounting_distortions: {
        one_time_item_risk_hits: 0,
        lease_risk_hits: 0,
        revenue_recognition_risk_hits: 0,
        potential_distortion_summary: [],
      },
      dilution_and_capital_structure: {
        dilution_risk_hits: 0,
        debt: null,
        cash: null,
        balance_sheet_pressure: 'unknown',
        summary: evidenceAssessment.message,
      },
      balance_sheet_pressure: {
        current_ratio: null,
        quick_ratio: null,
        liquidity_assessment: 'unknown',
        debt: null,
        cash: null,
      },
      reinvestment_and_free_cash_flow: {
        revenue: null,
        free_cash_flow: null,
        capital_expenditures: null,
        free_cash_flow_margin_pct: null,
        free_cash_flow_margin_display: null,
        capex_as_pct_of_ocf: null,
        capex_as_pct_of_ocf_display: null,
        free_cash_flow_assessment: 'unknown',
        capex_burden_assessment: 'unknown',
      },
      earnings_quality_judgment: {
        summary: evidenceAssessment.message,
        positives: [],
        concerns: [],
      },
      special_situations: {
        corporate_action: corporateAction,
        hard_flags: hardFlags,
        primary_hard_flag: hardFlags[0] || null,
      },
      key_evidence_refs: [],
    };
  }

  const netIncome = getMetricValue(latestAnnual, 'net_income');
  const operatingCashFlow = getMetricValue(latestAnnual, 'operating_cash_flow') ?? toFiniteNumber(snapshot.operatingCashFlowTTM);
  const freeCashFlow = getMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);
  const capex = getMetricValue(latestAnnual, 'capital_expenditures');
  const revenue = getMetricValue(latestAnnual, 'revenue');
  const currentRatio = toFiniteNumber(snapshot.currentRatio);
  const quickRatio = toFiniteNumber(snapshot.quickRatio);
  const debt = toFiniteNumber(snapshot.debt);
  const cash = toFiniteNumber(snapshot.cash);

  const cashConversionRatio = toFiniteNumber(derived?.cash_conversion_ocf_to_net_income);
  const fcfMarginPct = toFiniteNumber(derived?.free_cash_flow_margin_pct);
  const capexToOcfPct = toFiniteNumber(derived?.capex_as_pct_of_ocf);

  const cashConversion = classifyCashConversion(cashConversionRatio);
  const capexBurden = classifyCapexBurden(capexToOcfPct);
  const freeCashFlowProfile = classifyFreeCashFlow(fcfMarginPct);

  const dilutionRisk = scoreKeywordRisk(retrievalResults, [/\bdilution\b/i, /\bshare issuance\b/i, /\bstock[- ]based compensation\b/i, /\bSBC\b/i]);
  const leaseRisk = scoreKeywordRisk(retrievalResults, [/\blease\b/i, /\bright-of-use\b/i, /\boperating lease\b/i]);
  const oneTimeRisk = scoreKeywordRisk(retrievalResults, [/\bnon-recurring\b/i, /\bone-time\b/i, /\brestructuring\b/i, /\bimpairment\b/i]);
  const revenueRecognitionRisk = scoreKeywordRisk(retrievalResults, [/\brevenue recognition\b/i, /\bdeferred revenue\b/i, /\bcontract asset\b/i]);

  const liquidityAssessment = !Number.isFinite(Number(currentRatio))
    ? 'unknown'
    : Number(currentRatio) >= 1.5
      ? 'comfortable'
      : Number(currentRatio) >= 1
        ? 'adequate'
        : 'tight';

  const balanceSheetPressure = Number.isFinite(Number(cash)) && Number.isFinite(Number(debt))
    ? Number(debt) > Number(cash) * 1.5
      ? 'debt_heavier_than_cash'
      : Number(debt) > Number(cash)
        ? 'moderate_net_debt'
        : 'cash_supported'
    : 'unknown';

  let score = 0;
  let scoreParts = 0;
  [cashConversion.score, capexBurden.score, freeCashFlowProfile.score].forEach((value) => {
    score += value;
    scoreParts += 1;
  });
  if (dilutionRisk.hits) score -= Math.min(dilutionRisk.hits * 6, 18);
  if (leaseRisk.hits) score -= Math.min(leaseRisk.hits * 3, 9);
  if (oneTimeRisk.hits) score -= Math.min(oneTimeRisk.hits * 5, 15);
  if (revenueRecognitionRisk.hits) score -= Math.min(revenueRecognitionRisk.hits * 6, 18);
  const normalizedScore = scoreParts ? Math.max(0, Math.min(100, Math.round(score / scoreParts))) : 50;

  const grade = normalizedScore >= 75
    ? 'high'
    : normalizedScore >= 60
      ? 'good'
      : normalizedScore >= 45
        ? 'mixed'
        : 'weak';

  const positives: string[] = [];
  const concerns: string[] = [];

  positives.push(cashConversion.summary);
  positives.push(freeCashFlowProfile.summary);

  if (capexBurden.label === 'heavy' || capexBurden.label === 'very_heavy') {
    concerns.push(capexBurden.summary);
  } else {
    positives.push(capexBurden.summary);
  }

  if (dilutionRisk.hits) concerns.push(`Filing evidence contains ${dilutionRisk.hits} dilution or stock-compensation related references that deserve review.`);
  if (leaseRisk.hits) concerns.push(`Filing evidence contains ${leaseRisk.hits} lease-related references, so leverage may be understated if leases are treated lightly.`);
  if (oneTimeRisk.hits) concerns.push(`Filing evidence contains ${oneTimeRisk.hits} one-time, restructuring, or impairment references that may distort clean earnings power.`);
  if (revenueRecognitionRisk.hits) concerns.push(`Filing evidence contains ${revenueRecognitionRisk.hits} revenue-recognition related references that warrant caution.`);
  if (liquidityAssessment === 'tight') concerns.push('Liquidity looks tight from the current ratio, which raises balance-sheet sensitivity.');
  if (balanceSheetPressure === 'debt_heavier_than_cash') concerns.push('Debt appears materially heavier than cash in the loaded snapshot.');

  const confidence = retrievalResults.length >= 2 && latestAnnual
    ? 'moderate'
    : latestAnnual
      ? 'moderate_low'
      : 'low';

  return {
    symbol: ledgerBase?.symbol || null,
    company_name: ledgerBase?.company_name || null,
    engine: 'earnings_quality_engine',
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: confidence,
    earnings_quality_grade: grade,
    earnings_quality_score: normalizedScore,
    cash_conversion: {
      ratio_ocf_to_net_income: cashConversionRatio,
      ratio_display: toRatioString(cashConversionRatio),
      assessment: cashConversion.label,
      summary: cashConversion.summary,
      operating_cash_flow: operatingCashFlow,
      net_income: netIncome,
    },
    accounting_distortions: {
      one_time_item_risk_hits: oneTimeRisk.hits,
      lease_risk_hits: leaseRisk.hits,
      revenue_recognition_risk_hits: revenueRecognitionRisk.hits,
      potential_distortion_summary: [
        oneTimeRisk.hits ? 'one-time or restructuring terms appear in filing evidence' : null,
        leaseRisk.hits ? 'lease-related terms appear in filing evidence' : null,
        revenueRecognitionRisk.hits ? 'revenue-recognition terms appear in filing evidence' : null,
      ].filter(Boolean),
    },
    dilution_and_capital_structure: {
      dilution_risk_hits: dilutionRisk.hits,
      debt,
      cash,
      balance_sheet_pressure: balanceSheetPressure,
      summary: dilutionRisk.hits
        ? 'Dilution or stock-compensation related language appears in the retrieved filing evidence.'
        : 'No obvious dilution language surfaced in the limited retrieved evidence slice.',
    },
    balance_sheet_pressure: {
      current_ratio: currentRatio,
      quick_ratio: quickRatio,
      liquidity_assessment: liquidityAssessment,
      debt,
      cash,
    },
    reinvestment_and_free_cash_flow: {
      revenue,
      free_cash_flow: freeCashFlow,
      capital_expenditures: capex,
      free_cash_flow_margin_pct: fcfMarginPct,
      free_cash_flow_margin_display: toPctString(fcfMarginPct),
      capex_as_pct_of_ocf: capexToOcfPct,
      capex_as_pct_of_ocf_display: toPctString(capexToOcfPct),
      free_cash_flow_assessment: freeCashFlowProfile.label,
      capex_burden_assessment: capexBurden.label,
    },
    earnings_quality_judgment: {
      summary: grade === 'high'
        ? 'Reported earnings look well supported by cash generation, with no major issues obvious in the current evidence slice.'
        : grade === 'good'
          ? 'Reported earnings look broadly credible, but there are still some areas that warrant routine caution.'
          : grade === 'mixed'
            ? 'Reported earnings are usable, but cash conversion, reinvestment burden, or note-level issues make quality less clean than it appears.'
            : 'Reported earnings quality looks weak or fragile from the current evidence and should be treated cautiously.',
      positives,
      concerns,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    key_evidence_refs: buildEvidenceRefs([
      ...dilutionRisk.matches,
      ...leaseRisk.matches,
      ...oneTimeRisk.matches,
      ...revenueRecognitionRisk.matches,
      ...retrievalResults,
    ]),
  };
}

export function runFinancialAnalysisEngine(ledgerBase: LedgerContextSummary): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const latestQuarterly = ledgerBase?.annual_context?.latest_quarterly || null;
  const derived = ledgerBase?.annual_context?.derived || {};
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: trimString(ledgerBase?.company_name) || trimString(snapshot.companyName) || null,
      engine: 'financial_analysis_engine',
      confidence_level: 'low',
      status: evidenceAssessment.status,
      coverage_tier: evidenceAssessment.coverageTier,
      analysis_mode: evidenceAssessment.analysisMode,
      business_summary: {
        company_name: trimString(ledgerBase?.company_name) || trimString(snapshot.companyName) || null,
        sector: trimString(snapshot.sector),
        industry: trimString(snapshot.industry),
        growth_profile: 'unknown',
        revenue_growth_pct: null,
        revenue_trend_flag: null,
        annual_revenue: null,
        latest_quarter_revenue: null,
        summary: evidenceAssessment.message,
      },
      financial_quality: {
        earnings_quality_grade: 'insufficient_evidence',
        revenue_growth_pct: null,
        gross_margin_pct: null,
        operating_margin_pct: null,
        profit_margin_pct: null,
        return_on_equity_pct: null,
        cash_conversion_ratio: null,
        free_cash_flow_margin_pct: null,
        summary: evidenceAssessment.message,
      },
      financial_risk: {
        current_ratio: null,
        quick_ratio: null,
        debt_to_equity: null,
        cash: null,
        debt: null,
        debt_liquidity_evidence_hits: 0,
        legal_risk_hits: 0,
        concentration_risk_hits: 0,
        summary: evidenceAssessment.message,
      },
      competitive_advantage: {
        moat_rating: 'unknown',
        moat_trend: 'unknown',
        support_hits: 0,
        competition_hits: 0,
        summary: evidenceAssessment.message,
      },
      capital_allocation: {
        posture: 'unknown',
        operating_cash_flow: null,
        free_cash_flow: null,
        capital_expenditures: null,
        capex_as_pct_of_ocf: null,
        shares_outstanding_yoy_change_pct: null,
        recent_financing_flag: null,
        summary: evidenceAssessment.message,
      },
      valuation_method_used: {
        method: 'insufficient_data',
        inputs_used: {},
        summary: evidenceAssessment.message,
      },
      intrinsic_value_conclusion: {
        status: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        enterprise_to_sales: null,
        enterprise_to_sales_display: null,
        free_cash_flow_yield_pct: null,
        summary: evidenceAssessment.message,
      },
      main_risks: [],
      what_would_change_the_view: {
        more_constructive: [],
        more_cautious: [],
      },
      key_evidence_refs: [],
    };
  }

  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);

  const annualRevenue = resolveAnnualRevenue(latestAnnual, snapshot);
  const quarterlyRevenue = getMetricValue(latestQuarterly, 'revenue');
  const operatingIncome = getMetricValue(latestAnnual, 'operating_income');
  const netIncome = getMetricValue(latestAnnual, 'net_income');
  const operatingCashFlow = getMetricValue(latestAnnual, 'operating_cash_flow') ?? toFiniteNumber(snapshot.operatingCashFlowTTM);
  const freeCashFlow = getMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);

  const sector = trimString(snapshot.sector);
  const industry = trimString(snapshot.industry);
  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);
  const revenueGrowthPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const revenueTrendFlag = trimString(snapshot.revenueTrendFlag);
  const grossMarginPct = toFiniteNumber(snapshot.grossMarginPct);
  const operatingMarginPct = toFiniteNumber(snapshot.operatingMarginPct) ?? toFiniteNumber(derived?.operating_margin_pct);
  const profitMarginPct = toFiniteNumber(snapshot.profitMarginPct) ?? toFiniteNumber(derived?.net_margin_pct);
  const returnOnEquityPct = toFiniteNumber(snapshot.returnOnEquityPct);
  const debtToEquity = toFiniteNumber(snapshot.debtToEquity);
  const currentRatio = toFiniteNumber(snapshot.currentRatio);
  const quickRatio = toFiniteNumber(snapshot.quickRatio);
  const cash = toFiniteNumber(snapshot.cash) ?? toFiniteNumber(snapshot.totalCash);
  const debt = toFiniteNumber(snapshot.debt) ?? toFiniteNumber(snapshot.totalDebt);
  const marketCap = toFiniteNumber(snapshot.marketCap);
  const enterpriseValue = toFiniteNumber(snapshot.enterpriseValue);
  const enterpriseToSales = toFiniteNumber(snapshot.enterpriseToSales)
    ?? (Number.isFinite(Number(enterpriseValue)) && Number.isFinite(Number(annualRevenue)) && Number(annualRevenue)
      ? Number(enterpriseValue) / Number(annualRevenue)
      : null);
  const sharesOutstandingYoYChangePct = toFiniteNumber(snapshot.sharesOutstandingYoYChangePct);
  const recentFinancingFlag = Boolean(snapshot.recentFinancingFlag);
  const fcfYieldPct = safeDivide(freeCashFlow, enterpriseValue);
  const fcfYieldPctDisplay = Number.isFinite(Number(fcfYieldPct)) ? `${(Number(fcfYieldPct) * 100).toFixed(2)}%` : null;

  const legalRisk = scoreKeywordRisk(retrievalResults, [/\blegal\b/i, /\blitigation\b/i, /\bregulatory\b/i, /\binvestigation\b/i]);
  const concentrationRisk = scoreKeywordRisk(retrievalResults, [/\bcustomer concentration\b/i, /\bmajor customer\b/i, /\bsupplier concentration\b/i]);
  const debtRisk = scoreKeywordRisk(retrievalResults, [/\bdebt\b/i, /\bcovenant\b/i, /\bliquidity\b/i, /\brefinanc/i]);
  const moatSupport = scoreKeywordRisk(retrievalResults, [/\bbrand\b/i, /\bloyalty\b/i, /\bscale\b/i, /\bnetwork\b/i, /\bswitching cost/i]);
  const competitionRisk = scoreKeywordRisk(retrievalResults, [/\bcompetition\b/i, /\bcompetitive\b/i, /\bpricing pressure\b/i, /\bmargin pressure\b/i]);

  const growthProfile = !Number.isFinite(Number(revenueGrowthPct))
    ? 'unclear'
    : Number(revenueGrowthPct) >= 20
      ? 'high_growth'
      : Number(revenueGrowthPct) >= 8
        ? 'moderate_growth'
        : Number(revenueGrowthPct) >= 0
          ? 'slow_growth'
          : 'declining';

  const moatRating = moatSupport.hits >= 2 && competitionRisk.hits === 0
    ? 'narrow'
    : moatSupport.hits >= 3
      ? 'narrow'
      : 'none_to_narrow';

  const moatTrend = competitionRisk.hits > moatSupport.hits
    ? 'negative'
    : moatSupport.hits
      ? 'stable'
      : 'unclear';

  const capitalAllocationPosture = !Number.isFinite(Number(toFiniteNumber(derived?.capex_as_pct_of_ocf)))
    ? 'mixed'
    : Number(derived?.capex_as_pct_of_ocf) >= 70
      ? 'growth_reinvestment'
      : recentFinancingFlag || (Number.isFinite(Number(sharesOutstandingYoYChangePct)) && Number(sharesOutstandingYoYChangePct) >= 5)
        ? 'externally_supported_growth'
        : 'balanced';

  const valuationJudgment = !Number.isFinite(Number(enterpriseToSales))
    ? 'insufficient_market_context'
    : Number(enterpriseToSales) >= 6 && (!Number.isFinite(Number(fcfYieldPct)) || Number(fcfYieldPct) < 0.02)
      ? 'likely_rich'
      : Number(enterpriseToSales) <= 2.5 && Number.isFinite(Number(fcfYieldPct)) && Number(fcfYieldPct) >= 0.04
        ? 'potentially_attractive'
        : 'unclear_to_fair';

  const mainRisks = cleanList([
    ...hardFlags
      .filter((flag) => flag?.code !== 'pending_acquisition')
      .map((flag) => trimString(flag?.summary))
      .filter(Boolean) as string[],
    corporateAction?.short_thesis_warning || null,
    competitionRisk.hits ? 'Competition or margin-pressure language appears in the filing evidence.' : null,
    debtRisk.hits ? 'Debt, liquidity, or refinancing language appears in the filing evidence.' : null,
    concentrationRisk.hits ? 'Customer or supplier concentration language appears in the filing evidence.' : null,
    legalRisk.hits ? 'Legal or regulatory language appears in the filing evidence.' : null,
    capitalAllocationPosture === 'growth_reinvestment' ? 'Heavy reinvestment means cash generation must keep proving itself.' : null,
    valuationJudgment === 'likely_rich' ? 'The current market multiple leaves less room for operational disappointment.' : null,
    earningsQuality?.earnings_quality_grade === 'weak' ? 'Earnings quality looks weak, which lowers confidence in headline profitability.' : null,
  ], 8);

  const whatWouldChangeMoreConstructive = cleanList([
    'Free cash flow expands materially without proportionate capex growth.',
    Number.isFinite(Number(operatingMarginPct)) && Number(operatingMarginPct) < 15 ? 'Operating margins improve sustainably from current levels.' : null,
    'Evidence shows durable demand and resilient unit economics rather than purely narrative growth.',
    valuationJudgment === 'likely_rich' ? 'The stock trades at a less demanding valuation relative to sales and cash generation.' : null,
  ], 4);

  const whatWouldChangeMoreCautious = cleanList([
    'Cash conversion weakens relative to reported earnings.',
    'Liquidity, covenant, or refinancing language becomes more prominent.',
    Number.isFinite(Number(revenueGrowthPct)) && Number(revenueGrowthPct) > 0 ? 'Revenue growth slows without offsetting margin improvement.' : null,
    Number.isFinite(Number(sharesOutstandingYoYChangePct)) && Number(sharesOutstandingYoYChangePct) > 2 ? 'Share count expansion continues or financing pressure grows.' : null,
  ], 4);

  const confidenceLevel = buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
    revenueGrowthPct,
    operatingMarginPct,
    enterpriseToSales,
  ].filter((value) => Number.isFinite(Number(value))).length);

  return {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'financial_analysis_engine',
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: confidenceLevel,
    business_summary: {
      company_name: companyName,
      sector,
      industry,
      growth_profile: growthProfile,
      revenue_growth_pct: revenueGrowthPct,
      revenue_trend_flag: revenueTrendFlag,
      annual_revenue: annualRevenue,
      latest_quarter_revenue: quarterlyRevenue,
      summary: companyName && (sector || industry)
        ? `${companyName} operates in ${industry || sector}${industry && sector ? ` within the broader ${sector} sector` : ''} and currently screens as a ${growthProfile.replace(/_/g, ' ')} business.${corporateAction ? ` It is also in a ${String(corporateAction.label || 'special situation').toLowerCase()}, so the stock is trading more like a deal spread than a normal standalone equity.` : ''}`
        : 'The loaded context supports a high-level business read, but the profile is still somewhat generic without deeper note-level detail.',
    },
    financial_quality: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      revenue_growth_pct: revenueGrowthPct,
      gross_margin_pct: grossMarginPct,
      operating_margin_pct: operatingMarginPct,
      profit_margin_pct: profitMarginPct,
      return_on_equity_pct: returnOnEquityPct,
      cash_conversion_ratio: earningsQuality?.cash_conversion?.ratio_ocf_to_net_income ?? null,
      free_cash_flow_margin_pct: earningsQuality?.reinvestment_and_free_cash_flow?.free_cash_flow_margin_pct ?? null,
      summary: earningsQuality?.earnings_quality_grade === 'high'
        ? 'Financial quality looks strong: margins and cash conversion broadly support the reported economics.'
        : earningsQuality?.earnings_quality_grade === 'good'
          ? 'Financial quality looks solid overall, though some areas still warrant routine caution.'
          : earningsQuality?.earnings_quality_grade === 'mixed'
            ? 'Financial quality is usable but uneven, with reinvestment burden or accounting noise limiting how clean the earnings picture looks.'
            : 'Financial quality looks weak or fragile from the currently loaded evidence.',
    },
    financial_risk: {
      current_ratio: currentRatio,
      quick_ratio: quickRatio,
      debt_to_equity: debtToEquity,
      cash,
      debt,
      debt_liquidity_evidence_hits: debtRisk.hits,
      legal_risk_hits: legalRisk.hits,
      concentration_risk_hits: concentrationRisk.hits,
      summary: Number.isFinite(Number(currentRatio)) && Number(currentRatio) >= 1.5 && (!Number.isFinite(Number(debtToEquity)) || Number(debtToEquity) < 150)
        ? 'Near-term balance-sheet stress does not look obvious from the loaded liquidity and leverage context.'
        : 'Balance-sheet risk is not catastrophic from the current data, but leverage, liquidity, or note-level obligations still deserve caution.',
    },
    competitive_advantage: {
      moat_rating: moatRating,
      moat_trend: moatTrend,
      support_hits: moatSupport.hits,
      competition_hits: competitionRisk.hits,
      summary: moatRating === 'narrow'
        ? 'The current evidence supports at most a narrow advantage rather than a deeply protected franchise.'
        : 'The current evidence does not support a strong moat claim; competition still looks like an important constraint.',
    },
    capital_allocation: {
      posture: capitalAllocationPosture,
      operating_cash_flow: operatingCashFlow,
      free_cash_flow: freeCashFlow,
      capital_expenditures: getMetricValue(latestAnnual, 'capital_expenditures'),
      capex_as_pct_of_ocf: earningsQuality?.reinvestment_and_free_cash_flow?.capex_as_pct_of_ocf ?? null,
      shares_outstanding_yoy_change_pct: sharesOutstandingYoYChangePct,
      recent_financing_flag: recentFinancingFlag,
      summary: capitalAllocationPosture === 'growth_reinvestment'
        ? 'Management appears to be leaning into growth and reinvestment rather than harvesting cash.'
        : capitalAllocationPosture === 'externally_supported_growth'
          ? 'Capital allocation still appears growth-oriented, with some signs that external capital or dilution may matter.'
          : 'Capital allocation looks more balanced, though the evidence slice is still limited.',
    },
    valuation_method_used: {
      method: 'high_level_multiples_sanity_check',
      inputs_used: {
        enterprise_value: enterpriseValue,
        market_cap: marketCap,
        enterprise_to_sales: enterpriseToSales,
        free_cash_flow: freeCashFlow,
        free_cash_flow_yield_pct: fcfYieldPctDisplay,
      },
      summary: 'This engine currently uses filing-backed cash-flow context plus market multiple sanity checks. It is not yet a full multi-stage DCF engine.',
    },
    intrinsic_value_conclusion: {
      status: valuationJudgment === 'likely_rich' ? 'preliminarily_rich' : valuationJudgment === 'potentially_attractive' ? 'potentially_attractive' : 'insufficient_precision',
      summary: valuationJudgment === 'likely_rich'
        ? corporateAction?.summary || 'The business may be sound, but the current valuation appears demanding relative to current cash generation.'
        : valuationJudgment === 'potentially_attractive'
          ? 'The current valuation may be attractive relative to current revenue and cash-flow support, though this still needs a real DCF pass.'
          : 'There is not enough precision yet to pin down intrinsic value tightly from this engine alone.',
    },
    price_vs_value_judgment: {
      judgment: valuationJudgment,
      enterprise_to_sales: enterpriseToSales,
      enterprise_to_sales_display: toMultipleString(enterpriseToSales),
      free_cash_flow_yield_pct: fcfYieldPctDisplay,
      summary: valuationJudgment === 'likely_rich'
        ? corporateAction
          ? 'Normal price-versus-value framing is secondary here because the stock is trading as a pending acquisition rather than a free standalone business.'
          : 'Price appears to be demanding more future success than current cash generation alone would justify.'
        : valuationJudgment === 'potentially_attractive'
          ? 'Price may be leaving room for upside if the current cash generation and growth hold up.'
          : 'Price versus value remains somewhat ambiguous without a deeper valuation model.',
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    main_risks: mainRisks,
    what_would_change_the_view: {
      more_constructive: whatWouldChangeMoreConstructive,
      more_cautious: whatWouldChangeMoreCautious,
    },
    key_evidence_refs: buildEvidenceRefs([
      ...competitionRisk.matches,
      ...debtRisk.matches,
      ...concentrationRisk.matches,
      ...legalRisk.matches,
      ...moatSupport.matches,
      ...retrievalResults,
    ]),
  };
}

type DcfEngineOptions = {
  revenue_growth_near_term_pct?: number | null;
  target_operating_margin_pct?: number | null;
  discount_rate_pct?: number | null;
  terminal_growth_pct?: number | null;
  forecast_years?: number | null;
};

export function runFinancialCompanyValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: trimString(ledgerBase?.company_name) || trimString(snapshot.companyName) || null,
      engine: 'financial_company_valuation_engine',
      valuation_method: 'financial_company_roe_book_value',
      confidence_level: 'low',
      status: evidenceAssessment.status,
      coverage_tier: evidenceAssessment.coverageTier,
      analysis_mode: evidenceAssessment.analysisMode,
      summary: evidenceAssessment.message,
      fair_value_range: null,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      scenario_outputs: [],
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
    };
  }

  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const financialAnalysis = runFinancialAnalysisEngine(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);
  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);
  const currentPrice = toFiniteNumber(snapshot.currentPrice);
  const marketCap = toFiniteNumber(snapshot.marketCap);
  const sharesOutstanding = toFiniteNumber(snapshot.sharesOutstanding)
    ?? (Number.isFinite(Number(marketCap)) && Number.isFinite(Number(currentPrice)) && Number(currentPrice)
      ? Number(marketCap) / Number(currentPrice)
      : null);
  const netIncome = getMetricValue(latestAnnual, 'net_income');
  const debtToEquity = toFiniteNumber(snapshot.debtToEquity);
  const revenueGrowthObservedPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const rawRoePct = toFiniteNumber(snapshot.returnOnEquityPct);
  const annualEquity = getFirstMetricValue(latestAnnual, [
    'stockholders_equity',
    'equity',
    'common_stock_equity',
    'total_equity',
    'stockholders_equity_including_noncontrolling_interest',
  ]);
  const totalDebt = toFiniteNumber(snapshot.totalDebt) ?? toFiniteNumber(snapshot.debt);
  const inferredEquityFromLeverage = Number.isFinite(Number(totalDebt)) && Number.isFinite(Number(debtToEquity)) && Number(debtToEquity) > 0
    ? Number(totalDebt) / Number(debtToEquity)
    : null;
  const inferredEquityFromRoe = Number.isFinite(Number(netIncome)) && Number.isFinite(Number(rawRoePct)) && Number(rawRoePct) > 0
    ? Number(netIncome) / (Number(rawRoePct) / 100)
    : null;
  const totalEquity = [
    toFiniteNumber((snapshot as any).equity),
    annualEquity,
    inferredEquityFromLeverage,
    inferredEquityFromRoe,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const bookValuePerShare = [
    toFiniteNumber((snapshot as any).bookValuePerShare),
    Number.isFinite(Number(currentPrice)) && Number.isFinite(Number((snapshot as any).priceToBook)) && Number((snapshot as any).priceToBook) > 0
      ? Number(currentPrice) / Number((snapshot as any).priceToBook)
      : null,
    Number.isFinite(Number(totalEquity)) && Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0
      ? Number(totalEquity) / Number(sharesOutstanding)
      : null,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const normalizedRoePct = [
    rawRoePct,
    Number.isFinite(Number(netIncome)) && Number.isFinite(Number(totalEquity)) && Number(totalEquity) > 0
      ? (Number(netIncome) / Number(totalEquity)) * 100
      : null,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const normalizedEps = [
    toFiniteNumber((snapshot as any).trailingEPS),
    toFiniteNumber((snapshot as any).earningsPerShare),
    Number.isFinite(Number(netIncome)) && Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0
      ? Number(netIncome) / Number(sharesOutstanding)
      : null,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;

  const qualityGrade = trimString(earningsQuality?.earnings_quality_grade) || 'mixed';
  const defaultCostOfEquityPct = clamp(
    9
      + (Number.isFinite(Number(debtToEquity)) && Number(debtToEquity) >= 10 ? 2.5 : Number.isFinite(Number(debtToEquity)) && Number(debtToEquity) >= 5 ? 1.5 : Number.isFinite(Number(debtToEquity)) && Number(debtToEquity) >= 2 ? 0.75 : 0)
      + (qualityGrade === 'weak' ? 1 : qualityGrade === 'mixed' ? 0.5 : 0),
    7.5,
    16,
  );
  const costOfEquityPct = clamp(
    hasFiniteNumber(options.discount_rate_pct) ? Number(options.discount_rate_pct) : defaultCostOfEquityPct,
    6,
    18,
  );
  const sustainableGrowthPct = clamp(
    hasFiniteNumber(options.terminal_growth_pct)
      ? Number(options.terminal_growth_pct)
      : Number.isFinite(Number(revenueGrowthObservedPct))
        ? Number(revenueGrowthObservedPct) * 0.35
        : 2.5,
    0.5,
    Math.max(0.5, costOfEquityPct - 1.5),
  );

  const missingInputs = cleanList([
    Number.isFinite(Number(bookValuePerShare)) ? null : 'book value per share',
    Number.isFinite(Number(normalizedRoePct)) ? null : 'normalized return on equity',
    Number.isFinite(Number(sharesOutstanding)) ? null : 'shares outstanding',
  ], 8);

  if (missingInputs.length) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'financial_company_valuation_engine',
      valuation_method: 'financial_company_roe_book_value',
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      summary: `A financial-company valuation could not be completed because key inputs are missing: ${missingInputs.join(', ')}.`,
      fair_value_range: null,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      scenario_outputs: [],
      price_vs_value_judgment: {
        judgment: 'insufficient_inputs',
        summary: 'There is not enough structured book-value or ROE input to produce a defensible financial-company valuation.',
      },
      recommended_methods: [
        'price_to_book',
        'normalized_roe_vs_cost_of_equity',
        'earnings_power',
        'dividend_or_excess_capital_framework',
      ],
      supporting_context: {
        shares_outstanding: sharesOutstanding,
        shares_outstanding_source: trimString(snapshot.sharesOutstandingSource),
        total_equity: totalEquity,
        normalized_return_on_equity_pct: normalizedRoePct,
      },
      special_situations: {
        corporate_action: corporateAction,
        hard_flags: hardFlags,
        primary_hard_flag: hardFlags[0] || null,
      },
    };
  }

  const scenarioConfigs = [
    {
      name: 'bear',
      normalizedRoePct: clamp(Number(normalizedRoePct) - 2.5, 2, 30),
      costOfEquityPct: clamp(costOfEquityPct + 1, 6, 20),
      sustainableGrowthPct: clamp(sustainableGrowthPct - 0.5, 0.5, 6),
    },
    {
      name: 'base',
      normalizedRoePct: Number(normalizedRoePct),
      costOfEquityPct,
      sustainableGrowthPct,
    },
    {
      name: 'bull',
      normalizedRoePct: clamp(Number(normalizedRoePct) + 2.5, 2, 35),
      costOfEquityPct: clamp(costOfEquityPct - 1, 6, 20),
      sustainableGrowthPct: clamp(sustainableGrowthPct + 0.5, 0.5, 6),
    },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const roe = scenario.normalizedRoePct / 100;
    const growth = scenario.sustainableGrowthPct / 100;
    const costOfEquity = scenario.costOfEquityPct / 100;
    const justifiedPriceToBook = costOfEquity > growth
      ? clamp((roe - growth) / (costOfEquity - growth), 0.25, 4.5)
      : null;
    const fairValuePerShare = justifiedPriceToBook != null
      ? Number(bookValuePerShare) * justifiedPriceToBook
      : null;
    const earningsPowerFairValue = Number.isFinite(Number(normalizedEps))
      ? Number(normalizedEps) * clamp(((roe / costOfEquity) * 12), 5, 20)
      : null;

    return {
      scenario: scenario.name,
      assumptions: {
        normalized_return_on_equity_pct: scenario.normalizedRoePct,
        cost_of_equity_pct: scenario.costOfEquityPct,
        sustainable_growth_pct: scenario.sustainableGrowthPct,
        book_value_per_share: Number(bookValuePerShare),
      },
      justified_price_to_book: justifiedPriceToBook != null ? Number(justifiedPriceToBook.toFixed(2)) : null,
      fair_value_per_share: fairValuePerShare != null ? Number(fairValuePerShare.toFixed(2)) : null,
      earnings_power_fair_value_per_share: earningsPowerFairValue != null ? Number(earningsPowerFairValue.toFixed(2)) : null,
    };
  });

  const bear = scenarioOutputs.find((row) => row.scenario === 'bear') || null;
  const base = scenarioOutputs.find((row) => row.scenario === 'base') || null;
  const bull = scenarioOutputs.find((row) => row.scenario === 'bull') || null;
  const lowFairValue = bear?.fair_value_per_share ?? null;
  const midFairValue = base?.fair_value_per_share ?? null;
  const highFairValue = bull?.fair_value_per_share ?? null;
  const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(midFairValue)) && Number(currentPrice)
    ? ((Number(midFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
    : null;
  const priceVsValueJudgment = buildValuationPriceJudgment(currentPrice, midFairValue);

  return {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'financial_company_valuation_engine',
    valuation_method: 'financial_company_roe_book_value',
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
      bookValuePerShare,
      normalizedRoePct,
      currentPrice,
      sharesOutstanding,
    ].filter((value) => Number.isFinite(Number(value))).length),
    normalized_book_value_base: {
      book_value_per_share: Number(bookValuePerShare),
      total_equity: totalEquity,
      normalized_return_on_equity_pct: normalizedRoePct,
      normalized_eps: normalizedEps,
      shares_outstanding: sharesOutstanding,
      current_price: currentPrice,
    },
    base_case_assumptions: base?.assumptions || null,
    bear_case_assumptions: bear?.assumptions || null,
    bull_case_assumptions: bull?.assumptions || null,
    scenario_outputs: scenarioOutputs,
    fair_value_range: {
      low_per_share: lowFairValue,
      mid_per_share: midFairValue,
      high_per_share: highFairValue,
      current_price: currentPrice,
      current_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
      low_display: toMoneyString(lowFairValue),
      mid_display: toMoneyString(midFairValue),
      high_display: toMoneyString(highFairValue),
    },
    key_sensitivities: [
      `Book value per share of about ${toMoneyString(bookValuePerShare)}.`,
      `Normalized ROE of about ${toPctString(normalizedRoePct)} versus cost of equity of about ${toPctString(costOfEquityPct)}.`,
      'Funding structure, credit quality, and capital strength matter more here than industrial free cash flow.',
    ],
    sensitivity_notes: [
      'Small changes in normalized ROE and cost of equity can move justified price-to-book materially.',
      'Financial-company valuation is more sensitive to book value quality, credit losses, and capital strength than to reported free cash flow.',
    ],
    price_vs_value_judgment: {
      judgment: priceVsValueJudgment,
      summary: priceVsValueJudgment === 'undervalued'
        ? 'The financial-company engine suggests the stock is trading below a reasonable book-value / ROE-based estimate.'
        : priceVsValueJudgment === 'overvalued'
          ? 'The stock is trading above what the current book value and normalized ROE appear to justify.'
          : priceVsValueJudgment === 'roughly_fair'
            ? 'The current price is in the same rough neighborhood as a book-value / ROE-based estimate.'
            : 'Price versus value could not be judged cleanly from the current financial-company inputs.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
      shares_outstanding: sharesOutstanding,
      shares_outstanding_source: trimString(snapshot.sharesOutstandingSource),
      book_value_per_share: bookValuePerShare,
      total_equity: totalEquity,
      normalized_return_on_equity_pct: normalizedRoePct,
      normalized_eps: normalizedEps,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    recommended_methods: [
      'price_to_book',
      'normalized_roe_vs_cost_of_equity',
      'earnings_power',
      'dividend_or_excess_capital_framework',
    ],
  };
}

export function runDcfValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  if (resolveValuationEngineClass(ledgerBase) === 'roe_book_value') {
    return runFinancialCompanyValuationEngine(ledgerBase, options);
  }
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const derived = ledgerBase?.annual_context?.derived || {};
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: trimString(ledgerBase?.company_name) || trimString(snapshot.companyName) || null,
      engine: 'dcf_engine',
      valuation_method: 'simplified_fcfe_dcf',
      confidence_level: 'low',
      status: evidenceAssessment.status,
      coverage_tier: evidenceAssessment.coverageTier,
      analysis_mode: evidenceAssessment.analysisMode,
      summary: evidenceAssessment.message,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      fair_value_range: null,
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
    };
  }

  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const financialAnalysis = runFinancialAnalysisEngine(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);
  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);

  const annualRevenue = resolveAnnualRevenue(latestAnnual, snapshot);
  const operatingMarginPct = [
    toFiniteNumber(derived?.operating_margin_pct),
    toFiniteNumber(snapshot.operatingMarginPct),
  ].filter((value) => Number.isFinite(Number(value))).sort((a, b) => Number(b) - Number(a))[0] ?? null;
  const freeCashFlow = getMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);
  const currentPrice = toFiniteNumber(snapshot.currentPrice);
  const marketCap = toFiniteNumber(snapshot.marketCap);
  const sharesOutstanding = toFiniteNumber(snapshot.sharesOutstanding)
    ?? (Number.isFinite(Number(marketCap)) && Number.isFinite(Number(currentPrice)) && Number(currentPrice)
      ? Number(marketCap) / Number(currentPrice)
      : null);
  const revenueGrowthObservedPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const currentFcfMarginPct = Number.isFinite(Number(annualRevenue)) && Number(annualRevenue)
    ? (Number(freeCashFlow) / Number(annualRevenue)) * 100
    : toFiniteNumber(derived?.free_cash_flow_margin_pct);

  const qualityGrade = trimString(earningsQuality?.earnings_quality_grade) || 'mixed';
  const qualityFactor = qualityGrade === 'high'
    ? 1.0
    : qualityGrade === 'good'
      ? 0.95
      : qualityGrade === 'mixed'
        ? 0.85
        : 0.7;

  const normalizedFcf = Number.isFinite(Number(freeCashFlow))
    ? Number(freeCashFlow) * qualityFactor
    : null;

  const conversionRatio = Number.isFinite(Number(currentFcfMarginPct)) && Number.isFinite(Number(operatingMarginPct)) && Number(operatingMarginPct)
    ? clamp(Number(currentFcfMarginPct) / Number(operatingMarginPct), 0.25, 0.85)
    : 0.5;

  const baseNearTermGrowthPct = clamp(
    hasFiniteNumber(options.revenue_growth_near_term_pct)
      ? Number(options.revenue_growth_near_term_pct)
      : Number.isFinite(Number(revenueGrowthObservedPct))
        ? Number(revenueGrowthObservedPct) * 0.7
        : 8,
    1,
    25,
  );

  const baseTargetOperatingMarginPct = clamp(
    hasFiniteNumber(options.target_operating_margin_pct)
      ? Number(options.target_operating_margin_pct)
      : Number.isFinite(Number(operatingMarginPct))
        ? Math.max(Number(operatingMarginPct) + 3, 10)
        : 12,
    4,
    35,
  );

  const baseTargetFcfMarginPct = clamp(
    baseTargetOperatingMarginPct * Math.max(conversionRatio, 0.55),
    2,
    Math.max(4, baseTargetOperatingMarginPct),
  );

  const defaultDiscountRatePct = clamp(
    9
      + (qualityGrade === 'weak' ? 2 : qualityGrade === 'mixed' ? 1 : 0)
      + (Number.isFinite(Number(snapshot.currentRatio)) && Number(snapshot.currentRatio) < 1 ? 1 : 0)
      + (financialAnalysis?.price_vs_value_judgment?.judgment === 'likely_rich' ? 0.5 : 0),
    8,
    14,
  );
  const discountRatePct = clamp(
    hasFiniteNumber(options.discount_rate_pct)
      ? Number(options.discount_rate_pct)
      : defaultDiscountRatePct,
    6,
    18,
  );

  const terminalGrowthPct = clamp(
    hasFiniteNumber(options.terminal_growth_pct)
      ? Number(options.terminal_growth_pct)
      : 3,
    1,
    Math.max(1.5, discountRatePct - 2.5),
  );

  const forecastYears = clamp(
    hasFiniteNumber(options.forecast_years)
      ? Math.trunc(Number(options.forecast_years))
      : 7,
    4,
    12,
  );

  const missingInputs = cleanList([
    Number.isFinite(Number(annualRevenue)) ? null : 'annual revenue',
    Number.isFinite(Number(normalizedFcf)) ? null : 'normalized free cash flow',
    Number.isFinite(Number(sharesOutstanding)) ? null : 'shares outstanding',
  ], 8);

  if (missingInputs.length) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'dcf_engine',
      valuation_method: 'simplified_fcfe_dcf',
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      summary: `A numeric DCF could not be completed because key inputs are missing: ${missingInputs.join(', ')}.`,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      fair_value_range: null,
      price_vs_value_judgment: {
        judgment: 'insufficient_inputs',
        summary: 'There is not enough structured financial input to produce a defensible DCF output.',
      },
    };
  }

  const scenarioConfigs = [
    {
      name: 'bear',
      revenueGrowthPct: clamp(baseNearTermGrowthPct - 4, 0.5, 20),
      targetFcfMarginPct: clamp(baseTargetFcfMarginPct - 1.5, 1, 20),
      discountRatePct: clamp(discountRatePct + 1, 6, 18),
      terminalGrowthPct: clamp(terminalGrowthPct - 0.5, 1, 5),
    },
    {
      name: 'base',
      revenueGrowthPct: baseNearTermGrowthPct,
      targetFcfMarginPct: baseTargetFcfMarginPct,
      discountRatePct,
      terminalGrowthPct,
    },
    {
      name: 'bull',
      revenueGrowthPct: clamp(baseNearTermGrowthPct + 4, 1, 28),
      targetFcfMarginPct: clamp(baseTargetFcfMarginPct + 1.5, 2, 24),
      discountRatePct: clamp(discountRatePct - 1, 6, 18),
      terminalGrowthPct: clamp(terminalGrowthPct + 0.5, 1, 5),
    },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const yearlyForecast = [];
    let revenue = Number(annualRevenue);
    let pvOfCashFlows = 0;

    for (let year = 1; year <= forecastYears; year += 1) {
      const fadeRatio = forecastYears === 1 ? 1 : (year - 1) / (forecastYears - 1);
      const growthPct = interpolate(scenario.revenueGrowthPct, scenario.terminalGrowthPct, fadeRatio);
      const fcfMarginPct = interpolate(
        Number.isFinite(Number(currentFcfMarginPct)) ? Number(currentFcfMarginPct) : scenario.targetFcfMarginPct * 0.7,
        scenario.targetFcfMarginPct,
        year / forecastYears,
      );
      revenue = revenue * (1 + growthPct / 100);
      const freeCashFlowYear = revenue * (fcfMarginPct / 100);
      const discountFactor = Math.pow(1 + scenario.discountRatePct / 100, year);
      const presentValue = freeCashFlowYear / discountFactor;
      pvOfCashFlows += presentValue;
      yearlyForecast.push({
        year,
        revenue,
        revenue_growth_pct: growthPct,
        free_cash_flow_margin_pct: fcfMarginPct,
        free_cash_flow: freeCashFlowYear,
        present_value: presentValue,
      });
    }

    const finalYear = yearlyForecast[yearlyForecast.length - 1];
    const terminalCashFlow = finalYear.free_cash_flow * (1 + scenario.terminalGrowthPct / 100);
    const spread = scenario.discountRatePct - scenario.terminalGrowthPct;
    const terminalValue = spread > 0.5 ? terminalCashFlow / (spread / 100) : null;
    const presentValueOfTerminal = terminalValue
      ? terminalValue / Math.pow(1 + scenario.discountRatePct / 100, forecastYears)
      : null;
    const equityValue = pvOfCashFlows + (presentValueOfTerminal || 0);
    const fairValuePerShare = Number(sharesOutstanding) ? equityValue / Number(sharesOutstanding) : null;

    return {
      scenario: scenario.name,
      assumptions: {
        revenue_growth_near_term_pct: scenario.revenueGrowthPct,
        target_free_cash_flow_margin_pct: scenario.targetFcfMarginPct,
        discount_rate_pct: scenario.discountRatePct,
        terminal_growth_pct: scenario.terminalGrowthPct,
        forecast_years: forecastYears,
      },
      yearly_forecast: yearlyForecast.map((row) => ({
        year: row.year,
        revenue: Math.round(row.revenue),
        revenue_growth_pct: Number(row.revenue_growth_pct.toFixed(2)),
        free_cash_flow_margin_pct: Number(row.free_cash_flow_margin_pct.toFixed(2)),
        free_cash_flow: Math.round(row.free_cash_flow),
        present_value: Math.round(row.present_value),
      })),
      present_value_of_explicit_cash_flows: Math.round(pvOfCashFlows),
      present_value_of_terminal_value: presentValueOfTerminal ? Math.round(presentValueOfTerminal) : null,
      equity_value: Math.round(equityValue),
      fair_value_per_share: fairValuePerShare ? Number(fairValuePerShare.toFixed(2)) : null,
    };
  });

  const bear = scenarioOutputs.find((row) => row.scenario === 'bear') || null;
  const base = scenarioOutputs.find((row) => row.scenario === 'base') || null;
  const bull = scenarioOutputs.find((row) => row.scenario === 'bull') || null;
  const lowFairValue = bear?.fair_value_per_share ?? null;
  const midFairValue = base?.fair_value_per_share ?? null;
  const highFairValue = bull?.fair_value_per_share ?? null;

  const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(midFairValue)) && Number(currentPrice)
    ? ((Number(midFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
    : null;

  const priceVsValueJudgment = buildValuationPriceJudgment(currentPrice, midFairValue);

  const sensitivityNotes = cleanList([
    ...hardFlags
      .filter((flag) => flag?.code !== 'pending_acquisition')
      .map((flag) => trimString(flag?.summary))
      .filter(Boolean) as string[],
    corporateAction?.summary || null,
    'Fair value is highly sensitive to the target free cash flow margin.',
    'Near-term revenue growth assumptions materially affect the valuation range.',
    qualityGrade === 'mixed' || qualityGrade === 'weak'
      ? 'Earnings quality concerns reduce confidence in the starting cash-flow base.'
      : null,
    retrievalResults.length < 2
      ? 'Note-level evidence is still light, so lease, covenant, or one-time adjustments may be understated.'
      : null,
  ], 6);

  const confidenceLevel = missingInputs.length
    ? 'low'
    : buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
      normalizedFcf,
      currentFcfMarginPct,
      currentPrice,
      sharesOutstanding,
    ].filter((value) => Number.isFinite(Number(value))).length);

  return {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'dcf_engine',
    valuation_method: 'simplified_fcfe_dcf',
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: confidenceLevel,
    normalized_cash_flow_base: {
      reported_free_cash_flow: freeCashFlow,
      quality_adjusted_free_cash_flow: normalizedFcf,
      quality_adjustment_factor: qualityFactor,
      annual_revenue: annualRevenue,
      current_free_cash_flow_margin_pct: currentFcfMarginPct,
      current_operating_margin_pct: operatingMarginPct,
      shares_outstanding: sharesOutstanding,
      current_price: currentPrice,
    },
    base_case_assumptions: base?.assumptions || null,
    bear_case_assumptions: bear?.assumptions || null,
    bull_case_assumptions: bull?.assumptions || null,
    scenario_outputs: scenarioOutputs,
    fair_value_range: {
      low_per_share: lowFairValue,
      mid_per_share: midFairValue,
      high_per_share: highFairValue,
      current_price: currentPrice,
      current_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
      low_display: toMoneyString(lowFairValue),
      mid_display: toMoneyString(midFairValue),
      high_display: toMoneyString(highFairValue),
    },
    key_sensitivities: sensitivityNotes,
    sensitivity_notes: sensitivityNotes,
    price_vs_value_judgment: {
      judgment: priceVsValueJudgment,
      summary: priceVsValueJudgment === 'undervalued'
        ? corporateAction
          ? `Standalone DCF suggests upside, but the stock is currently governed primarily by pending acquisition terms rather than ordinary standalone valuation. ${corporateAction.summary}`
          : 'The DCF midpoint sits materially above the current price.'
        : priceVsValueJudgment === 'overvalued'
          ? corporateAction
            ? `Standalone DCF sits below the current price, but the more important reality is that this stock is trading against a signed acquisition. ${corporateAction.short_thesis_warning}`
            : 'The DCF midpoint sits materially below the current price.'
          : priceVsValueJudgment === 'roughly_fair'
            ? 'The current price is in the same rough neighborhood as the DCF midpoint.'
            : 'Price versus value could not be judged cleanly from the current context.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
  };
}

export function runValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  return runDcfValuationEngine(ledgerBase, options);
}
