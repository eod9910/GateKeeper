import {
  TrainingAttempt,
  TrainingBacktestConfidenceSummary,
  TrainingBacktestBreakdownItem,
  TrainingBacktestReport,
  TrainingBacktestReportMode,
  TrainingSession,
} from '../../types';

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function buildBreakdown(values: string[], limit = 10): TrainingBacktestBreakdownItem[] {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const key = String(value || 'UNKNOWN').trim() || 'UNKNOWN';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const total = values.length || 1;
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      count,
      pct: round(count / total, 4),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function confidenceSummary(filledTrades: number): TrainingBacktestConfidenceSummary {
  if (filledTrades >= 200) {
    return {
      label: 'HIGH',
      resolved_trades: filledTrades,
      message: 'Statistically meaningful sample size.',
    };
  }
  if (filledTrades >= 50) {
    return {
      label: 'MEDIUM',
      resolved_trades: filledTrades,
      message: `Emerging edge sample (${filledTrades}/200 filled trades).`,
    };
  }
  return {
    label: 'LOW',
    resolved_trades: filledTrades,
    message: filledTrades > 0
      ? `Too few filled trades to trust yet (${filledTrades}/50 minimum).`
      : 'No filled trades yet.',
  };
}

function buildStreaks(rValues: number[]): {
  longestLosingStreak: number;
  longestWinningStreak: number;
  avgLosingStreak: number;
} {
  let longestLosingStreak = 0;
  let longestWinningStreak = 0;
  const losingRuns: number[] = [];
  let currentLosses = 0;
  let currentWins = 0;

  rValues.forEach((value) => {
    if (value < 0) {
      currentLosses += 1;
      longestLosingStreak = Math.max(longestLosingStreak, currentLosses);
      if (currentWins > 0) {
        longestWinningStreak = Math.max(longestWinningStreak, currentWins);
        currentWins = 0;
      }
      return;
    }
    if (currentLosses > 0) {
      losingRuns.push(currentLosses);
      currentLosses = 0;
    }
    if (value > 0) {
      currentWins += 1;
      longestWinningStreak = Math.max(longestWinningStreak, currentWins);
    } else {
      currentWins = 0;
    }
  });

  if (currentLosses > 0) {
    losingRuns.push(currentLosses);
  }
  if (currentWins > 0) {
    longestWinningStreak = Math.max(longestWinningStreak, currentWins);
  }

  return {
    longestLosingStreak,
    longestWinningStreak,
    avgLosingStreak: round(average(losingRuns), 2),
  };
}

function buildDrawdownStats(attempts: TrainingAttempt[]): {
  maxDrawdownR: number;
  maxDrawdownPct: number;
  timeUnderWaterTrades: number;
  expectedRecoveryTrades: number;
} {
  let peakR = 0;
  let peakPct = 0;
  let equityR = 0;
  let equityPct = 0;
  let maxDrawdownR = 0;
  let maxDrawdownPct = 0;
  let drawdownStartIndex: number | null = null;
  let maxTimeUnderWater = 0;
  const recoveryWindows: number[] = [];

  attempts.forEach((attempt, index) => {
    const resolution = attempt.resolution;
    if (!resolution || !resolution.entryHit || resolution.exitReason === 'no_fill') return;

    equityR += Number(resolution.rMultiple) || 0;
    equityPct += Number(resolution.pnlPct) || 0;

    const drawdownR = peakR - equityR;
    const drawdownPct = peakPct - equityPct;
    maxDrawdownR = Math.max(maxDrawdownR, drawdownR);
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);

    const underwater = drawdownR > 0 || drawdownPct > 0;
    if (underwater && drawdownStartIndex == null) {
      drawdownStartIndex = index;
    }
    if (!underwater && drawdownStartIndex != null) {
      const recoveryLength = index - drawdownStartIndex;
      recoveryWindows.push(recoveryLength);
      maxTimeUnderWater = Math.max(maxTimeUnderWater, recoveryLength);
      drawdownStartIndex = null;
    }

    if (equityR >= peakR) {
      peakR = equityR;
    }
    if (equityPct >= peakPct) {
      peakPct = equityPct;
    }
  });

  if (drawdownStartIndex != null) {
    maxTimeUnderWater = Math.max(maxTimeUnderWater, attempts.length - drawdownStartIndex);
  }

  return {
    maxDrawdownR: round(maxDrawdownR, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    timeUnderWaterTrades: maxTimeUnderWater,
    expectedRecoveryTrades: round(average(recoveryWindows), 2),
  };
}

export function buildTrainingBacktestReport(params: {
  attempts: TrainingAttempt[];
  sessions?: TrainingSession[];
  contractId?: string;
  sessionId?: string;
}): TrainingBacktestReport {
  const attempts = [...(params.attempts || [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const sessions = params.sessions || [];
  const mode: TrainingBacktestReportMode = params.sessionId
    ? 'session'
    : params.contractId
      ? 'contract'
      : 'all';

  const qualifiedAttempts = attempts.filter((attempt) => attempt.status !== 'blocked');
  const resolvedAttempts = attempts.filter((attempt) => attempt.status === 'resolved' && attempt.resolution);
  const filledTrades = resolvedAttempts.filter((attempt) => attempt.resolution?.entryHit && attempt.resolution?.exitReason !== 'no_fill');
  const noFillTrades = resolvedAttempts.filter((attempt) => attempt.resolution?.exitReason === 'no_fill');

  const rValues = filledTrades.map((attempt) => Number(attempt.resolution?.rMultiple) || 0);
  const wins = rValues.filter((value) => value > 0);
  const losses = rValues.filter((value) => value < 0);
  const scratches = rValues.filter((value) => value === 0);
  const holdBars = filledTrades.map((attempt) => Number(attempt.resolution?.barsHeld) || 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLossAbs = losses.reduce((sum, value) => sum + Math.abs(value), 0);
  const avgWin = average(wins);
  const avgLoss = average(losses);
  const streaks = buildStreaks(rValues);
  const drawdown = buildDrawdownStats(filledTrades);

  const processScores = attempts
    .map((attempt) => Number(attempt.scoreSnapshot?.processScore))
    .filter((value) => Number.isFinite(value));
  const compositeScores = attempts
    .map((attempt) => Number(attempt.scoreSnapshot?.compositeScore))
    .filter((value) => Number.isFinite(value));
  const riskPcts = qualifiedAttempts
    .map((attempt) => Number(attempt.riskPct))
    .filter((value) => Number.isFinite(value));
  const rewardRisks = qualifiedAttempts
    .map((attempt) => Number(attempt.rewardRisk))
    .filter((value) => Number.isFinite(value));
  const recentProcess = attempts
    .slice(-5)
    .map((attempt) => Number(attempt.scoreSnapshot?.processScore))
    .filter((value) => Number.isFinite(value));

  return {
    scope: {
      mode,
      contractId: params.contractId,
      sessionId: params.sessionId,
      sessions: sessions.length,
      attempts: attempts.length,
      qualifiedAttempts: qualifiedAttempts.length,
      blockedAttempts: attempts.filter((attempt) => attempt.status === 'blocked').length,
      resolvedAttempts: resolvedAttempts.length,
      filledTrades: filledTrades.length,
      noFillTrades: noFillTrades.length,
      generatedAt: new Date().toISOString(),
    },
    trades_summary: {
      total_trades: filledTrades.length,
      winners: wins.length,
      losers: losses.length,
      scratches: scratches.length,
      no_fill_trades: noFillTrades.length,
      win_rate: round(filledTrades.length ? wins.length / filledTrades.length : 0, 4),
      avg_win_R: round(avgWin, 4),
      avg_loss_R: round(avgLoss, 4),
      expectancy_R: round(average(rValues), 4),
      payoff_ratio: round(avgLoss < 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? 999 : 0), 4),
      profit_factor: round(grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? 999 : 0), 4),
      largest_win_R: round(wins.length ? Math.max(...wins) : 0, 4),
      largest_loss_R: round(losses.length ? Math.min(...losses) : 0, 4),
      avg_hold_bars: round(average(holdBars), 2),
      median_hold_bars: round(median(holdBars), 2),
    },
    risk_summary: {
      max_drawdown_R: drawdown.maxDrawdownR,
      max_drawdown_pct: drawdown.maxDrawdownPct,
      longest_losing_streak: streaks.longestLosingStreak,
      avg_losing_streak: streaks.avgLosingStreak,
      longest_winning_streak: streaks.longestWinningStreak,
      time_under_water_trades: drawdown.timeUnderWaterTrades,
      expected_recovery_trades: drawdown.expectedRecoveryTrades,
    },
    discipline_summary: {
      process_adherence: round(average(processScores), 2),
      discipline_trend: round(average(recentProcess), 2),
      composite_score_avg: round(average(compositeScores), 2),
      contract_pass_rate: round(attempts.length ? qualifiedAttempts.length / attempts.length : 0, 4),
      blocked_attempt_rate: round(attempts.length ? (attempts.length - qualifiedAttempts.length) / attempts.length : 0, 4),
      avg_risk_pct: round(average(riskPcts), 2),
      avg_reward_risk: round(average(rewardRisks), 2),
    },
    breakdowns: {
      exit_reasons: buildBreakdown(resolvedAttempts.map((attempt) => attempt.resolution?.exitReason || 'unknown')),
      by_symbol: buildBreakdown(attempts.map((attempt) => attempt.symbol)),
      by_timeframe: buildBreakdown(attempts.map((attempt) => attempt.timeframe)),
      by_side: buildBreakdown(attempts.map((attempt) => attempt.side)),
    },
    confidence: confidenceSummary(filledTrades.length),
  };
}
