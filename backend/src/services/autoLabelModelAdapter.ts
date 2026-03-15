import fetch from 'node-fetch';
import { getConfiguredOpenAIKey } from './aiSettings';

export type AutoLabelClass = 'yes' | 'no' | 'close';

export interface AutoLabelModelPrediction {
  label: AutoLabelClass;
  labelConfidence: number; // 0..1
  needsCorrection: boolean;
  baseTop?: number;
  baseBottom?: number;
  correctionConfidence: number; // 0..1
  reasoning: string;
  modelVersion: string;
  raw?: string;
}

type CandidateSnapshot = {
  id: string;
  symbol: string;
  timeframe: string;
  patternType: string;
  score: number;
  entryReady: boolean;
  base?: {
    low?: number;
    high?: number;
    startIndex?: number;
    endIndex?: number;
  };
  checklistPassed?: number;
  checklistTotal?: number;
  chartStats?: {
    bars: number;
    minClose: number;
    maxClose: number;
    latestClose: number;
    meanClose: number;
    stdClose: number;
  };
};

const DEFAULT_PROVIDER = (process.env.VISION_PROVIDER || 'openai').toLowerCase();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.VISION_MODEL || 'minicpm-v';
const OPENAI_AUTO_LABEL_MODEL = process.env.OPENAI_AUTO_LABEL_MODEL
  || process.env.OPENAI_CHAT_MODEL
  || 'gpt-4o';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toFinite(value: any): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function extractJsonObject(raw: string): any | null {
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

function normalizeLabel(raw: any): AutoLabelClass {
  const label = String(raw || '').trim().toLowerCase();
  if (label === 'yes' || label === 'no' || label === 'close') return label;
  if (label === 'skip') return 'close';
  return 'close';
}

function summarizeChartStats(chartData: any): CandidateSnapshot['chartStats'] {
  if (!Array.isArray(chartData) || !chartData.length) return undefined;
  const closes = chartData
    .map((bar) => Number(bar?.close))
    .filter((n) => Number.isFinite(n));

  if (!closes.length) return undefined;
  const bars = closes.length;
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const latestClose = closes[bars - 1];
  const meanClose = closes.reduce((acc, v) => acc + v, 0) / bars;
  const variance = closes.reduce((acc, v) => acc + ((v - meanClose) ** 2), 0) / bars;
  const stdClose = Math.sqrt(variance);

  return { bars, minClose, maxClose, latestClose, meanClose, stdClose };
}

function buildCandidateSnapshot(candidate: any): CandidateSnapshot {
  const rules = Array.isArray(candidate?.rule_checklist) ? candidate.rule_checklist : [];
  const passed = rules.filter((r: any) => !!r?.passed).length;
  const chartStats = summarizeChartStats(candidate?.chart_data);

  return {
    id: String(candidate?.id || candidate?.candidate_id || ''),
    symbol: String(candidate?.symbol || ''),
    timeframe: String(candidate?.timeframe || ''),
    patternType: String(candidate?.pattern_type || 'unknown'),
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    entryReady: !!candidate?.entry_ready,
    base: {
      low: toFinite(candidate?.base?.low),
      high: toFinite(candidate?.base?.high),
      startIndex: toFinite(candidate?.base?.startIndex),
      endIndex: toFinite(candidate?.base?.endIndex),
    },
    checklistPassed: rules.length ? passed : undefined,
    checklistTotal: rules.length || undefined,
    chartStats,
  };
}

function buildPrompt(snapshot: CandidateSnapshot): string {
  return [
    'You are an expert market-structure labeler.',
    'Return ONLY JSON.',
    '',
    'Task: classify this candidate as yes/no/close and suggest corrected base top/bottom if needed.',
    '',
    'Rules:',
    '- label must be one of: yes, no, close',
    '- label_confidence in [0,1]',
    '- needs_correction boolean',
    '- if needs_correction=true, provide base_top and base_bottom with base_top > base_bottom',
    '- correction_confidence in [0,1]',
    '- reasoning: short, max 25 words',
    '',
    'Return schema exactly:',
    '{"label":"yes|no|close","label_confidence":0.0,"needs_correction":true,"base_top":0.0,"base_bottom":0.0,"correction_confidence":0.0,"reasoning":"..."}',
    '',
    `Candidate JSON:\n${JSON.stringify(snapshot)}`,
  ].join('\n');
}

function fallbackHeuristic(snapshot: CandidateSnapshot): AutoLabelModelPrediction {
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

function normalizePrediction(rawParsed: any, modelVersion: string, rawText: string, snapshot: CandidateSnapshot): AutoLabelModelPrediction {
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

async function predictWithOpenAI(prompt: string): Promise<{ parsed: any; raw: string; modelVersion: string }> {
  const openaiApiKey = getConfiguredOpenAIKey();
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_AUTO_LABEL_MODEL,
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON generator.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const json = await response.json() as any;
  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${JSON.stringify(json)}`);
  }
  const raw = String(json?.choices?.[0]?.message?.content || '').trim();
  return {
    parsed: extractJsonObject(raw),
    raw,
    modelVersion: `openai:${OPENAI_AUTO_LABEL_MODEL}`,
  };
}

async function predictWithOllama(prompt: string): Promise<{ parsed: any; raw: string; modelVersion: string }> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
      },
    }),
  });
  const json = await response.json() as any;
  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${JSON.stringify(json)}`);
  }
  const raw = String(json?.response || '').trim();
  return {
    parsed: extractJsonObject(raw),
    raw,
    modelVersion: `ollama:${OLLAMA_MODEL}`,
  };
}

const PY_SERVICE_URL = process.env.PLUGIN_SERVICE_URL || 'http://127.0.0.1:8100';

async function predictWithMLModel(candidate: any): Promise<AutoLabelModelPrediction | null> {
  try {
    const response = await fetch(`${PY_SERVICE_URL}/ml/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate }),
    });
    if (!response.ok) return null;
    const json = await response.json() as any;
    if (!json?.success || !json?.data) return null;
    const d = json.data;
    return {
      label: normalizeLabel(d.label),
      labelConfidence: clamp01(Number(d.labelConfidence)),
      needsCorrection: !!d.needsCorrection,
      baseTop: toFinite(d.baseTop),
      baseBottom: toFinite(d.baseBottom),
      correctionConfidence: clamp01(Number(d.correctionConfidence)),
      reasoning: String(d.reasoning || '').slice(0, 220),
      modelVersion: String(d.modelVersion || 'ml_unknown'),
    };
  } catch {
    return null;
  }
}

export async function predictAutoLabel(candidate: any): Promise<AutoLabelModelPrediction> {
  // Priority 1: Try trained ML model (fast, free, domain-specific)
  const mlResult = await predictWithMLModel(candidate);
  if (mlResult) return mlResult;

  // Priority 2: Fall back to LLM providers
  const snapshot = buildCandidateSnapshot(candidate);
  const prompt = buildPrompt(snapshot);

  try {
    if (DEFAULT_PROVIDER === 'ollama') {
      const result = await predictWithOllama(prompt);
      return normalizePrediction(result.parsed, result.modelVersion, result.raw, snapshot);
    }
    const result = await predictWithOpenAI(prompt);
    return normalizePrediction(result.parsed, result.modelVersion, result.raw, snapshot);
  } catch (error: any) {
    const fallback = fallbackHeuristic(snapshot);
    return {
      ...fallback,
      reasoning: `Fallback used: ${String(error?.message || 'model unavailable')}`.slice(0, 220),
    };
  }
}
