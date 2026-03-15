import { spawn } from 'child_process';
import * as path from 'path';

export interface RobinhoodProbeConfig {
  username?: string;
  password?: string;
  totpSecret?: string;
  mfaCode?: string;
  sessionPath?: string;
}

export interface RobinhoodProbeResult {
  source: string;
  stocks: unknown[];
  options: unknown[];
  counts: {
    stocks: number;
    options: number;
  };
}

function trimOrUndefined(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

export async function probeRobinhoodPositions(config: RobinhoodProbeConfig = {}): Promise<RobinhoodProbeResult> {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'test_robinhood_positions.py');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };

  const username = trimOrUndefined(config.username);
  const password = trimOrUndefined(config.password);
  const totpSecret = trimOrUndefined(config.totpSecret);
  const mfaCode = trimOrUndefined(config.mfaCode);
  const sessionPath = trimOrUndefined(config.sessionPath);

  if (username) env.ROBINHOOD_USERNAME = username;
  if (password) env.ROBINHOOD_PASSWORD = password;
  if (totpSecret) env.ROBINHOOD_TOTP_SECRET = totpSecret;
  if (mfaCode) env.ROBINHOOD_MFA_CODE = mfaCode;
  if (sessionPath) env.ROBINHOOD_SESSION_PATH = sessionPath;

  return await new Promise<RobinhoodProbeResult>((resolve, reject) => {
    const child = spawn('py', [scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error('Robinhood probe timed out after 60s'));
    }, 60000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      let parsed: any;
      try {
        parsed = JSON.parse(stdout || '{}');
      } catch {
        reject(new Error(stderr.trim() || 'Robinhood probe returned invalid JSON'));
        return;
      }

      if (!parsed?.success) {
        reject(new Error(String(parsed?.error || stderr || 'Robinhood probe failed')));
        return;
      }

      resolve(parsed.data as RobinhoodProbeResult);
    });
  });
}
