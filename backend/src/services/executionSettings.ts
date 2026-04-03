import * as fs from 'fs';
import * as path from 'path';

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
  return readSettingsFile(LOCAL_SETTINGS_FILE) || readSettingsFile(LEGACY_SETTINGS_FILE);
}

export function saveExecutionSettings(settings: ExecutionSettings): void {
  const dir = path.dirname(LOCAL_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getExecutionSettingsPaths() {
  return {
    legacy: LEGACY_SETTINGS_FILE,
    local: LOCAL_SETTINGS_FILE,
  };
}
