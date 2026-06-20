import { UniverseJob } from './universeJobProgress';
import {
  UniversePriceSnapshotResult,
  buildUniversePriceSnapshotResponse,
} from './universePriceSnapshot';
import { buildUniverseStatusSnapshot } from './universeStatusSummary';

export interface UniverseStatusApiDataOptions {
  manifestPath: string;
  optionablePath: string;
  optionableProgressPath: string;
  priceSnapshotCachePath: string;
  manifestTtlMs: number;
  priceSnapshotTtlMs: number;
  activeJob: UniverseJob | null;
}

export interface UniversePriceSnapshotApiResponse {
  statusCode: number;
  body: {
    success: boolean;
    error?: string;
    data?: unknown;
    freshness?: unknown;
  };
}

export type AccessUniverseManifest = (manifestPath: string) => Promise<boolean>;
export type BuildUniversePriceSnapshot = (forceRefresh: boolean) => Promise<UniversePriceSnapshotResult>;

export async function buildUniverseStatusApiData(options: UniverseStatusApiDataOptions) {
  return buildUniverseStatusSnapshot(options);
}

export async function buildUniversePricesApiResponse(options: {
  manifestPath: string;
  priceSnapshotTtlMs: number;
  forceRefresh: boolean;
  canAccessManifest: AccessUniverseManifest;
  buildPriceSnapshot: BuildUniversePriceSnapshot;
}): Promise<UniversePriceSnapshotApiResponse> {
  if (!(await options.canAccessManifest(options.manifestPath))) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: 'Universe not built yet. Run Build Universe first.',
      },
    };
  }

  const snapshot = await options.buildPriceSnapshot(options.forceRefresh);
  const priceResponse = buildUniversePriceSnapshotResponse(snapshot, options.priceSnapshotTtlMs);
  return {
    statusCode: 200,
    body: {
      success: true,
      ...priceResponse,
    },
  };
}
