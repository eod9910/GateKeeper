import assert from 'assert';
import {
  buildMissingUniverseApiResponse,
  buildNoActiveUniverseJobApiResponse,
  buildUniverseJobStartedApiBody,
  buildUniverseJobCancelledApiBody,
  buildUniversePricesApiResponse,
  buildUniverseStatusApiBody,
  buildUniverseSuccessApiBody,
} from './universeRouteResponses';

function testBuildsSuccessBody() {
  assert.deepStrictEqual(buildUniverseSuccessApiBody({ ok: true }), {
    success: true,
    data: { ok: true },
  });
}

function testBuildsJobStartedBody() {
  const job: any = {
    type: 'update',
    status: 'running',
  };

  assert.deepStrictEqual(buildUniverseJobStartedApiBody('Update started.', job), {
    success: true,
    data: {
      message: 'Update started.',
      job,
    },
  });
}

function testBuildsNoActiveJobResponse() {
  assert.deepStrictEqual(buildNoActiveUniverseJobApiResponse(), {
    statusCode: 400,
    body: {
      success: false,
      error: 'No active job to cancel.',
    },
  });
}

function testBuildsJobCancelledBody() {
  assert.deepStrictEqual(buildUniverseJobCancelledApiBody(), {
    success: true,
    data: {
      message: 'Job cancelled.',
    },
  });
}

function testBuildsMissingUniverseResponse() {
  assert.deepStrictEqual(buildMissingUniverseApiResponse(), {
    statusCode: 400,
    body: {
      success: false,
      error: 'Universe not built yet. Run Build Universe first.',
    },
  });
}

async function testReturnsMissingUniverseResponse() {
  const response = await buildUniversePricesApiResponse({
    manifestPath: 'manifest.json',
    priceSnapshotTtlMs: 1000,
    forceRefresh: false,
    canAccessManifest: async () => false,
    buildPriceSnapshot: async () => {
      throw new Error('should not build snapshot when manifest is missing');
    },
  });

  assert.strictEqual(response.statusCode, 400);
  assert.deepStrictEqual(response.body, {
    success: false,
    error: 'Universe not built yet. Run Build Universe first.',
  });
}

async function testReturnsPriceSnapshotResponse() {
  const response = await buildUniversePricesApiResponse({
    manifestPath: 'manifest.json',
    priceSnapshotTtlMs: 1000,
    forceRefresh: true,
    canAccessManifest: async (manifestPath) => manifestPath === 'manifest.json',
    buildPriceSnapshot: async (forceRefresh) => {
      assert.strictEqual(forceRefresh, true);
      return {
        data: {
          AAPL: {
            last_close: 100,
            end: '2026-06-20',
            source: 'manifest',
          },
        },
        fetchedAt: Date.now(),
        cacheKey: 'test-cache',
        cacheLayer: 'refresh',
      };
    },
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.success, true);
  assert.deepStrictEqual((response.body.data as any).prices.AAPL, {
    last_close: 100,
    end: '2026-06-20',
    source: 'manifest',
  });
  assert.strictEqual((response.body.data as any).count, 1);
  assert.ok(response.body.freshness);
}

async function testBuildsStatusBody() {
  const body = await buildUniverseStatusApiBody({
    manifestPath: 'missing-manifest.json',
    optionablePath: 'missing-optionable.json',
    optionableProgressPath: 'missing-progress.json',
    priceSnapshotCachePath: 'missing-prices.json',
    manifestTtlMs: 1000,
    priceSnapshotTtlMs: 1000,
    activeJob: null,
    readJson: async () => {
      throw new Error('missing');
    },
    readPriceEnvelope: async () => null,
    now: new Date('2026-06-20T00:00:00.000Z'),
  } as any);

  assert.strictEqual(body.success, true);
  assert.strictEqual((body.data as any).built, false);
  assert.strictEqual((body.data as any).active_job, null);
}

async function main() {
  testBuildsSuccessBody();
  testBuildsJobStartedBody();
  testBuildsNoActiveJobResponse();
  testBuildsJobCancelledBody();
  testBuildsMissingUniverseResponse();
  await testReturnsMissingUniverseResponse();
  await testReturnsPriceSnapshotResponse();
  await testBuildsStatusBody();
  console.log('universeRouteResponses tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
