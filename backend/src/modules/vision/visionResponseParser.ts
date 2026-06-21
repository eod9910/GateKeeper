import type {
  MLScores,
  PatternReview,
  PhaseAnalysis,
  PhaseLevels,
  VisionAnalysis,
} from './visionTypes';

export function parseVisionResponse(rawResponse: string): Omit<VisionAnalysis, 'rawResponse' | 'provider'> {
  const normalized = String(rawResponse || '')
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');

  const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parseLine = (label: string): string | undefined => {
    const match = normalized.match(new RegExp(`^\\s*(?:[-*]\\s*)?${escapeRegex(label)}:\\s*(.+)$`, 'im'));
    if (!match) return undefined;
    const value = match[1].trim();
    if (!value || value === '-' || /^N\/A$/i.test(value) || /^NONE$/i.test(value)) return undefined;
    return value;
  };
  const parseNumberLine = (label: string): number | undefined => {
    const value = parseLine(label);
    if (!value) return undefined;
    const num = Number(value.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(num) ? num : undefined;
  };
  const parseBooleanLine = (label: string): boolean | undefined => {
    const value = parseLine(label);
    if (!value) return undefined;
    if (/^YES$/i.test(value)) return true;
    if (/^NO$/i.test(value)) return false;
    return undefined;
  };
  const parseListBlock = (prefix: string): string[] => {
    const values: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const value = parseLine(`${prefix}_${i}`);
      if (value) values.push(value);
    }
    return values;
  };
  const clampScore = (value: number | undefined, fallback = 0.5): number => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, Number(value)));
  };
  const normalizeAgreement = (value?: string): PatternReview['detectorAgreement'] => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'AGREE' || upper === 'YES') return 'AGREE';
    if (upper === 'PARTIAL') return 'PARTIAL';
    if (upper === 'DISAGREE' || upper === 'NO') return 'DISAGREE';
    return 'UNKNOWN';
  };
  const normalizeVerdict = (value?: string): PatternReview['detectorVerdict'] => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'CONFIRM') return 'CONFIRM';
    if (upper === 'REJECT') return 'REJECT';
    if (upper === 'RELABEL') return 'RELABEL';
    return 'UNCLEAR';
  };
  const normalizeState = (value?: string): PatternReview['stateAssessment'] => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'FORMING' || upper === 'TRIGGER' || upper === 'EXPANDING' || upper === 'FAILED') return upper;
    return 'UNCLEAR';
  };

  const confidence = parseNumberLine('CONFIDENCE') ?? 50;
  const isValidPattern = parseBooleanLine('CURRENT_SETUP_VALID')
    ?? parseBooleanLine('VALID_PATTERN')
    ?? parseBooleanLine('VALID')
    ?? false;
  const explanation = parseLine('EXPLANATION') || normalized;

  const peakPriceMatch = normalized.match(/PEAK_PRICE:\s*([\d.]+)/i);
  const markdownLowMatch = normalized.match(/MARKDOWN_LOW_PRICE:\s*([\d.]+)/i);
  const valid70MarkdownMatch = normalized.match(/VALID_70_PLUS_MARKDOWN:\s*(YES|NO)/i);
  const accumulationVisibleMatch = normalized.match(/ACCUMULATION_VISIBLE:\s*(YES|NO|UNCLEAR)/i);
  const accumulationLowMatch = normalized.match(/ACCUMULATION_LOW:\s*([\d.]+)/i);
  const accumulationHighMatch = normalized.match(/ACCUMULATION_HIGH:\s*([\d.]+)/i);
  const markupVisibleMatch = normalized.match(/MARKUP_VISIBLE:\s*(YES|NO|UNCLEAR)/i);
  const markupHighMatch = normalized.match(/MARKUP_HIGH:\s*([\d.]+)/i);
  const pullbackVisibleMatch = normalized.match(/PULLBACK_VISIBLE:\s*(YES|NO|UNCLEAR)/i);
  const pullbackLowMatch = normalized.match(/PULLBACK_LOW:\s*([\d.]+)/i);
  const breakoutVisibleMatch = normalized.match(/SECOND_BREAKOUT_VISIBLE:\s*(YES|NO|UNCLEAR)/i);

  const phases: PhaseAnalysis = {
    peak: peakPriceMatch ? 'VISIBLE' : 'NOT_VISIBLE',
    markdown: valid70MarkdownMatch && valid70MarkdownMatch[1].toUpperCase() === 'YES'
      ? 'VISIBLE'
      : markdownLowMatch
        ? 'VISIBLE'
        : 'NOT_VISIBLE',
    base: accumulationVisibleMatch ? accumulationVisibleMatch[1].toUpperCase() : 'UNKNOWN',
    markup: markupVisibleMatch ? markupVisibleMatch[1].toUpperCase() : 'UNKNOWN',
    pullback: pullbackVisibleMatch ? pullbackVisibleMatch[1].toUpperCase() : 'UNKNOWN',
    breakout: breakoutVisibleMatch ? breakoutVisibleMatch[1].toUpperCase() : 'UNKNOWN',
  };

  const levels: PhaseLevels = {
    peakPrice: parseNumberLine('PEAK_PRICE'),
    markdownLow: parseNumberLine('MARKDOWN_LOW_PRICE'),
    baseHigh: parseNumberLine('KEY_RESISTANCE') ?? (accumulationHighMatch ? parseFloat(accumulationHighMatch[1]) : undefined),
    baseLow: parseNumberLine('KEY_SUPPORT') ?? (accumulationLowMatch ? parseFloat(accumulationLowMatch[1]) : undefined),
    markupHigh: markupHighMatch ? parseFloat(markupHighMatch[1]) : undefined,
    pullbackLow: pullbackLowMatch ? parseFloat(pullbackLowMatch[1]) : undefined,
    suggestedEntry: parseNumberLine('TRIGGER_LEVEL') ?? parseNumberLine('SUGGESTED_ENTRY'),
    suggestedStop: parseNumberLine('INVALIDATION_LEVEL') ?? parseNumberLine('SUGGESTED_STOP'),
    suggestedTarget: parseNumberLine('TARGET_LEVEL') ?? parseNumberLine('SUGGESTED_TARGET'),
  };

  const review: PatternReview = {
    primaryPattern: parseLine('PRIMARY_PATTERN') || (isValidPattern ? 'base_accumulation' : 'unclear'),
    alternativePattern: parseLine('ALTERNATIVE_PATTERN'),
    detectorAgreement: normalizeAgreement(parseLine('DETECTOR_AGREEMENT')),
    detectorVerdict: normalizeVerdict(parseLine('DETECTOR_VERDICT')),
    stateAssessment: normalizeState(parseLine('STATE_ASSESSMENT')),
    timingAssessment: parseLine('TIMING_ASSESSMENT') || (parseBooleanLine('IS_TOO_LATE') ? 'TOO_LATE' : 'IN_PLAY'),
    isTooLate: parseBooleanLine('IS_TOO_LATE') ?? false,
    topReasons: parseListBlock('TOP_REASON'),
    topRisks: parseListBlock('TOP_RISK'),
  };

  const mlScores: MLScores = {
    patternLikeness: clampScore(parseNumberLine('PATTERN_LIKENESS')),
    structuralClarity: clampScore(parseNumberLine('STRUCTURAL_CLARITY')),
    phaseCompleteness: clampScore(parseNumberLine('PHASE_COMPLETENESS')),
    failureRisk: clampScore(parseNumberLine('FAILURE_RISK')),
    entryQuality: clampScore(parseNumberLine('ENTRY_QUALITY')),
    detectorAgreement: clampScore(parseNumberLine('DETECTOR_AGREEMENT_SCORE') ?? parseNumberLine('PATTERN_LIKENESS')),
    structureQuality: clampScore(parseNumberLine('STRUCTURE_QUALITY') ?? parseNumberLine('STRUCTURAL_CLARITY')),
    patternClarity: clampScore(parseNumberLine('PATTERN_CLARITY') ?? parseNumberLine('PHASE_COMPLETENESS')),
    timingQuality: clampScore(parseNumberLine('TIMING_QUALITY') ?? parseNumberLine('ENTRY_QUALITY')),
  };

  return { confidence, isValidPattern, explanation, review, phases, levels, mlScores };
}
