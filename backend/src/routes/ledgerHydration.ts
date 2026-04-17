import { Router, Request, Response } from 'express';
import {
  getLedgerHydrationScheduleStatus,
  loadLedgerHydrationScheduleConfig,
  runConsumerCycleClassificationNow,
  runLedgerHydrationNow,
  saveLedgerHydrationScheduleConfig,
} from '../services/ledgerHydrationScheduler';

const router = Router();

router.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: getLedgerHydrationScheduleStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  try {
    const current = loadLedgerHydrationScheduleConfig();
    const config = saveLedgerHydrationScheduleConfig({
      ...current,
      ...(req.body || {}),
    });
    res.json({
      success: true,
      data: {
        ...getLedgerHydrationScheduleStatus(),
        config,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run', (_req: Request, res: Response) => {
  try {
    const result = runLedgerHydrationNow('manual');
    res.json({
      success: true,
      data: {
        ...result,
        ...getLedgerHydrationScheduleStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run-consumer-cycle-classification', (_req: Request, res: Response) => {
  try {
    const result = runConsumerCycleClassificationNow('manual');
    res.json({
      success: true,
      data: {
        ...result,
        ...getLedgerHydrationScheduleStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
