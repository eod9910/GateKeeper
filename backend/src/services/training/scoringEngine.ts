import {
  ForwardResolution,
  RuleEvaluation,
  ScoreSnapshot,
  ScoreWeights,
  TrainingAttempt,
  TrainingSessionStats,
} from '../../types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeProcessScore(evaluations: RuleEvaluation[]): number {
  if (!evaluations.length) return 100;
  const weightedTotal = evaluations.reduce((sum, evaluation) => {
    if (evaluation.severity === 'info') return sum + 0.5;
    if (evaluation.severity === 'warning') return sum + 1;
    return sum + 2;
  }, 0);
  const weightedPass = evaluations.reduce((sum, evaluation) => {
    const weight = evaluation.severity === 'info' ? 0.5 : evaluation.severity === 'warning' ? 1 : 2;
    return sum + (evaluation.passed ? weight : 0);
  }, 0);
  return round((weightedPass / weightedTotal) * 100);
}

export function computeOutcomeScore(resolution?: ForwardResolution): number {
  if (!resolution) return 0;
  const normalized = clamp((resolution.rMultiple + 1) / 3, 0, 1);
  return round(normalized * 100);
}

export function summarizeSessionStats(attempts: TrainingAttempt[], cooldownUntil?: string | null): TrainingSessionStats {
  const resolved = attempts.filter((attempt) => attempt.status === 'resolved' && attempt.resolution);
  const wins = resolved.filter((attempt) => (attempt.resolution?.rMultiple || 0) > 0).length;
  const losses = resolved.filter((attempt) => (attempt.resolution?.rMultiple || 0) <= 0).length;
  const totalR = resolved.reduce((sum, attempt) => sum + (attempt.resolution?.rMultiple || 0), 0);
  const totalProcess = attempts.reduce((sum, attempt) => sum + (attempt.scoreSnapshot?.processScore || computeProcessScore(attempt.ruleEvaluations)), 0);
  const attemptsCount = attempts.length;
  const resolvedCount = resolved.length;
  const winRate = resolvedCount ? (wins / resolvedCount) * 100 : 0;
  const avgR = resolvedCount ? totalR / resolvedCount : 0;
  const expectancy = resolvedCount ? totalR / resolvedCount : 0;
  const processAdherence = attemptsCount ? totalProcess / attemptsCount : 0;
  const recent = attempts.slice(-5);
  const recentProcess = recent.length
    ? recent.reduce((sum, attempt) => sum + (attempt.scoreSnapshot?.processScore || computeProcessScore(attempt.ruleEvaluations)), 0) / recent.length
    : 0;

  return {
    attempts: attemptsCount,
    resolvedAttempts: resolvedCount,
    wins,
    losses,
    winRate: round(winRate),
    avgR: round(avgR),
    expectancy: round(expectancy),
    processAdherence: round(processAdherence),
    disciplineTrend: round(recentProcess),
    cooldownActive: !!cooldownUntil && Date.parse(cooldownUntil) > Date.now(),
    cooldownUntil: cooldownUntil || null,
  };
}

export function buildScoreSnapshot(
  evaluations: RuleEvaluation[],
  resolution: ForwardResolution | undefined,
  sessionStats: TrainingSessionStats,
  weights: ScoreWeights,
): ScoreSnapshot {
  const processScore = computeProcessScore(evaluations);
  const outcomeScore = computeOutcomeScore(resolution);
  const normalizedProcessWeight = weights.process + weights.outcome > 0
    ? weights.process / (weights.process + weights.outcome)
    : 0.7;
  const normalizedOutcomeWeight = 1 - normalizedProcessWeight;

  return {
    processScore,
    outcomeScore,
    compositeScore: round(processScore * normalizedProcessWeight + outcomeScore * normalizedOutcomeWeight),
    disciplineScoreRolling: round(sessionStats.disciplineTrend),
    expectancyRolling: round(sessionStats.expectancy),
    winRateRolling: round(sessionStats.winRate),
  };
}
