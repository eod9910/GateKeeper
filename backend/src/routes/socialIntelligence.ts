import { Router, Request, Response } from 'express';
import {
  getSocialIntelligenceScheduleStatus,
  loadSocialIntelligenceScheduleConfig,
  runSocialIntelligenceCollectionNow,
  runSocialIntelligenceFinalizeNow,
  saveSocialIntelligenceScheduleConfig,
} from '../services/socialIntelligenceScheduler';

const router = Router();

router.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: getSocialIntelligenceScheduleStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  try {
    const current = loadSocialIntelligenceScheduleConfig();
    const config = saveSocialIntelligenceScheduleConfig({
      ...current,
      ...(req.body || {}),
    });
    res.json({
      success: true,
      data: {
        ...getSocialIntelligenceScheduleStatus(),
        config,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run-collect', (_req: Request, res: Response) => {
  try {
    const result = runSocialIntelligenceCollectionNow('manual');
    res.json({
      success: true,
      data: {
        ...result,
        ...getSocialIntelligenceScheduleStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run-finalize', (_req: Request, res: Response) => {
  try {
    const result = runSocialIntelligenceFinalizeNow('manual');
    res.json({
      success: true,
      data: {
        ...result,
        ...getSocialIntelligenceScheduleStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
