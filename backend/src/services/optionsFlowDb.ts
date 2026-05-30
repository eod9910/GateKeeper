import * as path from 'path';
import * as fs from 'fs';

const OPTIONS_FLOW_DB_PATH = path.join(__dirname, '..', '..', 'data', 'options-flow.sqlite');

function getDb(): any {
  const { DatabaseSync } = require('node:sqlite');
  if (!fs.existsSync(OPTIONS_FLOW_DB_PATH)) return null;
  return new DatabaseSync(OPTIONS_FLOW_DB_PATH, { readOnly: true });
}

export interface OptionsFlowSnapshot {
  symbol: string;
  trade_date: string;
  stock_price: number | null;
  total_call_volume: number;
  total_put_volume: number;
  put_call_volume_ratio: number | null;
  call_put_volume_ratio: number | null;
  total_call_oi: number;
  total_put_oi: number;
  put_call_oi_ratio: number | null;
  call_put_oi_ratio: number | null;
  iv_skew: number | null;
  anomaly_score: number;
  anomaly_flags: string[];
  flow_bias?: 'put_heavy' | 'call_heavy' | 'balanced';
  dominant_volume_ratio?: number | null;
  imbalance_tier?: 'elevated' | 'heavy' | 'extreme' | 'absurd';
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function enrichSnapshot(r: any): OptionsFlowSnapshot {
  const callVolume = Number(r.total_call_volume || 0);
  const putVolume = Number(r.total_put_volume || 0);
  const callOi = Number(r.total_call_oi || 0);
  const putOi = Number(r.total_put_oi || 0);
  const putCallVolumeRatio = r.put_call_volume_ratio ?? ratio(putVolume, callVolume);
  const callPutVolumeRatio = ratio(callVolume, putVolume);
  const putCallOiRatio = r.put_call_oi_ratio ?? ratio(putOi, callOi);
  const callPutOiRatio = ratio(callOi, putOi);
  const dominantVolumeRatio = Math.max(
    putCallVolumeRatio ?? 0,
    callPutVolumeRatio ?? 0,
  ) || null;
  const flowBias = putCallVolumeRatio != null && putCallVolumeRatio >= 1.3
    ? 'put_heavy'
    : callPutVolumeRatio != null && callPutVolumeRatio >= 1.3
      ? 'call_heavy'
      : 'balanced';
  const imbalanceTier = dominantVolumeRatio == null
    ? undefined
    : dominantVolumeRatio >= 20
      ? 'absurd'
      : dominantVolumeRatio >= 5
        ? 'extreme'
        : dominantVolumeRatio >= 2
          ? 'heavy'
          : dominantVolumeRatio >= 1.3
            ? 'elevated'
            : undefined;
  return {
    symbol: r.symbol,
    trade_date: r.trade_date,
    stock_price: r.stock_price,
    total_call_volume: callVolume,
    total_put_volume: putVolume,
    put_call_volume_ratio: putCallVolumeRatio,
    call_put_volume_ratio: callPutVolumeRatio,
    total_call_oi: callOi,
    total_put_oi: putOi,
    put_call_oi_ratio: putCallOiRatio,
    call_put_oi_ratio: callPutOiRatio,
    iv_skew: r.iv_skew,
    anomaly_score: r.anomaly_score || 0,
    anomaly_flags: r.anomaly_flags ? JSON.parse(r.anomaly_flags) : [],
    flow_bias: flowBias,
    dominant_volume_ratio: dominantVolumeRatio,
    imbalance_tier: imbalanceTier,
  };
}

export interface OptionsFlowAlert {
  symbol: string;
  trade_date: string;
  alert_type: string;
  severity: string;
  headline: string;
  detail: string | null;
}

export interface OptionsOptionabilityStats {
  totals: Record<string, number>;
  clean_universe_count: number;
  optionable_count: number;
  not_optionable_count: number;
  unknown_count: number;
  error_count: number;
  sample_optionable: string[];
  sample_unknown: string[];
}

export interface OptionsChainStats {
  total_contract_rows: number;
  trade_dates: Array<{ trade_date: string; contract_rows: number; symbols: number }>;
}

export function getOptionsChainStats(): OptionsChainStats {
  const db = getDb();
  if (!db) return { total_contract_rows: 0, trade_dates: [] };
  try {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'options_contract_snapshot'
    `).get() as any;
    if (!exists) return { total_contract_rows: 0, trade_dates: [] };
    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM options_contract_snapshot
    `).get() as any;
    const rows = db.prepare(`
      SELECT trade_date, COUNT(*) AS contract_rows, COUNT(DISTINCT symbol) AS symbols
      FROM options_contract_snapshot
      GROUP BY trade_date
      ORDER BY trade_date DESC
      LIMIT 10
    `).all() as any[];
    return {
      total_contract_rows: Number(total?.c || 0),
      trade_dates: rows.map((r: any) => ({
        trade_date: String(r.trade_date),
        contract_rows: Number(r.contract_rows || 0),
        symbols: Number(r.symbols || 0),
      })),
    };
  } finally {
    db.close();
  }
}

export function getOptionsOptionabilityStats(): OptionsOptionabilityStats {
  const db = getDb();
  if (!db) {
    return {
      totals: {},
      clean_universe_count: 0,
      optionable_count: 0,
      not_optionable_count: 0,
      unknown_count: 0,
      error_count: 0,
      sample_optionable: [],
      sample_unknown: [],
    };
  }
  try {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'options_symbol_optionability'
    `).get() as any;
    if (!exists) {
      return {
        totals: {},
        clean_universe_count: 0,
        optionable_count: 0,
        not_optionable_count: 0,
        unknown_count: 0,
        error_count: 0,
        sample_optionable: [],
        sample_unknown: [],
      };
    }
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS c
      FROM options_symbol_optionability
      WHERE in_clean_universe = 1
      GROUP BY status
    `).all() as any[];
    const totals: Record<string, number> = {};
    for (const row of rows) totals[String(row.status)] = Number(row.c || 0);
    const sampleOptionable = db.prepare(`
      SELECT symbol FROM options_symbol_optionability
      WHERE in_clean_universe = 1 AND status = 'optionable'
      ORDER BY symbol LIMIT 25
    `).all() as any[];
    const sampleUnknown = db.prepare(`
      SELECT symbol FROM options_symbol_optionability
      WHERE in_clean_universe = 1 AND status IN ('unknown', 'error')
      ORDER BY status, symbol LIMIT 25
    `).all() as any[];
    const optionable = totals.optionable || 0;
    const notOptionable = totals.not_optionable || 0;
    const unknown = totals.unknown || 0;
    const error = totals.error || 0;
    return {
      totals,
      clean_universe_count: optionable + notOptionable + unknown + error,
      optionable_count: optionable,
      not_optionable_count: notOptionable,
      unknown_count: unknown,
      error_count: error,
      sample_optionable: sampleOptionable.map((r: any) => String(r.symbol)),
      sample_unknown: sampleUnknown.map((r: any) => String(r.symbol)),
    };
  } finally {
    db.close();
  }
}

export function getOptionsFlowForSymbol(symbol: string, days = 30): OptionsFlowSnapshot[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT symbol, trade_date, stock_price,
             total_call_volume, total_put_volume, put_call_volume_ratio,
             total_call_oi, total_put_oi, put_call_oi_ratio,
             iv_skew, anomaly_score, anomaly_flags
      FROM options_daily_snapshot
      WHERE symbol = ?
      ORDER BY trade_date DESC
      LIMIT ?
    `).all(symbol.toUpperCase(), days) as any[];
    return rows.map(enrichSnapshot);
  } finally {
    db.close();
  }
}

export function getLatestOptionsFlow(symbol: string): OptionsFlowSnapshot | null {
  const rows = getOptionsFlowForSymbol(symbol, 1);
  return rows.length > 0 ? rows[0] : null;
}

export function getOptionsFlowAlerts(days = 7, limit = 50): OptionsFlowAlert[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT symbol, trade_date, alert_type, severity, headline, detail
      FROM options_flow_alerts
      WHERE trade_date >= date('now', '-' || ? || ' days')
      ORDER BY trade_date DESC, severity ASC
      LIMIT ?
    `).all(days, limit) as any[];
    return rows.map((r: any) => ({
      symbol: r.symbol,
      trade_date: r.trade_date,
      alert_type: r.alert_type,
      severity: r.severity,
      headline: r.headline,
      detail: r.detail,
    }));
  } finally {
    db.close();
  }
}

export type OptionsFlowDirection = 'put' | 'call' | 'both';
export type OptionsFlowTier = 'elevated' | 'heavy' | 'extreme' | 'absurd';

function tierRatioFloor(tier: OptionsFlowTier): number {
  if (tier === 'absurd') return 20;
  if (tier === 'extreme') return 5;
  if (tier === 'heavy') return 2;
  return 1.3;
}

function minimumDominantVolume(tier: OptionsFlowTier): number {
  if (tier === 'absurd') return 500;
  if (tier === 'extreme') return 300;
  if (tier === 'heavy') return 250;
  return 100;
}

export function getTopAnomalies(
  trade_date?: string,
  limit = 30,
  direction: OptionsFlowDirection = 'both',
  tier: OptionsFlowTier = 'heavy',
): OptionsFlowSnapshot[] {
  const db = getDb();
  if (!db) return [];
  try {
    let date = trade_date;
    if (!date) {
      const latest = db.prepare(`
        SELECT trade_date as d
        FROM options_daily_snapshot
        GROUP BY trade_date
        HAVING COUNT(DISTINCT symbol) >= 50
        ORDER BY trade_date DESC
        LIMIT 1
      `).get() as any;
      date = latest?.d || new Date().toISOString().slice(0, 10);
    }
    const ratioFloor = tierRatioFloor(tier);
    const volumeFloor = minimumDominantVolume(tier);
    const directionFilter = direction === 'put'
      ? `(total_put_volume >= ${volumeFloor} AND put_call_volume_ratio >= ${ratioFloor})`
      : direction === 'call'
        ? `(total_call_volume >= ${volumeFloor} AND total_put_volume > 0 AND total_call_volume >= total_put_volume * ${ratioFloor})`
        : `(
          (total_put_volume >= ${volumeFloor} AND put_call_volume_ratio >= ${ratioFloor})
          OR (total_call_volume >= ${volumeFloor} AND total_put_volume > 0 AND total_call_volume >= total_put_volume * ${ratioFloor})
          OR anomaly_score >= 20
        )`;
    const directionOrder = direction === 'put'
      ? `COALESCE(put_call_volume_ratio, 0) DESC, anomaly_score DESC`
      : direction === 'call'
        ? `CASE WHEN total_put_volume > 0 THEN 1.0 * total_call_volume / total_put_volume ELSE 0 END DESC, anomaly_score DESC`
        : `MAX(
          COALESCE(put_call_volume_ratio, 0),
          CASE
            WHEN total_put_volume > 0 THEN 1.0 * total_call_volume / total_put_volume
            ELSE 0
          END
        ) DESC,
        anomaly_score DESC`;
    const rows = db.prepare(`
      SELECT symbol, trade_date, stock_price,
             total_call_volume, total_put_volume, put_call_volume_ratio,
             total_call_oi, total_put_oi, put_call_oi_ratio,
             iv_skew, anomaly_score, anomaly_flags
      FROM options_daily_snapshot
      WHERE trade_date = ?
        AND ${directionFilter}
      ORDER BY ${directionOrder}
      LIMIT ?
    `).all(date, limit) as any[];
    return rows.map(enrichSnapshot);
  } finally {
    db.close();
  }
}

export function getOptionsFlowBatch(symbols: string[]): Map<string, OptionsFlowSnapshot> {
  const db = getDb();
  if (!db) return new Map();
  try {
    const placeholders = symbols.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT o.* FROM options_daily_snapshot o
      INNER JOIN (
        SELECT symbol, MAX(trade_date) as max_date
        FROM options_daily_snapshot
        WHERE symbol IN (${placeholders})
        GROUP BY symbol
      ) latest ON o.symbol = latest.symbol AND o.trade_date = latest.max_date
    `).all(...symbols.map(s => s.toUpperCase())) as any[];

    const map = new Map<string, OptionsFlowSnapshot>();
    for (const r of rows) {
      map.set(r.symbol, enrichSnapshot(r));
    }
    return map;
  } finally {
    db.close();
  }
}
