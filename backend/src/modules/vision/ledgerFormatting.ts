export function ledgerDisplayNumber(value: unknown, digits: number = 1): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : 'N/A';
}

export function ledgerDisplayMoney(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

export function ledgerDisplayPct(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : 'N/A';
}

export function ledgerScaleNumber(value: unknown, scale?: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const normalizedScale = String(scale || '').toLowerCase();
  if (normalizedScale === 'thousands') return num * 1_000;
  if (normalizedScale === 'millions') return num * 1_000_000;
  if (normalizedScale === 'billions') return num * 1_000_000_000;
  return num;
}

export function ledgerMetricValue(metric: any): number | null {
  if (metric && typeof metric === 'object' && 'value' in metric) {
    return ledgerScaleNumber(metric.value, metric.scale);
  }
  return ledgerScaleNumber(metric);
}

export function ledgerFirstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return null;
}
