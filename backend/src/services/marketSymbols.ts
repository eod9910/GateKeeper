const MARKET_SYMBOL_ALIASES: Record<string, string> = {
  MSMES: 'MES=F',
  MSMNQ: 'MNQ=F',
  MSMYM: 'MYM=F',
  MSM2K: 'M2K=F',
  MES: 'MES=F',
  MNQ: 'MNQ=F',
  MYM: 'MYM=F',
  M2K: 'M2K=F',
};

const FUTURES_MONTH_CODES = 'FGHJKMNQUVXZ';

function normalizeContractMonthSymbol(symbol: string): string | null {
  for (const yearLength of [4, 2]) {
    if (symbol.length <= yearLength + 1) continue;
    const year = symbol.slice(-yearLength);
    const monthCode = symbol.slice(-yearLength - 1, -yearLength);
    if (!/^\d+$/.test(year) || !FUTURES_MONTH_CODES.includes(monthCode)) continue;
    const root = symbol.slice(0, -yearLength - 1);
    return MARKET_SYMBOL_ALIASES[root] || MARKET_SYMBOL_ALIASES[`${root}1`] || `${root}=F`;
  }
  return null;
}

export function normalizeMarketDataSymbol(raw: unknown): string {
  const input = String(raw || '').trim().toUpperCase();
  if (!input) return '';

  const collapsed = input.replace(/\s+/g, '');
  const unslashed = collapsed.replace(/^\//, '');
  if (MARKET_SYMBOL_ALIASES[unslashed]) return MARKET_SYMBOL_ALIASES[unslashed];
  return normalizeContractMonthSymbol(unslashed) || unslashed;
}
