import * as fs from 'fs';
import * as path from 'path';
import { readJsonDocument, writeJsonDocument } from './appStateDb';

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'ai-settings.json');
const OPENAI_PLACEHOLDER = 'your-openai-api-key-here';
const AI_SETTINGS_NAMESPACE = 'settings';
const AI_SETTINGS_DOCUMENT_KEY = 'ai_settings';

export interface AISettings {
  openai_api_key?: string;
  role_prompts?: Partial<Record<AIRolePromptKey, string>>;
  role_models?: Partial<Record<AIRoleModelKey, string>>;
}

export type AIRolePromptKey =
  | 'copilot'
  | 'plugin_engineer'
  | 'research_strategist'
  | 'research_analyst'
  | 'validator_analyst';

// Each named AI in the system can run on its own model. These keys are the
// single source of truth shared by the scanner (per-request), the thesis
// extractor, and the scheduler-driven board scan.
export type AIRoleModelKey =
  | 'copilot'
  | 'structure'
  | 'ledger'
  | 'thesis_extractor'
  | 'vision'
  | 'plugin_engineer'
  | 'research_strategist'
  | 'research_analyst'
  | 'validator_analyst';

const ROLE_PROMPT_KEYS: AIRolePromptKey[] = [
  'copilot',
  'plugin_engineer',
  'research_strategist',
  'research_analyst',
  'validator_analyst',
];

const ROLE_MODEL_KEYS: AIRoleModelKey[] = [
  'copilot',
  'structure',
  'ledger',
  'thesis_extractor',
  'vision',
  'plugin_engineer',
  'research_strategist',
  'research_analyst',
  'validator_analyst',
];

function normalizeRolePrompts(value: unknown): Partial<Record<AIRolePromptKey, string>> {
  const prompts: Partial<Record<AIRolePromptKey, string>> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prompts;
  for (const key of ROLE_PROMPT_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) prompts[key] = trimmed;
  }
  return prompts;
}

function normalizeRoleModels(value: unknown): Partial<Record<AIRoleModelKey, string>> {
  const models: Partial<Record<AIRoleModelKey, string>> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return models;
  for (const key of ROLE_MODEL_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) models[key] = trimmed;
  }
  return models;
}

function normalizeAISettings(settings: unknown): AISettings | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const obj = settings as Record<string, unknown>;
  const openai_api_key = typeof obj.openai_api_key === 'string' ? obj.openai_api_key.trim() : '';
  const role_prompts = normalizeRolePrompts(obj.role_prompts);
  const role_models = normalizeRoleModels(obj.role_models);
  return {
    openai_api_key: openai_api_key || undefined,
    role_prompts,
    role_models,
  };
}

export function loadAISettings(): AISettings | null {
  const persisted = readJsonDocument<AISettings>(
    AI_SETTINGS_NAMESPACE,
    AI_SETTINGS_DOCUMENT_KEY,
    (value) => normalizeAISettings(value) || {},
  );
  if (persisted) return persisted;
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const legacy = normalizeAISettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')));
      if (legacy) {
        writeJsonDocument(AI_SETTINGS_NAMESPACE, AI_SETTINGS_DOCUMENT_KEY, legacy);
      }
      return legacy;
    }
  } catch {
    // ignore malformed or missing settings file
  }
  return null;
}

export function saveAISettings(settings: AISettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const normalized = normalizeAISettings(settings) || {};
  writeJsonDocument(AI_SETTINGS_NAMESPACE, AI_SETTINGS_DOCUMENT_KEY, normalized);
}

export function maskKey(key: string): string {
  const value = String(key || '').trim();
  if (!value) return '';
  if (value.length < 8) return '****';
  return `****${value.slice(-4)}`;
}

export function isConfiguredKey(key: string | null | undefined): boolean {
  const value = String(key || '').trim();
  return !!value && value !== OPENAI_PLACEHOLDER;
}

export function getConfiguredOpenAIKey(): string {
  const saved = loadAISettings();
  if (isConfiguredKey(saved?.openai_api_key)) {
    return String(saved!.openai_api_key).trim();
  }
  const envKey = process.env.OPENAI_API_KEY || '';
  return isConfiguredKey(envKey) ? String(envKey).trim() : '';
}

export function getOpenAIKeySource(): 'saved' | 'env' | 'none' {
  const saved = loadAISettings();
  if (isConfiguredKey(saved?.openai_api_key)) return 'saved';
  if (isConfiguredKey(process.env.OPENAI_API_KEY || '')) return 'env';
  return 'none';
}

export function getSavedRolePrompts(): Partial<Record<AIRolePromptKey, string>> {
  const saved = loadAISettings();
  return saved?.role_prompts || {};
}

export function getRolePromptOverride(role: AIRolePromptKey): string {
  const prompts = getSavedRolePrompts();
  return String(prompts[role] || '').trim();
}

export function applyRolePromptOverride(role: AIRolePromptKey, defaultPrompt: string): string {
  const override = getRolePromptOverride(role);
  if (!override) return defaultPrompt;
  if (override.includes('{{DEFAULT_PROMPT}}')) {
    return override.replace('{{DEFAULT_PROMPT}}', defaultPrompt);
  }
  return `${override}\n\n${defaultPrompt}`;
}

export function getSavedRoleModels(): Partial<Record<AIRoleModelKey, string>> {
  const saved = loadAISettings();
  return saved?.role_models || {};
}

/**
 * Resolve the configured model for a named AI role. Returns the saved override
 * if present, otherwise an empty string so callers can fall back to their own
 * env-based default. This is the shared source of truth for model selection
 * across the scanner, thesis extractor, and scheduler-driven board scan.
 */
export function getRoleModelOverride(role: AIRoleModelKey): string {
  const models = getSavedRoleModels();
  return String(models[role] || '').trim();
}
