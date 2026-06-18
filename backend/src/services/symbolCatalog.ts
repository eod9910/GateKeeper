import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

const SYMBOL_CATALOG_DB_PATH = path.join(__dirname, '../../data/symbol-catalog.sqlite');

export type CompanyType =
  | 'financial_company'
  | 'reit'
  | 'preprofit_growth'
  | 'operating_company'
  | 'unknown';

export type ConsumerDemandBucket =
  | 'healthcare'
  | 'housing_utilities'
  | 'groceries_staples'
  | 'financial_services_insurance'
  | 'autos_transport'
  | 'home_furnishings_appliances'
  | 'recreation_discretionary'
  | 'residential_investment'
  | 'business_equipment_investment'
  | 'consumer_mixed'
  | 'non_consumer';

export type ConsumerSpendClass =
  | 'durable_goods'
  | 'nondurable_goods'
  | 'services';

export type ConsumerCycleBucket =
  | 'highly_cyclical'
  | 'mildly_cyclical'
  | 'stable';

export type ConsumerSpendingCategory =
  | 'motor_vehicles_parts'
  | 'furnishings_household_equipment'
  | 'recreational_goods_vehicles'
  | 'other_durable_goods'
  | 'food_beverages_home'
  | 'clothing_footwear'
  | 'gas_energy_goods'
  | 'other_nondurable_goods'
  | 'housing_utilities'
  | 'healthcare'
  | 'transportation_services'
  | 'recreation_services'
  | 'food_service_accommodations'
  | 'financial_services_insurance'
  | 'other_services'
  | 'residential_investment'
  | 'business_equipment_investment'
  | 'mixed_consumer'
  | 'non_consumer';

export type ConsumerCycleSensitivity =
  | 'defensive'
  | 'mildly_cyclical'
  | 'cyclical'
  | 'highly_cyclical'
  | 'neutral';

export type RecessionProfile =
  | 'resilient'
  | 'mixed'
  | 'vulnerable';

export type MacroRegimePreference =
  | 'prefer_in_slowdown'
  | 'selective_in_slowdown'
  | 'neutral_in_slowdown'
  | 'avoid_in_slowdown';

export type SymbolTheme =
  | 'software'
  | 'software_application'
  | 'software_infrastructure'
  | 'cloud'
  | 'devtools'
  | 'data_infrastructure'
  | 'adtech'
  | 'marketing_software'
  | 'design_creative_software'
  | 'collaboration_software'
  | 'fintech_software'
  | 'vertical_software';

export type ValuationEngineClass =
  | 'roe_book_value'
  | 'reit_affo'
  | 'asset_manager_fre'
  | 'sales_scenario'
  | 'special_situation'
  | 'dcf_operating'
  | 'unknown';

export type ValuationState =
  | 'undervalued'
  | 'overvalued'
  | 'roughly_fair'
  | 'fair';

export type SymbolClassification = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  companyType: CompanyType | null;
  valuationEngineClass: ValuationEngineClass | null;
  classificationSource: string | null;
  classificationConfidence: number | null;
  lastClassifiedAt: string | null;
  consumerCycleBucket?: ConsumerCycleBucket | null;
  consumerDemandBucket?: ConsumerDemandBucket | null;
  consumerSpendClass?: ConsumerSpendClass | null;
  consumerSpendingCategory?: ConsumerSpendingCategory | null;
  consumerCycleSensitivity?: ConsumerCycleSensitivity | null;
  recessionProfile?: RecessionProfile | null;
  macroRegimePreference?: MacroRegimePreference | null;
  consumerClassificationConfidence?: number | null;
  themeMemberships?: SymbolTheme[] | null;
};

export type SymbolValuationSnapshot = {
  symbol: string;
  valuationState: ValuationState | null;
  qualityGrade: string | null;
  qualityScore: number | null;
  coverageMode: string | null;
  price: number | null;
  fairValueLow: number | null;
  fairValueMid: number | null;
  fairValueHigh: number | null;
  valuationGapPct: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  enterpriseToSales: number | null;
  revenue: number | null;
  freeCashFlow: number | null;
  sharesOutstanding: number | null;
  revenueGrowthPct: number | null;
  operatingMarginPct: number | null;
  freeCashFlowMarginPct: number | null;
  currentRatio: number | null;
  asOfDate: string | null;
};

export type TradableUniverseScreenRow = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  optionable: boolean | null;
  classification: SymbolClassification;
  valuation: SymbolValuationSnapshot | null;
};

function bucketForCategory(category: ConsumerSpendingCategory | null | undefined): ConsumerCycleBucket | null {
  if (!category) return null;
  if (
    [
      'motor_vehicles_parts',
      'furnishings_household_equipment',
      'recreational_goods_vehicles',
      'other_durable_goods',
      'transportation_services',
      'residential_investment',
      'business_equipment_investment',
    ].includes(category)
  ) return 'highly_cyclical';
  if (
    [
      'clothing_footwear',
      'gas_energy_goods',
      'food_service_accommodations',
      'other_services',
      'mixed_consumer',
    ].includes(category)
  ) return 'mildly_cyclical';
  return 'stable';
}

function uniqueThemes(values: Array<SymbolTheme | null | undefined>): SymbolTheme[] {
  return Array.from(new Set(values.filter(Boolean))) as SymbolTheme[];
}

function inferThemeMembershipsFromHaystack(haystack: string): SymbolTheme[] {
  const hasAny = (...tokens: string[]) => tokens.some((token) => haystack.includes(token));
  const themes: SymbolTheme[] = [];

  const isSoftware =
    hasAny(
      'software',
      'saas',
      'cloud',
      'application software',
      'infrastructure software',
      'developer tools',
      'devops',
      'database',
      'observability',
      'monitoring',
      'cybersecurity',
      'workflow software',
      'crm',
      'marketing automation',
      'advertising agencies',
      'digital advertising',
      'programmatic advertising',
      'digital media',
      'e-signature',
      'video conferencing',
      'work management',
      'project management',
      'enterprise software'
    )
    || hasAny(
      'atlassian',
      'asana',
      'monday.com',
      'monday com',
      'doximity',
      'figma',
      'duolingo',
      'hubspot',
      'gitlab',
      'workday',
      'trade desk',
      'intuit',
      'klaviyo',
      'mongodb',
      'servicenow',
      'snowflake',
      'elastic',
      'braze',
      'commvault',
      'guidewire',
      'salesforce',
      'adobe',
      'docusign',
      'sap',
      'veeva',
      'zeta',
      'samsara',
      'autodesk',
      'datadog',
      'twilio',
      'cloudflare',
      'zoom'
    )
    || /software\s-\s(application|infrastructure)/.test(haystack);

  if (!isSoftware) return themes;

  themes.push('software');
  if (hasAny('saas', 'cloud', 'cloud platform', 'cloud-based', 'cloud software', 'iaas', 'paas')) themes.push('cloud');
  if (hasAny('application software', 'software - application', 'crm', 'erp', 'e-signature', 'workflow', 'marketing automation', 'hr software', 'project management', 'work management', 'video conferencing', 'productivity software', 'design software', 'digital media')) {
    themes.push('software_application');
  }
  if (hasAny('infrastructure software', 'software - infrastructure', 'database', 'data warehouse', 'data platform', 'observability', 'monitoring', 'logging', 'edge network', 'developer tools', 'devops', 'source code', 'version control', 'application lifecycle', 'cybersecurity')) {
    themes.push('software_infrastructure');
  }
  if (hasAny('developer tools', 'devops', 'source code', 'version control', 'ci/cd', 'application lifecycle', 'gitlab', 'github')) themes.push('devtools');
  if (hasAny('database', 'data warehouse', 'data platform', 'observability', 'monitoring', 'logging', 'search analytics', 'telemetry', 'analytics cloud')) themes.push('data_infrastructure');
  if (hasAny('advertising', 'adtech', 'programmatic', 'mobile advertising')) themes.push('adtech');
  if (hasAny('marketing automation', 'customer engagement', 'email marketing', 'marketing cloud', 'martech')) themes.push('marketing_software');
  if (hasAny('digital media', 'creative software', 'design software', 'document cloud', 'e-signature', 'document management')) themes.push('design_creative_software');
  if (hasAny('video conferencing', 'communications software', 'collaboration', 'productivity software', 'work management', 'project management', 'messaging')) themes.push('collaboration_software');
  if (hasAny('payments processing', 'financial technology', 'fintech', 'banking software', 'insurance software', 'capital markets software')) themes.push('fintech_software');
  if (hasAny('life sciences software', 'healthcare software', 'property and casualty software', 'construction software', 'vertical software', 'industry cloud')) themes.push('vertical_software');

  return uniqueThemes(themes);
}

function normalizeSymbol(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function trimString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function openCatalog(readOnly: boolean): DatabaseSync | null {
  if (!fs.existsSync(SYMBOL_CATALOG_DB_PATH)) return null;
  try {
    return new DatabaseSync(SYMBOL_CATALOG_DB_PATH, { readOnly });
  } catch {
    return null;
  }
}

function ensureWritableCatalogSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      symbol TEXT PRIMARY KEY,
      asset_class TEXT NOT NULL,
      name TEXT,
      exchange TEXT,
      sector TEXT,
      industry TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      optionable INTEGER,
      underlying_symbol TEXT,
      currency TEXT,
      cik TEXT,
      sec_name TEXT,
      sec_exchange TEXT,
      has_sec_mapping INTEGER,
      company_type TEXT,
      valuation_engine_class TEXT,
      classification_source TEXT,
      classification_confidence REAL,
      last_classified_at TEXT,
      source_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS symbol_memberships (
      symbol TEXT NOT NULL,
      membership_type TEXT NOT NULL,
      membership_value TEXT NOT NULL,
      source TEXT,
      as_of TEXT,
      payload_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (symbol, membership_type, membership_value)
    );
    CREATE TABLE IF NOT EXISTS symbol_metrics (
      symbol TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value_num REAL,
      metric_value_text TEXT,
      source TEXT,
      as_of TEXT,
      payload_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (symbol, metric_name)
    );
    CREATE INDEX IF NOT EXISTS idx_symbol_memberships_lookup
      ON symbol_memberships(membership_type, membership_value, symbol);
    CREATE INDEX IF NOT EXISTS idx_symbol_metrics_lookup
      ON symbol_metrics(metric_name, symbol);
  `);
  const ddls = [
    "ALTER TABLE symbols ADD COLUMN sector TEXT",
    "ALTER TABLE symbols ADD COLUMN industry TEXT",
    "ALTER TABLE symbols ADD COLUMN company_type TEXT",
    "ALTER TABLE symbols ADD COLUMN valuation_engine_class TEXT",
    "ALTER TABLE symbols ADD COLUMN classification_source TEXT",
    "ALTER TABLE symbols ADD COLUMN classification_confidence REAL",
    "ALTER TABLE symbols ADD COLUMN last_classified_at TEXT",
  ];
  for (const ddl of ddls) {
    try {
      db.exec(ddl);
    } catch {}
  }
}

export function upsertSymbolMetrics(
  symbol: string,
  metrics: Array<{
    metricName: string;
    metricValueNum?: number | null;
    metricValueText?: string | null;
    source?: string | null;
    asOf?: string | null;
    payload?: Record<string, unknown> | null;
  }>,
): void {
  const sym = normalizeSymbol(symbol);
  if (!sym || !Array.isArray(metrics) || !metrics.length) return;
  const db = openCatalog(false);
  if (!db) return;
  try {
    ensureWritableCatalogSchema(db);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO symbol_metrics (
        symbol, metric_name, metric_value_num, metric_value_text, source, as_of, payload_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, metric_name) DO UPDATE SET
        metric_value_num = excluded.metric_value_num,
        metric_value_text = excluded.metric_value_text,
        source = excluded.source,
        as_of = excluded.as_of,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    for (const metric of metrics) {
      const metricName = trimString(metric.metricName);
      if (!metricName) continue;
      stmt.run(
        sym,
        metricName,
        metric.metricValueNum ?? null,
        metric.metricValueText ?? null,
        metric.source ?? null,
        metric.asOf ?? now,
        metric.payload != null ? JSON.stringify(metric.payload) : null,
        now,
      );
    }
  } catch {
    // Best-effort enrichment only.
  } finally {
    try { db.close(); } catch {}
  }
}

export function classifyCompanyFromSnapshot(snapshot: Record<string, any> | null | undefined): Omit<SymbolClassification, 'symbol' | 'lastClassifiedAt'> | null {
  const sector = trimString(snapshot?.sector);
  const industry = trimString(snapshot?.industry);
  const companyName = trimString(snapshot?.companyName) || trimString(snapshot?.name) || trimString(snapshot?.sec_name);
  const description = trimString(snapshot?.businessDescription);
  const haystack = `${sector || ''} ${industry || ''} ${companyName || ''} ${description || ''}`.toLowerCase();
  const freeCashFlow = toFiniteNumber(snapshot?.freeCashFlowTTM);
  const operatingCashFlow = toFiniteNumber(snapshot?.operatingCashFlowTTM);
  const revenueGrowthPct = toFiniteNumber(snapshot?.revenueGrowthPct) ?? toFiniteNumber(snapshot?.revenueYoYGrowthPct);
  const themeMemberships = inferThemeMembershipsFromHaystack(haystack);

  if (!sector && !industry && !companyName && !description) return null;

  const consumerProfile = (() => {
    const hasAny = (...tokens: string[]) => tokens.some((token) => haystack.includes(token));

    if (hasAny('healthcare', 'health care', 'pharma', 'pharmaceutical', 'biotech', 'medical', 'hospital', 'diagnostic', 'dental', 'surgical', 'therapeutic', 'life sciences')) {
      return {
        consumerDemandBucket: 'healthcare' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'healthcare' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'prefer_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.93,
      };
    }
    if (hasAny('homebuilder', 'homebuilders', 'home building', 'homebuilding', 'residential construction', 'single-family homes', 'multifamily homes')) {
      return {
        consumerDemandBucket: 'residential_investment' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'residential_investment' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.9,
      };
    }
    if (hasAny(
      'industrial machinery',
      'industrial equipment',
      'machinery',
      'construction equipment',
      'farm equipment',
      'agricultural equipment',
      'semiconductor equipment',
      'semiconductor',
      'semiconductors',
      'chip',
      'chips',
      'network equipment',
      'networking',
      'server',
      'servers',
      'storage systems',
      'communications equipment',
      'data center',
      'datacenter',
      'factory automation',
      'capital equipment',
      'machine tools'
    )) {
      return {
        consumerDemandBucket: 'business_equipment_investment' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'business_equipment_investment' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.88,
      };
    }
    if (hasAny('utility', 'utilities', 'electric', 'water', 'gas distribution', 'multi-utilities', 'residential reit', 'apartment', 'single-family rental', 'telecom', 'wireless', 'broadband')) {
      return {
        consumerDemandBucket: 'housing_utilities' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'housing_utilities' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'prefer_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.88,
      };
    }
    if (hasAny('grocery', 'food retail', 'consumer staples', 'packaged foods', 'beverage', 'beverages', 'household products', 'personal products', 'discount stores', 'supermarket', 'tobacco')) {
      return {
        consumerDemandBucket: 'groceries_staples' as ConsumerDemandBucket,
        consumerSpendClass: 'nondurable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'food_beverages_home' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'prefer_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.9,
      };
    }
    if (hasAny('insurance', 'asset management', 'capital markets', 'consumer finance', 'bank', 'banks', 'financial', 'mortgage finance', 'brokerage', 'wealth management')) {
      return {
        consumerDemandBucket: 'financial_services_insurance' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'financial_services_insurance' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'prefer_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.84,
      };
    }
    if (hasAny('auto', 'automotive', 'motor vehicle', 'vehicle', 'dealership', 'truck', 'tire', 'auto parts', 'automotive parts')) {
      return {
        consumerDemandBucket: 'autos_transport' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'motor_vehicles_parts' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.91,
      };
    }
    if (hasAny('airline', 'airlines', 'car rental', 'transportation services', 'travel services', 'passenger rail', 'airport services')) {
      return {
        consumerDemandBucket: 'autos_transport' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'transportation_services' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.87,
      };
    }
    if (hasAny('furniture', 'appliance', 'home improvement', 'building products', 'flooring', 'mattress', 'home furnishings', 'housing products')) {
      return {
        consumerDemandBucket: 'home_furnishings_appliances' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'furnishings_household_equipment' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.9,
      };
    }
    if (hasAny(
      'aerospace',
      'defense',
      'industrial products',
      'engineered products',
      'electrical equipment',
      'heavy equipment',
      'trailers',
      'power tools',
      'consumer electronics',
      'electronic components',
      'instruments',
      'test equipment',
      'manufacturing equipment',
      'durable goods'
    )) {
      return {
        consumerDemandBucket: 'recreation_discretionary' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'other_durable_goods' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.82,
      };
    }
    if (hasAny('restaurant', 'restaurants', 'hotel', 'hotels', 'lodging', 'food service', 'accommodation', 'cruise', 'theme park')) {
      return {
        consumerDemandBucket: 'recreation_discretionary' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'food_service_accommodations' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.88,
      };
    }
    if (hasAny('apparel', 'footwear', 'shoe', 'shoes', 'clothing')) {
      return {
        consumerDemandBucket: 'recreation_discretionary' as ConsumerDemandBucket,
        consumerSpendClass: 'nondurable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'clothing_footwear' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.84,
      };
    }
    if (hasAny('oil', 'gasoline', 'gas station', 'fuel', 'energy marketing', 'refining', 'refiner', 'convenience store fuel', 'petroleum')) {
      return {
        consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
        consumerSpendClass: 'nondurable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'gas_energy_goods' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.8,
      };
    }
    if (hasAny('chemical', 'chemicals', 'paper', 'packaging', 'containers', 'sanitary products', 'consumer products', 'household chemicals', 'specialty chemicals')) {
      return {
        consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
        consumerSpendClass: 'nondurable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'other_nondurable_goods' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.76,
      };
    }
    if (hasAny('restaurant', 'travel', 'hotel', 'lodging', 'cruise', 'gaming', 'casino', 'entertainment', 'recreation', 'apparel', 'footwear', 'specialty retail', 'department stores', 'leisure', 'streaming', 'media')) {
      return {
        consumerDemandBucket: 'recreation_discretionary' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'recreation_services' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'neutral_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.89,
      };
    }
    if (hasAny('software', 'saas', 'cloud', 'cybersecurity', 'consulting', 'staffing', 'education services', 'data processing', 'advertising', 'payments processing', 'it services', 'professional services')) {
      return {
        consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'other_services' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.74,
      };
    }
    if (hasAny('retail', 'e-commerce', 'consumer discretionary', 'specialty consumer', 'internet retail', 'homebuilding', 'homebuilder')) {
      return {
        consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'mixed_consumer' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.72,
      };
    }
    if (hasAny('technology', 'semiconductor', 'electronics', 'networking', 'hardware', 'industrial', 'materials', 'manufacturing')) {
      return {
        consumerDemandBucket: 'business_equipment_investment' as ConsumerDemandBucket,
        consumerSpendClass: 'durable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'business_equipment_investment' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'highly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'vulnerable' as RecessionProfile,
        macroRegimePreference: 'avoid_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.7,
      };
    }
    if (hasAny('energy')) {
      return {
        consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
        consumerSpendClass: 'nondurable_goods' as ConsumerSpendClass,
        consumerSpendingCategory: 'gas_energy_goods' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
        recessionProfile: 'mixed' as RecessionProfile,
        macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.66,
      };
    }
    if (hasAny('communication services', 'media', 'telecom', 'internet content', 'interactive media')) {
      return {
        consumerDemandBucket: 'recreation_discretionary' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'recreation_services' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'neutral_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.7,
      };
    }
    if (hasAny('real estate', 'reit', 'property')) {
      return {
        consumerDemandBucket: 'housing_utilities' as ConsumerDemandBucket,
        consumerSpendClass: 'services' as ConsumerSpendClass,
        consumerSpendingCategory: 'housing_utilities' as ConsumerSpendingCategory,
        consumerCycleSensitivity: 'defensive' as ConsumerCycleSensitivity,
        recessionProfile: 'resilient' as RecessionProfile,
        macroRegimePreference: 'prefer_in_slowdown' as MacroRegimePreference,
        consumerClassificationConfidence: 0.68,
      };
    }
    return {
      consumerDemandBucket: 'consumer_mixed' as ConsumerDemandBucket,
      consumerSpendClass: 'services' as ConsumerSpendClass,
      consumerSpendingCategory: 'other_services' as ConsumerSpendingCategory,
      consumerCycleSensitivity: 'mildly_cyclical' as ConsumerCycleSensitivity,
      recessionProfile: 'mixed' as RecessionProfile,
      macroRegimePreference: 'selective_in_slowdown' as MacroRegimePreference,
      consumerClassificationConfidence: 0.45,
    };
  })();
  (consumerProfile as any).consumerCycleBucket = bucketForCategory(consumerProfile.consumerSpendingCategory);

  if (/\breit\b|\breal estate investment trust\b/.test(haystack)) {
    return {
      sector,
      industry,
      companyType: 'reit',
      valuationEngineClass: 'reit_affo',
      classificationSource: 'snapshot_rule',
      classificationConfidence: 0.9,
      themeMemberships,
      ...consumerProfile,
    };
  }

  const capitalLightFinancial = /\b(asset management|investment management|wealth management|alternative asset|private equity|investment advisory|fund manager|capital markets)\b/.test(haystack);
  if (capitalLightFinancial) {
    return {
      sector,
      industry,
      companyType: 'operating_company',
      valuationEngineClass: 'asset_manager_fre',
      classificationSource: 'snapshot_rule',
      classificationConfidence: 0.88,
      themeMemberships,
      ...consumerProfile,
    };
  }
  if (!capitalLightFinancial && /\bfinancial\b|\bbank\b|\bbanks\b|\binsurance\b|\bcredit\b|\blender\b|\blending\b|\bmortgage\b|\bconsumer finance\b/.test(haystack)) {
    return {
      sector,
      industry,
      companyType: 'financial_company',
      valuationEngineClass: 'roe_book_value',
      classificationSource: 'snapshot_rule',
      classificationConfidence: 0.92,
      themeMemberships,
      ...consumerProfile,
    };
  }

  if ((freeCashFlow != null && freeCashFlow < 0) || (operatingCashFlow != null && operatingCashFlow < 0)) {
    return {
      sector,
      industry,
      companyType: 'preprofit_growth',
      valuationEngineClass: 'sales_scenario',
      classificationSource: 'snapshot_rule',
      classificationConfidence: revenueGrowthPct != null ? 0.82 : 0.72,
      themeMemberships,
      ...consumerProfile,
    };
  }

  return {
    sector,
    industry,
    companyType: 'operating_company',
    valuationEngineClass: 'dcf_operating',
    classificationSource: 'snapshot_rule',
    classificationConfidence: 0.8,
    themeMemberships,
    ...consumerProfile,
  };
}

export function getSymbolClassification(symbol: string): SymbolClassification | null {
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  const db = openCatalog(true);
  if (!db) return null;
  try {
    const row = db.prepare(`
      SELECT symbol, sector, industry, company_type, valuation_engine_class,
             classification_source, classification_confidence, last_classified_at,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'consumer_cycle_bucket' LIMIT 1) AS consumer_cycle_bucket,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'consumer_demand_bucket' LIMIT 1) AS consumer_demand_bucket,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'consumer_spend_class' LIMIT 1) AS consumer_spend_class,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'consumer_spending_category' LIMIT 1) AS consumer_spending_category,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'consumer_cycle_sensitivity' LIMIT 1) AS consumer_cycle_sensitivity,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'recession_profile' LIMIT 1) AS recession_profile,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'macro_regime_preference' LIMIT 1) AS macro_regime_preference,
             (SELECT GROUP_CONCAT(membership_value, '|') FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'theme') AS theme_memberships
      FROM symbols
      WHERE symbol = ?
    `).get(sym) as Record<string, any> | undefined;
    if (!row) return null;
    return {
      symbol: normalizeSymbol(row.symbol),
      sector: trimString(row.sector),
      industry: trimString(row.industry),
      companyType: trimString(row.company_type) as CompanyType | null,
      valuationEngineClass: trimString(row.valuation_engine_class) as ValuationEngineClass | null,
      classificationSource: trimString(row.classification_source),
      classificationConfidence: toFiniteNumber(row.classification_confidence),
      lastClassifiedAt: trimString(row.last_classified_at),
      consumerCycleBucket: (trimString(row.consumer_cycle_bucket) as ConsumerCycleBucket | null) || bucketForCategory(trimString(row.consumer_spending_category) as ConsumerSpendingCategory | null),
      consumerDemandBucket: trimString(row.consumer_demand_bucket) as ConsumerDemandBucket | null,
      consumerSpendClass: trimString(row.consumer_spend_class) as ConsumerSpendClass | null,
      consumerSpendingCategory: trimString(row.consumer_spending_category) as ConsumerSpendingCategory | null,
      consumerCycleSensitivity: trimString(row.consumer_cycle_sensitivity) as ConsumerCycleSensitivity | null,
      recessionProfile: trimString(row.recession_profile) as RecessionProfile | null,
      macroRegimePreference: trimString(row.macro_regime_preference) as MacroRegimePreference | null,
      themeMemberships: trimString(row.theme_memberships)
        ? trimString(row.theme_memberships)!.split('|').map((value) => trimString(value)).filter(Boolean) as SymbolTheme[]
        : [],
    };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

function normalizeValuationState(value: unknown): ValuationState | null {
  const text = trimString(value)?.toLowerCase();
  if (text === 'undervalued' || text === 'overvalued' || text === 'roughly_fair' || text === 'fair') {
    return text as ValuationState;
  }
  return null;
}

export function getSymbolValuationSnapshot(symbol: string): SymbolValuationSnapshot | null {
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  const db = openCatalog(true);
  if (!db) return null;
  try {
    const row = db.prepare(`
      SELECT symbol,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'valuation_state' LIMIT 1) AS valuation_state,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'valuation_quality_grade' LIMIT 1) AS valuation_quality_grade,
             (SELECT membership_value FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'valuation_coverage_mode' LIMIT 1) AS valuation_coverage_mode,
             (SELECT as_of FROM symbol_memberships WHERE symbol = symbols.symbol AND membership_type = 'valuation_state' LIMIT 1) AS valuation_as_of,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_price' LIMIT 1) AS valuation_price,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_fair_value_low' LIMIT 1) AS valuation_fair_value_low,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_fair_value_mid' LIMIT 1) AS valuation_fair_value_mid,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_fair_value_high' LIMIT 1) AS valuation_fair_value_high,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_gap_pct' LIMIT 1) AS valuation_gap_pct,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_market_cap' LIMIT 1) AS valuation_market_cap,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_enterprise_value' LIMIT 1) AS valuation_enterprise_value,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_enterprise_to_sales' LIMIT 1) AS valuation_enterprise_to_sales,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_revenue' LIMIT 1) AS valuation_revenue,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_free_cash_flow' LIMIT 1) AS valuation_free_cash_flow,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_shares_outstanding' LIMIT 1) AS valuation_shares_outstanding,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_revenue_growth_pct' LIMIT 1) AS valuation_revenue_growth_pct,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_operating_margin_pct' LIMIT 1) AS valuation_operating_margin_pct,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_free_cash_flow_margin_pct' LIMIT 1) AS valuation_free_cash_flow_margin_pct,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_current_ratio' LIMIT 1) AS valuation_current_ratio,
             (SELECT metric_value_num FROM symbol_metrics WHERE symbol = symbols.symbol AND metric_name = 'valuation_quality_score' LIMIT 1) AS valuation_quality_score
      FROM symbols
      WHERE symbol = ?
    `).get(sym) as Record<string, any> | undefined;
    if (!row) return null;
    const valuationState = normalizeValuationState(row.valuation_state);
    const fairValueMid = toFiniteNumber(row.valuation_fair_value_mid);
    const valuationGapPct = toFiniteNumber(row.valuation_gap_pct);
    if (!valuationState && fairValueMid == null && valuationGapPct == null) {
      return null;
    }
    return {
      symbol: normalizeSymbol(row.symbol),
      valuationState,
      qualityGrade: trimString(row.valuation_quality_grade),
      qualityScore: toFiniteNumber(row.valuation_quality_score),
      coverageMode: trimString(row.valuation_coverage_mode),
      price: toFiniteNumber(row.valuation_price),
      fairValueLow: toFiniteNumber(row.valuation_fair_value_low),
      fairValueMid,
      fairValueHigh: toFiniteNumber(row.valuation_fair_value_high),
      valuationGapPct,
      marketCap: toFiniteNumber(row.valuation_market_cap),
      enterpriseValue: toFiniteNumber(row.valuation_enterprise_value),
      enterpriseToSales: toFiniteNumber(row.valuation_enterprise_to_sales),
      revenue: toFiniteNumber(row.valuation_revenue),
      freeCashFlow: toFiniteNumber(row.valuation_free_cash_flow),
      sharesOutstanding: toFiniteNumber(row.valuation_shares_outstanding),
      revenueGrowthPct: toFiniteNumber(row.valuation_revenue_growth_pct),
      operatingMarginPct: toFiniteNumber(row.valuation_operating_margin_pct),
      freeCashFlowMarginPct: toFiniteNumber(row.valuation_free_cash_flow_margin_pct),
      currentRatio: toFiniteNumber(row.valuation_current_ratio),
      asOfDate: trimString(row.valuation_as_of),
    };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

export function listTradableUniverseScreenRows(): TradableUniverseScreenRow[] {
  const db = openCatalog(true);
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT
        s.symbol,
        s.name,
        s.sec_name,
        s.exchange,
        s.sec_exchange,
        s.sector,
        s.industry,
        s.optionable,
        s.company_type,
        s.valuation_engine_class,
        s.classification_source,
        s.classification_confidence,
        s.last_classified_at,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_cycle_bucket' LIMIT 1) AS consumer_cycle_bucket,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_demand_bucket' LIMIT 1) AS consumer_demand_bucket,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_spend_class' LIMIT 1) AS consumer_spend_class,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_spending_category' LIMIT 1) AS consumer_spending_category,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_cycle_sensitivity' LIMIT 1) AS consumer_cycle_sensitivity,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'recession_profile' LIMIT 1) AS recession_profile,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'macro_regime_preference' LIMIT 1) AS macro_regime_preference,
        (SELECT GROUP_CONCAT(membership_value, '|') FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'theme') AS theme_memberships,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'valuation_state' LIMIT 1) AS valuation_state,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'valuation_quality_grade' LIMIT 1) AS valuation_quality_grade,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'valuation_coverage_mode' LIMIT 1) AS valuation_coverage_mode,
        (SELECT as_of FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'valuation_state' LIMIT 1) AS valuation_as_of,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_price' LIMIT 1) AS valuation_price,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_fair_value_low' LIMIT 1) AS valuation_fair_value_low,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_fair_value_mid' LIMIT 1) AS valuation_fair_value_mid,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_fair_value_high' LIMIT 1) AS valuation_fair_value_high,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_gap_pct' LIMIT 1) AS valuation_gap_pct,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_market_cap' LIMIT 1) AS valuation_market_cap,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_enterprise_value' LIMIT 1) AS valuation_enterprise_value,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_enterprise_to_sales' LIMIT 1) AS valuation_enterprise_to_sales,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_revenue' LIMIT 1) AS valuation_revenue,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_free_cash_flow' LIMIT 1) AS valuation_free_cash_flow,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_shares_outstanding' LIMIT 1) AS valuation_shares_outstanding,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_revenue_growth_pct' LIMIT 1) AS valuation_revenue_growth_pct,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_operating_margin_pct' LIMIT 1) AS valuation_operating_margin_pct,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_free_cash_flow_margin_pct' LIMIT 1) AS valuation_free_cash_flow_margin_pct,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_current_ratio' LIMIT 1) AS valuation_current_ratio,
        (SELECT metric_value_num FROM symbol_metrics WHERE symbol = s.symbol AND metric_name = 'valuation_quality_score' LIMIT 1) AS valuation_quality_score
      FROM symbols s
      JOIN symbol_memberships eligibility
        ON eligibility.symbol = s.symbol
       AND eligibility.membership_type = 'eligibility'
       AND eligibility.membership_value = 'tradable_stock_default'
      WHERE COALESCE(s.asset_class, 'stocks') = 'stocks'
      ORDER BY s.symbol ASC
    `).all() as Array<Record<string, any>>;

    return rows.map((row) => {
      const classification: SymbolClassification = {
        symbol: normalizeSymbol(row.symbol),
        sector: trimString(row.sector),
        industry: trimString(row.industry),
        companyType: trimString(row.company_type) as CompanyType | null,
        valuationEngineClass: trimString(row.valuation_engine_class) as ValuationEngineClass | null,
        classificationSource: trimString(row.classification_source),
        classificationConfidence: toFiniteNumber(row.classification_confidence),
        lastClassifiedAt: trimString(row.last_classified_at),
        consumerCycleBucket: (trimString(row.consumer_cycle_bucket) as ConsumerCycleBucket | null) || bucketForCategory(trimString(row.consumer_spending_category) as ConsumerSpendingCategory | null),
        consumerDemandBucket: trimString(row.consumer_demand_bucket) as ConsumerDemandBucket | null,
        consumerSpendClass: trimString(row.consumer_spend_class) as ConsumerSpendClass | null,
        consumerSpendingCategory: trimString(row.consumer_spending_category) as ConsumerSpendingCategory | null,
        consumerCycleSensitivity: trimString(row.consumer_cycle_sensitivity) as ConsumerCycleSensitivity | null,
        recessionProfile: trimString(row.recession_profile) as RecessionProfile | null,
        macroRegimePreference: trimString(row.macro_regime_preference) as MacroRegimePreference | null,
        themeMemberships: trimString(row.theme_memberships)
          ? trimString(row.theme_memberships)!.split('|').map((value) => trimString(value)).filter(Boolean) as SymbolTheme[]
          : [],
      };

      const valuationState = normalizeValuationState(row.valuation_state);
      const fairValueMid = toFiniteNumber(row.valuation_fair_value_mid);
      const valuationGapPct = toFiniteNumber(row.valuation_gap_pct);
      const valuation = (!valuationState && fairValueMid == null && valuationGapPct == null)
        ? null
        : {
            symbol: normalizeSymbol(row.symbol),
            valuationState,
            qualityGrade: trimString(row.valuation_quality_grade),
            qualityScore: toFiniteNumber(row.valuation_quality_score),
            coverageMode: trimString(row.valuation_coverage_mode),
            price: toFiniteNumber(row.valuation_price),
            fairValueLow: toFiniteNumber(row.valuation_fair_value_low),
            fairValueMid,
            fairValueHigh: toFiniteNumber(row.valuation_fair_value_high),
            valuationGapPct,
            marketCap: toFiniteNumber(row.valuation_market_cap),
            enterpriseValue: toFiniteNumber(row.valuation_enterprise_value),
            enterpriseToSales: toFiniteNumber(row.valuation_enterprise_to_sales),
            revenue: toFiniteNumber(row.valuation_revenue),
            freeCashFlow: toFiniteNumber(row.valuation_free_cash_flow),
            sharesOutstanding: toFiniteNumber(row.valuation_shares_outstanding),
            revenueGrowthPct: toFiniteNumber(row.valuation_revenue_growth_pct),
            operatingMarginPct: toFiniteNumber(row.valuation_operating_margin_pct),
            freeCashFlowMarginPct: toFiniteNumber(row.valuation_free_cash_flow_margin_pct),
            currentRatio: toFiniteNumber(row.valuation_current_ratio),
            asOfDate: trimString(row.valuation_as_of),
          } satisfies SymbolValuationSnapshot;

      return {
        symbol: normalizeSymbol(row.symbol),
        name: trimString(row.name) || trimString(row.sec_name),
        exchange: trimString(row.exchange) || trimString(row.sec_exchange),
        sector: trimString(row.sector),
        industry: trimString(row.industry),
        optionable: row.optionable == null ? null : Boolean(row.optionable),
        classification,
        valuation,
      };
    });
  } catch {
    return [];
  } finally {
    try { db.close(); } catch {}
  }
}

export function upsertSymbolClassification(symbol: string, classification: Omit<SymbolClassification, 'symbol'>): void {
  const sym = normalizeSymbol(symbol);
  if (!sym) return;
  const db = openCatalog(false);
  if (!db) return;
  try {
    ensureWritableCatalogSchema(db);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO symbols (
        symbol, asset_class, sector, industry, active, company_type,
        valuation_engine_class, classification_source, classification_confidence,
        last_classified_at, updated_at
      )
      VALUES (?, 'stocks', ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        sector = COALESCE(excluded.sector, symbols.sector),
        industry = COALESCE(excluded.industry, symbols.industry),
        company_type = COALESCE(excluded.company_type, symbols.company_type),
        valuation_engine_class = COALESCE(excluded.valuation_engine_class, symbols.valuation_engine_class),
        classification_source = COALESCE(excluded.classification_source, symbols.classification_source),
        classification_confidence = COALESCE(excluded.classification_confidence, symbols.classification_confidence),
        last_classified_at = COALESCE(excluded.last_classified_at, symbols.last_classified_at),
        updated_at = excluded.updated_at
    `).run(
      sym,
      classification.sector,
      classification.industry,
      classification.companyType,
      classification.valuationEngineClass,
      classification.classificationSource,
      classification.classificationConfidence,
      classification.lastClassifiedAt || now,
      now,
    );

    if (classification.companyType) {
      db.prepare(`
        DELETE FROM symbol_memberships
        WHERE symbol = ? AND membership_type = 'company_type'
      `).run(sym);
      db.prepare(`
        INSERT INTO symbol_memberships (
          symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
        ) VALUES (?, 'company_type', ?, ?, ?, NULL, ?)
        ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
          source = excluded.source,
          as_of = excluded.as_of,
          updated_at = excluded.updated_at
      `).run(sym, classification.companyType, classification.classificationSource || 'snapshot_rule', classification.lastClassifiedAt || now, now);
    }

    if (classification.valuationEngineClass) {
      db.prepare(`
        DELETE FROM symbol_memberships
        WHERE symbol = ? AND membership_type = 'valuation_engine_class'
      `).run(sym);
      db.prepare(`
        INSERT INTO symbol_memberships (
          symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
        ) VALUES (?, 'valuation_engine_class', ?, ?, ?, NULL, ?)
        ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
          source = excluded.source,
          as_of = excluded.as_of,
          updated_at = excluded.updated_at
      `).run(sym, classification.valuationEngineClass, classification.classificationSource || 'snapshot_rule', classification.lastClassifiedAt || now, now);
    }

    const consumerCycleBucket = classification.consumerCycleBucket || bucketForCategory(classification.consumerSpendingCategory);
    const membershipMappings: Array<[string, string | null | undefined]> = [
      ['consumer_cycle_bucket', consumerCycleBucket],
      ['consumer_demand_bucket', classification.consumerDemandBucket],
      ['consumer_spend_class', classification.consumerSpendClass],
      ['consumer_spending_category', classification.consumerSpendingCategory],
      ['consumer_cycle_sensitivity', classification.consumerCycleSensitivity],
      ['recession_profile', classification.recessionProfile],
      ['macro_regime_preference', classification.macroRegimePreference],
    ];
    for (const [membershipType, membershipValue] of membershipMappings) {
      db.prepare(`
        DELETE FROM symbol_memberships
        WHERE symbol = ? AND membership_type = ?
      `).run(sym, membershipType);
      if (!membershipValue) continue;
      db.prepare(`
        INSERT INTO symbol_memberships (
          symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
          source = excluded.source,
          as_of = excluded.as_of,
          updated_at = excluded.updated_at
      `).run(sym, membershipType, membershipValue, classification.classificationSource || 'snapshot_rule', classification.lastClassifiedAt || now, now);
    }

    db.prepare(`
      DELETE FROM symbol_memberships
      WHERE symbol = ? AND membership_type = 'theme'
    `).run(sym);
    for (const theme of classification.themeMemberships || []) {
      db.prepare(`
        INSERT INTO symbol_memberships (
          symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
        ) VALUES (?, 'theme', ?, ?, ?, NULL, ?)
        ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
          source = excluded.source,
          as_of = excluded.as_of,
          updated_at = excluded.updated_at
      `).run(sym, theme, classification.classificationSource || 'snapshot_rule', classification.lastClassifiedAt || now, now);
    }
  } catch {
    // Best-effort backfill only.
  } finally {
    try { db.close(); } catch {}
  }
}

export function bulkLookupSymbolNames(symbols: string[]): Record<string, string> {
  if (!symbols.length) return {};
  const db = openCatalog(true);
  if (!db) return {};
  try {
    const placeholders = symbols.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT symbol, COALESCE(name, sec_name) AS company_name FROM symbols WHERE symbol IN (${placeholders})`
    ).all(...symbols.map(normalizeSymbol)) as Array<{ symbol: string; company_name: string | null }>;
    const map: Record<string, string> = {};
    for (const r of rows) {
      if (r.company_name) map[r.symbol] = r.company_name;
    }
    return map;
  } catch {
    return {};
  } finally {
    try { db.close(); } catch {}
  }
}
