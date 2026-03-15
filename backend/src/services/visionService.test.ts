import assert from 'assert';
import { parseResponse } from './visionService';

function testParsesAdjudicatorResponse(): void {
  const raw = `
### PATTERN REVIEW
- **PRIMARY_PATTERN:** pullback_base
- **ALTERNATIVE_PATTERN:** range_reclaim
- **DETECTOR_AGREEMENT:** PARTIAL
- **DETECTOR_VERDICT:** RELABEL
- **STATE_ASSESSMENT:** FORMING
- **TIMING_ASSESSMENT:** IN_PLAY
- **IS_TOO_LATE:** NO
- **CURRENT_SETUP_VALID:** YES

### KEY LEVELS
- **KEY_RESISTANCE:** 6.22
- **KEY_SUPPORT:** 2.82
- **TRIGGER_LEVEL:** 6.25
- **INVALIDATION_LEVEL:** 2.74
- **TARGET_LEVEL:** 9.40

### OVERALL ASSESSMENT
- **CONFIDENCE:** 84
- **VALID_PATTERN:** YES

### ML SCORING
- **DETECTOR_AGREEMENT_SCORE:** 0.72
- **STRUCTURE_QUALITY:** 0.81
- **PATTERN_CLARITY:** 0.76
- **TIMING_QUALITY:** 0.79
- **FAILURE_RISK:** 0.28

### KEY REASONS
- **TOP_REASON_1:** active base is still forming
- **TOP_REASON_2:** trigger is close to current price
- **TOP_REASON_3:** chart is orderly and readable

### KEY RISKS
- **TOP_RISK_1:** resistance overhead is obvious
- **TOP_RISK_2:** squeeze fuel is only moderate
- **TOP_RISK_3:** catalyst timing is weak

EXPLANATION: The detector is directionally right about a base, but the visible structure is closer to a pullback base than a full Wyckoff accumulation.
`;

  const parsed = parseResponse(raw);

  assert.equal(parsed.confidence, 84);
  assert.equal(parsed.isValidPattern, true);
  assert.equal(parsed.review?.primaryPattern, 'pullback_base');
  assert.equal(parsed.review?.alternativePattern, 'range_reclaim');
  assert.equal(parsed.review?.detectorAgreement, 'PARTIAL');
  assert.equal(parsed.review?.detectorVerdict, 'RELABEL');
  assert.equal(parsed.review?.stateAssessment, 'FORMING');
  assert.equal(parsed.review?.timingAssessment, 'IN_PLAY');
  assert.equal(parsed.review?.isTooLate, false);
  assert.deepEqual(parsed.review?.topReasons, [
    'active base is still forming',
    'trigger is close to current price',
    'chart is orderly and readable'
  ]);
  assert.deepEqual(parsed.review?.topRisks, [
    'resistance overhead is obvious',
    'squeeze fuel is only moderate',
    'catalyst timing is weak'
  ]);
  assert.equal(parsed.levels?.baseHigh, 6.22);
  assert.equal(parsed.levels?.baseLow, 2.82);
  assert.equal(parsed.levels?.suggestedEntry, 6.25);
  assert.equal(parsed.levels?.suggestedStop, 2.74);
  assert.equal(parsed.levels?.suggestedTarget, 9.4);
  assert.equal(parsed.mlScores?.detectorAgreement, 0.72);
  assert.equal(parsed.mlScores?.structureQuality, 0.81);
  assert.equal(parsed.mlScores?.patternClarity, 0.76);
  assert.equal(parsed.mlScores?.timingQuality, 0.79);
  assert.equal(parsed.mlScores?.failureRisk, 0.28);
  assert.ok(parsed.explanation.includes('pullback base'));
}

function testParsesLegacyMarkdownFormattedVisionResponse(): void {
  const raw = `
I'm unable to analyze the chart directly, but I can guide you through the process based on the image you provided.

### OVERALL ASSESSMENT
- **CONFIDENCE:** 80
- **VALID_PATTERN:** YES
- **SUGGESTED_ENTRY:** 7.00
- **SUGGESTED_STOP:** 2.50
- **SUGGESTED_TARGET:** 18.60

### STEP 2: PEAK
- **PEAK_PRICE:** 18.60

### STEP 4: MARKDOWN
- **MARKDOWN_LOW_PRICE:** 2.58
- **VALID_70_PLUS_MARKDOWN:** YES

### STEP 5: ACCUMULATION ZONE
- **ACCUMULATION_VISIBLE:** YES
- **ACCUMULATION_LOW:** 2.58
- **ACCUMULATION_HIGH:** 10.25

### STEP 6: MARKUP
- **MARKUP_VISIBLE:** YES
- **MARKUP_HIGH:** 14.00

### STEP 7: PULLBACK
- **PULLBACK_VISIBLE:** YES
- **PULLBACK_LOW:** 6.46

### STEP 8: SECOND BREAKOUT
- **SECOND_BREAKOUT_VISIBLE:** UNCLEAR

### ML SCORING
- **PATTERN_LIKENESS:** 0.85
- **STRUCTURAL_CLARITY:** 0.80
- **PHASE_COMPLETENESS:** 0.75
- **FAILURE_RISK:** 0.20
- **ENTRY_QUALITY:** 0.70

EXPLANATION: The chart shows a clear Wyckoff accumulation structure with a deep markdown and a valid pullback.
`;

  const parsed = parseResponse(raw);

  assert.equal(parsed.confidence, 80);
  assert.equal(parsed.isValidPattern, true);
  assert.equal(parsed.review?.primaryPattern, 'base_accumulation');
  assert.equal(parsed.phases?.peak, 'VISIBLE');
  assert.equal(parsed.phases?.markdown, 'VISIBLE');
  assert.equal(parsed.phases?.base, 'YES');
  assert.equal(parsed.phases?.markup, 'YES');
  assert.equal(parsed.phases?.pullback, 'YES');
  assert.equal(parsed.phases?.breakout, 'UNCLEAR');
  assert.equal(parsed.levels?.peakPrice, 18.6);
  assert.equal(parsed.levels?.markdownLow, 2.58);
  assert.equal(parsed.levels?.baseLow, 2.58);
  assert.equal(parsed.levels?.baseHigh, 10.25);
  assert.equal(parsed.levels?.markupHigh, 14);
  assert.equal(parsed.levels?.pullbackLow, 6.46);
  assert.equal(parsed.levels?.suggestedEntry, 7);
  assert.equal(parsed.levels?.suggestedStop, 2.5);
  assert.equal(parsed.levels?.suggestedTarget, 18.6);
  assert.equal(parsed.mlScores?.patternLikeness, 0.85);
  assert.equal(parsed.mlScores?.structuralClarity, 0.8);
  assert.equal(parsed.mlScores?.phaseCompleteness, 0.75);
  assert.equal(parsed.mlScores?.failureRisk, 0.2);
  assert.equal(parsed.mlScores?.entryQuality, 0.7);
}

function testFallsBackCleanlyWhenStructuredFieldsAreMissing(): void {
  const raw = 'Plain response with no structured fields.';
  const parsed = parseResponse(raw);

  assert.equal(parsed.confidence, 50);
  assert.equal(parsed.isValidPattern, false);
  assert.equal(parsed.review?.primaryPattern, 'unclear');
  assert.equal(parsed.review?.detectorAgreement, 'UNKNOWN');
  assert.equal(parsed.review?.stateAssessment, 'UNCLEAR');
  assert.equal(parsed.mlScores?.detectorAgreement, 0.5);
  assert.equal(parsed.mlScores?.structureQuality, 0.5);
  assert.equal(parsed.mlScores?.patternClarity, 0.5);
  assert.equal(parsed.mlScores?.timingQuality, 0.5);
  assert.equal(parsed.mlScores?.failureRisk, 0.5);
  assert.equal(parsed.explanation, raw);
}

function runTests(): void {
  testParsesAdjudicatorResponse();
  testParsesLegacyMarkdownFormattedVisionResponse();
  testFallsBackCleanlyWhenStructuredFieldsAreMissing();
}

runTests();
console.log('visionService tests passed');
