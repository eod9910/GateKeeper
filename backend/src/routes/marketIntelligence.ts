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
 * Scheduler (Phase 1 build target — generic job registry):
 *   GET    /scheduler/status                 list jobs + cron + runtime state
 *   POST   /scheduler/config                 update master + per-job config
 *   POST   /scheduler/jobs/:name/run         async fire-and-forget run
 *   POST   /scheduler/jobs/:name/enable      enable a single job (master stays as-is)
 *   POST   /scheduler/jobs/:name/disable     disable a single job
 *   POST   /scheduler/start                  master enable
 *   POST   /scheduler/stop                   master disable
 *
 * Synchronous ad-hoc collector run (kept for dev-only one-shot testing):
 *   POST   /collectors/:source_type/run
 *
 * Response envelope: { success: true, data: ... } or
 * { success: false, error: "...", code: "..." } per the existing
 * socialIntelligence routes convention.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';
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
  getMarketIntelligenceJobDefinition,
  getMarketIntelligenceScheduleStatus,
  listMarketIntelligenceJobs,
  runMarketIntelligenceJobNow,
  saveMarketIntelligenceScheduleConfig,
  setMarketIntelligenceJobEnabled,
} from '../services/marketIntelligenceScheduler';

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
// Collector spawn config (Phase 2)
// ============================================================================

const PYTHON_BIN =
  process.env.MI_PYTHON_BIN ||
  (process.platform === 'win32' ? 'py' : 'python3');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const COLLECTOR_SCRIPTS: Record<string, string> = {
  hackernews: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_hackernews_intraday.py',
  ),
};

const COLLECTOR_TIMEOUT_MS = 90_000;

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
// SCHEDULER — generic multi-job registry (PRD §Operational Architecture)
// ============================================================================

router.get('/scheduler/status', (_req: Request, res: Response) => {
  try {
    const status = getMarketIntelligenceScheduleStatus();
    res.json({
      success: true,
      data: {
        ...status,
        registry: listMarketIntelligenceJobs(),
      },
    });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : 'Failed to read scheduler status',
    );
  }
});

router.post('/scheduler/config', (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const next = saveMarketIntelligenceScheduleConfig({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      jobs: (body.jobs && typeof body.jobs === 'object') ? body.jobs : undefined,
    });
    res.json({ success: true, data: { config: next } });
  } catch (e) {
    sendError(
      res,
      'VALIDATION_ERROR',
      e instanceof Error ? e.message : 'Failed to update scheduler config',
    );
  }
});

router.post('/scheduler/start', (_req: Request, res: Response) => {
  try {
    const next = saveMarketIntelligenceScheduleConfig({ enabled: true });
    res.json({ success: true, data: { config: next } });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : 'Failed to start scheduler',
    );
  }
});

router.post('/scheduler/stop', (_req: Request, res: Response) => {
  try {
    const next = saveMarketIntelligenceScheduleConfig({ enabled: false });
    res.json({ success: true, data: { config: next } });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : 'Failed to stop scheduler',
    );
  }
});

router.post('/scheduler/jobs/:name/run', (req: Request, res: Response) => {
  const name = String(req.params.name || '').trim();
  if (!getMarketIntelligenceJobDefinition(name)) {
    return sendError(res, 'NOT_FOUND', `Unknown scheduler job: ${name}`);
  }
  try {
    const result = runMarketIntelligenceJobNow(name, 'manual');
    res.json({ success: true, data: { job_name: name, ...result } });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : `Failed to run job ${name}`,
    );
  }
});

router.post('/scheduler/jobs/:name/enable', (req: Request, res: Response) => {
  const name = String(req.params.name || '').trim();
  if (!getMarketIntelligenceJobDefinition(name)) {
    return sendError(res, 'NOT_FOUND', `Unknown scheduler job: ${name}`);
  }
  try {
    const next = setMarketIntelligenceJobEnabled(name, true);
    res.json({ success: true, data: { config: next } });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : `Failed to enable job ${name}`,
    );
  }
});

router.post('/scheduler/jobs/:name/disable', (req: Request, res: Response) => {
  const name = String(req.params.name || '').trim();
  if (!getMarketIntelligenceJobDefinition(name)) {
    return sendError(res, 'NOT_FOUND', `Unknown scheduler job: ${name}`);
  }
  try {
    const next = setMarketIntelligenceJobEnabled(name, false);
    res.json({ success: true, data: { config: next } });
  } catch (e) {
    sendError(
      res,
      'INTERNAL',
      e instanceof Error ? e.message : `Failed to disable job ${name}`,
    );
  }
});

// ----------------------------------------------------------------------------
// Collector run helpers
// ----------------------------------------------------------------------------

interface CollectorRunBody {
  since_hours?: unknown;
  max_pages?: unknown;
  hits_per_page?: unknown;
  concept_keys?: unknown;
  dry_run?: unknown;
  request_timeout?: unknown;
  sleep_ms?: unknown;
}

function asTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false';
  }
  return Boolean(value);
}

function buildHackerNewsCliArgs(body: CollectorRunBody): string[] {
  const args: string[] = [];

  if (body.since_hours !== undefined && body.since_hours !== null) {
    const n = Number(body.since_hours);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'since_hours must be a positive number',
      );
    }
    args.push('--since-hours', String(Math.trunc(n)));
  }

  if (body.max_pages !== undefined && body.max_pages !== null) {
    const n = Number(body.max_pages);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'max_pages must be a positive number',
      );
    }
    args.push('--max-pages', String(Math.trunc(n)));
  }

  if (body.hits_per_page !== undefined && body.hits_per_page !== null) {
    const n = Number(body.hits_per_page);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'hits_per_page must be a positive number <= 1000',
      );
    }
    args.push('--hits-per-page', String(Math.trunc(n)));
  }

  if (body.request_timeout !== undefined && body.request_timeout !== null) {
    const n = Number(body.request_timeout);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'request_timeout must be a positive number',
      );
    }
    args.push('--request-timeout', String(n));
  }

  if (body.sleep_ms !== undefined && body.sleep_ms !== null) {
    const n = Number(body.sleep_ms);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'sleep_ms must be a non-negative number',
      );
    }
    args.push('--sleep-ms', String(Math.trunc(n)));
  }

  if (body.concept_keys !== undefined && body.concept_keys !== null) {
    let keys: string;
    if (Array.isArray(body.concept_keys)) {
      keys = body.concept_keys
        .map((k) => String(k).trim())
        .filter((k) => k.length > 0)
        .join(',');
    } else if (typeof body.concept_keys === 'string') {
      keys = body.concept_keys.trim();
    } else {
      throw new HttpError(
        'VALIDATION_ERROR',
        'concept_keys must be an array of strings or a comma-separated string',
      );
    }
    if (keys.length > 0) {
      args.push('--concept-keys', keys);
    }
  }

  if (asTruthy(body.dry_run)) {
    args.push('--dry-run');
  }

  return args;
}

function spawnCollector(
  scriptPath: string,
  args: string[],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, COLLECTOR_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new HttpError(
          'INTERNAL',
          `Failed to spawn ${PYTHON_BIN}: ${err.message}. ` +
            `Ensure '${PYTHON_BIN}' is on PATH (or set MI_PYTHON_BIN).`,
        ),
      );
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new HttpError(
            'INTERNAL',
            `Collector timed out after ${COLLECTOR_TIMEOUT_MS}ms. ` +
              `stderr tail: ${stderr.slice(-500)}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new HttpError(
            'INTERNAL',
            `Collector exited non-zero (code=${code}). ` +
              `stderr tail: ${stderr.slice(-500)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(
          new HttpError(
            'INTERNAL',
            `Collector did not produce valid JSON on stdout. ` +
              `stdout head: ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });
  });
}

router.post(
  '/collectors/:source_type/run',
  async (req: Request, res: Response) => {
    const sourceType = String(req.params.source_type || '').trim();

    const scriptPath = COLLECTOR_SCRIPTS[sourceType];
    if (!scriptPath) {
      sendError(
        res,
        'NOT_IMPLEMENTED',
        `Collector '${sourceType}' not implemented. Available: ` +
          `${Object.keys(COLLECTOR_SCRIPTS).join(', ') || '(none)'}. ` +
          `Phase 2 will add Discord + 4chan/biz + Bluesky + forums; ` +
          `Phase 3 will wire Macro RSS feeds.`,
      );
      return;
    }

    const rawBody = req.body;
    let body: CollectorRunBody = {};
    if (rawBody !== undefined && rawBody !== null) {
      if (typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        sendError(
          res,
          'VALIDATION_ERROR',
          'Request body must be a JSON object or empty.',
        );
        return;
      }
      body = rawBody as CollectorRunBody;
    }

    const startedAt = Date.now();
    try {
      ensureDbReady();
      const cliArgs =
        sourceType === 'hackernews'
          ? buildHackerNewsCliArgs(body)
          : [];
      const result = await spawnCollector(scriptPath, cliArgs);
      res.json({
        success: true,
        data: {
          collector: sourceType,
          duration_ms: Date.now() - startedAt,
          result,
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err.code, err.message);
        return;
      }
      sendError(
        res,
        'INTERNAL',
        err instanceof Error ? err.message : String(err),
      );
    }
  },
);

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
