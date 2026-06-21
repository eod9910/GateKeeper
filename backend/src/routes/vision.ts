import { Router } from 'express';
import {
  createVisionRouteHandlers,
  createVisionRouteServices,
  type VisionRouteServices,
} from '../modules/vision/visionRouteHandlers';

export function createVisionRouter(services: VisionRouteServices = createVisionRouteServices()): Router {
  const router = Router();
  const handlers = createVisionRouteHandlers(services);

  router.get('/status', handlers.status);
  router.get('/analysts', handlers.analysts);
  router.post('/analyze', handlers.analyze);
  router.post('/chat', handlers.chat);

  return router;
}

export default createVisionRouter();
