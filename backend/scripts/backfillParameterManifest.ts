import fs from 'fs/promises';
import path from 'path';
import { applyParameterManifest } from '../src/services/parameterManifest';
import type { StrategySpec } from '../src/types';

const STRATEGIES_DIR = path.resolve(__dirname, '..', 'data', 'strategies');

async function main() {
  const files = (await fs.readdir(STRATEGIES_DIR)).filter(name => name.endsWith('.json'));
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const filepath = path.join(STRATEGIES_DIR, file);
    const raw = JSON.parse(await fs.readFile(filepath, 'utf8')) as Partial<StrategySpec>;
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.strategy_id !== 'string' ||
      typeof raw.strategy_version_id !== 'string' ||
      typeof raw.name !== 'string'
    ) {
      skipped += 1;
      continue;
    }

    const normalized = applyParameterManifest(raw as StrategySpec);
    const before = JSON.stringify(raw);
    const after = JSON.stringify(normalized);
    if (before === after) {
      skipped += 1;
      continue;
    }

    await fs.writeFile(filepath, JSON.stringify(normalized, null, 2));
    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} strategy files, skipped ${skipped}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
