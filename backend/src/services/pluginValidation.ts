import { spawn } from 'child_process';
import * as path from 'path';

type PlainObject = Record<string, unknown>;

export type PluginValidationIssue = {
  code: string;
  field: string;
  message: string;
  expected?: string;
  example?: string;
};

export type PluginRegisterValidationInput = {
  code: string;
  definition: unknown;
  requestedPatternId: string;
};

export type PluginRegisterValidationResult = {
  issues: PluginValidationIssue[];
  patternId: string;
  composition: string;
  artifactType: string;
  category: string;
};

const PATTERN_ID_REGEX = /^[a-z][a-z0-9_]*$/;
const CATEGORY_REGEX = /^[a-z][a-z0-9_]*$/;
const ALLOWED_COMPOSITIONS = new Set(['primitive', 'composite', 'preset']);
const ALLOWED_ARTIFACT_TYPES = new Set(['indicator', 'pattern']);

function asObject(value: unknown): PlainObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as PlainObject;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePatternId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isValidPatternId(value: unknown): value is string {
  return typeof value === 'string' && PATTERN_ID_REGEX.test(value);
}

function pushIssue(
  issues: PluginValidationIssue[],
  code: string,
  field: string,
  message: string,
  expected?: string,
  example?: string,
): void {
  issues.push({ code, field, message, expected, example });
}

function validateCompositeSpec(definition: PlainObject, issues: PluginValidationIssue[]): void {
  const defaultSetup = asObject(definition.default_setup_params);
  const compositeSpec = asObject(defaultSetup?.composite_spec);
  if (!compositeSpec) {
    pushIssue(
      issues,
      'composite_spec_missing',
      'default_setup_params.composite_spec',
      'Composite indicators must define default_setup_params.composite_spec.',
      'Object with stages[] and reducer',
      '{"stages":[{"id":"structure","pattern_id":"rdp_swing_structure_primitive"}],"reducer":{"op":"AND","inputs":["structure"]}}',
    );
    return;
  }

  // Conditional composites use branches[] instead of stages[] — both are valid
  const isConditional = String(compositeSpec.type || '').trim().toLowerCase() === 'conditional';
  const hasBranches = isConditional && Array.isArray(compositeSpec.branches) && (compositeSpec.branches as unknown[]).length > 0;

  const stages = Array.isArray(compositeSpec.stages) ? compositeSpec.stages : [];
  if (!stages.length && !hasBranches) {
    pushIssue(
      issues,
      'composite_stages_missing',
      'default_setup_params.composite_spec.stages',
      'Composite indicators must include at least one stage (or branches[] for conditional composites).',
      'Array of stage objects',
      '[{"id":"structure","pattern_id":"rdp_swing_structure_primitive"}]',
    );
  }

  // Skip stage-level validation for conditional composites — branches are self-contained
  if (hasBranches) return;

  stages.forEach((stage, idx) => {
    const stageObj = asObject(stage);
    if (!stageObj) {
      pushIssue(
        issues,
        'composite_stage_invalid',
        `default_setup_params.composite_spec.stages[${idx}]`,
        'Each stage must be an object.',
      );
      return;
    }

    const stageId = normalizedText(stageObj.id);
    const stagePatternId = normalizedText(stageObj.pattern_id);
    if (!stageId) {
      pushIssue(
        issues,
        'composite_stage_id_missing',
        `default_setup_params.composite_spec.stages[${idx}].id`,
        'Each stage must include id.',
        'snake_case id',
        'structure',
      );
    }
    if (!stagePatternId) {
      pushIssue(
        issues,
        'composite_stage_pattern_missing',
        `default_setup_params.composite_spec.stages[${idx}].pattern_id`,
        'Each stage must include pattern_id.',
        'Registered primitive/composite pattern id',
        'rdp_swing_structure_primitive',
      );
    } else if (!isValidPatternId(stagePatternId)) {
      pushIssue(
        issues,
        'composite_stage_pattern_invalid',
        `default_setup_params.composite_spec.stages[${idx}].pattern_id`,
        'Stage pattern_id must be snake_case.',
        'lowercase snake_case',
        normalizePatternId(stagePatternId),
      );
    }
  });

  const reducer = asObject(compositeSpec.reducer);
  if (!reducer) {
    pushIssue(
      issues,
      'composite_reducer_missing',
      'default_setup_params.composite_spec.reducer',
      'Composite indicators must define reducer.',
      'Object',
      '{"op":"AND","inputs":["structure","location","trigger"]}',
    );
    return;
  }

  const reducerOp = normalizedText(reducer.op).toUpperCase();
  const reducerInputs = Array.isArray(reducer.inputs) ? reducer.inputs : [];
  if (!reducerOp) {
    pushIssue(
      issues,
      'composite_reducer_op_missing',
      'default_setup_params.composite_spec.reducer.op',
      'Reducer op is required.',
      'AND or OR',
      'AND',
    );
  }
  if (!reducerInputs.length) {
    pushIssue(
      issues,
      'composite_reducer_inputs_missing',
      'default_setup_params.composite_spec.reducer.inputs',
      'Reducer inputs are required.',
      'Array of stage ids',
      '["structure","location","trigger"]',
    );
  }
}

export function validatePluginRegisterPayload(
  input: PluginRegisterValidationInput,
): PluginRegisterValidationResult {
  const issues: PluginValidationIssue[] = [];
  const definition = asObject(input.definition);
  const rawRequestedPatternId = normalizedText(input.requestedPatternId);

  if (!definition) {
    pushIssue(issues, 'definition_required', 'definition', 'Definition must be a JSON object.');
    return {
      issues,
      patternId: '',
      composition: 'composite',
      artifactType: 'indicator',
      category: 'custom',
    };
  }

  const definitionPatternId = normalizedText(definition.pattern_id);
  const patternId = rawRequestedPatternId || definitionPatternId;
  if (!patternId) {
    pushIssue(
      issues,
      'pattern_id_required',
      'pattern_id',
      'pattern_id is required.',
      'lowercase snake_case',
      'rsi_primitive',
    );
  } else {
    if (!isValidPatternId(patternId)) {
      pushIssue(
        issues,
        'pattern_id_invalid',
        'pattern_id',
        'pattern_id must be lowercase snake_case.',
        '^[a-z][a-z0-9_]*$',
        normalizePatternId(patternId),
      );
    }
    if (rawRequestedPatternId && rawRequestedPatternId !== patternId) {
      pushIssue(
        issues,
        'pattern_id_mismatch',
        'pattern_id',
        'request pattern_id must match definition.pattern_id exactly.',
        patternId,
        patternId,
      );
    }
    if (definitionPatternId && definitionPatternId !== patternId) {
      pushIssue(
        issues,
        'definition_pattern_id_mismatch',
        'definition.pattern_id',
        'definition.pattern_id must match request pattern_id.',
        patternId,
        patternId,
      );
    }
  }

  const composition = normalizedText(definition.composition || 'composite').toLowerCase();

  // Composites using composite_runner.py don't need Python code — the runner handles execution
  const pluginFileVal = normalizedText(definition.plugin_file);
  const isCompositeRunner = composition === 'composite' && pluginFileVal === 'plugins/composite_runner.py';
  if (!isCompositeRunner && !normalizedText(input.code)) {
    pushIssue(issues, 'code_required', 'code', 'Plugin code is required.');
  }

  if (!ALLOWED_COMPOSITIONS.has(composition)) {
    pushIssue(
      issues,
      'composition_invalid',
      'composition',
      'composition must be "primitive" or "composite".',
      'primitive|composite',
      'primitive',
    );
  }

  const artifactType = normalizedText(definition.artifact_type || 'indicator').toLowerCase();
  if (!ALLOWED_ARTIFACT_TYPES.has(artifactType)) {
    pushIssue(
      issues,
      'artifact_type_invalid',
      'artifact_type',
      'artifact_type must be "indicator" or "pattern".',
      'indicator|pattern',
      'indicator',
    );
  }

  if (patternId && composition === 'composite' && patternId.endsWith('_primitive')) {
    pushIssue(
      issues,
      'composite_suffix_invalid',
      'pattern_id',
      'Composite pattern_id cannot end with "_primitive".',
      'Use a composite id (optionally ending in "_composite").',
      patternId.replace(/_primitive$/, '_composite'),
    );
  }

  const category = normalizedText(definition.category || 'custom').toLowerCase();
  if (!CATEGORY_REGEX.test(category)) {
    pushIssue(
      issues,
      'category_invalid',
      'category',
      'category must be lowercase snake_case.',
      'lowercase snake_case',
      normalizePatternId(category || 'custom'),
    );
  }

  const name = normalizedText(definition.name);
  if (!name) {
    pushIssue(
      issues,
      'name_required',
      'name',
      'name is required.',
      'Human-readable display name',
      'MACD (Primitive)',
    );
  }

  if (patternId) {
    const expectedPatternType = patternId;
    const expectedPluginFile = `plugins/${patternId}.py`;
    const expectedPluginFunction = `run_${patternId}_plugin`;

    const patternType = normalizedText(definition.pattern_type);
    const pluginFile = normalizedText(definition.plugin_file);
    const pluginFunction = normalizedText(definition.plugin_function);

    if (patternType && patternType !== expectedPatternType) {
      pushIssue(
        issues,
        'pattern_type_mismatch',
        'pattern_type',
        'pattern_type must equal pattern_id.',
        expectedPatternType,
        expectedPatternType,
      );
    }
    // Composites using composite_runner.py share a single runner — plugin_file alone is sufficient
    const isCompositeRunner =
      composition === 'composite' &&
      pluginFile === 'plugins/composite_runner.py';

    if (pluginFile && pluginFile !== expectedPluginFile && !isCompositeRunner) {
      pushIssue(
        issues,
        'plugin_file_mismatch',
        'plugin_file',
        'plugin_file must follow plugins/<pattern_id>.py (or plugins/composite_runner.py for composites).',
        expectedPluginFile,
        expectedPluginFile,
      );
    }
    if (pluginFunction && pluginFunction !== expectedPluginFunction && !isCompositeRunner) {
      pushIssue(
        issues,
        'plugin_function_mismatch',
        'plugin_function',
        'plugin_function must follow run_<pattern_id>_plugin (or run_composite_plugin for composites).',
        expectedPluginFunction,
        expectedPluginFunction,
      );
    }
  }

  // Validate tunable_params for primitives
  if (composition === 'primitive') {
    const tunableParams = Array.isArray(definition.tunable_params) ? definition.tunable_params : null;
    if (!tunableParams || tunableParams.length === 0) {
      pushIssue(
        issues,
        'tunable_params_missing',
        'tunable_params',
        'Primitives MUST declare tunable_params. A generic primitive needs at least one configurable parameter. ' +
        'If ALL behavior is truly fixed, reconsider whether this should be a primitive.',
        'Array of { key, label, type, default, ... }',
        '[{ "key": "period", "label": "Period", "type": "int", "min": 2, "max": 200, "default": 14 }]',
      );
    } else {
      const ALLOWED_PARAM_TYPES = new Set(['int', 'float', 'bool', 'boolean', 'enum', 'string', 'number']);
      const defaultSetup = asObject(definition.default_setup_params) || {};

      tunableParams.forEach((param: unknown, idx: number) => {
        const p = asObject(param);
        if (!p) {
          pushIssue(issues, 'tunable_param_invalid', `tunable_params[${idx}]`, 'Each tunable param must be an object.');
          return;
        }

        const key = normalizedText(p.key);
        if (!key) {
          pushIssue(issues, 'tunable_param_key_missing', `tunable_params[${idx}].key`, 'Tunable param key is required.');
        }

        const label = normalizedText(p.label);
        if (!label) {
          pushIssue(issues, 'tunable_param_label_missing', `tunable_params[${idx}].label`, 'Tunable param label is required.');
        }

        const paramType = normalizedText(p.type).toLowerCase();
        if (!paramType || !ALLOWED_PARAM_TYPES.has(paramType)) {
          pushIssue(
            issues,
            'tunable_param_type_invalid',
            `tunable_params[${idx}].type`,
            `Param type must be one of: ${[...ALLOWED_PARAM_TYPES].join(', ')}. Got "${paramType}".`,
          );
        }

        if (paramType === 'enum') {
          const options = Array.isArray(p.options) ? p.options : [];
          if (options.length < 2) {
            pushIssue(
              issues,
              'tunable_param_enum_options',
              `tunable_params[${idx}].options`,
              'Enum params must have at least 2 options.',
              'Array of strings',
              '["bullish", "bearish"]',
            );
          }
        }

        if (p.default === undefined && p.default === null) {
          pushIssue(
            issues,
            'tunable_param_default_missing',
            `tunable_params[${idx}].default`,
            'Tunable param must have a default value.',
          );
        }

        // Check that default_setup_params includes a default for this key
        if (key && defaultSetup[key] === undefined) {
          pushIssue(
            issues,
            'default_setup_missing_key',
            `default_setup_params.${key}`,
            `default_setup_params must include a default value for tunable param "${key}".`,
          );
        }
      });
    }
  }

  if (composition === 'composite') {
    validateCompositeSpec(definition, issues);
  }

  if (composition === 'primitive' && artifactType === 'indicator') {
    const indicatorRole = normalizedText(definition.indicator_role);
    if (!indicatorRole) {
      pushIssue(
        issues,
        'indicator_role_required',
        'indicator_role',
        'Primitive indicators must define indicator_role.',
        'anchor_structure|location|timing_trigger|state_filter|regime_state|entry_composite',
        'timing_trigger',
      );
    }
  }

  if (artifactType === 'pattern') {
    const patternRole = normalizedText(definition.pattern_role);
    if (!patternRole) {
      pushIssue(
        issues,
        'pattern_role_required',
        'pattern_role',
        'Pattern artifacts must define pattern_role.',
        'phase_structure_pattern|pattern_pipeline|regime_pattern',
        'phase_structure_pattern',
      );
    }
  }

  return {
    issues,
    patternId,
    composition,
    artifactType,
    category: category || 'custom',
  };
}

export function validatePluginTestRequest(
  code: string,
  symbol: string,
  requestedPatternId: string,
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];

  if (!normalizedText(code)) {
    pushIssue(issues, 'code_required', 'code', 'Plugin code is required.');
  }

  if (!symbol || !/^[A-Z0-9._\-=^]{1,15}$/.test(symbol)) {
    pushIssue(
      issues,
      'symbol_invalid',
      'symbol',
      'symbol is required and must be valid.',
      'Ticker-like symbol',
      'SPY',
    );
  }

  const patternId = normalizedText(requestedPatternId);
  if (!patternId) {
    pushIssue(
      issues,
      'pattern_id_required',
      'pattern_id',
      'pattern_id is required.',
      'lowercase snake_case',
      'my_indicator_primitive',
    );
    return issues;
  }

  if (!isValidPatternId(patternId)) {
    pushIssue(
      issues,
      'pattern_id_invalid',
      'pattern_id',
      'pattern_id must be lowercase snake_case.',
      '^[a-z][a-z0-9_]*$',
      normalizePatternId(patternId),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Gate 1: Candidate Output Validator (runs after test)
// ---------------------------------------------------------------------------

const SPEC_HASH_REGEX = /^[0-9a-f]{64}$/;

export type CandidateValidationResult = {
  validation_passed: boolean;
  validation_errors: string[];
};

export function validateCandidateOutput(
  candidates: unknown[],
  patternId: string,
): CandidateValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(candidates)) {
    errors.push('Test output "candidates" must be an array.');
    return { validation_passed: false, validation_errors: errors };
  }

  if (candidates.length === 0) {
    // No candidates is valid — the indicator just didn't fire. No structural errors.
    return { validation_passed: true, validation_errors: [] };
  }

  candidates.forEach((raw, idx) => {
    const prefix = `candidate[${idx}]`;
    const c = asObject(raw);
    if (!c) {
      errors.push(`${prefix}: must be an object.`);
      return;
    }

    // Required string fields
    for (const field of ['candidate_id', 'id', 'strategy_version_id', 'pattern_type'] as const) {
      if (typeof c[field] !== 'string' || !(c[field] as string).trim()) {
        errors.push(`${prefix}.${field}: must be a non-empty string.`);
      }
    }

    // spec_hash must be a 64-char hex SHA-256
    const specHash = typeof c.spec_hash === 'string' ? (c.spec_hash as string).trim() : '';
    if (!specHash) {
      errors.push(`${prefix}.spec_hash: missing.`);
    } else if (!SPEC_HASH_REGEX.test(specHash)) {
      errors.push(
        `${prefix}.spec_hash: must be a 64-character hex SHA-256 hash. Got "${specHash.slice(0, 20)}...". ` +
        'Do not hardcode spec_hash; use compute_spec_hash(spec).',
      );
    }

    // score 0..1
    if (typeof c.score !== 'number' || c.score < 0 || c.score > 1) {
      errors.push(`${prefix}.score: must be a number between 0.0 and 1.0. Got ${JSON.stringify(c.score)}.`);
    }

    // entry_ready bool
    if (typeof c.entry_ready !== 'boolean') {
      errors.push(`${prefix}.entry_ready: must be a boolean. Got ${typeof c.entry_ready}.`);
    }

    // rule_checklist
    const rules = c.rule_checklist;
    if (!Array.isArray(rules) || rules.length === 0) {
      errors.push(`${prefix}.rule_checklist: must be a non-empty array of rule objects.`);
    } else {
      (rules as unknown[]).forEach((rule, rIdx) => {
        const rObj = asObject(rule);
        if (!rObj) {
          errors.push(`${prefix}.rule_checklist[${rIdx}]: must be an object.`);
          return;
        }
        if (typeof rObj.rule_name !== 'string') {
          errors.push(`${prefix}.rule_checklist[${rIdx}].rule_name: must be a string.`);
        }
        if (typeof rObj.passed !== 'boolean') {
          errors.push(`${prefix}.rule_checklist[${rIdx}].passed: must be a boolean.`);
        }
      });
    }

    // chart_data
    if (!Array.isArray(c.chart_data)) {
      errors.push(`${prefix}.chart_data: must be an array.`);
    }

    // node_result — REQUIRED
    const nodeResult = asObject(c.node_result);
    if (!nodeResult) {
      errors.push(
        `${prefix}.node_result: MISSING. Every primitive must include node_result: ` +
        '{ passed: bool, score: float, features: dict, anchors: dict, reason: str }.',
      );
    } else {
      if (typeof nodeResult.passed !== 'boolean') {
        errors.push(`${prefix}.node_result.passed: must be a boolean.`);
      }
      if (typeof nodeResult.score !== 'number') {
        errors.push(`${prefix}.node_result.score: must be a number.`);
      }
      if (!asObject(nodeResult.features) && nodeResult.features !== undefined) {
        errors.push(`${prefix}.node_result.features: must be a dict/object.`);
      }
      if (!asObject(nodeResult.anchors) && nodeResult.anchors !== undefined) {
        errors.push(`${prefix}.node_result.anchors: must be a dict/object.`);
      }
      if (typeof nodeResult.reason !== 'string') {
        errors.push(`${prefix}.node_result.reason: must be a string.`);
      }
    }

    // output_ports — REQUIRED for pipeline DAG support
    const outputPorts = asObject(c.output_ports);
    if (!outputPorts) {
      errors.push(
        `${prefix}.output_ports: MISSING. Every primitive must include output_ports with at least a "signal" port. ` +
        'Example: { "signal": { "passed": true, "score": 0.8, "reason": "description" } }',
      );
    } else {
      const signalPort = asObject(outputPorts.signal);
      if (!signalPort) {
        errors.push(
          `${prefix}.output_ports.signal: MISSING. The "signal" port is required in output_ports.`,
        );
      } else {
        if (typeof signalPort.passed !== 'boolean') {
          errors.push(`${prefix}.output_ports.signal.passed: must be a boolean.`);
        }
        if (typeof signalPort.score !== 'number') {
          errors.push(`${prefix}.output_ports.signal.score: must be a number.`);
        }
        if (typeof signalPort.reason !== 'string') {
          errors.push(`${prefix}.output_ports.signal.reason: must be a string.`);
        }
      }
    }
  });

  return {
    validation_passed: errors.length === 0,
    validation_errors: errors,
  };
}

// ---------------------------------------------------------------------------
// Gate 2: Python Code Validator (runs before registration)
// ---------------------------------------------------------------------------

const VALIDATE_SCRIPT = path.join(__dirname, '..', '..', 'services', 'validate_plugin_code.py');

export type PythonCodeValidationResult = {
  valid: boolean;
  errors: string[];
};

export async function validatePythonCode(
  code: string,
  patternId: string,
): Promise<PythonCodeValidationResult> {
  return new Promise((resolve) => {
    const proc = spawn('py', [VALIDATE_SCRIPT, patternId], {
      cwd: path.join(__dirname, '..', '..', 'services'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ valid: false, errors: ['Python validation timed out after 10 seconds.'] });
    }, 10_000);

    proc.on('close', (exitCode) => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(stdout.trim());
        resolve({
          valid: Boolean(result.valid),
          errors: Array.isArray(result.errors) ? result.errors : [],
        });
      } catch {
        resolve({
          valid: false,
          errors: [`Python validator failed (exit ${exitCode}): ${stderr || stdout || 'no output'}`],
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ valid: false, errors: [`Failed to run Python validator: ${err.message}`] });
    });

    proc.stdin.write(code);
    proc.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Composite stage registry validation (runs before registration)
// ---------------------------------------------------------------------------

export function validateCompositeStagesExist(
  definition: Record<string, unknown>,
  registeredPatternIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const defaultSetup = asObject(definition.default_setup_params);
  if (!defaultSetup) return errors;

  const compositeSpec = asObject(defaultSetup.composite_spec);
  if (!compositeSpec) return errors;

  // Conditional composites use branches — no stage-level validation needed here
  if (String(compositeSpec.type || '').trim().toLowerCase() === 'conditional') return errors;

  const stages = Array.isArray(compositeSpec.stages) ? compositeSpec.stages : [];
  stages.forEach((stage, idx) => {
    const stageObj = asObject(stage);
    if (!stageObj) return;
    const stagePatternId = normalizedText(stageObj.pattern_id);
    if (stagePatternId && !registeredPatternIds.has(stagePatternId)) {
      errors.push(
        `composite_spec.stages[${idx}].pattern_id "${stagePatternId}" is not registered. ` +
        'All stage primitives must be registered before the composite that references them.',
      );
    }
  });

  return errors;
}
