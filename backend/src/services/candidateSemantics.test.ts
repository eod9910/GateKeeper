import assert from 'assert';
import { applyCandidateSemantics, deriveCandidateSemantics } from './candidateSemantics';

function testContextIndicatorSemantics(): void {
  const result = deriveCandidateSemantics(
    { pattern_type: 'rdp_swing_structure', entry_ready: false },
    { artifactType: 'indicator', indicatorRole: 'context', entryType: 'analysis_only' },
  );

  assert.equal(result.candidate_role, 'context_indicator');
  assert.equal(result.candidate_actionability, 'context_only');
  assert.equal(result.candidate_role_label, 'Context');
  assert.equal(result.candidate_actionability_label, 'Context Only');
}

function testPatternDetectorSemantics(): void {
  const result = deriveCandidateSemantics(
    { pattern_type: 'density_base_detector_v2_pattern', entry_ready: true },
    { artifactType: 'pattern', indicatorRole: 'context', patternRole: 'phase_structure_pattern', entryType: 'analysis_only' },
  );

  assert.equal(result.candidate_role, 'pattern_detector');
  assert.equal(result.candidate_actionability, 'context_only');
  assert.equal(result.candidate_semantic_summary, 'Pattern context only');
}

function testEntrySignalSemantics(): void {
  const result = deriveCandidateSemantics(
    { pattern_type: 'base_breakout_entry_composite', entry_ready: true },
    { artifactType: 'indicator', indicatorRole: 'entry_composite', entryType: 'market_on_close' },
  );

  assert.equal(result.candidate_role, 'entry_signal');
  assert.equal(result.candidate_actionability, 'entry_ready');
  assert.equal(result.candidate_semantic_summary, 'Actionable entry');
}

function testFallbackPatternSemantics(): void {
  const candidate = applyCandidateSemantics({
    candidate_id: 'x',
    strategy_version_id: 'y',
    symbol: 'AAPL',
    timeframe: 'W',
    score: 0.8,
    entry_ready: false,
    rule_checklist: [],
    anchors: {},
    window_start: 1,
    window_end: 2,
    created_at: '2026-01-01T00:00:00Z',
    pattern_type: 'wyckoff_accumulation_rdp',
    base: {},
  } as any);

  assert.equal(candidate.candidate_role, 'pattern_detector');
  assert.equal(candidate.candidate_actionability, 'setup_watch');
}

function runTests(): void {
  testContextIndicatorSemantics();
  testPatternDetectorSemantics();
  testEntrySignalSemantics();
  testFallbackPatternSemantics();
}

runTests();
console.log('candidateSemantics tests passed');
