import * as fs from 'fs/promises';

export interface UniverseRegimeSnapshot {
  generated_at: unknown;
  interval: unknown;
  total: unknown;
  summary: unknown;
}

export type ReadUniverseSnapshotFile = (snapshotPath: string) => Promise<string>;

export async function readUniverseRegimeSnapshot(
  snapshotPath: string,
  readFile: ReadUniverseSnapshotFile = (filePath) => fs.readFile(filePath, 'utf-8'),
): Promise<UniverseRegimeSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath);
    const snap = JSON.parse(raw);
    return {
      generated_at: snap.generated_at,
      interval: snap.interval,
      total: snap.total,
      summary: snap.summary,
    };
  } catch {
    return null;
  }
}
