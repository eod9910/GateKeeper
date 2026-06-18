/**
 * Consumer Cycle — Framed-Question Analysis Engine
 *
 * Raw data is inert. The unit of value here is (data + a built-in question) -> AI analysis.
 * Each "lens" ships with its own embedded question, and the AI's job is to aggregate the
 * raw series and answer THAT specific question, so a viewer doesn't need to know why the
 * numbers matter — the analysis tells them.
 *
 *   - Consumer lens:           is consumer spending tipping us toward recession?
 *   - Reindustrialization lens: is production/freight accelerating into a durable inflection,
 *                               and is the cycle's leading driver rotating consumption -> production?
 *   - Regime synthesis:        which regime is dominant right now?
 *
 * The model never gets to pick the question — the question is the product.
 */

import { getConsumerCycleMonitor } from './consumerCycleService';
import { getConfiguredOpenAIKey } from './aiSettings';

type MonitorPayload = Awaited<ReturnType<typeof getConsumerCycleMonitor>>;
type MonitorSeries = MonitorPayload['cyclicalConsumerSeries'][number];

export const CONSUMER_QUESTION =
  'Based on this data, is consumer spending declining in a way that signals the economy is tipping into a recession?';
export const REINDUSTRIALIZATION_QUESTION =
  "Is the production/freight side of the economy accelerating into a durable industrial inflection (reindustrialization), and is the cycle's leading driver rotating from consumption toward production?";
export const SYNTHESIS_QUESTION =
  'Taking both lenses together, which regime is dominant right now — a consumer-led slowdown or a production-led acceleration — and what does that imply for positioning?';

export type LensVerdict = {
  question: string;
  verdict: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  key_evidence: string[];
  what_would_change_view: string;
};

export type ConsumerCycleAnalysis = {
  generatedAt: string;
  model: string | null;
  asOf: string | null;
  source: string;
  overallStatus: MonitorPayload['overallStatus'];
  consumerLens: LensVerdict;
  reindustrializationLens: LensVerdict;
  regimeSynthesis: { dominant_regime: string; headline: string; detail: string };
  dataPacket: string;
};

const MODEL = 'gpt-4o-mini';
const ANALYSIS_CACHE_TTL_MS = 30 * 60 * 1000;
let analysisCache: { expiresAt: number; payload: ConsumerCycleAnalysis } | null = null;

function fmtPct(value: number | null): string {
  if (value == null) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatSeriesLine(series: MonitorSeries): string {
  return `  - ${series.label} [${series.status.toUpperCase()}] — YoY ${fmtPct(series.yoyPct)}, recent-momentum(ann.) ${fmtPct(series.qoqAnnualizedPct)}, 2-period ${fmtPct(series.twoQuarterPct)}${series.latestDate ? ` (as of ${series.latestDate})` : ''}`;
}

function buildDataPacket(monitor: MonitorPayload): string {
  const consumer = monitor.cyclicalConsumerSeries.map(formatSeriesLine).join('\n') || '  (none)';
  const companion = monitor.companionSeries.map(formatSeriesLine).join('\n') || '  (none)';
  const producer = monitor.industrialProducerSeries.map(formatSeriesLine).join('\n') || '  (none)';
  return [
    `AS OF: ${monitor.asOf || 'n/a'}  |  SOURCE: ${monitor.source}`,
    `OVERALL CONSUMER-DEMAND STATUS: ${monitor.overallStatus.toUpperCase()} (avg severity ${monitor.averageSeverity}, ${monitor.weakeningPrimaryCount} primary series weakening of ${monitor.weakeningTotalCount} flagged)`,
    '',
    '═══ CYCLICAL CONSUMER DEMAND (the recession question) ═══',
    consumer,
    '',
    '═══ COMPANION / RATES CONTEXT ═══',
    companion,
    '',
    '═══ PRODUCER / INDUSTRIAL / FREIGHT (the reindustrialization question) ═══',
    producer,
  ].join('\n');
}

function buildPrompt(dataPacket: string): string {
  return `You are a macro analyst. You are given a packet of hard economic data (FRED quantity series + a market-implied transports relative-strength proxy). Your job is to answer THREE pre-set questions — you do not choose the questions. Cite specific numbers from the packet. Be decisive but honest about uncertainty. No generic disclaimers.

Note on status colors: GREEN = healthy/expanding, YELLOW = mixed, ORANGE = softening, RED = contracting. The OVERALL status reflects CONSUMER demand only; producer/freight series are a separate cross-check and are NOT folded into it.

DATA PACKET:
${dataPacket}

Answer these exact questions:

Q1 (CONSUMER LENS): ${CONSUMER_QUESTION}
Q2 (REINDUSTRIALIZATION LENS): ${REINDUSTRIALIZATION_QUESTION}
Q3 (REGIME SYNTHESIS): ${SYNTHESIS_QUESTION}

Respond with STRICT JSON only, matching this schema:
{
  "consumer": { "verdict": "<one-line answer, e.g. 'No — consumer demand is holding'>", "confidence": "low|medium|high", "rationale": "<2-4 sentences citing numbers>", "key_evidence": ["<series + number>", "..."], "what_would_change_view": "<the single datapoint that would flip this>" },
  "reindustrialization": { "verdict": "<one-line answer>", "confidence": "low|medium|high", "rationale": "<2-4 sentences citing numbers>", "key_evidence": ["..."], "what_would_change_view": "<...>" },
  "synthesis": { "dominant_regime": "consumer_slowdown|production_acceleration|balanced|stall", "headline": "<one punchy line>", "detail": "<2-4 sentences tying both lenses together and the positioning implication>" }
}`;
}

function statusOf(series: MonitorSeries[], key: string): MonitorSeries | undefined {
  return series.find((s) => s.key === key);
}

// Keep raw provider errors out of user-facing text.
function shortReason(error: string): string {
  if (/HTTP 429|quota/i.test(error)) return 'AI narration unavailable — OpenAI quota exceeded';
  if (/HTTP 401|invalid|auth/i.test(error)) return 'AI narration unavailable — OpenAI auth failed';
  if (/network error/i.test(error)) return 'AI narration unavailable — network error reaching OpenAI';
  if (/non-JSON|empty model/i.test(error)) return 'AI narration unavailable — malformed model response';
  return 'AI narration unavailable';
}

function ruleBasedAnalysis(monitor: MonitorPayload, reason: string): ConsumerCycleAnalysis {
  const consumerRed = monitor.overallStatus === 'red';
  const consumerSoft = monitor.overallStatus === 'orange';
  const consumerVerdict = consumerRed
    ? 'Yes — consumer demand is contracting; recession risk is elevated'
    : consumerSoft
    ? 'Watch — consumer demand is softening but not yet contracting'
    : 'No — consumer demand is holding';

  const producer = monitor.industrialProducerSeries;
  const greenProducers = producer.filter((s) => s.status === 'green');
  const transports = statusOf(producer, 'transports_rel_strength');
  const indpro = statusOf(producer, 'industrial_production');
  const mfgConstruction = statusOf(producer, 'mfg_construction');
  const accelerating = greenProducers.length >= Math.ceil(producer.length / 2);
  const reindVerdict = producer.length === 0
    ? 'Unknown — producer data unavailable'
    : accelerating
    ? 'Yes — producer/freight signals are firming, consistent with reindustrialization'
    : 'Not yet — producer/freight signals are mixed-to-soft';

  let dominant: string;
  if (consumerRed && !accelerating) dominant = 'consumer_slowdown';
  else if (!consumerRed && accelerating) dominant = 'production_acceleration';
  else if (consumerSoft && accelerating) dominant = 'balanced';
  else dominant = 'balanced';

  const ev = (s?: MonitorSeries) => (s ? `${s.label}: ${s.status.toUpperCase()} (YoY ${fmtPct(s.yoyPct)})` : null);

  return {
    generatedAt: new Date().toISOString(),
    model: null,
    asOf: monitor.asOf,
    source: monitor.source,
    overallStatus: monitor.overallStatus,
    consumerLens: {
      question: CONSUMER_QUESTION,
      verdict: consumerVerdict,
      confidence: 'medium',
      rationale: `Overall consumer-demand status is ${monitor.overallStatus.toUpperCase()} with ${monitor.weakeningPrimaryCount} primary series weakening. ${reason}`,
      key_evidence: [
        ev(statusOf(monitor.cyclicalConsumerSeries, monitor.cyclicalConsumerSeries[0]?.key || '')),
        monitor.weakestSeries ? `Weakest: ${monitor.weakestSeries.label} (YoY ${fmtPct(monitor.weakestSeries.yoyPct)})` : null,
      ].filter((x): x is string => Boolean(x)),
      what_would_change_view: 'Two consecutive quarters of negative YoY in the highly-cyclical series would confirm a tip into recession.',
    },
    reindustrializationLens: {
      question: REINDUSTRIALIZATION_QUESTION,
      verdict: reindVerdict,
      confidence: producer.length === 0 ? 'low' : 'medium',
      rationale: `${greenProducers.length} of ${producer.length} producer/freight signals are expanding. ${reason}`,
      key_evidence: [ev(mfgConstruction), ev(indpro), ev(transports)].filter((x): x is string => Boolean(x)),
      what_would_change_view: 'Transports relative strength turning negative while manufacturing construction rolls over would kill the reindustrialization read.',
    },
    regimeSynthesis: {
      dominant_regime: dominant,
      headline:
        dominant === 'production_acceleration'
          ? 'Production-led acceleration is leading while the consumer holds.'
          : dominant === 'consumer_slowdown'
          ? 'Consumer-led slowdown dominates; producers are not offsetting it.'
          : 'Mixed regime — neither lens is decisively in control.',
      detail: `Consumer status ${monitor.overallStatus.toUpperCase()}; ${greenProducers.length}/${producer.length} producer signals expanding. Rule-based read (LLM unavailable: ${reason}).`,
    },
    dataPacket: buildDataPacket(monitor),
  };
}

type ModelResult = { ok: true; data: any } | { ok: false; error: string };

async function callModel(prompt: string, apiKey: string): Promise<ModelResult> {
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err: any) {
    return { ok: false, error: `network error: ${err?.message || err}` };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, error: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
  }
  const result = (await response.json()) as any;
  const content = result.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: 'empty model response' };
  try {
    return { ok: true, data: JSON.parse(content) };
  } catch {
    return { ok: false, error: 'model returned non-JSON content' };
  }
}

function coerceConfidence(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function coerceLens(raw: any, question: string): LensVerdict {
  return {
    question,
    verdict: typeof raw?.verdict === 'string' ? raw.verdict : 'Indeterminate',
    confidence: coerceConfidence(raw?.confidence),
    rationale: typeof raw?.rationale === 'string' ? raw.rationale : '',
    key_evidence: Array.isArray(raw?.key_evidence) ? raw.key_evidence.map((x: any) => String(x)).slice(0, 6) : [],
    what_would_change_view: typeof raw?.what_would_change_view === 'string' ? raw.what_would_change_view : '',
  };
}

export async function getConsumerCycleAnalysis(forceRefresh = false): Promise<ConsumerCycleAnalysis> {
  if (!forceRefresh && analysisCache && analysisCache.expiresAt > Date.now()) {
    return analysisCache.payload;
  }

  const monitor = await getConsumerCycleMonitor(forceRefresh);
  const dataPacket = buildDataPacket(monitor);

  const apiKey = getConfiguredOpenAIKey();
  let payload: ConsumerCycleAnalysis;

  if (!apiKey) {
    payload = ruleBasedAnalysis(monitor, 'no OpenAI key configured');
  } else {
    const result = await callModel(buildPrompt(dataPacket), apiKey);
    if (!result.ok) {
      payload = ruleBasedAnalysis(monitor, shortReason(result.error));
    } else {
      const parsed = result.data;
      payload = {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        asOf: monitor.asOf,
        source: monitor.source,
        overallStatus: monitor.overallStatus,
        consumerLens: coerceLens(parsed.consumer, CONSUMER_QUESTION),
        reindustrializationLens: coerceLens(parsed.reindustrialization, REINDUSTRIALIZATION_QUESTION),
        regimeSynthesis: {
          dominant_regime: typeof parsed.synthesis?.dominant_regime === 'string' ? parsed.synthesis.dominant_regime : 'balanced',
          headline: typeof parsed.synthesis?.headline === 'string' ? parsed.synthesis.headline : '',
          detail: typeof parsed.synthesis?.detail === 'string' ? parsed.synthesis.detail : '',
        },
        dataPacket,
      };
    }
  }

  analysisCache = { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, payload };
  return payload;
}
