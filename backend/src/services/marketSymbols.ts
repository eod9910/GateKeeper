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

export function normalizeMarketDataSymbol(raw: unknown): string {
  const input = String(raw || '').trim().toUpperCase();
  if (!input) return '';

  const collapsed = input.replace(/\s+/g, '');
  const unslashed = collapsed.replace(/^\//, '');
  return MARKET_SYMBOL_ALIASES[unslashed] || unslashed;
}

