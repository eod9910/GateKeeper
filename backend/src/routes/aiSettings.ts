import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import {
  getConfiguredOpenAIKey,
  getOpenAIKeySource,
  loadAISettings,
  maskKey,
  saveAISettings,
} from '../services/aiSettings';

const router = Router();

router.get('/settings', (_req: Request, res: Response) => {
  try {
    const saved = loadAISettings();
    const resolvedKey = getConfiguredOpenAIKey();
    const source = getOpenAIKeySource();

    res.json({
      success: true,
      data: {
        openai_api_key: source === 'saved' ? maskKey(saved?.openai_api_key || '') : maskKey(resolvedKey),
        source,
        configured: !!resolvedKey,
        role_prompts: saved?.role_prompts || {},
        role_models: saved?.role_models || {},
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  try {
    const existing = loadAISettings() || {};
    const hasOpenAIKeyField = Object.prototype.hasOwnProperty.call(req.body || {}, 'openai_api_key');
    const requestedOpenAIKey = hasOpenAIKeyField ? String(req.body?.openai_api_key || '').trim() : '';
    const openai_api_key = hasOpenAIKeyField
      ? (requestedOpenAIKey || existing.openai_api_key)
      : existing.openai_api_key;
    const role_prompts = req.body?.role_prompts && typeof req.body.role_prompts === 'object'
      ? req.body.role_prompts
      : existing.role_prompts;
    // Merge incoming model selections over any existing ones so a partial
    // update (e.g. just the Ledger dropdown) doesn't wipe the rest.
    const role_models = req.body?.role_models && typeof req.body.role_models === 'object'
      ? { ...(existing.role_models || {}), ...req.body.role_models }
      : existing.role_models;

    saveAISettings({ openai_api_key, role_prompts, role_models });

    const source = getOpenAIKeySource();
    const resolvedKey = getConfiguredOpenAIKey();

    res.json({
      success: true,
      data: {
        openai_api_key: source === 'saved' ? maskKey(openai_api_key || '') : maskKey(resolvedKey),
        source,
        configured: !!resolvedKey,
        role_prompts: loadAISettings()?.role_prompts || {},
        role_models: loadAISettings()?.role_models || {},
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings/test', async (_req: Request, res: Response) => {
  try {
    const apiKey = getConfiguredOpenAIKey();
    if (!apiKey) {
      return res.json({
        success: false,
        data: { connected: false, provider: 'openai' },
        error: 'OpenAI API key is not configured',
      });
    }

    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.json({
        success: false,
        data: { connected: false, provider: 'openai' },
        error: `OpenAI test failed: ${response.status} ${errorText}`.slice(0, 500),
      });
    }

    const json = await response.json() as { data?: Array<{ id?: string }> };
    res.json({
      success: true,
      data: {
        connected: true,
        provider: 'openai',
        source: getOpenAIKeySource(),
        sample_model: json?.data?.[0]?.id || null,
      },
    });
  } catch (err: any) {
    res.json({
      success: false,
      data: { connected: false, provider: 'openai' },
      error: err?.message || String(err),
    });
  }
});

export default router;
