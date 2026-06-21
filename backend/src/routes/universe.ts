import { Router } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { createUniverseRouteContext, UniverseRouteContext } from '../modules/universe/universeRouteContext';
import { createUniverseRouteHandlers } from '../modules/universe/universeRouteHandlers';

export function createUniverseRouter(context: UniverseRouteContext): Router {
  const router = Router();
  const handlers = createUniverseRouteHandlers(context);

  router.get('/status', handlers.status);
  router.get('/prices', handlers.prices);
  router.post('/build', handlers.build);
  router.post('/rebuild-optionable', handlers.rebuildOptionable);
  router.post('/update', handlers.update);
  router.post('/classify-regimes', handlers.classifyRegimes);
  router.get('/regime-snapshot', handlers.regimeSnapshot);
  router.delete('/cancel', handlers.cancel);

  return router;
}

const defaultContext = createUniverseRouteContext(path.join(__dirname, '..', '..'), spawn);

export default createUniverseRouter(defaultContext);
