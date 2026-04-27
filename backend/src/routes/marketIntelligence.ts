/**
 * Market Intelligence — Phase-1 HTTP routes.
 *
 * Implements the 10 endpoints frozen in the API contract:
 *   .planning/plans/ACTIVE/market-intelligence-api-contract.md §9
 *
 * Read endpoints (DB-backed):
 *   GET    /scenarios                    list with filters
 *   GET    /scenarios/:id_or_slug        detail
 *   GET    /scenarios/:id_or_slug/evidence
 *   GET    /themes                       theme registry
 *   GET    /healthcheck                  schema version + table counts
 *
 * Admin endpoints:
 *   GET    /settings                     read settings JSON file
 *   PUT    /settings                     write settings JSON file
 *
 * Phase-1 stubs (return 501 with a clear message; wired in Phase 2+):
 *   POST   /scheduler/start
 *   POST   /scheduler/stop
 *   POST   /collectors/:source_type/run
 *
 * Response envelope: { success: true, data: ... } or
 * { success: false, error: "...", code: "..." } per the existing
 * socialIntelligence routes convention.
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

import {
  databaseExists,
  getHealth,
  getMarketIntelligenceDbPath,
  getScenarioDetail,
  listEvidenceForSituation,
  listScenarios,
  listThemes,
} from '../services/marketIntelligenceDb';

import {
  CoverageTier,
  DetectionPath,
  EngineFilter,
  MARKET_INTELLIGENCE_SCHEMA_VERSION,
  ScenarioListQuery,
  ScenarioStatus,
  ScenarioType,
  TimeHorizon,
} from '../types/marketIntelligence';

const router = Router();

// ============================================================================
// Error envelope helpers
// ============================================================================

type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DB_NOT_READY'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  DB_NOT_READY: 503,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

function sendError(res: Response, code: ErrorCode, message: string): void {
  res
    .status(ERROR_STATUS[code])
    .json({ success: false, code, error: message });
}

class HttpError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function ensureDbReady(): void {
  if (!databaseExists()) {
    throw new HttpError(
      'DB_NOT_READY',
      `market-intelligence.sqlite missing at ${getMarketIntelligenceDbPath()}. ` +
        'Run backend/scripts/build_market_intelligence_db.py and ' +
        'backend/scripts/seed_market_intelligence_registry.py.',
    );
  }
}

// ============================================================================
// Query-string parsing helpers
// ============================================================================

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const flat = value.flatMap((v) =>
      typeof v === 'string' ? v.split(',') : [],
    );
    const cleaned = flat.map((s) => s.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof value === 'string') {
    const cleaned = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  const s = asString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  const s = asString(value);
  if (s === undefined) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return undefined;
}

const ALLOWED_STATUS: ReadonlySet<string> = new Set([
  'EARLY',
  'DEVELOPING',
  'CONFIRMED',
  'CROWDED',
  'FADING',
  'INVALIDATED',
]);

const ALLOWED_SCENARIO_TYPE: ReadonlySet<string> = new Set([
  'macro',
  'geopolitical',
  'commodity',
  'policy',
  'sector_rotation',
  'single_company_catalyst',
  'consumer_cycle',
  'tech_disruption',
  'other',
]);

const ALLOWED_TIME_HORIZON: ReadonlySet<string> = new Set([
  'intraday',
  'days',
  'weeks',
  'months',
  'quarters',
  'structural',
]);

const ALLOWED_ENGINE: ReadonlySet<string> = new Set([
  'macro',
  'social_arbitrage',
  'both',
]);

const ALLOWED_DETECTION_PATH: ReadonlySet<string> = new Set([
  'topic_anomaly',
  'news_cluster',
  'mixed_news_led',
  'mixed_anomaly_led',
]);

const ALLOWED_COVERAGE_TIER: ReadonlySet<string> = new Set([
  'mega_covered',
  'well_covered',
  'lightly_covered',
  'barely_covered',
  'untradable',
]);

function validateEnumList<T extends string>(
  values: string[] | undefined,
  allowed: ReadonlySet<string>,
  label: string,
): T[] | undefined {
  if (!values) return undefined;
  for (const v of values) {
    if (!allowed.has(v)) {
      throw new HttpError(
        'VALIDATION_ERROR',
        `Invalid ${label}: '${v}'. Allowed: ${Array.from(allowed).join(', ')}`,
      );
    }
  }
  return values as T[];
}

function validateEnumSingle<T extends string>(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.has(value)) {
    throw new HttpError(
      'VALIDATION_ERROR',
      `Invalid ${label}: '${value}'. Allowed: ${Array.from(allowed).join(', ')}`,
    );
  }
  return value as T;
}

function parseScenarioListQuery(raw: Request['query']): ScenarioListQuery {
  const q: ScenarioListQuery = {};

  q.status = validateEnumList<ScenarioStatus>(
    asStringList(raw.status),
    ALLOWED_STATUS,
    'status',
  );

  const theme = asString(raw.theme);
  if (theme) q.theme = theme;

  q.scenario_type = validateEnumSingle<ScenarioType>(
    asString(raw.scenario_type),
    ALLOWED_SCENARIO_TYPE,
    'scenario_type',
  );

  q.time_horizon = validateEnumSingle<TimeHorizon>(
    asString(raw.time_horizon),
    ALLOWED_TIME_HORIZON,
    'time_horizon',
  );

  q.engine = validateEnumSingle<EngineFilter>(
    asString(raw.engine),
    ALLOWED_ENGINE,
    'engine',
  );

  q.detection_path = validateEnumList<DetectionPath>(
    asStringList(raw.detection_path),
    ALLOWED_DETECTION_PATH,
    'detection_path',
  );

  q.coverage_tier = validateEnumList<CoverageTier>(
    asStringList(raw.coverage_tier),
    ALLOWED_COVERAGE_TIER,
    'coverage_tier',
  );

  const minAuth = asNumber(raw.min_authenticity_score);
  if (minAuth !== undefined) q.min_authenticity_score = minAuth;

  const minSig = asNumber(raw.min_signal_strength);
  if (minSig !== undefined) q.min_signal_strength = minSig;

  const minConf = asNumber(raw.min_confidence);
  if (minConf !== undefined) q.min_confidence = minConf;

  const minPeakZ = asNumber(raw.min_peak_z);
  if (minPeakZ !== undefined) q.min_peak_z = minPeakZ;

  const crossPlatform = asBoolean(raw.cross_platform_only);
  if (crossPlatform !== undefined) q.cross_platform_only = crossPlatform;

  const onlyEarly = asBoolean(raw.only_early);
  if (onlyEarly !== undefined) q.only_early = onlyEarly;

  const includeArchived = asBoolean(raw.include_archived);
  if (includeArchived !== undefined) q.include_archived = includeArchived;

  const includeInvalidated = asBoolean(raw.include_invalidated);
  if (includeInvalidated !== undefined) q.include_invalidated = includeInvalidated;

  const includeSuppressed = asBoolean(raw.include_suppressed);
  if (includeSuppressed !== undefined) q.include_suppressed = includeSuppressed;

  const limit = asNumber(raw.limit);
  if (limit !== undefined) q.limit = limit;

  return q;
}

// ============================================================================
// READ endpoints
// ============================================================================

router.get('/healthcheck', (_req: Request, res: Response) => {
  try {
    const result = getHealth();
    res.json({
      success: true,
      data: {
        ...result,
        api_phase: 1,
        expected_schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/themes', (_req: Request, res: Response) => {
  try {
    ensureDbReady();
    const themes = listThemes();
    res.json({ success: true, data: { themes, total: themes.length } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/scenarios', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const query = parseScenarioListQuery(req.query);
    const result = listScenarios(query);
    res.json({
      success: true,
      data: {
        items: result.items,
        total: result.total,
        applied_filters: query,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/scenarios/:id_or_slug', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const idOrSlug = String(req.params.id_or_slug || '').trim();
    if (!idOrSlug) {
      return sendError(res, 'VALIDATION_ERROR', 'Missing id_or_slug param');
    }
    const detail = getScenarioDetail(idOrSlug);
    if (!detail) {
      return sendError(
        res,
        'NOT_FOUND',
        `No scenario matches id_or_slug='${idOrSlug}'`,
      );
    }
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/scenarios/:id_or_slug/evidence', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const idOrSlug = String(req.params.id_or_slug || '').trim();
    if (!idOrSlug) {
      return sendError(res, 'VALIDATION_ERROR', 'Missing id_or_slug param');
    }
    const since = asNumber(req.query.since);
    const limit = asNumber(req.query.limit);
    const result = listEvidenceForSituation(idOrSlug, { since, limit });
    if (!result) {
      return sendError(
        res,
        'NOT_FOUND',
        `No scenario matches id_or_slug='${idOrSlug}'`,
      );
    }
    res.json({
      success: true,
      data: {
        situation_id: result.situation_id,
        items: result.items,
        total: result.items.length,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// SETTINGS — JSON file persistence (matches the social-intelligence pattern)
// ============================================================================

const SETTINGS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'preferences',
  'market-intelligence-settings.local.json',
);

interface MarketIntelligenceSettings {
  scenario_view: 'both' | 'macro' | 'social_arbitrage' | 'mixed';
  default_filters: {
    min_signal_strength: number;
    min_confidence: number;
    only_early: boolean;
    cross_platform_only: boolean;
    coverage_tier: CoverageTier[];
    statuses: ScenarioStatus[];
  };
  scheduler_enabled: boolean;
  poll_interval_seconds: number;
  llm_daily_budget_usd: number;
  updated_at: number;
  schema_version: number;
}

const DEFAULT_SETTINGS: MarketIntelligenceSettings = {
  scenario_view: 'both',
  default_filters: {
    min_signal_strength: 40,
    min_confidence: 0.5,
    only_early: false,
    cross_platform_only: false,
    coverage_tier: ['barely_covered', 'lightly_covered', 'well_covered'],
    statuses: ['EARLY', 'DEVELOPING', 'CONFIRMED', 'CROWDED', 'FADING'],
  },
  scheduler_enabled: false,
  poll_interval_seconds: 600,
  llm_daily_budget_usd: 12,
  updated_at: 0,
  schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
};

function readSettings(): MarketIntelligenceSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULT_SETTINGS, updated_at: 0 };
    }
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      default_filters: {
        ...DEFAULT_SETTINGS.default_filters,
        ...(raw?.default_filters ?? {}),
      },
      schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, updated_at: 0 };
  }
}

function writeSettings(next: MarketIntelligenceSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
}

router.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: readSettings() });
  } catch (err: any) {
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.put('/settings', (req: Request, res: Response) => {
  try {
    const current = readSettings();
    const body = (req.body || {}) as Partial<MarketIntelligenceSettings>;
    const merged: MarketIntelligenceSettings = {
      ...current,
      ...body,
      default_filters: {
        ...current.default_filters,
        ...(body.default_filters ?? {}),
      },
      updated_at: Math.floor(Date.now() / 1000),
      schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
    };
    writeSettings(merged);
    res.json({ success: true, data: merged });
  } catch (err: any) {
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// SCHEDULER + COLLECTORS — Phase-1 stubs (no-op until Phase 2 wires them)
// ============================================================================

const SCHEDULER_NOT_WIRED_MSG =
  'Scheduler not wired in Phase 1. Phase 2 will implement collectors + cron loop. ' +
  'Use POST /api/market-intelligence/collectors/:source_type/run for ad-hoc runs once collectors land.';

router.post('/scheduler/start', (_req: Request, res: Response) => {
  sendError(res, 'NOT_IMPLEMENTED', SCHEDULER_NOT_WIRED_MSG);
});

router.post('/scheduler/stop', (_req: Request, res: Response) => {
  sendError(res, 'NOT_IMPLEMENTED', SCHEDULER_NOT_WIRED_MSG);
});

router.post('/collectors/:source_type/run', (req: Request, res: Response) => {
  const sourceType = String(req.params.source_type || '').trim();
  sendError(
    res,
    'NOT_IMPLEMENTED',
    `Collector '${sourceType}' not implemented. Phase 2 will wire HN + Discord ` +
      '+ 4chan/biz + Bluesky + forums; Phase 3 will wire Macro RSS feeds.',
  );
});

// ============================================================================
// 404 fallback inside the router (lets server.ts mount cleanly)
// ============================================================================

router.use((req: Request, res: Response, _next: NextFunction) => {
  sendError(
    res,
    'NOT_FOUND',
    `No market-intelligence route matched ${req.method} ${req.originalUrl}`,
  );
});

export default router;
