export interface PhaseAnalysis {
  peak: string;
  markdown: string;
  base: string;
  markup: string;
  pullback: string;
  breakout: string;
}

export interface PhaseLevels {
  peakPrice?: number;
  markdownLow?: number;
  baseHigh?: number;
  baseLow?: number;
  markupHigh?: number;
  pullbackLow?: number;
  suggestedEntry?: number;
  suggestedStop?: number;
  suggestedTarget?: number;
}

export interface MLScores {
  patternLikeness: number;
  structuralClarity: number;
  phaseCompleteness: number;
  failureRisk: number;
  entryQuality: number;
  detectorAgreement?: number;
  structureQuality?: number;
  patternClarity?: number;
  timingQuality?: number;
}

export interface PatternReview {
  primaryPattern: string;
  alternativePattern?: string;
  detectorAgreement: 'AGREE' | 'PARTIAL' | 'DISAGREE' | 'UNKNOWN';
  detectorVerdict: 'CONFIRM' | 'REJECT' | 'RELABEL' | 'UNCLEAR';
  stateAssessment: 'FORMING' | 'TRIGGER' | 'EXPANDING' | 'FAILED' | 'UNCLEAR';
  timingAssessment: string;
  isTooLate: boolean;
  topReasons: string[];
  topRisks: string[];
}

export interface VisionAnalysis {
  confidence: number;
  isValidPattern: boolean;
  explanation: string;
  review?: PatternReview;
  phases?: PhaseAnalysis;
  levels?: PhaseLevels;
  mlScores?: MLScores;
  rawResponse: string;
  provider: string;
}
