import { Router, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  getLedgerHydrationScheduleStatus,
  loadLedgerHydrationScheduleConfig,
  runConsumerCycleClassificationNow,
  runLedgerHydrationNow,
  runValuationRefreshNow,
  runYahooIdentityRefreshNow,
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

router.post('/run-valuations', (_req: Request, res: Response) => {
  try {
    const result = runValuationRefreshNow('manual');
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

router.post('/run-yahoo-identity', (_req: Request, res: Response) => {
  try {
    const result = runYahooIdentityRefreshNow('manual');
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

router.post('/calibration/run', (req: Request, res: Response) => {
  try {
    const minAgeDays = Number(req.body?.min_age_days) || 90;
    const minSampleSize = Number(req.body?.min_sample_size) || 10;
    const pyLauncher = process.platform === 'win32' ? 'py' : (process.env.PYTHON || 'python3');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'run_dcf_calibration.py');

    const child = spawn(pyLauncher, [
      scriptPath,
      '--min-age-days', String(minAgeDays),
      '--min-sample-size', String(minSampleSize),
    ], {
      cwd: path.join(__dirname, '..', '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        try {
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const report = JSON.parse(lastLine);
          res.json({ success: true, data: report });
        } catch {
          res.json({ success: true, data: { raw_output: stdout.trim() } });
        }
      } else {
        res.status(500).json({ success: false, error: stderr || `Calibration exited with code ${code}` });
      }
    });

    child.on('error', (err: Error) => {
      res.status(500).json({ success: false, error: err.message });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
