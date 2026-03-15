import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  StrategyContract,
  TrainingAttempt,
  TrainingEvent,
  TrainingSession,
} from '../../types';

const TRAINING_DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'training');
const CONTRACTS_DIR = path.join(TRAINING_DATA_DIR, 'contracts');
const SESSIONS_DIR = path.join(TRAINING_DATA_DIR, 'sessions');
const ATTEMPTS_DIR = path.join(TRAINING_DATA_DIR, 'attempts');
const EVENTS_DIR = path.join(TRAINING_DATA_DIR, 'events');
const STATS_DIR = path.join(TRAINING_DATA_DIR, 'stats');

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureTrainingDirs(): Promise<void> {
  await Promise.all([
    ensureDir(CONTRACTS_DIR),
    ensureDir(SESSIONS_DIR),
    ensureDir(ATTEMPTS_DIR),
    ensureDir(EVENTS_DIR),
    ensureDir(STATS_DIR),
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function readDirJson<T>(dirPath: string): Promise<T[]> {
  await ensureDir(dirPath);
  const files = await fs.readdir(dirPath);
  const items = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => readJsonFile<T>(path.join(dirPath, file))),
  );
  return items.filter((item) => item != null) as T[];
}

export async function listContracts(): Promise<StrategyContract[]> {
  const contracts = await readDirJson<StrategyContract>(CONTRACTS_DIR);
  return contracts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContract(contractId: string): Promise<StrategyContract | null> {
  return readJsonFile<StrategyContract>(path.join(CONTRACTS_DIR, `${contractId}.json`));
}

export async function saveContract(contract: StrategyContract): Promise<StrategyContract> {
  const now = new Date().toISOString();
  const payload: StrategyContract = {
    ...contract,
    createdAt: contract.createdAt || now,
    updatedAt: now,
  };
  await writeJsonFile(path.join(CONTRACTS_DIR, `${payload.id}.json`), payload);
  return payload;
}

export async function listSessions(): Promise<TrainingSession[]> {
  const sessions = await readDirJson<TrainingSession>(SESSIONS_DIR);
  return sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export async function getSession(sessionId: string): Promise<TrainingSession | null> {
  return readJsonFile<TrainingSession>(path.join(SESSIONS_DIR, `${sessionId}.json`));
}

export async function saveSession(session: TrainingSession): Promise<TrainingSession> {
  await writeJsonFile(path.join(SESSIONS_DIR, `${session.sessionId}.json`), session);
  return session;
}

export async function listAttempts(): Promise<TrainingAttempt[]> {
  const attempts = await readDirJson<TrainingAttempt>(ATTEMPTS_DIR);
  return attempts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function listAttemptsBySession(sessionId: string): Promise<TrainingAttempt[]> {
  const attempts = await listAttempts();
  return attempts.filter((attempt) => attempt.sessionId === sessionId);
}

export async function getAttempt(attemptId: string): Promise<TrainingAttempt | null> {
  return readJsonFile<TrainingAttempt>(path.join(ATTEMPTS_DIR, `${attemptId}.json`));
}

export async function saveAttempt(attempt: TrainingAttempt): Promise<TrainingAttempt> {
  await writeJsonFile(path.join(ATTEMPTS_DIR, `${attempt.attemptId}.json`), attempt);
  return attempt;
}

export async function writeStatsCache(key: string, payload: unknown): Promise<void> {
  await writeJsonFile(path.join(STATS_DIR, `${key}.json`), payload);
}

export async function logTrainingEvent(event: Omit<TrainingEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<TrainingEvent> {
  const payload: TrainingEvent = {
    ...event,
    id: event.id || randomUUID(),
    timestamp: event.timestamp || new Date().toISOString(),
  };
  await writeJsonFile(path.join(EVENTS_DIR, `${payload.id}.json`), payload);
  return payload;
}

export async function ensureSampleContracts(defaults: StrategyContract[]): Promise<void> {
  await ensureTrainingDirs();
  for (const contract of defaults) {
    const existing = await getContract(contract.id);
    if (!existing) {
      await saveContract(contract);
    }
  }
}
