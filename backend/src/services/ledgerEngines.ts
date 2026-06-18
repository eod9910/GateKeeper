import * as fs from 'fs';
import * as path from 'path';
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

type ReitMultipleBand = { low: number; mid: number; high: number };

type OperatingDcfConfig = {
  schema_version: number;
  engine_class: 'dcf_operating';
  valuation_method: string;
  forecast_years: { default: number; min: number; max: number };
  near_term_revenue_growth_pct: {
    default_when_unavailable: number;
    observed_growth_multiplier: number;
    min: number;
    max: number;
  };
  target_operating_margin_pct: {
    default_when_unavailable: number;
    observed_margin_add_pct: number;
    observed_margin_floor_pct: number;
    min: number;
    max: number;
  };
  target_free_cash_flow_margin_pct: {
    conversion_ratio_floor: number;
    min: number;
    fallback_starting_margin_multiplier: number;
  };
  discount_rate_pct: {
    base_default: number;
    quality_premiums: Record<string, number>;
    current_ratio_below_one_premium: number;
    likely_rich_premium: number;
    min: number;
    max: number;
    default_min: number;
    default_max: number;
  };
  terminal_growth_pct: {
    default: number;
    min: number;
    spread_below_discount_rate_pct: number;
    minimum_dynamic_max: number;
  };
  scenario_spreads: {
    bear: {
      revenue_growth_delta_pct: number;
      target_fcf_margin_delta_pct: number;
      discount_rate_delta_pct: number;
      terminal_growth_delta_pct: number;
    };
    bull: {
      revenue_growth_delta_pct: number;
      target_fcf_margin_delta_pct: number;
      discount_rate_delta_pct: number;
      terminal_growth_delta_pct: number;
    };
  };
};

type ReitAffoConfig = {
  schema_version: number;
  engine_class: 'reit_affo';
  valuation_method: string;
  property_type_multiple_bands: Record<string, ReitMultipleBand>;
  default_affo_multiple_adjustments: {
    revenue_growth_divisor: number;
    revenue_growth_min_delta: number;
    revenue_growth_max_delta: number;
    quality_premiums: Record<string, number>;
    debt_to_equity_threshold: number;
    debt_to_equity_penalty: number;
  };
  scenario_spreads: {
    bear: {
      affo_multiple_delta: number;
      affo_growth_delta_pct: number;
      affo_growth_min_pct: number;
      affo_growth_max_pct: number;
      multiple_low_floor: number;
      multiple_low_extra_room: number;
    };
    base: {
      default_affo_growth_pct: number;
      affo_growth_min_pct: number;
      affo_growth_max_pct: number;
    };
    bull: {
      affo_multiple_delta: number;
      affo_growth_delta_pct: number;
      affo_growth_min_pct: number;
      affo_growth_max_pct: number;
      multiple_high_extra_room: number;
    };
  };
  required_inputs: string[];
  model_limitations: string[];
};

type SpecialSituationConfig = {
  schema_version: number;
  engine_class: 'special_situation';
  valuation_method: string;
  scenario_spreads: {
    bear: {
      revenue_growth_delta_pct: number;
      ev_sales_multiple_delta: number;
      survival_probability_pct: number;
    };
    base: {
      default_revenue_growth_pct: number;
      survival_probability_pct: number;
    };
    bull: {
      revenue_growth_delta_pct: number;
      ev_sales_multiple_delta: number;
      survival_probability_pct: number;
    };
  };
  default_ev_sales_multiple: {
    base: number;
    min: number;
    max: number;
  };
  required_inputs: string[];
  model_limitations: string[];
};

type RelativeMultiplesConfig = {
  schema_version: number;
  engine_class: 'relative_multiples';
  valuation_method: string;
  small_cap_market_cap_ceiling: number;
  unstable_market_cap_ceiling: number;
  sector_ev_sales_bands: Record<string, ReitMultipleBand>;
  sector_price_book_bands: Record<string, ReitMultipleBand>;
  blend_weights: {
    ev_sales: number;
    price_book: number;
  };
  risk_haircut: {
    base_pct: number;
    weak_quality_extra_pct: number;
    mixed_quality_extra_pct: number;
    high_leverage_extra_pct: number;
    negative_fcf_extra_pct: number;
    debt_to_equity_threshold: number;
    max_pct: number;
  };
  required_inputs: string[];
  model_limitations: string[];
};

type AssetManagerFreConfig = {
  schema_version: number;
  engine_class: 'asset_manager_fre';
  valuation_method: string;
  fre_multiple_bands: ReitMultipleBand;
  carry_multiple_bands: ReitMultipleBand;
  default_fee_earnings_margin_pct: number;
  revenue_growth_multiple_adjustment: {
    divisor: number;
    min_delta: number;
    max_delta: number;
  };
  quality_premiums: Record<string, number>;
  required_inputs: string[];
  model_limitations: string[];
};

type ValuationAuditConfig = {
  schema_version: number;
  purpose: string;
  severity_levels: string[];
  global_rules: {
    require_current_price: boolean;
    require_fair_value_range: boolean;
    warn_when_price_vs_mid_abs_pct_above: number;
    warn_when_confidence_above_low_with_proxy_inputs: boolean;
  };
  operating_dcf_rules: {
    allowed_valuation_methods: string[];
    require_forecast_years: boolean;
    require_bear_base_bull: boolean;
    max_terminal_value_pct_of_equity_value: number;
    terminal_growth_must_be_below_discount_rate: boolean;
    minimum_discount_rate_spread_pct: number;
    warn_when_discount_rate_below_pct: number;
    warn_when_terminal_growth_above_pct: number;
    required_base_inputs: string[];
  };
  reit_affo_rules: {
    allowed_valuation_methods: string[];
    required_engine_class: string;
    require_affo_or_ffo_proxy: boolean;
    require_property_type: boolean;
    warn_on_proxy_cash_metric_sources: string[];
    warn_when_payout_ratio_pct_above: number;
    required_context_checks: string[];
  };
};

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEDGER_VALUATION_MODEL_ROOT = path.join(
  PROJECT_ROOT,
  'workspace',
  'Financial Analyst Workspace',
  'references',
  'valuation-models',
);

const DEFAULT_OPERATING_DCF_CONFIG: OperatingDcfConfig = {
  schema_version: 1,
  engine_class: 'dcf_operating',
  valuation_method: 'simplified_fcfe_dcf',
  forecast_years: { default: 7, min: 4, max: 12 },
  near_term_revenue_growth_pct: {
    default_when_unavailable: 8,
    observed_growth_multiplier: 0.7,
    min: 1,
    max: 25,
  },
  target_operating_margin_pct: {
    default_when_unavailable: 12,
    observed_margin_add_pct: 3,
    observed_margin_floor_pct: 10,
    min: 4,
    max: 35,
  },
  target_free_cash_flow_margin_pct: {
    conversion_ratio_floor: 0.55,
    min: 2,
    fallback_starting_margin_multiplier: 0.7,
  },
  discount_rate_pct: {
    base_default: 9,
    quality_premiums: { weak: 2, mixed: 1, good: 0, high: 0 },
    current_ratio_below_one_premium: 1,
    likely_rich_premium: 0.5,
    min: 6,
    max: 18,
    default_min: 8,
    default_max: 14,
  },
  terminal_growth_pct: {
    default: 3,
    min: 1,
    spread_below_discount_rate_pct: 2.5,
    minimum_dynamic_max: 1.5,
  },
  scenario_spreads: {
    bear: {
      revenue_growth_delta_pct: -4,
      target_fcf_margin_delta_pct: -1.5,
      discount_rate_delta_pct: 1,
      terminal_growth_delta_pct: -0.5,
    },
    bull: {
      revenue_growth_delta_pct: 4,
      target_fcf_margin_delta_pct: 1.5,
      discount_rate_delta_pct: -1,
      terminal_growth_delta_pct: 0.5,
    },
  },
};

const DEFAULT_REIT_AFFO_CONFIG: ReitAffoConfig = {
  schema_version: 1,
  engine_class: 'reit_affo',
  valuation_method: 'reit_affo_nav_proxy',
  property_type_multiple_bands: {
    data_center: { low: 17, mid: 21, high: 25 },
    industrial: { low: 16, mid: 20, high: 24 },
    self_storage: { low: 15, mid: 18, high: 22 },
    residential: { low: 13, mid: 16, high: 20 },
    net_lease: { low: 12, mid: 15, high: 18 },
    healthcare: { low: 11, mid: 14, high: 17 },
    retail: { low: 10, mid: 13, high: 16 },
    office: { low: 7, mid: 10, high: 13 },
    lodging: { low: 8, mid: 11, high: 14 },
    diversified: { low: 11, mid: 15, high: 19 },
  },
  default_affo_multiple_adjustments: {
    revenue_growth_divisor: 5,
    revenue_growth_min_delta: -2,
    revenue_growth_max_delta: 3,
    quality_premiums: { high: 1.5, good: 0.75, mixed: 0, weak: -1.5 },
    debt_to_equity_threshold: 100,
    debt_to_equity_penalty: 1.5,
  },
  scenario_spreads: {
    bear: {
      affo_multiple_delta: -2.5,
      affo_growth_delta_pct: -2,
      affo_growth_min_pct: -3,
      affo_growth_max_pct: 8,
      multiple_low_floor: 6,
      multiple_low_extra_room: 2,
    },
    base: {
      default_affo_growth_pct: 2.5,
      affo_growth_min_pct: -2,
      affo_growth_max_pct: 10,
    },
    bull: {
      affo_multiple_delta: 2.5,
      affo_growth_delta_pct: 2,
      affo_growth_min_pct: 0,
      affo_growth_max_pct: 12,
      multiple_high_extra_room: 2,
    },
  },
  required_inputs: [
    'AFFO/FFO per share or operating-cash-flow proxy',
    'current price',
  ],
  model_limitations: [
    'This is a REIT-specific AFFO/FFO multiple proxy, not an industrial free-cash-flow DCF.',
    'If true AFFO/FFO or NAV facts are unavailable, operating cash flow is used only as a provisional proxy.',
    'NAV is not blended unless property NOI and cap-rate inputs are explicitly available.',
  ],
};

const DEFAULT_SPECIAL_SITUATION_CONFIG: SpecialSituationConfig = {
  schema_version: 1,
  engine_class: 'special_situation',
  valuation_method: 'special_situation_post_reorg_scenario',
  scenario_spreads: {
    bear: {
      revenue_growth_delta_pct: -15,
      ev_sales_multiple_delta: -1.2,
      survival_probability_pct: 35,
    },
    base: {
      default_revenue_growth_pct: 5,
      survival_probability_pct: 55,
    },
    bull: {
      revenue_growth_delta_pct: 15,
      ev_sales_multiple_delta: 1.5,
      survival_probability_pct: 75,
    },
  },
  default_ev_sales_multiple: {
    base: 2,
    min: 0.25,
    max: 8,
  },
  required_inputs: [
    'post-reorg share count',
    'post-reorg cash and debt',
    'remaining claims, warrants, or contingent equity',
    'normalized revenue base',
    'path to free-cash-flow breakeven',
    'scenario EV multiple or normalized EBITDA/FCF anchor',
  ],
  model_limitations: [
    'This is a special-situation scenario and equity-waterfall framework, not a normal operating-company DCF.',
    'The output is highly sensitive to post-reorg capital structure, dilution, liquidity runway, and execution against the operating reset.',
    'If confirmed plan terms are missing, treat the value range as a placeholder for what must be underwritten rather than a precise fair value.',
  ],
};

const DEFAULT_RELATIVE_MULTIPLES_CONFIG: RelativeMultiplesConfig = {
  schema_version: 1,
  engine_class: 'relative_multiples',
  valuation_method: 'relative_multiple_asset_floor',
  small_cap_market_cap_ceiling: 300000000,
  unstable_market_cap_ceiling: 2000000000,
  sector_ev_sales_bands: {
    technology: { low: 1.5, mid: 3.0, high: 6.0 },
    'communication services': { low: 1.0, mid: 2.5, high: 5.0 },
    healthcare: { low: 1.2, mid: 2.8, high: 5.5 },
    'consumer cyclical': { low: 0.5, mid: 1.2, high: 2.5 },
    'consumer defensive': { low: 0.6, mid: 1.3, high: 2.5 },
    industrials: { low: 0.7, mid: 1.5, high: 3.0 },
    'basic materials': { low: 0.5, mid: 1.2, high: 2.5 },
    energy: { low: 0.5, mid: 1.2, high: 2.5 },
    utilities: { low: 1.0, mid: 2.0, high: 3.5 },
    'real estate': { low: 1.5, mid: 3.0, high: 6.0 },
    diversified: { low: 0.7, mid: 1.5, high: 3.0 },
  },
  sector_price_book_bands: {
    technology: { low: 1.2, mid: 2.5, high: 4.5 },
    'communication services': { low: 0.9, mid: 1.8, high: 3.5 },
    healthcare: { low: 1.0, mid: 2.2, high: 4.0 },
    'consumer cyclical': { low: 0.7, mid: 1.5, high: 3.0 },
    'consumer defensive': { low: 0.9, mid: 1.8, high: 3.2 },
    industrials: { low: 0.8, mid: 1.6, high: 3.0 },
    'basic materials': { low: 0.6, mid: 1.3, high: 2.4 },
    energy: { low: 0.6, mid: 1.2, high: 2.2 },
    utilities: { low: 0.8, mid: 1.4, high: 2.2 },
    'real estate': { low: 0.7, mid: 1.3, high: 2.2 },
    diversified: { low: 0.8, mid: 1.6, high: 3.0 },
  },
  blend_weights: { ev_sales: 0.6, price_book: 0.4 },
  risk_haircut: {
    base_pct: 5,
    weak_quality_extra_pct: 15,
    mixed_quality_extra_pct: 7,
    high_leverage_extra_pct: 10,
    negative_fcf_extra_pct: 10,
    debt_to_equity_threshold: 150,
    max_pct: 40,
  },
  required_inputs: [
    'annual revenue with shares outstanding, or book value per share',
    'current price',
  ],
  model_limitations: [
    'This is a relative-multiple and asset-floor proxy for small/micro-cap or non-normalizable operating companies, not a discounted-cash-flow valuation.',
    'Sector multiple bands are static reference ranges, not live peer-group medians; treat the output as a wide, low-confidence band.',
    'A risk haircut is applied for weak cash-flow quality, high leverage, and negative free cash flow, but the model cannot fully price going-concern, dilution, or covenant risk.',
    'EV/EBITDA and P/E cross-checks are not applied when EBITDA or earnings are negative or distorted; EV/Sales and Price/Book carry the estimate.',
  ],
};

const DEFAULT_ASSET_MANAGER_FRE_CONFIG: AssetManagerFreConfig = {
  schema_version: 1,
  engine_class: 'asset_manager_fre',
  valuation_method: 'asset_manager_fre_distributable_earnings',
  fre_multiple_bands: { low: 14, mid: 19, high: 24 },
  carry_multiple_bands: { low: 4, mid: 7, high: 10 },
  default_fee_earnings_margin_pct: 35,
  revenue_growth_multiple_adjustment: {
    divisor: 4,
    min_delta: -3,
    max_delta: 4,
  },
  quality_premiums: {
    high: 2,
    good: 1,
    mixed: 0,
    weak: -2,
  },
  required_inputs: [
    'fee-related earnings, distributable earnings, adjusted net income, free cash flow, or revenue proxy',
    'shares outstanding',
    'current price',
  ],
  model_limitations: [
    'This is a first-pass asset-manager valuation built around fee-related or distributable earnings, not book value.',
    'When true FRE, distributable earnings, incentive fees, carry, or AUM are missing, the model falls back to generic financial-statement proxies and confidence should stay low.',
    'Carry and performance fees are cyclical and path-dependent; a static multiple cannot fully value fund marks, realization timing, fundraising cadence, or fee-rate compression.',
    'A dedicated peer set and segment-level FRE/carry extraction should replace the proxy assumptions once those data points are collected.',
  ],
};

const DEFAULT_VALUATION_AUDIT_CONFIG: ValuationAuditConfig = {
  schema_version: 1,
  purpose: 'Post-valuation QA rules that make sure backend valuation outputs follow Ledger workspace doctrine.',
  severity_levels: ['critical', 'warning', 'info'],
  global_rules: {
    require_current_price: true,
    require_fair_value_range: true,
    warn_when_price_vs_mid_abs_pct_above: 75,
    warn_when_confidence_above_low_with_proxy_inputs: true,
  },
  operating_dcf_rules: {
    allowed_valuation_methods: ['simplified_fcfe_dcf'],
    require_forecast_years: true,
    require_bear_base_bull: true,
    max_terminal_value_pct_of_equity_value: 75,
    terminal_growth_must_be_below_discount_rate: true,
    minimum_discount_rate_spread_pct: 0.5,
    warn_when_discount_rate_below_pct: 6,
    warn_when_terminal_growth_above_pct: 5,
    required_base_inputs: [
      'annual_revenue',
      'quality_adjusted_free_cash_flow',
      'shares_outstanding',
      'current_price',
    ],
  },
  reit_affo_rules: {
    allowed_valuation_methods: ['reit_affo_nav_proxy'],
    required_engine_class: 'reit_affo',
    require_affo_or_ffo_proxy: true,
    require_property_type: true,
    warn_on_proxy_cash_metric_sources: [
      'operating_cash_flow_proxy',
      'net_income_proxy',
    ],
    warn_when_payout_ratio_pct_above: 95,
    required_context_checks: [
      'dividend_coverage',
      'nav_cap_rate_cross_check',
      'fixed_charge_coverage_and_debt_maturities',
    ],
  },
};

function mergeRecord<T extends Record<string, any>>(fallback: T, override: any): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return fallback;
  const merged: Record<string, any> = { ...fallback };
  for (const [key, value] of Object.entries(override)) {
    const fallbackValue = (fallback as Record<string, any>)[key];
    if (
      fallbackValue
      && typeof fallbackValue === 'object'
      && !Array.isArray(fallbackValue)
      && value
      && typeof value === 'object'
      && !Array.isArray(value)
    ) {
      merged[key] = mergeRecord(fallbackValue, value);
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}

function loadLedgerValuationConfig<T extends Record<string, any>>(relativePath: string, fallback: T): T {
  try {
    const configPath = path.join(LEDGER_VALUATION_MODEL_ROOT, relativePath);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return mergeRecord(fallback, parsed);
  } catch {
    return fallback;
  }
}

const OPERATING_DCF_CONFIG = loadLedgerValuationConfig(
  path.join('operating-dcf', 'config.json'),
  DEFAULT_OPERATING_DCF_CONFIG,
);
const REIT_AFFO_CONFIG = loadLedgerValuationConfig(
  path.join('reit-affo-nav', 'config.json'),
  DEFAULT_REIT_AFFO_CONFIG,
);
const SPECIAL_SITUATION_CONFIG = loadLedgerValuationConfig(
  path.join('special-situations', 'config.json'),
  DEFAULT_SPECIAL_SITUATION_CONFIG,
);
const RELATIVE_MULTIPLES_CONFIG = loadLedgerValuationConfig(
  path.join('smallcap-relative-multiples', 'config.json'),
  DEFAULT_RELATIVE_MULTIPLES_CONFIG,
);
const VALUATION_AUDIT_CONFIG = loadLedgerValuationConfig(
  path.join('valuation-audit', 'config.json'),
  DEFAULT_VALUATION_AUDIT_CONFIG,
);

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
  const companyName = trimString(snapshot?.companyName)?.toLowerCase()
    || trimString(snapshot?.name)?.toLowerCase()
    || trimString(snapshot?.sec_name)?.toLowerCase()
    || '';
  const description = trimString(snapshot?.businessDescription)?.toLowerCase() || '';
  const haystack = `${sector} ${industry} ${companyName} ${description}`;
  if (/\breit\b|\breal estate investment trust\b/.test(haystack)) {
    return false;
  }
  if (isCapitalLightFinancialForDcf(snapshot)) {
    return false;
  }
  return /\bfinancial\b|\bbank\b|\bbanks\b|\binsurance\b|\bcredit\b|\blender\b|\blending\b|\bmortgage\b|\basset management\b|\bcapital markets\b|\bconsumer finance\b/.test(haystack);
}

function isReitLikeForDcf(snapshot: Record<string, any> | null | undefined): boolean {
  const sector = trimString(snapshot?.sector)?.toLowerCase() || '';
  const industry = trimString(snapshot?.industry)?.toLowerCase() || '';
  const companyName = trimString(snapshot?.companyName)?.toLowerCase()
    || trimString(snapshot?.name)?.toLowerCase()
    || trimString(snapshot?.sec_name)?.toLowerCase()
    || '';
  const description = trimString(snapshot?.businessDescription)?.toLowerCase() || '';
  return /\breit\b|\breal estate investment trust\b/.test(`${sector} ${industry} ${companyName} ${description}`);
}

function isCapitalLightFinancialForDcf(snapshot: Record<string, any> | null | undefined): boolean {
  const industry = trimString(snapshot?.industry)?.toLowerCase() || '';
  const companyName = trimString(snapshot?.companyName)?.toLowerCase()
    || trimString(snapshot?.name)?.toLowerCase()
    || trimString(snapshot?.sec_name)?.toLowerCase()
    || '';
  const description = trimString(snapshot?.businessDescription)?.toLowerCase() || '';
  return /\b(asset management|investment management|wealth management|alternative asset|private equity|investment advisory|fund manager|capital markets)\b/.test(`${industry} ${companyName} ${description}`);
}

/**
 * Runtime check (not persisted): an operating company is better valued with relative
 * multiples + asset floor than with a multi-stage DCF when it is small/micro-cap, or when
 * its cash-flow base is not normalizable (no positive operating or free cash flow to
 * forecast from). This only ever upgrades a `dcf_operating` resolution; business-model
 * classes (financial, REIT, pre-profit, special situation) are left untouched.
 */
function shouldUseRelativeMultiplesEngine(ledgerBase: LedgerContextSummary): boolean {
  const snapshot = ledgerBase?.current_snapshot || {};
  const marketCap = toFiniteNumber(snapshot.marketCap);
  if (marketCap != null && marketCap > 0 && marketCap < RELATIVE_MULTIPLES_CONFIG.small_cap_market_cap_ceiling) {
    return true;
  }
  // The cash-flow-instability leg is gated to smaller names. A large-cap with one
  // negative-FCF (growth-capex) year is still a DCF candidate; generic sector multiples
  // would misvalue a premium compounder. Above the unstable ceiling we leave it on DCF.
  if (marketCap != null && marketCap >= RELATIVE_MULTIPLES_CONFIG.unstable_market_cap_ceiling) {
    return false;
  }
  const freeCashFlow = toFiniteNumber(snapshot.freeCashFlowTTM);
  const operatingCashFlow = toFiniteNumber(snapshot.operatingCashFlowTTM);
  // Only treat the base as non-normalizable when there is ACTUAL evidence of non-positive
  // cash flow and no evidence of positive cash flow. Missing data must not misroute an
  // otherwise-healthy name (e.g. a name whose snapshot lacks cash-flow fields).
  const anyPresentNonPositive = (freeCashFlow != null && freeCashFlow <= 0)
    || (operatingCashFlow != null && operatingCashFlow <= 0);
  const anyPositive = (freeCashFlow != null && freeCashFlow > 0)
    || (operatingCashFlow != null && operatingCashFlow > 0);
  return anyPresentNonPositive && !anyPositive;
}

function resolveValuationEngineClass(ledgerBase: LedgerContextSummary): string {
  const symbol = trimString(ledgerBase?.symbol);
  const snapshot = ledgerBase?.current_snapshot || {};
  const hardFlags = detectLedgerHardFlags(ledgerBase);
  if (hardFlags.length) {
    return 'special_situation';
  }
  let resolved: string | null = null;
  const stored = symbol ? getSymbolClassification(symbol) : null;
  if (stored?.valuationEngineClass) {
    resolved = stored.valuationEngineClass;
    const routingSnapshot = {
      ...snapshot,
      sector: trimString(snapshot.sector) || stored.sector,
      industry: trimString(snapshot.industry) || stored.industry,
    };
    if (resolved === 'roe_book_value' && isReitLikeForDcf(routingSnapshot)) {
      resolved = 'reit_affo';
    } else if (resolved === 'roe_book_value' && isCapitalLightFinancialForDcf(routingSnapshot)) {
      resolved = 'dcf_operating';
    }
  } else {
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
      resolved = inferred.valuationEngineClass;
    }
  }
  if (!resolved) {
    resolved = isFinancialCompanyForDcf(snapshot) ? 'roe_book_value' : 'dcf_operating';
  }
  // Size / stability override is a runtime routing decision, not a persisted classification.
  if (resolved === 'dcf_operating' && shouldUseRelativeMultiplesEngine(ledgerBase)) {
    return 'relative_multiples';
  }
  return resolved;
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

function buildDcfCoverageAssessment(args: {
  latestAnnual?: LedgerPeriod | null;
  evidenceAssessment: LedgerEvidenceAssessment;
  annualRevenue: unknown;
  freeCashFlow: unknown;
  normalizedFcf: unknown;
  sharesOutstanding: unknown;
  currentPrice: unknown;
  operatingMarginPct: unknown;
  currentFcfMarginPct: unknown;
  retrievalCount: number;
}): Record<string, any> {
  const latestAnnual = args.latestAnnual || null;
  const metrics = latestAnnual?.metrics || {};
  const missingCoreInputs = cleanList([
    hasFiniteNumber(args.annualRevenue) ? null : 'annual revenue',
    hasFiniteNumber(args.freeCashFlow) || hasFiniteNumber(args.normalizedFcf) ? null : 'free cash flow',
    hasFiniteNumber(args.sharesOutstanding) ? null : 'shares outstanding',
    hasFiniteNumber(args.currentPrice) ? null : 'current price',
  ], 8);
  const missingSupportInputs = cleanList([
    latestAnnual ? null : 'latest annual statement',
    hasFiniteNumber(args.operatingMarginPct) ? null : 'operating margin',
    hasFiniteNumber(args.currentFcfMarginPct) ? null : 'free cash flow margin',
    trimString(metrics.revenue?.source_type) ? null : 'revenue source evidence',
    trimString(metrics.free_cash_flow?.source_type) || trimString(metrics.operating_cash_flow?.source_type) ? null : 'cash-flow source evidence',
  ], 8);
  const filingBackedInputs = [
    trimString(metrics.revenue?.source_type),
    trimString(metrics.free_cash_flow?.source_type) || trimString(metrics.operating_cash_flow?.source_type),
    trimString(metrics.net_income?.source_type),
  ].filter(Boolean);
  const hasFilingBackedInputs = filingBackedInputs.some((source) => String(source).startsWith('sec_'));
  const fallbackInputs = cleanList([
    !trimString(metrics.revenue?.source_type) && hasFiniteNumber(args.annualRevenue) ? 'annual revenue fallback' : null,
    !trimString(metrics.free_cash_flow?.source_type) && hasFiniteNumber(args.freeCashFlow) ? 'free cash flow fallback' : null,
    !trimString(metrics.operating_cash_flow?.source_type) && !trimString(metrics.free_cash_flow?.source_type) && hasFiniteNumber(args.normalizedFcf) ? 'cash-flow fallback' : null,
  ], 8);

  const quality = missingCoreInputs.length
    ? 'unavailable'
    : !hasFilingBackedInputs || fallbackInputs.length || missingSupportInputs.length >= 3
      ? 'partial'
      : args.evidenceAssessment.analysisMode !== 'filing_backed'
        ? 'partial'
        : 'good';

  return {
    quality,
    status: missingCoreInputs.length ? 'blocked' : quality === 'good' ? 'usable' : 'usable_with_caution',
    core_inputs_present: missingCoreInputs.length === 0,
    missing_core_inputs: missingCoreInputs,
    missing_support_inputs: missingSupportInputs,
    fallback_inputs: fallbackInputs,
    filing_backed_inputs: filingBackedInputs,
    latest_annual_period_end: latestAnnual?.period_end || null,
    latest_annual_available_at: latestAnnual?.available_at || null,
    coverage_tier: args.evidenceAssessment.coverageTier,
    analysis_mode: args.evidenceAssessment.analysisMode,
    retrieval_evidence_count: args.retrievalCount,
    summary: missingCoreInputs.length
      ? `DCF unavailable: missing ${missingCoreInputs.join(', ')}.`
      : quality === 'good'
        ? 'DCF inputs are filing-backed and complete enough for a normal current valuation read.'
        : 'DCF can be calculated, but some inputs rely on fallbacks or thinner supporting evidence.',
  };
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

type ValuationAuditFinding = {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
};

function buildValuationAudit(
  result: Record<string, any>,
  engineClass: 'dcf_operating' | 'reit_affo' | 'relative_multiples',
): Record<string, any> {
  const config = VALUATION_AUDIT_CONFIG;
  const findings: ValuationAuditFinding[] = [];
  const addFinding = (severity: ValuationAuditFinding['severity'], code: string, message: string) => {
    findings.push({ severity, code, message });
  };

  const range = result.fair_value_range || {};
  const currentPrice = toFiniteNumber(range.current_price ?? result.normalized_cash_flow_base?.current_price ?? result.normalized_reit_base?.current_price);
  const midpoint = toFiniteNumber(range.mid_per_share);
  if (config.global_rules.require_current_price && !hasFiniteNumber(currentPrice)) {
    addFinding('critical', 'missing_current_price', 'Current price is missing, so price-versus-value judgment is not reliable.');
  }
  if (config.global_rules.require_fair_value_range && !hasFiniteNumber(midpoint)) {
    addFinding('critical', 'missing_fair_value_midpoint', 'Fair value midpoint is missing from the valuation output.');
  }
  if (hasFiniteNumber(currentPrice) && hasFiniteNumber(midpoint) && Number(currentPrice) > 0) {
    const gapAbs = Math.abs(((Number(midpoint) - Number(currentPrice)) / Number(currentPrice)) * 100);
    if (gapAbs > config.global_rules.warn_when_price_vs_mid_abs_pct_above) {
      addFinding('warning', 'large_price_value_gap', `The midpoint differs from current price by about ${gapAbs.toFixed(1)}%; verify price freshness, share count, and input scale.`);
    }
  }

  if (engineClass === 'dcf_operating') {
    const rules = config.operating_dcf_rules;
    if (!rules.allowed_valuation_methods.includes(String(result.valuation_method || ''))) {
      addFinding('critical', 'unexpected_dcf_method', `Operating DCF returned unexpected valuation method: ${result.valuation_method || 'missing'}.`);
    }
    const scenarios = Array.isArray(result.scenario_outputs) ? result.scenario_outputs : [];
    const scenarioNames = new Set(scenarios.map((row) => String(row?.scenario || '')));
    if (rules.require_bear_base_bull && !(['bear', 'base', 'bull'].every((name) => scenarioNames.has(name)))) {
      addFinding('critical', 'missing_scenarios', 'DCF output does not include all bear/base/bull scenarios.');
    }
    const base = scenarios.find((row) => row?.scenario === 'base') || null;
    const baseAssumptions = base?.assumptions || result.base_case_assumptions || {};
    const discountRate = toFiniteNumber(baseAssumptions.discount_rate_pct);
    const terminalGrowth = toFiniteNumber(baseAssumptions.terminal_growth_pct);
    if (rules.require_forecast_years && !hasFiniteNumber(baseAssumptions.forecast_years)) {
      addFinding('warning', 'missing_forecast_years', 'DCF base-case assumptions do not expose forecast years.');
    }
    if (hasFiniteNumber(discountRate) && hasFiniteNumber(terminalGrowth)) {
      if (rules.terminal_growth_must_be_below_discount_rate && Number(terminalGrowth) >= Number(discountRate)) {
        addFinding('critical', 'terminal_growth_not_below_discount_rate', 'Terminal growth is not below the discount rate.');
      } else if (Number(discountRate) - Number(terminalGrowth) < rules.minimum_discount_rate_spread_pct) {
        addFinding('warning', 'thin_discount_terminal_spread', 'Discount rate spread over terminal growth is very thin.');
      }
      if (Number(discountRate) < rules.warn_when_discount_rate_below_pct) {
        addFinding('warning', 'low_discount_rate', `Discount rate is below ${rules.warn_when_discount_rate_below_pct}%.`);
      }
      if (Number(terminalGrowth) > rules.warn_when_terminal_growth_above_pct) {
        addFinding('warning', 'high_terminal_growth', `Terminal growth is above ${rules.warn_when_terminal_growth_above_pct}%.`);
      }
    }
    const pvTerminal = toFiniteNumber(base?.present_value_of_terminal_value);
    const equityValue = toFiniteNumber(base?.equity_value);
    if (hasFiniteNumber(pvTerminal) && hasFiniteNumber(equityValue) && Number(equityValue) > 0) {
      const terminalPct = (Number(pvTerminal) / Number(equityValue)) * 100;
      if (terminalPct > rules.max_terminal_value_pct_of_equity_value) {
        addFinding('warning', 'terminal_value_dominance', `Terminal value is about ${terminalPct.toFixed(1)}% of base-case equity value.`);
      }
    }
    const normalizedBase = result.normalized_cash_flow_base || {};
    for (const key of rules.required_base_inputs) {
      if (!hasFiniteNumber(normalizedBase[key])) {
        addFinding('critical', `missing_dcf_input_${key}`, `DCF normalized base is missing ${key}.`);
      }
    }
  }

  if (engineClass === 'reit_affo') {
    const rules = config.reit_affo_rules;
    if (!rules.allowed_valuation_methods.includes(String(result.valuation_method || ''))) {
      addFinding('critical', 'unexpected_reit_method', `REIT valuation returned unexpected valuation method: ${result.valuation_method || 'missing'}.`);
    }
    if (String(result.valuation_engine_class || '') !== rules.required_engine_class) {
      addFinding('critical', 'wrong_reit_engine_class', 'REIT valuation did not return the required reit_affo engine class.');
    }
    const normalizedBase = result.normalized_reit_base || {};
    if (rules.require_affo_or_ffo_proxy && !hasFiniteNumber(normalizedBase.affo_per_share)) {
      addFinding('critical', 'missing_affo_per_share', 'REIT valuation is missing AFFO/FFO per share or a proxy.');
    }
    if (rules.require_property_type && !trimString(normalizedBase.property_type)) {
      addFinding('warning', 'missing_property_type', 'REIT valuation did not expose property type.');
    }
    const cashMetricSource = trimString(normalizedBase.cash_metric_source);
    if (cashMetricSource && rules.warn_on_proxy_cash_metric_sources.includes(cashMetricSource)) {
      addFinding('warning', 'proxy_cash_metric_source', `REIT valuation used ${cashMetricSource}; confidence should reflect that this is not company-reported AFFO/FFO.`);
    }
    const payoutRatio = toFiniteNumber(normalizedBase.payout_ratio_pct);
    if (hasFiniteNumber(payoutRatio) && Number(payoutRatio) > rules.warn_when_payout_ratio_pct_above) {
      addFinding('warning', 'high_reit_payout_ratio', `Dividend payout is about ${Number(payoutRatio).toFixed(1)}% of the AFFO proxy.`);
    }
    const recommendedMethods = Array.isArray(result.recommended_methods) ? result.recommended_methods : [];
    for (const requiredCheck of rules.required_context_checks) {
      if (!recommendedMethods.includes(requiredCheck)) {
        addFinding('info', `missing_reit_context_check_${requiredCheck}`, `Recommended REIT context check is not listed: ${requiredCheck}.`);
      }
    }
  }

  const criticalCount = findings.filter((finding) => finding.severity === 'critical').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  return {
    source: 'workspace/Financial Analyst Workspace/references/valuation-models/valuation-audit/config.json',
    status: criticalCount ? 'fail' : warningCount ? 'warning' : 'pass',
    critical_count: criticalCount,
    warning_count: warningCount,
    findings,
  };
}

type LedgerEvidenceAssessment = {
  sufficient: boolean;
  status: 'sufficient' | 'no_company_data' | 'not_in_database' | 'foreign_no_filings';
  message: string;
  coverageTier: string | null;
  analysisMode: 'filing_backed' | 'vendor_snapshot_only' | 'insufficient';
};

const US_DOMICILE_TOKENS = new Set([
  'united states',
  'united states of america',
  'usa',
  'us',
  'u.s.',
  'u.s.a.',
  'america',
]);

// Detects a non-US domicile from the vendor snapshot so Ledger can plainly say
// "this is a foreign company" instead of showing a blank/provisional read.
// Conservative: only flags when the country is explicitly a known non-US value
// (an empty/unknown country is NOT treated as foreign, to avoid false positives).
function detectForeignDomicile(snapshot: Record<string, any>): { isForeign: boolean; countryLabel: string | null } {
  const rawCountry = trimString(snapshot?.country) || trimString(snapshot?.countryName);
  if (!rawCountry) return { isForeign: false, countryLabel: null };
  const normalized = rawCountry.toLowerCase().replace(/\s+/g, ' ').trim();
  if (US_DOMICILE_TOKENS.has(normalized)) return { isForeign: false, countryLabel: null };
  return { isForeign: true, countryLabel: rawCountry };
}

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

  // Foreign company with no domestic filing coverage: say so plainly rather than
  // attempting a provisional vendor read with a blank DCF/thesis. Placed AFTER the
  // full_filing_supported and explicit foreign_reporting branches so US filers and
  // already-handled foreign-reporting names keep their existing behavior.
  const foreignDomicile = detectForeignDomicile(snapshot);
  if (foreignDomicile.isForeign && !hasStructuredCoverage && !hasFilingEvidence) {
    return {
      sufficient: false,
      status: 'foreign_no_filings',
      message:
        `This is a foreign company (${foreignDomicile.countryLabel}). It reports to its home-country regulator using forms like 20-F, 40-F, or 6-K rather than the SEC domestic 10-K/10-Q filings Ledger relies on, so we don't have the financial-statement data needed to run a DCF or build a fundamental thesis here.`,
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

export type CalibrationAdjustment = {
  assumption_key: string;
  adjustment_pct: number;
  scope_type: string;
  scope_value: string;
  sample_size: number;
};

export type NarrativeDcfAdjustment = {
  direction: 'bull' | 'bear';
  specificity: number;
  revenue_growth_delta_pct: number;
  classification?: string | null;
  headline?: string | null;
  driver?: string | null;
  rationale?: string | null;
  sources?: number[];
};

type DcfEngineOptions = {
  revenue_growth_near_term_pct?: number | null;
  target_operating_margin_pct?: number | null;
  discount_rate_pct?: number | null;
  terminal_growth_pct?: number | null;
  forecast_years?: number | null;
  calibration_adjustments?: CalibrationAdjustment[] | null;
  narrative_adjustment?: NarrativeDcfAdjustment | null;
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
  const dcfConfig = OPERATING_DCF_CONFIG;
  const resolvedEngineClass = resolveValuationEngineClass(ledgerBase);
  if (resolvedEngineClass === 'roe_book_value') {
    return runFinancialCompanyValuationEngine(ledgerBase, options);
  }
  if (resolvedEngineClass === 'relative_multiples') {
    return runRelativeMultiplesValuationEngine(ledgerBase, options);
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
      valuation_method: dcfConfig.valuation_method,
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

  const dcfCoverage = buildDcfCoverageAssessment({
    latestAnnual,
    evidenceAssessment,
    annualRevenue,
    freeCashFlow,
    normalizedFcf,
    sharesOutstanding,
    currentPrice,
    operatingMarginPct,
    currentFcfMarginPct,
    retrievalCount: retrievalResults.length,
  });

  const conversionRatio = Number.isFinite(Number(currentFcfMarginPct)) && Number.isFinite(Number(operatingMarginPct)) && Number(operatingMarginPct)
    ? clamp(Number(currentFcfMarginPct) / Number(operatingMarginPct), 0.25, 0.85)
    : 0.5;

  const baseNearTermGrowthPct = clamp(
    hasFiniteNumber(options.revenue_growth_near_term_pct)
      ? Number(options.revenue_growth_near_term_pct)
      : Number.isFinite(Number(revenueGrowthObservedPct))
        ? Number(revenueGrowthObservedPct) * dcfConfig.near_term_revenue_growth_pct.observed_growth_multiplier
        : dcfConfig.near_term_revenue_growth_pct.default_when_unavailable,
    dcfConfig.near_term_revenue_growth_pct.min,
    dcfConfig.near_term_revenue_growth_pct.max,
  );

  const baseTargetOperatingMarginPct = clamp(
    hasFiniteNumber(options.target_operating_margin_pct)
      ? Number(options.target_operating_margin_pct)
      : Number.isFinite(Number(operatingMarginPct))
        ? Math.max(
          Number(operatingMarginPct) + dcfConfig.target_operating_margin_pct.observed_margin_add_pct,
          dcfConfig.target_operating_margin_pct.observed_margin_floor_pct,
        )
        : dcfConfig.target_operating_margin_pct.default_when_unavailable,
    dcfConfig.target_operating_margin_pct.min,
    dcfConfig.target_operating_margin_pct.max,
  );

  const baseTargetFcfMarginPct = clamp(
    baseTargetOperatingMarginPct * Math.max(
      conversionRatio,
      dcfConfig.target_free_cash_flow_margin_pct.conversion_ratio_floor,
    ),
    dcfConfig.target_free_cash_flow_margin_pct.min,
    Math.max(4, baseTargetOperatingMarginPct),
  );

  const defaultDiscountRatePct = clamp(
    dcfConfig.discount_rate_pct.base_default
      + (dcfConfig.discount_rate_pct.quality_premiums[qualityGrade] ?? 0)
      + (Number.isFinite(Number(snapshot.currentRatio)) && Number(snapshot.currentRatio) < 1
        ? dcfConfig.discount_rate_pct.current_ratio_below_one_premium
        : 0)
      + (financialAnalysis?.price_vs_value_judgment?.judgment === 'likely_rich'
        ? dcfConfig.discount_rate_pct.likely_rich_premium
        : 0),
    dcfConfig.discount_rate_pct.default_min,
    dcfConfig.discount_rate_pct.default_max,
  );
  const discountRatePct = clamp(
    hasFiniteNumber(options.discount_rate_pct)
      ? Number(options.discount_rate_pct)
      : defaultDiscountRatePct,
    dcfConfig.discount_rate_pct.min,
    dcfConfig.discount_rate_pct.max,
  );

  const terminalGrowthPct = clamp(
    hasFiniteNumber(options.terminal_growth_pct)
      ? Number(options.terminal_growth_pct)
      : dcfConfig.terminal_growth_pct.default,
    dcfConfig.terminal_growth_pct.min,
    Math.max(
      dcfConfig.terminal_growth_pct.minimum_dynamic_max,
      discountRatePct - dcfConfig.terminal_growth_pct.spread_below_discount_rate_pct,
    ),
  );

  const forecastYears = clamp(
    hasFiniteNumber(options.forecast_years)
      ? Math.trunc(Number(options.forecast_years))
      : dcfConfig.forecast_years.default,
    dcfConfig.forecast_years.min,
    dcfConfig.forecast_years.max,
  );

  // --- Calibration adjustment injection ---
  // Apply only when the user hasn't explicitly overridden assumptions via options.
  const calibrationAdjustments = Array.isArray(options.calibration_adjustments)
    ? options.calibration_adjustments
    : [];
  const calibrationApplied: Record<string, { adjustment_pct: number; scope: string; original: number; adjusted: number }> = {};
  let calibratedGrowthPct = baseNearTermGrowthPct;
  let calibratedFcfMarginPct = baseTargetFcfMarginPct;

  for (const adj of calibrationAdjustments) {
    if (adj.assumption_key === 'revenue_growth_pct' && !hasFiniteNumber(options.revenue_growth_near_term_pct)) {
      const original = calibratedGrowthPct;
      calibratedGrowthPct = clamp(calibratedGrowthPct - adj.adjustment_pct, 0.5, 25);
      calibrationApplied['revenue_growth_pct'] = {
        adjustment_pct: adj.adjustment_pct,
        scope: `${adj.scope_type}:${adj.scope_value}`,
        original,
        adjusted: calibratedGrowthPct,
      };
      break; // use the most specific match (adjustments arrive specificity-first)
    }
  }
  for (const adj of calibrationAdjustments) {
    if (adj.assumption_key === 'target_fcf_margin_pct' && !hasFiniteNumber(options.target_operating_margin_pct)) {
      const original = calibratedFcfMarginPct;
      calibratedFcfMarginPct = clamp(calibratedFcfMarginPct - adj.adjustment_pct, 1, 30);
      calibrationApplied['target_fcf_margin_pct'] = {
        adjustment_pct: adj.adjustment_pct,
        scope: `${adj.scope_type}:${adj.scope_value}`,
        original,
        adjusted: calibratedFcfMarginPct,
      };
      break;
    }
  }

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
      valuation_method: dcfConfig.valuation_method,
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      dcf_coverage: dcfCoverage,
      coverage_quality: dcfCoverage.quality,
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
      revenueGrowthPct: clamp(
        calibratedGrowthPct + dcfConfig.scenario_spreads.bear.revenue_growth_delta_pct,
        0.5,
        20,
      ),
      targetFcfMarginPct: clamp(
        calibratedFcfMarginPct + dcfConfig.scenario_spreads.bear.target_fcf_margin_delta_pct,
        1,
        20,
      ),
      discountRatePct: clamp(
        discountRatePct + dcfConfig.scenario_spreads.bear.discount_rate_delta_pct,
        dcfConfig.discount_rate_pct.min,
        dcfConfig.discount_rate_pct.max,
      ),
      terminalGrowthPct: clamp(
        terminalGrowthPct + dcfConfig.scenario_spreads.bear.terminal_growth_delta_pct,
        1,
        5,
      ),
    },
    {
      name: 'base',
      revenueGrowthPct: calibratedGrowthPct,
      targetFcfMarginPct: calibratedFcfMarginPct,
      discountRatePct,
      terminalGrowthPct,
    },
    {
      name: 'bull',
      revenueGrowthPct: clamp(
        calibratedGrowthPct + dcfConfig.scenario_spreads.bull.revenue_growth_delta_pct,
        1,
        28,
      ),
      targetFcfMarginPct: clamp(
        calibratedFcfMarginPct + dcfConfig.scenario_spreads.bull.target_fcf_margin_delta_pct,
        2,
        24,
      ),
      discountRatePct: clamp(
        discountRatePct + dcfConfig.scenario_spreads.bull.discount_rate_delta_pct,
        dcfConfig.discount_rate_pct.min,
        dcfConfig.discount_rate_pct.max,
      ),
      terminalGrowthPct: clamp(
        terminalGrowthPct + dcfConfig.scenario_spreads.bull.terminal_growth_delta_pct,
        1,
        5,
      ),
    },
  ] as const;

  const valueScenario = (scenario: {
    name: string;
    revenueGrowthPct: number;
    targetFcfMarginPct: number;
    discountRatePct: number;
    terminalGrowthPct: number;
  }) => {
    const yearlyForecast = [];
    let revenue = Number(annualRevenue);
    let pvOfCashFlows = 0;

    for (let year = 1; year <= forecastYears; year += 1) {
      const fadeRatio = forecastYears === 1 ? 1 : (year - 1) / (forecastYears - 1);
      const growthPct = interpolate(scenario.revenueGrowthPct, scenario.terminalGrowthPct, fadeRatio);
      const fcfMarginPct = interpolate(
        Number.isFinite(Number(currentFcfMarginPct))
          ? Number(currentFcfMarginPct)
          : scenario.targetFcfMarginPct * dcfConfig.target_free_cash_flow_margin_pct.fallback_starting_margin_multiplier,
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
  };

  const scenarioOutputs = scenarioConfigs.map(valueScenario);

  const bear = scenarioOutputs.find((row) => row.scenario === 'bear') || null;
  const base = scenarioOutputs.find((row) => row.scenario === 'base') || null;
  const bull = scenarioOutputs.find((row) => row.scenario === 'bull') || null;
  const lowFairValue = bear?.fair_value_per_share ?? null;
  const midFairValue = base?.fair_value_per_share ?? null;
  const highFairValue = bull?.fair_value_per_share ?? null;

  const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(midFairValue)) && Number(currentPrice)
    ? ((Number(midFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
    : null;

  // --- Narrative-adjusted case ---
  // Social-narrative theses lead fundamentals, so we model the thesis as a
  // revenue-growth delta in a SEPARATE scenario. The base case stays anchored to
  // the filings; the gap between base and narrative fair value is the actionable
  // expectation gap. Skipped when the caller pinned revenue growth explicitly.
  let narrativeCase: Record<string, any> | null = null;
  const narrativeAdj = options.narrative_adjustment;
  if (
    narrativeAdj &&
    hasFiniteNumber(narrativeAdj.revenue_growth_delta_pct) &&
    Number(narrativeAdj.revenue_growth_delta_pct) !== 0 &&
    !hasFiniteNumber(options.revenue_growth_near_term_pct)
  ) {
    const delta = Number(narrativeAdj.revenue_growth_delta_pct);
    const adjustedGrowth = clamp(calibratedGrowthPct + delta, 0.5, 28);
    const narrativeOutput = valueScenario({
      name: 'narrative',
      revenueGrowthPct: adjustedGrowth,
      targetFcfMarginPct: calibratedFcfMarginPct,
      discountRatePct,
      terminalGrowthPct,
    });
    const narrativeFairValue = narrativeOutput.fair_value_per_share;
    const gapVsBasePct = Number.isFinite(Number(midFairValue)) && Number(midFairValue) && Number.isFinite(Number(narrativeFairValue))
      ? ((Number(narrativeFairValue) - Number(midFairValue)) / Number(midFairValue)) * 100
      : null;
    const priceVsNarrativePct = Number.isFinite(Number(currentPrice)) && Number(currentPrice) && Number.isFinite(Number(narrativeFairValue))
      ? ((Number(narrativeFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
      : null;
    narrativeCase = {
      applied: true,
      direction: narrativeAdj.direction,
      specificity: hasFiniteNumber(narrativeAdj.specificity) ? Number(narrativeAdj.specificity) : null,
      classification: narrativeAdj.classification ?? null,
      headline: narrativeAdj.headline ?? null,
      driver: narrativeAdj.driver ?? null,
      rationale: narrativeAdj.rationale ?? null,
      sources: Array.isArray(narrativeAdj.sources) ? narrativeAdj.sources : [],
      revenue_growth_delta_pct: Number(delta.toFixed(2)),
      base_revenue_growth_pct: Number(calibratedGrowthPct.toFixed(2)),
      adjusted_revenue_growth_pct: Number(adjustedGrowth.toFixed(2)),
      assumptions: narrativeOutput.assumptions,
      fair_value_per_share: narrativeFairValue,
      fair_value_display: toMoneyString(narrativeFairValue),
      base_fair_value_per_share: midFairValue,
      base_fair_value_display: toMoneyString(midFairValue),
      narrative_vs_base_pct: Number.isFinite(Number(gapVsBasePct)) ? Number(Number(gapVsBasePct).toFixed(2)) : null,
      current_price: currentPrice,
      price_vs_narrative_pct: Number.isFinite(Number(priceVsNarrativePct)) ? Number(Number(priceVsNarrativePct).toFixed(2)) : null,
    };
  }

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
    : dcfCoverage.quality === 'partial'
      ? 'low_to_moderate'
      : buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
      normalizedFcf,
      currentFcfMarginPct,
      currentPrice,
      sharesOutstanding,
    ].filter((value) => Number.isFinite(Number(value))).length);

  const result = {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'dcf_engine',
    valuation_method: dcfConfig.valuation_method,
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: confidenceLevel,
    coverage_quality: dcfCoverage.quality,
    dcf_coverage: dcfCoverage,
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
      market_cap: marketCap,
      current_price: currentPrice,
      valuation_gap_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
      valuation_quality_score: qualityGrade === 'high' ? 0.85 : qualityGrade === 'good' ? 0.7 : qualityGrade === 'mixed' ? 0.5 : 0.3,
    },
    calibration_applied: Object.keys(calibrationApplied).length > 0 ? calibrationApplied : null,
    narrative_case: narrativeCase,
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
  };
  return {
    ...result,
    valuation_audit: buildValuationAudit(result, 'dcf_operating'),
  };
}

function preferConsistentStatementValue(statementValue: unknown, snapshotValue: unknown): number | null {
  const statementNum = toFiniteNumber(statementValue);
  const snapshotNum = toFiniteNumber(snapshotValue);
  if (statementNum != null && snapshotNum != null && snapshotNum !== 0) {
    const ratio = statementNum / snapshotNum;
    if (ratio > 5 || ratio < 0.2) return snapshotNum;
  }
  return statementNum ?? snapshotNum;
}

function resolveReitPropertyType(snapshot: Record<string, any>): string {
  const text = [
    snapshot.industry,
    snapshot.sector,
    snapshot.companyName,
    snapshot.businessDescription,
  ].map((value) => trimString(value) || '').join(' ').toLowerCase();
  if (text.includes('data center')) return 'data_center';
  if (/\bindustrial\b|\blogistics\b|\bwarehouse\b/.test(text)) return 'industrial';
  if (text.includes('net lease') || text.includes('triple net')) return 'net_lease';
  if (text.includes('self-storage') || text.includes('self storage')) return 'self_storage';
  if (/\bresidential\b|\bapartment\b|\bmultifamily\b/.test(text)) return 'residential';
  if (/\bhealthcare\b|\bmedical\b|\bsenior\b/.test(text)) return 'healthcare';
  if (/\bmall\b|\bshopping center\b|\bretail\b/.test(text)) return 'retail';
  if (text.includes('office')) return 'office';
  if (/\bhotel\b|\blodging\b/.test(text)) return 'lodging';
  return 'diversified';
}

function reitMultipleBand(propertyType: string, config: ReitAffoConfig = REIT_AFFO_CONFIG): ReitMultipleBand {
  return config.property_type_multiple_bands[propertyType]
    || config.property_type_multiple_bands.diversified
    || DEFAULT_REIT_AFFO_CONFIG.property_type_multiple_bands.diversified;
}

export function runReitAffoValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const reitConfig = REIT_AFFO_CONFIG;
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);
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

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'reit_affo_valuation_engine',
      valuation_method: reitConfig.valuation_method,
      valuation_engine_class: reitConfig.engine_class,
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
      model_limitations: ['Insufficient Ledger evidence for a REIT valuation.'],
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
    };
  }

  const propertyType = resolveReitPropertyType(snapshot);
  const band = reitMultipleBand(propertyType, reitConfig);
  const netIncome = getMetricValue(latestAnnual, 'net_income');
  const operatingCashFlow = preferConsistentStatementValue(getMetricValue(latestAnnual, 'operating_cash_flow'), snapshot.operatingCashFlowTTM);
  const annualRevenue = preferConsistentStatementValue(getMetricValue(latestAnnual, 'revenue'), snapshot.annualRevenue)
    ?? resolveAnnualRevenue(latestAnnual, snapshot);
  const revenueGrowthObservedPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const dividendPerShare = toFiniteNumber((snapshot as any).dividendRate) ?? toFiniteNumber((snapshot as any).annualDividendRate);
  const depreciationAndAmortization = [
    getMetricValue(latestAnnual, 'real_estate_depreciation_and_amortization'),
    getMetricValue(latestAnnual, 'depreciation_and_amortization'),
    getMetricValue(latestAnnual, 'depreciation'),
    getMetricValue(latestAnnual, 'amortization'),
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const gainsOnSale = [
    getMetricValue(latestAnnual, 'gain_on_sale_of_real_estate'),
    getMetricValue(latestAnnual, 'gain_loss_on_sale_of_real_estate'),
    getMetricValue(latestAnnual, 'gains_on_property_sales'),
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? 0;
  const nareitFfoEstimate = netIncome != null && depreciationAndAmortization != null
    ? netIncome + depreciationAndAmortization - gainsOnSale
    : null;
  const reportedCashMetric = [
    toFiniteNumber((snapshot as any).affo),
    toFiniteNumber((snapshot as any).fundsFromOperations),
    toFiniteNumber((snapshot as any).ffo),
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const reportedCashMetricPerShare = [
    toFiniteNumber((snapshot as any).affoPerShare),
    toFiniteNumber((snapshot as any).ffoPerShare),
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const cashMetricSource =
    reportedCashMetric != null || reportedCashMetricPerShare != null ? 'reported_affo_or_ffo' :
    nareitFfoEstimate != null ? 'nareit_ffo_estimate' :
    operatingCashFlow != null ? 'operating_cash_flow_proxy' :
    netIncome != null ? 'net_income_proxy' :
    'missing';
  const affoProxy = [
    reportedCashMetric,
    nareitFfoEstimate,
    operatingCashFlow,
    netIncome,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const affoPerShare = [
    reportedCashMetricPerShare,
    Number.isFinite(Number(affoProxy)) && Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0
      ? Number(affoProxy) / Number(sharesOutstanding)
      : null,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const payoutRatioPct = Number.isFinite(Number(dividendPerShare)) && Number.isFinite(Number(affoPerShare)) && Number(affoPerShare) > 0
    ? (Number(dividendPerShare) / Number(affoPerShare)) * 100
    : null;
  const debtToEquity = toFiniteNumber(snapshot.debtToEquity);
  const affoMarginPct = annualRevenue && affoProxy != null ? (Number(affoProxy) / Number(annualRevenue)) * 100 : null;
  const qualityGrade = trimString(earningsQuality?.earnings_quality_grade) || 'mixed';
  const dividendCoverage = dividendPerShare != null && dividendPerShare !== 0 && affoPerShare != null
    ? Number(affoPerShare) / Number(dividendPerShare)
    : null;
  const defaultAffoMultiple = clamp(
    band.mid
      + (Number.isFinite(Number(revenueGrowthObservedPct))
        ? clamp(
          Number(revenueGrowthObservedPct) / reitConfig.default_affo_multiple_adjustments.revenue_growth_divisor,
          reitConfig.default_affo_multiple_adjustments.revenue_growth_min_delta,
          reitConfig.default_affo_multiple_adjustments.revenue_growth_max_delta,
        )
        : 0)
      + (reitConfig.default_affo_multiple_adjustments.quality_premiums[qualityGrade] ?? 0)
      - (Number.isFinite(Number(debtToEquity))
        && Number(debtToEquity) > reitConfig.default_affo_multiple_adjustments.debt_to_equity_threshold
        ? reitConfig.default_affo_multiple_adjustments.debt_to_equity_penalty
        : 0),
    band.low,
    band.high,
  );

  const missingInputs = cleanList([
    Number.isFinite(Number(affoPerShare)) ? null : 'AFFO/FFO per share or operating-cash-flow proxy',
    Number.isFinite(Number(currentPrice)) ? null : 'current price',
  ], 8);

  if (missingInputs.length) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'reit_affo_valuation_engine',
      valuation_method: reitConfig.valuation_method,
      valuation_engine_class: reitConfig.engine_class,
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      summary: `A REIT AFFO/NAV valuation could not be completed because key inputs are missing: ${missingInputs.join(', ')}.`,
      fair_value_range: null,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      scenario_outputs: [],
      model_limitations: [
        'REIT valuation requires AFFO/FFO, dividend coverage, NAV or cap-rate evidence, and debt-maturity context.',
      ],
      price_vs_value_judgment: {
        judgment: 'insufficient_inputs',
        summary: 'There is not enough structured AFFO/FFO or NAV input to produce a defensible REIT valuation.',
      },
    };
  }

  const scenarioConfigs = [
    {
      name: 'bear',
      affoMultiple: clamp(
        defaultAffoMultiple + reitConfig.scenario_spreads.bear.affo_multiple_delta,
        Math.max(
          reitConfig.scenario_spreads.bear.multiple_low_floor,
          band.low - reitConfig.scenario_spreads.bear.multiple_low_extra_room,
        ),
        band.high,
      ),
      affoGrowthPct: clamp(
        (revenueGrowthObservedPct ?? reitConfig.scenario_spreads.base.default_affo_growth_pct)
          + reitConfig.scenario_spreads.bear.affo_growth_delta_pct,
        reitConfig.scenario_spreads.bear.affo_growth_min_pct,
        reitConfig.scenario_spreads.bear.affo_growth_max_pct,
      ),
    },
    {
      name: 'base',
      affoMultiple: defaultAffoMultiple,
      affoGrowthPct: clamp(
        revenueGrowthObservedPct ?? reitConfig.scenario_spreads.base.default_affo_growth_pct,
        reitConfig.scenario_spreads.base.affo_growth_min_pct,
        reitConfig.scenario_spreads.base.affo_growth_max_pct,
      ),
    },
    {
      name: 'bull',
      affoMultiple: clamp(
        defaultAffoMultiple + reitConfig.scenario_spreads.bull.affo_multiple_delta,
        band.low,
        band.high + reitConfig.scenario_spreads.bull.multiple_high_extra_room,
      ),
      affoGrowthPct: clamp(
        (revenueGrowthObservedPct ?? reitConfig.scenario_spreads.base.default_affo_growth_pct)
          + reitConfig.scenario_spreads.bull.affo_growth_delta_pct,
        reitConfig.scenario_spreads.bull.affo_growth_min_pct,
        reitConfig.scenario_spreads.bull.affo_growth_max_pct,
      ),
    },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const normalizedAffoPerShare = Number(affoPerShare) * (1 + scenario.affoGrowthPct / 100);
    const fairValuePerShare = normalizedAffoPerShare * scenario.affoMultiple;
    return {
      scenario: scenario.name,
      assumptions: {
        normalized_affo_per_share: Number(normalizedAffoPerShare.toFixed(2)),
        affo_growth_pct: scenario.affoGrowthPct,
        affo_multiple: Number(scenario.affoMultiple.toFixed(2)),
      },
      fair_value_per_share: Number(fairValuePerShare.toFixed(2)),
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

  const result = {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'reit_affo_valuation_engine',
    valuation_method: reitConfig.valuation_method,
    valuation_engine_class: reitConfig.engine_class,
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
      affoPerShare,
      currentPrice,
      sharesOutstanding,
      payoutRatioPct,
    ].filter((value) => Number.isFinite(Number(value))).length),
    normalized_reit_base: {
      affo_proxy: affoProxy,
      affo_per_share: affoPerShare,
      annual_revenue: annualRevenue,
      operating_cash_flow: operatingCashFlow,
      dividend_per_share: dividendPerShare,
      payout_ratio_pct: payoutRatioPct,
      dividend_coverage_ratio: dividendCoverage,
      cash_metric_source: cashMetricSource,
      property_type: propertyType,
      affo_margin_pct: affoMarginPct,
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
      `${cashMetricSource === 'reported_affo_or_ffo' ? 'Reported AFFO/FFO' : cashMetricSource === 'nareit_ffo_estimate' ? 'Nareit-style FFO estimate' : cashMetricSource === 'operating_cash_flow_proxy' ? 'Operating-cash-flow REIT proxy' : 'Net-income REIT proxy'} per share of about ${toMoneyString(affoPerShare)}.`,
      `Base AFFO multiple of about ${Number(defaultAffoMultiple.toFixed(1))}x.`,
      payoutRatioPct != null ? `Dividend payout is about ${toPctString(payoutRatioPct)} of the AFFO proxy.` : 'Dividend coverage could not be verified from structured facts.',
      'NAV, cap-rate evidence, lease maturity, and debt maturity schedule remain important cross-checks.',
    ],
    model_limitations: [
      ...reitConfig.model_limitations.filter((line) => trimString(line) !== 'NAV is not blended unless property NOI and cap-rate inputs are explicitly available.'),
      cashMetricSource === 'operating_cash_flow_proxy' || cashMetricSource === 'net_income_proxy'
        ? 'Structured company-reported AFFO/FFO was not available in the loaded Ledger facts.'
        : null,
      'NAV is not blended unless property NOI and cap-rate inputs are explicitly available.',
    ].filter(Boolean),
    price_vs_value_judgment: {
      judgment: priceVsValueJudgment,
      summary: priceVsValueJudgment === 'undervalued'
        ? 'The REIT AFFO/FFO proxy suggests the stock trades below a reasonable income-property valuation range.'
        : priceVsValueJudgment === 'overvalued'
          ? 'The stock trades above what the current REIT AFFO/FFO proxy appears to justify.'
          : priceVsValueJudgment === 'roughly_fair'
            ? 'The current price is near the REIT AFFO/FFO proxy midpoint.'
            : 'Price versus value could not be judged cleanly from the current REIT inputs.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
      property_type: propertyType,
      market_cap: marketCap,
      debt_to_equity: debtToEquity,
      cash_metric_source: cashMetricSource,
      valuation_gap_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    recommended_methods: [
      'affo_multiple',
      'ffo_multiple',
      'nav_cap_rate_cross_check',
      'dividend_coverage',
      'fixed_charge_coverage_and_debt_maturities',
    ],
  };
  return {
    ...result,
    valuation_audit: buildValuationAudit(result, 'reit_affo'),
  };
}

export function runRelativeMultiplesValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  void options;
  const config = RELATIVE_MULTIPLES_CONFIG;
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);
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

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'relative_multiples_valuation_engine',
      valuation_method: config.valuation_method,
      valuation_engine_class: config.engine_class,
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
      model_limitations: ['Insufficient Ledger evidence for a relative-multiple valuation.'],
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
    };
  }

  const sectorRaw = trimString(snapshot.sector);
  const sectorKey = sectorRaw ? sectorRaw.toLowerCase() : '';
  const evSalesBand = config.sector_ev_sales_bands[sectorKey] || config.sector_ev_sales_bands.diversified;
  const pbBand = config.sector_price_book_bands[sectorKey] || config.sector_price_book_bands.diversified;

  const annualRevenue = preferConsistentStatementValue(getMetricValue(latestAnnual, 'revenue'), snapshot.annualRevenue)
    ?? resolveAnnualRevenue(latestAnnual, snapshot);
  const totalDebt = toFiniteNumber(snapshot.totalDebt) ?? toFiniteNumber(snapshot.debt);
  const enterpriseValue = toFiniteNumber(snapshot.enterpriseValue);
  let netDebt: number;
  if (Number.isFinite(Number(enterpriseValue)) && Number.isFinite(Number(marketCap))) {
    netDebt = Number(enterpriseValue) - Number(marketCap);
  } else if (Number.isFinite(Number(totalDebt))) {
    netDebt = Number(totalDebt);
  } else {
    netDebt = 0;
  }
  const debtToEquity = toFiniteNumber(snapshot.debtToEquity);
  const priceToBook = toFiniteNumber((snapshot as any).priceToBook);
  const bookValuePerShare = [
    toFiniteNumber((snapshot as any).bookValuePerShare),
    Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(priceToBook)) && Number(priceToBook) > 0
      ? Number(currentPrice) / Number(priceToBook)
      : null,
  ].find((value) => value != null && Number.isFinite(Number(value))) ?? null;
  const freeCashFlow = preferConsistentStatementValue(getMetricValue(latestAnnual, 'free_cash_flow'), snapshot.freeCashFlowTTM);
  const qualityGrade = trimString(earningsQuality?.earnings_quality_grade) || 'mixed';

  const canEvSales = Number.isFinite(Number(annualRevenue)) && Number(annualRevenue) > 0
    && Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0;
  const canPriceBook = Number.isFinite(Number(bookValuePerShare)) && Number(bookValuePerShare) > 0;

  const missingInputs = cleanList([
    canEvSales || canPriceBook ? null : 'annual revenue with shares outstanding, or book value per share',
    Number.isFinite(Number(currentPrice)) ? null : 'current price',
  ], 8);

  if (missingInputs.length) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'relative_multiples_valuation_engine',
      valuation_method: config.valuation_method,
      valuation_engine_class: config.engine_class,
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      summary: `A relative-multiple valuation could not be completed because key inputs are missing: ${missingInputs.join(', ')}.`,
      fair_value_range: null,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      scenario_outputs: [],
      model_limitations: config.model_limitations,
      price_vs_value_judgment: {
        judgment: 'insufficient_inputs',
        summary: 'There is not enough revenue/share or book-value input to produce a defensible relative-multiple valuation.',
      },
    };
  }

  let riskHaircutPct = config.risk_haircut.base_pct;
  if (qualityGrade === 'weak') riskHaircutPct += config.risk_haircut.weak_quality_extra_pct;
  else if (qualityGrade === 'mixed') riskHaircutPct += config.risk_haircut.mixed_quality_extra_pct;
  if (Number.isFinite(Number(debtToEquity)) && Number(debtToEquity) > config.risk_haircut.debt_to_equity_threshold) {
    riskHaircutPct += config.risk_haircut.high_leverage_extra_pct;
  }
  if (Number.isFinite(Number(freeCashFlow)) && Number(freeCashFlow) < 0) {
    riskHaircutPct += config.risk_haircut.negative_fcf_extra_pct;
  }
  riskHaircutPct = clamp(riskHaircutPct, 0, config.risk_haircut.max_pct);
  const haircutFactor = 1 - riskHaircutPct / 100;
  const wEv = config.blend_weights.ev_sales;
  const wPb = config.blend_weights.price_book;
  const liquidationFloorPerShare = canPriceBook ? Number(bookValuePerShare) * (pbBand.low * 0.5) : null;

  const valueAtMultiples = (evMultiple: number, pbMultiple: number, applyFloor: boolean): {
    fair_value_per_share: number;
    ev_sales_per_share: number | null;
    price_book_per_share: number | null;
  } => {
    const evSalesPerShare = canEvSales
      ? (Number(annualRevenue) * evMultiple - netDebt) / Number(sharesOutstanding)
      : null;
    const priceBookPerShare = canPriceBook ? Number(bookValuePerShare) * pbMultiple : null;
    let blended: number | null;
    if (evSalesPerShare != null && priceBookPerShare != null) {
      blended = wEv * evSalesPerShare + wPb * priceBookPerShare;
    } else {
      blended = evSalesPerShare ?? priceBookPerShare;
    }
    let value = blended == null ? 0 : blended * haircutFactor;
    if (applyFloor && liquidationFloorPerShare != null && value < liquidationFloorPerShare) {
      value = liquidationFloorPerShare;
    }
    if (value < 0) value = 0;
    return {
      fair_value_per_share: Number(value.toFixed(2)),
      ev_sales_per_share: evSalesPerShare != null ? Number(evSalesPerShare.toFixed(2)) : null,
      price_book_per_share: priceBookPerShare != null ? Number(priceBookPerShare.toFixed(2)) : null,
    };
  };

  const scenarioConfigs = [
    { name: 'bear', evMultiple: evSalesBand.low, pbMultiple: pbBand.low, applyFloor: true },
    { name: 'base', evMultiple: evSalesBand.mid, pbMultiple: pbBand.mid, applyFloor: false },
    { name: 'bull', evMultiple: evSalesBand.high, pbMultiple: pbBand.high, applyFloor: false },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const valued = valueAtMultiples(scenario.evMultiple, scenario.pbMultiple, scenario.applyFloor);
    return {
      scenario: scenario.name,
      assumptions: {
        ev_sales_multiple: Number(scenario.evMultiple.toFixed(2)),
        price_book_multiple: Number(scenario.pbMultiple.toFixed(2)),
        risk_haircut_pct: Number(riskHaircutPct.toFixed(1)),
        ev_sales_implied_per_share: valued.ev_sales_per_share,
        price_book_implied_per_share: valued.price_book_per_share,
      },
      fair_value_per_share: valued.fair_value_per_share,
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
  const primaryLeg = canEvSales && canPriceBook ? 'ev_sales_and_price_book' : canEvSales ? 'ev_sales' : 'price_book';

  const result = {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'relative_multiples_valuation_engine',
    valuation_method: config.valuation_method,
    valuation_engine_class: config.engine_class,
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: 'low',
    normalized_relative_base: {
      annual_revenue: annualRevenue,
      shares_outstanding: sharesOutstanding,
      net_debt: netDebt,
      book_value_per_share: bookValuePerShare,
      free_cash_flow: freeCashFlow,
      market_cap: marketCap,
      sector: sectorRaw,
      sector_ev_sales_band: evSalesBand,
      sector_price_book_band: pbBand,
      primary_leg: primaryLeg,
      risk_haircut_pct: Number(riskHaircutPct.toFixed(1)),
      liquidation_floor_per_share: liquidationFloorPerShare != null ? Number(liquidationFloorPerShare.toFixed(2)) : null,
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
      canEvSales ? `EV/Sales of about ${Number(evSalesBand.mid.toFixed(1))}x on revenue of ${toMoneyString(annualRevenue)} (net debt ${toMoneyString(netDebt)}).` : 'No usable revenue/share base for an EV/Sales read.',
      canPriceBook ? `Price/Book of about ${Number(pbBand.mid.toFixed(1))}x on book value per share of ${toMoneyString(bookValuePerShare)}.` : 'No usable book value for a Price/Book read.',
      `A risk haircut of about ${toPctString(riskHaircutPct)} is applied for quality, leverage, and cash-flow risk.`,
      'This is a wide, low-confidence band; dilution, going-concern, and covenant risk are only partially captured.',
    ],
    model_limitations: config.model_limitations,
    price_vs_value_judgment: {
      judgment: priceVsValueJudgment,
      summary: priceVsValueJudgment === 'undervalued'
        ? 'The relative-multiple and asset-floor read suggests the stock trades below a reasonable peer-multiple range.'
        : priceVsValueJudgment === 'overvalued'
          ? 'The stock trades above what the current relative-multiple and asset-floor read appears to justify.'
          : priceVsValueJudgment === 'roughly_fair'
            ? 'The current price is near the relative-multiple midpoint.'
            : 'Price versus value could not be judged cleanly from the current relative-multiple inputs.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: sectorRaw,
      industry: trimString(snapshot.industry),
      market_cap: marketCap,
      debt_to_equity: debtToEquity,
      valuation_gap_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    recommended_methods: [
      'ev_sales_vs_peers',
      'price_to_book_vs_peers',
      'tangible_book_or_nav_floor',
      'dilution_and_runway_check',
    ],
  };
  return {
    ...result,
    valuation_audit: buildValuationAudit(result, 'relative_multiples'),
  };
}

export function runSalesScenarioValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);
  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const financialAnalysis = runFinancialAnalysisEngine(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);
  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);
  const currentPrice = toFiniteNumber(snapshot.currentPrice);
  const marketCap = toFiniteNumber(snapshot.marketCap);
  const enterpriseValue = toFiniteNumber(snapshot.enterpriseValue) ?? marketCap;
  const sharesOutstanding = toFiniteNumber(snapshot.sharesOutstanding)
    ?? (Number.isFinite(Number(marketCap)) && Number.isFinite(Number(currentPrice)) && Number(currentPrice)
      ? Number(marketCap) / Number(currentPrice)
      : null);

  if (!evidenceAssessment.sufficient) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'sales_scenario_valuation_engine',
      valuation_method: 'preprofit_revenue_scenario',
      valuation_engine_class: 'sales_scenario',
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
      model_limitations: ['Insufficient Ledger evidence for a sales-scenario valuation.'],
      price_vs_value_judgment: {
        judgment: evidenceAssessment.status,
        summary: evidenceAssessment.message,
      },
    };
  }

  const annualRevenue = resolveAnnualRevenue(latestAnnual, snapshot);
  const revenueGrowthObservedPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const grossMarginPct = toFiniteNumber(snapshot.grossMarginPct);
  const cash = toFiniteNumber(snapshot.totalCash) ?? toFiniteNumber(snapshot.cash);
  const debt = toFiniteNumber(snapshot.totalDebt) ?? toFiniteNumber(snapshot.debt);
  const freeCashFlow = getMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);
  const cashRunwayQuarters = toFiniteNumber((snapshot as any).cashRunwayQuarters);
  const currentEvSales = Number.isFinite(Number(enterpriseValue)) && Number.isFinite(Number(annualRevenue)) && Number(annualRevenue) > 0
    ? Number(enterpriseValue) / Number(annualRevenue)
    : toFiniteNumber(snapshot.enterpriseToSales);

  const missingInputs = cleanList([
    Number.isFinite(Number(annualRevenue)) && Number(annualRevenue) > 0 ? null : 'annual revenue',
    Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0 ? null : 'shares outstanding',
    Number.isFinite(Number(currentPrice)) ? null : 'current price',
  ], 8);

  if (missingInputs.length) {
    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'sales_scenario_valuation_engine',
      valuation_method: 'preprofit_revenue_scenario',
      valuation_engine_class: 'sales_scenario',
      confidence_level: 'low',
      status: 'insufficient_inputs',
      missing_inputs: missingInputs,
      summary: `A pre-profit sales-scenario valuation could not be completed because key inputs are missing: ${missingInputs.join(', ')}.`,
      fair_value_range: null,
      base_case_assumptions: null,
      bear_case_assumptions: null,
      bull_case_assumptions: null,
      scenario_outputs: [],
      model_limitations: [
        'Pre-profit valuation requires revenue scale, growth, margin path, runway, dilution risk, and a defensible revenue multiple.',
      ],
      price_vs_value_judgment: {
        judgment: 'insufficient_inputs',
        summary: 'There is not enough structured revenue and capital-structure input to produce a defensible sales-scenario valuation.',
      },
    };
  }

  const growthAnchorPct = hasFiniteNumber(options.revenue_growth_near_term_pct)
    ? Number(options.revenue_growth_near_term_pct)
    : Number.isFinite(Number(revenueGrowthObservedPct)) ? Number(revenueGrowthObservedPct) : 15;
  const defaultBaseMultiple = clamp(
    2.5
      + clamp(growthAnchorPct / 20, -1, 3)
      + (Number.isFinite(Number(grossMarginPct)) && Number(grossMarginPct) >= 60 ? 1 : 0)
      - (Number.isFinite(Number(cashRunwayQuarters)) && Number(cashRunwayQuarters) < 4 ? 1 : 0),
    0.8,
    10,
  );
  const scenarioConfigs = [
    { name: 'bear', revenueGrowthPct: clamp(growthAnchorPct - 10, -20, 35), evSalesMultiple: clamp(defaultBaseMultiple - 1.2, 0.4, 8) },
    { name: 'base', revenueGrowthPct: clamp(growthAnchorPct, -10, 60), evSalesMultiple: defaultBaseMultiple },
    { name: 'bull', revenueGrowthPct: clamp(growthAnchorPct + 12, 0, 85), evSalesMultiple: clamp(defaultBaseMultiple + 1.8, 1, 14) },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const forwardRevenue = Number(annualRevenue) * (1 + scenario.revenueGrowthPct / 100);
    const impliedEnterpriseValue = forwardRevenue * scenario.evSalesMultiple;
    const impliedEquityValue = impliedEnterpriseValue + (Number(cash) || 0) - (Number(debt) || 0);
    const fairValuePerShare = Number(sharesOutstanding) > 0 ? impliedEquityValue / Number(sharesOutstanding) : null;
    return {
      scenario: scenario.name,
      assumptions: {
        forward_revenue: Math.round(forwardRevenue),
        revenue_growth_pct: scenario.revenueGrowthPct,
        ev_sales_multiple: Number(scenario.evSalesMultiple.toFixed(2)),
      },
      implied_enterprise_value: Math.round(impliedEnterpriseValue),
      implied_equity_value: Math.round(impliedEquityValue),
      fair_value_per_share: fairValuePerShare != null ? Number(fairValuePerShare.toFixed(2)) : null,
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
    engine: 'sales_scenario_valuation_engine',
    valuation_method: 'preprofit_revenue_scenario',
    valuation_engine_class: 'sales_scenario',
    analysis_mode: evidenceAssessment.analysisMode,
    confidence_level: buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
      annualRevenue,
      currentPrice,
      sharesOutstanding,
      currentEvSales,
    ].filter((value) => Number.isFinite(Number(value))).length),
    normalized_sales_base: {
      annual_revenue: annualRevenue,
      revenue_growth_pct: revenueGrowthObservedPct,
      gross_margin_pct: grossMarginPct,
      free_cash_flow: freeCashFlow,
      cash,
      debt,
      enterprise_value: enterpriseValue,
      current_ev_sales: currentEvSales,
      shares_outstanding: sharesOutstanding,
      current_price: currentPrice,
      cash_runway_quarters: cashRunwayQuarters,
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
      `Revenue base of about ${Number(annualRevenue).toLocaleString()}.`,
      `Base EV/Sales multiple of about ${Number(defaultBaseMultiple.toFixed(1))}x.`,
      Number.isFinite(Number(currentEvSales)) ? `Current EV/Sales is about ${Number(currentEvSales).toFixed(1)}x.` : 'Current EV/Sales could not be measured cleanly.',
      'Dilution, runway, and path to gross-margin conversion matter more than current free cash flow.',
    ],
    model_limitations: [
      'This is a scenario valuation for unstable or negative cash-flow companies, not a DCF.',
      'The output is highly sensitive to revenue growth, achievable margins, financing needs, and the selected EV/Sales multiple.',
    ],
    price_vs_value_judgment: {
      judgment: priceVsValueJudgment,
      summary: priceVsValueJudgment === 'undervalued'
        ? 'The sales-scenario engine suggests the stock trades below the base revenue-scenario estimate.'
        : priceVsValueJudgment === 'overvalued'
          ? 'The stock trades above what the current sales-scenario assumptions appear to justify.'
          : priceVsValueJudgment === 'roughly_fair'
            ? 'The current price is near the base sales-scenario estimate.'
            : 'Price versus value could not be judged cleanly from the current sales-scenario inputs.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
      market_cap: marketCap,
      valuation_gap_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: hardFlags[0] || null,
    },
    recommended_methods: [
      'revenue_scenario',
      'ev_sales_cross_check',
      'gross_margin_unit_economics',
      'cash_runway_and_dilution_analysis',
    ],
  };
}

export function runSpecialSituationValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const config = SPECIAL_SITUATION_CONFIG;
  const snapshot = ledgerBase?.current_snapshot || {};
  const latestAnnual = ledgerBase?.annual_context?.latest_annual || null;
  const retrieval = ledgerBase?.evidence_context?.retrieval || {};
  const retrievalResults = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const evidenceAssessment = assessLedgerEvidence(ledgerBase);
  const earningsQuality = runEarningsQualityEngine(ledgerBase);
  const financialAnalysis = runFinancialAnalysisEngine(ledgerBase);
  const corporateAction = detectCorporateAction(ledgerBase);
  const hardFlags = detectLedgerHardFlags(ledgerBase);
  const primaryHardFlag = corporateAction || hardFlags[0] || null;
  const companyName = trimString(ledgerBase?.company_name) || trimString(snapshot.companyName);
  const currentPrice = toFiniteNumber(snapshot.currentPrice);
  const marketCap = toFiniteNumber(snapshot.marketCap);
  const enterpriseValue = toFiniteNumber(snapshot.enterpriseValue) ?? marketCap;
  const cash = toFiniteNumber(snapshot.totalCash) ?? toFiniteNumber(snapshot.cash);
  const debt = toFiniteNumber(snapshot.totalDebt) ?? toFiniteNumber(snapshot.debt);
  const annualRevenue = resolveAnnualRevenue(latestAnnual, snapshot);
  const freeCashFlow = getMetricValue(latestAnnual, 'free_cash_flow') ?? toFiniteNumber(snapshot.freeCashFlowTTM);
  const revenueGrowthObservedPct = toFiniteNumber(snapshot.revenueGrowthPct) ?? toFiniteNumber(snapshot.revenueYoYGrowthPct);
  const sharesOutstanding = toFiniteNumber(snapshot.sharesOutstanding)
    ?? (Number.isFinite(Number(marketCap)) && Number.isFinite(Number(currentPrice)) && Number(currentPrice)
      ? Number(marketCap) / Number(currentPrice)
      : null);
  const currentEvSales = Number.isFinite(Number(enterpriseValue)) && Number.isFinite(Number(annualRevenue)) && Number(annualRevenue) > 0
    ? Number(enterpriseValue) / Number(annualRevenue)
    : toFiniteNumber(snapshot.enterpriseToSales);

  if (corporateAction && Number.isFinite(Number(corporateAction.deal_price_per_share))) {
    const dealPrice = Number(corporateAction.deal_price_per_share);
    const cvrMax = toFiniteNumber(corporateAction.contingent_value_right_max_per_share) || 0;
    const breakValue = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) * 0.7 : dealPrice * 0.75;
    const baseValue = dealPrice + cvrMax * 0.35;
    const bullValue = dealPrice + cvrMax;
    const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number(currentPrice)
      ? ((baseValue - Number(currentPrice)) / Number(currentPrice)) * 100
      : null;

    return {
      symbol: ledgerBase?.symbol || null,
      company_name: companyName,
      engine: 'special_situation_valuation_engine',
      valuation_method: 'special_situation_deal_value',
      valuation_engine_class: config.engine_class,
      analysis_mode: 'special_situation',
      confidence_level: buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, 2),
      event_type: corporateAction.code || 'pending_acquisition',
      event_analysis: {
        primary_event: corporateAction,
        deal_price_per_share: dealPrice,
        contingent_value_right_max_per_share: cvrMax || null,
        expected_close: corporateAction.expected_close || null,
      },
      scenario_outputs: [
        { scenario: 'bear', label: 'break value', fair_value_per_share: Number(breakValue.toFixed(2)) },
        { scenario: 'base', label: 'deal value probability-weighted CVR', fair_value_per_share: Number(baseValue.toFixed(2)) },
        { scenario: 'bull', label: 'full deal plus full CVR', fair_value_per_share: Number(bullValue.toFixed(2)) },
      ],
      fair_value_range: {
        low_per_share: Number(breakValue.toFixed(2)),
        mid_per_share: Number(baseValue.toFixed(2)),
        high_per_share: Number(bullValue.toFixed(2)),
        current_price: currentPrice,
        current_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
        low_display: toMoneyString(breakValue),
        mid_display: toMoneyString(baseValue),
        high_display: toMoneyString(bullValue),
      },
      key_sensitivities: [
        'Deal close probability, timing, financing certainty, regulatory risk, vote risk, and break value dominate ordinary standalone valuation.',
      ],
      model_limitations: [
        'This is deal-value analysis, not an operating-company DCF.',
        'Standalone value is secondary unless the deal breaks or reprices.',
      ],
      price_vs_value_judgment: {
        judgment: buildValuationPriceJudgment(currentPrice, baseValue),
        summary: 'This is a special-situation / deal-value setup. Price versus value should be read through deal spread, closing probability, and break risk.',
        current_price: currentPrice,
        midpoint_fair_value: Number(baseValue.toFixed(2)),
        upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
      },
      special_situations: {
        corporate_action: corporateAction,
        hard_flags: hardFlags,
        primary_hard_flag: primaryHardFlag,
      },
      recommended_methods: [
        'deal_spread',
        'probability_weighted_close_value',
        'break_value',
        'timing_and_financing_risk',
      ],
    };
  }

  const missingInputs = cleanList([
    Number.isFinite(Number(annualRevenue)) && Number(annualRevenue) > 0 ? null : 'normalized revenue base',
    Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0 ? null : 'post-reorg shares outstanding',
    Number.isFinite(Number(currentPrice)) ? null : 'current price',
    Number.isFinite(Number(cash)) ? null : 'post-reorg cash',
    Number.isFinite(Number(debt)) ? null : 'post-reorg debt',
  ], 8);

  const growthAnchorPct = hasFiniteNumber(options.revenue_growth_near_term_pct)
    ? Number(options.revenue_growth_near_term_pct)
    : Number.isFinite(Number(revenueGrowthObservedPct))
      ? Number(revenueGrowthObservedPct)
      : config.scenario_spreads.base.default_revenue_growth_pct;
  const baseMultiple = clamp(
    Number.isFinite(Number(currentEvSales))
      ? Number(currentEvSales)
      : config.default_ev_sales_multiple.base,
    config.default_ev_sales_multiple.min,
    config.default_ev_sales_multiple.max,
  );

  const scenarioConfigs = [
    {
      name: 'bear',
      revenueGrowthPct: clamp(growthAnchorPct + config.scenario_spreads.bear.revenue_growth_delta_pct, -50, 50),
      evSalesMultiple: clamp(baseMultiple + config.scenario_spreads.bear.ev_sales_multiple_delta, config.default_ev_sales_multiple.min, config.default_ev_sales_multiple.max),
      survivalProbabilityPct: config.scenario_spreads.bear.survival_probability_pct,
    },
    {
      name: 'base',
      revenueGrowthPct: clamp(growthAnchorPct, -35, 75),
      evSalesMultiple: baseMultiple,
      survivalProbabilityPct: config.scenario_spreads.base.survival_probability_pct,
    },
    {
      name: 'bull',
      revenueGrowthPct: clamp(growthAnchorPct + config.scenario_spreads.bull.revenue_growth_delta_pct, -10, 100),
      evSalesMultiple: clamp(baseMultiple + config.scenario_spreads.bull.ev_sales_multiple_delta, config.default_ev_sales_multiple.min, config.default_ev_sales_multiple.max),
      survivalProbabilityPct: config.scenario_spreads.bull.survival_probability_pct,
    },
  ] as const;

  const scenarioOutputs = scenarioConfigs.map((scenario) => {
    const forwardRevenue = Number.isFinite(Number(annualRevenue))
      ? Number(annualRevenue) * (1 + scenario.revenueGrowthPct / 100)
      : null;
    const impliedEnterpriseValue = Number.isFinite(Number(forwardRevenue))
      ? Number(forwardRevenue) * scenario.evSalesMultiple
      : null;
    const impliedEquityValue = Number.isFinite(Number(impliedEnterpriseValue))
      ? Number(impliedEnterpriseValue) + (Number(cash) || 0) - (Number(debt) || 0)
      : null;
    const fairValuePerShare = Number.isFinite(Number(impliedEquityValue)) && Number.isFinite(Number(sharesOutstanding)) && Number(sharesOutstanding) > 0
      ? Math.max(0, Number(impliedEquityValue) / Number(sharesOutstanding))
      : null;
    const probabilityWeightedValue = fairValuePerShare != null
      ? fairValuePerShare * (scenario.survivalProbabilityPct / 100)
      : null;
    return {
      scenario: scenario.name,
      assumptions: {
        forward_revenue: forwardRevenue != null ? Math.round(forwardRevenue) : null,
        revenue_growth_pct: scenario.revenueGrowthPct,
        ev_sales_multiple: Number(scenario.evSalesMultiple.toFixed(2)),
        survival_probability_pct: scenario.survivalProbabilityPct,
      },
      implied_enterprise_value: impliedEnterpriseValue != null ? Math.round(impliedEnterpriseValue) : null,
      implied_equity_value: impliedEquityValue != null ? Math.round(impliedEquityValue) : null,
      fair_value_per_share: fairValuePerShare != null ? Number(fairValuePerShare.toFixed(2)) : null,
      probability_weighted_fair_value_per_share: probabilityWeightedValue != null ? Number(probabilityWeightedValue.toFixed(2)) : null,
    };
  });
  const bear = scenarioOutputs.find((row) => row.scenario === 'bear') || null;
  const base = scenarioOutputs.find((row) => row.scenario === 'base') || null;
  const bull = scenarioOutputs.find((row) => row.scenario === 'bull') || null;
  const lowFairValue = bear?.probability_weighted_fair_value_per_share ?? bear?.fair_value_per_share ?? null;
  const midFairValue = base?.probability_weighted_fair_value_per_share ?? base?.fair_value_per_share ?? null;
  const highFairValue = bull?.probability_weighted_fair_value_per_share ?? bull?.fair_value_per_share ?? null;
  const upsidePctToMid = Number.isFinite(Number(currentPrice)) && Number.isFinite(Number(midFairValue)) && Number(currentPrice)
    ? ((Number(midFairValue) - Number(currentPrice)) / Number(currentPrice)) * 100
    : null;

  return {
    symbol: ledgerBase?.symbol || null,
    company_name: companyName,
    engine: 'special_situation_valuation_engine',
    valuation_method: config.valuation_method,
    valuation_engine_class: config.engine_class,
    analysis_mode: 'special_situation',
    confidence_level: missingInputs.length
      ? 'low'
      : buildConfidenceLevel(Boolean(latestAnnual), retrievalResults.length, [
        annualRevenue,
        currentPrice,
        sharesOutstanding,
        currentEvSales,
        cash,
        debt,
      ].filter((value) => Number.isFinite(Number(value))).length),
    status: missingInputs.length ? 'incomplete_special_situation_inputs' : evidenceAssessment.status,
    missing_inputs: missingInputs,
    event_analysis: {
      primary_event: primaryHardFlag,
      hard_flag_count: hardFlags.length,
      framework: 'post-reorg / restructuring scenario and equity waterfall',
    },
    normalized_special_situation_base: {
      annual_revenue: annualRevenue,
      revenue_growth_pct: revenueGrowthObservedPct,
      free_cash_flow: freeCashFlow,
      cash,
      debt,
      enterprise_value: enterpriseValue,
      current_ev_sales: currentEvSales,
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
      'Post-reorg debt, cash, share count, warrants, and remaining claims determine the equity waterfall.',
      'Operating recovery matters through revenue ramp, utilization, margin recovery, capex needs, and time to free-cash-flow breakeven.',
      'Small changes in survival probability or EV multiple can move common-equity value sharply.',
    ],
    model_limitations: config.model_limitations,
    price_vs_value_judgment: {
      judgment: buildValuationPriceJudgment(currentPrice, midFairValue),
      summary: missingInputs.length
        ? `This needs a special-situation valuation, but key post-event inputs are missing: ${missingInputs.join(', ')}.`
        : 'This is a special-situation valuation. Price versus value should be read through the post-reorg equity waterfall and scenario probabilities, not a normal DCF midpoint.',
      current_price: currentPrice,
      midpoint_fair_value: midFairValue,
      upside_to_midpoint_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    supporting_context: {
      earnings_quality_grade: earningsQuality?.earnings_quality_grade || null,
      financial_analysis_value_view: financialAnalysis?.price_vs_value_judgment?.judgment || null,
      sector: trimString(snapshot.sector),
      industry: trimString(snapshot.industry),
      market_cap: marketCap,
      valuation_gap_pct: Number.isFinite(Number(upsidePctToMid)) ? Number(Number(upsidePctToMid).toFixed(2)) : null,
    },
    special_situations: {
      corporate_action: corporateAction,
      hard_flags: hardFlags,
      primary_hard_flag: primaryHardFlag,
    },
    recommended_methods: [
      'post_reorg_equity_waterfall',
      'probability_weighted_scenarios',
      'ev_sales_or_normalized_ebitda_cross_check',
      'cash_runway_and_dilution_analysis',
      'break_or_liquidation_value',
    ],
    required_inputs: config.required_inputs,
  };
}

export function runValuationEngine(
  ledgerBase: LedgerContextSummary,
  options: DcfEngineOptions = {},
): Record<string, any> {
  const engineClass = resolveValuationEngineClass(ledgerBase);
  if (engineClass === 'special_situation') {
    return runSpecialSituationValuationEngine(ledgerBase, options);
  }
  if (engineClass === 'roe_book_value') {
    return runFinancialCompanyValuationEngine(ledgerBase, options);
  }
  if (engineClass === 'reit_affo') {
    return runReitAffoValuationEngine(ledgerBase, options);
  }
  if (engineClass === 'sales_scenario') {
    return runSalesScenarioValuationEngine(ledgerBase, options);
  }
  if (engineClass === 'relative_multiples') {
    return runRelativeMultiplesValuationEngine(ledgerBase, options);
  }
  return runDcfValuationEngine(ledgerBase, options);
}
