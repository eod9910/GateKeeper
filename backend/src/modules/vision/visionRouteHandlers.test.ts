import assert from 'assert';
import { Request, Response } from 'express';
import {
  createVisionRouteHandlers,
  VisionChatLogDetails,
  VisionRouteServices,
} from './visionRouteHandlers';

class FakeResponse {
  statusCode = 200;
  body: unknown;

  status(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    return this;
  }
}

function createRequest(body: unknown = {}) {
  return { body } as Request;
}

function createResponse() {
  return new FakeResponse() as unknown as Response & FakeResponse;
}

function createServices(overrides: Partial<VisionRouteServices> = {}) {
  const calls = {
    analyzeImages: [] as string[],
    chatRoles: [] as Array<string | undefined>,
    chatMessages: [] as string[],
    chatImages: [] as Array<string | undefined>,
    logs: [] as VisionChatLogDetails[],
  };

  const services: VisionRouteServices = {
    checkOllamaStatus: async () => ({
      available: true,
      modelLoaded: true,
      provider: 'test',
    }),
    listWorkspaceAnalysts: () => [
      {
        id: 'technical_analyst',
        label: 'Structure',
        workspaceName: 'Technical Analyst Workspace',
        description: 'Tests structure analysis wiring.',
      },
    ],
    analyzeChartPattern: async (imageBase64) => {
      calls.analyzeImages.push(imageBase64);
      return {
        confidence: 99,
        isValidPattern: true,
        explanation: 'analysis ok',
        rawResponse: 'analysis ok',
        provider: 'test',
      };
    },
    chatWithCopilot: async (message, _context, chartImage, role) => {
      calls.chatMessages.push(message);
      calls.chatImages.push(chartImage);
      calls.chatRoles.push(role);
      return 'chat ok';
    },
    logChatRequest: (details) => {
      calls.logs.push(details);
    },
    ...overrides,
  };

  return { services, calls };
}

async function testStatusReturnsServiceStatus() {
  const { services } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.status(createRequest(), res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, {
    success: true,
    data: {
      available: true,
      modelLoaded: true,
      provider: 'test',
    },
  });
}

async function testAnalystsReturnsWorkspaceAnalysts() {
  const { services } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.analysts(createRequest(), res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, {
    success: true,
    data: [
      {
        id: 'technical_analyst',
        label: 'Structure',
        workspaceName: 'Technical Analyst Workspace',
        description: 'Tests structure analysis wiring.',
      },
    ],
  });
}

async function testAnalyzeRejectsMissingImage() {
  const { services, calls } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.analyze(createRequest({ imageBase64: '   ' }), res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, {
    success: false,
    error: 'imageBase64 is required',
  });
  assert.deepStrictEqual(calls.analyzeImages, []);
}

async function testAnalyzeNormalizesImage() {
  const { services, calls } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.analyze(createRequest({ imageBase64: '  abc123  ' }), res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.analyzeImages, ['abc123']);
  assert.deepStrictEqual(res.body, {
    success: true,
    data: {
      confidence: 99,
      isValidPattern: true,
      explanation: 'analysis ok',
      rawResponse: 'analysis ok',
      provider: 'test',
    },
  });
}

async function testChatRejectsMissingMessageAfterLogging() {
  const { services, calls } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.chat(createRequest({ role: 'technical_analyst' }), res, () => {});

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, {
    success: false,
    error: 'message is required',
  });
  assert.strictEqual(calls.logs.length, 1);
  assert.deepStrictEqual(calls.chatMessages, []);
}

async function testChatUsesAnalystBeforeRole() {
  const { services, calls } = createServices();
  const handlers = createVisionRouteHandlers(services);
  const res = createResponse();

  await handlers.chat(createRequest({
    message: 'hello',
    chartImage: 'image-data',
    role: 'technical_analyst',
    analyst: 'financial_analyst',
    context: { symbol: 'AAPL' },
  }), res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.chatMessages, ['hello']);
  assert.deepStrictEqual(calls.chatImages, ['image-data']);
  assert.deepStrictEqual(calls.chatRoles, ['financial_analyst']);
  assert.deepStrictEqual(calls.logs, [
    {
      analyst: 'financial_analyst',
      hasChartImage: true,
      chartImageLength: 10,
      aiModel: null,
      pluginEngineerModel: null,
      symbol: 'AAPL',
      messageLength: 5,
    },
  ]);
  assert.deepStrictEqual(res.body, {
    success: true,
    data: { response: 'chat ok' },
  });
}

async function main() {
  await testStatusReturnsServiceStatus();
  await testAnalystsReturnsWorkspaceAnalysts();
  await testAnalyzeRejectsMissingImage();
  await testAnalyzeNormalizesImage();
  await testChatRejectsMissingMessageAfterLogging();
  await testChatUsesAnalystBeforeRole();
  console.log('visionRouteHandlers tests passed');
}

main();
