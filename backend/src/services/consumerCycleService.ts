import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  classifyCompanyFromSnapshot,
  type ConsumerCycleBucket,
  type ConsumerCycleSensitivity,
  type ConsumerDemandBucket,
  type ConsumerSpendClass,
  type ConsumerSpendingCategory,
  type MacroRegimePreference,
  type RecessionProfile,
} from './symbolCatalog';
import { normalizeChartOhlcvPayload } from './contractValidation';

const DATA_DIR = path.join(__dirname, '../../data');
const SYMBOL_CATALOG_DB_PATH = path.join(DATA_DIR, 'symbol-catalog.sqlite');
const PY_SERVICE_BASE_URL = (process.env.PY_PLUGIN_SERVICE_URL || 'http://127.0.0.1:8100').replace(/\/+$/, '');
// Transports relative-strength proxy: IYT (iShares Transportation, tracks the
// Dow Jones Transportation Average) measured against SPY. A market-implied,
// daily, LEADING freight-demand signal (Dow Theory) to complement the lagging
// FRED quantity series.
const TRANSPORTS_SYMBOL = 'IYT';
const TRANSPORTS_BENCHMARK = 'SPY';
const STATISTICAL_INDEX_SYMBOL = '^GSPC';
const STATISTICAL_INDEX_ANCHOR_DATE = '1987-10-19';
const STATISTICAL_SECTOR_SYMBOLS = ['XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC'];
const STATISTICAL_MARKET_STRETCH_SYMBOLS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'Nasdaq Composite' },
  { symbol: 'QQQ', label: 'QQQ' },
  { symbol: 'IWM', label: 'IWM' },
  { symbol: 'RSP', label: 'Equal-weight S&P' },
  { symbol: 'DIA', label: 'Dow / DIA' },
  { symbol: 'XLK', label: 'Technology / XLK' },
  { symbol: 'SMH', label: 'Semis / SMH' },
  { symbol: 'SOXX', label: 'Semis / SOXX' },
];
const STATISTICAL_CORRELATION_WINDOW = 60;
const EXTREME_DEVIATION_RAW_SCAN_PATH = path.join(DATA_DIR, 'research', 'extreme_deviation_scan.raw6.latest.json');
const EXTREME_DEVIATION_LOG_SCAN_PATH = path.join(DATA_DIR, 'research', 'extreme_deviation_scan.log5.latest.json');
const LINEAR_CRASH_STRETCH_EVENTS = [
  { name: '2000 dot-com bear', date: '2000-03-24' },
  { name: '2007 GFC bear', date: '2007-10-09' },
  { name: '2018 Q4 tightening crash', date: '2018-09-20' },
  { name: '2020 Covid crash', date: '2020-02-19' },
  { name: '2022 inflation/rate bear', date: '2022-01-03' },
  { name: '2025 weekly-visible correction', date: '2025-02-14' },
  { name: '2026 latest weekly-visible correction', date: '2026-06-02' },
];
const DEFAULT_LIMIT = 250;
const MONITOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type MonitorStatus = 'green' | 'yellow' | 'orange' | 'red';

type ConsumerCycleSeriesDefinition = {
  key: string;
  label: string;
  seriesId: string;
  group: 'cyclical_consumer' | 'companion' | 'industrial_producer';
  weight: number;
  description: string;
  // How many observations make up one year (4 = quarterly, 12 = monthly).
  // Used so YoY/momentum lookbacks are correct for mixed-frequency series.
  periodsPerYear?: number;
};

type ConsumerCyclePoint = {
  date: string;
  value: number;
};

type ConsumerCycleMonitorSeries = {
  key: string;
  label: string;
  seriesId: string;
  group: 'cyclical_consumer' | 'companion' | 'industrial_producer';
  description: string;
  latestDate: string | null;
  latestValue: number | null;
  yoyPct: number | null;
  qoqAnnualizedPct: number | null;
  twoQuarterPct: number | null;
  status: MonitorStatus;
  severity: number;
};

type ConsumerCycleMonitorPayload = {
  asOf: string | null;
  source: string;
  overallStatus: MonitorStatus;
  averageSeverity: number;
  weakeningPrimaryCount: number;
  weakeningTotalCount: number;
  scoreHint: string;
  cyclicalConsumerSeries: ConsumerCycleMonitorSeries[];
  companionSeries: ConsumerCycleMonitorSeries[];
  // Cross-check layer: producer/industrial/freight signals used to test the
  // reindustrialization thesis. Informational — NOT folded into overallStatus
  // (which remains a consumer-demand reading) and NOT consumed by the macro adapter.
  industrialProducerSeries: ConsumerCycleMonitorSeries[];
  statisticalDeviation: StatisticalDeviationPayload | null;
  strongestSeries: ConsumerCycleMonitorSeries | null;
  weakestSeries: ConsumerCycleMonitorSeries | null;
};

type RegressionDeviationPayload = {
  symbol: string;
  anchorDate: string;
  latestDate: string | null;
  latestClose: number | null;
  trendPrice: number | null;
  zScore: number | null;
  percentAboveTrend: number | null;
  residualSigma: number | null;
  trendCagrPct: number | null;
  averageCrashZ: number | null;
  medianCrashZ: number | null;
  positiveCrashAverageZ: number | null;
  stretchedCrashAverageZ: number | null;
  crashEvents: LinearCrashStretchEventPayload[];
  status: MonitorStatus;
};

type LinearCrashStretchEventPayload = {
  name: string;
  date: string;
  zScore: number | null;
};

type LinearCrashStretchPayload = {
  symbol: string;
  anchorDate: string;
  latestDate: string | null;
  latestClose: number | null;
  trendPrice: number | null;
  zScore: number | null;
  residualSigma: number | null;
  averageCrashZ: number | null;
  medianCrashZ: number | null;
  positiveCrashAverageZ: number | null;
  stretchedCrashAverageZ: number | null;
  crashEvents: LinearCrashStretchEventPayload[];
  status: MonitorStatus;
};

type SectorGeometryPayload = {
  windowDays: number;
  latestDate: string | null;
  averageCorrelation: number | null;
  averageCorrelationPercentile: number | null;
  wedgeVolume: number | null;
  wedgeVolumePercentile: number | null;
  status: MonitorStatus;
};

type MarketStretchRowPayload = {
  symbol: string;
  label: string;
  latestDate: string | null;
  latestClose: number | null;
  linearZ: number | null;
  logZ: number | null;
  return21dPct: number | null;
  return63dPct: number | null;
  status: MonitorStatus;
};

type MarketStretchPayload = {
  asOf: string | null;
  maxLinearZ: number | null;
  maxLogZ: number | null;
  extremeCount: number;
  rows: MarketStretchRowPayload[];
  status: MonitorStatus;
};

type LeadershipStretchRowPayload = {
  symbol: string;
  latestClose: number | null;
  rawZ: number | null;
  logZ: number | null;
  return21dPct: number | null;
  return63dPct: number | null;
  valuationGapPct: number | null;
  valuationState: string | null;
};

type LeadershipStretchPayload = {
  asOf: string | null;
  generatedAt: string | null;
  symbolsScanned: number | null;
  rawExtremeCount: number;
  logExtremeCount: number;
  combinedExtremeCount: number;
  overvaluedExtremeCount: number;
  rollingOverCount: number;
  topRows: LeadershipStretchRowPayload[];
  status: MonitorStatus;
  source: string;
};

type StatisticalDeviationPayload = {
  asOf: string | null;
  source: string;
  regime: 'normal' | 'stretched_melt_up' | 'correlation_stress' | 'dangerous_late_cycle' | 'panic_liquidation' | 'unknown';
  status: MonitorStatus;
  summary: string;
  regression: RegressionDeviationPayload | null;
  linearCrashStretch: LinearCrashStretchPayload | null;
  sectorGeometry: SectorGeometryPayload | null;
  marketStretch: MarketStretchPayload | null;
  leadershipStretch: LeadershipStretchPayload | null;
};

const MONITOR_SERIES: ConsumerCycleSeriesDefinition[] = [
  {
    key: 'autos',
    label: 'Motor Vehicles & Parts',
    seriesId: 'DMOTRX1Q020SBEA',
    group: 'cyclical_consumer',
    weight: 2,
    description: 'The clearest finance-sensitive consumer bucket and usually the first place cyclical pressure shows up.',
  },
  {
    key: 'furnishings',
    label: 'Furnishings & Household Equipment',
    seriesId: 'DFDHRX1Q020SBEA',
    group: 'cyclical_consumer',
    weight: 1.5,
    description: 'Big-ticket home purchases that are easy for consumers to delay when confidence softens.',
  },
  {
    key: 'recreation',
    label: 'Recreational Goods & Vehicles',
    seriesId: 'DREQRX1Q020SBEA',
    group: 'cyclical_consumer',
    weight: 1.5,
    description: 'Discretionary durable spending that rolls over before the headline consumer data usually does.',
  },
  {
    key: 'transport_services',
    label: 'Transportation Services',
    seriesId: 'DTRSRX1Q020SBEA',
    group: 'cyclical_consumer',
    weight: 1,
    description: 'A cyclical consumer-service bucket that often weakens with travel and broader discretionary demand.',
  },
  {
    key: 'housing',
    label: 'Residential Investment',
    seriesId: 'PRFIC1',
    group: 'companion',
    weight: 1,
    description: 'Housing is one of the core cycle engines and a key confirmation signal when consumer durables weaken.',
  },
  {
    key: 'equipment',
    label: 'Business Equipment Investment',
    seriesId: 'ND000340Q',
    group: 'companion',
    weight: 1,
    description: 'The business side of the cycle. When equipment softens alongside consumer durables, the warning is stronger.',
  },
];

// Producer / industrial / freight cross-check layer (reindustrialization thesis).
// Mixed frequency: monthly series set periodsPerYear=12, quarterly=4. weight=0
// because these are informational and never enter the consumer severity rollup.
const PRODUCER_SERIES: ConsumerCycleSeriesDefinition[] = [
  {
    key: 'mfg_construction',
    label: 'Manufacturing Construction',
    seriesId: 'TLMFGCONS',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 12,
    description: 'Spending on building new factories — the clearest reindustrialization capex signal.',
  },
  {
    key: 'core_capex_orders',
    label: 'Core Capital Goods Orders',
    seriesId: 'NEWORDER',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 12,
    description: 'New orders for nondefense capital goods ex-aircraft — forward business investment demand.',
  },
  {
    key: 'industrial_production',
    label: 'Industrial Production',
    seriesId: 'INDPRO',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 12,
    description: 'Total real output of factories, mines, and utilities — the domestic production engine.',
  },
  {
    key: 'manufacturing_output',
    label: 'Manufacturing Output',
    seriesId: 'IPMAN',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 12,
    description: 'Factory-only industrial production.',
  },
  {
    key: 'freight_shipments',
    label: 'Cass Freight Shipments',
    seriesId: 'FRGSHPUSM649NCIS',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 12,
    description: 'Volume of goods moving across the freight network — the demand-for-transport signal.',
  },
  {
    key: 'real_imports',
    label: 'Real Imports of Goods & Services',
    seriesId: 'IMPGSC1',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 4,
    description: 'Import-led vs domestic-led test: if production is leading, imports should be flat/soft while production rises.',
  },
  {
    key: 'productivity',
    label: 'Nonfarm Productivity (Output/Hour)',
    seriesId: 'OPHNFB',
    group: 'industrial_producer',
    weight: 0,
    periodsPerYear: 4,
    description: 'Output per hour — the AI productivity-inflection leg of the thesis.',
  },
];

let monitorCache: { expiresAt: number; payload: ConsumerCycleMonitorPayload } | null = null;

type ConsumerCycleRow = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  optionable: boolean | null;
  sector: string | null;
  industry: string | null;
  consumerCycleBucket: ConsumerCycleBucket;
  consumerDemandBucket: ConsumerDemandBucket | null;
  consumerSpendClass: ConsumerSpendClass | null;
  consumerSpendingCategory: ConsumerSpendingCategory | null;
  consumerCycleSensitivity: ConsumerCycleSensitivity | null;
  recessionProfile: RecessionProfile | null;
  macroRegimePreference: MacroRegimePreference | null;
  classificationSource: string | null;
  classificationConfidence: number | null;
};

export type ConsumerCycleFilters = {
  q?: string;
  cycleBucket?: ConsumerCycleBucket | '';
  spendClass?: ConsumerSpendClass | '';
  category?: ConsumerSpendingCategory | '';
  bucket?: ConsumerDemandBucket | '';
  sensitivity?: ConsumerCycleSensitivity | '';
  profile?: RecessionProfile | '';
  preference?: MacroRegimePreference | '';
  optionableOnly?: boolean;
  limit?: number;
};

function trimText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function openCatalog(): DatabaseSync | null {
  if (!fs.existsSync(SYMBOL_CATALOG_DB_PATH)) return null;
  try {
    return new DatabaseSync(SYMBOL_CATALOG_DB_PATH, { readOnly: true });
  } catch {
    return null;
  }
}

function normalizeRow(row: Record<string, unknown>): ConsumerCycleRow {
  const inferred = classifyCompanyFromSnapshot({
    name: row.name,
    sec_name: row.sec_name,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
  });
  const storedSource = trimText(row.classification_source);
  const storedConfidence = toFiniteNumber(row.classification_confidence);
  const hasStoredConsumerTaxonomy = Boolean(
    trimText(row.consumer_cycle_bucket) ||
    trimText(row.consumer_demand_bucket) ||
    trimText(row.consumer_spend_class) ||
    trimText(row.consumer_spending_category) ||
    trimText(row.consumer_cycle_sensitivity) ||
    trimText(row.recession_profile) ||
    trimText(row.macro_regime_preference)
  );
  const shouldPreferInferredConsumerTaxonomy =
    !hasStoredConsumerTaxonomy ||
    (
      trimText(row.consumer_spending_category) === 'non_consumer' &&
      inferred?.consumerSpendingCategory != null &&
      inferred.consumerSpendingCategory !== 'non_consumer'
    );

  const consumerDemandBucket = shouldPreferInferredConsumerTaxonomy
    ? (inferred?.consumerDemandBucket || (trimText(row.consumer_demand_bucket) as ConsumerDemandBucket | null) || null)
    : ((trimText(row.consumer_demand_bucket) as ConsumerDemandBucket | null) || inferred?.consumerDemandBucket || null);
  const consumerSpendClass = shouldPreferInferredConsumerTaxonomy
    ? (inferred?.consumerSpendClass || (trimText(row.consumer_spend_class) as ConsumerSpendClass | null) || null)
    : ((trimText(row.consumer_spend_class) as ConsumerSpendClass | null) || inferred?.consumerSpendClass || null);
  const consumerSpendingCategory = shouldPreferInferredConsumerTaxonomy
    ? (inferred?.consumerSpendingCategory || (trimText(row.consumer_spending_category) as ConsumerSpendingCategory | null) || null)
    : ((trimText(row.consumer_spending_category) as ConsumerSpendingCategory | null) || inferred?.consumerSpendingCategory || null);
  const consumerCycleSensitivity = shouldPreferInferredConsumerTaxonomy
    ? (inferred?.consumerCycleSensitivity || (trimText(row.consumer_cycle_sensitivity) as ConsumerCycleSensitivity | null) || null)
    : ((trimText(row.consumer_cycle_sensitivity) as ConsumerCycleSensitivity | null) || inferred?.consumerCycleSensitivity || null);
  const storedCycleBucket = trimText(row.consumer_cycle_bucket) as ConsumerCycleBucket | null;
  const consumerCycleBucket =
    storedCycleBucket ||
    inferred?.consumerCycleBucket ||
    (
      consumerSpendingCategory && [
        'motor_vehicles_parts',
        'furnishings_household_equipment',
        'recreational_goods_vehicles',
        'other_durable_goods',
        'transportation_services',
        'residential_investment',
        'business_equipment_investment',
      ].includes(consumerSpendingCategory)
        ? 'highly_cyclical'
        : consumerSpendingCategory && [
            'clothing_footwear',
            'gas_energy_goods',
            'food_service_accommodations',
            'other_services',
            'mixed_consumer',
          ].includes(consumerSpendingCategory)
          ? 'mildly_cyclical'
          : 'stable'
    );

  return {
    symbol: String(row.symbol || '').trim().toUpperCase(),
    name: trimText(row.name) || trimText(row.sec_name),
    exchange: trimText(row.exchange) || trimText(row.sec_exchange),
    optionable: row.optionable == null ? null : Boolean(row.optionable),
    sector: trimText(row.sector),
    industry: trimText(row.industry),
    consumerCycleBucket,
    consumerDemandBucket,
    consumerSpendClass,
    consumerSpendingCategory,
    consumerCycleSensitivity,
    recessionProfile: (trimText(row.recession_profile) as RecessionProfile | null) || inferred?.recessionProfile || null,
    macroRegimePreference: (trimText(row.macro_regime_preference) as MacroRegimePreference | null) || inferred?.macroRegimePreference || null,
    classificationSource: !shouldPreferInferredConsumerTaxonomy && hasStoredConsumerTaxonomy ? (storedSource || 'catalog') : 'inferred_from_identity',
    classificationConfidence: !shouldPreferInferredConsumerTaxonomy && hasStoredConsumerTaxonomy
      ? storedConfidence
      : (inferred?.consumerClassificationConfidence ?? inferred?.classificationConfidence ?? null),
  };
}

function loadTradableStockRows(): ConsumerCycleRow[] {
  const db = openCatalog();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT
        s.symbol,
        s.name,
        s.sec_name,
        s.exchange,
        s.sec_exchange,
        s.optionable,
        s.sector,
        s.industry,
        s.classification_source,
        s.classification_confidence,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_cycle_bucket' LIMIT 1) AS consumer_cycle_bucket,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_demand_bucket' LIMIT 1) AS consumer_demand_bucket,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_spend_class' LIMIT 1) AS consumer_spend_class,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_spending_category' LIMIT 1) AS consumer_spending_category,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'consumer_cycle_sensitivity' LIMIT 1) AS consumer_cycle_sensitivity,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'recession_profile' LIMIT 1) AS recession_profile,
        (SELECT membership_value FROM symbol_memberships WHERE symbol = s.symbol AND membership_type = 'macro_regime_preference' LIMIT 1) AS macro_regime_preference
      FROM symbols s
      JOIN symbol_memberships eligibility
        ON eligibility.symbol = s.symbol
       AND eligibility.membership_type = 'eligibility'
       AND eligibility.membership_value = 'tradable_stock_default'
      WHERE COALESCE(s.asset_class, 'stocks') = 'stocks'
      ORDER BY s.symbol ASC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(normalizeRow);
  } finally {
    try { db.close(); } catch {}
  }
}

function applyFilters(rows: ConsumerCycleRow[], filters: ConsumerCycleFilters): ConsumerCycleRow[] {
  const query = String(filters.q || '').trim().toLowerCase();
  const cycleBucket = String(filters.cycleBucket || '').trim();
  const spendClass = String(filters.spendClass || '').trim();
  const category = String(filters.category || '').trim();
  const bucket = String(filters.bucket || '').trim();
  const sensitivity = String(filters.sensitivity || '').trim();
  const profile = String(filters.profile || '').trim();
  const preference = String(filters.preference || '').trim();
  const optionableOnly = Boolean(filters.optionableOnly);

  return rows.filter((row) => {
    if (optionableOnly && !row.optionable) return false;
    if (cycleBucket && row.consumerCycleBucket !== cycleBucket) return false;
    if (spendClass && row.consumerSpendClass !== spendClass) return false;
    if (category && row.consumerSpendingCategory !== category) return false;
    if (bucket && row.consumerDemandBucket !== bucket) return false;
    if (sensitivity && row.consumerCycleSensitivity !== sensitivity) return false;
    if (profile && row.recessionProfile !== profile) return false;
    if (preference && row.macroRegimePreference !== preference) return false;
    if (!query) return true;

    const haystack = [
      row.symbol,
      row.name,
      row.exchange,
      row.sector,
      row.industry,
      row.consumerCycleBucket,
      row.consumerSpendClass,
      row.consumerSpendingCategory,
      row.consumerDemandBucket,
      row.consumerCycleSensitivity,
      row.recessionProfile,
      row.macroRegimePreference,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function countBy<T extends string>(rows: ConsumerCycleRow[], selector: (row: ConsumerCycleRow) => T | null): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const key = selector(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function round(value: number | null, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentileRank(values: number[], value: number): number | null {
  const finite = values.filter((item) => Number.isFinite(item));
  if (!finite.length || !Number.isFinite(value)) return null;
  return (finite.filter((item) => item <= value).length / finite.length) * 100;
}

function determinant(matrix: number[][]): number {
  const n = matrix.length;
  const work = matrix.map((row) => row.slice());
  let det = 1;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(work[row][col]) > Math.abs(work[pivot][col])) pivot = row;
    }
    if (Math.abs(work[pivot][col]) < 1e-12) return 0;
    if (pivot !== col) {
      [work[pivot], work[col]] = [work[col], work[pivot]];
      det *= -1;
    }
    const pivotValue = work[col][col];
    det *= pivotValue;
    for (let row = col + 1; row < n; row += 1) {
      const factor = work[row][col] / pivotValue;
      for (let inner = col; inner < n; inner += 1) {
        work[row][inner] -= factor * work[col][inner];
      }
    }
  }
  return det;
}

function correlationMatrix(rows: number[][]): number[][] | null {
  if (rows.length < 3 || !rows[0]?.length) return null;
  const columns = rows[0].length;
  const columnValues = Array.from({ length: columns }, (_, col) => rows.map((row) => row[col]));
  const means = columnValues.map(mean);
  const variances = columnValues.map((values, col) => {
    const avg = means[col];
    return values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / Math.max(1, values.length - 1);
  });
  if (variances.some((value) => value <= 0 || !Number.isFinite(value))) return null;

  return Array.from({ length: columns }, (_, i) => (
    Array.from({ length: columns }, (_, j) => {
      if (i === j) return 1;
      const avgI = means[i];
      const avgJ = means[j];
      const covariance = rows.reduce((sum, row) => sum + ((row[i] - avgI) * (row[j] - avgJ)), 0) / Math.max(1, rows.length - 1);
      return covariance / Math.sqrt(variances[i] * variances[j]);
    })
  ));
}

function averageOffDiagonal(matrix: number[][]): number | null {
  const values: number[] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = row + 1; col < matrix.length; col += 1) {
      values.push(matrix[row][col]);
    }
  }
  return values.length ? mean(values) : null;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current / previous) - 1) * 100;
}

function annualizeQuarterlyChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous <= 0 || current <= 0) return null;
  return ((current / previous) ** 4 - 1) * 100;
}

function annualizeChange(current: number | null, previous: number | null, periodsPerYear: number): number | null {
  if (current == null || previous == null || previous <= 0 || current <= 0) return null;
  return ((current / previous) ** periodsPerYear - 1) * 100;
}

function scoreSeries(yoyPct: number | null, qoqAnnualizedPct: number | null): { status: MonitorStatus; severity: number } {
  if (yoyPct == null && qoqAnnualizedPct == null) return { status: 'yellow', severity: 1 };
  if ((yoyPct != null && yoyPct < -4) || (qoqAnnualizedPct != null && qoqAnnualizedPct < -8)) {
    return { status: 'red', severity: 3 };
  }
  if ((yoyPct != null && yoyPct < 0) || (qoqAnnualizedPct != null && qoqAnnualizedPct < 0)) {
    return { status: 'orange', severity: 2 };
  }
  if ((yoyPct != null && yoyPct < 2) || (qoqAnnualizedPct != null && qoqAnnualizedPct < 2)) {
    return { status: 'yellow', severity: 1 };
  }
  return { status: 'green', severity: 0 };
}

async function fetchFredSeries(definition: ConsumerCycleSeriesDefinition): Promise<ConsumerCyclePoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(definition.seriesId)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'pattern-detector/consumer-cycle-monitor',
      'accept': 'text/csv,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`FRED request failed for ${definition.seriesId}: ${response.status}`);
  }
  const csv = await response.text();
  const lines = csv.trim().split(/\r?\n/);
  const points: ConsumerCyclePoint[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const [dateRaw, valueRaw] = line.split(',', 2);
    const date = String(dateRaw || '').trim();
    const valueText = String(valueRaw || '').trim();
    const value = Number(valueText);
    if (!date || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  return points;
}

function buildMonitorSeries(definition: ConsumerCycleSeriesDefinition, points: ConsumerCyclePoint[]): ConsumerCycleMonitorSeries {
  const latest = points.at(-1) || null;
  const prevQuarter = points.length >= 2 ? points[points.length - 2] : null;
  const prevYear = points.length >= 5 ? points[points.length - 5] : null;
  const twoQuarterBack = points.length >= 3 ? points[points.length - 3] : null;
  const yoyPct = round(pctChange(latest?.value ?? null, prevYear?.value ?? null));
  const qoqAnnualizedPct = round(annualizeQuarterlyChange(latest?.value ?? null, prevQuarter?.value ?? null));
  const twoQuarterPct = round(pctChange(latest?.value ?? null, twoQuarterBack?.value ?? null));
  const score = scoreSeries(yoyPct, qoqAnnualizedPct);

  return {
    key: definition.key,
    label: definition.label,
    seriesId: definition.seriesId,
    group: definition.group,
    description: definition.description,
    latestDate: latest?.date || null,
    latestValue: latest?.value ?? null,
    yoyPct,
    qoqAnnualizedPct,
    twoQuarterPct,
    status: score.status,
    severity: score.severity,
  };
}

async function fetchDailyCloses(symbol: string): Promise<ConsumerCyclePoint[]> {
  return fetchMarketCloses(symbol, '2y');
}

async function fetchMarketCloses(symbol: string, period: string, forceRefresh = false): Promise<ConsumerCyclePoint[]> {
  const res = await fetch(`${PY_SERVICE_BASE_URL}/chart/ohlcv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, interval: '1d', period, force_refresh: forceRefresh }),
  });
  if (!res.ok) throw new Error(`OHLCV fetch failed for ${symbol}: ${res.status}`);
  const json = await res.json();
  const normalized = normalizeChartOhlcvPayload(json, symbol, '1d');
  return normalized.chart_data
    .map((bar: any) => ({ date: String(bar.time), value: Number(bar.close) }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
}

function buildLogFit(points: ConsumerCyclePoint[]): {
  latestDate: string;
  latestClose: number;
  trendPrice: number;
  zScore: number;
  percentAboveTrend: number;
  residualSigma: number;
  trendCagrPct: number;
} | null {
  if (points.length < 252) return null;
  const y = points.map((point) => Math.log(point.value));
  const x = points.map((_, index) => index);
  const xMean = mean(x);
  const yMean = mean(y);
  const varianceX = x.reduce((sum, value) => sum + ((value - xMean) ** 2), 0);
  if (varianceX <= 0) return null;
  const covarianceXY = x.reduce((sum, value, index) => sum + ((value - xMean) * (y[index] - yMean)), 0);
  const slope = covarianceXY / varianceX;
  const intercept = yMean - (slope * xMean);
  const fitted = x.map((value) => intercept + (slope * value));
  const residuals = y.map((value, index) => value - fitted[index]);
  const sigma = Math.sqrt(residuals.reduce((sum, value) => sum + (value ** 2), 0) / Math.max(1, residuals.length - 2));
  if (!Number.isFinite(sigma) || sigma <= 0) return null;

  const latest = points[points.length - 1];
  const latestTrend = Math.exp(fitted[fitted.length - 1]);
  const zScore = residuals[residuals.length - 1] / sigma;
  return {
    latestDate: latest.date,
    latestClose: latest.value,
    trendPrice: latestTrend,
    zScore,
    percentAboveTrend: ((latest.value / latestTrend) - 1) * 100,
    residualSigma: sigma,
    trendCagrPct: (Math.exp(slope * 252) - 1) * 100,
  };
}

function crashZSummary(crashEvents: LinearCrashStretchEventPayload[]): {
  averageCrashZ: number | null;
  medianCrashZ: number | null;
  positiveCrashAverageZ: number | null;
  stretchedCrashAverageZ: number | null;
} {
  const crashZScores = crashEvents
    .map((event) => event.zScore)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const positiveCrashZScores = crashZScores.filter((value) => value > 0);
  const stretchedCrashZScores = crashZScores.filter((value) => value >= 1);
  const sortedCrashZScores = [...crashZScores].sort((a, b) => a - b);
  const medianCrashZ = sortedCrashZScores.length
    ? sortedCrashZScores[Math.floor(sortedCrashZScores.length / 2)]
    : null;
  return {
    averageCrashZ: crashZScores.length ? round(mean(crashZScores), 2) : null,
    medianCrashZ: medianCrashZ == null ? null : round(medianCrashZ, 2),
    positiveCrashAverageZ: positiveCrashZScores.length ? round(mean(positiveCrashZScores), 2) : null,
    stretchedCrashAverageZ: stretchedCrashZScores.length ? round(mean(stretchedCrashZScores), 2) : null,
  };
}

function buildRegressionDeviation(points: ConsumerCyclePoint[]): RegressionDeviationPayload | null {
  const filtered = points
    .filter((point) => point.date >= STATISTICAL_INDEX_ANCHOR_DATE && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (filtered.length < 252) return null;

  const current = buildLogFit(filtered);
  if (!current) return null;
  const crashEvents = LINEAR_CRASH_STRETCH_EVENTS.map((event) => {
    const eventPoints = filtered.filter((point) => point.date <= event.date);
    const fit = buildLogFit(eventPoints);
    return {
      name: event.name,
      date: event.date,
      zScore: fit ? round(fit.zScore, 2) : null,
    };
  });
  const summary = crashZSummary(crashEvents);
  let status: MonitorStatus = 'green';
  if (current.zScore >= 2.25) status = 'red';
  else if (current.zScore >= 1.5) status = 'orange';
  else if (current.zScore >= 1) status = 'yellow';

  return {
    symbol: STATISTICAL_INDEX_SYMBOL,
    anchorDate: STATISTICAL_INDEX_ANCHOR_DATE,
    latestDate: current.latestDate,
    latestClose: round(current.latestClose, 2),
    trendPrice: round(current.trendPrice, 2),
    zScore: round(current.zScore, 2),
    percentAboveTrend: round(current.percentAboveTrend, 1),
    residualSigma: round(current.residualSigma, 4),
    trendCagrPct: round(current.trendCagrPct, 2),
    ...summary,
    crashEvents,
    status,
  };
}

function buildLinearFit(points: ConsumerCyclePoint[]): {
  latestDate: string;
  latestClose: number;
  trendPrice: number;
  zScore: number;
  residualSigma: number;
} | null {
  if (points.length < 252) return null;
  const y = points.map((point) => point.value);
  const x = points.map((_, index) => index);
  const xMean = mean(x);
  const yMean = mean(y);
  const varianceX = x.reduce((sum, value) => sum + ((value - xMean) ** 2), 0);
  if (varianceX <= 0) return null;
  const covarianceXY = x.reduce((sum, value, index) => sum + ((value - xMean) * (y[index] - yMean)), 0);
  const slope = covarianceXY / varianceX;
  const intercept = yMean - (slope * xMean);
  const fitted = x.map((value) => intercept + (slope * value));
  const residuals = y.map((value, index) => value - fitted[index]);
  const sigma = Math.sqrt(residuals.reduce((sum, value) => sum + (value ** 2), 0) / Math.max(1, residuals.length - 2));
  if (!Number.isFinite(sigma) || sigma <= 0) return null;

  const latest = points[points.length - 1];
  const trendPrice = fitted[fitted.length - 1];
  const zScore = residuals[residuals.length - 1] / sigma;
  return {
    latestDate: latest.date,
    latestClose: latest.value,
    trendPrice,
    zScore,
    residualSigma: sigma,
  };
}

function buildLinearCrashStretch(points: ConsumerCyclePoint[]): LinearCrashStretchPayload | null {
  const filtered = points
    .filter((point) => point.date >= STATISTICAL_INDEX_ANCHOR_DATE && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (filtered.length < 252) return null;

  const current = buildLinearFit(filtered);
  if (!current) return null;

  const crashEvents = LINEAR_CRASH_STRETCH_EVENTS.map((event) => {
    const eventPoints = filtered.filter((point) => point.date <= event.date);
    const fit = buildLinearFit(eventPoints);
    return {
      name: event.name,
      date: event.date,
      zScore: fit ? round(fit.zScore, 2) : null,
    };
  });
  const summary = crashZSummary(crashEvents);

  let status: MonitorStatus = 'green';
  if (current.zScore >= 4) status = 'red';
  else if (current.zScore >= 3) status = 'orange';
  else if (current.zScore >= 2) status = 'yellow';

  return {
    symbol: STATISTICAL_INDEX_SYMBOL,
    anchorDate: STATISTICAL_INDEX_ANCHOR_DATE,
    latestDate: current.latestDate,
    latestClose: round(current.latestClose, 2),
    trendPrice: round(current.trendPrice, 2),
    zScore: round(current.zScore, 2),
    residualSigma: round(current.residualSigma, 2),
    ...summary,
    crashEvents,
    status,
  };
}

function returnOverLookback(points: ConsumerCyclePoint[], lookback: number): number | null {
  if (points.length <= lookback) return null;
  const latest = points[points.length - 1]?.value;
  const prior = points[points.length - 1 - lookback]?.value;
  return pctChange(latest ?? null, prior ?? null);
}

function statusFromLinearZ(value: number | null): MonitorStatus {
  if (value != null && value >= 4) return 'red';
  if (value != null && value >= 3) return 'orange';
  if (value != null && value >= 2) return 'yellow';
  return 'green';
}

async function buildMarketStretch(): Promise<MarketStretchPayload | null> {
  const results = await Promise.allSettled(
    STATISTICAL_MARKET_STRETCH_SYMBOLS.map(async (definition) => {
      const points = await fetchMarketCloses(definition.symbol, 'max', true);
      const filtered = points
        .filter((point) => point.date >= STATISTICAL_INDEX_ANCHOR_DATE && Number.isFinite(point.value) && point.value > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const linear = buildLinearFit(filtered);
      const log = buildLogFit(filtered);
      const linearZ = linear ? round(linear.zScore, 2) : null;
      return {
        symbol: definition.symbol,
        label: definition.label,
        latestDate: linear?.latestDate || log?.latestDate || null,
        latestClose: linear ? round(linear.latestClose, 2) : (log ? round(log.latestClose, 2) : null),
        linearZ,
        logZ: log ? round(log.zScore, 2) : null,
        return21dPct: round(returnOverLookback(filtered, 21)),
        return63dPct: round(returnOverLookback(filtered, 63)),
        status: statusFromLinearZ(linearZ),
      };
    })
  );

  const rows = results
    .filter((result): result is PromiseFulfilledResult<MarketStretchRowPayload> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((row) => row.linearZ != null || row.logZ != null);
  if (!rows.length) return null;

  const maxLinearZ = rows.reduce<number | null>((maxValue, row) => (
    row.linearZ == null ? maxValue : (maxValue == null ? row.linearZ : Math.max(maxValue, row.linearZ))
  ), null);
  const maxLogZ = rows.reduce<number | null>((maxValue, row) => (
    row.logZ == null ? maxValue : (maxValue == null ? row.logZ : Math.max(maxValue, row.logZ))
  ), null);
  const extremeCount = rows.filter((row) => row.linearZ != null && row.linearZ >= 4).length;
  let status: MonitorStatus = 'green';
  if (extremeCount >= 3 || (maxLinearZ != null && maxLinearZ >= 6)) status = 'red';
  else if (extremeCount >= 1 || (maxLinearZ != null && maxLinearZ >= 4)) status = 'orange';
  else if (maxLinearZ != null && maxLinearZ >= 3) status = 'yellow';

  return {
    asOf: rows.map((row) => row.latestDate).filter(Boolean).sort().at(-1) || null,
    maxLinearZ: maxLinearZ == null ? null : round(maxLinearZ, 2),
    maxLogZ: maxLogZ == null ? null : round(maxLogZ, 2),
    extremeCount,
    rows,
    status,
  };
}

function readJsonFile(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function safeUniverseSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase().replace(/[\/=-]/g, '_');
}

function loadLocalDailyCloses(symbol: string): ConsumerCyclePoint[] {
  const filePath = path.join(DATA_DIR, 'universe', `${safeUniverseSymbol(symbol)}_1d.csv`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    const header = (lines.shift() || '').split(',').map((part) => part.trim().toLowerCase());
    const dateIndex = header.indexOf('date');
    const closeIndex = header.indexOf('close');
    if (dateIndex < 0 || closeIndex < 0) return [];
    return lines
      .map((line) => {
        const parts = line.split(',');
        return { date: String(parts[dateIndex] || '').slice(0, 10), value: Number(parts[closeIndex]) };
      })
      .filter((point) => point.date && Number.isFinite(point.value) && point.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function latestScanRows(payload: any): any[] {
  return Array.isArray(payload?.results) ? payload.results : [];
}

function buildLeadershipStretch(): LeadershipStretchPayload | null {
  const rawScan = readJsonFile(EXTREME_DEVIATION_RAW_SCAN_PATH);
  const logScan = readJsonFile(EXTREME_DEVIATION_LOG_SCAN_PATH);
  const rawRows = latestScanRows(rawScan);
  const logRows = latestScanRows(logScan);
  if (!rawRows.length && !logRows.length) return null;

  const bySymbol = new Map<string, any>();
  [...rawRows, ...logRows].forEach((row) => {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (!symbol) return;
    const existing = bySymbol.get(symbol) || {};
    bySymbol.set(symbol, { ...existing, ...row });
  });

  const topRows: LeadershipStretchRowPayload[] = Array.from(bySymbol.values())
    .map((row) => {
      const points = loadLocalDailyCloses(String(row.symbol || ''));
      return {
        symbol: String(row.symbol || '').toUpperCase(),
        latestClose: row.latest_close != null ? round(Number(row.latest_close), 2) : null,
        rawZ: row.raw_z != null ? round(Number(row.raw_z), 2) : null,
        logZ: row.log_z != null ? round(Number(row.log_z), 2) : null,
        return21dPct: round(returnOverLookback(points, 21)),
        return63dPct: round(returnOverLookback(points, 63)),
        valuationGapPct: row.current_gap_to_fair_value_pct != null
          ? round(Number(row.current_gap_to_fair_value_pct), 1)
          : (row.valuation_gap_pct != null ? round(Number(row.valuation_gap_pct), 1) : null),
        valuationState: row.valuation_state ? String(row.valuation_state) : null,
      };
    })
    .sort((a, b) => Math.max(b.rawZ || -Infinity, b.logZ || -Infinity) - Math.max(a.rawZ || -Infinity, a.logZ || -Infinity))
    .slice(0, 20);

  const rawExtremeCount = Number(rawScan?.summary?.matches ?? rawRows.length);
  const logExtremeCount = Number(logScan?.summary?.matches ?? logRows.length);
  const overvaluedExtremeCount = topRows.filter((row) => row.valuationGapPct != null && row.valuationGapPct <= -20).length;
  const rollingOverCount = topRows.filter((row) => row.return21dPct != null && row.return21dPct < 0).length;
  const generatedAt = [rawScan?.summary?.generated_at, logScan?.summary?.generated_at].filter(Boolean).sort().at(-1) || null;
  const symbolsScanned = Math.max(Number(rawScan?.summary?.symbols_scanned || 0), Number(logScan?.summary?.symbols_scanned || 0)) || null;
  let status: MonitorStatus = 'green';
  if (rawExtremeCount >= 20 || rollingOverCount >= 8) status = 'red';
  else if (rawExtremeCount >= 10 || rollingOverCount >= 4) status = 'orange';
  else if (rawExtremeCount >= 5 || logExtremeCount >= 5) status = 'yellow';

  return {
    asOf: topRows.map((row) => {
      const source = [...rawRows, ...logRows].find((item) => String(item?.symbol || '').toUpperCase() === row.symbol);
      return source?.history_end || null;
    }).filter(Boolean).sort().at(-1) || null,
    generatedAt,
    symbolsScanned,
    rawExtremeCount,
    logExtremeCount,
    combinedExtremeCount: bySymbol.size,
    overvaluedExtremeCount,
    rollingOverCount,
    topRows,
    status,
    source: 'Precomputed full-history stock deviation scans: raw>=6 sigma and log>=5 sigma.',
  };
}

function buildSectorGeometry(pointSets: ConsumerCyclePoint[][]): SectorGeometryPayload | null {
  if (pointSets.length < 8) return null;
  const maps = pointSets.map((points) => new Map(points.map((point) => [point.date, point.value])));
  const commonDates = Array.from(maps[0].keys())
    .filter((date) => maps.every((map) => map.has(date)))
    .sort();
  if (commonDates.length < STATISTICAL_CORRELATION_WINDOW + 2) return null;

  const returnRows: Array<{ date: string; values: number[] }> = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    const prevDate = commonDates[index - 1];
    const date = commonDates[index];
    const values = maps.map((map) => {
      const current = map.get(date) || 0;
      const previous = map.get(prevDate) || 0;
      return current > 0 && previous > 0 ? Math.log(current / previous) : NaN;
    });
    if (values.every((value) => Number.isFinite(value))) {
      returnRows.push({ date, values });
    }
  }
  if (returnRows.length < STATISTICAL_CORRELATION_WINDOW) return null;

  const volumes: number[] = [];
  const averageCorrelations: number[] = [];
  const dates: string[] = [];
  for (let index = STATISTICAL_CORRELATION_WINDOW; index <= returnRows.length; index += 1) {
    const windowRows = returnRows.slice(index - STATISTICAL_CORRELATION_WINDOW, index).map((row) => row.values);
    const corr = correlationMatrix(windowRows);
    if (!corr) continue;
    const avgCorr = averageOffDiagonal(corr);
    if (avgCorr == null) continue;
    const det = Math.max(0, determinant(corr));
    averageCorrelations.push(avgCorr);
    volumes.push(Math.sqrt(det));
    dates.push(returnRows[index - 1].date);
  }
  if (!dates.length) return null;

  const latestVolume = volumes[volumes.length - 1];
  const latestAverageCorrelation = averageCorrelations[averageCorrelations.length - 1];
  const wedgeVolumePercentile = percentileRank(volumes, latestVolume);
  const averageCorrelationPercentile = percentileRank(averageCorrelations, latestAverageCorrelation);
  let status: MonitorStatus = 'green';
  if ((wedgeVolumePercentile != null && wedgeVolumePercentile <= 10) || (averageCorrelationPercentile != null && averageCorrelationPercentile >= 90)) {
    status = 'red';
  } else if ((wedgeVolumePercentile != null && wedgeVolumePercentile <= 25) || (averageCorrelationPercentile != null && averageCorrelationPercentile >= 75)) {
    status = 'orange';
  } else if ((wedgeVolumePercentile != null && wedgeVolumePercentile <= 40) || (averageCorrelationPercentile != null && averageCorrelationPercentile >= 60)) {
    status = 'yellow';
  }

  return {
    windowDays: STATISTICAL_CORRELATION_WINDOW,
    latestDate: dates[dates.length - 1],
    averageCorrelation: round(latestAverageCorrelation, 3),
    averageCorrelationPercentile: round(averageCorrelationPercentile, 1),
    wedgeVolume: round(latestVolume, 6),
    wedgeVolumePercentile: round(wedgeVolumePercentile, 1),
    status,
  };
}

function classifyStatisticalDeviation(
  regression: RegressionDeviationPayload | null,
  linearCrashStretch: LinearCrashStretchPayload | null,
  sectorGeometry: SectorGeometryPayload | null,
  marketStretch: MarketStretchPayload | null,
  leadershipStretch: LeadershipStretchPayload | null
): Pick<StatisticalDeviationPayload, 'regime' | 'status' | 'summary'> {
  const z = regression?.zScore;
  const linearZ = linearCrashStretch?.zScore;
  const volumePct = sectorGeometry?.wedgeVolumePercentile;
  const corrPct = sectorGeometry?.averageCorrelationPercentile;
  const stretched = z != null && z >= 1.5;
  const linearExtreme = linearZ != null && linearZ >= 4;
  const crossMarketExtreme = (marketStretch?.extremeCount || 0) >= 3;
  const leadershipExtreme = (leadershipStretch?.combinedExtremeCount || 0) >= 10;
  const leadershipRolling = (leadershipStretch?.rollingOverCount || 0) >= 4;
  const deeplyBelow = z != null && z <= -1.5;
  const geometryStressed = (volumePct != null && volumePct <= 25) || (corrPct != null && corrPct >= 75);

  if ((linearExtreme || crossMarketExtreme) && leadershipExtreme && leadershipRolling) {
    return {
      regime: 'dangerous_late_cycle',
      status: 'red',
      summary: 'Index stretch, cross-market stretch, and a rolling-over extreme stock basket are aligned. That is the highest-risk version of the statistical deviation setup.',
    };
  }
  if ((stretched || linearExtreme) && geometryStressed) {
    return {
      regime: 'dangerous_late_cycle',
      status: 'red',
      summary: 'Index stretch is elevated and sector geometry is compressing. That is the dangerous overlap: rich market plus weakening diversification.',
    };
  }
  if (deeplyBelow && geometryStressed) {
    return {
      regime: 'panic_liquidation',
      status: 'red',
      summary: 'The index is below its long-run channel while sector geometry is compressed. This reads more like liquidation/panic than a normal slowdown.',
    };
  }
  if (geometryStressed) {
    return {
      regime: 'correlation_stress',
      status: sectorGeometry?.status || 'orange',
      summary: 'Sector correlations are elevated or wedge volume is compressed. Diversification is weakening even if index stretch is not extreme.',
    };
  }
  if (stretched) {
    return {
      regime: 'stretched_melt_up',
      status: linearExtreme ? 'red' : (regression?.status || 'orange'),
      summary: 'The index is stretched above its 1987-anchored regression channel, but sector geometry remains open. This is more melt-up fragility than confirmed crash behavior.',
    };
  }
  if (linearExtreme || crossMarketExtreme || leadershipExtreme) {
    return {
      regime: 'stretched_melt_up',
      status: linearExtreme || crossMarketExtreme ? (linearCrashStretch?.status || marketStretch?.status || 'orange') : (leadershipStretch?.status || 'orange'),
      summary: 'Market or leadership stretch is historically elevated, but rollover and sector-geometry confirmation are incomplete. This is melt-up fragility, not confirmed crash behavior.',
    };
  }
  return {
    regime: 'normal',
    status: 'green',
    summary: 'No combined statistical stress signal. Index stretch and sector geometry are not aligned into a crash-like regime.',
  };
}

async function buildStatisticalDeviation(): Promise<StatisticalDeviationPayload | null> {
  try {
    const [indexPoints, ...sectorPointSets] = await Promise.all([
      fetchMarketCloses(STATISTICAL_INDEX_SYMBOL, 'max', true),
      ...STATISTICAL_SECTOR_SYMBOLS.map((symbol) => fetchMarketCloses(symbol, '10y', true)),
    ]);
    const regression = buildRegressionDeviation(indexPoints);
    const linearCrashStretch = buildLinearCrashStretch(indexPoints);
    const sectorGeometry = buildSectorGeometry(sectorPointSets);
    const [marketStretch, leadershipStretch] = await Promise.all([
      buildMarketStretch().catch(() => null),
      Promise.resolve().then(() => buildLeadershipStretch()).catch(() => null),
    ]);
    const classification = classifyStatisticalDeviation(regression, linearCrashStretch, sectorGeometry, marketStretch, leadershipStretch);
    const asOf = [
      regression?.latestDate || null,
      linearCrashStretch?.latestDate || null,
      sectorGeometry?.latestDate || null,
      marketStretch?.asOf || null,
      leadershipStretch?.asOf || null,
    ]
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    return {
      asOf,
      source: 'S&P 500 1987-anchored log regression + linear crash-stretch channel + cross-market raw stretch + precomputed extreme stock basket + 60-day S&P sector ETF correlation geometry',
      ...classification,
      regression,
      linearCrashStretch,
      sectorGeometry,
      marketStretch,
      leadershipStretch,
    };
  } catch {
    return null;
  }
}

function pctOverLookback(points: ConsumerCyclePoint[], lookback: number): number | null {
  if (points.length <= lookback) return null;
  return pctChange(points[points.length - 1].value, points[points.length - 1 - lookback].value);
}

// Builds the transports relative-strength series (IYT/SPY). Status reflects
// whether the market is pricing transports LEADING (outperforming) or lagging.
async function buildTransportsSeries(): Promise<ConsumerCycleMonitorSeries | null> {
  let transports: ConsumerCyclePoint[];
  let benchmark: ConsumerCyclePoint[];
  try {
    [transports, benchmark] = await Promise.all([
      fetchDailyCloses(TRANSPORTS_SYMBOL),
      fetchDailyCloses(TRANSPORTS_BENCHMARK),
    ]);
  } catch {
    return null;
  }
  if (transports.length < 70 || benchmark.length < 70) return null;

  const benchmarkByDate = new Map(benchmark.map((point) => [point.date, point.value]));
  const relativeStrength: ConsumerCyclePoint[] = [];
  for (const point of transports) {
    const benchmarkValue = benchmarkByDate.get(point.date);
    if (benchmarkValue && benchmarkValue > 0) {
      relativeStrength.push({ date: point.date, value: point.value / benchmarkValue });
    }
  }
  if (relativeStrength.length < 70) return null;

  // ~21 trading days = 1mo, ~63 = 3mo, ~252 = 1yr.
  const rs1m = round(pctOverLookback(relativeStrength, 21));
  const rs3m = round(pctOverLookback(relativeStrength, 63));
  const rs1y = round(pctOverLookback(relativeStrength, 252));
  const latest = relativeStrength.at(-1) || null;

  // Status: transports OUTPERFORMING (RS rising) = bullish industrial/freight read.
  let status: MonitorStatus;
  let severity: number;
  if ((rs3m != null && rs3m >= 1) && (rs1y == null || rs1y >= 0)) {
    status = 'green';
    severity = 0;
  } else if (rs3m != null && rs3m <= -3 && (rs1y == null || rs1y < 0)) {
    status = 'red';
    severity = 3;
  } else if (rs3m != null && rs3m < 0) {
    status = 'orange';
    severity = 2;
  } else {
    status = 'yellow';
    severity = 1;
  }

  return {
    key: 'transports_rel_strength',
    label: 'Transports vs S&P (rel. strength)',
    seriesId: `${TRANSPORTS_SYMBOL}/${TRANSPORTS_BENCHMARK}`,
    group: 'industrial_producer',
    description: 'Dow-Theory freight read: IYT (Dow Transports proxy) relative to SPY. Rising = market pricing goods-movement acceleration. Values are relative-strength % changes (1y / 3m / 1m), not absolute returns.',
    latestDate: latest?.date || null,
    latestValue: latest ? round(latest.value, 4) : null,
    yoyPct: rs1y,
    qoqAnnualizedPct: rs3m,
    twoQuarterPct: rs1m,
    status,
    severity,
  };
}

function buildProducerSeries(definition: ConsumerCycleSeriesDefinition, points: ConsumerCyclePoint[]): ConsumerCycleMonitorSeries {
  const ppy = definition.periodsPerYear ?? 4;
  const latest = points.at(-1) || null;
  const prevPeriod = points.length >= 2 ? points[points.length - 2] : null;
  const prevYear = points.length >= ppy + 1 ? points[points.length - 1 - ppy] : null;
  const twoBack = points.length >= 3 ? points[points.length - 3] : null;
  const yoyPct = round(pctChange(latest?.value ?? null, prevYear?.value ?? null));
  const momentumAnnualizedPct = round(annualizeChange(latest?.value ?? null, prevPeriod?.value ?? null, ppy));
  const twoPeriodPct = round(pctChange(latest?.value ?? null, twoBack?.value ?? null));
  const score = scoreSeries(yoyPct, momentumAnnualizedPct);

  return {
    key: definition.key,
    label: definition.label,
    seriesId: definition.seriesId,
    group: definition.group,
    description: definition.description,
    latestDate: latest?.date || null,
    latestValue: latest?.value ?? null,
    yoyPct,
    qoqAnnualizedPct: momentumAnnualizedPct,
    twoQuarterPct: twoPeriodPct,
    status: score.status,
    severity: score.severity,
  };
}

function averageSeverity(rows: Array<{ severity: number; weight: number }>): number {
  const weighted = rows.reduce((sum, row) => sum + (row.severity * row.weight), 0);
  const weights = rows.reduce((sum, row) => sum + row.weight, 0);
  return weights > 0 ? weighted / weights : 0;
}

function overallStatusFromSeverity(value: number): MonitorStatus {
  if (value >= 2.25) return 'red';
  if (value >= 1.5) return 'orange';
  if (value >= 0.75) return 'yellow';
  return 'green';
}

function buildScoreHint(overallStatus: MonitorStatus, weakeningPrimaryCount: number, weakeningTotalCount: number): string {
  if (overallStatus === 'red') {
    return `Broad cyclical deterioration is active. ${weakeningPrimaryCount} primary consumer bucket(s) and ${weakeningTotalCount} total bucket(s) are flashing orange or red.`;
  }
  if (overallStatus === 'orange') {
    return `The cycle is rolling over. ${weakeningPrimaryCount} primary consumer bucket(s) are weakening and companions are starting to confirm it.`;
  }
  if (overallStatus === 'yellow') {
    return `Momentum is softening but not fully broken. Watch whether the weakness spreads beyond one or two buckets.`;
  }
  return `Cyclical demand is still healthy overall. No broad slowdown signal is showing up yet.`;
}

export async function getConsumerCycleMonitor(forceRefresh = false): Promise<ConsumerCycleMonitorPayload> {
  if (!forceRefresh && monitorCache && monitorCache.expiresAt > Date.now()) {
    return monitorCache.payload;
  }

  const pointSets = await Promise.all(
    MONITOR_SERIES.map(async (definition) => ({
      definition,
      points: await fetchFredSeries(definition),
    }))
  );

  const series = pointSets.map(({ definition, points }) => buildMonitorSeries(definition, points));
  const cyclicalConsumerSeries = series.filter((row) => row.group === 'cyclical_consumer');
  const companionSeries = series.filter((row) => row.group === 'companion');

  // Producer/industrial cross-check layer — fetched resiliently so a single
  // missing/blocked FRED series never breaks the core consumer monitor.
  const producerResults = await Promise.allSettled(
    PRODUCER_SERIES.map(async (definition) => ({
      definition,
      points: await fetchFredSeries(definition),
    }))
  );
  const industrialProducerSeries = producerResults
    .filter((result): result is PromiseFulfilledResult<{ definition: ConsumerCycleSeriesDefinition; points: ConsumerCyclePoint[] }> => result.status === 'fulfilled')
    .map((result) => buildProducerSeries(result.value.definition, result.value.points));
  // Append the market-implied transports relative-strength proxy (best-effort).
  const transportsSeries = await buildTransportsSeries().catch(() => null);
  if (transportsSeries) industrialProducerSeries.push(transportsSeries);
  const statisticalDeviation = await buildStatisticalDeviation().catch(() => null);
  const severityRows = series.map((row) => ({
    severity: row.severity,
    weight: MONITOR_SERIES.find((definition) => definition.key === row.key)?.weight || 1,
  }));
  const avgSeverity = averageSeverity(severityRows);
  const overallStatus = overallStatusFromSeverity(avgSeverity);
  const weakeningPrimaryCount = cyclicalConsumerSeries.filter((row) => row.severity >= 2).length;
  const weakeningTotalCount = series.filter((row) => row.severity >= 2).length;
  const strongestSeries = [...series]
    .sort((a, b) => (b.yoyPct ?? -Infinity) - (a.yoyPct ?? -Infinity))
    .find((row) => row.yoyPct != null) || null;
  const weakestSeries = [...series]
    .sort((a, b) => (a.yoyPct ?? Infinity) - (b.yoyPct ?? Infinity))
    .find((row) => row.yoyPct != null) || null;
  const asOf = series.reduce<string | null>((latest, row) => {
    if (!row.latestDate) return latest;
    if (!latest || row.latestDate > latest) return row.latestDate;
    return latest;
  }, null);

  const payload: ConsumerCycleMonitorPayload = {
    asOf,
    source: 'FRED quarterly real activity series',
    overallStatus,
    averageSeverity: round(avgSeverity, 2) || 0,
    weakeningPrimaryCount,
    weakeningTotalCount,
    scoreHint: buildScoreHint(overallStatus, weakeningPrimaryCount, weakeningTotalCount),
    cyclicalConsumerSeries,
    companionSeries,
    industrialProducerSeries,
    statisticalDeviation,
    strongestSeries,
    weakestSeries,
  };

  monitorCache = {
    expiresAt: Date.now() + MONITOR_CACHE_TTL_MS,
    payload,
  };

  return payload;
}

export function getConsumerCycleSummary(filters: ConsumerCycleFilters = {}) {
  const rows = loadTradableStockRows();
  const filtered = applyFilters(rows, filters);
  return {
    totalTradableStocks: rows.length,
    filteredCount: filtered.length,
    optionableCount: filtered.filter((row) => row.optionable).length,
    preferInSlowdownCount: filtered.filter((row) => row.macroRegimePreference === 'prefer_in_slowdown').length,
    avoidInSlowdownCount: filtered.filter((row) => row.macroRegimePreference === 'avoid_in_slowdown').length,
    highlyCyclicalCount: filtered.filter((row) => row.consumerCycleBucket === 'highly_cyclical').length,
    defensiveCount: filtered.filter((row) => row.consumerCycleBucket === 'stable').length,
    byCycleBucket: countBy(filtered, (row) => row.consumerCycleBucket),
    bySpendClass: countBy(filtered, (row) => row.consumerSpendClass),
    byCategory: countBy(filtered, (row) => row.consumerSpendingCategory),
    byBucket: countBy(filtered, (row) => row.consumerDemandBucket),
    bySensitivity: countBy(filtered, (row) => row.consumerCycleSensitivity),
    byProfile: countBy(filtered, (row) => row.recessionProfile),
    byPreference: countBy(filtered, (row) => row.macroRegimePreference),
  };
}

export function getConsumerCycleSymbols(filters: ConsumerCycleFilters = {}) {
  const rows = applyFilters(loadTradableStockRows(), filters);
  const limit = Math.max(1, Math.min(1000, Number(filters.limit) || DEFAULT_LIMIT));
  return {
    total: rows.length,
    limit,
    rows: rows.slice(0, limit),
  };
}
