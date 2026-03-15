export interface RawChartBar {
  timestamp?: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function detectIntradayBars(bars: RawChartBar[]): boolean {
  const seenDates = new Set<string>();
  for (const bar of bars.slice(0, 50)) {
    const ts = String(bar?.timestamp || '');
    if (ts.length < 10) continue;
    const datePart = ts.slice(0, 10);
    if (seenDates.has(datePart)) return true;
    seenDates.add(datePart);
  }
  return false;
}

function parseTimestampToUnixSeconds(timestamp: string): number | null {
  const normalized = String(timestamp || '').trim().replace(' ', 'T');
  if (!normalized) return null;
  const ms = Date.parse(normalized.length === 19 ? `${normalized}Z` : normalized);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function formatChartBars(bars: RawChartBar[]): ChartBar[] {
  const isIntraday = detectIntradayBars(bars);
  const rows: ChartBar[] = [];

  for (const bar of bars) {
    const ts = String(bar?.timestamp || '').trim();
    if (!ts) continue;

    let time: string | number = ts.length >= 10 ? ts.slice(0, 10) : ts;
    if (isIntraday) {
      const parsed = parseTimestampToUnixSeconds(ts.slice(0, 19));
      time = parsed ?? time;
    }

    rows.push({
      time,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
    });
  }

  return rows;
}
