import {
  TradeInstance,
  ValidationReport,
  ValidatorComparisonDiagnostics,
  ValidatorExitReasonDelta,
  ValidatorRDistributionDelta,
  ValidatorSharedSymbolChange,
  ValidatorSymbolImpact,
  ValidatorTradeBucketStats,
} from '../types';

const EXIT_REASONS: Array<TradeInstance['exit_reason']> = ['target', 'stop', 'trailing', 'time', 'end_of_data'];
const R_BUCKETS = [
  { id: 'full_loss', label: '<= -0.95R', test: (value: number) => value <= -0.95 },
  { id: 'partial_loss', label: '-0.95R to -0.05R', test: (value: number) => value > -0.95 && value < -0.05 },
  { id: 'scratch', label: '-0.05R to +0.05R', test: (value: number) => value >= -0.05 && value <= 0.05 },
  { id: 'small_win', label: '+0.05R to +1.00R', test: (value: number) => value > 0.05 && value < 1.0 },
  { id: 'large_win', label: '>= +1.00R', test: (value: number) => value >= 1.0 },
];

function safeNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function holdBars(trade: TradeInstance): number {
  const entry = safeNumber(trade.entry_bar_index);
  const exit = safeNumber(trade.exit_bar_index);
  if (entry == null || exit == null) return 0;
  return Math.max(0, exit - entry);
}

function buildTradeBucketStats(trades: TradeInstance[]): ValidatorTradeBucketStats {
  const rValues = trades.map((trade) => safeNumber(trade.R_multiple) ?? 0);
  const wins = trades.filter((trade) => (safeNumber(trade.R_multiple) ?? 0) > 0);
  const losses = trades.filter((trade) => (safeNumber(trade.R_multiple) ?? 0) <= 0);
  const holdValues = trades.map(holdBars);
  const grossProfit = wins.reduce((sum, trade) => sum + Math.max(0, safeNumber(trade.R_multiple) ?? 0), 0);
  const grossLossAbs = losses.reduce((sum, trade) => sum + Math.abs(Math.min(0, safeNumber(trade.R_multiple) ?? 0)), 0);

  return {
    trade_count: trades.length,
    winners: wins.length,
    losers: losses.length,
    win_rate: trades.length ? wins.length / trades.length : 0,
    expectancy_R: average(rValues),
    profit_factor: grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? 999 : 0),
    avg_win_R: average(wins.map((trade) => safeNumber(trade.R_multiple) ?? 0)),
    avg_loss_R: average(losses.map((trade) => safeNumber(trade.R_multiple) ?? 0)),
    total_R: rValues.reduce((sum, value) => sum + value, 0),
    avg_hold_bars: average(holdValues),
    median_hold_bars: median(holdValues),
    median_R: median(rValues),
  };
}

function buildExitReasonBreakdown(current: TradeInstance[], previous: TradeInstance[]): ValidatorExitReasonDelta[] {
  return EXIT_REASONS.map((reason) => {
    const currentCount = current.filter((trade) => trade.exit_reason === reason).length;
    const previousCount = previous.filter((trade) => trade.exit_reason === reason).length;
    return {
      reason,
      current_count: currentCount,
      previous_count: previousCount,
      delta_count: currentCount - previousCount,
      current_pct: current.length ? currentCount / current.length : 0,
      previous_pct: previous.length ? previousCount / previous.length : 0,
    };
  }).sort((a, b) => Math.abs(b.delta_count) - Math.abs(a.delta_count));
}

function bucketLabel(value: number): string {
  const bucket = R_BUCKETS.find((item) => item.test(value));
  return bucket ? bucket.label : 'unclassified';
}

function buildRDistribution(current: TradeInstance[], previous: TradeInstance[]): ValidatorRDistributionDelta[] {
  return R_BUCKETS.map((bucket) => {
    const currentCount = current.filter((trade) => bucket.test(safeNumber(trade.R_multiple) ?? 0)).length;
    const previousCount = previous.filter((trade) => bucket.test(safeNumber(trade.R_multiple) ?? 0)).length;
    return {
      bucket: bucket.label,
      current_count: currentCount,
      previous_count: previousCount,
      delta_count: currentCount - previousCount,
      current_pct: current.length ? currentCount / current.length : 0,
      previous_pct: previous.length ? previousCount / previous.length : 0,
    };
  }).sort((a, b) => Math.abs(b.delta_count) - Math.abs(a.delta_count));
}

function buildSymbolImpactList(trades: TradeInstance[]): ValidatorSymbolImpact[] {
  const grouped = new Map<string, TradeInstance[]>();
  trades.forEach((trade) => {
    const symbol = String(trade.symbol || '').trim().toUpperCase() || 'UNKNOWN';
    const existing = grouped.get(symbol) || [];
    existing.push(trade);
    grouped.set(symbol, existing);
  });

  return Array.from(grouped.entries()).map(([symbol, items]) => {
    const stats = buildTradeBucketStats(items);
    return {
      symbol,
      trade_count: stats.trade_count,
      total_R: stats.total_R,
      expectancy_R: stats.expectancy_R,
      win_rate: stats.win_rate,
      avg_win_R: stats.avg_win_R,
      avg_loss_R: stats.avg_loss_R,
      avg_hold_bars: stats.avg_hold_bars,
    };
  });
}

function buildSharedSymbolChanges(
  currentTrades: TradeInstance[],
  previousTrades: TradeInstance[],
  sharedUniverse: Set<string>,
): ValidatorSharedSymbolChange[] {
  const currentImpacts = new Map(buildSymbolImpactList(currentTrades.filter((trade) => sharedUniverse.has(String(trade.symbol || '').trim().toUpperCase()))).map((item) => [item.symbol, item]));
  const previousImpacts = new Map(buildSymbolImpactList(previousTrades.filter((trade) => sharedUniverse.has(String(trade.symbol || '').trim().toUpperCase()))).map((item) => [item.symbol, item]));
  const allSymbols = new Set<string>([...currentImpacts.keys(), ...previousImpacts.keys()]);

  return Array.from(allSymbols).map((symbol) => {
    const current = currentImpacts.get(symbol);
    const previous = previousImpacts.get(symbol);
    return {
      symbol,
      current_trade_count: current?.trade_count || 0,
      previous_trade_count: previous?.trade_count || 0,
      current_total_R: current?.total_R || 0,
      previous_total_R: previous?.total_R || 0,
      delta_total_R: (current?.total_R || 0) - (previous?.total_R || 0),
      current_expectancy_R: current?.expectancy_R || 0,
      previous_expectancy_R: previous?.expectancy_R || 0,
      delta_expectancy_R: (current?.expectancy_R || 0) - (previous?.expectancy_R || 0),
    };
  }).sort((a, b) => a.delta_total_R - b.delta_total_R);
}

function takeTop<T>(items: T[], count = 8): T[] {
  return items.slice(0, count);
}

function buildKeyTakeaways(diagnostics: Omit<ValidatorComparisonDiagnostics, 'key_takeaways'>): string[] {
  const takeaways: string[] = [];
  const currentAdded = diagnostics.cohort_stats.current_added_symbol_trades;
  const currentShared = diagnostics.cohort_stats.current_shared_symbol_trades;
  const previousShared = diagnostics.cohort_stats.previous_shared_symbol_trades;

  if (diagnostics.universe_summary.shared_universe_size === 0) {
    takeaways.push('There is no shared universe overlap between these two runs, so the expectancy change is not a same-symbol cohort comparison.');
  } else if (currentAdded.trade_count > 0) {
    takeaways.push(
      `Added-universe trades contributed ${currentAdded.trade_count} trades at ${currentAdded.expectancy_R.toFixed(2)}R expectancy versus ${currentShared.expectancy_R.toFixed(2)}R for current shared-universe trades.`,
    );
  }

  if (diagnostics.universe_summary.shared_universe_size > 0 && previousShared.trade_count > 0) {
    takeaways.push(
      `Shared-universe expectancy moved from ${previousShared.expectancy_R.toFixed(2)}R to ${currentShared.expectancy_R.toFixed(2)}R, which shows whether the original cohort itself degraded.`,
    );
  }

  const biggestExitShift = diagnostics.exit_reason_breakdown[0];
  if (biggestExitShift && Math.abs(biggestExitShift.delta_count) > 0) {
    takeaways.push(
      `Largest exit mix shift: ${biggestExitShift.reason} changed by ${biggestExitShift.delta_count} trades (${(biggestExitShift.previous_pct * 100).toFixed(1)}% -> ${(biggestExitShift.current_pct * 100).toFixed(1)}%).`,
    );
  }

  const biggestBucketShift = diagnostics.r_distribution_breakdown[0];
  if (biggestBucketShift && Math.abs(biggestBucketShift.delta_count) > 0) {
    takeaways.push(
      `Largest R-distribution shift: ${biggestBucketShift.bucket} changed by ${biggestBucketShift.delta_count} trades.`,
    );
  }

  const worstAdded = diagnostics.top_added_symbols[0];
  if (worstAdded) {
    takeaways.push(
      `Worst added-symbol drag in the current run: ${worstAdded.symbol} with ${worstAdded.trade_count} trades and ${worstAdded.total_R.toFixed(2)} total R.`,
    );
  }

  return takeaways;
}

export function buildValidatorComparisonDiagnostics(
  currentReport: ValidationReport,
  previousReport: ValidationReport,
  currentTrades: TradeInstance[],
  previousTrades: TradeInstance[],
): ValidatorComparisonDiagnostics {
  const currentUniverse = new Set((currentReport?.config?.universe || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean));
  const previousUniverse = new Set((previousReport?.config?.universe || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean));
  const sharedUniverse = new Set<string>([...currentUniverse].filter((symbol) => previousUniverse.has(symbol)));
  const addedUniverse = new Set<string>([...currentUniverse].filter((symbol) => !previousUniverse.has(symbol)));
  const removedUniverse = new Set<string>([...previousUniverse].filter((symbol) => !currentUniverse.has(symbol)));

  const currentSharedTrades = currentTrades.filter((trade) => sharedUniverse.has(String(trade.symbol || '').trim().toUpperCase()));
  const previousSharedTrades = previousTrades.filter((trade) => sharedUniverse.has(String(trade.symbol || '').trim().toUpperCase()));
  const currentAddedTrades = currentTrades.filter((trade) => addedUniverse.has(String(trade.symbol || '').trim().toUpperCase()));
  const previousRemovedTrades = previousTrades.filter((trade) => removedUniverse.has(String(trade.symbol || '').trim().toUpperCase()));

  const diagnosticsBase = {
    current_report_id: currentReport.report_id,
    previous_report_id: previousReport.report_id,
    strategy_version_id: currentReport.strategy_version_id,
    universe_summary: {
      current_universe_size: currentUniverse.size,
      previous_universe_size: previousUniverse.size,
      shared_universe_size: sharedUniverse.size,
      added_universe_size: addedUniverse.size,
      removed_universe_size: removedUniverse.size,
    },
    cohort_stats: {
      current_all: buildTradeBucketStats(currentTrades),
      previous_all: buildTradeBucketStats(previousTrades),
      current_shared_symbol_trades: buildTradeBucketStats(currentSharedTrades),
      previous_shared_symbol_trades: buildTradeBucketStats(previousSharedTrades),
      current_added_symbol_trades: buildTradeBucketStats(currentAddedTrades),
      previous_removed_symbol_trades: buildTradeBucketStats(previousRemovedTrades),
    },
    exit_reason_breakdown: buildExitReasonBreakdown(currentTrades, previousTrades),
    r_distribution_breakdown: buildRDistribution(currentTrades, previousTrades),
    top_added_symbols: takeTop(
      buildSymbolImpactList(currentAddedTrades).sort((a, b) => {
        if (a.total_R !== b.total_R) return a.total_R - b.total_R;
        return b.trade_count - a.trade_count;
      }),
    ),
    top_negative_symbols_current: takeTop(
      buildSymbolImpactList(currentTrades).sort((a, b) => {
        if (a.total_R !== b.total_R) return a.total_R - b.total_R;
        return b.trade_count - a.trade_count;
      }),
    ),
    shared_symbol_changes: takeTop(buildSharedSymbolChanges(currentTrades, previousTrades, sharedUniverse), 10),
  };

  return {
    ...diagnosticsBase,
    key_takeaways: buildKeyTakeaways(diagnosticsBase),
  };
}

export function summarizeComparisonDiagnosticsForPrompt(diagnostics: ValidatorComparisonDiagnostics | null | undefined): string {
  if (!diagnostics) return '';
  const lines = [
    `- Current report: ${diagnostics.current_report_id}`,
    `- Previous report: ${diagnostics.previous_report_id}`,
    `- Universe sizes: current ${diagnostics.universe_summary.current_universe_size}, previous ${diagnostics.universe_summary.previous_universe_size}, shared ${diagnostics.universe_summary.shared_universe_size}, added ${diagnostics.universe_summary.added_universe_size}`,
    `- Current added-symbol trades: ${diagnostics.cohort_stats.current_added_symbol_trades.trade_count} trades at ${diagnostics.cohort_stats.current_added_symbol_trades.expectancy_R.toFixed(2)}R`,
  ];
  if (diagnostics.universe_summary.shared_universe_size > 0) {
    lines.push(`- Current shared-symbol trades: ${diagnostics.cohort_stats.current_shared_symbol_trades.trade_count} trades at ${diagnostics.cohort_stats.current_shared_symbol_trades.expectancy_R.toFixed(2)}R`);
    lines.push(`- Previous shared-symbol trades: ${diagnostics.cohort_stats.previous_shared_symbol_trades.trade_count} trades at ${diagnostics.cohort_stats.previous_shared_symbol_trades.expectancy_R.toFixed(2)}R`);
  } else {
    lines.push('- Shared-symbol cohort comparison: unavailable because the two validation universes do not overlap');
  }
  diagnostics.key_takeaways.slice(0, 4).forEach((item) => lines.push(`- ${item}`));
  diagnostics.top_added_symbols.slice(0, 3).forEach((item) => {
    lines.push(`- Added symbol ${item.symbol}: trades ${item.trade_count}, expectancy ${item.expectancy_R.toFixed(2)}R, total_R ${item.total_R.toFixed(2)}`);
  });
  diagnostics.shared_symbol_changes.slice(0, 3).forEach((item) => {
    lines.push(`- Shared symbol change ${item.symbol}: delta_total_R ${item.delta_total_R.toFixed(2)}, delta_expectancy_R ${item.delta_expectancy_R.toFixed(2)}`);
  });
  return lines.join('\n');
}

export function classifyRBucket(value: number): string {
  return bucketLabel(value);
}
