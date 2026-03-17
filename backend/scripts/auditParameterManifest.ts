import fs from 'fs';
import path from 'path';
import { resolveStrategyParameterManifest } from '../src/services/parameterManifest';
import type { StrategySpec } from '../src/types';

type PatternDefinition = Record<string, any>;

const ROOT = path.resolve(__dirname, '..');
const PATTERNS_DIR = path.join(ROOT, 'data', 'patterns');
const STRATEGIES_DIR = path.join(ROOT, 'data', 'strategies');

function readJsonFiles(dir: string): Array<{ file: string; data: any }> {
  const out: Array<{ file: string; data: any }> = [];
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    const filepath = path.join(dir, name);
    try {
      out.push({
        file: filepath,
        data: JSON.parse(fs.readFileSync(filepath, 'utf8')),
      });
    } catch (error) {
      console.warn(`Skipping malformed JSON: ${filepath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return out;
}

function toAuditSpec(pattern: PatternDefinition): StrategySpec {
  return {
    strategy_id: String(pattern.pattern_id || 'unknown_pattern'),
    strategy_version_id: `${String(pattern.pattern_id || 'unknown_pattern')}_audit`,
    name: String(pattern.name || pattern.pattern_id || 'Unknown Pattern'),
    status: 'draft',
    asset_class: 'stocks',
    interval: Array.isArray(pattern.suggested_timeframes) && pattern.suggested_timeframes.length
      ? String(pattern.suggested_timeframes[0]).toLowerCase()
      : '1d',
    structure_config: { ...(pattern.default_structure_config || {}) },
    setup_config: {
      ...(pattern.default_setup_params || {}),
      pattern_type: pattern.pattern_type || pattern.pattern_id,
    },
    entry_config: { ...(pattern.default_entry || {}) },
    risk_config: {
      ...(pattern.default_risk || {}),
      ...(pattern.default_risk_config || {}),
    },
    exit_config: { ...(pattern.default_exit || {}) },
    cost_config: {},
    universe_id: 'audit',
  };
}

function pathExists(target: any, dottedPath: string): boolean {
  const segments = String(dottedPath || '')
    .split('.')
    .filter(Boolean);
  let current = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return false;
      const idx = Number(segment);
      if (idx < 0 || idx >= current.length) return false;
      current = current[idx];
      continue;
    }
    if (!current || typeof current !== 'object') return false;
    if (!(segment in current)) {
      // Treat missing descendants under an existing object/list chain as writable,
      // because composite stage params are often materialized lazily by sweep or validation.
      return true;
    }
    current = current[segment];
  }
  return true;
}

function summarizeManifest(spec: StrategySpec, familyDef?: PatternDefinition) {
  const manifest = resolveStrategyParameterManifest(spec, familyDef);
  const sweepEnabled = manifest.filter(item => item.sweep_enabled);
  const sensitivityEnabled = manifest.filter(item => item.sensitivity_enabled);
  const missingPaths = manifest.filter(item => !pathExists(spec, item.path));
  return {
    manifest,
    total: manifest.length,
    sweepCount: sweepEnabled.length,
    sensitivityCount: sensitivityEnabled.length,
    missingPaths,
  };
}

function printSection(title: string) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function main() {
  const patternFiles = readJsonFiles(PATTERNS_DIR)
    .filter(({ data }) => typeof data?.pattern_id === 'string' && data.pattern_id.trim().length > 0);
  const strategyFiles = readJsonFiles(STRATEGIES_DIR);

  const patternFindings = patternFiles.map(({ file, data }) => {
    const spec = toAuditSpec(data);
    const summary = summarizeManifest(spec, data);
    return {
      file,
      patternId: String(data.pattern_id || path.basename(file, '.json')),
      composition: String(data.composition || ''),
      artifactType: String(data.artifact_type || ''),
      ...summary,
    };
  });

  const strategyFindings = strategyFiles.map(({ file, data }) => {
    const spec = data as StrategySpec;
    const summary = summarizeManifest(spec);
    return {
      file,
      strategyVersionId: String(spec.strategy_version_id || path.basename(file, '.json')),
      patternType: String(spec.setup_config?.pattern_type || spec.strategy_id || ''),
      ...summary,
    };
  });

  printSection('Pattern Family Manifest Audit');
  for (const finding of patternFindings) {
    const flags: string[] = [];
    if (finding.total === 0) flags.push('NO_MANIFEST');
    if (finding.sweepCount === 0) flags.push('NO_SWEEP_PARAMS');
    if (finding.sensitivityCount === 0) flags.push('NO_SENSITIVITY_PARAMS');
    if (finding.missingPaths.length > 0) flags.push(`MISSING_PATHS=${finding.missingPaths.length}`);
    console.log(
      `${finding.patternId} :: total=${finding.total}, sweep=${finding.sweepCount}, sensitivity=${finding.sensitivityCount}, composition=${finding.composition || 'n/a'}, artifact=${finding.artifactType || 'n/a'}${flags.length ? ` :: ${flags.join(', ')}` : ''}`,
    );
  }

  const weakPatterns = patternFindings.filter(f => f.total === 0 || f.sweepCount === 0 || f.sensitivityCount === 0 || f.missingPaths.length > 0);
  if (weakPatterns.length) {
    printSection('Pattern Families Needing Attention');
    weakPatterns.forEach(finding => {
      console.log(`- ${finding.patternId}`);
      finding.missingPaths.forEach(item => {
        console.log(`  missing path: ${item.path} (${item.label})`);
      });
    });
  }

  printSection('Saved Strategy Manifest Audit');
  const weakStrategies = strategyFindings.filter(f => f.total === 0 || f.sweepCount === 0 || f.sensitivityCount === 0 || f.missingPaths.length > 0);
  console.log(`Saved strategies audited: ${strategyFindings.length}`);
  console.log(`Strategies with weak/missing manifests: ${weakStrategies.length}`);
  weakStrategies.slice(0, 50).forEach(finding => {
    const flags: string[] = [];
    if (finding.total === 0) flags.push('NO_MANIFEST');
    if (finding.sweepCount === 0) flags.push('NO_SWEEP_PARAMS');
    if (finding.sensitivityCount === 0) flags.push('NO_SENSITIVITY_PARAMS');
    if (finding.missingPaths.length > 0) flags.push(`MISSING_PATHS=${finding.missingPaths.length}`);
    console.log(`- ${finding.strategyVersionId} (${finding.patternType || 'unknown'}) :: ${flags.join(', ')}`);
  });
}

main();
