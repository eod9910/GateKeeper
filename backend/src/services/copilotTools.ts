import fetch from 'node-fetch';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TradingContext, AIRole } from './visionService';
import { runEarningsQualityEngine, runFinancialAnalysisEngine, runValuationEngine } from './ledgerEngines';
import { shouldVerifySpecialSituationWeb, verifySpecialSituationWeb } from './specialSituationWebVerifier';
import {
  listTradableUniverseScreenRows,
  type ConsumerCycleBucket,
  type MacroRegimePreference,
  type SymbolTheme,
  type TradableUniverseScreenRow,
  type ValuationState,
} from './symbolCatalog';

export type WorkspaceAnalystId =
  | 'scanner_copilot'
  | 'pattern_analyst'
  | 'technical_analyst'
  | 'financial_analyst';

type ToolSchema = {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
};

type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolSchema;
  };
};

type CopilotToolResult = {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
};

type UniverseScreenDirection = 'long' | 'short';

type UniverseFundamentalsSnapshot = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  currentPrice: number | null;
  marketCap: number | null;
  averageVolume: number | null;
  relativeVolume: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  netCash: number | null;
  operatingCashFlowTTM: number | null;
  freeCashFlowTTM: number | null;
  dilutionFlag: boolean | null;
  recentFinancingFlag: boolean | null;
  survivabilityScore: number | null;
  trendScore: number | null;
  tacticalScore: number | null;
  reportedExecutionScore: number | null;
  forwardExpectationsScore: number | null;
  positioningScore: number | null;
  revenueGrowthPct: number | null;
  earningsGrowthPct: number | null;
};

type UniverseScreenCandidate = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  direction: UniverseScreenDirection;
  compositeScore: number;
  valuationState: ValuationState | null;
  valuationGapPct: number | null;
  fairValueMid: number | null;
  price: number | null;
  valuationQualityGrade: string | null;
  valuationQualityScore: number | null;
  coverageMode: string | null;
  consumerCycleBucket: ConsumerCycleBucket | null;
  macroRegimePreference: MacroRegimePreference | null;
  themes: SymbolTheme[];
  optionable: boolean | null;
  dollarVolume: number | null;
  balanceSheet: {
    debtToEquity: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    totalCash: number | null;
    totalDebt: number | null;
    netCash: number | null;
  };
  execution: {
    survivabilityScore: number | null;
    reportedExecutionScore: number | null;
    forwardExpectationsScore: number | null;
    trendScore: number | null;
    tacticalScore: number | null;
    revenueGrowthPct: number | null;
    earningsGrowthPct: number | null;
    dilutionFlag: boolean | null;
    recentFinancingFlag: boolean | null;
    freeCashFlowTTM: number | null;
    operatingCashFlowTTM: number | null;
  };
  reasons: string[];
};

const SCANNER_TOOL_ROLES: AIRole[] = ['pattern_analyst', 'contextual_ranker'];
const WORKSPACE_SCANNER_ANALYSTS: WorkspaceAnalystId[] = [
  'scanner_copilot',
  'pattern_analyst',
  'technical_analyst',
];
const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEDGER_HYDRATION_SCRIPT = path.resolve(REPO_ROOT, 'backend', 'scripts', 'hydrate_ledger_company.py');
const LEDGER_HARD_FLAG_QUERY = 'merger acquisition definitive agreement merger agreement going private take private acquired by stockholders to receive contingent value right CVR expected to close per share cash consideration chapter 11 going concern covenant breach default forbearance deficiency notice delist restatement cannot rely on material weakness auditor resignation at-the-market offering PIPE convertible notes subpoena warning letter product recall';

function trimString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreBucketValue(value: number | null | undefined, min: number, max: number): number {
  if (!Number.isFinite(Number(value))) return 0;
  return clamp((Number(value) - min) / (max - min), 0, 1);
}

function themeMatches(row: TradableUniverseScreenRow, requestedTheme: string | null): boolean {
  if (!requestedTheme) return true;
  const theme = requestedTheme.trim().toLowerCase();
  const memberships = Array.isArray(row.classification.themeMemberships) ? row.classification.themeMemberships : [];
  if (memberships.some((value) => String(value || '').trim().toLowerCase() === theme)) return true;
  const haystack = [
    row.name,
    row.sector,
    row.industry,
    ...(memberships || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(theme.replace(/_/g, ' ')) || haystack.includes(theme);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function parseJsonTail(text: string): any {
  const payload = typeof text === 'string' ? text.trim() : '';
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {}
  for (let idx = payload.length - 1; idx >= 0; idx -= 1) {
    if (payload[idx] !== '{') continue;
    const candidate = payload.slice(idx);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function getPythonLauncher(): string {
  if (process.platform === 'win32') return 'py';
  return process.env.PYTHON || 'python3';
}

function summarizeHydrationStep(step: any): any {
  if (!step || typeof step !== 'object') return null;
  return {
    ok: step.ok ?? null,
    status: trimString(step.status),
    message: trimString(step.message),
    stderr: trimString(step.stderr),
    result: step.result && typeof step.result === 'object'
      ? {
          smoke_test_file: trimString(step.result.smoke_test_file),
          annual_count: toFiniteNumber(step.result.annual_count),
          quarterly_count: toFiniteNumber(step.result.quarterly_count),
          docs_indexed: toFiniteNumber(step.result.docs_indexed),
        }
      : null,
    inserted_rows: toFiniteNumber(step.inserted_rows),
    deleted_rows: toFiniteNumber(step.deleted_rows),
    chunk_count: toFiniteNumber(step.chunk_count),
    mode: trimString(step.mode),
    cik: trimString(step.cik),
  };
}

function summarizeCanonicalRefreshStep(step: any): any {
  if (!step || typeof step !== 'object') return null;
  const rebuildSteps = Array.isArray(step.rebuild_steps)
    ? step.rebuild_steps.map((item: any) => ({
        ok: item?.ok ?? null,
        script: trimString(item?.script),
        stderr: trimString(item?.stderr),
      }))
    : null;
  return {
    ok: step.ok ?? null,
    status: trimString(step.status),
    message: trimString(step.message),
    symbol: trimString(step.symbol),
    cik: trimString(step.cik),
    canonical_present_before: step.canonical_present_before === true,
    canonical_present_after: step.canonical_present_after === true,
    added_to_canonical: step.added_to_canonical === true,
    has_sec_mapping_after: step.has_sec_mapping_after === true,
    ledger_eligible_after: step.ledger_eligible_after === true,
    memberships_after: Array.isArray(step.memberships_after)
      ? step.memberships_after.filter((value: unknown) => typeof value === 'string')
      : null,
    rebuild_steps: rebuildSteps,
  };
}

function summarizeStatementPeriod(period: any): any {
  if (!period || typeof period !== 'object') return null;
  const metrics = period.metrics && typeof period.metrics === 'object' ? period.metrics : {};
  const pickMetric = (key: string) => {
    const entry = metrics[key];
    if (!entry || typeof entry !== 'object') return null;
    return {
      value: toFiniteNumber(entry.value_numeric),
      unit: trimString(entry.unit),
      scale: trimString(entry.scale),
      source_type: trimString(entry.source_type),
      source_document: trimString(entry.source_document),
    };
  };
  return {
    period_end: trimString(period.period_end),
    filing_date: trimString(period.filing_date),
    available_at: trimString(period.available_at),
    fiscal_year: toFiniteNumber(period.fiscal_year),
    fiscal_quarter: toFiniteNumber(period.fiscal_quarter),
    metrics: {
      revenue: pickMetric('revenue'),
      operating_income: pickMetric('operating_income'),
      net_income: pickMetric('net_income'),
      current_assets: pickMetric('current_assets'),
      current_liabilities: pickMetric('current_liabilities'),
      shareholders_equity: pickMetric('shareholders_equity'),
      operating_cash_flow: pickMetric('operating_cash_flow'),
      capital_expenditures: pickMetric('capital_expenditures'),
      free_cash_flow: pickMetric('free_cash_flow'),
    },
  };
}

function summarizeLedgerContextPayload(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const snapshot = data.snapshot && typeof data.snapshot === 'object' ? data.snapshot : {};
  const coverage = data.coverage && typeof data.coverage === 'object' ? data.coverage : {};
  const statementBackbone = data.statement_backbone && typeof data.statement_backbone === 'object'
    ? data.statement_backbone
    : {};
  const retrieval = data.retrieval && typeof data.retrieval === 'object' ? data.retrieval : {};
  const recentDocuments = Array.isArray(data.recent_documents) ? data.recent_documents : [];
  const retrievalResults = Array.isArray(retrieval.results) ? retrieval.results : [];

  return {
    symbol: trimString(data.symbol) || trimString(snapshot.symbol),
    coverage: {
      coverage_tier: trimString(coverage.coverage_tier),
      is_clean_stock: coverage.is_clean_stock ?? null,
      is_ledger_filing_eligible: coverage.is_ledger_filing_eligible ?? null,
      sec_companyfacts_available: coverage.sec_companyfacts_available ?? null,
      sec_filing_pit_available: coverage.sec_filing_pit_available ?? null,
      coverage_note: trimString(coverage.coverage_note),
    },
    snapshot: {
      symbol: trimString(snapshot.symbol),
      companyName: trimString(snapshot.companyName),
      businessDescription: trimString(snapshot.businessDescription),
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
      country: trimString(snapshot.country),
      exchange: trimString(snapshot.exchange),
      currentPrice: toFiniteNumber(snapshot.currentPrice),
      marketCap: toFiniteNumber(snapshot.marketCap),
      enterpriseValue: toFiniteNumber(snapshot.enterpriseValue),
      enterpriseToSales: toFiniteNumber(snapshot.enterpriseToSales),
      annualRevenue: toFiniteNumber(snapshot.annualRevenue),
      netCash: toFiniteNumber(snapshot.netCash),
      cashPctMarketCap: toFiniteNumber(snapshot.cashPctMarketCap),
      cash: toFiniteNumber(snapshot.cash),
      debt: toFiniteNumber(snapshot.debt),
      totalCash: toFiniteNumber(snapshot.totalCash),
      totalDebt: toFiniteNumber(snapshot.totalDebt),
      operatingCashFlowTTM: toFiniteNumber(snapshot.operatingCashFlowTTM),
      freeCashFlowTTM: toFiniteNumber(snapshot.freeCashFlowTTM),
      currentRatio: toFiniteNumber(snapshot.currentRatio),
      quickRatio: toFiniteNumber(snapshot.quickRatio),
      revenueGrowthPct: toFiniteNumber(snapshot.revenueGrowthPct),
      revenueYoYGrowthPct: toFiniteNumber(snapshot.revenueYoYGrowthPct),
      revenueQoQGrowthPct: toFiniteNumber(snapshot.revenueQoQGrowthPct),
      revenueTrendFlag: trimString(snapshot.revenueTrendFlag),
      earningsGrowthPct: toFiniteNumber(snapshot.earningsGrowthPct),
      epsYoYGrowthPct: toFiniteNumber(snapshot.epsYoYGrowthPct),
      epsQoQGrowthPct: toFiniteNumber(snapshot.epsQoQGrowthPct),
      grossMarginPct: toFiniteNumber(snapshot.grossMarginPct),
      operatingMarginPct: toFiniteNumber(snapshot.operatingMarginPct),
      profitMarginPct: toFiniteNumber(snapshot.profitMarginPct),
      returnOnEquityPct: toFiniteNumber(snapshot.returnOnEquityPct),
      returnOnAssetsPct: toFiniteNumber(snapshot.returnOnAssetsPct),
      debtToEquity: toFiniteNumber(snapshot.debtToEquity),
      sharesOutstanding: toFiniteNumber(snapshot.sharesOutstanding),
      sharesOutstandingYoYChangePct: toFiniteNumber(snapshot.sharesOutstandingYoYChangePct),
      dilutionFlag: snapshot.dilutionFlag ?? null,
      recentFinancingFlag: snapshot.recentFinancingFlag ?? null,
      quality: trimString(snapshot.quality),
      riskNote: trimString(snapshot.riskNote),
      catalystFlag: trimString(snapshot.catalystFlag),
      tacticalGrade: trimString(snapshot.tacticalGrade),
      tacticalScore: toFiniteNumber(snapshot.tacticalScore),
    },
    statement_backbone: {
      fact_keys: Array.isArray(statementBackbone.fact_keys) ? statementBackbone.fact_keys : [],
      latest_quarterly: summarizeStatementPeriod(Array.isArray(statementBackbone.quarterly) ? statementBackbone.quarterly[0] : null),
      latest_annual: summarizeStatementPeriod(Array.isArray(statementBackbone.annual) ? statementBackbone.annual[0] : null),
      quarterly_period_count: Array.isArray(statementBackbone.quarterly) ? statementBackbone.quarterly.length : 0,
      annual_period_count: Array.isArray(statementBackbone.annual) ? statementBackbone.annual.length : 0,
    },
    recent_documents: recentDocuments.slice(0, 4).map((doc: any) => ({
      source_type: trimString(doc?.source_type),
      source_document: trimString(doc?.source_document),
      form_type: trimString(doc?.form_type),
      filing_date: trimString(doc?.filing_date),
      report_date: trimString(doc?.report_date),
    })),
    retrieval: {
      available: retrieval.available ?? null,
      query: trimString(retrieval.query),
      top_k: toFiniteNumber(retrieval.top_k),
      result_count: retrievalResults.length,
      results: retrievalResults.slice(0, 3).map((row: any) => ({
        form: trimString(row?.form),
        filing_date: trimString(row?.filing_date),
        section_heading: trimString(row?.section_heading),
        accession_number: trimString(row?.accession_number),
        text_excerpt: trimString(row?.text_excerpt),
        hybrid_score: toFiniteNumber(row?.hybrid_score),
      })),
      error: trimString(retrieval.error),
      meta: retrieval.meta && typeof retrieval.meta === 'object'
        ? {
            retrieval_mode: trimString(retrieval.meta.retrieval_mode),
            chunk_count: toFiniteNumber(retrieval.meta.chunk_count),
          }
        : null,
    },
  };
}

function pickMetricValue(period: any, key: string): number | null {
  const entry = period?.metrics?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const baseValue = toFiniteNumber(entry.value);
  if (baseValue == null) return null;
  const scale = trimString(entry.scale)?.toLowerCase();
  const multiplier =
    scale === 'billions' ? 1_000_000_000 :
    scale === 'millions' ? 1_000_000 :
    scale === 'thousands' ? 1_000 :
    1;
  return baseValue * multiplier;
}

function buildLedgerWorkflowBase(
  ledgerData: any,
  workflow: 'financial_analysis' | 'earnings_quality' | 'dcf_valuation'
): any {
  const snapshot = ledgerData?.snapshot || {};
  const latestAnnual = ledgerData?.statement_backbone?.latest_annual || null;
  const latestQuarterly = ledgerData?.statement_backbone?.latest_quarterly || null;
  const annualRevenue = pickMetricValue(latestAnnual, 'revenue') ?? toFiniteNumber(snapshot.annualRevenue);
  const annualOperatingIncome = pickMetricValue(latestAnnual, 'operating_income');
  const annualNetIncome = pickMetricValue(latestAnnual, 'net_income');
  const annualOperatingCashFlow = pickMetricValue(latestAnnual, 'operating_cash_flow') ?? toFiniteNumber(snapshot.operatingCashFlowTTM);
  const annualFreeCashFlow = pickMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);
  const annualCapex = pickMetricValue(latestAnnual, 'capital_expenditures');

  const operatingMarginPct = Number.isFinite(annualRevenue) && annualRevenue
    ? (Number(annualOperatingIncome) / Number(annualRevenue)) * 100
    : null;
  const netMarginPct = Number.isFinite(annualRevenue) && annualRevenue
    ? (Number(annualNetIncome) / Number(annualRevenue)) * 100
    : null;
  const operatingCashFlowMarginPct = Number.isFinite(annualRevenue) && annualRevenue
    ? (Number(annualOperatingCashFlow) / Number(annualRevenue)) * 100
    : null;
  const freeCashFlowMarginPct = Number.isFinite(annualRevenue) && annualRevenue
    ? (Number(annualFreeCashFlow) / Number(annualRevenue)) * 100
    : null;
  const cashConversion = Number.isFinite(annualNetIncome) && annualNetIncome
    ? Number(annualOperatingCashFlow) / Number(annualNetIncome)
    : null;
  const capexToOcfPct = Number.isFinite(annualOperatingCashFlow) && annualOperatingCashFlow
    ? (Math.abs(Number(annualCapex || 0)) / Number(annualOperatingCashFlow)) * 100
    : null;

  return {
    workflow,
    symbol: ledgerData?.symbol || snapshot.symbol || null,
    company_name: snapshot.companyName || null,
    coverage: ledgerData?.coverage || null,
    current_snapshot: snapshot,
    annual_context: {
      latest_annual: latestAnnual,
      latest_quarterly: latestQuarterly,
      derived: {
        operating_margin_pct: operatingMarginPct,
        net_margin_pct: netMarginPct,
        operating_cash_flow_margin_pct: operatingCashFlowMarginPct,
        free_cash_flow_margin_pct: freeCashFlowMarginPct,
        cash_conversion_ocf_to_net_income: cashConversion,
        capex_as_pct_of_ocf: capexToOcfPct,
      },
    },
    evidence_context: {
      recent_documents: ledgerData?.recent_documents || [],
      retrieval: ledgerData?.retrieval || null,
    },
  };
}

function mergeCorporateActionWithWebVerification(corporateAction: any, verification: any): any {
  if (!corporateAction || !verification || typeof verification !== 'object') return corporateAction;
  const extracted = verification.extracted_terms && typeof verification.extracted_terms === 'object'
    ? verification.extracted_terms
    : {};
  return {
    ...corporateAction,
    acquirer: trimString(corporateAction.acquirer) || trimString(extracted.acquirer),
    deal_price_per_share: toFiniteNumber(corporateAction.deal_price_per_share) ?? toFiniteNumber(extracted.deal_price_per_share),
    contingent_value_right_max_per_share:
      toFiniteNumber(corporateAction.contingent_value_right_max_per_share)
      ?? toFiniteNumber(extracted.contingent_value_right_max_per_share),
    expected_close: trimString(corporateAction.expected_close) || trimString(extracted.expected_close),
    internet_verification_status: trimString(verification.status),
    internet_verification_confidence: trimString(verification.confidence),
    internet_verification_summary: trimString(verification.summary),
    internet_sources: Array.isArray(verification.sources) ? verification.sources.slice(0, 4) : [],
  };
}

async function buildSpecialSituationWebVerification(
  context: TradingContext,
  ledgerData: any,
  args: Record<string, unknown> = {},
): Promise<CopilotToolResult> {
  const symbol = getCurrentScannerSymbol(context);
  if (!symbol) {
    return {
      ok: false,
      tool: 'verify_special_situation_web',
      error: 'No active scanner symbol is available in the current chat context.',
    };
  }

  const corporateAction = ledgerData?.special_situations?.corporate_action
    || ledgerData?.corporate_action
    || null;
  const maxSourcesRaw = Number(args?.max_sources);
  const maxSources = Number.isFinite(maxSourcesRaw)
    ? Math.min(Math.max(Math.trunc(maxSourcesRaw), 1), 8)
    : 5;

  const verification = await verifySpecialSituationWeb({
    symbol,
    companyName: trimString(ledgerData?.company_name) || trimString(ledgerData?.snapshot?.companyName),
    localCorporateAction: corporateAction,
    maxSources,
    searchQuery: trimString(args?.query),
  });

  return {
    ok: verification.status !== 'error',
    tool: 'verify_special_situation_web',
    data: verification,
    error: verification.status === 'error' ? trimString(verification.error) || 'Special-situation verification failed.' : undefined,
  };
}

async function maybeAttachSpecialSituationWebVerification(
  context: TradingContext,
  ledgerData: any,
  workflowPayload: any,
  args: Record<string, unknown> = {},
): Promise<any> {
  if (args?.skip_web_verification === true) {
    return workflowPayload;
  }

  const corporateAction = workflowPayload?.special_situations?.corporate_action
    || ledgerData?.special_situations?.corporate_action
    || null;
  if (!shouldVerifySpecialSituationWeb(corporateAction)) {
    return workflowPayload;
  }

  const verificationResult = await buildSpecialSituationWebVerification(context, {
    ...ledgerData,
    ...workflowPayload,
    company_name: workflowPayload?.company_name || ledgerData?.company_name || ledgerData?.snapshot?.companyName,
    special_situations: workflowPayload?.special_situations || ledgerData?.special_situations || null,
  }, args);
  if (!verificationResult.ok || !verificationResult.data) {
    return workflowPayload;
  }

  return {
    ...workflowPayload,
    special_situations: {
      ...(workflowPayload?.special_situations || {}),
      corporate_action: mergeCorporateActionWithWebVerification(
        workflowPayload?.special_situations?.corporate_action,
        verificationResult.data,
      ),
      internet_verification: verificationResult.data,
    },
  };
}

function mergeLedgerContextEvidence(primary: any, supplemental: any): any {
  const baseRecentDocs = Array.isArray(primary?.recent_documents) ? primary.recent_documents : [];
  const extraRecentDocs = Array.isArray(supplemental?.recent_documents) ? supplemental.recent_documents : [];
  const mergedRecentDocs: any[] = [];
  const seenDocs = new Set<string>();
  [...baseRecentDocs, ...extraRecentDocs].forEach((doc) => {
    const key = [
      trimString(doc?.source_document),
      trimString(doc?.form_type),
      trimString(doc?.filing_date),
    ].filter(Boolean).join('|');
    if (!key || seenDocs.has(key)) return;
    seenDocs.add(key);
    mergedRecentDocs.push(doc);
  });

  const baseRetrieval = primary?.retrieval && typeof primary.retrieval === 'object' ? primary.retrieval : {};
  const extraRetrieval = supplemental?.retrieval && typeof supplemental.retrieval === 'object' ? supplemental.retrieval : {};
  const baseResults = Array.isArray(baseRetrieval.results) ? baseRetrieval.results : [];
  const extraResults = Array.isArray(extraRetrieval.results) ? extraRetrieval.results : [];
  const mergedResults: any[] = [];
  const seenChunks = new Set<string>();
  [...baseResults, ...extraResults].forEach((row) => {
    const key = [
      trimString(row?.chunk_id),
      trimString(row?.accession_number),
      trimString(row?.section_heading),
      trimString(row?.filing_date),
    ].filter(Boolean).join('|');
    if (!key || seenChunks.has(key)) return;
    seenChunks.add(key);
    mergedResults.push(row);
  });

  return {
    ...primary,
    recent_documents: mergedRecentDocs,
    retrieval: {
      ...baseRetrieval,
      ...extraRetrieval,
      query: [trimString(baseRetrieval.query), 'hard_flag_probe'].filter(Boolean).join(' | '),
      result_count: mergedResults.length,
      results: mergedResults,
      meta: {
        ...(baseRetrieval.meta && typeof baseRetrieval.meta === 'object' ? baseRetrieval.meta : {}),
        ...(extraRetrieval.meta && typeof extraRetrieval.meta === 'object' ? extraRetrieval.meta : {}),
        retrieval_mode: [
          trimString(baseRetrieval?.meta?.retrieval_mode),
          'hard_flag_probe',
        ].filter(Boolean).join('+'),
      },
    },
  };
}

function getScannerContext(context: TradingContext): any {
  return context?.copilotAnalysis || {};
}

function getCurrentScannerSymbol(context: TradingContext): string | null {
  const scanner = getScannerContext(context);
  return trimString(
    context?.symbol
    || scanner?.candidate?.symbol
    || scanner?.symbol
  );
}

function isSymbolRequestAllowed(context: TradingContext, requestedSymbol?: unknown): { ok: boolean; error?: string } {
  const requested = trimString(requestedSymbol)?.toUpperCase() || null;
  const current = getCurrentScannerSymbol(context)?.toUpperCase() || null;
  if (!requested || !current || requested === current) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `This tool call can only inspect the active scanner symbol in the current chat context. Active symbol: ${current}.`,
  };
}

function buildChartSnapshot(context: TradingContext): CopilotToolResult {
  const scanner = getScannerContext(context);
  const candidate = scanner?.candidate || null;
  const visual = scanner?.visual || null;
  const snapshot = {
    symbol: getCurrentScannerSymbol(context),
    timeframe: candidate?.timeframe || null,
    patternType: candidate?.pattern_type || context?.patternType || null,
    activeIndicators: Array.isArray(visual?.activeIndicators) ? visual.activeIndicators : [],
    rdpMarkers: Array.isArray(visual?.rdpMarkers) ? visual.rdpMarkers.slice(-12) : [],
    rdpSwingPoints: Array.isArray(visual?.rdpSwingPoints) ? visual.rdpSwingPoints.slice(-12) : [],
    drawings: Array.isArray(visual?.drawings) ? visual.drawings : [],
    candidateRole: candidate?.candidate_role || null,
    candidateActionability: candidate?.candidate_actionability || null,
    entryReady: candidate?.entry_ready ?? null,
  };
  return { ok: true, tool: 'get_chart_snapshot', data: snapshot };
}

function buildCandidateDetails(context: TradingContext): CopilotToolResult {
  const scanner = getScannerContext(context);
  const candidate = scanner?.candidate || null;
  const detector = scanner?.detector || candidate?.detector || null;
  const aiAnalysis = scanner?.aiAnalysis || null;
  const review = aiAnalysis?.review || null;
  const levels = aiAnalysis?.levels || null;
  const ruleChecklist = Array.isArray(candidate?.rule_checklist)
    ? candidate.rule_checklist.slice(0, 24)
    : [];
  return {
    ok: true,
    tool: 'get_candidate_details',
    data: {
      symbol: getCurrentScannerSymbol(context),
      patternType: candidate?.pattern_type || null,
      candidateRole: candidate?.candidate_role || null,
      candidateRoleLabel: candidate?.candidate_role_label || null,
      candidateActionability: candidate?.candidate_actionability || null,
      candidateActionabilityLabel: candidate?.candidate_actionability_label || null,
      semanticSummary: candidate?.candidate_semantic_summary || null,
      entryReady: candidate?.entry_ready ?? null,
      strategyVersionId: candidate?.strategy_version_id || null,
      detector: detector ? {
        activeBaseState: detector?.activeBaseState ?? detector?.active_base_state ?? null,
        activeBaseTop: detector?.activeBaseTop ?? detector?.active_base_top ?? null,
        activeBaseBottom: detector?.activeBaseBottom ?? detector?.active_base_bottom ?? null,
        structuralScore: detector?.structuralScore ?? detector?.structural_score ?? null,
        rankScore: detector?.rankScore ?? detector?.rank_score ?? null,
        recovered: detector?.recovered ?? null,
      } : null,
      aiReview: review ? {
        primaryPattern: review?.primaryPattern || null,
        alternativePattern: review?.alternativePattern || null,
        stateAssessment: review?.stateAssessment || null,
        timingAssessment: review?.timingAssessment || null,
        topReasons: Array.isArray(review?.topReasons) ? review.topReasons.slice(0, 8) : [],
        topRisks: Array.isArray(review?.topRisks) ? review.topRisks.slice(0, 8) : [],
      } : null,
      suggestedLevels: levels ? {
        entry: levels?.suggestedEntry ?? null,
        stop: levels?.suggestedStop ?? null,
        target: levels?.suggestedTarget ?? null,
      } : null,
      ruleChecklist,
    },
  };
}

function buildFundamentalsSnapshot(context: TradingContext): CopilotToolResult {
  const scanner = getScannerContext(context);
  const fundamentals = scanner?.fundamentals || null;
  if (!fundamentals) {
    return {
      ok: false,
      tool: 'get_fundamentals_snapshot',
      error: 'No fundamentals snapshot is loaded in the current scanner context.',
    };
  }
  return {
    ok: true,
    tool: 'get_fundamentals_snapshot',
    data: {
      symbol: getCurrentScannerSymbol(context),
      companyName: fundamentals?.companyName || null,
      sector: fundamentals?.sector || null,
      industry: fundamentals?.industry || null,
      marketCap: fundamentals?.marketCap ?? null,
      quality: fundamentals?.quality || null,
      tacticalGrade: fundamentals?.tacticalGrade || null,
      tacticalScore: fundamentals?.tacticalScore ?? null,
      riskNote: fundamentals?.riskNote || null,
      catalystFlag: fundamentals?.catalystFlag || null,
      dilutionFlag: fundamentals?.dilutionFlag ?? null,
      shortFloatPct: fundamentals?.shortFloatPct ?? null,
      cashRunwayQuarters: fundamentals?.cashRunwayQuarters ?? null,
      revenueGrowthPct: fundamentals?.revenueGrowthPct ?? null,
      earningsGrowthPct: fundamentals?.earningsGrowthPct ?? null,
      socialBuzz: fundamentals?.socialBuzz || null,
      tags: Array.isArray(fundamentals?.tags) ? fundamentals.tags.slice(0, 12) : [],
    },
  };
}

async function buildSocialBuzzSnapshot(context: TradingContext): Promise<CopilotToolResult> {
  const scanner = getScannerContext(context);
  const fundamentals = scanner?.fundamentals || null;
  const symbol = getCurrentScannerSymbol(context);
  if (fundamentals?.socialBuzz?.available) {
    return {
      ok: true,
      tool: 'get_social_buzz',
      data: {
        symbol,
        ...fundamentals.socialBuzz,
      },
    };
  }
  if (!symbol) {
    return {
      ok: false,
      tool: 'get_social_buzz',
      error: 'No active scanner symbol is available in the current chat context.',
    };
  }
  try {
    const port = process.env.PORT || '3002';
    const response = await fetch(`http://127.0.0.1:${port}/api/fundamentals/${encodeURIComponent(symbol)}/buzz`);
    const payload = await response.json() as any;
    if (!response.ok || !payload?.success || !payload?.data) {
      return {
        ok: false,
        tool: 'get_social_buzz',
        error: payload?.error || `Buzz request failed with HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      tool: 'get_social_buzz',
      data: {
        symbol,
        ...payload.data,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      tool: 'get_social_buzz',
      error: error?.message || 'Failed to load social buzz',
    };
  }
}

async function buildConsumerCycleContextSnapshot(context: TradingContext): Promise<CopilotToolResult> {
  const symbol = getCurrentScannerSymbol(context);
  if (!symbol) {
    return {
      ok: false,
      tool: 'get_consumer_cycle_context',
      error: 'No active scanner symbol is available in the current chat context.',
    };
  }

  try {
    const port = process.env.PORT || '3002';
    const [monitorResponse, symbolResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/consumer-cycle/monitor`),
      fetch(`http://127.0.0.1:${port}/api/consumer-cycle/symbols?q=${encodeURIComponent(symbol)}&limit=5`),
    ]);

    const monitorPayload = await monitorResponse.json() as any;
    const symbolPayload = await symbolResponse.json() as any;

    if (!monitorResponse.ok || !monitorPayload?.success || !monitorPayload?.data) {
      return {
        ok: false,
        tool: 'get_consumer_cycle_context',
        error: monitorPayload?.error || `Consumer-cycle monitor request failed with HTTP ${monitorResponse.status}`,
      };
    }
    if (!symbolResponse.ok || !symbolPayload?.success || !symbolPayload?.data) {
      return {
        ok: false,
        tool: 'get_consumer_cycle_context',
        error: symbolPayload?.error || `Consumer-cycle symbol request failed with HTTP ${symbolResponse.status}`,
      };
    }

    const matchingRow = (Array.isArray(symbolPayload.data?.rows) ? symbolPayload.data.rows : [])
      .find((row: any) => String(row?.symbol || '').trim().toUpperCase() === symbol);

    return {
      ok: true,
      tool: 'get_consumer_cycle_context',
      data: {
        symbol,
        monitor: monitorPayload.data,
        symbolProfile: matchingRow || null,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      tool: 'get_consumer_cycle_context',
      error: error?.message || 'Failed to load consumer-cycle context',
    };
  }
}

async function loadUniverseFundamentalsSnapshot(symbol: string): Promise<UniverseFundamentalsSnapshot | null> {
  try {
    const port = process.env.PORT || '3002';
    const response = await fetch(`http://127.0.0.1:${port}/api/fundamentals/${encodeURIComponent(symbol)}`);
    const payload = await response.json() as any;
    if (!response.ok || !payload?.success || !payload?.data) {
      return null;
    }
    const data = payload.data || {};
    return {
      symbol,
      companyName: trimString(data.companyName),
      sector: trimString(data.sector),
      industry: trimString(data.industry),
      currentPrice: toFiniteNumber(data.currentPrice),
      marketCap: toFiniteNumber(data.marketCap),
      averageVolume: toFiniteNumber(data.averageVolume),
      relativeVolume: toFiniteNumber(data.relativeVolume),
      debtToEquity: toFiniteNumber(data.debtToEquity),
      currentRatio: toFiniteNumber(data.currentRatio),
      quickRatio: toFiniteNumber(data.quickRatio),
      totalCash: toFiniteNumber(data.totalCash),
      totalDebt: toFiniteNumber(data.totalDebt),
      netCash: toFiniteNumber(data.netCash),
      operatingCashFlowTTM: toFiniteNumber(data.operatingCashFlowTTM),
      freeCashFlowTTM: toFiniteNumber(data.freeCashFlowTTM),
      dilutionFlag: typeof data.dilutionFlag === 'boolean' ? data.dilutionFlag : null,
      recentFinancingFlag: typeof data.recentFinancingFlag === 'boolean' ? data.recentFinancingFlag : null,
      survivabilityScore: toFiniteNumber(data.survivabilityScore),
      trendScore: toFiniteNumber(data.trendScore),
      tacticalScore: toFiniteNumber(data.tacticalScore),
      reportedExecutionScore: toFiniteNumber(data.reportedExecutionScore),
      forwardExpectationsScore: toFiniteNumber(data.forwardExpectationsScore),
      positioningScore: toFiniteNumber(data.positioningScore),
      revenueGrowthPct: toFiniteNumber(data.revenueGrowthPct),
      earningsGrowthPct: toFiniteNumber(data.earningsGrowthPct),
    };
  } catch {
    return null;
  }
}

function preRankUniverseRows(
  rows: TradableUniverseScreenRow[],
  direction: UniverseScreenDirection,
  requestedTheme: string | null,
  requestedCycleBucket: ConsumerCycleBucket | null,
  optionableOnly: boolean,
): TradableUniverseScreenRow[] {
  const filtered = rows.filter((row) => {
    if (!row.valuation) return false;
    if (optionableOnly && !row.optionable) return false;
    if (requestedTheme && !themeMatches(row, requestedTheme)) return false;
    if (requestedCycleBucket && row.classification.consumerCycleBucket !== requestedCycleBucket) return false;
    const state = row.valuation.valuationState;
    if (direction === 'long') {
      return state === 'undervalued' || state === 'fair' || state === 'roughly_fair';
    }
    return state === 'overvalued' || state === 'fair' || state === 'roughly_fair';
  });

  return filtered.sort((a, b) => {
    const aState = a.valuation?.valuationState || null;
    const bState = b.valuation?.valuationState || null;
    const aGapRaw = direction === 'long' ? (a.valuation?.valuationGapPct || 0) : Math.abs(Math.min(a.valuation?.valuationGapPct || 0, 0));
    const bGapRaw = direction === 'long' ? (b.valuation?.valuationGapPct || 0) : Math.abs(Math.min(b.valuation?.valuationGapPct || 0, 0));
    const aGap = Math.min(Math.max(aGapRaw, 0), 120);
    const bGap = Math.min(Math.max(bGapRaw, 0), 120);
    const aStateScore =
      direction === 'long'
        ? (aState === 'undervalued' ? 2 : aState === 'fair' || aState === 'roughly_fair' ? 1 : 0)
        : (aState === 'overvalued' ? 2 : aState === 'fair' || aState === 'roughly_fair' ? 1 : 0);
    const bStateScore =
      direction === 'long'
        ? (bState === 'undervalued' ? 2 : bState === 'fair' || bState === 'roughly_fair' ? 1 : 0)
        : (bState === 'overvalued' ? 2 : bState === 'fair' || bState === 'roughly_fair' ? 1 : 0);
    if (bStateScore !== aStateScore) return bStateScore - aStateScore;
    if (bGap !== aGap) return bGap - aGap;
    return (b.valuation?.qualityScore || 0) - (a.valuation?.qualityScore || 0);
  });
}

function buildUniverseScreenCandidate(
  row: TradableUniverseScreenRow,
  snapshot: UniverseFundamentalsSnapshot,
  direction: UniverseScreenDirection,
  cycleStatus: string | null,
): UniverseScreenCandidate {
  const valuation = row.valuation;
  const rawValuationGapPct = valuation?.valuationGapPct ?? null;
  const cappedGapMagnitude = rawValuationGapPct == null
    ? 0
    : Math.min(Math.abs(rawValuationGapPct), 120);
  const dollarVolume =
    snapshot.currentPrice != null && snapshot.averageVolume != null
      ? snapshot.currentPrice * snapshot.averageVolume
      : null;

  let score = 0;
  const reasons: string[] = [];

  if (direction === 'long') {
    if (valuation?.valuationState === 'undervalued') {
      score += 24;
      reasons.push(
        cappedGapMagnitude > 120 - 1e-9
          ? 'DCF screens as deeply undervalued, but the gap is extreme enough to treat as model-sensitive.'
          : `Undervalued (${(rawValuationGapPct ?? 0).toFixed(1)}% gap).`
      );
    } else if (valuation?.valuationState === 'fair' || valuation?.valuationState === 'roughly_fair') {
      score += 10;
      reasons.push('Near fair value rather than overpaying.');
    }
    score += scoreBucketValue(valuation?.qualityScore, 40, 90) * 14;
    score += scoreBucketValue(snapshot.survivabilityScore, 45, 90) * 12;
    score += scoreBucketValue(snapshot.reportedExecutionScore, 45, 90) * 12;
    score += scoreBucketValue(snapshot.trendScore, 45, 90) * 12;
    score += scoreBucketValue(snapshot.tacticalScore, 45, 90) * 8;
    score += scoreBucketValue(snapshot.currentRatio, 0.8, 2.0) * 6;
    score += scoreBucketValue(snapshot.quickRatio, 0.5, 1.5) * 4;
    score += scoreBucketValue(-1 * (snapshot.debtToEquity ?? 0), -2.5, 0.5) * 8;
    if ((snapshot.freeCashFlowTTM ?? 0) > 0) {
      score += 8;
      reasons.push('Positive free cash flow supports the thesis.');
    }
    if (snapshot.dilutionFlag === false) score += 4;
    if (snapshot.recentFinancingFlag === true) score -= 5;
    if (snapshot.dilutionFlag === true) score -= 8;
    if ((cycleStatus === 'yellow' || cycleStatus === 'orange' || cycleStatus === 'red')) {
      if (row.classification.macroRegimePreference === 'prefer_in_slowdown') {
        score += 8;
        reasons.push('Cycle profile is supportive in a softer regime.');
      } else if (row.classification.macroRegimePreference === 'selective_in_slowdown') {
        score += 3;
      } else if (row.classification.macroRegimePreference === 'avoid_in_slowdown') {
        score -= 8;
      }
    }
  } else {
    if (valuation?.valuationState === 'overvalued') {
      score += 24;
      reasons.push(
        cappedGapMagnitude > 120 - 1e-9
          ? 'DCF screens as deeply overvalued, but the gap is extreme enough to treat as model-sensitive.'
          : `Overvalued (${Math.abs(rawValuationGapPct ?? 0).toFixed(1)}% rich to fair value).`
      );
    }
    score += scoreBucketValue(Math.min(Math.abs(Math.min(rawValuationGapPct ?? 0, 0)), 120), 10, 60) * 14;
    score += scoreBucketValue(snapshot.debtToEquity, 0.5, 3.0) * 10;
    score += scoreBucketValue(100 - (snapshot.trendScore ?? 50), 10, 60) * 10;
    score += scoreBucketValue(100 - (snapshot.reportedExecutionScore ?? 50), 10, 60) * 10;
    if ((snapshot.freeCashFlowTTM ?? 0) <= 0) {
      score += 8;
      reasons.push('Weak cash generation increases downside vulnerability.');
    }
    if (snapshot.dilutionFlag === true) score += 6;
    if ((cycleStatus === 'yellow' || cycleStatus === 'orange' || cycleStatus === 'red') && row.classification.macroRegimePreference === 'avoid_in_slowdown') {
      score += 8;
      reasons.push('Cycle bucket is vulnerable in the current regime.');
    }
  }

  if (dollarVolume != null && dollarVolume >= 25_000_000) {
    reasons.push(`Liquid enough to trade (~$${(dollarVolume / 1_000_000).toFixed(1)}M daily dollar volume).`);
  }
  if ((snapshot.debtToEquity ?? 0) <= 1.0 && direction === 'long') {
    reasons.push('Balance sheet is not overly debt-heavy.');
  }
  if ((snapshot.trendScore ?? 0) >= 70 && direction === 'long') {
    reasons.push('Technical trend is already supportive.');
  }

  return {
    symbol: row.symbol,
    name: snapshot.companyName || row.name,
    sector: snapshot.sector || row.sector,
    industry: snapshot.industry || row.industry,
    direction,
    compositeScore: Number(score.toFixed(2)),
    valuationState: valuation?.valuationState || null,
    valuationGapPct: valuation?.valuationGapPct || null,
    fairValueMid: valuation?.fairValueMid || null,
    price: snapshot.currentPrice ?? valuation?.price ?? null,
    valuationQualityGrade: valuation?.qualityGrade || null,
    valuationQualityScore: valuation?.qualityScore || null,
    coverageMode: valuation?.coverageMode || null,
    consumerCycleBucket: row.classification.consumerCycleBucket || null,
    macroRegimePreference: row.classification.macroRegimePreference || null,
    themes: Array.isArray(row.classification.themeMemberships) ? row.classification.themeMemberships : [],
    optionable: row.optionable,
    dollarVolume,
    balanceSheet: {
      debtToEquity: snapshot.debtToEquity,
      currentRatio: snapshot.currentRatio,
      quickRatio: snapshot.quickRatio,
      totalCash: snapshot.totalCash,
      totalDebt: snapshot.totalDebt,
      netCash: snapshot.netCash,
    },
    execution: {
      survivabilityScore: snapshot.survivabilityScore,
      reportedExecutionScore: snapshot.reportedExecutionScore,
      forwardExpectationsScore: snapshot.forwardExpectationsScore,
      trendScore: snapshot.trendScore,
      tacticalScore: snapshot.tacticalScore,
      revenueGrowthPct: snapshot.revenueGrowthPct,
      earningsGrowthPct: snapshot.earningsGrowthPct,
      dilutionFlag: snapshot.dilutionFlag,
      recentFinancingFlag: snapshot.recentFinancingFlag,
      freeCashFlowTTM: snapshot.freeCashFlowTTM,
      operatingCashFlowTTM: snapshot.operatingCashFlowTTM,
    },
    reasons: reasons.slice(0, 5),
  };
}

async function buildCleanUniverseScreen(context: TradingContext, args: Record<string, unknown>): Promise<CopilotToolResult> {
  const direction = String(args?.direction || 'long').trim().toLowerCase() === 'short' ? 'short' : 'long';
  const requestedTheme = trimString(args?.theme);
  const requestedCycleBucket = trimString(args?.cycle_bucket) as ConsumerCycleBucket | null;
  const countRaw = Number(args?.count);
  const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.trunc(countRaw), 1), 10) : 5;
  const maxCandidatesRaw = Number(args?.max_candidates);
  const maxCandidates = Number.isFinite(maxCandidatesRaw) ? Math.min(Math.max(Math.trunc(maxCandidatesRaw), 10), 120) : 60;
  const minDollarVolumeMillionsRaw = Number(args?.min_dollar_volume_millions);
  const minDollarVolume = Number.isFinite(minDollarVolumeMillionsRaw)
    ? Math.max(0, minDollarVolumeMillionsRaw) * 1_000_000
    : 15_000_000;
  const optionableOnly = args?.optionable_only === true;

  const rows = preRankUniverseRows(
    listTradableUniverseScreenRows(),
    direction,
    requestedTheme,
    requestedCycleBucket,
    optionableOnly,
  ).slice(0, maxCandidates);

  if (!rows.length) {
    return {
      ok: false,
      tool: 'screen_clean_universe',
      error: 'No clean-universe candidates matched the requested filters.',
    };
  }

  let cycleStatus: string | null = null;
  try {
    const port = process.env.PORT || '3002';
    const monitorResponse = await fetch(`http://127.0.0.1:${port}/api/consumer-cycle/monitor`);
    const monitorPayload = await monitorResponse.json() as any;
    if (monitorResponse.ok && monitorPayload?.success && monitorPayload?.data) {
      cycleStatus = trimString(monitorPayload.data?.overallStatus);
    }
  } catch {
    cycleStatus = null;
  }

  const scored = await mapWithConcurrency(rows, 6, async (row) => {
    const snapshot = await loadUniverseFundamentalsSnapshot(row.symbol);
    if (!snapshot) return null;
    const dollarVolume =
      snapshot.currentPrice != null && snapshot.averageVolume != null
        ? snapshot.currentPrice * snapshot.averageVolume
        : null;
    if (dollarVolume != null && dollarVolume < minDollarVolume) {
      return null;
    }
    return buildUniverseScreenCandidate(row, snapshot, direction, cycleStatus);
  });

  const candidates = scored
    .filter((row): row is UniverseScreenCandidate => Boolean(row))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, count);

  if (!candidates.length) {
    return {
      ok: false,
      tool: 'screen_clean_universe',
      error: 'The clean-universe screen found candidates, but none passed the liquidity and fundamentals checks.',
    };
  }

  return {
    ok: true,
    tool: 'screen_clean_universe',
    data: {
      direction,
      methodology: [
        'Universe scoped to tradable_stock_default.',
        'Prefiltered on valuation state and optional theme/cycle filters from the symbol catalog.',
        'Then ranked with fundamentals snapshot checks for liquidity, balance sheet, execution, and technical trend.',
      ],
      filter_summary: {
        theme: requestedTheme,
        cycle_bucket: requestedCycleBucket,
        optionable_only: optionableOnly,
        min_dollar_volume_millions: Number((minDollarVolume / 1_000_000).toFixed(1)),
        macro_cycle_status: cycleStatus,
        candidates_considered: rows.length,
      },
      candidates,
    },
  };
}

async function buildLedgerContextSnapshot(
  context: TradingContext,
  args: Record<string, unknown>
): Promise<CopilotToolResult> {
  const symbol = getCurrentScannerSymbol(context);
  if (!symbol) {
    return {
      ok: false,
      tool: 'get_ledger_context',
      error: 'No active scanner symbol is available in the current chat context.',
    };
  }

  const query = trimString(args?.query) || 'quality risk cash flow debt liquidity dilution covenant legal notes';
  const topKRaw = Number(args?.top_k);
  const topK = Number.isFinite(topKRaw) && topKRaw > 0
    ? Math.min(Math.max(Math.trunc(topKRaw), 1), 8)
    : 5;

  try {
    const port = process.env.PORT || '3002';
    const response = await fetch(
      `http://127.0.0.1:${port}/api/fundamentals/${encodeURIComponent(symbol)}/ledger-context?top_k=${topK}&query=${encodeURIComponent(query)}`
    );
    const payload = await response.json() as any;
    if (!response.ok || !payload?.success || !payload?.data) {
      return {
        ok: false,
        tool: 'get_ledger_context',
        error: payload?.error || `Ledger context request failed with HTTP ${response.status}`,
      };
    }
    let summarized = summarizeLedgerContextPayload(payload.data);
    const shouldProbeHardFlags = !trimString(args?.skip_hard_flag_probe) || String(args?.skip_hard_flag_probe).trim() === '0';
    if (shouldProbeHardFlags && trimString(query) !== LEDGER_HARD_FLAG_QUERY) {
      try {
        const probeResponse = await fetch(
          `http://127.0.0.1:${port}/api/fundamentals/${encodeURIComponent(symbol)}/ledger-context?top_k=6&query=${encodeURIComponent(LEDGER_HARD_FLAG_QUERY)}`
        );
        const probePayload = await probeResponse.json() as any;
        if (probeResponse.ok && probePayload?.success && probePayload?.data) {
          summarized = mergeLedgerContextEvidence(summarized, summarizeLedgerContextPayload(probePayload.data));
        }
      } catch (_error) {
        // Best-effort probe; keep primary context if the supplemental fetch fails.
      }
    }
    return {
      ok: true,
      tool: 'get_ledger_context',
      data: summarized,
    };
  } catch (error: any) {
    return {
      ok: false,
      tool: 'get_ledger_context',
      error: error?.message || 'Failed to load ledger context',
    };
  }
}

async function refreshLedgerFilingCoverage(
  context: TradingContext,
  args: Record<string, unknown>
): Promise<CopilotToolResult> {
  const symbol = getCurrentScannerSymbol(context);
  if (!symbol) {
    return {
      ok: false,
      tool: 'refresh_filing_coverage',
      error: 'No active scanner symbol is available in the current chat context.',
    };
  }
  if (!fs.existsSync(LEDGER_HYDRATION_SCRIPT)) {
    return {
      ok: false,
      tool: 'refresh_filing_coverage',
      error: 'Ledger hydration script is not available.',
    };
  }

  const annualCountRaw = Number(args?.annual_count);
  const quarterlyCountRaw = Number(args?.quarterly_count);
  const annualCount = Number.isFinite(annualCountRaw)
    ? Math.min(Math.max(Math.trunc(annualCountRaw), 0), 4)
    : 1;
  const quarterlyCount = Number.isFinite(quarterlyCountRaw)
    ? Math.min(Math.max(Math.trunc(quarterlyCountRaw), 0), 6)
    : 2;

  const commandArgs = [
    LEDGER_HYDRATION_SCRIPT,
    '--symbol',
    symbol,
    '--annual-count',
    String(annualCount),
    '--quarterly-count',
    String(quarterlyCount),
  ];
  if (args?.skip_sec === true) commandArgs.push('--skip-sec');
  if (args?.skip_snapshot === true) commandArgs.push('--skip-snapshot');

  try {
    const { stdout, stderr } = await execFileAsync(getPythonLauncher(), commandArgs, {
      cwd: REPO_ROOT,
      timeout: 60 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const payload = parseJsonTail(stdout);
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        tool: 'refresh_filing_coverage',
        error: trimString(stderr) || 'Hydration completed without a readable JSON summary.',
      };
    }
    return {
      ok: true,
      tool: 'refresh_filing_coverage',
      data: {
        symbol,
        status: trimString(payload.status),
        coverage_before: payload.coverage_before || null,
        coverage_after: payload.coverage_after || null,
        canonical_refresh: summarizeCanonicalRefreshStep(payload.canonical_refresh),
        snapshot_hydration: summarizeHydrationStep(payload.snapshot_hydration),
        sec_hydration: summarizeHydrationStep(payload.sec_hydration),
        pit_import: summarizeHydrationStep(payload.pit_import),
        retrieval_refresh: summarizeHydrationStep(payload.retrieval_refresh),
        message:
          trimString(payload.status) === 'full_filing_supported'
            ? 'Filing coverage is now available for Ledger.'
            : trimString(payload.status) === 'partial_hydration'
              ? 'Hydration improved coverage, but the company may still be only partially supported.'
              : 'Hydration did not materially improve Ledger coverage.',
      },
    };
  } catch (error: any) {
    const payload = parseJsonTail(String(error?.stdout || ''));
    if (payload && typeof payload === 'object') {
      return {
        ok: true,
        tool: 'refresh_filing_coverage',
        data: {
          symbol,
          status: trimString(payload.status),
          coverage_before: payload.coverage_before || null,
          coverage_after: payload.coverage_after || null,
          canonical_refresh: summarizeCanonicalRefreshStep(payload.canonical_refresh),
          snapshot_hydration: summarizeHydrationStep(payload.snapshot_hydration),
          sec_hydration: summarizeHydrationStep(payload.sec_hydration),
          pit_import: summarizeHydrationStep(payload.pit_import),
          retrieval_refresh: summarizeHydrationStep(payload.retrieval_refresh),
          message:
            trimString(payload.status) === 'full_filing_supported'
              ? 'Filing coverage is now available for Ledger.'
              : trimString(payload.status) === 'partial_hydration'
                ? 'Hydration improved coverage, but the company may still be only partially supported.'
                : 'Hydration did not materially improve Ledger coverage.',
        },
      };
    }
    return {
      ok: false,
      tool: 'refresh_filing_coverage',
      error: trimString(error?.stderr) || trimString(error?.message) || 'Failed to refresh Ledger filing coverage.',
    };
  }
}

async function buildLedgerWorkflowResult(
  context: TradingContext,
  args: Record<string, unknown>,
  workflow: 'financial_analysis' | 'earnings_quality' | 'dcf_valuation'
): Promise<CopilotToolResult> {
  const workflowQueryMap: Record<typeof workflow, string> = {
    financial_analysis: 'business quality growth margins returns on capital debt liquidity capital allocation valuation',
    earnings_quality: 'cash conversion accruals dilution stock compensation leases one-time items margin quality working capital notes',
    dcf_valuation: 'valuation intrinsic value fair value growth margins free cash flow capital intensity debt liquidity',
  };

  const baseArgs = {
    ...args,
    query: trimString(args?.query) || workflowQueryMap[workflow],
    top_k: Number.isFinite(Number(args?.top_k)) ? args.top_k : 5,
  };
  const ledgerContext = await buildLedgerContextSnapshot(context, baseArgs);
  if (!ledgerContext.ok) {
    return {
      ...ledgerContext,
      tool: workflow === 'financial_analysis'
        ? 'run_financial_analysis'
        : workflow === 'earnings_quality'
          ? 'run_earnings_quality'
          : 'run_dcf_valuation',
    };
  }

  let mergedLedgerData = ledgerContext.data;
  const corporateActionProbe = await buildLedgerContextSnapshot(context, {
    query: LEDGER_HARD_FLAG_QUERY,
    top_k: 3,
  });
  if (corporateActionProbe.ok && corporateActionProbe.data && typeof corporateActionProbe.data === 'object') {
    mergedLedgerData = mergeLedgerContextEvidence(ledgerContext.data, corporateActionProbe.data);
  }

  const base = buildLedgerWorkflowBase(mergedLedgerData, workflow);
  if (workflow === 'financial_analysis') {
    const engineResult = runFinancialAnalysisEngine(base);
    const withVerification = await maybeAttachSpecialSituationWebVerification(context, mergedLedgerData, engineResult, args);
    return {
      ok: true,
      tool: 'run_financial_analysis',
      data: {
        ...base,
        ...withVerification,
        output_contract: [
          'business_summary',
          'financial_quality',
          'financial_risk',
          'competitive_advantage',
          'capital_allocation',
          'valuation_method_used',
          'intrinsic_value_conclusion',
          'price_vs_value_judgment',
          'special_situations',
          'main_risks',
          'what_would_change_the_view',
          'confidence_level',
        ],
        workflow_requirements: [
          'Separate reported facts from derived interpretation.',
          'Use filing-backed evidence when coverage allows.',
          'Do not force valuation precision if evidence is thin.',
        ],
      },
    };
  }

  if (workflow === 'earnings_quality') {
    const engineResult = runEarningsQualityEngine(base);
    const withVerification = await maybeAttachSpecialSituationWebVerification(context, mergedLedgerData, engineResult, args);
    return {
      ok: true,
      tool: 'run_earnings_quality',
      data: {
        ...base,
        ...withVerification,
        checklist: [
          'Compare net income to operating cash flow.',
          'Assess free cash flow after capital expenditures.',
          'Check capex intensity and reinvestment burden.',
          'Look for dilution, stock-based compensation, leases, and one-time distortions.',
          'Flag where evidence is missing and note-level drill-down is required.',
        ],
        output_contract: [
          'cash_conversion',
          'accounting_distortions',
          'dilution_and_capital_structure',
          'balance_sheet_pressure',
          'earnings_quality_judgment',
          'special_situations',
          'key_evidence_refs',
          'confidence_level',
        ],
      },
    };
  }

  const dcfResult = runValuationEngine(base, {
    revenue_growth_near_term_pct: toFiniteNumber(args?.revenue_growth_near_term_pct),
    target_operating_margin_pct: toFiniteNumber(args?.target_operating_margin_pct),
    discount_rate_pct: toFiniteNumber(args?.discount_rate_pct),
    terminal_growth_pct: toFiniteNumber(args?.terminal_growth_pct),
    forecast_years: toFiniteNumber(args?.forecast_years),
  });
  const dcfWithVerification = await maybeAttachSpecialSituationWebVerification(context, mergedLedgerData, dcfResult, args);
  return {
    ok: true,
    tool: 'run_dcf_valuation',
    data: {
      ...base,
      ...dcfWithVerification,
      assumptions: {
        revenue_growth_near_term_pct: toFiniteNumber(args?.revenue_growth_near_term_pct),
        target_operating_margin_pct: toFiniteNumber(args?.target_operating_margin_pct),
        discount_rate_pct: toFiniteNumber(args?.discount_rate_pct),
        terminal_growth_pct: toFiniteNumber(args?.terminal_growth_pct),
        forecast_years: toFiniteNumber(args?.forecast_years),
      },
      assumption_requirements: [
        'Near-term revenue growth path',
        'Target operating margin or free cash flow margin path',
        'Discount rate',
        'Terminal growth rate',
        'Reinvestment intensity / capital needs',
      ],
      output_contract: [
        'valuation_method',
        'base_case_assumptions',
        'bear_case_assumptions',
        'bull_case_assumptions',
        'fair_value_range',
        'sensitivity_notes',
        'price_vs_value_judgment',
        'special_situations',
        'confidence_level',
      ],
      hard_rules: [
        'Return a value range rather than false precision.',
        'State assumptions explicitly.',
        'Say when the valuation is too assumption-sensitive to trust tightly.',
      ],
    },
  };
}

export function getCopilotToolsForRole(role: AIRole): OpenAITool[] {
  if (!SCANNER_TOOL_ROLES.includes(role)) return [];
  return [
    {
      type: 'function',
      function: {
        name: 'get_chart_snapshot',
        description: 'Return the active scanner chart context: symbol, timeframe, visible indicators, recent RDP markers, recent swing points, and current drawings.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_candidate_details',
        description: 'Return the active scanner candidate details, including detector state, rule checklist, AI review, and suggested levels.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_fundamentals_snapshot',
        description: 'Return the loaded fundamentals snapshot for the active scanner symbol, including quality, risk, catalyst, dilution, and social buzz context if available.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_social_buzz',
        description: 'Return social buzz for the active scanner symbol, including mood, watcher count, bull/bear percentages, and recent message samples when available.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
  ];
}

export function getCopilotToolsForAnalyst(analyst: WorkspaceAnalystId): OpenAITool[] {
  if (WORKSPACE_SCANNER_ANALYSTS.includes(analyst)) {
    return getCopilotToolsForRole(
      analyst === 'pattern_analyst' ? 'pattern_analyst' : 'contextual_ranker'
    );
  }

  if (analyst !== 'financial_analyst') return [];

  return [
    {
      type: 'function',
      function: {
        name: 'get_ledger_context',
        description: 'Return the active symbol\'s unified Ledger context: coverage tier, filing-backed PIT facts, recent SEC documents, and retrieved filing evidence chunks.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            query: {
              type: 'string',
              description: 'Optional retrieval query for what to focus on in the filing evidence, such as liquidity, debt, dilution, or legal risk.',
            },
            top_k: {
              type: 'integer',
              description: 'Optional number of retrieval chunks to return, from 1 to 8.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_social_buzz',
        description: 'Return social buzz for the active symbol, including mood, watcher count, bull/bear percentages, and recent message samples when available.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_consumer_cycle_context',
        description: 'Return the current consumer-cycle monitor plus the active symbol\'s cycle bucket, spending category, and slowdown preference.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'screen_clean_universe',
        description: 'Rank clean-universe stock candidates from the database using valuation state, consumer cycle, balance-sheet quality, earnings quality, liquidity, and technical trend.',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['long', 'short'],
              description: 'Whether to rank long ideas or short ideas.',
            },
            count: {
              type: 'integer',
              description: 'How many ranked stocks to return, from 1 to 10.',
            },
            theme: {
              type: 'string',
              description: 'Optional theme filter such as software, software_application, cloud, or adtech.',
            },
            cycle_bucket: {
              type: 'string',
              enum: ['highly_cyclical', 'mildly_cyclical', 'stable'],
              description: 'Optional consumer-cycle bucket filter.',
            },
            min_dollar_volume_millions: {
              type: 'number',
              description: 'Optional liquidity floor in average daily dollar volume, in millions.',
            },
            optionable_only: {
              type: 'boolean',
              description: 'Optional flag to restrict results to optionable names.',
            },
            max_candidates: {
              type: 'integer',
              description: 'Optional internal shortlist size before scoring the final ranked results.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'refresh_filing_coverage',
        description: 'Repair the active symbol in the canonical universe when needed, then hydrate Ledger coverage by refreshing fundamentals, SEC filing history, PIT imports, and filing-note retrieval.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            annual_count: {
              type: 'integer',
              description: 'Optional number of recent annual filings to fetch, from 0 to 4.',
            },
            quarterly_count: {
              type: 'integer',
              description: 'Optional number of recent quarterly filings to fetch, from 0 to 6.',
            },
            skip_sec: {
              type: 'boolean',
              description: 'Optional override to skip SEC filing hydration.',
            },
            skip_snapshot: {
              type: 'boolean',
              description: 'Optional override to skip fundamentals snapshot hydration.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'verify_special_situation_web',
        description: 'Verify a filing-flagged pending acquisition, merger, or go-private situation using targeted public-web research when local filing terms are incomplete.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            query: {
              type: 'string',
              description: 'Optional web-search override, such as merger terms, go-private, or definitive agreement.',
            },
            max_sources: {
              type: 'integer',
              description: 'Optional maximum number of public-web sources to summarize, from 1 to 8.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_financial_analysis',
        description: 'Run Ledger’s full structured financial-analysis workflow using filing-backed context, returning the required sections and evidence-focused analysis contract.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            query: {
              type: 'string',
              description: 'Optional focus override for the filing retrieval query.',
            },
            top_k: {
              type: 'integer',
              description: 'Optional number of filing evidence chunks to pull, from 1 to 8.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_earnings_quality',
        description: 'Run Ledger’s earnings-quality workflow, focusing on cash conversion, distortion checks, capex burden, dilution, and accounting-quality signals.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            query: {
              type: 'string',
              description: 'Optional focus override for note retrieval and filing evidence.',
            },
            top_k: {
              type: 'integer',
              description: 'Optional number of filing evidence chunks to pull, from 1 to 8.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_dcf_valuation',
        description: 'Run Ledger’s DCF valuation workflow scaffold, returning the current filing-backed valuation base, required assumptions, and structured valuation output contract.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Optional symbol. Must match the active scanner symbol if provided.',
            },
            query: {
              type: 'string',
              description: 'Optional focus override for valuation-related filing evidence.',
            },
            top_k: {
              type: 'integer',
              description: 'Optional number of filing evidence chunks to pull, from 1 to 8.',
            },
            revenue_growth_near_term_pct: {
              type: 'number',
              description: 'Optional near-term revenue growth assumption in percent.',
            },
            target_operating_margin_pct: {
              type: 'number',
              description: 'Optional target operating margin assumption in percent.',
            },
            discount_rate_pct: {
              type: 'number',
              description: 'Optional discount rate assumption in percent.',
            },
            terminal_growth_pct: {
              type: 'number',
              description: 'Optional terminal growth rate assumption in percent.',
            },
            forecast_years: {
              type: 'integer',
              description: 'Optional explicit forecast horizon in years.',
            },
          },
          additionalProperties: false,
        },
      },
    },
  ];
}

export function buildCopilotToolPromptAppendix(role: AIRole): string {
  const tools = getCopilotToolsForRole(role);
  if (!tools.length) return '';
  return `

AVAILABLE READ-ONLY TOOLS:
- Use tools only when the answer would materially improve from a targeted context fetch.
- Do not call tools just to restate data already obvious in the prompt.
- Stay within the active scanner symbol and current chat context.
- Prefer at most 1-2 tool calls before answering.
- If the user explicitly asks for sentiment, social buzz, watchers, bullish/bearish balance, or crowd positioning, call get_social_buzz before answering.
- If the user explicitly asks for detector state, trigger logic, rule checklist, or setup internals, call get_candidate_details before answering.
- If the user explicitly asks for company quality, dilution, runway, catalysts, or fundamentals, call get_fundamentals_snapshot before answering.

TOOL LIST:
${tools.map(tool => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}
`;
}

export function buildCopilotToolPromptAppendixForAnalyst(analyst: WorkspaceAnalystId): string {
  const tools = getCopilotToolsForAnalyst(analyst);
  if (!tools.length) return '';
  return `

AVAILABLE READ-ONLY TOOLS:
- Use tools only when the answer materially improves from a targeted fetch.
- Stay within the active scanner symbol and current chat context.
- Prefer 1-2 tool calls before answering.
- If you are the financial analyst, call get_ledger_context before making specific claims about filing-backed quality, balance sheet risk, dilution, cash flow, or narrative issues in the notes.
- Do not reach for technical scanner tools as a substitute for filing-backed analysis.
- If Ledger coverage is missing, stale, or insufficient, call refresh_filing_coverage before concluding that the company is unavailable.
- If the user asks for a full company review, call run_financial_analysis.
- If the user asks about accounting quality, earnings quality, cash conversion, dilution, or distortions, call run_earnings_quality.
- If the user asks for DCF, fair value, intrinsic value, or overvalued/undervalued judgment, call run_dcf_valuation.
- If the user asks about sentiment, social buzz, watcher activity, or crowd positioning, call get_social_buzz and treat it as secondary context rather than proof.
- If the user asks about consumer cycle, cyclical demand, slowdown risk, recession sensitivity, or whether the company belongs in a cyclical or defensive bucket, call get_consumer_cycle_context before answering.
- If the user asks for database-wide stock picks, top ideas, best 5 longs, best 5 shorts, or clean-universe ranking, call screen_clean_universe before answering.
- If local filing evidence flags a pending acquisition, merger, or go-private situation but key terms are incomplete, call verify_special_situation_web before treating the stock like a normal standalone equity.

TOOL LIST:
${tools.map(tool => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}
`;
}

export async function executeCopilotToolCall(name: string, args: Record<string, unknown>, context: TradingContext): Promise<CopilotToolResult> {
  const allowsUniverseScope = name === 'screen_clean_universe';
  if (!allowsUniverseScope) {
    const symbolCheck = isSymbolRequestAllowed(context, args?.symbol);
    if (!symbolCheck.ok) {
      return { ok: false, tool: name, error: symbolCheck.error };
    }
  }

  switch (name) {
    case 'get_chart_snapshot':
      return buildChartSnapshot(context);
    case 'get_candidate_details':
      return buildCandidateDetails(context);
    case 'get_fundamentals_snapshot':
      return buildFundamentalsSnapshot(context);
    case 'get_social_buzz':
      return buildSocialBuzzSnapshot(context);
    case 'get_consumer_cycle_context':
      return buildConsumerCycleContextSnapshot(context);
    case 'screen_clean_universe':
      return buildCleanUniverseScreen(context, args);
    case 'get_ledger_context':
      return buildLedgerContextSnapshot(context, args);
    case 'refresh_filing_coverage':
      return refreshLedgerFilingCoverage(context, args);
    case 'verify_special_situation_web': {
      const ledgerContext = await buildLedgerContextSnapshot(context, {
        query: trimString(args?.query) || LEDGER_HARD_FLAG_QUERY,
        top_k: Number.isFinite(Number(args?.top_k)) ? args.top_k : 6,
      });
      if (!ledgerContext.ok) {
        return {
          ok: false,
          tool: name,
          error: ledgerContext.error || 'Failed to load the local Ledger special-situation context first.',
        };
      }
      return buildSpecialSituationWebVerification(context, ledgerContext.data, args);
    }
    case 'run_financial_analysis':
      return buildLedgerWorkflowResult(context, args, 'financial_analysis');
    case 'run_earnings_quality':
      return buildLedgerWorkflowResult(context, args, 'earnings_quality');
    case 'run_dcf_valuation':
      return buildLedgerWorkflowResult(context, args, 'dcf_valuation');
    default:
      return {
        ok: false,
        tool: name,
        error: `Unknown tool: ${name}`,
      };
  }
}
