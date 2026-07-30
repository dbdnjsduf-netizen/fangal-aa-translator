import assert from 'node:assert/strict';
import test from 'node:test';
import { translateSelection as translateWithGemini } from '../services/geminiService';
import { createChunks } from '../services/ollamaService';
import {
  getProviderModelLabel,
  isProviderReady,
  normalizeTranslationProvider,
} from '../services/translationService';

test('저장된 엔진 값은 허용된 두 모드로만 복구한다', () => {
  assert.equal(normalizeTranslationProvider('gemini'), 'gemini');
  assert.equal(normalizeTranslationProvider('ollama'), 'ollama');
  assert.equal(normalizeTranslationProvider('unknown'), 'ollama');
  assert.equal(normalizeTranslationProvider(null), 'ollama');
});

test('선택한 엔진에 맞는 준비 상태와 모델명을 반환한다', () => {
  assert.equal(isProviderReady('ollama', '', true), true);
  assert.equal(isProviderReady('ollama', 'unused-key', false), false);
  assert.equal(isProviderReady('gemini', 'entered-key', false), true);
  assert.equal(isProviderReady('gemini', '   ', true), false);
  assert.equal(getProviderModelLabel('gemini'), 'gemini-3.6-flash');
  assert.equal(getProviderModelLabel('ollama', 'custom-model'), 'custom-model');
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
    );
    assert.equal(result.text, '안녕하세요');
    assert.equal(result.usage.requestCount, 1);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 3);
    assert.match(capturedUrl, /gemini-3\.6-flash:generateContent$/);
    assert.doesNotMatch(capturedUrl, /TEST_ONLY_NOT_A_REAL_KEY/);
    assert.equal(capturedKey, 'TEST_ONLY_NOT_A_REAL_KEY');
    assert.equal(
      capturedBody.generationConfig.responseFormat.text.mimeType,
      'application/json',
    );
    assert.equal(capturedBody.generationConfig.responseFormat.text.schema.minItems, 1);
    assert.equal(capturedBody.generationConfig.responseFormat.text.schema.maxItems, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
