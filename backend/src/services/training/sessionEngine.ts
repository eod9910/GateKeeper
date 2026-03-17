import { randomUUID } from 'crypto';
import {
  StrategyContract,
  TrainingAttempt,
  TrainingSession,
  TrainingStatsAggregate,
} from '../../types';
import {
  getSession,
  listAttempts,
  listAttemptsBySession,
  listSessions,
  logTrainingEvent,
  saveSession,
  writeStatsCache,
} from './storage';
import { summarizeSessionStats } from './scoringEngine';

export async function startTrainingSession(contract: StrategyContract, userId = 'local-user'): Promise<TrainingSession> {
  const session: TrainingSession = {
    sessionId: randomUUID(),
    userId,
    startedAt: new Date().toISOString(),
    contractId: contract.id,
    contractVersion: contract.version,
    attemptIds: [],
    stats: summarizeSessionStats([]),
    cooldownUntil: null,
  };
  await saveSession(session);
  await logTrainingEvent({
    type: 'session_started',
    sessionId: session.sessionId,
    contractId: contract.id,
    payload: { userId, contractVersion: contract.version },
  });
  return session;
}

export async function endTrainingSession(sessionId: string): Promise<TrainingSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const attempts = await listAttemptsBySession(sessionId);
  const updated: TrainingSession = {
    ...session,
    endedAt: new Date().toISOString(),
    stats: summarizeSessionStats(attempts, session.cooldownUntil),
  };
  await saveSession(updated);
  await logTrainingEvent({
    type: 'session_ended',
    sessionId,
    contractId: session.contractId,
    payload: { attempts: attempts.length },
  });
  return updated;
}

export async function refreshSession(sessionId: string): Promise<TrainingSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const attempts = await listAttemptsBySession(sessionId);
  const updated: TrainingSession = {
    ...session,
    stats: summarizeSessionStats(attempts, session.cooldownUntil),
  };
  await saveSession(updated);
  return updated;
}

export async function attachAttemptToSession(session: TrainingSession, attempt: TrainingAttempt, contract: StrategyContract): Promise<TrainingSession> {
  const nextAttemptIds = session.attemptIds.includes(attempt.attemptId)
    ? session.attemptIds
    : [...session.attemptIds, attempt.attemptId];

  const recentAttempts = [...await listAttemptsBySession(session.sessionId), attempt]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const violationLookback = Math.max(1, contract.cooldownPolicy.lookbackAttempts || 1);
  const violationThreshold = Math.max(1, contract.cooldownPolicy.triggerViolationCount || 999);
  const recentWindow = recentAttempts.slice(-violationLookback);
  const recentViolationCount = recentWindow.filter((candidate) =>
    candidate.ruleEvaluations.some((evaluation) => !evaluation.passed && evaluation.severity === 'block'),
  ).length;

  let cooldownUntil = session.cooldownUntil || null;
  if (contract.cooldownPolicy.enabled !== false && recentViolationCount >= violationThreshold) {
    cooldownUntil = new Date(Date.now() + Math.max(1, contract.cooldownPolicy.cooldownMinutes || 1) * 60_000).toISOString();
    await logTrainingEvent({
      type: 'cooldown_triggered',
      sessionId: session.sessionId,
      attemptId: attempt.attemptId,
      contractId: contract.id,
      payload: {
        recentViolationCount,
        cooldownUntil,
      },
    });
  }

  const updated: TrainingSession = {
    ...session,
    attemptIds: nextAttemptIds,
    cooldownUntil,
    stats: summarizeSessionStats(recentAttempts, cooldownUntil),
  };
  await saveSession(updated);
  return updated;
}

export async function buildTrainingStats(contractId?: string): Promise<TrainingStatsAggregate> {
  const attempts = (await listAttempts()).filter((attempt) => !contractId || attempt.contractId === contractId);
  const sessions = (await listSessions()).filter((session) => !contractId || session.contractId === contractId);
  const summary = summarizeSessionStats(attempts);
  const compositeScoreAvg = attempts.length
    ? attempts.reduce((sum, attempt) => sum + (attempt.scoreSnapshot?.compositeScore || 0), 0) / attempts.length
    : 0;

  const aggregate: TrainingStatsAggregate = {
    contractId,
    attempts: summary.attempts,
    resolvedAttempts: summary.resolvedAttempts,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    avgR: summary.avgR,
    expectancy: summary.expectancy,
    processAdherence: summary.processAdherence,
    compositeScoreAvg: Math.round(compositeScoreAvg * 100) / 100,
    sessions: sessions.length,
  };

  await writeStatsCache(contractId || 'all', aggregate);
  return aggregate;
}
