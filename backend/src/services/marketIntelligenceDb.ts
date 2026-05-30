/**
 * Market Intelligence — persistence layer.
 *
 * Read-path helpers for the Phase-1 routes. Wraps the SQLite database
 * created by backend/scripts/build_market_intelligence_db.py and seeded by
 * backend/scripts/seed_market_intelligence_registry.py.
 *
 * Style mirrors backend/src/services/appStateDb.ts:
 *   - Lazy `getDb()` singleton over node:sqlite DatabaseSync
 *   - Prepared statements for every query
 *   - Explicit Number/String coercion at the row boundary (SQLite is loose)
 *   - JSON columns parsed on the way out, never returned as strings
 *
 * Schema source-of-truth: backend/src/types/marketIntelligence.ts
 * (`Row*` shapes mirror SQLite columns; `Api*` shapes are the over-the-wire
 * envelope returned by GET endpoints).
 */

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

import type {
  ApiConsequenceGraph,
  ApiCoverageTierItem,
  ApiEmergingTopicItem,
  ApiEvidenceItem,
  ApiScenarioDetail,
  ApiScenarioListItem,
  ApiUniverseCandidate,
  AssetType,
  AuthenticitySignalSnapshot,
  AuthenticitySignalType,
  ConfidenceLevel,
  ConvictionLayer,
  CoverageTier,
  DetectionPath,
  EngineFilter,
  EvidenceType,
  ExposureDirection,
  ExposureOrder,
  OrderEffectSnapshot,
  ResolvedTickerEntry,
  RowMarketSituation,
  RowSituationExposure,
  RowThemeRegistry,
  ScenarioListQuery,
  ScenarioStatus,
  ScenarioType,
  SourceMethod,
  SuppressionReason,
  TargetType,
  ThemeCategory,
  TimeHorizon,
  ValidityFlag,
} from '../types/marketIntelligence';

import {
  MARKET_INTELLIGENCE_SCHEMA_VERSION,
  engineBucket,
} from '../types/marketIntelligence';

// ============================================================================
// Connection lifecycle
// ============================================================================

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'market-intelligence.sqlite');

let _db: DatabaseSync | null = null;

export function getMarketIntelligenceDbPath(): string {
  return DB_PATH;
}

export function databaseExists(): boolean {
  try {
    return fs.existsSync(DB_PATH);
  } catch {
    return false;
  }
}

function getDb(): DatabaseSync {
  if (_db) return _db;
  if (!databaseExists()) {
    throw new Error(
      `market-intelligence.sqlite not found at ${DB_PATH}. ` +
        'Run backend/scripts/build_market_intelligence_db.py first.',
    );
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  _db = db;
  return _db;
}

/** Test/teardown helper — closes and forgets the cached connection. */
export function _resetConnection(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore — already closed
    }
    _db = null;
  }
}

// ============================================================================
// Helpers: parsing, coercion
// ============================================================================

function parseJsonOrNull<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function asInt(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length === 0 ? null : s;
}

function asBool(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '0' && value.toLowerCase() !== 'false';
  return Boolean(value);
}

// ============================================================================
// Health / metadata
// ============================================================================

export interface MarketIntelligenceHealth {
  ok: boolean;
  db_path: string;
  db_exists: boolean;
  schema_version: number | null;
  expected_schema_version: number;
  table_counts: Record<string, number>;
  errors: string[];
}

const HEALTH_TABLES = [
  'theme_registry',
  'tracked_concepts',
  'coverage_tiers',
  'brand_to_ticker',
  'market_situations',
  'situation_signals',
  'situation_evidence',
  'situation_exposure',
  'concept_mentions',
  'concept_daily_counts',
  'topic_baselines',
  'emerging_topics',
  'authenticity_signals',
  'emerging_claims',
  'narrative_clusters',
  'narrative_cluster_claims',
];

export function getHealth(): MarketIntelligenceHealth {
  const errors: string[] = [];
  const result: MarketIntelligenceHealth = {
    ok: false,
    db_path: DB_PATH,
    db_exists: databaseExists(),
    schema_version: null,
    expected_schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
    table_counts: {},
    errors,
  };
  if (!result.db_exists) {
    errors.push('database file missing');
    return result;
  }

  let db: DatabaseSync;
  try {
    db = getDb();
  } catch (err: any) {
    errors.push(String(err?.message || err));
    return result;
  }

  try {
    const versionRow = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (versionRow) {
      result.schema_version = asInt(versionRow.value, 0);
    } else {
      errors.push('schema_meta.schema_version row missing');
    }
  } catch (err: any) {
    errors.push(`schema_meta query failed: ${String(err?.message || err)}`);
  }

  for (const table of HEALTH_TABLES) {
    try {
      // Table names are hard-coded above; safe to interpolate.
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
        | { n: number }
        | undefined;
      result.table_counts[table] = row ? asInt(row.n, 0) : 0;
    } catch (err: any) {
      errors.push(`COUNT(${table}) failed: ${String(err?.message || err)}`);
      result.table_counts[table] = -1;
    }
  }

  result.ok =
    errors.length === 0 &&
    result.schema_version === MARKET_INTELLIGENCE_SCHEMA_VERSION;
  return result;
}

// ============================================================================
// theme_registry
// ============================================================================

export function listThemes(): RowThemeRegistry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT theme_key, display_name, category, taxonomy_version, created_at
         FROM theme_registry
        ORDER BY display_name ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    theme_key: String(r.theme_key),
    display_name: String(r.display_name),
    category: String(r.category) as ThemeCategory,
    taxonomy_version: asInt(r.taxonomy_version, 1),
    created_at: asInt(r.created_at),
  }));
}

// ============================================================================
// market_situations — list + detail
// ============================================================================

interface RawSituationRow {
  id: number | bigint;
  slug: string;
  title: string;
  summary: string;
  primary_theme: string;
  scenario_type: string;
  status: string;
  signal_strength: number;
  confidence_score: number;
  confidence_level: string;
  time_horizon: string;
  started_at: number;
  last_confirmed_at: number | null;
  last_updated_at: number;
  expires_at: number | null;
  event_score: number | null;
  attention_score: number | null;
  market_confirmation_score: number | null;
  crowding_score: number | null;
  source_breadth_score: number | null;
  evidence_count: number;
  first_order_effects_json: string | null;
  second_order_effects_json: string | null;
  validity_flags_json: string | null;
  confidence_reasons_json: string | null;
  conviction_layer_json: string | null;
  conviction_pack_hash: string | null;
  detection_path: string;
  seeded_emerging_topic_id: number | null;
  coverage_tier: string | null;
  authenticity_score: number | null;
  peak_z_score: number | null;
  cross_platform_corroboration: number;
  edge_multiplier: number;
  metadata_json: string | null;
  schema_version: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

function decodeSituationRow(r: RawSituationRow): RowMarketSituation {
  return {
    id: asInt(r.id),
    slug: String(r.slug),
    title: String(r.title),
    summary: String(r.summary ?? ''),
    primary_theme: String(r.primary_theme),
    scenario_type: String(r.scenario_type) as ScenarioType,
    status: String(r.status) as ScenarioStatus,
    signal_strength: asNumber(r.signal_strength),
    confidence_score: asNumber(r.confidence_score),
    confidence_level: String(r.confidence_level) as ConfidenceLevel,
    time_horizon: String(r.time_horizon) as TimeHorizon,
    started_at: asInt(r.started_at),
    last_confirmed_at: asNumberOrNull(r.last_confirmed_at),
    last_updated_at: asInt(r.last_updated_at),
    expires_at: asNumberOrNull(r.expires_at),
    event_score: asNumberOrNull(r.event_score),
    attention_score: asNumberOrNull(r.attention_score),
    market_confirmation_score: asNumberOrNull(r.market_confirmation_score),
    crowding_score: asNumberOrNull(r.crowding_score),
    source_breadth_score: asNumberOrNull(r.source_breadth_score),
    evidence_count: asInt(r.evidence_count),
    first_order_effects_json: parseJsonOrNull<OrderEffectSnapshot[]>(
      r.first_order_effects_json,
    ),
    second_order_effects_json: parseJsonOrNull<OrderEffectSnapshot[]>(
      r.second_order_effects_json,
    ),
    validity_flags_json: parseJsonOrNull<ValidityFlag[]>(r.validity_flags_json),
    confidence_reasons_json: parseJsonOrNull<string[]>(r.confidence_reasons_json),
    conviction_layer_json: parseJsonOrNull<ConvictionLayer>(r.conviction_layer_json),
    conviction_pack_hash: asStringOrNull(r.conviction_pack_hash),
    detection_path: String(r.detection_path) as DetectionPath,
    seeded_emerging_topic_id: asNumberOrNull(r.seeded_emerging_topic_id),
    coverage_tier: r.coverage_tier
      ? (String(r.coverage_tier) as CoverageTier)
      : null,
    authenticity_score: asNumberOrNull(r.authenticity_score),
    peak_z_score: asNumberOrNull(r.peak_z_score),
    cross_platform_corroboration: asBool(r.cross_platform_corroboration),
    edge_multiplier: asNumber(r.edge_multiplier, 1.0),
    metadata_json: parseJsonOrNull<Record<string, unknown>>(r.metadata_json),
    schema_version: asInt(r.schema_version, MARKET_INTELLIGENCE_SCHEMA_VERSION),
    created_at: asInt(r.created_at),
    updated_at: asInt(r.updated_at),
    archived_at: asNumberOrNull(r.archived_at),
  };
}

const SITUATION_SELECT_COLUMNS = `
  id, slug, title, summary, primary_theme, scenario_type, status,
  signal_strength, confidence_score, confidence_level, time_horizon,
  started_at, last_confirmed_at, last_updated_at, expires_at,
  event_score, attention_score, market_confirmation_score, crowding_score, source_breadth_score,
  evidence_count,
  first_order_effects_json, second_order_effects_json,
  validity_flags_json, confidence_reasons_json, conviction_layer_json, conviction_pack_hash,
  detection_path, seeded_emerging_topic_id, coverage_tier, authenticity_score, peak_z_score,
  cross_platform_corroboration, edge_multiplier, metadata_json,
  schema_version, created_at, updated_at, archived_at
`;

// ----------------------------------------------------------------------------
// scenarioListItem derivation
// ----------------------------------------------------------------------------

/**
 * Stand-in for the engine's per-engine scoring profile output (PRD §Proposed
 * Scoring Framework). The real value is computed by Phase 2/3 scoring jobs
 * and persisted; until those land we expose `signal_strength` here so the
 * field is non-null for every row. Documented in the API contract as a
 * Phase-1-stub field that scoring jobs will overwrite.
 */
function deriveScenarioScore(row: RowMarketSituation): number {
  return row.signal_strength;
}

function freshnessSeconds(row: RowMarketSituation, nowSec: number): number {
  return Math.max(0, nowSec - row.last_updated_at);
}

function emptyValidityFlags(row: RowMarketSituation): ValidityFlag[] {
  return row.validity_flags_json ?? [];
}

// ----------------------------------------------------------------------------
// top_universe_candidates lookup
// ----------------------------------------------------------------------------

interface RawCandidateRow {
  symbol: string;
  composite_rank: number | null;
  coverage_tier: string | null;
  exposure_direction: string;
}

function loadUniverseCandidates(
  situationId: number,
  limit: number,
): ApiUniverseCandidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         se.universe_symbol  AS symbol,
         se.composite_rank   AS composite_rank,
         COALESCE(ct.coverage_tier, 'lightly_covered') AS coverage_tier,
         se.exposure_direction AS exposure_direction
       FROM situation_exposure se
       LEFT JOIN coverage_tiers ct
         ON ct.symbol = se.universe_symbol
       WHERE se.situation_id = ?
         AND se.universe_symbol IS NOT NULL
         AND se.composite_rank  IS NOT NULL
       ORDER BY se.composite_rank DESC
       LIMIT ?`,
    )
    .all(situationId, limit) as RawCandidateRow[];

  return rows.map((r) => ({
    symbol: String(r.symbol),
    composite_rank: Math.round((Number(r.composite_rank) || 0) * 10) / 10,
    coverage_tier: String(r.coverage_tier) as CoverageTier,
    exposure_direction: String(r.exposure_direction) as ExposureDirection,
  }));
}

// ----------------------------------------------------------------------------
// listScenarios — filtered list endpoint
// ----------------------------------------------------------------------------

const ENGINE_TO_DETECTION_PATHS: Record<EngineFilter, DetectionPath[] | null> = {
  both: null,
  macro: ['news_cluster', 'mixed_news_led'],
  social_arbitrage: ['topic_anomaly', 'mixed_anomaly_led'],
};

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;
const LIST_CANDIDATE_LIMIT = 5;
const DETAIL_CANDIDATE_LIMIT = 20;

export interface ListScenariosResult {
  items: ApiScenarioListItem[];
  total: number;
}

export function listScenarios(query: ScenarioListQuery = {}): ListScenariosResult {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];

  // Default: hide archived and INVALIDATED unless explicitly requested.
  if (!query.include_archived) {
    wheres.push('archived_at IS NULL');
  }
  if (!query.include_invalidated) {
    wheres.push("status != 'INVALIDATED'");
  }

  if (query.status && query.status.length > 0) {
    const placeholders = query.status.map(() => '?').join(',');
    wheres.push(`status IN (${placeholders})`);
    params.push(...query.status);
  }

  if (query.theme) {
    wheres.push('primary_theme = ?');
    params.push(query.theme);
  }

  if (query.scenario_type) {
    wheres.push('scenario_type = ?');
    params.push(query.scenario_type);
  }

  if (query.time_horizon) {
    wheres.push('time_horizon = ?');
    params.push(query.time_horizon);
  }

  // Engine filter: may be combined with explicit detection_path; intersect both.
  let detectionPaths: DetectionPath[] | null = null;
  if (query.engine && query.engine !== 'both') {
    detectionPaths = ENGINE_TO_DETECTION_PATHS[query.engine] ?? null;
  }
  if (query.detection_path && query.detection_path.length > 0) {
    detectionPaths = detectionPaths
      ? detectionPaths.filter((p) => query.detection_path!.includes(p))
      : [...query.detection_path];
  }
  if (detectionPaths) {
    if (detectionPaths.length === 0) {
      // Engine + detection_path filter intersect to empty set: short-circuit.
      return { items: [], total: 0 };
    }
    const placeholders = detectionPaths.map(() => '?').join(',');
    wheres.push(`detection_path IN (${placeholders})`);
    params.push(...detectionPaths);
  }

  if (query.coverage_tier && query.coverage_tier.length > 0) {
    const placeholders = query.coverage_tier.map(() => '?').join(',');
    wheres.push(`coverage_tier IN (${placeholders})`);
    params.push(...query.coverage_tier);
  }

  if (typeof query.min_signal_strength === 'number') {
    wheres.push('signal_strength >= ?');
    params.push(query.min_signal_strength);
  }

  if (typeof query.min_confidence === 'number') {
    wheres.push('confidence_score >= ?');
    params.push(query.min_confidence);
  }

  // Social-Arbitrage-only thresholds: applied only to social-arbitrage rows.
  // Macro rows pass through unaffected (PRD D27).
  if (typeof query.min_authenticity_score === 'number') {
    wheres.push(
      "(detection_path IN ('news_cluster','mixed_news_led') OR authenticity_score >= ?)",
    );
    params.push(query.min_authenticity_score);
  }

  if (typeof query.min_peak_z === 'number') {
    wheres.push(
      "(detection_path IN ('news_cluster','mixed_news_led') OR peak_z_score >= ?)",
    );
    params.push(query.min_peak_z);
  }

  if (query.cross_platform_only) {
    wheres.push(
      "(detection_path IN ('news_cluster','mixed_news_led') OR cross_platform_corroboration = 1)",
    );
  }

  if (query.only_early) {
    wheres.push("status IN ('EARLY','DEVELOPING')");
  }

  if (typeof query.min_evidence === 'number' && query.min_evidence > 0) {
    wheres.push('evidence_count >= ?');
    params.push(query.min_evidence);
  }

  // Suppression: hide rows whose validity_flags include LIKELY_INAUTHENTIC
  // unless include_suppressed is set. Cheap LIKE check on the JSON text
  // column avoids the json1 dependency.
  if (!query.include_suppressed) {
    wheres.push(
      "(validity_flags_json IS NULL OR validity_flags_json NOT LIKE '%\"LIKELY_INAUTHENTIC\"%')",
    );
  }

  const limit = Math.min(
    Math.max(asInt(query.limit, DEFAULT_LIST_LIMIT), 1),
    MAX_LIST_LIMIT,
  );

  const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM market_situations ${whereClause}`)
    .get(...params) as { n: number } | undefined;
  const total = totalRow ? asInt(totalRow.n, 0) : 0;

  const sql = `
    SELECT ${SITUATION_SELECT_COLUMNS}
      FROM market_situations
      ${whereClause}
      ORDER BY signal_strength DESC, last_updated_at DESC
      LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit) as RawSituationRow[];
  const decoded = rows.map(decodeSituationRow);

  const nowSec = Math.floor(Date.now() / 1000);
  const items: ApiScenarioListItem[] = decoded.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status: row.status,
    scenario_type: row.scenario_type,
    primary_theme: row.primary_theme,
    detection_path: row.detection_path,
    seeded_emerging_topic_id: row.seeded_emerging_topic_id,
    coverage_tier: row.coverage_tier,
    edge_multiplier: row.edge_multiplier,
    authenticity_score: row.authenticity_score,
    peak_z_score: row.peak_z_score,
    cross_platform_corroboration: row.cross_platform_corroboration,
    signal_strength: row.signal_strength,
    confidence_score: row.confidence_score,
    confidence_level: row.confidence_level,
    time_horizon: row.time_horizon,
    scenario_score: deriveScenarioScore(row),
    source_breadth_score: row.source_breadth_score,
    started_at: row.started_at,
    last_updated_at: row.last_updated_at,
    expires_at: row.expires_at,
    evidence_count: row.evidence_count,
    validity_flags: emptyValidityFlags(row),
    top_universe_candidates: loadUniverseCandidates(row.id, LIST_CANDIDATE_LIMIT),
    freshness_seconds: freshnessSeconds(row, nowSec),
    schema_version: row.schema_version,
  }));

  return { items, total };
}

// ----------------------------------------------------------------------------
// getScenarioByIdOrSlug — detail endpoint
// ----------------------------------------------------------------------------

function isNumericIdString(s: string): boolean {
  return /^\d+$/.test(s);
}

function getSituationByIdOrSlug(idOrSlug: string): RowMarketSituation | null {
  const db = getDb();
  const sql = `SELECT ${SITUATION_SELECT_COLUMNS} FROM market_situations WHERE ${
    isNumericIdString(idOrSlug) ? 'id = ?' : 'slug = ?'
  }`;
  const param: unknown = isNumericIdString(idOrSlug) ? Number(idOrSlug) : idOrSlug;
  const row = db.prepare(sql).get(param) as RawSituationRow | undefined;
  return row ? decodeSituationRow(row) : null;
}

interface RawExposureRow {
  id: number | bigint;
  situation_id: number | bigint;
  asset_type: string;
  asset_key: string;
  exposure_direction: string;
  exposure_order: string;
  exposure_strength: number;
  source_method: string;
  rationale: string | null;
  confidence: number;
  universe_symbol: string | null;
  dcf_gap_pct: number | null;
  quality_score: number | null;
  technical_score: number | null;
  final_buzz_score: number | null;
  composite_rank: number | null;
  last_ranked_at: number | null;
  payload_json: string | null;
}

function decodeExposureRow(r: RawExposureRow): RowSituationExposure {
  return {
    id: asInt(r.id),
    situation_id: asInt(r.situation_id),
    asset_type: String(r.asset_type) as AssetType,
    asset_key: String(r.asset_key),
    exposure_direction: String(r.exposure_direction) as ExposureDirection,
    exposure_order: String(r.exposure_order) as ExposureOrder,
    exposure_strength: asNumber(r.exposure_strength),
    source_method: String(r.source_method) as SourceMethod,
    rationale: asStringOrNull(r.rationale),
    confidence: asNumber(r.confidence),
    universe_symbol: asStringOrNull(r.universe_symbol),
    dcf_gap_pct: asNumberOrNull(r.dcf_gap_pct),
    quality_score: asNumberOrNull(r.quality_score),
    technical_score: asNumberOrNull(r.technical_score),
    final_buzz_score: asNumberOrNull(r.final_buzz_score),
    composite_rank: asNumberOrNull(r.composite_rank),
    last_ranked_at: asNumberOrNull(r.last_ranked_at),
    payload_json: parseJsonOrNull<Record<string, unknown>>(r.payload_json),
  };
}

function loadExposures(situationId: number): RowSituationExposure[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         id, situation_id, asset_type, asset_key, exposure_direction,
         exposure_order, exposure_strength, source_method, rationale, confidence,
         universe_symbol, dcf_gap_pct, quality_score, technical_score,
         final_buzz_score, composite_rank, last_ranked_at, payload_json
       FROM situation_exposure
       WHERE situation_id = ?
       ORDER BY exposure_order ASC, exposure_strength DESC, asset_key ASC`,
    )
    .all(situationId) as RawExposureRow[];
  return rows.map(decodeExposureRow);
}

interface RawEvidenceRow {
  id: number | bigint;
  evidence_type: string;
  source_name: string;
  headline_or_label: string;
  summary: string | null;
  url: string | null;
  published_at: number;
  importance_score: number | null;
}

function decodeEvidenceRow(r: RawEvidenceRow): ApiEvidenceItem {
  return {
    id: asInt(r.id),
    evidence_type: String(r.evidence_type) as EvidenceType,
    source_name: String(r.source_name),
    headline_or_label: String(r.headline_or_label),
    summary: asStringOrNull(r.summary),
    url: asStringOrNull(r.url),
    published_at: asInt(r.published_at),
    importance_score: asNumberOrNull(r.importance_score),
  };
}

export interface EvidenceQuery {
  /** Unix-seconds lower bound (exclusive). */
  since?: number;
  limit?: number;
}

const MAX_EVIDENCE_LIMIT = 500;
const DEFAULT_EVIDENCE_LIMIT = 50;

export function listEvidenceForSituation(
  idOrSlug: string,
  query: EvidenceQuery = {},
): { items: ApiEvidenceItem[]; situation_id: number } | null {
  const situation = getSituationByIdOrSlug(idOrSlug);
  if (!situation) return null;

  const db = getDb();
  const limit = Math.min(
    Math.max(asInt(query.limit, DEFAULT_EVIDENCE_LIMIT), 1),
    MAX_EVIDENCE_LIMIT,
  );

  const params: unknown[] = [situation.id];
  let sinceClause = '';
  if (typeof query.since === 'number' && Number.isFinite(query.since)) {
    sinceClause = ' AND published_at > ?';
    params.push(query.since);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT id, evidence_type, source_name, headline_or_label, summary, url,
              published_at, importance_score
         FROM situation_evidence
        WHERE situation_id = ?${sinceClause}
        ORDER BY published_at DESC, id DESC
        LIMIT ?`,
    )
    .all(...params) as RawEvidenceRow[];

  return {
    situation_id: situation.id,
    items: rows.map(decodeEvidenceRow),
  };
}

// ----------------------------------------------------------------------------
// detail composer
// ----------------------------------------------------------------------------

function buildConsequenceGraph(
  situation: RowMarketSituation,
  exposures: RowSituationExposure[],
): ApiConsequenceGraph {
  const nodes: ApiConsequenceGraph['nodes'] = [];
  const seenNodes = new Set<string>();

  const themeNodeId = `theme:${situation.primary_theme}`;
  nodes.push({ id: themeNodeId, label: situation.primary_theme, kind: 'theme' });
  seenNodes.add(themeNodeId);

  const edges: ApiConsequenceGraph['edges'] = [];

  for (const exp of exposures) {
    const nodeId = `${exp.asset_type}:${exp.asset_key}`;
    if (!seenNodes.has(nodeId)) {
      nodes.push({ id: nodeId, label: exp.asset_key, kind: exp.asset_type });
      seenNodes.add(nodeId);
    }
    edges.push({
      from: themeNodeId,
      to: nodeId,
      exposure_direction: exp.exposure_direction,
      exposure_order: exp.exposure_order,
      exposure_strength: exp.exposure_strength,
    });
  }

  return { nodes, edges };
}

export function getScenarioDetail(idOrSlug: string): ApiScenarioDetail | null {
  const situation = getSituationByIdOrSlug(idOrSlug);
  if (!situation) return null;

  const exposures = loadExposures(situation.id);
  const evidenceResult = listEvidenceForSituation(idOrSlug, {
    limit: MAX_EVIDENCE_LIMIT,
  });
  const evidenceTimeline = evidenceResult ? evidenceResult.items : [];

  const nowSec = Math.floor(Date.now() / 1000);

  const affectedAssets = Array.from(
    new Set(
      exposures
        .filter((e) => e.asset_type === 'equity' || e.asset_type === 'etf')
        .map((e) => e.asset_key),
    ),
  );
  const affectedSectors = Array.from(
    new Set(
      exposures
        .filter((e) => e.asset_type === 'sector' || e.asset_type === 'industry')
        .map((e) => e.asset_key),
    ),
  );

  // engineBucket is imported for future per-engine response shaping; the
  // current detail body is engine-agnostic.
  void engineBucket(situation.detection_path);

  const detail: ApiScenarioDetail = {
    id: situation.id,
    slug: situation.slug,
    title: situation.title,
    summary: situation.summary,
    status: situation.status,
    scenario_type: situation.scenario_type,
    primary_theme: situation.primary_theme,
    detection_path: situation.detection_path,
    seeded_emerging_topic_id: situation.seeded_emerging_topic_id,
    coverage_tier: situation.coverage_tier,
    edge_multiplier: situation.edge_multiplier,
    authenticity_score: situation.authenticity_score,
    peak_z_score: situation.peak_z_score,
    cross_platform_corroboration: situation.cross_platform_corroboration,
    signal_strength: situation.signal_strength,
    confidence_score: situation.confidence_score,
    confidence_level: situation.confidence_level,
    time_horizon: situation.time_horizon,
    scenario_score: deriveScenarioScore(situation),
    source_breadth_score: situation.source_breadth_score,
    started_at: situation.started_at,
    last_updated_at: situation.last_updated_at,
    expires_at: situation.expires_at,
    evidence_count: situation.evidence_count,
    validity_flags: emptyValidityFlags(situation),
    top_universe_candidates: loadUniverseCandidates(
      situation.id,
      DETAIL_CANDIDATE_LIMIT,
    ),
    freshness_seconds: freshnessSeconds(situation, nowSec),
    schema_version: situation.schema_version,
    first_order_effects: situation.first_order_effects_json ?? [],
    second_order_effects: situation.second_order_effects_json ?? [],
    confidence_reasons: situation.confidence_reasons_json ?? [],
    conviction_layer: situation.conviction_layer_json,
    affected_sectors: affectedSectors,
    affected_assets: affectedAssets,
    evidence_timeline: evidenceTimeline,
    consequence_map: buildConsequenceGraph(situation, exposures),
    exposure_list: exposures,
  };

  return detail;
}

// ============================================================================
// emerging_topics — Research tab feed
// ============================================================================

/**
 * D27 — Social Arbitrage scoring profile coverage tier multipliers.
 * Mirrors `backend/services/social_arbitrage_scoring.py:COVERAGE_EDGE_MULTIPLIERS`.
 * Kept in sync by hand because TS and Python don't share a runtime; the
 * /coverage-tiers/:symbol endpoint surfaces this value so the UI can render
 * the same number the scoring profile uses.
 */
const COVERAGE_EDGE_MULTIPLIERS: Record<CoverageTier, number> = {
  barely_covered: 1.5,
  lightly_covered: 1.2,
  well_covered: 1.0,
  mega_covered: 0.4,
  untradable: 0.0,
};

export function edgeMultiplierForTier(tier: CoverageTier): number {
  return COVERAGE_EDGE_MULTIPLIERS[tier];
}

// ============================================================================
// EXPOSURE OVERRIDES (PRD §Operator Override)
// ============================================================================

export interface ExposureOverrideInput {
  situation_id: number;
  asset_type: string;
  asset_key: string;
  exposure_direction: string;
  exposure_order: string;
  exposure_strength: number;
  rationale?: string;
  confidence: number;
  universe_symbol?: string | null;
}

export function upsertExposureOverride(
  input: ExposureOverrideInput,
): RowSituationExposure {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = db
    .prepare(
      `SELECT id FROM situation_exposure
       WHERE situation_id = ? AND asset_type = ? AND asset_key = ?
         AND source_method = 'operator_override'`,
    )
    .get(input.situation_id, input.asset_type, input.asset_key) as
    | { id: number }
    | undefined;

  if (existing) {
    db.prepare(
      `UPDATE situation_exposure SET
         exposure_direction = ?, exposure_order = ?, exposure_strength = ?,
         rationale = ?, confidence = ?, universe_symbol = ?
       WHERE id = ?`,
    ).run(
      input.exposure_direction,
      input.exposure_order,
      input.exposure_strength,
      input.rationale ?? null,
      input.confidence,
      input.universe_symbol ?? null,
      existing.id,
    );
    return loadExposureById(existing.id)!;
  }

  db.prepare(
    `INSERT INTO situation_exposure (
       situation_id, asset_type, asset_key, exposure_direction,
       exposure_order, exposure_strength, source_method,
       rationale, confidence, universe_symbol
     ) VALUES (?, ?, ?, ?, ?, ?, 'operator_override', ?, ?, ?)`,
  ).run(
    input.situation_id,
    input.asset_type,
    input.asset_key,
    input.exposure_direction,
    input.exposure_order,
    input.exposure_strength,
    input.rationale ?? null,
    input.confidence,
    input.universe_symbol ?? null,
  );

  const inserted = db
    .prepare(`SELECT last_insert_rowid() AS id`)
    .get() as { id: number };

  db.prepare(
    `UPDATE market_situations SET updated_at = ? WHERE id = ?`,
  ).run(now, input.situation_id);

  return loadExposureById(inserted.id)!;
}

export function deleteExposureOverride(
  exposureId: number,
): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, source_method FROM situation_exposure WHERE id = ?`,
    )
    .get(exposureId) as { id: number; source_method: string } | undefined;

  if (!row) return false;
  if (row.source_method !== 'operator_override') {
    throw new Error('Can only delete operator_override rows');
  }

  db.prepare(`DELETE FROM situation_exposure WHERE id = ?`).run(exposureId);
  return true;
}

function loadExposureById(id: number): RowSituationExposure | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         id, situation_id, asset_type, asset_key, exposure_direction,
         exposure_order, exposure_strength, source_method, rationale, confidence,
         universe_symbol, dcf_gap_pct, quality_score, technical_score,
         final_buzz_score, composite_rank, last_ranked_at, payload_json
       FROM situation_exposure WHERE id = ?`,
    )
    .get(id) as RawExposureRow | undefined;
  return row ? decodeExposureRow(row) : null;
}

export interface EmergingTopicListQuery {
  min_z?: number;
  min_authenticity?: number;
  cross_platform_only?: boolean;
  community?: string;
  concept_target_type?: TargetType;
  seeded_only?: boolean;
  include_suppressed?: boolean;
  limit?: number;
}

const ALLOWED_EMERGING_TARGET_TYPES: ReadonlySet<string> = new Set([
  'brand',
  'product',
  'category',
  'behavior',
  'keyword',
  'event_type',
]);

const MAX_EMERGING_LIMIT = 500;
const DEFAULT_EMERGING_LIMIT = 100;

interface RawEmergingTopicJoinedRow {
  id: number;
  concept_id: number;
  seed_community: string;
  peak_z_score: number;
  current_z_score: number;
  corroborating_communities_json: string | null;
  cross_platform_corroboration: number;
  migration_to_ticker_indexed: number;
  migrated_at: number | null;
  first_anomaly_at: number;
  last_anomaly_at: number;
  total_mentions: number;
  unique_authors: number;
  authenticity_score: number;
  resolved_target_type: string | null;
  resolved_tickers_json: string | null;
  seeded_situation_id: number | null;
  suppression_reason: string | null;
  // joined from tracked_concepts:
  concept_key: string;
  target_type: string;
  target_key: string;
  display_label: string;
}

/**
 * Decorate a resolver-emitted ticker list with each ticker's coverage_tier.
 * The promoter writes resolved_tickers_json ahead of the weekly coverage
 * refresh, so we re-look-up the tier at read time. Missing rows fall back
 * to `lightly_covered` (the same default the scoring profile uses).
 */
function enrichResolvedTickers(
  rawTickers: ResolvedTickerEntry[] | string[] | null,
): ResolvedTickerEntry[] {
  if (!rawTickers || rawTickers.length === 0) return [];

  // Normalize to entry shape regardless of whether the promoter wrote bare
  // ticker strings or full ResolvedTickerEntry objects.
  const entries: ResolvedTickerEntry[] = rawTickers.map((t) => {
    if (typeof t === 'string') {
      return {
        ticker: t,
        coverage_tier: 'lightly_covered',
        source_method: 'hand_curated',
        confidence: 1.0,
      };
    }
    return t;
  });

  const symbols = entries.map((e) => e.ticker.toUpperCase()).filter(Boolean);
  if (symbols.length === 0) return entries;

  const placeholders = symbols.map(() => '?').join(',');
  const tierRows = getDb()
    .prepare(
      `SELECT symbol, coverage_tier
         FROM coverage_tiers
        WHERE symbol IN (${placeholders})`,
    )
    .all(...symbols) as Array<{ symbol: string; coverage_tier: string }>;

  const tierBySymbol = new Map<string, CoverageTier>();
  for (const r of tierRows) {
    tierBySymbol.set(String(r.symbol), String(r.coverage_tier) as CoverageTier);
  }

  return entries.map((e) => ({
    ...e,
    coverage_tier: tierBySymbol.get(e.ticker.toUpperCase()) ?? e.coverage_tier,
  }));
}

function decodeEmergingTopicJoined(
  r: RawEmergingTopicJoinedRow,
): ApiEmergingTopicItem {
  const corroborating =
    parseJsonOrNull<string[]>(r.corroborating_communities_json) ?? [];
  const resolvedRaw = parseJsonOrNull<ResolvedTickerEntry[] | string[]>(
    r.resolved_tickers_json,
  );

  return {
    id: asInt(r.id),
    concept: {
      id: asInt(r.concept_id),
      concept_key: String(r.concept_key),
      target_type: String(r.target_type) as TargetType,
      target_key: String(r.target_key),
      display_label: String(r.display_label),
    },
    seed_community: String(r.seed_community),
    peak_z_score: asNumber(r.peak_z_score),
    current_z_score: asNumber(r.current_z_score),
    corroborating_communities: corroborating,
    cross_platform_corroboration: asBool(r.cross_platform_corroboration),
    migration_to_ticker_indexed: asBool(r.migration_to_ticker_indexed),
    migrated_at: asNumberOrNull(r.migrated_at),
    first_anomaly_at: asInt(r.first_anomaly_at),
    last_anomaly_at: asInt(r.last_anomaly_at),
    total_mentions: asInt(r.total_mentions),
    unique_authors: asInt(r.unique_authors),
    authenticity_score: asNumber(r.authenticity_score),
    resolved_target_type: r.resolved_target_type
      ? (String(r.resolved_target_type) as TargetType)
      : null,
    resolved_tickers: enrichResolvedTickers(resolvedRaw),
    seeded_situation_id: asNumberOrNull(r.seeded_situation_id),
    suppression_reason: r.suppression_reason
      ? (String(r.suppression_reason) as SuppressionReason)
      : null,
  };
}

export interface ListEmergingTopicsResult {
  items: ApiEmergingTopicItem[];
  total: number;
  applied_filters: EmergingTopicListQuery;
}

export function listEmergingTopics(
  query: EmergingTopicListQuery = {},
): ListEmergingTopicsResult {
  const db = getDb();

  const wheres: string[] = [];
  const params: unknown[] = [];

  // Default suppression: hide rows with non-null suppression_reason unless
  // the caller opts in. Mirrors PRD §Suppression and the scenarios endpoint.
  if (!query.include_suppressed) {
    wheres.push('et.suppression_reason IS NULL');
  }

  if (typeof query.min_z === 'number' && Number.isFinite(query.min_z)) {
    wheres.push('et.peak_z_score >= ?');
    params.push(query.min_z);
  }

  if (
    typeof query.min_authenticity === 'number' &&
    Number.isFinite(query.min_authenticity)
  ) {
    wheres.push('et.authenticity_score >= ?');
    params.push(query.min_authenticity);
  }

  if (query.cross_platform_only) {
    wheres.push('et.cross_platform_corroboration = 1');
  }

  if (query.community) {
    wheres.push('et.seed_community = ?');
    params.push(String(query.community));
  }

  if (query.concept_target_type) {
    if (!ALLOWED_EMERGING_TARGET_TYPES.has(query.concept_target_type)) {
      throw new Error(
        `Invalid concept_target_type='${query.concept_target_type}'`,
      );
    }
    wheres.push('tc.target_type = ?');
    params.push(query.concept_target_type);
  }

  if (query.seeded_only) {
    wheres.push('et.seeded_situation_id IS NOT NULL');
  }

  const limit = Math.min(
    Math.max(asInt(query.limit, DEFAULT_EMERGING_LIMIT), 1),
    MAX_EMERGING_LIMIT,
  );

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  // Total respects the same filters so the UI can render "showing N of M".
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM emerging_topics et
         JOIN tracked_concepts tc ON tc.id = et.concept_id
         ${where}`,
    )
    .get(...params) as { c: number };
  const total = asInt(totalRow.c, 0);

  const rows = db
    .prepare(
      `SELECT
         et.id, et.concept_id, et.seed_community,
         et.peak_z_score, et.current_z_score,
         et.corroborating_communities_json, et.cross_platform_corroboration,
         et.migration_to_ticker_indexed, et.migrated_at,
         et.first_anomaly_at, et.last_anomaly_at,
         et.total_mentions, et.unique_authors,
         et.authenticity_score,
         et.resolved_target_type, et.resolved_tickers_json,
         et.seeded_situation_id, et.suppression_reason,
         tc.concept_key, tc.target_type, tc.target_key, tc.display_label
       FROM emerging_topics et
       JOIN tracked_concepts tc ON tc.id = et.concept_id
       ${where}
       ORDER BY et.peak_z_score DESC, et.last_anomaly_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as RawEmergingTopicJoinedRow[];

  return {
    items: rows.map(decodeEmergingTopicJoined),
    total,
    applied_filters: query,
  };
}

// ----------------------------------------------------------------------------
// Narrative Radar — clustered emerging claims before scenario promotion
// ----------------------------------------------------------------------------

export interface SocialArbSourceAuditRow {
  source_type: string;
  source_community: string;
  raw_hits_7d: number;
  matched_hits_7d: number;
  latest_posted_at: number | null;
}

export interface SocialArbEngineAudit {
  as_of: number;
  window_days: number;
  raw_hits_7d: number;
  matched_hits_7d: number;
  tracked_concepts: {
    total: number;
    active: number;
    pruned: number;
    merged: number;
  };
  emerging_topics: {
    total: number;
    pending: number;
    promoted_spike_events: number;
    unique_promoted_cards: number;
    repeated_pulses: number;
    suppressed: number;
    cross_platform: number;
  };
  social_cards: {
    pure_social: number;
    mixed_social_macro: number;
    active_visible: number;
  };
  sources: SocialArbSourceAuditRow[];
}

export interface UniverseSymbolPerturbationRow {
  symbol: string;
  source_type: string;
  source_community: string;
  day: number;
  mention_count: number;
  baseline_mean: number;
  baseline_stdev: number;
  z_score: number;
  velocity_ratio: number;
  unique_authors: number;
  discovery_count: number;
  confirmation_count: number;
  perturbation_score: number;
  updated_at: number;
}

export interface UniverseSymbolPerturbationsResult {
  items: UniverseSymbolPerturbationRow[];
  total: number;
  latest_day: number | null;
}

export interface SocialArbPromotedTopicLedgerItem {
  emerging_id: number;
  concept_key: string;
  display_label: string;
  seed_community: string;
  peak_z_score: number;
  total_mentions: number;
  unique_authors: number;
  authenticity_score: number;
  cross_platform_corroboration: boolean;
  seeded_situation_id: number;
  situation_title: string | null;
  detection_path: string | null;
  status: string | null;
  signal_strength: number | null;
  confidence_score: number | null;
  coverage_tier: string | null;
  validity_flags: string[];
  last_updated_at: number | null;
}

export interface SocialArbPromotedTopicLedger {
  items: SocialArbPromotedTopicLedgerItem[];
  groups: SocialArbPromotedTopicLedgerGroup[];
  candidate_groups: SocialArbCandidateIntelGroup[];
  total: number;
  unique_situations: number;
  compression_ratio: number;
}

export interface SocialArbPromotedTopicLedgerGroup {
  concept_id: number;
  concept_key: string;
  display_label: string;
  seed_community: string;
  pulse_count: number;
  max_z_score: number;
  min_z_score: number;
  max_mentions: number;
  max_unique_authors: number;
  avg_authenticity_score: number;
  cross_platform_pulses: number;
  seeded_situation_id: number;
  situation_title: string | null;
  detection_path: string | null;
  status: string | null;
  signal_strength: number | null;
  confidence_score: number | null;
  coverage_tier: string | null;
  validity_flags: string[];
  last_updated_at: number | null;
  hunting_fit_score: number;
  source_breadth: number;
  evidence_hits_7d: number;
  real_use_hits_7d: number;
  ticker_specific_hits_7d: number;
  watch_tickers: string[];
  hunting_flags: string[];
}

export interface SocialArbCandidateIntelGroup {
  concept_id: number;
  concept_key: string;
  display_label: string;
  top_community: string;
  source_breadth: number;
  source_type_breadth: number;
  total_mentions_7d: number;
  max_daily_mentions: number;
  max_unique_authors: number;
  latest_posted_at: number | null;
  cross_platform: boolean;
  hunting_fit_score: number;
  evidence_hits_7d: number;
  real_use_hits_7d: number;
  ticker_specific_hits_7d: number;
  watch_tickers: string[];
  hunting_flags: string[];
  diagnosis: string;
}

export function getSocialArbEngineAudit(windowDays = 7): SocialArbEngineAudit {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const days = Math.min(Math.max(asInt(windowDays, 7), 1), 30);
  const since = now - days * 86400;

  const rawRow = db
    .prepare(
      `SELECT
         COUNT(*) AS raw_hits,
         SUM(
           CASE
             WHEN matched_concept_ids_json IS NOT NULL
              AND matched_concept_ids_json NOT IN ('', '[]')
             THEN 1 ELSE 0
           END
         ) AS matched_hits
       FROM mi_raw_hits
       WHERE posted_at >= ?
         AND source_community NOT LIKE 'macro:%'`,
    )
    .get(since) as { raw_hits: number; matched_hits: number | null };

  const conceptRows = db
    .prepare(
      `SELECT status, COUNT(*) AS c
       FROM tracked_concepts
       GROUP BY status`,
    )
    .all() as Array<{ status: string; c: number }>;
  const tracked = { total: 0, active: 0, pruned: 0, merged: 0 };
  for (const row of conceptRows) {
    const c = asInt(row.c);
    tracked.total += c;
    if (row.status === 'active') tracked.active = c;
    else if (row.status === 'pruned') tracked.pruned = c;
    else if (row.status === 'merged') tracked.merged = c;
  }

  const emergingRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN seeded_situation_id IS NULL AND suppression_reason IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN seeded_situation_id IS NOT NULL THEN 1 ELSE 0 END) AS promoted,
         SUM(CASE WHEN suppression_reason IS NOT NULL THEN 1 ELSE 0 END) AS suppressed,
         SUM(CASE WHEN cross_platform_corroboration = 1 THEN 1 ELSE 0 END) AS cross_platform
       FROM emerging_topics et
       JOIN tracked_concepts tc ON tc.id = et.concept_id
       WHERE tc.status = 'active'`,
    )
    .get() as Record<string, number | null>;
  const promotedEvents = asInt(emergingRow.promoted);

  const cardRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN ms.detection_path = 'topic_anomaly' THEN ms.id END) AS pure_social,
         COUNT(DISTINCT CASE WHEN ms.detection_path = 'mixed_anomaly_led' THEN ms.id END) AS mixed_social_macro,
         COUNT(DISTINCT CASE
           WHEN ms.detection_path IN ('topic_anomaly', 'mixed_anomaly_led')
            AND ms.status != 'INVALIDATED'
           THEN ms.id END) AS active_visible
       FROM market_situations ms
       JOIN emerging_topics et ON et.seeded_situation_id = ms.id
       JOIN tracked_concepts tc ON tc.id = et.concept_id
       WHERE tc.status = 'active'`,
    )
    .get() as Record<string, number | null>;
  const promotedCardRow = db
    .prepare(
      `SELECT COUNT(DISTINCT seeded_situation_id) AS c
       FROM emerging_topics et
       JOIN tracked_concepts tc ON tc.id = et.concept_id
       WHERE et.seeded_situation_id IS NOT NULL
         AND tc.status = 'active'`,
    )
    .get() as { c: number | null };
  const uniquePromotedCards = asInt(promotedCardRow.c);

  const sourceRows = db
    .prepare(
      `SELECT
         source_type,
         source_community,
         COUNT(*) AS raw_hits_7d,
         SUM(
           CASE
             WHEN matched_concept_ids_json IS NOT NULL
              AND matched_concept_ids_json NOT IN ('', '[]')
             THEN 1 ELSE 0
           END
         ) AS matched_hits_7d,
         MAX(posted_at) AS latest_posted_at
       FROM mi_raw_hits
       WHERE posted_at >= ?
         AND source_community NOT LIKE 'macro:%'
       GROUP BY source_type, source_community
       ORDER BY raw_hits_7d DESC
       LIMIT 20`,
    )
    .all(since) as Array<{
      source_type: string;
      source_community: string;
      raw_hits_7d: number;
      matched_hits_7d: number | null;
      latest_posted_at: number | null;
    }>;

  return {
    as_of: now,
    window_days: days,
    raw_hits_7d: asInt(rawRow.raw_hits),
    matched_hits_7d: asInt(rawRow.matched_hits),
    tracked_concepts: tracked,
    emerging_topics: {
      total: asInt(emergingRow.total),
      pending: asInt(emergingRow.pending),
      promoted_spike_events: promotedEvents,
      unique_promoted_cards: uniquePromotedCards,
      repeated_pulses: Math.max(0, promotedEvents - uniquePromotedCards),
      suppressed: asInt(emergingRow.suppressed),
      cross_platform: asInt(emergingRow.cross_platform),
    },
    social_cards: {
      pure_social: asInt(cardRow.pure_social),
      mixed_social_macro: asInt(cardRow.mixed_social_macro),
      active_visible: asInt(cardRow.active_visible),
    },
    sources: sourceRows.map((row) => ({
      source_type: String(row.source_type),
      source_community: String(row.source_community),
      raw_hits_7d: asInt(row.raw_hits_7d),
      matched_hits_7d: asInt(row.matched_hits_7d),
      latest_posted_at: asNumberOrNull(row.latest_posted_at),
    })),
  };
}

export function listUniverseSymbolPerturbations(
  limitValue = 50,
): UniverseSymbolPerturbationsResult {
  const db = getDb();
  const tableRow = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'universe_symbol_perturbations'`,
    )
    .get() as { name?: string } | undefined;
  if (!tableRow) {
    return { items: [], total: 0, latest_day: null };
  }

  const limit = Math.min(Math.max(asInt(limitValue, 50), 1), 250);
  const latestRow = db
    .prepare(`SELECT MAX(day) AS latest_day FROM universe_symbol_perturbations`)
    .get() as { latest_day: number | null };
  const latestDay = asNumberOrNull(latestRow.latest_day);
  if (latestDay == null) {
    return { items: [], total: 0, latest_day: null };
  }

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM universe_symbol_perturbations
       WHERE day = ?`,
    )
    .get(latestDay) as { c: number };

  const rows = db
    .prepare(
      `SELECT
         symbol, source_type, source_community, day,
         mention_count, baseline_mean, baseline_stdev,
         z_score, velocity_ratio, unique_authors,
         discovery_count, confirmation_count,
         perturbation_score, updated_at
       FROM universe_symbol_perturbations
       WHERE day = ?
       ORDER BY perturbation_score DESC, z_score DESC, mention_count DESC
       LIMIT ?`,
    )
    .all(latestDay, limit) as UniverseSymbolPerturbationRow[];

  return {
    items: rows.map((row) => ({
      symbol: String(row.symbol || ''),
      source_type: String(row.source_type || ''),
      source_community: String(row.source_community || ''),
      day: asInt(row.day),
      mention_count: asInt(row.mention_count),
      baseline_mean: Number(row.baseline_mean || 0),
      baseline_stdev: Number(row.baseline_stdev || 0),
      z_score: Number(row.z_score || 0),
      velocity_ratio: Number(row.velocity_ratio || 0),
      unique_authors: asInt(row.unique_authors),
      discovery_count: asInt(row.discovery_count),
      confirmation_count: asInt(row.confirmation_count),
      perturbation_score: Number(row.perturbation_score || 0),
      updated_at: asInt(row.updated_at),
    })),
    total: asInt(totalRow.c),
    latest_day: latestDay,
  };
}

export function listSocialArbPromotedTopicLedger(
  limitValue = 200,
  includePruned = false,
): SocialArbPromotedTopicLedger {
  const db = getDb();
  const limit = Math.min(Math.max(asInt(limitValue, 200), 1), 500);
  const conceptStatusFilter = includePruned ? '' : "AND tc.status = 'active'";
  const rows = db
    .prepare(
      `SELECT
         et.id AS emerging_id,
         et.concept_id,
         tc.concept_key,
         tc.display_label,
         tc.metadata_json,
         et.seed_community,
         et.peak_z_score,
         et.total_mentions,
         et.unique_authors,
         et.authenticity_score,
         et.cross_platform_corroboration,
         et.seeded_situation_id,
         ms.title AS situation_title,
         ms.detection_path,
         ms.status,
         ms.signal_strength,
         ms.confidence_score,
         ms.coverage_tier,
         ms.validity_flags_json,
         ms.last_updated_at
       FROM emerging_topics et
       JOIN tracked_concepts tc ON tc.id = et.concept_id
       LEFT JOIN market_situations ms ON ms.id = et.seeded_situation_id
       WHERE et.seeded_situation_id IS NOT NULL
       ${conceptStatusFilter}
       ORDER BY et.seeded_situation_id DESC, et.id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      emerging_id: number;
      concept_id: number;
      concept_key: string;
      display_label: string;
      metadata_json: string | null;
      seed_community: string;
      peak_z_score: number;
      total_mentions: number;
      unique_authors: number;
      authenticity_score: number;
      cross_platform_corroboration: number;
      seeded_situation_id: number;
      situation_title: string | null;
      detection_path: string | null;
      status: string | null;
      signal_strength: number | null;
      confidence_score: number | null;
      coverage_tier: string | null;
      validity_flags_json: string | null;
      last_updated_at: number | null;
    }>;

  const items = rows.map((row) => ({
    emerging_id: asInt(row.emerging_id),
    concept_id: asInt(row.concept_id),
    concept_key: String(row.concept_key),
    display_label: String(row.display_label),
    metadata: parseJsonOrNull<Record<string, unknown>>(row.metadata_json),
    seed_community: String(row.seed_community),
    peak_z_score: asNumber(row.peak_z_score),
    total_mentions: asInt(row.total_mentions),
    unique_authors: asInt(row.unique_authors),
    authenticity_score: asNumber(row.authenticity_score),
    cross_platform_corroboration: asBool(row.cross_platform_corroboration),
    seeded_situation_id: asInt(row.seeded_situation_id),
    situation_title: row.situation_title ? String(row.situation_title) : null,
    detection_path: row.detection_path ? String(row.detection_path) : null,
    status: row.status ? String(row.status) : null,
    signal_strength: asNumberOrNull(row.signal_strength),
    confidence_score: asNumberOrNull(row.confidence_score),
    coverage_tier: row.coverage_tier ? String(row.coverage_tier) : null,
    validity_flags: parseJsonOrNull<string[]>(row.validity_flags_json) ?? [],
    last_updated_at: asNumberOrNull(row.last_updated_at),
  }));

  const situationIds = new Set(items.map((item) => item.seeded_situation_id));
  const uniqueSituations = situationIds.size;
  const evidenceByConcept = loadSocialArbEvidenceFitness(
    Array.from(new Set(items.map((item) => item.concept_id))),
  );
  const groupMap = new Map<string, SocialArbPromotedTopicLedgerGroup>();
  const groupAuthTotals = new Map<string, number>();

  for (const item of items) {
    const groupKey = `${item.concept_key}::${item.seeded_situation_id}`;
    const evidence = evidenceByConcept.get(item.concept_id) || emptySocialArbEvidenceFitness();
    const watchTickers = Array.isArray(item.metadata?.watch_tickers)
      ? item.metadata.watch_tickers.map((ticker) => String(ticker)).filter(Boolean)
      : [];
    const huntingFit = scoreSocialArbHuntingFit(evidence, watchTickers);
    const existing = groupMap.get(groupKey);
    if (!existing) {
      groupMap.set(groupKey, {
        concept_id: item.concept_id,
        concept_key: item.concept_key,
        display_label: item.display_label,
        seed_community: item.seed_community,
        pulse_count: 1,
        max_z_score: item.peak_z_score,
        min_z_score: item.peak_z_score,
        max_mentions: item.total_mentions,
        max_unique_authors: item.unique_authors,
        avg_authenticity_score: item.authenticity_score,
        cross_platform_pulses: item.cross_platform_corroboration ? 1 : 0,
        seeded_situation_id: item.seeded_situation_id,
        situation_title: item.situation_title,
        detection_path: item.detection_path,
        status: item.status,
        signal_strength: item.signal_strength,
        confidence_score: item.confidence_score,
        coverage_tier: item.coverage_tier,
        validity_flags: item.validity_flags,
        last_updated_at: item.last_updated_at,
        hunting_fit_score: huntingFit.score,
        source_breadth: evidence.source_breadth,
        evidence_hits_7d: evidence.evidence_hits_7d,
        real_use_hits_7d: evidence.real_use_hits_7d,
        ticker_specific_hits_7d: evidence.ticker_specific_hits_7d,
        watch_tickers: watchTickers,
        hunting_flags: huntingFit.flags,
      });
      groupAuthTotals.set(groupKey, item.authenticity_score);
      continue;
    }
    existing.pulse_count += 1;
    existing.max_z_score = Math.max(existing.max_z_score, item.peak_z_score);
    existing.min_z_score = Math.min(existing.min_z_score, item.peak_z_score);
    existing.max_mentions = Math.max(existing.max_mentions, item.total_mentions);
    existing.max_unique_authors = Math.max(
      existing.max_unique_authors,
      item.unique_authors,
    );
    existing.cross_platform_pulses += item.cross_platform_corroboration ? 1 : 0;
    const nextAuthTotal =
      (groupAuthTotals.get(groupKey) || 0) + item.authenticity_score;
    groupAuthTotals.set(groupKey, nextAuthTotal);
    existing.avg_authenticity_score = nextAuthTotal / existing.pulse_count;
  }
  const groups = Array.from(groupMap.entries()).map(([key, group]) => {
    const authTotal = groupAuthTotals.get(key) || group.avg_authenticity_score;
    return {
      ...group,
      avg_authenticity_score: group.pulse_count > 0 ? authTotal / group.pulse_count : 0,
    };
  });
  groups.sort((a, b) => b.pulse_count - a.pulse_count || b.max_z_score - a.max_z_score);

  return {
    items,
    groups,
    candidate_groups: listSocialArbCandidateIntelGroups(limit),
    total: items.length,
    unique_situations: uniqueSituations,
    compression_ratio: uniqueSituations > 0 ? items.length / uniqueSituations : 0,
  };
}

function socialArbCommunitySourceType(community: string): string {
  const key = String(community || '').trim().toLowerCase();
  if (!key) return 'unknown';
  if (key.startsWith('stocktwits:')) return 'stocktwits';
  if (key.startsWith('yahoo_finance:')) return 'yahoo_community';
  if (key.startsWith('reddit:')) return 'reddit';
  if (key.startsWith('forum:')) return 'forum';
  if (key.startsWith('/biz/') || key.startsWith('/g/') || key.startsWith('fourchan')) {
    return 'fourchan';
  }
  if (key.startsWith('hackernews')) return 'hackernews';
  if (key.startsWith('youtube:')) return 'youtube';
  if (key.startsWith('bluesky')) return 'bluesky';
  if (key.startsWith('discord:')) return 'discord';
  return key.split(':')[0] || key;
}

function listSocialArbCandidateIntelGroups(limit: number): SocialArbCandidateIntelGroup[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const sinceDay = Math.floor((now - 7 * 86400) / 86400) * 86400;
  const rows = db
    .prepare(
      `SELECT
         tc.id AS concept_id,
         tc.concept_key,
         tc.display_label,
         tc.metadata_json,
         cdc.community,
         SUM(cdc.mention_count) AS total_mentions,
         MAX(cdc.mention_count) AS max_daily_mentions,
         MAX(cdc.unique_authors) AS max_unique_authors
       FROM concept_daily_counts cdc
       JOIN tracked_concepts tc ON tc.id = cdc.concept_id
       WHERE tc.status = 'active'
         AND cdc.day >= ?
       GROUP BY tc.id, cdc.community
       HAVING SUM(cdc.mention_count) >= 5 OR MAX(cdc.unique_authors) >= 5
       ORDER BY total_mentions DESC
       LIMIT ?`,
    )
    .all(sinceDay, Math.max(limit * 8, 100)) as Array<{
      concept_id: number;
      concept_key: string;
      display_label: string;
      metadata_json: string | null;
      community: string;
      total_mentions: number;
      max_daily_mentions: number;
      max_unique_authors: number;
    }>;

  const byConcept = new Map<number, {
    concept_id: number;
    concept_key: string;
    display_label: string;
    metadata_json: string | null;
    total_mentions_7d: number;
    max_daily_mentions: number;
    max_unique_authors: number;
    top_community: string;
    top_community_mentions: number;
    communities: Set<string>;
    source_types: Set<string>;
  }>();

  for (const row of rows) {
    const conceptId = asInt(row.concept_id);
    const mentions = asInt(row.total_mentions);
    const existing = byConcept.get(conceptId);
    if (!existing) {
      const communities = new Set<string>([String(row.community)]);
      byConcept.set(conceptId, {
        concept_id: conceptId,
        concept_key: String(row.concept_key),
        display_label: String(row.display_label),
        metadata_json: row.metadata_json,
        total_mentions_7d: mentions,
        max_daily_mentions: asInt(row.max_daily_mentions),
        max_unique_authors: asInt(row.max_unique_authors),
        top_community: String(row.community),
        top_community_mentions: mentions,
        communities,
        source_types: new Set<string>([socialArbCommunitySourceType(String(row.community))]),
      });
      continue;
    }
    existing.total_mentions_7d += mentions;
    existing.max_daily_mentions = Math.max(existing.max_daily_mentions, asInt(row.max_daily_mentions));
    existing.max_unique_authors = Math.max(existing.max_unique_authors, asInt(row.max_unique_authors));
    existing.communities.add(String(row.community));
    existing.source_types.add(socialArbCommunitySourceType(String(row.community)));
    if (mentions > existing.top_community_mentions) {
      existing.top_community = String(row.community);
      existing.top_community_mentions = mentions;
    }
  }

  const conceptIds = Array.from(byConcept.keys());
  const evidenceByConcept = loadSocialArbEvidenceFitness(conceptIds);
  const latestByConcept = loadSocialArbLatestSeen(conceptIds);

  return Array.from(byConcept.values())
    .map((group) => {
      const metadata = parseJsonOrNull<Record<string, unknown>>(group.metadata_json);
      const watchTickers = Array.isArray(metadata?.watch_tickers)
        ? metadata.watch_tickers.map((ticker) => String(ticker)).filter(Boolean)
        : [];
      const evidence = evidenceByConcept.get(group.concept_id) || emptySocialArbEvidenceFitness();
      const huntingFit = scoreSocialArbHuntingFit(evidence, watchTickers);
      const crossPlatform = group.source_types.size >= 2;
      const diagnosisParts = [
        'candidate intel, not promoted spike yet',
        'baseline warming',
      ];
      if (crossPlatform) diagnosisParts.push('cross-platform evidence present');
      else diagnosisParts.push('single source-type so far');
      if (group.total_mentions_7d >= 50) diagnosisParts.push('meaningful 7d volume');
      if (evidence.real_use_hits_7d > 0) diagnosisParts.push('real-use language found');
      return {
        concept_id: group.concept_id,
        concept_key: group.concept_key,
        display_label: group.display_label,
        top_community: group.top_community,
        source_breadth: group.communities.size,
        source_type_breadth: group.source_types.size,
        total_mentions_7d: group.total_mentions_7d,
        max_daily_mentions: group.max_daily_mentions,
        max_unique_authors: group.max_unique_authors,
        latest_posted_at: latestByConcept.get(group.concept_id) ?? null,
        cross_platform: crossPlatform,
        hunting_fit_score: huntingFit.score,
        evidence_hits_7d: evidence.evidence_hits_7d,
        real_use_hits_7d: evidence.real_use_hits_7d,
        ticker_specific_hits_7d: evidence.ticker_specific_hits_7d,
        watch_tickers: watchTickers,
        hunting_flags: huntingFit.flags,
        diagnosis: diagnosisParts.join(' | '),
      };
    })
    .filter((group) => group.total_mentions_7d >= 10 || group.source_type_breadth >= 2)
    .sort((a, b) => (
      b.hunting_fit_score - a.hunting_fit_score ||
      b.source_type_breadth - a.source_type_breadth ||
      b.total_mentions_7d - a.total_mentions_7d
    ))
    .slice(0, limit);
}

function loadSocialArbLatestSeen(conceptIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  if (conceptIds.length === 0) return result;
  const idSet = new Set(conceptIds);
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = getDb()
    .prepare(
      `SELECT posted_at, matched_concept_ids_json
       FROM mi_raw_hits
       WHERE posted_at >= ?
         AND source_community NOT LIKE 'macro:%'
         AND matched_concept_ids_json IS NOT NULL
         AND matched_concept_ids_json NOT IN ('', '[]')`,
    )
    .all(since) as Array<{
      posted_at: number | null;
      matched_concept_ids_json: string | null;
    }>;

  for (const row of rows) {
    const matched = parseJsonOrNull<number[] | string[]>(
      row.matched_concept_ids_json,
    );
    if (!Array.isArray(matched)) continue;
    const postedAt = asNumberOrNull(row.posted_at);
    if (postedAt == null) continue;
    for (const rawId of matched) {
      const id = Number(rawId);
      if (!idSet.has(id)) continue;
      result.set(id, Math.max(result.get(id) || 0, postedAt));
    }
  }
  return result;
}

interface SocialArbEvidenceFitness {
  source_breadth: number;
  evidence_hits_7d: number;
  real_use_hits_7d: number;
  ticker_specific_hits_7d: number;
}

function emptySocialArbEvidenceFitness(): SocialArbEvidenceFitness {
  return {
    source_breadth: 0,
    evidence_hits_7d: 0,
    real_use_hits_7d: 0,
    ticker_specific_hits_7d: 0,
  };
}

const REAL_USE_RE = /\b(using|buying|switching|switched|customer|customers|adoption|deployed|deployment|procurement|contract|backlog|shortage|sold out|pricing power|new order|new customer|migration|runway|waitlist|renewal|retention|churn)\b/i;
const TICKER_OR_PRODUCT_RE = /(?:\$[A-Z]{1,5}\b|\b[A-Z]{2,5}\b|product|brand|app|platform|tool|device|drug|therapy|system|contract)/;

function loadSocialArbEvidenceFitness(
  conceptIds: number[],
): Map<number, SocialArbEvidenceFitness> {
  const result = new Map<number, SocialArbEvidenceFitness>();
  if (conceptIds.length === 0) return result;
  const idSet = new Set(conceptIds);
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = getDb()
    .prepare(
      `SELECT source_community, title, body_text, matched_concept_ids_json
       FROM mi_raw_hits
       WHERE posted_at >= ?
         AND source_community NOT LIKE 'macro:%'
         AND matched_concept_ids_json IS NOT NULL
         AND matched_concept_ids_json NOT IN ('', '[]')`,
    )
    .all(since) as Array<{
      source_community: string;
      title: string | null;
      body_text: string | null;
      matched_concept_ids_json: string | null;
    }>;

  const sourceSets = new Map<number, Set<string>>();
  for (const row of rows) {
    const matched = parseJsonOrNull<number[] | string[]>(
      row.matched_concept_ids_json,
    );
    if (!Array.isArray(matched)) continue;
    const text = `${row.title || ''} ${row.body_text || ''}`;
    for (const rawId of matched) {
      const id = Number(rawId);
      if (!idSet.has(id)) continue;
      const stats = result.get(id) || emptySocialArbEvidenceFitness();
      stats.evidence_hits_7d += 1;
      if (REAL_USE_RE.test(text)) stats.real_use_hits_7d += 1;
      if (TICKER_OR_PRODUCT_RE.test(text)) stats.ticker_specific_hits_7d += 1;
      result.set(id, stats);
      const sources = sourceSets.get(id) || new Set<string>();
      sources.add(String(row.source_community || 'unknown'));
      sourceSets.set(id, sources);
    }
  }

  for (const [id, stats] of result.entries()) {
    stats.source_breadth = sourceSets.get(id)?.size || 0;
  }
  return result;
}

function scoreSocialArbHuntingFit(
  evidence: SocialArbEvidenceFitness,
  watchTickers: string[],
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  if (watchTickers.length > 0) score += 25;
  else flags.push('NO_TICKER_EXPOSURE');

  if (evidence.source_breadth >= 3) score += 30;
  else if (evidence.source_breadth >= 2) score += 18;
  else flags.push('SINGLE_SOURCE_DOMINATED');

  if (evidence.real_use_hits_7d >= 5) score += 25;
  else if (evidence.real_use_hits_7d >= 1) score += 12;
  else flags.push('NO_REAL_USE_LANGUAGE');

  if (evidence.ticker_specific_hits_7d >= 5) score += 20;
  else if (evidence.ticker_specific_hits_7d >= 1) score += 10;
  else flags.push('NO_COMPANY_OR_PRODUCT_SPECIFICITY');

  if (score >= 70) flags.push('HUNTING_FIT_STRONG');
  else if (score >= 45) flags.push('HUNTING_FIT_WATCH');
  else flags.push('HUNTING_FIT_WEAK');

  return { score, flags };
}

export type NarrativeClusterStatus =
  | 'WATCH'
  | 'RESEARCH'
  | 'SCENARIO_READY'
  | 'PROMOTED'
  | 'INVALIDATED'
  | 'ARCHIVED';

export interface NarrativeClusterListQuery {
  status?: NarrativeClusterStatus | 'all';
  primary_theme?: string;
  limit?: number;
}

export interface ApiNarrativeClusterItem {
  id: number;
  slug: string;
  title: string;
  summary: string;
  primary_theme: string | null;
  status: NarrativeClusterStatus | string;
  source_breadth: number;
  attention_velocity: number | null;
  novelty_score: number | null;
  mainstream_coverage_score: number | null;
  undercoverage_score: number | null;
  authenticity_score: number | null;
  tradable_exposure_status: string;
  verification_status: string;
  mapped_tickers: string[];
  validity_flags: string[];
  promotion_situation_id: number | null;
  metadata: Record<string, unknown> | null;
  claim_count: number;
  source_hit_count: number;
  source_types: string[];
  first_seen_at: number;
  last_seen_at: number;
  updated_at: number;
}

export interface ApiNarrativeClaimItem {
  id: number;
  claim_text: string;
  claim_type: string;
  confidence: number;
  verification_status: string;
  validity_flags: string[];
  detected_tickers: string[];
  detected_themes: string[];
  source_hit_ids: number[];
  relationship: string;
  weight: number;
  first_seen_at: number;
  last_seen_at: number;
}

export interface ApiNarrativeClusterDetail extends ApiNarrativeClusterItem {
  claims: ApiNarrativeClaimItem[];
}

interface RawNarrativeClusterRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  primary_theme: string | null;
  status: string;
  source_breadth: number;
  attention_velocity: number | null;
  novelty_score: number | null;
  mainstream_coverage_score: number | null;
  undercoverage_score: number | null;
  authenticity_score: number | null;
  tradable_exposure_status: string;
  verification_status: string;
  mapped_tickers_json: string | null;
  validity_flags_json: string | null;
  promotion_situation_id: number | null;
  metadata_json: string | null;
  first_seen_at: number;
  last_seen_at: number;
  updated_at: number;
  claim_count?: number | null;
}

interface RawNarrativeClaimRow {
  id: number;
  claim_text: string;
  claim_type: string;
  source_hit_ids_json: string | null;
  detected_tickers_json: string | null;
  detected_themes_json: string | null;
  confidence: number;
  verification_status: string;
  validity_flags_json: string | null;
  first_seen_at: number;
  last_seen_at: number;
  relationship: string;
  weight: number;
}

function parseStringArrayJson(value: unknown): string[] {
  const parsed = parseJsonOrNull<unknown[]>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((v) => String(v)).filter(Boolean);
}

function parseNumberArrayJson(value: unknown): number[] {
  const parsed = parseJsonOrNull<unknown[]>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.trunc(v));
}

function decodeNarrativeClusterRow(
  row: RawNarrativeClusterRow,
): ApiNarrativeClusterItem {
  const metadata = parseJsonOrNull<Record<string, unknown>>(row.metadata_json);
  const sourceHitIds = Array.isArray(metadata?.source_hit_ids)
    ? metadata.source_hit_ids
    : [];
  const metadataSourceCount = asInt(metadata?.source_hit_count, 0);
  const sourceHitCount = metadataSourceCount || sourceHitIds.length;
  const sourceTypes = Array.isArray(metadata?.source_types)
    ? metadata.source_types.map((v) => String(v)).filter(Boolean)
    : [];

  return {
    id: asInt(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    primary_theme: asStringOrNull(row.primary_theme),
    status: String(row.status) as NarrativeClusterStatus,
    source_breadth: asNumber(row.source_breadth),
    attention_velocity: asNumberOrNull(row.attention_velocity),
    novelty_score: asNumberOrNull(row.novelty_score),
    mainstream_coverage_score: asNumberOrNull(row.mainstream_coverage_score),
    undercoverage_score: asNumberOrNull(row.undercoverage_score),
    authenticity_score: asNumberOrNull(row.authenticity_score),
    tradable_exposure_status: String(row.tradable_exposure_status || 'unknown'),
    verification_status: String(row.verification_status || 'unverified'),
    mapped_tickers: parseStringArrayJson(row.mapped_tickers_json),
    validity_flags: parseStringArrayJson(row.validity_flags_json),
    promotion_situation_id: asNumberOrNull(row.promotion_situation_id),
    metadata,
    claim_count: asInt(row.claim_count, 0),
    source_hit_count: sourceHitCount,
    source_types: sourceTypes,
    first_seen_at: asInt(row.first_seen_at),
    last_seen_at: asInt(row.last_seen_at),
    updated_at: asInt(row.updated_at),
  };
}

function decodeNarrativeClaimRow(row: RawNarrativeClaimRow): ApiNarrativeClaimItem {
  return {
    id: asInt(row.id),
    claim_text: String(row.claim_text),
    claim_type: String(row.claim_type),
    confidence: asNumber(row.confidence),
    verification_status: String(row.verification_status || 'unverified'),
    validity_flags: parseStringArrayJson(row.validity_flags_json),
    detected_tickers: parseStringArrayJson(row.detected_tickers_json),
    detected_themes: parseStringArrayJson(row.detected_themes_json),
    source_hit_ids: parseNumberArrayJson(row.source_hit_ids_json),
    relationship: String(row.relationship || 'supporting'),
    weight: asNumber(row.weight, 1),
    first_seen_at: asInt(row.first_seen_at),
    last_seen_at: asInt(row.last_seen_at),
  };
}

export function listNarrativeClusters(
  query: NarrativeClusterListQuery = {},
): { items: ApiNarrativeClusterItem[]; total: number; applied_filters: NarrativeClusterListQuery } {
  const db = getDb();
  const wheres: string[] = ['nc.archived_at IS NULL'];
  const params: unknown[] = [];

  if (query.status && query.status !== 'all') {
    wheres.push('nc.status = ?');
    params.push(String(query.status));
  }

  if (query.primary_theme) {
    wheres.push('nc.primary_theme = ?');
    params.push(String(query.primary_theme));
  }

  const where = `WHERE ${wheres.join(' AND ')}`;
  const limit = Math.min(Math.max(asInt(query.limit, 100), 1), 500);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM narrative_clusters nc ${where}`)
    .get(...params) as { c: number };
  const total = asInt(totalRow.c, 0);

  const rows = db
    .prepare(
      `SELECT
         nc.id, nc.slug, nc.title, nc.summary, nc.primary_theme, nc.status,
         nc.source_breadth, nc.attention_velocity, nc.novelty_score,
         nc.mainstream_coverage_score, nc.undercoverage_score,
         nc.authenticity_score, nc.tradable_exposure_status,
         nc.verification_status, nc.mapped_tickers_json,
         nc.validity_flags_json, nc.promotion_situation_id,
         nc.metadata_json, nc.first_seen_at, nc.last_seen_at, nc.updated_at,
         COUNT(ncc.claim_id) AS claim_count
       FROM narrative_clusters nc
       LEFT JOIN narrative_cluster_claims ncc ON ncc.cluster_id = nc.id
       ${where}
       GROUP BY nc.id
       ORDER BY
         CASE nc.status
           WHEN 'SCENARIO_READY' THEN 0
           WHEN 'RESEARCH' THEN 1
           WHEN 'WATCH' THEN 2
           WHEN 'PROMOTED' THEN 3
           ELSE 4
         END,
         nc.updated_at DESC,
         nc.id DESC
       LIMIT ?`,
    )
    .all(...params, limit) as RawNarrativeClusterRow[];

  return {
    items: rows.map(decodeNarrativeClusterRow),
    total,
    applied_filters: query,
  };
}

export function getNarrativeClusterDetail(
  id: number,
): ApiNarrativeClusterDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         nc.id, nc.slug, nc.title, nc.summary, nc.primary_theme, nc.status,
         nc.source_breadth, nc.attention_velocity, nc.novelty_score,
         nc.mainstream_coverage_score, nc.undercoverage_score,
         nc.authenticity_score, nc.tradable_exposure_status,
         nc.verification_status, nc.mapped_tickers_json,
         nc.validity_flags_json, nc.promotion_situation_id,
         nc.metadata_json, nc.first_seen_at, nc.last_seen_at, nc.updated_at,
         COUNT(ncc.claim_id) AS claim_count
       FROM narrative_clusters nc
       LEFT JOIN narrative_cluster_claims ncc ON ncc.cluster_id = nc.id
      WHERE nc.id = ? AND nc.archived_at IS NULL
      GROUP BY nc.id`,
    )
    .get(id) as RawNarrativeClusterRow | undefined;

  if (!row) return null;

  const claims = db
    .prepare(
      `SELECT
         ec.id, ec.claim_text, ec.claim_type, ec.source_hit_ids_json,
         ec.detected_tickers_json, ec.detected_themes_json, ec.confidence,
         ec.verification_status, ec.validity_flags_json,
         ec.first_seen_at, ec.last_seen_at,
         ncc.relationship, ncc.weight
       FROM narrative_cluster_claims ncc
       JOIN emerging_claims ec ON ec.id = ncc.claim_id
      WHERE ncc.cluster_id = ?
      ORDER BY ncc.weight DESC, ec.last_seen_at DESC, ec.id DESC`,
    )
    .all(id) as RawNarrativeClaimRow[];

  return {
    ...decodeNarrativeClusterRow(row),
    claims: claims.map(decodeNarrativeClaimRow),
  };
}

// ----------------------------------------------------------------------------
// emerging_topics/:id/authenticity — per-signal breakdown
// ----------------------------------------------------------------------------

export interface ApiAuthenticityBreakdown {
  emerging_topic_id: number;
  authenticity_score: number;
  computed_at: number;
  signals: Array<{
    type: AuthenticitySignalType;
    value: number;
    weight: number;
    notes: string | null;
  }>;
  hard_limits_triggered: string[];
  suppression_reason: SuppressionReason | null;
  schema_version: number;
}

interface RawAuthenticitySignalRow {
  emerging_topic_id: number;
  as_of: number;
  signal_type: string;
  signal_value: number;
  weight: number;
  notes: string | null;
}

interface RawEmergingTopicSummaryRow {
  id: number;
  authenticity_score: number;
  authenticity_signals_json: string | null;
  suppression_reason: string | null;
  updated_at: number;
}

/**
 * Returns the authenticity audit for a single emerging topic. Signals are
 * sourced from `authenticity_signals` (the audit-trail table) — falling back
 * to `emerging_topics.authenticity_signals_json` only when no audit row
 * exists for the topic yet (older rows produced before the scorer wrote
 * audit history).
 *
 * `as_of` filters to the most-recent audit batch ≤ the requested timestamp.
 */
export function getEmergingTopicAuthenticity(
  emergingTopicId: number,
  asOf?: number,
): ApiAuthenticityBreakdown | null {
  const db = getDb();
  const summary = db
    .prepare(
      `SELECT id, authenticity_score, authenticity_signals_json,
              suppression_reason, updated_at
         FROM emerging_topics
        WHERE id = ?`,
    )
    .get(emergingTopicId) as RawEmergingTopicSummaryRow | undefined;

  if (!summary) return null;

  // Pick the latest audit batch (max as_of) or the latest ≤ as_of when
  // bounded. Authenticity signals get inserted as a batch sharing the
  // same as_of, so we filter to that batch once we know the cutoff.
  const params: unknown[] = [emergingTopicId];
  let asOfClause = '';
  if (typeof asOf === 'number' && Number.isFinite(asOf)) {
    asOfClause = ' AND as_of <= ?';
    params.push(asOf);
  }
  const latestRow = db
    .prepare(
      `SELECT MAX(as_of) AS max_as_of
         FROM authenticity_signals
        WHERE emerging_topic_id = ?${asOfClause}`,
    )
    .get(...params) as { max_as_of: number | null };

  let signals: Array<{
    type: AuthenticitySignalType;
    value: number;
    weight: number;
    notes: string | null;
  }> = [];
  let computedAt: number = asInt(summary.updated_at);
  let hardLimits: string[] = [];

  if (latestRow.max_as_of != null) {
    computedAt = asInt(latestRow.max_as_of);
    const rows = db
      .prepare(
        `SELECT emerging_topic_id, as_of, signal_type, signal_value, weight, notes
           FROM authenticity_signals
          WHERE emerging_topic_id = ? AND as_of = ?
          ORDER BY signal_type ASC`,
      )
      .all(emergingTopicId, computedAt) as RawAuthenticitySignalRow[];
    signals = rows.map((r) => ({
      type: String(r.signal_type) as AuthenticitySignalType,
      value: asNumber(r.signal_value),
      weight: asNumber(r.weight),
      notes: asStringOrNull(r.notes),
    }));
    // Hard-limit rows are stored with notes prefixed `HL_` per the scorer
    // contract. Lift them out so the UI can render the chip separately.
    hardLimits = rows
      .filter((r) => String(r.signal_type).startsWith('HL_'))
      .map((r) => String(r.signal_type));
  } else {
    // Fallback: read the snapshot blob on emerging_topics. This path covers
    // topics scored before the audit table was wired up (or imported from
    // a fixture). No hard-limit info is available on the snapshot path.
    const snapshot =
      parseJsonOrNull<AuthenticitySignalSnapshot[]>(summary.authenticity_signals_json) ?? [];
    signals = snapshot.map((s) => ({
      type: s.signal_type,
      value: s.signal_value,
      weight: s.weight,
      notes: s.notes ?? null,
    }));
  }

  return {
    emerging_topic_id: asInt(summary.id),
    authenticity_score: asNumber(summary.authenticity_score),
    computed_at: computedAt,
    signals,
    hard_limits_triggered: hardLimits,
    suppression_reason: summary.suppression_reason
      ? (String(summary.suppression_reason) as SuppressionReason)
      : null,
    schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
  };
}

// ----------------------------------------------------------------------------
// coverage_tiers/:symbol — single-row cached classification
// ----------------------------------------------------------------------------

interface RawCoverageTierRow {
  symbol: string;
  coverage_tier: string;
  sellside_analyst_count: number | null;
  market_cap_usd: number | null;
  institutional_ownership_pct: number | null;
  mainstream_mention_count_90d: number | null;
  daily_dollar_volume_avg: number | null;
  composite_score: number | null;
  as_of: number;
}

export function getCoverageTierForSymbol(
  symbol: string,
): ApiCoverageTierItem | null {
  const cleaned = String(symbol || '').trim().toUpperCase();
  if (!cleaned) return null;

  const row = getDb()
    .prepare(
      `SELECT symbol, coverage_tier, sellside_analyst_count, market_cap_usd,
              institutional_ownership_pct, mainstream_mention_count_90d,
              daily_dollar_volume_avg, composite_score, as_of
         FROM coverage_tiers
        WHERE symbol = ?`,
    )
    .get(cleaned) as RawCoverageTierRow | undefined;

  if (!row) return null;

  const tier = String(row.coverage_tier) as CoverageTier;

  return {
    symbol: String(row.symbol),
    coverage_tier: tier,
    sellside_analyst_count: asNumberOrNull(row.sellside_analyst_count),
    market_cap_usd: asNumberOrNull(row.market_cap_usd),
    institutional_ownership_pct: asNumberOrNull(row.institutional_ownership_pct),
    mainstream_mention_count_90d: asNumberOrNull(row.mainstream_mention_count_90d),
    daily_dollar_volume_avg: asNumberOrNull(row.daily_dollar_volume_avg),
    composite_score: asNumberOrNull(row.composite_score),
    as_of: asInt(row.as_of),
    edge_multiplier: edgeMultiplierForTier(tier),
  };
}

// ----------------------------------------------------------------------------
// tracked_concepts — Operator UI list + status-update helpers (PRD D08).
//
// Status semantics:
//   - 'active'  : default; emerging-topic engine + promoter consider this concept
//   - 'pruned'  : operator marked irrelevant / spam; engine should ignore.
//                 Stored as a status string (no FK constraint, just a text label).
//   - 'merged'  : operator merged this concept into another. The canonical
//                 partner concept_id is recorded in metadata_json.merged_into_id
//                 + metadata_json.merged_at.
// ----------------------------------------------------------------------------

export type TrackedConceptStatus = 'active' | 'pruned' | 'merged';

const TRACKED_CONCEPT_STATUSES: ReadonlySet<TrackedConceptStatus> = new Set([
  'active',
  'pruned',
  'merged',
]);

export interface ApiTrackedConceptItem {
  id: number;
  concept_key: string;
  target_type: TargetType;
  target_key: string;
  display_label: string;
  created_at: number;
  created_by: 'llm_extractor' | 'operator' | 'seed_taxonomy';
  status: TrackedConceptStatus | string;
  metadata_json: Record<string, unknown> | null;
  /** Read off `concept_daily_counts` so the operator can see whether the
   *  concept is producing live signal before pruning it. Cheap rollup. */
  rolling_28d_hits: number;
  /** Most recent posted_at across mi_raw_hits.matched_concept_ids_json. */
  last_seen_at: number | null;
}

interface RawTrackedConceptListRow {
  id: number;
  concept_key: string;
  target_type: string;
  target_key: string;
  display_label: string;
  created_at: number;
  created_by: string;
  status: string;
  metadata_json: string | null;
  rolling_28d_hits: number | null;
  last_seen_at: number | null;
}

export interface TrackedConceptListQuery {
  status?: TrackedConceptStatus | 'all';
  target_type?: TargetType;
  search?: string;
  limit?: number;
}

export function listTrackedConcepts(
  query: TrackedConceptListQuery = {},
): { items: ApiTrackedConceptItem[]; total: number } {
  const db = getDb();

  const wheres: string[] = [];
  const params: unknown[] = [];

  if (query.status && query.status !== 'all') {
    wheres.push('tc.status = ?');
    params.push(String(query.status));
  }
  if (query.target_type) {
    wheres.push('tc.target_type = ?');
    params.push(String(query.target_type));
  }
  if (query.search) {
    const like = `%${String(query.search).toLowerCase()}%`;
    wheres.push(
      '(LOWER(tc.concept_key) LIKE ? OR LOWER(tc.display_label) LIKE ? OR LOWER(tc.target_key) LIKE ?)',
    );
    params.push(like, like, like);
  }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const limit = Math.min(Math.max(asInt(query.limit, 100), 1), 1000);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM tracked_concepts tc ${where}`)
    .get(...params) as { c: number };
  const total = asInt(totalRow.c, 0);

  // 28-day window measured from "now" so the rollup updates organically.
  // SQLite has no `time()` we can rely on cross-platform inside the prepared
  // statement, so we compute the cutoff in JS and pass it as a param.
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff28d = nowSec - 28 * 24 * 60 * 60;

  const rows = db
    .prepare(
      `SELECT
         tc.id, tc.concept_key, tc.target_type, tc.target_key,
         tc.display_label, tc.created_at, tc.created_by, tc.status,
         tc.metadata_json,
         (SELECT COALESCE(SUM(cdc.mention_count), 0)
            FROM concept_daily_counts cdc
           WHERE cdc.concept_id = tc.id
             AND cdc.day >= ?) AS rolling_28d_hits,
         (SELECT MAX(cdc2.day)
            FROM concept_daily_counts cdc2
           WHERE cdc2.concept_id = tc.id) AS last_seen_at
       FROM tracked_concepts tc
       ${where}
       ORDER BY tc.created_at DESC, tc.id DESC
       LIMIT ?`,
    )
    .all(cutoff28d, ...params, limit) as RawTrackedConceptListRow[];

  return {
    items: rows.map((r) => ({
      id: asInt(r.id),
      concept_key: String(r.concept_key),
      target_type: String(r.target_type) as TargetType,
      target_key: String(r.target_key),
      display_label: String(r.display_label),
      created_at: asInt(r.created_at),
      created_by:
        (String(r.created_by) as ApiTrackedConceptItem['created_by']) ||
        'llm_extractor',
      status: String(r.status),
      metadata_json: parseJsonOrNull<Record<string, unknown>>(r.metadata_json),
      rolling_28d_hits: asInt(r.rolling_28d_hits, 0),
      last_seen_at: r.last_seen_at == null ? null : asInt(r.last_seen_at),
    })),
    total,
  };
}

export interface TrackedConceptStatusUpdate {
  status: TrackedConceptStatus;
  /** Required when status === 'merged'. Must be a different existing concept id. */
  merged_into_id?: number | null;
  /** Free-form audit reason; persisted into metadata_json.last_status_change.reason */
  reason?: string | null;
  /** Operator handle / user id for audit; defaults to 'operator'. */
  actor?: string | null;
}

export interface TrackedConceptStatusResult {
  id: number;
  status: TrackedConceptStatus;
  metadata_json: Record<string, unknown>;
  updated_at: number;
}

export function updateTrackedConceptStatus(
  id: number,
  update: TrackedConceptStatusUpdate,
): TrackedConceptStatusResult {
  const conceptId = asInt(id, 0);
  if (!conceptId || conceptId < 1) {
    throw new Error('Invalid tracked_concept id');
  }
  if (!TRACKED_CONCEPT_STATUSES.has(update.status)) {
    throw new Error(
      `status must be one of: ${[...TRACKED_CONCEPT_STATUSES].join(', ')}`,
    );
  }
  if (update.status === 'merged') {
    if (update.merged_into_id == null) {
      throw new Error('merged_into_id is required when status="merged"');
    }
    if (asInt(update.merged_into_id, 0) === conceptId) {
      throw new Error('merged_into_id must reference a different concept');
    }
  }

  const db = getDb();

  const existing = db
    .prepare(
      `SELECT id, status, metadata_json
         FROM tracked_concepts
        WHERE id = ?`,
    )
    .get(conceptId) as
    | { id: number; status: string; metadata_json: string | null }
    | undefined;

  if (!existing) {
    throw new Error(`tracked_concept id=${conceptId} not found`);
  }

  // Validate merged_into_id exists.
  if (update.status === 'merged') {
    const target = db
      .prepare('SELECT id FROM tracked_concepts WHERE id = ?')
      .get(asInt(update.merged_into_id, 0)) as { id: number } | undefined;
    if (!target) {
      throw new Error(
        `merged_into_id=${update.merged_into_id} does not reference an existing concept`,
      );
    }
  }

  const meta =
    parseJsonOrNull<Record<string, unknown>>(existing.metadata_json) || {};
  const nowSec = Math.floor(Date.now() / 1000);

  const audit = {
    from_status: String(existing.status),
    to_status: update.status,
    actor: (update.actor || 'operator').toString(),
    reason: update.reason ? String(update.reason) : null,
    at: nowSec,
  };

  const history = Array.isArray(meta.status_history)
    ? (meta.status_history as unknown[]).slice(-19)
    : [];
  history.push(audit);
  meta.status_history = history;
  meta.last_status_change = audit;

  if (update.status === 'merged') {
    meta.merged_into_id = asInt(update.merged_into_id, 0);
    meta.merged_at = nowSec;
  } else {
    delete meta.merged_into_id;
    delete meta.merged_at;
  }

  const metadataJson = JSON.stringify(meta);

  db.prepare(
    `UPDATE tracked_concepts
        SET status = ?, metadata_json = ?
      WHERE id = ?`,
  ).run(update.status, metadataJson, conceptId);

  return {
    id: conceptId,
    status: update.status,
    metadata_json: meta,
    updated_at: nowSec,
  };
}

// ----------------------------------------------------------------------------
// QUALITY DASHBOARD — reads from scenario_outcomes + theme_quality_snapshots
// (created by run_forward_tracking.py)
// ----------------------------------------------------------------------------

export interface QualityThemeSnapshot {
  primary_theme: string;
  detection_path: string | null;
  total_scenarios: number;
  scenarios_tracked: number;
  avg_forward_return: number;
  direction_hit_rate: number;
  avg_mfe: number;
  avg_mae: number;
  avg_composite_rank: number;
  avg_scenario_age: number;
  top_winners: Array<{ s: string; r: number }>;
  top_losers: Array<{ s: string; r: number }>;
  snapshot_date: string;
}

export interface ScenarioOutcome {
  situation_id: number;
  symbol: string;
  exposure_direction: string;
  composite_rank: number;
  forward_return_pct: number;
  max_favorable_pct: number;
  max_adverse_pct: number;
  direction_hit: boolean;
  days_tracked: number;
  scenario_age_days: number;
  primary_theme: string;
  detection_path: string;
  scenario_status: string;
  scenario_title: string | null;
  scenario_summary: string | null;
  outcome_label: string | null;
  operator_label: string | null;
}

export function getQualityDashboard(): QualityThemeSnapshot[] {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT * FROM theme_quality_snapshots
         ORDER BY snapshot_date DESC, total_scenarios DESC
         LIMIT 200`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      primary_theme: String(r.primary_theme),
      detection_path: r.detection_path ? String(r.detection_path) : null,
      total_scenarios: Number(r.total_scenarios) || 0,
      scenarios_tracked: Number(r.scenarios_tracked) || 0,
      avg_forward_return: Number(r.avg_forward_return) || 0,
      direction_hit_rate: Number(r.direction_hit_rate) || 0,
      avg_mfe: Number(r.avg_mfe) || 0,
      avg_mae: Number(r.avg_mae) || 0,
      avg_composite_rank: Number(r.avg_composite_rank) || 0,
      avg_scenario_age: Number(r.avg_scenario_age) || 0,
      top_winners: parseJsonOrNull<Array<{ s: string; r: number }>>(
        r.top_winners as string,
      ) ?? [],
      top_losers: parseJsonOrNull<Array<{ s: string; r: number }>>(
        r.top_losers as string,
      ) ?? [],
      snapshot_date: String(r.snapshot_date),
    }));
  } catch {
    return [];
  }
}

export function getScenarioOutcomes(
  situationId?: number,
  limit = 100,
  minEvidence = 2,
): ScenarioOutcome[] {
  const db = getDb();
  try {
    const wheres: string[] = [];
    const params: unknown[] = [];
    if (situationId != null) {
      wheres.push('o.situation_id = ?');
      params.push(situationId);
    }
    if (minEvidence > 0) {
      wheres.push('m.evidence_count >= ?');
      params.push(minEvidence);
    }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT o.*, m.title AS scenario_title, m.summary AS scenario_summary
         FROM scenario_outcomes o
         LEFT JOIN market_situations m ON m.id = o.situation_id
         ${where}
         ORDER BY o.tracked_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      situation_id: Number(r.situation_id),
      symbol: String(r.symbol),
      exposure_direction: String(r.exposure_direction || ''),
      composite_rank: Number(r.composite_rank) || 0,
      forward_return_pct: Number(r.forward_return_pct) || 0,
      max_favorable_pct: Number(r.max_favorable_pct) || 0,
      max_adverse_pct: Number(r.max_adverse_pct) || 0,
      direction_hit: r.direction_hit === 1,
      days_tracked: Number(r.days_tracked) || 0,
      scenario_age_days: Number(r.scenario_age_days) || 0,
      primary_theme: String(r.primary_theme || ''),
      detection_path: String(r.detection_path || ''),
      scenario_status: String(r.scenario_status || ''),
      scenario_title: r.scenario_title ? String(r.scenario_title) : null,
      scenario_summary: r.scenario_summary ? String(r.scenario_summary) : null,
      outcome_label: r.outcome_label ? String(r.outcome_label) : null,
      operator_label: r.operator_label ? String(r.operator_label) : null,
    }));
  } catch {
    return [];
  }
}

export function setOutcomeLabel(
  situationId: number,
  symbol: string,
  label: string,
): boolean {
  const db = getDb();
  try {
    db.prepare(
      `UPDATE scenario_outcomes SET operator_label = ? WHERE situation_id = ? AND symbol = ?`,
    ).run(label, situationId, symbol);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// CONSUMER BRAND SIGNALS — Phase 6 D19
// ----------------------------------------------------------------------------

export interface ConsumerBrandSignal {
  brand_key: string;
  parent_ticker: string | null;
  source_type: string;
  signal_date: string;
  signal_value: number;
  baseline_value: number | null;
  acceleration: number;
}

export function getConsumerBrandSignals(
  brandKey?: string,
  sourceType?: string,
  limit = 100,
): ConsumerBrandSignal[] {
  const db = getDb();
  try {
    const wheres: string[] = [];
    const params: unknown[] = [];
    if (brandKey) { wheres.push('brand_key = ?'); params.push(brandKey); }
    if (sourceType) { wheres.push('source_type = ?'); params.push(sourceType); }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT brand_key, parent_ticker, source_type, signal_date,
                signal_value, baseline_value, acceleration
         FROM consumer_brand_signals ${where}
         ORDER BY signal_date DESC, acceleration DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      brand_key: String(r.brand_key),
      parent_ticker: r.parent_ticker ? String(r.parent_ticker) : null,
      source_type: String(r.source_type),
      signal_date: String(r.signal_date),
      signal_value: Number(r.signal_value) || 0,
      baseline_value: r.baseline_value != null ? Number(r.baseline_value) : null,
      acceleration: Number(r.acceleration) || 0,
    }));
  } catch {
    return [];
  }
}

export function getConsumerBrandScore(ticker: string): number {
  const db = getDb();
  try {
    const row = db
      .prepare(
        `SELECT
           AVG(CASE WHEN source_type = 'google_trends' THEN acceleration ELSE NULL END) as trends_accel,
           AVG(CASE WHEN source_type = 'app_store_rank' THEN acceleration ELSE NULL END) as app_rank_change,
           AVG(CASE WHEN source_type = 'amazon_reviews' THEN acceleration ELSE NULL END) as review_velocity
         FROM consumer_brand_signals
         WHERE parent_ticker = ?
           AND signal_date >= date('now', '-7 days')`,
      )
      .get(ticker) as { trends_accel: number | null; app_rank_change: number | null; review_velocity: number | null } | undefined;

    if (!row) return 0;

    let score = 0;
    if (row.trends_accel != null) score += Math.min(row.trends_accel * 20, 40);
    if (row.app_rank_change != null && row.app_rank_change > 0) score += Math.min(row.app_rank_change * 2, 30);
    if (row.review_velocity != null && row.review_velocity > 0) score += Math.min(row.review_velocity * 0.5, 30);

    return Math.min(Math.round(score), 100);
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Re-export for tests / route validation
// ----------------------------------------------------------------------------

export { MARKET_INTELLIGENCE_SCHEMA_VERSION };
