import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { CacheEnvelope } from './cacheService';
import type { TradeInstance, ValidationReport } from '../types';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const APP_STATE_DB_PATH = path.join(DATA_DIR, 'app-state.sqlite');

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
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS cache_entries (
          namespace TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          fetched_at INTEGER NOT NULL,
          ttl_ms INTEGER NOT NULL,
          source TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (namespace, cache_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cache_entries_namespace_updated
          ON cache_entries(namespace, updated_at DESC);

        CREATE TABLE IF NOT EXISTS json_documents (
          namespace TEXT NOT NULL,
          document_key TEXT NOT NULL,
          json_value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (namespace, document_key)
        );

        CREATE INDEX IF NOT EXISTS idx_json_documents_namespace_updated
          ON json_documents(namespace, updated_at DESC);

        CREATE TABLE IF NOT EXISTS hydration_jobs (
          job_id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_hydration_jobs_status_updated
          ON hydration_jobs(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS validation_reports (
          report_id TEXT PRIMARY KEY,
          strategy_version_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          decision TEXT,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_validation_reports_strategy_created
          ON validation_reports(strategy_version_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS trade_instances (
          report_id TEXT NOT NULL,
          trade_id TEXT NOT NULL,
          entry_time TEXT,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (report_id, trade_id)
        );

        CREATE INDEX IF NOT EXISTS idx_trade_instances_report_entry
          ON trade_instances(report_id, entry_time ASC);

        CREATE TABLE IF NOT EXISTS app_records (
          namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          user_key TEXT,
          sort_key TEXT,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (namespace, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_app_records_namespace_sort
          ON app_records(namespace, sort_key DESC, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_app_records_namespace_user
          ON app_records(namespace, user_key, updated_at DESC);
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
  _db = new DatabaseSync(APP_STATE_DB_PATH);
  ensureSchema(_db);
  return _db;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getAppStateDbPath(): string {
  return APP_STATE_DB_PATH;
}

export function readAppCacheEnvelope<T>(
  namespace: string,
  key: string,
  normalizeData?: (value: unknown) => T,
): CacheEnvelope<T> | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT cache_key, fetched_at, ttl_ms, source, version, data_json
    FROM cache_entries
    WHERE namespace = ? AND cache_key = ?
  `).get(namespace, key) as
    | {
        cache_key: string;
        fetched_at: number;
        ttl_ms: number;
        source: string;
        version: number;
        data_json: string;
      }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(String(row.data_json || 'null'));
    const data = normalizeData ? normalizeData(parsed) : (parsed as T);
    return {
      key: String(row.cache_key || key),
      fetchedAt: Number(row.fetched_at),
      ttlMs: Number(row.ttl_ms),
      source: String(row.source || ''),
      version: Number.isFinite(row.version) ? Number(row.version) : 1,
      data,
    };
  } catch {
    return null;
  }
}

export function writeAppCacheEnvelope<T>(namespace: string, entry: CacheEnvelope<T>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO cache_entries (
      namespace, cache_key, fetched_at, ttl_ms, source, version, data_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(namespace, cache_key) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      ttl_ms = excluded.ttl_ms,
      source = excluded.source,
      version = excluded.version,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `).run(
    namespace,
    entry.key,
    Number(entry.fetchedAt),
    Number(entry.ttlMs),
    String(entry.source || ''),
    Number.isFinite(entry.version) ? Number(entry.version) : 1,
    JSON.stringify(entry.data),
    nowIso(),
  );
}

export function readJsonDocument<T>(
  namespace: string,
  documentKey: string,
  normalize?: (value: unknown) => T,
): T | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT json_value
    FROM json_documents
    WHERE namespace = ? AND document_key = ?
  `).get(namespace, documentKey) as { json_value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(String(row.json_value || 'null'));
    return normalize ? normalize(parsed) : (parsed as T);
  } catch {
    return null;
  }
}

export function writeJsonDocument<T>(namespace: string, documentKey: string, payload: T): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO json_documents (namespace, document_key, json_value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, document_key) DO UPDATE SET
      json_value = excluded.json_value,
      updated_at = excluded.updated_at
  `).run(namespace, documentKey, JSON.stringify(payload), nowIso());
}

export function hasJsonDocument(namespace: string, documentKey: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1
    FROM json_documents
    WHERE namespace = ? AND document_key = ?
    LIMIT 1
  `).get(namespace, documentKey) as { 1: number } | undefined;
  return Boolean(row);
}

export function deleteJsonDocument(namespace: string, documentKey: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM json_documents
    WHERE namespace = ? AND document_key = ?
  `).run(namespace, documentKey);
}

export interface HydrationJobRecord<T = any> {
  job_id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  payload: T | null;
}

export function readLatestHydrationJob<T = any>(
  jobType = 'ledger_sync',
): HydrationJobRecord<T> | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT job_id, job_type, status, started_at, completed_at, updated_at, payload_json
    FROM hydration_jobs
    WHERE job_type = ?
    ORDER BY
      CASE WHEN status = 'running' THEN 0 ELSE 1 END,
      COALESCE(updated_at, started_at) DESC
    LIMIT 1
  `).get(jobType) as
    | {
        job_id: string;
        job_type: string;
        status: string;
        started_at: string | null;
        completed_at: string | null;
        updated_at: string;
        payload_json: string;
      }
    | undefined;
  if (!row) return null;
  let payload: T | null = null;
  try {
    payload = JSON.parse(String(row.payload_json || 'null')) as T;
  } catch {
    payload = null;
  }
  return {
    job_id: String(row.job_id || ''),
    job_type: String(row.job_type || jobType),
    status: String(row.status || ''),
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    updated_at: String(row.updated_at || ''),
    payload,
  };
}

export function writeValidationReport(report: ValidationReport): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO validation_reports (
      report_id, strategy_version_id, created_at, decision, payload_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_id) DO UPDATE SET
      strategy_version_id = excluded.strategy_version_id,
      created_at = excluded.created_at,
      decision = excluded.decision,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(
    String(report.report_id || ''),
    String(report.strategy_version_id || ''),
    String(report.created_at || nowIso()),
    report.decision_log?.decision ? String(report.decision_log.decision) : null,
    JSON.stringify(report),
    nowIso(),
  );
}

export function listValidationReports(strategyVersionId?: string): ValidationReport[] {
  const db = getDb();
  const rows = strategyVersionId
    ? db.prepare(`
        SELECT payload_json
        FROM validation_reports
        WHERE strategy_version_id = ?
        ORDER BY created_at DESC
      `).all(String(strategyVersionId || ''))
    : db.prepare(`
        SELECT payload_json
        FROM validation_reports
        ORDER BY created_at DESC
      `).all();
  return rows.flatMap((row: any) => {
    try {
      return [JSON.parse(String(row.payload_json || 'null')) as ValidationReport];
    } catch {
      return [];
    }
  });
}

export function readValidationReport(reportId: string): ValidationReport | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM validation_reports
    WHERE report_id = ?
  `).get(String(reportId || '')) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(String(row.payload_json || 'null')) as ValidationReport;
  } catch {
    return null;
  }
}

export function deleteValidationReportRecord(reportId: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM validation_reports
    WHERE report_id = ?
  `).run(String(reportId || ''));
}

export function replaceTradeInstances(reportId: string, trades: TradeInstance[]): void {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO trade_instances (
      report_id, trade_id, entry_time, payload_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(report_id, trade_id) DO UPDATE SET
      entry_time = excluded.entry_time,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const deleteStmt = db.prepare(`
    DELETE FROM trade_instances
    WHERE report_id = ?
  `);
  const targetReportId = String(reportId || '');
  const targetTrades = Array.isArray(trades) ? trades : [];
  db.exec('BEGIN');
  try {
    deleteStmt.run(targetReportId);
    for (const trade of targetTrades) {
      insertStmt.run(
        targetReportId,
        String(trade.trade_id || ''),
        trade.entry_time ? String(trade.entry_time) : null,
        JSON.stringify(trade),
        nowIso(),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures and surface the original error.
    }
    throw error;
  }
}

export function listTradeInstances(reportId: string): TradeInstance[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT payload_json
    FROM trade_instances
    WHERE report_id = ?
    ORDER BY entry_time ASC, trade_id ASC
  `).all(String(reportId || ''));
  return rows.flatMap((row: any) => {
    try {
      return [JSON.parse(String(row.payload_json || 'null')) as TradeInstance];
    } catch {
      return [];
    }
  });
}

export function deleteTradeInstancesByReport(reportId: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM trade_instances
    WHERE report_id = ?
  `).run(String(reportId || ''));
}

export function writeAppRecord<T>(
  namespace: string,
  recordId: string,
  payload: T,
  options?: { userKey?: string | null; sortKey?: string | null },
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO app_records (
      namespace, record_id, user_key, sort_key, payload_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(namespace, record_id) DO UPDATE SET
      user_key = excluded.user_key,
      sort_key = excluded.sort_key,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(
    namespace,
    String(recordId || ''),
    options?.userKey ?? null,
    options?.sortKey ?? null,
    JSON.stringify(payload),
    nowIso(),
  );
}

export function readAppRecord<T>(namespace: string, recordId: string): T | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT payload_json
    FROM app_records
    WHERE namespace = ? AND record_id = ?
  `).get(namespace, String(recordId || '')) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(String(row.payload_json || 'null')) as T;
  } catch {
    return null;
  }
}

export function listAppRecords<T>(
  namespace: string,
  options?: { userKey?: string | null; ascending?: boolean },
): T[] {
  const db = getDb();
  const direction = options?.ascending ? 'ASC' : 'DESC';
  const sql = options?.userKey != null
    ? `
        SELECT payload_json
        FROM app_records
        WHERE namespace = ? AND user_key = ?
        ORDER BY sort_key ${direction}, updated_at ${direction}
      `
    : `
        SELECT payload_json
        FROM app_records
        WHERE namespace = ?
        ORDER BY sort_key ${direction}, updated_at ${direction}
      `;
  const rows = options?.userKey != null
    ? db.prepare(sql).all(namespace, options.userKey)
    : db.prepare(sql).all(namespace);
  return rows.flatMap((row: any) => {
    try {
      return [JSON.parse(String(row.payload_json || 'null')) as T];
    } catch {
      return [];
    }
  });
}

export function deleteAppRecord(namespace: string, recordId: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM app_records
    WHERE namespace = ? AND record_id = ?
  `).run(namespace, String(recordId || ''));
}

export function clearAppRecords(namespace: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM app_records
    WHERE namespace = ?
  `).run(namespace);
}
