import { Router, Request, Response } from 'express';
import { getConsumerCycleMonitor, getConsumerCycleSummary, getConsumerCycleSymbols } from '../services/consumerCycleService';
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

function parseBoolean(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function optionalQuery<T extends string>(value: unknown): T | '' {
  return String(value || '').trim() as T | '';
}

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
