import * as path from 'path';
import * as fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'edgar-filings.sqlite');

let _db: DatabaseSync | null = null;

export interface EdgarInsiderTransaction {
  id: number;
  symbol: string;
  cik: string | null;
  filing_date: string;
  accession_number: string;
  insider_name: string | null;
  insider_title: string | null;
  transaction_type: string | null;
  transaction_date: string | null;
  shares: number | null;
  price_per_share: number | null;
  total_value: number | null;
  shares_owned_after: number | null;
  is_direct: number;
  filing_url: string | null;
  created_at: string;
}

export interface EdgarFilingAlert {
  id: number;
  symbol: string;
  alert_type: string;
  severity: string;
  headline: string | null;
  details_json: string | null;
  filing_date: string | null;
  created_at: string;
}

export interface EdgarInsiderSummary {
  symbol: string;
  buy_count: number;
  sell_count: number;
  buy_value: number;
  sell_value: number;
  unique_buyers: number;
  unique_sellers: number;
  latest_filing_date: string | null;
  has_cluster_alert: boolean;
  has_csuite_purchase: boolean;
}

function getDb(): DatabaseSync | null {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    _db = new DatabaseSync(DB_PATH, { open: true });
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA busy_timeout = 5000');
    return _db;
  } catch {
    return null;
  }
}

/**
 * Get recent insider transactions for a symbol, formatted to match FundamentalsInsiderTrade shape.
 */
export function getInsiderTradesForSymbol(
  symbol: string,
  limit = 15,
  lookbackDays = 90,
): EdgarInsiderTransaction[] {
  const db = getDb();
  if (!db) return [];

  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  try {
    const stmt = db.prepare(`
      SELECT * FROM insider_transactions
      WHERE symbol = ? AND filing_date >= ?
      ORDER BY transaction_date DESC, filing_date DESC
      LIMIT ?
    `);
    return stmt.all(symbol.toUpperCase(), cutoff, limit) as EdgarInsiderTransaction[];
  } catch {
    return [];
  }
}

const TXN_CODE_LABELS: Record<string, string> = {
  P: 'Purchase',
  S: 'Sale',
  A: 'Award',
  D: 'Disposition to Issuer',
  F: 'Tax Withholding',
  M: 'Option Exercise',
  G: 'Gift',
  C: 'Conversion',
  J: 'Other',
  W: 'Will/Inheritance',
};

/**
 * Convert EDGAR transactions to the FundamentalsInsiderTrade format used by the UI.
 */
export function toFundamentalsInsiderTrades(txns: EdgarInsiderTransaction[]): Array<{
  insider: string | null;
  relationship: string | null;
  date: string | null;
  transaction: string | null;
  cost: string | null;
  shares: string | null;
  value: string | null;
  source: 'edgar';
}> {
  return txns.map((t) => ({
    insider: t.insider_name || null,
    relationship: t.insider_title || null,
    date: t.transaction_date || t.filing_date || null,
    transaction: TXN_CODE_LABELS[t.transaction_type || ''] || t.transaction_type || null,
    cost: t.price_per_share != null ? `$${t.price_per_share.toFixed(2)}` : null,
    shares: t.shares != null ? t.shares.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null,
    value: t.total_value != null
      ? (t.total_value >= 1e6
        ? `$${(t.total_value / 1e6).toFixed(1)}M`
        : `$${t.total_value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
      : null,
    source: 'edgar' as const,
  }));
}

/**
 * Get insider activity summary for multiple symbols (batch, for the /screen endpoint).
 * Returns buy/sell counts and values from the last N days of EDGAR data.
 */
export function getInsiderSummaryBatch(
  symbols: string[],
  lookbackDays = 90,
): Map<string, EdgarInsiderSummary> {
  const db = getDb();
  const result = new Map<string, EdgarInsiderSummary>();
  if (!db || !symbols.length) return result;

  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  const upperSymbols = symbols.map((s) => s.toUpperCase());

  try {
    const placeholders = upperSymbols.map(() => '?').join(',');

    const txnRows = db.prepare(`
      SELECT symbol,
             transaction_type,
             COUNT(*) as cnt,
             COALESCE(SUM(total_value), 0) as total_val,
             COUNT(DISTINCT insider_name) as unique_insiders,
             MAX(filing_date) as latest_date
      FROM insider_transactions
      WHERE symbol IN (${placeholders}) AND filing_date >= ?
      GROUP BY symbol, transaction_type
    `).all(...upperSymbols, cutoff) as Array<{
      symbol: string;
      transaction_type: string;
      cnt: number;
      total_val: number;
      unique_insiders: number;
      latest_date: string;
    }>;

    for (const row of txnRows) {
      let summary = result.get(row.symbol);
      if (!summary) {
        summary = {
          symbol: row.symbol,
          buy_count: 0,
          sell_count: 0,
          buy_value: 0,
          sell_value: 0,
          unique_buyers: 0,
          unique_sellers: 0,
          latest_filing_date: null,
          has_cluster_alert: false,
          has_csuite_purchase: false,
        };
        result.set(row.symbol, summary);
      }

      if (row.transaction_type === 'P') {
        summary.buy_count += row.cnt;
        summary.buy_value += row.total_val;
        summary.unique_buyers = row.unique_insiders;
      } else if (row.transaction_type === 'S') {
        summary.sell_count += row.cnt;
        summary.sell_value += row.total_val;
        summary.unique_sellers = row.unique_insiders;
      }

      if (!summary.latest_filing_date || row.latest_date > summary.latest_filing_date) {
        summary.latest_filing_date = row.latest_date;
      }
    }

    const alertRows = db.prepare(`
      SELECT symbol, alert_type
      FROM filing_alerts
      WHERE symbol IN (${placeholders}) AND filing_date >= ?
    `).all(...upperSymbols, cutoff) as Array<{ symbol: string; alert_type: string }>;

    for (const row of alertRows) {
      const summary = result.get(row.symbol);
      if (summary) {
        if (row.alert_type === 'cluster_buying') summary.has_cluster_alert = true;
        if (row.alert_type === 'csuite_purchase') summary.has_csuite_purchase = true;
      }
    }
  } catch {
    // DB may not exist yet
  }

  return result;
}

/**
 * Get filing alerts for a symbol or all symbols.
 */
export function getFilingAlerts(
  symbol?: string,
  limit = 50,
  lookbackDays = 30,
): EdgarFilingAlert[] {
  const db = getDb();
  if (!db) return [];

  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  try {
    if (symbol) {
      return db.prepare(`
        SELECT * FROM filing_alerts
        WHERE symbol = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT ?
      `).all(symbol.toUpperCase(), cutoff, limit) as EdgarFilingAlert[];
    }
    return db.prepare(`
      SELECT * FROM filing_alerts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as EdgarFilingAlert[];
  } catch {
    return [];
  }
}

/**
 * Get all recent insider transactions across the universe.
 */
export function getRecentTransactions(
  limit = 100,
  lookbackDays = 14,
  transactionType?: string,
): EdgarInsiderTransaction[] {
  const db = getDb();
  if (!db) return [];

  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  try {
    if (transactionType) {
      return db.prepare(`
        SELECT * FROM insider_transactions
        WHERE filing_date >= ? AND transaction_type = ?
        ORDER BY transaction_date DESC, filing_date DESC
        LIMIT ?
      `).all(cutoff, transactionType, limit) as EdgarInsiderTransaction[];
    }
    return db.prepare(`
      SELECT * FROM insider_transactions
      WHERE filing_date >= ?
      ORDER BY transaction_date DESC, filing_date DESC
      LIMIT ?
    `).all(cutoff, limit) as EdgarInsiderTransaction[];
  } catch {
    return [];
  }
}

// ── 13F Institutional Holdings ──────────────────────────────────────────────

export interface InstitutionalHolding {
  id: number;
  fund_cik: string;
  fund_name: string | null;
  report_period: string;
  filing_date: string;
  accession_number: string;
  symbol: string | null;
  cusip: string | null;
  issuer_name: string | null;
  title_of_class: string | null;
  value_thousands: number | null;
  shares: number | null;
  share_type: string | null;
  put_call: string | null;
  investment_discretion: string | null;
  created_at: string;
}

export interface FundInfo {
  cik: string;
  name: string;
  short_name: string | null;
  category: string | null;
  is_notable: number;
  last_filing_date: string | null;
  last_report_period: string | null;
}

export interface SmartMoneySummary {
  symbol: string;
  fund_count: number;
  total_value_thousands: number;
  total_shares: number;
  funds: Array<{ name: string; shares: number; value_thousands: number }>;
  report_period: string | null;
}

function has13fTables(): boolean {
  const db = getDb();
  if (!db) return false;
  try {
    db.prepare("SELECT 1 FROM institutional_holdings LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get institutional holdings for a specific symbol from the latest report period.
 */
export function getInstitutionalHoldings(
  symbol: string,
  limit = 50,
): InstitutionalHolding[] {
  const db = getDb();
  if (!db || !has13fTables()) return [];

  try {
    return db.prepare(`
      SELECT * FROM institutional_holdings
      WHERE symbol = ?
      ORDER BY report_period DESC, value_thousands DESC
      LIMIT ?
    `).all(symbol.toUpperCase(), limit) as InstitutionalHolding[];
  } catch {
    return [];
  }
}

/**
 * Get smart money summary for multiple symbols (batch).
 * Returns which notable funds hold each symbol and total values.
 */
export function getSmartMoneySummaryBatch(
  symbols: string[],
): Map<string, SmartMoneySummary> {
  const db = getDb();
  const result = new Map<string, SmartMoneySummary>();
  if (!db || !symbols.length || !has13fTables()) return result;

  const upperSymbols = symbols.map((s) => s.toUpperCase());

  try {
    const placeholders = upperSymbols.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT h.symbol, h.fund_name, h.shares, h.value_thousands, h.report_period
      FROM institutional_holdings h
      WHERE h.symbol IN (${placeholders})
        AND h.report_period = (
          SELECT MAX(h2.report_period) FROM institutional_holdings h2
          WHERE h2.symbol = h.symbol
        )
      ORDER BY h.symbol, h.value_thousands DESC
    `).all(...upperSymbols) as Array<{
      symbol: string;
      fund_name: string;
      shares: number;
      value_thousands: number;
      report_period: string;
    }>;

    for (const row of rows) {
      let summary = result.get(row.symbol);
      if (!summary) {
        summary = {
          symbol: row.symbol,
          fund_count: 0,
          total_value_thousands: 0,
          total_shares: 0,
          funds: [],
          report_period: row.report_period,
        };
        result.set(row.symbol, summary);
      }
      summary.fund_count += 1;
      summary.total_value_thousands += row.value_thousands || 0;
      summary.total_shares += row.shares || 0;
      summary.funds.push({
        name: row.fund_name || 'Unknown',
        shares: row.shares || 0,
        value_thousands: row.value_thousands || 0,
      });
    }
  } catch {
    // Tables may not exist yet
  }

  return result;
}

/**
 * Get the list of tracked funds from the registry.
 */
export function getFundRegistry(): FundInfo[] {
  const db = getDb();
  if (!db || !has13fTables()) return [];

  try {
    const rows = db.prepare(`
      SELECT cik, name, short_name, category, is_notable,
             last_filing_date, last_report_period
      FROM fund_registry
      WHERE is_notable = 1
      ORDER BY name
    `).all();
    return rows as FundInfo[];
  } catch {
    return [];
  }
}

/**
 * Get top institutional holdings across the universe — symbols held by the most funds.
 */
export function getTopSmartMoneySymbols(limit = 30): Array<{
  symbol: string;
  fund_count: number;
  total_value_thousands: number;
  report_period: string;
}> {
  const db = getDb();
  if (!db || !has13fTables()) return [];

  try {
    return db.prepare(`
      SELECT symbol,
             COUNT(DISTINCT fund_cik) as fund_count,
             SUM(value_thousands) as total_value_thousands,
             MAX(report_period) as report_period
      FROM institutional_holdings
      WHERE symbol IS NOT NULL
        AND report_period = (SELECT MAX(report_period) FROM institutional_holdings)
      GROUP BY symbol
      ORDER BY fund_count DESC, total_value_thousands DESC
      LIMIT ?
    `).all(limit) as Array<{
      symbol: string;
      fund_count: number;
      total_value_thousands: number;
      report_period: string;
    }>;
  } catch {
    return [];
  }
}
