import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'ai-settings.json');
const OPENAI_PLACEHOLDER = 'your-openai-api-key-here';

export interface AISettings {
  openai_api_key?: string;
  role_prompts?: Partial<Record<AIRolePromptKey, string>>;
}

export type AIRolePromptKey =
  | 'copilot'
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

function normalizeAISettings(settings: unknown): AISettings | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const obj = settings as Record<string, unknown>;
  const openai_api_key = typeof obj.openai_api_key === 'string' ? obj.openai_api_key.trim() : '';
  const role_prompts = normalizeRolePrompts(obj.role_prompts);
  return {
    openai_api_key: openai_api_key || undefined,
    role_prompts,
  };
}

export function loadAISettings(): AISettings | null {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return normalizeAISettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')));
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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized, null, 2), 'utf-8');
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
