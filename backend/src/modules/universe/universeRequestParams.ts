export interface UniverseBuildRequestParams {
  source: string;
  lookback: string;
  interval: string;
  minVolume: number;
  minVolumeArg: string;
  workers: number;
  workersArg: string;
}

export interface OptionableRebuildRequestParams {
  source: string;
  workers: number;
  workersArg: string;
}

export interface UniverseUpdateRequestParams {
  interval: string;
}

export interface RegimeClassificationRequestParams {
  interval: string;
}

function valueOrDefault(body: any, key: string, defaultValue: unknown): unknown {
  return body?.[key] ?? defaultValue;
}

export function parseUniverseBuildRequestParams(body: any): UniverseBuildRequestParams {
  const source = valueOrDefault(body, 'source', 'nasdaq-trader-us');
  const lookback = valueOrDefault(body, 'lookback', '5y');
  const interval = valueOrDefault(body, 'interval', '1d');
  const minVolume = valueOrDefault(body, 'min_volume', 0);
  const workers = valueOrDefault(body, 'workers', 10);

  return {
    source: String(source),
    lookback: String(lookback),
    interval: String(interval),
    minVolume: Number(minVolume),
    minVolumeArg: String(minVolume),
    workers: Number(workers),
    workersArg: String(workers),
  };
}

export function parseOptionableRebuildRequestParams(body: any): OptionableRebuildRequestParams {
  const source = valueOrDefault(body, 'source', 'nasdaq-trader-us');
  const workers = valueOrDefault(body, 'workers', 5);

  return {
    source: String(source),
    workers: Number(workers),
    workersArg: String(workers),
  };
}

export function parseUniverseUpdateRequestParams(body: any): UniverseUpdateRequestParams {
  return {
    interval: String(valueOrDefault(body, 'interval', '1d')),
  };
}

export function parseRegimeClassificationRequestParams(body: any): RegimeClassificationRequestParams {
  return {
    interval: String(valueOrDefault(body, 'interval', '1d')),
  };
}

export function parseUniverseForceRefreshQuery(query: any): boolean {
  return String(query?.force_refresh || '').trim().toLowerCase() === 'true';
}
