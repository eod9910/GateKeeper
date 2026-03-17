import { spawn } from 'child_process';
import * as path from 'path';

export interface RobinhoodFlowConfig {
  username?: string;
  password?: string;
  totp_secret?: string;
  mfa_code?: string;
  verification_code?: string;
  session_path?: string;
}

type RobinhoodFlowAction = 'start' | 'status' | 'verify' | 'positions';

export interface RobinhoodFlowResult {
  status: string;
  message?: string;
  challenge_type?: string | null;
  challenge_status?: string | null;
  workflow_status?: string | null;
  snapshot?: {
    source: string;
    stocks: unknown[];
    options: unknown[];
    counts: {
      stocks: number;
      options: number;
    };
  };
  http_status?: number;
}

function parseRobinhoodFlowOutput(stdout: string, stderr: string, action: RobinhoodFlowAction): any {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw new Error(stderr.trim() || `Robinhood ${action} returned no output`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Fall through to the final error below.
      }
    }
    throw new Error(stderr.trim() || `Robinhood ${action} returned invalid JSON`);
  }
}

async function runRobinhoodFlow(action: RobinhoodFlowAction, config: RobinhoodFlowConfig = {}): Promise<RobinhoodFlowResult> {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'robinhood_auth_flow.py');

  return await new Promise<RobinhoodFlowResult>((resolve, reject) => {
    const child = spawn('py', [scriptPath], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`Robinhood ${action} timed out after 90s`));
    }, 90000);

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
      try {
        const parsed = parseRobinhoodFlowOutput(stdout, stderr, action);
        if (!parsed?.success) {
          reject(new Error(String(parsed?.error || stderr || `Robinhood ${action} failed`)));
          return;
        }
        resolve(parsed.data as RobinhoodFlowResult);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    child.stdin.write(JSON.stringify({ action, config }));
    child.stdin.end();
  });
}

export function startRobinhoodLogin(config: RobinhoodFlowConfig = {}): Promise<RobinhoodFlowResult> {
  return runRobinhoodFlow('start', config);
}

export function getRobinhoodLoginStatus(config: RobinhoodFlowConfig = {}): Promise<RobinhoodFlowResult> {
  return runRobinhoodFlow('status', config);
}

export function verifyRobinhoodLoginCode(config: RobinhoodFlowConfig = {}): Promise<RobinhoodFlowResult> {
  return runRobinhoodFlow('verify', config);
}

export function fetchRobinhoodPositions(config: RobinhoodFlowConfig = {}): Promise<RobinhoodFlowResult> {
  return runRobinhoodFlow('positions', config);
}
