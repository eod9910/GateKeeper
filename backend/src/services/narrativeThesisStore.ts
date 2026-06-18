/**
 * Narrative thesis store.
 *
 * Reads/writes the `mi_narrative_theses` table (shared with the convergence
 * board scan) so an extracted social-narrative thesis is available to the
 * Ledger DCF engine and future backtests WITHOUT re-running the (paid) model.
 *
 * It also maps a thesis into a DCF narrative adjustment: a revenue-growth delta,
 * sized by the thesis's conviction (specificity) and direction. This powers the
 * "narrative-adjusted" valuation scenario — the gap between the filing-anchored
 * base case and the narrative case is the expectation gap (narrative leading
 * fundamentals, e.g. RMD / GLP-1 demand risk to CPAP revenue).
 */

import * as fs from 'fs';
import { getMarketIntelligenceDbPath } from './marketIntelligenceDb';

export interface NarrativeThesisItem {
  claim: string;
  driver: string | null;
  mechanism: string | null;
  direction: 'bull' | 'bear' | null;
  specificity: number | null;
  sources: number[];
}

export interface NarrativeThesisRow {
  symbol: string;
  has_thesis: boolean;
  headline: string | null;
  classification: string | null;
  direction: string | null;
  theses: NarrativeThesisItem[];
  narrative: string | null;
  signal_count: number | null;
  noise_count: number | null;
  updated_at: string | null;
}

export interface NarrativeDcfAdjustment {
  direction: 'bull' | 'bear';
  specificity: number;
  revenue_growth_delta_pct: number;
  classification: string | null;
  headline: string | null;
  driver: string | null;
  rationale: string;
  sources: number[];
}

const ADHOC_RUN_ID = 'scanner_adhoc';
// Moderate sizing: at full conviction (specificity 1.0) the haircut is ~the same
// magnitude as the engine's built-in bear-case revenue delta (-4%). Scaled by
// specificity so vague chatter barely moves the number.
const MAX_DELTA_PCT = 5;
// Below this conviction the thesis is treated as too vague to touch valuation.
const MIN_SPECIFICITY = 0.3;

function ensureTable(db: any): void {
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

function dominantDirection(theses: NarrativeThesisItem[]): 'bull' | 'bear' | null {
  let bull = 0;
  let bear = 0;
  for (const t of theses) {
    const weight = typeof t?.specificity === 'number' ? t.specificity : 0.5;
    if (t?.direction === 'bull') bull += weight;
    else if (t?.direction === 'bear') bear += weight;
  }
  if (bull === 0 && bear === 0) return null;
  return bear >= bull ? 'bear' : 'bull';
}

/** Latest stored thesis for a symbol (across board scans and ad-hoc scanner runs). */
export function getLatestNarrativeThesis(symbol: string): NarrativeThesisRow | null {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;
  const dbPath = getMarketIntelligenceDbPath();
  if (!fs.existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tbl = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='mi_narrative_theses'`,
      ).get() as { name?: string } | undefined;
      if (!tbl) return null;
      const row = db.prepare(
        `SELECT * FROM mi_narrative_theses WHERE symbol = ? ORDER BY updated_at DESC LIMIT 1`,
      ).get(sym) as any;
      if (!row) return null;
      let theses: NarrativeThesisItem[] = [];
      try {
        const parsed = JSON.parse(row.theses_json || '[]');
        if (Array.isArray(parsed)) theses = parsed;
      } catch { /* malformed json — treat as no theses */ }
      return {
        symbol: row.symbol,
        has_thesis: !!row.has_thesis,
        headline: row.headline ?? null,
        classification: row.classification ?? null,
        direction: row.direction ?? null,
        theses,
        narrative: row.narrative ?? null,
        signal_count: row.signal_count ?? null,
        noise_count: row.noise_count ?? null,
        updated_at: row.updated_at ?? null,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Best-effort upsert of an on-demand (scanner) thesis so the Ledger DCF and
 * future backtests can read it without paying for another model call.
 */
export function recordAdhocNarrativeThesis(symbol: string, result: any): void {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym || !result) return;
  const dbPath = getMarketIntelligenceDbPath();
  if (!fs.existsSync(dbPath)) return;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      ensureTable(db);
      const theses: NarrativeThesisItem[] = Array.isArray(result.theses) ? result.theses : [];
      db.prepare(
        `INSERT OR REPLACE INTO mi_narrative_theses
         (run_id, symbol, has_thesis, headline, classification, direction, theses_json, narrative, signal_count, noise_count, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        ADHOC_RUN_ID,
        sym,
        result.has_thesis ? 1 : 0,
        result.headline ?? null,
        result.classification ?? null,
        dominantDirection(theses),
        JSON.stringify(theses),
        result.narrative ?? null,
        result.signal_count ?? null,
        result.noise_count ?? null,
        new Date().toISOString(),
      );
    } finally {
      db.close();
    }
  } catch {
    // persistence is best-effort; never block the catalyst response
  }
}

/**
 * Map a stored thesis into a DCF revenue-growth adjustment. Returns null when
 * there is no actionable, sufficiently-specific directional thesis.
 */
export function buildNarrativeAdjustmentFromThesis(
  row: NarrativeThesisRow | null,
): NarrativeDcfAdjustment | null {
  if (!row || !row.has_thesis || !Array.isArray(row.theses) || row.theses.length === 0) return null;
  const dir = dominantDirection(row.theses);
  if (dir !== 'bull' && dir !== 'bear') return null;

  const agreeing = row.theses.filter(
    (t) => t.direction === dir && typeof t.specificity === 'number',
  );
  const specificity = agreeing.reduce((max, t) => Math.max(max, Number(t.specificity) || 0), 0);
  if (specificity < MIN_SPECIFICITY) return null;

  const magnitude = Number((MAX_DELTA_PCT * specificity).toFixed(1));
  if (!(magnitude > 0)) return null;
  const revenue_growth_delta_pct = dir === 'bear' ? -magnitude : magnitude;

  const top = [...agreeing].sort(
    (a, b) => (Number(b.specificity) || 0) - (Number(a.specificity) || 0),
  )[0] || row.theses[0];

  const verb = dir === 'bear' ? 'haircut' : 'lift';
  const sign = revenue_growth_delta_pct > 0 ? '+' : '';
  const rationale =
    `Social-narrative thesis (${dir}, conviction ${(specificity * 100).toFixed(0)}%): ` +
    `${row.headline || top?.claim || 'demand-side narrative'}. ` +
    `Applied a ${sign}${revenue_growth_delta_pct}% near-term revenue-growth ${verb} as a separate ` +
    `scenario — the filing-anchored base case is left untouched.`;

  return {
    direction: dir,
    specificity,
    revenue_growth_delta_pct,
    classification: row.classification ?? null,
    headline: row.headline ?? null,
    driver: top?.driver ?? null,
    rationale,
    sources: Array.isArray(top?.sources) ? top.sources : [],
  };
}
