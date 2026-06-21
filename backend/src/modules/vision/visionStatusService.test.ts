import assert from 'assert';
import { checkVisionStatus } from './visionStatusService';

function tagsResponse(ok: boolean, models: Array<{ name: string }> = []) {
  return {
    ok,
    json: async () => ({ models }),
  };
}

async function testOpenAIWithoutKeyReportsConfigurationError() {
  const status = await checkVisionStatus({
    provider: 'openai',
    getOpenAIKey: () => undefined,
  });

  assert.deepStrictEqual(status, {
    available: false,
    modelLoaded: false,
    provider: 'openai',
    error: 'OpenAI API key not configured. Add it in Settings or backend/.env',
  });
}

async function testOpenAIWithKeyIsAvailable() {
  const status = await checkVisionStatus({
    provider: 'openai',
    getOpenAIKey: () => 'test-key',
  });

  assert.deepStrictEqual(status, {
    available: true,
    modelLoaded: true,
    provider: 'openai',
  });
}

async function testOllamaFindsConfiguredModel() {
  const urls: string[] = [];
  const status = await checkVisionStatus({
    provider: 'ollama',
    ollamaUrl: 'http://ollama.test',
    visionModel: 'chart-model',
    fetchTags: async (url) => {
      urls.push(url);
      return tagsResponse(true, [{ name: 'chart-model:latest' }]);
    },
  });

  assert.deepStrictEqual(urls, ['http://ollama.test/api/tags']);
  assert.deepStrictEqual(status, {
    available: true,
    modelLoaded: true,
    provider: 'ollama',
    error: undefined,
  });
}

async function testOllamaReportsMissingModel() {
  const status = await checkVisionStatus({
    provider: 'ollama',
    visionModel: 'chart-model',
    fetchTags: async () => tagsResponse(true, [{ name: 'other-model' }]),
  });

  assert.deepStrictEqual(status, {
    available: true,
    modelLoaded: false,
    provider: 'ollama',
    error: 'Model chart-model not found. Run: ollama pull chart-model',
  });
}

async function testOllamaReportsFetchFailure() {
  const status = await checkVisionStatus({
    provider: 'ollama',
    fetchTags: async () => {
      throw new Error('offline');
    },
  });

  assert.deepStrictEqual(status, {
    available: false,
    modelLoaded: false,
    provider: 'ollama',
    error: 'Ollama not running. Install from https://ollama.com and run: ollama serve',
  });
}

async function main() {
  await testOpenAIWithoutKeyReportsConfigurationError();
  await testOpenAIWithKeyIsAvailable();
  await testOllamaFindsConfiguredModel();
  await testOllamaReportsMissingModel();
  await testOllamaReportsFetchFailure();
  console.log('visionStatusService tests passed');
}

main();
