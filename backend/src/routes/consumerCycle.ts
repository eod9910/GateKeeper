import { Router, Request, Response } from 'express';
import { getConsumerCycleMonitor, getConsumerCycleSummary, getConsumerCycleSymbols } from '../services/consumerCycleService';
import { getConsumerCycleAnalysis } from '../services/consumerCycleAnalysis';
import type {
  ConsumerCycleBucket,
  ConsumerCycleSensitivity,
  ConsumerDemandBucket,
  ConsumerSpendClass,
  ConsumerSpendingCategory,
  MacroRegimePreference,
  RecessionProfile,
} from '../services/symbolCatalog';

const router = Router();

type StatusCounts = Record<string, number>;

function parseBoolean(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function optionalQuery<T extends string>(value: unknown): T | '' {
  return String(value || '').trim() as T | '';
}

function countStatuses(rows: Array<{ status?: string }>): StatusCounts {
  return rows.reduce((counts: StatusCounts, row) => {
    const key = String(row.status || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function compactSeries(rows: Array<Record<string, any>>) {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    status: row.status,
    yoyPct: row.yoyPct,
    qoqAnnualizedPct: row.qoqAnnualizedPct,
    twoQuarterPct: row.twoQuarterPct,
    latestDate: row.latestDate,
  }));
}

function compactStatisticalDeviation(statisticalDeviation: any) {
  if (!statisticalDeviation) return null;
  const leadership = statisticalDeviation.leadershipStretch || null;
  return {
    asOf: statisticalDeviation.asOf || null,
    status: statisticalDeviation.status || null,
    regime: statisticalDeviation.regime || null,
    summary: statisticalDeviation.summary || null,
    sp500LogZ: statisticalDeviation.regression?.zScore ?? null,
    sp500PercentAboveTrend: statisticalDeviation.regression?.percentAboveTrend ?? null,
    linearCrashStretchZ: statisticalDeviation.linearCrashStretch?.zScore ?? null,
    sectorGeometryStatus: statisticalDeviation.sectorGeometry?.status ?? null,
    sectorAverageCorrelationPercentile: statisticalDeviation.sectorGeometry?.averageCorrelationPercentile ?? null,
    sectorWedgeVolumePercentile: statisticalDeviation.sectorGeometry?.wedgeVolumePercentile ?? null,
    marketStretchExtremeCount: statisticalDeviation.marketStretch?.extremeCount ?? null,
    leadership: leadership
      ? {
          asOf: leadership.asOf || null,
          status: leadership.status || null,
          rawExtremeCount: leadership.rawExtremeCount ?? null,
          logExtremeCount: leadership.logExtremeCount ?? null,
          combinedExtremeCount: leadership.combinedExtremeCount ?? null,
          overvaluedExtremeCount: leadership.overvaluedExtremeCount ?? null,
          rollingOverCount: leadership.rollingOverCount ?? null,
          topRows: Array.isArray(leadership.topRows) ? leadership.topRows.slice(0, 10) : [],
        }
      : null,
  };
}

router.get('/brief', async (req: Request, res: Response) => {
  try {
    const [monitor, summary] = await Promise.all([
      getConsumerCycleMonitor(parseBoolean(req.query.refresh)),
      Promise.resolve(getConsumerCycleSummary()),
    ]);
    const consumerRows = monitor.cyclicalConsumerSeries || [];
    const companionRows = monitor.companionSeries || [];
    const producerRows = monitor.industrialProducerSeries || [];
    const weakeningConsumer = consumerRows.filter((row) => row.severity >= 2);
    const weakeningCompanions = companionRows.filter((row) => row.severity >= 2);
    const stressedProducers = producerRows.filter((row) => row.severity >= 2);
    const statisticalDeviation = compactStatisticalDeviation(monitor.statisticalDeviation);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        asOf: monitor.asOf,
        source: monitor.source,
        overallStatus: monitor.overallStatus,
        averageSeverity: monitor.averageSeverity,
        scoreHint: monitor.scoreHint,
        weakeningPrimaryCount: monitor.weakeningPrimaryCount,
        weakeningTotalCount: monitor.weakeningTotalCount,
        statusCounts: {
          consumer: countStatuses(consumerRows),
          companion: countStatuses(companionRows),
          producer: countStatuses(producerRows),
        },
        summaryCounts: {
          totalTradableStocks: summary.totalTradableStocks,
          filteredCount: summary.filteredCount,
          optionableCount: summary.optionableCount,
          preferInSlowdownCount: summary.preferInSlowdownCount,
          avoidInSlowdownCount: summary.avoidInSlowdownCount,
          highlyCyclicalCount: summary.highlyCyclicalCount,
          defensiveCount: summary.defensiveCount,
          byCycleBucket: summary.byCycleBucket,
          byPreference: summary.byPreference,
        },
        keySignals: {
          weakeningConsumer: compactSeries(weakeningConsumer),
          weakeningCompanions: compactSeries(weakeningCompanions),
          stressedProducers: compactSeries(stressedProducers),
          strongestSeries: monitor.strongestSeries,
          weakestSeries: monitor.weakestSeries,
        },
        statisticalDeviation,
        aiRead: {
          marketSetup:
            statisticalDeviation?.status === 'red'
              ? 'Market statistical deviation is red; treat the tape as fragile until leadership breadth confirms otherwise.'
              : 'Market statistical deviation is not red; consumer-cycle risk still needs confirmation from leadership/sector behavior.',
          leadershipRollover:
            (statisticalDeviation?.leadership?.rollingOverCount || 0) > 0
              ? 'Extreme leadership basket has started rolling over.'
              : 'Extreme leadership basket has not rolled over yet.',
          consumerCycle:
            monitor.overallStatus === 'red'
              ? 'Consumer cycle is broadly deteriorating.'
              : monitor.overallStatus === 'orange'
                ? 'Consumer cycle is rolling over but not fully broken.'
                : monitor.overallStatus === 'yellow'
                  ? 'Consumer cycle is softening.'
                  : 'Consumer cycle is healthy.',
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle brief' });
  }
});

router.get('/summary', (req: Request, res: Response) => {
  try {
    const data = getConsumerCycleSummary({
      q: String(req.query.q || ''),
      cycleBucket: optionalQuery<ConsumerCycleBucket>(req.query.cycleBucket),
      spendClass: optionalQuery<ConsumerSpendClass>(req.query.spendClass),
      category: optionalQuery<ConsumerSpendingCategory>(req.query.category),
      bucket: optionalQuery<ConsumerDemandBucket>(req.query.bucket),
      sensitivity: optionalQuery<ConsumerCycleSensitivity>(req.query.sensitivity),
      profile: optionalQuery<RecessionProfile>(req.query.profile),
      preference: optionalQuery<MacroRegimePreference>(req.query.preference),
      optionableOnly: parseBoolean(req.query.optionableOnly),
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle summary' });
  }
});

router.get('/monitor', async (req: Request, res: Response) => {
  try {
    const data = await getConsumerCycleMonitor(parseBoolean(req.query.refresh));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle monitor' });
  }
});

router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const data = await getConsumerCycleAnalysis(parseBoolean(req.query.refresh));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle analysis' });
  }
});

router.get('/symbols', (req: Request, res: Response) => {
  try {
    const data = getConsumerCycleSymbols({
      q: String(req.query.q || ''),
      cycleBucket: optionalQuery<ConsumerCycleBucket>(req.query.cycleBucket),
      spendClass: optionalQuery<ConsumerSpendClass>(req.query.spendClass),
      category: optionalQuery<ConsumerSpendingCategory>(req.query.category),
      bucket: optionalQuery<ConsumerDemandBucket>(req.query.bucket),
      sensitivity: optionalQuery<ConsumerCycleSensitivity>(req.query.sensitivity),
      profile: optionalQuery<RecessionProfile>(req.query.profile),
      preference: optionalQuery<MacroRegimePreference>(req.query.preference),
      optionableOnly: parseBoolean(req.query.optionableOnly),
      limit: Number(req.query.limit) || undefined,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle symbols' });
  }
});

export default router;
