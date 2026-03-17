/**
 * Research Agent API Routes
 *
 * POST   /research/sessions                — start a new research session
 * GET    /research/sessions                — list all sessions
 * GET    /research/sessions/:id            — get session state + genome
 * POST   /research/sessions/:id/stop       — stop a running session
 * DELETE /research/sessions/:id            — permanently delete a session
 * POST   /research/sessions/:id/archive    — archive a session
 * POST   /research/sessions/:id/unarchive  — unarchive a session
 * POST   /research/sessions/:id/promote/:gen — manually promote a generation
 * POST   /research/sessions/:id/reflect/:gen — regenerate reflection for a generation
 * GET    /research/sessions/:id/stream     — SSE live event stream
 */

import { Router, Request, Response } from 'express';
import {
  createSession,
  continueSession,
  stopSession,
  deleteSession,
  archiveSession,
  unarchiveSession,
  getSession,
  listSessions,
  loadAllSessions,
  subscribeToSession,
  promoteManually,
  regenerateReflection,
  ResearchSessionConfig,
} from '../services/researchAgent';

const router = Router();

// Load persisted sessions on startup — track promise so routes can await it
let sessionsReadyPromise = loadAllSessions().catch(console.error);

// ─── POST /sessions ───────────────────────────────────────────────────────────

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const {
      name,
      max_generations,
      target_interval,
      target_asset_class,
      seed_hypothesis,
      promotion_min_fitness,
      promotion_requires_pass,
    } = body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const config: ResearchSessionConfig = {
      name: String(name).trim(),
      max_generations: Math.max(1, Math.min(Number(max_generations) || 5, 50)),
      target_interval: String(target_interval || '1wk'),
      target_asset_class: String(target_asset_class || 'stocks'),
      seed_hypothesis: seed_hypothesis ? String(seed_hypothesis).trim() : undefined,
      promotion_min_fitness: Number(promotion_min_fitness) || 0.6,
      promotion_requires_pass: promotion_requires_pass !== false,
      allow_new_primitives: body.allow_new_primitives === true,
      hypothesis_model: body.hypothesis_model ? String(body.hypothesis_model) : undefined,
      reflection_model: body.reflection_model ? String(body.reflection_model) : undefined,
      risk_defaults: body.risk_defaults || undefined,
    };

    const session = await createSession(config);
    res.status(201).json({ success: true, data: session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions ────────────────────────────────────────────────────────────

router.get('/sessions', async (_req: Request, res: Response) => {
  await sessionsReadyPromise;
  try {
    const sessions = listSessions().map(s => ({
      session_id: s.session_id,
      status: s.status,
      generation: s.generation,
      max_generations: s.max_generations,
      config: s.config,
      best: s.best,
      genome_count: s.genome.length,
      current_hypothesis: s.current_hypothesis,
      archived: s.archived || false,
      created_at: s.created_at,
      updated_at: s.updated_at,
      error: s.error,
    }));
    res.json({ success: true, data: sessions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions/:id ────────────────────────────────────────────────────────

router.get('/sessions/:id', async (req: Request, res: Response) => {
  await sessionsReadyPromise;
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, data: session });
});

// ─── POST /sessions/:id/stop ──────────────────────────────────────────────────

router.post('/sessions/:id/stop', async (req: Request, res: Response) => {
  const stopped = await stopSession(req.params.id);
  if (!stopped) {
    return res.status(400).json({ success: false, error: 'Session not found or not running' });
  }
  res.json({ success: true, data: { stopped: true } });
});

// ─── DELETE /sessions/:id ─────────────────────────────────────────────────────

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  const deleted = await deleteSession(req.params.id);
  if (!deleted) {
    return res.status(400).json({ success: false, error: 'Session not found, still running, or could not be deleted' });
  }
  res.json({ success: true, data: { deleted: true } });
});

// ─── POST /sessions/:id/archive ──────────────────────────────────────────────

router.post('/sessions/:id/archive', async (req: Request, res: Response) => {
  const archived = await archiveSession(req.params.id);
  if (!archived) {
    return res.status(400).json({ success: false, error: 'Session not found or still running' });
  }
  res.json({ success: true, data: { archived: true } });
});

// ─── POST /sessions/:id/unarchive ────────────────────────────────────────────

router.post('/sessions/:id/unarchive', async (req: Request, res: Response) => {
  const unarchived = await unarchiveSession(req.params.id);
  if (!unarchived) {
    return res.status(400).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, data: { archived: false } });
});

// ─── POST /sessions/:id/continue ─────────────────────────────────────────────

router.post('/sessions/:id/continue', async (req: Request, res: Response) => {
  await sessionsReadyPromise;
  try {
    const session = await continueSession(req.params.id, req.body || {});
    if (!session) {
      return res.status(404).json({ success: false, error: 'Source session not found' });
    }
    res.status(201).json({ success: true, data: session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sessions/:id/promote/:gen ─────────────────────────────────────────

router.post('/sessions/:id/promote/:gen', async (req: Request, res: Response) => {
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }
  const ok = await promoteManually(req.params.id, gen);
  if (!ok) {
    return res.status(404).json({ success: false, error: 'Session or generation not found' });
  }
  res.json({ success: true, data: { promoted: true, generation: gen } });
});

// ─── POST /sessions/:id/reflect/:gen ──────────────────────────────────────────

router.post('/sessions/:id/reflect/:gen', async (req: Request, res: Response) => {
  console.log(`[reflect route] POST /sessions/${req.params.id}/reflect/${req.params.gen}`);
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }

  // Wait for startup load to complete, then re-load if session still missing
  await sessionsReadyPromise;
  if (!getSession(req.params.id)) {
    sessionsReadyPromise = loadAllSessions().catch(console.error);
    await sessionsReadyPromise;
  }

  const model = req.body?.model ? String(req.body.model) : undefined;
  try {
    const result = await regenerateReflection(req.params.id, gen, model);
    if (result === null) {
      return res.status(404).json({ success: false, error: 'Session, generation, or report not found' });
    }
    res.json({ success: true, data: { reflection: result.reflection, param_changes: result.param_changes, generation: gen } });
  } catch (err: any) {
    console.error(`[reflect route] Error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions/:id/stream (SSE) ──────────────────────────────────────────

router.get('/sessions/:id/stream', (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send current state immediately on connect
  send('snapshot', {
    session_id: session.session_id,
    status: session.status,
    generation: session.generation,
    max_generations: session.max_generations,
    genome: session.genome,
    best: session.best,
    current_hypothesis: session.current_hypothesis,
  });

  const unsubscribe = subscribeToSession(sessionId, send);

  req.on('close', () => {
    unsubscribe();
  });
});

export default router;
