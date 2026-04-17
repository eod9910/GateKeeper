import { Router, Request, Response } from 'express';
import { getConsumerCycleMonitor, getConsumerCycleSummary, getConsumerCycleSymbols } from '../services/consumerCycleService';

const router = Router();

function parseBoolean(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

router.get('/summary', (req: Request, res: Response) => {
  try {
    const data = getConsumerCycleSummary({
      q: String(req.query.q || ''),
      cycleBucket: String(req.query.cycleBucket || ''),
      spendClass: String(req.query.spendClass || ''),
      category: String(req.query.category || ''),
      bucket: String(req.query.bucket || ''),
      sensitivity: String(req.query.sensitivity || ''),
      profile: String(req.query.profile || ''),
      preference: String(req.query.preference || ''),
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
      cycleBucket: String(req.query.cycleBucket || ''),
      spendClass: String(req.query.spendClass || ''),
      category: String(req.query.category || ''),
      bucket: String(req.query.bucket || ''),
      sensitivity: String(req.query.sensitivity || ''),
      profile: String(req.query.profile || ''),
      preference: String(req.query.preference || ''),
      optionableOnly: parseBoolean(req.query.optionableOnly),
      limit: Number(req.query.limit) || undefined,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load consumer-cycle symbols' });
  }
});

export default router;
