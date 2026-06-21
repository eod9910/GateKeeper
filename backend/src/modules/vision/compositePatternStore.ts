import fs from 'fs';
import path from 'path';

export function getDefaultPatternDataDir(): string {
  return path.join(process.cwd(), 'backend', 'data', 'patterns');
}

export function loadPrimitiveDefaultParams(patternId: string, patternDataDir: string = getDefaultPatternDataDir()): Record<string, any> {
  const definition = loadPatternDefinition(patternId, patternDataDir);
  const setup = definition?.default_setup_params && typeof definition.default_setup_params === 'object'
    ? { ...definition.default_setup_params }
    : {};
  delete setup.pattern_type;
  return setup;
}

export function loadPatternDefinition(patternId: string, patternDataDir: string = getDefaultPatternDataDir()): Record<string, any> | null {
  const normalized = String(patternId || '').trim();
  if (!normalized) return null;
  try {
    const filePath = path.join(patternDataDir, `${normalized}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn('[visionService] Failed to load pattern definition for local composite fallback:', patternId, error);
    return null;
  }
}
