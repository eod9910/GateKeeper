import assert from 'assert';
import { createVisionRouter } from './vision';
import { VisionRouteServices } from '../modules/vision/visionRouteHandlers';

function routeSignature(layer: any) {
  const methods = Object.keys(layer.route.methods).sort().join(',');
  return `${methods} ${layer.route.path}`;
}

function main() {
  const services: VisionRouteServices = {
    checkOllamaStatus: async () => ({
      available: true,
      modelLoaded: true,
      provider: 'test',
    }),
    listWorkspaceAnalysts: () => [],
    analyzeChartPattern: async () => ({
      confidence: 100,
      isValidPattern: true,
      explanation: 'ok',
      rawResponse: 'ok',
      provider: 'test',
    }),
    chatWithCopilot: async () => 'ok',
    logChatRequest: () => {},
  };

  const router = createVisionRouter(services);
  const signatures = (router as any).stack.map(routeSignature);

  assert.deepStrictEqual(signatures, [
    'get /status',
    'get /analysts',
    'post /analyze',
    'post /chat',
  ]);
  console.log('vision route tests passed');
}

main();
