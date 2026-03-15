export interface DensityBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface DensityBaseZone {
  top: number;
  bottom: number;
  midpoint: number;
  width: number;
  widthPct: number;
  barCount: number;
  totalBars: number;
  density: number;
  quality: number;
  startIndex: number;
  endIndex: number;
  startTime: string;
  endTime: string;
}

export interface DensityBaseResult {
  zones: DensityBaseZone[];
  best: DensityBaseZone | null;
  atr: number;
  priceMin: number;
  priceMax: number;
  histogram: { lo: number; hi: number; count: number; pct: number }[];
}

export interface DensityBaseOptions {
  binCount?: number;
  densityThreshold?: number;
  atrLength?: number;
  minBarsInZone?: number;
  useHighLow?: boolean;
  windowStart?: number;
  windowEnd?: number;
}

function computeATR(bars: DensityBar[], length: number): number {
  if (bars.length < 2) return 0;
  let atr = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    if (i <= length) {
      atr = i === 1 ? tr : atr + tr;
      if (i === length) atr /= length;
    } else {
      atr = (atr * (length - 1) + tr) / length;
    }
  }
  return atr;
}

export function detectBaseFromDensity(bars: DensityBar[], options: DensityBaseOptions = {}): DensityBaseResult {
  const {
    binCount = 50,
    densityThreshold = 0.6,
    atrLength = 14,
    minBarsInZone = 5,
    useHighLow = true,
    windowStart,
    windowEnd,
  } = options;

  const start = windowStart ?? 0;
  const end = windowEnd ?? bars.length - 1;
  const slice = bars.slice(start, end + 1);

  const empty: DensityBaseResult = {
    zones: [],
    best: null,
    atr: 0,
    priceMin: 0,
    priceMax: 0,
    histogram: [],
  };

  if (slice.length < 20) return empty;

  const atr = computeATR(slice, Math.min(atrLength, slice.length - 1));

  const prices: { value: number; barIdx: number }[] = [];
  for (let i = 0; i < slice.length; i++) {
    prices.push({ value: slice[i].close, barIdx: i });
    if (useHighLow) {
      prices.push({ value: slice[i].high, barIdx: i });
      prices.push({ value: slice[i].low, barIdx: i });
    }
  }

  const allValues = prices.map(p => p.value);
  const priceMin = Math.min(...allValues);
  const priceMax = Math.max(...allValues);
  const range = priceMax - priceMin;
  if (range <= 0) return empty;

  const effectiveBins = Math.max(10, Math.min(binCount, Math.round(range / (atr * 0.1))));
  const binSize = range / effectiveBins;

  const bins: { lo: number; hi: number; count: number; pct: number; barIndices: Set<number> }[] = [];
  for (let b = 0; b < effectiveBins; b++) {
    bins.push({
      lo: priceMin + b * binSize,
      hi: priceMin + (b + 1) * binSize,
      count: 0,
      pct: 0,
      barIndices: new Set(),
    });
  }

  for (const p of prices) {
    const idx = Math.min(effectiveBins - 1, Math.floor((p.value - priceMin) / binSize));
    bins[idx].count++;
    bins[idx].barIndices.add(p.barIdx);
  }

  const maxCount = Math.max(...bins.map(b => b.count));
  if (maxCount === 0) return empty;
  bins.forEach(b => { b.pct = b.count / maxCount; });

  const histogram = bins.map(b => ({ lo: b.lo, hi: b.hi, count: b.count, pct: b.pct }));

  const zones: DensityBaseZone[] = [];
  let inZone = false;
  let zoneStartBin = 0;

  for (let d = 0; d <= bins.length; d++) {
    const aboveThreshold = d < bins.length && bins[d].pct >= densityThreshold;
    if (aboveThreshold && !inZone) {
      zoneStartBin = d;
      inZone = true;
    } else if (!aboveThreshold && inZone) {
      const zoneBins = bins.slice(zoneStartBin, d);
      const uniqueBars = new Set<number>();
      zoneBins.forEach(b => b.barIndices.forEach(idx => uniqueBars.add(idx)));

      if (uniqueBars.size >= minBarsInZone) {
        const barIndices = Array.from(uniqueBars).sort((a, b) => a - b);
        const top = zoneBins[zoneBins.length - 1].hi;
        const bottom = zoneBins[0].lo;
        const width = top - bottom;
        const midpoint = (top + bottom) / 2;
        const totalPrices = zoneBins.reduce((sum, b) => sum + b.count, 0);

        const density = uniqueBars.size / slice.length;
        const tightness = atr > 0 ? 1 - Math.min(1, width / (atr * 3)) : 0.5;
        const quality = density * 0.6 + tightness * 0.4;

        zones.push({
          top,
          bottom,
          midpoint,
          width,
          widthPct: (width / midpoint) * 100,
          barCount: uniqueBars.size,
          totalBars: slice.length,
          density,
          quality,
          startIndex: start + barIndices[0],
          endIndex: start + barIndices[barIndices.length - 1],
          startTime: bars[start + barIndices[0]].time,
          endTime: bars[start + barIndices[barIndices.length - 1]].time,
        });
      }
      inZone = false;
    }
  }

  zones.sort((a, b) => b.quality - a.quality);
  const best = zones.length > 0 ? zones[0] : null;

  return { zones, best, atr, priceMin, priceMax, histogram };
}
