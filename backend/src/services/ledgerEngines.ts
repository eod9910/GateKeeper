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
  return entry && typeof entry === 'object' ? toFiniteNumber(entry.value) : null;
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

export function runEarningsQualityEngine(ledgerBase: LedgerContextSummary): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const derived = ledgerBase?.annual_context?.derived || {};
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];

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

  const earningsQuality = runEarningsQualityEngine(ledgerBase);

  const annualRevenue = getMetricValue(latestAnnual, 'revenue');
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
        ? `${companyName} operates in ${industry || sector}${industry && sector ? ` within the broader ${sector} sector` : ''} and currently screens as a ${growthProfile.replace(/_/g, ' ')} business.`
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
        ? 'The business may be sound, but the current valuation appears demanding relative to current cash generation.'
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
        ? 'Price appears to be demanding more future success than current cash generation alone would justify.'
        : valuationJudgment === 'potentially_attractive'
          ? 'Price may be leaving room for upside if the current cash generation and growth hold up.'
          : 'Price versus value remains somewhat ambiguous without a deeper valuation model.',
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

export function runDcfValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const derived = ledgerBase?.annual_context?.derived || {};
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];

  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const financialAnalysis = runFinancialAnalysisEngine(ledgerBase);

  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);
  const annualRevenue = getMetricValue(latestAnnual, 'revenue');
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

  const priceVsValueJudgment = !Number.isFinite(Number(upsidePctToMid))
    ? 'insufficient_price_context'
    : Number(upsidePctToMid) >= 20
      ? 'undervalued'
      : Number(upsidePctToMid) <= -20
        ? 'overvalued'
        : 'roughly_fair';

  const sensitivityNotes = cleanList([
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
        ? 'The DCF midpoint sits materially above the current price.'
        : priceVsValueJudgment === 'overvalued'
          ? 'The DCF midpoint sits materially below the current price.'
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
  };
}
