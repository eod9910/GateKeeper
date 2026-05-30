import { Router, Request, Response } from 'express';
import {
  getAllCalibrationAdjustments,
  getCalibrationErrorsByScope,
  getPredictionCount,
  getCalibrationErrorCount,
  getCalibrationAdjustmentCount,
  getCalibrationTimestamps,
  getPredictionsForSymbol,
  computeCalibrationSummary,
} from '../services/dcfCalibrationDb';

const router = Router();

router.get('/summary', (_req: Request, res: Response) => {
  try {
    const adjustments = getAllCalibrationAdjustments();
    const summary = computeCalibrationSummary(10);
    const counts = {
      predictions: getPredictionCount(),
      calibration_errors: getCalibrationErrorCount(),
      calibration_adjustments: getCalibrationAdjustmentCount(),
    };
    const timestamps = getCalibrationTimestamps();
    res.json({ success: true, data: { counts, timestamps, adjustments, bias_summary: summary } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/errors/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol || '').toUpperCase().trim();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'symbol parameter is required' });
      return;
    }
    const predictions = getPredictionsForSymbol(symbol, 50);
    res.json({ success: true, data: { symbol, predictions } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/adjustments', (_req: Request, res: Response) => {
  try {
    const adjustments = getAllCalibrationAdjustments();
    res.json({ success: true, data: { adjustments } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/errors-by-scope', (req: Request, res: Response) => {
  try {
    const scopeType = (req.query.scope_type as string || '').trim();
    const scopeValue = (req.query.scope_value as string || '').trim();
    if (!scopeType || !scopeValue) {
      res.status(400).json({ success: false, error: 'scope_type and scope_value query params are required' });
      return;
    }
    if (scopeType !== 'sector' && scopeType !== 'industry' && scopeType !== 'market_cap_band') {
      res.status(400).json({ success: false, error: 'scope_type must be sector, industry, or market_cap_band' });
      return;
    }
    const errors = getCalibrationErrorsByScope(scopeType, scopeValue);
    res.json({ success: true, data: { scope_type: scopeType, scope_value: scopeValue, errors } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
