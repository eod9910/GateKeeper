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
  ApiEvidenceItem,
  ApiScenarioDetail,
  ApiScenarioListItem,
  ApiUniverseCandidate,
  AssetType,
  AuthenticitySignalSnapshot,
  ConfidenceLevel,
  ConvictionLayer,
  CoverageTier,
  DetectionPath,
  EngineFilter,
  EvidenceType,
  ExposureDirection,
  ExposureOrder,
  OrderEffectSnapshot,
  RowMarketSituation,
  RowSituationExposure,
  RowThemeRegistry,
  ScenarioListQuery,
  ScenarioStatus,
  ScenarioType,
  SourceMethod,
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
       ORDER BY se.composite_rank ASC
       LIMIT ?`,
    )
    .all(situationId, limit) as RawCandidateRow[];

  return rows.map((r) => ({
    symbol: String(r.symbol),
    composite_rank: asInt(r.composite_rank, 0),
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

// ----------------------------------------------------------------------------
// Re-export for tests / route validation
// ----------------------------------------------------------------------------

export { MARKET_INTELLIGENCE_SCHEMA_VERSION };
