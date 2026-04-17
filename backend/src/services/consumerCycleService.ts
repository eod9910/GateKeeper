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

const SYMBOL_CATALOG_DB_PATH = path.join(__dirname, '../../data/symbol-catalog.sqlite');
const DEFAULT_LIMIT = 250;
const MONITOR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type MonitorStatus = 'green' | 'yellow' | 'orange' | 'red';

type ConsumerCycleSeriesDefinition = {
  key: string;
  label: string;
  seriesId: string;
  group: 'cyclical_consumer' | 'companion';
  weight: number;
  description: string;
};

type ConsumerCyclePoint = {
  date: string;
  value: number;
};

type ConsumerCycleMonitorSeries = {
  key: string;
  label: string;
  seriesId: string;
  group: 'cyclical_consumer' | 'companion';
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
  strongestSeries: ConsumerCycleMonitorSeries | null;
  weakestSeries: ConsumerCycleMonitorSeries | null;
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

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current / previous) - 1) * 100;
}

function annualizeQuarterlyChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous <= 0 || current <= 0) return null;
  return ((current / previous) ** 4 - 1) * 100;
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
