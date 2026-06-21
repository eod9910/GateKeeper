import fetch from 'node-fetch';
import { getConfiguredOpenAIKey } from '../../services/aiSettings';

export interface VisionStatus {
  available: boolean;
  modelLoaded: boolean;
  provider: string;
  error?: string;
}

interface VisionStatusTagsResponse {
  ok: boolean;
  json(): Promise<{ models?: Array<{ name: string }> }>;
}

export interface VisionStatusDependencies {
  provider?: string;
  ollamaUrl?: string;
  visionModel?: string;
  getOpenAIKey?: () => string | undefined;
  fetchTags?: (url: string) => Promise<VisionStatusTagsResponse>;
}

const DEFAULT_PROVIDER = process.env.VISION_PROVIDER || 'openai';
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_VISION_MODEL = process.env.VISION_MODEL || 'minicpm-v';

export async function checkVisionStatus(dependencies: VisionStatusDependencies = {}): Promise<VisionStatus> {
  const provider = dependencies.provider || DEFAULT_PROVIDER;
  const ollamaUrl = dependencies.ollamaUrl || DEFAULT_OLLAMA_URL;
  const visionModel = dependencies.visionModel || DEFAULT_VISION_MODEL;
  const getOpenAIKey = dependencies.getOpenAIKey || getConfiguredOpenAIKey;
  const fetchTags = dependencies.fetchTags || ((url: string) => fetch(url) as Promise<VisionStatusTagsResponse>);

  if (provider === 'openai') {
    const openaiApiKey = getOpenAIKey();
    if (!openaiApiKey) {
      return {
        available: false,
        modelLoaded: false,
        provider: 'openai',
        error: 'OpenAI API key not configured. Add it in Settings or backend/.env',
      };
    }

    return {
      available: true,
      modelLoaded: true,
      provider: 'openai',
    };
  }

  try {
    const tagsResponse = await fetchTags(`${ollamaUrl}/api/tags`);
    if (!tagsResponse.ok) {
      return {
        available: false,
        modelLoaded: false,
        provider: 'ollama',
        error: 'Ollama not responding',
      };
    }

    const tags = await tagsResponse.json();
    const models = tags.models || [];
    const hasModel = models.some((model) => model.name.includes('minicpm') || model.name.includes(visionModel));

    return {
      available: true,
      modelLoaded: hasModel,
      provider: 'ollama',
      error: hasModel ? undefined : `Model ${visionModel} not found. Run: ollama pull ${visionModel}`,
    };
  } catch (_error: any) {
    return {
      available: false,
      modelLoaded: false,
      provider: 'ollama',
      error: 'Ollama not running. Install from https://ollama.com and run: ollama serve',
    };
  }
}
