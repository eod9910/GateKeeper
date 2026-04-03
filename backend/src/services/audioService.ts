import { getConfiguredOpenAIKey } from './aiSettings';

export interface TranscriptionResult {
  text: string;
  language?: string | null;
  durationSeconds?: number | null;
  model: string;
}

interface TranscriptionInput {
  audioBase64: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
}

function normalizeBase64Audio(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const commaIndex = raw.indexOf(',');
  return commaIndex >= 0 ? raw.slice(commaIndex + 1).trim() : raw;
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  return 'webm';
}

export async function transcribeAudio(input: TranscriptionInput): Promise<TranscriptionResult> {
  const openaiApiKey = getConfiguredOpenAIKey();
  if (!openaiApiKey) {
    throw new Error('OpenAI API key is not configured.');
  }

  const normalizedBase64 = normalizeBase64Audio(input.audioBase64);
  if (!normalizedBase64) {
    throw new Error('Audio payload was empty.');
  }

  const mimeType = String(input.mimeType || 'audio/webm').trim() || 'audio/webm';
  const extension = extensionFromMimeType(mimeType);
  const fileName = String(input.fileName || `voice-input.${extension}`).trim() || `voice-input.${extension}`;
  const audioBuffer = Buffer.from(normalizedBase64, 'base64');
  if (!audioBuffer.length) {
    throw new Error('Audio payload could not be decoded.');
  }

  const form = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  form.append('file', audioBlob, fileName);
  form.append('model', 'gpt-4o-transcribe');
  form.append('response_format', 'json');
  if (input.language) {
    form.append('language', String(input.language).trim());
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: form,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status}): ${raw || response.statusText}`);
  }

  let parsed: any = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { text: raw };
  }

  return {
    text: String(parsed?.text || '').trim(),
    language: parsed?.language ?? null,
    durationSeconds: typeof parsed?.duration === 'number' ? parsed.duration : null,
    model: 'gpt-4o-transcribe',
  };
}
