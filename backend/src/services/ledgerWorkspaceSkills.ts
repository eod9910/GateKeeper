import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEDGER_WORKSPACE_ROOT = path.join(PROJECT_ROOT, 'workspace', 'Financial Analyst Workspace');

const skillCache = new Map<string, string>();

function readTextIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeDocName(docName: string): string {
  const normalized = String(docName || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid Ledger skill document name: ${docName}`);
  }
  return normalized;
}

export function loadLedgerWorkspaceSkill(skillName: string, documentNames: string[] = []): string {
  const normalizedSkill = String(skillName || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalizedSkill)) {
    throw new Error(`Invalid Ledger skill name: ${skillName}`);
  }
  const normalizedDocs = documentNames.map(normalizeDocName);
  const cacheKey = `${normalizedSkill}|${normalizedDocs.join('|')}`;
  const cached = skillCache.get(cacheKey);
  if (cached) return cached;

  const skillDir = path.join(LEDGER_WORKSPACE_ROOT, 'skills', normalizedSkill);
  const skillPath = path.join(skillDir, 'SKILL.md');
  const parts: string[] = [];
  const skillText = readTextIfPresent(skillPath);
  if (!skillText) {
    throw new Error(`Ledger workspace skill not found: ${skillPath}`);
  }
  parts.push(`# Ledger Workspace Skill: ${normalizedSkill}`, skillText.trim());

  for (const docName of normalizedDocs) {
    const docPath = path.join(skillDir, 'documents', docName);
    const docText = readTextIfPresent(docPath);
    if (!docText) {
      throw new Error(`Ledger skill document not found: ${docPath}`);
    }
    parts.push(`# Ledger Skill Document: ${docName}`, docText.trim());
  }

  const assembled = parts.join('\n\n---\n\n');
  skillCache.set(cacheKey, assembled);
  return assembled;
}
