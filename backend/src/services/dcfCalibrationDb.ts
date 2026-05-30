/**
 * DCF Calibration — persistence layer.
 *
 * Manages three tables in app-state.sqlite:
 *   - dcf_predictions      — every DCF run's assumptions + fair-value output
 *   - dcf_calibration_errors    — predicted-vs-actual deltas per prediction
 *   - dcf_calibration_adjustments — aggregated bias corrections by scope
 *
 * Style mirrors appStateDb.ts: lazy singleton, ensureSchema on first access,
 * prepared statements, explicit Number/String coercion at the row boundary.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketCapBand = 'mega' | 'large' | 'mid' | 'small' | 'micro';

export type DcfPredictionRow = {
  id: number;
  symbol: string;
  sector: string | null;
  industry: string | null;
  market_cap_band: MarketCapBand | null;
  prediction_date: string;
  price_at_prediction: number | null;
  fair_value_low: number | null;
  fair_value_mid: number | null;
  fair_value_high: number | null;
  valuation_gap_pct: number | null;
  judgment: string | null;
  confidence_level: string | null;
  revenue_growth_pct: number | null;
  target_fcf_margin_pct: number | null;
  discount_rate_pct: number | null;
  terminal_growth_pct: number | null;
  forecast_years: number | null;
  annual_revenue: number | null;
  reported_fcf: number | null;
  quality_adjusted_fcf: number | null;
  operating_margin_pct: number | null;
  source: string;
  engine_version: string | null;
  created_at: string;
};

export type CalibrationErrorRow = {
  id: number;
  prediction_id: number;
  symbol: string;
  sector: string | null;
  industry: string | null;
  market_cap_band: MarketCapBand | null;
  predicted_revenue_growth_pct: number | null;
  actual_revenue_growth_pct: number | null;
  revenue_growth_error_pct: number | null;
  predicted_fcf_margin_pct: number | null;
  actual_fcf_margin_pct: number | null;
  fcf_margin_error_pct: number | null;
  predicted_fair_value_mid: number | null;
  actual_price_at_review: number | null;
  price_error_pct: number | null;
  direction_correct: number | null;
  prediction_date: string;
  review_date: string;
  quarters_elapsed: number | null;
  created_at: string;
};

export type CalibrationAdjustmentRow = {
  id: number;
  scope_type: 'sector' | 'industry' | 'market_cap_band' | 'global';
  scope_value: string;
  assumption_key: string;
  adjustment_pct: number;
  sample_size: number;
  confidence: number | null;
  last_computed_at: string;
};

export type LogDcfPredictionParams = {
  symbol: string;
  sector?: string | null;
  industry?: string | null;
  market_cap_band?: MarketCapBand | null;
  prediction_date: string;
  price_at_prediction?: number | null;
  fair_value_low?: number | null;
  fair_value_mid?: number | null;
  fair_value_high?: number | null;
  valuation_gap_pct?: number | null;
  judgment?: string | null;
  confidence_level?: string | null;
  revenue_growth_pct?: number | null;
  target_fcf_margin_pct?: number | null;
  discount_rate_pct?: number | null;
  terminal_growth_pct?: number | null;
  forecast_years?: number | null;
  annual_revenue?: number | null;
  reported_fcf?: number | null;
  quality_adjusted_fcf?: number | null;
  operating_margin_pct?: number | null;
  source: string;
  engine_version?: string | null;
};

export type LogCalibrationErrorParams = {
  prediction_id: number;
  symbol: string;
  sector?: string | null;
  industry?: string | null;
  market_cap_band?: MarketCapBand | null;
  predicted_revenue_growth_pct?: number | null;
  actual_revenue_growth_pct?: number | null;
  revenue_growth_error_pct?: number | null;
  predicted_fcf_margin_pct?: number | null;
  actual_fcf_margin_pct?: number | null;
  fcf_margin_error_pct?: number | null;
  predicted_fair_value_mid?: number | null;
  actual_price_at_review?: number | null;
  price_error_pct?: number | null;
  direction_correct?: number | null;
  prediction_date: string;
  review_date: string;
  quarters_elapsed?: number | null;
};

export type UpsertCalibrationAdjustmentParams = {
  scope_type: 'sector' | 'industry' | 'market_cap_band' | 'global';
  scope_value: string;
  assumption_key: string;
  adjustment_pct: number;
  sample_size: number;
  confidence?: number | null;
};

// ---------------------------------------------------------------------------
// Connection lifecycle (mirrors appStateDb.ts)
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app-state.sqlite');

let _db: DatabaseSync | null = null;

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function ensureSchema(db: DatabaseSync): void {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dcf_predictions (
          id                      INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol                  TEXT NOT NULL,
          sector                  TEXT,
          industry                TEXT,
          market_cap_band         TEXT,
          prediction_date         TEXT NOT NULL,
          price_at_prediction     REAL,
          fair_value_low          REAL,
          fair_value_mid          REAL,
          fair_value_high         REAL,
          valuation_gap_pct       REAL,
          judgment                TEXT,
          confidence_level        TEXT,
          revenue_growth_pct      REAL,
          target_fcf_margin_pct   REAL,
          discount_rate_pct       REAL,
          terminal_growth_pct     REAL,
          forecast_years          INTEGER,
          annual_revenue          REAL,
          reported_fcf            REAL,
          quality_adjusted_fcf    REAL,
          operating_margin_pct    REAL,
          source                  TEXT NOT NULL DEFAULT 'valuation_refresh',
          engine_version          TEXT,
          created_at              TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_dcf_predictions_symbol
          ON dcf_predictions(symbol);
        CREATE INDEX IF NOT EXISTS idx_dcf_predictions_sector
          ON dcf_predictions(sector);
        CREATE INDEX IF NOT EXISTS idx_dcf_predictions_date
          ON dcf_predictions(prediction_date);

        CREATE TABLE IF NOT EXISTS dcf_calibration_errors (
          id                              INTEGER PRIMARY KEY AUTOINCREMENT,
          prediction_id                   INTEGER NOT NULL REFERENCES dcf_predictions(id),
          symbol                          TEXT NOT NULL,
          sector                          TEXT,
          industry                        TEXT,
          market_cap_band                 TEXT,
          predicted_revenue_growth_pct    REAL,
          actual_revenue_growth_pct       REAL,
          revenue_growth_error_pct        REAL,
          predicted_fcf_margin_pct        REAL,
          actual_fcf_margin_pct           REAL,
          fcf_margin_error_pct            REAL,
          predicted_fair_value_mid        REAL,
          actual_price_at_review          REAL,
          price_error_pct                 REAL,
          direction_correct               INTEGER,
          prediction_date                 TEXT NOT NULL,
          review_date                     TEXT NOT NULL,
          quarters_elapsed                INTEGER,
          created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_sector
          ON dcf_calibration_errors(sector);
        CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_band
          ON dcf_calibration_errors(market_cap_band);
        CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_prediction
          ON dcf_calibration_errors(prediction_id);

        CREATE TABLE IF NOT EXISTS dcf_calibration_adjustments (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          scope_type        TEXT NOT NULL,
          scope_value       TEXT NOT NULL,
          assumption_key    TEXT NOT NULL,
          adjustment_pct    REAL NOT NULL,
          sample_size       INTEGER NOT NULL,
          confidence        REAL,
          last_computed_at  TEXT NOT NULL,
          UNIQUE(scope_type, scope_value, assumption_key)
        );
      `);
      return;
    } catch (error: any) {
      const message = String(error?.message || '');
      if (!/database is locked/i.test(message) || attempt >= 5) {
        throw error;
      }
      sleepSync(100 * (attempt + 1));
    }
  }
}

function getDb(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA busy_timeout = 5000');
  ensureSchema(_db);
  return _db;
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function deriveMarketCapBand(marketCap: number | null | undefined): MarketCapBand | null {
  if (marketCap == null || !isFinite(marketCap) || marketCap <= 0) return null;
  if (marketCap >= 200_000_000_000) return 'mega';
  if (marketCap >= 10_000_000_000) return 'large';
  if (marketCap >= 2_000_000_000) return 'mid';
  if (marketCap >= 300_000_000) return 'small';
  return 'micro';
}

function toFiniteOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// dcf_predictions — CRUD
// ---------------------------------------------------------------------------

export function logDcfPrediction(p: LogDcfPredictionParams): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO dcf_predictions (
      symbol, sector, industry, market_cap_band, prediction_date,
      price_at_prediction, fair_value_low, fair_value_mid, fair_value_high,
      valuation_gap_pct, judgment, confidence_level,
      revenue_growth_pct, target_fcf_margin_pct, discount_rate_pct,
      terminal_growth_pct, forecast_years,
      annual_revenue, reported_fcf, quality_adjusted_fcf, operating_margin_pct,
      source, engine_version, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `).run(
    p.symbol,
    p.sector ?? null,
    p.industry ?? null,
    p.market_cap_band ?? null,
    p.prediction_date,
    toFiniteOrNull(p.price_at_prediction),
    toFiniteOrNull(p.fair_value_low),
    toFiniteOrNull(p.fair_value_mid),
    toFiniteOrNull(p.fair_value_high),
    toFiniteOrNull(p.valuation_gap_pct),
    p.judgment ?? null,
    p.confidence_level ?? null,
    toFiniteOrNull(p.revenue_growth_pct),
    toFiniteOrNull(p.target_fcf_margin_pct),
    toFiniteOrNull(p.discount_rate_pct),
    toFiniteOrNull(p.terminal_growth_pct),
    p.forecast_years != null ? Math.round(p.forecast_years) : null,
    toFiniteOrNull(p.annual_revenue),
    toFiniteOrNull(p.reported_fcf),
    toFiniteOrNull(p.quality_adjusted_fcf),
    toFiniteOrNull(p.operating_margin_pct),
    p.source,
    p.engine_version ?? null,
    nowIso(),
  );
  return Number((result as any).lastInsertRowid);
}

export function getPredictionsForSymbol(symbol: string, limit = 20): DcfPredictionRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM dcf_predictions
    WHERE symbol = ?
    ORDER BY prediction_date DESC
    LIMIT ?
  `).all(symbol, limit) as DcfPredictionRow[];
}

/**
 * Returns predictions old enough to compare against actual earnings.
 * @param minAgeDays  Minimum age in days since prediction_date (default 90 ≈ 1 quarter)
 * @param onlyUncalibrated  If true, excludes predictions that already have a calibration error row
 */
export function getPredictionsReadyForCalibration(
  minAgeDays = 90,
  onlyUncalibrated = true,
): DcfPredictionRow[] {
  const db = getDb();

  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000)
    .toISOString().slice(0, 10);

  if (onlyUncalibrated) {
    return db.prepare(`
      SELECT p.* FROM dcf_predictions p
      LEFT JOIN dcf_calibration_errors e ON e.prediction_id = p.id
      WHERE p.prediction_date <= ?
        AND e.id IS NULL
      ORDER BY p.prediction_date ASC
    `).all(cutoff) as DcfPredictionRow[];
  }

  return db.prepare(`
    SELECT * FROM dcf_predictions
    WHERE prediction_date <= ?
    ORDER BY prediction_date ASC
  `).all(cutoff) as DcfPredictionRow[];
}

// ---------------------------------------------------------------------------
// dcf_calibration_errors — CRUD
// ---------------------------------------------------------------------------

export function logCalibrationError(p: LogCalibrationErrorParams): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO dcf_calibration_errors (
      prediction_id, symbol, sector, industry, market_cap_band,
      predicted_revenue_growth_pct, actual_revenue_growth_pct, revenue_growth_error_pct,
      predicted_fcf_margin_pct, actual_fcf_margin_pct, fcf_margin_error_pct,
      predicted_fair_value_mid, actual_price_at_review, price_error_pct,
      direction_correct,
      prediction_date, review_date, quarters_elapsed,
      created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?, ?,
      ?
    )
  `).run(
    p.prediction_id,
    p.symbol,
    p.sector ?? null,
    p.industry ?? null,
    p.market_cap_band ?? null,
    toFiniteOrNull(p.predicted_revenue_growth_pct),
    toFiniteOrNull(p.actual_revenue_growth_pct),
    toFiniteOrNull(p.revenue_growth_error_pct),
    toFiniteOrNull(p.predicted_fcf_margin_pct),
    toFiniteOrNull(p.actual_fcf_margin_pct),
    toFiniteOrNull(p.fcf_margin_error_pct),
    toFiniteOrNull(p.predicted_fair_value_mid),
    toFiniteOrNull(p.actual_price_at_review),
    toFiniteOrNull(p.price_error_pct),
    p.direction_correct ?? null,
    p.prediction_date,
    p.review_date,
    p.quarters_elapsed ?? null,
    nowIso(),
  );
  return Number((result as any).lastInsertRowid);
}

export function getCalibrationErrorsByScope(
  scopeType: 'sector' | 'industry' | 'market_cap_band',
  scopeValue: string,
): CalibrationErrorRow[] {
  const db = getDb();
  const column = scopeType === 'market_cap_band' ? 'market_cap_band'
    : scopeType === 'industry' ? 'industry'
    : 'sector';

  return db.prepare(`
    SELECT * FROM dcf_calibration_errors
    WHERE ${column} = ?
    ORDER BY review_date DESC
  `).all(scopeValue) as CalibrationErrorRow[];
}

export function getCalibrationErrorsForPrediction(predictionId: number): CalibrationErrorRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM dcf_calibration_errors
    WHERE prediction_id = ?
  `).all(predictionId) as CalibrationErrorRow[];
}

// ---------------------------------------------------------------------------
// dcf_calibration_adjustments — CRUD
// ---------------------------------------------------------------------------

export function upsertCalibrationAdjustment(p: UpsertCalibrationAdjustmentParams): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO dcf_calibration_adjustments (
      scope_type, scope_value, assumption_key,
      adjustment_pct, sample_size, confidence, last_computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_type, scope_value, assumption_key) DO UPDATE SET
      adjustment_pct   = excluded.adjustment_pct,
      sample_size      = excluded.sample_size,
      confidence       = excluded.confidence,
      last_computed_at = excluded.last_computed_at
  `).run(
    p.scope_type,
    p.scope_value,
    p.assumption_key,
    p.adjustment_pct,
    p.sample_size,
    p.confidence ?? null,
    nowIso(),
  );
}

/**
 * Retrieves active calibration adjustments applicable to a symbol's sector,
 * industry, and market cap band. Returns the most specific adjustments first
 * (industry → sector → market_cap_band → global).
 */
export function getCalibrationAdjustments(
  sector?: string | null,
  industry?: string | null,
  marketCapBand?: MarketCapBand | null,
): CalibrationAdjustmentRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  conditions.push("(scope_type = 'global' AND scope_value = 'all')");

  if (sector) {
    conditions.push("(scope_type = 'sector' AND scope_value = ?)");
    params.push(sector);
  }
  if (industry) {
    conditions.push("(scope_type = 'industry' AND scope_value = ?)");
    params.push(industry);
  }
  if (marketCapBand) {
    conditions.push("(scope_type = 'market_cap_band' AND scope_value = ?)");
    params.push(marketCapBand);
  }

  return db.prepare(`
    SELECT * FROM dcf_calibration_adjustments
    WHERE ${conditions.join(' OR ')}
    ORDER BY
      CASE scope_type
        WHEN 'industry' THEN 1
        WHEN 'sector' THEN 2
        WHEN 'market_cap_band' THEN 3
        WHEN 'global' THEN 4
      END,
      assumption_key
  `).all(...params) as CalibrationAdjustmentRow[];
}

export function getAllCalibrationAdjustments(): CalibrationAdjustmentRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM dcf_calibration_adjustments
    ORDER BY scope_type, scope_value, assumption_key
  `).all() as CalibrationAdjustmentRow[];
}

// ---------------------------------------------------------------------------
// Aggregate helpers (used by the calibration batch job)
// ---------------------------------------------------------------------------

export type CalibrationSummaryRow = {
  scope_type: string;
  scope_value: string;
  assumption_key: string;
  mean_error: number;
  sample_size: number;
};

/**
 * Computes mean error by (scope, assumption) across all calibration errors.
 * Only returns groups with at least `minSampleSize` data points.
 */
export function computeCalibrationSummary(minSampleSize = 10): CalibrationSummaryRow[] {
  const db = getDb();
  const results: CalibrationSummaryRow[] = [];

  const sectorRevGrowth = db.prepare(`
    SELECT sector AS scope_value, 'revenue_growth_pct' AS assumption_key,
           AVG(revenue_growth_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE sector IS NOT NULL AND revenue_growth_error_pct IS NOT NULL
    GROUP BY sector
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of sectorRevGrowth) results.push({ ...r, scope_type: 'sector' });

  const sectorFcfMargin = db.prepare(`
    SELECT sector AS scope_value, 'target_fcf_margin_pct' AS assumption_key,
           AVG(fcf_margin_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE sector IS NOT NULL AND fcf_margin_error_pct IS NOT NULL
    GROUP BY sector
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of sectorFcfMargin) results.push({ ...r, scope_type: 'sector' });

  const bandRevGrowth = db.prepare(`
    SELECT market_cap_band AS scope_value, 'revenue_growth_pct' AS assumption_key,
           AVG(revenue_growth_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE market_cap_band IS NOT NULL AND revenue_growth_error_pct IS NOT NULL
    GROUP BY market_cap_band
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of bandRevGrowth) results.push({ ...r, scope_type: 'market_cap_band' });

  const bandFcfMargin = db.prepare(`
    SELECT market_cap_band AS scope_value, 'target_fcf_margin_pct' AS assumption_key,
           AVG(fcf_margin_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE market_cap_band IS NOT NULL AND fcf_margin_error_pct IS NOT NULL
    GROUP BY market_cap_band
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of bandFcfMargin) results.push({ ...r, scope_type: 'market_cap_band' });

  const globalRevGrowth = db.prepare(`
    SELECT 'all' AS scope_value, 'revenue_growth_pct' AS assumption_key,
           AVG(revenue_growth_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE revenue_growth_error_pct IS NOT NULL
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of globalRevGrowth) {
    if (r.sample_size >= minSampleSize) results.push({ ...r, scope_type: 'global' });
  }

  const globalFcfMargin = db.prepare(`
    SELECT 'all' AS scope_value, 'target_fcf_margin_pct' AS assumption_key,
           AVG(fcf_margin_error_pct) AS mean_error,
           COUNT(*) AS sample_size
    FROM dcf_calibration_errors
    WHERE fcf_margin_error_pct IS NOT NULL
    HAVING COUNT(*) >= ?
  `).all(minSampleSize) as CalibrationSummaryRow[];
  for (const r of globalFcfMargin) {
    if (r.sample_size >= minSampleSize) results.push({ ...r, scope_type: 'global' });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Counts (for the checklist snapshot / dashboard)
// ---------------------------------------------------------------------------

export function getPredictionCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM dcf_predictions').get() as { cnt: number };
  return Number(row.cnt);
}

export function getCalibrationErrorCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM dcf_calibration_errors').get() as { cnt: number };
  return Number(row.cnt);
}

export function getCalibrationAdjustmentCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM dcf_calibration_adjustments').get() as { cnt: number };
  return Number(row.cnt);
}

export function getCalibrationTimestamps(): {
  latest_prediction_at: string | null;
  latest_calibration_error_at: string | null;
  latest_adjustment_at: string | null;
} {
  const db = getDb();
  const pred = db.prepare('SELECT MAX(created_at) AS ts FROM dcf_predictions').get() as { ts: string | null };
  const err = db.prepare('SELECT MAX(created_at) AS ts FROM dcf_calibration_errors').get() as { ts: string | null };
  const adj = db.prepare('SELECT MAX(last_computed_at) AS ts FROM dcf_calibration_adjustments').get() as { ts: string | null };
  return {
    latest_prediction_at: pred?.ts ?? null,
    latest_calibration_error_at: err?.ts ?? null,
    latest_adjustment_at: adj?.ts ?? null,
  };
}
