import * as fs from 'fs';
import * as path from 'path';
import { readJsonDocument, writeJsonDocument } from './appStateDb';

export type ExecutionBrokerProvider = 'alpaca' | 'oanda';
export type AlpacaMode = 'paper' | 'live';
export type OandaEnvironment = 'practice' | 'live';

export interface ExecutionSettings {
  execution_broker_provider?: ExecutionBrokerProvider;
  broker_provider?: ExecutionBrokerProvider;
  alpaca_api_key?: string;
  alpaca_secret_key?: string;
  alpaca_base_url?: string;
  alpaca_mode?: AlpacaMode;
  oanda_api_token?: string;
  oanda_account_id?: string;
  oanda_environment?: OandaEnvironment;
  oanda_base_url?: string;
  robinhood_username?: string;
  robinhood_password?: string;
  robinhood_totp_secret?: string;
  robinhood_session_path?: string;
}

const LEGACY_SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'execution-settings.json');
const LOCAL_SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'preferences', 'execution-settings.local.json');
const EXECUTION_SETTINGS_NAMESPACE = 'settings';
const EXECUTION_SETTINGS_DOCUMENT_KEY = 'execution_settings';

function readSettingsFile(filePath: string): ExecutionSettings | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function loadExecutionSettings(): ExecutionSettings | null {
  const persisted = readJsonDocument<ExecutionSettings>(EXECUTION_SETTINGS_NAMESPACE, EXECUTION_SETTINGS_DOCUMENT_KEY);
  if (persisted) return persisted;
  const legacy = readSettingsFile(LOCAL_SETTINGS_FILE) || readSettingsFile(LEGACY_SETTINGS_FILE);
  if (legacy) {
    writeJsonDocument(EXECUTION_SETTINGS_NAMESPACE, EXECUTION_SETTINGS_DOCUMENT_KEY, legacy);
  }
  return legacy;
}

export function saveExecutionSettings(settings: ExecutionSettings): void {
  const dir = path.dirname(LOCAL_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJsonDocument(EXECUTION_SETTINGS_NAMESPACE, EXECUTION_SETTINGS_DOCUMENT_KEY, settings);
}

export function getExecutionSettingsPaths() {
  return {
    legacy: LEGACY_SETTINGS_FILE,
    local: LOCAL_SETTINGS_FILE,
  };
}
