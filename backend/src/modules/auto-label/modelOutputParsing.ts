import type { CandidateSnapshot } from './candidateSnapshot';

export type AutoLabelClass = 'yes' | 'no' | 'close';

export interface AutoLabelModelPrediction {
  label: AutoLabelClass;
  labelConfidence: number;
  needsCorrection: boolean;
  baseTop?: number;
  baseBottom?: number;
  correctionConfidence: number;
  reasoning: string;
  modelVersion: string;
  raw?: string;
}

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

export function fallbackHeuristic(snapshot: CandidateSnapshot): AutoLabelModelPrediction {
  const baseTop = toFinite(snapshot.base?.high);
  const baseBottom = toFinite(snapshot.base?.low);
  const score = Number.isFinite(snapshot.score) ? snapshot.score : 0;
  const label: AutoLabelClass = score >= 0.8 ? 'yes' : (score >= 0.6 ? 'close' : 'no');

  return {
    label,
    labelConfidence: clamp01(score),
    needsCorrection: Number.isFinite(baseTop) && Number.isFinite(baseBottom) && baseTop! > baseBottom!,
    baseTop,
    baseBottom,
    correctionConfidence: Number.isFinite(baseTop) && Number.isFinite(baseBottom) ? 0.55 : 0,
    reasoning: 'Heuristic fallback from scanner score.',
    modelVersion: 'heuristic-fallback-v1',
  };
}

export function normalizePrediction(rawParsed: any, modelVersion: string, rawText: string, snapshot: CandidateSnapshot): AutoLabelModelPrediction {
  if (!rawParsed || typeof rawParsed !== 'object') {
    return fallbackHeuristic(snapshot);
  }

  const label = normalizeLabel(rawParsed.label);
  const labelConfidence = clamp01(Number(rawParsed.label_confidence));
  const needsCorrection = !!rawParsed.needs_correction;
  let baseTop = toFinite(rawParsed.base_top);
  let baseBottom = toFinite(rawParsed.base_bottom);
  if (Number.isFinite(baseTop) && Number.isFinite(baseBottom) && baseBottom! > baseTop!) {
    const tmp = baseTop!;
    baseTop = baseBottom;
    baseBottom = tmp;
  }

  return {
    label,
    labelConfidence,
    needsCorrection,
    baseTop,
    baseBottom,
    correctionConfidence: clamp01(Number(rawParsed.correction_confidence)),
    reasoning: String(rawParsed.reasoning || '').slice(0, 220),
    modelVersion,
    raw: rawText,
  };
}
