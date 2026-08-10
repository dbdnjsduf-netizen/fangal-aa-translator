import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGeminiModel,
  translateBatch as translateBatchWithGemini,
  translateSelection as translateWithGemini,
} from '../services/geminiService';
import { createChunks } from '../services/ollamaService';
import {
  getProviderModelLabel,
  isProviderReady,
  normalizeTranslationProvider,
} from '../services/translationService';

test('저장된 엔진 값은 허용된 공급자로만 복구한다', () => {
  assert.equal(normalizeTranslationProvider('gemini'), 'gemini');
  assert.equal(normalizeTranslationProvider('ollama'), 'ollama');
  assert.equal(normalizeTranslationProvider('codex'), 'codex');
  assert.equal(normalizeTranslationProvider('openrouter'), 'openrouter');
  assert.equal(normalizeTranslationProvider('unknown'), 'ollama');
  assert.equal(normalizeTranslationProvider(null), 'ollama');
});

test('저장된 Gemini 모델은 지원 목록으로만 복구한다', () => {
  assert.equal(normalizeGeminiModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModel('gemini-2.5-flash-lite'), 'gemini-3.6-flash');
  assert.equal(normalizeGeminiModel('unknown-model'), 'gemini-3.6-flash');
});

test('선택한 엔진에 맞는 준비 상태와 모델명을 반환한다', () => {
  assert.equal(isProviderReady('ollama', '', true), true);
  assert.equal(isProviderReady('ollama', 'unused-key', false), false);
  assert.equal(isProviderReady('gemini', 'entered-key', false), true);
  assert.equal(isProviderReady('gemini', '   ', true), false);
  assert.equal(isProviderReady('openrouter', 'entered-key', false), true);
  assert.equal(isProviderReady('openrouter', '   ', true), false);
  assert.equal(isProviderReady('codex', '', false, {
    ok: true,
    authenticated: true,
    model: 'gpt-5.6-luna',
    cliVersion: 'codex-cli test',
    message: 'ready',
  }), true);
  assert.equal(isProviderReady('codex', '', true, null), false);
  assert.equal(getProviderModelLabel('gemini'), 'gemini-3.6-flash');
  assert.equal(
    getProviderModelLabel('gemini', 'unused', 'gemini-3.1-flash-lite'),
    'gemini-3.1-flash-lite',
  );
  assert.equal(getProviderModelLabel('ollama', 'custom-model'), 'custom-model');
  assert.equal(getProviderModelLabel('codex'), 'gpt-5.6-luna');
  assert.equal(getProviderModelLabel('openrouter'), 'google/gemma-3-27b-it');
});

test('Gemini용 보수적 청크 한도를 공통 청커에 적용할 수 있다', () => {
  const { chunks } = createChunks(
    Array.from({ length: 121 }, (_, index) => `대사${index}`),
    {
      softChars: 2_800,
      hardChars: 3_600,
      softItems: 50,
      hardItems: 64,
    },
  );

  assert.deepEqual(chunks.map((chunk) => chunk.length), [64, 57]);
  assert.equal(chunks.flat().length, 121);
});

test('Gemini 요청은 키를 URL이 아닌 헤더로 보내고 고정 길이 JSON 스키마를 사용한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let capturedUrl = '';
  let capturedKey = '';
  let capturedBody: any;

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedKey = new Headers(init?.headers).get('x-goog-api-key') || '';
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: '["안녕하세요"]' }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 3,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateWithGemini(
      'こんにちは',
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      '자연스러운 한국어로 번역하세요.',
      'gemini-3.1-flash-lite',
    );
    assert.equal(result.text, '안녕하세요');
    assert.equal(result.usage.requestCount, 1);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 3);
    assert.match(capturedUrl, /gemini-3\.1-flash-lite:generateContent$/);
    assert.doesNotMatch(capturedUrl, /TEST_ONLY_NOT_A_REAL_KEY/);
    assert.equal(capturedKey, 'TEST_ONLY_NOT_A_REAL_KEY');
    assert.equal(
      capturedBody.generationConfig.responseMimeType,
      'application/json',
    );
    assert.equal(capturedBody.generationConfig.responseSchema.minItems, 1);
    assert.equal(capturedBody.generationConfig.responseSchema.maxItems, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Gemini도 일본어가 남은 항목만 구조화 응답으로 다시 번역한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requestedChunks: string[][] = [];

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const inputJson = prompt
      .split('INPUT_JSON:\n')[1]
      .split('\n\nREPAIR THE REJECTED RESPONSE:')[0];
    const chunk = JSON.parse(inputJson) as string[];
    requestedChunks.push(chunk);

    const output = chunk.length > 1
      ? ['가', '나', '용사 勇者', '라']
      : prompt.includes('REPAIR THE REJECTED RESPONSE:')
        ? ['용사다']
        : ['용사 勇者'];
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(output) }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      ['あ', 'い', '勇者だ', 'え'],
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.deepEqual(result.translations, ['가', '나', '용사다', '라']);
    assert.deepEqual(requestedChunks, [
      ['あ', 'い', '勇者だ', 'え'],
      ['勇者だ'],
      ['勇者だ'],
    ]);
    assert.equal(result.usage.requestCount, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Gemini도 일부 청크 실패 시 정상 항목을 반환하고 실패 항목만 남긴다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const inputs = [
    ...Array.from({ length: 64 }, (_, index) => `原文${index}`),
    '失敗',
  ];

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1]) as string[];
    if (chunk.includes('失敗')) {
      return new Response(JSON.stringify({ error: { message: 'Gemini 단일 청크 실패' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(chunk.map((_, index) => `번역${index}`)) }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      inputs,
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.equal(result.translations[0], '번역0');
    assert.equal(result.translations[64], '失敗');
    assert.deepEqual(result.failures[0].itemIndices, [64]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
