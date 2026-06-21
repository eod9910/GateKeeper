export type AutoLabelClass = 'yes' | 'no' | 'close';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function toFinite(value: any): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function extractJsonObject(raw: string): any | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeLabel(raw: any): AutoLabelClass {
  const label = String(raw || '').trim().toLowerCase();
  if (label === 'yes' || label === 'no' || label === 'close') return label;
  if (label === 'skip') return 'close';
  return 'close';
}
