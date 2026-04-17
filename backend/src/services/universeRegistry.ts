import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

type UniverseSchema = 'symbols' | 'optionable' | 'source_symbols' | 'stocks';

type UniverseEntry = {
  path: string;
  schema: UniverseSchema;
  description?: string;
};

type UniverseRegistryFile = {
  generated_at?: string;
  universes?: Record<string, UniverseEntry>;
};

const REGISTRY_PATH = path.join(__dirname, '../../data/universe/registry.json');
const STOCK_EXCLUSIONS_PATH = path.join(__dirname, '../../data/universe/stock_exclusions.json');
const SYMBOL_CATALOG_DB_PATH = path.join(__dirname, '../../data/symbol-catalog.sqlite');
const CATALOG_UNIVERSES = new Set(['tradable_stock_default', 'tradable_optionable_stocks']);

function loadCatalogUniverseSymbolsSync(name: string): string[] {
  if (!CATALOG_UNIVERSES.has(String(name || '').trim())) return [];
  if (!fs.existsSync(SYMBOL_CATALOG_DB_PATH)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(SYMBOL_CATALOG_DB_PATH, { readOnly: true });
    const where = [
      "s.asset_class = 'stocks'",
      "m.membership_type = 'eligibility'",
      "m.membership_value = 'tradable_stock_default'",
    ];
    if (name === 'tradable_optionable_stocks') {
      where.push('s.optionable = 1');
    }
    const rows = db.prepare(`
      SELECT s.symbol
      FROM symbols s
      JOIN symbol_memberships m
        ON m.symbol = s.symbol
      WHERE ${where.join(' AND ')}
      ORDER BY s.symbol ASC
    `).all() as Array<{ symbol?: string }>;
    return normalizeSymbols(rows.map((row) => row?.symbol));
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch {}
  }
}

function normalizeSymbols(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const symbol = String(value || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function applyStockExclusions(symbols: string[], excluded: Set<string>): string[] {
  if (!excluded.size) return symbols;
  return symbols.filter((symbol) => !excluded.has(symbol));
}

function parsePayloadSymbols(payload: any, schema: UniverseSchema): string[] {
  if (schema === 'stocks') {
    const stocks = Array.isArray(payload?.stocks) ? payload.stocks : [];
    return normalizeSymbols(stocks.map((item: any) => item?.ticker));
  }
  if (schema === 'optionable') {
    return normalizeSymbols(payload?.optionable || payload?.symbols || []);
  }
  if (schema === 'source_symbols') {
    return normalizeSymbols(payload?.source_symbols || payload?.symbols || []);
  }
  return normalizeSymbols(payload?.symbols || payload);
}

function readRegistrySync(): UniverseRegistryFile {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as UniverseRegistryFile;
  } catch {
    return {};
  }
}

function readExcludedSymbolsSync(): Set<string> {
  try {
    const payload = JSON.parse(fs.readFileSync(STOCK_EXCLUSIONS_PATH, 'utf-8'));
    return new Set(normalizeSymbols(payload?.symbols || payload));
  } catch {
    return new Set();
  }
}

async function readRegistry(): Promise<UniverseRegistryFile> {
  try {
    return JSON.parse(await fsp.readFile(REGISTRY_PATH, 'utf-8')) as UniverseRegistryFile;
  } catch {
    return {};
  }
}

async function readExcludedSymbols(): Promise<Set<string>> {
  try {
    const payload = JSON.parse(await fsp.readFile(STOCK_EXCLUSIONS_PATH, 'utf-8'));
    return new Set(normalizeSymbols(payload?.symbols || payload));
  } catch {
    return new Set();
  }
}

function resolveUniversePath(entry: UniverseEntry): string {
  return path.resolve(path.dirname(REGISTRY_PATH), entry.path);
}

function loadEntrySymbolsSync(entry: UniverseEntry): string[] {
  try {
    const payload = JSON.parse(fs.readFileSync(resolveUniversePath(entry), 'utf-8'));
    return parsePayloadSymbols(payload, entry.schema);
  } catch {
    return [];
  }
}

async function loadEntrySymbols(entry: UniverseEntry): Promise<string[]> {
  try {
    const payload = JSON.parse(await fsp.readFile(resolveUniversePath(entry), 'utf-8'));
    return parsePayloadSymbols(payload, entry.schema);
  } catch {
    return [];
  }
}

export function loadUniverseSymbolsSync(name: string): string[] {
  if (CATALOG_UNIVERSES.has(name)) {
    return applyStockExclusions(loadCatalogUniverseSymbolsSync(name), readExcludedSymbolsSync());
  }
  const registry = readRegistrySync();
  const entry = registry?.universes?.[name];
  if (!entry) return [];
  return applyStockExclusions(loadEntrySymbolsSync(entry), readExcludedSymbolsSync());
}

export async function loadUniverseSymbols(name: string): Promise<string[]> {
  if (CATALOG_UNIVERSES.has(name)) {
    return applyStockExclusions(loadCatalogUniverseSymbolsSync(name), await readExcludedSymbols());
  }
  const registry = await readRegistry();
  const entry = registry?.universes?.[name];
  if (!entry) return [];
  return applyStockExclusions(await loadEntrySymbols(entry), await readExcludedSymbols());
}

