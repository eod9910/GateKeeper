import * as fs from 'fs/promises';
import * as path from 'path';

export async function resolvePluginDefinition(pluginId: string): Promise<{ pattern: any; definition: any } | null> {
  const patternsDir = path.join(__dirname, '..', '..', 'data', 'patterns');
  const registryPath = path.join(patternsDir, 'registry.json');

  try {
    console.log(`[resolvePlugin] Reading registry: ${registryPath}`);
    const registryRaw = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(registryRaw);
    const pattern = Array.isArray(registry?.patterns)
      ? registry.patterns.find((entry: any) => String(entry?.pattern_id || '') === pluginId)
      : null;

    if (!pattern || !pattern.definition_file) {
      console.log(`[resolvePlugin] Pattern "${pluginId}" not found in registry (${(registry?.patterns || []).length} entries)`);
      return null;
    }

    const defPath = path.join(patternsDir, String(pattern.definition_file));
    const defRaw = await fs.readFile(defPath, 'utf-8');
    const definition = JSON.parse(defRaw);
    console.log(`[resolvePlugin] Resolved "${pluginId}" -> ${pattern.definition_file}`);
    return { pattern, definition };
  } catch (err: any) {
    console.error(`[resolvePlugin] ERROR for "${pluginId}":`, err?.message || err);
    return null;
  }
}
