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
  EmergingTopicListQuery,
  getCoverageTierForSymbol,
  getEmergingTopicAuthenticity,
  getHealth,
  getMarketIntelligenceDbPath,
  getNarrativeClusterDetail,
  getSocialArbEngineAudit,
  getScenarioDetail,
  listUniverseSymbolPerturbations,
  listEmergingTopics,
  listEvidenceForSituation,
  listNarrativeClusters,
  listScenarios,
  listSocialArbPromotedTopicLedger,
  listThemes,
  listTrackedConcepts,
  NarrativeClusterListQuery,
  NarrativeClusterStatus,
  TrackedConceptListQuery,
  TrackedConceptStatus,
  updateTrackedConceptStatus,
  upsertExposureOverride,
  deleteExposureOverride,
  getQualityDashboard,
  getScenarioOutcomes,
  setOutcomeLabel,
  getConsumerBrandSignals,
  getConsumerBrandScore,
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
  TargetType,
  TimeHorizon,
} from '../types/marketIntelligence';

import { bulkLookupSymbolNames, getSymbolClassification } from '../services/symbolCatalog';
import { getConfiguredOpenAIKey, getRoleModelOverride } from '../services/aiSettings';
import { recordAdhocNarrativeThesis } from '../services/narrativeThesisStore';
import { runWebCatalystCheck } from '../services/webCatalystSearch';
import { loadLedgerWorkspaceSkill } from '../services/ledgerWorkspaceSkills';

const router = Router();

// ============================================================================
// Collector spawn config (Phase 2)
// ============================================================================

const PYTHON_BIN =
  process.env.MI_PYTHON_BIN ||
  (process.platform === 'win32' ? 'py' : 'python3');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const EIGEN_LIVE_OUTPUT = path.join(
  PROJECT_ROOT,
  'backend',
  'data',
  'research',
  'eigen_perturbation_lab.latest.json',
);
const EIGEN_REPLAY_OUTPUT = path.join(
  PROJECT_ROOT,
  'backend',
  'data',
  'research',
  'eigen_replay_study.latest.json',
);
const EIGEN_REPORT_CACHE_DIR = path.join(
  PROJECT_ROOT,
  'backend',
  'data',
  'research',
  'eigen-reports',
);
const EIGEN_REPORT_SCHEMA_VERSION = 4;
const OPTIONS_FLOW_DB_PATH = path.join(PROJECT_ROOT, 'backend', 'data', 'options-flow.sqlite');
const SOCIAL_INTELLIGENCE_DB_PATH = path.join(
  PROJECT_ROOT,
  'backend',
  'data',
  'social-intelligence.sqlite',
);
const CLEAN_UNIVERSE_PATH = path.join(PROJECT_ROOT, 'backend', 'data', 'universe_clean.json');
const PRICE_UNIVERSE_DIR = path.join(PROJECT_ROOT, 'backend', 'data', 'universe');
const FUNDAMENTALS_PIT_DB_PATH = path.join(PROJECT_ROOT, 'backend', 'data', 'fundamentals-pit.sqlite');

const COLLECTOR_SCRIPTS: Record<string, string> = {
  hackernews: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_hackernews_intraday.py',
  ),
  fourchan: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_fourchan_intraday.py',
  ),
  bluesky: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_bluesky_intraday.py',
  ),
  forums: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_niche_forums.py',
  ),
  discord: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_discord_intraday.py',
  ),
  // Phase 1.5 — Macro Engine. The "macro_*" prefix groups every
  // upcoming macro collector (macro_fed, macro_eia, macro_bls,
  // macro_sec, etc.) so the dispatch table stays self-documenting.
  macro_fed: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_macro_fed_intraday.py',
  ),
  macro_news: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_macro_news_intraday.py',
  ),
  macro_econ: path.join(
    PROJECT_ROOT,
    'backend',
    'scripts',
    'collect_macro_econ_intraday.py',
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

function readJsonIfExists(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function fileAgeSeconds(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return Math.max(0, Math.floor((Date.now() - stat.mtimeMs) / 1000));
}

function latestEigenRows(limit = 500): any[] {
  const live = readJsonIfExists(EIGEN_LIVE_OUTPUT);
  const rows = Array.isArray(live?.top_residual_movers) ? live.top_residual_movers : [];
  return rows.slice(0, Math.max(1, Math.min(1000, limit)));
}

function latestEigenScanId(): string | null {
  const live = readJsonIfExists(EIGEN_LIVE_OUTPUT);
  return String(live?.meta?.generated_at || live?.pca?.latest_date || '').trim() || null;
}

function safeFiniteNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctChange(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || prev === 0) return null;
  return ((now / prev) - 1) * 100;
}

function safeSymbolFile(symbol: string): string {
  return symbol.replace(/[\/=-]/g, '_');
}

function cleanUniverseSymbols(): string[] {
  const payload = readJsonIfExists(CLEAN_UNIVERSE_PATH);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.stocks) ? payload.stocks : [];
  return Array.from(new Set<string>(
    rows
      .map((row: any) => String(row?.symbol || row?.ticker || '').trim().toUpperCase())
      .filter((symbol: string) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)),
  )).sort();
}

function latestPriceFeatures(symbol: string, asOf: string): any | null {
  const filePath = path.join(PRICE_UNIVERSE_DIR, `${safeSymbolFile(symbol)}_1d.csv`);
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split(/\r?\n/);
  if (lines.length < 121) return null;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idxDate = header.indexOf('date');
  const idxClose = header.indexOf('close');
  const idxVolume = header.indexOf('volume');
  if (idxDate < 0 || idxClose < 0) return null;
  const rows = lines.slice(1)
    .map((line) => {
      const cols = line.split(',');
      const date = String(cols[idxDate] || '').slice(0, 10);
      const close = safeFiniteNumber(cols[idxClose]);
      const volume = idxVolume >= 0 ? safeFiniteNumber(cols[idxVolume]) : null;
      return date && close != null ? { date, close, volume } : null;
    })
    .filter((row): row is { date: string; close: number; volume: number | null } => !!row && row.date <= asOf);
  if (rows.length < 120) return null;
  const latest = rows[rows.length - 1];
  if (!String(latest.date).startsWith('2026')) return null;
  const window252 = rows.slice(-252);
  const closes = window252.map((row: any) => row.close).filter((n: any) => Number.isFinite(n));
  if (closes.length < 120) return null;
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  if (high === low) return null;
  const rangePos252d = (latest.close - low) / (high - low);
  const window63 = rows.slice(-63);
  const dollarValues = window63
    .map((row: any) => row.volume != null ? row.close * row.volume : null)
    .filter((n): n is number => Number.isFinite(n))
    .sort((a: number, b: number) => a - b);
  const mid = Math.floor(dollarValues.length / 2);
  const dollarVolume63d = dollarValues.length
    ? dollarValues.length % 2
      ? dollarValues[mid]
      : (dollarValues[mid - 1] + dollarValues[mid]) / 2
    : null;
  return {
    as_of: latest.date,
    price: latest.close,
    range_pos_252d: rangePos252d,
    dollar_volume_63d: dollarVolume63d,
  };
}

function loadFundamentalRows(symbols: string[], asOf: string): Map<string, any[]> {
  const out = new Map<string, any[]>();
  if (!symbols.length || !fs.existsSync(FUNDAMENTALS_PIT_DB_PATH)) return out;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(FUNDAMENTALS_PIT_DB_PATH, { readOnly: true });
  const keys = [
    'revenue',
    'net_income',
    'current_assets',
    'current_liabilities',
  ];
  try {
    for (let i = 0; i < symbols.length; i += 500) {
      const batch = symbols.slice(i, i + 500);
      const keyPlaceholders = keys.map(() => '?').join(',');
      const symbolPlaceholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT UPPER(symbol) AS symbol, fact_key, value_numeric, period_end, available_at
         FROM pit_statement_facts
         WHERE period_type = 'quarterly'
           AND fact_key IN (${keyPlaceholders})
           AND UPPER(symbol) IN (${symbolPlaceholders})
           AND available_at <= ?
         ORDER BY UPPER(symbol), period_end`,
      ).all(...keys, ...batch, asOf) as any[];
      for (const row of rows) {
        const symbol = String(row.symbol || '').toUpperCase();
        if (!out.has(symbol)) out.set(symbol, []);
        out.get(symbol)!.push(row);
      }
    }
  } finally {
    db.close();
  }
  return out;
}

function fundamentalReaccelerationFeatures(rows: any[]): any | null {
  if (!rows.length) return null;
  const byPeriod = new Map<string, any>();
  rows.forEach((row) => {
    const period = String(row.period_end || '').slice(0, 10);
    if (!period) return;
    const bucket = byPeriod.get(period) || { period_end: period };
    bucket[String(row.fact_key)] = safeFiniteNumber(row.value_numeric);
    byPeriod.set(period, bucket);
  });
  const periods = Array.from(byPeriod.values()).sort((a, b) => String(a.period_end).localeCompare(String(b.period_end)));
  const revRows = periods.filter((p) => p.revenue != null);
  if (revRows.length < 8) return null;
  const currentTtm = revRows.slice(-4).reduce((sum, p) => sum + Number(p.revenue), 0);
  const prevTtm = revRows.slice(-8, -4).reduce((sum, p) => sum + Number(p.revenue), 0);
  const latest = periods[periods.length - 1] || {};
  const revenueTtmGrowthPct = pctChange(currentTtm, prevTtm);
  return {
    revenue_ttm_growth_pct: revenueTtmGrowthPct,
    latest_period_end: latest.period_end || null,
    current_ratio: latest.current_liabilities ? latest.current_assets / latest.current_liabilities : null,
    net_margin_latest_pct: latest.revenue && latest.net_income != null ? (latest.net_income / latest.revenue) * 100 : null,
  };
}

function eigenReportCachePath(symbol: string): string {
  return path.join(EIGEN_REPORT_CACHE_DIR, `${symbol.toUpperCase()}.json`);
}

function readCachedEigenReport(symbol: string): any | null {
  const report = readJsonIfExists(eigenReportCachePath(symbol));
  if (!report || typeof report !== 'object') return null;
  if (report.eigen_report_schema_version !== EIGEN_REPORT_SCHEMA_VERSION) return null;
  const scanId = latestEigenScanId();
  if (scanId && report.scan_id !== scanId) return null;
  return report;
}

function writeCachedEigenReport(symbol: string, report: any): void {
  fs.mkdirSync(EIGEN_REPORT_CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    eigenReportCachePath(symbol),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
}

function isPreExplosionEigenPressure(row: any): boolean {
  const residualZ = Number(row?.residual_z);
  const zChange = Number(row?.residual_z_change_1d);
  const zSlope = Number(row?.residual_z_slope_3d);
  const actual = Math.abs(Number(row?.actual_return_pct));
  const unexplained = Math.abs(Number(row?.unexplained_return_pct));
  return (
    residualZ >= 2 &&
    zChange >= 0.5 &&
    zSlope >= 0.75 &&
    actual <= 10 &&
    unexplained <= 8
  );
}

function normalizeOptionSnapshotRow(row: any): any | null {
  if (!row) return null;
  const putCall = Number(row.put_call_volume_ratio || 0);
  const callPut = row.total_put_volume > 0
    ? Number(row.total_call_volume || 0) / Number(row.total_put_volume || 1)
    : 0;
  const dominant = Math.max(putCall, callPut);
  return {
    trade_date: row.trade_date,
    stock_price: row.stock_price,
    total_call_volume: row.total_call_volume,
    total_put_volume: row.total_put_volume,
    put_call_volume_ratio: putCall,
    call_put_volume_ratio: callPut,
    // UI compatibility with older eigen scan JSON.
    put_call_ratio: putCall,
    call_put_ratio: callPut,
    total_call_oi: row.total_call_oi,
    total_put_oi: row.total_put_oi,
    iv_skew: row.iv_skew,
    anomaly_score: row.anomaly_score,
    anomaly_flags: safeJsonArray(row.anomaly_flags),
    flow_bias: putCall >= 1.3 ? 'put_heavy' : callPut >= 1.3 ? 'call_heavy' : 'balanced',
    imbalance_tier: dominant >= 20 ? 'absurd' : dominant >= 5 ? 'extreme' : dominant >= 2 ? 'heavy' : dominant >= 1.3 ? 'elevated' : 'normal',
  };
}

function latestOptionSnapshot(symbol: string): any | null {
  if (!fs.existsSync(OPTIONS_FLOW_DB_PATH)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(OPTIONS_FLOW_DB_PATH, { readOnly: true });
    try {
      const row = db.prepare(`
        SELECT *
        FROM options_daily_snapshot
        WHERE symbol = ?
        ORDER BY trade_date DESC
        LIMIT 1
      `).get(symbol) as any;
      return normalizeOptionSnapshotRow(row);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function latestOptionSnapshotsBySymbol(symbols: string[]): Record<string, any> {
  const unique = Array.from(new Set(symbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)));
  if (!unique.length || !fs.existsSync(OPTIONS_FLOW_DB_PATH)) return {};
  const out: Record<string, any> = {};
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(OPTIONS_FLOW_DB_PATH, { readOnly: true });
    try {
      const stmt = db.prepare(`
        SELECT *
        FROM options_daily_snapshot
        WHERE symbol = ?
        ORDER BY trade_date DESC
        LIMIT 1
      `);
      unique.forEach((symbol) => {
        const snapshot = normalizeOptionSnapshotRow(stmt.get(symbol));
        if (snapshot) out[symbol] = snapshot;
      });
    } finally {
      db.close();
    }
  } catch {
    return out;
  }
  return out;
}

function safeJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function latestSymbolCatalystEvidence(symbol: string, limit = 12): any {
  const dbPath = getMarketIntelligenceDbPath();
  if (!fs.existsSync(dbPath)) {
    return { unavailable: true, reason: 'market_intelligence_db_missing', items: [], source_summary: [] };
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tableRow = db.prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'universe_symbol_mentions'`,
      ).get() as { name?: string } | undefined;
      if (!tableRow) {
        return { unavailable: true, reason: 'universe_symbol_mentions_missing', items: [], source_summary: [] };
      }
      const maxItems = Math.min(Math.max(limit, 1), 25);
      const rows = db.prepare(
        `SELECT
           m.source_type, m.source_community, m.posted_at, m.author,
           m.match_method, m.matched_text, m.discovery_role,
           h.title, h.body_text, h.source_url, h.score, h.comment_count
         FROM universe_symbol_mentions m
         LEFT JOIN mi_raw_hits h ON h.id = m.hit_id
         WHERE m.symbol = ?
         ORDER BY m.posted_at DESC, m.hit_id DESC
         LIMIT ?`,
      ).all(symbol, maxItems) as any[];
      const sourceSummary = db.prepare(
        `SELECT
           source_type, source_community,
           COUNT(*) AS mentions,
           COUNT(DISTINCT COALESCE(author, '')) AS authors,
           MAX(posted_at) AS latest_posted_at,
           SUM(CASE WHEN discovery_role = 'organic_discovery' THEN 1 ELSE 0 END) AS discovery_mentions,
           SUM(CASE WHEN discovery_role <> 'organic_discovery' THEN 1 ELSE 0 END) AS confirmation_mentions
         FROM universe_symbol_mentions
         WHERE symbol = ?
         GROUP BY source_type, source_community
         ORDER BY mentions DESC, latest_posted_at DESC
         LIMIT 8`,
      ).all(symbol) as any[];
      const normalizedSymbol = symbol.toUpperCase();
      const items = rows.map((row) => {
        const title = String(row.title || '').trim();
        const body = String(row.body_text || '').replace(/\s+/g, ' ').trim();
        const excerpt = body.length > 420 ? `${body.slice(0, 417)}...` : body;
        const matched = String(row.matched_text || '').trim();
        const aliasRisk =
          !!matched &&
          matched.toUpperCase() !== normalizedSymbol &&
          !matched.includes('$') &&
          matched.length <= 12;
        return {
          source_type: row.source_type,
          source_community: row.source_community,
          posted_at: row.posted_at,
          author: row.author,
          match_method: row.match_method,
          matched_text: matched,
          discovery_role: row.discovery_role,
          title,
          excerpt,
          source_url: row.source_url,
          score: row.score,
          comment_count: row.comment_count,
          alias_risk: aliasRisk,
        };
      });
      const aliasRiskCount = items.filter((item) => item.alias_risk).length;
      const reliableItems = items.filter((item) => !item.alias_risk);
      return {
        unavailable: false,
        items,
        reliable_items: reliableItems,
        reliable_item_count: reliableItems.length,
        source_summary: sourceSummary,
        alias_risk_count: aliasRiskCount,
        quality_flags: [
          ...(aliasRiskCount > 0 ? ['ALIAS_FALSE_POSITIVE_RISK'] : []),
          ...(items.length > 0 && reliableItems.length === 0 ? ['NO_RELIABLE_SYMBOL_EVIDENCE'] : []),
        ],
      };
    } finally {
      db.close();
    }
  } catch (err: any) {
    return { unavailable: true, reason: err?.message || String(err), items: [], source_summary: [] };
  }
}

function daysBetweenDates(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
  return Math.round((aMs - bMs) / 86_400_000);
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function latestSocialBuzzSnapshot(symbol: string): any {
  if (!fs.existsSync(SOCIAL_INTELLIGENCE_DB_PATH)) {
    return { available: false, reason: 'social_intelligence_db_missing' };
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(SOCIAL_INTELLIGENCE_DB_PATH, { readOnly: true });
    try {
      const upper = symbol.toUpperCase();
      const aggregate = db.prepare(`
        SELECT *
        FROM ticker_social_daily
        WHERE symbol = ? AND platform = 'aggregate'
        ORDER BY trade_date DESC
        LIMIT 1
      `).get(upper) as any;
      const score = db.prepare(`
        SELECT *
        FROM ticker_buzz_scores
        WHERE symbol = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(upper) as any;
      const platformRows = aggregate?.trade_date
        ? db.prepare(`
            SELECT platform, mention_count_1d, unique_authors_1d, bullish_ratio,
                   bearish_ratio, net_sentiment, weighted_sentiment
            FROM ticker_social_daily
            WHERE symbol = ? AND trade_date = ? AND platform <> 'aggregate'
            ORDER BY mention_count_1d DESC
          `).all(upper, aggregate.trade_date) as any[]
        : [];
      const recentMessages = db.prepare(`
        SELECT r.platform, r.author_handle, r.posted_at, r.body_text,
               r.like_count, r.reply_count, s.sentiment_label, s.sentiment_score
        FROM social_posts_raw r
        LEFT JOIN social_post_sentiment s ON s.raw_post_id = r.raw_post_id
        WHERE r.symbol = ?
          AND r.body_text IS NOT NULL
          AND LENGTH(TRIM(r.body_text)) > 0
        ORDER BY r.posted_at DESC
        LIMIT 8
      `).all(upper) as any[];
      if (!aggregate && !score && !recentMessages.length) {
        return { available: false, reason: 'no_social_buzz_rows' };
      }
      const aggregatePayload = safeJsonObject(aggregate?.payload_json);
      const scorePayload = safeJsonObject(score?.payload_json);
      return {
        available: true,
        symbol: upper,
        latest_trade_date: aggregate?.trade_date || null,
        updated_at: aggregate?.updated_at || score?.updated_at || null,
        mention_count_1d: aggregate?.mention_count_1d ?? null,
        mention_count_3d: aggregate?.mention_count_3d ?? null,
        mention_count_7d: aggregate?.mention_count_7d ?? null,
        mention_count_30d: aggregate?.mention_count_30d ?? null,
        unique_authors_1d: aggregate?.unique_authors_1d ?? null,
        unique_authors_7d: aggregate?.unique_authors_7d ?? null,
        posts_per_author: aggregate?.posts_per_author ?? null,
        author_concentration: aggregate?.author_concentration ?? null,
        bullish_ratio: aggregate?.bullish_ratio ?? null,
        bearish_ratio: aggregate?.bearish_ratio ?? null,
        net_sentiment: aggregate?.net_sentiment ?? null,
        weighted_sentiment: aggregate?.weighted_sentiment ?? null,
        engagement_per_post: aggregate?.engagement_per_post ?? null,
        platforms: Array.isArray(aggregatePayload.platforms)
          ? aggregatePayload.platforms
          : platformRows.map((row) => row.platform).filter(Boolean),
        platform_rows: platformRows.slice(0, 5),
        buzz_score: score ? {
          trade_date: score.trade_date,
          buzz_zscore: score.buzz_zscore,
          unique_author_zscore: score.unique_author_zscore,
          engagement_zscore: score.engagement_zscore,
          mention_velocity: score.mention_velocity,
          mention_acceleration: score.mention_acceleration,
          sentiment_trend_3d: score.sentiment_trend_3d,
          sentiment_trend_7d: score.sentiment_trend_7d,
          yahoo_mentions: score.yahoo_mentions,
          stocktwits_mentions: score.stocktwits_mentions,
          cross_platform_agreement: score.cross_platform_agreement,
          final_buzz_score: score.final_buzz_score,
          buzz_rank: score.buzz_rank,
          score_validity: score.score_validity,
          confidence_tier: score.confidence_tier,
          is_score_valid: Boolean(score.is_score_valid),
          reason_codes: safeJsonArray(score.reason_codes_json),
          payload: scorePayload,
        } : null,
        recent_messages: recentMessages.map((row) => ({
          source: row.platform,
          author: row.author_handle,
          posted_at: row.posted_at,
          body: String(row.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 260),
          likes: row.like_count,
          replies: row.reply_count,
          sentiment: row.sentiment_label,
          sentiment_score: row.sentiment_score,
        })),
      };
    } finally {
      db.close();
    }
  } catch (err: any) {
    return { available: false, reason: err?.message || String(err) };
  }
}

function buildSocialEigenAlignment(row: any, socialBuzz: any): any {
  if (!socialBuzz?.available) {
    return {
      status: 'no_social_confirmation',
      score: 0,
      signals: ['No usable ticker-indexed social buzz snapshot was available.'],
    };
  }
  const signals: string[] = [];
  let score = 0;
  const latestDate = String(row?.date || row?.trade_date || row?.latest_date || readJsonIfExists(EIGEN_LIVE_OUTPUT)?.pca?.latest_date || '').slice(0, 10);
  const staleDays = daysBetweenDates(latestDate, socialBuzz.latest_trade_date);
  if (staleDays != null && staleDays > 7) {
    signals.push(`Social buzz is stale versus eigen scan by ${staleDays} day(s).`);
    score -= 1;
  }
  const mentions7d = Number(socialBuzz.mention_count_7d);
  const authors7d = Number(socialBuzz.unique_authors_7d);
  const platforms = Array.isArray(socialBuzz.platforms) ? socialBuzz.platforms.length : 0;
  const finalBuzz = Number(socialBuzz.buzz_score?.final_buzz_score);
  const validScore = Boolean(socialBuzz.buzz_score?.is_score_valid);
  if (Number.isFinite(mentions7d) && mentions7d >= 20) {
    signals.push(`Meaningful 7D social attention: ${mentions7d} mentions.`);
    score += 2;
  } else if (Number.isFinite(mentions7d) && mentions7d > 0) {
    signals.push(`Thin 7D social attention: ${mentions7d} mention(s).`);
  }
  if (Number.isFinite(authors7d) && authors7d >= 8) {
    signals.push(`Author breadth present: ${authors7d} unique 7D author(s).`);
    score += 1;
  }
  if (platforms >= 2) {
    signals.push(`Cross-platform social coverage: ${socialBuzz.platforms.join(', ')}.`);
    score += 1;
  }
  if (validScore && Number.isFinite(finalBuzz) && finalBuzz >= 65) {
    signals.push(`Valid elevated buzz score: ${num(finalBuzz, 1)}.`);
    score += 2;
  } else if (socialBuzz.buzz_score && !validScore) {
    signals.push(`Buzz score is flagged ${socialBuzz.buzz_score.score_validity || 'invalid'}: ${(socialBuzz.buzz_score.reason_codes || []).join(', ') || 'quality filter failed'}.`);
  }
  const residualZ = Number(row?.residual_z);
  const sentiment = Number(socialBuzz.weighted_sentiment ?? socialBuzz.net_sentiment);
  if (Number.isFinite(residualZ) && Number.isFinite(sentiment)) {
    if (residualZ > 0 && sentiment > 0.2) {
      signals.push(`Sentiment aligns with positive residual move: ${num(sentiment, 2)}.`);
      score += 1;
    } else if (residualZ < 0 && sentiment < -0.2) {
      signals.push(`Sentiment aligns with negative residual move: ${num(sentiment, 2)}.`);
      score += 1;
    } else if (Math.abs(sentiment) > 0.2) {
      signals.push(`Sentiment diverges from residual direction: ${num(sentiment, 2)}.`);
      score -= 1;
    }
  }
  const status = score >= 4
    ? 'social_confirmed'
    : score >= 2
      ? 'social_supportive'
      : score < 0
        ? 'social_stale_or_divergent'
        : 'social_unconfirmed';
  return { status, score, stale_days: staleDays, signals };
}

function eigenVerdict(row: any, options: any | null, fundamentals: any | null, socialAlignment: any | null = null): { risk_level: string; summary: string; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  if (isPreExplosionEigenPressure(row)) {
    signals.push('Pre-explosion pressure setup: residual z rising while price move is still capped');
    score += 3;
  }
  if (Number(row?.residual_z) >= 3) {
    signals.push(`Strong positive residual z: ${num(row.residual_z, 2)}`);
    score += 2;
  }
  if (Number(row?.residual_z_change_1d) >= 2) {
    signals.push(`Residual z acceleration: +${num(row.residual_z_change_1d, 2)}`);
    score += 1;
  }
  if (options?.flow_bias === 'call_heavy') {
    signals.push(`Call-heavy options confirmation: ${num(options.call_put_volume_ratio, 1)}x C/P`);
    score += options.imbalance_tier === 'heavy' || options.imbalance_tier === 'extreme' || options.imbalance_tier === 'absurd' ? 2 : 1;
  } else if (options?.flow_bias === 'put_heavy') {
    signals.push(`Options contradiction / hedge: ${num(options.put_call_volume_ratio, 1)}x P/C`);
  }
  const valuationGap = Number(fundamentals?.valuation_gap_pct);
  if (Number.isFinite(valuationGap) && valuationGap > 15) {
    signals.push(`Ledger valuation support: ${pct(valuationGap)}`);
    score += 1;
  }
  if (socialAlignment?.status === 'social_confirmed') {
    signals.push(`Social buzz confirmation: ${socialAlignment.score} social/eigen score`);
    score += 2;
  } else if (socialAlignment?.status === 'social_supportive') {
    signals.push(`Social buzz support: ${socialAlignment.score} social/eigen score`);
    score += 1;
  }
  let risk_level = 'LOW';
  if (score >= 7) risk_level = 'HIGH';
  else if (score >= 4) risk_level = 'ELEVATED';
  return {
    risk_level,
    summary: signals.length
      ? `${signals.length} signal(s) across eigen pressure, options, and Ledger valuation.`
      : 'Eigen residual row; investigate only if fresh corroboration appears.',
    signals,
  };
}

function eigenSocialBuzzNarrativeSection(report: any): string {
  const s = report.social_buzz;
  const a = report.social_eigen_alignment;
  const socialLine = s?.available
    ? `Social/eigen status ${a?.status || 'N/A'} with score ${num(a?.score, 1)}. Latest social day ${s.latest_trade_date || 'N/A'}: ${s.mention_count_7d ?? 0} 7D mention(s), ${s.unique_authors_7d ?? 0} unique 7D author(s), sentiment ${num(s.weighted_sentiment ?? s.net_sentiment, 2)}, platforms ${(s.platforms || []).join(', ') || 'none'}. Buzz validity ${s.buzz_score?.score_validity || 'N/A'}; reasons ${(s.buzz_score?.reason_codes || []).join(', ') || 'none'}.`
    : `No usable social buzz snapshot (${s?.reason || 'unavailable'}).`;
  return `**SOCIAL BUZZ CONFIRMATION:** ${socialLine} Social confirmation should improve confidence only when attention is broadening, recent, and not author-concentrated; thin or stale buzz should not upgrade the setup.`;
}

function eigenOptionsNarrativeSection(report: any): string {
  const o = report.options_flow;
  if (!o) {
    return [
      '## OPTIONS CONFIRMATION',
      'No local options snapshot is available for this symbol yet. This is a data-coverage gap in our system, not evidence that the market lacks options interest, and it should not be described as confirming or contradicting the eigen signal.',
    ].join('\n');
  }

  const bias = o.flow_bias || 'balanced';
  const tier = o.imbalance_tier || 'normal';
  const callPut = Number(o.call_put_volume_ratio ?? o.call_put_ratio ?? 0);
  const putCall = Number(o.put_call_volume_ratio ?? o.put_call_ratio ?? 0);
  const calls = Number(o.total_call_volume || 0).toLocaleString();
  const puts = Number(o.total_put_volume || 0).toLocaleString();
  let interpretation = 'Options flow is balanced, so it does not materially confirm or contradict the eigen signal.';
  if (bias === 'call_heavy') {
    interpretation = 'Options flow is call-heavy, which is bullish options confirmation for a positive eigen pressure setup.';
  } else if (bias === 'put_heavy') {
    interpretation = 'Options flow is put-heavy, which is a bearish/hedging contradiction against a positive eigen pressure setup unless explained by protective hedging or event risk.';
  }
  return [
    '## OPTIONS CONFIRMATION',
    `Local options data is available for ${o.trade_date || 'the latest snapshot'}: ${bias} ${tier}, C/P ${num(callPut, 2)}, P/C ${num(putCall, 2)}, calls ${calls}, puts ${puts}. ${interpretation}`,
  ].join('\n');
}

function ensureEigenSocialBuzzSection(narrative: string | null, report: any): string | null {
  if (!narrative) return narrative;
  if (/social\s+buzz\s+confirmation/i.test(narrative)) return narrative;
  const socialSection = eigenSocialBuzzNarrativeSection(report);
  if (/\n\s*#+\s*options\s+confirmation/i.test(narrative)) {
    return narrative.replace(/\n\s*(#+\s*options\s+confirmation)/i, `\n\n${socialSection}\n\n$1`);
  }
  if (/\*\*OPTIONS\s+CONFIRMATION:\*\*/i.test(narrative)) {
    return narrative.replace(/(\*\*OPTIONS\s+CONFIRMATION:\*\*)/i, `${socialSection}\n\n$1`);
  }
  if (/\n\s*#+\s*ledger\s+cross-check/i.test(narrative)) {
    return narrative.replace(/\n\s*(#+\s*ledger\s+cross-check)/i, `\n\n${socialSection}\n\n$1`);
  }
  if (/\*\*LEDGER\s+CROSS-CHECK:\*\*/i.test(narrative)) {
    return narrative.replace(/(\*\*LEDGER\s+CROSS-CHECK:\*\*)/i, `${socialSection}\n\n$1`);
  }
  return `${narrative.trim()}\n\n${socialSection}`;
}

function ensureEigenOptionsSection(narrative: string | null, report: any): string | null {
  if (!narrative) return narrative;
  const optionsSection = eigenOptionsNarrativeSection(report);
  const markdownSection =
    /(^|\n)##\s*OPTIONS\s+CONFIRMATION\b[\s\S]*?(?=\n##\s*(?:LEDGER\s+CROSS-CHECK|ENTRY\s+WATCH|TRADE|CONFIDENCE|BOTTOM\s+LINE)\b|$)/i;
  if (markdownSection.test(narrative)) {
    return narrative.replace(markdownSection, (_match, prefix) => `${prefix}${optionsSection}`);
  }
  const boldSection =
    /(^|\n)\*\*OPTIONS\s+CONFIRMATION:\*\*[\s\S]*?(?=\n\*\*(?:LEDGER\s+CROSS-CHECK|TRADE|ENTRY\s+WATCH|CONFIDENCE|BOTTOM\s+LINE)\b|$)/i;
  if (boldSection.test(narrative)) {
    return narrative.replace(boldSection, (_match, prefix) => `${prefix}${optionsSection}`);
  }
  if (/\n\s*#+\s*ledger\s+cross-check/i.test(narrative)) {
    return narrative.replace(/\n\s*(#+\s*ledger\s+cross-check)/i, `\n\n${optionsSection}\n\n$1`);
  }
  if (/\*\*LEDGER\s+CROSS-CHECK:\*\*/i.test(narrative)) {
    return narrative.replace(/(\*\*LEDGER\s+CROSS-CHECK:\*\*)/i, `${optionsSection}\n\n$1`);
  }
  return `${narrative.trim()}\n\n${optionsSection}`;
}

function deterministicEigenBrief(report: any): string {
  const r = report.eigen;
  const f = report.fundamentals;
  const c = report.catalyst_evidence;
  const w = report.web_catalyst_check;
  const valuationLine = f && !f.unavailable
    ? `${f.valuation_engine || 'valuation engine N/A'}, valuation ${f.valuation_state || 'N/A'} (${pct(f.valuation_gap_pct)}), quality ${f.quality_grade || f.quality_score || 'N/A'}, revenue growth ${pct(f.revenue_growth_pct)}, risk flags ${(f.risk_flags || []).map((x: any) => x.code).join(', ') || 'none'}.`
    : 'Ledger fundamentals are unavailable from the local fundamentals API.';
  const evidenceItems = Array.isArray(c?.items) ? c.items : [];
  const reliableEvidenceItems = Array.isArray(c?.reliable_items) ? c.reliable_items : [];
  const catalystLine = evidenceItems.length
    ? `${evidenceItems.length} recent local evidence item(s) found across ${(c.source_summary || []).length} source bucket(s), but only ${reliableEvidenceItems.length} passed the alias-quality filter. ${c.alias_risk_count ? `${c.alias_risk_count} item(s) have alias false-positive risk and must not be treated as catalyst evidence unless corroborated by ticker/cashtag/company context.` : 'No obvious short-alias warning in the sampled evidence.'}`
    : 'No recent local social/news evidence was found for this symbol; catalyst hunt must start with earnings, filings, press releases, deal announcements, and sector news.';
  const webLine = w?.source_count
    ? `Open-web check found ${w.source_count} source(s) from ${(w.sources || []).map((s: any) => s.source).filter(Boolean).slice(0, 5).join(', ') || 'public web'}; flags ${(w.quality_flags || []).join(', ') || 'none'}. Use these to confirm or reject the local catalyst thesis.`
    : `Open-web catalyst check found no usable public-web corroboration${w?.error ? ` (${w.error})` : ''}. Treat this as unverified until fresh primary or reliable news evidence appears.`;
  return [
    `**EIGEN SIGNAL:** ${report.symbol} is showing positive residual pressure with z ${num(r.residual_z, 2)}, 1-day z change ${num(r.residual_z_change_1d, 2)}, and 3-day z slope ${num(r.residual_z_slope_3d, 2)}. The stock moved ${pct(r.actual_return_pct)} on the signal day, with ${pct(r.unexplained_return_pct)} unexplained by the factor model. This is classified as ${report.setup_label}.`,
    `**CATALYST HUNT:** ${catalystLine} ${webLine} If the catalyst is a merger, tender offer, acquisition, go-private transaction, liquidation, or other corporate action, reclassify this as a special situation and do not treat it as a normal buy candidate just because the valuation gap is positive.`,
    eigenSocialBuzzNarrativeSection(report),
    eigenOptionsNarrativeSection(report),
    `**LEDGER CROSS-CHECK:** ${valuationLine}`,
    `**TRADE/INVALIDATION:** Prefer an entry watch or pullback/continuation plan, not a blind chase. Invalidation is a close back below the signal-day low or loss of the residual/volume pressure on the next daily scan. Bottom line: ${report.verdict.risk_level} - ${report.verdict.summary}`,
  ].join('\n\n');
}

async function generateEigenNarrative(apiKey: string, report: any): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const ledgerDoctrine = loadLedgerWorkspaceSkill('market-intelligence-investigation', [
    'eigen-perturbation-report.md',
  ]);
  const prompt = `You are Ledger, a skeptical financial analyst inside a market-intelligence workstation.

Use the Ledger workspace doctrine below as your governing instructions. The evidence packet follows after the doctrine.

LEDGER WORKSPACE DOCTRINE:
${ledgerDoctrine}

EIGEN SETUP:
${JSON.stringify(report.eigen, null, 2)}

OPTIONS FLOW:
${JSON.stringify(report.options_flow, null, 2)}

LOCAL CATALYST EVIDENCE FROM MARKET INTELLIGENCE DB:
${JSON.stringify(report.catalyst_evidence, null, 2)}

SOCIAL BUZZ / EIGEN ALIGNMENT:
${JSON.stringify({
  social_buzz: report.social_buzz,
  social_eigen_alignment: report.social_eigen_alignment,
}, null, 2)}

OPEN-WEB CATALYST CHECK:
${JSON.stringify(report.web_catalyst_check, null, 2)}

LEDGER FUNDAMENTAL / VALUATION CROSS-CHECK:
${JSON.stringify(report.fundamentals, null, 2)}

Write the concise intelligence brief required by the Eigen Perturbation Report document. Reference specific numbers. No disclaimers.

Required headings, exactly once and in this order:
## EIGEN SIGNAL
## CATALYST HUNT
## SOCIAL BUZZ CONFIRMATION
## OPTIONS CONFIRMATION
## LEDGER CROSS-CHECK
## ENTRY WATCH / INVALIDATION

Do not merge social buzz into Catalyst Hunt. The Social Buzz Confirmation section must explicitly say whether social attention confirms, supports, contradicts/stales, or fails to confirm the eigen signal.

Options rule: if OPTIONS FLOW is non-null, local options data is available. Never say options data is unavailable while also citing C/P or P/C ratios. If OPTIONS FLOW is null, say there is no local options snapshot and do not invent ratios.`;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 850,
      }),
    });
    const result = await response.json() as any;
    return result.choices?.[0]?.message?.content || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildEigenInvestigationReport(
  symbol: string,
  row: any,
  options: { generateNarrative?: boolean } = {},
): Promise<any> {
  const optionsFlow = latestOptionSnapshot(symbol);
  const catalystEvidence = latestSymbolCatalystEvidence(symbol);
  const socialBuzz = latestSocialBuzzSnapshot(symbol);
  const socialEigenAlignment = buildSocialEigenAlignment(row, socialBuzz);
  const snapshot = await fetchFundamentalSnapshot(symbol);
  const fundamentals = snapshot ? summarizeFundamentals(symbol, snapshot) : { symbol, unavailable: true };
  const companyName = bulkLookupSymbolNames([symbol])[symbol] || null;
  const webCatalystCheck = await runWebCatalystCheck({
    symbol,
    companyName,
    maxSources: 8,
  });
  const setupLabel = isPreExplosionEigenPressure(row)
    ? 'positive_pre_explosion_pressure'
    : Number(row.residual_z) > 0
      ? 'positive_residual_watch'
      : 'not_a_long_pressure_setup';
  const report: any = {
    symbol,
    generated_at: new Date().toISOString(),
    eigen_report_schema_version: EIGEN_REPORT_SCHEMA_VERSION,
    scan_id: latestEigenScanId(),
    setup_label: setupLabel,
    eigen: row,
    options_flow: optionsFlow,
    catalyst_evidence: catalystEvidence,
    social_buzz: socialBuzz,
    social_eigen_alignment: socialEigenAlignment,
    web_catalyst_check: webCatalystCheck,
    fundamentals,
  };
  report.verdict = eigenVerdict(row, optionsFlow, fundamentals, socialEigenAlignment);
  let narrative: string | null = null;
  if (options.generateNarrative !== false) {
    try {
      const apiKey = getConfiguredOpenAIKey();
      if (apiKey) narrative = await generateEigenNarrative(apiKey, report);
    } catch {
      narrative = null;
    }
  }
  const socialNarrative = ensureEigenSocialBuzzSection(narrative, report);
  report.narrative = ensureEigenOptionsSection(socialNarrative, report) || deterministicEigenBrief(report);
  report.schema_version = MARKET_INTELLIGENCE_SCHEMA_VERSION;
  return report;
}

async function precompileEigenInvestigationReports(
  limit = 12,
  options: { symbols?: string[]; force?: boolean } = {},
): Promise<{
  attempted: number;
  cached: number;
  skipped: number;
  failed: Array<{ symbol: string; error: string }>;
}> {
  const symbolSet = new Set(
    (options.symbols || [])
      .map((symbol) => String(symbol || '').trim().toUpperCase())
      .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,8}$/.test(symbol)),
  );
  const rows = latestEigenRows(1000)
    .filter((row) => isPreExplosionEigenPressure(row))
    .filter((row) => !symbolSet.size || symbolSet.has(String(row?.symbol || '').trim().toUpperCase()))
    .slice(0, Math.max(1, Math.min(50, limit)));
  const failed: Array<{ symbol: string; error: string }> = [];
  let cached = 0;
  let skipped = 0;
  for (const row of rows) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    if (!options.force && readCachedEigenReport(symbol)) {
      skipped += 1;
      continue;
    }
    try {
      const report = await buildEigenInvestigationReport(symbol, row, { generateNarrative: true });
      report.precompiled = true;
      writeCachedEigenReport(symbol, report);
      cached += 1;
    } catch (err: any) {
      failed.push({ symbol, error: err?.message || String(err) });
    }
  }
  return { attempted: rows.length, cached, skipped, failed };
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

  const minEvidence = asNumber(raw.min_evidence);
  q.min_evidence = minEvidence !== undefined ? minEvidence : 2;

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
// EXPOSURE OVERRIDE endpoints (PRD §Operator Override, Phase 2)
// ============================================================================

router.get('/scenarios/:id_or_slug/report', async (req: Request, res: Response) => {
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
    const report = await buildScenarioIntelligenceReport(detail);
    res.json({ success: true, data: report });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

const VALID_ASSET_TYPES = new Set([
  'equity', 'sector', 'industry', 'commodity', 'fx', 'rate', 'etf',
]);
const VALID_EXPOSURE_DIRECTIONS = new Set([
  'long_beneficiary', 'short_loser', 'volatility_up', 'volatility_down',
  'direction_uncertain',
]);
const VALID_EXPOSURE_ORDERS = new Set(['first', 'second', 'third']);

router.post(
  '/scenarios/:id_or_slug/exposure',
  (req: Request, res: Response) => {
    try {
      ensureDbReady();
      const situationId = parseInt(String(req.params.id_or_slug), 10);
      if (isNaN(situationId)) {
        return sendError(res, 'VALIDATION_ERROR', 'Invalid situation id');
      }

      const body = req.body || {};
      const { asset_type, asset_key, exposure_direction, exposure_order,
              exposure_strength, rationale, confidence, universe_symbol } = body;

      if (!asset_type || !VALID_ASSET_TYPES.has(asset_type)) {
        return sendError(
          res, 'VALIDATION_ERROR',
          `asset_type must be one of: ${[...VALID_ASSET_TYPES].join(', ')}`,
        );
      }
      if (!asset_key || typeof asset_key !== 'string') {
        return sendError(res, 'VALIDATION_ERROR', 'asset_key is required');
      }
      if (!exposure_direction || !VALID_EXPOSURE_DIRECTIONS.has(exposure_direction)) {
        return sendError(
          res, 'VALIDATION_ERROR',
          `exposure_direction must be one of: ${[...VALID_EXPOSURE_DIRECTIONS].join(', ')}`,
        );
      }
      if (!exposure_order || !VALID_EXPOSURE_ORDERS.has(exposure_order)) {
        return sendError(
          res, 'VALIDATION_ERROR',
          `exposure_order must be one of: ${[...VALID_EXPOSURE_ORDERS].join(', ')}`,
        );
      }
      const strength = parseFloat(exposure_strength);
      const conf = parseFloat(confidence);
      if (isNaN(strength) || strength < 0 || strength > 1) {
        return sendError(res, 'VALIDATION_ERROR', 'exposure_strength must be 0..1');
      }
      if (isNaN(conf) || conf < 0 || conf > 1) {
        return sendError(res, 'VALIDATION_ERROR', 'confidence must be 0..1');
      }

      const result = upsertExposureOverride({
        situation_id: situationId,
        asset_type,
        asset_key: String(asset_key),
        exposure_direction,
        exposure_order,
        exposure_strength: strength,
        rationale: rationale ? String(rationale) : undefined,
        confidence: conf,
        universe_symbol: universe_symbol ? String(universe_symbol) : null,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof HttpError) return sendError(res, err.code, err.message);
      sendError(res, 'INTERNAL', err?.message || String(err));
    }
  },
);

router.delete(
  '/exposure/:id',
  (req: Request, res: Response) => {
    try {
      ensureDbReady();
      const exposureId = parseInt(String(req.params.id), 10);
      if (isNaN(exposureId)) {
        return sendError(res, 'VALIDATION_ERROR', 'Invalid exposure id');
      }
      const deleted = deleteExposureOverride(exposureId);
      if (!deleted) {
        return sendError(res, 'NOT_FOUND', `Exposure row ${exposureId} not found`);
      }
      res.json({ success: true, deleted: true });
    } catch (err: any) {
      if (err instanceof HttpError) return sendError(res, err.code, err.message);
      sendError(res, 'INTERNAL', err?.message || String(err));
    }
  },
);

// ============================================================================
// EMERGING-TOPICS endpoints (Research tab) — PRD §2.6 / §2.7
// ============================================================================

const ALLOWED_EMERGING_TARGET_TYPES: ReadonlySet<string> = new Set([
  'brand',
  'product',
  'category',
  'behavior',
  'keyword',
  'event_type',
]);

function parseEmergingTopicListQuery(raw: Request['query']): EmergingTopicListQuery {
  const q: EmergingTopicListQuery = {};

  const minZ = asNumber(raw.min_z);
  if (minZ !== undefined) q.min_z = minZ;

  const minAuth = asNumber(raw.min_authenticity);
  if (minAuth !== undefined) q.min_authenticity = minAuth;

  const crossPlatform = asBoolean(raw.cross_platform_only);
  if (crossPlatform !== undefined) q.cross_platform_only = crossPlatform;

  const community = asString(raw.community);
  if (community) q.community = community;

  const targetType = asString(raw.concept_target_type);
  if (targetType) {
    if (!ALLOWED_EMERGING_TARGET_TYPES.has(targetType)) {
      throw new HttpError(
        'VALIDATION_ERROR',
        `Invalid concept_target_type: '${targetType}'. ` +
          `Allowed: ${Array.from(ALLOWED_EMERGING_TARGET_TYPES).join(', ')}`,
      );
    }
    q.concept_target_type = targetType as TargetType;
  }

  const seededOnly = asBoolean(raw.seeded_only);
  if (seededOnly !== undefined) q.seeded_only = seededOnly;

  const includeSuppressed = asBoolean(raw.include_suppressed);
  if (includeSuppressed !== undefined) q.include_suppressed = includeSuppressed;

  const limit = asNumber(raw.limit);
  if (limit !== undefined) q.limit = limit;

  return q;
}

router.get('/emerging-topics', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const query = parseEmergingTopicListQuery(req.query);
    const result = listEmergingTopics(query);
    res.json({
      success: true,
      data: {
        items: result.items,
        count: result.items.length,
        total: result.total,
        limit: query.limit,
        applied_filters: result.applied_filters,
        as_of: Math.floor(Date.now() / 1000),
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// NARRATIVE RADAR — clustered claims before/after scenario promotion
// ============================================================================

router.get('/social-arb/audit', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const days = asNumber(req.query.days) ?? 7;
    const data = getSocialArbEngineAudit(days);
    res.json({
      success: true,
      data: {
        ...data,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/social-arb/universe-movers', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const limit = asNumber(req.query.limit) ?? 50;
    const data = listUniverseSymbolPerturbations(limit);
    res.json({
      success: true,
      data: {
        ...data,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
        as_of: Math.floor(Date.now() / 1000),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/eigen-perturbations/latest', (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(500, asNumber(req.query.limit) ?? 100));
    const live = readJsonIfExists(EIGEN_LIVE_OUTPUT);
    if (!live) {
      throw new HttpError(
        'NOT_FOUND',
        'Eigen perturbation output is missing. Run scheduler job eigen_perturbation_scan first.',
      );
    }

    const replay = readJsonIfExists(EIGEN_REPLAY_OUTPUT);
    const rawMovers = Array.isArray(live.top_residual_movers)
      ? live.top_residual_movers.slice(0, limit)
      : [];
    const optionSnapshots = latestOptionSnapshotsBySymbol(
      rawMovers.map((row: any) => row?.symbol),
    );
    const movers = rawMovers.map((row: any) => {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol) return row;
      return {
        ...row,
        options_flow: optionSnapshots[symbol] || row.options_flow || null,
        precompiled_report: !!readCachedEigenReport(symbol),
      };
    });

    res.json({
      success: true,
      data: {
        live: {
          meta: live.meta || {},
          load_stats: live.load_stats || {},
          pca: live.pca || {},
          top_residual_movers: movers,
          total_top_residual_movers: Array.isArray(live.top_residual_movers)
            ? live.top_residual_movers.length
            : movers.length,
          file_age_seconds: fileAgeSeconds(EIGEN_LIVE_OUTPUT),
        },
        replay: replay
          ? {
              meta: replay.meta || {},
              replay_summary: replay.replay_summary || {},
              aggregate: replay.aggregate || {},
              file_age_seconds: fileAgeSeconds(EIGEN_REPLAY_OUTPUT),
            }
          : null,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
        as_of: Math.floor(Date.now() / 1000),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/reacceleration-screen/latest', (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(500, asNumber(req.query.limit) ?? 100));
    const asOf = String(req.query.as_of || '2026-05-29').slice(0, 10);
    const rangePosMax = asNumber(req.query.range_pos_max) ?? 0.10;
    const revenueGrowthMin = asNumber(req.query.revenue_ttm_growth_min) ?? 17.7;
    const minDollarVolume = asNumber(req.query.min_dollar_volume) ?? 1_000_000;
    const symbols = cleanUniverseSymbols();
    const priceRows: any[] = [];
    for (const symbol of symbols) {
      const price = latestPriceFeatures(symbol, asOf);
      if (!price) continue;
      if (Number(price.range_pos_252d) > rangePosMax) continue;
      if ((Number(price.dollar_volume_63d) || 0) < minDollarVolume) continue;
      priceRows.push({ symbol, ...price });
    }

    const fundamentals = loadFundamentalRows(priceRows.map((row) => row.symbol), asOf);
    const rows = priceRows
      .map((row) => {
        const features = fundamentalReaccelerationFeatures(fundamentals.get(row.symbol) || []);
        if (!features) return null;
        if (features.revenue_ttm_growth_pct == null || features.revenue_ttm_growth_pct < revenueGrowthMin) return null;
        const qualityFlags = [
          features.current_ratio != null && features.current_ratio < 0.75 ? 'liquidity stress' : null,
          features.net_margin_latest_pct != null && features.net_margin_latest_pct < -50 ? 'heavy losses' : null,
          row.dollar_volume_63d != null && row.dollar_volume_63d < 5_000_000 ? 'thin liquidity' : null,
        ].filter(Boolean);
        return {
          symbol: row.symbol,
          as_of: row.as_of,
          price: row.price,
          range_pos_252d: row.range_pos_252d,
          revenue_ttm_growth_pct: features.revenue_ttm_growth_pct,
          dollar_volume_63d: row.dollar_volume_63d,
          current_ratio: features.current_ratio,
          net_margin_latest_pct: features.net_margin_latest_pct,
          latest_period_end: features.latest_period_end,
          quality_flags: qualityFlags,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const liqA = Number(a.dollar_volume_63d || 0);
        const liqB = Number(b.dollar_volume_63d || 0);
        const revA = Number(a.revenue_ttm_growth_pct || 0);
        const revB = Number(b.revenue_ttm_growth_pct || 0);
        return revB - revA || liqB - liqA;
      });

    res.json({
      success: true,
      data: {
        meta: {
          as_of: asOf,
          symbols_in_clean_universe: symbols.length,
          depressed_liquid_symbols: priceRows.length,
          total_matches: rows.length,
          returned: Math.min(limit, rows.length),
          screen: {
            range_pos_252d_lte: rangePosMax,
            revenue_ttm_growth_pct_gte: revenueGrowthMin,
            dollar_volume_63d_gte: minDollarVolume,
          },
        },
        rows: rows.slice(0, limit),
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/convergence/latest', (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(500, asNumber(req.query.limit) ?? 100));
    const tierFilter = asNumber(req.query.tier);
    const dbPath = getMarketIntelligenceDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new HttpError('NOT_FOUND', `market-intelligence.sqlite missing at ${dbPath}.`);
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tableRow = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='mi_convergence'`,
      ).get() as { name?: string } | undefined;
      if (!tableRow) {
        throw new HttpError(
          'NOT_FOUND',
          'No convergence data yet. Run backend/scripts/run_eigen_perturbation_lab.py to build the mi_convergence table.',
        );
      }

      const latest = db.prepare(
        `SELECT run_id, generated_at, as_of
         FROM mi_convergence
         ORDER BY generated_at DESC, id DESC
         LIMIT 1`,
      ).get() as { run_id?: string; generated_at?: string; as_of?: string } | undefined;
      if (!latest?.run_id) {
        throw new HttpError('NOT_FOUND', 'mi_convergence table is empty.');
      }

      const params: any[] = [latest.run_id];
      let tierClause = '';
      if (tierFilter && [1, 2, 3].includes(tierFilter)) {
        tierClause = ' AND tier = ?';
        params.push(tierFilter);
      }

      // Optional free-text search across symbol/name/sector. When present we
      // search the WHOLE latest run (raise the cap) so a low-score match still
      // surfaces instead of being cut off by the top-N score ordering.
      const searchTerm = String(req.query.q ?? '').trim().toUpperCase();
      let searchClause = '';
      let effectiveLimit = limit;
      if (searchTerm) {
        searchClause = ' AND (UPPER(symbol) LIKE ? OR UPPER(name) LIKE ? OR UPPER(sector) LIKE ?)';
        const like = `%${searchTerm}%`;
        params.push(like, like, like);
        effectiveLimit = 500;
      }
      params.push(effectiveLimit);

      const rawRows = db.prepare(
        `SELECT symbol, name, sector, residual_z, direction, convergence_score,
                tier, aligned_count, signal_count,
                COALESCE(narrative_only, 0) AS narrative_only,
                votes_json, overlays_json
         FROM mi_convergence
         WHERE run_id = ?${tierClause}${searchClause}
         ORDER BY convergence_score DESC, aligned_count DESC
         LIMIT ?`,
      ).all(...params) as any[];

      const parseJson = (raw: any, fallback: any) => {
        if (typeof raw !== 'string') return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
      };
      const rows = rawRows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        residual_z: r.residual_z,
        direction: r.direction,
        convergence_score: r.convergence_score,
        tier: r.tier,
        aligned_count: r.aligned_count,
        signal_count: r.signal_count,
        narrative_only: !!r.narrative_only,
        votes: parseJson(r.votes_json, []),
        overlays: parseJson(r.overlays_json, {}),
        precompiled_report: !!readCachedEigenReport(String(r.symbol || '').toUpperCase()),
      }));

      const tierCounts = db.prepare(
        `SELECT tier, COUNT(*) AS n FROM mi_convergence WHERE run_id = ? GROUP BY tier`,
      ).all(latest.run_id) as Array<{ tier: number; n: number }>;
      const counts: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0 };
      for (const tc of tierCounts) {
        if (tc.tier === 1) counts.tier1 = tc.n;
        else if (tc.tier === 2) counts.tier2 = tc.n;
        else if (tc.tier === 3) counts.tier3 = tc.n;
      }

      res.json({
        success: true,
        data: {
          run_id: latest.run_id,
          generated_at: latest.generated_at,
          as_of: latest.as_of,
          tier_counts: counts,
          total: counts.tier1 + counts.tier2 + counts.tier3,
          rows,
          schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
        },
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// Agent-summarized "what's going on behind the scenes?" for a convergence row.
// Cheap, no-LLM pre-filter: drop obvious social noise so we only spend tokens on
// posts that might contain a real business thesis. This is the cost-control gate
// that lets the extractor run automatically over the whole convergence board.
const THESIS_NOISE_PATTERNS: RegExp[] = [
  /\bRSI\s*[:=]/i, /\bMACD\s*[:=]/i, /\bMA\s*\d{1,3}\s*[:=]/i, /\bvol\s*[:=]\s*\d/i,
  /\bentry\s*[:=].*\bexit\s*[:=]/i, /\bROI\s*[:=]?\s*\d/i, /\bcontracts? to trade/i,
  /quantumstockalerts|dailypickai|freealerts|stockalert|\.com\/free/i,
  /to the moon|🚀|🌙|💎|🙌/i,
  /\bRECAP\b/i, /\b52[\s-]?week (low|high)\b/i, /buy sell high/i,
  /^\$[A-Z]{1,6}[\s.!?]*$/,
  // Acronym collisions: tickers that double as finance jargon. e.g. RMD = Required
  // Minimum Distribution; these retirement/benefits posts are not about the company.
  /\b(required )?minimum distribution\b/i,
  /\bsocial security (benefit|check|income|payment)/i,
  /\b(401\(?k\)?|roth ira|traditional ira)\b/i,
];

// Topicality gate: a company NAME appearing in a long post does not mean the
// post is ABOUT the company. Long-form sources (esp. HackerNews) drag in
// structural noise where the name is incidental — monthly hiring/resume threads
// ("Location:/Remote:/Technologies: ... MongoDB ..."), freelance solicitations,
// and bare tech-stack enumerations. These score high on length and would crowd
// the limited model window with non-thesis text. Drop them deterministically.
const INCIDENTAL_MENTION_PATTERNS: RegExp[] = [
  /\bwho('?s| is| wants to be)\s+(hiring|hired)\b/i, // HN "Who is hiring / wants to be hired"
  /\b(seeking|hiring)\s+(a\s+)?(freelanc|contractor)/i,
  /\bfreelancer\?\b/i,
  /\bwilling to relocate\b/i,
  /\bremote\s*:\s*(yes|no|only|hybrid)\b/i,
  /\blocation\s*:\s*.{1,40}\bremote\s*:/is, // resume template (location + remote lines)
  /\btechnologies\s*:\s*\S/i, // resume/stack enumeration label
];

// $CASHTAG matcher used to detect multi-ticker "co-tag" pump/list posts.
const CASHTAG_RE = /\$([A-Za-z]{1,6})\b/g;

// Generic business-argument / causal cue words. Used to rank which posts carry a
// real thesis (vs equally-long off-topic chatter) when selecting what the model
// reads. Deliberately symbol-agnostic so it does not overfit to any one story.
const ARG_CUE_RE = /\b(because|due to|leads? to|result(?:s|ing)?|replac|disrupt|displac|cannibal|substitut|threat|risk|decline|erod|demand|revenue|margin|market share|earnings|guidance|competit|patent|recall|approval|adoption|tailwind|headwind|secular|moat|obsolet|undermin)\b/gi;

function thesisSubstanceScore(text: string): number {
  const t = String(text || '');
  let score = t.length;
  const cues = t.match(ARG_CUE_RE);
  if (cues && cues.length) score += 150 + cues.length * 40; // bias toward argument-bearing posts
  return score;
}

function isThesisNoise(text: string | null | undefined, symbol?: string | null): boolean {
  const t = String(text || '').trim();
  if (t.length < 25) return true;
  if (t.split(/\s+/).length < 6) return true;
  if (THESIS_NOISE_PATTERNS.some((re) => re.test(t))) return true;
  // Topicality gate: incidental name-drops (hiring/resume/stack-list posts).
  if (INCIDENTAL_MENTION_PATTERNS.some((re) => re.test(t))) return true;
  // Bare tool/stack enumeration: a long comma list with no business-argument
  // language is a catalog (e.g. "Next.js, React, MongoDB, Postgres, ..."), not a
  // thesis. Require argument cues to survive when comma density is high.
  const commaCount = (t.match(/,/g) || []).length;
  const cueCount = (t.match(ARG_CUE_RE) || []).length;
  if (commaCount >= 8 && cueCount === 0) return true;
  // Co-tag spam: collect distinct cashtags. Posts that tag many tickers are
  // lists/cross-promotion, not a single-name business thesis.
  const tags: string[] = [];
  CASHTAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASHTAG_RE.exec(t)) !== null) {
    const tag = m[1].toUpperCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length >= 4) return true;
  // Piggyback co-tag: target tagged alongside another ticker that LEADS the post
  // (classic microcap pump riding a liquid name's feed, e.g. "$IXHL $RMD ...").
  // Only drop SHORT such posts — a long co-tagged post may carry a real cross-name
  // thesis (e.g. a disruptor pill vs an incumbent's CPAP business), so keep those
  // and let the model judge.
  if (symbol && tags.length >= 2 && t.length < 140) {
    const sym = symbol.toUpperCase();
    if (tags[0] !== sym && tags.includes(sym)) return true;
  }
  return false;
}

// Gather the social evidence for a symbol: live buzz first (fresh, what the
// Scanner shows), then stored snapshot, then the organic-discovery feed.
async function gatherSymbolBuzzItems(symbol: string): Promise<{
  items: any[]; buzzSummary: string | null; dataFreshness: string; qualityFlags: any[];
}> {
  const items: any[] = [];
  let buzzSummary: string | null = null;
  let dataFreshness = 'none';

  try {
    const port = process.env.PORT || '3002';
    // Bound the live buzz sub-fetch: for an uncached symbol it can trigger a slow
    // upstream download and stall the entire thesis path for minutes. The stored
    // and MI corpora below are a sufficient fallback, so cap and move on.
    const liveCtl = new AbortController();
    const liveTimer = setTimeout(() => liveCtl.abort(), 8000);
    let liveRes: globalThis.Response;
    let livePayload: any;
    try {
      liveRes = await fetch(
        `http://127.0.0.1:${port}/api/fundamentals/${encodeURIComponent(symbol)}/buzz`,
        { signal: liveCtl.signal },
      );
      livePayload = await liveRes.json() as any;
    } finally {
      clearTimeout(liveTimer);
    }
    const live = livePayload?.data;
    if (liveRes.ok && livePayload?.success && live) {
      const msgs = Array.isArray(live.recent_messages) ? live.recent_messages : [];
      for (const m of msgs) {
        if (!m.body) continue;
        items.push({
          source_type: m.source || 'social', source_community: null,
          posted_at: m.created_at || m.posted_at || null,
          author: m.user || m.author || null, title: null,
          excerpt: String(m.body).slice(0, 320), sentiment: m.sentiment || null,
          source_url: m.source_url || null, alias_risk: false,
        });
      }
      if (msgs.length) dataFreshness = 'live';
      buzzSummary = [
        live.source_label ? `sources ${live.source_label}` : '',
        live.sampled_message_count != null ? `${live.sampled_message_count} sampled` : '',
        live.watchlist_count != null ? `${live.watchlist_count} watchers` : '',
        (live.bullish_pct != null || live.bearish_pct != null) ? `bull/bear ${live.bullish_pct ?? '?'}%/${live.bearish_pct ?? '?'}%` : '',
      ].filter(Boolean).join(' · ') || null;
    }
  } catch { /* live fetch is best-effort */ }

  if (!items.length) {
    const buzz = latestSocialBuzzSnapshot(symbol);
    if (buzz?.available) {
      const bs = buzz.buzz_score || {};
      buzzSummary = [
        `final buzz ${bs.final_buzz_score ?? 'n/a'} (${bs.score_validity || 'n/a'}/${bs.confidence_tier || 'n/a'})`,
        `7d mentions ${buzz.mention_count_7d ?? 'n/a'}, 7d authors ${buzz.unique_authors_7d ?? 'n/a'}`,
        Array.isArray(bs.reason_codes) && bs.reason_codes.length ? `flags ${bs.reason_codes.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      for (const m of (buzz.recent_messages || [])) {
        if (!m.body) continue;
        items.push({
          source_type: m.source || 'social', source_community: null,
          posted_at: m.posted_at, author: m.author, title: null,
          excerpt: m.body, sentiment: m.sentiment, source_url: null, alias_risk: false,
        });
      }
      if (items.length) dataFreshness = 'stored';
    }
  }

  // Deep historical corpus: the stored cleaned posts hold sharper theses that may
  // have already scrolled out of the live rolling window. Pull a wider window so
  // aged-out causal posts (e.g. the GLP-1 thesis) are not missed.
  try {
    if (fs.existsSync(SOCIAL_INTELLIGENCE_DB_PATH)) {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(SOCIAL_INTELLIGENCE_DB_PATH, { readOnly: true });
      try {
        // Two passes so a substantive thesis can't age out behind a flood of
        // recent low-substance chatter: (1) most RECENT posts for freshness, and
        // (2) the LONGEST posts across ALL history — long-form posts carry the
        // argument (e.g. the GLP-1 -> CPAP demand thesis that surfaced months ago).
        const recentRows = db.prepare(
          `SELECT platform, posted_at, cleaned_text
           FROM social_posts_clean
           WHERE UPPER(symbol) = ? AND COALESCE(is_spam, 0) = 0
             AND cleaned_text IS NOT NULL AND LENGTH(TRIM(cleaned_text)) > 0
           ORDER BY posted_at DESC LIMIT 100`,
        ).all(symbol.toUpperCase()) as any[];
        const substantiveRows = db.prepare(
          `SELECT platform, posted_at, cleaned_text
           FROM social_posts_clean
           WHERE UPPER(symbol) = ? AND COALESCE(is_spam, 0) = 0
             AND cleaned_text IS NOT NULL AND LENGTH(TRIM(cleaned_text)) > 60
           ORDER BY LENGTH(cleaned_text) DESC LIMIT 60`,
        ).all(symbol.toUpperCase()) as any[];
        const rows = [...recentRows, ...substantiveRows];
        for (const r of rows) {
          items.push({
            source_type: r.platform || 'social', source_community: null,
            posted_at: r.posted_at, author: null, title: null,
            excerpt: String(r.cleaned_text).slice(0, 320), sentiment: null,
            source_url: null, alias_risk: false,
          });
        }
        if (rows.length && dataFreshness === 'none') dataFreshness = 'stored';
      } finally { db.close(); }
    }
  } catch { /* deep corpus is best-effort */ }

  // Substantive cross-platform corpus: HackerNews / niche forums / 4chan
  // long-form arguments mapped to this symbol via universe_symbol_mentions
  // (now precision-filtered — bare acronyms and generic-word aliases removed).
  // The catalyst-evidence pull below is recency-bounded and can miss the LONGEST
  // argument posts, which carry the actual causal thesis (the same reason the
  // social_posts_clean block above runs a "longest posts" pass). Pull the
  // longest reliable mentions explicitly so HN/forum substance reaches the
  // substance-ranked window the model reads.
  try {
    const miPath = getMarketIntelligenceDbPath();
    if (fs.existsSync(miPath)) {
      const { DatabaseSync } = require('node:sqlite');
      const mdb = new DatabaseSync(miPath, { readOnly: true });
      try {
        const hasTbl = mdb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='universe_symbol_mentions'`,
        ).get() as { name?: string } | undefined;
        if (hasTbl) {
          const rows = mdb.prepare(
            `SELECT h.source_type, h.title, h.body_text, h.source_url,
                    m.posted_at, m.author, m.matched_text, m.match_method
             FROM universe_symbol_mentions m
             JOIN mi_raw_hits h ON h.id = m.hit_id
             WHERE m.symbol = ?
               AND h.body_text IS NOT NULL
               AND LENGTH(TRIM(h.body_text)) > 120
             ORDER BY LENGTH(h.body_text) DESC
             LIMIT 40`,
          ).all(symbol.toUpperCase()) as any[];
          for (const r of rows) {
            // With the hardened matcher, company_alias / cashtag / bare-ticker
            // matches are all trustworthy; alias_risk is effectively retired here.
            const body = String(r.body_text || '').replace(/\s+/g, ' ').trim();
            if (!body) continue;
            items.push({
              source_type: r.source_type || 'web', source_community: null,
              posted_at: r.posted_at, author: r.author,
              title: r.title ? String(r.title).slice(0, 200) : null,
              excerpt: body.slice(0, 420), sentiment: null,
              source_url: r.source_url || null, alias_risk: false,
            });
          }
          if (rows.length && dataFreshness === 'none') dataFreshness = 'stored';
        }
      } finally { mdb.close(); }
    }
  } catch { /* substantive MI corpus is best-effort */ }

  const evidence = latestSymbolCatalystEvidence(symbol);
  for (const it of (Array.isArray(evidence?.items) ? evidence.items : [])) {
    items.push({
      source_type: it.source_type, source_community: it.source_community,
      posted_at: it.posted_at, author: it.author, title: it.title,
      excerpt: it.excerpt, sentiment: null, source_url: it.source_url, alias_risk: it.alias_risk,
    });
    if (dataFreshness === 'none') dataFreshness = 'stored';
  }

  // Dedupe by normalized text (live + stored corpora overlap heavily).
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    const k = String(it.excerpt || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => String(b.posted_at || '').localeCompare(String(a.posted_at || '')));
  return { items: deduped, buzzSummary, dataFreshness, qualityFlags: evidence?.quality_flags ?? [] };
}

export interface ExtractedThesis {
  claim: string;
  driver: string | null;
  mechanism: string | null;
  direction: 'bull' | 'bear' | null;
  specificity: number | null;
  sources: number[];
}

export interface ThesisResult {
  has_thesis: boolean;
  theses: ExtractedThesis[];
  headline: string | null;
  narrative: string | null;
  classification: string | null;
  signal_count: number;
  noise_count: number;
  used_sources: any[];
}

const THESIS_CLASSES = [
  'Narrative ahead of damage',
  'Narrative ahead of improvement',
  'Hype ahead of economics',
  'Fear ahead of evidence',
  'Recovery before recognition',
  'Real risk, but likely over-discounted',
  'Real excitement, but likely over-earned in price',
];

// The thesis extractor: separate the rare real business thesis from social noise.
async function extractSymbolThesis(
  apiKey: string,
  symbol: string,
  footprint: { direction?: string; convergence_score?: number; tier?: number; narrative_only?: boolean; votes?: any[] },
  items: any[],
  buzzSummary: string | null,
): Promise<ThesisResult> {
  const all = Array.isArray(items) ? items : [];
  const signal = all.filter((it) => !isThesisNoise(it.excerpt, symbol));
  const empty: ThesisResult = {
    has_thesis: false, theses: [], headline: null, narrative: null,
    classification: null, signal_count: signal.length, noise_count: all.length - signal.length,
    used_sources: [],
  };
  if (!signal.length) return empty;

  // Select what the model reads by SUBSTANCE, not recency: a real causal thesis
  // is a prose ARGUMENT, while noise is short. Ranking by length alone is unstable
  // — when the live feed is busy, equally-long off-topic chatter (e.g. buyout
  // threads) evicts the thesis posts from the window, so the SAME symbol can
  // return a thesis on one page and "no thesis" on another. Score by length PLUS
  // business-argument cue words so causal posts win their slots deterministically.
  const used = [...signal]
    .map((it) => ({ it, score: thesisSubstanceScore(String(it.excerpt || '')) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 36)
    .map((x) => x.it);
  const usedSources = used.map((it, i) => ({
    idx: i + 1, source_type: it.source_type, source_community: it.source_community,
    posted_at: it.posted_at, author: it.author, title: it.title,
    excerpt: it.excerpt, source_url: it.source_url, alias_risk: it.alias_risk,
  }));
  const numbered = used.map((it, i) => {
    const parts = [
      `[${i + 1}] (${it.source_type || '?'}, ${it.posted_at || '?'})`,
      it.title ? `title: ${it.title}` : '',
      it.excerpt ? `text: ${it.excerpt}` : '',
      it.alias_risk ? '(ALIAS RISK)' : '',
    ].filter(Boolean);
    return parts.join(' ');
  }).join('\n');

  const footprintLabel = footprint.narrative_only
    ? `${symbol} has NO hard footprint yet — it surfaced ONLY from a social buzz spike (narrative-only).`
    : `${symbol} is on the convergence board: direction ${footprint.direction || 'n/a'}, score ${footprint.convergence_score ?? 'n/a'}, tier ${footprint.tier ?? 'n/a'}.`;

  const prompt = `You are Ledger, a skeptical market-intelligence analyst monitoring social buzz in real time. Your job is NOT to summarize chatter. Detect whether these posts contain a MATERIAL, NON-OBVIOUS business thesis about ${symbol} — a concrete causal claim of the form: external driver -> mechanism -> impact on the company's economics (e.g. "GLP-1 weight-loss drugs -> less obesity -> less sleep apnea -> fewer CPAP sales -> ResMed demand risk").

Ignore noise: price targets, emojis, RSI/MACD/MA bot posts, recap lists, generic hype or fear with no mechanism, multi-ticker pump/co-tag list posts (a post tagging ${symbol} alongside unrelated tickers — especially a microcap leading the post), and posts where "${symbol}" is a coincidental acronym rather than the company (e.g. RMD = Required Minimum Distribution / retirement content). Only count a thesis if there is a real causal argument about the business.

The thesis is often IMPLICIT, SPREAD ACROSS several posts, or stated only as a REBUTTAL — a post arguing "the GLP-1 worry is overdone" or "a pill could replace CPAP" still reveals a real demand-risk thesis worth surfacing. Synthesize the underlying thesis from fragments across posts. You MAY use well-known cause-and-effect to complete the MECHANISM (e.g. GLP-1/weight-loss drugs reduce obesity -> obesity drives sleep apnea -> sleep apnea drives CPAP demand -> ${symbol} revenue) as long as the DRIVER (e.g. "GLP-1", "Ozempic", a competing pill) and the COMPANY LINK are actually mentioned in the posts. Do not invent a driver the posts never mention.

${footprintLabel}
${buzzSummary ? `BUZZ CONTEXT: ${buzzSummary}` : ''}

POSTS (numbered):
${numbered}

Return STRICT JSON only:
{
  "has_thesis": boolean,
  "theses": [ { "claim": "<=20 words", "driver": "external force e.g. GLP-1 drugs", "mechanism": "how it flows to the company's economics", "direction": "bull"|"bear", "specificity": 0.0-1.0, "sources": [post numbers] } ],
  "headline": "<=12 word tag of the most important thesis, or null",
  "narrative": "2-4 plain-English sentences citing [n], or null",
  "classification": one of ${JSON.stringify(THESIS_CLASSES)} or null
}
Rules: If the posts are only noise with no causal business thesis, set has_thesis=false, theses=[], headline=null, narrative=null, classification=null. Do not invent facts not present in the posts.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: getRoleModelOverride('thesis_extractor') || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: 'json_object' },
      }),
    });
    const result = await response.json() as any;
    // Surface API failures (e.g. 429 insufficient_quota) instead of silently
    // returning empty — otherwise a billing/quota error is mislabeled in the UI
    // as "no real business thesis detected", which is dangerously misleading.
    if (!response.ok || result?.error) {
      const detail = result?.error?.message || `OpenAI API error ${response.status}`;
      throw new Error(detail);
    }
    const raw = result.choices?.[0]?.message?.content;
    if (!raw) return empty;
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return empty; }
    const theses: ExtractedThesis[] = Array.isArray(parsed.theses) ? parsed.theses.map((t: any) => ({
      claim: String(t.claim || '').slice(0, 200),
      driver: t.driver ? String(t.driver).slice(0, 80) : null,
      mechanism: t.mechanism ? String(t.mechanism).slice(0, 300) : null,
      direction: (t.direction === 'bull' || t.direction === 'bear') ? t.direction : null,
      specificity: typeof t.specificity === 'number' ? t.specificity : null,
      sources: Array.isArray(t.sources) ? t.sources.filter((n: any) => Number.isInteger(n)) : [],
    })).filter((t: ExtractedThesis) => t.claim) : [];
    const classification = THESIS_CLASSES.includes(parsed.classification) ? parsed.classification : null;
    return {
      has_thesis: Boolean(parsed.has_thesis) && theses.length > 0,
      theses,
      headline: parsed.headline ? String(parsed.headline).slice(0, 120) : null,
      narrative: parsed.narrative ? String(parsed.narrative) : null,
      classification,
      signal_count: signal.length,
      noise_count: all.length - signal.length,
      used_sources: usedSources,
    };
  } finally {
    clearTimeout(timeout);
  }
}

router.get('/convergence/:symbol/catalyst', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) throw new HttpError('VALIDATION_ERROR', 'symbol is required');

    // Footprint context for the symbol (latest convergence run), best-effort.
    let footprint: any = {};
    const dbPath = getMarketIntelligenceDbPath();
    if (fs.existsSync(dbPath)) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const has = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='mi_convergence'`,
          ).get() as { name?: string } | undefined;
          if (has) {
            const row = db.prepare(
              `SELECT direction, convergence_score, tier,
                      COALESCE(narrative_only, 0) AS narrative_only, votes_json
               FROM mi_convergence WHERE symbol = ?
               ORDER BY generated_at DESC LIMIT 1`,
            ).get(symbol) as any;
            if (row) {
              footprint = {
                direction: row.direction,
                convergence_score: row.convergence_score,
                tier: row.tier,
                narrative_only: !!row.narrative_only,
                votes: (() => { try { return JSON.parse(row.votes_json || '[]'); } catch { return []; } })(),
              };
            }
          }
        } finally {
          db.close();
        }
      } catch { /* footprint is best-effort */ }
    }

    const { items, buzzSummary, dataFreshness, qualityFlags } = await gatherSymbolBuzzItems(symbol);

    let thesis: ThesisResult | null = null;
    let narrativeStatus = 'ok';
    let narrativeDetail: string | null = null;
    if (!items.length) {
      narrativeStatus = 'no_evidence';
    } else {
      const apiKey = getConfiguredOpenAIKey();
      if (!apiKey) {
        narrativeStatus = 'no_api_key';
      } else {
        try {
          thesis = await extractSymbolThesis(apiKey, symbol, footprint, items, buzzSummary);
          if (!thesis) narrativeStatus = 'empty';
          else if (!thesis.has_thesis) narrativeStatus = 'no_thesis';
          // Persist so the Ledger DCF (and future backtests) can read this
          // thesis without paying for another model call.
          if (thesis) recordAdhocNarrativeThesis(symbol, thesis);
        } catch (e: any) {
          narrativeStatus = /quota|429|rate limit/i.test(String(e?.message || '')) ? 'quota' : 'error';
          narrativeDetail = String(e?.message || 'Thesis extraction failed').slice(0, 240);
        }
      }
    }

    res.json({
      success: true,
      data: {
        symbol,
        footprint,
        narrative: thesis?.narrative ?? null,
        narrative_status: narrativeStatus,
        narrative_detail: narrativeDetail,
        has_thesis: thesis?.has_thesis ?? false,
        headline: thesis?.headline ?? null,
        theses: thesis?.theses ?? [],
        classification: thesis?.classification ?? null,
        signal_count: thesis?.signal_count ?? 0,
        noise_count: thesis?.noise_count ?? 0,
        buzz_summary: buzzSummary,
        data_freshness: dataFreshness,
        evidence_count: items.length,
        reliable_item_count: (thesis?.used_sources ?? []).filter((it: any) => !it.alias_risk).length,
        quality_flags: qualityFlags,
        sources: thesis?.used_sources ?? [],
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ---------------------------------------------------------------------------
// Narrative thesis scan: run the thesis extractor across the whole convergence
// board and cache results so the UI can show ⚠ thesis flags instantly. Because
// each symbol takes ~30s (deep corpus + LLM), this runs as a background batch
// (auto-triggered after each convergence run) and the board reads the cache.
// ---------------------------------------------------------------------------

function ensureNarrativeThesesTable(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mi_narrative_theses (
    run_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    has_thesis INTEGER NOT NULL DEFAULT 0,
    headline TEXT,
    classification TEXT,
    direction TEXT,
    theses_json TEXT,
    narrative TEXT,
    signal_count INTEGER,
    noise_count INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, symbol)
  )`);
}

// How long a cached thesis stays "fresh". Theses are cached per symbol and
// reused across eigen runs; a board scan only spends LLM calls on symbols that
// are new to the board or whose thesis is older than this. With the daily
// scheduled eigen run (~24h apart) this yields a once-a-day refresh, while
// repeated runs within a day (e.g. a manual eigen re-run) cost nothing.
const THESIS_FRESH_HOURS = 20;

let _thesisScanRunning = false;
let _thesisScanStatus: { running: boolean; run_id: string | null; scanned: number; total: number; with_thesis: number; started_at: string | null; finished_at: string | null } = {
  running: false, run_id: null, scanned: 0, total: 0, with_thesis: 0, started_at: null, finished_at: null,
};

async function scanBoardThesesInternal(opts: { limit?: number; force?: boolean } = {}): Promise<typeof _thesisScanStatus> {
  if (_thesisScanRunning) return _thesisScanStatus;
  const dbPath = getMarketIntelligenceDbPath();
  const apiKey = getConfiguredOpenAIKey();
  if (!fs.existsSync(dbPath) || !apiKey) return _thesisScanStatus;
  _thesisScanRunning = true;
  _thesisScanStatus = { running: true, run_id: null, scanned: 0, total: 0, with_thesis: 0, started_at: new Date().toISOString(), finished_at: null };
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    ensureNarrativeThesesTable(db);
    const latest = db.prepare(
      `SELECT run_id FROM mi_convergence ORDER BY generated_at DESC, id DESC LIMIT 1`,
    ).get() as { run_id?: string } | undefined;
    const runId = latest?.run_id || null;
    if (!runId) return _thesisScanStatus;
    _thesisScanStatus.run_id = runId;

    const board = db.prepare(
      `SELECT symbol, direction, convergence_score, tier,
              COALESCE(narrative_only, 0) AS narrative_only, votes_json
       FROM mi_convergence WHERE run_id = ?
       ORDER BY convergence_score DESC LIMIT ?`,
    ).all(runId, opts.limit ?? 40) as any[];

    // Incremental cache: a symbol is "done" if it already has a thesis newer
    // than THESIS_FRESH_HOURS — regardless of which run_id produced it. So only
    // board names that are new or stale get an LLM call; everything else is
    // carried forward from cache.
    const done = new Set<string>();
    if (!opts.force) {
      const cutoffIso = new Date(Date.now() - THESIS_FRESH_HOURS * 3600 * 1000).toISOString();
      for (const r of db.prepare(
        `SELECT symbol, MAX(updated_at) AS last_updated
         FROM mi_narrative_theses GROUP BY symbol`,
      ).all() as any[]) {
        if (r.last_updated && String(r.last_updated) >= cutoffIso) done.add(String(r.symbol));
      }
    }
    const todo = board.filter((b) => !done.has(String(b.symbol)));
    _thesisScanStatus.total = todo.length;

    const insert = db.prepare(
      `INSERT OR REPLACE INTO mi_narrative_theses
       (run_id, symbol, has_thesis, headline, classification, direction, theses_json, narrative, signal_count, noise_count, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );

    const concurrency = 3;
    for (let i = 0; i < todo.length; i += concurrency) {
      const batch = todo.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (b) => {
        const symbol = String(b.symbol).toUpperCase();
        const footprint = {
          direction: b.direction, convergence_score: b.convergence_score, tier: b.tier,
          narrative_only: !!b.narrative_only,
          votes: (() => { try { return JSON.parse(b.votes_json || '[]'); } catch { return []; } })(),
        };
        try {
          const { items, buzzSummary } = await gatherSymbolBuzzItems(symbol);
          const t = items.length ? await extractSymbolThesis(apiKey, symbol, footprint, items, buzzSummary) : null;
          return { symbol, t };
        } catch { return { symbol, t: null as ThesisResult | null }; }
      }));
      const now = new Date().toISOString();
      for (const { symbol, t } of results) {
        insert.run(
          runId, symbol, t?.has_thesis ? 1 : 0, t?.headline ?? null, t?.classification ?? null,
          t?.theses?.[0]?.direction ?? null, JSON.stringify(t?.theses ?? []), t?.narrative ?? null,
          t?.signal_count ?? 0, t?.noise_count ?? 0, now,
        );
        _thesisScanStatus.scanned += 1;
        if (t?.has_thesis) _thesisScanStatus.with_thesis += 1;
      }
    }
    return _thesisScanStatus;
  } finally {
    db.close();
    _thesisScanRunning = false;
    _thesisScanStatus = { ..._thesisScanStatus, running: false, finished_at: new Date().toISOString() };
  }
}

// Kick off a background board scan (fire-and-forget). Auto-called after each
// convergence run by the scheduler, and available manually.
router.post('/convergence/theses/scan', (req: Request, res: Response) => {
  const force = String(req.query.force || '') === '1' || req.body?.force === true;
  const limit = asNumber(req.query.limit) ?? undefined;
  if (_thesisScanRunning) {
    return res.json({ success: true, data: { started: false, reason: 'already_running', status: _thesisScanStatus } });
  }
  void scanBoardThesesInternal({ force, limit }).catch(() => { /* background */ });
  res.json({ success: true, data: { started: true, status: _thesisScanStatus } });
});

// Read cached theses for the latest convergence board (fast; no LLM).
router.get('/convergence/theses', (req: Request, res: Response) => {
  try {
    const dbPath = getMarketIntelligenceDbPath();
    if (!fs.existsSync(dbPath)) return res.json({ success: true, data: { run_id: null, theses: {}, scan_status: _thesisScanStatus } });
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mi_narrative_theses'`).get();
      const latest = db.prepare(`SELECT run_id FROM mi_convergence ORDER BY generated_at DESC, id DESC LIMIT 1`).get() as any;
      const runId = latest?.run_id || null;
      const map: Record<string, any> = {};
      if (tbl && runId) {
        // Carry forward: show the most recent thesis per symbol regardless of
        // which run produced it, so theses never "disappear" when a new eigen
        // run mints a fresh run_id before the incremental rescan completes.
        const boardSyms = new Set(
          (db.prepare(`SELECT DISTINCT symbol FROM mi_convergence WHERE run_id = ?`).all(runId) as any[])
            .map((r) => String(r.symbol)),
        );
        const rows = db.prepare(
          `SELECT t.* FROM mi_narrative_theses t
           JOIN (SELECT symbol, MAX(updated_at) AS mx FROM mi_narrative_theses GROUP BY symbol) m
             ON m.symbol = t.symbol AND m.mx = t.updated_at`,
        ).all() as any[];
        const freshCutoff = new Date(Date.now() - THESIS_FRESH_HOURS * 3600 * 1000).toISOString();
        for (const r of rows) {
          const sym = String(r.symbol);
          if (boardSyms.size && !boardSyms.has(sym)) continue;  // only current board names
          map[sym] = {
            has_thesis: !!r.has_thesis,
            headline: r.headline,
            classification: r.classification,
            direction: r.direction,
            signal_count: r.signal_count,
            noise_count: r.noise_count,
            theses: (() => { try { return JSON.parse(r.theses_json || '[]'); } catch { return []; } })(),
            narrative: r.narrative,
            updated_at: r.updated_at,
            stale: !(r.updated_at && String(r.updated_at) >= freshCutoff),
            from_run: r.run_id,
          };
        }
      }
      res.json({
        success: true,
        data: {
          run_id: runId,
          scanned_count: Object.keys(map).length,
          with_thesis: Object.values(map).filter((m: any) => m.has_thesis).length,
          theses: map,
          scan_status: _thesisScanStatus,
        },
      });
    } finally {
      db.close();
    }
  } catch (err: any) {
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/social-thesis-alerts', (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50) || 50));
    const dbPath = getMarketIntelligenceDbPath();
    if (!fs.existsSync(dbPath)) {
      return res.json({ success: true, data: { items: [], total: 0 } });
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    let rows: any[] = [];
    try {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mi_narrative_theses'`).get();
      if (!tbl) return res.json({ success: true, data: { items: [], total: 0 } });
      rows = db.prepare(
        `SELECT t.* FROM mi_narrative_theses t
         JOIN (
           SELECT symbol, MAX(updated_at) AS mx
           FROM mi_narrative_theses
           WHERE has_thesis = 1
           GROUP BY symbol
         ) m ON m.symbol = t.symbol AND m.mx = t.updated_at
         WHERE t.has_thesis = 1
         ORDER BY t.updated_at DESC
         LIMIT ?`,
      ).all(limit) as any[];
    } finally {
      db.close();
    }

    const latestBuzz: Record<string, any> = {};
    if (fs.existsSync(SOCIAL_INTELLIGENCE_DB_PATH) && rows.length) {
      const socialDb = new DatabaseSync(SOCIAL_INTELLIGENCE_DB_PATH, { readOnly: true });
      try {
        const stmt = socialDb.prepare(
          `SELECT trade_date, buzz_zscore, unique_author_zscore, engagement_zscore,
                  mention_velocity, mention_acceleration,
                  yahoo_mentions, stocktwits_mentions, final_buzz_score,
                  score_validity, is_score_valid
           FROM ticker_buzz_scores
           WHERE symbol = ?
           ORDER BY trade_date DESC
           LIMIT 1`,
        );
        for (const r of rows) {
          const sym = String(r.symbol || '').toUpperCase();
          latestBuzz[sym] = stmt.get(sym) || null;
        }
      } finally {
        socialDb.close();
      }
    }

    const freshCutoff = new Date(Date.now() - THESIS_FRESH_HOURS * 3600 * 1000).toISOString();
    const items = rows.map((r) => {
      let theses: any[] = [];
      try {
        const parsed = JSON.parse(r.theses_json || '[]');
        if (Array.isArray(parsed)) theses = parsed;
      } catch { /* ignore malformed cache rows */ }
      const sym = String(r.symbol || '').toUpperCase();
      return {
        symbol: sym,
        has_thesis: !!r.has_thesis,
        headline: r.headline,
        classification: r.classification,
        direction: r.direction,
        theses,
        narrative: r.narrative,
        signal_count: r.signal_count,
        noise_count: r.noise_count,
        updated_at: r.updated_at,
        stale: !(r.updated_at && String(r.updated_at) >= freshCutoff),
        from_run: r.run_id,
        latest_buzz: latestBuzz[sym] || null,
      };
    });

    return res.json({
      success: true,
      data: {
        items,
        total: items.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/event-risk-radar', (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 75) || 75));
    const days = Math.max(1, Math.min(180, Number(req.query.days || 45) || 45));
    const symbolFilter = String(req.query.symbol || '').trim().toUpperCase();
    if (symbolFilter && !/^[A-Z][A-Z0-9.-]{0,8}$/.test(symbolFilter)) {
      throw new HttpError('VALIDATION_ERROR', 'symbol must be a valid ticker');
    }
    if (!fs.existsSync(OPTIONS_FLOW_DB_PATH)) {
      return res.json({ success: true, data: { items: [], total: 0, as_of: null } });
    }

    const { DatabaseSync } = require('node:sqlite');
    const optionsDb = new DatabaseSync(OPTIONS_FLOW_DB_PATH, { readOnly: true });
    let alertRows: any[] = [];
    let asOf: string | null = null;
    try {
      const latest = optionsDb.prepare(`SELECT MAX(trade_date) AS trade_date FROM options_flow_alerts`).get() as any;
      asOf = latest?.trade_date || null;
      if (!asOf) return res.json({ success: true, data: { items: [], total: 0, as_of: null } });
      const cutoffMs = Date.parse(`${asOf}T00:00:00Z`) - (days - 1) * 86_400_000;
      const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
      const sql = `
        SELECT symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at
        FROM options_flow_alerts
        WHERE trade_date >= ?
        ${symbolFilter ? 'AND symbol = ?' : ''}
        ORDER BY trade_date DESC, symbol ASC`;
      alertRows = symbolFilter
        ? optionsDb.prepare(sql).all(cutoff, symbolFilter) as any[]
        : optionsDb.prepare(sql).all(cutoff) as any[];
    } finally {
      optionsDb.close();
    }

    const bySymbol = new Map<string, any>();
    const severityRank: Record<string, number> = { critical: 4, high: 3, notable: 2, medium: 2, low: 1 };
    for (const row of alertRows) {
      const sym = String(row.symbol || '').toUpperCase();
      if (!sym) continue;
      const current = bySymbol.get(sym) || {
        symbol: sym,
        latest_trade_date: row.trade_date,
        alert_count: 0,
        critical_count: 0,
        high_count: 0,
        downside_count: 0,
        upside_count: 0,
        max_severity: row.severity || null,
        option_headlines: [],
        alerts: [],
      };
      current.alert_count += 1;
      const sev = String(row.severity || '').toLowerCase();
      if (sev === 'critical') current.critical_count += 1;
      if (sev === 'high') current.high_count += 1;
      if (severityRank[sev] > severityRank[String(current.max_severity || '').toLowerCase()]) {
        current.max_severity = row.severity;
      }
      if (String(row.trade_date || '') > String(current.latest_trade_date || '')) current.latest_trade_date = row.trade_date;
      const blob = `${row.alert_type || ''} ${row.headline || ''} ${row.detail || ''}`.toLowerCase();
      if (/\bputs?\b|\bdownside\b|\bskew\b|\bprotection\b|\bbear(?:ish)?\b/.test(blob)) current.downside_count += 1;
      if (/\bcalls?\b|\bupside\b|\bbull(?:ish)?\b/.test(blob)) current.upside_count += 1;
      if (current.option_headlines.length < 3 && row.headline) current.option_headlines.push(row.headline);
      if (current.alerts.length < 6) {
        current.alerts.push({
          trade_date: row.trade_date,
          alert_type: row.alert_type,
          severity: row.severity,
          headline: row.headline,
          detail: row.detail,
        });
      }
      bySymbol.set(sym, current);
    }

    const symbols = Array.from(bySymbol.keys());
    const latestBuzz: Record<string, any> = {};
    const socialContext: Record<string, any> = {};
    if (symbols.length && fs.existsSync(SOCIAL_INTELLIGENCE_DB_PATH)) {
      const socialDb = new DatabaseSync(SOCIAL_INTELLIGENCE_DB_PATH, { readOnly: true });
      try {
        const buzzStmt = socialDb.prepare(`
          SELECT trade_date, buzz_zscore, unique_author_zscore, engagement_zscore,
                 mention_velocity, mention_acceleration, yahoo_mentions, stocktwits_mentions,
                 final_buzz_score, score_validity, is_score_valid
          FROM ticker_buzz_scores
          WHERE symbol = ?
          ORDER BY trade_date DESC
          LIMIT 1`);
        const postStmt = socialDb.prepare(`
          SELECT posted_at, platform, author_handle, body_text, like_count, reply_count, engagement_score
          FROM social_posts_raw
          WHERE symbol = ?
            AND posted_at >= ?
            AND body_text IS NOT NULL
            AND LENGTH(TRIM(body_text)) > 0
          ORDER BY posted_at DESC
          LIMIT 8`);
        for (const sym of symbols) {
          latestBuzz[sym] = buzzStmt.get(sym) || null;
          const posts = postStmt.all(sym, new Date(Date.now() - days * 86_400_000).toISOString()) as any[];
          const keywordCounts: Record<string, number> = {
            trial: 0, safety: 0, approval: 0, dilution: 0, shorting: 0, fraud: 0, earnings: 0,
          };
          for (const post of posts) {
            const text = String(post.body_text || '').toLowerCase();
            if (/trial|phase|lotis|data|fda|drug|study/.test(text)) keywordCounts.trial += 1;
            if (/safety|adverse|death|fatal|grade 5|toxicity/.test(text)) keywordCounts.safety += 1;
            if (/approval|accepted|filing|pdufa/.test(text)) keywordCounts.approval += 1;
            if (/dilution|offering|atm|cash|runway/.test(text)) keywordCounts.dilution += 1;
            if (/short|shorting|puts|put|hedge/.test(text)) keywordCounts.shorting += 1;
            if (/fraud|investigat|lawsuit|sec/.test(text)) keywordCounts.fraud += 1;
            if (/earnings|revenue|eps|guidance/.test(text)) keywordCounts.earnings += 1;
          }
          socialContext[sym] = {
            keyword_counts: keywordCounts,
            posts: posts.slice(0, 4).map((post) => ({
              posted_at: post.posted_at,
              platform: post.platform,
              author: post.author_handle,
              text: String(post.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 220),
              likes: post.like_count,
              replies: post.reply_count,
              engagement: post.engagement_score,
            })),
          };
        }
      } finally {
        socialDb.close();
      }
    }

    const latestTheses: Record<string, any> = {};
    const miDbPath = getMarketIntelligenceDbPath();
    if (symbols.length && fs.existsSync(miDbPath)) {
      const miDb = new DatabaseSync(miDbPath, { readOnly: true });
      try {
        const tbl = miDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mi_narrative_theses'`).get();
        if (tbl) {
          const thesisStmt = miDb.prepare(`
            SELECT t.*
            FROM mi_narrative_theses t
            JOIN (SELECT symbol, MAX(updated_at) AS mx FROM mi_narrative_theses WHERE symbol = ? GROUP BY symbol) m
              ON m.symbol = t.symbol AND m.mx = t.updated_at
            LIMIT 1`);
          for (const sym of symbols) latestTheses[sym] = thesisStmt.get(sym) || null;
        }
      } finally {
        miDb.close();
      }
    }

    const items = Array.from(bySymbol.values()).map((item: any) => {
      const buzz = latestBuzz[item.symbol] || null;
      const thesis = latestTheses[item.symbol] || null;
      const social = socialContext[item.symbol] || { keyword_counts: {}, posts: [] };
      const buzzZ = Number(buzz?.buzz_zscore);
      const score =
        item.critical_count * 30 +
        item.high_count * 15 +
        item.downside_count * 18 +
        item.upside_count * 6 +
        (Number.isFinite(buzzZ) && buzzZ >= 4 ? 24 : Number.isFinite(buzzZ) && buzzZ >= 2 ? 12 : 0) +
        (thesis?.has_thesis ? 22 : 0) +
        Math.min(18, Object.values(social.keyword_counts || {}).reduce((n: number, v: any) => n + Number(v || 0), 0) * 3);
      const posture = item.downside_count && item.upside_count
        ? 'binary_event'
        : item.downside_count
          ? 'downside_protection'
          : item.upside_count
            ? 'upside_speculation'
            : 'options_anomaly';
      return {
        ...item,
        risk_score: Math.round(score),
        posture,
        latest_buzz: buzz,
        social_context: social,
        thesis: thesis ? {
          has_thesis: !!thesis.has_thesis,
          headline: thesis.headline,
          classification: thesis.classification,
          direction: thesis.direction,
          updated_at: thesis.updated_at,
        } : null,
      };
    }).sort((a: any, b: any) => b.risk_score - a.risk_score || String(b.latest_trade_date).localeCompare(String(a.latest_trade_date))).slice(0, limit);

    return res.json({
      success: true,
      data: {
        items,
        total: items.length,
        as_of: asOf,
        lookback_days: days,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/eigen-perturbations/:symbol/report', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,8}$/.test(symbol)) {
      throw new HttpError('VALIDATION_ERROR', 'symbol must be a valid ticker');
    }
    const forceRefresh = asBoolean(req.query.refresh) ?? false;
    if (!forceRefresh) {
      const cached = readCachedEigenReport(symbol);
      if (cached) {
        return res.json({
          success: true,
          data: {
            ...cached,
            cache_hit: true,
            schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
          },
        });
      }
    }
    const row = latestEigenRows(1000).find((item) => String(item?.symbol || '').toUpperCase() === symbol);
    if (!row) {
      throw new HttpError('NOT_FOUND', `No latest eigen perturbation row found for ${symbol}`);
    }
    const report = await buildEigenInvestigationReport(symbol, row, { generateNarrative: true });
    writeCachedEigenReport(symbol, report);
    res.json({
      success: true,
      data: {
        ...report,
        cache_hit: false,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.post('/eigen-perturbations/precompile', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const bodySymbols = Array.isArray(body.symbols) ? body.symbols : undefined;
    const symbols = asStringList(req.query.symbols) || bodySymbols;
    const limit = Math.max(
      1,
      Math.min(50, asNumber(req.query.limit) ?? asNumber(body.limit) ?? (symbols?.length || 12)),
    );
    const force = asBoolean(req.query.force) ?? Boolean(body.force);
    const result = await precompileEigenInvestigationReports(limit, { symbols, force });
    res.json({
      success: true,
      data: {
        ...result,
        requested_symbols: symbols || null,
        scan_id: latestEigenScanId(),
        cache_dir: EIGEN_REPORT_CACHE_DIR,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
        as_of: Math.floor(Date.now() / 1000),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/social-arb/promoted-topics', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const limit = asNumber(req.query.limit) ?? 200;
    const includePruned = asBoolean(req.query.include_pruned) ?? false;
    const data = listSocialArbPromotedTopicLedger(limit, includePruned);
    res.json({
      success: true,
      data: {
        ...data,
        include_pruned: includePruned,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
        as_of: Math.floor(Date.now() / 1000),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/narrative-clusters', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const q = req.query as Record<string, unknown>;
    const query: NarrativeClusterListQuery = {};

    const status = asString(q.status);
    if (status) {
      const allowed: ReadonlySet<string> = new Set([
        'WATCH',
        'RESEARCH',
        'SCENARIO_READY',
        'PROMOTED',
        'INVALIDATED',
        'ARCHIVED',
        'all',
      ]);
      if (!allowed.has(status)) {
        return sendError(
          res,
          'VALIDATION_ERROR',
          `status must be one of: ${[...allowed].join(', ')}`,
        );
      }
      query.status = status as NarrativeClusterStatus | 'all';
    }

    const primaryTheme = asString(q.primary_theme);
    if (primaryTheme) query.primary_theme = primaryTheme;

    const limit = asNumber(q.limit);
    if (limit !== undefined) query.limit = limit;

    const result = listNarrativeClusters(query);
    res.json({
      success: true,
      data: {
        items: result.items,
        count: result.items.length,
        total: result.total,
        applied_filters: result.applied_filters,
        as_of: Math.floor(Date.now() / 1000),
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/narrative-clusters/:id/report', async (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const id = asNumber(req.params.id);
    if (id === undefined || !Number.isInteger(id) || id <= 0) {
      return sendError(
        res,
        'VALIDATION_ERROR',
        `Invalid narrative-cluster id: '${req.params.id}'`,
      );
    }
    const detail = getNarrativeClusterDetail(id);
    if (!detail) {
      return sendError(res, 'NOT_FOUND', `No narrative_cluster with id=${id}`);
    }
    const report = await buildNarrativeClusterReport(detail);
    res.json({ success: true, data: report });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/narrative-clusters/:id', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const id = asNumber(req.params.id);
    if (id === undefined || !Number.isInteger(id) || id <= 0) {
      return sendError(
        res,
        'VALIDATION_ERROR',
        `Invalid narrative-cluster id: '${req.params.id}'`,
      );
    }
    const detail = getNarrativeClusterDetail(id);
    if (!detail) {
      return sendError(res, 'NOT_FOUND', `No narrative_cluster with id=${id}`);
    }
    res.json({ success: true, data: detail });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get(
  '/emerging-topics/:id/authenticity',
  (req: Request, res: Response) => {
    try {
      ensureDbReady();
      const id = asNumber(req.params.id);
      if (id === undefined || !Number.isInteger(id) || id <= 0) {
        return sendError(
          res,
          'VALIDATION_ERROR',
          `Invalid emerging-topic id: '${req.params.id}'`,
        );
      }
      const asOf = asNumber(req.query.as_of);
      const breakdown = getEmergingTopicAuthenticity(id, asOf);
      if (!breakdown) {
        return sendError(
          res,
          'NOT_FOUND',
          `No emerging_topic with id=${id}`,
        );
      }
      res.json({ success: true, data: breakdown });
    } catch (err: any) {
      if (err instanceof HttpError) return sendError(res, err.code, err.message);
      sendError(res, 'INTERNAL', err?.message || String(err));
    }
  },
);

// ============================================================================
// COVERAGE-TIERS endpoint — PRD §2.8
// ============================================================================

router.get('/coverage-tiers/:symbol', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const symbol = String(req.params.symbol || '').trim();
    if (!symbol) {
      return sendError(res, 'VALIDATION_ERROR', 'Missing symbol param');
    }
    const tier = getCoverageTierForSymbol(symbol);
    if (!tier) {
      return sendError(
        res,
        'NOT_FOUND',
        `No coverage_tiers row for symbol='${symbol.toUpperCase()}'. ` +
          'Run backend/scripts/refresh_coverage_tiers.py to populate it.',
      );
    }
    res.json({
      success: true,
      data: { ...tier, schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// OPERATOR ACTIONS — tracked-concepts list / status, emerging-topics promote
// ============================================================================
//
// ============================================================================
// QUALITY DASHBOARD — forward-tracking metrics + theme quality (Phase 5)
// ============================================================================

router.get('/quality/dashboard', (_req: Request, res: Response) => {
  try {
    ensureDbReady();
    const snapshots = getQualityDashboard();
    res.json({ success: true, data: { snapshots, total: snapshots.length } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/quality/outcomes', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const situationId = req.query.situation_id
      ? parseInt(String(req.query.situation_id), 10)
      : undefined;
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '100'), 10), 1),
      500,
    );
    const outcomes = getScenarioOutcomes(situationId, limit);
    const symbols = [...new Set(outcomes.map((o) => o.symbol))];
    const nameMap = bulkLookupSymbolNames(symbols);
    const enriched = outcomes.map((o) => ({
      ...o,
      company_name: nameMap[o.symbol] || null,
    }));
    res.json({ success: true, data: { outcomes: enriched, total: enriched.length } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.post('/quality/outcomes/:situationId/:symbol/label', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const situationId = parseInt(String(req.params.situationId), 10);
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    const label = String(req.body?.label || '').trim();
    if (!Number.isFinite(situationId) || situationId < 1) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid situation_id');
    }
    if (!symbol) return sendError(res, 'VALIDATION_ERROR', 'Missing symbol');
    if (!['TRUE_POSITIVE', 'FALSE_POSITIVE', 'INCONCLUSIVE', ''].includes(label)) {
      return sendError(res, 'VALIDATION_ERROR', 'label must be TRUE_POSITIVE, FALSE_POSITIVE, or INCONCLUSIVE');
    }
    const ok = setOutcomeLabel(situationId, symbol, label || null as any);
    if (!ok) return sendError(res, 'NOT_FOUND', 'Outcome row not found');
    res.json({ success: true, data: { situationId, symbol, label } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// CONSUMER BRAND SIGNALS — Phase 6 D19
// ============================================================================

router.get('/brand-signals', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const brandKey = req.query.brand_key ? String(req.query.brand_key) : undefined;
    const sourceType = req.query.source_type ? String(req.query.source_type) : undefined;
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '100'), 10), 1),
      500,
    );
    const signals = getConsumerBrandSignals(brandKey, sourceType, limit);
    res.json({ success: true, data: { signals, total: signals.length } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.get('/brand-signals/score/:ticker', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const ticker = String(req.params.ticker || '').trim().toUpperCase();
    if (!ticker) return sendError(res, 'VALIDATION_ERROR', 'Missing ticker');
    const score = getConsumerBrandScore(ticker);
    res.json({ success: true, data: { ticker, consumer_brand_score: score } });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// PRD §Operator UI. Three endpoints power the prune/merge/promote workflow:
//
//   GET  /tracked-concepts             list with filters + 28d-hit rollup
//   POST /tracked-concepts/:id/status  set status to active|pruned|merged
//   POST /emerging-topics/:id/promote  spawn promoter for a single emerging id
//
// The first two are synchronous in-process DB writes (cheap). The third is
// a fire-and-forget Python subprocess so the operator gets an immediate
// 202-style response and can poll /scenarios/:id_or_slug to confirm.
// ============================================================================

router.get('/tracked-concepts', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const q = req.query as Record<string, unknown>;
    const query: TrackedConceptListQuery = {};

    const status = asString(q.status);
    if (status) {
      const allowed: ReadonlySet<string> = new Set([
        'active',
        'pruned',
        'merged',
        'all',
      ]);
      if (!allowed.has(status)) {
        return sendError(
          res,
          'VALIDATION_ERROR',
          `status must be one of: ${[...allowed].join(', ')}`,
        );
      }
      query.status = status as TrackedConceptStatus | 'all';
    }

    const targetType = asString(q.target_type);
    if (targetType) {
      query.target_type = targetType as TargetType;
    }
    const search = asString(q.search);
    if (search) query.search = search.trim();
    const limit = q.limit;
    if (limit !== undefined) {
      const n = Number(limit);
      if (Number.isFinite(n)) query.limit = Math.trunc(n);
    }

    const result = listTrackedConcepts(query);
    res.json({
      success: true,
      data: {
        items: result.items,
        total: result.total,
        applied_filters: query,
        schema_version: MARKET_INTELLIGENCE_SCHEMA_VERSION,
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

router.post('/tracked-concepts/:id/status', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid concept id');
    }

    const body = (req.body || {}) as {
      status?: unknown;
      merged_into_id?: unknown;
      reason?: unknown;
      actor?: unknown;
    };

    const status = String(body.status || '').trim() as TrackedConceptStatus;
    if (!status) {
      return sendError(res, 'VALIDATION_ERROR', 'Missing status in body');
    }

    let mergedIntoId: number | null = null;
    if (body.merged_into_id != null) {
      const n = Number(body.merged_into_id);
      if (!Number.isFinite(n) || n < 1) {
        return sendError(
          res,
          'VALIDATION_ERROR',
          'merged_into_id must be a positive integer',
        );
      }
      mergedIntoId = Math.trunc(n);
    }

    const result = updateTrackedConceptStatus(id, {
      status,
      merged_into_id: mergedIntoId,
      reason: body.reason == null ? null : String(body.reason),
      actor: body.actor == null ? null : String(body.actor),
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    const msg = err?.message || String(err);
    // updateTrackedConceptStatus throws plain Errors with descriptive text;
    // surface them as VALIDATION_ERROR / NOT_FOUND for a better operator UX.
    if (/not found/i.test(msg)) return sendError(res, 'NOT_FOUND', msg);
    if (
      /required|must|invalid|reference an existing|different concept/i.test(msg)
    ) {
      return sendError(res, 'VALIDATION_ERROR', msg);
    }
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', msg);
  }
});

const PROMOTER_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  'backend',
  'scripts',
  'promote_emerging_topics.py',
);

router.post('/emerging-topics/:id/promote', (req: Request, res: Response) => {
  try {
    ensureDbReady();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return sendError(
        res,
        'VALIDATION_ERROR',
        'Invalid emerging_topic id',
      );
    }

    const body = (req.body || {}) as {
      force?: unknown;
      dry_run?: unknown;
      verbose?: unknown;
    };

    const cliArgs: string[] = [
      '--emerging-id',
      String(Math.trunc(id)),
      '--verbose',
    ];
    if (asTruthy(body.force)) cliArgs.push('--force');
    if (asTruthy(body.dry_run)) cliArgs.push('--dry-run');

    if (!fs.existsSync(PROMOTER_SCRIPT_PATH)) {
      return sendError(
        res,
        'INTERNAL',
        `Promoter script missing at ${PROMOTER_SCRIPT_PATH}`,
      );
    }

    // Fire-and-forget: don't block the request. Operator polls
    // /scenarios/:id_or_slug or /emerging-topics?seeded_only=true after
    // the run to verify the new market_situation row appeared.
    const child = spawn(PYTHON_BIN, [PROMOTER_SCRIPT_PATH, ...cliArgs], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
      if (stdoutChunks.reduce((acc, b) => acc + b.length, 0) > 65_536) {
        stdoutChunks.shift();
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
      if (stderrChunks.reduce((acc, b) => acc + b.length, 0) > 65_536) {
        stderrChunks.shift();
      }
    });
    child.on('error', (err) => {
      console.warn(
        `[market-intelligence] promoter spawn failed for emerging_id=${id}: ${err}`,
      );
    });
    child.on('exit', (code) => {
      console.log(
        `[market-intelligence] promoter (emerging_id=${id}) exit_code=${code} ` +
          `stdout=${Buffer.concat(stdoutChunks).toString('utf-8').slice(-2_000)} ` +
          `stderr=${Buffer.concat(stderrChunks).toString('utf-8').slice(-2_000)}`,
      );
    });

    res.status(202).json({
      success: true,
      data: {
        accepted: true,
        emerging_topic_id: Math.trunc(id),
        force: asTruthy(body.force),
        dry_run: asTruthy(body.dry_run),
        pid: child.pid ?? null,
        cli: [PYTHON_BIN, PROMOTER_SCRIPT_PATH, ...cliArgs].join(' '),
      },
    });
  } catch (err: any) {
    if (err instanceof HttpError) return sendError(res, err.code, err.message);
    sendError(res, 'INTERNAL', err?.message || String(err));
  }
});

// ============================================================================
// BASE-BREAK CAUSE EXTRACTOR
//   GET /base-break-cause/:symbols
// For a symbol (or comma-separated list) that has left a multi-year price base,
// this runs the point-in-time cause extractor and returns, per symbol: the base
// + breakout, the PIT fundamental inflection (the leading cause), and a
// lead/lag verdict (did the fundamentals go public before price broke out?).
// Synchronous: the script is fast (~5s) and emits a JSON array on stdout.
// ============================================================================

const CAUSE_EXTRACTOR_SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  'backend',
  'scripts',
  'run_base_break_cause_extractor.py',
);

function runBaseBreakCause(symbols: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CAUSE_EXTRACTOR_SCRIPT_PATH)) {
      reject(new Error(`Cause extractor script missing at ${CAUSE_EXTRACTOR_SCRIPT_PATH}`));
      return;
    }
    const args = [
      CAUSE_EXTRACTOR_SCRIPT_PATH,
      '--symbols',
      symbols.join(','),
      '--json',
    ];
    const child = spawn(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (c) => out.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => err.push(Buffer.from(c)));
    child.on('error', (e) => reject(e));
    child.on('exit', (code) => {
      const stdout = Buffer.concat(out).toString('utf-8').trim();
      const stderr = Buffer.concat(err).toString('utf-8').trim();
      if (code !== 0) {
        reject(new Error(`extractor exit ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr: any) {
        reject(new Error(`failed to parse extractor output: ${parseErr?.message || parseErr}`));
      }
    });
  });
}

router.get('/base-break-cause/:symbols', async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.symbols || '');
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s))
      .slice(0, 12);
    if (!symbols.length) {
      return sendError(res, 'VALIDATION_ERROR', 'Provide 1-12 valid symbols, comma-separated.');
    }
    const results = await runBaseBreakCause(symbols);
    res.json({
      success: true,
      data: {
        results,
        symbols,
        script: 'backend/scripts/run_base_break_cause_extractor.py',
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

function scenarioEngineLabel(pathValue: string): string {
  if (pathValue === 'topic_anomaly') return 'Social Arbitrage';
  if (pathValue === 'mixed_anomaly_led') return 'Social Arbitrage + Macro';
  if (pathValue === 'mixed_news_led') return 'Macro + Social Arbitrage';
  return 'Macro Engine';
}

function pct(n: unknown, dec = 1): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return 'N/A';
  return `${x > 0 ? '+' : ''}${x.toFixed(dec)}%`;
}

function num(n: unknown, dec = 1): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return 'N/A';
  return x.toFixed(dec);
}

// Tickers named directly in the scenario TEXT (title/summary/claims), e.g.
// "Is Vistra (VST) the best ...", "$VST", "NYSE: VST". These are the SUBJECT of
// the story — without them the Ledger cross-check has nothing to value, which is
// why a clearly single-name story ("(VST)") was returning "no mapped companies".
// Validated against the universe classification so we don't fetch garbage.
function scenarioSubjectTickers(detail: any, maxSymbols = 4): string[] {
  const text = [detail?.title, detail?.summary]
    .concat(Array.isArray(detail?.claims) ? detail.claims.map((c: any) => (typeof c === 'string' ? c : c?.text || c?.claim || '')) : [])
    .filter(Boolean)
    .join('  ');
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const s = String(raw || '').trim().toUpperCase();
    if (!s || seen.has(s) || !/^[A-Z][A-Z0-9.-]{0,5}$/.test(s)) return;
    if (!getSymbolClassification(s)) return; // must be a known universe symbol
    seen.add(s);
    out.push(s);
  };
  const patterns = [
    /\$([A-Za-z]{1,5})\b/g,                          // $VST
    /\(([A-Z]{1,5})\)/g,                             // Vistra (VST)
    /\b(?:NYSE|NASDAQ|NYSEARCA|AMEX|OTC)\s*:\s*([A-Z]{1,5})\b/g, // NYSE: VST
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      push(m[1]);
      if (out.length >= maxSymbols) return out;
    }
  }
  return out;
}

function scenarioSymbols(detail: any, maxSymbols = 6): string[] {
  const symbols = new Set<string>();
  // Subject tickers named in the story text come first — they are what the user
  // is actually asking about and must be valued.
  for (const s of scenarioSubjectTickers(detail, 4)) symbols.add(s);
  for (const c of Array.isArray(detail?.top_universe_candidates) ? detail.top_universe_candidates : []) {
    const symbol = String(c?.symbol || '').trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  for (const e of Array.isArray(detail?.exposure_list) ? detail.exposure_list : []) {
    const symbol = String(e?.universe_symbol || '').trim().toUpperCase();
    if (symbol) symbols.add(symbol);
    if (String(e?.asset_type || '') === 'equity') {
      const assetKey = String(e?.asset_key || '').trim().toUpperCase();
      if (/^[A-Z][A-Z0-9.-]{0,8}$/.test(assetKey)) symbols.add(assetKey);
    }
  }
  return Array.from(symbols).slice(0, maxSymbols);
}

// Cheap, no-LLM lookup of any thesis the social/buzz extractor has already minted
// for these symbols (mi_narrative_theses). Lets the scenario brief answer "has the
// social feed generated a thesis on this company?" without a fresh extraction.
function lookupCachedTheses(symbols: string[]): Record<string, any> {
  const map: Record<string, any> = {};
  if (!symbols.length) return map;
  try {
    const dbPath = getMarketIntelligenceDbPath();
    if (!fs.existsSync(dbPath)) return map;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mi_narrative_theses'`).get();
      if (!tbl) return map;
      const freshCutoff = new Date(Date.now() - THESIS_FRESH_HOURS * 3600 * 1000).toISOString();
      const stmt = db.prepare(
        `SELECT t.* FROM mi_narrative_theses t
         JOIN (SELECT symbol, MAX(updated_at) AS mx FROM mi_narrative_theses WHERE symbol = ? GROUP BY symbol) m
           ON m.symbol = t.symbol AND m.mx = t.updated_at LIMIT 1`,
      );
      for (const symbol of symbols) {
        const r = stmt.get(symbol) as any;
        if (!r) continue;
        map[symbol] = {
          has_thesis: !!r.has_thesis,
          headline: r.headline,
          classification: r.classification,
          direction: r.direction,
          narrative: r.narrative,
          signal_count: r.signal_count,
          noise_count: r.noise_count,
          theses: (() => { try { return JSON.parse(r.theses_json || '[]'); } catch { return []; } })(),
          updated_at: r.updated_at,
          stale: !(r.updated_at && String(r.updated_at) >= freshCutoff),
        };
      }
    } finally {
      db.close();
    }
  } catch {
    return map;
  }
  return map;
}

// One- or two-sentence plain-English synopsis of what the story actually CLAIMS,
// assembled from the title + the freshest evidence text. Gives the brief a "what
// is this even about" line instead of jumping straight into signal stats.
function scenarioStorySynopsis(detail: any): { headline: string | null; claim: string | null; sources: string[] } {
  const headline = detail?.title ? String(detail.title).trim() : null;
  const texts: string[] = [];
  const sources: string[] = [];
  for (const e of Array.isArray(detail?.evidence_timeline) ? detail.evidence_timeline.slice(0, 5) : []) {
    const t = e?.summary || e?.text || e?.excerpt || e?.headline || e?.title || '';
    if (t) texts.push(String(t).trim());
    const src = e?.source || e?.source_type || e?.platform || e?.publisher;
    if (src) sources.push(String(src));
  }
  const claim = (detail?.summary && String(detail.summary).trim())
    || (texts.length ? texts.join(' ').slice(0, 400) : null);
  return { headline, claim, sources: Array.from(new Set(sources)).slice(0, 4) };
}

function fetchDcfPredictionSnapshot(symbol: string): any | null {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(PROJECT_ROOT, 'backend', 'data', 'app-state.sqlite');
    if (!fs.existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(
        `SELECT *
           FROM dcf_predictions
          WHERE symbol = ?
          ORDER BY prediction_date DESC, id DESC
          LIMIT 1`,
      ).get(String(symbol || '').toUpperCase()) as any;
      if (!row) return null;
      return {
        currentPrice: row.price_at_prediction ?? null,
        marketCap: null,
        sector: row.sector ?? null,
        industry: row.industry ?? null,
        revenueGrowthPct: row.revenue_growth_pct ?? null,
        profitMarginPct: row.operating_margin_pct ?? null,
        freeCashFlowTTM: row.reported_fcf ?? row.quality_adjusted_fcf ?? null,
        valuationSnapshot: {
          fairValueLow: row.fair_value_low ?? null,
          fairValueMid: row.fair_value_mid ?? null,
          fairValueHigh: row.fair_value_high ?? null,
          valuationGapPct: row.valuation_gap_pct ?? null,
          valuationState: row.judgment ?? null,
          qualityGrade: row.confidence_level ?? null,
          qualityScore: null,
        },
        riskFlags: [],
        tags: [
          row.source ? `source:${row.source}` : null,
          row.engine_version ? `engine:${row.engine_version}` : null,
          row.prediction_date ? `asof:${row.prediction_date}` : null,
        ].filter(Boolean),
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function fetchFundamentalSnapshot(symbol: string): Promise<any | null> {
  const dcfSnapshot = fetchDcfPredictionSnapshot(symbol);
  if (dcfSnapshot) return dcfSnapshot;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const port = process.env.PORT || 3002;
    const response = await fetch(`http://localhost:${port}/api/fundamentals/${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
    });
    const payload = await response.json() as any;
    if (!payload?.success || !payload?.data) return null;
    return payload.data.snapshot || payload.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeFundamentals(symbol: string, f: any): Record<string, unknown> {
  const vs = f?.valuationSnapshot || {};
  const re = f?.reportedExecution || {};
  const fe = f?.forwardExpectations || {};
  const classification = getSymbolClassification(symbol);
  return {
    symbol,
    company_type: f?.companyType || f?.classification?.companyType || classification?.companyType || null,
    valuation_engine: classification?.valuationEngineClass || null,
    sector: f?.sector || null,
    industry: f?.industry || null,
    current_price: f?.currentPrice ?? null,
    market_cap: f?.marketCap ?? null,
    fair_value: vs.fairValueMid ?? f?.fairValue ?? null,
    valuation_gap_pct: vs.valuationGapPct ?? f?.upsidePct ?? null,
    valuation_state: vs.valuationState ?? f?.valuationLabel ?? null,
    quality_grade: vs.qualityGrade ?? null,
    quality_score: vs.qualityScore ?? null,
    revenue_growth_pct: f?.revenueGrowthPct ?? null,
    profit_margin_pct: f?.profitMarginPct ?? null,
    free_cash_flow: f?.freeCashFlowTTM ?? null,
    debt_to_equity: f?.debtToEquity ?? null,
    current_ratio: f?.currentRatio ?? null,
    short_float_pct: f?.shortFloatPct ?? null,
    earnings_execution_score: re.score ?? null,
    eps_beat_streak: re.epsBeatStreak ?? null,
    forward_score: fe.score ?? null,
    forward_signal: fe.signal ?? null,
    risk_flags: Array.isArray(f?.riskFlags)
      ? f.riskFlags.slice(0, 6).map((r: any) => ({
          code: r.code || r.label || String(r),
          severity: r.severity || null,
          short: r.short || r.detail || null,
        }))
      : [],
    tags: Array.isArray(f?.tags)
      ? f.tags.slice(0, 8).map((t: any) => typeof t === 'string' ? t : t.label || String(t))
      : [],
  };
}

function narrativeClusterSymbols(detail: any, maxSymbols = 8): string[] {
  const symbols = new Set<string>();
  for (const symbol of Array.isArray(detail?.mapped_tickers) ? detail.mapped_tickers : []) {
    const s = String(symbol || '').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,8}$/.test(s)) symbols.add(s);
  }
  for (const claim of Array.isArray(detail?.claims) ? detail.claims : []) {
    for (const symbol of Array.isArray(claim?.detected_tickers) ? claim.detected_tickers : []) {
      const s = String(symbol || '').trim().toUpperCase();
      if (/^[A-Z][A-Z0-9.-]{0,8}$/.test(s)) symbols.add(s);
    }
  }
  return Array.from(symbols).slice(0, maxSymbols);
}

function deterministicNarrativeClusterBrief(report: any): string {
  const c = report.cluster;
  const candidates = Array.isArray(report.candidate_fundamentals)
    ? report.candidate_fundamentals.filter((row: any) => !row.unavailable)
    : [];
  const top = candidates[0] || null;
  const topLine = top
    ? `Top mapped ticker ${top.symbol}: ${top.valuation_engine || 'valuation engine N/A'}, valuation ${top.valuation_state || 'N/A'} (${pct(top.valuation_gap_pct)}), quality ${top.quality_grade || top.quality_score || 'N/A'}, risk flags ${(top.risk_flags || []).map((r: any) => r.code).join(', ') || 'none'}.`
    : 'No Ledger-backed ticker expression is available yet, so this cluster remains a narrative-quality review rather than a trade review.';
  return [
    `**NARRATIVE SIGNAL:** ${c.title} is a ${c.status} cluster with ${c.claim_count} claim(s), ${c.source_hit_count} source hit(s), source breadth ${num(c.source_breadth, 2)}, and mapped tickers ${(c.mapped_tickers || []).join(', ') || 'none'}.`,
    `**EVIDENCE QUALITY:** Verification status is ${c.verification_status}; flags are ${(c.validity_flags || []).join(', ') || 'none'}. Source types: ${(c.source_types || []).join(', ') || 'none'}.`,
    `**LEDGER CROSS-CHECK:** ${topLine}`,
    `**BOTTOM LINE:** ${report.verdict.risk_level} - ${report.verdict.summary}`,
  ].join('\n\n');
}

function buildNarrativeClusterVerdict(report: any): { risk_level: string; summary: string; signals: string[] } {
  const c = report.cluster;
  const signals: string[] = [];
  let score = 0;
  if (c.status === 'SCENARIO_READY' || c.status === 'PROMOTED') {
    signals.push(`Cluster status is ${c.status}`);
    score += 2;
  }
  if (Number(c.claim_count) >= 3) {
    signals.push(`${c.claim_count} structured claim(s)`);
    score += 1;
  }
  if (Number(c.source_hit_count) >= 3) {
    signals.push(`${c.source_hit_count} source hit(s)`);
    score += 1;
  }
  if (Number(c.source_breadth) >= 0.45) {
    signals.push(`Source breadth ${num(c.source_breadth, 2)}`);
    score += 2;
  } else if ((c.validity_flags || []).includes('SINGLE_SOURCE_RISK')) {
    signals.push('Single-source risk still present');
  }
  if ((c.mapped_tickers || []).length > 0) {
    signals.push(`Mapped tickers: ${c.mapped_tickers.slice(0, 6).join(', ')}`);
    score += 1;
  }
  const strongCandidate = (report.candidate_fundamentals || []).find((row: any) =>
    !row.unavailable && (Number(row.quality_score) >= 70 || Number(row.valuation_gap_pct) > 10),
  );
  if (strongCandidate) {
    signals.push(`Ledger-backed candidate to inspect: ${strongCandidate.symbol}`);
    score += 2;
  }
  const riskFlagged = (report.candidate_fundamentals || []).find((row: any) =>
    Array.isArray(row.risk_flags) && row.risk_flags.length > 0,
  );
  if (riskFlagged) {
    signals.push(`Candidate risk flags present: ${riskFlagged.symbol}`);
    score += 1;
  }

  let risk_level = 'LOW';
  if (score >= 7) risk_level = 'HIGH';
  else if (score >= 4) risk_level = 'ELEVATED';
  const summary = signals.length
    ? `${signals.length} signal(s) across narrative evidence and Ledger ticker checks.`
    : 'Early narrative cluster; keep watching until corroboration and investable exposure improve.';
  return { risk_level, summary, signals };
}

async function generateNarrativeClusterNarrative(apiKey: string, report: any): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const prompt = `You are Ledger, a skeptical financial analyst inside a market-intelligence workstation.

The user clicked a Narrative Radar cluster. The job is to answer: is this undercovered narrative real enough, investable enough, and tied to the right public companies?

NARRATIVE CLUSTER:
${JSON.stringify(report.cluster, null, 2)}

STRUCTURED CLAIMS:
${JSON.stringify(report.claims, null, 2)}

LEDGER / FUNDAMENTAL CROSS-CHECK:
${JSON.stringify(report.candidate_fundamentals, null, 2)}

Write a concise intelligence brief with these sections:
1. NARRATIVE SIGNAL: what is being claimed and why it matters.
2. EVIDENCE QUALITY: source breadth, single-source risk, verification gaps, and freshness.
3. LEDGER CROSS-CHECK: inspect mapped companies with the correct valuation engine. Do not call every valuation a DCF. REITs use AFFO/NAV, financials use ROE/book, pre-profit names use sales-scenario logic, operating companies use DCF.
4. TRADE/RESEARCH EXPRESSION: which tickers are the cleanest or weakest expressions.
5. BOTTOM LINE: ignore, monitor, or investigate now; include what would confirm or invalidate it.

Reference specific numbers. No disclaimers.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getRoleModelOverride('ledger') || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 2200,
      }),
    });
    const result = await response.json() as any;
    return result.choices?.[0]?.message?.content || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildNarrativeClusterReport(detail: any): Promise<any> {
  const symbols = narrativeClusterSymbols(detail, 8);
  const candidateFundamentals = await Promise.all(
    symbols.map(async (symbol) => {
      const snapshot = await fetchFundamentalSnapshot(symbol);
      return snapshot ? summarizeFundamentals(symbol, snapshot) : { symbol, unavailable: true };
    }),
  );
  const report: any = {
    cluster_id: detail.id,
    slug: detail.slug,
    generated_at: new Date().toISOString(),
    cluster: {
      id: detail.id,
      slug: detail.slug,
      title: detail.title,
      summary: detail.summary,
      primary_theme: detail.primary_theme,
      status: detail.status,
      source_breadth: detail.source_breadth,
      attention_velocity: detail.attention_velocity,
      novelty_score: detail.novelty_score,
      mainstream_coverage_score: detail.mainstream_coverage_score,
      undercoverage_score: detail.undercoverage_score,
      authenticity_score: detail.authenticity_score,
      tradable_exposure_status: detail.tradable_exposure_status,
      verification_status: detail.verification_status,
      mapped_tickers: detail.mapped_tickers || [],
      validity_flags: detail.validity_flags || [],
      promotion_situation_id: detail.promotion_situation_id,
      source_hit_count: detail.source_hit_count,
      source_types: detail.source_types || [],
      claim_count: detail.claim_count,
      first_seen_at: detail.first_seen_at,
      last_seen_at: detail.last_seen_at,
      updated_at: detail.updated_at,
      metadata: detail.metadata || null,
    },
    claims: Array.isArray(detail.claims) ? detail.claims.slice(0, 20) : [],
    candidate_fundamentals: candidateFundamentals,
  };
  report.verdict = buildNarrativeClusterVerdict(report);
  let narrative: string | null = null;
  try {
    const apiKey = getConfiguredOpenAIKey();
    if (apiKey) narrative = await generateNarrativeClusterNarrative(apiKey, report);
  } catch {
    narrative = null;
  }
  report.narrative = narrative || deterministicNarrativeClusterBrief(report);
  return report;
}

function deterministicScenarioBrief(report: any): string {
  const s = report.scenario;
  const subj: string[] = Array.isArray(report.subject_tickers) ? report.subject_tickers : [];
  // Prefer a subject ticker (the name the story is about) for the valuation line.
  const fundamentals: any[] = report.candidate_fundamentals || [];
  const subjFund = fundamentals.find((f) => !f.unavailable && subj.includes(String(f.symbol).toUpperCase()));
  const top = subjFund || fundamentals.find((f) => !f.unavailable) || fundamentals[0];
  const synopsis = report.story_synopsis || {};
  const synopsisLine = synopsis.claim
    ? `${synopsis.headline ? synopsis.headline + ' — ' : ''}${String(synopsis.claim).slice(0, 320)}${subj.length ? ` Subject: ${subj.join(', ')}.` : ''}`
    : (synopsis.headline || 'No story text available.');
  const valLine = top && !top.unavailable
    ? `${top.symbol}: ${top.valuation_engine || 'valuation'} fair value ${top.fair_value == null ? 'N/A' : top.fair_value}, current price ${top.current_price == null ? 'N/A' : top.current_price}, gap ${pct(top.valuation_gap_pct)} (${top.valuation_state || 'N/A'}); quality ${top.quality_grade || top.quality_score || 'N/A'}, revenue growth ${pct(top.revenue_growth_pct)}, risk flags ${(top.risk_flags || []).map((r: any) => r.code).join(', ') || 'none'}.`
    : `No Ledger valuation snapshot is available${subj.length ? ` for ${subj.join(', ')}` : ''} yet, so this is a scenario-quality review rather than a single-name valuation.`;
  const theses: Record<string, any> = report.social_theses || {};
  const subjThesis = subj.map((t) => theses[t]).find((x) => x && x.has_thesis)
    || Object.values(theses).find((x: any) => x && x.has_thesis) as any;
  const thesisLine = subjThesis && subjThesis.has_thesis
    ? `Buzz-thesis extractor: "${subjThesis.headline || 'thesis'}" (${subjThesis.direction || 'n/a'}${subjThesis.classification ? ', ' + subjThesis.classification : ''})${subjThesis.stale ? ' [stale]' : ''}.`
    : (Object.keys(theses).length
        ? 'Buzz-thesis extractor has no material thesis for the subject ticker(s) yet — only low-substance chatter.'
        : 'No cached social thesis for the subject ticker(s).');
  return [
    `**STORY SYNOPSIS:** ${synopsisLine}`,
    `**SCENARIO SIGNAL:** ${s.title} is a ${scenarioEngineLabel(s.detection_path)} scenario with signal strength ${s.signal_strength}/100, confidence ${num(s.confidence_score, 2)}, status ${s.status}, and ${report.evidence_timeline.length} evidence item(s). The theme is ${s.primary_theme}, with a ${s.time_horizon || 'unknown'} time horizon.`,
    `**EVIDENCE QUALITY:** Source breadth is ${num(s.source_breadth_score, 2)} and authenticity is ${s.authenticity_score == null ? 'N/A' : num(s.authenticity_score, 2)}. Peak z-score is ${s.peak_z_score == null ? 'N/A' : num(s.peak_z_score, 1)}. Flags: ${(s.validity_flags || []).join(', ') || 'none'}.`,
    `**LEDGER CROSS-CHECK (VALUATION/DCF):** ${valLine}`,
    `**SOCIAL / THESIS CHECK:** ${thesisLine}`,
    `**BOTTOM LINE:** ${report.verdict.risk_level} - ${report.verdict.summary} Watch for fresh corroborating evidence, movement in the mapped tickers, and whether the top expressions remain tradable after valuation and quality checks.`,
  ].join('\n\n');
}

function valuationFragilityRows(report: any, limit = 16): any[] {
  const fundamentals: any[] = Array.isArray(report.candidate_fundamentals)
    ? report.candidate_fundamentals
    : [];
  const rankBySymbol = new Map<string, any>();
  for (const c of Array.isArray(report.top_universe_candidates) ? report.top_universe_candidates : []) {
    const symbol = String(c?.symbol || '').toUpperCase();
    if (symbol) rankBySymbol.set(symbol, c);
  }
  return fundamentals
    .filter((f) => f && !f.unavailable)
    .map((f) => ({
      ...f,
      exposure_direction: rankBySymbol.get(String(f.symbol || '').toUpperCase())?.exposure_direction || null,
      composite_rank: rankBySymbol.get(String(f.symbol || '').toUpperCase())?.composite_rank ?? null,
    }))
    .sort((a, b) => {
      const gapA = Math.abs(Number(a.valuation_gap_pct) || 0);
      const gapB = Math.abs(Number(b.valuation_gap_pct) || 0);
      return gapB - gapA;
    })
    .slice(0, limit);
}

function deterministicScenarioShareableReport(report: any): string {
  const s = report.scenario || {};
  const ca = report.consequence_analysis || {};
  const rows = valuationFragilityRows(report, 12);
  const evidence = Array.isArray(report.evidence_timeline) ? report.evidence_timeline.slice(0, 5) : [];
  const ramifications = [
    ...(Array.isArray(ca.scenario_branches) ? ca.scenario_branches : []),
    ...(Array.isArray(ca.dependency_chains) ? ca.dependency_chains : []),
    ...(Array.isArray(ca.workflow_constraints) ? ca.workflow_constraints : []),
    ...(Array.isArray(ca.second_order_effects) ? ca.second_order_effects : []),
  ].filter(Boolean).slice(0, 12);
  const valuationTable = rows.length
    ? rows.map((r) =>
        `| ${r.symbol} | ${r.exposure_direction || 'n/a'} | ${r.valuation_engine || 'n/a'} | ${r.current_price ?? 'N/A'} | ${r.fair_value ?? 'N/A'} | ${pct(r.valuation_gap_pct)} | ${r.valuation_state || 'N/A'} | ${r.composite_rank == null ? 'N/A' : num(r.composite_rank, 1)} |`,
      ).join('\n')
    : '| none | n/a | n/a | N/A | N/A | N/A | N/A | N/A |';
  const evidenceLines = evidence.length
    ? evidence.map((e: any) => `- ${e.source_name || e.source || 'source'}: ${e.headline_or_label || e.text || e.summary || 'evidence'}`).join('\n')
    : '- No evidence rows were returned.';
  const ramificationsLines = ramifications.length
    ? ramifications.map((r: any) => `- ${r}`).join('\n')
    : '- No consequence-analysis branches were available.';
  return [
    `# ${s.title || report.slug || 'Market Intelligence Report'}`,
    `Generated: ${report.generated_at || new Date().toISOString()}`,
    '',
    '## Bottom Line',
    `${report.verdict?.risk_level || 'WATCH'} - ${report.verdict?.summary || 'Scenario requires review.'}`,
    '',
    '## Story Synopsis',
    report.story_synopsis?.claim || s.summary || s.title || 'No synopsis available.',
    '',
    '## Signal And Evidence Quality',
    `Signal strength ${s.signal_strength ?? 'N/A'}/100, confidence ${num(s.confidence_score, 2)}, source breadth ${num(s.source_breadth_score, 2)}, evidence count ${s.evidence_count ?? 'N/A'}, flags ${(s.validity_flags || []).join(', ') || 'none'}.`,
    '',
    evidenceLines,
    '',
    '## Analyst Ramifications',
    ca.core_thesis || 'No analyst consequence thesis was available.',
    '',
    ramificationsLines,
    '',
    '## Exposure And Valuation Fragility',
    '| Symbol | Direction | Valuation Engine | Price | Fair Value | Gap | State | Rank |',
    '|---|---:|---|---:|---:|---:|---|---:|',
    valuationTable,
    '',
    '## Market-Wide Risk',
    'Watch whether the shock affects large index-weight constituents, crowded AI-capex beneficiaries, and companies whose valuations depend on continued AI demand growth. Overvalued exposed names have more downside convexity if the market starts cutting AI growth assumptions.',
    '',
    '## What Confirms Or Breaks This',
    [
      ...(Array.isArray(ca.confirming_evidence) ? ca.confirming_evidence.map((x: any) => `Confirming: ${x}`) : []),
      ...(Array.isArray(ca.invalidating_evidence) ? ca.invalidating_evidence.map((x: any) => `Invalidating: ${x}`) : []),
    ].slice(0, 10).map((x) => `- ${x}`).join('\n') || '- Watch for primary-source clarification, reversal, or confirmation.',
  ].join('\n');
}

function buildScenarioVerdict(report: any): { risk_level: string; summary: string; signals: string[] } {
  const s = report.scenario;
  const signals: string[] = [];
  let score = 0;
  if (Number(s.signal_strength) >= 60) { signals.push(`High scenario signal strength: ${s.signal_strength}/100`); score += 2; }
  if (Number(s.confidence_score) >= 0.5) { signals.push(`Meaningful confidence score: ${num(s.confidence_score, 2)}`); score += 2; }
  if (Number(s.peak_z_score) >= 3) { signals.push(`Anomalous social z-score: ${num(s.peak_z_score, 1)}`); score += 2; }
  if (s.cross_platform_corroboration) { signals.push('Cross-platform corroboration present'); score += 2; }
  if (report.evidence_timeline.length >= 3) { signals.push(`${report.evidence_timeline.length} evidence items`); score += 1; }
  const strongCandidate = (report.candidate_fundamentals || []).find((c: any) =>
    Number(c.quality_score) >= 70 || Number(c.valuation_gap_pct) > 10,
  );
  if (strongCandidate) { signals.push(`Ledger-backed candidate to inspect: ${strongCandidate.symbol}`); score += 2; }
  const riskFlagged = (report.candidate_fundamentals || []).find((c: any) =>
    Array.isArray(c.risk_flags) && c.risk_flags.length > 0,
  );
  if (riskFlagged) { signals.push(`Candidate risk flags present: ${riskFlagged.symbol}`); score += 1; }
  let risk_level = 'LOW';
  if (score >= 7) risk_level = 'HIGH';
  else if (score >= 4) risk_level = 'ELEVATED';
  const summary = signals.length
    ? `${signals.length} signal(s) across scenario momentum, evidence quality, and Ledger candidate checks.`
    : 'Weak or early scenario; keep it on watch until more evidence arrives.';
  return { risk_level, summary, signals };
}

async function generateScenarioNarrative(apiKey: string, report: any): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  const prompt = `You are Ledger, a skeptical financial analyst inside a market-intelligence workstation.

The user clicked a Macro/Social Arbitrage scenario and wants a polished, shareable
intelligence memo. You are not filling in a deterministic template. You are
ingesting the structured evidence packet below and writing the report from that
data, using the analysis rules embedded in the packet.

Separate reported facts from inference. Use the deterministic data as evidence,
then synthesize the market, economic, geopolitical, valuation, and workflow
ramifications in clear prose.

SCENARIO:
${JSON.stringify(report.scenario, null, 2)}

STORY SYNOPSIS INPUT (title + freshest evidence text):
${JSON.stringify(report.story_synopsis, null, 2)}

SUBJECT TICKERS (named directly in the story — value these first):
${JSON.stringify(report.subject_tickers, null, 2)}

EVIDENCE TIMELINE:
${JSON.stringify(report.evidence_timeline, null, 2)}

EXPOSURE MAP:
${JSON.stringify(report.exposure_list, null, 2)}

TOP UNIVERSE CANDIDATES:
${JSON.stringify(report.top_universe_candidates, null, 2)}

LEDGER / FUNDAMENTAL + VALUATION (DCF) CROSS-CHECK:
${JSON.stringify(report.candidate_fundamentals, null, 2)}

SOCIAL / THESIS CHECK (what the buzz-thesis extractor already found for these tickers):
${JSON.stringify(report.social_theses, null, 2)}

EXISTING CONVICTION LAYER:
${JSON.stringify(report.conviction_layer, null, 2)}

AI CONSEQUENCE ANALYSIS / SCENARIO TREE:
${JSON.stringify(report.consequence_analysis, null, 2)}

VALUATION FRAGILITY TABLE (mapped exposure names with Ledger valuation where available):
${JSON.stringify(report.valuation_fragility, null, 2)}

Write a readable, shareable intelligence report in Markdown. It should be suitable
to paste into an email, internal note, or YouTube comment. It must be more
detailed than a dashboard card, but still direct.

Required sections:
1. STORY SYNOPSIS: 1-2 plain-English sentences stating WHAT THE STORY ACTUALLY CLAIMS and why it matters (the actual narrative, not the signal stats). If there is a subject ticker, name it.
2. SCENARIO SIGNAL: what triggered this and how fresh/credible it is.
3. EVIDENCE QUALITY: source breadth, authenticity/z-score, corroboration, and flags.
4. ANALYST RAMIFICATIONS: discuss the consequence-analysis branches, including second-order effects, dependency chains, and workflow constraints.
5. LEDGER CROSS-CHECK (VALUATION/DCF): value the exposed mapped tickers, not only the subject ticker. State valuation engine, fair value, current price, valuation gap %, and overvalued/undervalued/fair where available. For operating companies this is DCF; REITs use AFFO/NAV, financials use ROE/book, pre-profit names use sales-scenario logic. Do not call every valuation a DCF.
6. EXPOSURE MAP / WHO GETS HIT: explain first-order and second-order exposure. Highlight overvalued short-loser names when the scenario implies demand, revenue, margin, or growth-assumption risk.
7. MARKET-WIDE RAMIFICATIONS: discuss index concentration, AI-capex crowdedness, S&P/Nasdaq spillovers, liquidity/derisking channels, and whether a major component falling can mechanically pressure the broader market.
8. ECONOMIC AND GEOPOLITICAL RAMIFICATIONS: discuss policy reversal risk, retaliation, labor/workforce constraints, foreign-national/contractor/customer access issues, compliance burden, and international relations if relevant.
9. WHAT WOULD CONFIRM OR INVALIDATE IT: primary-source checks, reversal/clarification, market confirmation, affected-company comments, and price action.
10. BOTTOM LINE: clear verdict: ignore, monitor, investigate now, or urgent.

Reference specific numbers. Round prices/fair values to two decimals and valuation
gaps to one decimal. Do not dump raw JSON. Be explicit when data is missing. No
generic disclaimers.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.MI_SCENARIO_REPORT_MODEL || getRoleModelOverride('ledger') || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 3200,
      }),
    });
    const result = await response.json() as any;
    return result.choices?.[0]?.message?.content || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildScenarioIntelligenceReport(detail: any): Promise<any> {
  const subjectTickers = scenarioSubjectTickers(detail, 4);
  const symbols = scenarioSymbols(detail, 16);
  const candidateFundamentals = await Promise.all(
    symbols.map(async (symbol) => {
      const snapshot = await fetchFundamentalSnapshot(symbol);
      return snapshot ? summarizeFundamentals(symbol, snapshot) : { symbol, unavailable: true };
    }),
  );
  const socialTheses = lookupCachedTheses(symbols);
  const storySynopsis = scenarioStorySynopsis(detail);
  const report: any = {
    scenario_id: detail.id,
    slug: detail.slug,
    generated_at: new Date().toISOString(),
    scenario: {
      id: detail.id,
      title: detail.title,
      summary: detail.summary,
      status: detail.status,
      scenario_type: detail.scenario_type,
      primary_theme: detail.primary_theme,
      detection_path: detail.detection_path,
      engine: scenarioEngineLabel(detail.detection_path),
      signal_strength: detail.signal_strength,
      confidence_score: detail.confidence_score,
      confidence_level: detail.confidence_level,
      time_horizon: detail.time_horizon,
      started_at: detail.started_at,
      last_updated_at: detail.last_updated_at,
      freshness_seconds: detail.freshness_seconds,
      source_breadth_score: detail.source_breadth_score,
      evidence_count: detail.evidence_count,
      authenticity_score: detail.authenticity_score,
      peak_z_score: detail.peak_z_score,
      cross_platform_corroboration: detail.cross_platform_corroboration,
      validity_flags: detail.validity_flags || [],
    },
    evidence_timeline: Array.isArray(detail.evidence_timeline) ? detail.evidence_timeline.slice(0, 12) : [],
    exposure_list: Array.isArray(detail.exposure_list) ? detail.exposure_list.slice(0, 30) : [],
    top_universe_candidates: Array.isArray(detail.top_universe_candidates) ? detail.top_universe_candidates.slice(0, 12) : [],
    first_order_effects: detail.first_order_effects || [],
    second_order_effects: detail.second_order_effects || [],
    consequence_analysis: detail.consequence_analysis || null,
    conviction_layer: detail.conviction_layer || null,
    candidate_fundamentals: candidateFundamentals,
    subject_tickers: subjectTickers,
    story_synopsis: storySynopsis,
    social_theses: socialTheses,
  };
  report.valuation_fragility = valuationFragilityRows(report, 16);
  report.verdict = buildScenarioVerdict(report);
  let narrative: string | null = null;
  try {
    const apiKey = getConfiguredOpenAIKey();
    if (apiKey) narrative = await generateScenarioNarrative(apiKey, report);
  } catch {
    narrative = null;
  }
  report.report_author = narrative ? 'ai' : 'deterministic_fallback';
  report.narrative = narrative || deterministicScenarioBrief(report);
  report.shareable_report = narrative || deterministicScenarioShareableReport(report);
  return report;
}

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
  // 4chan-specific
  boards?: unknown;
  // Bluesky-specific
  page_size?: unknown;
  // Niche forums-specific
  forums?: unknown;
  // Discord-specific
  max_pages_per_channel?: unknown;
  server_slugs?: unknown;
  bot_token?: unknown;
  // Macro-RSS-specific (Phase 1.5). `feeds` overlaps semantically with
  // forums' `forums` flag but is a distinct CSV at the wire so different
  // macro collectors can re-use the same key without ambiguity.
  feeds?: unknown;
  // Macro news + econ collectors: --sources <csv>
  sources?: unknown;
  // Macro econ collector: --eia-lookback <int>
  eia_lookback?: unknown;
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

function buildFourchanCliArgs(body: CollectorRunBody): string[] {
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

  if (body.boards !== undefined && body.boards !== null) {
    let boards: string;
    if (Array.isArray(body.boards)) {
      boards = body.boards
        .map((b) => String(b).trim().replace(/^\/+|\/+$/g, ''))
        .filter((b) => b.length > 0)
        .join(',');
    } else if (typeof body.boards === 'string') {
      boards = body.boards.trim();
    } else {
      throw new HttpError(
        'VALIDATION_ERROR',
        'boards must be an array of strings or a comma-separated string',
      );
    }
    if (boards.length > 0) {
      args.push('--boards', boards);
    }
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

function buildBlueskyCliArgs(body: CollectorRunBody): string[] {
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

  if (body.page_size !== undefined && body.page_size !== null) {
    const n = Number(body.page_size);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'page_size must be a positive number <= 100 (Bluesky API limit)',
      );
    }
    args.push('--page-size', String(Math.trunc(n)));
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

function buildForumsCliArgs(body: CollectorRunBody): string[] {
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

  if (body.forums !== undefined && body.forums !== null) {
    let keys: string;
    if (Array.isArray(body.forums)) {
      keys = body.forums
        .map((k) => String(k).trim())
        .filter((k) => k.length > 0)
        .join(',');
    } else if (typeof body.forums === 'string') {
      keys = body.forums.trim();
    } else {
      throw new HttpError(
        'VALIDATION_ERROR',
        'forums must be an array of forum keys or a comma-separated string',
      );
    }
    if (keys.length > 0) {
      args.push('--forums', keys);
    }
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

// Discord-specific arg builder. Mirrors HN/Bluesky/forums shape; adds three
// Discord-only flags:
//   --max-pages-per-channel <int>  (default 3 in the script)
//   --server-slugs <csv>           (operator override of discord-servers.json subset)
//   --bot-token <string>           (escape hatch — normally resolved from
//                                   DISCORD_BOT_TOKEN env var so we don't ship
//                                   creds across the request boundary)
function buildDiscordCliArgs(body: CollectorRunBody): string[] {
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

  if (
    body.max_pages_per_channel !== undefined &&
    body.max_pages_per_channel !== null
  ) {
    const n = Number(body.max_pages_per_channel);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'max_pages_per_channel must be a positive number',
      );
    }
    args.push('--max-pages-per-channel', String(Math.trunc(n)));
  }

  if (body.page_size !== undefined && body.page_size !== null) {
    const n = Number(body.page_size);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      throw new HttpError(
        'VALIDATION_ERROR',
        'page_size must be a positive number <= 100 (Discord API limit)',
      );
    }
    args.push('--page-size', String(Math.trunc(n)));
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

  if (body.server_slugs !== undefined && body.server_slugs !== null) {
    let slugs: string;
    if (Array.isArray(body.server_slugs)) {
      slugs = body.server_slugs
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0)
        .join(',');
    } else if (typeof body.server_slugs === 'string') {
      slugs = body.server_slugs.trim();
    } else {
      throw new HttpError(
        'VALIDATION_ERROR',
        'server_slugs must be an array of strings or a comma-separated string',
      );
    }
    if (slugs.length > 0) {
      args.push('--server-slugs', slugs);
    }
  }

  if (body.bot_token !== undefined && body.bot_token !== null) {
    if (typeof body.bot_token !== 'string') {
      throw new HttpError(
        'VALIDATION_ERROR',
        'bot_token must be a string when provided. Prefer DISCORD_BOT_TOKEN env var.',
      );
    }
    const trimmed = body.bot_token.trim();
    if (trimmed.length > 0) {
      args.push('--bot-token', trimmed);
    }
  }

  if (asTruthy(body.dry_run)) {
    args.push('--dry-run');
  }

  return args;
}

// Phase 1.5 — Macro Engine, Federal Reserve RSS collector.
//
// Differences vs. the social-arb collectors:
//   - No --concept-keys; macro hits aren't concept-keyed (clustering
//     happens later via embeddings)
//   - --feeds <csv> picks a subset of the 4 Fed feeds (press_all,
//     press_monetary, speeches, testimony)
//   - Default --since-hours is 24 in the script, mirrored here
function buildMacroFedCliArgs(body: CollectorRunBody): string[] {
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

  if (body.feeds !== undefined && body.feeds !== null) {
    let feeds: string;
    if (Array.isArray(body.feeds)) {
      feeds = body.feeds
        .map((f) => String(f).trim())
        .filter((f) => f.length > 0)
        .join(',');
    } else if (typeof body.feeds === 'string') {
      feeds = body.feeds.trim();
    } else {
      throw new HttpError(
        'VALIDATION_ERROR',
        'feeds must be an array of strings or a comma-separated string',
      );
    }
    if (feeds.length > 0) {
      args.push('--feeds', feeds);
    }
  }

  if (asTruthy(body.dry_run)) {
    args.push('--dry-run');
  }

  return args;
}

// Phase 1.5 — Macro news RSS collector (Yahoo Finance + Reuters + AP
// via Google News RSS proxy). Uses --sources and --since-hours.
function buildMacroNewsCliArgs(body: CollectorRunBody): string[] {
  const args: string[] = [];

  if (body.since_hours !== undefined && body.since_hours !== null) {
    const n = Number(body.since_hours);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError('VALIDATION_ERROR', 'since_hours must be a positive number');
    }
    args.push('--since-hours', String(Math.trunc(n)));
  }

  if (body.request_timeout !== undefined && body.request_timeout !== null) {
    const n = Number(body.request_timeout);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError('VALIDATION_ERROR', 'request_timeout must be a positive number');
    }
    args.push('--request-timeout', String(n));
  }

  if (body.sleep_ms !== undefined && body.sleep_ms !== null) {
    const n = Number(body.sleep_ms);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError('VALIDATION_ERROR', 'sleep_ms must be a non-negative number');
    }
    args.push('--sleep-ms', String(Math.trunc(n)));
  }

  if (body.sources !== undefined && body.sources !== null) {
    let sources: string;
    if (Array.isArray(body.sources)) {
      sources = body.sources.map((s) => String(s).trim()).filter((s) => s.length > 0).join(',');
    } else if (typeof body.sources === 'string') {
      sources = body.sources.trim();
    } else {
      throw new HttpError('VALIDATION_ERROR', 'sources must be a string or array');
    }
    if (sources.length > 0) {
      args.push('--sources', sources);
    }
  }

  if (asTruthy(body.dry_run)) {
    args.push('--dry-run');
  }

  return args;
}

// Phase 1.5 — Macro EIA + BLS economic data collector.
// Uses --sources, --eia-lookback, and standard flags.
function buildMacroEconCliArgs(body: CollectorRunBody): string[] {
  const args: string[] = [];

  if (body.sources !== undefined && body.sources !== null) {
    let sources: string;
    if (Array.isArray(body.sources)) {
      sources = body.sources.map((s) => String(s).trim()).filter((s) => s.length > 0).join(',');
    } else if (typeof body.sources === 'string') {
      sources = body.sources.trim();
    } else {
      throw new HttpError('VALIDATION_ERROR', 'sources must be a string or array');
    }
    if (sources.length > 0) {
      args.push('--sources', sources);
    }
  }

  if (body.eia_lookback !== undefined && body.eia_lookback !== null) {
    const n = Number(body.eia_lookback);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError('VALIDATION_ERROR', 'eia_lookback must be a positive number');
    }
    args.push('--eia-lookback', String(Math.trunc(n)));
  }

  if (body.request_timeout !== undefined && body.request_timeout !== null) {
    const n = Number(body.request_timeout);
    if (!Number.isFinite(n) || n <= 0) {
      throw new HttpError('VALIDATION_ERROR', 'request_timeout must be a positive number');
    }
    args.push('--request-timeout', String(n));
  }

  if (body.sleep_ms !== undefined && body.sleep_ms !== null) {
    const n = Number(body.sleep_ms);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError('VALIDATION_ERROR', 'sleep_ms must be a non-negative number');
    }
    args.push('--sleep-ms', String(Math.trunc(n)));
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
          `More macro_* collectors land in subsequent Phase 1.5 tickets.`,
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
      let cliArgs: string[];
      if (sourceType === 'hackernews') {
        cliArgs = buildHackerNewsCliArgs(body);
      } else if (sourceType === 'fourchan') {
        cliArgs = buildFourchanCliArgs(body);
      } else if (sourceType === 'bluesky') {
        cliArgs = buildBlueskyCliArgs(body);
      } else if (sourceType === 'forums') {
        cliArgs = buildForumsCliArgs(body);
      } else if (sourceType === 'discord') {
        cliArgs = buildDiscordCliArgs(body);
      } else if (sourceType === 'macro_fed') {
        cliArgs = buildMacroFedCliArgs(body);
      } else if (sourceType === 'macro_news') {
        cliArgs = buildMacroNewsCliArgs(body);
      } else if (sourceType === 'macro_econ') {
        cliArgs = buildMacroEconCliArgs(body);
      } else {
        cliArgs = [];
      }
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
