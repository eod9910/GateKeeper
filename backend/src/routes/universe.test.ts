import assert from 'assert';
import { createUniverseRouter } from './universe';
import { UniverseActiveJobState } from '../modules/universe/universeActiveJobState';
import { createUniverseRouteConfig } from '../modules/universe/universeRouteConfig';
import { UniverseRouteContext } from '../modules/universe/universeRouteContext';

function routeSignature(layer: any) {
  const methods = Object.keys(layer.route.methods).sort().join(',');
  return `${methods} ${layer.route.path}`;
}

function main() {
  const context: UniverseRouteContext = {
    routeConfig: createUniverseRouteConfig('repo/backend'),
    activeState: new UniverseActiveJobState(),
    startUniverseRouteProcess: () => {
      throw new Error('startUniverseRouteProcess should not run while registering routes');
    },
    universePriceSnapshotService: {
      buildUniversePriceSnapshot: async () => {
        throw new Error('buildUniversePriceSnapshot should not run while registering routes');
      },
    },
  };

  const router = createUniverseRouter(context);
  const signatures = (router as any).stack.map(routeSignature);

  assert.deepStrictEqual(signatures, [
    'get /status',
    'get /prices',
    'post /build',
    'post /rebuild-optionable',
    'post /update',
    'post /classify-regimes',
    'get /regime-snapshot',
    'delete /cancel',
  ]);
  console.log('universe route tests passed');
}

main();
