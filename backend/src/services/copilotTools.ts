import fetch from 'node-fetch';
import type { TradingContext, AIRole } from './visionService';
import { runEarningsQualityEngine, runFinancialAnalysisEngine, runDcfValuationEngine } from './ledgerEngines';

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

const SCANNER_TOOL_ROLES: AIRole[] = ['pattern_analyst', 'contextual_ranker'];
const WORKSPACE_SCANNER_ANALYSTS: WorkspaceAnalystId[] = [
  'scanner_copilot',
  'pattern_analyst',
  'technical_analyst',
];

function trimString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
  return entry && typeof entry === 'object' ? toFiniteNumber(entry.value) : null;
}

function buildLedgerWorkflowBase(
  ledgerData: any,
  workflow: 'financial_analysis' | 'earnings_quality' | 'dcf_valuation'
): any {
  const snapshot = ledgerData?.snapshot || {};
  const latestAnnual = ledgerData?.statement_backbone?.latest_annual || null;
  const latestQuarterly = ledgerData?.statement_backbone?.latest_quarterly || null;
  const annualRevenue = pickMetricValue(latestAnnual, 'revenue');
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
    return {
      ok: true,
      tool: 'get_ledger_context',
      data: summarizeLedgerContextPayload(payload.data),
    };
  } catch (error: any) {
    return {
      ok: false,
      tool: 'get_ledger_context',
      error: error?.message || 'Failed to load ledger context',
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

  const base = buildLedgerWorkflowBase(ledgerContext.data, workflow);
  if (workflow === 'financial_analysis') {
    const engineResult = runFinancialAnalysisEngine(base);
    return {
      ok: true,
      tool: 'run_financial_analysis',
      data: {
        ...base,
        ...engineResult,
        output_contract: [
          'business_summary',
          'financial_quality',
          'financial_risk',
          'competitive_advantage',
          'capital_allocation',
          'valuation_method_used',
          'intrinsic_value_conclusion',
          'price_vs_value_judgment',
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
    return {
      ok: true,
      tool: 'run_earnings_quality',
      data: {
        ...base,
        ...engineResult,
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
          'key_evidence_refs',
          'confidence_level',
        ],
      },
    };
  }

  return {
    ok: true,
    tool: 'run_dcf_valuation',
    data: {
      ...base,
      ...runDcfValuationEngine(base, {
        revenue_growth_near_term_pct: toFiniteNumber(args?.revenue_growth_near_term_pct),
        target_operating_margin_pct: toFiniteNumber(args?.target_operating_margin_pct),
        discount_rate_pct: toFiniteNumber(args?.discount_rate_pct),
        terminal_growth_pct: toFiniteNumber(args?.terminal_growth_pct),
        forecast_years: toFiniteNumber(args?.forecast_years),
      }),
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
- If the user asks for a full company review, call run_financial_analysis.
- If the user asks about accounting quality, earnings quality, cash conversion, dilution, or distortions, call run_earnings_quality.
- If the user asks for DCF, fair value, intrinsic value, or overvalued/undervalued judgment, call run_dcf_valuation.

TOOL LIST:
${tools.map(tool => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}
`;
}

export async function executeCopilotToolCall(name: string, args: Record<string, unknown>, context: TradingContext): Promise<CopilotToolResult> {
  const symbolCheck = isSymbolRequestAllowed(context, args?.symbol);
  if (!symbolCheck.ok) {
    return { ok: false, tool: name, error: symbolCheck.error };
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
    case 'get_ledger_context':
      return buildLedgerContextSnapshot(context, args);
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
